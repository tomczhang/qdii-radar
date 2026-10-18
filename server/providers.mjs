import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { agencyQuota, buildNavTrend, chinaDate, finiteNumber } from './domain.mjs';
import {parseFeePage} from './fees.mjs';

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
export async function fetchFees(code) {
  return parseFeePage((await getBytes(`https://fundf10.eastmoney.com/jjfl_${code}.html`)).toString(),code);
}
export async function fetchMarket(fund, request = mobile, feeRequest = request === mobile ? fetchFees : async () => null) {
  const results = await Promise.allSettled([
    request('FundMNBasicInformation', fund.code),
    request('FundMNPeriodIncrease', fund.code),
    request('FundMNHisNetList', fund.code, { pageIndex: '1', pageSize: '35' }),
    fund.venue === 'etf' ? Promise.resolve(null) : feeRequest(fund.code),
  ]);
  const [basic, period, history] = results.map(r => r.status === 'fulfilled' ? r.value : null);
  const b = basic?.Datas;
  if (b?.FCODE !== fund.code) throw new Error('上游基金代码或结构不匹配');
  const at = new Date().toISOString();
  const data = {
    ...fund, fullName: b.SHORTNAME, established: b.ESTABDATE, observedAt: at,
    agency: { ...(fund.venue === 'etf' ? { status: 'not_applicable', limit: null } : agencyQuota(b)), source: '天天基金', observedAt: at },
    marketSource: '天天基金', marketError: null, sourceErrors: [], raw: { basic, period, history },
  };
  if (results[3].status === 'fulfilled' && results[3].value) data.fees = results[3].value;
  else if (fund.venue !== 'etf') data.sourceErrors.push('fees');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value && value <= chinaDate();
  try {
    const asOf = period?.Expansion?.TIME, established = period?.Expansion?.ESTABDATE || b.ESTABDATE;
    if (!Array.isArray(period?.Datas) || !validDate(asOf) || !validDate(established) || established > asOf) throw new Error();
    const returns = {};
    for (const [key, title, years] of [['y1','1N',1],['y3','3N',3],['y5','5N',5]]) {
      const anniversary = new Date(asOf+'T00:00:00Z'); anniversary.setUTCFullYear(anniversary.getUTCFullYear()-years);
      returns[key] = established <= anniversary.toISOString().slice(0,10) ? finiteNumber(period.Datas.find(r=>r.title===title)?.syl) : null;
      if (established <= anniversary.toISOString().slice(0,10) && (returns[key] == null || returns[key] < -100)) throw new Error();
    }
    Object.assign(data, { returns, returnsAsOf: asOf, performanceSource: '天天基金' });
  } catch { data.sourceErrors.push('returns'); }
  try {
    if (!Array.isArray(history?.Datas)) throw new Error();
    const navs = history.Datas.filter(row=>validDate(row.FSRQ) && finiteNumber(row.DWJZ)>0).sort((a,b)=>a.FSRQ.localeCompare(b.FSRQ)).slice(-30);
    if (!navs.length) throw new Error();
    const last = navs.at(-1), trend = buildNavTrend(navs);
    Object.assign(data, { ...trend, navAsOf:last.FSRQ, dailyChange:finiteNumber(last.JZZZL) ?? (b.FSRQ === last.FSRQ ? finiteNumber(b.RZDF) : null), navSource:'天天基金', trendSource:'天天基金' });
  } catch { data.sourceErrors.push('nav'); }
  return data;
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

export { fetchGildata, gildataConfigured } from './gildata.mjs';
