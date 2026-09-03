#!/usr/bin/env node
// Rewrite the K and DEF rows of the PROJECTIONS block in _worker.js from the
// market's own team totals.
//
//   node tools/rebaseline-k-def.mjs            # pull, rebaseline, write
//   node tools/rebaseline-k-def.mjs --dry      # print the diff, write nothing
//   node tools/rebaseline-k-def.mjs --offline  # reuse the checked-in snapshot
//
// Three inputs, all from nflverse (CC BY 4.0), the release this repo already
// credits for game lines:
//
//   schedules/games.csv   the season's fixtures and whatever spreads and totals
//                         the books have posted -> tools/team-market.mjs turns
//                         them into implied points for and against per club
//   rosters/roster_<yr>   who is actually kicking. The pool had been carrying
//                         four practice-squad and departed kickers, and no
//                         kicker at all for two clubs.
//
// The arithmetic itself lives in tools/k-def-model.mjs next to the measurements
// that justify it. This file only fetches, joins, and splices.
//
// AFTERWARDS, in this order:
//   node tools/build-front.mjs          # player-search.js, for any new kicker
//   node tools/build-default-board.mjs  # the static fallback board
//   node tools/test-k-def.mjs           # guards what this wrote

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketTotals, nflverseTeam, csvSplit } from './team-market.mjs';
import { blendKicker, blendDefense, LEAGUE } from './k-def-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, '_worker.js');
const SNAPSHOT = path.join(ROOT, 'tools', 'team-market.json');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const OFFLINE = argv.includes('--offline');

const GAMES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const ROSTER_URL = y => `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${y}.csv`;

const die = m => { console.error('ABORT: ' + m); process.exit(1); };

// ── the committed pool ─────────────────────────────────────────────────────
const src = fs.readFileSync(WORKER, 'utf8');
const projStart = src.indexOf('const PROJECTIONS = [');
const projEnd = src.indexOf('\n];', projStart);
if (projStart < 0 || projEnd < 0) die('PROJECTIONS block not found in _worker.js');
const ROW = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
const rows = [];
for (const m of src.slice(projStart, projEnd).matchAll(ROW)) {
  const stats = {};
  for (const kv of m[4].split(',')) {
    const p = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
    if (p) stats[p[1]] = parseFloat(p[2]);
  }
  rows.push({ line: m[0], name: m[1].trim(), position: m[2], team: m[3], stats });
}
const committedK = rows.filter(r => r.position === 'K');
const committedD = rows.filter(r => r.position === 'DEF');
if (!committedD.length) die('no DEF rows found');

// ── market totals ──────────────────────────────────────────────────────────
let snap;
if (OFFLINE) {
  if (!fs.existsSync(SNAPSHOT)) die('no snapshot at tools/team-market.json — run without --offline once');
  snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  console.log(`offline: reusing the ${snap.season} snapshot taken ${snap.asOf}`);
} else {
  const res = await fetch(GAMES_URL);
  if (!res.ok) die('games.csv: http ' + res.status);
  const mt = marketTotals(await res.text());
  if (!mt.ok) die('market fit failed: ' + mt.error);
  snap = { season: mt.season, asOf: new Date().toISOString(), source: GAMES_URL,
           pricedGames: mt.priced, fixtures: mt.fixtures,
           hfa: +mt.hfa.toFixed(3), mu: +mt.mu.toFixed(3), rmse: +mt.rmse.toFixed(3),
           totals: Object.fromEntries(Object.entries(mt.totals)
             .map(([t, v]) => [t, { pf: +v.pf.toFixed(1), pa: +v.pa.toFixed(1), games: v.games }])) };
  console.log(`${snap.season}: ${snap.pricedGames} of ${snap.fixtures} games priced, ` +
              `fit rmse ${snap.rmse} pts/game, home field ${snap.hfa}`);
}
const totals = snap.totals;
const market = t => totals[nflverseTeam(t)] || null;

// ── who is actually kicking ────────────────────────────────────────────────
// One active kicker per club, or the file is not telling us something we can
// act on and the pool's own spelling stands.
let starters = null;
if (!OFFLINE) {
  const res = await fetch(ROSTER_URL(snap.season));
  if (!res.ok) {
    console.log(`warn: roster_${snap.season}.csv unavailable (http ${res.status}) — keeping the committed kicker names`);
  } else {
    const lines = (await res.text()).split('\n').filter(Boolean);
    const head = csvSplit(lines[0]);
    const ci = Object.fromEntries(head.map((k, i) => [k, i]));
    for (const k of ['team', 'position', 'status', 'full_name']) if (ci[k] == null) die('roster: missing column ' + k);
    const byTeam = {};
    for (const l of lines.slice(1)) {
      const f = csvSplit(l);
      if (f[ci.position] !== 'K' || f[ci.status] !== 'ACT') continue;
      (byTeam[f[ci.team]] = byTeam[f[ci.team]] || []).push(f[ci.full_name].trim());
    }
    const ambiguous = Object.entries(byTeam).filter(([, v]) => v.length !== 1);
    if (ambiguous.length) {
      console.log('warn: not exactly one active kicker for ' +
        ambiguous.map(([t, v]) => `${t} (${v.join('/')})`).join(', ') + ' — keeping the committed names there');
    }
    starters = Object.fromEntries(Object.entries(byTeam).filter(([, v]) => v.length === 1).map(([t, v]) => [t, v[0]]));
  }
}
if (OFFLINE && snap.kickers) starters = snap.kickers;
if (starters) snap.kickers = starters;

// ── rebuild the kicker rows ────────────────────────────────────────────────
const fmt = v => (Number.isInteger(v) ? String(v) : String(v));
const kRow = (name, team, s) =>
  `  { name: "${name}", position: "K", team: "${team}", projectedStats: ` +
  `{ fgMade: ${fmt(s.fgMade)}, fgMissed: ${fmt(s.fgMissed)}, xpMade: ${fmt(s.xpMade)}, xpMissed: ${fmt(s.xpMissed)} }}`;
const dRow = (name, team, s) =>
  `  { name: "${name}", position: "DEF", team: "${team}", projectedStats: ` +
  `{ sacks: ${fmt(s.sacks)}, ints: ${fmt(s.ints)}, fumRec: ${fmt(s.fumRec)}, defTD: ${fmt(s.defTD)}, ` +
  `safety: ${fmt(s.safety)}, ptsAllowed: ${fmt(s.ptsAllowed)} }}`;

// Every club with a defence gets a kicker: the two positions cover the same
// league, and a club the board prices on one side and not the other is a hole a
// reader falls into.
const clubs = committedD.map(d => d.team);
const byTeamK = Object.fromEntries(committedK.map(k => [k.team, k]));
const notes = [];
const kOut = [];
for (const team of clubs) {
  const m = market(team);
  if (!m) die(`no market total for ${team}`);
  const old = byTeamK[team] || null;
  const roster = starters ? starters[nflverseTeam(team)] : null;
  let name = old ? old.name : roster;
  if (!name) { notes.push(`${team}: no kicker on the roster file and none committed — SKIPPED`); continue; }
  if (roster && old && roster !== old.name) { notes.push(`${team}: ${old.name} -> ${roster}`); name = roster; }
  else if (roster && !old) notes.push(`${team}: added ${roster} (the pool had no kicker)`);
  else if (roster) name = roster;                        // same man, the file's spelling
  kOut.push({ team, name, old, stats: blendKicker(old ? old.stats : null, m.pf) });
}
// The pool's own level, so the shrink corrects a feed that runs hot across the
// board instead of preserving a fraction of its bias.
const mean = f => committedD.reduce((a, d) => a + f(d.stats), 0) / committedD.length;
const poolMean = { sacks: mean(s => s.sacks || 0), fumRec: mean(s => s.fumRec || 0) };
const dOut = committedD.map(d => {
  const m = market(d.team);
  if (!m) die(`no market total for ${d.team}`);
  return { team: d.team, name: d.name, old: d, stats: blendDefense(d.stats, m.pa, poolMean) };
});

// ── report ─────────────────────────────────────────────────────────────────
const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / a.length); };
const sum = (a, f) => a.reduce((x, r) => x + f(r), 0);
console.log('\nkickers');
for (const k of kOut) {
  const o = k.old ? k.old.stats : null;
  console.log(`  ${k.team.padEnd(4)} ${k.name.padEnd(20)} fg ${o ? String(o.fgMade).padStart(2) : ' -'} -> ${String(k.stats.fgMade).padStart(4)}` +
              `   xp ${o ? String(o.xpMade).padStart(2) : ' -'} -> ${String(k.stats.xpMade).padStart(4)}` +
              `   (market implies ${market(k.team).pf.toFixed(0)} team pts)`);
}
console.log(`  fgMade   sd ${sd(committedK.map(k => k.stats.fgMade)).toFixed(1)} -> ${sd(kOut.map(k => k.stats.fgMade)).toFixed(1)}   (league mean ${LEAGUE.fgMade})`);
console.log(`  xpMade   sd ${sd(committedK.map(k => k.stats.xpMade)).toFixed(1)} -> ${sd(kOut.map(k => k.stats.xpMade)).toFixed(1)}`);
console.log(`  worst FG% ${(100 * Math.min(...kOut.map(k => k.stats.fgMade / (k.stats.fgMade + k.stats.fgMissed)))).toFixed(1)}%`);

console.log('\ndefences');
for (const d of dOut) {
  console.log(`  ${d.team.padEnd(4)} PA ${String(d.old.stats.ptsAllowed).padStart(3)} -> ${String(d.stats.ptsAllowed).padStart(3)}` +
              ` (market ${market(d.team).pa.toFixed(0)})   sacks ${String(d.old.stats.sacks).padStart(2)} -> ${String(d.stats.sacks).padStart(4)}` +
              `   fumRec ${String(d.old.stats.fumRec).padStart(2)} -> ${String(d.stats.fumRec).padStart(4)}` +
              `   defTD ${d.old.stats.defTD} -> ${d.stats.defTD}`);
}
console.log(`  ptsAllowed sd ${sd(committedD.map(d => d.stats.ptsAllowed)).toFixed(1)} -> ${sd(dOut.map(d => d.stats.ptsAllowed)).toFixed(1)}`);
console.log(`  league totals  sacks ${sum(committedD, d => d.stats.sacks)} -> ${sum(dOut, d => d.stats.sacks).toFixed(0)} (real ~${(LEAGUE.sacks * 32).toFixed(0)})`);
console.log(`                 fumRec ${sum(committedD, d => d.stats.fumRec)} -> ${sum(dOut, d => d.stats.fumRec).toFixed(0)} (real ~${(LEAGUE.fumRec * 32).toFixed(0)})`);
console.log(`                 defTD  ${sum(committedD, d => d.stats.defTD)} -> ${sum(dOut, d => d.stats.defTD).toFixed(0)} (real ~${(LEAGUE.defTD * 32).toFixed(0)})`);
if (notes.length) { console.log('\nroster corrections'); for (const n of notes) console.log('  ' + n); }

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

// ── splice ─────────────────────────────────────────────────────────────────
// The K block runs from its banner comment to the DEF banner, and the DEF block
// from its banner to the end of the array. Replacing whole blocks keeps the
// clubs in one deliberate order instead of leaving new rows wherever they land.
const K_BANNER = '  // ── K (';
const D_BANNER = '  // ── DEF (';
const kAt = src.indexOf(K_BANNER, projStart);
const dAt = src.indexOf(D_BANNER, projStart);
if (kAt < 0 || dAt < 0 || dAt < kAt) die('could not find the K/DEF banner comments in PROJECTIONS');
const dEndRow = src.lastIndexOf('position: "DEF"', projEnd);
const dEnd = src.indexOf('\n', src.indexOf('}}', dEndRow)) + 1;

const stamp = `${snap.season} game lines as of ${String(snap.asOf).slice(0, 10)}, tools/rebaseline-k-def.mjs`;
const kBlock = `  // ── K (${stamp}) ──\n` + kOut.map(k => kRow(k.name, k.team, k.stats)).join(',\n') + ',\n';
const dBlock = `  // ── DEF (${stamp}) ──\n` + dOut.map(d => dRow(d.name, d.team, d.stats)).join(',\n') + ',\n';
const out = src.slice(0, kAt) + kBlock + dBlock + src.slice(dEnd);
fs.writeFileSync(WORKER, out);
fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 1) + '\n');
console.log(`\nwrote ${kOut.length} kickers and ${dOut.length} defences into _worker.js`);
console.log('wrote tools/team-market.json');
console.log('next: node tools/build-front.mjs && node tools/build-default-board.mjs && node tools/test-k-def.mjs');
