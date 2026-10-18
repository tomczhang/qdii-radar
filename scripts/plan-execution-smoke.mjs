import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE_URL||'http://localhost:4392',browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const data=await(await page.request.get(base+'/api/dashboard')).json(),sample=data.funds.find(f=>f.venue!=='etf');
 const fund={...sample,name:'渠道执行测试',manager:'测试公司',code:'test-a',index:'nasdaq',share:'A',dataIssues:[],fees:{annualRate:0.5,subscription:[{min:0,max:null,agencyRate:1,standardRate:2}]},agency:{status:'open',limit:10,scope:{mode:'independent'}},direct:{status:'open',limit:100,scope:{mode:'independent'}},channelScope:{mode:'independent'}};
 await page.route('**/api/dashboard',r=>r.fulfill({json:{...data,funds:[fund]}}));
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('.sidebar').getByRole('button',{name:'购买计算器',exact:true}).click();
 await page.getByLabel('购买渠道',{exact:true}).selectOption('both');await page.getByRole('switch',{name:'≤10元的小额度基金也纳入',exact:true}).click();
 await page.getByRole('button',{name:'只买纳指',exact:true}).click();await page.getByLabel('本次计划投入金额（元）').fill('215');await page.getByRole('button',{name:'生成方案'}).click();
 await page.getByRole('group',{name:'选基偏好'}).getByRole('button',{name:/少维护/}).click();
 const execution=page.getByLabel('最终渠道计划'),rows=execution.locator('.plan-fund-row'),direct=rows.filter({has:page.locator('.execution-channel', {hasText:'基金公司直销'})}),agency=rows.filter({has:page.locator('.execution-channel', {hasText:'代销'})});
 check('Instruction tutorial removed',await page.getByText('如何设置定投',{exact:true}).count()===0&&await page.locator('.plan-instructions').count()===0);
 check('Final plan has a nested channel table below both columns',await execution.locator('table').count()===1&&await page.locator('.purchase-calculator').evaluate(el=>{const final=el.querySelector('.calculator-final-plan'),form=el.querySelector('.calculator-form'),results=el.querySelector('.calculator-results');const f=final.getBoundingClientRect(),a=form.getBoundingClientRect(),b=results.getBoundingClientRect(),p=el.getBoundingClientRect();return final.parentElement===el&&f.top>=Math.max(a.bottom,b.bottom)&&Math.abs(f.width-p.width)<2;}));
 check('Table total includes both independent channels',(await execution.locator('.execution-grand-total').innerText()).includes('¥215'));
 check('Independent channel plans remain distinct',await rows.count()===2&&(await direct.locator('.execution-channel').innerText()).includes('测试公司'));
 check('Fund identity appears once above its channel rows',await execution.locator('.execution-group-identity').count()===1&&(await execution.locator('.execution-group-identity').innerText()).includes('test-a'));
 check('Regular debits and final tail are explicit',(await agency.innerText()).includes('¥10')&&(await agency.innerText()).includes('前 1 期')&&(await agency.innerText()).includes('¥5')&&(await agency.innerText()).includes('第 2 期 · 按此尾款调整'));
 check('Each channel stops at its own exact amount',(await direct.locator('.execution-stop').innerText()).includes('¥200')&&(await agency.locator('.execution-stop').innerText()).includes('¥15')&&(await direct.innerText()).includes('第 2 期 · 金额不变'));
 check('Supporting details are collapsed by default',await rows.locator('details[open]').count()===0);
 await direct.locator('summary').click();check('Fee details remain accessible',await direct.getByText(/当前限额/).isVisible());await direct.locator('summary').click();
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1100});check('Execution layout fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await fs.mkdir('outputs/visual-refresh',{recursive:true});
 for(const [name,width] of [['desktop',1440],['mobile',390]]){await page.setViewportSize({width,height:1100});await execution.scrollIntoViewIfNeeded();await page.screenshot({path:`outputs/visual-refresh/plan-execution-${name}.png`});}
 await page.getByRole('button',{name:'修改条件',exact:true}).click();
 await page.getByLabel('购买渠道',{exact:true}).selectOption('direct');await page.getByLabel('本次计划投入金额（元）').fill('50');await page.getByRole('button',{name:'生成方案'}).click();
 check('One-off purchase is labelled once without zero periods',(await rows.innerText()).includes('仅买 1 次')&&!(await rows.innerText()).includes('前 0 期')&&(await rows.locator('.execution-stop').innerText()).includes('¥50'));
 await page.getByRole('button',{name:'修改条件',exact:true}).click();
 await page.getByRole('radio',{name:/资金稳健分批/}).check();await page.getByLabel('期望投完周期（周）').fill('3');await page.getByRole('button',{name:'生成方案'}).click();
 check('Weekly execution keeps weekly frequency',(await execution.locator('.plan-execution-frequency').innerText()).includes('每周一次'));
 await page.getByRole('button',{name:'修改条件',exact:true}).click();
 await page.getByRole('radio',{name:/每月固定投入/}).check();await page.getByLabel('每月投入预算（元）').fill('3000');await page.getByRole('button',{name:'生成方案'}).click();
 check('Monthly shortfall plan clearly scopes its full schedule',(await execution.locator('.plan-execution-frequency').innerText()).includes('仅对应本月预算')&&(await rows.locator('.execution-stop').innerText()).includes('共 30 次'));
 await page.getByRole('button',{name:'修改条件',exact:true}).click();
 await page.getByLabel('每月投入预算（元）').fill('4000');
 check('Changing input removes the old full-width final plan',await page.locator('.calculator-final-plan').count()===0);
 check('No runtime errors',errors.length===0);console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}finally{await browser.close();}
