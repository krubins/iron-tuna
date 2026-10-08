#!/usr/bin/env node
// The homepage, driven in a browser.
//   node tools/test-homepage.mjs
//
// October 2026: "/" is the ledger-style front described in docs/design/brief.md.
// Five sections, in this order: a white centred hero (one headline, one
// sentence, the search field, three entry points, a hairline and the row of
// live market figures), the six position tiles, the six newest desk pieces as
// a ledger, the three How-it-works cards, and the navy KPI band; then the
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
    mk('James Cook', 'RB', 'BUF', 'NYJ', 13.4, 15.9, 15.0, 'VEGAS LEANS HIGHER', 9)
  ],
  fades: [
    mk('Derrick Henry', 'RB', 'BAL', 'CIN', 17.8, 13.1, 14.6, 'STRONG VEGAS FADE', 11),
    mk('Blake Corum', 'RB', 'LAR', 'SEA', 11.5, 7.0, 8.4, 'STRONG VEGAS FADE', 41),
    // MARKET AGREES is not a disagreement and must never become a figure.
    mk('Agreeable Wideout', 'WR', 'SEA', 'LAR', 12.0, 12.1, 12.0, 'MARKET AGREES', 20),
    // A row with a hole in it is dropped, not printed with a dash.
    { name: 'Holey Wideout', position: 'WR', team: 'NYG', opponent: 'DAL',
      consensusPoints: 11.0, vegasPoints: null, ironTunaPoints: 9.5, ironTunaRank: 30,
      delta: { points: -3.0, rank: -9, classification: 'STRONG VEGAS FADE' } }
  ]
}};
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
  // THE BOAST is split off in a ledger row: the call is the headline.
  { kind: 'scorecard', title: 'What Tuna Got Right', headline: 'YOU’RE WELCOME: the total moved three points in a day',
    week: 3, publishedAt: AGO(18), url: '/in-season/desk/scorecard/3' },
  // No url: not a row.
  { kind: 'broken', title: 'Broken', headline: 'No destination', week: 3, publishedAt: AGO(20) },
  // No headline of its own: not a row either.
  { kind: 'blank', title: 'Blank', week: 3, publishedAt: AGO(21), url: '/in-season/desk/blank/3' },
  { kind: 'weekend-game-plan', title: 'Weekend Game Plan', headline: 'Too many to print',
    week: 3, publishedAt: AGO(26), url: '/in-season/desk/weekend-game-plan/3' },
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

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${width}px: ${e.message}`));
  await page.route(/espncdn\.com|static\.www\.nfl\.com|wikimedia\.org|googletagmanager\.com/, r => r.abort());
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
    lineSpans: [...document.querySelectorAll('.site-line span')].filter(vis).length,
    nav: [...document.querySelectorAll('header.site .nav a')].map(a => a.getAttribute('href')),
    cta: (() => { const c = document.querySelector('header.site a.cta'); return c ? { href: c.getAttribute('href'), text: c.textContent.trim(), shown: vis(c) } : null; })(),
    tabbar: [...document.querySelectorAll('.tabbar a')].filter(vis).map(a => a.getAttribute('href')),
    toggle: (() => { const b = document.querySelector('header.site .nav-toggle'); return b && vis(b) ? b.getAttribute('aria-controls') : null; })(),
    ribbonH: (() => { const r = document.querySelector('header.site > .wrap'); return r ? Math.round(r.getBoundingClientRect().height) : 0; })(),
    // The market figures.
    market: vis(byId('different')),
    figs: [...document.querySelectorAll('#diffBody .hm-fig')].map(f => ({
      k: text(f.querySelector('.k')), v: text(f.querySelector('.v')), s: text(f.querySelector('.s')),
      good: f.querySelector('.v').classList.contains('good'), vPx: px(f.querySelector('.v')), kPx: px(f.querySelector('.k')),
      color: getComputedStyle(f.querySelector('.v')).color
    })),
    fine: vis(byId('diffFine')) ? text(byId('diffFine')) : null,
    tag: (() => { const t = document.querySelector('#diffFine .hm-tag'); return t && vis(t) ? { t: t.textContent.trim(), px: px(t) } : null; })(),
    // The tiles.
    tiles: [...document.querySelectorAll('.hm-tile')].map(a => ({ href: a.getAttribute('href'), name: text(a.querySelector('.hm-tile-name')),
      live: vis(a.querySelector('.hm-tile-live')) ? text(a.querySelector('.hm-tile-live')) : null, svg: !!a.querySelector('svg[aria-hidden="true"]'),
      w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) })),
    tileTops: [...new Set([...document.querySelectorAll('.hm-tile')].map(a => Math.round(a.getBoundingClientRect().top)))].length,
    // The ledger.
    articles: vis(byId('articles')),
    rows: [...document.querySelectorAll('#readGrid .ledger-row')].map(r => ({
      href: r.getAttribute('href'), name: text(r.querySelector('.ledger-name b')), sub: text(r.querySelector('.ledger-name span')),
      figs: [...r.querySelectorAll('.ledger-fig')].filter(vis).map(f => ({ k: text(f.querySelector('small')), v: text(f.querySelector('b')), kPx: px(f.querySelector('small')), vPx: px(f.querySelector('b')),
        right: getComputedStyle(f).textAlign }))
    })),
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
    shadows: [...document.querySelectorAll('main *, #kpi *')].filter(e => vis(e) && getComputedStyle(e).boxShadow !== 'none').map(e => e.className || e.tagName).slice(0, 5),
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
  ok(`${tag}: the key phrase line is above the ribbon`, /^Every player priced off the betting market first\./.test(r.line || ''), r.line);
  ok(`${tag}: ${w > 860 ? 'both sentences show' : 'only the first sentence shows'}`, r.lineSpans === (w > 860 ? 2 : 1), String(r.lineSpans));
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
  ok(`${tag}: nothing casts a shadow`, r.shadows.length === 0, r.shadows.join(','));
  ok(`${tag}: the page does not scroll sideways`, r.overflow === 0, String(r.overflow));
  ok(`${tag}: there is exactly one h1`, r.headings.filter(x => x.startsWith('H1:')).length === 1);
  await ctx.close();
}

// ── 2. the outline ──────────────────────────────────────────────────────────
console.log('\nfive sections, in order, and nothing else');
{
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('hero, tiles, newest, method, band', r.allSections.join(' > ') === 'heroBand > positions > articles > how > kpi', r.allSections.join(' > '));
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
  ok('with four figures, widest gap first', r.figs.length === 4 && r.figs.map(f => f.v).join(' | ') === '+4.7 pts | +4.7 pts | -4.7 pts | -4.5 pts', r.figs.map(f => f.v).join(' | '));
  const ACTIONS = new Set(['Start', 'Sit', 'Upgrade', 'Downgrade', 'Value play', 'Fade']);
  ok('every figure leads with one of the six decisions', r.figs.every(f => ACTIONS.has(f.k.split(' · ')[0])), r.figs.map(f => f.k).join(' / '));
  const by = n => r.figs.find(f => f.k.includes(n));
  ok('a strong buy on a startable player is a Start', by('Drake London') && by('Drake London').k.startsWith('Start'));
  ok('a strong fade on a player you would be starting is a Sit', by('Derrick Henry') && by('Derrick Henry').k.startsWith('Sit'));
  ok('a strong fade on a bench player is a Fade', by('Blake Corum') && by('Blake Corum').k.startsWith('Fade'));
  ok('and every figure states the three projections under it',
     r.figs.every(f => /^Market \d+\.\d · consensus \d+\.\d · Iron Tuna \d+\.\d$/.test(f.s)), r.figs.map(f => f.s).join(' / '));
  ok('a 13px label over a 28px figure', r.figs.every(f => f.kPx === 13 && f.vPx === 28), JSON.stringify(r.figs.map(f => [f.kPx, f.vPx])));
  ok('only a positive edge is green, and the negative ones are ink',
     r.figs.filter(f => f.v.startsWith('+')).every(f => f.good && f.color === 'rgb(10, 106, 76)') && r.figs.filter(f => f.v.startsWith('-')).every(f => !f.good && f.color === 'rgb(17, 20, 24)'),
     JSON.stringify(r.figs.map(f => [f.v, f.color])));
  ok('a player the market agrees about is not a figure', !r.figs.some(f => f.k.includes('Agreeable')));
  ok('a row missing a projection is dropped, not printed with a dash', !r.figs.some(f => f.k.includes('Holey')) && !r.figs.some(f => /—/.test(f.k + f.v + f.s)));
  ok('the note says the week, the scoring and when the odds were read',
     /Week 3/.test(r.fine || '') && /default scoring/.test(r.fine || '') && /Odds read .* ET/.test(r.fine || ''), r.fine);
  ok('under the amber Estimate label, at 12px', !!r.tag && r.tag.t === 'Estimate' && r.tag.px === 12, JSON.stringify(r.tag));

  ok('every tile carries its live line off the board',
     r.tiles.map(t => t.live).join(' | ') === '34 ranked · 22 priced | 72 ranked · 48 priced | 98 ranked · 65 priced | 42 ranked · 28 priced | 32 ranked · 21 priced | 32 ranked · 21 priced',
     r.tiles.map(t => t.live).join(' | '));

  ok('the newest ledger is shown', r.articles === true);
  ok('six rows, newest first', r.rows.length === 6 && r.rows.map(x => x.href).join(' ') === '/in-season/desk/final-read/3 /in-season/desk/opportunity-report/3 /in-season/desk/rankings-update/3 /in-season/desk/scorecard/3 /in-season/desk/weekend-game-plan/3 /in-season/desk/waiver-watch/3',
     r.rows.map(x => x.href).join(' '));
  ok('a row without a destination or a headline is not a row', !r.rows.some(x => /No destination|Blank/.test(x.name + x.sub)));
  ok('the boast comes off the headline in a ledger row', r.rows[3] && r.rows[3].name === 'the total moved three points in a day', r.rows[3] && r.rows[3].name);
  ok('each row is the headline over the series, then three figure columns',
     r.rows.every(x => x.figs.length === 3 && x.figs.map(f => f.k).join(',') === 'Published,Week,Players named'), JSON.stringify(r.rows[0] && r.rows[0].figs));
  ok('each figure is a 13px label over a 17px figure, right-aligned',
     r.rows.every(x => x.figs.every(f => f.kPx === 13 && f.vPx === 17 && f.right === 'right')), JSON.stringify(r.rows[0] && r.rows[0].figs));
  ok('a piece from minutes ago says so, and one from yesterday too',
     r.rows[0].figs[0].v === '6m ago' && r.rows[4].figs[0].v === 'Yesterday', r.rows.map(x => x.figs[0].v).join(' / '));
  ok('and the players a piece names are counted', r.rows[0].figs[2].v === '2' && r.rows[2].figs[2].v === '0', r.rows.map(x => x.figs[2].v).join(','));
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

// ── 3b. a short board ───────────────────────────────────────────────────────
console.log('\nwith a board too short to print');
{
  const full = EDGE.vsExperts;
  EDGE.vsExperts = { buys: full.buys.slice(0, 1), fades: full.fades.slice(0, 1) };
  const { page, ctx } = await open(1440, 900);
  const r = await read(page);
  ok('two gaps are not a row: the market figures are hidden rather than short', r.market === false && r.figs.length === 0, String(r.figs.length));
  ok('and nothing on the page apologizes for it', !LOADING.test(r.body));
  EDGE.vsExperts = full;
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
  ok('the market figures stack, one per row', row.figsStacked === 1 && r.figs.length === 4, String(row.figsStacked));
  ok('the tab bar is fixed to the foot of the screen, 68px', row.tab.fixed === 'fixed' && row.tab.h === 68 && row.tab.bottom === 844, JSON.stringify(row.tab));
  ok('the ledger keeps the published figure beside each headline', r.rows.length === 6 && r.rows.every(x => x.figs.length === 1 && x.figs[0].k === 'Published'), JSON.stringify(r.rows[0] && r.rows[0].figs));
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
  for (const sel of ['header.site .nav a', '.hm-entry a', '#different .hm-sec-head a', '.hm-tile', '#readGrid a', '#how .hm-how-more a', '.foot-nav a']) {
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
  ok(`${tag}: the ledger is hidden, not empty`, r.articles === false && r.rows.length === 0);
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
