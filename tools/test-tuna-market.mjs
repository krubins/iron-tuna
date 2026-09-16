import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
const section = src.slice(src.indexOf('// TUNA MARKET SIGNAL START'), src.indexOf('// TUNA MARKET SIGNAL END'));
let calls = 0, response;
const api = new Function('fetch', 'adminOk', section + '\nreturn {tmsNormalize,tmsNormalizePropline,tmsAmericanToDecimal,tmsApplyPropLineMovement,tmsPrimaryPropRows,tmsProjectionRows,tmsSignals,tmsHttp,tmsReady,tmsStore,tmsPoll,tmsRoutes,TMS_PROVIDERS};')(
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
const front = readFileSync(new URL('../front.html', import.meta.url), 'utf8');
for (const block of front.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(block[1]);
const tableBody = { innerHTML: '' };
const nodes = { marketMovesTable: { querySelector: () => tableBody }, marketMovesWrap: {}, marketMovesEmpty: {} };
const renderMoves = new Function('$', 'e', front.slice(front.indexOf('  function marketNum('), front.indexOf('  function renderMarket(j,')) + '\nreturn renderMarketMoves;')(
  id => nodes[id], value => String(value));
renderMoves({ items: [publicFree] });
assert.match(tableBody.innerHTML, /First observed/);
assert.match(tableBody.innerHTML, /1 of 1 books/);
assert.doesNotMatch(tableBody.innerHTML, /Provider opening|\/100/);
assert.equal(nodes.marketMovesWrap.hidden, false);
env.TMS_PROVIDER = 'propline';
assert.equal((await (await req('/api/tuna-market')).json()).status, 'disabled');
delete env.TMS_PROVIDER;
env.TMS_ENABLED = '0'; assert.equal((await (await req('/api/tuna-market')).json()).status, 'disabled');
new Function(readFileSync(new URL('../tuna-market.js', import.meta.url), 'utf8'));
console.log('Tuna Market Signal: PropLine normalization and native movement, line/price separation, freshness, source isolation, SQLite storage, idempotency, concurrent polling, quota cooldown, auth, licensed splits and UI parse passed.');
