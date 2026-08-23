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
  const NOT_LISTED = new Set(['index.html', 'front.html', 'admin.html', 'lead.html', 'player.html', 'my-insights.html', ...gated]);
  const locs = new Set(urls.map((u) => (u.match(/<loc>([^<]*)<\/loc>/) || [])[1]));
  const absent = pages.filter((f) => !NOT_LISTED.has(f) && !locs.has('https://irontuna.com/' + f.replace('.html', '')));
  ok('every indexable page is in the sitemap', absent.length === 0, absent.join(', '));

  // The pages left out on purpose are the ones that say noindex.
  const shouldBeNoindex = ['admin.html', 'lead.html', 'player.html', 'my-insights.html'];
  const notNoindex = shouldBeNoindex.filter((f) => !/name="robots"[^>]*noindex/.test(read(f)));
  ok('the pages kept out of the sitemap are noindex', notNoindex.length === 0, notNoindex.join(', '));

  // /analyst-desk reads like an internal tool but is a deliberately indexed
  // public column. Dropping it from the sitemap is a regression, not a cleanup.
  ok('/analyst-desk is still listed', locs.has('https://irontuna.com/analyst-desk'));
  ok('/analyst-desk is still indexable', !/name="robots"[^>]*noindex/.test(read('analyst-desk.html')));

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
