#!/usr/bin/env node
// Rebuilds `const LEAD_FACES = {...};` in _worker.js — the headshots the front
// page needs for a GENERATED lead story.
//   node tools/build-worker-faces.mjs [--dry-run]
//
// WHY THIS EXISTS
// front.html carries its own `PLAYERS` cast, built by tools/build-front.mjs from
// the players the AUTHORED drop pages happen to name. That is the right cast for
// the authored stories, and the wrong one for the generated lead: a run can name
// anybody on the board. It named Justin Jefferson and the front page had no
// photo of him, because no drop page had ever written about him. One face
// rendered for a four-player story.
//
// WHY IT GOES IN THE WORKER RATHER THAN IN front.html
// Widening `PLAYERS` would have cost every visitor about 39 KB on a 150 KB page,
// to carry photos that all but four of them are not going to see. _worker.js is
// never downloaded by a browser — it runs at the edge — so the map is free
// there, and only the handful of URLs a story actually needs ride along in the
// API payload.
//
// SCOPE: only players in PROJECTIONS. The insight desk is required to ground
// every named player in that pool, so it is exactly the set a story can name,
// and it keeps the map to a third of the full headshot release.
//
// Run this after tools/build-headshots.mjs, or whenever PROJECTIONS changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const WORKER = path.join(ROOT, '_worker.js');

const slug = name => String(name || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const heads = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'nfl-headshots.json'), 'utf8'));
const pool = Array.isArray(heads) ? heads : Object.values(heads);
const bySlug = new Map();
for (const h of pool) if (h && h.k && h.h) bySlug.set(h.k, h);

let src = fs.readFileSync(WORKER, 'utf8');
const ps = src.indexOf('const PROJECTIONS = [');
if (ps < 0) { console.error('ABORT: PROJECTIONS not found in _worker.js'); process.exit(1); }
const names = [...src.slice(ps, src.indexOf('\n];', ps)).matchAll(/\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)"/g)]
  .map(m => ({ name: m[1], pos: m[2], team: m[3] }));
if (names.length < 100) { console.error(`ABORT: only ${names.length} players parsed out of PROJECTIONS`); process.exit(1); }

const faces = {};
let missing = 0;
for (const p of names) {
  const k = slug(p.name);
  const h = bySlug.get(k);
  if (!h) { missing++; continue; }
  // `e` is the ESPN id, which discEl() in front.html tries before the nfl.com
  // URL. Carrying it keeps a fallback face pixel-identical to one served from
  // front.html's own cast.
  // The TEAM comes from PROJECTIONS, not from the headshot release: the release
  // is a season-start snapshot and goes stale on every trade, while PROJECTIONS
  // is the pool the whole site prices off. A face captioned with the wrong club
  // is worse than no face.
  faces[k] = { n: h.n, t: p.team, p: p.pos, e: h.e || undefined, h: h.h };
}

const block = 'const LEAD_FACES = ' + JSON.stringify(faces) + ';\n';
const re = /const LEAD_FACES = \{[\s\S]*?\};\n/;
if (!re.test(src)) { console.error('ABORT: could not find the LEAD_FACES declaration in _worker.js'); process.exit(1); }

const before = src;
src = src.replace(re, block);
if (DRY) {
  console.log(`LEAD_FACES: ${Object.keys(faces).length} faces, ${missing} of ${names.length} pool players have none, ${Math.round(block.length / 1024)} KB (dry run)`);
  process.exit(0);
}
fs.writeFileSync(WORKER, src);
// A worker that does not parse takes the whole site down, so never leave one
// behind: put the previous copy back and fail loudly instead.
// `node --check`, the same gate CI and HANDOFF use. vm.Script cannot be used
// here: _worker.js is an ES module and its `export default` is a syntax error
// to the script parser, so that check would fail on a perfectly good file.
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--check', WORKER], { encoding: 'utf8' });
  if (r.status !== 0) {
    fs.writeFileSync(WORKER, before);
    console.error('ABORT: the rewritten _worker.js does not parse, reverted:\n' + (r.stderr || '').trim());
    process.exit(1);
  }
}
console.log(`_worker.js: ${Object.keys(faces).length} lead faces (${missing} of ${names.length} pool players have no headshot), ${Math.round(block.length / 1024)} KB`);
