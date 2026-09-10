#!/usr/bin/env node
// The editorial week, dry run. The real pipeline (contentDue, contentContext,
// the packets, the writer, the fact check, storage, analyst memory, the
// rivalry budget, the breaking-news scan, the tick) runs against a fake D1,
// a fake model behind the writer, a fixture season and a small projection
// pool, with the clock advanced a quarter hour at a time from the Thursday
// opener of Week 1 to the Friday of Week 2. It asserts what the week
// produced, in both lenses, and what it did not.
//   node tools/test-dry-run.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const stub = () => { throw new Error('not needed'); };

// ── the fixture season: twelve clubs, two weeks, one Monday game ───────────
const ET = (y, m, d, h, mi) => { const g = Date.UTC(y, m - 1, d, h + 5, mi || 0); return g - (etOffsetHours(g) + 5) * 3600000; };
const TEAMS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK', 'LLL'];
const g = (id, week, y, m, d, h, mi, away, home, espnId) => ({ id, espnId: espnId || null, type: 'REG', week, kickoff: ET(y, m, d, h, mi), away, home, homeScore: null, awayScore: null, spread: 3, total: 46, status: null, src: 'f' });
const GAMES = [
  g('w1-thu', 1, 2026, 9, 10, 20, 20, 'AAA', 'BBB', 'e-thu'), g('w1-e1', 1, 2026, 9, 13, 13, 0, 'CCC', 'DDD', 'e-1'), g('w1-e2', 1, 2026, 9, 13, 13, 0, 'EEE', 'FFF', 'e-2'),
  g('w1-late', 1, 2026, 9, 13, 16, 25, 'GGG', 'HHH', 'e-3'), g('w1-snf', 1, 2026, 9, 13, 20, 20, 'III', 'JJJ', 'e-4'), g('w1-mnf', 1, 2026, 9, 14, 20, 15, 'KKK', 'LLL', 'e-5'),
  g('w2-thu', 2, 2026, 9, 17, 20, 15, 'BBB', 'CCC', 'e-6'), g('w2-e1', 2, 2026, 9, 20, 13, 0, 'DDD', 'EEE', 'e-7'), g('w2-e2', 2, 2026, 9, 20, 13, 0, 'FFF', 'GGG', 'e-8'), g('w2-late', 2, 2026, 9, 20, 16, 25, 'HHH', 'III', 'e-9'), g('w2-snf', 2, 2026, 9, 20, 20, 20, 'JJJ', 'KKK', 'e-10'), g('w2-mnf', 2, 2026, 9, 21, 20, 15, 'LLL', 'AAA', 'e-11'),
  g('w3-e1', 3, 2026, 9, 27, 13, 0, 'AAA', 'CCC'), g('w3-e2', 3, 2026, 9, 27, 13, 0, 'BBB', 'DDD'), g('w3-mnf', 3, 2026, 9, 28, 20, 15, 'EEE', 'FFF')
];
for (let w = 4; w <= 18; w++) for (let i = 0; i < TEAMS.length; i += 2) GAMES.push(g('w' + w + '-' + i, w, 2026, 9, 27 + (w - 3) * 7, 13, 0, TEAMS[i], TEAMS[i + 1]));
// A game is final three and a half hours after kickoff, as the feed would say.
const scheduleAt = now => ({ season: 2026, games: GAMES.map(x => ({ ...x, status: now >= x.kickoff + 3.5 * 3600000 ? 'final' : now >= x.kickoff ? 'in' : null, homeScore: now >= x.kickoff ? 24 : null, awayScore: now >= x.kickoff ? 20 : null })) });
// The pool: a QB, RB, two WR and a TE per club, priced so the ranks are unambiguous.
const FIRST = ['Alan', 'Ben', 'Cal', 'Dan', 'Eli', 'Finn', 'Gus', 'Hal', 'Ivan', 'Jon', 'Kai', 'Lou'];
const POOL = [];
TEAMS.forEach((t, i) => {
  const f = FIRST[i];
  POOL.push({ name: f + ' Quarter', position: 'QB', team: t, projectedStats: { passYd: 4200 - i * 80, passTD: 30 - i, passInt: 10, rushYd: 200, rushTD: 2 } });
  POOL.push({ name: f + ' Runner', position: 'RB', team: t, projectedStats: { rushYd: 1200 - i * 50, rushTD: 9 - (i % 4), rec: 40 - i, recYd: 320, recTD: 1, fumLost: 1 } });
  POOL.push({ name: f + ' Wideout', position: 'WR', team: t, projectedStats: { rec: 90 - i * 3, recYd: 1250 - i * 60, recTD: 8 - (i % 3), rushYd: 20 } });
  POOL.push({ name: f + ' Second', position: 'WR', team: t, projectedStats: { rec: 60 - i * 2, recYd: 800 - i * 40, recTD: 5, rushYd: 0 } });
  POOL.push({ name: f + ' Tight', position: 'TE', team: t, projectedStats: { rec: 55 - i * 2, recYd: 620 - i * 30, recTD: 5 - (i % 2) } });
});
const KEY = p => _oddsNorm(p.name) + '|' + p.position;
const DEPTH = { teams: Object.fromEntries(TEAMS.map((t, i) => [t, { team: t, offense: { QB: [FIRST[i] + ' Quarter'], RB: [FIRST[i] + ' Runner', FIRST[i] + ' Backup'], WR: [FIRST[i] + ' Wideout', FIRST[i] + ' Second'], TE: [FIRST[i] + ' Tight'] } }])), asOf: ET(2026, 9, 10, 6, 0) };
// A box score for any final game: the fixture summary with the clubs renamed.
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/espn-summary-2025-w1-dal-phi.json'), 'utf8'));

// ── the fake D1 ────────────────────────────────────────────────────────────
// A few tables in memory, answered by matching the SQL. Enough for the
// pipeline; nothing more.
function fakeDb(clock) {
  const T = { content_pieces: [], analyst_calls: [], newsroom_settings: {}, news_events: [], news_state: null, job_runs: [], summaries: {} };
  let ids = 1;
  const stmt = (sql, args) => ({
    async run() {
      if (/INSERT INTO content_pieces/.test(sql)) { const cols = sql.match(/\(([^)]+)\) VALUES/)[1].split(',').map(s => s.trim()); const row = { id: ids++ }; cols.forEach((c, i) => { row[c] = args[i]; }); T.content_pieces.push(row); }
      else if (/INSERT INTO analyst_calls/.test(sql)) { const cols = sql.match(/\(([^)]+)\) VALUES/)[1].split(',').map(s => s.trim()); const row = { id: ids++ }; cols.forEach((c, i) => { row[c] = args[i]; }); T.analyst_calls.push(row); }
      else if (/INSERT OR REPLACE INTO newsroom_settings/.test(sql)) T.newsroom_settings[args[0]] = { value: args[1], updated_at: args[2] };
      else if (/INSERT INTO news_events/.test(sql)) T.news_events.push({ id: ids++, score: args[8], player: args[4], type: args[2], handled: null });
      else if (/INSERT OR REPLACE INTO news_state/.test(sql)) T.news_state = { payload: args[0] };
      else if (/INSERT INTO job_runs/.test(sql)) T.job_runs.push({ job: args[0], ok: args[4] });
      else if (/UPDATE content_pieces SET status/.test(sql)) { const r = T.content_pieces.find(x => x.id === args[args.length - 1]); if (r) { r.status = args[0]; if (args.length > 2) r.published_at = args[1]; } }
      else if (/UPDATE news_events SET handled/.test(sql)) T.news_events.forEach(e => { if (e.handled == null && e.score >= args[1]) e.handled = args[0]; });
      else if (/INSERT OR REPLACE INTO game_summaries/.test(sql)) T.summaries[args[0]] = { payload: args[5], final: args[4] };
      return { meta: { changes: 1 } };
    },
    async first() {
      if (/FROM odds_overlay WHERE id=\?/.test(sql)) {
        if (args[0] === 4) return { payload: JSON.stringify(scheduleAt(clock.now())), provider: 'fixture', matched: GAMES.length, updated_at: clock.now() - 10 * 60000 };
        if (args[0] === 6) return { payload: JSON.stringify(DEPTH), updated_at: clock.now() - 3600000 };
        return null;
      }
      if (/SELECT id, status, version, brief, body, violations, created_at FROM content_pieces WHERE kind = \? AND season = \? AND week = \?/.test(sql)) { const l = T.content_pieces.filter(r => r.kind === args[0] && r.season === args[1] && r.week === args[2]).sort((a, b) => b.created_at - a.created_at); return l[0] || null; }
      if (/SELECT \* FROM content_pieces WHERE kind = \? AND season = \? AND week = \?/.test(sql)) { const l = T.content_pieces.filter(r => r.kind === args[0] && r.season === args[1] && r.week === args[2]).sort((a, b) => b.created_at - a.created_at); return l[0] || null; }
      if (/SELECT \* FROM content_pieces WHERE kind = \? ORDER BY/.test(sql)) { const l = T.content_pieces.filter(r => r.kind === args[0]).sort((a, b) => b.created_at - a.created_at); return l[0] || null; }
      if (/FROM newsroom_settings WHERE key = \?/.test(sql)) return T.newsroom_settings[args[0]] || null;
      if (/SELECT payload FROM news_state/.test(sql)) return T.news_state;
      if (/SELECT payload, final FROM game_summaries WHERE espn_id = \?/.test(sql)) return T.summaries[args[0]] || null;
      if (/SELECT 1 FROM/.test(sql)) return null;
      return null;
    },
    async all() {
      if (/SELECT kind, rivalry FROM content_pieces/.test(sql)) { const kinds = args.slice(1, -1); return { results: T.content_pieces.filter(r => r.status === 'published' && kinds.includes(r.kind)).sort((a, b) => b.created_at - a.created_at).slice(0, args[args.length - 1]) }; }
      if (/FROM analyst_calls WHERE player_key IN/.test(sql)) { const keys = args.slice(0, -1); return { results: T.analyst_calls.filter(c => keys.includes(c.player_key)).sort((a, b) => b.created_at - a.created_at).slice(0, args[args.length - 1]) }; }
      if (/FROM content_pieces WHERE status = 'published' AND analyst = \?/.test(sql)) return { results: T.content_pieces.filter(r => r.status === 'published' && r.analyst === args[0]).sort((a, b) => b.published_at - a.published_at).slice(0, 12) };
      if (/FROM content_pieces WHERE status = 'published' AND rivalry IS NOT NULL/.test(sql)) return { results: T.content_pieces.filter(r => r.status === 'published' && r.rivalry).sort((a, b) => b.published_at - a.published_at).slice(0, 10) };
      if (/FROM content_pieces WHERE status = 'published' ORDER BY published_at DESC LIMIT \?/.test(sql)) return { results: T.content_pieces.filter(r => r.status === 'published').sort((a, b) => b.published_at - a.published_at).slice(0, args[0]) };
      if (/FROM content_pieces WHERE status != 'unpublished' ORDER BY created_at DESC LIMIT 80/.test(sql)) return { results: T.content_pieces.filter(r => r.status !== 'unpublished').sort((a, b) => b.created_at - a.created_at) };
      return { results: [] };
    }
  });
  return { T, prepare(sql) { return { bind(...args) { return stmt(sql, args); }, run() { return stmt(sql, []).run(); }, first() { return stmt(sql, []).first(); }, all() { return stmt(sql, []).all(); } }; }, batch: async (list) => Promise.all(list.map(s => s.run())) };
}

// ── the fake model ─────────────────────────────────────────────────────────
// Reads the packet out of the prompt and writes a body that is inside it:
// every sentence quotes an allowed name and an allowed number. `mode`
// controls a first draft that names a player the packet does not contain,
// which the fact check must catch and the retry must fix.
const modelLog = [];
let modelMode = 'clean';
function fakeModel(body) {
  const req = JSON.parse(body);
  const user = req.messages[0].content;
  const kind = /KIND: ([a-z-]+)/.exec(user)[1];
  const retry = /FAILED THE FACT CHECK/.test(user);
  let ptxt = user.slice(user.indexOf('PACKET (the only source of facts):\n') + 'PACKET (the only source of facts):\n'.length);
  if (retry) ptxt = ptxt.slice(0, ptxt.indexOf('\n\nYOUR PREVIOUS DRAFT'));
  const packet = JSON.parse(ptxt);
  modelLog.push({ kind, retry });
  // The writer sees the facts, not the checker's allowed list: names and
  // numbers come out of the packet's own fields, as a model would read them.
  const names = [...new Set([...ptxt.matchAll(/"(?:name|player|absent|replaces)":"([A-Z][a-z]+ [A-Z][a-z]+)"/g)].map(m => m[1]))].filter(n => !/^(Iron Tuna|Jack Mercer|Nate Vega|Evan Brooks|Mike Raines|Chris Dalton|Tyler Grant|Sam Porter|Lena Park)$/.test(n));
  const nums = [...new Set([...ptxt.matchAll(/:(\d{2,4}(?:\.\d)?)[,}\]]/g)].map(m => m[1]))].filter(n => Number(n) > 20);
  const nm = i => names[i % names.length] || names[0] || 'The desk';
  const nu = i => nums[i % nums.length] || '';
  const bad = modelMode === 'hallucinate' && !retry;
  const sentence = i => (bad && i === 0 ? 'Jerry Jeudy had 155 yards. ' : '') + nm(i) + ' carries ' + nu(i) + ' into the week. Start him.';
  const objSecs = { target: ['player', 'position', 'team', 'why'], tradeAway: ['player', 'position', 'team', 'why'], attack: ['player', 'position', 'team', 'salary', 'why'], fade: ['player', 'position', 'team', 'salary', 'why'], priorityAdds: ['player', 'position', 'team', 'faabPct', 'holdFor', 'why'], midLevelAdds: ['player', 'position', 'team', 'faabPct', 'holdFor', 'why'], deepAdds: ['player', 'position', 'team', 'faabPct', 'holdFor', 'why'], speculativeStashes: ['player', 'position', 'team', 'faabPct', 'holdFor', 'why'], doNotChase: ['player', 'position', 'team', 'why'], movesUp: ['player', 'position', 'team', 'from', 'to', 'why'], movesDown: ['player', 'position', 'team', 'from', 'to', 'why'], signal: ['player', 'team', 'label', 'why'], noise: ['player', 'team', 'label', 'why'], roleChanges: ['player', 'team', 'label', 'why'], buy: ['player', 'team', 'label', 'why'], concerns: ['player', 'team', 'label', 'why'], watchThis: ['player', 'team', 'label', 'why'], whoMovesUp: ['player', 'position', 'team', 'why'], whoMovesDown: ['player', 'position', 'team', 'why'], pivots: ['player', 'position', 'team', 'salary', 'why'], captainOptions: ['player', 'position', 'team', 'salary', 'why'], contrarianCaptains: ['player', 'position', 'team', 'salary', 'why'], streamingDefenses: ['team', 'opponent', 'why'], defensesToAvoid: ['team', 'opponent', 'why'], kickerRankings: ['player', 'team', 'rank', 'why'], priceInefficiencyBoard: ['player', 'position', 'team', 'salary', 'projection', 'value', 'why'], earlyValues: ['player', 'position', 'team', 'salary', 'why'], likelyChalk: ['player', 'position', 'team', 'salary', 'why'], goodChalk: ['player', 'position', 'team', 'salary', 'why'], badChalk: ['player', 'position', 'team', 'salary', 'why'], coreStacks: ['game', 'players', 'why'], contrarianStacks: ['game', 'players', 'why'], stacks: ['game', 'players', 'why'], initialStacks: ['game', 'players', 'why'] };
  const shape = /SHAPE[^\n]*\n(\{[^\n]*\})/.exec(user)[1];
  const S = JSON.parse(shape);
  const lensKeys = (lens) => Object.keys(S[lens] || {});
  const fill = (lens) => Object.fromEntries(lensKeys(lens).map((k, i) => [k, objSecs[k] ? [{ player: nm(i), position: 'WR', team: 'AAA', why: sentence(i), salary: nu(i), faabPct: '10', holdFor: 'three weeks', from: 'WR12', to: 'WR9', label: 'SIGNAL', game: 'AAA at BBB', players: nm(i), opponent: 'BBB', rank: 3, projection: nu(i), value: nu(i + 1) }] : [sentence(i), nm(i + 1) + ' is the pivot at ' + nu(i + 1) + '.']]));
  const out = { headline: nm(0) + ' is the story of the week', dek: 'What ' + nm(0) + ' told us about next week.', weekly: fill('weekly'), calls: [{ player: nm(0), direction: 'start', recommendation: 'start him', rank: null, confidence: 'HIGH', rationale: nu(0) + ' says so', evidence: [nu(0)] }], rivalryLine: null };
  if (S.dfs) out.dfs = fill('dfs');
  if (packet.rivalry) { const line = 'Brooks has ' + packet.rivalry.player + ' at ' + packet.rivalry.position + packet.rivalry.brooks.rank + '; Vega, reading the market, has him ' + packet.rivalry.position + packet.rivalry.vega.rank + '.'; out.rivalryLine = line; out.weekly[lensKeys('weekly')[0]].push(line); }
  return JSON.stringify(out);
}
const fakeFetch = async (url, opts) => {
  if (/anthropic/.test(String(url))) return { ok: true, json: async () => ({ content: [{ text: fakeModel(opts.body) }] }) };
  throw new Error('no network in the dry run: ' + url);
};

// ── the harness ────────────────────────────────────────────────────────────
const clock = { t: ET(2026, 9, 10, 6, 0), now() { return this.t; } };
const realNow = Date.now;
Date.now = () => clock.t;
// The injury list changes on Sunday morning: a starting back is ruled out at 11:40.
let availability = {};
const availabilityTable = async () => availability;
const availabilityReport = async () => ({ affected: Object.entries(availability).map(([k, a]) => { const p = POOL.find(x => KEY(x) === k); return { name: p.name, position: p.position, team: p.team, status: a.status, gamesOut: a.gamesOut, note: a.note || '' }; }) });
const availabilityCacheRead = async () => ({ updatedAt: clock.t - 20 * 60000, asOf: 'now', matched: Object.keys(availability).length });
const H = new Function('etOffsetHours', 'teamKey', '_oddsNorm', '_oddsRound', 'PROJECTIONS', 'LEAD_TZ', 'AVAILABILITY_GAMES', '_availF', 'PROVIDER_UNAVAILABLE', 'fetch', '_csvSplit', 'NFLVERSE_GAMES_URL', 'oddsCacheInit', 'ODDS_CV', 'ODDS_BANDS', 'usageCacheRead', 'availabilityTable', 'availabilityCacheRead', 'oddsCacheRead', 'availabilityReport', 'dfsSalariesRead', 'buildDfsSlate', 'buildDfsStacks', 'DFS_SITES', 'SCORING_SITE', '_availPool', 'fetchGameSummaryEspn',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' + cut('function _oddsImpliedProb(', '// The Odds API v4. WRITTEN') + '\n' +
  cut('const MARKET_RIDGE', 'async function fetchTeamEnvNflverse') + '\n' + cut('function _oddsProjectionIndex()', 'function buildVegasOverlay(') + '\n' +
  cut('// ── the NFL season and week ─', '// ── the provider layer ─') + '\n' + cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' +
  cut('// -- kickers and defenses, scored', '// -- the player intel payload') + '\n' + cut('// -- the content desk', '// -- DFS ---') + '\n' +
  'return { CONTENT_KINDS, LEGACY_CONTENT, contentDue, produceContent, runContentTick, runNewsScan, nflSeasonState, contentListPayload, contentPiecePayload, newsroomFeedPayload, deskLeadPayload, deskNextPayload, analystPayload, newsroomAdmin, autoPublishOn, draftSocialAllowed, etParts, normalizeGameSummary, _oddsProjectionIndex, runCallsGrade };'
)(etOffsetHours, teamKey, _oddsNorm, _oddsRound, POOL, 'America/New_York', 17, g => Math.max(0, 1 - g / 17), { goalLineCarries: 'pbp' }, fakeFetch, stub, 'x', async () => {}, {}, {}, async () => null, availabilityTable, availabilityCacheRead, async () => null, availabilityReport, async () => null, stub, stub, {}, {}, p => p, async (id) => { const norm = RAW; return norm; });
const db = fakeDb(clock);
const env = { LEADS_DB: db, LLM_API_KEY: 'test', LLM_PROVIDER: 'anthropic' };
// Box scores: the pipeline asks gameSummaryFor, which reads game_summaries
// first; seed one for every game so a final game always has a box score,
// with the fixture's clubs renamed to the game's.
const nameIndex = H._oddsProjectionIndex();
function seedSummaries() {
  for (const gm of GAMES) {
    if (!gm.espnId) continue;
    const raw = JSON.parse(JSON.stringify(RAW).replace(/"DAL"/g, '"' + gm.away + '"').replace(/"PHI"/g, '"' + gm.home + '"'));
    const norm = H.normalizeGameSummary(raw, nameIndex);
    norm.final = true; norm.home.team = gm.home; norm.away.team = gm.away; norm.gameId = gm.id; norm.week = gm.week;
    db.T.summaries[gm.espnId] = { payload: JSON.stringify(norm), final: 1 };
  }
}
seedSummaries();

console.log('\nthe week, a quarter hour at a time');
const timeline = [];
const scans = [];
const errors = new Set();
const start = ET(2026, 9, 10, 6, 0), end = ET(2026, 9, 18, 9, 0);
for (clock.t = start; clock.t <= end; clock.t += 900000) {
  const et = H.etParts(clock.t);
  if (et.dow === 'Sun' && et.hour === 11 && et.minute === 45 && et.dow === 'Sun') { availability['calrunner|RB'] = { status: 'Out', gamesOut: 1, note: 'ankle, ruled out' }; }
  if (et.dow === 'Sun' && et.hour === 12 && et.minute === 45) { availability['danwideout|WR'] = { status: 'Out', gamesOut: 1, note: 'hamstring, ruled out' }; }
  const scan = await H.runNewsScan(env);
  if (scan.significant) scans.push({ at: et, ...scan });
  const t = await H.runContentTick(env);
  for (const r of t.results) if (!r.ok && r.error && r.error !== 'exists') { const k = r.kind + ':' + r.error; if (!errors.has(k)) { errors.add(k); console.log('  ERROR ' + et.dow + ' ' + et.hour + ':' + et.minute + ' ' + k); } }
  for (const r of t.results) if (r.ok && r.status) timeline.push({ at: et.dow + ' ' + et.hour + ':' + String(et.minute).padStart(2, '0'), kind: r.kind, week: r.week, status: r.status, version: r.version || 1, rivalry: !!r.rivalry, calls: r.calls || 0 });
}
Date.now = realNow;
const P = db.T.content_pieces;
const at = (kind, week) => timeline.filter(x => x.kind === kind && x.week === week);
console.log('  ' + timeline.map(x => x.at + ' ' + x.kind + ' w' + x.week + ' ' + x.status + (x.version > 1 ? ' v' + x.version : '') + (x.rivalry ? ' [rivalry]' : '')).join('\n  '));
for (const r of P.filter(x => x.status === 'held')) console.log('  HELD ' + r.kind + ' w' + r.week + ': ' + String(r.violations).slice(0, 300));
{
  const lmi = P.filter(r => r.kind === 'last-minute-intel');
  ok('Last-Minute Intel published Sunday 12:15 for Week 1 and the 12:45 scratch produced version 2 on the same slug, not a second story', at('last-minute-intel', 1)[0] && at('last-minute-intel', 1)[0].at === 'Sun 12:15' && lmi.length === 2 && lmi[1].version === 2 && lmi[0].slug === lmi[1].slug && lmi[1].status === 'published', JSON.stringify(lmi.map(r => [r.version, r.status, r.created_at])));
  ok('the 11:45 scratch, before the intel slot, scored as breaking news and produced a Breaking piece; the 12:45 one refreshed Last-Minute Intel instead of a second story', scans.length === 2 && scans[0].handled.via === 'breaking' && scans[1].handled.via === 'last-minute-intel', JSON.stringify(scans.map(s => [s.at, s.handled && s.handled.via])));
  ok('below-threshold changes are logged and produce nothing', db.T.news_events.length >= 2 && db.T.news_events.every(e => e.score < 60 ? !e.handled : true));
  ok('What Sunday Taught Us published at 7:30 PM with the finals it had and updated as the late and night games went final: three versions, one slug', at('what-sunday-taught-us', 1)[0] && at('what-sunday-taught-us', 1)[0].at === 'Sun 19:30' && at('what-sunday-taught-us', 1).length === 3 && P.filter(r => r.kind === 'what-sunday-taught-us').every(r => r.slug === P.find(x => x.kind === 'what-sunday-taught-us').slug), JSON.stringify(at('what-sunday-taught-us', 1)));
  ok('the MNF preview and the early rankings published Monday 6:00, the preview about the Monday game and the rankings about Week 2', at('mnf-preview', 1)[0] && at('mnf-preview', 1)[0].at === 'Mon 6:00' && at('early-rankings', 2)[0] && at('early-rankings', 2)[0].at === 'Mon 6:00' && at('early-rankings', 2)[0].status === 'published', JSON.stringify([at('mnf-preview', 1), at('early-rankings', 2)]));
  ok('the Week 2 MNF preview waited for its own Monday', !at('mnf-preview', 2).length || at('mnf-preview', 2)[0].at === 'Mon 6:00');
  ok('Quarterback Monday was skipped: nothing worth publishing with no usage file', at('quarterback-monday', 1)[0] && at('quarterback-monday', 1)[0].status === 'skipped');
  if (!at('ros-rankings', 2)[0]) { Date.now = () => ET(2026, 9, 15, 7, 0); console.log('  DEBUG ros-rankings: ' + JSON.stringify(await H.produceContent(env, 'ros-rankings', {})).slice(0, 600)); Date.now = () => clock.t; }
  ok('the ROS rankings published Tuesday 7:00 about Week 2', at('ros-rankings', 2)[0] && at('ros-rankings', 2)[0].at === 'Tue 7:00', JSON.stringify(at('ros-rankings', 2)));
  ok('Tailback Tuesday and Tight End Thursday were skipped rather than padded (no usage file, no priced beneficiary)', ['tailback-tuesday', 'tight-end-thursday'].every(k => at(k, 1)[0] && at(k, 1)[0].status === 'skipped'));
  ok('Wideout Wednesday ran: a top receiver was ruled out with a priced beneficiary on the depth chart', at('wideout-wednesday', 1)[0] && at('wideout-wednesday', 1)[0].status === 'published' && JSON.parse(P.find(r => r.kind === 'wideout-wednesday').brief).absences.length >= 1);
  ok('the Pickup Advisor published Wednesday 6:00', at('pickup-advisor', 2)[0] && at('pickup-advisor', 2)[0].at === 'Wed 6:00');
  ok('Thursday: the TNF preview at 6 (published), Underrated at 7 and the Trade Desk at 8 (skipped: no usage, no priced disagreement)', at('tnf-preview', 2)[0] && at('tnf-preview', 2)[0].at === 'Thu 6:00' && at('tnf-preview', 2)[0].status === 'published' && at('underrated', 2)[0] && at('underrated', 2)[0].at === 'Thu 7:00' && at('trade-desk', 2)[0] && at('trade-desk', 2)[0].at === 'Thu 8:00', JSON.stringify([at('tnf-preview', 2), at('underrated', 2), at('trade-desk', 2)]));
  ok('Friday: Thursday Night What Matters at 6 and the Weekend Preview at 7 (published), Kickers & Defenses at 8 (skipped: no K or DST in the pool)', at('tnf-what-matters', 2)[0] && at('tnf-what-matters', 2)[0].at === 'Fri 6:00' && at('tnf-what-matters', 2)[0].status === 'published' && at('weekend-preview', 2)[0] && at('weekend-preview', 2)[0].at === 'Fri 7:00' && at('weekend-preview', 2)[0].status === 'published' && at('kickers-defenses', 2)[0] && at('kickers-defenses', 2)[0].at === 'Fri 8:00', JSON.stringify([at('tnf-what-matters', 2), at('weekend-preview', 2), at('kickers-defenses', 2)]));
  ok('nothing published twice for the same kind and week except the two live pieces', Object.keys(H.CONTENT_KINDS).every(k => k === 'last-minute-intel' || k === 'what-sunday-taught-us' || k === 'tnf-preview' || [1, 2].every(w => at(k, w).filter(x => x.status !== 'skipped').length <= 1)));
  ok('no retired kind ran', P.every(r => H.CONTENT_KINDS[r.kind]) && Object.keys(H.LEGACY_CONTENT).every(k => !P.some(r => r.kind === k)));
  const pub = P.filter(r => r.status === 'published');
  ok('every published piece carries both lenses, a headline, a byline and a version', pub.length >= 9 && pub.every(r => { const b = JSON.parse(r.body); return b.weekly && b.dfs && r.headline && r.analyst && r.version >= 1; }), String(pub.length));
  ok('the DFS lens says no salaries are loaded rather than inventing a number', pub.every(r => { const p = JSON.parse(r.brief); return p.dfs && p.dfs.available === false; }));
  ok('every published piece passed the fact check', pub.every(r => JSON.parse(r.violations).length === 0));
  const riv = pub.filter(r => r.rivalry);
  ok('the rivalry surfaced in at most one in five eligible pieces, and only on eligible kinds', riv.length <= Math.max(1, Math.ceil(pub.filter(r => H.CONTENT_KINDS[r.kind].rivalry).length * 0.2)) && riv.every(r => H.CONTENT_KINDS[r.kind].rivalry), riv.map(r => r.kind).join());
  ok('a rivalry piece carries one line naming both ranks', riv.every(r => { const rv = JSON.parse(r.rivalry); return rv.line && /Brooks/.test(rv.line) && /Vega/.test(rv.line); }));
  ok('analyst calls were recorded for published pieces with the byline on them', db.T.analyst_calls.length >= pub.length - 2 && db.T.analyst_calls.every(c => c.analyst && c.player), String(db.T.analyst_calls.length) + ' calls for ' + pub.length + ' pieces');
  const later = pub.filter(r => JSON.parse(r.brief).priorCalls && JSON.parse(r.brief).priorCalls.length);
  ok('later packets carry the desk\'s prior calls on the players they name', later.length >= 1);
  ok('the model was asked in each analyst\'s voice, and never for a retired kind', modelLog.every(m => H.CONTENT_KINDS[m.kind]) && new Set(modelLog.map(m => m.kind)).size >= 10);
  ok('the draft-season social threads were refused all week', !(await H.draftSocialAllowed(env)).ok);
}

console.log('\nthe feeds and the front page');
{
  Date.now = () => end;
  const feed = await H.newsroomFeedPayload(env, 'weekly', 10);
  ok('the newsroom feed lists published pieces newest first with bylines and URLs', feed.ok && feed.pieces.length >= 5 && feed.pieces.every(p => p.byline.name && /^\/in-season\/desk\//.test(p.url)) && feed.pieces[0].publishedAt >= feed.pieces[1].publishedAt);
  const dfs = await H.newsroomFeedPayload(env, 'dfs', 10);
  ok('the DFS feed links the DFS lens', dfs.ok && dfs.pieces.every(p => /lens=dfs$/.test(p.url)));
  const lead = await H.deskLeadPayload(env);
  ok('the front-page lead is the newest desk piece, in the lead painter\'s shape', lead && lead.ok && lead.story.url && lead.story.title && lead.story.analyst && lead.recent.length >= 1);
  const piece = await H.contentPiecePayload(env, 'early-rankings', 2026, 2);
  ok('a piece payload carries both lenses, the sections for each, the byline and the disclosure', piece.ok && piece.body.weekly && piece.body.dfs && piece.sections.weekly.length && piece.sections.dfs.length && piece.byline.name === 'Evan Brooks' && piece.byline.dfsName === 'Lena Park' && /AI-powered/.test(piece.disclosure));
  ok('the packet the page shows hides the allowed list and the index', piece.brief && !piece.brief.allowed && !piece.brief.playerIndex && piece.brief.freshness);
  const a = await H.analystPayload(env, 'brooks');
  ok('an analyst page lists recent pieces and the record of calls', a.ok && a.pieces.length >= 1 && Array.isArray(a.calls) && a.headToHead !== null);
  const list = await H.contentListPayload(env, 2026, null);
  ok('the desk list carries every calendar kind with its analyst and slot', list.ok && list.kinds.length === 16 && list.kinds.every(k => k.analystName && k.day));
  Date.now = realNow;
}

console.log('\nthe pause, the approval and the hallucinating writer');
{
  Date.now = () => end;
  await H.newsroomAdmin(env, 'pause', {});
  ok('paused, automatic publishing is off', !(await H.autoPublishOn(env)).on);
  const r = await H.produceContent(env, 'early-rankings', { force: true });
  ok('a validated piece is held for approval while paused', r.ok && r.status === 'held' && r.violations.some(v => /awaiting_approval/.test(v)), JSON.stringify(r));
  const ap = await H.newsroomAdmin(env, 'approve', { kind: 'early-rankings', week: r.week });
  ok('approve publishes it and records its calls', ap.ok && db.T.content_pieces.filter(x => x.kind === 'early-rankings').pop().status === 'published' && ap.calls >= 1, JSON.stringify(ap));
  await H.newsroomAdmin(env, 'resume', {});
  ok('resumed', (await H.autoPublishOn(env)).on);
  modelMode = 'hallucinate'; modelLog.length = 0;
  const h = await H.produceContent(env, 'weekend-preview', { force: true });
  ok('a first draft naming a player the packet lacks is sent back once and the retry publishes clean', h.ok && h.status === 'published' && modelLog.length === 2 && modelLog[1].retry === true, JSON.stringify([h.status, modelLog]));
  modelMode = 'clean';
  ok('the writer was never asked to write a retired kind', modelLog.every(m => H.CONTENT_KINDS[m.kind]));
  Date.now = realNow;
}

console.log('\nthe lead before the first piece');
{
  // Wednesday of Week 1, nothing published: the lead names the next piece on
  // the calendar and its slot, never a draft-season story.
  const wed = ET(2026, 9, 9, 9, 0);
  Date.now = () => wed;
  const st = H.nflSeasonState(scheduleAt(wed), wed);
  const nx = H.deskNextPayload(st, scheduleAt(wed), wed);
  ok('the lead names the next piece and when it publishes', nx && nx.ok && nx.story.placeholder === true && nx.story.category === 'desk' && /^Next from the desk: /.test(nx.story.title) && /Publishes (Wednesday|Thursday) at \d{1,2}:\d{2} (AM|PM) ET\.$/.test(nx.story.dek) && nx.story.url === '/in-season/desk', JSON.stringify(nx && nx.story));
  ok('and it is the earliest slot still to come', nx && nx.story.createdAt > wed && Object.keys(H.CONTENT_KINDS).filter(k => !H.CONTENT_KINDS[k].unscheduled).every(k => { const d = H.contentDue(k, wed, st, scheduleAt(wed)); return !(Number.isFinite(d.dueAt) && d.dueAt > wed && d.dueAt < nx.story.createdAt); }));
  Date.now = realNow;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
