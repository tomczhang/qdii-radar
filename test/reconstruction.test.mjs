import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {interpretHistoryNotice,reconstructDays,backfillQuotas,isHistoryQuotaNotice,includeReviewedHolidays} from '../server/reconstruction.mjs';
import {quotaStability} from '../server/analytics.mjs';
import {openStore} from '../server/store.mjs';
const dates=['2026-09-04','2026-09-07','2026-09-08','2026-09-09'];
const base={channel:'agency',date:'2026-09-04',publishedAt:'2026-09-03',status:'open',limit:10,sourceUrl:'https://example.com/cap'};
test('Replay respects effective date, temporary closure, underlying suspension and unknown initial period',()=>{
 const documents=[{rules:[base,{...base,channel:'direct',limit:100}],holidays:[{from:'2026-09-07',to:'2026-09-08',sourceUrl:'https://example.com/holiday'}]}];
 let rows=reconstructDays({code:'000834',dates:['2026-09-03',...dates],documents});
 assert.deepEqual(rows.filter(r=>r.channel==='agency').map(r=>r.limit),[null,10,0,10,10]);assert.equal(rows.find(r=>r.date==='2026-09-07').sourceUrl,'https://example.com/holiday');
 documents.push({rules:[{...base,date:'2026-09-04',publishedAt:'2026-09-04',status:'paused',limit:0}]});
 rows=reconstructDays({code:'000834',dates,documents});assert.equal(rows.find(r=>r.channel==='agency'&&r.date==='2026-09-08').limit,0);
 assert.equal(reconstructDays({code:'x',dates,documents,complete:false}).length,0);
 assert.equal(reconstructDays({code:'x',dates,documents,established:'2026-09-08'})[0].limit,null);
});
test('Conflicting rules and incomplete holiday schedule stay unknown; holiday does not lift an independent suspension',()=>{
 const docs=[{rules:[base,{...base,limit:20}]}];assert.equal(reconstructDays({code:'x',dates,documents:docs})[0].limit,null);
 const blocks=[{kind:'holiday',from:'2026-01-01',to:'2027-01-01',reason:'待核验'}];
 assert.equal(reconstructDays({code:'x',dates,documents:[{rules:[base],blocks}]})[0].limit,null);
 assert.equal(reconstructDays({code:'x',dates,documents:[{rules:[{...base,status:'paused',limit:0}],blocks}]})[0].limit,0);
});
test('Temporary holiday uses whitespace code boundaries; unreviewed annual document never treats publication/reference dates as holidays',()=>{
 const n={id:'test',title:'关于2026年9月7日境外节假日暂停业务的公告',publishedAt:'2026-09-03'};
 const text='基金代码\n2 019547\n2026年9月7日暂停申购，于2026年9月8日恢复。';
 const r=interpretHistoryNotice(n,{code:'019547'},text);assert.equal(r.holidays[0].from,'2026-09-07');assert.equal(r.holidays[0].to,'2026-09-08');
 const unrelated=interpretHistoryNotice(n,{code:'999999'},text);assert.equal(unrelated.blocks[0].to,'2026-09-08');
 const annual=interpretHistoryNotice({...n,title:'2026年境外节假日安排'},{code:'019547'},'019547 自2026年1月7日暂停。节假日2026年9月7日。2026年1月15日公告。');assert.equal(annual.holidays.length,0);assert.equal(annual.blocks[0].to,'2027-01-01');
});
function storeFor(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reconstruction-'));const s=openStore(dir);t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return s;}
test('Observations override estimates including unknowns, provenance survives, failed scans disable estimates',t=>{
 const s=storeFor(t),now=new Date('2026-09-10T08:00:00+08:00');s.setMeta('tradingCalendar',{dates,checkedAt:now.toISOString()});s.setMeta('quotaBackfill:x',{status:'success',scanComplete:true});
 s.replaceQuotaEstimates('x',reconstructDays({code:'x',dates,documents:[{rules:[base]}]}));assert.equal(s.quotaDays('x',dates[0],dates.at(-1)).length,0);
 s.saveQuotaDay({code:'x',channel:'agency',date:dates[1],status:'unknown',limit:null,observedAt:dates[1]+'T16:00:00+08:00'});
 s.saveQuotaDay({code:'x',channel:'agency',date:dates[2],status:'open',limit:30,observedAt:dates[2]+'T16:00:00+08:00'});
 const r=quotaStability(s,'x',now).agency;assert.equal(r.knownTotal,50);assert.equal(r.inferredDays,2);assert.equal(r.observedDays,1);assert.equal(r.coveredDays,3);assert.equal(r.segments[0].sourceUrl,base.sourceUrl);assert.equal(r.total,null);
 s.setMeta('quotaBackfill:x',{status:'failed'});assert.equal(quotaStability(s,'x',now).agency.knownTotal,30);
});
test('Backfill scan failure does not manufacture rows or touch observed history',async t=>{
 const s=storeFor(t),now=new Date('2026-10-16T08:00:00+08:00');const days=Array.from({length:30},(_,i)=>new Date(+now-(30-i)*86400000).toISOString().slice(0,10));s.setMeta('tradingCalendar',{dates:days});
 const r=await backfillQuotas(s,[{code:'x',venue:'otc'}],{now,providers:{fetchNoticePage:async()=>{throw new Error('offline')}}});assert.deepEqual(r.errors,['x']);assert.equal(s.getMeta('quotaBackfill:x').status,'failed');assert.equal(s.quotaEstimates('x',days[0],days.at(-1)).length,0);
});

test('南方I真实公告：200元规则只适用I份额，30交易日扣除9月7日暂停，正文变化须重核',()=>{
 const cap={id:'AN202607201827139668',title:'关于调整南方纳斯达克100指数发起式证券投资基金(QDII)I类基金份额申购、定投及转换转入业务金额限制的公告',publishedAt:'2026-07-20',sourceUrl:'https://pdf.dfcfw.com/pdf/H2_AN202607201827139668_1.pdf'};
 const holiday={id:'AN202601081816834237',title:'关于南方纳斯达克100指数发起式证券投资基金(QDII)2026年境外主要市场节假日申购赎回安排的公告',publishedAt:'2026-01-08',sourceUrl:'https://pdf.dfcfw.com/pdf/H2_AN202601081816834237_1.pdf'};
 const text=fs.readFileSync(new URL('./fixtures/'+cap.id+'.txt',import.meta.url),'utf8');
 const holidayText=fs.readFileSync(new URL('./fixtures/'+holiday.id+'.txt',import.meta.url),'utf8');
 const fund={code:'021000',share:'I'};
 const rule=interpretHistoryNotice(cap,fund,text), holidays=interpretHistoryNotice(holiday,fund,holidayText);
 assert.equal(isHistoryQuotaNotice(holiday.title),true);
 assert.equal(isHistoryQuotaNotice('南方基金2026年半年报'),false);
 assert.equal(rule.rules.find(r=>r.channel==='direct').limit,200);
 assert.equal(rule.rules.find(r=>r.channel==='direct').date,'2026-07-21');
 assert.equal(interpretHistoryNotice(cap,{code:'016452',share:'A'},text).rules.length,0);
 assert.ok(!interpretHistoryNotice(cap,fund,text+'修订').rules.some(r=>r.limit===200));
 const dates=[];for(let d=new Date('2026-08-27T00:00:00Z');d<=new Date('2026-10-15T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10);if(![0,6].includes(d.getUTCDay())&&!(date>='2026-10-01'&&date<='2026-10-07')&&date!=='2026-09-25')dates.push(date);}
 // Sep 25 is the mainland Mid-Autumn holiday; no weekend make-up stock sessions.
 assert.equal(dates.length,30);
 const rows=reconstructDays({code:fund.code,dates,documents:[rule,holidays]});const direct=rows.filter(r=>r.channel==='direct');
 assert.equal(direct.filter(r=>r.status==='open').length,29);assert.equal(direct.reduce((sum,r)=>sum+r.limit,0),5800);
 assert.equal(direct.find(r=>r.date==='2026-09-07').status,'paused');assert.equal(direct.find(r=>r.date==='2026-09-08').limit,200);
 assert.ok(rows.filter(r=>r.channel==='agency').some(r=>r.status==='unknown'));
});

test('已核验的全基金休市安排涵盖C份额，即使C公告列表未重复收录；不复制限额',()=>{
 const notices=includeReviewedHolidays([], '008971','2025-08-27','2026-10-16');
 assert.ok(notices.some(n=>n.id==='AN202601071816490761'));
 assert.ok(notices.every(n=>n.title.includes('节假日')));
 assert.equal(includeReviewedHolidays([], '999999','2025-08-27','2026-10-16').length,0);
 assert.equal(includeReviewedHolidays(notices,'008971','2025-08-27','2026-10-16').length,notices.length);
});

test('万家A/C真实公告：直销早已开放，回放额度调整及境外休市，不用当前100元倒填历史',()=>{
 const notices=[
  {id:'AN202607091826830545',publishedAt:'2026-07-09'},
  {id:'AN202609081829134250',publishedAt:'2026-09-09'},
  {id:'AN202609091829169340',publishedAt:'2026-09-10'},
  {id:'AN202609231829774454',publishedAt:'2026-09-23'},
  {id:'AN202601151817031734',publishedAt:'2026-01-15',title:'2026年境外主要投资场所节假日暂停申购、赎回、定期定额投资业务的公告'},
 ].map(n=>({title:'关于万家纳斯达克100指数型发起式证券投资基金(QDII)调整大额申购（含定期定额投资）业务金额限制的公告',...n,sourceUrl:`https://pdf.dfcfw.com/pdf/H2_${n.id}_1.pdf`}));
 const dates=[];
 for(let d=new Date('2026-08-27T00:00:00Z');d<=new Date('2026-10-15T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
  const date=d.toISOString().slice(0,10);
  if(![0,6].includes(d.getUTCDay())&&date!=='2026-09-25'&&!(date>='2026-10-01'&&date<='2026-10-07'))dates.push(date);
 }
 for(const fund of [{code:'019441',share:'A'},{code:'019442',share:'C'}]){
  const documents=notices.map(n=>interpretHistoryNotice(n,fund,fs.readFileSync(new URL(`./fixtures/${n.id}.txt`,import.meta.url),'utf8')));
  const rows=reconstructDays({code:fund.code,dates,documents});
  for(const [channel,total] of [['agency',6090],['direct',22080]]){
   const values=rows.filter(r=>r.channel===channel);
   assert.equal(values.length,30);assert.equal(values.filter(r=>r.status==='open').length,29);
   assert.equal(values.reduce((sum,r)=>sum+r.limit,0),total);
   assert.ok(values.every(r=>r.status!=='unknown'));
  }
  const direct=rows.filter(r=>r.channel==='direct');
  assert.deepEqual(['2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-23'].map(date=>direct.find(r=>r.date===date).limit),[10,0,10,20000,100,100]);
  const mixed=notices[1],text=fs.readFileSync(new URL(`./fixtures/${mixed.id}.txt`,import.meta.url),'utf8');
  assert.ok(!interpretHistoryNotice(mixed,fund,text+'修订').rules.some(r=>r.limit===20000));
 }
});
