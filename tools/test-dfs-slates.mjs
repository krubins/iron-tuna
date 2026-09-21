#!/usr/bin/env node
// The slate a stored salary row belongs to — dfs_salaries, /api/dfs, /api/admin/dfs.
//   node tools/test-dfs-slates.mjs
//
// WHAT THIS EXISTS FOR. dfs_salaries held one price list per site per week and
// dfsSalariesRead() took the newest one, whatever slate it was filed under. So
// the desk import REFUSED a single-game file outright: store a Showdown export
// anywhere in that table and the next reader asking for the Classic board gets
// six seats out of one game. The worker said as much where it refused — that
// importing one "deliberately needs that read to learn about slates first".
//
// This is that read having learned, and these are the four ways it goes wrong
// quietly:
//
//   1. THE FILTER. A classic read that does not exclude the single-game slates
//      serves a Captain board to everybody, which is the original hazard with
//      the guard removed.
//   2. THE TIMESTAMP. MAX(fetched_at) has to be taken WITHIN the slate. Across
//      the week, a Showdown import at 9am owns the newest timestamp, and a
//      classic read that filters afterwards finds nothing at all — the board
//      goes blank rather than wrong, which is harder to notice and just as bad.
//   3. THE CAPTAIN. A Showdown row is only distinguishable from its own FLEX
//      row by the Roster Position cell. If that column does not survive the
//      round trip, a stored slate is two prices for one man with no way to say
//      which is the multiplier seat.
//   4. THE MIGRATION. Production's table predates roster_position, so the
//      ALTER path is the one that actually runs. A test that only ever creates
//      the table fresh never exercises it.
//
// Real in-memory SQLite (node:sqlite) behind a D1-shaped shim, so the SQL under
// test is the worker's own rather than a mock that agrees with it.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) { /* older node */ }
if (!DatabaseSync) { console.log('  SKIP — this node has no node:sqlite'); process.exit(0); }

const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };
const TA = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TA[u] || u; };
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
function _csvSplit(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }

// A FRESH MODULE PER BLOCK. dfsReady() latches `_DFS_READY` once the DDL and
// the migrations have run, which is right in a worker isolate and wrong for a
// test that then hands it a second, empty database: the latch skips the
// migration and every INSERT fails against a table missing the column. One
// instance per block keeps each database paired with its own latch.
const makeH = () => new Function('teamKey', '_csvSplit', '_oddsNorm',
  cut('const DFS_SINGLE_FLEX', 'const SCORING_SITE = {') + '\n' +
  cut('const DFS_DDL = [', 'const DFS_FPPG_PINS = {') + '\n' +
  'return { DFS_DDL, dfsReady, dfsStore, dfsSalariesRead, dfsSingleSlates, dfsSlateShape, dfsCollapseSingleGame, parseDfsCsv, dfsSingleGameSlateKey, dfsIsSingleSlate, _dfsTierFrom, DFS_SITES };'
)(teamKey, _csvSplit, _oddsNorm);
const H = makeH();

// ── a D1-shaped shim over real SQLite ──────────────────────────────────────
// Only what the worker calls: prepare().bind().first()/.all()/.run() and
// batch(). PRAGMA comes back through .all() like any other read.
function fakeD1(db) {
  const run = (sql, args) => ({
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { db.prepare(sql).run(...args); return { meta: { changes: 1 } }; }
  });
  return {
    prepare(sql) { return { bind(...args) { return run(sql, args); }, first() { return run(sql, []).first(); }, all() { return run(sql, []).all(); }, run() { return run(sql, []).run(); } }; },
    batch: async (list) => Promise.all(list.map(s => s.run()))
  };
}
const freshEnv = (pre) => { const db = new DatabaseSync(':memory:'); if (pre) db.exec(pre); return { db, env: { LEADS_DB: fakeD1(db) } }; };

// ── the files ──────────────────────────────────────────────────────────────
const head = 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n';
const classicCsv = head
  + 'QB,"Josh Allen (1)",Josh Allen,1,QB,8200,BUF@NYJ 09/20/2026 01:00PM ET,BUF,24.1\n'
  + 'RB,"Breece Hall (2)",Breece Hall,2,RB/FLEX,7200,BUF@NYJ 09/20/2026 01:00PM ET,NYJ,17.5\n'
  + 'WR,"Amon-Ra St. Brown (3)",Amon-Ra St. Brown,3,WR/FLEX,8600,DET@GB 09/20/2026 04:25PM ET,DET,19.0\n';
// DraftKings prices the Captain as a second row for the same man, and the FLEX
// price here is NOT the classic price — that is the whole reason the file exists.
const showBufCsv = head
  + 'QB,"Josh Allen (1)",Josh Allen,1,CPT,17100,BUF@NYJ 09/20/2026 01:00PM ET,BUF,24.1\n'
  + 'QB,"Josh Allen (2)",Josh Allen,2,FLEX,11400,BUF@NYJ 09/20/2026 01:00PM ET,BUF,24.1\n'
  + 'RB,"Breece Hall (3)",Breece Hall,3,CPT,15300,BUF@NYJ 09/20/2026 01:00PM ET,NYJ,17.5\n'
  + 'RB,"Breece Hall (4)",Breece Hall,4,FLEX,10200,BUF@NYJ 09/20/2026 01:00PM ET,NYJ,17.5\n';
const showDetCsv = head
  + 'WR,"Amon-Ra St. Brown (5)",Amon-Ra St. Brown,5,CPT,16500,DET@GB 09/20/2026 04:25PM ET,DET,19.0\n'
  + 'WR,"Amon-Ra St. Brown (6)",Amon-Ra St. Brown,6,FLEX,11000,DET@GB 09/20/2026 04:25PM ET,DET,19.0\n'
  + 'WR,"Jayden Reed (7)",Jayden Reed,7,CPT,10500,DET@GB 09/20/2026 04:25PM ET,GB,12.0\n'
  + 'WR,"Jayden Reed (8)",Jayden Reed,8,FLEX,7000,DET@GB 09/20/2026 04:25PM ET,GB,12.0\n';

console.log('\nthe slate key');
{
  const show = H.parseDfsCsv('dk', showBufCsv);
  ok('a single-game file is keyed by its own two clubs, alphabetically',
     H.dfsSingleGameSlateKey(show.rows) === 'sd:BUF|NYJ', H.dfsSingleGameSlateKey(show.rows));
  // Alphabetical because that is the key dfs.html already builds for the game
  // the reader picked (gameKeyTeams). If the two ever drift, the page asks for
  // a slate the worker never wrote.
  ok('...which is the same string the page builds for that matchup',
     H.dfsSingleGameSlateKey(show.rows).slice(3) === ['NYJ', 'BUF'].sort().join('|'));
  ok('a file naming more than two clubs has no matchup to be filed under',
     H.dfsSingleGameSlateKey(H.parseDfsCsv('dk', classicCsv).rows) === null);
  ok('and the prefix is what marks one', H.dfsIsSingleSlate('sd:BUF|NYJ') && !H.dfsIsSingleSlate('main') && !H.dfsIsSingleSlate('weekly'));
}

console.log('\nthe round trip');
{
  const { env } = freshEnv();
  const store = (csv, slate, at) => {
    const rows = H.parseDfsCsv('dk', csv).rows;
    // Distinct fetched_at per import, which is the whole point of #2 above.
    const real = Date.now; Date.now = () => at;
    const p = H.dfsStore(env, 'dk', rows, { season: 2026, week: 2, slate, source: 'csv' });
    return p.finally(() => { Date.now = real; });
  };
  await store(classicCsv, 'weekly', 1000);
  // Both Showdown imports land AFTER the classic one, so a read that took the
  // newest row in the week would return a Captain board to everybody.
  await store(showBufCsv, 'sd:BUF|NYJ', 2000);
  await store(showDetCsv, 'sd:DET|GB', 3000);

  const classic = await H.dfsSalariesRead(env, 'dk', 2026, 2);
  ok('the classic read returns the classic slate, though two newer imports sit beside it',
     !!classic && classic.rows.length === 3 && classic.rows.every(r => r.slate === 'weekly'),
     classic ? classic.rows.length + ' rows, slates ' + [...new Set(classic.rows.map(r => r.slate))] : 'null');
  ok('...at the classic import’s own timestamp, not the week’s newest',
     classic.fetchedAt === 1000, String(classic && classic.fetchedAt));
  ok('...and it is still a classic slate to dfsSlateShape', H.dfsSlateShape(classic.rows) === 'classic');

  const buf = await H.dfsSalariesRead(env, 'dk', 2026, 2, 'sd:BUF|NYJ');
  ok('a named single-game slate returns only that game', !!buf && buf.rows.length === 4
     && buf.rows.every(r => r.team === 'BUF' || r.team === 'NYJ'), buf ? String(buf.rows.length) : 'null');
  ok('...and reads as a single-game file on the way back out', H.dfsSlateShape(buf.rows) === 'single-game');
  // #3: the column that makes a Captain findable.
  ok('the Roster Position cell survives the round trip',
     buf.rows.filter(r => r.rosterPosition === 'CPT').length === 2
     && buf.rows.filter(r => r.rosterPosition === 'FLEX').length === 2);
  const folded = H.dfsCollapseSingleGame(buf.rows, 'dk');
  ok('...so the two rows for one man fold into one', folded.length === 2);
  ok('...carrying DraftKings’ own Captain price, not 1.5x worked out here',
     folded.find(r => r.name === 'Josh Allen').salaryBySlot.CPT === 17100
     && folded.find(r => r.name === 'Josh Allen').salary === 11400);
  // And the price that came back is the SHOWDOWN price, which is the entire
  // reason a separate slate has to exist: Allen is $8,200 on the main slate.
  ok('...which is not the main slate’s price for the same player',
     classic.rows.find(r => r.name === 'Josh Allen').salary === 8200
     && folded.find(r => r.name === 'Josh Allen').salary !== 8200);

  const det = await H.dfsSalariesRead(env, 'dk', 2026, 2, 'sd:DET|GB');
  ok('a second single-game slate is kept apart from the first',
     !!det && det.rows.length === 4 && det.rows.every(r => r.team === 'DET' || r.team === 'GB'));
  const miss = await H.dfsSalariesRead(env, 'dk', 2026, 2, 'sd:KC|LAC');
  ok('a game nobody imported answers empty rather than with somebody else’s', miss === null);

  const list = await H.dfsSingleSlates(env, 'dk', 2026, 2);
  ok('the week lists the single games the desk holds',
     list.length === 2 && list.map(x => x.game).join() === 'BUF|NYJ,DET|GB', JSON.stringify(list.map(x => x.game)));
  ok('...with a row count and an import time for each',
     list.every(x => x.rows === 4 && Number.isFinite(x.fetchedAt)));
  ok('...and the classic slate is not among them', !list.some(x => x.slate === 'weekly'));
}

console.log('\nthe migration onto a table that predates the column');
{
  // Production's dfs_salaries was created before roster_position existed, and
  // CREATE TABLE IF NOT EXISTS will not add it. The ALTER in dfsReady() is the
  // path that actually runs there, so it is the one worth testing.
  const older = 'CREATE TABLE dfs_salaries (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, slate TEXT, season INTEGER, week INTEGER, name TEXT NOT NULL, position TEXT NOT NULL, team TEXT, opponent TEXT, salary INTEGER NOT NULL, site_id TEXT, source TEXT, fetched_at INTEGER NOT NULL)';
  const H = makeH();
  const { db, env } = freshEnv(older);
  const before = db.prepare('PRAGMA table_info(dfs_salaries)').all().map(c => c.name);
  ok('the older table has neither column', !before.includes('roster_position') && !before.includes('operator_fppg'));
  const r = await H.dfsStore(env, 'dk', H.parseDfsCsv('dk', showBufCsv).rows, { season: 2026, week: 2, slate: 'sd:BUF|NYJ', source: 'csv' });
  const after = db.prepare('PRAGMA table_info(dfs_salaries)').all().map(c => c.name);
  ok('dfsReady migrates it in place rather than dropping salary history',
     after.includes('roster_position') && after.includes('operator_fppg'), after.join(','));
  ok('...and the store that triggered it wrote every row', r.ok && r.stored === 4, JSON.stringify(r));
  const back = await H.dfsSalariesRead(env, 'dk', 2026, 2, 'sd:BUF|NYJ');
  ok('...which reads back with its seats intact',
     back.rows.filter(x => x.rosterPosition === 'CPT').length === 2);
}

console.log('\nwhat the unattended import is allowed to call success');
{
  // THE BUG THIS PINS. dfsStore() answers { ok, stored, attempted }; the
  // scheduled importer's guard read `body.imported.rows`, which no version of
  // that object has ever carried. `undefined < 40` is false, so the guard
  // passed every import — including one that stored nothing — and the line
  // that logs the count printed undefined, which JSON.stringify drops. The
  // Sept 16 production run's output has no `imported` key at all for exactly
  // that reason, which is why it could not be used to tell a full import from
  // an empty one.
  //
  // Two ends of one contract, written in two files. That is the same shape as
  // the bind/placeholder mismatch tools/test-worker-sql.mjs exists for, so it
  // gets the same treatment: assert the names actually match.
  const storeRet = cut('return { ok: true, stored: n', 'async function dfsSalariesRead');
  const imp = fs.readFileSync(path.join(ROOT, 'tools/import-draftkings-salaries.mjs'), 'utf8');
  ok('dfsStore reports both how many rows it tried and how many it saved',
     /stored: n/.test(storeRet) && /attempted: rows\.length/.test(storeRet));
  ok('the importer checks the field dfsStore actually returns',
     /body\.imported\.stored/.test(imp) && !/body\.imported\.rows/.test(imp));
  ok('...and refuses a store that saved fewer rows than it was given',
     /stored < attempted/.test(imp));
  ok('...and refuses a short store outright, so an empty import cannot pass',
     /stored < MIN_PLAYERS/.test(imp));
  // The number in the workflow log has to be the STORED one. Logging the count
  // fetched from DraftKings is what made a successful-looking run unreadable.
  ok('...and logs the stored count rather than the fetched one',
     /imported: stored/.test(imp));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
