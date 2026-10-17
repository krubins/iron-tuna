#!/usr/bin/env node
// The Sunday email and shared findings (docs/growth-plan.md, Phase 5,
// 17 Oct 2026).
//   REQUIRE_BROWSER=1 node tools/test-sunday-email.mjs
//
// Node, against the worker's own code (the section between THE SUNDAY EMAIL
// AND SHARED FINDINGS START and END, lifted with what it calls, the board
// stubbed with tools/fixtures/home-board.mjs) on an in-memory SQLite D1, with
// Resend replaced by a recorder:
//   - sign-ups: closed without credentials; validation, consent, the hidden
//     field, one answer for every valid request, the per-address and
//     per-origin limits, Washington, a failed confirmation mail
//   - double opt-in: GET confirms nothing, POST does; tampered, expired and
//     borrowed tokens refused; a scoring change waits for its own link;
//     confirming lifts an earlier unsubscribe
//   - the edition: up to five, fewer when fewer qualify, at each scoring;
//     labels, timestamp, footer, unsubscribe headers; no em dash
//   - the send: off without the switch; confirmed only; suppressed skipped;
//     never twice to one address in a week (a rerun, a claim held by another
//     run); the first build of the week is the edition; a refused batch is
//     released and retried, an unanswered one is not; batches of 100
//   - findings: made only by the server, only for a player who qualifies now;
//     the same figures are one id; the page and the image read the stored
//     record and nothing else; noindex; Washington
//   - /admin: the gate, the counts, the preview sends nothing, the test send
// and through the real worker: the routes are wired, the unsubscribe link
// marks the list, the job is registered, /admin's confirmed count.
//
// Browser, over a local server with /api stubbed: /sunday's form (closed and
// open, validation, what is sent, the event without the address), the
// homepage's share buttons and offer ("Not now" rests it), the flex call's
// comparison share, the finding page (share controls, image, phone width).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + String(x).slice(0, 300) : ''}`); } };
const lift = (a, b) => { const i = W.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return W.slice(i, W.indexOf(b, i) + b.length); };
const line = (a) => lift(a, '\n');

const SECTION = W.slice(W.indexOf('// THE SUNDAY EMAIL AND SHARED FINDINGS START'), W.indexOf('// THE SUNDAY EMAIL AND SHARED FINDINGS END'));
const P5 = new Function([
  line('const ALLOW_ORIGIN = '), lift('const SEC = {', '\n};'), line('function secure(r)'), lift('const corsHeaders = ', '\n});'),
  lift('async function rl(', '\n}'), lift('function IS_WASHINGTON(', '\n}'), lift('function WA_MARKET_BLOCK(', '\n}'),
  line('function b64urlEncode'), line('async function hmacSign'), line('function timingSafeEq'), line('function adminOk'), line('const json = (obj'),
  line('async function unsubToken'), lift('async function isUnsubscribed', '\n}'),
  W.slice(W.indexOf('// ── the scoring engine ─'), W.indexOf('const COLUMN_SCORING = {')), lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'),
  lift('function _etStamp(ms) {', '\n}'), W.slice(W.indexOf('const HOME_EX_MAX = 3;'), W.indexOf('function homeShellFill(html, hp) {')),
  // The board, its lines and the schedule report, stubbed.
  'let BOARD = null, MARKETS = {};',
  'async function boardsPayload() { return BOARD; } function boardStillToPlay(b) { return b; } async function marketHistoryWeek() { return MARKETS; }',
  'function jobScheduleFrom() { return {}; } function jobScheduleReport() { return { jobs: [{ job: "sunday-edition", when: "Sun 7 AM, 8 AM ET" }] }; }',
  SECTION
].join('\n') + '\nreturn { set: (b, m) => { BOARD = b; MARKETS = m; }, editionConfig, subscribeRequest, subscribeConfirm, editionBuild, editionHtml, editionText, editionSubject,'
  + ' editionMessage, runSundayEdition, findingCreate, findingRead, findingSvg, findingShellFill, findingStore, emailShareRoutes, subConfirmToken, unsubToken, _oddsNorm, EDITION_MAX };')();

// ── an in-memory D1 that reports changes, as D1 does ─────────────────────────
function makeDb(ddl = []) {
  const sqlite = new DatabaseSync(':memory:');
  for (const s of ddl) sqlite.exec(s);
  return { sqlite, prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
    run() { const i = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(i.changes), last_row_id: Number(i.lastInsertRowid) } }; },
    all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
    first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; } }; } };
}
const SUB_DDL = eval(W.match(/const SUB_DDL = (\[[\s\S]*?\]);/)[1]);
const q = (db, sql, ...a) => db.sqlite.prepare(sql).all(...a);
// Resend, recorded. MODE: 'ok' | 'refuse' (HTTP 500) | 'network' (throws).
const MAIL = []; let MAILMODE = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).startsWith('https://api.resend.com/')) {
    MAIL.push({ url: String(u), body: JSON.parse(o.body), headers: o.headers });
    if (MAILMODE === 'network') throw new Error('socket hang up');
    return new Response(JSON.stringify(MAILMODE === 'ok' ? { id: 'x' } : { message: 'server error' }), { status: MAILMODE === 'ok' ? 200 : 500 });
  }
  return realFetch(u, o);
};
const B = homeBoard(), M = homeMarkets(P5._oddsNorm);
P5.set(B, M);
const ADDR = '1 Example Street, Boston, MA 02110';
const envOf = (db, extra = {}) => ({ LEADS_DB: db, RESEND_API_KEY: 're_test', MAIL_ADDRESS: ADDR, AUTH_SECRET: 'test-secret', LEADS_EXPORT_KEY: 'k', ...extra });
const ORIGIN = 'https://irontuna.com';
let ipN = 0;
const req = (p, o = {}) => new Request(ORIGIN + p, { method: o.method || 'GET', headers: { 'content-type': o.form ? 'application/x-www-form-urlencoded' : 'application/json', 'cf-connecting-ip': o.ip || ('10.0.0.' + (++ipN)), ...(o.headers || {}) },
  body: o.body == null ? undefined : (o.form ? new URLSearchParams(o.body).toString() : JSON.stringify(o.body)) });
const reqWA = (p, o = {}) => { const r = req(p, o); Object.defineProperty(r, 'cf', { value: { country: 'US', regionCode: 'WA' } }); return r; };
async function sub(env, body, o = {}) { const r = o.wa ? reqWA('/api/subscribe', { method: 'POST', body, ...o }) : req('/api/subscribe', { method: 'POST', body, ...o }); return P5.subscribeRequest(env, r, new URL(r.url)); }
async function route(env, p, o = {}) { const r = o.wa ? reqWA(p, o) : req(p, o); return P5.emailShareRoutes(r, env, new URL(r.url)); }
const linkIn = (m) => { const x = /href="(https:\/\/irontuna\.com\/sunday\/confirm\?[^"]+)"/.exec(m.body.html); return x ? x[1].replace(/&amp;/g, '&') : null; };
async function confirm(env, link, method) {
  const u = new URL(link);
  const r = method === 'POST' ? req('/sunday/confirm', { method: 'POST', form: true, body: { e: u.searchParams.get('e'), t: u.searchParams.get('t') } }) : req(u.pathname + u.search);
  return P5.subscribeConfirm(env, r, new URL(r.url));
}
const EM = /—/;

// ── sign-ups ─────────────────────────────────────────────────────────────────
console.log('\nsign-ups');
{
  const db = makeDb();
  const closed = await sub({ LEADS_DB: db }, { email: 'a@b.co', consent: true });
  ok('closed without RESEND_API_KEY, MAIL_ADDRESS and AUTH_SECRET', closed.status === 503 && closed.body.error === 'closed', JSON.stringify(closed));
  const cfg = P5.editionConfig({ LEADS_DB: db, RESEND_API_KEY: 'x' });
  ok('and says which are missing', cfg.missing.join() === 'MAIL_ADDRESS,AUTH_SECRET' && !cfg.signups && !cfg.send);
  ok('mail configured opens sign-ups but not the weekly send', P5.editionConfig(envOf(db)).signups && !P5.editionConfig(envOf(db)).send);
  ok('the send needs SUNDAY_EMAIL_SEND=on as well', P5.editionConfig(envOf(db, { SUNDAY_EMAIL_SEND: 'on' })).send);
  const g = await route({ LEADS_DB: db }, '/api/subscribe');
  ok('GET /api/subscribe says closed, and nothing about any address', (await g.json()).open === false);
  const env = envOf(db);
  ok('GET says open once configured', (await (await route(env, '/api/subscribe')).json()).open === true);
  ok('GET says closed in Washington', (await (await route(env, '/api/subscribe', { wa: true })).json()).open === false);
  const bad = await sub(env, { email: 'not-an-address', consent: true });
  ok('an address that is not one is refused', bad.status === 400 && bad.body.error === 'invalid');
  const nc = await sub(env, { email: 'reader@example.com' });
  ok('no consent, no sign-up', nc.status === 400 && nc.body.error === 'consent');
  const hp = await sub(env, { email: 'bot@example.com', consent: true, website: 'http://spam' });
  ok('the hidden field filled: answered ok, stored nothing, mailed nothing', hp.status === 200 && !(() => { try { return q(db, 'SELECT * FROM subscribers').length; } catch (e) { return 0; } })() && !MAIL.length);
  const wa = await sub(env, { email: 'wa@example.com', consent: true }, { wa: true });
  ok('Washington is refused (betting-market figures)', wa.status === 451);

  MAIL.length = 0;
  const first = await sub(env, { email: ' Reader@Example.com ', consent: true, scoring: 'half', tool: 'sunday_page' });
  const row = q(db, 'SELECT * FROM subscribers')[0];
  ok('a valid request stores one pending row, lower-cased, at the chosen scoring', first.status === 200 && row && row.email === 'reader@example.com' && row.status === 'pending' && row.scoring === 'half' && row.source === 'sunday_page', JSON.stringify(row));
  ok('and mails one confirmation link to that address', MAIL.length === 1 && MAIL[0].body.to === 'reader@example.com' && !!linkIn(MAIL[0]), JSON.stringify(MAIL[0] && MAIL[0].body.to));
  ok('the confirmation says nothing is sent until confirmed, with a text part', /Nothing is sent until you confirm/.test(MAIL[0].body.html) && /Confirm: https:/.test(MAIL[0].body.text) && !EM.test(MAIL[0].body.html));
  const again = await sub(env, { email: 'reader@example.com', consent: true, scoring: 'half' });
  ok('asking again within ten minutes mails nothing more', again.status === 200 && MAIL.length === 1);
  ok('and gets the same answer as a new address', JSON.stringify(again.body) === JSON.stringify(first.body));
  ok('the answer carries nothing about the address', JSON.stringify(first.body) === '{"ok":true}');
  // Five unanswered links a month, then quiet.
  for (let i = 0; i < 6; i++) { db.sqlite.prepare('UPDATE subscribers SET confirm_sent_at = ? WHERE email = ?').run(Date.now() - 11 * 60000, 'reader@example.com'); await sub(env, { email: 'reader@example.com', consent: true, scoring: 'half' }); }
  ok('at most five unanswered confirmations to one address in a month', MAIL.length === 5, String(MAIL.length));
  // Per origin: five requests in ten minutes.
  const ip = '203.0.113.9';
  let last;
  for (let i = 0; i < 6; i++) last = await sub(env, { email: 'p' + i + '@example.com', consent: true }, { ip });
  ok('a sixth request from one origin in ten minutes is refused', last.status === 429 && last.body.error === 'rate');
  ok('and the origin is kept as a keyed hash, not the address', !q(db, 'SELECT k FROM sub_hits').some(r => r.k.includes('203')));
  // A confirmation Resend refuses: an error the form can say, and no penalty.
  MAILMODE = 'refuse';
  const sf = await sub(env, { email: 'fails@example.com', consent: true });
  MAILMODE = 'ok';
  const sfRow = q(db, "SELECT confirm_sent_at, confirm_count FROM subscribers WHERE email = 'fails@example.com'")[0];
  ok('a confirmation that could not be sent says so', sf.status === 502 && sf.body.error === 'send_failed');
  ok('and does not count against the address, so a retry sends at once', sfRow.confirm_sent_at == null && sfRow.confirm_count === 0 && (await sub(env, { email: 'fails@example.com', consent: true })).status === 200);
}

// ── double opt-in ────────────────────────────────────────────────────────────
console.log('\ndouble opt-in');
{
  const db = makeDb(), env = envOf(db);
  MAIL.length = 0;
  await sub(env, { email: 'fan@example.com', consent: true, scoring: 'standard' });
  const link = linkIn(MAIL[0]);
  const g = await confirm(env, link, 'GET');
  const gh = await g.text();
  ok('following the link shows a button and confirms nothing (a scanner confirms nothing)', g.status === 200 && /<form method="post"/.test(gh) && q(db, 'SELECT status FROM subscribers')[0].status === 'pending');
  ok('the page names the address and the scoring', /fan@example\.com/.test(gh) && /Standard scoring/.test(gh));
  db.sqlite.prepare('INSERT INTO unsubscribes (email, created_at) VALUES (?, ?)').run('fan@example.com', 1);
  const p = await confirm(env, link, 'POST');
  const r = q(db, 'SELECT * FROM subscribers')[0];
  ok('pressing it confirms, at the scoring the link was signed for', p.status === 200 && r.status === 'confirmed' && r.scoring === 'standard' && r.confirmed_at > 0, JSON.stringify(r));
  ok('a confirmation lifts an earlier unsubscribe', !q(db, 'SELECT * FROM unsubscribes').length);
  const u = new URL(link);
  const tampered = new URL(link); tampered.searchParams.set('t', u.searchParams.get('t').replace(/.$/, c => c === 'A' ? 'B' : 'A'));
  ok('a tampered token is refused', (await confirm(env, tampered.toString(), 'POST')).status === 400);
  const other = new URL(link); other.searchParams.set('e', 'someone@example.com');
  ok('a token is good for its own address only', (await confirm(env, other.toString(), 'POST')).status === 400);
  const swapped = new URL(link); swapped.searchParams.set('t', u.searchParams.get('t').replace('.standard.', '.ppr.'));
  ok('the scoring cannot be swapped in the link', (await confirm(env, swapped.toString(), 'POST')).status === 400);
  const old = Date.now() - 8 * 86400000;
  const stale = ORIGIN + '/sunday/confirm?e=fan%40example.com&t=' + encodeURIComponent(await P5.subConfirmToken(env, 'fan@example.com', 'ppr', old));
  ok('a link older than seven days is refused', (await confirm(env, stale, 'POST')).status === 400);
  // Changing scoring: a new link, and the old scoring holds until it is used.
  MAIL.length = 0;
  await sub(env, { email: 'fan@example.com', consent: true, scoring: 'standard' });
  ok('a confirmed reader asking for the scoring they have is mailed nothing', MAIL.length === 0);
  db.sqlite.prepare('UPDATE subscribers SET confirm_sent_at = 0').run();
  await sub(env, { email: 'fan@example.com', consent: true, scoring: 'ppr' });
  const mid = q(db, 'SELECT status, scoring FROM subscribers')[0];
  ok('asking for another scoring mails a link and changes nothing yet', MAIL.length === 1 && mid.status === 'confirmed' && mid.scoring === 'standard', JSON.stringify(mid));
  await confirm(env, linkIn(MAIL[0]), 'POST');
  ok('using that link moves them to it', q(db, 'SELECT scoring FROM subscribers')[0].scoring === 'ppr');
  ok('without mail configured, a link confirms nothing', (await confirm({ LEADS_DB: db }, link, 'POST')).status === 400);
}

// ── the edition ──────────────────────────────────────────────────────────────
console.log('\nthe edition');
{
  // Three more players who clear every rule, so PPR has more than five.
  const clone = (n, k) => ({ ...JSON.parse(JSON.stringify(B.players.find(p => p.name === 'Drake London'))), name: n, key: 'c' + k + '|WR' });
  const big = { ...B, players: [...B.players, clone('Clone One', 1), clone('Clone Two', 2), clone('Clone Three', 3)] };
  const bigM = { ...M }; for (const n of ['Clone One', 'Clone Two', 'Clone Three']) bigM[P5._oddsNorm(n)] = M[P5._oddsNorm('Drake London')];
  P5.set(big, bigM);
  const ed = await P5.editionBuild({}, Date.UTC(2026, 9, 18, 11, 0));
  ok('PPR: five, the cap, widest first', ed.ok && ed.sets.ppr.length === 5 && ed.sets.ppr[0].gap === 5, ed.sets && ed.sets.ppr.map(x => x.name + ' ' + x.gap).join(', '));
  P5.set(B, M);
  const e2 = await P5.editionBuild({}, Date.UTC(2026, 9, 18, 11, 0));
  ok('fewer qualify, fewer are sent: four at PPR', e2.sets.ppr.length === 4 && e2.sets.ppr.map(x => x.name).join(', ') === 'Drake London, Derrick Henry, Goal Line Back, Cam Ward', e2.sets.ppr.map(x => x.name).join(', '));
  ok('each scoring is its own list (Standard admits Yards Guy)', e2.sets.standard.some(x => x.name === 'Yards Guy') && !e2.sets.ppr.some(x => x.name === 'Yards Guy'));
  ok('none of the suppressed players appears at any scoring', !['Questionable Runner', 'Kicked Off', 'One Book', 'Game Lines Only', 'No Quoted Line'].some(n => [...e2.sets.ppr, ...e2.sets.half, ...e2.sets.standard].some(x => x.name === n)));
  ok('with season, week, board and odds times', e2.season === 2026 && e2.week === 6 && e2.boardAt > 0 && e2.oddsAt > 0);
  const h = P5.editionHtml(e2, 'ppr', { 'Drake London': 'abcdef012345' }, ORIGIN);
  ok('the body names the season, week, scoring and when it was built', /2026 season &middot; Week 6 &middot; PPR scoring &middot; built Sun, 10\/18, 7:00 AM ET/.test(h), h.slice(0, 900));
  ok('every item: name, fixture, kickoff, market, consensus, gap', /<b>Drake London<\/b>/.test(h) && /WR ATL vs CAR/.test(h) && /Market <b>16\.0<\/b> &middot; consensus <b>11\.0<\/b>/.test(h) && /\+5\.0 pts/.test(h));
  ok('market points labelled a derived estimate, the line a quoted prop', (h.match(/Derived estimate:/g) || []).length === 4 && (h.match(/Quoted prop:/g) || []).length === 4);
  ok('the quoted line is the book’s, with when it was seen', /Books quote 89\.5 receiving yards; the consensus projects 60\. Line last seen/.test(h));
  ok('fewer than five is said, not padded', /Only 4 cleared the bar this week/.test(h));
  ok('items link to their stored finding, tagged for the newsletter', /\/f\/abcdef012345\?utm_source=newsletter&utm_medium=email&utm_campaign=2026-w06-sunday/.test(h));
  ok('a disagreement, not a prediction; the gambling line', /not a prediction of the result/.test(h) && /1-800-MY-RESET/.test(h));
  ok('no em dash anywhere in the email', !EM.test(h) && !EM.test(P5.editionText(e2, 'ppr', {}, ORIGIN)));
  ok('the subject counts what is in it', P5.editionSubject(e2, 'ppr') === 'Week 6: the 4 biggest Vegas-versus-expert differences (PPR)', P5.editionSubject(e2, 'ppr'));
  ok('and says "the biggest" for one', P5.editionSubject({ ...e2, sets: { ppr: [e2.sets.ppr[0]] } }, 'ppr') === 'Week 6: the biggest Vegas-versus-expert difference (PPR)');
  const env = envOf(makeDb());
  const m = await P5.editionMessage(env, e2, 'half', {}, ORIGIN, 'fan@example.com', false);
  const unsub = ORIGIN + '/api/unsubscribe?e=fan%40example.com&t=' + encodeURIComponent(await P5.unsubToken(env, 'fan@example.com'));
  ok('one-click unsubscribe in the headers and the footer', m.headers['List-Unsubscribe'] === '<' + unsub + '>' && m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && m.html.includes(unsub.replace(/&/g, '&')));
  ok('the footer says why, carries the postal address, and how to change scoring', /because you confirmed the Sunday email/.test(m.html) && m.html.includes(ADDR) && m.text.includes(ADDR) && /To change scoring/.test(m.html));
  ok('the half-PPR reader gets the half-PPR list', /Half PPR scoring/.test(m.html) && m.subject.endsWith('(Half PPR)'));
  ok('a test is marked in the subject', (await P5.editionMessage(env, e2, 'ppr', {}, ORIGIN, 'a@b.co', true)).subject.startsWith('[Test] '));
}

// ── the send ─────────────────────────────────────────────────────────────────
console.log('\nthe Sunday send');
{
  const db = makeDb(SUB_DDL);
  const seed = (email, status, scoring) => db.sqlite.prepare('INSERT INTO subscribers (email, status, scoring, source, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)').run(email, status, scoring, 't', 1, status === 'confirmed' ? 1 : null);
  const off = envOf(db);
  MAIL.length = 0;
  const r0 = await P5.runSundayEdition(off, Date.UTC(2026, 9, 18, 11, 0));
  ok('without SUNDAY_EMAIL_SEND=on the job is a logged no-op, not a failure', r0.ok === true && /SUNDAY_EMAIL_SEND/.test(r0.skipped) && !MAIL.length, JSON.stringify(r0));
  const r00 = await P5.runSundayEdition({ LEADS_DB: db, SUNDAY_EMAIL_SEND: 'on' });
  ok('and without credentials it says mail is not configured', r00.ok && r00.skipped === 'mail not configured' && r00.missing.length === 3);
  seed('a@example.com', 'confirmed', 'ppr'); seed('b@example.com', 'confirmed', 'half'); seed('c@example.com', 'confirmed', 'standard');
  seed('pending@example.com', 'pending', 'ppr'); seed('gone@example.com', 'confirmed', 'ppr');
  db.sqlite.prepare('INSERT INTO unsubscribes (email, created_at) VALUES (?, ?)').run('gone@example.com', 1);
  const env = envOf(db, { SUNDAY_EMAIL_SEND: 'on' });
  const r1 = await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 11, 0));
  const batch = MAIL.filter(x => /\/emails\/batch$/.test(x.url));
  const to = batch.flatMap(x => x.body.map(m => m.to)).sort().join(',');
  ok('one batch call to the confirmed, unsuppressed list', r1.ok && r1.sent === 3 && batch.length === 1 && to === 'a@example.com,b@example.com,c@example.com', JSON.stringify(r1) + ' ' + to);
  ok('pending and unsubscribed addresses get nothing', !/pending|gone/.test(to));
  ok('each at its own scoring', batch[0].body.find(m => m.to === 'b@example.com').subject.endsWith('(Half PPR)') && batch[0].body.find(m => m.to === 'c@example.com').subject.endsWith('(Standard)'));
  ok('every message carries its own unsubscribe header', batch[0].body.every(m => m.headers['List-Unsubscribe'].includes(encodeURIComponent(m.to))));
  const sends = q(db, 'SELECT * FROM edition_sends');
  ok('each send is recorded once, ok', sends.length === 3 && sends.every(s => s.ok === 1 && s.sent_at > 0));
  const run = q(db, 'SELECT * FROM edition_runs')[0];
  ok('the edition is stored with its counts', run && run.season === 2026 && run.week === 6 && run.sent === 3 && run.failed === 0);
  const fids = q(db, "SELECT id FROM findings WHERE origin = 'edition'");
  ok('every item of the edition is stored as a finding', fids.length >= 4 && batch[0].body.find(m => m.to === 'a@example.com').html.includes('/f/' + fids[0].id) || fids.some(f => batch[0].body[0].html.includes('/f/' + f.id)), String(fids.length));
  MAIL.length = 0;
  const r2 = await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 12, 0));
  ok('the 8 AM retry mails nobody twice', r2.ok && r2.sent === 0 && MAIL.length === 0, JSON.stringify(r2));
  // A claim another run holds is left to it.
  seed('d@example.com', 'confirmed', 'ppr'); seed('e@example.com', 'confirmed', 'ppr');
  db.sqlite.prepare('INSERT INTO edition_sends (season, week, email, claimed_at) VALUES (2026, 6, ?, ?)').run('d@example.com', Date.now());
  // The board moves between the runs: the stored edition is still the one sent.
  const moved = { ...B, players: B.players.map(p => p.name === 'Drake London' ? { ...p, vegas: { ...p.vegas, stats: { rec: 9, recYd: 120 } } } : p) };
  P5.set(moved, M);
  await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 12, 0));
  P5.set(B, M);
  const late = MAIL.filter(x => /batch/.test(x.url)).flatMap(x => x.body);
  ok('an address claimed by another run is not mailed by this one', late.length === 1 && late[0].to === 'e@example.com', late.map(m => m.to).join());
  ok('a later run sends the week’s first edition, not a rebuilt one', late[0] && /\+5\.0 pts/.test(late[0].html) && !/\+12/.test(late[0].html));
  // Refused outright: released for the next run.
  db.sqlite.prepare('DELETE FROM edition_sends').run(); db.sqlite.prepare('DELETE FROM edition_runs').run();
  MAIL.length = 0; MAILMODE = 'refuse';
  const r3 = await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 11, 0));
  ok('a batch Resend refuses is a failure with its reason', r3.ok === false && r3.failed === 5 && /Resend 500/.test(r3.error), JSON.stringify(r3));
  ok('its claims are released', !q(db, 'SELECT * FROM edition_sends').length);
  ok('and the edition records the failure', q(db, 'SELECT failed, last_error FROM edition_runs')[0].failed === 5);
  MAILMODE = 'ok';
  const r4 = await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 12, 0));
  ok('so the retry reaches them', r4.ok && r4.sent === 5);
  // No answer at all: it may have gone, so it is not sent again.
  db.sqlite.prepare('DELETE FROM edition_sends').run();
  MAILMODE = 'network';
  const r5 = await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 11, 0));
  MAILMODE = 'ok'; MAIL.length = 0;
  const r6 = await P5.runSundayEdition(env, Date.UTC(2026, 9, 18, 12, 0));
  ok('a batch with no answer is marked failed and not resent', r5.ok === false && q(db, 'SELECT COUNT(*) AS n FROM edition_sends WHERE ok = 0')[0].n === 5 && r6.sent === 0 && !MAIL.length, JSON.stringify(r6));
  // Batches of a hundred.
  const db2 = makeDb(SUB_DDL);
  const env2 = envOf(db2, { SUNDAY_EMAIL_SEND: 'on' });
  for (let i = 0; i < 250; i++) db2.sqlite.prepare("INSERT INTO subscribers (email, status, scoring, created_at) VALUES (?, 'confirmed', 'ppr', 1)").run('r' + String(i).padStart(3, '0') + '@example.com');
  MAIL.length = 0;
  const r7 = await P5.runSundayEdition(env2, Date.UTC(2026, 9, 18, 11, 0));
  ok('250 readers go in three batch calls of at most 100', r7.sent === 250 && MAIL.length === 3 && MAIL.every(x => x.body.length <= 100), MAIL.map(x => x.body.length).join());
  // A scoring where nothing qualifies sends nothing to its readers.
  const db3 = makeDb(SUB_DDL), env3 = envOf(db3, { SUNDAY_EMAIL_SEND: 'on' });
  db3.sqlite.prepare("INSERT INTO subscribers (email, status, scoring, created_at) VALUES ('s@example.com', 'confirmed', 'standard', 1)").run();
  P5.set({ ...B, players: B.players.filter(p => !['Drake London', 'Derrick Henry', 'Goal Line Back', 'Cam Ward', 'Yards Guy'].includes(p.name)) }, M);
  MAIL.length = 0;
  const r8 = await P5.runSundayEdition(env3, Date.UTC(2026, 9, 18, 11, 0));
  P5.set(B, M);
  ok('a scoring with no qualifying difference gets no email', r8.noDifferences === 1 && r8.sent === 0 && !MAIL.length, JSON.stringify(r8));
}

// ── findings ─────────────────────────────────────────────────────────────────
console.log('\nfindings');
const SHELL = fs.readFileSync(path.join(ROOT, 'finding.html'), 'utf8');
let FID = null, CID = null, FREC = null, CREC = null;
{
  const db = makeDb(), env = { LEADS_DB: db, ASSETS: { fetch: async () => new Response(SHELL) } };
  const a = await P5.findingCreate(env, { kind: 'gap', scoring: 'ppr', player: 'Drake London' });
  ok('a current example becomes a finding with a short id', a.status === 200 && /^[0-9a-f]{12}$/.test(a.body.id) && a.body.url === 'https://irontuna.com/f/' + a.body.id, JSON.stringify(a));
  const b = await P5.findingCreate(env, { kind: 'gap', scoring: 'ppr', player: 'Drake London' });
  ok('the same figures shared twice are one finding', b.body.id === a.body.id && q(db, 'SELECT COUNT(*) AS n FROM findings')[0].n === 1);
  const c = await P5.findingCreate(env, { kind: 'gap', scoring: 'half', player: 'Drake London' });
  ok('another scoring is another finding', c.body.id !== a.body.id);
  ok('a player who does not qualify now cannot be shared as a difference', (await P5.findingCreate(env, { kind: 'gap', scoring: 'ppr', player: 'Questionable Runner' })).body.error === 'not_current');
  ok('nor can a name not on the board', (await P5.findingCreate(env, { kind: 'gap', scoring: 'ppr', player: 'Nobody' })).status === 404);
  ok('a request carrying its own numbers is ignored for them', (await P5.findingCreate(env, { kind: 'gap', scoring: 'ppr', player: 'Drake London', market: 99, gap: 50 })).body.id === a.body.id);
  const cmp = await P5.findingCreate(env, { kind: 'compare', scoring: 'ppr', a: 'Game Lines Only', b: 'Drake London' });
  ok('a comparison of two players on the board', cmp.status === 200, JSON.stringify(cmp.body));
  FID = a.body.id; CID = cmp.body.id;
  FREC = await P5.findingRead(env, FID); CREC = await P5.findingRead(env, CID);
  ok('a comparison stores both sides at its scoring, higher projection first', CREC.players.length === 2 && CREC.players.every(p => Number.isFinite(p.ironTuna) && Number.isFinite(p.consensus)) && CREC.players[0].ironTuna >= CREC.players[1].ironTuna);
  ok('and gives a market figure only where it is priced entirely off props', CREC.players.find(p => p.name === 'Game Lines Only').market === null && CREC.players.find(p => p.name === 'Drake London').market === 16);
  ok('a finding stores figures and times, nothing about who shared it', Object.keys(FREC).sort().join() === 'boardAt,capturedAt,kind,oddsAt,preset,season,week,x', Object.keys(FREC).join());
  ok('the same player twice is not a comparison', (await P5.findingCreate(env, { kind: 'compare', scoring: 'ppr', a: 'Drake London', b: 'Drake London' })).status === 404);
  // The board moves; the stored finding does not.
  P5.set({ ...B, players: B.players.map(p => p.name === 'Drake London' ? { ...p, vegas: { ...p.vegas, stats: { rec: 9, recYd: 120 } } } : p) }, M);
  const page = await route(env, '/f/' + FID);
  const html = await page.text();
  P5.set(B, M);
  ok('the page reads the stored record, not the board', page.status === 200 && /<b>16\.0<\/b><span>Market<\/span>/.test(html) && /\+5\.0/.test(html), html.slice(html.indexOf('fdBody'), html.indexOf('fdBody') + 600));
  ok('it says when it was captured and that it does not change', /Captured [A-Z][a-z]{2}, \d+\/\d+, /.test(html) && /These figures are stored and do not change/.test(html));
  ok('with season, week and scoring, and both labels', /2026 season &middot; Week 6 &middot; PPR scoring/.test(html) && /Derived estimate/.test(html) && /Quoted prop/.test(html));
  ok('it links the live view apart from itself', /The live view: <a href="\/player\/drake-london">/.test(html));
  ok('its title, description, canonical and social tags are the finding’s', /<title>Drake London: market 16\.0, consensus 11\.0 \(Week 6, PPR\) \| Iron Tuna<\/title>/.test(html)
    && html.includes('<link rel="canonical" href="https://irontuna.com/f/' + FID + '">') && html.includes('<meta property="og:url" content="https://irontuna.com/f/' + FID + '">')
    && /<meta property="og:title" content="Drake London: market/.test(html) && /<meta name="twitter:description" content="The betting market projects Drake London 5\.0 points above/.test(html));
  ok('noindex: a dated snapshot, not a page to rank', /<meta name="robots" content="noindex,follow">/.test(html));
  ok('the share controls and the image are switched on', /<div class="fd-share" id="fdShare">/.test(html) && html.includes('src="/f/' + FID + '.svg"'));
  ok('no em dash in what the worker writes', !EM.test(html.slice(html.indexOf('<main'), html.indexOf('</main>'))));
  ok('served cacheable, since it never changes', /max-age=3600/.test(page.headers.get('cache-control')));
  const svg = await route(env, '/f/' + FID + '.svg');
  const st = await svg.text();
  ok('the share image: player, gap, numbers, week, scoring, capture time, the name', svg.headers.get('content-type').startsWith('image/svg+xml') && /Drake London/.test(st) && /\+5\.0 pts/.test(st)
    && /Market 16\.0/.test(st) && /Week 6 · PPR/.test(st) && /Captured /.test(st) && /IRON TUNA/.test(st), st.slice(0, 400));
  const cp = await (await route(env, '/f/' + CID)).text();
  ok('a comparison page shows both players and says when a market figure is missing', /Game Lines Only or Drake London|Drake London or Game Lines Only/.test(cp) && /not fully priced off props/.test(cp));
  ok('an unknown id is a 404 page', (await route(env, '/f/000000000000')).status === 404);
  ok('a malformed one is not a finding route at all', (await route(env, '/f/../../etc')) === null);
  ok('Washington: no finding page and no new findings', (await route(env, '/f/' + FID, { wa: true })).status === 451 && (await route(env, '/api/finding', { wa: true, method: 'POST', body: { player: 'Drake London' } })).status === 451);
  const viaRoute = await route(env, '/api/finding', { method: 'POST', body: { kind: 'gap', scoring: 'ppr', player: 'Drake London' } });
  ok('POST /api/finding answers the same id', (await viaRoute.json()).id === FID);
  // Every distinct pair is a stored row, so the origin limit bounds the table.
  const lim = envOf(makeDb(SUB_DDL), { ASSETS: env.ASSETS });
  let lastF;
  for (let i = 0; i < 31; i++) lastF = await route(lim, '/api/finding', { method: 'POST', ip: '198.51.100.7', body: { kind: 'gap', scoring: 'ppr', player: 'Drake London' } });
  ok('a 31st finding from one origin in ten minutes is refused', lastF.status === 429);
}

// ── /admin ───────────────────────────────────────────────────────────────────
console.log('\n/admin');
{
  const db = makeDb(), env = envOf(db, { ASSETS: { fetch: async () => new Response('') } });
  ok('the routes need the key', (await route(env, '/api/admin/edition')).status === 403 && (await route(env, '/api/admin/edition?key=nope')).status === 403);
  await sub(env, { email: 'x@example.com', consent: true });
  const st = await (await route(env, '/api/admin/edition?key=k')).json();
  ok('status: configured, the switch, counts, never addresses', st.ok && st.config.mailConfigured && st.config.sendSwitch === 'off' && st.counts.pending === 1 && !JSON.stringify(st).includes('x@example.com'), JSON.stringify(st));
  MAIL.length = 0;
  const pv = await route(env, '/api/admin/edition?key=k&format=html&scoring=standard');
  const ph = await pv.text();
  ok('the preview is the email at that scoring, built now', /Week 6: the \d biggest Vegas-versus-expert differences \(Standard\)/.test(ph) && /Yards Guy/.test(ph));
  ok('and sends nothing', MAIL.length === 0);
  const nt = await route({ LEADS_DB: db, LEADS_EXPORT_KEY: 'k' }, '/api/admin/edition-test?key=k', { method: 'POST', body: { to: 'me@example.com' } });
  ok('a test send without mail configured says what is missing', (await nt.json()).missing.length === 3);
  const t = await (await route(env, '/api/admin/edition-test?key=k', { method: 'POST', body: { to: 'me@example.com', scoring: 'ppr' } })).json();
  ok('a test send goes to that one address, marked [Test]', t.ok && MAIL.length === 1 && MAIL[0].body.to === 'me@example.com' && MAIL[0].body.subject.startsWith('[Test] Week 6'), JSON.stringify(t));
  ok('and is not recorded as a send', !q(db, 'SELECT * FROM edition_sends').length);
}

// ── the real worker ──────────────────────────────────────────────────────────
console.log('\nthe real worker');
{
  const worker = (await import(path.join(ROOT, '_worker.js'))).default;
  const DDL = eval(W.match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);
  const db = makeDb(DDL);
  const ASSETS = { fetch: async (r) => new Response(new URL(r.url).pathname === '/finding' ? SHELL : 'asset') };
  const call = (p, env, o = {}) => worker.fetch(new Request(ORIGIN + p, { method: o.method || 'GET', headers: { 'user-agent': 'Mozilla/5.0 Chrome/126', 'content-type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined }), env, { waitUntil() {} });
  const env = { ...envOf(db), ASSETS };
  ok('/api/subscribe is routed', (await (await call('/api/subscribe', env)).json()).open === true);
  ok('/finding itself is not a page', (await call('/finding', env)).status === 404);
  // Seed a confirmed reader, then unsubscribe through the real route.
  await call('/api/subscribe', env, { method: 'POST', body: { email: 'reader@example.com', consent: true } });
  db.sqlite.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE email = 'reader@example.com'").run(Date.now());
  const uu = await call('/api/unsubscribe?e=reader%40example.com&t=' + encodeURIComponent(await P5.unsubToken(env, 'reader@example.com')), env);
  ok('the unsubscribe link suppresses the address and marks the list', uu.status === 200 && q(db, 'SELECT status FROM subscribers')[0].status === 'unsubscribed' && q(db, 'SELECT COUNT(*) AS n FROM unsubscribes')[0].n === 1);
  db.sqlite.prepare("INSERT INTO subscribers (email, status, scoring, created_at, confirmed_at) VALUES ('new@example.com', 'confirmed', 'ppr', 1, ?)").run(Date.now());
  const use = await (await call('/api/admin/usage?key=k&days=30', env)).json();
  ok('/admin counts confirmed subscriptions from the list', use.subscriptions && use.subscriptions.confirmed === 1 && use.subscriptions.confirmedList === 1 && use.subscriptions.pending === 0, JSON.stringify(use.subscriptions));
  ok('the job is registered and scheduled Sunday 7 and 8 AM ET, after the pulls', /'sunday-edition':\s+env => runSundayEdition\(env\)/.test(W) && /\{ job: 'sunday-edition',\s+days: \['Sun'\],\s+hours: \[7, 8\],\s+phase: 3 \}/.test(W));
}

// ── the browser ──────────────────────────────────────────────────────────────
const REQUIRE = process.env.REQUIRE_BROWSER === '1';
let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch (e) {}
const CHROME = chromium && [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome',
  (() => { try { return chromium.executablePath(); } catch (e) { return null; } })()].find(p => p && fs.existsSync(p));
if (!chromium || !CHROME) {
  if (REQUIRE) { console.error('FAIL — no playwright-core or Chromium, and REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('\nSKIP — browser checks (no playwright-core or Chromium)');
} else {
  console.log('\nin the browser');
  // "/" as the worker serves it, the examples written in.
  const FRONT = (() => {
    const H = new Function([W.slice(W.indexOf('// ── the scoring engine ─'), W.indexOf('const COLUMN_SCORING = {')), lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'),
      lift('function _etStamp(ms) {', '\n}'), W.slice(W.indexOf('const HOME_EX_MAX = 3;'), W.indexOf('function homeShellFill(html, hp) {')), lift('function homeShellFill(html, hp) {', '\n}')].join('\n')
      + '\nreturn { homePrerender, homeShellFill, _oddsNorm };')();
    return H.homeShellFill(fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8'), H.homePrerender(homeBoard(), homeMarkets(H._oddsNorm)));
  })();
  const FPAGE = P5.findingShellFill(SHELL, FREC, FID), FSVG = P5.findingSvg(FREC);
  const st = (i, k) => ({ rec: (5 - i * 0.05) * k, recYd: (60 - i) * k, recTD: 0.4 * k, rushYd: (40 - i * 0.5) * k, rushTD: 0.3 * k });
  const BOARDS = { ok: true, season: 2026, horizon: { key: 'week', label: 'This week', weeks: [6] },
    players: Array.from({ length: 30 }, (_, i) => ({ name: 'Flex Player ' + i, position: ['RB', 'WR', 'TE'][i % 3], team: 'ATL', weeks: [{ week: 6, opponent: 'KC', home: true }],
      ironTuna: { points: 16 - i * 0.25, stats: st(i, 1) }, consensus: { points: 16, stats: st(i, 1) }, vegas: { points: 15, basis: 'props', stats: st(i, 1) },
      marketDelta: { points: (i % 3 - 1) * 1.4 } })) };
  let OPEN = true, SUBRESP = { ok: true };
  const POSTS = [], TRACK = [];
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  const server = http.createServer((rq, res) => {
    const u = new URL(rq.url, 'http://x');
    const body = () => new Promise(r => { let b = ''; rq.on('data', c => b += c); rq.on('end', () => { try { r(JSON.parse(b)); } catch (e) { r(b); } }); });
    const send = (code, type, s) => { res.writeHead(code, { 'content-type': type }); res.end(s); };
    if (u.pathname === '/api/track') return body().then(b => { TRACK.push(b); send(204, 'text/plain', ''); });
    if (u.pathname === '/api/subscribe') {
      if (rq.method === 'GET') return send(200, 'application/json', JSON.stringify({ ok: true, open: OPEN }));
      return body().then(b => { POSTS.push({ path: u.pathname, b }); send(SUBRESP.ok ? 200 : 400, 'application/json', JSON.stringify(SUBRESP)); });
    }
    if (u.pathname === '/api/finding') return body().then(b => { POSTS.push({ path: u.pathname, b }); send(200, 'application/json', JSON.stringify({ ok: true, id: FID })); });
    if (u.pathname === '/api/boards') return send(200, 'application/json', JSON.stringify(BOARDS));
    if (u.pathname.startsWith('/api/')) return send(200, 'application/json', '{"ok":false}');
    if (u.pathname === '/') return send(200, 'text/html', FRONT);
    if (u.pathname === '/f/' + FID) return send(200, 'text/html', FPAGE);
    if (u.pathname === '/f/' + FID + '.svg') return send(200, 'image/svg+xml', FSVG);
    const p = /\.[a-z0-9]+$/.test(u.pathname) ? u.pathname : u.pathname + '.html';
    const fp = path.join(ROOT, p.slice(1));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(404, 'text/plain', 'nf');
    send(200, TYPES[path.extname(fp)] || 'application/octet-stream', fs.readFileSync(fp));
  });
  await new Promise(r => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  async function ctxAt(width) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
    await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await ctx.route(/googletagmanager|google-analytics|doubleclick|fonts\.g/, r => r.abort());
    return ctx;
  }
  const settle = (ms) => new Promise(r => setTimeout(r, ms || 400));
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const ev = (name, tool) => TRACK.filter(t => t && t.event === name && (!tool || (t.props && t.props.tool === tool)));

  // /sunday, closed and open.
  {
    OPEN = false;
    const ctx = await ctxAt(390), page = await ctx.newPage();
    page.on('pageerror', e => errors.push('sunday: ' + e.message));
    await page.goto(BASE + '/sunday', { waitUntil: 'load' }); await settle();
    ok('/sunday while closed: says so, draws no form', await page.locator('.it-sub-closed').count() === 1 && await page.locator('form.it-sub').count() === 0);
    OPEN = true;
    await page.reload({ waitUntil: 'load' }); await settle();
    ok('/sunday while open: the form, with no "Not now"', await page.locator('form.it-sub').count() === 1 && await page.locator('.it-sub-no').count() === 0);
    await page.click('form.it-sub button[type=submit]');
    ok('an empty address is caught before sending', /does not look like an email/.test(await page.textContent('.it-sub-msg')) && !POSTS.length);
    await page.fill('form.it-sub input[type=email]', 'reader@example.com');
    await page.click('form.it-sub button[type=submit]');
    ok('no consent, no request', /Tick the box/.test(await page.textContent('.it-sub-msg')) && !POSTS.length);
    await page.check('form.it-sub input[name=consent]');
    await page.selectOption('form.it-sub select[name=scoring]', 'half');
    await page.click('form.it-sub button[type=submit]'); await settle(600);
    const p = POSTS.find(x => x.path === '/api/subscribe');
    ok('it sends the address, the scoring, consent and the form, nothing else', p && p.b.email === 'reader@example.com' && p.b.scoring === 'half' && p.b.consent === true && p.b.tool === 'sunday_page' && p.b.website === '', JSON.stringify(p));
    ok('and asks the reader to confirm', /Check your inbox/.test(await page.textContent('.it-sub-msg')));
    const sr = ev('subscribe_request', 'sunday_page');
    ok('subscribe_request is sent once, with no address in it', sr.length === 1 && !JSON.stringify(TRACK).includes('reader@example.com'), JSON.stringify(sr));
    SUBRESP = { ok: false, error: 'rate' };
    await page.fill('form.it-sub input[type=email]', 'other@example.com'); await page.check('form.it-sub input[name=consent]');
    await page.click('form.it-sub button[type=submit]'); await settle(500);
    ok('a refusal is said in words', /Too many requests/.test(await page.textContent('.it-sub-msg')));
    SUBRESP = { ok: true };
    ok('/sunday fits a phone', await overflow(page) <= 0);
    ok('the footer links /sunday', await page.locator('footer.site a[href="/sunday"]').count() === 1);
    await ctx.close();
  }
  // The homepage: share each example; the offer, and "Not now".
  {
    POSTS.length = 0; TRACK.length = 0;
    const ctx = await ctxAt(390), page = await ctx.newPage();
    page.on('pageerror', e => errors.push('home: ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'load' }); await settle(700);
    const cards = await page.locator('#hmExSets [data-scoring="ppr"] .hm-ex').count();
    ok('every example has share controls', cards === 3 && await page.locator('#hmExSets [data-scoring="ppr"] .hm-ex .it-share').count() === 3);
    ok('nothing is stored by viewing', !POSTS.some(x => x.path === '/api/finding'));
    await page.locator('#hmExSets [data-scoring="ppr"] .hm-ex').first().locator('button[data-share-method="copy_link"]').click(); await settle(600);
    const fp = POSTS.find(x => x.path === '/api/finding');
    ok('copying asks the server for that example’s finding, by name and scoring only', fp && JSON.stringify(fp.b) === JSON.stringify({ kind: 'gap', scoring: 'ppr', player: 'Drake London' }), JSON.stringify(fp && fp.b));
    ok('and puts its link on the clipboard', (await page.evaluate(() => navigator.clipboard.readText())) === BASE + '/f/' + FID);
    ok('share_click: home_examples, copy_link', ev('share_click', 'home_examples').some(t => t.props.method === 'copy_link'));
    ok('the offer sits under the examples', await page.locator('#hmSub form.it-sub').count() === 1);
    await page.click('#hmSub .it-sub-no');
    ok('"Not now" removes it', await page.locator('#hmSub form.it-sub').count() === 0);
    await page.reload({ waitUntil: 'load' }); await settle(600);
    ok('and it stays away on the next visit', await page.locator('#hmSub form.it-sub').count() === 0);
    ok('the homepage still fits a phone', await overflow(page) <= 0);
    await ctx.close();
    OPEN = false;
    const c2 = await ctxAt(1280), p2 = await c2.newPage();
    p2.on('pageerror', e => errors.push('home closed: ' + e.message));
    await p2.goto(BASE + '/', { waitUntil: 'load' }); await settle(600);
    ok('while sign-ups are closed there is no offer at all', await p2.locator('#hmSub *').count() === 0);
    await c2.close();
    OPEN = true;
  }
  // The flex call's comparison.
  {
    POSTS.length = 0;
    const ctx = await ctxAt(1280), page = await ctx.newPage();
    page.on('pageerror', e => errors.push('fantasy: ' + e.message));
    await page.goto(BASE + '/fantasy', { waitUntil: 'load' });
    await page.waitForSelector('#fnFlexShare .it-share', { timeout: 6000 }).catch(() => {});
    ok('the flex call can be shared', await page.locator('#fnFlexShare button[data-share-method="copy_link"]').count() === 1);
    await page.click('#fnFlexShare button[data-share-method="copy_link"]'); await settle(600);
    const fp = POSTS.find(x => x.path === '/api/finding');
    const names = await page.$$eval('#fnFlex b', bs => bs.map(b => b.textContent));
    ok('as a comparison of the two players it names, at the board’s scoring', fp && fp.b.kind === 'compare' && fp.b.scoring === 'ppr' && fp.b.a === names[0] && fp.b.b === names[1], JSON.stringify(fp && fp.b) + ' ' + names);
    await ctx.close();
  }
  // The finding page.
  {
    TRACK.length = 0;
    const ctx = await ctxAt(390), page = await ctx.newPage();
    page.on('pageerror', e => errors.push('finding: ' + e.message));
    await page.goto(BASE + '/f/' + FID, { waitUntil: 'load' }); await settle(600);
    const h1 = await page.textContent('#fdBody h1'), nums = await page.textContent('.fd-nums');
    ok('the finding page: its player, its numbers', h1 === 'Drake London' && /16\.0/.test(nums), h1 + ' / ' + nums);
    ok('the image is drawn, 1200 by 630', await page.evaluate(() => { const i = document.getElementById('fdImg'); return i.complete && i.naturalWidth === 1200 && i.naturalHeight === 630; }));
    ok('copy link and save image are offered', await page.locator('#fdShare button[data-share-method="copy_link"]').count() === 1 && await page.locator('#fdShare button[data-share-method="image"]').count() === 1);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('#fdShare button[data-share-method="image"]')]);
    ok('save image produces a PNG', dl && dl.suggestedFilename() === 'iron-tuna-finding.png');
    await page.click('#fdShare button[data-share-method="copy_link"]'); await settle(400);
    ok('copy link copies this page’s own address', (await page.evaluate(() => navigator.clipboard.readText())) === BASE + '/f/' + FID);
    ok('both uses are counted, with the method', ['image', 'copy_link'].every(m => ev('share_click', 'finding').some(t => t.props.method === m)));
    ok('the finding page fits a phone', await overflow(page) <= 0);
    ok('the finding page offers the Sunday email', await page.locator('#fdSub form.it-sub').count() === 1);
    await ctx.close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
