import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseCandidates,selectedCandidates,calculatePurchasePlan} from '../src/purchase-plan.mjs';
const input={amount:1000,heldNasdaq:0,heldSp500:0,ratio:50,mode:'fast',channel:'agency',includeSmallQuotas:true};
const rows=[{id:'n',index:'nasdaq',code:'n',limit:100},{id:'s',index:'sp500',code:'s',limit:10}];
test('同共享组份额不叠加，选中份额停购不自动换成另一份额；排除场内与待核验额度',()=>{
 const f={name:'纳指',legalName:'纳指基金',manager:'公司',index:'nasdaq',agency:{status:'open',limit:10,scope:{mode:'shared',groupId:'test-shared',cap:10}}};
 const funds=[{...f,code:'a',share:'A'},{...f,code:'c',share:'C'},{...f,code:'etf',venue:'etf'},{...f,code:'pending',agency:{status:'open',limit:100,pendingReview:true}}];
 const groups=purchaseCandidates(funds,'agency');assert.equal(groups.length,1);assert.equal(groups[0].options.length,2);
 assert.equal(selectedCandidates(groups).reduce((s,r)=>s+r.limit,0),10);
 assert.equal(selectedCandidates(groups,{[groups[0].id]:'removed'}).length,0);
 assert.equal(selectedCandidates(groups,{[groups[0].id]:false}).length,0);
});
test('按指数瓶颈计算投完时间，不用总金额除以混合额度；尾款精确守恒',()=>{
 const p=calculatePurchasePlan(input,rows);assert.equal(p.periods,50);assert.equal(p.estimatedWeeks,10);
 assert.equal(p.allocations[0].periods,5);assert.equal(p.allocations[1].periods,50);
 const q=calculatePurchasePlan({...input,amount:1001.01,ratio:100},[{...rows[0],limit:70},{id:'n2',index:'nasdaq',code:'n2',limit:20}]);
 assert.equal(q.periods,12);
 assert.equal(Math.round(q.allocations.flatMap(a=>a.rows).reduce((s,r)=>s+r.total,0)*100),100101);
 for(const row of q.allocations.flatMap(a=>a.rows)){assert.ok(row.regular<=row.limit);assert.ok(row.last<=row.regular);}
});
test('每周一次只用一天额度；分批目标受额度约束，拉长周期不会冒充低风险',()=>{
 const p=calculatePurchasePlan({...input,mode:'steady',weeks:12,frequency:'weekly'},rows);
 assert.equal(p.periods,50);assert.equal(p.estimatedWeeks,50);assert.equal(p.allocations[0].perPeriod,41.67);
 const d=calculatePurchasePlan({...input,mode:'steady',weeks:12,frequency:'daily'},rows);assert.equal(d.periods,60);assert.equal(d.estimatedWeeks,12);
});
test('已有持仓按最终金额配比补齐；资金不足时不建议卖出也不伪称达标',()=>{
 const p=calculatePurchasePlan({...input,heldNasdaq:9000},rows);assert.equal(p.allocations[0].amount,0);assert.equal(p.allocations[1].amount,1000);assert.equal(p.targetUnreachable,true);assert.equal(p.finalNasdaqPercent,90);
 const q=calculatePurchasePlan({...input,heldNasdaq:500},rows);assert.equal(q.allocations[0].amount,250);assert.equal(q.allocations[1].amount,750);assert.equal(q.targetUnreachable,false);
});
test('无额度的目标不能生成投完日期；零比例不阻塞；输入与重复组严格校验',()=>{
 assert.equal(calculatePurchasePlan(input,[rows[0]]).periods,null);
 assert.equal(calculatePurchasePlan({...input,ratio:100},[rows[0]]).periods,10);
 for(const amount of ['',0,-1,Infinity,'abc'])assert.throws(()=>calculatePurchasePlan({...input,amount},rows));
 assert.throws(()=>calculatePurchasePlan({...input,ratio:101},rows));
 assert.throws(()=>calculatePurchasePlan(input,[rows[0],rows[0]]));
});

test('月预算先减少直销账户，覆盖双指数的公司胜过分别选最高额度',()=>{
 const r=[{id:'an',code:'an',manager:'甲',index:'nasdaq',limit:220},{id:'as',code:'as',manager:'甲',index:'sp500',limit:220},{id:'bn',code:'bn',manager:'乙',index:'nasdaq',limit:500},{id:'cs',code:'cs',manager:'丙',index:'sp500',limit:500}];
 const p=calculatePurchasePlan({...input,amount:8000,mode:'monthly',channel:'direct',purchaseDays:20},r);
 assert.equal(p.periods,20);assert.equal(p.monthlyShortfall,0);assert.deepEqual(p.maintenance.managers,['甲']);assert.equal(p.maintenance.accountCount,1);assert.equal(p.maintenance.fundCount,2);
 assert.ok(p.allocations.every(a=>a.perPeriod===200));
 const existing=calculatePurchasePlan({...input,amount:8000,mode:'monthly',channel:'direct',purchaseDays:20,selectedManagers:['乙','丙']},r);
 assert.equal(existing.maintenance.newAccountCount,undefined);assert.equal(existing.maintenance.accountCount,2);
});
test('月预算代销按基金数量筛选，不把基金公司当成平台；不能覆盖时保留缺口',()=>{
 const r=[{id:'n1',code:'n1',manager:'甲',index:'nasdaq',limit:200},{id:'n2',code:'n2',manager:'乙',index:'nasdaq',limit:100},{id:'s',code:'s',manager:'丙',index:'sp500',limit:10}];
 const p=calculatePurchasePlan({...input,amount:8000,mode:'monthly',purchaseDays:20},r);
 assert.equal(p.maintenance.fundCount,2);assert.equal(p.maintenance.accountCount,null);assert.equal(p.monthlyShortfall,3800);assert.equal(p.periods,400);
 assert.equal(p.allocations[0].amount,4000);assert.equal(p.allocations[1].amount,4000);
});
test('月预算金额精确，忽略已有持仓的一次性再平衡，零比例无需多开账户',()=>{
 const p=calculatePurchasePlan({...input,amount:8000.01,heldSp500:90000,ratio:100,mode:'monthly',channel:'direct',purchaseDays:20},[{...rows[0],manager:'甲',limit:1000}]);
 assert.equal(p.maintenance.accountCount,1);assert.equal(p.monthlyShortfall,0);assert.equal(p.allocations[0].amount,8000.01);
 assert.equal(Math.round(p.allocations[0].rows.reduce((s,r)=>s+r.total,0)*100),800001);
 for(const purchaseDays of [0,24,1.5,NaN])assert.throws(()=>calculatePurchasePlan({...input,mode:'monthly',purchaseDays},rows));
});

test('不限比例优先投满月预算，并按合计额度减少账户和基金',()=>{
 const candidates=[{id:'n',code:'n',manager:'甲',index:'nasdaq',limit:500},{id:'s',code:'s',manager:'乙',index:'sp500',limit:10}];
 const base={...input,amount:8000,mode:'monthly',purchaseDays:20,channel:'direct'};
 const fixed=calculatePurchasePlan(base,candidates);
 assert.equal(fixed.monthlyShortfall,3800);
 assert.equal(fixed.allocations[0].achievementPercent,100);
 assert.equal(fixed.allocations[1].achievementPercent,5);
 assert.equal(fixed.allocations[1].achievableAmount,200);
 assert.equal(fixed.allocations[1].shortfall,3800);
 assert.equal(fixed.achievementPercent,52.5);
 const any=calculatePurchasePlan({...base,ratio:'any',heldSp500:99999},candidates);
 assert.equal(any.monthlyShortfall,0);
 assert.equal(any.achievementPercent,100);
 assert.equal(any.allocations[0].amount,8000);
 assert.equal(any.allocations[1].achievementPercent,null);
 assert.equal(any.maintenance.fundCount,1);
 assert.equal(any.maintenance.accountCount,1);
 assert.equal(any.targetUnreachable,false);
});
test('不限比例额度不足时用满两侧额度；无额度时保留未分配预算',()=>{
 const base={...input,amount:10000,ratio:'any',mode:'monthly',purchaseDays:20};
 const p=calculatePurchasePlan(base,rows);
 assert.equal(p.monthlyShortfall,7800);
 assert.equal(p.achievementPercent,22);
 assert.equal(p.allocations[0].achievableAmount,2000);
 assert.equal(p.allocations[1].achievableAmount,200);
 assert.equal(p.allocations.reduce((n,a)=>n+Math.round(a.amount*100),0),1000000);
 const empty=calculatePurchasePlan(base,[]);
 assert.equal(empty.unallocated,10000);
 assert.equal(empty.monthlyShortfall,10000);
 assert.equal(empty.achievementPercent,0);
 assert.equal(empty.periods,null);
 assert.equal(empty.blocked,true);
 assert.ok(empty.allocations.every(a=>a.achievementPercent===null));
});
test('不限比例在尽快和分批模式也可使用单侧额度，且尾款精确',()=>{
 const p=calculatePurchasePlan({...input,amount:1001.01,ratio:'any'},rows);
 assert.equal(p.periods,10);
 assert.equal(p.allocations.flatMap(a=>a.rows).reduce((n,r)=>n+Math.round(r.total*100),0),100101);
 const one=calculatePurchasePlan({...input,ratio:'any',heldNasdaq:90000},[rows[1]]);
 assert.equal(one.periods,100);
 assert.equal(one.allocations[1].amount,1000);
 assert.equal(one.targetUnreachable,false);
 const paced=calculatePurchasePlan({...input,ratio:'any',mode:'steady',frequency:'weekly',weeks:2},rows);
 assert.equal(paced.shortfall,780);
 assert.equal(paced.allocations[0].achievableAmount,200);
 assert.equal(paced.allocations[1].achievableAmount,20);
});
test('小额度开关在所有渠道统一排除不超过10元，与预算或公司内其他额度无关',()=>{
 const candidates=[{id:'n',code:'n',manager:'甲',index:'nasdaq',limit:1000},{id:'s',code:'s',manager:'甲',index:'sp500',limit:10},{id:'s2',code:'s2',manager:'丙',index:'sp500',limit:5},{id:'s3',code:'s3',manager:'丁',index:'sp500',limit:10.01}];
 for(const channel of ['agency','direct','both'])for(const amount of [100,100000]){
   const base={...input,amount,mode:'monthly',purchaseDays:20,channel,includeSmallQuotas:false};
   const p=calculatePurchasePlan(base,candidates);
   assert.deepEqual(p.skippedSmallQuotas.map(r=>r.code),['s','s2']);
   assert.ok(p.allocations.flatMap(a=>a.rows).every(r=>r.limit>10));
   assert.equal(calculatePurchasePlan({...base,includeSmallQuotas:true},candidates).skippedSmallQuotas.length,0);
 }
});
test('基金公司默认为全选，显式清空不回退；所有选基策略遵守公司选择',()=>{
 const candidates=[{id:'n',code:'n',manager:'甲',index:'nasdaq',limit:1000},{id:'s',code:'s',manager:'乙',index:'sp500',limit:500}];
 for(const strategy of ['maintenance','fees','returns']){
   const base={...input,ratio:'any',mode:'monthly',purchaseDays:20,strategy};
   assert.equal(calculatePurchasePlan({...base,selectedManagers:null},candidates).shortfall,0);
   const one=calculatePurchasePlan({...base,selectedManagers:['乙']},candidates);
   assert.deepEqual(one.allocations.flatMap(a=>a.rows).map(r=>r.manager),['乙']);
   const empty=calculatePurchasePlan({...base,selectedManagers:[]},candidates);
   assert.equal(empty.shortfall,1000);assert.equal(empty.blocked,true);
 }
});
test('不限比例先最大化覆盖，再限定公司；分配金额和每期额度始终守恒',()=>{
 const candidates=[{id:'n',code:'n',manager:'新账户',index:'nasdaq',limit:1000},{id:'s',code:'s',manager:'旧账户',index:'sp500',limit:500}];
 const p=calculatePurchasePlan({...input,amount:8000,ratio:'any',mode:'monthly',purchaseDays:20,channel:'direct',selectedManagers:['旧账户']},candidates);
 assert.deepEqual(p.maintenance.managers,['旧账户']);
 assert.equal(p.monthlyShortfall,0);
 assert.equal(p.maintenance.newAccountCount,undefined);
 for(const amount of [1,1.01,100.01,2200.01,100000])for(const purchaseDays of [1,7,20,23]){
   const p=calculatePurchasePlan({...input,amount,ratio:'any',mode:'monthly',purchaseDays},rows);
   assert.equal(Math.round((amount-p.monthlyShortfall)*100),Math.min(Math.round(amount*100),11000*purchaseDays));
   assert.equal(p.allocations.flatMap(a=>a.rows).reduce((n,r)=>n+Math.round(r.total*100),0),Math.round(amount*100));
   for(const row of p.allocations.flatMap(a=>a.rows)){assert.ok(row.regular<=row.limit);assert.ok(row.last<=row.regular);}
 }
});

test('方案切换：月预算与比例不变，收益年限改变基金选择，账户维护方案仍优先同公司',()=>{
 const r=[
 {id:'an',code:'an',manager:'甲',index:'nasdaq',limit:100,returns:{y1:5,y3:90,y5:null}},
 {id:'as',code:'as',manager:'甲',index:'sp500',limit:100,returns:{y1:4,y3:80,y5:null}},
 {id:'bn',code:'bn',manager:'乙',index:'nasdaq',limit:100,returns:{y1:20,y3:30,y5:10}},
 {id:'cs',code:'cs',manager:'丙',index:'sp500',limit:100,returns:{y1:15,y3:20,y5:-5}}];
 const base={...input,amount:2000,mode:'monthly',channel:'direct',purchaseDays:20};
 const m=calculatePurchasePlan({...base,strategy:'maintenance'},r);
 const y1=calculatePurchasePlan({...base,strategy:'returns',returnYears:1},r);
 const y3=calculatePurchasePlan({...base,strategy:'returns',returnYears:3},r);
 assert.deepEqual(m.maintenance.managers,['甲']);assert.deepEqual(y1.maintenance.managers,['乙','丙']);assert.deepEqual(y3.maintenance.managers,['甲']);
 for(const p of [m,y1,y3]){assert.equal(p.shortfall,0);assert.equal(p.periods,20);assert.deepEqual(p.allocations.map(a=>a.amount),[1000,1000]);}
});
test('收益优先额度不足时补下一只，缺失值排在负收益之后，预算和尾款守恒',()=>{
 const r=[{id:'a',code:'a',index:'nasdaq',manager:'甲',limit:30,returns:{y1:20}},{id:'b',code:'b',index:'nasdaq',manager:'乙',limit:20,returns:{y1:-5}},{id:'c',code:'c',index:'nasdaq',manager:'丙',limit:100,returns:{y1:null}}];
 const base={...input,amount:2000,ratio:100,mode:'monthly',purchaseDays:20,strategy:'returns',returnYears:1};
 const p=calculatePurchasePlan(base,r),rr=p.allocations[0].rows;
 assert.deepEqual(rr.map(r=>[r.code,r.regular]),[['a',30],['b',20],['c',50]]);assert.equal(p.missingReturnCount,1);assert.equal(p.shortfall,0);
 for(const amount of [1,100.01,1001.01,2000,5000])for(const ratio of [100,'any']){
 const q=calculatePurchasePlan({...base,amount,ratio},r);
 assert.equal(q.allocations.flatMap(a=>a.rows).reduce((n,r)=>n+Math.round(r.total*100),0),Math.round(amount*100));
 assert.equal(q.shortfall,Math.max(0,amount-3000));
 for(const row of q.allocations.flatMap(a=>a.rows)){assert.ok(row.regular<=row.limit);assert.ok(row.last<=row.regular);}
 }
});
test('不限比例按收益优先使用额度，而不是把高收益小额度稀释为全额度比例',()=>{
 const r=[{id:'n',code:'n',manager:'甲',index:'nasdaq',limit:10,returns:{y1:20}},{id:'s',code:'s',manager:'乙',index:'sp500',limit:100,returns:{y1:10}}];
 const p=calculatePurchasePlan({...input,amount:400,ratio:'any',mode:'monthly',purchaseDays:20,strategy:'returns'},r);
 assert.deepEqual(p.allocations.map(a=>a.amount),[200,200]);assert.equal(p.shortfall,0);assert.equal(p.periods,20);
});
test('尽快与分批方案切换不延长整体期限，明确缺口时仍不隐藏缺口',()=>{
 const r=[{id:'a',code:'a',index:'nasdaq',manager:'甲',limit:100,returns:{y1:2}},{id:'b',code:'b',index:'nasdaq',manager:'乙',limit:50,returns:{y1:20}}];
 for(const mode of ['fast','steady']){
 const base={...input,amount:1000,ratio:100,mode,frequency:'weekly',weeks:20};
 const m=calculatePurchasePlan({...base,strategy:'maintenance'},r),h=calculatePurchasePlan({...base,strategy:'returns'},r);
 assert.equal(h.periods,m.periods);assert.equal(h.shortfall,0);assert.equal(h.allocations[0].rows[0].code,'b');
 }
 const failed=calculatePurchasePlan({...input,amount:1000,ratio:100,mode:'steady',frequency:'weekly',weeks:2,strategy:'returns'},r);
 assert.equal(failed.shortfall,700);
});
test('收益方案同基金优先A，共享组仅选一份额，不减少容量并保留手选',()=>{
 const q={status:'open',limit:100,scope:{mode:'shared',groupId:'shared',cap:100}};
 const f={name:'测试',manager:'甲',index:'nasdaq',direct:q};
 const groups=purchaseCandidates([{...f,code:'a',share:'A',returns:{y1:10}},{...f,code:'c',share:'C',returns:{y1:20}},{...f,code:'i',share:'I',returns:{y1:100},direct:{...q,limit:5}}],'direct');
 const pref={strategy:'returns',returnYears:1};
 assert.equal(selectedCandidates(groups,{},pref)[0].code,'a');
 assert.equal(selectedCandidates(groups,{[groups[0].id]:'c'},pref)[0].code,'c');
 assert.equal(selectedCandidates(groups,{[groups[0].id]:'a'},pref)[0].code,'a');
 assert.equal(selectedCandidates(groups,{[groups[0].id]:false},pref).length,0);
 const p=calculatePurchasePlan({...input,channel:'direct',ratio:100,mode:'monthly',purchaseDays:20,...pref},selectedCandidates(groups,{},pref));
 assert.equal(p.maintenance.fundCount,1);assert.equal(p.allocations[0].rows[0].code,'a');
});

test('月预算74%示例：分项缺口与计划期后追加时间，不能把总9周说成再等9周',()=>{
 const candidates=[{id:'n',code:'n',index:'nasdaq',limit:250},{id:'s',code:'s',index:'sp500',limit:120}];
 const p=calculatePurchasePlan({...input,amount:10000,mode:'monthly',purchaseDays:20},candidates);
 assert.equal(p.achievementPercent,74);assert.equal(p.shortfall,2600);
 assert.equal(p.horizonPeriods,20);assert.equal(p.periods,42);assert.equal(p.estimatedWeeks,9);
 assert.equal(p.extraPeriods,22);assert.equal(p.extraWeeks,5);
 assert.deepEqual(p.allocations.map(a=>[a.achievableAmount,a.shortfall,a.extraPeriods,a.extraWeeks,a.estimatedWeeks]),[[5000,0,0,0,4],[2400,2600,22,5,9]]);
});
test('两侧并行补齐取较慢的一侧；零预算无需补齐，无额度不得编造时间',()=>{
 const base={...input,amount:10000,mode:'monthly',purchaseDays:20};
 const both=calculatePurchasePlan(base,[{...rows[0],limit:100},{...rows[1],limit:120}]);
 assert.equal(both.extraPeriods,30);assert.equal(both.extraWeeks,6);
 const blocked=calculatePurchasePlan(base,[{...rows[0],limit:120}]);
 assert.equal(blocked.extraPeriods,null);assert.equal(blocked.extraWeeks,null);
 assert.equal(blocked.allocations[0].extraWeeks,5);assert.equal(blocked.allocations[1].extraWeeks,null);
 const zero=calculatePurchasePlan({...base,ratio:100,amount:1000},[rows[0]]);
 assert.equal(zero.allocations[1].achievementPercent,null);assert.equal(zero.allocations[1].extraWeeks,0);assert.equal(zero.extraPeriods,0);
 const empty=calculatePurchasePlan({...base,ratio:'any'},[]);
 assert.equal(empty.achievementPercent,0);assert.equal(empty.extraWeeks,null);assert.equal(empty.unallocated,10000);
});
test('每周一次按额外扣款次数算周数，每日尾款按天向上取整，不能相减两个已取整周数',()=>{
 const candidates=[{...rows[0],limit:100}];
 const weekly=calculatePurchasePlan({...input,amount:500,ratio:100,mode:'steady',weeks:2,frequency:'weekly'},candidates);
 assert.equal(weekly.horizonPeriods,2);assert.equal(weekly.extraPeriods,3);assert.equal(weekly.extraWeeks,3);assert.equal(weekly.estimatedWeeks,5);
 const tail=calculatePurchasePlan({...input,amount:701,ratio:100,mode:'monthly',purchaseDays:7},candidates);
 assert.equal(tail.periods,8);assert.equal(tail.estimatedWeeks,2);assert.equal(tail.extraPeriods,1);assert.equal(tail.extraWeeks,1);
 const fast=calculatePurchasePlan({...input,amount:701,ratio:100},candidates);
 assert.equal(fast.horizonPeriods,null);assert.equal(fast.extraPeriods,0);assert.equal(fast.extraWeeks,0);
});

test('无固定比例的两种偏好先用偏好指数额度，再由另一侧补足；选基策略不能覆盖指数偏好',()=>{
 const candidates=[{...rows[0],manager:'纳指公司',returns:{y1:80}},{...rows[1],limit:20,manager:'标普公司',returns:{y1:1}}];
 for(const strategy of ['maintenance','returns','fees']){
  const base={...input,amount:1000,ratio:'any',mode:'monthly',purchaseDays:20,strategy};
  const sp=calculatePurchasePlan({...base,ratioMode:'any-sp500'},candidates);
  assert.equal(sp.preferredIndex,'sp500');assert.deepEqual(sp.allocations.map(a=>a.amount),[600,400]);assert.equal(sp.shortfall,0);
  const n=calculatePurchasePlan({...base,ratioMode:'any-nasdaq'},candidates);
  assert.equal(n.preferredIndex,'nasdaq');assert.deepEqual(n.allocations.map(a=>a.amount),[1000,0]);assert.equal(n.shortfall,0);
 }
});
test('指数偏好不降低预算达成率、不拉长最快期限，分币尾款精确',()=>{
 const candidates=[{...rows[0],limit:100},{...rows[1],limit:20}];
 for(const ratioMode of ['any-sp500','any-nasdaq'])for(const mode of ['fast','monthly','steady'])for(const amount of [1,1001.01,2400,3000.01]){
  const base={...input,amount,mode,ratio:'any',ratioMode,purchaseDays:20,weeks:3,frequency:'weekly',strategy:'maintenance'};
  const p=calculatePurchasePlan(base,candidates),periods=mode==='fast'?Math.ceil(amount/120):mode==='monthly'?20:3;
  assert.equal(Math.round((amount-p.shortfall)*100),Math.min(Math.round(amount*100),12000*periods));
  if(mode==='fast')assert.equal(p.periods,periods);
  else assert.ok(p.periods<=Math.max(periods,Math.ceil(amount/120)),'偏好不能拉长额度允许的补齐时间');
  assert.equal(p.allocations.flatMap(a=>a.rows).reduce((sum,r)=>sum+Math.round(r.total*100),0),Math.round(amount*100));
  for(const r of p.allocations.flatMap(a=>a.rows))assert.ok(r.regular<=r.limit&&r.last<=r.regular);
 }
});
test('偏好侧无额度则转投另一侧，双侧无额度保留未分配预算',()=>{
 for(const [ratioMode,preferred] of [['any-sp500','sp500'],['any-nasdaq','nasdaq']]){
  const base={...input,ratio:'any',ratioMode,mode:'monthly',purchaseDays:20,strategy:'maintenance'};
  for(const row of rows){
   const p=calculatePurchasePlan(base,[row]);assert.equal(p.blocked,false);assert.equal(p.allocations.find(a=>a.index===row.index).amount,1000);assert.equal(p.preferredIndex,preferred);
  }
  const empty=calculatePurchasePlan(base,[]);assert.equal(empty.unallocated,1000);assert.equal(empty.blocked,true);assert.equal(empty.shortfall,1000);
 }
});

test('同基金A/C：常规方案优先A，少维护优先C，独立额度仍可补足预算',()=>{
 const common={name:'同一基金',manager:'甲',index:'nasdaq',channel:'agency',limit:100,fees:{annualRate:0.6,subscription:[{min:0,max:null,agencyRate:1,standardRate:1}]}};
 const candidates=[{...common,id:'a',code:'a',share:'A',returns:{y1:10}},{...common,id:'c',code:'c',share:'C',returns:{y1:20},fees:{annualRate:0.8,subscription:[{min:0,max:null,agencyRate:0,standardRate:0}]}}];
 const next={...input,amount:100,ratio:100,mode:'monthly',purchaseDays:1,feeBasis:'annual'};
 for(const strategy of ['fees','returns','maintenance']){
  const plan=calculatePurchasePlan({...next,strategy},candidates);
  assert.equal(plan.allocations[0].rows[0].share,strategy==='maintenance'?'C':'A');assert.equal(plan.shortfall,0);assert.equal(plan.maintenance.fundCount,1);
  const full=calculatePurchasePlan({...next,strategy,amount:200},candidates);assert.equal(full.maintenance.fundCount,2);assert.equal(full.shortfall,0);assert.equal(full.allocations[0].rows.reduce((n,r)=>n+r.total,0),200);
 }
 const solo=calculatePurchasePlan({...next,strategy:'fees'},[candidates[1]]);assert.equal(solo.allocations[0].rows[0].share,'C');
});
test('份额偏好不跨基金或平台，不牺牲共享额度，不覆盖手选',()=>{
 const common={name:'同一基金',manager:'甲',index:'nasdaq',channel:'agency',limit:100};
 const a={...common,code:'a',share:'A',returns:{y1:10}},c={...common,code:'c',share:'C',returns:{y1:20}};
 const group={id:'pool',index:'nasdaq',options:[a,c]},pref={strategy:'fees',feeBasis:'annual'};
 assert.equal(selectedCandidates([group],{},pref)[0].code,'a');
 assert.equal(selectedCandidates([group],{pool:'c'},pref)[0].code,'c');
 assert.equal(selectedCandidates([{...group,options:[{...a,limit:50},c]}],{},pref)[0].code,'c');
 assert.equal(selectedCandidates([{...group,options:[a,{...c,name:'另一基金'}]}],{},{strategy:'returns'})[0].code,'c');
 assert.equal(selectedCandidates([{...group,options:[{...a,platform:'平台一'},{...c,platform:'平台二'}]}],{},{strategy:'returns'})[0].code,'c');
});
