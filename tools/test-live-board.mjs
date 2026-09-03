// The harness has no business being unverified.
//
// tools/live-board.mjs is what every check of a published dollar figure runs
// through, and it has gone silently wrong three times -- 2026-08-25 (curve
// re-cut), 08-31 (pricing and normalisation changed), 09-03 (_colScore moved
// into scoreStats, so the lift threw ReferenceError). Every one of those days
// the suite was green, because NOTHING imported live-board.mjs. This file is
// what closes that: it imports it, builds a board, and proves the numbers are
// READ from the worker rather than remembered.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { board, price, MIN_BID, NORM, WORKER_PATH, hasAvailability } from './live-board.mjs';

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); }
};
console.log('live-board harness (' + path.basename(WORKER_PATH) + ')');

// 1. It builds at all. A lift that throws is the 09-03 failure exactly.
let built = null, buildErr = '';
try { built = board(null, false); } catch (e) { buildErr = e.message; }
ok('the board builds from the worker', !!built, buildErr);
if (!built) process.exit(1);
const { map, lists } = built;
ok('every scoring position is populated',
  ['QB', 'RB', 'WR', 'TE'].every(p => (lists[p] || []).length > 10),
  Object.entries(lists).map(([k, v]) => k + ':' + v.length).join(' '));

// 2. It agrees with it-league.js, which is generated from the worker by a
//    different tool (tools/build-default-board.mjs) and is therefore an
//    INDEPENDENT reading of the same source.
const src = fs.readFileSync(new URL('../it-league.js', import.meta.url), 'utf8');
const raw = JSON.parse(/var DEFAULT_BOARD_RAW = ("(?:[^"\\]|\\.)*");/.exec(src)[1]);
const wrong = [], absent = [];
let checked = 0;
for (const line of raw.split('\n')) {
  const [n, pos, pts] = line.split('|');
  const e = map.get(n);
  if (!e || e.pos !== pos) { absent.push(n + '|' + pos); continue; }
  checked++;
  if (Math.abs(e.pts - Number(pts)) > 1e-9) wrong.push(`${n} ${pos}: board ${e.pts} vs sheet ${pts}`);
}
ok('the sheet has rows to check', checked > 300, checked + ' rows');
ok('every point total matches the served sheet', wrong.length === 0, wrong.slice(0, 5).join('; '));
ok('no sheet row is missing from the board', absent.length === 0, absent.slice(0, 5).join('; '));
// The sheet drops players the availability table has zeroed out; the board
// keeps them. Anything else on the board but off the sheet is a real gap.
const extra = [...map.keys()].filter(n => !raw.includes(n + '|' + map.get(n).pos + '|'));
ok('board rows absent from the sheet are all zero-point',
  extra.every(n => map.get(n).pts === 0), extra.filter(n => map.get(n).pts !== 0).join('; '));

// 3. Prices come off the worker's curve, and the floor is the worker's floor.
const te = lists.TE || [];
ok('the price floor is the worker\'s COLUMN_MIN_BID',
  price('TE', te.length - 1) === MIN_BID, 'got ' + price('TE', te.length - 1) + ', MIN_BID ' + MIN_BID);
ok('prices are non-increasing down a position',
  te.every((p, i) => i === 0 || price('TE', i) <= price('TE', i - 1)));

// 4. The numbers are LIFTED, not remembered. Build a worker with one constant
//    changed and require the harness to report the changed value. A file that
//    hard-codes the curve passes everything above and fails right here.
const tmp = path.join(os.tmpdir(), 'live-board-mutant-' + process.pid + '.js');
const original = fs.readFileSync(WORKER_PATH, 'utf8');
const mutated = original.replace(/((?:const|var) COLUMN_MIN_BID\s*=\s*)\d+/, '$17');
ok('the mutation applied', mutated !== original);
try {
  fs.writeFileSync(tmp, mutated);
  process.env.IRON_TUNA_WORKER = tmp;
  const m = await import('./live-board.mjs?mutant=1');
  ok('a changed COLUMN_MIN_BID is read, not assumed', m.MIN_BID === 7, 'got ' + m.MIN_BID);
  const mt = m.board(null, false).lists.TE;
  ok('the changed floor reaches the prices', m.price('TE', mt.length - 1) === 7,
    'got ' + m.price('TE', mt.length - 1));
} finally {
  delete process.env.IRON_TUNA_WORKER;
  try { fs.unlinkSync(tmp); } catch (e) { /* best effort */ }
}

// 5. Things the worker gained that the harness must not quietly ignore. These
//    are warnings against the repo worker, which has both.
ok('season normalisation is in play', !!NORM, 'COLUMN_NORM absent from ' + WORKER_PATH);
ok('availability is in play', hasAvailability, 'no availability table in ' + WORKER_PATH);

console.log(failed ? '\n' + failed + ' failure(s)' : '\nall checks passed');
process.exit(failed ? 1 : 0);
