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

// ── the canonical link set ───────────────────────────────────────────────────
// One place to change what the site links to. `app` is filled in per page so a
// best-ball guide sends you to the best-ball board, not the auction one.
const APP = 'https://irontuna.com/';
const APP_BY_FORMAT = { auction: APP, snake: APP + 'snakedraft', bestball: APP + 'bestball' };

const NAV = [
  {
    label: 'Insights', href: '/insights', children: [
      { label: 'Auction', href: '/auction-insights' },
      { label: 'Snake', href: '/snake-insights' },
      { label: 'Best Ball', href: '/bestball-insights' },
      { label: 'Insight Vault', href: '/insights-vault' },
    ],
  },
  { label: 'The Pick', href: '/the-pick' },
  { label: 'Guides', href: '/guides' },
  { label: 'Analyst Desk', href: '/analyst-desk' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Draft Day Mode', href: '{app}' },
  { label: 'Free sheet', href: '{app}', cta: true },
];

const FOOT_COLS = [
  {
    h: 'Draft', links: [
      { label: 'Draft Day Mode', href: '{app}' },
      { label: 'Auction board', href: APP + 'auctiondraft' },
      { label: 'Snake board', href: APP + 'snakedraft' },
      { label: 'Best ball board', href: APP + 'bestball' },
      { label: 'Play-Caller Premium', href: '/play-caller-premium' },
    ],
  },
  {
    h: 'Read', links: [
      { label: 'Insights', href: '/insights' },
      { label: 'The Pick', href: '/the-pick' },
      { label: 'Guides', href: '/guides' },
      { label: 'Analyst Desk', href: '/analyst-desk' },
      { label: 'Insight Vault', href: '/insights-vault' },
    ],
  },
  {
    h: 'Company', links: [
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

const BLURB = 'Iron Tuna builds custom auction values, true player value, and your personal max bid for every player in your exact league, then updates your max live on draft night. Values are projections, not guarantees.';

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
  const items = NAV.map((l) => {
    if (!l.children) return '      ' + link(l);
    const kids = l.children.map((k) => link(k)).join('');
    return `      <span class="nav-dd">${link(l)}<span class="nav-dd-menu">${kids}</span></span>`;
  }).join('\n');
  return [
    '    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sitenav">',
    '      <span class="nav-toggle-bars"><span></span></span>Menu',
    '    </button>',
    '    <nav class="nav" id="sitenav" aria-label="Main">',
    items,
    '    </nav>',
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
function putCss(html) {
  if (html.includes(CSS_LINK)) return html;
  const i = html.indexOf('<style>');
  if (i === -1) return html;
  return html.slice(0, i) + CSS_LINK + '\n' + html.slice(i);
}

// Remove the rules site.css now owns from the page's inline <style>. Anything
// missed stays harmless — site.css is linked first, so a leftover inline copy
// just re-states the same value — but leaving them in is how the drift started.
const OWNED = [
  /:root\{--bg:#0b1117[^}]*\}\n?/g,
  /\*\{box-sizing:border-box\}\n?/g,
  /html\{scroll-behavior:smooth\}\n?/g,
  /body\{margin:0;background:radial-gradient\(1200px 600px at 50% -10%[^}]*\}\n?/g,
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
  for (const re of OWNED) css = css.replace(re, '');
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
  next = putSkip(next);
  next = putNav(next, f);
  next = putFoot(next, f);
  next = stripOwned(next);
  next = putNavJs(next);
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
