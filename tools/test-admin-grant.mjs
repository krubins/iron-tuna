#!/usr/bin/env node
// Tests for the comp-access admin routes in _worker.js.
//   node --experimental-sqlite tools/test-admin-grant.mjs
//
// These routes hand out and take away PAID ACCESS from a URL, so the things
// worth proving are the unhappy paths: that the key gate actually holds, that a
// malformed address cannot create a junk row, and that revoke clears the session
// as well as the entitlement — leaving the session behind would sign nobody out.
//
// The worker is a standard ES module over Web APIs, so it is imported and driven
// directly rather than through `wrangler dev` (which needs to reach Cloudflare
// for the Request.cf object and cannot run offline). env.LEADS_DB is a real
// SQLite database via node:sqlite, so the SQL is genuinely executed — a D1 shim
// that faked the queries would prove nothing about them.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (e) { console.log('SKIP — needs node:sqlite (run with --experimental-sqlite on Node 22)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── a D1 shim over real SQLite ─────────────────────────────────────────────
// Only the surface the worker uses: prepare().bind().first()/run()/all().
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE entitlements (email TEXT PRIMARY KEY, product TEXT, paid_at INTEGER);
           CREATE TABLE sessions (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER);`);
  const wrap = sql => {
    let args = [];
    const api = {
      bind: (...a) => { args = a; return api; },
      first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { return null; } },
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; }
    };
    return api;
  };
  return { raw: db, prepare: wrap };
}

const KEY = 'test-admin-key';
const worker = (await import(pathToFileURL(path.join(ROOT, '_worker.js')).href)).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (db, p) => worker.fetch(new Request('https://irontuna.com' + p), { LEADS_DB: db, LEADS_EXPORT_KEY: KEY, AUTH_SECRET: 's' }, ctx);
const jsonOf = async r => { try { return await r.json(); } catch (e) { return null; } };

// ── the gate ───────────────────────────────────────────────────────────────
console.log('\nthe key gate');
{
  const db = makeDb();
  for (const q of ['', '?email=a@b.com', '?key=&email=a@b.com', '?key=wrong&email=a@b.com']) {
    const r = await call(db, '/api/admin/grant' + q);
    ok(`grant is refused with "${q || '(nothing)'}"`, r.status === 403, String(r.status));
  }
  const r = await call(db, '/api/admin/revoke?key=wrong&email=a@b.com');
  ok('revoke is refused with a bad key', r.status === 403, String(r.status));
  // A refused call must not have touched anything.
  ok('a refused call writes nothing', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 0);
}

// ── input validation ───────────────────────────────────────────────────────
console.log('\ninput validation');
{
  const db = makeDb();
  for (const bad of ['', 'notanemail', 'a@b', 'a b@c.com', '@b.com']) {
    const r = await call(db, `/api/admin/grant?key=${KEY}&email=${encodeURIComponent(bad)}`);
    ok(`"${bad}" is rejected`, r.status === 400, String(r.status));
  }
  ok('no junk rows were created', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 0);
}

// ── granting ───────────────────────────────────────────────────────────────
console.log('\ngranting');
{
  const db = makeDb();
  const r = await call(db, `/api/admin/grant?key=${KEY}&email=Friend@Example.com`);
  const j = await jsonOf(r);
  ok('a grant succeeds', r.status === 200 && j.ok === true, JSON.stringify(j));
  ok('the address is normalised to lowercase', j.email === 'friend@example.com', j.email);
  ok('it reports the account as entitled', j.entitled === true);
  ok('it reports that something changed', j.changed === true);
  ok('it hands back the sign-in URL to pass on', /signin=1/.test(j.signIn || ''), j.signIn);
  const row = db.raw.prepare('SELECT * FROM entitlements WHERE email=?').get('friend@example.com');
  ok('the row is written lowercase, as isEntitled looks it up', !!row, JSON.stringify(row));
  ok('the row carries the bundle product', row && row.product === 'bundle');
  ok('the row is stamped in epoch MILLIseconds', row && row.paid_at > 1e12, row && String(row.paid_at));

  const again = await jsonOf(await call(db, `/api/admin/grant?key=${KEY}&email=friend@example.com`));
  ok('granting twice is idempotent', again.ok === true && again.entitled === true);
  ok('the second grant reports no change', again.changed === false, JSON.stringify(again));
  ok('and still only one row exists', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 1);
}

// ── revoking ───────────────────────────────────────────────────────────────
console.log('\nrevoking');
{
  const db = makeDb();
  await call(db, `/api/admin/grant?key=${KEY}&email=friend@example.com`);
  db.raw.prepare('INSERT INTO sessions (id, email, created_at) VALUES (?,?,?)').run('s1', 'friend@example.com', Date.now());
  db.raw.prepare('INSERT INTO sessions (id, email, created_at) VALUES (?,?,?)').run('s2', 'friend@example.com', Date.now());
  db.raw.prepare('INSERT INTO sessions (id, email, created_at) VALUES (?,?,?)').run('s3', 'someone@else.com', Date.now());

  const j = await jsonOf(await call(db, `/api/admin/revoke?key=${KEY}&email=friend@example.com`));
  ok('a revoke succeeds', j.ok === true && j.action === 'revoke', JSON.stringify(j));
  ok('access is gone', j.entitled === false);
  ok('the entitlement row is deleted', !db.raw.prepare('SELECT 1 FROM entitlements WHERE email=?').get('friend@example.com'));
  // The half that actually signs them out. Without it they keep a live cookie.
  ok('their sessions are cleared too', db.raw.prepare('SELECT COUNT(*) c FROM sessions WHERE email=?').get('friend@example.com').c === 0);
  ok('it reports how many sessions it killed', j.sessionsCleared === 2, String(j.sessionsCleared));
  ok('nobody else is signed out', db.raw.prepare('SELECT COUNT(*) c FROM sessions').get().c === 1);

  const noop = await jsonOf(await call(db, `/api/admin/revoke?key=${KEY}&email=nobody@example.com`));
  ok('revoking an account that never had access is harmless', noop.ok === true && noop.changed === false, JSON.stringify(noop));
}

// ── the comped-in-code case ────────────────────────────────────────────────
// The trap: revoke LOOKS like it worked but the address is hardcoded in
// COMPED_EMAILS, so access survives. The response has to say so.
console.log('\naddresses comped in code');
{
  const src = (await import('fs')).readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const m = src.match(/const COMPED_EMAILS = \[([^\]]*)\]/);
  ok('COMPED_EMAILS is at module scope where the routes can read it', !!m);
  const owner = m && m[1].split(',')[0].trim().replace(/^'|'$/g, '');
  if (owner) {
    const db = makeDb();
    const g = await jsonOf(await call(db, `/api/admin/grant?key=${KEY}&email=${encodeURIComponent(owner)}`));
    ok('granting a comped address says the row is redundant', /redundant/i.test(g.note || ''), g.note);
    const r = await jsonOf(await call(db, `/api/admin/revoke?key=${KEY}&email=${encodeURIComponent(owner)}`));
    ok('revoking a comped address still reports them entitled', r.entitled === true, JSON.stringify(r));
    ok('...and says loudly why the revoke did not take', /STILL HAS ACCESS/.test(r.note || ''), r.note);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
