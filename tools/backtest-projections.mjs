#!/usr/bin/env node
// Fit the VALUE column's risk constants to a real season instead of guessing them.
//   node tools/backtest-projections.mjs [--year 2025] [--teams 12]
//
// WHY THIS EXISTS: VALUE carries three judgement calls that decide how the
// league's money is split between positions and between stars and depth —
// POS_RELIABILITY (a per-position haircut), the per-rank decay inside
// reliabilityFactor, and VORP_CONCAVITY (how much of a star's edge his price
// keeps). None of them was ever fitted. The PROJ_2025 table in index.html is
// NOT a preseason projection set (it sits within 1.5% of ACT_2025), so nothing
// in the repo can fit them. This script does, the day a real one exists.
//
// INPUTS (both gitignored under tools/sources/, same schema as merge-projections):
//   tools/sources/preseason-<year>.json   what the feeds said BEFORE the season
//   tools/sources/actuals-<year>.json     what each player actually produced
//   [ { "name": "Josh Allen", "position": "QB", "team": "BUF",
//       "stats": { "passYd": 3900, "passTD": 26, ... } }, ... ]
// Stat keys use the site's names (see the header of tools/merge-projections.mjs).
//
// OUTPUT, per position, at the site's default scoring:
//   1. the EX-ANTE level factor — mean actual points of the players who were
//      PROJECTED top-K, over their projected mean. This is the number
//      normalizeToLastYear should apply; the ex-post version it has to use
//      today (last year's realised top-K over this year's projected top-K) is
//      printed beside it so the survivorship gap is visible.
//   2. realised VORP share vs projected VORP share, which is what a reliability
//      factor is: the share of the money a position's projections actually
//      earned. Normalised so the most reliable skill position reads 1.00.
//   3. the rank decay: realised/projected VORP by projected-rank bucket.
//   4. the concavity that best matches projected dollar shares to realised
//      ones, by grid search.
// It prints suggested constants. It does not edit anything: move the numbers
// into index.html by hand and record the year they came from beside them.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const YEAR = opt('year', '2025');
const TEAMS = +opt('teams', 12);
const preF = path.join(ROOT, 'tools/sources', `preseason-${YEAR}.json`);
const actF = path.join(ROOT, 'tools/sources', `actuals-${YEAR}.json`);
if (!fs.existsSync(preF) || !fs.existsSync(actF)) {
  console.log(`No backtest data: need ${path.relative(ROOT, preF)} and ${path.relative(ROOT, actF)}.`);
  console.log('The PROJ_2025/ACT_2025 tables in index.html are not a preseason set and cannot stand in.');
  console.log('Nothing fitted; POS_RELIABILITY / VORP_CONCAVITY stay the documented judgement calls.');
  process.exit(0);
}
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// ── lift scorePlayer + the default scoring out of index.html ─────────────────
function matchFrom(src, start, open, close) {
  let d = 0, inS = null, inC = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inC) { if (inC === '//' && c === '\n') inC = null; else if (inC === '/*' && c === '*' && n === '/') { inC = null; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inC = '//'; i++; continue; }
    if (c === '/' && n === '*') { inC = '/*'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === open) d++; else if (c === close) { d--; if (d === 0) return i; }
  }
  return -1;
}
function endOfStatement(src, start) {
  let d = 0, inS = null, inC = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inC) { if (inC === '//' && c === '\n') inC = null; else if (inC === '/*' && c === '*' && n === '/') { inC = null; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inC = '//'; i++; continue; }
    if (c === '/' && n === '*') { inC = '/*'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; else if (c === ';' && d === 0) return i;
  }
  return -1;
}
const decls = new Map();
{ const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm; let m;
  while ((m = re.exec(idx))) { const pi = idx.indexOf('(', m.index), pe = matchFrom(idx, pi, '(', ')'); if (pe < 0) continue;
    const bi = idx.indexOf('{', pe), be = matchFrom(idx, bi, '{', '}'); if (be < 0) continue; if (!decls.has(m[1])) decls.set(m[1], idx.slice(m.index, be + 1)); } }
function closure(roots) { const picked = new Map(), stack = [...roots];
  while (stack.length) { const n = stack.pop(); if (picked.has(n) || !decls.has(n)) continue; const body = decls.get(n); picked.set(n, body);
    for (const id of body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) if (decls.has(id) && !picked.has(id)) stack.push(id); }
  return [...picked.values()].join('\n'); }
const liftConst = n => { const m = new RegExp('^const\\s+' + n + '\\s*=', 'm').exec(idx); if (!m) throw new Error('cannot lift ' + n); return idx.slice(m.index, endOfStatement(idx, m.index) + 1); };
const lib = new Function(['VEGAS_DEFAULT_W', 'DEFAULT_LEAGUE_CONFIG', 'POS_RELIABILITY', 'RELIABILITY_RANK_DECAY', 'RELIABILITY_RANK_FLOOR'].map(liftConst).join('\n')
  + '\n' + closure(['scorePlayer', 'calculateReplacementLevels', 'calculateVORP', 'reliabilityFactor'])
  + '\nreturn { scorePlayer, calculateReplacementLevels, calculateVORP, DEFAULT_LEAGUE_CONFIG, POS_RELIABILITY };')();
const config = JSON.parse(JSON.stringify(lib.DEFAULT_LEAGUE_CONFIG));
config.teams = TEAMS;
const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
const load = f => JSON.parse(fs.readFileSync(f, 'utf8')).map(p => ({ name: p.name, position: p.position, team: p.team, projectedStats: p.stats || p.projectedStats || {} }));
const pre = load(preF), act = load(actF);
const actBy = new Map(act.map(p => [norm(p.name) + '|' + p.position, p]));
const rows = pre.map(p => {
  const a = actBy.get(norm(p.name) + '|' + p.position);
  return { name: p.name, position: p.position, proj: lib.scorePlayer(p, config), act: a ? lib.scorePlayer(a, config) : 0, matched: !!a };
});
const matched = rows.filter(r => r.matched);
console.log(`preseason ${pre.length} players, actuals ${act.length}, matched ${matched.length} (unmatched players count as 0 actual points — an unmatched player did not play)`);
const POS = ['QB', 'RB', 'WR', 'TE'];
const byPos = {}; rows.forEach(r => (byPos[r.position] = byPos[r.position] || []).push(r));
POS.forEach(pos => (byPos[pos] || []).sort((a, b) => b.proj - a.proj));
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

// 1. level: ex-ante vs ex-post
console.log('\n1. LEVEL FACTOR (what normalizeToLastYear should apply)');
console.log('   pos  K   ex-ante (actual of projected top-K / their projection)   ex-post (realised top-K / projected top-K)');
const levelFit = {};
POS.forEach(pos => {
  const arr = byPos[pos] || []; if (arr.length < 12) return;
  const K = Math.min(32, arr.length);
  const top = arr.slice(0, K);
  const exAnte = mean(top.map(r => r.act)) / mean(top.map(r => r.proj));
  const realisedTop = arr.map(r => r.act).sort((a, b) => b - a).slice(0, K);
  const exPost = mean(realisedTop) / mean(top.map(r => r.proj));
  levelFit[pos] = exAnte;
  console.log(`   ${pos.padEnd(3)} ${String(K).padEnd(3)} ${exAnte.toFixed(3).padEnd(56)} ${exPost.toFixed(3)}   (survivorship gap ${(exPost - exAnte).toFixed(3)})`);
});

// 2. reliability: realised VORP share vs projected VORP share
console.log('\n2. RELIABILITY (share of the money a position\'s projections actually earned)');
const pbp = {}; rows.forEach(r => (pbp[r.position] = pbp[r.position] || []).push({ ...r, projectedPoints: r.proj }));
const replP = lib.calculateReplacementLevels(pbp, config);
const abp = {}; rows.forEach(r => (abp[r.position] = abp[r.position] || []).push({ ...r, projectedPoints: r.act }));
const replA = lib.calculateReplacementLevels(abp, config);
const rel = {};
POS.forEach(pos => {
  const n = (config.roster[pos] ? config.roster[pos].total : 0) * TEAMS;
  const drafted = (byPos[pos] || []).slice(0, n);      // the players a room would have rostered off the projections
  const pv = drafted.reduce((s, r) => s + Math.max(0, r.proj - (replP[pos] || 0)), 0);
  const av = drafted.reduce((s, r) => s + Math.max(0, r.act - (replA[pos] || 0)), 0);
  rel[pos] = pv > 0 ? av / pv : 0;
});
const relMax = Math.max(...POS.map(p => rel[p] || 0));
console.log('   pos  realised/projected VORP   suggested POS_RELIABILITY (max skill position = 1.00)   current');
POS.forEach(pos => console.log(`   ${pos.padEnd(3)}  ${(rel[pos] || 0).toFixed(3).padEnd(24)} ${(relMax ? rel[pos] / relMax : 0).toFixed(2).padEnd(52)} ${lib.POS_RELIABILITY[pos]}`));

// 3. rank decay
console.log('\n3. RANK DECAY (realised/projected VORP by projected rank; the current shape is 1 - 0.006 x rank, floor 0.82)');
POS.forEach(pos => {
  const arr = byPos[pos] || []; const out = [];
  for (let b = 0; b < 48; b += 12) {
    const seg = arr.slice(b, b + 12); if (!seg.length) break;
    const pv = seg.reduce((s, r) => s + Math.max(0, r.proj - (replP[pos] || 0)), 0);
    const av = seg.reduce((s, r) => s + Math.max(0, r.act - (replA[pos] || 0)), 0);
    out.push(`${b + 1}-${b + seg.length}: ${pv > 0 ? (av / pv).toFixed(2) : '—'}`);
  }
  console.log(`   ${pos.padEnd(3)} ${out.join('   ')}`);
});

// 4. concavity: which exponent on projected VORP best matches the realised dollar split
console.log('\n4. CONCAVITY (exponent on projected VORP whose dollar shares best match realised VORP shares)');
const pool = [];
POS.forEach(pos => { const n = (config.roster[pos] ? config.roster[pos].total : 0) * TEAMS; (byPos[pos] || []).slice(0, n).forEach(r => pool.push({ pv: Math.max(0, r.proj - (replP[pos] || 0)), av: Math.max(0, r.act - (replA[pos] || 0)) })); });
const avTot = pool.reduce((s, r) => s + r.av, 0);
let best = null;
for (let c = 0.5; c <= 1.0001; c += 0.05) {
  const pvTot = pool.reduce((s, r) => s + Math.pow(r.pv, c), 0);
  const err = pool.reduce((s, r) => s + Math.pow(Math.pow(r.pv, c) / pvTot - r.av / avTot, 2), 0);
  console.log(`   c = ${c.toFixed(2)}  squared share error ${(err * 1e4).toFixed(3)} (x1e-4)`);
  if (!best || err < best.err) best = { c, err };
}
console.log(`   best: VORP_CONCAVITY = ${best.c.toFixed(2)} (current 0.75)`);
console.log('\nMove any constant you adopt into index.html by hand and note the year beside it.');
