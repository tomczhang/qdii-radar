import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {totalQuota,totalHistoricalQuota,quotaDelta} from '../src/summary.mjs';
import {recentChangeWindow} from '../server/service.mjs';
import {openStore} from '../server/store.mjs';
test('Totals exclude ETF, unknown and paused residual limits; channels never combined',()=>{
 const funds=[{agency:{status:'open',limit:10,scope:{mode:'independent'}},direct:{status:'open',limit:100,scope:{mode:'independent'}}},{agency:{status:'paused',limit:999},direct:{status:'unknown',limit:999}},{venue:'etf',agency:{status:'open',limit:9999},direct:{status:'open',limit:9999}}];
 assert.deepEqual(totalQuota(funds,'agency'),{amount:10,open:1,unknown:0,count:2,scopeUnknown:0,sharedGroups:0});assert.deepEqual(totalQuota(funds,'direct'),{amount:100,open:1,unknown:1,count:2,scopeUnknown:0,sharedGroups:0});
 assert.equal(totalQuota([{agency:{status:'unknown'}}],'agency').amount,null);
 assert.equal(totalQuota([{agency:{status:'paused'}}],'agency').amount,0);
 assert.equal(quotaDelta({beforeQuota:{status:'paused'},afterQuota:{status:'open',limit:100}}),100);
 assert.equal(quotaDelta({beforeQuota:{status:'open',limit:10},afterQuota:{status:'paused'}}),-10);
 assert.equal(quotaDelta({beforeQuota:{status:'unknown'},afterQuota:{status:'open',limit:10}}),null);
});
test('Thirty China calendar days include midnight boundary, exclude old/future events, no 100-event truncation',t=>{
 const now=new Date('2026-10-16T01:00:00+08:00'),window=recentChangeWindow(now);
 assert.equal(window.from,'2026-09-16T16:00:00.000Z');assert.equal(window.startDate,'2026-09-17');assert.equal(window.endDate,'2026-10-16');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-summary-'));const store=openStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(let i=0;i<105;i++)store.addEvent({id:String(i),code:'000834',createdAt:window.from});
 store.addEvent({id:'old',code:'000834',createdAt:new Date(Date.parse(window.from)-1).toISOString()});store.addEvent({id:'future',code:'000834',createdAt:new Date(+now+1).toISOString()});store.addEvent({id:'now',code:'000834',createdAt:now.toISOString()});
 const events=store.eventsBetween(window.from,window.to);assert.equal(events.length,106);assert.equal(events[0].id,'now');assert.ok(!events.some(e=>['old','future'].includes(e.id)));
});

test('Historical totals aggregate actual dated rows, preserving partial and known zero',()=>{
 const daily=Array.from({length:20},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,status:'open',limit:10,scope:{mode:'independent'}}));
 const history=rows=>({calendarReady:true,windowDays:20,startDate:'2026-09-01',endDate:'2026-09-30',agency:{daily:rows}});
 const funds=[{code:'a',stability:history(daily)},{code:'b',stability:history(daily.slice(0,1))},{code:'c'},{venue:'etf',stability:history(daily)}];
 const total=totalHistoricalQuota(funds,'agency');assert.equal(total.amount,210);assert.equal(total.completeCount,1);assert.equal(total.complete,false);assert.equal(total.unknownDays,39);
 assert.equal(totalHistoricalQuota([{code:'a',stability:history(daily.map(r=>({...r,status:'paused',limit:0,scope:{mode:'unknown'}})))}],'agency').amount,0);
 for(const funds of [[],[{}],[{stability:{...history(daily),calendarReady:false}}],[{stability:{...history(daily),windowDays:60}}],[{stability:{...history(daily),agency:{knownTotal:999,coveredDays:20}}}]])assert.equal(totalHistoricalQuota(funds,'agency').amount,null);
});
