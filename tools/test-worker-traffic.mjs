#!/usr/bin/env node
// Tests for the first-party traffic counter inside _worker.js.
//   node tools/test-worker-traffic.mjs
//
// This code runs on EVERY page view the site serves, which makes its failure
// modes unusually expensive: a counter that throws takes the page down with it,
// a counter that miscounts quietly informs a business decision with a wrong
// number, and a counter that sets the wrong cookie hands one reader another
// reader's identity. So the tests below care about three things in this order:
//   1. it never breaks the response — no DB, a thrown D1, a hostile UA;
//   2. it counts what it says it counts, and nothing else (bots, assets, /admin);
//   3. the SQL it writes is idempotent under the primary keys it declares.
//
// Like the other worker tests this evaluates the REAL worker source rather than
// a reimplementation, against a stub D1 that records every statement.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

// ── lift the traffic section out of the worker ─────────────────────────────
const START = '// ── first-party traffic counting';
const END = 'export default {';
const a = src.indexOf(START), b = src.indexOf(END, a);
if (a < 0 || b < 0) { console.error('FAIL: could not locate the traffic section in _worker.js'); process.exit(1); }
const section = src.slice(a, b);
// parseCookie lives above the section and is the only thing it borrows.
const cookieFn = src.slice(src.indexOf('function parseCookie'), src.indexOf('\n', src.indexOf('function parseCookie')));

function load() {
  return new Function('crypto', `
    ${cookieFn}
    ${section}
    return { trafficDay, trafficPath, trafficReferrer, trafficIsBot, trafficNewVid,
             trafficQueue, trafficFlush, trafficRecord, trafficReport,
             buffer: () => _TRAFFIC_BUF, TRAFFIC_COOKIE };
  `)(globalThis.crypto);
}

// ── a D1 that records what it is asked to do ───────────────────────────────
function stubDB(opts = {}) {
  const log = { statements: [], batches: 0, rows: opts.rows || {} };
  const mk = sql => ({
    sql, args: [],
    bind(...args) { this.args = args; return this; },
    all: async () => { log.statements.push({ sql, args: [] }); return { results: pick(sql, []) }; },
    first: async () => { log.statements.push({ sql, args: [] }); return (pick(sql, [])[0]) || null; },
    run: async () => { log.statements.push({ sql, args: [] }); return { success: true }; }
  });
  const pick = (sql) => {
    for (const k of Object.keys(log.rows)) if (sql.includes(k)) return log.rows[k];
    return [];
  };
  const db = {
    prepare(sql) {
      const st = {
        sql, args: [],
        bind(...args) { st.args = args; return st; },
        all: async () => { log.statements.push({ sql, args: st.args }); return { results: pick(sql) }; },
        first: async () => { log.statements.push({ sql, args: st.args }); return pick(sql)[0] || null; },
        run: async () => { log.statements.push({ sql, args: st.args }); return { success: true }; }
      };
      return st;
    },
    async batch(stmts) {
      if (opts.throwOnBatch) throw new Error('d1 down');
      log.batches++;
      stmts.forEach(s => log.statements.push({ sql: s.sql, args: s.args || [] }));
      return stmts.map(() => ({ success: true }));
    },
    log
  };
  void mk;
  return db;
}
function stubResponse() {
  const h = [];
  return {
    headers: {
      append: (k, v) => h.push([k, v]),
      set: (k, v) => h.push([k, v]),
      get: k => { const r = h.filter(x => x[0].toLowerCase() === k.toLowerCase()); return r.length ? r[r.length - 1][1] : null; },
      all: () => h
    },
    cookies: () => h.filter(x => x[0] === 'Set-Cookie').map(x => x[1])
  };
}
function stubRequest(headers = {}, method = 'GET') {
  const lower = {};
  for (const k in headers) lower[k.toLowerCase()] = headers[k];
  return { method, headers: { get: k => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) } };
}
const waited = [];
const ctx = { waitUntil: p => waited.push(p) };
const flushAll = async () => { const all = waited.splice(0); await Promise.all(all); };

// ── 1. path and referrer keys ──────────────────────────────────────────────
console.log('\nkeys');
{
  const T = load();
  ok('root stays root', T.trafficPath('/') === '/');
  ok('a trailing slash is not a second page', T.trafficPath('/guides/') === '/guides');
  ok('case is not a second page', T.trafficPath('/Guides') === '/guides');
  ok('a query string never becomes part of the key',
     T.trafficPath('/auctiondraft?screen=cheat&email=me@example.com') === '/auctiondraft');
  ok('a fragment never becomes part of the key', T.trafficPath('/faq#pricing') === '/faq');
  ok('an absurd path is capped', T.trafficPath('/' + 'x'.repeat(500)).length <= 120);
  ok('no referrer is direct', T.trafficReferrer('', 'irontuna.com') === 'direct');
  ok('our own pages are not referrers to ourselves',
     T.trafficReferrer('https://irontuna.com/guides', 'irontuna.com') === 'direct');
  ok('...including the www of ourselves',
     T.trafficReferrer('https://www.irontuna.com/guides', 'irontuna.com') === 'direct');
  ok('a real referrer keeps only its host',
     T.trafficReferrer('https://www.reddit.com/r/fantasyfootball/comments/abc?x=1', 'irontuna.com') === 'reddit.com');
  ok('a malformed referrer is direct, not a crash', T.trafficReferrer('not a url', 'irontuna.com') === 'direct');
}

// ── 2. who gets counted ────────────────────────────────────────────────────
console.log('\nwho gets counted');
{
  const T = load();
  const bots = ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/8.4.0',
                'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120', 'facebookexternalhit/1.1',
                'AhrefsBot/7.0', 'Bytespider'];
  bots.forEach(ua => ok(`robot skipped: ${ua.slice(0, 28)}`, T.trafficIsBot(ua)));
  ok('a blank UA is treated as a robot', T.trafficIsBot(''));
  const humans = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
  ];
  humans.forEach((ua, i) => ok(`real browser counted (${i + 1})`, !T.trafficIsBot(ua)));
}

// ── 3. recording never breaks the response ─────────────────────────────────
console.log('\nthe counter never breaks the page');
{
  const T = load();
  const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
  const r0 = stubResponse();
  ok('no database bound: response passes through untouched',
     T.trafficRecord(stubRequest({ 'User-Agent': UA }), new URL('https://irontuna.com/'), r0, {}, ctx) === r0
     && r0.cookies().length === 0 && T.buffer().length === 0);

  const env = { LEADS_DB: stubDB() };
  const r1 = stubResponse();
  ok('a POST is not a page view',
     T.trafficRecord(stubRequest({ 'User-Agent': UA }, 'POST'), new URL('https://irontuna.com/'), r1, env, ctx) === r1
     && T.buffer().length === 0);
  const r2 = stubResponse();
  T.trafficRecord(stubRequest({ 'User-Agent': 'Googlebot/2.1' }), new URL('https://irontuna.com/'), r2, env, ctx);
  ok('a robot is not a page view', T.buffer().length === 0 && r2.cookies().length === 0);
  const r3 = stubResponse();
  T.trafficRecord(stubRequest({ 'User-Agent': UA }), new URL('https://irontuna.com/admin'), r3, env, ctx);
  ok('the owner reading /admin is not a page view', T.buffer().length === 0);

  const r4 = stubResponse();
  T.trafficRecord(stubRequest({ 'User-Agent': UA, Referer: 'https://news.ycombinator.com/' }),
                  new URL('https://irontuna.com/guides?utm=x'), r4, env, ctx);
  const v = T.buffer()[0];
  ok('a real reader is counted once', T.buffer().length === 1);
  ok('...on the right page', v && v.path === '/guides', v && v.path);
  ok('...with the referrer host', v && v.ref === 'news.ycombinator.com', v && v.ref);
  ok('...and a fresh identity', v && /^[0-9a-f]{32}$/.test(v.vid) && v.isNew === true);
  ok('the identity is set as a cookie', /^it_v=[0-9a-f]{32}; Path=\/;/.test(r4.cookies()[0] || ''), r4.cookies()[0]);
  ok('the cookie is not readable by scripts and does not travel cross-site',
     /HttpOnly/.test(r4.cookies()[0]) && /SameSite=Lax/.test(r4.cookies()[0]) && /Secure/.test(r4.cookies()[0]));

  const r5 = stubResponse();
  T.trafficRecord(stubRequest({ 'User-Agent': UA, Cookie: 'it_v=' + 'a'.repeat(32) }),
                  new URL('https://irontuna.com/'), r5, env, ctx);
  const back = T.buffer()[1];
  ok('a returning reader keeps their identity', back && back.vid === 'a'.repeat(32) && back.isNew === false);
  ok('...and is not re-issued a cookie', r5.cookies().length === 0);

  const r6 = stubResponse();
  T.trafficRecord(stubRequest({ 'User-Agent': UA, Cookie: 'it_v=not-a-real-id' }),
                  new URL('https://irontuna.com/'), r6, env, ctx);
  ok('a forged identity is replaced, not trusted', /^[0-9a-f]{32}$/.test(T.buffer()[2].vid) && r6.cookies().length === 1);
}

// ── 4. do-not-track ────────────────────────────────────────────────────────
// Counted in the totals, never given an identifier. Both halves matter: drop the
// view and the site under-reports itself; keep the id and the header meant
// nothing.
console.log('\ndo not track');
{
  const T = load();
  const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
  const env = { LEADS_DB: stubDB() };
  for (const h of [{ DNT: '1' }, { 'Sec-GPC': '1' }]) {
    const r = stubResponse();
    T.trafficRecord(stubRequest({ 'User-Agent': UA, ...h }), new URL('https://irontuna.com/faq'), r, env, ctx);
    const v = T.buffer()[T.buffer().length - 1];
    ok(`${Object.keys(h)[0]}: the view still counts`, v && v.path === '/faq');
    ok(`${Object.keys(h)[0]}: no identifier is assigned`, v && v.vid === null && v.isNew === false);
    ok(`${Object.keys(h)[0]}: no cookie is set`, r.cookies().length === 0);
  }
}

// ── 5. the flush ───────────────────────────────────────────────────────────
console.log('\nflush');
{
  const T = load();
  const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
  const db = stubDB();
  const env = { LEADS_DB: db };
  // Three views of one page by one reader, plus one of another page.
  for (let i = 0; i < 3; i++) {
    T.trafficRecord(stubRequest({ 'User-Agent': UA, Cookie: 'it_v=' + 'b'.repeat(32) }),
                    new URL('https://irontuna.com/'), stubResponse(), env, ctx);
  }
  T.trafficRecord(stubRequest({ 'User-Agent': UA, Cookie: 'it_v=' + 'b'.repeat(32) }),
                  new URL('https://irontuna.com/faq'), stubResponse(), env, ctx);
  ok('every view is queued', T.buffer().length === 4);
  await flushAll();
  ok('the buffer is drained', T.buffer().length === 0);

  const writes = db.log.statements.filter(s => /^INSERT INTO/.test(s.sql));
  const pv = writes.filter(s => s.sql.includes('INTO pageviews'));
  const rf = writes.filter(s => s.sql.includes('INTO referrers'));
  const vs = writes.filter(s => s.sql.includes('INTO visitors'));
  ok('repeat views of one page collapse to one statement', pv.length === 2, String(pv.length));
  ok('...carrying the count, not one row per view',
     pv.some(s => s.args[1] === '/' && s.args[2] === 3), JSON.stringify(pv.map(s => s.args)));
  ok('a referrer row is written per view group', rf.length === 1 && rf[0].args[2] === 4, JSON.stringify(rf.map(s => s.args)));
  ok('one visitor row, not four', vs.length === 1 && vs[0].args[2] === 4, JSON.stringify(vs.map(s => s.args)));
  ok('every write is an upsert, so a retry cannot double-count',
     writes.every(s => /ON CONFLICT\(.+\) DO UPDATE SET views = views \+ \?/.test(s.sql)));
  ok('the visitor upsert never re-flags a returning reader as new',
     vs.every(s => !/DO UPDATE SET[^;]*is_new/.test(s.sql)));
  ok('tables are created before they are written to', db.log.batches >= 2);
}

// ── 6. a broken database loses views, never requests ───────────────────────
console.log('\nD1 failure');
{
  const T = load();
  const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
  const env = { LEADS_DB: stubDB({ throwOnBatch: true }) };
  const r = stubResponse();
  const out = T.trafficRecord(stubRequest({ 'User-Agent': UA }), new URL('https://irontuna.com/'), r, env, ctx);
  ok('the response is still returned', out === r);
  let threw = false;
  try { await flushAll(); } catch (e) { threw = true; }
  ok('a dead D1 does not reject into waitUntil', !threw);
  // A failed write leaves its views queued, to be retried by the next request —
  // but a database down for an hour must not become a memory leak.
  ok('the lost view is kept for the next attempt, not discarded', T.buffer().length === 1);
  for (let i = 0; i < 2000; i++) {
    T.trafficRecord(stubRequest({ 'User-Agent': UA }), new URL('https://irontuna.com/'), stubResponse(), env, ctx);
  }
  await flushAll();
  ok('and the buffer stays bounded while it stays down', T.buffer().length <= 500, String(T.buffer().length));
}

// ── 7. the report ──────────────────────────────────────────────────────────
console.log('\nreport');
{
  const T = load();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const db = stubDB({ rows: {
    'FROM pageviews WHERE day >= ? GROUP BY day': [{ day: yesterday, views: 40 }, { day: today, views: 10 }],
    'COUNT(*) AS visitors': [{ day: yesterday, visitors: 12, new_visitors: 9 }, { day: today, visitors: 4, new_visitors: 1 }],
    'GROUP BY path': [{ path: '/', views: 30 }, { path: '/guides', views: 20 }],
    'GROUP BY host': [{ host: 'direct', views: 35 }, { host: 'reddit.com', views: 15 }],
    'COUNT(DISTINCT vid)': [{ n: 14 }]
  } });
  const rep = await T.trafficReport(db, 30);
  ok('the series covers the whole window', rep.daily.length === 30);
  ok('...ending today', rep.daily[rep.daily.length - 1].date === today);
  ok('...with days that had no traffic present as zero, not missing',
     rep.daily[0].views === 0 && rep.daily.every(d => typeof d.views === 'number'));
  ok('a day with traffic carries it', rep.daily[rep.daily.length - 1].views === 10);
  ok('views total across the window', rep.totals.viewsWindow === 50, String(rep.totals.viewsWindow));
  // The one arithmetic mistake this panel could make and still look right.
  ok('unique visitors are counted, never summed across days',
     rep.totals.visitorsWindow === 14, String(rep.totals.visitorsWindow));
  ok('today is reported on its own', rep.totals.viewsToday === 10 && rep.totals.visitorsToday === 4);
  ok('top pages come back ranked', rep.topPaths[0].path === '/' && rep.topPaths[0].views === 30);
  ok('top referrers come back ranked', rep.topReferrers[0].host === 'direct');
  ok('an absurd window is clamped, not honoured', (await T.trafficReport(db, 99999)).days === 365);
  ok('a missing window falls back to 30', (await T.trafficReport(db, 0)).days === 30);

  const empty = await T.trafficReport(stubDB(), 7);
  ok('an empty database reports zeroes rather than failing',
     empty.daily.length === 7 && empty.totals.viewsWindow === 0 && empty.topPaths.length === 0);
}

// ── 8. the worker and the admin page agree ─────────────────────────────────
console.log('\nworker <-> /admin');
{
  ok('the worker serves the endpoint the page calls', src.includes("url.pathname === '/api/admin/traffic'"));
  ok('the page calls it', admin.includes('/api/admin/traffic?key='));
  ok('the endpoint is behind the same admin key as the rest',
     /'\/api\/admin\/traffic'[\s\S]{0,600}adminOk\(env, url\.searchParams\.get\('key'\)/.test(src));
  ok('both HTML exits record the view', (src.match(/return trafficRecord\(request, url,/g) || []).length === 2);
  ok('the page renders the series the report returns',
     admin.includes("key: 'views'") && admin.includes("key: 'visitors'"));
  ok('both charts share one renderer', (admin.match(/drawLineChart\(\{/g) || []).length === 2);
  ok('the privacy policy already covers what is collected',
     fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').includes('random anonymous identifier'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
