import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createApplication } from '../server/index.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-usage-smoke-'));
const runtime = await createApplication({ store: openStore(dir), startJobs: false, development: false });
const server = runtime.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const websiteId = '12345678-1234-1234-1234-123456789abc';
const trackerCode = process.env.UMAMI_TRACKER_FILE ? await fs.readFile(process.env.UMAMI_TRACKER_FILE, 'utf8') :
  `window.umami={track:callback=>fetch('https://gateway.umami.is/api/send',{method:'POST',body:JSON.stringify({type:'event',payload:callback({website:'${websiteId}'})})})};`;
const events = [], errors = [], localWrites = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith(base) && request.method() === 'POST') localWrites.push(request.url()); });
  await page.route('**/api/public-config', route => route.fulfill({ json: { umamiWebsiteId: websiteId } }));
  await page.route('https://cloud.umami.is/script.js', route => route.fulfill({ contentType: 'text/javascript', body: trackerCode }));
  await page.route('https://gateway.umami.is/api/send', async route => {
    events.push(route.request().postDataJSON().payload);
    await route.fulfill({ json: { cache: 'test-session' } });
  });
  const waitCount = async count => {
    for (let i = 0; i < 100 && events.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(events.length, count);
  };
  await page.goto(base, { waitUntil: 'networkidle' });
  await waitCount(1); assert.equal(events[0].url, '/');
  const nav = name => page.locator('.sidebar').getByRole('button', { name, exact: true });
  await nav('基金总览').click(); await waitCount(2);
  assert.equal(events.filter(e => !e.name).length, 1, 'active tab click must not add a PV');
  await page.getByRole('button', { name: /场内 ETF/ }).click(); await waitCount(3);
  await page.getByRole('tab', { name: /纳斯达克100/ }).click(); await waitCount(4);
  assert.deepEqual(events.slice(2).map(e => e.name), ['tab_venue_etf', 'tab_index_nasdaq']);
  await nav('额度动态').click(); await waitCount(6);
  assert.equal(events.at(-1).url, '/changes');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-nav').getByRole('button', { name: '基金总览', exact: true }).click(); await waitCount(8);
  assert.ok(events.every(e => !e.data || Object.keys(e.data).every(k => ['group', 'tab'].includes(k))));
  assert.deepEqual(localWrites, []);
  assert.deepEqual(errors, []);
  assert.equal(runtime.store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='usage_events'").get().n, 0);
  // Public data remains usable when statistics are blocked.
  await page.route('https://cloud.umami.is/script.js', route => route.abort());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.mobile-nav').getByRole('button', { name: '额度动态', exact: true }).click();
  await page.getByRole('heading', {name:'额度动态',exact:true}).waitFor();
  assert.equal(events.length, 8);
  // No ID: do not even load the third-party script.
  await page.route('**/api/public-config', route => route.fulfill({ json: { umamiWebsiteId: null } }));
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('script[data-website-id]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Usage smoke passed: PV, desktop/mobile tabs, blocked/disabled tracker, no local event storage.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
  await fs.rm(dir, { recursive: true, force: true });
}
