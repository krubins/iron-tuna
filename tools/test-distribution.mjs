#!/usr/bin/env node
// The distribution desk and the source comparison (docs/growth-plan.md,
// Phase 6, 17 Oct 2026).
//   node tools/test-distribution.mjs          (REQUIRE_BROWSER=1 to fail on no Chromium)
//
// Lifts "THE DISTRIBUTION DESK" with the findings and homepage rules it is cut
// from, and runs it against an in-memory SQLite database. Then drives the real
// worker's routes, and /admin's panels in Chromium at 390 px. It pins:
//   - the three drafts: the Tuesday waiver rule (rostered depth, the board's
//     thresholds, health and fixture rules, a whole week only), the homepage
//     examples for Thursday or Friday, the homepage flex pair for Sunday;
//   - each draft's figures, scoring, week, timestamp, explanation, a frozen
//     finding with its image, and a link per channel and per partner tagged
//     <season>-w<NN>-<piece>; "nothing to post" with a reason, never a filler;
//   - the waiver finding page and image: dated, ranked, "check your wire";
//   - partners: validation, upsert, delete, nothing seeded;
//   - the source comparison: useful, saved league, confirmed subscription by
//     the visit it came from, seven-day return by first touch and only for
//     mature browsers, small samples, campaigns;
//   - the subscriber's attribution is cut to a label, never free text;
//   - routes: the admin gate, POST only for drafts, no board is a 409;
//   - /admin: drafts render, the channel swaps the link, edits survive it,
//     the X count, partners table and form, outreach and segment, no
//     sideways scroll, no page errors, and nothing it sends posts anywhere.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const lift = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); const j = src.indexOf(b, i); if (j < 0) throw new Error('not found: ' + b); return src.slice(i, j + b.length); };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cut ' + a); return src.slice(i, j); };

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  return { sqlite, prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
    async run() { const r = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
    async first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; } }; } };
}

// ── the lifted sections ───────────────────────────────────────────────────
const NL = cut('// THE SUNDAY EMAIL AND SHARED FINDINGS START', '// THE SUNDAY EMAIL AND SHARED FINDINGS END');
const DIST = cut('// THE DISTRIBUTION DESK START', '// THE DISTRIBUTION DESK END');
const ENGINE = src.slice(src.indexOf('// ── the scoring engine ─'), src.indexOf('const COLUMN_SCORING = {'));
const HOME = src.slice(src.indexOf('const HOME_EX_MAX = 3;'), src.indexOf('function homeShellFill(html, hp) {'));
const stubs = `
  const boardsPayload = async () => __board();
  const boardStillToPlay = (b) => b;
  const marketHistoryWeek = async () => __markets;
`;
const NORM = new Function(lift('const _oddsNorm = ', ';\n') + '\nreturn _oddsNorm;')();
const M = homeMarkets(NORM);
let BOARD = homeBoard();
const D = new Function('__board', '__markets', 'LEAD_TZ', [ENGINE, lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'), lift('function _etStamp(ms) {', '\n}'),
  lift('function b64urlEncode(bytes) {', '\n'), lift('async function hmacSign(secret, data) {', '\n'), lift('function timingSafeEq(a, b) {', '\n'),
  lift('async function unsubToken(env, email) {', '\n'),
  cut('function etOffsetHours(ms) {', 'function etClock(ms) {'), cut('function etParts(ms) {', 'const _etDow = '),
  lift('const PICKUP_ROSTERED = ', ';\n'),
  HOME, stubs, NL, DIST].join('\n')
  + '\nreturn { distributionDrafts, waiverFindingRec, distUtm, distCampaign, partnerSave, partnerDelete, partnersList, partnerClean, findingRead, findingBodyHtml, findingSvg, findingTitle, findingDesc, nlBoardNow, nlReady, nlAttribution, _etStamp, DIST_CHANNELS };');
const X = D(() => BOARD, M, 'America/New_York');

// A week board with a real waiver candidate: eighty receivers ranked the
// same by both sides (the deepest projects 4.2), then players that fail one
// rule each, and one that passes every rule.
const KICK = Date.UTC(2026, 9, 18, 17, 0);
function wr(name, consYd, itYd, o = {}) {
  return { name, position: 'WR', pos: 'WR', team: o.team || 'NO', key: name.toLowerCase().replace(/[^a-z]/g, '') + '|WR', games: 1, byes: [],
    weeks: [{ week: 6, opponent: o.opp || 'TB', home: !!o.home, kickoff: KICK, status: 'scheduled', gameState: o.gameState || 'upcoming', bye: !!o.bye, out: false,
      vegasProjection: { status: 'full', missing: [], books: o.books == null ? 6 : o.books, priced: ['rec', 'recYd'] } }],
    injury: o.injury ? { status: o.injury } : null,
    consensus: { stats: { rec: 0, recYd: consYd }, rank: 1 }, vegas: { stats: { rec: 0, recYd: o.vegYd || itYd }, basis: o.basis || 'props', confidence: 'HIGH', rank: 1 },
    ironTuna: { stats: { rec: 0, recYd: itYd }, confidence: 'HIGH', rank: 1 } };
}
function waiverBoard(extra) {
  const b = homeBoard();
  // The homepage fixture's flex fillers project far above their consensus,
  // so they would all be waiver findings; the eighty below take their place.
  const players = b.players.filter(p => !/^Flex Filler/.test(p.name));
  for (let k = 0; k < 80; k++) players.push(wr('Depth ' + k, 200 - 2 * k, 200 - 2 * k));
  players.push(wr('Waiver Wideout', 35, 150, { team: 'LV', opp: 'KC', home: true, vegYd: 120 }));       // cons 3.5 (WR81), IT 15.0
  players.push(wr('Hurt Wideout', 35, 160, { injury: 'Questionable' }));
  players.push(wr('Rostered Wideout', 100, 190));                                                      // consensus WR51: rostered
  players.push(wr('Still Deep', 34, 40));                                                              // IT 4.0: outside the line too
  players.push(wr('Floor Wideout', 25, 150));                                                          // consensus 2.5: under the floor
  players.push(wr('Bye Wideout', 35, 170, { bye: true, opp: 'BYE' }));
  players.push(wr('Unpriced Wideout', 34.5, 120, { basis: 'gamelines' }));                             // passes; no market figure
  return { ...b, players: players.concat(extra || []) };
}

// ── the Tuesday waiver rule ───────────────────────────────────────────────
console.log('\nthe Tuesday waiver finding');
{
  const nb = { b: waiverBoard(), week: 6, season: 2026, markets: M };
  const w = X.waiverFindingRec(nb, 'ppr');
  const x = w.rec && w.rec.player;
  ok('the widest qualifying gap is the one chosen', x && x.name === 'Waiver Wideout', JSON.stringify(w).slice(0, 300));
  ok('its ranks are re-cut within position at the preset', x && x.consRank === 97 && x.itRank <= 72 && x.itRank === 31, x && (x.consRank + ' / ' + x.itRank));
  ok('the rostered line is 6 x 12 = 72 receivers', w.rec.line === 72 && w.rec.teams === 12);
  ok('figures: Iron Tuna, consensus, the gap', x.ironTuna === 15 && x.consensus === 3.5 && x.gap === 11.5);
  ok('a fully priced player carries the market figure as a derived estimate', x.market === 12 && x.books === 6);
  ok('season, week, scoring, board and odds times', w.rec.season === 2026 && w.rec.week === 6 && w.rec.scoring === 'ppr' && w.rec.boardAt && w.rec.oddsAt);
  const names = (b) => { const out = []; let bb = b; for (;;) { const r = X.waiverFindingRec({ ...nb, b: bb }, 'ppr'); if (!r.rec) return out; out.push(r.rec.player.name); bb = { ...bb, players: bb.players.filter(p => p.name !== r.rec.player.name) }; } };
  const all = names(nb.b);
  ok('only the two players who pass every rule ever qualify', all.join(',') === 'Waiver Wideout,Unpriced Wideout', all.join(','));
  const up = X.waiverFindingRec({ ...nb, b: { ...nb.b, players: nb.b.players.filter(p => p.name !== 'Waiver Wideout') } }, 'ppr');
  ok('without a full props price there is no market figure, not a guessed one', up.rec.player.name === 'Unpriced Wideout' && up.rec.player.market === null && up.rec.player.books === null);
  ok('once a game has kicked off, no waiver finding, and it says why', X.waiverFindingRec({ ...nb, b: { ...nb.b, played: 3 } }, 'ppr').rec === null && /started/.test(X.waiverFindingRec({ ...nb, b: { ...nb.b, played: 3 } }, 'ppr').why));
  const none = X.waiverFindingRec({ b: homeBoard(), week: 6, season: 2026 }, 'ppr');
  ok('a board with no candidate: none, with the reason', none.rec === null && /No player clears the waiver bar at PPR/.test(none.why), none.why);
  ok('no single-week board: none', X.waiverFindingRec({ b: { ...nb.b, horizon: { key: 'ros', weeks: [6, 7] } } }, 'ppr').rec === null);
}

// ── the three drafts ──────────────────────────────────────────────────────
console.log('\nthe drafts');
const db = makeDb();
const env = { LEADS_DB: db };
const AT = Date.UTC(2026, 9, 13, 14, 0);                  // Tue 10/13 10:00 AM ET
{
  BOARD = waiverBoard();
  const nb = await X.nlBoardNow(env);
  await X.partnerSave(env, { slug: 'sunday-pod', name: 'A podcast I chose', status: 'contacted' }, AT);
  const d = await X.distributionDrafts(env, nb, 'ppr', AT, await X.partnersList(env));
  ok('three drafts, in posting order', d.ok && d.drafts.map(x => x.piece).join(',') === 'waiver,vegas-gaps,lineup', d.drafts.map(x => x.piece).join(','));
  ok('each says its day', d.drafts.map(x => x.day).join(' / ') === 'Tuesday / Thursday or Friday / Sunday morning');
  ok('all three ready on this board', d.drafts.every(x => x.status === 'ready'), d.drafts.map(x => x.status + ':' + (x.why || '')).join(' | '));
  const [w, g, l] = d.drafts;
  ok('campaigns follow <season>-w<NN>-<piece>', w.campaign === '2026-w06-waiver' && g.campaign === '2026-w06-vegas-gaps' && l.campaign === '2026-w06-lineup');
  ok('every draft carries week, scoring and the board time', d.drafts.every(x => x.week === 6 && x.scoring === 'ppr' && x.boardAt === BOARD.updated.board));
  ok('every draft text has the week, the scoring, the time and one link slot', d.drafts.every(x => /Week 6/.test(x.text) && /PPR/.test(x.text) && x.text.includes('As of ' + X._etStamp(BOARD.updated.board)) && x.text.split('{link}').length === 2));
  ok('every draft has an explanation and the rule it applied', d.drafts.every(x => x.explain && x.rule));
  ok('the waiver text names the player, both projections and "check your wire"', /Waiver Wideout/.test(w.text) && /15\.0 points; the consensus has 3\.5/.test(w.text) && /Check your wire/.test(w.text), w.text);
  ok('the waiver rule prints the depth per position', /QB 17, RB 60, WR 72, TE 18/.test(w.rule), w.rule);
  ok('market draft: the homepage examples at this preset, up to three, market first', g.findings.length === 3 && /Vegas vs expert consensus, biggest gaps/.test(g.text) && /1\. Drake London \+5\.0 \(16\.0 vs 11\.0\)/.test(g.text), g.text);
  ok('market draft labels the market points derived and says not betting advice', /Market points derived from quoted props\. Not betting advice/.test(g.text) && g.figures.every(t => /derived estimate, \d+ books/.test(t)));
  const xLen = (t) => t.replace('{link}', '01234567890123456789012').length;
  ok('every draft fits X as built (a link counts 23)', d.drafts.every(x => xLen(x.text) <= 280), d.drafts.map(x => xLen(x.text)).join(', '));
  ok('market draft explains with the quoted line', /Books quote 89\.5 receiving yards/.test(g.explain), g.explain);
  ok('lineup draft: the homepage flex pair, the call and the margin', /Iron Tuna would start Depth \d+ \(\d+\.\d\) over Depth \d+ \(\d+\.\d\), \d+\.\d points apart/.test(l.text) && l.findings[0].id.includes('-vs-'), l.text);
  ok('no em dash in any draft', !/—/.test(JSON.stringify(d.drafts)));
  const f = w.findings[0];
  ok('a frozen finding per draft, with its image', f.url === 'https://irontuna.com/finding/' + f.id && f.image === f.url + '/card.svg' && f.id.startsWith('2026-w6-waiver-wideout-ppr-'), f.id);
  ok('a link per channel, tagged source, social and the campaign', X.DIST_CHANNELS.every(ch => f.links[ch] === f.url + '?utm_source=' + ch + '&utm_medium=social&utm_campaign=2026-w06-waiver'), f.links.x);
  ok('a link per partner, tagged creator-<slug> and partner', f.partner['sunday-pod'] === f.url + '?utm_source=creator-sunday-pod&utm_medium=partner&utm_campaign=2026-w06-waiver', f.partner['sunday-pod']);
  ok('the partner\'s name never reaches a link', !JSON.stringify(d).includes('A podcast I chose'));
  const again = await X.distributionDrafts(env, nb, 'ppr', AT + 3600000, []);
  ok('building again with the same figures gives the same pages, still dated the first time', again.drafts[0].findings[0].id === f.id && again.drafts[0].findings[0].frozenAt === AT);
  const rec = await X.findingRead(env, f.id);
  ok('the stored finding is the waiver record', rec && rec.kind === 'waiver' && rec.player.name === 'Waiver Wideout' && rec.line === 72);
  const body = X.findingBodyHtml(rec, f.id);
  ok('the finding page: dated, both ranks, the depth line, check your wire', /Dated finding/.test(body) && /These numbers do not update/.test(body) && /\(WR31\)/.test(body) && /\(WR97\)/.test(body)
     && /below the 72 WRs a 12-team league usually rosters/.test(body) && /check it before you bid/.test(body), body.slice(0, 400));
  ok('the finding page labels the market figure a derived estimate', /Derived estimate<\/span> Market points 12\.0, converted from 6 books/.test(body));
  ok('its share action is tagged as a waiver finding', /data-it-share-tool="finding_waiver"/.test(body));
  const svg = X.findingSvg(rec);
  ok('the share image: name, gap, both ranks, week, scoring, frozen time, the site', /Waiver Wideout/.test(svg) && /\+11\.5 pts/.test(svg) && /Iron Tuna 15\.0 \(WR31\)/.test(svg) && /Consensus 3\.5 \(WR97\)/.test(svg) && /Week 6, PPR/.test(svg) && /Frozen /.test(svg) && /irontuna\.com/.test(svg));
  ok('title and description name the finding', /Waiver Wideout: Iron Tuna WR31, consensus WR97 \(Week 6, PPR\)/.test(X.findingTitle(rec)) && /Frozen /.test(X.findingDesc(rec)));
  ok('names are escaped on the page and the image', (() => { const e = { ...rec, player: { ...rec.player, name: '<b>x</b>' } }; return !X.findingBodyHtml(e, f.id).includes('<b>x</b>') && !X.findingSvg(e).includes('<b>x</b>'); })());

  // Nothing to post: each draft says why, and freezes nothing.
  BOARD = { ...homeBoard(), players: [] };
  const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM findings').get().n;
  const e = await X.distributionDrafts(env, await X.nlBoardNow(env), 'ppr', AT, []);
  ok('an empty board: three drafts, each "none" with a reason', e.drafts.every(x => x.status === 'none' && x.why && !x.text && !x.findings.length), e.drafts.map(x => x.why).join(' | '));
  ok('and no finding was frozen for them', db.sqlite.prepare('SELECT COUNT(*) AS n FROM findings').get().n === before);
  BOARD = homeBoard();
  const h = await X.distributionDrafts(env, await X.nlBoardNow(env), 'standard', AT, []);
  ok('another preset re-cuts the market draft (Yards Guy only qualifies at Standard)', h.drafts[1].figures.some(t => /^Yards Guy/.test(t)) && h.drafts[1].campaign === '2026-w06-vegas-gaps', h.drafts[1].figures.join(' | '));
  ok('the home board has no waiver candidate and says so', h.drafts[0].status === 'none');
  ok('UTM helper keeps an existing query and sets the three tags', X.distUtm('https://irontuna.com/x?a=1', 'x', 'social', 'c') === 'https://irontuna.com/x?a=1&utm_source=x&utm_medium=social&utm_campaign=c');
  ok('campaign pads the week', X.distCampaign(2026, 12, 'lineup') === '2026-w12-lineup');
}

// ── partners ──────────────────────────────────────────────────────────────
console.log('\npartners');
{
  const pdb = makeDb(), penv = { LEADS_DB: pdb };
  ok('nothing is seeded', (await X.partnersList(penv)).length === 0);
  ok('a bad slug is refused', (await X.partnerSave(penv, { slug: 'Bad Slug!', name: 'x' })).error === 'bad_slug');
  ok('a name is required', (await X.partnerSave(penv, { slug: 'ok', name: ' ' })).error === 'name_required');
  ok('an address must be https', (await X.partnerSave(penv, { slug: 'ok', name: 'x', url: 'javascript:alert(1)' })).error === 'bad_url');
  ok('an unknown status falls back to prospect', (await X.partnerSave(penv, { slug: 'ok', name: 'x', status: 'paid' }, 1)).partner.status === 'prospect');
  await X.partnerSave(penv, { slug: 'ok', name: 'Renamed', channel: 'YouTube', status: 'live', notes: 'n' }, 2);
  const l = await X.partnersList(penv);
  ok('saving a slug again updates it, keeps one row and its first date', l.length === 1 && l[0].name === 'Renamed' && l[0].status === 'live' && l[0].created_at === 1 && l[0].updated_at === 2);
  ok('notes are cut to 500', X.partnerClean({ slug: 'a', name: 'b', notes: 'x'.repeat(900) }).notes.length === 500);
  ok('delete removes it', (await X.partnerDelete(penv, 'ok')).ok && (await X.partnersList(penv)).length === 0);
}

// ── the subscriber's attribution ──────────────────────────────────────────
console.log('\nattribution');
{
  ok('src|med|cmp from the visit', X.nlAttribution({ src: 'x', med: 'social', cmp: '2026-w06-waiver' }) === 'x|social|2026-w06-waiver');
  ok('nothing but label characters survives', X.nlAttribution({ src: 'A b@c.com<script>', med: 'So Cial', cmp: '' }) === 'abc.comscript|social|');
  ok('no visit, no attribution', X.nlAttribution(null) === null && X.nlAttribution({ src: '' }) === null);
}

// ── the real worker: routes and the source comparison ─────────────────────
console.log('\nthe real worker');
const worker = (await import(path.join(ROOT, '_worker.js'))).default;
const DDL = eval(src.match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const rdb = makeDb();
for (const q of DDL) rdb.sqlite.exec(q);
const renv = { LEADS_DB: rdb, LEADS_EXPORT_KEY: 'k', ASSETS: { fetch: () => new Response('', { status: 404 }) } };
const call = (p, init) => worker.fetch(new Request('https://irontuna.com' + p, { headers: { 'user-agent': CHROME, 'content-type': 'application/json' }, ...(init || {}) }), renv, { waitUntil() {} });
{
  ok('drafts: the admin key is required', (await call('/api/admin/drafts', { method: 'POST' })).status === 403);
  ok('drafts: GET is refused (building freezes findings)', (await call('/api/admin/drafts?key=k')).status === 405);
  const r = await call('/api/admin/drafts?key=k', { method: 'POST' });
  ok('drafts: no week board is a 409 that says so', r.status === 409 && (await r.json()).error === 'no_board');
  ok('partners: the admin key is required', (await call('/api/admin/partners')).status === 403);
  let j = await (await call('/api/admin/partners?key=k')).json();
  ok('partners: an empty list and the statuses', j.ok && j.partners.length === 0 && j.statuses.includes('prospect'));
  let s = await call('/api/admin/partners?key=k', { method: 'POST', body: JSON.stringify({ action: 'save', slug: 'sunday-pod', name: 'Chosen Pod', status: 'live' }) });
  ok('partners: save', s.status === 200 && (await s.json()).ok);
  s = await call('/api/admin/partners?key=k', { method: 'POST', body: JSON.stringify({ action: 'save', slug: 'x y' , name: 'z' }) });
  ok('partners: a bad slug is a 400', s.status === 400);
  j = await (await call('/api/admin/partners?key=k')).json();
  ok('partners: listed', j.partners.length === 1 && j.partners[0].slug === 'sunday-pod');
}
{
  // Seeded events: the worker can only write "now", and returns are about
  // other days.
  const now = Date.now(), DAY = 86400000, dayOf = t => new Date(t).toISOString().slice(0, 10);
  const seed = (t, event, uid, props) => rdb.sqlite.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?,?,?,?,?,?,0)').run(t, dayOf(t), event, uid, '/', JSON.stringify(props));
  // Two browsers from a creator link 12 days ago: one used a tool and came
  // back three days later (direct), one did neither.
  seed(now - 12 * DAY, 'visit_start', 'crea00001', { vid: 'c1', src: 'creator-sunday-pod', med: 'partner', cmp: '2026-w05-vegas-gaps', new: 1 });
  seed(now - 12 * DAY + 1000, 'tool_success', 'crea00001', { vid: 'c1', tool: 'vegas_edge', key: 'k' });
  seed(now - 9 * DAY, 'visit_start', 'crea00001', { vid: 'c1b', src: 'direct', med: 'none', new: 0 });
  seed(now - 12 * DAY, 'visit_start', 'crea00002', { vid: 'c2', src: 'creator-sunday-pod', med: 'partner', cmp: '2026-w05-vegas-gaps', new: 1 });
  // One from X two days ago who saved a league: too young for a return.
  seed(now - 2 * DAY, 'visit_start', 'xxxx00001', { vid: 'x1', src: 'x', med: 'social', cmp: '2026-w06-waiver', new: 1 });
  seed(now - 2 * DAY + 1000, 'league_setup_complete', 'xxxx00001', { vid: 'x1', tool: 'league_scoring' });
  // A returning browser from before the window's first-seen rule.
  seed(now - 3 * DAY, 'visit_start', 'old000001', { vid: 'o1', src: 'google.com', med: 'organic', new: 0 });
  rdb.sqlite.exec("CREATE TABLE IF NOT EXISTS newsletter_subscribers (email TEXT PRIMARY KEY, status TEXT NOT NULL, scoring TEXT NOT NULL DEFAULT 'ppr', source TEXT, consent TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirm_sent_at INTEGER, confirmed_at INTEGER, unsubscribed_at INTEGER, attribution TEXT)");
  rdb.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, created_at, updated_at, confirmed_at, attribution) VALUES (?, 'confirmed', ?, ?, ?, ?)").run('a@example.com', now - 11 * DAY, now - 11 * DAY, now - 11 * DAY, 'creator-sunday-pod|partner|2026-w05-vegas-gaps');
  rdb.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, created_at, updated_at, confirmed_at, attribution) VALUES (?, 'pending', ?, ?, NULL, ?)").run('b@example.com', now - DAY, now - DAY, 'x|social|2026-w06-waiver');
  rdb.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, created_at, updated_at, confirmed_at, attribution) VALUES (?, 'confirmed', ?, ?, ?, NULL)").run('c@example.com', now - DAY, now - DAY, now - DAY);
  const u = await (await call('/api/admin/usage?key=k&days=30')).json();
  const row = (s) => (u.bySource || []).find(r => r.source === s);
  const c = row('creator-sunday-pod'), x = row('x'), d = row('direct'), un = row('unattributed');
  ok('usage carries the comparison', u.ok && Array.isArray(u.bySource) && Array.isArray(u.campaigns), JSON.stringify(u).slice(0, 200));
  ok('creator row: visitors, useful, no league', c && c.visitors === 2 && c.usefulVisitors === 1 && c.usefulPct === 50 && c.leagueVisitors === 0, JSON.stringify(c));
  ok('creator row: a confirmed subscription credited to the visit it came from', c.confirmed === 1 && c.confirmedMeasured === true);
  ok('creator row: the return is the first visit\'s source, among mature browsers', c.newBrowsers === 2 && c.matureNew === 2 && c.returned7 === 1 && c.return7Pct === 50 && c.maturing === 0, JSON.stringify(c));
  ok('the direct return visit does not credit direct with a new browser', d && d.newBrowsers === 0 && d.returned7 === 0);
  ok('X row: a saved league; too young for a return rate, counted as maturing', x && x.leagueVisitors === 1 && x.matureNew === 0 && x.return7Pct === null && x.maturing === 1, JSON.stringify(x));
  ok('a pending sign-up is not confirmed', x.confirmed === 0);
  ok('a confirmed sign-up with no attribution is shown as unattributed', un && un.confirmed === 1 && un.visitors === 0);
  ok('every row under 20 is a small sample and too young to compare', u.bySource.every(r => r.small && r.immature));
  const cg = u.campaigns;
  ok('campaigns: one row per tagged source and campaign, with useful', cg.length === 2 && cg.some(r => r.campaign === '2026-w05-vegas-gaps' && r.visitors === 2 && r.usefulVisitors === 1) && cg.some(r => r.campaign === '2026-w06-waiver' && r.source === 'x'), JSON.stringify(cg));
  ok('no address reaches the usage payload', !/@example\.com/.test(JSON.stringify(u)));
  const fresh = makeDb(); for (const q of DDL) fresh.sqlite.exec(q);
  const u2 = await (await worker.fetch(new Request('https://irontuna.com/api/admin/usage?key=k', { headers: { 'user-agent': CHROME } }), { ...renv, LEADS_DB: fresh }, { waitUntil() {} })).json();
  ok('no subscriber table: the comparison still answers, confirmed unmeasured', u2.ok && Array.isArray(u2.bySource) && !u2.readError, JSON.stringify(u2).slice(0, 200));
}
{
  // Sign-up stores the visit's source on the subscriber row, nowhere else.
  const sdb = makeDb();
  const senv = { LEADS_DB: sdb, AUTH_SECRET: 's', RESEND_API_KEY: 're', MAIL_ADDRESS: '1 Example Way', NEWSLETTER_ENABLED: '1', LEADS_EXPORT_KEY: 'k', ASSETS: renv.ASSETS };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).startsWith('https://api.resend.com/') ? new Response('{"id":"m"}', { status: 200 }) : realFetch(u, init);
  const r = await worker.fetch(new Request('https://irontuna.com/api/newsletter/subscribe', { method: 'POST', headers: { 'user-agent': CHROME, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'att@example.com', consent: true, source: 'home_examples', att: { src: 'creator-sunday-pod', med: 'partner', cmp: '2026-w06-vegas-gaps' } }) }), senv, { waitUntil() {} });
  globalThis.fetch = realFetch;
  const row = sdb.sqlite.prepare("SELECT attribution, source FROM newsletter_subscribers WHERE email = 'att@example.com'").get();
  ok('sign-up: the visit\'s source is stored with the subscriber', r.status === 200 && row && row.attribution === 'creator-sunday-pod|partner|2026-w06-vegas-gaps' && row.source === 'home_examples', JSON.stringify(row));
}
{
  // it-newsletter.js sends the visit's source from it-metrics.js, and only that.
  const nl = fs.readFileSync(path.join(ROOT, 'it-newsletter.js'), 'utf8');
  ok('it-newsletter.js sends att from ITMetrics.visit(): source, medium, campaign', /att: visitSource\(\)/.test(nl) && /\{ src: v\.src, med: v\.med, cmp: v\.cmp \}/.test(nl));
}

// ── /admin in Chromium at 390 px ──────────────────────────────────────────
console.log('\n/admin, Distribution');
let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch (e) {}
const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
const findExe = () => { if (exe) return exe; try { const d = '/opt/pw-browsers'; for (const n of fs.readdirSync(d)) { const p = path.join(d, n, 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {} return null; };
const bin = findExe();
if (!chromium || !bin) {
  if (process.env.REQUIRE_BROWSER === '1') { fail++; console.log('  FAIL no Chromium (REQUIRE_BROWSER=1)'); }
  else console.log('  skip (no playwright-core or Chromium)');
} else {
  // The real worker builds the drafts payload the page renders: the lifted
  // section over the waiver board, so the page reads the worker's own shape.
  BOARD = waiverBoard();
  const ddb = makeDb(), denv = { LEADS_DB: ddb };
  await X.partnerSave(denv, { slug: 'sunday-pod', name: 'Chosen Pod', channel: 'podcast', status: 'contacted' }, AT);
  const drafts = await X.distributionDrafts(denv, await X.nlBoardNow(denv), 'ppr', AT, await X.partnersList(denv));
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const posts = [];
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); });
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch({ executablePath: bin });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const usagePayload = { ok: true, available: true, days: 30, collectingSince: AT, visitors: {}, funnel: {}, retention7: { cohorts: [] }, subscriptions: {}, tools: [], sources: [], surfaces: [], weekly: [], shares: [],
    bySource: [{ source: 'creator-sunday-pod', medium: 'partner', visitors: 2, usefulVisitors: 1, leagueVisitors: 0, newBrowsers: 2, matureNew: 2, returned7: 1, maturing: 0, confirmed: 1, usefulPct: 50, leaguePct: 0, return7Pct: 50, small: true, immature: true, confirmedMeasured: true }],
    campaigns: [{ source: 'creator-sunday-pod', medium: 'partner', campaign: '2026-w05-vegas-gaps', visits: 2, visitors: 2, usefulVisitors: 1, small: true }] };
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/admin/traffic') return j({ ok: true, days: 30, daily: [], pages: [], sources: [], countries: [], events: [], totals: {} });
    if (u.pathname === '/api/admin/usage') return j(usagePayload);
    if (u.pathname === '/api/admin/drafts') { posts.push(m + ' ' + u.pathname); return j(drafts); }
    if (u.pathname === '/api/admin/partners') {
      if (m === 'POST') { posts.push('POST partners ' + route.request().postData()); return j({ ok: true }); }
      return j({ ok: true, partners: await X.partnersList(denv), statuses: ['prospect', 'contacted', 'live'] });
    }
    posts.push('OTHER ' + m + ' ' + u.pathname);
    return j({ ok: false });
  });
  await page.addInitScript(() => { localStorage.setItem('it_admin_key', 'k'); });
  await page.goto('http://127.0.0.1:' + srv.address().port + '/admin');
  await page.waitForFunction(() => document.getElementById('useCmpTbl').textContent.includes('creator-sunday-pod'));
  ok('Compare sources: the creator row with confirmed and return, small and young flagged', await page.evaluate(() => { const t = document.getElementById('useCmpTbl').textContent; return /small sample/.test(t) && /too young/.test(t) && /50%/.test(t); }));
  ok('Campaigns: the tagged campaign row', await page.evaluate(() => document.getElementById('useCampTbl').textContent.includes('2026-w05-vegas-gaps')));
  await page.click('#dist > summary');
  await page.waitForFunction(() => document.getElementById('ptTbl').textContent.includes('Chosen Pod'));
  ok('Partners: listed with what its links produced', await page.evaluate(() => { const t = document.getElementById('ptTbl').textContent; return /creator-sunday-pod/.test(t) && /contacted/.test(t) && /50%/.test(t); }));
  await page.click('#distBuild');
  await page.waitForFunction(() => document.querySelectorAll('.dist-draft').length === 3);
  ok('building posts once to the drafts route', posts.filter(p => p === 'POST /api/admin/drafts').length === 1, posts.join(' | '));
  const ta0 = await page.$eval('.dist-draft[data-i="0"] textarea', t => t.value);
  ok('the waiver draft text, with the X link filled in', /Waiver Wideout/.test(ta0) && /utm_source=x&utm_medium=social&utm_campaign=2026-w06-waiver/.test(ta0) && !/\{link\}/.test(ta0), ta0);
  ok('the X count shows', /X counts \d+/.test(await page.$eval('.dist-draft[data-i="0"] .dist-count', e => e.textContent)));
  await page.fill('.dist-draft[data-i="0"] textarea', ta0.replace('Check your wire.', 'Check your wire, edited.'));
  await page.selectOption('.dist-draft[data-i="0"] .dist-target', 'pt:sunday-pod');
  const ta1 = await page.$eval('.dist-draft[data-i="0"] textarea', t => t.value);
  ok('choosing a partner swaps the link and keeps the edit', /utm_source=creator-sunday-pod&utm_medium=partner/.test(ta1) && !/utm_source=x&/.test(ta1) && /edited\./.test(ta1), ta1);
  ok('the market draft lists three findings with their images', await page.evaluate(() => { const d = document.querySelector('.dist-draft[data-i="1"]'); return d.querySelectorAll('.dist-links a').length === 6 && /card\.svg/.test(d.innerHTML); }));
  ok('every finding link under a draft follows the chosen channel', await page.evaluate(() => [].every.call(document.querySelectorAll('.dist-draft[data-i="1"] .dist-flink'), s => /utm_source=x&/.test(s.textContent))));
  await page.selectOption('#orPartner', 'sunday-pod');
  const or = await page.$eval('#orText', t => t.value), seg = await page.$eval('#orSeg', t => t.value);
  ok('outreach: the partner\'s name, this week\'s example and its tagged link', /^Hi Chosen Pod,/.test(or) && /Drake London/.test(or) && /utm_source=creator-sunday-pod/.test(or) && /\[Your name\]/.test(or), or.slice(0, 300));
  ok('outreach claims nothing measured: no traffic, audience or result figures', !/(visitors|subscribers|readers a week|traffic of|\d+% of)/i.test(or));
  ok('segment: the three differences, the labels and "not betting advice"', /1\. Drake London/.test(seg) && /3\. /.test(seg) && /not a prediction and not betting advice/.test(seg) && /21\+/.test(seg));
  ok('no em dash in outreach or segment', !/—/.test(or + seg));
  ok('no sideways scroll at 390 px with the Distribution panel open', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)));
  ok('nothing on the page called anything but the admin reads, drafts and partners', !posts.some(p => p.startsWith('OTHER')), posts.join(' | '));
  ok('no page errors', !errs.length, errs.join(' | '));
  if (process.env.DIST_SHOT) await page.screenshot({ path: process.env.DIST_SHOT, fullPage: true });
  await browser.close(); srv.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
