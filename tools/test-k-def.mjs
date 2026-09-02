#!/usr/bin/env node
// Guards the committed kicker and defence rows in _worker.js.
//
//   node tools/test-k-def.mjs
//
// Two questions, and the second is the one that matters:
//
//   1. Do the rows still reproduce tools/k-def-model.mjs applied to the market
//      snapshot they were built from? A hand-edited row is the usual way a
//      rebaselined board quietly comes apart.
//   2. Do they LOOK LIKE EXPECTATIONS? A projection's spread has to be narrower
//      than the spread of outcomes, because it is an average over seasons that
//      have not happened. The board that this file replaced failed exactly here:
//      it put 318 to 520 points allowed on a 32-club board, which is the spread
//      of a season that HAS happened, and floored every defence at two return
//      touchdowns when six to eight clubs really score none.
//
// The league figures below come from nflverse stats_team_reg_2024.csv and
// stats_team_reg_2025.csv, and from the season scores in schedules/games.csv.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketKicker, LEAGUE, K_MODEL } from './k-def-model.mjs';
import { nflverseTeam } from './team-market.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── the committed rows ─────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const a = src.indexOf('const PROJECTIONS = [');
const b = src.indexOf('\n];', a);
const rows = [];
for (const m of src.slice(a, b).matchAll(
  /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g)) {
  const stats = {};
  for (const kv of m[4].split(',')) {
    const p = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
    if (p) stats[p[1]] = parseFloat(p[2]);
  }
  rows.push({ name: m[1], position: m[2], team: m[3], stats });
}
const K = rows.filter(r => r.position === 'K');
const D = rows.filter(r => r.position === 'DEF');
const sum = (arr, f) => arr.reduce((x, r) => x + f(r), 0);
const sd = arr => { const m = arr.reduce((x, y) => x + y, 0) / arr.length;
  return Math.sqrt(arr.reduce((x, v) => x + (v - m) ** 2, 0) / arr.length); };
const mean = arr => arr.reduce((x, y) => x + y, 0) / arr.length;

console.log('\ncoverage');
{
  ok('every club has a defence', D.length === 32, String(D.length));
  // A club the board prices on one side and not the other is a hole a reader
  // falls into: two clubs used to have no kicker at all.
  ok('every club has a kicker', K.length === 32, String(K.length));
  const kTeams = new Set(K.map(r => r.team)), dTeams = new Set(D.map(r => r.team));
  ok('and it is the same 32 clubs on both sides',
    [...dTeams].every(t => kTeams.has(t)), [...dTeams].filter(t => !kTeams.has(t)).join(', '));
  ok('no name carries stray whitespace', rows.every(r => r.name === r.name.trim()),
    rows.filter(r => r.name !== r.name.trim()).map(r => JSON.stringify(r.name)).join(', '));
  ok('no club is listed twice', kTeams.size === K.length && dTeams.size === D.length);
}

console.log('\nkickers look like expectations');
{
  const fg = K.map(r => r.stats.fgMade), xp = K.map(r => r.stats.xpMade);
  // Real clubs made 29.3 and 29.1 field goals a season in 2024 and 2025.
  ok('field goal volume sits at the league level', Math.abs(mean(fg) - LEAGUE.fgMade) < 1.5, mean(fg).toFixed(1));
  // Team quality explains almost nothing about make volume (r = 0.15 over 64
  // team-seasons), so a wide board is asserting a signal that is not there.
  // Realised sd is about 6; an expectation has to be far under that.
  ok('and is not spread like a season of outcomes', sd(fg) < 2.5, 'sd ' + sd(fg).toFixed(2));
  // Extra points ARE nearly the team total (r = 0.96), so this one is allowed
  // real spread — just not more than the outcomes carry.
  ok('extra points carry the spread the team totals do', sd(xp) > 2 && sd(xp) < 10, 'sd ' + sd(xp).toFixed(2));
  const pct = K.map(r => r.stats.fgMade / (r.stats.fgMade + r.stats.fgMissed));
  ok('no projected make rate is under the floor', Math.min(...pct) >= K_MODEL.pctMin - 1e-9,
    (100 * Math.min(...pct)).toFixed(1) + '%');
  ok('and none is over the ceiling', Math.max(...pct) <= K_MODEL.pctMax + 1e-9,
    (100 * Math.max(...pct)).toFixed(1) + '%');
  const poolPct = sum(K, r => r.stats.fgMade) / sum(K, r => r.stats.fgMade + r.stats.fgMissed);
  ok('the pool kicks at roughly the league rate', Math.abs(poolPct - LEAGUE.fgPct) < 0.02,
    (100 * poolPct).toFixed(1) + '%');
  const xpPct = sum(K, r => r.stats.xpMade) / sum(K, r => r.stats.xpMade + r.stats.xpMissed);
  ok('and converts extra points at it too', Math.abs(xpPct - LEAGUE.xpPct) < 0.015, (100 * xpPct).toFixed(1) + '%');
}

console.log('\ndefences look like expectations');
{
  const pa = D.map(r => r.stats.ptsAllowed);
  ok('points allowed sit at the league level', Math.abs(mean(pa) - LEAGUE.points) < 15, mean(pa).toFixed(0));
  // Realised season spread was sd 49 (2023), 52 (2024) and 61 (2025), and
  // year-over-year club correlation is 0.45 at best. An expectation carrying the
  // full outcome spread is selling noise as information.
  ok('and are not spread like a season of outcomes', sd(pa) < 40, 'sd ' + sd(pa).toFixed(1));
  ok('but still separate the good defences from the bad', sd(pa) > 12, 'sd ' + sd(pa).toFixed(1));
  ok('no club is projected outside anything ever seen',
    Math.min(...pa) > 250 && Math.max(...pa) < 560, Math.min(...pa) + '..' + Math.max(...pa));

  // League totals, against 1304/1278 sacks, 268/246 fumble recoveries and 48/47
  // defensive touchdowns in the last two real seasons.
  const sacks = sum(D, r => r.stats.sacks);
  ok('league sack total is realistic', Math.abs(sacks - LEAGUE.sacks * 32) < 60, sacks.toFixed(0));
  ok('and no club is projected a record', Math.max(...D.map(r => r.stats.sacks)) < 62,
    String(Math.max(...D.map(r => r.stats.sacks))));
  const fum = sum(D, r => r.stats.fumRec);
  ok('league fumble-recovery total is realistic', Math.abs(fum - LEAGUE.fumRec * 32) < 40, fum.toFixed(0));
  // Fumble recoveries carry a year-over-year correlation of 0.01. There is
  // nothing to project, so nearly all of the spread should be gone.
  ok('and they are nearly flat, because they are nearly random',
    sd(D.map(r => r.stats.fumRec)) < 1.5, 'sd ' + sd(D.map(r => r.stats.fumRec)).toFixed(2));
  const td = sum(D, r => r.stats.defTD);
  ok('league defensive-touchdown total is realistic', Math.abs(td - LEAGUE.defTD * 32) < 12, td.toFixed(0));
  // The old board floored every club at 2. Real clubs average 1.5 and six to
  // eight of them score none at all.
  ok('and no club is floored above the league average',
    Math.min(...D.map(r => r.stats.defTD)) < LEAGUE.defTD + 0.05,
    String(Math.min(...D.map(r => r.stats.defTD))));
  ok('interceptions keep their level', Math.abs(mean(D.map(r => r.stats.ints)) - 12) < 1.5,
    mean(D.map(r => r.stats.ints)).toFixed(1));
}

console.log('\nthe rows still reproduce the model over their own snapshot');
{
  const snapPath = path.join(ROOT, 'tools', 'team-market.json');
  if (!fs.existsSync(snapPath)) {
    ok('a market snapshot is committed alongside the rows', false, 'tools/team-market.json is missing');
  } else {
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    ok('the snapshot names the season it was taken for', !!snap.season && !!snap.asOf, JSON.stringify(snap.season));
    ok('and covers every club', Object.keys(snap.totals || {}).length === 32,
      String(Object.keys(snap.totals || {}).length));
    // Shrinkage is not idempotent, so re-running the blend over a row that has
    // already been shrunk is not the check. The invariant that DOES hold is
    // distance: a row is the market's view plus at most `ownView` of whatever
    // the old board disagreed by, so it can never wander far from the snapshot
    // it was built against. A hand-edited row shows up here immediately.
    const K_TOL = 6, D_TOL = 30;
    const kBad = [], dBad = [];
    for (const r of K) {
      const m = snap.totals[nflverseTeam(r.team)];
      if (!m) { kBad.push(r.team + ' (no snapshot)'); continue; }
      const want = marketKicker(m.pf);
      if (Math.abs(want.xpMade - r.stats.xpMade) > K_TOL) kBad.push(`${r.team} xp ${r.stats.xpMade} vs market ${want.xpMade.toFixed(1)}`);
      if (Math.abs(want.fgMade - r.stats.fgMade) > K_TOL) kBad.push(`${r.team} fg ${r.stats.fgMade} vs market ${want.fgMade.toFixed(1)}`);
    }
    for (const r of D) {
      const m = snap.totals[nflverseTeam(r.team)];
      if (!m) { dBad.push(r.team + ' (no snapshot)'); continue; }
      if (Math.abs(m.pa - r.stats.ptsAllowed) > D_TOL) dBad.push(`${r.team} PA ${r.stats.ptsAllowed} vs market ${m.pa.toFixed(0)}`);
    }
    ok(`every kicker sits within ${K_TOL} of the market snapshot`, kBad.length === 0, kBad.slice(0, 4).join('; '));
    ok(`every defence sits within ${D_TOL} of the market snapshot`, dBad.length === 0, dBad.slice(0, 4).join('; '));
    // A defence that is 15% of the way from the market toward its own old view
    // has to track the market almost exactly. If it does not, the anchor is not
    // doing its job.
    const corr = (x, y) => { const n = x.length, mx = x.reduce((p, q) => p + q) / n, my = y.reduce((p, q) => p + q) / n;
      let sxy = 0, sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; }
      return sxy / Math.sqrt(sx * sy); };
    const priced = D.filter(r => snap.totals[nflverseTeam(r.team)]);
    const r2 = corr(priced.map(r => r.stats.ptsAllowed), priced.map(r => snap.totals[nflverseTeam(r.team)].pa));
    ok('and tracks it closely', r2 > 0.95, 'r = ' + r2.toFixed(3));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
