#!/usr/bin/env node
// In-season integration (Step 31): whole paths through the shipped code
// against a scripted D1 and a stored schedule, no network.
//   1. Article generation: brief -> writer -> validator -> store -> public
//      payload, with a good draft, a draft that invents a name, no key, a
//      box score that is not final, and the once-per-week tick.
//   2. The scheduled tick: JOB_SCHEDULE -> runScheduledTick -> jobRun ->
//      job_runs rows -> jobBoard -> the health payload, with a job that throws.
//   3. DFS: the 2026 schedule fixture -> the week board -> a priced slate ->
//      the shipped optimizer -> a legal lineup, every number traceable.
//   node tools/test-integration.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };
const HEAD = 'function etOffsetHours(ms) {';
const etOffsetHours = new Function('ms', src.slice(src.indexOf(HEAD) + HEAD.length, src.indexOf('function etClock(ms) {')).replace(/\}\s*$/, ''));
const TA = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TA[u] || u; };
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const _oddsRound = v => Math.round(v * 10) / 10;
function _csvSplit(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }

// A tiny in-memory D1 with just enough SQL sense for these paths: INSERT
// records a row (columns read from the statement), SELECT answers by the
// bound kind/season/week, UPDATE flips fields by id. Every statement is logged.
function memDb() {
  const tables = { content_pieces: [], job_runs: [] };
  const log = [];
  let nextId = 1;
  const exec = (sql, args) => {
    log.push({ sql, args });
    const m = sql.match(/INSERT INTO (\w+) \(([^)]+)\)/);
    if (m) { const cols = m[2].split(',').map(s => s.trim()); const row = { id: nextId++ }; cols.forEach((c, i) => { row[c] = args[i]; }); tables[m[1]].push(row); return { rows: [], changes: 1 }; }
    if (/^SELECT 1 FROM content_pieces WHERE kind = \? AND season = \? AND week = \?/.test(sql)) return { rows: tables.content_pieces.filter(r => r.kind === args[0] && r.season === args[1] && r.week === args[2]).map(() => ({ 1: 1 })) };
    if (/^SELECT \* FROM content_pieces WHERE kind = \? AND season = \? AND week = \?/.test(sql)) return { rows: tables.content_pieces.filter(r => r.kind === args[0] && r.season === args[1] && r.week === args[2]).sort((a, b) => b.created_at - a.created_at) };
    if (/^SELECT \* FROM content_pieces WHERE kind = \? ORDER/.test(sql)) return { rows: tables.content_pieces.filter(r => r.kind === args[0]).sort((a, b) => b.created_at - a.created_at) };
    if (/FROM content_pieces WHERE season = \? AND week = \? AND status != 'unpublished'/.test(sql)) return { rows: tables.content_pieces.filter(r => r.season === args[0] && r.week === args[1] && r.status !== 'unpublished') };
    if (/FROM content_pieces WHERE status != 'unpublished'/.test(sql)) return { rows: tables.content_pieces.filter(r => r.status !== 'unpublished') };
    if (/^UPDATE content_pieces SET status = \?, published_at = \? WHERE id = \?/.test(sql)) { const r = tables.content_pieces.find(x => x.id === args[2]); if (r) { r.status = args[0]; r.published_at = args[1]; } return { rows: [], changes: r ? 1 : 0 }; }
    if (/^UPDATE content_pieces SET status = \? WHERE id = \?/.test(sql)) { const r = tables.content_pieces.find(x => x.id === args[1]); if (r) r.status = args[0]; return { rows: [], changes: r ? 1 : 0 }; }
    if (/FROM job_runs WHERE started_at >= \?/.test(sql)) return { rows: tables.job_runs.filter(r => r.started_at >= args[0]).sort((a, b) => b.started_at - a.started_at) };
    if (/MAX\(started_at\) AS last_ok FROM job_runs/.test(sql)) { const out = {}; for (const r of tables.job_runs) if (r.ok === 1 && (!out[r.job] || r.started_at > out[r.job])) out[r.job] = r.started_at; return { rows: Object.entries(out).map(([job, last_ok]) => ({ job, last_ok })) }; }
    if (/^DELETE FROM job_runs/.test(sql)) { const n = tables.job_runs.length; tables.job_runs = tables.job_runs.filter(r => r.started_at >= args[0]); return { rows: [], changes: n - tables.job_runs.length }; }
    if (/SELECT payload, updated_at FROM odds_overlay|SELECT updated_at FROM odds_overlay|FROM ros_rankings|FROM dfs_salaries|FROM odds_snapshots|FROM game_summaries/.test(sql)) return { rows: [] };
    return { rows: [], changes: 0 };
  };
  const stmt = (sql, args) => ({ async run() { const r = exec(sql, args); return { meta: { changes: r.changes || 0 } }; }, async first() { return exec(sql, args).rows[0] || null; }, async all() { return { results: exec(sql, args).rows }; } });
  return { tables, log, prepare(sql) { return { bind(...args) { return stmt(sql, args); }, run() { return stmt(sql, []).run(); }, first() { return stmt(sql, []).first(); }, all() { return stmt(sql, []).all(); } }; }, async batch(list) { for (const s of list) await s.run(); return []; } };
}

// ── 1. article generation ──────────────────────────────────────────────────
console.log('\narticle generation: brief -> writer -> validator -> store -> payload');
{
  const llm = { calls: [], script: [] };
  const llmText = async (env, system, user, max) => {
    llm.calls.push({ system, user, max });
    if (!env.LLM_API_KEY) return { ok: false, error: 'no LLM_API_KEY' };
    const next = llm.script.shift();
    return next || { ok: true, text: JSON.stringify({ lede: 'Sam Smith led the way with 2 scores.', body: 'The line was 47.5.' }), model: 'test-model' };
  };
  const brief = { kind: 'final-read', week: 3, allowed: { names: ['Sam Smith'], numbers: ['2', '47.5'] }, items: [] };
  const sched = { season: 2026, updatedAt: 1, games: [{ id: 'g1', type: 'REG', week: 3, home: 'PHI', away: 'DAL', kickoff: 10, status: 'final', espnId: '1' }] };
  const stubs = {
    _sectionSpec: () => 'lede, body', WRITER_SYSTEM: 'STATE ONLY FACTS IN THE BRIEF', llmText,
    contentReady: async () => true, scheduleCacheRead: async () => sched, nflSeasonState: () => ({ ok: true, phase: 'regular', week: { type: 'REG', number: 3 }, games: [] }),
    contentDue: (kind) => kind === 'team-recaps' ? { due: true, ready: true, reason: 'ready', week: 3, targets: ['g1'], excluded: [] } : { due: true, ready: true, reason: 'ready', week: 3, targets: [], excluded: [] },
    CONTENT_KINDS: { 'final-read': { title: 'The Final Read', day: 'Thu', hour: 7 }, 'team-recaps': { title: 'Team-by-Team Recaps', day: 'Mon', hour: 7 } },
    CONTENT_SECTIONS: { 'final-read': ['lede', 'body'] }, CONTENT_CONTRACT: 1,
    weekGames: (s, week) => s.games.filter(g => g.week === week).map(g => ({ ...g, dow: 'Sun', state: { status: 'completed' } })),
    gameSummaryFor: async (env, g) => ({ final: !!env.boxFinal, status: env.boxFinal ? 'FINAL' : 'IN PROGRESS', home: { team: 'PHI' }, away: { team: 'DAL' }, players: [] }),
    briefTeamRecaps: () => ({ ...brief, kind: 'team-recaps' }), briefForGames: () => brief, briefWtaty: () => brief, briefOpportunity: () => brief, _finishBrief: b => b, rosUpdatePayload: async () => ({}),
    briefFinalRead: () => brief, briefGamePlan: () => brief,
    boardsPayload: async () => ({ ok: false }), depthChartsRead: async () => null, usageCacheRead: async () => null, availabilityReport: async () => null,
    marketHistoryWeek: async () => ({}), marketHistoryGames: async () => ({}), detectInsights: () => ({ insights: [] }), scoringRules: () => ({}), _oddsProjectionIndex: () => new Map()
  };
  const H = new Function(...Object.keys(stubs), cut('function validateDraft(text, allowed) {', '// -- DFS ---') +
    '\nreturn { validateDraft, writePiece, produceContent, runContentTick, contentListPayload, contentPiecePayload };')(...Object.values(stubs));

  // a good draft
  const db = memDb(); const env = { LEADS_DB: db, LLM_API_KEY: 'k', boxFinal: true };
  const r1 = await H.produceContent(env, 'final-read', {});
  ok('a draft naming only what the brief contains is published', r1.ok && r1.status === 'published' && r1.violations.length === 0, JSON.stringify(r1));
  const row = db.tables.content_pieces[0];
  ok('and stored with its brief, body, model and a publish time', row && row.kind === 'final-read' && row.week === 3 && row.status === 'published' && row.published_at > 0 && row.model === 'test-model' && JSON.parse(row.brief).allowed.names[0] === 'Sam Smith');
  ok('the writer was given the brief as the only source of facts', llm.calls.length === 1 && /BRIEF \(the only source of facts\)/.test(llm.calls[0].user) && /Sam Smith/.test(llm.calls[0].user));
  const pub = await H.contentPiecePayload(env, 'final-read', 2026, 3);
  ok('the public payload serves the body of a published piece', pub.ok && pub.status === 'published' && pub.body.lede.startsWith('Sam Smith') && pub.sections.join() === 'lede,body');
  // the once-per-week rule
  const again = await H.produceContent(env, 'final-read', {});
  ok('the same piece is not produced twice in a week', again.ok === false && again.error === 'exists' && db.tables.content_pieces.length === 1);
  const forced = await H.produceContent(env, 'final-read', { force: true });
  ok('unless forced, which stores a new row and the newest wins', forced.ok && db.tables.content_pieces.length === 2);

  // a draft that invents a name: one corrective retry, then held
  llm.calls.length = 0;
  llm.script.push({ ok: true, text: JSON.stringify({ lede: 'Sam Smith and Pat Jones both scored.', body: 'The line was 47.5.' }), model: 'test-model' });
  llm.script.push({ ok: true, text: JSON.stringify({ lede: 'Pat Jones again.', body: 'x' }), model: 'test-model' });
  const db2 = memDb(); const env2 = { LEADS_DB: db2, LLM_API_KEY: 'k', boxFinal: true };
  const r2 = await H.produceContent(env2, 'final-read', {});
  ok('a draft that names a player the brief does not contain is held', r2.ok && r2.status === 'held' && r2.violations.includes('Pat Jones'), JSON.stringify(r2));
  ok('after exactly one corrective retry that names the violation', llm.calls.length === 2 && /Names not in the brief: Pat Jones/.test(llm.calls[1].user));
  const heldRow = db2.tables.content_pieces[0];
  ok('the held row keeps the draft and the violations', heldRow.status === 'held' && heldRow.published_at === null && JSON.parse(heldRow.violations).includes('Pat Jones') && /Pat Jones/.test(heldRow.body));
  const heldPub = await H.contentPiecePayload(env2, 'final-read', 2026, 3);
  ok('the public payload ships the brief and the violations, never the held prose', heldPub.ok && heldPub.status === 'held' && heldPub.body === null && heldPub.brief.allowed.names[0] === 'Sam Smith' && heldPub.violations.includes('Pat Jones'));
  // the corrected retry succeeds when it complies
  llm.script.push({ ok: true, text: JSON.stringify({ lede: 'Sam Smith and Pat Jones.', body: '' }), model: 'm' });
  llm.script.push({ ok: true, text: JSON.stringify({ lede: 'Sam Smith scored 2.', body: '' }), model: 'm' });
  const r2b = await H.produceContent({ LEADS_DB: memDb(), LLM_API_KEY: 'k', boxFinal: true }, 'final-read', {});
  ok('a retry that removes the invention is published', r2b.ok && r2b.status === 'published');

  // no key
  const db3 = memDb();
  const r3 = await H.produceContent({ LEADS_DB: db3, boxFinal: true }, 'final-read', {});
  ok('with no LLM key the piece is held with its brief and the reason', r3.ok && r3.status === 'held' && /no LLM_API_KEY/.test(r3.violations[0]) && db3.tables.content_pieces[0].body === 'null');

  // a box score that is not final
  const db4 = memDb();
  const r4 = await H.produceContent({ LEADS_DB: db4, LLM_API_KEY: 'k', boxFinal: false }, 'team-recaps', {});
  ok('a recap is refused while the box score is not final, whatever the schedule said', r4.ok === false && r4.error === 'box_score_not_final' && r4.games.join() === 'DAL@PHI' && db4.tables.content_pieces.length === 0);
  const r4f = await H.produceContent({ LEADS_DB: db4, LLM_API_KEY: 'k', boxFinal: true }, 'team-recaps', {});
  ok('and written once it is', r4f.ok && r4f.status === 'published');

  // the tick
  const db5 = memDb(); const env5 = { LEADS_DB: db5, LLM_API_KEY: 'k', boxFinal: true };
  const t1 = await H.runContentTick(env5);
  ok('the tick produces every due and ready kind once', t1.ok && db5.tables.content_pieces.length === 2 && t1.results.filter(r => r.ok).length === 2);
  const t2 = await H.runContentTick(env5);
  ok('and nothing on the next tick', t2.ok && db5.tables.content_pieces.length === 2 && t2.results.filter(r => r.ok).length === 0);
  const list = await H.contentListPayload(env5, 2026, 3);
  ok('the public list carries both pieces with their status', list.ok && list.pieces.length === 2 && list.pieces.every(p => p.status === 'published'));
}

// ── 2. the scheduled tick end to end ───────────────────────────────────────
console.log('\nthe scheduled tick: schedule -> tick -> job log -> board -> health');
{
  const calls = [];
  const job = (name, result) => async () => { calls.push(name); if (result instanceof Error) throw result; return result; };
  const stubs = {
    runScheduleRefresh: job('schedule', { ok: true, games: 272 }), runOddsRefresh: job('odds', new Error('the books did not answer')),
    runAvailabilityRefresh: job('availability', { ok: true }), runMarketSnapshot: job('snapshot', { ok: true, written: 3 }), runUsageRefresh: job('usage', { ok: true }),
    runDfsRefresh: job('dfs', { ok: true }), runDepthChartRefresh: job('depth', { ok: true }), runRosSnapshot: job('ros', { ok: true, stored: { ros: 300 } }),
    snapshotPrune: job('snap-prune', { ok: true }), pruneAnalytics: job('an-prune', { ok: true }), runContentTick: job('content', { ok: true, results: [] }),
    SNAP_KEEP_DAYS: 200, DEPTH_ROW: 6, LEAD_TZ: 'America/New_York',
    scheduleCacheRead: async () => null, nflSeasonState: () => ({ ok: false }), oddsCacheRead: async () => null, snapshotStatus: async () => null, usageCacheRead: async () => null,
    availabilityCacheRead: async () => null, rosSnapshots: async () => [], dfsSalariesRead: async () => null, providerReport: () => ({ providers: {}, unavailable: {} }),
    contentReady: async () => true, CONTENT_KINDS: {}, CONTENT_SECTIONS: {}, contentDue: () => ({ due: false }), produceContent: async () => ({ ok: false }), validateDraft: () => ({ ok: true, names: [], numbers: [] })
  };
  const H = new Function(...Object.keys(stubs), cut('function etOffsetHours(ms) {', 'function etClock(ms) {') + '\n' + cut('function etParts(ms) {', 'const _etDow = ') + '\n' +
    cut('// -- the job log and the health board', '// Memoized per isolate alongside _PROJ_ENC') +
    '\nreturn { runScheduledTick, jobBoard, healthPayload, JOB_FNS };')(...Object.values(stubs));
  const db = memDb(); const env = { LEADS_DB: db };
  const wed7 = Date.UTC(2026, 8, 16, 11); // Wed Sep 16 2026, 7 AM EDT
  const t = await H.runScheduledTick(env, wed7, '0 * * * *');
  ok('the Wednesday 7 AM tick runs the pulls, the ROS snapshot and the desk', t.ok && t.due.includes('odds-refresh') && t.due.includes('ros-snapshot') && t.due[t.due.length - 1] === 'content-tick', t.due.join());
  ok('phase 1 ran before the snapshot and the desk went last', calls.indexOf('ros') > calls.indexOf('odds') && calls.indexOf('ros') > calls.indexOf('snapshot') && calls[calls.length - 1] === 'content');
  const rows = db.tables.job_runs;
  ok('one job_runs row per job, each with the trigger', rows.length === t.due.length && rows.every(r => r.trigger === '0 * * * *' && r.started_at > 0 && r.finished_at >= r.started_at));
  const odds = rows.find(r => r.job === 'odds-refresh');
  ok('the job that threw is a logged failure with its error', odds.ok === 0 && /books did not answer/.test(odds.error) && t.ran.find(r => r.job === 'odds-refresh').ok === false);
  ok('a job that succeeded carries its summary', /"games":272/.test(rows.find(r => r.job === 'schedule-refresh').summary));
  const board = await H.jobBoard(env, Date.now()); // the rows carry the real clock; the tick's hour was only the schedule's question
  ok('the board reads the rows the tick wrote', board.ok && board.jobs.find(j => j.job === 'odds-refresh').failures7d === 1 && board.jobs.find(j => j.job === 'ros-snapshot').last.ok === true && board.failed.length === 1);
  const health = await H.healthPayload(env, {});
  ok('the health payload names the failed job and the schedule', health.ok && health.failedJobs.length === 1 && health.failedJobs[0].job === 'odds-refresh' && health.jobs.find(j => j.job === 'ros-snapshot').when === 'Wed 7 AM ET' && health.schedule.tz === 'America/New_York');
  ok('and is degraded because of it', health.status !== 'ok');
  const quiet = await H.runScheduledTick(env, Date.UTC(2026, 8, 14, 19), 'x'); // Mon 3 PM EDT
  ok('a quiet hour writes only the hourly rows', quiet.due.join() === 'schedule-refresh,content-tick' && db.tables.job_runs.length === t.due.length + 2);
}

// ── 3. DFS from the schedule to a lineup ───────────────────────────────────
console.log('\nDFS: schedule fixture -> week board -> priced slate -> optimizer');
{
  const csv = fs.readFileSync(path.join(ROOT, 'tools/fixtures/games-2026.csv'), 'utf8');
  const fetchStub = async () => ({ ok: true, status: 200, text: async () => csv });
  const pStart = src.indexOf('const PROJECTIONS = ['), pEnd = src.indexOf('\n];', pStart) + 3;
  const H = new Function('etOffsetHours', '_csvSplit', 'fetch', '_xb64encode', 'PROJ_KEY', 'LEAD_TZ',
    src.slice(pStart, pEnd) + '\n' + cut('// Vegas-weighted projections', '// The Odds API v4. WRITTEN') + '\n' +
    cut('const NFLVERSE_GAMES_URL', '// ── kickers and defences ─') + '\n' + cut('function _oddsProjectionIndex()', 'function blendProjections(') + '\n' +
    cut('function _withAvailability(p)', 'const COLUMN_SCORING = {') + '\n' + cut('// ── the NFL season and week ─', '// ── the provider layer ─') + '\n' +
    cut('const PROVIDER_KINDS', 'const NFLVERSE_BASE') + '\n' + cut('const PROVIDER_UNAVAILABLE', '// Run every configured provider') + '\n' +
    cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' + cut('// -- kickers and defences, scored', '// -- the player intel payload') + '\n' +
    cut('// -- DFS ---', '// -- the job log and the health board') + '\n' +
    'return { fetchScheduleNflverse, nflSeasonState, teamRatingsFrom, buildBoards, scoringRules, _oddsProjectionIndex, _availPool, PROJECTIONS, buildDfsSlate, buildDfsStacks, DFS_SITES };'
  )(etOffsetHours, _csvSplit, fetchStub, x => x, 'k', 'America/New_York');
  const sp = await H.fetchScheduleNflverse();
  ok('the stored 2026 schedule parses', sp.season === 2026 && sp.games.length === 272);
  const sched = { season: sp.season, games: sp.games, provider: 'fixture', updatedAt: 1 };
  const now = Date.UTC(2026, 8, 22, 14); // Tue Sep 22 2026: Week 3 is current
  const state = H.nflSeasonState(sched, now);
  ok('Week 3 is current on the Tuesday after Week 2, from the games themselves', state.ok && state.phase === 'regular' && state.week.type === 'REG' && state.week.number === 3, JSON.stringify(state.week));
  const ctx = { sched, state, ratings: H.teamRatingsFrom(sched), avail: {}, usage: null, overlay: null, weekMarkets: {}, nameIndex: H._oddsProjectionIndex(), pool: H._availPool(H.PROJECTIONS), rules: H.scoringRules('ppr') };
  const week = H.buildBoards(ctx, { horizon: 'week', preset: 'ppr' });
  ok('the week board builds from the schedule alone', week.ok && week.players.length > 200 && week.players.every(p => p.vegas && p.ironTuna && p.consensus));
  ok('with no prop on file every Vegas number says it is derived from the game lines or the ratings', week.players.filter(p => p.games > 0).every(p => p.vegas.basis === 'gamelines' || p.vegas.basis === 'ratings'));
  // A salary file priced off the consensus, the way a lobby prices: top of each position dearest.
  const pos = { QB: 24, RB: 60, WR: 80, TE: 30, DST: 32 };
  const sal = [];
  for (const P of Object.keys(pos)) {
    const list = week.players.filter(p => p.position === P && p.games > 0).sort((a, b) => b.consensus.points - a.consensus.points).slice(0, pos[P]);
    list.forEach((p, i) => sal.push({ name: p.name, position: P, team: p.team, opponent: null, salary: Math.round(((P === 'DST' ? 4500 : P === 'QB' ? 8500 : 9500) - i * (P === 'DST' ? 60 : 90)) / 100) * 100 }));
  }
  const slate = H.buildDfsSlate('dk', sal, week, {});
  ok('every salary row lands on the slate', slate.players.length === sal.length && slate.unmatched === 0, 'unmatched ' + slate.unmatched);
  ok('every priced player carries the three projections, the delta and a team total', slate.players.every(p => p.vegasPoints > 0 && p.ironTuna !== undefined || p.ironTunaPoints > 0) && slate.players.every(p => p.marketDelta && Number.isFinite(p.teamTotal)));
  ok('the Vegas Value Score is indexed to the slate median', slate.players.some(p => p.vegasValueScore > 100) && slate.players.some(p => p.vegasValueScore < 100));
  ok('the note says no prop is on the slate', slate.hasProps === false && /No sportsbook/.test(slate.note));
  const stacks = H.buildDfsStacks(slate, state);
  ok('the stacks rank the week\'s games by posted total', stacks.length > 0 && stacks.every((g, i) => i === 0 || g.total <= stacks[i - 1].total) && stacks[0].away.qb && stacks[0].home.qb);
  const DFS = require(path.join(ROOT, 'dfs-optimizer.js'));
  const players = slate.players.map(p => ({ ...p, id: p.key }));
  const base = { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex };
  for (const mode of ['ironTuna', 'vegas', 'consensus', 'vegasEdge']) {
    const r = DFS.build(players, { ...base, mode, lineups: 2 });
    ok(mode + ': two legal lineups under the cap, every slot eligible, every player on the slate', r.ok && r.lineups.length === 2 && r.lineups.every(l => l.salary <= 50000 && l.players.length === 9 && l.players.every(p => slate.players.some(s => s.key === p.id) && (p.slot === p.position || (p.slot === 'FLEX' && /RB|WR|TE/.test(p.position))))), r.note || '');
  }
  const stacked = DFS.build(players, { ...base, mode: 'vegas', stack: true, bringBack: true, maxPerTeam: 3 });
  const L = stacked.lineups[0], qb = L.players.find(p => p.slot === 'QB');
  const counts = {}; L.players.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
  ok('a stacked, bring-back, max-3-per-team lineup honours all three', stacked.ok && L.players.some(p => p.team === qb.team && /WR|TE/.test(p.position)) && L.players.some(p => p.team === qb.opponent && p.position !== 'DST') && Object.values(counts).every(n => n <= 3), JSON.stringify(counts));
  ok('the optimizer never touches the network', !/fetch\(|XMLHttpRequest/.test(fs.readFileSync(path.join(ROOT, 'dfs-optimizer.js'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
