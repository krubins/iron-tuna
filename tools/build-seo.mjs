#!/usr/bin/env node
// Keeps the site's DISCOVERY LAYER in sync with the pages that actually exist:
//
//   1. The Google tag   — every public page must load gtag.js and configure BOTH
//                         destinations: GA4 (G-KLBZBZSJ25) and Google Ads
//                         (AW-18397866361). Ads was tagged everywhere; GA4 was
//                         tagged nowhere, which is why Analytics reported the
//                         site as untagged and collected zero data.
//   2. JSON-LD          — an Article block on every dated insight/watch page and
//                         every strategy guide, a SoftwareApplication block on
//                         the tool landing pages, and WebSite/Organization on the
//                         front page. Google will not show a rich result for a
//                         page whose subject it has to infer from prose.
//   3. sitemap.xml      — a <lastmod> on every URL. Without it a crawler cannot
//                         tell a page written this morning from one written in
//                         July, and a <changefreq> of "daily" on a page that has
//                         not changed since July is worse than no hint at all.
//
//   node tools/build-seo.mjs           writes the files
//   node tools/build-seo.mjs --check   writes nothing, exits 1 if anything is stale
//
// EVERY EDIT IS IDEMPOTENT. Run it after adding any page — in particular after
// the camp/preseason Routine authors a new auction-watch-YYYY-MM-DD.html (§12),
// alongside `node tools/build-front.mjs`. Running it twice changes nothing.
//
// The generated JSON-LD lives in a script tag marked `data-seo="build-seo"`, so
// this tool can find and replace its own output and will never touch the
// hand-written blocks already in index.html, faq.html or the three guides that
// carry a bespoke FAQPage.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SITE = 'https://irontuna.com';

const GA4 = 'G-KLBZBZSJ25';
const ADS = 'AW-18397866361';

// The operator's own console. It is noindex,nofollow and no visitor reaches it;
// counting admin sessions as site traffic is exactly the drift the first-party
// counter in _worker.js already guards against.
const NO_TAG = new Set(['admin.html']);

const PUBLISHER = {
  '@type': 'Organization',
  name: 'Iron Tuna',
  url: SITE + '/',
  logo: { '@type': 'ImageObject', url: SITE + '/og.png' },
};

// Evergreen strategy guides. datePublished/dateModified come from git so they
// stay honest as the guides are revised.
// The two best-ball guides came off this list with the auction-first pass: the
// pages are still served at the URLs they were indexed at, but nothing on the
// site links to them any more, so listing them in /guides' CollectionPage would
// advertise a shelf the reader cannot see.
const GUIDES = [
  'auction-draft-strategy.html',
  'snake-draft-strategy.html',
  'auction-nomination-strategy.html',
  'auction-budget-allocation.html',
  'dollar-endgame-handcuffs.html',
];

// Keyword landing pages, each describing the draft tool itself rather than an
// article about it — so SoftwareApplication, not Article.
const TOOL_PAGES = {
  'fantasy-football-auction-values.html': '/auctiondraft',
  'auction-draft-assistant.html': '/auctiondraft',
  'salary-cap-draft-tool.html': '/auctiondraft',
  'custom-auction-values.html': '/auctiondraft',
  'superflex-auction-values.html': '/auctiondraft',
};

// Standing columns: one page that accumulates dated entries rather than one page
// per entry. A Blog whose blogPost list is read back out of the page's own
// articles, so the markup cannot claim an entry the page does not have — and so
// a Routine that appends an entry without re-running this tool fails --check,
// exactly as a new drop page does.
const COLUMN_PAGES = {
  'the-pick.html': {
    section: 'The Pick',
    // <article class="call pick" id="pick-YYYY-MM-DD"> ... <h2>headline</h2>
    entry: /<article class="call pick" id="(pick-(\d{4}-\d{2}-\d{2})[^"]*)">[\s\S]*?<h2>([\s\S]*?)<\/h2>/g,
  },
};

const DATED_ARTICLE = [
  { re: /^(?:auction|snake|bestball)-insights-(\d{4}-\d{2}-\d{2})\.html$/, section: 'Insights' },
  { re: /^auction-watch-(\d{4}-\d{2}-\d{2})\.html$/, section: 'Camp Reports' },
];

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const changed = [];

function write(f, next, before) {
  if (next === before) return;
  changed.push(f);
  if (!CHECK) fs.writeFileSync(path.join(ROOT, f), next);
}

// ── head-tag readers ─────────────────────────────────────────────────────────
// Deliberately narrow regexes over the real markup rather than a DOM parse: the
// heads here are machine-uniform, and a dependency-free tool is one the
// publishing Routine can always run.
const meta = (html, re) => { const m = html.match(re); return m ? decode(m[1]) : ''; };
const title = (h) => meta(h, /<title>([\s\S]*?)<\/title>/i).replace(/\s*\|\s*Iron Tuna\s*$/, '').trim();
const desc = (h) => meta(h, /<meta\s+name="description"\s+content="([^"]*)"/i);
const canon = (h) => meta(h, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
const ogImage = (h) => meta(h, /<meta\s+property="og:image"\s+content="([^"]*)"/i);

// JSON-LD is JSON, not HTML, so an entity that survives into it is printed to a
// crawler literally — a headline reading "tiers &mdash; and the player" is a
// machine-readable claim that the page says that. The typographic entities the
// pages actually author are decoded here, and numeric ones generically, because
// the columns write non-breaking hyphens as &#8209; to keep names from breaking.
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    // &amp; last, so "&amp;mdash;" (an escaped entity in the copy) stays literal.
    .replace(/&amp;/g, '&');
}

// git dates for the evergreen pages. If git cannot answer, the dates are never
// invented — a wrong dateModified is a worse signal to a crawler than a missing
// one, and whatever is already committed is kept instead of being overwritten
// with a guess.
//
// A SHALLOW clone is the case that matters: `actions/checkout` fetches depth 1 by
// default, so every file's history collapses to the single checkout commit and
// every guide would appear to have been written today. That is not a missing
// answer, it is a confidently wrong one, so it is detected up front and treated
// as "no history" rather than trusted.
const GIT_OPTS = { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
const HAS_HISTORY = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], GIT_OPTS).trim() === 'false';
  } catch (e) { return false; }
})();

function gitDates(file) {
  if (!HAS_HISTORY) return null;
  try {
    const all = execFileSync('git', ['log', '--follow', '--format=%ad', '--date=short', '--', file], GIT_OPTS)
      .trim().split('\n').filter(Boolean);
    if (!all.length) return null;
    return { published: all[all.length - 1], modified: all[0] };
  } catch (e) { return null; }
}

// What this tool wrote last time, so a run without git history can carry the
// previously computed dates forward instead of dropping them.
function priorGraph(html) {
  const m = html.match(/<script type="application\/ld\+json" data-seo="build-seo">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1])['@graph']; } catch (e) { return null; }
}

// ── 1. the Google tag ────────────────────────────────────────────────────────
// The loader stays on the Ads id so the existing conversion wiring is untouched;
// gtag.js is one library and a second `config` simply registers a second
// destination. Order matters only in that both must run before any event.
function applyTag(file, html) {
  if (html.includes(GA4)) return html;
  const adsConfig = `  gtag('config', '${ADS}');`;
  if (!html.includes(adsConfig)) {
    console.error(`  WARN ${file}: no Google tag block found, skipped`);
    return html;
  }
  return html.replace(adsConfig, `${adsConfig}\n  gtag('config', '${GA4}');`);
}

// ── 2. JSON-LD ───────────────────────────────────────────────────────────────
const MARK_OPEN = '<script type="application/ld+json" data-seo="build-seo">';
const MARK_RE = /\n?<script type="application\/ld\+json" data-seo="build-seo">[\s\S]*?<\/script>/;

function applyLd(file, html) {
  const graph = buildGraph(file, html);
  const block = graph
    ? `\n${MARK_OPEN}${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`
    : '';
  if (MARK_RE.test(html)) return html.replace(MARK_RE, block);
  if (!block) return html;
  // First </head> only: index.html carries a second one inside a JS string.
  return html.replace('</head>', block + '\n</head>');
}

function crumbs(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem', position: i + 1, name: t.name,
      ...(t.url ? { item: t.url } : {}),
    })),
  };
}

function buildGraph(file, html) {
  const url = canon(html);
  if (!url) return null;
  const name = title(html);
  const description = desc(html);
  const image = ogImage(html) || SITE + '/og.png';

  for (const { re, section } of DATED_ARTICLE) {
    const m = file.match(re);
    if (!m) continue;
    const date = m[1];
    return [
      {
        '@type': 'Article',
        headline: name,
        description,
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        image,
        datePublished: date,
        dateModified: date,
        articleSection: section,
        inLanguage: 'en-US',
        isAccessibleForFree: true,
        author: PUBLISHER,
        publisher: PUBLISHER,
      },
      crumbs([
        { name: 'Iron Tuna', url: SITE + '/' },
        // Camp reports used to have no index page of their own, so this pointed
        // at the front page's camp desk (/#camp) — which listed all of them only
        // because the desk was printing the entire run. The desk now shows the
        // latest five and /auction-watch is the archive, so that is the parent.
        { name: section, url: SITE + (section === 'Insights' ? '/insights' : '/auction-watch') },
        { name },
      ]),
    ];
  }

  if (COLUMN_PAGES[file]) {
    const { section, entry } = COLUMN_PAGES[file];
    const posts = [...html.matchAll(entry)].map((m) => ({
      '@type': 'BlogPosting',
      headline: decode(m[3].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(),
      url: url + '#' + m[1],
      datePublished: m[2],
      dateModified: m[2],
      author: PUBLISHER,
      publisher: PUBLISHER,
    }));
    return [
      {
        '@type': 'Blog',
        name, description, url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        image,
        articleSection: section,
        inLanguage: 'en-US',
        isAccessibleForFree: true,
        author: PUBLISHER,
        publisher: PUBLISHER,
        ...(posts.length ? { blogPost: posts } : {}),
      },
      crumbs([{ name: 'Iron Tuna', url: SITE + '/' }, { name: section }]),
    ];
  }

  if (GUIDES.includes(file)) {
    let d = gitDates(file);
    if (!d) {
      const prior = (priorGraph(html) || []).find((n) => n['@type'] === 'Article');
      if (prior && prior.datePublished) d = { published: prior.datePublished, modified: prior.dateModified };
    }
    return [
      {
        '@type': 'Article',
        headline: name,
        description,
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        image,
        ...(d ? { datePublished: d.published, dateModified: d.modified } : {}),
        articleSection: 'Draft Strategy',
        inLanguage: 'en-US',
        isAccessibleForFree: true,
        author: PUBLISHER,
        publisher: PUBLISHER,
      },
      crumbs([
        { name: 'Iron Tuna', url: SITE + '/' },
        { name: 'Guides', url: SITE + '/guides' },
        { name },
      ]),
    ];
  }

  if (TOOL_PAGES[file]) {
    return [
      {
        '@type': 'SoftwareApplication',
        name,
        description,
        url,
        applicationCategory: 'SportsApplication',
        operatingSystem: 'Any (web browser)',
        image,
        publisher: PUBLISHER,
        // Free to use; the $9.99 unlock is an upgrade, not a paywall on entry,
        // and describing it as the price would misrepresent the page.
        offers: [
          { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free draft board with expert values, no signup.' },
          { '@type': 'Offer', price: '9.99', priceCurrency: 'USD', description: "One-time unlock: values rebuilt for your league's exact scoring, a reorderable board, and the live AI draft-day tools." },
        ],
      },
      crumbs([{ name: 'Iron Tuna', url: SITE + '/' }, { name }]),
    ];
  }

  if (file === 'guides.html') {
    return [
      {
        '@type': 'CollectionPage',
        name, description, url,
        inLanguage: 'en-US',
        publisher: PUBLISHER,
        hasPart: GUIDES.map((g) => {
          const h = read(g);
          return { '@type': 'Article', headline: title(h), url: canon(h) };
        }),
      },
      crumbs([{ name: 'Iron Tuna', url: SITE + '/' }, { name: 'Guides' }]),
    ];
  }

  // The camp archive. Its rows are written by build-front.mjs from the report
  // pages themselves, so the CollectionPage is read back off that same list
  // rather than re-scanning the directory — the page and its structured data
  // cannot then disagree about what has been published.
  if (file === 'auction-watch.html') {
    const rows = [...html.matchAll(/<li><span class="wd">[^<]*<\/span><a href="([^"]+)">([\s\S]*?)<\/a>/g)];
    return [
      {
        '@type': 'CollectionPage',
        name, description, url, inLanguage: 'en-US', publisher: PUBLISHER,
        hasPart: rows.map((m) => ({
          '@type': 'Article',
          headline: decode(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(),
          url: SITE + m[1],
        })),
      },
      crumbs([{ name: 'Iron Tuna', url: SITE + '/' }, { name: 'Camp Reports' }]),
    ];
  }

  if (file === 'front.html') {
    return [
      { '@type': 'WebSite', name: 'Iron Tuna', url: SITE + '/', description, inLanguage: 'en-US', publisher: PUBLISHER },
      {
        ...PUBLISHER,
        description: 'Iron Tuna builds custom fantasy football auction, snake and best ball values for your exact league settings, with a live AI Value Coach for draft day.',
        sameAs: ['https://x.com/irontunafantasy', 'https://www.threads.net/@irontunafantasy'],
      },
    ];
  }

  return null;
}

// ── 3. sitemap.xml ───────────────────────────────────────────────────────────
// The existing file is hand-curated (routes like /auctiondraft have no page of
// their own, and the priorities are deliberate), so this fills the gaps in place
// rather than regenerating. Each entry stays on one line inside a single
// <url>...</url> — the worker's drop-date filter matches on exactly that shape.
function applySitemap() {
  const file = 'sitemap.xml';
  const before = read(file);
  let out = before;

  out = out.replace(/<url>([\s\S]*?)<\/url>/g, (block, inner) => {
    if (/<lastmod>/.test(inner)) return block;
    const loc = (inner.match(/<loc>([^<]*)<\/loc>/) || [])[1];
    if (!loc) return block;
    const mod = lastmodFor(loc);
    if (!mod) return block;
    // Sitemap element order is fixed by the schema: loc, lastmod, changefreq, priority.
    return '<url>' + inner.replace(/(<\/loc>)/, `$1<lastmod>${mod}</lastmod>`) + '</url>';
  });

  write(file, out, before);
}

// Routes without a file of their own are the SPA and the front page, which
// change whenever the app or the day's news does.
const ROUTE_FILE = {
  '/': 'front.html',
  '/hub': 'index.html',
  '/auctiondraft': 'index.html',
  '/snakedraft': 'index.html',
  '/bestball': 'index.html',
};

function lastmodFor(loc) {
  const p = loc.replace(SITE, '') || '/';
  const dated = p.match(/-(\d{4}-\d{2}-\d{2})$/);
  if (dated) return dated[1];
  const file = ROUTE_FILE[p] || p.replace(/^\//, '') + '.html';
  if (!fs.existsSync(path.join(ROOT, file))) return null;
  const d = gitDates(file);
  return d ? d.modified : null;
}

// ── run ──────────────────────────────────────────────────────────────────────
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
for (const file of pages) {
  const before = read(file);
  let out = before;
  if (!NO_TAG.has(file)) out = applyTag(file, out);
  out = applyLd(file, out);
  write(file, out, before);
}
applySitemap();

if (CHECK) {
  if (changed.length) {
    console.error(`build-seo --check: ${changed.length} file(s) out of date:\n  ${changed.join('\n  ')}`);
    console.error('Run: node tools/build-seo.mjs');
    process.exit(1);
  }
  console.log('build-seo --check: up to date');
} else {
  console.log(changed.length ? `build-seo: updated ${changed.length} file(s)` : 'build-seo: no change');
}
