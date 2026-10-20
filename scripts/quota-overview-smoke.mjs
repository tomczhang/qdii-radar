import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {overviewQuotas} from '../src/overview-quotas.mjs';
import {totalQuota,totalHistoricalQuota} from '../src/summary.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE_URL||'http://localhost:4387';
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const data=await(await page.request.get(base+'/api/dashboard')).json();
 await page.route('**/api/dashboard',r=>r.fulfill({json:data}));
 await page.goto(base,{waitUntil:'networkidle'});
 const toggle=page.getByRole('switch',{name:'剔除10元及以下额度'});
 check('Small quota exclusion defaults on',await toggle.getAttribute('aria-checked')==='true');
 const disclosure=page.locator('.quota-overview-toggle');
 check('Channel detail starts folded',await disclosure.getAttribute('aria-expanded')==='false'&&!await page.locator('.quota-overview-details').isVisible());
 await disclosure.focus();await page.keyboard.press('Enter');
 check('Keyboard opens channel detail',await disclosure.getAttribute('aria-expanded')==='true'&&await page.locator('.quota-overview-details').isVisible());
 for (const enabled of [true,false,true]) {
  if((await toggle.getAttribute('aria-checked')==='true')!==enabled)await toggle.click();
  const view=overviewQuotas(data.funds,enabled),money=n=>n==null?'—':`¥${new Intl.NumberFormat('zh-CN').format(n)}`;
  for(const channel of ['agency','direct','both']) {
   const card=page.locator(`[data-channel-summary="${channel}"]`),total=totalQuota(view,channel).amount;
   check(`Current ${channel} ${enabled}`,(await card.locator('[data-current-amount]').innerText()).replace(/\s/g,'').startsWith(money(total)));
   check(`History ${channel} ${enabled}`,(await card.locator('[data-history-summary] > strong').innerText())===money(totalHistoricalQuota(view,channel).amount));
  }
  for(const index of ['nasdaq','sp500']) {
   const members=view.filter(f=>f.index===index),card=page.locator(`[data-quota-index="${index}"]`);
   check(`Index current ${index} ${enabled}`,(await card.locator('[data-index-amount] .counter__sr').textContent())===money(totalQuota(members,'both').amount).replace('¥',''));
   check(`Index history ${index} ${enabled}`,await card.locator('[data-index-history] > strong').innerText()===money(totalHistoricalQuota(members,'both').amount).replace('¥',''));
   for(const channel of ['agency','direct']) {
    check(`Index channel ${index} ${channel} ${enabled}`,(await card.locator(`[data-index-channel="${channel}"] strong`).innerText()).replace(/ \*$/,'')===money(totalQuota(members,channel).amount).replace('¥',''));
    check(`Index channel history ${index} ${channel} ${enabled}`,await page.locator(`[data-index-details="${index}"] [data-history-channel="${channel}"] strong`).innerText()===money(totalHistoricalQuota(members,channel).amount));
   }
  }
 }
 await disclosure.click();
 await page.waitForFunction(()=>!document.querySelector('.counter[data-animating="true"]'));
 await fs.mkdir('outputs/visual-refresh',{recursive:true});
 for(const width of [1440,768,390,320]) {
  await page.setViewportSize({width,height:1000});
  check('Overview fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('Warning and switch visible '+width,await page.locator('.investment-risk').isVisible()&&await toggle.isVisible());
  if([1440,390].includes(width))await page.screenshot({path:`outputs/visual-refresh/overview-risk-filter-${width}.png`});
 }
 check('No runtime errors',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
} finally {await browser.close();}
