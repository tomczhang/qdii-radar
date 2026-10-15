import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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
    marketSource: '天天基金', performanceSource: '天天基金', navSource: '天天基金', trendSource: '天天基金', marketError: null,
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

export { fetchGildata, gildataConfigured } from './gildata.mjs';
