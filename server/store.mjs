import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { digest } from './domain.mjs';

export function openStore(location = process.env.DATA_DIR || '.data') {
  fs.mkdirSync(location, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(location, 'radar.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (code TEXT PRIMARY KEY, payload TEXT NOT NULL, observed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, code TEXT NOT NULL, channel TEXT NOT NULL, effective_at TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rule_lookup ON rules(code,channel,effective_at);
    CREATE TABLE IF NOT EXISTS notices (id TEXT NOT NULL, code TEXT NOT NULL, published_at TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,code));
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, code TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, email TEXT NOT NULL, code TEXT NOT NULL, payload TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, verify_hash TEXT, unsubscribe_hash TEXT, expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS subscription_owner ON subscriptions(owner);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, payload TEXT NOT NULL, error TEXT, sent_at TEXT);
    CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  `);
  const outboxColumns = new Set(db.prepare('PRAGMA table_info(outbox)').all().map(c => c.name));
  for (const name of ['transport', 'first_attempt_at', 'request_payload', 'provider_id']) {
    if (!outboxColumns.has(name)) db.exec(`ALTER TABLE outbox ADD COLUMN ${name} TEXT`);
  }
  fs.chmodSync(path.join(location, 'radar.sqlite'), 0o600);
  const parse = row => row ? JSON.parse(row.payload) : null;
  return {
    db, directory: location,
    getMeta(key) { const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key); return r ? JSON.parse(r.value) : null; },
    setMeta(key, value) { db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    snapshot(code) { return parse(db.prepare('SELECT * FROM snapshots WHERE code=?').get(code)); },
    snapshots() { return db.prepare('SELECT * FROM snapshots').all().map(parse); },
    saveSnapshot(value) { db.prepare('INSERT INTO snapshots VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at').run(value.code, JSON.stringify(value), value.observedAt); },
    addRule(rule) { const id = rule.id || digest(JSON.stringify([rule.code, rule.channel, rule.effectiveAt, rule.sourceUrl, rule.status, rule.limit])); db.prepare('INSERT OR IGNORE INTO rules VALUES(?,?,?,?,?,?)').run(id, rule.code, rule.channel, new Date(rule.effectiveAt).toISOString(), JSON.stringify({ ...rule, id }), new Date().toISOString()); return id; },
    activeRule(code, channel, now = new Date()) { return parse(db.prepare('SELECT * FROM rules WHERE code=? AND channel=? AND effective_at<=? ORDER BY effective_at DESC,created_at DESC LIMIT 1').get(code, channel, now.toISOString())); },
    notice(id, code) { return parse(db.prepare('SELECT * FROM notices WHERE id=? AND code=?').get(id, code)); },
    saveNotice(notice) { db.prepare('INSERT INTO notices VALUES(?,?,?,?,?) ON CONFLICT(id,code) DO UPDATE SET state=excluded.state,payload=excluded.payload,published_at=excluded.published_at').run(notice.id, notice.code, notice.publishedAt, notice.state, JSON.stringify(notice)); },
    pendingNotices(code) { return db.prepare("SELECT * FROM notices WHERE code=? AND state IN ('pending_review','fetch_error') ORDER BY published_at DESC").all(code).map(parse); },
    notices(limit = 100) { return db.prepare('SELECT * FROM notices ORDER BY published_at DESC LIMIT ?').all(limit).map(parse); },
    addEvent(event) { const result = db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?)').run(event.id, event.code, event.createdAt, JSON.stringify(event)); return !!result.changes; },
    events(limit = 100) { return db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?').all(limit).map(parse); },
    acquireLease(name, duration = 30 * 60 * 1000) { return !!db.prepare('INSERT INTO leases VALUES(?,?) ON CONFLICT(name) DO UPDATE SET expires=excluded.expires WHERE leases.expires<?').run(name, Date.now() + duration, Date.now()).changes; },
    releaseLease(name) { db.prepare('DELETE FROM leases WHERE name=?').run(name); },
    close() { db.close(); },
  };
}
