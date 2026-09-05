#!/usr/bin/env node
// The scoring engine, and the three copies of it this repo carries.
//   node tools/test-scoring.mjs
//
// WHAT THIS IS GUARDING. There is no bundler here, so "score a stat line" is
// written out in _worker.js, in it-league.js and in index.html. They have to
// agree to the digit or the same player is worth different points on the cheat
// sheet, in a story and in the rankings -- and nothing about three files
// rendering fine on their own would ever say so. scoreStats in the worker is
// now the superset the other two are checked against, on RANDOMISED stat lines
// rather than a handful of chosen ones, because a hand-picked case tends to
// exercise the terms the author was already thinking about.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── the worker's engine ────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const S = '// ── the scoring engine ─';
const E = 'const COLUMN_SCORING = {';
const s0 = src.indexOf(S), e0 = src.indexOf(E, s0);
if (s0 < 0 || e0 < 0) { console.error('FAIL: could not locate the scoring engine in _worker.js'); process.exit(1); }
const W = new Function(src.slice(s0, e0) +
  '\nreturn { SCORING_BASE, SCORING_PRESETS, SCORING_PRESET_LABEL, scoringRules, scoreStats, tdPointsFor };')();

// ── it-league.js's copy ────────────────────────────────────────────────────
const lg = fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8');
const lgSlice = lg.slice(lg.indexOf('  function yardageScore('), lg.indexOf('  // The client\'s qbIsPremium'));
const L = new Function('SCORING_DEFAULTS', 'cfg', lgSlice +
  '\nreturn { score: score };')(W.SCORING_BASE, null);

// ── index.html's copy ──────────────────────────────────────────────────────
const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appSlice = ['function yardageScore(', 'function countScore(', 'function scoreSkillPlayer(']
  .map((h) => {
    const i = app.indexOf('\n' + h);
    if (i < 0) return '';
    // Read to the first line that is a lone closing brace at column 0.
    const end = app.indexOf('\n}', i);
    return app.slice(i, end + 2);
  }).join('\n');
const APP = appSlice.includes('scoreSkillPlayer')
  ? new Function(appSlice + '\nreturn { scoreSkillPlayer: scoreSkillPlayer };')()
  : null;

// ── a stat line generator ──────────────────────────────────────────────────
// Deterministic, so a failure is reproducible: same seed, same 400 lines.
let seed = 20260903;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const KEYS = ['passYd', 'passTD', 'passInt', 'pass2pt', 'rushYd', 'rushTD', 'rush2pt',
              'recYd', 'recTD', 'rec2pt', 'rec', 'fumLost', 'fum2pt', 'fumRecTD', 'krTD', 'prTD'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
function randomLine() {
  const st = {};
  for (const k of KEYS) {
    if (rnd() < 0.25) continue;                       // sparse, like a real line
    st[k] = /Yd$/.test(k) ? Math.round(rnd() * 5000) : Math.round(rnd() * 20 * 10) / 10;
  }
  return st;
}

console.log('\nthe three copies agree');
{
  let worstL = 0, worstA = 0, checked = 0;
  for (let i = 0; i < 400; i++) {
    const st = randomLine();
    const pos = POSITIONS[i % POSITIONS.length];
    const mine = W.scoreStats(st, pos, W.SCORING_BASE);
    worstL = Math.max(worstL, Math.abs(mine - L.score(st, pos, W.SCORING_BASE)));
    if (APP) worstA = Math.max(worstA, Math.abs(mine - APP.scoreSkillPlayer(st, pos, { scoring: W.SCORING_BASE })));
    checked++;
  }
  ok('there were lines to check', checked === 400);
  ok('the worker and it-league.js agree on every one', near(worstL, 0), 'worst gap ' + worstL);
  ok('index.html was found and lifted', !!APP);
  ok('the worker and index.html agree on every one', APP && near(worstA, 0), 'worst gap ' + worstA);
}

console.log('\nevery category the brief names actually scores');
{
  // One category at a time, against an empty line, so nothing can hide behind
  // another term. A category that silently contributed zero would pass a test
  // that only ever scored a full stat line.
  const cases = [
    ['passing yards', { passYd: 250 }, 'QB', 10],
    ['passing touchdowns', { passTD: 3 }, 'QB', 12],
    ['interceptions', { passInt: 2 }, 'QB', -4],
    ['rushing yards', { rushYd: 100 }, 'RB', 10],
    ['rushing touchdowns', { rushTD: 2 }, 'RB', 12],
    ['receptions', { rec: 7 }, 'WR', 7],
    ['receiving yards', { recYd: 120 }, 'WR', 12],
    ['receiving touchdowns', { recTD: 1 }, 'WR', 6],
    ['two-point conversions (pass)', { pass2pt: 1 }, 'QB', 2],
    ['two-point conversions (rush)', { rush2pt: 1 }, 'RB', 2],
    ['two-point conversions (receiving)', { rec2pt: 1 }, 'WR', 2],
    ['fumbles lost', { fumLost: 1 }, 'RB', -2],
    ['fumble recovery touchdowns', { fumRecTD: 1 }, 'RB', 6],
    ['kick return touchdowns', { krTD: 1 }, 'WR', 6],
    ['punt return touchdowns', { prTD: 1 }, 'WR', 6]
  ];
  for (const [label, st, pos, want] of cases) {
    ok(label, near(W.scoreStats(st, pos, W.SCORING_BASE), want),
       String(W.scoreStats(st, pos, W.SCORING_BASE)) + ' vs ' + want);
  }
  // The passing-yards threshold is a real rule in this app, not decoration.
  ok('passing yards under the threshold score nothing',
     W.scoreStats({ passYd: 100 }, 'QB', W.SCORING_BASE) === 0);
  ok('and at the threshold they do', near(W.scoreStats({ passYd: 125 }, 'QB', W.SCORING_BASE), 5));
}

console.log('\nbonuses');
{
  const r = W.scoringRules(null, { receivingYardBonuses: [{ at: 100, points: 3 }], receptionBonuses: [{ at: 10, points: 2 }] });
  ok('a yardage bonus fires at its threshold', near(W.scoreStats({ recYd: 100 }, 'WR', r), 13));
  ok('and not below it', near(W.scoreStats({ recYd: 99 }, 'WR', r), 9.9));
  ok('a reception bonus fires too', near(W.scoreStats({ rec: 10 }, 'WR', r), 12));
  ok('a malformed bonus is dropped, not applied',
     W.scoringRules(null, { receivingYardBonuses: [{ at: 'x', points: 3 }] }).receivingYardBonuses.length === 0);
}

console.log('\nthe four scoring settings the rankings page offers');
{
  const st = { rec: 8, recYd: 90, recTD: 1 };
  const std = W.scoreStats(st, 'WR', W.scoringRules('standard'));
  const half = W.scoreStats(st, 'WR', W.scoringRules('half'));
  const ppr = W.scoreStats(st, 'WR', W.scoringRules('ppr'));
  ok('Standard scores no receptions', near(std, 15));
  ok('Half PPR is half a point each', near(half, std + 4));
  ok('PPR is a point each', near(ppr, std + 8));
  ok('the presets differ ONLY in receptions', (() => {
    const a = W.scoringRules('standard'), b = W.scoringRules('ppr');
    return Object.keys(a).every(k => /[Rr]eception/.test(k) || JSON.stringify(a[k]) === JSON.stringify(b[k]));
  })());
  ok('all four settings are labelled for the page',
     ['standard', 'half', 'ppr', 'custom'].every(k => !!W.SCORING_PRESET_LABEL[k]),
     JSON.stringify(W.SCORING_PRESET_LABEL));
  ok('"My League" is the label for custom', W.SCORING_PRESET_LABEL.custom === 'My League');
}

console.log('\nposition-specific reception scoring');
{
  const r = W.scoringRules('ppr', { rbReceptionPoints: 0.5 });
  ok('a back\'s catch can be priced apart from a receiver\'s',
     near(W.scoreStats({ rec: 6 }, 'RB', r), 3) && near(W.scoreStats({ rec: 6 }, 'WR', r), 6));
  ok('and it-league.js splits them the same way',
     near(L.score({ rec: 6 }, 'RB', r), 3) && near(L.score({ rec: 6 }, 'WR', r), 6));
  ok('a tight end is scored on the receiver rule, as the app does',
     near(W.scoreStats({ rec: 6 }, 'TE', r), 6));
}

console.log('\na custom league cannot poison the board');
{
  // Blanking a numeric input in the app saves NaN (parseFloat('')). A NaN
  // divisor here would make every point total on the page NaN.
  const r = W.scoringRules(null, { passingYardsPerPoint: NaN, receptionPoints: undefined, rushingTD: '7' });
  ok('a NaN field falls back to the default', r.passingYardsPerPoint === 25);
  ok('a missing field falls back too', r.receptionPoints === 1);
  ok('a numeric string is accepted', r.rushingTD === 7);
  ok('and the result is a real number',
     Number.isFinite(W.scoreStats({ passYd: 4000, rushTD: 2 }, 'QB', r)));
  ok('zero is a legitimate setting, not a missing one',
     W.scoringRules(null, { receptionPoints: 0 }).receptionPoints === 0);
}

console.log('\nwhat one touchdown is worth');
{
  ok('a back\'s is the rushing value', W.tdPointsFor('RB', W.SCORING_BASE) === 6);
  ok('a receiver\'s is the receiving value', W.tdPointsFor('WR', W.SCORING_BASE) === 6);
  const r = W.scoringRules(null, { receivingTD: 7 });
  ok('and a league that prices them apart is respected',
     W.tdPointsFor('WR', r) === 7 && W.tdPointsFor('RB', r) === 6);
}

console.log('\nthe column still scores exactly as it did');
{
  // _colScore now delegates to the engine. COLUMN_SCORING carries no bonus
  // arrays and no two-point fields, so the extra terms must contribute nothing.
  const colRules = W.scoringRules(null, {
    passingYardsPerPoint: 25, passingYardsThreshold: 125, passingTD: 4, passingInt: -2,
    rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingTD: 6,
    receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingTD: 6,
    receptionPoints: 1, rbReceptionPoints: 1, fumbleLost: -2 });
  const hand = (stats, position) => {
    const s = colRules;
    const yd = (y, per, th) => (y < th || !(per > 0)) ? 0 : y / per;
    let pts = 0;
    pts += yd(stats.passYd || 0, s.passingYardsPerPoint, s.passingYardsThreshold);
    pts += (stats.passTD || 0) * s.passingTD;
    pts += (stats.passInt || 0) * s.passingInt;
    pts += yd(stats.rushYd || 0, s.rushingYardsPerPoint, s.rushingYardsThreshold);
    pts += (stats.rushTD || 0) * s.rushingTD;
    pts += yd(stats.recYd || 0, s.receivingYardsPerPoint, s.receivingYardsThreshold);
    pts += (stats.recTD || 0) * s.receivingTD;
    pts += (stats.rec || 0) * (position === 'RB' ? s.rbReceptionPoints : s.receptionPoints);
    pts += (stats.fumLost || 0) * s.fumbleLost;
    return pts;
  };
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const st = randomLine();
    const pos = POSITIONS[i % POSITIONS.length];
    // The hand version knows nothing of two-point or return scores, so those
    // are dropped from the comparison line -- the point is that the SHARED
    // terms are identical.
    for (const k of ['pass2pt', 'rush2pt', 'rec2pt', 'fum2pt', 'fumRecTD', 'krTD', 'prTD']) delete st[k];
    worst = Math.max(worst, Math.abs(W.scoreStats(st, pos, colRules) - hand(st, pos)));
  }
  ok('the engine reproduces the hand-rolled column scorer', near(worst, 0), 'worst gap ' + worst);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
