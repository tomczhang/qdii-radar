const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-CN', { numeric: true });
const familyName = fund => (fund.legalName || `${fund.name || ''}|${fund.index || ''}|${fund.type || ''}`).normalize('NFKC').replace(/\s+/g, '');

// Used only after quota amounts tie. Keep share-class order stable in both sort directions.
export function compareFundShares(a, b) {
  return compareText(a.manager, b.manager)
    || compareText(familyName(a), familyName(b))
    || String(a.share || '').localeCompare(String(b.share || ''), 'en', { numeric: true })
    || a.code.localeCompare(b.code);
}

export function createQuotaComparator(funds, channel, direction = 'desc') {
  const quota = fund => fund[channel]?.status === 'open' && Number.isFinite(fund[channel].limit) ? fund[channel].limit : null;
  const groupKey = fund => JSON.stringify([fund.manager || '', familyName(fund), fund.currency || 'CNY', quota(fund)]);
  const groupReturns = new Map();
  for (const fund of funds) {
    const key = groupKey(fund), value = fund.returns?.y1;
    if (!groupReturns.has(key)) groupReturns.set(key, null);
    if (Number.isFinite(value) && (groupReturns.get(key) == null || value > groupReturns.get(key))) groupReturns.set(key, value);
  }
  return (a, b) => {
    const av = quota(a), bv = quota(b);
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    if (av !== bv) return direction === 'asc' ? av - bv : bv - av;
    const ar = groupReturns.get(groupKey(a)), br = groupReturns.get(groupKey(b));
    if (ar == null && br != null) return 1;
    if (br == null && ar != null) return -1;
    return (ar != null && br != null ? br - ar : 0) || compareFundShares(a, b);
  };
}

export function feeChannelSortValue(fund, key) {
  if(key==='channelScope')return ({independent:2,shared:1})[fund.channelScope?.mode] ?? null;
  if(fund.fees?.stale)return null;
  const first=fund.fees?.subscription?.find(t=>t.min===0);
  const value=key==='annualFee'?fund.fees?.annualRate:key==='agencyFee'?first?.agencyRate:null;
  return Number.isFinite(value)?value:null;
}
export function createFeeChannelComparator(key, direction='asc') {
  return (a,b)=>{
    const av=feeChannelSortValue(a,key),bv=feeChannelSortValue(b,key);
    if(av==null&&bv!=null)return 1;
    if(bv==null&&av!=null)return -1;
    return (av!=null&&bv!=null?(direction==='asc'?av-bv:bv-av):0)||compareFundShares(a,b);
  };
}
