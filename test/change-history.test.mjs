import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openStore} from '../server/store.mjs';
import {historyRecord,syncChangeHistory,recentChanges} from '../server/change-history.mjs';
const now=new Date('2026-10-16T08:00:00+08:00'),fund={code:'000834',name:'测试基金',share:'A',venue:'otc'};
const notice={id:'AN202610141234',code:fund.code,title:'测试基金暂停申购业务的公告',publishedAt:'2026-10-14',sourceUrl:'https://example.test/notice.pdf'};
const text='基金代码000834。自2026年10月15日起暂停本基金申购业务。'+ '本基金的赎回业务仍正常办理，请投资者仔细阅读基金法律文件。'.repeat(8);
function store(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-changes-'));const s=openStore(dir);t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return s;}
test('Historical announcements bypass snapshot baselines, retain unknown prior amount, never create outbound events',async t=>{
 const s=store(t);s.saveNotice({...notice,state:'baseline_covered'});
 const provider={fetchNoticePage:async()=>({notices:[notice],total:1}),fetchNoticeText:async()=>text};
 await syncChangeHistory(s,[fund],provider,now);await syncChangeHistory(s,[fund],provider,now);
 const r=recentChanges(s,now);assert.equal(r.changes.length,1);assert.equal(r.changes[0].after,'暂停申购');assert.equal(r.changes[0].before,'原额度未核验');assert.equal(r.changes[0].sourceUrl,notice.sourceUrl);assert.equal(r.coverage.complete,true);assert.equal(s.events().length,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
});
test('Incomplete/ambiguous history is not a verified zero',async t=>{
 const s=store(t);assert.equal(recentChanges(s,now).coverage.complete,false);
 await syncChangeHistory(s,[fund],{fetchNoticePage:async()=>({notices:[notice],total:1}),fetchNoticeText:async()=>'正文缺失'},now);
 const r=recentChanges(s,now);assert.equal(r.changes.length,0);assert.equal(r.coverage.pendingCount,1);assert.equal(r.coverage.complete,false);
});
test('Effective dates determine 30-day window; historical import time cannot pull old changes into it; future excluded and live duplicate removed',t=>{
 const s=store(t),item=historyRecord(notice,fund,text,now);
 s.setMeta('changeHistory:records',[item,{...item,id:'old',effectiveAt:'2026-09-16T23:59:59+08:00'},{...item,id:'future',effectiveAt:'2026-10-17T00:00:00+08:00'}]);
 s.addEvent({...item,id:'observed',channelKey:'direct',createdAt:now.toISOString()});s.addEvent({...item,id:'late-old-observation',effectiveAt:'2026-09-16T23:59:59+08:00',createdAt:now.toISOString()});
 assert.deepEqual(recentChanges(s,now).changes.map(r=>r.id),[item.id]);
});

 test('30-day history includes older-than-week changes and rejects coverage scanned only for seven days',t=>{
 const s=store(t),item=historyRecord(notice,fund,text,now);
 s.setMeta('changeHistory:records',[{...item,id:'boundary',effectiveAt:'2026-09-17T00:00:00+08:00'},{...item,id:'month',effectiveAt:'2026-10-01T00:00:00+08:00'}]);
 s.setMeta('changeHistory:state',{status:'success',checkedAt:now.toISOString(),windowStart:'2026-10-10'});
 const r=recentChanges(s,now);
 assert.equal(r.window.days,30);assert.deepEqual(r.changes.map(r=>r.id),['month','boundary']);assert.equal(r.coverage.complete,false);
 });

const fixture = id => fs.readFileSync(new URL(`./fixtures/${id}.txt`, import.meta.url),'utf8');
function actual(id, code, title='调整大额申购业务的公告', share='A') {
 return historyRecord({id,code,title,publishedAt:'2026-09-22',sourceUrl:`https://pdf.dfcfw.com/pdf/H2_${id}_1.pdf`},{code,share,name:'实际基金'},fixture(id),now);
}
test('共用万家已核验规则，保留直代不同金额；正文修订后不能沿用核验',()=>{
 const id='AN202609231829774454';
 for(const code of ['019441','019442']){
  const row=actual(id,code);assert.equal(row.state,'verified');assert.equal(row.before,'100 元');assert.equal(row.after,'代销10 元 / 直销100 元');assert.equal(row.afterByChannel.direct.limit,100);assert.equal(row.afterByChannel.agency.limit,10);
  const changed=historyRecord({id,code,title:'调整大额申购业务的公告'},{code,share:'A',name:'万家'},fixture(id)+'修订',now);assert.equal(changed.state,'pending_review');
 }
});
test('核验断字代码、多日期和15点条款，使用实际生效交易日与原额度证据',()=>{
 for(const code of ['019524','019525','022664']){const row=actual('AN202609221829732369',code);assert.equal(row.before,'10 元');assert.equal(row.after,'5 元');assert.equal(row.effectiveAt,'2026-09-22T00:00:00+08:00');}
 for(const code of ['019736','019737']){const row=actual('AN202609241829831132',code);assert.equal(row.before,'200 元');assert.equal(row.after,'10 元');assert.equal(row.effectiveAt,'2026-09-28T00:00:00+08:00');assert.equal(row.beforeSources[0].noticeId,'AN202609071829086210');}
 const htf=actual('AN202609221829742553','018967');assert.equal(htf.before,'1000 元');assert.equal(htf.channel,'直销');assert.equal(htf.effectiveAt,'2026-09-22T00:00:00+08:00');
 const gt=actual('AN202609221829740223','160213');assert.equal(gt.before,'100 元');assert.equal(gt.after,'暂停申购');assert.equal(gt.effectiveAt,'2026-09-28T00:00:00+08:00');
 const cm=actual('AN202610141830429114','019548');assert.equal(cm.before,'10 元');assert.equal(cm.beforeSources.length,2);
});
test('不同渠道原额度均已核验时，不标未知或计算虚假的合计增减；同渠道实时事件去重',t=>{
 const s=store(t),row=actual('AN202609231829773864','014978');assert.equal(row.before,'代销10 元 / 直销100 元');assert.equal(row.after,'5 元');
 const mixed=actual('AN202609231829774454','019441');s.setMeta('changeHistory:records',[row,mixed]);
 s.addEvent({...mixed,id:'live-direct',channelKey:'direct',afterQuota:{status:'open',limit:100},createdAt:now.toISOString()});
 const result=recentChanges(s,now);assert.equal(result.coverage.priorUnknownCount,0);assert.equal(result.changes.length,2);
});
test('广发继续暂停提示没有新变化，美元暂停不得套到人民币份额',()=>{
 for(const code of ['270042','006479','021778']){
  assert.equal(actual('AN202609301830015639',code,'继续暂停申购业务的提示性公告').state,'ignored');
  assert.equal(actual('AN202609101829193911',code,'广发美元份额暂停申购业务的公告').state,'ignored');
  assert.equal(actual('AN202609181829580913',code).before,code==='021778'?'30 元':'2 元');
 }
});
test('重新核验时正文获取失败会撤下旧确认结论，不沿用缓存的已核验状态',async t=>{
 const s=store(t);s.setMeta('changeHistory:records',[historyRecord(notice,fund,text,now)]);
 await syncChangeHistory(s,[fund],{fetchNoticePage:async()=>({notices:[notice],total:1}),fetchNoticeText:async()=>{throw Error('unavailable');}},now);
 const result=recentChanges(s,now);assert.equal(result.changes.length,0);assert.equal(result.coverage.pendingCount,1);assert.equal(result.coverage.complete,false);
});
