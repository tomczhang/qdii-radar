import {correctSalesHistory} from './sales-channels.mjs';
import { STABILITY_WINDOW_DAYS } from '../shared/config.mjs';
import { chinaDate, finiteNumber } from './domain.mjs';
import { getBytes } from './providers.mjs';
import { callGildata, parseMarkdownTable, gildataConfigured } from './gildata.mjs';

const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
export function parseEtfQuotes(response, codes, today = chinaDate()) {
  if (response.isError) throw new Error('行情查询失败');
  const payload = response.structuredContent || JSON.parse(response.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  if (payload.code !== 0 || !Array.isArray(payload.results)) throw new Error('行情结构异常');
  const rows = payload.results.filter(r => r.api_name === '场内基金日行情').flatMap(r => parseMarkdownTable(r.table_markdown));
  return codes.flatMap(code => {
    const own = rows.filter(r => r['基金代码'] === code);
    const date = own.map(r => r['交易日']).filter(d => validDate(d) && d <= today).sort().at(-1);
    if (!date) return [];
    const latest = own.filter(r => r['交易日'] === date);
    const values = latest.map(r => ({ code, date, price: finiteNumber(r['收盘价(元)']), premium: finiteNumber(r['折溢价率(%)']), change: finiteNumber(r['涨跌幅(%)']), suspended: r['是否停牌'] === '是', source: '恒生聚源 · 场内基金日行情', basis: '供应商公布的收盘折溢价率，非实时 IOPV 溢价率', fetchedAt: new Date().toISOString() }));
    if (values.some(q => q.price == null || q.price <= 0 || q.premium == null || q.premium < -100 || q.change == null) || new Set(values.map(q => JSON.stringify([q.price,q.premium,q.change]))).size !== 1) return [];
    return [values[0]];
  });
}
export function parseTradingDates(payload, today = chinaDate()) {
  if (payload.rc !== 0 || payload.data?.code !== '000001' || payload.data?.market !== 1 || !Array.isArray(payload.data.klines)) throw new Error('交易日期来源不匹配');
  const dates = payload.data.klines.map(line => line.split(',')[0]);
  if (dates.some(d => !validDate(d))) throw new Error('交易日期格式异常');
  const completed = [...new Set(dates.filter(d => d < today))].sort();
  if (completed.length < STABILITY_WINDOW_DAYS) throw new Error(`交易日期不足${STABILITY_WINDOW_DAYS}日`);
  return completed;
}
export async function syncAnalytics(store, catalog, now = new Date()) {
  if (!store.acquireLease('analytics', 5 * 60000)) return;
  const result = { checkedAt: now.toISOString(), status: 'success', errors: [], quoteCount: 0 };
  try {
    const today = chinaDate(now), begin = chinaDate(new Date(+now - 400 * 86400000)).replaceAll('-', '');
    try {
      const params = new URLSearchParams({ secid:'1.000001', klt:'101', fqt:'0', lmt:'500', beg:begin, end:today.replaceAll('-',''), fields1:'f1,f2,f3,f4,f5,f6', fields2:'f51,f52,f53,f54,f55,f56,f57' });
      const dates = parseTradingDates(JSON.parse((await getBytes(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`)).toString()), today);
      store.setMeta('tradingCalendar', { dates, checkedAt: now.toISOString(), source: '东方财富 · 上证指数实际日线交易日期' });
    } catch { result.errors.push('交易日历更新失败，保留上次日期并标注待更新'); }
    const codes = catalog.filter(f => f.venue === 'etf').map(f => f.code);
    if (codes.length && gildataConfigured()) {
      const received = new Set();
      for (let attempt=0; attempt<2; attempt++) {
        const missing = codes.filter(code=>!received.has(code));
        if (!missing.length) break;
        if (attempt) await new Promise(resolve=>setTimeout(resolve,600));
        try {
          const response = await callGildata(`查询人民币场内ETF ${missing.join('、')} 截至${today}最新已公布交易日的场内基金日行情：基金代码、交易日、收盘价(元)、涨跌幅(%)、折溢价率(%)、是否停牌。只返回场内基金日行情结构化表格，保留原始字段，不估算，不使用实时IOPV计算。`);
          for (const quote of parseEtfQuotes(response, missing, today)) {
            const previous = store.getMeta(`etfQuote:${quote.code}`);
            if (!previous || quote.date >= previous.date) { store.setMeta(`etfQuote:${quote.code}`,quote); received.add(quote.code); }
          }
        } catch { /* Retry only unresolved symbols; retain verified quotes with their original dates. */ }
      }
      result.quoteCount = received.size;
      if (received.size !== codes.length) result.errors.push(`${codes.length-received.size}只ETF行情暂未刷新，保留最近成功值`);
    } else if (codes.length) result.errors.push('聚源未配置，收盘溢价率暂缺');
    result.status = result.errors.length ? 'partial' : 'success';
    store.setMeta('analytics:lastRun', result);
    return result;
  } finally { store.releaseLease('analytics'); }
}

// Only persist dates on which the source was actually checked. Never project today's cap into the past.
export function recordQuotaDay(store, fund, now = new Date()) {
  if (fund.venue === 'etf') return;
  for (const channel of ['agency', 'direct']) {
    const quota = fund[channel];
    const observedAt = channel === 'agency' ? quota?.observedAt : fund.noticeCheckedAt;
    if (!observedAt || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > +now || chinaDate(new Date(observedAt)) !== chinaDate(now)) continue;
    if (channel === 'direct' && quota?.effectiveAt && Date.parse(quota.effectiveAt) > +now) continue;
    const known = ['paused', 'unavailable'].includes(quota?.status) || (quota?.status === 'open' && Number.isFinite(quota.limit) && quota.limit > 0);
    store.saveQuotaDay({ code: fund.code, channel, date: chinaDate(now), status: known ? quota.status : 'unknown', limit: known ? (quota.status === 'open' ? quota.limit : 0) : null, observedAt, source: quota?.source || null, sourceUrl: quota?.sourceUrl || null });
  }
}
export function quotaStability(store, code, now = new Date()) {
  const calendar = store.getMeta('tradingCalendar');
  const dates = (calendar?.dates || []).filter(d => d < chinaDate(now)).slice(-STABILITY_WINDOW_DAYS);
  const calendarStale = !calendar?.checkedAt || +now - Date.parse(calendar.checkedAt) > 36 * 3600000;
  const ready = dates.length === STABILITY_WINDOW_DAYS && !calendarStale;
  const observed = dates.length ? store.quotaDays(code, dates[0], dates.at(-1)) : [];
  const backfill = store.getMeta(`quotaBackfill:${code}`);
  const estimates = dates.length && backfill?.status === 'success' && backfill.scanComplete ? store.quotaEstimates(code, dates[0], dates.at(-1)) : [];
  // Actual observations win, including explicit unknown observations. Never silently replace them with estimates.
  const rows = new Map(estimates.map(r => [`${r.channel}:${r.date}`, r]));
  for (const row of observed) rows.set(`${row.channel}:${row.date}`, {...row, origin:'observation'});
  const result = { windowDays: STABILITY_WINDOW_DAYS, startDate: dates[0] || null, endDate: dates.at(-1) || null, calendarReady: ready, calendarStale, calendarSource: calendar?.source || null, reconstruction: { status: backfill?.status || 'pending', checkedAt: backfill?.checkedAt || null, noticeCount: backfill?.noticeCount || 0, pendingNoticeCount: backfill?.pending?.length || 0 } };
  for (const channel of ['agency','direct']) {
    const daily = dates.map(date => correctSalesHistory(code,channel,rows.get(`${channel}:${date}`) || {date,channel,status:'unknown',limit:null,origin:'missing',reason:'暂无观测或可核验的公告规则'}));
    const known = daily.filter(r => ['open','paused','unavailable'].includes(r.status) && Number.isFinite(r.limit));
    const total = known.reduce((sum,r) => sum + r.limit, 0), coveredDays = known.length;
    const observedDays = known.filter(r => r.origin === 'observation').length;
    const segments=[];
    for(const row of daily) {
      const previous=segments.at(-1);
      const key=JSON.stringify([row.status,row.limit,row.origin,row.sourceUrl,row.reason]);
      if(previous?.key===key){previous.to=row.date;previous.days++;}
      else segments.push({key,from:row.date,to:row.date,days:1,status:row.status,limit:row.limit,origin:row.origin,source:row.source,sourceUrl:row.sourceUrl,noticeId:row.noticeId,reason:row.reason,evidence:row.evidence});
    }
    result[channel] = { knownTotal: coveredDays ? total : null, total: ready && coveredDays === STABILITY_WINDOW_DAYS ? total : null, coveredDays, observedDays, inferredDays: coveredDays - observedDays, openDays: known.filter(r => r.status === 'open').length, missingDays: STABILITY_WINDOW_DAYS - coveredDays, complete: ready && coveredDays === STABILITY_WINDOW_DAYS, daily:daily.map(({date,status,limit})=>({date,status,limit})), segments:segments.map(({key,...segment})=>segment) };
  }
  return result;
}

// One-time import of the existing published observation, never a retrospective rule reconstruction.
export function seedQuotaHistory(store, catalog) {
  if (store.getMeta('quotaHistory:seeded')) return;
  for (const fund of catalog.filter(f => f.venue !== 'etf')) {
    const published = store.getMeta(`published:${fund.code}`);
    if (!published || published.stale || published.pendingNoticeCount || published.direct?.pendingReview) continue;
    const agencyAt = Date.parse(published.agency?.observedAt), directAt = Date.parse(published.noticeCheckedAt);
    if (!Number.isFinite(agencyAt) || !Number.isFinite(directAt)) continue;
    const asOf = new Date(Math.max(agencyAt, directAt));
    if (+asOf > Date.now() || (published.direct?.effectiveAt && Date.parse(published.direct.effectiveAt) > directAt)) continue;
    recordQuotaDay(store, { ...published, venue: fund.venue }, asOf);
  }
  store.setMeta('quotaHistory:seeded', new Date().toISOString());
}
