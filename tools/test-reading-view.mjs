#!/usr/bin/env node
// The site's palette: one light surface everywhere a reader reads, one dark
// zone for the tool they work in.
//   node tools/test-reading-view.mjs
//
// Until August 2026 this was the other way round — the content pages were dark
// navy and the READING pages (the standing column and the article page every
// generated story lands on) were white, so a reader flashed between two
// palettes on every click. The auction-first pass took all 90-odd content pages
// light and unified the accent, and this file is what keeps them in step: the
// pages below are checked in full, and the whole-site sweep at the bottom
// makes sure nothing drifts back to the retired dark palette.
//
// The palette is duplicated inline in both files. That is the repo's
// convention (every page carries its own <style>; there is no shared stylesheet
// and no build step to make one), and it is exactly the setup where one page
// gets updated and the others quietly drift. Nothing but this file keeps them in
// step.
//
// Going light is not a background swap, and these are the three things a later
// edit gets wrong by copying a palette off one of the dark pages:
//   - #2dd4a3 is about 1.9:1 on white. The light surface needs its own teal.
//   - #f5b800 is a BUTTON FILL. As type on white it is barely there, so bare
//     numerals and chip labels use --goldink instead while buttons keep it.
//   - The wordmark is a light-on-dark metal gradient and disappears on white.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const PAGES = ['lead.html', 'play-caller-premium.html'];
// The draft app is the one dark surface left, on purpose: it is a tool you work
// in on draft night, not a page you read.
const DARK = ['index.html'];
// The front page is light like the rest, but it is not built on this token set
// — it has its own (--ink / --card / --brand) and a black masthead band, so it
// is checked for the shared accent rather than for these variables.
const FRONT = 'front.html';

console.log('\nthe reading pages are one surface');
for (const f of PAGES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const root = (src.match(/:root\{[^}]*\}/) || [''])[0];
  ok(`${f} is white`, /--bg:\s*#fff/i.test(root), root.slice(0, 80));
  ok(`${f} sets near-black type`, /--text:\s*#1[0-9a-f]{5}/i.test(root), root.slice(0, 80));
  ok(`${f} uses the white-safe teal`, /--teal:\s*#0e7c63/i.test(root));
  ok(`${f} keeps no dark-theme accent`,
     !/rgba\(45,\s*212,\s*163/.test(src) && !/rgba\(239,\s*91,\s*91/.test(src)
     && !/rgba\(11,\s*17,\s*23/.test(src), 'a dark-theme rgba survived');
  ok(`${f} inverts the wordmark so it survives on white`,
     !src.includes('stop-color="#dde8ee"'));
  // The sticky header is painted with a literal rgba, not a token, because it
  // is translucent over scrolling content.
  ok(`${f} paints its header light`, /header\.site\{[^}]*rgba\(255,\s*255,\s*255/.test(src));
}

console.log('\ngold is a fill, not an ink');
{
  // Wherever gold carries meaning as TEXT rather than as a filled button, it has
  // to be the darker ink. The standing column does this in its two-sided
  // verdict chip.
  const pcp = fs.readFileSync(path.join(ROOT, 'play-caller-premium.html'), 'utf8');
  ok('the two-sided verdict chip is ink gold', pcp.includes('color:var(--goldink)'));
  ok('play-caller-premium.html defines --goldink it reaches for',
     /--goldink:\s*#[0-9a-f]{6}/i.test(pcp));
  // The buttons keep the bright fill: dark text on a gold block is fine on white.
  ok('buttons keep the bright gold fill',
     PAGES.every(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('background:var(--gold)')));
}

console.log('\nthe rest of the site reads as the same surface');
{
  // The sweep. Every content page carries its own <style> (there is no shared
  // stylesheet and no build step to make one), so the only thing stopping one
  // page from drifting back to the dark palette is this loop.
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const skip = new Set([...DARK, 'admin.html', FRONT]);
  const content = pages.filter((f) => !skip.has(f));
  ok('there are content pages to sweep', content.length > 50, String(content.length));
  // The palette moved OUT of the pages and into /site.css when the shared chrome
  // landed (§29), so the sweep changed shape: a content page must now declare no
  // palette of its own and link the one that does. An inline :root would win,
  // because site.css is linked before the page's own <style> — which is exactly
  // how ninety-one divergent copies happened the first time.
  // PAGES (the reading pages) are checked in full above and keep their own
  // :root on purpose — they are excluded from the shared chrome for the same
  // reason, so they are excluded here rather than being a standing failure.
  const ownRoot = content.filter((f) => !PAGES.includes(f))
    .filter((f) => /:root\s*\{/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok('no content page declares its own palette', ownRoot.length === 0, ownRoot.slice(0, 5).join(', '));
  const noCss = content.filter((f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('href="/site.css"'));
  ok('every content page links the shared one', noCss.length === 0, noCss.slice(0, 5).join(', '));
  const shared = fs.readFileSync(path.join(ROOT, 'site.css'), 'utf8');
  const sroot = (shared.match(/:root\s*\{[\s\S]*?\}/) || [''])[0];
  ok('and the shared palette is white', /--bg:\s*#fff/i.test(sroot), sroot.slice(0, 120));
  ok('on the one accent', /--teal:\s*#0e7c63/i.test(sroot), sroot.slice(0, 120));
  ok('with gold defined as an ink as well as a fill', /--goldink:\s*#[0-9a-f]{6}/i.test(sroot));
  const darkLeft = content.filter((f) => /rgba\(45,\s*212,\s*163/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok('no dark-theme accent survives anywhere', darkLeft.length === 0, darkLeft.slice(0, 5).join(', '));
  const oldMark = content.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('stop-color="#dde8ee"'));
  ok('and no page still draws the light-on-dark wordmark on white', oldMark.length === 0, oldMark.slice(0, 5).join(', '));
}

console.log('\nthe front page is light chrome over a black masthead');
{
  const src = fs.readFileSync(path.join(ROOT, FRONT), 'utf8');
  const root = (src.match(/:root\{[^}]*\}/) || [''])[0];
  ok('the front page is on the light palette', /--bg:\s*#f[0-9a-f]{5}/i.test(root), root.slice(0, 90));
  ok('and shares the site accent as --brand', /--brand:\s*#0e7c63/i.test(root), root.slice(0, 90));
  // The masthead and the hero band ARE dark, and the wordmark on them is the
  // light-on-dark metal. That is why front.html is exempt from the sweep above.
  ok('the masthead band stays black', /--mast:\s*#0b1614/i.test(root));
  ok('and keeps the metal wordmark that belongs on it', src.includes('stop-color="#dde8ee"'));
}

console.log('\nthe draft app is the one dark surface left');
{
  for (const f of DARK) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const root = (src.match(/:root\{[^}]*\}/) || [''])[0];
    ok(`${f} is still dark`, !/--bg:\s*#fff/i.test(root), root.slice(0, 80));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
