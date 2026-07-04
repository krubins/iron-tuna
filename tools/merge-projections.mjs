#!/usr/bin/env node
// Merge fresh third-party projection sources into _worker.js PROJECTIONS and
// bump PROJ_VERSION in index.html so the app re-baselines (and prompts users
// who have custom reorders).
//
// Usage:  node tools/merge-projections.mjs [--dry-run]
//
// Inputs: tools/sources/*.json — one file per source, produced by the daily
// update agent. Required shape:
//   {
//     "source": "espn" | "sportsline" | "nfl",
//     "publishedAt": "2026-07-05T00:00:00Z",   // when the SOURCE says the
//                                              // projections were made/updated
//     "fetchedAt": "2026-07-05T10:00:00Z",
//     "players": [
//       { "name": "Josh Allen", "position": "QB", "team": "BUF",
//         "stats": { "passYd": 3900, "passTD": 26, "passInt": 11,
//                    "rushYd": 560, "rushTD": 10, ... } }
//     ]
//   }
// Stat keys must use the site's names: passYd passTD passInt rushYd rushTD
// rec recYd recTD fumLost fgMade xpMade sacks interceptions ...  Unknown keys
// are ignored; missing keys fall back to the current value.
//
// Rules enforced here (fail-safe: any violation aborts with no changes):
//  - FRESHNESS: sources with publishedAt older than 7 days are DISCARDED.
//    Zero fresh sources -> exit 2 (nothing written) so the agent skips the day.
//  - Averaging: when 2+ fresh sources project the same player, each stat is
//    the mean of the sources that carry it; a lone source is used as-is.
//  - Existing roster only: players are matched by normalized name + position.
//    No players are added or removed; unmatched site players keep current
//    numbers, unmatched source players are reported and ignored.
//  - Sanity: player count unchanged, no NaN/negative stats, positional
//    leaders inside loose plausibility bands. Worker must still parse.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, '_worker.js');
const INDEX = path.join(ROOT, 'index.html');
const SRC_DIR = path.join(ROOT, 'tools', 'sources');
const DRY = process.argv.includes('--dry-run');
const MAX_AGE_DAYS = 7;

const norm = s => String(s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
  .replace(/[^a-z]/g, '');

// ---------------------------------------------------------------- sources
if (!fs.existsSync(SRC_DIR)) {
  console.error('no tools/sources directory — nothing to merge');
  process.exit(2);
}
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.json'));
const now = Date.now();
const fresh = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')); }
  catch (e) { console.error(`SKIP ${f}: unparseable (${e.message})`); continue; }
  if (!j.source || !Array.isArray(j.players) || !j.players.length) {
    console.error(`SKIP ${f}: missing source/players`); continue;
  }
  const pub = Date.parse(j.publishedAt || '');
  if (!Number.isFinite(pub)) {
    console.error(`SKIP ${f} (${j.source}): no verifiable publishedAt — freshness rule requires one`);
    continue;
  }
  const ageDays = (now - pub) / 86400000;
  if (ageDays > MAX_AGE_DAYS) {
    console.error(`SKIP ${f} (${j.source}): ${ageDays.toFixed(1)} days old (> ${MAX_AGE_DAYS})`);
    continue;
  }
  if (ageDays < -1) {
    console.error(`SKIP ${f} (${j.source}): publishedAt is in the future`);
    continue;
  }
  console.log(`USE  ${f} (${j.source}): ${j.players.length} players, ${ageDays.toFixed(1)} days old`);
  fresh.push(j);
}
if (!fresh.length) {
  console.error('NO FRESH SOURCES within the last 7 days — skipping update (no changes made)');
  process.exit(2);
}

// index source players by normalized name+position
const bySource = fresh.map(j => {
  const map = new Map();
  for (const p of j.players) {
    if (!p.name || !p.position || !p.stats) continue;
    map.set(norm(p.name) + '|' + String(p.position).toUpperCase(), p.stats);
  }
  return { source: j.source, map };
});

// ---------------------------------------------------------------- worker
const w = fs.readFileSync(WORKER, 'utf8');
const start = w.indexOf('const PROJECTIONS = [');
if (start < 0) { console.error('PROJECTIONS not found'); process.exit(1); }
const end = w.indexOf('\n];', start);
if (end < 0) { console.error('PROJECTIONS terminator not found'); process.exit(1); }
const block = w.slice(start, end + 3);

const entryRe = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
let updated = 0, kept = 0, total = 0;
const matchedSourceKeys = new Set();
const newBlock = block.replace(entryRe, (full, name, pos, team, statsStr) => {
  total++;
  const key = norm(name) + '|' + pos.toUpperCase();
  const cur = {};
  for (const kv of statsStr.split(',')) {
    const m = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
    if (m) cur[m[1]] = parseFloat(m[2]);
  }
  const samples = {};
  let hit = false;
  for (const s of bySource) {
    const st = s.map.get(key);
    if (!st) continue;
    hit = true;
    matchedSourceKeys.add(key);
    for (const [k, v] of Object.entries(st)) {
      if (!(k in cur)) continue;               // only stats the site models
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      (samples[k] = samples[k] || []).push(n);
    }
  }
  if (!hit) { kept++; return full; }
  updated++;
  const merged = { ...cur };
  for (const [k, arr] of Object.entries(samples)) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    merged[k] = Math.round(avg * 10) / 10;
    if (Number.isInteger(cur[k]) && ['passTD', 'passInt', 'rushTD', 'recTD', 'rec', 'fumLost'].includes(k) === false) {
      merged[k] = Math.round(avg);
    }
  }
  const statsOut = Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join(', ');
  return `{ name: "${name}", position: "${pos}", team: "${team}", projectedStats: { ${statsOut} }}`;
});

// report source players that matched nothing (informational)
for (const s of bySource) {
  const misses = [...s.map.keys()].filter(k => !matchedSourceKeys.has(k));
  if (misses.length) console.log(`note: ${s.source} had ${misses.length} players not on the site roster (ignored)`);
}

// ---------------------------------------------------------------- sanity
const count = (str) => (str.match(/\{ name: "/g) || []).length;
if (count(newBlock) !== count(block)) { console.error('ABORT: player count changed'); process.exit(1); }
if (/NaN|Infinity|: -\d/.test(newBlock)) { console.error('ABORT: bad numeric values'); process.exit(1); }
const bandCheck = (re, lo, hi, label) => {
  let max = 0, m;
  const r = new RegExp(re, 'g');
  while ((m = r.exec(newBlock))) max = Math.max(max, parseFloat(m[1]));
  if (max < lo || max > hi) { console.error(`ABORT: ${label} leader ${max} outside [${lo}, ${hi}]`); process.exit(1); }
};
bandCheck('passYd: ([\\d.]+)', 3000, 6200, 'passYd');
bandCheck('rushYd: ([\\d.]+)', 900, 2500, 'rushYd');
bandCheck('recYd: ([\\d.]+)', 900, 2200, 'recYd');
const MIN_MATCHED = parseInt(process.env.MIN_MATCHED || '25', 10);
if (updated < MIN_MATCHED) { console.error(`ABORT: only ${updated} players matched (min ${MIN_MATCHED}) — sources look wrong`); process.exit(1); }

console.log(`merge ok: ${updated} players updated from ${fresh.length} fresh source(s), ${kept} unchanged, ${total} total`);
if (DRY) { console.log('dry run — no files written'); process.exit(0); }

// ---------------------------------------------------------------- write
fs.writeFileSync(WORKER, w.slice(0, start) + newBlock + w.slice(end + 3));
try { execFileSync('node', ['--check', WORKER], { stdio: 'pipe' }); }
catch (e) { console.error('ABORT: worker no longer parses; reverting'); fs.writeFileSync(WORKER, w); process.exit(1); }

// bump PROJ_VERSION (date-stamped) so clients re-baseline & prompt reorders
const idx = fs.readFileSync(INDEX, 'utf8');
const d = new Date();
const ver = `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
const bumped = idx.replace(/const PROJ_VERSION = '[^']*';/, `const PROJ_VERSION = '${ver}';`);
if (bumped === idx) { console.error('WARN: PROJ_VERSION not found/bumped'); }
else { fs.writeFileSync(INDEX, bumped); console.log('PROJ_VERSION ->', ver); }
console.log('done');
