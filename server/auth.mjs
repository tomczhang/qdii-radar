import * as oidc from 'openid-client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { digest } from './domain.mjs';
import { authReturnTo } from '../shared/account.mjs';

const FLOW_SECONDS = 600;
const SESSION_SECONDS = 8 * 60 * 60;
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieValue = (req, name) => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);

export function accountConfig(env = process.env, origin = 'http://localhost:4387') {
  const values = [env.ACCOUNT_CENTER_ISSUER, env.ACCOUNT_CENTER_CLIENT_ID, env.ACCOUNT_CENTER_CLIENT_SECRET];
  if (values.every(value => !value)) return null;
  if (values.some(value => !value?.trim())) throw new Error('请完整配置 ACCOUNT_CENTER_ISSUER、ACCOUNT_CENTER_CLIENT_ID、ACCOUNT_CENTER_CLIENT_SECRET');
  const issuer = new URL(values[0]), base = new URL(origin);
  for (const url of [issuer, base]) {
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && loopback && url.protocol === 'http:'))) {
      throw new Error('账号中心和 PUBLIC_BASE_URL 必须使用 HTTPS；仅本机开发允许 loopback HTTP');
    }
  }
  if (base.pathname !== '/') throw new Error('PUBLIC_BASE_URL 必须是站点根地址');
  return { issuer: issuer.href.replace(/\/$/, ''), origin: base.origin, clientId: values[1], clientSecret: values[2] };
}

export function installAccountAuth(app, { store, config, rateLimit }) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_users (
      id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
      email TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(issuer, subject)
    );
    CREATE TABLE IF NOT EXISTS account_flows (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS account_flow_expiry ON account_flows(expires);
    CREATE TABLE IF NOT EXISTS account_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL, csrf TEXT NOT NULL, id_token TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS account_session_expiry ON account_sessions(expires);
  `);
  const secure = config?.origin.startsWith('https:');
  const sessionCookie = secure ? '__Host-radar_session' : 'radar_session';
  const flowCookie = secure ? '__Host-radar_auth' : 'radar_auth';
  const setCookie = (res, name, value, age) => res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
  const callback = config && `${config.origin}/auth/callback`;
  const logoutCallback = config && `${config.origin}/auth/logout/callback`;
  let discovery, lastCleanup = 0;
  async function client() {
    if (!discovery) discovery = oidc.discovery(new URL(config.issuer), config.clientId,
      { client_secret: config.clientSecret, id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretPost(config.clientSecret), {
        timeout: 10,
        execute: [...(config.issuer.startsWith('http:') ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks],
      }).then(value => {
        const metadata = value.serverMetadata();
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'end_session_endpoint']) {
          if (metadata[key] && new URL(metadata[key]).origin !== new URL(config.issuer).origin) throw new Error('Unexpected identity endpoint');
        }
        return value;
      }).catch(error => { discovery = undefined; throw error; });
    return discovery;
  }
  function createFlow(res, payload) {
    const id = random();
    db.prepare('INSERT INTO account_flows VALUES(?,?,?)').run(digest(id), Date.now() + FLOW_SECONDS * 1000, JSON.stringify(payload));
    setCookie(res, flowCookie, id, FLOW_SECONDS);
  }
  function consumeFlow(req, res, kind) {
    const id = cookieValue(req, flowCookie);
    if (!id) return null;
    const row = db.prepare('DELETE FROM account_flows WHERE id=? RETURNING *').get(digest(id));
    setCookie(res, flowCookie, '', 0);
    if (!row || row.expires <= Date.now()) return null;
    const flow = JSON.parse(row.payload);
    return flow.kind === kind ? flow : null;
  }
  function clearSession(req, res) {
    const id = cookieValue(req, sessionCookie);
    if (id) db.prepare('DELETE FROM account_sessions WHERE id=?').run(digest(id));
    setCookie(res, sessionCookie, '', 0);
  }
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) res.setHeader('Cache-Control', 'no-store');
    if (Date.now() - lastCleanup > 60000) {
      db.prepare('DELETE FROM account_flows WHERE expires<=?').run(Date.now());
      db.prepare('DELETE FROM account_sessions WHERE expires<=?').run(Date.now());
      lastCleanup = Date.now();
    }
    const id = config && cookieValue(req, sessionCookie);
    if (id) {
      const row = db.prepare(`SELECT s.*, u.issuer, u.email, u.name FROM account_sessions s
        JOIN account_users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?`).get(digest(id), Date.now());
      if (row?.issuer === config.issuer) {
        req.accountSession = row;
        // Account-owned subscriptions are isolated from legacy anonymous browser subscriptions.
        req.owner = digest(`account:${row.user_id}`);
      }
    }
    next();
  });
  app.get('/api/auth/session', (req, res) => {
    const row = req.accountSession;
    res.json({ enabled: !!config, user: row ? { id: row.user_id, email: row.email, name: row.name } : null,
      csrfToken: row?.csrf || null, expiresAt: row ? new Date(row.expires).toISOString() : null,
      accountUrl: row ? `${config.issuer}/account/` : null });
  });
  app.get(['/auth/login', '/auth/register'], rateLimit, async (req, res) => {
    if (!config) return res.redirect(303, '/login?error=unavailable');
    try {
      const provider = await client();
      const verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce();
      const target = oidc.buildAuthorizationUrl(provider, {
        redirect_uri: callback, scope: 'openid email profile', response_type: 'code', state, nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', ui_locales: 'zh-CN',
      });
      if (req.path === '/auth/register') {
        // Keycloak's registration endpoint takes the same authorization parameters.
        if (!target.pathname.endsWith('/protocol/openid-connect/auth')) throw new Error('Unsupported registration endpoint');
        target.pathname = target.pathname.replace(/\/auth$/, '/registrations');
      }
      const oldFlow = cookieValue(req, flowCookie);
      if (oldFlow) db.prepare('DELETE FROM account_flows WHERE id=?').run(digest(oldFlow));
      createFlow(res, { kind: 'login', verifier, state, nonce, returnTo: authReturnTo(req.query.returnTo) });
      res.redirect(303, target.href);
    } catch { res.redirect(303, '/login?error=unavailable'); }
  });
  app.get('/auth/callback', async (req, res) => {
    const flow = consumeFlow(req, res, 'login');
    if (!config || !flow) return res.redirect(303, '/login?error=expired');
    try {
      const tokens = await oidc.authorizationCodeGrant(await client(), new URL(req.originalUrl, config.origin), {
        pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub || claims.iss !== config.issuer || claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email.trim()) {
        return res.redirect(303, '/login?error=unverified');
      }
      const now = Date.now();
      const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 120) : claims.email;
      const user = db.prepare(`INSERT INTO account_users VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email,name=excluded.name,updated_at=excluded.updated_at
        RETURNING id`).get(random(), claims.iss, claims.sub, claims.email, name, now, now);
      clearSession(req, res);
      const id = random();
      db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').run(digest(id), user.id, now + SESSION_SECONDS * 1000, random(), tokens.id_token);
      setCookie(res, sessionCookie, id, SESSION_SECONDS);
      res.redirect(303, authReturnTo(flow.returnTo));
    } catch { res.redirect(303, '/login?error=failed'); }
  });
  app.post('/api/auth/logout', rateLimit, async (req, res) => {
    const session = req.accountSession;
    if (!config || !session) return res.status(401).json({ error: '登录已过期，请刷新页面' });
    // no-referrer makes native POST navigations send Origin: null in browsers.
    // In that case require browser-controlled same-origin Fetch Metadata AND CSRF.
    const sameOrigin = req.headers.origin === config.origin || (req.headers.origin === 'null' && req.headers['sec-fetch-site'] === 'same-origin');
    if (!sameOrigin || !equal(req.body?.csrf, session.csrf)) return res.status(403).json({ error: '退出请求无效，请刷新页面重试' });
    if (!['local', 'global'].includes(req.body.mode)) return res.status(400).json({ error: '请选择退出方式' });
    try {
      let target = '/login?loggedOut=1';
      if (req.body.mode === 'global') {
        const state = oidc.randomState();
        target = oidc.buildEndSessionUrl(await client(), { id_token_hint: session.id_token, post_logout_redirect_uri: logoutCallback, state }).href;
        createFlow(res, { kind: 'logout', state });
      } else {
        consumeFlow(req, res, 'login');
      }
      clearSession(req, res);
      // Native form navigation keeps tokens out of frontend JavaScript.
      res.redirect(303, target);
    } catch { res.redirect(303, '/login?error=logout'); }
  });
  app.get('/auth/logout/callback', (req, res) => {
    const flow = consumeFlow(req, res, 'logout');
    res.redirect(303, flow && equal(req.query.state, flow.state) ? '/login?loggedOut=1' : '/login?error=expired');
  });
}
