import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { accountConfig, installAccountAuth } from '../server/auth.mjs';
import { authReturnTo } from '../shared/account.mjs';
import { openStore } from '../server/store.mjs';
import { startOidcProvider } from './fixtures/oidc-provider.mjs';

async function setup(t, { disabled = false, https = false } = {}) {
  const provider = await startOidcProvider();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-auth-'));
  const store = openStore(dir), app = express();
  app.use(express.urlencoded({ extended: false })); app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { origin: https ? 'https://radar.example.test' : base, issuer: provider.issuer, clientId: provider.clientId, clientSecret: provider.clientSecret };
  provider.allowedRedirect = `${config.origin}/auth/callback`;
  installAccountAuth(app, { store, config: disabled ? null : config, rateLimit: (req, res, next) => next() });
  app.get('/owner', (req, res) => res.json({ owner: req.owner }));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await provider.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const jar = new Map();
  const request = async (target, options = {}, cookies = jar) => {
    const url = target.startsWith('http') ? new URL(target).pathname + new URL(target).search : target;
    const response = await fetch(base + url, { ...options, redirect: 'manual', headers: { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...options.headers } });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) cookies.set(key, value); else cookies.delete(key);
    }
    return response;
  };
  const begin = async (route = '/auth/login') => {
    const response = await request(route);
    return { response, target: response.headers.get('location') };
  };
  const login = async () => {
    const { target } = await begin();
    const callback = provider.issueCode(target);
    const response = await request(callback.href);
    return { response, callback, session: await (await request('/api/auth/session')).json() };
  };
  const logout = (session, mode = 'local', extras = {}) => request('/api/auth/logout', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/x-www-form-urlencoded', ...extras }, body: new URLSearchParams({ csrf: session.csrfToken || '', mode }) });
  return { provider, store, dir, config, base, request, begin, login, logout, jar };
}

test('configuration is optional, complete, HTTPS-only in production and never accepts arbitrary return URLs', () => {
  assert.equal(accountConfig({}), null);
  assert.throws(() => accountConfig({ ACCOUNT_CENTER_CLIENT_ID: 'radar' }));
  const env = { ACCOUNT_CENTER_ISSUER: 'https://auth.example.test/realms/main', ACCOUNT_CENTER_CLIENT_ID: 'radar', ACCOUNT_CENTER_CLIENT_SECRET: 'secret', NODE_ENV: 'production' };
  assert.equal(accountConfig(env, 'https://radar.example.test').clientId, 'radar');
  for (const issuer of ['http://auth.example.test', 'http://localhost:8180', 'https://x:y@auth.example.test', 'https://auth.example.test?x=1']) assert.throws(() => accountConfig({ ...env, ACCOUNT_CENTER_ISSUER: issuer }, 'https://radar.example.test'));
  assert.throws(() => accountConfig(env, 'https://radar.example.test/subpath'));
  assert.ok(accountConfig({ ...env, NODE_ENV: 'development', ACCOUNT_CENTER_ISSUER: 'http://127.0.0.1:8180/realms/test' }, 'http://localhost:4387'));
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/auth/login', '/?page=calculator&token=private', ['/', '//evil.test']]) assert.equal(authReturnTo(value), '/');
  assert.equal(authReturnTo('/?page=calculator'), '/?page=calculator');
});

test('disabled account service is explicit and does not expose credentials', async t => {
  const s = await setup(t, { disabled: true });
  const response = await s.request('/api/auth/session');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { enabled: false, user: null, csrfToken: null, expiresAt: null, accountUrl: null });
  assert.equal((await s.request('/auth/login')).headers.get('location'), '/login?error=unavailable');
});

test('authorization uses PKCE/state/nonce, exact callbacks and secure cookies; registration uses Keycloak endpoint', async t => {
  const s = await setup(t, { https: true });
  const { response, target } = await s.begin('/auth/register?returnTo=https://evil.test');
  const url = new URL(target);
  assert.ok(url.pathname.endsWith('/registrations'));
  assert.equal(url.searchParams.get('client_id'), 'qdii-radar');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://radar.example.test/auth/callback');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('nonce')); assert.ok(url.searchParams.get('state'));
  assert.ok(!url.search.includes('secret'));
  assert.match(response.headers.get('set-cookie'), /__Host-radar_auth=.*HttpOnly; SameSite=Lax.*Secure/);
  const done = await s.request(s.provider.issueCode(target).href);
  assert.equal(done.headers.get('location'), '/');
  assert.ok(done.headers.getSetCookie().some(c => c.startsWith('__Host-radar_session=') && c.includes('Secure') && !c.includes('Domain=')));
});

test('signed OIDC flow persists identity/session, rotates sessions and returns to calculator without leaking tokens', async t => {
  const s = await setup(t);
  const { target } = await s.begin('/auth/login?returnTo=%2F%3Fpage%3Dcalculator');
  const callback = s.provider.issueCode(target);
  const response = await s.request(callback.href);
  assert.equal(response.headers.get('location'), '/?page=calculator');
  const session = await (await s.request('/api/auth/session')).json();
  assert.equal(session.user.email, 'person@example.test');
  assert.ok(session.csrfToken);
  assert.ok(!JSON.stringify(session).includes('fixture-access-token'));
  assert.ok(!Object.keys(session).some(k => /id_token|secret|verifier/.test(k)));
  const oldCookie = new Map(s.jar);
  const db2 = openStore(s.dir);
  assert.equal(db2.db.prepare('SELECT COUNT(*) n FROM account_sessions').get().n, 1); db2.close();
  assert.equal((await s.request(callback.href)).headers.get('location'), '/login?error=expired');
  assert.equal(s.provider.requests.length, 1, 'replay must not reach token endpoint');
  s.provider.profile.email = 'changed@example.test';
  const next = await s.login();
  assert.equal(next.session.user.id, session.user.id, 'identity follows issuer+sub across email changes');
  assert.equal(next.session.user.email, 'changed@example.test');
  assert.equal((await (await s.request('/api/auth/session', {}, oldCookie)).json()).user, null, 'rotated session is invalid');
  const owner = (await (await s.request('/owner')).json()).owner;
  s.provider.profile.sub = 'another-person';
  const other = await s.login();
  assert.notEqual(other.session.user.id, session.user.id, 'same email must not auto-link identities');
  assert.notEqual((await (await s.request('/owner')).json()).owner, owner);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM account_users').get().n, 2);
});

test('forged state, missing browser binding, expired flows and altered PKCE cannot log in', async t => {
  const s = await setup(t);
  let flow = await s.begin();
  let callback = s.provider.issueCode(flow.target); callback.searchParams.set('state', 'forged');
  assert.equal((await s.request(callback.href)).headers.get('location'), '/login?error=failed');
  assert.equal(s.provider.requests.length, 0);
  flow = await s.begin(); callback = s.provider.issueCode(flow.target);
  assert.equal((await s.request(callback.href, {}, new Map())).headers.get('location'), '/login?error=expired');
  s.store.db.prepare('UPDATE account_flows SET expires=0').run();
  assert.equal((await s.request(callback.href)).headers.get('location'), '/login?error=expired');
  flow = await s.begin(); callback = s.provider.issueCode(flow.target);
  s.store.db.prepare("UPDATE account_flows SET payload=json_set(payload,'$.verifier','wrong')").run();
  assert.equal((await s.request(callback.href)).headers.get('location'), '/login?error=failed');
  assert.equal((await (await s.request('/api/auth/session')).json()).user, null);
});

test('invalid nonce, issuer, audience, expiry, signature and unverified email are rejected', async t => {
  const s = await setup(t);
  for (const change of [{ nonce: 'wrong' }, { iss: 'https://evil.test' }, { aud: 'another-product' }, { exp: 1 }, { email_verified: false }, { email: null }, { badSignature: true }]) {
    s.provider.badSignature = !!change.badSignature;
    s.provider.claims = change.badSignature ? {} : change;
    const { response, session } = await s.login();
    assert.match(response.headers.get('location'), /^\/login\?error=(failed|unverified)$/);
    assert.equal(session.user, null, JSON.stringify(change));
  }
  assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM account_users').get().n, 0);
});

test('a consumed authorization code is refused even with a new valid flow cookie', async t => {
  const s = await setup(t);
  const first = await s.login();
  await s.logout(first.session);
  const second = await s.begin();
  const callback = new URL(first.callback); callback.searchParams.set('state', new URL(second.target).searchParams.get('state'));
  assert.equal((await s.request(callback.href)).headers.get('location'), '/login?error=failed');
  assert.equal((await (await s.request('/api/auth/session')).json()).user, null);
});

test('logout enforces Origin and CSRF, revokes local sessions, and verifies single-use global logout state', async t => {
  const s = await setup(t);
  let { session } = await s.login();
  assert.equal((await s.logout(session, 'local', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await s.logout(session, 'local', { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await s.logout(session, 'local', { Origin: 'null' })).status, 403);
  assert.equal((await s.logout({ ...session, csrfToken: 'invalid' })).status, 403);
  assert.equal((await s.logout({ ...session, csrfToken: '中'.repeat(session.csrfToken.length) })).status, 403);
  assert.equal((await s.logout(session, 'invalid')).status, 400);
  const oldCookie = new Map(s.jar);
  assert.equal((await s.logout(session, 'local', { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' })).headers.get('location'), '/login?loggedOut=1');
  assert.equal((await (await s.request('/api/auth/session', {}, oldCookie)).json()).user, null);
  ({ session } = await s.login());
  const global = await s.logout(session, 'global');
  const target = new URL(global.headers.get('location'));
  assert.equal(target.origin, new URL(s.provider.issuer).origin);
  assert.equal(target.searchParams.get('post_logout_redirect_uri'), `${s.base}/auth/logout/callback`);
  assert.ok(target.searchParams.get('id_token_hint'));
  assert.equal((await (await s.request('/api/auth/session')).json()).user, null);
  const callback = `/auth/logout/callback?state=${target.searchParams.get('state')}`;
  assert.equal((await s.request(callback)).headers.get('location'), '/login?loggedOut=1');
  assert.equal((await s.request(callback)).headers.get('location'), '/login?error=expired');
});

test('expired sessions do not authenticate and discovery failure can recover', async t => {
  const s = await setup(t);
  s.provider.failDiscovery = true;
  assert.equal((await s.begin()).target, '/login?error=unavailable');
  s.provider.failDiscovery = false;
  assert.ok((await s.login()).session.user);
  s.store.db.prepare('UPDATE account_sessions SET expires=0').run();
  assert.equal((await (await s.request('/api/auth/session')).json()).user, null);
});
