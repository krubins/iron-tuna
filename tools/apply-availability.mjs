#!/usr/bin/env node
// Pro-rate the committed PROJECTIONS for players who cannot play a full season
// (injured reserve, PUP, suspension, the commissioner's exempt list), from the
// hand-kept list in tools/availability.json.
//
//   node tools/apply-availability.mjs            apply: rewrite the rows, the
//                                                AVAILABILITY block in _worker.js,
//                                                the INJURIES fallback in index.html,
//                                                and bump PROJ_VERSION
//   node tools/apply-availability.mjs --check    CI: exit 1 if any of those is out of
//                                                step with the file (no writes)
//   node tools/apply-availability.mjs --fetch    print players ESPN's public injury
//                                                feed lists as IR/Out/PUP/suspended
//                                                who are on the board but not in the
//                                                file, and file entries ESPN now
//                                                shows active (no writes)
//
// WHY THIS EXISTS. PROJECTIONS is a full-season stat line per player and the
// board's rank is nothing but those lines scored. The daily projections routine
// (HANDOFF.md §9) cannot reach any projection feed from its sandbox, and the odds
// refresh (§9b) is a per-TEAM scoring-environment factor that cannot see one
// player's knee. So a player who tore an ACL in August kept his August number,
// and his August rank, until somebody edited the row by hand. This makes that
// edit a data file with a source next to every number, keeps the full-season
// line so it can be restored, and lets CI hold the worker to the file.
//
// THE ARITHMETIC. row = season x (seasonGames - gamesOut) / seasonGames, rounded
// the way tools/merge-projections.mjs rounds (yards to integers where the line
// was an integer, expectations to one decimal). gamesOut >= seasonGames zeroes
// the line; the player stays on the board at the bottom of his position, because
// every generated index, face table and story test expects the roster fixed.
//
// The request path applies the same factor to the odds overlay (see
// applyAvailability in _worker.js), so a cached overlay built before the news
// cannot blend three quarters of the old line back in.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, '_worker.js');
const INDEX = path.join(ROOT, 'index.html');
const FILE = path.join(ROOT, 'tools', 'availability.json');
const CHECK = process.argv.includes('--check');
const FETCH = process.argv.includes('--fetch');

const norm = s => String(s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
  .replace(/[^a-z]/g, '');
const INT_EXEMPT = ['passTD', 'passInt', 'rushTD', 'recTD', 'rec', 'fumLost'];
const round = (k, v, wasInt) => {
  const one = Math.round(v * 10) / 10;
  return wasInt && !INT_EXEMPT.includes(k) ? Math.round(v) : one;
};

const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const GAMES = file.seasonGames || 17;
const entries = file.players || [];
let bad = 0;
const problem = m => { console.error('PROBLEM: ' + m); bad++; };

const seen = new Set();
for (const e of entries) {
  if (!e.name || !e.position || !e.status || !Number.isFinite(e.gamesOut)) problem(`malformed entry ${JSON.stringify(e)}`);
  if (e.gamesOut < 0 || e.gamesOut > GAMES) problem(`${e.name}: gamesOut ${e.gamesOut} outside 0..${GAMES}`);
  const k = norm(e.name) + '|' + String(e.position).toUpperCase();
  if (seen.has(k)) problem(`${e.name} (${e.position}) listed twice`);
  seen.add(k);
}
if (bad) process.exit(1);

// ── the worker's PROJECTIONS, parsed the way merge-projections.mjs parses them ──
let worker = fs.readFileSync(WORKER, 'utf8');
const start = worker.indexOf('const PROJECTIONS = [');
if (start < 0) { console.error('PROJECTIONS not found'); process.exit(1); }
const end = worker.indexOf('\n];', start);
if (end < 0) { console.error('PROJECTIONS terminator not found'); process.exit(1); }
const block = worker.slice(start, end + 3);
const entryRe = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;

const byKey = new Map(entries.map(e => [norm(e.name) + '|' + String(e.position).toUpperCase(), e]));
const matched = new Set();
const changes = [];
let fileDirty = false;

const newBlock = block.replace(entryRe, (full, name, pos, team, statsStr) => {
  const key = norm(name) + '|' + pos.toUpperCase();
  const e = byKey.get(key);
  if (!e) return full;
  matched.add(key);
  const cur = {};
  for (const kv of statsStr.split(',')) {
    const m = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
    if (m) cur[m[1]] = parseFloat(m[2]);
  }
  if (statsStr.split(',').filter(x => x.trim()).length !== Object.keys(cur).length) {
    console.error(`ABORT: unparseable stat kv in entry for ${name} (${pos}): { ${statsStr} }`);
    process.exit(1);
  }
  if (!e.season) {
    // First application: the committed row IS the full-season line. Keep it.
    e.season = { ...cur };
    fileDirty = true;
  }
  if (e.team && e.team !== team) {
    console.log(`note: ${name} is ${team} on the board, ${e.team} in the file (board wins)`);
  }
  const factor = Math.max(0, Math.min(1, (GAMES - e.gamesOut) / GAMES));
  const next = {};
  for (const k of Object.keys(cur)) {
    const base = k in e.season ? e.season[k] : cur[k];
    next[k] = round(k, base * factor, Number.isInteger(e.season[k] ?? cur[k]));
  }
  const statsOut = Object.entries(next).map(([k, v]) => `${k}: ${v}`).join(', ');
  const out = `{ name: "${name}", position: "${pos}", team: "${team}", projectedStats: { ${statsOut} }}`;
  if (out !== full) changes.push({ name, pos, from: cur, to: next, factor });
  return out;
});

for (const [key, e] of byKey) if (!matched.has(key)) problem(`${e.name} (${e.position}) is not in PROJECTIONS`);
if (bad) process.exit(1);

// ── the AVAILABILITY block the request path reads ──
const availObj = {};
for (const e of entries) {
  availObj[norm(e.name) + '|' + String(e.position).toUpperCase()] =
    { status: e.status, gamesOut: e.gamesOut, note: e.note || '', asOf: file.asOf || '' };
}
const availLines = Object.entries(availObj)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n');
const availBlock = `const AVAILABILITY_GAMES = ${GAMES};\nconst AVAILABILITY = {\n${availLines}\n};`;
const availRe = /const AVAILABILITY_GAMES = \d+;\nconst AVAILABILITY = \{[\s\S]*?\n\};/;
if (!availRe.test(worker)) { console.error('ABORT: AVAILABILITY block not found in _worker.js'); process.exit(1); }

// ── the client's INJURIES fallback (shown when /api/live is unreachable) ──
const idx = fs.readFileSync(INDEX, 'utf8');
const injRe = /const INJURIES = \[.*\];/;
if (!injRe.test(idx)) { console.error('ABORT: INJURIES not found in index.html'); process.exit(1); }
const label = e => {
  const what = e.gamesOut >= GAMES ? 'out for the season' : `out ${e.gamesOut}+ games`;
  return `${e.status}: ${what}`;
};
const injLine = 'const INJURIES = [' + entries.map(e =>
  `[/${e.name.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}/i, '${label(e).replace(/'/g, "\\'")}']`
).join(', ') + '];';

// ── report ──
console.log(`availability: ${entries.length} entries, ${changes.length} row(s) differ from the file`);
for (const c of changes) {
  console.log(`  ${c.name} (${c.pos}) x${c.factor.toFixed(3)}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
}

if (FETCH) {
  const feed = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
  // Node's fetch ignores HTTPS_PROXY, and the sandbox's egress needs it, so try
  // fetch first and fall back to curl, which honours the proxy and its CA bundle.
  let j = null;
  try {
    const r = await fetch(feed, { headers: { 'user-agent': 'iron-tuna-availability/1.0' } });
    if (r.ok) j = await r.json();
    else console.error(`fetch: ESPN injuries feed ${r.status}; trying curl`);
  } catch (e) { console.error(`fetch: ${e.message}; trying curl`); }
  if (!j) {
    try { j = JSON.parse(execFileSync('curl', ['-sS', '-m', '60', feed], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { console.error(`curl: ${e.message}`); process.exit(1); }
  }
  const board = new Map();
  let m; const re = new RegExp(entryRe.source, 'g');
  while ((m = re.exec(block))) board.set(norm(m[1]) + '|' + m[2].toUpperCase(), { name: m[1], team: m[3] });
  const LONG = /Injured Reserve|^Out$|Suspension|Physically|Exempt|Non-Football/i;
  const espn = new Map();
  for (const t of j.injuries || []) for (const i of t.injuries || []) {
    const a = i.athlete || {};
    const pos = ((a.position || {}).abbreviation || '').replace(/^PK$/, 'K');
    espn.set(norm(a.displayName) + '|' + pos, { status: i.status, type: (i.details || {}).type || '', ret: (i.details || {}).returnDate || '', note: (i.shortComment || '').slice(0, 160) });
  }
  console.log('\nESPN lists these board players as out multiple weeks and the file does not:');
  for (const [k, p] of board) {
    const s = espn.get(k);
    if (s && LONG.test(s.status) && !byKey.has(k)) console.log(`  ${p.name} (${k.split('|')[1]}, ${p.team}): ${s.status}, ${s.type}, return ${s.ret} — ${s.note}`);
  }
  console.log('\nFile entries ESPN no longer lists as out (consider gamesOut: 0):');
  for (const [k, e] of byKey) {
    const s = espn.get(k);
    if (!s || !LONG.test(s.status)) console.log(`  ${e.name}: ESPN says ${s ? s.status : 'not on the injury report'}`);
  }
  process.exit(0);
}

if (CHECK) {
  let stale = 0;
  if (changes.length) { console.error(`CHECK: ${changes.length} PROJECTIONS row(s) do not match tools/availability.json`); stale++; }
  if (worker.match(availRe)[0] !== availBlock) { console.error('CHECK: AVAILABILITY block in _worker.js is stale'); stale++; }
  if (idx.match(injRe)[0] !== injLine) { console.error('CHECK: INJURIES fallback in index.html is stale'); stale++; }
  if (fileDirty) { console.error('CHECK: an entry has no season line captured yet'); stale++; }
  if (stale) { console.error("Run: node tools/apply-availability.mjs"); process.exit(1); }
  console.log('availability: worker and client agree with the file');
  process.exit(0);
}

// ── write ──
let next = worker.slice(0, start) + newBlock + worker.slice(end + 3);
next = next.replace(availRe, availBlock);
let wrote = false;
if (next !== worker) {
  fs.writeFileSync(WORKER, next);
  try { execFileSync('node', ['--check', WORKER], { stdio: 'pipe' }); }
  catch (e) { console.error('ABORT: worker no longer parses; reverting'); fs.writeFileSync(WORKER, worker); process.exit(1); }
  wrote = true;
  console.log('_worker.js updated');
}
let nextIdx = idx.replace(injRe, injLine);
if (wrote || nextIdx !== idx) {
  const d = new Date();
  const ver = `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  const bumped = nextIdx.replace(/const PROJ_VERSION = '[^']*';.*/, `const PROJ_VERSION = '${ver}'; // bumped ${file.asOf || ver}: availability pro-rating (tools/availability.json)`);
  if (bumped !== nextIdx) console.log('PROJ_VERSION ->', ver);
  fs.writeFileSync(INDEX, bumped);
  console.log('index.html updated');
}
if (fileDirty) {
  fs.writeFileSync(FILE, JSON.stringify(file, null, 2) + '\n');
  console.log('tools/availability.json: season lines captured');
}
if (wrote) console.log('now rebuild the generated data: node tools/build-front.mjs && node tools/build-default-board.mjs && node tools/build-worker-faces.mjs && node tools/build-seo.mjs');
console.log('done');
