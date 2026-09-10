#!/usr/bin/env node
// The analyst byline on the site's static story pages.
//   node tools/test-bylines.mjs
//
// WHAT THIS EXISTS FOR. The newsroom bylines what it generates (HANDOFF.md §68);
// these are the pages it does not touch, stamped from the same roster so the
// site has ONE masthead rather than two. The failure this guards is not a crash:
// it is a page crediting an analyst who has been renamed or removed, or a byline
// link to an author page that no longer resolves, and nothing renders wrong in
// either case.
//
// It also holds the two honesty rules the newsroom set and these pages have to
// keep: the byline is one click from the AI disclosure, and the roster is never
// copied into a second file.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { roster, analystFor, PAGE_ANALYST, PAGE_ANALYST_PATTERNS } from './analyst-pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); fails++; } };

const ANALYSTS = roster();
const worker = read('_worker.js');

// ── 1. the roster is the worker's, not a copy ──────────────────────────────
ok(Object.keys(ANALYSTS).length >= 8, `read only ${Object.keys(ANALYSTS).length} analysts out of _worker.js`);
{
  // Nothing under tools/ may hard-code an analyst's name: that is the second
  // copy this whole arrangement exists to avoid.
  const src = read('tools/analyst-pages.mjs') + read('tools/build-bylines.mjs');
  for (const a of Object.values(ANALYSTS)) {
    ok(!src.includes(a.name),
      `tools/ hard-codes the name "${a.name}" — the roster must come from _worker.js at run time`);
  }
}

// ── 2. every assignment names a real analyst ───────────────────────────────
for (const [file, id] of Object.entries(PAGE_ANALYST)) {
  ok(!!ANALYSTS[id], `${file} is assigned to "${id}", who is not on the roster`);
  ok(fs.existsSync(path.join(ROOT, file)), `${file} is assigned a byline but does not exist`);
}
for (const p of PAGE_ANALYST_PATTERNS) ok(!!ANALYSTS[p.analyst], `pattern ${p.re} names "${p.analyst}", who is not on the roster`);

// ── 3. every story page carries the right byline ───────────────────────────
{
  const used = new Set();
  let pages = 0;
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
    const id = analystFor(f);
    if (!id) continue;
    pages++;
    used.add(id);
    const html = read(f);
    const m = html.match(/<div class="byline" data-analyst="([^"]*)">([\s\S]*?)<\/div>/);
    ok(!!m, `${f} has no analyst byline`);
    if (!m) continue;
    const a = ANALYSTS[id];
    ok(m[1] === id, `${f} is bylined "${m[1]}"; the assignment says "${id}"`);
    ok(m[2].includes(`>${a.name}</a>`), `${f} does not print ${JSON.stringify(a.name)}`);
    ok(m[2].includes(a.role), `${f} does not print the role ${JSON.stringify(a.role)}`);
    // One click to the page that says these are personas, not people.
    ok(m[2].includes(`href="/analysts/${id}"`), `${f} does not link its byline to /analysts/${id}`);
    ok(m[2].includes('Iron Tuna'), `${f} drops the publisher from its byline`);
  }
  ok(pages > 85, `only ${pages} static story pages carry a byline, which is fewer than the site publishes`);
  for (const id of used) ok(!!ANALYSTS[id], `pages are bylined to "${id}", who is not on the roster`);
}

// ── 4. the byline link actually resolves ───────────────────────────────────
// /analysts/<id> is a rewrite to the /analyst shell, not a file, so nothing that
// walks the directory can confirm it. Pin the route instead.
{
  const m = worker.match(/\/\^\\\/analysts\\\/\[a-z\]\+\\\/\?\$\//);
  ok(!!m, '_worker.js no longer routes /analysts/<id> — every byline link is now a 404');
  for (const id of new Set(Object.values(PAGE_ANALYST).concat(PAGE_ANALYST_PATTERNS.map((p) => p.analyst)))) {
    ok(/^[a-z]+$/.test(id), `analyst id ${JSON.stringify(id)} does not match the /analysts/<id> route pattern`);
  }
}

// ── 5. the pages that must NOT be bylined ──────────────────────────────────
// A byline on a hub, a landing page or a live dashboard is a claim that somebody
// wrote a list or a table that is recomputed on every load.
for (const f of ['guides.html', 'auction-insights.html', 'auction-watch.html', 'insights-vault.html',
                 'fantasy-football-auction-values.html', 'rankings.html', 'vegas-edge.html', 'in-season.html']) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  ok(!analystFor(f), `${f} is a hub, landing page or dashboard and must not be assigned a byline`);
  ok(!/<div class="byline"/.test(read(f)), `${f} carries a byline and should not`);
}

// ── 6. the disclosure still exists to link to ──────────────────────────────
ok(/const AI_DISCLOSURE = /.test(worker), '_worker.js no longer defines AI_DISCLOSURE');
ok(/personas, not people/.test(worker), 'the AI disclosure no longer says the analysts are not people');

if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log(`bylines: ${Object.keys(ANALYSTS).length} analysts, one masthead, on every static story page`);
