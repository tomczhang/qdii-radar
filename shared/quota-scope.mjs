// All totals and planners use the same per-channel, per-date scope semantics.
export function quotaContribution(code, quota) {
  if (['paused','unavailable'].includes(quota?.status)) return {known:true,amount:0,key:`zero:${code}`};
  if (quota?.status !== 'open' || !Number.isFinite(quota.limit) || quota.limit <= 0) return {known:false,reason:'quota'};
  const scope=quota.scope;
  if(scope?.mode==='independent')return {known:true,amount:quota.limit,key:`share:${code}`};
  if(scope?.mode==='shared' && scope.groupId && Number.isFinite(scope.cap) && scope.cap>0)return {known:true,amount:Math.min(quota.limit,scope.cap),key:`shared:${scope.groupId}`,cap:scope.cap};
  return {known:false,reason:'scope'};
}
export function sumQuotaRows(rows) {
  const groups=new Map();let unknown=0,scopeUnknown=0,known=0;
  for(const {code,quota} of rows){
    const item=quotaContribution(code,quota);
    if(!item.known){unknown++;if(item.reason==='scope')scopeUnknown++;continue;}
    known++;
    if(!groups.has(item.key))groups.set(item.key,{amount:0,cap:item.cap,count:0,conflict:false});
    const group=groups.get(item.key);group.amount+=item.amount;group.count++;if(group.cap!==item.cap)group.conflict=true;
  }
  let amount=0,sharedGroups=0;
  for(const g of groups.values()){
    if(g.conflict){unknown+=g.count;scopeUnknown+=g.count;known-=g.count;continue;}
    if(g.cap!=null){amount+=Math.min(g.amount,g.cap);sharedGroups++;}else amount+=g.amount;
  }
  return {amount:known?Math.round(amount*100)/100:null,unknown,scopeUnknown,sharedGroups};
}
