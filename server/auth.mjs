import { randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { digest } from './domain.mjs';
import { authReturnTo } from '../shared/account.mjs';

const ACTIVATION_SECONDS = 24 * 60 * 60;
const RESET_SECONDS = 30 * 60;
const SESSION_SECONDS = 8 * 60 * 60;
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieValue = (req, name) => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
const scrypt = promisify(scryptCallback);
const passwordSchema = z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/[0-9]/);
// Existing accounts may have passwords created under an earlier policy.
const loginPasswordSchema = z.string().min(1).max(128);
const derive = async (password, salt) => (await scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 })).toString('hex');
async function hashPassword(password) {
  const salt = random();
  return `scrypt$${salt}$${await derive(password, salt)}`;
}
async function checkPassword(password, stored) {
  const [, salt, hash] = (stored || 'scrypt$unregistered-account$invalid').split('$');
  return equal(await derive(password, salt), hash);
}
const nameSchema = z.string().trim().min(1).max(40);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const emailSchema = z.string().trim().max(254).email().transform(value => value.toLowerCase());

export function accountConfig(env = process.env, origin = 'http://localhost:4387') {
  const base = new URL(origin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && loopback && base.protocol === 'http:'))) {
    throw new Error('PUBLIC_BASE_URL 必须是 HTTPS 站点根地址；仅本机开发允许 loopback HTTP');
  }
  if (env.ACCOUNT_AUTH_ENABLED && !['true', 'false'].includes(env.ACCOUNT_AUTH_ENABLED)) throw new Error('ACCOUNT_AUTH_ENABLED 必须为 true 或 false');
  const allowedOrigins = [base.origin];
  if (env.NODE_ENV !== 'production' && loopback && base.protocol === 'http:') {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const alias = new URL(base); alias.hostname = hostname;
      if (!allowedOrigins.includes(alias.origin)) allowedOrigins.push(alias.origin);
    }
  }
  return { origin: base.origin, allowedOrigins, enabled: env.ACCOUNT_AUTH_ENABLED !== 'false' };
}

export function installAccountAuth(app, { store, config, rateLimit, mail }) {
  const db = store.db;
  // Separate tables keep legacy OIDC identities/data intact without silently linking by email.
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_account_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_account_links (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL, payload TEXT NOT NULL,
      expires INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS local_link_expiry ON local_account_links(expires);
    CREATE INDEX IF NOT EXISTS local_link_email ON local_account_links(email,purpose);
    CREATE TABLE IF NOT EXISTS local_account_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL, csrf TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_session_expiry ON local_account_sessions(expires);
    CREATE TABLE IF NOT EXISTS local_account_limits (
      id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL, last_at INTEGER NOT NULL
    );
  `);
  const enabled = !!(config?.enabled && mail?.configured && mail?.sendAccountLink);
  const secure = config?.origin.startsWith('https:');
  const sessionCookie = secure ? '__Host-radar_session' : 'radar_session';
  const setCookie = (res, name, value, age) => res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
  const limitKey = (kind, value) => digest(`${kind}:${value}`);
  let lastCleanup = 0;
  function withinLimit(key, maximum, cooldown = 0) {
    const row = db.prepare('SELECT * FROM local_account_limits WHERE id=?').get(key);
    return !row || row.expires <= Date.now() || (row.count < maximum && Date.now() - row.last_at >= cooldown);
  }
  function useLimit(key) {
    const now = Date.now();
    db.prepare(`INSERT INTO local_account_limits VALUES(?,1,?,?) ON CONFLICT(id) DO UPDATE SET
      count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
      expires=CASE WHEN expires<=? THEN ? ELSE expires END, last_at=?`).run(key, now + 3600000, now, now, now, now + 3600000, now);
  }
  function clearSession(req, res) {
    const id = cookieValue(req, sessionCookie);
    if (id) db.prepare('DELETE FROM local_account_sessions WHERE id=?').run(digest(id));
    setCookie(res, sessionCookie, '', 0);
  }
  function sameOrigin(req) {
    return (config?.allowedOrigins || [config?.origin]).includes(req.headers.origin) || (req.headers.origin === 'null' && req.headers['sec-fetch-site'] === 'same-origin');
  }
  function requireOrigin(req, res, next) {
    if (!enabled) return res.status(503).json({ error: '账号服务暂时不可用，你仍可以免登录使用。' });
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效，请刷新页面重试。' });
    next();
  }
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/') || ['/activate', '/reset-password', '/register', '/login'].includes(req.path)) res.setHeader('Cache-Control', 'no-store');
    if (Date.now() - lastCleanup > 60000) {
      for (const table of ['local_account_links', 'local_account_sessions', 'local_account_limits']) db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(Date.now());
      lastCleanup = Date.now();
    }
    const id = enabled && cookieValue(req, sessionCookie);
    if (id) {
      const row = db.prepare(`SELECT s.*, u.email, u.name FROM local_account_sessions s
        JOIN local_account_users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?`).get(digest(id), Date.now());
      if (row) {
        req.accountSession = row;
        req.owner = digest(`account:${row.user_id}`);
      }
    }
    next();
  });
  app.get('/api/auth/session', (req, res) => {
    const row = req.accountSession;
    res.json({ enabled, user: row ? { id: row.user_id, email: row.email, name: row.name } : null,
      csrfToken: row?.csrf || null, expiresAt: row ? new Date(row.expires).toISOString() : null });
  });
  // Old entry links stay inside the product; old OIDC callbacks can no longer create a session.
  app.get(['/auth/login', '/auth/register', '/auth/callback', '/auth/logout/callback'], (req, res) => {
    const page = req.path === '/auth/register' ? '/register' : '/login';
    res.redirect(303, `${page}?returnTo=${encodeURIComponent(authReturnTo(req.query.returnTo))}`);
  });
  function reserveMail(req, res, email) {
    const emailKey = limitKey('send-email', email), ipKey = limitKey('send-ip', req.ip);
    if (!withinLimit(emailKey, 5, 60000) || !withinLimit(ipKey, 15)) {
      res.status(429).json({ error: '邮件发送过于频繁，请稍后再试。' }); return false;
    }
    useLimit(emailKey); useLimit(ipKey); return true;
  }
  async function sendLink(req, email, purpose, payload) {
    const token = random(), id = digest(token), seconds = purpose === 'activate' ? ACTIVATION_SECONDS : RESET_SECONDS;
    // Use only a configured origin/explicit development alias, never an arbitrary Host header.
    const origin = (config.allowedOrigins || [config.origin]).includes(req.headers.origin) ? req.headers.origin : config.origin;
    const url = new URL(purpose === 'activate' ? '/activate' : '/reset-password', origin);
    url.searchParams.set('token', token);
    db.prepare('INSERT INTO local_account_links(id,email,purpose,payload,expires) VALUES(?,?,?,?,?)').run(id, email, purpose, JSON.stringify(payload), Date.now() + seconds * 1000);
    try {
      await mail.sendAccountLink(email, url.href, id, purpose);
      db.prepare('UPDATE local_account_links SET ready=1 WHERE id=?').run(id);
    } catch (error) {
      db.prepare('DELETE FROM local_account_links WHERE id=?').run(id);
      const code = /^resend_http_\d{3}$/.test(error.code || '') ? error.code : 'mail_connection_failed';
      store.setMeta('lastAccountMailFailure', { code, at: new Date().toISOString() });
      throw error;
    }
  }
  const linkRow = (token, purpose) => tokenSchema.safeParse(token).success && db.prepare('SELECT * FROM local_account_links WHERE id=? AND purpose=? AND ready=1 AND expires>?').get(digest(token), purpose, Date.now());
  const invalidLink = res => res.status(400).json({ error: '链接无效、已使用或已过期，请重新申请邮件。' });
  app.post('/api/auth/register', requireOrigin, rateLimit, async (req, res) => {
    const email = emailSchema.safeParse(req.body?.email), password = passwordSchema.safeParse(req.body?.password), name = nameSchema.safeParse(req.body?.name);
    if (!email.success) return res.status(400).json({ error: '请输入有效的邮箱地址。' });
    if (!name.success) return res.status(400).json({ error: '请填写 1–40 个字符的昵称。' });
    if (!password.success) return res.status(400).json({ error: '密码需为 8–128 个字符，包含字母和数字，无需特殊符号。' });
    if (!reserveMail(req, res, email.data)) return;
    // Do not reserve an active account before email ownership has been proved.
    const passwordHash = await hashPassword(password.data);
    try {
      await sendLink(req, email.data, 'activate', { name: name.data, passwordHash, returnTo: authReturnTo(req.body?.returnTo) });
      res.json({ sent: true, retryAfter: 60, message: '激活邮件已发送，请在 24 小时内点击邮件链接完成注册。' });
    } catch { res.status(503).json({ error: '激活邮件发送失败，请稍后重试。' }); }
  });
  app.post('/api/auth/activate', requireOrigin, rateLimit, (req, res) => {
    const row = linkRow(req.body?.token, 'activate');
    if (!row) return invalidLink(res);
    const payload = JSON.parse(row.payload), now = Date.now();
    let user;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM local_account_links WHERE id=?').run(row.id);
      if (db.prepare('SELECT id FROM local_account_users WHERE email=?').get(row.email)) {
        db.exec('COMMIT');
        return res.status(400).json({ error: '此邮箱已经激活，请直接登录或找回密码。' });
      }
      user = { id: random() };
      db.prepare('INSERT INTO local_account_users VALUES(?,?,?,?,?,?)').run(user.id, row.email, payload.name, payload.passwordHash, now, now);
      db.prepare('DELETE FROM local_account_links WHERE email=?').run(row.email);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    establishSession(req, res, user.id);
    res.json({ redirectTo: authReturnTo(payload.returnTo) });
  });
  app.post('/api/auth/forgot-password', requireOrigin, rateLimit, async (req, res) => {
    const email = emailSchema.safeParse(req.body?.email);
    if (!email.success) return res.status(400).json({ error: '请输入有效的邮箱地址。' });
    if (!reserveMail(req, res, email.data)) return;
    const user = db.prepare('SELECT id,password_hash FROM local_account_users WHERE email=?').get(email.data);
    try {
      if (user) await sendLink(req, email.data, 'reset', { userId: user.id, passwordVersion: digest(user.password_hash), returnTo: authReturnTo(req.body?.returnTo) });
      res.json({ sent: true, retryAfter: 60, message: '如果该邮箱已注册，你将收到密码重设邮件，链接在 30 分钟内有效。' });
    } catch { res.status(503).json({ error: '密码重设邮件发送失败，请稍后重试。' }); }
  });
  function establishSession(req, res, userId) {
    clearSession(req, res);
    const sessionId = random();
    db.prepare('INSERT INTO local_account_sessions VALUES(?,?,?,?)').run(digest(sessionId), userId, Date.now() + SESSION_SECONDS * 1000, random());
    setCookie(res, sessionCookie, sessionId, SESSION_SECONDS);
  }
  app.post('/api/auth/login', requireOrigin, rateLimit, async (req, res) => {
    const email = emailSchema.safeParse(req.body?.email), password = loginPasswordSchema.safeParse(req.body?.password);
    if (!email.success || !password.success) return res.status(400).json({ error: '邮箱或密码不正确。' });
    const emailKey = limitKey('login-email', email.data), ipKey = limitKey('login-ip', req.ip);
    if (!withinLimit(emailKey, 10) || !withinLimit(ipKey, 30)) return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试，或找回密码。' });
    // Reserve before asynchronous password work so simultaneous requests cannot bypass the budget.
    useLimit(emailKey); useLimit(ipKey);
    const user = db.prepare('SELECT * FROM local_account_users WHERE email=?').get(email.data);
    const valid = await checkPassword(password.data, user?.password_hash);
    // A concurrent password reset must invalidate an in-flight login with the old password.
    const current = user && db.prepare('SELECT password_hash FROM local_account_users WHERE id=?').get(user.id);
    if (!valid || !user || current?.password_hash !== user.password_hash) return res.status(400).json({ error: '邮箱或密码不正确。' });
    db.prepare('DELETE FROM local_account_limits WHERE id=?').run(emailKey);
    establishSession(req, res, user.id);
    res.json({ redirectTo: authReturnTo(req.body?.returnTo) });
  });
  app.post('/api/auth/reset', requireOrigin, rateLimit, async (req, res) => {
    const password = passwordSchema.safeParse(req.body?.password);
    if (!password.success) return res.status(400).json({ error: '密码需为 8–128 个字符，包含字母和数字，无需特殊符号。' });
    const row = linkRow(req.body?.token, 'reset');
    if (!row) return invalidLink(res);
    const payload = JSON.parse(row.payload), passwordHash = await hashPassword(password.data);
    db.exec('BEGIN IMMEDIATE');
    try {
      const consumed = db.prepare('DELETE FROM local_account_links WHERE id=? AND ready=1 AND expires>? RETURNING *').get(row.id, Date.now());
      const user = db.prepare('SELECT * FROM local_account_users WHERE id=?').get(payload.userId);
      if (!consumed || !user || digest(user.password_hash) !== payload.passwordVersion) {
        db.exec('COMMIT'); return invalidLink(res);
      }
      db.prepare('UPDATE local_account_users SET password_hash=?,updated_at=? WHERE id=?').run(passwordHash, Date.now(), user.id);
      db.prepare('DELETE FROM local_account_sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM local_account_links WHERE email=?').run(row.email);
      db.prepare('DELETE FROM local_account_limits WHERE id=?').run(limitKey('login-email', row.email));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    clearSession(req, res);
    res.json({ redirectTo: `/login?passwordReset=1&returnTo=${encodeURIComponent(authReturnTo(payload.returnTo))}` });
  });
  app.post('/api/auth/logout', requireOrigin, rateLimit, (req, res) => {
    const session = req.accountSession;
    if (!session) return res.status(401).json({ error: '登录已过期，请刷新页面。' });
    if (!equal(req.body?.csrf, session.csrf)) return res.status(403).json({ error: '退出请求无效，请刷新页面重试。' });
    clearSession(req, res);
    res.redirect(303, '/login?loggedOut=1');
  });
}
