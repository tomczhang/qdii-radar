import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../server/store.mjs';
import {createApplication} from '../server/index.mjs';
import {authReturnTo} from '../shared/account.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-product-scope-'));
const runtime=await createApplication({store:openStore(dir),startJobs:false,development:false});
const server=runtime.app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/public-config',route=>route.fulfill({json:{umamiWebsiteId:null}}));
  await page.addInitScript(()=>{
    localStorage.setItem('qdii-radar:purchase-calculator:v1',JSON.stringify({input:{amount:10000},result:{}}));
  });
  for(const url of ['/?page=calculator','/calculator']) {
    assert.equal(authReturnTo(url),'/');
    await page.goto(base+url,{waitUntil:'networkidle'});
    await page.waitForURL(base+'/');
    assert.equal(await page.getByRole('heading',{name:'今日申购额度',exact:true}).count(),1);
    assert.equal(await page.locator('.sidebar nav button').count(),2);
    assert.equal(await page.locator('dialog[open]').count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),/购买计算器|生成方案|修改条件|未来20日|静态预估/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('qdii-radar:purchase-calculator:v1')),null);
  }
  const toggle=page.getByRole('switch',{name:'剔除10元及以下额度'});
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  await page.locator('.quota-overview-toggle').click();
  assert.equal(await page.locator('[data-history-summary]').count(),3);
  assert.equal(await page.locator('[data-forecast-summary]').count(),0);
  await page.locator('.quota-overview-toggle').click();
  await fs.mkdir('outputs/product-scope',{recursive:true});
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const nav=page.locator(width>860?'.sidebar':'.mobile-nav');
    await nav.getByRole('button',{name:/额度动态/}).click();
    await page.getByRole('heading',{name:'额度动态',exact:true}).waitFor();
    await nav.getByRole('button',{name:'基金总览',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.counter[data-animating="true"]'));
    if(width===1440||width===390)await page.screenshot({path:`outputs/product-scope/overview-${width}.png`});
  }
  for(const file of await fs.readdir('dist/assets')) if(file.endsWith('.js')) {
    const code=await fs.readFile(path.join('dist/assets',file),'utf8');
    assert.doesNotMatch(code,/calculatePurchasePlan|purchaseCandidates|planReturnScenarios|生成方案|购买计算器/);
  }
  assert.deepEqual(errors,[]);
  console.log('Product scope passed: retired routes and auth redirects, old snapshot cleanup, no planner in production bundle, two-tab navigation, quota history, responsive layout.');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await runtime.close();
  await fs.rm(dir,{recursive:true,force:true});
}
