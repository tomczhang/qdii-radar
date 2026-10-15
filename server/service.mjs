import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { agencyQuota, chinaDate, classifyChange, digest, isQuotaNotice, noticeShares, nextDailyRun, parseQuotaNotice, quotaText, unknownQuota } from './domain.mjs';
import { fetchMarket, fetchNoticePage, fetchNoticeText, fetchGildata, gildataConfigured } from './providers.mjs';

export const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL('./verified-baseline.json', import.meta.url)));
export function seedRules(store) {
  for (const rule of baseline) store.addRule({ ...rule, id: `reviewed-baseline-${rule.code}-${rule.channel}-${rule.effectiveAt}`, origin: 'reviewed_baseline' });
  for (const rule of baseline) for (const notice of store.pendingNotices(rule.code)) {
    if (notice.publishedAt < rule.reviewedThrough) store.saveNotice({ ...notice, state: 'baseline_covered', reason: '历史公告已由人工核验的现行规则覆盖' });
  }
}
export function currentFund(store, fund, now = new Date()) {
  const snapshot = store.snapshot(fund.code);
  const rule = store.activeRule(fund.code, 'direct', now);
  const pending = store.pendingNotices(fund.code).filter(n => n.publishedAt >= (rule?.reviewedThrough || rule?.publishedAt || '1900-01-01'));
  const scan = store.getMeta(`noticeScan:${fund.code}`);
  const directStale = !scan?.checkedAt || +now - Date.parse(scan.checkedAt) > 36 * 3600000;
  const stale = !snapshot || +now - Date.parse(snapshot.observedAt) > 36 * 3600000 || directStale;
  let direct = rule ? { status: rule.status, limit: rule.limit, source: '基金公司公告', sourceUrl: rule.sourceUrl, effectiveAt: rule.effectiveAt, ruleId: rule.id, evidence: rule.evidence, stale } : unknownQuota();
  if (pending.length) direct = { ...unknownQuota('发现待核验的新公告'), sourceUrl: pending[0].sourceUrl, previous: direct, pendingReview: true };
  const { raw, gildataRaw, ...safe } = snapshot || {};
  const agencyRule = store.activeRule(fund.code, 'agency', now);
  if (snapshot && agencyRule && snapshot.agency.status !== 'unavailable' && new Date(agencyRule.effectiveAt) > new Date(snapshot.observedAt)) safe.agency = { status: agencyRule.status, limit: agencyRule.limit, source: '基金公司公告', sourceUrl: agencyRule.sourceUrl, effectiveAt: agencyRule.effectiveAt };
  return {
    ...fund, agency: unknownQuota('首次同步尚未完成'), returns: { y1: null, y3: null, y5: null }, trend: [], trendDates: [], dailyChange: null,
    ...safe, direct, quotaNote: pending.length ? '新公告正在核验，直销额度尚不能确认；请查看公告原文。' : rule?.note || '直销额度尚未确认，请查看基金公司公告。', stale,
    sourceUrl: `https://fundf10.eastmoney.com/jjgg_${fund.code}.html`, pendingNoticeCount: pending.length, noticeCheckedAt: scan?.checkedAt || null,
  };
}
export function dashboard(store, mail) {
  const funds = catalog.map(f => currentFund(store, f));
  return { funds, changes: store.events(), meta: { mode: 'live', updatedAt: store.getMeta('marketUpdatedAt'), lastRun: store.getMeta('lastRun'), nextRunAt: nextDailyRun(new Date(), process.env.DAILY_SYNC_TIME || '07:30'), dailySyncTime: process.env.DAILY_SYNC_TIME || '07:30', timezone: 'Asia/Shanghai', mailConfigured: mail.configured, gildataConfigured: gildataConfigured(), reviewCount: store.notices(1000).filter(n => ['pending_review', 'fetch_error'].includes(n.state)).length, staleCount: funds.filter(f => f.stale).length, returnDates: [...new Set(funds.map(f => f.returnsAsOf).filter(Boolean))] } };
}
export function recordChanges(store, fund, before, after, source, onEvent = () => {}) {
  for (const channel of ['agency', 'direct']) {
    const type = classifyChange(before?.[channel], after[channel]);
    if (!type) continue;
    const event = {
      id: digest([fund.code, channel, source, JSON.stringify(before[channel]), JSON.stringify(after[channel])].join('|')),
      code: fund.code, name: `${fund.name} ${fund.share}`, channel: channel === 'agency' ? '代销' : '直销', channelKey: channel,
      before: quotaText(before[channel]), after: quotaText(after[channel]), beforeQuota: before[channel], afterQuota: after[channel],
      type, sourceUrl: after[channel].sourceUrl || `https://fundf10.eastmoney.com/jjgg_${fund.code}.html`,
      effectiveAt: after[channel].effectiveAt || after.observedAt, createdAt: new Date().toISOString(),
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
    };
    if (store.addEvent(event)) onEvent(event);
  }
}
async function mapLimit(items, concurrency, fn) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (index < items.length) { const i = index++; await fn(items[i], i); } }));
}
export async function syncNotices(store, fund, metrics, providers = { fetchNoticePage, fetchNoticeText }) {
  const lastScan = store.getMeta(`noticeScan:${fund.code}`);
  const backlog = store.getMeta(`noticeBacklog:${fund.code}`);
  const seed = baseline.find(r => r.code === fund.code);
  const lookback = backlog?.lookback || new Date(Math.min(Date.now() - 14 * 86400000, lastScan?.checkedAt ? Date.parse(lastScan.checkedAt) - 2 * 86400000 : Date.now())).toISOString().slice(0, 10);
  const scanStartedAt = backlog?.scanStartedAt || new Date().toISOString();
  // Recheck the head while resuming old pages with overlap: new publications can shift page boundaries.
  const firstRun = !lastScan;
  const maxPages = firstRun ? 5 : 3;
  const startPage = Math.max(2, backlog?.nextPage || 2);
  const pages = [1, ...Array.from({ length: maxPages - 1 }, (_, i) => startPage + i)];
  const processed = new Set();
  let stopped = false;
  let lastPage = 1;
  async function processNotice(notice) {
      if (processed.has(notice.id) || !isQuotaNotice(notice.title)) return;
      processed.add(notice.id);
      const titleShares = noticeShares(notice.title.replace(/\s/g, ''));
      if (titleShares.length && !titleShares.includes(fund.share)) { store.saveNotice({ ...notice, state: 'ignored', reason: '标题限定其他份额' }); return; }
      const existing = store.notice(notice.id, fund.code);
      if (seed && notice.publishedAt < seed.reviewedThrough) {
        store.saveNotice({ ...notice, state: 'baseline_covered', reason: '已由人工核验的现行规则覆盖', discoveredAt: new Date().toISOString() });
        return;
      }
      if (existing && existing.state !== 'fetch_error' && !(existing.state === 'pending_review' && existing.parserVersion !== 2)) return;
      if (!firstRun && notice.publishedAt < lookback && !existing) return;
      metrics.noticesDiscovered++;
      try {
        const text = await providers.fetchNoticeText(notice, store.directory);
        const parsed = parseQuotaNotice({ ...notice, text, share: fund.share });
        store.saveNotice({ ...notice, state: parsed.status, parserVersion: 2, reason: parsed.reason, rules: parsed.rules, textHash: digest(text), excerpt: text.slice(0, 3500), discoveredAt: new Date().toISOString() });
        for (const rule of parsed.rules) store.addRule({ ...rule, noticeId: notice.id, origin: 'automatic' });
        if (parsed.status === 'parsed') metrics.noticesParsed++;
        if (parsed.status === 'pending_review') metrics.pendingReview++;
      } catch {
        store.saveNotice({ ...notice, state: 'fetch_error', reason: '正文获取或解析失败，将在下次同步重试', discoveredAt: new Date().toISOString() });
        metrics.noticeErrors++;
      }
  }
  // Retry archived failures even after they fall outside the rolling list window.
  for (const notice of store.pendingNotices(fund.code).filter(n => n.state === 'fetch_error')) await processNotice(notice);
  for (const page of pages) {
    lastPage = page;
    const { notices, total } = await providers.fetchNoticePage(fund.code, page, 0);
    for (const notice of notices) await processNotice(notice);
    const oldest = notices.at(-1)?.publishedAt;
    if (!notices.length || total <= page * 50 || (seed && oldest < seed.reviewedThrough) || (!firstRun && oldest < lookback)) { stopped = true; break; }
  }
  if (stopped) store.setMeta(`noticeScan:${fund.code}`, { checkedAt: scanStartedAt, complete: true });
  if (!stopped) {
    metrics.noticeErrors++;
    store.setMeta(`noticeBacklog:${fund.code}`, { nextPage: lastPage, lookback, scanStartedAt, reason: '公告补抓尚未完成，下次从重叠分页继续', checkedAt: new Date().toISOString() });
  } else store.setMeta(`noticeBacklog:${fund.code}`, null);
}

export async function synchronize(store, mail, options = {}) {
  if (!store.acquireLease('synchronize')) return { skipped: true, reason: '已有同步任务运行' };
  const startedAt = new Date().toISOString();
  const metrics = { startedAt, status: 'running', marketSuccess: 0, marketErrors: 0, noticesDiscovered: 0, noticesParsed: 0, pendingReview: 0, noticeErrors: 0, errors: [] };
  store.setMeta('lastRun', metrics);
  const before = new Map(catalog.map(f => [f.code, store.getMeta(`published:${f.code}`) || currentFund(store, f)]));
  try {
    await mapLimit(catalog, 3, async fund => {
      if (!options.noticesOnly) {
        try {
          const snapshot = await fetchMarket(fund);
          if (gildataConfigured()) {
            try { Object.assign(snapshot, await fetchGildata(fund)); }
            catch { snapshot.marketError = '聚源请求失败，本次使用天天数据'; }
          }
          const dir = path.join(store.directory, 'market'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
          await fs.writeFile(path.join(dir, fund.code + '.json'), JSON.stringify(snapshot), { mode: 0o600 });
          store.saveSnapshot(snapshot); metrics.marketSuccess++;
        } catch { metrics.marketErrors++; metrics.errors.push({ code: fund.code, stage: 'market', message: '数据更新失败，保留上次成功值及其时间' }); }
      }
      try { await syncNotices(store, fund, metrics); }
      catch { metrics.noticeErrors++; metrics.errors.push({ code: fund.code, stage: 'notices', message: '公告列表更新失败，将重试' }); }
      store.setMeta('lastRun', { ...metrics });
    });
    for (const fund of catalog) {
      const after = currentFund(store, fund);
      // First observation creates a baseline, never a "quota increased" email storm.
      if (before.get(fund.code)?.observedAt) recordChanges(store, fund, before.get(fund.code), after, startedAt, event => mail.queueEvent(event));
      savePublishedBaseline(store, fund.code, after);
    }
    if (metrics.marketSuccess) store.setMeta('marketUpdatedAt', new Date().toISOString());
    metrics.status = metrics.marketErrors || metrics.noticeErrors ? 'partial' : 'success';
    metrics.finishedAt = new Date().toISOString();
    store.setMeta('lastRun', metrics);
    if (metrics.status === 'success' && !options.noticesOnly) store.setMeta('lastDailySuccess', chinaDate());
    store.setMeta('lastAttemptAt', metrics.finishedAt);
    await mail.deliver();
    return metrics;
  } catch { metrics.status = 'failed'; metrics.finishedAt = new Date().toISOString(); store.setMeta('lastRun', metrics); store.setMeta('lastAttemptAt', metrics.finishedAt); return metrics; }
  finally { store.releaseLease('synchronize'); }
}
function savePublishedBaseline(store, code, after) {
  const prior = store.getMeta(`published:${code}`);
  store.setMeta(`published:${code}`, { ...after, agency: after.agency.status === 'unknown' && prior?.agency ? prior.agency : after.agency, direct: after.direct.status === 'unknown' && prior?.direct ? prior.direct : after.direct });
}
export function applyScheduledRules(store, mail, now = new Date()) {
  if (store.db.prepare("SELECT expires FROM leases WHERE name='synchronize'").get()?.expires > Date.now()) return;
  for (const fund of catalog) {
    const before = store.getMeta(`published:${fund.code}`);
    const after = currentFund(store, fund, now);
    if (before?.observedAt) recordChanges(store, fund, before, after, after.direct.ruleId || chinaDate(now), event => mail.queueEvent(event));
    savePublishedBaseline(store, fund.code, after);
  }
}
export function startScheduler(store, mail) {
  const time = process.env.DAILY_SYNC_TIME || '07:30';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('DAILY_SYNC_TIME 必须为 HH:mm');
  let ticking = false;
  const tick = async () => {
    if (ticking) return; ticking = true;
    try {
      applyScheduledRules(store, mail);
      const now = new Date();
      const due = now >= new Date(`${chinaDate(now)}T${time}:00+08:00`) && store.getMeta('lastDailySuccess') !== chinaDate(now);
      const retryReady = !store.getMeta('lastAttemptAt') || +now - Date.parse(store.getMeta('lastAttemptAt')) > 15 * 60000;
      if ((due || !store.getMeta('marketUpdatedAt')) && retryReady) await synchronize(store, mail);
      else await mail.deliver();
    } finally { ticking = false; }
  };
  const timer = setInterval(() => tick().catch(() => {}), 60000);
  const startup = setTimeout(() => tick().catch(() => {}), 500);
  return () => { clearInterval(timer); clearTimeout(startup); };
}
