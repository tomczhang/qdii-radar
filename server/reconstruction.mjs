import { STABILITY_WINDOW_DAYS } from '../shared/config.mjs';
import {readFileSync} from 'node:fs';
import {chinaDate,digest,isQuotaNotice,noticeShares,parseQuotaNotice} from './domain.mjs';
import {fetchNoticePage,fetchNoticeText} from './providers.mjs';
const reviewedRules=JSON.parse(readFileSync(new URL('./verified-history-rules.json',import.meta.url)));
const SCAN_VERSION=3;
const baseline=JSON.parse(readFileSync(new URL('./verified-baseline.json',import.meta.url)));
const reviewedHolidays=JSON.parse(readFileSync(new URL('./verified-holidays.json',import.meta.url)));
const reviewedChanges=JSON.parse(readFileSync(new URL('./verified-change-history.json',import.meta.url)));
const norm=t=>(t||'').normalize('NFKC').replace(/\s+/g,'');
const dateValue=(y,m,d)=>{const date=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;return Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:null;};
const datesIn=t=>[...new Set([...t.matchAll(/(20\d{2})(?:年|\/|-)(\d{1,2})(?:月|\/|-)(\d{1,2})日?/g)].map(m=>dateValue(...m.slice(1))).filter(Boolean))];
const codeIn=(t,code)=>new RegExp(`(?<!\\d)${code}(?!\\d)`).test(t);
const holidayTitle=t=>/节假日|非交易日|休市/.test(t);
export const isHistoryQuotaNotice=title=>isQuotaNotice(title)||(holidayTitle(title)&&/申购|定投|开放日/.test(title));

export function interpretHistoryNotice(notice,fund,text,familyCodes=[fund.code]) {
  const t=norm(text), base={noticeId:notice.id,sourceUrl:notice.sourceUrl,title:notice.title,publishedAt:notice.publishedAt,textHash:digest(text)};
  const uncertain=reason=>({rules:[],holidays:[],blocks:[{...base,from:notice.publishedAt,to:null,reason}],pending:reason});
  if(holidayTitle(notice.title)) {
    const reviewed=reviewedHolidays.find(r=>r.noticeId===notice.id&&r.codes.includes(fund.code)&&r.textHash===base.textHash);
    if(reviewed)return {rules:[],blocks:[],holidays:reviewed.dates.map(date=>({...base,from:date,to:chinaDate(new Date(Date.parse(date+'T00:00:00+08:00')+86400000))})),pending:null};
    // Keep raw whitespace for code boundaries: PDF row numbers must not join six-digit codes.
    const titleDates=datesIn(norm(notice.title));
    const restore=t.match(/(?:于|自|从)(20\d{2})年(\d{1,2})月(\d{1,2})日(?:起)?恢复/);
    const end=restore&&dateValue(...restore.slice(1));
    const start=titleDates.length===1?titleDates[0]:null;
    if(start&&end&&end>start&&codeIn(text,fund.code)&&/暂停/.test(t))return {rules:[],blocks:[],holidays:[{...base,from:start,to:end}],pending:null};
    const result=uncertain('节假日适用范围或暂停/恢复日期需核验');
    result.blocks[0].kind='holiday';
    const annualYear=norm(notice.title).match(/(20\d{2})年/);
    if(start&&end&&end>start)Object.assign(result.blocks[0],{from:start,to:end});
    else if(annualYear&&titleDates.length===0)Object.assign(result.blocks[0],{from:`${annualYear[1]}-01-01`,to:`${Number(annualYear[1])+1}-01-01`});
    return result;
  }
  const shares=noticeShares(norm(notice.title));
  if(shares.length&&fund.share&&!shares.includes(fund.share))return {rules:[],blocks:[],holidays:[],pending:null};
  const reviewed=reviewedChanges.find(r=>r.noticeId===notice.id&&r.code===fund.code&&r.textHash===base.textHash);
  if(reviewed?.state==='ignored')return {rules:[],blocks:[],holidays:[],pending:null};
  const parsed=parseQuotaNotice({...notice,code:fund.code,share:fund.share,text});
  if(parsed.status==='ignored')return{rules:[],blocks:[],holidays:[],pending:null};
  let rules=parsed.status==='parsed'?parsed.rules:[];
  if(reviewed)rules=(reviewed.channel==='直销'?['direct']:['agency','direct']).map(channel=>({...reviewed.afterQuota,channel,effectiveAt:reviewed.effectiveAt,evidence:reviewed.evidence}));
  for(const review of reviewedRules.filter(r=>r.noticeId===notice.id&&r.code===fund.code&&r.textHash===base.textHash)){rules=rules.filter(r=>r.channel!==review.channel);rules.push(review);}
  // Previously reviewed explicit PDF rules can anchor history, but never extrapolate backwards from today's snapshot.
  const manual=baseline.filter(r=>r.code===fund.code&&r.sourceUrl?.includes(notice.id)&&codeIn(text,fund.code));
  for(const rule of manual) {rules=rules.filter(r=>r.channel!==rule.channel);rules.push(rule);}
  if(!rules.length) return {rules:['agency','direct'].map(channel=>({...base,channel,date:notice.publishedAt,status:'unknown',limit:null,reason:parsed.reason})),blocks:[],holidays:[],pending:parsed.reason};
  const effectiveDates=[...new Set(rules.map(r=>chinaDate(new Date(r.effectiveAt))))];
  const onlyChannel=/在直销|直销机构|直销渠道/.test(notice.title)?'direct':/代销/.test(notice.title)?'agency':null;
  const unknownChannels=['agency','direct'].filter(c=>!rules.some(r=>r.channel===c)&&(!onlyChannel||onlyChannel===c));
  return {rules:[...rules.map(r=>({...base,...r,date:chinaDate(new Date(r.effectiveAt)),noticeId:notice.id,sourceUrl:notice.sourceUrl})),...unknownChannels.map(channel=>({...base,channel,date:effectiveDates[0],status:'unknown',limit:null,reason:'公告未明确此渠道对应额度'}))],blocks:[],holidays:[],pending:unknownChannels.length?'部分渠道额度未明确':null};
}

export function reconstructDays({code,dates,documents,established,complete=true,now=new Date()}) {
  if(!complete)return [];
  const rules=documents.flatMap(d=>d.rules||[]),holidays=documents.flatMap(d=>d.holidays||[]),blocks=documents.flatMap(d=>d.blocks||[]);
  const rows=[];
  for(const channel of ['agency','direct']) for(const date of dates) {
    const applicable=rules.filter(r=>r.channel===channel&&r.date<=date).sort((a,b)=>b.date.localeCompare(a.date)||b.publishedAt.localeCompare(a.publishedAt));
    const latest=applicable[0];
    const conflicts=latest&&applicable.filter(r=>r.date===latest.date&&r.publishedAt===latest.publishedAt);
    const conflict=conflicts&&new Set(conflicts.map(r=>`${r.status}:${r.limit}`)).size>1;
    const block=blocks.find(b=>b.from<=date&&(!b.to||date<b.to)&&!(b.kind==='holiday'&&latest?.status==='paused'&&!conflict));
    const holiday=holidays.find(h=>h.from<=date&&date<h.to);
    let rule=latest,reason=!latest?'缺少窗口起始日前的有效规则':latest.reason||null;
    if(block){rule={...block,status:'unknown',limit:null};reason=block.reason;}
    else if(holiday){rule={...holiday,status:'paused',limit:0};reason=null;}
    else if(conflict){rule={...latest,status:'unknown',limit:null};reason='同日规则冲突';}
    if(established&&date<established){rule=null;reason='该份额尚未成立';}
    const known=rule?.status==='paused'||(rule?.status==='open'&&Number.isFinite(rule.limit)&&rule.limit>0);
    rows.push({code,channel,date,status:known?rule.status:'unknown',limit:known?(rule.status==='paused'?0:rule.limit):null,origin:'announcement_estimate',source:'基金公告倒推',sourceUrl:rule?.sourceUrl||null,noticeId:rule?.noticeId||null,textHash:rule?.textHash||null,effectiveAt:rule?.date||rule?.from||null,reason,estimatedAt:now.toISOString(),evidence:rule?.evidence||rule?.title||null});
  }
  return rows;
}

// Fund-level reviewed holiday notices may be listed only under the main share's code.
// Reuse only explicitly reviewed scope, never a sibling share's quota amount.
export function includeReviewedHolidays(notices, code, from, to) {
  const extra=reviewedHolidays.filter(r=>r.codes.includes(code)&&r.publishedAt>=from&&r.publishedAt<=to&&r.sourceUrl).map(r=>({id:r.noticeId,code,title:r.title,publishedAt:r.publishedAt,sourceUrl:r.sourceUrl}));
  return [...new Map([...extra,...notices].map(n=>[n.id,n])).values()];
}

export async function backfillQuotas(store,catalog,options={}) {
  const now=options.now||new Date(),providers=options.providers||{fetchNoticePage,fetchNoticeText};
  const dates=(store.getMeta('tradingCalendar')?.dates||[]).filter(d=>d<chinaDate(now)).slice(-STABILITY_WINDOW_DAYS);
  if(dates.length!==STABILITY_WINDOW_DAYS)return{status:'waiting_calendar'};
  if(!store.acquireLease('quotaBackfill',30*60000))return{status:'busy'};
  const floor=chinaDate(new Date(Date.parse(dates[0]+'T00:00:00+08:00')-365*86400000));
  const funds=catalog.filter(f=>f.venue!=='etf');let index=0;
  const result={status:'running',startedAt:now.toISOString(),from:dates[0],to:dates.at(-1),processed:0,errors:[],estimatedDays:0};
  store.setMeta('quotaBackfill:lastRun',result);
  const textPromises=new Map();
  const getText=n=>{if(!textPromises.has(n.id))textPromises.set(n.id,providers.fetchNoticeText(n,store.directory));return textPromises.get(n.id);};
  try {
    await Promise.all(Array.from({length:3},async()=>{while(index<funds.length){const fund=funds[index++];
      try{
        let scan=store.getMeta(`reconstruction:scan:${fund.code}`);
        if(scan?.version!==SCAN_VERSION||!scan?.complete||scan.from>floor||chinaDate(new Date(scan.checkedAt))!==chinaDate(now)||options.force){
          const notices=[];let complete=false;
          for(let page=1;page<=20;page++){
            const response=await providers.fetchNoticePage(fund.code,page,0);
            notices.push(...response.notices.filter(n=>n.publishedAt>=floor&&n.publishedAt<=chinaDate(now)&&isHistoryQuotaNotice(n.title)));
            if(!response.notices.length||response.total<=page*50||response.notices.at(-1).publishedAt<floor){complete=true;break;}
          }
          scan={version:SCAN_VERSION,notices:[...new Map(notices.map(n=>[n.id,n])).values()],complete,from:floor,checkedAt:now.toISOString()};store.setMeta(`reconstruction:scan:${fund.code}`,scan);
        }
        if(!scan.complete)throw new Error('历史公告分页尚未完整覆盖');
        const familyCodes=catalog.filter(f=>f.manager===fund.manager&&f.legalName&&f.legalName===fund.legalName).map(f=>f.code);
        const documents=[];const pending=[];
        const historyNotices=includeReviewedHolidays(scan.notices,fund.code,floor,chinaDate(now));
        for(const notice of historyNotices){
          let parsed;
          try{const text=await getText(notice);parsed=interpretHistoryNotice(notice,fund,text,familyCodes);}
          catch{parsed={rules:[],holidays:[],blocks:[{from:notice.publishedAt,to:null,sourceUrl:notice.sourceUrl,noticeId:notice.id,reason:'公告正文获取失败'}],pending:'公告正文获取失败'};}
          documents.push(parsed);if(parsed.pending)pending.push({id:notice.id,date:notice.publishedAt,title:notice.title,sourceUrl:notice.sourceUrl,reason:parsed.pending});
        }
        const rows=reconstructDays({code:fund.code,dates,documents,established:store.snapshot(fund.code)?.established,now});
        store.replaceQuotaEstimates(fund.code,rows);
        store.setMeta(`quotaBackfill:${fund.code}`,{status:'success',checkedAt:now.toISOString(),from:dates[0],to:dates.at(-1),noticeCount:historyNotices.length,pending,scanComplete:true});
        result.processed++;result.estimatedDays+=rows.filter(r=>r.status!=='unknown').length;
      }catch{result.errors.push(fund.code);store.setMeta(`quotaBackfill:${fund.code}`,{status:'failed',checkedAt:now.toISOString(),reason:'公告回查未完成，暂不使用推算值'});}
      store.setMeta('quotaBackfill:lastRun',{...result});
    }}));
    result.status=result.errors.length?'partial':'success';result.finishedAt=new Date().toISOString();store.setMeta('quotaBackfill:lastRun',result);return result;
  }finally{store.releaseLease('quotaBackfill');}
}
