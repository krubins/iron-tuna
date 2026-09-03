// Pulls the live "Vegas vs. Consensus" board the front page computes, using
// the worker's own code (lifted the same way tools/test-worker-column.mjs
// does) against the live nflverse game lines, and writes it to a JSON file for
// the podcast script. Production reads the same overlay out of D1; this runs
// the same functions off the same feed, with the committed availability list
// applied, so the numbers match what /api/vegas-column serves.
//
//   NODE_USE_ENV_PROXY=1 node tools/podcast/dump-column.mjs podcast/ep01-vegas-vs-adp.data.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(ROOT + '/_worker.js', 'utf8');
const START = '// Vegas-weighted projections';
const s = src.indexOf(START), e = src.indexOf('export default {', s);
const section = src.slice(s, e);
const harness = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null; ${section}
  return { applyAvailability, buildVegasColumn, fetchTeamEnvNflverse, buildTeamEnvOverlay, buildVegasBoard, buildVegasDigest, VEGAS_WEIGHT, COLUMN_CONTRACT };`);
const realPool = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m; const seg = src.slice(st, src.indexOf('\n];', st));
  while ((m = re.exec(seg))) { const stats = {}; for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); } out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats }); }
  return out;
})();
const L = harness(realPool, s => 'ENC', 'k', globalThis.fetch);
const raw = await L.fetchTeamEnvNflverse({});
const ppg = {}; for (const [t, v] of Object.entries(raw)) if (v && v.games > 0 && Number.isFinite(v.pf)) ppg[t] = v.pf / v.games;
const built = L.buildTeamEnvOverlay(raw);
const rank = {}; Object.entries(ppg).sort((a, b) => b[1] - a[1]).forEach(([t], i) => { rank[t] = i + 1; });
const ov = L.applyAvailability(built.overlay);
const col = L.buildVegasColumn(ov, { ppg, rank });
const board = L.buildVegasBoard(ov, { ppg, rank });
if (!process.argv[2]) { console.error('usage: dump-column.mjs <out.json>'); process.exit(1); }
fs.writeFileSync(process.argv[2], JSON.stringify({ pulledAt: new Date().toISOString(), contract: L.COLUMN_CONTRACT, vegasWeight: L.VEGAS_WEIGHT, ppg, rank, column: col, teamsPriced: Object.keys(ppg).length }, null, 1));
console.log('items', col.items.length, 'rows', board.rows.length, 'teams', Object.keys(ppg).length);
console.log(JSON.stringify(col.digest, null, 1).slice(0, 3000));
console.log(JSON.stringify(col.items[0], null, 1));
