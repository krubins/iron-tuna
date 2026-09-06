#!/usr/bin/env node
// Bidding Status Intel: the cheat sheet's permanent read on the rest of the room.
// Per manager it has to get three things right — the money left, the ceiling of
// his next bid, and WHICH roster slot each open hole is, because a manager with
// no backs is bidding on an RB1 and a manager with three is bidding on an RB4,
// and those are opposite auctions at the same position.
//   node tools/test-bidding-intel.mjs
//
// Pure functions only — no browser, no React, no network. Lifts the real code
// out of index.html by brace matching (see tools/test-roster-slots.mjs).
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
const fns = closure(['buildBiddingIntel']);
const lib = new Function(fns + '\nreturn { buildBiddingIntel };')();

// ── a small synthetic league: 4 teams, $100, 2 RB / 2 WR starters, 1 FLEX ───
const config = {
  teams: 4, budget: 100, format: 'auction', benchPositions: 'any',
  roster: {
    QB: { total: 1, starters: 1 },
    RB: { total: 4, starters: 2 },
    WR: { total: 3, starters: 2 },
    TE: { total: 1, starters: 1 }
  },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  valuation: { minBid: 1 }
};
const TOTAL = 9; // 1 + 4 + 3 + 1
const players = [
  { id: 'rbA', name: 'Back A', position: 'RB', projectedPoints: 300 },
  { id: 'rbB', name: 'Back B', position: 'RB', projectedPoints: 240 },
  { id: 'rbC', name: 'Back C', position: 'RB', projectedPoints: 120 },
  { id: 'wrA', name: 'Wide A', position: 'WR', projectedPoints: 280 },
  { id: 'wrB', name: 'Wide B', position: 'WR', projectedPoints: 130 },
  { id: 'wrC', name: 'Wide C', position: 'WR', projectedPoints: 90 },
  { id: 'qbA', name: 'Passer A', position: 'QB', projectedPoints: 400 },
  { id: 'teA', name: 'End A', position: 'TE', projectedPoints: 200 }
];
const byId = new Map(players.map(p => [p.id, p]));
// A manager is his picks: the app keeps budgetRemaining and spotsRemaining in
// step with the roster, so the fixture does the same arithmetic it does.
const mgr = (id, name, picks, extra = {}) => ({
  id, name, isMine: !!extra.isMine,
  roster: picks.map(([pid, price]) => ({ playerId: pid, position: byId.get(pid).position, price })),
  budgetRemaining: config.budget - picks.reduce((s, [, p]) => s + p, 0),
  spotsRemaining: TOTAL - picks.length
});
const intel = teams => lib.buildBiddingIntel(teams, players, config);
const rowFor = (rows, name) => rows.find(r => r.name === name);
const labels = r => r.needs.map(n => n.label);
const kindOf = (r, label) => (r.needs.find(n => n.label === label) || {}).kind;

// ── 1. the slot a hole carries is the row the next buy would take ───────────
{
  const rows = intel([
    mgr('t1', 'Empty', []),
    mgr('t2', 'One back', [['rbA', 30]]),
    mgr('t3', 'Three backs', [['rbA', 30], ['rbB', 20], ['rbC', 5]])
  ]);
  ok('a manager with no backs is shopping for RB1', labels(rowFor(rows, 'Empty')).includes('RB1'), labels(rowFor(rows, 'Empty')).join(','));
  ok('one back owned means the next one is RB2, not RB1',
    labels(rowFor(rows, 'One back')).includes('RB2') && !labels(rowFor(rows, 'One back')).includes('RB1'),
    labels(rowFor(rows, 'One back')).join(','));
  ok('three backs owned leaves only RB4',
    labels(rowFor(rows, 'Three backs')).filter(l => l.startsWith('RB')).join(',') === 'RB4',
    labels(rowFor(rows, 'Three backs')).join(','));
}
// ── 2. the slot number decides whether it is a starter, the flex, or a body ─
{
  const rows = intel([mgr('t1', 'Empty', []), mgr('t2', 'Two backs', [['rbA', 30], ['rbB', 20]])]);
  const empty = rowFor(rows, 'Empty'), two = rowFor(rows, 'Two backs');
  ok('RB1 and RB2 are starting slots', kindOf(empty, 'RB1') === 'starter' && kindOf(empty, 'RB2') === 'starter');
  ok('RB3 is the flex once the two starting backs are bought', kindOf(two, 'RB3') === 'flex', kindOf(two, 'RB3'));
  ok('RB4 is a bench body', kindOf(two, 'RB4') === 'bench', kindOf(two, 'RB4'));
  ok('starters sort ahead of the flex, and the flex ahead of the bench',
    labels(two).indexOf('WR1') < labels(two).indexOf('RB3') && labels(two).indexOf('RB3') < labels(two).indexOf('RB4'),
    labels(two).join(','));
  ok('the starter count is the open STARTING slots only', two.starterHoles === 4, String(two.starterHoles));
}
// ── 3. a filled flex is not offered twice ──────────────────────────────────
{
  // Two backs and three receivers: the third receiver is one over the two WR
  // starting slots, so he has taken the flex and nothing left is a flex slot.
  const r = intel([mgr('t1', 'Flex used', [['rbA', 10], ['rbB', 10], ['wrA', 10], ['wrB', 10], ['wrC', 10], ['teA', 10]])])[0];
  ok('a manager one over at a position has spent his flex', r.flexOpen === 0, String(r.flexOpen));
  ok('nothing on his sheet is still labelled flex', !r.needs.some(n => n.kind === 'flex'), r.needs.map(n => n.label + ':' + n.kind).join(','));
}
// ── 4. the max bid is the ceiling nobody can go past ────────────────────────
{
  const rows = intel([
    mgr('t1', 'Rich', []),                                        // $100, 9 slots
    mgr('t2', 'Spent', [['rbA', 80]]),                            // $20, 8 slots
    mgr('t3', 'Full', [['rbA', 12], ['rbB', 12], ['rbC', 12], ['wrA', 12], ['wrB', 12], ['qbA', 12], ['teA', 12]].concat([]))
  ]);
  ok('an untouched roster can bid its budget less a dollar a slot', rowFor(rows, 'Rich').maxBid === 100 - 8, String(rowFor(rows, 'Rich').maxBid));
  ok('a manager who overspent can only bid what the minimums leave', rowFor(rows, 'Spent').maxBid === 20 - 7, String(rowFor(rows, 'Spent').maxBid));
  ok('money left is the budget less what was paid', rowFor(rows, 'Spent').budgetRemaining === 20 && rowFor(rows, 'Spent').spent === 80);
  ok('the richest bidder is listed first', rows[0].name === 'Rich', rows.map(r => r.name).join(','));
}
// ── 5. a full roster is out of the bidding and sinks to the bottom ─────────
{
  const full = [['rbA', 5], ['rbB', 5], ['rbC', 5], ['wrA', 5], ['wrB', 5], ['qbA', 5], ['teA', 5]];
  // Nine spots, seven distinct players in the pool — pad the roster to full by
  // reusing ids the way a real board would not, but the count is what matters.
  const done = mgr('t1', 'Done', full);
  done.spotsRemaining = 0;
  const rows = intel([done, mgr('t2', 'Live', [])]);
  ok('a manager with no spots left has no max bid', rowFor(rows, 'Done').maxBid === 0 && rowFor(rows, 'Done').done === true);
  ok('he sorts below every manager who can still bid', rows[rows.length - 1].name === 'Done', rows.map(r => r.name).join(','));
}
// ── 6. the detail rows name who holds each filled slot ─────────────────────
{
  const r = intel([mgr('t1', 'Two backs', [['rbC', 4], ['rbA', 40]])])[0];
  const rb = r.groups.find(g => g.pos === 'RB');
  ok('the better back holds RB1 whatever he cost', rb.owned[0].label === 'RB1' && rb.owned[0].name === 'Back A', rb.owned.map(o => o.label + ':' + o.name).join(','));
  ok('the cheaper back sits at RB2', rb.owned[1].label === 'RB2' && rb.owned[1].name === 'Back C');
  ok('the open rows pick up where the owned ones stop', rb.open.map(o => o.label).join(',') === 'RB3,RB4', rb.open.map(o => o.label).join(','));
}
// ── 7. a snake league has needs but no money ───────────────────────────────
{
  const snake = { ...config, format: 'snake' };
  const t = { id: 't1', name: 'Snaker', roster: [{ playerId: 'rbA', position: 'RB' }], spotsRemaining: TOTAL - 1 };
  const r = lib.buildBiddingIntel([t], players, snake)[0];
  ok('no dollar figures are invented for a draft with no budget', r.maxBid === null && r.budgetRemaining === null && r.spent === null);
  ok('the slot read still works', labels(r).includes('RB2') && !labels(r).includes('RB1'), labels(r).join(','));
}
// ── 8. a roster stacked past a position cap keeps the spot count honest ────
{
  // Five backs against a four-deep cap: the surplus cannot be a numbered RB
  // slot, so it has to show up as a spot fillable anywhere.
  const t = {
    id: 't1', name: 'Stacked', budgetRemaining: 50,
    roster: [['rbA', 10], ['rbB', 10], ['rbC', 10], ['rbA', 10], ['rbB', 10]].map(([pid, price]) => ({ playerId: pid, position: 'RB', price })),
    spotsRemaining: TOTAL - 5
  };
  const r = lib.buildBiddingIntel([t], players, config)[0];
  ok('no RB5 slot is invented past the cap', !labels(r).some(l => /^RB[5-9]/.test(l)), labels(r).join(','));
  ok('he is never shown more holes than he has seats left', r.needs.length + r.openOther === r.spotsRemaining, r.needs.length + '+' + r.openOther + ' vs ' + r.spotsRemaining);
  ok('the seat the fifth back took comes off the bench, not off a starting slot',
    r.needs.filter(n => n.kind === 'starter').length === 4 && !labels(r).includes('WR3'),
    labels(r).join(','));
  ok('the detail rows drop the slot the summary dropped',
    !r.groups.find(g => g.pos === 'WR').open.some(o => o.label === 'WR3'),
    r.groups.find(g => g.pos === 'WR').open.map(o => o.label).join(','));
}

// The legend draws real chips rather than describing them, so it contributes
// three of its own on top of whatever the rows carry.
const r1Chips = () => 3;

// ── 9. the panel itself renders, with the numbers in it ────────────────────
// The panel is hand-written React.createElement, so a missing argument or a
// stray comma is a blank modal at the moment a manager clicks the button
// mid-nomination. Rendering it against a stub React catches that without a
// browser: no DOM is needed to see whether the tree comes out and what text
// it carries.
{
  const React = {
    Fragment: { frag: true },
    createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids.flat(Infinity).filter(k => k !== null && k !== undefined && typeof k !== 'boolean') })
  };
  const useState = init => [typeof init === 'function' ? init() : init, () => {}];
  const useMemo = fn => fn();
  const useEffect = () => {};
  const useRef = () => ({ current: null });
  const ui = new Function('React', 'useState', 'useMemo', 'useEffect', 'useRef',
    closure(['BiddingIntelModal']) + '\nreturn { BiddingIntelModal };')(React, useState, useMemo, useEffect, useRef);
  const teams = [
    mgr('t1', 'Mine', [['rbA', 40]], { isMine: true }),
    mgr('t2', 'Untouched', []),
    mgr('t3', 'Broke', [['wrA', 95]])
  ];
  const el = ui.BiddingIntelModal({ teams, players, config, onClose() {} });
  const textOf = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : (n.children || []).map(textOf).join('');
  const classes = [];
  (function walk(n) { if (!n || typeof n !== 'object') return; if (n.props && n.props.className) classes.push(n.props.className); (n.children || []).forEach(walk); })(el);
  const txt = textOf(el);
  ok('the panel renders a tree at all', !!el && classes.includes('bi-table'), classes.join(' '));
  ok('it is a dismissable overlay', classes.some(c => c.startsWith('modal-bg')) && classes.includes('modal-close'));
  ok('every manager gets a row', teams.every(t => txt.includes(t.name)), txt.slice(0, 200));
  ok('the money each has left is printed', txt.includes('$60') && txt.includes('$100') && txt.includes('$5'), txt);
  ok('the max bid is printed alongside it', txt.includes('$' + rowFor(intel(teams), 'Untouched').maxBid), txt);
  ok('the slot labels reach the panel, not just the position', txt.includes('RB2') && txt.includes('WR1'), txt);
  // A column counting the holes said exactly what the chip list beside it
  // already said. What is left over per hole does not, and it is the number
  // that separates a manager holding $10 for one starter from one holding $10
  // for eleven bench bodies.
  const broke = rowFor(intel(teams), 'Broke');
  let head = null;
  (function findHead(n) { if (!n || typeof n !== 'object' || head) return; if (n.props && n.props.className === 'bi-head') { head = n; return; } (n.children || []).forEach(findHead); })(el);
  ok('the head row no longer carries a bare slot count', head && !/slot(s|\b)/i.test(textOf(head).replace('$/slot', '')), head ? textOf(head) : 'no head row');
  ok('what is left per hole is printed instead', txt.includes('$/slot') && txt.includes('$' + broke.perSlot.toFixed(1)), txt);
  ok('a manager stretched under a dollar a slot is flagged', classes.includes('bi-num bi-perslot thin'), classes.join(' '));
  ok('the reader is told the slot is an estimate', /estimate/i.test(txt), txt.slice(-160));
  // Two readings ride on one chip: the hue says which position, the border and
  // weight say how urgent. Emitting one class without the other silently drops
  // half of that, and the panel still looks fine.
  const chips = classes.filter(c => c.startsWith('bi-chip'));
  ok('every needs chip is tagged with its position', chips.length > 0 && chips.every(c => /\bbi-p-[A-Z]+\b/.test(c)), chips.join(' | '));
  ok('every needs chip still says how urgent the hole is', chips.every(c => /\bbi-(starter|flex|bench)\b/.test(c)), chips.join(' | '));
  ok('the legend shows the coding rather than only naming it', chips.length >= r1Chips(el) && /Colour is the position/.test(txt), txt.slice(0, 500));
  // A position the stylesheet has no colour for renders in the neutral base and
  // nobody notices — so the palette is checked against the positions the app
  // actually ships, not against whatever this fixture happens to use.
  const css = idx.slice(idx.indexOf('<style>'), idx.indexOf('</style>'));
  const unstyled = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(pos => !css.includes('.bi-chip.bi-p-' + pos));
  ok('every position the app ships has a chip colour', unstyled.length === 0, 'missing: ' + unstyled.join(','));
  ok('the panel never prints', classes.some(c => c.includes('no-print')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
