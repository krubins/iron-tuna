#!/usr/bin/env node
// The target highlight on the cheat sheet and the Auction Manager rail.
//   node tools/test-target-highlight.mjs
//
// WHAT THIS PINS: flagging a player as a target lights his ENTIRE line, and the
// line stays lit until he is assigned to a team or the flag comes off.
//
// Two things used to go wrong.
//
//  1. On the cheat sheet the row kept `cheat-target` after the player was
//     drafted, so a man you had already bought went on glowing green — and,
//     because the target background is declared after `cheat-drafted-mine`, it
//     also painted over the gold that marks your own buys.
//
//  2. On the Auction Manager rail the target flag was not on the row at all.
//     Only the snake-format dot rendered it, so in an auction — where targets
//     are set from the cheat sheet star or a locked roster slot — the rail gave
//     no sign of which of the available players you were hunting.
//
// The class expressions are lifted out of index.html and evaluated here, so the
// test exercises the shipped source rather than a copy of it.
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

const cheatTpl = liftTemplate('`cheat-row ${');
const railTpl = liftTemplate('`rail-row ${');

// ── the cheat sheet row ────────────────────────────────────────────────────
// Everything the row expression reads, stubbed to the quiet case: no strategy
// highlight, no model fit, no tier break, no stack.
function cheatClasses({ targeted, drafted, mine }) {
  const id = 'p1';
  const scope = {
    hlSet: new Set(),
    targets: targeted ? new Set([id]) : new Set(),
    modelFitIds: new Set(),
    tierBreaksByPos: {},
    pos: 'RB',
    i: 0,
    drafted,
    dinfo: drafted ? { team: 'Rivals', price: 20, mine } : null,
    _tb: null,
    config: { format: 'auction' },
    _fmtMyRoster: [],
    bestballStackBoost: undefined,
    // The models box's "highlight recommended players" toggle, off here — this
    // test is about the target flag, and tools/test-recommended-highlight.mjs
    // covers the emphasis.
    highlightRecs: false,
    recFitIds: null,
    upsideIds: null,
    p: { id }
  };
  const keys = Object.keys(scope);
  const out = new Function(...keys, 'return ' + cheatTpl)(...keys.map(k => scope[k]));
  return out.split(/\s+/).filter(Boolean);
}

console.log('\ncheat sheet: the line lights up for a target');
{
  ok('a target that is still on the board is highlighted',
     cheatClasses({ targeted: true, drafted: false }).includes('cheat-target'));
  ok('a player who is not a target is not highlighted',
     !cheatClasses({ targeted: false, drafted: false }).includes('cheat-target'));

  console.log('\ncheat sheet: the highlight retires on assignment');
  ok('assigning a target to a rival clears the highlight',
     !cheatClasses({ targeted: true, drafted: true, mine: false }).includes('cheat-target'));
  ok('assigning a target to your own team clears the highlight',
     !cheatClasses({ targeted: true, drafted: true, mine: true }).includes('cheat-target'));
  // ...and hands the row back to the gold that marks your own buys.
  ok('your own buy still reads as yours',
     cheatClasses({ targeted: true, drafted: true, mine: true }).includes('cheat-drafted-mine'));
}

// ── the Auction Manager rail row ───────────────────────────────────────────
function railClasses({ targeted, plan }) {
  const id = 'p1';
  const scope = {
    cls: plan || '',
    targets: targeted ? new Set([id]) : new Set(),
    highlightRecs: false,
    recFitIds: null,
    upsideIds: null,
    p: { id }
  };
  const keys = Object.keys(scope);
  const out = new Function(...keys, 'return ' + railTpl)(...keys.map(k => scope[k]));
  return out.split(/\s+/).filter(Boolean);
}

console.log('\nauction manager rail: the line lights up for a target');
{
  ok('a target is highlighted', railClasses({ targeted: true }).includes('rail-target'));
  ok('a plain player is not', !railClasses({ targeted: false }).includes('rail-target'));
  // The plan's own green/yellow tint has to survive alongside it.
  const both = railClasses({ targeted: true, plan: 'ideal' });
  ok('a target that is also an ideal starter keeps both marks',
     both.includes('rail-target') && both.includes('ideal'), both.join(' '));
}

// The rail only ever lists undrafted players, which is what retires the
// highlight there. Pin that, because gating in the row would be dead code.
console.log('\nauction manager rail: assignment removes the row');
ok('the rail list filters out drafted players',
   /let l = players\.filter\(p => !draftedIds\.has\(p\.id\)\);/.test(SRC));

// ── the styling that makes it a whole-line highlight ───────────────────────
console.log('\nthe highlight covers the whole line');
{
  const rule = sel => {
    const m = SRC.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'));
    return m ? m[1] : '';
  };
  const cheat = rule('.cheat-row.cheat-target');
  ok('the cheat row gets a full-width background', /background:/.test(cheat), cheat);
  ok('the cheat row gets a left edge marker', /box-shadow:.*inset/.test(cheat), cheat);
  const rail = rule('.rail-row.rail-target');
  ok('the rail row gets a full-width background', /background:/.test(rail), rail);
  ok('the rail row gets a left edge marker', /border-left-color:/.test(rail), rail);

  // Model fit and stack repaint the row underneath a target, so the target
  // rules must come after them to win.
  // Anchored to the start of a line so the print-media copies of these rules,
  // which are indented, cannot stand in for the screen ones.
  const at = s => SRC.search(new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm'));
  ok('the target background outranks the model-fit bar',
     at('.cheat-row.cheat-target {') > at('.cheat-row.cheat-modelfit {'));
  ok('the target background outranks the stack tint',
     at('.cheat-row.cheat-target {') > at('.cheat-row.cheat-stack {'));
  ok('the rail target outranks the plan tints',
     at('.rail-row.rail-target {') > at('.rail-row.reserve {'));

  // The star is the flag itself, not the highlight — it stays gold after the
  // row hands its background back at assignment.
  ok('the star keeps its own lit state', /\.cheat-star\.on \{[^}]*color:/.test(SRC));
  ok("the star no longer hangs off the row's highlight",
     !SRC.includes('.cheat-row.cheat-target .cheat-star'));
  ok('the row renders that state', SRC.includes(`"cheat-star" + (targets && targets.has(p.id) ? ' on' : '')`));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
