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
  'return { CONTENT_KINDS, LEGACY_CONTENT, NEWSROOM_SECTIONS, ANALYSTS, RIVALRY_PAIR, NEWSROOM_FLAGS, flagOn, flagReport, freshnessReport, blendComponents, blendPoints, blendBoard, blendDisagreements, rivalryColumns, RIVALRY_PICKS, RIVALRY_COLUMN_KIND, runRivalryColumn, setBoards: f => { boardsPayload = f; }, rivalryColumnRead, rivalryLedger, weekFinishRanks, gradeRivalryCall, runCallsGrade, dfsMetrics, DFS_CONTESTS, rivalryCandidate, rivalryGate, gradeCall, normalizeCalls, factCheck, scoreNewsEvent, detectNewsEvents, newsroomAudit, contentSubjectWeek, sectionsFor, packetPickups, packetPosition, packetUnderrated, packetKDst, updateWanted, compactForWriter, heldRetryable, heldRevivable, weekCase, weekFrameProblems, NEWSROOM_SYSTEM, WRITER_PACKET_BUDGET, WRITER_TIMEOUT_MS, WRITER_MAX_TOKENS, _anthropicStreamText, _finishBrief, validateDraft, AI_PHRASES, draftSocialAllowed, newsroomStatus, scoringRules, etParts, ROUTINE_MIGRATION, AI_DISCLOSURE, _vindication, _freezeRows, _voiceBlock, _weeksPlayed, CALLED_MIN_PTS, CALLED_MIN_RANKS, CALLED_HEADLINE_PTS, CALLED_HEADLINE_RANKS, pieceExpired, _staleRule, _lensHead, _lensDek, weekGames, _forwardRows, _fwdPlayers, packetQb, _perGameOrder, _pieceEdition, REWRITE_HELD_MAX, RECAPS_PER_TICK, packetCalledItWeek, weekPublishedCalls, gradeStoryCall, CALL_PUSH_PTS, WEEK_WINS_MAX, WEEK_MISSES_MAX, CONDITIONAL_SECTIONS };'
)(etOffsetHours, teamKey, _oddsNorm, _oddsRound, POOL, 'America/New_York', 17, g => Math.max(0, 1 - g / 17), { goalLineCarries: 'pbp' }, stub, stub, 'x', async () => {}, {}, {}, async () => USAGE, stub, async () => null, async () => null, async () => null, async () => null, stub, stub, {}, {}, stub);

console.log('\nthe migration');
{
  const a = H.newsroomAudit(['*/15 * * * *']);
  ok('the calendar audits clean', a.ok, a.problems.join('; '));
  ok('every retired kind is gone from the calendar', ['team-recaps', 'mnf-breakdown', 'what-they-arent-telling-you', 'opportunity-report', 'rankings-update', 'final-read', 'tnf-aftermath', 'weekend-game-plan', 'what-changed-today', 'snf-what-we-learned', 'early-rankings'].every(k => !H.CONTENT_KINDS[k] && H.LEGACY_CONTENT[k]));
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
  ok('every package has a primary analyst on the staff', Object.values(H.CONTENT_KINDS).every(k => H.ANALYSTS[k.analyst]));
  ok('every package but the rest-of-season rankings carries both lenses', Object.entries(H.CONTENT_KINDS).every(([k, v]) => k === 'ros-rankings' ? v.lens === 'weekly' : v.lens === 'both'));
  ok('the rest-of-season rankings are weekly-only: no DFS analyst, no DFS title', !H.CONTENT_KINDS['ros-rankings'].dfsAnalyst && !H.CONTENT_KINDS['ros-rankings'].dfsTitle);
  ok('the worth-gated pieces are the positional and QB features, and the Monday scorecard', ['quarterback-monday', 'tailback-tuesday', 'wideout-wednesday', 'tight-end-thursday', 'what-tuna-got-right'].every(k => H.CONTENT_KINDS[k].gate === 'worth'));
  ok('the Monday scorecard sits in the early rankings\' slot, about the played week, with the finals it has', (() => {
    const K = H.CONTENT_KINDS['what-tuna-got-right'];
    return K.day === 'Mon' && K.hour === 6 && K.retro === true && K.subject === 'played' && K.partial === true && K.absorbs.includes('early-rankings')
      && H.LEGACY_CONTENT['early-rankings'].disposition === 'merged' && !H.CONTENT_KINDS['early-rankings'];
  })());
  ok('it targets the week\'s final games and never the Monday game', (() => {
    const t = H.CONTENT_KINDS['what-tuna-got-right'].targets([{ id: 'a', dow: 'Sun', status: 'final' }, { id: 'b', dow: 'Sun', status: 'in' }, { id: 'c', dow: 'Mon', status: 'final' }, { id: 'd', dow: 'Thu', status: 'final' }]);
    return t.map(g => g.id).join() === 'a,d';
  })());
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
  // Nothing defaults off any more. The four provider connectors were the only
  // flags that did, and they went with the connectors (HANDOFF §87), so an
  // off-by-default flag appearing here again is a deliberate decision someone
  // has to make rather than a leftover.
  ok('every flag defaults on', Object.entries(flags).every(([, f]) => f.on && f.source === 'default'));
  ok('and no provider connector flag is left behind', !['SLEEPER_SYNC', 'YAHOO_SYNC', 'CBS_SYNC', 'ESPN_SYNC'].some(k => flags[k]));
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
        const row = { id: nextId++, outcome: null, outcome_note: null, outcome_at: null, outcome_actual: null, outcome_projected: null, outcome_margin: null };
        k.forEach((n, i) => { row[n] = b[i]; });
        t.analyst_calls.push(row); return { success: true };
      }
      if (/^UPDATE analyst_calls SET outcome/.test(sql)) {
        // outcome, note, at, actual, projected, margin, id
        const row = t.analyst_calls.find(r => r.id === b[6]);
        if (row) { row.outcome = b[0]; row.outcome_note = b[1]; row.outcome_at = b[2]; row.outcome_actual = b[3]; row.outcome_projected = b[4]; row.outcome_margin = b[5]; }
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
  ok('an eligible kind carries it when the budget allows', H.rivalryGate({}, 'ros-rankings', dis, { allowed: true }) !== null);
  ok('and not when the budget is spent', H.rivalryGate({}, 'ros-rankings', dis, { allowed: false, used: 2, window: 10 }) === null);
  ok('and not when the flag is off', H.rivalryGate({ FLAG_RIVALRY: '0' }, 'ros-rankings', dis, { allowed: true }) === null);
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
  const mk = (name, pos, sal, it, v, conf, td) => ({ name, position: pos, team: 'X', salary: sal, onBoard: true, projected: true, supplemental: false, projectionBasis: 'board', ironTunaPoints: it, vegasPoints: v, consensusPoints: it, vegasConfidence: conf, tdProbability: td, vegasBasis: 'props' });
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
  ok('every pickup row says who the player is playing', Object.values(pk.tiers).every(t => t.priorityAdds.concat(t.midLevelAdds, t.deepAdds, t.speculativeStashes).every(r => r.opponent === 'X' && r.home === true)));
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
  const good = { headline: 'Lamb is a target', dek: 'x', dfsHeadline: 'Lamb is the chalk', dfsDek: 'x', weekly: { target: [{ player: 'CeeDee Lamb', why: '12 targets, a 34% share' }], tradeAway: [], reasoning: ['Brooks likes the share.'], marketCounterpoint: [] }, dfs: { attack: [], fade: [], reasoning: ['Park: no salaries loaded.'] }, calls: [] };
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
  ok('every kind has weekly sections, and every both-lens kind has DFS sections', Object.entries(H.CONTENT_KINDS).every(([k, v]) => H.sectionsFor(k, 'weekly').length >= 4 && (v.lens === 'both' ? H.sectionsFor(k, 'dfs').length >= 3 : H.sectionsFor(k, 'dfs').length === 0)));

  // A HEADLINE PER LENS (2026-09-21). /dfs printed the Weekly Fantasy sentence
  // under the DFS byline -- "the clearest roster add of the week" over a
  // lineup page -- because a piece carried one headline for two lenses. A
  // both-lens piece owes a DFS headline and is HELD without one, exactly as it
  // is held for a missing section; a weekly-only piece is never asked.
  const noDfsHead = JSON.parse(JSON.stringify(good)); delete noDfsHead.dfsHeadline;
  ok('a both-lens piece with no DFS headline is held', H.factCheck(noDfsHead, packet).problems.includes('missing:dfsHeadline'));
  const blankDfsHead = JSON.parse(JSON.stringify(good)); blankDfsHead.dfsHeadline = '   ';
  ok('and a blank one does not count as one', H.factCheck(blankDfsHead, packet).problems.includes('missing:dfsHeadline'));
  const weeklyOnly = H._finishBrief({ meta: { kind: 'ros-rankings', lens: 'weekly' }, rivalry: null, players: [{ name: 'CeeDee Lamb', targets: 12, share: 34 }] });
  const wOnlyBody = { headline: 'Movers', dek: 'x', weekly: Object.fromEntries(H.sectionsFor('ros-rankings', 'weekly').map(k => [k, []])), calls: [] };
  ok('a weekly-only piece is never asked for one', !H.factCheck(wOnlyBody, weeklyOnly).problems.some(p => /dfsHeadline/.test(p)),
     H.factCheck(wOnlyBody, weeklyOnly).problems.join(';'));
  // The week-frame check reads both pairs, so a DFS headline cannot preview a
  // week that has already been played while the weekly one gets it right.
  const meta = { storyType: 'retrospective', week: 2, forwardWeek: 3 };
  ok('the week frame is checked on the DFS headline too',
     H.weekFrameProblems({ headline: 'What Week 2 taught us', dek: 'x', dfsHeadline: 'Week 2 chalk to roster', dfsDek: 'x' }, meta)
      .some(p => /^week:dfsHeadline/.test(p)));
  ok('and a DFS headline that looks back is fine',
     !H.weekFrameProblems({ headline: 'What Week 2 taught us', dek: 'x', dfsHeadline: 'What Week 2 taught us about Week 3 pricing', dfsDek: 'x' }, meta)
       .some(p => /dfsHeadline/.test(p)));
  // The feed serves the lens it was asked for, and falls back rather than
  // going blank on a row stored before the column existed.
  const row = { headline: 'W', dek: 'wd', dfs_headline: 'D', dfs_dek: 'dd' };
  const old = { headline: 'W', dek: 'wd', dfs_headline: null, dfs_dek: null };
  ok('the weekly lane reads the weekly pair', H._lensHead(row, 'weekly') === 'W' && H._lensDek(row, 'weekly') === 'wd');
  ok('the DFS lane reads the DFS pair', H._lensHead(row, 'dfs') === 'D' && H._lensDek(row, 'dfs') === 'dd');
  ok('a row written before the column falls back to the weekly pair', H._lensHead(old, 'dfs') === 'W' && H._lensDek(old, 'dfs') === 'wd');
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
  ok('the writer is told to name who every player is playing, so the advice reads as this week\'s', /NAME THE OPPONENT/.test(H.NEWSROOM_SYSTEM) && /say who he is playing/.test(H.NEWSROOM_SYSTEM) && /not a prior week/.test(H.NEWSROOM_SYSTEM));
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

// Week 1's Thursday piece passed the fact check the moment the comma rule
// landed, and still never published: the exists check returned before the
// revalidation could look at it.
console.log('\na held draft is re-read after the check itself changes');
{
  const held = (o) => ({ status: 'held', body: '{"headline":"x"}', violations: '[]', version: 2, created_at: 1, ...o });
  ok('a held draft does not count as already written', H.heldRevivable(held()));
  ok('a piece held for the editor stays the editor\'s', !H.heldRevivable(held({ violations: '["awaiting_approval: paused from /admin"]' })));
  ok('a published piece is not reopened', !H.heldRevivable(held({ status: 'published' })));
  ok('a held piece with no draft is the retry path, not this one', !H.heldRevivable(held({ body: 'null' })) && H.heldRetryable({ status: 'held', body: 'null', version: 1, created_at: 0 }, 41 * 60000));
  ok('nothing stored is nothing to revive', !H.heldRevivable(null));
  // The per-game loop keeps its own copy of the exists check, one call above
  // produceContent, and it skipped the whole piece before the revival could
  // run: the SF at LA recap sat held while the slate pieces beside it revived.
  // Since the Sunday night of Week 1 the gate lives in _perGameOrder, one
  // call above the loop, and the loop itself keeps no exists check at all.
  const perGame = cut('async function runPerGameKind(', 'async function runContentTick(');
  const gate = cut('function _perGameOrder(', 'async function runContentTick(');
  ok('the per-game loop lets a revivable draft through its own exists check', !/heldRevivable\(latest\)\) continue;/.test(perGame) && /_perGameOrder\(finals/.test(perGame) && /heldRetryable\(l, now\) \|\| \(heldRevivable\(l\)/.test(gate), perGame.split('\n').filter(l => /continue;/.test(l)).join(' | '));
}

// Week 1, 2026-09-11: the desk wrote three complete pieces and the check held
// every one of them. "Herbert.\nVega" and "Outperformed.\nPricing" were two
// sentences; "Lock Herbert" and "Move Williams" were verbs; 12.9 and the DFS
// salary savings were arithmetic the drafts spelled out in full.
console.log('\nthe fact check reads a sentence break, a verb and shown arithmetic');
{
  const p = H._finishBrief({ meta: { kind: 'weekend-preview', lens: 'both' }, rivalry: null,
    players: [{ name: 'Justin Herbert', salary: 6100 }, { name: 'Kyren Williams', carries: 14 }, { name: 'Matthew Stafford', projected: 17.1, points: 4.2 }],
    dfs: { saver: [{ name: 'Patrick Mahomes', salary: 5500 }, { name: 'Josh Allen', salary: 7000 }, { name: 'Geno Smith', salary: 4600 }, { name: 'Bub Means', salary: 3000 }, { name: 'Saints DST', salary: 2200 }] } });
  const v = s => H.validateDraft(s, p.allowed);
  ok('a name meeting a sentence break is two sentences', v('The market has Herbert at rank 3. Vega called the buy.').ok, JSON.stringify(v('The market has Herbert at rank 3. Vega called the buy.').names));
  ok('a verb in front of a packet name is a verb', v('Lock Herbert in cash. Move Williams up.').ok, JSON.stringify(v('Lock Herbert in cash. Move Williams up.').names));
  ok('a difference the draft spells out is arithmetic at any size', v('Projected 17.1, finished 4.2. A 12.9-point miss.').ok, JSON.stringify(v('Projected 17.1, finished 4.2. A 12.9-point miss.').numbers));
  ok('salary savings the draft spells out are arithmetic', v('Mahomes at 5,500 saves 1,500 against Allen at 7,000, and Smith at 4,600 saves 2,400.').ok, JSON.stringify(v('Mahomes at 5,500 saves 1,500 against Allen at 7,000, and Smith at 4,600 saves 2,400.').numbers));
  ok('a saving between two salaries the draft quotes is arithmetic', v('Means at 3,000 and the Saints DST at 2,200: the 800 difference buys an upgrade.').ok, JSON.stringify(v('Means at 3,000 and the Saints DST at 2,200: the 800 difference buys an upgrade.').numbers));
  ok('a large number with no working shown is still caught', v('He saves 1,500 somewhere.').numbers.join() === '1500', JSON.stringify(v('He saves 1,500 somewhere.').numbers));
  ok('a player the packet lacks is still caught', v('Jerry Jeudy is the play here.').names.join() === 'Jerry Jeudy');
}

// Week 1's recaps were held again on the same shape with different words:
// "Stash Allen", "Attack Douglas", "Unlike Watson". Each hold costs a whole
// regeneration, and one recap took eight of them.
console.log('\nthe call vocabulary is prose, not a roster');
{
  const p = H._finishBrief({ meta: { kind: 'game-recap', lens: 'both' }, rivalry: null,
    players: [{ name: 'Josh Allen' }, { name: 'Deshaun Watson' }, { name: 'Caleb Douglas' }, { name: 'Ashton Jeanty' }] });
  const v = s => H.validateDraft(s, p.allowed);
  ok('a call direction in front of a packet name is a verb', v('Stash Allen in deeper leagues. Attack Douglas in tournaments. Pair Jeanty with the game stack.').ok, JSON.stringify(v('Stash Allen in deeper leagues. Attack Douglas in tournaments. Pair Jeanty with the game stack.').names));
  ok('a preposition in front of a packet name is a preposition', v('Unlike Watson, the price never moved. Despite Jeanty, the total stayed low.').ok, JSON.stringify(v('Unlike Watson, the price never moved. Despite Jeanty, the total stayed low.').names));
  ok('an invented player is still caught beside them', v('Stash Allen, but Jerry Jeudy is the real play.').names.join() === 'Jerry Jeudy', JSON.stringify(v('Stash Allen, but Jerry Jeudy is the real play.').names));
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


console.log('\nthe Monday scorecard: the week\'s wins, biggest first');
{
  const frz = (rows) => ({ takenAt: 1000, kickoff: 2000, rows });
  const row = (o) => ({ key: o.key, name: o.name, position: o.pos || 'WR', team: o.team || 'AAA',
    consensusRank: o.cr, consensusPts: o.cp, ironTunaRank: o.ir, ironTunaPts: o.ip, vegasRank: 10, vegasPts: 12 });
  const scored = (pairs) => new Map(pairs.map(([key, points]) => [key, { points, line: 'a line' }]));
  const G = (id, dow, status, away, home) => ({ id, type: 'REG', dow, status, away, home, state: { status: status === 'final' ? 'completed' : 'upcoming' } });
  const games = [G('thu', 'Thu', 'final', 'AAA', 'BBB'), G('e1', 'Sun', 'final', 'CCC', 'DDD'), G('snf', 'Sun', 'final', 'EEE', 'FFF'), G('mnf', 'Mon', null, 'GGG', 'HHH')];
  // Thursday: a big hit (margin 12, gap 11) and a small one (margin 3, gap 7).
  const thu = H._vindication(frz([row({ key: 'a|WR', name: 'Al Big', cr: 24, cp: 10, ir: 13, ip: 18 }), row({ key: 'b|WR', name: 'Bo Small', cr: 20, cp: 10, ir: 13, ip: 18 })]), scored([['a|WR', 22], ['b|WR', 13]]), 1);
  // The early game: a hit bigger than Thursday's (margin 15) and a miss.
  const e1 = H._vindication(frz([row({ key: 'c|RB', name: 'Cy Huge', pos: 'RB', team: 'CCC', cr: 20, cp: 10, ir: 8, ip: 16 }), row({ key: 'd|WR', name: 'Di Miss', team: 'DDD', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored([['c|RB', 25], ['d|WR', 4]]), 1);
  const ctx = { weekNumber: 1, next: { players: [{ key: 'c|RB', ironTuna: { rank: 5, points: 17 }, consensus: { rank: 9, points: 14 }, weeks: [{ opponent: 'ZZZ' }], injury: null }] } };
  const entries = [{ game: games[0], calledIt: thu }, { game: games[1], calledIt: e1 }, { game: games[2], calledIt: H._vindication(null, new Map(), 1) }];
  const p = H.packetCalledItWeek(games, entries, ctx);

  ok('the record adds up the whole week, from the counts and not the trimmed lists', p.record && p.record.games === 2 && p.record.calls === 4 && p.record.hits === 3 && p.record.misses === 1 && p.record.hitRate === 75, JSON.stringify(p.record));
  ok('the wins are ranked across games, biggest margin first', p.biggestWins.map(w => w.name).join() === 'Cy Huge,Al Big,Bo Small', p.biggestWins.map(w => w.name + ':' + w.margin).join());
  ok('each win names the game it was made on', p.biggestWins.every(w => /\sat\s/.test(w.game) && w.day) && p.biggestWins[0].game === 'CCC at DDD');
  ok('the biggest win clears the headline bar and leads', p.headlineWin && p.headlineWin.name === 'Cy Huge');
  ok('a win carries the player\'s row on the coming week\'s board where there is one', p.biggestWins[0].nextWeek && p.biggestWins[0].nextWeek.ironTunaRank === 5 && p.biggestWins[0].nextWeek.opponent === 'ZZZ' && p.biggestWins[1].nextWeek === null);
  ok('the misses ride along', p.misses.length === 1 && p.misses[0].name === 'Di Miss' && p.misses[0].game === 'CCC at DDD');
  ok('a game with no frozen board and the Monday game are named as not covered, with the reason', p.notCovered.length === 2 && p.notCovered.find(n => n.game === 'EEE at FFF' && /frozen/.test(n.reason)) && p.notCovered.find(n => n.game === 'GGG at HHH' && /not yet played/.test(n.reason)), JSON.stringify(p.notCovered));
  ok('a Monday game already final is still not covered here: its own recap grades it', (() => {
    const q = H.packetCalledItWeek([games[0], { ...games[3], status: 'final', state: { status: 'completed' } }], [{ game: games[0], calledIt: thu }], ctx);
    return q.notCovered.length === 1 && /own recap/.test(q.notCovered[0].reason);
  })());
  ok('the games covered are listed with their own counts', p.gamesCovered.length === 2 && p.gamesCovered.find(g => g.game === 'AAA at BBB').hits === 2 && p.gamesCovered.find(g => g.game === 'CCC at DDD').misses === 1);
  ok('hits and misses are counted by position', p.byPosition.WR.hits === 2 && p.byPosition.WR.misses === 1 && p.byPosition.RB.hits === 1);
  ok('the misses section is asked for only when there was a miss', H.sectionsFor('what-tuna-got-right', 'weekly', p).includes('whatWeMissed') && !H.sectionsFor('what-tuna-got-right', 'weekly', { record: { misses: 0 } }).includes('whatWeMissed'));
  ok('the DFS lens shares the record and the wins', H.sectionsFor('what-tuna-got-right', 'dfs', p).includes('biggestWins') && H.sectionsFor('what-tuna-got-right', 'dfs', p).includes('theRecord'));
  ok('the headline bar is the recap\'s: a week of small wins leads plainly', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(frz([row({ key: 'b|WR', name: 'Bo Small', cr: 20, cp: 10, ir: 13, ip: 18 })]), scored([['b|WR', 13]]), 1) }], ctx);
    return q.biggestWins.length === 1 && q.headlineWin === null;
  })());
  ok('no frozen board and no published recommendation: nothing to grade, nothing runs', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctx);
    return q.skip === true && q.reason === 'no_record';
  })());
  ok('calls that all missed do not make a scorecard', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[1], calledIt: H._vindication(frz([row({ key: 'd|WR', name: 'Di Miss', cr: 24, cp: 10, ir: 13, ip: 18 })]), scored([['d|WR', 4]]), 1) }], ctx);
    return q.skip === true && q.reason === 'nothing_landed';
  })());
  ok('the lists are cut for the writer, the record is not', (() => {
    const rows = [], sc = [];
    for (let i = 0; i < 12; i++) { rows.push(row({ key: 'w' + i + '|WR', name: 'Win Number' + i, cr: 24, cp: 10, ir: 13, ip: 18 })); sc.push(['w' + i + '|WR', 12 + i]); }
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(frz(rows), scored(sc), 1) }], ctx);
    return q.record.hits === 12 && q.biggestWins.length <= H.WEEK_WINS_MAX;
  })());
  ok('the writer is told the record, the order and the misses, and offered YOU\'RE WELCOME only for a headline-sized win', (() => {
    const packet = { meta: { kind: 'what-tuna-got-right', analyst: 'mercer', dfsAnalyst: 'park' }, ...p };
    const v = H._voiceBlock(packet);
    const q = { meta: { kind: 'what-tuna-got-right', analyst: 'mercer', dfsAnalyst: 'park' }, ...H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(frz([row({ key: 'b|WR', name: 'Bo Small', cr: 20, cp: 10, ir: 13, ip: 18 })]), scored([['b|WR', 13]]), 1) }], ctx) };
    const w = H._voiceBlock(q);
    return /3 of 4 landed across 2 games \(75%\)/.test(v) && /biggest first/.test(v) && /THE MISSES/.test(v) && /YOU'RE WELCOME:/.test(v) && /Cy Huge/.test(v)
      && /NO MISSES/.test(w) && /NO SINGLE WIN/.test(w) && !/YOU'RE WELCOME:" and then/.test(w);
  })());
  // The reader that feeds the other half. It is the one new query, so it is
  // exercised against a fake D1 rather than only through a hand-built packet.
  await (async () => {
    const C = (o) => ({ id: o.id, season: 2026, week: o.week || 1, analyst: o.analyst || 'raines', player_key: o.key, player: o.name,
      team: 'AAA', position: 'WR', kind: o.kind || 'pickup-advisor', slug: o.slug || 'pa-1', lens: 'weekly',
      direction: o.dir || 'start', recommendation: 'x', confidence: 'HIGH', rationale: 'r', outcome: o.outcome || null, created_at: o.id });
    const CALLS = [
      C({ id: 1, key: 'r1|WR', name: 'Stu Story' }),
      C({ id: 2, key: 'r1|WR', name: 'Stu Story' }),                                  // the same call, re-stored on the slug
      C({ id: 3, key: 'h1|TE', name: 'Hal Hold', dir: 'hold' }),                      // makes no claim about one Sunday
      C({ id: 4, key: 's1|RB', name: 'Sta Sher', dir: 'stash' }),
      C({ id: 5, key: 'g1|WR', name: 'Gam Erecap', kind: 'game-recap', slug: 'gr-1', dir: 'buy' }),
      C({ id: 6, key: 'n1|WR', name: 'Nex Tweek', week: 2, slug: 'pa-2' }),           // another week
      C({ id: 7, key: 'v1|WR', name: 'Riv Alry', kind: H.RIVALRY_COLUMN_KIND, slug: 'rc-1' })
    ];
    const PIECES = [{ slug: 'pa-1', status: 'published', title: 'Pickup Advisor · Week 1', headline: 'Adds', game_id: null },
                    { slug: 'gr-1', status: 'published', title: 'AAA at BBB · Week 1', headline: 'A game', game_id: '2026-01-aaa-bbb' }];
    const env = { LEADS_DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => {
      if (!/FROM analyst_calls c LEFT JOIN content_pieces p/.test(sql)) throw new Error('unexpected: ' + sql.slice(0, 40));
      if (/outcome IS NOT NULL/.test(sql)) throw new Error('the Monday scorecard must not wait for the Tuesday grader');
      const piece = (slug) => PIECES.find(x => x.slug === slug) || {};
      return { results: CALLS.filter(c => c.season === a[0] && c.week === a[1] && c.kind !== a[2]).sort((x, y) => x.created_at - y.created_at)
        .map(c => ({ ...c, piece_title: piece(c.slug).title || null, piece_headline: piece(c.slug).headline || null, piece_game: piece(c.slug).game_id || null })) };
    } }) }) } };
    const got = await H.weekPublishedCalls(env, 2026, 1);
    ok('the week\'s published recommendations come back, one per player per story', got.rows.length === 2 && got.rows.map(r => r.name).join() === 'Stu Story,Gam Erecap', JSON.stringify(got.rows.map(r => r.name)));
    ok('it does not wait on the ledger\'s Tuesday grader: an ungraded row still comes back', got.rows.every(r => r.ledgerOutcome === null));
    ok('a hold and a stash are held off the week\'s record entirely', got.held === 2 && !got.rows.some(r => /Hold|Sher/.test(r.name)));
    ok('the rivalry column is not on this record: it is graded on rank in its own column', !got.rows.some(r => r.kind === H.RIVALRY_COLUMN_KIND));
    ok('another week is not on it either', !got.rows.some(r => r.name === 'Nex Tweek'));
    ok('each one names its story, its analyst and a URL that resolves', got.rows[0].story === 'Pickup Advisor' && got.rows[0].analystName === 'Mike Raines' && got.rows[0].url === '/in-season/desk/pickup-advisor/1'
      && got.rows[1].url === '/in-season/desk/game-recap/1/2026-01-aaa-bbb', JSON.stringify(got.rows.map(r => r.url)));
    ok('the stories are counted, not the calls', got.stories === 2);
    ok('a database that is not there is not an error, it is an empty record', (await H.weekPublishedCalls({}, 2026, 1)).rows.length === 0 && (await H.weekPublishedCalls(env, 2026, null)).rows.length === 0);
  })();

  ok('a story call is settled on the same two numbers a board call is: actual against that week\'s consensus', (() => {
    const g = H.gradeStoryCall({ direction: 'start' }, 22, 12), b = H.gradeStoryCall({ direction: 'fade' }, 4, 12);
    const m = H.gradeStoryCall({ direction: 'start' }, 4, 12), p2 = H.gradeStoryCall({ direction: 'start' }, 12.5, 12);
    return g.outcome === 'hit' && g.margin === 10 && b.outcome === 'hit' && b.margin === 8 && m.outcome === 'miss' && m.margin === -8 && p2.outcome === 'push';
  })());
  ok('no box score or no consensus number is not a miss, it is not graded', H.gradeStoryCall({ direction: 'start' }, null, 12) === null && H.gradeStoryCall({ direction: 'start' }, 20, null) === null && H.gradeStoryCall({ direction: 'hold' }, 20, 12) === null);

  // ── the other half: what the STORIES told the reader to do ──────────────
  // `analyst_calls` holds one row per position a published piece took and
  // runCallsGrade settles each against the week's actual points. The
  // scorecard grades those alongside the board's own calls, in one ranked
  // list, so the Monday piece covers the recommendations a reader acted on
  // and not only the model's numbers.
  const rec = (o) => ({ source: 'story', key: o.key, name: o.name, player: o.name, position: o.pos || 'WR', team: o.team || 'AAA',
    analyst: o.analyst || 'raines', analystName: o.analystName || 'Mike Raines', kind: o.kind || 'pickup-advisor', slug: 's-' + o.name,
    story: o.story || 'Pickup Advisor', direction: o.dir || 'start', recommendation: o.rec || 'start him', confidence: 'HIGH' });

  // The week's box scores, keyed the way the board keys a player: exactly
  // what the recaps handed back, and what the story half is graded on.
  const box = new Map([
    ['r1|WR', { points: 27, line: 'a line' }], ['r2|RB', { points: 3, line: 'a line' }],
    ['r3|WR', { points: 2, line: 'a line' }], ['r4|TE', { points: 10.5, line: 'a line' }],
    ['r5|WR', { points: 30, line: 'a line' }]
  ]);
  // ...and that week's consensus numbers for them, off the board the piece
  // already holds.
  const wk = { players: [
    { key: 'r1|WR', consensus: { points: 13 } }, { key: 'r2|RB', consensus: { points: 11 } },
    { key: 'r3|WR', consensus: { points: 14 } }, { key: 'r4|TE', consensus: { points: 10 } }
  ] };
  const ctxS = { ...ctx, week: wk };
  const recs = { stories: 2, held: 1, rows: [
    rec({ key: 'r1|WR', name: 'Stu Story', team: 'AAA' }),
    rec({ key: 'r2|RB', name: 'Fay Fade', pos: 'RB', team: 'CCC', dir: 'fade', rec: 'leave him on the bench', analyst: 'park', analystName: 'Lena Park', kind: 'trade-desk', story: 'The Trade Desk' }),
    rec({ key: 'r3|WR', name: 'Wes Wrong', team: 'DDD' }),
    rec({ key: 'r4|TE', name: 'Pip Push', pos: 'TE', team: 'AAA' }),
    rec({ key: 'r5|WR', name: 'Noc Onsensus', team: 'AAA' })
  ] };
  const pr = H.packetCalledItWeek(games, entries, ctxS, recs, box);

  ok('the story recommendations are counted as their own record, beside the board\'s', pr.record.storyCalls === 4 && pr.record.storyHits === 2 && pr.record.storyMisses === 1 && pr.record.storyPushes === 1 && pr.record.storyHitRate === 67 && pr.record.stories === 2, JSON.stringify(pr.record));
  ok('the board\'s own record is untouched by them', pr.record.games === 2 && pr.record.calls === 4 && pr.record.hits === 3 && pr.record.hitRate === 75);
  ok('the combined rate leaves the pushes out: a push decided nothing', pr.record.totalCalls === 8 && pr.record.totalHits === 5 && pr.record.totalHitRate === 71, JSON.stringify({ c: pr.record.totalCalls, h: pr.record.totalHits, r: pr.record.totalHitRate }));
  ok('a hold is held off the record, and a call with no consensus number is counted out rather than scored a miss', pr.record.heldPositions === 1 && pr.record.ungraded === 1);
  ok('both kinds of win rank in ONE list, on the points the call beat its number by', pr.biggestWins.map(w => w.name).join() === 'Cy Huge,Stu Story,Al Big,Fay Fade,Bo Small', pr.biggestWins.map(w => w.name + ':' + w.margin).join());
  ok('every win says which kind it is, and a story win names the story and the analyst', (() => {
    const b = pr.biggestWins.find(w => w.name === 'Cy Huge'), t = pr.biggestWins.find(w => w.name === 'Stu Story');
    return b.source === 'board' && b.story === null && t.source === 'story' && t.story === 'Pickup Advisor' && t.analystName === 'Mike Raines' && t.recommendation === 'start him';
  })());
  ok('a story win carries the numbers that settle it', (() => {
    const t = pr.biggestWins.find(w => w.name === 'Stu Story');
    return t.actual === 27 && t.benchmark === 13 && t.margin === 14 && t.outcome === 'hit';
  })());
  // Four stories can make the same call on the same back, and the board can
  // have made it too. That is one win with four pieces of evidence.
  ok('ONE ROW PER PLAYER: the same call in several stories is one win, with the rest named on it', (() => {
    const many = { stories: 3, held: 0, rows: [
      rec({ key: 'r1|WR', name: 'Stu Story', team: 'AAA' }),
      { ...rec({ key: 'r1|WR', name: 'Stu Story', team: 'AAA' }), slug: 's-pickup-2', story: 'Last-Minute Intel', analyst: 'park', analystName: 'Lena Park' },
      { ...rec({ key: 'r1|WR', name: 'Stu Story', team: 'AAA' }), slug: 's-pickup-3', story: 'The Trade Desk' },
      rec({ key: 'r2|RB', name: 'Fay Fade', pos: 'RB', team: 'CCC', dir: 'fade', rec: 'bench him' })
    ] };
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, many, box);
    const stu = q.biggestWins.filter(w => w.name === 'Stu Story');
    return stu.length === 1 && stu[0].callCount === 3 && stu[0].alsoCalledIn.length === 2
      && stu[0].alsoCalledIn.map(x => x.calledIn).sort().join() === 'Last-Minute Intel,The Trade Desk'
      && q.biggestWins.length === 2
      // the record still counts every published position: the desk published them
      && q.record.storyCalls === 4 && q.record.storyHits === 4;
  })());
  ok('a player the board AND a story were both right about is one win, the louder claim leading', (() => {
    // Cy Huge is a board hit at margin 15; a story called him too, smaller.
    const both = { stories: 1, held: 0, rows: [{ ...rec({ key: 'c|RB', name: 'Cy Huge', pos: 'RB', team: 'CCC' }), story: 'Pickup Advisor' }] };
    const wk2 = { players: wk.players.concat([{ key: 'c|RB', consensus: { points: 14 } }]) };
    const q = H.packetCalledItWeek(games, entries, { ...ctx, week: wk2 }, both, new Map([['c|RB', { points: 25 }]]));
    const cy = q.biggestWins.filter(w => w.name === 'Cy Huge');
    return cy.length === 1 && cy[0].source === 'board' && cy[0].margin === 15 && cy[0].callCount === 2
      && cy[0].alsoCalledIn.length === 1 && cy[0].alsoCalledIn[0].source === 'story' && cy[0].alsoCalledIn[0].calledIn === 'Pickup Advisor';
  })());
  ok('the writer is told never to give a player a second row', /ONE ROW PER PLAYER/.test(H._voiceBlock({ meta: { kind: 'what-tuna-got-right', analyst: 'mercer', dfsAnalyst: 'park' }, ...pr })));
  ok('a story win names the game its player actually played', pr.biggestWins.find(w => w.name === 'Stu Story').game === 'AAA at BBB' && pr.biggestWins.find(w => w.name === 'Fay Fade').game === 'CCC at DDD');
  ok('a fade that held a player under his number is a win of the size it beat it by', pr.biggestWins.find(w => w.name === 'Fay Fade').margin === 8);
  ok('the misses mix both kinds too, widest first', pr.misses.map(m => m.name).join() === 'Wes Wrong,Di Miss' && pr.misses[0].source === 'story', pr.misses.map(m => m.name + ':' + m.margin).join());
  ok('a wrong story call still counts by position', pr.byPosition.WR.misses === 2 && pr.byPosition.RB.hits === 2);
  ok('the record is broken out by story and by analyst', (() => {
    const st = pr.byStory.find(x => x.story === 'Pickup Advisor'), a = pr.byAnalyst.find(x => x.analyst === 'Lena Park');
    return st && st.calls === 3 && st.hits === 1 && st.misses === 1 && st.pushes === 1 && a && a.calls === 1 && a.hits === 1;
  })());
  ok('a week with no frozen board anywhere still runs on the stories alone', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, recs, box);
    return !q.skip && q.record.games === 0 && q.record.storyHits === 2 && q.biggestWins.length === 2 && q.biggestWins[0].name === 'Stu Story';
  })());
  ok('a week whose only wrong call was a story call still gets a misses section', (() => {
    const only = { stories: 1, held: 0, rows: [recs.rows[0], recs.rows[2]] };
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, only, box);
    return H.sectionsFor('what-tuna-got-right', 'weekly', q).includes('whatWeMissed');
  })());
  ok('stories that all missed do not make a scorecard either', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, { stories: 1, held: 0, rows: [recs.rows[2]] }, box);
    return q.skip === true && q.reason === 'nothing_landed';
  })());
  ok('a call the morning cannot settle is never guessed at', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, { stories: 1, held: 0, rows: [recs.rows[4]] }, box);
    return q.skip === true && q.reason === 'no_record';
  })());
  ok('and neither is one with no box-score line at all', (() => {
    const q = H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, { stories: 1, held: 0, rows: [recs.rows[0]] }, new Map());
    return q.skip === true && q.reason === 'no_record';
  })());
  ok('a big enough story win can lead the piece, and the writer is told it is a story call', (() => {
    const q = { meta: { kind: 'what-tuna-got-right', analyst: 'mercer', dfsAnalyst: 'park' },
                ...H.packetCalledItWeek(games, [{ game: games[0], calledIt: H._vindication(null, new Map(), 1) }], ctxS, recs, box) };
    const v = H._voiceBlock(q);
    return q.headlineWin.name === 'Stu Story' && q.headlineWin.source === 'story'
      && /STORY call, not a board call/.test(v) && /Mike Raines published/.test(v) && /Pickup Advisor/.test(v) && /consensus had him at 13 points/.test(v);
  })());
  ok('the writer is given both records separately and told to print both', (() => {
    const v = H._voiceBlock({ meta: { kind: 'what-tuna-got-right', analyst: 'mercer', dfsAnalyst: 'park' }, ...pr });
    return /BOARD CALLS:/.test(v) && /STORY CALLS:/.test(v) && /3 of 4 landed across 2 games \(75%\)/.test(v)
      && /2 of 3 decided calls landed \(67%\)/.test(v) && /TOGETHER: 5 of 8 \(71%/.test(v)
      && /1 published position is not on this record at all/.test(v) && /1 more could not be settled/.test(v) && /source "story"/.test(v);
  })());
  ok('the analysts a story win credits are named people for the piece, so the fact check does not hold the draft', (() => {
    const packet = H._finishBrief({ meta: { kind: 'what-tuna-got-right', lens: 'both', analyst: 'mercer', dfsAnalyst: 'park' }, ...pr });
    return packet.allowed.names.includes('Mike Raines') && packet.allowed.names.includes('Stu Story');
  })());

  ok('the fact check asks the scorecard for its sections and holds a draft without them', (() => {
    const packet = H._finishBrief({ meta: { kind: 'what-tuna-got-right', lens: 'both', analyst: 'mercer', dfsAnalyst: 'park' }, ...p });
    packet.allowed.analysts = ['Jack Mercer', 'Lena Park'];
    const full = { headline: 'Cy Huge is the week', dek: 'x', dfsHeadline: 'Cy Huge is the price', dfsDek: 'x', weekly: Object.fromEntries(H.sectionsFor('what-tuna-got-right', 'weekly', packet).map(k => [k, ['Cy Huge scored 25.']])), dfs: Object.fromEntries(H.sectionsFor('what-tuna-got-right', 'dfs', packet).map(k => [k, ['Cy Huge scored 25.']])) };
    const missing = { ...full, weekly: { theRecord: ['Cy Huge scored 25.'] } };
    return H.factCheck(full, packet).ok && H.factCheck(missing, packet).problems.some(x => /missing:weekly.biggestWins/.test(x));
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

console.log('\na forward piece leaves the feed when its games kick off');
{
  // One week: a Thursday game, three at one o'clock, a late game, Sunday
  // night and Monday night. The feed says final three and a half hours after
  // kickoff, as the dry run's fixture does; before that the clock decides.
  const T = (d, h, m) => Date.UTC(2026, 8, d, h + 4, m || 0); // September 2026 is EDT
  const G = (id, d, h, m, away, home) => ({ id, type: 'REG', week: 1, kickoff: T(d, h, m), away, home, status: null });
  const GAMES = [G('thu', 10, 20, 15, 'AAA', 'BBB'), G('e1', 13, 13, 0, 'CCC', 'DDD'), G('e2', 13, 13, 0, 'EEE', 'FFF'), G('e3', 13, 13, 0, 'GGG', 'HHH'),
                 G('late', 13, 16, 25, 'III', 'JJJ'), G('snf', 13, 20, 20, 'KKK', 'LLL'), G('mnf', 14, 20, 15, 'MMM', 'NNN')];
  const schedAt = (now, tweak) => ({ season: 2026, games: GAMES.map(x => ({ ...x, status: now >= x.kickoff + 3.5 * 3600000 ? 'final' : null, ...((tweak && tweak[x.id]) || {}) })) });
  const at = { thuAm: T(10, 9), thuNight: T(10, 20, 30), friAm: T(11, 9), sunNoon: T(13, 12), sunEarly: T(13, 13, 5), sunLate: T(13, 16, 30), sunNight: T(13, 20, 30), monAm: T(14, 9), monLate: T(14, 22), tueAm: T(15, 9) };
  const row = (kind, published_at, extra) => ({ kind, week: 1, season: 2026, status: 'published', published_at, created_at: published_at, ...(extra || {}) });
  const stale = (r, when, tweak) => H.pieceExpired(r, schedAt(when, tweak), when);
  const fresh = (r, when, tweak) => !stale(r, when, tweak);
  // The rule each kind falls under, read off the same flags contentDue uses.
  const want = { 'last-minute-intel': 'all-started', 'tnf-preview': 'any-started', 'mnf-preview': 'any-started', 'weekend-preview': 'any-started',
                 'underrated': 'slate', 'trade-desk': 'slate', 'kickers-defenses': 'slate', 'breaking': 'slate',
                 'tnf-what-matters': 'never', 'game-recap': 'never', 'what-sunday-taught-us': 'never', 'what-tuna-got-right': 'never', 'quarterback-monday': 'never',
                 'ros-rankings': 'never', 'tailback-tuesday': 'never', 'pickup-advisor': 'never', 'wideout-wednesday': 'never', 'tight-end-thursday': 'never' };
  ok('every package on the calendar falls under one of the four rules', Object.keys(H.CONTENT_KINDS).every(k => ['never', 'all-started', 'any-started', 'slate'].includes(H._staleRule(H.CONTENT_KINDS[k]))));
  ok('and each under the one its readiness flag implies', Object.entries(want).every(([k, r]) => H._staleRule(H.CONTENT_KINDS[k]) === r), Object.keys(want).filter(k => H._staleRule(H.CONTENT_KINDS[k]) !== want[k]).map(k => k + '=' + H._staleRule(H.CONTENT_KINDS[k])).join());
  ok('a kind that waits for its games to go final is about them, not ahead of them', H._staleRule(H.CONTENT_KINDS['tnf-what-matters']) === 'never');
  const wp = row('weekend-preview', T(11, 7));
  ok('the weekend preview is current on Friday and at Sunday noon', fresh(wp, at.friAm) && fresh(wp, at.sunNoon));
  ok('and leaves the feed the moment the first Sunday game kicks off', stale(wp, at.sunEarly) && stale(wp, at.sunNight) && stale(wp, at.monAm) && stale(wp, at.tueAm));
  const lmi = row('last-minute-intel', T(13, 12, 15));
  ok('the pre-kickoff intel stays while a Sunday game is still to come', fresh(lmi, at.sunEarly) && fresh(lmi, at.sunLate));
  ok('and leaves once the night game has kicked off', stale(lmi, at.sunNight) && stale(lmi, at.monAm));
  ok('a postponed night game does not hold it on the page', stale(lmi, at.sunLate, { snf: { status: 'postponed' } }));
  const mnf = row('mnf-preview', T(14, 6));
  ok('the Monday preview is current Monday morning and gone at kickoff', fresh(mnf, at.monAm) && stale(mnf, at.monLate) && stale(mnf, at.tueAm));
  const tnf = row('tnf-preview', T(10, 6));
  ok('the Thursday preview is current Thursday morning and gone by Friday', fresh(tnf, at.thuAm) && stale(tnf, at.thuNight) && stale(tnf, at.friAm));
  const twm = row('tnf-what-matters', T(11, 6));
  ok('Thursday Night: What Matters is about a played game and never expires', fresh(twm, at.friAm) && fresh(twm, at.sunNight) && fresh(twm, at.tueAm));
  const kd = row('kickers-defenses', T(11, 8));
  ok('the Friday streamers are current until the Sunday slate is under way', fresh(kd, at.friAm) && fresh(kd, at.sunNoon) && stale(kd, at.sunEarly) && stale(kd, at.monAm));
  const und = row('underrated', T(10, 7));
  ok('a Thursday-morning piece is not judged by the Thursday game alone', fresh(und, at.thuNight) && fresh(und, at.sunNoon));
  ok('but is once half the games it was written ahead of have kicked off', stale(und, at.sunEarly) && stale(und, at.tueAm));
  const brkSun = row('breaking', T(13, 11));
  ok('a Sunday-morning scratch is news until the one o\'clock games', fresh(brkSun, at.sunNoon) && stale(brkSun, at.sunEarly));
  const brkMon = row('breaking', T(14, 21));
  ok('breaking news during the Monday game lasts as long as its week', fresh(brkMon, at.monLate) && stale(brkMon, at.tueAm));
  ok('what happened never expires', [row('game-recap', T(13, 16, 30), { game_id: 'e1' }), row('what-sunday-taught-us', T(13, 19, 30)), row('what-tuna-got-right', T(14, 6)), row('ros-rankings', T(15, 7)), row('pickup-advisor', T(16, 6))].every(r => fresh(r, at.tueAm) && fresh(r, T(20, 9))));
  ok('with no schedule there is no judgement and the piece stays', !H.pieceExpired(wp, null, at.tueAm));
  ok('a legacy kind, a row without a week, and a week with no games all stay', !H.pieceExpired(row('final-read', T(10, 7)), schedAt(at.tueAm), at.tueAm) && !H.pieceExpired({ ...wp, week: null }, schedAt(at.tueAm), at.tueAm) && !H.pieceExpired({ ...wp, week: 9 }, schedAt(at.tueAm), at.tueAm));
}

console.log('\na played-week piece looks forward with next week\'s board');
{
  // Monday morning of Week 1: the clock's week is still 1 (the Monday game
  // is unplayed), so the week board carries Sunday's projections. A piece
  // about the played week must point at Week 2 instead.
  const qb = (name, team, w1, w2) => ({ name, position: 'QB', pos: 'QB', team, key: _oddsNorm(name) + '|QB', roleTrend: null, injury: null, why: null, marketDelta: null,
    ironTuna: { points: w1.it, rank: 0 }, consensus: { points: w1.c, rank: 0 }, vegas: { points: w1.v, rank: 0, basis: 'props', confidence: 'HIGH' },
    weeks: [{ week: 1, opponent: w1.opp, home: true, env: { implied: 27, posted: true }, ironTunaPts: w1.it, consensusPts: w1.c, vegasPts: w1.v, basis: 'props', confidence: 'HIGH' },
            w2.bye ? { week: 2, bye: true } : { week: 2, opponent: w2.opp, home: false, env: { implied: 22, posted: true }, ironTunaPts: w2.it, consensusPts: w2.c, vegasPts: w2.v, basis: 'gamelines', confidence: 'MEDIUM' }] });
  const players = [qb('Justin Passer', 'LAC', { opp: 'KC', it: 20, c: 19, v: 21 }, { opp: 'DEN', it: 17, c: 18, v: 16 }),
                   qb('Jaxson Rookie', 'NYG', { opp: 'WAS', it: 15, c: 14, v: 16 }, { opp: 'DAL', it: 19, c: 17, v: 20 }),
                   qb('Josh Bye', 'BUF', { opp: 'NYJ', it: 22, c: 22, v: 22 }, { bye: true })];
  players.forEach((p, i) => { p.ironTuna.rank = i + 1; p.consensus.rank = i + 1; p.vegas.rank = i + 1; });
  const week = { ok: true, currentWeek: 1, players };
  const next = { ok: true, players };
  const usage = { players: { jp: { name: 'Justin Passer', position: 'QB', team: 'LAC', latest: { week: 1, usage: { targets: 0, carries: 8 }, stats: { passYd: 300, passTD: 2, rushYd: 40 } }, season: { games: 2, targets: 0, carries: 11, points: 40 } } } };
  const base = { week, next, usage, signals: { insights: [] }, depth: { teams: {} }, rules: H.scoringRules('ppr'), dfs: {}, injuriesList: [] };
  ok('asked for the clock\'s week, the forward board is the week board itself', H._forwardRows(base, 1) === players);
  const fwd = H._forwardRows(base, 2);
  ok('asked for the week after, it is built from the next3 board for that week, byes dropped', fwd.length === 2 && fwd.every(r => r.weeks[0].week === 2) && !fwd.some(r => r.name === 'Josh Bye'));
  ok('with Week 2 opponents, not Sunday\'s', fwd.find(r => r.name === 'Justin Passer').weeks[0].opponent === 'DEN' && fwd.find(r => r.name === 'Jaxson Rookie').weeks[0].opponent === 'DAL');
  ok('and ranked by Week 2 points on each of the three boards', fwd.find(r => r.name === 'Jaxson Rookie').ironTuna.rank === 1 && fwd.find(r => r.name === 'Justin Passer').consensus.rank === 1 && fwd.find(r => r.name === 'Jaxson Rookie').vegas.rank === 1);
  ok('a caller that never set a forward board reads the week board, as before', H._fwdPlayers(base) === players && H._fwdPlayers({ ...base, forward: fwd }) === fwd);
  const stale = H.packetQb(base);
  const fresh = H.packetQb({ ...base, forward: fwd, forwardWeek: 2, dfs: {}, dfsNote: 'The DFS slates loaded are Week 1\'s, and that slate has been played.' });
  ok('without the forward board Quarterback Monday would hand the writer Sunday\'s opponents', !stale.skip && stale.quarterbacks.every(q => ['KC', 'WAS', 'NYJ'].includes(q.opponent)));
  ok('with it, every quarterback carries a Week 2 opponent and a Week 2 projection', !fresh.skip && fresh.quarterbacks.length === 2 && fresh.quarterbacks.every(q => ['DEN', 'DAL'].includes(q.opponent)) && fresh.quarterbacks.find(q => q.name === 'Justin Passer').projected === 17);
  ok('the usage evidence is still Week 1\'s actuals', fresh.usageMoves.length === 1 && fresh.usageMoves[0].week === 1 && fresh.usageMoves[0].carries === 8);
  ok('and the packet says which week each number belongs to', fresh.boardWeek === 2 && fresh.week === 1 && /Week 2, the coming week/.test(fresh.boardNote) && /Week 1 actuals/.test(fresh.boardNote));
  ok('the played slate\'s DFS numbers are withheld with the reason', fresh.dfs.available === false && /has been played/.test(fresh.dfs.note));
  const meta = (fw) => ({ meta: { analyst: 'dalton', dfsAnalyst: 'park', storyType: 'retrospective', week: 1, forwardWeek: fw } });
  ok('the writer is told Week 1 has been played and the piece is about Week 2', /WEEKS\. Week 1 has been played and this piece is about what it says for Week 2\./.test(H._voiceBlock(meta(2))) && /never say a player is "projected"/.test(H._voiceBlock(meta(2))));
  ok('and told nothing of the kind when the piece is about the clock\'s own week', !/WEEKS\./.test(H._voiceBlock(meta(1))) && !/WEEKS\./.test(H._voiceBlock({ meta: { analyst: 'porter', dfsAnalyst: 'park', storyType: 'forward', week: 2, forwardWeek: 2 } })));
  // The sample size is the number of weeks played, which the writer used to
  // infer from the week number: the Week 2 rest-of-season piece went out
  // headlined "what two weeks of data confirm" with one week in the books.
  const ros2 = H._voiceBlock({ meta: { analyst: 'brooks', dfsAnalyst: 'park', storyType: 'retrospective', week: 2, forwardWeek: 2, weeksPlayed: 1 } });
  ok('a Week 2 piece about the clock\'s week is told exactly one week has been played', /SAMPLE SIZE\. Exactly one week of regular-season games has been played \(Week 1\)\./.test(ros2), ros2.slice(-400));
  ok('and that the sample is "one week of data", never "two weeks of data"', /"one week of data"/.test(ros2) && /never write "two weeks of data"/.test(ros2));
  const w3 = H._voiceBlock({ meta: { analyst: 'brooks', dfsAnalyst: 'park', storyType: 'retrospective', week: 3, forwardWeek: 3, weeksPlayed: 2 } });
  ok('in Week 3 it is two weeks (Weeks 1 through 2), never three', /Exactly two weeks of regular-season games have been played \(Weeks 1 through 2\)/.test(w3) && /"two weeks of data"/.test(w3) && /never write "three weeks of data"/.test(w3));
  const w1 = H._voiceBlock({ meta: { analyst: 'porter', dfsAnalyst: 'park', storyType: 'forward', week: 1, forwardWeek: 1, weeksPlayed: 0 } });
  ok('before the opener the writer is told no games have been played', /SAMPLE SIZE\. No regular-season games have been played yet\./.test(w1));
  const played1 = H._voiceBlock(meta(2));
  ok('a legacy packet without the count is told nothing about the sample', !/SAMPLE SIZE\./.test(played1));
  ok('the played-week count comes from the subject: Week 1 played is one week, Week 2 current is one week, Week 2 played is two',
     H._weeksPlayed(H.CONTENT_KINDS['what-sunday-taught-us'], 1) === 1 && H._weeksPlayed(H.CONTENT_KINDS['ros-rankings'], 2) === 1 && H._weeksPlayed(H.CONTENT_KINDS['pickup-advisor'], 2) === 1 && H._weeksPlayed(H.CONTENT_KINDS['what-sunday-taught-us'], 2) === 2 && H._weeksPlayed(H.CONTENT_KINDS['ros-rankings'], null) === null);
}

console.log('\nthe Week 1 Tailback Tuesday: "Tailback Tuesday week 1: who earned the role"');
{
  // The headline of a piece about the played week is read days later on a
  // front page that carries no week of its own: bare "week 1" read as stale,
  // and the sentence-case rule had lowercased the W.
  ok('the writer is told a week of the season is a proper noun', /"Week 1", "Week 2", never "week 1"/.test(H.NEWSROOM_SYSTEM));
  const retro = { meta: { analyst: 'brooks', dfsAnalyst: 'park', storyType: 'retrospective', week: 1, forwardWeek: 2 } };
  const vb = H._voiceBlock(retro);
  ok('a retrospective piece is told its headline must say which way it looks', /THE HEADLINE SAYS WHICH WAY IT LOOKS/.test(vb) && /what Week 1 taught/.test(vb) && /Week 2 intel/.test(vb) && /Never a bare "Week 1"/.test(vb));
  ok('and a forward piece is not', !/HEADLINE SAYS WHICH WAY/.test(H._voiceBlock({ meta: { analyst: 'porter', dfsAnalyst: 'park', storyType: 'forward', week: 2, forwardWeek: 2 } })));
  ok('weekCase capitalizes the week', H.weekCase('Tailback Tuesday week 1: who earned the role') === 'Tailback Tuesday Week 1: who earned the role' && H.weekCase('the week 12 slate, week 13 byes') === 'the Week 12 slate, Week 13 byes');
  ok('and leaves the word alone everywhere else', H.weekCase('a week later, this week, weekly') === 'a week later, this week, weekly' && H.weekCase(null) === null && H.weekCase('') === '');
  const fp = (headline, dek) => H.weekFrameProblems({ headline, dek: dek || 'Seven backs logged 20-plus touches.' }, retro.meta);
  ok('a bare Week 1 in a retrospective headline is held as reading like a preview', fp('Tailback Tuesday week 1: who earned the role').length === 1 && /^week:headline names Week 1/.test(fp('Tailback Tuesday week 1: who earned the role')[0]));
  ok('a look back at Week 1 passes', !fp('What Week 1 taught about the backfields').length && !fp('Week 1 in review: who earned the role').length && !fp('After Week 1, the backfields that held').length);
  ok('Week 2 as the subject passes', !fp('Week 2 intel: the backs who earned the role').length && !fp('Gibbs holds the role for Week 2').length);
  ok('a headline with no week in it passes', !fp('Gibbs earned the role and Achane borrowed the stat line').length);
  ok('the dek is checked the same way', fp('Gibbs earned the role', 'Seven backs logged 20-plus touches in week 1.').length === 1 && /^week:dek/.test(fp('Gibbs earned the role', 'Seven backs logged 20-plus touches in week 1.')[0]));
  ok('a forward piece is never held on its own week', !H.weekFrameProblems({ headline: 'Week 2 start/sit', dek: 'Week 2.' }, { storyType: 'forward', week: 2, forwardWeek: 2 }).length && !H.weekFrameProblems({ headline: 'week 1', dek: '' }, { storyType: 'retrospective', week: 1, forwardWeek: 1 }).length);
  const packet = { meta: { kind: 'tailback-tuesday', lens: 'weekly', analyst: 'brooks', dfsAnalyst: 'park', storyType: 'retrospective', week: 1, forwardWeek: 2 }, allowed: { names: ['Jahmyr Gibbs'], numbers: [], analysts: [] } };
  const secs = H.sectionsFor('tailback-tuesday', 'weekly', packet);
  const weekly = Object.fromEntries(secs.map(x => [x, []]));
  const held = H.factCheck({ headline: 'Tailback Tuesday week 1: who earned the role', dek: 'Gibbs led all backs.', weekly }, packet);
  ok('the fact check carries the week problem', !held.ok && held.problems.some(x => /^week:headline/.test(x)));
  ok('and passes the same piece framed as Week 2 intel', H.factCheck({ headline: 'Week 2 intel: Gibbs earned the role', dek: 'Gibbs led all backs.', weekly }, packet).ok);
}

console.log('\nthe Sunday night of Week 1: drafts sent back, slots starved, editions miscounted');
{
  // The name check: a verb or participle before a packet surname is prose.
  const allowed = { names: ['Marvin Harrison', 'Mark Andrews', 'Jonathan Taylor', 'Mike Gesicki', 'Rashod Bateman', 'Alec Pierce'], numbers: ['10.4', '12'] };
  const v = t => H.validateDraft(t, allowed).names;
  ok('"Tied Andrews", "Correlating Taylor" and "Adding Gesicki" are instructions, not people', v('Tied Andrews to Pierce. Correlating Taylor with Bateman. Adding Gesicki everywhere.').length === 0, JSON.stringify(v('Tied Andrews to Pierce. Correlating Taylor with Bateman. Adding Gesicki everywhere.')));
  ok('"Attack Lane" and "Stash Mason" still read as prose off the word list', v('Attack Lane in cash. Stash Mason for a week.').length === 0);
  ok('a person the packet does not carry is still caught', v('Cooper Rush is the story.').includes('Cooper Rush') && v('Trusting Cooper Rush here').length >= 1);
  ok('a participle before a name that is not a packet surname is still a name', v('Blocking Smith all day').includes('Blocking Smith'));
  // The edition a reader can count.
  ok('a title with no trailer is a first edition whatever its version', H._pieceEdition({ title: 'GB at MIN · Week 1', version: 5 }) === 1 && H._pieceEdition({ title: null, version: 3 }) === 1);
  ok('a title carrying the trailer is that edition', H._pieceEdition({ title: 'Last-Minute Intel · Week 1 · update 3', version: 4 }) === 3);
  // The order a tick takes the week's games in.
  const now = 1000000, old = now - 3 * 3600000;
  const g = (id, k) => ({ id, kickoff: k });
  const finals = [g('a', 1), g('b', 2), g('c', 3), g('d', 4), g('e', 5), g('f', 6)];
  const rows = { a: { status: 'published', version: 1 }, b: { status: 'held', body: '{"x":1}', violations: '["name:X"]', version: 2, created_at: old },
                 c: null, d: { status: 'held', body: null, violations: '["The operation was aborted"]', version: 1, created_at: old },
                 e: { status: 'held', body: '{"x":1}', violations: '["name:X"]', version: H.REWRITE_HELD_MAX, created_at: old }, f: null };
  const order = H._perGameOrder(finals, id => rows[id], now).map(x => x.id);
  ok('unwritten games come first, oldest kickoff first', order.slice(0, 2).join() === 'c,f', order.join());
  ok('then the held rows a tick may still retry or rewrite', order.slice(2).join() === 'b,d', order.join());
  ok('a published game and a held draft past the rewrite cap are not visited', !order.includes('a') && !order.includes('e'));
  ok('the cap is finite and above one', Number.isInteger(H.REWRITE_HELD_MAX) && H.REWRITE_HELD_MAX > 1 && H.RECAPS_PER_TICK >= 1);
}

// ── what is on the cover ──────────────────────────────────────────────────
// `coverBand` and `coverFace` in front.html decide the two things on "/" that
// name a player at the top of it: the three cards under "Current from the
// desk", and the hero's photograph. They are lifted out of the page and run
// here rather than driven in a browser, because tools/test-homepage.mjs needs
// Chromium and skips without it.
//
// The rule these pin, learned the hard way over three attempts on 2026-09-18:
// A SUBJECT COMES OFF THE COVER, it does not merely move. Reordering three
// cards changes the order and never the cast, and neither the first nor the
// second attempt touched the hero at all, which was running the widest market
// gap and had been the same man for a day and a half.
{
  const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
  const head = front.indexOf('var COVER_TURN_MS =');
  const tail = front.indexOf('// ── end cover rotation', head);
  if (head < 0 || tail < 0) { console.error('FAIL: the cover rotation block is not in front.html'); process.exit(1); }
  const R = new Function(front.slice(head, tail) + '; return { coverBand, coverFace, coverFaces, coverPick, coverLead, coverSubjects, COVER_TURN_MS, DESK_BAND, HERO_POOL, CARD_POOL };')();
  const { coverBand, coverFace, coverFaces, coverPick, coverLead, coverSubjects } = R;
  const TURN = R.COVER_TURN_MS;
  const at = h => Date.UTC(2026, 8, 18, 12) + h * 3600 * 1000;
  const ids = a => a.map(p => p.headline).join(',');

  // ── the band ────────────────────────────────────────────────────────────
  const feed = 'abcdefghij'.split('').map((id, i) => ({ url: '/p/' + id, headline: id, publishedAt: at(-i) }));

  ok('three cards, not the whole feed', coverBand(feed, at(6)).length === R.DESK_BAND);
  ok('a piece published inside the current turn leads', ids(coverBand(feed, at(0) + TURN / 2)) === 'a,b,c',
    ids(coverBand(feed, at(0) + TURN / 2)));

  const turns = [];
  for (let t = 0; t < 8; t++) turns.push(coverBand(feed, at(4) + t * TURN).map(p => p.headline));
  const sets = turns.map(t => t.slice().sort().join());
  ok('consecutive turns print different stories', sets.every((s2, i) => i === 0 || s2 !== sets[i - 1]), sets.join(' | '));
  ok('each turn takes one story off and puts one on',
    turns.every((t, i) => !i || t.filter(x => turns[i - 1].indexOf(x) < 0).length === 1),
    turns.map(t => t.join('')).join(' '));
  const onCover = turns.filter(t => t.indexOf('a') >= 0).length;
  ok('one story is not on every turn', onCover > 0 && onCover < turns.length, `${onCover}/${turns.length}`);
  ok('the rotation reaches past the three newest', new Set(turns.flat()).size > 3);
  ok('it never prints the same piece twice in one turn', turns.every(t => new Set(t).size === t.length));
  ok('and it stays inside the pool rather than reaching the whole archive',
    [...new Set(turns.flat())].every(x => 'abcdefgh'.includes(x)), [...new Set(turns.flat())].join(','));
  ok('the band is a function of the clock alone', ids(coverBand(feed, at(9))) === ids(coverBand(feed, at(9))));
  ok('one piece is printed as it is', ids(coverBand([feed[0]], at(9))) === 'a');
  ok('an empty feed is empty', coverBand([], at(9)).length === 0);
  ok('a piece with no timestamp does not stop the band',
    coverBand([{ url: '/x', headline: 'x' }, { url: '/y', headline: 'y' }, { url: '/z', headline: 'z' }], at(9)).length === 3);

  // WHICH FEED THE COVER READS. The band drew from /api/content, the archive:
  // every row that is not 'unpublished', one per VERSION. That put five held
  // drafts of one preview on the front page and pushed every other published
  // piece below the cutoff. /api/newsroom is the published feed, deduped by
  // slug, expiry applied — the one /in-season/desk reads.
  ok('the cover reads the published feed', /grab\('\/api\/newsroom/.test(front),
    'front.html must read /api/newsroom for the desk band');
  ok('and never the archive endpoint', !/grab\('\/api\/content/.test(front),
    '/api/content carries held drafts and one row per version');

  // ── the 24-hour floor ───────────────────────────────────────────────────
  // A window that has slid into the older half of the pool can carry nothing
  // from the last day, under a heading that says "Current from the desk". The
  // floor puts the newest recent piece in the last slot when that happens.
  // The fixture above never triggers it: every piece there is hours old, which
  // is the point — the floor must be inert when the feed is fresh.
  {
    const DAY = 24 * 3600 * 1000;
    // One fresh piece, the rest from earlier in the week.
    const stale = ['n', 'o', 'p', 'q', 'r', 's', 't'].map((id, i) => ({
      url: '/p/' + id, headline: id, publishedAt: at(0) - (30 + i * 6) * 3600 * 1000
    }));
    // Two hours old at turn 0, so it is still inside the day eight turns later.
    // An earlier draft of this fixture published it 20 hours before turn 0 and
    // watched it age out mid-run, which is the floor working, not failing.
    const mixed = [{ url: '/p/N', headline: 'N', publishedAt: at(0) - 2 * 3600 * 1000 }].concat(stale);

    const windows = [];
    for (let t = 0; t < 8; t++) windows.push(coverBand(mixed, at(0) + t * TURN).map(p => p.headline));
    ok('every turn carries something from the last 24 hours',
      windows.every(w => w.includes('N')), windows.map(w => w.join('')).join(' '));
    ok('the floor takes the last slot, not the lead',
      windows.every(w => w[0] !== 'N' || w.indexOf('N') === 0), windows.map(w => w.join('')).join(' '));
    ok('the floor never prints the same story twice in one window',
      windows.every(w => new Set(w).size === w.length), windows.map(w => w.join('')).join(' '));
    ok('the rest of the window still rotates under it',
      windows.every((w, i) => !i || w.join() !== windows[i - 1].join()), windows.map(w => w.join('')).join(' '));
    // AT MOST one, not exactly one, and the difference is the floor's own cost.
    // On the turn where the sliding window first reaches the pinned piece on
    // its own, the cast repeats in a new order — [N,n,o] then [n,o,N] — because
    // the piece the floor was holding in the last slot has become the one the
    // rotation would have shown anyway. It happens once per cycle, and the
    // alternative is pinning the newest story to the cover on every turn even
    // when the window is full of current work, which is the complaint this
    // whole section started from.
    ok('and no turn brings more than one new story',
      windows.every((w, i) => !i || w.filter(x => windows[i - 1].indexOf(x) < 0).length <= 1),
      windows.map(w => w.join('')).join(' '));
    ok('the cover is never two identical turns in a row',
      windows.every((w, i) => !i || w.join() !== windows[i - 1].join()),
      windows.map(w => w.join('')).join(' '));
    ok('and over a cycle it still reaches the whole pool',
      new Set(windows.flat()).size === mixed.length, [...new Set(windows.flat())].join(''));

    // Inert when the window already has something fresh.
    const allFresh = 'uvwxyz'.split('').map((id, i) => ({
      url: '/p/' + id, headline: id, publishedAt: at(0) - (2 + i) * 3600 * 1000
    }));
    const before = coverBand(allFresh, at(0) + 3 * TURN).map(p => p.headline);
    ok('a window that is already current is left alone',
      before.join() === ['u', 'v', 'w', 'x', 'y', 'z'].slice(3, 6).join(), before.join());

    // Nothing fresh anywhere: the floor has nothing to insert and must not
    // throw, empty the band, or start repeating a piece.
    const none = coverBand(stale, at(0) + 5 * DAY);
    ok('a feed with nothing fresh still prints three distinct cards',
      none.length === 3 && new Set(none.map(p => p.headline)).size === 3,
      none.map(p => p.headline).join(''));
  }

  // ── the hero's face ─────────────────────────────────────────────────────
  // THE ONE THAT WOULD HAVE CAUGHT THE REAL BUG. The hero took the widest gap
  // on the board and nothing else, so the same player held the cover for as
  // long as he led it, however often the cards underneath him rotated.
  const gaps = 'vwxyz12'.split('').map(n => ({ name: n }));
  const faceAt = t => { const f = coverFace(gaps, null, at(0) + t * TURN); return f && f.name; };
  const faces = [];
  for (let t = 0; t < 6; t++) faces.push(faceAt(t));
  ok('the hero is not the same player every turn', new Set(faces).size > 1, faces.join(','));
  ok('the hero changes on every turn', faces.every((f, i) => !i || f !== faces[i - 1]), faces.join(','));
  ok('the hero comes off the widest gaps, not the whole board',
    faces.every(f => gaps.slice(0, R.HERO_POOL).some(g => g.name === f)), faces.join(','));
  ok('the hero is a function of the clock alone', faceAt(3) === faceAt(3));

  // The Fantasy card's player is never also the hero: one player, one place.
  const skipped = [];
  for (let t = 0; t < 6; t++) { const f = coverFace(gaps, gaps[0], at(0) + t * TURN); skipped.push(f && f.name); }
  ok('the player the Fantasy card names never takes the hero', !skipped.includes('v'), skipped.join(','));
  ok('and skipping him does not empty the hero', skipped.every(Boolean), skipped.join(','));

  ok('no gaps on the board means no face rather than a throw', coverFace([], null, at(1)) === null);
  ok('one gap, and it is the face', (coverFace([gaps[0]], null, at(1)) || {}).name === 'v');
  ok('one gap that is the card’s own player leaves the hero to the desk',
    coverFace([gaps[0]], gaps[0], at(1)) === null);

  // ── the runners-up behind the face ──────────────────────────────────────
  // The picture can fail on a NAME: the player lookup does not carry a face
  // for everybody, and heroPaint was given one name and painted nothing when
  // it could not resolve it. Standing still that was a rare miss on one
  // player. On a clock it is an hour of every day, chosen at random off the
  // board, with no photograph on the cover. The painter walks the pool now.
  const pool = t => coverFaces(gaps, null, at(0) + t * TURN).map(g => g.name);
  ok('the turn’s pick leads the list', pool(2)[0] === faceAt(2), pool(2).join(','));
  ok('and the rest of the pool is behind him',
    pool(2).length === R.HERO_POOL && new Set(pool(2)).size === R.HERO_POOL, pool(2).join(','));
  ok('every turn offers the same cast in a different order',
    [0, 1, 2, 3].every(t => pool(t).slice().sort().join('') === pool(0).slice().sort().join('')),
    pool(0).join(',') + ' / ' + pool(1).join(','));
  ok('the player the Fantasy card names is not in the list either',
    !coverFaces(gaps, gaps[0], at(3)).some(g => g.name === 'v'));
  ok('an empty board offers nobody rather than throwing', coverFaces([], null, at(1)).length === 0);

  // ── the face and the sentence under it ──────────────────────────────────
  // THE HERO RAN ONE PLAYER'S PHOTOGRAPH OVER ANOTHER PLAYER'S NEWS. The desk
  // card took the subject of the piece's FIRST finding and printed the piece's
  // HEADLINE beneath him, two picks off one row with nothing tying them
  // together. On 2026-09-21 that was Nate Adkins's face over "Parker
  // Washington's 43% target share after Week 2 makes him the clearest roster
  // add of the week". `coverSubjects` pairs a face with a line, and the line
  // may not be about anybody else.
  {
    const waivers = {
      headline: 'Parker Washington\u2019s 43% target share after Week 2 makes him the clearest roster add of the week',
      components: [
        { n: 1, player: 'Nate Adkins', headline: 'Nate Adkins is the Denver tight end now' },
        { n: 2, player: 'Parker Washington', headline: 'Parker Washington ran a route on 43% of the dropbacks' }
      ]
    };
    const subs = coverSubjects(waivers);
    ok('the headline goes to the player it names, not to the first finding',
      subs.length > 0 && subs[0].name === 'Parker Washington' && subs[0].line === waivers.headline,
      JSON.stringify(subs[0] || null));
    ok('the other subject is still offered, under his own finding',
      subs.some(s2 => s2.name === 'Nate Adkins' && s2.line === waivers.components[0].headline),
      JSON.stringify(subs));
    ok('nobody is offered twice', new Set(subs.map(s2 => s2.name)).size === subs.length, JSON.stringify(subs));
    // THE RULE, stated against the cast the piece itself names: no face is
    // ever offered with a line about one of the piece's other subjects.
    const cast = waivers.components.map(c => c.player);
    ok('no subject carries a line about one of the others',
      subs.every(s2 => !cast.some(other => other !== s2.name && s2.line.includes(other))),
      JSON.stringify(subs));

    // A headline that names nobody is the desk's own framing of its story, not
    // a mismatch: it belongs to the piece's first subject, which is what the
    // card's own face stamp does with it.
    const framed = coverSubjects({ headline: 'Three lineups the market moved overnight', components: [
      { n: 1, player: 'Puka Nacua', headline: 'a' }, { n: 2, player: 'James Cook', headline: 'b' } ] });
    ok('a headline that names nobody still leads with the piece\u2019s first subject',
      framed.length > 0 && framed[0].name === 'Puka Nacua'
      && framed[0].line === 'Three lineups the market moved overnight', JSON.stringify(framed[0] || null));

    // How the desk actually writes a second reference.
    ok('a surname on its own counts', (coverSubjects({ headline: 'Adkins has the Denver tight end job',
      components: [{ n: 1, player: 'Nate Adkins', headline: 'x' }, { n: 2, player: 'Courtland Sutton', headline: 'y' }] })[0] || {}).name === 'Nate Adkins');
    ok('a suffix and a possessive do not break the match',
      (coverSubjects({ headline: 'Marvin Harrison Jr.\u2019s target share is up',
        components: [{ n: 1, player: 'Trey McBride', headline: 'x' }, { n: 2, player: 'Marvin Harrison Jr.', headline: 'y' }] })[0] || {}).name === 'Marvin Harrison Jr.');
    // A surname two men on the piece answer to is nobody's: the line is not
    // offered with either face rather than guessed at.
    const shared = coverSubjects({ headline: 'Williams is the back to own this week', components: [
      { n: 1, player: 'Kyren Williams', headline: 'Kyren Williams took every goal-line carry' },
      { n: 2, player: 'Javonte Williams', headline: 'Javonte Williams is the Dallas lead back' } ] });
    ok('an ambiguous surname is offered to nobody',
      shared.every(s2 => !/back to own/.test(s2.line)), JSON.stringify(shared));
    ok('and the two are still offered under their own findings',
      shared.length === 2 && shared[0].name === 'Kyren Williams' && shared[1].name === 'Javonte Williams',
      JSON.stringify(shared));

    // A piece the desk broke into no findings names nobody, so it offers no
    // face and the hero falls through to the market gap below it.
    ok('a piece with no findings offers nothing rather than throwing',
      coverSubjects({ headline: 'What Sunday taught us' }).length === 0
      && coverSubjects({}).length === 0 && coverSubjects(null).length === 0);

    // The page must actually use it: the old call site built its candidate
    // from `whoOf(p)[0]` and `p.headline`, which is the bug in one line.
    // The cover hands it the de-boasted headline, so the call carries a
    // second argument: match the call, not one exact spelling of it.
    ok('the desk hero is built from coverSubjects', /coverSubjects\(p[,)]/.test(front));
    ok('and no longer pairs the first finding with the headline',
      !/name:\s*whoOf\(p\)\[0\]/.test(front));
  }

  // ── the two card readings ───────────────────────────────────────────────
  // THE THIRD AND FOURTH PATHS ONTO THE COVER. §88 enumerated two. The Fantasy
  // card took the strongest BUY and the DFS card took bestVegasValues[0], so
  // the cover changed hourly above two readings that did not change all week.
  const rows = 'abcdefg'.split('').map(n => ({ name: n }));
  const pick = t => (coverPick(rows, at(0) + t * TURN) || {}).name;
  const picks = [];
  for (let t = 0; t < 6; t++) picks.push(pick(t));
  ok('a card reading is not the same player every turn', new Set(picks).size > 1, picks.join(','));
  ok('it changes on every turn', picks.every((x, i) => !i || x !== picks[i - 1]), picks.join(','));
  ok('it comes off the leaders, not the whole board',
    picks.every(x => rows.slice(0, R.CARD_POOL).some(r => r.name === x)), picks.join(','));
  ok('it is a function of the clock alone', pick(3) === pick(3));
  ok('a board of one is printed as it is', (coverPick([rows[0]], at(5)) || {}).name === 'a');
  ok('an empty board is no reading rather than a throw', coverPick([], at(5)) === null);

  // A superlative belongs to the leader alone: a caption still claiming the
  // top of the board once the turn has moved off it is simply false.
  ok('the leader is known as the leader', coverLead(rows, rows[0]) === true);
  ok('and a runner-up is not', coverLead(rows, rows[3]) === false);
  ok('an empty board has no leader', coverLead([], undefined) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
