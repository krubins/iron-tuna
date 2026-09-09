#!/usr/bin/env node
// The RANKINGS SECTION: the ribbon that sits under the hero, and the per-position
// pages the two rankings menus drop down to.
//
//   node tools/build-ranks.mjs           writes the files
//   node tools/build-ranks.mjs --check   writes nothing, exits 1 if anything is stale
//
// EVERY EDIT IS IDEMPOTENT — running it twice changes nothing. Run it after
// changing the ribbon or the position list, alongside `node tools/build-chrome.mjs`
// and `node tools/build-seo.mjs` (in that order: this tool scaffolds a page, the
// chrome tool gives it a header and a footer, the SEO tool tags it).
//
// WHY A GENERATOR. The ribbon is one link set that has to be identical on
// nineteen pages, and the two menus under it drop down to fourteen pages that
// differ only by a position and a horizon. Hand-writing either is how the site's
// nav drifted into ten variants before build-chrome.mjs existed; the same
// sentinel discipline is used here, so this tool finds and replaces only its own
// output and never touches a page's body.
//
// WHAT IT OWNS
//   <!--ranks:ribbon--> … <!--/ranks:ribbon-->   the section ribbon, on every
//                                                page that carries the sentinel
//   /* ranks:css */ … /* /ranks:css */           the ribbon's stylesheet, in
//                                                site.css AND in front.html's
//                                                inline <style> (front.html is
//                                                self-contained and links no
//                                                shared sheet)
//   the fourteen position pages                  SCAFFOLDED ONCE, then left
//                                                alone apart from their ribbon:
//                                                build-chrome and build-seo edit
//                                                them afterwards, so regenerating
//                                                a whole file on every run would
//                                                undo those two on every run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// ── the position list ────────────────────────────────────────────────────────
// `key` is what /api/boards is asked for; `slug` is the URL; `label` is the
// ribbon menu's word and `long` the page's own. FLEX is a pooled RB/WR/TE rank
// rather than a position, which is why its page says so in as many words.
//
// This list is duplicated as literal strings in _worker.js's POST_DRAFT_PAGES —
// deliberately, and there is a comment there saying why (two test suites parse
// that set out of the source text). Adding a position is an edit in both places.
const POSITIONS = [
  { key: 'QB', slug: 'qb', label: 'Quarterbacks', short: 'QB', long: 'Quarterback' },
  { key: 'RB', slug: 'rb', label: 'Running backs', short: 'RB', long: 'Running back' },
  { key: 'WR', slug: 'wr', label: 'Wide receivers', short: 'WR', long: 'Wide receiver' },
  { key: 'TE', slug: 'te', label: 'Tight ends', short: 'TE', long: 'Tight end' },
  { key: 'FLEX', slug: 'flex', label: 'Flex (RB/WR/TE)', short: 'FLEX', long: 'Flex' },
  { key: 'K', slug: 'k', label: 'Kickers', short: 'K', long: 'Kicker' },
  { key: 'DST', slug: 'dst', label: 'Defence / special teams', short: 'DST', long: 'Defence / special teams' },
];

// The two rankings categories. `horizon` is the /api/boards horizon; `weeks` says
// whether a row can be expanded into the weeks ahead — only the season-long
// board can, because "this week" is one week and there is nothing to open.
const CATEGORIES = [
  {
    id: 'week', horizon: 'week', slug: 'weekly', menu: 'This Week&rsquo;s Rankings',
    hub: '/weekly-rankings', hubFile: 'weekly-rankings.html', weeks: false,
    noun: 'this week', title: 'Week', h1: 'This week',
  },
  {
    id: 'season', horizon: 'ros', slug: 'season-long', menu: 'Season Long Rankings',
    hub: '/season-long-rankings', hubFile: 'season-long-rankings.html', weeks: true,
    noun: 'the rest of the season', title: 'Rest of season', h1: 'Rest of season',
  },
];

const pageFile = (cat, pos) => cat.slug + '-' + pos.slug + '-rankings.html';
const pageHref = (cat, pos) => '/' + cat.slug + '-' + pos.slug + '-rankings';

// ── the ribbon ───────────────────────────────────────────────────────────────
// Five destinations. Two of them carry every position under them, which is the
// whole reason this band exists: a reader who wants receivers this week should
// not have to load a rankings page and then work a segmented control.
//
// The menus open on HOVER and on FOCUS, in CSS, with no script — the same
// mechanism the header's own dropdowns use (site.css, .nav-dd). On a phone a
// hover menu is unreachable, so the trigger is a real link to the category's hub
// page and the hub lists every position as a chip; the same chip row is on every
// position page, so the menu is a shortcut rather than the only way through.
const RIBBON_OPEN = '<!--ranks:ribbon-->', RIBBON_CLOSE = '<!--/ranks:ribbon-->';

function menuHtml(cat) {
  const kids = [`<a href="${cat.hub}">Overall</a>`]
    .concat(POSITIONS.map((p) => `<a href="${pageHref(cat, p)}">${p.label}</a>`))
    .join('');
  return [
    '    <span class="rkr-item rkr-has-menu">',
    `      <a class="rkr-link" href="${cat.hub}">${cat.menu}</a>`,
    `      <span class="rkr-menu" role="group" aria-label="${cat.menu.replace(/&rsquo;/g, "’")} by position">${kids}</span>`,
    '    </span>',
  ].join('\n');
}

function ribbonHtml(current) {
  const link = (href, label) =>
    `    <a class="rkr-link rkr-item" href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`;
  return [
    RIBBON_OPEN,
    '<nav class="rk-ribbon" aria-label="Rankings and intel">',
    '  <div class="rk-ribbon-in">',
    link('/stats', 'Stats'),
    menuHtml(CATEGORIES[0]),
    menuHtml(CATEGORIES[1]),
    link('/hidden-value', 'Hidden Value'),
    link('/previews', 'Previews'),
    '  </div>',
    '</nav>',
    RIBBON_CLOSE,
  ].join('\n');
}

// ── the ribbon's stylesheet ──────────────────────────────────────────────────
// One block, injected into two files with different palettes. site.css names its
// ink --text/--sec/--muted and its surfaces --bg/--panel; front.html names the
// same things --ink/--ink-2/--ink-3 and --card/--bg. Rather than fork the CSS,
// every colour here reads through a local alias with the other file's token as
// the fallback and a literal as the floor — which is also the one form
// tools/test-css-tokens.mjs accepts unconditionally, since `var(--x, …)` is the
// language's own way of saying "this may not be set".
const CSS_OPEN = '/* ranks:css */', CSS_CLOSE = '/* /ranks:css */';
const RIBBON_CSS = `${CSS_OPEN}
/* ── the section ribbon (generated by tools/build-ranks.mjs) ─────────────────
   Under the hero on the front page, under the header everywhere else. Five
   destinations; the two rankings menus drop every position down on hover and on
   keyboard focus. Do not hand-edit — run the tool. */
.rk-ribbon {
  --rkr-ink: var(--ink, var(--text, #111820));
  --rkr-mut: var(--ink-2, var(--sec, #39454f));
  --rkr-line: var(--line, #e3e8ec);
  --rkr-brand: var(--brand, #0e7c63);
  --rkr-card: var(--card, #ffffff);
  --rkr-panel: var(--panel, var(--brand-tint, #f7f9fa));
  background: var(--rkr-card); border-bottom: 1px solid var(--rkr-line);
  border-top: 1px solid var(--rkr-line);
  box-shadow: 0 1px 4px rgba(16, 19, 23, .05); position: relative;
  /* Above front.html's sticky .topbars (z-index 40), or a dropped menu that
     reaches down past the lead story is painted behind it. Still under the
     player-search menu, which is fixed and parented to <body>. */
  z-index: 45;
}
/* NO OVERFLOW ON THIS ROW. A menu cannot hang out of a scroll container:
   overflow-x:auto with overflow-y:visible computes to overflow-y:auto — the
   spec is explicit about it — so the dropdown would be clipped at the band's
   46px and turned into a scrollbar. front.html learned this the hard way with
   its own ribbon's search box (see the note beside .rb-search). The band wraps
   instead of scrolling here; on a phone, where the menus are off anyway, the
   media query below turns the sideways scroll back on. */
.rk-ribbon-in {
  max-width: 1180px; margin: 0 auto; padding: 0 20px;
  display: flex; align-items: stretch; flex-wrap: wrap; gap: 2px;
}
.rk-ribbon .rkr-item { position: relative; display: flex; align-items: center; flex: 0 0 auto }
.rk-ribbon .rkr-link {
  display: flex; align-items: center; white-space: nowrap; text-decoration: none;
  font-size: 12.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: var(--rkr-mut); padding: 14px 13px; border-bottom: 3px solid transparent; min-height: 46px;
}
.rk-ribbon .rkr-link:hover, .rk-ribbon .rkr-link:focus-visible {
  color: var(--rkr-ink); border-bottom-color: var(--rkr-brand); text-decoration: none;
}
.rk-ribbon .rkr-link[aria-current="page"] { color: var(--rkr-ink); border-bottom-color: var(--rkr-brand) }
.rk-ribbon .rkr-has-menu > .rkr-link::after { content: "\\25BE"; margin-left: 6px; font-size: .85em; opacity: .7 }
.rk-ribbon .rkr-menu {
  display: flex; flex-direction: column; visibility: hidden; opacity: 0;
  transition: opacity .12s ease, visibility 0s linear .3s;
  position: absolute; top: 100%; left: 0; z-index: 60; min-width: 232px;
  background: var(--rkr-card); border: 1px solid var(--rkr-line); border-top: 2px solid var(--rkr-brand);
  border-radius: 0 0 10px 10px; padding: 6px;
  box-shadow: 0 14px 30px rgba(16, 19, 23, .16);
}
/* Bridges the 0px gap between the trigger and the menu so the pointer can cross
   it without the menu closing under it. */
.rk-ribbon .rkr-menu::before { content: ""; position: absolute; top: -8px; left: 0; right: 0; height: 10px }
.rk-ribbon .rkr-has-menu:hover .rkr-menu,
.rk-ribbon .rkr-has-menu:focus-within .rkr-menu { visibility: visible; opacity: 1; transition-delay: 0s }
.rk-ribbon .rkr-menu a {
  display: block; padding: 9px 12px; border-radius: 7px; white-space: nowrap; text-decoration: none;
  font-size: 13.5px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--rkr-mut);
}
.rk-ribbon .rkr-menu a:hover, .rk-ribbon .rkr-menu a:focus-visible {
  background: var(--rkr-panel); color: var(--rkr-ink); text-decoration: none;
}
.rk-ribbon .rkr-menu a[aria-current="page"] { color: var(--rkr-brand); font-weight: 800 }
/* A hover menu is unreachable on touch, so below the desktop breakpoint the
   trigger is simply a link to the category's hub — which lists every position as
   a chip, as does every position page. Nothing is lost; the menu was a shortcut. */
@media (max-width: 860px) {
  .rk-ribbon .rkr-menu { display: none }
  /* And with the menu gone, so is the caret: an arrow that opens nothing is a
     promise the band cannot keep. The trigger is a plain link to the hub. */
  .rk-ribbon .rkr-has-menu > .rkr-link::after { content: none }
  .rk-ribbon .rkr-link { padding: 12px 10px; font-size: 11.5px; letter-spacing: .05em }
  .rk-ribbon-in {
    padding: 0 12px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
  }
  .rk-ribbon-in::-webkit-scrollbar { display: none }
}
${CSS_CLOSE}`;

// ── the generated pages ──────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The chip row: every position in this category, on every page in it. This is
// the touch path to a position page and the desktop path between two of them.
function chipsHtml(cat, currentSlug) {
  const one = (href, label, on) =>
    `<a class="rkc-chip${on ? ' on' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
  return ['<nav class="rk-chips" aria-label="Position">',
    '  ' + one(cat.hub, 'Overall', currentSlug === null),
    ...POSITIONS.map((p) => '  ' + one(pageHref(cat, p), p.short, currentSlug === p.slug)),
    '</nav>'].join('\n');
}

function titleFor(cat, pos) {
  if (!pos) return cat.id === 'week' ? 'This Week’s Fantasy Football Rankings' : 'Rest of Season Fantasy Football Rankings';
  return (cat.id === 'week' ? 'This Week’s ' : 'Rest of Season ') + pos.short + ' Rankings';
}

function dekFor(cat, pos) {
  const who = pos ? (pos.key === 'FLEX' ? 'every running back, receiver and tight end on one pooled board' : 'every ' + pos.long.toLowerCase()) : 'every position';
  return cat.id === 'week'
    ? `What the fantasy consensus projects for ${who} this week, beside what the betting market implies, and the gap between the two.`
    : `What the fantasy consensus projects for ${who} across the rest of the season, beside what the betting market implies — with every remaining week openable on any row.`;
}

function pageHtml(cat, pos) {
  const href = pos ? pageHref(cat, pos) : cat.hub;
  const title = titleFor(cat, pos);
  const dek = dekFor(cat, pos);
  const posKey = pos ? pos.key : 'ALL';
  const h1 = pos
    ? (cat.id === 'week' ? 'This week’s ' : 'Rest-of-season ') + pos.short + ' rankings'
    : (cat.id === 'week' ? 'This week’s rankings' : 'Rest-of-season rankings');
  return `<!doctype html>
<html lang="en">
<head>
<!-- Google tag (gtag.js). tools/build-seo.mjs ADDS the GA4 destination to an
     existing tag but never writes the tag itself, so a scaffolded page has to
     ship with both configs or it is silently untagged forever. -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18397866361"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'AW-18397866361');
  gtag('config', 'G-KLBZBZSJ25');
</script>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Iron Tuna</title>
<meta name="description" content="${esc(dek)}">
<link rel="canonical" href="https://irontuna.com${href}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)} | Iron Tuna">
<meta property="og:description" content="${esc(dek)}">
<meta property="og:url" content="https://irontuna.com${href}">
<meta property="og:image" content="https://irontuna.com/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/tuna-mark.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<style>
/* Every rule this page needs is in site.css (.rk-* and .is-*). The block is kept
   because tools/build-chrome.mjs anchors the shared stylesheet link and its
   strip-owned pass on it. */
</style>
</head>
<body>
<header class="site"><div class="wrap">
    <a class="brand" href="/" aria-label="Iron Tuna home"><svg class="brand-logo" viewBox="0 0 296.6 56.0" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Iron Tuna"><defs><linearGradient id="wordMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff"/><stop offset="20%" stop-color="#dde8ee"/><stop offset="44%" stop-color="#a4bbc2"/><stop offset="50%" stop-color="#7d99a0"/><stop offset="55%" stop-color="#6f928b"/><stop offset="74%" stop-color="#b0c2c8"/><stop offset="100%" stop-color="#46555e"/></linearGradient></defs><g><text x="10.40" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="65" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">I</text><text x="40.86" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="57.99999999999999" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">R</text><text x="76.92" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="50" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">O</text><text x="109.14" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="46" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">N</text><text x="155.08" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="46" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">T</text><text x="187.30" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="50" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">U</text><text x="222.40" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="55.00000000000001" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">N</text><text x="262.30" y="27.500000000000004" font-family="'Bebas Neue','Impact',sans-serif" font-size="65" text-anchor="middle" dominant-baseline="central" fill="url(#wordMetal)">A</text></g></svg></a>
    <nav class="nav" id="sitenav" aria-label="Main"></nav>
</div></header>
${ribbonHtml(href)}
<!-- .wide, like /fantasy and /dfs: a two-group board is eleven columns and
     820px turns every one of them into a sideways scroll. -->
<main id="main">
<!-- The head runs on the black band (.rk-hero in site.css), which is full-bleed
     and therefore sits OUTSIDE the .wrap rather than inside it. Everything
     below the band takes the wrap back. -->
<div class="rk-hero"><div class="wrap wide">
<p class="is-eyebrow">In-Season &middot; Rankings &middot; ${esc(cat.h1)}</p>
<h1>${esc(h1)}</h1>
<p class="is-lede">${dek}</p>
</div></div>
<div class="wrap wide">
<div class="its-strip" data-season-strip></div>

${chipsHtml(cat, pos ? pos.slug : null)}

<div class="rk-board"
     data-rk-board
     data-rk-horizon="${cat.horizon}"
     data-rk-pos="${posKey}"
     data-rk-weeks="${cat.weeks ? '1' : '0'}"
     data-rk-label="${esc(cat.h1)}"></div>

<h2>How to read the two columns</h2>
<p class="is-note"><b>Fantasy Consensus</b> is the projection consensus, scored at the setting you choose and nudged by a player&rsquo;s live usage once three games have earned it. <b>Betting Odds</b> is the same player priced off the sportsbook: his own posted props where a book has quoted them, otherwise the posted game line&rsquo;s scoring environment applied to his line, otherwise a fitted team rating for a fixture nobody has posted yet. The <b>Gap</b> column is the second minus the first, in points and in rank slots, and the verdict beside it is the site&rsquo;s standing classification of that gap. Neither column is a tip. They are two honest readings of the same player, and the argument between them is the useful part.</p>

<h2>The rest of the section</h2>
<div class="is-grid">
  <div class="is-card"><h3><a href="/rankings">The full rankings tool</a></h3><p>Every horizon, every board and your own league&rsquo;s scoring in one place.</p></div>
  <div class="is-card"><h3><a href="/hidden-value">Hidden Value</a></h3><p>Where the two columns on this page disagree by enough to act on.</p></div>
  <div class="is-card"><h3><a href="/stats">Stats</a></h3><p>What has actually been played, rather than what is projected.</p></div>
  <div class="is-card"><h3><a href="/previews">Previews</a></h3><p>Every game this week with its line, its total and the points each offence is implied to score.</p></div>
</div>
</div>
</main>
<footer class="site"><div class="wrap"></div></footer>
<!-- it-season.js puts the week on the strip above; it-ranks.js is the board.
     The scoring engine is NOT loaded here: unlike /rankings, this page asks the
     worker for the board already scored at the chosen preset, because the
     week-by-week drawer prints per-week points the browser has no stat line to
     recompute. One fetch per preset, edge-cached, instead of two engines to keep
     in step. -->
<script src="/it-season.js" defer></script>
<script src="/it-ranks.js" defer></script>
</body>
</html>
`;
}

// ── the edits ────────────────────────────────────────────────────────────────
const changed = [];
const created = [];

function putRibbon(html, current) {
  const block = ribbonHtml(current);
  if (!html.includes(RIBBON_OPEN)) return html;
  return html.replace(
    new RegExp(RIBBON_OPEN + '[\\s\\S]*?' + RIBBON_CLOSE.replace(/\//g, '\\/')),
    () => block,
  );
}

function putCss(text) {
  if (!text.includes(CSS_OPEN)) return text;
  const re = new RegExp(CSS_OPEN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[\\s\\S]*?' + CSS_CLOSE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  return text.replace(re, () => RIBBON_CSS);
}

function write(file, next, before) {
  if (next === before) return;
  changed.push(file);
  if (!CHECK) fs.writeFileSync(path.join(ROOT, file), next);
}

// 1. the pages. Scaffolded once; after that only their ribbon is maintained,
//    because build-chrome.mjs and build-seo.mjs own regions of the same files.
const wanted = [];
for (const cat of CATEGORIES) {
  wanted.push({ file: cat.hubFile, cat, pos: null });
  for (const pos of POSITIONS) wanted.push({ file: pageFile(cat, pos), cat, pos });
}

for (const w of wanted) {
  const full = path.join(ROOT, w.file);
  if (!fs.existsSync(full)) {
    created.push(w.file);
    if (!CHECK) fs.writeFileSync(full, pageHtml(w.cat, w.pos));
    continue;
  }
  const before = fs.readFileSync(full, 'utf8');
  write(w.file, putRibbon(before, w.pos ? pageHref(w.cat, w.pos) : w.cat.hub), before);
}

// 2. the ribbon on every other page that asks for it, and the CSS in the two
//    files that carry it.
const others = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort()
  .filter((f) => !wanted.some((w) => w.file === f));
for (const f of others) {
  const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!before.includes(RIBBON_OPEN)) continue;
  // A page in the ribbon's own link set marks itself; everything else (the
  // front page included) marks nothing.
  write(f, putRibbon(before, '/' + f.replace(/\.html$/, '')), before);
}

for (const f of ['site.css', 'front.html']) {
  const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!before.includes(CSS_OPEN)) {
    console.error(`build-ranks: ${f} has no ${CSS_OPEN} sentinel — add one where the ribbon's CSS should live`);
    process.exit(1);
  }
  write(f, putCss(before), before);
}

// ── report ───────────────────────────────────────────────────────────────────
if (CHECK) {
  if (created.length || changed.length) {
    console.error('build-ranks --check: the rankings section is stale. Run: node tools/build-ranks.mjs');
    created.forEach((f) => console.error('  missing  ' + f));
    changed.forEach((f) => console.error('  stale    ' + f));
    process.exit(1);
  }
  console.log(`build-ranks --check: up to date (${wanted.length} pages, ${POSITIONS.length} positions)`);
} else {
  console.log(created.length ? `build-ranks: created ${created.length} page(s):\n  ${created.join('\n  ')}` : 'build-ranks: no page created');
  console.log(changed.length ? `build-ranks: updated ${changed.length} file(s)` : 'build-ranks: no change');
  if (created.length) console.log('Now run: node tools/build-chrome.mjs && node tools/build-seo.mjs');
}
