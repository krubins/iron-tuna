#!/usr/bin/env node
// VALUE is re-solved on the board that is LEFT once the draft is under way.
//   node tools/test-live-value.mjs
//
// THE DEFECT THIS EXISTS FOR: the pre-draft VALUE column was built once, from the
// whole pool and the whole league's starter demand, and during the draft it was
// only ever SCALED by one inflation factor. The gaps between players — the
// thing a replacement level exists to set — never moved. With the top twelve
// running backs gone the sheet still priced RB13 against a replacement who had
// been off the board for an hour. `revalueRemaining` runs the same pipeline over
// the undrafted pool, the money still in the room and the roster spots still
// open, so the replacement level, VORP and the dollar share are all live.
//
// Pure functions only — no browser, no React, no network. Lifts the real code
// out of index.html by brace matching, the same way tools/test-curve-budget.mjs
// does, so it can never test a re-implementation.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

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
const decls = new Map();
{
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(idx))) {
    const pi = idx.indexOf('(', m.index), pe = matchFrom(idx, pi, '(', ')');
    if (pe < 0) continue;
    const bi = idx.indexOf('{', pe), be = matchFrom(idx, bi, '{', '}');
    if (be < 0) continue;
    if (!decls.has(m[1])) decls.set(m[1], idx.slice(m.index, be + 1));
  }
}
function closure(roots) {
  const picked = new Map(), stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (picked.has(n) || !decls.has(n)) continue;
    const body = decls.get(n);
    picked.set(n, body);
    for (const id of body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) if (decls.has(id) && !picked.has(id)) stack.push(id);
  }
  return [...picked.values()].join('\n');
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
    if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--;
    else if (c === ';' && d === 0) return i;
  }
  return -1;
}
const CONST_NAMES = ['VEGAS_DEFAULT_W', 'LAST_YEAR_QB_STATS', 'LAST_YEAR_RB_STATS', 'LAST_YEAR_WR_STATS',
  'LAST_YEAR_TE_STATS', 'LAST_YEAR_K_STATS', 'LAST_YEAR_DEF_STATS', 'DEFAULT_LEAGUE_CONFIG',
  'LEAGUE_CURVE_BUDGET', 'SUPERFLEX_QB_CURVE', 'LEAGUE_MARKET_CURVE', 'POS_RELIABILITY', 'RELIABILITY_RANK_DECAY', 'RELIABILITY_RANK_FLOOR'];
const consts = CONST_NAMES.map(n => {
  const m = new RegExp('^const\\s+' + n + '\\s*=', 'm').exec(idx);
  if (!m) throw new Error('cannot lift const ' + n);
  return idx.slice(m.index, endOfStatement(idx, m.index) + 1);
}).join('\n');
const fns = closure(['scorePlayer', 'applyVegasWeight', 'vegasWeightOf', 'normalizeToLastYear',
  'marketCurveOrder', 'buildValuations', 'renormalizeToBudget', 'attachProvisionalAdp', 'applyCustomRanks',
  'totalLeagueBudget', 'totalRosterSpots', 'applyInflation', 'revalueRemaining', 'remainingDemand',
  'applyValueAdjust', 'valueAdjustMultipliers', 'applyPositionalDemand']);
ok('the live re-solve exists in index.html', decls.has('revalueRemaining') && decls.has('remainingDemand'));

const pool = (() => {
  const st = worker.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  const seg = worker.slice(st, worker.indexOf('\n];', st));
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();
ok('the committed projections were read', pool.length > 300, String(pool.length));

const sim = new Function('POOL', 'TEAMS', 'BUDGET', 'SCRIPT', `
${consts}
${fns}
const config = JSON.parse(JSON.stringify(DEFAULT_LEAGUE_CONFIG));
config.teams = TEAMS; config.budget = BUDGET;
const players = POOL.map(p => ({
  id: (p.name + '-' + p.position + '-' + p.team).replace(/\\s+/g, '_'),
  name: p.name, position: p.position, team: p.team,
  projectedStats: p.projectedStats, vegas: null,
  projectedPoints: 0, auctionValue: 0, inflatedValue: 0, vorp: 0, replacement: 0
}));
const source = applyVegasWeight(players, vegasWeightOf(config));
const scored = normalizeToLastYear(source.map(p => ({ ...p, projectedPoints: scorePlayer(p, config) })), config);
const marketOrder = marketCurveOrder(scored);
const base = attachProvisionalAdp(renormalizeToBudget(buildValuations(applyCustomRanks(scored, {}), config, marketOrder).players, config), config);
const spots = totalRosterSpots(config);
const teams = Array.from({ length: TEAMS }, (_, i) => ({ id: 't' + i, name: 'T' + i, isMine: i === 0, budgetRemaining: BUDGET, spotsRemaining: spots, roster: [] }));
const drafted = new Set();
const history = [];
const byPos = {};
base.forEach(p => (byPos[p.position] = byPos[p.position] || []).push(p));
Object.values(byPos).forEach(a => a.sort((x, y) => y.projectedPoints - x.projectedPoints));
function pick(p, teamIdx, price) {
  const t = teams[teamIdx];
  price = price == null ? p.marketValue : price;
  t.roster.push({ playerId: p.id, position: p.position, price });
  t.budgetRemaining -= price; t.spotsRemaining -= 1;
  drafted.add(p.id); history.push({ playerId: p.id, teamId: t.id, price });
}
function state(valueAdjust) {
  const adjusted = applyValueAdjust(base, valueAdjust || {}, config);
  const inflated = applyInflation(adjusted, drafted, teams, config, valueAdjustMultipliers(base, valueAdjust || {}));
  return applyPositionalDemand(inflated, teams, config, drafted);
}
return SCRIPT({ base, byPos, teams, drafted, pick, state, config, remainingDemand, spots });
`);

// ── 1. nothing drafted: the live figure IS the pre-draft figure ─────────────
sim(pool, 12, 200, ({ base, state }) => {
  const s = state();
  const diff = s.filter(p => p.inflatedValue !== p.auctionValue);
  ok('with nothing drafted every live VALUE equals the pre-draft VALUE', diff.length === 0, diff.slice(0, 3).map(p => p.name + ' ' + p.auctionValue + '->' + p.inflatedValue).join(', '));
});

// ── 2. the money still adds up, and the column still never rises ─────────────
sim(pool, 12, 200, ({ byPos, teams, pick, state, config, remainingDemand }) => {
  // Round one: each team buys one of the twelve best players overall at Proj.
  const top = [...byPos.RB.slice(0, 6), ...byPos.WR.slice(0, 6)];
  top.forEach((p, i) => pick(p, i));
  const s = state();
  const undrafted = s.filter(p => !teams.some(t => t.roster.some(r => r.playerId === p.id)));
  const dem = remainingDemand(teams, config);
  const bp = {};
  undrafted.forEach(p => (bp[p.position] = bp[p.position] || []).push(p));
  Object.values(bp).forEach(a => a.sort((x, y) => y.projectedPoints - x.projectedPoints));
  let total = 0;
  Object.entries(dem.totals).forEach(([pos, n]) => (bp[pos] || []).slice(0, n).forEach(p => { total += p.inflatedValue; }));
  const left = teams.reduce((a, t) => a + t.budgetRemaining, 0);
  ok('after a round the live VALUE of the still-rostered pool totals the money still in the room', total === left, total + ' vs ' + left);
  const rises = [];
  Object.entries(bp).forEach(([pos, arr]) => arr.forEach((p, i) => { if (i && p.inflatedValue > arr[i - 1].inflatedValue) rises.push(pos + ' ' + p.name); }));
  ok('live VALUE never rises reading down a position', rises.length === 0, rises.slice(0, 3).join(', '));
  ok('every live VALUE is a whole dollar at or above the min bid', undrafted.every(p => Number.isInteger(p.inflatedValue) && p.inflatedValue >= config.valuation.minBid));
});

// ── 3. a position that is HOARDED re-prices; the replacement level moved ─────
sim(pool, 12, 200, ({ byPos, pick, state }) => {
  const before = state();
  const bv = new Map(before.map(p => [p.id, p.inflatedValue]));
  // Six teams take three running backs each — 18 of the best RBs — at Proj.
  // Each of those teams has filled both RB starters AND its flex with a back,
  // so the league's remaining RB starter demand is the other six teams' twelve
  // slots and the replacement level is now set on the thinned board.
  byPos.RB.slice(0, 18).forEach((p, i) => pick(p, i % 6));
  const after = state();
  const av = new Map(after.map(p => [p.id, p.inflatedValue]));
  const rb = byPos.RB.slice(18, 30);
  const rbUp = rb.filter(p => av.get(p.id) > bv.get(p.id)).length;
  ok('with 18 RBs hoarded by six teams, the next twelve RBs are worth MORE than they were', rbUp >= 9, rbUp + ' of 12 rose');
  const rb19 = byPos.RB[18];
  ok('RB19 in particular rose', av.get(rb19.id) > bv.get(rb19.id), rb19.name + ' ' + bv.get(rb19.id) + ' -> ' + av.get(rb19.id));
  ok('the RB replacement level is reported live and fell', after.find(p => p.id === rb19.id).liveReplacement < before.find(p => p.id === rb19.id).replacement,
    after.find(p => p.id === rb19.id).liveReplacement + ' vs ' + before.find(p => p.id === rb19.id).replacement);
  // Receivers' demand did not change; on average they went the other way or held.
  const wr = byPos.WR.slice(0, 24);
  const wrMean = wr.reduce((a, p) => a + (av.get(p.id) - bv.get(p.id)), 0) / wr.length;
  const rbMean = rb.reduce((a, p) => a + (av.get(p.id) - bv.get(p.id)), 0) / rb.length;
  ok('the hoarded position gained relative to the untouched one', rbMean > wrMean, 'RB ' + rbMean.toFixed(2) + ' vs WR ' + wrMean.toFixed(2));
});

// ── 3b. a position that is taken exactly to demand keeps its replacement ─────
sim(pool, 12, 200, ({ byPos, pick, state }) => {
  const before = state();
  byPos.RB.slice(0, 12).forEach((p, i) => pick(p, i));
  const after = state();
  const rb13 = byPos.RB[12];
  ok('one RB a team leaves the RB replacement level where it was', after.find(p => p.id === rb13.id).liveReplacement === before.find(p => p.id === rb13.id).replacement);
});

// ── 4. picks AT the predicted price barely move anyone ──────────────────────
sim(pool, 12, 200, ({ byPos, pick, state }) => {
  const before = state();
  const bv = new Map(before.map(p => [p.id, p.inflatedValue]));
  // A balanced first round: two players a position, spread across teams, at Proj.
  const rnd = [...byPos.QB.slice(0, 2), ...byPos.RB.slice(0, 4), ...byPos.WR.slice(0, 4), ...byPos.TE.slice(0, 2)];
  rnd.forEach((p, i) => pick(p, i));
  const after = state();
  const av = new Map(after.map(p => [p.id, p.inflatedValue]));
  const watch = [...byPos.RB.slice(4, 24), ...byPos.WR.slice(4, 24)];
  const mean = watch.reduce((a, p) => a + (av.get(p.id) - bv.get(p.id)), 0) / watch.length;
  ok('a balanced round at the predicted prices leaves the next tier within a couple of dollars on average', Math.abs(mean) <= 2.5, 'mean shift ' + mean.toFixed(2));
});

// ── 5. the reader's own tier adjustment survives the re-solve ───────────────
sim(pool, 12, 200, ({ byPos, pick, state }) => {
  byPos.WR.slice(0, 6).forEach((p, i) => pick(p, i));
  const plain = state();
  const tuned = state({ RB: { all: 1, elite: 1.2, mid: 1, repl: 1 } });
  const pv = new Map(plain.map(p => [p.id, p.inflatedValue]));
  const rb = byPos.RB.slice(0, 6);
  const up = rb.filter(p => tuned.find(x => x.id === p.id).inflatedValue > pv.get(p.id)).length;
  ok('"value elite RBs 20% more" still lifts the elite RBs after picks have been logged', up >= 5, up + ' of 6');
});

// ── 6. a room that overpays: less money left, lower live VALUE overall ───────
sim(pool, 12, 200, ({ byPos, pick, state }) => {
  const before = state();
  const bv = new Map(before.map(p => [p.id, p.inflatedValue]));
  byPos.RB.slice(0, 6).forEach((p, i) => pick(p, i, Math.round(p.marketValue * 1.5)));
  byPos.WR.slice(0, 6).forEach((p, i) => pick(p, i + 6, Math.round(p.marketValue * 1.5)));
  const after = state();
  const av = new Map(after.map(p => [p.id, p.inflatedValue]));
  const watch = [...byPos.RB.slice(6, 30), ...byPos.WR.slice(6, 30)];
  const mean = watch.reduce((a, p) => a + (av.get(p.id) - bv.get(p.id)), 0) / watch.length;
  ok('when the room overpays early, the money left prices the next tier LOWER', mean < 0, 'mean shift ' + mean.toFixed(2));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
