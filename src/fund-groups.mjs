import {totalQuota, totalHistoricalQuota} from './summary.mjs';
import {compareFundShares, createQuotaComparator, createFeeChannelComparator, feeChannelSortValue} from './fund-sort.mjs';

const familyKey = f => JSON.stringify([f.manager, (f.legalName || `${f.name}|${f.index}|${f.type}`).normalize('NFKC').replace(/\s+/g, ''), f.index, f.currency || 'CNY']);
export const matchesFund = (f, query) => `${f.name}${f.manager}${f.share}${f.code}`.toLowerCase().includes(query.trim().toLowerCase());

// Announcements define the applicable share set. Connected sets stay together;
// a separate rule for Southern I therefore cannot inherit the A/C channel rule.
export function groupFunds(funds) {
  const families = new Map();
  for (const f of funds.filter(f => f.venue !== 'etf')) {
    const key = familyKey(f);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(f);
  }
  const groups = [];
  for (const family of families.values()) {
    const parent = new Map(family.map(f => [f.code, f.code]));
    const root = code => parent.get(code) === code ? code : root(parent.get(code));
    for (const f of family) {
      const codes = [...new Set(['agency', 'direct'].flatMap(c => f[c]?.scope?.codes || []))];
      // Missing scope is not a reason to fragment an otherwise identified fund.
      for (const code of codes.length ? codes : family.map(f => f.code)) {
        if (parent.has(code)) parent.set(root(code), root(f.code));
      }
    }
    const sets = new Map();
    for (const f of family) {
      const key = root(f.code);
      if (!sets.has(key)) sets.set(key, []);
      sets.get(key).push(f);
    }
    for (const members of sets.values()) {
      members.sort(compareFundShares);
      groups.push({id: members.map(f => f.code).sort().join('-'), name: members[0].name, members,
        shares: members.map(f => f.share || '人民币').join('/'),
        total: totalQuota(members, 'both'), history: totalHistoricalQuota(members, 'both')});
    }
  }
  return groups;
}
export function groupRules(group) {
  const modes = new Set(group.members.map(f => f.channelScope?.mode || 'unknown'));
  const channel = modes.size !== 1 ? '各份额渠道规则不同' : modes.has('shared') ? '直销与代销共用' : modes.has('independent') ? '直销 + 代销可叠加' : '渠道关系待确认';
  const scopes = group.members.flatMap(f => ['agency','direct'].map(c => f[c]?.scope));
  const shares = group.members.length === 1 ? '份额独立' : scopes.every(s => s?.mode === 'shared' && group.members.every(f => s.codes?.includes(f.code))) ? modes.has('independent') ? `${group.shares} 在各渠道内共用` : `${group.shares} 共用一份额度` : scopes.every(s => s?.mode === 'independent') ? scopes.some(s => s.basis === 'default') ? '各份额独立（默认口径）' : '各份额分别计算，可相加' : '份额规则不同，展开查看';
  return {channel, shares};
}
// Badge categories describe evidence, not the conservative total's assumptions.
export function shareRuleBadge(group) {
  const {members} = group;
  if (members.length>0 && members.every(f=>['agency','direct'].every(c=>
    ['paused','unavailable'].includes(f[c]?.status) || (f[c]?.status==='open' && f[c].limit===0)
  ))) return {label:'—',tone:'empty',detail:'当前无可买额度，份额规则不适用。'};
  const scopes = members.flatMap(f => ['agency','direct'].map(c => f[c]?.scope));
  if (members.length === 1) return {label:'份额独立', tone:'independent', detail:'本组仅列示一个份额；不表示跨渠道额度可叠加。'};
  if (scopes.some(s => !s || !['independent','shared'].includes(s.mode) || s.basis === 'default')) {
    return {label:'待确认', tone:'pending', detail:scopes.some(s=>s?.basis==='default') ? '尚无明确的份额独立依据；总额仍按默认独立口径计算。' : '部分份额或渠道的共享规则尚待核验。'};
  }
  if (scopes.every(s=>s.mode==='independent')) return {label:'份额独立', tone:'independent', detail:'各份额分别计算；同一份额内的渠道关系仍需单独判断。'};
  const allShared = scopes.every(s => s.mode === 'shared' && members.every(f=>s.codes?.includes(f.code)));
  if (allShared) return {label:`${group.shares || members.map(f=>f.share || '人民币').join('/')}共享`, tone:'shared', detail:`${group.shares} 在每个渠道内共享额度；是否跨渠道共用，以渠道徽标为准。`};
  const ac = members.filter(f=>['A','C'].includes(f.share));
  const acOnly = ac.length === 2 && members.every(f=>['agency','direct'].every(c=> {
    const scope=f[c].scope;
    return ac.includes(f) ? scope.mode==='shared' && scope.codes?.length===2 && ac.every(a=>scope.codes.includes(a.code)) : scope.mode==='independent';
  }));
  return acOnly ? {label:'A/C共享',tone:'shared',detail:'A、C份额共享，其余份额独立计算。'} : {label:'部分共享',tone:'shared',detail:'仅部分份额共享，或直销与代销的份额规则不同；展开查看各份额公告。'};
}
export const hasChannel = (group, channel) => group.members.some(f=>f[channel]?.status==='open' && Number.isFinite(f[channel].limit) && f[channel].limit>0);
export function channelBadge(group, channel) {
  const label=channel==='direct'?'直销':'代销';
  const quotas=group.members.map(f=>f[channel]);
  if (quotas.some(q=>q?.excludedSmallQuota) && quotas.every(q=>q?.excludedSmallQuota || ['paused','unavailable'].includes(q?.status))) return {label:`${label}已剔除`,tone:'neutral',detail:'该渠道的 ≤10 元额度已从当前统计中剔除；关闭右上角开关可恢复。'};
  if (hasChannel(group,channel)) return {label,tone:'available',detail:group.members.filter(f=>f[channel]?.status==='open' && f[channel].limit>0).map(f=>`${f.share}：${f[channel].platforms?.join(' / ') || (channel==='direct'?'基金公司直销':'已采集代销渠道')}`).join('；')};
  if (quotas.some(q=>!q || q.status==='unknown' || q.status==='open')) return {label:`${label}待确认`,tone:'pending',detail:'未取得可用额度，不能按可买处理。'};
  return {label:`${label}${quotas.some(q=>q.status==='paused')?'暂停':'不可买'}`,tone:'neutral',detail:'当前已采集渠道未见可买额度；其他平台状态以实际页面为准。'};
}
export function sortGroupMembers(members, sort) {
  const [key, direction] = sort.split(':');
  if (['agency','direct'].includes(key)) return [...members].sort(createQuotaComparator(members, key, direction));
  if (['annualFee','agencyFee','channelScope'].includes(key)) return [...members].sort(createFeeChannelComparator(key,direction));
  return [...members].sort((a,b) => {
    const value = f => key.endsWith('History') ? (f.stability?.calendarReady ? f.stability?.[key.slice(0,-7)]?.knownTotal : null) : f.returns?.[key];
    const av=value(a), bv=value(b);
    if (key.endsWith('History') && av != null && bv != null) {
      const channel = key.slice(0,-7), coverage = b.stability[channel].coveredDays - a.stability[channel].coveredDays;
      if (coverage) return coverage;
    }
    return compareNullable(av,bv,direction) || compareFundShares(a,b);
  });
}
const compareNullable = (a,b,direction) => a == null ? b == null ? 0 : 1 : b == null ? -1 : direction === 'asc' ? a-b : b-a;
export function groupSortValue(group, key) {
  if (key === 'combined') return group.total.amount;
  if (['agency','direct'].includes(key)) return totalQuota(group.members,key).amount;
  if (key.endsWith('History')) return totalHistoricalQuota(group.members,key.slice(0,-7)).amount;
  const values = group.members.map(f => ['annualFee','agencyFee','channelScope'].includes(key) ? feeChannelSortValue(f,key) : f.returns?.[key]).filter(Number.isFinite);
  if (key === 'channelScope' && new Set(group.members.map(f=>f.channelScope?.mode)).size !== 1) return null;
  return values.length ? (['annualFee','agencyFee'].includes(key) ? Math.min(...values) : Math.max(...values)) : null;
}
export function selectFundGroups(groups, {query='', tab='all', onlyOpen=false, channels=[], sort='combined:desc'}={}) {
  const [key,direction] = sort.split(':');
  return groups.filter(g => (tab === 'all' || g.members[0].index === tab) && (!onlyOpen || g.total.open > 0) && (!channels.length || channels.some(channel=>hasChannel(g,channel))) && g.members.some(f=>matchesFund(f,query)))
    .sort((a,b) => {
      if (key.endsWith('History')) {
        const ah=totalHistoricalQuota(a.members,key.slice(0,-7)),bh=totalHistoricalQuota(b.members,key.slice(0,-7));
        const coverage=bh.completeCount/bh.count-ah.completeCount/ah.count;
        if(coverage)return coverage;
      }
      return compareNullable(groupSortValue(a,key),groupSortValue(b,key),direction) || compareFundShares(a.members[0],b.members[0]);
    });
}
