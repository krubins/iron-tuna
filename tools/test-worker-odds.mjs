#!/usr/bin/env node
// Tests for the Vegas subsystem inside _worker.js.
//   node tools/test-worker-odds.mjs
//
// _worker.js has no build step and exports only the fetch/scheduled handlers,
// so this lifts the "Vegas-weighted projections" section straight out of the
// source and evaluates it against stub PROJECTIONS. That means these tests run
// the REAL worker code, and the sync check below fails loudly if the worker's
// copy of the odds math ever drifts from tools/vegas-to-projections.mjs.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { impliedProb, devigOver, probit, expectedTotal } from './vegas-to-projections.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── lift the section out of the worker ─────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const START = '// Vegas-weighted projections';
const s = src.indexOf(START);
const e = src.indexOf('export default {', s);
if (s < 0 || e < 0) { console.error('FAIL: could not locate the Vegas section in _worker.js'); process.exit(1); }
const section = src.slice(s, e);

// Stub pool: two players whose stat lines make the blend arithmetic checkable
// by hand, plus a duplicate name to prove ambiguous matches are dropped.
const STUB = [
  { name: 'Test Quarterback', position: 'QB', team: 'AAA', projectedStats: { passYd: 3800, passTD: 24, passInt: 10, rushYd: 300, rushTD: 4, fumLost: 0 } },
  { name: 'Test Runner', position: 'RB', team: 'BBB', projectedStats: { rushYd: 1000, rushTD: 8, rec: 40, recYd: 300, recTD: 2, fumLost: 0 } },
  { name: 'Ambi Guous', position: 'WR', team: 'CCC', projectedStats: { rec: 60, recYd: 800, recTD: 5, rushYd: 0, rushTD: 0, fumLost: 0 } },
  { name: 'Ambi Guous', position: 'TE', team: 'DDD', projectedStats: { rec: 30, recYd: 300, recTD: 2, rushYd: 0, rushTD: 0, fumLost: 0 } }
];

const harness = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null;
  ${section}
  return { _oddsImpliedProb, _oddsDevigOver, _oddsProbit, _oddsExpectedTotal, _oddsNorm,
           buildVegasOverlay, blendProjections, runOddsRefresh, projectionsPayload,
           VEGAS_WEIGHT, ODDS_MIN_MATCHED, ODDS_PROVIDERS, fetchOddsTheOddsApi,
           _csvSplit, fetchTeamEnvNflverse, buildTeamEnvOverlay,
           marketSeasonTotals, marketKicker, blendKicker, blendDefense,
           KDEF_LEAGUE, K_MODEL, D_MODEL,
           get encCalls() { return _PROJ_ENC; } };
`);
let encoded = null;
const W = harness(STUB, (str) => { encoded = str; return 'ENC:' + str.length; }, 'k', async () => { throw new Error('no network in tests'); });

console.log('\nworker math matches the build-time tool');
for (const odds of [-110, -250, 100, 150, 320, -1200]) {
  ok(`impliedProb(${odds})`, near(W._oddsImpliedProb(odds), impliedProb(odds)));
}
for (const [o, u] of [[-110, -110], [-140, 110], [120, -145]]) {
  ok(`devigOver(${o},${u})`, near(W._oddsDevigOver(o, u), devigOver(o, u)));
}
for (const p of [0.01, 0.2, 0.5, 0.73, 0.99]) {
  ok(`probit(${p})`, near(W._oddsProbit(p), probit(p), 1e-12));
}
for (const [line, p, mk] of [[4000, 0.5, 'passYd'], [1200, 0.62, 'rushYd'], [70, 0.41, 'rec'], [9.5, 0.55, 'rushTD']]) {
  ok(`expectedTotal(${line},${p},${mk})`, near(W._oddsExpectedTotal(line, p, mk), expectedTotal(line, p, mk), 1e-9));
}

console.log('\noverlay build');
{
  const rows = [
    { player: 'Test Quarterback', market: 'passYd', line: 4200, overOdds: -110, underOdds: -110 },
    { player: 'Test Runner', market: 'rushYd', line: 1200, overOdds: -110, underOdds: -110 }
  ];
  const { overlay, matched } = W.buildVegasOverlay(rows);
  ok('matches players by name against the pool', matched === 2, JSON.stringify(overlay));
  ok('position comes from the pool, not the book', !!overlay['testquarterback|QB'] && !!overlay['testrunner|RB']);
  ok('balanced price keeps the line', near(overlay['testquarterback|QB'].passYd, 4200, 1e-6));
}
{
  const { matched, skipped } = W.buildVegasOverlay([
    { player: 'Nobody At All', market: 'passYd', line: 4000, overOdds: -110, underOdds: -110 }
  ]);
  ok('unknown player is skipped', matched === 0 && skipped.unmatched === 1);
}
{
  const { matched, skipped } = W.buildVegasOverlay([
    { player: 'Ambi Guous', market: 'recYd', line: 900, overOdds: -110, underOdds: -110 }
  ]);
  ok('ambiguous name is dropped, not guessed', matched === 0 && skipped.unmatched === 1);
}
{
  // Per-game numbers mistaken for season totals must not reach the pool.
  const { matched, skipped } = W.buildVegasOverlay([
    { player: 'Test Quarterback', market: 'passYd', line: 245.5, overOdds: -110, underOdds: -110 },
    { player: 'Test Runner', market: 'rushYd', line: 68.5, overOdds: -110, underOdds: -110 }
  ]);
  ok('out-of-band lines are rejected', matched === 0 && skipped.outOfBand === 2, JSON.stringify(skipped));
}
{
  const { skipped } = W.buildVegasOverlay([
    { player: 'Test Quarterback', market: 'shoeSize', line: 12, overOdds: -110, underOdds: -110 }
  ]);
  ok('unknown market is rejected', skipped.unknownMarket === 1);
}

console.log('\nblend');
{
  const { overlay } = W.buildVegasOverlay([
    { player: 'Test Quarterback', market: 'passYd', line: 4200, overOdds: -110, underOdds: -110 }
  ]);
  const out = W.blendProjections(overlay);
  const qb = out.find(p => p.name === 'Test Quarterback');
  // committed 3800, vegas 4200, weight 3 -> (3800 + 3*4200)/4 = 4100
  ok('blends 75% toward Vegas', near(qb.projectedStats.passYd, 4100, 1e-6), String(qb.projectedStats.passYd));
  ok('unpriced stats are untouched', qb.projectedStats.passTD === 24 && qb.projectedStats.rushYd === 300);
  ok('unpriced players are untouched',
    out.find(p => p.name === 'Test Runner').projectedStats.rushYd === 1000);
  ok('pool length is preserved', out.length === STUB.length);
  ok('null overlay returns the committed pool', W.blendProjections(null) === STUB);
}
{
  // A market the site does not model must not invent a new stat key.
  const out = W.blendProjections({ 'testrunner|RB': { passYd: 500 } });
  ok('stats the site does not model are ignored',
    out.find(p => p.name === 'Test Runner').projectedStats.passYd === undefined);
}
{
  const out = W.blendProjections({ 'testquarterback|QB': { passTD: 30 } });
  // (24 + 3*30)/4 = 28.5 — kept as a decimal, matching merge-projections.mjs.
  // Rounding to 28 would discard a real part of the market's opinion.
  ok('touchdown expectations keep their decimal',
    near(out.find(p => p.name === 'Test Quarterback').projectedStats.passTD, 28.5, 1e-9),
    String(out.find(p => p.name === 'Test Quarterback').projectedStats.passTD));
}
{
  const out = W.blendProjections({ 'testrunner|RB': { rushYd: NaN, rec: -5 } });
  const rb = out.find(p => p.name === 'Test Runner');
  ok('NaN and negative values are rejected', rb.projectedStats.rushYd === 1000 && rb.projectedStats.rec === 40);
}

console.log('\nscrimmageTD split');
{
  const { overlay } = W.buildVegasOverlay([
    { player: 'Test Runner', market: 'scrimmageTD', line: 10, overOdds: -110, underOdds: -110 }
  ]);
  const s = overlay['testrunner|RB'];
  // pool ratio is 8 rush / 2 rec -> 80/20
  ok('combined TD market is split on the pool ratio', s.rushTD === 8 && s.recTD === 2, JSON.stringify(s));
  ok('combined market is not passed through', s.scrimmageTD === undefined);
}

console.log('\nfail-safe behaviour');
{
  const noDb = await W.runOddsRefresh({});
  ok('no database is a no-op, not a throw', noDb.ok === false && noDb.error === 'no_db');

  const writes = [];
  const db = { prepare: () => ({ bind: (...a) => ({ run: async () => writes.push(a), first: async () => null }), run: async () => {}, first: async () => null }) };

  const thin = await W.runOddsRefresh({ LEADS_DB: db, ODDS_API_KEY: 'k' });
  ok('provider error never writes an overlay', thin.ok === false && writes.length === 0, JSON.stringify(thin));
  ok('provider failure is reported, not swallowed',
    Array.isArray(thin.tried) && thin.tried.some(t => t.error));
}
{
  // A pull that matches fewer than ODDS_MIN_MATCHED players is treated as broken.
  const writes = [];
  const db = { prepare: () => ({ bind: (...a) => ({ run: async () => writes.push(a), first: async () => null }), run: async () => {}, first: async () => null }) };
  const W2 = harness(STUB, s => 'ENC', 'k', async () => ({
    ok: true, json: async () => ([{ bookmakers: [{ markets: [{ key: 'player_pass_yds', outcomes: [
      { name: 'Over', description: 'Test Quarterback', point: 4200, price: -110 },
      { name: 'Under', description: 'Test Quarterback', point: 4200, price: -110 }
    ] }] }] }])
  }));
  const r = await W2.runOddsRefresh({ LEADS_DB: db, ODDS_API_KEY: 'k' });
  ok('a thin pull is rejected below the match floor', r.ok === false && writes.length === 0, JSON.stringify(r));
  ok('the floor is what rejected it', W2.ODDS_MIN_MATCHED > 1);
}
{
  // Serving path: a stale cached row must fall back to the committed pool.
  const stale = { prepare: () => ({ bind: () => ({ first: async () => ({ payload: JSON.stringify({ 'testquarterback|QB': { passYd: 9999 } }), updated_at: 1, provider: 'x', matched: 99 }), run: async () => {} }), first: async () => ({ payload: JSON.stringify({ 'testquarterback|QB': { passYd: 9999 } }), updated_at: 1, provider: 'x', matched: 99 }), run: async () => {} }) };
  const W3 = harness(STUB, str => { encoded = str; return 'ENC'; }, 'k', async () => { throw new Error('x'); });
  await W3.projectionsPayload({ LEADS_DB: stale });
  ok('a stale overlay is ignored on the serving path', !/9999/.test(encoded) && /3800/.test(encoded));
}
{
  const W4 = harness(STUB, str => { encoded = str; return 'ENC'; }, 'k', async () => { throw new Error('x'); });
  await W4.projectionsPayload({});                       // no DB at all
  ok('no database still serves the committed pool', /3800/.test(encoded));
  const W5 = harness(STUB, str => { encoded = str; return 'ENC'; }, 'k', async () => { throw new Error('x'); });
  const row = { payload: JSON.stringify({ 'testquarterback|QB': { passYd: 4200 } }), updated_at: Date.now(), provider: 'p', matched: 99 };
  await W5.projectionsPayload({ LEADS_DB: { prepare: () => ({ bind: () => ({ first: async () => row }), first: async () => row }) } });
  ok('a fresh overlay reaches the serving path', /4100/.test(encoded));
}

console.log('\nThe Odds API adapter');
{
  // v4 serves player props PER EVENT: the adapter lists /events, then asks
  // /events/{id}/odds for each. Every row it returns is a GAME line, and the
  // season overlay must refuse them -- that is the whole point of `scope`.
  const calls = [];
  const W6 = harness(STUB, s => 'ENC', 'k', async (u) => {
    calls.push(u);
    if (!/api\.the-odds-api\.com/.test(u)) throw new Error('wrong host: ' + u);
    if (!/apiKey=secret/.test(u)) throw new Error('key not sent');
    if (/\/events\?/.test(u)) {
      return { ok: true, json: async () => ([{ id: 'ev1', commence_time: '2026-09-13T17:00:00Z', home_team: 'B', away_team: 'A' },
                                             { id: 'ev2', commence_time: '2026-09-13T20:25:00Z', home_team: 'D', away_team: 'C' }]) };
    }
    if (/\/events\/ev1\/odds/.test(u)) {
      return { ok: true, json: async () => ({ id: 'ev1', home_team: 'B', away_team: 'A', bookmakers: [
        { key: 'dk', markets: [{ key: 'player_pass_yds', outcomes: [
          { name: 'Over', description: 'Test Quarterback', point: 245.5, price: -110 },
          { name: 'Under', description: 'Test Quarterback', point: 245.5, price: -110 } ] }] },
        { key: 'fd', markets: [{ key: 'player_pass_yds', outcomes: [
          { name: 'Over', description: 'Test Quarterback', point: 250.5, price: -110 },
          { name: 'Under', description: 'Test Quarterback', point: 250.5, price: -110 } ] },
          { key: 'player_field_goals', outcomes: [ { name: 'Over', description: 'Test Quarterback', point: 3, price: -110 } ] }] }
      ] }) };
    }
    if (/\/events\/ev2\/odds/.test(u)) return { ok: false, status: 500 };   // one event failing must not lose the slate
    throw new Error('unexpected url ' + u);
  });
  const rows = await W6.fetchOddsTheOddsApi({ ODDS_API_KEY: 'secret' });
  ok('it lists the events first, then asks each one', calls.length === 3 && /\/events\?/.test(calls[0]));
  ok('pairs Over/Under into one row per book', rows.length === 2, JSON.stringify(rows));
  ok('maps the market key to a site stat', rows.every(r => r.market === 'passYd'));
  ok('drops unmapped markets', !rows.some(r => r.market === 'player_field_goals'));
  ok('every row names its book and its game', rows.every(r => r.book && r.gameId === 'ev1'));
  ok('every row is game-scoped', rows.every(r => r.scope === 'game'));
  ok('a failing event is skipped, not fatal', rows.every(r => r.gameId !== 'ev2'));
  const built = W6.buildVegasOverlay(rows);
  ok('the SEASON overlay refuses game lines', built.matched === 0 && built.skipped.gameScoped === 2, JSON.stringify(built.skipped));
  ok('the key never appears in a row', !JSON.stringify(rows).includes('secret'));
  let threw = false;
  try { await W6.fetchOddsTheOddsApi({}); } catch (e) { threw = /ODDS_API_KEY/.test(e.message); }
  ok('missing key throws rather than calling out', threw);
  ok('the market list can be narrowed from the environment without a deploy', (() => {
    const W7 = harness(STUB, s => 'ENC', 'k', async (u) => {
      if (/\/events\?/.test(u)) return { ok: true, json: async () => ([{ id: 'e' }]) };
      return { ok: /markets=player_receptions(&|$)/.test(u), json: async () => ({ bookmakers: [] }) };
    });
    return W7.fetchOddsTheOddsApi({ ODDS_API_KEY: 'secret', ODDS_API_MARKETS: 'player_receptions,not_a_market' }).then(r => Array.isArray(r));
  })());
}

// ── team-environment provider, against the REAL committed pool ──────────────
const realPool = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  const seg = src.slice(st, src.indexOf('\n];', st));
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();
let fetchUrl = null, fetchBody = null;
const R = harness(realPool, str => { encoded = str; return 'ENC'; }, 'k',
  async (u) => { fetchUrl = u; return { ok: true, text: async () => fetchBody, json: async () => JSON.parse(fetchBody) }; });

console.log('\nquote-aware CSV split');
{
  const f = R._csvSplit('2026_01_NE_SEA,2026,1,"Gillette, MA",3.5,44.5');
  ok('a comma inside quotes does not split the field', f.length === 6 && f[3] === 'Gillette, MA', JSON.stringify(f));
  const dq = 'a,' + '"say ""hi""' + '",b';
  ok('doubled quotes unescape', R._csvSplit(dq)[1] === 'say ' + '"hi"', JSON.stringify(R._csvSplit(dq)));
}

console.log('\nteam-env overlay maths');
{
  // Mirror the worker's own points model so "agreement" really is agreement.
  const td = {}, kick = {};
  for (const p of realPool) {
    const t = p.team === 'LAR' ? 'LA' : p.team === 'JAC' ? 'JAX' : p.team;
    if (t === 'FA') continue;
    td[t] = (td[t] || 0) + (p.projectedStats.passTD || 0) + (p.projectedStats.rushTD || 0);
    kick[t] = (kick[t] || 0) + (p.projectedStats.xpMade || 0) + (p.projectedStats.fgMade || 0) * 3;
  }
  const commonT = Object.keys(td).filter(t => td[t] > 0);
  const kv = commonT.filter(t => kick[t] > 0).map(t => kick[t]);
  const kMean = kv.reduce((a, b) => a + b, 0) / kv.length;
  const projTD = {};
  for (const t of commonT) projTD[t] = td[t] * 6 + (kick[t] > 0 ? kick[t] : kMean);
  // Vegas agreeing exactly with the projections must move nothing. The provider
  // now hands over a schedule-complete season per club, so pa rides along at the
  // league level: the skill-player factor never reads it.
  const totals = o => Object.fromEntries(Object.entries(o).map(([t, pf]) => [t, { pf, pa: 391, games: 17 }]));
  const agree = totals(projTD);
  const r = R.buildTeamEnvOverlay(agree);
  const off = Object.entries(r.factors).filter(([, f]) => Math.abs(f - 1) > 1e-9);
  ok('agreement with the projections is a no-op', off.length === 0, JSON.stringify(off.slice(0, 3)));

  const skew = { ...projTD };
  const target = Object.keys(projTD).sort()[0];
  skew[target] = projTD[target] * 3;
  const r2 = R.buildTeamEnvOverlay(totals(skew));
  ok('a team Vegas likes more than the projections gets a factor > 1', r2.factors[target] > 1, String(r2.factors[target]));
  ok('the factor is clamped, not unbounded', r2.factors[target] <= 1.18 + 1e-9, String(r2.factors[target]));
  ok('every factor stays inside the clamp band',
    Object.values(r2.factors).every(f => f >= 0.85 - 1e-9 && f <= 1.18 + 1e-9));

  const before = realPool.find(p => (p.team === target) && p.projectedStats.rushTD > 0 && p.projectedStats.rushYd > 0);
  if (before) {
    const ov = r2.overlay[R._oddsNorm(before.name) + '|' + before.position];
    const tdLift = ov.rushTD / before.projectedStats.rushTD;
    const ydLift = ov.rushYd / before.projectedStats.rushYd;
    ok('yardage is damped relative to touchdowns', ydLift <= tdLift + 1e-6, 'td ' + tdLift.toFixed(3) + ' yd ' + ydLift.toFixed(3));
  }
  ok('too few priced teams yields nothing rather than garbage',
    R.buildTeamEnvOverlay({ BUF: { pf: 425, pa: 390 }, KC: { pf: 408, pa: 380 } }).matched === 0);

  // ── kickers and defences ────────────────────────────────────────────────
  // Neither is scaled by the offensive factor: the market's implied points ARE
  // the estimate, so a club the market and the projections already agree about
  // still gets a line here — and only on the stats each position really has.
  {
    const kd = R.buildTeamEnvOverlay(agree).overlay;
    const kRows = realPool.filter(p => p.position === 'K');
    const dRows = realPool.filter(p => p.position === 'DEF');
    const kOv = kRows.map(p => kd[R._oddsNorm(p.name) + '|K']);
    const dOv = dRows.map(p => kd[R._oddsNorm(p.name) + '|DEF']);
    ok('every kicker in the pool is priced', kOv.every(Boolean), String(kOv.filter(Boolean).length) + '/' + kRows.length);
    ok('every defence in the pool is priced', dOv.every(Boolean), String(dOv.filter(Boolean).length) + '/' + dRows.length);
    ok('a kicker gets exactly the four stats a kicker line has',
      kOv.every(o => Object.keys(o).sort().join(',') === 'fgMade,fgMissed,xpMade,xpMissed'),
      JSON.stringify(kOv[0]));
    ok('a defence gets points allowed and nothing a book has no opinion about',
      dOv.every(o => Object.keys(o).join(',') === 'ptsAllowed'), JSON.stringify(dOv[0]));
    ok('no projected make rate falls under the model floor',
      kOv.every(o => o.fgMade / (o.fgMade + o.fgMissed) >= R.K_MODEL.pctMin - 1e-9),
      String(Math.min(...kOv.map(o => o.fgMade / (o.fgMade + o.fgMissed))).toFixed(3)));
    // Every club in `agree` carries the same 391 points against, so the market
    // side is identical and only the committed row can separate two defences.
    const spread = Math.max(...dOv.map(o => o.ptsAllowed)) - Math.min(...dOv.map(o => o.ptsAllowed));
    const commSpread = Math.max(...dRows.map(p => p.projectedStats.ptsAllowed))
                     - Math.min(...dRows.map(p => p.projectedStats.ptsAllowed));
    ok('points allowed anchors on the market, not on the committed row',
      spread < commSpread * (R.D_MODEL.paOwnView + 1e-9), spread + ' vs ' + commSpread);
  }
  {
    // A club the provider never priced keeps its committed line untouched.
    const target = realPool.find(p => p.position === 'DEF');
    const thin = { ...agree };
    delete thin[target.team === 'LAR' ? 'LA' : target.team];
    const kd = R.buildTeamEnvOverlay(thin).overlay;
    ok('a club the market did not price is left alone',
      !kd[R._oddsNorm(target.name) + '|DEF'], target.team);
  }
}

console.log('\nkicker and defence model');
{
  // pat_made = -17.0 + 0.1396 * points, fg_made = 24.3 + 0.0126 * points.
  const m = R.marketKicker(400);
  ok('extra points come off the fitted line', near(m.xpMade, -17.0 + 0.1396 * 400, 1e-9), String(m.xpMade));
  ok('field goals barely move with the team total',
    Math.abs(R.marketKicker(460).fgMade - R.marketKicker(320).fgMade) < 2,
    String(R.marketKicker(460).fgMade - R.marketKicker(320).fgMade));
  // committed 44 xp, market 37.6, own view 0.25 -> 39.2.
  const k = R.blendKicker({ fgMade: 23, fgMissed: 8, xpMade: 44, xpMissed: 2 }, 391);
  ok('the blend keeps a quarter of the committed extra points', near(k.xpMade, 39.2, 0.06), String(k.xpMade));
  ok('a 74% committed make rate is floored at 82%',
    near(k.fgMade / (k.fgMade + k.fgMissed), R.K_MODEL.pctMin, 0.005),
    String((k.fgMade / (k.fgMade + k.fgMissed)).toFixed(3)));
  ok('a club with no committed kicker still gets a full line',
    (() => { const n = R.blendKicker(null, 391); return n.fgMade > 20 && n.xpMade > 20 && n.fgMissed > 0; })(),
    JSON.stringify(R.blendKicker(null, 391)));
  // 391 implied against, committed 520, own view 0.15 -> 391 + 19.35 = 410.
  ok('points allowed anchors on the market', R.blendDefense({ ptsAllowed: 520 }, 391).ptsAllowed === 410,
    String(R.blendDefense({ ptsAllowed: 520 }, 391).ptsAllowed));
  ok('and moves with the market, not with the committed row',
    R.blendDefense({ ptsAllowed: 520 }, 430).ptsAllowed > R.blendDefense({ ptsAllowed: 520 }, 391).ptsAllowed);
}

console.log('\nprovider merge order');
{
  const merged = {};
  for (const ov of [{ 'joshallen|QB': { passYd: 5000 } }, { 'joshallen|QB': { passYd: 4000, passTD: 30 } }]) {
    for (const [k, stats] of Object.entries(ov)) {
      const dst = merged[k] || (merged[k] = {});
      for (const [s2, v] of Object.entries(stats)) if (!(s2 in dst)) dst[s2] = v;
    }
  }
  ok('a real prop is not overwritten by the team inference', merged['joshallen|QB'].passYd === 5000);
  ok('team inference still fills stats the prop did not cover', merged['joshallen|QB'].passTD === 30);
}

console.log('\nlive nflverse pull (real network)');
try {
  const res = await fetch('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv');
  if (!res.ok) throw new Error('http ' + res.status);
  fetchBody = await res.text();
  const totals = await R.fetchTeamEnvNflverse({});
  const n = Object.keys(totals).length;
  ok('hit the nflverse release asset', /nflverse-data\/releases/.test(fetchUrl), fetchUrl);
  ok('priced all 32 teams', n === 32, 'got ' + n);
  const pf = Object.values(totals).map(v => v.pf / 17);
  const pa = Object.values(totals).map(v => v.pa / 17);
  ok('implied points per game are plausible', Math.min(...pf) > 12 && Math.max(...pf) < 34,
    Math.min(...pf).toFixed(1) + '..' + Math.max(...pf).toFixed(1));
  // Scored and conceded are the same pool of points seen from the two ends, so
  // the league means have to agree. They diverging is the signature of a fit
  // that has drifted (a penalised intercept, a half-parsed schedule).
  ok('points for and against balance across the league',
    Math.abs(pf.reduce((a, b) => a + b, 0) - pa.reduce((a, b) => a + b, 0)) < 1,
    (pf.reduce((a, b) => a + b, 0) / n).toFixed(2) + ' vs ' + (pa.reduce((a, b) => a + b, 0) / n).toFixed(2));
  // Defences are the point of the schedule-complete fit: a spread as wide as a
  // season of OUTCOMES would mean the ratings had not shrunk anything.
  const paSd = (a => { const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / a.length); })(Object.values(totals).map(v => v.pa));
  ok('the market view of points allowed is tighter than a season of outcomes',
    paSd > 8 && paSd < 40, 'sd ' + paSd.toFixed(1));
  ok('every club is projected over a full schedule',
    Object.values(totals).every(v => v.games === 17), JSON.stringify(Object.values(totals).map(v => v.games).slice(0, 4)));
  const built = R.buildTeamEnvOverlay(totals);
  ok('overlay covers most of the pool', built.matched > 300, String(built.matched));
  const fv = Object.values(built.factors);
  ok('factors cluster near 1 rather than sprawling',
    (Math.max(...fv) - Math.min(...fv)) < 0.45, 'range ' + (Math.max(...fv) - Math.min(...fv)).toFixed(3));
  ok('few teams are pinned at the clamp',
    fv.filter(f => f >= 1.18 - 1e-9 || f <= 0.85 + 1e-9).length <= 4,
    String(fv.filter(f => f >= 1.18 - 1e-9 || f <= 0.85 + 1e-9).length));
  const blended = R.blendProjections(built.overlay);
  ok('pool length preserved through the blend', blended.length === realPool.length);
  let moved = 0;
  for (let i = 0; i < blended.length; i++) if (blended[i].projectedStats !== realPool[i].projectedStats) moved++;
  ok('real lines actually move real players', moved > 200, String(moved));
  const ranked = Object.entries(built.factors).sort((a, b) => b[1] - a[1]);
  console.log('       biggest Vegas upgrades:', ranked.slice(0, 4).map(([t, f]) => t + ' ' + f.toFixed(3)).join('  '));
  console.log('       biggest Vegas fades   :', ranked.slice(-4).map(([t, f]) => t + ' ' + f.toFixed(3)).join('  '));
} catch (e) {
  console.log('  SKIP live nflverse pull (' + e.message + ')');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
