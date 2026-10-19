// Isolated protocol fixture; never creates users or sends mail to a real provider.
import express from 'express';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export async function startOidcProvider({ hostname = '127.0.0.1' } = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', use: 'sig', alg: 'RS256' };
  const codes = new Map(), requests = [];
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const issuer = `http://${hostname}:${server.address().port}/realms/test`;
  const provider = { issuer, requests, profile: { sub: 'person-1', email: 'person@example.test', email_verified: true, name: '雷达用户' },
    claims: {}, badSignature: false, allowedRedirect: null, clientId: 'qdii-radar', clientSecret: 'fixture-secret', failDiscovery: false,
    close: () => new Promise(resolve => server.close(resolve)) };
  app.get('/realms/test/.well-known/openid-configuration', (req, res) => {
    if (provider.failDiscovery) return res.status(503).json({ error: 'unavailable' });
    res.json({ issuer, authorization_endpoint: `${issuer}/protocol/openid-connect/auth`, token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/certs`, end_session_endpoint: `${issuer}/logout`, response_types_supported: ['code'],
      subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
  });
  app.get('/realms/test/certs', (req, res) => res.json({ keys: [publicJwk] }));
  provider.issueCode = target => {
    const params = new URL(target).searchParams;
    const code = randomBytes(20).toString('hex');
    codes.set(code, { redirect: params.get('redirect_uri'), challenge: params.get('code_challenge'), nonce: params.get('nonce') });
    const result = new URL(params.get('redirect_uri'));
    result.searchParams.set('code', code); result.searchParams.set('state', params.get('state'));
    result.searchParams.set('iss', issuer);
    return result;
  };
  app.get(['/realms/test/protocol/openid-connect/auth', '/realms/test/protocol/openid-connect/registrations'], (req, res) => {
    if (req.query.client_id !== provider.clientId || req.query.redirect_uri !== provider.allowedRedirect || req.query.code_challenge_method !== 'S256' || !req.query.code_challenge || !req.query.state || !req.query.nonce) return res.status(400).send('Invalid authorization request');
    res.redirect(303, provider.issueCode(`${issuer.slice(0, issuer.indexOf('/realms'))}${req.originalUrl}`).href);
  });
  app.post('/realms/test/token', (req, res) => {
    requests.push(req.body);
    const flow = codes.get(req.body.code); codes.delete(req.body.code);
    if (!flow || req.body.client_id !== provider.clientId || req.body.client_secret !== provider.clientSecret || req.body.grant_type !== 'authorization_code' || req.body.redirect_uri !== flow.redirect || req.body.redirect_uri !== provider.allowedRedirect || createHash('sha256').update(req.body.code_verifier || '').digest('base64url') !== flow.challenge) return res.status(400).json({ error: 'invalid_grant' });
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: issuer, aud: provider.clientId, iat: now, exp: now + 300, nonce: flow.nonce, ...provider.profile, ...provider.claims };
    const message = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const jwt = `${message}.${sign('RSA-SHA256', Buffer.from(message), provider.badSignature ? wrongKey : privateKey).toString('base64url')}`;
    res.json({ token_type: 'Bearer', access_token: 'fixture-access-token', expires_in: 300, id_token: jwt });
  });
  app.get('/realms/test/logout', (req, res) => {
    if (req.query.post_logout_redirect_uri !== provider.allowedRedirect.replace('/auth/callback', '/auth/logout/callback')) return res.status(400).send('Invalid logout redirect');
    const target = new URL(req.query.post_logout_redirect_uri); target.searchParams.set('state', req.query.state); res.redirect(303, target.href);
  });
  return provider;
}
