#!/usr/bin/env node
// Tests for the discovery layer: the Google tag, the JSON-LD, the sitemap, and
// the static camp desk.
//   node tools/test-seo.mjs
//
// Four things here are load-bearing and everything below exists to protect them.
//
// First, THE SITE MUST BE MEASURABLE. Google Analytics collects nothing at all
// from a page that does not configure the GA4 destination, and the failure is
// silent — the pages render, the Ads tag keeps converting, and the only symptom
// is an Analytics property that says "no data received". A page added without
// the tag is invisible forever, not late.
//
// Second, EVERY PAGE MUST BE REACHABLE BY A CRAWLER THAT NEVER RUNS JAVASCRIPT.
// robots.txt explicitly invites GPTBot, PerplexityBot and ClaudeBot; none of
// them execute scripts. A link that exists only after a client render does not
// exist for them, so the camp desk is pre-rendered into front.html and that
// pre-render has to keep matching REPORTS.
//
// Third, THE STRUCTURED DATA MUST NOT LIE. A datePublished that disagrees with
// the page's own date, or a canonical that points somewhere else, is worse than
// no markup: it is a machine-readable claim that Google can check and distrust.
//
// Fourth, THE WORKER MUST STILL BE ABLE TO FILTER THE SITEMAP. Undropped insight
// pages are stripped from sitemap.xml at request time by a regex over each
// <url> block. Reshaping those blocks without checking that regex would publish
// tomorrow's drops today.
//
// Fifth, THE SITE MUST NOT CONTRADICT ITSELF ABOUT WHERE A PAGE LIVES. Every
// signal that names a URL — the canonical, og:url, the JSON-LD, the sitemap
// entry — has to name the SAME one, and only one page may name it. Where they
// disagreed, they canceled: sitemap.xml advertised eight /analysts/<id> URLs
// whose shell was noindex and canonicalised to /analysts, and creators.html
// declared itself a duplicate of the front page while being listed as
// /creators. Neither failure shows up as an error anywhere; the pages just
// never rank. The sitemap is always the side that yields, because a canonical
// is the page's own statement about its address.

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
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

const GA4 = 'G-KLBZBZSJ25';
const ADS = 'AW-18397866361';
const ADMIN = 'admin.html';

// ── the Google tag ───────────────────────────────────────────────────────────
console.log('\nthe Google tag');
{
  const untagged = pages.filter((f) => f !== ADMIN && !read(f).includes(`gtag('config', '${GA4}')`));
  ok('every public page configures GA4', untagged.length === 0, untagged.join(', '));

  const noAds = pages.filter((f) => f !== ADMIN && !read(f).includes(`gtag('config', '${ADS}')`));
  ok('every public page still configures Google Ads', noAds.length === 0, noAds.join(', '));

  const noLoader = pages.filter((f) => f !== ADMIN && !/googletagmanager\.com\/gtag\/js\?id=/.test(read(f)));
  ok('every public page loads gtag.js', noLoader.length === 0, noLoader.join(', '));

  // Both configs must come after the gtag() shim is defined, or the calls throw
  // and neither destination ever receives a hit.
  const badOrder = pages.filter((f) => {
    const h = read(f);
    if (f === ADMIN) return false;
    return h.indexOf('function gtag(') > h.indexOf(`gtag('config', '${GA4}')`);
  });
  ok('GA4 is configured after the gtag shim', badOrder.length === 0, badOrder.join(', '));

  // The admin console is the operator's own screen: counting it as site traffic
  // is the same drift the first-party counter already excludes.
  ok('the admin console is not tagged for GA4', !read(ADMIN).includes(GA4));

  // The purchase has to reach BOTH products. Ads gets the conversion, GA4 gets a
  // purchase event; neither one implies the other.
  const app = read('index.html');
  ok('the Ads purchase conversion still fires', app.includes(`'send_to': '${ADS}/PIr0COO29uMcEPnS5MRE'`));
  ok('a GA4 purchase event fires too', /gtag\('event', 'purchase', \{[\s\S]{0,400}'send_to': 'G-KLBZBZSJ25'/.test(app));
  // Both are keyed on the Stripe checkout-session id so a revisited success URL
  // cannot double-count, and both only run behind the server-verified return.
  const purchase = app.match(/gtag\('event', 'purchase', \{[\s\S]*?\}\);/);
  ok('the GA4 purchase carries the checkout session as transaction_id',
    !!purchase && /'transaction_id': sp\.get\('cs'\)/.test(purchase[0]));
  ok('the GA4 purchase carries the price', !!purchase && /'value': 9\.99/.test(purchase[0]) && /'currency': 'USD'/.test(purchase[0]));
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────
console.log('\nstructured data');
{
  let blocks = 0, invalid = [];
  for (const f of pages) {
    for (const m of read(f).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      blocks++;
      try { JSON.parse(m[1]); } catch (e) { invalid.push(f); }
    }
  }
  ok('every JSON-LD block parses', invalid.length === 0, invalid.join(', '));
  ok('the site actually has structured data', blocks > 80, String(blocks));

  const dated = pages.filter((f) => /^(?:auction|snake|bestball)-insights-\d{4}-\d{2}-\d{2}\.html$|^auction-watch-\d{4}-\d{2}-\d{2}\.html$/.test(f));
  ok('there are dated article pages to check', dated.length > 60, String(dated.length));

  const graphOf = (f) => {
    const m = read(f).match(/<script type="application\/ld\+json" data-seo="build-seo">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1])['@graph'] : null;
  };

  const missing = dated.filter((f) => !graphOf(f));
  ok('every dated page carries an Article block', missing.length === 0, missing.slice(0, 5).join(', '));

  const wrongDate = dated.filter((f) => {
    const g = graphOf(f); if (!g) return true;
    const a = g.find((n) => n['@type'] === 'Article');
    return !a || a.datePublished !== f.match(/(\d{4}-\d{2}-\d{2})/)[1];
  });
  ok('datePublished matches the page\'s own date', wrongDate.length === 0, wrongDate.slice(0, 5).join(', '));

  // A canonical and a JSON-LD url that disagree tell Google two different things
  // about which URL this page is.
  const wrongUrl = dated.filter((f) => {
    const h = read(f);
    const canonical = (h.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    const a = (graphOf(f) || []).find((n) => n['@type'] === 'Article');
    return !a || !canonical || a.url !== canonical || a.mainEntityOfPage['@id'] !== canonical;
  });
  ok('the Article url matches the canonical', wrongUrl.length === 0, wrongUrl.slice(0, 5).join(', '));

  const noCrumbs = dated.filter((f) => !(graphOf(f) || []).some((n) => n['@type'] === 'BreadcrumbList'));
  ok('every dated page carries breadcrumbs', noCrumbs.length === 0, noCrumbs.slice(0, 5).join(', '));

  // The hand-written blocks predate build-seo.mjs and it must never clobber them.
  ok('index.html keeps its hand-written WebApplication block', read('index.html').includes('"@type": "WebApplication"'));
  ok('faq.html keeps its FAQPage', read('faq.html').includes('FAQPage'));
  ok('the front page declares WebSite and Organization',
    /"@type":"WebSite"/.test(read('front.html')) && /"@type":"Organization"/.test(read('front.html')));

  // THE FLOOR. Before this, 52 pages carried no structured data at all —
  // /rankings, /dfs, /stats, /previews, /vegas-edge, /waivers, /trade-finder,
  // /faab and every per-position rankings board among them, which is to say the
  // whole in-season product. A page with no markup is not penalized; it simply
  // arrives as prose to be guessed at rather than as a stated subject with a
  // stated publisher, and the guess is what loses.
  const indexable = pages.filter((f) => !/<meta name="robots"[^>]*noindex/.test(read(f)) && f !== ADMIN);
  const bare = indexable.filter((f) => !/<script type="application\/ld\+json"/.test(read(f)));
  ok('every indexable page carries structured data', bare.length === 0, bare.slice(0, 8).join(', '));

  // front.html is the exception, twice over: it IS the root, so there is no
  // trail to print, and it is where the WebSite and Organization the rest of the
  // site points at are defined, so it is not part of anything — it is the thing.
  const FRONT = "front.html";
  const noCrumb = indexable.filter((f) => f !== FRONT && !/"@type":\s*"BreadcrumbList"/.test(read(f)));
  ok('every indexable page carries breadcrumbs', noCrumb.length === 0, noCrumb.slice(0, 8).join(', '));

  // ONE entity, not 160. Every page repeats the publisher rather than pointing
  // at a definition it would have to fetch, but all the copies carry the same
  // @id — which is the difference between a site an answer engine can attribute
  // and a pile of pages that merely share a domain.
  const ORG = 'https://irontuna.com/#organization';
  const SITE_ID = 'https://irontuna.com/#website';
  const graphs = (f) => {
    const m = read(f).match(/<script type="application\/ld\+json" data-seo="build-seo">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1])['@graph'] : null;
  };
  const generated = indexable.filter((f) => graphs(f));
  ok('most pages take their markup from build-seo', generated.length > 140, String(generated.length));

  const orphan = generated.filter((f) => !read(f).includes(ORG));
  ok('every generated graph names the one organization', orphan.length === 0, orphan.slice(0, 6).join(', '));

  const unmoored = generated.filter((f) => f !== FRONT).filter((f) => {
    const page = graphs(f).find((n) => n['@type'] !== 'BreadcrumbList');
    return !page || !page.isPartOf || page.isPartOf['@id'] !== SITE_ID;
  });
  ok('every generated page says which website it is part of', unmoored.length === 0, unmoored.slice(0, 6).join(', '));

  ok('and the front page is where that website is defined',
    read('front.html').includes(SITE_ID) && read('front.html').includes(ORG));

  // The markup's URL is the page's own canonical, everywhere — not just on the
  // dated pages the check above covers.
  const split = generated.filter((f) => {
    const c = (read(f).match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    const page = graphs(f).find((n) => n['@type'] !== 'BreadcrumbList');
    return !c || !page || (page.url && page.url !== c);
  });
  ok('every generated graph points at the page\'s own canonical', split.length === 0, split.slice(0, 6).join(', '));

  // A board fills itself in the browser. Markup listing rows the served HTML
  // does not contain is a claim a crawler can check and disbelieve, so the
  // in-season boards must never grow an itemListElement they cannot back.
  const boards = ['weekly-rankings.html', 'season-long-rankings.html', 'stats.html', 'previews.html', 'hidden-value.html'];
  const claiming = boards.filter((f) => /"itemListElement"/.test((read(f).match(/data-seo="build-seo">([\s\S]*?)<\/script>/) || [, ''])[1].replace(/"@type":"BreadcrumbList"[\s\S]*/, '')));
  ok('no client-rendered board claims rows it does not serve', claiming.length === 0, claiming.join(', '));
}

// ── the head meta ────────────────────────────────────────────────────────────
// tools/build-seo.mjs generates this block. What it is FOR is written there;
// what is pinned here is that it reached every page and that it did not
// contradict the page it landed on.
console.log('\nhead meta');
{
  // The pages a crawler is told to skip. They get no generated meta at all, so
  // every check below is scoped to the pages that are actually up for indexing.
  const NOINDEXED = pages.filter((f) => /<meta name="robots"[^>]*noindex/.test(read(f)));
  const indexable = pages.filter((f) => !NOINDEXED.includes(f));
  ok('most of the site is indexable', indexable.length > 140, String(indexable.length));

  // index.html is the React app and writes its head in XHTML style — <meta ... />
  // with a space and a slash. Every generated tag closes with a plain ">". Both
  // are valid HTML and a matcher that only knows one of them fails the app page
  // for a tag the app page has, which is a test bug reported as a site bug.
  const missing = (re, label) => {
    const bad = indexable.filter((f) => !re.test(read(f)));
    ok(label, bad.length === 0, bad.slice(0, 6).join(', '));
  };

  // Snippet and preview permissions. Without them the site takes Google's
  // defaults, which cap how much of a page may be quoted — on a site whose
  // product IS the explanation, and whose robots.txt invites answer engines by
  // name, a capped snippet is the answer cut off before it is useful.
  missing(/<meta name="robots" content="[^"]*max-image-preview:large/, 'every indexable page allows a large image preview');
  missing(/<meta name="robots" content="[^"]*max-snippet:-1/, 'every indexable page allows an unlimited snippet');

  missing(/<meta property="og:site_name" content="Iron Tuna"\s*\/?>/, 'every indexable page names the site in its card');
  missing(/<meta property="og:title" content="[^"]+"/, 'every indexable page has an og:title');
  missing(/<meta property="og:description" content="[^"]+"/, 'every indexable page has an og:description');
  missing(/<meta property="og:image" content="https:\/\/irontuna\.com\/[^"]+"/, 'every indexable page has an absolute og:image');
  missing(/<meta name="twitter:card" content="summary_large_image"\s*\/?>/, 'every indexable page declares a large card');
  missing(/<meta name="twitter:image" content="[^"]+"/, 'a large card is declared with an image to put in it');

  // ONE of each. The worker rewrites the FIRST match of these tags per route
  // (__SPA_SEO for the format routes, analystSeo for /analysts/<id>), so a
  // duplicate is a stale second copy the rewrite never reaches — which is worse
  // than the missing tag it was added to fix.
  const dup = [];
  for (const f of pages) {
    const head = read(f).slice(0, read(f).indexOf('</head>'));
    for (const t of ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:card']) {
      const n = [...head.matchAll(new RegExp('<meta (?:property|name)="' + t + '"', 'g'))].length;
      if (n > 1) dup.push(f + ':' + t);
    }
    const r = [...head.matchAll(/<meta name="robots"/g)].length;
    if (r > 1) dup.push(f + ':robots');
  }
  ok('no page carries the same head tag twice', dup.length === 0, dup.slice(0, 6).join(', '));

  // og:url and the canonical are two statements about the same thing.
  const split = indexable.filter((f) => {
    const h = read(f);
    const c = (h.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    const u = (h.match(/<meta property="og:url" content="([^"]*)"/) || [])[1];
    return c && u && c !== u;
  });
  ok('og:url and the canonical name the same URL', split.length === 0, split.slice(0, 6).join(', '));

  // The one that bit creators.html: a canonical of "https://irontuna.com" made
  // the page a declared duplicate of the front page, and the sitemap advertised
  // it as /creators at the same time. Two pages claiming one URL is the same
  // bug with a different symptom.
  const seen = new Map();
  const clash = [];
  for (const f of indexable) {
    const c = (read(f).match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    if (!c) { clash.push(f + ' (none)'); continue; }
    // The front page's canonical is the root, with the trailing slash. Anything
    // else must carry a path: "https://irontuna.com" with no path at all is what
    // creators.html said, and it made the page a declared duplicate of the front
    // page while the sitemap advertised it as /creators.
    if (!/^https:\/\/irontuna\.com\/.*/.test(c) || c === 'https://irontuna.com') clash.push(f + ' -> ' + c);
    else if (seen.has(c)) clash.push(f + ' shares ' + c + ' with ' + seen.get(c));
    else seen.set(c, f);
  }
  ok('every indexable page claims one URL, and claims it alone', clash.length === 0, clash.slice(0, 6).join(', '));
}

// ── the static camp desk ─────────────────────────────────────────────────────
console.log('\nthe camp desk is crawlable without JavaScript');
{
  const front = read('front.html');
  const reports = JSON.parse(front.match(/var REPORTS = (\[[\s\S]*?\]);\n/)[1]);
  ok('REPORTS is populated', reports.length > 0, String(reports.length));

  // The whole run lives at /auction-watch, in the served HTML rather than behind
  // the script — the front page's desk carries only the latest few, so this is
  // the page that has to be complete for a crawler that never runs JavaScript.
  const archive = read('auction-watch.html');
  const inArchive = new Set([...archive.matchAll(/href="(\/auction-watch-\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]));
  ok('every camp report is linked in the served HTML of /auction-watch',
    reports.every((r) => inArchive.has(r.url)),
    reports.filter((r) => !inArchive.has(r.url)).map((r) => r.url).join(', '));

  // And the front page deliberately does NOT carry them all any more. A desk that
  // creeps back to printing the entire run is the regression this pins.
  const onFront = new Set([...front.matchAll(/href="(\/auction-watch-\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]));
  ok('the front page carries only the latest few reports, not the archive',
    onFront.size <= 5 && onFront.size >= Math.min(2, reports.length), String(onFront.size));

  // The link out is what makes the trimmed desk honest rather than a truncation.
  ok('the camp desk links to the archive', /id="camp"[\s\S]{0,300}href="\/auction-watch"/.test(front));

  ok('the latest report is the featured one',
    new RegExp(`id="campFeat">[\\s\\S]{0,400}href="${reports[0].url}"`).test(front));

  // The client render appends rows. Without this clear it would append a second
  // copy of every row on top of the pre-rendered ones.
  ok('the client render clears the list before refilling it',
    /var cl = document\.getElementById\('campList'\);\s*(?:\/\/[^\n]*\n\s*)*cl\.innerHTML = '';/.test(front));

  // A camp report page nobody links to is reachable only from the sitemap.
  const watchPages = pages.filter((f) => /^auction-watch-\d{4}-\d{2}-\d{2}\.html$/.test(f));
  const orphans = watchPages.filter((f) => {
    const url = '/' + f.replace('.html', '');
    return !pages.some((p) => p !== f && read(p).includes(`href="${url}"`));
  });
  ok('no camp report page is orphaned', orphans.length === 0, orphans.join(', '));
}

// ── sitemap ──────────────────────────────────────────────────────────────────
console.log('\nsitemap.xml');
{
  const xml = read('sitemap.xml');
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  ok('the sitemap has entries', urls.length > 90, String(urls.length));

  const noMod = urls.filter((u) => !/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(u));
  ok('every entry has a well-formed lastmod', noMod.length === 0, String(noMod.length));

  // Schema order is fixed: loc, lastmod, changefreq, priority.
  const badOrder = urls.filter((u) => u.indexOf('<lastmod>') !== -1 && u.indexOf('<lastmod>') < u.indexOf('</loc>'));
  ok('lastmod follows loc', badOrder.length === 0, String(badOrder.length));

  const datedWrong = urls.filter((u) => {
    const loc = (u.match(/<loc>([^<]*)<\/loc>/) || [])[1] || '';
    const d = loc.match(/-(\d{4}-\d{2}-\d{2})$/);
    return d && !u.includes(`<lastmod>${d[1]}</lastmod>`);
  });
  ok('a dated URL\'s lastmod is its own date', datedWrong.length === 0, String(datedWrong.length));

  // Every indexable page must be listed. index.html/front.html are the "/" and
  // SPA routes; the noindex screens are deliberately absent.
  //
  // player.html is out for the same reason lead.html is: it is a shell that
  // answers at ~400 URLs (/player/<slug>) and assembles each card in the
  // browser, so there is no fixed URL with content on it to rank.
  //
  // So are the in-season tools, and for a different reason: while POST_DRAFT_OPEN
  // is unset the worker serves /post-draft AT their URLs, so a crawler that
  // followed a sitemap entry for /faab would be handed the gate page's body under
  // a second URL — the textbook way to create duplicate content. They are read
  // out of _worker.js rather than hardcoded here, so opening the section (or
  // adding a page to it) cannot silently leave this check wrong.
  const gated = (fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8')
    .match(/const POST_DRAFT_PAGES = new Set\(\[([^\]]*)\]\)/) || [, ''])[1]
    .split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    .map((r) => r.replace(/^\//, '') + '.html');
  //
  // post-draft.html is out because /post-draft 301s to /in-season. The file is
  // kept — the redirect is one line and this is the page that would have to
  // serve again if it were ever removed — but advertising a permanently
  // redirected URL as canonical is exactly the split signal the 301 exists to
  // prevent, so it is noindex and unlisted.
  // analyst.html is a shell like player.html: it answers at /analysts/<id>,
  // and those eight URLs are what the sitemap lists.
  const NOT_LISTED = new Set(['index.html', 'front.html', 'admin.html', 'lead.html', 'player.html', 'my-insights.html', 'post-draft.html', 'analyst.html', ...gated]);
  const locs = new Set(urls.map((u) => (u.match(/<loc>([^<]*)<\/loc>/) || [])[1]));
  const absent = pages.filter((f) => !NOT_LISTED.has(f) && !locs.has('https://irontuna.com/' + f.replace('.html', '')));
  ok('every indexable page is in the sitemap', absent.length === 0, absent.join(', '));

  // The pages left out on purpose are the ones that say noindex.
  const shouldBeNoindex = ['admin.html', 'lead.html', 'player.html', 'my-insights.html'];
  const notNoindex = shouldBeNoindex.filter((f) => !/name="robots"[^>]*noindex/.test(read(f)));
  ok('the pages kept out of the sitemap are noindex', notNoindex.length === 0, notNoindex.join(', '));

  // The analyst desk was retired on 2026-08-30. Its page is gone, so the URL
  // must be gone from the sitemap too: a sitemap that advertises a 404 is worse
  // than one that is short.
  ok('the retired /analyst-desk is not advertised', !locs.has('https://irontuna.com/analyst-desk'));
  ok('and its page is really gone', !fs.existsSync(path.join(ROOT, 'analyst-desk.html')));

  // The worker's own drop-date filter, run against the real file.
  const filtered = xml.replace(
    /<url><loc>https:\/\/irontuna\.com\/(?:auction|snake|bestball)-insights-(\d{4})-(\d{2})-(\d{2})<\/loc>[\s\S]*?<\/url>\s*/g,
    (blk, y, mo, dd) => ((y + '-' + mo + '-' + dd) !== '2026-07-04' && Date.now() < Date.UTC(+y, +mo - 1, +dd, 13, 0, 0) ? '' : blk));
  const kept = [...filtered.matchAll(/<url>/g)].length;
  ok('the worker\'s drop filter still matches whole entries', kept <= urls.length);
  ok('the filter leaves no orphaned lastmod behind', !/^\s*<lastmod>/m.test(filtered.replace(/<url>[\s\S]*?<\/url>/g, '')));
  ok('the filtered sitemap is still well formed',
    /<\/urlset>\s*$/.test(filtered) && [...filtered.matchAll(/<url>/g)].length === [...filtered.matchAll(/<\/url>/g)].length);
}

// ── a page claims the URL the site links it as ───────────────────────────────
// The invariant that was missing, and the one that caught the last two bugs.
// tools/build-chrome.mjs holds ONE link set and stamps it onto ~150 pages, so it
// is the closest thing the site has to a statement of where each page lives. A
// page whose canonical disagrees with it is a page every one of those links
// points at and its own head disowns — /rankings was linked bare 331 times while
// claiming /in-season/rankings, /vegas-edge 470 times against 5. Internal links
// are the strongest signal there is about which of two serving URLs is the page,
// so the canonical follows the chrome, not the other way round.
console.log('\nevery page claims the URL the chrome links it as');
{
  const chrome = read('tools/build-chrome.mjs');
  const hrefs = [...new Set([...chrome.matchAll(/href: *.(\/[A-Za-z0-9\/_-]*)./g)].map((m) => m[1]))];
  ok('the chrome link set was read', hrefs.length > 20, String(hrefs.length));

  const wrong = [];
  for (const f of pages) {
    const h = read(f);
    if (/<meta name="robots"[^>]*noindex/.test(h)) continue;
    const c = (h.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    if (!c) continue;
    const linkedAs = hrefs.filter((x) => x.replace(/^\//, '') + '.html' === f);
    if (!linkedAs.length) continue;                 // not a page the chrome links
    const claimed = c.replace('https://irontuna.com', '') || '/';
    if (!linkedAs.includes(claimed)) wrong.push(`${f}: linked ${linkedAs.join(',')}, claims ${claimed}`);
  }
  ok('no page is linked as one URL and claims another', wrong.length === 0, wrong.slice(0, 6).join('; '));

  // And nothing links the alias any more. The prefix still SERVES — it is linked
  // from outside and printed in older copy — but no page on this site should
  // send a reader or a crawler to a URL that immediately names a different one.
  const alias = pages.filter((f) => /href="\/in-season\/(rankings|vegas-edge)"/.test(read(f)));
  ok('nothing links the two aliases internally', alias.length === 0, alias.join(', '));

  // /in-season/desk is prefixed on BOTH sides and must stay that way: it is the
  // parent of /in-season/desk/<kind>/<week>, and the chrome links it so.
  ok('the desk keeps its prefixed URL on both sides',
    hrefs.includes('/in-season/desk')
    && read('desk.html').includes('<link rel="canonical" href="https://irontuna.com/in-season/desk">'));
}

// ── the sitemap says what the pages say ──────────────────────────────────────
console.log('\nthe sitemap and the pages agree');
{
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

  ok('no URL is advertised twice', new Set(locs).size === locs.length,
    String(locs.length - new Set(locs).size));

  // THE RULE, and it only runs one way: a canonical is the page's own statement
  // about which address it lives at, so the sitemap follows it. Advertising a
  // URL whose page disowns it in its first ten lines is the /analysts/<id>
  // mistake — eight URLs listed, every one of them canonicalising to /analysts —
  // and it is how /rankings, /desk and /vegas-edge would have been listed too,
  // since all three actually claim /in-season/<name>.
  const disowned = [];
  for (const loc of locs) {
    const f = (loc.replace('https://irontuna.com', '') || '/').replace(/^\//, '') + '.html';
    if (!fs.existsSync(path.join(ROOT, f))) continue;   // a route with no file of its own
    const c = (read(f).match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    if (c !== loc) disowned.push(loc + ' -> ' + c);
  }
  ok('no listed URL is disowned by the page it points at', disowned.length === 0, disowned.slice(0, 6).join(', '));

  // A noindex page in the sitemap is the site asking for a crawl and refusing it
  // in the same breath.
  const contradiction = locs.filter((loc) => {
    const f = (loc.replace('https://irontuna.com', '') || '/').replace(/^\//, '') + '.html';
    return fs.existsSync(path.join(ROOT, f)) && /<meta name="robots"[^>]*noindex/.test(read(f));
  });
  ok('the sitemap advertises nothing that says noindex', contradiction.length === 0, contradiction.slice(0, 6).join(', '));

  // The gate is open, so the section's boards belong in the file. They were left
  // out while it was shut, correctly: the worker served the waiting-list gate's
  // BODY at their URLs, and sixteen addresses for one body is how a site teaches
  // Google it has duplicate content. Both halves of that are pinned here, so
  // whichever way the switch moves the sitemap has to move with it.
  const open = /"POST_DRAFT_OPEN"\s*:\s*"1"/.test(read('wrangler.jsonc'));
  const boards = pages.filter((f) => /^(?:weekly|season-long)-(?:qb|rb|wr|te|flex|k|dst|rankings)/.test(f))
    .map((f) => (read(f).match(/<link rel="canonical" href="([^"]*)"/) || [])[1]);
  const missing = boards.filter((u) => !locs.includes(u));
  if (open) ok('the gate is open, so every rankings board is advertised', missing.length === 0, missing.slice(0, 6).join(', '));
  else ok('the gate is shut, so no rankings board is advertised', missing.length === boards.length, String(boards.length - missing.length));
}

// ── /analysts/<id> ───────────────────────────────────────────────────────────
// Eight URLs served from ONE shell. The shell ships noindex and canonicalises to
// /analysts, because a crawler that does not run JavaScript is handed "Reading
// the desk…" and nothing else — and sitemap.xml advertised all eight anyway.
// _worker.js now rewrites the head and pre-renders the persona header for each,
// which is what makes those eight indexable. Every part of that has to hold
// together, so this lifts the REAL code out of the worker and runs it.
console.log('\n/analysts/<id>');
{
  const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const lift = (a, b) => { const i = src.indexOf(a); return i < 0 ? null : src.slice(i, src.indexOf(b, i) + b.length); };
  const seo = lift('function analystSeo(env, pathname) {', '\n}');
  const hdr = lift('function analystHeader(a) {', '\n}');
  const ld = lift('function analystLd(a, url) {', '\n}');
  const ids = [...(lift('const ANALYSTS = {', '\n};') || '').matchAll(/^  ([a-z]+): \{ id: '([a-z]+)'/gm)].map((m) => m[2]);

  ok('the worker still carries the per-analyst head', !!seo && !!hdr && !!ld);
  ok('the staff table still parses', ids.length === 8, String(ids.length));

  // The shell must stay noindex ON DISK. It is what /analysts/<id> is BUILT
  // from, not what is served there, and if the file itself became indexable the
  // empty shell would be crawlable at /analyst.
  ok('the shell on disk is still noindex', /<meta name="robots" content="noindex">/.test(read('analyst.html')));

  // ...and the worker must still find every tag it rewrites. A head-meta pass
  // that stopped emitting one of these would silently leave the eight URLs
  // wearing the index page's copy again.
  const shell = read('analyst.html');
  const needed = [/<title>/, /<meta name="description" content="/, /<link rel="canonical" href="/,
    /<meta property="og:url" content="/, /<meta property="og:title" content="/,
    /<meta property="og:description" content="/, /<div class="an-head" id="anHead"><\/div>/];
  const gone = needed.filter((re) => !re.test(shell));
  ok('the shell still carries every tag the worker rewrites', gone.length === 0, gone.join(', '));

  // The pre-render must be byte-for-byte what the page's own script writes into
  // #anHead, or hydration repaints the header and the reader sees it flicker.
  const client = (shell.match(/\$\('anHead'\)\.innerHTML = ([\s\S]*?);\n/) || [, ''])[1];
  const shape = /'<span class="an-av">' \+ e\(a\.avatar\) \+ '<\/span><div><h1>' \+ e\(a\.name\) \+ '<\/h1><p>' \+ e\(a\.role\) \+ ' &middot; <span class="dk-ai">AI analyst persona<\/span><\/p><\/div>'/;
  ok('the pre-render matches the markup the page hydrates with', shape.test(client), client.slice(0, 80));

  // The eight URLs are advertised, and the shell's own /analyst is not.
  const xml = read('sitemap.xml');
  const unlisted = ids.filter((id) => !xml.includes('<loc>https://irontuna.com/analysts/' + id + '</loc>'));
  ok('every analyst URL is in the sitemap', unlisted.length === 0, unlisted.join(', '));
  ok('the shell\'s own URL is not', !xml.includes('<loc>https://irontuna.com/analyst</loc>'));

  // These are software, and the markup must not claim otherwise to win a rich
  // result. The page says so in its first paragraph; Person here would be the
  // markup contradicting the disclosure.
  ok('the analyst markup is a ProfilePage, not a Person', /'@type': 'ProfilePage'/.test(ld) && !/'@type': 'Person'/.test(ld));
  ok('and it carries the AI disclosure', ld.includes('AI_DISCLOSURE'));
}

// ── llms.txt ─────────────────────────────────────────────────────────────────
// The site's own description of itself, written for a model rather than a
// browser, and the one robots.txt points at. Its failure mode is silence: a link
// that 404s or points at a URL the page disowns is followed once and dropped,
// and nothing anywhere reports it.
console.log('\nllms.txt');
{
  const txt = read('llms.txt');
  const locs = new Set([...read('sitemap.xml').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]));

  // "/analysts/<id>" is a template, not a link — it is how the file tells a
  // model the shape of the eight per-analyst URLs.
  const links = [...new Set([...txt.matchAll(/https:\/\/irontuna\.com[^\s)\],*]*/g)].map((m) => m[0].replace(/[.,]$/, '')))]
    .filter((u) => !u.includes('<id>'));
  const unknown = links.filter((u) => !locs.has(u) && !locs.has(u.replace(/\/$/, '')));
  ok('every link in llms.txt is a URL the sitemap advertises', unknown.length === 0, unknown.slice(0, 6).join(', '));

  // The disclosure has to travel with the bylines. A model that reads this file
  // and then quotes "Nate Vega" as an analyst has been misled by the file.
  ok('llms.txt says the analysts are software', /not people/.test(txt) && txt.includes('https://irontuna.com/analysts'));
  ok('and says who to attribute a quotation to', /attribute anything from this site to \*\*Iron Tuna\*\*/i.test(txt));

  // robots.txt is where a crawler is told the file exists.
  const robots = read('robots.txt');
  ok('robots.txt points at llms.txt', robots.includes('https://irontuna.com/llms.txt'));
  ok('robots.txt still names the sitemap', robots.includes('Sitemap: https://irontuna.com/sitemap.xml'));

  // The blanket allow is the line that actually governs an unnamed agent; the
  // named blocks below it are a record of a decision. Losing the wildcard while
  // keeping the list would quietly close the site to everything unlisted.
  ok('robots.txt still allows every crawler by default', /User-agent: \*\nAllow: \//.test(robots));

  // Every token, so deleting one is a decision rather than an accident. Verified
  // against vendor documentation on 2026-09-09. "Claude-Web" and "anthropic-ai"
  // are deprecated and must NOT come back: naming a retired agent only dates the
  // file.
  const AGENTS = ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'Google-Extended',
    'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
    'PerplexityBot', 'Perplexity-User', 'Applebot-Extended', 'meta-externalagent', 'Amazonbot',
    'MistralAI-User', 'cohere-ai', 'DuckAssistBot', 'CCBot', 'Bytespider'];
  const absent = AGENTS.filter((a) => !new RegExp('^User-agent: ' + a + '$', 'mi').test(robots));
  ok('robots.txt names every agent it means to', absent.length === 0, absent.join(', '));
  const dead = ['Claude-Web', 'anthropic-ai'].filter((a) => new RegExp('^User-agent: ' + a + '$', 'mi').test(robots));
  ok('and none that its vendor has retired', dead.length === 0, dead.join(', '));

  // THE FOOTGUN, made real. Under RFC 9309 a crawler obeys the most specific
  // group that names it, and that group ENTIRELY — it inherits nothing from the
  // wildcard. So a Disallow added to the wildcard alone is a rule that every one
  // of the ~20 agents above quietly ignores, which is the reverse of what
  // whoever added it wanted. Groups are parsed here rather than grepped, because
  // the question is per-group and a grep cannot answer it.
  const groups = [];
  for (const line of robots.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const ua = t.match(/^User-agent:\s*(.+)$/i);
    if (ua) { groups.push({ agent: ua[1].trim(), rules: [] }); continue; }
    const rule = t.match(/^(Allow|Disallow|Crawl-delay):\s*(.*)$/i);
    if (rule && groups.length) groups[groups.length - 1].rules.push(rule[1].toLowerCase() + ':' + rule[2].trim());
  }
  ok('robots.txt parses into groups', groups.length > 20, String(groups.length));

  const wildcard = groups.find((g) => g.agent === '*');
  ok('there is exactly one wildcard group', groups.filter((g) => g.agent === '*').length === 1);
  const diverged = groups.filter((g) => g.agent !== '*'
    && wildcard.rules.some((r) => !g.rules.includes(r)));
  ok('no named group is missing a rule the wildcard carries',
    diverged.length === 0,
    diverged.slice(0, 4).map((g) => g.agent + ' lacks ' + wildcard.rules.filter((r) => !g.rules.includes(r)).join('+')).join('; '));

  // Every group must actually say something. A "User-agent:" with no rule under
  // it is not a permissive group, it is a group with no directives, and what a
  // crawler does with that is up to the crawler.
  const silent = groups.filter((g) => !g.rules.length);
  ok('every group carries at least one directive', silent.length === 0, silent.map((g) => g.agent).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
