#!/usr/bin/env node
// Tests for the per-row "the odds moved this player" chip in index.html.
//   node tools/test-vegas-rank-chip.mjs
//
// The chip claims a RANK movement, which is the one thing that is easy to get
// subtly wrong: a rank is relative, so both boards have to be ranked over the
// same pool. Ranking only the players the market priced would invent shifts
// that never happened, and ranking the wrong board would point the arrow the
// wrong way. This lifts the real functions out of index.html and checks both.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const grab = name => {
  const i = src.indexOf('function ' + name);
  if (i < 0) throw new Error('missing ' + name);
  return src.slice(i, src.indexOf('\n}', i) + 2);
};
const cfgSeg = src.slice(src.indexOf('const DEFAULT_LEAGUE_CONFIG'), src.indexOf('function yardageScore'));
const num = k => { const m = cfgSeg.match(new RegExp('\\b' + k + ':\\s*(-?[\\d.]+)')); return m ? parseFloat(m[1]) : 0; };
const scoring = {};
for (const k of ['passingYardsPerPoint', 'passingYardsThreshold', 'passingTD', 'passingInt', 'passing2pt',
                 'rushingYardsPerPoint', 'rushingYardsThreshold', 'rushingTD', 'rushing2pt',
                 'receivingYardsPerPoint', 'receivingYardsThreshold', 'receivingTD', 'receiving2pt',
                 'receptionPoints', 'rbReceptionPoints', 'fumbleLost', 'fumble2pt',
                 'individualFumbleRecoveryTD', 'individualKickReturnTD', 'individualPuntReturnTD']) scoring[k] = num(k);
for (const k of ['passingYardBonuses', 'rushingYardBonuses', 'receivingYardBonuses', 'receptionBonuses', 'rbReceptionBonuses']) scoring[k] = [];
const config = { scoring };

const api = new Function(`
  ${grab('yardageScore')}
  ${grab('countScore')}
  ${grab('scoreSkillPlayer')}
  ${grab('scoreKicker')}
  ${grab('scoreDefense')}
  ${grab('scorePlayer')}
  ${grab('vegasRankShifts')}
  return { vegasRankShifts, scorePlayer };
`)();

// INVARIANT these fixtures must respect: blendProjections ships projectedStats
// ALREADY BLENDED, with vegas[k] = [committed, marketImplied, blended]. So the
// stat below is the blended number and vegas[k][0] is the pre-odds one — build
// them the other way round and the test is checking a state that never exists.
const qb = (id, passTD, vegas) => ({
  id, name: 'QB ' + id, position: 'QB', team: 'AAA',
  projectedStats: { passYd: 4000, passTD, passInt: 10, rushYd: 200, rushTD: 2, fumLost: 1 },
  ...(vegas ? { vegas } : {})
});
const pool = [
  qb('a', 34), qb('b', 30), qb('c', 28),
  // [committed, marketImplied, blended] — the shape blendProjections ships.
  qb('d', 32, { passTD: [26, 34, 32] })
];

console.log('\nrank movement');
{
  const sh = api.vegasRankShifts(pool, config);
  const d = sh.get('d');
  ok('the priced player gets a shift', !!d, JSON.stringify([...sh]));
  ok('the odds moved him up two slots', d && d.before === 4 && d.after === 2 && d.move === 2, d && JSON.stringify(d));
  ok('the points delta is positive and real', d && d.pts > 0, d && String(d.pts));
  ok('unpriced players get no chip at all', !sh.has('a') && !sh.has('b') && !sh.has('c'));
}

console.log('\ndirection and edges');
{
  const faded = [qb('a', 34), qb('b', 30), qb('c', 24, { passTD: [34, 20, 24] })];
  const sh = api.vegasRankShifts(faded, config);
  const c = sh.get('c');
  // c was 34 before the odds (1st on the committed board) and blends to 24, so
  // he falls behind both. before=1, after=3, move=-2.
  ok('a faded player reads as a downgrade', c && c.move < 0 && c.pts < 0, c && JSON.stringify(c));
  ok('before/after are 1-indexed ranks', c && c.before >= 1 && c.after >= 1);

  const flat = [qb('a', 34), qb('b', 30, { passTD: [30, 30, 30] })];
  const f = api.vegasRankShifts(flat, config).get('b');
  ok('a priced player the odds agree with does not move', f && f.move === 0 && Math.abs(f.pts) < 1e-9, f && JSON.stringify(f));

  ok('an empty pool is handled', api.vegasRankShifts([], config).size === 0);
  ok('a missing config is handled', api.vegasRankShifts(pool, null).size === 0);
  const noStats = api.vegasRankShifts([{ id: 'x', position: 'QB', vegas: { passTD: [1, 2, 2] } }], config);
  ok('a player with no projected stats does not throw', noStats instanceof Map);
}

console.log('\nranks are computed per position, over the whole pool');
{
  const mixed = [
    qb('q1', 34), qb('q2', 35, { passTD: [20, 40, 35] }),
    { id: 'r1', name: 'RB one', position: 'RB', team: 'B', projectedStats: { rushYd: 1200, rushTD: 10, rec: 40, recYd: 300, recTD: 2, fumLost: 1 } }
  ];
  const sh = api.vegasRankShifts(mixed, config);
  ok('the RB is untouched by a QB market move', !sh.has('r1'));
  ok('the QB who was priced moved to the top', sh.get('q2') && sh.get('q2').after === 1, JSON.stringify(sh.get('q2')));
}

console.log('\nthe chip is wired into both screens');
{
  const cheat = src.slice(src.indexOf('function Cheatsheet({'), src.indexOf('function Cheatsheet({') + 60000);
  const rail = src.slice(src.indexOf('function PlayersRail({'), src.indexOf('function PlayersRail({') + 60000);
  for (const [label, seg] of [['cheat sheet', cheat], ['auction manager rail', rail]]) {
    ok(`${label} computes the shifts once`, /const vegasShifts = React\.useMemo\(\(\) => vegasRankShifts\(players, config\)/.test(seg));
    ok(`${label} renders the chip on the row`, /vegasRankEl\(p, vegasShifts, config\)/.test(seg));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
