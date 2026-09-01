#!/usr/bin/env node
// Tests for "Just Posted" — the front page's and the insights hub's mirror of
// whatever the desk has actually posted to X (§10's INSIGHTS_X_POOL + the
// x_posts log), served from /api/posted-insights (_worker.js).
//   node tools/test-posted-insights.mjs
//
// What this guards: the join between a logged x_posts row and the current
// INSIGHTS_X_POOL is by id, and the pool is hand-pasted (§10 has no build
// step for it) — a future edit that changes an id's shape, or a page whose
// call anchors stop being #call-1..N, breaks the link silently: the worker
// still returns 200, the row just vanishes from the list. Nothing else in
// the repo would catch that.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

// ── lift INSIGHTS_X_POOL the same way §10's own tooling reads it ───────────
const poolMatch = worker.match(/const INSIGHTS_X_POOL = (\[[\s\S]*?\]);/);
ok('INSIGHTS_X_POOL is present in _worker.js', !!poolMatch);
const POOL = poolMatch ? JSON.parse(poolMatch[1]) : [];
ok('the pool is non-empty', POOL.length > 0, `${POOL.length} entries`);

// ── lift wireHref the same way it's shipped, so this tests the real code ──
const hrefSrc = worker.match(/function wireHref\(it\) \{[\s\S]*?\n\}/);
ok('wireHref is present in _worker.js', !!hrefSrc);
const wireHref = hrefSrc ? new Function('it', hrefSrc[0].replace(/^function wireHref\(it\) \{/, '').replace(/\}$/, '')) : null;

// ── the route exists and is wired to the payload builder ──────────────────
ok('/api/posted-insights route is registered', worker.includes("url.pathname === '/api/posted-insights'"));
ok('the route calls postedInsightsPayload', worker.includes('postedInsightsPayload(env)'));
ok('the payload only reads ok=1 posts from the three insight formats',
  /format IN \('auction','snake','bestball'\)/.test(worker));

// ── every pool entry resolves to a real anchor on a real page on disk ─────
if (wireHref && POOL.length) {
  let badHref = 0, badFile = 0, badAnchor = 0;
  for (const it of POOL) {
    const href = wireHref(it);
    const [pagePath, anchor] = href.split('#');
    if (!pagePath.startsWith('/') || !anchor || !/^call-\d+$/.test(anchor)) { badHref++; continue; }
    const file = path.join(ROOT, pagePath.slice(1) + '.html');
    if (!fs.existsSync(file)) { badFile++; continue; }
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes(`id="${anchor}"`)) badAnchor++;
  }
  ok('every pool entry\'s wireHref() is well-formed', badHref === 0, `${badHref} malformed`);
  ok('every pool entry\'s drop page exists on disk', badFile === 0, `${badFile} missing`);
  ok('every pool entry\'s #call-N anchor exists on its page', badAnchor === 0, `${badAnchor} missing anchors`);
}

// ── pool ids are unique, since the join and the D1 log both key on them ───
if (POOL.length) {
  const ids = new Set(POOL.map(it => it.id));
  ok('every pool id is unique', ids.size === POOL.length, `${POOL.length - ids.size} duplicates`);
}

// ── the front page and the insights hub both carry the markup + fetch ─────
const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
ok('front.html has the Just Posted section, hidden by default',
  /<div class="sec-head" id="wire" hidden>/.test(front));
ok('front.html fetches /api/posted-insights', front.includes("fetch('/api/posted-insights')"));
ok('front.html reveals the section via setSectionVisible', /setSectionVisible\(\['wire', 'wireSub', 'wireList'\]/.test(front));

const insightsHub = fs.readFileSync(path.join(ROOT, 'insights.html'), 'utf8');
ok('insights.html has the Just Posted block, hidden by default',
  /<div id="justposted" hidden>/.test(insightsHub));
ok('insights.html fetches /api/posted-insights', insightsHub.includes("fetch('/api/posted-insights')"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
