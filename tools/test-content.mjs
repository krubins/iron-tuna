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
  cut('// -- kickers and defences, scored', '// -- the player intel payload') + '\n' + cut('// -- the content desk', '// Memoized per isolate alongside _PROJ_ENC') + '\n' +
  'return { normalizeGameSummary, gameUsageByTeam, contentDue, CONTENT_KINDS, lastPlayedWeek, etParts, nflSeasonState, _oddsProjectionIndex, briefForGames, briefTeamRecaps, briefWtaty, validateDraft, _finishBrief, _nextEt, scoringRules, detectInsights, briefFinalRead, briefGamePlan };'
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
  ok('ET weekday and hour are read', H.etParts(ET(2026, 9, 13, 20, 0)).dow === 'Sun' && H.etParts(ET(2026, 9, 13, 20, 0)).hour === 20);
  // Sunday 8pm, Week 1: the early and late games are final, SNF is on, MNF is tomorrow.
  const sun8 = due('what-changed-today', ET(2026, 9, 13, 20, 5), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late']);
  ok('Sunday 8pm is due and ready with the finals it has', sun8.due && sun8.ready, JSON.stringify(sun8));
  ok('it covers only the Sunday games that are final', sun8.targets.length === 3 && !sun8.targets.includes('w1-snf'), JSON.stringify(sun8.targets));
  ok('and names the game still being played', sun8.excluded.includes('III@JJJ'), JSON.stringify(sun8.excluded));
  ok('Sunday 7pm is not yet due', !due('what-changed-today', ET(2026, 9, 13, 19, 30), ['w1-e1']).due);
  // SNF piece: 1am Monday, gated on the night game being final.
  const snfEarly = due('snf-what-we-learned', ET(2026, 9, 14, 1, 0), ['w1-e1', 'w1-e2', 'w1-late']);
  ok('the SNF piece waits for the night game to be final', snfEarly.due && !snfEarly.ready && /III@JJJ/.test(snfEarly.reason), JSON.stringify(snfEarly));
  const snfDone = due('snf-what-we-learned', ET(2026, 9, 14, 1, 0), ['w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('and goes once it is', snfDone.due && snfDone.ready && snfDone.targets.join() === 'w1-snf', JSON.stringify(snfDone));
  // Monday recaps: due Monday 6am, covering everything but the Monday game.
  const mon = due('team-recaps', ET(2026, 9, 14, 6, 30), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('Monday recaps are due Monday morning with the weekend final', mon.due && mon.ready && mon.week === 1, JSON.stringify(mon));
  ok('and leave the Monday game to Tuesday', !mon.targets.includes('w1-mnf'));
  ok('Monday recaps are not due on Sunday night', !due('team-recaps', ET(2026, 9, 13, 23, 0), []).due);
  // MNF: Tuesday, gated on the Monday game.
  const mnfWait = due('mnf-breakdown', ET(2026, 9, 15, 0, 30), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf']);
  ok('the MNF piece waits for Monday night', mnfWait.due && !mnfWait.ready, JSON.stringify(mnfWait));
  const mnfGo = due('mnf-breakdown', ET(2026, 9, 15, 0, 30), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf', 'w1-mnf']);
  ok('and publishes once it is final', mnfGo.due && mnfGo.ready && mnfGo.week === 1);
  // A week with no Monday game skips the MNF piece rather than waiting forever.
  const noMnf = due('mnf-breakdown', ET(2026, 9, 22, 6, 0), ['w2-thu', 'w2-e1', 'w2-snf']);
  ok('a week with no Monday game skips the MNF piece', noMnf.skip === true && noMnf.reason === 'no_such_game', JSON.stringify(noMnf));
  // Tuesday feature: the whole week final.
  const tue = due('what-they-arent-telling-you', ET(2026, 9, 15, 6, 15), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf', 'w1-mnf']);
  ok('the Tuesday feature is due Tuesday morning about the week just played', tue.due && tue.ready && tue.week === 1, JSON.stringify(tue));
  ok('on Tuesday the clock has turned to Week 2 but the piece is about Week 1', H.nflSeasonState(withStatus([]), ET(2026, 9, 15, 6, 15)).week.number === 2 && tue.week === 1);
  // Thursday: preview before the game, aftermath Friday after it.
  const prev = due('tnf-preview', ET(2026, 9, 17, 6, 30), []);
  ok('the TNF preview is due Thursday morning, before kickoff', prev.due && prev.ready && prev.week === 2 && prev.targets.join() === 'w2-thu', JSON.stringify(prev));
  ok('a preview is not ready once the game has started', !due('tnf-preview', ET(2026, 9, 17, 21, 0), []).ready);
  const after = due('tnf-aftermath', ET(2026, 9, 18, 0, 30), ['w2-thu']);
  ok('the aftermath is due Friday once the game is final', after.due && after.ready && after.targets.join() === 'w2-thu', JSON.stringify(after));
  ok('and not before it is', !due('tnf-aftermath', ET(2026, 9, 18, 0, 30), []).ready);
  const plan = due('weekend-game-plan', ET(2026, 9, 18, 6, 30), ['w2-thu']);
  ok('the weekend plan covers the games still to come', plan.due && plan.ready && !plan.targets.includes('w2-thu') && plan.targets.length === 2, JSON.stringify(plan));
  const wed = due('opportunity-report', ET(2026, 9, 16, 6, 30), ['w1-thu', 'w1-e1', 'w1-e2', 'w1-late', 'w1-snf', 'w1-mnf']);
  ok('Wednesday pieces are due Wednesday morning about the played week', wed.due && wed.ready && wed.week === 1);
  const fin = due('final-read', ET(2026, 9, 17, 6, 30), []);
  ok('Thursday\'s Final Read is about the coming week', fin.due && fin.ready && fin.week === 2);
  ok('nothing is due before a game has been played', !due('team-recaps', ET(2026, 9, 1, 12, 0), []).due && !due('what-changed-today', ET(2026, 9, 1, 12, 0), []).due);
  ok('nothing is due in the offseason', due('team-recaps', ET(2026, 5, 1, 12, 0), []).reason === 'not_regular_season');
}

console.log('\nthe briefs');
const week = { ok: true, players: POOL.map((p, i) => ({ key: _oddsNorm(p.name) + '|' + p.position, name: p.name, position: p.position, pos: p.position, team: p.team, games: 1, byes: [],
  consensus: { rank: i + 1, points: 15 - i, stats: {} }, vegas: { rank: i + 1, points: 15 - i, confidence: 'MEDIUM', basis: 'gamelines', stats: {} }, ironTuna: { rank: i + 1, points: 15 - i, confidence: 'MEDIUM', stats: {} },
  marketDelta: { points: i === 0 ? 3 : 0, rank: i === 0 ? 6 : 0, classification: i === 0 ? 'VEGAS LEANS HIGHER' : 'MARKET AGREES', significant: i === 0 }, why: { summary: 'x', drivers: [] }, weeks: [{ opponent: 'XXX', home: true, env: { factor: 1 } }], roleTrend: { label: 'no data' } })) };
const ctx = { sched: { games: [{ type: 'REG', home: 'PHI', away: 'DAL' }] }, week, next: null, depth: { teams: { PHI: { offense: { QB: ['Jalen Hurts'], RB: ['Saquon Barkley'], WR: ['A.J. Brown'], TE: ['Dallas Goedert'] } } } }, usage: null, signals: { insights: [] }, gameMarkets: {}, weekMarkets: {}, injuriesList: [], injuriesByTeam: {}, weekNumber: 1, rules: H.scoringRules('ppr'), nameIndex: H._oddsProjectionIndex(), excluded: ['III@JJJ'] };
{
  const b = H.briefForGames('snf-what-we-learned', [{ id: 'x', home: 'PHI', away: 'DAL' }], [G], ctx);
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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
