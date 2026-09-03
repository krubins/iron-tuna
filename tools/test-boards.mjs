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
  cut('// -- kickers and defences, scored', '// -- the insight detection engine') + '\n' +
  'return { scoringRules, scoreStats, scoreAny, scoreKickerStats, scoreDefenseStats, SCORING_KDEF, ' +
  'nflSeasonState, teamRatingsFrom, weekEnvironment, weeklyStats, horizonWeeks, marketDelta, MARKET_DELTA, ' +
  'explainDelta, roleTrendFrom, buildBoards, HORIZONS, IT_BLEND, marketHistoryFrom, marketPropsFrom, _oddsProjectionIndex };'
)(etOffsetHours, teamKey, stub, 'x', async () => {}, stub, _oddsRound, _oddsNorm, POOL, AVAILABILITY_GAMES, _availF,
  { passYd: 0.2, passTD: 0.28, passInt: 0.35, rushYd: 0.3, rushTD: 0.4, recYd: 0.3, recTD: 0.4, rec: 0.28, scrimmageTD: 0.4 }, {});

// ── the fixture season ─────────────────────────────────────────────────────
// AAA and BBB are strong offences at home, CCC and DDD weak. Weeks 1-14 are
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
  ok('a defence facing a weak week allows fewer points', near(d.ptsAllowed, (340 / 17) * 0.8));
  ok('and gets more sacks and takeaways', d.sacks > 40 / 17);
}

console.log('\nkickers and defences score like the app');
{
  const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lift = (h) => { const i = app.indexOf('\n' + h); const e = app.indexOf('\n}', i); return app.slice(i, e + 2); };
  const APP = new Function(lift('function countScore(') + lift('function applyTierScale(') + lift('function scoreKicker(') + lift('function scoreDefense(') +
    '\nreturn { scoreKicker, scoreDefense };')();
  const cfg = { scoring: H.SCORING_KDEF };
  const k = POOL[6].projectedStats, dst = POOL[7].projectedStats;
  ok('a kicker scores the same in the worker and the app', near(H.scoreKickerStats(k, H.SCORING_KDEF), APP.scoreKicker(k, cfg)),
     H.scoreKickerStats(k, H.SCORING_KDEF) + ' vs ' + APP.scoreKicker(k, cfg));
  ok('a defence scores the same in the worker and the app', near(H.scoreDefenseStats(dst, H.SCORING_KDEF, 17), APP.scoreDefense(dst, cfg, 17)),
     H.scoreDefenseStats(dst, H.SCORING_KDEF, 17) + ' vs ' + APP.scoreDefense(dst, cfg, 17));
  const lg = fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8');
  const L = new Function('SCORING_DEFAULTS', 'cfg', lg.slice(lg.indexOf('  function yardageScore('), lg.indexOf('  // The client\'s qbIsPremium')) + '\nreturn { score };')({}, null);
  ok('and it-league.js agrees with both', near(L.score(k, 'K', H.SCORING_KDEF), APP.scoreKicker(k, cfg)) && near(L.score(dst, 'DEF', H.SCORING_KDEF, 17), APP.scoreDefense(dst, cfg, 17)));
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
  ok('a defence is a DST on the board', b.players.some(p => p.position === 'DST' && p.pos === 'DEF'));
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
  const avail = { 'betaback|RB': { status: 'IR', gamesOut: 2, note: 'knee' } };
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
  const n3 = H.buildBoards(ctx(), { horizon: 'next3', preset: 'ppr' });
  const a3 = n3.players.find(p => p.name === 'Alpha Quarterback');
  ok('NEXT 3 sums three posted weeks', a3.games === 3 && a3.vegas.postedWeeks === 3 && a3.vegas.basis === 'gamelines');
  ok('and its points are roughly three times a week', near(a3.consensus.points, 3 * H.buildBoards(ctx(), { horizon: 'week' }).players.find(p => p.name === 'Alpha Quarterback').consensus.points, 0.4));
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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
