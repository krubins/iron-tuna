#!/usr/bin/env node
// The in-season newsroom: the migration (retired kinds cannot run, no
// duplicate slots), the staff and the single rivalry, the Fantasy/Market
// blend at both ends and the middle, freshness grading, the DFS metrics, the
// research packets and their worth gates, analyst memory, the fact check
// (names, numbers, colleagues, rivalry, phrasing), the breaking-news scorer,
// and the draft-season social guard.
//   node tools/test-newsroom.mjs
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
const _median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const stub = () => { throw new Error('not needed'); };
// Two stubs the rivalry-column tests below set: the weekly stats file the
// grader reads, and the board the weekly build runs on.
let USAGE = null, BOARD = null;
const POOL = [
  { name: 'CeeDee Lamb', position: 'WR', team: 'DAL', projectedStats: {} }, { name: 'Javonte Williams', position: 'RB', team: 'DAL', projectedStats: {} },
  { name: 'Saquon Barkley', position: 'RB', team: 'PHI', projectedStats: {} }, { name: 'Jalen Hurts', position: 'QB', team: 'PHI', projectedStats: {} },
  { name: 'Dak Prescott', position: 'QB', team: 'DAL', projectedStats: {} }, { name: 'A.J. Brown', position: 'WR', team: 'PHI', projectedStats: {} },
  { name: 'Dallas Goedert', position: 'TE', team: 'PHI', projectedStats: {} }, { name: 'George Pickens', position: 'WR', team: 'DAL', projectedStats: {} }
];
// The whole desk block, with the same stubs the content test uses, plus the
// scoring engine and the season clock it reads.
const H = new Function('etOffsetHours', 'teamKey', '_oddsNorm', '_oddsRound', 'PROJECTIONS', 'LEAD_TZ', 'AVAILABILITY_GAMES', '_availF', 'PROVIDER_UNAVAILABLE', 'fetch', '_csvSplit', 'NFLVERSE_GAMES_URL', 'oddsCacheInit', 'ODDS_CV', 'ODDS_BANDS', 'usageCacheRead', 'availabilityTable', 'availabilityCacheRead', 'oddsCacheRead', 'availabilityReport', 'dfsSalariesRead', 'buildDfsSlate', 'buildDfsStacks', 'DFS_SITES', 'SCORING_SITE', 'gameSummaryFor',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' + cut('function _oddsImpliedProb(', '// The Odds API v4. WRITTEN') + '\n' +
  cut('const MARKET_RIDGE', 'async function fetchTeamEnvNflverse') + '\n' + cut('function _oddsProjectionIndex()', 'function buildVegasOverlay(') + '\n' +
  cut('// ── the NFL season and week ─', '// ── the provider layer ─') + '\n' + cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' +
  cut('// -- kickers and defenses, scored', '// -- the player intel payload') + '\n' + cut('// -- the content desk', '// -- DFS ---') + '\n' +
  'return { CONTENT_KINDS, LEGACY_CONTENT, NEWSROOM_SECTIONS, ANALYSTS, RIVALRY_PAIR, NEWSROOM_FLAGS, flagOn, flagReport, freshnessReport, blendComponents, blendPoints, blendBoard, blendDisagreements, rivalryColumns, RIVALRY_PICKS, RIVALRY_COLUMN_KIND, runRivalryColumn, setBoards: f => { boardsPayload = f; }, rivalryColumnRead, rivalryLedger, weekFinishRanks, gradeRivalryCall, runCallsGrade, dfsMetrics, DFS_CONTESTS, rivalryCandidate, rivalryGate, gradeCall, normalizeCalls, factCheck, scoreNewsEvent, detectNewsEvents, newsroomAudit, contentSubjectWeek, sectionsFor, packetPickups, packetPosition, packetUnderrated, packetKDst, updateWanted, compactForWriter, heldRetryable, NEWSROOM_SYSTEM, WRITER_PACKET_BUDGET, WRITER_TIMEOUT_MS, WRITER_MAX_TOKENS, _anthropicStreamText, _finishBrief, validateDraft, AI_PHRASES, draftSocialAllowed, newsroomStatus, scoringRules, etParts, ROUTINE_MIGRATION, AI_DISCLOSURE, _vindication, _freezeRows, _voiceBlock, CALLED_MIN_PTS, CALLED_MIN_RANKS, CALLED_HEADLINE_PTS, CALLED_HEADLINE_RANKS };'
)(etOffsetHours, teamKey, _oddsNorm, _oddsRound, POOL, 'America/New_York', 17, g => Math.max(0, 1 - g / 17), { goalLineCarries: 'pbp' }, stub, stub, 'x', async () => {}, {}, {}, async () => USAGE, stub, async () => null, async () => null, async () => null, async () => null, stub, stub, {}, {}, stub);

console.log('\nthe migration');
{
  const a = H.newsroomAudit(['*/15 * * * *']);
  ok('the calendar audits clean', a.ok, a.problems.join('; '));
  ok('every retired kind is gone from the calendar', ['team-recaps', 'mnf-breakdown', 'what-they-arent-telling-you', 'opportunity-report', 'rankings-update', 'final-read', 'tnf-aftermath', 'weekend-game-plan', 'what-changed-today', 'snf-what-we-learned'].every(k => !H.CONTENT_KINDS[k] && H.LEGACY_CONTENT[k]));
  ok('every retired kind names its destination on the calendar', Object.values(H.LEGACY_CONTENT).every(v => v.destination === 'none' || v.destination === 'data' || v.destination === 'desk-lead' || v.destination === 'the-tell' || H.CONTENT_KINDS[v.destination]));
  ok('every package absorbs what the table says it absorbs', Object.entries(H.LEGACY_CONTENT).filter(([k, v]) => v.disposition === 'merged' && H.CONTENT_KINDS[v.destination]).every(([k, v]) => (H.CONTENT_KINDS[v.destination].absorbs || []).includes(k)));
  ok('two crons that both run the tick are a problem', !H.newsroomAudit(['*/15 * * * *', '0 * * * *']).ok);
  ok('no cron is a problem', !H.newsroomAudit([]).ok);
  ok('seventeen scheduled packages and one unscheduled', Object.values(H.CONTENT_KINDS).filter(k => !k.unscheduled).length === 17 && H.CONTENT_KINDS.breaking.unscheduled === true);
  ok('the game recap is the one per-game package, and carries no clock slot', H.CONTENT_KINDS['game-recap'].perGame === true
    && H.CONTENT_KINDS['game-recap'].day === null && H.CONTENT_KINDS['game-recap'].hour === null
    && Object.values(H.CONTENT_KINDS).filter(k => k.perGame).length === 1);
  ok('a per-game kind with a clock slot as well is a problem', (() => {
    // The audit reads CONTENT_KINDS directly, so the check is made against a
    // temporarily slotted copy and put back.
    const K = H.CONTENT_KINDS['game-recap']; const day = K.day, hour = K.hour;
    K.day = 'Sun'; K.hour = 19;
    const bad = H.newsroomAudit(['*/15 * * * *']);
    K.day = day; K.hour = hour;
    return !bad.ok && bad.problems.some(p => /per-game kind also carries a clock slot/.test(p));
  })());
  ok('the recap targets only games the feed has marked final', (() => {
    const gs = [{ id: 'a', status: 'final' }, { id: 'b', status: 'in' }, { id: 'c', status: null }];
    const t = H.CONTENT_KINDS['game-recap'].targets(gs);
    return t.length === 1 && t[0].id === 'a';
  })());
  ok('the recap asks for the three layers, the findings and the wrap', (() => {
    const w = H.sectionsFor('game-recap', 'weekly');
    return ['whatScored', 'usageBehindIt', 'nextWeekSignals', 'components', 'wrap'].every(k => w.includes(k))
      && w.indexOf('whatScored') < w.indexOf('usageBehindIt') && w.indexOf('usageBehindIt') < w.indexOf('nextWeekSignals')
      && H.sectionsFor('game-recap', 'dfs').includes('wrap');
  })());
  ok('every package has a primary analyst on the staff and both lenses', Object.values(H.CONTENT_KINDS).every(k => H.ANALYSTS[k.analyst] && k.lens === 'both'));
  ok('the worth-gated pieces are the positional and QB features', ['quarterback-monday', 'tailback-tuesday', 'wideout-wednesday', 'tight-end-thursday'].every(k => H.CONTENT_KINDS[k].gate === 'worth'));
  ok('the Routines table names the two Pick Routines as retired and The Tell as retained', H.ROUTINE_MIGRATION.filter(r => /The Pick/.test(r.name)).every(r => r.disposition === 'retired') && H.ROUTINE_MIGRATION.find(r => /The Tell/.test(r.name)).disposition === 'retained');
  ok('the wrangler triggers are the single quarter-hour tick', /"crons": \["\*\/15 \* \* \* \*"\]/.test(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')));
  ok('the worker still recognizes the old social crons and gates them', /draftSocialAllowed\(env\)/.test(cut('  async scheduled(event, env, ctx) {', '\nfunction originAllowed(')));
}

console.log('\nthe staff and the one rivalry');
{
  const A = H.ANALYSTS;
  ok('eight analysts', Object.keys(A).length === 8 && ['mercer', 'vega', 'brooks', 'raines', 'dalton', 'grant', 'porter', 'park'].every(k => A[k]));
  ok('Vega and Brooks are each other\'s rivalry and nobody else has one', A.vega.rivalry === 'brooks' && A.brooks.rivalry === 'vega' && Object.values(A).filter(a => a.rivalry).length === 2);
  ok('every analyst has a voice, a philosophy and assignments', Object.values(A).every(a => a.voice.length > 40 && a.philosophy && a.assignments.length));
  ok('the disclosure says they are AI personas, not people', /AI-powered editorial personas, not people/.test(H.AI_DISCLOSURE));
  const flags = H.flagReport({});
  // The four provider connectors (docs/league-sync.md) default OFF on purpose:
  // Sleeper pending its commercial license; Yahoo and CBS pending configuration
  // and terms validation; ESPN because no supported path exists.
  ok('every flag defaults on, except the provider connectors', Object.entries(flags).every(([k, f]) => (f.on || /^(SLEEPER|YAHOO|CBS|ESPN)_SYNC$/.test(k)) && f.source === 'default'));
  ok('the provider connectors default off', ['SLEEPER_SYNC', 'YAHOO_SYNC', 'CBS_SYNC', 'ESPN_SYNC'].every(k => flags[k] && !flags[k].on));
  ok('a flag reads off the env', !H.flagOn({ FLAG_RIVALRY: '0' }, 'RIVALRY') && H.flagOn({ FLAG_RIVALRY: 'on' }, 'RIVALRY') && !H.flagOn({}, 'NOPE'));
}

console.log('\nthe Fantasy Analysis / Market Intelligence blend');
const row = (name, pos, team, c, v, basis, conf, role) => ({ name, position: pos, pos, team, key: _oddsNorm(name) + '|' + pos, consensus: { points: c, stats: {} }, vegas: { points: v, basis, confidence: conf, stats: {} }, ironTuna: { points: (c + v) / 2, stats: {} }, roleTrend: role || { label: 'no data', factor: 1, applied: false, games: 0 }, weeks: [{ opponent: 'X', env: {} }], why: { summary: 'line moved' } });
const rows = [
  row('CeeDee Lamb', 'WR', 'DAL', 18, 24, 'props', 'HIGH'), row('A.J. Brown', 'WR', 'PHI', 20, 16, 'props', 'HIGH'), row('George Pickens', 'WR', 'DAL', 12, 12, 'gamelines', 'MEDIUM'),
  row('Jalen Hurts', 'QB', 'PHI', 22, 22, 'ratings', 'LOW'), row('Dak Prescott', 'QB', 'DAL', 18, 26, 'ratings', 'LOW'),
  row('Saquon Barkley', 'RB', 'PHI', 19, 15, 'props', 'HIGH', { label: 'up', factor: 1.1, applied: true, games: 3 }), row('Javonte Williams', 'RB', 'DAL', 11, 14, 'gamelines', 'MEDIUM'),
  row('Dallas Goedert', 'TE', 'PHI', 9, 9, 'gamelines', 'MEDIUM')
];
{
  const c = H.blendComponents(rows[0]);
  ok('the fantasy component is the consensus, the market component the Vegas number', c.fantasy === 18 && c.market === 24 && c.shrink === 1);
  ok('100% Fantasy Analysis is the fantasy number', H.blendPoints(c, 0) === 18);
  ok('100% Market Intelligence on a priced prop is the market number', H.blendPoints(c, 1) === 24);
  ok('50/50 is halfway', H.blendPoints(c, 0.5) === 21);
  const r = H.blendComponents(rows[4]);
  ok('a fitted rating is shrunk: 100% market on an unpriced player is not the whole gap', r.shrink < 1 && H.blendPoints(r, 1) < 26 && H.blendPoints(r, 1) > 18, String(H.blendPoints(r, 1)));
  const s = H.blendComponents(rows[5]);
  ok('the usage role trend is in the fantasy side once applied', s.fantasy === _oddsRound(19 * 1.1) && s.roleFactor === 1.1);
  ok('the weight is clamped', H.blendPoints(c, 7) === 24 && H.blendPoints(c, -3) === 18);
  const b0 = H.blendBoard({ ok: true, players: rows }, 0), b1 = H.blendBoard({ ok: true, players: rows }, 1), b5 = H.blendBoard({ ok: true, players: rows }, 0.5);
  const wr = b => b.players.filter(p => p.position === 'WR').sort((x, y) => x.blend.rank - y.blend.rank).map(p => p.name);
  ok('at 0 the receivers rank on the consensus: Brown, Lamb, Pickens', wr(b0).join() === 'A.J. Brown,CeeDee Lamb,George Pickens', wr(b0).join());
  ok('at 1 the receivers rank on the market: Lamb, Brown, Pickens', wr(b1).join() === 'CeeDee Lamb,A.J. Brown,George Pickens', wr(b1).join());
  ok('the ranks at both ends ride on every row whatever the weight', b5.players.every(p => p.blend.fantasyRank >= 1 && p.blend.marketRank >= 1) && b5.players.find(p => p.name === 'CeeDee Lamb').blend.fantasyRank === 2 && b5.players.find(p => p.name === 'CeeDee Lamb').blend.marketRank === 1);
  ok('the weight label reads as the spec writes it', b5.weightLabel === '50/50' && b0.weightLabel === 'Fantasy Analysis' && b1.weightLabel === 'Market Intelligence');
  ok('the change is a calculation, not a reorder: the points move with the weight', b0.players.find(p => p.name === 'CeeDee Lamb').blend.points === 18 && b1.players.find(p => p.name === 'CeeDee Lamb').blend.points === 24);
  const big = [];
  for (let i = 0; i < 40; i++) big.push(row('Player ' + String.fromCharCode(65 + i) + ' Smith', 'WR', 'T' + (i % 8), 20 - i * 0.4, 20 - i * 0.4 + (i === 30 ? 9 : 0), 'props', 'HIGH'));
  const d = H.blendDisagreements(H.blendBoard({ ok: true, players: big }, 0.5).players, 5);
  ok('a disagreement needs a six-place gap and a quarter of the rank, on a startable player', d.length === 1 && d[0].fantasyRank === 31 && d[0].marketRank === 9 && d[0].higher === 'market' && d[0].gap >= 6, JSON.stringify(d.map(x => [x.name, x.fantasyRank, x.marketRank])));
  ok('a two-place disagreement is not one', !H.blendDisagreements(H.blendBoard({ ok: true, players: rows }, 0.5).players, 5).some(x => x.name === 'Javonte Williams'));
}

console.log('\nthe rivalry column');
{
  // A board wide enough to rank on: the two ends are pulled apart on every
  // fourth player, in both directions, so each man has candidates of his own.
  const pool = [];
  const shape = { QB: 20, RB: 40, WR: 55, TE: 20 };
  let n = 0;
  for (const [ps, cnt] of Object.entries(shape)) for (let i = 0; i < cnt; i++, n++) {
    const base = (ps === 'QB' ? 21 : ps === 'RB' ? 20 : ps === 'WR' ? 19 : 14) - i * 0.35;
    const swing = n % 5 === 0 ? 4.6 : n % 4 === 0 ? -3.8 : n % 7 === 0 ? 2.9 : 0.3;
    pool.push({ name: 'Player ' + n + ' Smith', position: ps, team: 'T' + (n % 8), key: 'p' + n + '|' + ps,
      consensus: { points: base }, vegas: { points: base + swing, basis: n % 5 === 0 ? 'props' : n % 5 === 1 ? 'gamelines' : n % 5 === 2 ? 'props-partial' : n % 5 === 3 ? 'ratings' : 'props+gamelines', confidence: n % 7 === 0 ? 'LOW' : 'HIGH' },
      roleTrend: n % 6 === 0 ? { applied: true, factor: 1.1 } : null,
      why: n % 4 === 0 ? { summary: 'x', drivers: [{ kind: 'volume', label: 'Receiving yards', from: 54.5, to: 63.5, delta: 9, pct: 16.5 }] } : null });
  }
  const b = H.blendBoard({ ok: true, players: pool, currentWeek: 3 }, 0.5);
  const c = H.rivalryColumns(b.players, { week: 3 });
  ok('both men file a column of five', c.vega.picks.length === H.RIVALRY_PICKS && c.brooks.picks.length === H.RIVALRY_PICKS, JSON.stringify([c.vega.picks.length, c.brooks.picks.length]));
  ok('each column is bylined to its man and points at the other', c.vega.name === 'Nate Vega' && c.vega.against.name === 'Evan Brooks' && c.brooks.against.name === 'Nate Vega' && c.vega.url === '/analysts/vega');
  ok('a man only pitches players his own end of the slider has higher', c.vega.picks.every(p => p.mineRank < p.theirsRank) && c.brooks.picks.every(p => p.mineRank < p.theirsRank));
  ok('the two columns cannot be the same column', !c.vega.picks.some(p => c.brooks.picks.some(q => q.key === p.key)));
  ok('nobody is pitched twice in one column', new Set(c.vega.picks.map(p => p.key)).size === 5 && new Set(c.brooks.picks.map(p => p.key)).size === 5);
  ok('every pitch names both ranks and ends on the needle', c.vega.picks.every(p => p.pitch.indexOf(p.position + p.mineRank) > 0 && p.pitch.indexOf(p.position + p.theirsRank) > 0 && /[.!]$/.test(p.pitch)) && c.brooks.picks.every(p => p.pitch.indexOf(p.position + p.mineRank) > 0 && p.pitch.indexOf(p.position + p.theirsRank) > 0));
  ok('no two picks in a column draw the same jab', new Set(c.vega.picks.map(p => p.pitch.split('. ').pop())).size === 5 && new Set(c.brooks.picks.map(p => p.pitch.split('. ').pop())).size === 5);
  ok('the same board on the same week reads the same', JSON.stringify(H.rivalryColumns(b.players, { week: 3 })) === JSON.stringify(c));
  ok('the needles move with the week', JSON.stringify(H.rivalryColumns(b.players, { week: 4 })) !== JSON.stringify(c));
  ok('Vega never pitches a player no book has priced', c.vega.picks.every(p => p.marketBasis !== 'none'));
  ok('each man names his rival, not himself', c.vega.picks.every(p => /Brooks|Evan/.test(p.pitch)) && c.brooks.picks.every(p => /Vega|Nate/.test(p.pitch)));
  ok('the pitches clear the same phrasing bar the writer is held to, em dashes included', ['vega', 'brooks'].every(k => !H.AI_PHRASES.some(re => re.test(c[k].standfirst)) && c[k].picks.every(p => !H.AI_PHRASES.some(re => re.test(p.pitch)))));
  // A week the two ends agree on: the relaxed pass still has to find five, and
  // a board with nothing in it must not invent anybody.
  const calm = H.blendBoard({ ok: true, players: pool.map((p, i) => ({ ...p, vegas: { ...p.vegas, points: p.consensus.points + (i % 9 === 0 ? 1.4 : i % 8 === 0 ? -1.2 : 0.05) } })), currentWeek: 3 }, 0.5);
  const cc = H.rivalryColumns(calm.players, { week: 3 });
  ok('a quiet week still fills both columns off the relaxed pass', cc.vega.picks.length === 5 && cc.brooks.picks.length === 5, JSON.stringify([cc.vega.picks.length, cc.brooks.picks.length]));
  const flat = H.blendBoard({ ok: true, players: pool.map(p => ({ ...p, roleTrend: null, vegas: { ...p.vegas, points: p.consensus.points } })), currentWeek: 3 }, 0.5);
  const cf = H.rivalryColumns(flat.players, { week: 3 });
  ok('two identical boards produce no picks rather than invented ones', cf.vega.picks.length === 0 && cf.brooks.picks.length === 0, JSON.stringify([cf.vega.picks.length, cf.brooks.picks.length]));
}

console.log('\nthe rivalry column on the record');
{
  // A fake D1 that answers exactly the statements this feature issues. Table
  // rows are plain objects; anything else throws, so a query that changes
  // shape fails here instead of silently returning nothing in production.
  const fakeDb = () => {
    const t = { rivalry_columns: [], analyst_calls: [] };
    let nextId = 1;
    const run = (sql, b) => {
      if (/^CREATE /.test(sql)) return { success: true };
      if (/^INSERT INTO rivalry_columns/.test(sql)) {
        if (t.rivalry_columns.some(r => r.season === b[0] && r.week === b[1])) throw new Error('UNIQUE constraint failed');
        t.rivalry_columns.push({ season: b[0], week: b[1], payload: b[2], built_at: b[3] }); return { success: true };
      }
      if (/^INSERT INTO analyst_calls/.test(sql)) {
        const k = ['season', 'week', 'analyst', 'player_key', 'player', 'team', 'position', 'kind', 'slug', 'lens', 'direction', 'recommendation', 'rank', 'confidence', 'rationale', 'evidence', 'rivalry', 'created_at'];
        const row = { id: nextId++, outcome: null, outcome_note: null, outcome_at: null };
        k.forEach((n, i) => { row[n] = b[i]; });
        t.analyst_calls.push(row); return { success: true };
      }
      if (/^UPDATE analyst_calls SET outcome/.test(sql)) {
        const row = t.analyst_calls.find(r => r.id === b[3]);
        if (row) { row.outcome = b[0]; row.outcome_note = b[1]; row.outcome_at = b[2]; }
        return { success: true };
      }
      throw new Error('unexpected write: ' + sql.slice(0, 60));
    };
    const all = (sql, b) => {
      if (/FROM rivalry_columns/.test(sql)) return { results: t.rivalry_columns.filter(r => r.season === b[0] && r.week === b[1]) };
      if (/FROM analyst_calls WHERE outcome IS NULL/.test(sql)) return { results: t.analyst_calls.filter(r => r.outcome == null && r.week != null && r.week <= b[0]) };
      if (/FROM analyst_calls WHERE kind = \? AND season = \?/.test(sql)) {
        return { results: t.analyst_calls.filter(r => r.kind === b[0] && r.season === b[1]).sort((x, y) => y.week - x.week || x.id - y.id) };
      }
      throw new Error('unexpected read: ' + sql.slice(0, 60));
    };
    // D1's bind() returns a NEW bound statement rather than mutating the
    // prepared one, and a batch of ten statements built off one prepare only
    // works because of that. The fake copies the behaviour, or the test would
    // pass against a shim the real thing does not match.
    const stmt = (sql, b) => ({ sql, b,
      bind: (...a) => stmt(sql, a),
      async run() { return run(sql, b); },
      async all() { return all(sql, b); },
      async first() { return (await this.all()).results[0] || null; } });
    return { t, prepare: sql => stmt(sql, []),
      async batch(list) { const done = []; for (const x of list) done.push(await run(x.sql, x.b)); return done; } };
  };
  const shape = { QB: 20, RB: 40, WR: 55, TE: 20 };
  const pool = [];
  let n = 0;
  for (const [ps, cnt] of Object.entries(shape)) for (let i = 0; i < cnt; i++, n++) {
    const base = (ps === 'QB' ? 21 : ps === 'RB' ? 20 : ps === 'WR' ? 19 : 14) - i * 0.35;
    const swing = n % 5 === 0 ? 4.6 : n % 4 === 0 ? -3.8 : n % 7 === 0 ? 2.9 : 0.3;
    pool.push({ name: 'Player ' + n + ' Smith', position: ps, team: 'T' + (n % 8), key: 'p' + n + '|' + ps,
      consensus: { points: base }, vegas: { points: base + swing, basis: n % 5 === 3 ? 'ratings' : 'props', confidence: 'HIGH' },
      roleTrend: n % 6 === 0 ? { applied: true, factor: 1.1 } : null, why: null });
  }
  BOARD = { ok: true, players: pool, season: 2026, currentWeek: 3 };
  H.setBoards(async () => BOARD);
  const db = fakeDb();
  const env = { LEADS_DB: db };
  const built = await H.runRivalryColumn(env);
  ok('the week is built once and stored', built.ok && built.week === 3 && built.picks === 10 && built.calls === 10, JSON.stringify(built));
  ok('the stored payload is the column the reader gets', (await H.rivalryColumnRead(env, 2026, 3)).columns.vega.picks.length === 5);
  const again = await H.runRivalryColumn(env);
  ok('a second run that week changes nothing', again.already === true && db.t.analyst_calls.length === 10, JSON.stringify(again));
  const one = db.t.analyst_calls[0];
  ok('a pick is filed as the claim it makes, against a named rank', one.kind === H.RIVALRY_COLUMN_KIND && one.direction === 'up' && /finishes ahead of/.test(one.recommendation) && JSON.parse(one.rivalry).theirsRank > one.rank);
  ok('both men are on the record for the week', new Set(db.t.analyst_calls.map(r => r.analyst)).size === 2 && db.t.analyst_calls.every(r => r.week === 3 && r.season === 2026));

  // The week's real finishes: the pitched players score in a spread that makes
  // some claims true and some false, and one of them does not play at all.
  const picked = db.t.analyst_calls.map(r => ({ key: r.player_key, position: r.position, theirs: JSON.parse(r.rivalry).theirsRank }));
  const players = {};
  for (const p of pool) players[p.key] = { name: p.name, position: p.position, latest: { week: 3, stats: { recYd: 10, rec: 1 } }, season: { games: 3, points: 30 } };
  // Give every pitched player but one a line good enough to finish first in his
  // position; the odd one out is scratched.
  picked.forEach((p, i) => { if (i === 0) delete players[p.key]; else players[p.key].latest.stats = { recYd: 400 - i * 2, rec: 20, recTD: 3 }; });
  USAGE = { season: 2026, throughWeek: 3, players };
  const graded = await H.runCallsGrade(env);
  ok('every pick is settled once the week publishes', graded.ok && graded.rivalry === 10 && db.t.analyst_calls.every(r => r.outcome), JSON.stringify(graded));
  ok('a player who did not play loses the claim', db.t.analyst_calls[0].outcome === 'miss' && /did not play/.test(db.t.analyst_calls[0].outcome_note));
  ok('a pick that finishes ahead of the rival’s rank is a hit', db.t.analyst_calls.slice(1).every(r => r.outcome === 'hit') && /finished/.test(db.t.analyst_calls[1].outcome_note));
  ok('the note names the finish and the rank it beat', /finished [A-Z]+\d+ on [\d.]+ points; (Nate Vega|Evan Brooks) had him [A-Z]+\d+/.test(db.t.analyst_calls[1].outcome_note), db.t.analyst_calls[1].outcome_note);

  // The stats file moves on: week 3's picks are no longer gradeable from it,
  // and a player who played on must not read as a scratch.
  const late = fakeDb();
  for (const r of db.t.analyst_calls) late.t.analyst_calls.push({ ...r, id: r.id, outcome: null, outcome_note: null });
  USAGE = { season: 2026, throughWeek: 4, players };
  const missed = await H.runCallsGrade({ LEADS_DB: late });
  ok('a week the stats file has moved past is left pending, not guessed', missed.ok && missed.rivalry === 0 && late.t.analyst_calls.every(r => !r.outcome), JSON.stringify(missed));
  USAGE = { season: 2026, throughWeek: 3, players };

  const led = await H.rivalryLedger(env, 2026);
  ok('the ledger totals each man’s graded picks', led.vega.graded === 5 && led.brooks.graded === 5 && led.vega.hit + led.vega.miss + led.vega.push === 5);
  ok('the ledger settles on the last graded week and names the widest win', led.lastWeek.week === 3 && led.lastWeek.vega.of === 5 && led.lastWeek.brooks.of === 5 && led.lastWeek.vega.best && led.lastWeek.vega.best.finish < led.lastWeek.vega.best.theirs, JSON.stringify(led.lastWeek && led.lastWeek.vega));

  // A finish exactly on the rival's number is a push, not a win.
  ok('the exact rank is a push', H.gradeRivalryCall({ week: 3, position: 'WR', rivalry: { theirsRank: 12, against: 'brooks' } }, { rank: 12, points: 9.9 }).outcome === 'push');
  ok('a finish behind the rival’s rank is a miss', H.gradeRivalryCall({ week: 3, position: 'WR', rivalry: { theirsRank: 12, against: 'brooks' } }, { rank: 19, points: 4.1 }).outcome === 'miss');
  ok('a pick with no rival rank is not graded at all', H.gradeRivalryCall({ week: 3, position: 'WR', rivalry: {} }, { rank: 4, points: 22 }) === null);
  const finishes = H.weekFinishRanks(USAGE, 3, H.scoringRules('ppr'));
  ok('the finish table ranks inside the position, best first', finishes[picked[1].key].rank >= 1 && Object.values(finishes).every(f => f.rank >= 1) && !finishes[picked[0].key]);
  ok('a week nobody has played yet has no finish table', Object.keys(H.weekFinishRanks(USAGE, 9, H.scoringRules('ppr'))).length === 0);
  USAGE = null; BOARD = null;
}

console.log('\nthe rivalry column on the calendar');
{
  const src2 = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  ok('the build is a registered job', /'rivalry-column':\s+env => runRivalryColumn\(env\)/.test(src2));
  ok('it runs Thursday morning, before the first kickoff, and retries after', /\{ job: 'rivalry-column',\s+days: \['Thu', 'Fri', 'Sat'\],\s+hours: \[8\]/.test(src2));
  ok('the grader still runs after the weekly stats land', /\{ job: 'calls-grade',\s+days: \['Tue', 'Wed'\],\s+hours: \[6\]/.test(src2));
  ok('the store is created with the rest of the desk', /CREATE TABLE IF NOT EXISTS rivalry_columns/.test(src2));
  const payloadSrc = src2.slice(src2.indexOf('async function disagreementsPayload'), src2.indexOf('// ── breaking news'));
  ok('a page load reads the stored column and never writes one', /rivalryColumnRead\(env/.test(payloadSrc) && !/INSERT INTO rivalry_columns/.test(payloadSrc) && !/runRivalryColumn\(/.test(payloadSrc));
  ok('a page load says whether what it is showing is locked', /locked: !!stored/.test(payloadSrc));
}

console.log('\nthe rivalry gate');
{
  const dis = [{ name: 'CeeDee Lamb', position: 'WR', team: 'DAL', key: 'ceedeelamb|WR', fantasyRank: 14, marketRank: 5, gap: 9, higher: 'market', fantasyPoints: 14, marketPoints: 19, marketBasis: 'props', marketConfidence: 'HIGH', why: 'the receiving line moved' }];
  const c = H.rivalryCandidate(dis);
  ok('the candidate names both sides with their ranks', c && c.player === 'CeeDee Lamb' && c.brooks.rank === 14 && c.vega.rank === 5 && c.higher === 'vega' && c.pair.join() === 'vega,brooks');
  ok('no disagreement, no rivalry', H.rivalryCandidate([]) === null);
  ok('a kind without the flag never carries it', H.rivalryGate({}, 'kickers-defenses', dis, { allowed: true }) === null && H.rivalryGate({}, 'pickup-advisor', dis, { allowed: true }) === null);
  ok('an eligible kind carries it when the budget allows', H.rivalryGate({}, 'early-rankings', dis, { allowed: true }) !== null);
  ok('and not when the budget is spent', H.rivalryGate({}, 'early-rankings', dis, { allowed: false, used: 2, window: 10 }) === null);
  ok('and not when the flag is off', H.rivalryGate({ FLAG_RIVALRY: '0' }, 'early-rankings', dis, { allowed: true }) === null);
  // The budget rule, reproduced: (used + 1) / max(window, seen + 1) <= 0.2.
  const budget = (used, seen) => (used + 1) / Math.max(10, seen + 1) <= 0.2;
  ok('the budget allows one in five over a ten-piece window and no more', budget(0, 10) && budget(1, 10) && !budget(2, 10) && budget(0, 0));
}

console.log('\nfreshness');
{
  const now = Date.UTC(2026, 8, 13, 16, 15);
  const st = { schedule: { provider: 'nflverse', at: now - 20 * 60000 }, availability: { provider: 'espn', at: now - 3 * 3600000 }, odds: { provider: 'odds', at: now - 5 * 3600000 }, snapshots: { at: now - 2 * 3600000 }, usage: { at: now - 5 * 86400000 }, depth: { at: now - 10 * 3600000 } };
  const f = H.freshnessReport(st, 'last-minute-intel', now);
  ok('a three-hour-old injury list is stale for Sunday 12:15', f.sources.availability.status === 'stale' && f.excluded.includes('availability'));
  ok('and fresh for a Tuesday piece', H.freshnessReport(st, 'ros-rankings', now).sources.availability.status === 'fresh');
  ok('a source with no stamp is missing, not stale', f.missing.includes('dfs') && f.sources.dfs.status === 'missing');
  ok('every source carries its provider, age and limit', Object.values(f.sources).every(s => 'provider' in s && 'ageHours' in s && s.limitHours > 0));
}

console.log('\nthe DFS metrics');
{
  const mk = (name, pos, sal, it, v, conf, td) => ({ name, position: pos, team: 'X', salary: sal, onBoard: true, ironTunaPoints: it, vegasPoints: v, consensusPoints: it, vegasConfidence: conf, tdProbability: td, vegasBasis: 'props' });
  const rows = [mk('A', 'WR', 9000, 22, 23, 'HIGH', 55), mk('B', 'WR', 5000, 15, 16, 'HIGH', 40), mk('C', 'WR', 4000, 8, 8, 'LOW', 20), mk('D', 'RB', 8000, 18, 18, 'MEDIUM', 50), mk('E', 'RB', 4500, 13, 12, 'MEDIUM', 35), mk('F', 'QB', 7000, 20, 21, 'HIGH', 0)];
  const m = H.dfsMetrics(rows, 'gpp');
  const B = m.rows.find(r => r.name === 'B'), C = m.rows.find(r => r.name === 'C');
  ok('value is indexed to the slate median', m.rows.some(r => r.value === 100) || Math.abs(_median(m.rows.map(r => r.value)) - 100) <= 1, JSON.stringify(m.rows.map(r => r.value)));
  ok('the cheap productive receiver is a value; the cheap unproductive one is not', B.value > 110 && C.value < 90, B.value + ' ' + C.value);
  ok('floor is below the projection and ceiling above it', m.rows.every(r => r.floor < r.ironTunaPoints && r.ceiling > r.ironTunaPoints));
  ok('ownership is modeled and labeled', m.rows.every(r => r.ownershipBasis === 'modeled' && r.ownership >= 0 && r.ownership <= 42) && m.ownershipBasis === 'modeled');
  ok('the value play draws more modeled ownership than the tax', B.ownership > C.ownership);
  ok('leverage is ceiling over ownership', m.rows.every(r => Math.abs(r.leverage - Math.round(r.ceiling / Math.max(1, r.ownership) * 10) / 10) < 0.11));
  ok('every metric the spec names is on the row', ['value', 'ownership', 'leverage', 'ceiling', 'floor', 'tournamentScore', 'cashScore'].every(k => typeof B[k] === 'number'));
  ok('contest types change the emphasis, not the numbers', H.dfsMetrics(rows, 'cash').sortBy === 'cashScore' && H.dfsMetrics(rows, 'gpp').sortBy === 'leverage' && H.dfsMetrics(rows, 'nonsense').contest === 'gpp' && Object.keys(H.DFS_CONTESTS).length === 5);
  ok('an unpriced slate has no metrics', H.dfsMetrics([], 'cash').rows.length === 0);
}

console.log('\nthe research packets and their worth gates');
const board = (list) => ({ ok: true, players: list.map((p, i) => ({ ...p, games: 3, byes: [], injury: p.injury || null, weeks: [{ opponent: 'X', home: true, env: { implied: 24, posted: true } }], marketDelta: p.marketDelta || { significant: false }, why: { summary: 'x' }, ironTuna: { ...p.ironTuna, rank: i + 1 }, consensus: { ...p.consensus, rank: i + 1 }, vegas: { ...p.vegas, rank: i + 1 } })) });
{
  const ctx = { week: board(rows), next: board(rows), usage: null, signals: { insights: [] }, depth: { teams: {} }, rules: H.scoringRules('ppr'), dfs: {}, injuriesList: [] };
  const rb = H.packetPosition(ctx, ['RB'], { gate: true });
  ok('with no usage, no insight and no absence, a positional feature is skipped', rb.skip === true && rb.reason === 'nothing_worth_publishing');
  const usage = { players: { 'javontewilliams|RB': { name: 'Javonte Williams', position: 'RB', team: 'DAL', season: { games: 3, targets: 6, carries: 30, points: 30 }, latest: { week: 3, usage: { targets: 4, carries: 22, carryShare: 0.8, snapPct: 0.7 }, stats: { rushYd: 90, rushTD: 1, rec: 3, recYd: 20 } } } } };
  const rb2 = H.packetPosition({ ...ctx, usage }, ['RB'], { gate: true });
  ok('a back whose touches jumped 30% against his average clears the gate', !rb2.skip && rb2.usageMoves.length === 1 && rb2.usageMoves[0].name === 'Javonte Williams' && rb2.usageMoves[0].carryShare === 80, JSON.stringify(rb2.usageMoves));
  ok('the packet says what no feed can supply', rb2.unavailable.some(u => /routes/.test(u)));
  const pk = H.packetPickups({ ...ctx, next: board(rows) });
  ok('the pickup advisor computes three league sizes with their rostered lines', pk.leagueSizes.join() === '10,12,14' && pk.tiers[12].rosteredLine.RB === 60 && pk.tiers[10].rosteredLine.WR === 60);
  ok('every tier carries a FAAB range and a holding period', Object.values(pk.tiers).every(t => t.priorityAdds.concat(t.midLevelAdds, t.deepAdds, t.speculativeStashes).every(r => Array.isArray(r.faabPct) && r.holdFor)));
  const un = H.packetUnderrated({ ...ctx, week: board(rows) });
  ok('the underrated pick is a player the market ranks well above the consensus, on a priced market', un.weeklyPick && un.weeklyPick.player === 'CeeDee Lamb' && un.weeklyPick.higher === 'market' || un.skip, JSON.stringify(un.weeklyPick || un));
  const kd = H.packetKDst({ ...ctx, week: board([row('Ravens', 'DST', 'BAL', 9, 10, 'gamelines', 'MEDIUM'), row('Justin Tucker', 'K', 'BAL', 8, 8, 'gamelines', 'MEDIUM')]) });
  ok('kickers and defenses each get their rows, and the DFS note says kickers are not on the main slates', kd.defenses.length === 1 && kd.kickers.length === 1 && /neither DraftKings nor FanDuel/.test(kd.kickerNote));
  ok('a packet with no salaries says so in the DFS block', kd.dfs.available === false && /No DFS salaries/.test(kd.dfs.note));
  ok('the subject week is the played week, the current week, or the week after the played one', (() => { const st = { ok: true, week: { type: 'REG', number: 3 }, weeks: [{ type: 'REG', number: 1, firstKickoff: 0 }, { type: 'REG', number: 2, firstKickoff: 1 }, { type: 'REG', number: 3, firstKickoff: 2 }] }; return H.contentSubjectWeek({ subject: 'played' }, st, 5) === 3 && H.contentSubjectWeek({ subject: 'nextPlayed' }, st, 5) === 4 && H.contentSubjectWeek({ subject: 'current' }, st, 5) === 3; })());
  ok('a live piece wants an update when the inactives changed and not otherwise', H.updateWanted(H.CONTENT_KINDS['last-minute-intel'], { status: 'published', brief: JSON.stringify({ stateHash: 'a' }) }, { ready: true, updatesUntil: Date.now() + 1e6 }, { stateHash: 'b' }, Date.now()) === true && H.updateWanted(H.CONTENT_KINDS['last-minute-intel'], { status: 'published', brief: JSON.stringify({ stateHash: 'a' }) }, { ready: true, updatesUntil: Date.now() + 1e6 }, { stateHash: 'a' }, Date.now()) === false);
  ok('the Sunday piece wants an update when more games are final, and not after its window', H.updateWanted(H.CONTENT_KINDS['what-sunday-taught-us'], { status: 'published', brief: JSON.stringify({ finalsCount: 9 }) }, { updatesUntil: Date.now() + 1e6 }, { finalsCount: 11 }, Date.now()) === true && H.updateWanted(H.CONTENT_KINDS['what-sunday-taught-us'], { status: 'published', brief: JSON.stringify({ finalsCount: 9 }) }, { updatesUntil: Date.now() - 1 }, { finalsCount: 11 }, Date.now()) === false);
}

console.log('\nthe packet the writer sees');
{
  const big = { meta: { kind: 'weekend-preview' }, freshness: { stale: [] }, rivalry: null, priorCalls: [], playerIndex: { a: 1 }, rivalryBudget: { allowed: true }, colleagues: ['x'], allowed: { names: ['A B'], numbers: ['1'], analysts: ['Sam Porter'] },
    cards: Array.from({ length: 40 }, (_, i) => ({ game: 'G' + i, rankings: Array.from({ length: 30 }, (_, j) => ({ name: 'P' + j, x: 'y'.repeat(60) })) })), injuries: Array.from({ length: 200 }, (_, i) => ({ name: 'I' + i, note: 'z'.repeat(80) })) };
  const c = H.compactForWriter(big, 20000);
  ok('the compacted packet is whole JSON under the budget', JSON.stringify(c).length <= 20000 && JSON.parse(JSON.stringify(c)) && !c.playerIndex && !c.rivalryBudget);
  ok('and says what it left out rather than cutting a string mid-object', Array.isArray(c.omittedForLength) && c.omittedForLength.length >= 1 && c.meta && c.allowed.analysts[0] === 'Sam Porter');
  ok('a packet inside the budget passes through with its facts intact', !H.compactForWriter({ meta: {}, allowed: { analysts: [] }, facts: [1, 2, 3] }).omittedForLength);
  ok('the writer waits longer than the legacy minute', H.WRITER_TIMEOUT_MS >= 120000 && H.WRITER_PACKET_BUDGET <= 120000);
  const now = Date.now();
  ok('a piece held with no draft is retried after forty minutes', H.heldRetryable({ status: 'held', body: null, version: 1, created_at: now - 50 * 60000 }, now) && !H.heldRetryable({ status: 'held', body: null, version: 1, created_at: now - 10 * 60000 }, now));
  ok('a piece held by the fact check, with a draft, is not retried', !H.heldRetryable({ status: 'held', body: '{"weekly":{}}', version: 1, created_at: now - 3 * 3600000 }, now));
  ok('nor a published piece, nor an eleventh attempt (a sixth is allowed: the Week 1 Weekend Preview needed more than six)', !H.heldRetryable({ status: 'published', body: null, version: 1, created_at: 0 }, now) && H.heldRetryable({ status: 'held', body: null, version: 6, created_at: 0 }, now) && !H.heldRetryable({ status: 'held', body: null, version: 10, created_at: 0 }, now));
}

console.log('\nanalyst memory');
{
  const packet = H._finishBrief({ meta: { kind: 'trade-desk' }, players: [{ name: 'CeeDee Lamb', team: 'DAL', position: 'WR' }], playerIndex: { 'CeeDee Lamb': { key: 'ceedeelamb|WR', team: 'DAL', position: 'WR' } } });
  const calls = H.normalizeCalls([{ player: 'CeeDee Lamb', direction: 'buy', recommendation: 'trade for him', confidence: 'high', rationale: 'targets', evidence: ['12 targets'] }, { player: 'Jerry Jeudy', direction: 'buy' }, { player: 'CeeDee Lamb', direction: 'moon' }], packet, 'brooks', 'weekly');
  ok('a call on a player the packet contains is kept, keyed and stamped with the analyst', calls.length === 1 && calls[0].playerKey === 'ceedeelamb|WR' && calls[0].analyst === 'brooks' && calls[0].confidence === 'HIGH');
  ok('a call on a player the packet does not contain is dropped, and so is a direction the vocabulary lacks', !calls.some(c => c.player === 'Jerry Jeudy') && calls.length === 1);
  ok('a bullish call hits when the actual beats the projection and misses when it does not', H.gradeCall({ direction: 'buy' }, 20, 15).outcome === 'hit' && H.gradeCall({ direction: 'buy' }, 8, 15).outcome === 'miss' && H.gradeCall({ direction: 'sell' }, 8, 15).outcome === 'hit');
  ok('within a point and a half is a push; a hold is noted, not graded', H.gradeCall({ direction: 'buy' }, 15.5, 15).outcome === 'push' && H.gradeCall({ direction: 'hold' }, 30, 15).outcome === 'noted' && H.gradeCall({ direction: 'buy' }, null, 15) === null);
}

console.log('\nthe fact check');
{
  const packet = H._finishBrief({ meta: { kind: 'trade-desk', lens: 'both' }, rivalry: null, players: [{ name: 'CeeDee Lamb', targets: 12, share: 34 }] });
  packet.allowed.names.push('Evan Brooks', 'Lena Park'); packet.allowed.analysts = ['Evan Brooks', 'Lena Park'];
  const good = { headline: 'Lamb is a target', dek: 'x', weekly: { target: [{ player: 'CeeDee Lamb', why: '12 targets, a 34% share' }], tradeAway: [], reasoning: ['Brooks likes the share.'], marketCounterpoint: [] }, dfs: { attack: [], fade: [], reasoning: ['Park: no salaries loaded.'] }, calls: [] };
  ok('a draft inside the packet, in the right shape, passes', H.factCheck(good, packet).ok, H.factCheck(good, packet).problems.join(';'));
  const bad = JSON.parse(JSON.stringify(good)); bad.weekly.reasoning = ['Jerry Jeudy had 155 yards.'];
  const v = H.factCheck(bad, packet);
  ok('a name and a number the packet lacks are caught', !v.ok && v.problems.includes('name:Jerry Jeudy') && v.problems.includes('number:155'));
  const riv = JSON.parse(JSON.stringify(good)); riv.weekly.reasoning = ['Vega has him WR5.']; riv.rivalryLine = 'Vega has him WR5.';
  const rv = H.factCheck(riv, packet);
  ok('naming Vega without a rivalry in the packet is caught twice: as an analyst and as a rivalry line', !rv.ok && rv.problems.includes('analyst:Nate Vega') && rv.problems.includes('rivalry:not_in_packet'));
  const withRiv = { ...packet, rivalry: { player: 'CeeDee Lamb' }, allowed: { ...packet.allowed, names: packet.allowed.names.concat('Nate Vega'), analysts: packet.allowed.analysts.concat('Nate Vega') } };
  ok('and passes once the packet carries the rivalry', H.factCheck(riv, withRiv).ok, H.factCheck(riv, withRiv).problems.join(';'));
  const ai = JSON.parse(JSON.stringify(good)); ai.weekly.reasoning = ['Buckle up, it is worth noting that Lamb — a target — is a game-changer.'];
  const pv = H.factCheck(ai, packet);
  ok('banned phrasing and an em dash are caught', pv.problems.filter(p => /^phrasing:/.test(p)).length >= 3, pv.problems.join(';'));
  const miss = JSON.parse(JSON.stringify(good)); delete miss.dfs; delete miss.weekly.tradeAway;
  const mv = H.factCheck(miss, packet);
  ok('a missing lens or section is caught', mv.problems.includes('missing:dfs') && mv.problems.includes('missing:weekly.tradeAway'));
  ok('every kind has weekly and DFS sections', Object.keys(H.CONTENT_KINDS).every(k => H.sectionsFor(k, 'weekly').length >= 4 && H.sectionsFor(k, 'dfs').length >= 3));
}

// The first live Thursday preview (2026-09-09) was held over headline words:
// every phrase below was reported as a player the packet did not contain, and
// the front page ran a draft-season auction story in its place for a day.
console.log('\nthe fact check reads prose as prose');
{
  const packet = H._finishBrief({ meta: { kind: 'tnf-preview', lens: 'both' }, rivalry: null,
    players: [{ name: 'Puka Nacua', targets: 12 }, { name: 'Isaac Guerendo', status: 'PUP' }, { name: 'Zach Charbonnet', status: 'PUP' }, { name: 'Sam Darnold', team: 'SEA' }],
    game: { spread: 3.5, total: 48.5, impliedHome: 26, impliedAway: 24.5, seasonAverage: 22.5, lastWeek: 22.4 } });
  const v = s => H.validateDraft(s, packet.allowed);
  ok('a title-case headline is not a list of players', v('Two Slates, Two Very Different Implied Totals: Follow the Market Away From New England').ok, JSON.stringify(v('Two Slates, Two Very Different Implied Totals: Follow the Market Away From New England').names));
  ok('a possessive is the name it belongs to', v("Guerendo's PUP stint and Charbonnet's PUP stint leave Iron Tuna's board thin.").ok, JSON.stringify(v("Guerendo's PUP stint and Charbonnet's PUP stint leave Iron Tuna's board thin.").names));
  ok('two sentences meeting at a full stop are two sentences', v('Start Nacua. Reasonable DST options exist. Vegas. Team totals agree.').ok, JSON.stringify(v('Start Nacua. Reasonable DST options exist. Vegas. Team totals agree.').names));
  ok('a verb in front of a packet name is a verb', v('Expect Nacua to lead. Bench Sam Darnold if Price sits.').ok, JSON.stringify(v('Expect Nacua to lead. Bench Sam Darnold if Price sits.').names));
  ok('a word the draft also uses in lower case is prose', v('Strong Vegas Fade candidates: the fade list is short and every strong number is priced.').ok);
  ok('a club and an acronym are never names', v('Every Patriots receiver and every NE back is a Classified Strong Vegas fade.').ok, JSON.stringify(v('Every Patriots receiver and every NE back is a Classified Strong Vegas fade.').names));
  const bad = v('Jerry Jeudy is the play, and Marvin Harrison Jr. is not in this packet.');
  ok('a player the packet lacks is still caught', !bad.ok && bad.names.includes('Jerry Jeudy') && bad.names.some(n => /Marvin Harrison/.test(n)), JSON.stringify(bad.names));
  ok('a spread reads from either side and a small difference is arithmetic', v('The spread is -3.5, the totals sit 1.5 points apart, the implied gap is 0.1.').ok, JSON.stringify(v('The spread is -3.5, the totals sit 1.5 points apart, the implied gap is 0.1.').numbers));
  const num = v('He ran for 155 yards and 26.4 points.');
  ok('a large number the packet lacks is still caught, and a packet number is not', !num.ok && num.numbers.includes('155') && !num.numbers.includes('26'), JSON.stringify(num.numbers));
  ok('the writer is told to write the headline in sentence case', /sentence case/i.test(H.NEWSROOM_SYSTEM) && /Never Title Case/.test(H.NEWSROOM_SYSTEM));
  const dk = H._finishBrief({ meta: { kind: 'tnf-what-matters', lens: 'both' }, dfs: { dk: [{ name: 'Jaxson Dart', salary: 5600 }], stacks: [{ team: 'DAL', salary: 20200 }] } });
  const dv = H.validateDraft('Jaxson Dart at 5,600, the DAL stack at 20,200 salary.', dk.allowed);
  ok('DFS salaries with thousands separators match the packet', dv.ok, JSON.stringify(dv.numbers));
}

console.log('\nthe writer reads a stream and knows when it was cut off');
{
  const ev = (o) => 'event: x\ndata: ' + JSON.stringify(o) + '\n\n';
  const done = H._anthropicStreamText(ev({ type: 'message_start' }) + ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"head' } }) + ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'line":"x"}' } }) + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }));
  ok('the deltas join into the answer', done.text === '{"headline":"x"}' && done.stop === 'end_turn' && !done.error, JSON.stringify(done));
  const cut = H._anthropicStreamText(ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"head' } }) + ev({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }));
  ok('a cut-off answer says so', cut.stop === 'max_tokens');
  ok('an error inside the stream is an error', H._anthropicStreamText(ev({ type: 'error', error: { type: 'overloaded_error' } })).error === 'provider_overloaded_error');
  ok('the writer has room for two lenses over a full slate', H.WRITER_MAX_TOKENS >= 12000 && H.WRITER_TIMEOUT_MS >= 240000);
}

console.log('\nwhat the site called before kickoff, and how it landed');
{
  const frz = (rows) => ({ takenAt: 1000, kickoff: 2000, rows });
  const row = (o) => ({ key: o.key || 'p|WR', name: o.name || 'A Player', position: 'WR', team: 'AAA',
    consensusRank: o.cr, consensusPts: o.cp, ironTunaRank: o.ir, ironTunaPts: o.ip, vegasRank: 10, vegasPts: 12 });
  const scored = (key, points) => new Map([[key, { points, line: '5 of 8, 60 receiving yards, 0 TD' }]]);

  ok('with no frozen board there is no claim at all', (() => {
    const v = H._vindication(null, scored('p|WR', 30), 1);
    return v.available === false && !v.hits.length && !v.misses.length && v.headline === null && /frozen/.test(v.reason);
  })());

  // Iron Tuna 18.0 against a consensus 10.0, eleven places higher: a called
  // overperformance. He scored 22, which beats the consensus number.
  ok('a called overperformance that happened is a hit', (() => {
    const v = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 22), 1);
    return v.available && v.hits.length === 1 && !v.misses.length && v.hits[0].direction === 'over' && v.hits[0].margin === 12;
  })());

  ok('the same call that did not happen is a miss, and never a hit', (() => {
    const v = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 4), 1);
    return v.available && !v.hits.length && v.misses.length === 1 && v.misses[0].direction === 'over';
  })());

  ok('a called underperformance is graded the other way round', (() => {
    const hit  = H._vindication(frz([row({ key: 'p|WR', cr: 8, cp: 16, ir: 20, ip: 9 })]), scored('p|WR', 5), 1);
    const miss = H._vindication(frz([row({ key: 'p|WR', cr: 8, cp: 16, ir: 20, ip: 9 })]), scored('p|WR', 25), 1);
    return hit.hits.length === 1 && hit.hits[0].direction === 'under' && miss.misses.length === 1 && !miss.hits.length;
  })());

  ok('a disagreement too small to have been a call is not one, in either direction', (() => {
    const pts   = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 11 })]), scored('p|WR', 30), 1);
    const ranks = H._vindication(frz([row({ key: 'p|WR', cr: 15, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 30), 1);
    return !pts.hits.length && !pts.misses.length && !ranks.hits.length && !ranks.misses.length;
  })());

  ok('a player the frozen board carries but the box score does not is skipped, not graded', (() => {
    const v = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), new Map(), 1);
    return v.available && !v.hits.length && !v.misses.length;
  })());

  ok('only a wide enough hit reaches the headline', (() => {
    const small = H._vindication(frz([row({ key: 'p|WR', cr: 20, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 13), 1);
    const big   = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 22), 1);
    return small.hits.length === 1 && small.headline === null
      && big.hits.length === 1 && big.headline && big.headline.name === 'A Player';
  })());

  ok('a miss is never the headline, however large', (() => {
    const v = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 0), 1);
    return v.misses.length === 1 && v.headline === null;
  })());

  ok('the hits are ordered by how far the result beat the consensus', (() => {
    const rows = [row({ key: 'a|WR', name: 'Ann Player', cr: 24, cp: 10, ir: 13, ip: 18 }),
                  row({ key: 'b|WR', name: 'Bob Player', cr: 30, cp: 8, ir: 12, ip: 16 })];
    const m = new Map([['a|WR', { points: 14 }], ['b|WR', { points: 28 }]]);
    const v = H._vindication(frz(rows), m, 1);
    return v.hits.length === 2 && v.hits[0].name === 'Bob Player';
  })());

  ok('the writer is handed the misses as well as the hits, and told to print one', (() => {
    const v = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 4), 1);
    const s = H._voiceBlock({ meta: { analyst: 'raines', dfsAnalyst: 'park' }, calledIt: v });
    return /REPORT BOTH/.test(s) && /at least one of them goes in the section/.test(s) && !/YOU/.test(s);
  })());

  ok('the you-are-welcome headline is offered only on a headline-sized hit, and spelled right', (() => {
    const v = H._vindication(frz([row({ key: 'p|WR', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored('p|WR', 22), 1);
    const s = H._voiceBlock({ meta: { analyst: 'raines', dfsAnalyst: 'park' }, calledIt: v });
    return s.includes("YOU'RE WELCOME") && !/YOUR WELCOME/.test(s) && /at most once/.test(s);
  })());

  ok('with no frozen board the writer is told to claim nothing', (() => {
    const s = H._voiceBlock({ meta: { analyst: 'raines', dfsAnalyst: 'park' }, calledIt: H._vindication(null, new Map(), 1) });
    return /Make no claim about having called anything/.test(s) && !/YOU/.test(s);
  })());

  ok('a row missing a projection or a rank is skipped, never counted as a call', (() => {
    const bad = (o) => ({ takenAt: 1, kickoff: 2, rows: [{ key: 'p|WR', name: 'A Player', position: 'WR', team: 'AAA',
      consensusRank: 24, consensusPts: 10, ironTunaRank: 13, ironTunaPts: 18, vegasRank: 10, vegasPts: 12, ...o }] });
    const m = new Map([['p|WR', { points: 22 }]]);
    return [{ ironTunaPts: null }, { consensusPts: undefined }, { ironTunaRank: null }, { consensusRank: NaN }]
      .every(o => { const v = H._vindication(bad(o), m, 1); return !v.hits.length && !v.misses.length; })
      && H._vindication(bad({}), new Map([['p|WR', { points: null }]]), 1).hits.length === 0;
  })());
  ok('the section is asked for and required together, or neither', (() => {
    const frz = { takenAt: 1, kickoff: 2, rows: [{ key: 'p|WR', name: 'A Player', position: 'WR', team: 'AAA', consensusRank: 24, consensusPts: 10, ironTunaRank: 13, ironTunaPts: 18, vegasRank: 10, vegasPts: 12 }] };
    const withCall = { meta: { kind: 'game-recap', lens: 'both' }, calledIt: H._vindication(frz, new Map([['p|WR', { points: 22 }]]), 1) };
    const without  = { meta: { kind: 'game-recap', lens: 'both' }, calledIt: H._vindication(null, new Map(), 1) };
    // No packet at all is the full calendar list, which is what the audit and
    // the kinds table read.
    return H.sectionsFor('game-recap', 'weekly').includes('weCalledIt')
      && H.sectionsFor('game-recap', 'weekly', withCall).includes('weCalledIt')
      && !H.sectionsFor('game-recap', 'weekly', without).includes('weCalledIt');
  })());
  ok('a recap with nothing called is not held for the section it was told to omit', (() => {
    const without = { meta: { kind: 'game-recap', lens: 'weekly' }, calledIt: H._vindication(null, new Map(), 1),
                      allowed: { names: [], numbers: [], analysts: ['Mike Raines'] } };
    const body = { headline: 'A game', weekly: Object.fromEntries(H.sectionsFor('game-recap', 'weekly', without).map(k => [k, ['x']])) };
    const fc = H.factCheck(body, without);
    return !fc.problems.some(p => /missing:weekly.weCalledIt/.test(p));
  })());
  ok('but a recap that DID call something is held if it leaves the section out', (() => {
    const frz = { takenAt: 1, kickoff: 2, rows: [{ key: 'p|WR', name: 'A Player', position: 'WR', team: 'AAA', consensusRank: 24, consensusPts: 10, ironTunaRank: 13, ironTunaPts: 18, vegasRank: 10, vegasPts: 12 }] };
    const withCall = { meta: { kind: 'game-recap', lens: 'weekly' }, calledIt: H._vindication(frz, new Map([['p|WR', { points: 22 }]]), 1),
                       allowed: { names: [], numbers: [], analysts: ['Mike Raines'] } };
    const body = { headline: 'A game', weekly: Object.fromEntries(H.sectionsFor('game-recap', 'weekly').filter(k => k !== 'weCalledIt').map(k => [k, ['x']])) };
    return H.factCheck(body, withCall).problems.some(p => /missing:weekly.weCalledIt/.test(p));
  })());
  ok('the frozen row keeps all three boards and drops a bye, an out and a kicker', (() => {
    const board = { players: [
      { key: 'a|WR', name: 'Ann Player', position: 'WR', pos: 'WR', team: 'AAA', weeks: [{ week: 1 }], consensus: { rank: 5, points: 12 }, ironTuna: { rank: 3, points: 15 }, vegas: { rank: 4, points: 14, basis: 'props' }, injury: null },
      { key: 'b|WR', name: 'Bye Player', position: 'WR', pos: 'WR', team: 'AAA', weeks: [{ week: 1, bye: true }], consensus: { rank: 6, points: 0 }, ironTuna: { rank: 6, points: 0 }, vegas: { rank: 6, points: 0 } },
      { key: 'c|WR', name: 'Out Player', position: 'WR', pos: 'WR', team: 'AAA', weeks: [{ week: 1, out: true }], consensus: { rank: 7, points: 0 }, ironTuna: { rank: 7, points: 0 }, vegas: { rank: 7, points: 0 } },
      { key: 'k|K',  name: 'Kick Player', position: 'K', pos: 'K', team: 'AAA', weeks: [{ week: 1 }], consensus: { rank: 1, points: 8 }, ironTuna: { rank: 1, points: 8 }, vegas: { rank: 1, points: 8 } },
      { key: 'z|WR', name: 'Zed Player', position: 'WR', pos: 'WR', team: 'ZZZ', weeks: [{ week: 1 }], consensus: { rank: 1, points: 20 }, ironTuna: { rank: 1, points: 20 }, vegas: { rank: 1, points: 20 } }
    ] };
    const rows = H._freezeRows(board, 1, new Set(['AAA']));
    return rows.length === 1 && rows[0].key === 'a|WR' && rows[0].consensusRank === 5 && rows[0].ironTunaPts === 15 && rows[0].vegasBasis === 'props';
  })());
}

console.log('\nbreaking news');
{
  const bd = board(rows).players;
  const rankOf = ev => { const p = bd.find(x => x.key === ev.playerKey); return p ? p.consensus.rank : null; };
  const sunday = Date.UTC(2026, 8, 13, 15, 0);   // Sunday 11 AM ET
  const tue = Date.UTC(2026, 8, 15, 15, 0);
  const out1 = H.scoreNewsEvent({ type: 'status', playerKey: 'ceedeelamb|WR', position: 'WR', from: 'Questionable', to: 'Out' }, rankOf, tue);
  ok('a top receiver ruled out is significant', out1.score >= 60, String(out1.score));
  const outDeep = H.scoreNewsEvent({ type: 'status', playerKey: 'x|WR', position: 'WR', from: '', to: 'Out' }, () => 70, tue);
  ok('a deep-bench receiver ruled out is not', outDeep.score < 60, String(outDeep.score));
  const q = H.scoreNewsEvent({ type: 'status', playerKey: 'ceedeelamb|WR', position: 'WR', from: '', to: 'Questionable' }, rankOf, tue);
  ok('a questionable tag scores below a scratch', q.score < out1.score);
  const sun = H.scoreNewsEvent({ type: 'status', playerKey: 'ceedeelamb|WR', position: 'WR', from: 'Questionable', to: 'Out' }, rankOf, sunday);
  ok('the same news on a Sunday morning scores higher', sun.score > out1.score);
  const qb = H.scoreNewsEvent({ type: 'depth', playerKey: 'dakprescott|QB', position: 'QB', from: 'Dak Prescott', to: 'Cooper Rush' }, () => 8, tue);
  ok('a starting-quarterback change is major', qb.score >= 60, String(qb.score));
  const prev = { availability: { 'ceedeelamb|WR': { status: 'Questionable' } }, depth: { DAL: { QB: ['Dak Prescott'], RB: ['Javonte Williams'] } } };
  const next = { availability: { 'ceedeelamb|WR': { status: 'Out', note: 'ankle' }, 'ajbrown|WR': { status: 'Questionable' } }, depth: { DAL: { QB: ['Dak Prescott'], RB: ['Javonte Williams'] } } };
  const evs = H.detectNewsEvents(prev, next, bd, tue);
  ok('the scan finds the status change and the new tag, best first', evs.length === 2 && evs[0].player === 'CeeDee Lamb' && evs[0].to === 'Out' && evs[1].player === 'A.J. Brown');
  ok('an unchanged picture finds nothing', H.detectNewsEvents(next, next, bd, tue).length === 0);
  const dep = H.detectNewsEvents(prev, { ...next, depth: { DAL: { QB: ['Cooper Rush'], RB: ['Javonte Williams'] } } }, bd, tue);
  ok('a depth-chart QB1 change is an event', dep.some(e => e.type === 'depth' && e.team === 'DAL' && e.to === 'Cooper Rush'));
}

console.log('\nthe draft-season social guard');
{
  ok('the env override allows the threads', (await H.draftSocialAllowed({ DRAFT_SEASON_SOCIAL: '1' })).ok);
  ok('with no schedule the guard falls open (preseason behavior is unchanged)', (await H.draftSocialAllowed({})).ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
