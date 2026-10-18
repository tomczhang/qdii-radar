import { mergeGildata } from './gildata.mjs';
import { unknownQuota } from './domain.mjs';

export async function retrySource(operation, { attempts = 2, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let failure;
  for (let i = 0; i < attempts; i++) {
    try { return await operation(); }
    catch (error) { failure = error; if (i + 1 < attempts) await wait(600 * 2 ** i); }
  }
  throw failure;
}

// Independent sources and field groups: a failed returns request must not discard a fresh quota.
export async function refreshFundData(fund, previous, { market, gildata, enabled = true, now = new Date(), wait } = {}) {
  const at = now.toISOString();
  const [tt, jy] = await Promise.allSettled([
    market(fund),
    enabled ? retrySource(() => gildata(fund), { wait }) : Promise.resolve(null),
  ]);
  let snapshot = { ...fund, agency: unknownQuota(), returns: { y1: null, y3: null, y5: null }, trend: [], trendDates: [], dailyChange: null, ...previous, marketError: null };
  const updated = new Set(), diagnostics = [];
  if (tt.status === 'fulfilled') {
    const data = tt.value;
    snapshot = { ...snapshot, fullName: data.fullName || snapshot.fullName, established: data.established || snapshot.established, raw: data.raw, agency: data.agency, observedAt: at };
    updated.add('agency');
    if (data.fees) { snapshot.fees = data.fees; updated.add('fees'); }
    if (data.returnsAsOf && data.returnsAsOf >= (snapshot.returnsAsOf || '')) {
      Object.assign(snapshot, { returns: data.returns, returnsAsOf: data.returnsAsOf, performanceSource: data.performanceSource, returnsCheckedAt: at });
      updated.add('returns');
    }
    if (data.navAsOf && data.navAsOf >= (snapshot.navAsOf || '')) {
      for (const key of ['navAsOf','dailyChange','navSource','trendSource','trend','trendDates','trendNote']) snapshot[key] = data[key];
      snapshot.navCheckedAt = at; updated.add('nav');
    }
    diagnostics.push(...(data.sourceErrors || []).map(group => ({ source: 'tiantian', group, code: 'unavailable_or_invalid' })));
  } else diagnostics.push({ source: 'tiantian', group: 'market', code: 'unavailable_or_invalid' });
  if (jy.status === 'fulfilled' && jy.value) {
    const data = jy.value;
    if (data.returnsAsOf >= (snapshot.returnsAsOf || '')) { snapshot.returnsCheckedAt = at; updated.add('returns'); }
    if (data.navAsOf >= (snapshot.navAsOf || '')) { snapshot.navCheckedAt = at; updated.add('nav'); }
    snapshot = mergeGildata(snapshot, data);
    snapshot.observedAt = at;
  } else if (enabled) diagnostics.push({ source: 'gildata', group: 'performance', code: 'unavailable_or_invalid' });
  // Legacy snapshots acquire their original timestamps, never today's timestamp for retained fields.
  snapshot.returnsCheckedAt ||= previous?.observedAt || null;
  snapshot.navCheckedAt ||= previous?.observedAt || null;
  snapshot.observedAt ||= previous?.observedAt || at;
  snapshot.marketSource = [...new Set([snapshot.performanceSource,snapshot.navSource,snapshot.trendSource].filter(Boolean))].join(' / ');
  const required = fund.venue === 'etf' ? ['returns','nav'] : ['agency','returns','nav'];
  return { snapshot, diagnostics, updated: [...updated], unresolved: required.filter(group => !updated.has(group)), gildataSuccess: jy.status === 'fulfilled' && !!jy.value };
}

export function fundDataIssues(fund, now = new Date(), calendar = []) {
  const issues = [];
  const expired = at => !at || !Number.isFinite(Date.parse(at)) || +now-Date.parse(at)>36*3600000;
  const lagging = date => !date || calendar.filter(d=>d>date).length>2;
  if (fund.venue !== 'etf') {
    if (!fund.agency || fund.agency.status === 'unknown') issues.push('代销额度待确认');
    else if (fund.agency.validity !== 'until_replaced' && expired(fund.agency.observedAt || fund.observedAt)) issues.push('代销额度待更新');
    if (!fund.direct || fund.direct.status === 'unknown') issues.push('直销额度待确认');
    else if (expired(fund.noticeCheckedAt)) issues.push('直销额度待更新');
  }
  const missingMatureReturn = fund.returnsAsOf && fund.established && [['y1',1],['y3',3],['y5',5]].some(([key,years])=>{
    const anniversary = new Date(fund.returnsAsOf+'T00:00:00Z');
    if (!Number.isFinite(+anniversary)) return true;
    anniversary.setUTCFullYear(anniversary.getUTCFullYear()-years);
    return fund.established <= anniversary.toISOString().slice(0,10) && !Number.isFinite(fund.returns?.[key]);
  });
  if (!fund.returnsAsOf || missingMatureReturn) issues.push('历史涨幅待补齐');
  else if (expired(fund.returnsCheckedAt || fund.observedAt) || lagging(fund.returnsAsOf)) issues.push('历史涨幅待更新');
  if (!fund.navAsOf || !fund.trend?.length) issues.push('近期走势待补齐');
  else if (expired(fund.navCheckedAt || fund.observedAt) || lagging(fund.navAsOf)) issues.push('近期走势待更新');
  if (fund.venue === 'etf') {
    if (fund.quote?.premium == null) issues.push('收盘溢价率待补齐');
    else if (expired(fund.quote.fetchedAt) || !fund.quote.date || (calendar.length && fund.quote.date < calendar.at(-1))) issues.push('收盘溢价率待更新');
  }
  return issues;
}
