#!/usr/bin/env node
// Tests for the traffic counter: the pageview log in _worker.js, /api/track,
// and the /api/admin/traffic read that powers the Traffic section of /admin.
//   node tools/test-analytics.mjs
//
// Two things here are load-bearing and everything below exists to protect them.
//
// First, COUNTING MUST NEVER COST A PAGE VIEW. The insert runs inside
// ctx.waitUntil() off the response path, and a D1 that is slow, missing, or
// throwing has to leave the visitor with the same HTML they would have got
// anyway. A blank page is a far worse outcome than a missing row.
//
// Second, the NUMBERS MUST NOT LIE. Bots, prefetches and the admin's own visits
// are not people reading the site, and a visitor is a daily-rotating salted hash
// — the same person on the same day is one visitor, and no row can be walked
// back to an IP. If these drift the dashboard quietly overstates the site.
//
// Like the other worker tests this drives the REAL _worker.js over an in-memory
// SQLite standing in for D1, so it cannot drift from what deploys.

import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const worker = (await import(path.join(ROOT, '_worker.js'))).default;

// The worker creates its tables once per isolate and then caches that it has,
// so only the FIRST database here exercises that lazy creation — every later
// one is handed the same schema up front, read out of _worker.js so this file
// cannot drift from it.
import fs from 'fs';
const DDL = eval(fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8').match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);

// ── a D1 stand-in over real SQLite, so the SQL itself is exercised ──
function makeDb(withSchema = true) {
  const sqlite = new DatabaseSync(':memory:');
  if (withSchema) for (const s of DDL) sqlite.exec(s);
  return {
    sqlite,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        run() { const r = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes || 0) } }; },
        all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
        first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; },
      };
    },
    batch(stmts) { for (const s of stmts) sqlite.exec(s.sql); return stmts.map(() => ({})); },
  };
}

const HTML = () => new Response('<html><head></head><body>hi</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
function makeEnv(db) {
  return { LEADS_DB: db, LEADS_EXPORT_KEY: 'testkey', ASSETS: { fetch: () => HTML() } };
}
function harness(env) {
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  return {
    ctx,
    hit: (p, o = {}) => worker.fetch(new Request('https://irontuna.com' + p, o), env, ctx),
    settle: async () => { while (pending.length) await pending.shift(); },
  };
}
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone) AppleWebKit/605 Version/17 Mobile Safari/604';
const view = (h, p, ua, ip, extra = {}) => h.hit(p, { headers: { 'user-agent': ua, 'cf-connecting-ip': ip, ...extra } });
const traffic = async (h, q = '') => (await h.hit('/api/admin/traffic?key=testkey' + q)).json();
const track = (h, body) => h.hit('/api/track', { method: 'POST', headers: { 'user-agent': CHROME, 'content-type': 'application/json' }, body });

// ── 1. who gets counted ──
{
  const db = makeDb(false), h = harness(makeEnv(db));   // first request must create its own tables
  await view(h, '/guides', CHROME, '1.1.1.1');
  await view(h, '/guides', CHROME, '1.1.1.1');           // same person, same day
  await view(h, '/faq', IPHONE, '2.2.2.2');              // second person
  await view(h, '/guides', 'Googlebot/2.1', '3.3.3.3');
  await view(h, '/guides', 'ClaudeBot/1.0', '3.3.3.4');
  await view(h, '/guides', CHROME, '4.4.4.4', { 'sec-purpose': 'prefetch' });
  await view(h, '/guides', CHROME, '5.5.5.5', { 'sec-fetch-dest': 'iframe' });
  await view(h, '/admin.html', CHROME, '1.1.1.1');       // the admin checking numbers
  await h.settle();
  const j = await traffic(h);
  ok('real page views are counted', j.totals.window.views === 3, `got ${j.totals.window.views}`);
  ok('same IP + UA on one day is one visitor', j.totals.window.visitors === 2, `got ${j.totals.window.visitors}`);
  ok('search and AI crawlers are excluded', !JSON.stringify(j.topPages).includes('Googlebot'));
  ok('prefetch and framed loads are excluded', j.totals.window.views === 3);
  ok('the admin page does not count itself', !(j.topPages || []).some(p => p.path.startsWith('/admin')));
  ok('top pages rank by views', j.topPages[0].path === '/guides' && j.topPages[0].views === 2);
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  ok('the tables are created on first use', tables.includes('page_views') && tables.includes('site_events'), tables.join(','));
  ok('active-now reflects the last half hour', j.totals.activeNow === 2, `got ${j.totals.activeNow}`);
}

// ── 2. where the visit came from ──
{
  const db = makeDb(), h = harness(makeEnv(db));
  await view(h, '/guides', CHROME, '1.1.1.1', { referer: 'https://www.google.com/search?q=x' });
  await view(h, '/faq', IPHONE, '2.2.2.2', { referer: 'https://irontuna.com/guides' }); // internal hop
  await view(h, '/faq?utm_source=Newsletter', IPHONE, '2.2.2.3', { referer: 'https://x.com/i' });
  await view(h, '/guides', CHROME, '4.4.4.4');
  await h.settle();
  const src = Object.fromEntries((await traffic(h)).sources.map(s => [s.source, s.views]));
  ok('referrer host is recorded without www', src['google.com'] === 1, JSON.stringify(src));
  ok('clicks between our own pages are not arrivals', src[''] === 2, JSON.stringify(src));
  ok('utm_source wins over the referrer, lowercased', src['newsletter'] === 1, JSON.stringify(src));
}

// ── 3. click events from /api/track ──
{
  const db = makeDb(), h = harness(makeEnv(db));
  await track(h, JSON.stringify({ event: 'nav_click', uid: 'a_1', props: { path: '/guides' } }));
  await track(h, JSON.stringify({ event: 'nav_click', uid: 'a_2' }));
  await track(h, JSON.stringify({ event: 'nav_click', uid: 'a_1' }));
  await track(h, JSON.stringify({ event: 'upgrade_click', uid: 'a_1' }));
  const noName = await track(h, JSON.stringify({ uid: 'a_1' }));
  const junk = await track(h, 'not json at all');
  const empty = await track(h, '');
  await h.settle();
  const j = await traffic(h);
  const ev = Object.fromEntries(j.events.map(e => [e.event, e]));
  ok('/api/track answers 204 and returns no body', noName.status === 204);
  ok('malformed and empty bodies are survivable', junk.status === 204 && empty.status === 204);
  ok('events are counted', ev.nav_click.count === 3, JSON.stringify(j.events));
  ok('people counts distinct browsers, not clicks', ev.nav_click.people === 2, JSON.stringify(j.events));
  ok('a nameless event is dropped', j.events.length === 2, JSON.stringify(j.events));
  ok('a second event name is kept separate', ev.upgrade_click.count === 1);
}

// ── 4. the admin read is gated and bounded ──
{
  const db = makeDb(), h = harness(makeEnv(db));
  await view(h, '/guides', CHROME, '1.1.1.1');
  await h.settle();
  ok('no key is forbidden', (await h.hit('/api/admin/traffic')).status === 403);
  ok('a wrong key is forbidden', (await h.hit('/api/admin/traffic?key=nope')).status === 403);
  ok('the right key is allowed', (await h.hit('/api/admin/traffic?key=testkey')).status === 200);
  ok('the window is zero-filled to its length', (await traffic(h, '&days=14')).daily.length === 14);
  ok('a huge window is capped at 90 days', (await traffic(h, '&days=9999')).days === 90);
  ok('a nonsense window falls back to 30', (await traffic(h, '&days=abc')).days === 30);
  ok('a zero window is floored at 1', (await traffic(h, '&days=0')).days === 30);
  const j = await traffic(h);
  ok('the daily series ends today', j.daily[j.daily.length - 1].date === new Date().toISOString().slice(0, 10));
}

// ── 5. counting never costs a page view ──
// Every one of these must still serve the reader's HTML. This is the section
// that matters most: a broken counter is an inconvenience, a broken page is not.
{
  const angry = { prepare() { throw new Error('D1 down'); }, batch() { throw new Error('D1 down'); } };
  const cases = [
    ['a database that throws on every call', angry],
    ['no database bound at all', undefined],
    ['a database that rejects mid-query', { batch: async () => [], prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('boom')), all: () => Promise.reject(new Error('boom')), first: () => Promise.reject(new Error('boom')) }) }) }],
  ];
  for (const [label, db] of cases) {
    const env = makeEnv(db); if (!db) delete env.LEADS_DB;
    const h = harness(env);
    let res, threw = null;
    try { res = await view(h, '/guides', CHROME, '1.1.1.1'); await h.settle(); } catch (e) { threw = e; }
    ok(`the page still serves with ${label}`, !threw && res && res.status === 200, threw ? threw.message : `status ${res && res.status}`);
    ok(`the HTML body is intact with ${label}`, !threw && res && (await res.text()).includes('hi'));
    let tres = null;
    try { tres = await track(h, JSON.stringify({ event: 'nav_click', uid: 'a_1' })); await h.settle(); } catch (e) { tres = e; }
    ok(`/api/track stays quiet with ${label}`, tres && tres.status === 204);
  }
  const h = harness(Object.assign(makeEnv(undefined), { LEADS_DB: undefined }));
  const j = await (await h.hit('/api/admin/traffic?key=testkey')).json();
  ok('the admin read says so rather than 500ing blind', j.ok === false && j.error === 'no_db', JSON.stringify(j));
}

// ── 6. a visitor id cannot be walked back to a person ──
{
  const db = makeDb(), h = harness(makeEnv(db));
  await view(h, '/guides', CHROME, '203.0.113.7');
  await h.settle();
  const row = db.sqlite.prepare('SELECT * FROM page_views').all()[0];
  ok('no IP is stored', !JSON.stringify(row).includes('203.0.113.7'), JSON.stringify(row));
  ok('no user-agent is stored', !JSON.stringify(row).includes('Chrome'));
  ok('the visitor id is an opaque hash', /^[0-9a-f]{24}$/.test(row.visitor), row.visitor);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
