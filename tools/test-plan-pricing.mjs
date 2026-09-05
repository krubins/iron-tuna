#!/usr/bin/env node
// The plan for YOUR team prices its targets at what the room will make you pay,
// the handcuff to a starter you own carries his cover, and a bye you already
// have costs the second hole.
//   node tools/test-plan-pricing.mjs
//
// Pure functions only — no browser, no React, no network. Lifts the real code
// out of index.html by brace matching (see tools/test-curve-budget.mjs).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm; let m;
  while ((m = re.exec(idx))) {
    const pi = idx.indexOf('(', m.index), pe = matchFrom(idx, pi, '(', ')'); if (pe < 0) continue;
    const bi = idx.indexOf('{', pe), be = matchFrom(idx, bi, '{', '}'); if (be < 0) continue;
    if (!decls.has(m[1])) decls.set(m[1], idx.slice(m.index, be + 1));
  }
}
function closure(roots) {
  const picked = new Map(), stack = [...roots];
  while (stack.length) {
    const n = stack.pop(); if (picked.has(n) || !decls.has(n)) continue;
    const body = decls.get(n); picked.set(n, body);
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
    if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; else if (c === ';' && d === 0) return i;
  }
  return -1;
}
const CONSTS = ['BYE_WEEKS', 'BYE_ALIAS', 'CONTEST_SLOPE', 'CONTEST_MIN', 'CONTEST_COMPARABLE',
  'HANDCUFF_MISS_GAMES', 'HANDCUFF_SHARE', 'HANDCUFF_LEAD_RATIO', 'BYE_SECOND_HOLE'];
const consts = CONSTS.map(n => {
  const m = new RegExp('^const\\s+' + n + '\\s*=', 'm').exec(idx);
  if (!m) throw new Error('cannot lift const ' + n);
  return idx.slice(m.index, endOfStatement(idx, m.index) + 1);
}).join('\n');
const fns = closure(['expectedPlanPrices', 'teamNeedsPosition', 'handcuffsOf', 'handcuffDollars', 'byeStackDollars',
  'dollarsPerPoint', 'byeOf', 'buildOptimalPlan', 'switchPrice']);
const lib = new Function(consts + '\n' + fns + '\nreturn { expectedPlanPrices, teamNeedsPosition, handcuffsOf, handcuffDollars, byeStackDollars, dollarsPerPoint, byeOf, buildOptimalPlan, switchPrice };')();

// ── a small synthetic league ────────────────────────────────────────────────
const config = {
  teams: 4, budget: 100, format: 'auction',
  roster: { QB: { starters: 1, total: 2 }, RB: { starters: 2, total: 4 }, WR: { starters: 2, total: 4 }, TE: { starters: 1, total: 2 }, K: { starters: 1, total: 1 }, DEF: { starters: 1, total: 1 } },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  valuation: { minBid: 1 }, strategy: { allocation: 0.55, concentration: 0.5 }
};
let n = 0;
const mk = (pos, team, pts, proj, val) => ({ id: pos + (++n), name: pos + n, position: pos, team, projectedPoints: pts, marketValue: proj, auctionValue: val, inflatedValue: val, vorp: Math.max(0, pts - { QB: 250, RB: 140, WR: 140, TE: 100, K: 100, DEF: 90 }[pos]), replacement: { QB: 250, RB: 140, WR: 140, TE: 100, K: 100, DEF: 90 }[pos] });
const players = [];
// QBs, RBs (with pairs on the same NFL team), WRs, TEs, K, DEF — falling points and prices
[[380, 30, 28], [340, 20, 18], [320, 14, 13], [300, 9, 8], [270, 4, 3], [250, 1, 1]].forEach(([p, m, v]) => players.push(mk('QB', 'T' + n, p, m, v)));
const rbSpec = [[320, 'KC', 45, 44], [300, 'SF', 40, 39], [280, 'DAL', 34, 33], [260, 'PHI', 28, 27], [240, 'DET', 22, 21], [220, 'BUF', 17, 16], [200, 'GB', 12, 11], [190, 'MIA', 9, 8], [180, 'KC', 6, 5], [170, 'SF', 4, 3], [160, 'DAL', 2, 2], [150, 'PHI', 1, 1], [145, 'DET', 1, 1], [140, 'BUF', 1, 1], [130, 'GB', 1, 1], [120, 'MIA', 1, 1]];
rbSpec.forEach(([p, t, m, v]) => players.push(mk('RB', t, p, m, v)));
[[330, 46, 45], [310, 40, 39], [290, 34, 33], [270, 28, 27], [250, 22, 21], [230, 17, 16], [210, 12, 11], [200, 9, 8], [190, 6, 5], [180, 4, 3], [170, 2, 2], [160, 1, 1], [150, 1, 1], [145, 1, 1], [140, 1, 1], [130, 1, 1]].forEach(([p, m, v], i) => players.push(mk('WR', ['NE', 'NYJ', 'LV', 'CIN'][i % 4], p, m, v)));
[[220, 25, 24], [170, 12, 11], [140, 6, 5], [120, 2, 2], [105, 1, 1], [100, 1, 1], [95, 1, 1], [90, 1, 1]].forEach(([p, m, v], i) => players.push(mk('TE', ['SEA', 'ARI'][i % 2], p, m, v)));
[[150, 2, 1], [140, 1, 1], [130, 1, 1], [120, 1, 1]].forEach(([p, m, v]) => players.push(mk('K', 'K' + n, p, m, v)));
[[130, 2, 1], [120, 1, 1], [110, 1, 1], [100, 1, 1]].forEach(([p, m, v]) => players.push(mk('DEF', 'D' + n, p, m, v)));
const spots = 14;
const freshTeams = () => Array.from({ length: 4 }, (_, i) => ({ id: 't' + i, name: 'T' + i, isMine: i === 0, budgetRemaining: 100, spotsRemaining: spots, roster: [] }));
const byId = new Map(players.map(p => [p.id, p]));
function buy(teams, teamIdx, id, price) {
  const p = byId.get(id); const t = teams[teamIdx];
  t.roster.push({ playerId: id, position: p.position, price }); t.budgetRemaining -= price; t.spotsRemaining -= 1;
}
const rb = pos => players.filter(p => p.position === pos);

// ── 1. pre-draft: Proj stands ───────────────────────────────────────────────
{
  const teams = freshTeams();
  const m = lib.expectedPlanPrices(players, teams, teams[0], config, new Set());
  ok('with nothing drafted the expected price of every player is Proj', m.size === 0, String(m.size));
}
// ── 2. teamNeedsPosition reads dedicated and flex slots ──────────────────────
{
  const t = { roster: [] };
  ok('an empty team needs an RB', lib.teamNeedsPosition(t, 'RB', config));
  t.roster = [{ position: 'RB' }, { position: 'RB' }];
  ok('two RBs against two starters: still needs one for the flex', lib.teamNeedsPosition(t, 'RB', config));
  t.roster.push({ position: 'WR' }, { position: 'WR' }, { position: 'TE' }, { position: 'TE' });
  ok('once the flex is taken by a surplus TE, an RB is not needed', !lib.teamNeedsPosition(t, 'RB', config));
  ok('a K is needed until one is rostered', lib.teamNeedsPosition(t, 'K', config) && !lib.teamNeedsPosition({ roster: [{ position: 'K' }] }, 'K', config));
}
// ── 3. rivals who no longer need the position, or cannot pay, lower the expectation ──
{
  const teams = freshTeams();
  const drafted = new Set();
  // Three rivals each fill RB1, RB2 AND the flex with backs — nobody but me needs an RB.
  const rbs = rb('RB');
  [[1, 4], [2, 5], [3, 6]].forEach(([ti, k]) => [k, k + 6].forEach(j => { }));
  let k = 3;
  for (let ti = 1; ti <= 3; ti++) for (let j = 0; j < 3; j++) { const p = rbs[k++]; buy(teams, ti, p.id, p.marketValue); drafted.add(p.id); }
  const m = lib.expectedPlanPrices(players, teams, teams[0], config, drafted);
  const top = rbs[0];
  ok('with every rival full at RB, the top RB is expected to go UNDER Proj', (m.get(top.id) || top.marketValue) < top.marketValue, (m.get(top.id) || top.marketValue) + ' vs ' + top.marketValue);
  ok('the cheap tail is left alone', rbs.filter(p => p.marketValue < 5 && m.has(p.id)).length === 0);
  ok('nothing is moved past the floor or the cap', [...m.entries()].every(([id, v]) => v >= Math.round(byId.get(id).marketValue * 0.9) && v <= Math.round(byId.get(id).marketValue * 1.12)));
}
// ── 4. the plan honours the expected prices ─────────────────────────────────
{
  const teams = freshTeams();
  const drafted = new Set();
  const me = teams[0];
  const exp = new Map(); rb('RB').slice(0, 3).forEach(p => exp.set(p.id, p.marketValue + 15));
  const plain = lib.buildOptimalPlan(me, players, config, drafted, undefined, undefined, undefined, true);
  const dear = lib.buildOptimalPlan(me, players, config, drafted, undefined, undefined, undefined, true, undefined, undefined, { expectedPrice: exp });
  ok('both plans are feasible', plain.feasible && dear.feasible);
  const costOf = pl => pl.remainingStarterSlots.reduce((s, x) => s + x.targetPrice, 0);
  ok('a plan told the elite RBs will cost $15 more prices them so, or avoids them', costOf(dear) !== costOf(plain) || !dear.remainingStarterSlots.some(s => s.player && exp.has(s.player.id)) || dear.remainingStarterSlots.some(s => s.player && exp.has(s.player.id) && s.targetPrice === exp.get(s.player.id)));
  ok('the dearer room never yields MORE points for the same money', dear.starterPoints <= plain.starterPoints + 1e-6, dear.starterPoints + ' vs ' + plain.starterPoints);
}
// ── 5. handcuffs: only the backup to a starter I own, and worth his cover ───
{
  const teams = freshTeams();
  const me = teams[0];
  const rbs = rb('RB');
  const kcLead = rbs.find(p => p.team === 'KC'), kcBup = rbs.filter(p => p.team === 'KC')[1];
  ok('no roster, no handcuffs', lib.handcuffsOf(players, me).size === 0);
  buy(teams, 0, kcLead.id, kcLead.marketValue);
  const hc = lib.handcuffsOf(players, me);
  ok('owning the KC lead makes the KC backup my handcuff, and nobody else', hc.size === 1 && hc.get(kcBup.id) === kcLead);
  const d = lib.handcuffDollars(kcBup, kcLead, players, config, 17);
  ok('the cover is worth real money, on the board\'s own scale', d >= 1 && d <= 15, '$' + d);
  const dpp = lib.dollarsPerPoint(players, config);
  ok('dollars per point is positive and finite', dpp > 0 && Number.isFinite(dpp), String(dpp));
  // A rival owning the lead is not my handcuff.
  const teams2 = freshTeams(); buy(teams2, 1, kcLead.id, kcLead.marketValue);
  ok('a rival\'s starter does not make his backup my handcuff', lib.handcuffsOf(players, teams2[0]).size === 0);
}
// ── 6. byes: the second hole, and only for a slot he shares ─────────────────
{
  const teams = freshTeams();
  const me = teams[0];
  const wrs = players.filter(p => p.position === 'WR');
  const neA = wrs.filter(p => p.team === 'NE');
  ok('a bye week is known for the fixture teams', lib.byeOf('NE') > 0 && lib.byeOf('KC') > 0);
  ok('no roster, no clash', lib.byeStackDollars(neA[1], me, players, config, 17) === 0);
  buy(teams, 0, neA[0].id, neA[0].marketValue);
  const same = lib.byeStackDollars(neA[1], me, players, config, 17);
  ok('a second starter on the same bye costs the second hole (a dollar or so, never negative)', same >= 0 && same <= 3, '$' + same);
  const qb = players.find(p => p.position === 'QB' && lib.byeOf(p.team) === lib.byeOf('NE'));
  if (qb) ok('a QB on the same bye is not a clash for a WR slot', lib.byeStackDollars(qb, me, players, config, 17) === 0);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
