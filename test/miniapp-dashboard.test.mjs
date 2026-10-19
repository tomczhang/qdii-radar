import test from 'node:test';
import assert from 'node:assert/strict';
import { miniappDashboard } from '../server/miniapp-dashboard.mjs';

test('miniapp keeps quota semantics and dates without exceeding the gateway limit on a large board', () => {
  const evidence = '公告证据'.repeat(10000);
  const board = {
    funds: Array.from({ length: 100 }, (_, i) => ({
      code: String(i).padStart(6, '0'), name: '测试基金', share: 'A', venue: 'otc', index: 'nasdaq',
      agency: { status: 'unknown', limit: null, evidence }, direct: { status: 'open', limit: 100, evidence },
      returns: { y1: null, y3: 12.5, y5: 0 }, returnsAsOf: '2026-10-16',
      quote: { premium: 0, date: '2026-10-16', raw: evidence },
      stability: { history: evidence }, trend: [1, 2], dataIssues: [{ detail: evidence }], stale: true
    })),
    changes: [{ id: 'one', code: '000001', before: '暂停申购', after: '100 元', effectiveAt: '2026-10-19', evidence }],
    meta: { updatedAt: '2026-10-19T08:30:00Z', changesCoverage: { complete: false, pending: [evidence] } }
  };
  const compact = miniappDashboard(board);
  const serialized = JSON.stringify(compact);
  assert.ok(Buffer.byteLength(JSON.stringify(board)) > 1000000);
  assert.ok(Buffer.byteLength(serialized) < 100000, '100 funds leave substantial room below the 1000KB limit');
  assert.equal(compact.funds.length, 100);
  assert.deepEqual(compact.funds[0].agency, { status: 'unknown', limit: null });
  assert.equal(compact.funds[0].direct.limit, 100);
  assert.deepEqual(compact.funds[0].returns, board.funds[0].returns);
  assert.equal(compact.funds[0].quote.premium, 0);
  assert.equal(compact.funds[0].quote.date, '2026-10-16');
  assert.equal(compact.funds[0].dataIssueCount, 1);
  assert.equal(compact.meta.changesCoverage.complete, false);
  assert.equal(compact.changes[0].effectiveAt, '2026-10-19');
  assert.equal(serialized.includes('公告证据'), false);
  assert.equal(board.funds[0].agency.evidence, evidence, 'website response stays untouched');
});

import {totalQuota,totalHistoricalQuota} from '../src/summary.mjs';
import {purchaseCandidates,selectedCandidates,calculatePurchasePlan} from '../src/purchase-plan.mjs';

test('v2 round trip preserves shared pools, dated channel rules, fee tiers and exclusions',()=>{
 const fees={annualRate:.6,operating:{management:.5,custody:.1,service:0},subscription:[{min:0,max:null,agencyRate:.12,standardRate:1.2}],stale:false};
 const scope={mode:'shared',groupId:'nasdaq-pool',cap:100,codes:['000001','000002'],ruleId:'rule',basis:'announcement'};
 const days=Array.from({length:20},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),status:'open',limit:100,scope,channelScope:{mode:i<10?'shared':'independent'}}));
 const funds=['000001','000002','000003','000004'].map((code,i)=>({code,name:'测试基金',legalName:'测试基金',share:i===1?'C':'A',manager:'测试公司',index:'nasdaq',venue:'otc',currency:'CNY',returns:{y1:12,y3:20,y5:null},returnsAsOf:'2026-09-20',fees,
  channelScope:{mode:'unknown'},agency:{status:'open',limit:100,scope,platforms:['天天基金']},direct:{status:'open',limit:100,scope,...(i===2?{stale:true}:{}),...(i===3?{pendingReview:true}:{})},dataIssues:i===2?['代销数据待更新']:[],
  stability:{calendarReady:true,windowDays:20,startDate:'2026-09-01',endDate:'2026-09-20',agency:{daily:days},direct:{daily:days}}
 }));
 const board={funds,changes:[],meta:{}};
 const projected=miniappDashboard(board),decoded=JSON.parse(JSON.stringify(projected));
 assert.equal(projected.meta.schemaVersion,2);assert.equal(projected.scopes.length,1);
 for(const f of decoded.funds)for(const c of ['agency','direct'])f.stability[c].daily=f.stability[c].daily.map(({scopeRef,...r})=>({...r,scope:decoded.scopes[scopeRef]}));
 for(const c of ['agency','direct','both']){
  assert.deepEqual(totalQuota(decoded.funds,c),totalQuota(funds,c));
  assert.deepEqual(totalHistoricalQuota(decoded.funds,c),totalHistoricalQuota(funds,c));
  assert.deepEqual(purchaseCandidates(decoded.funds,c),purchaseCandidates(funds,c));
  for(const mode of ['monthly','fast'])for(const strategy of ['fees','maintenance','returns']){
   const input={amount:10000,ratio:100,ratioMode:'nasdaq',mode,channel:c,strategy,purchaseDays:20,holdingYears:1,feeBasis:'annual'};
   const plan=rows=>calculatePurchasePlan(input,selectedCandidates(purchaseCandidates(rows,c),{},input));
   assert.deepEqual(plan(decoded.funds),plan(funds));
  }
 }
 assert.ok(!purchaseCandidates(decoded.funds,'direct').flatMap(g=>g.options).some(o=>['000003','000004'].includes(o.code)));
 assert.deepEqual(decoded.funds[0].fees,fees);
});
