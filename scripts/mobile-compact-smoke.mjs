// Read-only UI checks: fixtures are browser-local; no production data or subscriptions are changed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.TEST_BASE_URL || 'http://localhost:4388';
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],writes=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
await fs.mkdir('outputs/mobile-compact',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 const data=await(await page.request.get(base+'/api/dashboard')).json();
 // Keep normal and failure layouts deterministic regardless of supplier health.
 const normal={...data,funds:data.funds.map(f=>({...f,stale:false,dataIssues:[]})),meta:{...data.meta,staleCount:0}};
 let fixture=normal;
 await page.route('**/api/dashboard',r=>r.fulfill({json:fixture}));
 await page.goto(base);await page.locator('.fund-group').first().waitFor();
 const metrics=await page.evaluate(()=>({height:document.documentElement.scrollHeight,firstFundTop:document.querySelector('.fund-group').getBoundingClientRect().top,groupHeight:document.querySelector('.fund-group').getBoundingClientRect().height}));
 check('First fund appears within the first mobile screen',metrics.firstFundTop<740);
 check('Collapsed groups use compact rows',metrics.groupHeight<150);
 check('Three current quota totals remain visible',await page.locator('.summary-card').count()===3 && await page.locator('[data-quota-summary="direct"] .summary-number').isVisible());
 check('History and assumptions are folded by default',!await page.locator('.summary-periods').first().isVisible());
 await page.screenshot({path:'outputs/mobile-compact/overview.png'});
 await page.locator('.mobile-summary-toggle').click();
 check('History remains available on demand',await page.locator('.summary-periods').first().isVisible());
 await page.locator('.mobile-summary-toggle').click();
 await page.locator('.fund-group-toggle').first().click();
 check('Expanded group retains fees and share rules',await page.locator('.mobile-group-facts').first().isVisible());
 await page.locator('.mobile-fund-toggle').first().click();
 await page.locator('.mobile-detail-link').first().click();
 check('Fund details remain accessible',await page.getByRole('dialog').isVisible());
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/^场内 ETF/}).click();
 check('ETF view uses compact mobile rows',await page.locator('.mobile-etf-row').count()===normal.funds.filter(f=>f.venue==='etf').length && !await page.locator('.comparison-scroll').isVisible());
 check('ETF view does not repeat OTC quota summary',await page.locator('.summary-grid').count()===0);
 await page.locator('.mobile-etf-detail').first().click();
 check('ETF rows open price and premium details',await page.locator('dialog .detail-premium').isVisible());
 await page.keyboard.press('Escape');await page.screenshot({path:'outputs/mobile-compact/etfs.png'});
 const etfs=normal.funds.filter(f=>f.venue==='etf').slice(0,2);
 fixture={...normal,funds:normal.funds.map(f=>etfs.some(e=>e.code===f.code)?{...f,stale:true,dataIssues:['收盘溢价率待更新']}:f)};
 await page.reload();await page.locator('.data-issues').waitFor();
 check('Issue names the exact ETF, code and field',(await page.locator('.data-issues').innerText()).includes(etfs[0].code)&&(await page.locator('.data-issues').innerText()).includes('收盘溢价率待更新'));
 await page.locator('.data-issues summary').click();
 check('Every affected ETF can be inspected',(await page.locator('.data-issues').innerText()).includes(etfs[1].code));
 check('No vague partial-fund warning remains',!(await page.locator('body').innerText()).includes('只基金有部分数据待更新'));
 await page.locator('.data-issues .data-issue-link').last().click();
 check('An issue opens the matching fund',await page.getByRole('dialog').getAttribute('aria-label')===`${etfs[1].name}${etfs[1].share}详情`);
 await page.keyboard.press('Escape');
 fixture=normal;await page.reload();await page.locator('.fund-group').first().waitFor();
 for(const width of [320,390,600,760,768,1024,1440]) {
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(`Overview has no horizontal overflow at ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 check('Desktop history stays visible',await page.locator('.summary-periods').first().isVisible());
 await page.screenshot({path:'outputs/mobile-compact/desktop.png'});
 for(const width of [390,320,1440]) {
  await page.setViewportSize({width,height:844});
  await page.locator(width>860?'.sidebar':'.mobile-nav').getByRole('button',{name:'购买计算器',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'设置投入条件'});
  if(!await drawer.isVisible())await page.getByRole('button',{name:'设置条件',exact:true}).click();
  await drawer.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
  check(`Drawer animation direction at ${width}`,await drawer.evaluate((el,mobile)=>getComputedStyle(el).animationName===(mobile?'conditions-enter-bottom':'conditions-enter'),width<=760));
  check(`Drawer and action fit viewport at ${width}`,await drawer.evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('.calculate-button').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&b.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth+1;}));
  if(width<=760)check(`Mobile sheet is bottom anchored at ${width}`,await drawer.evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight)<1&&el.getBoundingClientRect().top>0));
  if(width===390)await page.screenshot({path:'outputs/mobile-compact/conditions.png'});
  await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
  check(`Closing restores background scroll at ${width}`,await page.evaluate(()=>document.body.style.overflow!=='hidden'));
 }
 check('No runtime errors or writes',errors.length===0&&writes.length===0);
 await fs.writeFile('outputs/mobile-compact/qa.json',JSON.stringify({metrics,checks,errors,writes},null,2));
 console.log(JSON.stringify({passed:checks.length,metrics,checks,errors,writes},null,2));
} finally {await browser.close();}
