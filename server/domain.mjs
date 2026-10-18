import { createHash } from 'node:crypto';

export const digest = (s) => createHash('sha256').update(String(s)).digest('hex');
export const chinaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const finiteNumber = (value) => value == null || value === '' || value === '--' || value === '-' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const unknownQuota = (reason = '尚无已核验额度') => ({ status: 'unknown', limit: null, reason });
export function agencyQuota(raw) {
  if (/暂停|停止/.test(raw.SGZT || '')) return { status: 'paused', limit: null };
  if (raw.BUY === false) return { status: 'unavailable', limit: null, reason: '天天基金当前不可购买，不代表其他渠道状态' };
  const limit = finiteNumber(raw.MAXSG);
  // Vendor sentinel values are not evidence of an unlimited allowance.
  if (raw.BUY === true && limit > 0 && limit < 1e10) return { status: 'open', limit };
  return unknownQuota('接口未提供明确上限');
}
export function classifyChange(before, after) {
  if (!before || before.status === 'unknown' || after.status === 'unknown') return null;
  if (before.status === after.status && before.limit === after.limit) return null;
  if (after.status === 'paused' && before.status === 'open') return 'pause';
  if (after.status === 'open' && before.status === 'paused') return 'resume';
  if (before.status === 'open' && after.status === 'open') return after.limit > before.limit ? 'increase' : 'decrease';
  return null; // Availability changes are not proof of a fund-wide quota change.
}
export const quotaText = q => q.status === 'open' ? `${q.limit} 元` : ({ paused: '暂停申购', unavailable: '渠道不可购买', unknown: '待核验' }[q.status] || '待核验');
export function isQuotaNotice(title) {
  return /申购|定投|定期定额|转换转入/.test(title) && /暂停|恢复|调整|限额|限制|大额/.test(title) && !/费率|招募说明|合同|定期报告|产品资料/.test(title);
}
export const noticeShares = title => [...title.replace(/QDII|ETF|LOF/g, '').matchAll(/([ACDEFHI])(?=两?类|份额|[、,，/](?:[ACDEFHI][、,，/]?)*(?:两?类|份额))/g)].map(m => m[1]);
const datePattern = '(20\\d{2})年(\\d{1,2})月(\\d{1,2})日';
function normalizedDate(match) {
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(date + 'T00:00:00+08:00');
  return Number.isFinite(+parsed) && chinaDate(parsed) === date ? date + 'T00:00:00+08:00' : null;
}
export function parseQuotaNotice({ title, text, code, share, sourceUrl, publishedAt }) {
  const t = text.replace(/\s+/g, '').replace(/[，]/g, ',').replace(/[（]/g, '(').replace(/[）]/g, ')');
  const pending = (reason) => ({ status: 'pending_review', reason, rules: [] });
  if (!isQuotaNotice(title)) return { status: 'ignored', rules: [], reason: '不涉及申购额度' };
  if (/美元/.test(title) && !/人民币/.test(title)) return { status: 'ignored', rules: [], reason: '公告仅涉及美元份额，本看板跟踪人民币份额' };
  if (t.length < 100) return pending('正文不足，可能为扫描版PDF');
  if (!new RegExp(`(?<!\\d)${code}(?!\\d)`).test(text)) return pending('正文未明确包含该份额代码');
  if (/机构投资者|非个人投资者|特定投资者|部分销售|仅限.{0,20}直销|恢复.{0,20}20\d{2}年/.test(t)) return pending('包含投资者、渠道子类型或多阶段规则，需核验');
  if (/15[:：]00|15点|15时/.test(t)) return pending('含交易截止时点，需核验交易日生效规则');
  const date = normalizedDate(t.match(new RegExp(`(?:自|从)${datePattern}起`))) || normalizedDate(t.match(new RegExp(`(?:暂停申购起始日|恢复申购起始日|调整大额申购起始日|限制大额申购起始日)[:：]?${datePattern}`)));
  if (!date) return pending('未识别明确生效日期');
  const dates = [...t.matchAll(new RegExp(`(?:自|从)${datePattern}起`, 'g'))].map(normalizedDate).filter(Boolean);
  if (new Set(dates).size > 1) return pending('正文包含多个生效日期');
  const titleShares = noticeShares(title.replace(/\s/g, ''));
  if (titleShares.length && !titleShares.includes(share)) return { status: 'ignored', rules: [], reason: '公告标题限定其他份额' };
  const base = { code, effectiveAt: date, sourceUrl, publishedAt, noticeTitle: title, note: '以公告正文的单日累计及份额合并规则为准。' };
  // Auto-apply only an unambiguous whole-fund suspension. Never treat a large-order suspension as a full suspension.
  if (/暂停/.test(title) && /申购/.test(title) && !/大额|部分|限额/.test(title)) {
    if (/否|除外|不受|除.{0,30}外/.test(t.replaceAll('是否', '')) || /(?:直销|代销|销售机构).{0,20}暂停/.test(t)) return pending('存在适用范围例外');
    if (/恢复/.test(t) && new RegExp(`恢复.{0,40}${datePattern}`).test(t)) return pending('存在恢复日期，需要成对生效规则');
    return { status: 'parsed', reason: '明确全渠道暂停', rules: ['agency', 'direct'].map(channel => ({ ...base, channel, status: 'paused', limit: null, evidence: t.slice(Math.max(0, t.indexOf('暂停申购起始日') - 15), t.indexOf('暂停申购起始日') + 90) })) };
  }
  const body = t.includes('其他需要提示的事项') ? t.split('其他需要提示的事项').slice(1).join('') : t;
  const statements = body.split(/[。；]/).filter(s => /申购/.test(s) && /单日/.test(s) && /(?:不超过|调整为|限额|超过)/.test(s));
  const candidates = [];
  for (const statement of statements) {
    if (/美元|机构投资者|除外|不受|不含(?![\d.])|不包括|之外|但|原限额|原为/.test(statement)) continue;
    const mentionedShares = [...statement.matchAll(/([ACDEFHI])(?:类|份额)/g)].map(m => m[1]);
    if (mentionedShares.length && !mentionedShares.includes(share)) continue;
    const amountMatches = [...statement.matchAll(/(?:不超过|调整为|限额(?:为)?|超过)([\d,]+(?:\.\d+)?)(万)?元/g)];
    const amounts = [...new Set(amountMatches.map(m => Number(m[1].replaceAll(',', '')) * (m[2] ? 10000 : 1)))];
    if (amounts.length !== 1 || amounts[0] <= 0 || amounts[0] > 1e8) continue;
    let channels;
    const direct = /直销/.test(statement), agency = /代销|其他销售机构/.test(statement);
    if (direct && agency) continue;
    if (direct) channels = ['direct']; else if (agency) channels = ['agency'];
    else if (!/直销|代销|销售机构|柜台/.test(body)) channels = ['agency', 'direct'];
    else continue;
    const combined = /合并计算/.test(body);
    for (const channel of channels) candidates.push({ ...base, channel, status: 'open', limit: amounts[0], note: combined ? '公告包含跨份额合并计算规则，不能按份额或渠道简单累加。' : '单日单基金账户累计，具体业务合并范围见公告。', evidence: statement.slice(0, 1200) });
  }
  const rules = [];
  for (const channel of ['agency', 'direct']) {
    const options = candidates.filter(r => r.channel === channel);
    if (new Set(options.map(r => r.limit)).size > 1) return pending('同一渠道有多个金额，需要核验');
    if (options.length) rules.push(options[0]);
  }
  if (!rules.some(r => r.channel === 'direct') && /直销/.test(body)) return pending('直销规则未完整识别，不能只用代销解析结果确认全篇公告');
  return rules.length ? { status: 'parsed', rules, reason: '正文明确日期、渠道和单日金额' } : pending('未能安全识别份额对应的渠道限额');
}

export function buildNavTrend(rows) {
  // A missing daily change breaks the return chain; show only the subsequent continuous window.
  let start = 0;
  for (let i = 1; i < rows.length; i++) if (finiteNumber(rows[i].JZZZL) == null) start = i;
  const window = rows.slice(start); let index = 100;
  return { trend: window.map((row, i) => { if (i) index *= 1 + finiteNumber(row.JZZZL) / 100; return Number(index.toFixed(5)); }), trendDates: window.map(r => r.FSRQ), trendNote: start ? '部分历史日增长率缺失，仅显示最近连续数据；未插值补齐。' : null };
}

export function nextDailyRun(now = new Date(), schedule = '07:30') {
  let next = new Date(`${chinaDate(now)}T${schedule}:00+08:00`);
  if (next <= now) next = new Date(+next + 86400000);
  return next.toISOString();
}
