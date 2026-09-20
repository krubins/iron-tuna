import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
const section = src.slice(src.indexOf('// TUNA MARKET SIGNAL START'), src.indexOf('// TUNA MARKET SIGNAL END'));
let calls = 0, response;
const api = new Function('fetch', 'adminOk', section + '\nreturn {tmsNormalize,tmsNormalizePropline,tmsAmericanToDecimal,tmsApplyPropLineMovement,tmsPrimaryPropRows,tmsProjectionRows,tmsSignals,tmsHttp,tmsReady,tmsStore,tmsPoll,tmsRoutes,TMS_PROVIDERS,tmsPropLineEvents,TMS_PROPLINE_EVENT_CAP};')(
  async () => { calls++; return response.clone(); }, (env, key) => !!env.LEADS_EXPORT_KEY && key === env.LEADS_EXPORT_KEY);
const db = new DatabaseSync(':memory:');
const wrap = (sql, args = []) => ({ bind: (...values) => wrap(sql, values),
  syncRun() { return { meta: db.prepare(sql).run(...args) }; },
  async run() { return { meta: db.prepare(sql).run(...args) }; },
  async all() { return { results: db.prepare(sql).all(...args) }; },
  async first() { return db.prepare(sql).get(...args) || null; } });
const env = { TMS_ENABLED: '1', ODDS_API_KEY: 'test-secret', LEADS_EXPORT_KEY: 'admin-test', LEADS_DB: {
  prepare: sql => wrap(sql), async batch(statements) { db.exec('BEGIN'); try { const out = statements.map(s => s.syncRun()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } }
} };
const now = Date.now();
const fixture = (at, line = 50.5, price = 2) => [{ id: 'event', sport_key: 'americanfootball_nfl', commence_time: new Date(now + 86400000).toISOString(), home_team: 'Home', away_team: 'Away', bookmakers: [{ key: 'book', last_update: new Date(at).toISOString(), markets: [{ key: 'player_rush_yds', outcomes: [{ name: 'Over', description: 'Test Player', point: line, price }] }] }] }];
const old = api.tmsNormalize(fixture(now - 1800000), now - 1800000);
const latest = api.tmsNormalize(fixture(now, 51.5), now);
let signal = api.tmsSignals([...old, ...latest], now)[0];
assert.equal(signal.lineDelta, 1); assert.equal(signal.probabilityDelta, null);
assert.equal(signal.score, 20); assert.equal(signal.publicSplit, null); assert.equal(signal.sharpGap, null);
signal = api.tmsSignals([...old, ...api.tmsNormalize(fixture(now, 50.5, 1.8), now)], now)[0];
assert.ok(Math.abs(signal.probabilityDelta - 5.555555555555558) < 1e-8);
assert.equal(api.tmsSignals(old, now)[0].score, null);
// Stale is about when the collector last SAW the quote, not when the book last
// touched it: two hours of not being observed and the row is unscored, while a
// line the book has not moved in two hours is still fresh if the last poll saw it.
assert.equal(api.tmsSignals([...old, ...latest], now + 3 * 3600000)[0].score, null);
assert.equal(api.tmsSignals([...old, ...latest], now + 7200000 - 1)[0].stale, false);
assert.equal(api.tmsSignals([...old, ...api.tmsNormalize(fixture(now - 6 * 3600000, 51.5), now)], now)[0].stale, false);
assert.equal(api.tmsSignals([...old, ...latest], now + 172800000).length, 0);
assert.equal(api.tmsNormalize(fixture(now, 50, -110), now).length, 0);
assert.equal(api.tmsNormalize(fixture(now + 120000), now).length, 0);
assert.ok(Math.abs(api.tmsAmericanToDecimal(-110) - 1.9090909090909092) < 1e-10);
assert.equal(api.tmsAmericanToDecimal(150), 2.5);
assert.ok(api.TMS_PROVIDERS.propline);
const propLineFixture = [{ id: 'pl-event', sport_key: 'americanfootball_nfl', commence_time: new Date(now + 86400000).toISOString(), home_team: 'Home', away_team: 'Away',
  bookmakers: [{ key: 'draftkings', last_update: new Date(now).toISOString(), markets: [{ key: 'player_reception_yds', outcomes: [
    { name: 'Over', description: 'Test Player', point: 50.5, price: -110 },
    { name: 'Under', description: 'Test Player', point: 50.5, price: -110 }
  ] }] }] }];
const plRows = api.tmsNormalizePropline(propLineFixture, now);
assert.equal(plRows.length, 2);
assert.equal(plRows[0].provider, 'propline');
const projectionRows = api.tmsProjectionRows(plRows);
assert.deepEqual(projectionRows.map(r => ({ subject: r.subject, market: r.market, line: r.line, overOdds: r.overOdds, underOdds: r.underOdds })), [
  { subject: 'Test Player', market: 'recYd', line: 50.5, overOdds: -110, underOdds: -110 }
]);
const tdProjectionRows = api.tmsProjectionRows(api.tmsNormalizePropline([{ ...propLineFixture[0], bookmakers: [{
  key: 'draftkings', last_update: new Date(now).toISOString(), markets: [{ key: 'player_anytime_td', outcomes: [
    { name: 'Yes', description: 'Test Player', price: 150 }, { name: 'No', description: 'Test Player', price: -180 }
  ] }]
}] }], now));
assert.equal(tdProjectionRows[0].market, 'anytimeTD');
assert.equal(tdProjectionRows[0].line, 1);
assert.equal(tdProjectionRows[0].overOdds, 150);
assert.equal(tdProjectionRows[0].underOdds, -180);
api.tmsApplyPropLineMovement(plRows, { bookmakers: [{ key: 'draftkings', markets: [{ key: 'player_reception_yds', outcomes: [
  { name: 'Over', description: 'Test Player', open_price: -105, open_point: 48.5, open_at: new Date(now - 3600000).toISOString(), latest_price: -110, latest_point: 50.5, latest_at: new Date(now).toISOString(), direction: 'up', num_snapshots: 8 },
  { name: 'Under', description: 'Test Player', open_price: -115, open_point: 48.5, open_at: new Date(now - 3600000).toISOString(), latest_price: -110, latest_point: 50.5, latest_at: new Date(now).toISOString(), direction: 'down', num_snapshots: 8 }
] }] }], steam: [{ market: 'player_reception_yds', name: 'Over', description: 'Test Player', books_quoting: 8, books_moved: 6, consensus_direction: 'up', steam_score: 72.5 }] });
const plSignal = api.tmsSignals(plRows, now).find(r => r.side === 'Over');
assert.equal(plSignal.firstLine, 48.5);
assert.equal(plSignal.lineDelta, 2);
assert.equal(plSignal.consensusOpeningLine, 48.5);
assert.equal(plSignal.consensusLine, 50.5);
assert.equal(plSignal.consensusLineDelta, 2);
assert.equal(plSignal.steamScore, 72.5);
assert.equal(plSignal.booksMoved, 6);
assert.equal(plSignal.booksQuoting, 8);
assert.equal(plSignal.historyBasis, 'provider-opening');
// Free snapshots must not fabricate a provider opening or a zero steam score.
const freeOld = { ...old[0], provider: 'propline', steamScore: null, openingAt: null, openingPrice: null };
const freeNew = { ...latest[0], provider: 'propline', steamScore: null, openingAt: null, openingPrice: null };
const freeSignal = api.tmsSignals([freeOld, freeNew,
  { ...freeOld, book: 'second' }, { ...freeNew, book: 'second' },
  { ...freeOld, book: 'third' }, { ...freeNew, book: 'third', line: 49.5 },
  { ...freeNew, book: 'new-book', line: 100 }], now)[0];
assert.equal(freeSignal.historyBasis, 'first-observed');
assert.equal(freeSignal.steamScore, null);
assert.equal(freeSignal.observedBooksCompared, 3);
assert.equal(freeSignal.observedBooksMoved, 2);
assert.equal(freeSignal.observedDirection, 'up');
assert.equal(freeSignal.consensusLineDelta, 1); // New book cannot fabricate movement.
const singleFree = api.tmsSignals([freeNew], now)[0];
assert.equal(singleFree.consensusLineDelta, null);
assert.equal(singleFree.observedBooksCompared, 0);
const noPoint = api.tmsSignals([{ ...freeOld, line: null }, { ...freeNew, line: null }], now)[0];
assert.equal(noPoint.consensusLine, null);
assert.equal(noPoint.consensusOpeningLine, null);
const freePaths = [];
const freeApi = new Function('fetch', section + '\nreturn TMS_PROVIDERS.propline;')(async (url, init) => {
  const path = new URL(url).pathname;
  freePaths.push(path);
  assert.equal(new URL(url).searchParams.has('apiKey'), false);
  assert.equal(init.headers['X-API-Key'], 'private-test-key');
  assert.equal(path.endsWith('/movement'), false);
  const data = path.endsWith('/events') ? Array.from({ length: 20 }, (_, i) => ({ ...propLineFixture[0], id: 'event-' + i }))
    : path.includes('/events/') ? propLineFixture[0] : propLineFixture;
  return Response.json(data, { headers: { 'x-daily-remaining': String(1000 - freePaths.length), 'x-daily-limit': '1000' } });
});
const freePull = await freeApi.pull({ PROPLINE_API_KEY: 'private-test-key' }, now);
assert.equal(freePaths.length, 22);
assert.ok(freePull.rows.length > 0);
assert.equal(JSON.stringify(freePull).includes('private-test-key'), false);
assert.equal(freePaths.length * 24, 528); // Hourly max-event polls stay inside 1,000/day.
assert.equal(api.tmsSignals([...old, ...api.tmsNormalize(fixture(now - 1800000), now)], now)[0].score, null);
const differentProvider = { ...latest[0], provider: 'licensed-import' };
assert.equal(api.tmsSignals([...old, differentProvider], now).every(r => r.score === null), true);
await api.tmsReady(env); await api.tmsStore(env, old, now - 1800000); await api.tmsStore(env, latest, now); await api.tmsStore(env, latest, now);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tuna_market_snapshots').get().n, 2);
const req = (path, init) => { const request = new Request('https://irontuna.com' + path, init); return api.tmsRoutes(request, env, new URL(request.url)); };
let result = await (await req('/api/tuna-market?kind=props&player=test')).json(); assert.equal(result.items.length, 1);
assert.equal(result.items[0].historyBasis, 'first-observed');
assert.equal(result.items[0].steamScore, null);
assert.equal(result.items[0].observedBooksCompared, 1);
assert.equal((await req('/api/tuna-market/refresh', { method: 'POST' })).status, 403);
response = Response.json(fixture(now), { headers: { 'x-requests-remaining': '499' } });
await Promise.all([api.tmsPoll(env, now), api.tmsPoll(env, now)]); assert.equal(calls, 1);
await api.tmsPoll(env, now + 1000); assert.equal(calls, 1);
db.prepare("UPDATE tuna_market_state SET next_poll=0").run();
response = new Response('secret body must not escape', { status: 429, headers: { 'Retry-After': '86400' } });
result = await api.tmsPoll(env, now); assert.equal(result.code, 'rate_limited');
assert.ok(db.prepare('SELECT next_poll FROM tuna_market_state').get().next_poll >= now + 86400000);
assert.equal(JSON.stringify(result).includes('secret'), false);
response = new Response('private', { status: 401 });
await assert.rejects(api.tmsHttp('sports/test/odds', {}, env), /credentials_or_plan/);
assert.equal((await req('/api/tuna-market/import', { method: 'POST', headers: { Authorization: 'Bearer admin-test' }, body: '{}' })).status, 403);
env.TMS_LICENSED_IMPORT = '1';
const body = { source: 'https://example.com/licensed', events: fixture(now), splits: [{ event: 'event', market: 'player_rush_yds', player: 'Test Player', side: 'Over', line: 50.5, book: 'book', tickets: 35, money: 65, at: now }] };
assert.equal((await req('/api/tuna-market/import', { method: 'POST', headers: { Authorization: 'Bearer admin-test' }, body: JSON.stringify(body) })).status, 200);
result = await (await req('/api/tuna-market')).json(); assert.ok(result.items.some(r => r.publicSplit?.money === 65));
await api.tmsStore(env, [freeOld], now - 1800000);
await api.tmsStore(env, [freeNew], now);
result = await (await req('/api/tuna-market?kind=props')).json();
const publicFree = result.items.find(r => r.sourceName === 'PropLine');
// One public item per market, not one per book: the shape carries no book, so
// a second book's row is a copy of the first, and the count says how many.
await api.tmsStore(env, [{ ...freeOld, book: 'second' }], now - 1700000);
await api.tmsStore(env, [{ ...freeNew, book: 'second' }, { ...freeNew, book: 'third', line: 51.5 }], now + 1);
result = await (await req('/api/tuna-market?kind=props&player=test')).json();
const dedup = result.items.filter(r => r.sourceName === 'PropLine');
assert.equal(dedup.length, 1);
assert.equal(dedup[0].marketBooks, 3);
assert.equal(result.total, result.items.length);
// The limit is a query parameter with a ceiling, and total still counts everything.
result = await (await req('/api/tuna-market?limit=1')).json();
assert.equal(result.items.length, 1);
assert.ok(result.total > 1);
assert.equal(result.limit, 1);
assert.equal((await (await req('/api/tuna-market?limit=99999')).json()).limit, 5000);
// The read takes each event's first and last snapshot only.
assert.match(section, /MIN\(observed\) AS first_seen, MAX\(observed\) AS last_seen/);
assert.doesNotMatch(section, /ORDER BY observed DESC LIMIT 1000/);
assert.ok(publicFree);
assert.equal(publicFree.historyBasis, 'first-observed');
assert.equal(publicFree.consensusLineDelta, 1);
assert.equal(publicFree.steamScore, null);
assert.equal(publicFree.observedBooksMoved, 1);
assert.equal('price' in publicFree, false);
assert.equal('book' in publicFree, false);
// The homepage's own copy of this board came off with the Betting Market Intel
// lane in September 2026 (front.html is five sections now, and none of them is a
// market board). The board itself did not go anywhere: tuna-market.js is the one
// renderer, and it is mounted on the three pages below. Asserting it there rather
// than in a page-local function is the point — there is no second copy to drift.
{
  const dash = readFileSync(new URL('../tuna-market.js', import.meta.url), 'utf8');
  assert.match(dash, /getElementById\('tuna-market'\)/);
  assert.match(dash, /fetch\('\/api\/tuna-market\?'/);
  // The free payload's fields are what the dashboard actually prints.
  assert.match(dash, /observedBooksMoved/);
  assert.match(dash, /first_seen|firstSeen|First observed/i);
  for (const page of ['dfs.html', 'player.html', 'vegas-edge.html']) {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    assert.ok(html.includes('id="tuna-market"'), page + ' lost the market board mount');
    assert.ok(html.includes('/tuna-market.js'), page + ' does not load the board');
  }
  // And the homepage carries no second one.
  const front = readFileSync(new URL('../front.html', import.meta.url), 'utf8');
  for (const block of front.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(block[1]);
  assert.ok(!/renderMarketMoves|marketMovesTable/.test(front), 'front.html grew a market board again');
}
env.TMS_PROVIDER = 'propline';
assert.equal((await (await req('/api/tuna-market')).json()).status, 'disabled');
delete env.TMS_PROVIDER;
env.TMS_ENABLED = '0'; assert.equal((await (await req('/api/tuna-market')).json()).status, 'disabled');
new Function(readFileSync(new URL('../tuna-market.js', import.meta.url), 'utf8'));
// ── every market survives normalizing, not just the touchdown one ─────────
// The failure this guards is the one that hides itself. An anytime-touchdown
// market has no line, so it is exempt from the line check; every yardage and
// reception market must carry one. A strict `typeof point === 'number'` test
// therefore dropped every quoted yardage line whose feed sent "62.5" as a
// string, kept every touchdown price, and reported nothing — a board full of
// quoted markets that could not project a single receiver.
{
  const now = Date.now();
  const ev = (outcomes) => ([{ id: 'ev1', sport_key: 'americanfootball_nfl', commence_time: new Date(now + 86400000).toISOString(),
    home_team: 'B', away_team: 'A',
    bookmakers: [{ key: 'dk', last_update: new Date(now).toISOString(), markets: [
      { key: 'player_reception_yds', last_update: new Date(now).toISOString(), outcomes }] }] }]);

  // A line as a string is a line.
  const asString = api.tmsNormalize(ev([{ name: 'Over', description: 'A Receiver', point: '62.5', price: 1.9 }]), now);
  assert.equal(asString.length, 1, 'a numeric string line must not be dropped');
  assert.equal(asString[0].line, 62.5);
  assert.equal(typeof asString[0].line, 'number', 'and it must be coerced, not passed through as a string');

  // A number is still a number.
  assert.equal(api.tmsNormalize(ev([{ name: 'Over', description: 'A Receiver', point: 62.5, price: 1.9 }]), now)[0].line, 62.5);

  // Feeds that name the line or the player differently.
  assert.equal(api.tmsNormalize(ev([{ name: 'Over', description: 'A Receiver', line: 48.5, price: 1.9 }]), now)[0].line, 48.5);
  assert.equal(api.tmsNormalize(ev([{ name: 'Over', participant: 'A Receiver', point: 48.5, price: 1.9 }]), now)[0].player, 'A Receiver');

  // Genuinely absent is still dropped — tolerance is not invention.
  assert.equal(api.tmsNormalize(ev([{ name: 'Over', description: 'A Receiver', price: 1.9 }]), now).length, 0);
  assert.equal(api.tmsNormalize(ev([{ name: 'Over', description: 'A Receiver', point: 'n/a', price: 1.9 }]), now).length, 0);
  assert.equal(api.tmsNormalize(ev([{ name: 'Over', point: 62.5, price: 1.9 }]), now).length, 0, 'a player market with no player is not a row');

  // A touchdown market needs no line and must keep working.
  const td = [{ id: 'ev1', sport_key: 'americanfootball_nfl', commence_time: new Date(now + 86400000).toISOString(),
    home_team: 'B', away_team: 'A',
    bookmakers: [{ key: 'dk', last_update: new Date(now).toISOString(), markets: [
      { key: 'player_anytime_td', last_update: new Date(now).toISOString(),
        outcomes: [{ name: 'Yes', description: 'A Receiver', price: 2.4 }] }] }] }];
  assert.equal(api.tmsNormalize(td, now).length, 1);
  assert.equal(api.tmsNormalize(td, now)[0].line, null);

  // Every drop is counted, by reason and by market, so a feed losing eight of
  // its nine markets cannot do it silently again.
  const drops = {};
  api.tmsNormalize(ev([
    { name: 'Over', description: 'A Receiver', price: 1.9 },                    // no line
    { name: 'Over', description: 'B Receiver', point: 40.5, price: 0.5 },       // impossible price
    { name: 'Over', point: 40.5, price: 1.9 }                                   // no player
  ]), now, 'propline', 'src', drops);
  assert.equal(drops.total, 3);
  assert.equal(drops.byReason.no_line, 1);
  assert.equal(drops.byReason.price, 1);
  assert.equal(drops.byReason.no_player, 1);
  assert.equal(drops.byMarket.player_reception_yds, 3, 'the tally names the market that is losing rows');

  // A clean pull counts nothing, so the tally is a signal rather than noise.
  const clean = {};
  api.tmsNormalize(ev([{ name: 'Over', description: 'A Receiver', point: 62.5, price: 1.9 }]), now, 'propline', 'src', clean);
  assert.equal(clean.total, undefined);

  // The PropLine path carries the same tolerance and the same accounting: its
  // prices are American and are converted before any of this runs.
  const plDrops = {};
  const pl = api.tmsNormalizePropline([{ id: 'ev1', sport_key: 'americanfootball_nfl',
    commence_time: new Date(now + 86400000).toISOString(), home_team: 'B', away_team: 'A',
    bookmakers: [{ key: 'dk', last_update: new Date(now).toISOString(), markets: [
      { key: 'player_reception_yds', last_update: new Date(now).toISOString(),
        outcomes: [{ name: 'Over', description: 'A Receiver', point: '62.5', price: -110 },
                   { name: 'Under', description: 'A Receiver', point: '62.5', price: -110 }] }] }] }], now, plDrops);
  assert.equal(pl.length, 2, 'PropLine yardage lines as strings must survive');
  assert.equal(pl[0].line, 62.5);
  assert.equal(plDrops.total, undefined);
}

// ── the request itself ────────────────────────────────────────────────────
{
  const M = api.TMS_PROVIDERS.propline;
  assert.ok(M && typeof M.pull === 'function');
  // Every scoring market plus rush attempts, which the implied-touches number
  // on the DFS slate is built from and which the list never used to ask for.
  const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
  const list = /const TMS_PROPLINE_MARKETS = '([^']+)'/.exec(src)[1].split(',');
  for (const m of ['player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_rush_attempts',
                   'player_reception_yds', 'player_receptions', 'player_anytime_td']) {
    assert.ok(list.includes(m), 'the default prop request lost ' + m);
  }
  assert.ok(list.length <= 12, 'the provider caps the market list at twelve');
  // Yardage and reception markets are the ones a projection needs; a request
  // that carries only the touchdown market cannot project a receiver at all.
  assert.ok(list.filter(m => /yds|receptions|attempts/.test(m)).length >= 5);

  // The events that get a prop call are the SOONEST ones. A nine-day window
  // holds more than one NFL week, and the cap must not be spent on games a
  // week out while this Sunday goes unpriced.
  const now = Date.now();
  const day = 86400000;
  const at = (id, ms) => ({ id, commence_time: new Date(ms).toISOString() });
  const far = Array.from({ length: 20 }, (_, i) => at('far' + i, now + 8 * day + i * 60000));
  const soon = Array.from({ length: 5 }, (_, i) => at('soon' + i, now + day + i * 60000));
  const picked = api.tmsPropLineEvents([...far, ...soon], now);
  assert.equal(picked.length, api.TMS_PROPLINE_EVENT_CAP, 'the per-poll cap still holds');
  for (let i = 0; i < 5; i++) {
    assert.ok(picked.some(e => e.id === 'soon' + i), 'the nearest games must be the ones priced (soon' + i + ' was skipped)');
  }
  assert.ok(picked[0].id.startsWith('soon'), 'and they come first');
  // Order in, order out: already-sorted input is not disturbed.
  assert.deepEqual(api.tmsPropLineEvents(soon, now).map(e => e.id), soon.map(e => e.id));
  // The window still bounds both ends, and a malformed row is not an event.
  assert.equal(api.tmsPropLineEvents([at('old', now - 5 * day), at('late', now + 20 * day)], now).length, 0);
  assert.equal(api.tmsPropLineEvents([{ commence_time: new Date(now + day).toISOString() }, { id: 'x' }, null], now).length, 0);
  // A game that kicked off within the hour is still this week's.
  assert.equal(api.tmsPropLineEvents([at('live', now - 1800000)], now).length, 1);
}


console.log('Tuna Market Signal: PropLine normalization and native movement, line/price separation, freshness, source isolation, SQLite storage, idempotency, concurrent polling, quota cooldown, auth, licensed splits and UI parse passed.');
