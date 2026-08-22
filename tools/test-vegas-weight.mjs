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
  ${grab('_liveNorm')}
  ${grab('graftVegasOdds')}
  return { vegasWeightOf, applyVegasWeight, graftVegasOdds, VEGAS_DEFAULT_W };
`)();
const { vegasWeightOf, applyVegasWeight, graftVegasOdds } = api;

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

// ── graftVegasOdds: the odds reach a board that was saved without them ─────
// A pool saved while the Worker had no overlay is pinned at the current
// projVersion and never re-fetched, so it carries no triples — and the slider,
// which hides itself when nothing carries odds, never appears. The graft puts
// the odds back without touching anything the reader owns.
const savedNoOdds = () => [{
  id: 'a', name: 'A. Back', position: 'RB', team: 'AAA',
  projectedStats: { rushYd: 1000, rushTD: 8, recYd: 400, rec: 45 }
}, {
  id: 'b', name: 'B. Wideout', position: 'WR', team: 'BBB',
  projectedStats: { recYd: 900, rec: 70, recTD: 6 }
}];
const shipped = () => [{
  id: 'a', name: 'A. Back', position: 'RB', team: 'AAA',
  projectedStats: { rushYd: blend(1000, 1200, DEFAULT_W), rushTD: 8, recYd: 400, rec: 45 },
  vegas: { rushYd: [1000, 1200, blend(1000, 1200, DEFAULT_W)] }
}, {
  id: 'b', name: 'B. Wideout', position: 'WR', team: 'BBB',
  projectedStats: { recYd: 900, rec: 70, recTD: 6 }
}];

const healed = graftVegasOdds(savedNoOdds(), shipped());
ok('the graft puts the triple back', !!(healed[0].vegas && healed[0].vegas.rushYd));
ok('the graft lands on the shipped blend', healed[0].projectedStats.rushYd === blend(1000, 1200, DEFAULT_W));
ok('the graft carries both endpoints, so the slider can re-cut it',
   healed[0].vegas.rushYd[0] === 1000 && healed[0].vegas.rushYd[1] === 1200);
ok('the grafted board can then be dragged to the book',
   applyVegasWeight(healed, 1)[0].projectedStats.rushYd === 1200);
ok('the graft leaves unpriced stats alone',
   healed[0].projectedStats.rushTD === 8 && healed[0].projectedStats.recYd === 400);
ok('a player the book never priced comes back as the same object', healed[1] === savedNoOdds()[1] || !healed[1].vegas);
ok('the graft does not mutate the saved pool', savedNoOdds()[0].projectedStats.rushYd === 1000);

// The reader's own number outranks the odds — the same promise handlePlayerEdit
// makes in the other direction. A stat that no longer sits on the committed
// endpoint was typed over (or imported), and the graft must not overwrite it.
const edited = savedNoOdds();
edited[0].projectedStats.rushYd = 1150;
const afterEdit = graftVegasOdds(edited, shipped());
ok('a hand-edited stat is not overwritten', afterEdit[0].projectedStats.rushYd === 1150);
ok('a hand-edited stat gets no triple, so the slider cannot claim it later',
   !(afterEdit[0].vegas && afterEdit[0].vegas.rushYd));

// Matching is by normalised name + position, so a live-status team change or a
// punctuation difference in a saved name does not lose the odds.
const renamed = savedNoOdds();
renamed[0].name = "A Back";
renamed[0].team = 'ZZZ';
ok('punctuation and a team change still match',
   !!graftVegasOdds(renamed, shipped())[0].vegas);
const wrongPos = savedNoOdds();
wrongPos[0].position = 'WR';
ok('a different position does not match', !graftVegasOdds(wrongPos, shipped())[0].vegas);

// Nothing to graft is a no-op, identity included: the effect runs on every load
// for a reader whose board legitimately has no odds, and must not churn state.
ok('a baseline with no odds returns the same array',
   (() => { const p = savedNoOdds(); return graftVegasOdds(p, savedNoOdds()) === p; })());
ok('no matching player returns the same array',
   (() => { const p = savedNoOdds(); return graftVegasOdds(p, [{ name: 'Nobody', position: 'TE', projectedStats: {}, vegas: { recYd: [1, 2, 1.8] } }]) === p; })());
ok('an empty pool survives the graft', graftVegasOdds([], shipped()).length === 0);
ok('a null pool survives the graft', graftVegasOdds(null, shipped()) === null);
ok('a null baseline survives the graft',
   (() => { const p = savedNoOdds(); return graftVegasOdds(p, null) === p; })());
ok('a malformed triple is skipped rather than trusted',
   !graftVegasOdds(savedNoOdds(), [{ name: 'A. Back', position: 'RB', projectedStats: {}, vegas: { rushYd: [null, 1200, 1150] } }])[0].vegas);

// ── Wiring: the heal is actually reachable ─────────────────────────────────
ok('a current saved pool with no odds still fetches the baseline',
   /!initialState\.players\.some\(p => p && p\.vegas\)/.test(src));
ok('the odds-only path grafts instead of re-baselining',
   /setPlayers\(prev => graftVegasOdds\(prev, baseline\)\)/.test(src));
ok('an imported or live-loaded pool is left alone',
   /savedSource === 'Projections 2026'/.test(src));
ok('a failed odds-only fetch does not raise the projections error',
   /if \(!oddsOnly\) setProjLoadFailed\(true\);/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
