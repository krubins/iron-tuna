#!/usr/bin/env node
// Tests for the Draft Models "Projections vs Vegas" slider in index.html.
//   node tools/test-vegas-weight.mjs
//
// The slider re-cuts a blend the SERVER already made, which is the easy thing
// to get wrong: /api/projections ships projectedStats already 75% toward the
// market, so blending off that shipped number instead of off the committed
// endpoint would compound the default weighting rather than replace it. These
// checks lift the real functions out of index.html and pin the endpoints,
// the default round-trip, and the "only where they disagree" promise.

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
const DEFAULT_W = (() => {
  const m = src.match(/const VEGAS_DEFAULT_W = ([\d.]+);/);
  if (!m) throw new Error('missing VEGAS_DEFAULT_W');
  return parseFloat(m[1]);
})();

const api = new Function(`
  const VEGAS_DEFAULT_W = ${DEFAULT_W};
  ${grab('vegasWeightOf')}
  ${grab('applyVegasWeight')}
  return { vegasWeightOf, applyVegasWeight, VEGAS_DEFAULT_W };
`)();
const { vegasWeightOf, applyVegasWeight } = api;

// ── The default matches the worker ─────────────────────────────────────────
// _worker.js blends at VEGAS_WEIGHT : 1, so the client default has to be
// VEGAS_WEIGHT / (VEGAS_WEIGHT + 1) or the slider's midpoint lies about where
// the shipped board sits.
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const wWeight = parseFloat(worker.match(/const VEGAS_WEIGHT = ([\d.]+);/)[1]);
ok('default weight equals the worker blend', Math.abs(DEFAULT_W - wWeight / (1 + wWeight)) < 1e-9,
   `client ${DEFAULT_W} vs worker ${wWeight}:1`);
ok('default config ships the default weight', /vegasWeight: VEGAS_DEFAULT_W/.test(src));

// ── vegasWeightOf: clamp and fall back ─────────────────────────────────────
ok('missing config falls back to default', vegasWeightOf(null) === DEFAULT_W);
ok('missing strategy falls back to default', vegasWeightOf({}) === DEFAULT_W);
ok('saved config with no vegasWeight falls back', vegasWeightOf({ strategy: { allocation: 0.4 } }) === DEFAULT_W);
ok('a set weight is used', vegasWeightOf({ strategy: { vegasWeight: 0.2 } }) === 0.2);
ok('below zero clamps to zero', vegasWeightOf({ strategy: { vegasWeight: -3 } }) === 0);
ok('above one clamps to one', vegasWeightOf({ strategy: { vegasWeight: 4 } }) === 1);
ok('a non-number falls back', vegasWeightOf({ strategy: { vegasWeight: '0.5' } }) === DEFAULT_W);
ok('NaN falls back', vegasWeightOf({ strategy: { vegasWeight: NaN } }) === DEFAULT_W);

// ── applyVegasWeight ───────────────────────────────────────────────────────
// The fixture mirrors what blendProjections ships: projectedStats is ALREADY
// the blend, and vegas[k] = [committed, marketImplied, blended].
const blend = (c, v, w) => Math.round((c + (v - c) * w) * 10) / 10;
const mk = () => [{
  id: 'a', name: 'A', position: 'RB', team: 'AAA',
  projectedStats: { rushYd: blend(1000, 1200, DEFAULT_W), rushTD: 8, recYd: 400, rec: 45, fumLost: 2 },
  vegas: { rushYd: [1000, 1200, blend(1000, 1200, DEFAULT_W)] }
}, {
  id: 'b', name: 'B', position: 'WR', team: 'BBB',
  projectedStats: { recYd: 900, rec: 70, recTD: 6, rushYd: 0, rushTD: 0, fumLost: 1 }
}];

const atDefault = applyVegasWeight(mk(), DEFAULT_W);
ok('default weight is a no-op on the shipped board',
   atDefault[0].projectedStats.rushYd === blend(1000, 1200, DEFAULT_W));

const pure = applyVegasWeight(mk(), 0);
ok('weight 0 gives back the committed projection', pure[0].projectedStats.rushYd === 1000);
ok('weight 0 rewrites the triple\'s blended slot', pure[0].vegas.rushYd[2] === 1000);
ok('weight 0 leaves the endpoints alone',
   pure[0].vegas.rushYd[0] === 1000 && pure[0].vegas.rushYd[1] === 1200);

const book = applyVegasWeight(mk(), 1);
ok('weight 1 gives back the market number', book[0].projectedStats.rushYd === 1200);
ok('weight 1 rewrites the triple\'s blended slot', book[0].vegas.rushYd[2] === 1200);

const half = applyVegasWeight(mk(), 0.5);
ok('a middle weight lands between the endpoints', half[0].projectedStats.rushYd === 1100);
ok('the slider is monotonic from projections to book',
   pure[0].projectedStats.rushYd < half[0].projectedStats.rushYd
   && half[0].projectedStats.rushYd < book[0].projectedStats.rushYd);

// The promise on the control: it only decides who wins WHERE THEY DISAGREE.
for (const w of [0, 0.25, 0.5, 1]) {
  const pool = mk();
  const before = JSON.stringify(pool[0].projectedStats);
  const out = applyVegasWeight(pool, w);
  ok(`w=${w} leaves unpriced stats untouched`,
     ['rushTD', 'recYd', 'rec', 'fumLost'].every(k => out[0].projectedStats[k] === JSON.parse(before)[k]));
  // Identity, not equality: a player the book never priced must come back as
  // the very same object so downstream memos and Maps keyed on it stay valid.
  ok(`w=${w} leaves players the book never priced untouched`, out[1] === pool[1]);
}

// ── Hostile inputs ─────────────────────────────────────────────────────────
ok('empty pool survives', applyVegasWeight([], 0) .length === 0);
ok('null pool survives', applyVegasWeight(null, 0) === null);

const junk = applyVegasWeight([{
  id: 'j', position: 'RB',
  projectedStats: { rushYd: 800, rushTD: 5 },
  vegas: { rushYd: [null, 900, 875], rushTD: [5], recYd: [300, 400, 375] }
}], 0);
ok('a triple with a non-numeric endpoint is passed through',
   junk[0].projectedStats.rushYd === 800 && junk[0].vegas.rushYd[0] === null);
ok('a malformed triple is passed through', junk[0].vegas.rushTD.length === 1 && junk[0].projectedStats.rushTD === 5);
ok('a triple for a stat the player does not model is passed through',
   !('recYd' in junk[0].projectedStats) && junk[0].vegas.recYd[2] === 375);

const noStats = applyVegasWeight([{ id: 'n', vegas: { rushYd: [1, 2, 1.8] } }], 0);
ok('a player with no projectedStats survives', noStats[0].projectedStats === undefined);

// Purity: the reader can drag the slider back and forth all night, and the
// state React holds must never be mutated out from under a memo.
const original = mk();
applyVegasWeight(original, 0);
applyVegasWeight(original, 1);
ok('the source pool is never mutated',
   original[0].projectedStats.rushYd === blend(1000, 1200, DEFAULT_W)
   && original[0].vegas.rushYd[2] === blend(1000, 1200, DEFAULT_W));

// ── Wiring ─────────────────────────────────────────────────────────────────
// The blend has to be re-cut before anything is scored, or the slider moves
// the Proj column and leaves ranks, tiers, values and the models behind.
ok('baseValued re-cuts the blend before scoring',
   /applyVegasWeight\(players, vegasWeightOf\(config\)\)[\s\S]{0,200}scorePlayer\(p, config\)/.test(src));
ok('the slider writes strategy.vegasWeight', /vegasWeight: parseFloat\(e\.target\.value\)/.test(src));
ok('the slider is hidden when the board carries no odds', /onUpdateStrategy && hasVegasOdds/.test(src));
ok('a hand-edited stat drops out of the blend',
   /A hand-entered stat is the reader's own number/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
