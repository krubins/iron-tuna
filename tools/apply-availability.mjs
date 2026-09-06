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
//
// THE OTHER HALF: BENEFICIARIES. Taking six games off Josh Jacobs did not put
// those touches anywhere. Until 2026-09-06 this file only ever subtracted, so
// every other Green Bay back kept the line he had when Jacobs was projected for
// a full season, and the board answered a question nobody asked: what is Jacobs
// worth now. An entry may now carry
//
//   "beneficiaries": [ { "name": "MarShawn Lloyd", "position": "RB", "share": 0.55 } ]
//
// and the vacated line — season x gamesOut / seasonGames — is split by those
// shares and ADDED to each beneficiary's own row. Shares are a judgement about a
// depth chart, so they are hand-kept like everything else here; they must be
// positive, must not sum past 1 (a team cannot inherit more than was vacated),
// and what is left unclaimed is workload the board says goes nowhere it prices.
//
// A beneficiary's own full-season line is captured into `beneficiaryBases` the
// first time, exactly as `season` is captured for an absent player, so re-running
// is idempotent and removing the share restores him. A player may not be both
// absent and a beneficiary: one row cannot carry two stories, and the tool
// refuses to write it.
//
// The worker's BENEFICIARIES block is generated from the same arithmetic and
// carries `boost` = the factor the committed row now sits at over its own base.
// applyAvailability scales a beneficiary's cached overlay by it for the same
// reason it scales a listed player's down.

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
// Beneficiaries: shape, arithmetic, and the two ways a share can be nonsense.
const benSeen = new Set();
for (const e of entries) {
  const list = e.beneficiaries || [];
  if (!Array.isArray(list)) { problem(`${e.name}: beneficiaries must be a list`); continue; }
  if (list.length && !e.gamesOut) problem(`${e.name}: has beneficiaries but misses no games, so there is nothing to share`);
  let total = 0;
  for (const b of list) {
    if (!b || !b.name || !b.position) { problem(`${e.name}: malformed beneficiary ${JSON.stringify(b)}`); continue; }
    const share = Number(b.share);
    if (!(share > 0 && share <= 1)) { problem(`${e.name} -> ${b.name}: share ${b.share} must be above 0 and at most 1`); continue; }
    total += share;
    const bk = norm(b.name) + '|' + String(b.position).toUpperCase();
    if (seen.has(bk)) problem(`${b.name} is both an absent player and a beneficiary of ${e.name}; one row cannot carry both`);
    if (benSeen.has(bk + '<-' + norm(e.name))) problem(`${e.name} lists ${b.name} twice`);
    benSeen.add(bk + '<-' + norm(e.name));
  }
  if (total > 1.0000001) problem(`${e.name}: beneficiary shares sum to ${total.toFixed(3)}, more than the line he vacates`);
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
const changes = [];
let fileDirty = false;

// ── the committed rows, read once ──
// Everything below needs to see the whole board before it rewrites any of it: a
// beneficiary's new line is his own row plus a share of a DONOR's row, and the
// donor may sit later in the block than he does.
const parseStats = (name, pos, statsStr) => {
  const cur = {};
  for (const kv of statsStr.split(',')) {
    const m = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
    if (m) cur[m[1]] = parseFloat(m[2]);
  }
  if (statsStr.split(',').filter(x => x.trim()).length !== Object.keys(cur).length) {
    console.error(`ABORT: unparseable stat kv in entry for ${name} (${pos}): { ${statsStr} }`);
    process.exit(1);
  }
  return cur;
};
const curRows = new Map();
{
  let m; const re = new RegExp(entryRe.source, 'g');
  while ((m = re.exec(block))) {
    curRows.set(norm(m[1]) + '|' + m[2].toUpperCase(), { name: m[1], position: m[2], team: m[3], stats: parseStats(m[1], m[2], m[4]) });
  }
}
for (const [key, e] of byKey) if (!curRows.has(key)) problem(`${e.name} (${e.position}) is not in PROJECTIONS`);
if (bad) process.exit(1);

// First application: the committed row IS the full-season line. Captured here
// rather than inside the rewrite, because the beneficiary arithmetic below needs
// every donor's season line before a single row is touched.
for (const [key, e] of byKey) {
  if (!e.season) { e.season = { ...curRows.get(key).stats }; fileDirty = true; }
  const board = curRows.get(key);
  if (e.team && e.team !== board.team) console.log(`note: ${e.name} is ${board.team} on the board, ${e.team} in the file (board wins)`);
}

// ── the vacated line, moved onto the players who inherit it ──
// vacated = season x gamesOut / GAMES, the exact complement of the pro-rating
// applied to the donor's own row, so the two halves of one absence add back to
// the line the board started with (minus whatever share nobody claims).
const bases = file.beneficiaryBases || (file.beneficiaryBases = {});
const benTarget = new Map();   // key -> { stats, boost, from, notes }
for (const e of entries) {
  for (const b of e.beneficiaries || []) {
    const bk = norm(b.name) + '|' + String(b.position).toUpperCase();
    const row = curRows.get(bk);
    if (!row) { problem(`${e.name} -> ${b.name} (${b.position}) is not in PROJECTIONS`); continue; }
    const donor = curRows.get(norm(e.name) + '|' + String(e.position).toUpperCase());
    if (row.team !== donor.team) {
      problem(`${b.name} is ${row.team} and ${e.name} is ${donor.team}; a vacated line is inherited on the team it was vacated on`);
      continue;
    }
    if (!bases[bk]) { bases[bk] = { name: row.name, position: row.position, stats: { ...row.stats } }; fileDirty = true; }
    if (!benTarget.has(bk)) benTarget.set(bk, { base: bases[bk].stats, add: {}, from: [] });
    const t = benTarget.get(bk);
    for (const [k, v] of Object.entries(e.season)) {
      // Only stat keys the beneficiary's own line already carries. A back who
      // has never been thrown to does not acquire a receiving line because the
      // man in front of him had one; that is a projection, not arithmetic.
      if (!(k in t.base)) continue;
      t.add[k] = (t.add[k] || 0) + (v * e.gamesOut / GAMES) * Number(b.share);
    }
    // "Josh Jacobs'", not "Josh Jacobs's" — this string is shown to readers.
    const poss = /s$/i.test(e.name) ? e.name + "'" : e.name + "'s";
    t.from.push(`${Math.round(Number(b.share) * 100)}% of ${poss} ${e.gamesOut} missed games`);
  }
}
if (bad) process.exit(1);

// Resolve each beneficiary to a finished row plus the boost the worker needs.
for (const [bk, t] of benTarget) {
  const next = {};
  for (const [k, v] of Object.entries(t.base)) next[k] = round(k, v + (t.add[k] || 0), Number.isInteger(v));
  // One number for a whole row: what the row now sits at over its own base.
  // Scoring weights the keys differently, so this is the yardage-and-touches
  // ratio the overlay is scaled by, not a claim about any single stat.
  const sum = o => Object.entries(o).reduce((a, [k, v]) => a + (k === 'fumLost' ? 0 : Number(v) || 0), 0);
  const b0 = sum(t.base), b1 = sum(next);
  t.stats = next;
  t.boost = b0 > 0 ? Math.round((b1 / b0) * 1000) / 1000 : 1;
}

const newBlock = block.replace(entryRe, (full, name, pos, team, statsStr) => {
  const key = norm(name) + '|' + pos.toUpperCase();
  const e = byKey.get(key);
  const t = benTarget.get(key);
  if (!e && !t) return full;
  const cur = parseStats(name, pos, statsStr);
  let next, factor = 1;
  if (e) {
    factor = Math.max(0, Math.min(1, (GAMES - e.gamesOut) / GAMES));
    next = {};
    for (const k of Object.keys(cur)) {
      const base = k in e.season ? e.season[k] : cur[k];
      next[k] = round(k, base * factor, Number.isInteger(e.season[k] ?? cur[k]));
    }
  } else {
    next = t.stats;
    factor = t.boost;
  }
  const statsOut = Object.entries(next).map(([k, v]) => `${k}: ${v}`).join(', ');
  const out = `{ name: "${name}", position: "${pos}", team: "${team}", projectedStats: { ${statsOut} }}`;
  if (out !== full) changes.push({ name, pos, from: cur, to: next, factor });
  return out;
});


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

// ── the BENEFICIARIES block the request path reads ──
// Only the boost and the note travel: the share itself is a decision recorded in
// tools/availability.json, and the row it produced is already in PROJECTIONS.
const benEntries = [...benTarget.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const benLines = benEntries.map(([k, t]) => {
  const row = curRows.get(k);
  return '  ' + JSON.stringify(k) + ': ' + JSON.stringify({
    name: row.name, position: row.position, team: row.team, boost: t.boost,
    note: 'Inherits ' + t.from.join(' and ') + '.', asOf: file.asOf || ''
  });
}).join(',\n');
const benBlock = 'const BENEFICIARIES = {\n' + benLines + (benLines ? '\n' : '') + '};';
const benRe = /const BENEFICIARIES = \{[\s\S]*?\n?\};/;
if (!benRe.test(worker)) { console.error('ABORT: BENEFICIARIES block not found in _worker.js'); process.exit(1); }

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
  if (worker.match(benRe)[0] !== benBlock) { console.error('CHECK: BENEFICIARIES block in _worker.js is stale'); stale++; }
  if (idx.match(injRe)[0] !== injLine) { console.error('CHECK: INJURIES fallback in index.html is stale'); stale++; }
  if (fileDirty) { console.error('CHECK: an entry has no season line captured yet'); stale++; }
  if (stale) { console.error("Run: node tools/apply-availability.mjs"); process.exit(1); }
  console.log('availability: worker and client agree with the file');
  process.exit(0);
}

// ── write ──
let next = worker.slice(0, start) + newBlock + worker.slice(end + 3);
next = next.replace(availRe, availBlock);
next = next.replace(benRe, benBlock);
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
