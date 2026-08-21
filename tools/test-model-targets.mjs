#!/usr/bin/env node
// Regression test for the "Target players by position" row on the draft board.
//   node tools/test-model-targets.mjs
//
// THE BUG THIS EXISTS FOR: a model's target row listed the same man twice —
// "WR Tetairoa McMillan $20, George Pickens $10, George Pickens $10" — because
// bestStarterSet rebuilt its roster from breadcrumbs that later players had
// already overwritten. The knapsack VALUE was right (it only ever counted
// distinct players); the walk back through who/back was not, so from three
// slots up it could hand one player two of them. The plan then double-counted
// his points, so the model's headline projection was for a lineup that could
// not be fielded.
//
// Pure node — no browser, no npm deps. The planner functions are lifted out of
// index.html by name so this test tracks the shipped source, not a copy.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Slice a top-level `function name(...) { ... }` out of the page by brace count.
function lift(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error('index.html no longer defines ' + name);
  let i = SRC.indexOf('{', start), depth = 0, inStr = null, inLine = false, inBlock = false;
  for (; i < SRC.length; i++) {
    const c = SRC[i], n = SRC[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return SRC.slice(start + 1, i + 1);
  }
  throw new Error('unbalanced braces reading ' + name);
}

const NAMES = ['totalRosterSpots', 'starterSlotDefs', 'assignDraftedToStarters', 'bestStarterSet', 'buildOptimalPlan', 'buildModel'];
const planner = new Function(NAMES.map(lift).join('\n\n') + `\nreturn { ${NAMES.join(', ')} };`)();
const { bestStarterSet, buildModel } = planner;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ---- 1. the solver itself, on the smallest board that used to break it ------
// Three WR-eligible slots, $38. The only legal trio inside budget is
// w1 + w3 + w5 (252 pts, $38); the old walk back answered w2 + w5 + w5 (254),
// which is two of the same man and a dollar over what he costs once.
{
  const pool = [
    { id: 'w2', price: 23, projectedPoints: 110 },
    { id: 'w1', price: 17, projectedPoints: 90 },
    { id: 'w3', price: 19, projectedPoints: 90 },
    { id: 'w5', price: 2, projectedPoints: 72 }
  ].map(p => ({ ...p, name: p.id, position: 'WR' }));
  const slots = [
    { label: 'WR1', basePos: 'WR', eligible: ['WR'] },
    { label: 'WR2', basePos: 'WR', eligible: ['WR'] },
    { label: 'FLEX', basePos: 'FLEX', eligible: ['WR'] }
  ];
  const res = bestStarterSet(slots, { WR: pool }, new Set(), p => p.price, 38, Infinity);
  const ids = res ? Object.values(res.picks).map(p => p.id) : [];
  ok('solver fills every slot', ids.length === 3, 'got ' + ids.length);
  ok('solver never repeats a player', new Set(ids).size === ids.length, ids.join(','));
  ok('solver still finds the best legal trio', ids.slice().sort().join(',') === 'w1,w3,w5', ids.join(','));
  ok('solver stays inside budget', res && res.cost <= 38, res && String(res.cost));
}

// ---- 2. the whole plan, over a board shaped like a real one ----------------
const config = {
  teams: 12,
  budget: 200,
  roster: {
    QB: { starters: 1, total: 2 }, RB: { starters: 2, total: 4 }, WR: { starters: 2, total: 5 },
    TE: { starters: 1, total: 2 }, K: { starters: 1, total: 2 }, DEF: { starters: 1, total: 2 }
  },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  valuation: { minBid: 1 },
  strategy: { allocation: 0.55, concentration: 0.5 },
  format: 'auction'
};

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const players = [];
for (const [pos, n, topPts, topVal] of [['QB', 32, 380, 30], ['RB', 70, 330, 62], ['WR', 90, 320, 55], ['TE', 30, 240, 34], ['K', 20, 150, 2], ['DEF', 20, 160, 4]]) {
  for (let i = 0; i < n; i++) {
    const f = i / n;
    players.push({
      id: `${pos}${i}`, name: `${pos} Player ${i}`, position: pos,
      projectedPoints: Math.round(topPts * (1 - f * 0.75) * (0.9 + rnd() * 0.2)),
      marketValue: Math.max(1, Math.round(topVal * Math.pow(1 - f, 2.4) * (0.85 + rnd() * 0.3)))
    });
  }
}
const SPOTS = Object.values(config.roster).reduce((s, c) => s + c.total, 0);

// Exactly what the target row reads: every starter slot plus every bench target.
function targetRow(plan) {
  const out = [];
  (plan.remainingStarterSlots || []).forEach(s => { if (s.player) out.push(s.player.id); });
  (plan.benchTargets || []).forEach(b => out.push(b.playerId));
  return out;
}

const MODELS = ['ideal', 'balanced', 'heroRB', 'heroWR', 'zeroRB', 'robustWR', 'eliteTE'];
let repeats = 0, unfielded = 0, plans = 0, worst = '';
for (let t = 0; t < 120; t++) {
  const shuffled = players.slice().sort(() => rnd() - 0.5);
  const drafted = new Set();
  const nDrafted = Math.floor(rnd() * 140);
  for (let i = 0; i < nDrafted; i++) drafted.add(shuffled[i].id);
  const roster = [];
  let spent = 0;
  const nMine = Math.floor(rnd() * 6);
  for (let i = 0; i < nMine; i++) {
    const p = shuffled[i];
    if (!p) break;
    roster.push({ playerId: p.id, position: p.position, price: Math.max(1, Math.round(p.marketValue * (0.8 + rnd() * 0.5))) });
    spent += roster[roster.length - 1].price;
  }
  const myTeam = { roster, budgetRemaining: Math.max(SPOTS - roster.length, config.budget - spent), spotsRemaining: SPOTS - roster.length };
  const model = MODELS[t % MODELS.length];
  const plan = buildModel(model, myTeam, players, config, drafted, {}, new Set());
  if (!plan) continue;
  plans++;
  const ids = targetRow(plan);
  if (new Set(ids).size !== ids.length) {
    repeats++;
    if (!worst) worst = `${model} trial ${t}: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(',')}`;
  }
  // A player bought twice would also inflate the model's projected points.
  const starterIds = (plan.remainingStarterSlots || []).filter(s => s.player).map(s => s.player.id);
  if (new Set(starterIds).size !== starterIds.length) unfielded++;
}
ok('plans were built', plans > 100, String(plans));
ok('no model targets the same player twice', repeats === 0, worst);
ok('no starting lineup double-counts a player', unfielded === 0, String(unfielded));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
