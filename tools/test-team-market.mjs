#!/usr/bin/env node
// The worker and the offline tools carry two copies of the same maths, because
// this repo has no build step: _worker.js runs the ratings fit and the K/DEF
// model on the daily cron, tools/team-market.mjs and tools/k-def-model.mjs run
// them when the committed rows are rebaselined. This test runs both against one
// fixture and fails if they have drifted apart.
//
//   node tools/test-team-market.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSeasonGames, fitRatings, seasonTotals, marketTotals, nflverseTeam } from './team-market.mjs';
import { blendKicker, blendDefense, marketKicker, LEAGUE, K_MODEL, D_MODEL } from './k-def-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── lift the worker's copy ─────────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const s = src.indexOf('// Vegas-weighted projections');
const e = src.indexOf('export default {', s);
if (s < 0 || e < 0) { console.error('FAIL: could not locate the Vegas section in _worker.js'); process.exit(1); }
const W = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null;
  ${src.slice(s, e)}
  return { marketSeasonTotals, marketKicker, blendKicker, blendDefense,
           KDEF_LEAGUE, K_MODEL, D_MODEL, MARKET_RIDGE, MARKET_MIN_PRICED, teamKey };
`)([], () => 'ENC', 'k', async () => { throw new Error('no network here'); });

// ── a deterministic fixture ────────────────────────────────────────────────
// Sixteen clubs, a double round robin, and a spread that makes the first club
// the best offence and the last the worst. Half the fixtures carry no line, so
// the schedule-complete projection is doing real work rather than averaging.
const CLUBS = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH',
               'BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH'];
const strength = (t) => 3.5 - CLUBS.indexOf(t) * 0.45;      // +3.5 down to -3.2
const fixture = [];
for (let i = 0; i < CLUBS.length; i++) {
  for (let j = 0; j < CLUBS.length; j++) {
    if (i === j) continue;
    const home = CLUBS[i], away = CLUBS[j];
    const spread = strength(home) - strength(away) + 1.5;    // 1.5 pts of home field
    const total = 45 + (strength(home) + strength(away)) * 0.6;
    // Everything from the back half of the loop is "not posted yet".
    const priced = (i * CLUBS.length + j) % 2 === 0;
    fixture.push({ home, away, spread, total, priced });
  }
}

console.log('\nthe worker and the tool fit the same ratings');
{
  const mine = seasonTotals(fixture, fitRatings(fixture));
  const theirs = W.marketSeasonTotals(fixture);
  ok('both price every club', Object.keys(mine).length === CLUBS.length
    && Object.keys(theirs).length === CLUBS.length);
  const worst = CLUBS.map(t => Math.max(Math.abs(mine[t].pf - theirs[t].pf), Math.abs(mine[t].pa - theirs[t].pa)));
  ok('and agree to the last decimal', Math.max(...worst) < 1e-6, 'max gap ' + Math.max(...worst).toExponential(2));
  ok('the ridge constant has not drifted', W.MARKET_RIDGE === 0.25);
  ok('so has the priced-game floor', W.MARKET_MIN_PRICED === 48);
}

console.log('\nthe fit recovers what the fixture put in');
{
  const r = fitRatings(fixture);
  ok('it converges', r.ok, r.error || '');
  ok('with essentially no residual', r.rmse < 0.05, 'rmse ' + r.rmse.toFixed(4));
  ok('home field comes back out', near(r.hfa, 0.75, 0.05), String(r.hfa.toFixed(3)));
  const t = seasonTotals(fixture, r);
  ok('the best offence outscores the worst', t.AA.pf > t.BH.pf + 50, (t.AA.pf - t.BH.pf).toFixed(0));
  ok('and concedes less than it scores', t.AA.pa < t.AA.pf);
  const pf = CLUBS.reduce((a, c) => a + t[c].pf, 0), pa = CLUBS.reduce((a, c) => a + t[c].pa, 0);
  ok('points for and against balance', near(pf, pa, 1e-6), pf.toFixed(2) + ' vs ' + pa.toFixed(2));
  ok('every club is projected over the whole schedule',
    CLUBS.every(c => t[c].games === (CLUBS.length - 1) * 2));
}

console.log('\na season too thin to fit is refused, not guessed');
{
  const thin = fixture.map((g, i) => ({ ...g, priced: g.priced && i < 20 }));
  const r = fitRatings(thin);
  ok('the tool says so', !r.ok && r.error === 'too_few_priced', JSON.stringify(r.error));
  let threw = false;
  try { W.marketSeasonTotals(thin); } catch (err) { threw = /priced/.test(err.message); }
  ok('and the worker throws rather than serving a fit off ten games', threw);
}

console.log('\nthe kicker and defence models are one model');
{
  ok('league constants agree', JSON.stringify(W.KDEF_LEAGUE) === JSON.stringify(LEAGUE),
    JSON.stringify(W.KDEF_LEAGUE));
  ok('kicker constants agree', JSON.stringify(W.K_MODEL) === JSON.stringify(K_MODEL));
  ok('the defence constants the worker uses agree',
    W.D_MODEL.paOwnView === D_MODEL.paOwnView, String(W.D_MODEL.paOwnView));
  for (const pts of [300, 391, 460]) {
    const a = marketKicker(pts), b = W.marketKicker(pts);
    ok(`marketKicker(${pts})`, near(a.fgMade, b.fgMade) && near(a.xpMade, b.xpMade));
  }
  const committed = { fgMade: 26, fgMissed: 7, xpMade: 41, xpMissed: 2 };
  for (const pts of [310, 391, 455]) {
    ok(`blendKicker(${pts})`,
      JSON.stringify(blendKicker(committed, pts)) === JSON.stringify(W.blendKicker(committed, pts)),
      JSON.stringify(W.blendKicker(committed, pts)));
  }
  for (const pa of [340, 391, 470]) {
    ok(`blendDefense points allowed at ${pa}`,
      blendDefense({ ptsAllowed: 470, sacks: 44, ints: 12, fumRec: 9 }, pa).ptsAllowed
        === W.blendDefense({ ptsAllowed: 470 }, pa).ptsAllowed);
  }
  // The worker deliberately emits only points allowed: the other four stats are
  // nobody's market, and the committed rows already carry them shrunk.
  ok('the worker emits points allowed and nothing else',
    Object.keys(W.blendDefense({ ptsAllowed: 400, sacks: 44 }, 391)).join(',') === 'ptsAllowed');
}

console.log('\nclub codes map the same way on both sides');
{
  for (const [ours, theirs] of [['LAR', 'LA'], ['JAC', 'JAX'], ['WSH', 'WAS'], ['BUF', 'BUF']]) {
    ok(`${ours} -> ${theirs}`, nflverseTeam(ours) === theirs && W.teamKey(ours) === theirs,
      nflverseTeam(ours) + '/' + W.teamKey(ours));
  }
}

console.log('\nthe parser keeps the fixtures a projection needs');
{
  const csv = [
    'game_id,season,week,away_team,home_team,spread_line,total_line,game_type,stadium',
    '2026_01_AA_AB,2026,1,AA,AB,2.5,44.5,REG,"Foo, MA"',
    '2026_02_AB_AA,2026,2,AB,AA,,,REG,Bar',          // scheduled, not yet priced
    '2026_03_AA_AC,2026,3,AA,AC,99,44.5,REG,Baz',    // junk spread
    '2026_20_AA_AB,2026,20,AA,AB,1,44,POST,Baz',     // not the regular season
    '2025_01_AA_AB,2025,1,AA,AB,1,44,REG,Baz'        // last season
  ].join('\n');
  const { season, games } = parseSeasonGames(csv);
  ok('takes the newest season only', season === 2026 && games.length === 3, String(games.length));
  ok('an unpriced fixture is kept, without a price', games[1].priced === false);
  ok('a junk line loses its price and keeps its fixture', games[2].priced === false);
  ok('a comma inside a quoted field does not shear the row', games[0].priced === true && games[0].total === 44.5);
  const mt = marketTotals(csv);
  ok('three games is not a season', !mt.ok && mt.error === 'too_few_priced');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
