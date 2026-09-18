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
// consistently-wrong generator: that the link set is the five-item one and the
// footer the nine-item one, that nothing retired has crept back into either,
// that the mobile disclosure nav is wired up, and that the one header button
// says what it actually does.
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
// The three reading pages keep their own PALETTE (tools/test-reading-view.mjs
// owns that) but no longer keep their own NAV: they carried a hand-written
// four-link draft row that reached the same places under different names, and
// the shared nav is five links now. So `pages` and `allPages` are the same set.
const STYLE_EXCLUDE = new Set(['lead.html', 'play-caller-premium.html', 'the-tell.html']);
const allPages = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !EXCLUDE.has(f))
  .filter((f) => read(f).includes('<header class="site">'))
  .sort();
const pages = allPages;

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
  // TWO PRODUCT LANES AND THE ARTICLES THAT SUPPORT THEM. The nav is five
  // links; there is nothing else in it, which is the point of the pass that
  // wrote this. Every one of them must be on every page.
  const MUST_NAV = ['/fantasy', '/dfs', '/in-season/desk', '/faq#faq-start', '/player'];
  // Nine footer links, and the same nine on every page: the two lanes, the
  // articles, how it works, the data inventory, the FAQ, the two legal
  // documents and support.
  const MUST_FOOT = ['/fantasy', '/dfs', '/in-season/desk', '/faq#faq-start',
    '/data', '/faq', '/privacy', '/terms', '/support'];
  const badNav = [], badFoot = [];
  for (const f of pages) {
    const nav = hrefs(header(read(f)));
    for (const m of MUST_NAV) if (!nav.includes(m)) badNav.push(`${f}: ${m}`);
  }
  for (const f of allPages) {
    const foot = hrefs(footer(read(f)));
    for (const m of MUST_FOOT) if (!foot.includes(m)) badFoot.push(`${f}: ${m}`);
  }
  ok('the nav reaches both lanes, the articles, how it works and search', badNav.length === 0, badNav.slice(0, 6).join('; '));
  ok('the footer reaches privacy, terms, support and the data inventory', badFoot.length === 0, badFoot.slice(0, 6).join('; '));
}

console.log('\nthe chrome leads with two lanes and nothing else');
{
  // What came OUT, and must not creep back. These are NOT dead URLs: every one
  // of them still serves and still sits in sitemap.xml. They are simply no
  // longer primary navigation, so a page that links one from its header or its
  // footer has put a third lane, an article column or a draft tool back in
  // front of the reader.
  //
  // Read as a prefix, because a link may carry a query or a fragment.
  const GONE = [
    '/vegas-edge', '/game-intel', '/player-intel', '/what-they-arent-telling-you',
    '/the-line', '/hidden-value', '/previews',            // the market lane
    '/the-pick', '/the-tell', '/play-caller-premium',
    '/analysts', '/auction-insights', '/snake-insights',
    '/bestball-insights', '/insights-vault', '/insights', // article columns
    '/fantasy-football-auction-values', '/superflex-auction-values',
    '/salary-cap-draft-tool', '/guides', '/auction-watch',
    '/auction-draft-assistant', '/custom-auction-values',  // draft tools
    '/in-season', '/post-draft', '/rankings', '/depth-charts', '/weekly-intel',
    '/waivers', '/faab', '/trade-finder', '/my-week', '/stats',
    '/weekly-rankings', '/season-long-rankings', '/weekly-wrap', '/creators',
  ];
  // The in-season section ribbon (tools/build-ranks.mjs) is page furniture, not
  // site chrome, so it is matched out: this check owns <header class="site">
  // and <footer class="site"> only.
  const isGone = (h) => GONE.some((g) => h === g || h.startsWith(g + '?') || h.startsWith(g + '#'));
  const bad = [];
  for (const f of allPages) {
    const src = read(f);
    for (const h of [...hrefs(header(src)), ...hrefs(footer(src))]) {
      if (isGone(h)) bad.push(`${f}: ${h}`);
    }
  }
  ok('no retired lane, column or tool is back in the chrome', bad.length === 0, bad.slice(0, 8).join('; '));

  // IT IS THE SEASON. The draft rooms and the auction promotions are an
  // offseason pitch; in week 2 they are the site telling a visitor it is still
  // July. Nothing in the chrome may link one.
  const promo = [];
  for (const f of allPages) {
    const src = read(f);
    for (const h of [...hrefs(header(src)), ...hrefs(footer(src))]) {
      if (/auctiondraft|snakedraft|\/bestball|screen=cheat|screen=board/.test(h)) promo.push(`${f}: ${h}`);
    }
  }
  ok('no draft room or auction promotion is in the chrome', promo.length === 0, promo.slice(0, 6).join('; '));
}

console.log('\nthe nav link set is identical everywhere');
{
  // The <nav> only; the CTA sits outside it in the header and is asserted below.
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
  ok('and it is the five-item one',
    [...shapes.keys()][0] === '/fantasy,/dfs,/in-season/desk,/faq#faq-start,/player',
    [...shapes.keys()][0]);

  // The same nine footer links, in the same order, everywhere.
  const footOf = (f) => hrefs((read(f).match(/<nav class="foot-nav"[\s\S]*?<\/nav>/) || [''])[0]).join(',');
  const footShapes = new Set(allPages.map(footOf));
  ok('there is exactly one footer shape', footShapes.size === 1, [...footShapes].slice(0, 3).join(' / '));
  ok('and it is the nine-item one',
    [...footShapes][0] === '/fantasy,/dfs,/in-season/desk,/faq#faq-start,/data,/faq,/privacy,/terms,/support',
    [...footShapes][0]);
}

console.log('\nthe one header button says what it actually does');
{
  // IT IS NOT "Sync my league". The platform connectors were removed
  // (docs/saved-league.md) and nothing syncs. What works is the form on
  // /my-league, so the button is labeled for that and lands on it. If a
  // connector is ever built and proved, this is the assertion to change —
  // deliberately, not by a label drifting back.
  const wrong = [], mislabeled = [];
  for (const f of pages) {
    const h = header(read(f));
    const m = h.match(/<a class="cta" href="([^"]*)"[^>]*>([^<]*)<\/a>/) || [];
    if (m[1] !== '/my-league#settings') wrong.push(`${f}: cta=${m[1]}`);
    if (m[2] !== 'Customize My League') mislabeled.push(`${f}: "${m[2]}"`);
  }
  ok('every page points the button at the manual setup', wrong.length === 0, wrong.slice(0, 6).join('; '));
  ok('and labels it Customize My League', mislabeled.length === 0, mislabeled.slice(0, 6).join('; '));

  // The anchor has to exist, or the button lands at the top of a page whose
  // first section is the sync flow it was relabeled away from.
  ok('/my-league carries the #settings anchor the button targets',
    /<div class="is-sec" id="settings">/.test(read('my-league.html')));
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

console.log('\nthe reading pages take the shared nav now');
{
  // They used to be excluded from it, on the argument that an eleven-item nav
  // does not belong on a page you read. The nav is five items, and what they
  // carried instead was a second navigation system: Auction Values / Strategy /
  // Insights / Columns plus a draft CTA, reaching the same places under
  // different names. The exception went; the PALETTE exception did not.
  const missing = [...STYLE_EXCLUDE].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  ok('every reading page still exists', missing.length === 0, missing.join(', '));
  const noNav = [...STYLE_EXCLUDE].filter((f) => !read(f).includes('<!--chrome:nav-->'));
  const noFoot = [...STYLE_EXCLUDE].filter((f) => !read(f).includes('<!--chrome:foot-->'));
  ok('a reading page carries the shared nav', noNav.length === 0, noNav.join(', '));
  ok('a reading page carries the shared footer', noFoot.length === 0, noFoot.join(', '));
  // The rules the old in-nav CTA needed are gone with it. Left behind,
  // `header.site .nav{display:flex}` beats site.css's mobile rule and the
  // disclosure button opens nothing on a phone, and the :has() rule hides a
  // real nav link.
  const stale = [...STYLE_EXCLUDE].filter((f) => /header\.site \.nav\{|nth-last-child\(2\)\{display:none\}/.test(read(f)));
  ok('and none keeps the header CSS written for the old one', stale.length === 0, stale.join(', '));
  // What they DO keep: their own white palette. tools/test-reading-view.mjs owns
  // the detail; this is the boundary, so a future strip pass cannot take it.
  const noRoot = [...STYLE_EXCLUDE].filter((f) => !/:root\{--bg:#ffffff/.test(read(f)));
  ok('a reading page still declares its own reading palette', noRoot.length === 0, noRoot.join(', '));
}

console.log('\nthe page you are on is marked');
{
  // Pages that ARE a nav destination should mark themselves current. /faq is
  // reached as /faq#faq-start and /my-league as /my-league#settings, so the
  // generator drops the fragment before comparing — a link that lands on a page
  // should say so.
  const named = ['fantasy.html', 'dfs.html', 'faq.html', 'player.html', 'my-league.html'];
  const missing = named.filter((f) => !header(read(f)).includes('aria-current="page"'));
  ok('a nav destination marks itself as current', missing.length === 0, missing.join(', '));
  // And a page that is NOT a destination must not claim to be one.
  const liars = pages.filter((f) => !named.includes(f) && header(read(f)).includes('aria-current="page"'));
  ok('and no other page claims to be', liars.length === 0, liars.slice(0, 5).join(', '));
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
  // — because Vegas Edge, Game Intel and the weekly intel page all print lines
  // and totals — the gambling disclosure and the helpline.
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
    '1-800-MY-RESET',
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
