import {chinaDate,isQuotaNotice} from './domain.mjs';
import {shareScopeAudit} from './share-scopes.mjs';
// Channel scopes and share scopes are separate constraints. Only explicit, reviewed
// channel-specific provisions permit addition. Unknown scopes use one channel.
export const channelRules = [
  {codes:['016452','016453'],mode:'shared',from:'2026-07-09',noticeId:'AN202607081826816306',evidence:'公告第2节按单日单个基金账户累计申购、定投及转换转入限额10元，各类份额每类单独计算。同一基金账户的直销与代销共用；A/C各10元。'},
  {codes:['017641','019305'],mode:'shared',from:'2026-07-27',noticeId:'AN202607241827315718',evidence:'公告第2节按单个基金账户、单个人民币份额类别累计限额10元。同一基金账户跨直销和代销共用，A/C各10元；标普与纳指是不同基金，不互相合并。'},
  {codes:['019172','019173'],mode:'shared',from:'2026-07-27',noticeId:'AN202607241827315717',evidence:'公告第2节按单个基金账户、单个人民币份额类别累计限额10元。同一基金账户跨直销和代销共用，A/C各10元；纳指与标普是不同基金，不互相合并。'},
  {codes:['019524','019525','022664'],mode:'shared',from:'2026-09-22',noticeId:'AN202609221829732369',evidence:'公告第2节按单日单个基金账户单笔或累计5元限制，明确A、C、I份额合并计算。同一基金账户的直销、代销及三类份额共同使用5元额度。'},
  {codes:['019736','019737'],mode:'shared',from:'2026-09-28',noticeId:'AN202609241829831132',evidence:'公告第2(1)条按每一类基金份额、单日每个基金账户累计申购（含定投）限额10元，不区分销售渠道。同一基金账户的直销与代销合计计额；A、C分别各10元，不按销售平台重复叠加。'},
  {codes:['019441','019442'],mode:'independent',from:'2026-09-09',noticeId:'AN202609081829134250',evidence:'公告分别规定代销5000元、直销20000元；A/C份额分别计算。'},
  {codes:['019441','019442'],mode:'shared',from:'2026-09-10',noticeId:'AN202609091829169340',evidence:'公告规定全渠道（直销和代销）单日单账户累计100元；A/C份额分别计算。'},
  {codes:['000834','008971'],mode:'independent',from:'2026-06-04',noticeId:'AN202606031823188725',evidence:'公告第2节分别规定：直销每份额100元，代销每份额10元。'},
  {codes:['539001','012752'],mode:'independent',from:'2026-08-20',noticeId:'AN202608191828132673',evidence:'公告第2节排除直销A/C特殊情况，分别规定其他渠道10元、直销A/C各50元。'},
  {codes:['019441','019442'],mode:'independent',from:'2026-09-23',noticeId:'AN202609231829774454',evidence:'公告分别规定代销10元、直销100元；各渠道内部A/C合并计算，不按多个代销平台叠加。'},
];
export function resolveChannelScope(code, date, notices = [], rules = channelRules, audit = shareScopeAudit) {
  const unknown=reason=>({mode:'unknown',reason});
  const rule=rules.filter(r=>r.codes.includes(code)&&r.from<=date).sort((a,b)=>b.from.localeCompare(a.from))[0];
  if(!rule)return unknown('缺少可核验的跨渠道独立额度依据，合并计划仅选一个渠道。');
  const family=audit.families.find(f=>f.codes.includes(code));
  if(!family?.scanComplete)return unknown('公告扫描未完成，渠道关系待核验。');
  const pending=notices.find(n=>family.codes.includes(n.code)&&isQuotaNotice(n.title)&&!/节假日|休市|非交易日/.test(n.title)&&n.publishedAt>=family.reviewedThrough&&n.publishedAt<=date&&!family.reviewedNoticeIds.includes(n.id));
  if(pending)return {...unknown('新额度公告待核验，暂停跨渠道叠加。'),sourceUrl:pending.sourceUrl};
  return {...rule,sourceUrl:`https://pdf.dfcfw.com/pdf/H2_${rule.noticeId}_1.pdf`,reviewedThrough:family.reviewedThrough};
}
export function attachChannelScopes(funds,notices=[],now=new Date()) {
  return funds.map(f=>{
    if(f.venue==='etf')return f;
    const result={...f,channelScope:resolveChannelScope(f.code,chinaDate(now),notices),fees:f.fees?{...f.fees,stale:!f.fees.observedAt||!Number.isFinite(Date.parse(f.fees.observedAt))||+now-Date.parse(f.fees.observedAt)>7*86400000}:null};
    if(f.stability){
      result.stability={...f.stability};
      for(const channel of ['agency','direct'])result.stability[channel]={...f.stability[channel],daily:(f.stability[channel]?.daily||[]).map(row=>({
        ...row,channelScope:resolveChannelScope(f.code,row.date,notices),
      }))};
    }
    return result;
  });
}
