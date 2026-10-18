import { readFileSync } from 'node:fs';
import { chinaDate, classifyChange, digest, isQuotaNotice, parseQuotaNotice, quotaText } from './domain.mjs';
import { fetchNoticePage, fetchNoticeText } from './providers.mjs';
const verified = JSON.parse(readFileSync(new URL('./verified-change-history.json', import.meta.url)));
const verifiedRules = JSON.parse(readFileSync(new URL('./verified-history-rules.json', import.meta.url)));
export const CHANGE_HISTORY_VERSION = 2;
const unknown = () => ({ status: 'unknown', limit: null });
const aggregate = quotas => {
  const values = Object.values(quotas);
  return values.length && new Set(values.map(quotaText)).size === 1 ? { status: values[0].status, limit: values[0].limit } : unknown();
};
const channelText = quotas => Object.entries(quotas).map(([channel,q]) => `${channel === 'direct' ? '直销' : '代销'}${q.status === 'unknown' ? '原额度未核验' : quotaText(q)}`).join(' / ');
export function changeWindow(now = new Date()) {
  const start = new Date(`${chinaDate(now)}T00:00:00+08:00`); start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString(), to: now.toISOString(), startDate: chinaDate(start), endDate: chinaDate(now), days: 30 };
}
export function historyRecord(notice, fund, text, now = new Date()) {
  const textHash = digest(text);
  const reviewed = verified.find(v => v.noticeId === notice.id && v.code === fund.code && v.textHash === textHash);
  if (reviewed?.state === 'ignored') return { ...notice, name: `${fund.name} ${fund.share}`, state: 'ignored', reason: reviewed.reason, textHash };
  const sharedRules = verifiedRules.filter(v => v.noticeId === notice.id && v.code === fund.code && v.textHash === textHash);
  const parsed = reviewed || sharedRules.length ? null : parseQuotaNotice({ ...notice, code: fund.code, share: fund.share, text });
  if (parsed && parsed.status !== 'parsed') return { ...notice, name: `${fund.name} ${fund.share}`, state: parsed.status === 'ignored' ? 'ignored' : 'pending_review', reason: parsed.reason, textHash };
  const rules = reviewed ? (reviewed.channel === '直销' ? ['direct'] : reviewed.channel === '代销' ? ['agency'] : ['agency','direct']).map(channel => ({ ...reviewed.afterQuota, channel, effectiveAt: reviewed.effectiveAt, evidence: reviewed.evidence })) : sharedRules.length ? sharedRules : parsed.rules;
  if (new Set(rules.map(r => r.effectiveAt)).size !== 1) return { ...notice, name: `${fund.name} ${fund.share}`, state: 'pending_review', reason: '渠道规则生效时间不一致', textHash };
  const channelKeys = rules.map(r => r.channel);
  const afterByChannel = Object.fromEntries(rules.map(r => [r.channel, {status:r.status,limit:r.limit}]));
  const beforeByChannel = Object.fromEntries(rules.map(r => [r.channel, reviewed?.beforeByChannel?.[r.channel] || reviewed?.beforeQuota || r.beforeQuota || unknown()]));
  const afterQuota = aggregate(afterByChannel), beforeQuota = aggregate(beforeByChannel);
  const beforeSources = reviewed?.beforeSources || rules.flatMap(r => r.beforeSources || []);
  return { id: `notice-history-${notice.id}-${fund.code}`, noticeId: notice.id, code: fund.code, name: `${fund.name} ${fund.share}`, channel: reviewed?.channel || (rules.length === 2 ? '基金申购' : rules[0].channel === 'direct' ? '直销' : '代销'),
    channelKeys, kind: 'announcement', state: 'verified', type: reviewed?.type || classifyChange(beforeQuota,afterQuota) || (afterQuota.status === 'paused' ? 'pause' : 'announcement'),
    beforeQuota, afterQuota, beforeByChannel, afterByChannel, beforeSources,
    before: beforeQuota.status !== 'unknown' ? quotaText(beforeQuota) : Object.values(beforeByChannel).every(q=>q.status==='unknown') ? '原额度未核验' : channelText(beforeByChannel),
    after: afterQuota.status !== 'unknown' ? quotaText(afterQuota) : channelText(afterByChannel),
    effectiveAt: rules[0].effectiveAt, createdAt: now.toISOString(), publishedAt: notice.publishedAt, sourceUrl: notice.sourceUrl, noticeTitle: notice.title, textHash, evidence: reviewed?.evidence || rules.map(r=>r.evidence).join('；') };
}
export async function syncChangeHistory(store, catalog, providers = { fetchNoticePage, fetchNoticeText }, now = new Date()) {
  if (!store.acquireLease('changeHistory', 10 * 60000)) return;
  const window = changeWindow(now);
  const scanStart = chinaDate(new Date(Date.parse(window.from) - 7 * 86400000));
  const state = { version: CHANGE_HISTORY_VERSION, checkedAt: now.toISOString(), windowStart: window.startDate, scanStart, status: 'running', errors: [], checkedFunds: 0 };
  store.setMeta('changeHistory:state', state);
  const records = new Map((store.getMeta('changeHistory:records') || []).map(r=>[`${r.noticeId || r.id}:${r.code}`,r]));
  const funds = catalog.filter(f=>f.venue !== 'etf'); let index = 0;
  try {
    await Promise.all(Array.from({length:3},async()=>{
      while(index < funds.length) {
        const fund = funds[index++];
        try {
          let complete = false;
          for(let page=1;page<=5;page++) {
            const {notices,total} = await providers.fetchNoticePage(fund.code,page,0);
            for(const notice of notices.filter(n=>n.publishedAt >= scanStart && n.publishedAt <= window.endDate && isQuotaNotice(n.title))) {
              const key = `${notice.id}:${fund.code}`;
              try { const text = await providers.fetchNoticeText(notice,store.directory); records.set(key, historyRecord(notice,fund,text,now)); }
              catch { records.set(key,{...notice,name:`${fund.name} ${fund.share}`,state:'pending_review',reason:'公告正文获取失败'}); state.errors.push(fund.code); }
            }
            if (!notices.length || page*50>=total || notices.at(-1).publishedAt < scanStart) {complete=true;break;}
          }
          if(!complete)state.errors.push(fund.code); else state.checkedFunds++;
        } catch {state.errors.push(fund.code);}
      }
    }));
    store.setMeta('changeHistory:records',[...records.values()]);
    state.status = state.errors.length ? 'partial' : 'success';
    store.setMeta('changeHistory:state',state);
    return state;
  } finally {store.releaseLease('changeHistory');}
}
export function recentChanges(store, now = new Date()) {
  const window = changeWindow(now);
  const inside = value => {const time=Date.parse(value);return time>=Date.parse(window.from)&&time<=+now;};
  const history = (store.getMeta('changeHistory:records') || []).filter(r=>r.state==='verified'&&inside(r.effectiveAt));
  // A confirmed announcement supersedes the same fund's observed transition on the effective day.
  const live = store.eventsBetween(window.from,window.to).filter(e=>!history.some(h=>h.code===e.code && h.channelKeys?.includes(e.channelKey) && chinaDate(new Date(h.effectiveAt))===chinaDate(new Date(e.effectiveAt||e.createdAt)) && (h.afterByChannel?.[e.channelKey] || h.afterQuota).status===e.afterQuota?.status && (h.afterByChannel?.[e.channelKey] || h.afterQuota).limit===e.afterQuota?.limit));
  const changes=[...history,...live].sort((a,b)=>Date.parse(b.effectiveAt||b.createdAt)-Date.parse(a.effectiveAt||a.createdAt)||a.code.localeCompare(b.code));
  const state=store.getMeta('changeHistory:state');
  const pending=(store.getMeta('changeHistory:records')||[]).filter(r=>r.state==='pending_review'&&r.publishedAt>=(state?.scanStart||window.startDate)&&r.publishedAt<=window.endDate);
  return {changes,window,coverage:{...state,complete:state?.status==='success'&&state.windowStart<=window.startDate&&chinaDate(new Date(state.checkedAt))===window.endDate&&pending.length===0,pendingCount:pending.length,priorUnknownCount:history.filter(r=>r.beforeByChannel ? Object.values(r.beforeByChannel).some(q=>q.status==='unknown') : r.beforeQuota.status==='unknown').length,pending}};
}
