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
 for (const enabled of [true,false,true]) {
  if((await toggle.getAttribute('aria-checked')==='true')!==enabled)await toggle.click();
  const view=overviewQuotas(data.funds,enabled),money=n=>n==null?'—':`¥${new Intl.NumberFormat('zh-CN').format(n)}`;
  for(const channel of ['agency','direct','both']) {
   const card=page.locator(`[data-quota-summary="${channel}"]`),total=totalQuota(view,channel).amount;
   check(`Current ${channel} ${enabled}`,(await card.locator('.summary-number').innerText()).replace(/\s/g,'').startsWith(money(total)));
   check(`History ${channel} ${enabled}`,(await card.locator('.summary-history > strong').innerText())===money(totalHistoricalQuota(view,channel).amount));
   check(`Forecast ${channel} ${enabled}`,(await card.locator('.summary-forecast > strong').innerText())===money(total==null?null:total*20));
  }
 }
 await fs.mkdir('outputs/visual-refresh',{recursive:true});
 for(const width of [1440,768,390,320]) {
  await page.setViewportSize({width,height:1000});
  check('Overview fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('Warning and switch visible '+width,await page.locator('.investment-risk').isVisible()&&await toggle.isVisible());
  if([1440,390].includes(width))await page.screenshot({path:`outputs/visual-refresh/overview-risk-filter-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:1100});
 await page.locator('.sidebar').getByRole('button',{name:/额度动态/}).click();
 check('Changes page warning',await page.locator('.investment-risk').isVisible());
 const sample=data.funds.find(f=>f.venue!=='etf'),q=limit=>({status:'open',limit,scope:{mode:'independent'}});
 const funds=[{...sample,code:'test-a',name:'贡献测试纳指',legalName:'贡献测试纳指',manager:'测试公司A',index:'nasdaq',share:'A',agency:q(50),direct:q(100),channelScope:{mode:'independent'}},{...sample,code:'test-b',name:'贡献测试标普',legalName:'贡献测试标普',manager:'测试公司B',index:'sp500',share:'A',agency:q(200),direct:q(400),channelScope:{mode:'independent'}}].map(f=>({...f,fees:{annualRate:0.5,subscription:[{min:0,max:null,agencyRate:0,standardRate:0}]},dataIssues:[]}));
 await page.unroute('**/api/dashboard');await page.route('**/api/dashboard',r=>r.fulfill({json:{...data,funds}}));
 await page.reload({waitUntil:'networkidle'});
 await page.locator('.sidebar').getByRole('button',{name:'购买计算器',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'设置投入条件'});
 check('Drawer uses slow slide animation',await drawer.evaluate(el=>getComputedStyle(el).animationDuration==='0.46s'&&getComputedStyle(el).animationName==='conditions-enter'));
 await page.getByLabel('本次计划投入金额（元）').fill('10000');
 await page.getByLabel('购买渠道',{exact:true}).selectOption('both');
 await page.getByRole('button',{name:'生成方案'}).click();
 check('Calculator page warning',await page.locator('.investment-risk').isVisible());
 const contributionCells=page.locator('.execution-contribution');
 const percents=await contributionCells.locator('strong').allTextContents();
 check('Funds have contributions',percents.length===2);
 check('Sorted percentages sum to 100',percents.map(parseFloat).every((n,i,a)=>!i||a[i-1]>=n)&&Math.abs(percents.map(parseFloat).reduce((a,b)=>a+b,0)-100)<0.11);
 check('Fund totals sit in parent rows with separate channel children',await page.locator('.execution-group').count()===2&&await page.locator('.execution-table [rowspan]').count()===0&&await page.locator('.execution-group').first().locator('.plan-fund-row').count()===2);
 const group=page.locator('.execution-group').first(),groupToggle=group.locator('.execution-group-toggle');
 await groupToggle.click();check('Channel children collapse without hiding contribution',!await group.locator('.execution-table').isVisible()&&await group.locator('.execution-contribution').isVisible());
 await groupToggle.click();check('Channel children expand again',await group.locator('.execution-table').isVisible());
 for (const width of [1440,390,320]) {
  await page.setViewportSize({width,height:1000});
  check('Plan fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width!==320){await page.locator('.calculator-final-plan').scrollIntoViewIfNeeded();await page.screenshot({path:`outputs/visual-refresh/contribution-plan-${width}.png`});}
 }
 await page.getByRole('button',{name:'修改条件',exact:true}).click();
 check('Slide replays on edit',await drawer.evaluate(el=>getComputedStyle(el).animationName==='conditions-enter'));
 await page.keyboard.press('Escape');
 check('Escape closes drawer',!await drawer.isVisible());
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'修改条件',exact:true}).click();
 check('Reduced motion respected',await drawer.evaluate(el=>getComputedStyle(el).animationName==='none'));
 await page.keyboard.press('Escape');
 check('No runtime errors',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
} finally {await browser.close();}
