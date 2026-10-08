#!/usr/bin/env node
// The season-long Value Coach page (/value-coach), driven in a browser.
//   node tools/test-value-coach.mjs
//
// WHAT THIS EXISTS FOR. The coach is the one surface on this site that talks,
// and a talking surface fails in ways a board does not:
//
//   1. IT ANSWERS UNGROUNDED. The whole contract is that every number it says
//      came off /api/boards. If the page mounts the panel before the boards
//      answer and leaves it enabled, a reader gets football opinions from a
//      model with no board in front of it, which is the one thing this product
//      must never ship. So the refusing pass below is the pass that matters:
//      boards down means input disabled, openers disabled, and a line saying
//      what it is waiting for.
//   2. THE PROMPT IS SLICED, SILENTLY. /api/coach truncates `system` at 40,000
//      characters rather than refusing it, so an oversized payload reaches the
//      model as JSON cut off mid-object. it-coach.js derives its JSON budget
//      from the prompt's own length for that reason; this asserts the thing
//      that actually goes out over the wire is inside the cap, and that when
//      the fit() trims fire they say so in the payload.
//   3. THE BOARD IS BUILT AT THE WRONG SCORING. A reader who saved a Half PPR
//      league and is answered off a PPR board is being told the wrong thing
//      about every receiver, and nothing on screen would say so. The scoring
//      is asserted on the REQUEST, not on the label the page prints.
//
// It stubs /api/boards and /api/coach rather than reaching for either: the
// board is the worker's shape, and the coach stub streams SSE in the shape
// streamResponse sends, so the reader/assembler is exercised for real.
//
// Needs playwright-core plus a Chromium binary (preinstalled at /opt/pw-browsers
// in Claude Code remote sessions, else set CHROMIUM_PATH, else whatever
// `npx playwright-core install chromium` put in the cache). It skips cleanly
// when they are absent so it never blocks a contributor's machine — EXCEPT
// under REQUIRE_BROWSER=1, which CI sets, where a skip is a failure instead.
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A SKIP THAT CI COUNTS AS GREEN IS WORSE THAN NO TEST. This file self-skips on
// a machine with no browser, which is right for a contributor's laptop and
// wrong for a gate — so CI sets REQUIRE_BROWSER=1 and a missing browser becomes
// a failure with the command that fixes it.
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

// Where the stub parks the last request body, so the assertions below can read
// what actually went over the wire rather than what the page believes it sent.
const SENT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'it-coach-')), 'coach-body.json');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
                '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain' };

const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const player = (pos, i, horizon) => ({
  name: `${pos} Player ${i}`, position: pos, team: 'NE', key: `${pos}${i}`,
  games: horizon === 'ros' ? 14 : 1, byes: horizon === 'ros' ? 1 : 0,
  weeks: [{ week: 3, opponent: 'BUF', home: true }],
  injury: i % 7 === 0 ? { status: 'Questionable', gamesOut: 0, note: 'ankle' } : null,
  roleTrend: { label: i % 3 === 0 ? 'up' : 'flat', pct: 4 },
  scheduleDifficulty: { avgOpponentDefRank: 16, label: 'Average' },
  consensus: { points: 200 - i, rank: i },
  vegas: { points: 203 - i, rank: i },
  ironTuna: { points: 201.5 - i, rank: i, confidence: 'HIGH' },
  marketDelta: { points: 3, rank: 0, pct: 1.5, classification: 'MARKET AGREES', significant: false }
});
const boardFor = (horizon, n) => ({
  ok: true, contract: 1,
  horizon: { key: horizon, label: horizon === 'ros' ? 'Rest of Season' : 'This Week', through: 17 },
  season: 2026, currentWeek: 3, phase: 'REG',
  scoring: { preset: 'ppr', label: 'PPR' },
  sources: { schedule: 'espn', ratings: 'fitted', props: 180, usage: 2 },
  players: POS.flatMap(p => Array.from({ length: n }, (_, i) => player(p, i + 1, horizon)))
});

// Three SSE chunks, in the shape streamResponse sends: `data: <json string>`.
const REPLY = ['Start ', 'WR Player 1 (200.5 rest-of-season, WR1). ', 'The market has him a shade above consensus.'];

const calls = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/boards') {
    const horizon = u.searchParams.get('horizon');
    calls.push('boards:' + horizon + ':' + u.searchParams.get('scoring'));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(boardFor(horizon, horizon === 'ros' ? 90 : 60)));
  }
  if (u.pathname === '/api/coach') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push('coach:' + body.length);
      fs.writeFileSync(SENT, body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const t of REPLY) res.write('data: ' + JSON.stringify(t) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false }));
  }
  let rel = u.pathname === '/' ? 'front.html' : u.pathname.slice(1);
  if (!path.extname(rel)) rel += '.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); } };

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + '/value-coach', { waitUntil: 'networkidle' });

const r1 = await page.evaluate(() => ({
  h1: document.querySelector('h1').textContent.trim(),
  panel: !!document.querySelector('#vcCoach.vc-coach'),
  live: (document.querySelector('.vc-coach-live') || {}).textContent,
  lede: (document.querySelector('.vc-coach-lede') || {}).textContent,
  chips: [...document.querySelectorAll('.vc-coach-chip')].map(b => ({ t: b.textContent.trim(), off: b.disabled })),
  textDisabled: document.querySelector('.vc-coach-input textarea').disabled,
  stamp: document.getElementById('vcScored').textContent,
  budget: window.ITCoach.JSON_BUDGET,
  systemLen: window.ITCoach.SYSTEM.length
}));

console.log('\nthe page loads and the coach comes up grounded');
ok('the headline is the page', /Ask the Value Coach/.test(r1.h1), r1.h1);
ok('the coach panel is mounted', r1.panel);
ok('both boards were fetched at the reader scoring', calls.includes('boards:ros:ppr') && calls.includes('boards:week:ppr'), calls.join(' '));
ok('the panel says it is live on the board', /live at PPR/.test(r1.live || ''), r1.live);
ok('the input is enabled once the board answers', r1.textDisabled === false);
ok('four openers, all enabled', r1.chips.length === 4 && r1.chips.every(c => !c.off), JSON.stringify(r1.chips));
ok('the scored-at line names the scoring', /Scored at PPR/.test(r1.stamp), r1.stamp);
ok('the JSON budget is positive', r1.budget > 10000, String(r1.budget) + ' (system ' + r1.systemLen + ')');

console.log('\nasking a question sends the board and renders the answer');
await page.click('.vc-coach-chip');
await page.waitForFunction(() => document.querySelectorAll('.vc-coach-msg.bot').length
  && !/^…$/.test(document.querySelector('.vc-coach-msg.bot').textContent), null, { timeout: 15000 });
const r2 = await page.evaluate(() => ({
  msgs: [...document.querySelectorAll('.vc-coach-msg')].map(m => ({ who: m.className, t: m.textContent.trim() })),
  talking: document.querySelector('.vc-coach').classList.contains('vc-coach-talking')
}));
ok('the question and the answer are both in the log', r2.msgs.length === 2, JSON.stringify(r2.msgs));
ok('the answer is the streamed text, assembled', /Start WR Player 1/.test(r2.msgs[1].t), r2.msgs[1].t);
ok('the panel switched to its talking shape', r2.talking);

const body = JSON.parse(fs.readFileSync(SENT, 'utf8'));
const sys = body.system;
const jsonPart = sys.slice(sys.indexOf('LIVE SEASON STATE (JSON):') + 'LIVE SEASON STATE (JSON):'.length).trim();
const sent = JSON.parse(jsonPart);
console.log('\nwhat actually rode along with the question');
ok('the system prompt is inside the proxy cap', sys.length <= 40000, String(sys.length));
ok('it carries the rest-of-season board', !!sent.rosBoard && (sent.rosBoard.WR || []).length > 0,
   Object.keys(sent.rosBoard || {}).join(','));
ok('and this week’s board', !!sent.weekBoard && (sent.weekBoard.WR || []).length > 0);
ok('it names the columns for both', (sent.rosBoardColumns || []).length === 12 && (sent.weekBoardColumns || []).length === 9);
ok('a board line is pipe-separated and starts with the name',
   /^WR Player 1\|NE\|1\|200\.5\|/.test((sent.rosBoard.WR || [])[0] || ''), (sent.rosBoard.WR || [])[0]);
ok('it says the reader has not described a league', /has NOT described/.test(sent.scoring.source), sent.scoring.source);
ok('the league block is absent rather than invented', sent.league == null || sent.league === undefined);
ok('it says which week it is', sent.asOf && sent.asOf.currentWeek === 3, JSON.stringify(sent.asOf));
ok('the payload was trimmed and said so', Array.isArray(sent.trimmedFromThisPrompt) && sent.trimmedFromThisPrompt.length > 0,
   JSON.stringify(sent.trimmedFromThisPrompt));

console.log('\nwith a saved league');
await page.evaluate(() => {
  localStorage.setItem('iron_tuna_inseason_league_v1', JSON.stringify(
    { platform: 'Sleeper', scoring: 'Half PPR', teams: 10, faab: 200, ref: '' }));
});
await page.reload({ waitUntil: 'networkidle' });
const r3 = await page.evaluate(() => document.getElementById('vcScored').textContent);
ok('the boards are re-fetched at the saved scoring', calls.includes('boards:ros:half'), calls.join(' '));
ok('and the page says whose settings they are', /your saved league/.test(r3), r3);
await page.click('.vc-coach-chip');
await page.waitForFunction(() => document.querySelectorAll('.vc-coach-msg.bot').length
  && !/^…$/.test(document.querySelector('.vc-coach-msg.bot').textContent), null, { timeout: 15000 });
const sent2 = (() => {
  const b = JSON.parse(fs.readFileSync(SENT, 'utf8'));
  const s2 = b.system;
  return JSON.parse(s2.slice(s2.indexOf('LIVE SEASON STATE (JSON):') + 'LIVE SEASON STATE (JSON):'.length).trim());
})();
ok('the league rides along with the question', sent2.league && sent2.league.teams === 10 && sent2.league.faabBudget === 200,
   JSON.stringify(sent2.league));
ok('and the scoring source names the reader’s league', /described at \/my-league/.test(sent2.scoring.source), sent2.scoring.source);

console.log('\nwith the boards refusing');
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx2.route('**/api/boards*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errors.push(e.message));
await p2.goto(BASE + '/value-coach', { waitUntil: 'networkidle' });
const r4 = await p2.evaluate(() => ({
  lede: document.querySelector('.vc-coach-lede').textContent,
  live: document.querySelector('.vc-coach-live').textContent,
  off: document.querySelector('.vc-coach-input textarea').disabled,
  chipsOff: [...document.querySelectorAll('.vc-coach-chip')].every(b => b.disabled),
  stamp: document.getElementById('vcScored').textContent
}));
ok('the panel refuses rather than pretending', r4.off === true && r4.chipsOff === true);
ok('and says what it is waiting for', /did not answer/.test(r4.lede), r4.lede);
ok('the badge does not claim to be live', !/live/.test(r4.live), r4.live);
ok('the page says so too', /did not answer/.test(r4.stamp), r4.stamp);

console.log('\nthe homepage link lands here');
const p3 = await ctx.newPage();
await p3.goto(BASE + '/', { waitUntil: 'networkidle' });
const href = await p3.evaluate(() =>
  [...document.querySelectorAll('.hm-lane')].find(l => /Season Long Fantasy/.test(l.querySelector('h2').textContent))
    .querySelector('a[href="/value-coach"]') ? '/value-coach' : null);
ok('the Season Long Fantasy card links the coach', href === '/value-coach', String(href));

ok('no page threw', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

