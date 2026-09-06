#!/usr/bin/env node
// A team card ranks every player at a position against the rest of that team's
// position group, plan rows included, so the row label is the man's rank on the
// roster: a $1 receiver bought into an empty corps sits at WR3 or WR4 under the
// receivers the plan still buys, and the next buy reshuffles the block so the
// highest projection holds WR1.
//   node tools/test-roster-slots.mjs
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
const fns = closure(['buildTeamRosterGrid']);
const lib = new Function(fns + '\nreturn { buildTeamRosterGrid };')();

// ── a small synthetic league ────────────────────────────────────────────────
const config = {
  teams: 4, budget: 100, format: 'auction',
  roster: { QB: { starters: 1, total: 1 }, WR: { starters: 2, total: 4 } },
  flex: { count: 0, eligible: [] },
  valuation: { minBid: 1 }
};
const players = [
  { id: 'wr1', name: 'WR One', position: 'WR', projectedPoints: 300, auctionValue: 44 },
  { id: 'wr2', name: 'WR Two', position: 'WR', projectedPoints: 260, auctionValue: 33 },
  { id: 'wr3', name: 'WR Three', position: 'WR', projectedPoints: 210, auctionValue: 18 },
  { id: 'wr4', name: 'WR Four', position: 'WR', projectedPoints: 150, auctionValue: 4 },
  { id: 'wr5', name: 'WR Five', position: 'WR', projectedPoints: 120, auctionValue: 1 },
  { id: 'wr6', name: 'WR Six', position: 'WR', projectedPoints: 100, auctionValue: 1 },
  { id: 'qb1', name: 'QB One', position: 'QB', projectedPoints: 380, auctionValue: 30 }
];
const byId = new Map(players.map(p => [p.id, p]));
const team = (picks) => ({
  id: 't1', name: 'Team', isMine: true,
  roster: picks.map(([id, price]) => ({ playerId: id, position: byId.get(id).position, price }))
});
// The plan hands back the starter slots the team has yet to fill, each with the
// player it intends to buy; the card ghosts those rows in.
const plan = (ids) => ({
  remainingStarterSlots: ids.map((id, i) => ({ label: 'WR' + (i + 1), eligible: ['WR'], player: byId.get(id), targetPrice: byId.get(id).auctionValue })),
  benchTargets: []
});
const rows = g => g.WR.map(s => `${s.label}:${s.empty ? '(open)' : s.name}`);
const nameAt = (g, label) => (g.WR.find(s => s.label === label) || {}).name;

// ── 1. a $1 receiver drops under the receivers the plan still buys ──────────
{
  const g = lib.buildTeamRosterGrid(team([['wr5', 1]]), plan(['wr1', 'wr2']), players, config, null);
  ok('the plan’s two starters hold WR1 and WR2', nameAt(g, 'WR1') === 'WR One' && nameAt(g, 'WR2') === 'WR Two', rows(g).join(' | '));
  ok('the $1 buy is slotted at WR3, not WR1', nameAt(g, 'WR3') === 'WR Five', rows(g).join(' | '));
  ok('the bought row is still marked drafted', g.WR.find(s => s.name === 'WR Five').drafted === true);
}
// ── 2. the next buy reshuffles the block by projection ──────────────────────
{
  const g = lib.buildTeamRosterGrid(team([['wr5', 1], ['wr2', 33]]), plan(['wr1']), players, config, null);
  ok('the better receiver takes the higher row', nameAt(g, 'WR1') === 'WR One' && nameAt(g, 'WR2') === 'WR Two' && nameAt(g, 'WR3') === 'WR Five', rows(g).join(' | '));
}
// ── 3. a buy that outscores every plan row holds WR1 ────────────────────────
{
  const g = lib.buildTeamRosterGrid(team([['wr1', 44]]), plan(['wr4', 'wr5']), players, config, null);
  ok('the top receiver bought first holds WR1', nameAt(g, 'WR1') === 'WR One', rows(g).join(' | '));
}
// ── 4. price never sets the row, points do ─────────────────────────────────
{
  const g = lib.buildTeamRosterGrid(team([['wr3', 40], ['wr2', 2]]), plan([]), players, config, null);
  ok('a $2 bargain outranks a $40 reach when he projects higher', nameAt(g, 'WR1') === 'WR Two' && nameAt(g, 'WR2') === 'WR Three', rows(g).join(' | '));
}
// ── 5. owned players are never dropped for plan rows ───────────────────────
{
  const owned = [['wr1', 44], ['wr2', 33], ['wr3', 18], ['wr4', 4], ['wr5', 1]];
  const g = lib.buildTeamRosterGrid(team(owned), plan(['wr6']), players, config, null);
  ok('five receivers against four slots overflow to WR5 rather than vanish', g.WR.length === 5 && rows(g).every(r => !r.endsWith('(open)')), rows(g).join(' | '));
  ok('no plan row squeezes in once the group is full', !g.WR.some(s => s.name === 'WR Six'), rows(g).join(' | '));
  ok('the overflow row is the lowest projection', nameAt(g, 'WR5') === 'WR Five', rows(g).join(' | '));
}
// ── 6. empty slots pad the bottom, never the top ───────────────────────────
{
  const g = lib.buildTeamRosterGrid(team([['wr2', 33]]), { remainingStarterSlots: [], benchTargets: [] }, players, config, null);
  ok('the only receiver owned holds WR1', nameAt(g, 'WR1') === 'WR Two', rows(g).join(' | '));
  ok('the open rows sit below him', g.WR.slice(1).every(s => s.empty) && g.WR.length === 4, rows(g).join(' | '));
}
// ── 7. a hand-dragged order reorders the owned rows only ───────────────────
{
  const t = team([['wr2', 33], ['wr4', 4]]);
  const g = lib.buildTeamRosterGrid(t, plan(['wr1']), players, config, { WR: ['wr4', 'wr2'] });
  ok('the plan row keeps the row projection gave it', nameAt(g, 'WR1') === 'WR One', rows(g).join(' | '));
  ok('the dragged order holds between the two bought receivers', nameAt(g, 'WR2') === 'WR Four' && nameAt(g, 'WR3') === 'WR Two', rows(g).join(' | '));
}
// ── 8. a position with one slot still labels and fills ─────────────────────
{
  const g = lib.buildTeamRosterGrid(team([['qb1', 30]]), { remainingStarterSlots: [], benchTargets: [] }, players, config, null);
  ok('the quarterback lands at QB1', g.QB.length === 1 && g.QB[0].label === 'QB1' && g.QB[0].name === 'QB One');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
