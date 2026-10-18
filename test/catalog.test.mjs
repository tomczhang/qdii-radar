import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDirectory, isCandidate, parseProfile, getCatalog, discoverFunds } from '../server/catalog.mjs';
import { openStore } from '../server/store.mjs';
import { currentFund } from '../server/service.mjs';
const row = { code: '159999', directoryName: '纳指ETF嘉实' };
function html(code, target = '纳斯达克100指数', name = '嘉实纳斯达克100交易型开放式指数证券投资基金(QDII)') {
  return '<table><thead><tr><th>无关表头</th></tr></thead></table><table>' + Object.entries({ 基金全称: name, 基金代码: code + '（前端）', 基金管理人: '嘉实基金', 跟踪标的: target, 业绩比较基准: '标普500指数收益率*95%' }).map(([key,value]) => `<tr><th>${key}</th><td>${value}</tr>`).join('') + '</table>';
}
test('目录安全解析，短名候选不漏，拒绝代码重复与脚本', () => {
  assert.equal(parseDirectory('var r=[["159999","NZETF","纳指ETF嘉实","指数"]];')[0].code, '159999');
  assert.ok(isCandidate(row));
  assert.ok(!isCandidate({ directoryName: '纳斯达克100美元A' }));
  assert.throws(() => parseDirectory('var r=[]; process.exit()'));
  assert.throws(() => parseDirectory('var r=[["159999","","a"],["159999","","b"]]'));
});
test('按跟踪标的区分科技/等权，ETF与联接分类正确，兼容thead及缺省td闭合', () => {
  assert.equal(parseProfile(html(row.code), row).venue, 'etf');
  assert.equal(parseProfile(html(row.code, '纳斯达克科技市值加权指数'), row), null);
  assert.equal(parseProfile(html(row.code, '标普500等权重指数'), row), null);
  const linked = parseProfile(html('016532', '纳斯达克100指数', '嘉实纳斯达克100交易型开放式指数基金联接基金'), { code: '016532', directoryName: '嘉实纳斯达克100ETF发起联接(QDII)I人民币' });
  assert.equal(linked.venue, 'otc'); assert.equal(linked.share, 'I');
  assert.throws(() => parseProfile(html('000001'), row));
});
test('新增份额持久化去重，失败保留，动态目录重启可读；新份额不复制兄弟份额额度', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'radar-discover-'));let store=openStore(dir);
  const providers={ directory: async () => 'var r=[["159999","","纳指ETF嘉实"],["029999","","嘉实纳斯达克100ETF联接I"]];', profile: async code => html(code, '纳斯达克100指数', code === '159999' ? '嘉实纳斯达克100交易型开放式指数基金' : '嘉实纳斯达克100交易型开放式指数基金联接基金') };
  try {
    const before=getCatalog(store).length;
    const first=await discoverFunds(store,providers);assert.equal(first.added.length,2);
    const next=await discoverFunds(store,providers);assert.equal(next.added.length,0);
    assert.equal(getCatalog(store).length,before+2);
    const added=getCatalog(store).find(f=>f.code==='029999');assert.equal(currentFund(store,added).direct.status,'unknown');
    store.close();store=openStore(dir);assert.ok(getCatalog(store).some(f=>f.code==='029999'));
    assert.equal((await discoverFunds(store,{directory:async()=>{throw new Error('offline');}})).status,'failed');
    assert.equal(getCatalog(store).length,before+2);
    const etf=getCatalog(store).find(f=>f.code==='159999');
    store.saveSnapshot({...etf,observedAt:new Date().toISOString(),agency:{status:'paused',limit:10}});
    store.addRule({code:etf.code,channel:'direct',status:'open',limit:100,effectiveAt:'2020-01-01T00:00:00Z'});
    assert.equal(currentFund(store,etf).direct.status,'not_applicable');
    assert.equal(currentFund(store,etf).agency.status,'not_applicable');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
