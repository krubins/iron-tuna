// Rebuilds tools/nfl-headshots.json — the name -> headshot lookup that gives the
// front page lead its player photos.
//
// Source of truth is the nflverse players release (CC BY 4.0), the same project
// already credited in the front-page footer for game lines. We keep only the
// skill players who could plausibly be named in a 2026 auction call (QB/RB/WR/
// TE/FB, active in 2024 or later) and only the four fields the page actually
// renders, so the checked-in file stays small and diffable.
//
//   node tools/build-headshots.mjs        # refresh the lookup
//   node tools/build-front.mjs            # then re-embed the front page data
//
// The photos themselves are NOT vendored: `e` is an ESPN player id, which the
// page turns into a transparent-background cutout on ESPN's CDN, and `h` is the
// NFL's own headshot URL used as the fallback when ESPN has no image. Nothing
// here is fetched at page-build time, so a network blip can never blank the
// lead — it just leaves the lookup at its last good state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);
const MIN_LAST_SEASON = 2024;
// nflverse and the app's own PROJECTIONS block disagree on a few club codes.
// Normalise to the projections' spelling so one team lookup hits in both.
const TEAM_FIX = { LA: 'LAR', JAC: 'JAX', WSH: 'WAS', SD: 'LAC', OAK: 'LV', STL: 'LAR' };
const team = t => TEAM_FIX[t] || t || '';

// A minimal RFC-4180 row splitter: nflverse quotes any field containing a comma
// (the headshot URLs do, via Cloudinary's `f_auto,q_auto`), so a naive split on
// commas would shear those URLs in half.
function splitRow(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const slug = name => name.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const res = await fetch(SRC);
if (!res.ok) {
  console.error(`ABORT: nflverse players.csv returned ${res.status}`);
  process.exit(1);
}
const text = await res.text();
const lines = text.split('\n').filter(Boolean);
const head = splitRow(lines[0]);
const col = Object.fromEntries(head.map((h, i) => [h, i]));

const players = [];
const seen = new Set();
for (const line of lines.slice(1)) {
  const r = splitRow(line);
  const name = r[col.display_name];
  const pos = r[col.position];
  const last = +r[col.last_season] || 0;
  const espn = r[col.espn_id];
  const shot = r[col.headshot];
  if (!name || !POSITIONS.has(pos) || last < MIN_LAST_SEASON) continue;
  if (!espn && !shot) continue;                    // no photo, no point carrying them
  const key = slug(name);
  // Two players can share a name (and a slug). Prefer the one who played most
  // recently; a stale duplicate would otherwise put the wrong face on the lead.
  const prior = seen.has(key) ? players.find(p => p.k === key) : null;
  if (prior) { if (last > prior.s) Object.assign(prior, { t: team(r[col.latest_team]), p: pos, e: espn, h: shot, s: last }); continue; }
  seen.add(key);
  players.push({ k: key, n: name, t: team(r[col.latest_team]), p: pos, e: espn || '', h: shot || '', s: last });
}
players.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

const out = players.map(({ k, n, t, p, e, h }) => ({ k, n, t, p, e, h }));
fs.writeFileSync(
  path.join(root, 'tools/nfl-headshots.json'),
  JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n',
);
console.log(`tools/nfl-headshots.json: ${out.length} players`);
