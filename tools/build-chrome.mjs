#!/usr/bin/env node
// Keeps the site's CHROME — the header nav and the footer — identical on every
// content page, and links the shared stylesheet that styles it.
//
// Why this exists: the nav had drifted into 10 different link sets across 95
// pages and the footer into 13. From the-pick.html you could not reach Insights,
// FAQ, Insight Vault, Play-Caller Premium or Analyst Desk at all, and no page
// linked Privacy and Terms together. Each page was also inlining its own copy of
// the same chrome CSS, so the two diverged a little more with every edit.
//
//   node tools/build-chrome.mjs           writes the files
//   node tools/build-chrome.mjs --check   writes nothing, exits 1 if anything is stale
//
// EVERY EDIT IS IDEMPOTENT — running it twice changes nothing. Run it after
// adding any page, alongside `node tools/build-seo.mjs` and
// `node tools/build-front.mjs`.
//
// The generated markup lives between <!--chrome:nav--> / <!--chrome:foot-->
// sentinels, so this tool finds and replaces only its own output and never
// touches the page body.
//
// SCOPE — three pages are deliberately excluded and keep hand-written chrome:
//   index.html   the React app; its header is rendered by React, not HTML
//   front.html   the news front page; its three-row masthead is its own design.
//                Its ribbon and footer carry the same link set (see LINKS below)
//                so every destination stays reachable from it.
//   admin.html   internal; its header holds admin tools, not the marketing nav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { putWordmark } from './wordmark.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const EXCLUDE = new Set(['index.html', 'front.html', 'admin.html']);

// The READING pages. tools/test-reading-view.mjs states the rule they exist
// under: the app, the front page and the guides are one zone; the standing
// play-caller column and the article page every generated story lands on are a
// white reading zone. They keep that palette, which is why they are excluded
// from the CSS strip below — an inline :root is deliberate on these three and
// drift everywhere else.
//
// THEY NO LONGER KEEP THEIR OWN NAV. Each carried a hand-written four-link row
// (Auction Values / Strategy / Insights / Columns) plus a draft CTA: a second
// navigation system reaching the same destinations under different names, which
// is exactly what this pass set out to remove. The shared nav is five links now,
// not eleven, so the reason for the exception is gone with it.
const STYLE_EXCLUDE = new Set(['lead.html', 'play-caller-premium.html', 'the-tell.html']);

// ── the canonical link set ───────────────────────────────────────────────────
// One place to change what the site links to.
//
// TWO PRODUCT LANES, AND NOTHING ELSE COMPETING WITH THEM. Fantasy and DFS are
// what Iron Tuna sells. Articles explain and support those two lanes. The
// betting market is the intelligence layer underneath both, not a third lane,
// so "Market Intel" is no longer a top-level item: /vegas-edge, /game-intel,
// /player-intel and /what-they-arent-telling-you still serve at the URLs they
// were indexed under and are reached from the pages that use them.
//
// NOTHING WAS DELETED TO DO THIS. Every page the old eleven-item nav reached is
// still deployed at its own URL and still in sitemap.xml. Navigation removal is
// not page removal; see the retained-routes list in the phase report.
//
// WHAT CAME OFF, AND WHY:
//   Draft, In Season, The Desk, Market Intel   group headings for lanes the site
//                                              no longer leads with
//   The Pick, The Tell, Play-Caller Premium,   individual article columns; they
//   Auction insights, Snake insights,          live under Articles now
//   Insight Vault
//   Auction values, Superflex & 2QB, Salary    draft tools and auction
//   cap & keepers, Strategy guides, Auction    promotions. The season is under
//   Manager, Snake board, Free cheat sheet     way; these belong back in the nav
//                                              in the offseason, not in week 2.
//   Rankings, Depth Charts, Weekly Intel,      individual tools
//   Waivers & FAAB, Trade Finder, My Week
const NAV = [
  { label: 'Fantasy', href: '/fantasy' },
  { label: 'DFS', href: '/dfs' },
  // The desk is the articles hub: the week's written coverage and the standing
  // columns under one heading rather than six of their own.
  { label: 'Articles', href: '/in-season/desk' },
  // There is no /how-it-works page in the repo, and this phase adds no pages.
  // The FAQ's "Getting started" group is the site's existing answer to the
  // question, so the label points there rather than at a new URL.
  { label: 'How It Works', href: '/faq#faq-start' },
  // /player is the site's search page: a real <form role="search"> posting ?q=
  // with the shared typeahead behind it. Same destination the app's header
  // lookup resolves to.
  { label: 'Search', href: '/player' },
];

// The one header button, on every page.
//
// IT IS NOT "My League". Automatic league sync does not work reliably today:
// FLAG_SLEEPER_SYNC is off pending a written license, FLAG_YAHOO_SYNC is off and
// has never run against a live Yahoo account, ESPN is not implemented at all,
// and CBS is enabled but has never been exercised against a live CBS league
// (docs/league-sync.md §3.1, rows 6-9 and 22). What DOES work for every reader
// is the browser-only settings form in section 02 of /my-league — scoring, teams
// and FAAB budget, saved locally, read by every board in the section. So the
// entry says what it actually does and lands on that form.
const CTA = { label: 'Customize My League', href: '/my-league#settings', cta: true };

// The footer is the nav plus the pages that belong to no lane: the data
// inventory, the FAQ, the two legal documents and support. Nine links, one row.
// Everything else that used to be here — the rankings shelf, the market column,
// the reading column, the draft-tools column, the creator page and the "Build
// your free sheet" promotion — is off the footer for the same reasons it is off
// the nav. "Data Sources" is the public inventory of every external feed and the
// license it is used under (data.html); an acquirer, a licensing partner and a
// curious reader all want the same page.
const FOOT_LINKS = [
  { label: 'Fantasy', href: '/fantasy' },
  { label: 'DFS', href: '/dfs' },
  { label: 'Articles', href: '/in-season/desk' },
  { label: 'How It Works', href: '/faq#faq-start' },
  { label: 'Data Sources', href: '/data' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Support', href: '/support' },
];

const BLURB = 'Iron Tuna prices every player against the betting market first and the consensus projections second, then restates the numbers at your league’s scoring. Projections are not guarantees.';

// The site-wide disclaimer, on EVERY page rather than only the pages that print
// odds. Two things it has to say, in this order:
//
//   1. This is for social and entertainment purposes, and every number on it
//      is an estimate or a snapshot of a market that has moved since. That is
//      true of a weekly ranking and a FAAB price as much as of an odds board.
//   2. The gambling disclosure. Retiring the wagers lane did not retire the
//      odds: Vegas Edge, Game Intel and the weekly intel page all still print
//      lines and totals, and a helpline is worth nothing if it only appears
//      once the reader is already on one of them.
//
// The wording is fixed: entertainment-only, verify-before-relying, 21+,
// informational, not-a-sportsbook, state availability, 1-800-MY-RESET.
// tools/test-chrome.mjs asserts all seven clauses on every page. Do not
// shorten it.
const LEGAL = '<b>For social and entertainment purposes only.</b> Every number on this site \u2014 projections, odds, salaries and contract prices alike \u2014 is an estimate or a snapshot of a market that moves, and none of it is advice. Verify anything you intend to act on at its own source before relying on it. <b>21+.</b> Odds and contract prices are informational and may differ at the venue. Iron Tuna is not a sportsbook or exchange, places no bets and holds no funds. Availability varies by state. If you or someone you know has a gambling problem, call or text <b>1-800-MY-RESET</b>.';

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A nav link is "current" when the page being built is the page it points to.
// Dated family members count as their index (auction-insights-2026-08-20.html
// is on /auction-insights), so the nav marks the section you are reading.
// The fragment is dropped first: /faq#faq-start and /my-league#settings are the
// faq and my-league pages, and a link that lands on a page should say so.
function isCurrent(href, file) {
  if (!href.startsWith('/')) return false;
  const slug = href.slice(1).split('#')[0].replace(/\/+$/, '');
  if (!slug) return false;
  const base = file.replace(/\.html$/, '');
  return base === slug || base.replace(/-2026-\d{2}-\d{2}$/, '') === slug;
}

function navHtml(file) {
  const link = (l) => {
    const cur = isCurrent(l.href, file) ? ' aria-current="page"' : '';
    const cls = l.cta ? ' class="cta"' : '';
    return `<a${cls} href="${l.href}"${cur}>${esc(l.label)}</a>`;
  };
  const items = NAV.map((l) => '      ' + link(l)).join('\n');
  return [
    '    <nav class="nav" id="sitenav" aria-label="Main">',
    items,
    '    </nav>',
    '    ' + link(CTA),
    '    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sitenav">',
    '      <span class="nav-toggle-bars"><span></span></span>Menu',
    '    </button>',
  ].join('\n');
}

function footHtml() {
  const lis = FOOT_LINKS
    .map((l) => `    <li><a href="${l.href}">${esc(l.label)}</a></li>`)
    .join('\n');
  return [
    '  <nav class="foot-nav" aria-label="Footer">',
    '   <ul>',
    lis,
    '   </ul>',
    '  </nav>',
    '  <div class="foot-note">',
    `   <p>${BLURB}</p>`,
    `   <p class="foot-21">${LEGAL}</p>`,
    '   <p class="foot-legal"><span>Iron Tuna&trade; &middot; &copy; 2026 Iron Tuna &middot; Game lines &amp; player data via nflverse (CC BY 4.0)</span></p>',
    '  </div>',
  ].join('\n');
}

// ── the edits ────────────────────────────────────────────────────────────────
// Each returns the next html. All are idempotent: the sentinels make the
// generated region findable, so a second run replaces it with the same bytes.
const NAV_OPEN = '<!--chrome:nav-->', NAV_CLOSE = '<!--/chrome:nav-->';
const FOOT_OPEN = '<!--chrome:foot-->', FOOT_CLOSE = '<!--/chrome:foot-->';

function putNav(html, file) {
  const block = `${NAV_OPEN}\n${navHtml(file)}\n    ${NAV_CLOSE}`;
  if (html.includes(NAV_OPEN)) {
    return html.replace(
      new RegExp(NAV_OPEN + '[\\s\\S]*?' + NAV_CLOSE.replace(/\//g, '\\/')),
      () => block,
    );
  }
  // First run on this page: swallow whatever nav markup is there now.
  const m = html.match(/<header class="site">[\s\S]*?<\/header>/);
  if (!m) return html;
  const next = m[0].replace(/<nav class="nav"[\s\S]*?<\/nav>/, () => block);
  if (next === m[0]) return html;
  return html.replace(m[0], () => next);
}

function putFoot(html) {
  const block = `${FOOT_OPEN}\n${footHtml()}\n  ${FOOT_CLOSE}`;
  if (html.includes(FOOT_OPEN)) {
    return html.replace(
      new RegExp(FOOT_OPEN + '[\\s\\S]*?' + FOOT_CLOSE.replace(/\//g, '\\/')),
      () => block,
    );
  }
  // The three legal pages carry a bare <footer> rather than <footer class="site">,
  // and they are exactly the pages where the Privacy/Terms links matter, so match
  // either shape and normalize both onto the canonical one.
  const m = html.match(/<footer(?: class="site")?>[\s\S]*?<\/footer>/);
  if (!m) return html;
  return html.replace(m[0], () => `<footer class="site"><div class="wrap">\n  ${block}\n</div></footer>`);
}

// Link the shared stylesheet, immediately before the page's own <style> so the
// page keeps the last word on anything it still declares itself.
const CSS_LINK = '<link rel="stylesheet" href="/site.css">';
const GSTATIC = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
function putCss(html) {
  let next = html;
  if (!next.includes(CSS_LINK)) {
    const i = next.indexOf('<style>');
    if (i === -1) return html;
    next = next.slice(0, i) + CSS_LINK + '\n' + next.slice(i);
  }
  // fonts.gstatic.com is where the font FILES come from; preconnecting only to
  // fonts.googleapis.com warms the wrong handshake. Owned here so a new page
  // cannot ship without it.
  if (!next.includes('fonts.gstatic.com')) {
    next = next.replace('<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.googleapis.com">' + GSTATIC);
  }
  return next;
}

// Remove the rules site.css now owns from the page's inline <style>. Anything
// missed stays harmless — site.css is linked first, so a leftover inline copy
// just re-states the same value — but leaving them in is how the drift started.
const OWNED = [
  // The dark root, and the light one that replaced it in the auction-first pass.
  // Both spellings are matched because the repo has carried each in turn, and a
  // page that kept an inline :root would silently override site.css — the link
  // sits BEFORE the page's own <style>, so the inline copy wins. That is fine as
  // a deliberate override (front.html does it) and a bug everywhere else.
  /:root\{--bg:#0b1117[^}]*\}\n?/g,
  /:root\{--bg:#ffffff[^}]*\}\n?/g,
  /\*\{box-sizing:border-box\}\n?/g,
  /html\{scroll-behavior:smooth\}\n?/g,
  [/body\{margin:0;background:radial-gradient\(1200px 600px at 50% -10%[^}]*\}\n?/g, ''],
  [/body\{margin:0;overflow-x:hidden;background:radial-gradient\(1200px 600px at 50% -10%[^}]*\}\n?/g,
   'body{overflow-x:hidden}\n'],
  [/body\{margin:0;background:radial-gradient\(1200px 600px at 50% -10%,rgba\(14, ?124, ?99[^}]*\}\n?/g, ''],
  [/body\{margin:0;overflow-x:hidden;background:radial-gradient\(1200px 600px at 50% -10%,rgba\(14, ?124, ?99[^}]*\}\n?/g,
   'body{overflow-x:hidden}\n'],
  /a\{color:var\(--teal\);text-decoration:none\}\n?/g,
  /a:hover\{text-decoration:underline\}\n?/g,
  /\.wrap\{max-width:820px;margin:0 auto;padding:0 20px\}\n?/g,
  /header\.site\{[^}]*\}\n?/g,
  /header\.site \.wrap\{[^}]*\}\n?/g,
  /header\.site \.brand-logo\{[^}]*\}\n?/g,
  /header\.site \.nav\{[^}]*\}\n?/g,
  /header\.site \.nav a\{[^}]*\}\n?/g,
  /\.brand\{[^}]*\}\n?/g,
  /\.brand b\{[^}]*\}\n?/g,
  /\.brand-logo\{[^}]*\}\n?/g,
  /\.nav a\{[^}]*\}\n?/g,
  /\.nav a\.cta\{[^}]*\}\n?/g,
  /\.nav-dd\{[^}]*\}\n?/g,
  /\.nav-dd \.nav-dd-menu\{[^}]*\}\n?/g,
  /\.nav-dd \.nav-dd-menu::before\{[^}]*\}\n?/g,
  /\.nav-dd:hover \.nav-dd-menu,\.nav-dd:focus-within \.nav-dd-menu\{[^}]*\}\n?/g,
  /\.nav-dd \.nav-dd-menu a\{[^}]*\}\n?/g,
  /\.nav-dd \.nav-dd-menu a:hover\{[^}]*\}\n?/g,
  /footer\.site\{[^}]*\}\n?/g,
  /footer\.site a\{[^}]*\}\n?/g,
  // superseded by site.css: the focus ring and the dropdown clamp added earlier
  /\n?\/\* Visible keyboard focus \(WCAG 2\.4\.7\)[\s\S]*?\[tabindex\]:focus-visible\{[^}]*\}\n?/g,
  /\n?\/\* The dropdown is centered on its trigger[\s\S]*?@media \(max-width:560px\)\{\.nav-dd \.nav-dd-menu\{[^}]*\}\}\n?/g,
];
// The three reading pages keep their own inline <style> (STYLE_EXCLUDE above),
// because the white :root in it is what makes them a reading surface. What they
// must NOT keep is the header block that stylesheet also carries: it was written
// for a CTA that lived INSIDE <nav>, and the generated header puts the CTA
// beside the nav instead. Left in place, `header.site .nav{display:flex}` beats
// site.css's mobile rule and the disclosure button opens nothing on a phone,
// and `:has(> a.cta) > a:nth-last-child(2){display:none}` hides a real nav link
// on the one surface a reader spends longest on.
//
// Only those rules go. The palette, the type scale and everything below the
// header are untouched. Each pattern is written so a second run finds nothing.
const READING_OWNED = [
  /\/\* Mobile masthead\.[\s\S]*?@media\(max-width:640px\)\{header\.site \.wrap\{[\s\S]*?nth-last-child\(2\)\{display:none\}\}\n?/g,
  /\.nav a\{font-size:13px;margin-left:16px\}\n?/g,
  /\.nav a\.cta\{color:#1a1205;[^}]*\}\n?/g,
  [/(@media\(max-width:640px\)\{\.grid\{grid-template-columns:1fr\})\.nav a\{margin-left:10px\}\}/g, '$1}'],
  /\.brand\{display:inline-flex;align-items:center\}\.brand-logo\{height:30px;width:auto;display:block\}\n?/g,
];

function stripOwned(html, rules = OWNED) {
  const i = html.indexOf('<style>'), j = html.indexOf('</style>');
  if (i === -1 || j === -1) return html;
  let css = html.slice(i + 7, j);
  // An entry is either a regex to delete outright, or a [regex, replacement]
  // pair where part of the rule has to survive (overflow-x:hidden below).
  for (const entry of rules) {
    const [re, replacement] = Array.isArray(entry) ? entry : [entry, ''];
    css = css.replace(re, replacement);
  }
  return html.slice(0, i + 7) + css + html.slice(j);
}

// The disclosure button needs a handler. One small inline script per page keeps
// these files self-contained, which is the whole architecture here.
const NAV_JS_OPEN = '<!--chrome:navjs-->', NAV_JS_CLOSE = '<!--/chrome:navjs-->';
const NAV_JS = `${NAV_JS_OPEN}<script>
(function(){
  var h=document.querySelector('header.site'), b=h&&h.querySelector('.nav-toggle');
  if(!h||!b) return;
  function set(open){
    h.setAttribute('data-nav-open', open?'1':'0');
    b.setAttribute('aria-expanded', open?'true':'false');
  }
  b.addEventListener('click',function(){ set(h.getAttribute('data-nav-open')!=='1') });
  /* Escape closes it, and focus goes back to the button that opened it. */
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&h.getAttribute('data-nav-open')==='1'){ set(false); b.focus() }
  });
  /* A tap outside the open menu closes it. */
  document.addEventListener('click',function(e){
    if(h.getAttribute('data-nav-open')==='1'&&!h.contains(e.target)) set(false);
  });
})();
</script>${NAV_JS_CLOSE}`;
function putNavJs(html) {
  if (html.includes(NAV_JS_OPEN)) {
    return html.replace(
      new RegExp(NAV_JS_OPEN + '[\\s\\S]*?' + NAV_JS_CLOSE.replace(/\//g, '\\/')),
      () => NAV_JS,
    );
  }
  const i = html.lastIndexOf('</body>');
  if (i === -1) return html;
  return html.slice(0, i) + NAV_JS + '\n' + html.slice(i);
}

// A skip link, so a keyboard user does not tab the whole nav on every page.
// It needs something to skip TO, and no page had an id on its <main>, so the
// target is added here as well — a skip link pointing at nothing is worse than
// no skip link, because it reads as working to an audit and does nothing.
// The wordmark lives in the header SVG, which makes it chrome. It is rewritten
// here because the pages the daily camp Routine authors are copied from older
// pages that still say tuna.png — a file that no longer exists — so every new
// page would otherwise ship with a broken-image glyph where the logo goes until
// someone noticed. Cheaper to heal on every run than to chase.
// The same pass swaps the mark's eight <text> letters for the outlined paths
// (tools/wordmark.mjs): a page copied from before September 16 still sets the
// name in the Bebas Neue web font, which the reader sees in Impact or the system
// sans until the font arrives, and never sees in Bebas if it does not.
function putLogo(html) {
  return putWordmark(html.replace(/\/tuna\.png/g, '/tuna.webp'));
}

function putSkip(html) {
  let next = html;
  if (!next.includes('class="skip-link"')) {
    const m = next.match(/<header class="site">/);
    if (!m) return html;
    next = next.replace(m[0], '<a class="skip-link" href="#main">Skip to content</a>\n' + m[0]);
  }
  if (!/<main[^>]*\bid="main"/.test(next)) {
    next = next.replace(/<main(?![^>]*\bid=)/, '<main id="main"');
  }
  return next;
}

// ── run ──────────────────────────────────────────────────────────────────────
const changed = [];
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !EXCLUDE.has(f)).sort();

for (const f of pages) {
  const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!before.includes('<header class="site">')) continue;
  let next = before;
  next = putCss(next);
  next = putLogo(next);
  next = putSkip(next);
  // EVERY page takes the generated nav now, the three reading pages included.
  // What they still keep is their own palette: stripOwned would delete the
  // inline :root that makes them white, which test-reading-view.mjs requires
  // them to carry.
  next = putNav(next, f);
  next = stripOwned(next, STYLE_EXCLUDE.has(f) ? READING_OWNED : OWNED);
  next = putNavJs(next);
  next = putFoot(next);
  if (next !== before) {
    changed.push(f);
    if (!CHECK) fs.writeFileSync(path.join(ROOT, f), next);
  }
}

if (CHECK) {
  if (changed.length) {
    console.error('Chrome is stale on ' + changed.length + ' page(s). Run: node tools/build-chrome.mjs');
    changed.slice(0, 12).forEach((f) => console.error('  ' + f));
    process.exit(1);
  }
  console.log('chrome up to date on ' + pages.length + ' pages');
} else {
  console.log(changed.length ? 'rewrote chrome on ' + changed.length + ' page(s)' : 'chrome already up to date');
}
