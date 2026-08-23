#!/usr/bin/env node
// Desk report over the same board /api/vegas-column and /api/player-odds ship.
//   node tools/board-report.mjs                    # fetches nflverse games.csv
//   node tools/board-report.mjs --games games.csv   # from a local copy
//   node tools/board-report.mjs --json             # machine-readable
//
// Two questions a desk run keeps asking, answered from the site's own numbers
// rather than re-derived by hand every time:
//
//   1. RANKINGS vs ODDS — where the committed projection set and the betting
//      market disagree hardest about a player. This is buildVegasBoard from
//      _worker.js, lifted out of the real source the way tools/test-worker-column.mjs
//      does it, so the report cannot drift from what the site serves.
//
//   2. WEEK-TO-WEEK SHAPE — how lumpy each player's projected season is. The
//      pool holds season totals and nothing else, so this is a MODEL, not a
//      measurement, and the model is written out in full below. Read it before
//      quoting a number from it.
//
// Nothing here writes anything. It prints.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const asJson = argv.includes('--json');

// ── lift the real worker code ──────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const START = '// Vegas-weighted projections';
const s = src.indexOf(START), e = src.indexOf('export default {', s);
if (s < 0 || e < 0) { console.error('FAIL: could not locate the Vegas section in _worker.js'); process.exit(1); }

const PROJECTIONS = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const seg = src.slice(st, src.indexOf('\n];', st));
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();
if (PROJECTIONS.length < 300) { console.error(`FAIL: parsed only ${PROJECTIONS.length} projections`); process.exit(1); }

const W = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null;
  ${src.slice(s, e)}
  return { buildVegasBoard, buildVegasDigest, fetchTeamEnvNflverse, buildTeamEnvOverlay,
           _colScore, _colPrice, _oddsNorm, teamKey, COLUMN_CURVE, COLUMN_POSITIONS };
`)(PROJECTIONS, () => 'ENC', 'k', globalThis.fetch);

// ── the odds side ──────────────────────────────────────────────────────────
// Same provider the site runs on: nflverse game lines (spread + total), which
// imply each team's expected points. These are GAME lines, not player props —
// the market never prices a reception here, so every stat the overlay moves is
// a scoring-environment inference, and the report says so wherever it prints.
const gamesPath = arg('--games');
const games = gamesPath
  ? fs.readFileSync(path.resolve(gamesPath), 'utf8')
  : await (await fetch('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv')).text();

const ppg = await W.fetchTeamEnvNflverse({}, async () => ({ ok: true, text: async () => games }));
const rank = {};
Object.entries(ppg).sort((a, b) => b[1] - a[1]).forEach(([t], i) => { rank[t] = i + 1; });
const { overlay, matched, teams } = W.buildTeamEnvOverlay(ppg);
const board = W.buildVegasBoard(overlay, { ppg, rank });
if (!board.ok) { console.error('FAIL: board did not build — ' + board.error); process.exit(1); }

// ── 2. the week-to-week model ──────────────────────────────────────────────
// THE POOL HAS NO GAME LOGS. It carries season totals, so week-to-week spread
// cannot be measured here — it can only be derived from the SHAPE of a season.
// The derivation below has one idea in it: points arrive in events, and the
// size of the event decides how lumpy a week is. A catch is a small event that
// happens five times a Sunday; a touchdown is a six-point event that happens
// less than once. Two players with identical season totals therefore have very
// different Sundays if one of them gets there on receptions and the other on
// scores.
//
// Every event count is modelled Poisson over 17 games, which is what makes the
// arithmetic below fall out of the projection set alone with no fitted
// constants: for a Poisson count with mean m, points = k * count carries
// variance k^2 * m. Summing the independent pieces gives a per-game standard
// deviation, and dividing by per-game points gives a unitless spread that is
// comparable across positions.
//
// Two assumed rates, and they are assumptions rather than projections: 4.3
// yards per carry and 11.5 yards per completion, used only to turn projected
// yardage back into the count of events that produced it. Both are league-level
// round numbers. Moving them moves everyone in the same direction, so the
// ORDER — which is all this report is used for — is close to insensitive to
// them.
//
// Three things this model does not know, all of which widen a real Sunday:
// injuries and missed games, game script, and the fact that a touchdown is not
// independent of the catch that scored it. It is a floor on volatility, not a
// forecast of it.
const GAMES = 17, YPC = 4.3, YPCOMP = 11.5;
const shape = p => {
  const st = p.projectedStats || {};
  const pts = W._colScore(st, p.position);
  if (!(pts > 0)) return null;
  const g = n => (n || 0) / GAMES;
  let v = 0;
  const add = (perEvent, meanCount) => { if (meanCount > 0) v += perEvent * perEvent * meanCount; };

  // Receiving: one event, worth the reception point plus its yards.
  const rec = st.rec || 0, recYd = st.recYd || 0;
  if (rec > 0) add(1 + (recYd / rec) / 10, g(rec));
  else if (recYd > 0) add(1.5, g(recYd / 15));          // yards with no catch count
  add(6, g(st.recTD));
  // Rushing: carries inferred from yardage at a league-level rate.
  add(YPC / 10, g((st.rushYd || 0) / YPC));
  add(6, g(st.rushTD));
  // Passing: completions inferred the same way.
  add(YPCOMP / 25, g((st.passYd || 0) / YPCOMP));
  add(4, g(st.passTD));
  add(2, g(st.passInt));
  add(2, g(st.fumLost));

  const perGame = pts / GAMES, sd = Math.sqrt(v);
  // How much of the season is touchdown points — the single clearest reason one
  // of these players is lumpier than another, and the one a reader can check
  // against the projection line without taking the model's word for anything.
  const tdPts = (st.recTD || 0) * 6 + (st.rushTD || 0) * 6 + (st.passTD || 0) * 4;
  return { perGame, sd, spread: sd / perGame, tdShare: tdPts / pts };
};

const rows = board.rows.map(r => {
  const p = PROJECTIONS.find(q => q.name === r.name && q.position === r.position);
  return { ...r, ...(shape(p) || {}), oddsRankDelta: r.rankConsensus - r.rankMarket };
});

// Raw spread ranks positions, not players: a tight end plays fewer events than
// a workhorse back, so the lumpiest names on any raw list are tight ends and
// the steadiest are backs, whoever they happen to be that season. True, and
// most of it is known before a single name is read. The z-score below is the
// part that is NOT known in advance — how far a player sits from the other men
// at his own position, which is the comparison a manager actually faces when
// the pick is between two tight ends at the same price.
for (const pos of W.COLUMN_POSITIONS) {
  const at = rows.filter(r => r.position === pos && r.draftable && r.spread != null);
  if (at.length < 4) continue;
  const mean = at.reduce((a, r) => a + r.spread, 0) / at.length;
  const sd = Math.sqrt(at.reduce((a, r) => a + (r.spread - mean) ** 2, 0) / at.length);
  for (const r of at) r.spreadZ = sd > 0 ? (r.spread - mean) / sd : 0;
}

// ── output ─────────────────────────────────────────────────────────────────
if (asJson) { console.log(JSON.stringify({ asOf: new Date().toISOString(), teams, matched, ppg, rank, rows }, null, 1)); process.exit(0); }

const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
const pad = (v, n) => String(v).padEnd(n);
const lpad = (v, n) => String(v).padStart(n);

console.log(`\nteams priced ${teams}   players the overlay moved ${matched}   pool ${PROJECTIONS.length}`);

// A gap only matters where a reader has a decision to make. Everything below
// the curve is a $1 name whose "eight-slot move" is two projection points
// shuffling a queue of backups, so both halves of the report are cut to the
// players a room actually bids on.
const BID = r => r.draftable && (r.priceConsensus >= 5 || r.priceIronTuna >= 5 || r.rankConsensus <= 24);

console.log('\n══ RANKINGS vs ODDS ══  positional rank on the committed sheet minus rank on the odds board');
for (const dir of ['up', 'down']) {
  const list = rows.filter(BID)
    .sort((a, b) => dir === 'up' ? b.oddsRankDelta - a.oddsRankDelta : a.oddsRankDelta - b.oddsRankDelta)
    .slice(0, 8);
  console.log(`\n  ${dir === 'up' ? 'ODDS RATE HIM HIGHER' : 'ODDS RATE HIM LOWER'}`);
  console.log('   ' + pad('player', 24) + pad('pos', 4) + pad('tm', 4) + lpad('rank', 6) + lpad('odds', 6) +
              lpad('move', 6) + lpad('ptsC', 7) + lpad('ptsM', 7) + lpad('$C', 5) + lpad('$IT', 5) + '  team implied');
  for (const r of list) {
    console.log('   ' + pad(r.name, 24) + pad(r.position, 4) + pad(r.team, 4) +
      lpad(r.rankConsensus, 6) + lpad(r.rankMarket, 6) + lpad((r.oddsRankDelta > 0 ? '+' : '') + r.oddsRankDelta, 6) +
      lpad(f1(r.ptsConsensus), 7) + lpad(f1(r.ptsMarket), 7) + lpad('$' + r.priceConsensus, 5) + lpad('$' + r.priceIronTuna, 5) +
      '  ' + f1(r.teamImplied) + ' (#' + r.teamRank + ' vs #' + r.teamRankConsensus + ' on the sheet)');
  }
}

console.log('\n══ THE SAME DISAGREEMENT IN DOLLARS ══  the site ships the odds blended in at 3:1, so this is the move a reader sees on their own sheet');
{
  const list = rows.filter(BID).sort((a, b) => Math.abs(b.priceDelta) - Math.abs(a.priceDelta)).slice(0, 14);
  console.log('   ' + pad('player', 24) + pad('pos', 4) + pad('tm', 4) + lpad('$sheet', 8) + lpad('$IT', 6) +
              lpad('move', 6) + lpad('rank', 6) + lpad('odds', 6) + '  team implied');
  for (const r of list) {
    console.log('   ' + pad(r.name, 24) + pad(r.position, 4) + pad(r.team, 4) +
      lpad('$' + r.priceConsensus, 8) + lpad('$' + r.priceIronTuna, 6) +
      lpad((r.priceDelta > 0 ? '+' : '') + r.priceDelta, 6) + lpad(r.rankConsensus, 6) + lpad(r.rankMarket, 6) +
      '  ' + f1(r.teamImplied) + ' (#' + r.teamRank + ' vs #' + r.teamRankConsensus + ' on the sheet)');
  }
}

console.log('\n══ WEEK-TO-WEEK SHAPE ══  modelled per-game spread; lower is steadier');
const draftable = rows.filter(r => BID(r) && r.spread != null);
for (const scope of [['FLEX (RB/WR/TE)', r => r.position !== 'QB'], ['QB', r => r.position === 'QB']]) {
  const pool = draftable.filter(scope[1]);
  for (const dir of ['steady', 'lumpy']) {
    const list = [...pool].sort((a, b) => dir === 'steady' ? a.spread - b.spread : b.spread - a.spread).slice(0, 8);
    console.log(`\n  ${scope[0]} — ${dir === 'steady' ? 'STEADIEST' : 'LUMPIEST'}`);
    console.log('   ' + pad('player', 24) + pad('pos', 4) + pad('tm', 4) + lpad('pts/gm', 8) + lpad('sd', 6) +
                lpad('spread', 8) + lpad('TD%', 6) + lpad('rank', 6) + lpad('$C', 5));
    for (const r of list) {
      console.log('   ' + pad(r.name, 24) + pad(r.position, 4) + pad(r.team, 4) +
        lpad(f1(r.perGame), 8) + lpad(f1(r.sd), 6) + lpad(r.spread.toFixed(3), 8) +
        lpad(Math.round(r.tdShare * 100) + '%', 6) + lpad(r.rankConsensus, 6) + lpad('$' + r.priceConsensus, 5));
    }
  }
}

console.log('\n══ AGAINST HIS OWN POSITION ══  standard deviations from the mean spread at his position; negative is steadier than his peers');
for (const dir of ['steady', 'lumpy']) {
  const list = draftable.filter(r => r.spreadZ != null)
    .sort((a, b) => dir === 'steady' ? a.spreadZ - b.spreadZ : b.spreadZ - a.spreadZ).slice(0, 10);
  console.log(`\n  ${dir === 'steady' ? 'STEADIER THAN HIS POSITION' : 'LUMPIER THAN HIS POSITION'}`);
  console.log('   ' + pad('player', 24) + pad('pos', 4) + pad('tm', 4) + lpad('z', 7) + lpad('spread', 8) +
              lpad('pts/gm', 8) + lpad('TD%', 6) + lpad('rank', 6) + lpad('$C', 5));
  for (const r of list) {
    console.log('   ' + pad(r.name, 24) + pad(r.position, 4) + pad(r.team, 4) +
      lpad((r.spreadZ > 0 ? '+' : '') + r.spreadZ.toFixed(2), 7) + lpad(r.spread.toFixed(3), 8) +
      lpad(f1(r.perGame), 8) + lpad(Math.round(r.tdShare * 100) + '%', 6) +
      lpad(r.rankConsensus, 6) + lpad('$' + r.priceConsensus, 5));
  }
}
console.log('');
