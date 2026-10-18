import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';
import {synchronize, getCatalog, dashboard} from '../server/service.mjs';

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(tmpdir(),'radar-progress-'));
  const store=openStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const catalog=getCatalog(store).filter(f=>f.venue!=='etf').slice(0,4);
  const events=[], calls=[], marketCalls=new Map();
  const mail={configured:false,queueEvent:event=>events.push(event),deliver:async()=>{}};
  const data=fund=>({...fund,agency:{status:'open',limit:100,observedAt:new Date().toISOString()},
    observedAt:new Date().toISOString(),established:'2010-01-01',returns:{y1:10,y3:30,y5:50},returnsAsOf:'2026-10-15',
    navAsOf:'2026-10-15',dailyChange:1,trend:[100,101],trendDates:['2026-10-14','2026-10-15'],
    performanceSource:'天天基金',navSource:'天天基金',trendSource:'天天基金'});
  const tasks={
    discoverFunds:async()=>({status:'success',added:[]}),getCatalog:()=>catalog,gildataConfigured:()=>true,
    fetchMarket:async fund=>{marketCalls.set(fund.code,(marketCalls.get(fund.code)||0)+1);return data(fund);},
    fetchGildata:async fund=>({...data(fund),returns:{y1:11,y3:31,y5:51},performanceSource:'恒生聚源',navSource:'恒生聚源',trendSource:'恒生聚源'}),
    syncNotices:async(store,fund)=>{calls.push('notice');store.setMeta(`noticeScan:${fund.code}`,{complete:true,checkedAt:new Date().toISOString()});},
    syncAnalytics:async()=>{calls.push('analytics');},syncChangeHistory:async()=>{calls.push('history');},backfillQuotas:async()=>{calls.push('backfill');},
  };
  return {store,catalog,mail,tasks,events,calls,marketCalls,data};
}

test('all primary quotas and notices are visible while Gildata is blocked; history follows enrichment',async t=>{
  const {store,catalog,mail,tasks,events,calls,marketCalls}=fixture(t);
  const ready=Promise.withResolvers(), gate=Promise.withResolvers();
  const fetchGildata=tasks.fetchGildata;
  tasks.fetchGildata=async fund=>{ready.resolve();await gate.promise;return fetchGildata(fund);};
  const run=synchronize(store,mail,{tasks});
  await ready.promise;
  try {
    assert.equal(store.getMeta('lastRun').phase,'performance');
    assert.equal(store.getMeta('lastRun').status,'running');
    assert.ok(store.getMeta('marketUpdatedAt'));
    assert.equal(calls.filter(c=>c==='notice').length,4);
    assert.ok(!calls.includes('history'));
    const board=dashboard(store,mail);
    for(const fund of catalog) {
      const current=board.funds.find(f=>f.code===fund.code);
      assert.equal(current.agency.limit,100);
      assert.equal(current.performanceSource,'天天基金');
      assert.ok(store.getMeta(`published:${fund.code}`));
      assert.ok(store.quotaDays(fund.code,'2000-01-01','2099-01-01').some(r=>r.channel==='agency'&&r.limit===100));
    }
    assert.deepEqual(events,[],'first load must not send change alerts');
  } finally {gate.resolve();await run;}
  const result=await run;
  assert.equal(result.status,'success');
  assert.equal(result.marketSuccess,4);
  assert.equal(result.gildataSuccess,4);
  assert.equal(result.marketErrors,0);
  assert.deepEqual(calls.slice(-3),['analytics','history','backfill']);
  for(const fund of catalog) {
    assert.equal(marketCalls.get(fund.code),1);
    assert.equal(store.snapshot(fund.code).returns.y1,11);
    assert.equal(store.snapshot(fund.code).agency.limit,100);
  }
});

test('source failures still fall back per field without refreshing old agency dates',async t=>{
  const {store,catalog,mail,tasks,data}=fixture(t);
  const oldAt='2026-10-01T00:00:00.000Z';
  store.saveSnapshot({...data(catalog[0]),agency:{status:'open',limit:25,observedAt:oldAt},observedAt:oldAt});
  const market=tasks.fetchMarket,gildata=tasks.fetchGildata;
  tasks.fetchMarket=async fund=>{if(fund.code===catalog[0].code)throw new Error('unavailable');return market(fund);};
  let retries=0;
  tasks.fetchGildata=async fund=>{if(fund.code===catalog[1].code){retries++;throw new Error('unavailable');}return gildata(fund);};
  const result=await synchronize(store,mail,{tasks});
  assert.equal(result.status,'partial');
  assert.equal(result.marketErrors,1);
  assert.equal(result.gildataErrors,1);
  assert.equal(retries,2);
  assert.equal(store.snapshot(catalog[0].code).agency.observedAt,oldAt);
  assert.equal(store.snapshot(catalog[0].code).agency.limit,25);
  assert.equal(store.snapshot(catalog[0].code).returns.y1,11);
  assert.equal(store.snapshot(catalog[1].code).returns.y1,10);
  assert.deepEqual(store.getMeta(`sourceHealth:${catalog[1].code}`).unresolved,[]);
});

test('history failure cannot discard collected quotas or leave sync running',async t=>{
  const {store,catalog,mail,tasks}=fixture(t);
  tasks.gildataConfigured=()=>false;
  tasks.fetchGildata=()=>{throw new Error('must not run');};
  tasks.syncChangeHistory=async()=>{throw new Error('history unavailable');};
  const result=await synchronize(store,mail,{tasks});
  assert.equal(result.status,'failed');
  assert.ok(store.getMeta('marketUpdatedAt'));
  for(const fund of catalog) assert.equal(store.snapshot(fund.code).agency.limit,100);
  assert.equal(store.db.prepare("SELECT * FROM leases WHERE name='synchronize'").get(),undefined);
});

test('notices-only sync never fetches or re-dates market data',async t=>{
  const {store,mail,tasks}=fixture(t);
  tasks.fetchMarket=tasks.fetchGildata=tasks.syncAnalytics=async()=>{throw new Error('must not run');};
  const result=await synchronize(store,mail,{tasks,noticesOnly:true});
  assert.equal(result.status,'success');
  assert.equal(result.marketSuccess,0);
  assert.equal(store.getMeta('marketUpdatedAt'),null);
});
