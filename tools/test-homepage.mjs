#!/usr/bin/env node
// The homepage, driven in a browser.
//   node tools/test-homepage.mjs
//
// It replaces tools/test-position-lens.mjs, which drove the sticky ribbon's
// Auction/Snake edition switch and the Position Intel grid under it. Both came
// off in the September 2026 rewrite: "/" is five sections now — hero, the two
// product cards, the market disagreements, the desk's current pieces, and the
// method with the disclosures under it — and the draft-season controls went with
// the draft-season modules.
//
// THE RULE THIS EXISTS FOR, and the one the old page broke constantly: A BAND IS
// EITHER FULL OF REAL CURRENT DATA OR IT IS HIDDEN. The page it replaced opened
// on "Reading the board…", "Waiting for this week's slate", "Reading the
// market…" and "Loading the current case…" — four different skeletons above the
// fold on a Wednesday, because every module reserved its own space and then
// apologized for being empty. So every feed here is driven TWICE: once answering
// with real rows, and once refusing outright. The refusing pass is the one that
// matters, and it asserts the negative directly — no loading copy anywhere in
// the rendered text.
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

// A SKIP THAT CI COUNTS AS GREEN IS WORSE THAN NO TEST. This file self-skips on
// a machine with no browser, which is right for a contributor's laptop and
// wrong for a gate — so CI sets REQUIRE_BROWSER=1 and a missing browser becomes
// a failure with the command that fixes it. Nothing else about the run changes.
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
// CHROMIUM_PATH wins, then the binaries preinstalled in Claude Code remote
// sessions, then whatever playwright-core itself installed — which is what a
// `playwright-core install chromium` on a CI runner leaves behind, and which
// already honours PLAYWRIGHT_BROWSERS_PATH.
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
    // MARKET AGREES is not a disagreement and must never become a row.
    mk('Agreeable Wideout', 'WR', 'SEA', 'LAR', 12.0, 12.1, 12.0, 'MARKET AGREES', 20),
    // A row with a hole in it is dropped, not printed with a dash.
    { name: 'Holey Wideout', position: 'WR', team: 'NYG', opponent: 'DAL',
      consensusPoints: 11.0, vegasPoints: null, ironTunaPoints: 9.5, ironTunaRank: 30,
      delta: { points: -3.0, rank: -9, classification: 'STRONG VEGAS FADE' } }
  ]
}};
const DFS = { ok: true, boards: { bestVegasValues: [
  { name: 'Rome Odunze', position: 'WR', team: 'CHI', salary: 5400, vegasPoints: 14.2, vegasValueScore: 3.21 },
  { name: 'Tucker Kraft', position: 'TE', team: 'GB', salary: 4200, vegasPoints: 10.9, vegasValueScore: 2.60 },
  // A row with a hole in it is not a candidate, so a turn can never land on
  // it and print a card with a gap in it.
  { name: 'Priceless Receiver', position: 'WR', team: 'NYJ', salary: 0, vegasPoints: 12.0, vegasValueScore: 2.9 }
]}};
// THE COVER ROTATES ON A CLOCK, so this test pins one. front.html gives each
// cover a turn (COVER_TURN_MS, an hour): the desk band slides one story down
// the feed per turn and the hero takes the next of the week's widest market
// gaps. Which story leads and whose photograph runs would otherwise depend on
// what time of day this test happened to run, so the browser's Date.now is
// frozen at an instant whose turn index is 0 for every pool size the fixtures
// use — 840 is the lowest common multiple of 1 through 8 — and the fixture
// publishes its newest piece five minutes before that instant, inside its own
// turn, so the band is newest-first. Turn by turn, both are covered without a
// browser in tools/test-newsroom.mjs.
const TURN_MS = 3600 * 1000;
const CLOCK = Math.floor(Date.now() / (840 * TURN_MS)) * (840 * TURN_MS);
const FRESH = CLOCK - 5 * 60 * 1000;
const AGO = h => FRESH - h * 3600 * 1000;
const CONTENT = { ok: true, pieces: [
  // `components` are the findings a piece breaks into, each naming the player
  // it is about. They are what the desk cards draw faces from and what the
  // hero's picture prefers over the market board.
  { kind: 'final-read', title: 'The Final Read', headline: 'Three lineups the market moved overnight',
    dek: 'Sunday morning props shifted two flex calls.', week: 3, publishedAt: FRESH,
    url: '/in-season/desk/final-read/3', byline: 'Iron Tuna desk',
    components: [{ n: 1, player: 'Puka Nacua', headline: 'a' }, { n: 2, player: 'James Cook', headline: 'b' }] },
  { kind: 'opportunity-report', title: 'Opportunity Report', headline: 'Who inherits the carries in Baltimore',
    dek: 'Snap share against the implied total.', week: 3, publishedAt: AGO(3),
    url: '/in-season/desk/opportunity-report/3', byline: 'Iron Tuna desk',
    components: [{ n: 1, player: 'Derrick Henry', headline: 'c' }] },
  { kind: 'rankings-update', title: 'Rankings Update', headline: 'Eleven moves after the injury report',
    week: 3, publishedAt: AGO(5), url: '/in-season/desk/rankings-update/3' },
  { kind: 'tnf-preview', title: 'TNF Preview', headline: 'The total moved three points in a day',
    week: 3, publishedAt: AGO(18), url: '/in-season/desk/tnf-preview/3' },
  // Six sent, three shown: the band is small on purpose, and a new piece
  // pushes the oldest one out of it.
  { kind: 'weekend-game-plan', title: 'Weekend Game Plan', headline: 'Too many to print',
    week: 3, publishedAt: AGO(26), url: '/in-season/desk/weekend-game-plan/3' },
  // No url: not a card.
  { kind: 'broken', title: 'Broken', headline: 'No destination', week: 3, publishedAt: AGO(30) }
]};
// What /api/content would hand back: the same story five times over, in draft.
// Nothing on the cover may come from here.
const ARCHIVE_POISON = { ok: true, pieces: [1, 2, 3, 4, 5].map(v => ({
  kind: 'weekend-preview', title: 'Weekend Preview', status: 'held', version: v,
  headline: 'HELD DRAFT ' + v + ' — must never reach the cover',
  dek: 'A draft the fact check stopped.', week: 3, publishedAt: FRESH,
  url: '/in-season/desk/weekend-preview/3'
})) };
const SEASON = { ok: true, phase: 'regular', phaseLabel: 'Regular season',
  week: { label: 'Week 3', status: 'upcoming', firstKickoff: Date.UTC(2026, 8, 17, 20, 15) },
  counts: { inProgress: 0 } };

// `live` is the answering pass; `dead` refuses every feed the way an outage or
// a quiet Wednesday does.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let MODE = 'live';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let body = { ok: false, error: 'unavailable' };
    if (MODE === 'live') {
      if (u.pathname === '/api/vegas-edge') body = EDGE;
      else if (u.pathname === '/api/dfs') body = DFS;
      // The band reads the PUBLISHED feed. /api/content is the archive — it
      // carries held drafts and one row per version — and the page used to
      // read it, which put five unpublished drafts of one story on the cover.
      // Answering it with poison here means a page that goes back to it fails
      // these assertions loudly instead of quietly showing drafts again.
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
async function open(width, height, at) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  // The frozen clock, set before any page script runs. Only Date.now is
  // replaced: the page reads timestamps out of its feeds with new Date(value),
  // which is unaffected, and the rotation is the one thing that asks the clock
  // what time it is now. `at` steps it, for the section that drives the cover
  // a turn forward in a real browser.
  await ctx.addInitScript(t => { Date.now = () => t; }, at == null ? CLOCK : at);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${width}px: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { page, ctx };
}
const LOADING = /Reading the board|Reading the market|Reading the desk|Reading the slate|Reading today|Waiting for this week|Loading the current case|Coming soon|Loading…/i;
const read = page => page.evaluate(() => {
  const vis = id => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0; };
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  return {
    h1: text(document.querySelector('h1')),
    lede: text(document.querySelector('.hm-lede')),
    cta: [...document.querySelectorAll('.hm-cta a')].map(a => `${a.textContent.trim()}|${a.getAttribute('href')}`),
    how: (() => { const a = document.querySelector('.hm-how-link'); return a && `${a.textContent.trim()}|${a.getAttribute('href')}`; })(),
    clock: vis('hmClock') ? text(document.getElementById('hmClock')) : null,
    lanes: [...document.querySelectorAll('.hm-lane > h2')].map(e => e.textContent.trim()),
    laneLinks: [...document.querySelectorAll('.hm-links a')].map(a => a.getAttribute('href')),
    fnRead: vis('fnRead') ? text(document.getElementById('fnRead')) : null,
    dfRead: vis('dfRead') ? text(document.getElementById('dfRead')) : null,
    diff: vis('different'),
    rows: [...document.querySelectorAll('#diffBody tr')].map(tr => ({
      who: text(tr.querySelector('.who b')),
      nums: [...tr.querySelectorAll('.num')].map(td => td.textContent.trim()),
      act: text(tr.querySelector('.hm-act')),
      why: text(tr.querySelector('.hm-act-why'))
    })),
    fine: vis('diffFine') ? text(document.getElementById('diffFine')) : null,
    // The hero's picture. Asserted on the PLATE and the caption rather than on
    // a loaded <img>: the photo hosts are third-party and a runner may or may
    // not reach them, and the plate falls back to initials either way — which
    // is exactly the behaviour that must survive.
    edge: vis('heroEdge'),
    edgePlate: !!document.querySelector('#heroEdgePlate .it-plate'),
    edgeK: text(document.getElementById('heroEdgeK')),
    edgeName: text(document.getElementById('heroEdgeName')),
    edgeGap: text(document.getElementById('heroEdgeGap')),
    edgeCols: (() => { const h = document.getElementById('hmHero'); return h ? h.classList.contains('has-edge') : null; })(),
    // The faces the page paints: one per card reading, one or more per desk
    // card, and the lookup's own markers in the disagreement table.
    readPics: document.querySelectorAll('.hm-read.has-pic .it-plate').length,
    cardFaces: document.querySelectorAll('#readGrid .it-player-face').length,
    articles: vis('articles'),
    cards: [...document.querySelectorAll('#readGrid .hm-read-card')].map(a => a.getAttribute('href')),
    how5: vis('how'),
    // Section order, top to bottom, is the specified one.
    order: [...document.querySelectorAll('section')].map(s => s.id || s.className).filter(Boolean),
    // The horizontal overflow a phone would scroll.
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.innerText,
    // Every heading, so the outline can be checked for a hole.
    headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ':' + h.textContent.trim().slice(0, 40))
  };
});

// ── 1. the thesis, at both widths ───────────────────────────────────────────
console.log('\nthe hero says the one thing, at every width');
for (const [w, h, tag] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
  const { page, ctx } = await open(w, h);
  const r = await read(page);
  ok(`${tag}: the headline is the thesis`,
     r.h1 === 'Anyone can publish a projection. Vegas has money on theirs.', r.h1);
  ok(`${tag}: the supporting line says what the site does`,
     r.lede === 'Iron Tuna converts sportsbook lines and player props into fantasy point projections, rankings, trade values and DFS lineups. Oddsmakers put real money, full-time quant teams and live analytics behind every number, and correct it within minutes of news.', r.lede);
  ok(`${tag}: two buttons, one per lane`,
     r.cta.join(' / ') === 'Get Fantasy Advice|/fantasy / Build a DFS Lineup|/dfs', r.cta.join(' / '));
  ok(`${tag}: and a smaller link into the method, on this page`,
     r.how === 'See How It Works|#how', r.how);
  ok(`${tag}: the hero is the first section on the page`, r.order[0] === 'heroBand', r.order.slice(0, 2).join(','));
  ok(`${tag}: the page does not scroll sideways`, r.overflow === 0, String(r.overflow));
  // The one heading level that must not be skipped: h1 then h2s.
  ok(`${tag}: there is exactly one h1`, r.headings.filter(x => x.startsWith('H1:')).length === 1);
  await ctx.close();
}

// ── 2. the five sections, in the order the spec names ───────────────────────
console.log('\nfive sections, in order, and nothing else');
{
  const { page, ctx } = await open(1280, 900);
  const r = await read(page);
  ok('hero, cards, disagreements, articles, method',
     r.order.join(' > ') === 'heroBand > hm-sec > different > articles > how', r.order.join(' > '));
  ok('the two product cards are named as specified',
     r.lanes.join(' / ') === 'Fantasy This Week / DFS This Week', r.lanes.join(' / '));
  // The five destinations each card owes, as routes that exist.
  const want = ['/weekly-rankings', '/fantasy#startsit', '/season-long-rankings', '/trade-finder', '/faab',
                '/dfs#dfPlayWeek', '/dfs#lineup', '/dfs#dfTune', '/dfs#stacks', '/dfs#values'];
  ok('the Fantasy card links rankings, start/sit, rest of season, trades and waivers',
     want.slice(0, 5).every(h => r.laneLinks.includes(h)), r.laneLinks.slice(0, 5).join(','));
  ok('the DFS card links contest, lineup, the multi-lineup builder, stacks and values',
     want.slice(5).every(h => r.laneLinks.includes(h)), r.laneLinks.slice(5).join(','));
  ok('and nothing else is a card link', r.laneLinks.length === want.length, String(r.laneLinks.length));
  ok('the method section is on the page and is the hero link’s target', r.how5 === true);
  await ctx.close();
}

// ── 3. the live pass: real numbers, and the decision the gap implies ────────
console.log('\nwith the boards answering');
{
  const { page, ctx } = await open(1280, 900);
  const r = await read(page);

  ok('the dateline names the week off the schedule', /Week 3/.test(r.clock || ''), r.clock);

  // Each card shows ONE real current output.
  ok('the Fantasy card recommends a real player', /Drake London/.test(r.fnRead || ''), r.fnRead);
  ok('and states the three numbers behind it',
     /16\.8/.test(r.fnRead) && /12\.1/.test(r.fnRead) && /15\.2/.test(r.fnRead), r.fnRead);
  ok('the DFS card shows a real current slate output',
     /Rome Odunze/.test(r.dfRead || '') && /\$5,400/.test(r.dfRead) && /3\.21/.test(r.dfRead), r.dfRead);
  // One player, one place: the card's pick is taken out of the table below it.
  ok('the card’s player is not repeated in the table',
     !r.rows.some(x => x.who === 'Drake London'), r.rows.map(x => x.who).join(','));

  ok('the disagreement section is shown', r.diff === true);
  ok('it shows three to five players', r.rows.length >= 3 && r.rows.length <= 5, String(r.rows.length));
  ok('every row carries all three projections',
     r.rows.every(x => x.nums.length === 3 && x.nums.every(n => /^\d+\.\d$/.test(n))),
     JSON.stringify(r.rows.map(x => x.nums)));
  // The translation the spec asks for: a number turned into an instruction.
  const ACTIONS = new Set(['Start', 'Sit', 'Upgrade', 'Downgrade', 'Value play', 'Fade']);
  ok('every row ends in one of the six decisions',
     r.rows.every(x => ACTIONS.has(x.act)), r.rows.map(x => x.act).join(','));
  ok('and shows the gap the decision came from',
     r.rows.every(x => /market [+-]\d+\.\d pts vs consensus/.test(x.why || '')), r.rows.map(x => x.why).join(' / '));
  // The four rules the mapping encodes, each pinned to a row of the fixture.
  const by = n => r.rows.find(x => x.who === n);
  ok('a strong buy on a startable player is a Start', by('Cam Ward') && by('Cam Ward').act === 'Start');
  ok('a strong buy on a player outside the starting window is a Value play',
     by('Tank Bigsby') && by('Tank Bigsby').act === 'Value play');
  ok('a strong fade on a player you would be starting is a Sit',
     by('Derrick Henry') && by('Derrick Henry').act === 'Sit');
  ok('a strong fade on a bench player is a Fade', by('Blake Corum') && by('Blake Corum').act === 'Fade');
  ok('a lean the market likes is an Upgrade', by('James Cook') && by('James Cook').act === 'Upgrade');
  // The two rows that must never appear.
  ok('a player the market agrees about is not a disagreement',
     !r.rows.some(x => x.who === 'Agreeable Wideout'));
  ok('a row missing a projection is dropped, not printed with a dash',
     !r.rows.some(x => x.who === 'Holey Wideout') && !r.rows.some(x => x.nums.includes('—')));
  ok('the table says what scoring the numbers are at',
     /default scoring/.test(r.fine || '') && /Week 3/.test(r.fine || ''), r.fine);

  ok('the articles section is shown', r.articles === true);
  ok('it is a SMALL group — three at a time', r.cards.length === 3, String(r.cards.length));
  ok('every card has a real destination',
     r.cards.every(h => /^\/in-season\/desk\//.test(h)), r.cards.join(','));
  // THE ARCHIVE IS NOT THE COVER. Held drafts are served at /api/content in
  // this harness; a card carrying one means the page read the archive again.
  ok('no held draft reaches the cover', !/HELD DRAFT/.test(r.body),
     (r.body.match(/HELD DRAFT \d/) || [''])[0]);
  ok('and no story appears on the cover twice',
     new Set(r.cards).size === r.cards.length, r.cards.join(','));

  // ── the hero's picture ────────────────────────────────────────────────
  // The page had no photograph of a football player on it at all. It has one
  // now, and who it is comes off a feed rather than a choice: the player the
  // desk's newest piece is about, else the widest market gap on the board.
  ok('the hero carries a picture of a player', r.edge === true && r.edgePlate === true);
  ok('it is the desk’s current subject when the desk names one',
     r.edgeName === 'Puka Nacua', r.edgeName);
  ok('and it says that is what it is', /desk/i.test(r.edgeK || ''), r.edgeK);
  ok('captioned with why he is pictured, in the desk’s own words',
     r.edgeGap === 'Three lineups the market moved overnight', r.edgeGap);
  ok('the second hero column exists only once there is a picture in it', r.edgeCols === true);

  // The faces on the two card readings and on the desk's cards.
  ok('each card’s one reading carries the face of the player it names', r.readPics === 2, String(r.readPics));
  ok('the desk’s cards carry the faces their findings name', r.cardFaces >= 3, String(r.cardFaces));

  ok('and no loading copy survives anywhere on the page', !LOADING.test(r.body),
     (r.body.match(LOADING) || [''])[0]);
  await ctx.close();
}

// ── 3b. the hero's picture with no desk subject ────────────────────────────
// The desk does not always break a piece into named findings. Then the picture
// falls back to the board — and never to the player the Fantasy card already
// recommends, because the same man photographed twice above the fold is the
// page saying it once and looking like it said it twice.
console.log('\nwith the desk naming nobody');
{
  const full = CONTENT.pieces;
  CONTENT.pieces = full.map(p => ({ ...p, components: undefined }));
  const { page, ctx } = await open(1280, 900);
  const r = await read(page);
  ok('the hero still carries a picture', r.edge === true && r.edgePlate === true);
  // One of the widest gaps, taking its turn — the first of them at turn 0.
  // It used to be the single widest and nothing else, which is how one player
  // held the cover for a day and a half while the cards under him rotated.
  ok('it is a gap off the top of the board', r.edgeName === 'Cam Ward', r.edgeName);
  ok('and it says so', /market gap/i.test(r.edgeK || ''), r.edgeK);
  ok('but it no longer claims to be the widest, because it takes turns',
     !/widest/i.test(r.edgeK || ''), r.edgeK);
  ok('captioned with the two numbers and the gap between them',
     /19\.9/.test(r.edgeGap || '') && /15\.2/.test(r.edgeGap || '') && /\+4\.7/.test(r.edgeGap || ''), r.edgeGap);
  ok('never the player the Fantasy card already recommends',
     r.edgeName !== 'Drake London' && /Drake London/.test(r.fnRead || ''), r.edgeName);
  ok('a piece with no findings still gets a card, just no faces on it',
     r.cards.length === 3 && r.cardFaces === 0, r.cards.length + '/' + r.cardFaces);
  CONTENT.pieces = full;
  await ctx.close();
}

// ── 3c. the two card readings take turns as well ───────────────────────────
// THE THIRD AND FOURTH PATHS ONTO THE COVER. §88 enumerated two and fixed both;
// the readings under them printed the top row of a board that barely moves
// inside a week, so the cover changed hourly above a Fantasy call and a DFS
// value that did not change at all. tools/test-newsroom.mjs drives the picker
// itself turn by turn; this is the same rule in a real browser, on the page,
// with the captions attached.
console.log('\nthe card readings take turns too');
{
  const at = async (t) => { const { page, ctx } = await open(1280, 900, t); const r = await read(page); await ctx.close(); return r; };
  const now = await at(CLOCK);
  const later = await at(CLOCK + TURN_MS);
  const who = t => (t || '').split(' ').slice(0, 2).join(' ');

  ok('the Fantasy card names a different player a turn later',
     who(now.fnRead) !== who(later.fnRead), who(now.fnRead) + ' / ' + who(later.fnRead));
  ok('and it is still one of the week\u2019s buys', /Cam Ward/.test(later.fnRead || ''), later.fnRead);
  ok('the DFS card names a different player a turn later',
     who(now.dfRead) !== who(later.dfRead), who(now.dfRead) + ' / ' + who(later.dfRead));

  // A superlative is the leader's alone. Rotated off the top of its board, a
  // caption claiming the top of the board would simply be false.
  ok('the leader is called the best value on the slate',
     /Best market value/.test(now.dfRead || '') && /Rome Odunze/.test(now.dfRead || ''), now.dfRead);
  ok('and a runner-up is called a value play instead',
     /Market value play/.test(later.dfRead || '') && !/Best/.test(later.dfRead || ''), later.dfRead);
  ok('a slate row the page cannot state in full is never rotated onto',
     !/Priceless Receiver/.test(now.body + later.body));

  // Off the clock and nothing else: two readers at one moment see one page,
  // and a reader who reloads is not handed a shuffle.
  const again = await at(CLOCK);
  ok('two readings at the same hour agree',
     again.fnRead === now.fnRead && again.dfRead === now.dfRead && again.edgeName === now.edgeName);
}

// ── 4. the refusing pass: the whole point of the rewrite ────────────────────
console.log('\nwith every feed refusing');
MODE = 'dead';
for (const [w, h, tag] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
  const { page, ctx } = await open(w, h);
  const r = await read(page);
  ok(`${tag}: the hero still says the thing`, r.h1 === 'Anyone can publish a projection. Vegas has money on theirs.');
  ok(`${tag}: both buttons still work`, r.cta.length === 2);
  ok(`${tag}: the dateline is absent rather than loading`, r.clock === null);
  ok(`${tag}: the Fantasy card keeps its links and drops its reading`,
     r.fnRead === null && r.laneLinks.length === 10);
  ok(`${tag}: the DFS card too`, r.dfRead === null);
  ok(`${tag}: the disagreement section is hidden, not empty`, r.diff === false && r.rows.length === 0);
  ok(`${tag}: the articles section is hidden, not empty`, r.articles === false && r.cards.length === 0);
  ok(`${tag}: the method and the disclosures are still there`, r.how5 === true);
  // The picture obeys the same rule as every other band: absent, not a frame
  // with nothing in it — and the hero goes back to one full-width column so
  // there is no empty gutter beside the headline either.
  ok(`${tag}: the hero picture is absent rather than an empty frame`,
     r.edge === false && r.edgePlate === false && r.edgeCols === false);
  ok(`${tag}: and the card readings carry no faces`, r.readPics === 0, String(r.readPics));
  ok(`${tag}: nowhere on the page says it is loading`, !LOADING.test(r.body),
     (r.body.match(LOADING) || [''])[0]);
  ok(`${tag}: and it still does not scroll sideways`, r.overflow === 0, String(r.overflow));
  await ctx.close();
}

// ── 5. the sixth decision, on a board with room for it ─────────────────────
// The table is capped at five rows and the fixture above spends all five on the
// stronger calls, so the downgrade gets a board of its own rather than a sixth
// row that would silently fall off the bottom.
console.log('\nwith a board of leans');
{
  MODE = 'live';   // section 4 left every feed refusing
  const full = EDGE.vsExperts;
  EDGE.vsExperts = { buys: [full.buys[0], full.buys[3]], fades: [
    mk('Dallas Goedert', 'TE', 'PHI', 'DAL', 10.9, 9.2, 9.8, 'VEGAS LEANS LOWER', 10),
    mk('Chuba Hubbard', 'RB', 'CAR', 'ATL', 12.4, 10.9, 11.4, 'VEGAS LEANS LOWER', 22),
    full.fades[0]
  ]};
  const { page, ctx } = await open(1280, 900);
  const r = await read(page);
  const by = n => r.rows.find(x => x.who === n);
  ok('a lean the market dislikes is a Downgrade',
     by('Dallas Goedert') && by('Dallas Goedert').act === 'Downgrade',
     r.rows.map(x => x.who + '=' + x.act).join(', '));
  ok('and it is still stated as a gap in points',
     by('Dallas Goedert') && /market -1\.7 pts vs consensus/.test(by('Dallas Goedert').why));
  EDGE.vsExperts = full;
  await ctx.close();
}

// ── 6. fewer than three disagreements is not a section ──────────────────────
console.log('\nwith only two disagreements on the board');
{
  MODE = 'live';
  const full = EDGE.vsExperts;
  // One buy for the card, two rows left over — below the three the spec asks for.
  EDGE.vsExperts = { buys: [full.buys[0], full.buys[1]], fades: [full.fades[0]] };
  const { page, ctx } = await open(1280, 900);
  const r = await read(page);
  ok('the card still recommends a player', /Drake London/.test(r.fnRead || ''), r.fnRead);
  ok('but the table is hidden rather than short', r.diff === false, String(r.rows.length));
  ok('and nothing on the page apologizes for it', !LOADING.test(r.body));
  EDGE.vsExperts = full;
  await ctx.close();
}

ok('no page threw', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
