#!/usr/bin/env node
// Put a player on the board who was never on it.
//
//   node tools/add-players.mjs            apply: insert the rows named in
//                                         tools/roster-additions.json, bump
//                                         PROJ_VERSION
//   node tools/add-players.mjs --check    CI: exit 1 if a listed player is not
//                                         on the board (no writes)
//   node tools/add-players.mjs --verify   confirm each listed player's team and
//                                         position against ESPN's live team
//                                         roster feed (no writes)
//
// WHY THIS EXISTS. PROJECTIONS is the whole board: a rank on this site is
// nothing but those rows scored. Every path into it refuses to change who is on
// it. tools/merge-projections.mjs is "existing roster only — no players are
// added or removed"; the availability pull only matches players already there
// (an unmatched feed entry is counted as `skipped.unlisted` and dropped);
// tools/apply-availability.mjs keeps even a zeroed player on the board because
// every generated index, face table and story test expects the roster fixed.
// That is all deliberate, and it left exactly one hole: a player the 2026-08-30
// upload did not carry could never get a row, however much the site's own desk
// wrote about him.
//
// It cost real advice. On 2026-09-05 the top card said "grab MarShawn Lloyd,
// Green Bay's lead back, for a few dollars" while Lloyd had no row, no rank and
// no price. Same for Jaylin Noel and Keenan Allen. tools/test-advice-names.mjs
// is the check that now fails when advice names somebody the board cannot
// price; this is the tool that fixes it.
//
// WHERE THE NUMBERS COME FROM, AND WHERE THEY DO NOT. Nothing here invents a
// projection. An entry carries either:
//
//   "stats": { ... }              an explicit full-season line, from a feed or
//                                 the owner's upload — used exactly as given
//   "basis": { "like": "<board player>", "scale": 0.6 }
//                                 project him as the board already projects a
//                                 named comparable, optionally scaled
//
// The comparable must already be on the board at the same position, so the stat
// keys and the rounding come from a row this repo already stands behind. A
// `like` line is an ESTIMATE and says so; it is a stand-in until a real
// projection arrives, not a claim to be one. `source` is required either way
// and is the note a reviewer reads instead of guessing.
//
// On first apply the derived line is written back into the file as `stats`, the
// way tools/apply-availability.mjs captures `season`. After that the row belongs
// to the board: tools/apply-availability.mjs may pro-rate it or move a share of
// an absent team-mate's line onto it, and --check here does NOT re-assert the
// basis. It asks only that the player is on the board. Row arithmetic is
// availability's to check.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, '_worker.js');
const INDEX = path.join(ROOT, 'index.html');
const FILE = path.join(ROOT, 'tools', 'roster-additions.json');
const CHECK = process.argv.includes('--check');
const VERIFY = process.argv.includes('--verify');

const norm = s => String(s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
  .replace(/[^a-z]/g, '');
// Rounded the way tools/merge-projections.mjs and tools/apply-availability.mjs
// round, so an added row is indistinguishable in shape from a merged one.
const INT_EXEMPT = ['passTD', 'passInt', 'rushTD', 'recTD', 'rec', 'fumLost'];
const round = (k, v, wasInt) => {
  const one = Math.round(v * 10) / 10;
  return wasInt && !INT_EXEMPT.includes(k) ? Math.round(v) : one;
};
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

let bad = 0;
const problem = m => { console.error('PROBLEM: ' + m); bad++; };

const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const entries = file.players || [];

const seen = new Set();
for (const e of entries) {
  if (!e.name || !e.position || !e.team) { problem(`malformed entry ${JSON.stringify(e)}`); continue; }
  const pos = String(e.position).toUpperCase();
  if (!POSITIONS.has(pos)) problem(`${e.name}: position ${e.position} is not one of ${[...POSITIONS].join(', ')}`);
  if (!e.source || !String(e.source).trim()) problem(`${e.name}: every addition needs a source`);
  const hasStats = e.stats && Object.keys(e.stats).length;
  const hasBasis = e.basis && e.basis.like;
  if (!hasStats && !hasBasis) problem(`${e.name}: needs either "stats" or "basis.like"`);
  if (e.basis && e.basis.scale != null && !(Number(e.basis.scale) > 0 && Number(e.basis.scale) <= 2)) {
    problem(`${e.name}: basis.scale ${e.basis.scale} outside 0..2`);
  }
  const k = norm(e.name) + '|' + pos;
  if (seen.has(k)) problem(`${e.name} (${pos}) listed twice`);
  seen.add(k);
}
if (bad) process.exit(1);

// ── the worker's PROJECTIONS, parsed the way the other tools parse them ──
const worker = fs.readFileSync(WORKER, 'utf8');
const start = worker.indexOf('const PROJECTIONS = [');
if (start < 0) { console.error('ABORT: PROJECTIONS not found'); process.exit(1); }
const end = worker.indexOf('\n];', start);
if (end < 0) { console.error('ABORT: PROJECTIONS terminator not found'); process.exit(1); }
const block = worker.slice(start, end + 3);
const entryRe = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;

const rows = [];
{
  let m; const re = new RegExp(entryRe.source, 'g');
  while ((m = re.exec(block))) {
    const stats = {};
    for (const kv of m[4].split(',')) {
      const kvm = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
      if (kvm) stats[kvm[1]] = parseFloat(kvm[2]);
    }
    rows.push({ name: m[1], position: m[2], team: m[3], stats, at: m.index, len: m[0].length });
  }
}
if (!rows.length) { console.error('ABORT: no PROJECTIONS rows parsed'); process.exit(1); }
const onBoard = new Map(rows.map(r => [norm(r.name) + '|' + r.position.toUpperCase(), r]));

// ── --check: CI only asks whether the listed players made it onto the board ──
if (CHECK) {
  const missing = entries.filter(e => !onBoard.has(norm(e.name) + '|' + String(e.position).toUpperCase()));
  const uncaptured = entries.filter(e => !(e.stats && Object.keys(e.stats).length));
  if (missing.length) console.error('CHECK: not on the board: ' + missing.map(e => `${e.name} (${e.position})`).join(', '));
  if (uncaptured.length) console.error('CHECK: no stat line captured yet for: ' + uncaptured.map(e => e.name).join(', '));
  if (missing.length || uncaptured.length) {
    console.error('Run: node tools/add-players.mjs');
    process.exit(1);
  }
  console.log(`roster additions: ${entries.length} player(s), all on the board`);
  process.exit(0);
}

// ── --verify: does this player actually play there? ──
// The one thing about an addition that an outside source can settle. ESPN's
// team roster feed is reachable from the sandbox where the projection feeds are
// not (HANDOFF §48), and it answers exactly the question a typo gets wrong.
if (VERIFY) {
  const TEAM_PATH = { LAR: 'lar', JAX: 'jax', LV: 'lv', WAS: 'wsh', NO: 'no', NYG: 'nyg', NYJ: 'nyj', SF: 'sf', TB: 'tb', GB: 'gb', KC: 'kc', NE: 'ne' };
  const byTeam = new Map();
  for (const e of entries) {
    const t = String(e.team).toUpperCase();
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(e);
  }
  let wrong = 0;
  for (const [team, list] of byTeam) {
    const slug = TEAM_PATH[team] || team.toLowerCase();
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${slug}/roster`;
    // Node's fetch ignores HTTPS_PROXY and the sandbox's egress needs it, so try
    // fetch first and fall back to curl, exactly as apply-availability.mjs does.
    let j = null;
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'iron-tuna-roster/1.0' } });
      if (r.ok) j = await r.json();
    } catch (e) { /* fall through to curl */ }
    if (!j) {
      try { j = JSON.parse(execFileSync('curl', ['-sS', '-m', '60', url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })); }
      catch (e) { console.error(`  ${team}: could not reach ESPN (${e.message}) — not verified`); wrong++; continue; }
    }
    const roster = new Map();
    for (const g of j.athletes || []) for (const a of g.items || []) {
      roster.set(norm(a.displayName), String((a.position || {}).abbreviation || '').toUpperCase().replace(/^PK$/, 'K'));
    }
    for (const e of list) {
      const pos = roster.get(norm(e.name));
      if (!pos) { console.error(`  MISS ${e.name}: not on ESPN's ${team} roster`); wrong++; }
      else if (pos !== String(e.position).toUpperCase()) { console.error(`  MISS ${e.name}: ESPN has him at ${pos}, the file says ${e.position}`); wrong++; }
      else console.log(`  ok   ${e.name} (${e.position}, ${team})`);
    }
  }
  console.log(wrong ? `\n${wrong} entr(ies) did not verify` : `\nall ${entries.length} verified against ESPN team rosters`);
  process.exit(wrong ? 1 : 0);
}

// ── build the rows to insert ──
const toInsert = [];
let fileDirty = false;
for (const e of entries) {
  const pos = String(e.position).toUpperCase();
  const key = norm(e.name) + '|' + pos;
  if (onBoard.has(key)) { console.log(`note: ${e.name} (${pos}) is already on the board — leaving his row alone`); continue; }

  let stats = null, how = '';
  if (e.stats && Object.keys(e.stats).length) {
    stats = { ...e.stats };
    how = 'from the file';
  } else {
    const like = onBoard.get(norm(e.basis.like) + '|' + pos);
    if (!like) { problem(`${e.name}: basis.like "${e.basis.like}" is not a ${pos} on the board`); continue; }
    const scale = e.basis.scale == null ? 1 : Number(e.basis.scale);
    stats = {};
    for (const [k, v] of Object.entries(like.stats)) stats[k] = round(k, v * scale, Number.isInteger(v));
    how = `like ${like.name} x${scale}`;
    // Capture it, the way apply-availability.mjs captures a season line: the
    // comparable's row will move, and this one must not move with it.
    e.stats = { ...stats };
    fileDirty = true;
  }
  toInsert.push({ name: e.name, position: pos, team: String(e.team).toUpperCase(), stats, how });
}
if (bad) process.exit(1);

console.log(`roster additions: ${entries.length} listed, ${toInsert.length} to insert`);
for (const r of toInsert) console.log(`  + ${r.name} (${r.position}, ${r.team}) ${r.how}: ${JSON.stringify(r.stats)}`);
if (!toInsert.length) { console.log('nothing to do'); process.exit(0); }

// ── insert ──
// After the last row of the same position, so the position groups the block is
// written in stay readable. The block already carries a tail of later additions
// in mixed order, so this is a tidiness rule, not a correctness one.
const lineOf = r => `  { name: "${r.name}", position: "${r.position}", team: "${r.team}", projectedStats: { ` +
  Object.entries(r.stats).map(([k, v]) => `${k}: ${v}`).join(', ') + ` }},`;

let nextBlock = block;
for (const r of toInsert) {
  // Re-parse each time so the offsets account for rows already inserted.
  const cur = [];
  let m; const re = new RegExp(entryRe.source, 'g');
  while ((m = re.exec(nextBlock))) cur.push({ position: m[2], at: m.index, len: m[0].length });
  const same = cur.filter(x => x.position.toUpperCase() === r.position);
  const anchor = (same.length ? same : cur)[(same.length ? same : cur).length - 1];
  // Past the row and its trailing comma, to the end of that line.
  let cut = anchor.at + anchor.len;
  while (cut < nextBlock.length && nextBlock[cut] !== '\n') cut++;
  nextBlock = nextBlock.slice(0, cut) + '\n' + lineOf(r) + nextBlock.slice(cut);
}
// The last row in the array may now carry a trailing comma. That is legal in a
// JS array literal, but the block is written without one, so put it back.
nextBlock = nextBlock.replace(/,(\s*)\n\];$/, '$1\n];');

let next = worker.slice(0, start) + nextBlock + worker.slice(end + 3);
fs.writeFileSync(WORKER, next);
try { execFileSync('node', ['--check', WORKER], { stdio: 'pipe' }); }
catch (e) { console.error('ABORT: worker no longer parses; reverting'); fs.writeFileSync(WORKER, worker); process.exit(1); }
// The rows have to come back out of the file the way every other tool reads
// them, or the addition is only half real.
{
  const b2 = next.slice(next.indexOf('const PROJECTIONS = ['), next.indexOf('\n];', next.indexOf('const PROJECTIONS = [')) + 3);
  const seenBack = new Set();
  let m; const re = new RegExp(entryRe.source, 'g');
  while ((m = re.exec(b2))) seenBack.add(norm(m[1]) + '|' + m[2].toUpperCase());
  const lost = toInsert.filter(r => !seenBack.has(norm(r.name) + '|' + r.position));
  if (lost.length) {
    console.error('ABORT: inserted rows do not parse back: ' + lost.map(r => r.name).join(', ') + '; reverting');
    fs.writeFileSync(WORKER, worker);
    process.exit(1);
  }
  console.log(`_worker.js updated: ${rows.length} rows -> ${seenBack.size}`);
}

const idx = fs.readFileSync(INDEX, 'utf8');
const d = new Date();
const ver = `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
const bumped = idx.replace(/const PROJ_VERSION = '[^']*';.*/, `const PROJ_VERSION = '${ver}'; // bumped ${file.asOf || ver}: roster additions (tools/roster-additions.json)`);
if (bumped !== idx) { fs.writeFileSync(INDEX, bumped); console.log('PROJ_VERSION ->', ver); }

if (fileDirty) {
  fs.writeFileSync(FILE, JSON.stringify(file, null, 2) + '\n');
  console.log('tools/roster-additions.json: derived stat lines captured');
}
console.log('now rebuild the generated data: node tools/build-front.mjs && node tools/build-default-board.mjs && node tools/build-worker-faces.mjs && node tools/build-seo.mjs');
console.log('done');
