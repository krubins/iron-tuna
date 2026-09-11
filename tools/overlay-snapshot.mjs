// Split a D1 result holding the whole `odds_overlay` table into per-position
// slices on disk.
//
// `odds_overlay` id 1 is UPDATED IN PLACE at the 7:00 AM ET refresh, so the
// board a story dates itself to is gone by the time an audit runs (HANDOFF
// §72c). Snapshotting it daily is the only way a printed figure from
// yesterday can be confirmed or refuted at all.
//
// The cheap way to get it out of D1 is to ask for every row at once:
//
//   SELECT id, provider, updated_at, payload FROM odds_overlay ORDER BY id
//
// which is ~90 KB and therefore too large to return inline, so the connector
// writes it to a file instead of spending it on context. Point this at that
// file:
//
//   node tools/overlay-snapshot.mjs <result-file> [outdir] [MMDD]
//
// and it writes qb/rb/wr/te-MMDD.json plus avail-MMDD.json, the shapes
// tools/live-board.mjs already reads.
import fs from 'fs';
import path from 'path';

const [src, outDir = '.', stamp] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/overlay-snapshot.mjs <d1-result-file> [outdir] [MMDD]');
  process.exit(2);
}
const raw = fs.readFileSync(src, 'utf8');
// The connector wraps results differently depending on size and version, so
// find the array rather than assuming a shape.
const parsed = JSON.parse(raw);
const rows = (Array.isArray(parsed) ? parsed : [parsed])
  .flatMap(r => (r && r.results) ? r.results : (Array.isArray(r) ? r : [r]))
  .filter(r => r && r.payload !== undefined);
if (!rows.length) { console.error('no rows with a payload in ' + src); process.exit(1); }

// Stamp each file by the date of the ROW IT CAME FROM, not by one row's date
// for all of them. The feeds do not share a cadence: on 2026-09-11 the player
// odds (id 1) were 34 hours stale while the injury feed (id 3) was 4 hours
// old. Stamping everything from id 1 wrote today's injuries into yesterday's
// avail file and destroyed the older one, which is the opposite of what a
// snapshot is for.
const dayOf = (updatedAt) => {
  const d = new Date(Number(updatedAt) || Date.now());
  return String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
};

fs.mkdirSync(outDir, { recursive: true });
const wrote = [];
const write = (name, obj, updatedAt) => {
  const day = stamp || dayOf(updatedAt);
  const f = path.join(outDir, name + '-' + day + '.json');
  const body = JSON.stringify(obj);
  // Never destroy a snapshot. Same content is a no-op; different content under
  // the same stamp means two different boards would share a filename, so say so
  // and keep the first.
  if (fs.existsSync(f)) {
    const had = fs.readFileSync(f, 'utf8');
    if (had === body) { wrote.push(`${name}-${day}: unchanged (${Object.keys(obj).length} keys)`); return; }
    wrote.push(`${name}-${day}: KEPT EXISTING, new content differs -- wrote ${name}-${day}.new.json instead`);
    fs.writeFileSync(f.replace(/\.json$/, '.new.json'), body);
    return;
  }
  fs.writeFileSync(f, body);
  wrote.push(`${name}-${day}: ${Object.keys(obj).length} keys`);
};

for (const row of rows) {
  const id = Number(row.id);
  let payload;
  try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; }
  catch (e) { console.error('row ' + id + ': unparseable payload, skipped'); continue; }
  if (id === 1) {
    // Player odds, keyed "<normalized name>|POS". Split by the suffix.
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const slice = {};
      for (const [k, v] of Object.entries(payload)) if (k.endsWith('|' + pos)) slice[k] = v;
      write(pos.toLowerCase(), slice, row.updated_at);
    }
  } else if (id === 3) {
    // The live injury feed, for setAvailability().
    write('avail', payload.players || payload, row.updated_at);
  }
}
// Report every row's age, because a feed that has quietly stopped is invisible
// otherwise -- and use the payload's own timestamps, never this machine's clock.
const now = Math.max(...rows.map(r => Number(r.updated_at) || 0));
console.log('snapshot: newest row ' + new Date(now).toISOString());
for (const r of rows) {
  const age = ((now - Number(r.updated_at)) / 3600000).toFixed(1);
  console.log(`  row ${r.id} (${r.provider}): ${new Date(Number(r.updated_at)).toISOString()}  ${age}h behind newest`);
}
wrote.forEach(w => console.log('  ' + w));
