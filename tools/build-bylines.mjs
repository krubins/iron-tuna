#!/usr/bin/env node
// Stamp the analyst byline onto every static story page.
//   node tools/build-bylines.mjs           rewrite the pages
//   node tools/build-bylines.mjs --check   fail if any page is stale (CI)
//   node tools/build-bylines.mjs --house   stamp them all to "Iron Tuna Research"
//
// WHY THIS IS A BUILD STEP AND NOT NINETY HAND EDITS. The nav and the footer
// drifted into ten variants across 94 files before build-chrome.mjs existed
// (HANDOFF.md §29), and a byline is the same shape of problem: one line, on
// every page, that nothing renders wrong when it goes stale.
//
// The assignment lives in tools/analyst-pages.mjs; the roster lives in
// _worker.js and nowhere else.
//
// `--house` exists because the newsroom has a kill switch. `ANALYST_PERSONAS`
// off "publishes every piece under Iron Tuna" (§68), and that flag is read at
// request time by the worker — which a static page cannot do. So if the personas
// are ever switched off, these pages do not follow on their own: re-run with
// --house and commit, and the site says one thing again. That is a manual step
// and it is written down here because nothing else would notice.
//
// It is deliberately idempotent. A byline is parsed back into its parts before
// it is rewritten, so running the tool twice cannot leave "Iron Tuna" in the
// line twice, and a page whose date or call count was hand-edited keeps that
// edit — the tool owns the byline and the publisher, and nothing else.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { roster, analystFor, bylineHtml } from './analyst-pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const HOUSE = process.argv.includes('--house');
const DOT = '<span class="dot">&middot;</span>';

const ANALYSTS = roster();
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const stale = [];
const errors = [];
let stamped = 0;

// Split an existing byline back into the parts the PAGE owns. The name, the
// role and the publisher are ours and are dropped; anything else — "September 3,
// 2026", "5 calls, auction edition" — is the page's and survives untouched.
const OURS = new Set(['Iron Tuna', 'Iron Tuna Research',
  ...Object.values(ANALYSTS).map(a => a.role)]);
function tailOf(html) {
  const m = html.match(/<div class="byline"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return null;
  return m[1].split(DOT)
    .map(s => s.trim())
    .filter(s => s && !/^<b>[\s\S]*<\/b>$/.test(s) && !OURS.has(s));
}

for (const file of files) {
  const id = analystFor(file);
  if (!id) continue;
  const a = ANALYSTS[id];
  if (!a) { errors.push(`${file}: assigned to "${id}", who is not on the roster in _worker.js`); continue; }
  const before = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const line = bylineHtml(a, tailOf(before) || [], HOUSE);
  let next;
  if (/<div class="byline"[^>]*>/.test(before)) {
    next = before.replace(/<div class="byline"[^>]*>[\s\S]*?<\/div>/, line);
  } else {
    // No byline yet: it goes between the headline and the standfirst, which is
    // where the drop pages already put theirs. Anchored on the FIRST </h1>,
    // since every one of these templates has exactly one.
    const at = before.indexOf('</h1>');
    if (at < 0) { errors.push(`${file}: no <h1> to hang a byline on`); continue; }
    const eol = before.slice(at).startsWith('</h1>\r\n') ? '\r\n' : '\n';
    next = before.slice(0, at + 5) + eol + line + before.slice(at + 5);
  }
  if (next !== before) {
    stale.push(file);
    if (!CHECK) { fs.writeFileSync(path.join(ROOT, file), next); stamped++; }
  }
}

if (errors.length) {
  for (const e of errors) console.error('ABORT: ' + e);
  process.exit(1);
}

if (CHECK) {
  if (stale.length) {
    console.error(`the analyst bylines are stale on ${stale.length} page(s) — run 'node tools/build-bylines.mjs' and commit the result`);
    for (const f of stale.slice(0, 20)) console.error('  ' + f);
    process.exit(1);
  }
  console.log('every static story page carries its analyst byline');
} else {
  console.log(`bylines: ${stamped} page(s) updated${stamped ? '' : ' (no change)'}${HOUSE ? ' [house byline]' : ''}`);
}
