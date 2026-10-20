// A compact, lossless projection for the native client. Repeated historical
// scope rules are interned, preserving the quota overview’s current and historical semantics.
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const scopeKeys = ['mode','basis','groupId','cap','codes','ruleId'];
const quotaKeys = ['status','limit','stale','pendingReview','platforms','availabilityBasis','source','sourceUrl','effectiveAt','observedAt','reason'];
function quota(value) {
  if (!value) return {status:'unknown',limit:null};
  return {...pick(value,quotaKeys),...(value.scope ? {scope:pick(value.scope,[...scopeKeys,'sourceUrl','effectiveFrom','reason','evidence','reviewedThrough'])} : {})};
}
export function miniappDashboard(board) {
  const scopes = [], scopeIds = new Map();
  const intern = value => {
    if (!value) return null;
    const rule=pick(value,scopeKeys), key=JSON.stringify(rule);
    if (!scopeIds.has(key)) {scopeIds.set(key,scopes.length);scopes.push(rule);}
    return scopeIds.get(key);
  };
  const history = value => {
    if (!value) return null;
    const result=pick(value,['calendarReady','windowDays','startDate','endDate']);
    for (const channel of ['agency','direct']) if(value[channel]) result[channel]={
      ...pick(value[channel],['knownTotal','total','coveredDays','openDays','missingDays','complete']),
      daily:(value[channel].daily || []).map(row=>({...pick(row,['date','status','limit']),scopeRef:intern(row.scope),channelScope:{mode:row.channelScope?.mode || 'unknown'}}))
    };
    return result;
  };
  const {meta}=board;
  const funds=board.funds.map(fund=>({
    ...pick(fund,['code','name','legalName','fullName','share','manager','index','venue','currency','type','stale','returns','returnsAsOf','dailyChange','navAsOf','trend','trendDates','marketSource','sourceUrl','quotaNote']),
    agency:quota(fund.agency),direct:quota(fund.direct),dataIssues:(fund.dataIssues || []).filter(issue=>typeof issue==='string'),
    channelScope:fund.channelScope ? pick(fund.channelScope,['mode','sourceUrl','evidence','reason','from']) : {mode:'unknown'},
    fees:fund.fees ? pick(fund.fees,['annualRate','operating','directBasis','subscription','redemption','observedAt','sourceUrl','stale']) : null,
    quote:fund.quote ? pick(fund.quote,['price','premium','change','date','suspended']) : null,
    stability:history(fund.stability),dataIssueCount:fund.dataIssues?.length || 0
  }));
  return {funds,scopes,
    changes:board.changes.map(change=>pick(change,['id','code','name','channel','channelKey','channelKeys','type','before','after','beforeQuota','afterQuota','beforeByChannel','afterByChannel','effectiveAt','createdAt','sourceUrl','noticeTitle','kind'])),
    meta:{...pick(meta,['mode','updatedAt','otcCount','etfCount','staleCount','timezone','nextRunAt','dailySyncTime','changesWindow','returnDates']),view:'miniapp',schemaVersion:2,
      lastRun:pick(meta.lastRun,['status','phase','completed','total','startedAt','finishedAt']),
      changesCoverage:pick(meta.changesCoverage,['complete','checkedFunds','pendingCount','priorUnknownCount','status'])}
  };
}
