#!/usr/bin/env node
// Keeps the site's DISCOVERY LAYER in sync with the pages that actually exist:
//
//   1. The Google tag   — every public page must load gtag.js and configure BOTH
//                         destinations: GA4 (G-KLBZBZSJ25) and Google Ads
//                         (AW-18397866361). Ads was tagged everywhere; GA4 was
//                         tagged nowhere, which is why Analytics reported the
//                         site as untagged and collected zero data.
//   2. The head meta    — og:site_name, the og:/twitter: card pair, and a robots
//                         directive lifting the snippet and image-preview caps.
//                         Without the directive every page takes Google's
//                         defaults, which truncate the quoted text — and on a
//                         site whose product IS the explanation, and whose
//                         robots.txt invites answer engines by name, the
//                         truncation lands before the explanation is useful.
//   3. JSON-LD          — an Article block on every dated insight/watch page and
//                         every strategy guide, a SoftwareApplication block on
//                         the tool landing pages, WebSite/Organization on the
//                         front page, and a WebPage, CollectionPage or
//                         WebApplication on everything else indexable. Google
//                         will not show a rich result for a page whose subject
//                         it has to infer from prose. All of it hangs off ONE
//                         organization @id and ONE website @id, so ~160 pages
//                         read as one publisher rather than as 160.
//   4. sitemap.xml      — a <lastmod> on every URL, and an entry for every page
//                         that has none. Without the lastmod a crawler cannot
//                         tell a page written this morning from one written in
//                         July; without the entry it may never look at all. The
//                         URL of a new entry is read from the PAGE'S OWN
//                         canonical, never from its filename: three of these
//                         pages are served at a name they do not claim.
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

// Every page repeats the publisher and the site rather than pointing at a
// definition on another page, because a crawler grades one page at a time and
// an @id it has not fetched resolves to nothing. What the ids buy is that all
// ~160 copies are recognizably ONE organization and ONE website instead of 160
// unrelated ones — which is the difference between a site that answer engines
// can attribute and a pile of pages that merely share a domain.
const ORG_ID = SITE + '/#organization';
const SITE_ID = SITE + '/#website';

const PUBLISHER = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'Iron Tuna',
  url: SITE + '/',
  logo: { '@type': 'ImageObject', url: SITE + '/og.png' },
};

const WEBSITE = {
  '@type': 'WebSite',
  '@id': SITE_ID,
  name: 'Iron Tuna',
  url: SITE + '/',
  inLanguage: 'en-US',
  publisher: { '@id': ORG_ID },
};

// The pages that say noindex. They get no structured data and no robots
// directive from this tool: markup describing a page to a crawler that has been
// told not to index it is noise, and a second robots tag beside the page's own
// is a contradiction.
//
// analyst.html is the one that needs explaining. It ships noindex because the
// shell a crawler is handed says "Reading the desk…" and nothing else. At
// /analysts/<id> the worker pre-renders the persona header, swaps the canonical
// and drops the noindex (analystSeo/analystHeader/analystLd in _worker.js), so
// those eight URLs ARE indexed — but the file on disk is not the thing indexed
// and must stay as it is.
const NOINDEX = new Set(['admin.html', 'lead.html', 'player.html', 'my-insights.html', 'post-draft.html', 'analyst.html', 'player-intel.html']);

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
  'the-tell.html': {
    section: 'The Tell',
    // <article class="call tell" id="tell-YYYY-MM-DD-N" data-players="..."> ... <h2>headline</h2>
    // The trailing [^>]* is not optional: tools/build-front.mjs stamps
    // data-players onto these articles, so an id-then-close regex (which is all
    // The Pick needs) silently matches nothing here and the Blog ships with no
    // blogPost list at all.
    entry: /<article class="call tell" id="(tell-(\d{4}-\d{2}-\d{2})[^"]*)"[^>]*>[\s\S]*?<h2>([\s\S]*?)<\/h2>/g,
  },
};

// ── the rest of the site ─────────────────────────────────────────────────────
// Everything above is a page shape this tool already knew. What was left was 52
// pages carrying no structured data at all — among them /rankings, /dfs,
// /stats, /previews, /vegas-edge, /waivers, /trade-finder, /faab and all sixteen
// per-position rankings boards, which is to say the entire in-season product and
// most of what the site is searched for. A page with no markup is not penalized,
// but it arrives at an answer engine as prose to be guessed at rather than as a
// stated subject with a stated publisher, and it is the guess that loses.
//
// Three shapes cover them. A page the reader OPERATES is a WebApplication; a
// page that INDEXES other pages is a CollectionPage; everything else is a
// WebPage. Nothing here claims an itemListElement, because these boards fill
// themselves in the browser and markup listing rows the served HTML does not
// contain would be a claim a crawler can check and disbelieve.
const APP_PAGES = new Set([
  'rankings.html', 'trade-finder.html', 'faab.html', 'dfs.html',
  'my-league.html', 'my-week.html', 'waivers.html',
]);

const COLLECTION_PAGES = new Set([
  'insights.html', 'insights-vault.html', 'auction-insights.html', 'snake-insights.html',
  'bestball-insights.html', 'desk.html', 'analysts.html', 'creators.html', 'in-season.html',
]);

// The one breadcrumb parent each page sits under. A page absent from this map
// hangs straight off the front page, which is true of the standalone landing and
// policy pages and of nothing else.
const IN_SEASON = { name: 'In-Season', url: SITE + '/in-season' };
const RANKINGS = { name: 'Rankings', url: SITE + '/rankings' };
const MARKET = { name: 'Market Intel', url: SITE + '/vegas-edge' };
const READ = { name: 'The Desk', url: SITE + '/in-season/desk' };
const PARENT = {
  'fantasy.html': IN_SEASON, 'dfs.html': IN_SEASON, 'stats.html': IN_SEASON,
  'waivers.html': IN_SEASON, 'faab.html': IN_SEASON, 'trade-finder.html': IN_SEASON,
  'my-league.html': IN_SEASON, 'my-week.html': IN_SEASON, 'weekly-intel.html': IN_SEASON,
  'rankings.html': IN_SEASON,
  'vegas-edge.html': MARKET, 'game-intel.html': MARKET, 'hidden-value.html': MARKET,
  'previews.html': MARKET, 'the-line.html': MARKET, 'what-they-arent-telling-you.html': MARKET,
  'desk.html': IN_SEASON, 'analysts.html': READ, 'play-caller-premium.html': READ,
  'insights.html': READ, 'insights-vault.html': READ,
  'auction-insights.html': READ, 'snake-insights.html': READ, 'bestball-insights.html': READ,
};
// The sixteen position boards all hang off their own overall board.
for (const p of ['qb', 'rb', 'wr', 'te', 'flex', 'k', 'dst']) {
  PARENT['weekly-' + p + '-rankings.html'] = { name: 'This week\u2019s rankings', url: SITE + '/weekly-rankings' };
  PARENT['season-long-' + p + '-rankings.html'] = { name: 'Season long rankings', url: SITE + '/season-long-rankings' };
}
PARENT['weekly-rankings.html'] = RANKINGS;
PARENT['season-long-rankings.html'] = RANKINGS;

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

// ── 1b. the head meta every page was missing ─────────────────────────────────
// Three gaps, all site-wide, all invisible until you go looking.
//
// ROBOTS. No page said anything about snippets, so every page took Google's
// defaults — which cap the text that may be quoted from it and the size of any
// image preview. On a site whose whole product is an explanation ("this is what
// the market says, this is what the consensus says, here is the gap"), a capped
// snippet is the explanation truncated at the point it becomes useful, and an AI
// answer surface quoting the site is exactly the traffic being competed for.
// max-snippet:-1 and max-image-preview:large lift the caps. They are permissions
// granted, not rankings claimed: nothing here asks for placement.
//
// OG:SITE_NAME. Absent from all 157 pages, so a card rendered from any of them
// was attributed to a bare domain rather than to Iron Tuna.
//
// TWITTER:TITLE / :DESCRIPTION / :IMAGE. Absent from 151 pages. Most scrapers
// fall back to the og:* pair and were fine; the ones that do not had a
// summary_large_image card declared with no image to put in it.
//
// The block is bounded by sentinels so this tool rewrites only its own output,
// and each tag is emitted ONLY where the page does not already carry it — the
// worker's per-route rewriter (__SPA_SEO, analystSeo) edits the FIRST match of
// each of these tags, so a duplicate would leave a stale second copy behind it.
const ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
const META_OPEN = '<!--seo:meta-->';
const META_RE = /\n?<!--seo:meta-->[\s\S]*?<!--\/seo:meta-->/;

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const hasTag = (html, re) => re.test(html.slice(0, html.indexOf('</head>') + 1));

function applyMeta(file, html) {
  // The generated block is stripped first so every read below sees the PAGE's
  // own tags rather than last run's output — otherwise a second run would find
  // its own twitter:title and decide the page already had one.
  let out = html.replace(META_RE, '');
  if (NOINDEX.has(file)) return out;

  const tags = [];
  const want = (re, tag) => { if (!hasTag(out, re)) tags.push(tag); };

  // A page that already states an indexable robots directive keeps its own tag,
  // rewritten in place to carry the preview permissions. Only a page with no
  // robots tag at all gets one from the block.
  const own = out.slice(0, out.indexOf('</head>') + 1).match(/<meta\s+name="robots"\s+content="([^"]*)"\s*\/?>/i);
  if (own) out = out.replace(own[0], '<meta name="robots" content="' + ROBOTS + '">');
  else tags.push('<meta name="robots" content="' + ROBOTS + '">');

  want(/<meta\s+property="og:site_name"/i, '<meta property="og:site_name" content="Iron Tuna">');
  want(/<meta\s+property="og:locale"/i, '<meta property="og:locale" content="en_US">');
  want(/<meta\s+name="twitter:site"/i, '<meta name="twitter:site" content="@irontunafantasy">');
  want(/<meta\s+name="twitter:card"/i, '<meta name="twitter:card" content="summary_large_image">');

  // The og: and twitter: pairs, each filled from the page's own head so a card
  // can never say something the <title> and the description do not. Both are
  // generated only where the page has nothing of its own: the pages that came
  // with hand-written OG copy have better copy than a template would produce,
  // and the worker rewrites the FIRST match of each of these tags per route, so
  // a generated duplicate would leave a stale second copy behind the rewrite.
  const full = meta(out, /<title>([\s\S]*?)<\/title>/i).trim();
  const ogt = meta(out, /<meta\s+property="og:title"\s+content="([^"]*)"/i) || full;
  const ogd = meta(out, /<meta\s+property="og:description"\s+content="([^"]*)"/i) || desc(out);
  const ogu = meta(out, /<meta\s+property="og:url"\s+content="([^"]*)"/i) || canon(out);
  const ogi = ogImage(out) || SITE + '/og.png';
  want(/<meta\s+property="og:type"/i, '<meta property="og:type" content="website">');
  if (ogt) want(/<meta\s+property="og:title"/i, '<meta property="og:title" content="' + esc(ogt) + '">');
  if (ogd) want(/<meta\s+property="og:description"/i, '<meta property="og:description" content="' + esc(ogd) + '">');
  if (ogu) want(/<meta\s+property="og:url"/i, '<meta property="og:url" content="' + esc(ogu) + '">');
  want(/<meta\s+property="og:image"/i, '<meta property="og:image" content="' + esc(ogi) + '">');
  if (ogt) want(/<meta\s+name="twitter:title"/i, '<meta name="twitter:title" content="' + esc(ogt) + '">');
  if (ogd) want(/<meta\s+name="twitter:description"/i, '<meta name="twitter:description" content="' + esc(ogd) + '">');
  want(/<meta\s+name="twitter:image"/i, '<meta name="twitter:image" content="' + esc(ogi) + '">');

  if (!tags.length) return out;
  const block = '\n' + META_OPEN + '\n' + tags.join('\n') + '\n<!--/seo:meta-->';
  // Anchored to the canonical link, NOT to </head>. Both this pass and the
  // JSON-LD pass below insert into the head, and if both anchored on </head>
  // they would swap places on every run — strip, re-append after the other
  // block, and report 150 files out of date for ever. The canonical is the one
  // tag every indexable page carries exactly once, so it is the stable anchor.
  const c = out.match(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i);
  if (c) return out.replace(c[0], c[0] + block);
  return out.replace('</head>', block + '\n</head>');
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
        isPartOf: { '@id': SITE_ID },
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
        isPartOf: { '@id': SITE_ID },
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
        isPartOf: { '@id': SITE_ID },
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
        inLanguage: 'en-US',
        isPartOf: { '@id': SITE_ID },
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
        isPartOf: { '@id': SITE_ID },
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
        name, description, url, inLanguage: 'en-US', isPartOf: { '@id': SITE_ID }, publisher: PUBLISHER,
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
      { ...WEBSITE, description, publisher: { '@id': ORG_ID } },
      {
        ...PUBLISHER,
        description: 'Iron Tuna prices every NFL player against the betting market first and the consensus projections second, then restates the numbers at your league’s scoring — weekly rankings, waiver prices, DFS values and model-vs-market game lines in season, and custom draft values before it.',
        sameAs: ['https://x.com/irontunafantasy', 'https://www.threads.net/@irontunafantasy'],
      },
    ];
  }

  if (NOINDEX.has(file)) return null;

  // Everything else that is indexable. WebApplication for a board the reader
  // operates, CollectionPage for a page that indexes others, WebPage for the
  // rest — plus the breadcrumb, which is what turns a bare URL in a result into
  // "Iron Tuna › In-Season › Rankings › This week's rankings".
  const type = APP_PAGES.has(file) ? 'WebApplication' : COLLECTION_PAGES.has(file) ? 'CollectionPage' : 'WebPage';
  const d = gitDates(file);
  const parent = PARENT[file];
  return [
    {
      '@type': type,
      '@id': url,
      name,
      description,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      image,
      inLanguage: 'en-US',
      isAccessibleForFree: true,
      isPartOf: { '@id': SITE_ID },
      ...(d ? { dateModified: d.modified } : {}),
      // A tool has to say what kind of tool it is and what it costs to open, or
      // the type is a label with nothing behind it. Free is the honest answer:
      // every board here opens without a signup, and the $9.99 unlock is an
      // upgrade inside the draft app, not the price of this page.
      ...(type === 'WebApplication'
        ? {
          applicationCategory: 'SportsApplication',
          operatingSystem: 'Any (web browser)',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        }
        : {}),
      publisher: PUBLISHER,
    },
    crumbs([
      { name: 'Iron Tuna', url: SITE + '/' },
      ...(parent ? [parent] : []),
      { name },
    ]),
  ];
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

  // ── the entries that were never there ──────────────────────────────────────
  // Filling a lastmod only helps a URL the file already lists. What it could not
  // catch was a page missing from the file altogether — and sixteen were: every
  // per-position rankings board plus /rankings, /stats, /previews, /vegas-edge,
  // /hidden-value, /desk. All sixteen were written while the in-season section
  // was still gated, when leaving them out was correct: the worker served the
  // waiting-list gate's body at their URLs, and advertising sixteen addresses
  // for one body is how a site teaches Google it has duplicate content.
  //
  // POST_DRAFT_OPEN is set now. They serve themselves, and a page a crawler is
  // never told about is a page that has to be stumbled upon.
  //
  // Appended rather than inserted in place: the file is hand-ordered and the
  // priorities in it are deliberate, so a new line goes at the end where it can
  // be read and moved, and an existing line is never rewritten.
  // The URL comes from the page's OWN canonical, never from its filename. Three
  // of these pages are served at a name they do not claim — /rankings, /desk and
  // /vegas-edge each canonicalise to /in-season/<name> — so a filename-derived
  // entry would have advertised a URL that the page it points at disowns in its
  // first ten lines. That is the /analysts/<id> mistake again, and the sitemap
  // is always the side that yields: a canonical is the page's own statement
  // about which address it lives at.
  const listed = new Set([...out.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]));
  const add = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && !NOINDEX.has(f) && !SITEMAP_SKIP.has(f))
    .map((f) => [f, canon(read(f))])
    .filter(([f, loc]) => {
      if (!loc) { console.error(`  WARN ${f}: no canonical, left out of the sitemap`); return false; }
      return !listed.has(loc);
    })
    .sort((a, b) => a[1].localeCompare(b[1]));
  if (add.length) {
    // A board that re-renders every day has no older honest lastmod than today,
    // and every page reaching this branch is one of those. A page with real git
    // history still takes its date from git; TODAY is the fallback, and it is
    // announced rather than assumed.
    const today = new Date().toISOString().slice(0, 10);
    const rows = add.map(([f, loc]) => {
      const d = gitDates(f);
      if (!d) console.error(`  NOTE ${loc}: no git history for ${f}, lastmod set to today (${today})`);
      return `  <url><loc>${loc}</loc><lastmod>${d ? d.modified : today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`;
    });
    out = out.replace(/<\/urlset>/, rows.join('\n') + '\n</urlset>');
  }

  write(file, out, before);
}

// The pages that are indexable but are NOT a URL of their own, so the appender
// above must not invent one for them. index.html answers at "/hub" and the three
// format routes; front.html answers at "/". Both are listed under those names
// already. The two shells answer at /analysts/<id> and /lead/<slug>, which are
// listed per id, not per file.
const SITEMAP_SKIP = new Set(['index.html', 'front.html']);

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
  out = applyMeta(file, out);
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
