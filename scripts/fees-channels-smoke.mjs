import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.TEST_BASE_URL || 'http://localhost:4387';
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[],writes=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
await fs.mkdir('outputs/visual-refresh',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 const data=await(await page.request.get(base+'/api/dashboard')).json(),sample=data.funds.find(f=>f.code==='000834');
 check('API contains fee source and verified channel scope',sample.fees?.sourceUrl && sample.channelScope?.mode==='independent');
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('[data-group-codes="000834-008971"] .fund-group-toggle').click();
 await page.locator('.otc-table [data-fund-code="000834"] .fee-cell .fee-detail-button').click();
 check('Fee dialog exposes separate annual components and subscription tiers',(await page.locator('.fund-fees-detail').innerText()).includes('管理费')&&(await page.locator('.fund-fees-detail').innerText()).includes('标准费率'));
 await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 await page.setViewportSize({width:390,height:1000});
 check('Collapsed mobile cards expose fees',await page.locator('.mobile-fund-fees').first().isVisible());
 await page.screenshot({path:'outputs/visual-refresh/fees-mobile.png'});
 check('No runtime errors or writes',errors.length===0&&writes.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors,writes},null,2));
}finally{await browser.close();}
