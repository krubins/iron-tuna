import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
const section = src.slice(src.indexOf('// TUNA MARKET SIGNAL START'), src.indexOf('// TUNA MARKET SIGNAL END'));
let calls = 0, response;
const api = new Function('fetch', 'adminOk', section + '\nreturn {tmsNormalize,tmsSignals,tmsHttp,tmsReady,tmsStore,tmsPoll,tmsRoutes};')(
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
assert.equal(api.tmsSignals([...old, ...api.tmsNormalize(fixture(now - 1800000), now)], now)[0].score, null);
const differentProvider = { ...latest[0], provider: 'licensed-import' };
assert.equal(api.tmsSignals([...old, differentProvider], now).every(r => r.score === null), true);
await api.tmsReady(env); await api.tmsStore(env, old, now - 1800000); await api.tmsStore(env, latest, now); await api.tmsStore(env, latest, now);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tuna_market_snapshots').get().n, 2);
const req = (path, init) => { const request = new Request('https://irontuna.com' + path, init); return api.tmsRoutes(request, env, new URL(request.url)); };
let result = await (await req('/api/tuna-market?kind=props&player=test')).json(); assert.equal(result.items.length, 1);
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
env.TMS_ENABLED = '0'; assert.equal((await (await req('/api/tuna-market')).json()).status, 'disabled');
new Function(readFileSync(new URL('../tuna-market.js', import.meta.url), 'utf8'));
console.log('Tuna Market Signal: normalization, line/price separation, freshness, source isolation, SQLite storage, idempotency, concurrent polling, quota cooldown, auth, licensed splits and UI parse passed.');
