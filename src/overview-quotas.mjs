import {quotaContribution} from '../shared/quota-scope.mjs';

// A display-only projection: never change source quota records.
function excludeSmallQuota(quota) {
  const limit = quota?.scope?.mode === 'shared' && Number.isFinite(quota.scope.cap)
    ? Math.min(quota.limit, quota.scope.cap) : quota?.limit;
  return quota?.status === 'open' && Number.isFinite(limit) && limit >= 0 && limit <= 10
    ? {...quota, status: 'unavailable', limit: 0, excludedSmallQuota: true, originalLimit: limit}
    : quota;
}

export function overviewQuotas(funds, excludeSmall) {
  if (!excludeSmall) return funds;
  return funds.map(fund => {
    if (fund.venue === 'etf') return fund;
    const result = {...fund};
    if (fund.stability) result.stability = {...fund.stability};
    for (const channel of ['agency', 'direct']) {
      result[channel] = excludeSmallQuota(fund[channel]);
      const history = fund.stability?.[channel];
      if (!Array.isArray(history?.daily)) continue;
      const daily = [...new Map(history.daily.map(row => [row.date, excludeSmallQuota(row)])).values()];
      const window = daily.filter(row => row.date >= fund.stability.startDate && row.date <= fund.stability.endDate);
      const known = window.map(row => ({row, value: quotaContribution(fund.code, row)})).filter(({value}) => value.known);
      const knownTotal = known.length ? Math.round(known.reduce((sum, {value}) => sum + value.amount, 0) * 100) / 100 : null;
      const complete = fund.stability.calendarReady && known.length === fund.stability.windowDays;
      result.stability[channel] = {...history, daily, knownTotal, total: complete ? knownTotal : null,
        coveredDays: known.length, openDays: known.filter(({row}) => row.status === 'open').length,
        missingDays: Math.max(0, fund.stability.windowDays - known.length), complete};
    }
    return result;
  });
}
