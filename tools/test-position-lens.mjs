#!/usr/bin/env node
// Regression test for the front page's EDITION switch and the reading lens
// underneath it.
//   node tools/test-position-lens.mjs
//
// THE BUG THIS EXISTS FOR: every "Your league" line under a story has to commit
// to a draft type, and the page used to take that silently from the saved
// league. A reader whose app is set up for a snake draft got the whole of an
// AUCTION site's front page written in draft slots, with no way to say
// otherwise — and no reader who had never opened the app got anything at all.
//
// The control that answers it is the ribbon's Auction / Snake switch, which
// every reader gets: it re-points every story to that edition's drop page,
// re-words the copy that names a format, and sets the reading lens underneath.
// It replaced a Position Intel Auction/Snake switch that only appeared for
// readers with a saved board. Best ball was a third button here until the
// auction-first pass of August 2026 took it off every surface; an edition the
// switch does not offer falls back to auction, which is asserted below.
//
// The maths and the copy are covered by tools/test-it-league.mjs against a stub
// DOM. What only a browser can prove is the WIRING: that one click moves the
// modules, the lead, the links and the copy together, and that the choice
// survives a reload.
//
// Needs playwright-core plus a Chromium binary (preinstalled at /opt/pw-browsers
// in Claude Code remote sessions, else set CHROMIUM_PATH). Skips cleanly rather
// than failing when they are absent, so it never blocks a machine without them.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.log('SKIP — needs playwright-core (' + e.message.split('\n')[0] + ')');
  process.exit(0);
}
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
       .find(p => fs.existsSync(p));
if (!CHROME) { console.log('SKIP — no Chromium binary; set CHROMIUM_PATH'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const fp = path.join(ROOT, u.pathname === '/' ? 'front.html' : u.pathname.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// A board wide enough that the front page's real stories find someone on it:
// the lens is only visible where a call can actually be translated.
const BOARD = {
  ts: 1, sv: 2, teams: 10, budget: 300, format: 'snake',
  players: [
    { n: 'Drake London', pos: 'WR', v: 44, pts: 280 },
    { n: 'Rome Odunze', pos: 'WR', v: 30, pts: 250 },
    { n: 'DJ Moore', pos: 'WR', v: 26, pts: 240 },
    { n: 'James Cook', pos: 'RB', v: 35, pts: 240 },
    { n: 'Blake Corum', pos: 'RB', v: 8, pts: 150 },
    { n: 'Derrick Henry', pos: 'RB', v: 33, pts: 235 },
    { n: 'Justin Herbert', pos: 'QB', v: 18, pts: 300 },
    { n: 'Cam Ward', pos: 'QB', v: 6, pts: 260 },
    { n: 'Dallas Goedert', pos: 'TE', v: 12, pts: 170 },
    { n: 'Isaiah Likely', pos: 'TE', v: 9, pts: 150 }
  ]
};
const league = (format, teams = 10, budget = 300) => JSON.stringify({ config: { teams, budget, format } });

const browser = await chromium.launch({ executablePath: CHROME });
let errors = [];
async function open(store) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(s => { for (const k in s) localStorage.setItem(k, s[k]); }, store);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  return { page, ctx };
}
const read = page => page.evaluate(() => ({
  shown: document.getElementById('edSwitch').getClientRects().length > 0,
  on: [...document.querySelectorAll('#edSwitch a')].filter(a => a.classList.contains('on')).map(a => a.dataset.ed).join(),
  sub: document.getElementById('posSub').textContent,
  lines: [...document.querySelectorAll('#posGrid .it-yours')].map(e => e.textContent),
  labels: [...new Set([...document.querySelectorAll('#posGrid .it-yours b')].map(e => e.textContent.replace(/:$/, '')))],
  lead: (document.getElementById('leadYours') || {}).textContent || '',
  // Every link on the page that has a per-edition twin, and the copy that names
  // a format. One click has to move all of it, or the reader is left on a page
  // that half agrees with them.
  drops: [...new Set([...document.querySelectorAll('#posGrid a, #railList a, #leadTitle a')]
            .map(a => (a.getAttribute('href') || '').split('-insights')[0])
            .filter(h => /^\/(auction|snake)$/.test(h)))],
  app: [...new Set([...document.querySelectorAll('a')]
            .map(a => a.getAttribute('href') || '')
            .filter(h => /^\/(auctiondraft|snakedraft)(\?|$)/.test(h))
            .map(h => h.split('?')[0]))],
  mgr: document.getElementById('navMgr').textContent,
  allocHead: document.getElementById('allocHead').textContent,
  camp: document.getElementById('campNote').textContent,
  buildTag: document.getElementById('buildTag').hidden ? '' : document.getElementById('buildTag').textContent
}));
const pick = (page, ed) => page.click('#edSwitch a[data-ed="' + ed + '"]');

// ── 1. a snake league opens in the snake edition, and can be read as an auction
console.log('\na snake league on an auction front page');
{
  const store = { iron_tuna_draft_state_v2: league('snake'), iron_tuna_values_v1: JSON.stringify(BOARD) };
  const { page, ctx } = await open(store);
  const before = await read(page);
  ok('the switch is offered', before.shown === true);
  ok('it opens on the league they saved', before.on === 'snake');
  ok('every story points at the snake edition', before.drops.join() === '/snake', before.drops.join());
  ok('the stories are written in draft slots',
     before.lines.length > 0 && before.lines.every(l => /slot/.test(l)) && !before.lines.some(l => /\$/.test(l)),
     before.lines[0]);
  ok('the standfirst says which edition it is', /snake draft/.test(before.sub), before.sub);

  await pick(page, 'auction');
  const after = await read(page);
  ok('one click re-prices every story', after.on === 'auction' && after.lines.every(l => /\$/.test(l)), after.lines[0]);
  ok('and re-points every story with it', after.drops.join() === '/auction', after.drops.join());
  ok('the same number of stories survives the switch', after.lines.length === before.lines.length);
  ok('a borrowed lens does not claim to be their league',
     after.lines.every(l => !/your \d+-team snake/.test(l)), after.lines[0]);
  ok('the standfirst follows the switch', /as an auction/.test(after.sub), after.sub);

  await page.reload({ waitUntil: 'load' });
  const back = await read(page);
  ok('the choice survives a reload',
     back.on === 'auction' && back.drops.join() === '/auction' && back.lines.every(l => /\$/.test(l)));
  ok('nothing on the page threw', errors.length === 0, errors[0]);
  await ctx.close();
}

// ── 2. an auction league is never asked to pick ────────────────────────────
console.log('\nan auction league');
{
  const { page, ctx } = await open({
    iron_tuna_draft_state_v2: league('auction', 12, 200),
    iron_tuna_values_v1: JSON.stringify({ ...BOARD, teams: 12, budget: 200, format: 'auction' })
  });
  const s = await read(page);
  ok('it opens on auction without being told', s.on === 'auction');
  ok('the stories are priced in their own dollars',
     s.lines.length > 0 && s.lines.every(l => /\$/.test(l) && /your 12-team, \$200 auction/.test(l)), s.lines[0]);
  await ctx.close();
}

// ── 3. no league: both readings, on the site's own board ───────────────────
// These are the readers least able to translate a bare percentage themselves,
// so they get the most of it — dollars, the share of a budget, and the draft
// slots — off the site's default board, labelled as the site's, never as theirs.
// No switch: with both readings in the line there is nothing to switch between.
console.log('\na reader who has never opened the app');
{
  const { page, ctx } = await open({});
  const s = await read(page);
  ok('the switch is offered anyway', s.shown === true);
  ok('and it opens on the site\u2019s own edition', s.on === 'auction');
  ok('the standfirst still ends where it shipped', /New drops land through Labor Day\.$/.test(s.sub.trim()), s.sub);
  ok('the calls are translated anyway', s.lines.length > 0, `${s.lines.length} lines`);
  ok('and never as the reader\u2019s own league',
     s.labels.length === 1 && s.labels[0] === 'Default league', s.labels.join());
  ok('every line names the league it is speaking for',
     s.lines.every(l => /in a 12-team, \$200 league/.test(l)), s.lines[0]);
  ok('every line carries dollars, a budget share AND slots',
     s.lines.every(l => /\$\d/.test(l) && /% of a budget|under 1% of a budget/.test(l) &&
                        /draft slot|endgame/.test(l)), s.lines[0]);
  ok('nothing on the page threw', errors.length === 0, errors[0]);
  await ctx.close();
}

// ── 4. the lead quotes the same calls, so it moves with them ───────────────
console.log('\nthe lead and the modules agree');
{
  // Every deep dive the lead can land on is a Market call; give the board the
  // players those calls name so the lead has something to translate.
  const board = {
    ...BOARD, format: 'auction',
    players: BOARD.players.concat([
      { n: 'Josh Allen', pos: 'QB', v: 30, pts: 340 },
      { n: 'Jahmyr Gibbs', pos: 'RB', v: 50, pts: 270 },
      { n: 'Breece Hall', pos: 'RB', v: 28, pts: 225 },
      { n: 'Puka Nacua', pos: 'WR', v: 42, pts: 275 },
      { n: 'Quinshon Judkins', pos: 'RB', v: 14, pts: 190 },
      { n: 'Bo Nix', pos: 'QB', v: 7, pts: 265 },
      { n: 'Caleb Williams', pos: 'QB', v: 5, pts: 255 }
    ])
  };
  const { page, ctx } = await open({
    iron_tuna_draft_state_v2: league('auction'),
    iron_tuna_values_v1: JSON.stringify(board)
  });
  // Walk the lead to a deep dive that tailors, then switch and check it moved.
  const leadAt = () => page.evaluate(() => (document.getElementById('leadYours') || {}).textContent || '');
  let lead = await leadAt();
  for (let i = 0; i < 12 && !lead; i++) { await page.click('#leadNext'); lead = await leadAt(); }
  if (!lead) { console.log('  ..   no deep dive on this board tailors — lead check skipped'); }
  else {
    ok('the lead is priced in dollars to start', /\$/.test(lead), lead);
    await pick(page, 'snake');
    const moved = await leadAt();
    ok('the lead follows the same switch as the modules', /slot|hold/.test(moved) && !/\$\d/.test(moved), moved);
  }
  await ctx.close();
}

// ── 5. the whole page moves, not just the tailored lines ──────────────────
// The complaint that put this switch in the ribbon was that a reader who came
// for another draft was still handed the auction site. So the test is not "the
// switch has two buttons": it is that ONE click moves the drop links, the
// app links, the button that names the room, the guides module and the camp
// desk's standing note together.
console.log('\nthe whole page follows the edition');
{
  const { page, ctx } = await open({});
  const a = await read(page);
  ok('auction opens on the auction room', a.app.join() === '/auctiondraft', a.app.join());
  ok('and names it', a.mgr === 'Auction Manager', a.mgr);
  ok('the auction keeps its allocation guides', a.allocHead === 'Asset Allocation', a.allocHead);
  ok('and The Build needs no tag to say which currency it is in', a.buildTag === '', a.buildTag);

  // The switch offers exactly two editions now, and the site sells one of them.
  ok('the switch offers auction and snake, and nothing else',
     (await page.$$eval('#edSwitch a', as => as.map(x => x.dataset.ed).join())) === 'auction,snake');
  ok('nothing on the page still sells a best ball room',
     await page.$$eval('a', as => as.every(x => !/^\/bestball/.test(x.getAttribute('href') || ''))));

  await pick(page, 'snake');
  const b = await read(page);
  ok('snake re-points every story', b.drops.join() === '/snake', b.drops.join());
  ok('every app link lands in the draft room', b.app.join() === '/snakedraft', b.app.join());
  ok('the room is named honestly', b.mgr === 'Draft Room', b.mgr);
  ok('the guides are the ones snake actually has',
     b.allocHead === 'Draft Strategy' &&
     (await page.$$eval('#allocGrid a', as => as.every(x => /snake/.test(x.getAttribute('href'))))),
     b.allocHead);
  ok('The Build says the dollars are the auction solve', b.buildTag === 'Auction solve', b.buildTag);
  ok('the camp desk stops calling itself auction-only', !/auction-relevant/.test(b.camp), b.camp);
  // The rewrite covers exactly two families of URL. Anything else that starts
  // "/auction-" has no twin in the other edition, so it must survive untouched —
  // and no link may be invented: every /snake* href has to be a page that
  // exists (the room, the drop pages, the snake strategy guide).
  ok('the camp reports keep the URLs they were published at',
     await page.$$eval('a', as => as.some(x => /^\/auction-watch-/.test(x.getAttribute('href') || ''))));
  ok('and no link is invented for a page that does not exist',
     await page.$$eval('a', as => as.map(x => x.getAttribute('href') || '')
       .filter(h => h.indexOf('/snake') === 0)
       .every(h => h === '/snakedraft' || /^\/snakedraft(\?|#|\/)/.test(h) || /^\/snake-draft-strategy$/.test(h) || /^\/snake-insights(-\d{4}-\d{2}-\d{2})?([?#]|$)/.test(h))));

  await pick(page, 'auction');
  const back = await read(page);
  ok('switching back restores the page as authored',
     back.drops.join() === '/auction' && back.app.join() === '/auctiondraft' &&
     back.mgr === 'Auction Manager' && back.allocHead === 'Asset Allocation' &&
     /auction-relevant/.test(back.camp) && back.buildTag === '');
  ok('and the authored guides come back whole',
     await page.$$eval('#allocGrid .alloc-card', c => c.length === 4));
  ok('nothing on the page threw', errors.length === 0, errors[0]);
  await ctx.close();
}

// ── 6. the generated lead survives a switch ───────────────────────────────
// The desk's three-hourly story REPLACES the dated rotation (HANDOFF §17). A
// switch that re-ran the dated renderer would silently undo that and put a
// week-old deep dive back on the front page — which is what the old lens
// switch did. The lead here is stubbed, because what is under test is the
// wiring, not the desk.
console.log('\na generated lead and a switch');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/lead-story', r => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      story: {
        slug: 'a-test-story-2026-08-21-12', title: 'The desk published this one',
        dek: 'And it is the lead until the next run.', category: null, label: 'Insight',
        ppl: [], cast: [], createdAt: Date.now(), url: '/lead/a-test-story-2026-08-21-12'
      },
      recent: []
    })
  }));
  await page.goto(BASE, { waitUntil: 'load' });
  const title = () => page.textContent('#leadTitle');
  await page.waitForFunction(() => /desk published/.test(document.getElementById('leadTitle').textContent));
  ok('the generated story is the lead', /desk published/.test(await title()));
  await pick(page, 'snake');
  ok('and a switch leaves it there', /desk published/.test(await title()), await title());
  ok('the modules moved underneath it anyway', (await read(page)).drops.join() === '/snake');
  ok('nothing on the page threw', errors.length === 0, errors[0]);
  await ctx.close();
}

// ── 7. a shared link opens in the edition it was shared from ───────────────
console.log('\na ?fmt= link');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '?fmt=snake', { waitUntil: 'load' });
  const s = await read(page);
  ok('it opens on the edition in the URL', s.on === 'snake' && s.drops.join() === '/snake', s.on);
  await page.reload({ waitUntil: 'load' });
  ok('and following one is remembered like a click', (await read(page)).on === 'snake');
  ok('nothing on the page threw', errors.length === 0, errors[0]);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
