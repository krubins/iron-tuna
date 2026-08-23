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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const EXCLUDE = new Set(['index.html', 'front.html', 'admin.html']);

// The three READING pages. tools/test-reading-view.mjs states the rule they
// exist under: the app, the front page and the guides are one zone; the
// standing analyst column, the standing play-caller column and the article page
// every generated story lands on are a white reading zone. They are pages you
// read rather than use, and an eleven-item nav belongs on neither. They keep
// their own short header and take the shared footer, so every destination is
// still one scroll away.
const NAV_EXCLUDE = new Set(['lead.html', 'analyst-desk.html', 'play-caller-premium.html']);

// ── the canonical link set ───────────────────────────────────────────────────
// One place to change what the site links to. `app` is filled in per page so a
// best-ball guide sends you to the best-ball board, not the auction one.
const APP = 'https://irontuna.com/';
// Where a page's call to action sends the reader. Auction is the default and the
// point of the site; a snake page keeps its own board, because snake is still a
// supported format and handing a snake reader an auction sheet is no use to them.
//
// A best-ball page deliberately resolves to the AUCTION sheet rather than the
// best-ball room: that line is retired (§27c), so there is no reason to keep
// funnelling readers into it. The pages still serve, and their one button now
// points at the thing the site actually sells.
const APP_BY_FORMAT = {
  auction: APP + 'auctiondraft?screen=cheat',
  snake: APP + 'snakedraft',
  bestball: APP + 'auctiondraft?screen=cheat',
};

// Auction first, and best ball is off every surface (§27c). The bestball-*
// pages still SERVE at the URLs they were indexed at and stay in sitemap.xml —
// they are simply no longer linked from anywhere, which is how a content line is
// retired without breaking a URL or throwing away its ranking. Do not put them
// back here without also putting them back in the sitemap and the front page.
const NAV = [
  { label: 'Auction Values', href: '/fantasy-football-auction-values' },
  { label: 'Strategy', href: '/guides' },
  {
    label: 'Insights', href: '/auction-insights', children: [
      { label: 'Auction', href: '/auction-insights' },
      { label: 'Snake', href: '/snake-insights' },
      { label: 'Insight Vault', href: '/insights-vault' },
    ],
  },
  { label: 'The Pick', href: '/the-pick' },
  { label: 'Columns', href: '/analyst-desk' },
  { label: 'In-Season', href: '/post-draft' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Free cheat sheet', href: '{app}', cta: true },
];

const FOOT_COLS = [
  {
    h: 'Draft', links: [
      { label: 'Auction values', href: '/fantasy-football-auction-values' },
      { label: 'Auction Manager', href: APP + 'auctiondraft?screen=board' },
      { label: 'Superflex & 2QB', href: '/superflex-auction-values' },
      { label: 'Salary cap & keepers', href: '/salary-cap-draft-tool' },
      { label: 'Snake board', href: APP + 'snakedraft' },
    ],
  },
  {
    h: 'Read', links: [
      { label: 'Auction insights', href: '/auction-insights' },
      { label: 'The Pick', href: '/the-pick' },
      { label: 'Auction Watch', href: '/auction-watch' },
      { label: 'Guides', href: '/guides' },
      { label: 'Analyst Desk', href: '/analyst-desk' },
      { label: 'Play-Caller Premium', href: '/play-caller-premium' },
      { label: 'Insight Vault', href: '/insights-vault' },
    ],
  },
  {
    h: 'Company', links: [
      { label: 'In-Season (soon)', href: '/post-draft' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Support', href: '/support' },
      { label: 'Creators & affiliates', href: '/creators' },
    ],
  },
  {
    h: 'Legal', links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

const BLURB = 'Iron Tuna builds custom auction values, true player value, and what you should bid for every player in your exact league, then updates it live on draft night. Values are projections, not guarantees.';

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Which board a page belongs to, so its CTA points at the right one. Read from
// the filename, which is how the page families are already named.
function formatOf(file) {
  if (/^(bestball-|best-ball-)/.test(file)) return 'bestball';
  if (/^(snake-|snake_)/.test(file)) return 'snake';
  return 'auction';
}

// A nav link is "current" when the page being built is the page it points to.
// Dated family members count as their index (auction-insights-2026-08-20.html
// is on /auction-insights), so the nav marks the section you are reading.
function isCurrent(href, file) {
  if (!href.startsWith('/')) return false;
  const slug = href.slice(1);
  if (!slug) return false;
  const base = file.replace(/\.html$/, '');
  return base === slug || base.replace(/-2026-\d{2}-\d{2}$/, '') === slug;
}

function navHtml(file) {
  const app = APP_BY_FORMAT[formatOf(file)];
  const link = (l, extra = '') => {
    const href = l.href.replace('{app}', app);
    const cur = isCurrent(href, file) ? ' aria-current="page"' : '';
    const cls = l.cta ? ' class="cta"' : '';
    return `<a${cls} href="${href}"${cur}${extra}>${esc(l.label)}</a>`;
  };
  const cta = NAV.find((l) => l.cta);
  const items = NAV.filter((l) => !l.cta).map((l) => {
    if (!l.children) return '      ' + link(l);
    const kids = l.children.map((k) => link(k)).join('');
    return `      <span class="nav-dd">${link(l)}<span class="nav-dd-menu">${kids}</span></span>`;
  }).join('\n');
  return [
    '    <nav class="nav" id="sitenav" aria-label="Main">',
    items,
    '    </nav>',
    '    ' + link(cta),
    '    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sitenav">',
    '      <span class="nav-toggle-bars"><span></span></span>Menu',
    '    </button>',
  ].join('\n');
}

function footHtml(file) {
  const app = APP_BY_FORMAT[formatOf(file)];
  const cols = FOOT_COLS.map((c) => {
    const lis = c.links
      .map((l) => `      <li><a href="${l.href.replace('{app}', app)}">${esc(l.label)}</a></li>`)
      .join('\n');
    return `    <div class="foot-col">\n     <h2>${esc(c.h)}</h2>\n     <ul>\n${lis}\n     </ul>\n    </div>`;
  }).join('\n');
  return [
    '  <div class="foot-cols">',
    cols,
    '  </div>',
    '  <div class="foot-note">',
    `   <p>${BLURB}</p>`,
    '   <p class="foot-legal"><span>Iron Tuna&trade; &middot; &copy; 2026 Iron Tuna</span>',
    `    <a href="${app}">Build your free sheet</a></p>`,
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

function putFoot(html, file) {
  const block = `${FOOT_OPEN}\n${footHtml(file)}\n  ${FOOT_CLOSE}`;
  if (html.includes(FOOT_OPEN)) {
    return html.replace(
      new RegExp(FOOT_OPEN + '[\\s\\S]*?' + FOOT_CLOSE.replace(/\//g, '\\/')),
      () => block,
    );
  }
  // The three legal pages carry a bare <footer> rather than <footer class="site">,
  // and they are exactly the pages where the Privacy/Terms links matter, so match
  // either shape and normalise both onto the canonical one.
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
  /\n?\/\* The dropdown is centred on its trigger[\s\S]*?@media \(max-width:560px\)\{\.nav-dd \.nav-dd-menu\{[^}]*\}\}\n?/g,
];
function stripOwned(html) {
  const i = html.indexOf('<style>'), j = html.indexOf('</style>');
  if (i === -1 || j === -1) return html;
  let css = html.slice(i + 7, j);
  // An entry is either a regex to delete outright, or a [regex, replacement]
  // pair where part of the rule has to survive (overflow-x:hidden below).
  for (const entry of OWNED) {
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
function putLogo(html) {
  return html.replace(/\/tuna\.png/g, '/tuna.webp');
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
  if (!NAV_EXCLUDE.has(f)) {
    next = putNav(next, f);
    next = stripOwned(next);
    next = putNavJs(next);
  } else {
    // A reading page keeps its own palette and header, but not its own
    // TYPEFACE: leaving these three on -apple-system while the other 91 render
    // in Inter reintroduces, on the three pages a reader spends longest on, the
    // exact split this branch set out to remove. Only the font stack is
    // rewritten; the white palette that test-reading-view.mjs owns is untouched.
    next = next.replace(
      /(body\{[^}]*?font-family:)-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif/,
      '$1var(--font-body)');
  }
  next = putFoot(next, f);
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
