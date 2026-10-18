import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewQuotas} from '../src/overview-quotas.mjs';
import {totalQuota, totalHistoricalQuota} from '../src/summary.mjs';
const q=limit=>({status:'open',limit,scope:{mode:'independent'}});
test('overview excludes <=10 per channel, preserves larger channels, unknowns, ETF and source data',()=>{
 const funds=[{code:'a',channelScope:{mode:'independent'},agency:q(10),direct:q(100)},
 {code:'b',agency:q(10.01),direct:q(5)}, {code:'c',agency:{status:'unknown'},direct:{status:'paused',limit:999}},
 {code:'e',venue:'etf',agency:q(10),direct:q(10)}];
 const before=structuredClone(funds),view=overviewQuotas(funds,true);
 assert.equal(totalQuota(view,'agency').amount,10.01);
 assert.equal(totalQuota(view,'direct').amount,100);
 assert.equal(totalQuota(view,'both').amount,110.01);
 assert.equal(totalQuota(view,'agency').unknown,1);
 assert.equal(totalQuota(view,'agency').open,1);
 assert.equal(view[0].agency.excludedSmallQuota,true);
 assert.equal(view[3],funds[3]);
 assert.deepEqual(funds,before);
 assert.equal(overviewQuotas(funds,false),funds);
});
test('shared pools still deduplicate; effective shared cap is subject to threshold',()=>{
 const funds=['a','c'].map(code=>({code,channelScope:{mode:'independent'},agency:{...q(100),scope:{mode:'shared',groupId:'agency',cap:10,codes:['a','c']}},direct:{...q(100),scope:{mode:'shared',groupId:'direct',cap:100,codes:['a','c']}}}));
 assert.equal(totalQuota(overviewQuotas(funds,true),'both').amount,100);
});
test('historical threshold uses each date, keeps past large quota even if today is small and missing remains unknown',()=>{
 const daily=[{date:'2026-09-01',...q(100),channelScope:{mode:'independent'}},{date:'2026-09-02',...q(10),channelScope:{mode:'independent'}},{date:'2026-09-03',status:'unknown'}];
 const fund={code:'a',agency:q(10),direct:q(10),stability:{calendarReady:true,windowDays:20,startDate:'2026-09-01',endDate:'2026-09-30',agency:{daily},direct:{daily:daily.map(r=>({...r,status:'paused',limit:0}))}}};
 const [view]=overviewQuotas([fund],true);
 assert.equal(totalQuota([view],'both').amount,0);
 assert.equal(totalHistoricalQuota([view],'agency').amount,100);
 assert.equal(totalHistoricalQuota([view],'both').amount,100);
 assert.equal(totalHistoricalQuota([view],'agency').complete,false);
 assert.equal(view.stability.agency.knownTotal,100);
 assert.equal(view.stability.agency.openDays,1);
 assert.equal(view.stability.agency.coveredDays,2);
});
