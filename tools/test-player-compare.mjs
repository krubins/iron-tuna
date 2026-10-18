#!/usr/bin/env node
// "Start him or someone else?" on the weekly player page (player-intel.html,
// 18 Oct 2026), in a real browser at 390px.
//
// Most visits were one page long, and the weekly player page is where search
// lands. The page now answers the lineup call a reader brings: pick a second
// player and see both at the same scoring, off the same /api/intel/player
// answer the page is built from. This drives that box against stubbed
// payloads and checks what a reader would notice: the call, the refusals,
// the bye case, the address, the share request and the tracked success.
//
//   node tools/test-player-compare.mjs            skips without Chromium
//   REQUIRE_BROWSER=1 node tools/test-player-compare.mjs   (CI) a skip fails
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRE = process.env.REQUIRE_BROWSER === '1';
function absent(what, fix) {
  if (REQUIRE) { console.error('FAIL — ' + what + '. REQUIRE_BROWSER=1, so this is a failure rather than a skip.'); if (fix) console.error('       ' + fix); process.exit(1); }
  console.log('SKIP — ' + what + (fix ? ' (' + fix + ')' : ''));
  process.exit(0);
}
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch (e) { absent('needs playwright-core (' + e.message.split('\n')[0] + ')', 'npm install --no-save --no-package-lock playwright-core@1.56.1'); }
const CHROME = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome',
  (() => { try { return chromium.executablePath(); } catch (e) { return null; } })()].find(p => p && fs.existsSync(p));
if (!CHROME) absent('no Chromium binary', 'set CHROMIUM_PATH, or run `npx playwright-core install chromium`');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── payloads in the shape /api/intel/player answers ────────────────────────
const KICK = Date.UTC(2026, 9, 18, 17, 0);
function intel(name, position, team, o) {
  const pts = (v) => ({ rank: 10, points: v, stats: {}, confidence: 'MEDIUM' });
  const w = o.bye ? { week: 7, bye: true, out: false, gameState: 'upcoming' }
    : { week: 7, opponent: o.opp || 'TB', home: true, kickoff: KICK, gameState: o.state || 'upcoming', bye: false, out: false,
        injury: o.injury ? { status: o.injury } : null,
        ironTuna: pts(o.it), consensus: pts(o.cons), vegas: { ...pts(o.vegas), basis: o.basis || 'props' },
        marketDelta: { classification: 'AGREE', points: 0, rank: 0 } };
  return { ok: true, season: 2026, week: 7, updated: { board: KICK - 864e5, odds: KICK - 432e5 },
    player: { name, position, team }, thisWeek: w, horizons: {}, movement: {}, usage: null };
}
const INTEL = {
  'Bijan Robinson': intel('Bijan Robinson', 'RB', 'ATL', { it: 18.4, cons: 17.2, vegas: 16.0 }),
  'Jaxon Smith-Njigba': intel('Jaxon Smith-Njigba', 'WR', 'SEA', { it: 15.1, cons: 15.8, vegas: 17.0, injury: 'Questionable' }),
  'Breece Hall': intel('Breece Hall', 'RB', 'NYJ', { it: 18.0, cons: 16.1, vegas: 15.5 }),
  'Derrick Henry': intel('Derrick Henry', 'RB', 'BAL', { bye: true }),
  'Saquon Barkley': intel('Saquon Barkley', 'RB', 'PHI', { it: 14.0, cons: 14.5, vegas: 13.0, state: 'in_progress' }),
};

// ── the server ─────────────────────────────────────────────────────────────
const shares = [], track = [], asked = [];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const send = (b, st) => { res.writeHead(st || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/intel/player') {
      const n = u.searchParams.get('name'); asked.push(n);
      return INTEL[n] ? send(INTEL[n]) : send({ ok: false }, 404);
    }
    if (u.pathname === '/api/share/compare') { shares.push(JSON.parse(body)); return send({ ok: true, id: 'x', url: 'https://irontuna.com/finding/x', title: 'A comparison' }); }
    if (u.pathname === '/api/track') { try { track.push(JSON.parse(body)); } catch (e) {} res.writeHead(204); return res.end(); }
    if (u.pathname.startsWith('/api/')) return send({ ok: false });
    let p = /^\/player\/[a-z0-9-]+\/?$/.test(u.pathname) ? '/player-intel.html' : u.pathname;
    if (!/\.[a-z0-9]+$/.test(p)) p += '.html';
    const fp = path.join(ROOT, p.slice(1));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    res.end(fs.readFileSync(fp));
  });
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
// Not automation, so it-metrics.js sends what a reader's browser would.
await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
await ctx.route(/googletagmanager|google-analytics|espncdn|nfl\.com|wikimedia/, r => r.abort());
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const settle = () => page.waitForTimeout(400);
const out = () => page.textContent('#piVsOut');
const shot = async (name) => { if (process.env.SHOTS) await (await page.$('#piVs')).screenshot({ path: path.join(process.env.SHOTS, name + '.png') }); };
// Type into the box and take the first suggestion, the way a reader does.
async function pick(typed) {
  await page.fill('#piVsInput', '');
  await page.type('#piVsInput', typed, { delay: 20 });
  await page.waitForSelector('.pl-menu:not([hidden]) [role=option]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settle();
}

console.log('\nthe box on the page');
{
  await page.goto(BASE + '/player/bijan-robinson', { waitUntil: 'networkidle' }); await settle();
  ok('the weekly page rendered', /Bijan Robinson/.test(await page.textContent('#piName')));
  ok('"Start him or someone else?" is shown', await page.isVisible('#piVs') && /Start him or someone else\?/.test(await page.textContent('#piVsHead')));
  ok('it names the week and the scoring', /Week 7 at PPR/.test(await page.textContent('#piVsSub')));
}

console.log('\na clear call, with the market leaning the other way');
{
  await pick('smith-nj');
  ok('picking a player stays on this page', new URL(page.url()).pathname === '/player/bijan-robinson', page.url());
  const t = await out();
  ok('it makes the call off the Iron Tuna numbers', /Start Bijan Robinson\. Iron Tuna projects him 3\.3 points ahead of Jaxon Smith-Njigba \(18\.4 to 15\.1, at PPR\)\./.test(t), t);
  ok('it says when the market points the other way, as a derived estimate', /leans the other way: its derived estimate has Jaxon Smith-Njigba ahead, 17\.0 to 16\.0/.test(t), t);
  ok('both players are in the table', await page.$$eval('.pi-vs-tab tbody tr', r => r.length) === 2);
  ok('the leader is marked', await page.$eval('.pi-vs-tab tbody tr:first-child td.lead', n => n.textContent) === '18.4');
  ok('Vegas points say where they come from', /both from player props/.test(t) && /derived estimate, converted from sportsbook lines, not a quoted price/.test(t), t);
  ok('an injury designation carries a check', /Jaxon Smith-Njigba is listed Questionable\. Check the inactive list/.test(t), t);
  ok('the pair goes in the address', new URL(page.url()).searchParams.get('vs') === 'jaxon-smith-njigba', page.url());
  await shot('compare-call');
  await page.waitForTimeout(600);
  const succ = track.filter(x => x.event === 'tool_success' && x.props && x.props.tool === 'player_compare');
  ok('a tool_success is tracked for player_compare', succ.length === 1 && succ[0].props.key === 'bijan-robinson-vs-jaxon-smith-njigba' && succ[0].props.scoring === 'ppr', JSON.stringify(track));
  ok('the tracked event carries only listed fields', succ.length === 1 && !/Questionable|18\.4|ATL/.test(JSON.stringify(succ[0])), JSON.stringify(succ));
}

console.log('\nsharing the comparison');
{
  ok('a PPR comparison of two games still to play can be shared', await page.isVisible('#piVsOut button[data-it-share-a]'));
  ok('no My Week offer after one comparison', !(await page.$('.pi-vs-next')));
  await page.click('#piVsOut button[data-it-share-a]'); await settle();
  ok('the share asks the worker for the pair at PPR, names only', shares.length === 1 && shares[0].a === 'Bijan Robinson' && shares[0].b === 'Jaxon Smith-Njigba' && shares[0].scoring === 'ppr', JSON.stringify(shares));
}

console.log('\ntoo close, the same slot, a bye, a locked game');
{
  await pick('breece');
  ok('under a point apart is too close to separate, not a pick', /^Too close to separate\. Iron Tuna projects Bijan Robinson 18\.4 and Breece Hall 18\.0 points, at PPR\./.test((await out()).trim()), await out());
  ok('after the second comparison, My Week is offered under the answer', await page.isVisible('#piVsOut .pi-vs-next')
     && /Save your league once and My Week makes these calls for your whole roster/.test(await page.textContent('.pi-vs-next')));
  ok('it links to league setup, tagged as a surface', await page.$eval('.pi-vs-next a', a => a.getAttribute('href') === '/my-leagues#connect' && a.getAttribute('data-it-surface') === 'player_compare'));
  await shot('compare-myweek');
  const before = asked.length;
  await pick('josh allen');
  ok('a QB is refused for an RB, without a request', /do not compete for the same lineup spot\. Pick a running back, receiver or tight end\./.test(await out()) && asked.length === before, await out());
  await pick('derrick henry');
  ok('a bye answers with the other player', /Derrick Henry is on bye in Week 7\. Start Bijan Robinson\./.test(await out()), await out());
  ok('a bye cannot be shared', !(await page.$('#piVsOut button[data-it-share-a]')));
  await pick('saquon');
  const t = await out();
  ok('a kicked-off game is said to be locked, with pregame numbers', /Saquon Barkley’s game has kicked off, so his lineup spot is already locked/.test(t), t);
  ok('a kicked-off game cannot be shared', !(await page.$('#piVsOut button[data-it-share-a]')));
}

console.log('\na link with ?vs= opens on the comparison');
{
  await page.goto(BASE + '/player/bijan-robinson?vs=jaxon-smith-njigba', { waitUntil: 'networkidle' }); await settle();
  ok('the comparison is drawn from the address', /Start Bijan Robinson\./.test(await out()) && await page.inputValue('#piVsInput') === 'Jaxon Smith-Njigba', await out());
  ok('no sideways scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0);
}

console.log('\n"No thanks" keeps the offer away');
{
  await page.goto(BASE + '/player/bijan-robinson', { waitUntil: 'networkidle' }); await settle();
  await pick('smith-nj'); await pick('breece');
  ok('the offer is back on a fresh page after two comparisons', await page.isVisible('.pi-vs-next'));
  await page.click('.pi-vs-next [data-vs-no]');
  ok('"No thanks" removes it', !(await page.$('.pi-vs-next')));
  await page.goto(BASE + '/player/bijan-robinson', { waitUntil: 'networkidle' }); await settle();
  await pick('smith-nj'); await pick('breece');
  ok('and it stays away in this browser', !(await page.$('.pi-vs-next')));
}

console.log('\na player not on the board');
{
  await page.goto(BASE + '/player/bijan-robinson?vs=jahmyr-gibbs', { waitUntil: 'networkidle' }); await settle();
  ok('it says there is nothing to compare', /Jahmyr Gibbs is not on this week’s board/.test(await out()), await out());
}

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
