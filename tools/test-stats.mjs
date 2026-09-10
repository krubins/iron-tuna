#!/usr/bin/env node
// /stats and the two seasons behind it.
//   node tools/test-stats.mjs
//
// THE FIXTURE IS BUILT SO THE ANSWERS ARE KNOWN. Two overlay rows: this
// season, two weeks played, and last season, all eighteen. The same three
// players are in both with different lines, so a payload that reached for the
// wrong row is a wrong number rather than a missing one.
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
const teamKey = t => String(t || '').toUpperCase();
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const _oddsRound = v => Math.round(v * 10) / 10;
const _addStats = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; return a; };
const _roundStats = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, _oddsRound(v)]));

// The worker's own scoring engine, its usage overlay and its stats payload.
// Everything else the three touch is injected, so the test exercises the real
// arithmetic and the real row selection and nothing else. One instance per
// scenario: the overlay memo is per isolate in the worker, which is right
// there and wrong here, where one process holds several fake stores.
const build = () => new Function(
  'teamKey', '_oddsNorm', '_oddsRound', '_addStats', '_roundStats',
  'oddsCacheInit', 'scheduleCacheRead', 'nflSeasonState', 'fetchStatsNflverseWeekly', 'fetchSnapsNflverse',
  'MARKET_ROW', 'MARKET_PRIOR_ROW', 'MARKET_MAX_AGE_MS', 'MARKET_PRIOR_MAX_AGE_MS', 'MARKET_MEMO_MS',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' +
  cut('// The usage overlay: one D1 row holding', '// Player props, grouped per player per market') + '\n' +
  cut('// -- what has actually happened', '// The odds pull, snapshotted.') + '\n' +
  'return { statsPayload, buildUsageOverlay, runUsageRefresh, runPriorUsageRefresh, usageCacheRead, ' +
  'PRIOR_SEASON_WEEKS, SCORING_PRESETS };'
)(teamKey, _oddsNorm, _oddsRound, _addStats, _roundStats,
  async () => {}, async () => ({ season: 2026, games: [] }), () => ({ ok: false }),
  async yr => WEEKLY[yr] || [], async yr => SNAPS[yr] || [], 5, 7, 14 * 86400000, 400 * 86400000, 300000);
const H = build();

// ── the fixture ────────────────────────────────────────────────────────────
// One line per week per player, so the season totals are countable by hand.
const line = (name, position, team, season, week, opponent, stats, usage) =>
  ({ name, position, team, season, week, seasonType: 'REG', opponent, stats, usage });
const WK = (rec, recYd, recTD) => ({ passYd: 0, passTD: 0, passInt: 0, rushYd: 0, rushTD: 0, recYd, recTD, rec, fumLost: 0 });
const USE = (targets, rec) => ({ carries: 0, targets, receptions: rec, airYards: targets * 10 });
const WEEKLY = { 2026: [], 2025: [] };
const SNAPS = { 2026: [], 2025: [] };
for (let w = 1; w <= 2; w++) {
  WEEKLY[2026].push(line('Alpha Receiver', 'WR', 'AAA', 2026, w, 'BBB', WK(5, 50, 1), USE(8, 5)));
  WEEKLY[2026].push(line('Beta Receiver', 'WR', 'BBB', 2026, w, 'AAA', WK(2, 20, 0), USE(4, 2)));
  SNAPS[2026].push({ name: 'Alpha Receiver', position: 'WR', team: 'AAA', season: 2026, week: w, seasonType: 'REG', snaps: 50, snapPct: 0.8 });
}
for (let w = 1; w <= 18; w++) {
  WEEKLY[2025].push(line('Alpha Receiver', 'WR', 'AAA', 2025, w, 'CCC', WK(1, 10, 0), USE(2, 1)));
  WEEKLY[2025].push(line('Beta Receiver', 'WR', 'BBB', 2025, w, 'AAA', WK(9, 90, 1), USE(12, 9)));
  WEEKLY[2025].push(line('Gamma End', 'TE', 'CCC', 2025, w, 'AAA', WK(4, 40, 0), USE(6, 4)));
  SNAPS[2025].push({ name: 'Beta Receiver', position: 'WR', team: 'BBB', season: 2025, week: w, seasonType: 'REG', snaps: 60, snapPct: 0.9 });
}
// A D1 stand-in that is exactly what the two readers use it for: one row per id.
const now = Date.now();
const makeDb = rows => ({
  rows,
  prepare(sql) {
    const self = this;
    return {
      bind(...args) {
        this.args = args;
        return {
          async first() {
            const id = args[0];
            return self.rows[id] ? { payload: self.rows[id].payload, updated_at: self.rows[id].updated_at,
                                     provider: self.rows[id].provider } : null;
          },
          async run() {
            if (/INSERT OR REPLACE/.test(sql)) self.rows[args[0]] = { payload: args[1], provider: args[2], updated_at: args[4] };
            return { success: true };
          }
        };
      },
      async run() { return { success: true }; },
      async first() { return null; }
    };
  }
});
const overlay = (yr, weeks) => JSON.stringify(H.buildUsageOverlay(yr, WEEKLY[yr], SNAPS[yr]));
const both = () => makeDb({ 5: { payload: overlay(2026), updated_at: now }, 7: { payload: overlay(2025), updated_at: now } });

console.log('\nthe overlay is folded the same way for either season');
{
  const cur = H.buildUsageOverlay(2026, WEEKLY[2026], SNAPS[2026]);
  const last = H.buildUsageOverlay(2025, WEEKLY[2025], SNAPS[2025]);
  ok('this season stops at the week that has been played', cur.season === 2026 && cur.throughWeek === 2);
  ok('last season carries all eighteen', last.season === 2025 && last.throughWeek === 18);
  const a = cur.players[_oddsNorm('Alpha Receiver') + '|WR'];
  ok('the season line accumulates week by week', a.season.games === 2 && a.season.stats.recYd === 100 && a.season.targets === 16);
  ok('the latest week is kept whole, with its snaps', a.latest.week === 2 && a.latest.usage.snapPct === 0.8);
  const b = last.players[_oddsNorm('Beta Receiver') + '|WR'];
  ok('and last season’s latest week is his last one, not this year’s', b.latest.week === 18 && b.season.games === 18);
}

console.log('\ntwo rows, two seasons, one board');
{
  const env = { LEADS_DB: both() };
  const cur = await H.statsPayload(env, { preset: 'ppr' });
  ok('with no season asked for, the board is the season being played', cur.ok && cur.seasonKey === 'current' && cur.season === 2026 && cur.throughWeek === 2);
  ok('and it names both seasons it can serve, newest first', cur.seasons.map(s => s.season).join() === '2026,2025' && cur.seasons.map(s => s.key).join() === 'current,prior');
  ok('the finished season is marked complete and the live one is not', cur.seasons[1].complete === true && cur.seasons[0].complete === false);
  const prior = await H.statsPayload(env, { preset: 'ppr', season: 'prior' });
  ok('season=prior reads last season', prior.ok && prior.seasonKey === 'prior' && prior.season === 2025 && prior.throughWeek === 18);
  ok('by year works too', (await H.statsPayload(env, { preset: 'ppr', season: '2025' })).season === 2025);
  ok('this year’s year reads as this year', (await H.statsPayload(env, { preset: 'ppr', season: '2026' })).seasonKey === 'current');
  ok('an unknown season is this season rather than an error', (await H.statsPayload(env, { preset: 'ppr', season: '1999' })).seasonKey === 'current');
  // Alpha: 2 x (5 rec, 50 yds) at PPR = 2 x 10 = 20. Last year: 18 x (1 rec, 10 yds) = 18 x 2 = 36.
  const aNow = cur.players.find(p => p.name === 'Alpha Receiver');
  const aWas = prior.players.find(p => p.name === 'Alpha Receiver');
  // 2 x (5 rec, 50 yds, 1 TD) at PPR = 2 x 16.
  ok('the points are this season’s on this season’s board', aNow.season.points === 32 && aNow.season.ppg === 16);
  ok('and last season’s on last season’s', aWas.season.points === 36 && aWas.season.ppg === 2);
  ok('the ranks are the season’s own', aNow.rank === 1 && aWas.rank === 2);
  ok('a player who only played last year is only on last year’s board',
     !cur.players.some(p => p.name === 'Gamma End') && prior.players.some(p => p.name === 'Gamma End'));
  ok('a finished season carries no live week', prior.week === null && prior.currentWeek === null && prior.complete === true);
  const half = await H.statsPayload(env, { preset: 'half', season: 'prior' });
  ok('last season re-scores at another preset', half.players.find(p => p.name === 'Alpha Receiver').season.points === 27 && half.scoring.preset === 'half');
  ok('the position filter still filters', (await H.statsPayload(env, { preset: 'ppr', season: 'prior', position: 'TE' })).players.every(p => p.position === 'TE'));
}

console.log('\nwhat is missing is said, not guessed');
{
  const A = build(), onlyLast = { LEADS_DB: makeDb({ 7: { payload: overlay(2025), updated_at: now } }) };
  const before = await A.statsPayload(onlyLast, { preset: 'ppr' });
  ok('before Week 1 this season is empty and says so', before.ok === false && /No weekly stats/.test(before.note));
  ok('but last season is still offered', before.seasons.length === 1 && before.seasons[0].key === 'prior');
  ok('and it serves', (await A.statsPayload(onlyLast, { preset: 'ppr', season: 'prior' })).ok === true);
  const B = build(), onlyNow = { LEADS_DB: makeDb({ 5: { payload: overlay(2026), updated_at: now } }) };
  const asked = await B.statsPayload(onlyNow, { preset: 'ppr', season: 'prior' });
  ok('a season that was never loaded is named, not faked', asked.ok === false && /Last season/.test(asked.note) && asked.players === undefined);
  ok('and the seasons list does not offer it', asked.seasons.length === 1 && asked.seasons[0].key === 'current');
  // The weeks after a season ends: the live row still holds it and the prior
  // row has not rolled over yet. That is one season, not two.
  const same = { LEADS_DB: makeDb({ 5: { payload: overlay(2025), updated_at: now }, 7: { payload: overlay(2025), updated_at: now } }) };
  ok('the same year in both rows is one button, not two', (await build().statsPayload(same, { preset: 'ppr' })).seasons.length === 1);
  const C = build(), stale = { LEADS_DB: makeDb({ 7: { payload: overlay(2025), updated_at: now - 500 * 86400000 } }) };
  ok('a row older than a year and a bit stops being served as last year', await C.usageCacheRead(stale, 7) === null);
  ok('while this season goes stale after a fortnight, as it always did',
     await build().usageCacheRead({ LEADS_DB: makeDb({ 5: { payload: overlay(2026), updated_at: now - 20 * 86400000 } }) }) === null);
}

console.log('\nthe daily rebuild of a season that does not change');
{
  const first = await build().runPriorUsageRefresh({ LEADS_DB: both() });
  ok('a row that already holds last season in full is left alone', first.ok && first.skipped === 'already built' && first.season === 2025);
  const empty = { LEADS_DB: makeDb({}) };
  const built = await build().runPriorUsageRefresh(empty);
  ok('a missing row is built from the feed', built.ok && !built.skipped && built.season === 2025 && built.throughWeek === 18 && built.players === 3);
  ok('into row 7, leaving this season’s row alone', !!empty.LEADS_DB.rows[7] && !empty.LEADS_DB.rows[5]);
  ok('and it is written as last season’s row', empty.LEADS_DB.rows[7].provider === 'nflverse-usage-prior');
  const part = { LEADS_DB: makeDb({ 7: { payload: JSON.stringify(H.buildUsageOverlay(2025, WEEKLY[2025].filter(r => r.week <= 9), [])), updated_at: now } }) };
  const redone = await build().runPriorUsageRefresh(part);
  ok('a half-built season is finished rather than kept', redone.throughWeek === 18 && !redone.skipped);
  const rolled = await build().runPriorUsageRefresh({ LEADS_DB: makeDb({ 7: { payload: overlay(2025), updated_at: now } }) }, { season: 2027 });
  ok('the year rolling over rebuilds it', rolled.ok && !rolled.skipped && rolled.season === 2026);
  const forced = await build().runPriorUsageRefresh({ LEADS_DB: both() }, { force: true });
  ok('and an operator can force it', forced.ok && !forced.skipped && forced.season === 2025);
  const live = { LEADS_DB: makeDb({}) };
  const cur = await build().runUsageRefresh(live, 2026);
  ok('the in-season refresh still writes row 5 only', cur.ok && cur.season === 2026 && !!live.LEADS_DB.rows[5] && !live.LEADS_DB.rows[7]);
  ok('and says so as this season’s row', live.LEADS_DB.rows[5].provider === 'nflverse-usage');
}

console.log('\nthe page');
{
  const page = fs.readFileSync(path.join(ROOT, 'stats.html'), 'utf8');
  ok('the season buttons are built from the payload, not written into the page',
     /id="stSeason"[^>]*><\/div>/.test(page) && /j\.seasons/.test(page));
  ok('the board is fetched per season', /season=' \+ encodeURIComponent\(season\)/.test(page));
  ok('and cached per season and preset, so switching back is not a round trip', /var ckey = function \(\) \{ return season \+ '\|' \+ preset; \};/.test(page));
  ok('a season nobody is on is still reachable when it is the only one', /list\.length === 1 && list\[0\]\.key !== season/.test(page));
  ok('the week view is named for what it is on a finished season', /prior \? 'Final week' : 'Latest week'/.test(page));
  ok('an answer for a season the reader has left is not drawn', /if \(asked !== ckey\(\)\) return;/.test(page));
  const worker = src;
  ok('the route passes the season through', /season: url\.searchParams\.get\('season'\)/.test(worker));
  ok('the daily job is on the table, in phase 1', /\{ job: 'usage-prior-refresh',[^\n]*phase: 1 \}/.test(worker));
  ok('and the log can run it', /'usage-prior-refresh':\s+env => runPriorUsageRefresh\(env\)/.test(worker));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
