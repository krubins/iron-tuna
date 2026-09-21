#!/usr/bin/env node
// The saved league. Lifts the THE SAVED LEAGUE region out of _worker.js with
// the real scoring engine and the real PROJECTIONS pool, stubs the boards with
// a deterministic board built off PROJECTIONS, and drives the whole thing
// through a small in-memory D1.
//
// THERE IS NO NETWORK HERE, and that is the point rather than a convenience.
// The Sleeper, Yahoo and CBS connectors were removed on 2026-09-18 (HANDOFF
// §87) and a league now only ever arrives from the reader: the forms and the
// roster-grid screenshot on /my-league, through POST /api/leagues/manual. The
// fetch stub below throws, so anything that starts calling a fantasy platform
// again fails here first.
//
// What is covered: settings normalization and the reader's overrides on top of
// them, scoring import (PPR, half, standard, TE premium), roster shapes
// (superflex, 10/12/14 teams), player-id matching and the miss log, leagues
// created and edited by hand, a whole room read off a roster grid, multiple
// leagues and the default, disconnect, availability, the pickup advisor, the
// lineup optimizer, the matchup, intel, trades, playoffs, and the routes'
// auth gate.
//   node tools/test-league-sync.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8').replace(/\r\n/g, '\n');
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
  cut('// -- kickers and defenses, scored', '// -- the three boards'),
  cut('function etOffsetHours(ms) {', 'function etClock(ms) {'), cut('function etParts(ms) {', 'const _etDow = '),
  cut('const NEWSROOM_FLAGS = {', 'function flagReport(env) {'),
  cutLine('const json = (obj, status, c) =>'), cutLine('function adminOk(env, key)'),
  cut('async function rl(env, request, bucket, max, ttlSec) {', '// ── the post-draft section')
];
// _tierPoints and _oddsRound live outside the cuts above.
deps.push(cut('function _tierPoints(', '\n}\n') + '\n}\n');
// The board route hands its week board through boardStillToPlay on the way
// out; the rule and its helpers live beside boardsPayload, which is stubbed.
deps.push(cut('const _gameStarted = ', '// -- the insight detection engine'));
const region = cut('// ══ THE SAVED LEAGUE', '// ══ /THE SAVED LEAGUE');
const _oddsRoundSrc = src.match(/const _oddsRound = [^\n]+\n/) ? src.match(/const _oddsRound = [^\n]+\n/)[0] : (src.match(/function _oddsRound\([^)]*\) \{[^}]*\}/) || [''])[0];
if (!_oddsRoundSrc) { console.error('FAIL: _oddsRound not found'); process.exit(1); }

// ── the network, stubbed ───────────────────────────────────────────────────
// ── the network, which there isn't ─────────────────────────────────────────
// Nothing in the region may call out. A league is the reader's own entry, so
// an outbound fetch is a regression, not a case to stub.
async function fakeFetch(url) { throw new Error('the saved league made a network call: ' + url); }

// ── an in-memory D1 ────────────────────────────────────────────────────────
// Enough SQL for the region: INSERT ... ON CONFLICT (upsert by the table's
// primary key), UPDATE ... WHERE, DELETE ... WHERE, SELECT with simple
// conjunctions, COUNT(*), ORDER BY (ignored) and LIMIT (ignored).
const PK = { leagues: ['id'], league_teams: ['league_id', 'team_id'], league_roster_players: ['league_id', 'provider_player_id'], league_matchups: ['league_id', 'week', 'team_id'],
  league_transactions: ['league_id', 'provider_txn_id'], league_snapshots: ['league_id', 'season', 'week', 'kind'], provider_connections: ['email', 'provider'],
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
  '\nreturn { leagueReady, leagueNormalizeSettings, leagueEffectiveSettings, leagueScore, leagueScoringKey, leagueSettingsLabel, leagueResolvePlayer, leagueNameSuggestions, leagueRosterCheck, leagueMapPlayers, leagueOptimize, leagueStarterSlots, leagueRosterSize, leagueEmptyRoster, LEAGUE_PROVIDERS, leagueCreateRow, leagueLoad, leagueList, leagueManualUpsert, leagueSetDefault, leagueDisconnect, leagueBoard, leagueLineup, leaguePickups, leagueMatchup, leagueIntel, leagueTrades, leaguePlayoffs, leagueAvailabilityLookup, leagueSummary, leagueRoutes, makeToken, SCORING_BASE, scoringRules, scoreAny, PROJECTIONS, _oddsNorm, teamKey, flagOn, LEAGUE_STALE_MS, leagueRowToLeague };';
const H = new Function(...Object.keys(stubs), '__stubBoards', code)(...Object.values(stubs), stubBoards);

// ── a world: rooms of real players, in the shape a reader saves one ───────
const byPos = {}; for (const p of H.PROJECTIONS) (byPos[p.position] = byPos[p.position] || []).push(p);
const pick = (pos, i) => byPos[pos][i];
// A room: nTeams rosters of real players, in the shape POST /api/leagues/manual
// takes. Team 1 is the reader's. Starters are named where the caller wants a
// lineup to compare against; a grid-read room names none, and leagueLineup
// withholds the comparison rather than claiming the reader starts nobody.
function buildRoom(nTeams, opts) {
  const o = opts || {};
  const counters = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const take = pos => { const p = pick(pos, counters[pos]++); return p ? p : null; };
  const teams = [];
  for (let r = 1; r <= nTeams; r++) {
    const starters = [take('QB'), take('RB'), take('RB'), take('WR'), take('WR'), take('TE'), take('QB')].filter(Boolean);
    const bench = [take('RB'), take('WR'), take('TE')].filter(Boolean);
    const players = starters.map(p => ({ name: p.name, position: p.position, slot: o.noSlots ? 'bench' : 'starter' }))
      .concat(bench.map(p => ({ name: p.name, position: p.position, slot: 'bench' })));
    teams.push({ teamId: 'm' + r, name: r === 1 ? 'Iron Tunas' : 'Team ' + r, isUser: r === 1, players });
  }
  return teams;
}
// The settings a room is saved with: superflex, full PPR, half a point of TE
// premium, so the board has something to move and the lineup has a flex to
// fill. leagueNormalizeSettings is what actually reads this.
const ROOM_SETTINGS = {
  scoring: { receptionPoints: 1, rbReceptionPoints: 1, passingTD: 4 },
  extras: { tePremium: 0.5 },
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 1, K: 0, DEF: 0, BN: 3, IR: 0, TAXI: 0 },
  faab: 100
};
const req = (method, url, body, cookie) => new Request('https://irontuna.com' + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
async function session(env, email) { const tok = await H.makeToken(env.AUTH_SECRET, { sid: 's-' + email, e: email, t: 'sess', exp: Date.now() + 3600000 }); env.LEADS_DB.t.sessions = env.LEADS_DB.t.sessions || new Map(); env.LEADS_DB.t.sessions.set('s-' + email, { id: 's-' + email, email }); return 'it_sess=' + tok; }
async function route(env, method, url, body, cookie) { const r = await H.leagueRoutes(new Request('https://irontuna.com' + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, new URL('https://irontuna.com' + url), {}); return r ? { status: r.status, body: await r.json().catch(() => null), headers: r.headers } : null; }

console.log('\nsettings normalization');
{
  // leagueNormalizeSettings is the only normalizer left: what the reader types
  // or pastes is what a league is. The shapes the connectors used to import —
  // full/half/standard PPR, position-specific reception values, TE premium,
  // superflex, unusual flex slots, rules the engine does not model — all still
  // have to survive it, because the forms can express every one of them.
  const N = o => H.leagueNormalizeSettings(o);

  const ppr = N({ scoring: { receptionPoints: 1 } });
  ok('full PPR applies to WR and RB alike', ppr.scoring.receptionPoints === 1 && ppr.scoring.rbReceptionPoints === 1);
  // The RB reception value is its OWN field, not a derivation. A form that sets
  // half PPR has to set both, or a back keeps full-point catches silently.
  const half = N({ scoring: { receptionPoints: 0.5, rbReceptionPoints: 0.5 } });
  ok('half PPR', half.scoring.receptionPoints === 0.5 && half.scoring.rbReceptionPoints === 0.5);
  ok('and setting only the WR value leaves the RB value alone rather than guessing',
     N({ scoring: { receptionPoints: 0.5 } }).scoring.rbReceptionPoints === ppr.scoring.rbReceptionPoints);
  const std = N({ scoring: { receptionPoints: 0, passingTD: 6 } });
  ok('standard scoring with 6-point passing TDs', std.scoring.receptionPoints === 0 && std.scoring.passingTD === 6);
  const rb = N({ scoring: { receptionPoints: 1, rbReceptionPoints: 0.5 } });
  ok('position-specific PPR (RB half, WR full)', rb.scoring.rbReceptionPoints === 0.5 && rb.scoring.receptionPoints === 1);
  const tePrem = N({ scoring: { receptionPoints: 1 }, extras: { tePremium: 0.5 } });
  ok('TE premium is an extra per catch, not a different WR reception value', tePrem.extras.tePremium === 0.5 && tePrem.scoring.receptionPoints === 1);

  const r = N({ roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 } }).roster;
  ok('roster slots: QB1 RB2 WR2 TE1 FLEX1 SFLEX1 K1 DEF1 BN6 IR1',
     r.QB === 1 && r.RB === 2 && r.WR === 2 && r.TE === 1 && r.FLEX === 1 && r.SFLEX === 1 && r.K === 1 && r.DEF === 1 && r.BN === 6 && r.IR === 1);
  const r2 = N({ roster: { QB: 1, RB: 1, WR: 1, REC_FLEX: 1, WRRB_FLEX: 1, BN: 1, other: { DL: 1, LB: 1 } } }).roster;
  ok('the two extra flex slots are real slots', r2.REC_FLEX === 1 && r2.WRRB_FLEX === 1);
  ok('and slots no lineup understands are kept under other rather than dropped', r2.other.DL === 1 && r2.other.LB === 1);
  ok('a slot name nobody recognizes at the top level is not silently invented as a slot',
     N({ roster: { QB: 1, DL: 3 } }).roster.DL === undefined);
  ok('the starter slots come out in lineup order, superflex last',
     H.leagueStarterSlots(r).join() === 'QB,RB,RB,WR,WR,TE,K,DEF,FLEX,SFLEX');

  const n = N({ scoring: { receptionPoints: 'abc', bogusKey: 3 }, roster: { QB: 99 } });
  ok('a bad value falls back and a bogus key is preserved as unsupported, never guessed at',
     n.scoring.receptionPoints === 1 && n.extras.unsupported.bogusKey === 3);

  const eff = H.leagueEffectiveSettings(N({ scoring: { receptionPoints: 1 }, extras: { tePremium: 0 } }),
                                        { scoring: { receptionPoints: 0.5 }, extras: { tePremium: 1 }, roster: { SFLEX: 1 } });
  ok('the reader\'s corrections lay over the settings and are named as corrections',
     eff.scoring.receptionPoints === 0.5 && eff.extras.tePremium === 1 && eff.roster.SFLEX === 1 && eff.overridden.length > 0);

  const te = N({ extras: { tePremium: 0.5 } });
  ok('TE premium adds per catch for tight ends only',
     H.leagueScore({ rec: 10, recYd: 100 }, 'TE', te, 1) - H.scoreAny({ rec: 10, recYd: 100 }, 'TE', H.scoringRules('ppr'), 1) === 5 &&
     H.leagueScore({ rec: 10, recYd: 100 }, 'WR', te, 1) === H.scoreAny({ rec: 10, recYd: 100 }, 'WR', H.scoringRules('ppr'), 1));
  ok('the scoring key changes when the rules change', H.leagueScoringKey(te) !== H.leagueScoringKey(N({})));
  ok('the label reads the settings', /PPR · TE premium · 12 teams · Superflex/.test(
     H.leagueSettingsLabel(N({ extras: { tePremium: 0.5 }, roster: { SFLEX: 1 } }), 12)));
}

console.log('\nplayer-id matching');
{
  const wr = pick('WR', 0);
  ok('exact name and position resolve to the canonical key', H.leagueResolvePlayer({ name: wr.name, position: 'WR', team: wr.team }).key === H._oddsNorm(wr.name) + '|WR');
  ok('a suffix does not break the match', H.leagueResolvePlayer({ name: wr.name + ' Jr.', position: 'WR' }).key === H._oddsNorm(wr.name) + '|WR');
  ok('the wrong position is a miss, not a guess', H.leagueResolvePlayer({ name: wr.name, position: 'TE' }).key === null);
  ok('a defense resolves by club', H.leagueResolvePlayer({ name: 'HOU DEF', position: 'DEF', team: 'HOU' }).key === H._oddsNorm('Houston Texans') + '|DEF');
  ok('an unknown name is a miss with a reason', H.leagueResolvePlayer({ name: 'Nobody Atall', position: 'RB', team: 'BUF' }).key === null && /not on the board/.test(H.leagueResolvePlayer({ name: 'Nobody Atall', position: 'RB' }).reason));
  ok('an unranked position is refused', /not ranked/.test(H.leagueResolvePlayer({ name: 'Some Linebacker', position: 'LB' }).reason));

  // ── the clarifier ────────────────────────────────────────────────────────
  // THE FAILURE THIS EXISTS FOR. A reader pasted a twelve-team grid, pressed
  // Save, and was handed "Not on the board (kept by name, scored 0): A
  // Bornegales, S Vaki, M Lloyd, J Williams, D Hampton, E Johnson, B Robinson,
  // D Tuten." Every one of those is answerable — two are one misread letter
  // from a real player, three are a surname the initial cannot split, two are
  // genuinely off the board — and the answer was asked of nobody. The list was
  // a report of eight holes, delivered at the one moment the reader could no
  // longer fill them.
  //
  // So: the same names, and what the board now offers for each. These are
  // pinned by NAME rather than by count, because the whole value of a
  // suggestion list is that the right player is in it.
  console.log('\nthe names it could not place, and what it offers instead');
  {
    const ask = (name, pos) => H.leagueRosterCheck([{ name, pos }])[0];
    const names = r => (r.suggestions || []).map(x => x.name);

    // One misread letter. The list is the right player and nobody else.
    const bor = ask('A Bornegales');
    ok('a surname off by one letter finds its player', !bor.ok && names(bor)[0] === 'Andy Borregales', names(bor).join(', '));
    ok('and offers nothing else, because nothing else is close', names(bor).length === 1, names(bor).join(', '));
    const tut = ask('D Tuten');
    ok('a wrong initial does not hide the only surname that matches',
      !tut.ok && names(tut)[0] === 'Bhayshul Tuten' && names(tut).length === 1, names(tut).join(', '));

    // One surname, several players. This is the case a resolver must never
    // guess at, and the case a reader answers in one click.
    const jw = ask('J Williams');
    ok('an ambiguous surname comes back as the choice it is',
      !jw.ok && names(jw).indexOf('Jameson Williams') >= 0 && names(jw).indexOf('Javonte Williams') >= 0, names(jw).join(', '));
    ok('with the matching initial at the top', names(jw).slice(0, 2).every(n => /^Ja/.test(n)), names(jw).join(', '));
    const br = ask('B Robinson', 'RB');
    ok('a position narrows it to the two it could be',
      !br.ok && names(br).length === 2 && names(br).indexOf('Bijan Robinson') >= 0 && names(br).indexOf('Brian Robinson Jr.') >= 0, names(br).join(', '));

    // Honest about what is not there. Padding the list with six unrelated
    // D-names is worse than an empty one: it invites a wrong pick.
    ok('a player the board does not carry offers nothing', names(ask('S Vaki', 'RB')).length === 0, names(ask('S Vaki', 'RB')).join(', '));
    ok('and is still asked about rather than passed over', ask('S Vaki', 'RB').ok === false);
    ok('a name that is nothing like a player offers nothing', names(ask('Qqqq Zzzzzzz')).length === 0);

    // A defense the grid printed as a city that is two teams.
    const ny = ask('New York');
    ok('an ambiguous defense offers both of them',
      !ny.ok && names(ny).length === 2 && names(ny).every(n => /^New York/.test(n)), names(ny).join(', '));

    // What the check says is fine, the save resolves. This is the contract:
    // one resolver, asked twice, or the panel lies about the roster.
    const board = H.PROJECTIONS.filter(p => p.position === 'WR')[0];
    const good = ask(board.name, 'WR');
    ok('a name the board carries is not asked about', good.ok === true && good.resolved === board.name);
    ok('and the check agrees with the resolver the save uses',
      H.leagueResolvePlayer({ name: board.name, position: 'WR' }).key !== null);
    ok('a bare surname with one home is placed without asking', ask('K Walker III').ok === true);
    ok('every ask carries the name it was asked about', ask('J Williams').name === 'J Williams');
    ok('a blank name is skipped rather than asked about', H.leagueRosterCheck([{ name: '   ' }, { name: 'J Williams' }]).length === 1);

    // Cheap enough to run after every read AND after every answer.
    const t0 = Date.now();
    H.leagueRosterCheck(Array.from({ length: 240 }, (_, i) => ({ name: 'Zz Nobodyxx' + i })));
    const ms = Date.now() - t0;
    ok('a whole league of unplaceable names checks in well under a second', ms < 900, ms + 'ms');
  }

  console.log('\nthe map rows');
  const db = fakeDb(); const env = { LEADS_DB: db };
  await H.leagueReady(env);
  const m = await H.leagueMapPlayers(env, 'manual', [{ providerPlayerId: '1', name: wr.name, position: 'WR', team: wr.team }, { providerPlayerId: '2', name: 'Nobody Atall', position: 'RB', team: 'BUF' }, { providerPlayerId: '1', name: wr.name, position: 'WR' }]);
  ok('one map row per provider id, one miss logged, duplicates ignored', m.map.size === 2 && m.unmatched === 1 && db.t.player_id_map.size === 1 && db.t.player_map_misses.size === 1);
  await H.leagueMapPlayers(env, 'manual', [{ providerPlayerId: '2', name: 'Nobody Atall', position: 'RB', team: 'BUF' }]);
  ok('a repeated miss increments its count rather than duplicating', db.t.player_map_misses.size === 1 && [...db.t.player_map_misses.values()][0].count === 2);
}

// A 12-team superflex room, saved the way a reader saves one. Everything below
// reads that and the site's own boards; nothing calls out.
const db = fakeDb();
const env = { LEADS_DB: db, AUTH_SECRET: 'test-secret' };
const cookie = await session(env, 'ken@example.com');
await H.leagueReady(env);
const made = await route(env, 'POST', '/api/leagues/manual',
  { name: 'Iron Tunas League', numTeams: 12, teams: buildRoom(12), settings: ROOM_SETTINGS }, cookie);
const leagueId = made.body.league.id;

console.log('\npersonalization on the saved league');
{
  ok('a twelve-team room saves in one call', made.status === 200 && made.body.ok, JSON.stringify(made.body).slice(0, 160));
  const L = await H.leagueLoad(env, 'ken@example.com', leagueId);
  const wk = await H.leagueBoard(env, L, 'week');
  ok('the league board is scored at the league rules and every row says who owns him', wk.ok && wk.scoring.preset === 'league' && wk.players.every(p => p.roster && p.roster.status) && wk.players.some(p => p.roster.status === 'mine') && wk.players.some(p => p.roster.status === 'rostered') && wk.players.some(p => p.roster.status === 'available'));
  // No transaction log, so nobody is on waivers: a player is on a roster in
  // this room or he is free, and the board must not invent a third state.
  ok('with no transaction log every player is rostered or available, never waivers',
     wk.players.every(p => p.roster.status !== 'waiver'));
  // TE premium moves tight ends
  const plain = await H.leagueBoard(env, { ...L, settings: { ...L.settings, extras: { ...L.settings.extras, tePremium: 0 } } }, 'ros');
  const prem = await H.leagueBoard(env, L, 'ros');
  const te0 = plain.players.find(p => p.pos === 'TE'), te1 = prem.players.find(p => p.key === te0.key);
  ok('TE premium raises tight ends by half a point per catch on the league board', te1.ironTuna.points > te0.ironTuna.points && Math.abs((te1.ironTuna.points - te0.ironTuna.points) - 0.5 * te0.ironTuna.stats.rec) < 0.2);
  ok('and the flex rank of that tight end improves or holds', te1.ironTuna.flexRank <= te0.ironTuna.flexRank);
  // Lineup
  worldState.byeTeam = null;
  const lu = await H.leagueLineup(env, L);
  ok('the best lineup fills every slot including superflex, from the actual roster', lu.ok && lu.lineup.length === 8 && lu.lineup.filter(s => s.slot === 'SFLEX').length === 1 && lu.lineup.every(s => !s.empty) && lu.projectedTotal > 0);
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
  ok('each pickup says why, who to drop, the priority, the FAAB range and the horizon values', pk.pickups.every(p => p.why && p.priority && p.projected.ros >= 0 && (p.drop === null || p.drop.name || p.drop.open) && p.faab && p.faab.low <= p.faab.high && p.faab.budget === 100));
  ok('a drop is never worth more than the add', pk.pickups.filter(p => p.drop && p.drop.name).every(p => p.projected.ros > p.drop.ros || p.gain.ros > 0 || p.gain.next3 > 0));
  const noFaab = { ...L, settings: { ...L.settings, faab: null, waiverType: 'priority' } };
  const pk2 = await H.leaguePickups(env, noFaab, { limit: 5 });
  ok('a waiver-priority league gets no bid range', pk2.ok && pk2.pickups.every(p => p.faab === null));
  // 10 vs 14 teams: the pool shrinks
  const mk = async (n, name) => {
    const r = await route(env, 'POST', '/api/leagues/manual',
      { name, numTeams: n, teams: buildRoom(n), settings: ROOM_SETTINGS }, cookie);
    return r.body.league.id;
  };
  const id10 = await mk(10, 'Ten'), id14 = await mk(14, 'Fourteen');
  const L10 = await H.leagueLoad(env, 'ken@example.com', id10); const pk10 = await H.leaguePickups(env, L10, { limit: 40 });
  const L14 = await H.leagueLoad(env, 'ken@example.com', id14); const pk14 = await H.leaguePickups(env, L14, { limit: 40 });
  ok('a fourteen-team room leaves fewer players available than a ten-team room', pk14.availableCount < pk10.availableCount,
     pk14.availableCount + ' vs ' + pk10.availableCount);
  const av10 = H.leagueAvailabilityLookup(L10, [{ name: pk10.pickups[0].name }]);
  const av14 = H.leagueAvailabilityLookup(L14, [{ name: pk10.pickups[0].name }]);
  ok('the same player can be free in one room and owned in another, which is what the availability service is for',
     av10[0].status === 'available' && ['rostered', 'mine'].includes(av14[0].status),
     av10[0].status + ' / ' + av14[0].status);
  // Multiple leagues, default switching, disconnect
  const list = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('three leagues on the account, one default', list.body.leagues.length === 3 && list.body.leagues.filter(l => l.isDefault).length === 1 && list.body.defaultId === leagueId);
  const sd = await route(env, 'POST', '/api/leagues/' + id14 + '/default', null, cookie);
  const list2 = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('the default switches, and only one league is default', sd.body.ok && list2.body.defaultId === id14 && list2.body.leagues.filter(l => l.isDefault).length === 1);
  const other = await session(env, 'other@example.com');
  const cross = await route(env, 'GET', '/api/leagues/' + leagueId, null, other);
  ok('another reader cannot read this reader\'s league', cross.status === 404);
  const dis = await route(env, 'POST', '/api/leagues/' + id14 + '/disconnect', null, cookie);
  ok('disconnecting removes the league and all its rows and says what was removed', dis.body.ok && dis.body.removed.length >= 5 && ![...db.t.leagues.values()].some(l => l.id === id14) && ![...db.t.league_roster_players.values()].some(p => p.league_id === id14) && ![...db.t.league_teams.values()].some(p => p.league_id === id14));
  const list3 = await route(env, 'GET', '/api/leagues', null, cookie);
  ok('a new default is chosen when the default is disconnected', list3.body.leagues.length === 2 && list3.body.leagues.filter(l => l.isDefault).length === 1);
  // Matchup, trades, playoffs, availability, summary
  const Lm = await H.leagueLoad(env, 'ken@example.com', leagueId);
  const mu = await H.leagueMatchup(env, Lm);
  // A saved room has rosters but no schedule, so there is no opponent to name.
  // The module still projects the reader's own week and says plainly that it
  // has no opponent, rather than picking a team to play or reporting a 0-0 tie.
  ok('the matchup projects your own week and says plainly there is no opponent',
     mu.ok && mu.you.projected > 0 && mu.opponent === null && /no opponent/i.test(mu.verdict) && Array.isArray(mu.swing));
  const tr = await H.leagueTrades(env, Lm, { minGain: 0.1 });
  ok('trades: every partner is a real manager, and any proposal improves both lineups', tr.ok && tr.teams.length === 12 && tr.trades.every(t => Lm.teams.some(x => x.name === t.partner) && t.yourGain > 0 && t.theirGain > 0 && t.why.length >= 2) && tr.targets.every(t => Lm.teams.some(x => x.name === t.owner)));
  ok('trade data for the browser engine carries every roster with points per horizon', tr.teams.every(t => t.players.every(p => 'ros' in p && 'next3' in p)) && tr.teams.filter(t => t.isUser).length === 1);
  const po = await H.leaguePlayoffs(env, Lm);
  ok('playoff readiness grades every started position against the room and lists bench moves', po.ok && po.positions.length >= 4 && po.positions.every(p => ['strong', 'average', 'weak'].includes(p.grade)) && po.rankInLeague >= 1 && po.rankInLeague <= 12 && Array.isArray(po.benchMoves) && po.weeks.join() === '15,16,17');
  const av = H.leagueAvailabilityLookup(Lm, [{ name: Lm.rosters[0].players[0].name }, { name: Lm.rosters[1].players[0].name }, { name: 'Nobody Atall' }]);
  // Mine, somebody else's by name, and a player the board has never heard of.
  // Nobody is flagged as the opponent's, because this room has no matchup.
  ok('availability: mine, rostered by a named team, unknown',
     av[0].status === 'mine' && av[1].status === 'rostered' && av[1].teamName === 'Team 2' &&
     av[1].isOpponent === false && av[2].status === 'unknown');
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
  ok('there is no sync route left to call', sy.status === 404);
  const ed = await route(env, 'POST', '/api/leagues/manual', { id: Lm.id, name: 'Hand League 2', numTeams: 10, teamName: 'Mine', players: [{ name: qb.name, position: 'QB' }], settings: { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 5 } } }, cookie);
  ok('editing replaces the roster rather than appending', ed.body.ok && ed.body.league.name === 'Hand League 2' && (await H.leagueLoad(env, 'ken@example.com', Lm.id)).rosters[0].players.length === 1);
}

console.log('\nleagues read off a roster grid');
{
  // One screenshot of a league's roster grid is every team at once, and it
  // carries no starter/bench split. The reader hands back names only, so the
  // whole room arrives on the bench and the lineup has to be projected rather
  // than compared against a lineup nobody recorded.
  const teams = [];
  for (let t = 0; t < 12; t++) {
    teams.push({
      teamId: 'm' + (t + 1), name: 'Grid Team ' + (t + 1), isUser: t === 4,
      players: [pick('QB', t), pick('RB', t * 2), pick('RB', t * 2 + 1), pick('WR', t * 2), pick('WR', t * 2 + 1), pick('TE', t)]
        .filter(Boolean).map(p => ({ name: p.name }))
    });
  }
  const r = await route(env, 'POST', '/api/leagues/manual', { name: 'Grid League', numTeams: 12, teams, settings: { scoring: { receptionPoints: 1 }, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 5 } } }, cookie);
  ok('a grid read imports every team in one save', r.status === 200 && r.body.ok && r.body.league.numTeams === 12);
  const Lg = await H.leagueLoad(env, 'ken@example.com', r.body.league.id);
  ok('all twelve rosters are stored, and the team the reader picked is theirs', Lg.teams.length === 12 && Lg.rosters.length === 12 && Lg.userTeamId === 'm5' && Lg.teams.find(t => t.teamId === 'm5').name === 'Grid Team 5');
  ok('a bare name still resolves to a position off the board', Lg.rosters[0].players.every(p => p.name) && Lg.rosters[0].players.some(p => p.position === 'QB'));
  ok('every player lands on the bench, because a grid names no starters', Lg.rosters.every(r2 => r2.players.every(p => p.slot === 'bench')));
  const lu = await H.leagueLineup(env, Lg);
  ok('the best lineup is still projected from the whole roster', lu.ok && lu.lineup.length === 7 && lu.lineup.filter(s => !s.empty).length > 0 && lu.projectedTotal > 0);
  ok('with no slots known the comparison is withheld instead of claiming zero', lu.slotsKnown === false && lu.currentTotal === null && lu.improvement === null && lu.changes.length === 0);
  const pk = await H.leaguePickups(env, Lg, { limit: 5 });
  ok('a grid league still gets a pickup list, measured against the whole room', pk.ok && pk.pickups.length > 0);
  const av = H.leagueAvailabilityLookup(Lg, [{ name: pick('QB', 0).name }, { name: pick('QB', 4).name }]);
  ok('a player on another grid team reads as owned by that team, not free', av[0].status === 'rostered' && av[0].teamName === 'Grid Team 1' && av[1].status === 'mine');
  // Editing the league re-sends the room with the reader's own team typed out,
  // which is the only place a starter or an IR slot can be said at all.
  const withSlots = teams.map((t, i) => i !== 4 ? t : { ...t, players: t.players.map((p, n) => ({ ...p, slot: n < 3 ? 'starter' : 'bench' })) });
  const ed = await route(env, 'POST', '/api/leagues/manual', { id: Lg.id, name: 'Grid League', numTeams: 12, teams: withSlots, settings: { scoring: { receptionPoints: 1 }, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 5 } } }, cookie);
  const Lg2 = await H.leagueLoad(env, 'ken@example.com', Lg.id);
  ok('editing a grid league keeps every other roster instead of dropping the room', ed.body.ok && Lg2.teams.length === 12 && Lg2.rosters.every(r2 => r2.players.length > 0));
  const lu2 = await H.leagueLineup(env, Lg2);
  ok('once slots are typed for the reader’s own team the comparison comes back', lu2.slotsKnown === true && lu2.currentTotal !== null && lu2.improvement !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
