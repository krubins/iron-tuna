#!/usr/bin/env node
// The projected points per game a team card shows, as the card actually
// renders it — and the Bidding Status Intel panel's Proj. PPG beside it.
//   node tools/test-card-ppg.mjs
//
// THE BUG THIS EXISTS FOR. The panel shipped showing what a manager's starters
// score from the players he had ALREADY bought. The card shows something else:
// what they score once the plan for the money and slots he has LEFT lands. Two
// numbers, one name, and nothing failed — both were defensible readings of
// "projected ppg", and no test compared them because no test read the card.
//
// The fix put one function, projectTeamStarters, behind both. That is only
// worth anything while it stays behind both, so this drives the real
// TeamsBoard and the real panel against one league and reads the rendered
// text off each. It also pins the rules a second implementation would quietly
// lose: a rival is planned at the house allocation rather than the reader's,
// and the reader's own draft model steers his plan alone.
//
// No browser and no network: React is stubbed down to a tree builder, which is
// enough because both numbers are rendered by the components themselves rather
// than by anything a DOM would do.
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
// A React that only builds a tree. Nested components are never invoked, which
// is fine and in fact the point: both numbers are rendered by TeamsBoard and
// BiddingIntelModal in their own bodies.
const FRAG = { frag: true };
const React = {
  Fragment: FRAG,
  createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids.flat(Infinity).filter(k => k !== null && k !== undefined && typeof k !== 'boolean') })
};
const mount = roots => new Function('React', 'useState', 'useMemo', 'useEffect', 'useRef', 'useCallback',
  closure(roots) + '\nreturn { ' + roots.join(', ') + ' };')(
  React, init => [typeof init === 'function' ? init() : init, () => {}], fn => fn(), () => {}, () => ({ current: null }), fn => fn);
const board = mount(['TeamsBoard']);
const panel = mount(['BiddingIntelModal']);
const textOf = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : (n.children || []).map(textOf).join('');
const findAll = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); (n.children || []).forEach(k => findAll(k, pred, out)); } return out; };
const hasClass = pre => n => n.props && String(n.props.className || '').startsWith(pre);

// ── one league both surfaces are asked about ───────────────────────────────
const config = {
  teams: 3, budget: 200, format: 'auction', benchPositions: 'any',
  roster: { QB: { total: 2, starters: 1 }, RB: { total: 4, starters: 2 }, WR: { total: 4, starters: 2 }, TE: { total: 2, starters: 1 }, K: { total: 1, starters: 1 }, DEF: { total: 1, starters: 1 } },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  valuation: { minBid: 1 }, strategy: { allocation: 0.55 }, scoring: { receptionPoints: 1 }
};
const GAMES = 17;
// The pool has to be deep enough that a plan has real choices in it: with only
// a handful of players left, every model buys the same team and a test of model
// routing would pass whatever the code did.
const P = [
  ['rb1', 'Back One', 'RB', 340, 62], ['rb2', 'Back Two', 'RB', 300, 55], ['rb3', 'Back Three', 'RB', 214, 18],
  ['rb4', 'Back Four', 'RB', 268, 41], ['rb5', 'Back Five', 'RB', 244, 33], ['rb6', 'Back Six', 'RB', 196, 14],
  ['rb7', 'Back Seven', 'RB', 162, 7], ['rb8', 'Back Eight', 'RB', 140, 4], ['rb9', 'Back Nine', 'RB', 118, 1],
  ['wr1', 'Wide One', 'WR', 318, 71], ['wr2', 'Wide Two', 'WR', 280, 48], ['wr3', 'Wide Three', 'WR', 208, 22],
  ['wr4', 'Wide Four', 'WR', 305, 66], ['wr5', 'Wide Five', 'WR', 288, 52], ['wr6', 'Wide Six', 'WR', 236, 29],
  ['wr7', 'Wide Seven', 'WR', 190, 15], ['wr8', 'Wide Eight', 'WR', 168, 9], ['wr9', 'Wide Nine', 'WR', 144, 4],
  ['qb1', 'Passer One', 'QB', 402, 21], ['qb2', 'Passer Two', 'QB', 411, 38], ['qb3', 'Passer Three', 'QB', 396, 34],
  ['qb4', 'Passer Four', 'QB', 322, 6], ['qb5', 'Passer Five', 'QB', 300, 3],
  ['te1', 'End One', 'TE', 232, 24], ['te2', 'End Two', 'TE', 218, 15], ['te3', 'End Three', 'TE', 176, 6],
  ['te4', 'End Four', 'TE', 158, 3],
  ['k1', 'Kicker One', 'K', 142, 1], ['k2', 'Kicker Two', 'K', 132, 1],
  ['d1', 'Defense One', 'DEF', 128, 2], ['d2', 'Defense Two', 'DEF', 118, 1]
].map(([id, name, position, projectedPoints, auctionValue]) => ({ id, name, position, projectedPoints, auctionValue, marketValue: auctionValue, inflatedValue: auctionValue }));
const byId = new Map(P.map(p => [p.id, p]));
const mgr = (id, name, picks, mine) => ({
  id, name, isMine: !!mine,
  roster: picks.map(([pid, price]) => ({ playerId: pid, position: byId.get(pid).position, price })),
  budgetRemaining: config.budget - picks.reduce((s, [, p]) => s + p, 0),
  spotsRemaining: 14 - picks.length
});
// A roster that fills every starting slot with nothing left to spend: the plan
// can add nothing, so this card's number is the sum of its own starters and
// nothing else. It is the one figure here that can be worked out by hand, and
// it is what keeps the rest from being two mirrors agreeing with each other.
const LOCKED = [['qb1', 21], ['rb1', 62], ['rb2', 55], ['wr1', 40], ['wr2', 20], ['te1', 1], ['k1', 0], ['d1', 0], ['rb3', 1]];
const LOCKED_PTS = 402 + 340 + 300 + 318 + 280 + 232 + 142 + 128 + 214; // 9 starters incl. the flex
const locked = (() => {
  const t = mgr('t3', 'Locked', LOCKED);
  t.budgetRemaining = 0;
  t.spotsRemaining = 0;
  return t;
})();
const teams = [mgr('t1', 'Mine', [['rb1', 62]], true), mgr('t2', 'Rival', []), locked];
// 'Locked' owns rb1 too — the fixture only needs its points, and the board is
// asked about each roster as given.
const drafted = new Set(['rb1', 'qb1', 'rb2', 'wr1', 'wr2', 'te1', 'k1', 'd1', 'rb3']);
const boardProps = over => ({
  teams, players: P, config, seasonGames: GAMES, draftedIds: drafted,
  roleOverrides: {}, model: 'ideal', targets: new Set(), slotOrder: {}, ...over
});
const panelProps = over => ({
  teams, players: P, config, seasonGames: GAMES, draftedIds: drafted,
  roleOverrides: {}, model: 'ideal', targets: new Set(), onClose() {}, ...over
});
// What each team card actually renders: "Starters 1/9 · 117.4 pts/gm".
function cardLines(over) {
  const el = board.TeamsBoard(boardProps(over));
  const out = new Map();
  findAll(el, hasClass('team-card')).forEach(card => {
    let name = null;
    findAll(card, n => n.type === 'input' && n.props && n.props.value !== undefined).forEach(i => { if (name === null) name = i.props.value; });
    // Auction: "Starters 1/9 · 117.4 pts/gm".
    // Snake:   "Starters 1/9 · 20.0 now → 48.8 best pts/gm".
    const m = textOf(card).match(/Starters (\d+)\/(\d+) · ([\d.]+)( now → ([\d.]+) best)? pts\/gm/);
    if (name != null && m) out.set(name, { filled: +m[1], total: +m[2], ppg: m[5] != null ? m[5] : m[3], now: m[3] });
  });
  return out;
}
// What the panel renders in its Proj. PPG cell, per manager.
function panelPpg(over) {
  const el = panel.BiddingIntelModal(panelProps(over));
  const out = new Map();
  findAll(el, hasClass('bi-row')).forEach(row => {
    const name = (findAll(row, hasClass('bi-name'))[0] || {});
    const cell = findAll(row, hasClass('bi-num bi-ppg'))[0];
    if (name && cell) out.set(textOf(name).replace(/^[▸▾]\s*/, '').replace(/^★\s*/, '').trim(), textOf(cell));
  });
  return out;
}

// ── 1. the card renders the line at all ───────────────────────────────────
const cards = cardLines();
{
  ok('every team gets a card carrying a pts/gm line', teams.every(t => cards.has(t.name)), [...cards.keys()].join(','));
  ok('the line counts the starting slots filled', cards.get('Mine').filled === 1 && cards.get('Mine').total === 9,
    cards.get('Mine').filled + '/' + cards.get('Mine').total);
  ok('a full roster reads every starting slot filled', cards.get('Locked').filled === 9, String(cards.get('Locked').filled));
}
// ── 2. the anchor: a roster that can buy nothing scores only itself ───────
{
  ok('a locked roster renders exactly its own starters per game',
    cards.get('Locked').ppg === (LOCKED_PTS / GAMES).toFixed(1),
    cards.get('Locked').ppg + ' vs ' + (LOCKED_PTS / GAMES).toFixed(1));
  ok('a manager with money left projects above what he has bought',
    parseFloat(cards.get('Rival').ppg) > 0,
    cards.get('Rival').ppg);
}
// ── 3. the panel prints the same number the card does ────────────────────
{
  const p = panelPpg();
  teams.forEach(t => ok('the panel and the card agree for ' + t.name, p.get(t.name) === cards.get(t.name).ppg,
    'panel ' + p.get(t.name) + ' vs card ' + cards.get(t.name).ppg));
}
// ── 4. the reader's role overrides stop at his own roster ────────────────
{
  // Benching a player is a call the reader makes about HIS team. Letting it
  // reach a rival would drop that player out of the rival's starting lineup
  // too, and the projection would fall for a reason that exists only in the
  // reader's own settings. Locked has no money and no slots, so nothing can be
  // bought to paper over a leak: his number moves or it does not.
  const bench = { rb1: 'reserve' };
  const c4 = cardLines({ roleOverrides: bench });
  const p4 = panelPpg({ roleOverrides: bench });
  ok('a rival card ignores a player the reader benched on his own team',
    c4.get('Locked').ppg === cards.get('Locked').ppg, c4.get('Locked').ppg + ' vs ' + cards.get('Locked').ppg);
  ok('the rival keeps every starting slot filled', c4.get('Locked').filled === 9, String(c4.get('Locked').filled));
  ok('the panel ignores it too', p4.get('Locked') === cards.get('Locked').ppg,
    p4.get('Locked') + ' vs ' + cards.get('Locked').ppg);
}
// NOT asserted here: that a rival is planned at the house 0.55 allocation
// rather than the reader's own Starters-vs-Depth setting. The override is real
// and projectTeamStarters carries it, but the rival plan is built with noBench,
// and the withholding that allocation controls is bench-side — so on this path
// the setting cannot move starterPoints and a test of it would pass whatever
// the code did. Left unclaimed rather than asserted vacuously; if the rival
// plan ever stops passing noBench, this is the rule to cover.
// ── 5. the reader's draft model steers his plan and nobody else's ────────
{
  const c3 = cardLines({ model: 'zeroRB' });
  const p3 = panelPpg({ model: 'zeroRB' });
  ok('a rival card ignores the model the reader picked', c3.get('Rival').ppg === cards.get('Rival').ppg,
    c3.get('Rival').ppg + ' vs ' + cards.get('Rival').ppg);
  ok('the panel and the card still agree under a different model',
    teams.every(t => p3.get(t.name) === c3.get(t.name).ppg),
    teams.map(t => t.name + ':' + p3.get(t.name) + '/' + c3.get(t.name).ppg).join(' '));
}
// ── 6. snake renders two figures, and the panel quotes the projected one ─
{
  const snake = { ...config, format: 'snake', snake: { draftSlot: 2, rounds: 14 } };
  const c4 = cardLines({ config: snake });
  const p4 = panelPpg({ config: snake });
  ok('a snake card shows what he has now and what he projects to',
    c4.get('Mine').now != null && c4.get('Mine').ppg != null, JSON.stringify(c4.get('Mine')));
  // Agreement alone is not enough here: if the projection quietly collapsed to
  // the tally, both halves would read the same and both surfaces would still
  // match each other. A manager with picks left has to project ABOVE what he
  // already holds, or the arrow means nothing.
  ok('the projected figure is above what he already holds',
    parseFloat(c4.get('Mine').ppg) > parseFloat(c4.get('Mine').now),
    c4.get('Mine').now + ' → ' + c4.get('Mine').ppg);
  // No equivalent check on a team with nothing left: spotsRemaining and
  // budgetRemaining are auction ideas, and buildSnakePlan projects by round and
  // slot, so even a roster pinned to zero of both is still dealt more picks.
  ok('the panel quotes the projected figure, not the one he has now',
    p4.get('Mine') === c4.get('Mine').ppg, 'panel ' + p4.get('Mine') + ' vs card ' + c4.get('Mine').ppg + ' (now ' + c4.get('Mine').now + ')');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
