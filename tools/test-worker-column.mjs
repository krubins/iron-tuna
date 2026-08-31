#!/usr/bin/env node
// Tests for the "Vegas vs. Rankings & ADP" column inside _worker.js.
//   node tools/test-worker-column.mjs
//
// The column re-ranks the whole board twice — once off the committed
// projections, once off the market's numbers — so the thing most likely to
// break it is silent DRIFT: the client changes its scoring or its price curve,
// the worker's hand-synced copy does not, and the column starts quoting dollar
// gaps that no page on the site agrees with. The first block below lifts both
// copies out of their real files and fails loudly when they diverge.
//
// Like tools/test-worker-odds.mjs this evaluates the REAL worker source rather
// than a reimplementation, and finishes against the live nflverse pull so the
// column is exercised on real lines, not just stubs.

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

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── lift the Vegas section out of the worker ───────────────────────────────
const START = '// Vegas-weighted projections';
const s = src.indexOf(START);
const e = src.indexOf('export default {', s);
if (s < 0 || e < 0) { console.error('FAIL: could not locate the Vegas section in _worker.js'); process.exit(1); }
const section = src.slice(s, e);

const harness = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null;
  ${section}
  return { buildVegasColumn, _colScore, _colPrice, _colVegasStats, _colBlendStats, _oddsNorm,
           fetchTeamEnvNflverse, buildTeamEnvOverlay,
           COLUMN_SCORING, COLUMN_CURVE, COLUMN_CURVE_BUDGET, COLUMN_LEAGUE_BUDGET,
           COLUMN_MAX_ITEMS, COLUMN_MIN_RANK_GAP, COLUMN_MIN_PRICE_GAP, COLUMN_POSITIONS,
           COLUMN_MAX_AGREE, COLUMN_AGREE_MAX_RANK, VEGAS_WEIGHT };
`);

const realPool = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  const seg = src.slice(st, src.indexOf('\n];', st));
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();

const STUB = [
  { name: 'Alpha Passer',  position: 'QB', team: 'AAA', projectedStats: { passYd: 4000, passTD: 30, passInt: 10, rushYd: 200, rushTD: 2, fumLost: 1 } },
  { name: 'Bravo Passer',  position: 'QB', team: 'BBB', projectedStats: { passYd: 3900, passTD: 28, passInt: 11, rushYd: 150, rushTD: 1, fumLost: 1 } },
  { name: 'Charlie Passer', position: 'QB', team: 'CCC', projectedStats: { passYd: 3600, passTD: 22, passInt: 12, rushYd: 100, rushTD: 1, fumLost: 1 } },
  { name: 'Delta Back',    position: 'RB', team: 'AAA', projectedStats: { rushYd: 1200, rushTD: 10, rec: 40, recYd: 300, recTD: 2, fumLost: 1 } },
  { name: 'Echo Back',     position: 'RB', team: 'BBB', projectedStats: { rushYd: 1100, rushTD: 8, rec: 35, recYd: 280, recTD: 1, fumLost: 1 } }
];

const noNet = async () => { throw new Error('no network in this block'); };
const W = harness(STUB, str => 'ENC', 'k', noNet);
const R = harness(realPool, str => 'ENC', 'k', noNet);

// ── 1. the hand-synced copies still agree with the client ──────────────────
console.log('\nhand-sync with index.html');
{
  const cfgSeg = client.slice(client.indexOf('const DEFAULT_LEAGUE_CONFIG'), client.indexOf('function yardageScore'));
  const num = k => {
    const m = cfgSeg.match(new RegExp('\\b' + k + ':\\s*(-?[\\d.]+)'));
    return m ? parseFloat(m[1]) : null;
  };
  for (const k of Object.keys(W.COLUMN_SCORING)) {
    ok(`scoring.${k} matches the client`, num(k) === W.COLUMN_SCORING[k], `worker ${W.COLUMN_SCORING[k]} vs client ${num(k)}`);
  }
  const curveSeg = client.slice(client.indexOf('const LEAGUE_MARKET_CURVE'), client.indexOf('function calculateMarketValues'));
  for (const pos of Object.keys(W.COLUMN_CURVE)) {
    const m = curveSeg.match(new RegExp('\\b' + pos + ':\\s*\\[([^\\]]*)\\]'));
    const arr = m ? m[1].split(',').map(x => parseInt(x.trim(), 10)) : null;
    ok(`${pos} price curve matches the client`, !!arr && JSON.stringify(arr) === JSON.stringify(W.COLUMN_CURVE[pos]));
  }
  const cb = client.match(/LEAGUE_CURVE_BUDGET\s*=\s*(\d+)/);
  ok('curve budget matches the client', cb && +cb[1] === W.COLUMN_CURVE_BUDGET, `worker ${W.COLUMN_CURVE_BUDGET} vs client ${cb && cb[1]}`);
  const teams = cfgSeg.match(/\bteams:\s*(\d+)/), budget = cfgSeg.match(/\bbudget:\s*(\d+)/);
  ok('default league matches the client', teams && budget && +teams[1] * +budget[1] === W.COLUMN_LEAGUE_BUDGET,
     `worker ${W.COLUMN_LEAGUE_BUDGET} vs client ${teams && teams[1]}x${budget && budget[1]}`);
}

// ── 2. the scoring port is faithful, not just similar ──────────────────────
// The client's own scoreSkillPlayer is lifted and run head-to-head against the
// worker's copy. A drifting port shows up here as a points mismatch.
console.log('\nscoring port matches the client function');
{
  const grab = name => {
    const i = client.indexOf('function ' + name);
    if (i < 0) return '';
    // functions in this file are top-level and end at a line-start brace
    const j = client.indexOf('\n}', i);
    return client.slice(i, j + 2);
  };
  const cfgSeg = client.slice(client.indexOf('const DEFAULT_LEAGUE_CONFIG'), client.indexOf('function yardageScore'));
  const num = k => { const m = cfgSeg.match(new RegExp('\\b' + k + ':\\s*(-?[\\d.]+)')); return m ? parseFloat(m[1]) : 0; };
  const scoring = {};
  for (const k of ['passingYardsPerPoint', 'passingYardsThreshold', 'passingTD', 'passingInt', 'passing2pt',
                   'rushingYardsPerPoint', 'rushingYardsThreshold', 'rushingTD', 'rushing2pt',
                   'receivingYardsPerPoint', 'receivingYardsThreshold', 'receivingTD', 'receiving2pt',
                   'receptionPoints', 'rbReceptionPoints', 'fumbleLost', 'fumble2pt',
                   'individualFumbleRecoveryTD', 'individualKickReturnTD', 'individualPuntReturnTD']) scoring[k] = num(k);
  scoring.passingYardBonuses = []; scoring.rushingYardBonuses = []; scoring.receivingYardBonuses = [];
  scoring.receptionBonuses = []; scoring.rbReceptionBonuses = [];
  const clientScore = new Function(`
    ${grab('yardageScore')}
    ${grab('countScore')}
    ${grab('scoreSkillPlayer')}
    return scoreSkillPlayer;
  `)();
  const cfg = { scoring };
  let worst = 0, worstOf = '';
  for (const p of realPool) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue;
    const d = Math.abs(clientScore(p.projectedStats, p.position, cfg) - W._colScore(p.projectedStats, p.position));
    if (d > worst) { worst = d; worstOf = p.name; }
  }
  ok('every real player scores identically in both copies', worst < 1e-9, `worst ${worst.toFixed(6)} on ${worstOf}`);
}

// ── 3. price curve ─────────────────────────────────────────────────────────
console.log('\nprice curve');
{
  ok('rank 1 RB prices off the top of the curve', W._colPrice('RB', 0) === Math.round(48 * (W.COLUMN_LEAGUE_BUDGET / W.COLUMN_CURVE_BUDGET)));
  // The client does NOT scale the min bid: past the curve the room pays $1
  // whatever the budget (calculateMarketValues). Matching that exactly is the
  // point — the scaled floor used to quote the deep tail at $2 in a $200 league.
  ok('past the end of the curve everyone pays the min bid', W._colPrice('TE', 999) === 1, String(W._colPrice('TE', 999)));
  ok('the floor is never above an in-curve price', W._colPrice('TE', 999) <= W._colPrice('TE', 0));
  ok('prices are monotonically non-increasing down the curve',
     W.COLUMN_CURVE.WR.every((_, i) => i === 0 || W._colPrice('WR', i) <= W._colPrice('WR', i - 1)));
}

// ── 4. gap detection on a stub board ───────────────────────────────────────
console.log('\ngap detection');
{
  ok('no overlay is reported, not faked', W.buildVegasColumn(null).ok === false);
  ok('an empty overlay yields no items', (W.buildVegasColumn({}).items || []).length === 0);

  // Market says the QB3 is really a QB1: +12 TDs is far past any rank threshold.
  const overlay = { [W._oddsNorm('Charlie Passer') + '|QB']: { passTD: 34, passYd: 4300 } };
  const { items } = W.buildVegasColumn(overlay);
  const c = items.find(i => i.name === 'Charlie Passer');
  ok('the moved player is surfaced', !!c, JSON.stringify(items));
  ok('the odds liking them more reads as consensus-too-low', c && c.side === 'under' && c.rankDelta > 0, c && `${c.side}/${c.rankDelta}`);
  ok('the odds-adjusted price is above the consensus price', c && c.priceIronTuna > c.priceConsensus, c && `${c.priceConsensus} -> ${c.priceIronTuna}`);
  ok('the moved stat lines are carried as evidence', c && c.moved.some(m => m.stat === 'passTD' && m.market === 34));
  ok('unpriced players never become column items', !items.some(i => i.name === 'Alpha Passer' && !i.moved));
  ok('every item is a conflict or an agreement', items.every(i => i.kind === 'conflict' || i.kind === 'agree'));

  // Somebody has to fall when somebody rises: the board is re-ranked whole.
  const both = W.buildVegasColumn(overlay).items;
  ok('only market-priced players are reported', both.every(i => i.moved && i.moved.length));
}

// ── 4b. the three boards are the right three ───────────────────────────────
// The shipped Iron Tuna number must sit BETWEEN the consensus and the raw
// market, at the blend weight — that is the column's whole claim about itself.
console.log('\nconsensus vs Iron Tuna vs raw market');
{
  const overlay = { [W._oddsNorm('Charlie Passer') + '|QB']: { passTD: 34, passYd: 4300 } };
  const c = W.buildVegasColumn(overlay).items.find(i => i.name === 'Charlie Passer');
  ok('Iron Tuna sits between the consensus and the market',
     c && c.ptsIronTuna > c.ptsConsensus && c.ptsIronTuna < c.ptsMarket,
     c && `${c.ptsConsensus} / ${c.ptsIronTuna} / ${c.ptsMarket}`);
  ok('...and lands at the published blend weight',
     c && Math.abs(c.ptsIronTuna - (c.ptsConsensus + W.VEGAS_WEIGHT * c.ptsMarket) / (1 + W.VEGAS_WEIGHT)) < 0.6,
     c && String(c.ptsIronTuna));
  ok('the raw market rank is reported alongside', c && c.rankMarket > 0);
  const blended = W._colBlendStats({ passTD: 20, passYd: 4000 }, { passTD: 40 });
  ok('the blend helper mirrors blendProjections', Math.abs(blended.passTD - 35) < 1e-9, String(blended.passTD));
  ok('the blend helper leaves unpriced stats alone', blended.passYd === 4000);
}

// ── 4c. agreement cases are a fallback, never the point ────────────────────
console.log('\nagreement fallback');
{
  // Nudge a top player so the market prices him but lands on the same slot.
  const tiny = { [W._oddsNorm('Alpha Passer') + '|QB']: { passYd: 4010 } };
  const out = W.buildVegasColumn(tiny);
  const a = out.items.find(i => i.name === 'Alpha Passer');
  ok('a market-priced player who does not move becomes an agreement', a && a.kind === 'agree', JSON.stringify(out.items));
  ok('an agreement sits on the same slot in both boards', a && a.rankConsensus === a.rankIronTuna);
  ok('agreements are counted separately from conflicts', out.agreements >= 1 && out.conflicts === out.items.filter(i => i.kind === 'conflict').length);
  ok('conflicts always come before agreements',
     out.items.every((it, i) => it.kind !== 'conflict' || out.items.slice(0, i).every(p => p.kind === 'conflict')));
  ok('agreements never exceed their cap', out.items.filter(i => i.kind === 'agree').length <= W.COLUMN_MAX_AGREE);
}

// ── 5. against the real committed pool ─────────────────────────────────────
console.log('\nreal pool, synthetic market');
{
  // Move one real team's passing game hard and confirm the column notices.
  const target = realPool.find(p => p.position === 'WR' && p.projectedStats.recYd > 900);
  const overlay = { [R._oddsNorm(target.name) + '|WR']: { recYd: target.projectedStats.recYd * 1.35, recTD: (target.projectedStats.recTD || 0) + 5 } };
  const out = R.buildVegasColumn(overlay, { ppg: { [target.team]: 26.4 }, rank: { [target.team]: 3 } });
  const hit = out.items.find(i => i.name === target.name);
  ok('a real player with a big market gap is surfaced', !!hit, target.name);
  ok('money-line context rides along when available', hit && hit.teamImplied === 26.4 && hit.teamRank === 3);
  ok('a full board leaves no room for agreement filler',
     out.conflicts < R.COLUMN_MAX_ITEMS || out.agreements === 0, `${out.conflicts}/${out.agreements}`);
  ok('items never exceed the cap', out.items.length <= R.COLUMN_MAX_ITEMS);
  ok('items are sorted by dollar gap, largest first',
     out.items.every((it, i) => i === 0 || Math.abs(out.items[i - 1].priceDelta) >= Math.abs(it.priceDelta)));
  ok('a null team context does not throw', R.buildVegasColumn(overlay, null).ok === true);
  ok('every item is inside the draftable curve',
     out.items.every(i => i.rankConsensus <= R.COLUMN_CURVE[i.position].length || i.rankIronTuna <= R.COLUMN_CURVE[i.position].length));
  ok('every item clears one of the noise floors',
     out.items.every(i => i.kind === 'agree' || Math.abs(i.rankDelta) >= R.COLUMN_MIN_RANK_GAP || Math.abs(i.priceDelta) >= R.COLUMN_MIN_PRICE_GAP));
  ok('agreement filler is always near the top of its board',
     out.items.filter(i => i.kind === 'agree').every(i => i.rankConsensus <= R.COLUMN_AGREE_MAX_RANK));
}

// ── 6. end to end on the live nflverse lines ───────────────────────────────
console.log('\nlive nflverse pull (network)');
{
  const L = harness(realPool, str => 'ENC', 'k', globalThis.fetch);
  try {
    const ppg = await L.fetchTeamEnvNflverse({});
    const built = L.buildTeamEnvOverlay(ppg);
    ok('the live pull prices a full league', Object.keys(ppg).length >= 16, String(Object.keys(ppg).length));
    const rank = {};
    Object.entries(ppg).sort((a, b) => b[1] - a[1]).forEach(([t], i) => { rank[t] = i + 1; });
    const col = L.buildVegasColumn(built.overlay, { ppg, rank });
    ok('the column builds off real lines', col.ok === true);
    ok('real lines produce at least one disagreement', col.items.length > 0, JSON.stringify(col).slice(0, 200));
    ok('every real item carries its evidence', col.items.every(i => i.moved.length && i.teamImplied != null));
    ok('every real item can compare the two boards on team scoring',
       col.items.every(i => i.teamRank != null && i.teamRankConsensus != null));
    console.log('\n  top disagreements right now:');
    for (const i of col.items.slice(0, 5)) {
      console.log(`    ${i.position}${i.rankConsensus} -> ${i.position}${i.rankIronTuna} (market ${i.position}${i.rankMarket})  ` +
                  `${i.name} (${i.team})  $${i.priceConsensus} -> $${i.priceIronTuna}  ` +
                  `${i.ptsDelta > 0 ? '+' : ''}${i.ptsDelta} pts  ` +
                  `[${i.teamImplied} implied pts/g: odds #${i.teamRank} vs consensus #${i.teamRankConsensus}]`);
    }
  } catch (err) {
    // A blocked or flaky network must not read as a code failure.
    console.log(`  SKIP live pull — ${err.message}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
