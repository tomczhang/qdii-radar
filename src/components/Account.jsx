import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff, LogOut, Radar, ShieldCheck, UserRound } from 'lucide-react';
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

function LogoutForm({ account }) {
  return <form method="post" action="/api/auth/logout">
    <input type="hidden" name="csrf" value={account.csrfToken} />
    <button type="submit"><LogOut size={15} />退出登录</button>
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
      <strong>{account.user.name}</strong><p>{account.user.email}</p><span className="account-provider">额度雷达账号</span>
      <a href="/reset-password"><UserRound size={15} />重设密码</a>
      <LogoutForm account={account} />
      <small>收藏与计算方案保存在此浏览器。</small>
    </section>}
  </div>;
}

async function accountPost(path, body) {
  const response = await fetch(`/api/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
  return data;
}

export function AccountPage() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [token] = useState(() => params.get('token') || '');
  const mode = window.location.pathname === '/register' ? 'register' : window.location.pathname === '/activate' ? 'activate' : window.location.pathname === '/reset-password' ? (token ? 'reset' : 'forgot-password') : 'login';
  const label = { register: '注册', activate: '激活账号', reset: '重设密码', 'forgot-password': '找回密码', login: '登录' }[mode];
  const returnTo = authReturnTo(params.get('returnTo'));
  const account = useAccount();
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [remaining, setRemaining] = useState(0), [showPassword, setShowPassword] = useState(false);
  const activationStarted = useRef(false);
  const link = page => `${page}?returnTo=${encodeURIComponent(returnTo)}`;
  const sendsMail = mode === 'register' || mode === 'forgot-password';
  useEffect(() => {
    document.title = `${label} · QDII 额度雷达`;
    if (token) {
      const url = new URL(window.location.href); url.searchParams.delete('token');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, [label, token]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  async function activate() {
    setBusy(true); setError('');
    try {
      const result = await accountPost('activate', { token });
      window.location.replace(result.redirectTo);
    } catch (error) { setError(error.message); setBusy(false); }
  }
  useEffect(() => {
    if (mode === 'activate' && account.enabled && token && !activationStarted.current) {
      activationStarted.current = true; activate();
    }
  }, [mode, account.enabled, token]);
  async function submit(event) {
    event.preventDefault();
    if (busy || (sendsMail && remaining)) return;
    setError(''); setNotice('');
    if (mode === 'reset' && password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    setBusy(true);
    try {
      const result = await accountPost(mode, { name, email, password, token, returnTo });
      if (result.redirectTo) window.location.assign(result.redirectTo);
      else { setNotice(result.message); setRemaining(result.retryAfter || 0); setBusy(false); }
    } catch (error) { setError(error.message); setBusy(false); }
  }
  const showProfile = account.user && ['login', 'register'].includes(mode);
  return <div className="account-page">
    <header className="account-page-header"><a className="account-brand" href="/"><span className="brand-mark"><Radar size={24} /></span><strong>QDII 额度雷达</strong></a><a className="account-back" href={returnTo}><ArrowLeft size={15} />返回看板</a></header>
    <main className="account-main">
      <div className="account-heading"><h1>{showProfile ? '已登录' : label}</h1><p>{showProfile ? '欢迎回来，继续使用额度雷达' : mode === 'register' ? '创建你的额度雷达账号' : mode === 'activate' ? '正在确认你的邮箱' : mode === 'reset' ? '设置一个新密码' : mode === 'forgot-password' ? '我们会向你的邮箱发送重设密码链接' : '欢迎回来，登录你的额度雷达账号'}</p></div>
      <section className="account-card" aria-label={`${label}账号`}>
        {error && <div className="account-message error" role="alert">{error}</div>}
        {notice && <div className="account-message" role="status">{notice}</div>}
        {params.get('loggedOut') === '1' && !account.user && <div className="account-message" role="status">已退出登录。</div>}
        {params.get('passwordReset') === '1' && <div className="account-message" role="status">密码已重设，请使用新密码登录。</div>}
        {account.loading ? <p className="account-status" role="status">正在读取账号状态…</p> : showProfile ? <>
          <div className="account-profile"><span className="account-avatar">{Array.from(account.user.name)[0]}</span><strong>{account.user.name}</strong><p>{account.user.email}</p></div>
          <a className="account-primary" href={returnTo}>继续使用额度雷达<ArrowRight size={17} /></a>
          <a className="account-manage" href={link('/reset-password')}>重设密码</a>
          <div className="account-page-logout"><LogoutForm account={account} /></div>
        </> : <>
          {account.enabled ? mode === 'activate' ? <>
            {busy && <p className="account-status" role="status">正在激活账号…</p>}
            {!token && <p className="account-status" role="alert">请通过邮件中的完整链接激活账号。</p>}
            {error && <><button className="account-retry" onClick={activate} disabled={busy}>重试激活</button><a className="account-manage" href={link('/register')}>重新注册并发送激活邮件</a></>}
          </> : <>
            <form className="account-form" onSubmit={submit} aria-label={`${label}表单`}>
              {mode === 'register' && <>
                <label htmlFor="account-name">昵称</label>
                <input id="account-name" name="name" type="text" autoComplete="nickname" maxLength={40} required value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder="你的昵称" />
              </>}
              {mode !== 'reset' && <>
                <label htmlFor="account-email">邮箱</label>
                <input id="account-email" name="email" type="email" autoComplete="username" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="you@example.com" />
              </>}
              {mode !== 'forgot-password' && <>
                <label htmlFor="account-password">{mode === 'reset' ? '新密码' : '密码'}</label>
                <div className="account-password-field"><input id="account-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} maxLength={128} pattern={mode === 'login' ? undefined : '(?=.*[A-Za-z])(?=.*[0-9]).*'} title={mode === 'login' ? undefined : '至少 8 个字符，包含字母和数字，无需特殊符号'} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder={mode === 'login' ? '输入密码' : '至少 8 个字符，包含字母和数字'} /><button type="button" className="account-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
              </>}
              {mode === 'reset' && <>
                <label htmlFor="account-confirm">确认密码</label>
                <input id="account-confirm" name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
              </>}
              {mode === 'login' && <a className="account-forgot" href={link('/reset-password')}>忘记密码？</a>}
              <button className="account-primary" type="submit" disabled={busy || (sendsMail && remaining > 0)}>{busy ? '正在处理…' : sendsMail && remaining ? `${remaining} 秒后可重新发送` : mode === 'forgot-password' ? '发送重设密码邮件' : mode === 'register' && notice ? '重新发送激活邮件' : label}<ArrowRight size={17} /></button>
            </form>
            {mode === 'register' && <p className="account-explanation">注册后请查收激活邮件，点击邮件链接即可完成激活。</p>}
            {mode === 'reset' && <p className="account-explanation">密码重设后，已登录的设备需要重新登录。</p>}
          </> : <>
            <p className="account-status" role="status">{account.error || '账号服务暂未开放，你仍可以免登录使用额度雷达。'}</p>
            {account.error && <button className="account-retry" onClick={() => window.location.reload()}>重新加载</button>}
          </>}
          <p className="account-switch">{mode === 'login' ? '还没有账号？' : '已有账号？'}<a href={link(mode === 'login' ? '/register' : '/login')}>{mode === 'login' ? '注册' : '返回登录'}</a></p>
          <div className="account-divider"><span>也可以直接浏览</span></div>
          <a className="account-guest" href={returnTo}>免登录继续使用<ArrowRight size={17} /></a>
        </>}
      </section>
      <p className="account-footnote"><ShieldCheck size={16} />收藏与计算方案保存在此浏览器</p>
    </main>
    <footer className="account-footer">纳斯达克100 · 标普500<span>投资有风险，入市需谨慎</span></footer>
  </div>;
}
