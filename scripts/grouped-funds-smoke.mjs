import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {groupFunds,selectFundGroups} from '../src/fund-groups.mjs';
import {totalQuota} from '../src/summary.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/Users/tomczhang/.codex/skills/personal-homepage-skill/node_modules/playwright');
const base=process.env.TEST_BASE_URL || 'http://localhost:4388';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir('outputs/visual-refresh',{recursive:true});
try {
 await page.goto(base);await page.locator('.fund-group').first().waitFor();
 const data=await (await page.request.get(base+'/api/dashboard')).json(),groups=groupFunds(data.funds);
 assert.equal(await page.locator('.fund-group').count(),groups.length);
 assert.equal(groups.reduce((n,g)=>n+(g.total.amount||0),0),totalQuota(data.funds,'both').amount);
 const southern=page.locator('[data-group-codes="016452-016453"]');
 assert.match(await southern.innerText(),/¥20/);assert.match(await southern.innerText(),/份额独立/);
 assert.equal(await page.locator('[data-group-codes="021000"]').count(),1);
 const huatai=page.locator('[data-group-codes="019524-019525-022664"]');
 assert.match(await huatai.innerText(),/¥5/);assert.match(await huatai.innerText(),/A\/C\/I共享/);
 const summary=page.locator('.channel-filter > summary');
 const totalBefore=await page.locator('[data-quota-summary="both"] .summary-number').innerText();
 assert.equal(await page.locator('option[value^="channelScope:"]').count(),0);
 assert.equal(await page.locator('.group-share-heading button').count(),0);
 await summary.click();
 await page.getByRole('checkbox',{name:'直销',exact:true}).check();
 assert.deepEqual(await page.locator('.fund-group').evaluateAll(ns=>ns.map(n=>n.dataset.groupCodes)),selectFundGroups(groups,{channels:['direct']}).map(g=>g.id));
 await page.getByRole('checkbox',{name:'代销',exact:true}).check();
 assert.deepEqual(await page.locator('.fund-group').evaluateAll(ns=>ns.map(n=>n.dataset.groupCodes)),selectFundGroups(groups,{channels:['direct','agency']}).map(g=>g.id));
 assert.equal(await page.locator('[data-quota-summary="both"] .summary-number').innerText(),totalBefore);
 await page.getByRole('checkbox',{name:'直销',exact:true}).uncheck();
 assert.deepEqual(await page.locator('.fund-group').evaluateAll(ns=>ns.map(n=>n.dataset.groupCodes)),selectFundGroups(groups,{channels:['agency']}).map(g=>g.id));
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();
 await page.locator('.fund-board').scrollIntoViewIfNeeded();
 await page.screenshot({path:'outputs/visual-refresh/channel-filter-desktop.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('.channel-filter').getAttribute('open'),null);
 await summary.press('Enter');await page.getByRole('textbox',{name:'搜索基金名称或代码'}).click();
 assert.equal(await page.locator('.channel-filter').getAttribute('open'),null);
 await page.locator('.fund-board').scrollIntoViewIfNeeded();
 await page.screenshot({path:'outputs/visual-refresh/grouped-desktop.png'});
 await page.getByRole('textbox',{name:'搜索基金名称或代码'}).fill('019524');
 assert.equal(await page.locator('.fund-group').count(),1);
 await huatai.locator('.fund-group-toggle').focus();await page.keyboard.press('Enter');
 assert.equal(await huatai.locator('.otc-table tbody tr').count(),3);
 await huatai.locator('.otc-table .fee-detail-button').first().click();
 await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/查看渠道额度依据/);
 await page.getByRole('button',{name:'关闭弹窗'}).click();
 await huatai.locator('.otc-table .favorite-button').first().click();
 assert.equal(await huatai.locator('.otc-table .favorite-button').first().getAttribute('aria-pressed'),'true');
 await page.getByRole('textbox',{name:'搜索基金名称或代码'}).fill('');
 for(const sort of ['combined:asc','annualFee:asc','agencyFee:desc','y1:desc','agencyHistory:desc']) {
  await page.getByRole('combobox',{name:'排序方式'}).selectOption(sort);
  assert.deepEqual(await page.locator('.fund-group').evaluateAll(nodes=>nodes.map(n=>n.dataset.groupCodes)),selectFundGroups(groups,{sort}).map(g=>g.id));
 }
 await page.getByRole('textbox',{name:'搜索基金名称或代码'}).fill('019524');
 await page.locator('.fund-board').scrollIntoViewIfNeeded();await page.screenshot({path:'outputs/visual-refresh/grouped-expanded-desktop.png'});
 await page.getByRole('textbox',{name:'搜索基金名称或代码'}).fill('没有此基金');assert.equal(await page.locator('.empty-state').count(),1);
 await page.getByRole('button',{name:'重置筛选'}).click();
 await page.getByRole('button',{name:/场内 ETF/}).click();await page.locator('.etf-table tbody tr').first().waitFor();
 await page.getByRole('button',{name:/场外申购/}).click();
 for(const width of [1024,768,390,360]) {
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no page overflow at ${width}`);
  if(width<=390) {
   await summary.click();assert.ok(await page.getByRole('checkbox',{name:'直销',exact:true}).isVisible());
   await page.locator('.fund-board').scrollIntoViewIfNeeded();
   if(width===390)await page.screenshot({path:'outputs/visual-refresh/channel-filter-mobile.png'});
   await page.keyboard.press('Escape');
   await page.getByRole('textbox',{name:'搜索基金名称或代码'}).fill('南方');
   await southern.locator('.fund-group-toggle').click();
   assert.equal(await southern.locator('.mobile-fund').count(),2);
   await southern.locator('.mobile-fund-toggle').first().click();
   await page.locator('.fund-board').scrollIntoViewIfNeeded();
   if(width===390)await page.screenshot({path:'outputs/visual-refresh/grouped-mobile.png',fullPage:true});
   await southern.locator('.mobile-detail-link').first().click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'关闭弹窗'}).click();
   await southern.locator('.fund-group-toggle').click();
  }
 }
 assert.deepEqual(errors,[]);console.log(`Grouped UI passed: ${groups.length} groups; deduplication, search, sorting, keyboard, fees, favorites, ETF, mobile, no errors.`);
} finally {await browser.close();}
