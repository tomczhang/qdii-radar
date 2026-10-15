import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chinaDate, finiteNumber } from './domain.mjs';

export const DEFAULT_GILDATA_URL = 'https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool';
export function gildataConnection(env = process.env) {
  const token = env.GILDATA_MCP_TOKEN?.trim();
  const url = new URL(env.GILDATA_MCP_URL || DEFAULT_GILDATA_URL);
  if (!token && !url.searchParams.get('token')) return null;
  if (url.protocol !== 'https:') throw new Error('聚源接口必须使用HTTPS');
  const protocol = env.GILDATA_MCP_TRANSPORT || 'http';
  if (!['http', 'sse'].includes(protocol)) throw new Error('聚源传输类型无效');
  const auth = env.GILDATA_MCP_AUTH || 'query';
  if (!['query', 'bearer'].includes(auth)) throw new Error('聚源认证类型无效');
  const headers = {};
  if (auth === 'query') { if (token) url.searchParams.set('token', token); }
  else { if (!token) return null; url.searchParams.delete('token'); headers.Authorization = `Bearer ${token}`; }
  return { url, protocol, headers };
}
export const gildataConfigured = () => { try { return !!gildataConnection(); } catch { return false; } };
export function parseMarkdownTable(markdown) {
  if (typeof markdown !== 'string') return [];
  const lines = markdown.split('\n').filter(line => line.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const headers = cells(lines[0]);
  return lines.slice(2).map(line => Object.fromEntries(cells(line).map((value, index) => [headers[index], value])));
}
const validDate = (value, today) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && value <= today && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const numeric = value => finiteNumber(typeof value === 'string' ? value.replace(/[%％,]/g, '') : value);
export function parseGildataResponse(response, fund, today = chinaDate()) {
  if (response.isError) throw new Error('聚源返回业务错误');
  let payload = response.structuredContent;
  if (!payload) {
    const text = response.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
    try { payload = JSON.parse(text); } catch { throw new Error('聚源响应不是结构化数据'); }
  }
  if (payload.code !== 0 || !Array.isArray(payload.results)) throw new Error('聚源数据结构不匹配');
  const rows = payload.results.flatMap(r => parseMarkdownTable(r.table_markdown));
  const own = rows.filter(r => r['基金代码'] === fund.code);
  if (!own.length || own.some(r => /美元|USD/i.test(r['基金简称'] || ''))) throw new Error('聚源基金代码或币种不匹配');
  const periods = own.filter(r => ['近一年', '近三年', '近五年'].includes(r['时间区间']));
  const dates = [...new Set(periods.map(r => r['截止日期']))];
  if (dates.length !== 1 || !validDate(dates[0], today)) throw new Error('聚源收益截止日期不一致或无效');
  const asOf = dates[0];
  const establishedDates = [...new Set(own.flatMap(r => [r['基金成立日'], r['成立日期']]).filter(d => validDate(d, today)))];
  if (establishedDates.length !== 1) throw new Error('聚源份额成立日期缺失或冲突');
  const established = establishedDates[0];
  if (established > asOf) throw new Error('聚源成立日晚于收益日');
  const returns = {};
  for (const [key, name, years] of [['y1','近一年',1],['y3','近三年',3],['y5','近五年',5]]) {
    const anniversary = new Date(asOf + 'T00:00:00Z'); anniversary.setUTCFullYear(anniversary.getUTCFullYear() - years);
    const values = [...new Set(periods.filter(r => r['时间区间'] === name).map(r => numeric(r['基金收益率(%)'])))];
    if (values.length > 1) throw new Error('聚源同一收益区间存在冲突');
    if (established > anniversary.toISOString().slice(0,10)) returns[key] = null;
    else if (values.length === 1 && values[0] != null && values[0] >= -100) returns[key] = values[0];
    else throw new Error('聚源缺少已满年限的累计收益');
  }
  const navRows = own.filter(r => Object.hasOwn(r, '复权单位净值(元)'));
  const byDate = new Map();
  for (const row of navRows) {
    const date = row['截止日期'], value = numeric(row['复权单位净值(元)']);
    if (!validDate(date, today) || value == null || value <= 0) throw new Error('聚源复权净值或日期无效');
    if (byDate.has(date) && numeric(byDate.get(date)['复权单位净值(元)']) !== value) throw new Error('聚源同日净值存在冲突');
    byDate.set(date, row);
  }
  const navs = [...byDate.values()].sort((a,b) => a['截止日期'].localeCompare(b['截止日期'])).slice(-30);
  if (navs.length < 2) throw new Error('聚源近期复权净值不足');
  const latest = navs.at(-1), previous = navs.at(-2);
  const day = numeric(latest['单位基金净值增长率(%)']) ?? ((numeric(latest['复权单位净值(元)']) / numeric(previous['复权单位净值(元)']) - 1) * 100);
  return {
    returns, returnsAsOf: asOf, established, marketSource: '恒生聚源', performanceSource: '恒生聚源',
    navAsOf: latest['截止日期'], dailyChange: day, navSource: '恒生聚源', trendSource: '恒生聚源', trendNote: null,
    trend: navs.map(r => Number((numeric(r['复权单位净值(元)']) / numeric(navs[0]['复权单位净值(元)']) * 100).toFixed(5))),
    trendDates: navs.map(r => r['截止日期']), gildataRaw: payload,
  };
}
export function mergeGildata(snapshot, data) {
  const merged = { ...snapshot, performanceSource: snapshot.performanceSource || snapshot.marketSource, navSource: snapshot.navSource || snapshot.marketSource, trendSource: snapshot.trendSource || snapshot.marketSource, gildataRaw: data.gildataRaw };
  // Never replace a newer observation with an older provider result. NAV, daily return and chart move together.
  if (data.returnsAsOf >= (snapshot.returnsAsOf || '')) Object.assign(merged, { returns: data.returns, returnsAsOf: data.returnsAsOf, performanceSource: data.performanceSource, established: data.established });
  if (data.navAsOf >= (snapshot.navAsOf || '')) {
    for (const key of ['navAsOf','dailyChange','navSource','trendSource','trend','trendDates','trendNote']) merged[key] = data[key];
  }
  merged.marketSource = [...new Set([merged.performanceSource, merged.navSource, merged.trendSource])].join(' / ');
  return merged;
}
export async function fetchGildata(fund) {
  const config = gildataConnection();
  if (!config) throw new Error('聚源尚未配置');
  const client = new Client({ name: 'qdii-quota-radar', version: '1.0.0' });
  const Transport = config.protocol === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport;
  try {
    await client.connect(new Transport(config.url, { requestInit: { headers: config.headers, redirect: 'error' } }), { timeout: 30000 });
    const response = await client.callTool({ name: 'FinQuery', arguments: { query: `仅查询人民币公募基金${fund.code}（${fund.name}${fund.share}），截至${chinaDate()}最近已公布的近一年、近三年、近五年累计收益率（非年化）、对应截止日期和该份额成立日期；另返回最近30个已公布交易日的复权单位净值及每日净值增长率。保留基金代码，输出阶段业绩表现、净值表现结构化表格。不要返回美元份额或其他基金。` } }, undefined, { timeout: 90000 });
    return parseGildataResponse(response, fund);
  } catch { throw new Error('聚源请求或数据校验失败'); }
  finally { await client.close().catch(() => {}); }
}
