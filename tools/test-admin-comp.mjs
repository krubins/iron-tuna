#!/usr/bin/env node
// Tests for /api/admin/comp in _worker.js — comp an address and email it the
// link that opens it.
//   node --experimental-sqlite tools/test-admin-comp.mjs
//
// This route hands out PAID ACCESS and then puts a working sign-in link in
// someone's inbox, so the things worth proving are the ones that read as
// success and are not: a link sent to an address the grant never reached, an
// email Resend refused while the response still said ok, and a one-time link
// that is dead on arrival because its nonce was never registered. The happy
// path is proved end to end — the emitted link is followed through
// /api/auth/verify to /api/auth/me, because a link that does not actually sign
// anyone in is the whole failure this route exists to prevent.
//
// Same arrangement as tools/test-admin-grant.mjs: the worker is imported and
// driven directly (wrangler dev needs to reach Cloudflare for Request.cf and
// cannot run offline), env.LEADS_DB is real SQLite via node:sqlite so the SQL
// genuinely executes, and global fetch is stubbed so no mail is ever sent.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); }
catch (e) { console.log('SKIP — needs node:sqlite (run with --experimental-sqlite on Node 22)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── a D1 shim over real SQLite ─────────────────────────────────────────────
// sessions carries the columns /api/auth/verify actually writes, so the
// end-to-end sign-in below exercises the real INSERT rather than a subset.
function makeDb(opts = {}) {
  const db = new DatabaseSync(':memory:');
  if (!opts.noTables) {
    db.exec(`CREATE TABLE entitlements (email TEXT PRIMARY KEY, product TEXT, paid_at INTEGER);
             CREATE TABLE sessions (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER, last_seen INTEGER, ua TEXT);`);
  }
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

// ── a KV shim ──────────────────────────────────────────────────────────────
// Records the TTL it was given, because the one-time nonce has to outlive the
// link's own expiry or the link dies early with "already used".
function makeKv(opts = {}) {
  const map = new Map(), ttl = new Map();
  return {
    map, ttl,
    get: async k => (map.has(k) ? map.get(k) : null),
    put: async (k, v, o) => { if (opts.failPut) throw new Error('kv down'); map.set(k, v); ttl.set(k, o && o.expirationTtl); },
    delete: async k => { map.delete(k); }
  };
}

// ── a Resend shim ──────────────────────────────────────────────────────────
const mail = { calls: [], mode: 'ok' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const href = String(u && u.url ? u.url : u);
  if (href.startsWith('https://api.resend.com/')) {
    let body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
    mail.calls.push({ href, body, auth: (init && init.headers && init.headers.Authorization) || '' });
    if (mail.mode === 'throw') throw new Error('socket hang up');
    if (mail.mode === 'refuse') return new Response(JSON.stringify({ message: 'domain is not verified' }), { status: 422, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ id: 're_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected outbound fetch in test: ' + href);
};
const resetMail = (mode = 'ok') => { mail.calls.length = 0; mail.mode = mode; };

const KEY = 'test-admin-key';
const worker = (await import(pathToFileURL(path.join(ROOT, '_worker.js')).href)).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const baseEnv = { LEADS_EXPORT_KEY: KEY, AUTH_SECRET: 'test-secret', RESEND_API_KEY: 're_test' };
const call = (env, p, init) => worker.fetch(new Request('https://irontuna.com' + p, init), env, ctx);
const jsonOf = async r => { try { return await r.json(); } catch (e) { return null; } };
const envOf = (db, kv, extra = {}) => ({ ...baseEnv, LEADS_DB: db, RATE_KV: kv, ...extra });

// ── the gate ───────────────────────────────────────────────────────────────
console.log('\nthe key gate');
{
  const db = makeDb(), env = envOf(db, makeKv());
  resetMail();
  for (const q of ['', '?email=a@b.com', '?key=&email=a@b.com', '?key=wrong&email=a@b.com']) {
    const r = await call(env, '/api/admin/comp' + q);
    ok(`comp is refused with "${q || '(nothing)'}"`, r.status === 403, String(r.status));
  }
  ok('a refused call writes nothing', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 0);
  ok('a refused call sends nothing', mail.calls.length === 0);
}

// ── input validation ───────────────────────────────────────────────────────
console.log('\ninput validation');
{
  const db = makeDb(), env = envOf(db, makeKv());
  resetMail();
  for (const bad of ['', 'notanemail', 'a@b', 'a b@c.com', '@b.com']) {
    const r = await call(env, `/api/admin/comp?key=${KEY}&email=${encodeURIComponent(bad)}`);
    ok(`"${bad}" is rejected`, r.status === 400, String(r.status));
  }
  for (const bad of ['0', '-3', '91', 'lots', '1.5']) {
    const r = await call(env, `/api/admin/comp?key=${KEY}&email=a@b.com&days=${encodeURIComponent(bad)}`);
    const j = await jsonOf(r);
    ok(`days=${bad} is rejected`, r.status === 400 && j.error === 'bad_days', String(r.status));
  }
  ok('no junk rows were created', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 0);
  ok('nothing was emailed to a rejected address', mail.calls.length === 0);
}

// ── the happy path, end to end ─────────────────────────────────────────────
console.log('\ncomping an address and mailing the link');
let happyLink = null;
{
  const db = makeDb(), kv = makeKv(), env = envOf(db, kv);
  resetMail();
  const j = await jsonOf(await call(env, `/api/admin/comp?key=${KEY}&email=Friend@Example.com`));
  ok('the request succeeds', j && j.ok === true, JSON.stringify(j));
  ok('the address is normalised to lowercase', j.email === 'friend@example.com', j.email);
  ok('it reports the account as entitled', j.entitled === true);
  ok('it reports that something changed', j.changed === true);
  ok('it reports the mail as sent', j.sent === true && j.emailError === null, JSON.stringify({ sent: j.sent, err: j.emailError }));

  const row = db.raw.prepare('SELECT * FROM entitlements WHERE email=?').get('friend@example.com');
  ok('the row is written lowercase, as isEntitled looks it up', !!row, JSON.stringify(row));
  ok('the row carries the bundle product', row && row.product === 'bundle');

  ok('exactly one email was sent', mail.calls.length === 1, String(mail.calls.length));
  const m = mail.calls[0] || { body: {} };
  ok('it went to the address that was comped', m.body.to === 'friend@example.com', String(m.body.to));
  ok('it is authenticated with the Resend key', /Bearer re_test/.test(m.auth), m.auth);
  ok('the subject says free access, not "sign in to your purchase"', /free access/i.test(m.body.subject || ''), m.body.subject);
  ok('the body does not tell a comped reader to unlock a purchase', !/your purchase/i.test(m.body.html || ''));
  ok('the body carries the same link the response returned', (m.body.html || '').indexOf(j.link) > -1);

  happyLink = j.link;
  ok('the link points at the verify route', /^https:\/\/irontuna\.com\/api\/auth\/verify\?token=/.test(j.link || ''), j.link);
  ok('it defaults to a 14-day link', j.days === 14, String(j.days));
  const life = new Date(j.expiresAt).getTime() - Date.now();
  ok('expiresAt matches that lifetime', life > 13.9 * 86400e3 && life <= 14 * 86400e3, j.expiresAt);
  const nonceKey = [...kv.map.keys()].find(k => k.startsWith('mln:'));
  ok('the one-time nonce is registered', !!nonceKey, [...kv.map.keys()].join(','));
  ok('the nonce outlives the link it guards', kv.ttl.get(nonceKey) === 14 * 86400, String(kv.ttl.get(nonceKey)));

  // The whole point: the link has to actually sign them in.
  const v = await call(env, '/api/auth/verify?token=' + encodeURIComponent(new URL(j.link).searchParams.get('token')));
  ok('following the link redirects rather than erroring', v.status === 302, String(v.status));
  const cookie = v.headers.get('Set-Cookie') || '';
  ok('...and sets a session cookie', /^it_sess=[^;]+;/.test(cookie), cookie.slice(0, 40));
  ok('...for the right person', db.raw.prepare('SELECT COUNT(*) c FROM sessions WHERE email=?').get('friend@example.com').c === 1);
  const me = await jsonOf(await call(env, '/api/auth/me', { headers: { Cookie: cookie.split(';')[0] } }));
  ok('the signed-in session reports full access', me && me.entitled === true && me.email === 'friend@example.com', JSON.stringify(me));

  // Single use, same as any magic link.
  const again = await call(env, '/api/auth/verify?token=' + encodeURIComponent(new URL(j.link).searchParams.get('token')));
  ok('the link cannot be used twice', again.status === 302 && /login=used/.test(again.headers.get('Location') || ''), again.headers.get('Location'));
}

// ── a second comp for the same address ─────────────────────────────────────
console.log('\ncomping someone who already has access');
{
  const db = makeDb(), env = envOf(db, makeKv());
  resetMail();
  await call(env, `/api/admin/comp?key=${KEY}&email=friend@example.com`);
  const j = await jsonOf(await call(env, `/api/admin/comp?key=${KEY}&email=friend@example.com`));
  ok('it still succeeds', j.ok === true && j.entitled === true);
  ok('but reports no change', j.changed === false, JSON.stringify(j));
  ok('and says so plainly', /already had access/i.test(j.note || ''), j.note);
  ok('only one row exists', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 1);
  ok('a fresh link was sent anyway, since that is what was asked for', mail.calls.length === 2, String(mail.calls.length));
}

// ── send=0: grant now, send the link by hand ───────────────────────────────
console.log('\nsend=0 (hand the link over yourself)');
{
  const db = makeDb(), env = envOf(db, makeKv());
  resetMail();
  const j = await jsonOf(await call(env, `/api/admin/comp?key=${KEY}&email=dm@example.com&send=0&days=1`));
  ok('access is still granted', j.ok === true && j.entitled === true);
  ok('nothing was emailed', mail.calls.length === 0 && j.sent === false);
  ok('the note says nothing was emailed', /Nothing was emailed/i.test(j.note || ''), j.note);
  ok('the link is still returned to pass on', /\/api\/auth\/verify\?token=/.test(j.link || ''), j.link);
  ok('the shorter lifetime is honoured', j.days === 1 && new Date(j.expiresAt).getTime() - Date.now() <= 86400e3, j.expiresAt);
}

// ── the send that quietly fails ────────────────────────────────────────────
// The response must not read as success when the inbox got nothing.
console.log('\nwhen Resend refuses the message');
{
  for (const [mode, label] of [['refuse', 'a 422 from Resend'], ['throw', 'a network failure']]) {
    const db = makeDb(), env = envOf(db, makeKv());
    resetMail(mode);
    const j = await jsonOf(await call(env, `/api/admin/comp?key=${KEY}&email=bounce@example.com`));
    ok(`${label}: access is still granted`, j.entitled === true && !!db.raw.prepare('SELECT 1 FROM entitlements WHERE email=?').get('bounce@example.com'));
    ok(`${label}: sent is false`, j.sent === false, JSON.stringify(j.sent));
    ok(`${label}: the reason is reported`, !!j.emailError, String(j.emailError));
    ok(`${label}: the note says the email did NOT send`, /did NOT send/.test(j.note || ''), j.note);
    ok(`${label}: the link is still returned so it can be sent by hand`, /\/api\/auth\/verify\?token=/.test(j.link || ''), j.link);
  }
  // No key configured at all is the same class of problem, reported the same way.
  const db = makeDb(), env = envOf(db, makeKv(), { RESEND_API_KEY: '' });
  resetMail();
  const j = await jsonOf(await call(env, `/api/admin/comp?key=${KEY}&email=nokey@example.com`));
  ok('no RESEND_API_KEY: nothing is attempted', mail.calls.length === 0);
  ok('no RESEND_API_KEY: it is reported, not swallowed', j.sent === false && /RESEND_API_KEY/.test(j.emailError || ''), j.emailError);
}

// ── nothing is sent to an address the grant never reached ──────────────────
console.log('\nwhen the grant itself fails');
{
  const db = makeDb({ noTables: true }), env = envOf(db, makeKv());
  resetMail();
  const r = await call(env, `/api/admin/comp?key=${KEY}&email=nobody@example.com`);
  const j = await jsonOf(r);
  ok('the request fails loudly', r.status === 500 && j.error === 'grant_failed', JSON.stringify(j));
  ok('no link was minted or sent', mail.calls.length === 0 && !j.link);

  // No database bound at all: the same refusal, before anything is attempted.
  const noDb = { ...baseEnv, RATE_KV: makeKv() };
  const r2 = await call(noDb, `/api/admin/comp?key=${KEY}&email=nobody@example.com`);
  ok('no database bound is refused too', r2.status === 500 && (await jsonOf(r2)).error === 'no_db', String(r2.status));
  ok('...and still sends nothing', mail.calls.length === 0);
}

// ── a link that would be dead on arrival ───────────────────────────────────
// /api/auth/verify enforces single use through RATE_KV. If the nonce write
// fails while KV is bound, the link is not merely unguarded — it reads as
// already used. Sending it would be worse than sending nothing.
console.log('\nwhen the one-time nonce cannot be registered');
{
  const db = makeDb(), env = envOf(db, makeKv({ failPut: true }));
  resetMail();
  const r = await call(env, `/api/admin/comp?key=${KEY}&email=deadlink@example.com`);
  const j = await jsonOf(r);
  ok('the request fails rather than mailing a dead link', r.status === 500 && j.error === 'link_store_failed', JSON.stringify(j));
  ok('nothing was emailed', mail.calls.length === 0);
  ok('the note admits access was already granted', /granted/i.test(j.note || ''), j.note);
}

// ── no AUTH_SECRET means no signable link ──────────────────────────────────
console.log('\nwhen AUTH_SECRET is missing');
{
  const db = makeDb();
  const env = { LEADS_EXPORT_KEY: KEY, RESEND_API_KEY: 're_test', LEADS_DB: db, RATE_KV: makeKv() };
  resetMail();
  const r = await call(env, `/api/admin/comp?key=${KEY}&email=nosecret@example.com`);
  const j = await jsonOf(r);
  ok('it refuses instead of granting half a thing', r.status === 500 && j.error === 'no_auth_secret', JSON.stringify(j));
  ok('no entitlement was written', db.raw.prepare('SELECT COUNT(*) c FROM entitlements').get().c === 0);
  ok('nothing was emailed', mail.calls.length === 0);
  ok('the note names the fix', /AUTH_SECRET/.test(j.note || ''), j.note);
}

// ── addresses comped in code ───────────────────────────────────────────────
console.log('\naddresses comped in code');
{
  const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const m = src.match(/const COMPED_EMAILS = \[([^\]]*)\]/);
  const owner = m && m[1].split(',')[0].trim().replace(/^'|'$/g, '');
  ok('COMPED_EMAILS is readable at module scope', !!owner, String(owner));
  if (owner) {
    const db = makeDb(), env = envOf(db, makeKv());
    resetMail();
    const j = await jsonOf(await call(env, `/api/admin/comp?key=${KEY}&email=${encodeURIComponent(owner)}`));
    ok('comping an owner address still works', j.ok === true && j.entitled === true, JSON.stringify(j));
    ok('...and says the access was already there in code', /COMPED_EMAILS/.test(j.note || ''), j.note);
    ok('...and the link is still sent', j.sent === true && mail.calls.length === 1);
  }
}

// ── the admin page drives the route it actually has ────────────────────────
// admin.html is hand-written with no build step, so a renamed parameter would
// only show up as a form that silently 400s.
console.log('\nadmin.html against this route');
{
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('the page calls /api/admin/comp', html.includes('/api/admin/comp'));
  for (const p of ['key=', 'email=', 'days=', 'send=0']) ok(`it passes ${p}`, html.includes("'&" + p) || html.includes("'/api/admin/comp?" + p), p);
  ok('it has an email field and a button', /id="compEmail"/.test(html) && /id="compBtn"/.test(html));
  ok('it shows the link back for hand-delivery', /id="compLink"/.test(html));
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
