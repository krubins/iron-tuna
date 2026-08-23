#!/usr/bin/env node
// Tests for the per-player consensus-vs-odds answer.
//   node tools/test-player-odds.mjs
//
// The front page's column prints twelve cases; a player card has to answer for
// all four hundred, including the players no book ever priced. Both read ONE
// computation — buildVegasBoard in _worker.js — and the point of this file is
// that they stay one: if the column and a card ever disagree about the same
// player's slot, the site is telling a reader two different things about the
// same man on two pages.
//
// Like tools/test-worker-column.mjs this evaluates the REAL worker source
// rather than a reimplementation, checks the client's hand-declared contracts
// against the worker's, and finishes against the live nflverse pull so the
// board is exercised on real lines.

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
const card = fs.readFileSync(path.join(ROOT, 'player.html'), 'utf8');
const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');

// ── lift the Vegas section out of the worker ───────────────────────────────
const START = '// Vegas-weighted projections';
const s0 = src.indexOf(START);
const e0 = src.indexOf('export default {', s0);
if (s0 < 0 || e0 < 0) { console.error('FAIL: could not locate the Vegas section in _worker.js'); process.exit(1); }
const section = src.slice(s0, e0);

const harness = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null;
  ${section}
  return { buildVegasBoard, buildVegasDigest, buildVegasColumn, buildPlayerOdds, playerOddsFrom,
           _colMeaningful, _oddsNorm, fetchTeamEnvNflverse, buildTeamEnvOverlay,
           COLUMN_POSITIONS, COLUMN_CURVE, COLUMN_MIN_RANK_GAP, COLUMN_MIN_PRICE_GAP,
           COLUMN_CONTRACT, PODDS_CONTRACT };
`);

const realPool = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  const seg = src.slice(st, src.indexOf('\n];', st));
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();

const noNet = async () => { throw new Error('no network in this block'); };
const R = harness(realPool, () => 'ENC', 'k', noNet);

// A market that prices roughly a third of the board, in both directions, so the
// board has genuine risers, genuine faders and a large untouched remainder.
function synthOverlay() {
  const overlay = {};
  let n = 0;
  for (const p of realPool) {
    if (!R.COLUMN_POSITIONS.includes(p.position)) continue;
    if (n++ % 3) continue;
    const st = p.projectedStats, o = {};
    const k = 1 + (((n % 7) - 3) * 0.05);
    for (const key of ['passYd', 'passTD', 'rushYd', 'rushTD', 'recYd', 'recTD', 'rec']) {
      if (st[key]) o[key] = Math.round(st[key] * k * 10) / 10;
    }
    overlay[R._oddsNorm(p.name) + '|' + p.position] = o;
  }
  return overlay;
}
const OVERLAY = synthOverlay();
const CTX = { ppg: { KC: 27.1, NYG: 18.4 }, rank: { KC: 2, NYG: 29 } };

// ── 1. the contracts the clients ask for match the ones the worker serves ───
console.log('\nhand-declared contracts');
{
  const w = src.match(/const PODDS_CONTRACT = (\d+)/);
  const c = card.match(/var PC_ODDS_CONTRACT = (\d+)/);
  ok('the worker declares a player-odds contract', !!w);
  ok('player.html declares one too', !!c);
  ok('player.html asks for the contract the worker serves', w && c && w[1] === c[1],
     w && c ? `worker ${w[1]} vs card ${c[1]}` : '');
  // The column's own pair is asserted in tools/test-it-league.mjs; this only
  // checks that a digest change bumped it, since front.html now prints digest
  // fields and a stale cached payload would print them as "undefined".
  const wc = src.match(/const COLUMN_CONTRACT = (\d+)/);
  const fc = front.match(/var VS_CONTRACT = (\d+)/);
  ok('the column contract still matches front.html', wc && fc && wc[1] === fc[1],
     wc && fc ? `worker ${wc[1]} vs front ${fc[1]}` : '');
  ok('the card asks the endpoint by version', /\/api\/player-odds\?v=' \+ PC_ODDS_CONTRACT/.test(card));
  ok('the card drops a payload of another vintage',
     /d\.contract !== PC_ODDS_CONTRACT\) return/.test(card));
}

// ── 2. the board covers the whole board ────────────────────────────────────
console.log('\nthe board');
const board = R.buildVegasBoard(OVERLAY, CTX);
{
  ok('it builds', board.ok === true);
  const want = realPool.filter(p => R.COLUMN_POSITIONS.includes(p.position)).length;
  ok('every skill player in the pool gets a row', board.rows.length === want, `${board.rows.length}/${want}`);
  ok('players the market never priced are on it too',
     board.rows.some(r => !r.priced) && board.rows.some(r => r.priced));
  for (const pos of R.COLUMN_POSITIONS) {
    const at = board.rows.filter(r => r.position === pos);
    const seen = new Set(at.map(r => r.rankConsensus));
    ok(`${pos} consensus ranks are 1..N with no ties or gaps`,
       seen.size === at.length && Math.min(...seen) === 1 && Math.max(...seen) === at.length);
    const seenI = new Set(at.map(r => r.rankIronTuna));
    ok(`${pos} odds-adjusted ranks are 1..N with no ties or gaps`,
       seenI.size === at.length && Math.min(...seenI) === 1 && Math.max(...seenI) === at.length);
  }
  ok('rankDelta is always consensus minus odds-adjusted',
     board.rows.every(r => r.rankDelta === r.rankConsensus - r.rankIronTuna));
  ok('a player with no line has nothing in `moved`',
     board.rows.every(r => r.priced || r.moved.length === 0));
  ok('a priced player always carries what moved',
     board.rows.every(r => !r.priced || r.moved.length > 0));
  ok('no overlay is a refusal, not an empty board',
     R.buildVegasBoard(null, CTX).ok === false && R.buildVegasBoard(null, CTX).rows.length === 0);
}

// ── 3. the column is a filter over the board, not a second opinion ─────────
console.log('\nthe column and the card agree');
{
  const col = R.buildVegasColumn(OVERLAY, CTX);
  ok('the column still builds', col.ok === true && col.items.length > 0);
  ok('it ships the digest', !!col.digest && isFinite(col.digest.moved));
  let matched = 0;
  for (const it of col.items) {
    const one = R.buildPlayerOdds(OVERLAY, CTX, it.name, it.position);
    if (!one.player) continue;
    matched++;
    const same = one.player.rankConsensus === it.rankConsensus
              && one.player.rankIronTuna === it.rankIronTuna
              && one.player.rankMarket === it.rankMarket
              && one.player.priceConsensus === it.priceConsensus
              && one.player.priceIronTuna === it.priceIronTuna
              && one.player.ptsDelta === it.ptsDelta;
    if (!same) { ok(`card and column agree on ${it.name}`, false, JSON.stringify({ card: one.player, column: it }).slice(0, 240)); }
  }
  ok('every case on the front page is answerable on a card', matched === col.items.length,
     `${matched}/${col.items.length}`);
  ok('and the two never disagree about the numbers', true);
  ok('the column never prints a player the market did not price',
     col.items.every(i => i.moved.length > 0));
  ok('internal board flags do not leak into the column payload',
     col.items.every(i => !('priced' in i) && !('draftable' in i)));
}

// ── 4. one player's answer ─────────────────────────────────────────────────
console.log('\none player');
{
  const priced = board.rows.find(r => r.priced && r.rankDelta !== 0 && r.draftable);
  const one = R.buildPlayerOdds(OVERLAY, CTX, priced.name, priced.position);
  ok('a priced player is answered', one.ok === true && !!one.player, priced.name);
  ok('the answer carries both boards', one.player.rankConsensus > 0 && one.player.rankIronTuna > 0);
  ok('and the day\'s digest with it', !!one.digest && isFinite(one.digest.moved));
  ok('a meaningful gap gets a place in the day\'s queue',
     !one.player.meaningful || (one.player.queueRank >= 1 && one.player.queueRank <= one.player.queueOf));

  const quiet = board.rows.find(r => !r.priced);
  const two = R.buildPlayerOdds(OVERLAY, CTX, quiet.name, quiet.position);
  ok('a player no book priced is still answered', !!two.player, quiet.name);
  ok('and his answer says nothing moved on him', two.player.priced === false && two.player.moved.length === 0);
  ok('but his slot is still stated on both boards',
     two.player.rankConsensus > 0 && two.player.rankIronTuna > 0);

  ok('a kicker is told why there is nothing to compare',
     R.buildPlayerOdds(OVERLAY, CTX, 'Any Kicker', 'K').reason === 'unpriced_position');
  ok('so is a defence',
     R.buildPlayerOdds(OVERLAY, CTX, 'Any Defence', 'DEF').reason === 'unpriced_position');
  ok('a name off the board is refused rather than guessed',
     R.buildPlayerOdds(OVERLAY, CTX, 'Nobody Whatsoever', 'WR').reason === 'off_board');
  ok('an empty name is refused', R.buildPlayerOdds(OVERLAY, CTX, '', 'WR').reason === 'no_player');
  ok('a matched player is found through the same normalisation the odds use',
     !!R.buildPlayerOdds(OVERLAY, CTX, priced.name.toUpperCase() + ' Jr.', priced.position).player
     || R._oddsNorm(priced.name + ' Jr.') !== R._oddsNorm(priced.name));
  ok('no overlay means no answer, never a made-up one',
     R.buildPlayerOdds(null, CTX, priced.name, priced.position).ok === false);
  ok('a null team context does not throw',
     R.buildPlayerOdds(OVERLAY, null, priced.name, priced.position).ok === true);
}

// ── 5. the digest is a count, and the count is right ───────────────────────
console.log('\nthe day\'s digest');
{
  const g = R.buildVegasDigest(board);
  const draftable = board.rows.filter(r => r.draftable);
  const moved = draftable.filter(R._colMeaningful);
  ok('it counts the players a book actually priced',
     g.priced === board.rows.filter(r => r.priced).length);
  ok('it counts the draftable disagreements', g.moved === moved.length, `${g.moved}/${moved.length}`);
  ok('up and down sum to the disagreements', g.up + g.down <= g.moved && g.up + g.down > 0);
  ok('the dollars are the sum of the gaps',
     g.dollars === moved.reduce((a, r) => a + Math.abs(r.priceDelta), 0));
  ok('per-position counts sum to the whole',
     R.COLUMN_POSITIONS.reduce((a, p) => a + g.byPos[p].moved, 0) === g.moved);
  ok('the biggest raise really is the biggest',
     !g.topUp || moved.every(r => r.priceDelta <= g.topUp.priceDelta));
  ok('the biggest fade really is the biggest',
     !g.topDown || moved.every(r => r.priceDelta >= g.topDown.priceDelta));
  ok('the raise is a raise and the fade is a fade',
     (!g.topUp || g.topUp.priceDelta > 0) && (!g.topDown || g.topDown.priceDelta < 0));
  ok('the team clause states both ranks or neither',
     !g.teamUp || (g.teamUp.rankMarket > 0 && g.teamUp.rankConsensus > 0));
  ok('the team the market likes most is ranked ahead of the consensus',
     !g.teamUp || g.teamUp.rankMarket < g.teamUp.rankConsensus);
  ok('and the one it likes least, behind it',
     !g.teamDown || g.teamDown.rankMarket > g.teamDown.rankConsensus);
  // A dateline that reshuffles between two reads of the same overlay reads as
  // noise. Same overlay in, same digest out.
  ok('two builds of one overlay produce the same digest',
     JSON.stringify(g) === JSON.stringify(R.buildVegasDigest(R.buildVegasBoard(OVERLAY, CTX))));
}

// ── 6. the clients only print fields the worker actually ships ─────────────
console.log('\nwhat the pages print');
{
  const g = R.buildVegasDigest(board);
  const one = R.buildPlayerOdds(OVERLAY, CTX, board.rows.find(r => r.priced).name,
                                board.rows.find(r => r.priced).position).player;
  const req = (card.match(/var PC_ODDS_REQUIRED = \[([\s\S]*?)\];/) || [])[1] || '';
  const fields = [...req.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);
  ok('the card names the fields it insists on', fields.length >= 5);
  ok('and the worker ships every one of them',
     fields.every(f => one[f] !== undefined), fields.filter(f => one[f] === undefined).join(','));
  // Everything front.html reads off the digest, taken from the source rather
  // than from a list this test would have to remember to update.
  const dayFn = front.slice(front.indexOf('function renderDay()'), front.indexOf('function renderCase()'));
  ok('the dateline renderer is in front.html', dayFn.length > 400);
  const read = new Set([...dayFn.matchAll(/\bg\.([a-zA-Z]+)/g)].map(m => m[1]));
  ok('every digest field the dateline prints exists',
     [...read].every(k => g[k] !== undefined), [...read].filter(k => g[k] === undefined).join(','));
  const briefRead = new Set([...dayFn.matchAll(/\bb\.([a-zA-Z]+)/g)].map(m => m[1]));
  ok('every field it prints about the biggest mover exists',
     !g.topUp || [...briefRead].every(k => g.topUp[k] !== undefined),
     g.topUp ? [...briefRead].filter(k => g.topUp[k] === undefined).join(',') : '');
  ok('the dateline is hidden when there is no digest to count',
     /if \(!g \|\| !isFinite\(g\.moved\)[\s\S]*?host\.hidden = true; return;/.test(dayFn));
  ok('the card holds no valuation of its own',
     !/function\s+(score|value|price)Player/.test(card));
}

// ── 6b. the card's own renderer, driven on real payloads ───────────────────
// The copy has four true lead sentences and a fifth for kickers, and every one
// of them is a string built out of fields that may or may not be there. Lifting
// the real block out of player.html and running it against real payloads is the
// only way to find out that one of those branches prints "undefined" — short of
// a browser, which this repo cannot assume.
console.log('\nthe card renders every branch');
{
  const blockStart = card.indexOf('  // ── the odds ──');
  const blockEnd = card.indexOf('  // ── paint ──');
  const oddsBlock = card.slice(blockStart, blockEnd);
  ok('the odds block is still a block in player.html', blockStart > 0 && blockEnd > blockStart);

  // The smallest DOM that renderOdds actually touches. Anything it reaches for
  // that is not here throws, which is the point.
  const node = () => {
    const n = { children: [], hidden: true, className: '', _html: '', _text: '' };
    Object.defineProperty(n, 'innerHTML', { get: () => n._html, set: v => { n._html = v; if (v === '') n.children = []; } });
    Object.defineProperty(n, 'textContent', { get: () => n._text, set: v => { n._text = v; } });
    n.appendChild = c => { n.children.push(c); return c; };
    return n;
  };
  const run = async (payload, league) => {
    const els = { pcOdds: node(), pcOddsSec: node(), pcOddsHead: node() };
    const doc = { createElement: node, getElementById: id => els[id] || node() };
    const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const win = { ITLeague: league || null };
    const fetches = [];
    const stub = async (u) => { fetches.push(u); return { ok: true, json: async () => payload }; };
    // CLUBS lives in the same IIFE as the odds block and the team clause reads
    // it, so it is lifted from player.html too rather than stubbed — a stub
    // would hide a rename.
    const clubsSeg = card.slice(card.indexOf('var CLUBS = {'), card.indexOf('};', card.indexOf('var CLUBS = {')) + 2);
    const mod = new Function('doc', 'esc', 'window', 'fetch',
      `${clubsSeg}\n${oddsBlock}\n return { renderOdds };`)(doc, esc, win, stub);
    await mod.renderOdds({ n: payload.player ? payload.player.name : 'Some Kicker',
                           p: payload.player ? payload.player.position : 'K' });
    await new Promise(r => setImmediate(r));
    const text = els.pcOdds.children.map(c => c._html || c._text).join(' ');
    return { text, shown: els.pcOddsSec.hidden === false, head: els.pcOddsHead._text, url: fetches[0] };
  };
  const clean = t => !/undefined|NaN|\[object/.test(t);

  const pick = (fn) => {
    const r = board.rows.find(fn);
    if (!r) return null;
    const one = R.buildPlayerOdds(OVERLAY, CTX, r.name, r.position);
    return { ...one, contract: R.PODDS_CONTRACT, basis: 'gamelines', asOf: Date.UTC(2026, 7, 23, 11) };
  };

  const priced = pick(r => r.priced && r.rankDelta !== 0 && r.draftable);
  const quiet = pick(r => !r.priced && r.rankDelta !== 0);
  const flat = pick(r => r.rankDelta === 0);
  const kicker = { ok: true, player: null, reason: 'unpriced_position', contract: R.PODDS_CONTRACT,
                   digest: R.buildVegasDigest(board), basis: 'gamelines', asOf: Date.UTC(2026, 7, 23, 11) };

  for (const [label, payload] of [['a priced mover', priced], ['a player nobody priced', quiet],
                                  ['a player both boards agree on', flat]]) {
    if (!payload) { ok(`${label} exists to render`, false); continue; }
    const out = await run(payload);
    ok(`${label} renders`, out.shown, out.text.slice(0, 160));
    ok(`${label} prints no holes`, clean(out.text), out.text.slice(0, 200));
    ok(`${label} names both boards`, out.text.includes('Consensus rankings') && out.text.includes('odds priced in'));
    ok(`${label} dates the lines`, /Lines of 23 August 2026/.test(out.text));
    ok(`${label} names the man in the heading`, out.head.includes(payload.player.name));
    // The raw market rank is the signal under the move, and the card must quote
    // it as a signal — never as the price, which is the odds-adjusted board.
    if (payload.player.priced || payload.player.rankDelta !== 0) {
      ok(`${label} quotes the market's own rank`,
         out.text.includes(payload.player.position + payload.player.rankMarket), out.text.slice(0, 200));
    }
  }
  {
    // The money-line clause: both ranks, always, and a club spelled out.
    const withTeam = JSON.parse(JSON.stringify(priced));
    withTeam.player.team = 'KC';
    withTeam.player.teamImplied = 27.1; withTeam.player.teamRank = 2; withTeam.player.teamRankConsensus = 9;
    const out = await run(withTeam);
    ok('the money-line clause names the club in full', /Kansas City Chiefs/.test(out.text), out.text.slice(0, 200));
    ok('and states both ranks, never one alone',
       /market ranks that offense #2/.test(out.text) && /#9 the consensus/.test(out.text), out.text.slice(0, 300));
    ok('with the clause in, the card still prints no holes', clean(out.text));
  }
  {
    const out = await run(kicker);
    ok('a kicker is told why, rather than shown a blank section', out.shown && /season-long market/.test(out.text));
    ok('and that answer prints no holes', clean(out.text), out.text.slice(0, 200));
  }
  {
    const out = await run({ ...priced, contract: R.PODDS_CONTRACT + 1 });
    ok('a payload of another contract renders nothing at all', out.shown === false);
  }
  {
    const out = await run({ ok: true, player: null, reason: 'off_board', contract: R.PODDS_CONTRACT,
                            digest: R.buildVegasDigest(board) });
    ok('a player the board cannot name is left silent', out.shown === false);
  }
  {
    const out = await run({ ok: false, error: 'no_overlay', player: null, contract: R.PODDS_CONTRACT });
    ok('no overlay leaves the section hidden', out.shown === false);
  }
  {
    // A reader with a $300, 10-team league is quoted the same going rate in
    // their own money — the library's conversion, not a second one.
    const league = { config: { teams: 10, budget: 300 }, deskPrice: v => Math.max(1, Math.round(v * (10 * 300) / (12 * 200))) };
    const out = await run(priced, league);
    ok('a saved league re-states the dollars in the reader\'s money', /10-team, \$300/.test(out.text));
    ok('and still prints no holes', clean(out.text), out.text.slice(0, 200));
  }
  {
    const out = await run(priced);
    ok('the card asks the endpoint for one player by name and position',
       /\/api\/player-odds\?v=\d+&name=[^&]+&pos=[A-Z]+/.test(out.url || ''), out.url || '');
  }
}

// ── 6c. the front page's dateline, driven on a real digest ─────────────────
// Same reasoning as the card: the dateline is a sentence assembled out of
// counts, and the failure mode is a count that isn't there.
function renderDateline(digest, asOf, items) {
  const start = front.indexOf("  // ── the day's dateline");
  const end = front.indexOf('  // The column\'s argument needs a case to make.');
  const blk = front.slice(start, end);
  const el = { hidden: true, innerHTML: '' };
  const document = { getElementById: id => (id === 'vsDay' ? el : null) };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];
  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // The real club map, lifted from front.html rather than stubbed, so the
  // dateline is exercised with the names a reader actually sees.
  const TEAM_ART = {};
  const artSeg = front.slice(front.indexOf('var TEAM_ART = {'), front.indexOf('};', front.indexOf('var TEAM_ART = {')));
  for (const m of artSeg.matchAll(/(\w+):\['([^']+)'/g)) TEAM_ART[m[1]] = [m[2]];
  const vsNum = n => (n > 0 ? '+' : '') + n;
  const vsMeta = { digest, asOf };
  const vsItems = items === undefined ? [{}] : items;
  new Function('document', 'MONTHS', 'esc', 'TEAM_ART', 'vsNum', 'vsMeta', 'vsItems',
    `${blk}\n renderDay();`)(document, MONTHS, esc, TEAM_ART, vsNum, vsMeta, vsItems);
  return el;
}
function TEAM_ART_NAME(t) {
  const seg = front.slice(front.indexOf('var TEAM_ART = {'), front.indexOf('};', front.indexOf('var TEAM_ART = {')));
  const m = seg.match(new RegExp('\\b' + t + ":\\['([^']+)'"));
  return m ? m[1] : t;
}
console.log('\nthe front page dateline');
{
  const g = R.buildVegasDigest(board);
  const el = renderDateline(g, Date.UTC(2026, 7, 23, 11));
  ok('it renders', el.hidden === false);
  ok('it prints no holes', !/undefined|NaN|\[object/.test(el.innerHTML), el.innerHTML.slice(0, 240));
  ok('it dates the lines', /Lines of 23 August 2026/.test(el.innerHTML));
  ok('it counts the disagreements', el.innerHTML.includes('<b>' + g.moved + '</b>'));
  ok('it says the numbers are recounted daily', /every morning/.test(el.innerHTML));
  if (g.topUp) ok('it names the biggest raise', el.innerHTML.includes(g.topUp.name));
  if (g.topDown) ok('it names the biggest fade', el.innerHTML.includes(g.topDown.name));
  ok('it prices a mover in dollars, not in the word "dollars"',
     !g.topUp || /\(\+\$\d+\)/.test(el.innerHTML), el.innerHTML.slice(0, 200));
  ok('it spells a club out rather than printing its abbreviation',
     !g.teamUp || el.innerHTML.includes(TEAM_ART_NAME(g.teamUp.team)), g.teamUp ? g.teamUp.team : '');

  // A board the market agrees with everywhere is a real state, and the dateline
  // has to say so rather than printing a row of zeroes.
  const calm = renderDateline({ ...g, moved: 0, up: 0, down: 0, dollars: 0, topUp: null, topDown: null,
                                byPos: { QB: { moved: 0, up: 0, down: 0, dollars: 0 }, RB: { moved: 0, up: 0, down: 0, dollars: 0 },
                                         WR: { moved: 0, up: 0, down: 0, dollars: 0 }, TE: { moved: 0, up: 0, down: 0, dollars: 0 } } },
                              Date.UTC(2026, 7, 23, 11));
  ok('a day with no disagreement is stated, not faked', calm.hidden === false && /did not move/.test(calm.innerHTML));
  ok('and it prints no holes either', !/undefined|NaN/.test(calm.innerHTML), calm.innerHTML.slice(0, 200));

  const none = renderDateline(null, Date.UTC(2026, 7, 23, 11));
  ok('no digest means no dateline', none.hidden === true);

  // The section itself leaves the page when the odds feed has no case to make,
  // and the dateline is inside it — a paragraph left standing over nothing is
  // the orphan that removal was for.
  const orphan = renderDateline(g, Date.UTC(2026, 7, 23, 11), []);
  ok('no case on the board means no dateline either', orphan.hidden === true);
}

// ── 7. end to end on the live nflverse lines ───────────────────────────────
console.log('\nlive nflverse pull (network)');
{
  const L = harness(realPool, () => 'ENC', 'k', globalThis.fetch);
  try {
    const ppg = await L.fetchTeamEnvNflverse({});
    const built = L.buildTeamEnvOverlay(ppg);
    const rank = {};
    Object.entries(ppg).sort((a, b) => b[1] - a[1]).forEach(([t], i) => { rank[t] = i + 1; });
    const ctx = { ppg, rank };
    const live = L.buildVegasBoard(built.overlay, ctx);
    ok('the board builds off real lines', live.ok === true && live.rows.length > 200);
    const dg = L.buildVegasDigest(live);
    ok('the day\'s digest counts a real disagreement', dg.moved > 0, JSON.stringify(dg).slice(0, 200));
    ok('a real dateline can name both a raise and a fade', !!dg.topUp && !!dg.topDown);
    ok('and a club at each end of the argument', !!dg.teamUp && !!dg.teamDown);
    // The whole point of the card: EVERY skill player has an answer, not twelve.
    let answered = 0, missing = [];
    for (const p of realPool) {
      if (!L.COLUMN_POSITIONS.includes(p.position)) continue;
      const a = L.buildPlayerOdds(built.overlay, ctx, p.name, p.position);
      if (a.player) answered++; else missing.push(p.name + ' (' + a.reason + ')');
    }
    const want = realPool.filter(p => L.COLUMN_POSITIONS.includes(p.position)).length;
    ok('every skill player on the real board has a card answer', answered === want,
       `${answered}/${want}${missing.length ? ' — ' + missing.slice(0, 4).join(', ') : ''}`);
    console.log(`\n  the board today: ${dg.priced} players priced, ${dg.moved} draftable disagreements ` +
                `(${dg.up} up, ${dg.down} down), $${dg.dollars} apart`);
    if (dg.topUp) console.log(`    biggest raise: ${dg.topUp.name} ${dg.topUp.position}${dg.topUp.rankConsensus} -> ${dg.topUp.position}${dg.topUp.rankIronTuna} (+$${dg.topUp.priceDelta})`);
    if (dg.topDown) console.log(`    biggest fade:  ${dg.topDown.name} ${dg.topDown.position}${dg.topDown.rankConsensus} -> ${dg.topDown.position}${dg.topDown.rankIronTuna} ($${dg.topDown.priceDelta})`);
    const live_dateline = renderDateline(dg, Date.now());
    ok('the real dateline prints no holes', !/undefined|NaN/.test(live_dateline.innerHTML), live_dateline.innerHTML.slice(0, 240));
    console.log('\n  today\'s dateline, as a reader sees it:\n    ' +
      live_dateline.innerHTML.replace(/<\/span>/g, '</span> ').replace(/<[^>]+>/g, '').replace(/&mdash;/g, '—').replace(/&rsquo;/g, "'")
        .replace(/\s+/g, ' ').trim().replace(/(.{92}\s)/g, '$1\n    '));
  } catch (err) {
    // A blocked or flaky network must not read as a code failure.
    console.log(`  SKIP live pull — ${err.message}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
