import QuotaOverview from './components/QuotaOverview.jsx';
import DataIssues from './components/DataIssues.jsx';
import MobileDisclosure from './components/MobileDisclosure.jsx';
import { usage } from './usage.mjs';
import GroupedFunds from './components/GroupedFunds.jsx';
import {overviewQuotas} from './overview-quotas.mjs';
import {groupFunds, selectFundGroups} from './fund-groups.mjs';
import FundFees, {ChannelScope} from './components/FundFees.jsx';
import { STABILITY_WINDOW_DAYS } from '../shared/config.mjs';
import { createQuotaComparator, createFeeChannelComparator } from './fund-sort.mjs';
import { totalQuota, quotaDelta } from './summary.mjs';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, BellRing, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, HelpCircle, Info, LayoutGrid, Mail, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, TrendingUp, X } from 'lucide-react';
import './styles.css';
import InvestmentRisk from './components/InvestmentRisk.jsx';
import UpdateStatus from './components/UpdateStatus.jsx';
import PublisherFollow from './components/PublisherFollow.jsx';
import { AccountButton, AccountPage } from './components/Account.jsx';
import {createDashboardLoader} from './dashboard-cache.mjs';
const cn = (...values) => values.filter(Boolean).join(' ');
const number = (n) => new Intl.NumberFormat('zh-CN').format(n);
const percent = (n) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const indexName = (index) => index === 'nasdaq' ? '纳斯达克100' : '标普500';
const hasQuota = (fund) => fund.agency.status === 'open' || fund.direct.status === 'open';
const storageKey = 'quota-radar-live-v1';
// Launch with on-site tools only; notifications are reserved for a future paid service.
// This controls presentation, not subscription API authorization or mail delivery.
const NOTIFICATIONS_ENABLED = false;
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试');
  return data;
}
const dateTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '等待首次同步';
const initial = (() => {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
})();
function Trend({ points, large = false, tall = false, dailyChange }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  if (!points || points.length < 2) return <span className="missing">暂无走势</span>;
  const width = large ? 600 : 112, height = large ? (tall ? 320 : 180) : 38;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const coords = points.map((n, i) => [i / (points.length - 1) * width, height - 8 - ((n - min) / span) * (height - 20)]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const up = points.at(-1) >= points[0];
  const color = up ? 'var(--positive)' : 'var(--negative)';
  return <div className={cn('trend', large && 'trend-large')}>
    {large && hover != null && <div className="chart-tooltip">第 {hover + 1} 个净值日 · 相对净值 {points[hover].toFixed(2)}</div>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近${points.length}个净值日复权走势，区间变化${percent((points.at(-1) / points[0] - 1) * 100)}`} onPointerMove={large ? (e) => { const rect = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round((e.clientX - rect.left) / rect.width * (points.length - 1))))); } : undefined} onPointerLeave={() => setHover(null)}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={large ? '.18' : '.1'} /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {large && [.17, .44, .72, .97].map(ratio => height * ratio).map(y => <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="#e9eef5" strokeDasharray="4 5" />)}
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={large ? '2.5' : '1.8'} strokeLinejoin="round" strokeLinecap="round" />
      {large && hover != null && <><line x1={coords[hover][0]} x2={coords[hover][0]} y1="0" y2={height} stroke={color} strokeDasharray="3 4" /><circle cx={coords[hover][0]} cy={coords[hover][1]} r="4" fill={color} stroke="white" strokeWidth="2" /></>}
    </svg>
    {!large && <span className={cn('daily-change', dailyChange >= 0 ? 'positive' : 'negative')}><small className="daily-label">日</small>{percent(dailyChange)}</span>}
  </div>;
}
// Keep confirmation provenance in source data; show only the applicable rule.
const scopeDescription = scope => scope?.basis==='user_confirmed'
  ? scope.mode==='independent'?'各份额额度独立，分别计算。':'各份额共用额度，按共享上限计算。'
  : scope?.evidence || scope?.reason;
function QuotaScope({scope}) {
  if(!scope)return null;
  const shares=scope.members?.map(m=>m.share).join('/') || '';
  const label=scope.mode==='shared'?`${shares}共享`:scope.mode==='independent'?'份额独立':'共享规则待核验';
  return <span className={cn('quota-scope-badge',scope.mode)} title={scopeDescription(scope)} data-scope-mode={scope.mode}>{label}</span>;
}
function Quota({ value, compact = false }) {
  if (value.excludedSmallQuota) return <span className="quota-excluded">已剔除<small>原额度 ¥{number(value.originalLimit)} / 日</small></span>;
  return <span className="quota-display">{value.status !== 'open'
    ? <span className={cn('quota-state', value.status === 'paused' && 'paused')}><span className="state-dot" />{value.status === 'paused' ? '暂停申购' : value.status === 'unknown' ? '待核验' : '渠道不可买'}</span>
    : <span className={cn('quota-value', compact && 'compact')}><span className="currency">¥</span>{number(value.limit)}</span>}
    {value.status === 'open' && value.limit > 0 && <QuotaScope scope={value.scope}/>}
    {value.platforms&&<small className="quota-platforms" title={value.platformNote}>{value.platforms.join(' / ')}{value.availabilityBasis==='user_report'&&<span>用户确认 · 平台择一</span>}</small>}</span>;
}
function ScopeDetails({fund}) {
  const channels=[['agency','代销'],['direct','直销']].filter(([channel])=>fund[channel]?.status==='open');
  if(!channels.length)return null;
  return <details className="scope-evidence"><summary>份额额度规则与公告依据</summary>{channels.map(([channel,label])=>{
    const s=fund[channel]?.scope;
    return <section key={channel}><strong>{label} · {s?.mode==='shared'?'共享额度':s?.mode==='independent'?(s.basis==='default'?'独立额度（默认口径）':'独立额度'):'规则待核验'}</strong><p>{scopeDescription(s) || '暂无核验依据'}</p>{s?.members?.length>0 && <p>涉及份额：{s.members.map(m=>`${m.share}（${m.code}）`).join('、')}</p>}{s?.effectiveFrom && <small>规则起始：{s.effectiveFrom} · 核查至 {s.reviewedThrough}</small>}{s?.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer">查看公告 ↗</a>}</section>;
  })}<p>表中每个份额的历史累计是单独购买该份额的上限，不能直接相加。页面总额按每日有效共享规则去重，公告未明确合并的按份额独立计算；缺失额度不当作零。代销和直销不可简单相加。</p></details>;
}
function FundIdentity({ fund, onClick, small = false, as: Tag = 'button' }) {
  return <Tag className={cn('fund-identity', small && 'small')} onClick={onClick} aria-label={Tag === 'button' ? `查看${fund.name}${fund.share}详情` : undefined}>
    <span className="fund-avatar" style={{ '--fund-color': fund.color }}>{fund.manager.slice(0, 2)}</span>
    <span className="fund-name-wrap"><span className="fund-name">{fund.name}<span className="share-tag" aria-label={fund.share ? `${fund.share}类份额` : undefined} title={fund.share ? `${fund.share}类份额` : undefined}>{fund.share || (fund.venue === 'etf' ? 'ETF' : '人民币')}</span></span><span className="fund-meta"><span>{fund.code}</span><i />{fund.type}{fund.stale && <span className="stale-tag" title={fund.dataIssues?.join('；')}>数据异常</span>}</span></span>
  </Tag>;
}
function MobileFundCard({ fund, favorite, onFavorite, onDetail, onAlert, alerts }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const subscribed = alerts.some(a => a.code === fund.code || a.code === 'all');
  return <article className={cn('mobile-fund', expanded && 'is-expanded')} data-fund-code={fund.code}>
    <button className="mobile-fund-toggle" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? '收起' : '展开'}${fund.name}${fund.share}收益与走势`} onClick={() => setExpanded(value => !value)}>
      <span className="mobile-fund-heading"><FundIdentity fund={fund} as="span" /></span>
      <span className="mobile-quotas"><span><span>代销额度 <small>元/日</small></span><Quota value={fund.agency} /></span><span><span>直销额度 <small>元/日</small></span><Quota value={fund.direct} /></span></span>
      <span className="mobile-fund-disclosure">{expanded ? '收起收益与走势' : '查看收益与走势'}<ChevronDown className="fund-expand-icon" size={16}/></span>
    </button>
    <button className={cn('favorite-button', favorite && 'is-favorite')} onClick={onFavorite} aria-label={`${favorite ? '取消关注' : '关注'}${fund.name}${fund.share}`} aria-pressed={favorite}><Star size={18} /></button>
    <button className="mobile-fund-fees fee-detail-button" onClick={onDetail} aria-label={`查看${fund.name}${fund.share}费率`}><FundFees fund={fund} compact/><ChannelScope fund={fund} compact/></button>
    <div id={detailsId} className="mobile-fund-expanded" hidden={!expanded}>
      {expanded && <>
        <div className="mobile-return-date">累计涨幅 · 截至 {fund.returnsAsOf || '待更新'}</div>
        <div className="mobile-returns">{[['y1','近1年'],['y3','近3年'],['y5','近5年']].map(([key,label]) => <div key={key}><span>{label}</span><strong className={fund.returns[key] == null ? 'missing' : fund.returns[key] >= 0 ? 'positive' : 'negative'}>{percent(fund.returns[key])}</strong></div>)}</div>
        <div className="mobile-chart-heading"><span>近30个净值日走势</span><div><small>最新日涨跌</small><strong className={fund.dailyChange == null ? 'missing' : fund.dailyChange >= 0 ? 'positive' : 'negative'}>{percent(fund.dailyChange)}</strong><small>{fund.navAsOf || '待更新'}</small></div></div>
        <div className="mobile-expanded-chart"><Trend points={fund.trend} large tall /><div className="chart-axis"><span>{fund.trendDates?.[0] || '待更新'}</span><span>{fund.trendDates?.at(-1) || '待更新'}</span></div></div>
        <div className="mobile-history">{[['agency',`过去${STABILITY_WINDOW_DAYS}个交易日代销累计`],['direct',`过去${STABILITY_WINDOW_DAYS}个交易日直销累计`]].map(([channel,label]) => <div key={channel} data-history-channel={channel}><span className="mobile-history-label">{label}</span><StabilityValue value={fund.stability?.[channel]} ready={fund.stability?.calendarReady} compact /></div>)}</div>
        <div className="mobile-card-bottom"><button className="mobile-detail-link" onClick={onDetail}>查看详情与公告 <ArrowUpRight size={14} /></button>{NOTIFICATIONS_ENABLED && <button className={cn('mobile-alert', subscribed && 'subscribed')} onClick={onAlert}><Bell size={14} />{subscribed ? '已设置提醒' : '额度提醒'}</button>}</div>
      </>}
    </div>
  </article>;
}
function FundShareList({visible, favorites, favorite, setModal, alerts, openAlert, sort, sortHeader}) {
  return <>          <div className="table-wrap otc-table-wrap" role="region" aria-label="基金收益与额度比较表，可横向滚动" tabIndex={0}><table className="otc-table"><colgroup><col className="name-col" /><col className="quota-col" /><col className="history-col" /><col className="quota-col" /><col className="history-col" /><col className="return-col" /><col className="return-col" /><col className="return-col" /><col className="fee-col" /><col className="channel-col" /><col className="trend-col" />{NOTIFICATIONS_ENABLED && <col className="action-col" />}</colgroup><thead><tr><th>基金名称 <span className="table-count">{visible.length}</span></th>{[['agency', '代销额度'], ['agencyHistory',`过去${STABILITY_WINDOW_DAYS}个交易日代销累计`], ['direct', '直销额度'], ['directHistory',`过去${STABILITY_WINDOW_DAYS}个交易日直销累计`], ['y1', '近1年'], ['y3', '近3年'], ['y5', '近5年']].map(([key, title]) => <th key={key} className={cn(['agency', 'direct'].includes(key) && 'quota-cell', key.endsWith('History') && 'quota-history-heading', sort.startsWith(key + ':') && 'sorted')} aria-sort={sort.startsWith(key + ':') ? (sort.endsWith('desc') ? 'descending' : 'ascending') : 'none'}><button onClick={() => sortHeader(key)}>{title}<ArrowDown size={12} className={sort === `${key}:asc` ? 'asc-arrow' : ''} /></button>{['agency', 'direct'].includes(key) && <small>元 / 日</small>}{key.endsWith('History') && <small>元 · 覆盖天数优先</small>}</th>)}<th className={cn('fee-heading',sort.startsWith('annualFee:')&&'sorted')} aria-sort={sort.startsWith('annualFee:')?(sort.endsWith('asc')?'ascending':'descending'):'none'}><button onClick={()=>sortHeader('annualFee')}>年度费率<ArrowDown size={12} className={sort==='annualFee:asc'?'asc-arrow':''}/></button><button className="subscription-sort" aria-label="按代销申购费率排序" aria-pressed={sort.startsWith('agencyFee:')} onClick={()=>sortHeader('agencyFee')}>代销申购费<ArrowDown size={11} className={sort==='agencyFee:asc'?'asc-arrow':''}/></button></th><th className="channel-heading">渠道关系<small>可叠加 / 共用 / 待确认</small></th><th className="trend-heading">近期走势<small>近30日 / 最新日涨幅</small></th>{NOTIFICATIONS_ENABLED && <th className="action-heading">提醒</th>}</tr></thead><tbody>{visible.map(f => <tr key={f.code} data-fund-code={f.code}><td><div className="identity-cell"><button className={cn('favorite-button', favorites.includes(f.code) && 'is-favorite')} onClick={() => favorite(f.code)} aria-label={`${favorites.includes(f.code) ? '取消关注' : '关注'}${f.name}${f.share}`} aria-pressed={favorites.includes(f.code)}><Star size={15} /></button><FundIdentity fund={f} onClick={() => setModal({ type: 'fund', fund: f })} /></div></td><td className="quota-cell"><Quota value={f.agency} /></td><td className="quota-history-cell" data-history-channel="agency"><StabilityValue value={f.stability?.agency} ready={f.stability?.calendarReady} compact /></td><td className="quota-cell direct-cell"><Quota value={f.direct} /></td><td className="quota-history-cell" data-history-channel="direct"><StabilityValue value={f.stability?.direct} ready={f.stability?.calendarReady} compact /></td>{['y1', 'y3', 'y5'].map(k => <td key={k} className={cn('return-cell', f.returns[k] == null ? 'missing' : f.returns[k] >= 0 ? 'positive' : 'negative')}>{percent(f.returns[k])}{k === 'y1' && <small className="return-asof">截至 {f.returnsAsOf?.slice(5) || '待更新'}</small>}</td>)}<td className="fee-cell"><button className="fee-detail-button" onClick={()=>setModal({type:'fund',fund:f})} aria-label={`查看${f.name}${f.share}费率`}><FundFees fund={f} compact/></button></td><td className="channel-cell"><button className="fee-detail-button" onClick={()=>setModal({type:'fund',fund:f})} aria-label={`查看${f.name}${f.share}渠道关系`}><ChannelScope fund={f} compact/></button></td><td><button className="trend-button" onClick={() => setModal({ type: 'fund', fund: f })} aria-label={`查看${f.name}近期波动`}><Trend points={f.trend} dailyChange={f.dailyChange} /></button></td>{NOTIFICATIONS_ENABLED && <td><button className={cn('row-bell', alerts.some(a => a.code === f.code || a.code === 'all') && 'subscribed')} onClick={() => openAlert(f)} aria-label={`设置${f.name}${f.share}额度提醒`}><Bell size={17} /></button></td>}</tr>)}</tbody></table></div>
          <div className="mobile-funds">{visible.map(f => <MobileFundCard key={f.code} fund={f} favorite={favorites.includes(f.code)} onFavorite={() => favorite(f.code)} onDetail={() => setModal({ type: 'fund', fund: f })} onAlert={() => openAlert(f)} alerts={alerts} />)}</div>
</>;
}
function Dialog({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current.showModal();
    return () => { document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <dialog className={cn('dialog', wide && 'wide')} ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-inner"><button className="icon-button close-dialog" onClick={onClose} aria-label="关闭弹窗"><X size={20} /></button>{children}</div>
  </dialog>;
}
function AlertDialog({ fund, existing, lastEmail, funds, mailConfigured, onSave, onRemove, onClose }) {
  const [email, setEmail] = useState(existing?.email || lastEmail || '');
  const [scope, setScope] = useState(existing?.code || fund?.code || 'all');
  const [channels, setChannels] = useState(existing?.channels || ['agency', 'direct']);
  const [events, setEvents] = useState(existing?.events || ['resume', 'increase']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const toggle = (setter, values, value) => setter(values.includes(value) ? values.filter(x => x !== value) : [...values, value]);
  async function save(e) {
    e.preventDefault();
    if (!channels.length || !events.length) { setError('请选择至少一个渠道和一种提醒情况。'); return; }
    setError(''); setSaving(true);
    try { await onSave({ id: existing?.id, code: scope, email: email.trim(), channels, events }); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <Dialog title="设置额度提醒" onClose={onClose}>
    <div className="modal-symbol"><BellRing size={25} /></div>
    <h2>{existing ? '编辑额度提醒' : '额度开放，不再错过'}</h2><p className="dialog-subtitle">选择关注的基金和渠道，设置你的邮箱提醒。</p>
    <form onSubmit={save}>
      <label className="field-label" htmlFor="alert-scope">关注范围</label>
      <div className="select-wrap"><select id="alert-scope" value={scope} onChange={e => setScope(e.target.value)}><option value="all">全部场外份额 · 纳指100 & 标普500</option>{funds.map(f => <option key={f.code} value={f.code}>{f.name} {f.share} · {f.code}</option>)}</select><ChevronDown size={16} /></div>
      <label className="field-label" htmlFor="alert-email">接收邮箱</label>
      <div className="email-input"><Mail size={18} /><input id="alert-email" type="email" required maxLength={254} placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></div>
      <fieldset><legend>关注渠道</legend><div className="option-grid">{[['agency', '代销额度', '天天基金等代销平台'], ['direct', '直销额度', '基金公司官方渠道']].map(([id, title, text]) => <label className={cn('option-card', channels.includes(id) && 'selected')} key={id}><input type="checkbox" checked={channels.includes(id)} onChange={() => toggle(setChannels, channels, id)} /><span><strong>{title}</strong><small>{text}</small></span><span className="fake-check">{channels.includes(id) && <Check size={12} />}</span></label>)}</div></fieldset>
      <fieldset><legend>什么时候提醒我</legend><div className="event-options">{[['resume', '恢复申购'], ['increase', '额度提高'], ['decrease', '额度降低或暂停']].map(([id, title]) => <label key={id}><input type="checkbox" checked={events.includes(id)} onChange={() => toggle(setEvents, events, id)} />{title}</label>)}</div></fieldset>
      <div className="demo-note"><Info size={16} /><span>{mailConfigured ? '保存后请确认验证邮件，验证通过后才会接收额度提醒。' : '邮件服务待配置。订阅可先保存，配置完成后再验证邮箱。'}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary full" type="submit" disabled={saving}><Bell size={16} />{saving ? '正在保存…' : existing ? '保存设置' : '保存提醒设置'}</button>
      {existing && <button type="button" className="delete-alert" disabled={saving} onClick={async () => { setSaving(true); try { await onRemove(existing.id); } catch (error) { setError(error.message); } finally { setSaving(false); } }}>删除这条提醒</button>}
    </form>
  </Dialog>;
}
function FundDialog({ fund, onClose, onAlert }) {
  const activeScope=fund.direct?.status==='open'?fund.direct.scope:fund.agency?.status==='open'?fund.agency.scope:null;
  const quotaNote=activeScope?.basis==='user_confirmed'?scopeDescription(activeScope):fund.quotaNote;
  const change = fund.trend.length > 1 ? (fund.trend.at(-1) / fund.trend[0] - 1) * 100 : null;
  return <Dialog title={`${fund.name}${fund.share}详情`} onClose={onClose} wide>
    <div className="detail-kicker">{indexName(fund.index)} <span>{fund.venue === 'etf' ? '场内 ETF · 净值收益' : '人民币份额'} · {fund.marketSource || '待更新'}</span></div>
    <FundIdentity fund={fund} small />
    {fund.venue !== 'etf' && <div className="detail-quotas">{[['agency', '代销额度', '天天基金等代销平台'], ['direct', '直销额度', '基金公司官方渠道']].map(([key, name, desc]) => <div key={key}><span>{name}<small>元 / 日</small></span><Quota value={fund[key]} /><p>{fund[key]?.platforms?.join(' / ') || desc}</p>{fund[key]?.reason&&<p>{fund[key].reason}</p>}{fund[key]?.sourceUrl&&<a href={fund[key].sourceUrl} target="_blank" rel="noreferrer">渠道 / 额度依据 ↗</a>}</div>)}</div>}
    {fund.venue === 'etf' ? <div className="detail-premium"><span>收盘溢价率</span><strong className="premium-high">{percent(fund.quote?.premium)}</strong><p>收盘价 {fund.quote?.price?.toFixed(3) || '—'} 元 · {fund.quote?.date || '待更新'}</p><small>{fund.quote?.source || '恒生聚源 · 待更新'}。收盘折溢价率，非盘中实时估值。</small></div> : <StabilityPanel fund={fund} />}
    {fund.venue !== 'etf' && <><ChannelScope fund={fund}/><FundFees fund={fund}/><ScopeDetails fund={fund}/></>}
    <div className="quota-rule"><Info size={16} /><p>{quotaNote || '按单日、单个基金账户计算；实际额度以基金公司公告和销售渠道为准。'}</p></div>
    <div className="detail-chart-heading"><div><h3>最近的波动</h3><p>近{fund.trend.length}个净值日 · 相对净值，起点为100</p></div><span className={cn('chart-change', change >= 0 ? 'positive' : 'negative')}>{percent(change)}</span></div>
    <Trend points={fund.trend} large />{fund.trendNote && <p className="small-print">{fund.trendNote}</p>}<div className="chart-axis"><span>{fund.trendDates?.[0] || "待更新"}</span><span>{fund.trendDates?.at(-1) || "待更新"}</span></div>
    <div className="detail-returns">{[['y1', '近1年'], ['y3', '近3年'], ['y5', '近5年']].map(([key, text]) => <div key={key}><span>{text}累计涨幅</span><strong className={fund.returns[key] >= 0 && fund.returns[key] != null ? 'positive' : ''}>{percent(fund.returns[key])}</strong></div>)}</div>
    <p className="small-print">收益来源：{fund.performanceSource || fund.marketSource || '待更新'}，截至 {fund.returnsAsOf || '待更新'}；净值来源：{fund.navSource || fund.marketSource || '待更新'}，截至 {fund.navAsOf || '待更新'}。“—”表示年限不足或数据缺失。</p>
    {fund.dataIssues?.length > 0 && <div className="live-status"><Info size={15} />{fund.dataIssues.join('；')}。已保留可用数据及对应日期，正在自动补齐。</div>}<div className="source-links"><a href={fund.direct.sourceUrl || fund.sourceUrl} target="_blank" rel="noreferrer">{fund.venue === 'etf' ? '查看基金申赎公告 ↗' : '查看直销公告依据 ↗'}</a><span>数据观测：{dateTime(fund.observedAt)}</span><span>公告核查：{dateTime(fund.noticeCheckedAt)}</span>{fund.direct.effectiveAt && <span>直销规则生效：{dateTime(fund.direct.effectiveAt)}</span>}{fund.pendingNoticeCount > 0 && <span>有 {fund.pendingNoticeCount} 份新公告待核验</span>}</div>{NOTIFICATIONS_ENABLED && fund.venue !== 'etf' && <button className="button primary full" onClick={() => onAlert(fund)}><Bell size={17} />关注这只基金的额度</button>}
  </Dialog>;
}
function SortHeading({ field, label, sort, onSort, note }) {
  return <th aria-sort={sort === `${field}:asc` ? 'ascending' : sort === `${field}:desc` ? 'descending' : 'none'} className={sort.startsWith(field + ':') ? 'sorted' : ''}><button onClick={() => onSort(field)}>{label}<ArrowDown size={12} className={sort === `${field}:asc` ? 'asc-arrow' : ''} /></button>{note && <small>{note}</small>}</th>;
}
function StabilityValue({ value, ready = true, compact = false }) {
  if (compact) return <div className="stability-value compact-stability"><strong>{value?.knownTotal == null ? '—' : `¥${number(value.knownTotal)}`}</strong><span>近{STABILITY_WINDOW_DAYS}个交易日开放 {value?.openDays || 0} 天</span>{!ready && <small>交易日历待更新</small>}</div>;
  return <div className="stability-value"><strong>{value?.knownTotal == null ? '—' : `¥${number(value.knownTotal)}`}</strong><small>{value?.complete ? '完整累计' : '已知累计'} · 覆盖 {value?.coveredDays || 0}/{STABILITY_WINDOW_DAYS} 日</small><span>近{STABILITY_WINDOW_DAYS}个交易日开放 {value?.openDays || 0} 天</span><small>实测 {value?.observedDays || 0} 日 · 公告推算 {value?.inferredDays || 0} 日</small>{!ready && <small>交易日历待更新</small>}</div>;
}
function StabilityPanel({ fund }) {
  return <div className="stability-panel"><h3>近 {STABILITY_WINDOW_DAYS} 个交易日 · 额度稳定性</h3><p>{fund.stability?.startDate || '待更新'} 至 {fund.stability?.endDate || '待更新'} · 不含今天</p><div className="stability-pair">{[['agency','代销'],['direct','直销']].map(([key,label]) => <div key={key}><span>{label}</span><StabilityValue value={fund.stability?.[key]} ready={fund.stability?.calendarReady} /></div>)}</div><p>实际采集优先，缺失日期按公告生效时间推算，并扣除公告明确的暂停日。未知日期不计为 0；累计上限不代表个人可投入金额，渠道不相加。</p><details className="history-evidence"><summary>查看逐段额度与公告依据</summary>{[['agency','代销'],['direct','直销']].map(([key,label])=><section key={key}><h4>{label}</h4>{(fund.stability?.[key]?.segments || []).map((segment,i)=><div className="history-segment" key={i}><div><strong>{segment.from} — {segment.to}</strong><small>{segment.days} 个交易日 · {segment.origin === 'observation' ? '实际采集' : segment.origin === 'announcement_estimate' ? '公告推算' : '缺少记录'}</small></div><div><b>{segment.limit == null ? '未知' : segment.status === 'open' ? `¥${number(segment.limit)} / 日` : '暂停 / 不可申购'}</b>{segment.sourceUrl && <a href={segment.sourceUrl} target="_blank" rel="noreferrer">查看依据 ↗</a>}{segment.reason && <small>{segment.reason}</small>}</div></div>)}</section>)}</details></div>;
}
function ComparisonIdentity({ fund, favorites, onFavorite, onDetail }) {
  return <div className="identity-cell"><button className={cn('favorite-button', favorites.includes(fund.code) && 'is-favorite')} onClick={() => onFavorite(fund.code)} aria-label={`关注${fund.name}${fund.share}`} aria-pressed={favorites.includes(fund.code)}><Star size={15} /></button><FundIdentity fund={fund} onClick={() => onDetail(fund)} /></div>;
}
function EtfList({ funds, favorites, onFavorite, onDetail, sort, onSort }) {
  return <div className="etf-section">
    <MobileDisclosure title="收盘溢价率说明"><div className="etf-explainer"><Info size={17} /><p><strong>收盘溢价率</strong>按聚源最新已公布交易日展示，可点击表头排序。正值为溢价，负值为折价；不是盘中实时估值。近 1 / 3 / 5 年为基金净值累计涨幅。</p></div></MobileDisclosure>
    <div className="mobile-etf-list">{funds.map(f => <article key={f.code} data-fund-code={f.code} className="mobile-etf-row">
      <button className="mobile-etf-detail" onClick={() => onDetail(f)} aria-label={`查看${f.name}（${f.code}）详情`}><FundIdentity fund={f} as="span"/><span className="mobile-etf-premium"><small>收盘溢价率</small><strong className={f.quote?.premium > 0 ? 'premium-high' : 'negative'}>{percent(f.quote?.premium)}</strong><small>{f.quote?.date || '待更新'}</small></span><ChevronRight size={16}/></button>
      {f.dataIssues?.length > 0 && <p className="fund-issue-text">{f.dataIssues.join('；')}</p>}
      {f.quote?.suspended && <p className="fund-issue-text">停牌</p>}
    </article>)}</div>
    <div className="comparison-scroll" tabIndex={0} role="region" aria-label="场内ETF比较表，可横向滚动"><table className="comparison-table etf-table"><thead><tr><th>基金名称</th><SortHeading field="premium" label="收盘溢价率" note="按最新已公布交易日" sort={sort} onSort={onSort} /><th>收盘价<small>元</small></th><th>场内日涨跌</th>{[['y1','近1年'],['y3','近3年'],['y5','近5年']].map(([field,label]) => <SortHeading key={field} field={field} label={label} sort={sort} onSort={onSort} />)}<th>净值走势<small>近30个净值日</small></th></tr></thead><tbody>{funds.map(f => <tr key={f.code} data-fund-code={f.code}><td><ComparisonIdentity fund={f} {...{favorites,onFavorite,onDetail}} /></td><td className="premium-cell"><strong className={f.quote?.premium > 0 ? 'premium-high' : 'negative'}>{percent(f.quote?.premium)}</strong><small>{f.quote?.date || '待更新'}</small>{f.quote?.suspended && <small>停牌</small>}</td><td>{f.quote?.price?.toFixed(3) || '—'}</td><td className={f.quote?.change >= 0 ? 'positive' : 'negative'}>{percent(f.quote?.change)}</td>{['y1','y3','y5'].map(k => <td key={k} className={f.returns[k] >= 0 ? 'positive' : 'negative'}>{percent(f.returns[k])}{k === 'y1' && <small>截至 {f.returnsAsOf || '待更新'}</small>}</td>)}<td><button onClick={() => onDetail(f)} aria-label={`查看${f.name}净值走势`}><Trend points={f.trend} dailyChange={f.dailyChange} /></button></td></tr>)}</tbody></table></div><p className="scroll-hint">左右滑动查看完整数据 · 点击名称查看详情</p>
  </div>;
}
function App() {
  const [funds, setFunds] = useState([]);
  const [quotaChanges, setQuotaChanges] = useState([]);
  const [dataMeta, setDataMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(() => { const requested = new URLSearchParams(window.location.search).get('page'); return ['changes'].includes(requested) ? requested : 'overview'; });
  const [tab, setTab] = useState('all');
  const [venue, setVenue] = useState('otc');
  const [query, setQuery] = useState('');
  const [channels, setChannels] = useState([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [excludeSmall, setExcludeSmall] = useState(true);
  const overviewFunds = useMemo(() => overviewQuotas(funds, excludeSmall), [funds, excludeSmall]);
  const [sort, setSort] = useState('combined:desc');
  const [favorites, setFavorites] = useState(Array.isArray(initial.favorites) ? initial.favorites : []);
  const [alerts, setAlerts] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const toastTimer = useRef();
  useEffect(() => {
    // Remove retired local purchase inputs/results; never restore or migrate a plan.
    try { localStorage.removeItem('qdii-radar:purchase-calculator:v1'); } catch {}
    const url = new URL(window.location.href);
    if (url.searchParams.get('page') === 'calculator' || url.pathname === '/calculator') {
      url.searchParams.delete('page'); url.pathname = '/';
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  useEffect(() => { usage.init(); usage.pageView(page); }, [page]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ favorites })); setStorageError(false); } catch { setStorageError(true); }
  }, [favorites]);
  useEffect(() => {
    let cancelled = false, timer, pending = false;
    const loadDashboard = createDashboardLoader({fetchBoard:()=>api('/api/dashboard'),storage:()=>window.localStorage});
    const load = async () => {
      if (cancelled || pending) return;
      pending = true; clearTimeout(timer);
      let failed = false, expiresAt;
      try { const [cached, subscriptions] = await Promise.all([loadDashboard(), NOTIFICATIONS_ENABLED ? api('/api/subscriptions') : Promise.resolve({ subscriptions: [] })]);
        if (cancelled) return;
        const board=cached.board; expiresAt=cached.expiresAt;
        setFunds(board.funds); setQuotaChanges(board.changes); setDataMeta(board.meta); setAlerts(subscriptions.subscriptions); setLoadError('');
      } catch (error) { failed = true; if (!cancelled) setLoadError(error.message); }
      finally { pending = false; if (!cancelled) { setLoading(false); timer = setTimeout(load, failed ? 15000 : Math.max(1, expiresAt-Date.now())); } }
    };
    const resume = () => { if (!document.hidden) load(); };
    load();
    // Recheck absolute expiry after background timer throttling or device sleep.
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('focus',resume);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange',resume); window.removeEventListener('focus',resume); };
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function notify(text) { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4000); }
  function favorite(code) { setFavorites(prev => prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]); }
  function openAlert(fund) { if (!NOTIFICATIONS_ENABLED) return; setModal({ type: 'alert', fund, existing: alerts.find(a => a.code === (fund?.code || 'all')) || alerts.find(a => a.code === 'all') }); }
  async function saveAlert(item) {
    const { id, ...payload } = item;
    const saved = await api(id ? `/api/subscriptions/${id}` : '/api/subscriptions', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    setAlerts(prev => [...prev.filter(a => a.id !== saved.id), saved]); setModal(null);
    notify(saved.deliveryStatus === 'awaiting_configuration' ? '订阅已保存到服务器 · 邮件服务待配置' : saved.verified ? '提醒设置已更新' : '订阅已保存，请查收验证邮件');
  }
  async function removeAlert(id) { await api(`/api/subscriptions/${id}`, { method: 'DELETE' }); setAlerts(prev => prev.filter(a => a.id !== id)); setModal(null); notify('已删除这条提醒'); }
  function changePage(next) { setPage(next); setQuery(''); setTab('all'); setOnlyOpen(true); setChannels([]); if (new URLSearchParams(window.location.search).has('page')) window.history.replaceState(null, '', next === 'overview' ? '/' : `/?page=${next}`); }
  const visible = useMemo(() => {
    const [key, direction] = sort.split(':');
    const tieBreak = (a, b) => a.code.localeCompare(b.code);
    const getValue = (f) => ['agency', 'direct'].includes(key) ? (f[key].status === 'open' ? f[key].limit : null) : key === 'premium' ? f.quote?.premium : key.endsWith('History') ? (f.stability?.calendarReady ? f.stability?.[key.slice(0,-7)]?.knownTotal : null) : f.returns[key];
    const filtered = funds.filter(f => (f.venue === 'etf' ? 'etf' : 'otc') === venue && (tab === 'all' || f.index === tab) && (venue === 'etf' || !onlyOpen || hasQuota(f)) && `${f.name}${f.manager}${f.share}${f.code}`.toLowerCase().includes(query.trim().toLowerCase()));
    if (['agency', 'direct'].includes(key)) return filtered.sort(createQuotaComparator(filtered, key, direction));
    if (['annualFee','agencyFee','channelScope'].includes(key)) return filtered.sort(createFeeChannelComparator(key,direction));
    return filtered.sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (key.endsWith('History') && av != null && bv != null) { const channel = key.slice(0,-7); const coverage = b.stability[channel].coveredDays - a.stability[channel].coveredDays; if (coverage) return coverage; }
      if (av == null && bv == null) return tieBreak(a, b);
      if (av == null) return 1; if (bv == null) return -1;
      return (direction === 'desc' ? bv - av : av - bv) || tieBreak(a, b);
    });
  }, [funds, venue, tab, page, favorites, onlyOpen, sort, query]);
  const groups = useMemo(() => groupFunds(overviewFunds), [overviewFunds]);
  const visibleGroups = useMemo(() => selectFundGroups(groups, {query, tab, onlyOpen, sort, channels}), [groups, query, tab, onlyOpen, sort, channels]);
  const otcFunds = overviewFunds.filter(f => f.venue !== 'etf');
  const venueFunds = overviewFunds.filter(f => (f.venue === 'etf' ? 'etf' : 'otc') === venue);
  const indexCounts = Object.fromEntries(['all', 'nasdaq', 'sp500'].map(index => {
    const members = venueFunds.filter(f => index === 'all' || f.index === index);
    return [index, { total: members.length, open: venue === 'otc' ? totalQuota(members, 'both').open : null }];
  }));
  const showOpenCounts = venue === 'otc' && onlyOpen;
  function sortHeader(key) { const first=['annualFee','agencyFee'].includes(key)?'asc':'desc';setSort(`${key}:${sort.startsWith(key+':')?(sort.endsWith('desc')?'asc':'desc'):first}`); }
  const nav = [{ id: 'overview', label: '基金总览', Icon: LayoutGrid }, { id: 'changes', label: '额度动态', Icon: TrendingUp, count: quotaChanges.length }, ...(NOTIFICATIONS_ENABLED ? [{ id: 'alerts', label: '邮箱提醒', Icon: Bell, count: alerts.length }] : [])];
  const isBoard = page === 'overview';
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={() => changePage('overview')} aria-label="QDII 额度雷达首页"><span className="brand-mark"><img src="/qdii-radar-logo.svg" alt="" width="39" height="39" /></span><span><strong>QDII 额度雷达</strong><small>QDII RADAR</small></span></button>
      <div className="nav-caption">我的投资工具</div><nav aria-label="主导航">{nav.map(({ id, label, Icon, count }) => <button key={id} className={cn('nav-link', page === id && 'active')} onClick={() => { usage.tabClick('navigation', id, page); changePage(id); }}><Icon size={19} /><span>{label}</span>{count > 0 && <small>{count}</small>}</button>)}</nav>
      {NOTIFICATIONS_ENABLED && <div className="sidebar-tip"><span className="tip-icon"><BellRing size={21} /></span><strong>把等待交给提醒</strong><p>额度恢复或提高时，<br />让消息来找你。</p><button onClick={() => openAlert()}>设置邮箱提醒 <ArrowRight size={14} /></button></div>}
      <div className="sidebar-footer"><span className="live-dot" />专注国内 QDII 指数基金</div>
    </aside>
    <div className="workspace">
      <div className="workspace-header">
      <header className="topbar"><div className="breadcrumb"><span>投资工具</span><ChevronRight size={14} /><strong>{nav.find(n => n.id === page)?.label}</strong></div><button className="mobile-brand" onClick={() => changePage('overview')}><img src="/qdii-radar-logo.svg" alt="" width="30" height="30" />QDII 额度雷达</button><div className="topbar-right"><PublisherFollow /><UpdateStatus meta={dataMeta} formatTime={dateTime} /><button className="top-help icon-button" aria-label="数据说明" onClick={() => setModal({ type: 'info' })}><HelpCircle size={18} /></button><AccountButton page={page} /></div></header>
      </div>
      <main>
        {(loading || loadError) && <div className="live-status" role="status"><Info size={15} />{loading ? '正在加载真实数据…' : loadError}</div>}
        {!loading && <DataIssues funds={funds} syncing={dataMeta.lastRun?.status === 'running'} onDetail={fund => setModal({type: 'fund', fund})}/>}
        <div className="page-heading"><div><div className="eyebrow"><span />NASDAQ 100 & S&P 500</div><h1>{page === 'overview' ? '今日申购额度' : page === 'changes' ? '额度动态' : '我的邮箱提醒'}</h1>{page !== 'overview' && <p>{page === 'changes' ? '查看近30天恢复申购、额度调整等变化，按生效时间倒序排列。' : '选择你关心的变化，其余时间安心等待。'}</p>}</div><div className="heading-actions">{page === 'overview' && venue === 'otc' && <button type="button" role="switch" aria-checked={excludeSmall} aria-label="剔除10元及以下额度" className="overview-quota-switch quota-toggle-row" onClick={() => setExcludeSmall(value => !value)}><span>剔除 ≤10 元额度</span><span className="quota-toggle-track" aria-hidden="true"><span/></span></button>}{page === 'overview' && <button className="quota-changes-notice" onClick={() => changePage('changes')} title={dataMeta.changesCoverage?.complete ? '查看近30天额度变化明细' : '查看近30天已核验的额度变化；部分历史仍在核验中'}><span className="changes-notice-period">近30天</span><span className="changes-notice-text">{quotaChanges.length || dataMeta.changesCoverage?.complete ? <><strong>{quotaChanges.length}</strong> 条额度动态</> : '历史待核验'}</span><ArrowRight size={15} aria-hidden="true" /></button>}{NOTIFICATIONS_ENABLED && <button className="button primary heading-cta" onClick={() => openAlert()}><Bell size={17} />设置额度提醒</button>}</div></div>
        {page === 'overview' && venue === 'otc' && <QuotaOverview funds={otcFunds} excludeSmall={excludeSmall} />}
        {isBoard && <div className="venue-tabs" role="group" aria-label="交易方式">{[['otc', '场外申购', otcFunds.length], ['etf', '场内 ETF', funds.length - otcFunds.length]].map(([id, title, count]) => <button key={id} className={cn(venue === id && 'selected')} aria-pressed={venue === id} onClick={() => { usage.tabClick('venue', id, page); setVenue(id); setOnlyOpen(id === 'otc'); setSort(id === 'etf' ? 'premium:asc' : 'combined:desc'); }}>{title}<span>{count}</span></button>)}</div>}
        {isBoard && <section className="fund-board" aria-label="基金比较">
          <div className="board-header"><div className="index-tabs" role="tablist" aria-label="指数分类">{[['all', '全部基金'], ['nasdaq', '纳斯达克100'], ['sp500', '标普500']].map(([id, text]) => <button key={id} role="tab" aria-selected={tab === id} className={cn(tab === id && 'selected')} onClick={() => { usage.tabClick('index', id, page); setTab(id); }}>{text}<span data-index-count={id} title={showOpenCounts ? `可申购 ${indexCounts[id].open} 只 / 全部 ${indexCounts[id].total} 只（按基金份额统计）` : `全部 ${indexCounts[id].total} 只`}>{showOpenCounts ? `${indexCounts[id].open}/${indexCounts[id].total}` : indexCounts[id].total}</span></button>)}</div></div>
          <div className="board-toolbar"><div className="search-field"><Search size={17} /><input aria-label="搜索基金名称或代码" placeholder="搜索基金名称 / 代码" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button>}</div>{venue === 'otc' && <label className="open-filter"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /><span className="toggle"><span /></span>只看可申购</label>}<div className="sort-select"><ArrowDownUp size={15} /><select aria-label="排序方式" value={sort} onChange={e => setSort(e.target.value)}>{venue === 'otc' && <><option value="combined:desc">合计可买额度从高到低</option><option value="combined:asc">合计可买额度从低到高</option><option value="direct:desc">直销额度从高到低</option><option value="direct:asc">直销额度从低到高</option><option value="agency:desc">代销额度从高到低</option><option value="agency:asc">代销额度从低到高</option><option value="annualFee:asc">年度费率从低到高</option><option value="annualFee:desc">年度费率从高到低</option><option value="agencyFee:asc">代销申购费率从低到高</option><option value="agencyFee:desc">代销申购费率从高到低</option></>}{venue === 'etf' && <><option value="premium:asc">溢价率从低到高</option><option value="premium:desc">溢价率从高到低</option></>}{venue === 'otc' && <><option value="agencyHistory:desc">过去{STABILITY_WINDOW_DAYS}个交易日代销累计（覆盖优先）</option><option value="directHistory:desc">过去{STABILITY_WINDOW_DAYS}个交易日直销累计（覆盖优先）</option></>}<option value="y1:desc">近1年涨幅从高到低</option><option value="y1:asc">近1年涨幅从低到高</option><option value="y3:desc">近3年涨幅从高到低</option><option value="y3:asc">近3年涨幅从低到高</option><option value="y5:desc">近5年涨幅从高到低</option><option value="y5:asc">近5年涨幅从低到高</option></select><ChevronDown size={14} /></div></div>
          {venue === 'otc' && <MobileDisclosure title="排序与额度口径" className="board-method"><p className="quota-sort-note">{['annualFee','agencyFee'].includes(sort.split(':')[0]) ? '按组内最低已知费率排序；缺失或待更新的排在最后。代销申购费按标注平台小额档位。' : sort.startsWith('y') ? '按组内最高已知涨幅排序，不代表整组收益；展开可比较各份额和截止日期。' : sort.split(':')[0].endsWith('History') ? '历史累计按当日规则去重，完整份额占比优先，再按金额排序。' : '按整组去重后的额度排序；展开可比较各份额。'}搜索与“只看可申购”均保留整组份额。渠道共用与份额共用分别标明；关系未确认时，双渠道按较大额度保守计入。</p></MobileDisclosure>}
          {venue === 'etf' ? <EtfList funds={visible} favorites={favorites} onFavorite={favorite} onDetail={fund => setModal({ type: 'fund', fund })} sort={sort} onSort={sortHeader} /> : <>
          <GroupedFunds groups={visibleGroups} sort={sort} onSort={sortHeader} query={query} channels={channels} onChannelsChange={setChannels} renderShares={members => <FundShareList visible={members} favorites={favorites} favorite={favorite} setModal={setModal} alerts={alerts} openAlert={openAlert} sort={sort} sortHeader={sortHeader} />} />
          </>}
          {(venue === 'otc' ? visibleGroups.length : visible.length) === 0 && <div className="empty-state"><Search size={32} /><h3>没有找到符合条件的基金</h3><p>试试其他关键词，或清除渠道和可申购筛选。</p><button className="button secondary" onClick={() => { setQuery(''); setTab('all'); setOnlyOpen(true); setChannels([]); }}>重置筛选</button></div>}
          <div className="board-footer"><span>共 {venue === 'etf' ? `${visible.length} 只 ETF` : `${visibleGroups.length} 组基金 / ${visibleGroups.reduce((n,g)=>n+g.members.length,0)} 个份额`} <i />净值累计收益，非年化 · 截止日见详情</span><span><span className="legend-dot" />红涨绿跌 <i />“—”为年限不足或数据缺失</span></div>
        </section>}
        {page === 'changes' && <section className="changes-panel"><div className="panel-title"><h2>近30天额度变化</h2><span className="subtle-badge">{dataMeta.changesWindow?.startDate} — {dataMeta.changesWindow?.endDate}</span></div>{!quotaChanges.length && <div className="empty-state"><TrendingUp size={30} /><h3>{dataMeta.changesCoverage?.complete ? "近30天暂无已核验的额度动态" : "历史公告正在核验"}</h3><p>按生效时间统计，包含今天；未核验完整时不显示为零变化。</p></div>}{dataMeta.changesCoverage?.pending?.length > 0 && <div className="history-pending"><h3>待核验公告（{dataMeta.changesCoverage.pending.length} 条份额记录）</h3>{dataMeta.changesCoverage.pending.map(n => <p key={`${n.id}-${n.code}`}><a href={n.sourceUrl} target="_blank" rel="noreferrer">{n.name} · {n.title} ↗</a><small>{n.reason}</small></p>)}</div>}{quotaChanges.map((c, i) => <article className="change-row" key={`${c.code}-${i}`}><div className={cn('change-icon', c.type)}>{c.type === 'pause' ? <Clock3 size={20} /> : <ArrowUpRight size={20} />}</div><div className="change-info"><strong>{c.name}</strong><p>{c.code} <i />{c.channel}{c.sourceUrl && <a className="change-source" href={c.sourceUrl} target="_blank" rel="noreferrer">公告依据 ↗</a>}{[...new Map((c.beforeSources || []).map(s => [s.noticeId,s])).values()].map((s,i) => <a key={s.noticeId} className="change-source" href={s.sourceUrl} target="_blank" rel="noreferrer">原额度依据{c.beforeSources.length > 1 ? i+1 : ''} ↗</a>)}</p></div><div className="change-amount"><span>{c.before}</span><ArrowRight size={17} /><strong>{c.after}</strong>{quotaDelta(c) != null && <small className={cn("change-delta", quotaDelta(c) >= 0 ? "increase" : "decrease")}>{quotaDelta(c) > 0 ? "+" : quotaDelta(c) < 0 ? "−" : ""}¥{number(Math.abs(quotaDelta(c)))} / 日</small>}</div><time dateTime={c.effectiveAt || c.createdAt}>生效 {dateTime(c.effectiveAt || c.createdAt)}</time>{NOTIFICATIONS_ENABLED && <button className="row-bell" aria-label={`设置${c.name}额度提醒`} onClick={() => openAlert(funds.find(f => f.code === c.code))}><Bell size={17} /></button>}</article>)}<div className="changes-note"><Info size={15} />每日 {dataMeta.dailySyncTime || '07:30'}、16:30 检查公告。展示北京时间含今天的30个自然日，按生效时间倒序排列；同一公告涉及多个份额时分别计数。原额度缺少证据时标为未核验。</div></section>}
        {NOTIFICATIONS_ENABLED && page === 'alerts' && <section className="alerts-panel"><div className="panel-title"><h2>已设置 {alerts.length} 条提醒</h2><span className="subtle-badge">{dataMeta.mailConfigured ? '验证邮箱后生效' : '邮件服务待配置'}</span></div>{alerts.length ? alerts.map(a => { const f = funds.find(f => f.code === a.code); return <article className="saved-alert" key={a.id}><span className="saved-alert-icon"><BellRing size={22} /></span><div><h3>{f ? `${f.name} ${f.share}` : '全部基金'}</h3><p><Mail size={14} />{a.email}</p><span className="subscription-status">{{ active: '已验证 · 提醒生效', pending_verification: '等待邮箱验证', awaiting_configuration: '已保存 · 等待邮件服务启用' }[a.deliveryStatus]}</span><div className="alert-tags">{a.channels.map(c => <span key={c}>{c === 'agency' ? '代销' : '直销'}</span>)}{a.events.map(c => <span key={c}>{{ resume: '恢复申购', increase: '额度提高', decrease: '额度降低或暂停' }[c]}</span>)}</div></div><div className="saved-alert-actions"><button className="button secondary" onClick={() => setModal({ type: 'alert', fund: f, existing: a })}>编辑</button>{!a.verified && dataMeta.mailConfigured && <button className="resend-link" onClick={async () => { try { await api(`/api/subscriptions/${a.id}/resend`, { method: 'POST' }); notify('验证邮件已加入发送队列'); } catch (error) { notify(error.message); } }}>重发验证邮件</button>}</div></article>; }) : <div className="empty-state"><span className="empty-bell"><BellRing size={30} /></span><h3>下一次开放额度，让提醒来找你</h3><p>关注代销或直销渠道，选择恢复申购、额度提高等变化。</p><button className="button primary" onClick={() => openAlert()}><Plus size={16} />添加第一条提醒</button></div>}<div className="changes-note"><Info size={15} />{dataMeta.mailConfigured ? '请先验证邮箱。提醒设置保存在服务器，邮件内附退订链接。当前浏览器可管理自己创建的订阅。' : '订阅已接入服务器。邮件服务配置完成并验证邮箱后，才能发送额度提醒。'}</div></section>}
        <MobileDisclosure title="数据来源与更新说明" className="page-data-details"><div className="catalog-caption">名单每日自动检查 · 场外 {otcFunds.length} 个份额 / 场内 {funds.length - otcFunds.length} 只 ETF · 最近检查 {dateTime(dataMeta.catalog?.checkedAt)}{dataMeta.catalog?.status && dataMeta.catalog.status !== 'success' && ' · 部分档案待核验，保留已有名单'}</div>
        <div className="data-caption"><Info size={15} /><p><strong>收益与走势：{dataMeta.marketSources?.join(' / ') || '加载中'} · 代销：天天基金接口及标注平台 · 直销：基金公司公告</strong> · 收益截至 {dataMeta.returnDates?.length === 1 ? dataMeta.returnDates[0] : '各基金最新净值日（详见详情）'}；直销不确定时标为待核验。<button onClick={() => setModal({ type: 'info' })}>了解数据口径 <ArrowUpRight size={12} /></button></p></div></MobileDisclosure>
        <footer className="page-footer"><div className="mobile-publisher"><PublisherFollow/></div><span>QDII 额度雷达 <i />让额度信息更透明</span><span>纳斯达克100 · 标普500</span><InvestmentRisk /></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="手机导航">{nav.map(({ id, label, Icon }) => <button key={id} className={cn(page === id && 'active')} onClick={() => { usage.tabClick('navigation', id, page); changePage(id); }}><Icon size={20} /><span>{label}</span></button>)}</nav>
    {NOTIFICATIONS_ENABLED && modal?.type === 'alert' && <AlertDialog key={modal.existing?.id || modal.fund?.code || 'all'} fund={modal.fund} existing={modal.existing} funds={otcFunds} mailConfigured={dataMeta.mailConfigured} lastEmail={alerts.at(-1)?.email || ''} onSave={saveAlert} onRemove={removeAlert} onClose={() => setModal(null)} />}
    {modal?.type === 'fund' && <FundDialog fund={funds.find(f => f.code === modal.fund.code) || modal.fund} onClose={() => setModal(null)} onAlert={openAlert} />}
    {modal?.type === 'info' && <Dialog title="数据与口径说明" onClose={() => setModal(null)}><div className="modal-symbol"><ShieldCheck size={25} /></div><h2>把口径说清楚</h2><p className="dialog-subtitle">额度与收益来自真实接口，直销规则有公告依据；不同数据可能有不同更新时间。</p><div className="method-item"><h3>代销额度与直销额度</h3><p>代销包括天天基金、腾讯理财通、京东金融等销售平台，具体平台与用户确认信息在额度旁标注；直销指基金公司官方渠道。基金公告的金额上限不代表所有平台均已上架。两者单独展示，不能默认相加；跨渠道、跨份额的合并规则需看公告。</p></div><div className="method-item"><h3>近1、3、5年涨幅</h3><p>展示对应区间的累计收益，非年化收益。未成立满对应年限或缺少数据的份额显示“—”，不会用其他份额补齐。不同基金截止日期不一致时，应先核对日期再比较。</p></div><div className="method-item"><h3>最近的波动</h3><p>曲线最多展示30个净值日，以100为起点。聚源使用复权单位净值，天天基金使用每日净值增长率计算；缺失时仅展示连续数据。旁边的百分比为最新净值日的涨跌幅，不是波动率指标。QDII净值可能延迟公布。</p></div><div className="method-item"><h3>{STABILITY_WINDOW_DAYS} 个交易日累计额度</h3><p>总额按交易日及渠道逐日核对有效规则，共享组仅计一次，公告未明确合并的默认按份额独立相加；新公告尚未核验或规则冲突时暂不计入。表格单份额历史上限保留，不能直接相加。取境内交易所最近 {STABILITY_WINDOW_DAYS} 个已完成交易日，不含今天；代销、直销分别累计每日申购上限，实测优先，缺失日期用已核验公告推算。暂停和渠道不可买计 0，未知或未采集日期不计 0。覆盖不足时仅显示已知累计；排序优先覆盖天数，再比较金额。开放天数反映额度可用性，不代表净值或收益稳定性。</p></div><div className="method-item"><h3>场内 ETF 溢价率</h3><p>使用恒生聚源已公布的日行情折溢价率，标明交易日。正值为溢价，负值为折价；不以盘中价格除以滞后净值伪装为实时估值。场内买卖不适用场外渠道申购金额上限。</p></div>{NOTIFICATIONS_ENABLED && <div className="method-item"><h3>邮箱提醒</h3><p>订阅保存在服务器，以当前浏览器的安全会话管理。邮箱验证后才启用；邮件服务未配置时保持等待状态。新公告先解析适用份额、渠道和生效日，歧义规则进入人工核验。</p></div>}</Dialog>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={15} /></button></div>}
    {storageError && <div className="storage-error" role="alert">浏览器无法保存本机设置，本次更改将在关闭页面后丢失。</div>}
  </div>;
}
createRoot(document.getElementById('root')).render(['/login', '/register', '/reset-password', '/activate'].includes(window.location.pathname) ? <AccountPage /> : <App />);
