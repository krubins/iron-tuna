#!/usr/bin/env node
// The homepage, driven in a browser.
//   node tools/test-homepage.mjs
//
// October 2026: "/" is the ledger-style front described in docs/design/brief.md.
// Six sections, in this order: a white centred hero (one headline, one
// sentence, the search field, three entry points, a hairline and the row of
// live market figures), the six position tiles, the five newest desk pieces as
// story cards (game photographs, credited; a thin feed filled from findings),
// the two lane tiles (DFS and season long), the three How-it-works cards, and the navy KPI band; then the
// shared footer. The cover rotation, the photograph, the lead story, the two
// lane cards and the quick-links strip all came off with it.
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

// ── the feeds, as the worker actually shapes them ───────────────────────────
// Field for field what _worker.js sends: vsExperts.buys/fades carry the `brief`
// shape (three point figures, a positional ironTunaRank and the marketDelta
// classification), and `opponent` is a bare team key with no home/away flag.
const mk = (name, position, team, opponent, c, v, it, classification, ironTunaRank) => ({
  name, position, team, opponent,
  consensusPoints: c, vegasPoints: v, ironTunaPoints: it, ironTunaRank,
  delta: { points: Math.round((v - c) * 10) / 10, rank: 4, classification }
});
const EDGE = { ok: true, week: 'Week 3', vsExperts: {
  buys: [
    mk('Drake London', 'WR', 'ATL', 'CAR', 12.1, 16.8, 15.2, 'STRONG VEGAS BUY', 14),
    mk('Cam Ward', 'QB', 'TEN', 'IND', 15.2, 19.9, 18.4, 'STRONG VEGAS BUY', 8),
    mk('Tank Bigsby', 'RB', 'JAX', 'HOU', 6.0, 10.4, 9.1, 'STRONG VEGAS BUY', 38),
    mk('James Cook', 'RB', 'BUF', 'NYJ', 13.4, 15.9, 15.0, 'VEGAS LEANS HIGHER', 9),
    // A promoted backup the consensus still projects as a backup: the widest
    // gap on the board, and only a stale line (Tyson Bagent, Week 5, 2026).
    mk('Promoted Backup', 'QB', 'CHI', 'GB', 0.2, 15.3, 11.6, 'STRONG VEGAS BUY', 20)
  ],
  fades: [
    mk('Derrick Henry', 'RB', 'BAL', 'CIN', 17.8, 13.1, 14.6, 'STRONG VEGAS FADE', 11),
    mk('Blake Corum', 'RB', 'LAR', 'SEA', 11.5, 7.0, 8.4, 'STRONG VEGAS FADE', 41),
    // MARKET AGREES is not a disagreement and must never become a figure.
    mk('Agreeable Wideout', 'WR', 'SEA', 'LAR', 12.0, 12.1, 12.0, 'MARKET AGREES', 20),
    // An injured man's gap is the injury report, not a market read, and it is
    // the widest on the board, so it would lead the row (Week 5, 2026: Lamar
    // Jackson at Market 0.0, consensus 18.9). None of these may be a figure.
    { ...mk('Lamar Jackson', 'QB', 'BAL', 'ATL', 18.9, 0, 0, 'STRONG VEGAS FADE', 30), injury: 'Out' },
    { ...mk('Hobbled Runner', 'RB', 'PHI', 'JAX', 16.0, 7.1, 8.0, 'STRONG VEGAS FADE', 6), injury: 'Questionable' },
    { ...mk('Priced Out Wideout', 'WR', 'PHI', 'JAX', 14.0, 3.0, 4.0, 'STRONG VEGAS FADE', 9), marketOut: 'out' },
    mk('Zeroed Tight End', 'TE', 'MIA', 'BUF', 9.0, 0, 0, 'STRONG VEGAS FADE', 20),
    // A designation that says he plays is not an injury.
    { ...mk('Cleared Receiver', 'WR', 'DEN', 'KC', 10.0, 6.0, 7.0, 'STRONG VEGAS FADE', 40), injury: 'Active' },
    // A stale consensus on a promoted backup is no price (Week 5, 2026).
    // It is a buy-side row, so it is checked on the value list.
    // A row with a hole in it is dropped, not printed with a dash.
    { name: 'Holey Wideout', position: 'WR', team: 'NYG', opponent: 'DAL',
      consensusPoints: 11.0, vegasPoints: null, ironTunaPoints: 9.5, ironTunaRank: 30,
      delta: { points: -3.0, rank: -9, classification: 'STRONG VEGAS FADE' } }
  ]
},
// The season-to-date lists: `brief` plus the season average, the games behind
// it and the gap to this week's consensus. Six overperformers, so the list of
// five has to choose, and the widest three are all starters: dealt on the raw
// gap alone, no longshot would make it.
seasonForm: { minGames: 3,
  over: [
    { ...mk('Puka Nacua', 'WR', 'LAR', 'SEA', 18.0, 19.0, 18.6, 'MARKET AGREES', 2), seasonPpg: 26.4, seasonGames: 5, formGap: 8.4 },
    { ...mk('Jahmyr Gibbs', 'RB', 'DET', 'GB', 19.0, 20.0, 19.5, 'MARKET AGREES', 3), seasonPpg: 26.1, seasonGames: 5, formGap: 7.1 },
    { ...mk('Josh Allen', 'QB', 'BUF', 'NYJ', 22.0, 23.0, 22.5, 'MARKET AGREES', 1), seasonPpg: 28.8, seasonGames: 5, formGap: 6.8 },
    { ...mk('Elite Fourth', 'WR', 'CIN', 'PIT', 15.0, 15.5, 15.2, 'MARKET AGREES', 10), seasonPpg: 21.0, seasonGames: 5, formGap: 6.0 },
    { ...mk('Deep Sleeper', 'WR', 'NO', 'TB', 6.0, 6.5, 6.2, 'MARKET AGREES', 55), seasonPpg: 11.9, seasonGames: 4, formGap: 5.9 },
    { ...mk('Bench Flier', 'RB', 'ARI', 'SF', 5.0, 5.4, 5.1, 'MARKET AGREES', 44), seasonPpg: 9.2, seasonGames: 3, formGap: 4.2 },
    // A season average against a stale backup's line is the promotion, not form.
    { ...mk('Stale Line', 'QB', 'LV', 'NE', 0.6, 14.0, 11.0, 'STRONG VEGAS BUY', 18), seasonPpg: 18.8, seasonGames: 3, formGap: 18.2 },
    // Hurt is not overperforming, and not overvalued either.
    { ...mk('Sidelined Star', 'RB', 'SF', 'ARI', 17.0, 0, 0, 'STRONG VEGAS FADE', 4), seasonPpg: 30.0, seasonGames: 4, formGap: 13.0, injury: 'Out' }
  ],
  under: [
    { ...mk('Tyreek Hill', 'WR', 'MIA', 'BUF', 15.0, 14.0, 14.4, 'MARKET AGREES', 18), seasonPpg: 8.1, seasonGames: 5, formGap: -6.9 },
    { ...mk('Faded Vet', 'RB', 'NYG', 'DAL', 11.0, 10.0, 10.4, 'MARKET AGREES', 33), seasonPpg: 5.5, seasonGames: 5, formGap: -5.5 },
    { ...mk('Slow Starter', 'TE', 'KC', 'LV', 12.0, 11.5, 11.8, 'MARKET AGREES', 6), seasonPpg: 7.4, seasonGames: 5, formGap: -4.6 }
  ]
}};
// The forward pair: the season rows, which Iron Tuna's projection agrees
// with here, plus one hot streak it does not believe (Iron Tuna 15.0 under a
// 16.0 consensus, however high the market has him). The page must drop him
// on its own, and he would lead the list if it did not.
EDGE.seasonForm.likelyOver = [...EDGE.seasonForm.over,
  { ...mk('Tuna Doubts', 'WR', 'DAL', 'NYG', 16.0, 17.5, 15.0, 'MARKET AGREES', 7), seasonPpg: 30.0, seasonGames: 5, formGap: 14.0 }];
EDGE.seasonForm.likelyUnder = [...EDGE.seasonForm.under];
// The board behind the sixteen position pages: who is ranked, who carries a
// market line, and when the odds were read. Counts per position are what the
// tiles print, so each position gets a different, checkable count.
const RANK_N = { QB: 34, RB: 72, WR: 98, TE: 42, K: 32, DEF: 32 };
const RANK_PLAYERS = [];
Object.entries(RANK_N).forEach(([pos, n]) => {
  for (let k = 0; k < n; k++) RANK_PLAYERS.push({ name: pos + ' Player ' + k, position: pos, team: 'T' + (k % 16), priced: k % 3 !== 0 });
});
const RANK = { ok: true, week: { label: 'Week 3', number: 3, type: 'REG', status: 'upcoming' },
  oddsAsOf: Date.UTC(2026, 8, 17, 18, 42), oddsProvider: 'propline', marketBoard: true, players: RANK_PLAYERS };
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
    week: 5, publishedAt: AGO(0.4), url: '/in-season/desk/trade-desk/5', byline: { name: 'Evan Brooks' },
    // A player with no game photograph is named first; one with a photograph second.
    components: [{ n: 1, player: 'Tank Bigsby', headline: 'Bigsby is a buy' }, { n: 2, player: 'Dak Prescott', headline: 'Prescott is a buy' }] },
  { kind: 'underrated', title: 'Most Underrated Player', headline: 'Roman Wilson is the most underrated player in Week 5',
    week: 5, publishedAt: AGO(0.6), url: '/in-season/desk/underrated/5', byline: { name: 'Evan Brooks' },
    components: [{ n: 1, headline: 'His target share is up four weeks running' }] },
  { kind: 'week-in-review', title: 'Week 5 in Review', headline: 'Week 5 in review has harder lessons too',
    week: 5, publishedAt: AGO(0.7), url: '/in-season/desk/week-in-review/5', byline: { name: 'Mike Baines' },
    components: [{ n: 1, headline: 'Week 5 in review has harder lessons too' }, { n: 2, player: 'Dak Prescott', headline: 'Flournoy beat his ranking' }] }
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
    if (MODE === 'live') {
      if (u.pathname === '/api/vegas-edge') body = EDGE;
      else if (u.pathname === '/api/rankings') body = RANK;
      else if (u.pathname === '/api/newsroom') body = CONTENT;
      else if (u.pathname === '/api/content') body = ARCHIVE_POISON;
      else if (u.pathname === '/api/season') body = SEASON;
    } else if (MODE === 'thin') {
      if (u.pathname === '/api/newsroom') body = THIN;
      else if (u.pathname === '/api/content') body = ARCHIVE_POISON;
      else if (u.pathname === '/api/season') body = SEASON;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  const fp = path.join(ROOT, u.pathname === '/' ? 'front.html' : u.pathname.slice(1));
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
    entries: [...document.querySelectorAll('.hm-entry a')].map(a => a.getAttribute('href')),
    // The header chrome, shared with every other page.
    line: text(document.querySelector('.site-line')),
    lineH: document.querySelector('.site-line') ? document.querySelector('.site-line').getBoundingClientRect().height : null,
    nav: [...document.querySelectorAll('header.site .nav a')].map(a => a.getAttribute('href')),
    cta: (() => { const c = document.querySelector('header.site a.cta'); return c ? { href: c.getAttribute('href'), text: c.textContent.trim(), shown: vis(c) } : null; })(),
    tabbar: [...document.querySelectorAll('.tabbar a')].filter(vis).map(a => a.getAttribute('href')),
    toggle: (() => { const b = document.querySelector('header.site .nav-toggle'); return b && vis(b) ? b.getAttribute('aria-controls') : null; })(),
    ribbonH: (() => { const r = document.querySelector('header.site > .wrap'); return r ? Math.round(r.getBoundingClientRect().height) : 0; })(),
    // The market figures.
    market: vis(byId('different')),
    figs: [...document.querySelectorAll('#diffBody .hm-fig')].map(f => ({
      c: text(f.querySelector('.c')), k: text(f.querySelector('.k')), v: text(f.querySelector('.v')), s: text(f.querySelector('.s')),
      face: (() => { const b = f.querySelector('.hm-face'); return b ? { name: b.getAttribute('data-face-name'), done: b.hasAttribute('data-face-done'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), ini: text(b.querySelector('i')) } : null; })(),
      good: f.querySelector('.v').classList.contains('good'), vPx: px(f.querySelector('.v')), kPx: px(f.querySelector('.k')),
      color: getComputedStyle(f.querySelector('.v')).color
    })),
    cats: [...document.querySelectorAll('#diffCats button')].filter(vis).map(b => ({ t: b.textContent.trim(), on: b.getAttribute('aria-selected') === 'true' })),
    fine: vis(byId('diffFine')) ? text(byId('diffFine')) : null,
    tag: (() => { const t = document.querySelector('#diffFine .hm-tag'); return t && vis(t) ? { t: t.textContent.trim(), px: px(t) } : null; })(),
    // The tiles.
    tiles: [...document.querySelectorAll('.hm-tile')].map(a => ({ href: a.getAttribute('href'), name: text(a.querySelector('.hm-tile-name')),
      live: vis(a.querySelector('.hm-tile-live')) ? text(a.querySelector('.hm-tile-live')) : null, svg: !!a.querySelector('svg[aria-hidden="true"]'),
      w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) })),
    tileTops: [...new Set([...document.querySelectorAll('.hm-tile')].map(a => Math.round(a.getBoundingClientRect().top)))].length,
    // The two lane tiles.
    lanes: [...document.querySelectorAll('#lanes .hm-lane')].map(a => ({ href: a.getAttribute('href'), name: text(a.querySelector('.hm-lane-name')), sub: text(a.querySelector('.hm-lane-sub')),
      svg: !!a.querySelector('svg[aria-hidden="true"]'), top: Math.round(a.getBoundingClientRect().top),
      w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) })),
    // The story cards.
    articles: vis(byId('articles')),
    rows: [...document.querySelectorAll('#readGrid .hm-story')].map(r => {
      const pic = r.querySelector('.hm-story-pic'), pb = pic.getBoundingClientRect(), tb = r.querySelector('.hm-story-txt').getBoundingClientRect(), b = r.getBoundingClientRect();
      const link = r.querySelector('a.hm-story-head'), credit = r.querySelector('.hm-story-credit');
      return { href: link && link.getAttribute('href'), tag: r.tagName, action: pic.classList.contains('is-action'),
        credit: credit && vis(credit) ? { text: text(credit), links: [...credit.querySelectorAll('a')].map(a => a.getAttribute('href')) } : null,
        lead: r.classList.contains('lead'), name: text(r.querySelector('.hm-story-head')), meta: text(r.querySelector('.hm-story-meta')),
        series: text(r.querySelector('.hm-story-chip')), face: pic.getAttribute('data-face-name'), headPx: px(r.querySelector('.hm-story-head')),
        picLeft: pb.right <= tb.left + 1, picTop: pb.bottom <= tb.top + 1, top: Math.round(b.top), w: Math.round(b.width), radius: parseFloat(getComputedStyle(r).borderTopLeftRadius), shadow: getComputedStyle(r).boxShadow };
    }),
    // How it works, and the band.
    how: vis(byId('how')),
    howCards: [...document.querySelectorAll('#how .hm-input')].map(c => ({ h: text(c.querySelector('h3')), radius: parseFloat(getComputedStyle(c).borderTopLeftRadius), border: getComputedStyle(c).borderTopWidth })),
    tagline: text(document.querySelector('#how .hm-tagline')),
    italics: [...document.querySelectorAll('body *')].filter(e => vis(e) && getComputedStyle(e).fontStyle === 'italic' && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).length,
    kpi: vis(byId('kpi')),
    kpis: [...document.querySelectorAll('#kpiGrid > div')].map(d => ({ v: text(d.querySelector('b')), k: text(d.querySelector('span')), good: d.querySelector('b').classList.contains('good'), px: px(d.querySelector('b')) })),
    kpiBg: byId('kpi') ? getComputedStyle(byId('kpi')).backgroundColor : null,
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
    shadows: [...document.querySelectorAll('main *, #kpi *')].filter(e => vis(e) && !e.classList.contains('hm-story') && getComputedStyle(e).boxShadow !== 'none').map(e => e.className || e.tagName).slice(0, 5),
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
  ok(`${tag}: the one h1 is the thesis`, r.h1 === 'Every player, priced off the betting market.', r.h1);
  ok(`${tag}: it is drawn, centred, at 44 to 68px, 700`, r.h1Drawn && r.h1Centered && r.h1Px >= 44 && r.h1Px <= 68 && r.h1Weight === '700', `${r.h1Px}px ${r.h1Weight} centred=${r.h1Centered}`);
  ok(`${tag}: one sentence under it, 19px, inside the measure`,
     /^Sportsbook lines and player props become fantasy point projections/.test(r.lede || '') && r.ledePx === 19 && r.ledeW <= 60, `${r.ledePx}px ${r.ledeW.toFixed(1)}ch`);
  ok(`${tag}: the search field is a real form posting ?q= to /player`, r.find === true);
  ok(`${tag}: with the shared lookup on its input and a placeholder that says what to type`,
     !!r.findInput && r.findInput.search === 'front' && r.findInput.role === 'combobox' && /player/i.test(r.findInput.ph), JSON.stringify(r.findInput));
  ok(`${tag}: and it is the one pill on the page, 52px tall`, !!r.findInput && r.findInput.h >= 52 && r.findInput.radius > 20 && r.pills.length === 0, JSON.stringify({ h: r.findInput && r.findInput.h, pills: r.pills }));
  ok(`${tag}: three entry points as text links`, r.entries.join(' ') === '/fantasy /dfs /in-season/desk', r.entries.join(' '));
  // The chrome is the shared one.
  ok(`${tag}: the black bar above the ribbon carries no text`, r.line === '', r.line);
  ok(`${tag}: the navy bar above the ribbon is 3px`, r.lineH === 3, String(r.lineH));
  ok(`${tag}: the ribbon is ${w > 860 ? 60 : 56}px`, r.ribbonH === (w > 860 ? 60 : 56), r.ribbonH + 'px');
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
console.log('\nsix sections, in order, and nothing else');
{
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('hero, tiles, newest, lanes, method, band', r.allSections.join(' > ') === 'heroBand > positions > articles > lanes > how > kpi', r.allSections.join(' > '));
  ok('two lane tiles under the desk: DFS to /dfs, season long to /fantasy',
     r.lanes.map(l => l.href + ' ' + l.name).join(' | ') === '/dfs DFS | /fantasy Season long', r.lanes.map(l => l.href + ' ' + l.name).join(' | '));
  ok('each lane is landscape, side by side, with its own illustration and a line under the name',
     r.lanes.every(l => l.svg && l.w > l.h && l.sub) && new Set(r.lanes.map(l => l.top)).size === 1, JSON.stringify(r.lanes));
  ok('the market figures live inside the hero, not as a sixth section', !r.allSections.includes('different') && !!(await page.$('#heroBand #different')));
  ok('six tiles, one per position, each linking its weekly board',
     r.tiles.map(t => t.href).join(' ') === '/weekly-qb-rankings /weekly-rb-rankings /weekly-wr-rankings /weekly-te-rankings /weekly-k-rankings /weekly-dst-rankings', r.tiles.map(t => t.href).join(' '));
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
  ok('the market row is shown', r.market === true);
  ok('the overview, then six lists, in order, the overview showing',
     r.cats.map(c => c.t).join(' | ') === 'Overview | This week’s value | Outscoring their projections | Likely to outperform | This week’s headwinds | Trailing their projections | Likely to underperform' && r.cats[0].on && r.cats.filter(c => c.on).length === 1,
     JSON.stringify(r.cats));
  ok('the overview is the top figure of each list, in list order, each labelled with its list',
     r.figs.length === 6 && r.figs.map(f => f.c).join(' | ') === 'Overview | This week’s value | Outscoring their projections | Likely to outperform | This week’s headwinds | Trailing their projections | Likely to underperform'.slice('Overview | '.length)
       && r.figs[0].v === '+4.7 pts' && r.figs[1].k.startsWith('Trust · Puka Nacua') && r.figs[2].k.startsWith('Trust · Puka Nacua')
       && r.figs[3].v === '-4.7 pts' && r.figs[4].k.startsWith('Sell high · Tyreek Hill') && r.figs[5].k.startsWith('Sell high · Tyreek Hill'),
     JSON.stringify(r.figs.map(f => [f.c, f.k, f.v])));
  ok('and its note covers both kinds of figure', /weekly fantasy points/.test(r.fine || '') && /at least 3 games played/.test(r.fine || ''), r.fine);
  await page.click('#diffCats button:nth-child(2)');
  Object.assign(r, { figs: (await read(page)).figs });
  ok('a list figure carries no list label', r.figs.every(f => !f.c), r.figs.map(f => f.c).join(','));
  ok('this week\'s value is the buys, widest gap first', r.figs.length === 4 && r.figs.map(f => f.v).join(' | ') === '+4.7 pts | +4.7 pts | +4.4 pts | +2.5 pts', r.figs.map(f => f.v).join(' | '));
  ok('and only the buys', r.figs.every(f => f.good));
  ok('a consensus under 3 points is a stale line, not a price, and not a figure', !r.figs.some(f => f.k.includes('Promoted Backup')), r.figs.map(f => f.k).join(' / '));
  const ACTIONS = new Set(['Start', 'Sit', 'Upgrade', 'Downgrade', 'Value play', 'Fade']);
  ok('every figure leads with one of the six decisions', r.figs.every(f => ACTIONS.has(f.k.split(' · ')[0])), r.figs.map(f => f.k).join(' / '));
  ok('a strong buy on a bench player is a Value play', r.figs.some(f => f.k.startsWith('Value play · Tank Bigsby')), r.figs.map(f => f.k).join(' / '));
  // The headwinds, picked by the reader: the decisions below are on that list.
  const weekValue = r;
  await page.click('#diffCats button:nth-child(5)');
  const hw = await read(page);
  ok('picking a list shows it', hw.cats[4].on && hw.figs.every(f => !f.good) && hw.figs.map(f => f.v).join(' | ') === '-4.7 pts | -4.5 pts | -4.0 pts', hw.figs.map(f => f.v).join(' | '));
  const by = n => weekValue.figs.concat(hw.figs).find(f => f.k.includes(n));
  ok('a strong buy on a startable player is a Start', by('Drake London') && by('Drake London').k.startsWith('Start'));
  ok('a strong fade on a player you would be starting is a Sit', by('Derrick Henry') && by('Derrick Henry').k.startsWith('Sit'));
  ok('a strong fade on a bench player is a Fade', by('Blake Corum') && by('Blake Corum').k.startsWith('Fade'));
  ok('and every figure states the three projections under it',
     r.figs.every(f => /^Market \d+\.\d · consensus \d+\.\d · Iron Tuna \d+\.\d$/.test(f.s)), r.figs.map(f => f.s).join(' / '));
  ok('a 16px label over a 34px figure', r.figs.every(f => f.kPx === 16 && f.vPx === 34), JSON.stringify(r.figs.map(f => [f.kPx, f.vPx])));
  ok('only a positive edge is green, and the negative ones are ink',
     r.figs.filter(f => f.v.startsWith('+')).every(f => f.good && f.color === 'rgb(10, 106, 76)') && r.figs.filter(f => f.v.startsWith('-')).every(f => !f.good && f.color === 'rgb(17, 20, 24)'),
     JSON.stringify(r.figs.map(f => [f.v, f.color])));
  ok('a player the market agrees about is not a figure', !hw.figs.some(f => f.k.includes('Agreeable')));
  ok('no injured player, no player the books left off, and no zero projection is a figure',
     !hw.figs.some(f => /Lamar Jackson|Hobbled|Priced Out|Zeroed/.test(f.k)) && !hw.figs.some(f => /Market 0\.0|Iron Tuna 0\.0/.test(f.s)), hw.figs.map(f => f.k).join(' / '));

  // The season lists.
  await page.click('#diffCats button:nth-child(3)');
  const ov = await read(page);
  ok('the overperformers: five, starters and longshots both, widest first',
     ov.figs.length === 5 && ov.figs.map(f => f.k.split(', ')[0]).join(' / ') === 'Trust · Puka Nacua / Trust · Jahmyr Gibbs / Trust · Josh Allen / Buy · Deep Sleeper / Buy · Bench Flier',
     ov.figs.map(f => f.k).join(' / '));
  ok('the starter dealt out for a longshot is the narrowest starter', !ov.figs.some(f => f.k.includes('Elite Fourth')));
  ok('an injured player is not an overperformer', !ov.figs.some(f => f.k.includes('Sidelined')));
  ok('nor is a season average set against a stale line', !ov.figs.some(f => f.k.includes('Stale Line')));
  ok('each states points a game over the price, green, over the season line',
     ov.figs.every(f => f.good && /^\+\d+\.\d pts\/g$/.test(f.v) && /^Season \d+\.\d a game over \d · consensus \d+\.\d · market \d+\.\d$/.test(f.s)),
     ov.figs.map(f => f.v + ' ' + f.s).join(' / '));
  ok('and the note says what a season figure is', /at least 3 games played/.test(ov.fine || ''), ov.fine);
  await page.click('#diffCats button:nth-child(4)');
  const lo = await read(page);
  ok('likely to outperform: the season call Iron Tuna backs, five, widest first',
     lo.figs.length === 5 && lo.figs.map(f => f.k.split(', ')[0]).join(' / ') === 'Trust · Puka Nacua / Trust · Jahmyr Gibbs / Trust · Josh Allen / Buy · Deep Sleeper / Buy · Bench Flier',
     lo.figs.map(f => f.k).join(' / '));
  ok('a hot streak Iron Tuna projects under his consensus is no call', !lo.figs.some(f => f.k.includes('Tuna Doubts')), lo.figs.map(f => f.k).join(' / '));
  ok('each leads with this week\'s two projections, then the season',
     lo.figs.every(f => f.good && /^\+\d+\.\d pts\/g$/.test(f.v) && /^Consensus \d+\.\d · Iron Tuna \d+\.\d · averaging \d+\.\d over \d$/.test(f.s)),
     lo.figs.map(f => f.v + ' ' + f.s).join(' / '));
  ok('and the note says Iron Tuna has to agree', /Iron Tuna’s projection for the week does not disagree/.test(lo.fine || ''), lo.fine);
  await page.click('#diffCats button:nth-child(7)');
  const lu = await read(page);
  ok('likely to underperform: Sell high on a starter, Sell on a longshot, in ink',
     lu.figs.map(f => f.k.split(', ')[0] + ' ' + f.v).join(' / ') === 'Sell high · Tyreek Hill -6.9 pts/g / Sell · Faded Vet -5.5 pts/g / Sell high · Slow Starter -4.6 pts/g'
       && lu.figs.every(f => !f.good), lu.figs.map(f => f.k + ' ' + f.v).join(' / '));
  await page.click('#diffCats button:nth-child(6)');
  const uv = await read(page);
  ok('the overvalued: Sell high on a starter, Sell on a longshot, in ink',
     uv.figs.map(f => f.k.split(', ')[0] + ' ' + f.v).join(' / ') === 'Sell high · Tyreek Hill -6.9 pts/g / Sell · Faded Vet -5.5 pts/g / Sell high · Slow Starter -4.6 pts/g'
       && uv.figs.every(f => !f.good), uv.figs.map(f => f.k + ' ' + f.v).join(' / '));
  await page.click('#diffCats button:nth-child(2)');
  r.figs = (await read(page)).figs;
  ok('every figure carries the player\'s photograph, an 88px circle',
     r.figs.every(f => f.face && f.face.w === 88 && f.face.h === 88 && f.k.includes(f.face.name)), JSON.stringify(r.figs.map(f => f.face)));
  ok('resolved off the shared player index, ESPN first',
     r.figs.every(f => f.face.done) && ['4426502', '4688380', '4429096'].every(id => photos.some(u => u.includes('/headshots/nfl/players/full/' + id + '.png'))),
     JSON.stringify(photos.filter(u => /headshots/.test(u))));
  ok('and the initials stand in when the photograph does not load', r.figs.every(f => /^[A-Z]{2}$/.test(f.face.ini || '')), r.figs.map(f => f.face.ini).join(','));
  ok('a row missing a projection is dropped, not printed with a dash', !hw.figs.some(f => f.k.includes('Holey')) && !hw.figs.some(f => /—/.test(f.k + f.v + f.s)));
  ok('the note says the week, the scoring and when the odds were read',
     /Week 3/.test(r.fine || '') && /default scoring/.test(r.fine || '') && /Odds read .* ET/.test(r.fine || ''), r.fine);
  ok('under the amber Estimate label, at 12px', !!r.tag && r.tag.t === 'Estimate' && r.tag.px === 12, JSON.stringify(r.tag));

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
  // The desk's photographs are lazy, and the market band above it now holds
  // six lists, so at 900px the row under the lead starts below the fold.
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

  ok('the KPI band is shown, navy, with white 44px figures', r.kpi === true && r.kpiBg === 'rgb(0, 30, 71)' && r.kpis.every(k => k.px === 44), JSON.stringify({ bg: r.kpiBg, px: r.kpis.map(k => k.px) }));
  ok('its figures come off the board and the desk',
     r.kpis.map(k => k.v + ' ' + k.k).join(' | ') === '310 Players ranked this week (Week 3) | 205 Priced off a market line | 7 Pieces the desk published',
     r.kpis.map(k => k.v + ' ' + k.k).join(' | '));
  ok('only the market-priced count is mint', r.kpis.filter(k => k.good).map(k => k.k).join() === 'Priced off a market line');
  ok('and no loading copy survives anywhere on the page', !LOADING.test(r.body), (r.body.match(LOADING) || [''])[0]);
  await ctx.close();
}

// ── 3a. the rotation ────────────────────────────────────────────────────────
// The band advances on its own every nine seconds, holds while the pointer is
// on it, and stops for good once the reader picks a list. Driven on the page's
// own clock so the test does not wait the seconds out.
console.log('\nthe band rotates');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`rotation: ${e.message}`));
  await page.route(/espncdn\.com|static\.www\.nfl\.com|googletagmanager\.com|wikimedia\.org/, r => r.abort());
  await page.clock.install();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.mouse.move(5, 890);
  const on = () => page.evaluate(() => { const b = document.querySelector('#diffCats button[aria-selected="true"]'); return b ? b.textContent.trim() : null; });
  const first = await on();
  await page.clock.runFor(9500);
  const second = await on();
  await page.clock.runFor(9000);
  const third = await on();
  ok('it opens on the overview and advances through the lists on its own', first === 'Overview' && second === 'This week’s value' && third === 'Outscoring their projections', [first, second, third].join(' → '));
  await page.hover('#diffBody');
  await page.clock.runFor(20000);
  ok('and holds while the pointer is on it', (await on()) === 'Outscoring their projections', await on());
  await page.click('#diffCats button:nth-child(3)');
  await page.mouse.move(5, 890);
  await page.clock.runFor(30000);
  ok('a list the reader picks stays picked', (await on()) === 'Outscoring their projections', await on());
  await ctx.close();
}

// ── 3b. a short board ───────────────────────────────────────────────────────
console.log('\nwith a board too short to print');
{
  const full = EDGE.vsExperts, fullForm = EDGE.seasonForm;
  EDGE.vsExperts = { buys: full.buys.slice(0, 1), fades: full.fades.slice(0, 1) };
  EDGE.seasonForm = { minGames: 3, over: fullForm.over.slice(0, 2), under: fullForm.under.slice(0, 2) };
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('two gaps are not a row: the market figures are hidden rather than short', r.market === false && r.figs.length === 0, String(r.figs.length));
  ok('and nothing on the page apologizes for it', !LOADING.test(r.body));
  EDGE.vsExperts = full;
  EDGE.seasonForm = fullForm;
  await ctx.close();
}
// A season list with three rows stands on its own when the week has none:
// the band shows that one list, with no tabs over it.
{
  const full = EDGE.vsExperts, fullForm = EDGE.seasonForm;
  EDGE.vsExperts = { buys: [], fades: [] };
  let { page, ctx } = await open(1440, 900);
  let r = await read(page);
  ok('with the week empty, the overview and the four season lists are the band', r.market === true && r.cats.map(c => c.t).join(' | ') === 'Overview | Outscoring their projections | Likely to outperform | Trailing their projections | Likely to underperform' && r.figs.length === 4, JSON.stringify(r.cats));
  await ctx.close();
  EDGE.seasonForm = { ...fullForm, under: [], likelyOver: [], likelyUnder: [] };
  ({ page, ctx } = await open(1440, 900));
  r = await read(page);
  ok('one list long enough is a band of one, with no tabs', r.market === true && r.cats.length === 0 && r.figs.length === 5 && r.figs[0].k.startsWith('Trust · Puka Nacua'), JSON.stringify([r.cats, r.figs.map(f => f.k)]));
  EDGE.vsExperts = full;
  EDGE.seasonForm = fullForm;
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
      ulLeft: Math.round(ul.getBoundingClientRect().left), figsStacked: new Set([...document.querySelectorAll('#diffBody .hm-fig')].map(f => Math.round(f.getBoundingClientRect().left))).size,
      tab: (() => { const t = document.querySelector('.tabbar'); const b = t.getBoundingClientRect(); return { h: Math.round(b.height), bottom: Math.round(b.bottom), fixed: getComputedStyle(t).position }; })() };
  });
  ok('the tile row scrolls sideways, edge to edge, with the first tile on the gutter', row.scrolls && row.ulLeft === 0 && row.left === 16, JSON.stringify(row));
  ok('the market figures stack, one per row', row.figsStacked === 1 && r.figs.length === 6, String(row.figsStacked));
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
  for (const sel of ['header.site .nav a', '.hm-entry a', '#different .hm-sec-head a', '.hm-tile', '#readGrid a', '#lanes .hm-lane', '#how .hm-how-more a', '.foot-nav a']) {
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
     r.rows[3].name === 'His target share is up four weeks running' && r.rows[3].series === 'Most Underrated Player' && /Evan Brooks/.test(r.rows[3].meta), JSON.stringify(r.rows[3]));
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

// ── 4. the refusing pass: the whole point ───────────────────────────────────
console.log('\nwith every feed refusing');
MODE = 'dead';
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const { page, ctx } = await open(w, h);
  const r = await read(page);
  ok(`${tag}: the page still has its h1 and its search field`, r.h1 === 'Every player, priced off the betting market.' && r.find === true);
  ok(`${tag}: the three entry points still stand`, r.entries.length === 3);
  ok(`${tag}: the market row is hidden, not empty`, r.market === false && r.figs.length === 0);
  ok(`${tag}: the tiles stay, without a live line`, r.tiles.length === 6 && r.tiles.every(t => t.live === null), r.tiles.map(t => t.live).join(','));
  ok(`${tag}: the story cards are hidden, not empty`, r.articles === false && r.rows.length === 0);
  ok(`${tag}: the method is still there`, r.how === true);
  ok(`${tag}: the KPI band is hidden rather than a band of blanks`, r.kpi === false && r.kpis.length === 0);
  ok(`${tag}: nowhere on the page says it is loading`, !LOADING.test(r.body), (r.body.match(LOADING) || [''])[0]);
  ok(`${tag}: and it still does not scroll sideways`, r.overflow === 0, String(r.overflow));
  await ctx.close();
}

ok('no page threw', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
