#!/usr/bin/env node
// The Sunday email and shared findings (docs/growth-plan.md, Phase 5,
// 17 Oct 2026).
//   node tools/test-newsletter.mjs
//
// Lifts the "THE SUNDAY EMAIL AND SHARED FINDINGS" section of _worker.js with
// the homepage examples it is cut from, and runs it against an in-memory
// SQLite database and a recorded Resend. Then drives the real worker's routes.
// It pins:
//   - the edition: homeExamples' rules, five at most, fewer when fewer
//     qualify, nothing kicking off within four hours, frozen once per week;
//   - the email: labels, scoring, week, timestamps, the dated links, the
//     unsubscribe link and postal address, a plain-text part, no em dash;
//   - double opt-in: consent, validation, the generic answer, the throttles,
//     only the newest link confirms, a failed confirmation send is retryable;
//   - suppression: an unsubscribe stops the edition; a fresh confirmation
//     restarts it;
//   - the Sunday job: off without its settings, only inside the window, one
//     delivery per address per week however often it runs, batches, failure
//     logging, a scoring with nothing to send is skipped;
//   - findings: immutable, one id per set of figures, the shell fill, the
//     image, nothing from a league;
//   - the routes: status, subscribe, confirm, unsubscribe, /finding/<id> and
//     its image, the admin gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const lift = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); const j = src.indexOf(b, i); if (j < 0) throw new Error('not found: ' + b); return src.slice(i, j + b.length); };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cut ' + a); return src.slice(i, j); };

// ── a D1 over SQLite, with changes reported the way D1 reports them ───────
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  return { sqlite, prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
    async run() { const r = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
    async first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; } }; } };
}
// ── a recorded Resend ─────────────────────────────────────────────────────
const sent = [];
let resendFails = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u).startsWith('https://api.resend.com/')) {
    const body = JSON.parse(init.body);
    if (resendFails > 0) { resendFails--; return new Response(JSON.stringify({ message: 'invalid key' }), { status: 401 }); }
    sent.push(body);
    return new Response(JSON.stringify({ id: 'msg_' + sent.length }), { status: 200 });
  }
  return realFetch(u, init);
};

// ── the lifted section ────────────────────────────────────────────────────
const SECTION = cut('// THE SUNDAY EMAIL AND SHARED FINDINGS START', '// THE SUNDAY EMAIL AND SHARED FINDINGS END');
const ENGINE = src.slice(src.indexOf('// ── the scoring engine ─'), src.indexOf('const COLUMN_SCORING = {'));
const HOME = src.slice(src.indexOf('const HOME_EX_MAX = 3;'), src.indexOf('function homeShellFill(html, hp) {'));
let BOARD = homeBoard();
const stubs = `
  const boardsPayload = async () => __board();
  const boardStillToPlay = (b) => b;
  const marketHistoryWeek = async () => __markets;
`;
// The fixture's markets are keyed by the worker's own _oddsNorm.
const NORM = new Function(lift('const _oddsNorm = ', ';\n') + '\nreturn _oddsNorm;')();
const M = homeMarkets(NORM);
const H2 = new Function('__board', '__markets', 'LEAD_TZ', [ENGINE, lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'), lift('function _etStamp(ms) {', '\n}'),
  lift('function b64urlEncode(bytes) {', '\n'), lift('async function hmacSign(secret, data) {', '\n'), lift('function timingSafeEq(a, b) {', '\n'),
  lift('async function unsubToken(env, email) {', '\n'),
  cut('function etOffsetHours(ms) {', 'function etClock(ms) {'), cut('function etParts(ms) {', 'const _etDow = '),
  HOME, stubs, SECTION].join('\n')
  + '\nreturn { homeExamples, newsletterEdition, newsletterEmail, newsletterSubject, nlConfig, newsletterSubscribe, newsletterConfirm, newsletterUnsubscribe, runNewsletterSend, newsletterAdmin, newsletterPreview, findingFreeze, findingRead, findingGapRec, findingCompareRec, findingShellFill, findingBodyHtml, findingSvg, findingTitle, nlReady, unsubToken, hmacSign, _etStamp, NL_BATCH, NL_CONSENT };');
const N = H2(() => BOARD, M, 'America/New_York');

const KICK = Date.UTC(2026, 9, 18, 17, 0);             // Sun 10/18 1:00 PM ET
const SUN8 = Date.UTC(2026, 9, 18, 12, 0);             // Sun 10/18 8:00 AM ET
const SAT = Date.UTC(2026, 9, 17, 14, 0);              // Sat 10/17 10:00 AM ET
const names = (xs) => xs.map(x => x.name).join(', ');
const envOn = (db, extra) => ({ LEADS_DB: db, AUTH_SECRET: 'sekrit', RESEND_API_KEY: 're_x', MAIL_ADDRESS: '1 Example Way, Boston, MA 02110', NEWSLETTER_ENABLED: '1', ...(extra || {}) });

// ── the edition ───────────────────────────────────────────────────────────
console.log('\nthe edition');
{
  const ed = N.newsletterEdition(BOARD, M, SAT);
  const top3 = N.homeExamples(BOARD, M, 'ppr');
  ok('built off the homepage rules: its first three are the homepage\'s three', names(ed.presets.ppr.slice(0, 3)) === names(top3), names(ed.presets.ppr));
  ok('more than three when more qualify (Cam Ward is fourth at PPR)', ed.presets.ppr.length === 4 && ed.presets.ppr[3].name === 'Cam Ward', names(ed.presets.ppr));
  ok('never more than five', ['ppr', 'half', 'standard'].every(p => ed.presets[p].length <= 5));
  {
    const many = { ...BOARD, players: BOARD.players.concat([1, 2, 3, 4].map(i => ({ ...BOARD.players[0], name: 'Drake London ' + i, key: 'dl' + i }))) };
    const M2 = { ...M }; for (let i = 1; i <= 4; i++) M2[NORM('Drake London ' + i)] = M[NORM('Drake London')];
    const e2 = N.newsletterEdition(many, M2, SAT);
    ok('five when eight qualify', e2.presets.ppr.length === 5, String(e2.presets.ppr.length));
  }
  ok('the suppression rules carry over: no ruled-out player in any preset',
     !['Questionable Runner', 'Priced Out Wideout', 'Partly Priced', 'Kicked Off', 'Bye Week', 'No Quoted Line', 'One Book'].some(n => Object.values(ed.presets).flat().some(x => x.name === n)));
  ok('season, week, when built, when the board and odds were read', ed.season === 2026 && ed.week === 6 && ed.builtAt === SAT && ed.boardAt && ed.oddsAt);
  const late = N.newsletterEdition(BOARD, M, KICK - 3 * 3600000);
  ok('nobody kicking off within four hours of the build', late.any === false && Object.values(late.counts).every(n => n === 0), JSON.stringify(late.counts));
  ok('four hours and a minute is enough', N.newsletterEdition(BOARD, M, KICK - 4 * 3600000 - 60000).any === true);
  ok('no week board, no edition', N.newsletterEdition({ ...BOARD, horizon: { key: 'ros', weeks: [6, 7] } }, M, SAT) === null);
  ok('no quoted lines, an edition with nothing in it (not invented differences)', N.newsletterEdition(BOARD, {}, SAT).any === false);
}

// ── the email ─────────────────────────────────────────────────────────────
console.log('\nthe email');
{
  const ed = N.newsletterEdition(BOARD, M, SAT);
  const m = N.newsletterEmail(ed, 'ppr', { origin: 'https://irontuna.com', finding: { 'Drake London': 'https://irontuna.com/finding/abc' }, unsub: 'https://irontuna.com/api/unsubscribe?e=a%40b.co&t=T', address: '1 Example Way, Boston, MA 02110' });
  ok('the subject counts what is in it, at the reader\'s scoring', m.subject === 'Week 6: the 4 biggest Vegas-versus-expert differences (PPR)', m.subject);
  ok('the week, the scoring and when it was built', m.html.includes('Week 6 · PPR · built ' + N._etStamp(SAT)), m.html.slice(0, 300));
  ok('each figure labelled: market points a derived estimate, the explanation a quoted prop', /<b>Derived estimate:<\/b> market points converted from 6 books/.test(m.html) && m.html.includes('<b>Quoted prop:</b> Books quote 89.5 receiving yards; the consensus projects 60.'));
  ok('a name links to its dated finding, tagged per the UTM convention', m.html.includes('href="https://irontuna.com/finding/abc?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=2026-w06-sunday"'));
  ok('a name with no frozen finding links to the player page', m.html.includes('https://irontuna.com/player/derrick-henry?utm_source=newsletter'));
  ok('fewer than five is said', m.html.includes('Only 4 cleared the bar this week.'));
  ok('not a prediction, not betting advice', /not a prediction of the result and not betting advice/.test(m.html));
  ok('why they got it, the unsubscribe link and the postal address in the footer', m.html.includes('you confirmed a subscription') && m.html.includes('href="https://irontuna.com/api/unsubscribe?e=a%40b.co&amp;t=T"') && m.html.includes('1 Example Way, Boston, MA 02110'));
  ok('the site\'s 21+ and gambling-help notice, in both parts', m.html.includes('21+') && m.html.includes('1-800-MY-RESET') && m.text.includes('1-800-MY-RESET'));
  ok('a plain-text part with the same content', m.text.includes('1. Drake London (WR ATL vs CAR') && m.text.includes('Unsubscribe: https://irontuna.com/api/unsubscribe') && m.text.includes('derived estimate from 6 books'));
  ok('mobile first: one column, a max width, a viewport', m.html.includes('max-width:560px') && m.html.includes('name="viewport"'));
  ok('no em dash anywhere', !/—/.test(m.html + m.text + m.subject));
  const t = N.newsletterEmail(ed, 'ppr', { test: true, unsub: '#', address: 'x' });
  ok('a test says so in the subject and on top', t.subject.startsWith('[Test] ') && t.html.includes('Test send. This copy went only to you'));
  const evil = N.newsletterEmail({ ...ed, presets: { ppr: [{ ...ed.presets.ppr[0], name: '<script>x</script>' }] } }, 'ppr', {});
  ok('names are escaped', !evil.html.includes('<script>x') && evil.html.includes('&lt;script&gt;'));
  ok('one difference reads as one', N.newsletterSubject({ ...ed, presets: { ppr: [ed.presets.ppr[0]] } }, 'ppr') === 'Week 6: the one Vegas-versus-expert difference (PPR)');
}

// ── the switch ────────────────────────────────────────────────────────────
console.log('\nthe switch');
{
  const c0 = N.nlConfig({});
  ok('off with nothing set, and says what it needs', c0.open === false && ['LEADS_DB', 'AUTH_SECRET', 'RESEND_API_KEY', 'MAIL_ADDRESS', 'NEWSLETTER_ENABLED=1'].every(n => c0.need.includes(n)), c0.need.join(','));
  const db = makeDb();
  ok('mail settings without the flag: a test can send, subscribers cannot sign up', (c => !c.open && c.canSend)(N.nlConfig({ ...envOn(db), NEWSLETTER_ENABLED: '' })));
  ok('the flag without a postal address stays off', N.nlConfig({ ...envOn(db), MAIL_ADDRESS: '' }).open === false);
  ok('everything set: open', N.nlConfig(envOn(db)).open === true);
}

// ── double opt-in ─────────────────────────────────────────────────────────
console.log('\nsign-up and confirmation');
const db = makeDb();
const env = envOn(db);
const O = 'https://irontuna.com';
const confirmLink = (msg) => (/href="(https:\/\/irontuna\.com\/api\/newsletter\/confirm\?[^"]+)"/.exec(msg.html) || [])[1].replace(/&amp;/g, '&');
const params = (u) => new URL(u).searchParams;
{
  let r = await N.newsletterSubscribe({ ...env, NEWSLETTER_ENABLED: '' }, O, { email: 'a@b.co', consent: true });
  ok('closed: refused, nothing stored or sent', r.status === 503 && r.body.error === 'closed' && sent.length === 0);
  r = await N.newsletterSubscribe(env, O, { email: 'not-an-email', consent: true });
  ok('an invalid address is refused', r.status === 400 && r.body.error === 'invalid_email');
  r = await N.newsletterSubscribe(env, O, { email: 'reader@example.com' });
  ok('no consent, no sign-up', r.status === 400 && r.body.error === 'consent_required' && sent.length === 0);
  r = await N.newsletterSubscribe(env, O, { email: 'reader@example.com', consent: 'yes' });
  ok('consent must be an explicit true', r.status === 400);
  await N.nlReady(env);
  r = await N.newsletterSubscribe(env, O, { email: 'bot@example.com', consent: true, company: 'x' });
  ok('the honeypot answers like a success and stores nothing', r.status === 200 && sent.length === 0 && !(await db.prepare("SELECT 1 FROM newsletter_subscribers WHERE email = 'bot@example.com'").first()));
  const t0 = SAT;
  r = await N.newsletterSubscribe(env, O, { email: ' Reader@Example.com ', consent: true, scoring: 'half', source: 'home' }, t0);
  const row = await db.prepare("SELECT * FROM newsletter_subscribers WHERE email = 'reader@example.com'").first();
  ok('a new address: pending, normalised, with its scoring, source and the consent wording', r.body.state === 'check_inbox' && row.status === 'pending' && row.scoring === 'half' && row.source === 'home' && row.consent === N.NL_CONSENT);
  ok('one confirmation email, to that address, with a text part', sent.length === 1 && sent[0].to === 'reader@example.com' && /Confirm/.test(sent[0].subject) && /Confirm: https/.test(sent[0].text));
  ok('the confirmation email carries the postal address and says nothing is sent until they confirm', sent[0].html.includes('1 Example Way') && /Nothing is sent until you confirm/.test(sent[0].html));
  const link1 = confirmLink(sent[0]);
  r = await N.newsletterSubscribe(env, O, { email: 'reader@example.com', consent: true }, t0 + 60000);
  ok('asked again within fifteen minutes: the same answer, no second email', r.body.state === 'check_inbox' && sent.length === 1);
  ok('a bad token does not confirm', (await N.newsletterConfirm(env, new URLSearchParams({ e: 'reader@example.com', s: String(t0), t: 'nope' }), t0, true)).ok === false);
  let c = await N.newsletterConfirm(env, params(link1), t0 + 100000, false);
  ok('opening the link (a GET, or a mail scanner) only asks; nothing changes', c.ok && c.ask && (await db.prepare("SELECT status FROM newsletter_subscribers WHERE email = 'reader@example.com'").first()).status === 'pending');
  c = await N.newsletterConfirm(env, params(link1), t0 + 120000, true);
  const row2 = await db.prepare("SELECT * FROM newsletter_subscribers WHERE email = 'reader@example.com'").first();
  ok('the link confirms', c.ok && row2.status === 'confirmed' && row2.confirmed_at === t0 + 120000 && c.scoring === 'half');
  c = await N.newsletterConfirm(env, params(link1), t0 + 180000, true);
  ok('clicking it twice is harmless', c.ok && c.already);
  r = await N.newsletterSubscribe(env, O, { email: 'reader@example.com', consent: true, scoring: 'standard' }, t0 + 3600000);
  const row3 = await db.prepare("SELECT * FROM newsletter_subscribers WHERE email = 'reader@example.com'").first();
  ok('a confirmed address typed in again: the same answer, no email, its scoring unchanged', r.body.state === 'check_inbox' && sent.length === 1 && row3.scoring === 'half' && row3.status === 'confirmed');

  // A second address: an old link stops working once a newer one is sent; an expired one never works.
  await N.newsletterSubscribe(env, O, { email: 'two@example.com', consent: true }, t0);
  const old = confirmLink(sent[sent.length - 1]);
  await N.newsletterSubscribe(env, O, { email: 'two@example.com', consent: true }, t0 + 16 * 60000);
  const newer = confirmLink(sent[sent.length - 1]);
  ok('after fifteen minutes a second confirmation email can be sent', sent.length === 3);
  ok('the older link is replaced', (c = await N.newsletterConfirm(env, params(old), t0 + 17 * 60000, true)).ok === false && c.why === 'stale');
  ok('a link over seven days old has expired', (c = await N.newsletterConfirm(env, params(newer), t0 + 16 * 60000 + 7 * 86400000 + 1, true)).ok === false && c.why === 'expired');
  ok('the newest link inside the week confirms', (await N.newsletterConfirm(env, params(newer), t0 + 20 * 60000, true)).ok);

  resendFails = 1;
  r = await N.newsletterSubscribe(env, O, { email: 'three@example.com', consent: true }, t0);
  const row4 = await db.prepare("SELECT * FROM newsletter_subscribers WHERE email = 'three@example.com'").first();
  ok('a confirmation that did not send says so and can be retried at once', r.status === 502 && r.body.error === 'send' && row4.status === 'pending' && row4.confirm_sent_at === null);
  r = await N.newsletterSubscribe(env, O, { email: 'three@example.com', consent: true }, t0 + 1000);
  ok('and the retry sends', r.status === 200 && sent[sent.length - 1].to === 'three@example.com');

  const cap = makeDb(), capEnv = envOn(cap);
  await N.nlReady(capEnv);
  for (let i = 0; i < 200; i++) cap.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirm_sent_at) VALUES (?, 'pending', 'ppr', ?, ?, ?)").run('x' + i + '@e.co', t0, t0, t0 - 1000);
  const before = sent.length;
  r = await N.newsletterSubscribe(capEnv, O, { email: 'flood@example.com', consent: true }, t0);
  ok('no more than 200 confirmation emails an hour across all addresses', r.status === 429 && sent.length === before);
}

// ── the Sunday job ────────────────────────────────────────────────────────
console.log('\nthe Sunday job');
{
  // Subscribers: reader (half, confirmed), two (ppr, confirmed), three (pending), plus a suppressed one.
  await db.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at) VALUES ('gone@example.com', 'confirmed', 'ppr', 1, 1, 100)").run();
  await db.prepare("INSERT INTO unsubscribes (email, created_at) VALUES ('gone@example.com', 200)").run();
  let r = await N.runNewsletterSend({ ...env, NEWSLETTER_ENABLED: '' }, SUN8);
  ok('off: does nothing, and the log says why', r.ok && r.skipped === 'disabled' && r.need.includes('NEWSLETTER_ENABLED=1'));
  r = await N.runNewsletterSend(env, SAT);
  ok('Saturday: outside the window', r.ok && /window/.test(r.skipped));
  r = await N.runNewsletterSend(env, Date.UTC(2026, 9, 18, 16, 0));   // Sun noon ET
  ok('Sunday noon: past the cutoff', r.ok && /window/.test(r.skipped));
  const n0 = sent.length;
  r = await N.runNewsletterSend(env, SUN8, O);
  const mine = sent.slice(n0);
  ok('Sunday 8 AM: one email to each confirmed, unsuppressed address', r.ok && r.sent === 2 && mine.map(m => m.to).sort().join(',') === 'reader@example.com,two@example.com', JSON.stringify(r));
  ok('not to a pending address, not to an unsubscribed one', !mine.some(m => m.to === 'three@example.com' || m.to === 'gone@example.com'));
  const half = mine.find(m => m.to === 'reader@example.com');
  ok('each at the scoring they chose', /\(Half PPR\)$/.test(half.subject) && /\(PPR\)$/.test(mine.find(m => m.to === 'two@example.com').subject));
  ok('with one-click unsubscribe headers and a signed link for that address', half.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'
     && half.headers['List-Unsubscribe'] === '<https://irontuna.com/api/unsubscribe?e=reader%40example.com&t=' + encodeURIComponent(await N.unsubToken(env, 'reader@example.com')) + '>');
  ok('its names link to frozen findings', /href="https:\/\/irontuna\.com\/finding\/2026-w6-[a-z-]+-half-[0-9a-f]{8}\?utm_source=newsletter/.test(half.html));
  const edRow = await db.prepare('SELECT * FROM newsletter_editions WHERE season = 2026 AND week = 6').first();
  ok('the edition is stored once, ready', edRow && edRow.status === 'ready' && edRow.built_at === SUN8);
  const fcount = (await db.prepare('SELECT COUNT(*) AS n FROM findings').first()).n;
  ok('a finding frozen for every name in it', fcount === Object.values(JSON.parse(edRow.payload).counts).reduce((a, b) => a + b, 0), String(fcount));
  r = await N.runNewsletterSend(env, SUN8 + 15 * 60000, O);
  ok('the next quarter-hour sends nothing twice', r.ok && r.sent === 0 && sent.length === n0 + 2);
  // The board moves after the edition is frozen: the edition does not.
  BOARD = { ...homeBoard(), players: homeBoard().players.filter(p => p.name !== 'Drake London') };
  await db.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at) VALUES ('late@example.com', 'confirmed', 'ppr', 1, 1, ?)").bind(SUN8).run();
  r = await N.runNewsletterSend(env, SUN8 + 30 * 60000, O);
  const late = sent[sent.length - 1];
  ok('a subscriber who confirmed after the first run gets the same frozen edition', r.sent === 1 && late.to === 'late@example.com' && late.html.includes('Drake London'));
  BOARD = homeBoard();
  // A delivery row already claimed (another run mid-send) is not sent again.
  await db.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at) VALUES ('claimed@example.com', 'confirmed', 'ppr', 1, 1, 1)").run();
  await db.prepare("INSERT INTO newsletter_deliveries (season, week, email, scoring, status, at) VALUES (2026, 6, 'claimed@example.com', 'ppr', 'sending', 1)").run();
  r = await N.runNewsletterSend(env, SUN8 + 45 * 60000, O);
  ok('a claimed delivery is never sent again', r.sent === 0 && !sent.some(m => m.to === 'claimed@example.com'));

  // Suppression: an unsubscribe stops it; a fresh confirmation restarts it.
  await N.newsletterUnsubscribe(env, 'two@example.com', SUN8);
  ok('an unsubscribe marks the address', (await db.prepare("SELECT status FROM newsletter_subscribers WHERE email = 'two@example.com'").first()).status === 'unsubscribed');

  // Batches, failures and a scoring with nothing in it, on a fresh week.
  const db2 = makeDb(), env2 = envOn(db2);
  await N.nlReady(env2);
  for (let i = 0; i < 45; i++) db2.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at) VALUES (?, 'confirmed', 'ppr', 1, 1, 1)").run('s' + String(i).padStart(2, '0') + '@e.co');
  const n1 = sent.length;
  resendFails = 2;
  r = await N.runNewsletterSend(env2, SUN8, O);
  ok('forty per run', r.batch === N.NL_BATCH && r.sent === 38 && r.failed === 2 && r.more === true, JSON.stringify(r));
  const fails = db2.sqlite.prepare("SELECT * FROM newsletter_deliveries WHERE status = 'failed'").all();
  ok('each failure is logged with the provider\'s answer', fails.length === 2 && fails.every(f => /resend 401: invalid key/.test(f.error)));
  r = await N.runNewsletterSend(env2, SUN8 + 15 * 60000, O);
  ok('the next run carries on with the other five and does not retry the failures', r.sent === 5 && r.more === false && sent.length === n1 + 43);
  const adm = await N.newsletterAdmin(env2);
  ok('/admin: counts, the edition\'s sent and failed, and failures with masked addresses', adm.counts.confirmed === 45 && adm.editions[0].sent === 43 && adm.editions[0].failed === 2 && adm.failures.length === 2 && /^s…@e\.co$/.test(adm.failures[0].email), JSON.stringify(adm.editions[0]));
  const db3 = makeDb(), env3 = envOn(db3);
  await N.nlReady(env3);
  for (let i = 0; i < 3; i++) db3.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at) VALUES (?, 'confirmed', 'ppr', 1, 1, 1)").run('f' + i + '@e.co');
  resendFails = 3;
  r = await N.runNewsletterSend(env3, SUN8, O);
  ok('every send failing is a failed run, for the job log', r.ok === false && /3 sends failed: resend 401/.test(r.error), JSON.stringify(r));
  // Nothing qualifies: no email at all, and the edition says why.
  const db4 = makeDb(), env4 = envOn(db4);
  await N.nlReady(env4);
  db4.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at) VALUES ('q@e.co', 'confirmed', 'ppr', 1, 1, 1)").run();
  const n2 = sent.length;
  r = await N.runNewsletterSend(env4, KICK - 3 * 3600000, O);
  ok('nothing clears the bar: no email, and the job says so', r.ok && /nothing cleared/.test(r.skipped) && sent.length === n2);
}

// ── findings ──────────────────────────────────────────────────────────────
console.log('\nfindings');
{
  const fdb = makeDb(), fenv = envOn(fdb);
  const nb = { b: BOARD, week: 6, season: 2026, markets: M };
  const x = N.homeExamples(BOARD, M, 'ppr')[0];
  const a = await N.findingFreeze(fenv, N.findingGapRec(nb, x, 'ppr'), SAT);
  const b = await N.findingFreeze(fenv, N.findingGapRec(nb, x, 'ppr'), SAT + 3600000);
  ok('an id that reads: season, week, player, scoring, figures', /^2026-w6-drake-london-ppr-[0-9a-f]{8}$/.test(a.id), a.id);
  ok('the same figures shared twice are one page, frozen the first time', a.id === b.id && b.rec.frozenAt === SAT);
  const moved = await N.findingFreeze(fenv, N.findingGapRec(nb, { ...x, market: x.market + 1, gap: x.gap + 1 }, 'ppr'), SAT + 7200000);
  ok('different figures are a different page; the first never changes', moved.id !== a.id && (await N.findingRead(fenv, a.id)).player.market === x.market);
  ok('an unknown or malformed id reads as nothing', (await N.findingRead(fenv, '2026-w6-nobody-ppr-00000000')) === null && (await N.findingRead(fenv, '../etc')) === null);
  const rec = await N.findingRead(fenv, a.id);
  const shell = fs.readFileSync(path.join(ROOT, 'finding.html'), 'utf8');
  const page = N.findingShellFill(shell, rec, a.id);
  ok('the page is titled and described by the finding', page.includes('<title>Drake London: market 16.0, consensus 11.0 (Week 6, PPR) | Iron Tuna</title>') && /<meta name="description" content="The betting market projects Drake London \+5.0 points/.test(page));
  ok('canonical and social tags point at the finding', page.includes('<link rel="canonical" href="https://irontuna.com/finding/' + a.id + '"/>') && page.includes('<meta property="og:url" content="https://irontuna.com/finding/' + a.id + '">') && page.includes('<meta name="twitter:title" content="Drake London: market'));
  ok('the shell stays out of the index', /<meta name="robots" content="noindex,follow">/.test(page));
  ok('it says it is dated and links to the live view', page.includes('<b>Dated finding.</b> Frozen ' + N._etStamp(SAT)) && page.includes('These numbers do not update.') && page.includes('href="/player/drake-london"') && page.includes('href="/vegas-edge#board"'));
  ok('the same labels as the homepage card', page.includes('<span class="fd-tag">Derived estimate</span> Market points converted from 6 books') && page.includes('<span class="fd-tag q">Quoted prop</span> Books quote 89.5 receiving yards'));
  ok('the image and the share controls', page.includes('src="/finding/' + a.id + '/card.svg"') && page.includes('data-it-share-url="https://irontuna.com/finding/' + a.id + '"'));
  ok('an unknown id leaves the shell\'s own copy', N.findingShellFill(shell, null, 'x').includes('No such finding'));
  const svg = N.findingSvg(rec);
  ok('the image: the name, the numbers, the week, the scoring, when it was frozen, the site', ['IRON TUNA', 'Drake London', '+5.0 pts', 'Market 16.0', 'Consensus 11.0', 'Week 6, PPR', 'Frozen ' + N._etStamp(SAT), 'irontuna.com'].every(s => svg.includes(s)));
  ok('and labels the market side a derived estimate', svg.includes('derived estimate from 6 books'));
  const cmp = N.findingCompareRec(nb, 'Flex Filler 29', 'Flex Filler 34', 'ppr');
  ok('a comparison: both players\' public projections at the one scoring', cmp && cmp.a.ironTuna === 24.2 && cmp.b.ironTuna === 23.2 && cmp.scoring === 'ppr', JSON.stringify(cmp && cmp.a));
  ok('the market side only when it is fully priced off props', cmp.a.market != null && N.findingCompareRec(nb, 'Game Lines Only', 'Drake London', 'ppr').a.market === null);
  ok('no comparison with a player whose game has kicked off, or with himself, or with a stranger',
     N.findingCompareRec(nb, 'Kicked Off', 'Drake London', 'ppr') === null && N.findingCompareRec(nb, 'Drake London', 'Drake London', 'ppr') === null && N.findingCompareRec(nb, 'Nobody', 'Drake London', 'ppr') === null);
  const cf = await N.findingFreeze(fenv, cmp, SAT);
  ok('a comparison id names both', /^2026-w6-flex-filler-29-vs-flex-filler-34-ppr-[0-9a-f]{8}$/.test(cf.id), cf.id);
  const cpage = N.findingBodyHtml(cf.rec, cf.id);
  ok('its page says which projects more, and by how much', cpage.includes('Iron Tuna projected Flex Filler 29 1.0 more points at PPR.'));
  ok('nothing from a league: no roster, no league id, no team name in any finding', !/league|roster|team_id|manager/i.test(JSON.stringify([rec, cf.rec])));
  const evil = N.findingBodyHtml({ ...rec, player: { ...rec.player, name: '<img src=x onerror=1>' } }, a.id);
  ok('a name is escaped in the page and the image', !evil.includes('<img src=x') && !N.findingSvg({ ...rec, player: { ...rec.player, name: '<img src=x>' } }).includes('<img'));
  ok('no em dash in the page or the image', !/—/.test(page.slice(page.indexOf('id="fdBody"'), page.indexOf('<!--/fdBody-->')) + svg + cpage));
}

// ── the real worker's routes ──────────────────────────────────────────────
console.log('\nthe routes, on the real worker');
{
  const worker = (await import(path.join(ROOT, '_worker.js'))).default;
  const shell = fs.readFileSync(path.join(ROOT, 'finding.html'), 'utf8');
  const rdb = makeDb();
  const base = { LEADS_DB: rdb, AUTH_SECRET: 'sekrit', LEADS_EXPORT_KEY: 'k',
    ASSETS: { fetch: (req) => new URL(req.url).pathname === '/finding' ? new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('', { status: 404 }) } };
  const call = (env, p, init) => worker.fetch(new Request('https://irontuna.com' + p, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126', 'content-type': 'application/json' }, ...(init || {}) }), env, { waitUntil() {} });
  let r = await call(base, '/api/newsletter/status');
  let j = await r.json();
  ok('status: closed without the settings, with the offer', j.ok && j.open === false && /five biggest Vegas-versus-expert/.test(j.offer));
  const on = { ...base, RESEND_API_KEY: 're_x', MAIL_ADDRESS: '1 Example Way', NEWSLETTER_ENABLED: '1' };
  ok('status: open with them', (await (await call(on, '/api/newsletter/status')).json()).open === true);
  r = await call(base, '/api/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email: 'x@y.co', consent: true }) });
  ok('subscribe while closed: 503', r.status === 503);
  const n0 = sent.length;
  r = await call(on, '/api/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email: 'route@example.com', consent: true, scoring: 'standard', source: 'newsletter_page' }) });
  ok('subscribe while open: check your inbox, one email', r.status === 200 && (await r.json()).state === 'check_inbox' && sent.length === n0 + 1);
  ok('subscribe by GET is refused', (await call(on, '/api/newsletter/subscribe')).status === 405);
  const link = confirmLink(sent[sent.length - 1]);
  r = await call(on, new URL(link).pathname + new URL(link).search);
  let ch = await r.text();
  ok('opening the link shows a button and confirms nothing', r.status === 200 && /Confirm my subscription/.test(ch) && /<form method="post"/.test(ch) && /noindex/.test(ch)
     && (await rdb.prepare("SELECT status FROM newsletter_subscribers WHERE email = 'route@example.com'").first()).status === 'pending');
  r = await call(on, new URL(link).pathname + new URL(link).search, { method: 'POST' });
  ch = await r.text();
  ok('pressing it confirms', r.status === 200 && /Subscribed/.test(ch) && /Standard scoring/.test(ch)
     && (await rdb.prepare("SELECT status FROM newsletter_subscribers WHERE email = 'route@example.com'").first()).status === 'confirmed');
  {
    const req = new Request('https://irontuna.com/api/newsletter/status', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126' } });
    Object.defineProperty(req, 'cf', { value: { country: 'US', regionCode: 'WA' } });
    const sj = await (await worker.fetch(req, on, { waitUntil() {} })).json();
    const req2 = new Request('https://irontuna.com/api/newsletter/subscribe', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 Chrome/126', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'wa@example.com', consent: true }) });
    Object.defineProperty(req2, 'cf', { value: { country: 'US', regionCode: 'WA' } });
    const sr = await worker.fetch(req2, on, { waitUntil() {} });
    ok('not offered in Washington, and refused there', sj.open === false && sr.status === 403 && (await sr.json()).error === 'region');
  }
  r = await call(on, '/api/newsletter/confirm?e=route%40example.com&s=1&t=bad');
  ok('a bad confirmation link is a 400 that says so', r.status === 400 && /not valid/.test(await r.text()));
  const tok = await N.hmacSign('sekrit', 'unsub:route@example.com');
  r = await call(on, '/api/unsubscribe?e=route%40example.com&t=' + encodeURIComponent(tok), { method: 'POST' });
  ok('the one-click unsubscribe (a POST) works and suppresses the newsletter too', r.status === 200
     && (await rdb.prepare("SELECT status FROM newsletter_subscribers WHERE email = 'route@example.com'").first()).status === 'unsubscribed'
     && !!(await rdb.prepare("SELECT 1 FROM unsubscribes WHERE email = 'route@example.com'").first()));
  // A finding stored, then served.
  const nb = { b: homeBoard(), week: 6, season: 2026, markets: M };
  const f = await N.findingFreeze({ LEADS_DB: rdb }, N.findingGapRec(nb, N.homeExamples(homeBoard(), M, 'ppr')[0], 'ppr'), SAT);
  r = await call(base, '/finding/' + f.id);
  let h = await r.text();
  ok('/finding/<id>: 200, the finding in the first HTML', r.status === 200 && h.includes('<h1>Drake London <span class="fd-gap good">+5.0 pts</span></h1>') && h.includes('<title>Drake London: market 16.0'));
  r = await call(base, '/finding/2026-w6-nobody-ppr-00000000');
  h = await r.text();
  ok('an unknown finding: 404 with the shell\'s copy', r.status === 404 && h.includes('No such finding'));
  r = await call(base, '/finding/' + f.id + '/card.svg');
  ok('its image: SVG, cached for good (the finding never changes)', r.status === 200 && /image\/svg\+xml/.test(r.headers.get('content-type')) && /immutable/.test(r.headers.get('cache-control')) && (await r.text()).startsWith('<svg'));
  ok('an unknown image is a 404', (await call(base, '/finding/2026-w6-nobody-ppr-00000000/card.svg')).status === 404);
  r = await call(base, '/api/share/finding', { method: 'POST', body: JSON.stringify({ player: 'Drake London', scoring: 'ppr' }) });
  ok('sharing with no week board: refused, nothing invented', r.status === 409 && (await r.json()).error === 'no_board');
  // rl() is a no-op without RATE_KV, so the hourly cap in D1 is what bounds
  // the table: at 600 findings in the last hour, a share is refused.
  for (let i = 0; i < 600; i++) await rdb.prepare('INSERT INTO findings (id, kind, season, week, scoring, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('cap-' + i, 'gap', 2026, 6, 'ppr', Date.now(), '{}').run();
  r = await call(base, '/api/share/finding', { method: 'POST', body: JSON.stringify({ player: 'Drake London', scoring: 'ppr' }) });
  ok('600 shared findings in an hour: the next is refused before any board read', r.status === 429 && (await r.json()).error === 'busy');
  await rdb.prepare("DELETE FROM findings WHERE id LIKE 'cap-%'").run();
  ok('the admin routes need the key', (await call(base, '/api/admin/newsletter')).status === 403 && (await call(base, '/api/admin/newsletter/preview')).status === 403 && (await call(base, '/api/admin/newsletter/test', { method: 'POST', body: '{}' })).status === 403);
  j = await (await call(base, '/api/admin/newsletter?key=k')).json();
  ok('/api/admin/newsletter: off, what it needs, and the counts', j.ok && j.config.open === false && j.config.need.includes('RESEND_API_KEY') && j.counts.unsubscribed === 1, JSON.stringify(j).slice(0, 300));
  r = await call(base, '/api/admin/newsletter/preview?key=k');
  ok('a preview with no board says so', r.status === 404 && /no week board/.test(await r.text()));
  r = await call(base, '/api/admin/newsletter/test?key=k', { method: 'POST', body: JSON.stringify({ to: 'me@example.com' }) });
  ok('a test send without the mail settings is refused and says what is missing', r.status === 400 && (j = await r.json()).error === 'not_configured' && j.need.includes('RESEND_API_KEY') && !j.need.includes('NEWSLETTER_ENABLED=1'));
  const u = await (await call(base, '/api/admin/usage?key=k')).json();
  ok('/admin\'s usage payload now counts confirmed subscribers', u.subscriptions.confirmed === 0 && u.subscriptions.pending === 0 && /double opt-in/.test(u.subscriptions.confirmedNote), JSON.stringify(u.subscriptions));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
