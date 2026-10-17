// Principal answers in the first HTML, and the week they belong to
// (docs/growth-plan.md, Phase 2, 17 Oct 2026).
//
// The worker writes the opening view of /rankings, a player's weekly take and
// a desk piece's headline into the HTML it serves, so a crawler or a slow
// phone gets the answer rather than "Reading the board…". This pins:
//   - the pre-rendered rankings rows rank and classify exactly as rankings.html
//     does (its classify() is lifted out of the page and compared),
//   - the times are it-season.js's own format, so hydration does not change them,
//   - a desk piece gets its own canonical, title and Article markup, and a held
//     one is noindex,
//   - a bye or a listed absence is said as such in the take, not ranked WR99,
//   - the player's props are this week's (the SQL filters on season and week),
//   - an unknown player is a 404, and every pre-render degrades to the plain
//     shell when the data is not there.
// Node only; the browser half of the proof is in the growth plan's notes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const lift = (s, a, b) => { const i = s.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return s.slice(i, s.indexOf(b, i) + b.length); };

// ── the pure helpers, lifted out of the worker ─────────────────────────────
// The scoring engine the page's own it-league.js is pinned to, which the
// rankings pre-render scores stat lines with (tools/test-scoring.mjs).
const ENGINE = src.slice(src.indexOf('// ── the scoring engine ─'), src.indexOf('const COLUMN_SCORING = {'));
const helpers = [
  ENGINE,
  lift(src, 'const _preEsc = ', ";\n"),
  lift(src, 'function _etStamp(ms) {', '\n}'),
  lift(src, 'function playerIntelFresh(j) {', '\n}'),
  lift(src, 'function _rkClassify(', '\n}'),
  lift(src, "const RK_PRE_POS = ", ";"),
  lift(src, 'const RK_PRE_COLS = ', '];'),
  lift(src, 'function rankingsPrerender(b) {', '\n}'),
  lift(src, 'function rankingsAsOf(b) {', '\n}'),
  lift(src, 'function deskPieceHead(j) {', '\n}'),
  lift(src, 'function buildTake(rows, props, usage) {', '\n}'),
].join('\n');
const H = new Function(helpers + '\nreturn { _preEsc, _etStamp, playerIntelFresh, _rkClassify, rankingsPrerender, rankingsAsOf, deskPieceHead, buildTake };')();

// ── Market Delta: the worker's copy agrees with the page's ────────────────
const rk = fs.readFileSync(path.join(ROOT, 'rankings.html'), 'utf8');
const pageClassify = new Function('var isFinite = Number.isFinite;\n' + lift(rk, 'function classify(', '\n  }') + '\nreturn classify;')();
const D = { strongRank: 8, leanRank: 3, strongPct: 0.15, leanPct: 0.05, minPointsStrong: 2, minPointsLean: 0.6,
  classes: ['STRONG VEGAS BUY', 'VEGAS LEANS HIGHER', 'MARKET AGREES', 'VEGAS LEANS LOWER', 'STRONG VEGAS FADE'] };
{
  let same = 0, n = 0, seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const c = Math.round(rnd() * 250) / 10, v = Math.round(rnd() * 250) / 10, cr = 1 + Math.floor(rnd() * 40), vr = 1 + Math.floor(rnd() * 40);
    n++; if (JSON.stringify(H._rkClassify(c, cr, v, vr, D)) === JSON.stringify(pageClassify(c, cr, v, vr, D))) same++;
  }
  ok('the pre-render classifies Market Delta exactly as rankings.html does (2,000 cases)', same === n, `${same}/${n}`);
}

// ── times: it-season.js's own kickoff() string ────────────────────────────
{
  const box = { window: {}, fetch() {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'it-season.js'), 'utf8'), box);
  const t = Date.UTC(2026, 9, 17, 17, 5);
  ok('the worker writes it-season.js\'s time format', H._etStamp(t) === box.window.ITSeason.kickoff(t), H._etStamp(t) + ' vs ' + box.window.ITSeason.kickoff(t));
  ok('in Eastern time', H._etStamp(t) === 'Sat, 10/17, 1:05 PM ET', H._etStamp(t));
  ok('and nothing for no time', H._etStamp(NaN) === '' && H._etStamp(null) === '');
}

// ── the rankings pre-render ───────────────────────────────────────────────
// Stat lines, not points: the page scores the line itself, so the fixture's
// `points` are deliberately WRONG and must not be what ranks (a quarterback's
// passing yards at 25 a point make the intended score).
const line = (pts) => ({ passYd: pts * 25 });
const qb = (name, it, c, v, extra = {}) => ({ name, position: 'QB', team: 'BUF', key: name, games: 1, byes: [], preRank: 5,
  weeks: [{ week: 6, opponent: 'LV', home: false }], injury: null, roleTrend: { label: 'flat', pct: 2 },
  consensus: { points: 99 - c, stats: line(c) }, vegas: { points: 99 - v, stats: line(v), basis: 'props', confidence: 'HIGH' }, ironTuna: { points: 99 - it, stats: line(it), confidence: 'MEDIUM' },
  why: { summary: 'The club\'s implied total is up.' }, ...extra });
const BOARD = { ok: true, season: 2026, currentWeek: 6, horizon: { key: 'week', label: 'This Week', weeks: [6] }, delta: D,
  updated: { board: Date.UTC(2026, 9, 17, 17, 5), odds: Date.UTC(2026, 9, 17, 15, 0) },
  players: [
    qb('Alpha Able', 18.0, 17.0, 21.5),
    qb('Bravo Baker', 21.2, 21.4, 21.4),
    qb('Charlie Cole', 18.0, 19.0, 18.0),          // ties Alpha on points: name breaks it
    qb('Delta Dunn', 0, 0, 0, { byes: [6], weeks: [{ week: 6, bye: true }] }),
    { ...qb('Echo RB', 30, 30, 30), position: 'RB' },
  ] };
{
  const pre = H.rankingsPrerender(BOARD);
  ok('the opening view is pre-rendered', !!pre);
  const rows = pre.body.split('<tr>').slice(1);
  ok('quarterbacks only, every one the board carries', rows.length === 4, rows.length);
  const names = rows.map(r => (r.match(/<b>([^<]+)<\/b><\/a>/) || [])[1]);
  ok('ranked by Iron Tuna points, a tie broken by name, as the page ranks them',
    names.join('|') === 'Bravo Baker|Alpha Able|Charlie Cole|Delta Dunn', names.join('|'));
  ok('rank 1 is numbered 1', /<td data-k="rank" data-l="#" class="num">1<\/td>/.test(rows[0]));
  ok('the points printed are the stat line scored, not the payload\'s `points`', rows[0].includes('<b>21.2</b>'), rows[0].slice(0, 300));
  ok('the player links his weekly page', rows[0].includes('href="/player/bravo-baker"'));
  ok('a bye says BYE, not an opponent', rows[3].includes('<span class="is-status">BYE</span>'));
  ok('Market Delta from the page\'s own rule', rows[1].includes('STRONG VEGAS BUY') && rows[0].includes('MARKET AGREES'));
  ok('eleven columns, rank sorted ascending', (pre.head.match(/<th /g) || []).length === 11 && pre.head.includes('aria-sort="ascending"'));
  ok('the note names the scoring and the week', pre.note === 'Scored at <b>PPR</b> &middot; This Week (week 6) &middot; showing the <b>Iron Tuna</b> board.', pre.note);
  ok('and the line says when', pre.asOf === 'Board computed Sat, 10/17, 1:05 PM ET &middot; betting market read Sat, 10/17, 11:00 AM ET.', pre.asOf);
  ok('no market read is said, not implied',
    H.rankingsAsOf({ updated: { board: BOARD.updated.board, odds: null } }).includes('no betting-market read on file'));
  ok('nothing to rank: no pre-render (the page\'s own empty state answers)', H.rankingsPrerender({ ...BOARD, players: [BOARD.players[4]] }) === null);
  ok('a failed board: no pre-render', H.rankingsPrerender({ ok: false, error: 'no_schedule' }) === null);
  ok('another horizon: no pre-render', H.rankingsPrerender({ ...BOARD, horizon: { key: 'ros', label: 'Rest of Season', weeks: [6, 7] } }) === null);
  ok('names are escaped', H.rankingsPrerender({ ...BOARD, players: [qb('<i>x</i>', 10, 10, 10)] }).body.includes('&lt;i&gt;x&lt;/i&gt;'));
}

// ── the player page: the take for a bye, an absence and a game ────────────
{
  const row = (w0, extra = {}) => ({ position: 'WR', weeks: [w0], ironTuna: { rank: 99, confidence: 'LOW' }, consensus: { rank: 100 },
    vegas: { rank: 99, basis: 'none', confidence: 'LOW' }, marketDelta: { classification: 'MARKET AGREES', significant: false }, injury: null, ...extra });
  const bye = H.buildTake({ week: row({ week: 6, bye: true }) }, {}, null);
  ok('a bye is said as a bye', bye.startsWith('He is on bye in Week 6, so there is no projection for him this week.'), bye);
  ok('and not ranked WR99 with the market "in agreement"', !/WR99|agree/.test(bye), bye);
  ok('nor told no book priced him', !/No sportsbook/.test(bye));
  const out = H.buildTake({ week: row({ week: 6, out: true }, { injury: { status: 'Out', thisWeek: 'Out' } }) }, {}, null);
  ok('an absence is said as one', out.startsWith('He is listed Out for Week 6'), out);
  const play = H.buildTake({ week: row({ week: 6, opponent: 'KC' }, { ironTuna: { rank: 4, confidence: 'HIGH' }, consensus: { rank: 5 }, vegas: { rank: 3, basis: 'props', confidence: 'HIGH' } }) }, { recYd: [] }, null);
  ok('a game week still ranks him', play.startsWith('This week Iron Tuna has him WR4; the consensus says WR5 and the market WR3'), play);

  const fresh = H.playerIntelFresh({ week: 6, thisWeek: { week: 6 }, updated: BOARD.updated });
  ok('the freshness line: week, scoring, both times, the method and the next step',
    fresh === 'Week 6 &middot; points at PPR &middot; board computed Sat, 10/17, 1:05 PM ET &middot; market read Sat, 10/17, 11:00 AM ET. <a href="/rankings#method">How these are built</a> &middot; <a href="/my-league#settings">Score it at my league</a>', fresh);
  ok('and says when no market was read', H.playerIntelFresh({ week: 6, updated: { board: 1 } }).includes('no market read on file'));
  // The page's own copy of the line, for the reader with no saved league,
  // must be the same words: the worker's is written over on hydration.
  const pi = fs.readFileSync(path.join(ROOT, 'player-intel.html'), 'utf8');
  ok('player-intel.html writes the same line', pi.includes("mine ? 'points at your league&rsquo;s scoring' : 'points at PPR'")
    && pi.includes("'. <a href=\"/rankings#method\">How these are built</a>' + (mine ? '' : ' &middot; <a href=\"/my-league#settings\">Score it at my league</a>')"));
  ok('the page has the hosts the worker fills', pi.includes('<p class="pi-note" id="piFresh"></p>') && pi.includes('<div class="pi-take" id="piTake" hidden></div>'));
  ok('the take sits outside the hidden body, so a pre-rendered one is visible',
    pi.indexOf('id="piTake"') < pi.indexOf('<div id="piBody" hidden>'));
  ok('the props are labelled as this week\'s', pi.includes('This week&rsquo;s props and line movement') && !pi.includes('Current props and line movement'));
}

// ── this week's props only: the SQL ───────────────────────────────────────
{
  const db = new DatabaseSync(':memory:');
  db.exec(eval(lift(src, 'const SNAP_DDL = [', '];').replace(/^const SNAP_DDL = /, ''))[0]);
  const ins = db.prepare('INSERT INTO odds_snapshots (ts, season, week, book, subject_type, subject, market, line) VALUES (?,?,?,?,?,?,?,?)');
  ins.run(1, 2026, 5, 'dk', 'player', 'jamarrchase', 'recYd', 70.5);
  ins.run(2, 2026, 5, 'fd', 'player', 'jamarrchase', 'recYd', 68.5);
  ins.run(3, 2026, 6, 'dk', 'player', 'jamarrchase', 'rec', 6.5);
  const d1 = { prepare(sql) { return { sql, a: [], bind(...a) { this.a = a; return this; }, all() { return { results: db.prepare(this.sql).all(...this.a) }; } }; } };
  const fn = new Function('snapshotReady', '_snapLookup', 'marketHistoryFrom',
    lift(src, 'async function marketHistoryAll(env, subject, season, week) {', '\n}') + '\nreturn marketHistoryAll;')(
    async () => true, s => s, rows => rows.map(r => r.line));
  const wk6 = await fn({ LEADS_DB: d1 }, 'jamarrchase', 2026, 6);
  const wk5 = await fn({ LEADS_DB: d1 }, 'jamarrchase', 2026, 5);
  const all = await fn({ LEADS_DB: d1 }, 'jamarrchase');
  ok('a week reads only that week\'s rows', JSON.stringify(wk6) === '{"rec":[6.5]}', JSON.stringify(wk6));
  ok('the week before is the week before', JSON.stringify(wk5) === '{"recYd":[70.5,68.5]}', JSON.stringify(wk5));
  ok('no week is the whole store, as the other callers expect', Object.keys(all).length === 2);
  ok('the payload asks for this week', /marketHistoryAll\(env, name, season, week\)/.test(lift(src, 'async function playerIntelPayload(', '\n}')));
}

// ── a desk piece ──────────────────────────────────────────────────────────
{
  const piece = { ok: true, status: 'published', kind: 'kickers-defenses', title: 'Kickers & Defenses', week: 6, edition: 1,
    headline: 'Stream the Panthers <now>', dek: 'Carolina is DST2.', url: '/in-season/desk/kickers-defenses/6', publishedAt: Date.UTC(2026, 9, 14, 14, 58) };
  const h = H.deskPieceHead(piece);
  ok('its own title', h.title === 'Stream the Panthers <now> | Iron Tuna');
  ok('its own dated canonical', h.url === 'https://irontuna.com/in-season/desk/kickers-defenses/6');
  ok('its dek as the description', h.desc === 'Carolina is DST2.');
  ok('the headline escaped for the page', h.h1 === 'Stream the Panthers &lt;now&gt;');
  ok('published in Eastern time', /^Published Wednesday, October 14.*10:58 AM ET\.$/.test(h.lede), h.lede);
  const ld = JSON.parse(h.ld.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, ''));
  ok('Article markup off what the page shows', ld['@type'] === 'Article' && ld.headline === piece.headline && ld.datePublished === '2026-10-14T14:58:00.000Z');
  ok('authored by the publication, not an AI persona', ld.author['@id'] === 'https://irontuna.com/#organization');
  ok('no raw < inside the script', !/<now>/.test(h.ld));
  const held = H.deskPieceHead({ ...piece, status: 'held' });
  ok('a held piece is not published, so no Article and (in the worker) noindex', held.published === false && held.ld === '');
  ok('no piece: nothing', H.deskPieceHead({ ok: false, error: 'not_found' }) === null);
  const desk = fs.readFileSync(path.join(ROOT, 'desk.html'), 'utf8');
  for (const host of ['<p class="is-eyebrow" id="dkEyebrow">The Desk &middot; In-Season</p>', '<article class="dk-piece" id="dkPiece" hidden>',
    '<p class="dk-kicker" id="dkKicker"></p>', '<div id="dkBody"></div>', '<div class="is-vacant" id="dkEmpty">', '<div class="is-actions" id="dkActions">'])
    ok('desk.html still has the host the worker fills: ' + host.slice(0, 40), desk.includes(host));
  ok('a failure after a pre-render still shows its message', /var vacant = function[^\n]*\$\('dkEmpty'\)\.hidden = false/.test(desk));
}

// ── the real worker, end to end, with no data behind it ───────────────────
{
  const worker = (await import(path.join(ROOT, '_worker.js'))).default;
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
  const ASSETS = { fetch: async (req) => {
    const p = new URL(req.url).pathname.replace(/^\//, '') || 'front';
    for (const f of [p, p + '.html']) {
      const fp = path.join(ROOT, f);
      if (f && fs.existsSync(fp) && fs.statSync(fp).isFile()) return new Response(fs.readFileSync(fp), { headers: { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' } });
    }
    return new Response('nf', { status: 404 });
  } };
  const env = { ASSETS, POST_DRAFT_OPEN: '1' };
  const get = (p) => worker.fetch(new Request('https://irontuna.com' + p, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126' } }), env, { waitUntil() {} });
  const miss = await get('/player/no-such-player-zz');
  ok('an unknown player is a 404', miss.status === 404, miss.status);
  ok('with the page still there to search from', (await miss.text()).includes('id="piEmpty"'));
  const known = (fs.readFileSync(path.join(ROOT, 'player-search.js'), 'utf8').match(/var INDEX_RAW = "([a-z0-9-]+)\|/) || [])[1];
  const hit = await get('/player/' + known);
  const hitHtml = await hit.text();
  ok('a known player is a 200 with his own head', hit.status === 200 && /<link rel="canonical" href="https:\/\/irontuna\.com\/player\//.test(hitHtml), known);
  ok('and with no board behind it, no invented take', hitHtml.includes('<div class="pi-take" id="piTake" hidden></div>'));
  const rkRes = await get('/rankings');
  const rkHtml = await rkRes.text();
  ok('/rankings with no board serves the plain shell', rkRes.status === 200 && rkHtml.includes('<tbody id="rkBody"></tbody>') && rkHtml.includes('id="rkTable" hidden'));
  ok('and stays out of shared caches', /no-store/.test(rkRes.headers.get('cache-control') || ''));
  const dk = await get('/in-season/desk/kickers-defenses/6');
  const dkHtml = await dk.text();
  ok('a desk piece with no database serves the desk shell, not a 404', dk.status === 200 && dkHtml.includes('id="dkEmpty"'));
  const front = await get('/in-season/desk');
  ok('the desk front is untouched', front.status === 200 && (await front.text()).includes('<link rel="canonical" href="https://irontuna.com/in-season/desk">'));
}

// ── the sitemap lists no duplicate of another page ───────────────────────
{
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  ok('/hub is not in the sitemap (it canonicalises to /auctiondraft)', !sm.includes('<loc>https://irontuna.com/hub</loc>'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
