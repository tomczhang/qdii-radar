import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetSegments,budgetPercent} from '../src/budget-allocation.mjs';
import {calculatePurchasePlan} from '../src/purchase-plan.mjs';
const candidates=[{id:'n',code:'n',index:'nasdaq',limit:250},{id:'s',code:'s',index:'sp500',limit:120}];
const input={amount:10000,mode:'monthly',purchaseDays:20,channel:'direct',ratio:50};
test('pie uses total budget, not each index target or invested subtotal',()=>{
 const segments=budgetSegments(calculatePurchasePlan(input,candidates));
 assert.deepEqual(segments.map(s=>[s.id,s.amount,s.percent]),[['nasdaq-allocated',5000,50],['sp500-allocated',2400,24],['sp500-shortfall',2600,26]]);
 assert.equal(segments.at(-1).end,1);
});
test('unrestricted no-quota budget stays unassigned; fixed targets keep individual gaps',()=>{
 const unassigned=budgetSegments(calculatePurchasePlan({...input,ratio:'any'},[]));
 assert.deepEqual(unassigned.map(s=>[s.id,s.amount,s.percent]),[['unallocated',10000,100]]);
 const fixed=budgetSegments(calculatePurchasePlan(input,[]));
 assert.deepEqual(fixed.map(s=>[s.id,s.amount,s.percent]),[['nasdaq-shortfall',5000,50],['sp500-shortfall',5000,50]]);
});
test('complete, single-index, one-sided block, and fractional budgets conserve every cent',()=>{
 for(const changes of [{amount:2000},{amount:1.01,ratio:33},{ratio:100},{ratio:0},{mode:'fast'},{ratio:'any'}])for(const rows of [candidates,candidates.slice(0,1),[]]) {
  const result=calculatePurchasePlan({...input,...changes},rows),segments=budgetSegments(result);
  assert.equal(segments.reduce((n,s)=>n+s.cents,0),Math.round(result.amount*100));
  assert.equal(segments.at(-1).end,1);
  assert.equal(segments.filter(s=>s.kind!=='allocated').reduce((n,s)=>n+s.cents,0),Math.round(result.shortfall*100));
 }
 assert.equal(budgetPercent(0.001),'<0.1%');
});
