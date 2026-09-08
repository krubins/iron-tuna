#!/usr/bin/env node
// The site's chrome is the same on every content page, and every destination is
// reachable from every page.
//   node tools/test-chrome.mjs
//
// THE BUG THIS EXISTS FOR. The nav and footer were hand-maintained in 95 files.
// They drifted into 10 different nav link sets and 13 different footer sets, and
// nothing noticed because each page rendered fine on its own. The visible
// symptom was navigational: from the-pick.html a reader could not reach
// Insights, FAQ, Insight Vault, Play-Caller Premium or Analyst Desk at all, and
// no page in the site linked Privacy and Terms together — the pages a reader
// goes looking for precisely when they are deciding whether to trust you.
//
// build-chrome.mjs --check already fails when a page's chrome is stale against
// the generator. This file asserts the things that would still be true of a
// consistently-wrong generator: that the link set is actually complete, that the
// mobile disclosure nav is wired up, and that the CTA stays format-correct so a
// best-ball guide does not send a reader to the auction board.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Same exclusions as the generator, and for the same reasons.
const EXCLUDE = new Set(['index.html', 'front.html', 'admin.html']);
// The reading pages take the footer and the stylesheet but keep their own short
// header — see the NAV_EXCLUDE note in build-chrome.mjs. `pages` is what the nav
// assertions run over; `allPages` is everything the footer must reach.
const NAV_EXCLUDE = new Set(['lead.html', 'play-caller-premium.html']);
const allPages = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !EXCLUDE.has(f))
  .filter((f) => read(f).includes('<header class="site">'))
  .sort();
const pages = allPages.filter((f) => !NAV_EXCLUDE.has(f));

const header = (h) => (h.match(/<header class="site">[\s\S]*?<\/header>/) || [''])[0];
const footer = (h) => (h.match(/<footer class="site">[\s\S]*?<\/footer>/) || [''])[0];
const hrefs = (frag) => [...frag.matchAll(/<a[^>]*href="([^"]*)"/g)].map((m) => m[1]);

console.log('\nthe chrome is generated, not hand-written');
{
  const noNav = pages.filter((f) => !read(f).includes('<!--chrome:nav-->'));
  const noFoot = allPages.filter((f) => !read(f).includes('<!--chrome:foot-->'));
  const noCss = allPages.filter((f) => !read(f).includes('href="/site.css"'));
  ok('there are content pages to check', pages.length > 50, String(pages.length));
  ok('every page carries the generated nav', noNav.length === 0, noNav.join(', '));
  ok('every page carries the generated footer', noFoot.length === 0, noFoot.join(', '));
  ok('every page links the shared stylesheet', noCss.length === 0, noCss.join(', '));
}

console.log('\nevery destination is reachable from every page');
{
  // The set a reader must be able to get to from anywhere. The app links are
  // absolute and format-dependent, so they are asserted separately below.
  //
  // /bestball-insights and the /insights hub came OFF this list in the
  // auction-first pass (§27c). Best ball is retired from every surface and the
  // hub was a format chooser for a site that now has one format; the auction
  // edition is the destination. The pages still serve at their old URLs — see
  // the sitemap assertions in tools/test-seo.mjs — they are simply not linked.
  // /in-season replaced /post-draft as the section hub. Its three lanes are
  // asserted too: the dropdown carries them instead of the eleven tools it used
  // to list, so if a lane silently drops out of the nav there is no other place
  // a reader can reach it from every page.
  const MUST_NAV = ['/fantasy-football-auction-values', '/auction-insights',
    '/snake-insights', '/insights-vault', '/the-pick', '/guides',
    '/in-season', '/fantasy', '/dfs', '/wagers', '/my-league', '/faq'];
  const MUST_FOOT = ['/privacy', '/terms', '/support', '/creators',
    '/play-caller-premium', '/auction-insights', '/guides', '/the-pick'];
  const badNav = [], badFoot = [];
  for (const f of pages) {
    const nav = hrefs(header(read(f)));
    for (const m of MUST_NAV) if (!nav.includes(m)) badNav.push(`${f}: ${m}`);
  }
  for (const f of allPages) {
    const foot = hrefs(footer(read(f)));
    for (const m of MUST_FOOT) if (!foot.includes(m)) badFoot.push(`${f}: ${m}`);
  }
  ok('the nav reaches every section from every page', badNav.length === 0, badNav.slice(0, 6).join('; '));
  ok('the footer reaches privacy, terms and support from every page', badFoot.length === 0, badFoot.slice(0, 6).join('; '));
}

console.log('\nthe nav link set is identical everywhere');
{
  // The <nav> only. The CTA sits outside it in the header and legitimately
  // differs — by format, and by whether the page is in-season — so it is
  // asserted on its own below rather than folded in here and excused.
  const navOf = (h) => (h.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  const shape = (f) => hrefs(navOf(header(read(f)))).filter((h) => h.startsWith('/')).join(',');
  const shapes = new Map();
  for (const f of pages) {
    const s = shape(f);
    if (!shapes.has(s)) shapes.set(s, []);
    shapes.get(s).push(f);
  }
  const variants = [...shapes.values()];
  ok('there is exactly one nav shape', shapes.size === 1,
    shapes.size + ' variants, e.g. ' + variants.map((v) => v[0]).slice(0, 4).join(' / '));
}

console.log('\nthe call to action matches the page\'s format');
{
  // The in-season set, read out of the generator rather than copied, so the two
  // cannot drift: a page added there gets asserted here on the next run.
  const chrome = fs.readFileSync(path.join(ROOT, 'tools', 'build-chrome.mjs'), 'utf8');
  const IN_SEASON = new Set((chrome.match(/const IN_SEASON = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1]
    .split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  if (!IN_SEASON.size) throw new Error('could not read IN_SEASON out of build-chrome.mjs');

  const wrong = [];
  for (const f of pages) {
    const cta = (header(read(f)).match(/<a class="cta" href="([^"]*)"/) || [])[1] || '';
    // An IN-SEASON page sells the league save: a reader on the waiver board in
    // October is not there to build a draft sheet, and saving their scoring and
    // FAAB budget improves every number in front of them. Everywhere else the
    // CTA is the board that page belongs to. Snake keeps its own; best ball no
    // longer does, because that line is retired and its pages point at the
    // auction sheet like everything else.
    const want = IN_SEASON.has(f) ? '/in-season#league' : /^snake-/.test(f) ? 'snakedraft' : 'auctiondraft';
    if (!cta.includes(want)) wrong.push(`${f}: cta=${cta} want ${want}`);
    // No page may send the reader to the retired best-ball room.
    if (cta.includes('/bestball')) wrong.push(`${f}: cta=${cta} still sells best ball`);
  }
  ok('a format page points at its own board', wrong.length === 0, wrong.slice(0, 6).join('; '));
}

console.log('\nthe mobile nav is a real disclosure, not an unmarked scroll');
{
  const noBtn = pages.filter((f) => !/<button class="nav-toggle"/.test(read(f)));
  const noAria = pages.filter((f) => !/aria-expanded="false"[\s\S]{0,80}aria-controls="sitenav"|aria-controls="sitenav"/.test(read(f)));
  const noJs = pages.filter((f) => !read(f).includes('<!--chrome:navjs-->'));
  const noSkip = pages.filter((f) => !read(f).includes('class="skip-link"'));
  ok('every page has the disclosure button', noBtn.length === 0, noBtn.slice(0, 4).join(', '));
  ok('the button is wired to the nav for assistive tech', noAria.length === 0, noAria.slice(0, 4).join(', '));
  ok('every page ships the toggle handler', noJs.length === 0, noJs.slice(0, 4).join(', '));
  ok('every page has a skip link', noSkip.length === 0, noSkip.slice(0, 4).join(', '));
}

console.log('\nthe reading pages are excluded from the nav on purpose');
{
  // They are pages you read rather than use, and main's test-reading-view.mjs
  // owns their palette. What must still hold is that opting out of the NAV does
  // not opt them out of the SITE: the footer sitemap is how a reader gets
  // anywhere from them, so it has to be there.
  const missing = [...NAV_EXCLUDE].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  ok('every excluded page still exists', missing.length === 0, missing.join(', '));
  const noFoot = [...NAV_EXCLUDE].filter((f) => !read(f).includes('<!--chrome:foot-->'));
  const gotNav = [...NAV_EXCLUDE].filter((f) => read(f).includes('<!--chrome:nav-->'));
  ok('a reading page still carries the shared footer', noFoot.length === 0, noFoot.join(', '));
  ok('a reading page does not carry the eleven-item nav', gotNav.length === 0, gotNav.join(', '));
}

console.log('\nthe page you are on is marked');
{
  // Pages that ARE a nav destination should mark themselves current. Dated
  // family members mark their section (auction-insights-2026-08-20 -> Insights).
  // insights.html is off this list: it was the three-format chooser, and a site
  // with one format sends the reader to /auction-insights instead. The page
  // still serves and stays in the sitemap; it is simply not a nav destination.
  const named = pages.filter((f) => /^(guides|faq|the-pick|insights-vault)\.html$/.test(f));
  const missing = named.filter((f) => !read(f).includes('aria-current="page"'));
  ok('a nav destination marks itself as current', missing.length === 0, missing.join(', '));
}

console.log('\nthe chrome elements are actually closed');
{
  // auction-watch-2026-07-05.html shipped with no </header>, so the whole
  // article was nested inside a position:sticky, backdrop-blurred header 1740px
  // tall. Nothing caught it: the HTML still parsed, the page still rendered,
  // and the generator silently skipped the page because its regex needs a close
  // tag. An unbalanced count is cheap to assert and this is what it costs.
  const bad = [];
  for (const f of pages) {
    const src = read(f);
    for (const tag of ['header', 'nav', 'footer', 'main']) {
      const open = (src.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
      const close = (src.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      if (open !== close) bad.push(`${f}: ${open} <${tag}> vs ${close} </${tag}>`);
    }
  }
  ok('every header, nav, footer and main is closed', bad.length === 0, bad.slice(0, 6).join('; '));
}

console.log('\nthe disclaimer is on every page, in full');
{
  // Seven clauses, and all seven or none. This is the one block on the site
  // that exists for a reason other than being read: it says the numbers are for
  // social and entertainment purposes, that they are estimates of markets that
  // have already moved, that the reader should verify anything they act on, and
  // — because /wagers is one click from every footer — the gambling disclosure
  // and the helpline.
  //
  // It is asserted CLAUSE BY CLAUSE rather than as one string so that rewording
  // a sentence does not silently drop a clause out of the middle of it, which is
  // the only way this ever goes wrong.
  const CLAUSES = [
    'For social and entertainment purposes only',
    'Verify anything you intend to act on at its own source before relying on it',
    '21+',
    'informational and may differ at the venue',
    'not a sportsbook or exchange',
    'Availability varies by state',
    '1-800-GAMBLER',
  ];
  // allPages is every page carrying <header class="site">, which is every page
  // the chrome generator writes. THE THREE IT EXCLUDES ARE THE THREE THAT MATTER
  // MOST HERE and they are named explicitly:
  //
  //   front.html  is "/" — the page nearly every reader actually lands on. It
  //               keeps its own masthead and footer, so it fell outside this
  //               check and shipped without the disclaimer once already.
  //   index.html  is the app at /hub and the draft rooms; its footer is React.
  //
  // admin.html is deliberately not here: it is noindex, no visitor reaches it,
  // and it prints no projections.
  const mustCarry = [...allPages, 'index.html', 'front.html'];
  const missing = [];
  for (const f of mustCarry) {
    const text = read(f).replace(/<[^>]*>/g, ' ').replace(/&mdash;|&#8212;/g, '-');
    for (const c of CLAUSES) if (!text.includes(c)) missing.push(`${f}: "${c}"`);
  }
  ok('every page carries all seven clauses', missing.length === 0,
     missing.length + ' missing, e.g. ' + missing.slice(0, 4).join('; '));
  // Named on its own, because "every page" quietly meant "every page with the
  // shared header" the first time and the homepage slipped through it.
  ok('the homepage at / carries it', !missing.some((m) => m.startsWith('front.html:')));

  // And the two copies of it agree. index.html keeps its own because it is not
  // generated; if they drift, one set of readers is being told something else.
  const legal = (fs.readFileSync(path.join(ROOT, 'tools', 'build-chrome.mjs'), 'utf8')
    // \r?\n rather than \n: the working tree on Windows is CRLF, and a bare
    // newline anchor matches nothing against it — which would fail this check
    // for a reason that has nothing to do with the wording it guards.
    .match(/const LEGAL = '([\s\S]*?)';\r?\n/) || [, ''])[1];
  ok('build-chrome still owns the wording', legal.includes('social and entertainment'), legal.slice(0, 60));
}

console.log('\nthe visual zones are the ones the site says it has');
{
  // Three zones, deliberately: the content pages and the app are dark, the three
  // reading pages are white (main's tools/test-reading-view.mjs owns those), and
  // front.html is light. This asserts only the boundary this suite is
  // responsible for — that the CONTENT pages stay dark, so a page cannot drift
  // into a fourth zone unnoticed.
  const lum = (h) => {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  // The content pages take their palette from site.css, so there is one value to
  // check rather than ninety-one. It is LIGHT as of the auction-first pass — the
  // site reads as one white surface and the only dark zones left are the draft
  // app and the front page's masthead band.
  const shared = read('site.css');
  const bg = (shared.match(/--bg:\s*(#[0-9a-fA-F]{3,6})/) || [])[1] || '';
  ok(`site.css --bg is a light surface (${bg})`, Boolean(bg) && lum(bg) > 0.8, bg || 'token missing');
  // #2dd4a3 is about 1.9:1 on white, so the shared accent has to be the darker
  // green or every link on the site fails contrast.
  const teal = (shared.match(/--teal:\s*(#[0-9a-fA-F]{3,6})/) || [])[1] || '';
  ok(`site.css uses the white-safe accent (${teal})`, teal.toLowerCase() === '#0e7c63', teal || 'token missing');
  // And no content page may redefine the palette back to dark, which is how the
  // inline-:root drift started in the first place.
  const dark = pages.filter((f) => {
    const m = read(f).match(/:root\{[^}]*--bg:\s*(#[0-9a-fA-F]{3,6})/);
    return m && lum(m[1]) < 0.8;
  });
  ok('no content page overrides the palette back to dark', dark.length === 0, dark.slice(0, 4).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
