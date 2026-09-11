#!/usr/bin/env node
// The content desk (Steps 18 to 25): the box-score adapter on a real game, the
// gating rules on a fixture week, the briefs, and the validator that holds a
// draft naming anything the brief does not contain.
//   node tools/test-content.mjs
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
const POOL = [
  { name: 'CeeDee Lamb', position: 'WR', team: 'DAL', projectedStats: {} }, { name: 'Javonte Williams', position: 'RB', team: 'DAL', projectedStats: {} },
  { name: 'Saquon Barkley', position: 'RB', team: 'PHI', projectedStats: {} }, { name: 'Jalen Hurts', position: 'QB', team: 'PHI', projectedStats: {} },
  { name: 'Dak Prescott', position: 'QB', team: 'DAL', projectedStats: {} }, { name: 'A.J. Brown', position: 'WR', team: 'PHI', projectedStats: {} },
  { name: 'Dallas Goedert', position: 'TE', team: 'PHI', projectedStats: {} }, { name: 'George Pickens', position: 'WR', team: 'DAL', projectedStats: {} }
];
const H = new Function('etOffsetHours', 'teamKey', '_oddsNorm', '_oddsRound', 'PROJECTIONS', 'LEAD_TZ', 'AVAILABILITY_GAMES', '_availF', 'PROVIDER_UNAVAILABLE', 'fetch', '_csvSplit', 'NFLVERSE_GAMES_URL', 'oddsCacheInit', 'ODDS_CV', 'ODDS_BANDS',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' + cut('function _oddsImpliedProb(', '// The Odds API v4. WRITTEN') + '\n' +
  cut('const MARKET_RIDGE', 'async function fetchTeamEnvNflverse') + '\n' + cut('function _oddsProjectionIndex()', 'function buildVegasOverlay(') + '\n' +
  cut('// ── the NFL season and week ─', '// ── the provider layer ─') + '\n' + cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' +
  cut('// -- kickers and defenses, scored', '// -- the player intel payload') + '\n' + cut('// -- the content desk', '// Memoized per isolate alongside _PROJ_ENC') + '\n' +
  'return { normalizeGameSummary, gameUsageByTeam, contentDue, kindTitle, CONTENT_KINDS, lastPlayedWeek, etParts, nflSeasonState, _oddsProjectionIndex, briefForGames, briefTeamRecaps, briefWtaty, validateDraft, _finishBrief, _nextEt, scoringRules, detectInsights, briefFinalRead, briefGamePlan };'
)(etOffsetHours, teamKey, _oddsNorm, _oddsRound, POOL, 'America/New_York', 17, g => Math.max(0, 1 - g / 17), { goalLineCarries: 'pbp' }, stub, stub, 'x', async () => {}, {}, {});

console.log('\nthe box score, on a real game (2025 Week 1, DAL at PHI)');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/espn-summary-2025-w1-dal-phi.json'), 'utf8'));
const G = H.normalizeGameSummary(raw, H._oddsProjectionIndex());
{
  ok('the game is final', G.final === true && /FINAL/.test(G.status));
  ok('both sides and scores are read', G.home.team === 'PHI' && G.away.team === 'DAL' && Number.isFinite(G.home.score) && Number.isFinite(G.away.score));
  const lamb = G.players.find(p => p.name === 'CeeDee Lamb');
  ok('targets, receptions and yards are counted per player', lamb && lamb.rec.tgt > 0 && lamb.rec.rec > 0 && lamb.rec.yd > 0, JSON.stringify(lamb && lamb.rec));
  ok('the position comes from the board, not the box score', lamb && lamb.position === 'WR');
  const sq = G.players.find(p => p.name === 'Saquon Barkley');
  ok('carries are counted', sq && sq.rush.att > 0);
  ok('red-zone touches are derived from the drives', sq && sq.rzTouches > 0, JSON.stringify(sq && { rz: sq.rzTouches, gl: sq.glCarries }));
  ok('goal-line carries are a subset of red-zone touches', G.players.every(p => p.glCarries <= p.rzTouches));
  const hurts = G.players.find(p => p.name === 'Jalen Hurts');
  ok('passing lines split completions from attempts', hurts && hurts.pass.att > hurts.pass.cmp && hurts.pass.cmp > 0);
  ok('scoring plays land on the scorer', G.players.some(p => p.tds.length && Number.isFinite(p.tds[0].yards)));
  const U = H.gameUsageByTeam(G);
  ok('team target shares sum to about 100', Math.abs(U.DAL.players.reduce((a, p) => a + p.targetShare, 0) - 100) <= 4, String(U.DAL.players.reduce((a, p) => a + p.targetShare, 0)));
  ok('target leaders and the backfield split are listed', U.PHI.targetLeaders.length >= 3 && U.PHI.backfield.length >= 1 && U.PHI.backfield[0].name === 'Saquon Barkley');
  ok('injuries are carried through', Array.isArray(G.injuries));
}

console.log('\nthe calendar');
const ET = (y, m, d, h, mi) => { const g = Date.UTC(y, m - 1, d, h + 5, mi || 0); return g - (etOffsetHours(g) + 5) * 3600000; };
const g = (id, week, y, m, d, h, mi, away, home, status) => ({ id, type: 'REG', week, kickoff: ET(y, m, d, h, mi), away, home, homeScore: null, awayScore: null, spread: 3, total: 44, status: status || null, src: 'f' });
// Week 1: Thu Sep 10, Sun Sep 13 (1pm, 4:25pm, 8:20pm), Mon Sep 14. Week 2: Thu Sep 17, Sun Sep 20, no Monday game.
const games = [
  g('w1-thu', 1, 2026, 9, 10, 20, 20, 'AAA', 'BBB'), g('w1-e1', 1, 2026, 9, 13, 13, 0, 'CCC', 'DDD'), g('w1-e2', 1, 2026, 9, 13, 13, 0, 'EEE', 'FFF'),
  g('w1-late', 1, 2026, 9, 13, 16, 25, 'GGG', 'HHH'), g('w1-snf', 1, 2026, 9, 13, 20, 20, 'III', 'JJJ'), g('w1-mnf', 1, 2026, 9, 14, 20, 15, 'KKK', 'LLL'),
  g('w2-thu', 2, 2026, 9, 17, 20, 15, 'BBB', 'CCC'), g('w2-e1', 2, 2026, 9, 20, 13, 0, 'DDD', 'EEE'), g('w2-snf', 2, 2026, 9, 20, 20, 20, 'FFF', 'GGG'),
  // Week 3 exists so the clock does not read "season complete" after Week 2's last game.
  g('w3-e1', 3, 2026, 9, 27, 13, 0, 'AAA', 'CCC'), g('w3-mnf', 3, 2026, 9, 28, 20, 15, 'BBB', 'DDD')
];
const sched = { season: 2026, games, updatedAt: 1 };
const withStatus = (finalIds) => ({ ...sched, games: games.map(x => ({ ...x, status: finalIds.includes(x.id) ? 'final' : null })) });
const due = (kind, when, finalIds) => { const sc = withStatus(finalIds || []); return H.contentDue(kind, when, H.nflSeasonState(sc, when), sc); };
{
  ok('ET weekday, hour and minute are read', H.etParts(ET(2026, 9, 13, 20, 0)).dow === 'Sun' && H.etParts(ET(2026, 9, 13, 20, 0)).hour === 20 && H.etParts(ET(2026, 9, 13, 12, 15)).minute === 15);
  ok('_nextEt lands on a quarter-hour slot', H.etParts(H._nextEt('Sun', 12, ET(2026, 9, 12, 0, 0), 15)).minute === 15 && H.etParts(H._nextEt('Sun', 12, ET(2026, 9, 12, 0, 0), 15)).hour === 12);
  const wk1 = ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf', 'w1-mnf'];
  // Sunday 12:15 PM, Week 1: Last-Minute Intel, live until the last Sunday kickoff.
  const lmi = due('last-minute-intel', ET(2026, 9, 13, 12, 15), ['w1-thu']);
  ok('Last-Minute Intel is due at 12:15 Sunday and ready while a Sunday game is still to kick off', lmi.due && lmi.ready && lmi.week === 1 && lmi.targets.length === 4, JSON.stringify(lmi));
  ok('and not at noon', !due('last-minute-intel', ET(2026, 9, 13, 12, 0), ['w1-thu']).due);
  ok('and not ready once every Sunday game has started', !due('last-minute-intel', ET(2026, 9, 13, 21, 0), ['w1-thu']).ready && due('last-minute-intel', ET(2026, 9, 13, 21, 0), ['w1-thu']).reason === 'all_games_started');
  // Sunday 7:30 PM: What Sunday Taught Us with the finals it has, updated later.
  const sun = due('what-sunday-taught-us', ET(2026, 9, 13, 19, 35), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late']);
  ok('What Sunday Taught Us is due at 7:30 and ready with the finals it has', sun.due && sun.ready && sun.week === 1, JSON.stringify(sun));
  ok('it covers only the Sunday games that are final', sun.targets.length === 3 && !sun.targets.includes('w1-snf'), JSON.stringify(sun.targets));
  ok('and names the game still being played', sun.excluded.includes('III@JJJ'), JSON.stringify(sun.excluded));
  ok('and carries an update window into Monday morning', sun.updatesUntil === sun.dueAt + 12 * 3600000);
  ok('Sunday 7:15 is not yet due', !due('what-sunday-taught-us', ET(2026, 9, 13, 19, 15), ['w1-e1']).due);
  // Monday 6 AM: the MNF preview, before the game; the early rankings, about NEXT week.
  const mnf = due('mnf-preview', ET(2026, 9, 14, 6, 10), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('the MNF preview is due Monday morning, before kickoff, about the Monday game', mnf.due && mnf.ready && mnf.week === 1 && mnf.targets.join() === 'w1-mnf', JSON.stringify(mnf));
  ok('the Monday after a week with no Monday game, the clock has turned and the preview is simply not due', !due('mnf-preview', ET(2026, 9, 21, 6, 0), ['w2-thu', 'w2-e1', 'w2-snf']).due && due('mnf-preview', ET(2026, 9, 28, 6, 0), ['w2-thu', 'w2-e1', 'w2-snf', 'w3-e1']).due);
  const early = due('early-rankings', ET(2026, 9, 14, 6, 0), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('the early rankings are due Monday 6 AM and are about Week 2 while the clock still says Week 1', early.due && early.ready && early.week === 2 && H.nflSeasonState(withStatus([]), ET(2026, 9, 14, 6, 0)).week.number === 1, JSON.stringify(early));
  ok('and are not due on Sunday night', !due('early-rankings', ET(2026, 9, 13, 23, 0), []).due);
  const qb = due('quarterback-monday', ET(2026, 9, 14, 7, 0), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('Quarterback Monday is due at 7 and is about the played week', qb.due && qb.ready && qb.week === 1);
  // Tuesday: ROS rankings about the coming week; Tailback Tuesday about the played one.
  const ros = due('ros-rankings', ET(2026, 9, 15, 7, 0), wk1);
  ok('ROS rankings are due Tuesday 7 AM about the coming week', ros.due && ros.ready && ros.week === 2, JSON.stringify(ros));
  ok('and not on Monday', !due('ros-rankings', ET(2026, 9, 14, 7, 0), wk1.slice(0, 5)).due);
  const tb = due('tailback-tuesday', ET(2026, 9, 15, 8, 0), wk1);
  ok('Tailback Tuesday is due at 8 about the played week', tb.due && tb.ready && tb.week === 1);
  ok('the ROS piece anchors on Monday night when there is a Monday game, so Tuesday 6:45 is early', !due('ros-rankings', ET(2026, 9, 15, 6, 45), wk1).due);
  // Wednesday.
  const pick = due('pickup-advisor', ET(2026, 9, 16, 6, 0), wk1);
  ok('the Pickup Advisor is due Wednesday 6 AM about the coming week', pick.due && pick.ready && pick.week === 2);
  const wo = due('wideout-wednesday', ET(2026, 9, 16, 8, 0), wk1);
  ok('Wideout Wednesday is due at 8 about the played week', wo.due && wo.ready && wo.week === 1);
  // Thursday: preview before the game, then the forward pieces.
  const prev = due('tnf-preview', ET(2026, 9, 17, 6, 30), wk1);
  ok('the TNF preview is due Thursday 6 AM, before kickoff', prev.due && prev.ready && prev.week === 2 && prev.targets.join() === 'w2-thu', JSON.stringify(prev));
  ok('a preview is not ready once the game has started', !due('tnf-preview', ET(2026, 9, 17, 21, 0), wk1).ready);
  ok('a Thursday-only week keeps the Thursday title', H.kindTitle(H.CONTENT_KINDS['tnf-preview'], prev) === 'Thursday Night Football Preview' && prev.slotDay === 'Thu');
  // A Wednesday opener (2026 opened NE at SEA on Wednesday, SF and the Rams on Thursday).
  const wedGames = games.concat([g('w1-wed', 1, 2026, 9, 9, 20, 20, 'MMM', 'NNN')]);
  const wsched = { season: 2026, games: wedGames, updatedAt: 1 };
  const wdue = (kind, when, finalIds) => { const sc = { ...wsched, games: wedGames.map(x => ({ ...x, status: (finalIds || []).includes(x.id) ? 'final' : null })) }; return H.contentDue(kind, when, H.nflSeasonState(sc, when), sc); };
  const wed = wdue('tnf-preview', ET(2026, 9, 9, 6, 0), []);
  ok('with a Wednesday opener the preview is due Wednesday 6 AM and covers both midweek games', wed.due && wed.ready && wed.week === 1 && wed.slotDay === 'Wed' && wed.targets.slice().sort().join() === 'w1-thu,w1-wed', JSON.stringify(wed));
  ok('and not Tuesday', !wdue('tnf-preview', ET(2026, 9, 8, 23, 45), []).due);
  ok('and is titled for the midweek slate', H.kindTitle(H.CONTENT_KINDS['tnf-preview'], wed) === 'Midweek Kickoff Preview');
  ok('once the Wednesday game has started the preview is no longer ready', !wdue('tnf-preview', ET(2026, 9, 9, 21, 0), []).ready);
  const wafter = wdue('tnf-what-matters', ET(2026, 9, 11, 6, 0), ['w1-wed', 'w1-thu']);
  ok('What Matters runs Friday once both midweek games are final, under a midweek title', wafter.due && wafter.ready && wafter.targets.length === 2 && H.kindTitle(H.CONTENT_KINDS['tnf-what-matters'], wafter) === 'Midweek Football: What Matters', JSON.stringify(wafter));
  ok('and waits while Thursday is still to be played', !wdue('tnf-what-matters', ET(2026, 9, 11, 6, 0), ['w1-wed']).ready);
  const mnfw = wdue('mnf-preview', ET(2026, 9, 14, 6, 10), ['w1-wed', 'w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('the Monday preview is untouched by a Wednesday opener', mnfw.due && mnfw.ready && mnfw.slotDay === 'Mon' && mnfw.targets.join() === 'w1-mnf');
  const wkd = wdue('weekend-preview', ET(2026, 9, 11, 7, 0), ['w1-wed', 'w1-thu']);
  ok('the Weekend Preview on Friday leaves the played midweek games out and is ready', wkd.due && wkd.ready && !wkd.targets.includes('w1-wed') && !wkd.targets.includes('w1-thu') && wkd.targets.includes('w1-e1'), JSON.stringify(wkd));
  ok('Underrated, the Trade Desk and Tight End Thursday follow at 7, 8 and 9', due('underrated', ET(2026, 9, 17, 7, 0), wk1).due && !due('underrated', ET(2026, 9, 17, 6, 45), wk1).due && due('trade-desk', ET(2026, 9, 17, 8, 0), wk1).week === 2 && due('tight-end-thursday', ET(2026, 9, 17, 9, 0), wk1).week === 1);
  // Friday.
  const after = due('tnf-what-matters', ET(2026, 9, 18, 6, 30), wk1.concat(['w2-thu']));
  ok('Thursday Night: What Matters is due Friday 6 AM once the game is final', after.due && after.ready && after.targets.join() === 'w2-thu', JSON.stringify(after));
  ok('and not before it is', !due('tnf-what-matters', ET(2026, 9, 18, 6, 30), wk1).ready);
  const wp = due('weekend-preview', ET(2026, 9, 18, 7, 30), wk1.concat(['w2-thu']));
  ok('the Weekend Preview covers the games still to come', wp.due && wp.ready && !wp.targets.includes('w2-thu') && wp.targets.length === 2, JSON.stringify(wp));
  ok('Kickers & Defenses is due Friday 8 AM', due('kickers-defenses', ET(2026, 9, 18, 8, 0), wk1).due && !due('kickers-defenses', ET(2026, 9, 18, 7, 45), wk1).due);
  // The forward anchor is the week before: a Week 2 Friday piece is not due
  // on the Tuesday the clock turns to Week 2, and a Week 1 opener the
  // schedule stores at midnight does not pull the Week 1 slots a week early.
  ok('a Week 2 forward piece is not due on Tuesday of Week 2', !due('weekend-preview', ET(2026, 9, 15, 9, 0), wk1).due && !due('underrated', ET(2026, 9, 15, 9, 0), wk1).due && !due('kickers-defenses', ET(2026, 9, 16, 9, 0), wk1).due);
  const midnight = (finalIds) => { const sc = withStatus(finalIds || []); sc.games = sc.games.map(x => x.id === 'w1-thu' ? { ...x, kickoff: ET(2026, 9, 10, 0, 0) } : x); return sc; };
  const dm = (kind, when) => { const sc = midnight([]); return H.contentDue(kind, when, H.nflSeasonState(sc, when), sc); };
  ok('a midnight-stored Week 1 opener does not make the Week 1 Friday pieces due the Friday before', !dm('weekend-preview', ET(2026, 9, 8, 15, 0)).due && !dm('kickers-defenses', ET(2026, 9, 8, 15, 0)).due && dm('weekend-preview', ET(2026, 9, 11, 7, 0)).due);
  ok('and the Week 1 Thursday pieces are due on the Thursday, not the Thursday before', !dm('underrated', ET(2026, 9, 3, 8, 0)).due && dm('underrated', ET(2026, 9, 10, 7, 0)).due);
  ok('a breaking piece is never due on the clock', due('breaking', ET(2026, 9, 18, 8, 0), wk1).reason === 'unscheduled');
  ok('nothing is due before a game has been played', !due('what-sunday-taught-us', ET(2026, 9, 1, 12, 0), []).due && !due('early-rankings', ET(2026, 9, 1, 12, 0), []).due);
  ok('nothing is due in the offseason', due('ros-rankings', ET(2026, 5, 1, 12, 0), []).reason === 'not_regular_season');
  ok('an unknown kind is refused', due('team-recaps', ET(2026, 9, 14, 7, 30), wk1).reason === 'unknown_kind');
}

console.log('\nthe briefs');
const week = { ok: true, players: POOL.map((p, i) => ({ key: _oddsNorm(p.name) + '|' + p.position, name: p.name, position: p.position, pos: p.position, team: p.team, games: 1, byes: [],
  consensus: { rank: i + 1, points: 15 - i, stats: {} }, vegas: { rank: i + 1, points: 15 - i, confidence: 'MEDIUM', basis: 'gamelines', stats: {} }, ironTuna: { rank: i + 1, points: 15 - i, confidence: 'MEDIUM', stats: {} },
  marketDelta: { points: i === 0 ? 3 : 0, rank: i === 0 ? 6 : 0, classification: i === 0 ? 'VEGAS LEANS HIGHER' : 'MARKET AGREES', significant: i === 0 }, why: { summary: 'x', drivers: [] }, weeks: [{ opponent: 'XXX', home: true, env: { factor: 1 } }], roleTrend: { label: 'no data' } })) };
const ctx = { sched: { games: [{ type: 'REG', home: 'PHI', away: 'DAL' }] }, week, next: null, depth: { teams: { PHI: { offense: { QB: ['Jalen Hurts'], RB: ['Saquon Barkley'], WR: ['A.J. Brown'], TE: ['Dallas Goedert'] } } } }, usage: null, signals: { insights: [] }, gameMarkets: {}, weekMarkets: {}, injuriesList: [], injuriesByTeam: {}, weekNumber: 1, rules: H.scoringRules('ppr'), nameIndex: H._oddsProjectionIndex(), excluded: ['III@JJJ'] };
{
  const b = H.briefForGames('what-sunday-taught-us', [{ id: 'x', home: 'PHI', away: 'DAL' }], [G], ctx);
  ok('a game brief has a section per club', b.teams.length === 2 && b.teams.every(t => t.alreadyKnew && t.learned && Array.isArray(t.stillDontKnow)));
  ok('what we already knew carries the depth chart', b.teams.find(t => t.team === 'PHI').alreadyKnew.depthChart.RB[0] === 'Saquon Barkley');
  ok('what we learned carries the usage counts', b.teams.find(t => t.team === 'PHI').learned.backfield[0].carries > 0);
  ok('open questions are computed flags, not prose', b.teams.every(t => t.stillDontKnow.every(q => q.question && q.detail)));
  ok('the excluded games are named on the brief', b.excluded.join() === 'III@JJJ');
  ok('the brief lists what it cannot supply', b.unavailable.some(u => /routes/.test(u)));
  ok('the allowed names include every player in the box score', b.allowed.names.includes('CeeDee Lamb') && b.allowed.names.includes('Saquon Barkley'));
  ok('and the allowed numbers include the counts', b.allowed.numbers.includes(String(G.players.find(p => p.name === 'Saquon Barkley').rush.att)));
  const r = H.briefTeamRecaps([{ id: 'x', home: 'PHI', away: 'DAL' }], [G], ctx);
  ok('team recaps carry every club in the schedule', r.teams.length === 2 && r.teams.every(t => t.team));
  const w = H.briefWtaty({ ...ctx, signals: { insights: [
    { type: 'line_movement', label: 'x', confidence: 'HIGH', magnitude: 12, subject: { key: 'ceedeelamb|WR', name: 'CeeDee Lamb' }, data: { market: 'recYd', open: 61.5, current: 68.5 } },
    { type: 'vegas_above_consensus', label: 'x', confidence: 'MEDIUM', magnitude: 3, subject: { key: 'ajbrown|WR', name: 'A.J. Brown' }, data: { rankDelta: 3 } },
    { type: 'role_increase', label: 'x', confidence: 'LOW', magnitude: 30, subject: { key: 'georgepickens|WR', name: 'George Pickens' }, data: {} } ] } });
  ok('the Tuesday feature keeps only what clears the bar', w.count === 1 && w.items[0].subject.name === 'CeeDee Lamb', JSON.stringify(w.items.map(i => i.subject.name)));
  ok('and says so rather than padding to eight', /Fewer than 8/.test(w.note));
  ok('every item has the five parts', w.items.every(i => 'everyoneSees' in i && 'dataSays' in i && 'vegasSays' in i && i.whyItMatters && i.confidence));
  const f = H.briefFinalRead(ctx);
  ok('the Final Read has its six sections', ['marketVsConsensus', 'injuryDrivenOpportunity', 'startSitPressure', 'ironTunaHigher', 'ironTunaLower', 'whatCouldChange'].every(k => Array.isArray(f[k])));
  const gp = H.briefGamePlan('weekend-game-plan', [{ id: 'x', home: 'PHI', away: 'DAL', spread: 3, total: 47.5, impliedHome: 25.25, impliedAway: 22.25, kickoff: 1 }], ctx);
  ok('a game card carries the lines and the derived environment', gp.cards[0].total === 47.5 && gp.cards[0].environment === 'above average' && gp.cards[0].mostImportant);
}

console.log('\nthe validator');
{
  const b = H._finishBrief({ players: [{ name: 'CeeDee Lamb', targets: 12, share: 34 }], team: 'DAL' });
  ok('a draft inside the brief passes', H.validateDraft('CeeDee Lamb saw 12 targets, a 34% share.', b.allowed).ok);
  const bad = H.validateDraft('CeeDee Lamb saw 12 targets. Jerry Jeudy had 155 yards.', b.allowed);
  ok('a player the brief does not contain is caught', !bad.ok && bad.names.includes('Jerry Jeudy'), JSON.stringify(bad));
  ok('a number the brief does not contain is caught', bad.numbers.includes('155'));
  ok('small counts are allowed as prose', H.validateDraft('He was one of 3 backs used.', b.allowed).ok);
  ok('the site\'s own names are allowed', H.validateDraft('Iron Tuna has him higher. Market Delta agrees.', b.allowed).ok);
  // The first live preview (Week 1, 2026) was held on all of these.
  const wk = H._finishBrief({ games: [{ away: 'NE', home: 'SEA', spread: 3.5, total: 44.5 }], players: [{ name: 'Puka Nacua', proj: 20.7, market: 18.6, consensus: 20.1 }, { name: 'Isaac Guerendo', status: 'PUP' }, { name: 'A.J. Brown' }] });
  const hl = H.validateDraft('Two Slates, Two Very Different Implied Totals: Follow the Market Away From New England', wk.allowed);
  ok('a title-case headline is not a roster', hl.ok, JSON.stringify(hl));
  const sb = H.validateDraft('Same problem as Brown. Vegas ranks him lower. He is behind Nacua. Reasonable flex.', wk.allowed);
  ok('a sentence boundary is not a name', sb.ok, JSON.stringify(sb));
  const ps = H.validateDraft("Guerendo's PUP absence opens the backfield. Every Patriots skill player. Reasonable DST start. Iron Tuna's rank agrees.", wk.allowed);
  ok('a possessive, an abbreviation, a club and the site are not a name', ps.ok, JSON.stringify(ps));
  ok('a real player the packet lacks is still caught', H.validateDraft('Justin Jefferson is the play here.', wk.allowed).names.join() === 'Justin Jefferson');
  const ar = H.validateDraft('Market points 18.6, 1.5 below consensus. LA -3.5 at home.', wk.allowed);
  ok('a difference of two packet numbers is allowed, and so is the signed spread', ar.ok, JSON.stringify(ar));
  const nn = H.validateDraft('He ran for 155 yards, 4.7 per carry.', wk.allowed);
  ok('a number that is neither in the packet nor arithmetic on it is still caught', nn.numbers.join() === '155,4.7', JSON.stringify(nn));
  // Week 1's Kickers & Defenses was held on "number:600" for "salary 2,600".
  const sal = H._finishBrief({ players: [{ name: 'Cameron Dicker', salary: 4600 }], lines: ['Atlanta Falcons DST: DraftKings salary 2,600.'] });
  const sv = H.validateDraft('Dicker costs 4,600 and the Falcons DST 2,600.', sal.allowed);
  ok('a salary with a thousands separator is one number', sv.ok, JSON.stringify(sv));
  ok('a separated number the packet lacks is caught whole', H.validateDraft('He costs 5,900.', sal.allowed).numbers.join() === '5900');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
