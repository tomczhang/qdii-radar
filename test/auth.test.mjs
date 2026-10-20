import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { accountConfig, installAccountAuth } from '../server/auth.mjs';
import { authReturnTo } from '../shared/account.mjs';
import { openStore } from '../server/store.mjs';
import { digest } from '../server/domain.mjs';

const password = 'Test-password-2026', email = 'person@example.test', name = '雷达用户';
async function setup(t, { disabled = false, https = false, mailConfigured = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-auth-'));
  const store = openStore(dir), app = express();
  app.use(express.urlencoded({ extended: false })); app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { origin: https ? 'https://radar.example.test' : base, enabled: !disabled };
  const messages = [], mail = { configured: mailConfigured, async sendAccountLink(email, url, id, purpose) { messages.push({ email, url, id, purpose }); } };
  installAccountAuth(app, { store, config, mail, rateLimit: (req, res, next) => next() });
  app.get('/owner', (req, res) => res.json({ owner: req.owner }));
  // Opening an email URL only serves the page. Its JS explicitly POSTs activation.
  app.get(['/activate', '/reset-password'], (req, res) => res.send('Account page'));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const jar = new Map();
  const request = async (target, options = {}, cookies = jar) => {
    const response = await fetch(base + target, { ...options, redirect: 'manual', headers: { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...options.headers } });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) cookies.set(key, value); else cookies.delete(key);
    }
    return response;
  };
  const post = (route, data, cookies = jar, headers = {}) => request(`/api/auth/${route}`, { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) }, cookies);
  const session = async (cookies = jar) => (await request('/api/auth/session', {}, cookies)).json();
  const token = () => new URL(messages.at(-1).url).searchParams.get('token');
  const register = async (address = email, cookies = jar) => {
    const response = await post('register', { name, email: address, password, returnTo: '/?page=calculator' }, cookies);
    assert.equal(response.status, 200, await response.text());
    const activation = await post('activate', { token: token() }, cookies);
    assert.equal(activation.status, 200, await activation.text());
    return session(cookies);
  };
  const cooldown = () => store.db.prepare('UPDATE local_account_limits SET last_at=last_at-61000').run();
  return { store, dir, config, base, request, post, session, register, cooldown, jar, messages, mail, token };
}

test('configuration validates HTTPS, return URLs and ignores old account-center settings', () => {
  assert.equal(accountConfig({}).enabled, true);
  assert.equal(accountConfig({ ACCOUNT_AUTH_ENABLED: 'false' }).enabled, false);
  assert.throws(() => accountConfig({ ACCOUNT_AUTH_ENABLED: 'yes' }));
  for (const origin of ['http://radar.example.test', 'http://localhost:4387', 'https://x:y@radar.example.test', 'https://radar.example.test?q=1', 'https://radar.example.test/path']) assert.throws(() => accountConfig({ NODE_ENV: 'production' }, origin));
  assert.equal(accountConfig({ NODE_ENV: 'production', ACCOUNT_CENTER_CLIENT_ID: 'obsolete' }, 'https://radar.example.test').origin, 'https://radar.example.test');
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/auth/login', '/?page=calculator&token=private', ['/', '//evil.test']]) assert.equal(authReturnTo(value), '/');
});

test('disabled or missing mail service explicitly disables accounts', async t => {
  for (const options of [{ disabled: true }, { mailConfigured: false }]) {
    const s = await setup(t, options), response = await s.request('/api/auth/session');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { enabled: false, user: null, csrfToken: null, expiresAt: null });
    assert.equal((await s.post('register', { name, email, password })).status, 503);
  }
});

test('nickname/email/password registration emails an activation link; no account or session before activation', async t => {
  const s = await setup(t, { https: true });
  const response = await s.post('register', { name, email: ` ${email.toUpperCase()} `, password, returnTo: '/?page=calculator' });
  assert.equal(response.status, 200);
  const data = await response.json(), token = s.token();
  assert.equal(data.sent, true); assert.ok(!JSON.stringify(data).includes(token));
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM local_account_users').get().n, 0);
  assert.equal((await s.session()).user, null);
  assert.equal((await s.post('login', { email, password })).status, 400);
  const url = new URL(s.messages[0].url);
  assert.equal(url.origin, 'https://radar.example.test'); assert.equal(url.pathname, '/activate');
  assert.equal(s.messages[0].email, email);
  const pending = s.store.db.prepare('SELECT * FROM local_account_links').get();
  assert.equal(pending.id, digest(token)); assert.ok(!pending.payload.includes(password));
  assert.match(JSON.parse(pending.payload).passwordHash, /^scrypt\$/);
  assert.equal((await s.request(url.pathname + url.search)).status, 200);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM local_account_users').get().n, 0, 'GET prefetch cannot activate');
  const otherBrowser = new Map();
  const activated = await s.post('activate', { token }, otherBrowser);
  assert.equal(activated.status, 200); assert.equal((await activated.json()).redirectTo, '/?page=calculator');
  assert.ok(activated.headers.getSetCookie().some(value => value.startsWith('__Host-radar_session=') && value.includes('Secure') && value.includes('HttpOnly') && !value.includes('Domain=')));
  const account = await s.session(otherBrowser);
  assert.equal(account.user.name, name); assert.equal(account.user.email, email);
  assert.ok(!JSON.stringify(account).includes('password'));
  assert.equal((await s.post('activate', { token })).status, 400, 'single use');
});

test('login persists identity, rotates sessions, hides password errors and prevents open redirects', async t => {
  const s = await setup(t); const first = await s.register(), oldCookie = new Map(s.jar);
  const a = await s.post('login', { email, password: 'wrong-password' }, new Map());
  const b = await s.post('login', { email: 'unknown@example.test', password }, new Map());
  assert.equal(a.status, 400); assert.deepEqual(await a.json(), await b.json());
  const login = await s.post('login', { email, password, returnTo: 'https://evil.test' });
  assert.equal((await login.json()).redirectTo, '/');
  const second = await s.session();
  assert.equal(second.user.id, first.user.id); assert.notEqual(second.csrfToken, first.csrfToken);
  assert.equal((await s.session(oldCookie)).user, null);
  const reopened = openStore(s.dir);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM local_account_users').get().n, 1); reopened.close();
});

test('input validation, activation expiry and purpose separation', async t => {
  const s = await setup(t);
  for (const body of [{ name: '', email, password }, { name: ' '.repeat(3), email, password }, { name, email: 'bad', password }, { name, email, password: 'short' }]) assert.equal((await s.post('register', body)).status, 400);
  assert.equal((await s.post('register', { name, email, password })).status, 200);
  const token = s.token();
  assert.equal((await s.post('reset', { token, password })).status, 400);
  assert.equal((await s.post('activate', { token: 'forged' })).status, 400);
  s.store.db.prepare('UPDATE local_account_links SET expires=0').run();
  assert.equal((await s.post('activate', { token })).status, 400);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM local_account_users').get().n, 0);
});

test('failed or still-pending email delivery cannot activate; errors never expose provider details', async t => {
  const s = await setup(t);
  let release;
  s.mail.sendAccountLink = async (email, url) => { s.messages.push({ url }); await new Promise(resolve => { release = resolve; }); throw Object.assign(new Error('private-provider-error'), { code: 'resend_http_403' }); };
  const sending = s.post('register', { name, email, password });
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await s.post('activate', { token: s.token() })).status, 400);
  release(); const failed = await sending;
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private-provider-error'));
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM local_account_links').get().n, 0);
  assert.equal(s.store.getMeta('lastAccountMailFailure').code, 'resend_http_403');
});

test('email cooldown and hourly budgets survive resends; password guessing is limited', async t => {
  const s = await setup(t); await s.register();
  assert.equal((await s.post('forgot-password', { email: email.toUpperCase() })).status, 429);
  for (let i = 0; i < 4; i++) { s.cooldown(); assert.equal((await s.post('forgot-password', { email })).status, 200); }
  s.cooldown(); assert.equal((await s.post('forgot-password', { email })).status, 429);
  for (let i = 0; i < 10; i++) assert.equal((await s.post('login', { email, password: 'wrong-password' })).status, 400);
  assert.equal((await s.post('login', { email, password })).status, 429);
});

test('reset link works in another browser, revokes all old sessions and requires the new password', async t => {
  const s = await setup(t); const original = await s.register(), first = new Map(s.jar), second = new Map();
  await s.post('login', { email, password }, second);
  s.cooldown(); assert.equal((await s.post('forgot-password', { email })).status, 200);
  const token = s.token(), resetJar = new Map();
  assert.equal(new URL(s.messages.at(-1).url).pathname, '/reset-password');
  assert.equal((await s.post('activate', { token })).status, 400);
  const result = await s.post('reset', { token, password: 'New-password-2026' }, resetJar);
  assert.equal(result.status, 200); assert.match((await result.json()).redirectTo, /^\/login\?passwordReset=1/);
  for (const jar of [first, second, resetJar]) assert.equal((await s.session(jar)).user, null);
  assert.equal((await s.post('login', { email, password }, second)).status, 400);
  assert.equal((await s.post('login', { email, password: 'New-password-2026' }, second)).status, 200);
  assert.equal((await s.session(second)).user.id, original.user.id);
  assert.equal((await s.post('reset', { token, password }, resetJar)).status, 400);
});

test('unknown reset email gets the same acknowledgement without a usable reset token', async t => {
  const s = await setup(t); await s.register(); s.cooldown();
  const known = await s.post('forgot-password', { email });
  const count = s.messages.length, unknown = await s.post('forgot-password', { email: 'unknown@example.test' });
  assert.equal(unknown.status, 200); assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(s.messages.length, count);
});

test('duplicate registration cannot overwrite an active account; concurrent activation succeeds once', async t => {
  const s = await setup(t);
  await s.post('register', { name, email, password }); const token = s.token();
  const results = await Promise.all([s.post('activate', { token }, new Map()), s.post('activate', { token }, new Map())]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  const user = s.store.db.prepare('SELECT * FROM local_account_users').get();
  s.cooldown(); await s.post('register', { name: 'replacement', email, password: 'replacement-password1' });
  assert.equal((await s.post('activate', { token: s.token() })).status, 400);
  assert.deepEqual(s.store.db.prepare('SELECT * FROM local_account_users').get(), user);
});

test('concurrent password reset consumes a link once; all other links are invalidated', async t => {
  const s = await setup(t); await s.register(); s.cooldown();
  await s.post('forgot-password', { email }); const oldToken = s.token();
  s.cooldown(); await s.post('forgot-password', { email }); const token = s.token();
  const results = await Promise.all([s.post('reset', { token, password: 'new-password-one1' }, new Map()), s.post('reset', { token, password: 'new-password-two1' }, new Map())]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await s.post('reset', { token: oldToken, password })).status, 400);
});

test('origin checks protect mutations; native logout also requires CSRF', async t => {
  const s = await setup(t);
  for (const route of ['register', 'activate', 'login', 'forgot-password', 'reset', 'logout']) {
    for (const headers of [{ Origin: 'https://evil.test' }, { Origin: '' }, { Origin: 'null' }, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await s.post(route, { name, email, password }, s.jar, headers)).status, 403);
  }
  const account = await s.register(), old = new Map(s.jar);
  assert.equal((await s.post('logout', { csrf: 'wrong' })).status, 403);
  const response = await s.request('/api/auth/logout', { method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: account.csrfToken }) });
  assert.equal(response.status, 303); assert.equal((await s.session(old)).user, null);
});

test('local identities remain isolated from legacy accounts and expired sessions', async t => {
  const s = await setup(t);
  s.store.db.exec('CREATE TABLE account_users(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE account_sessions(id TEXT PRIMARY KEY,user_id TEXT)');
  s.store.db.prepare('INSERT INTO account_users VALUES(?,?)').run('legacy-id', email);
  s.store.db.prepare('INSERT INTO account_sessions VALUES(?,?)').run(digest('legacy-session'), 'legacy-id');
  assert.equal((await s.session(new Map([['radar_session', 'legacy-session']]))).user, null);
  const one = await s.register(); const owner = await (await s.request('/owner')).json();
  assert.notEqual(one.user.id, 'legacy-id');
  const two = await s.register('another@example.test');
  assert.notEqual(one.user.id, two.user.id); assert.notDeepEqual(await (await s.request('/owner')).json(), owner);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM account_users').get().n, 1);
  s.store.db.prepare('UPDATE local_account_sessions SET expires=0').run();
  assert.equal((await s.session()).user, null);
});

test('development origins are bounded by port; production rejects aliases and spoofed hosts', async t => {
  const s = await setup(t);
  Object.assign(s.config, accountConfig({ NODE_ENV: 'development' }, `http://localhost:${new URL(s.base).port}`));
  for (const origin of s.config.allowedOrigins) assert.equal((await s.post('forgot-password', { email: `${s.config.allowedOrigins.indexOf(origin)}@example.test` }, new Map(), { Origin: origin })).status, 200);
  for (const origin of ['http://localhost:9', 'http://evil.test', 'http://localhost.evil.test']) assert.equal((await s.post('forgot-password', { email }, new Map(), { Origin: origin, Host: new URL(origin).host })).status, 403);
  Object.assign(s.config, accountConfig({ NODE_ENV: 'production' }, 'https://radar.example.test'));
  assert.deepEqual(s.config.allowedOrigins, ['https://radar.example.test']);
  assert.equal((await s.post('forgot-password', { email }, new Map(), { Origin: s.base })).status, 403);
});

test('dev server ignores production PUBLIC_BASE_URL in email links and HTTP session cookies', async t => {
  const { createServer } = await import('node:http'), { createApplication } = await import('../server/index.mjs');
  const original = { ...process.env }, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-dev-origin-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { NODE_ENV: 'development', PUBLIC_BASE_URL: 'https://production.example.test', PORT: String(server.address().port), ACCOUNT_AUTH_ENABLED: 'true', TRUST_PROXY_HOPS: '0' }); delete process.env.DEV_BASE_URL;
  let runtime, activationUrl;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); if (runtime) await runtime.close(); fs.rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original);
  });
  runtime = await createApplication({ store: openStore(dir), startJobs: false, hmr: { server }, mail: { configured: true, async sendAccountLink(address, url) { activationUrl = url; } } }); server.on('request', runtime.app);
  const post = (route, body, origin = base) => fetch(`${base}/api/auth/${route}`, { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('register', { name, email, password })).status, 200);
  assert.equal(new URL(activationUrl).origin, base);
  const activation = await post('activate', { token: new URL(activationUrl).searchParams.get('token') });
  assert.equal(activation.status, 200);
  const cookie = activation.headers.getSetCookie().find(value => value.startsWith('radar_session=') && !value.startsWith('radar_session=;'));
  assert.ok(cookie); assert.ok(!cookie.includes('Secure'));
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie.split(';')[0] } })).json();
  assert.equal(session.user.name, name);
  assert.equal((await post('forgot-password', { email }, 'https://production.example.test')).status, 403);
});

test('registration and reset accept eight letters/digits without symbols; reject short or single-category passwords', async t => {
  const s = await setup(t);
  for (const invalid of ['abcd123', 'abcdefgh', '12345678', '!!!!1234', 'abcd!!!!']) {
    const result = await s.post('register', { name, email, password: invalid });
    assert.equal(result.status, 400); assert.match((await result.json()).error, /包含字母和数字/);
  }
  assert.equal(s.messages.length, 0);
  assert.equal((await s.post('register', { name, email, password: 'abcd1234' })).status, 200);
  assert.equal((await s.post('activate', { token: s.token() })).status, 200);
  assert.equal((await s.post('login', { email, password: 'abcd1234' }, new Map())).status, 200);
  s.cooldown(); await s.post('forgot-password', { email }); const token = s.token();
  for (const invalid of ['abcd123', 'abcdefgh', '12345678']) assert.equal((await s.post('reset', { token, password: invalid })).status, 400);
  assert.equal((await s.post('reset', { token, password: 'xyz98765' })).status, 200);
  assert.equal((await s.post('login', { email, password: 'xyz98765' }, new Map())).status, 200);
  assert.equal((await s.post('login', { email, password: 'abcd1234' }, new Map())).status, 400);
});
