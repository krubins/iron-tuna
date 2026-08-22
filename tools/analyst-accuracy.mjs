#!/usr/bin/env node
// Reproduces every number in the lead story
// `analyst-accuracy-five-years-2026-08-22-13` ("Five seasons of scored preseason
// rankings produced five different winners").
//
// Two halves, matching the story's two kinds of claim:
//
//   1. The PROBABILITY work, which is Iron Tuna's own analysis layered on top of
//      FantasyPros' published preseason ("draft") accuracy results, 2021-2025.
//      The accuracy results themselves are sourced, not computed here — see the
//      story's sources list. Only the null models below are ours.
//
//   2. The BOARD numbers, computed off the committed PROJECTIONS set in
//      _worker.js using the site's own default full-PPR scoring (COLUMN_SCORING),
//      odds-blind. This mirrors _colScore(); if that function changes, change
//      this one with it.
//
// Run: node tools/analyst-accuracy.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. The accuracy record, as published by FantasyPros ─────────────────────
// Winner of the preseason "draft" accuracy competition, and the field size, per
// FantasyPros' own year-end recap for each season.
const RECORD = [
  { year: 2021, winner: 'Billy Muzio',      outlet: 'FullTime Fantasy',           field: 229 },
  { year: 2022, winner: 'Rob Waziak',       outlet: 'Fantasy Life',               field: 246 },
  { year: 2023, winner: 'Christopher Dell', outlet: 'Betting Predators',          field: 235 },
  { year: 2024, winner: 'Kevin English',    outlet: 'Draft Sharks',               field: 225 },
  { year: 2025, winner: 'Seth Miller',      outlet: 'Crossroads Fantasy Football', field: 212 },
];

const years = RECORD.length;
const meanField = RECORD.reduce((a, r) => a + r.field, 0) / years;
const POOL = Math.round(meanField);              // 229
const distinct = new Set(RECORD.map(r => r.winner)).size;

console.log('── The record ──────────────────────────────────────────────');
for (const r of RECORD) {
  console.log(`  ${r.year}  ${r.winner.padEnd(18)} ${r.outlet.padEnd(28)} field ${r.field}`);
}
console.log(`  ${years} seasons, ${distinct} distinct winners, mean field ${meanField.toFixed(1)} (pool ${POOL})`);

// ── 2. Null models ──────────────────────────────────────────────────────────
// Every model below assumes analysts are exchangeable (equal skill) and years
// independent. That assumption IS the hypothesis under test: the point is to
// show what the record would look like if nobody had any skill at all.
const choose = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
const binomAtLeast = (n, k, p) => {
  let cum = 0;
  for (let i = 0; i < k; i++) cum += choose(n, i) * p ** i * (1 - p) ** (n - i);
  return 1 - cum;
};

// (a) P(all winners distinct) — "nobody has repeated" is the expected outcome.
let allDistinct = 1;
for (let i = 0; i < years; i++) allDistinct *= (POOL - i) / POOL;

// (b) P(one specific analyst wins >= 2 of 5) under luck.
const p = 1 / POOL;
const repeat = binomAtLeast(years, 2, p);

// (c) Beating the field average N years running is a fair coin.
const STREAK = 10;                                // Kevin English, per FantasyPros
const streak = 0.5 ** STREAK;

// (d) Four outright No. 1 finishes (Sean Koerner) over a career of N years.
const WINS = 4;

console.log('\n── Null models (equal skill, independent years) ─────────────');
console.log(`  P(${years} distinct winners)              = ${(allDistinct * 100).toFixed(1)}%`);
console.log(`  P(a given analyst wins >=2 of ${years})     = ${(repeat * 100).toFixed(3)}%`);
console.log(`  P(beat field avg ${STREAK} yrs running)      = ${streak.toExponential(3)}  (1 in ${Math.round(1 / streak)})`);
for (const career of [10, 20]) {
  const pr = binomAtLeast(career, WINS, p);
  console.log(`  P(>=${WINS} outright wins in ${String(career).padStart(2)} yrs)      = 1 in ${Math.round(1 / pr).toLocaleString('en-US')}`);
}

// ── 3. The board side, off the committed PROJECTIONS ────────────────────────
// Mirrors COLUMN_SCORING / _colScore() in _worker.js.
const SCORING = {
  passingYardsPerPoint: 25, passingYardsThreshold: 125, passingTD: 4, passingInt: -2,
  rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingTD: 6,
  receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingTD: 6,
  receptionPoints: 1, rbReceptionPoints: 1, fumbleLost: -2,
};

function loadProjections() {
  const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const at = src.indexOf('const PROJECTIONS = [');
  if (at < 0) throw new Error('PROJECTIONS not found in _worker.js');
  const open = src.indexOf('[', at);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error('PROJECTIONS array is unterminated');
  return eval(src.slice(open, end + 1));
}

function score(st, pos) {
  const s = SCORING;
  const yd = (y, per, th) => (y < th || !(per > 0)) ? 0 : y / per;
  let pts = 0;
  pts += yd(st.passYd || 0, s.passingYardsPerPoint, s.passingYardsThreshold);
  pts += (st.passTD || 0) * s.passingTD;
  pts += (st.passInt || 0) * s.passingInt;
  pts += yd(st.rushYd || 0, s.rushingYardsPerPoint, s.rushingYardsThreshold);
  pts += (st.rushTD || 0) * s.rushingTD;
  pts += yd(st.recYd || 0, s.receivingYardsPerPoint, s.receivingYardsThreshold);
  pts += (st.recTD || 0) * s.receivingTD;
  pts += (st.rec || 0) * (pos === 'RB' ? s.rbReceptionPoints : s.receptionPoints);
  pts += (st.fumLost || 0) * s.fumbleLost;
  return pts;
}

// Seth Miller's documented 2025 preseason edge, per FantasyPros' recap.
const MILLER_2025 = [
  { name: 'George Pickens',   read: 'Up' },
  { name: 'Jaylen Waddle',    read: 'Up' },
  { name: 'Courtland Sutton', read: 'Up' },
  { name: 'Malik Nabers',     read: 'Fade' },
  { name: 'Tyreek Hill',      read: 'Fade' },
  { name: 'Travis Hunter',    read: 'Fade' },
];

const pool = loadProjections();
const rows = pool.map(pl => ({
  name: pl.name, pos: pl.position, team: pl.team,
  pts: score(pl.projectedStats, pl.position),
}));
const byPos = {};
for (const r of rows) (byPos[r.pos] ||= []).push(r);
for (const k of Object.keys(byPos)) {
  byPos[k].sort((a, b) => b.pts - a.pts);
  byPos[k].forEach((r, i) => { r.rank = i + 1; });
}

console.log(`\n── Our board (${rows.length} players, default full PPR, odds-blind) ──`);
const found = MILLER_2025.map(m => ({ ...m, row: rows.find(r => r.name === m.name) }));
for (const f of found) {
  if (!f.row) { console.log(`  ${f.name.padEnd(18)} NOT IN POOL`); continue; }
  const r = f.row;
  // A player carried with no projection has no meaningful positional rank.
  const rank = r.pts > 0 ? `${r.pos}${r.rank}` : 'unranked';
  console.log(`  ${f.name.padEnd(18)} ${String(r.team).padEnd(4)} ${rank.padEnd(9)} ${r.pts.toFixed(1).padStart(6)}  ${f.read}`);
}

const missing = found.filter(f => !f.row);
if (missing.length) {
  console.error(`\nFAIL: ${missing.length} named player(s) are not in PROJECTIONS.`);
  process.exit(1);
}
console.log('\nAll named players ground to the PROJECTIONS pool.');
