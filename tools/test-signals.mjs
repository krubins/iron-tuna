#!/usr/bin/env node
// The insight detection engine, Vegas Edge, and the Wednesday ROS update
// (Steps 14, 16, 17).
//   node tools/test-signals.mjs
//
// Every insight is arithmetic over data the engine holds, and carries that
// data. This runs the rules on a fixture where each rule's trigger is known,
// and on an empty overlay where every usage rule must return NOTHING -- which
// is what production looks like until Week 1 has been played.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.error('FAIL: could not locate ' + from.slice(0, 40)); process.exit(1); }
  return src.slice(a, b);
};
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const _oddsRound = v => Math.round(v * 10) / 10;
const stub = () => { throw new Error('not needed'); };

const H = new Function('_oddsRound', '_oddsNorm', 'PROVIDER_UNAVAILABLE', 'LEAD_TZ', 'teamKey', 'AVAILABILITY_GAMES', '_availF',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' +
  cut('function _oddsImpliedProb(', '// The Odds API v4. WRITTEN') + '\n' +
  cut('const MARKET_RIDGE', 'async function fetchTeamEnvNflverse') + '\n' +
  cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' +
  cut('// -- kickers and defenses, scored', '// -- the player intel payload') + '\n' +
  'return { detectInsights, INSIGHT_RULES, INSIGHT_T, buildVegasEdge, rosMoveReasons, marketDelta, marketHistoryFrom, scoreStats, SCORING_BASE, explainDelta };'
)(_oddsRound, _oddsNorm, { goalLineCarries: 'play-by-play only' }, 'America/New_York', t => t, 17, g => Math.max(0, 1 - g / 17));

// A week board with two significant deltas and one agreement.
const P = (name, position, team, cRank, vRank, cPts, vPts, basis) => {
  const d = H.marketDelta(cPts, cRank, vPts, vRank);
  return { key: _oddsNorm(name) + '|' + position, name, position, pos: position, team, games: 1, byes: [],
    consensus: { rank: cRank, points: cPts, stats: { recTD: 0.4, rushTD: 0.1 } }, vegas: { rank: vRank, points: vPts, confidence: 'MEDIUM', basis, stats: { rec: 6, recYd: 70, rushYd: 0 }, td: null },
    ironTuna: { rank: Math.round((cRank + vRank) / 2), points: (cPts + vPts) / 2, stats: { recTD: 0.45, rushTD: 0.1 } },
    marketDelta: d, why: { summary: 'x', drivers: [] }, weeks: [{ week: 2, opponent: 'BBB', home: true, env: {} }], roleTrend: { label: 'no data' } };
};
const WEEK = { ok: true, players: [
  P('Big Riser', 'WR', 'AAA', 21, 11, 12, 15, 'props'),
  P('Big Fader', 'RB', 'BBB', 8, 17, 14, 10, 'gamelines'),
  P('Steady Man', 'TE', 'CCC', 4, 4, 9, 9.2, 'gamelines')
] };
const STATE = { ok: true, week: { label: 'Week 2', number: 2, type: 'REG' }, games: [
  { id: '2026_02_BBB_AAA', home: 'AAA', away: 'BBB', total: 47.5, spread: 6, impliedHome: 26.75, impliedAway: 20.75, kickoff: 1, status: 'upcoming' },
  { id: '2026_02_DDD_CCC', home: 'CCC', away: 'DDD', total: 41, spread: -1, impliedHome: 20, impliedAway: 21, kickoff: 1, status: 'upcoming' }
] };
const rows = (book, subject, m, line, over, under, ts) => ({ ts, book, subject, subject_type: 'player', market: m, line, over_odds: over, under_odds: under });
const WEEK_MARKETS = {
  bigriser: {
    recYd: H.marketHistoryFrom([rows('dk', 'bigriser', 'recYd', 61.5, -110, -110, 1), rows('fd', 'bigriser', 'recYd', 61.5, -110, -110, 1),
                                rows('dk', 'bigriser', 'recYd', 68.5, -110, -110, 2), rows('fd', 'bigriser', 'recYd', 68.5, -110, -110, 2)]),
    anytimeTD: H.marketHistoryFrom([rows('dk', 'bigriser', 'anytimeTD', 1, 210, null, 1), rows('dk', 'bigriser', 'anytimeTD', 1, 165, null, 2)])
  },
  bigfader: { rushYd: H.marketHistoryFrom([rows('dk', 'bigfader', 'rushYd', 72.5, -110, -110, 1), rows('dk', 'bigfader', 'rushYd', 74.5, -110, -110, 2)]) }
};
const grows = (subject, m, line, ts) => ({ ts, book: 'consensus', subject, subject_type: 'game', market: m, line, over_odds: null, under_odds: null });
const GAME_MARKETS = { '2026_02_BBB_AAA': {
  spread: H.marketHistoryFrom([grows('2026_02_BBB_AAA', 'spread', 3, 1), grows('2026_02_BBB_AAA', 'spread', 6, 2)]),
  total: H.marketHistoryFrom([grows('2026_02_BBB_AAA', 'total', 47.5, 1)]) } };

console.log('\nthe rules are the rules');
{
  const want = ['production_below_opportunity', 'production_above_opportunity', 'vegas_above_consensus', 'vegas_below_consensus',
    'line_movement', 'role_increase', 'role_decrease', 'backfield_consolidation', 'target_consolidation', 'goal_line_role_change', 'td_regression', 'game_script_change'];
  ok('every rule the brief names exists', want.every(r => H.INSIGHT_RULES[r]), want.filter(r => !H.INSIGHT_RULES[r]).join(','));
  ok('a rule with no data source says so rather than vanishing', H.INSIGHT_RULES.goal_line_role_change.unavailable);
  ok('thresholds live in one configurable object', typeof H.INSIGHT_T.lineMovePct === 'number' && typeof H.INSIGHT_T.spreadMove === 'number');
}

console.log('\ndetection on a known week');
{
  const r = H.detectInsights({ week: WEEK, usage: null, weekMarkets: WEEK_MARKETS, gameMarkets: GAME_MARKETS, state: STATE, rules: H.SCORING_BASE });
  const types = r.insights.map(i => i.type);
  ok('Vegas above consensus is found', types.includes('vegas_above_consensus'));
  ok('Vegas below consensus is found', types.includes('vegas_below_consensus'));
  ok('an agreeing player produces nothing', !r.insights.some(i => i.subject.name === 'Steady Man' && /vegas_/.test(i.type)));
  const lm = r.insights.filter(i => i.type === 'line_movement');
  ok('an 11% yardage move is a line-movement insight', lm.some(i => i.data.market === 'recYd' && i.data.open === 61.5 && i.data.current === 68.5));
  ok('a TD price move reads as odds and probability', lm.some(i => i.data.market === 'anytimeTD' && i.data.openOdds === 210 && i.data.currentOdds === 165 && i.data.openProbability != null));
  ok('a 2.7% move is below the threshold and is not an insight', !lm.some(i => i.data.market === 'rushYd'));
  const gs = r.insights.find(i => i.type === 'game_script_change');
  ok('a spread moving 3 to 6 is a game-script change', !!gs && gs.data.spreadOpen === 3 && gs.data.spreadCurrent === 6);
  ok('it names the side the market favors more', gs && gs.data.favoredMore === 'AAA');
  ok('and offers an interpretation built from the lines', gs && /market/.test(gs.data.interpretation));
  ok('every insight carries subject, type, data, magnitude, confidence and a timestamp',
     r.insights.every(i => i.subject && i.type && i.data && Number.isFinite(i.magnitude) && ['HIGH', 'MEDIUM', 'LOW'].includes(i.confidence) && i.ts > 0));
  ok('the unavailable rule is reported', r.unavailable.some(u => u.rule === 'goal_line_role_change'));
  ok('insights are ordered by confidence then magnitude',
     r.insights.every((x, i) => i === 0 || (['HIGH', 'MEDIUM', 'LOW'].indexOf(x.confidence) >= ['HIGH', 'MEDIUM', 'LOW'].indexOf(r.insights[i - 1].confidence))));
}

console.log('\nno usage means no usage insights');
{
  const r = H.detectInsights({ week: WEEK, usage: null, weekMarkets: {}, gameMarkets: {}, state: STATE, rules: H.SCORING_BASE });
  const usageTypes = ['production_below_opportunity', 'production_above_opportunity', 'role_increase', 'role_decrease', 'target_consolidation', 'backfield_consolidation', 'td_regression'];
  ok('an empty overlay yields none of the usage rules', !r.insights.some(i => usageTypes.includes(i.type)));
  ok('but the market rules still run', r.insights.some(i => /vegas_/.test(i.type)));
}

console.log('\nusage rules on a fixture overlay');
{
  const mk = (name, position, team, latest, season) => ({ name, position, team, latest, season });
  const usage = { throughWeek: 5, players: {
    'bigriser|WR': mk('Big Riser', 'WR', 'AAA', { week: 5, usage: { targets: 14, carries: 0, passAttempts: 0, snapPct: 0.9 }, stats: { rec: 4, recYd: 30, recTD: 0 } }, { games: 5, targets: 40, carries: 0, tds: 1, receptions: 30 }),
    'bigfader|RB': mk('Big Fader', 'RB', 'BBB', { week: 5, usage: { targets: 2, carries: 22, passAttempts: 0 }, stats: { rushYd: 170, rushTD: 3, rec: 2, recYd: 15 } }, { games: 5, targets: 10, carries: 60, tds: 9, receptions: 8 }),
    'otherback|RB': mk('Other Back', 'RB', 'BBB', { week: 5, usage: { targets: 0, carries: 3, passAttempts: 0 }, stats: { rushYd: 10 } }, { games: 5, targets: 0, carries: 40, tds: 0, receptions: 0 }),
    'steadyman|TE': mk('Steady Man', 'TE', 'CCC', { week: 5, usage: { targets: 6, carries: 0, passAttempts: 0 }, stats: { rec: 5, recYd: 55, recTD: 0 } }, { games: 5, targets: 30, carries: 0, tds: 2, receptions: 25 }),
    // Two ordinary backs, so the league's points-per-touch baseline is not set
    // by the two outliers the rules are meant to find.
    'plainback|RB': mk('Plain Back', 'RB', 'EEE', { week: 5, usage: { targets: 3, carries: 12, passAttempts: 0 }, stats: { rushYd: 55, rec: 2, recYd: 15 } }, { games: 5, targets: 15, carries: 60, tds: 2, receptions: 10 }),
    'otherplain|RB': mk('Other Plain', 'RB', 'FFF', { week: 5, usage: { targets: 3, carries: 12, passAttempts: 0 }, stats: { rushYd: 50, rec: 2, recYd: 20 } }, { games: 5, targets: 15, carries: 60, tds: 2, receptions: 10 })
  } };
  const r = H.detectInsights({ week: WEEK, usage, weekMarkets: {}, gameMarkets: {}, state: STATE, rules: H.SCORING_BASE });
  const of = (t, name) => r.insights.find(i => i.type === t && i.subject.name === name);
  ok('14 targets against an 8-a-game average is a role increase', !!of('role_increase', 'Big Riser'), JSON.stringify(r.insights.map(i => i.type + ':' + i.subject.name)));
  ok('and the data is on it', of('role_increase', 'Big Riser') && of('role_increase', 'Big Riser').data.latestTouches === 14 && of('role_increase', 'Big Riser').data.seasonAvgTouches === 8);
  ok('4 catches on 14 targets is production below opportunity', !!of('production_below_opportunity', 'Big Riser'));
  ok('three scores and 170 yards on 22 carries is production above opportunity', !!of('production_above_opportunity', 'Big Fader'));
  ok('nine touchdowns in five games against a low projection is TD regression', !!of('td_regression', 'Big Fader') && of('td_regression', 'Big Fader').data.direction === 'negative');
  ok('22 of 25 carries after 12-a-game is backfield consolidation', !!of('backfield_consolidation', 'Big Fader'), JSON.stringify(r.insights.filter(i => /consolidation/.test(i.type)).map(i => i.data)));
  ok('a steady player triggers nothing', !r.insights.some(i => i.subject.name === 'Steady Man' && i.type !== 'vegas_above_consensus' && i.type !== 'vegas_below_consensus'));
}

console.log('\nVegas Edge');
{
  const sig = H.detectInsights({ week: WEEK, usage: null, weekMarkets: WEEK_MARKETS, gameMarkets: GAME_MARKETS, state: STATE, rules: H.SCORING_BASE });
  const e = H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, STATE, sig);
  ok('vs experts splits buys from fades', e.vsExperts.buys[0].name === 'Big Riser' && e.vsExperts.fades[0].name === 'Big Fader');
  ok('movers are the markets that moved, biggest first', e.movers.length >= 2 && Math.abs(e.movers[0].percentChange) >= Math.abs(e.movers[1].percentChange));
  ok('the TD board says what each number is built from', e.tdBoard.every(t => t.basis === 'derived' || t.basis === 'anytime-td-market'));
  ok('the volume board says the same', e.volumeBoard.every(v => /props|derived/.test(v.basis)));
  // The prop board: every quoted market, one row per player per market.
  const pb = e.propBoard || [];
  const row = (name, m) => pb.find(r => r.name === name && r.market === m);
  ok('the prop board lists every quoted market for the clubs still to play', pb.length === 3 && !!row('Big Riser', 'recYd') && !!row('Big Riser', 'anytimeTD') && !!row('Big Fader', 'rushYd'), JSON.stringify(pb.map(r => r.name + ':' + r.market)));
  ok('a count market carries the median current line, its open and the move', row('Big Riser', 'recYd').line === 68.5 && row('Big Riser', 'recYd').open === 61.5 && row('Big Riser', 'recYd').movement === 7 && row('Big Riser', 'recYd').books === 2);
  ok('and the de-vigged over probability off the books\' prices', Math.abs(row('Big Riser', 'recYd').probability - 50) < 0.01 && row('Big Riser', 'recYd').overOdds === -110);
  ok('the model\'s own number sits beside the line, and the edge is the difference', row('Big Fader', 'rushYd').model == null ? row('Big Fader', 'rushYd').edge === null : row('Big Fader', 'rushYd').edge === Math.round((row('Big Fader', 'rushYd').model - 74.5) * 10) / 10);
  ok('an anytime-TD row is a probability, not a line, with the price the probability came from', row('Big Riser', 'anytimeTD').line === null && Math.abs(row('Big Riser', 'anytimeTD').probability - 37.7) < 0.1 && row('Big Riser', 'anytimeTD').overOdds === 165 && row('Big Riser', 'anytimeTD').openProbability != null);
  ok('and the model\'s TD number is the Poisson chance of at least one', Math.abs(row('Big Riser', 'anytimeTD').model - Math.round((1 - Math.exp(-0.55)) * 1000) / 10) < 0.01);
  ok('every row says it was quoted, names the label and the opponent, and never a book', pb.every(r => r.basis === 'quoted' && r.label && r.opponent && !('perBook' in r) && !('book' in r)));
  ok('the summary counts rows, players, markets and books', e.propSummary.rows === 3 && e.propSummary.players === 2 && e.propSummary.markets === 3 && e.propSummary.books === 2 && e.propSummary.capped === false, JSON.stringify(e.propSummary));
  // WHICH markets, not just how many. A total reads the same whether the books
  // posted nine markets or only anytime touchdowns, and only one of those two
  // feeds can project a receiver.
  ok('...and breaks the rows down by market, so one market cannot read as nine',
     e.propSummary.byMarket && Object.keys(e.propSummary.byMarket).length === 3
     && Object.values(e.propSummary.byMarket).reduce((s, n) => s + n, 0) === e.propSummary.rows,
     JSON.stringify(e.propSummary.byMarket));
  ok('widest disagreement first', pb.every((r, i) => i === 0 || Math.abs(pb[i - 1].edge ?? -1) >= Math.abs(r.edge ?? -1)));
  ok('games are ranked by total with implied points and movement', e.gameEnvironments[0].total === 47.5 && e.gameEnvironments[0].movement.spread === 3);
  ok('hidden signals are the game-script insights', e.hiddenSignals.length === 1 && e.hiddenSignals[0].type === 'game_script_change');
  ok('a week with props does not carry the no-props note', e.hasProps === true && e.note === null);
  const none = H.buildVegasEdge({ ok: true, players: WEEK.players.map(p => ({ ...p, vegas: { ...p.vegas, basis: 'gamelines' } })) }, {}, {}, STATE, { insights: [] });
  ok('a week with no props says so on the payload, without claiming what the books have posted',
     none.hasProps === false && /No priced player prop has reached this board/.test(none.note) && !/No sportsbook/.test(none.note));
}

console.log('\na game that has kicked off leaves Vegas Edge');
{
  // The same week, once BBB at AAA has been played. Big Riser (AAA) and Big
  // Fader (BBB) are results now; Steady Man (CCC) is still to play.
  const done = { ...STATE, games: STATE.games.map(g => g.id === '2026_02_BBB_AAA' ? { ...g, status: 'completed' } : g) };
  const sig = H.detectInsights({ week: WEEK, usage: null, weekMarkets: WEEK_MARKETS, gameMarkets: GAME_MARKETS, state: done, rules: H.SCORING_BASE });
  const e = H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, done, sig);
  const names = list => list.map(x => x.name);
  ok('vs experts no longer carries the players whose game was played', !names(e.vsExperts.buys).includes('Big Riser') && !names(e.vsExperts.fades).includes('Big Fader'), JSON.stringify([names(e.vsExperts.buys), names(e.vsExperts.fades)]));
  ok('nor do the movers', e.movers.length === 0, JSON.stringify(names(e.movers)));
  ok('nor the TD board and the volume board', names(e.tdBoard).join() === 'Steady Man' && names(e.volumeBoard).join() === 'Steady Man', JSON.stringify([names(e.tdBoard), names(e.volumeBoard)]));
  ok('nor the prop board: a played game\'s props are closing prices, not a market', e.propBoard.length === 0 && e.propSummary.rows === 0);
  ok('the game board keeps only the game still to be played', e.gameEnvironments.length === 1 && e.gameEnvironments[0].id === '2026_02_DDD_CCC');
  ok('and the game-script signal on the played game is gone', e.hiddenSignals.length === 0);
  ok('the payload says what it held back', e.played.games === 1 && e.played.of === 2 && e.played.players === 2 && /1 of the week.s 2 games have kicked off/.test(e.playedNote), JSON.stringify([e.played, e.playedNote]));
  ok('the props flag is still about the feed, not about who is left', e.hasProps === true);
  const live = H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, { ...STATE, games: STATE.games.map(g => g.id === '2026_02_BBB_AAA' ? { ...g, status: 'in_progress' } : g) }, sig);
  ok('a game under way counts as kicked off', live.gameEnvironments.length === 1 && !names(live.vsExperts.buys).includes('Big Riser'));
  const all = H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, { ...STATE, games: STATE.games.map(g => ({ ...g, status: 'completed' })) }, sig);
  ok('once every game has been played the boards are empty and the note says so', all.vsExperts.buys.length === 0 && all.tdBoard.length === 0 && all.gameEnvironments.length === 0 && /^Every game this week has kicked off/.test(all.playedNote));
  const post = H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, { ...STATE, games: STATE.games.map(g => g.id === '2026_02_BBB_AAA' ? { ...g, status: 'postponed' } : g) }, sig);
  ok('a postponed game has not kicked off, and is not counted among the week\'s games', names(post.vsExperts.buys).includes('Big Riser') && post.played.games === 0 && post.played.of === 1 && post.playedNote === null);
  const before = H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, STATE, H.detectInsights({ week: WEEK, usage: null, weekMarkets: WEEK_MARKETS, gameMarkets: GAME_MARKETS, state: STATE, rules: H.SCORING_BASE }));
  ok('before kickoff nothing is held back', before.played.games === 0 && before.played.players === 0 && before.playedNote === null && before.vsExperts.buys[0].name === 'Big Riser');
  ok('no schedule, no judgement', H.buildVegasEdge(WEEK, WEEK_MARKETS, GAME_MARKETS, { ok: false }, { insights: [] }).vsExperts.buys[0].name === 'Big Riser');
}

console.log('\nWednesday movers');
{
  const prev = { rank: 12, injury: null, roleTrend: { label: 'flat', pct: 2 }, games: 10, delta: { classification: 'MARKET AGREES' }, scheduleDifficulty: { label: 'Average' }, ppg: 14.2 };
  const cur = { rank: 4, injury: null, roleTrend: { label: 'up', pct: 40 }, games: 10, delta: { classification: 'STRONG VEGAS BUY' }, scheduleDifficulty: { label: 'Easy' }, ppg: 16.1 };
  const r = H.rosMoveReasons(prev, cur);
  ok('a move is explained by the fields that changed', r.some(x => /role trend up/.test(x)) && r.some(x => /strong vegas buy/.test(x)) && r.some(x => /easy/.test(x)) && r.some(x => /\+1\.9 points/.test(x)), JSON.stringify(r));
  ok('a new injury is the first reason', H.rosMoveReasons(cur, { ...cur, injury: { status: 'IR', gamesOut: 4 } })[0] === 'now listed IR (4 games)');
  ok('nothing changed is said honestly', H.rosMoveReasons(prev, prev)[0] === 'other players moved around him');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
