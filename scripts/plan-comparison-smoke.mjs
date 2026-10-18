import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true}),base=process.env.TEST_BASE_URL||'http://localhost:4387';
const checks=[],errors=[],check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const data=await(await page.request.get(base+'/api/dashboard')).json(),sample=data.funds.find(f=>f.venue!=='etf');
 const funds=['A','C'].map(share=>({...sample,name:'对比测试',legalName:'对比测试基金',manager:'测试公司',code:share,index:'nasdaq',share,dataIssues:[],returns:{y1:share==='A'?30:20,y3:share==='A'?40:50},returnsAsOf:'2026-10-16',fees:{annualRate:share==='A'?0.2:1,subscription:[{min:0,max:null,agencyRate:share==='A'?1:0,standardRate:share==='A'?1:0}]},direct:{status:'open',limit:100,scope:{mode:'shared',groupId:'comparison-pool',codes:['A','C'],cap:100}},agency:{status:'paused',limit:null}}));
 await page.route('**/api/dashboard',r=>r.fulfill({json:{...data,funds}}));
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('.sidebar').getByRole('button',{name:'购买计算器',exact:true}).click();
 await page.getByLabel('本次计划投入金额（元）').fill('100');
 await page.getByRole('button',{name:'只买纳指',exact:true}).click();
 await page.getByRole('button',{name:'生成方案'}).click();
 assert.deepEqual(await page.locator('.plan-result-step').evaluateAll(els=>els.map(e=>e.getAttribute('aria-label'))),['01 能不能完成','02 选基与费用','03 需要购买几个产品','04 最终方案']);
 check('Four ordered result sections',true);
 check('Crowded comparison table removed',await page.locator('.plan-comparison-table').count()===0);
 check('Annual fee strategy defaults to A',(await page.locator('.execution-fund').innerText()).includes('对比测试 A'));
 const options=page.getByRole('group',{name:'选基偏好'});
 check('Annual fee preference selected',await options.getByRole('button',{name:/费用优先/}).getAttribute('aria-pressed')==='true');
 check('New plans explicitly default to one-year costs',await page.getByLabel('费用测算持有期',{exact:true}).inputValue()==='1');
 assert.deepEqual(await options.locator('button > strong').allTextContents(),['¥1.19','¥1','¥1.19']);
 await page.getByLabel('费用测算持有期',{exact:true}).selectOption('3');
 assert.deepEqual(await options.locator('button > strong').allTextContents(),['¥1.58','¥3','¥1.58']);
 check('All strategies compare subscription plus holding fees at the same horizon',true);
 await options.getByRole('button',{name:/少维护/}).click();
 check('Maintenance switches all cards to funds and apps',await options.getAttribute('data-display')==='maintenance'&&await options.getByText('预计涉及 1 个 App',{exact:true}).count()===3&&await page.getByLabel('费用测算持有期',{exact:true}).count()===0);
 for(const width of [390,320]){await page.setViewportSize({width,height:1100});check('Maintenance cards fit '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1440,height:1100});
 check('Maintenance chooses C and updates fee', (await page.locator('.execution-fund').innerText()).includes('对比测试 C')&&(await page.locator('.fee-metrics').innerText()).includes('1.00%'));
 await options.getByRole('button',{name:/历史收益优先/}).click();
 check('Returns displays three horizons for every strategy',await options.locator('[data-return-years]').count()===9);
 assert.deepEqual(await options.locator('button').first().locator('[data-return-years] strong').allTextContents(),['+¥28.71','+¥117.52','+¥267.62']);
 await fs.mkdir('outputs/visual-refresh',{recursive:true});
 for(const [name,width] of [['desktop',1440],['mobile',390],['small',320]]){await page.setViewportSize({width,height:1100});check('Return scenarios fit '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.plan-preferences').screenshot({path:`outputs/visual-refresh/plan-returns-${name}.png`});}
 await page.setViewportSize({width:1440,height:1100});
 check('Historical assumption and source date are visible',(await page.locator('.plan-comparison-basis').innerText()).includes('近一年收益率不变')&&(await options.innerText()).includes('2026-10-16'));
 await page.getByLabel('比较收益区间').selectOption('3');
 check('Changing ranking horizon does not change one-year projection basis',(await options.locator('button').first().locator('[data-return-years="1"] strong').innerText())==='+¥28.71');
 check('A preference survives C having higher historical return',(await page.locator('.execution-fund').innerText()).includes('对比测试 A'));
 check('Return figures live inside collapsed execution details',await page.locator('.execution-details').getAttribute('open')===null&&(await page.locator('.execution-details').textContent()).includes('40.00%'));
 await options.getByRole('button',{name:/费用优先/}).click();
 await page.reload({waitUntil:'networkidle'});
 await page.locator('.sidebar').getByRole('button',{name:'购买计算器',exact:true}).click();
 check('Snapshot restores preference and real execution',await options.getByRole('button',{name:/费用优先/}).getAttribute('aria-pressed')==='true'&&(await page.locator('.execution-fund').innerText()).includes('对比测试 A'));
 check('Snapshot restores comparison horizon and fee totals',await page.getByLabel('费用测算持有期',{exact:true}).inputValue()==='3'&&(await options.locator('button > strong').first().innerText())==='¥1.58');
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1100});check('No horizontal overflow at '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await fs.mkdir('outputs/visual-refresh',{recursive:true});
 for(const [name,width] of [['desktop',1440],['mobile',390]]){await page.setViewportSize({width,height:1100});await page.locator('[aria-label="02 选基与费用"]').scrollIntoViewIfNeeded();await page.screenshot({path:`outputs/visual-refresh/plan-comparison-${name}.png`});}
 check('No runtime errors',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}finally{await browser.close();}
