#!/usr/bin/env node
// The ESPN game-line adapter, checked against a real scoreboard payload.
//   node tools/test-espn-lines.mjs
//
// WHY THIS EXISTS: the scoreboard is the only feed that hands the site a
// BOOK'S OWN opening line, and the one thing that would quietly ruin it is the
// sign. ESPN writes a spread as the home side's handicap (Seattle -3); the
// spine writes the same game as a home margin (+3). Get that backwards and
// every implied team total on the site inverts while still looking plausible,
// which no page could catch. So the first test here is not a unit test at all:
// it parses a stored scoreboard and demands that all sixteen games agree with
// nflverse's own numbers for the same week, sign and value. Two independent
// feeds agreeing is the only real proof the convention is right.
//
// The functions are lifted out of _worker.js rather than copied, the way
// tools/board-report.mjs does it, so this cannot drift from what ships.
//
// FIXTURE: tools/fixtures/espn-scoreboard-2026-w1.json, pulled 2026-09-09,
// alongside the nflverse week-1 lines it is checked against. Refreshing the
// fixture means refreshing both.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

// Lift the adapter out of the real source. Each slice is named by the comment
// or signature that opens it, so a rename fails loudly here instead of
// silently testing nothing.
function slice(from, to) {
  const s = src.indexOf(from), e = src.indexOf(to, s);
  if (s < 0 || e < 0) { console.error('FAIL: could not locate ' + JSON.stringify(from) + ' in _worker.js'); process.exit(1); }
  return src.slice(s, e);
}
const lifted = [
  slice('const ESPN_SEASONTYPE =', '// games.csv writes a fixture'),
  slice('function _espnLine(v) {', 'function _espnGame(ev) {'),
  slice('function _espnGame(ev) {', '// The preseason, which the spine does not carry'),
  slice("// One source's own quote for one fixture", '// ── the clock'),
  slice('function _gameLineMove(g, gm) {', 'async function snapshotStatus')
].join('\n');

// The three helpers the lifted code closes over, and nothing else.
const stubs = `
const TEAM_ALIAS = { LAR:'LA', JAC:'JAX', WSH:'WAS', LVR:'LV', OAK:'LV', SD:'LAC', STL:'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TEAM_ALIAS[u] || u || null; };
const _oddsRound = v => Math.round(v * 10) / 10;   // the worker's own, one decimal
const SEASON_ORDER = { PRE:0, REG:1, WC:2, DIV:3, CON:4, SB:5 };
`;
const api = 'export { _espnLine, _espnOdds, _espnGame, mergeSchedule, lineConsensus, _gameLineMove };';
const M = await import('data:text/javascript,' + encodeURIComponent(stubs + lifted + api));

const teamKey = t => { const u = String(t || '').toUpperCase(); return ({ LAR:'LA', JAC:'JAX', WSH:'WAS', LVR:'LV', OAK:'LV', SD:'LAC', STL:'LA' })[u] || u || null; };

let failures = 0;
const ok = (cond, what) => { if (cond) return; console.log('  FAIL  ' + what); failures++; };
const head = t => console.log('\n' + t);

const board = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/espn-scoreboard-2026-w1.json'), 'utf8'));
const games = board.events.map(M._espnGame).filter(Boolean);

// 1. THE SIGN, against a second feed. nflverse's week-1 lines for the same
// season, as committed in the fixture below the scoreboard.
head('1. sign and value vs the nflverse spine');
const SPINE_W1 = {
  'NE@SEA': [3, 44.5],   'SF@LA': [3.5, 48.5],  'TB@CIN': [3.5, 50.5], 'NO@DET': [7, 49.5],
  'NYJ@TEN': [1.5, 38.5], 'BAL@IND': [-3.5, 47.5], 'ATL@PIT': [3.5, 42.5], 'CHI@CAR': [-3, 46.5],
  'CLE@JAX': [8.5, 40.5], 'BUF@HOU': [-1.5, 44.5], 'MIA@LV': [3, 40.5],  'GB@MIN': [1.5, 46.5],
  'WAS@PHI': [5.5, 44.5], 'ARI@LAC': [9.5, 47.5], 'DAL@NYG': [-3, 48.5], 'DEN@KC': [3, 43.5]
};
let checked = 0;
for (const g of games) {
  const want = SPINE_W1[g.away + '@' + g.home];
  if (!want) { console.log('  FAIL  no spine row for ' + g.away + '@' + g.home); failures++; continue; }
  ok(g.spread === want[0], `${g.away}@${g.home} spread ${g.spread}, spine says ${want[0]}`);
  ok(g.total === want[1], `${g.away}@${g.home} total ${g.total}, spine says ${want[1]}`);
  checked++;
}
console.log(`  ${checked} games checked against the spine`);

// 2. The book's own open/current pair, which is the whole point of the feed.
head("2. the book's opening line");
ok(games.length === 16, 'sixteen games parsed, got ' + games.length);
ok(games.every(g => g.book && g.book.name), 'every game names its book');
const moves = games.map(g => M._gameLineMove(g, null));
ok(moves.every(m => m.source === 'book'), 'every move measured off the book, not the store');
const real = moves.filter(m => m.spread !== 0 || m.total !== 0);
console.log(`  ${real.length} of ${moves.length} games moved since the book opened`);
for (const [i, g] of games.entries()) {
  const m = moves[i];
  if (!m.spread && !m.total) continue;
  const s = m.spread ? `spread ${m.spreadOpen} to ${m.spreadCurrent}` : '';
  const t = m.total ? `total ${m.totalOpen} to ${m.totalCurrent}` : '';
  console.log(`    ${(g.away + '@' + g.home).padEnd(9)} ${s}${s && t ? ', ' : ''}${t}`);
}

// 3. Open and current must come from ONE source. A book's open measured
// against the store's current is a move nobody quoted.
head('3. open and current never mix sources');
const store = { spread: { open: 999, current: 1000, movement: 1 }, total: { open: 999, current: 1000, movement: 1 } };
for (const g of games) {
  const m = M._gameLineMove(g, store);
  ok(m.spreadOpen === g.book.spreadOpen && m.spreadCurrent === g.book.spread, 'the book wins both ends for ' + g.away + '@' + g.home);
}
const fell = M._gameLineMove({ id: 'x', book: null }, { spread: { open: -3, current: -1, movement: 2 }, total: null });
ok(fell.source === 'snapshots' && fell.spread === 2 && fell.spreadOpen === -3 && fell.spreadCurrent === -1, 'falls back to the store whole');
const nothing = M._gameLineMove({ id: 'y' }, null);
ok(nothing.source === null && nothing.spread === null && nothing.spreadOpen === null, 'no data reads null, never zero');

// 4. Line parsing, including the two shapes that would pass silently.
head('4. line parsing');
ok(M._espnLine('o44.5') === 44.5 && M._espnLine('u44.5') === 44.5, 'the total prefix is dropped from both sides');
ok(M._espnLine('-3.5') === -3.5 && M._espnLine('+3') === 3, 'signed spreads parse');
ok(M._espnLine(null) === null && M._espnLine('EVEN') === null && M._espnLine('') === null, 'unparseable reads null, not NaN or zero');
const pk = M._espnOdds({ odds: [{ provider: { priority: 1, name: 'B' }, spread: 0, overUnder: 41,
  pointSpread: { home: { open: { line: '0' }, close: { line: '0' } } }, total: { over: { open: { line: 'o41' }, close: { line: 'o41' } } } }] });
ok(Object.is(pk.spread, 0), "a pick'em survives the sign flip as +0, not -0");
ok(M._espnOdds({ odds: [] }) === null && M._espnOdds({}) === null, 'a game with no odds reads null');
ok(M._espnOdds({ odds: [{ provider: { name: 'X' } }] }) === null, 'a book quoting neither market reads null');
const two = M._espnOdds({ odds: [
  { provider: { priority: 3, name: 'Late' }, spread: -7, overUnder: 40 },
  { provider: { priority: 1, name: 'Shown' }, spread: -3, overUnder: 44 }] });
ok(two.name === 'Shown' && two.spread === 3, "ESPN's own priority picks the book");

// 5. The merge. Each source RECORDS its quote; the spine's number stands until
//    lineConsensus averages them, and ESPN still fills a blank on its own.
head('5. merge precedence');
const spine = [
  { id: 'a', type: 'REG', week: 1, kickoff: Date.parse('2026-09-10T00:20Z'), home: 'SEA', away: 'NE', spread: 3, total: 44.5, src: 'nflverse' },
  { id: 'b', type: 'REG', week: 1, kickoff: Date.parse('2026-09-13T17:00Z'), home: 'CIN', away: 'TB', spread: null, total: null, src: 'nflverse' }
];
const live = games.filter(g => (g.away === 'NE' && g.home === 'SEA') || (g.away === 'TB' && g.home === 'CIN'));
const merged = M.mergeSchedule(spine, live);
const priced = merged.games.find(g => g.away === 'NE');
const blank = merged.games.find(g => g.away === 'TB');
ok(priced.spread === 3 && priced.total === 44.5, 'the spine keeps its own line');
ok(!priced.lineSrc, 'a spine line is not flagged as ESPN');
ok(priced.book && priced.book.spreadOpen === 3.5, "the book's pair rides along on a spine-priced game");
ok(blank.spread === 3.5 && blank.total === 50.5 && blank.lineSrc === 'espn', 'ESPN fills a blank and says so');
ok(priced.quotes && priced.quotes.nflverse.spread === 3 && priced.quotes.espn.spread === 3,
   'both sources are recorded side by side rather than one winning');
console.log(`  spine-priced ${priced.away}@${priced.home}: line ${priced.spread}/${priced.total}, book opened ${priced.book.spreadOpen}`);
console.log(`  gap-filled   ${blank.away}@${blank.home}: line ${blank.spread}/${blank.total} from ${blank.lineSrc}`);

// 6. The consensus. The two feeds here priced NE@SEA identically, which is the
//    case worth asserting on real numbers: agreeing sources must average to the
//    number they agree on and still name both. The arithmetic of a DISAGREEMENT
//    is then checked on quotes chosen so a mean, a median and any single winner
//    would all give different answers.
head('6. the consensus line');
const BEFORE = Date.parse('2026-09-09T00:00Z');
const con = M.lineConsensus(M.mergeSchedule(spine, live).games, BEFORE);
const cp = con.games.find(g => g.away === 'NE'), cb = con.games.find(g => g.away === 'TB');
ok(cp.spread === 3 && cp.total === 44.5, 'two agreeing sources average to the number they agree on',
   `${cp.spread}/${cp.total}`);
ok(cp.lineSrc === 'espn+nflverse' && cp.lineSources.join() === 'espn,nflverse',
   'and the payload names both', String(cp.lineSrc));
ok(cb.lineSrc === 'espn' && cb.spread === 3.5, 'a lone quote averages to itself and says so alone');
ok(con.averaged === 2 && con.blended === 1, 'the counts separate a blend from a lone quote',
   `${con.averaged}/${con.blended}`);

const dis = M.mergeSchedule([{ ...spine[0], spread: 2, total: 40 }], live).games.find(g => g.away === 'NE');
dis.quotes.sportsgameodds = { spread: 4, total: 47 };
M.lineConsensus([dis], BEFORE);
ok(dis.spread === 3 && dis.total === 43.8, 'three disagreeing sources are a mean, not a winner',
   `${dis.spread}/${dis.total}`);
ok(dis.lineSources.length === 3 && dis.lineSrc === 'espn+nflverse+sportsgameodds', 'and all three are named');
ok(dis.book && dis.book.spreadOpen === 3.5,
   'the book pair is untouched by the average: one source still stands behind the move');

const played = M.lineConsensus(M.mergeSchedule(spine, live).games, Date.parse('2026-09-20T00:00Z'));
const pp = played.games.find(g => g.away === 'NE');
ok(pp.spread === 3 && pp.total === 44.5 && played.averaged === 0,
   "a game already kicked off keeps the spine's closing line, unaveraged");
console.log(`  ${dis.away}@${dis.home}: ${Object.entries(dis.quotes).map(([k, q]) => k + ' ' + q.spread + '/' + q.total).join(' + ')} -> ${dis.spread}/${dis.total}`);

console.log(failures ? `\n${failures} FAILURE${failures === 1 ? '' : 'S'}` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
