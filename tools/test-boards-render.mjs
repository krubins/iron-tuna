#!/usr/bin/env node
// The in-season boards, rendered in a browser.
//   node tools/test-boards-render.mjs
//
// THE GAP THIS FILLS. Every other gate in this repo is node reading source
// text, and on 2026-09-21 four board pages, one shared board file and the
// stylesheet all changed at once: the rankings boards learned to adopt a
// pre-render served with the page, and /weekly-*-rankings, /fantasy, /previews
// and /weekly-wrap each learned to keep their view in the URL and hand a
// reader a link to the row in front of them.
//
// Not one of those behaviours is visible to a file-reading gate. A board that
// throws on load, a pre-render that is never removed, a share button wired to
// nothing and an address bar that never updates all pass every other suite in
// tools/ — and `main` deploys on merge, so the first reader to find out is a
// reader on irontuna.com.
//
// WHAT IT ASSERTS, and why each one is here rather than in test-seo.mjs:
//
//   - nothing threw. The four pages carry hand-written inline scripts; a
//     typo in one of them is invisible to `node --check` because the file is
//     HTML;
//   - the pre-render is REMOVED once the live board paints. Two tables of the
//     same rows is two tables a screen reader walks and a crawler weighs, and
//     the removal is a single line that is easy to lose in a refactor;
//   - the pre-render STAYS when the board does not answer. The opposite rule,
//     and the one a well-meaning edit is likely to "fix" into consistency with
//     the file's usual "nothing rather than something stale";
//   - a row links /player/<slug>. The boards pointed at the noindex page until
//     this changed, and a revert would be silent;
//   - the URL says what is on screen, and the copy button fills the address
//     bar before it touches the clipboard.
//
// THE PRE-RENDER IS THE REAL ONE. rkPreHtml is lifted out of _worker.js and run
// here, rather than a hand-written stand-in being pasted in, so this exercises
// the markup a reader is actually served and a change to that function shows up
// here instead of in production.
//
// Needs playwright-core plus a Chromium binary, and follows test-homepage.mjs:
// it skips cleanly where they are absent so it never blocks a contributor's
// machine — EXCEPT under REQUIRE_BROWSER=1, which CI sets, where a skip is a
// failure instead.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

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
].find((p) => p && fs.existsSync(p));
if (!CHROME) absent('no Chromium binary', 'set CHROMIUM_PATH, or run `npx playwright-core install chromium`');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── the payloads, in the shapes the worker actually sends ───────────────────
// Field for field what buildBoards emits and /it-ranks.js reads: a consensus
// and a vegas side each with points and both rank forms, the marketDelta the
// gap column classifies, and weeks[0] for the fixture.
const mkPlayer = (i, name, pos, team) => ({
  key: pos + i, name, position: pos, team, games: 14,
  weeks: [{ week: 3, home: i % 2 === 0, opponent: 'KC', bye: false, out: false,
            consensusPts: 14.2, vegasPts: 13.8, ironTunaPts: 14.0, basis: 'props' }],
  consensus: { points: 22.4 - i * 0.3, rank: i + 1, flexRank: i + 1 },
  vegas: { points: 20.9 - i * 0.2, basis: ['props', 'gamelines', 'ratings'][i % 3], rank: i + 2, flexRank: i + 2 },
  marketDelta: { points: (i % 3 - 1) * 1.4, rank: i % 3 - 1, classification: 'market is higher' },
  ironTuna: { points: 21.6 - i * 0.25 },
});
const ROSTER = [['Bijan Robinson', 'RB'], ['Ja\'Marr Chase', 'WR'], ['Josh Allen', 'QB'],
                ['Trey McBride', 'TE'], ['Puka Nacua', 'WR']];
const BOARDS = {
  ok: true, scoring: { label: 'PPR' }, season: 2026, played: 0,
  horizon: { label: 'This week', weeks: [3] }, sources: { props: 120, usage: 2 },
  players: Array.from({ length: 40 }, (_, i) =>
    mkPlayer(i, ROSTER[i % 5][0] + (i < 5 ? '' : ' ' + i), ROSTER[i % 5][1], 'ATL')),
};
const GAMES = Array.from({ length: 6 }, (_, i) => ({
  id: '2026_03_ATL_KC' + (i || ''), game: 'ATL at KC' + (i || ''),
  home: 'KC' + (i || ''), away: 'ATL', kickoff: Date.now() + 86400000, status: 'pre',
  total: 47.5 + i, spread: -3.5, favorite: 'KC', impliedAway: 22, impliedHome: 25.5,
  ironTunaTotal: 46.1, gap: -1.4, gapAgrees: i % 2 === 0, movement: { total: 0.5, spread: -0.5 },
}));
const WRAP = { ok: true, week: 3, games: GAMES.map((g, i) => ({
  away: g.away, home: g.home, matchup: g.game, kickoff: g.kickoff,
  status: i < 2 ? 'final' : 'pre', awayScore: i < 2 ? 21 : null, homeScore: i < 2 ? 24 : null,
  recap: i === 0 ? { url: '/in-season/desk/recap/3/x', headline: 'KC held on',
                     wrap: 'A one-score game.', components: [], byline: 'Iron Tuna',
                     publishedAt: Date.now() } : null,
})) };

// ── the worker's own pre-render, lifted and run ─────────────────────────────
const src = read('_worker.js');
const lift = (a, b) => { const i = src.indexOf(a); return i < 0 ? null : src.slice(i, src.indexOf(b, i) + b.length); };
const rkPreHtml = new Function(
  lift('const RK_PRERENDER_ROWS', '\n}') + '\n' + lift('function rkPreHtml(pre) {', '\n}')
  + '\nreturn rkPreHtml;')();
const PRERENDER = rkPreHtml({
  host: '', horizon: 'week', pos: 'ALL', label: 'This week', payload: BOARDS,
});

// ── the server ──────────────────────────────────────────────────────────────
// Files off disk, /api/ stubbed, and on the rankings page the pre-render put
// where the worker puts it: inside the board's own host, ahead of everything
// /it-ranks.js appends. MODE decides whether the board answers at all.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
                '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain' };
let MODE = 'live', PRE_ON = true;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let body = { ok: false, error: 'unavailable' };
    if (MODE === 'live') {
      if (u.pathname === '/api/boards') body = BOARDS;
      else if (u.pathname === '/api/vegas-edge') body = { ok: true, week: 3, gameEnvironments: GAMES };
      else if (u.pathname === '/api/weekly-wrap') body = WRAP;
      else if (u.pathname === '/api/season') body = { ok: true, week: { type: 'REG', number: 3 } };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  const fp = path.join(ROOT, u.pathname === '/' ? 'front.html' : u.pathname.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  let out = fs.readFileSync(fp);
  if (PRE_ON && fp.endsWith('.html')) {
    const html = out.toString('utf8');
    // Exactly what _worker.js does: the pre-render goes inside the host, and
    // /players gets the directory the worker renders into its own.
    if (/<div class="rk-board"[\s\S]{0,600}?>/.test(html)) {
      out = Buffer.from(html.replace(/(<div class="rk-board"[\s\S]{0,600}?>)/, (m) => m + PRERENDER), 'utf8');
    } else if (html.includes('<div class="pl-index" data-players-index></div>')) {
      out = Buffer.from(html.replace('<div class="pl-index" data-players-index></div>',
        () => '<div class="pl-index" data-players-index><section class="pl-sec"><h2 id="qb">Quarterbacks</h2>'
          + '<ul class="pl-list"><li><a href="/player/josh-allen">Josh Allen</a> <span>BUF</span></li></ul></section></div>'), 'utf8');
    }
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(out);
});
await new Promise((r) => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
async function open(pathname) {
  const ctx = await browser.newContext();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404|net::ERR|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text());
  });
  await page.goto(BASE + pathname, { waitUntil: 'networkidle' });
  return { page, ctx, errs };
}

console.log('\nthe rankings board adopts what the edge served it');
{
  const { page, ctx, errs } = await open('/weekly-rankings.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the pre-render is gone once the live board painted',
     await page.locator('[data-rk-prerender]').count() === 0);
  ok('the live board painted its rows', await page.locator('table.rk-vs tbody tr').count() > 10);
  // The buttons are inserted BEFORE the pre-render, so that for the moment both
  // are on screen the page still reads controls, board, notes.
  ok('the scoring buttons sit above the board', await page.locator('.rk-board > .rk-tools').count() === 1);
  ok('every row carries an id to link to', await page.locator('tbody tr[id^="p-"]').count() > 10);
  const href = await page.locator('td.rk-who a').first().getAttribute('href');
  ok('a row links the card', /^\/player\/[a-z0-9-]+$/.test(href || ''), href);
  ok('and carries no dead ?pos=', !/\?pos=/.test(href || ''), href);
  await ctx.close();
}

console.log('\na board that does not answer keeps the rows it was served');
{
  MODE = 'dead';
  const { page, ctx, errs } = await open('/weekly-rankings.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the pre-rendered rows are still on screen',
     await page.locator('[data-rk-prerender] tbody tr').count() > 10);
  const note = (await page.locator('.rk-board p.is-empty').textContent()) || '';
  ok('and the note says where they came from', /served with this page/.test(note), note.slice(0, 80));
  ok('it does not claim the board is being read', !/Reading the board/.test(note), note.slice(0, 80));
  await ctx.close();
  MODE = 'live';
}

console.log('\nand with no pre-render it still refuses rather than go stale');
{
  MODE = 'dead'; PRE_ON = false;
  const { page, ctx, errs } = await open('/weekly-rankings.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('no table is shown', await page.locator('table.rk-vs tbody tr').count() === 0);
  const note = (await page.locator('.rk-board p.is-empty').textContent()) || '';
  ok('and it says so in the old words', /rather than a ranking that may be stale/.test(note), note.slice(0, 80));
  await ctx.close();
  MODE = 'live'; PRE_ON = true;
}

console.log('\nthe board says what is on screen, and hands it over');
{
  const { page, ctx, errs } = await open('/weekly-rankings.html');
  await page.locator('button.rk-share').first().click();
  await page.waitForTimeout(400);
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the copy button puts the row in the address bar', /[?&]player=/.test(page.url()), page.url());
  ok('and marks exactly that row', await page.locator('tbody tr.rk-hit').count() === 1);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  ok('and copies an absolute link naming it', /^http.*[?&]player=[a-z0-9-]+#p-/.test(copied), copied);
  await page.locator('th[data-key="gap"]').first().click();
  await page.waitForTimeout(400);
  ok('sorting a column lands in the URL', /[?&]sort=gap/.test(page.url()), page.url());
  await ctx.close();
}

console.log('\nand a link restores the view it was taken from');
{
  const { page, ctx, errs } = await open('/weekly-rankings.html?player=josh-allen&sort=gap&dir=desc');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the row the link names is marked', await page.locator('tr#p-josh-allen.rk-hit').count() === 1);
  ok('and the sort it was shared with is applied',
     await page.locator('th[data-key="gap"]').first().getAttribute('aria-sort') === 'descending');
  await ctx.close();
}

console.log('\n/fantasy');
{
  const { page, ctx, errs } = await open('/fantasy.html?pos=TE');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  // The control is moved onto the URL, not the other way round: otherwise the
  // address says TE and the button group still says RB.
  ok('?pos= moved the control too', await page.locator('#fnPos input[value="TE"]').isChecked());
  ok('every row carries an id', await page.locator('#fnBody tr[id^="p-"]').count() > 0);
  await ctx.close();
}

console.log('\n/dfs');
{
  // NOTHING IN CI OPENED THIS PAGE UNTIL NOW. /dfs carries the largest inline
  // script on the site and every gate that covered it was node reading source
  // text, which cannot see a throw on load. It was rebuilt on 2026-09-22 —
  // nameplate, left rail, three stories, player rail — and the board switch
  // moved out of a sticky ribbon and into that rail, so the one thing most
  // worth asserting is that the switch still switches from where it now
  // lives.
  //
  // The slate feed is not stubbed here, so the page runs its own
  // not-ready path: the switch takes itself off, the boards stay hidden and
  // each well prints its empty state. That is the state to assert for free;
  // the switch is then forced on to exercise the handler.
  const { page, ctx, errs } = await open('/dfs.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the nameplate is on the screen, not off it',
     await page.locator('.sl-mast h1').isVisible());
  ok('the rail carries the five boards', await page.locator('.sl-nav #dfNav button').count() === 5);
  ok('and the rest of the page beside them', await page.locator('.sl-nav-more a').count() > 0);
  ok('the desk says why it is empty rather than nothing',
     ((await page.locator('#dfDeskEmptyH').textContent()) || '').length > 0);
  ok('so does the player rail', ((await page.locator('#dfUpdEmptyH').textContent()) || '').length > 0);
  // The switch hides itself until the slate is set up; forcing it on is how
  // this harness reaches the handler without stubbing the whole lobby.
  await page.evaluate(() => { document.getElementById('dfNav').hidden = false; });
  await page.locator('.sl-nav #dfNav button[data-sec="stacks"]').click();
  await page.waitForTimeout(200);
  ok('a rail button shows its board', await page.locator('#sec-stacks').isVisible());
  ok('and hides the one that was up', await page.locator('#sec-lineup').isHidden());
  ok('and marks itself pressed',
     await page.locator('.sl-nav #dfNav button[data-sec="stacks"]').getAttribute('aria-pressed') === 'true');
  await ctx.close();
}
{
  // The front page has linked /dfs#values and /dfs#builder since those lane
  // cards were written, and neither anchor has ever existed here: the sections
  // are id="sec-values" and they are hidden until the switch picks them. The
  // hash names a BOARD now, so the links that were already written work.
  const { page, ctx, errs } = await open('/dfs.html#values');
  ok('#values opens the values board', await page.locator('#sec-values').isVisible(), errs.join(' | '));
  await ctx.close();
}
{
  const { page, ctx } = await open('/dfs.html#builder');
  ok('#builder lands on the lineup, which is where the builder is',
     await page.locator('#sec-lineup').isVisible());
  await ctx.close();
}

console.log('\n/previews');
{
  const { page, ctx, errs } = await open('/previews.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the cards rendered', await page.locator('article.rk-game').count() === GAMES.length);
  ok('each is addressable', await page.locator('article.rk-game[id^="g-"]').count() === GAMES.length);
  await page.locator('button.gm-share').first().click();
  await page.waitForTimeout(400);
  ok('the copy button puts the game in the address bar', /[?&]game=/.test(page.url()), page.url());
  await ctx.close();
}

console.log('\n/weekly-wrap');
{
  const { page, ctx, errs } = await open('/weekly-wrap.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  ok('the cards rendered', await page.locator('article.ww-game').count() === WRAP.games.length);
  ok('each is addressable', await page.locator('article.ww-game[id^="g-"]').count() === WRAP.games.length);
  await page.locator('button.gm-share').first().click();
  await page.waitForTimeout(400);
  ok('the copy button puts the game in the address bar', /[?&]game=/.test(page.url()), page.url());
  await ctx.close();
}

console.log('\n/players and /player');
{
  const { page, ctx, errs } = await open('/players.html');
  ok('the hub threw nothing', errs.length === 0, errs.join(' | '));
  ok('the directory the worker renders is on the page',
     await page.locator('.pl-list a[href^="/player/"]').count() > 0);
  ok('and the footer links it from everywhere', await page.locator('footer a[href="/players"]').count() === 1);
  await ctx.close();
}
{
  const { page, ctx, errs } = await open('/player.html');
  ok('the card shell threw nothing', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
