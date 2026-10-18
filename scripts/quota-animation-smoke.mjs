import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../server/store.mjs';
import {createApplication} from '../server/index.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-quota-motion-'));
const runtime=await createApplication({store:openStore(dir),startJobs:false,development:false});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],checks=[],check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const board=await(await page.request.get(base+'/api/dashboard')).json();
 const sample=board.funds.find(f=>f.venue!=='etf');
 const dates=Array.from({length:20},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`);
 const quota=limit=>({status:limit?'open':'paused',limit,scope:{mode:'independent'}});
 let fixture={...board,funds:[['nasdaq',100,600],['sp500',100,0],['sp500',10,10]].map(([index,agency,direct],i)=>({
  ...sample,code:`motion-${i}`,name:`测试基金${i}`,legalName:`测试基金${i}`,manager:`测试公司${i}`,share:'A',index,
  agency:quota(agency),direct:quota(direct),channelScope:{mode:'independent'},dataIssues:[],
  stability:{windowDays:20,calendarReady:true,startDate:dates[0],endDate:dates.at(-1),
   ...Object.fromEntries([['agency',agency],['direct',direct]].map(([channel,limit])=>[channel,{daily:dates.map(date=>({date,...quota(limit),channelScope:{mode:'independent'}}))}]))},
 }))};
 await page.route('**/api/dashboard',route=>route.fulfill({json:fixture}));
 await page.route('**/api/public-config',route=>route.fulfill({json:{umamiWebsiteId:null}}));
 await page.goto(base,{waitUntil:'networkidle'});
 const toggle=page.getByRole('switch',{name:'剔除10元及以下额度'});
 const card=page.locator('[data-quota-summary="both"]');
 const moving=()=>page.locator('.counter[data-animating="true"]').count();
 const settle=()=>page.waitForFunction(()=>!document.querySelector('.counter[data-animating="true"]')); 
 const read=selector=>card.locator(selector).innerText();
 check('Only the three top daily amounts use rolling digits',await page.locator('.summary-grid .rolling-amount').count()===3);
 check('React Bits counters are mounted',await page.locator('.summary-grid .counter').count()===3);
 check('Secondary amounts contain no rolling counters',await page.locator('.summary-breakdown .counter, .summary-history .counter, .summary-forecast .counter').count()===0);
 await settle();
 check('Default amounts are exact',(await read('.summary-number')).replace(/\s/g,'')==='¥800/日'&&await read('.summary-history > strong')==='¥16,000'&&await read('.summary-forecast > strong')==='¥16,000');
 await toggle.click();
 check('Toggle animates all three top daily amounts',await moving()===3);
 check('Secondary totals update immediately',await read('.summary-history > strong')==='¥16,400'&&await read('.summary-forecast > strong')==='¥16,400'&&await read('[data-index-total="sp500"] strong')==='¥120');
 check('Digits actually move vertically',await page.locator('.counter__numeral').evaluateAll(els=>els.some(el=>{const y=new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;return y!==0&&Math.abs(y)<el.getBoundingClientRect().height;})));
 await settle();
 check('Including small quotas settles on the new exact totals',(await read('.summary-number')).replace(/\s/g,'')==='¥820/日'&&await read('.summary-history > strong')==='¥16,400'&&await read('.summary-forecast > strong')==='¥16,400');
 // Validate rendered glyphs, not only the accessible final-value text.
 check('Visible reels match final text',await page.locator('.counter').evaluateAll(els=>els.every(el=>{
  const actual=[...el.querySelectorAll('.counter__row > span')].map(part=>{
   if(!part.classList.contains('counter__digit'))return part.dataset.glyph??part.firstElementChild?.dataset.glyph??'';
   const visible=[...part.querySelectorAll('[data-numeral]')].find(n=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(n).transform).m42)<0.1);
   return visible?.dataset.glyph;
  }).join('');
  return actual===el.querySelector('.counter__sr').textContent;
 })));
 check('Resting amounts retain natural text width',await page.locator('.counter').evaluateAll(els=>els.every(el=>{
  const reference=document.createElement('span');reference.textContent=el.querySelector('.counter__sr').textContent;
  reference.style.cssText='position:absolute;white-space:nowrap;font:inherit;letter-spacing:inherit';el.append(reference);
  const delta=Math.abs(reference.getBoundingClientRect().width-el.getBoundingClientRect().width);reference.remove();return delta<2;
 })));
 await page.getByRole('tab',{name:/纳斯达克100/}).click();
 check('Unrelated filters do not replay totals',await moving()===0);
 await toggle.click();await toggle.click();await toggle.click();await settle();
 check('Rapid reversals settle correctly',(await read('.summary-number')).replace(/\s/g,'')==='¥800/日');
 check('No animation is left running',await moving()===0);
 check('Decorative reels are hidden from assistive technology',await page.locator('.counter__row[aria-hidden="true"]').count()===3);
 await fs.mkdir('outputs/visual-refresh',{recursive:true});
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1100});
  check('Summary stays within viewport '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===1440||width===390)await page.locator('.summary-grid').screenshot({path:`outputs/visual-refresh/quota-roll-${width}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await toggle.click();await settle();
 check('Reduced motion applies final amounts immediately without rolling',await moving()===0&&(await read('.summary-number')).replace(/\s/g,'')==='¥820/日');
 // Change the preference while an animation is already running.
 await page.emulateMedia({reducedMotion:'no-preference'});
 await toggle.click();await page.emulateMedia({reducedMotion:'reduce'});
 await settle();
 check('Enabling reduced motion cancels in-flight rolls',await moving()===0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 fixture={...fixture,funds:fixture.funds.map((f,i)=>({...f,agency:quota(i===2?10:0),direct:quota(i===0?989.5:i===2?10:0)}))};
 await page.reload({waitUntil:'networkidle'});await settle();
 check('Fractional amount formats correctly',(await read('.summary-number')).replace(/\s/g,'')==='¥989.5/日');
 await toggle.click();await settle();
 check('Growing across a thousands boundary adds digits and separator correctly',(await read('.summary-number')).replace(/\s/g,'')==='¥1,009.5/日'&&await card.locator('.summary-number [data-slot="i3"]').count()===1);
 await toggle.click();await settle();
 check('Shrinking removes the extra digit and separator',(await read('.summary-number')).replace(/\s/g,'')==='¥989.5/日'&&await card.locator('.summary-number [data-slot="i3"]').count()===0&&await card.locator('.summary-number [data-slot="g3"]').count()===0);
 fixture={...fixture,funds:fixture.funds.map(f=>({...f,stability:null}))};
 await page.reload({waitUntil:'networkidle'});
 check('Unknown historical amounts stay unknown without fake zero',await read('.summary-history > strong')==='—'&&await card.locator('.summary-history .counter__digit').count()===0);
 check('No runtime errors',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
} finally {
 await browser.close();await new Promise(resolve=>server.close(resolve));await runtime.close();await fs.rm(dir,{recursive:true,force:true});
}
