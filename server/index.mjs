import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { openStore } from './store.mjs';
import { createMailService } from './mail.mjs';
import { getCatalog, dashboard, seedRules, startScheduler, synchronize } from './service.mjs';
import { miniappDashboard } from './miniapp-dashboard.mjs';
import { digest } from './domain.mjs';
import { accountConfig, installAccountAuth } from './auth.mjs';

export async function createApplication({ store = openStore(), mail = createMailService(store), startJobs = true, development = process.env.NODE_ENV !== 'production' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 2) throw new Error('TRUST_PROXY_HOPS 必须为0至2');
  if (proxyHops) app.set('trust proxy', proxyHops);
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4387);
  const origin = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  const authConfig = accountConfig(process.env, origin);
  const adminToken = process.env.ADMIN_TOKEN;
  seedRules(store);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    // Logout applies its own Origin/Fetch Metadata plus per-session CSRF checks.
    if (req.path !== '/api/auth/logout' && ['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin && req.headers.origin !== new URL(origin).origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: '不允许跨站修改' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '4kb' }));
  const budgets = new Map();
  function rateLimit(req, res, next) {
    const key = req.ip;
    const now = Date.now(); let row = budgets.get(key);
    if (!row || row.until <= now) { row = { count: 0, until: now + 3600000 }; budgets.set(key, row); }
    if (++row.count > 30) return res.status(429).json({ error: '操作过于频繁，请稍后重试' });
    if (budgets.size > 10000) for (const [k, value] of budgets) if (value.until < now) budgets.delete(k);
    next();
  }
  function admin(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (!adminToken || token.length !== adminToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(adminToken))) return res.status(401).json({ error: '需要管理员凭证' });
    next();
  }
  // Shared public data for the website and AnyService (service: dashboard).
  // Keep this ahead of account/browser identity middleware: no session or cookie needed.
  app.get('/api/dashboard', (req, res) => {
    const board = dashboard(store, mail);
    res.json(req.query.view === 'miniapp' ? miniappDashboard(board) : board);
  });
  installAccountAuth(app, { store, config: authConfig, rateLimit });
  app.use((req, res, next) => {
    // Strict guest cookies are withheld on cross-site OIDC redirects. Do not
    // replace them during authentication or while an account session is active.
    if (req.accountSession || ['/login', '/register'].includes(req.path)) return next();
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('radar_owner='))?.slice(12);
    const owner = /^[a-f0-9]{64}$/.test(cookie || '') ? cookie : randomBytes(32).toString('hex');
    if (owner !== cookie) res.append('Set-Cookie', `radar_owner=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${origin.startsWith('https:') ? '; Secure' : ''}`);
    req.owner = digest(owner); next();
  });
  const subscriptionSchema = z.object({
    email: z.string().trim().email().max(254).transform(s => s.toLowerCase()),
    code: z.string().refine(code => code === 'all' || getCatalog(store).some(f => f.code === code && f.venue !== 'etf'), '未知基金'),
    channels: z.array(z.enum(['agency', 'direct'])).min(1).max(2).transform(v => [...new Set(v)]),
    events: z.array(z.enum(['resume', 'increase', 'decrease'])).min(1).max(3).transform(v => [...new Set(v)]),
  }).strict();
  app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: 'live', mailConfigured: mail.configured, lastRun: store.getMeta('lastRun')?.status || 'not_started' }));
  // Public website ID only; credentials and usage events never pass through this endpoint.
  app.get('/api/public-config', (req, res) => res.json({ umamiWebsiteId: development ? null : process.env.UMAMI_WEBSITE_ID || null }));
  app.get('/api/subscriptions', (req, res) => res.json({ subscriptions: mail.list(req.owner), mailConfigured: mail.configured }));
  app.post('/api/subscriptions', rateLimit, (req, res) => { const data = subscriptionSchema.parse(req.body); const sub = mail.saveSubscription(req.owner, data); res.status(201).json(sub); mail.deliver().catch(() => {}); });
  app.patch('/api/subscriptions/:id', rateLimit, (req, res) => {
    const data = subscriptionSchema.parse(req.body);
    if (mail.list(req.owner).some(s => s.id !== req.params.id && s.code === data.code)) return res.status(409).json({ error: '此基金已有提醒，请编辑已有提醒' });
    res.json(mail.saveSubscription(req.owner, data, req.params.id)); mail.deliver().catch(() => {});
  });
  app.delete('/api/subscriptions/:id', rateLimit, (req, res) => { const removed = mail.removeSubscription(req.owner, req.params.id); res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: '提醒不存在' }); });
  app.post('/api/subscriptions/:id/resend', rateLimit, (req, res) => {
    const sub = mail.list(req.owner).find(s => s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: '提醒不存在' });
    mail.issueVerification(sub.id); res.json({ ok: true, mailConfigured: mail.configured }); mail.deliver().catch(() => {});
  });
  const confirmationPage = (title, body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 额度雷达</title><body style="margin:0;padding:60px 24px;background:#f4f7fb;font-family:system-ui;color:#243953"><main style="max-width:460px;margin:auto;padding:30px;background:white;border-radius:16px"><h1 style="font-size:24px">${title}</h1>${body}<p><a href="/">返回基金看板</a></p></main></body></html>`;
  app.get('/verify', (req, res) => { const token = /^[a-f0-9]{64}$/.test(req.query.token || '') ? req.query.token : ''; res.type('html').send(confirmationPage('确认邮箱提醒', token ? `<p>确认后将接收你选择的额度变化提醒。</p><form method="post" action="/api/subscriptions/verify"><input type="hidden" name="token" value="${token}"><button>确认订阅</button></form>` : '<p>验证链接无效。</p>')); });
  app.post('/api/subscriptions/verify', rateLimit, (req, res) => { const ok = mail.verify(req.body.token); res.status(ok ? 200 : 400).type('html').send(confirmationPage(ok ? '邮箱已确认' : '验证链接已失效', ok ? '<p>额度发生符合条件的变化时，将发送邮件。</p>' : '<p>请回到看板重新发送验证邮件。</p>')); });
  app.get('/unsubscribe', (req, res) => { const id = /^[a-f0-9]{32}$/.test(req.query.id || '') ? req.query.id : ''; const token = /^[a-f0-9]{64}$/.test(req.query.token || '') ? req.query.token : ''; res.type('html').send(confirmationPage('取消额度提醒', id && token ? `<form method="post" action="/api/unsubscribe"><input type="hidden" name="id" value="${id}"><input type="hidden" name="token" value="${token}"><p>取消后，这条订阅将不再收到邮件。</p><button>确认退订</button></form>` : '<p>退订链接无效。</p>')); });
  app.post('/api/unsubscribe', rateLimit, (req, res) => { const ok = mail.unsubscribe(req.body.id, req.body.token); res.status(ok ? 200 : 400).type('html').send(confirmationPage(ok ? '已退订' : '链接无效或已退订', '<p>你可以返回看板管理其他提醒。</p>')); });
  app.get('/api/admin/status', admin, (req, res) => res.json({ lastRun: store.getMeta('lastRun'), catalog: store.getMeta('catalog:lastDiscovery'), mail: mail.status(), notices: store.notices().map(({ excerpt, ...n }) => n) }));
  app.post('/api/admin/sync', admin, (req, res) => { res.status(202).json({ message: '同步任务已提交' }); synchronize(store, mail).catch(() => {}); });
  app.get('/api/admin/notices/:id/:code', admin, (req, res) => { const n = store.notice(req.params.id, req.params.code); res.status(n ? 200 : 404).json(n || { error: '公告不存在' }); });
  app.post('/api/admin/notices/:id/:code/review', admin, (req, res) => {
    const n = store.notice(req.params.id, req.params.code); if (!n) return res.status(404).json({ error: '公告不存在' });
    const schema = z.object({ ignore: z.boolean().optional(), reason: z.string().min(5).max(1000), rules: z.array(z.object({ channel: z.enum(['agency', 'direct']), status: z.enum(['open', 'paused']), limit: z.number().positive().max(1e8).nullable(), effectiveAt: z.string().datetime({ offset: true }), note: z.string().min(5).max(2000) })).max(2).default([]) });
    const input = schema.parse(req.body);
    if (!input.ignore && !input.rules.length) return res.status(400).json({ error: '请提供审核后的规则或明确忽略理由' });
    if ((input.ignore && input.rules.length) || new Set(input.rules.map(r => r.channel)).size !== input.rules.length || input.rules.some(r => (r.status === 'open') !== (r.limit !== null))) return res.status(400).json({ error: '状态、额度或渠道不一致' });
    store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of input.rules) store.addRule({ ...r, code: n.code, sourceUrl: n.sourceUrl, publishedAt: n.publishedAt, noticeId: n.id, origin: 'manual_review', reviewedAt: new Date().toISOString() });
      store.saveNotice({ ...n, state: input.ignore ? 'ignored_reviewed' : 'reviewed', reason: input.reason, reviewedAt: new Date().toISOString(), rules: input.rules });
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); const status = error instanceof z.ZodError || error.type === 'entity.parse.failed' ? 400 : error.status || 500; res.status(status).json({ error: status === 400 ? '参数格式不正确，请检查邮箱、基金和提醒选项' : status === 404 ? '提醒不存在' : '服务暂时不可用，请稍后重试' }); });
  let vite;
  if (development) { const { createServer } = await import('vite'); vite = await createServer({ root: process.cwd(), server: { middlewareMode: true, fs: { deny: ['**/.env*', '**/.data/**', '**/.test-data/**', '**/server/**', '**/work/**', '**/outputs/**', '**/*.{crt,pem}'] } }, appType: 'spa' }); app.use(vite.middlewares); }
  else { app.use(express.static(path.resolve('dist'))); app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html'))); }
  const stopJobs = startJobs ? startScheduler(store, mail) : () => {};
  return { app, store, mail, port, close: async () => { stopJobs(); if (vite) await vite.close(); store.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await createApplication();
  const server = runtime.app.listen(runtime.port, '0.0.0.0', () => console.log(`额度雷达已启动：http://localhost:${runtime.port} · 每日 ${process.env.DAILY_SYNC_TIME || '07:30'} Asia/Shanghai 同步公告`));
  const stop = () => server.close(async () => { await runtime.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
