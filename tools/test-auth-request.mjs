#!/usr/bin/env node
// Tests for /api/auth/request in _worker.js — the self-serve "email me a
// sign-in link" route.
//   node --experimental-sqlite tools/test-auth-request.mjs
//
// THIS ROUTE PUTS A WORKING SIGN-IN LINK IN SOMEBODY'S INBOX, so it is only
// ever allowed to do that for an address that already bought something. It was
// widened to any valid address when league sync shipped and a synced league was
// free; league sync is gone (HANDOFF §87) and the widening went with it. The
// failure this guards against is that widening coming back by accident, which
// would be invisible in review: the route answers ok:true either way, so a
// regression here looks exactly like correct behavior from the outside.
//
// The second thing pinned here is that the answer really is identical in every
// case. A route that 200s for a customer and 403s for a stranger is an oracle
// for "is this address a customer" against any address someone cares to try.
//
// Same arrangement as tools/test-admin-comp.mjs: the worker is imported and
// driven directly, env.LEADS_DB is real SQLite via node:sqlite so isEntitled's
// lookup genuinely runs, and global fetch is stubbed so no mail is ever sent.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (e) { console.log('SKIP — needs node:sqlite (run with --experimental-sqlite on Node 22)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE entitlements (email TEXT PRIMARY KEY, product TEXT, paid_at INTEGER);
           CREATE TABLE sessions (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER, last_seen INTEGER, ua TEXT);`);
  const wrap = sql => {
    let args = [];
    const api = {
      bind: (...a) => { args = a; return api; },
      first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { return null; } },
      all: async () => { try { return { results: db.prepare(sql).all(...args) }; } catch (e) { return { results: [] }; } },
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; }
    };
    return api;
  };
  return { raw: db, prepare: wrap };
}

function makeKv() {
  const map = new Map(), ttl = new Map();
  return {
    map, ttl,
    get: async k => (map.has(k) ? map.get(k) : null),
    put: async (k, v, o) => { map.set(k, v); ttl.set(k, o && o.expirationTtl); },
    delete: async k => { map.delete(k); }
  };
}

const mail = { calls: [] };
globalThis.fetch = async (u, init) => {
  const href = String(u && u.url ? u.url : u);
  if (href.startsWith('https://api.resend.com/')) {
    let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
    mail.calls.push({ body });
    return new Response(JSON.stringify({ id: 're_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected outbound fetch in test: ' + href);
};
const resetMail = () => { mail.calls.length = 0; };

const worker = (await import(pathToFileURL(path.join(ROOT, '_worker.js')).href)).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const baseEnv = { AUTH_SECRET: 'test-secret', RESEND_API_KEY: 're_test' };
const envOf = (db, kv, extra = {}) => ({ ...baseEnv, LEADS_DB: db, RATE_KV: kv, ...extra });
const ask = (env, email) => worker.fetch(new Request('https://irontuna.com/api/auth/request', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email })
}), env, ctx);
const buy = (db, email) => db.raw.prepare('INSERT INTO entitlements (email, product, paid_at) VALUES (?,?,?)').run(email, 'bundle', Date.now());
// The link out of the email body, which is the only place it is ever written.
const linkOf = m => (String((m && m.body && m.body.html) || '').match(/href="([^"]*auth\/verify[^"]*)"/) || [])[1] || null;

// ── the gate ───────────────────────────────────────────────────────────────
console.log('\nonly an address that already bought something gets a link');
{
  const db = makeDb(), env = envOf(db, makeKv());

  resetMail();
  await ask(env, 'stranger@example.com');
  ok('an address with no entitlement is mailed nothing', mail.calls.length === 0, String(mail.calls.length));

  resetMail();
  buy(db, 'buyer@example.com');
  await ask(env, 'buyer@example.com');
  ok('an address with an entitlement row is mailed exactly one link', mail.calls.length === 1, String(mail.calls.length));
  ok('and it goes to that address', (mail.calls[0] || {}).body.to === 'buyer@example.com');

  // COMPED_EMAILS is the owner list in the source; isEntitled honors it with no
  // database row at all, so the route has to as well.
  const comped = (fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8')
    .match(/const COMPED_EMAILS = \[([^\]]*)\]/) || [])[1];
  const owner = (comped || '').split(',')[0].trim().replace(/^'|'$/g, '');
  ok('the owner list is readable from the source', /@/.test(owner), String(owner));
  resetMail();
  await ask(env, owner);
  ok('a comped owner address is mailed a link with no entitlement row', mail.calls.length === 1, String(mail.calls.length));
  ok('and no row was invented for it', !db.raw.prepare('SELECT 1 FROM entitlements WHERE email=?').get(owner));

  resetMail();
  for (const bad of ['', 'notanemail', 'a@b', 'a b@c.com', '@b.com']) await ask(env, bad);
  ok('a malformed address is mailed nothing', mail.calls.length === 0, String(mail.calls.length));

  // No database bound is the state a fresh or broken deploy is in. isEntitled
  // returns false there, so the route must send nothing rather than everything.
  resetMail();
  await ask({ ...baseEnv, RATE_KV: makeKv() }, 'buyer@example.com');
  ok('with no database bound it sends nothing rather than anything', mail.calls.length === 0, String(mail.calls.length));
}

// ── the answer is the same answer every time ───────────────────────────────
console.log('\nthe route cannot be asked whether an address is a customer');
{
  const db = makeDb(), env = envOf(db, makeKv());
  buy(db, 'buyer@example.com');
  resetMail();
  const seen = [];
  for (const e of ['buyer@example.com', 'stranger@example.com', 'notanemail', '']) {
    const r = await ask(env, e);
    seen.push({ status: r.status, body: await r.text() });
  }
  ok('every case answers 200', seen.every(s => s.status === 200), JSON.stringify(seen.map(s => s.status)));
  ok('every case answers the same body', new Set(seen.map(s => s.body)).size === 1, JSON.stringify([...new Set(seen.map(s => s.body))]));
  ok('and that body is ok:true', JSON.parse(seen[0].body).ok === true, seen[0].body);
}

// ── the link a customer gets actually signs them in ────────────────────────
console.log('\nthe link works end to end');
{
  const db = makeDb(), kv = makeKv(), env = envOf(db, kv);
  buy(db, 'buyer@example.com');
  resetMail();
  await ask(env, 'buyer@example.com');
  const link = linkOf(mail.calls[0]);
  ok('the email carries a verify link', !!link, String(link));

  const v = await worker.fetch(new Request(link), env, ctx);
  ok('following it redirects', v.status === 302, String(v.status));
  // The magic link used to carry a returnTo, set only by the sign-in form in
  // the league-sync connect flow. That form is gone and so is the plumbing.
  ok('and always lands on the front page', v.headers.get('Location') === 'https://irontuna.com/?restored=1', String(v.headers.get('Location')));
  const cookie = v.headers.get('Set-Cookie') || '';
  ok('it sets the session cookie', /^it_sess=[^;]+;/.test(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie), cookie.slice(0, 60));

  const me = await (await worker.fetch(new Request('https://irontuna.com/api/auth/me', {
    headers: { Cookie: cookie.split(';')[0] }
  }), env, ctx)).json();
  ok('and the session is signed in and entitled', me.signedIn === true && me.entitled === true, JSON.stringify(me));

  const again = await worker.fetch(new Request(link), env, ctx);
  ok('the link is one-time', again.headers.get('Location') === 'https://irontuna.com/?login=used', String(again.headers.get('Location')));
}

// ── the rate limit still holds ─────────────────────────────────────────────
console.log('\nthe per-address daily cap');
{
  const db = makeDb(), kv = makeKv(), env = envOf(db, kv);
  buy(db, 'buyer@example.com');
  resetMail();
  for (let i = 0; i < 8; i++) await ask(env, 'buyer@example.com');
  ok('a customer gets five links a day and no more', mail.calls.length === 5, String(mail.calls.length));

  // The counter is spent before the entitlement check, so hammering the route
  // with a stranger's address cannot be used to time the database lookup.
  const kv2 = makeKv(), env2 = envOf(makeDb(), kv2);
  await ask(env2, 'stranger@example.com');
  ok('an unentitled request is counted too', kv2.map.get('mlreq:stranger@example.com') === '1', String(kv2.map.get('mlreq:stranger@example.com')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
