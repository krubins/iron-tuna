import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
const section = src.slice(src.indexOf('// TUNA MARKET SIGNAL START'), src.indexOf('// TUNA MARKET SIGNAL END'));
let calls = 0, response;
const api = new Function('fetch', 'adminOk', section + '\nreturn {tmsNormalize,tmsNormalizePropline,tmsAmericanToDecimal,tmsApplyPropLineMovement,tmsPrimaryPropRows,tmsSignals,tmsHttp,tmsReady,tmsStore,tmsPoll,tmsRoutes,tmsBookBoard,tmsDecimalToAmerican,TMS_PROVIDERS};')(
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
assert.equal(api.tmsSignals([...old, ...latest], now + 7200000)[0].score, null);
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
env.TMS_ENABLED = '1';
// One book's board: DraftKings by default, attributed, the book's own quote and
// never another book's number.
assert.equal(api.tmsDecimalToAmerican(1.9090909090909092), -110);
assert.equal(api.tmsDecimalToAmerican(2.5), 150);
assert.equal(api.tmsDecimalToAmerican(1), null);
const boardNow = now;
const boardFixture = (at, spread, price) => [{ id: 'dk-event', sport_key: 'americanfootball_nfl', commence_time: new Date(boardNow + 86400000).toISOString(), home_team: 'Home', away_team: 'Away', bookmakers: [
  { key: 'draftkings', last_update: new Date(at).toISOString(), markets: [
    { key: 'spreads', outcomes: [{ name: 'Home', point: spread, price }, { name: 'Away', point: -spread, price: 1.9 }] },
    { key: 'h2h', outcomes: [{ name: 'Home', price: 1.5 }, { name: 'Away', price: 2.6 }] },
    { key: 'totals', outcomes: [{ name: 'Over', point: 44.5, price: 1.91 }, { name: 'Under', point: 44.5, price: 1.91 }] },
    { key: 'player_receptions', outcomes: [{ name: 'Over', description: 'Board Player', point: 5.5, price: 1.87 }, { name: 'Under', description: 'Board Player', point: 5.5, price: 1.95 }] } ] },
  { key: 'fanduel', last_update: new Date(at).toISOString(), markets: [{ key: 'spreads', outcomes: [{ name: 'Home', point: -4, price: 1.91 }, { name: 'Away', point: 4, price: 1.91 }] }] } ] }];
await api.tmsStore(env, api.tmsNormalize(boardFixture(boardNow - 7200000, -3, 1.91), boardNow - 7200000), boardNow - 7200000);
await api.tmsStore(env, api.tmsNormalize(boardFixture(boardNow - 60000, -3.5, 1.87), boardNow - 60000), boardNow - 60000);
result = await (await req('/api/tuna-market/book')).json();
assert.equal(result.book, 'draftkings'); assert.equal(result.label, 'DraftKings'); assert.equal(result.status, 'ok');
const boardGame = result.games.find(g => g.event === 'dk-event');
assert.ok(boardGame); assert.equal(boardGame.home, 'Home'); assert.equal(boardGame.away, 'Away'); assert.equal(boardGame.sourceName, 'The Odds API');
assert.deepEqual(boardGame.markets.spreads.map(q => q.side), ['Away', 'Home']);
const homeSpread = boardGame.markets.spreads.find(q => q.side === 'Home');
assert.equal(homeSpread.line, -3.5); assert.equal(homeSpread.openLine, -3); assert.equal(homeSpread.lineMove, -0.5);
assert.equal(homeSpread.american, -115); assert.equal(homeSpread.openAmerican, -110); assert.equal(homeSpread.openBasis, 'first-observed'); assert.equal(homeSpread.stale, false);
assert.equal(boardGame.markets.h2h.find(q => q.side === 'Away').american, 160);
assert.deepEqual(boardGame.markets.totals.map(q => q.side), ['Over', 'Under']);
assert.equal(boardGame.markets.spreads.some(q => Math.abs(q.line) === 4), false);
const boardProp = result.props.find(p => p.player === 'Board Player');
assert.equal(boardProp.label, 'Receptions'); assert.equal(boardProp.quotes[0].side, 'Over'); assert.equal(boardProp.quotes[0].line, 5.5); assert.equal(boardProp.quotes[1].american, -105);
assert.equal(result.counts.players >= 1, true);
result = await (await req('/api/tuna-market/book?book=fanduel&kind=games')).json();
assert.equal(result.label, 'FanDuel'); assert.equal(result.props.length, 0);
assert.equal(result.games.find(g => g.event === 'dk-event').markets.spreads.find(q => q.side === 'Home').line, -4);
result = await (await req('/api/tuna-market/book?player=board')).json();
assert.equal(result.games.length, 0); assert.equal(result.props.length, 1);
result = await (await req('/api/tuna-market/book?book=nobody')).json();
assert.equal(result.status, 'no_quotes'); assert.ok(result.booksQuoting.includes('draftkings')); assert.equal(result.label, 'nobody');
assert.equal((await req('/api/tuna-market/book', { method: 'POST' })).status, 405);
assert.equal(JSON.stringify(result).includes('apiKey'), false);
console.log('Tuna Market Signal: PropLine normalization and native movement, line/price separation, freshness, source isolation, SQLite storage, idempotency, concurrent polling, quota cooldown, auth, licensed splits, the per-book board and UI parse passed.');
