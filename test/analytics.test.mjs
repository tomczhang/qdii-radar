import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../server/store.mjs';
import {parseEtfQuotes, parseTradingDates, quotaStability, recordQuotaDay, seedQuotaHistory} from '../server/analytics.mjs';
const now = new Date('2026-10-16T08:00:00+08:00');
const fixture = rows => ({structuredContent:{code:0, results:[{api_name:'场内基金日行情',table_markdown:'|基金代码|交易日|收盘价(元)|折溢价率(%)|涨跌幅(%)|\n|---|---|---|---|---|\n'+rows.map(r=>'|'+r.join('|')+'|').join('\n')}]}});
function database(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-history-'));const s=openStore(dir);t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return s; }
// A synthetic exchange calendar deliberately excludes a weekday holiday and includes weekends nowhere.
function calendar() { const result=[];for(let i=120;i>=0;i--){const d=new Date(+now-i*86400000),date=d.toISOString().slice(0,10);if(![0,6].includes(d.getUTCDay()) && date!=='2026-10-01')result.push(date);}return result; }
test('ETF parser uses provider daily premium, keeps zero/discount and isolates symbols/latest dates',()=>{
 const r=parseEtfQuotes(fixture([['159659','2026-10-14',2.4,9,-1],['159659','2026-10-15',2.43,12.054,-3.457],['513100','2026-10-15',2,0,0],['513500','2026-10-15',2,-1.2,-2],['000001','2026-10-15',2,900,2],['159659','2026-10-17',2,10,1]]),['159659','513100','513500','999999'],'2026-10-16');
 assert.deepEqual(r.map(q=>q.premium),[12.054,0,-1.2]);assert.equal(r[0].price,2.43);assert.equal(r[0].date,'2026-10-15');
 assert.equal(parseEtfQuotes(fixture([['159659','2026-10-15',2,12,1],['159659','2026-10-15',2,13,1]]),['159659']).length,0);
 assert.equal(parseEtfQuotes(fixture([['159659','2026-10-15',2,'--',1]]),['159659']).length,0);
});
test('Trading dates come from actual bars, deduplicate, exclude today/future and reject wrong instrument',()=>{
 const payload={rc:0,data:{code:'000001',market:1,klines:[...calendar(), '2026-10-15','2026-10-19'].map(d=>d+',1,1,1,1,1,1')}};
 const dates=parseTradingDates(payload,'2026-10-16');assert.equal(dates.at(-1),'2026-10-15');assert.ok(!dates.includes('2026-10-01'));assert.equal(dates.length,new Set(dates).size);
 assert.throws(()=>parseTradingDates({...payload,data:{...payload.data,code:'000002'}}));
 assert.throws(()=>parseTradingDates({...payload,data:{...payload.data,klines:[]}}));
});
test('20 completed sessions: channels separate, duplicate day replaced, unknown not zero, current day excluded',t=>{
 const s=database(t);s.setMeta('tradingCalendar',{dates:calendar(),checkedAt:now.toISOString()});const dates=calendar().filter(d=>d<'2026-10-16').slice(-20);
 const put=(date,channel,status,limit,at='16:00')=>s.saveQuotaDay({code:'000834',channel,date,status,limit,observedAt:date+'T'+at+':00+08:00'});
 for(const date of dates)put(date,'agency','open',10);
 put(calendar().filter(d=>d<dates[0]).at(-1),'agency','open',99999); // Outside the 20-session window must be excluded.
 put(dates[0],'agency','paused',0,'17:00');put(dates.at(-1),'agency','open',30,'17:00');put('2026-10-16','agency','open',99999);
 put(dates[0],'direct','open',100);put(dates[1],'direct','paused',0);put(dates[2],'direct','unknown',null);
 const r=quotaStability(s,'000834',now);assert.equal(r.agency.total,210);assert.equal(r.agency.coveredDays,20);assert.equal(r.agency.openDays,19);assert.equal(r.direct.knownTotal,100);assert.equal(r.direct.total,null);assert.equal(r.direct.coveredDays,2);assert.equal(r.direct.missingDays,18);assert.equal(r.endDate,'2026-10-15');
 assert.equal(quotaStability(s,'missing',now).agency.knownTotal,null);
 assert.equal(quotaStability(s,'000834',new Date(+now+2*86400000)).agency.total,null);
});
test('History is only saved for genuinely checked date, never propagated from stale snapshots or future rules',t=>{
 const s=database(t);const fund={code:'000834',venue:'otc',agency:{status:'open',limit:10,observedAt:'2026-10-15T09:00:00+08:00'},direct:{status:'open',limit:100,effectiveAt:'2026-10-17T00:00:00+08:00'},noticeCheckedAt:now.toISOString()};
 recordQuotaDay(s,fund,now);assert.equal(s.quotaDays(fund.code,'2026-01-01','2026-12-31').length,0);
 fund.agency.observedAt=now.toISOString();fund.direct.effectiveAt='2026-10-15T00:00:00+08:00';recordQuotaDay(s,fund,now);assert.equal(s.quotaDays(fund.code,'2026-01-01','2026-12-31').length,2);
 fund.direct={status:'unknown',limit:null};recordQuotaDay(s,fund,now);assert.equal(s.quotaDays(fund.code,'2026-01-01','2026-12-31').find(r=>r.channel==='direct').status,'unknown');
 fund.venue='etf';fund.code='159659';recordQuotaDay(s,fund,now);assert.equal(s.quotaDays(fund.code,'2026-01-01','2026-12-31').length,0);
});

test('Migration imports only actual published observations, skips pending verification, persists once', t => {
 const s=database(t), at='2026-10-15T08:00:00.000Z';
 const published={code:'000834',venue:'otc',agency:{status:'open',limit:10,observedAt:at},direct:{status:'open',limit:100,effectiveAt:'2026-10-14T00:00:00+08:00'},noticeCheckedAt:at,stale:false,pendingNoticeCount:0};
 s.setMeta('published:000834',published);s.setMeta('published:000835',{...published,code:'000835',pendingNoticeCount:1});
 const funds=[{code:'000834',venue:'otc'},{code:'000835',venue:'otc'}];seedQuotaHistory(s,funds);
 assert.equal(s.quotaDays('000834','2026-01-01','2026-12-31').length,2);assert.equal(s.quotaDays('000835','2026-01-01','2026-12-31').length,0);
 published.agency.limit=999;s.setMeta('published:000834',published);seedQuotaHistory(s,funds);assert.equal(s.quotaDays('000834','2026-01-01','2026-12-31')[0].limit,10);
 const reopened=openStore(s.directory);assert.equal(reopened.quotaDays('000834','2026-01-01','2026-12-31').length,2);reopened.close();
});
