#!/usr/bin/env node
// Tests for the NFL season/week service inside _worker.js.
//   node tools/test-season.mjs
//
// WHAT THIS IS GUARDING. The week is the first thing every in-season surface
// reads, and the tempting way to compute it -- "a new week starts on Tuesday" --
// is wrong for a whole day every week and wrong in kind for the postseason,
// which has rounds rather than weekdays. The rule the worker actually uses is
// "a week is current until its own last game has finished", and the fixture
// below is built so a weekday rule and the real rule give DIFFERENT answers at
// several named instants. A regression to a calendar rule fails here.
//
// _worker.js has no build step and exports only fetch/scheduled, so the section
// is lifted out of the source and evaluated with its four outside dependencies
// injected. These run the real shipped code, not a paraphrase of it.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── lift the section out of the worker ─────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const START = '// ── the NFL season and week ─';
const END = '// Memoized per isolate alongside _PROJ_ENC';
const s = src.indexOf(START), e = src.indexOf(END, s);
if (s < 0 || e < 0) { console.error('FAIL: could not locate the season section in _worker.js'); process.exit(1); }
const section = src.slice(s, e);

// The four symbols the section reads from elsewhere in the worker. etOffsetHours
// is the real one, copied by reference below, because the ET conversion is one
// of the things under test and a stub would test nothing.
const etOffsetHours = new Function('ms', src.slice(
  src.indexOf('function etOffsetHours(ms) {') + 'function etOffsetHours(ms) {'.length,
  src.indexOf('function etClock(ms) {')).replace(/\}\s*$/, ''));
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TEAM_ALIAS[u] || u; };
function _csvSplit(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

const harness = new Function('etOffsetHours', 'teamKey', '_csvSplit', 'NFLVERSE_GAMES_URL', 'oddsCacheInit', 'fetch', '_oddsRound', `
  ${section}
  return { _seasonEtToUtc, _seasonBuckets, seasonGameStatus, nflSeasonState, nflSeasonWeek,
           mergeSchedule, fetchScheduleNflverse, _espnGame, SEASON_GAME_MS, SEASON_ROUND_LABEL };
`);
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const W = harness(etOffsetHours, teamKey, _csvSplit, NFLVERSE, async () => {}, globalThis.fetch, v => Math.round(v * 10) / 10);

// ── the ET conversion ──────────────────────────────────────────────────────
// games.csv gives an Eastern date and an Eastern wall clock in two columns with
// no offset on either. A fixed -5 puts every September kickoff an hour late,
// which would make a Thursday night opener look like it ran into Friday.
console.log('\nEastern wall clock to UTC');
{
  ok('a September 8:20pm ET kickoff is 00:20Z (EDT, -4)',
    W._seasonEtToUtc('2026-09-10', '20:20') === Date.UTC(2026, 8, 11, 0, 20),
    new Date(W._seasonEtToUtc('2026-09-10', '20:20')).toISOString());
  ok('a January 1:00pm ET kickoff is 18:00Z (EST, -5)',
    W._seasonEtToUtc('2027-01-10', '13:00') === Date.UTC(2027, 0, 10, 18, 0),
    new Date(W._seasonEtToUtc('2027-01-10', '13:00')).toISOString());
  ok('the 9:30am ET London window is 13:30Z',
    W._seasonEtToUtc('2026-10-04', '09:30') === Date.UTC(2026, 9, 4, 13, 30));
  ok('a missing clock falls back to the 1pm window, not to midnight',
    W._seasonEtToUtc('2026-09-13', '') === Date.UTC(2026, 8, 13, 17, 0));
  ok('a malformed date is NaN rather than epoch', !Number.isFinite(W._seasonEtToUtc('nope', '13:00')));
}

// ── the fixture season ─────────────────────────────────────────────────────
// Built so that the real rule and a weekday rule disagree at named instants.
const ET = (d, t) => W._seasonEtToUtc(d, t);
const g = (id, type, week, day, time, away, home, extra) =>
  ({ id, type, week, kickoff: ET(day, time), away, home,
     homeScore: null, awayScore: null, spread: null, total: null, status: null, src: 'fixture', ...(extra || {}) });

// Four clubs is enough for status and ordering; the bye assertion needs a real
// 32-club league, so it gets one below.
const FIX = [
  // Preseason: ESPN-supplied, which is the only way it can be here at all.
  g('pre3-a', 'PRE', 3, '2026-08-22', '19:00', 'AAA', 'BBB'),
  g('pre3-b', 'PRE', 3, '2026-08-22', '19:00', 'CCC', 'DDD'),
  // Week 1: Thursday opener, Sunday early, Sunday night, Monday night.
  g('w1-thu', 'REG', 1, '2026-09-10', '20:20', 'AAA', 'BBB'),
  g('w1-early', 'REG', 1, '2026-09-13', '13:00', 'CCC', 'DDD'),
  g('w1-snf', 'REG', 1, '2026-09-13', '20:20', 'EEE', 'FFF'),
  // 8:20pm ET, so this game is still being played after midnight Eastern -- the
  // instant a 'Tuesday starts the week' rule turns the week over mid-broadcast.
  g('w1-mnf', 'REG', 1, '2026-09-14', '20:20', 'GGG', 'HHH'),
  // Week 2: a London 9:30am kickoff and nothing later than Sunday afternoon —
  // so this week ENDS on a Sunday evening, which no weekday rule can express.
  g('w2-lon', 'REG', 2, '2026-09-20', '09:30', 'AAA', 'CCC'),
  g('w2-late', 'REG', 2, '2026-09-20', '16:25', 'BBB', 'DDD'),
  // Week 3: one game is postponed. It stays in the week and must not hold the
  // week open past the games that were actually played.
  g('w3-a', 'REG', 3, '2026-09-27', '13:00', 'AAA', 'DDD'),
  g('w3-off', 'REG', 3, '2026-09-27', '16:25', 'BBB', 'CCC', { status: 'postponed' }),
  // Week 18: Saturday and Sunday, no Monday game at all.
  g('w18-sat', 'REG', 18, '2027-01-09', '16:30', 'AAA', 'BBB'),
  g('w18-sun', 'REG', 18, '2027-01-10', '13:00', 'CCC', 'DDD'),
  // The postseason: rounds, not weeks, and Saturday through Monday.
  g('wc-sat', 'WC', 1, '2027-01-16', '16:30', 'AAA', 'CCC'),
  g('wc-mon', 'WC', 1, '2027-01-18', '20:15', 'BBB', 'DDD'),
  g('div-a', 'DIV', 2, '2027-01-23', '16:30', 'AAA', 'BBB'),
  g('con-a', 'CON', 3, '2027-01-31', '15:00', 'AAA', 'CCC'),
  g('sb', 'SB', 5, '2027-02-07', '18:30', 'AAA', 'CCC')
];
const CACHE = { season: 2026, games: FIX, provider: 'fixture', updatedAt: Date.now() };
const at = (d, t) => ET(d, t);
const state = (d, t) => W.nflSeasonState(CACHE, at(d, t));

console.log('\nthe week is the schedule, not the weekday');
{
  // The instant a weekday rule gets wrong every single week.
  const mondayNight = state('2026-09-14', '21:30');
  ok('Monday 9:30pm ET, with Monday night still being played, is still Week 1',
    mondayNight.week.number === 1 && mondayNight.week.type === 'REG', JSON.stringify(mondayNight.week.label));
  ok('...and that game reads in progress',
    mondayNight.counts.inProgress === 1 && mondayNight.counts.completed === 3,
    JSON.stringify(mondayNight.counts));

  // Midnight is not the boundary either: Monday night runs past it, and a rule
  // that turns the week over at 00:00 Tuesday does so mid-broadcast.
  const justAfterMidnight = state('2026-09-15', '00:02');
  ok('Tuesday 12:02am ET, mid-game, is STILL Week 1', justAfterMidnight.week.number === 1,
    'week ' + justAfterMidnight.week.number);

  // The boundary is the end of the last game, and nothing else.
  const afterMnf = state('2026-09-15', '04:30');
  ok('once Monday night is over the week turns to Week 2', afterMnf.week.number === 2,
    String(afterMnf.week.number));
  ok('and Week 2 reads as upcoming, not active', afterMnf.week.status === 'upcoming', afterMnf.week.status);

  // Monday morning: the week is not over, and its last game has not started.
  const mondayAm = state('2026-09-14', '09:00');
  ok('Monday morning is Week 1 with one game still upcoming',
    mondayAm.week.number === 1 && mondayAm.counts.upcoming === 1 && mondayAm.counts.completed === 3,
    JSON.stringify(mondayAm.counts));

  // A week with no Monday game ends on the Sunday. A Tuesday rule would leave
  // it up for two extra days.
  const sundayEve = state('2026-09-20', '20:30');
  ok('a week whose last game is Sunday afternoon is over on Sunday evening',
    sundayEve.week.number === 3, 'week ' + sundayEve.week.number);
  const sundayLate = state('2026-09-20', '19:00');
  ok('...but not while that 4:25 game is still on', sundayLate.week.number === 2,
    'week ' + sundayLate.week.number);
}

console.log('\ngames in progress, upcoming and completed');
{
  const sundayAfternoon = state('2026-09-13', '14:00');
  ok('at 2pm ET the 1pm game is in progress and the night game is not',
    sundayAfternoon.counts.inProgress === 1 && sundayAfternoon.counts.upcoming === 2,
    JSON.stringify(sundayAfternoon.counts));
  ok('the Thursday game is already completed', sundayAfternoon.counts.completed === 1);
  ok('nextGame is the next kickoff, not the next row',
    sundayAfternoon.nextGame && sundayAfternoon.nextGame.id === 'w1-snf',
    sundayAfternoon.nextGame && sundayAfternoon.nextGame.id);
  ok('lastCompleted is the most recent finish',
    sundayAfternoon.lastCompleted && sundayAfternoon.lastCompleted.id === 'w1-thu');

  // The feed is believed when it says final, and disbelieved when it says
  // scheduled: a cached row written before kickoff still says scheduled.
  const early = { ...FIX.find(x => x.id === 'w1-early') };
  ok('a feed "final" beats the clock',
    W.seasonGameStatus({ ...early, status: 'final' }, at('2026-09-13', '13:30')).status === 'completed');
  ok('a stale feed "scheduled" does not stop the clock',
    W.seasonGameStatus({ ...early, status: 'scheduled' }, at('2026-09-13', '23:00')).status === 'completed');
  ok('the source of every status is reported',
    W.seasonGameStatus({ ...early, status: 'final' }, at('2026-09-13', '13:30')).source === 'feed' &&
    W.seasonGameStatus(early, at('2026-09-13', '13:30')).source === 'clock');

  // A postponed game keeps its place in the week without holding it open.
  const w3done = state('2026-09-27', '20:00');
  ok('a postponed game does not hold its week open', w3done.week.number === 18,
    'week ' + w3done.week.number);
  const w3live = state('2026-09-27', '14:00');
  ok('...and is still listed in the week it belongs to',
    w3live.week.number === 3 && w3live.games.some(x => x.status === 'postponed'));
}

console.log('\nphases');
{
  ok('August is the preseason', state('2026-08-22', '20:00').phase === 'preseason',
    state('2026-08-22', '20:00').phase);
  ok('September is the regular season', state('2026-09-13', '14:00').phase === 'regular');
  ok('mid-January is the playoffs', state('2027-01-16', '18:00').phase === 'postseason',
    state('2027-01-16', '18:00').phase);
  ok('the playoff round is named, not numbered',
    state('2027-01-16', '18:00').week.label === 'Wild Card',
    state('2027-01-16', '18:00').week.label);
  ok('the Super Bowl is its own round', state('2027-02-07', '19:00').week.label === 'Super Bowl');
  ok('after the Super Bowl the season is complete',
    state('2027-02-08', '12:00').phase === 'offseason' && state('2027-02-08', '12:00').seasonComplete);
  ok('long before anything kicks off it is the offseason',
    state('2026-05-01', '12:00').phase === 'offseason', state('2026-05-01', '12:00').phase);
  ok('the gap between the last preseason game and Week 1 reads as Week 1, upcoming',
    state('2026-09-02', '12:00').week.number === 1 && state('2026-09-02', '12:00').week.status === 'upcoming');
}

console.log('\nbyes come off the schedule');
{
  // A real 32-club league so "who is off this week" has a real answer.
  const CLUBS = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND',
                 'JAX','KC','LA','LAC','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
  const games = [];
  // Week 1: everyone plays. Week 2: two clubs are on bye.
  for (let i = 0; i < CLUBS.length; i += 2) games.push(g('a' + i, 'REG', 1, '2026-09-13', '13:00', CLUBS[i], CLUBS[i + 1]));
  const off = new Set(['KC', 'PHI']);
  const playing = CLUBS.filter(t => !off.has(t));
  for (let i = 0; i < playing.length; i += 2) games.push(g('b' + i, 'REG', 2, '2026-09-20', '13:00', playing[i], playing[i + 1]));
  const st = W.nflSeasonState({ season: 2026, games, updatedAt: Date.now() }, at('2026-09-20', '14:00'));
  ok('the clubs not on the week\'s slate are the byes',
    st.week.byes.join(',') === 'KC,PHI', st.week.byes.join(','));
  const st1 = W.nflSeasonState({ season: 2026, games, updatedAt: Date.now() }, at('2026-09-13', '14:00'));
  ok('a week where everyone plays has no byes', st1.week.byes.length === 0);
}

console.log('\nbrowsing another week never rewrites the clock');
{
  const now = at('2026-11-01', '14:00');   // past every REG week in the fixture except 18
  const asked = W.nflSeasonWeek(CACHE, now, 'REG', 1);
  ok('the requested week is returned', asked.requested.found && asked.requested.number === 1);
  ok('its games are all completed, because they are',
    asked.counts.completed === 4 && asked.counts.upcoming === 0, JSON.stringify(asked.counts));
  ok('and `week` still reports the week it really is',
    asked.week.number === 18, 'week ' + asked.week.number);
  const missing = W.nflSeasonWeek(CACHE, now, 'REG', 99);
  ok('a week that does not exist says so rather than guessing',
    missing.requested && missing.requested.found === false);
  const round = W.nflSeasonWeek(CACHE, now, 'SB', null);
  ok('a round can be asked for by name', round.requested.found && round.requested.label === 'Super Bowl');
}

console.log('\nimplied points ride on every game');
{
  // The sign convention of the feed stops in the worker: a page reads
  // impliedHome / impliedAway and never touches the spread.
  const games = [ { ...g('imp', 'REG', 1, '2026-09-13', '13:00', 'AAA', 'BBB'), spread: 3.5, total: 44.5 },
                  g('noline', 'REG', 1, '2026-09-13', '16:25', 'CCC', 'DDD') ];
  const st = W.nflSeasonState({ season: 2026, games, updatedAt: Date.now() }, at('2026-09-13', '12:00'));
  const a = st.games.find(x => x.id === 'imp'), b = st.games.find(x => x.id === 'noline');
  ok('a favoured home side gets half the total plus half the margin', a.impliedHome === 24 && a.impliedAway === 20.5,
     JSON.stringify([a.impliedHome, a.impliedAway]));
  ok('an unpriced game carries nulls, not zeros', b.impliedHome === null && b.impliedAway === null);
  const asked = W.nflSeasonWeek({ season: 2026, games, updatedAt: Date.now() }, at('2026-09-13', '12:00'), 'REG', 1);
  ok('the named-week path carries the same fields', asked.games.find(x => x.id === 'imp').impliedHome === 24);
}

console.log('\nthe season index');
{
  const st = state('2026-09-13', '14:00');
  ok('every week in the season is listed once', st.weeks.length === new Set(FIX.map(x => x.type + ':' + x.week)).size);
  ok('exactly one week is current', st.weeks.filter(w => w.current).length === 1);
  ok('the index is in calendar order',
    st.weeks.every((w, i) => i === 0 || w.firstKickoff >= st.weeks[i - 1].firstKickoff));
  ok('the current week in the index is the current week in the payload',
    st.weeks.find(w => w.current).number === st.week.number);
}

console.log('\nmerging the live layer onto the spine');
{
  const spine = [
    g('s1', 'REG', 1, '2026-09-13', '13:00', 'AAA', 'BBB'),
    g('s2', 'REG', 1, '2026-09-13', '13:00', 'CCC', 'DDD')
  ];
  const live = [
    { id: 'espn-1', type: 'REG', week: 1, kickoff: ET('2026-09-13', '13:02'), away: 'AAA', home: 'BBB',
      homeScore: 17, awayScore: 24, status: 'final', src: 'espn' },
    { id: 'espn-2', type: 'PRE', week: 3, kickoff: ET('2026-08-22', '19:00'), away: 'EEE', home: 'FFF',
      homeScore: null, awayScore: null, status: 'scheduled', src: 'espn' },
    { id: 'espn-3', type: 'POST', week: 1, kickoff: ET('2027-01-16', '16:30'), away: 'GGG', home: 'HHH',
      homeScore: null, awayScore: null, status: 'scheduled', src: 'espn' }
  ];
  const m = W.mergeSchedule(spine, live);
  const s1 = m.games.find(x => x.id === 's1');
  ok('a live result lands on the matching spine game',
    s1.status === 'final' && s1.homeScore === 17 && s1.awayScore === 24);
  ok('...and the feed\'s exact kickoff replaces the converted one', s1.kickoff === ET('2026-09-13', '13:02'));
  ok('the other spine game is untouched', m.games.find(x => x.id === 's2').status === null);
  ok('a preseason game the spine cannot have is added', m.added === 1 && m.games.some(x => x.id === 'espn-2'));
  ok('an unmatched playoff game is NOT guessed into a round', !m.games.some(x => x.id === 'espn-3'));
  ok('the merged list stays in kickoff order',
    m.games.every((x, i) => i === 0 || x.kickoff >= m.games[i - 1].kickoff));

  // The pair match must not reach across a season: the same two clubs meet
  // twice a year, and a 48-hour window is what keeps week 3's result off week 14.
  const far = W.mergeSchedule(spine, [{ ...live[0], kickoff: ET('2026-12-13', '13:00') }]);
  ok('a result for the same pairing months later is not applied',
    far.updated === 0 && far.games.find(x => x.id === 's1').status === null);
}

console.log('\nan empty or missing schedule fails closed');
{
  ok('no games at all is an error, not a week 1',
    W.nflSeasonState({ season: 2026, games: [] }, Date.now()).ok === false);
  ok('a null cache is an error too', W.nflSeasonState(null, Date.now()).ok === false);
}

// ── the real feed ──────────────────────────────────────────────────────────
// Self-skips without network, the same way the odds suites do, so CI never goes
// green on a step that could not run.
console.log('\nthe live nflverse schedule');
{
  let real = null;
  try { real = await W.fetchScheduleNflverse(); }
  catch (e) { console.log('  skip  no network or feed unavailable (' + ((e && e.message) || e) + ')'); }
  if (real) {
    ok('a season was identified', real.season >= 2026 && real.season < 2100, String(real.season));
    const reg = real.games.filter(x => x.type === 'REG');
    ok('the regular season is a full 272 games', reg.length === 272, String(reg.length));
    ok('it runs 18 weeks', new Set(reg.map(x => x.week)).size === 18);
    ok('every kickoff parsed', real.games.every(x => Number.isFinite(x.kickoff)));
    ok('every club is a normalised abbreviation',
      real.games.every(x => /^[A-Z]{2,3}$/.test(x.home) && /^[A-Z]{2,3}$/.test(x.away)));
    ok('32 clubs, no more and no fewer',
      new Set(reg.flatMap(x => [x.home, x.away])).size === 32,
      String(new Set(reg.flatMap(x => [x.home, x.away])).size));
    // Every club plays 17 games across 18 weeks, which is the byes proving
    // themselves without a bye column existing anywhere in the feed.
    const played = {};
    for (const x of reg) { played[x.home] = (played[x.home] || 0) + 1; played[x.away] = (played[x.away] || 0) + 1; }
    ok('every club plays exactly 17 regular-season games',
      Object.values(played).every(n => n === 17), JSON.stringify(Object.entries(played).filter(([, n]) => n !== 17)));
    const st = W.nflSeasonState({ season: real.season, games: real.games, updatedAt: Date.now() }, Date.now());
    ok('the real schedule produces a real week', st.ok && !!st.week.label, JSON.stringify(st.week && st.week.label));
    ok('and a phase the calendar agrees with',
      ['offseason', 'preseason', 'regular', 'postseason'].includes(st.phase), st.phase);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
