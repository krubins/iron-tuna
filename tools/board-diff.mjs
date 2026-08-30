// Which prices and ranks actually moved between two odds overlays?
//
// An overlay refresh rewrites almost every player by a tenth of a yard. On
// 2026-08-26 the 11:00Z refresh changed 241 of 312 players and moved exactly
// twelve ranks and two prices. Diffing the overlay tells you nothing useful;
// diffing the BOARD tells you which stories can possibly be wrong.
//
//   node tools/board-diff.mjs old-overlay.json new-overlay.json
//
// Pass "-" for either side to mean the committed board with no odds blended.
import { board } from './live-board.mjs';

const [oldPath, newPath] = process.argv.slice(2);
if (!newPath) {
  console.error('usage: node tools/board-diff.mjs <old-overlay.json|-> <new-overlay.json|->');
  process.exit(2);
}
const load = p => p === '-' ? board(null, false) : board(p);
const A = load(oldPath).map, B = load(newPath).map;

const moved = [];
for (const n of new Set([...A.keys(), ...B.keys()])) {
  const a = A.get(n), b = B.get(n);
  if (!a || !b) { moved.push({ n, pos: (a || b).pos, was: a ? fmt(a) : 'absent', now: b ? fmt(b) : 'absent', price: true }); continue; }
  if (a.rank !== b.rank || a.v !== b.v) moved.push({ n, pos: a.pos, was: fmt(a), now: fmt(b), price: a.v !== b.v });
}
function fmt(x) { return x.pos + x.rank + ' $' + x.v; }

moved.sort((x, y) => x.pos.localeCompare(y.pos) || x.n.localeCompare(y.n));
console.log(oldPath + '  ->  ' + newPath);
console.log('\n' + moved.length + ' player(s) moved rank or price:');
for (const m of moved) console.log('  ' + m.n.padEnd(24) + m.was.padEnd(12) + ' -> ' + m.now + (m.price ? '   PRICE' : ''));

const priced = moved.filter(m => m.price);
console.log('\n' + priced.length + ' of those changed PRICE — only stories naming these can have a wrong dollar figure:');
for (const m of priced) console.log('  ' + m.n);
if (!priced.length) console.log('  (none)');
