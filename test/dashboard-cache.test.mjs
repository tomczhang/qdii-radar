import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardLoader,DASHBOARD_CACHE_KEY,readDashboardCache} from '../src/dashboard-cache.mjs';
const at=time=>Date.parse(`2026-10-19T${time}+08:00`);
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};};
const board=(meta={})=>({funds:[],changes:[],meta:{dailySyncTime:'07:30',updatedAt:'2026-10-18T08:30:00.000Z',lastRun:{status:'success',startedAt:'2026-10-18T08:30:00.000Z'},...meta}});

test('reloads reuse cache until the exact Beijing schedule boundary without extending expiry',async()=>{
 const local=storage();let time=at('07:29:30'),calls=0;
 const options={storage:local,now:()=>time,fetchBoard:async()=>{calls++;return board();}};
 let load=createDashboardLoader(options);
 const first=await load();assert.equal(calls,1);assert.equal(first.expiresAt,at('07:30:00'));
 time=at('07:29:59');load=createDashboardLoader(options);
 assert.deepEqual(await load(),first);assert.equal(calls,1);assert.equal(readDashboardCache(local,time).savedAt,at('07:29:30'));
 time=at('07:30:00');await load();assert.equal(calls,2);
});

test('custom morning, evening and midnight cache expiry follow the same schedule',async()=>{
 for(const [start,expected,morning] of [['08:00:00','2026-10-19T09:00:00+08:00','09:00'],['10:00:00','2026-10-19T16:30:00+08:00','07:30'],['23:59:59','2026-10-20T07:30:00+08:00','07:30']]) {
  const result=await createDashboardLoader({storage:storage(),now:()=>at(start),fetchBoard:async()=>board({dailySyncTime:morning})})();
  assert.equal(result.expiresAt,Date.parse(expected));
 }
});

test('running sync and scheduler-start race retain 15-second polling, completion returns to next slot',async()=>{
 const local=storage();let time=at('07:30:00'),calls=0;
 let data=board();
 const load=createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>{calls++;return data;}});
 assert.equal((await load()).expiresAt,time+15000);
 time+=15000;data=board({lastRun:{status:'running',startedAt:'2026-10-19T07:30:05+08:00'}});
 assert.equal((await load()).expiresAt,time+15000);
 time+=1000;await createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>{throw Error('must use cache');}})();
 time+=14000;data=board({lastRun:{status:'success',startedAt:'2026-10-19T07:30:05+08:00'}});
 assert.equal((await load()).expiresAt,at('16:30:00'));assert.equal(calls,3);
});

test('corrupt, obsolete, malformed, future-dated and extended caches are ignored',async()=>{
 const local=storage(),time=at('10:00:00');let calls=0;
 const fresh=await createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>board()})();
 const valid=JSON.parse(local.getItem(DASHBOARD_CACHE_KEY));
 for(const raw of ['not json',JSON.stringify({...valid,version:0}),JSON.stringify({...valid,board:{meta:{},funds:[{}],changes:[]}}),JSON.stringify({...valid,savedAt:time+1000}),JSON.stringify({...valid,expiresAt:fresh.expiresAt+1})]) {
  local.setItem(DASHBOARD_CACHE_KEY,raw);assert.equal(readDashboardCache(local,time),null);
  await createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>{calls++;return board();}})();
 }
 assert.equal(calls,5);
});

test('blocked or full storage still returns live data and uses in-memory cache',async()=>{
 for(const local of [()=>{throw Error('blocked');},{getItem:()=>null,setItem:()=>{throw Error('full');}}]) {
  let calls=0,time=at('10:00:00');
  const load=createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>{calls++;return board();}});
  await load();time+=1000;await load();assert.equal(calls,1);
  time=at('16:30:00');await load();assert.equal(calls,2);
 }
});

test('failed requests do not renew expired cache; retry and concurrent callers work',async()=>{
 const local=storage();let time=at('10:00:00'),calls=0,fail=false;
 const load=createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>{calls++;if(fail)throw Error('offline');return board();}});
 await Promise.all([load(),load()]);assert.equal(calls,1);
 const saved=local.getItem(DASHBOARD_CACHE_KEY);time=at('16:30:00');fail=true;
 await assert.rejects(load(),/offline/);assert.equal(local.getItem(DASHBOARD_CACHE_KEY),saved);
 fail=false;await load();assert.equal(calls,3);
});

test('a request spanning a scheduled time cannot cache the old snapshot until the following slot',async()=>{
 const local=storage();let time=at('07:29:59');
 const result=await createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>{time=at('07:30:05');return board();}})();
 assert.equal(result.expiresAt,at('07:30:00'));assert.equal(readDashboardCache(local,time),null);
});

test('invalid responses never overwrite a valid saved snapshot',async()=>{
 const local=storage();let time=at('10:00:00');
 await createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>board()})();
 const saved=local.getItem(DASHBOARD_CACHE_KEY);time=at('16:30:00');
 await assert.rejects(createDashboardLoader({storage:local,now:()=>time,fetchBoard:async()=>({funds:null})})(),/数据格式/);
 assert.equal(local.getItem(DASHBOARD_CACHE_KEY),saved);
});
