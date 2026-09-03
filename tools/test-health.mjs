#!/usr/bin/env node
// The health board (Step 29): the job log, the assessment of what is missing
// or stale, the editorial actions, and the cron handler running every job
// through the log.
//   node tools/test-health.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };

// A fake D1: records every statement, answers from a small script.
function fakeDb(answers) {
  const log = [];
  const db = { log, prepare(sql) { return { bind(...args) { return stmt(sql, args); }, run() { return stmt(sql, []).run(); }, first() { return stmt(sql, []).first(); }, all() { return stmt(sql, []).all(); } }; } };
  const stmt = (sql, args) => {
    const rec = { sql, args }; log.push(rec);
    const a = (answers || []).find(x => x.match.test(sql));
    return { async run() { if (a && a.throws) throw new Error(a.throws); return { meta: { changes: a && a.changes || 0 } }; },
             async first() { if (a && a.throws) throw new Error(a.throws); return a ? (typeof a.first === 'function' ? a.first(args) : a.first || null) : null; },
             async all() { if (a && a.throws) throw new Error(a.throws); return { results: a ? (typeof a.all === 'function' ? a.all(args) : a.all || []) : [] }; } };
  };
  return db;
}

// Lift the block with stubs for the jobs and the desk functions it names.
const calls = [];
const stubs = {
  runScheduleRefresh: async () => { calls.push('schedule'); return { ok: true, games: 272 }; },
  runOddsRefresh: async () => { calls.push('odds'); throw new Error('the books did not answer'); },
  runAvailabilityRefresh: async () => ({ ok: false, error: 'espn 403' }),
  runMarketSnapshot: async () => ({ ok: true, written: 12 }),
  runUsageRefresh: async () => ({ ok: true }), runDfsRefresh: async () => ({ ok: true }), runDepthChartRefresh: async () => ({ ok: true }),
  runRosSnapshot: async () => ({ ok: true }), snapshotPrune: async () => ({ ok: true }), pruneAnalytics: async () => ({ ok: true }), runContentTick: async () => ({ ok: true, results: [] }),
  SNAP_KEEP_DAYS: 200, DEPTH_ROW: 6,
  scheduleCacheRead: async () => null, nflSeasonState: () => ({ ok: false }), oddsCacheRead: async () => null, snapshotStatus: async () => null, usageCacheRead: async () => null,
  availabilityCacheRead: async () => null, rosSnapshots: async () => [], dfsSalariesRead: async () => null, providerReport: () => ({ providers: {}, unavailable: {} }),
  etParts: () => ({ dow: 'Tue', hour: 9 }), contentReady: async () => true,
  CONTENT_KINDS: { 'team-recaps': { title: 'Team-by-Team Recaps', day: 'Mon', hour: 6 }, 'final-read': { title: 'The Final Read', day: 'Thu', hour: 6 } },
  CONTENT_SECTIONS: { 'team-recaps': ['recaps'] },
  contentDue: () => ({ due: false, ready: false, reason: 'not_regular_season' }),
  produceContent: async (env, kind, o) => ({ ok: true, kind, week: 3, status: 'published', forced: !!(o && o.force) }),
  validateDraft: (text, allowed) => { const bad = (text.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || []).filter(n => !(allowed.names || []).includes(n)); return { ok: !bad.length, names: bad, numbers: [] }; }
};
const H = new Function(...Object.keys(stubs), cut('// -- the job log and the health board', '// Memoized per isolate alongside _PROJ_ENC') +
  '\nreturn { JOB_FNS, jobRun, jobBoard, jobPrune, healthAssess, healthPayload, contentAdmin, CONTENT_ACTIONS, HEALTH_STALE_H };')(...Object.values(stubs));

console.log('\nthe job log');
{
  const db = fakeDb([]);
  const env = { LEADS_DB: db };
  const r = await H.jobRun(env, 'schedule-refresh', '0 11 * * *');
  ok('a job that succeeds returns its result', r.ok === true && r.games === 272);
  const ins = db.log.filter(x => /INSERT INTO job_runs/.test(x.sql));
  ok('and logs one row with the job, the trigger and ok=1', ins.length === 1 && ins[0].args[0] === 'schedule-refresh' && ins[0].args[1] === '0 11 * * *' && ins[0].args[4] === 1 && ins[0].args[5] === null);
  ok('the summary is what the job returned', /"games":272/.test(ins[0].args[6]));
  const bad = await H.jobRun(env, 'odds-refresh', 'admin');
  ok('a job that throws is a logged failure, not an exception', bad.ok === false && /books did not answer/.test(bad.error));
  const ins2 = db.log.filter(x => /INSERT INTO job_runs/.test(x.sql));
  ok('with ok=0 and the error text', ins2[1].args[4] === 0 && /books did not answer/.test(ins2[1].args[5]));
  const soft = await H.jobRun(env, 'availability-refresh', 'admin');
  ok('a job that returns ok:false is a failure too', soft.ok === false && db.log.filter(x => /INSERT INTO job_runs/.test(x.sql))[2].args[5] === 'espn 403');
  ok('an unknown job is refused', (await H.jobRun(env, 'reboot-the-moon', 'admin')).error === 'unknown_job');
  ok('every job the cron runs is in the table', ['schedule-refresh', 'odds-refresh', 'availability-refresh', 'market-snapshot', 'usage-refresh', 'dfs-refresh', 'depth-charts', 'ros-snapshot', 'snapshot-prune', 'analytics-prune', 'content-tick'].every(j => H.JOB_FNS[j]));
  ok('no database means no log and no crash', (await H.jobRun({}, 'schedule-refresh', 'x')).ok === true);
  const now = Date.now();
  const rows = [{ job: 'odds-refresh', trigger: 'cron', started_at: now - 3600000, finished_at: now - 3599000, ok: 0, error: 'boom', summary: null },
                { job: 'odds-refresh', trigger: 'cron', started_at: now - 90000000, finished_at: now - 89999000, ok: 1, error: null, summary: '{}' },
                { job: 'schedule-refresh', trigger: 'cron', started_at: now - 60000, finished_at: now - 59000, ok: 1, error: null, summary: '{}' }];
  const db2 = fakeDb([{ match: /FROM job_runs WHERE started_at >=/, all: rows }, { match: /MAX\(started_at\) AS last_ok/, all: [{ job: 'usage-refresh', last_ok: now - 5e8 }] }]);
  const board = await H.jobBoard({ LEADS_DB: db2 }, now);
  const odds = board.jobs.find(j => j.job === 'odds-refresh');
  ok('the board names the last run and the last success per job', odds.last.ok === false && odds.last.error === 'boom' && odds.lastOk === now - 90000000 && odds.failures7d === 1);
  ok('a job with no run in the window still shows its older success', board.jobs.find(j => j.job === 'usage-refresh').lastOk === now - 5e8);
  ok('a job that has never run is listed as such', board.jobs.find(j => j.job === 'content-tick').last === null);
  ok('the failures list is newest first and carries the duration', board.failed.length === 1 && board.failed[0].ms === 1000);
  const pr = await H.jobPrune({ LEADS_DB: fakeDb([{ match: /DELETE FROM job_runs/, changes: 7 }]) }, 45);
  ok('pruning reports what it deleted', pr.ok && pr.deleted === 7);
}

console.log('\nthe assessment');
{
  const now = Date.UTC(2026, 8, 22, 14, 0, 0); // Tue Sep 22 2026, Week 3
  const h = ms => now - ms * 3600000;
  const regular = { ok: true, phase: 'regular', week: { type: 'REG', number: 3 } };
  const fresh = { state: regular, llm: true, jobs: { failed: [] },
    updates: { schedule: { updatedAt: h(2) }, odds: { updatedAt: h(3) }, snapshots: { last: h(1) }, usage: { updatedAt: h(20), throughWeek: 2 }, availability: { updatedAt: h(3) },
               depthCharts: { updatedAt: h(30) }, rankings: { ros: { builtAt: h(100), week: 3 } }, dfs: { dk: { fetchedAt: h(10) }, fd: null } },
    sources: { odds: [{ name: 'the-odds-api', configured: true }], stats: [{ name: 'nflverse', configured: true }] } };
  const a = H.healthAssess(fresh, now);
  ok('a fresh in-season system is ok', a.status === 'ok' && a.inSeason && a.missing.length === 0 && a.stale.length === 0, JSON.stringify(a.missing) + JSON.stringify(a.stale));
  ok('ages are reported in hours', a.ages.odds === 3 && a.ages.snapshots === 1);
  const noSched = H.healthAssess({ ...fresh, state: { ok: false }, updates: { ...fresh.updates, schedule: null } }, now);
  ok('no schedule is down, and says every surface is dark', noSched.status === 'down' && noSched.missing.some(m => m.feed === 'schedule' && /dark/.test(m.why)));
  const stale = H.healthAssess({ ...fresh, updates: { ...fresh.updates, odds: { updatedAt: h(40) }, snapshots: { last: h(31) } } }, now);
  ok('an old overlay and an old snapshot are stale, with the limit named', stale.status === 'degraded' && stale.stale.length === 2 && stale.stale[0].limitHours === H.HEALTH_STALE_H.odds);
  const noUsage = H.healthAssess({ ...fresh, updates: { ...fresh.updates, usage: null } }, now);
  ok('in season, a missing usage overlay is a missing feed', noUsage.missing.some(m => m.feed === 'usage'));
  const pre = H.healthAssess({ ...fresh, state: { ok: true, phase: 'preseason', week: { type: 'PRE', number: 2 } }, updates: { ...fresh.updates, usage: null, depthCharts: null, rankings: {}, dfs: {} } }, now);
  ok('in preseason the in-season feeds are not demanded', pre.status === 'ok' && !pre.inSeason, JSON.stringify(pre.missing));
  const noRos = H.healthAssess({ ...fresh, updates: { ...fresh.updates, rankings: { ros: null } } }, now);
  ok('no Wednesday snapshot is a missing feed in season', noRos.missing.some(m => m.feed === 'rankings'));
  const oldRos = H.healthAssess({ ...fresh, state: { ...regular, week: { type: 'REG', number: 6 } }, updates: { ...fresh.updates, rankings: { ros: { builtAt: h(500), week: 3 } } } }, now);
  ok('a snapshot from three weeks ago is stale, and says which weeks', oldRos.stale.some(s => s.feed === 'rankings' && /week 3, now week 6/.test(s.note)));
  const noDfs = H.healthAssess({ ...fresh, updates: { ...fresh.updates, dfs: { dk: null, fd: null } } }, now);
  ok('no salaries on either site is a missing feed', noDfs.missing.some(m => m.feed === 'dfs'));
  const noKey = H.healthAssess({ ...fresh, llm: false }, now);
  ok('no writer key is named, with what it costs', noKey.missing.some(m => m.feed === 'llm' && /held/.test(m.why)));
  const noSrc = H.healthAssess({ ...fresh, sources: { odds: [{ name: 'the-odds-api', configured: false }, { name: 'sportsdata', configured: false }] } }, now);
  ok('a kind with no configured source is a missing feed naming the sources', noSrc.missing.some(m => m.feed === 'source:odds' && /the-odds-api, sportsdata/.test(m.why)));
  const failed = H.healthAssess({ ...fresh, jobs: { failed: [{ job: 'odds-refresh' }] } }, now);
  ok('a failed job degrades the status', failed.status === 'degraded' && failed.failedJobs === 1);
  const behind = H.healthAssess({ ...fresh, state: { ...regular, week: { type: 'REG', number: 6 } }, updates: { ...fresh.updates, usage: { updatedAt: h(2), throughWeek: 3 }, rankings: { ros: { builtAt: h(2), week: 6 } } } }, now);
  ok('a usage overlay two weeks behind the week is stale even when freshly pulled', behind.stale.some(s => s.feed === 'usage' && /through week 3/.test(s.note)));
}

console.log('\nthe payload');
{
  const p = await H.healthPayload({ LEADS_DB: fakeDb([]) }, {});
  ok('with nothing loaded the payload still answers', p.ok && p.status === 'down' && p.week === null);
  ok('it lists every job and every kind', p.jobNames.length === Object.keys(H.JOB_FNS).length && p.editorial.length === 2 && p.editorial[0].kind === 'team-recaps');
  ok('an editorial row says why it is not due', p.editorial[0].reason === 'not_regular_season' && p.editorial[0].piece === null);
  ok('the ran field carries an admin rerun', (await H.healthPayload({ LEADS_DB: fakeDb([]) }, { ran: { job: 'x', ok: true } })).ran.job === 'x');
}

console.log('\nthe editorial actions');
{
  const held = { id: 9, kind: 'team-recaps', season: 2026, week: 3, title: 'Team-by-Team Recaps · Week 3', status: 'held', created_at: 1, published_at: null,
                 body: JSON.stringify({ recaps: 'Sam Smith scored twice.' }), brief: JSON.stringify({ allowed: { names: ['Sam Smith'], numbers: [] } }), violations: JSON.stringify(['Pat Jones']), model: 'm' };
  const mk = (row) => fakeDb([{ match: /SELECT \* FROM content_pieces/, first: { ...row } }]);
  ok('every action is named', H.CONTENT_ACTIONS.join(',') === 'preview,publish,unpublish,regenerate,edit');
  ok('an unknown action or kind is refused', (await H.contentAdmin({ LEADS_DB: mk(held) }, 'delete', 'team-recaps', 2026, 3)).error === 'unknown_action' && (await H.contentAdmin({ LEADS_DB: mk(held) }, 'preview', 'nope', 2026, 3)).error === 'unknown_kind');
  const pv = await H.contentAdmin({ LEADS_DB: mk(held) }, 'preview', 'team-recaps', 2026, 3);
  ok('preview returns the held body and its violations, which the public payload hides', pv.ok && pv.piece.status === 'held' && pv.piece.body.recaps && pv.piece.violations[0] === 'Pat Jones');
  const db = mk(held);
  const pub = await H.contentAdmin({ LEADS_DB: db }, 'publish', 'team-recaps', 2026, 3);
  const upd = db.log.find(x => /UPDATE content_pieces SET status/.test(x.sql));
  ok('publish flips the latest row to published with a timestamp', pub.ok && pub.piece.status === 'published' && upd.args[0] === 'published' && upd.args[1] > 0 && upd.args[2] === 9);
  ok('a row with no draft cannot be published', (await H.contentAdmin({ LEADS_DB: mk({ ...held, body: null }) }, 'publish', 'team-recaps', 2026, 3)).error === 'no_body');
  const db2 = mk({ ...held, status: 'published' });
  const un = await H.contentAdmin({ LEADS_DB: db2 }, 'unpublish', 'team-recaps', 2026, 3);
  ok('unpublish sets the status the public payload filters out', un.ok && un.piece.status === 'unpublished' && db2.log.some(x => /UPDATE content_pieces SET status/.test(x.sql) && x.args[0] === 'unpublished'));
  ok('nothing to act on is not_found', (await H.contentAdmin({ LEADS_DB: fakeDb([]) }, 'publish', 'team-recaps', 2026, 3)).error === 'not_found');
  const rg = await H.contentAdmin({ LEADS_DB: mk(held) }, 'regenerate', 'team-recaps', 2026, 3);
  ok('regenerate produces the piece now, forced past the due/ready gate', rg.ok && rg.forced === true && rg.status === 'published');
  const db3 = mk(held);
  const ed = await H.contentAdmin({ LEADS_DB: db3 }, 'edit', 'team-recaps', 2026, 3, { recaps: 'Sam Smith scored twice. Pat Jones did not play.' });
  const bodyUpd = db3.log.find(x => /UPDATE content_pieces SET body/.test(x.sql));
  ok('edit stores the editor\'s body on the latest row', ed.ok && bodyUpd && /did not play/.test(bodyUpd.args[0]) && bodyUpd.args[2] === 'editor');
  ok('and reports, without blocking, what the brief does not contain', ed.warnings.length === 1 && ed.warnings[0] === 'Pat Jones' && ed.piece.violations[0] === 'Pat Jones');
  ok('edit keeps the status; publishing is its own act', ed.piece.status === 'held');
  ok('a body that is not an object is refused', (await H.contentAdmin({ LEADS_DB: mk(held) }, 'edit', 'team-recaps', 2026, 3, 'hello')).error === 'bad_body');
}

console.log('\nthe worker source');
{
  const sched = cut('  async scheduled(event, env, ctx) {', '\nfunction originAllowed(');
  const bare = (sched.match(/ctx\.waitUntil\((run[A-Z][A-Za-z]*|snapshotPrune|pruneAnalytics)\(/g) || []).filter(x => !/runXAutoPost/.test(x));
  ok('every scheduled job runs through the log', bare.length === 0, bare.join(','));
  ok('the X auto-post stays where it was', /runXAutoPost\(env/.test(sched));
  ok('the public content list hides unpublished pieces', /status != 'unpublished' ORDER BY created_at DESC LIMIT 60/.test(src));
  ok('the public piece payload does too', /if \(!row \|\| row\.status === 'unpublished'\) return \{ ok: false, error: 'not_found'/.test(src));
  ok('the health route exists and takes a rerun', /url\.pathname === '\/api\/admin\/health'/.test(src) && /searchParams\.get\('rerun'\)/.test(src));
  ok('the content route takes POST actions and ?preview=', /request\.method === 'POST' \|\| url\.searchParams\.get\('preview'\)/.test(src));
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('the admin page has the health board with every editorial action', /id="hlth/.test(adminHtml) && /data-act=/.test(adminHtml) && ['preview', 'regenerate', 'publish', 'unpublish', 'edit'].every(a => new RegExp("b\\('" + a + "'").test(adminHtml)));
  ok('and a rerun button per job', /data-rerun=/.test(adminHtml));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
