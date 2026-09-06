#!/usr/bin/env node
// Positional scarcity in the bid itself: the cliff premium on You $, and the
// alert that fires before you are the last team bidding into a run.
//   node tools/test-cliff-premium.mjs
//
// THE CASE THIS EXISTS FOR. Six quarterbacks stand above a real drop and twelve
// teams still have to start one. Four of those teams are going to miss, so all
// six go above value and the team that waits pays the most for the worst of
// them. The old detector could not see it at all: it only counted a cliff when
// ONE OR TWO players stood above it, so a tier six deep was invisible, and You $
// — an indifference price that assumes the plan can be rebuilt from the board at
// the prices on the board — quoted a ceiling that loses every auction in a run.
//
// The fix is one reading used in three places: how tight the stack above the
// cliff is against the room that still has to buy from it. It sets the premium
// on You $, the loudness of the banner, and the words both of them use.
//
// Pure functions only — no browser, no React, no network. Lifts the real code
// out of index.html by brace matching (the harness is tools/test-plan-pricing.mjs).
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
const ROOTS = ['scarcityFlags', 'positionDemand', 'scarcityPremium', 'cliffSqueeze', 'cliffWatch', 'cliffWatchText'];
const lib = new Function(closure(ROOTS) + '\nreturn { ' + ROOTS.join(', ') + ' };')();
const { scarcityFlags, positionDemand, scarcityPremium, cliffSqueeze, cliffWatch, cliffWatchText } = lib;

// ── a league with a six-deep quarterback tier and a cliff behind it ─────────
const config = {
  teams: 12, budget: 200, format: 'auction',
  roster: { QB: { starters: 1, total: 2 }, RB: { starters: 2, total: 4 }, WR: { starters: 2, total: 4 }, TE: { starters: 1, total: 2 }, K: { starters: 1, total: 1 }, DEF: { starters: 1, total: 1 } },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  valuation: { minBid: 1 }
};
// QB1-6 are four points apart, then a 30-point drop, then a flat tail.
const QB_PTS = [340, 336, 332, 328, 324, 320, 290, 286, 282, 278, 274, 270, 266, 262];
const qbs = QB_PTS.map((pts, i) => ({ id: 'QB' + (i + 1), name: 'QB ' + (i + 1), position: 'QB', projectedPoints: pts, auctionValue: 30 - i, marketValue: 30 - i }));
// A smooth position, so nothing here depends on the rest of the board.
const rbs = Array.from({ length: 30 }, (_, i) => ({ id: 'RB' + (i + 1), name: 'RB ' + (i + 1), position: 'RB', projectedPoints: 300 - i * 6, auctionValue: 40 - i, marketValue: 40 - i }));
const players = [...qbs, ...rbs];
const room = (qbOwners = 0) => Array.from({ length: 12 }, (_, i) => ({
  id: 't' + i, name: 'Team ' + i, isMine: i === 0,
  roster: i < qbOwners ? [{ playerId: 'QB' + (i + 1), position: 'QB' }] : []
}));
const NONE = new Set();

console.log('\nthe demand side: who still has to buy one');
{
  ok('every team that has not started one counts', positionDemand('QB', room(0), config) === 12);
  ok('a team that already has its starter drops out', positionDemand('QB', room(5), config) === 7);
  ok('no room to price against falls back to the league shape',
     positionDemand('QB', null, config) === 12 && positionDemand('RB', null, config) === 24);
  ok('a position nobody starts has no demand', positionDemand('QB', room(0), { roster: {} }) === 0);
}

console.log('\nthe cliff a six-deep tier makes');
{
  const flags = scarcityFlags(players, NONE, config, room(0));
  const qbFlags = QB_PTS.map((_, i) => flags.get('QB' + (i + 1))).filter(Boolean);
  // This is the whole point of the change. The old window was two.
  ok('all six above the drop are flagged, not just the last one or two', qbFlags.length === 6, String(qbFlags.length));
  ok('the seventh, below the drop, is not', !flags.get('QB7'));
  ok('each flag carries the stack, the drop and the room',
     qbFlags.every(f => f.count === 6 && f.gapPts === 30 && f.demand === 12));
  ok('a smooth position is not a cliff', !flags.get('RB1') && !flags.get('RB2'));

  // Six for four buyers is depth, not scarcity. Same board, smaller room.
  const small = { ...config, teams: 4 };
  const flags4 = scarcityFlags(players, NONE, small, room(0).slice(0, 4));
  ok('six above a drop in a four-team room is not scarce', !flags4.get('QB1'));

  // Handed no room at all, the detector keeps its old blind window of two.
  ok('without a room the old two-player window still applies', !scarcityFlags(players, NONE, config).get('QB1'));

  // Nobody left needing one means nothing left to be scarce for.
  ok('a position every team has already filled raises no flag',
     !scarcityFlags(players, NONE, config, room(12)).get('QB1'));
}

console.log('\nnested cliffs: the drop a player would actually fall off');
{
  // The live board's real shape: one quarterback 43 points clear of everyone,
  // and behind him a tier of five above a smaller drop. Stopping at the first
  // cliff reported "one left" and priced the five behind him at nothing.
  const pts = [380, 340, 336, 332, 328, 324, 300, 296, 292, 288, 284, 280];
  const pool = pts.map((v, i) => ({ id: 'N' + (i + 1), name: 'N ' + (i + 1), position: 'QB', projectedPoints: v }));
  const f = scarcityFlags(pool, NONE, config, room(0));
  ok('the man at the top is priced against his own 40-point drop',
     f.get('N1') && f.get('N1').count === 1 && Math.round(f.get('N1').gapPts) === 40);
  ok('the tier behind him is priced against the drop underneath IT',
     ['N2', 'N3', 'N4', 'N5', 'N6'].every(id => f.get(id) && f.get(id).count === 6 && Math.round(f.get(id).gapPts) === 24),
     JSON.stringify(f.get('N2')));
  ok('and it is a smaller premium than the one at the top',
     scarcityPremium(f.get('N2'), 200) < scarcityPremium(f.get('N1'), 200));
  ok('nobody below the second drop is flagged', !f.get('N7'));
  // The banner speaks for the most binding cliff and lists everyone above it.
  const row = cliffWatch(pool, room(0), config, NONE, room(0)[0]).find(r => r.pos === 'QB');
  ok('the row never claims a count it cannot name', row.names.length === row.count);
}

console.log('\nthe premium rises as the tier drains');
{
  const P = (count, demand, gap = 30) => scarcityPremium({ count, gapPts: gap, demand }, 200);
  ok('six left for twelve teams already pays something', P(6, 12) > 0, String(P(6, 12)));
  ok('three left for nine teams pays more than six left for twelve', P(3, 9) > P(6, 12), `${P(3, 9)} vs ${P(6, 12)}`);
  ok('the last one for seven teams pays the most', P(1, 7) > P(3, 9), `${P(1, 7)} vs ${P(3, 9)}`);
  // Draining the tier with the room unchanged has to move the same way.
  ok('at a fixed room, every player who leaves raises the premium',
     P(6, 12) < P(4, 12) && P(4, 12) < P(2, 12) && P(2, 12) < P(1, 12));
  ok('a bigger drop is worth more than a small one', P(6, 12, 40) > P(6, 12, 8));
  ok('a stack as deep as the room is barely a premium', P(12, 12) < P(1, 12) / 2);
  ok('it never runs away with the budget', P(1, 12, 100000) <= 30);
  ok('it scales with the budget, not with dollars',
     scarcityPremium({ count: 1, gapPts: 30, demand: 12 }, 400) > scarcityPremium({ count: 1, gapPts: 30, demand: 12 }, 200));
  // The colour path calls this with the old shape and must be untouched by all
  // of the above (tools/test-board-colour.mjs pins the rest of that contract).
  // Given the board's own dollars per point, the premium IS the price of the
  // drop, weighted by the squeeze. No tuned constant, and it moves with the
  // board rather than with the size of the wallet.
  ok('the drop has a price: points times dollars-per-point, times the squeeze',
     scarcityPremium({ count: 1, gapPts: 40, demand: 12 }, 200, 0.5) === 20 &&
     scarcityPremium({ count: 6, gapPts: 40, demand: 12 }, 200, 0.5) === Math.round(40 * 0.5 * cliffSqueeze(6, 12)));
  ok('a cheap board pays less for the same drop than an expensive one',
     scarcityPremium({ count: 1, gapPts: 40, demand: 12 }, 200, 0.2) < scarcityPremium({ count: 1, gapPts: 40, demand: 12 }, 200, 0.5));
  ok('the cap still holds when the drop is enormous',
     scarcityPremium({ count: 1, gapPts: 4000, demand: 12 }, 200, 0.5) === 30);
  ok('the demand-free shape prices exactly as it always did',
     scarcityPremium({ count: 1, gapPts: 30 }, 200) === Math.min(30, Math.round(200 * 0.10 * 1.2)) &&
     scarcityPremium({ count: 3, gapPts: 30 }, 200) === Math.min(30, Math.round(200 * 0.06 * 1.2)));

  ok('the squeeze is bounded at both ends',
     cliffSqueeze(1, 12) === 1 && cliffSqueeze(20, 12) === 0 && cliffSqueeze(6, 12) > 0 && cliffSqueeze(6, 12) < 1);
  ok('no room means treat it as tight', cliffSqueeze(6, 0) === 1);
}

console.log('\nthe alert, and how loud it is');
{
  const rows = cliffWatch(players, room(0), config, NONE, room(0)[0]);
  const qb = rows.find(r => r.pos === 'QB');
  ok('the six-deep tier raises a row', !!qb);
  ok('the row states the stack, the room and the money', qb.count === 6 && qb.demand === 12 && qb.prem > 0);
  ok('it names the players above the drop', qb.names.length === 6);
  ok('six for twelve is a watch, not yet an emergency', qb.level === 'watch', qb && qb.level);

  // Four positions are thin on any untouched board. Four pulsing red rows there
  // teach the reader to ignore the banner by the time one of them means
  // something, so the top step waits for picks to start coming off the board.
  const preDraft = cliffWatch(players, room(0), config, NONE, room(0)[0]).find(r => r.pos === 'QB');
  ok('an untouched board never pulses red', preDraft.level !== 'critical', preDraft.level);

  // Same tier, five picks later: four gone, four teams suited up.
  const drafted = new Set(['QB1', 'QB2', 'QB3', 'QB4']);
  const late = cliffWatch(players, room(4), config, drafted, room(4)[4]);
  const qbLate = late.find(r => r.pos === 'QB');
  ok('two left for eight teams is critical', qbLate && qbLate.level === 'critical', qbLate && qbLate.level);
  ok('and it is worth more money than it was', qbLate.prem > qb.prem, `${qbLate.prem} vs ${qb.prem}`);

  // A manager who already has his quarterback is past this cliff.
  const mine = { id: 't0', name: 'Mine', isMine: true, roster: [{ playerId: 'QB1', position: 'QB' }] };
  const past = cliffWatch(players, room(0), config, NONE, mine).find(r => r.pos === 'QB');
  ok('a position you already start is information, not an alarm', past && past.need === false && past.level === 'info');

  ok('the loudest row sorts first', (() => {
    const r = cliffWatch(players, room(4), config, drafted, room(4)[4]);
    return r.length < 2 || ['critical', 'urgent', 'watch', 'info'].indexOf(r[0].level) <= ['critical', 'urgent', 'watch', 'info'].indexOf(r[1].level);
  })());

  const t = cliffWatchText(qb);
  ok('the copy counts the tier and the buyers', /6 QBs left/.test(t.head) && /12 teams still need one/.test(t.head), t.head);
  ok('the copy says what to do about it, in dollars', /Bid up to \$\d+ over Value/.test(t.body), t.body);
  ok('the copy for a filled slot stands the reader down', /past this one/.test(cliffWatchText(past).body));
}

console.log('\nwhere the premium actually lands');
{
  // The bid, not just the colour. These are the three lines that make the You
  // column carry the cliff, and each of them has been reverted before.
  ok('the personalization reads the flags against the real room',
     /scarcityFlags\(valuedPlayers, new Set\(draftHistory\.map\(d => d\.playerId\)\), config, teams\)/.test(idx));
  ok('You is lifted by the premium, capped by what you can still spend',
     /cliffPrem = scarcityPremium\(_fl, config\.budget \|\| 200, _dpp\);[\s\S]{0,120}pv = Math\.min\(maxBid, pv \+ cliffPrem\)/.test(idx));
  ok('the bid prices the drop against the board\'s own dollars per point',
     /const _dpp = dollarsPerPoint\(valuedPlayers, config\);/.test(idx));
  ok('only a position with a starting slot still open pays it',
     /if \(_fl && needEligPos\.has\(p\.position\)\) \{/.test(idx));
  ok('the row carries the premium so the cell can explain it', /cliffPrem: cliffPrem \|\| 0,/.test(idx));
  ok('the You cell marks and explains a lifted bid',
     /p\.cliffPrem > 0 \? ' cy-cliff' : ''/.test(idx) && /Includes a \$\$\{p\.cliffPrem\} cliff premium/.test(idx));
  ok('the banner is rendered on the draft board, not just defined',
     /React\.createElement\(CliffWatch, \{/.test(idx) && /function CliffWatch\(\{/.test(idx));
  ok('dismissing a row is keyed to the count, so a thinner tier speaks again',
     /r\.pos \+ ':' \+ r\.count/.test(idx));
  ok('the coach line measures the tier against the room too',
     /const demand = positionDemand\(pos, teams, config\);/.test(idx));
  // A ceiling that is not a ceiling is worse than no ceiling at all.
  ok('the premium is still capped at 15% of the budget in the source',
     /Math\.min\(budget \* 0\.15, Math\.round\(budget \* rate \* g\)\)/.test(idx));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
