#!/usr/bin/env node
// The RANKINGS SECTION's ribbon: the band under the header on every in-season
// page that carries it.
//
//   node tools/build-ranks.mjs           writes the files
//   node tools/build-ranks.mjs --check   writes nothing, exits 1 if anything is stale
//
// EVERY EDIT IS IDEMPOTENT — running it twice changes nothing. Run it after
// changing the ribbon or the position list, alongside `node tools/build-chrome.mjs`
// and `node tools/build-seo.mjs`.
//
// 11 Oct 2026 (Ken): THERE IS ONE RANKINGS PAGE. The ribbon carries one
// "Rankings" item, /rankings, whose menu drops every position onto that page
// (#pos=RB), where the horizon row sorts the one board as this week, the next
// three weeks, the playoffs or the rest of the season. Until then this tool
// also scaffolded sixteen per-position pages and two hubs (/weekly-<pos>-rankings,
// /season-long-<pos>-rankings) and the ribbon listed them as two destinations;
// those pages are gone from the repo and _worker.js 301s their addresses onto
// /rankings with the horizon and the position in the hash.
//
// WHY A GENERATOR. The ribbon is one link set that has to be identical on every
// page that carries it. Hand-writing it is how the site's nav drifted into ten
// variants before build-chrome.mjs existed; the same sentinel discipline is
// used here, so this tool finds and replaces only its own output and never
// touches a page's body.
//
// WHAT IT OWNS
//   <!--ranks:ribbon--> … <!--/ranks:ribbon-->   the section ribbon, on every
//                                                page that carries the sentinel
//   /* ranks:css */ … /* /ranks:css */           the ribbon's stylesheet, in
//                                                site.css
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// ── the position list ────────────────────────────────────────────────────────
// `key` is what /rankings reads out of #pos= (and asks /api/boards for);
// `label` is the ribbon menu's word. FLEX is a pooled RB/WR/TE rank rather
// than a position. `slug`, `short` and `long` named the per-position pages
// this tool no longer writes and are kept for the record.
const POSITIONS = [
  { key: 'QB', slug: 'qb', label: 'Quarterbacks', short: 'QB', long: 'Quarterback' },
  { key: 'RB', slug: 'rb', label: 'Running backs', short: 'RB', long: 'Running back' },
  { key: 'WR', slug: 'wr', label: 'Wide receivers', short: 'WR', long: 'Wide receiver' },
  { key: 'TE', slug: 'te', label: 'Tight ends', short: 'TE', long: 'Tight end' },
  { key: 'FLEX', slug: 'flex', label: 'Flex (RB/WR/TE)', short: 'FLEX', long: 'Flex' },
  { key: 'K', slug: 'k', label: 'Kickers', short: 'K', long: 'Kicker' },
  { key: 'DST', slug: 'dst', label: 'Defense / special teams', short: 'DST', long: 'Defense / special teams' },
];

// ── the ribbon ───────────────────────────────────────────────────────────────
// Five destinations. One of them, Rankings, carries every position under it,
// which is the whole reason this band exists: a reader who wants receivers
// should not have to load the rankings page and then find the control.
//
// The menu opens on HOVER and on FOCUS, in CSS, with no script — the same
// mechanism the header's own dropdowns use (site.css, .nav-dd). On a phone a
// hover menu is unreachable, so the trigger is a real link to /rankings, whose
// position tiles are the first thing under its hero; the menu is a shortcut
// rather than the only way through.
const RIBBON_OPEN = '<!--ranks:ribbon-->', RIBBON_CLOSE = '<!--/ranks:ribbon-->';

// The one rankings destination. Every position lands on the one page with the
// position in the hash; the page reads it on load and on hashchange. DST is the
// page's own key for the defense tile, as it is /api/boards'.
const RANKINGS = { href: '/rankings', menu: 'Rankings' };
const toolHref = (p) => `${RANKINGS.href}#pos=${p.key}`;

function menuHtml(current) {
  const kids = POSITIONS.map((p) => `<a href="${toolHref(p)}">${p.label}</a>`).join('');
  return [
    '    <span class="rkr-item rkr-has-menu">',
    `      <a class="rkr-link" href="${RANKINGS.href}"${current === RANKINGS.href ? ' aria-current="page"' : ''}>${RANKINGS.menu}</a>`,
    `      <span class="rkr-menu" role="group" aria-label="${RANKINGS.menu} by position">${kids}</span>`,
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
    menuHtml(current),
    link('/hidden-value', 'Hidden Value'),
    link('/previews', 'Previews'),
    link('/the-line', 'The Line'),
    '  </div>',
    '</nav>',
    RIBBON_CLOSE,
  ].join('\n');
}

// ── the ribbon's stylesheet ──────────────────────────────────────────────────
// One block, in site.css. It was injected into two files with different
// palettes while front.html carried the ribbon too: site.css names its ink
// --text/--sec/--muted and its surfaces --bg/--panel, front.html named the same
// things --ink/--ink-2/--ink-3 and --card/--bg. The CSS was never forked over
// that — every color here reads through a local alias with the other file's
// token as the fallback and a literal as the floor — and the aliases are kept,
// so a second self-contained carrier costs nothing. It is also the one form
// tools/test-css-tokens.mjs accepts unconditionally, since `var(--x, …)` is the
// language's own way of saying "this may not be set".
const CSS_OPEN = '/* ranks:css */', CSS_CLOSE = '/* /ranks:css */';
const RIBBON_CSS = `${CSS_OPEN}
/* ── the section ribbon (generated by tools/build-ranks.mjs) ─────────────────
   Under the header on every page that carries the sentinel. The front page is
   not one of them: it shows the choose-your-game band in this slot. Five
   destinations; the Rankings menu drops every position down on hover and on
   keyboard focus. Do not hand-edit — run the tool. */
.rk-ribbon {
  --rkr-ink: var(--ink, var(--text, #111418));
  --rkr-mut: var(--ink-2, var(--sec, #454c57));
  --rkr-line: var(--line, #e2e4e8);
  --rkr-brand: var(--brand, #0b4f6c);
  --rkr-card: var(--card, #ffffff);
  --rkr-panel: var(--panel, var(--brand-tint, #eef2f7));
  background: var(--rkr-card); border-bottom: 1px solid var(--rkr-line);
  border-top: 1px solid var(--rkr-line); position: relative;
  /* Above a page's sticky header (z-index 40), or a dropped menu that reaches
     down past the content is painted behind it. Still under the player-search
     menu, which is fixed and parented to <body>. */
  z-index: 45;
}
/* NO OVERFLOW ON THIS ROW. A menu cannot hang out of a scroll container:
   overflow-x:auto with overflow-y:visible computes to overflow-y:auto — the
   spec is explicit about it — so the dropdown would be clipped at the band's
   46px and turned into a scrollbar. The homepage's own sticky ribbon learned
   this the hard way with the player-lookup menu it carried. The band wraps
   instead of scrolling here; on a phone, where the menus are off anyway, the
   media query below turns the sideways scroll back on. */
.rk-ribbon-in {
  max-width: 1240px; margin: 0 auto; padding: 0 32px;
  display: flex; align-items: stretch; flex-wrap: wrap; gap: 2px;
}
.rk-ribbon .rkr-item { position: relative; display: flex; align-items: center; flex: 0 0 auto }
.rk-ribbon .rkr-link {
  display: flex; align-items: center; white-space: nowrap; text-decoration: none;
  font-size: 14px; font-weight: 600; letter-spacing: 0; text-transform: none;
  color: var(--rkr-mut); padding: 0 12px; border-bottom: 3px solid transparent; min-height: 48px;
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
  border-radius: 0 0 4px 4px; padding: 6px;
}
/* Bridges the 0px gap between the trigger and the menu so the pointer can cross
   it without the menu closing under it. */
.rk-ribbon .rkr-menu::before { content: ""; position: absolute; top: -8px; left: 0; right: 0; height: 10px }
.rk-ribbon .rkr-has-menu:hover .rkr-menu,
.rk-ribbon .rkr-has-menu:focus-within .rkr-menu { visibility: visible; opacity: 1; transition-delay: 0s }
.rk-ribbon .rkr-menu a {
  display: block; padding: 10px 12px; border-radius: 4px; white-space: nowrap; text-decoration: none;
  font-size: 16px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--rkr-ink);
}
.rk-ribbon .rkr-menu a:hover, .rk-ribbon .rkr-menu a:focus-visible {
  background: var(--rkr-panel); color: var(--rkr-ink); text-decoration: none;
}
.rk-ribbon .rkr-menu a[aria-current="page"] { color: var(--rkr-brand); font-weight: 600 }
/* A hover menu is unreachable on touch, so below the desktop breakpoint the
   trigger is simply a link to /rankings, whose position tiles sit under its
   hero. Nothing is lost; the menu was a shortcut. */
@media (max-width: 860px) {
  .rk-ribbon .rkr-menu { display: none }
  /* And with the menu gone, so is the caret: an arrow that opens nothing is a
     promise the band cannot keep. The trigger is a plain link to the hub. */
  .rk-ribbon .rkr-has-menu > .rkr-link::after { content: none }
  .rk-ribbon .rkr-link { padding: 0 10px; font-size: 13px; min-height: 44px }
  .rk-ribbon-in {
    padding: 0 16px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
  }
  .rk-ribbon-in::-webkit-scrollbar { display: none }
}
${CSS_CLOSE}`;

// ── the edits ────────────────────────────────────────────────────────────────
const changed = [];

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

// 1. the ribbon on every page that asks for it. A page in the ribbon's own
//    link set marks itself; everything else marks nothing.
for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort()) {
  const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!before.includes(RIBBON_OPEN)) continue;
  write(f, putRibbon(before, '/' + f.replace(/\.html$/, '')), before);
}

// 2. the CSS, in the one file that carries it.
for (const f of ['site.css']) {
  const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!before.includes(CSS_OPEN)) {
    console.error(`build-ranks: ${f} has no ${CSS_OPEN} sentinel — add one where the ribbon's CSS should live`);
    process.exit(1);
  }
  write(f, putCss(before), before);
}

// ── report ───────────────────────────────────────────────────────────────────
if (CHECK) {
  if (changed.length) {
    console.error('build-ranks --check: the rankings ribbon is stale. Run: node tools/build-ranks.mjs');
    changed.forEach((f) => console.error('  stale    ' + f));
    process.exit(1);
  }
  console.log(`build-ranks --check: up to date (${POSITIONS.length} positions)`);
} else {
  console.log(changed.length ? `build-ranks: updated ${changed.length} file(s)` : 'build-ranks: no change');
}
