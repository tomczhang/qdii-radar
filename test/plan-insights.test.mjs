import test from 'node:test';
import assert from 'node:assert/strict';
import {planReturnScenarios} from '../src/plan-insights.mjs';
const row=(total,net,rate)=>({total,costs:{netAmount:net},returns:{y1:rate},returnsAsOf:'2026-10-16'});
const plan=rows=>({allocations:[{rows}]});
test('收益按各基金复利后相加，扣申购费，不将加权收益率直接复利',()=>{
 const r=planReturnScenarios(plan([row(100,99,10),row(100,100,-10)]));
 assert.equal(r.scheduledAmount,200);
 assert.deepEqual(r.scenarios.slice(0,2),[{years:1,value:198.9,profit:-1.1},{years:3,value:204.67,profit:4.67}]);
 assert.deepEqual(r.dates,['2026-10-16']);
});
test('负收益与本金全损保持负值，不替换为正增长',()=>{
 assert.equal(planReturnScenarios(plan([row(100,100,-50)])).scenarios[1].profit,-87.5);
 assert.deepEqual(planReturnScenarios(plan([row(100,100,-100)])).scenarios.map(s=>s.profit),[-100,-100,-100]);
});
test('缺失收益、无效收益或未知申购费不按零补齐',()=>{
 for(const rows of [[row(100,100,null)],[row(100,null,20)],[row(100,100,-101)],[],[row(100,100,20),row(100,100,undefined)]]) {
  assert.ok(planReturnScenarios(plan(rows)).scenarios.every(s=>s.profit===null&&s.value===null));
 }
});
test('跨渠道同一基金只累加实际安排资金，年限不取选基区间',()=>{
 const p=plan([row(100,99,30),row(50,50,30)]);p.returnYears=5;p.amount=200;
 const r=planReturnScenarios(p);assert.equal(r.scheduledAmount,150);assert.equal(r.scenarios[0].profit,43.7);
});
