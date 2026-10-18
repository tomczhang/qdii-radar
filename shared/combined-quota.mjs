import {quotaContribution} from './quota-scope.mjs';

// First deduplicate shares within each channel. Then join overlapping pools whose
// cross-channel independence is not verified. Such a component uses one channel's
// capacity, never both. Known independent components can be added together.
export function sumCombinedQuota(funds) {
  const groups=new Map(), byCode=new Map(funds.map(f=>[f.code,f]));
  const unknownFunds=new Set(),scopeUnknownFunds=new Set();let known=0;
  for(const fund of funds)for(const channel of ['agency','direct']) {
    const quota=fund[channel],item=quotaContribution(fund.code,quota);
    if(!item.known){unknownFunds.add(fund.code);if(item.reason==='scope')scopeUnknownFunds.add(fund.code);continue;}
    known++;
    if(!item.amount)continue;
    const key=JSON.stringify([fund.index,fund.currency||'CNY',channel,item.key]);
    if(!groups.has(key))groups.set(key,{channel,amount:0,cap:item.cap,codes:new Set(),observedCodes:new Set(),conflict:false});
    const group=groups.get(key);group.amount+=item.amount;group.observedCodes.add(fund.code);
    for(const code of quota.scope?.mode==='shared'?(quota.scope.codes || [fund.code]):[fund.code])group.codes.add(code);
    if(group.cap!==item.cap)group.conflict=true;
  }
  const pools=[];
  for(const group of groups.values()) {
    if(group.conflict){for(const code of group.observedCodes){unknownFunds.add(code);scopeUnknownFunds.add(code);known--;}continue;}
    pools.push({...group,amount:group.cap==null?group.amount:Math.min(group.amount,group.cap)});
  }
  const parent=pools.map((_,i)=>i),root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
  const unresolved=[];
  for(let i=0;i<pools.length;i++)for(let j=i+1;j<pools.length;j++) {
    if(pools[i].channel===pools[j].channel)continue;
    const overlaps=[...pools[i].codes].filter(code=>pools[j].codes.has(code));
    const coupled=overlaps.filter(code=>byCode.get(code)?.channelScope?.mode!=='independent');
    if(!coupled.length)continue;
    parent[root(j)]=root(i);
    if(coupled.some(code=>byCode.get(code)?.channelScope?.mode!=='shared'))unresolved.push(i);
  }
  const components=new Map();
  pools.forEach((pool,i)=>{
    const key=root(i);if(!components.has(key))components.set(key,{agency:0,direct:0});
    components.get(key)[pool.channel]+=pool.amount;
  });
  const channelUnknown=new Set(unresolved.map(root)).size;
  const amount=[...components.values()].reduce((n,c)=>n+Math.max(c.agency,c.direct),0);
  return {amount:known?Math.round(amount*100)/100:null,unknown:unknownFunds.size,scopeUnknown:scopeUnknownFunds.size,channelUnknown,
    sharedGroups:pools.filter(p=>p.cap!=null).length,
    open:funds.filter(f=>['agency','direct'].some(c=>f[c]?.status==='open'&&Number.isFinite(f[c].limit)&&f[c].limit>0)).length,count:funds.length};
}
