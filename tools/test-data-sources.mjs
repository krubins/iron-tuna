#!/usr/bin/env node
// The data-licensing boundary. See docs/data-sources.md and Section 14 of
// docs/in-season-conversion-spec-addendum-1.md.
//   node tools/test-data-sources.mjs
//
// The addendum asks for a `lib/sources/` directory and a lint that fails when a
// fetch to an external host appears outside it. There is no lib/ here: the app
// is one _worker.js plus a root index.html (HANDOFF.md §2), so a directory
// boundary has nothing to divide. This enforces the same rule the only way that
// works in this repo — an allowlist. Every external host the worker can reach is
// named below with the reason it is allowed, and a host that is not named fails
// the build. Adding a source therefore takes two deliberate edits: this list,
// and the inventory in docs/data-sources.md.
//
// It also holds the red list. Those hosts are not merely unlisted, they are
// forbidden: the operators' own endpoints, and any prediction market.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// Every host _worker.js is allowed to name, and why. "content" sources supply
// the factual data the product is built on and carry a licensing question;
// "service" hosts are vendors Iron Tuna is a paying or authenticated customer
// of, and "own" is us.
const ALLOWED = {
  'api.the-odds-api.com':     { kind: 'content', why: 'paid odds feed; commercial display terms pending (docs/data-sources.md R3)' },
  'site.api.espn.com':        { kind: 'content', why: 'REMEDIATION PENDING: undocumented endpoints, no commercial licence (R1)' },
  'api.sleeper.app':          { kind: 'content', why: 'REMEDIATION PENDING: non-commercial grant only (R2)' },
  'static.www.nfl.com':       { kind: 'content', why: 'REMEDIATION PENDING: hot-linked league imagery, rights unreviewed (R4)' },
  'api.stripe.com':           { kind: 'service', why: 'payments' },
  'api.resend.com':           { kind: 'service', why: 'transactional mail' },
  'api.anthropic.com':        { kind: 'service', why: 'LLM provider' },
  'api.openai.com':           { kind: 'service', why: 'LLM provider, alternate' },
  'challenges.cloudflare.com':{ kind: 'service', why: 'Turnstile' },
  'api.twitter.com':          { kind: 'service', why: 'our own posting' },
  'upload.twitter.com':       { kind: 'service', why: 'our own posting' },
  'graph.threads.net':        { kind: 'service', why: 'our own posting' },
  'api.indexnow.org':         { kind: 'service', why: 'search index ping' },
  'github.com':               { kind: 'service', why: 'links only, never fetched' },
  'irontuna.com':             { kind: 'own',     why: 'us' },
  'www.irontuna.com':         { kind: 'own',     why: 'us' },
  // Green sources from Addendum 13.1. Listed ahead of use so adopting them in
  // the R1 swap is one edit rather than an argument with this test.
  'github.com/nflverse':      { kind: 'content', why: 'nflverse-data, CC BY 4.0, attribution owed' },
  'releases.nflverse.com':    { kind: 'content', why: 'nflverse-data, CC BY 4.0, attribution owed' },
  'api.collegefootballdata.com': { kind: 'content', why: 'CFBD; commercial use permitted, no raw passthrough' },
  'api.weather.gov':          { kind: 'content', why: 'US government work, public domain' }
};

// Hosts and terms that must not appear anywhere in the deployed files. Matched
// as hosts, not as words: "DraftKings" is a legitimate site label on /dfs, but
// api.draftkings.com is the operator's own feed. Kalshi is banned outright,
// per the acceptance criterion.
const FORBIDDEN = [
  { pattern: /\bapi\.draftkings\.com\b/i,  why: "operator's own salary feed (Addendum 13.3, 13.7)" },
  { pattern: /\bapi\.fanduel\.com\b/i,     why: "operator's own salary feed (Addendum 13.3, 13.7)" },
  { pattern: /\bkalshi\b/i,                why: 'prediction market data is prohibited by their terms (13.4)' },
  { pattern: /\bpolymarket\b/i,            why: 'prediction market; terms unread, assume the same posture (13.4)' },
  { pattern: /\bapi\.fantasypros\.com\b/i, why: 'scraped projection aggregator (13.6, 13.7)' }
];

const DEPLOYED = ['_worker.js', 'index.html', 'admin.html', 'front.html', 'player.html',
                  'player-search.js', 'it-season.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

console.log('\nthe worker reaches no unlisted host');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const hosts = new Set();
for (const m of worker.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
for (const h of [...hosts].sort()) {
  ok(h, Object.prototype.hasOwnProperty.call(ALLOWED, h),
     'not in the allowlist. Add it to tools/test-data-sources.mjs AND to docs/data-sources.md, or remove the call');
}

console.log('\nno forbidden source anywhere in the deployed files');
for (const f of DEPLOYED) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const { pattern, why } of FORBIDDEN) {
    const hit = src.match(pattern);
    ok(`${f} is free of ${pattern.source}`, !hit, hit ? why : '');
  }
}

console.log('\nthe inventory is kept');
const docPath = path.join(ROOT, 'docs', 'data-sources.md');
ok('docs/data-sources.md exists', fs.existsSync(docPath),
   'Section 14.1 needs one place that lists every source and its licence');
if (fs.existsSync(docPath)) {
  const doc = fs.readFileSync(docPath, 'utf8');
  for (const h of [...hosts].sort()) {
    if ((ALLOWED[h] || {}).kind !== 'content') continue;
    ok(`${h} is in the inventory`, doc.includes(h),
       'a content source the worker reaches but the /data page would not list');
  }
}

// Section 14.4. Naming a binding in a status label ("no LLM_API_KEY") is fine
// and /admin does it; what must never appear client-side is a binding actually
// read, or a secret written out as a literal.
const KEYS = '(?:ODDS_API_KEY|CFBD_API_KEY|DFS_SALARY_API_KEY|LLM_API_KEY|STRIPE_SECRET_KEY|RESEND_API_KEY|AUTH_SECRET|TURNSTILE_SECRET|X_API_SECRET)';
const KEY_READ = new RegExp(`env\\s*\\.\\s*${KEYS}|\\b${KEYS}\\s*[:=]\\s*['"\`][^'"\`]`, 'i');
const SECRET_LITERAL = /\b(sk-[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{16,})\b/;

console.log('\nkeys never reach the browser');
for (const f of DEPLOYED.filter(f => f !== '_worker.js')) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(`${f} reads no key binding`, !KEY_READ.test(src),
     'Section 14.4: keys are worker env bindings, never read client-side');
  ok(`${f} carries no secret literal`, !SECRET_LITERAL.test(src),
     'a live-looking key is written into a file the browser downloads');
}

// A guard made of regexes is worth exactly what its regexes match. These are
// the cases that decide whether the checks above mean anything: the shapes that
// must trip them, and the ones that must not.
console.log('\nthe guard itself catches what it claims to');
const dk = FORBIDDEN[0].pattern, kal = FORBIDDEN[2].pattern;
ok('an operator host trips the red list', dk.test("fetch('https://api.draftkings.com/x')"));
ok('a site label does not', !dk.test('<option value="dk">DraftKings</option>'));
ok('kalshi trips it anywhere', kal.test('// compare against kalshi pricing'));
ok('a key read trips the key check', KEY_READ.test('const k = env.ODDS_API_KEY;'));
ok('a key literal trips it', KEY_READ.test("LLM_API_KEY = 'abc123def'"));
ok('a status label does not', !KEY_READ.test("pill('no LLM_API_KEY', 'bad')"));
ok('a live-shaped secret trips the literal check', SECRET_LITERAL.test('sk_live_51HxxYYzz'));
ok('an unlisted host would fail the allowlist',
   !Object.prototype.hasOwnProperty.call(ALLOWED, 'api.some-scraper.example'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
