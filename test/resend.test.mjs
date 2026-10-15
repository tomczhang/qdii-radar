import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createResendTransport} from '../server/resend.mjs';
import {createMailService} from '../server/mail.mjs';
import {openStore} from '../server/store.mjs';

const message={from:'额度雷达 <newsletter@example.test>',to:'reader@example.test',subject:'额度提醒',text:'真实事件示例',headers:{'List-Unsubscribe':'<https://example.test/unsubscribe>'}};

test('Resend HTTP结构、认证、幂等Key、响应ID正确；不会调用外部网络', async()=>{
 let request;
 const sender=createResendTransport({apiKey:'fake-key',fetchImpl:async(url,options)=>{request={url,...options};return Response.json({id:'provider-message'});}});
 const result=await sender.sendMail(message,'qdii-radar/test');
 assert.equal(request.url,'https://api.resend.com/emails');
 assert.equal(request.headers.Authorization,'Bearer fake-key');
 assert.equal(request.headers['Idempotency-Key'],'qdii-radar/test');
 assert.equal(request.redirect,'error');
 assert.deepEqual(JSON.parse(request.body),{...message,to:[message.to]});
 assert.equal(result.messageId,'provider-message');
});

test('Resend永久失败、429 Retry-After和幂等冲突分类，错误不泄漏服务商正文',async()=>{
 for(const [status,name,permanent] of [[403,'validation_error',true],[409,'invalid_idempotent_request',true],[409,'concurrent_idempotent_requests',false],[429,'rate_limit_exceeded',false],[503,'unavailable',false]]){
  const sender=createResendTransport({apiKey:'fake-key',fetchImpl:async()=>Response.json({name,message:'private-address-and-key'},{status,headers:{'Retry-After':'125'}})});
  await assert.rejects(()=>sender.sendMail(message,'key'),error=>{assert.equal(error.permanent,permanent);assert.equal(error.code,`resend_http_${status}`);assert.ok(!error.message.includes('private-address'));if(status===429)assert.equal(error.retryAfterMs,125000);return true;});
 }
});

test('Resend队列持久化请求、恢复后重复请求不变、冷却全队列、超窗不再投递',async()=>{
 const original={...process.env}; const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-resend-'));const store=openStore(dir);
 Object.assign(process.env,{MAIL_TRANSPORT:'resend',RESEND_API_KEY:'fake-key',RESEND_FROM:message.from,PUBLIC_BASE_URL:'https://example.test'});
 const requests=[];let throttle=true;
 const fetchImpl=async(url,options)=>{requests.push(options);return throttle?Response.json({name:'rate_limit_exceeded'},{status:429,headers:{'Retry-After':'120'}}):Response.json({id:'provider-id'});};
 try{
  const mail=createMailService(store,{fetchImpl});
  mail.saveSubscription('owner',{email:message.to,code:'000834',channels:['direct'],events:['increase']});
  await mail.deliver();
  let job=store.db.prepare('SELECT * FROM outbox').get();
  assert.equal(job.state,'retry');assert.ok(job.request_payload);assert.ok(job.first_attempt_at);
  await mail.deliver();assert.equal(requests.length,1,'429 cools all sends');
  store.setMeta('resendCooldownUntil',0);store.db.prepare('UPDATE outbox SET next_at=?').run('2000-01-01T00:00:00Z');throttle=false;
  process.env.RESEND_FROM='changed@example.test';
  const restarted=createMailService(store,{fetchImpl});await restarted.deliver();
  assert.equal(requests.length,2);
  assert.equal(requests[0].body,requests[1].body,'retries keep original from and body even after config changes');
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  job=store.db.prepare('SELECT * FROM outbox').get();assert.equal(job.state,'sent');assert.equal(job.provider_id,'provider-id');
  store.db.prepare("UPDATE outbox SET state='retry',next_at=?,first_attempt_at=?").run('2000-01-01T00:00:00Z','2000-01-01T00:00:00Z');
  await restarted.deliver();assert.equal(requests.length,2);assert.equal(store.db.prepare('SELECT state FROM outbox').get().state,'failed');
 } finally{store.close();fs.rmSync(dir,{recursive:true,force:true});for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});

test('只有Key缺少发件人时不可启用，disabled显式关闭',()=>{
 const original={...process.env};const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-mail-config-'));const store=openStore(dir);
 try{
  Object.assign(process.env,{MAIL_TRANSPORT:'resend',RESEND_API_KEY:'fake-key',PUBLIC_BASE_URL:'https://example.test'});delete process.env.RESEND_FROM;
  let mail=createMailService(store);assert.equal(mail.configured,false);assert.ok(mail.status().missing.includes('发件人地址'));
  process.env.RESEND_FROM=message.from;assert.equal(createMailService(store).configured,true);
  process.env.MAIL_TRANSPORT='disabled';assert.equal(createMailService(store).configured,false);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
