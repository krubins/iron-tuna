#!/usr/bin/env node
// The provider layer, the historical betting store, and the Vegas-implied
// fantasy projections.
//   node tools/test-market.mjs
//
// THREE THINGS THIS EXISTS TO STOP.
//   1. A credential reaching a response. providerReport must say WHETHER a key
//      is set and never what it is, and no payload may carry one.
//   2. A betting line being overwritten. The whole Vegas Edge product is "it
//      opened at 59.5 and it is 67.5 now"; a store that kept only the latest
//      value would make that unanswerable, and the failure would be silent.
//   3. A fabricated market. If nobody priced a receiver's yards, the answer is
//      "Vegas projection unavailable", not a number quietly borrowed from a
//      projection feed and printed under a Vegas heading.

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

// ── lift the sections ──────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.error('FAIL: could not locate ' + from.slice(0, 40)); process.exit(1); }
  return src.slice(a, b);
};
const scoring = cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {');
const odds = cut('function _oddsImpliedProb(', '// The Odds API v4. WRITTEN');
const providers = cut('// ── the provider layer ─', '// -- historical betting markets');
const snapshots = cut('// -- historical betting markets', '// -- sportsbook markets into fantasy projections');
const vegas = cut('// -- sportsbook markets into fantasy projections', '// -- the Iron Tuna Market Engine');
const adapter = cut('// The Odds API v4. WRITTEN', 'const NFLVERSE_GAMES_URL');
const overlay = cut('function _oddsProjectionIndex()', 'function blendProjections(');

// The handful of symbols those sections read from elsewhere in the worker.
const _oddsRound = v => Math.round(v * 10) / 10;
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TEAM_ALIAS[u] || u; };
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const ODDS_CV = { passYd: 0.20, passTD: 0.28, passInt: 0.35, rushYd: 0.30, rushTD: 0.40,
                  recYd: 0.30, recTD: 0.40, rec: 0.28, scrimmageTD: 0.40 };
const stub = () => { throw new Error('not needed in this test'); };

const M = new Function(
  '_oddsRound', 'teamKey', '_oddsNorm', 'ODDS_CV', '_csvSplit', 'PROJECTIONS', '_availPool',
  'fetchScheduleNflverse', 'fetchScheduleEspn', 'fetchOddsTheOddsApi', 'fetchInjuriesEspn',
  'buildAvailabilityOverlay', 'fetch', 'ODDS_BANDS',
  `${scoring}\n${odds}\n${adapter}\n${providers}\n${snapshots}\n${vegas}\n${overlay}\n` +
  'return { scoringRules, scoreStats, SCORING_BASE, tdPointsFor, PROVIDERS, PROVIDER_KINDS, ' +
  'providerRun, providerReport, PROVIDER_UNAVAILABLE, snapshotWrite, snapshotStatus, ' +
  'marketHistoryFrom, marketHistory, marketHistoryAll, marketAgreement, _median, _snapSame, ' +
  'vegasProjection, vegasCountMarket, vegasTdProbability, vegasConfidence, VEGAS_MARKETS, ' +
  '_oddsImpliedProb, _oddsDevigOver, parseOddsApiEvent, buildVegasOverlay, snapshotSubject, _snapLookup };'
)(_oddsRound, teamKey, _oddsNorm, ODDS_CV, stub,
  [ { name: "Ja'Marr Chase", position: 'WR', team: 'CIN', projectedStats: { rec: 100, recYd: 1400, recTD: 10 } },
    { name: 'Test Receiver', position: 'WR', team: 'AAA', projectedStats: { rec: 60, recYd: 800, recTD: 5 } },
    { name: 'Same Name', position: 'RB', team: 'BBB', projectedStats: { rushYd: 900, rushTD: 6 } },
    { name: 'Same Name', position: 'WR', team: 'CCC', projectedStats: { rec: 50, recYd: 700, recTD: 4 } } ],
  (x) => x,
  stub, stub, stub, stub, stub, stub,
  { passYd: [1200, 6500], passTD: [4, 60], passInt: [0, 30], rushYd: [150, 2600], rushTD: [0, 30],
    recYd: [150, 2300], recTD: [0, 30], rec: [10, 160], scrimmageTD: [0, 40] });

// ── 1. the provider registry ───────────────────────────────────────────────
console.log('\nthe provider layer');
{
  const WANT = ['schedule', 'odds', 'projection', 'consensus', 'stats', 'injury', 'dfs'];
  for (const k of WANT) ok(`there is a ${k} provider kind`, Array.isArray(M.PROVIDERS[k]) && M.PROVIDERS[k].length > 0);
  ok('every provider has a name and a fetch',
     Object.values(M.PROVIDERS).flat().every(p => p.name && typeof p.fetch === 'function'));

  // A keyed provider is skipped without its key and offered with it. This is
  // what makes the site work with no credentials at all.
  const paid = Object.values(M.PROVIDERS).flat().filter(p => p.needs);
  ok('the paid providers declare what they need', paid.length >= 2, String(paid.length));
  ok('none of them is configured on an empty env', paid.every(p => !p.needs({})));
  ok('the odds feed turns on with its key',
     M.PROVIDERS.odds.find(p => p.name === 'the-odds-api').needs({ ODDS_API_KEY: 'x' }) === true);
  ok('the free providers need nothing',
     M.PROVIDERS.schedule.every(p => !p.needs) && M.PROVIDERS.projection.every(p => !p.needs));

  // The report is what /api/admin/providers publishes.
  const rep = M.providerReport({ ODDS_API_KEY: 'sk-secret-value-do-not-leak' });
  const flat = JSON.stringify(rep);
  ok('the report says the odds key is present',
     rep.providers.odds.find(p => p.name === 'the-odds-api').configured === true);
  ok('and does NOT contain the key itself', !flat.includes('sk-secret-value-do-not-leak'));
  ok('nor any field that looks like a credential', !/api[_-]?key["':]/i.test(flat));
  ok('it names the fields no source can supply', Object.keys(rep.unavailable).length >= 5);
  ok('routes are declared unavailable rather than guessed', !!rep.unavailable.routes);
  ok('DFS salaries are declared unavailable without a licensed feed', !!rep.unavailable.dfsSalary);

  // No adapter may reach a site that is not an API.
  const block = providers;
  ok('no adapter scrapes an HTML page',
     !/text\/html|document\.|querySelector|cheerio|<div/i.test(block));
  ok('every remote host is a published data feed',
     [...block.matchAll(/https?:\/\/([a-z0-9.\-]+)/g)].map(m => m[1])
       .every(h => /nflverse|github\.com|espn\.com|the-odds-api\.com|sleeper\.app/.test(h)),
     [...new Set([...block.matchAll(/https?:\/\/([a-z0-9.\-]+)/g)].map(m => m[1]))].join(','));

  // An unknown kind is an answer, not a crash.
  const bad = await M.providerRun({}, 'nope');
  ok('an unknown kind reports itself rather than throwing', bad.ok === false && bad.error === 'unknown_kind');
  // A kind whose only provider needs a key it does not have reports "not
  // configured" and an empty result -- it does not fail the run.
  const dfs = await M.providerRun({}, 'dfs');
  ok('an unconfigured kind is skipped, not failed',
     dfs.ok === false && dfs.results[0].skipped === 'not configured');
}

// ── 2. the snapshot store ──────────────────────────────────────────────────
// A minimal in-memory D1 that answers only the statements this store issues.
function fakeDb() {
  const rows = [];
  const run = (sql, args) => {
    if (/^CREATE|^ALTER/i.test(sql)) return { meta: {} };
    if (/^INSERT INTO odds_snapshots/i.test(sql)) {
      rows.push({ ts: args[0], season: args[1], week: args[2], book: args[3], subject_type: args[4],
                  subject: args[5], market: args[6], line: args[7], over_odds: args[8],
                  under_odds: args[9], game_id: args[10], raw_subject: args[11] });
      return { meta: { changes: 1 } };
    }
    if (/^DELETE FROM odds_snapshots WHERE ts/i.test(sql)) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].ts < args[0]) rows.splice(i, 1);
      return { meta: { changes: before - rows.length } };
    }
    return { meta: {} };
  };
  const all = (sql, args) => {
    if (/GROUP BY book, subject_type, subject, market/i.test(sql)) {
      const by = new Map();
      for (const r of rows) {
        const k = r.book + ' ' + r.subject_type + ' ' + r.subject + ' ' + r.market;
        if (!by.has(k) || by.get(k).ts < r.ts) by.set(k, r);
      }
      return { results: [...by.values()] };
    }
    if (/WHERE subject = \? AND market = \?/i.test(sql)) {
      return { results: rows.filter(r => r.subject === args[0] && r.market === args[1]).sort((a, b) => a.ts - b.ts) };
    }
    if (/WHERE subject = \?/i.test(sql)) {
      return { results: rows.filter(r => r.subject === args[0]).sort((a, b) => a.ts - b.ts) };
    }
    return { results: [] };
  };
  const first = (sql) => {
    if (/COUNT\(\*\) AS rows/i.test(sql)) {
      return { rows: rows.length, subjects: new Set(rows.map(r => r.subject)).size,
               books: new Set(rows.map(r => r.book)).size, markets: new Set(rows.map(r => r.market)).size,
               first: Math.min(...rows.map(r => r.ts)), last: Math.max(...rows.map(r => r.ts)) };
    }
    return null;
  };
  const prepare = (sql) => {
    const st = { sql, args: [] };
    st.bind = (...a) => ({ ...st, args: a, run: () => run(sql, a), all: () => all(sql, a), first: () => first(sql, a) });
    st.run = () => run(sql, []);
    st.all = () => all(sql, []);
    st.first = () => first(sql, []);
    return st;
  };
  return { _rows: rows, prepare, batch: async (stmts) => stmts.map(s => s.run()) };
}

console.log('\nthe historical betting store');
{
  const db = fakeDb();
  const env = { LEADS_DB: db };
  const row = (book, line, over, under) => ({ book, subjectType: 'player', subject: 'Test Receiver',
    market: 'recYd', line, overOdds: over, underOdds: under, gameId: 'g1' });

  const t0 = Date.UTC(2026, 8, 1, 12);
  const a = await M.snapshotWrite(env, [row('dk', 59.5, -110, -110), row('fd', 60.5, -112, -108)], { ts: t0, season: 2026, week: 1 });
  ok('the first pull is written', a.written === 2, JSON.stringify(a));

  // The same lines again: nothing new. Four pulls a day would otherwise pile up
  // six figures of identical rows a week.
  const b = await M.snapshotWrite(env, [row('dk', 59.5, -110, -110), row('fd', 60.5, -112, -108)], { ts: t0 + 3600000 });
  ok('an unchanged line writes nothing', b.written === 0 && b.unchanged === 2, JSON.stringify(b));

  // Juice moving with the number standing still IS a move: the de-vigged
  // probability changed, so the projection changes.
  const c = await M.snapshotWrite(env, [row('dk', 59.5, -135, +105)], { ts: t0 + 7200000 });
  ok('a price move at the same number is recorded', c.written === 1, JSON.stringify(c));

  const d = await M.snapshotWrite(env, [row('dk', 67.5, -110, -110), row('fd', 67.5, -110, -110),
                                        row('mgm', 66.5, -115, -105)], { ts: t0 + 10800000 });
  ok('a real move is recorded for every book that made it', d.written === 3, JSON.stringify(d));

  // Nothing was overwritten: every row still stands.
  ok('the store is append-only', db._rows.length === 6, String(db._rows.length));

  const h = await M.marketHistory(env, 'Test Receiver', 'recYd');
  ok('it opened at the consensus of the books quoting then', near(h.open, 60), String(h.open));
  ok('a book that started quoting later did not rewrite the open',
     h.booksAtOpen === 2 && h.books === 3, `${h.booksAtOpen} at open, ${h.books} now`);
  ok('and it is at the median of their current lines', near(h.current, 67.5), String(h.current));
  ok('the movement is the difference', near(h.movement, 7.5), String(h.movement));
  ok('the percentage change is reported', near(h.percentChange, 12.5), String(h.percentChange));
  ok('three books are counted', h.books === 3, String(h.books));
  ok('and the number that moved is counted', h.booksMoved === 2, String(h.booksMoved));
  ok('direction is counted too', h.booksUp === 2 && h.booksDown === 0);
  ok('the median is the current consensus', near(h.median, 67.5));
  ok('agreement is high when the books are close', h.agreement === 1, String(h.agreement));
  ok('per-book detail survives', h.perBook.length === 3 && h.perBook.every(b2 => b2.book && b2.open != null));

  // The worked example from the brief.
  ok('the brief\'s example reads back as written',
     h.open === 60 && h.current === 67.5 && h.movement === 7.5,
     `open ${h.open} current ${h.current} movement ${h.movement}`);

  const all = await M.marketHistoryAll(env, 'Test Receiver');
  ok('every market for a subject comes back in one call', !!all.recYd && all.recYd.books === 3);

  const st = await M.snapshotStatus(env);
  ok('the store reports its own size', st.ok && st.rows === 6 && st.books === 3);
}

console.log('\nthe join key');
{
  // A book writes the name one way and the board another. Both land on the
  // same key, and the book's spelling is kept beside the row for audit.
  const db = fakeDb();
  const env = { LEADS_DB: db };
  const t0 = Date.UTC(2026, 8, 8, 12);
  await M.snapshotWrite(env, [{ book: 'dk', subjectType: 'player', subject: "Ja'Marr Chase", market: 'recYd',
                                line: 84.5, overOdds: -110, underOdds: -110 }], { ts: t0, season: 2026, week: 1 });
  ok('the stored subject is the site\'s key, not the book\'s spelling', db._rows[0].subject === 'jamarrchase', db._rows[0].subject);
  ok('the book\'s spelling is kept for audit', db._rows[0].raw_subject === "Ja'Marr Chase");
  ok('the board\'s spelling finds it', (await M.marketHistory(env, 'JaMarr Chase', 'recYd')) !== null);
  ok('the book\'s spelling finds it', (await M.marketHistory(env, "Ja'Marr Chase", 'recYd')) !== null);
  ok('the key itself finds it', (await M.marketHistory(env, 'jamarrchase', 'recYd')) !== null);
  ok('a game id is left alone', M._snapLookup('2026_01_NE_SEA') === '2026_01_NE_SEA');
  ok('a game subject is stored as its id', M.snapshotSubject({ subjectType: 'game', subject: '2026_01_NE_SEA' }) === '2026_01_NE_SEA');
  ok('a row with no usable subject is dropped',
     (await M.snapshotWrite(env, [{ book: 'dk', subjectType: 'player', subject: '???', market: 'recYd', line: 50 }], { ts: t0 })).seen === 0);
}

console.log('\nthe Odds API adapter, on a fixture event');
{
  // The v4 per-event shape: outcomes are Over/Under (or Yes/No) pairs keyed by
  // `description`, which is the player. Written to the published docs; the
  // live service has not been reachable to confirm.
  const ev = { id: 'evt1', commence_time: '2026-09-13T17:00:00Z', home_team: 'Cincinnati Bengals', away_team: 'Test Team',
    bookmakers: [
      { key: 'draftkings', title: 'DraftKings', markets: [
        { key: 'player_reception_yds', outcomes: [
          { name: 'Over', description: "Ja'Marr Chase", price: -115, point: 84.5 },
          { name: 'Under', description: "Ja'Marr Chase", price: -105, point: 84.5 } ] },
        { key: 'player_anytime_td', outcomes: [
          { name: 'Yes', description: "Ja'Marr Chase", price: -140 },
          { name: 'No', description: "Ja'Marr Chase", price: 110 } ] },
        { key: 'h2h', outcomes: [ { name: 'Cincinnati Bengals', price: -200 } ] },
        { key: 'player_pass_yds', outcomes: [ { name: 'Over', description: 'Nobody Priced', price: -110 } ] } ] } ] };
  const rows = M.parseOddsApiEvent(ev);
  ok('a yardage pair becomes one row with both prices',
     rows.some(r => r.market === 'recYd' && r.line === 84.5 && r.overOdds === -115 && r.underOdds === -105));
  ok('a Yes/No touchdown market becomes an anytimeTD row',
     rows.some(r => r.market === 'anytimeTD' && r.overOdds === -140 && r.underOdds === 110));
  ok('a market the map does not know is ignored', !rows.some(r => r.market === undefined));
  ok('an outcome with no line and no TD is dropped', !rows.some(r => r.player === 'Nobody Priced'));
  ok('every row carries the book, the game and the scope',
     rows.every(r => r.book === 'draftkings' && r.gameId === 'evt1' && r.scope === 'game'));
  ok('the season overlay refuses game-scoped rows',
     M.buildVegasOverlay(rows).matched === 0 && M.buildVegasOverlay(rows).skipped.gameScoped === rows.length);
  // The same rows are exactly what the snapshot store wants.
  const db = fakeDb();
  const w = await M.snapshotWrite({ LEADS_DB: db }, rows.map(r => ({ book: r.book, subjectType: 'player', subject: r.player,
    market: r.market, line: r.line, overOdds: r.overOdds, underOdds: r.underOdds, gameId: r.gameId })), { ts: 1 });
  ok('and they snapshot cleanly', w.written === 2, JSON.stringify(w));
}

console.log('\nmarket agreement');
{
  ok('one book is not agreement with anybody', M.marketAgreement([67.5]) === null);
  ok('books on the same number fully agree', M.marketAgreement([67.5, 67.5, 67.5]) === 1);
  ok('an outlier drags it down', near(M.marketAgreement([67.5, 67.5, 40]), 2 / 3));
  ok('half a point is not disagreement', M.marketAgreement([5.5, 6, 5.5]) === 1);
  ok('the median ignores the outlier', M._median([67.5, 67.5, 40]) === 67.5);
}

// ── 3. sportsbook markets into fantasy projections ─────────────────────────
console.log('\nAmerican odds into probability');
{
  ok('a favourite price is over even money', near(M._oddsImpliedProb(-200), 2 / 3, 1e-9));
  ok('an underdog price is under it', near(M._oddsImpliedProb(150), 0.4, 1e-9));
  const p = M._oddsDevigOver(-110, -110);
  ok('a balanced pair de-vigs to a coin flip', near(p, 0.5, 1e-9), String(p));
  const q = M._oddsDevigOver(-200, 170);
  ok('a juiced pair de-vigs to sum to one', q > 0.5 && q < 1, String(q));
}

console.log('\none market, several books');
{
  const rows = [
    { book: 'dk', line: 67.5, overOdds: -110, underOdds: -110 },
    { book: 'fd', line: 67.5, overOdds: -110, underOdds: -110 },
    { book: 'mgm', line: 66.5, overOdds: -110, underOdds: -110 },
    { book: 'stale', line: 95.5, overOdds: -110, underOdds: -110 }   // the outlier
  ];
  const got = M.vegasCountMarket('recYd', rows);
  ok('four books are counted', got.books === 4);
  ok('the consensus is the MEDIAN, not the mean', near(got.expected, 67.5, 0.01),
     'expected ' + got.expected + ' (a mean would be ' + ((67.5 + 67.5 + 66.5 + 95.5) / 4) + ')');
  ok('the outlier pulls agreement down', got.agreement === 0.75, String(got.agreement));
  ok('a balanced price leaves the mean at the line', near(got.line, 67.5));
  ok('an out-of-band line is dropped', M.vegasCountMarket('rec', [{ book: 'x', line: 90, overOdds: -110, underOdds: -110 }]) === null);
  ok('a market with no rows is null', M.vegasCountMarket('recYd', []) === null);
  ok('an unknown market is null', M.vegasCountMarket('nonsense', rows) === null);
}

console.log('\nthe touchdown market');
{
  const both = M.vegasTdProbability([{ book: 'dk', overOdds: -110, underOdds: -110 }]);
  ok('a two-sided TD price de-vigs', both.devigged === true && near(both.probability, 0.5, 1e-9));
  const one = M.vegasTdProbability([{ book: 'dk', overOdds: +120, underOdds: null }]);
  ok('a null "No" side is a missing side, not a zero', one !== null && one.devigged === false);
  ok('a one-sided price is used but flagged as carrying vig', one.devigged === false);
  ok('and it is the raw implied probability', near(one.probability, 1 / 2.2, 1e-9), String(one.probability));
  ok('no price at all is null', M.vegasTdProbability([]) === null);
}

console.log('\nthe projection itself');
{
  const R = M.scoringRules('ppr');
  const mk = (line, book) => ({ book, line, overOdds: -110, underOdds: -110 });
  // A fully priced receiver.
  const full = M.vegasProjection({
    recYd: [mk(80.5, 'dk'), mk(79.5, 'fd'), mk(80.5, 'mgm')],
    rec: [mk(6.5, 'dk'), mk(6.5, 'fd'), mk(6.5, 'mgm')],
    anytimeTD: [{ book: 'dk', overOdds: -110, underOdds: -110 }, { book: 'fd', overOdds: -110, underOdds: -110 }]
  }, 'WR', R, { asOf: Date.now() });
  ok('a fully priced receiver gets a full projection', full.ok && full.status === 'full', JSON.stringify(full.status));
  ok('it is labelled a Vegas projection', full.label === 'Vegas projection');
  ok('the stats are the market\'s, in Iron Tuna keys',
     near(full.stats.recYd, 80.5, 0.6) && near(full.stats.rec, 6.5, 0.1), JSON.stringify(full.stats));
  ok('the TD is expected VALUE, not a fractional touchdown',
     full.td && near(full.td.probability, 50, 0.1) && near(full.td.expectedPoints, 3, 0.01),
     JSON.stringify(full.td));
  ok('and it is added to the points', near(full.points, 80.5 / 10 + 6.5 + 3, 0.1), String(full.points));
  ok('the books are counted', full.books === 3, String(full.books));
  ok('confidence is HIGH when everything is there and fresh', full.confidence === 'HIGH',
     full.confidence + ' ' + JSON.stringify(full.confidenceReasons));

  // Partial: one core market missing.
  const partial = M.vegasProjection({
    recYd: [mk(80.5, 'dk'), mk(79.5, 'fd')]
  }, 'WR', R, { asOf: Date.now() });
  ok('a missing core market makes it PARTIAL', partial.ok && partial.status === 'partial');
  ok('and it says so in words', partial.label === 'Partial Vegas projection');
  ok('it names what is missing', partial.missingCore.includes('rec'), JSON.stringify(partial.missingCore));
  ok('it does NOT invent the missing market', partial.stats.rec === undefined, JSON.stringify(partial.stats));

  // Nothing priced.
  const none = M.vegasProjection({}, 'WR', R, {});
  ok('no markets at all is unavailable', !none.ok && none.status === 'unavailable');
  ok('and it says so in words', none.label === 'Vegas projection unavailable');
  ok('with a reason', none.reason === 'no_markets');
  ok('a position nobody prices is unavailable too', M.vegasProjection({}, 'K', R, {}).status === 'unavailable');

  // Only an extra market: not enough to call it a projection.
  const thin = M.vegasProjection({ rushYd: [mk(12.5, 'dk')] }, 'WR', R, { asOf: Date.now() });
  ok('one non-core market is not a projection', !thin.ok && thin.reason === 'no_core_market');

  // A count TD market beats the binary, because it carries multi-score games.
  const counted = M.vegasProjection({
    recYd: [mk(80.5, 'dk')], rec: [mk(6.5, 'dk')], recTD: [mk(0.8, 'dk')],
    anytimeTD: [{ book: 'dk', overOdds: -110, underOdds: -110 }]
  }, 'WR', R, { asOf: Date.now() });
  ok('a priced TD count is used instead of the binary', counted.tdCountedFromMarket === true);
  ok('and the binary is not added on top',
     near(counted.points, Math.round(M.scoreStats(counted.stats, 'WR', R) * 10) / 10, 1e-9),
     counted.points + ' vs ' + M.scoreStats(counted.stats, 'WR', R));
}

console.log('\nconfidence');
{
  const base = { coreMissing: 0, marketCount: 5, books: 5, agreement: 1, ageHours: 1, injuryStatus: null };
  ok('everything present and fresh is HIGH', M.vegasConfidence(base).level === 'HIGH');
  ok('one book drops it', M.vegasConfidence({ ...base, books: 1, agreement: null }).level !== 'HIGH');
  ok('stale lines drop it', M.vegasConfidence({ ...base, ageHours: 60 }).level !== 'HIGH');
  ok('books disagreeing drops it', M.vegasConfidence({ ...base, agreement: 0.3 }).level !== 'HIGH');
  ok('a missing core market drops it', M.vegasConfidence({ ...base, coreMissing: 1 }).level !== 'HIGH');
  ok('a player ruled out drops it hard',
     M.vegasConfidence({ ...base, injuryStatus: 'Out' }).level === 'LOW',
     M.vegasConfidence({ ...base, injuryStatus: 'Out' }).level);
  ok('a questionable tag is a caution, not a disqualification',
     M.vegasConfidence({ ...base, injuryStatus: 'Questionable' }).level === 'HIGH');
  ok('two problems together are LOW, not MEDIUM',
     M.vegasConfidence({ ...base, books: 1, ageHours: 60 }).level === 'LOW');
  ok('every downgrade says why in words',
     M.vegasConfidence({ ...base, books: 1, agreement: null, ageHours: 60 }).reasons.length >= 2);
  ok('the worst case is LOW, not an error',
     M.vegasConfidence({ coreMissing: 2, marketCount: 1, books: 1, agreement: null, ageHours: null,
                         injuryStatus: 'IR' }).level === 'LOW');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
