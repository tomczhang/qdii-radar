import test from 'node:test';
import assert from 'node:assert/strict';
import { miniappDashboard } from '../server/miniapp-dashboard.mjs';

test('miniapp keeps quota semantics and dates without exceeding the gateway limit on a large board', () => {
  const evidence = '公告证据'.repeat(10000);
  const board = {
    funds: Array.from({ length: 100 }, (_, i) => ({
      code: String(i).padStart(6, '0'), name: '测试基金', share: 'A', venue: 'otc', index: 'nasdaq',
      agency: { status: 'unknown', limit: null, evidence }, direct: { status: 'open', limit: 100, evidence },
      returns: { y1: null, y3: 12.5, y5: 0 }, returnsAsOf: '2026-10-16',
      quote: { premium: 0, date: '2026-10-16', raw: evidence },
      stability: { history: evidence }, trend: [1, 2], dataIssues: [{ detail: evidence }], stale: true
    })),
    changes: [{ id: 'one', code: '000001', before: '暂停申购', after: '100 元', effectiveAt: '2026-10-19', evidence }],
    meta: { updatedAt: '2026-10-19T08:30:00Z', changesCoverage: { complete: false, pending: [evidence] } }
  };
  const compact = miniappDashboard(board);
  const serialized = JSON.stringify(compact);
  assert.ok(Buffer.byteLength(JSON.stringify(board)) > 1000000);
  assert.ok(Buffer.byteLength(serialized) < 100000, '100 funds leave substantial room below the 1000KB limit');
  assert.equal(compact.funds.length, 100);
  assert.deepEqual(compact.funds[0].agency, { status: 'unknown', limit: null });
  assert.equal(compact.funds[0].direct.limit, 100);
  assert.deepEqual(compact.funds[0].returns, board.funds[0].returns);
  assert.equal(compact.funds[0].quote.premium, 0);
  assert.equal(compact.funds[0].quote.date, '2026-10-16');
  assert.equal(compact.funds[0].dataIssueCount, 1);
  assert.equal(compact.meta.changesCoverage.complete, false);
  assert.equal(compact.changes[0].effectiveAt, '2026-10-19');
  assert.equal(serialized.includes('公告证据'), false);
  assert.equal(board.funds[0].agency.evidence, evidence, 'website response stays untouched');
});
