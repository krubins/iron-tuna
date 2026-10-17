#!/usr/bin/env node
// Tests for the meaningful-use read (/api/admin/usage) and the outcome events
// it-metrics.js sends through /api/track (docs/growth-plan.md, Phase 1).
//   node tools/test-usage.mjs
//
// What these protect:
//   - a metric nothing has been collected for is null, never 0
//   - a rerender or reload of the same result in one visit is one output
//   - the operator's browsers are excluded, by cookie and by first-party id
//   - an outcome event cannot carry an email, a roster or any free text
//   - seven-day return only rates cohorts with all seven days behind them
//
// Drives the REAL _worker.js over an in-memory SQLite standing in for D1, as
// tools/test-analytics.mjs does, so the SQL itself is executed.

import fs from 'fs';
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
const DDL = eval(fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8').match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const s of DDL) sqlite.exec(s);
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
function harness(db) {
  const env = { LEADS_DB: db, LEADS_EXPORT_KEY: 'testkey', ASSETS: { fetch: () => HTML() } };
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  return {
    hit: (p, o = {}) => worker.fetch(new Request('https://irontuna.com' + p, o), env, ctx),
    settle: async () => { while (pending.length) await pending.shift(); },
  };
}
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const usage = async (h, q = '', headers = {}) => (await h.hit('/api/admin/usage?key=testkey' + q, { headers: { 'user-agent': CHROME, ...headers } })).json();
const track = (h, body, headers = {}) => h.hit('/api/track', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': CHROME, 'cf-connecting-ip': '9.9.9.9', ...headers } });

const DAY = 86400000;
const dayOf = ts => new Date(ts).toISOString().slice(0, 10);
// Seed a row directly: the worker can only ever write "now", and returns are
// about other days.
function seed(db, ts, event, uid, props, internal = 0) {
  db.sqlite.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?,?,?,?,?,?,?)')
    .run(ts, dayOf(ts), event, uid, props.path || '/', JSON.stringify(props), internal);
}

// ── 1. nothing collected is unavailable, not zero ──
{
  const db = makeDb(), h = harness(db);
  ok('no key is forbidden', (await h.hit('/api/admin/usage')).status === 403);
  const j = await usage(h);
  ok('an empty store answers ok', j.ok === true, JSON.stringify(j).slice(0, 200));
  ok('an empty store says nothing is collected', j.available === false && j.collectingSince === null);
  ok('seven-day return with no cohort is null, not 0', j.retention7.returnPct === null);
  ok('confirmed subscriptions are null with a reason when there is no subscriber table', j.subscriptions.confirmed === null && /subscriber table/.test(j.subscriptions.confirmedNote));
  ok('a missing contacts table is not a failed read', !j.readError && j.subscriptions.contactsStored === null);
  ok('an empty funnel has no percentages', j.funnel.usefulPct === null);
}

// ── 2. outcome events through /api/track: privacy and shape ──
{
  const db = makeDb(), h = harness(db);
  await track(h, { event: 'tool_success', uid: 'abc123def4', props: { tool: 'rankings', key: 'week|RB|ppr', vid: 'v1', rows: 40, email: 'a@b.com', roster: ['X', 'Y'], note: 'free text', scoring: 'me@x.io' } });
  await track(h, { event: 'tool_success', uid: 'abc123def4', props: { key: 'no tool' } });
  await track(h, { event: 'nav_click', uid: 'abc123def4', props: { path: '/x', who: 'someone@example.com', where: 'header' } });
  await track(h, { event: 'tool_success', uid: 'abc123def4', props: { tool: 'rankings' } }, { 'user-agent': 'Mozilla/5.0 HeadlessChrome/126' });
  await h.settle();
  const rows = db.sqlite.prepare('SELECT event, props FROM site_events ORDER BY id').all();
  const p0 = JSON.parse(rows[0].props);
  ok('an outcome event keeps its listed fields', p0.tool === 'rankings' && p0.key === 'week|RB|ppr' && p0.rows === 40 && p0.vid === 'v1');
  ok('an outcome event drops unlisted fields (email, roster, free text)', !('email' in p0) && !('roster' in p0) && !('note' in p0), rows[0].props);
  ok('a listed field holding an email address is dropped', !('scoring' in p0), rows[0].props);
  ok('a tool event with no tool is dropped', rows.filter(r => r.event === 'tool_success').length === 1, rows.length);
  const nav = JSON.parse(rows.find(r => r.event === 'nav_click').props);
  ok('an older click event keeps its fields but loses an email-like value', nav.where === 'header' && !('who' in nav), JSON.stringify(nav));
  ok('headless browsers are not recorded', rows.length === 2, String(rows.length));
  const all = db.sqlite.prepare('SELECT props FROM site_events').all().map(r => r.props).join(' ');
  ok('no stored event contains an email address', !/@/.test(all), all);
}

// ── 3. outputs, sources, funnel, owner exclusion ──
{
  const db = makeDb(), h = harness(db);
  const t = Date.now() - 3600000;
  // A: google, new, uses rankings twice (one rerender), saves a league.
  seed(db, t, 'visit_start', 'aaaaaa01', { vid: 'va', src: 'google.com', med: 'organic', new: 1, fs: dayOf(t) });
  seed(db, t + 1000, 'tool_success', 'aaaaaa01', { vid: 'va', tool: 'rankings', key: 'week|RB' });
  seed(db, t + 2000, 'tool_success', 'aaaaaa01', { vid: 'va', tool: 'rankings', key: 'week|RB' });
  seed(db, t + 3000, 'tool_success', 'aaaaaa01', { vid: 'va', tool: 'rankings', key: 'week|WR' });
  seed(db, t + 4000, 'league_setup_start', 'aaaaaa01', { vid: 'va', tool: 'league_scoring', key: 'form' });
  seed(db, t + 5000, 'league_setup_complete', 'aaaaaa01', { vid: 'va', tool: 'league_scoring', key: 'save' });
  // B: direct, returning, gets an empty and an error.
  seed(db, t, 'visit_start', 'bbbbbb02', { vid: 'vb', src: 'direct', med: 'none', new: 0, fs: '0000-00-00' });
  seed(db, t + 1000, 'tool_empty', 'bbbbbb02', { vid: 'vb', tool: 'vegas_edge', key: 'w7' });
  seed(db, t + 2000, 'tool_error', 'bbbbbb02', { vid: 'vb', tool: 'rankings', key: 'week|ppr' });
  // C: x.com campaign, new, shares, signs up.
  seed(db, t, 'visit_start', 'cccccc03', { vid: 'vc', src: 'x', med: 'social', cmp: '2026-w07-vegas', new: 1, fs: dayOf(t) });
  seed(db, t + 1000, 'share_click', 'cccccc03', { vid: 'vc', tool: 'fantasy_board', key: 'p', method: 'copy_link' });
  seed(db, t + 2000, 'subscribe_request', 'cccccc03', { vid: 'vc', tool: 'insights_form', key: 'ok' });
  // The operator: one browser by cookie flag, one by first-party id.
  seed(db, t, 'visit_start', 'owner0001', { vid: 'vo', src: 'direct', med: 'none', new: 0 }, 1);
  seed(db, t, 'visit_start', 'owner0002', { vid: 'vp', src: 'direct', med: 'none', new: 0 });
  seed(db, t + 1000, 'tool_success', 'owner0002', { vid: 'vp', tool: 'rankings', key: 'x' });
  // An older click event whose props were cut mid-string, as the 600-character
  // cap used to do. It must not take a query down.
  db.sqlite.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?,?,?,?,?,?,?)').run(t, dayOf(t), 'nav_click', 'zzzzzz09', '/', '{"path":"/x","long":"abc', 0);

  const before = await usage(h);
  ok('the owner browser by id counts until it is registered', before.visitors.visitors === 4, JSON.stringify(before.visitors));
  const j = await usage(h, '&uid=owner0002');
  ok('a malformed legacy props row does not break the read', j.ok && !j.readError, JSON.stringify(j.readError));
  ok('cookie-flagged and id-registered owner browsers are excluded', j.visitors.visitors === 3, JSON.stringify(j.visitors));
  ok('new and returning visitors are split', j.visitors.newVisitors === 2 && j.visitors.returningVisitors === 1, JSON.stringify(j.visitors));
  const rk = j.tools.find(x => x.tool === 'rankings');
  ok('a rerender of the same board is one output', rk.success === 2 && rk.events === 4, JSON.stringify(rk));
  ok('a failure is counted against the tool', rk.error === 1 && rk.attempts === 3, JSON.stringify(rk));
  const ve = j.tools.find(x => x.tool === 'vegas_edge');
  ok('an empty result is counted, apart from failures', ve.empty === 1 && ve.error === 0 && ve.failPct === 100, JSON.stringify(ve));
  const g = j.sources.find(s => s.source === 'google.com');
  ok('a source reports its useful visits and saved leagues', g && g.usefulVisits === 1 && g.usefulPct === 100 && g.leagueVisitors === 1, JSON.stringify(g));
  const d = j.sources.find(s => s.source === 'direct');
  ok('a visit with no result is not useful', d && d.usefulVisits === 0 && d.usefulPct === 0, JSON.stringify(d));
  ok('the funnel counts browsers at each step', j.funnel.visitors === 3 && j.funnel.useful === 1 && j.funnel.setupStarted === 1 && j.funnel.setupCompleted === 1 && j.funnel.emailSignups === 1, JSON.stringify(j.funnel));
  ok('funnel percentages carry their denominators', j.funnel.usefulPct === 33.3 && j.funnel.startedToCompletedPct === 100, JSON.stringify(j.funnel));
  ok('share clicks are reported with their method', j.shares.length === 1 && j.shares[0].method === 'copy_link' && j.shares[0].clicks === 1);
  ok('email sign-ups come from the form event', j.subscriptions.signupEvents === 1);
  const me = await usage(h, '&includeMe=1');
  ok('includeMe=1 puts the owner back', me.visitors.visitors === 5, JSON.stringify(me.visitors));
  // Hand the browser back: on=0 forgets the id.
  await h.hit('/api/admin/exclude-me?on=0&key=testkey&uid=owner0002', { headers: { 'user-agent': CHROME } });
  const back = await usage(h, '', { cookie: 'it_owner=0' });
  ok('a browser handed back is counted again', back.visitors.visitors === 4, JSON.stringify(back.visitors));
  ok('a bad uid is never registered', ((await usage(h, '&uid=DROP%20TABLE')).ok) && db.sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_owner').all()[0].n === 0);
}

// ── 4. seven-day return and the weekly read ──
{
  const db = makeDb(), h = harness(db);
  const now = Date.now();
  const at = n => now - n * DAY;
  // Mature cohort, 10 days ago: three new browsers.
  seed(db, at(10), 'visit_start', 'ret00001', { vid: 'a', new: 1, fs: dayOf(at(10)) });
  seed(db, at(10), 'visit_start', 'ret00002', { vid: 'b', new: 1, fs: dayOf(at(10)) });
  seed(db, at(10), 'visit_start', 'ret00003', { vid: 'c', new: 1, fs: dayOf(at(10)) });
  seed(db, at(10) + 3600000, 'visit_start', 'ret00003', { vid: 'c2', new: 0, fs: dayOf(at(10)) }); // same day: not a return
  seed(db, at(7), 'visit_start', 'ret00001', { vid: 'a2', new: 0, fs: dayOf(at(10)) });           // day 3: a return
  seed(db, at(7) + 1000, 'tool_success', 'ret00001', { vid: 'a2', tool: 'lineup', key: 'lineup' });
  seed(db, at(1), 'visit_start', 'ret00002', { vid: 'b2', new: 0, fs: dayOf(at(10)) });           // day 9: too late
  // Maturing cohort, 2 days ago.
  seed(db, at(2), 'visit_start', 'ret00004', { vid: 'd', new: 1, fs: dayOf(at(2)) });
  const j = await usage(h);
  const r = j.retention7;
  ok('only cohorts with seven days behind them are rated', r.matureCohorts === 1 && r.newBrowsers === 3, JSON.stringify(r));
  ok('a return on day 1-7 counts; same day and day 9 do not', r.returned === 1 && r.returnPct === 33.3, JSON.stringify(r));
  ok('a return with a tool result is counted apart', r.returnedUseful === 1, JSON.stringify(r));
  ok('maturing browsers are reported, not rated', r.maturingBrowsers === 1 && r.cohorts.some(c => !c.mature && c.cohort === 1));
  const w = j.weekly;
  ok('weeks start on a Tuesday', w.length && w.every(x => new Date(x.weekStart + 'T00:00:00Z').getUTCDay() === 2), JSON.stringify(w.map(x => x.weekStart)));
  // The Tuesday that starts the NFL week a timestamp falls in.
  const tue = ts => { const d = new Date(ts); return dayOf(ts - ((d.getUTCDay() + 5) % 7) * DAY); };
  const wkUse = w.find(x => x.weekStart === tue(at(7)));
  const firstBefore = dayOf(at(10)) < tue(at(7));
  ok('a browser first seen before the week counts as returning, and only then',
    wkUse && wkUse.useful === 1 && wkUse.returningUseful === (firstBefore ? 1 : 0), JSON.stringify(w));
  ok('the current week is marked in progress', w[w.length - 1].partial === true);
}

// ── 5. the traffic read: internal hops and likely automation ──
{
  const db = makeDb(), h = harness(db);
  const t = Date.now() - 600000;
  for (let i = 0; i < 25; i++) db.sqlite.prepare('INSERT INTO page_views (ts, day, path, visitor, source, country, internal) VALUES (?,?,?,?,?,?,?)').run(t + i * 2000, dayOf(t), '/player/x' + i, 'fastv', '', 'SG', 0);
  for (let i = 0; i < 3; i++) db.sqlite.prepare('INSERT INTO page_views (ts, day, path, visitor, source, country, internal) VALUES (?,?,?,?,?,?,?)').run(t + i * 60000, dayOf(t), '/rankings', 'slowv', i ? '(internal)' : 'google.com', 'US', 0);
  const j = await (await h.hit('/api/admin/traffic?key=testkey', { headers: { 'user-agent': CHROME } })).json();
  ok('a fast 25-page visitor-day is reported as likely automated', j.likelyAutomated.userDays === 1 && j.likelyAutomated.views === 25, JSON.stringify(j.likelyAutomated));
  ok('a person reading three pages is not', j.likelyAutomated.userDays === 1);
  ok('internal hops are left out of the sources table', !j.sources.some(s => s.source === '(internal)') && j.internalHops === 2, JSON.stringify(j.sources));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
