import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { createMailService } from '../server/mail.mjs';
import { createApplication } from '../server/index.mjs';

test('真实订阅接口：会话隔离、校验、邮件验证、通知去重、退订、持久化', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'radar-api-'));
  process.env.MAIL_TRANSPORT = 'file';
  process.env.PUBLIC_BASE_URL = 'http://localhost:4387';
  const store = openStore(dir), mail = createMailService(store);
  const runtime = await createApplication({ store, mail, startJobs: false, development: false });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function request(url, method = 'GET', body, extra = {}) {
    const res = await fetch(root + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!cookie) cookie = res.headers.get('set-cookie')?.split(';')[0]; return res;
  }
  try {
    const dashboardResponse = await request('/api/dashboard', 'GET', undefined, {
      'X-WX-SERVICE': 'tcbanyservice', 'X-AnyService-Name': 'dashboard',
    });
    assert.equal(dashboardResponse.status, 200);
    assert.equal(dashboardResponse.headers.get('set-cookie'), null, 'public dashboard must not create a browser identity');
    const board = await dashboardResponse.json();
    assert.ok(Array.isArray(board.funds) && board.funds.length > 0);
    assert.ok(Array.isArray(board.changes));
    assert.equal(board.meta.mode, 'live');
    const input = { email: 'owner@example.test', code: '000834', channels: ['direct'], events: ['increase', 'resume'] };
    assert.equal((await request('/api/subscriptions', 'POST', { ...input, email: 'not-an-email' })).status, 400);
    assert.equal((await request('/api/subscriptions', 'POST', input, { Origin: 'https://attacker.example' })).status, 403);
    const created = await (await request('/api/subscriptions', 'POST', input)).json();
    assert.equal(created.verified, false);
    assert.equal(created.deliveryStatus, 'pending_verification');
    const alien = await fetch(root + '/api/subscriptions'); assert.deepEqual((await alien.json()).subscriptions, []);
    const deletion = await fetch(root + '/api/subscriptions/' + created.id, { method: 'DELETE' }); assert.equal(deletion.status, 404);
    const event = { id: 'event-1', code: '000834', name: '大成', channel: '直销', channelKey: 'direct', before: '10元', after: '100元', type: 'increase', sourceUrl: 'https://example.test/notice', effectiveAt: new Date().toISOString(), createdAt: new Date(Date.now() + 1000).toISOString() };
    mail.queueEvent(event);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM outbox WHERE id LIKE 'event:%'").get().n, 0);
    await mail.deliver();
    // HTTP handler may already own the delivery lease; wait for that bounded local worker.
    for (let i = 0; i < 20 && !fs.existsSync(path.join(dir, 'mailbox')); i++) await new Promise(r => setTimeout(r, 10));
    const first = JSON.parse(fs.readFileSync(path.join(dir, 'mailbox', fs.readdirSync(path.join(dir, 'mailbox'))[0])));
    const token = first.text.match(/verify\?token=([a-f0-9]+)/)[1];
    assert.equal((await request('/verify?token=' + token)).status, 200);
    assert.equal((await request('/api/subscriptions')).status, 200);
    assert.equal(mail.list(store.db.prepare('SELECT owner FROM subscriptions').get().owner)[0].verified, false, 'GET preview must not verify');
    assert.equal((await request('/api/subscriptions/verify', 'POST', { token })).status, 200);
    assert.equal((await request('/api/subscriptions/verify', 'POST', { token })).status, 400, 'single-use token');
    mail.queueEvent(event); mail.queueEvent(event); await mail.deliver();
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM outbox WHERE id LIKE 'event:%'").get().n, 1);
    const messages = fs.readdirSync(path.join(dir, 'mailbox')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'mailbox', f))));
    assert.equal(messages.length, 2, 'verification plus one change notification');
    const notify = messages.find(m => m.subject.includes('额度'));
    const params = new URL(notify.text.match(/http:\/\/localhost:4387\/unsubscribe[^\s]+/)[0]).searchParams;
    assert.equal((await request('/api/unsubscribe', 'POST', { id: params.get('id'), token: params.get('token') })).status, 200);
    assert.equal((await (await request('/api/subscriptions')).json()).subscriptions.length, 0);
    assert.equal((await request('/api/admin/status')).status, 401);
    const b = await (await request('/api/subscriptions', 'POST', { ...input, code: 'all' })).json();
    assert.ok(b.id);
    const reopened = openStore(dir); assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM subscriptions').get().n, 1); reopened.close();
  } finally { await new Promise(resolve => server.close(resolve)); await runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MAIL_TRANSPORT; }
});

test('同邮箱全局与单基金订阅去重，修改收件人后取消旧事件投递', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'radar-dedup-'));
  process.env.MAIL_TRANSPORT = 'file';
  const store = openStore(dir), mail = createMailService(store);
  try {
    const input = { email: 'dedup@example.test', code: '000834', channels: ['direct'], events: ['increase'] };
    const specific = mail.saveSubscription('owner', input);
    mail.saveSubscription('owner', { ...input, code: 'all' });
    store.db.prepare('UPDATE subscriptions SET verified=1').run();
    const event = { id: 'dedup-event', code: '000834', name: '大成', channel: '直销', channelKey: 'direct', before: '10元', after: '100元', type: 'increase', sourceUrl: 'https://example.test/notice', effectiveAt: new Date().toISOString(), createdAt: new Date(Date.now() + 1000).toISOString() };
    mail.queueEvent(event); mail.queueEvent(event);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM outbox WHERE id LIKE 'event:%'").get().n, 1);
    mail.saveSubscription('owner', { ...input, email: 'new@example.test' }, specific.id);
    store.db.prepare('UPDATE subscriptions SET verified=1').run();
    await mail.deliver();
    assert.equal(store.db.prepare("SELECT state FROM outbox WHERE id LIKE 'event:%'").get().state, 'cancelled');
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MAIL_TRANSPORT; }
});

test('运行中新发现的份额可订阅，场内ETF拒绝场外额度订阅', async () => {
  const dir=fs.mkdtempSync(path.join(tmpdir(),'radar-dynamic-api-'));
  process.env.MAIL_TRANSPORT='disabled';
  const store=openStore(dir),mail=createMailService(store);
  const runtime=await createApplication({store,mail,startJobs:false,development:false});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${server.address().port}`;
  try {
    store.setMeta('catalog:funds',[{code:'029999',name:'新增纳斯达克100',share:'I',manager:'测试基金',index:'nasdaq',venue:'otc'}]);
    const board=await(await fetch(root+'/api/dashboard')).json();
    assert.ok(board.funds.some(f=>f.code==='029999'));
    const post=code=>fetch(root+'/api/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.test',code,channels:['direct'],events:['resume']})});
    assert.equal((await post('029999')).status,201);
    assert.equal((await post('513100')).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));await runtime.close();fs.rmSync(dir,{recursive:true,force:true});delete process.env.MAIL_TRANSPORT;}
});
