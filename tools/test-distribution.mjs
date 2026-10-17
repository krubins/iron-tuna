#!/usr/bin/env node
// The weekly drafts and creator partners (docs/growth-plan.md, Phase 6,
// 17 Oct 2026).
//   node tools/test-distribution.mjs
//
// Lifts "THE WEEKLY DRAFTS AND PARTNERS" section of _worker.js with the Sunday
// email's (the findings it freezes) and the homepage rules it is cut from, and
// runs it against an in-memory SQLite database. Then drives the real worker's
// admin routes. It pins:
//   - the Tuesday waiver rule: Iron Tuna inside a 12-team league's rostered
//     depth, the consensus outside it, a game every week, Active or Probable,
//     role not trending down; best Iron Tuna rank wins; never "available";
//   - the Thursday/Friday draft: the homepage's own top three as one dated
//     "set" finding, nobody kicking off within the hour;
//   - the Sunday draft: the homepage sample's flex pair;
//   - every draft: frozen figures, the tagged link per the UTM convention,
//     the channel's length, a plain "nothing clears" when nothing does, and
//     no request to anything outside (nothing is posted);
//   - findings: the new kinds render, and a gap's id is what it was before;
//   - partners: validation, upsert, metrics off creator-<slug>, the package's
//     tagged links and outreach draft, nothing sent;
//   - the sign-up keeps the visit's source labels, never an address;
//   - the routes: the key gate, POST-only drafts, no board, partners.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const lift = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); const j = src.indexOf(b, i); if (j < 0) throw new Error('not found: ' + b); return src.slice(i, j + b.length); };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cut ' + a); return src.slice(i, j); };

const ANALYTICS_DDL = eval(src.match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);
function makeDb(analytics) {
  const sqlite = new DatabaseSync(':memory:');
  if (analytics) for (const s of ANALYTICS_DDL) sqlite.exec(s);
  return { sqlite, prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
    async run() { const r = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
    async first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; } }; } };
}
// Every request leaving the lifted code is recorded; only Resend is answered.
const outside = [];
const sent = [];
globalThis.fetch = async (u, init) => {
  outside.push(String(u));
  if (String(u).startsWith('https://api.resend.com/')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'msg_' + sent.length }), { status: 200 }); }
  return new Response('no network in tests', { status: 599 });
};

// ── the three-week board the waiver finding is cut from ───────────────────
// WR rostered depth at 12 teams is 72 (PICKUP_ROSTERED.WR 6 x 12). Every
// player but the first fails exactly one rule, and is named for it.
const W3_UPDATED = { board: Date.UTC(2026, 9, 20, 13, 0), odds: Date.UTC(2026, 9, 20, 11, 0) };
function w3pl(name, position, c, r, o = {}) {
  const weeks = [7, 8, 9].map((wk, i) => ({ week: wk, opponent: 'O' + wk, home: i % 2 === 0, bye: !!(o.bye && i === 1), out: false,
    gameState: o.kicked && i === 0 ? 'in_progress' : 'upcoming', kickoff: Date.UTC(2026, 9, 25 + 7 * i, 17, 0) }));
  return { name, position, pos: position, team: o.team || 'NYJ', key: name, games: o.bye ? 2 : 3, weeks: o.bye ? weeks.filter(w => !w.bye) : weeks,
    injury: o.injury ? { status: o.injury } : null, roleTrend: o.trend || { label: 'flat', pct: 4, games: 6, latestTouches: 9, avgTouches: 8.7 },
    consensus: { rank: c, points: o.cp == null ? 22.0 : o.cp }, ironTuna: { rank: r, points: o.ip == null ? 30.24 : o.ip }, vegas: { rank: r, points: 28 } };
}
function w3Board(players) {
  return { ok: true, horizon: { key: 'next3', label: 'Next 3 Weeks', weeks: [7, 8, 9] }, season: 2026, updated: { ...W3_UPDATED }, players: players || [
    w3pl('Waiver Target', 'WR', 80, 38, { trend: { label: 'up', pct: 25, games: 6, latestTouches: 10, avgTouches: 8 } }),
    w3pl('Second Choice', 'WR', 79, 45),
    w3pl('Better Rank Hurt', 'WR', 90, 20, { injury: 'Questionable' }),
    w3pl('Down Role', 'WR', 85, 30, { trend: { label: 'down', pct: -30, games: 6 } }),
    w3pl('Bye Inside', 'WR', 75, 35, { bye: true }),
    w3pl('Kicked Off Already', 'WR', 82, 31, { kicked: true }),
    w3pl('Rostered Already', 'WR', 60, 10),
    w3pl('Iron Tuna Agrees', 'WR', 100, 80),
    w3pl('Kicker Guy', 'K', 30, 1),
    w3pl('Active Tag', 'TE', 25, 19, { injury: 'Active' })
  ] };
}

// ── the lifted code ───────────────────────────────────────────────────────
const NORM = new Function(lift('const _oddsNorm = ', ';\n') + '\nreturn _oddsNorm;')();
const M = homeMarkets(NORM);
let BOARD = homeBoard(), W3 = w3Board();
const stubs = `
  const boardsPayload = async (env, o) => o && o.horizon === 'next3' ? __w3() : __board();
  const boardStillToPlay = (b) => b;
  const marketHistoryWeek = async () => __markets;
`;
const H = new Function('__board', '__w3', '__markets', 'LEAD_TZ', [
  src.slice(src.indexOf('// ── the scoring engine ─'), src.indexOf('const COLUMN_SCORING = {')),
  lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'), lift('function _etStamp(ms) {', '\n}'),
  lift('function b64urlEncode(bytes) {', '\n'), lift('async function hmacSign(secret, data) {', '\n'), lift('function timingSafeEq(a, b) {', '\n'),
  lift('async function unsubToken(env, email) {', '\n'),
  cut('function etOffsetHours(ms) {', 'function etClock(ms) {'), cut('function etParts(ms) {', 'const _etDow = '),
  src.slice(src.indexOf('const HOME_EX_MAX = 3;'), src.indexOf('function homeShellFill(html, hp) {')),
  lift('const PICKUP_ROSTERED = ', ';\n'),
  lift('const EVJ = ', ';\n'), lift('const USAGE_OWNER_FILTER = ', ';\n'), cut('async function usageSourceRows(', 'async function adminUsage('),
  stubs,
  cut('// THE SUNDAY EMAIL AND SHARED FINDINGS START', '// THE SUNDAY EMAIL AND SHARED FINDINGS END'),
  cut('// THE WEEKLY DRAFTS AND PARTNERS START', '// THE WEEKLY DRAFTS AND PARTNERS END')
].join('\n') + `
return { waiverFindingPick, waiverWhy, findingWaiverRec, findingSetRec, distDraft, distTag, distUtm, distChars, distCampaign, distSlug,
  partnerUpsert, partnerList, partnerPackage, findingFreeze, findingRead, findingGapRec, findingBodyHtml, findingSvg, findingTitle, findingDesc,
  homeExamples, newsletterSubscribe, nlReady, DIST_CHANNELS };`);
const N = H(() => BOARD, () => W3, M, 'America/New_York');

const SAT = Date.UTC(2026, 9, 17, 14, 0);              // Sat 10/17 10:00 AM ET
const KICK = Date.UTC(2026, 9, 18, 17, 0);             // Sun 10/18 1:00 PM ET
const TUE = Date.UTC(2026, 9, 20, 14, 0);              // Tue 10/20 10:00 AM ET
const O = 'https://irontuna.com';
const noDash = (s) => !/—/.test(s);

// ── the Tuesday waiver rule ───────────────────────────────────────────────
console.log('\nthe Tuesday waiver rule');
{
  const x = N.waiverFindingPick(W3);
  ok('the one player who passes every rule is picked', x && x.name === 'Waiver Target', x && x.name);
  ok('his figures: both ranks, both point totals, the rostered line, the three fixtures',
     x.ironTunaRank === 38 && x.consensusRank === 80 && x.ironTuna === 30.2 && x.consensus === 22 && x.line === 72 && x.teams === 12 && x.next.length === 3, JSON.stringify(x));
  ok('a role trending up is carried with its numbers', x.trend && x.trend.pct === 25 && x.trend.latest === 10 && x.trend.avg === 8);
  const without = (n) => N.waiverFindingPick(w3Board(W3.players.filter(p => p.name !== 'Waiver Target' && p.name !== n)));
  ok('the next best rank takes over when he is gone', without('x').name === 'Second Choice');
  const only = (p) => N.waiverFindingPick(w3Board([p]));
  ok('a Questionable tag rules him out', only(W3.players.find(p => p.name === 'Better Rank Hurt')) === null);
  ok('a role trending down rules him out', only(W3.players.find(p => p.name === 'Down Role')) === null);
  ok('a bye inside the span rules him out', only(W3.players.find(p => p.name === 'Bye Inside')) === null);
  ok('a game under way rules him out', only(W3.players.find(p => p.name === 'Kicked Off Already')) === null);
  ok('a player the consensus already has inside the rostered depth is not a waiver finding', only(W3.players.find(p => p.name === 'Rostered Already')) === null);
  ok('a player Iron Tuna also ranks outside it is not one either', only(W3.players.find(p => p.name === 'Iron Tuna Agrees')) === null);
  ok('kickers are not considered', only(W3.players.find(p => p.name === 'Kicker Guy')) === null);
  ok('Active is a clean tag (TE line is 18: 19 is outside, so no pick)', only(W3.players.find(p => p.name === 'Active Tag')) === null);
  ok('an Active tight end inside the line is picked', only(w3pl('Active Inside', 'TE', 25, 12, { injury: 'Active' })).name === 'Active Inside');
  ok('not a three-week board, no pick', N.waiverFindingPick({ ...W3, horizon: { key: 'week', weeks: [7] } }) === null);
  const why = N.waiverWhy(N.findingWaiverRec(W3, x, 'ppr'));
  ok('the explanation names the ranks, the span, the scoring and the assumption',
     why.startsWith('Over Weeks 7 to 9 at PPR, Iron Tuna ranks Waiver Target WR38 (30.2 points) and the consensus ranks him WR80 (22.0).') && /assumes a 12-team league rosters about 72 WRs/.test(why), why);
  ok('it never says he is available', !/\bavailable\b/i.test(why));
}

// ── the drafts ────────────────────────────────────────────────────────────
console.log('\nthe drafts');
const db = makeDb(true);
const env = { LEADS_DB: db };
{
  outside.length = 0;
  const r = await N.distDraft(env, O, { kind: 'waiver', scoring: 'ppr', channel: 'x' }, TUE);
  const d = r.body;
  ok('waiver: built', r.status === 200 && d.ok && !d.none && d.kind === 'waiver', JSON.stringify(d).slice(0, 300));
  ok('waiver: the link is the dated finding, tagged x / social / <season>-w<NN>-waiver',
     /^https:\/\/irontuna\.com\/finding\/2026-w7-waiver-waiver-target-ppr-[0-9a-f]{8}\?utm_source=x&utm_medium=social&utm_campaign=2026-w07-waiver$/.test(d.link), d.link);
  ok('waiver: the text has the figures, says to check the league, and ends with the link',
     d.text.includes('Waiver finding, Weeks 7 to 9 (PPR): Waiver Target, WR NYJ') && d.text.includes('Iron Tuna ranks him WR38. The consensus has him WR80, outside the ~72 WRs a 12-team league rosters.')
     && d.text.includes('Check whether he is free in your league.') && d.text.endsWith(d.link), d.text);
  ok('waiver: never says available', !/\bavailable\b/i.test(d.text) && d.explain.some(e => /Availability is not known/.test(e)));
  ok('waiver: the figures table and stamps', d.figures.length === 1 && d.figures[0].a === 'Iron Tuna WR38, 30.2 pts' && d.boardAt === W3_UPDATED.board && d.frozenAt === TUE);
  ok('waiver: within X\'s 280 (a link counts as 23)', d.max === 280 && d.chars <= 280 && d.chars === d.text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length, String(d.chars));
  const f = await N.findingRead(env, d.findingId);
  ok('waiver: the finding is frozen with the same figures', f && f.kind === 'waiver' && f.player.ironTunaRank === 38 && f.weeks.join() === '7,8,9');
  const html = N.findingBodyHtml(f, d.findingId);
  ok('waiver: the finding page shows both ranks, the span and the check', html.includes('Weeks 7 to 9 &middot; PPR') && html.includes('Iron Tuna <b>WR38</b>') && html.includes('consensus <b>WR80</b>')
     && html.includes('Availability is not known here. Check your league before you claim.') && html.includes('href="/waivers"') && html.includes('data-it-share-tool="finding_waiver"'));
  const svg = N.findingSvg(f);
  ok('waiver: the share image', svg.startsWith('<svg') && svg.includes('Iron Tuna WR38') && svg.includes('Consensus WR80') && svg.includes('Availability not known'));
  ok('waiver: title and description', N.findingTitle(f) === 'Waiver Target: Iron Tuna WR38, consensus WR80 (Weeks 7 to 9, PPR)' && /Frozen /.test(N.findingDesc(f)));
  const again = (await N.distDraft(env, O, { kind: 'waiver', scoring: 'ppr', channel: 'x' }, TUE + 60000)).body;
  ok('the same figures built twice are one finding', again.findingId === d.findingId && (await db.prepare('SELECT COUNT(*) AS n FROM findings').first()).n === 1);
  W3 = w3Board(W3.players.filter(p => p.name !== 'Waiver Target' && p.name !== 'Second Choice'));
  const none = (await N.distDraft(env, O, { kind: 'waiver', scoring: 'half', channel: 'x' }, TUE)).body;
  ok('nothing clears: a draft that says so, and nothing frozen', none.ok && /No player clears the waiver rule at Half PPR for Weeks 7 to 9/.test(none.none) && !none.text && (await db.prepare('SELECT COUNT(*) AS n FROM findings').first()).n === 1, JSON.stringify(none));
  W3 = w3Board();
  ok('no request left the worker while building (nothing is posted)', outside.length === 0, outside.join(' '));
}
{
  const r = await N.distDraft(env, O, { kind: 'market', scoring: 'ppr', channel: 'threads' }, SAT);
  const d = r.body;
  const top3 = N.homeExamples(BOARD, M, 'ppr').map(x => x.name);
  ok('market: the homepage\'s own three, in its order', d.ok && d.figures.map(x => x.name).join() === top3.join(), JSON.stringify(d.figures));
  ok('market: one dated link for the set, tagged threads / social / -vegas-gaps',
     /^https:\/\/irontuna\.com\/finding\/2026-w6-gaps-drake-london-ppr-[0-9a-f]{8}\?utm_source=threads&utm_medium=social&utm_campaign=2026-w06-vegas-gaps$/.test(d.link), d.link);
  ok('market: each line has the gap, the market and the consensus; the market labelled derived',
     d.text.includes('Drake London +5.0 (16.0 vs 11.0)') && d.text.includes('Market (derived from sportsbook props) vs consensus, in points. Not betting advice.'), d.text);
  ok('market: the explanation carries the quoted prop and its label', d.explain.some(e => /Quoted prop: Books quote 89\.5 receiving yards/.test(e)) && d.explain.some(e => /derived estimate from 6 books/.test(e)));
  ok('market: fits Threads', d.max === 500 && d.chars <= 500);
  const x = await N.distDraft(env, O, { kind: 'market', scoring: 'ppr', channel: 'x' }, SAT);
  ok('market: fits X too', x.body.chars <= 280, String(x.body.chars) + ' ' + x.body.text);
  const f = await N.findingRead(env, d.findingId);
  const html = N.findingBodyHtml(f, d.findingId);
  ok('market: the set page lists all three with both labels', f.kind === 'set' && f.players.length === 3 && (html.match(/<li>/g) || []).length === 3
     && (html.match(/Derived estimate/g) || []).length === 3 && (html.match(/Quoted prop/g) || []).length === 3 && html.includes('Only 3') === false);
  ok('market: the set image', N.findingSvg(f).includes('Drake London') && N.findingSvg(f).includes('Goal Line Back'));
  ok('market: title', N.findingTitle(f) === 'Week 6: 3 market-versus-consensus differences (PPR)');
  const late = (await N.distDraft(env, O, { kind: 'market', scoring: 'ppr', channel: 'x' }, KICK - 30 * 60000)).body;
  ok('market: nobody kicking off within the hour', late.ok && late.none && /No player clears the homepage bar at PPR/.test(late.none));
  const two = (await N.distDraft(env, O, { kind: 'market', scoring: 'standard', channel: 'x' }, SAT)).body;
  const std = N.homeExamples(BOARD, M, 'standard');
  ok('market: fewer when fewer qualify, and the page says so', two.figures.length === Math.min(3, std.length) && (std.length >= 3 || N.findingBodyHtml(await N.findingRead(env, two.findingId), two.findingId).includes('Only ' + std.length + ' cleared the bar.')));
}
{
  const d = (await N.distDraft(env, O, { kind: 'lineup', scoring: 'ppr', channel: 'bluesky' }, SAT)).body;
  ok('lineup: the homepage sample\'s flex pair', d.ok && d.figures.map(x => x.name).join() === 'Flex Filler 29,Flex Filler 34', JSON.stringify(d.figures));
  ok('lineup: the call, the projections, not a guarantee', d.text.startsWith('Week 6 flex call (PPR): Flex Filler 29 or Flex Filler 34?') && d.text.includes('Iron Tuna projects Flex Filler 29 24.2 and Flex Filler 34 23.2. A projection, not a guarantee.'), d.text);
  ok('lineup: tagged bluesky / social / -lineup', /utm_source=bluesky&utm_medium=social&utm_campaign=2026-w06-lineup$/.test(d.link), d.link);
  ok('lineup: Bluesky\'s count is the raw length (only X shortens links)', d.max === 300 && d.chars === d.text.length);
  ok('lineup: a compare finding', (await N.findingRead(env, d.findingId)).kind === 'compare');
}
{
  const p = (await N.distDraft(env, O, { kind: 'market', scoring: 'ppr', channel: 'creator-some-show' }, SAT)).body;
  ok('a partner\'s draft: creator-<slug> / partner', /utm_source=creator-some-show&utm_medium=partner&utm_campaign=2026-w06-vegas-gaps$/.test(p.link) && p.max === null);
  ok('a bad kind and a bad channel are refused', (await N.distDraft(env, O, { kind: 'tweet' }, SAT)).status === 400 && (await N.distDraft(env, O, { kind: 'market', channel: 'myspace' }, SAT)).status === 400);
  BOARD = { ok: false };
  ok('no board: refused, nothing invented', (await N.distDraft(env, O, { kind: 'market', channel: 'x' }, SAT)).body.error === 'no_board');
  BOARD = homeBoard();
  ok('the UTM tags go before the fragment', N.distUtm('https://irontuna.com/vegas-edge#board', N.distTag('x'), '2026-w06-vegas-gaps') === 'https://irontuna.com/vegas-edge?utm_source=x&utm_medium=social&utm_campaign=2026-w06-vegas-gaps#board');
  ok('every channel in the convention table', ['x', 'threads', 'bluesky', 'reddit', 'discord'].every(k => N.DIST_CHANNELS[k] && N.DIST_CHANNELS[k].medium === 'social'));
}

// ── findings: the old ids still hold ──────────────────────────────────────
console.log('\nfindings');
{
  const nb = { b: homeBoard(), week: 6, season: 2026, markets: M };
  const rec = N.findingGapRec(nb, N.homeExamples(homeBoard(), M, 'ppr')[0], 'ppr');
  const f = await N.findingFreeze({ LEADS_DB: makeDb() }, rec, SAT);
  // The Phase 5 formula, written out.
  const figs = JSON.stringify({ kind: rec.kind, season: rec.season, week: rec.week, scoring: rec.scoring, player: rec.player || null, a: rec.a || null, b: rec.b || null });
  const old = [2026, 'w6', 'drake-london', 'ppr', crypto.createHash('sha256').update(figs).digest('hex').slice(0, 8)].join('-');
  ok('a gap finding\'s id is exactly what Phase 5 gave it', f.id === old, f.id + ' vs ' + old);
}

// ── partners ──────────────────────────────────────────────────────────────
console.log('\npartners');
{
  outside.length = 0;
  ok('a name is required', (await N.partnerUpsert(env, { name: '  ' })).body.error === 'name_required');
  ok('a URL must be http(s)', (await N.partnerUpsert(env, { name: 'A Show', url: 'javascript:alert(1)' })).body.error === 'bad_url');
  let r = await N.partnerUpsert(env, { name: 'Some Show!', channel: 'YouTube', status: 'contacted', notes: 'met at a meetup' }, 1000);
  ok('the slug comes from the name, and the tag from the slug', r.body.ok && r.body.slug === 'some-show' && r.body.source === 'creator-some-show', JSON.stringify(r.body));
  r = await N.partnerUpsert(env, { name: 'Some Show', slug: 'some-show', status: 'active', channel: 'YouTube' }, 2000);
  const row = await db.prepare("SELECT * FROM partners WHERE slug = 'some-show'").first();
  ok('saving again updates in place and keeps when it was added', row.status === 'active' && row.created_at === 1000 && row.updated_at === 2000 && row.name === 'Some Show');
  await N.partnerUpsert(env, { name: 'Other Pod', status: 'weird' }, 3000);
  ok('an unknown status is a prospect', (await db.prepare("SELECT status FROM partners WHERE slug = 'other-pod'").first()).status === 'prospect');
  // Their traffic: two visits from the tagged link, one useful, and the owner's own click.
  const t = Date.now() - 3600000, day = new Date(t).toISOString().slice(0, 10);
  const seed = (ts, ev, uid, props, internal = 0) => db.sqlite.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?,?,?,?,?,?,?)').run(ts, day, ev, uid, '/', JSON.stringify(props), internal);
  seed(t, 'visit_start', 'pp000001', { vid: 'p1', src: 'creator-some-show', med: 'partner', cmp: '2026-w06-partner' });
  seed(t + 10, 'tool_success', 'pp000001', { vid: 'p1', tool: 'vegas_edge', key: 'w6' });
  seed(t, 'visit_start', 'pp000002', { vid: 'p2', src: 'creator-some-show', med: 'partner', cmp: '2026-w06-partner' });
  seed(t, 'visit_start', 'pp000003', { vid: 'p3', src: 'creator-some-show', med: 'partner', cmp: '2026-w06-partner' }, 1);
  seed(t, 'visit_start', 'pp000004', { vid: 'p4', src: 'x', med: 'social' });
  await N.nlReady(env);
  await db.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at, visit_src) VALUES ('s@ex.com', 'confirmed', 'ppr', 1, 1, ?, 'creator-some-show')").bind(Date.now() - 1000).run();
  const L = await N.partnerList(env, 30);
  const s = L.partners.find(p => p.slug === 'some-show');
  ok('the list: active first, with its tag', L.ok && L.partners[0].slug === 'some-show' && s.source === 'creator-some-show');
  ok('the partner\'s measures: visitors, useful visits, confirmed (the owner excluded)', s.visitors === 2 && s.visits === 2 && s.usefulVisits === 1 && s.confirmed === 1, JSON.stringify(s));
  ok('a partner with no traffic reads zero, not someone else\'s', L.partners.find(p => p.slug === 'other-pod').visitors === 0);
  const pk = (await N.partnerPackage(env, O, 'some-show', SAT)).body;
  ok('the package: four tagged links, creator / partner / -partner', pk.ok && pk.links.length === 4 && pk.links.every(l => l.url.includes('utm_source=creator-some-show&utm_medium=partner&utm_campaign=2026-w06-partner')), JSON.stringify(pk.links));
  ok('the board link keeps its fragment after the tags', pk.links[1].url === 'https://irontuna.com/vegas-edge?utm_source=creator-some-show&utm_medium=partner&utm_campaign=2026-w06-partner#board');
  ok('the sample segment is the homepage\'s three, labelled', ['Drake London', 'Derrick Henry', 'Goal Line Back'].every(n => pk.segment.includes(n)) && /derived from 6 books/.test(pk.segment) && /not a prediction or betting advice/.test(pk.segment));
  ok('the outreach draft names them, leaves the owner\'s choices in brackets, promises nothing',
     pk.outreach.includes('Hi Some Show,') && pk.outreach.includes('[Your name]') && /\[What you are offering/.test(pk.outreach) && pk.outreach.includes(pk.links[1].url) && !/guarantee|commission/i.test(pk.outreach));
  ok('the package says nothing was sent', /Nothing has been sent and nobody has been contacted/.test(pk.note));
  ok('an unknown partner is a 404', (await N.partnerPackage(env, O, 'nobody', SAT)).status === 404);
  ok('no request left the worker (nobody contacted)', outside.length === 0, outside.join(' '));
  BOARD = { ok: false };
  const pk2 = (await N.partnerPackage(env, O, 'some-show', SAT)).body;
  ok('no board: the package says there is no sample, rather than inventing one', pk2.ok && /No player clears the bar right now/.test(pk2.segment));
  ok('no board: the campaign is the season alone, not an invented week', pk2.campaign === '2026-partner' && pk2.links[0].url.endsWith('utm_campaign=2026-partner'), pk2.campaign);
  BOARD = homeBoard();
}

// ── the sign-up keeps the visit's source ──────────────────────────────────
console.log('\nthe sign-up');
{
  const d2 = makeDb();
  const on = { LEADS_DB: d2, AUTH_SECRET: 'sekrit', RESEND_API_KEY: 're_x', MAIL_ADDRESS: '1 Example Way', NEWSLETTER_ENABLED: '1' };
  await N.newsletterSubscribe(on, O, { email: 'v@ex.com', consent: true, source: 'home', visit: { src: 'creator-some-show', med: 'partner', cmp: '2026-w06-partner' } }, SAT);
  let r = await d2.prepare("SELECT visit_src, visit_med, visit_cmp FROM newsletter_subscribers WHERE email = 'v@ex.com'").first();
  ok('the visit\'s source, medium and campaign are stored with the sign-up', r.visit_src === 'creator-some-show' && r.visit_med === 'partner' && r.visit_cmp === '2026-w06-partner', JSON.stringify(r));
  await N.newsletterSubscribe(on, O, { email: 'w@ex.com', consent: true, visit: { src: 'someone@example.com', med: 'social' } }, SAT);
  r = await d2.prepare("SELECT visit_src, visit_med FROM newsletter_subscribers WHERE email = 'w@ex.com'").first();
  ok('a label holding an address is dropped, not stored', r.visit_src === null && r.visit_med === 'social', JSON.stringify(r));
  await N.newsletterSubscribe(on, O, { email: 'n@ex.com', consent: true }, SAT);
  ok('no visit: nothing stored, the sign-up still works', (await d2.prepare("SELECT visit_src FROM newsletter_subscribers WHERE email = 'n@ex.com'").first()).visit_src === null);
  const old = makeDb();
  old.sqlite.exec("CREATE TABLE newsletter_subscribers (email TEXT PRIMARY KEY, status TEXT NOT NULL, scoring TEXT NOT NULL DEFAULT 'ppr', source TEXT, consent TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirm_sent_at INTEGER, confirmed_at INTEGER, unsubscribed_at INTEGER)");
  await N.newsletterSubscribe({ ...on, LEADS_DB: old }, O, { email: 'o@ex.com', consent: true, visit: { src: 'x', med: 'social' } }, SAT);
  ok('a Phase 5 table gains the columns on first use', (await old.prepare("SELECT visit_src FROM newsletter_subscribers WHERE email = 'o@ex.com'").first()).visit_src === 'x');
}

// ── the real worker's routes ──────────────────────────────────────────────
console.log('\nthe routes, on the real worker');
{
  const worker = (await import(path.join(ROOT, '_worker.js'))).default;
  const rdb = makeDb(true);
  const base = { LEADS_DB: rdb, LEADS_EXPORT_KEY: 'k', ASSETS: { fetch: () => new Response('', { status: 404 }) } };
  const call = (p, init) => worker.fetch(new Request('https://irontuna.com' + p, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126', 'content-type': 'application/json' }, ...(init || {}) }), base, { waitUntil() {} });
  ok('every admin route needs the key', (await call('/api/admin/drafts', { method: 'POST', body: '{}' })).status === 403 && (await call('/api/admin/partners')).status === 403 && (await call('/api/admin/partners/package?slug=x')).status === 403);
  ok('a draft is never built by a GET', (await call('/api/admin/drafts?key=k')).status === 405);
  let r = await call('/api/admin/drafts?key=k', { method: 'POST', body: JSON.stringify({ kind: 'market', channel: 'x' }) });
  ok('no board: 409, nothing invented', r.status === 409 && (await r.json()).error === 'no_board');
  r = await call('/api/admin/drafts?key=k', { method: 'POST', body: JSON.stringify({ kind: 'nope' }) });
  ok('a bad kind: 400', r.status === 400);
  r = await call('/api/admin/partners?key=k', { method: 'POST', body: JSON.stringify({ name: 'Route Show', status: 'agreed' }) });
  ok('a partner saved through the route', r.status === 200 && (await r.json()).source === 'creator-route-show');
  const j = await (await call('/api/admin/partners?key=k&days=7')).json();
  ok('and listed, with the statuses', j.ok && j.days === 7 && j.partners.length === 1 && j.partners[0].name === 'Route Show' && j.statuses.includes('active'));
  ok('an unknown partner\'s package: 404', (await call('/api/admin/partners/package?key=k&slug=nobody')).status === 404);
  const u = await (await call('/api/admin/usage?key=k')).json();
  ok('/api/admin/usage carries campaigns and the source notes', u.ok && Array.isArray(u.campaigns) && u.sourcesNote && typeof u.sourcesNote.returns === 'string');
}

// ── copy ──────────────────────────────────────────────────────────────────
console.log('\ncopy');
{
  const all = [];
  for (const kind of ['waiver', 'market', 'lineup']) { const d = (await N.distDraft(env, O, { kind, scoring: 'ppr', channel: 'x' }, kind === 'waiver' ? TUE : SAT)).body; all.push(d.text, ...d.explain, d.title); }
  all.push((await N.partnerPackage(env, O, 'some-show', SAT)).body.outreach);
  ok('no em dash in any draft, explanation or outreach', all.every(noDash));
  ok('no promise of results anywhere', !all.some(t => /guarantee(?!\.)|will win|lock of the week|sure thing/i.test(t.replace('not a guarantee', ''))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
