// Read-only browser QA: safe to run against an instance with real email configured.
import assert from 'node:assert/strict';
import {totalQuota,totalHistoricalQuota} from '../src/summary.mjs';
import {groupFunds, selectFundGroups, sortGroupMembers} from '../src/fund-groups.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:4387';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
const errors = [], writes = [], checks = [], subscriptionRequests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); if (new URL(r.url()).pathname.startsWith('/api/subscriptions')) subscriptionRequests.push(r.url()); });
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.fund-group').first().waitFor();
  const expandGroups = async () => { for(const button of await page.locator('.fund-group-toggle').all()) if(await button.getAttribute('aria-expanded')==='false') await button.click(); };
  await expandGroups();
  await page.locator('.quota-overview-toggle').click();
  const data = await (await page.request.get(base + '/api/dashboard')).json();
  check('API supplies a 30-day window', data.meta.changesWindow?.days === 30);
  const otcFunds = data.funds.filter(f => f.venue !== 'etf');
  check('All live OTC shares render', await page.locator('tbody tr').count() === otcFunds.length && data.meta.mode === 'live');
  for (const field of ['agency', 'direct']) {
    const total = totalQuota(otcFunds,field).amount;
    check(field + ' total uses all current known quotas', (await page.locator(`[data-channel-summary="${field}"] [data-current-amount]`).innerText()).includes(new Intl.NumberFormat('zh-CN').format(total)));
    for (const index of ['nasdaq','sp500']) {
      const amount=totalQuota(otcFunds.filter(f=>f.index===index),field).amount;
      check(field+' '+index+' subtotal is correct', (await page.locator(`[data-quota-index="${index}"] [data-index-channel="${field}"]`).innerText()).includes(new Intl.NumberFormat('zh-CN').format(amount)));
    }
    for (const direction of ['asc', 'desc']) {
      const sort = field + ':' + direction;
      await page.getByLabel('排序方式').selectOption(sort);
      const expected = selectFundGroups(groupFunds(otcFunds), {sort}).flatMap(g=>sortGroupMembers(g.members,sort)).map(f=>f.code);
      assert.deepEqual(await page.locator('.otc-table tbody tr').evaluateAll(rows=>rows.map(row=>row.dataset.fundCode)),expected);
      check(field + ' ' + direction + ' sorts groups then shares',true);
    }
  }
  for(const channel of ['agency','direct']) {
    const historical=totalHistoricalQuota(otcFunds,channel),current=totalQuota(otcFunds,channel);
    check(channel+' history uses dated scope totals',(await page.locator(`[data-history-summary="${channel}"] strong`).innerText())===`¥${new Intl.NumberFormat('zh-CN').format(historical.amount)}`);
    check(channel+' forecast uses deduplicated current quota',(await page.locator(`[data-forecast-summary="${channel}"] strong`).innerText())===`¥${new Intl.NumberFormat('zh-CN').format(current.amount*20)}`);
  }
  check('Wanjia A/C sharing is visible',await page.locator('tr[data-fund-code="019441"] [data-scope-mode="shared"]').count()===2);
  check('Southern share independence is visible',await page.locator('tr[data-fund-code="016452"] [data-scope-mode="independent"]').count()===2);
  check('Dacheng defaults to independent shares',await page.locator('tr[data-fund-code="000834"] [data-scope-mode="independent"]').count()===2);
  check('Paused shares hide scope badges',await page.locator('tr[data-fund-code="270042"] [data-scope-mode]').count()===0);
  await page.locator('tr[data-fund-code="019441"] .fund-identity').click();
  await page.locator('.scope-evidence summary').click();
  check('Shared members and source are accessible',(await page.locator('.scope-evidence').innerText()).includes('019442') && await page.locator('.scope-evidence a').count()===2);
  await page.keyboard.press('Escape');
  await fs.mkdir('outputs/visual-refresh', { recursive: true });
  await page.screenshot({ path: 'outputs/visual-refresh/desktop.png' });
  await page.locator('.quota-changes-notice').click();
  check('Historical changes are visible with announcement links', await page.locator('.change-row').count() === data.changes.length && await page.locator('.change-source').count() === data.changes.filter(c=>c.sourceUrl).length);
  await page.screenshot({path:'outputs/visual-refresh/changes.png'});
  await page.locator('.sidebar .nav-link').first().click();
  await expandGroups();
  await page.locator('tbody tr[data-fund-code="000834"] .fund-identity').click();
  check('Fund detail chart opens', await page.locator('dialog .trend-large svg').isVisible());
  await page.locator('dialog .history-evidence summary').click();
  check('Historical evidence can be inspected', await page.locator('dialog .history-segment a').count() > 0 && (await page.locator('dialog .history-evidence').innerText()).includes(otcFunds.find(f=>f.code==='000834').stability.startDate));
  check('Observed and inferred days are distinguished', (await page.locator('dialog .stability-pair').innerText()).includes(`公告推算 ${otcFunds.find(f=>f.code==='000834').stability.direct.inferredDays} 日`));
  await page.screenshot({ path: 'outputs/visual-refresh/history-evidence.png' });
  await page.locator('dialog .history-evidence summary').click();
  await page.screenshot({ path: 'outputs/visual-refresh/detail.png' });
  await page.keyboard.press('Escape');
  check('Only one OTC comparison view remains', await page.locator('.metric-tabs').count()===0 && await page.locator('.stability-table').count()===0);
  await page.getByLabel('排序方式').selectOption('agencyHistory:desc');
  check('Unified table includes 20-session history for all OTC shares', await page.locator('.otc-table tbody tr').count() === otcFunds.length);
  const south=otcFunds.find(f=>f.code==='021000');
  check('Southern I reconstructed history has the correct 20-session quota', south.stability.windowDays===20 && south.stability.direct.total===4000 && south.stability.direct.openDays===20);
  check('Southern I row shows reconstructed total', (await page.locator('.otc-table tr[data-fund-code="021000"]').innerText()).includes('4,000'));

  const expectedHistory = selectFundGroups(groupFunds(otcFunds),{sort:'agencyHistory:desc'})[0];
  check('History sorts groups by coverage before known amount', await page.locator('.fund-group').first().getAttribute('data-group-codes') === expectedHistory.id);
  check('Table history shows amount and open days without coverage labels', await page.locator('.otc-table').first().innerText().then(t=>t.includes('近20个交易日开放') && !t.includes('/20 日') && !t.includes('已知累计') && !t.includes('完整累计')));
  check('Returns and historical quotas are in the same row', await page.locator('.otc-table tbody tr').first().locator('[data-history-channel]').count()===2 && await page.locator('.otc-table tbody tr').first().locator('.return-cell').count()===3);
  await page.screenshot({path:'outputs/visual-refresh/stability-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  check('Mobile funds default to collapsed quotas only', await page.locator('.mobile-fund-toggle[aria-expanded="false"]').count()===otcFunds.length && await page.locator('.mobile-fund .mobile-returns').count()===0);
  await page.locator('.mobile-fund-toggle').first().click();
  check('Mobile expansion shows history, returns and a large chart', await page.locator('.mobile-fund .mobile-history').first().isVisible() && await page.locator('.mobile-fund .mobile-returns').first().isVisible() && (await page.locator('.mobile-expanded-chart svg').first().boundingBox()).height>120);
  check('Latest daily change is labelled separately', (await page.locator('.mobile-chart-heading').first().innerText()).includes('最新日涨跌'));
  await page.locator('.mobile-fund-toggle').first().click();
  check('Mobile cards collapse again', await page.locator('.mobile-fund .mobile-returns').count()===0);
  await page.locator('.mobile-fund-toggle').first().focus();await page.keyboard.press('Enter');
  check('Keyboard opens the accordion', await page.locator('.mobile-fund-toggle').first().getAttribute('aria-expanded')==='true');
  await page.screenshot({path:'outputs/visual-refresh/stability-mobile.png'});
  await page.setViewportSize({width:1440,height:1080});
  await page.getByLabel('排序方式').selectOption('direct:desc');
  check('Launch navigation contains only on-site tools', await page.locator('.sidebar .nav-link').count() === 3 && await page.locator('.mobile-nav button').count() === 3);
  check('Notification entry points and table column are absent', await page.locator('.heading-cta, .sidebar-tip, .row-bell, .mobile-alert, .action-heading, col.action-col, .alerts-panel').count() === 0);
  await page.locator('tbody tr[data-fund-code="000834"] .fund-identity').click();
  check('Fund details do not advertise notifications', !(await page.locator('dialog').innerText()).includes('关注这只基金的额度'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '数据说明', exact: true }).click();
  check('Data explanation does not advertise email subscriptions', !(await page.locator('dialog').innerText()).includes('邮箱提醒'));
  await page.keyboard.press('Escape');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    check('No overflow at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  check('Compact 30-day notice visible on mobile', await page.locator('.quota-changes-notice').isVisible());
  check('Mobile cards visible', await page.locator('.mobile-fund').first().isVisible());
  await page.screenshot({ path: 'outputs/visual-refresh/mobile.png' });
  if(await page.locator('.mobile-fund-toggle').first().getAttribute('aria-expanded')!=='true') await page.locator('.mobile-fund-toggle').first().click();
  await page.locator('.mobile-detail-link').first().click();
  check('Mobile fund details fit screen', await page.evaluate(() => { const r = document.querySelector('dialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^场内 ETF/ }).click();
  const etfs = data.funds.filter(f => f.venue === 'etf');
  check('All exchange ETFs render separately', await page.locator('.etf-table tbody tr').count() === etfs.length && await page.locator('.etf-card').count() === 0);
  check('ETF tab has no misleading quota filter', await page.getByText('只看可申购', { exact: true }).count() === 0);
  check('ETF tab has no subscription quota sorting', await page.getByLabel('排序方式').locator('option[value="direct:desc"]').count() === 0);
  for (const direction of ['asc','desc']) {
    await page.getByLabel('排序方式').selectOption('premium:' + direction);
    const expected = etfs.filter(f=>f.quote?.premium != null).sort((a,b)=>(direction === 'asc' ? a.quote.premium-b.quote.premium : b.quote.premium-a.quote.premium) || a.code.localeCompare(b.code));
    check('ETF premium ' + direction + ' sort matches real API', await page.locator('.etf-table tbody tr').first().getAttribute('data-fund-code') === expected[0].code);
  }
  await page.getByLabel('排序方式').selectOption('premium:asc');
  await page.locator('.mobile-etf-detail').first().click();
  check('ETF detail explains trading without quota alerts', await page.locator('dialog .detail-quotas').count() === 0 && await page.getByRole('button', { name: '关注这只基金的额度' }).count() === 0);
  await page.keyboard.press('Escape');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check('ETF no overflow at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if ([1440,390].includes(width)) await page.screenshot({path: `outputs/visual-refresh/etf-${width}.png`});
  }
  // Supplier failures with a usable fallback must stay invisible; genuinely missing data remains visible.
  const usableFunds = data.funds.map(f=>({...f,stale:false,dataIssues:[],marketError:'聚源请求或校验失败，本次使用天天数据'}));
  await page.route('**/api/dashboard', route=>route.fulfill({json:{...data,funds:usableFunds,meta:{...data.meta,staleCount:0,analytics:{status:'partial'},lastRun:{status:'partial',gildataErrors:1}}}}));
  await page.reload({waitUntil:'networkidle'});
  check('Successful fallback does not show a supplier error banner', await page.locator('main > .live-status').count()===0 && !(await page.locator('body').innerText()).includes('部分来源更新失败'));
  await page.unroute('**/api/dashboard');
  await page.route('**/api/dashboard', route=>route.fulfill({json:{...data,funds:usableFunds.map(f=>f.code==='000834'?{...f,stale:true,dataIssues:['代销额度待更新']}:f),meta:{...data.meta,staleCount:1,lastRun:{status:'success'}}}}));
  await page.reload({waitUntil:'networkidle'});
  check('A genuine stale field is still explained to users', (await page.locator('.data-issues').innerText()).includes('000834') && (await page.locator('.data-issues').innerText()).includes('代销额度待更新') && !(await page.locator('body').innerText()).includes('只基金有部分数据待更新'));
  await page.unroute('**/api/dashboard');
  // Browser-only fixture exercises nonempty changes without writing fake events to the server.
  const sample = {id:'browser-fixture',code:'000834',name:'测试基金 A',channel:'直销',type:'increase',before:'¥10',after:'¥100',beforeQuota:{status:'open',limit:10},afterQuota:{status:'open',limit:100},createdAt:new Date().toISOString()};
  await page.route('**/api/dashboard', route=>route.fulfill({json:{...data,changes:[sample]}}));
  await page.reload({waitUntil:'networkidle'});
  check('Compact notice shows the live change count', (await page.locator('.changes-notice-text').innerText()).includes('1 条额度动态') && await page.locator('.quota-index-card').count()===2);
  await page.locator('.quota-changes-notice').click();
  check('Change details show per-day increase', (await page.locator('.change-delta').innerText()).includes('+¥90 / 日'));
  check('Seven-day changes detail has no horizontal overflow', await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.unroute('**/api/dashboard');
  await page.route('**/api/dashboard', route=>route.fulfill({json:{...data,changes:[],meta:{...data.meta,changesCoverage:{complete:false,pendingCount:0}}}}));
  await page.reload({waitUntil:'networkidle'});
  check('Missing history never displays zero changes', !(await page.locator('.quota-changes-notice').innerText()).includes('0 条') && (await page.locator('.quota-changes-notice').innerText()).includes('历史待核验'));
  await page.unroute('**/api/dashboard');
  if (errors.length) console.error(JSON.stringify({ browserErrors: errors }));
  check('No runtime errors', errors.length === 0);
  check('No subscription requests while notifications are hidden', subscriptionRequests.length === 0);
  check('No writes or emails triggered', writes.length === 0);
  const report = { passed: checks.length, checks, errors, writes };
  await fs.writeFile('outputs/visual-refresh/qa.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
