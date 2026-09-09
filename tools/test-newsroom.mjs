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
  cut('// -- kickers and defences, scored', '// -- the player intel payload') + '\n' + cut('// -- the content desk', '// -- DFS ---') + '\n' +
  'return { CONTENT_KINDS, LEGACY_CONTENT, NEWSROOM_SECTIONS, ANALYSTS, RIVALRY_PAIR, NEWSROOM_FLAGS, flagOn, flagReport, freshnessReport, blendComponents, blendPoints, blendBoard, blendDisagreements, dfsMetrics, DFS_CONTESTS, rivalryCandidate, rivalryGate, gradeCall, normaliseCalls, factCheck, scoreNewsEvent, detectNewsEvents, newsroomAudit, contentSubjectWeek, sectionsFor, packetPickups, packetPosition, packetUnderrated, packetKDst, updateWanted, _finishBrief, validateDraft, AI_PHRASES, draftSocialAllowed, newsroomStatus, scoringRules, etParts, ROUTINE_MIGRATION, AI_DISCLOSURE };'
)(etOffsetHours, teamKey, _oddsNorm, _oddsRound, POOL, 'America/New_York', 17, g => Math.max(0, 1 - g / 17), { goalLineCarries: 'pbp' }, stub, stub, 'x', async () => {}, {}, {}, async () => null, stub, async () => null, async () => null, async () => null, async () => null, stub, stub, {}, {}, stub);

console.log('\nthe migration');
{
  const a = H.newsroomAudit(['*/15 * * * *']);
  ok('the calendar audits clean', a.ok, a.problems.join('; '));
  ok('every retired kind is gone from the calendar', ['team-recaps', 'mnf-breakdown', 'what-they-arent-telling-you', 'opportunity-report', 'rankings-update', 'final-read', 'tnf-aftermath', 'weekend-game-plan', 'what-changed-today', 'snf-what-we-learned'].every(k => !H.CONTENT_KINDS[k] && H.LEGACY_CONTENT[k]));
  ok('every retired kind names its destination on the calendar', Object.values(H.LEGACY_CONTENT).every(v => v.destination === 'none' || v.destination === 'data' || v.destination === 'desk-lead' || v.destination === 'the-tell' || H.CONTENT_KINDS[v.destination]));
  ok('every package absorbs what the table says it absorbs', Object.entries(H.LEGACY_CONTENT).filter(([k, v]) => v.disposition === 'merged' && H.CONTENT_KINDS[v.destination]).every(([k, v]) => (H.CONTENT_KINDS[v.destination].absorbs || []).includes(k)));
  ok('two crons that both run the tick are a problem', !H.newsroomAudit(['*/15 * * * *', '0 * * * *']).ok);
  ok('no cron is a problem', !H.newsroomAudit([]).ok);
  ok('sixteen scheduled packages and one unscheduled', Object.values(H.CONTENT_KINDS).filter(k => !k.unscheduled).length === 16 && H.CONTENT_KINDS.breaking.unscheduled === true);
  ok('every package has a primary analyst on the staff and both lenses', Object.values(H.CONTENT_KINDS).every(k => H.ANALYSTS[k.analyst] && k.lens === 'both'));
  ok('the worth-gated pieces are the positional and QB features', ['quarterback-monday', 'tailback-tuesday', 'wideout-wednesday', 'tight-end-thursday'].every(k => H.CONTENT_KINDS[k].gate === 'worth'));
  ok('the Routines table names the two Pick Routines as retired and The Tell as retained', H.ROUTINE_MIGRATION.filter(r => /The Pick/.test(r.name)).every(r => r.disposition === 'retired') && H.ROUTINE_MIGRATION.find(r => /The Tell/.test(r.name)).disposition === 'retained');
  ok('the wrangler triggers are the single quarter-hour tick', /"crons": \["\*\/15 \* \* \* \*"\]/.test(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')));
  ok('the worker still recognises the old social crons and gates them', /draftSocialAllowed\(env\)/.test(cut('  async scheduled(event, env, ctx) {', '\nfunction originAllowed(')));
}

console.log('\nthe staff and the one rivalry');
{
  const A = H.ANALYSTS;
  ok('eight analysts', Object.keys(A).length === 8 && ['mercer', 'vega', 'brooks', 'raines', 'dalton', 'grant', 'porter', 'park'].every(k => A[k]));
  ok('Vega and Brooks are each other\'s rivalry and nobody else has one', A.vega.rivalry === 'brooks' && A.brooks.rivalry === 'vega' && Object.values(A).filter(a => a.rivalry).length === 2);
  ok('every analyst has a voice, a philosophy and assignments', Object.values(A).every(a => a.voice.length > 40 && a.philosophy && a.assignments.length));
  ok('the disclosure says they are AI personas, not people', /AI-powered editorial personas, not people/.test(H.AI_DISCLOSURE));
  const flags = H.flagReport({});
  // The three provider connectors (docs/league-sync.md) default OFF on purpose:
  // Sleeper until its commercial licence is in writing, Yahoo and ESPN until
  // configured. Every other flag is the intended product and defaults on.
  ok('every flag defaults on, except the provider connectors', Object.entries(flags).every(([k, f]) => (f.on || /^(SLEEPER|YAHOO|ESPN)_SYNC$/.test(k)) && f.source === 'default'));
  ok('the provider connectors default off', ['SLEEPER_SYNC', 'YAHOO_SYNC', 'ESPN_SYNC'].every(k => flags[k] && !flags[k].on));
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
  ok('ownership is modelled and labelled', m.rows.every(r => r.ownershipBasis === 'modelled' && r.ownership >= 0 && r.ownership <= 42) && m.ownershipBasis === 'modelled');
  ok('the value play draws more modelled ownership than the tax', B.ownership > C.ownership);
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

console.log('\nanalyst memory');
{
  const packet = H._finishBrief({ meta: { kind: 'trade-desk' }, players: [{ name: 'CeeDee Lamb', team: 'DAL', position: 'WR' }], playerIndex: { 'CeeDee Lamb': { key: 'ceedeelamb|WR', team: 'DAL', position: 'WR' } } });
  const calls = H.normaliseCalls([{ player: 'CeeDee Lamb', direction: 'buy', recommendation: 'trade for him', confidence: 'high', rationale: 'targets', evidence: ['12 targets'] }, { player: 'Jerry Jeudy', direction: 'buy' }, { player: 'CeeDee Lamb', direction: 'moon' }], packet, 'brooks', 'weekly');
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
  ok('with no schedule the guard falls open (preseason behaviour is unchanged)', (await H.draftSocialAllowed({})).ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
