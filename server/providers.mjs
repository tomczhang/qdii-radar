import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { agencyQuota, buildNavTrend, chinaDate, finiteNumber } from './domain.mjs';

const mobileBase = 'https://fundmobapi.eastmoney.com/FundMNewApi/';
const common = { deviceid: '1', plat: 'Android', product: 'EFund', version: '6.2.8' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function getBytes(url, maxSize = 8 * 1024 * 1024) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fundf10.eastmoney.com/' } });
      if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
      if (Number(response.headers.get('content-length') || 0) > maxSize) throw new Error('响应超出大小限制');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > maxSize) { throw new Error('响应超出大小限制'); } chunks.push(chunk); }
      return Buffer.concat(chunks);
    } catch (error) { failure = error; if (attempt < 2) await sleep(500 * 2 ** attempt); }
  }
  // Never include URLs: provider authentication may be carried in query parameters.
  throw new Error(failure?.name === 'TimeoutError' ? '上游请求超时' : '上游请求失败');
}
async function mobile(endpoint, code, extra = {}) {
  const url = `${mobileBase}${endpoint}?${new URLSearchParams({ FCODE: code, ...common, ...extra })}`;
  const raw = JSON.parse((await getBytes(url, 2 * 1024 * 1024)).toString());
  if (raw.Success !== true || Number(raw.ErrCode || 0) !== 0) throw new Error('天天接口返回业务错误');
  return raw;
}
export async function fetchMarket(fund) {
  const [basic, period, history] = await Promise.all([
    mobile('FundMNBasicInformation', fund.code),
    mobile('FundMNPeriodIncrease', fund.code),
    mobile('FundMNHisNetList', fund.code, { pageIndex: '1', pageSize: '35' }),
  ]);
  const b = basic.Datas;
  if (b.FCODE !== fund.code || !Array.isArray(period.Datas) || !Array.isArray(history.Datas)) throw new Error('上游基金代码或结构不匹配');
  const navs = history.Datas.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.FSRQ) && finiteNumber(row.DWJZ) > 0).sort((a, b) => a.FSRQ.localeCompare(b.FSRQ)).slice(-30);
  // Chain daily NAV growth to include dividend effects; never divide cumulative NAVs across distributions.
  const trend = buildNavTrend(navs);
  const returns = { y1: null, y3: null, y5: null };
  const asOf = period.Expansion?.TIME;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) throw new Error('收益截止日期缺失');
  for (const [key, title, years] of [['y1', '1N', 1], ['y3', '3N', 3], ['y5', '5N', 5]]) {
    const date = new Date(asOf + 'T00:00:00+08:00'); date.setUTCFullYear(date.getUTCFullYear() - years);
    const established = period.Expansion?.ESTABDATE || b.ESTABDATE;
    returns[key] = established && established <= chinaDate(date) ? finiteNumber(period.Datas.find(r => r.title === title)?.syl) : null;
  }
  return {
    ...fund, fullName: b.SHORTNAME, established: b.ESTABDATE, observedAt: new Date().toISOString(),
    agency: { ...agencyQuota(b), source: '天天基金', observedAt: new Date().toISOString() },
    returns, returnsAsOf: asOf, navAsOf: b.FSRQ, dailyChange: finiteNumber(b.RZDF),
    ...trend,
    marketSource: '天天基金', marketError: null,
    raw: { basic, period, history },
  };
}
export async function fetchNoticePage(code, page, type = 0) {
  const query = new URLSearchParams({ fundcode: code, pageIndex: String(page), pageSize: '50', type: String(type), callback: 'cb' });
  const text = (await getBytes(`https://api.fund.eastmoney.com/f10/JJGG?${query}`, 3 * 1024 * 1024)).toString();
  const clean = text.replace(/^\s*cb\(/, '').replace(/\)\s*;?\s*$/, '');
  const data = JSON.parse(clean);
  if (Number(data.ErrCode) !== 0 || !Array.isArray(data.Data)) throw new Error('公告列表结构异常');
  return { notices: data.Data.map(n => ({ id: n.ID, code, title: n.TITLE, publishedAt: n.PUBLISHDATE?.slice(0, 10), sourceUrl: `https://pdf.dfcfw.com/pdf/H2_${n.ID}_1.pdf` })).filter(n => /^AN\d+$/.test(n.id) && /^\d{4}-\d{2}-\d{2}$/.test(n.publishedAt || '')), total: Number(data.TotalCount) };
}
export async function fetchNoticeText(notice, directory) {
  const dir = path.join(directory, 'notices'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const textPath = path.join(dir, notice.id + '.txt');
  try { return await fs.readFile(textPath, 'utf8'); } catch {}
  const bytes = await getBytes(notice.sourceUrl);
  if (!bytes.subarray(0, 5).toString().startsWith('%PDF-')) throw new Error('公告源不是PDF');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const document = await task.promise;
  if (document.numPages > 50) { await task.destroy(); throw new Error('公告过长，需人工核验'); }
  let text = '';
  try { for (let p = 1; p <= document.numPages; p++) { const page = await document.getPage(p); const content = await page.getTextContent(); text += content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') + '\n'; } }
  finally { await task.destroy(); }
  await fs.writeFile(path.join(dir, notice.id + '.pdf'), bytes, { mode: 0o600 });
  await fs.writeFile(textPath, text, { mode: 0o600 });
  return text;
}

export const gildataConfigured = () => !!process.env.GILDATA_MCP_URL;
export function parseMarkdownTable(markdown) {
  const lines = markdown.split('\n').filter(line => line.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const headers = cells(lines[0]);
  return lines.slice(2).map(line => Object.fromEntries(cells(line).map((value, index) => [headers[index], value])));
}
export async function fetchGildata(fund) {
  const url = new URL(process.env.GILDATA_MCP_URL);
  const headers = process.env.GILDATA_MCP_TOKEN ? { Authorization: `Bearer ${process.env.GILDATA_MCP_TOKEN}` } : {};
  const client = new Client({ name: 'qdii-quota-radar', version: '1.0.0' });
  const Transport = process.env.GILDATA_MCP_TRANSPORT === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport;
  try {
    await client.connect(new Transport(url, { requestInit: { headers } }), { timeout: 30000 });
    const response = await client.callTool({ name: 'FinQuery', arguments: { query: `仅查询人民币公募基金${fund.code}，截至${chinaDate()}最近已公布的近一年、近三年、近五年累计收益率（非年化）、对应截止日期和成立日期；另返回最近30个已公布交易日的复权单位净值。保留基金代码，输出结构化表格。` } }, undefined, { timeout: 90000 });
    if (response.isError) throw new Error('聚源返回错误');
    const payload = response.structuredContent || JSON.parse(response.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
    if (payload.code !== 0 || !Array.isArray(payload.results)) throw new Error('聚源结构不匹配');
    const rows = payload.results.flatMap(r => parseMarkdownTable(r.table_markdown || ''));
    const periods = rows.filter(r => r['基金代码'] === fund.code && ['近一年', '近三年', '近五年'].includes(r['时间区间']));
    if (!periods.length || new Set(periods.map(r => r['截止日期'])).size !== 1) throw new Error('聚源收益截止日不一致或缺失');
    const returns = Object.fromEntries([['y1', '近一年'], ['y3', '近三年'], ['y5', '近五年']].map(([key, name]) => [key, finiteNumber(periods.find(r => r['时间区间'] === name)?.['基金收益率(%)'])]));
    const navs = rows.filter(r => r['基金代码'] === fund.code && finiteNumber(r['复权单位净值(元)']) > 0).sort((a, b) => a['截止日期'].localeCompare(b['截止日期'])).slice(-30);
    return { returns, returnsAsOf: periods[0]['截止日期'], marketSource: '恒生聚源', ...(navs.length > 1 ? { trend: navs.map(r => Number((Number(r['复权单位净值(元)']) / Number(navs[0]['复权单位净值(元)']) * 100).toFixed(5))), trendDates: navs.map(r => r['截止日期']) } : {}), gildataRaw: payload };
  } finally { await client.close().catch(() => {}); }
}
