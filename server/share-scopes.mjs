import {readFileSync} from 'node:fs';
import {chinaDate,isQuotaNotice} from './domain.mjs';
const audit=JSON.parse(readFileSync(new URL('./verified-share-scopes.json',import.meta.url)));
export const shareScopeAudit=audit;

export function resolveShareScope(code,channel,date,notices=[],registry=audit) {
  const family=registry.families.find(f=>f.codes.includes(code));
  const unknown=reason=>({mode:'unknown',reason,reviewedThrough:family?.reviewedThrough||null});
  const independentDefault=(rule=null)=>({mode:'independent',basis:'default',codes:rule?.codes||[code],groupId:null,cap:null,sourceUrl:rule?.sourceUrl,effectiveFrom:rule?.from,evidence:'未见明确的份额合并规定，按默认口径将各份额独立计算。',reviewedEvidence:rule?.evidence,reviewedThrough:family?.reviewedThrough||null,ruleId:rule?.id||'default-independent'});
  if(!family || !family.scanComplete)return independentDefault();
  // Any newly discovered quota notice invalidates the reviewed scope from its publication
  // date until scope is reviewed. Do not let an amount-only parser silently retain it.
  const pending=notices.filter(n=>family.codes.includes(n.code)&&isQuotaNotice(n.title)&&!/节假日|休市|非交易日/.test(n.title)&&n.publishedAt>=family.reviewedThrough&&n.publishedAt<=date&&!family.reviewedNoticeIds.includes(n.id)).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))[0];
  if(pending)return {...unknown('发现新额度公告，份额合并范围待核验'),sourceUrl:pending.sourceUrl};
  const rules=[...registry.rules,...(registry.userConfirmations||[])].filter(r=>r.codes.includes(code)&&r.channels.includes(channel)&&r.from<=date&&(!r.to||date<r.to)).sort((a,b)=>b.from.localeCompare(a.from));
  const rule=rules[0];
  if(!rule)return independentDefault();
  const conflict=rules.some(r=>r.from===rule.from&&(r.mode!==rule.mode||r.groupId!==rule.groupId||r.limits?.[channel]!==rule.limits?.[channel]));
  if(conflict)return unknown('同日份额共享规则冲突');
  if(rule.mode==='unknown'){
    // Lack of wording does not revoke an earlier explicit sharing restriction.
    const prior=rules.find(r=>r.mode==='shared'||r.mode==='independent');
    if(!prior)return independentDefault(rule);
    return resolveShareScope(code,channel,date,notices,{...registry,rules:registry.rules.filter(r=>r!==rule)});
  }
  return {mode:rule.mode,basis:rule.basis||'announcement',groupId:rule.mode==='shared'?`${channel}:${rule.groupId}`:null,cap:rule.limits?.[channel]??null,codes:rule.codes,sourceUrl:rule.sourceUrl,effectiveFrom:rule.from,evidence:rule.evidence,reason:rule.mode==='unknown'?rule.evidence:null,reviewedThrough:family.reviewedThrough,ruleId:rule.id};
}
export function attachShareScopes(funds,notices=[],now=new Date()) {
  const today=chinaDate(now),byCode=new Map(funds.map(f=>[f.code,f]));
  return funds.map(f=>{
    if(f.venue==='etf')return f;
    const result={...f};
    for(const channel of ['agency','direct']){
      const scope=resolveShareScope(f.code,channel,today,notices);
      scope.members=(scope.codes||[f.code]).map(code=>({code,share:byCode.get(code)?.share||'人民币'}));
      result[channel]={...f[channel],scope};
    }
    result.quotaNote=result.direct.status==='open' ? result.direct.scope.evidence || result.direct.scope.reason : result.agency.status==='open' ? result.agency.scope.evidence || result.agency.scope.reason : '当前暂停或渠道不可申购，恢复时间及额度以公告为准。';
    if(f.stability){
      result.stability={...f.stability};
      for(const channel of ['agency','direct']) result.stability[channel]={...f.stability[channel],daily:(f.stability[channel]?.daily||[]).map(row=>{
        const scope=resolveShareScope(f.code,channel,row.date,notices);
        return {...row,scope:{mode:scope.mode,basis:scope.basis,groupId:scope.groupId,codes:scope.codes,cap:scope.cap,ruleId:scope.ruleId}};
      })};
    }
    return result;
  });
}
export function getScopeNotices(store) {
  // No arbitrary row limit: a later notice may only be listed under a sibling code.
  return store.db.prepare('SELECT payload FROM notices WHERE published_at>=?').all(audit.reviewedThrough).map(r=>JSON.parse(r.payload));
}
