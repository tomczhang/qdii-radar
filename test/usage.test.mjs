import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageTracker } from '../src/usage.mjs';

const websiteId = '12345678-1234-1234-1234-123456789abc';
function setup(id = websiteId) {
  const scripts = [], events = [], requests = [];
  const environment = {
    fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ umamiWebsiteId: id }) }; },
    document: {
      createElement: () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }),
      head: { appendChild: script => scripts.push(script) },
    },
    umami: { track: callback => events.push(callback({ website: websiteId, url: '/?secret=private', referrer: 'https://example.test/?token=private' })) },
  };
  return { environment, scripts, events, requests, tracker: createUsageTracker(environment) };
}

test('slow script preserves initial PV and clicks; repeated effects do not duplicate PV or script', async () => {
  const { tracker, scripts, events, requests } = setup();
  tracker.pageView('overview'); tracker.pageView('overview');
  tracker.tabClick('navigation', 'changes', 'overview');
  tracker.pageView('changes'); tracker.pageView('changes');
  await Promise.all([tracker.init(), tracker.init()]);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://cloud.umami.is/script.js');
  assert.equal(scripts[0].attributes['data-auto-track'], 'false');
  assert.equal(events.length, 0);
  scripts[0].onload();
  assert.equal(events.filter(e => !e.name).length, 2);
  assert.deepEqual(events.map(e => e.url), ['/', '/', '/changes']);
  tracker.pageView('overview');
  assert.equal(events.filter(e => !e.name).length, 3);
  assert.deepEqual(requests, ['/api/public-config']);
  assert.ok(events.every(e => e.referrer === '' && !e.url.includes('?')));
  assert.ok(events.every(e => !e.data || Object.keys(e.data).every(k => ['group', 'tab'].includes(k))));
});

test('absent/invalid config, script blocking and failed tracking never disrupt the app', async () => {
  for (const id of [null, '', 'invalid']) {
    const s = setup(id); s.tracker.pageView('overview'); await s.tracker.init();
    s.tracker.pageView('changes'); assert.equal(s.scripts.length, 0); assert.equal(s.events.length, 0);
  }
  const s = setup(); await s.tracker.init(); s.scripts[0].onerror();
  s.tracker.pageView('changes'); assert.equal(s.events.length, 0);
  const failed = setup(); failed.environment.fetch = async () => { throw Error('offline'); };
  await failed.tracker.init(); assert.equal(failed.scripts.length, 0);
  const broken = setup(); await broken.tracker.init(); broken.scripts[0].onload();
  broken.environment.umami.track = () => { throw Error('blocked'); };
  assert.doesNotThrow(() => broken.tracker.pageView('changes'));
  broken.environment.umami.track = () => Promise.reject(Error('offline'));
  broken.tracker.pageView('changes'); await new Promise(resolve => setImmediate(resolve));
});

test('tab events use a bounded vocabulary and never accept arbitrary form values', async () => {
  const s = setup(); await s.tracker.init(); s.scripts[0].onload();
  s.tracker.tabClick('venue', 'etf', 'overview');
  s.tracker.tabClick('index', 'nasdaq', 'overview');
  s.tracker.tabClick('input', '10000', 'calculator');
  s.tracker.pageView('private-value');
  assert.deepEqual(s.events.map(e => e.name), ['tab_venue_etf', 'tab_index_nasdaq']);
});
