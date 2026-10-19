import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink, LogOut, Radar, ShieldCheck, UserRound } from 'lucide-react';
import { authReturnTo } from '../../shared/account.mjs';
import './Account.css';

function useAccount() {
  const [state, setState] = useState({ loading: true, user: null });
  useEffect(() => {
    let active = true, timer;
    async function refresh() {
      try {
        const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('无法读取账号状态，请重试。');
        const data = await response.json();
        if (!active) return;
        setState({ ...data, loading: false });
        clearTimeout(timer);
        if (data.expiresAt) timer = setTimeout(refresh, Math.max(1000, new Date(data.expiresAt) - Date.now() + 100));
      } catch {
        if (active) setState({ loading: false, user: null, error: '无法读取账号状态，请重试。' });
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return state;
}

function LogoutForm({ account, global = false }) {
  return <form method="post" action="/api/auth/logout">
    <input type="hidden" name="csrf" value={account.csrfToken} />
    <input type="hidden" name="mode" value={global ? 'global' : 'local'} />
    <button type="submit"><LogOut size={15} />{global ? '退出统一登录' : '退出额度雷达'}</button>
  </form>;
}

export function AccountButton({ page }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const root = useRef(), trigger = useRef();
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (account.loading) return <span className="account-loading" aria-label="正在读取账号状态"><UserRound size={17} /></span>;
  if (!account.user) return <a className="account-login" href={`/login?returnTo=${encodeURIComponent(authReturnTo(page === 'overview' ? '/' : `/?page=${page}`))}`}><UserRound size={16} /><span>登录 / 注册</span></a>;
  return <div className="account-control" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="account-trigger" aria-label={account.user.name} aria-expanded={open} aria-controls="account-panel" onClick={() => setOpen(value => !value)}>
      <span className="account-avatar">{Array.from(account.user.name)[0]}</span><span className="account-name">{account.user.name}</span><ChevronDown size={13} />
    </button>
    {open && <section id="account-panel" className="account-panel" aria-label="我的账号">
      <strong>{account.user.name}</strong><p>{account.user.email}</p><span className="account-provider">TomcatTravel 账号</span>
      <a href={account.accountUrl} target="_blank" rel="noreferrer"><UserRound size={15} />管理账号与密码<ExternalLink size={12} /></a>
      <LogoutForm account={account} /><LogoutForm account={account} global />
      <small>收藏与计算方案保存在此浏览器。退出统一登录后，其他产品已建立的会话可能仍然有效。</small>
    </section>}
  </div>;
}

const errors = {
  unavailable: '账号服务暂时不可用，请稍后重试。你可以继续使用看板和计算器。',
  expired: '登录请求已过期或已使用，请重新发起登录。',
  failed: '未能完成登录，请重新尝试。',
  unverified: '请先在账号中心完成邮箱验证，再重新登录。',
  logout: '暂时无法退出统一登录。你可以先退出额度雷达，再稍后重试。',
};

export function AccountPage() {
  const register = window.location.pathname === '/register';
  const params = new URLSearchParams(window.location.search);
  const returnTo = authReturnTo(params.get('returnTo'));
  const account = useAccount();
  const [leaving, setLeaving] = useState(false);
  const error = errors[params.get('error')];
  useEffect(() => {
    document.title = `${register ? '注册' : '登录'} · QDII 额度雷达`;
    const restore = () => setLeaving(false);
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, [register]);
  return <div className="account-page">
    <header className="account-page-header"><a className="account-brand" href="/"><span className="brand-mark"><Radar size={24} /></span><strong>QDII 额度雷达</strong></a><a className="account-back" href={returnTo}><ArrowLeft size={15} />返回看板</a></header>
    <main className="account-main">
      <div className="account-heading"><h1>{account.user ? '已登录' : register ? '注册' : '登录'}</h1><p>{account.user ? '你的 TomcatTravel 账号已连接额度雷达' : register ? '一个账号，连接你的投资工具' : '欢迎回来，继续关注你的投资机会'}</p></div>
      <section className="account-card" aria-label={register ? '注册账号' : '登录账号'}>
        {error && <div className="account-message error" role="alert">{error}</div>}
        {params.get('loggedOut') === '1' && !account.user && <div className="account-message" role="status">已退出额度雷达。</div>}
        {account.loading ? <p className="account-status" role="status">正在读取账号状态…</p> : account.user ? <>
          <div className="account-profile"><span className="account-avatar">{Array.from(account.user.name)[0]}</span><strong>{account.user.name}</strong><p>{account.user.email}</p></div>
          <a className="account-primary" href={returnTo}>继续使用额度雷达<ArrowRight size={17} /></a>
          <a className="account-manage" href={account.accountUrl} target="_blank" rel="noreferrer">管理账号与密码<ExternalLink size={14} /></a>
          <div className="account-page-logout"><LogoutForm account={account} /><LogoutForm account={account} global /></div>
        </> : <>
          {account.enabled ? <a className="account-sso" aria-disabled={leaving || undefined} href={`/auth/${register ? 'register' : 'login'}?returnTo=${encodeURIComponent(returnTo)}`} onClick={event => { if (leaving) event.preventDefault(); else setLeaving(true); }}>{leaving ? '正在前往账号中心…' : `使用 TomcatTravel 账号${register ? '注册' : '继续'}`}<ArrowRight size={18} /></a> : <>
            <button className="account-sso" disabled>使用 TomcatTravel 账号{register ? '注册' : '继续'}</button>
            <p className="account-status" role="status">{account.error || '账号登录尚未开放，当前可以免登录使用额度雷达。'}</p>
            {account.error && <button className="account-retry" onClick={() => window.location.reload()}>重新加载</button>}
          </>}
          <p className="account-explanation">{register ? '前往账号中心创建账号并验证邮箱，完成后自动返回额度雷达。' : '已有 TomcatTravel 账号可直接使用。邮箱登录、验证和找回密码均在账号中心完成。'}</p>
          <div className="account-divider"><span>也可以先了解额度雷达</span></div>
          <a className="account-primary" href={returnTo}>免登录继续使用<ArrowRight size={17} /></a>
          <p className="account-switch">{register ? '已有账号？' : '还没有账号？'}<a href={`/${register ? 'login' : 'register'}?returnTo=${encodeURIComponent(returnTo)}`}>{register ? '登录' : '注册'}</a></p>
        </>}
      </section>
      <p className="account-footnote"><ShieldCheck size={16} />统一账号登录 · 收藏与计算方案仍保存在此浏览器</p>
    </main>
    <footer className="account-footer">纳斯达克100 · 标普500<span>投资有风险，入市需谨慎</span></footer>
  </div>;
}
