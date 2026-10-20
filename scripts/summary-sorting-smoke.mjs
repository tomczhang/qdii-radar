import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {totalQuota,totalHistoricalQuota} from '../src/summary.mjs';
import {groupFunds,selectFundGroups,sortGroupMembers} from '../src/fund-groups.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE_URL||'http://localhost:4387';
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],writes=[],check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
const money=n=>new Intl.NumberFormat('zh-CN').format(n);
await fs.mkdir('outputs/visual-refresh',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1080}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 const data=await(await page.request.get(base+'/api/dashboard')).json(),funds=data.funds.filter(f=>f.venue!=='etf');
 await page.goto(base,{waitUntil:'networkidle'});
 await page.getByRole('switch',{name:'剔除10元及以下额度'}).click();
 await page.locator('.quota-overview-toggle').click();
 for(const button of await page.locator('.fund-group-toggle').all())await button.click();
 const total=totalQuota(funds,'both'),history=totalHistoricalQuota(funds,'both');
 check('Current combined capacity is distinct from adding channel subtotals',total.amount<totalQuota(funds,'direct').amount+totalQuota(funds,'agency').amount);
 check('Combined summary uses both-channel capacity',(await page.locator('[data-quota-summary="both"] [data-current-amount]').innerText()).includes(money(total.amount)));
 check('Combined history shows dated scope total',(await page.locator('[data-history-summary="both"] strong').innerText())===`¥${money(history.amount)}`);
 check('Combined forecast uses new capacity times 20',(await page.locator('[data-forecast-summary="both"]').innerText()).includes(money(total.amount*20)));
 check('Summary explanation text is removed',await page.locator('.summary-definition, .quota-total-foot, .summary-period > small, #small-quota-note').count()===0);
 for(const key of ['annualFee','agencyFee'])for(const direction of ['asc','desc']) {
   await page.getByLabel('排序方式').selectOption(`${key}:${direction}`);
   const codes=await page.locator('.otc-table tbody tr').evaluateAll(rows=>rows.map(r=>r.dataset.fundCode));
   const expected=selectFundGroups(groupFunds(funds),{sort:`${key}:${direction}`}).flatMap(g=>sortGroupMembers(g.members,`${key}:${direction}`)).map(f=>f.code);
   check(key+' '+direction+' matches numeric/category ordering',JSON.stringify(codes)===JSON.stringify(expected));
 }
 await page.locator('.fee-heading').first().getByRole('button',{name:'年度费率',exact:true}).click();
 check('Annual fee header defaults to ascending',await page.getByLabel('排序方式').inputValue()==='annualFee:asc');
 await page.locator('.fee-heading').first().getByRole('button',{name:'年度费率',exact:true}).click();
 check('Annual fee header toggles descending',await page.locator('.fee-heading').first().getAttribute('aria-sort')==='descending');
 await page.getByRole('button',{name:'按代销申购费率排序',exact:true}).first().click();
 check('Subscription fee header sorts independently',await page.getByLabel('排序方式').inputValue()==='agencyFee:asc');
 check('Channel relation no longer has a sort control',await page.locator('.channel-heading button').count()===0);
 check('Fee and channel cells are horizontally and vertically centred',await page.locator('.otc-table tbody tr').first().evaluate(row=>['.fee-cell','.channel-cell'].every(selector=>{const cell=row.querySelector(selector),button=cell.querySelector('button'),c=cell.getBoundingClientRect(),b=button.getBoundingClientRect(),style=getComputedStyle(cell);return style.textAlign==='center'&&style.verticalAlign==='middle'&&Math.abs((c.left+c.right-b.left-b.right)/2)<1;})));
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'outputs/visual-refresh/combined-summary-desktop.png'});
 await page.locator('.fee-heading').first().scrollIntoViewIfNeeded();await page.screenshot({path:'outputs/visual-refresh/fee-channel-sort.png'});
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});check('Combined overview fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'outputs/visual-refresh/combined-summary-mobile.png'});
 await page.getByLabel('排序方式').selectOption('annualFee:asc');
 check('Mobile cards follow the same rate sort',(await page.locator('.mobile-fund').first().getAttribute('data-fund-code'))===sortGroupMembers(selectFundGroups(groupFunds(funds),{sort:'annualFee:asc'})[0].members,'annualFee:asc')[0].code);
 check('No runtime errors or writes',errors.length===0&&writes.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors,writes,amount:total.amount,history:history.amount,forecast:total.amount*20},null,2));
} finally {await browser.close();}
