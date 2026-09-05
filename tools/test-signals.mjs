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
  cut('// -- kickers and defences, scored', '// -- the player intel payload') + '\n' +
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
  ok('it names the side the market favours more', gs && gs.data.favouredMore === 'AAA');
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
  ok('games are ranked by total with implied points and movement', e.gameEnvironments[0].total === 47.5 && e.gameEnvironments[0].movement.spread === 3);
  ok('hidden signals are the game-script insights', e.hiddenSignals.length === 1 && e.hiddenSignals[0].type === 'game_script_change');
  ok('a week with props does not carry the no-props note', e.hasProps === true && e.note === null);
  const none = H.buildVegasEdge({ ok: true, players: WEEK.players.map(p => ({ ...p, vegas: { ...p.vegas, basis: 'gamelines' } })) }, {}, {}, STATE, { insights: [] });
  ok('a week with no props says so on the payload', none.hasProps === false && /No sportsbook/.test(none.note));
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
