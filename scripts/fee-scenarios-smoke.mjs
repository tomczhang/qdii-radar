import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.TEST_BASE_URL||'http://localhost:4388',checks=[],errors=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const data=await(await page.request.get(base+'/api/dashboard')).json(),sample=data.funds.find(f=>f.venue!=='etf');
 const funds=['A','C'].map(share=>({...sample,name:'情景比较测试',manager:'测试公司',code:share,index:'nasdaq',share,dataIssues:[],fees:{annualRate:share==='A'?0.2:1,subscription:[{min:0,max:null,agencyRate:share==='A'?1:0,standardRate:share==='A'?1:0}]},direct:{status:'open',limit:100,scope:{mode:'shared',groupId:'test-pool',codes:['A','C'],cap:100}},agency:{status:'paused',limit:null}}));
 await page.route('**/api/dashboard',r=>r.fulfill({json:{...data,funds}}));
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('.sidebar').getByRole('button',{name:'购买计算器',exact:true}).click();
 check('Holding duration no longer required',await page.getByLabel('费用测算持有年限（年）').count()===0);
 await page.getByLabel('本次计划投入金额（元）').fill('100');
 await page.getByRole('button',{name:'无所谓比例偏纳指',exact:true}).click();
 await page.getByRole('button',{name:'生成方案'}).click();
 check('Default shows annual rate and per-ten-thousand benchmark',(await page.locator('.plan-costs').innerText()).includes('每万元持仓每年约 ¥20'));
 check('Additional scenario plans stay collapsed by default',await page.locator('[data-fee-years]').count()===0);
 await page.getByRole('button',{name:/费用优先/}).click();
 check('Default fee priority includes a visible one-year horizon',await page.getByRole('button',{name:/费用优先/}).getAttribute('aria-pressed')==='true'&&await page.getByLabel('费用测算持有期',{exact:true}).inputValue()==='1');

 check('Fee strategy retains same-fund A preference',(await page.locator('.plan-fund-row').innerText()).includes('情景比较测试 A'));
 await page.locator('.fee-scenarios summary').click();
 await page.locator('[data-fee-years="3"]').waitFor();
 check('Three scenarios visible',await page.locator('[data-fee-years]').count()===3);
 check('Short duration retains A preference',(await page.locator('[data-fee-years="1"] ul').innerText()).includes('情景比较测试 A'));
 check('Long duration selects A',(await page.locator('[data-fee-years="3"] ul').innerText()).includes('情景比较测试 A'));
 check('Unchanged share preference explained',(await page.locator('.fee-scenario-difference').innerText()).includes('相同'));
 check('A/C crossing includes sample amount',(await page.locator('.fee-break-even').innerText()).includes('单笔 ¥100')&&(await page.locator('.fee-break-even').innerText()).includes('约 1.2 年'));
 await page.getByRole('button',{name:'采用 3 年费用方案',exact:true}).click();
 check('Applying scenario shows selected horizon',(await page.locator('.fee-scenarios summary').innerText()).includes('已选择 3 年'));
 check('Scenario updates all strategy previews to the same horizon',await page.getByLabel('费用测算持有期',{exact:true}).inputValue()==='3'&&await page.getByRole('group',{name:'选基偏好'}).getByText('预计 3 年费用',{exact:true}).count()===3);
 await page.getByRole('button',{name:'采用 1 年费用方案',exact:true}).click();
 check('One-year scenario keeps its own cost basis across all previews',await page.getByRole('group',{name:'选基偏好'}).getByText('预计 1 年费用',{exact:true}).count()===3&&(await page.getByRole('group',{name:'选基偏好'}).locator('button > strong').first().innerText())==='¥1.19');
 check('Applying scenario keeps quota and budget',(await page.locator('.plan-outcome').innerText()).includes('100.0%')&&(await page.locator('.execution-stop').textContent()).replace(/\s+/g,'').includes('¥100'));
 await page.getByRole('button',{name:'取消持有期限，恢复单项比较',exact:true}).click();
 check('Cancel clears holding horizon',!(await page.locator('.fee-scenarios summary').innerText()).includes('已选择'));
 await page.getByRole('button',{name:/少维护/}).click();
 check('Maintenance preference selects C',(await page.locator('.plan-fund-row').innerText()).includes('情景比较测试 C'));
 for(const width of [1440,768,390,320]) {
   await page.setViewportSize({width,height:1100});
   check('Expanded comparison fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.setViewportSize({width:390,height:1100});await page.locator('.fee-scenarios').scrollIntoViewIfNeeded();
 await page.screenshot({path:'outputs/visual-refresh/fee-scenarios-mobile.png'});
 await page.setViewportSize({width:1440,height:1100});await page.locator('.plan-costs').scrollIntoViewIfNeeded();
 await page.screenshot({path:'outputs/visual-refresh/fee-scenarios-desktop.png'});
 check('No runtime errors',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
} finally {await browser.close();}
