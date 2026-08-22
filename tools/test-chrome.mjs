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
const NAV_EXCLUDE = new Set(['lead.html', 'analyst-desk.html', 'play-caller-premium.html']);
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
  const MUST_NAV = ['/insights', '/auction-insights', '/snake-insights',
    '/bestball-insights', '/insights-vault', '/the-pick', '/guides',
    '/analyst-desk', '/faq'];
  const MUST_FOOT = ['/privacy', '/terms', '/support', '/creators',
    '/play-caller-premium', '/insights', '/guides', '/the-pick'];
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
  // Everything but the app links, which legitimately differ by format.
  const shape = (f) => hrefs(header(read(f))).filter((h) => h.startsWith('/')).join(',');
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
  const wrong = [];
  for (const f of pages) {
    const cta = (header(read(f)).match(/<a class="cta" href="([^"]*)"/) || [])[1] || '';
    const want = /^(bestball-|best-ball-)/.test(f) ? 'bestball'
      : /^snake-/.test(f) ? 'snakedraft' : null;
    if (want && !cta.includes(want)) wrong.push(`${f}: cta=${cta} want ${want}`);
    // An auction page must not send the reader to another format's board.
    if (!want && (cta.includes('bestball') || cta.includes('snakedraft'))) wrong.push(`${f}: cta=${cta}`);
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
  const named = pages.filter((f) => /^(insights|guides|faq|the-pick|analyst-desk|insights-vault)\.html$/.test(f));
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
  // check rather than ninety-one.
  const shared = read('site.css');
  const bg = (shared.match(/--bg:\s*(#[0-9a-fA-F]{3,6})/) || [])[1] || '';
  ok(`site.css --bg is a dark surface (${bg})`, Boolean(bg) && lum(bg) < 0.2, bg || 'token missing');
  // And no content page may redefine it back to something light.
  const light = pages.filter((f) => {
    const m = read(f).match(/:root\{[^}]*--bg:\s*(#[0-9a-fA-F]{3,6})/);
    return m && lum(m[1]) > 0.2;
  });
  ok('no content page overrides the palette back to light', light.length === 0, light.slice(0, 4).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
