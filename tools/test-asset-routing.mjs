#!/usr/bin/env node
// Tests for the asset-rewrite block in _worker.js — the ~6 lines that decide which
// file the assets layer is asked for.
//   node tools/test-asset-routing.mjs
//
// What this exists to stop: on 2026-08-21 /lead answered ERR_TOO_MANY_REDIRECTS in
// the browser. The rewrite asked the assets layer for "/lead.html", and Cloudflare's
// default html_handling ("auto-trailing-slash") answers a ".html" request with a 307
// to the extensionless path — straight back to /lead, which is the very path the
// rewrite fires on. Worker rewrites to /lead.html, assets 307s to /lead, browser asks
// again, forever. The same mistake on "/" was quieter but real: every visit to the
// front door bounced to /front, off the canonical URL.
//
// Neither failure is visible in the worker's own source — it needs the assets layer's
// rules to show up. So this lifts the REAL rewrite block out of _worker.js, models the
// assets layer against the REAL files on disk, and follows the redirects the way a
// browser would. The model's rules were pinned against `wrangler dev` on this repo's
// own config; the ground-truth table is in assetResolve() below.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── lift the rewrite block out of the worker ───────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const S = 'let __assetReq = request;';
const E = '} catch (e) {}';
const s0 = src.indexOf(S);
if (s0 < 0) { console.error('FAIL: could not locate the asset-rewrite block in _worker.js'); process.exit(1); }
const block = src.slice(s0, src.indexOf(E, s0) + E.length);

// The block builds `new Request(new URL(...).toString(), request)`. Only the URL is
// read here, so a stub Request that keeps it is enough — and keeps this test honest
// about evaluating the shipped source rather than a paraphrase of it.
const rewrite = new Function('pathname', `
  const ORIGIN = 'https://irontuna.com';
  const url = new URL(ORIGIN + pathname);
  const request = { url: url.toString() };
  function Request(u) { return { url: String(u) }; }
  ${block}
  return new URL(__assetReq.url).pathname;
`);

// ── model of the assets layer ──────────────────────────────────────────────
// html_handling defaults to "auto-trailing-slash" (wrangler.jsonc sets no override),
// which is what makes ".html" targets a trap. Pinned against `wrangler dev`:
//   /index.html -> 307 /        /faq.html -> 307 /faq     /faq  -> 200 faq.html
//   /faq/       -> 307 /faq     /         -> 200 index    /nope -> 404
const FILES = new Set(
  fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isFile()).map(d => '/' + d.name)
);
function assetResolve(p) {
  if (p === '/index.html') return { status: 307, location: '/' };
  if (p.endsWith('/index.html') && FILES.has(p)) return { status: 307, location: p.slice(0, -'index.html'.length) };
  if (p.endsWith('.html') && FILES.has(p)) return { status: 307, location: p.slice(0, -'.html'.length) };
  if (p === '/' && FILES.has('/index.html')) return { status: 200, file: '/index.html' };
  if (FILES.has(p)) return { status: 200, file: p };
  if (FILES.has(p + '.html')) return { status: 200, file: p + '.html' };
  if (p.endsWith('/') && FILES.has(p.slice(0, -1) + '.html')) return { status: 307, location: p.slice(0, -1) };
  return { status: 404 };
}

// One request as a browser sees it: worker rewrite, assets answer, follow any
// redirect back through the worker, and stop if a path repeats.
function browse(start, maxHops = 12) {
  const seen = [];
  let p = start;
  for (let i = 0; i < maxHops; i++) {
    if (seen.includes(p)) return { loop: true, trail: seen.concat(p) };
    seen.push(p);
    const r = assetResolve(rewrite(p));
    if (r.status === 307) { p = r.location; continue; }
    return { loop: false, status: r.status, file: r.file, hops: i, trail: seen };
  }
  return { loop: true, trail: seen };
}

console.log('\nrewrite targets are served, never redirected');
// [route, the file a reader must end up on]
const ROUTES = [
  ['/',                              '/front.html'],
  ['/lead',                          '/lead.html'],
  ['/lead/',                         '/lead.html'],
  ['/lead/qb-market-2026-08-21-15',  '/lead.html'],
  ['/hub',                           '/index.html'],
  ['/auctiondraft',                  '/index.html'],
  ['/snakedraft',                    '/index.html'],
  ['/bestball',                      '/index.html'],
  // ordinary static pages: the block must not touch these
  ['/faq',                           '/faq.html'],
  ['/analyst-desk',                  '/analyst-desk.html'],
  ['/play-caller-premium',           '/play-caller-premium.html'],
  ['/insights',                      '/insights.html'],
];
for (const [route, file] of ROUTES) {
  const target = rewrite(route);
  const direct = assetResolve(target);
  ok(`${route} rewrites to a target the assets layer serves outright`,
     direct.status === 200,
     `${route} -> ${target} -> ${direct.status}${direct.location ? ' ' + direct.location : ''}` +
     (target.endsWith('.html') ? ' (a ".html" target is always redirected — drop the extension)' : ''));
  ok(`${route} lands on ${file}`, direct.file === file, `got ${direct.file}`);
}

console.log('\nno route redirects, and none loops');
for (const [route, file] of ROUTES) {
  const r = browse(route);
  ok(`${route} does not loop`, !r.loop, r.loop ? 'cycle: ' + r.trail.join(' -> ') : '');
  ok(`${route} answers on the first request`, !r.loop && r.hops === 0 && r.status === 200,
     r.loop ? 'looped' : `status ${r.status} after ${r.hops} redirect(s)`);
  ok(`${route} keeps the reader on ${route}`, !r.loop && r.trail.length === 1 && r.file === file,
     r.loop ? 'looped' : 'ended at ' + r.trail[r.trail.length - 1]);
}

// The shared stylesheet. Every content page links /site.css, so if the rewrite
// block ever swallowed it — or the assets layer answered a redirect for it —
// the whole site would render unstyled while every HTML route still passed.
console.log('\nthe shared stylesheet and the logo are served as-is');
{
  for (const asset of ['/site.css', '/tuna.webp', '/og.png']) {
    const target = rewrite(asset);
    ok(`${asset} is not rewritten`, target === asset, `got ${target}`);
    const r = browse(asset);
    ok(`${asset} is served without a redirect`, !r.loop && r.hops === 0 && r.status === 200,
       r.loop ? 'looped' : `status ${r.status} after ${r.hops} redirect(s)`);
  }
}

// Every local asset a page points at is actually on disk.
console.log('\nno page references an asset that does not exist');
{
  // Renaming tuna.png to tuna.webp and deleting the original left 91 pages
  // pointing at a file that was no longer there, and nothing noticed: the pages
  // rendered, every route resolved, every suite passed, and the only symptom was
  // a broken-image glyph where the logo goes. It came back a second time when a
  // merge took the other side of those 91 files. A missing asset is cheap to
  // assert and invisible to every other check here.
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const missing = new Map();
  for (const p of pages) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(\/[^"?#]+\.(?:png|jpe?g|webp|avif|svg|css|js|ico|woff2?))"/g)) {
      const rel = m[1].replace(/^\//, '');
      if (fs.existsSync(path.join(ROOT, rel))) continue;
      if (!missing.has(m[1])) missing.set(m[1], []);
      missing.get(m[1]).push(p);
    }
  }
  const report = [...missing].map(([a, ps]) => `${a} (${ps.length} page(s), e.g. ${ps[0]})`);
  ok('every local asset a page points at exists on disk', missing.size === 0, report.join('; '));
}

// The bug as it shipped, so this test is known to be able to see it.
console.log('\nthe model reproduces the bug it was written for');
{
  const buggy = new Function('pathname', `
    const url = new URL('https://irontuna.com' + pathname);
    if (/^\\/lead(\\/[A-Za-z0-9._-]*)?\\/?$/.test(url.pathname)) return '/lead.html';
    return pathname;
  `);
  const saved = rewrite;
  const hop = p => { const r = assetResolve(buggy(p)); return r.status === 307 ? r.location : null; };
  let p = '/lead', hops = 0;
  while (hops < 5) { const n = hop(p); if (n === null) break; p = n; hops++; }
  ok('the shipped-on-2026-08-21 rewrite loops under this model', hops === 5 && p === '/lead',
     `stopped at ${p} after ${hops} hops`);
  void saved;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
