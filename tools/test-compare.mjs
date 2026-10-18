#!/usr/bin/env node
// /compare (compare.html, 18 Oct 2026), in a real browser at 390px. Two
// to four players.
//
// Two players, season long or DFS, weighed on the criteria the reader turns
// on, with one call at the end. The fixture is built so the answer is known
// by hand and so it FLIPS with the purpose: Bijan wins this week and his
// recent form, Breece wins the rest of the season and the playoffs, and on
// the slate Allen is the cash play and Jackson the tournament one. A page
// that ignored the weights would give the same call twice and fail here.
//
//   node tools/test-compare.mjs                     skips without Chromium
//   REQUIRE_BROWSER=1 node tools/test-compare.mjs   (CI) a skip fails
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

// ── season long: payloads in the shape /api/intel/player answers ───────────
const KICK = Date.UTC(2026, 9, 18, 17, 0);
const hz = (pts, games) => ({ games, byes: [], ironTuna: { rank: 5, points: pts, stats: {}, confidence: 'MEDIUM' },
  consensus: { rank: 6, points: pts - 1, stats: {} }, vegas: { rank: 7, points: pts + 1, stats: {}, basis: 'props' } });
const log = (pts, touches) => ({ season: 2026, throughWeek: pts.length, games: pts.map((p, i) => ({ week: i + 1, opponent: 'TB', stats: {}, points: p, targets: touches, carries: 0, snapPct: 0.7 })) });
function intel(name, position, team, o) {
  const w = o.bye ? { week: 7, bye: true, out: false, gameState: 'upcoming' }
    : { week: 7, opponent: 'TB', home: true, kickoff: KICK, gameState: 'upcoming', bye: false, out: false, injury: null };
  return { ok: true, season: 2026, week: 7, player: { name, position, team }, thisWeek: w,
    horizons: { week: hz(o.bye ? 0 : o.week, o.bye ? 0 : 1), next3: hz(o.next3, 3), ros: hz(o.ros, 10), playoffs: hz(o.playoffs, 3) },
    history: o.hist || null };
}
const INTEL = {
  // Recent 22.0 (20, 22, 24), season 17.0, 20 touches a game.
  'Bijan Robinson': intel('Bijan Robinson', 'RB', 'ATL', { week: 18, next3: 50, ros: 150, playoffs: 45, hist: log([10, 12, 14, 20, 22, 24], 20) }),
  'Breece Hall': intel('Breece Hall', 'RB', 'NYJ', { week: 14, next3: 52, ros: 200, playoffs: 66, hist: log([15, 15, 15, 15, 15, 15], 18) }),
  'Derrick Henry': intel('Derrick Henry', 'RB', 'BAL', { bye: true, next3: 40, ros: 160, playoffs: 50, hist: log([14, 16], 19) }),
  'Jaxon Smith-Njigba': intel('Jaxon Smith-Njigba', 'WR', 'SEA', { week: 18.2, next3: 50.5, ros: 151, playoffs: 45.4 }),
};

// ── DFS: a slate in the shape /api/dfs answers ─────────────────────────────
const dfsRow = (name, position, team, salary, o) => ({ name, position, team, opponent: 'MIA', home: true, salary, projected: true, available: o.available !== false,
  weekStatus: o.available === false ? 'Out' : null, weekStatusNote: '', ironTunaPoints: o.it, vegasPoints: o.it + 1, consensusPoints: o.it - 1,
  floor: o.floor, ceiling: o.ceil, ownership: o.own, tdProbability: o.td, teamTotal: o.team, injury: null });
const SLATE = { ok: true, site: 'dk', label: 'DraftKings', week: 7, formatLabel: 'DraftKings Classic', players: [
  dfsRow('Josh Allen', 'QB', 'BUF', 8000, { it: 24, floor: 16, ceil: 36, own: 22, td: 40, team: 27 }),
  dfsRow('Lamar Jackson', 'QB', 'BAL', 8200, { it: 22, floor: 13, ceil: 40, own: 8, td: 45, team: 26 }),
  dfsRow('Hurt Receiver', 'WR', 'NYG', 5000, { it: 12, floor: 6, ceil: 24, own: 5, td: 30, team: 20, available: false }),
] };

// ── the server ─────────────────────────────────────────────────────────────
const track = [], asked = [];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const send = (b, st) => { res.writeHead(st || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/intel/player') {
      const n = u.searchParams.get('name'); asked.push(u.search);
      return INTEL[n] ? send(INTEL[n]) : send({ ok: false, error: 'off_board' }, 404);
    }
    if (u.pathname === '/api/dfs') return u.searchParams.get('site') === 'fd' ? send({ ok: false, error: 'no_salaries', players: [] }) : send(SLATE);
    if (u.pathname === '/api/track') { try { track.push(JSON.parse(body)); } catch (e) {} res.writeHead(204); return res.end(); }
    if (u.pathname.startsWith('/api/')) return send({ ok: false });
    let p = u.pathname;
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
await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
await ctx.route(/googletagmanager|google-analytics|espncdn|nfl\.com|wikimedia/, r => r.abort());
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const settle = () => page.waitForTimeout(400);
const call = async () => ((await page.textContent('.cp-call').catch(() => '')) || '').trim();
const why = async () => ((await page.textContent('.cp-why').catch(() => '')) || '').trim();
const outText = () => page.textContent('#cpOut');
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: true }); };
const press = (box, label) => page.click(`#${box} button:has-text("${label}")`).then(settle);
// The criterion row's cell for A, B, and the edge column.
const cells = (label) => page.$$eval('.cp-tab tbody tr', (rows, l) => {
  const r = rows.find(x => x.querySelector('th').firstChild.textContent === l);
  return r ? [...r.querySelectorAll('td')].map(td => td.firstChild ? td.firstChild.textContent : td.textContent) : null;
}, label);
async function pick(box, typed) {
  await page.fill('#' + box, '');
  await page.type('#' + box, typed, { delay: 20 });
  await page.waitForSelector('.pl-menu:not([hidden]) [role=option]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settle();
}

console.log('\nseason long: the page and a start call');
{
  await page.goto(BASE + '/compare', { waitUntil: 'networkidle' }); await settle();
  ok('the page rendered with two pickers', await page.isVisible('#cpA') && await page.isVisible('#cpB'));
  ok('"Who to start" is the default purpose', await page.getAttribute('#cpPurpose button[data-k="start"]', 'aria-pressed') === 'true');
  ok('it asks for two to four players', /Pick at least two players to compare, up to four\./.test(await outText()));
  ok('two pickers show, with room to add more', await page.isHidden('#cpCSlot') && await page.isVisible('#cpAdd'));
  await pick('cpA', 'bijan');
  await pick('cpB', 'breece');
  ok('the start call goes to this week’s leader', await call() === 'Start Bijan Robinson.', await call());
  ok('it says how strong and how many criteria agree', /^Clear edge: 4 of the 4 criteria you counted favor Bijan Robinson\./.test(await why()), await why());
  ok('every season criterion is a row', await page.$$eval('.cp-tab tbody tr', r => r.length) === 7);
  const rec = await cells('Recent form');
  ok('recent form is the last three games a game', rec && rec[0] === '22.0' && rec[1] === '15.0', JSON.stringify(rec));
  const ytd = await cells('Season to date');
  ok('season to date is this season a game', ytd && ytd[0] === '17.0' && ytd[1] === '15.0', JSON.stringify(ytd));
  const ros = await cells('Rest of season');
  ok('a criterion turned off says so', ros && /Not counted/.test(ros[2]), JSON.stringify(ros));
  ok('the meter leans toward A', await page.$eval('.cp-meter-bar i', i => parseFloat(i.style.left)) < 50);
  ok('this season’s games are listed', /Bijan Robinson, this season: Wk 1 10\.0 · Wk 2 12\.0/.test(await outText()));
  const q = new URL(page.url()).searchParams;
  ok('the pair and the purpose go in the address', q.get('a') === 'bijan-robinson' && q.get('b') === 'breece-hall' && q.get('for') === 'start', page.url());
  await shot('compare-start');
}

console.log('\nthe call follows the criteria');
{
  await press('cpPurpose', 'Trade, add or drop');
  ok('a trade call goes to the rest-of-season leader', await call() === 'Value Breece Hall more.', await call());
  ok('and names where the other player is ahead', /^Slight edge: 3 of the 7 criteria you counted favor Breece Hall\. Bijan Robinson is ahead on This week, Recent form, Season to date and Usage\./.test(await why()), await why());
  ok('the meter leans toward B', await page.$eval('.cp-meter-bar i', i => parseFloat(i.style.left)) > 50);
  await press('cpPurpose', 'Playoff push');
  ok('a playoff call goes to the playoff leader', await call() === 'Breece Hall for the playoff run.', await call());
  // From the playoff weights, recent form to High and the playoffs Off:
  // next3 -.039, ros -.286, recent 3 x +.378 = +.810 over 5, a clear edge
  // the other way. The reader's weights decide the call, not the purpose.
  await page.click('#cpWeights button[data-c="recent"][data-v="3"]'); await settle();
  ok('changing a weight makes the purpose Custom', await page.getAttribute('#cpPurpose button[data-k="custom"]', 'aria-pressed') === 'true');
  await page.click('#cpWeights button[data-c="playoffs"][data-v="0"]'); await settle();
  ok('the reader’s weights can flip the call', await call() === 'Bijan Robinson comes out ahead.' && /^Clear edge/.test(await why()), await call() + ' / ' + await why());
}

console.log('\nscoring, a bye, a toss-up, a missing history');
{
  const before = asked.length;
  await press('cpScoring', 'Half PPR');
  ok('a scoring change asks for both players at that scoring', asked.slice(before).filter(s => /scoring=half/.test(s)).length === 2, JSON.stringify(asked.slice(before)));
  await press('cpPurpose', 'Who to start');
  await pick('cpB', 'derrick henry');
  ok('a bye answers a start call with the other player', await call() === 'Start Bijan Robinson.' && /Derrick Henry has no game for you this week \(bye\)/.test(await why()), await why());
  await pick('cpB', 'smith-njigba');
  ok('within 5% is too close to call', await call() === 'Too close to call.', await call());
  const rec = await cells('Recent form');
  ok('a missing history is a dash, not a zero', rec && rec[1] === '—' && /No number for both/.test(rec[2]), JSON.stringify(rec));
  ok('different positions are said to compare on points only', /Different positions/.test(await outText()));
  ok('no sideways scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0);
}

console.log('\na link opens on the comparison');
{
  await page.goto(BASE + '/compare?a=bijan-robinson&b=breece-hall&for=trade', { waitUntil: 'networkidle' }); await settle();
  ok('the address draws the trade call', await call() === 'Value Breece Hall more.' && await page.inputValue('#cpA') === 'Bijan Robinson', await call());
  await page.goto(BASE + '/compare?a=bijan-robinson&b=jahmyr-gibbs', { waitUntil: 'networkidle' }); await settle();
  ok('a player off the boards is said to be', /Jahmyr Gibbs is not on this season’s boards/.test(await outText()), await outText());
}

console.log('\nthree and four players');
{
  // Worked by hand. Trade weights, Jaxon Smith-Njigba added (no history, so
  // only the four projections count for his pairs): Breece +.124 on average,
  // Bijan -.042, Smith-Njigba -.082. Top two .083 apart on the pair scale.
  await page.goto(BASE + '/compare?a=bijan-robinson&b=breece-hall&for=trade', { waitUntil: 'networkidle' }); await settle();
  await page.click('#cpAdd'); await settle();
  ok('a third picker opens', await page.isVisible('#cpCSlot'));
  await pick('cpC', 'smith-njigba');
  ok('three players get one call, against the next best', await call() === 'Value Breece Hall more.' &&
     /^Slight edge over Bijan Robinson, the next best: 3 of the 7 criteria you counted favor Breece Hall over him\. Bijan Robinson is ahead on This week, Recent form, Season to date and Usage\./.test(await why()), await why());
  ok('three players are ranked', JSON.stringify(await page.$$eval('.cp-rank-name', n => n.map(x => x.textContent))) === JSON.stringify(['Breece Hall', 'Bijan Robinson', 'Jaxon Smith-Njigba']));
  ok('the table has a column per player', await page.$$eval('.cp-tab thead th', t => t.length) === 5);
  ok('the third player goes in the address', new URL(page.url()).searchParams.get('c') === 'jaxon-smith-njigba', page.url());
  // Who to start, Derrick Henry added on his bye: he ranks last and is not
  // weighed against the three who play. Smith-Njigba .136, Bijan .108.
  await page.click('#cpAdd'); await settle();
  await pick('cpD', 'derrick henry');
  ok('four is the most', await page.isHidden('#cpAdd'));
  await press('cpPurpose', 'Who to start');
  ok('a close top two is too close to call, by name', await call() === 'Too close to call between Jaxon Smith-Njigba and Bijan Robinson.', await call());
  ok('a player on bye ranks last and says why', /Derrick Henry has no game for you this week \(bye\), so he ranks last\./.test(await why()) &&
     await page.$eval('.cp-rank li:last-child', li => /Derrick Henry/.test(li.textContent) && /cannot play/.test(li.textContent)), await why());
  ok('no sideways scroll at 390px with four players', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0);
  const over = await page.$eval('#cpOut .is-scroll', b => b.scrollWidth - b.clientWidth);
  ok('the four-player table fits a phone without scrolling', over <= 1, 'over by ' + over + 'px');
  await shot('compare-four');
  await page.click('#cpCSlot button[data-rm]'); await settle();
  ok('removing a player closes the gap', await page.inputValue('#cpC') === 'Derrick Henry' && await page.isHidden('#cpDSlot') && await page.isVisible('#cpAdd'));
  ok('and the call is redrawn without him', await call() === 'Start Bijan Robinson.' && /^Clear edge over Breece Hall/.test(await why()), await call() + ' / ' + await why());
}

console.log('\nDFS');
{
  await page.goto(BASE + '/compare', { waitUntil: 'networkidle' }); await settle();
  await page.click('#cpModeDfs'); await settle();
  ok('DFS swaps scoring for the site', await page.isHidden('#cpScoringRow') && await page.isVisible('#cpSiteRow'));
  ok('the slate fills the pickers’ list', await page.$$eval('#cpSlate option', o => o.length) === 3);
  const choose = async (box, label) => { await page.fill('#' + box, label); await page.dispatchEvent('#' + box, 'change'); await settle(); };
  await choose('cpA', 'Josh Allen · QB · BUF · $8000');
  await choose('cpB', 'Lamar Jackson · QB · BAL · $8200');
  ok('the cash call goes to the floor and the projection', await call() === 'Play Josh Allen in cash games.', await call());
  const val = await cells('Value');
  ok('value is points per $1K', val && val[0] === '3.00' && val[1] === '2.68', JSON.stringify(val));
  await press('cpPurpose', 'Tournament');
  ok('the tournament call goes to ceiling and low ownership', await call() === 'Play Lamar Jackson in tournaments.', await call());
  const own = await cells('Lower ownership');
  ok('lower ownership wins its row', own && /Jackson \+/.test(own[2]), JSON.stringify(own));
  ok('modeled numbers are labelled modeled', /Floor, ceiling and ownership are modeled, not a feed\./.test(await outText()));
  ok('DFS keeps mode and site in the address', new URL(page.url()).searchParams.get('mode') === 'dfs' && new URL(page.url()).searchParams.get('a') === 'Josh Allen', page.url());
  await shot('compare-dfs');
  await choose('cpB', 'Hurt Receiver · WR · NYG · $5000');
  ok('a player who will not play loses the call', await call() === 'Play Josh Allen in tournaments.' && /Hurt Receiver is not expected to play/.test(await why()), await why());
  await choose('cpB', 'Lamar Jackson · QB · BAL · $8200');
  await page.click('#cpAdd'); await settle();
  await choose('cpC', 'Hurt Receiver · WR · NYG · $5000');
  ok('on a slate of three, the one who will not play ranks last', await call() === 'Play Lamar Jackson in tournaments.' && /Hurt Receiver is not expected to play, so he ranks last\./.test(await why()), await why());
  await press('cpSite', 'FanDuel');
  ok('a site with no salaries says so', /No FanDuel salaries are loaded for this week yet/.test(await outText()), await outText());
}

await page.waitForTimeout(600);
const succ = track.filter(x => x.event === 'tool_success' && x.props && x.props.tool === 'compare');
ok('comparisons are tracked as tool_success for compare', succ.length >= 2 && succ.some(x => x.props.mode === 'dfs') && succ.some(x => x.props.mode === 'season'), JSON.stringify(succ.map(x => x.props)));
ok('the number of players compared is tracked', succ.some(x => x.props.rows === 4) && succ.some(x => x.props.rows === 2), JSON.stringify(succ.map(x => x.props)));
ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
