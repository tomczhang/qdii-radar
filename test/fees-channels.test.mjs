import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFeePage,parseRate} from '../server/fees.mjs';
import {subscriptionCharge,estimateCosts,costScore,shareBreakEven} from '../shared/fees.mjs';
import {purchaseCandidates,selectedCandidates,calculatePurchasePlan,planSignature} from '../src/purchase-plan.mjs';
import {resolveChannelScope,attachChannelScopes} from '../server/channel-scopes.mjs';
import {refreshFundData} from '../server/resilience.mjs';
const fee=(rate=0,annual=1)=>({subscription:[{min:0,max:null,agencyRate:rate,standardRate:rate}],annualRate:annual});
const q=(limit,scope={mode:'independent'})=>({status:'open',limit,scope});
const f={code:'a',name:'测试',share:'A',index:'nasdaq',manager:'公司',agency:q(10),direct:q(100),channelScope:{mode:'independent'},fees:fee()};
const base={amount:220,ratio:100,mode:'fast',channel:'both',includeSmallQuotas:true};
test('真实费率页面：费率分层、C零申购费不等于零年度费用、缺失不补零',()=>{
 const a=parseFeePage(readFileSync(new URL('./fixtures/fees/000834.html',import.meta.url),'utf8'),'000834');
 assert.equal(a.annualRate,1);assert.equal(a.subscription[0].agencyRate,0.12);assert.equal(a.subscription[0].standardRate,1.2);
 assert.equal(subscriptionCharge(100,a,'agency'),0.12);assert.equal(subscriptionCharge(100,a,'direct'),1.19);
 assert.equal(subscriptionCharge(500000,a,'agency'),499.5);assert.equal(subscriptionCharge(10000000,a,'direct'),1000);
 const c=parseFeePage(readFileSync(new URL('./fixtures/fees/019442.html',import.meta.url),'utf8'),'019442');
 assert.equal(c.annualRate,0.85);assert.equal(subscriptionCharge(100,c,'direct'),0);
 assert.equal(parseRate('--'),null);assert.equal(parseRate('0.00%'),0);assert.equal(parseRate('-1%'),null);
 assert.throws(()=>parseFeePage('bad','000834'));
 const partial=parseFeePage('000834 管理费率 0.50%','000834');assert.equal(partial.annualRate,null);assert.equal(subscriptionCharge(100,partial,'agency'),null);
});
test('逐笔舍入与尾款守恒，缺失费用不冒充零；年度费不再扣现金预算',()=>{
 const p=calculatePurchasePlan({...base,amount:201.01},[{id:'x',index:'nasdaq',code:'a',channel:'direct',limit:100,fees:fee(1.2,1)}]);
 const row=p.allocations[0].rows[0];
 assert.equal(row.costs.subscriptionFee,2.39);assert.equal(row.costs.netAmount,198.62);assert.equal(p.amount,201.01);
 assert.equal(row.costs.annualCost,1.99);assert.equal(p.costs.subscriptionFee+p.costs.netAmount,p.amount);
 assert.equal(estimateCosts({...row,fees:null}).netAmount,null);assert.equal(costScore({...row,fees:null}),Infinity);
 for(const years of [0,-1,Infinity,51])assert.throws(()=>calculatePurchasePlan({...base,holdingYears:years},[]));
});
test('双渠道明确独立才叠加，未知与共享只选一次且允许手选渠道',()=>{
 for(const mode of ['independent','shared','unknown']) {
   const groups=purchaseCandidates([{...f,channelScope:{mode}}],'both'),rows=selectedCandidates(groups),plan=calculatePurchasePlan(base,rows);
   assert.equal(rows.reduce((s,r)=>s+r.limit,0),mode==='independent'?110:100);
   assert.equal(plan.periods,mode==='independent'?2:3);
   if(mode!=='independent')assert.equal(selectedCandidates(groups,{[groups[0].id]:'agency:a'})[0].channel,'agency');
 }
});
test('份额共享与渠道独立同时约束，不能把A/C或代销平台重复相加',()=>{
 const funds=['a','c'].map(code=>({...f,code,agency:q(10,{mode:'shared',groupId:'agency:pool',codes:['a','c'],cap:10}),direct:q(100,{mode:'shared',groupId:'direct:pool',codes:['a','c'],cap:100})}));
 const candidates=selectedCandidates(purchaseCandidates(funds,'both'));
 assert.equal(candidates.length,2);assert.equal(candidates.reduce((n,r)=>n+r.limit,0),110);
 assert.equal(calculatePurchasePlan(base,candidates).allocations[0].rows.length,2);
 funds[0].channelScope={mode:'unknown'};funds[1].channelScope={mode:'unknown'};
 assert.equal(selectedCandidates(purchaseCandidates(funds,'both')).reduce((n,r)=>n+r.limit,0),100);
});
test('跨渠道未知规则可传递合并，不以不一致的份额分组重复计额',()=>{
 const funds=['a','c'].map(code=>({...f,code,channelScope:{mode:'unknown'},agency:q(10,{mode:'shared',groupId:'agency:pool',codes:['a','c'],cap:10}),direct:q(100)}));
 assert.equal(selectedCandidates(purchaseCandidates(funds,'both')).length,1);
});
test('按持有期改变费用排序；历史净值收益不重复扣年度费用',()=>{
 const candidates=[{id:'a',index:'nasdaq',code:'a',limit:100,fees:fee(1,0.2),channel:'agency',returns:{y1:20}},{id:'c',index:'nasdaq',code:'c',limit:100,fees:fee(0,1),channel:'agency',returns:{y1:21}}];
 const input={...base,channel:'agency',amount:100,mode:'monthly',purchaseDays:1,strategy:'fees'};
 assert.equal(calculatePurchasePlan({...input,holdingYears:0.5},candidates).allocations[0].rows[0].code,'c');
 assert.equal(calculatePurchasePlan({...input,holdingYears:5},candidates).allocations[0].rows[0].code,'a');
 assert.equal(calculatePurchasePlan({...input,strategy:'returns',holdingYears:5},candidates).allocations[0].rows[0].code,'c');
 assert.equal(calculatePurchasePlan(input,[{...candidates[0],fees:null},candidates[1]]).allocations[0].rows[0].code,'c');
 assert.notEqual(planSignature(candidates),planSignature(candidates.map(r=>({...r,fees:fee(0,2)}))));
});
test('合并渠道不再区分是否开户，小额度开关统一作用于两种渠道',()=>{
 const funds=[{...f,agency:q(100),direct:q(100)},{...f,code:'s',index:'sp500',manager:'小账户',agency:q(5),direct:q(5)}];
 const p=calculatePurchasePlan({...base,amount:1000,ratio:100,mode:'monthly',purchaseDays:20,strategy:'maintenance'},selectedCandidates(purchaseCandidates(funds,'both')));
 assert.equal(p.maintenance.newAccountCount,undefined);assert.equal(p.maintenance.accountCount+(p.maintenance.agencyUsed?1:0),1);
 const large=calculatePurchasePlan({...base,amount:100000,ratio:50,includeSmallQuotas:false},selectedCandidates(purchaseCandidates(funds,'both')));
 assert.deepEqual(new Set(large.skippedSmallQuotas.map(r=>r.channel)),new Set(['agency','direct']));
 assert.equal(large.allocations[1].rows.length,0);
});
test('真实渠道规则：生效日期、新公告失效、费率陈旧各自独立',()=>{
 assert.equal(resolveChannelScope('000834','2026-10-16').mode,'independent');
 assert.equal(resolveChannelScope('000834','2026-06-03').mode,'unknown');
 assert.equal(resolveChannelScope('023422','2026-10-16').mode,'unknown');
 assert.equal(resolveChannelScope('000834','2026-10-16',[{code:'008971',id:'new',title:'调整大额申购限额',publishedAt:'2026-10-16'}]).mode,'unknown');
 const stamped=attachChannelScopes([{...f,fees:{...fee(),observedAt:'2026-10-01'}}],[],new Date('2026-10-16T12:00:00Z'));
 assert.equal(stamped[0].fees.stale,true);
});
test('费率请求失败保留旧费率和采集时间，其他字段成功仍更新',async()=>{
 const old={...f,fees:{...fee(),observedAt:'2026-10-01'},observedAt:'2026-10-01'};
 const {snapshot}=await refreshFundData(f,old,{enabled:false,market:async()=>({agency:q(20),sourceErrors:['fees']}),now:new Date('2026-10-16T12:00:00Z')});
 assert.deepEqual(snapshot.fees,old.fees);assert.equal(snapshot.agency.limit,20);
});
test('独立份额的公告涵盖同族代码，不等于共享池；不能误合并兄弟份额',()=>{
 const funds=['a','c'].map(code=>({...f,code,channelScope:{mode:'unknown'},agency:q(10,{mode:'independent',codes:['a','c']}),direct:q(100,{mode:'independent',codes:['a','c']})}));
 assert.equal(selectedCandidates(purchaseCandidates(funds,'both')).reduce((n,r)=>n+r.limit,0),200);
});

test('默认不假设一年：单项费用可独立排序，只有显式持有期才合并成本',()=>{
 const candidates=[{id:'a',index:'nasdaq',code:'a',limit:100,fees:fee(1,0.2),channel:'agency'}, {id:'c',index:'nasdaq',code:'c',limit:100,fees:fee(0,1),channel:'agency'}];
 const input={...base,channel:'agency',amount:100,mode:'monthly',purchaseDays:1,strategy:'fees'};
 const upfront=calculatePurchasePlan(input,candidates),annual=calculatePurchasePlan({...input,feeBasis:'annual'},candidates);
 assert.equal(upfront.allocations[0].rows[0].code,'c');assert.equal(annual.allocations[0].rows[0].code,'a');
 assert.equal(upfront.costs.holdingYears,null);assert.equal(upfront.costs.holdingCost,null);
 assert.equal(annual.costs.holdingCost,null);assert.ok(Math.abs(costScore(candidates[0])-0.0099)<1e-12);
 assert.equal(calculatePurchasePlan({...input,holdingYears:3},candidates).allocations[0].rows[0].code,'a');
 const groups=[{id:'pool',index:'nasdaq',options:candidates}];
 assert.equal(selectedCandidates(groups,{},input)[0].code,'c');
 assert.equal(selectedCandidates(groups,{}, {...input,feeBasis:'annual'})[0].code,'a');
 assert.equal(selectedCandidates(groups,{pool:'c'},{...input,holdingYears:5})[0].code,'c');
 assert.equal(upfront.amount,annual.amount);assert.equal(upfront.periods,annual.periods);
 assert.throws(()=>calculatePurchasePlan({...input,feeBasis:'invalid'},candidates));
});
test('组合年度费率按净投入加权，未知费率保持未知，长期费用不提前按年舍入',()=>{
 const candidates=[{id:'a',index:'nasdaq',code:'a',limit:100,fees:fee(1,0.2),channel:'agency'}, {id:'c',index:'sp500',code:'c',limit:100,fees:fee(0,1),channel:'agency'}];
 const input={...base,amount:200,channel:'agency',ratio:50};
 const plan=calculatePurchasePlan(input,candidates);
 assert.ok(Math.abs(plan.costs.annualRate-(99.01*0.2+100)/199.01)<1e-10);
 assert.equal(calculatePurchasePlan(input,[candidates[0],{...candidates[1],fees:null}]).costs.annualRate,null);
 assert.equal(estimateCosts({regular:1,last:0,fullCycles:1,total:1,fees:fee(0,0.4),channel:'agency'},5).holdingCost,0.02);
});
test('A/C持平时间使用相同单笔金额、渠道和完整有效费率，异常条件不编造时间',()=>{
 const a={channel:'agency',fees:fee(1,0.2)},c={channel:'agency',fees:fee(0,1)};
 assert.ok(Math.abs(shareBreakEven(a,c,100).years-0.99/(1-99.01*0.002))<1e-12);
 for(const other of [{...c,channel:'direct'},{...c,fees:null},{...c,fees:{...c.fees,stale:true}},{...c,fees:fee(0,0.1)}])assert.equal(shareBreakEven(a,other,100),null);
 assert.equal(shareBreakEven(a,c,0),null);
});

test('宝盈按同一基金账户跨渠道共用、A/C分别10元，公告生效前不倒填关系',()=>{
 const codes=['019736','019737'];
 const funds=codes.map((code,i)=>({...f,code,share:i?'C':'A',name:'宝盈纳斯达克100',agency:q(10),direct:q(10),channelScope:resolveChannelScope(code,'2026-10-16')}));
 assert.equal(resolveChannelScope(codes[0],'2026-09-27').mode,'unknown');
 for(const fund of funds)assert.equal(fund.channelScope.mode,'shared');
 const rows=selectedCandidates(purchaseCandidates(funds,'both'));
 assert.equal(rows.length,2);assert.equal(rows.reduce((n,r)=>n+r.limit,0),20);
 assert.equal(calculatePurchasePlan({...base,amount:40},rows).periods,2);
 assert.equal(resolveChannelScope(codes[0],'2026-10-17',[{code:codes[0],id:'new',title:'调整申购限额公告',publishedAt:'2026-10-17'}]).mode,'unknown');
});

test('南方、摩根按份额跨渠道共用；华泰柏瑞跨份额跨渠道共用5元',()=>{
 const families=[{codes:['016452','016453'],from:'2026-07-09',limit:10,total:20},{codes:['017641','019305'],from:'2026-07-27',limit:10,total:20},{codes:['019172','019173'],from:'2026-07-27',limit:10,total:20},{codes:['019524','019525','022664'],from:'2026-09-22',limit:5,total:5,shared:true}];
 for(const family of families){
   const funds=family.codes.map((code,i)=>({...f,code,share:['A','C','I'][i],agency:q(family.limit,family.shared?{mode:'shared',groupId:'agency:test',codes:family.codes,cap:5}:{mode:'independent'}),direct:q(family.limit,family.shared?{mode:'shared',groupId:'direct:test',codes:family.codes,cap:5}:{mode:'independent'}),channelScope:resolveChannelScope(code,'2026-10-16')}));
   for(const fund of funds){assert.equal(fund.channelScope.mode,'shared');assert.equal(fund.channelScope.from,family.from);}
   const rows=selectedCandidates(purchaseCandidates(funds,'both'));
   assert.equal(rows.reduce((n,r)=>n+r.limit,0),family.total);
   assert.equal(calculatePurchasePlan({...base,amount:family.total*2},rows).periods,2);
 }
 assert.equal(resolveChannelScope('021000','2026-10-16').mode,'unknown','南方I不被A/C规则覆盖');
});
