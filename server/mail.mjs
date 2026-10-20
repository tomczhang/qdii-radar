import nodemailer from 'nodemailer';
import { randomBytes, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { digest } from './domain.mjs';
import { createResendTransport } from './resend.mjs';
import { accountEmail } from './account-email.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export function createMailService(store, { fetchImpl = fetch } = {}) {
  const secretPath = path.join(store.directory, 'mail-secret');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const secret = fs.readFileSync(secretPath, 'utf8');
  const transport = process.env.MAIL_TRANSPORT || (process.env.RESEND_API_KEY ? 'resend' : 'smtp');
  if (!['file', 'smtp', 'resend', 'disabled'].includes(transport)) throw new Error('不支持的邮件服务类型');
  const fileMode = transport === 'file';
  if (fileMode && process.env.NODE_ENV === 'production') throw new Error('生产环境不能使用文件邮箱');
  const resendMode = transport === 'resend';
  const from = (resendMode ? process.env.RESEND_FROM : process.env.SMTP_FROM)?.trim();
  const replyTo = process.env.MAIL_REPLY_TO?.trim();
  if (/[\r\n]/.test((from || '') + (replyTo || ''))) throw new Error('邮件发件人配置无效');
  const configured = fileMode || !!(process.env.PUBLIC_BASE_URL && from && (resendMode ? process.env.RESEND_API_KEY : transport === 'smtp' && process.env.SMTP_HOST));
  const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:4387').replace(/\/$/, '');
  const transporter = configured && resendMode ? createResendTransport({ apiKey: process.env.RESEND_API_KEY, fetchImpl }) : configured && !fileMode ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15000, socketTimeout: 20000,
  }) : null;
  const unsubscribeToken = id => createHmac('sha256', secret).update(`unsubscribe:${id}`).digest('hex');
  function queue(id, subscriptionId, payload) {
    store.db.prepare('INSERT OR IGNORE INTO outbox(id,subscription_id,state,next_at,payload) VALUES(?,?,?,?,?)').run(id, subscriptionId, 'pending', new Date().toISOString(), JSON.stringify(payload));
  }
  function issueVerification(id) {
    const sub = store.db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id); if (!sub || sub.verified) return;
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 48 * 3600000).toISOString();
    store.db.prepare('UPDATE subscriptions SET verify_hash=?,expires_at=? WHERE id=?').run(digest(token), expires, id);
    queue(`verify:${id}:${digest(token)}`, id, { kind: 'verify', tokenHash: digest(token), subject: '请确认你的额度雷达邮件提醒', text: `你正在为额度雷达设置提醒。请在48小时内打开以下链接并确认：\n${base}/verify?token=${token}\n\n确认前不会发送额度变化提醒。若非本人操作，无需理会。\n取消这条订阅：${base}/unsubscribe?id=${id}&token=${unsubscribeToken(id)}` });
  }
  function publicSubscription(row) {
    const payload = JSON.parse(row.payload);
    return { id: row.id, code: row.code, email: row.email, channels: payload.channels, events: payload.events, verified: !!row.verified, deliveryStatus: !configured ? 'awaiting_configuration' : row.verified ? 'active' : 'pending_verification', createdAt: row.created_at };
  }
  function saveSubscription(owner, input, id) {
    const existing = id ? store.db.prepare('SELECT * FROM subscriptions WHERE id=? AND owner=?').get(id, owner) : null;
    if (id && !existing) throw Object.assign(new Error('提醒不存在'), { status: 404 });
    const same = !id && store.db.prepare('SELECT * FROM subscriptions WHERE owner=? AND code=?').get(owner, input.code);
    const previous = existing || same;
    const subscriptionId = previous?.id || randomBytes(16).toString('hex');
    const changedEmail = !previous || previous.email !== input.email;
    const now = new Date().toISOString();
    if (previous) store.db.prepare('UPDATE subscriptions SET email=?,code=?,payload=?,verified=?,updated_at=? WHERE id=?').run(input.email, input.code, JSON.stringify({ channels: input.channels, events: input.events }), changedEmail ? 0 : previous.verified, now, subscriptionId);
    else store.db.prepare('INSERT INTO subscriptions(id,owner,email,code,payload,verified,unsubscribe_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(subscriptionId, owner, input.email, input.code, JSON.stringify({ channels: input.channels, events: input.events }), 0, digest(unsubscribeToken(subscriptionId)), now, now);
    if (changedEmail) issueVerification(subscriptionId);
    return publicSubscription(store.db.prepare('SELECT * FROM subscriptions WHERE id=?').get(subscriptionId));
  }
  function removeSubscription(owner, id) {
    const deleted = store.db.prepare('DELETE FROM subscriptions WHERE id=? AND owner=?').run(id, owner);
    if (deleted.changes) store.db.prepare('DELETE FROM outbox WHERE subscription_id=?').run(id);
    return !!deleted.changes;
  }
  function queueEvent(event) {
    for (const row of store.db.prepare("SELECT * FROM subscriptions WHERE verified=1 AND (code=? OR code=?) ORDER BY (code='all'),created_at").all(event.code, 'all')) {
      const rule = JSON.parse(row.payload);
      const kind = event.type === 'pause' ? 'decrease' : event.type;
      if (!rule.channels.includes(event.channelKey) || !rule.events.includes(kind) || event.createdAt < row.updated_at) continue;
      queue(`event:${event.id}:${digest(row.owner + ':' + row.email)}`, row.id, { kind: 'event', eventId: event.id, email: row.email, channel: event.channelKey, eventKind: kind, code: event.code, subject: `${event.name}：${event.channel}额度 ${event.after}`, text: `${event.name}（${event.code}）\n渠道：${event.channel}\n原状态：${event.before}\n新状态：${event.after}\n生效或观测时间：${event.effectiveAt}\n依据：${event.sourceUrl}\n\n查看看板：${base}\n额度按基金账户及公告规则累计，不代表个人剩余额度。\n退订：${base}/unsubscribe?id=${row.id}&token=${unsubscribeToken(row.id)}` });
    }
  }
  let sending = false;
  async function deliver() {
    if (resendMode && store.getMeta('resendCooldownUntil') > Date.now()) return;
    if (!configured || sending || !store.acquireLease('mail-delivery', 5 * 60000)) return;
    sending = true;
    try {
      // Renew only a still-undelivered verification after configuration/recovery; do not nag unconfirmed users.
      for (const sub of store.db.prepare("SELECT id FROM subscriptions WHERE verified=0 AND expires_at<? AND EXISTS (SELECT 1 FROM outbox WHERE subscription_id=subscriptions.id AND state IN ('pending','retry') AND attempts<5)").all(new Date().toISOString())) issueVerification(sub.id);
      const jobs = store.db.prepare("SELECT * FROM outbox WHERE state IN ('pending','retry') AND attempts<5 AND next_at<=? ORDER BY next_at LIMIT 20").all(new Date().toISOString());
      for (const job of jobs) {
        if (resendMode && store.getMeta('resendCooldownUntil') > Date.now()) break;
        const sub = store.db.prepare('SELECT * FROM subscriptions WHERE id=?').get(job.subscription_id);
        const payload = JSON.parse(job.payload);
        if (!sub || (payload.kind === 'verify' && (sub.verified || payload.tokenHash !== sub.verify_hash)) || (payload.kind === 'event' && !sub.verified)) { store.db.prepare("UPDATE outbox SET state='cancelled' WHERE id=?").run(job.id); continue; }
        const preferences = JSON.parse(sub.payload);
        if (payload.kind === 'event' && (payload.email !== sub.email || !preferences.channels.includes(payload.channel) || !preferences.events.includes(payload.eventKind) || !['all', payload.code].includes(sub.code))) { store.db.prepare("UPDATE outbox SET state='cancelled' WHERE id=?").run(job.id); continue; }
        if ((job.transport && job.transport !== transport) || (resendMode && job.first_attempt_at && Date.now() - Date.parse(job.first_attempt_at) >= 23 * 3600000)) {
          store.db.prepare("UPDATE outbox SET state='failed',error=? WHERE id=?").run('重试窗口已过或服务类型改变，需人工核查投递状态', job.id); continue;
        }
        // Stable Message-ID + persisted outbox prevent normal retries from generating new logical notifications.
        try {
          const mail = job.request_payload ? JSON.parse(job.request_payload) : { from: from || 'radar@example.test', ...(replyTo ? { replyTo } : {}), to: sub.email, subject: payload.subject, text: payload.text, messageId: `<${digest(job.id)}@quota-radar.local>`, headers: { 'List-Unsubscribe': `<${base}/unsubscribe?id=${sub.id}&token=${unsubscribeToken(sub.id)}>` } };
          if (!job.request_payload) store.db.prepare('UPDATE outbox SET transport=?,first_attempt_at=?,request_payload=? WHERE id=?').run(transport, new Date().toISOString(), JSON.stringify(mail), job.id);
          let providerId = null;
          if (fileMode) { const dir = path.join(store.directory, 'mailbox'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(dir, digest(job.id) + '.json'), JSON.stringify(mail), { mode: 0o600 }); }
          else providerId = (resendMode ? await transporter.sendMail(mail, `qdii-radar/${digest(job.id)}`) : await transporter.sendMail(mail))?.messageId || null;
          store.db.prepare("UPDATE outbox SET state='sent',attempts=attempts+1,sent_at=?,provider_id=?,error=NULL WHERE id=?").run(new Date().toISOString(), providerId, job.id);
        } catch (error) {
          const attempts = job.attempts + 1;
          const retryMs = Math.max(Math.min(2 ** attempts * 60000, 3600000), error.retryAfterMs || 0);
          if (error.code === 'resend_http_429') store.setMeta('resendCooldownUntil', Date.now() + retryMs);
          const safeError = /^resend_http_\d{3}$/.test(error.code || '') ? error.code : '邮件投递失败，请检查邮件服务配置或重试';
          store.db.prepare('UPDATE outbox SET state=?,attempts=?,next_at=?,error=? WHERE id=?').run(attempts >= 5 || error.permanent ? 'failed' : 'retry', attempts, new Date(Date.now() + retryMs).toISOString(), safeError, job.id);
        }
        if (resendMode && jobs.length > 1) await delay(1000);
      }
    } finally { sending = false; store.releaseLease('mail-delivery'); }
  }
  return {
    configured, transport: configured ? transport : 'disabled', saveSubscription, removeSubscription, queueEvent, deliver, issueVerification,
    async sendAccountLink(email, url, requestId, purpose) {
      if (!configured || (resendMode && store.getMeta('resendCooldownUntil') > Date.now())) throw new Error('账号邮件服务暂时不可用');
      const mail = {
        from: from || 'radar@example.test', ...(replyTo ? { replyTo } : {}), to: email,
        ...accountEmail(url, purpose),
        messageId: `<${digest(requestId)}@quota-radar.local>`,
      };
      if (fileMode) {
        const dir = path.join(store.directory, 'mailbox');
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, `account-${digest(requestId)}.json`), JSON.stringify(mail), { mode: 0o600 });
      } else if (resendMode) {
        try { await transporter.sendMail(mail, `qdii-radar/account/${digest(requestId)}`); }
        catch (error) {
          if (error.code === 'resend_http_429') store.setMeta('resendCooldownUntil', Date.now() + Math.max(60000, error.retryAfterMs || 0));
          throw error;
        }
      } else await transporter.sendMail(mail);
    },
    list(owner) { return store.db.prepare('SELECT * FROM subscriptions WHERE owner=? ORDER BY created_at DESC').all(owner).map(publicSubscription); },
    verify(token) { if (!/^[a-f0-9]{64}$/.test(token || '')) return false; return !!store.db.prepare('UPDATE subscriptions SET verified=1,verify_hash=NULL,updated_at=? WHERE verify_hash=? AND expires_at>?').run(new Date().toISOString(), digest(token), new Date().toISOString()).changes; },
    unsubscribe(id, token) { if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(token || '')) return false; const row = store.db.prepare('SELECT * FROM subscriptions WHERE id=? AND unsubscribe_hash=?').get(id, digest(token)); return row ? removeSubscription(row.owner, id) : false; },
    status() { return { configured, transport: configured ? transport : 'disabled', requestedTransport: transport, missing: configured ? [] : [!from && '发件人地址', resendMode && !process.env.RESEND_API_KEY && 'Resend API Key', transport === 'smtp' && !process.env.SMTP_HOST && 'SMTP Host', !process.env.PUBLIC_BASE_URL && '网站地址'].filter(Boolean), outbox: store.db.prepare('SELECT state,COUNT(*) count FROM outbox GROUP BY state').all() }; },
  };
}
