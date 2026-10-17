#!/usr/bin/env node
// The homepage, driven in a browser.
//   node tools/test-homepage.mjs
//
// October 2026: "/" is the ledger-style front described in docs/design/brief.md,
// reworked for the first visit on 17 Oct 2026 (docs/growth-plan.md, Phase 3).
// Five sections, in this order: a white centred hero (the promise, one
// sentence, the one primary action, up to three current market-versus-
// consensus examples with a scoring switch, the search field and the other
// tools as plain links), a labelled sample My Week, the six position tiles,
// the five newest desk pieces as story cards (game photographs, credited; a
// thin feed filled from findings) and the three How-it-works cards; then the
// shared footer. The rotating market band, the two lane tiles and the KPI band
// came off with that rework.
//
// The examples and the sample are written into the HTML by the worker, so
// this test serves "/" the way the worker does: front.html through the
// worker's own homePrerender and homeShellFill, over the fixture board in
// tools/fixtures/home-board.mjs (which tools/test-home-examples.mjs pins rule
// by rule). The refusing pass serves the plain shell, as the worker does when
// it has no board.
//
// THE RULE THIS EXISTS FOR, and the one the old page broke constantly: A BAND
// IS EITHER FULL OF REAL CURRENT DATA OR IT IS HIDDEN. So every feed here is
// driven TWICE: once answering with real rows, and once refusing outright. The
// refusing pass is the one that matters, and it asserts the negative directly:
// no loading copy anywhere in the rendered text, and no empty shell.
//
// Needs playwright-core plus a Chromium binary (preinstalled at /opt/pw-browsers
// in Claude Code remote sessions, else set CHROMIUM_PATH, else whatever
// `npx playwright-core install chromium` put in the cache). It skips cleanly
// when they are absent so it never blocks a contributor's machine — EXCEPT
// under REQUIRE_BROWSER=1, which CI sets, where a skip is a failure instead.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRE = process.env.REQUIRE_BROWSER === '1';
function absent(what, fix) {
  if (REQUIRE) {
    console.error('FAIL — ' + what + '. REQUIRE_BROWSER=1, so this is a failure rather than a skip.');
    if (fix) console.error('       ' + fix);
    process.exit(1);
  }
  console.log('SKIP — ' + what + (fix ? ' (' + fix + ')' : ''));
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  absent('needs playwright-core (' + e.message.split('\n')[0] + ')',
         'npm install --no-save --no-package-lock playwright-core@1.56.1');
}
const CHROME = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  (() => { try { return chromium.executablePath(); } catch (e) { return null; } })()
].find(p => p && fs.existsSync(p));
if (!CHROME) absent('no Chromium binary', 'set CHROMIUM_PATH, or run `npx playwright-core install chromium`');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── "/" as the worker serves it ─────────────────────────────────────────────
// front.html with the examples and the sample written in, by the worker's own
// functions, lifted out of _worker.js rather than copied.
const WSRC = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const wlift = (a, b) => { const i = WSRC.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return WSRC.slice(i, WSRC.indexOf(b, i) + b.length); };
const W = new Function([WSRC.slice(WSRC.indexOf('// ── the scoring engine ─'), WSRC.indexOf('const COLUMN_SCORING = {')),
  wlift('const _oddsNorm = ', ';\n'), wlift('const _preEsc = ', ';\n'), wlift('function _etStamp(ms) {', '\n}'),
  WSRC.slice(WSRC.indexOf('const HOME_EX_MAX = 3;'), WSRC.indexOf('function homeShellFill(html, hp) {')), wlift('function homeShellFill(html, hp) {', '\n}')].join('\n')
  + '\nreturn { homePrerender, homeShellFill, _oddsNorm };')();
const SHELL = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
const FILLED = W.homeShellFill(SHELL, W.homePrerender(homeBoard(), homeMarkets(W._oddsNorm)));
if (FILLED === SHELL) throw new Error('the pre-render did not fill the shell');
// Any read of the old market feed is recorded: the homepage must not make one.
const edgeReads = [];
// The board behind the sixteen position pages: who is ranked, who carries a
// market line, and when the odds were read. Counts per position are what the
// tiles print, so each position gets a different, checkable count.
const RANK_N = { QB: 34, RB: 72, WR: 98, TE: 42, K: 32, DEF: 32 };
const RANK_PLAYERS = [];
Object.entries(RANK_N).forEach(([pos, n]) => {
  for (let k = 0; k < n; k++) RANK_PLAYERS.push({ name: pos + ' Player ' + k, position: pos, team: 'T' + (k % 16), priced: k % 3 !== 0 });
});
const RANK = { ok: true, week: { label: 'Week 3', number: 3, type: 'REG', status: 'upcoming' },
  oddsAsOf: Date.UTC(2026, 8, 17, 18, 42), oddsProvider: 'propline', marketBoard: true,
  props: { live: true, season: 2026, week: 3, players: RANK_PLAYERS.filter(p => p.priced).length, asOf: Date.UTC(2026, 8, 17, 18, 42) },
  players: RANK_PLAYERS };
const NOW = Date.now();
const AGO = h => NOW - h * 3600 * 1000;
const CONTENT = { ok: true, pieces: [
  { kind: 'final-read', title: 'The Final Read', headline: 'Three lineups the market moved overnight',
    dek: 'Sunday morning props shifted two flex calls.', week: 3, publishedAt: AGO(0.1),
    url: '/in-season/desk/final-read/3', byline: { name: 'Iron Tuna desk' },
    components: [{ n: 1, player: 'Puka Nacua', headline: 'a' }, { n: 2, player: 'James Cook', headline: 'b' }] },
  { kind: 'opportunity-report', title: 'Opportunity Report', headline: 'Who inherits the carries in Baltimore',
    dek: 'Snap share against the implied total.', week: 3, publishedAt: AGO(3),
    url: '/in-season/desk/opportunity-report/3', byline: { name: 'Iron Tuna desk' },
    components: [{ n: 1, player: 'Derrick Henry', headline: 'c' }] },
  { kind: 'rankings-update', title: 'Rankings Update', headline: 'Eleven moves after the injury report',
    week: 3, publishedAt: AGO(5), url: '/in-season/desk/rankings-update/3' },
  // THE BOAST is split off on a card: the call is the headline.
  { kind: 'scorecard', title: 'What Tuna Got Right', headline: 'YOU’RE WELCOME: the total moved three points in a day',
    week: 3, publishedAt: AGO(18), url: '/in-season/desk/scorecard/3' },
  // No url: not a row.
  { kind: 'broken', title: 'Broken', headline: 'No destination', week: 3, publishedAt: AGO(20) },
  // No headline of its own: not a row either.
  { kind: 'blank', title: 'Blank', week: 3, publishedAt: AGO(21), url: '/in-season/desk/blank/3' },
  { kind: 'weekend-game-plan', title: 'Weekend Game Plan', headline: 'Too many to print',
    week: 3, publishedAt: AGO(24), url: '/in-season/desk/weekend-game-plan/3' },
  { kind: 'waiver-watch', title: 'Waiver Watch', headline: 'Four adds the market already priced in',
    week: 3, publishedAt: AGO(33), url: '/in-season/desk/waiver-watch/3', components: [{ n: 1, player: 'Tank Bigsby', headline: 'e' }] },
  // Seven qualify; six are shown. This one must not be.
  { kind: 'start-sit', title: 'Start/Sit', headline: 'Two starts the consensus is scared of',
    week: 3, publishedAt: AGO(40), url: '/in-season/desk/start-sit/3' }
]};
// What /api/content would hand back: the same story five times over, in draft.
// Nothing on the front may come from here.
const ARCHIVE_POISON = { ok: true, pieces: [1, 2, 3, 4, 5].map(v => ({
  kind: 'weekend-preview', title: 'Weekend Preview', status: 'held', version: v,
  headline: 'HELD DRAFT ' + v + ' — must never reach the front',
  week: 3, publishedAt: NOW, url: '/in-season/desk/weekend-preview/3'
})) };
// Three stories and nothing else: what the feed holds once Sunday's forward
// pieces expire.
const THIN = { ok: true, pieces: [
  { kind: 'trade-desk', title: 'Trade Desk', headline: 'Buy the gap: five players the board prices well below consensus',
    week: 5, publishedAt: AGO(0.4), url: '/in-season/desk/trade-desk/5', byline: { name: 'Rankings Desk' },
    // A player with no game photograph is named first; one with a photograph second.
    components: [{ n: 1, player: 'Tank Bigsby', headline: 'Bigsby is a buy' }, { n: 2, player: 'Dak Prescott', headline: 'Prescott is a buy' }] },
  { kind: 'underrated', title: 'Most Underrated Player', headline: 'Roman Wilson is the most underrated player in Week 5',
    week: 5, publishedAt: AGO(0.6), url: '/in-season/desk/underrated/5', byline: { name: 'Rankings Desk' },
    components: [{ n: 1, headline: 'His target share is up four weeks running' }] },
  { kind: 'week-in-review', title: 'Week 5 in Review', headline: 'Week 5 in review has harder lessons too',
    week: 5, publishedAt: AGO(0.7), url: '/in-season/desk/week-in-review/5', byline: { name: 'Usage Desk' },
    components: [{ n: 1, headline: 'Week 5 in review has harder lessons too' }, { n: 2, player: 'Dak Prescott', headline: 'Flournoy beat his ranking' }] }
]};
// Two pieces as the desk filed them for Week 5 (2026-10-13): no findings, a
// headline that names its players by surname only and writes them out in the
// dek, and a headline and dek that name clubs and no player at all.
const UNNAMED = { ok: true, pieces: [
  { kind: 'quarterback-monday', title: 'Quarterback Monday', headline: 'Week 6 quarterback intel: five weeks of data say start Stafford and love Love',
    dek: 'Matthew Stafford is Iron Tuna QB2 against ARI at home; Jordan Love is Iron Tuna QB6 against DAL at home.',
    week: 5, publishedAt: AGO(0.2), url: '/in-season/desk/quarterback-monday/5', byline: { name: 'Quarterback Desk' }, components: null },
  { kind: 'what-sunday-taught-us', title: 'What Sunday Taught Us', headline: 'What Week 5 taught us about Week 6: three roles locked, three fades confirmed',
    dek: 'Five weeks of data have settled the JAX target hierarchy, the NYJ backfield, and the PHI injury math.',
    week: 5, publishedAt: AGO(0.3), url: '/in-season/desk/what-sunday-taught-us/5', byline: { name: 'Editorial Desk' }, components: null },
  { kind: 'rankings-update', title: 'Rankings Update', headline: 'Eleven moves after the injury report',
    dek: 'No club and no player.', week: 5, publishedAt: AGO(0.4), url: '/in-season/desk/rankings-update/5' }
]};
const SEASON = { ok: true, phase: 'regular', phaseLabel: 'Regular season',
  week: { label: 'Week 3', status: 'upcoming', firstKickoff: Date.UTC(2026, 8, 17, 20, 15) }, counts: { inProgress: 0 } };

// `live` is the answering pass; `dead` refuses every feed the way an outage or
// a quiet Wednesday does.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let MODE = 'live';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let body = { ok: false, error: 'unavailable' };
    if (u.pathname === '/api/vegas-edge') edgeReads.push(MODE);
    if (MODE === 'live') {
      if (u.pathname === '/api/rankings') body = RANK;
      else if (u.pathname === '/api/newsroom') body = CONTENT;
      else if (u.pathname === '/api/content') body = ARCHIVE_POISON;
      else if (u.pathname === '/api/season') body = SEASON;
    } else if (MODE === 'noboard') {
      // The worker with nothing in this week's prop store: the board answers,
      // but with no book quoting anyone every row comes back unpriced.
      if (u.pathname === '/api/rankings') body = { ...RANK, marketBoard: false, oddsAsOf: null, oddsProvider: null,
        props: { live: false, season: 2026, week: 3, players: 0, asOf: null }, players: RANK_PLAYERS.map(p => ({ ...p, priced: false })) };
      else if (u.pathname === '/api/newsroom') body = CONTENT;
      else if (u.pathname === '/api/content') body = ARCHIVE_POISON;
      else if (u.pathname === '/api/season') body = SEASON;
    } else if (MODE === 'thin' || MODE === 'unnamed') {
      if (u.pathname === '/api/newsroom') body = MODE === 'thin' ? THIN : UNNAMED;
      else if (u.pathname === '/api/content') body = ARCHIVE_POISON;
      else if (u.pathname === '/api/season') body = SEASON;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  // "/" is the filled page, except in the refusing pass, where the worker had
  // no board to fill it from and served the shell.
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(MODE === 'dead' ? SHELL : FILLED); }
  const fp = path.join(ROOT, u.pathname.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
const photos = [];
async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${width}px: ${e.message}`));
  // The Commons photographs answer with a real (one-pixel) image, so the card
  // that has one can be seen printing its credit; every other host refuses.
  await page.route(/wikimedia\.org/, r => { photos.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }); });
  await page.route(/espncdn\.com|static\.www\.nfl\.com|googletagmanager\.com/, r => { photos.push(r.request().url()); return r.abort(); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { page, ctx };
}

const LOADING = /Reading the board|Reading the market|Reading the desk|Reading the slate|Reading today|Waiting for this week|Loading the current case|Coming soon|Loading…/i;
const read = page => page.evaluate(() => {
  const vis = e => !!e && e.getClientRects().length > 0;
  const byId = id => document.getElementById(id);
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const px = el => el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  const h1 = document.querySelector('h1');
  const find = document.querySelector('form[role="search"]');
  const input = find && find.querySelector('input[name="q"]');
  return {
    h1: text(h1), h1Px: px(h1), h1Drawn: vis(h1), h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
    h1Centered: h1 ? Math.abs((h1.getBoundingClientRect().left + h1.getBoundingClientRect().right) / 2 - innerWidth / 2) < 4 : false,
    lede: text(document.querySelector('.hm-lede')), ledePx: px(document.querySelector('.hm-lede')),
    ledeW: (() => { const e = document.querySelector('.hm-lede'); return e ? e.getBoundingClientRect().width / px(e) : 0; })(),
    find: !!find && find.getAttribute('action') === '/player' && (find.getAttribute('method') || 'get').toLowerCase() === 'get',
    findInput: input ? { search: input.getAttribute('data-player-search'), role: input.getAttribute('role'), ph: input.getAttribute('placeholder') || '',
      h: input.closest('.search-field') ? input.closest('.search-field').getBoundingClientRect().height : 0,
      radius: input.closest('.search-field') ? parseFloat(getComputedStyle(input.closest('.search-field')).borderTopLeftRadius) : 0 } : null,
    primary: [...document.querySelectorAll('a.hm-primary')].filter(vis).map(a => ({ href: a.getAttribute('href'), text: text(a), surface: a.getAttribute('data-it-surface'),
      top: Math.round(a.getBoundingClientRect().top), bg: getComputedStyle(a).backgroundColor })),
    more: [...document.querySelectorAll('.hm-more a')].filter(vis).map(a => a.getAttribute('href')),
    // The header chrome, shared with every other page.
    line: text(document.querySelector('.site-line')),
    lineH: document.querySelector('.site-line') ? document.querySelector('.site-line').getBoundingClientRect().height : null,
    nav: [...document.querySelectorAll('header.site .nav a:not(.nav-dd-menu a)')].map(a => a.getAttribute('href')),
    cta: (() => { const c = document.querySelector('header.site a.cta'); return c ? { href: c.getAttribute('href'), text: c.textContent.trim(), shown: vis(c) } : null; })(),
    tabbar: [...document.querySelectorAll('.tabbar a')].filter(vis).map(a => a.getAttribute('href')),
    toggle: (() => { const b = document.querySelector('header.site .nav-toggle'); return b && vis(b) ? b.getAttribute('aria-controls') : null; })(),
    ribbonH: (() => { const r = document.querySelector('header.site > .wrap'); return r ? Math.round(r.getBoundingClientRect().height) : 0; })(),
    // The examples, written in by the worker.
    examples: vis(byId('hmExamples')),
    exTop: byId('hmExamples') && vis(byId('hmExamples')) ? Math.round(byId('hmExamples').getBoundingClientRect().top) : null,
    score: [...document.querySelectorAll('#hmScore button')].filter(vis).map(b => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true' })),
    exShown: [...document.querySelectorAll('#hmExSets .hm-ex-list')].filter(vis).map(l => l.getAttribute('data-scoring')),
    cards: [...document.querySelectorAll('#hmExSets .hm-ex-list:not([hidden]) .hm-ex')].map(c => ({
      name: text(c.querySelector('.hm-ex-who b')), href: c.querySelector('.hm-ex-who a').getAttribute('href'), surface: c.querySelector('.hm-ex-who a').getAttribute('data-it-surface'),
      who: text(c.querySelector('.hm-ex-who span')), gap: text(c.querySelector('.hm-ex-gap')), good: c.querySelector('.hm-ex-gap').classList.contains('good'),
      color: getComputedStyle(c.querySelector('.hm-ex-gap')).color, nums: text(c.querySelector('.hm-ex-nums')), lab: text(c.querySelector('.hm-ex-lab')), why: text(c.querySelector('.hm-ex-why')),
      tags: [...c.querySelectorAll('.hm-tag')].map(t => ({ t: t.textContent.trim(), px: px(t), bg: getComputedStyle(t).backgroundColor })),
      left: Math.round(c.getBoundingClientRect().left), top: Math.round(c.getBoundingClientRect().top) })),
    asOf: vis(byId('hmExAsOf')) ? text(byId('hmExAsOf')) : null,
    // The sample My Week.
    sample: vis(byId('sample')),
    sampleHead: text(document.querySelector('#sampleHead')),
    sampleSub: text(document.querySelector('#sample .hm-sub')),
    sampleShown: [...document.querySelectorAll('#hmMwSets .hm-mw-set')].filter(vis).map(l => l.getAttribute('data-scoring')),
    sampleCards: [...document.querySelectorAll('#hmMwSets .hm-mw-set:not([hidden]) .hm-mw-dec')].map(d => d.innerText.replace(/\s+/g, ' ').trim()),
    sampleCta: (() => { const a = document.querySelector('#sample .hm-how-more a'); return a ? { href: a.getAttribute('href'), surface: a.getAttribute('data-it-surface') } : null; })(),
    // The tiles.
    tiles: [...document.querySelectorAll('.hm-tile')].map(a => ({ href: a.getAttribute('href'), name: text(a.querySelector('.hm-tile-name')),
      live: vis(a.querySelector('.hm-tile-live')) ? text(a.querySelector('.hm-tile-live')) : null, svg: !!a.querySelector('svg[aria-hidden="true"]'),
      w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) })),
    tileTops: [...new Set([...document.querySelectorAll('.hm-tile')].map(a => Math.round(a.getBoundingClientRect().top)))].length,
    // The story cards.
    articles: vis(byId('articles')),
    rows: [...document.querySelectorAll('#readGrid .hm-story')].map(r => {
      const pic = r.querySelector('.hm-story-pic'), pb = pic.getBoundingClientRect(), tb = r.querySelector('.hm-story-txt').getBoundingClientRect(), b = r.getBoundingClientRect();
      const link = r.querySelector('a.hm-story-head'), credit = r.querySelector('.hm-story-credit');
      return { href: link && link.getAttribute('href'), tag: r.tagName, action: pic.classList.contains('is-action'),
        credit: credit && vis(credit) ? { text: text(credit), links: [...credit.querySelectorAll('a')].map(a => a.getAttribute('href')) } : null,
        lead: r.classList.contains('lead'), name: text(r.querySelector('.hm-story-head')), meta: text(r.querySelector('.hm-story-meta')),
        series: text(r.querySelector('.hm-story-chip')), face: pic.getAttribute('data-face-name'), team: pic.getAttribute('data-face-team'), headPx: px(r.querySelector('.hm-story-head')),
        picLeft: pb.right <= tb.left + 1, picTop: pb.bottom <= tb.top + 1, top: Math.round(b.top), w: Math.round(b.width), radius: parseFloat(getComputedStyle(r).borderTopLeftRadius), shadow: getComputedStyle(r).boxShadow };
    }),
    // How it works.
    how: vis(byId('how')),
    howCards: [...document.querySelectorAll('#how .hm-input')].map(c => ({ h: text(c.querySelector('h3')), radius: parseFloat(getComputedStyle(c).borderTopLeftRadius), border: getComputedStyle(c).borderTopWidth })),
    tagline: text(document.querySelector('#how .hm-tagline')),
    italics: [...document.querySelectorAll('body *')].filter(e => vis(e) && getComputedStyle(e).fontStyle === 'italic' && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).length,
    footBg: getComputedStyle(document.querySelector('footer.site')).backgroundColor,
    // Section order, top to bottom: the page's whole outline.
    order: [...document.querySelectorAll('section')].filter(vis).map(s => s.id || s.className).filter(Boolean),
    allSections: [...document.querySelectorAll('section')].map(s => s.id),
    // The type system: one family, three weights, the scale.
    type: (() => {
      const weights = new Set(), sizes = new Set(), odd = [];
      for (const e of document.querySelectorAll('body *')) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH)$/i.test(e.tagName) || !e.getClientRects().length) continue;
        if (e.closest('[aria-hidden="true"],.sr-only')) continue;
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden') continue;
        weights.add(cs.fontWeight); sizes.add(parseFloat(cs.fontSize));
        if (!/^(400|600|700)$/.test(cs.fontWeight) && odd.length < 5) odd.push(e.tagName + '.' + e.className + ':' + cs.fontWeight);
      }
      return { weights: [...weights], sizes: [...sizes].sort((a, b) => a - b), odd, family: getComputedStyle(document.body).fontFamily };
    })(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.innerText,
    headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ':' + h.textContent.trim().slice(0, 40)),
    // The desk's story cards are the one exception: they lift off the paper.
    shadows: [...document.querySelectorAll('main *')].filter(e => vis(e) && !e.classList.contains('hm-story') && getComputedStyle(e).boxShadow !== 'none').map(e => e.className || e.tagName).slice(0, 5),
    pills: [...document.querySelectorAll('a, button')].filter(e => vis(e) && parseFloat(getComputedStyle(e).borderTopLeftRadius) > 10).map(e => e.className || e.tagName).slice(0, 5)
  };
});

// The scale the brief fixes: 12 is the disclosure label alone, and 17 is the
// ledger's figure (a 13px label over a 17px figure) and nothing else.
const SCALE = new Set([12, 13, 14, 16, 17, 19, 23, 28, 34, 44, 56, 68]);

// ── 1. the hero, at both widths ─────────────────────────────────────────────
console.log('\nthe hero, at every width');
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const { page, ctx } = await open(w, h);
  const r = await read(page);
  ok(`${tag}: the one h1 is the promise`, r.h1 === 'Where the betting market and fantasy consensus disagree.', r.h1);
  // 34px on a phone is what holds the headline to two lines there.
  const h1Min = w > 480 ? 44 : 34;
  ok(`${tag}: it is drawn, centred, at ${h1Min} to 68px, 700`, r.h1Drawn && r.h1Centered && r.h1Px >= h1Min && r.h1Px <= 68 && r.h1Weight === '700', `${r.h1Px}px ${r.h1Weight} centred=${r.h1Centered}`);
  ok(`${tag}: one sentence under it, 19px, inside the measure`,
     /^Sportsbook player props become fantasy points and sit beside the consensus projection/.test(r.lede || '') && r.ledePx === 19 && r.ledeW <= 60, `${r.ledePx}px ${r.ledeW.toFixed(1)}ch`);
  ok(`${tag}: one primary action, to the differences board, filled in the accent`,
     r.primary.length === 1 && r.primary[0].href === '/vegas-edge#board' && r.primary[0].text === 'See this week’s differences' && r.primary[0].surface === 'home_primary' && r.primary[0].bg === 'rgb(11, 79, 108)', JSON.stringify(r.primary));
  ok(`${tag}: the examples come right after it, above the search field`, r.examples && r.exTop > r.primary[0].top, String(r.exTop));
  ok(`${tag}: the search field is a real form posting ?q= to /player`, r.find === true);
  ok(`${tag}: with the shared lookup on its input and a placeholder that says what to type`,
     !!r.findInput && r.findInput.search === 'front' && r.findInput.role === 'combobox' && /player/i.test(r.findInput.ph), JSON.stringify(r.findInput));
  ok(`${tag}: and it is the one pill on the page, 52px tall`, !!r.findInput && r.findInput.h >= 52 && r.findInput.radius > 20 && r.pills.length === 0, JSON.stringify({ h: r.findInput && r.findInput.h, pills: r.pills }));
  ok(`${tag}: the other tools are secondary navigation, plain links`, r.more.join(' ') === '/rankings /fantasy#startsit /waivers /trade-finder /dfs /in-season/desk', r.more.join(' '));
  // The chrome is the shared one.
  ok(`${tag}: the black bar above the ribbon carries no text`, r.line === '', r.line);
  ok(`${tag}: the navy bar above the ribbon is 3px`, r.lineH === 3, String(r.lineH));
  // 60px above 860px and 44px on a phone since the evening of 2026-10-10, when
  // the mark was halved and the bar cut with it (95 and 53 before).
  ok(`${tag}: the ribbon is ${w > 860 ? 60 : 44}px`, r.ribbonH === (w > 860 ? 60 : 44), r.ribbonH + 'px');
  ok(`${tag}: the nav is the shared five`, r.nav.join(',') === '/fantasy,/dfs,/in-season/desk,/faq#faq-start,/player', r.nav.join(','));
  if (w > 860) {
    ok(`${tag}: the one header button customizes the league`, !!r.cta && r.cta.shown && r.cta.href === '/my-league#settings' && r.cta.text === 'Customize My League', JSON.stringify(r.cta));
    ok(`${tag}: no tab bar`, r.tabbar.length === 0);
  } else {
    ok(`${tag}: the top bar is the logo and Menu`, r.toggle === 'sitenav' && !!r.cta && !r.cta.shown, JSON.stringify({ toggle: r.toggle, cta: r.cta }));
    ok(`${tag}: the bottom tab bar has four tabs, the league form among them`, r.tabbar.length === 4 && r.tabbar.includes('/my-league#settings'), r.tabbar.join(','));
  }
  ok(`${tag}: the page is set in Geist`, /^\s*["']?Geist\b/.test(r.type.family), r.type.family);
  ok(`${tag}: every line of text is at 400, 600 or 700`, r.type.odd.length === 0, r.type.odd.join(', '));
  ok(`${tag}: every size is on the scale`, r.type.sizes.every(s => SCALE.has(Math.round(s))), r.type.sizes.join(' '));
  ok(`${tag}: nothing is italic`, r.italics === 0, String(r.italics));
  ok(`${tag}: nothing but the story cards casts a shadow`, r.shadows.length === 0, r.shadows.join(','));
  ok(`${tag}: the page does not scroll sideways`, r.overflow === 0, String(r.overflow));
  ok(`${tag}: there is exactly one h1`, r.headings.filter(x => x.startsWith('H1:')).length === 1);
  await ctx.close();
}

// ── 2. the outline ──────────────────────────────────────────────────────────
console.log('\nfive sections, in order, and nothing else');
{
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('hero, sample, tiles, newest, method', r.allSections.join(' > ') === 'heroBand > sample > positions > articles > how', r.allSections.join(' > '));
  ok('the examples live inside the hero, not as a section of their own', !!(await page.$('#heroBand #hmExamples')));
  ok('no lane tiles and no KPI band compete with the primary action', !(await page.$('#lanes')) && !(await page.$('#kpi')) && !(await page.$('.hm-lane')));
  ok('six tiles, one per position, each opening the one rankings page on that position',
     r.tiles.map(t => t.href).join(' ') === '/position#pos=QB /position#pos=RB /position#pos=WR /position#pos=TE /position#pos=K /position#pos=DST', r.tiles.map(t => t.href).join(' '));
  ok('each tile is portrait, with its own illustration', r.tiles.every(t => t.svg && t.h > t.w), JSON.stringify(r.tiles.map(t => [t.w, t.h])));
  ok('on one row', r.tileTops === 1, String(r.tileTops));
  ok('three How-it-works cards, outlined and rounded', r.howCards.length === 3 && r.howCards.every(c => c.radius === 10 && c.border === '1px'), JSON.stringify(r.howCards));
  ok('the tagline stands in roman under the method head', r.tagline === 'Anyone can publish a projection. Vegas has money on theirs.', r.tagline);
  ok('the footer is navy', r.footBg === 'rgb(0, 30, 71)', r.footBg);
  await ctx.close();
}

// ── 3. the live pass ────────────────────────────────────────────────────────
console.log('\nwith the boards answering');
{
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('the examples are shown', r.examples === true);
  ok('three cards, widest gap first, at PPR', r.cards.map(c => c.name + ' ' + c.gap).join(' | ') === 'Drake London +5.0 pts | Derrick Henry \u22124.8 pts | Goal Line Back +3.8 pts', r.cards.map(c => c.name + ' ' + c.gap).join(' | '));
  ok('PPR is pressed and only its list shows', r.score.map(b => b.t + (b.on ? '*' : '')).join(' ') === 'PPR* Half PPR Standard' && r.exShown.join() === 'ppr', JSON.stringify([r.score, r.exShown]));
  ok('each card names the player, his position, club and fixture, and the kickoff',
     r.cards[0].who.startsWith('WR ATL vs CAR · Sun, 10/18, 1:00 PM ET') && r.cards[1].who.startsWith('RB BAL at CIN'), r.cards.map(c => c.who).join(' / '));
  ok('and links him to his page, marked as the examples surface', r.cards.every(c => /^\/player\/[a-z-]+$/.test(c.href) && c.surface === 'home_examples'), JSON.stringify(r.cards.map(c => c.href)));
  ok('both projections, with the week and the scoring', r.cards.every(c => /^Market \d+\.\d · consensus \d+\.\d Week 6, PPR$/.test(c.nums)), r.cards.map(c => c.nums).join(' / '));
  ok('the market points labelled a derived estimate, the line labelled a quoted prop',
     r.cards.every(c => c.tags.map(t => t.t).join() === 'Derived estimate,Quoted prop' && c.tags.every(t => t.px === 12)), JSON.stringify(r.cards.map(c => c.tags)));
  ok('the two labels look different: amber for the estimate, the accent tint for the quote',
     r.cards[0].tags[0].bg === 'rgb(255, 242, 199)' && r.cards[0].tags[1].bg === 'rgb(230, 239, 243)', JSON.stringify(r.cards[0].tags));
  ok('the explanation is the quoted line, with when it was seen',
     r.cards[0].why === 'Quoted prop Books quote 89.5 receiving yards; the consensus projects 60. Line last seen Sat, 10/17, 12:40 PM ET.', r.cards[0].why);
  ok('only a positive gap is green, and a fade is ink',
     r.cards[0].good && r.cards[0].color === 'rgb(10, 106, 76)' && !r.cards[1].good && r.cards[1].color === 'rgb(17, 20, 24)', JSON.stringify(r.cards.map(c => [c.gap, c.color])));
  ok('the three sit side by side on a desk', new Set(r.cards.map(c => c.top)).size === 1 && new Set(r.cards.map(c => c.left)).size === 3, JSON.stringify(r.cards.map(c => [c.left, c.top])));
  ok('the as-of line: the week, when the board was computed, when the odds were read',
     r.asOf === 'Week 6 · board computed Sat, 10/17, 2:13 PM ET · market points priced off odds read Sat, 10/17, 7:00 AM ET.', r.asOf);
  ok('no player the rules exclude is on the page', !/Questionable Runner|Priced Out|Partly Priced|Game Lines Only|Promoted Backup|Kicked Off|Bye Week|Deep Bench|No Quoted Line/.test(r.body));
  ok('the homepage made no read of /api/vegas-edge', edgeReads.length === 0, edgeReads.join(','));

  ok('the sample My Week is shown, labelled a sample in its heading', r.sample === true && r.sampleHead === 'My Week, with a league Sample', r.sampleHead);
  ok('and the sentence under it says the roster is made up and not saved', /^A made-up roster of real players/.test(r.sampleSub || '') && /not your league, and nothing here is saved/.test(r.sampleSub || ''), r.sampleSub);
  ok('a flex call, a market alert, and pickups deferred to a saved league',
     r.sampleCards.length === 3 && /^Flex decision · Week 6, PPR Start Flex Filler 29 .*24\.2 over Flex Filler 34 .*23\.2/i.test(r.sampleCards[0])
       && /^Market alert Drake London/i.test(r.sampleCards[1]) && /Books project 16\.0 points against a consensus of 11\.0/.test(r.sampleCards[1])
       && /^Pickups Shown once your league’s rosters are saved/i.test(r.sampleCards[2]), JSON.stringify(r.sampleCards));
  ok('its action sets up My Week, marked as the sample surface', r.sampleCta && r.sampleCta.href === '/my-leagues#connect' && r.sampleCta.surface === 'home_sample', JSON.stringify(r.sampleCta));

  ok('every tile carries its live line off the board',
     r.tiles.map(t => t.live).join(' | ') === '34 ranked · 22 priced | 72 ranked · 48 priced | 98 ranked · 65 priced | 42 ranked · 28 priced | 32 ranked · 21 priced | 32 ranked · 21 priced',
     r.tiles.map(t => t.live).join(' | '));

  ok('the newest stories are shown', r.articles === true);
  ok('five cards, newest first', r.rows.length === 5 && r.rows.map(x => x.href).join(' ') === '/in-season/desk/final-read/3 /in-season/desk/opportunity-report/3 /in-season/desk/rankings-update/3 /in-season/desk/scorecard/3 /in-season/desk/weekend-game-plan/3',
     r.rows.map(x => x.href).join(' '));
  ok('a piece without a destination or a headline is not a card', !r.rows.some(x => /No destination|Blank/.test(x.name + x.series)));
  ok('the boast comes off the headline on a card', r.rows[3] && r.rows[3].name === 'the total moved three points in a day', r.rows[3] && r.rows[3].name);
  ok('the newest is the lead: photograph left, headline right, 28px',
     r.rows[0].lead && r.rows[0].picLeft && r.rows[0].headPx === 28 && r.rows.filter(x => x.lead).length === 1, JSON.stringify(r.rows[0]));
  ok('the next four sit in one row under it, photograph on top, rounded 10px',
     r.rows.slice(1).every(x => !x.lead && x.picTop && x.top > r.rows[0].top && x.radius === 10) && new Set(r.rows.slice(1).map(x => x.top)).size === 1,
     JSON.stringify(r.rows.slice(1).map(x => [x.top, x.picTop])));
  ok('every card casts a soft shadow, like the reference row', r.rows.every(x => x.shadow && x.shadow !== 'none'), r.rows.map(x => x.shadow).join(' | '));
  ok('each card names its time and byline at the foot',
     r.rows[0].meta === '6m ago · Iron Tuna desk' && r.rows[4].meta === 'Yesterday', r.rows.map(x => x.meta).join(' / '));
  // The desk's photographs are lazy, and the examples and the sample sit
  // above it, so at 900px the row under the lead starts below the fold.
  // Bring the desk into view, as a reader scrolling to it would, and read it
  // again before asking which photographs loaded.
  await page.evaluate(() => document.querySelector('#readGrid').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  r.rows = (await read(page)).rows;
  ok('the photograph is the first player the piece names; none when it names nobody',
     r.rows[0].face === 'Puka Nacua' && r.rows[1].face === 'Derrick Henry' && r.rows[2].face === null, r.rows.map(x => x.face).join(','));
  ok('a player with a game photograph on file gets the game photograph, not his headshot',
     r.rows[0].action && r.rows[1].action && photos.some(u => /wikimedia\.org/.test(u)), JSON.stringify(r.rows.map(x => x.action)));
  ok('and the card prints the credit its license requires: photographer, license, links to both',
     r.rows[0].credit && /^Photo: .+, CC BY/.test(r.rows[0].credit.text) && /via Wikimedia Commons/.test(r.rows[0].credit.text)
       && r.rows[0].credit.links.length === 2 && r.rows[0].credit.links.every(h => /^https:\/\//.test(h)), JSON.stringify(r.rows[0].credit));
  ok('a card with no photograph prints no credit', r.rows[2].credit === null, JSON.stringify(r.rows[2].credit));
  // The headline's link covers the card: a click in the photograph lands on
  // it. Each card is scrolled into view first; a point off screen hits nothing.
  const covers = await page.evaluate(() => [...document.querySelectorAll('#readGrid .hm-story')].map(r => {
    r.scrollIntoView({ block: 'center' });
    const pb = r.querySelector('.hm-story-pic').getBoundingClientRect(), link = r.querySelector('a.hm-story-head');
    const hit = document.elementFromPoint(pb.left + pb.width / 2, pb.top + pb.height / 2);
    return !!hit && !!link && (hit === link || link.contains(hit));
  }));
  ok('a card is an article whose headline link covers it, so the credit links are not nested in a link',
     r.rows.every(x => x.tag === 'ARTICLE') && covers.every(Boolean), JSON.stringify([r.rows.map(x => x.tag), covers]));
  ok('no held draft reaches the front', !/HELD DRAFT/.test(r.body), (r.body.match(/HELD DRAFT \d/) || [''])[0]);
  ok('and no story is on the front twice', new Set(r.rows.map(x => x.href)).size === r.rows.length);

  ok('and no loading copy survives anywhere on the page', !LOADING.test(r.body), (r.body.match(LOADING) || [''])[0]);
  await ctx.close();
}

// ── 3a. the scoring switch ──────────────────────────────────────────────────
// The worker wrote a list per preset; the buttons show the one picked, in the
// examples and the sample together, and the browser remembers the choice.
console.log('\nthe scoring switch');
{
  const { page, ctx } = await open(1440, 900);
  await page.click('#hmScore button[data-scoring="standard"]');
  let r = await read(page);
  ok('Standard shows its own list, re-ordered and re-scored', r.exShown.join() === 'standard' && r.cards.map(c => c.name).join(' | ') === 'Derrick Henry | Goal Line Back | Yards Guy', r.cards.map(c => c.name).join(' | '));
  ok('with its own scoring on every card', r.cards.every(c => / Week 6, Standard$/.test(c.nums)), r.cards.map(c => c.nums).join(' / '));
  ok('the button says so', r.score.map(b => b.t + (b.on ? '*' : '')).join(' ') === 'PPR Half PPR Standard*');
  ok('the sample follows, with the same two players re-scored', r.sampleShown.join() === 'standard' && /Week 6, Standard Start Flex Filler 29 .*over Flex Filler 34/i.test(r.sampleCards[0]) && /Derrick Henry/.test(r.sampleCards[1]), JSON.stringify(r.sampleCards));
  const q = await page.evaluate(() => JSON.stringify((window.ITMetricsQ && window.ITMetricsQ.length != null) ? [].slice.call(window.ITMetricsQ) : 'drained'));
  ok('the pick is handed to the metrics queue (a result produced for the reader)', /home_examples/.test(q) || q === '"drained"', q);
  await page.reload({ waitUntil: 'networkidle' });
  r = await read(page);
  ok('a reload keeps the reader\'s scoring', r.exShown.join() === 'standard' && r.sampleShown.join() === 'standard' && r.score.find(b => b.on).t === 'Standard', JSON.stringify([r.exShown, r.score]));
  await page.click('#hmScore button[data-scoring="ppr"]');
  r = await read(page);
  ok('and PPR comes back', r.exShown.join() === 'ppr' && r.cards[0].name === 'Drake London');
  await ctx.close();
}
{
  // A browser whose storage throws still gets the page, at PPR.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`no storage: ${e.message}`));
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await page.route(/espncdn\.com|static\.www\.nfl\.com|googletagmanager\.com|wikimedia\.org/, r => r.abort());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('#hmScore button[data-scoring="half"]');
  const r = await read(page);
  ok('with storage blocked the switch still works', r.exShown.join() === 'half' && r.cards[0].name === 'Derrick Henry', JSON.stringify(r.exShown));
  await ctx.close();
}

// ── 3c. the phone ───────────────────────────────────────────────────────────
console.log('\non a phone');
{
  const { page, ctx } = await open(390, 844);
  const r = await read(page);
  const row = await page.evaluate(() => {
    const ul = document.querySelector('.hm-tiles'), first = document.querySelector('.hm-tiles li');
    const cs = getComputedStyle(ul);
    return { scrolls: cs.overflowX === 'auto' && ul.scrollWidth > ul.clientWidth, left: Math.round(first.getBoundingClientRect().left),
      ulLeft: Math.round(ul.getBoundingClientRect().left), exStacked: new Set([...document.querySelectorAll('#hmExSets .hm-ex-list:not([hidden]) .hm-ex')].map(f => Math.round(f.getBoundingClientRect().left))).size,
      tab: (() => { const t = document.querySelector('.tabbar'); const b = t.getBoundingClientRect(); return { h: Math.round(b.height), bottom: Math.round(b.bottom), fixed: getComputedStyle(t).position }; })() };
  });
  ok('the tile row scrolls sideways, edge to edge, with the first tile on the gutter', row.scrolls && row.ulLeft === 0 && row.left === 16, JSON.stringify(row));
  ok('the examples stack, one per row', row.exStacked === 1 && r.cards.length === 3, String(row.exStacked));
  ok('the sample stacks too', r.sample && r.sampleCards.length === 3);
  ok('the tab bar is fixed to the foot of the screen, 68px', row.tab.fixed === 'fixed' && row.tab.h === 68 && row.tab.bottom === 844, JSON.stringify(row.tab));
  ok('the lead stacks its photograph on top, and the four cards go two across',
     r.rows.length === 5 && r.rows[0].picTop && new Set(r.rows.slice(1).map(x => x.top)).size === 2 && r.rows.slice(1).every(x => x.w < 200), JSON.stringify(r.rows.map(x => [x.top, x.w])));
  ok('and the page does not scroll sideways', r.overflow === 0, String(r.overflow));
  await ctx.close();
}

// ── 3d. the phone menu ──────────────────────────────────────────────────────
console.log('\nthe phone menu');
{
  const { page, ctx } = await open(390, 844);
  const m = () => page.evaluate(() => {
    const b = document.querySelector('header.site .nav-toggle');
    const links = [...document.querySelectorAll('header.site .nav a')];
    return { expanded: b && b.getAttribute('aria-expanded'), controls: b && b.getAttribute('aria-controls'),
      shown: links.filter(a => { if (!a.getClientRects().length) return false; const r = a.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44; }).map(a => a.textContent.trim()),
      focusOnButton: document.activeElement === b };
  });
  let r = await m();
  ok('closed, it draws none of the links', r.expanded === 'false' && r.shown.length === 0 && r.controls === 'sitenav', JSON.stringify(r));
  await page.click('header.site .nav-toggle');
  r = await m();
  ok('open, it says so and shows all five as full rows', r.expanded === 'true' && r.shown.join('|') === 'Fantasy|DFS|Articles|How It Works|Search', JSON.stringify(r));
  await page.keyboard.press('Escape');
  r = await m();
  ok('Escape closes it and hands focus back to the button', r.expanded === 'false' && r.shown.length === 0 && r.focusOnButton, JSON.stringify(r));
  await page.click('header.site .nav-toggle');
  await page.evaluate(() => document.querySelector('#how').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  r = await m();
  ok('and a tap outside closes it too', r.expanded === 'false' && r.shown.length === 0, JSON.stringify(r));
  await ctx.close();
}

// ── 3e. keyboard focus ──────────────────────────────────────────────────────
console.log('\nkeyboard focus');
{
  const { page, ctx } = await open(1440, 900);
  const rings = [];
  for (const sel of ['header.site .nav a', 'a.hm-primary', '#hmScore button', '#hmExSets a', '.hm-more a', '#sample .hm-how-more a', '.hm-tile', '#readGrid a', '#how .hm-how-more a', '.foot-nav a']) {
    rings.push(await page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; e.focus(); const cs = getComputedStyle(e);
      return { sel, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; }, sel));
  }
  ok('a 3px ring shows on a control in every section', rings.every(r => r && r.style !== 'none' && r.width >= 3), JSON.stringify(rings));
  // The search field takes the input's own focus treatment: the accent border
  // and a 3px tint ring on the whole field, not an outline on the bare input.
  const field = await page.evaluate(() => { const i = document.getElementById('hmFind'); i.focus(); const cs = getComputedStyle(i.closest('.search-field'));
    return { border: cs.borderTopColor, shadow: cs.boxShadow }; });
  ok('the search field shows the accent border and the tint ring on focus', field.border === 'rgb(11, 79, 108)' && /3px/.test(field.shadow), JSON.stringify(field));
  await ctx.close();
}

// ── 3f. a thin feed ─────────────────────────────────────────────────────────
// Once the forward pieces expire the feed can hold three stories. The empty
// slots take the findings of the stories already listed, each linking to its
// finding on the piece, so the row is never left with holes in it.
console.log('\na thin feed');
MODE = 'thin';
{
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('three stories fill all five cards, the extra two from their findings',
     r.rows.length === 5 && r.rows.slice(0, 3).map(x => x.href).join(' ') === '/in-season/desk/trade-desk/5 /in-season/desk/underrated/5 /in-season/desk/week-in-review/5'
       && r.rows.slice(3).map(x => x.href).join(' ') === '/in-season/desk/underrated/5#component-1 /in-season/desk/week-in-review/5#component-2',
     r.rows.map(x => x.href).join(' '));
  ok('a finding card carries its own headline and its story\'s series and byline',
     r.rows[3].name === 'His target share is up four weeks running' && r.rows[3].series === 'Most Underrated Player' && /Rankings Desk/.test(r.rows[3].meta), JSON.stringify(r.rows[3]));
  ok('a finding that only repeats its story\'s headline is skipped', !r.rows.some(x => /#component-1$/.test(x.href) && /week-in-review/.test(x.href)));
  ok('a piece whose findings name nobody takes its picture from the players its headline names',
     r.rows[1].face === 'Roman Wilson', String(r.rows[1].face));
  ok('the lead takes the first player in its cast with a game photograph, not merely the first named',
     r.rows[0].face === 'Dak Prescott' && r.rows[0].action, JSON.stringify([r.rows[0].face, r.rows[0].action]));
  ok('no photograph runs twice in the grid: a finding about the lead\'s player takes a different picture',
     (() => { const shots = r.rows.filter(x => x.action).map(x => x.face); return new Set(shots).size === shots.length; })(), JSON.stringify(r.rows.map(x => [x.face, x.action])));
  ok('four cards in the row under the lead', new Set(r.rows.slice(1).map(x => x.top)).size === 1, JSON.stringify(r.rows.map(x => x.top)));
  await ctx.close();
}
MODE = 'live';

// ── 3f'. pieces whose findings name nobody ─────────────────────────────────
// Quarterback Monday and What Sunday Taught Us reached the front on bare navy
// on 2026-10-13: no findings, surnames only in one headline, clubs only in the
// other. The dek's full names give the first its player; the club the second.
console.log('\npieces whose findings name nobody');
MODE = 'unnamed';
{
  const { page, ctx } = await open(1440, 900);
  let r = await read(page);
  await page.evaluate(() => document.querySelector('#readGrid').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  r = await read(page);
  ok('a headline of surnames takes its player from the full names in the dek, first named first',
     r.rows[0].face === 'Matthew Stafford' && r.rows[0].team === null, JSON.stringify([r.rows[0].face, r.rows[0].team]));
  ok('a piece that names only clubs takes the first club\'s mark',
     r.rows[1].face === null && r.rows[1].team === 'JAX' && photos.some(u => /teamlogos\/nfl\/500\/jax\.png$/.test(u)),
     JSON.stringify([r.rows[1].face, r.rows[1].team]));
  ok('a club\'s mark prints no photo credit', r.rows[1].credit === null, JSON.stringify(r.rows[1].credit));
  ok('a piece that names neither stays on the navy', r.rows[2].face === null && r.rows[2].team === null, JSON.stringify([r.rows[2].face, r.rows[2].team]));
  await ctx.close();
}
MODE = 'live';

// ── 3g. a board with no market behind it ────────────────────────────────────
// When this week's prop store is empty (props.live false) every row is
// unpriced. That zero is not a figure, it is the props not having been read,
// so the tiles drop their priced count rather than printing a 0.
console.log('\na board with no market behind it');
MODE = 'noboard';
{
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('the tiles keep their ranked count and drop the priced one',
     r.tiles.map(t => t.live).join(' | ') === '34 ranked | 72 ranked | 98 ranked | 42 ranked | 32 ranked | 32 ranked', r.tiles.map(t => t.live).join(' | '));
  await ctx.close();
}
MODE = 'live';

// ── 4. the refusing pass: the whole point ───────────────────────────────────
console.log('\nwith every feed refusing');
MODE = 'dead';
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const { page, ctx } = await open(w, h);
  const r = await read(page);
  ok(`${tag}: the page still has its h1 and its search field`, r.h1 === 'Where the betting market and fantasy consensus disagree.' && r.find === true);
  ok(`${tag}: the primary action and the other tools still stand`, r.primary.length === 1 && r.more.length === 6);
  ok(`${tag}: the examples are hidden, not an empty frame`, r.examples === false && r.cards.length === 0 && r.asOf === null);
  ok(`${tag}: the sample is hidden, not empty`, r.sample === false);
  ok(`${tag}: the tiles stay, without a live line`, r.tiles.length === 6 && r.tiles.every(t => t.live === null), r.tiles.map(t => t.live).join(','));
  ok(`${tag}: the story cards are hidden, not empty`, r.articles === false && r.rows.length === 0);
  ok(`${tag}: the method is still there`, r.how === true);
  ok(`${tag}: nowhere on the page says it is loading`, !LOADING.test(r.body), (r.body.match(LOADING) || [''])[0]);
  ok(`${tag}: and it still does not scroll sideways`, r.overflow === 0, String(r.overflow));
  await ctx.close();
}

ok('no page threw', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
