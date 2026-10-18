import {sumCombinedQuota} from '../shared/combined-quota.mjs';
import { STABILITY_WINDOW_DAYS } from '../shared/config.mjs';
import {sumQuotaRows,quotaContribution} from '../shared/quota-scope.mjs';

export function totalQuota(funds, channel) {
  const otc=funds.filter(f=>f.venue!=='etf');
  if(channel==='both')return sumCombinedQuota(otc.map((f,i)=>({...f,code:f.code||String(i)})));
  const total=sumQuotaRows(otc.map((f,i)=>({code:f.code||String(i),quota:f[channel]})));
  return {...total,open:otc.filter(f=>f[channel]?.status==='open').length,count:otc.length};
}
export function quotaDelta(event) {
  const amount = q => q?.status === 'open' && Number.isFinite(q.limit) ? q.limit : q?.status === 'paused' ? 0 : null;
  const before = amount(event.beforeQuota), after = amount(event.afterQuota);
  return before == null || after == null ? null : after - before;
}

export function totalHistoricalQuota(funds, channel) {
  if(channel==='both')return totalCombinedHistoricalQuota(funds);
  const otc=funds.filter(f=>f.venue!=='etf'), byDate=new Map();
  let completeCount=0,scopeUnknownDays=0,unknownDays=0;
  for(const [i,f] of otc.entries()){
    const h=f.stability;
    if(!h?.calendarReady || h.windowDays!==STABILITY_WINDOW_DAYS || !Array.isArray(h[channel]?.daily)){unknownDays+=STABILITY_WINDOW_DAYS;continue;}
    let covered=0;
    const rows=[...new Map(h[channel].daily.map(row=>[row.date,row])).values()];
    for(const row of rows){
      if(row.date<h.startDate || row.date>h.endDate)continue;
      const value=quotaContribution(f.code||String(i),row);
      if(value.known)covered++;
      if(!byDate.has(row.date))byDate.set(row.date,[]);
      byDate.get(row.date).push({code:f.code||String(i),quota:row});
    }
    if(covered===STABILITY_WINDOW_DAYS)completeCount++;
    unknownDays+=Math.max(0,STABILITY_WINDOW_DAYS-rows.length);
  }
  let amount=0,knownDates=0;
  for(const rows of byDate.values()){
    const total=sumQuotaRows(rows);scopeUnknownDays+=total.scopeUnknown;unknownDays+=total.unknown;
    if(total.amount!=null){amount+=total.amount;knownDates++;}
  }
  return {amount:knownDates?Math.round(amount*100)/100:null,count:otc.length,completeCount,complete:otc.length>0&&completeCount===otc.length&&unknownDays===0,scopeUnknownDays,unknownDays};
}

// Historical combination reads dated rules only; a current independent rule must
// never be copied backwards. Missing dates and unverified scope remain partial.
export function totalCombinedHistoricalQuota(funds) {
  const otc=funds.filter(f=>f.venue!=='etf').map((f,i)=>({...f,code:f.code||String(i)})),dates=new Set();
  const histories=otc.map(f=>{
    const h=f.stability,valid=h?.calendarReady&&h.windowDays===STABILITY_WINDOW_DAYS;
    return Object.fromEntries(['agency','direct'].map(channel=>{
      const rows=valid?(h[channel]?.daily||[]).filter(r=>r.date>=h.startDate&&r.date<=h.endDate):[];
      rows.forEach(r=>dates.add(r.date));return [channel,new Map(rows.map(r=>[r.date,r]))];
    }));
  });
  let amount=0,knownDates=0,unknownDays=0,scopeUnknownDays=0,channelUnknownDays=0;
  const covered=otc.map(()=>0);
  const windowDates=[...dates].sort().slice(-STABILITY_WINDOW_DAYS);
  for(const date of windowDates) {
    const day=otc.map((f,i)=>{
      const agency=histories[i].agency.get(date),direct=histories[i].direct.get(date);
      // Both rows are produced from the same historical rule. A mismatch in an
      // external/legacy snapshot is ambiguous, not permission to add channels.
      const scopes=[agency?.channelScope,direct?.channelScope].filter(Boolean);
      const channelScope=scopes.length&&scopes.every(s=>s.mode===scopes[0].mode)?scopes[0]:{mode:'unknown'};
      const row={code:f.code,index:f.index,currency:f.currency,agency,direct,channelScope};
      const a=quotaContribution(f.code,agency),d=quotaContribution(f.code,direct);
      if(a.known&&d.known&&(!(a.amount&&d.amount)||['shared','independent'].includes(channelScope.mode)))covered[i]++;
      return row;
    });
    const total=sumCombinedQuota(day);
    if(total.amount!=null){amount+=total.amount;knownDates++;}
    unknownDays+=total.unknown;scopeUnknownDays+=total.scopeUnknown;channelUnknownDays+=total.channelUnknown;
  }
  unknownDays+=Math.max(0,STABILITY_WINDOW_DAYS-windowDates.length)*otc.length;
  const completeCount=covered.filter(n=>n===STABILITY_WINDOW_DAYS).length;
  return {amount:knownDates?Math.round(amount*100)/100:null,count:otc.length,completeCount,
    complete:otc.length>0&&completeCount===otc.length&&unknownDays===0&&channelUnknownDays===0,
    unknownDays,scopeUnknownDays,channelUnknownDays,knownDates};
}
