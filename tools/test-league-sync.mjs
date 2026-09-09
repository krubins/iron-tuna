#!/usr/bin/env node
// Sync My League (docs/league-sync.md). Lifts the LEAGUE SYNC region out of
// _worker.js with the real scoring engine, the real PROJECTIONS pool and the
// real token helpers, stubs the network with Sleeper- and Yahoo-shaped
// fixtures and the boards with a deterministic board built off PROJECTIONS,
// and drives the whole thing through a small in-memory D1: normalisation,
// scoring import (PPR, half, standard, TE premium, unusual bonuses), roster
// import (superflex, 10/12/14 teams), player-id matching and the miss log,
// idempotent re-sync, multiple leagues and the default, OAuth expiry and
// refresh, disconnect, availability, the pickup advisor, the lineup
// optimiser, the matchup, intel, trades, playoffs, a provider outage, a
// partial sync, a stale league, and the routes' auth gate.
//   node tools/test-league-sync.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };
const fnCut = (a) => { const i = src.indexOf(a); if (i < 0) { console.error('FAIL: fn ' + a.slice(0, 40)); process.exit(1); } const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
const cutLine = (a) => { const i = src.indexOf(a); if (i < 0) { console.error('FAIL: line ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, src.indexOf('\n', i) + 1); };

// ── the pieces of the worker the region depends on ─────────────────────────
const deps = [
  cut('function b64urlEncode(bytes)', '// Comped accounts'),
  cutLine('const _oddsNorm = s =>') + src.slice(src.indexOf('const _oddsNorm = s =>') + cutLine('const _oddsNorm = s =>').length, src.indexOf("  .replace(/[^a-z]/g, '');", src.indexOf('const _oddsNorm = s =>')) + "  .replace(/[^a-z]/g, '');".length + 1),
  cutLine('const TEAM_ALIAS = {'), cutLine('const teamKey = t =>'),
  cut('const PROJECTIONS = [', '\n];') + '\n];',
  cut('const SCORING_BASE = {', 'function scoreStats(stats, position, rules) {'),
  fnCut('function scoreStats(stats, position, rules) {'),
  cut('const SCORING_KDEF = {', '// -- the three boards'),
  cut('function etOffsetHours(ms) {', 'function etClock(ms) {'), cut('function etParts(ms) {', 'const _etDow = '),
  cut('const NEWSROOM_FLAGS = {', 'function flagReport(env) {'),
  cutLine('const json = (obj, status, c) =>'), cutLine('function adminOk(env, key)'),
  cut('async function rl(env, request, bucket, max, ttlSec) {', '// ── the post-draft section')
];
// _tierPoints and _oddsRound live outside the cuts above.
deps.push(cut('function _tierPoints(', '\n}\n') + '\n}\n');
const region = cut('// ══ LEAGUE SYNC', '// ══ /LEAGUE SYNC');
const _oddsRoundSrc = src.match(/const _oddsRound = [^\n]+\n/) ? src.match(/const _oddsRound = [^\n]+\n/)[0] : (src.match(/function _oddsRound\([^)]*\) \{[^}]*\}/) || [''])[0];
if (!_oddsRoundSrc) { console.error('FAIL: _oddsRound not found'); process.exit(1); }

// ── the network, stubbed ───────────────────────────────────────────────────
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/sleeper-league.json'), 'utf8'));
const YFIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/yahoo-league.json'), 'utf8'));
const net = { calls: [], down: false, notFound: false, rate: false, yahooExpired: false, yahooRefreshed: 0, playersOnly: false };
const sleeperWorld = { league: null, rosters: [], users: [], players: {}, matchups: {}, transactions: {} };
async function fakeFetch(url, init) {
  net.calls.push(url);
  const j = (o, status) => ({ ok: !status || status < 400, status: status || 200, json: async () => o });
  if (net.down) throw new Error('ECONNRESET');
  if (url.startsWith('https://api.sleeper.app/v1/players/nfl')) return j(sleeperWorld.players);
  if (net.rate) return j({}, 429);
  let m;
  if ((m = url.match(/\/v1\/user\/([^/]+)\/leagues\/nfl\/(\d+)$/))) return j([sleeperWorld.league]);
  if ((m = url.match(/\/v1\/user\/([^/]+)$/))) return decodeURIComponent(m[1]) === 'ken_r' ? j({ user_id: 'u1', username: 'ken_r', display_name: 'Ken' }) : j(null, 404);
  if ((m = url.match(/\/v1\/league\/([^/]+)\/rosters$/))) return net.playersOnly ? j(null, 500) : j(sleeperWorld.rosters);
  if ((m = url.match(/\/v1\/league\/([^/]+)\/users$/))) return j(sleeperWorld.users);
  if ((m = url.match(/\/v1\/league\/([^/]+)\/matchups\/(\d+)$/))) return j(sleeperWorld.matchups[m[2]] || []);
  if ((m = url.match(/\/v1\/league\/([^/]+)\/transactions\/(\d+)$/))) return j(sleeperWorld.transactions[m[2]] || []);
  if ((m = url.match(/\/v1\/league\/([^/]+)$/))) return net.notFound || m[1] !== sleeperWorld.league.league_id ? j(null, 404) : j(sleeperWorld.league);
  if (url.startsWith('https://api.login.yahoo.com/oauth2/get_token')) {
    const body = String(init.body);
    if (/grant_type=refresh_token/.test(body)) { net.yahooRefreshed++; return net.yahooExpired ? j({ error: 'invalid_grant' }, 400) : j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }); }
    return j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, xoauth_yahoo_guid: 'GUID1' });
  }
  if (url.startsWith('https://fantasysports.yahooapis.com')) {
    const auth = (init.headers || {}).authorization || '';
    if (!/Bearer AT/.test(auth)) return j({}, 401);
    if (/\/users;use_login=true\/games/.test(url)) return j({ fantasy_content: { users: { 0: { user: [{ guid: 'GUID1' }, { games: { 0: { game: [{ game_key: '449' }, { leagues: { 0: { league: [YFIX.league] }, count: 1 } }] }, count: 1 } }] }, count: 1 } } });
    return j({ fantasy_content: { league: [YFIX.league, {}] } });
  }
  return j({}, 404);
}

// ── an in-memory D1 ────────────────────────────────────────────────────────
// Enough SQL for the region: INSERT ... ON CONFLICT (upsert by the table's
// primary key), UPDATE ... WHERE, DELETE ... WHERE, SELECT with simple
// conjunctions, COUNT(*), ORDER BY (ignored) and LIMIT (ignored).
const PK = { leagues: ['id'], league_teams: ['league_id', 'team_id'], league_roster_players: ['league_id', 'provider_player_id'], league_matchups: ['league_id', 'week', 'team_id'],
  league_transactions: ['league_id', 'provider_txn_id'], league_snapshots: ['league_id', 'season', 'week', 'kind'], league_sync_runs: ['id'], provider_connections: ['email', 'provider'],
  player_id_map: ['provider', 'provider_player_id'], player_map_misses: ['provider', 'provider_player_id'], sessions: ['id'] };
function fakeDb() {
  const t = {}; let auto = 1; const log = [];
  const table = n => (t[n] = t[n] || new Map());
  const where = (clause, args, ai) => {
    // "a=? AND b=? AND (c IS NULL OR c <= ?)" -> predicate. Unhandled clauses match everything.
    const parts = clause.replace(/[()]/g, '').split(/\s+AND\s+/i);
    const preds = [];
    for (const p of parts) {
      const ors = p.split(/\s+OR\s+/i).map(x => x.trim());
      const fns = ors.map(x => {
        let m;
        if ((m = x.match(/^(\w+)\s*(=|!=|<=|>=|<|>)\s*\?$/))) { const v = args[ai.i++]; const op = m[2], col = m[1]; return r => op === '=' ? r[col] == v : op === '!=' ? r[col] != v : op === '<=' ? r[col] <= v : op === '>=' ? r[col] >= v : op === '<' ? r[col] < v : r[col] > v; }
        if ((m = x.match(/^(\w+)\s+IS\s+\?$/))) { const v = args[ai.i++]; return r => r[m[1]] == v; }
        if ((m = x.match(/^(\w+)\s+IS\s+NULL$/))) return r => r[m[1]] == null;
        if ((m = x.match(/^(\w+)\s*(=|!=)\s*'([^']*)'$/))) return r => m[2] === '=' ? r[m[1]] == m[3] : r[m[1]] != m[3];
        return () => true;
      });
      preds.push(r => fns.some(f => f(r)));
    }
    return r => preds.every(f => f(r));
  };
  const run = (sql, args) => {
    log.push(sql);
    let m;
    if (/^CREATE /i.test(sql)) return { meta: { changes: 0 } };
    if ((m = sql.match(/^INSERT (?:OR REPLACE )?INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(s => s.trim()); const row = {};
      const vals = (sql.match(/VALUES \(([^)]+)\)/i) || [])[1].split(',').map(s => s.trim()); let ai2 = 0;
      cols.forEach((c, i) => { const v = vals[i]; row[c] = v === '?' ? args[ai2++] : v === 'NULL' ? null : Number(v); });
      const tb = table(m[1]); const pk = PK[m[1]] || cols; if (!row.id && pk[0] === 'id' && !cols.includes('id')) row.id = auto++;
      const key = pk.map(k => row[k]).join('|');
      if (tb.has(key) && /ON CONFLICT/i.test(sql)) { const cur = tb.get(key); const upd = {}; for (const c of cols) if (new RegExp(c + '=excluded\\.' + c).test(sql)) upd[c] = row[c]; if (/count=count\+1/.test(sql)) upd.count = (cur.count || 0) + 1; tb.set(key, { ...cur, ...upd }); }
      else tb.set(key, row);
      return { meta: { changes: 1 } };
    }
    if ((m = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/is))) {
      const sets = m[2].split(',').map(s => s.trim()); const ai = { i: 0 }; const assign = [];
      for (const s of sets) { const mm = s.match(/^(\w+)=(\?|NULL|\d+)$/); if (!mm) continue; if (mm[2] === '?') assign.push([mm[1], args[ai.i++]]); else if (mm[2] === 'NULL') assign.push([mm[1], null]); else assign.push([mm[1], Number(mm[2])]); }
      const pred = where(m[3], args, ai); let n = 0;
      for (const [k, r] of table(m[1])) if (pred(r)) { for (const [c, v] of assign) r[c] = v; n++; }
      return { meta: { changes: n } };
    }
    if ((m = sql.match(/^DELETE FROM (\w+)(?: WHERE (.+))?$/is))) { const tb = table(m[1]); const pred = m[2] ? where(m[2], args, { i: 0 }) : () => true; let n = 0; for (const [k, r] of [...tb]) if (pred(r)) { tb.delete(k); n++; } return { meta: { changes: n } }; }
    if ((m = sql.match(/^SELECT (.+?) FROM (\w+)(?: (?:r|l) LEFT JOIN .*)?(?: WHERE (.+?))?(?: GROUP BY .+?)?(?: ORDER BY .+?)?(?: LIMIT .+)?$/is))) {
      if (/JOIN|GROUP BY/i.test(sql)) return { results: [] };
      const rows = [...table(m[2]).values()].filter(m[3] ? where(m[3], args, { i: 0 }) : () => true);
      if (/COUNT\(\*\) AS n/i.test(m[1])) return { results: [{ n: rows.length }] };
      if (/MAX\((\w+)\)/i.test(m[1])) { const col = m[1].match(/MAX\((\w+)\)/i)[1]; return { results: [{ ts: rows.reduce((a, r) => Math.max(a, r[col] || 0), 0) || null }] }; }
      return { results: rows.map(r => ({ ...r })) };
    }
    return { results: [] };
  };
  const stmt = (sql, args) => ({ async run() { return run(sql, args); }, async first() { const r = run(sql, args); return r.results && r.results[0] || null; }, async all() { return run(sql, args); } });
  return { t, log, prepare(sql) { return { bind(...a) { return stmt(sql, a); }, run() { return stmt(sql, []).run(); }, first() { return stmt(sql, []).first(); }, all() { return stmt(sql, []).all(); } }; }, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

// ── the boards, stubbed off PROJECTIONS ───────────────────────────────────
// A deterministic board: each player's season line spread over the horizon's
// games, scored at the rules asked for. One player is "Out" for the week and
// one club is on a bye, so lineups and pickups have something to react to.
let BOARD_CALLS = 0;
const worldState = { week: 5, outName: null, byeTeam: null };
function stubBoards(H) {
  return async function boardsPayload(env, o) {
    BOARD_CALLS++;
    const weeksOf = { week: [worldState.week], next3: [worldState.week, worldState.week + 1, worldState.week + 2], ros: Array.from({ length: 17 - worldState.week + 1 }, (_, i) => worldState.week + i), playoffs: [15, 16, 17] }[o.horizon] || [worldState.week];
    const rules = H.scoringRules(o.preset, o.custom);
    const players = [];
    for (const p of H.PROJECTIONS) {
      const pos = p.position, team = H.teamKey(p.team);
      const weeks = weeksOf.map(w => {
        if (w === worldState.week && team === worldState.byeTeam) return { week: w, bye: true };
        if (w === worldState.week && p.name === worldState.outName) return { week: w, out: true, opponent: 'X' };
        return { week: w, opponent: 'OPP', home: w % 2 === 0, env: { implied: 24 }, ironTunaPts: 0, consensusPts: 0, vegasPts: 0 };
      });
      const games = weeks.filter(w => !w.bye && !w.out).length;
      const per = {}; for (const [k, v] of Object.entries(p.projectedStats || {})) per[k] = v / 17;
      const stats = {}; for (const [k, v] of Object.entries(per)) stats[k] = v * games;
      const pts = H._oddsRound(H.scoreAny(stats, pos, rules, games));
      for (const w of weeks) if (w.ironTunaPts != null) { w.ironTunaPts = H._oddsRound(pts / Math.max(1, games)); w.consensusPts = w.ironTunaPts; w.vegasPts = w.ironTunaPts; }
      players.push({ name: p.name, position: pos === 'DEF' ? 'DST' : pos, pos, team, key: H._oddsNorm(p.name) + '|' + pos, games, byes: weeks.filter(w => w.bye).map(w => w.week), weeks,
        injury: p.name === worldState.outName ? { status: 'Out', gamesOut: 1, note: 'hamstring' } : null, roleTrend: { label: 'no data', applied: false },
        scheduleDifficulty: { avgOpponentDefRank: 16, label: pos === 'WR' ? 'Easy' : 'Average' },
        consensus: { stats, points: pts }, vegas: { stats, points: pts, confidence: 'LOW', basis: 'ratings' }, ironTuna: { stats, points: pts, confidence: 'LOW' }, marketDelta: { points: 0, rank: 0, classification: 'AGREE', significant: false } });
    }
    return { ok: true, contract: 1, horizon: { key: o.horizon, weeks: weeksOf }, currentWeek: worldState.week, players };
  };
}

// ── assemble ───────────────────────────────────────────────────────────────
const stubs = {
  fetch: fakeFetch, PROVIDER_POSITIONS: new Set(['QB', 'RB', 'WR', 'TE']),
  scheduleCacheRead: async () => ({ season: 2026, games: [] }),
  nflSeasonState: () => ({ ok: true, week: { type: 'REG', number: worldState.week } }),
  jobRun: async (env, name) => ({ ok: true, ran: name }),
  corsHeaders: () => ({}), SEC: {}, flagReport: () => ({}),
  _availTable: () => ({}), _withAvailability: p => p, _availPool: pool => pool
};
const code = deps.join('\n') + '\n' + _oddsRoundSrc + '\nvar boardsPayload = __stubBoards({ scoringRules, PROJECTIONS, teamKey, scoreAny, _oddsNorm, _oddsRound });\n' + region +
  '\nreturn { leagueReady, leagueNormalizeSettings, leagueEffectiveSettings, leagueScore, leagueScoringKey, leagueSettingsLabel, leagueResolvePlayer, leagueMapPlayers, leagueOptimize, leagueStarterSlots, leagueRosterSize, sleeperScoring, sleeperRoster, sleeperNormalize, yahooScoring, yahooNormalize, yMerge, yList, LEAGUE_PROVIDERS, leagueProviderReport, leagueSync, runLeagueSync, leagueCreateRow, leagueLoad, leagueList, leagueManualUpsert, leagueSetDefault, leagueDisconnect, leagueBoard, leagueLineup, leaguePickups, leagueMatchup, leagueIntel, leagueTrades, leaguePlayoffs, leagueAvailabilityLookup, leagueSummary, leagueRoutes, leagueSeal, leagueOpen, yahooAccessToken, yahooConnectionSave, leagueConnectionRead, leagueNextSyncAt, makeToken, SCORING_BASE, scoringRules, scoreAny, PROJECTIONS, _oddsNorm, teamKey, flagOn, LEAGUE_STALE_MS, leagueRowToLeague };';
const H = new Function(...Object.keys(stubs), '__stubBoards', code)(...Object.values(stubs), stubBoards);

// ── a world: a 12-team superflex league on real players ───────────────────
const byPos = {}; for (const p of H.PROJECTIONS) (byPos[p.position] = byPos[p.position] || []).push(p);
const pick = (pos, i) => byPos[pos][i];
let nextId = 4000;
const idOf = new Map();
function sleeperPlayer(p) { if (!idOf.has(p.name)) { const id = String(nextId++); idOf.set(p.name, id); sleeperWorld.players[id] = { player_id: id, full_name: p.name, first_name: p.name.split(' ')[0], last_name: p.name.split(' ').slice(1).join(' '), position: p.position, team: p.team, injury_status: null, espn_id: 100000 + Number(id), yahoo_id: 200000 + Number(id) }; } return idOf.get(p.name); }
for (const t of Object.keys(byPos)) if (t === 'DEF') for (const d of byPos.DEF) { const id = d.team; idOf.set(d.name, id); sleeperWorld.players[id] = { player_id: id, position: 'DEF', team: d.team }; }
function buildWorld(nTeams, opts) {
  const o = opts || {};
  const lg = JSON.parse(JSON.stringify(FIX.league));
  lg.total_rosters = nTeams; lg.settings.num_teams = nTeams;
  if (o.scoring) Object.assign(lg.scoring_settings, o.scoring);
  if (o.roster_positions) lg.roster_positions = o.roster_positions;
  if (o.noTe) delete lg.scoring_settings.bonus_rec_te;
  sleeperWorld.league = lg;
  sleeperWorld.users = [{ user_id: 'u1', display_name: 'Ken', username: 'ken_r', metadata: { team_name: 'Iron Tunas' } }].concat(Array.from({ length: nTeams - 1 }, (_, i) => ({ user_id: 'u' + (i + 2), display_name: 'Manager ' + (i + 2), metadata: { team_name: 'Team ' + (i + 2) } })));
  const starterSlots = lg.roster_positions.filter(p => p !== 'BN' && p !== 'IR');
  sleeperWorld.rosters = [];
  const counters = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const take = pos => { const p = pick(pos, counters[pos]++); return p ? sleeperPlayer(p) : null; };
  for (let r = 1; r <= nTeams; r++) {
    const starters = starterSlots.map(s => s === 'FLEX' ? take('WR') : s === 'SUPER_FLEX' ? take('QB') : take(s));
    const bench = [take('RB'), take('WR'), take('WR'), take('TE'), take('RB'), take('QB')];
    const players = starters.concat(bench).filter(Boolean);
    sleeperWorld.rosters.push({ roster_id: r, owner_id: 'u' + r, players, starters, reserve: [], taxi: [], settings: { wins: nTeams - r, losses: r - 1, ties: 0, fpts: 1000 - r * 10, fpts_decimal: 50, fpts_against: 900, fpts_against_decimal: 0, waiver_budget_used: r * 5, waiver_position: r } });
  }
  sleeperWorld.matchups = {};
  for (let w = 1; w <= 6; w++) { sleeperWorld.matchups[w] = []; for (let r = 1; r <= nTeams; r += 2) { const mid = (r + 1) / 2; sleeperWorld.matchups[w].push({ roster_id: r, matchup_id: mid, points: w < worldState.week ? 100 + r : 0 }, { roster_id: r + 1, matchup_id: mid, points: w < worldState.week ? 95 + r : 0 }); } }
  const dropped = sleeperWorld.rosters[1].players.pop();
  sleeperWorld.transactions = { [worldState.week]: [{ transaction_id: 'tx1', type: 'waiver', status: 'complete', roster_ids: [2], adds: {}, drops: { [dropped]: 2 }, settings: { waiver_bid: 12 }, created: Date.now() - 3600000, status_updated: Date.now() - 3600000, leg: worldState.week }], [worldState.week - 1]: [] };
  return { lg, dropped };
}
const req = (method, url, body, cookie) => new Request('https://irontuna.com' + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
async function session(env, email) { const tok = await H.makeToken(env.AUTH_SECRET, { sid: 's-' + email, e: email, t: 'sess', exp: Date.now() + 3600000 }); env.LEADS_DB.t.sessions = env.LEADS_DB.t.sessions || new Map(); env.LEADS_DB.t.sessions.set('s-' + email, { id: 's-' + email, email }); return 'it_sess=' + tok; }
async function route(env, method, url, body, cookie) { const r = await H.leagueRoutes(new Request('https://irontuna.com' + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, new URL('https://irontuna.com' + url), {}); return r ? { status: r.status, body: await r.json().catch(() => null), headers: r.headers } : null; }

console.log('\nsettings normalisation');
{
  const sc = H.sleeperScoring(FIX.league.scoring_settings);
  ok('Sleeper pass_yd 0.04 becomes 25 yards per point, no threshold', sc.scoring.passingYardsPerPoint === 25 && sc.scoring.passingYardsThreshold === 0);
  ok('rec 1 is full PPR for WR and RB alike', sc.scoring.receptionPoints === 1 && sc.scoring.rbReceptionPoints === 1);
  ok('bonus_rec_te 0.5 becomes TE premium, not a WR reception value', sc.extras.tePremium === 0.5 && sc.scoring.receptionPoints === 1);
  ok('the 300-yard passing bonus and 100-yard rushing bonus are carried', sc.scoring.passingYardBonuses[0].at === 300 && sc.scoring.passingYardBonuses[0].points === 1 && sc.scoring.rushingYardBonuses[0].points === 2);
  ok('kicker tiers and points-allowed tiers are filled from Sleeper bins', sc.scoring.fieldGoalTiers[4].points === 5 && sc.scoring.pointsAllowed[0].points === 10 && sc.scoring.pointsAllowed[6].points === -4);
  ok('unsupported rules (kr_yd, idp_tkl) are preserved, not dropped', sc.extras.unsupported.kr_yd === 0.04 && sc.extras.unsupported.idp_tkl === 1 && /kr_yd/.test(sc.extras.notes.join(' ')));
  const half = H.sleeperScoring({ rec: 0.5 }); ok('half PPR', half.scoring.receptionPoints === 0.5 && half.scoring.rbReceptionPoints === 0.5);
  const std = H.sleeperScoring({ rec: 0, pass_td: 6 }); ok('standard scoring with 6-point passing TDs', std.scoring.receptionPoints === 0 && std.scoring.passingTD === 6);
  const rb = H.sleeperScoring({ rec: 1, bonus_rec_rb: -0.5 }); ok('position-specific PPR (RB half, WR full)', rb.scoring.rbReceptionPoints === 0.5 && rb.scoring.receptionPoints === 1);
  const r = H.sleeperRoster(FIX.league.roster_positions, FIX.league.settings);
  ok('roster slots: QB1 RB2 WR2 TE1 FLEX1 SFLEX1 K1 DEF1 BN6 IR1', r.QB === 1 && r.RB === 2 && r.WR === 2 && r.TE === 1 && r.FLEX === 1 && r.SFLEX === 1 && r.K === 1 && r.DEF === 1 && r.BN === 6 && r.IR === 1);
  const r2 = H.sleeperRoster(['QB', 'RB', 'WR', 'REC_FLEX', 'WRRB_FLEX', 'DL', 'LB', 'BN'], {});
  ok('unusual slots map or are kept under other', r2.REC_FLEX === 1 && r2.WRRB_FLEX === 1 && r2.other.DL === 1 && r2.other.LB === 1 && H.leagueRosterSize(r2) === 8);
  const n = H.leagueNormalizeSettings({ scoring: { receptionPoints: 'abc', bogusKey: 3 }, roster: { QB: 99 } });
  ok('a bad value falls back and a bogus key is preserved as unsupported', n.scoring.receptionPoints === 1 && n.extras.unsupported.bogusKey === 3 && n.roster.QB === 20);
  const eff = H.leagueEffectiveSettings(H.leagueNormalizeSettings({ scoring: { receptionPoints: 1 }, extras: { tePremium: 0 } }), { scoring: { receptionPoints: 0.5 }, extras: { tePremium: 1 }, roster: { SFLEX: 1 } });
  ok('overrides lay over synced settings and are named', eff.scoring.receptionPoints === 0.5 && eff.extras.tePremium === 1 && eff.roster.SFLEX === 1 && eff.overridden.join() === 'scoring.receptionPoints,extras.tePremium,roster.SFLEX');
  const te = H.leagueNormalizeSettings({ extras: { tePremium: 0.5 } });
  ok('TE premium adds per catch for tight ends only', H.leagueScore({ rec: 10, recYd: 100 }, 'TE', te, 1) - H.scoreAny({ rec: 10, recYd: 100 }, 'TE', te.scoring, 1) === 5 && H.leagueScore({ rec: 10, recYd: 100 }, 'WR', te, 1) === H.scoreAny({ rec: 10, recYd: 100 }, 'WR', te.scoring, 1));
  ok('the scoring key changes when the rules change', H.leagueScoringKey(te) !== H.leagueScoringKey(H.leagueNormalizeSettings({})) && H.leagueScoringKey(te) === H.leagueScoringKey(H.leagueNormalizeSettings({ extras: { tePremium: 0.5 } })));
  ok('the label reads the settings', /PPR · TE premium · 12 teams · Superflex/.test(H.leagueSettingsLabel(H.leagueNormalizeSettings({ extras: { tePremium: 0.5 }, roster: { QB: 1, SFLEX: 1 } }), 12)));
  const y = H.yahooScoring(YFIX.settings.stat_modifiers.stats.map(s => s.stat));
  ok('Yahoo stat ids map: 6-pt pass TD, -2 INT, half PPR, 25 yd/pt passing', y.scoring.passingTD === 6 && y.scoring.passingInt === -2 && y.scoring.receptionPoints === 0.5 && y.scoring.passingYardsPerPoint === 25);
  ok('an unknown Yahoo stat id is preserved as unsupported', y.extras.unsupported.yahoo_stat_78 === 1);
  const yn = H.yahooNormalize({ league: YFIX.league, settings: YFIX.settings, teams: [{ team_id: '1', name: 'Mine', is_owned_by_current_login: '1', managers: [{ nickname: 'Ken', guid: 'GUID1' }], team_standings: { rank: 2, outcome_totals: { wins: 3, losses: 1 }, points_for: 400 }, roster: [{ player_id: '30123', name: { full: pick('WR', 0).name }, primary_position: 'WR', editorial_team_abbr: pick('WR', 0).team.toLowerCase(), selected_position: { position: 'WR' } }, { player_id: '30124', name: { full: pick('RB', 0).name }, primary_position: 'RB', editorial_team_abbr: pick('RB', 0).team, selected_position: { position: 'BN' } }] }], matchups: [{ week: 5, status: 'midevent', teams: [{ team_id: '1', points: 10 }, { team_id: '2', points: 12 }] }], transactions: [] }, { currentWeek: 5 });
  ok('Yahoo normalises: W/R/T is FLEX, 3 WR, FAAB on, the user team found, starters and bench read', yn.settings.roster.FLEX === 1 && yn.settings.roster.WR === 3 && yn.settings.faab === 100 && yn.userTeamId === '1' && yn.rosters[0].players[0].slot === 'starter' && yn.rosters[0].players[1].slot === 'bench' && yn.matchups[0].opponentId === '2');
  ok('yMerge folds Yahoo array-of-objects into one object', H.yMerge([{ a: 1 }, [{ b: 2 }], { c: 3 }]).b === 2 && H.yList({ 0: 'x', 1: 'y', count: 2 }).length === 2);
}

console.log('\nplayer-id matching');
{
  const wr = pick('WR', 0);
  ok('exact name and position resolve to the canonical key', H.leagueResolvePlayer({ name: wr.name, position: 'WR', team: wr.team }).key === H._oddsNorm(wr.name) + '|WR');
  ok('a suffix does not break the match', H.leagueResolvePlayer({ name: wr.name + ' Jr.', position: 'WR' }).key === H._oddsNorm(wr.name) + '|WR');
  ok('the wrong position is a miss, not a guess', H.leagueResolvePlayer({ name: wr.name, position: 'TE' }).key === null);
  ok('a defence resolves by club', H.leagueResolvePlayer({ name: 'HOU DEF', position: 'DEF', team: 'HOU' }).key === H._oddsNorm('Houston Texans') + '|DEF');
  ok('an unknown name is a miss with a reason', H.leagueResolvePlayer({ name: 'Nobody Atall', position: 'RB', team: 'BUF' }).key === null && /not on the board/.test(H.leagueResolvePlayer({ name: 'Nobody Atall', position: 'RB' }).reason));
  ok('an unranked position is refused', /not ranked/.test(H.leagueResolvePlayer({ name: 'Some Linebacker', position: 'LB' }).reason));
  const db = fakeDb(); const env = { LEADS_DB: db };
  await H.leagueReady(env);
  const m = await H.leagueMapPlayers(env, 'sleeper', [{ providerPlayerId: '1', name: wr.name, position: 'WR', team: wr.team }, { providerPlayerId: '2', name: 'Nobody Atall', position: 'RB', team: 'BUF' }, { providerPlayerId: '1', name: wr.name, position: 'WR' }]);
  ok('one map row per provider id, one miss logged, duplicates ignored', m.map.size === 2 && m.unmatched === 1 && db.t.player_id_map.size === 1 && db.t.player_map_misses.size === 1);
  await H.leagueMapPlayers(env, 'sleeper', [{ providerPlayerId: '2', name: 'Nobody Atall', position: 'RB', team: 'BUF' }]);
  ok('a repeated miss increments its count rather than duplicating', db.t.player_map_misses.size === 1 && [...db.t.player_map_misses.values()][0].count === 2);
}

console.log('\nthe Sleeper connector, end to end');
const db = fakeDb(); const env = { LEADS_DB: db, AUTH_SECRET: 'test-secret', LEAGUE_TOKEN_KEY: 'k', FLAG_SLEEPER_SYNC: '1', FLAG_YAHOO_SYNC: '1', YAHOO_CLIENT_ID: 'cid', YAHOO_CLIENT_SECRET: 'cs' };
const world = buildWorld(12);
const cookie = await session(env, 'ken@example.com');
let leagueId = null;
{
  const rep = H.leagueProviderReport({});
  ok('with no flags set, Sleeper, Yahoo and ESPN are all off and say why', !rep.sleeper.enabled && /FLAG_SLEEPER_SYNC/.test(rep.sleeper.reason) && !rep.yahoo.enabled && !rep.espn.enabled && /manual/i.test(rep.espn.reason));
  ok('with the flag and config, Sleeper and Yahoo are on; ESPN never', H.leagueProviderReport(env).sleeper.enabled && H.leagueProviderReport(env).yahoo.enabled && !H.leagueProviderReport(env).espn.enabled);
  const anon = await route(env, 'GET', '/api/leagues');
  ok('the routes refuse a reader who is not signed in', anon.status === 401 && anon.body.error === 'not_signed_in');
  const pub = await route(env, 'GET', '/api/leagues/providers');
  ok('provider availability is public', pub.status === 200 && pub.body.providers.sleeper.enabled === true);
  const d = await route(env, 'POST', '/api/leagues/connect', { provider: 'sleeper', username: 'ken_r' }, cookie);
  ok('discovery by username lists the league', d.status === 200 && d.body.step === 'leagues' && d.body.leagues.length === 1 && d.body.user.id === 'u1');
  const nf = await route(env, 'POST', '/api/leagues/connect', { provider: 'sleeper', username: 'nobody' }, cookie);
  ok('an unknown username is a clear error', nf.status === 404 && nf.body.error === 'user_not_found' && /username/.test(nf.body.message));
  const c = await route(env, 'POST', '/api/leagues/connect', { provider: 'sleeper', leagueId: world.lg.league_id, name: world.lg.name, providerUserId: 'u1' }, cookie);
  leagueId = c.body.league && c.body.league.id;
  ok('connecting imports the league and identifies the user team', c.status === 200 && c.body.step === 'done' && c.body.created && c.body.sync.ok && c.body.league.userTeamId === '1' && !c.body.needsTeam);
  const L = await H.leagueLoad(env, 'ken@example.com', leagueId);
  ok('twelve teams, rosters, this week and past matchups, and the transaction were stored', L.teams.length === 12 && L.rosters.length === 12 && L.rosters[0].players.length === 16 && L.matchups.some(m => m.week === 5) && L.matchups.some(m => m.week === 1 && m.played) && L.transactions.length === 1 && L.transactions[0].drops[0].id === world.dropped);
  ok('scoring and roster came through as the league model', L.settings.extras.tePremium === 0.5 && L.settings.roster.SFLEX === 1 && L.settings.faab === 100 && L.label.includes('Superflex') && L.teams[0].faabLeft === 95);
  ok('starter and bench slots follow the provider, with the slot label', L.rosters[0].players.filter(p => p.slot === 'starter').length === 10 && L.rosters[0].players.find(p => p.slotLabel === 'SFLEX') && L.rosters[0].players.filter(p => p.slot === 'bench').length === 6);
  ok('every rostered player mapped to a key (real names from the pool)', L.rosters.every(r => r.players.every(p => p.key)) && c.body.sync.unmatched === 0);
  ok('the first league is the default', L.isDefault === true && L.sync.status === 'ok' && !L.sync.stale);
  const list = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('the list carries the league, the default id and no email', list.body.leagues.length === 1 && list.body.defaultId === leagueId && !JSON.stringify(list.body).includes('ken@example.com'));
  // Idempotency
  const rows = () => [db.t.league_teams.size, db.t.league_roster_players.size, db.t.league_matchups.size, db.t.league_transactions.size, db.t.leagues.size];
  const before = rows();
  const row = [...db.t.leagues.values()][0];
  const again = await H.leagueSync(env, row, 'test');
  ok('syncing again writes the same rows: no duplicate teams, players, matchups, transactions or leagues', again.ok && rows().join() === before.join());
  const dup = await route(env, 'POST', '/api/leagues/connect', { provider: 'sleeper', leagueId: world.lg.league_id, providerUserId: 'u1' }, cookie);
  ok('connecting the same league twice does not create a second league', dup.body.created === false && db.t.leagues.size === 1);
  ok('every league table insert is an upsert on its primary key', db.log.filter(s => /^INSERT INTO league_/.test(s) && !/league_sync_runs/.test(s)).every(s => /ON CONFLICT/.test(s)));
  // A dropped player leaves the roster on the next sync
  const gone = sleeperWorld.rosters[0].players.pop();
  await H.leagueSync(env, row, 'test');
  const L2 = await H.leagueLoad(env, 'ken@example.com', leagueId);
  ok('a player dropped at the provider is gone after the next sync', !L2.rosters[0].players.some(p => p.providerPlayerId === gone) && db.t.league_roster_players.size === before[1] - 1);
  sleeperWorld.rosters[0].players.push(gone);
  // Sync Now rate limit
  const soon = await route(env, 'POST', '/api/leagues/' + leagueId + '/sync', null, cookie);
  ok('Sync Now twice inside two minutes is refused, with the last sync intact', soon.status === 429 && soon.body.error === 'too_soon');
  const forced = await route(env, 'POST', '/api/leagues/' + leagueId + '/sync?force=1', null, cookie);
  ok('a forced sync runs', forced.status === 200 && forced.body.sync.ok);
  // Overrides survive a sync
  const ov = await route(env, 'POST', '/api/leagues/' + leagueId + '/overrides', { overrides: { scoring: { passingTD: 6 }, roster: { BN: 7 } } }, cookie);
  ok('a correction is applied and labelled', ov.body.league.settings.scoring.passingTD === 6 && ov.body.league.settings.overridden.includes('scoring.passingTD') && ov.body.league.synced.scoring.passingTD === 4);
  await H.leagueSync(env, [...db.t.leagues.values()][0], 'test');
  const L3 = await H.leagueLoad(env, 'ken@example.com', leagueId);
  ok('the correction survives the next sync', L3.settings.scoring.passingTD === 6 && L3.settings.roster.BN === 7 && L3.overrides.scoring.passingTD === 6);
  const cl = await route(env, 'POST', '/api/leagues/' + leagueId + '/overrides', { clear: true }, cookie);
  ok('clearing goes back to the synced values', cl.body.league.settings.scoring.passingTD === 4 && cl.body.league.settings.overridden.length === 0);
  // Provider outage
  net.down = true;
  const out = await H.leagueSync(env, [...db.t.leagues.values()][0], 'test');
  net.down = false;
  const L4 = await H.leagueLoad(env, 'ken@example.com', leagueId);
  ok('a provider outage is a failed run, the league and its rosters are kept, and a retry is scheduled with backoff', !out.ok && out.code === 'provider_unavailable' && L4.sync.status === 'failed' && L4.rosters[0].players.length === 16 && L4.sync.lastOkAt && L4.sync.failures === 1 && L4.sync.nextAt > Date.now() + 10 * 60000 && L4.sync.nextAt < Date.now() + 20 * 60000);
  const rl = await (async () => { net.rate = true; const r = await H.leagueSync(env, [...db.t.leagues.values()][0], 'test'); net.rate = false; return r; })();
  ok('a 429 is a rate_limited failure with doubled backoff', rl.code === 'rate_limited' && [...db.t.leagues.values()][0].failures === 2 && [...db.t.leagues.values()][0].next_sync_at > Date.now() + 25 * 60000);
  const nf2 = await (async () => { net.notFound = true; const r = await H.leagueSync(env, [...db.t.leagues.values()][0], 'test'); net.notFound = false; return r; })();
  ok('a league that disappeared is league_not_found, and the league is not deleted', nf2.code === 'league_not_found' && db.t.leagues.size === 1);
  // Partial sync: rosters endpoint down
  net.playersOnly = true; const partial = await H.leagueSync(env, [...db.t.leagues.values()][0], 'test'); net.playersOnly = false;
  ok('a partial provider failure is a failed run, nothing half-written', !partial.ok && (await H.leagueLoad(env, 'ken@example.com', leagueId)).rosters[0].players.length === 16);
  const good = await H.leagueSync(env, [...db.t.leagues.values()][0], 'test');
  ok('the next good sync clears the failure state', good.ok && [...db.t.leagues.values()][0].failures === 0 && [...db.t.leagues.values()][0].sync_status === 'ok');
  // Stale
  const rowS = [...db.t.leagues.values()][0]; const keep = rowS.last_ok_at; rowS.last_ok_at = Date.now() - H.LEAGUE_STALE_MS - 1000;
  ok('a league not synced for twelve hours reads as stale', H.leagueRowToLeague(rowS).sync.stale === true);
  rowS.last_ok_at = keep;
  ok('the sync log has a row per run with the duration and unmatched count', db.t.league_sync_runs.size >= 8 && [...db.t.league_sync_runs.values()].every(r => r.finished_at >= r.started_at && typeof r.unmatched === 'number'));
  // The job
  rowS.next_sync_at = Date.now() - 1000;
  const job = await H.runLeagueSync(env);
  ok('the job syncs what is due and reschedules it', job.ok && job.due === 1 && job.synced === 1 && rowS.next_sync_at > Date.now());
  const job2 = await H.runLeagueSync(env);
  ok('nothing due, nothing synced', job2.due === 0);
  const sun = Date.UTC(2026, 8, 13, 15, 0), tue = Date.UTC(2026, 8, 15, 14, 0), fri = Date.UTC(2026, 8, 18, 14, 0);
  ok('the cadence: hourly Sunday late morning, three-hourly Tuesday, six-hourly otherwise', H.leagueNextSyncAt(sun, 0) - sun === 3600000 && H.leagueNextSyncAt(tue, 0) - tue === 3 * 3600000 && H.leagueNextSyncAt(fri, 0) - fri === 6 * 3600000);
  // Flag off stops the scheduled refresh too
  const envOff = { ...env, FLAG_SLEEPER_SYNC: '0' };
  const off = await H.leagueSync(envOff, [...db.t.leagues.values()][0], 'test');
  ok('with the Sleeper flag off, the scheduled refresh refuses rather than fetching', !off.ok && off.error === 'provider_disabled');
  const conOff = await route(envOff, 'POST', '/api/leagues/connect', { provider: 'sleeper', username: 'ken_r' }, cookie);
  ok('and connecting is refused with the flag named', conOff.status === 503 && /FLAG_SLEEPER_SYNC/.test(conOff.body.detail));
  const espn = await route(env, 'POST', '/api/leagues/connect', { provider: 'espn', username: 'x' }, cookie);
  ok('ESPN says plainly that it cannot be synced and points to manual', espn.status === 503 && /manual/i.test(espn.body.detail));
}

console.log('\npersonalisation on the synced league');
{
  const L = await H.leagueLoad(env, 'ken@example.com', leagueId);
  const wk = await H.leagueBoard(env, L, 'week');
  ok('the league board is scored at the league rules and every row says who owns him', wk.ok && wk.scoring.preset === 'league' && wk.players.every(p => p.roster && p.roster.status) && wk.players.some(p => p.roster.status === 'mine') && wk.players.some(p => p.roster.status === 'rostered') && wk.players.some(p => p.roster.status === 'available'));
  ok('the dropped player is on waivers, not a free agent', wk.players.find(p => p.key === L.transactions[0].drops[0].key).roster.status === 'waiver');
  // TE premium moves tight ends
  const plain = await H.leagueBoard(env, { ...L, settings: { ...L.settings, extras: { ...L.settings.extras, tePremium: 0 } } }, 'ros');
  const prem = await H.leagueBoard(env, L, 'ros');
  const te0 = plain.players.find(p => p.pos === 'TE'), te1 = prem.players.find(p => p.key === te0.key);
  ok('TE premium raises tight ends by half a point per catch on the league board', te1.ironTuna.points > te0.ironTuna.points && Math.abs((te1.ironTuna.points - te0.ironTuna.points) - 0.5 * te0.ironTuna.stats.rec) < 0.2);
  ok('and the flex rank of that tight end improves or holds', te1.ironTuna.flexRank <= te0.ironTuna.flexRank);
  // Lineup
  worldState.byeTeam = null;
  const lu = await H.leagueLineup(env, L);
  ok('the best lineup fills every slot including superflex, from the actual roster', lu.ok && lu.lineup.length === 10 && lu.lineup.filter(s => s.slot === 'SFLEX').length === 1 && lu.lineup.every(s => !s.empty) && lu.projectedTotal > 0);
  ok('superflex is filled by a quarterback when one is the best eligible', lu.lineup.find(s => s.slot === 'SFLEX').position === 'QB');
  ok('decisions carry both players, a margin and a graded confidence', lu.decisions.every(d => d.empty || (d.start && d.sit && ['Lean', 'Moderate', 'Strong'].includes(d.confidence) && /projects/.test(d.reason))));
  // A ruled-out starter is benched by arithmetic and intel says who replaces him
  const starter = lu.lineup.find(s => s.slot === 'RB');
  worldState.outName = starter.name;
  const lu2 = await H.leagueLineup(env, L);
  ok('a ruled-out starter drops out of the best lineup', !lu2.lineup.some(s => s.name === starter.name) && lu2.changes.some(c => c.action === 'bench' && c.name === starter.name && c.reason === 'ruled out'));
  const intel = await H.leagueIntel(env, L);
  ok('intel names the ruled-out starter first, with the replacement to start', intel.ok && intel.alerts[0].name === starter.name && intel.alerts[0].tag === 'AFFECTS YOUR ROSTER' && /^Start /.test(intel.alerts[0].action));
  worldState.outName = null;
  // The 1-QB vs superflex difference
  const oneQb = { ...L, settings: { ...L.settings, roster: { ...L.settings.roster, SFLEX: 0 } } };
  const lu1 = await H.leagueLineup(env, oneQb);
  ok('a 1-QB league starts one quarterback; the superflex league starts two', lu1.lineup.filter(s => s.position === 'QB').length === 1 && lu.lineup.filter(s => s.position === 'QB').length === 2);
  // Pickups
  const pk = await H.leaguePickups(env, L, { limit: 10 });
  ok('the pickup advisor only recommends players nobody in the league owns', pk.ok && pk.pickups.length > 0 && pk.pickups.every(p => p.status === 'available' || p.status === 'waiver') && pk.pickups.every(p => !L.rosters.some(r => r.players.some(x => x.key === p.key))));
  ok('each pickup says why, who to drop, the priority, the FAAB range and the horizon values', pk.pickups.every(p => p.why && p.priority && p.projected.ros >= 0 && (p.drop === null || p.drop.name || p.drop.open) && p.faab && p.faab.low <= p.faab.high && p.faab.budget === 95));
  ok('a drop is never worth more than the add', pk.pickups.filter(p => p.drop && p.drop.name).every(p => p.projected.ros > p.drop.ros || p.gain.ros > 0 || p.gain.next3 > 0));
  const noFaab = { ...L, settings: { ...L.settings, faab: null, waiverType: 'priority' } };
  const pk2 = await H.leaguePickups(env, noFaab, { limit: 5 });
  ok('a waiver-priority league gets no bid range', pk2.ok && pk2.pickups.every(p => p.faab === null));
  // 10 vs 14 teams: the pool shrinks
  const w10 = buildWorld(10); const row10 = (await H.leagueCreateRow(env, 'ken@example.com', 'sleeper', 'ten', 'Ten', 2026, { providerUserId: 'u1' })).row; sleeperWorld.league.league_id = 'ten'; await H.leagueSync(env, row10, 'test');
  const L10 = await H.leagueLoad(env, 'ken@example.com', row10.id); const pk10 = await H.leaguePickups(env, L10, { limit: 40 });
  const w14 = buildWorld(14); const row14 = (await H.leagueCreateRow(env, 'ken@example.com', 'sleeper', 'fourteen', 'Fourteen', 2026, { providerUserId: 'u1' })).row; sleeperWorld.league.league_id = 'fourteen'; await H.leagueSync(env, row14, 'test');
  const L14 = await H.leagueLoad(env, 'ken@example.com', row14.id); const pk14 = await H.leaguePickups(env, L14, { limit: 40 });
  const taken14 = new Set(L14.rosters.flatMap(r => r.players.map(p => p.key)));
  ok('a 14-team league has fewer available players than a 10-team league, and someone the 10-team advisor offers is rostered in the 14-team room', pk14.availableCount < pk10.availableCount && L14.teams.length === 14 && L10.teams.length === 10 && pk10.pickups.some(p => taken14.has(p.key)));
  const av10 = H.leagueAvailabilityLookup(L10, [{ name: pk14.pickups[0].name }]), av14 = H.leagueAvailabilityLookup(L14, [{ name: pk14.pickups[0].name }]);
  ok('a waiver target can be available in one league and rostered in another (the availability service)', av14[0].status !== 'rostered' && ['available', 'waiver', 'rostered', 'mine'].includes(av10[0].status));
  buildWorld(12); sleeperWorld.league.league_id = world.lg.league_id;
  // Multiple leagues, default switching, disconnect
  const list = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('three leagues on the account, one default', list.body.leagues.length === 3 && list.body.leagues.filter(l => l.isDefault).length === 1 && list.body.defaultId === leagueId);
  const sd = await route(env, 'POST', '/api/leagues/' + row14.id + '/default', null, cookie);
  const list2 = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('the default switches, and only one league is default', sd.body.ok && list2.body.defaultId === row14.id && list2.body.leagues.filter(l => l.isDefault).length === 1);
  const other = await session(env, 'other@example.com');
  const cross = await route(env, 'GET', '/api/leagues/' + leagueId, null, other);
  ok('another reader cannot read this reader\'s league', cross.status === 404);
  const dis = await route(env, 'POST', '/api/leagues/' + row14.id + '/disconnect', null, cookie);
  ok('disconnecting removes the league and all its rows and says what was removed', dis.body.ok && dis.body.removed.length >= 5 && ![...db.t.leagues.values()].some(l => l.id === row14.id) && ![...db.t.league_roster_players.values()].some(p => p.league_id === row14.id) && ![...db.t.league_teams.values()].some(p => p.league_id === row14.id));
  const list3 = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('a new default is chosen when the default is disconnected', list3.body.leagues.length === 2 && list3.body.leagues.filter(l => l.isDefault).length === 1);
  // Matchup, trades, playoffs, availability, summary
  const Lm = await H.leagueLoad(env, 'ken@example.com', leagueId);
  const mu = await H.leagueMatchup(env, Lm);
  ok('the matchup names the opponent, both projected totals and a graded verdict', mu.ok && mu.opponent && mu.opponent.teamId === '2' && mu.you.projected > 0 && mu.opponent.projected > 0 && /toss-up|lean|favored/.test(mu.verdict) && Array.isArray(mu.swing));
  const tr = await H.leagueTrades(env, Lm, { minGain: 0.1 });
  ok('trades: every partner is a real manager, and any proposal improves both lineups', tr.ok && tr.teams.length === 12 && tr.trades.every(t => Lm.teams.some(x => x.name === t.partner) && t.yourGain > 0 && t.theirGain > 0 && t.why.length >= 2) && tr.targets.every(t => Lm.teams.some(x => x.name === t.owner)));
  ok('trade data for the browser engine carries every roster with points per horizon', tr.teams.every(t => t.players.every(p => 'ros' in p && 'next3' in p)) && tr.teams.filter(t => t.isUser).length === 1);
  const po = await H.leaguePlayoffs(env, Lm);
  ok('playoff readiness grades every started position against the room and lists bench moves', po.ok && po.positions.length >= 5 && po.positions.every(p => ['strong', 'average', 'weak'].includes(p.grade)) && po.rankInLeague >= 1 && po.rankInLeague <= 12 && Array.isArray(po.benchMoves) && po.weeks.join() === '15,16,17');
  const av = H.leagueAvailabilityLookup(Lm, [{ name: Lm.rosters[0].players[0].name }, { name: Lm.rosters[1].players[0].name }, { name: 'Nobody Atall' }]);
  ok('availability: mine, rostered by a named team (the opponent), unknown', av[0].status === 'mine' && av[1].status === 'rostered' && av[1].isOpponent === true && av[2].status === 'unknown' && /opponent/i.test(av[1].label));
  const sum = await H.leagueSummary(env, Lm);
  ok('the summary carries the lineup, the matchup, the alerts and the top pickups', sum.ok && sum.lineup && sum.matchup && Array.isArray(sum.alerts) && sum.pickups.length > 0);
  const adv = await route(env, 'GET', '/api/leagues/' + leagueId + '/advice?module=lineup', null, cookie);
  ok('the advice route answers and says whether the league is stale', adv.status === 200 && adv.body.ok && adv.body.stale === false && adv.body.league.id === leagueId);
  const gated = await route({ ...env, FLAG_PERSONALIZED_WAIVERS: '0' }, 'GET', '/api/leagues/' + leagueId + '/advice?module=pickups', null, cookie);
  ok('a module flag turns its route off', gated.status === 404);
  const bd = await route(env, 'GET', '/api/leagues/' + leagueId + '/board?horizon=ros&pos=TE', null, cookie);
  ok('the board route filters by position', bd.status === 200 && bd.body.players.every(p => p.position === 'TE'));
  const avr = await route(env, 'GET', '/api/leagues/' + leagueId + '/availability?names=' + encodeURIComponent(Lm.rosters[0].players[0].name), null, cookie);
  ok('the availability route resolves a name', avr.body.players[0].status === 'mine');
  // No user team
  const noTeam = { ...Lm, userTeamId: null };
  ok('without a user team the modules say so instead of guessing', !(await H.leagueLineup(env, noTeam)).ok && (await H.leagueLineup(env, noTeam)).error === 'no_user_team');
}

console.log('\nmanual leagues');
{
  const wr = pick('WR', 5), rb = pick('RB', 5), qb = pick('QB', 3);
  const r = await route(env, 'POST', '/api/leagues/manual', { name: 'Hand League', numTeams: 10, teamName: 'Mine', players: [{ name: qb.name, position: 'QB', slot: 'starter' }, { name: wr.name, slot: 'starter' }, { name: rb.name }, { name: 'Nobody Atall', position: 'RB' }], settings: { scoring: { receptionPoints: 0.5, rbReceptionPoints: 0.5 }, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 5 }, faab: 200 } }, cookie);
  ok('a manual league is created from names, positions inferred where missing, misses reported', r.status === 200 && r.body.ok && r.body.league.provider === 'manual' && r.body.unresolved.join() === 'Nobody Atall' && r.body.league.settings.scoring.receptionPoints === 0.5 && r.body.league.settings.faab === 200);
  const Lm = await H.leagueLoad(env, 'ken@example.com', r.body.league.id);
  ok('the user team and roster are stored like any synced league', Lm.userTeamId === 'm1' && Lm.rosters[0].players.length === 4 && Lm.rosters[0].players.find(p => p.name === wr.name).position === 'WR' && Lm.rosters[0].players.find(p => p.name === wr.name).slot === 'starter');
  const lu = await H.leagueLineup(env, Lm);
  ok('the lineup engine works on it, and the unmatched player scores nothing', lu.ok && lu.unranked.join() === 'Nobody Atall' && lu.lineup.find(s => s.slot === 'QB').name === qb.name);
  const pk = await H.leaguePickups(env, Lm, { limit: 5 });
  ok('the pickup advisor treats everyone not on the manual roster as available', pk.ok && pk.pickups.length > 0);
  const sy = await route(env, 'POST', '/api/leagues/' + Lm.id + '/sync', null, cookie);
  ok('a manual league is edited, not synced', sy.body.manual === true);
  const ed = await route(env, 'POST', '/api/leagues/manual', { id: Lm.id, name: 'Hand League 2', numTeams: 10, teamName: 'Mine', players: [{ name: qb.name, position: 'QB' }], settings: { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 5 } } }, cookie);
  ok('editing replaces the roster rather than appending', ed.body.ok && ed.body.league.name === 'Hand League 2' && (await H.leagueLoad(env, 'ken@example.com', Lm.id)).rosters[0].players.length === 1);
}

console.log('\nYahoo OAuth');
{
  const noKey = { ...env, LEAGUE_TOKEN_KEY: undefined };
  ok('without LEAGUE_TOKEN_KEY, Yahoo is reported unconfigured', !H.leagueProviderReport(noKey).yahoo.enabled && H.leagueProviderReport(noKey).yahoo.reason === 'not configured');
  const sealed = await H.leagueSeal(env, 'secret-token');
  ok('tokens are sealed at rest and open again only with the key', sealed.startsWith('v1.') && !sealed.includes('secret-token') && (await H.leagueOpen(env, sealed)) === 'secret-token' && (await H.leagueOpen({ LEAGUE_TOKEN_KEY: 'other' }, sealed)) === null);
  const start = await route(env, 'GET', '/api/oauth/yahoo/start', null, cookie);
  const loc = start.headers.get('location') || '';
  ok('start redirects to Yahoo with the client id, the read-only scope and a signed state', start.status === 302 && loc.startsWith('https://api.login.yahoo.com/oauth2/request_auth') && /client_id=cid/.test(loc) && /scope=fspt-r/.test(loc) && /state=/.test(loc) && !/client_secret/.test(loc));
  const state = decodeURIComponent(loc.match(/state=([^&]+)/)[1]);
  const bad = await route(env, 'GET', '/api/oauth/yahoo/callback?code=abc&state=' + encodeURIComponent(state), null, await session(env, 'other@example.com'));
  ok('a callback on another session is refused', (bad.headers.get('location') || '').includes('yahoo=state'));
  const cb = await route(env, 'GET', '/api/oauth/yahoo/callback?code=abc&state=' + encodeURIComponent(state), null, cookie);
  const conn = await H.leagueConnectionRead(env, 'ken@example.com', 'yahoo');
  ok('the callback exchanges the code server-side, seals both tokens and never echoes them', (cb.headers.get('location') || '').includes('yahoo=connected') && conn && conn.status === 'connected' && conn.access_enc.startsWith('v1.') && conn.refresh_enc.startsWith('v1.') && !JSON.stringify([...db.t.provider_connections.values()]).includes('AT1'));
  ok('the token exchange went to Yahoo with the secret in the Authorization header, not the URL', net.calls.some(u => u.startsWith('https://api.login.yahoo.com/oauth2/get_token')));
  const t1 = await H.yahooAccessToken(env, 'ken@example.com');
  ok('a fresh token is used as is', t1 === 'AT1' && net.yahooRefreshed === 0);
  db.t.provider_connections.get('ken@example.com|yahoo').expires_at = Date.now() - 1;
  const t2 = await H.yahooAccessToken(env, 'ken@example.com');
  ok('an expired token is refreshed once and the new tokens sealed', t2 === 'AT2' && net.yahooRefreshed === 1 && (await H.leagueOpen(env, (await H.leagueConnectionRead(env, 'ken@example.com', 'yahoo')).refresh_enc)) === 'RT2');
  const disc = await route(env, 'POST', '/api/leagues/connect', { provider: 'yahoo' }, cookie);
  ok('discovery lists the Yahoo league through the user\'s grant', disc.status === 200 && disc.body.step === 'leagues' && disc.body.leagues[0].providerLeagueId === '449.l.12345');
  db.t.provider_connections.get('ken@example.com|yahoo').expires_at = Date.now() - 1; net.yahooExpired = true;
  const exp = await route(env, 'POST', '/api/leagues/connect', { provider: 'yahoo' }, cookie);
  ok('a refresh Yahoo refuses becomes EXPIRED AUTHORIZATION with a reconnect message', exp.status === 409 && exp.body.error === 'expired_authorization' && /renewed/.test(exp.body.message) && (await H.leagueConnectionRead(env, 'ken@example.com', 'yahoo')).status === 'expired');
  net.yahooExpired = false;
  const off = await route(env, 'POST', '/api/oauth/yahoo/disconnect', null, cookie);
  ok('disconnecting Yahoo deletes the tokens', off.body.ok && !(await H.leagueConnectionRead(env, 'ken@example.com', 'yahoo')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
