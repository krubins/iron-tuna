#!/usr/bin/env node
// The reading view: the pages a reader reads rather than uses.
//   node tools/test-reading-view.mjs
//
// The site has two visual zones. The app, the front page and the guides are
// dark. The three READING pages — the standing analyst column, the standing
// play-caller column, and the article page every generated story lands on — are
// white with near-black type.
//
// The palette is duplicated inline in all three files. That is the repo's
// convention (every page carries its own <style>; there is no shared stylesheet
// and no build step to make one), and it is exactly the setup where one page
// gets updated and the others quietly drift. Nothing but this file keeps them in
// step.
//
// Going light is not a background swap, and these are the three things a later
// edit gets wrong by copying a palette off one of the dark pages:
//   - #2dd4a3 is about 1.9:1 on white. The reading view needs its own teal.
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

const PAGES = ['lead.html', 'analyst-desk.html', 'play-caller-premium.html'];
const DARK = ['front.html', 'index.html'];

console.log('\nthe reading pages are one surface');
for (const f of PAGES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const root = (src.match(/:root\{[^}]*\}/) || [''])[0];
  ok(`${f} is white`, /--bg:\s*#fff/i.test(root), root.slice(0, 80));
  ok(`${f} sets near-black type`, /--text:\s*#1[0-9a-f]{5}/i.test(root), root.slice(0, 80));
  ok(`${f} uses the white-safe teal`, /--teal:\s*#0d7a5f/i.test(root));
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
  // to be the darker ink. Both columns do this: the record table's Partly
  // column, and the two-sided verdict chip.
  const desk = fs.readFileSync(path.join(ROOT, 'analyst-desk.html'), 'utf8');
  const pcp = fs.readFileSync(path.join(ROOT, 'play-caller-premium.html'), 'utf8');
  ok('the record table\'s Partly column is ink gold', desk.includes('.n-partial{color:var(--goldink)'));
  ok('the two-sided verdict chip is ink gold', pcp.includes('color:var(--goldink)'));
  for (const [f, src] of [['analyst-desk.html', desk], ['play-caller-premium.html', pcp]]) {
    ok(`${f} defines --goldink it reaches for`, /--goldink:\s*#[0-9a-f]{6}/i.test(src));
  }
  // The buttons keep the bright fill: dark text on a gold block is fine on white.
  ok('buttons keep the bright gold fill',
     PAGES.every(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('background:var(--gold)')));
}

console.log('\nthe dark zone is still dark');
{
  // This is the other half of the contract. If someone "fixes" the whole site to
  // one palette, that is a decision to make on purpose, not by a stray edit.
  for (const f of DARK) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const root = (src.match(/:root\{[^}]*\}/) || [''])[0];
    ok(`${f} is still dark`, !/--bg:\s*#fff/i.test(root), root.slice(0, 80));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
