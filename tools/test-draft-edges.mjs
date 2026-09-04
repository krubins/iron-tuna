#!/usr/bin/env node
// The four draft-day edges, pinned:
//   node tools/test-draft-edges.mjs
//
// 1. applyProjOverrides — your read on a player reaches POINTS, not just price,
//    so value, rank and tier move with it. A percent means the percent.
// 2. parseNewsLine — pasted news becomes points, and an injury is priced in
//    GAMES MISSED. "Out" the week of a draft costs one game of seventeen, not a
//    season; booking it as -100% would wreck a board over a hamstring.
// 3. opponentCompetition — a rival with no starting RB2 bids differently from
//    one filling his last bench RB. What a player costs you is set by the
//    RUNNER-UP among rivals who both need him and can pay, not by the richest
//    team in the room.
// 4. nominationBoard — never recommend nominating a player you want whom rivals
//    can also afford. That is the one nomination that can only cost you money.
//
// Pure functions only — no browser, no React, no network. The real declarations
// are lifted out of index.html by brace-matching so this can never drift into
// testing a re-implementation.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// A source scanner that also skips REGEX LITERALS. Without that, normName's
// character class — it contains a quote and a backtick — opens a string that
// never closes, the brace matcher runs past the end of its function, and the
// lifted source comes out holding two copies of whatever followed.
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const REGEX_OK_AFTER = '(,=:[!&|?{};+*%<>~^' + NL;
function scan(src, start, onChar) {
  let inS = null, inC = null, prev = '';
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inC) {
      if (inC === '//' && c === NL) inC = null;
      else if (inC === '/*' && c === '*' && n === '/') { inC = null; i++; }
      continue;
    }
    if (inS) {
      if (c === BS) { i++; continue; }
      if (inS === '/' && c === '[') { inS = '/['; continue; }
      if (inS === '/[') { if (c === ']') inS = '/'; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && n === '/') { inC = '//'; i++; continue; }
    if (c === '/' && n === '*') { inC = '/*'; i++; continue; }
    if (c === '/' && REGEX_OK_AFTER.indexOf(prev) !== -1) { inS = '/'; prev = c; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; prev = c; continue; }
    const r = onChar(c, i);
    if (r !== undefined) return r;
    if (c.trim()) prev = c;
  }
  return undefined;
}
function matchFrom(src, start, open, close) {
  let d = 0;
  const r = scan(src, start, (c, i) => {
    if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return i; }
  });
  return r === undefined ? -1 : r;
}
function endOfStatement(src, start) {
  let d = 0;
  const r = scan(src, start, (c, i) => {
    if ('{[('.indexOf(c) !== -1) d++;
    else if ('}])'.indexOf(c) !== -1) d--;
    else if (c === ';' && d === 0) return i;
  });
  return r === undefined ? -1 : r;
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
const consts = ['NEWS_SEASON', 'NEWS_RULES'].map(n => {
  const m = new RegExp('^const' + BS + 's+' + n + BS + 's*=', 'm').exec(idx);
  if (!m) throw new Error('cannot lift const ' + n);
  return idx.slice(m.index, endOfStatement(idx, m.index) + 1);
}).join('\n');

const ROOTS = ['applyProjOverrides', 'parseNewsLine', 'parseNewsPaste', 'findPlayer',
  'openStarterNeed', 'opponentCompetition', 'positionFull', 'nominationBoard'];
const src = consts + '\n' + closure(ROOTS) + '\nexport {' + ROOTS.join(',') + '};';
const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
const { applyProjOverrides, parseNewsLine, openStarterNeed, opponentCompetition, nominationBoard } = mod;

// ── fixtures ──────────────────────────────────────────────────────────────
const CONFIG = {
  teams: 12,
  budget: 120,
  benchPositions: 'any',
  valuation: { minBid: 1 },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  roster: {
    QB: { starters: 1, total: 2 }, RB: { starters: 2, total: 4 }, WR: { starters: 2, total: 4 },
    TE: { starters: 1, total: 2 }, K: { starters: 1, total: 2 }, DEF: { starters: 1, total: 2 }
  }
};
const P = (id, name, position, pts, market, you) => ({
  id, name, position, team: 'XXX', projectedPoints: pts, auctionValue: market,
  marketValue: market, personalValue: you == null ? market : you
});
const POOL = [
  P('rb1', 'Bijan Robinson', 'RB', 300, 45),
  P('rb2', 'Chase Brown', 'RB', 240, 24),
  P('rb3', 'Tyjae Spears', 'RB', 150, 6),
  P('wr1', 'JaMarr Chase', 'WR', 290, 42),
  P('wr2', 'Rome Odunze', 'WR', 200, 15),
  P('te1', 'Trey McBride', 'TE', 210, 20),
  P('qb1', 'Josh Allen', 'QB', 380, 18)
];

// ── 1. applyProjOverrides ─────────────────────────────────────────────────
{
  const out = applyProjOverrides(POOL.map(p => ({ ...p })), { rb1: { pct: -20, note: 'calf', label: 'Questionable', src: 'news' } });
  const rb1 = out.find(p => p.id === 'rb1');
  ok('a -20% edit moves the points by exactly 20%', Math.abs(rb1.projectedPoints - 240) < 1e-9, 'got ' + rb1.projectedPoints);
  ok('the edit rides on the player so the UI can explain it', rb1.projOverride && rb1.projOverride.pct === -20 && rb1.projOverride.note === 'calf');
  ok('players with no edit are untouched', out.find(p => p.id === 'rb2').projectedPoints === 240 && !out.find(p => p.id === 'rb2').projOverride);
  const outed = applyProjOverrides(POOL.map(p => ({ ...p })), { rb1: { pct: -100 } });
  ok('-100% zeroes him, so he falls below replacement and prices out', outed.find(p => p.id === 'rb1').projectedPoints === 0);
  ok('a bare number is accepted as a percent', applyProjOverrides(POOL.map(p => ({ ...p })), { rb2: 50 }).find(p => p.id === 'rb2').projectedPoints === 360);
  ok('an empty override map is a no-op', applyProjOverrides(POOL, {}) === POOL);
}

// ── 2. parseNewsLine ──────────────────────────────────────────────────────
{
  const N = s => parseNewsLine(s, POOL, 17);
  const wk = N('Bijan Robinson - out, hamstring');
  ok('"out" the week of a draft costs ONE game, not the season', wk && Math.abs(wk.pct + 100 / 17) < 0.1, 'got ' + (wk && wk.pct));
  ok('...and the note survives', wk && wk.note === 'hamstring' && wk.label === 'Out');
  const four = N('Chase Brown out 4');
  ok('"out 4" is four games of seventeen', four && Math.abs(four.pct + 400 / 17) < 0.1, 'got ' + (four && four.pct));
  ok('"out for the season" is -100%', N('Chase Brown out for the season').pct === -100);
  ok('a torn ACL is season-ending', N('Chase Brown torn ACL').pct === -100);
  ok('a suspension carries its own length', Math.abs(N('Rome Odunze suspended 6').pct + 600 / 17) < 0.1);
  const q = N('Trey McBride questionable, ankle');
  ok('questionable is a fraction of one game, not of the season', q.pct < 0 && q.pct > -3, 'got ' + q.pct);
  ok('an explicit percent is taken literally', N('Rome Odunze +15% camp buzz').pct === 15);
  ok('a role promotion is a percent, not a game count', N('Tyjae Spears named starter').pct === 18);
  ok('"cleared" removes the edit rather than setting one', N('Bijan Robinson cleared').clear === true);
  ok('a misspelled name still resolves', N('Bijan Robnison out').player.id === 'rb1');
  ok('an unknown name is reported, not silently dropped', /no player matches/.test(N('Some Guy out').error));
  ok('a known name with no status word is reported too', /no status word/.test(N('Bijan Robinson').error));
  ok('a blank line is ignored', N('   ') === null);
}

// ── 3. opponentCompetition ────────────────────────────────────────────────
const T = (id, budget, spots, roster, isMine) => ({ id, name: 'T' + id, isMine: !!isMine, budgetRemaining: budget, spotsRemaining: spots, roster });
let _rid = 0;
const R = position => ({ playerId: 'x' + (++_rid), position, price: 5 });
{
  const mine = T(0, 100, 14, [], true);
  // Same money, opposite need: one rival already has three RBs, one has none.
  const stocked = T(1, 60, 10, [R('RB'), R('RB'), R('RB')]);
  const needy = T(2, 60, 10, [R('WR'), R('WR')]);
  const comp = opponentCompetition(POOL[1], [mine, stocked, needy], mine, CONFIG);
  ok('a rival carrying a surplus RB is not counted as needing another', comp.needyAble === 1 && comp.flexAble === 0, 'needyAble=' + comp.needyAble + ' flexAble=' + comp.flexAble);
  ok('...though he is still counted among those who can afford him', comp.canAfford === 2, 'canAfford=' + comp.canAfford);
  ok('one bidder means no runner-up to beat', comp.runnerUp === 0);
  ok('level tracks need, not raw money', comp.level === 'Low', comp.level);
  // A team whose starting RBs are exactly filled, no surplus: he will take an RB
  // in the flex but he is not hunting one, so he is priced at half a hunter.
  const flexer = T(6, 60, 10, [R('RB'), R('RB')]);
  const cf = opponentCompetition(POOL[1], [mine, flexer], mine, CONFIG);
  ok('a filled-but-flexible rival counts as flex competition, not a hunter', cf.needyAble === 0 && cf.flexAble === 1, 'needyAble=' + cf.needyAble + ' flexAble=' + cf.flexAble);
  ok('a flex bidder can still outbid you, so he is a bidder', cf.bidders === 1 && cf.level === 'Low');
  const needy2 = T(3, 40, 10, [R('WR')]);
  const c2 = opponentCompetition(POOL[1], [mine, stocked, needy, needy2], mine, CONFIG);
  ok('two bidders produce a runner-up — the number you have to beat', c2.runnerUp === 31, 'runnerUp=' + c2.runnerUp);
  ok('the deepest pocket that can start him is reported separately', c2.maxNeedy === 51, 'maxNeedy=' + c2.maxNeedy);
  const broke = T(4, 3, 2, [R('WR')]);
  const c3 = opponentCompetition(POOL[0], [mine, broke], mine, CONFIG);
  ok('a rival who needs him but cannot pay is not competition', c3.bidders === 0 && c3.needy === 1 && c3.level === 'None');
  const flexOpen = T(5, 60, 10, [R('RB'), R('RB'), R('WR'), R('WR')]);
  ok('surplus at an eligible position is charged to the flex, erring conservative',
    openStarterNeed(flexOpen, 'RB', CONFIG).base === 0 && openStarterNeed(flexOpen, 'RB', CONFIG).flex === 1);
  ok('an ineligible position never picks up flex need',
    openStarterNeed(flexOpen, 'QB', CONFIG).base === 1 && openStarterNeed(flexOpen, 'QB', CONFIG).flex === 0);
}

// ── 4. nominationBoard ────────────────────────────────────────────────────
{
  const mine = T(0, 100, 14, [], true);
  const rich = T(1, 80, 12, [R('QB')]);
  const rich2 = T(2, 80, 12, [R('QB')]);
  // My plan wants Bijan. Everyone else is somebody else's problem.
  const plan = { remainingStarterSlots: [{ basePos: 'RB', player: POOL[0] }], benchTargets: [] };
  const rows = nominationBoard(POOL, [mine, rich, rich2], mine, plan, CONFIG, new Set(), 4);
  ok('something is recommended', rows.length > 0);
  ok('the player MY plan wants is never put up while rivals can pay for him',
    !rows.some(r => r.player.id === 'rb1'), rows.map(r => r.player.id).join(','));
  ok('every drain has a rival who can actually pay', rows.every(r => r.kind !== 'drain' || r.comp.needyAble > 0));
  ok('the biggest drain leads', rows[0] && rows[0].drain >= (rows[1] ? rows[1].drain : 0));
  ok('every row explains itself', rows.every(r => r.why && r.why.length > 20));
  const poor = T(3, 4, 3, [R('QB')]);
  const poor2 = T(4, 4, 3, [R('QB')]);
  const rows2 = nominationBoard(POOL, [mine, poor, poor2], mine, plan, CONFIG, new Set(), 4);
  const buy = rows2.find(r => r.player.id === 'rb1');
  ok('once nobody who needs him can pay, the player I want flips to a BUY', !!buy && buy.kind === 'bargain');
  ok('BUY rows lead — they expire the moment a budget frees up', rows2[0].kind === 'bargain');
  ok('a drafted player is never nominated',
    !nominationBoard(POOL, [mine, rich, rich2], mine, plan, CONFIG, new Set(['rb2']), 4).some(r => r.player.id === 'rb2'));
  ok('no team of mine means no advice rather than a crash', nominationBoard(POOL, [], null, plan, CONFIG, new Set(), 4).length === 0);
}


// ── 5. a drain must be a player you genuinely do not want ─────────────────
{
  const mine = T(0, 100, 14, [], true);
  const rich = T(1, 80, 12, [R('QB')]);
  const rich2 = T(2, 80, 12, [R('QB')]);
  const plan = { remainingStarterSlots: [{ basePos: 'RB', player: POOL[0] }], benchTargets: [] };
  // Chase Brown goes for $24 and my own number on him is $23. A dollar is not a
  // reason to hand him to a rival: if the bidding stalls I want him.
  const nearly = POOL.map(p => p.id === 'rb2' ? { ...p, personalValue: 23 } : p);
  const rows = nominationBoard(nearly, [mine, rich, rich2], mine, plan, CONFIG, new Set(), 6);
  ok('a player my own number nearly reaches is not floated as a drain',
    !rows.some(r => r.kind === 'drain' && r.player.id === 'rb2'), rows.map(r => r.kind + ':' + r.player.id).join(','));
  const cheapToMe = POOL.map(p => p.id === 'rb2' ? { ...p, personalValue: 9 } : p);
  ok('...but one the market prices well above my sheet still is',
    nominationBoard(cheapToMe, [mine, rich, rich2], mine, plan, CONFIG, new Set(), 6).some(r => r.kind === 'drain' && r.player.id === 'rb2'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
