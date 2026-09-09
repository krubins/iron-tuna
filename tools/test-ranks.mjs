#!/usr/bin/env node
// The rankings section: the ribbon under the hero, the per-position pages under
// its two menus, and the board that fills them.
//   node tools/test-ranks.mjs
//
// WHAT THIS EXISTS FOR. Three failures here are silent — the page renders, the
// build gates pass, and only a reader finds out:
//
//   1. THE RIBBON DRIFTS. It is one link set on twenty pages. build-ranks.mjs
//      generates it, but a hand edit inside the sentinels survives until the
//      next run of the tool, and nobody runs a tool they have not been told is
//      stale. So the link set is compared BYTE FOR BYTE across every page that
//      carries it, and the tool's --check is the gate that keeps it there.
//   2. THE MENU IS CLIPPED. `overflow-x: auto` with `overflow-y: visible`
//      computes to `overflow-y: auto` — so a dropdown inside a sideways-
//      scrolling band is not "mostly fine", it is invisible below 46px. This
//      exact bug is why front.html's own ribbon parents its search menu to
//      <body>. The row must not be a scroll container at desktop width.
//   3. A PAGE IS UNGATED. /rankings is behind POST_DRAFT_OPEN. A per-position
//      page that is not in POST_DRAFT_PAGES serves the whole board while the
//      section is shut, and tools/test-seo.mjs would then demand a sitemap entry
//      for it. The two lists are read out of their own files and compared.
//
// It also holds the pages to the promise their menus make: every position in
// the ribbon has a page, every page asks the board for that position, and only
// the season-long pages open into the weeks ahead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const POSITIONS = ['qb', 'rb', 'wr', 'te', 'flex', 'k', 'dst'];
const CATS = [
  { slug: 'weekly', horizon: 'week', weeks: '0' },
  { slug: 'season-long', horizon: 'ros', weeks: '1' },
];
const LANES = ['stats.html', 'hidden-value.html', 'previews.html'];
const pageFile = (c, p) => `${c.slug}-${p}-rankings.html`;
const hubFile = (c) => `${c.slug}-rankings.html`;
const allBoards = CATS.flatMap((c) => [hubFile(c), ...POSITIONS.map((p) => pageFile(c, p))]);

// ── the pages exist and ask for the right board ──────────────────────────────
console.log('\nevery position in the menu has a page of its own');
{
  const missing = allBoards.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  ok('all sixteen rankings pages exist', missing.length === 0, missing.join(', '));

  const wrong = [];
  for (const c of CATS) {
    for (const p of [null, ...POSITIONS]) {
      const f = p ? pageFile(c, p) : hubFile(c);
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      const h = read(f);
      const mount = (h.match(/<div class="rk-board"[\s\S]*?><\/div>/) || [''])[0];
      const attr = (k) => (mount.match(new RegExp(`data-rk-${k}="([^"]*)"`)) || [, ''])[1];
      if (attr('horizon') !== c.horizon) wrong.push(`${f}: horizon=${attr('horizon')} want ${c.horizon}`);
      if (attr('pos') !== (p ? p.toUpperCase() : 'ALL')) wrong.push(`${f}: pos=${attr('pos')}`);
      if (attr('weeks') !== c.weeks) wrong.push(`${f}: weeks=${attr('weeks')} want ${c.weeks}`);
    }
  }
  ok('each one asks the board for its own horizon and position', wrong.length === 0, wrong.slice(0, 4).join('; '));

  // Only the season-long boards can open a row: "this week" is one week, and a
  // drawer holding a single row is a control that does nothing.
  const weekOpens = CATS[0] && [hubFile(CATS[0]), ...POSITIONS.map((p) => pageFile(CATS[0], p))]
    .filter((f) => fs.existsSync(path.join(ROOT, f)) && /data-rk-weeks="1"/.test(read(f)));
  ok('no weekly board offers a week-by-week drawer', weekOpens.length === 0, weekOpens.join(', '));

  const noDrawer = [hubFile(CATS[1]), ...POSITIONS.map((p) => pageFile(CATS[1], p))]
    .filter((f) => fs.existsSync(path.join(ROOT, f)) && !/data-rk-weeks="1"/.test(read(f)));
  ok('every season-long board does', noDrawer.length === 0, noDrawer.join(', '));

  const noScript = allBoards.concat(LANES).filter((f) => fs.existsSync(path.join(ROOT, f)))
    .filter((f) => f.includes('rankings') && !read(f).includes('src="/it-ranks.js"'));
  ok('and loads the one board script', noScript.length === 0, noScript.join(', '));
}

// ── the ribbon is one link set, everywhere ───────────────────────────────────
console.log('\nthe ribbon is generated, and identical on every page that carries it');
const RIB = /<!--ranks:ribbon-->([\s\S]*?)<!--\/ranks:ribbon-->/;
const carriers = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && RIB.test(read(f))).sort();
{
  ok('the ribbon is on the front page', carriers.includes('front.html'));
  ok('on the full rankings tool', carriers.includes('rankings.html'));
  ok('on all sixteen rankings pages', allBoards.every((f) => carriers.includes(f)));
  ok('and on the three other destinations', LANES.every((f) => carriers.includes(f)));

  // Byte for byte, once the one legitimate per-page difference — which item is
  // marked current — is taken out.
  const shape = (f) => read(f).match(RIB)[1].replace(/ aria-current="page"/g, '');
  const shapes = new Map();
  for (const f of carriers) {
    const s = shape(f);
    if (!shapes.has(s)) shapes.set(s, []);
    shapes.get(s).push(f);
  }
  ok('there is exactly one ribbon shape', shapes.size === 1,
    shapes.size + ' variants, e.g. ' + [...shapes.values()].map((v) => v[0]).slice(0, 4).join(' / '));

  const rib = read('front.html').match(RIB)[1];
  const links = [...rib.matchAll(/<a[^>]*class="rkr-link[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].trim());
  ok('it carries the five destinations, in order',
    links.join('|') === 'Stats|This Week&rsquo;s Rankings|Season Long Rankings|Hidden Value|Previews', links.join('|'));

  const menus = [...rib.matchAll(/<span class="rkr-menu"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  ok('two of them drop down', menus.length === 2, String(menus.length));
  for (const [i, c] of CATS.entries()) {
    const hrefs = [...(menus[i] || '').matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    const want = ['/' + c.slug + '-rankings', ...POSITIONS.map((p) => `/${c.slug}-${p}-rankings`)];
    ok(`the ${c.slug} menu drops every position`, hrefs.join(',') === want.join(','), hrefs.join(','));
  }
}

// ── the ribbon sits under the hero, not somewhere else ───────────────────────
console.log('\nwhere the ribbon sits');
{
  const front = read('front.html');
  const heroEnd = front.indexOf('</section>', front.indexOf('<section class="hero-band"'));
  const ribAt = front.indexOf('<!--ranks:ribbon-->');
  const nextSec = front.indexOf('<section', heroEnd);
  ok('it is after the hero band', ribAt > heroEnd, `hero ends ${heroEnd}, ribbon at ${ribAt}`);
  ok('and before anything else on the page', ribAt < nextSec, `next section at ${nextSec}`);
  // The in-page anchor ribbon further down is a different band with a different
  // job. Confusing the two is how one of them ends up navigating away.
  ok('the page still has its own in-page anchor ribbon', front.includes('<div class="ribbon" data-lane="fantasy">'));
  ok('and the two are not the same element', !/<div class="ribbon"[^>]*>[\s\S]{0,200}rkr-link/.test(front));
}

// ── the dropdown is not inside a scroll container ────────────────────────────
console.log('\nthe menu can actually hang out of the band');
{
  // overflow-x:auto with overflow-y:visible computes to overflow-y:auto, so a
  // menu inside such a row is clipped at the band's height. The desktop rule
  // must declare no overflow at all; the phone rule may, because the menus are
  // display:none there.
  const css = read('site.css').match(/\/\* ranks:css \*\/([\s\S]*?)\/\* \/ranks:css \*\//)[1];
  const desktop = css.split('@media')[0];
  ok('the desktop row is not a scroll container', !/\.rk-ribbon-in\s*\{[^}]*overflow/.test(desktop),
    (desktop.match(/\.rk-ribbon-in\s*\{[^}]*\}/) || [''])[0]);
  ok('the phone row is, because its menus are off',
    /@media[^{]*860px[\s\S]*?\.rk-ribbon-in\s*\{[^}]*overflow-x:\s*auto/.test(css));
  ok('and the menus really are off there', /@media[^{]*860px[\s\S]*?\.rkr-menu\s*\{\s*display:\s*none/.test(css));
  ok('the menu opens on focus as well as hover', /\.rkr-has-menu:focus-within \.rkr-menu/.test(css));
  // front.html links no stylesheet, so it carries its own copy of the same
  // bytes. If the two ever differ the ribbon is styled on one surface only.
  const frontCss = read('front.html').match(/\/\* ranks:css \*\/([\s\S]*?)\/\* \/ranks:css \*\//);
  ok('front.html carries the identical block', !!frontCss && frontCss[1] === css);
}

// ── every new page is gated with the rest of the section ─────────────────────
console.log('\nthe section is gated like the rest of the in-season tools');
{
  const worker = read('_worker.js');
  const m = worker.match(/const POST_DRAFT_PAGES = new Set\(\[([^\]]*)\]\)/);
  ok('POST_DRAFT_PAGES is still one bracketed list of literals', !!m);
  const gated = new Set((m ? m[1] : '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  ok('no entry is a computed expression', [...gated].every((g) => /^\/[a-z0-9-]+$/.test(g)),
    [...gated].filter((g) => !/^\/[a-z0-9-]+$/.test(g)).join(', '));
  const want = allBoards.concat(LANES).map((f) => '/' + f.replace(/\.html$/, ''));
  const ungated = want.filter((w) => !gated.has(w));
  ok('every page in the section is in the gate', ungated.length === 0, ungated.join(', '));

  // And the CTA: an in-season page sells the league save, not a draft sheet.
  const chrome = read(path.join('tools', 'build-chrome.mjs'));
  const inSeason = new Set((chrome.match(/const IN_SEASON = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1]
    .split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  const missCta = allBoards.concat(LANES).filter((f) => !inSeason.has(f));
  ok('and is listed as in-season, so its CTA is the league save', missCta.length === 0, missCta.join(', '));
}

// ── the two columns the section is for ───────────────────────────────────────
console.log('\nthe board prints the consensus against the odds');
{
  const js = read('it-ranks.js');
  ok('the two column groups are named in full',
    js.includes('>Fantasy Consensus<') && js.includes('>Betting Odds<'));
  ok('the fantasy side reads the consensus block', /p\.consensus\s*\?\s*p\.consensus\.points/.test(js));
  ok('the market side reads the vegas block', /p\.vegas\s*\?\s*p\.vegas\.points/.test(js));
  ok('and prints what the odds are built from, every row', js.includes('rk-basis'));
  ok('the gap comes from the worker\'s own classification, not a rule invented here',
    js.includes('p.marketDelta') && js.includes('d.classification') && !/strongRank|leanRank/.test(js));
  ok('a missing number is a dash, never a zero', js.includes("'—'"));
  ok('the week drawer prints both columns per week',
    js.includes('w.consensusPts') && js.includes('w.vegasPts'));
  ok('a bye and an absence are printed, not skipped', js.includes('w.bye') && js.includes('w.out'));
  ok('the board is scored on the server, so the drawer cannot disagree with its row',
    js.includes('&scoring=') && !js.includes('ITLeague'));
  ok('and a board that does not answer shows nothing rather than something stale',
    /did not answer/.test(js));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
