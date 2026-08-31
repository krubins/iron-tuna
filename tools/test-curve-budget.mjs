#!/usr/bin/env node
// Does the cheat sheet's money add up? Every dollar column has to be denominated
// in the SAME league budget, or two columns on one row describe two leagues.
//   node tools/test-curve-budget.mjs
//
// THE BUG THIS EXISTS FOR: `LEAGUE_CURVE_BUDGET = 1440` claims the market curve
// is drawn at 12 teams x $120. It was not. Summed over a full board — 12 x the
// 16 roster spots, min bid past the end of each position's curve — the 1-QB set
// came to $1298, ~10% light. Inside the app that was invisible: renormalizeToBudget
// stretches Proj back to the league's budget every render. But /it-league.js and
// the worker's /api/vegas-column price straight off the RAW curve with no such
// step, so a front-page story quoted WR1 at $42 while the reader's own sheet read
// $50 — which is the one failure this codebase keeps coming back to fix.
//
// So this pins both halves: the raw curve totals the budget it names, and the
// rendered PROJ and VALUE columns still total the league's budget once the whole
// pipeline has run over the committed projections.
//
// Pure functions only — no browser, no React, no network. It lifts the real
// declarations out of index.html by brace-matching so it can never drift from a
// re-implementation of them.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const itLeague = fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── lift the real declarations out of index.html ───────────────────────────
// Brace matching that respects strings, template literals and comments, so a `}`
// inside a message or a regex cannot end a function early.
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
// Everything the lifted roots reach, pulled in transitively.
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
// Declaration order matters — DEFAULT_LEAGUE_CONFIG reads VEGAS_DEFAULT_W.
const CONST_NAMES = ['VEGAS_DEFAULT_W', 'LAST_YEAR_QB_STATS', 'LAST_YEAR_RB_STATS', 'LAST_YEAR_WR_STATS',
  'LAST_YEAR_TE_STATS', 'LAST_YEAR_K_STATS', 'LAST_YEAR_DEF_STATS', 'DEFAULT_LEAGUE_CONFIG',
  'LEAGUE_CURVE_BUDGET', 'SUPERFLEX_QB_CURVE', 'LEAGUE_MARKET_CURVE', 'POSITION_PREDICTABILITY', 'POS_RELIABILITY'];
const consts = CONST_NAMES.map(n => {
  const m = new RegExp('^const\\s+' + n + '\\s*=', 'm').exec(idx);
  if (!m) throw new Error('cannot lift const ' + n);
  return idx.slice(m.index, endOfStatement(idx, m.index) + 1);
}).join('\n');
const fns = closure(['scorePlayer', 'applyVegasWeight', 'vegasWeightOf', 'normalizeToLastYear',
  'marketCurveOrder', 'buildValuations', 'applyPredictability', 'renormalizeToBudget',
  'attachProvisionalAdp', 'applyCustomRanks', 'totalLeagueBudget', 'totalRosterSpots']);

// The committed projections, straight out of the worker — the same pool the app ships.
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

const run = new Function('POOL', 'TEAMS', 'BUDGET', 'SFLEX', `
${consts}
${fns}
const config = JSON.parse(JSON.stringify(DEFAULT_LEAGUE_CONFIG));
config.teams = TEAMS; config.budget = BUDGET;
if (SFLEX) config.flex.eligible = config.flex.eligible.concat(['QB']);
const players = POOL.map(p => ({
  id: (p.name + '-' + p.position + '-' + p.team).replace(/\\s+/g, '_'),
  name: p.name, position: p.position, team: p.team,
  projectedStats: p.projectedStats, vegas: null,
  projectedPoints: 0, auctionValue: 0, inflatedValue: 0, vorp: 0, replacement: 0
}));
const source = applyVegasWeight(players, vegasWeightOf(config));
const scored = normalizeToLastYear(source.map(p => ({ ...p, projectedPoints: scorePlayer(p, config) })), config);
const marketOrder = marketCurveOrder(scored);
const ranked = applyCustomRanks(scored, {});
const rendered = attachProvisionalAdp(
  renormalizeToBudget(applyPredictability(buildValuations(ranked, config, marketOrder).players, config), config), config);

// The rostered pool: exactly what renormalizeToBudget itself calls rostered.
const byPos = {};
rendered.forEach(p => (byPos[p.position] = byPos[p.position] || []).push(p));
Object.keys(byPos).forEach(pos => byPos[pos].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)));
const rostered = [];
Object.entries(config.roster).forEach(([pos, c]) => (byPos[pos] || []).slice(0, c.total * config.teams).forEach(p => rostered.push(p)));
const sum = (l, k) => l.reduce((s, p) => s + (p[k] || 0), 0);

// The RAW curve, priced the way it-league.js and the worker price it: no renormalisation.
const rawCurveTotal = (() => {
  const scale = totalLeagueBudget(config) / LEAGUE_CURVE_BUDGET, MIN = config.valuation.minBid;
  let total = 0;
  Object.entries(config.roster).forEach(([pos, c]) => {
    const curve = LEAGUE_MARKET_CURVE[pos] || [];
    // Past the curve the room pays the min bid unscaled, same as every
    // shipped copy of this arithmetic (calculateMarketValues, _colPrice,
    // it-league's price()).
    for (let i = 0; i < c.total * config.teams; i++) total += i < curve.length ? Math.max(MIN, Math.round(curve[i] * scale)) : MIN;
  });
  return total;
})();
// Read down each position and check no price ever climbs.
const rises = [];
['marketValue', 'auctionValue'].forEach(key => Object.entries(byPos).forEach(([pos, list]) => {
  list.filter(p => rostered.includes(p)).forEach((p, i, arr) => {
    if (i && p[key] > arr[i - 1][key]) rises.push(key + ' ' + pos + (i + 1) + ' ' + p.name + ' $' + p[key] + ' > $' + arr[i - 1][key]);
  });
}));
// The top of each position's rendered PROJ column, for parity checks against
// the published copies.
const top = {};
Object.keys(byPos).forEach(pos => top[pos] = byPos[pos].slice(0, 12).map(p => p.marketValue));
return {
  rises,
  curveBudget: LEAGUE_CURVE_BUDGET,
  leagueBudget: totalLeagueBudget(config),
  spots: totalRosterSpots(config) * config.teams,
  rosteredCount: rostered.length,
  rawCurveTotal,
  proj: sum(rostered, 'marketValue'),
  value: sum(rostered, 'auctionValue'),
  tail: rendered.length - rostered.length,
  wholeProj: sum(rendered, 'marketValue'),
  wholeValue: sum(rendered, 'auctionValue'),
  curve: LEAGUE_MARKET_CURVE,
  top
};
`);

// ── 1. the raw curve adds up to the budget it names ────────────────────────
console.log('the curve totals the budget it is drawn at');
const base = run(pool, 12, 120);
ok('LEAGUE_CURVE_BUDGET is 12 teams x $120', base.curveBudget === 1440 && base.leagueBudget === 1440);
ok('a full board is 192 roster spots', base.spots === 192 && base.rosteredCount === 192);
ok('the raw curve totals exactly the curve budget',
   base.rawCurveTotal === base.curveBudget, `$${base.rawCurveTotal} vs $${base.curveBudget}`);

// ── 2. every position's curve still falls ──────────────────────────────────
console.log('\nshape');
for (const [pos, c] of Object.entries(base.curve)) {
  ok(`${pos} never rises down the curve`, c.every((v, i) => !i || v <= c[i - 1]));
  ok(`${pos} never prices a slot under the min bid`, c.every(v => v >= 1));
}

// ── 3. the rendered columns total the league budget ────────────────────────
// EXACTLY, not nearly. renormalizeToBudget hands out whole dollars by largest
// remainder for this reason: rounding each price on its own leaks a few dollars
// off every board, and a column that does not add up is a column telling a room
// to spend less than it has.
console.log('\nthe rendered PROJ and VALUE columns');
for (const [teams, budget] of [[12, 120], [12, 200], [10, 200], [12, 300], [14, 100]]) {
  const r = run(pool, teams, budget);
  ok(`${teams}x$${budget}: PROJ totals the league budget exactly`, r.proj === r.leagueBudget, `$${r.proj} vs $${r.leagueBudget}`);
  ok(`${teams}x$${budget}: VALUE totals the league budget exactly`, r.value === r.leagueBudget, `$${r.value} vs $${r.leagueBudget}`);
  // Past the roster the board is padding, and it can only ever push the total UP.
  ok(`${teams}x$${budget}: the undrafted tail only adds`,
     r.wholeProj >= r.proj && r.wholeValue >= r.value);
  // The allocation above hands a spare dollar to whoever the floor cost most, so
  // it is the step most able to invert two adjacent prices. It must not.
  ok(`${teams}x$${budget}: neither column rises as you read down a position`,
     r.rises.length === 0, r.rises.slice(0, 3).join('; '));
}

// ── 4. all three copies of the curve agree ─────────────────────────────────
// tools/test-worker-column.mjs and tools/test-it-league.mjs each check their own
// mirror against the client. This checks that a re-cut reached all three at once,
// which is the way this particular constant gets broken.
console.log('\nthe three hand-synced copies');
const arrOf = (src, marker, pos, end) => {
  const seg = src.slice(src.indexOf(marker), end ? src.indexOf(end, src.indexOf(marker)) : undefined);
  const m = seg.match(new RegExp('\\b' + pos + ':\\s*\\[([^\\]]*)\\]'));
  return m ? m[1].split(',').map(s => +s.trim()) : null;
};
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const client = base.curve[pos];
  const w = arrOf(worker, 'const COLUMN_CURVE = {', pos, 'const COLUMN_CURVE_BUDGET');
  const l = arrOf(itLeague, 'var CURVE = {', pos, 'var MIN_BID');
  ok(`${pos}: _worker.js matches index.html`, JSON.stringify(w) === JSON.stringify(client), JSON.stringify(w));
  ok(`${pos}: it-league.js matches index.html`, JSON.stringify(l) === JSON.stringify(client), JSON.stringify(l));
}
for (const [name, src, re] of [['_worker.js', worker, /COLUMN_CURVE_BUDGET\s*=\s*(\d+)/], ['it-league.js', itLeague, /CURVE_BUDGET\s*=\s*(\d+)/]]) {
  const m = src.match(re);
  ok(`${name} carries the same curve budget`, m && +m[1] === base.curveBudget, m && m[1]);
}
// The superflex QB curve now has a mirror in it-league.js (its price() swaps
// curves for a saved QB-premium league). Same drift risk, same pin. The worker
// deliberately has no copy: its board is the site's 1-QB default league.
{
  const sfOf = src => {
    const m = src.match(/SUPERFLEX_QB_CURVE\s*=\s*\[([^\]]*)\]/);
    return m ? m[1].split(',').map(s => +s.trim()) : null;
  };
  const clientSf = sfOf(idx), libSf = sfOf(itLeague);
  ok('superflex QB: it-league.js matches index.html',
     !!clientSf && JSON.stringify(libSf) === JSON.stringify(clientSf), JSON.stringify(libSf));
}

// ── 5. a superflex reader's it-league quotes land on the app's SF board ────
// it-league.js swaps to SUPERFLEX_QB_CURVE and renormalises when the saved
// league is QB-premium. The app renormalises by largest remainder, the library
// by a flat factor, so parity is within a dollar — the bug this guards against
// was a whole QB tier ($47 quoted against a $69 sheet).
console.log('\nsuperflex parity with the app');
{
  const sf = run(pool, 12, 200, true);
  const store = { iron_tuna_draft_state_v2: JSON.stringify({ config: {
    teams: 12, budget: 200, format: 'auction',
    flex: { count: 1, eligible: ['RB', 'WR', 'TE', 'QB'] } } }) };
  const loadLib = st => {
    const w = { localStorage: { getItem: k => st[k] || null, setItem() {} } };
    new Function('window', 'var localStorage=window.localStorage;' + itLeague + ';return 0;')(w);
    return w.ITLeague;
  };
  const L = loadLib(store);
  let worst = 0, worstAt = '';
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    for (let i = 0; i < 8; i++) {
      const d = Math.abs(sf.top[pos][i] - L.price(pos, i));
      if (d > worst) { worst = d; worstAt = pos + (i + 1) + ' app $' + sf.top[pos][i] + ' vs lib $' + L.price(pos, i); }
    }
  }
  ok('every top-8 price lands within $1 of the app’s SF board', worst <= 1, worstAt);
  ok('the QB premium is real money, not a rounding artefact',
     L.price('QB', 0) >= loadLib({}).price('QB', 0) + 10,
     `SF $${L.price('QB', 0)} vs 1-QB $${loadLib({}).price('QB', 0)}`);
  // The qbIsPremium trap the client documents: QB listed as flex-ELIGIBLE with
  // a flex count of zero is a 1-QB league, and so is a plain saved league.
  const trap = loadLib({ iron_tuna_draft_state_v2: JSON.stringify({ config: {
    teams: 12, budget: 200, format: 'auction',
    flex: { count: 0, eligible: ['RB', 'WR', 'TE', 'QB'] } } }) });
  ok('flex-eligible with zero flex slots stays on the 1-QB curve',
     trap.price('QB', 0) === loadLib({}).price('QB', 0),
     String(trap.price('QB', 0)));
  // Straight 2-QB (no superflex slot) is just as QB-hungry and gets the curve.
  const twoQb = loadLib({ iron_tuna_draft_state_v2: JSON.stringify({ config: {
    teams: 12, budget: 200, format: 'auction',
    roster: { QB: { total: 3, starters: 2 } } } }) });
  ok('a straight 2-QB league is priced as QB-premium',
     twoQb.price('QB', 0) > loadLib({}).price('QB', 0) + 10,
     String(twoQb.price('QB', 0)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
