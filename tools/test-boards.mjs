#!/usr/bin/env node
// The three boards, Market Delta, and the explainer (Steps 9-11, and the
// horizon maths behind 13).
//   node tools/test-boards.mjs
//
// THE FIXTURE IS BUILT SO THE ANSWERS ARE KNOWN. Four clubs, eighteen weeks,
// lines posted for the first twelve and NOT for the last six -- so a horizon
// that reaches past week 12 has to say "ratings", never "gamelines", and its
// confidence has to come down. One player carries a priced prop with a known
// open and current; one is out two games; one has four weeks of usage.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol;

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.error('FAIL: could not locate ' + from.slice(0, 40)); process.exit(1); }
  return src.slice(a, b);
};
const HEAD = 'function etOffsetHours(ms) {';
const etOffsetHours = new Function('ms', src.slice(src.indexOf(HEAD) + HEAD.length, src.indexOf('function etClock(ms) {')).replace(/\}\s*$/, ''));
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TEAM_ALIAS[u] || u; };
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const _oddsRound = v => Math.round(v * 10) / 10;
const AVAILABILITY_GAMES = 17;
const _availF = g => Math.max(0, Math.min(1, 1 - (Number(g) || 0) / AVAILABILITY_GAMES));
const stub = () => { throw new Error('not needed'); };

const POOL = [
  { name: 'Alpha Quarterback', position: 'QB', team: 'AAA', projectedStats: { passYd: 4250, passTD: 30, passInt: 10, rushYd: 300, rushTD: 3 } },
  { name: 'Beta Back', position: 'RB', team: 'BBB', projectedStats: { rushYd: 1200, rushTD: 10, rec: 40, recYd: 300, recTD: 2 } },
  { name: 'Gamma Back', position: 'RB', team: 'CCC', projectedStats: { rushYd: 900, rushTD: 6, rec: 60, recYd: 450, recTD: 3 } },
  { name: 'Delta Receiver', position: 'WR', team: 'DDD', projectedStats: { rec: 75, recYd: 1000, recTD: 8 } },
  { name: 'Echo Receiver', position: 'WR', team: 'AAA', projectedStats: { rec: 70, recYd: 950, recTD: 6 } },
  { name: 'Foxtrot End', position: 'TE', team: 'BBB', projectedStats: { rec: 65, recYd: 700, recTD: 5 } },
  { name: 'Golf Kicker', position: 'K', team: 'CCC', projectedStats: { fgMade: 30, fgMissed: 5, xpMade: 40, xpMissed: 2 } },
  { name: 'DDD Defense', position: 'DEF', team: 'DDD', projectedStats: { sacks: 40, ints: 12, fumRec: 8, defTD: 1.5, safety: 0, ptsAllowed: 340 } }
];

const H = new Function(
  'etOffsetHours', 'teamKey', '_csvSplit', 'NFLVERSE_GAMES_URL', 'oddsCacheInit', 'fetch',
  '_oddsRound', '_oddsNorm', 'PROJECTIONS', 'AVAILABILITY_GAMES', '_availF', 'ODDS_CV', 'ODDS_BANDS',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' +
  cut('function _oddsImpliedProb(', '// The Odds API v4. WRITTEN') + '\n' +
  cut('const MARKET_RIDGE', 'async function fetchTeamEnvNflverse') + '\n' +
  cut('function _oddsProjectionIndex()', 'function buildVegasOverlay(') + '\n' +
  cut('// ── the NFL season and week ─', '// ── the provider layer ─') + '\n' +
  cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' +
  cut('// -- kickers and defenses, scored', '// -- the insight detection engine') + '\n' +
  'return { scoringRules, scoreStats, scoreAny, scoreKickerStats, scoreDefenseStats, SCORING_KDEF, ' +
  'nflSeasonState, teamRatingsFrom, weekEnvironment, weeklyStats, horizonWeeks, marketDelta, MARKET_DELTA, ' +
  'explainDelta, roleTrendFrom, buildBoards, HORIZONS, IT_BLEND, marketHistoryFrom, marketPropsFrom, _oddsProjectionIndex, ' +
  'seasonGameStatus, playedTeams, boardStillToPlay };'
)(etOffsetHours, teamKey, stub, 'x', async () => {}, stub, _oddsRound, _oddsNorm, POOL, AVAILABILITY_GAMES, _availF,
  { passYd: 0.2, passTD: 0.28, passInt: 0.35, rushYd: 0.3, rushTD: 0.4, recYd: 0.3, recTD: 0.4, rec: 0.28, scrimmageTD: 0.4 }, {});

// ── the fixture season ─────────────────────────────────────────────────────
// AAA and BBB are strong offenses at home, CCC and DDD weak. Weeks 1-14 are
// posted (the ratings fit needs 24 priced games, the production floor); 15-18
// are not. Every club has one bye. AAA's week-3 line is a
// SHOOTOUT (total 54 vs a 44 norm) so its environment factor must read > 1.
const ET = (d, h, m) => Date.UTC(2026, 8, 6 + (d - 1) * 7, h + 4, m);   // Sundays from Sept 6 2026, 1pm ET = 17:00Z
const games = [];
let id = 0;
const pairings = [[['AAA', 'BBB'], ['CCC', 'DDD']], [['AAA', 'CCC'], ['BBB', 'DDD']], [['AAA', 'DDD'], ['BBB', 'CCC']]];
for (let w = 1; w <= 18; w++) {
  const pair = pairings[(w - 1) % 3];
  const bye = w === 7 ? 'AAA' : w === 8 ? 'BBB' : w === 9 ? 'CCC' : w === 10 ? 'DDD' : null;
  for (const [home, away] of pair) {
    if (home === bye || away === bye) continue;
    const posted = w <= 14;
    const strongHome = home === 'AAA' || home === 'BBB';
    const total = w === 3 && home === 'AAA' ? 54 : 44;
    const spread = strongHome ? 4 : -2;
    games.push({ id: 'g' + (++id), type: 'REG', week: w, kickoff: ET(w, 13, 0), home, away,
      homeScore: null, awayScore: null, spread: posted ? spread : null, total: posted ? total : null, status: null, src: 'fixture' });
  }
}
const SCHED = { season: 2026, games, provider: 'fixture', updatedAt: 1 };
const NOW = ET(2, 9, 0);                              // Week 2, Sunday morning (week 1 finished)
const state = H.nflSeasonState(SCHED, NOW);
const ratings = H.teamRatingsFrom(SCHED);
const rules = H.scoringRules('ppr');

console.log('\nthe clock and the ratings');
{
  ok('the fixture reads as Week 2', state.ok && state.week.number === 2, JSON.stringify(state.week && state.week.label));
  ok('the ratings fit off the posted games', ratings.ok === true && ratings.teams === 4);
  const e3 = H.weekEnvironment(ratings, 'AAA', 3);
  ok('a shootout week reads as a rich environment', e3.factor > 1.05 && e3.posted, JSON.stringify(e3));
  const e14 = H.weekEnvironment(ratings, 'AAA', 16);
  ok('an unposted week falls back to the fitted ratings, and says so', e14.basis === 'ratings' && !e14.posted && e14.implied === null, JSON.stringify(e14));
  ok('and it still projects points from the fit', e14.expected != null && e14.expected > 0);
  const bye = H.weekEnvironment(ratings, 'AAA', 7);
  ok('a bye is a bye', bye.bye === true && bye.factor === 0);
  // The DEFENSE's half of the same fixture, in the same shape. A defense does
  // not score off `implied` — that is its own offense — so without this the
  // only opportunity figure a DST row could print would be the wrong one.
  const d3 = H.weekEnvironment(ratings, 'AAA', 3);
  ok('a fixture carries the allowed side as well as the scored side',
     d3.allowedImplied != null && d3.allowedExpected != null && d3.allowedDelta != null, JSON.stringify(d3));
  ok('and the allowed side of a game is the other club\'s scored side',
     near(d3.allowedImplied, H.weekEnvironment(ratings, d3.opponent, 3).implied, 0.06));
  const d16 = H.weekEnvironment(ratings, 'AAA', 16);
  ok('an unposted week has no allowed delta to quote, and says null rather than zero',
     d16.allowedImplied === null && d16.allowedDelta === null && d16.allowedExpected != null);
}

console.log('\nhorizons');
{
  ok('THIS WEEK is the current week', JSON.stringify(H.horizonWeeks('week', state)) === '[2]');
  ok('NEXT 3 starts now and runs three', JSON.stringify(H.horizonWeeks('next3', state)) === '[2,3,4]');
  const ros = H.horizonWeeks('ros', state);
  ok('REST OF SEASON runs to 17 and excludes 18 by default', ros[0] === 2 && ros[ros.length - 1] === 17 && !ros.includes(18));
  ok('...unless the league says 18', H.horizonWeeks('ros', state, 18).includes(18));
  ok('the playoffs are exactly 15-17', JSON.stringify(H.horizonWeeks('playoffs', state)) === '[15,16,17]');
  const nov = H.nflSeasonState(SCHED, ET(16, 9, 0));
  ok('NEXT 3 does not run past 18 late in the year', JSON.stringify(H.horizonWeeks('next3', nov)) === '[16,17,18]');
}

console.log('\nweekly stat lines');
{
  const full = POOL[1].projectedStats;
  const flat = H.weeklyStats(full, 'RB', 17, { factor: 1, allowedFactor: 1 });
  ok('a flat week is the season line over the games', near(flat.rushYd, 1200 / 17) && near(flat.rushTD, 10 / 17));
  const hot = H.weeklyStats(full, 'RB', 17, { factor: 1.2, allowedFactor: 1 });
  ok('touchdowns follow the environment fully', near(hot.rushTD, (10 / 17) * 1.2));
  ok('yards follow it at the square root', near(hot.rushYd, (1200 / 17) * Math.sqrt(1.2)));
  const out = H.weeklyStats(full, 'RB', 15, { factor: 1, allowedFactor: 1 });
  ok('a player who misses games is divided by the games he plays', near(out.rushYd, 1200 / 15));
  const d = H.weeklyStats(POOL[7].projectedStats, 'DEF', 17, { factor: 1, allowedFactor: 0.8 });
  ok('a defense facing a weak week allows fewer points', near(d.ptsAllowed, (340 / 17) * 0.8));
  ok('and gets more sacks and takeaways', d.sacks > 40 / 17);
}

console.log('\nkickers and defenses score like the app');
{
  const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lift = (h) => { const i = app.indexOf('\n' + h); const e = app.indexOf('\n}', i); return app.slice(i, e + 2); };
  const APP = new Function(lift('function countScore(') + lift('function applyTierScale(') + lift('function scoreKicker(') + lift('function paNormCdf(') + lift('function paTierExpected(') + lift('function scoreDefense(') +
    '\nreturn { scoreKicker, scoreDefense };')();
  const cfg = { scoring: H.SCORING_KDEF };
  const k = POOL[6].projectedStats, dst = POOL[7].projectedStats;
  ok('a kicker scores the same in the worker and the app', near(H.scoreKickerStats(k, H.SCORING_KDEF), APP.scoreKicker(k, cfg)),
     H.scoreKickerStats(k, H.SCORING_KDEF) + ' vs ' + APP.scoreKicker(k, cfg));
  ok('a defense scores the same in the worker and the app', near(H.scoreDefenseStats(dst, H.SCORING_KDEF, 17), APP.scoreDefense(dst, cfg, 17)),
     H.scoreDefenseStats(dst, H.SCORING_KDEF, 17) + ' vs ' + APP.scoreDefense(dst, cfg, 17));
  const lg = fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8');
  const L = new Function('SCORING_DEFAULTS', 'cfg', lg.slice(lg.indexOf('  function yardageScore('), lg.indexOf('  // The client\'s qbIsPremium')) + '\nreturn { score };')({}, null);
  ok('and it-league.js agrees with both', near(L.score(k, 'K', H.SCORING_KDEF), APP.scoreKicker(k, cfg)) && near(L.score(dst, 'DEF', H.SCORING_KDEF, 17), APP.scoreDefense(dst, cfg, 17)));
  // Points allowed is read over a spread around the mean in all three copies
  // (26 Sep 2026), so they are held together across the whole range, not at
  // one fixture's 20 a game -- and a RESULT, asked for exact, stays on the
  // ladder at its own number in the worker and the league module alike.
  const sweep = [0, 3, 9.5, 14, 17.2, 20.9, 21, 24.4, 28, 35, 44].map(m => ({ sacks: 2, ints: 1, ptsAllowed: m * 17 }));
  ok('the three copies agree on a defense across the points-allowed range',
     sweep.every(d => near(H.scoreDefenseStats(d, H.SCORING_KDEF, 17), APP.scoreDefense(d, cfg, 17), 1e-6)
                   && near(L.score(d, 'DEF', H.SCORING_KDEF, 17), APP.scoreDefense(d, cfg, 17), 1e-6)));
  ok('...and scored as a result, the worker and the league module agree on the plain ladder',
     sweep.every(d => near(H.scoreDefenseStats(d, H.SCORING_KDEF, 17, { exact: true }), L.score(d, 'DEF', H.SCORING_KDEF, 17, { exact: true }), 1e-9)));
}

// ── the boards ─────────────────────────────────────────────────────────────
function ctx(over) {
  return { sched: SCHED, state, ratings, avail: {}, usage: null, overlay: null, weekMarkets: {},
           nameIndex: H._oddsProjectionIndex(), pool: POOL, rules, ...(over || {}) };
}

console.log('\nthe three boards, this week');
{
  const b = H.buildBoards(ctx(), { horizon: 'week', preset: 'ppr' });
  ok('every player is on it', b.players.length === POOL.length);
  const rb = b.players.filter(p => p.position === 'RB');
  ok('ranks are within position', rb.map(p => p.consensus.rank).sort().join(',') === '1,2');
  ok('FLEX pools RB, WR and TE', b.players.filter(p => p.ironTuna.flexRank).length === 5 &&
     b.players.filter(p => p.position === 'QB' || p.position === 'K' || p.position === 'DST').every(p => !p.ironTuna.flexRank));
  ok('a defense is a DST on the board', b.players.some(p => p.position === 'DST' && p.pos === 'DEF'));
  const beta = b.players.find(p => p.name === 'Beta Back');
  ok('consensus is the flat per-game line', near(beta.consensus.stats.rushYd, _oddsRound(1200 / 17), 0.06));
  ok('with no prop the Vegas basis is the game line, graded MEDIUM', beta.vegas.basis === 'gamelines' && beta.vegas.confidence === 'MEDIUM', beta.vegas.basis + ' ' + beta.vegas.confidence);
  ok('and Iron Tuna sits between consensus and Vegas',
     (beta.ironTuna.points - beta.consensus.points) * (beta.vegas.points - beta.consensus.points) >= 0 &&
     Math.abs(beta.ironTuna.points - beta.consensus.points) <= Math.abs(beta.vegas.points - beta.consensus.points) + 0.11,
     JSON.stringify([beta.consensus.points, beta.ironTuna.points, beta.vegas.points]));
  ok('every row carries a Market Delta with a classification', b.players.every(p => p.marketDelta && H.MARKET_DELTA.classes.includes(p.marketDelta.classification)));
  ok('every row carries a why', b.players.every(p => p.why && typeof p.why.summary === 'string'));
  ok('thresholds are shipped with the board', b.delta && b.delta.strongRank === H.MARKET_DELTA.strongRank);
  ok('the opponent is named', beta.weeks[0].opponent && beta.weeks[0].home != null);
}

console.log('\nbyes, injuries and the multi-week sums');
{
  // Placed on IR during Week 2, so his two games out are Weeks 2 and 3.
  const avail = { 'betaback|RB': { status: 'IR', gamesOut: 2, note: 'knee', asOf: new Date(NOW).toISOString().slice(0, 10) } };
  const b = H.buildBoards(ctx({ avail }), { horizon: 'ros', preset: 'ppr' });
  const beta = b.players.find(p => p.name === 'Beta Back');
  ok('an injured player misses the first weeks of the horizon',
     beta.weeks[0].out === true && beta.weeks[1].out === true && !beta.weeks[2].out, JSON.stringify(beta.weeks.slice(0, 3)));
  ok('his bye is a bye, not a game', beta.byes.includes(8) && beta.weeks.find(w => w.week === 8).bye === true);
  // With four clubs a bye sidelines the bye team's partner too, so the count
  // comes off the fixture rather than being assumed.
  const bbbWeeks = games.filter(g => g.week >= 2 && g.week <= 17 && (g.home === 'BBB' || g.away === 'BBB')).length;
  ok('games played counts neither', beta.games === bbbWeeks - 2, beta.games + ' vs ' + (bbbWeeks - 2));
  ok('the injury is on the row', beta.injury && beta.injury.status === 'IR' && beta.injury.gamesOut === 2);
  const alpha = b.players.find(p => p.name === 'Alpha Quarterback');
  const aaaWeeks = games.filter(g => g.week >= 2 && g.week <= 17 && (g.home === 'AAA' || g.away === 'AAA')).length;
  ok('a healthy player plays every week he has a game', alpha.games === aaaWeeks && alpha.byes.includes(7));
  // The per-game ranking beside the totals (10 Oct 2026): the same points
  // divided by the games he plays, ranked by the worker's rules and graded by
  // marketDelta itself, so the board in the browser divides nothing.
  ok('the rest-of-season row carries its average per game',
     !!beta.perGame && near(beta.perGame.consensus.points, beta.consensus.points / beta.games, 0.06) &&
     near(beta.perGame.vegas.points, beta.vegas.points / beta.games, 0.06), JSON.stringify(beta.perGame));
  const ranked = (f) => b.players.filter(p => p.position === 'RB' && p.perGame[f].points != null)
    .sort((x, y) => x.perGame[f].rank - y.perGame[f].rank).map(p => p.perGame[f].points);
  ok('ranked on the average within the position, 1..n',
     ['consensus', 'vegas', 'ironTuna'].every(f => ranked(f).every((v, i, a) => i === 0 || a[i - 1] >= v)) &&
     b.players.filter(p => p.position === 'RB').map(p => p.perGame.vegas.rank).sort((x, y) => x - y).every((r, i) => r === i + 1));
  ok('FLEX is pooled on the average too',
     b.players.filter(p => /^(RB|WR|TE)$/.test(p.position)).every(p => p.perGame.vegas.flexRank > 0));
  ok('and the gap is the worker\'s own classification of the averages',
     JSON.stringify(beta.perGame.marketDelta) === JSON.stringify(H.marketDelta(beta.perGame.consensus.points, beta.perGame.consensus.rank, beta.perGame.vegas.points, beta.perGame.vegas.rank)));
  ok('the week board carries no average', !H.buildBoards(ctx({ avail }), { horizon: 'week', preset: 'ppr' }).players.some(p => p.perGame));
  // The season line was PRO-RATED for the listed player (as the app ships it);
  // his per-game line must be the full line over the games he plays, not the
  // pro-rated line over 17.
  const week = H.buildBoards(ctx({ avail: { 'gammaback|RB': { status: 'Out', gamesOut: 4 } },
    pool: POOL.map(p => p.name === 'Gamma Back' ? { ...p, projectedStats: { rushYd: 900 * 13 / 17, rushTD: 6 * 13 / 17, rec: 60 * 13 / 17, recYd: 450 * 13 / 17, recTD: 3 * 13 / 17 } } : p) }),
    { horizon: 'playoffs', preset: 'ppr' });
  const gamma = week.players.find(p => p.name === 'Gamma Back');
  ok('a four-game absence from Week 2 does not reach the playoffs', gamma.games === 3 && gamma.weeks.every(w => !w.out), JSON.stringify(gamma.weeks.map(w => [w.week, !!w.out, !!w.bye])));
  ok('a pro-rated row is un-rated before it is divided', near(gamma.consensus.stats.rushYd / gamma.games, _oddsRound(900 / 13), 0.2), String(gamma.consensus.stats.rushYd / gamma.games));
  ok('the playoff horizon is three weeks and never 18', week.horizon.weeks.join() === '15,16,17');
  ok('far-out weeks have no posted line and say so', gamma.vegas.basis === 'ratings' && gamma.vegas.confidence === 'LOW', gamma.vegas.basis + ' ' + gamma.vegas.confidence);
  ok('schedule difficulty is reported', !!gamma.scheduleDifficulty && ['Easy', 'Average', 'Hard'].includes(gamma.scheduleDifficulty.label));
  // gamesOut counts from when the absence began, not from today. A preseason
  // placement "first eligible Week 2" is over by Week 2; a live entry is
  // counted from kickoff, so four games out means back in Week 5, not Week 6.
  const back = H.buildBoards(ctx({ avail: { 'betaback|RB': { status: 'IR', gamesOut: 1, asOf: '2026-08-30' } } }), { horizon: 'ros', preset: 'ppr' })
    .players.find(p => p.name === 'Beta Back');
  ok('a preseason absence that has run its course takes no weeks now', back.weeks.every(w => !w.out) && back.injury.status === 'IR',
     JSON.stringify(back.weeks.slice(0, 3)));
  const live = H.buildBoards(ctx({ avail: { 'betaback|RB': { status: 'IR', gamesOut: 4, live: true, asOf: '2026-09-12' } } }), { horizon: 'ros', preset: 'ppr' })
    .players.find(p => p.name === 'Beta Back');
  ok('a live placement is counted from kickoff', live.weeks.filter(w => w.out).map(w => w.week).join() === '2,3,4',
     JSON.stringify(live.weeks.filter(w => w.out).map(w => w.week)));
  // Out for the year is off the board, whatever week it is and whenever the
  // placement happened: a Week 3 season-ender (Jaxson Dart, 23 Sep 2026) was
  // still QB10 on the week board two weeks later because nothing carried him.
  const gone = { 'betaback|RB': { status: 'IR', gamesOut: 17, asOf: '2026-09-23', note: 'Knee: out for the rest of the regular season' } };
  const zeroed = POOL.map(p => p.name === 'Beta Back' ? { ...p, projectedStats: { rushYd: 0, rushTD: 0, rec: 0, recYd: 0, recTD: 0 } } : p);
  for (const horizon of ['week', 'ros']) {
    const out = H.buildBoards(ctx({ avail: gone, pool: zeroed }), { horizon, preset: 'ppr' });
    ok(`a player out for the year is not on the ${horizon} board at all`,
       !out.players.some(p => p.name === 'Beta Back') && out.players.length === POOL.length - 1, out.players.map(p => p.name).join(', '));
  }
  const n3 = H.buildBoards(ctx(), { horizon: 'next3', preset: 'ppr' });
  const a3 = n3.players.find(p => p.name === 'Alpha Quarterback');
  ok('NEXT 3 sums three posted weeks', a3.games === 3 && a3.vegas.postedWeeks === 3 && a3.vegas.basis === 'gamelines');
  ok('and its points are roughly three times a week', near(a3.consensus.points, 3 * H.buildBoards(ctx(), { horizon: 'week' }).players.find(p => p.name === 'Alpha Quarterback').consensus.points, 0.4));
}

console.log('\nthis week\'s injury report');
{
  const today = new Date(NOW).toISOString().slice(0, 10);
  const rep = st => ({ 'deltareceiver|WR': { name: 'Delta Receiver', position: 'WR', team: 'DDD', status: st, note: 'Ankle', asOf: today } });
  const base = H.buildBoards(ctx(), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  const outB = H.buildBoards(ctx({ week: rep('Out') }), { horizon: 'week', preset: 'ppr' });
  const out = outB.players.find(p => p.name === 'Delta Receiver');
  ok('a man ruled out this week scores nothing on the week board', out.games === 0 && out.ironTuna.points === 0 && out.consensus.points === 0 && out.weeks[0].out === true,
     JSON.stringify([out.games, out.ironTuna.points]));
  ok('...and ranks behind every healthy receiver', out.ironTuna.rank === 2 && base.ironTuna.points > 0);
  ok('...and the row says why', out.injury && out.injury.status === 'Out' && out.injury.thisWeek === 'Out' && out.injury.note === 'Ankle');
  const dbt = H.buildBoards(ctx({ week: rep('Doubtful') }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  ok('doubtful is benched as the slate benches it', dbt.games === 0 && dbt.ironTuna.points === 0);
  const q = H.buildBoards(ctx({ week: rep('Questionable') }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  ok('questionable stays on the board at his line, flagged', q.games === 1 && q.consensus.points === base.consensus.points && q.injury.status === 'Questionable');
  const ros = H.buildBoards(ctx({ week: rep('Out') }), { horizon: 'ros', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  ok('this week\'s report takes this week only', ros.weeks[0].out === true && ros.weeks.slice(1).every(w => !w.out),
     JSON.stringify(ros.weeks.filter(w => w.out).map(w => w.week)));
  const stale = { 'deltareceiver|WR': { status: 'Out', note: '', asOf: new Date(NOW - 10 * 86400000).toISOString().slice(0, 10) } };
  const old = H.buildBoards(ctx({ week: stale }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  ok('a report older than a week is about a game already played', old.games === 1 && !old.injury);
  const both = H.buildBoards(ctx({ avail: { 'deltareceiver|WR': { status: 'IR', gamesOut: 1, asOf: '2026-08-30' } }, week: rep('Out') }), { horizon: 'week', preset: 'ppr' })
    .players.find(p => p.name === 'Delta Receiver');
  ok('a man on the season list still sitting this week is out, and the row carries both', both.games === 0 && both.injury.status === 'IR' && both.injury.thisWeek === 'Out');
}

console.log('\na priced prop, and the why behind it');
{
  // Delta Receiver: receiving yards opened 61.5 and sit at 68.5 across two
  // books; receptions 4.5 -> 5.5; anytime TD +210 -> +165.
  const t0 = 1000, t1 = 2000;
  const rows = (book, m, line, over, under, ts) => ({ ts, book, subject: 'deltareceiver', subject_type: 'player', market: m, line, over_odds: over, under_odds: under });
  const hist = {
    recYd: H.marketHistoryFrom([rows('dk', 'recYd', 61.5, -110, -110, t0), rows('fd', 'recYd', 61.5, -110, -110, t0),
                                rows('dk', 'recYd', 68.5, -110, -110, t1), rows('fd', 'recYd', 68.5, -110, -110, t1)]),
    rec: H.marketHistoryFrom([rows('dk', 'rec', 4.5, -110, -110, t0), rows('dk', 'rec', 5.5, -110, -110, t1)]),
    anytimeTD: H.marketHistoryFrom([rows('dk', 'anytimeTD', 1, 210, null, t0), rows('dk', 'anytimeTD', 1, 165, null, t1)])
  };
  ok('the TD market reports its odds movement as probability', hist.anytimeTD.tdOpenProbability != null && hist.anytimeTD.tdCurrentProbability > hist.anytimeTD.tdOpenProbability,
     JSON.stringify([hist.anytimeTD.tdOpenProbability, hist.anytimeTD.tdCurrentProbability]));
  const b = H.buildBoards(ctx({ weekMarkets: { deltareceiver: hist } }), { horizon: 'week', preset: 'ppr' });
  const d = b.players.find(p => p.name === 'Delta Receiver');
  ok('a priced player\'s Vegas basis is props', /^props/.test(d.vegas.basis), d.vegas.basis);
  ok('his Vegas yards are the market\'s, not the environment\'s', near(d.vegas.stats.recYd, 68.5, 0.6), String(d.vegas.stats.recYd));
  ok('the week row carries the projection\'s own status', d.weeks[0].vegasProjection && /full|partial/.test(d.weeks[0].vegasProjection.status));
  const why = d.why;
  ok('the why lists every market that moved, with from and to',
     why.drivers.some(x => x.market === 'recYd' && x.from === 61.5 && x.to === 68.5 && x.delta === 7) &&
     why.drivers.some(x => x.market === 'rec' && x.from === 4.5 && x.to === 5.5), JSON.stringify(why.drivers));
  ok('the TD driver reads as American odds, open to current',
     why.drivers.some(x => x.market === 'anytimeTD' && x.from === 210 && x.to === 165), JSON.stringify(why.drivers.find(x => x.market === 'anytimeTD')));
  ok('the sentence says several markets moved up', /independent markets have moved upward/.test(why.summary), why.summary);
  ok('and names volume as the stronger signal over touchdown probability', /volume/.test(why.summary) && /rather than touchdown/.test(why.summary), why.summary);
  ok('the summary asserts nothing the drivers do not show', !/injur|coach|knows|trade|insider/i.test(why.summary));
  // The touchdown price reaches the LINE, not just the block beside it. The
  // board is a stat line scored later, so a price that never touched the line
  // never touched the number: the most widely posted prop in football moved
  // nothing.
  const dP = d.weeks[0].vegasProjection.td.probability / 100;
  ok('the touchdown price moves the priced player\'s touchdown line',
     d.vegas.stats.recTD != null && near((d.vegas.stats.recTD || 0) + (d.vegas.stats.rushTD || 0), dP, 0.06),
     JSON.stringify({ recTD: d.vegas.stats.recTD, rushTD: d.vegas.stats.rushTD, p: dP }));

  // ── a touchdown price and nothing else ─────────────────────────────────
  // No core market, so no standalone market projection — and the price is
  // still applied to the game-line baseline instead of being thrown away.
  const tdOnlyHist = { anytimeTD: H.marketHistoryFrom([rows('dk', 'anytimeTD', 1, 210, null, t0), rows('fd', 'anytimeTD', 1, 165, null, t1)]) };
  const bt = H.buildBoards(ctx({ weekMarkets: { deltareceiver: tdOnlyHist } }), { horizon: 'week', preset: 'ppr' });
  const tdOnlyMan = bt.players.find(p => p.name === 'Delta Receiver');
  const baseline = H.buildBoards(ctx({ weekMarkets: {} }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  ok('a man with only a touchdown price is not called a market projection', tdOnlyMan.vegas.basis === 'gamelines+props', tdOnlyMan.vegas.basis);
  ok('...and is not left on the plain game line either', baseline.vegas.basis === 'gamelines');
  // Against the projection's OWN devigged number, not the history board's
  // display probability: the two are computed by different paths, and what
  // must agree is the line and the price that was applied to it. The tolerance
  // clears _roundStats, which rounds every served stat to a tenth.
  const tdP = tdOnlyMan.weeks[0].vegasProjection.td.probability / 100;
  ok('...his touchdown line IS the market\'s',
     near((tdOnlyMan.vegas.stats.recTD || 0) + (tdOnlyMan.vegas.stats.rushTD || 0), tdP, 0.06),
     JSON.stringify({ td: tdOnlyMan.vegas.stats.recTD, want: tdP }));
  ok('...and his yardage still comes from the environment, untouched',
     near(tdOnlyMan.vegas.stats.recYd, baseline.vegas.stats.recYd, 0.01));
  ok('...so his number moved off the game line\'s', tdOnlyMan.vegas.points !== baseline.vegas.points);
  ok('the week row says the quoted markets were applied',
     tdOnlyMan.weeks[0].vegasProjection && tdOnlyMan.weeks[0].vegasProjection.applied === true
     && tdOnlyMan.weeks[0].vegasProjection.priced.join(',') === 'anytimeTD');
  ok('the week counts it as its own kind, not as a props week',
     tdOnlyMan.vegas.thinWeeks === 1 && tdOnlyMan.vegas.propsWeeks === 0);

  const quiet = b.players.find(p => p.name === 'Echo Receiver');
  ok('a player with no market movement gets an honest sentence', /agree|environment/.test(quiet.why.summary), quiet.why.summary);
}

console.log('\nMarket Delta');
{
  const D = H.MARKET_DELTA;
  ok('the five classifications exist in order', D.classes.join('|') === 'STRONG VEGAS BUY|VEGAS LEANS HIGHER|MARKET AGREES|VEGAS LEANS LOWER|STRONG VEGAS FADE');
  const strong = H.marketDelta(100, 21, 100, 11);
  ok('WR21 to WR11 is +10 positions and a STRONG VEGAS BUY', strong.rank === 10 && strong.classification === D.classes[0], JSON.stringify(strong));
  ok('the primary version is points: Vegas minus consensus', H.marketDelta(100, 5, 112, 5).points === 12);
  ok('a 12% points gap alone is a lean, not strong', H.marketDelta(100, 5, 112, 5).classification === D.classes[1]);
  ok('a 20% gap is strong', H.marketDelta(100, 5, 120, 5).classification === D.classes[0]);
  ok('a small gap on a small line is not a lean', H.marketDelta(3, 5, 3.3, 5).classification === D.classes[2]);
  ok('the fade side mirrors', H.marketDelta(100, 8, 100, 17).classification === D.classes[4] && H.marketDelta(100, 8, 100, 17).rank === -9);
  ok('agreement is agreement', H.marketDelta(100, 8, 101, 8).classification === D.classes[2] && !H.marketDelta(100, 8, 101, 8).significant);
  ok('missing inputs are null, not zero', H.marketDelta(null, 3, 50, 2).points === null);
}

console.log('\nrole trend from usage');
{
  const u = { latest: { week: 4, usage: { targets: 12, carries: 0, passAttempts: 0 } }, season: { games: 4, targets: 32, carries: 0 } };
  const r = H.roleTrendFrom(u);
  ok('a jump in touches reads as up', r.label === 'up' && r.pct === 50, JSON.stringify(r));
  ok('it is applied once enough games exist', r.applied === true && r.factor === 1.1);
  const early = H.roleTrendFrom({ ...u, season: { games: 2, targets: 16, carries: 0 } });
  ok('but not before', early.applied === false && early.factor === 1);
  ok('no usage is no data, not zero', H.roleTrendFrom(null).label === 'no data' && H.roleTrendFrom(null).factor === 1);

  // A PASSER'S ATTEMPTS WERE COUNTED ON ONE SIDE ONLY, so 38 attempts were
  // being divided by his three rushes a game: every quarterback read "usage up
  // 1100%", and the factor that came out of it scaled his projection too.
  const qb = { season: { games: 3, targets: 0, carries: 9, passAttempts: 105 },
               latest: { usage: { passAttempts: 46 } } };
  const qr = H.roleTrendFrom(qb);
  ok('a passer is compared against his own attempts, not against his rushes',
     qr.avgTouches === 38 && qr.latestTouches === 46 && qr.pct === 21, JSON.stringify(qr));
  const old = H.roleTrendFrom({ season: { games: 3, targets: 0, carries: 9 }, latest: { usage: { passAttempts: 46 } } });
  ok('and a cache written before attempts were stored says no data, not 1100%',
     old.label === 'no data' && old.factor === 1, JSON.stringify(old));
  ok('a runner is unaffected by the change', r.label === 'up' && r.pct === 50);
}

// -- what he has actually done ----------------------------------------------
// The usage overlay was read for the role trend and everything else in it was
// discarded, so a board could say where a player ranks and what he is
// projected for and not one word about how he has played.
console.log('\nevery row carries the season line it has actually produced');
{
  const usage = { throughWeek: 3, players: {
    'betaback|RB': { latest: { usage: { carries: 14, targets: 2, snapPct: 52 } },
      season: { games: 3, targets: 7, carries: 41, receptions: 5, tds: 1,
                stats: { rushYd: 181, rushTD: 1, rec: 5, recYd: 28 } } },
    'deltareceiver|WR': { latest: { usage: { targets: 3 } },
      season: { games: 3, targets: 34, carries: 0, receptions: 19, tds: 0,
                stats: { rec: 19, recYd: 214 } } },
    // Played, but cached before season.stats existed: no line to score.
    'gammaback|RB': { latest: { usage: { carries: 9 } }, season: { games: 2, targets: 4, carries: 20 } } } };
  const b = H.buildBoards(ctx({ usage }), { horizon: 'ros', preset: 'ppr' });
  const beta = b.players.find(p => p.name === 'Beta Back');
  ok('the season line rides along raw, so a browser can re-score it',
     beta.form && beta.form.stats.rushYd === 181 && beta.form.games === 3);
  ok('and scored at the board\'s own scoring',
     near(beta.form.points, H.scoreAny(beta.form.stats, 'RB', rules, 3), 0.06) &&
     near(beta.form.ppg, _oddsRound(beta.form.points / 3), 0.06), JSON.stringify(beta.form));
  ok('volume is touches for a back', beta.form.volumeUnit === 'touches' && near(beta.form.volume, _oddsRound(46 / 3), 0.06));
  const delta = b.players.find(p => p.name === 'Delta Receiver');
  ok('and targets for a receiver', delta.form.volumeUnit === 'targets' && near(delta.form.volume, _oddsRound(34 / 3), 0.06));
  ok('a player who has not played carries no form at all',
     b.players.find(p => p.name === 'Echo Receiver').form === null);
  ok('nor does one whose cache has no line to score, rather than a 0.0',
     b.players.find(p => p.name === 'Gamma Back').form === null);
  ok('a kicker and a defense get no volume rather than a meaningless one',
     b.players.filter(p => p.position === 'K' || p.position === 'DST').every(p => !p.form || p.form.volume == null));
}

console.log('\na projection for a game that has kicked off is a result, not a projection');
{
  // The same season, except that Week 2's BBB-DDD game is the Monday night
  // game. At half past four on the Sunday AAA-CCC is under way and BBB-DDD
  // is still to come; Monday morning the early game is over, the night game
  // is still to come and the week has not turned (the report's screenshot);
  // Monday at ten both have kicked off.
  const late = games.find(g => g.week === 2 && g.home === 'BBB');
  const SCHED2 = { ...SCHED, updatedAt: 2, games: games.map(g => g === late ? { ...g, kickoff: ET(3, 20, 15) } : g) };
  const at = { morning: ET(2, 9, 0), afternoon: ET(2, 16, 30), monday: ET(3, 9, 0), night: ET(3, 22, 0) };
  const board = (now) => {
    const st = H.nflSeasonState(SCHED2, now);
    return H.buildBoards({ ...ctx(), sched: SCHED2, state: st, ratings: H.teamRatingsFrom(SCHED2) }, { horizon: 'week', preset: 'ppr' });
  };
  const w0 = (b, name) => b.players.find(p => p.name === name).weeks[0];
  const am = board(at.morning), pm = board(at.afternoon), mon = board(at.monday), night = board(at.night);
  ok('every week row says where its game stands', am.players.every(p => p.weeks[0].gameState === 'upcoming'), JSON.stringify(am.players.map(p => p.weeks[0].gameState)));
  ok('by the clock when the feed has not spoken', w0(pm, 'Alpha Quarterback').gameState === 'in_progress' && w0(pm, 'Beta Back').gameState === 'upcoming'
     && w0(mon, 'Alpha Quarterback').gameState === 'completed' && w0(mon, 'Beta Back').gameState === 'upcoming'
     && w0(night, 'Alpha Quarterback').gameState === 'completed' && w0(night, 'Beta Back').gameState === 'in_progress');
  ok('and by the feed when it has', H.buildBoards({ ...ctx(), sched: SCHED2, state: H.nflSeasonState({ ...SCHED2, updatedAt: 3, games: SCHED2.games.map(g => g === late ? g : g.week === 2 ? { ...g, status: 'final' } : g) }, at.morning),
     ratings: H.teamRatingsFrom({ ...SCHED2, updatedAt: 3, games: SCHED2.games.map(g => g === late ? g : g.week === 2 ? { ...g, status: 'final' } : g) }) }, { horizon: 'week', preset: 'ppr' })
     .players.find(p => p.name === 'Alpha Quarterback').weeks[0].gameState === 'completed');
  ok('the week is still Week 2 on Monday morning, so the board itself still projects Sunday', mon.currentWeek === 2 && mon.players.length === POOL.length);
  const still = H.boardStillToPlay(pm), stillMon = H.boardStillToPlay(mon);
  ok('the public board drops the clubs whose game has kicked off', still.players.map(p => p.team).every(t => t === 'BBB' || t === 'DDD') && still.players.length === 4, JSON.stringify(still.players.map(p => p.name)));
  ok('and says how many rows it held back', still.played === 4);
  ok('on Monday morning only the night game\'s clubs are on it', stillMon.players.map(p => p.team).every(t => t === 'BBB' || t === 'DDD') && stillMon.players.length === 4 && stillMon.played === 4, JSON.stringify(stillMon.players.map(p => p.name)));
  ok('a rank is the whole board\'s rank, not a renumbering of who is left', still.players.find(p => p.name === 'Beta Back').consensus.rank === pm.players.find(p => p.name === 'Beta Back').consensus.rank);
  ok('before kickoff nothing is held back', H.boardStillToPlay(am).players.length === POOL.length && H.boardStillToPlay(am).played === 0);
  ok('once every game has kicked off the week board is empty, and says so', H.boardStillToPlay(night).players.length === 0 && H.boardStillToPlay(night).played === POOL.length);
  ok('the source board is not written to', pm.players.length === POOL.length && !('played' in pm));
  const n3 = H.buildBoards({ ...ctx(), sched: SCHED2, state: H.nflSeasonState(SCHED2, at.afternoon), ratings: H.teamRatingsFrom(SCHED2) }, { horizon: 'next3', preset: 'ppr' });
  ok('a longer horizon is a sum over weeks and is returned whole', H.boardStillToPlay(n3).players.length === POOL.length && H.boardStillToPlay(n3).played == null);
  ok('no board, no judgement', H.boardStillToPlay(null) === null && H.boardStillToPlay({ ok: false }).ok === false);
  const stPm = H.nflSeasonState(SCHED2, at.afternoon);
  ok('the clubs that have kicked off, by the same rule', [...H.playedTeams(stPm)].sort().join() === 'AAA,CCC' && H.playedTeams(H.nflSeasonState(SCHED2, at.morning)).size === 0);
  const postponed = H.nflSeasonState({ ...SCHED2, updatedAt: 4, games: SCHED2.games.map(g => g.week === 2 && g.home === 'AAA' ? { ...g, status: 'postponed' } : g) }, at.afternoon);
  ok('a postponed game has not kicked off', H.playedTeams(postponed).size === 0);
}

console.log('\nthe market\'s silence: no line on him in a priced game');
{
  // Week 2: AAA hosts CCC. Alpha Quarterback (AAA) has no prop. Two OTHER
  // passers do -- the opponent's and his own replacement -- neither of them
  // on the board, so the store's game id is all that places them.
  const gAAA = games.find(g => g.week === 2 && (g.home === 'AAA' || g.away === 'AAA'));
  const gBBB = games.find(g => g.week === 2 && (g.home === 'BBB' || g.away === 'BBB'));
  const row = (subject, m, line, gid, ts = 5000) => ({ ts, book: 'dk', subject, subject_type: 'player', market: m, line, over_odds: -110, under_odds: -110, game_id: gid });
  const hist = (subject, m, line, gid) => H.marketHistoryFrom([row(subject, m, line, gid)]);
  ok('a market history carries its game id', hist('x', 'passYd', 250.5, gAAA.id).gameId === String(gAAA.id));
  const twoPassers = { opponentpasser: { passYd: hist('opponentpasser', 'passYd', 240.5, gAAA.id) },
                       backuppasser: { passYd: hist('backuppasser', 'passYd', 180.5, gAAA.id) } };
  const prior = new Set(['alphaquarterback', 'echoreceiver']);
  const base = H.buildBoards(ctx(), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  const b = H.buildBoards(ctx({ weekMarkets: twoPassers, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' });
  const a = b.players.find(p => p.name === 'Alpha Quarterback');
  ok('two other passers priced in his game and none on him: the market side is zero', a.vegas.points === 0 && a.ironTuna.points === 0, JSON.stringify([a.vegas.points, a.ironTuna.points]));
  ok('the consensus line stands', a.consensus.points === base.consensus.points && a.games === 1);
  ok('the week row says no-line, graded LOW, with the count', a.weeks[0].basis === 'no-line' && a.weeks[0].confidence === 'LOW' && a.weeks[0].noLine && a.weeks[0].noLine.status === 'out' && a.weeks[0].noLine.passers === 2, JSON.stringify(a.weeks[0].noLine));
  ok('the row carries the flag and the basis', a.marketOut && a.marketOut.week === 2 && a.vegas.basis === 'no-line' && a.vegas.noLineWeeks === 1);
  ok('the why is the slate, not a story', a.why && a.why.marketOut === true && /2 other passers/.test(a.why.summary) && !/injur/i.test(a.why.summary), a.why && a.why.summary);
  ok('Market Delta reads the gap', a.marketDelta.points < 0 && a.marketDelta.significant);
  const noPrior = H.buildBoards(ctx({ weekMarkets: twoPassers }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('a man the store never priced is left alone (a spelling that never matched is not an absence)', noPrior.vegas.basis === 'gamelines' && noPrior.vegas.points > 0 && !noPrior.marketOut && !noPrior.weeks[0].noLine);
  const onePasser = H.buildBoards(ctx({ weekMarkets: { opponentpasser: twoPassers.opponentpasser }, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('one other passer is a half-posted slate: flagged thin, graded LOW, line kept', onePasser.vegas.points > 0 && onePasser.vegas.basis === 'gamelines' && onePasser.weeks[0].confidence === 'LOW' && onePasser.weeks[0].noLine && onePasser.weeks[0].noLine.status === 'thin' && !onePasser.marketOut, JSON.stringify(onePasser.weeks[0].noLine));
  const other = H.buildBoards(ctx({ weekMarkets: { opponentpasser: { passYd: hist('opponentpasser', 'passYd', 240.5, gBBB.id) }, backuppasser: { passYd: hist('backuppasser', 'passYd', 180.5, gBBB.id) } }, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('passers priced in ANOTHER game say nothing about him', other.vegas.basis === 'gamelines' && !other.weeks[0].noLine);
  const kicker = b.players.find(p => p.name === 'Golf Kicker');
  ok('kickers and defenses are never read this way', !kicker.weeks[0].noLine && !b.players.find(p => p.position === 'DST').weeks[0].noLine);
  // A receiver, read against his own club's priced men. Three AAA board
  // players carry a core prop; Echo Receiver (AAA) carries none.
  const mates = [
    { name: 'Hotel Back', position: 'RB', team: 'AAA', projectedStats: { rushYd: 800, rushTD: 6, rec: 30, recYd: 200, recTD: 1 } },
    { name: 'India Receiver', position: 'WR', team: 'AAA', projectedStats: { rec: 60, recYd: 800, recTD: 5 } },
    { name: 'Juliet End', position: 'TE', team: 'AAA', projectedStats: { rec: 50, recYd: 500, recTD: 4 } }
  ];
  const pool2 = POOL.concat(mates);
  const wm = { hotelback: { rushYd: hist('hotelback', 'rushYd', 55.5, null) }, indiareceiver: { recYd: hist('indiareceiver', 'recYd', 60.5, null) }, julietend: { rec: hist('julietend', 'rec', 3.5, null) } };
  const e = H.buildBoards(ctx({ pool: pool2, weekMarkets: wm, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' });
  const echo = e.players.find(p => p.name === 'Echo Receiver');
  ok('three priced teammates and no line on him: the market side is zero', echo.vegas.points === 0 && echo.ironTuna.points === 0 && echo.weeks[0].noLine.status === 'out' && echo.weeks[0].noLine.teammates === 3, JSON.stringify(echo.weeks[0].noLine));
  ok('...and he ranks behind every receiver on the market boards, at his own rank on consensus',
     echo.ironTuna.rank === e.players.filter(p => p.position === 'WR').length && echo.vegas.rank === echo.ironTuna.rank && echo.consensus.rank < echo.ironTuna.rank, JSON.stringify([echo.consensus.rank, echo.vegas.rank, echo.ironTuna.rank]));
  ok('the why names the teammates', /3 of his teammates/.test(echo.why.summary), echo.why.summary);
  const two = H.buildBoards(ctx({ pool: pool2, weekMarkets: { hotelback: wm.hotelback, indiareceiver: wm.indiareceiver }, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Echo Receiver');
  ok('two priced teammates is thin, not out', two.vegas.points > 0 && two.weeks[0].noLine && two.weeks[0].noLine.status === 'thin');
  const india = e.players.find(p => p.name === 'India Receiver');
  ok('a priced teammate is read off his own prop', /^props/.test(india.vegas.basis) && !india.weeks[0].noLine, india.vegas.basis);
  // The multi-week boards: this week only. He is back at his line next week.
  const ros = H.buildBoards(ctx({ weekMarkets: twoPassers, priorMarkets: prior }), { horizon: 'ros', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('on the ROS board the absence takes this week only', ros.weeks[0].basis === 'no-line' && ros.weeks[0].vegasPts === 0 && ros.weeks[1].vegasPts > 0 && ros.weeks[1].basis === 'gamelines' && ros.vegas.basis !== 'no-line' && ros.vegas.noLineWeeks === 1,
     JSON.stringify(ros.weeks.slice(0, 2).map(w => [w.week, w.basis, w.vegasPts])));
  ok('and nothing is carried forward from a week with no line', !ros.weeks[1].carried && ros.vegas.carriedWeeks === 0);
  const empty = H.buildBoards(ctx({ weekMarkets: {}, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('a week with no props posted for anyone reads nothing into anyone', empty.vegas.basis === 'gamelines' && !empty.weeks[0].noLine);
  // THE LIVE SHAPE (6 Oct 2026). The store's game id is the provider's, never
  // the schedule's, so a game id on the prop cannot be matched to the fixture.
  // Both other passers are board players: the backup on his own club, the
  // starter on the other. They are placed through their clubs' fixtures.
  const poolQBs = POOL.concat([
    { name: 'Backup Passer', position: 'QB', team: 'AAA', projectedStats: { passYd: 1500, passTD: 8, passInt: 6 } },
    { name: 'Kilo Passer', position: 'QB', team: 'CCC', projectedStats: { passYd: 3800, passTD: 24, passInt: 11 } }
  ]);
  const live = { backuppasser: { passYd: hist('backuppasser', 'passYd', 180.5, 'prov-ev-77') }, kilopasser: { passYd: hist('kilopasser', 'passYd', 240.5, 'prov-ev-77') } };
  const lv = H.buildBoards(ctx({ pool: poolQBs, weekMarkets: live, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('two board passers in his game, under a provider game id, still read as two', lv.marketOut && lv.weeks[0].noLine.status === 'out' && lv.weeks[0].noLine.passers === 2, JSON.stringify(lv.weeks[0].noLine));
  // And a man OFF the board under the same provider id is placed through the
  // board player he shares it with.
  const mixed = { backuppasser: { passYd: hist('backuppasser', 'passYd', 180.5, 'prov-ev-77') }, strangerpasser: { passYd: hist('strangerpasser', 'passYd', 240.5, 'prov-ev-77') } };
  const mx = H.buildBoards(ctx({ pool: poolQBs, weekMarkets: mixed, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('a passer off the board is placed by the provider id a board player shares', mx.marketOut && mx.weeks[0].noLine.passers === 2, JSON.stringify(mx.weeks[0].noLine));
  const elsewhere = { backuppasser: { passYd: hist('backuppasser', 'passYd', 180.5, 'prov-ev-77') }, strangerpasser: { passYd: hist('strangerpasser', 'passYd', 240.5, 'prov-ev-99') } };
  const ew = H.buildBoards(ctx({ pool: poolQBs, weekMarkets: elsewhere, priorMarkets: prior }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Alpha Quarterback');
  ok('...and one under an unshared provider id is not assumed into his game', !ew.marketOut && ew.weeks[0].noLine && ew.weeks[0].noLine.status === 'thin' && ew.weeks[0].noLine.passers === 1, JSON.stringify(ew.weeks[0].noLine));
}

console.log('\nthis week\'s prop, carried into the later weeks');
{
  // Delta Receiver: receiving yards 68.5 and receptions 5.5 priced across
  // two books this week, against a consensus share of 1000/17 and 75/17.
  const rows = (book, m, line, ts) => ({ ts, book, subject: 'deltareceiver', subject_type: 'player', market: m, line, over_odds: -110, under_odds: -110 });
  const hist = { recYd: H.marketHistoryFrom([rows('dk', 'recYd', 68.5, 1000), rows('fd', 'recYd', 68.5, 1000)]),
                 rec: H.marketHistoryFrom([rows('dk', 'rec', 5.5, 1000), rows('fd', 'rec', 5.5, 1000)]) };
  const plain = H.buildBoards(ctx(), { horizon: 'ros', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  const b = H.buildBoards(ctx({ weekMarkets: { deltareceiver: hist } }), { horizon: 'ros', preset: 'ppr' });
  const d = b.players.find(p => p.name === 'Delta Receiver');
  ok('this week is the prop itself', /^props/.test(d.weeks[0].basis) && !d.weeks[0].carried);
  const later = d.weeks.filter(w => w.env && w.week !== 2);
  ok('every later week with a game carries it', later.length > 0 && later.every(w => w.carried === true) && d.vegas.carriedWeeks === later.length, JSON.stringify([later.length, d.vegas.carriedWeeks]));
  const w3 = d.weeks.find(w => w.week === 3), p3 = plain.weeks.find(w => w.week === 3);
  ok('a prop above his share lifts the later weeks\' Vegas line', w3.vegasPts > p3.vegasPts, JSON.stringify([p3.vegasPts, w3.vegasPts]));
  ok('...by a fraction of the gap, not the whole of it', w3.vegasPts - p3.vegasPts < (d.weeks[0].vegasPts - d.weeks[0].consensusPts), JSON.stringify([w3.vegasPts - p3.vegasPts, d.weeks[0].vegasPts - d.weeks[0].consensusPts]));
  ok('the basis and grade of a later week are still the game line\'s', w3.basis === 'gamelines' && w3.confidence === 'MEDIUM');
  ok('the consensus line does not move', d.consensus.points === plain.consensus.points);
  ok('Iron Tuna follows, between the two', d.ironTuna.points > plain.ironTuna.points && d.ironTuna.points < d.vegas.points + 0.11);
  const beta = b.players.find(p => p.name === 'Beta Back');
  ok('a man with no prop this week has nothing carried', !beta.weeks.some(w => w.carried) && beta.vegas.carriedWeeks === 0);
  const wk = H.buildBoards(ctx({ weekMarkets: { deltareceiver: hist } }), { horizon: 'week', preset: 'ppr' }).players.find(p => p.name === 'Delta Receiver');
  ok('the week board is untouched by the carry', wk.vegas.carriedWeeks === 0 && !wk.weeks[0].carried);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
