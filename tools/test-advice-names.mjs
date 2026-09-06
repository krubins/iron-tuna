#!/usr/bin/env node
// Advice the reader cannot act on: a note that says buy a player the board
// cannot price.
//   node tools/test-advice-names.mjs
//
// THE FAILURE THIS CATCHES. On 2026-09-05 the site's top card read "Fade Jacobs,
// buy Lloyd — grab MarShawn Lloyd, Green Bay's lead back, for a few dollars."
// MarShawn Lloyd has never been in PROJECTIONS. He had no row, no rank and no
// price, so the one thing the card told the reader to do was the one thing the
// site could not help him do. "Target Noel late" said the same of Jaylin Noel.
// Both had been up for days. Nothing noticed, because nothing was looking.
//
// WHY tools/test-insights.mjs DOES NOT CATCH IT. That file deliberately exempts
// PERF_NOTES from its roster rule, and it is right to: PERF_NOTES is dated and
// reports news, so it is allowed to name a player *because* he just left the
// board — a note saying a receiver is done for the season is the note working.
// The licence is for reporting. It was never meant to cover an instruction.
//
// SO THE RULE HERE IS NARROWER. A dated note may name anyone it likes while it
// is telling you what happened. The moment it tells you to acquire somebody —
// buy, grab, add, stash, draft, bid, pay up — every player it names has to be
// one the board can price. News gets the licence; instructions do not.
//
// The check is note-level on purpose. "Jaylin Noel is the Texans wideout best
// positioned for those vacated targets. Add him as a late flier" puts the verb
// in a different sentence from the name, behind a pronoun, and no window around
// the name reaches it honestly. If a note is giving an instruction at all, the
// reader has to be able to carry it out against this board.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { literalAfter, proseNames, norm, words } from './prose-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

const PROJECTIONS = literalAfter(worker, 'PROJECTIONS');
const PERF_NOTES = literalAfter(client, 'PERF_NOTES');
const BIDDING_NOTES = literalAfter(client, 'BIDDING_NOTES');
const { strayNames } = proseNames(PROJECTIONS);

// ── what counts as an instruction ─────────────────────────────────────────
// Verbs that tell the reader to end up holding the player. Listed as the exact
// tokens the prose uses, normalised the way the matcher normalises, so "Add",
// "add" and "adds" are one entry and "targets" (the noun this prose is full of
// — "vacated targets", "target share") is not "target" the verb.
//
// Deliberately NOT here: fade, avoid, pass, drop, cut, bench. A note telling
// you to stay away from somebody is news about him, and the reason the dated
// notes have their licence in the first place.
const ACQUIRE = new Set([
  'buy', 'buys', 'buying',
  'grab', 'grabs', 'grabbing',
  'add', 'adds', 'adding',
  'stash', 'stashes',        // "treat him as a cheap stash" is still an instruction
  'draft', 'drafts',
  'bid', 'bids',
  'roster',
  'chase', 'chases',
  'target',                  // the bare verb only; "targets" is the noun
  'pay',                     // "pay up for", "pay RB2 money for"
  'take',
  'start'
]);
// Two-word instructions the single-token list would miss.
const ACQUIRE_PAIRS = [['pick', 'up'], ['pick', 'him'], ['scoop', 'up']];

function instructionIn(text) {
  const ws = words(text).map(norm);
  for (let i = 0; i < ws.length; i++) {
    if (ACQUIRE.has(ws[i])) return ws[i];
    for (const [a, b] of ACQUIRE_PAIRS) if (ws[i] === a && ws[i + 1] === b) return a + ' ' + b;
  }
  return null;
}

// The label counts when asking whether a note gives an instruction — "Target
// Noel late" and "Allen floor buy" are the instruction, with the body left to
// explain it. It does NOT get scanned for names: a label is a headline, not a
// sentence, so "Fade Jacobs" and "Target Noel" read to the matcher as two
// capitalised words in a row and every card would report its own verb as
// somebody's first name. Names are read from the body, where the grammar holds.
const noteText = note => `${note.label || ''}. ${note.text || ''}`;

// The complaint list for one note. Empty means either "not an instruction" or
// "every name in the body is on the board".
function unactionableNames(note) {
  const verb = instructionIn(noteText(note));
  if (!verb) return [];
  return strayNames(note.text || '').map(h => `"${h.text}" is not on the board, but the note says ${verb}`);
}

// ── the notes that ship ───────────────────────────────────────────────────
console.log('\nthe libraries came through');
ok('PROJECTIONS is the real pool', PROJECTIONS.length > 300 && PROJECTIONS.every(p => p.name && p.team && p.position), String(PROJECTIONS.length));
ok('PERF_NOTES.current is a non-empty list', Array.isArray(PERF_NOTES.current) && PERF_NOTES.current.length > 0);
ok('BIDDING_NOTES is a non-empty list', Array.isArray(BIDDING_NOTES) && BIDDING_NOTES.length > 0);

console.log('\ndated advice must be advice the board can carry out');
for (const note of PERF_NOTES.current) {
  const bad = unactionableNames(note);
  ok(`"${note.label}" only tells the reader to buy players it can price`, bad.length === 0, bad.join('; '));
}

console.log('\nthe library and the bidding notes, same rule');
for (const note of [...(PERF_NOTES.library || []), ...BIDDING_NOTES]) {
  const bad = unactionableNames(note);
  ok(`"${note.label}" only tells the reader to buy players it can price`, bad.length === 0, bad.join('; '));
}

// ── the rule can still fail ───────────────────────────────────────────────
// A checker nobody has watched fail is a checker that passes for the wrong
// reason. These are the three cards exactly as they shipped on 2026-09-05, and
// they stay here after the rows land so the rule keeps proving it can fail.
console.log('\nthe rule still catches the cards that shipped wrong');
const CAUGHT = [
  ['a buy instruction naming a player with no row', {
    label: 'Fade Jacobs, buy Lloyd',
    text: "Josh Jacobs is on the commissioner's exempt list and cannot practice or play until reinstated. Fade Jacobs above stash pricing and grab MarShawn Lloyd, Green Bay's lead back, for a few dollars."
  }],
  ['an instruction carried by the label alone', {
    label: 'Allen floor buy',
    text: 'Keenan Allen signed a one-year Colts deal and reunites with Shane Steichen. He is a high-floor volume WR4. Treat him as a one to three dollar flier late in your auction.'
  }],
  ['an instruction behind a pronoun in the next sentence', {
    label: 'Target Noel late',
    text: 'Jayden Higgins tore his ACL and is out for 2026. Jaylin Noel is the Texans wideout best positioned for those vacated targets behind Nico Collins. Add him as a late one to three dollar flier.'
  }]
];
for (const [what, note] of CAUGHT) {
  ok(`still catches ${what}`, unactionableNames(note).length > 0, 'came back clean');
}

// ── and what it must leave alone ──────────────────────────────────────────
// The licence tools/test-insights.mjs granted the dated notes, still intact.
console.log('\nand leaves the notes the licence was written for alone');
const ALLOWED = [
  ['news about a player who just left the board', {
    label: 'Pearsall out',
    text: 'Ricky Pearsall is on injured reserve and off the board for the season. Nothing to do here but note the targets it frees up.'
  }],
  ['a fade, which is not an instruction to acquire', {
    label: 'Fade the committee',
    text: 'Zamir White and Sincere McCormick have split this backfield all camp. Fade both until one of them wins the job outright.'
  }],
  ['an instruction naming only players on the board', {
    label: 'Pay up for Price',
    text: "Zach Charbonnet opens on PUP and misses at least the first four games. Rookie first-rounder Jadarian Price leads Seattle's backfield. Pay RB2 money for Price and treat Charbonnet as a cheap stash."
  }],
  ['generic advice with no player in it at all', {
    label: 'Volume is king',
    text: 'Buy the touches, not the highlight reel. Opportunity is the most stable input a projection has.'
  }]
];
for (const [what, note] of ALLOWED) {
  const bad = unactionableNames(note);
  ok(`leaves ${what} alone`, bad.length === 0, bad.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
