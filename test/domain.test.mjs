import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agencyQuota, classifyChange, parseQuotaNotice, noticeShares, nextDailyRun } from '../server/domain.mjs';
import { openStore } from '../server/store.mjs';
import { applyScheduledRules, currentFund } from '../server/service.mjs';

test('暂停状态优先于残留上限；缺失和哨兵值不能当无限额', () => {
  assert.equal(agencyQuota({ SGZT: '暂停申购', MAXSG: '10', BUY: false }).status, 'paused');
  assert.equal(agencyQuota({ SGZT: '限大额', MAXSG: '--', BUY: false }).status, 'unavailable');
  assert.equal(agencyQuota({ SGZT: '开放申购', MAXSG: '100000000000', BUY: true }).status, 'unknown');
  assert.equal(agencyQuota({ SGZT: '限大额', MAXSG: '10', BUY: true }).limit, 10);
});
test('未知变已知与渠道不销售不能冒充恢复；真正变化正确分类', () => {
  assert.equal(classifyChange({ status: 'unknown' }, { status: 'open', limit: 10 }), null);
  assert.equal(classifyChange({ status: 'unavailable' }, { status: 'open', limit: 10 }), null);
  assert.equal(classifyChange({ status: 'paused' }, { status: 'open', limit: 10 }), 'resume');
  assert.equal(classifyChange({ status: 'open', limit: 10 }, { status: 'open', limit: 5 }), 'decrease');
});
test('标题份额识别不会把 A、C 两类遗漏，也不会把ETF字母当份额', () => {
  assert.deepEqual(noticeShares('标普500ETF联接基金A、C两类份额暂停申购'), ['A', 'C']);
  assert.deepEqual(noticeShares('标普500ETF联接基金E类份额暂停申购'), ['E']);
});
const context = { code: '000834', share: 'A', publishedAt: '2026-06-03', sourceUrl: 'https://example.test/notice.pdf' };
test('明确的直销100与代销10能分别提取，使用生效日而非公告日', () => {
  const result = parseQuotaNotice({ ...context, title: '关于调整大额申购业务的公告', text: '基金代码 000834 008971。公告送出日期2026年6月3日。调整大额申购起始日2026年6月4日。其他需要提示的事项：自2026年6月4日起，投资人通过本公司直销渠道（包含APP、直销柜台）申购本基金A类或C类份额，单日单个基金账户累计金额应不超过100元人民币。通过各代销机构申购本基金A类或C类份额，单日单个基金账户累计金额不超过10元人民币。基金赎回业务正常办理。' });
  assert.equal(result.status, 'parsed');
  assert.equal(result.rules.find(r => r.channel === 'direct').limit, 100);
  assert.equal(result.rules.find(r => r.channel === 'agency').limit, 10);
  assert.equal(result.rules[0].effectiveAt, '2026-06-04T00:00:00+08:00');
});
test('实际招商暂停公告可以自动解析，不能被“是否”误判为否', () => {
  const text = readFileSync('test/fixtures/2026-10-14-cmb-pause.txt', 'utf8');
  const result = parseQuotaNotice({ ...context, code: '019547', title: '关于暂停招商纳斯达克100申购（含定期定额投资）业务的公告', text });
  assert.equal(result.status, 'parsed');
  assert.equal(result.rules.length, 2);
  assert.equal(result.rules[0].status, 'paused');
});
test('复杂或无法确定的规则进入核验，不能按标题猜上限', () => {
  assert.equal(parseQuotaNotice({ ...context, title: '调整大额申购的公告', text: '短正文' }).status, 'pending_review');
  const t = '基金代码 000834；自2026年6月4日起对个人投资者单日金额调整为10元，非个人投资者调整为500元。'.repeat(3);
  assert.equal(parseQuotaNotice({ ...context, title: '调整大额申购的公告', text: t }).status, 'pending_review');
});
test('次日生效的规则不会提前生效；生效后仅产生一次提醒事件', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'radar-rules-')); const store = openStore(dir);
  const fund = { code: '000834', name: '大成纳斯达克100', share: 'A' };
  try {
    store.saveSnapshot({ ...fund, agency: { status: 'open', limit: 10 }, observedAt: '2026-10-14T10:00:00Z' });
    store.addRule({ code: fund.code, channel: 'direct', effectiveAt: '2026-10-01T00:00:00+08:00', status: 'open', limit: 100, sourceUrl: 'old' });
    store.addRule({ code: fund.code, channel: 'direct', effectiveAt: '2026-10-16T00:00:00+08:00', status: 'paused', limit: null, sourceUrl: 'new' });
    const before = currentFund(store, fund, new Date('2026-10-15T23:59:00+08:00'));
    assert.equal(before.direct.limit, 100);
    store.setMeta(`published:${fund.code}`, before);
    let mails = 0;
    applyScheduledRules(store, { queueEvent: () => mails++ }, new Date('2026-10-16T00:01:00+08:00'));
    applyScheduledRules(store, { queueEvent: () => mails++ }, new Date('2026-10-16T00:02:00+08:00'));
    assert.equal(mails, 1);
    assert.equal(store.events().length, 1);
    assert.equal(store.events()[0].type, 'pause');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('每天07:30按上海时区计算，不依赖服务器时区', () => {
  assert.equal(nextDailyRun(new Date('2026-10-15T06:00:00+08:00')), '2026-10-14T23:30:00.000Z');
  assert.equal(nextDailyRun(new Date('2026-10-15T08:00:00+08:00')), '2026-10-15T23:30:00.000Z');
});

test('待核验暂时隐藏额度，但人工确认后仍与此前确认值比较；未来代销规则按时生效', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'radar-pending-')); const store = openStore(dir);
  const fund = { code: '000834', name: '大成纳斯达克100', share: 'A' };
  const now = new Date('2026-10-17T08:00:00+08:00');
  try {
    store.saveSnapshot({ ...fund, agency: { status: 'open', limit: 10 }, observedAt: '2026-10-16T10:00:00Z' });
    store.setMeta('noticeScan:000834', { checkedAt: '2026-10-16T10:00:00Z' });
    store.addRule({ code: fund.code, channel: 'direct', effectiveAt: '2026-10-01T00:00:00+08:00', status: 'open', limit: 100, sourceUrl: 'old', publishedAt: '2026-10-01' });
    store.setMeta(`published:${fund.code}`, currentFund(store, fund, now));
    store.saveNotice({ id: 'new', code: fund.code, publishedAt: '2026-10-17', state: 'pending_review' });
    let mails = 0; const mail = { queueEvent: () => mails++ };
    applyScheduledRules(store, mail, now);
    assert.equal(currentFund(store, fund, now).direct.status, 'unknown');
    assert.equal(store.getMeta(`published:${fund.code}`).direct.limit, 100);
    assert.equal(mails, 0);
    store.saveNotice({ id: 'new', code: fund.code, publishedAt: '2026-10-17', state: 'reviewed' });
    store.addRule({ code: fund.code, channel: 'direct', effectiveAt: '2026-10-17T00:00:00+08:00', status: 'open', limit: 200, sourceUrl: 'new', publishedAt: '2026-10-17' });
    store.addRule({ code: fund.code, channel: 'agency', effectiveAt: '2026-10-17T00:00:00+08:00', status: 'paused', limit: null, sourceUrl: 'new', publishedAt: '2026-10-17' });
    assert.equal(currentFund(store, fund, now).agency.status, 'paused');
    applyScheduledRules(store, mail, now); applyScheduledRules(store, mail, now);
    assert.equal(mails, 2);
    assert.equal(currentFund(store, fund, now).stale, false);
    assert.equal(currentFund(store, fund, new Date('2026-10-20T08:00:00+08:00')).stale, true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('公告分页到上限后保存游标，重查首页并继续；滚出窗口的失败正文仍重试', async () => {
  const { syncNotices } = await import('../server/service.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'radar-pages-')); const store = openStore(dir);
  const fund = { code: '999999', share: 'A' }; const pages = [];
  const metrics = { noticesDiscovered: 0, noticesParsed: 0, pendingReview: 0, noticeErrors: 0 };
  const providers = {
    fetchNoticePage: async (code, page) => { pages.push(page); return { total: 350, notices: [{ id: `AN${page}`, code, title: '季度报告', publishedAt: '2099-01-01' }] }; },
    fetchNoticeText: async () => { throw new Error('should not fetch'); },
  };
  try {
    await syncNotices(store, fund, metrics, providers);
    assert.deepEqual(pages, [1, 2, 3, 4, 5]);
    assert.equal(store.getMeta('noticeBacklog:999999').nextPage, 5);
    assert.equal(store.getMeta('noticeScan:999999'), null);
    pages.length = 0;
    await syncNotices(store, fund, metrics, providers);
    assert.deepEqual(pages, [1, 5, 6, 7]);
    assert.equal(store.getMeta('noticeBacklog:999999'), null);
    assert.ok(store.getMeta('noticeScan:999999').complete);
    store.saveNotice({ id: 'ANold', code: fund.code, title: '暂停申购公告', publishedAt: '2020-01-01', state: 'fetch_error' });
    let retried = 0;
    await syncNotices(store, fund, metrics, {
      fetchNoticePage: async () => ({ notices: [], total: 0 }),
      fetchNoticeText: async () => { retried++; return '扫描版正文不足'; },
    });
    assert.equal(retried, 1);
    assert.equal(store.notice('ANold', fund.code).state, 'pending_review');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('日增长率缺失时不插值造走势，只保留最近连续净值窗口', async () => {
  const { buildNavTrend } = await import('../server/domain.mjs');
  const result = buildNavTrend([{ FSRQ: '2026-10-10', JZZZL: '1' }, { FSRQ: '2026-10-11', JZZZL: '--' }, { FSRQ: '2026-10-12', JZZZL: '2' }, { FSRQ: '2026-10-13', JZZZL: '-1' }]);
  assert.deepEqual(result.trend, [100, 102, 100.98]);
  assert.deepEqual(result.trendDates, ['2026-10-11', '2026-10-12', '2026-10-13']);
  assert.ok(result.trendNote);
});
