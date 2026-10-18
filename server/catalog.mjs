import { readFileSync } from 'node:fs';
import { getBytes } from './providers.mjs';

export const DIRECTORY_URL = 'https://fund.eastmoney.com/js/fundcode_search.js';
export const seedCatalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
export const getCatalog = store => {
  const entries = new Map(seedCatalog.map(f => [f.code, { venue: 'otc', currency: 'CNY', ...f }]));
  for (const fund of store.getMeta('catalog:funds') || []) entries.set(fund.code, fund);
  return [...entries.values()].sort((a, b) => a.code.localeCompare(b.code));
};
export function parseDirectory(text) {
  // Parse data only; never execute the vendor's JavaScript.
  const match = text.match(/^\s*var\s+r\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) throw new Error('基金目录格式异常');
  const rows = JSON.parse(match[1]);
  if (!Array.isArray(rows) || !rows.length || rows.some(r => !Array.isArray(r) || !/^\d{6}$/.test(r[0]) || typeof r[2] !== 'string')) throw new Error('基金目录内容异常');
  if (new Set(rows.map(r => r[0])).size !== rows.length) throw new Error('基金目录存在重复代码');
  return rows.map(r => ({ code: r[0], directoryName: r[2], directoryType: r[3] }));
}
export const isCandidate = row => /纳斯达克|纳指|标普\s*500|标准普尔\s*500/i.test(row.directoryName) && !/美元|美汇|美钞|港币/.test(row.directoryName);
const clean = value => value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').trim();
export function parseProfile(html, row, now = new Date()) {
  const fields = {};
  for (const match of html.matchAll(/<th\b[^>]*>([^<]*)<\/th>\s*<td\b[^>]*>([\s\S]*?)(?=<\/td>|<th|<\/tr>)/g)) fields[clean(match[1])] = clean(match[2]);
  if (!fields['基金代码']?.match(new RegExp(`^${row.code}(?!\\d)`)) || !fields['基金全称'] || !fields['基金管理人'] || !('跟踪标的' in fields)) throw new Error('基金档案字段或代码不匹配');
  const target = fields['跟踪标的'].replace(/\s/g, '');
  const index = /^(?:纳斯达克100|NASDAQ-?100)指数$/i.test(target) ? 'nasdaq' : /^(?:标准普尔500|标普500|S&P500)指数$/i.test(target) ? 'sp500' : null;
  // Some FOFs disclose no tracking target: admit only the specifically named S&P 500 FOF with its matching benchmark.
  const fof = /标普500.*FOF/i.test(row.directoryName) && /^(?:无|该基金无跟踪标的|--)$/i.test(target) && /(?:标普|标准普尔)500指数/.test(fields['业绩比较基准'] || '');
  if ((!index && !fof) || /美元|美汇|美钞|港币/.test(row.directoryName)) return null;
  const venue = /交易型开放式/.test(fields['基金全称']) && !/联接/.test(fields['基金全称']) ? 'etf' : 'otc';
  const name = row.directoryName;
  const share = venue === 'etf' ? '' : name.replace(/QDII|ETF|LOF|FOF/gi, '').match(/[A-Z](?=[^A-Z]*$)/)?.[0] || '';
  const manager = fields['基金管理人'];
  return { code: row.code, name: venue === 'etf' ? name : `${manager.replace(/基金.*$/, '')}${(index || 'sp500') === 'nasdaq' ? '纳斯达克100' : '标普500'}`, fullName: name, legalName: fields['基金全称'], manager, share, index: index || 'sp500', venue, currency: 'CNY', type: venue === 'etf' ? '场内ETF' : /联接/.test(name) ? 'ETF联接' : /FOF/.test(name) ? 'FOF' : /LOF/.test(name) || /^16/.test(row.code) ? '指数基金（LOF）' : '指数基金', color: (index || 'sp500') === 'nasdaq' ? '#5883c4' : '#637d98', trackingTarget: fields['跟踪标的'], benchmark: fields['业绩比较基准'], catalogSourceUrl: `https://fundf10.eastmoney.com/jbgk_${row.code}.html`, catalogVerifiedAt: now.toISOString() };
}
export async function discoverFunds(store, providers = {}, now = new Date()) {
  const checkedAt = now.toISOString();
  const state = { checkedAt, status: 'running', added: [], errors: [], sourceUrl: DIRECTORY_URL };
  store.setMeta('catalog:lastDiscovery', state);
  try {
    const rows = parseDirectory(await (providers.directory || (async () => (await getBytes(DIRECTORY_URL)).toString()))());
    const lastSize = store.getMeta('catalog:directorySize');
    if (lastSize && rows.length < lastSize * 0.8) throw new Error('基金目录异常缩减');
    const candidates = rows.filter(isCandidate);
    state.candidates = candidates.length;
    const funds = new Map(getCatalog(store).map(f => [f.code, f]));
    const reviews = store.getMeta('catalog:reviews') || {};
    let i = 0;
    await Promise.all(Array.from({ length: 1 }, async () => {
      while (i < candidates.length) {
        const row = candidates[i++], old = reviews[row.code];
        if (old?.name === row.directoryName && +now - Date.parse(old.checkedAt) < 7 * 86400000) continue;
        try {
          if (!providers.profile) await new Promise(resolve => setTimeout(resolve, 350));
          const html = await (providers.profile || (async code => (await getBytes(`https://fundf10.eastmoney.com/jbgk_${code}.html`)).toString()))(row.code);
          const fund = parseProfile(html, row, now);
          if (fund) { if (!funds.has(fund.code)) state.added.push(fund.code); funds.set(fund.code, { ...fund, discoveredAt: funds.get(fund.code)?.discoveredAt || checkedAt }); }
          // A previously admitted fund changing scope requires review; never silently delete it.
          else if (funds.has(row.code)) { state.errors.push({ code: row.code, reason: '已收录基金标的变更，需人工复核' }); continue; }
          reviews[row.code] = { name: row.directoryName, checkedAt, admitted: !!fund };
        } catch { state.errors.push({ code: row.code, reason: '基金档案核验失败，下次重试' }); }
      }
    }));
    store.setMeta('catalog:funds', [...funds.values()]);
    store.setMeta('catalog:reviews', reviews);
    store.setMeta('catalog:directorySize', rows.length);
    state.status = state.errors.length ? 'partial' : 'success';
    state.total = funds.size;
    state.otc = [...funds.values()].filter(f => f.venue !== 'etf').length;
    state.etf = funds.size - state.otc;
  } catch { state.status = 'failed'; state.errors.push({ reason: '目录获取或校验失败，保留已有名单' }); }
  store.setMeta('catalog:lastDiscovery', state);
  return state;
}
