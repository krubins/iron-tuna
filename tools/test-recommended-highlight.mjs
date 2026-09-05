#!/usr/bin/env node
// "Highlight recommended players", the checkbox in the models box.
//   node tools/test-recommended-highlight.mjs
//
// WHAT THIS PINS:
//
//  1. One control, two models boxes. The checkbox is rendered by a single
//     function that both the draft board's models pane and the cheat sheet's
//     own models box call, so the two can never drift into saying different
//     things about the same setting.
//
//  2. Checked, the current model's buys get `cheat-rec` on the sheet and
//     `rail-rec` on the auction board — and lose it the moment the player is
//     assigned to a team. Unchecked, neither class is ever emitted, which is
//     what makes the box a real off switch rather than a label.
//
//  3. The emphasis is small. Half a point of type and a wash of the model's
//     gold, and a favourite's green still outranks it, because the point is to
//     move the eye, not to repaint the sheet.
//
//  4. The $1-$2 endgame shortlist stays null until the manager is actually
//     down to it — the most he can still bid on any ONE player, which is the
//     budget minus a minimum bid for every other seat he still has to fill.
//
//  5. And once it arrives it ranks on UPSIDE, not points per game. That is the
//     whole reason it exists: at a dollar the projections are noise, so the
//     backup who inherits a workhorse's role has to beat the capped veteran
//     who out-projects him. A shortlist that just re-sorted PPG would be the
//     board again with a different colour.
//
// Pure node — no browser, no npm deps. Every function under test is lifted out
// of index.html by name, so this tracks the shipped source rather than a copy.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

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

// Pull one backtick template literal out of the page by its opening text.
function liftTemplate(head) {
  const start = SRC.indexOf(head);
  if (start < 0) throw new Error('index.html no longer builds a className from: ' + head);
  let depth = 0;
  for (let i = start + 1; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '\\') { i++; continue; }
    if (c === '{' && SRC[i - 1] === '$') depth++;
    else if (c === '}' && depth > 0) depth--;
    else if (c === '`' && depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error('unterminated template literal at: ' + head);
}

// A `const NAME = ...;` declaration, lifted up to its semicolon (the page keeps
// a trailing comment on some of them).
function liftConst(name) {
  const m = SRC.match(new RegExp('^const ' + name + ' = [^;\\n]*;', 'm'));
  if (!m) throw new Error('index.html no longer defines const ' + name);
  return m[0];
}

// ── the engine, lifted ─────────────────────────────────────────────────────
// AGE_2026, INJURIES and the schedule tables are the page's own data and none
// of this test's business, so ageOf/injuryOf are given empty ones and fall back
// to the fields on the player — which is exactly how they behave for anyone the
// tables do not name. scheduleSoftness is stubbed off for the same reason.
const ENGINE = new Function(`
  const AGE_2026 = {};
  const INJURIES = [];
  const scheduleSoftness = () => null;
  ${lift('ageOf')}
  ${lift('ageFlag')}
  ${lift('injuryOf')}
  ${liftConst('UPSIDE_INHERIT')}
  ${liftConst('UPSIDE_JOB_OPENS')}
  ${liftConst('UPSIDE_BREAKOUT')}
  ${liftConst('ENDGAME_SHORTLIST')}
  ${lift('upsideScores')}
  ${lift('maxSingleBid')}
  ${lift('endgameUpsideIds')}
  ${lift('upsideTitle')}
  return { upsideScores, maxSingleBid, endgameUpsideIds, upsideTitle };
`)();

const AUCTION = { format: 'auction', valuation: { minBid: 1 } };
const P = (o) => Object.assign({ team: 'AAA', position: 'RB', projectedPoints: 0, auctionValue: 1 }, o);

// ── 1. one control, both models boxes ──────────────────────────────────────
console.log('\none checkbox, rendered the same way in both models boxes');
{
  ok('the control is one function', /function recHighlightToggle\(/.test(SRC));
  const calls = SRC.match(/recHighlightToggle\(highlightRecs, onToggleHighlightRecs, config\)/g) || [];
  ok('both models boxes call it', calls.length === 2, calls.length + ' call site(s)');
  ok("the draft board's pane hands the toggle over",
     /HeaderModelTabs, \{[^}]*onToggleHighlightRecs: toggleHighlightRecs/.test(SRC));
  ok("the cheat sheet's box gets it too",
     /onToggleHighlightRecs: toggleHighlightRecs,/.test(SRC));
  ok('the setting survives a reload', SRC.includes("localStorage.getItem('it_hl_recs')"));
  // With no team marked there is no plan to recommend from, so the box would be
  // a control that does nothing.
  ok('the cheat sheet hides it until a team is marked',
     SRC.includes('myTeam && onToggleHighlightRecs && recHighlightToggle'));
}

// ── 2. what the checkbox actually does to a row ─────────────────────────────
const cheatTpl = liftTemplate('`cheat-row ${');
const railTpl = liftTemplate('`rail-row ${');

function cheatClasses({ on, recommended, upside, drafted }) {
  const id = 'p1';
  const scope = {
    hlSet: new Set(), targets: new Set(), modelFitIds: new Set(),
    tierBreaksByPos: {}, pos: 'RB', i: 0, drafted: !!drafted,
    dinfo: drafted ? { team: 'Rivals', price: 1, mine: false } : null,
    _tb: null, config: { format: 'auction' }, _fmtMyRoster: [],
    bestballStackBoost: undefined,
    highlightRecs: !!on,
    recFitIds: recommended ? new Set([id]) : new Set(),
    upsideIds: upside ? new Map([[id, { pts: 30, ppg: 1.8, why: [] }]]) : new Map(),
    p: { id }
  };
  const keys = Object.keys(scope);
  return new Function(...keys, 'return ' + cheatTpl)(...keys.map(k => scope[k])).split(/\s+/).filter(Boolean);
}
function railClasses({ on, recommended, upside, targeted }) {
  const id = 'p1';
  const scope = {
    cls: '', targets: targeted ? new Set([id]) : new Set(),
    highlightRecs: !!on,
    recFitIds: recommended ? new Set([id]) : new Set(),
    upsideIds: upside ? new Map([[id, { pts: 30, ppg: 1.8, why: [] }]]) : new Map(),
    p: { id }
  };
  const keys = Object.keys(scope);
  return new Function(...keys, 'return ' + railTpl)(...keys.map(k => scope[k])).split(/\s+/).filter(Boolean);
}

console.log('\nchecked, the model’s own buys stand out; unchecked, nothing moves');
{
  ok('the cheat sheet lifts a recommended player',
     cheatClasses({ on: true, recommended: true }).includes('cheat-rec'));
  ok('the auction board lifts the same man',
     railClasses({ on: true, recommended: true }).includes('rail-rec'));
  ok('unchecked, the cheat sheet leaves him alone',
     !cheatClasses({ on: false, recommended: true }).includes('cheat-rec'));
  ok('unchecked, the auction board leaves him alone',
     !railClasses({ on: false, recommended: true }).includes('rail-rec'));
  ok('a player the model does not want is untouched',
     !cheatClasses({ on: true, recommended: false }).includes('cheat-rec'));
  // A man already bought is not a recommendation any more.
  ok('the emphasis retires when he is assigned to a team',
     !cheatClasses({ on: true, recommended: true, drafted: true }).includes('cheat-rec'));
  ok('the endgame flag rides the same switch',
     cheatClasses({ on: true, upside: true }).includes('cheat-upside') &&
     railClasses({ on: true, upside: true }).includes('rail-upside') &&
     !cheatClasses({ on: false, upside: true }).includes('cheat-upside'));
  // A favourite is a decision the manager made; a recommendation is one the
  // model made. The decision wins the row.
  ok('a favourite still keeps his own mark alongside it',
     railClasses({ on: true, recommended: true, targeted: true }).includes('rail-target'));
}

// ── 3. the emphasis is small, and it loses to a favourite ──────────────────
console.log('\nthe emphasis is a nudge, not a repaint');
{
  const rule = sel => {
    const m = SRC.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'));
    return m ? m[1] : '';
  };
  const name = rule('.cheat-row.cheat-rec .cheat-name');
  ok('the recommended name is heavier', /font-weight: 700/.test(name), name);
  const size = (name.match(/font-size: ([\d.]+)em/) || [])[1];
  ok('and about half a point larger, no more',
     size && +size > 1 && +size <= 1.08, 'font-size: ' + size + 'em');
  const bg = rule('.cheat-row.cheat-rec');
  const alpha = (bg.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1];
  ok('the wash is faint', alpha && +alpha <= 0.14, bg);

  const at = s => SRC.search(new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm'));
  ok("a favourite's green still outranks the recommendation wash",
     at('.cheat-row.cheat-target {') > at('.cheat-row.cheat-rec {'));
  ok('the same holds on the auction board',
     at('.rail-row.rail-target {') > at('.rail-row.rail-rec {'));
  // The sheet is printed and taken to the draft; emphasis that only exists on
  // screen is emphasis the manager does not have in the room.
  ok('the printed sheet keeps it', /\.cheat-row\.cheat-rec \{ background: #[0-9a-f]{6} !important; \}/.test(SRC));
  ok('the printed sheet keeps the endgame flag too', SRC.includes('.cheat-row.cheat-upside { background: #e8f4fd !important;'));
}

// ── 4. the endgame has to actually arrive ──────────────────────────────────
console.log('\nthe endgame shortlist waits until the manager is down to it');
{
  const pool = [P({ id: 'a', name: 'Cheap Kid', projectedPoints: 40, yearsExp: 1 })];
  const mid = { budgetRemaining: 60, spotsRemaining: 5, roster: [] };
  const end = { budgetRemaining: 6, spotsRemaining: 5, roster: [] };
  ok('mid-auction, $60 across 5 seats is $56 for one man — no flag',
     ENGINE.maxSingleBid(mid, AUCTION) === 56 && ENGINE.endgameUpsideIds(pool, mid, AUCTION, new Set(), 17) === null);
  ok('$6 across 5 seats is $2 for one man — the endgame',
     ENGINE.maxSingleBid(end, AUCTION) === 2 && ENGINE.endgameUpsideIds(pool, end, AUCTION, new Set(), 17) !== null);
  ok('a full roster has no endgame at all',
     ENGINE.maxSingleBid({ budgetRemaining: 3, spotsRemaining: 0, roster: [] }, AUCTION) === null);
  // A snake draft has no dollars, so the shortlist has nothing to be about.
  ok('a snake draft never raises it',
     ENGINE.endgameUpsideIds(pool, end, { format: 'snake', valuation: { minBid: 1 } }, new Set(), 17) === null);
  // And a man nobody can afford is not on the shortlist, however good he is.
  const rich = [P({ id: 'b', name: 'Star', projectedPoints: 300, yearsExp: 1, auctionValue: 40 })];
  ok('an unaffordable player is left off it',
     ENGINE.endgameUpsideIds(rich, end, AUCTION, new Set(), 17) === null);
}

// ── 5. it ranks on upside, not on points per game ──────────────────────────
console.log('\nthe shortlist is upside, which is not the points-per-game order');
{
  //  - Workhorse leads AAA and is on this manager's roster.
  //  - Understudy is behind him: fewer points than the veteran, but the role he
  //    would inherit is worth four times either of them.
  //  - Steady Vet leads his own backfield outright at 31, projects higher than
  //    the understudy, and has nothing left to inherit.
  const pool = [
    P({ id: 'lead', name: 'Workhorse', team: 'AAA', projectedPoints: 260, auctionValue: 45, age: 25 }),
    P({ id: 'up', name: 'Understudy', team: 'AAA', projectedPoints: 40, auctionValue: 1, age: 23, yearsExp: 1 }),
    P({ id: 'vet', name: 'Steady Vet', team: 'BBB', projectedPoints: 70, auctionValue: 1, age: 31 })
  ];
  const myTeam = { budgetRemaining: 4, spotsRemaining: 3, roster: [{ playerId: 'lead' }] };
  const list = ENGINE.endgameUpsideIds(pool, myTeam, AUCTION, new Set(['lead']), 17);
  ok('the shortlist exists', !!list);
  ok('the board would have ranked the veteran first, on points',
     pool[2].projectedPoints > pool[1].projectedPoints);
  ok('the shortlist takes the understudy instead', !!(list && list.has('up')), [...(list || new Map()).keys()].join(','));
  const scores = ENGINE.upsideScores(pool, myTeam, 17);
  ok('and scores him above the man who out-projects him',
     scores.get('up').pts > (scores.get('vet') ? scores.get('vet').pts : 0),
     `up ${scores.get('up').pts.toFixed(1)} vs vet ${(scores.get('vet') || { pts: 0 }).pts.toFixed(1)}`);
  ok('the flag says what the claim is worth, in points',
     /\+\d+\.\d pts\/game of upside/.test(ENGINE.upsideTitle(pool[1], scores.get('up'))));
  ok('and why him', /one snap from Workhorse's role/.test(ENGINE.upsideTitle(pool[1], scores.get('up'))));
  ok('owning the starter is part of the reason',
     /handcuffs a starter you already own/.test(ENGINE.upsideTitle(pool[1], scores.get('up'))));

  // An injured starter makes the job more likely to open, so the man behind
  // him is worth more, not the same.
  const hurt = pool.map(p => p.id === 'lead' ? Object.assign({}, p, { injuryStatus: 'IR: out 4+ games' }) : p);
  const hurtScores = ENGINE.upsideScores(hurt, myTeam, 17);
  ok("an injury to the man ahead raises the understudy's upside",
     hurtScores.get('up').pts > scores.get('up').pts,
     `${hurtScores.get('up').pts.toFixed(1)} vs ${scores.get('up').pts.toFixed(1)}`);

  // The shortlist is a shortlist. A pool of forty candidates does not light up
  // forty rows.
  const many = [];
  for (let i = 0; i < 40; i++) many.push(P({ id: 'x' + i, name: 'Kid ' + i, team: 'T' + i, projectedPoints: 60 - i, auctionValue: 1, age: 23, yearsExp: 1 }));
  const big = ENGINE.endgameUpsideIds(many, { budgetRemaining: 3, spotsRemaining: 2, roster: [] }, AUCTION, new Set(), 17);
  ok('it never flags more than a dozen names', big && big.size <= 12, big ? String(big.size) : 'null');
}

// ── 6. the model the emphasis follows ──────────────────────────────────────
console.log('\nthe emphasis follows the model the box is showing');
{
  ok('one function answers "who is this model buying"', /function modelTargetIds\(/.test(SRC));
  ok('the gold model-fit bar reads it', /const modelFitIds = useMemo\(\(\) => modelTargetIds\(draftModel,/.test(SRC));
  // The models pane shows the Ideal Team when nothing is picked, so the
  // emphasis has to show the same thing rather than going blank.
  ok('a picked model reuses the set the gold bar already solved',
     /if \(!highlightRecs\) return null;\s*\n\s*if \(draftModel\) return modelFitIds;/.test(SRC));
  ok('with no model picked it follows the Ideal Team, as the pane does',
     /return modelTargetIds\('ideal',/.test(SRC));
  ok('and computes nothing at all while the box is unchecked',
     /const recFitIds = useMemo\(\(\) => \{\s*\n\s*if \(!highlightRecs\) return null;/.test(SRC));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
