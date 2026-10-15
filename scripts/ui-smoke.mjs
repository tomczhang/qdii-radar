// Read-only browser QA: safe to run against an instance with real email configured.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:4387';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
const errors = [], writes = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('tbody tr').first().waitFor();
  const data = await (await page.request.get(base + '/api/dashboard')).json();
  check('All live funds render', await page.locator('tbody tr').count() === data.funds.length && data.meta.mode === 'live');
  for (const field of ['agency', 'direct']) {
    await page.getByLabel('排序方式').selectOption(field + ':desc');
    const expected = data.funds.filter(f => f[field].status === 'open').sort((a,b) => b[field].limit-a[field].limit || a.code.localeCompare(b.code))[0]?.code;
    check(field + ' sorting matches API', await page.locator('tbody tr').first().getAttribute('data-fund-code') === expected);
  }
  await fs.mkdir('outputs/visual-refresh', { recursive: true });
  await page.screenshot({ path: 'outputs/visual-refresh/desktop.png' });
  await page.locator('tbody tr[data-fund-code="000834"] .fund-identity').click();
  check('Fund detail chart opens', await page.locator('dialog .trend-large svg').isVisible());
  await page.screenshot({ path: 'outputs/visual-refresh/detail.png' });
  await page.keyboard.press('Escape');
  await page.locator('.heading-cta').click();
  check('Email form opens without sending', await page.getByLabel('接收邮箱').isVisible());
  await page.screenshot({ path: 'outputs/visual-refresh/email.png' });
  await page.keyboard.press('Escape');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    check('No overflow at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  check('Mobile cards visible', await page.locator('.mobile-fund').first().isVisible());
  await page.screenshot({ path: 'outputs/visual-refresh/mobile.png' });
  await page.locator('.mobile-fund').first().getByRole('button', { name: '额度提醒', exact: true }).click();
  check('Mobile email dialog fits screen', await page.evaluate(() => { const r = document.querySelector('dialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
  await page.keyboard.press('Escape');
  check('No runtime errors', errors.length === 0);
  check('No writes or emails triggered', writes.length === 0);
  const report = { passed: checks.length, checks, errors, writes };
  await fs.writeFile('outputs/visual-refresh/qa.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
