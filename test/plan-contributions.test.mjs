import test from 'node:test';
import assert from 'node:assert/strict';
import {planContributions} from '../src/plan-contributions.mjs';
test('contributions combine fund channels and sort across indices without including unmet budget',()=>{
 const result={unallocated:1000,allocations:[{index:'nasdaq',rows:[{id:'a-direct',code:'a',total:100},{id:'b',code:'b',total:90},{id:'a-agency',code:'a',total:50}]},{index:'sp500',rows:[{id:'c',code:'c',total:160}]}]};
 const before=structuredClone(result),view=planContributions(result);
 assert.equal(view.total,400);
 assert.deepEqual(view.funds.map(f=>f.code),['c','a','b']);
 assert.deepEqual(view.funds.map(f=>f.contribution),[0.4,0.375,0.225]);
 assert.equal(view.funds[1].rows.length,2);
 assert.deepEqual(result,before);
});
test('empty execution has no misleading percentage or division by zero',()=>{
 assert.deepEqual(planContributions({allocations:[{rows:[]}]}),{total:0,funds:[]});
});
