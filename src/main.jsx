import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, BellRing, Bookmark, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, HelpCircle, Info, LayoutGrid, Mail, Plus, Radar, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, TrendingUp, X } from 'lucide-react';

import './styles.css';

const cn = (...values) => values.filter(Boolean).join(' ');
const number = (n) => new Intl.NumberFormat('zh-CN').format(n);
const percent = (n) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const indexName = (index) => index === 'nasdaq' ? '纳斯达克100' : '标普500';
const hasQuota = (fund) => fund.agency.status === 'open' || fund.direct.status === 'open';
const storageKey = 'quota-radar-live-v1';
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

function Trend({ points, large = false, dailyChange }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  if (!points || points.length < 2) return <span className="missing">暂无走势</span>;
  const width = large ? 600 : 112, height = large ? 180 : 38;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const coords = points.map((n, i) => [i / (points.length - 1) * width, height - 8 - ((n - min) / span) * (height - 20)]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const up = points.at(-1) >= points[0];
  const color = up ? 'var(--positive)' : 'var(--negative)';
  return <div className={cn('trend', large && 'trend-large')}>
    {large && hover != null && <div className="chart-tooltip">第 {hover + 1} 个交易日 · 相对净值 {points[hover].toFixed(2)}</div>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近${points.length}个净值日复权走势，区间变化${percent((points.at(-1) / points[0] - 1) * 100)}`} onPointerMove={large ? (e) => { const rect = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round((e.clientX - rect.left) / rect.width * (points.length - 1))))); } : undefined} onPointerLeave={() => setHover(null)}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={large ? '.18' : '.1'} /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {large && [30, 80, 130, 175].map(y => <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="#e9eef5" strokeDasharray="4 5" />)}
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={large ? '2.5' : '1.8'} strokeLinejoin="round" strokeLinecap="round" />
      {large && hover != null && <><line x1={coords[hover][0]} x2={coords[hover][0]} y1="0" y2={height} stroke={color} strokeDasharray="3 4" /><circle cx={coords[hover][0]} cy={coords[hover][1]} r="4" fill={color} stroke="white" strokeWidth="2" /></>}
    </svg>
    {!large && <span className={cn('daily-change', dailyChange >= 0 ? 'positive' : 'negative')}><small className="daily-label">日</small>{percent(dailyChange)}</span>}
  </div>;
}

function Quota({ value, compact = false }) {
  if (value.status !== 'open') return <span className={cn('quota-state', value.status === 'paused' && 'paused')}><span className="state-dot" />{value.status === 'paused' ? '暂停申购' : value.status === 'unknown' ? '待核验' : '渠道不可买'}</span>;
  return <span className={cn('quota-value', compact && 'compact')}><span className="currency">¥</span>{number(value.limit)}</span>;
}

function FundIdentity({ fund, onClick, small = false }) {
  return <button className={cn('fund-identity', small && 'small')} onClick={onClick} aria-label={`查看${fund.name}${fund.share}详情`}>
    <span className="fund-avatar" style={{ '--fund-color': fund.color }}>{fund.manager.slice(0, 2)}</span>
    <span className="fund-name-wrap"><span className="fund-name">{fund.name}<span className="share-tag">{fund.share}</span></span><span className="fund-meta"><span>{fund.code}</span><i />{fund.type}{fund.stale && <span className="stale-tag">待更新</span>}</span></span>
  </button>;
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
      <div className="select-wrap"><select id="alert-scope" value={scope} onChange={e => setScope(e.target.value)}><option value="all">全部基金 · 纳指100 & 标普500</option>{funds.map(f => <option key={f.code} value={f.code}>{f.name} {f.share} · {f.code}</option>)}</select><ChevronDown size={16} /></div>
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
  const change = fund.trend.length > 1 ? (fund.trend.at(-1) / fund.trend[0] - 1) * 100 : null;
  return <Dialog title={`${fund.name}${fund.share}详情`} onClose={onClose} wide>
    <div className="detail-kicker">{indexName(fund.index)} <span>人民币份额 · {fund.marketSource || '待更新'}</span></div>
    <FundIdentity fund={fund} small />
    <div className="detail-quotas">{[['agency', '代销额度', '天天基金等代销平台'], ['direct', '直销额度', '基金公司官方渠道']].map(([key, name, desc]) => <div key={key}><span>{name}<small>元 / 日</small></span><Quota value={fund[key]} /><p>{desc}</p></div>)}</div>
    <div className="quota-rule"><Info size={16} /><p>{fund.quotaNote || '按单日、单个基金账户计算；实际额度以基金公司公告和销售渠道为准。'}</p></div>
    <div className="detail-chart-heading"><div><h3>最近的波动</h3><p>近{fund.trend.length}个净值日 · 相对净值，起点为100</p></div><span className={cn('chart-change', change >= 0 ? 'positive' : 'negative')}>{percent(change)}</span></div>
    <Trend points={fund.trend} large />{fund.trendNote && <p className="small-print">{fund.trendNote}</p>}<div className="chart-axis"><span>{fund.trendDates?.[0] || "待更新"}</span><span>{fund.trendDates?.at(-1) || "待更新"}</span></div>
    <div className="detail-returns">{[['y1', '近1年'], ['y3', '近3年'], ['y5', '近5年']].map(([key, text]) => <div key={key}><span>{text}累计涨幅</span><strong className={fund.returns[key] >= 0 && fund.returns[key] != null ? 'positive' : ''}>{percent(fund.returns[key])}</strong></div>)}</div>
    <p className="small-print">收益来源：{fund.performanceSource || fund.marketSource || '待更新'}，截至 {fund.returnsAsOf || '待更新'}；净值来源：{fund.navSource || fund.marketSource || '待更新'}，截至 {fund.navAsOf || '待更新'}。“—”表示年限不足或数据缺失。</p>
    {fund.marketError && <div className="live-status"><Info size={15} />{fund.marketError}</div>}<div className="source-links"><a href={fund.direct.sourceUrl || fund.sourceUrl} target="_blank" rel="noreferrer">查看直销公告依据 ↗</a><span>数据观测：{dateTime(fund.observedAt)}</span><span>公告核查：{dateTime(fund.noticeCheckedAt)}</span>{fund.direct.effectiveAt && <span>直销规则生效：{dateTime(fund.direct.effectiveAt)}</span>}{fund.pendingNoticeCount > 0 && <span>有 {fund.pendingNoticeCount} 份新公告待核验</span>}</div><button className="button primary full" onClick={() => onAlert(fund)}><Bell size={17} />关注这只基金的额度</button>
  </Dialog>;
}

function App() {
  const [funds, setFunds] = useState([]);
  const [quotaChanges, setQuotaChanges] = useState([]);
  const [dataMeta, setDataMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState('overview');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sort, setSort] = useState('direct:desc');
  const [favorites, setFavorites] = useState(Array.isArray(initial.favorites) ? initial.favorites : []);
  const [alerts, setAlerts] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const toastTimer = useRef();
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ favorites })); setStorageError(false); } catch { setStorageError(true); }
  }, [favorites]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try { const [board, subscriptions] = await Promise.all([api('/api/dashboard'), api('/api/subscriptions')]);
        if (cancelled) return; setFunds(board.funds); setQuotaChanges(board.changes); setDataMeta(board.meta); setAlerts(subscriptions.subscriptions); setLoadError('');
      } catch (error) { if (!cancelled) setLoadError(error.message); }
      finally { if (!cancelled) setLoading(false); }
    };
    load(); const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function notify(text) { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4000); }
  function favorite(code) { setFavorites(prev => prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]); }
  function openAlert(fund) { setModal({ type: 'alert', fund, existing: alerts.find(a => a.code === (fund?.code || 'all')) || alerts.find(a => a.code === 'all') }); }
  async function saveAlert(item) {
    const { id, ...payload } = item;
    const saved = await api(id ? `/api/subscriptions/${id}` : '/api/subscriptions', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    setAlerts(prev => [...prev.filter(a => a.id !== saved.id), saved]); setModal(null);
    notify(saved.deliveryStatus === 'awaiting_configuration' ? '订阅已保存到服务器 · 邮件服务待配置' : saved.verified ? '提醒设置已更新' : '订阅已保存，请查收验证邮件');
  }
  async function removeAlert(id) { await api(`/api/subscriptions/${id}`, { method: 'DELETE' }); setAlerts(prev => prev.filter(a => a.id !== id)); setModal(null); notify('已删除这条提醒'); }
  function changePage(next) { setPage(next); setQuery(''); setTab('all'); setOnlyOpen(false); }
  const visible = useMemo(() => {
    const [key, direction] = sort.split(':');
    const getValue = (f) => ['agency', 'direct'].includes(key) ? (f[key].status === 'open' ? f[key].limit : null) : f.returns[key];
    return funds.filter(f => (tab === 'all' || f.index === tab) && (page !== 'favorites' || favorites.includes(f.code)) && (!onlyOpen || hasQuota(f)) && `${f.name}${f.manager}${f.share}${f.code}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (av == null && bv == null) return a.code.localeCompare(b.code);
      if (av == null) return 1; if (bv == null) return -1;
      return (direction === 'desc' ? bv - av : av - bv) || a.code.localeCompare(b.code);
    });
  }, [funds, tab, page, favorites, onlyOpen, sort, query]);
  const available = funds.filter(hasQuota).length;
  const maxDirect = Math.max(0, ...funds.map(f => f.direct.limit || 0));
  function sortHeader(key) { setSort(`${key}:${sort === `${key}:desc` ? 'asc' : 'desc'}`); }
  const nav = [{ id: 'overview', label: '基金总览', Icon: LayoutGrid }, { id: 'favorites', label: '我的关注', Icon: Bookmark, count: favorites.length }, { id: 'changes', label: '额度动态', Icon: TrendingUp, count: quotaChanges.length }, { id: 'alerts', label: '邮箱提醒', Icon: Bell, count: alerts.length }];
  const isBoard = page === 'overview' || page === 'favorites';
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={() => changePage('overview')} aria-label="额度雷达首页"><span className="brand-mark"><Radar size={25} strokeWidth={1.9} /></span><span><strong>额度雷达<span className="brand-dot">.</span></strong><small>QDII RADAR</small></span></button>
      <div className="nav-caption">我的投资工具</div><nav aria-label="主导航">{nav.map(({ id, label, Icon, count }) => <button key={id} className={cn('nav-link', page === id && 'active')} onClick={() => changePage(id)}><Icon size={19} /><span>{label}</span>{count > 0 && <small>{count}</small>}</button>)}</nav>
      <div className="sidebar-tip"><span className="tip-icon"><BellRing size={21} /></span><strong>把等待交给提醒</strong><p>额度恢复或提高时，<br />让消息来找你。</p><button onClick={() => openAlert()}>设置邮箱提醒 <ArrowRight size={14} /></button></div>
      <button className="method-link" onClick={() => setModal({ type: 'info' })}><HelpCircle size={17} /><span>数据与口径说明</span></button><div className="sidebar-footer"><span className="live-dot" />专注国内 QDII 指数基金</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>投资工具</span><ChevronRight size={14} /><strong>{nav.find(n => n.id === page)?.label}</strong></div><button className="mobile-brand" onClick={() => changePage('overview')}><Radar size={23} />额度雷达<span>.</span></button><div className="topbar-right"><span className="demo-badge"><span />{dataMeta.lastRun?.status === 'running' ? '正在同步' : '真实数据 · 日更'}</span><button className="top-help icon-button" aria-label="数据说明" onClick={() => setModal({ type: 'info' })}><HelpCircle size={18} /></button><span className="user-avatar" title="当前浏览器的订阅会话">访</span></div></header>
      <main>
        {(loading || loadError || dataMeta.staleCount > 0 || dataMeta.lastRun?.status === 'partial') && <div className="live-status" role="status"><Info size={15} />{loading ? '正在加载真实数据…' : loadError || (dataMeta.lastRun?.status === 'partial' ? '部分来源更新失败，已保留上次成功数据，请留意更新时间。' : '部分基金数据待更新，以下标注的是最近成功获取的信息。')}</div>}
        <div className="page-heading"><div><div className="eyebrow"><span />NASDAQ 100 & S&P 500</div><h1>{page === 'overview' ? '今日申购额度' : page === 'favorites' ? '我的关注' : page === 'changes' ? '额度动态' : '我的邮箱提醒'}</h1><p>{page === 'overview' ? '代销、直销放在一起，看清额度，再做选择。' : page === 'favorites' ? '把关心的基金放在一起，少翻几次页面。' : page === 'changes' ? '恢复申购、额度调整，按时间查看每一次变化。' : '选择你关心的变化，其余时间安心等待。'}</p></div><button className="button primary heading-cta" onClick={() => openAlert()}><Bell size={17} />设置额度提醒</button></div>
        {page === 'overview' && <section className="summary-grid" aria-label="额度概览"><div className="summary-card availability"><div className="summary-label">当前可申购<span className="summary-icon"><LayoutGrid size={17} /></span></div><div className="summary-number">{available}<small>/ {funds.length} 只</small><span className="status-tag"><span />有额度</span></div><div className="availability-track">{funds.map(f => <span key={f.code} className={hasQuota(f) ? 'available' : ''} />)}</div></div><div className="summary-card direct-summary"><div className="summary-label">最高直销额度<span className="summary-icon"><ArrowUpRight size={18} /></span></div><div className="summary-number"><span className="summary-currency">¥</span>{maxDirect ? number(maxDirect) : '—'}<small>/ 日</small></div><div className="summary-foot">直销额度可能高于代销 <span>分别比较，更清楚</span></div></div><button className="summary-card changes-summary" onClick={() => changePage('changes')}><div className="summary-label">近期额度变化<span className="summary-icon"><TrendingUp size={18} /></span></div><div className="summary-number">{quotaChanges.length}<small>条动态</small><span className="summary-arrow"><ArrowRight size={18} /></span></div><div className="summary-foot"><span className="blue-dot" />恢复与调整，及时了解 <span>查看全部</span></div></button></section>}
        {isBoard && <section className="fund-board" aria-label="基金比较">
          <div className="board-header"><div className="index-tabs" role="tablist" aria-label="指数分类">{[['all', '全部基金'], ['nasdaq', '纳斯达克100'], ['sp500', '标普500']].map(([id, text]) => <button key={id} role="tab" aria-selected={tab === id} className={cn(tab === id && 'selected')} onClick={() => setTab(id)}>{text}{id === 'all' && <span>{page === 'favorites' ? favorites.length : funds.length}</span>}</button>)}</div><span className="board-source"><ShieldCheck size={14} />更新 {dateTime(dataMeta.updatedAt)}</span></div>
          <div className="board-toolbar"><div className="search-field"><Search size={17} /><input aria-label="搜索基金名称或代码" placeholder="搜索基金名称 / 代码" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button>}</div><label className="open-filter"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /><span className="toggle"><span /></span>只看可申购</label><div className="sort-select"><ArrowDownUp size={15} /><select aria-label="排序方式" value={sort} onChange={e => setSort(e.target.value)}><option value="direct:desc">直销额度从高到低</option><option value="direct:asc">直销额度从低到高</option><option value="agency:desc">代销额度从高到低</option><option value="agency:asc">代销额度从低到高</option><option value="y1:desc">近1年涨幅从高到低</option><option value="y1:asc">近1年涨幅从低到高</option><option value="y3:desc">近3年涨幅从高到低</option><option value="y3:asc">近3年涨幅从低到高</option><option value="y5:desc">近5年涨幅从高到低</option><option value="y5:asc">近5年涨幅从低到高</option></select><ChevronDown size={14} /></div></div>
          <div className="table-wrap"><table><colgroup><col className="name-col" /><col className="quota-col" /><col className="quota-col" /><col className="return-col" /><col className="return-col" /><col className="return-col" /><col className="trend-col" /><col className="action-col" /></colgroup><thead><tr><th>基金名称 <span className="table-count">{visible.length}</span></th>{[['agency', '代销额度'], ['direct', '直销额度'], ['y1', '近1年'], ['y3', '近3年'], ['y5', '近5年']].map(([key, title]) => <th key={key} className={cn(['agency', 'direct'].includes(key) && 'quota-cell', sort.startsWith(key + ':') && 'sorted')} aria-sort={sort.startsWith(key + ':') ? (sort.endsWith('desc') ? 'descending' : 'ascending') : 'none'}><button onClick={() => sortHeader(key)}>{title}<ArrowDown size={12} className={sort === `${key}:asc` ? 'asc-arrow' : ''} /></button>{['agency', 'direct'].includes(key) && <small>元 / 日</small>}</th>)}<th className="trend-heading">近期走势<small>近30日 / 最新日涨幅</small></th><th className="action-heading">提醒</th></tr></thead><tbody>{visible.map(f => <tr key={f.code} data-fund-code={f.code}><td><div className="identity-cell"><button className={cn('favorite-button', favorites.includes(f.code) && 'is-favorite')} onClick={() => favorite(f.code)} aria-label={`${favorites.includes(f.code) ? '取消关注' : '关注'}${f.name}${f.share}`} aria-pressed={favorites.includes(f.code)}><Star size={15} /></button><FundIdentity fund={f} onClick={() => setModal({ type: 'fund', fund: f })} /></div></td><td className="quota-cell"><Quota value={f.agency} /></td><td className="quota-cell direct-cell"><Quota value={f.direct} /></td>{['y1', 'y3', 'y5'].map(k => <td key={k} className={cn('return-cell', f.returns[k] == null ? 'missing' : f.returns[k] >= 0 ? 'positive' : 'negative')}>{percent(f.returns[k])}{k === 'y1' && <small className="return-asof">截至 {f.returnsAsOf?.slice(5) || '待更新'}</small>}</td>)}<td><button className="trend-button" onClick={() => setModal({ type: 'fund', fund: f })} aria-label={`查看${f.name}近期波动`}><Trend points={f.trend} dailyChange={f.dailyChange} /></button></td><td><button className={cn('row-bell', alerts.some(a => a.code === f.code || a.code === 'all') && 'subscribed')} onClick={() => openAlert(f)} aria-label={`设置${f.name}${f.share}额度提醒`}><Bell size={17} /></button></td></tr>)}</tbody></table></div>
          <div className="mobile-funds">{visible.map(f => <article key={f.code} className="mobile-fund" data-fund-code={f.code}><div className="mobile-fund-heading"><FundIdentity fund={f} onClick={() => setModal({ type: 'fund', fund: f })} /><button className={cn('favorite-button', favorites.includes(f.code) && 'is-favorite')} onClick={() => favorite(f.code)} aria-label={`${favorites.includes(f.code) ? '取消关注' : '关注'}${f.name}${f.share}`} aria-pressed={favorites.includes(f.code)}><Star size={18} /></button></div><div className="mobile-quotas"><div><span>代销额度 <small>元/日</small></span><Quota value={f.agency} /></div><div><span>直销额度 <small>元/日</small></span><Quota value={f.direct} /></div></div><div className="mobile-return-date">累计涨幅 · 截至 {f.returnsAsOf || '待更新'}</div><div className="mobile-returns">{[['y1', '近1年'], ['y3', '近3年'], ['y5', '近5年']].map(([k, title]) => <div key={k}><span>{title}</span><strong className={f.returns[k] == null ? 'missing' : f.returns[k] >= 0 ? 'positive' : 'negative'}>{percent(f.returns[k])}</strong></div>)}</div><div className="mobile-card-bottom"><button className="mobile-trend" onClick={() => setModal({ type: 'fund', fund: f })} aria-label={`查看${f.name}近期走势`}><span>近30日</span><Trend points={f.trend} dailyChange={f.dailyChange} /></button><button className={cn('mobile-alert', alerts.some(a => a.code === f.code || a.code === 'all') && 'subscribed')} onClick={() => openAlert(f)}><Bell size={14} />{alerts.some(a => (a.code === f.code || a.code === 'all') && a.deliveryStatus === 'active') ? '已启用' : alerts.some(a => a.code === f.code || a.code === 'all') ? '待启用' : '额度提醒'}</button></div></article>)}</div>
          {visible.length === 0 && <div className="empty-state"><Search size={32} /><h3>{page === 'favorites' && !favorites.length ? '关注第一只基金' : '没有找到符合条件的基金'}</h3><p>{page === 'favorites' && !favorites.length ? '点击基金旁的星标，就能在这里集中查看。' : '试试其他关键词，或取消“只看可申购”。'}</p><button className="button secondary" onClick={() => { if (page === 'favorites' && !favorites.length) changePage('overview'); else { setQuery(''); setTab('all'); setOnlyOpen(false); } }}>{page === 'favorites' && !favorites.length ? '去看基金' : '重置筛选'}</button></div>}
          <div className="board-footer"><span>共 {visible.length} 只基金 <i />累计收益，非年化 · 截止日见详情</span><span><span className="legend-dot" />红涨绿跌 <i />“—”为年限不足或数据缺失</span></div>
        </section>}
        {page === 'changes' && <section className="changes-panel"><div className="panel-title"><h2>最近的额度变化</h2><span className="subtle-badge">真实变化记录</span></div>{!quotaChanges.length && <div className="empty-state"><TrendingUp size={30} /><h3>尚未检测到额度变化</h3><p>已建立当前额度基线，后续真实变化会记录在这里。</p></div>}{quotaChanges.map((c, i) => <article className="change-row" key={`${c.code}-${i}`}><div className={cn('change-icon', c.type)}>{c.type === 'pause' ? <Clock3 size={20} /> : <ArrowUpRight size={20} />}</div><div className="change-info"><strong>{c.name}</strong><p>{c.code} <i />{c.channel}</p></div><div className="change-amount"><span>{c.before}</span><ArrowRight size={17} /><strong>{c.after}</strong></div><time>{c.time}</time><button className="row-bell" aria-label={`设置${c.name}额度提醒`} onClick={() => openAlert(funds.find(f => f.code === c.code))}><Bell size={17} /></button></article>)}<div className="changes-note"><Info size={15} />每日 {dataMeta.dailySyncTime || '07:30'} 检查公告；新规则按生效时间更新。首次同步建立基线，不生成虚假变化。</div></section>}
        {page === 'alerts' && <section className="alerts-panel"><div className="panel-title"><h2>已设置 {alerts.length} 条提醒</h2><span className="subtle-badge">{dataMeta.mailConfigured ? '验证邮箱后生效' : '邮件服务待配置'}</span></div>{alerts.length ? alerts.map(a => { const f = funds.find(f => f.code === a.code); return <article className="saved-alert" key={a.id}><span className="saved-alert-icon"><BellRing size={22} /></span><div><h3>{f ? `${f.name} ${f.share}` : '全部基金'}</h3><p><Mail size={14} />{a.email}</p><span className="subscription-status">{{ active: '已验证 · 提醒生效', pending_verification: '等待邮箱验证', awaiting_configuration: '已保存 · 等待邮件服务启用' }[a.deliveryStatus]}</span><div className="alert-tags">{a.channels.map(c => <span key={c}>{c === 'agency' ? '代销' : '直销'}</span>)}{a.events.map(c => <span key={c}>{{ resume: '恢复申购', increase: '额度提高', decrease: '额度降低或暂停' }[c]}</span>)}</div></div><div className="saved-alert-actions"><button className="button secondary" onClick={() => setModal({ type: 'alert', fund: f, existing: a })}>编辑</button>{!a.verified && dataMeta.mailConfigured && <button className="resend-link" onClick={async () => { try { await api(`/api/subscriptions/${a.id}/resend`, { method: 'POST' }); notify('验证邮件已加入发送队列'); } catch (error) { notify(error.message); } }}>重发验证邮件</button>}</div></article>; }) : <div className="empty-state"><span className="empty-bell"><BellRing size={30} /></span><h3>下一次开放额度，让提醒来找你</h3><p>关注代销或直销渠道，选择恢复申购、额度提高等变化。</p><button className="button primary" onClick={() => openAlert()}><Plus size={16} />添加第一条提醒</button></div>}<div className="changes-note"><Info size={15} />{dataMeta.mailConfigured ? '请先验证邮箱。提醒设置保存在服务器，邮件内附退订链接。当前浏览器可管理自己创建的订阅。' : '订阅已接入服务器。邮件服务配置完成并验证邮箱后，才能发送额度提醒。'}</div></section>}
        <div className="data-caption"><Info size={15} /><p><strong>收益与走势：{dataMeta.marketSources?.join(' / ') || '加载中'} · 代销：天天基金 · 直销：基金公司公告</strong> · 收益截至 {dataMeta.returnDates?.length === 1 ? dataMeta.returnDates[0] : '各基金最新净值日（详见详情）'}；直销不确定时标为待核验。<button onClick={() => setModal({ type: 'info' })}>了解数据口径 <ArrowUpRight size={12} /></button></p></div>
        <footer className="page-footer"><span>额度雷达 <i />让额度信息更透明</span><span>纳斯达克100 · 标普500</span></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="手机导航">{nav.map(({ id, label, Icon }) => <button key={id} className={cn(page === id && 'active')} onClick={() => changePage(id)}><Icon size={20} /><span>{label}</span></button>)}</nav>
    {modal?.type === 'alert' && <AlertDialog key={modal.existing?.id || modal.fund?.code || 'all'} fund={modal.fund} existing={modal.existing} funds={funds} mailConfigured={dataMeta.mailConfigured} lastEmail={alerts.at(-1)?.email || ''} onSave={saveAlert} onRemove={removeAlert} onClose={() => setModal(null)} />}
    {modal?.type === 'fund' && <FundDialog fund={modal.fund} onClose={() => setModal(null)} onAlert={openAlert} />}
    {modal?.type === 'info' && <Dialog title="数据与口径说明" onClose={() => setModal(null)}><div className="modal-symbol"><ShieldCheck size={25} /></div><h2>把口径说清楚</h2><p className="dialog-subtitle">额度与收益来自真实接口，直销规则有公告依据；不同数据可能有不同更新时间。</p><div className="method-item"><h3>代销额度与直销额度</h3><p>代销指天天基金等销售平台，直销指基金公司官方渠道。两者单独展示，不能默认相加；跨渠道、跨份额的合并规则需看公告。</p></div><div className="method-item"><h3>近1、3、5年涨幅</h3><p>展示对应区间的累计收益，非年化收益。未成立满对应年限或缺少数据的份额显示“—”，不会用其他份额补齐。不同基金截止日期不一致时，应先核对日期再比较。</p></div><div className="method-item"><h3>最近的波动</h3><p>曲线最多展示30个净值日，以100为起点。聚源使用复权单位净值，天天基金使用每日净值增长率计算；缺失时仅展示连续数据。旁边的百分比为最新净值日的涨跌幅，不是波动率指标。QDII净值可能延迟公布。</p></div><div className="method-item"><h3>邮箱提醒</h3><p>订阅保存在服务器，以当前浏览器的安全会话管理。邮箱验证后才启用；邮件服务未配置时保持等待状态。新公告先解析适用份额、渠道和生效日，歧义规则进入人工核验。</p></div></Dialog>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={15} /></button></div>}
    {storageError && <div className="storage-error" role="alert">浏览器无法保存本机设置，本次更改将在关闭页面后丢失。</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
