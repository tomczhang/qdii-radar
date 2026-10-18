import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolveShareScope,attachShareScopes,shareScopeAudit} from '../server/share-scopes.mjs';
import {sumQuotaRows} from '../shared/quota-scope.mjs';
import {totalQuota,totalHistoricalQuota} from '../src/summary.mjs';
import {purchaseCandidates,selectedCandidates,calculatePurchasePlan,planSignature} from '../src/purchase-plan.mjs';
const now=new Date('2026-10-16T12:00:00+08:00');
const fund=(code,amount=100)=>({code,share:code==='019441'?'A':'C',name:'万家纳指',manager:'万家',index:'nasdaq',agency:{status:'open',limit:10},direct:{status:'open',limit:amount}});
test('Audit covers all 55 OTC shares, evidence hashes match reviewed documents',()=>{
 assert.equal(new Set(shareScopeAudit.families.flatMap(f=>f.codes)).size,55);
 for(const r of shareScopeAudit.rules){const t=fs.readFileSync(new URL(`./fixtures/share-scope/${r.noticeId}.txt`,import.meta.url));assert.equal(createHash('sha256').update(t).digest('hex'),r.textHash);assert.ok(r.evidence&&r.sourceUrl);}
});
test('Shared pools clamp totals and planner; independent shares remain separate',()=>{
 const f=attachShareScopes([fund('019441'),fund('019442')],[],now);
 assert.equal(totalQuota(f,'direct').amount,100);assert.equal(totalQuota(f,'agency').amount,10);
 const groups=purchaseCandidates(f,'direct');assert.equal(groups.length,1);assert.equal(groups[0].options.length,2);
 assert.equal(selectedCandidates(groups).reduce((s,r)=>s+r.limit,0),100);
 const south=attachShareScopes([fund('016452',10),fund('016453',10),fund('021000',200)],[],now);
 assert.equal(totalQuota(south,'direct').amount,220);assert.equal(purchaseCandidates(south,'direct').length,3);
 assert.equal(selectedCandidates(purchaseCandidates(south,'direct')).reduce((s,r)=>s+r.limit,0),220);
 const h=attachShareScopes(['019524','019525','022664'].map(c=>fund(c,5)),[],now);assert.equal(totalQuota(h,'direct').amount,5);assert.equal(purchaseCandidates(h,'direct').length,1);
});
test('Historical independence switches to sharing on effective date, never halves whole window',()=>{
 const dates=['2026-09-22','2026-09-23','2026-09-24'];
 const fs=['019441','019442'].map(code=>({...fund(code),stability:{calendarReady:true,windowDays:20,startDate:dates[0],endDate:dates.at(-1),direct:{daily:dates.map(date=>({date,status:'open',limit:100}))}}}));
 const f=attachShareScopes(fs,[],now);
 assert.equal(totalHistoricalQuota(f,'direct').amount,400); // 200 + 100 + 100
 assert.equal(resolveShareScope('019441','direct','2026-09-22').mode,'independent');
 assert.equal(resolveShareScope('019441','direct','2026-09-23').mode,'shared');
 assert.equal(resolveShareScope('019524','direct','2026-09-21').cap,10);
 assert.equal(resolveShareScope('019524','direct','2026-09-22').cap,5);
});
test('No explicit sharing defaults to independence; paused remains zero; missing amount stays unknown',()=>{
 const f=attachShareScopes([fund('000834'),fund('008971')],[],now);
 assert.equal(totalQuota(f,'direct').amount,200);assert.equal(totalQuota(f,'agency').amount,20);assert.equal(purchaseCandidates(f,'direct').length,2);assert.equal(f[0].direct.scope.basis,'default');
 f[0].direct.status='paused';assert.equal(totalQuota(f,'direct').amount,100);
 const w=attachShareScopes([fund('019441'),{...fund('019442'),direct:{status:'unknown',limit:null}}],[],now);
 assert.equal(totalQuota(w,'direct').amount,100);assert.equal(totalQuota(w,'direct').unknown,1);
 assert.equal(resolveShareScope('new-share','direct','2026-10-16').mode,'independent');
});
test('New notices invalidate entire sibling group without rewriting pre-notice history; stale plans invalidate',()=>{
 const notice={id:'AN-NEW',code:'019442',publishedAt:'2026-10-16',title:'调整大额申购限制公告',sourceUrl:'https://example.com'};
 const f=[fund('019441'),fund('019442')],before=attachShareScopes(f,[],now),after=attachShareScopes(f,[notice],now);
 assert.equal(after[0].direct.scope.mode,'unknown');assert.notEqual(planSignature(selectedCandidates(purchaseCandidates(before,'direct'))),planSignature(selectedCandidates(purchaseCandidates(after,'direct'))));
 assert.equal(resolveShareScope('019441','direct','2026-10-15',[notice]).mode,'shared');
});
test('Conflicting shared caps fail closed; same group cannot enter planner twice under different IDs',()=>{
 const scope={mode:'shared',groupId:'direct:test',cap:100};
 assert.equal(sumQuotaRows([{code:'a',quota:{status:'open',limit:100,scope}},{code:'b',quota:{status:'open',limit:200,scope:{...scope,cap:200}}}]).amount,null);
 assert.throws(()=>calculatePurchasePlan({amount:1000,ratio:100,mode:'fast',channel:'direct'},[{id:'a',code:'a',index:'nasdaq',limit:100,scope},{id:'b',code:'b',index:'nasdaq',limit:100,scope}]),/共享额度/);
});

test('Default independence applies to history without revoking explicit sharing',()=>{
 const f=attachShareScopes(['000834','008971'].map(code=>({...fund(code),stability:{calendarReady:true,windowDays:20,startDate:'2026-10-15',endDate:'2026-10-15',direct:{daily:[{date:'2026-10-15',status:'open',limit:100}]}}})),[],now);
 assert.equal(totalHistoricalQuota(f,'direct').amount,200);
 const registry={families:[{codes:['x'],scanComplete:true,reviewedThrough:'2026-10-16',reviewedNoticeIds:[]}],rules:[{id:'shared',codes:['x'],channels:['direct'],from:'2026-09-01',mode:'shared',groupId:'pool',limits:{direct:100}},{id:'amount-only',codes:['x'],channels:['direct'],from:'2026-10-01',mode:'unknown'}]};
 assert.equal(resolveShareScope('x','direct','2026-10-16',[],registry).mode,'shared');
});

test('Dacheng user confirmation changes provenance, preserves capacity and earlier history',async()=>{
 const {groupFunds,shareRuleBadge}=await import('../src/fund-groups.mjs');
 const raw=['000834','008971'].map(code=>({...fund(code),name:'大成纳斯达克100',manager:'大成',channelScope:{mode:'independent'}}));
 const before=attachShareScopes(raw,[],now),after=attachShareScopes(raw,[],new Date('2026-10-17T12:00:00+08:00'));
 for(const f of after)for(const c of ['agency','direct']) {
  assert.equal(f[c].scope.mode,'independent');assert.equal(f[c].scope.basis,'user_confirmed');
  assert.match(f[c].scope.evidence,/用户于2026-10-17确认/);assert.equal(f[c].scope.sourceUrl,undefined);
 }
 assert.equal(shareRuleBadge(groupFunds(after)[0]).label,'份额独立');
 assert.equal(totalQuota(after,'both').amount,220);assert.equal(totalQuota(before,'both').amount,220);
 assert.equal(resolveShareScope('000834','direct','2026-10-16').basis,'default');
 const notice={id:'AN-NEW-DACHENG',code:'008971',publishedAt:'2026-10-18',title:'调整大额申购限制公告',sourceUrl:'https://example.com'};
 assert.equal(resolveShareScope('000834','direct','2026-10-18',[notice]).mode,'unknown');
});
