import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySalesChannels,correctSalesHistory,salesChannelEvidence} from '../server/sales-channels.mjs';
import {attachShareScopes} from '../server/share-scopes.mjs';
import {totalQuota} from '../src/summary.mjs';
import {fundDataIssues} from '../server/resilience.mjs';
import {currentFund} from '../server/service.mjs';
const now=new Date('2026-10-16T15:00:00Z');
const fund={code:'022525',index:'nasdaq',name:'天弘纳斯达克100',share:'D',manager:'天弘基金',agency:{status:'unavailable',source:'天天基金',observedAt:now.toISOString()},direct:{status:'open',limit:100},fees:{annualRate:0.8,subscription:[{min:0,max:null,standardRate:0,agencyRate:0}]}};
const current=()=>attachShareScopes([applySalesChannels(fund,now)],[],now)[0];
test('D类销售公告明确不上线直销；金额公告不能创造直销可买额度',()=>{
 const text=readFileSync(new URL('./fixtures/AN202411011640657980.txt',import.meta.url),'utf8').replace(/\s/g,'');
 assert.ok(text.includes('本基金D类基金份额暂不上线直销机构'));
 const f=current();assert.equal(f.direct.status,'unavailable');assert.equal(f.direct.limit,null);
 assert.equal(f.agency.limit,100);assert.deepEqual(f.agency.platforms,['腾讯理财通','京东金融']);
 assert.equal(f.agency.availabilityBasis,'user_report');assert.equal(f.agency.tiantian.status,'unavailable');
 assert.equal(totalQuota([f],'direct').amount,0);assert.equal(totalQuota([f],'agency').amount,100);assert.equal(totalQuota([f],'both').amount,100);
});
test('长期额度不随时间过期，保留真实确认时间且不倒填历史',()=>{
 const stale=applySalesChannels({...fund,agency:{...fund.agency,observedAt:'2026-10-20T00:00:00Z'}},new Date('2026-10-20T00:00:00Z'));
 assert.equal(stale.agency.status,'open');assert.equal(stale.agency.limit,100);assert.equal(stale.agency.observedAt,salesChannelEvidence['022525'].reportedAt);
 const future=new Date('2030-10-20T00:00:00Z'),persistent=applySalesChannels(fund,future);
 assert.equal(persistent.agency.status,'open');assert.equal(persistent.agency.limit,100);
 assert.ok(!fundDataIssues(persistent,future).some(issue=>issue.startsWith('代销额度')));
 assert.ok(fundDataIssues(fund,future).includes('代销额度待更新'));
 const row={date:'2026-10-15',status:'open',limit:100};
 assert.equal(correctSalesHistory(fund.code,'direct',row).limit,0);assert.equal(correctSalesHistory(fund.code,'direct',row).status,'unavailable');
 assert.equal(correctSalesHistory(fund.code,'agency',row).status,'unknown');assert.equal(correctSalesHistory(fund.code,'agency',row).limit,null);
 assert.deepEqual(correctSalesHistory('other','direct',row),row);
});
test('长期额度遇到新额度公告仍需核验，不掩盖规则变化',()=>{
 for(const direct of [{pendingReview:true},{effectiveAt:'2026-10-20T00:00:00+08:00'}]) {
  const updated=applySalesChannels({...fund,direct},new Date('2026-10-21T00:00:00Z'));
  assert.equal(updated.agency.status,'unknown');assert.equal(updated.agency.limit,null);
  assert.ok(fundDataIssues(updated,new Date('2026-10-21T00:00:00Z')).includes('代销额度待确认'));
 }
});

test('天弘纳指D人工复核覆盖旧待核验公告，但不覆盖未来或无日期公告',()=>{
 const at=new Date('2026-10-18T14:00:00Z');
 const pending={pendingReview:true,pendingPublishedAt:'2026-09-01',effectiveAt:'2026-06-01T00:00:00+08:00'};
 const reviewed=applySalesChannels({...fund,direct:pending},at);
 assert.equal(reviewed.agency.status,'open');assert.equal(reviewed.agency.limit,100);
 assert.equal(reviewed.agency.observedAt,salesChannelEvidence['022525'].reportedAt);
 assert.equal(reviewed.direct.status,'unavailable');
 assert.ok(!fundDataIssues(reviewed,at).some(issue=>issue.startsWith('代销额度')));
 for(const pendingPublishedAt of ['2026-10-19',undefined]) {
  const updated=applySalesChannels({...fund,direct:{...pending,pendingPublishedAt}},new Date('2026-10-20'));
  assert.equal(updated.agency.status,'unknown');assert.equal(updated.agency.limit,null);
 }
 assert.equal(applySalesChannels({...fund,direct:pending},new Date('2026-10-17')).agency.status,'unknown');
 assert.equal(applySalesChannels({...fund,direct:pending},new Date('2026-10-20'),{effectiveAt:'2026-10-19T00:00:00+08:00'}).agency.status,'unknown');
 assert.equal(correctSalesHistory('022525','agency',{date:'2026-10-15',status:'open',limit:100}).status,'unknown');
});

test('当前基金携带最新待核验公告日期，人工确认不被旧公告重置',()=>{
 const at=new Date('2026-10-18T14:00:00Z');
 const notices=[{publishedAt:'2026-09-01'},{publishedAt:'2026-03-31'}];
 const store={snapshot:()=>({...fund,observedAt:at.toISOString()}),activeRule:()=>({status:'paused',limit:null,effectiveAt:'2026-06-01T00:00:00+08:00'}),pendingNotices:()=>notices,getMeta:()=>({complete:true,checkedAt:at.toISOString()})};
 assert.equal(currentFund(store,fund,at).agency.status,'open');
 notices.push({publishedAt:'2026-10-19'});
 assert.equal(currentFund(store,fund,new Date('2026-10-20')).agency.status,'unknown');
});

test('标普D只在已确认代销平台计100元，不再混入直销及其历史',()=>{
 const text=readFileSync(new URL('./fixtures/AN202411011640656967.txt',import.meta.url),'utf8').replace(/\s/g,'');
 assert.ok(text.includes('本基金D类基金份额暂不上线直销机构'));
 const baseline=JSON.parse(readFileSync(new URL('../server/verified-baseline.json',import.meta.url)));
 assert.ok(!baseline.some(r=>r.code==='022523'&&r.channel==='direct'&&r.status==='open'));
 const at=new Date('2026-10-18T08:00:00Z');
 const f=attachShareScopes([applySalesChannels({...fund,code:'022523',index:'sp500',name:'天弘标普500'},at)],[],at)[0];
 assert.equal(f.direct.status,'unavailable');assert.equal(f.agency.status,'open');assert.equal(f.agency.limit,100);
 assert.deepEqual(f.agency.platforms,['腾讯理财通','京东金融']);
 for(const [channel,amount] of [['direct',0],['agency',100],['both',100]])assert.equal(totalQuota([f],channel).amount,amount);
 const row={date:'2026-10-16',status:'open',limit:100};
 assert.equal(correctSalesHistory('022523','direct',row).limit,0);
 assert.equal(correctSalesHistory('022523','agency',row).limit,null);
 const changed=applySalesChannels({...fund,code:'022523'},at,{effectiveAt:'2026-10-18T00:00:00+08:00',status:'paused'});
 assert.equal(changed.agency.status,'unknown');assert.equal(changed.agency.limit,null);
});
