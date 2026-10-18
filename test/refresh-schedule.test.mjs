import test from 'node:test';
import assert from 'node:assert/strict';
import {nextDashboardRefresh} from '../shared/refresh-schedule.mjs';
import {startScheduler} from '../server/service.mjs';
import {CHANGE_HISTORY_VERSION} from '../server/change-history.mjs';

test('page reads are scheduled at the two Beijing slots, with no repeat at the exact boundary',()=>{
 const next=(time,morning)=>new Date(nextDashboardRefresh(Date.parse(time),morning)).toISOString();
 assert.equal(next('2026-10-18T07:29:59+08:00'),'2026-10-17T23:30:00.000Z');
 assert.equal(next('2026-10-18T07:30:00+08:00'),'2026-10-18T08:30:00.000Z');
 assert.equal(next('2026-10-18T16:30:00+08:00'),'2026-10-18T23:30:00.000Z');
 assert.equal(next('2026-10-18T08:00:00+08:00','09:00'),'2026-10-18T01:00:00.000Z');
 assert.equal(next('2026-10-18T08:00:00+08:00','invalid'),'2026-10-18T08:30:00.000Z');
});

test('scheduler does not inspect fund rules on ordinary minute ticks; inspects them when the evening sync is due',async t=>{
 const start=Date.parse('2026-10-18T16:29:50+08:00');
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const meta={lastDailySuccess:'2026-10-18',lastEveningSuccess:null,lastAttemptAt:'2026-10-18T12:00:00+08:00',lastRun:{status:'success'},marketUpdatedAt:new Date(start).toISOString(),
 'changeHistory:state':{version:CHANGE_HISTORY_VERSION,checkedAt:new Date(start).toISOString(),status:'success',windowStart:'2026-01-01'},
 'analytics:lastRun':{checkedAt:new Date(start).toISOString(),status:'success'},'quotaBackfill:lastRun':{startedAt:new Date(start).toISOString(),status:'success'}};
 let ruleChecks=0,syncAttempts=0;
 const store={getMeta:key=>meta[key],db:{prepare(){ruleChecks++;return {get:()=>({expires:Date.now()+60000})};}},acquireLease(){syncAttempts++;return false;}};
 const stop=startScheduler(store,{deliver:async()=>{}});t.after(stop);
 t.mock.timers.tick(500);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ruleChecks,0);assert.equal(syncAttempts,0);
 // Keep unrelated analytics current, so this test isolates the rule-sync trigger.
 meta['analytics:lastRun'].checkedAt='2026-10-18T16:30:00+08:00';
 t.mock.timers.tick(60000);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ruleChecks,1);assert.equal(syncAttempts,1);
});
