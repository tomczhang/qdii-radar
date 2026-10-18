import test from 'node:test';
import assert from 'node:assert/strict';
import {planCostSummary} from '../shared/fees.mjs';

test('费用比较使用逐笔估算后的申购费与持有费用，计费金额包含已安排补投',()=>{
 const plan={shortfall:100,allocations:[{rows:[{total:200},{total:100}]}],costs:{holdingYears:1,subscriptionFee:0.99,holdingCost:0.6}};
 assert.deepEqual(planCostSummary(plan),{scheduledAmount:300,total:1.59});
});
test('未知费用或未设持有期不显示虚假的零成本；真实零费用保留',()=>{
 const base={allocations:[{rows:[{total:100}]}],costs:{holdingYears:1,subscriptionFee:0,holdingCost:0}};
 assert.equal(planCostSummary(base).total,0);
 for(const costs of [{...base.costs,subscriptionFee:null},{...base.costs,holdingCost:null},{...base.costs,holdingYears:null}])assert.equal(planCostSummary({...base,costs}).total,null);
 assert.deepEqual(planCostSummary({allocations:[],costs:{holdingYears:1,subscriptionFee:null,holdingCost:null}}),{scheduledAmount:0,total:null});
});
