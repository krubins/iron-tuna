#!/usr/bin/env node
// The synced league's strip, on every page that carries one.
//   node tools/test-league-strip.mjs
//
// THE BUG THIS EXISTS FOR. /fantasy read `window.ITSync` at the TOP LEVEL of
// an inline script. /it-sync.js is loaded `defer`, so it had not executed yet
// — a deferred script runs after the document is parsed, an inline one runs
// during it — and the global was undefined. The guard around the block is
// `if (window.ITSync)`, so the whole thing was skipped: nothing threw, nothing
// was logged, and the page just quietly never painted the league strip, never
// offered the connect call to a signed-in reader with nothing connected, never
// hid "Save my league" for a reader who had already saved one, and never
// opened the Your Week card. It shipped and stayed shipped.
//
// NO FILE-READING GATE CAN SEE THIS. The code is present and correct; only its
// ORDER against the deferred scripts is wrong, and nothing in tools/ parses
// script ordering. Neither can test-league-sync.mjs, which drives the worker's
// half of the feature and never opens a browser. So this asserts the outcome a
// reader would notice, on every page that has an element for it: with a league
// connected the strip paints, and with none the page still paints whatever it
// paints instead. Nothing here stubs ITSync — the page's own /it-sync.js runs
// against a stubbed /api/leagues, so a change to either side shows up here.
//
// Follows test-boards-render.mjs: needs playwright-core plus a Chromium
// binary, skips cleanly where they are absent so it never blocks a
// contributor's machine — EXCEPT under REQUIRE_BROWSER=1, which CI sets, where
// a skip is a failure instead.
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
].find((p) => p && fs.existsSync(p));
if (!CHROME) absent('no Chromium binary', 'set CHROMIUM_PATH, or run `npx playwright-core install chromium`');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── the pages, and the element each one hands ITSync.strip() ────────────────
// Every in-season page that carries a strip is here. A page that grows one and
// is not added is a page this gate does not cover, so the list is the contract.
const PAGES = [
  ['/fantasy.html', 'fnSync'],
  ['/rankings.html', 'rkSync'],
  ['/faab.html', 'faSync'],
  ['/my-week.html', 'mwSync'],
  ['/trade-finder.html', 'tfSync'],
  ['/in-season.html', 'isSync']
];

// ── the server ──────────────────────────────────────────────────────────────
// Files off disk; /api/leagues answers as the worker does. MODE picks whether
// the reader has a league connected.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
                '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain' };
let MODE = 'league';
const LEAGUES = () => MODE === 'league'
  ? { ok: true, defaultId: 'L1', leagues: [{ id: 'L1', name: 'Office League', label: 'PPR · 12 teams', isDefault: true, sync: { lastAt: Date.now() - 500000 } }] }
  // Signed in, nothing connected: `ok` with an empty list is how the worker
  // says so, and it is the case the connect call exists for.
  : { ok: true, defaultId: null, leagues: [] };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let body = { ok: false, error: 'unavailable' };
    if (u.pathname === '/api/leagues') body = LEAGUES();
    else if (u.pathname.indexOf('/advice') > 0) body = { ok: true, matchup: { opponent: 'Team Ortiz', you: '118.4', them: '109.2', verdict: 'favored' }, lineup: { improvement: 6.2 }, alerts: [1, 2], pickups: [{ name: 'Jaylen Wright' }] };
    else if (u.pathname === '/api/season') body = { ok: true, week: { type: 'REG', number: 7, label: 'Week 7', status: 'active' }, counts: {} };
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  const fp = path.join(ROOT, u.pathname === '/' ? 'front.html' : u.pathname.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise((r) => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
async function open(pathname) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(BASE + pathname, { waitUntil: 'networkidle' });
  // The strip paints from /api/leagues, which lands after networkidle on a
  // page that was still fetching its own board when the load settled.
  await page.waitForTimeout(500);
  return { page, ctx, errs };
}
const shown = (page, id) => page.evaluate((i) => {
  const n = document.getElementById(i);
  return !!n && !n.hidden && n.innerHTML.length > 0;
}, id);

console.log('\na connected league paints its strip on every page that has one');
{
  MODE = 'league';
  for (const [p, strip] of PAGES) {
    const { page, ctx, errs } = await open(p);
    ok(`${p} threw nothing`, errs.length === 0, errs.join(' | '));
    // The assertion the bug would have failed: the block runs at all.
    ok(`${p} painted #${strip}`, await shown(page, strip));
    await ctx.close();
  }
}

// ── and nothing is asked of a reader with nothing connected ─────────────────
// These pages used to paint ITSync.cta() here: a tinted "Connect your league
// and every number on this site reads at your exact settings" bar with a Sync
// your league button. It was pulled on 2026-09-21 because every one of these
// pages already carries its own connect copy above the fold, so the bar was
// the second or third ask on one screen. The strip stays hidden, and no page
// grows the bar back by accident.
console.log('\nand a signed-in reader with nothing connected is not asked again');
{
  MODE = 'none';
  for (const [p, strip] of PAGES) {
    const { page, ctx, errs } = await open(p);
    ok(`${p} threw nothing`, errs.length === 0, errs.join(' | '));
    ok(`${p} hid #${strip}`, !(await shown(page, strip)));
    ok(`${p} painted no connect bar`, await page.evaluate(() => !document.querySelector('.its-cta')));
    await ctx.close();
  }
}

console.log('\nthe synced reader is named, and stops being asked to save a league');
{
  MODE = 'league';
  const { page, ctx, errs } = await open('/fantasy.html');
  ok('nothing threw', errs.length === 0, errs.join(' | '));
  const note = (await page.locator('#fnScoring').textContent()) || '';
  ok('the scoring note names the league', /Customized for your league:\s*Office League/.test(note), note.slice(0, 70));
  ok('"Save my league" is gone', await page.locator('#fnSaveBtn').isHidden());
  ok('the Your Week card is open', await page.locator('#fnWeekCard').isVisible());
  const week = (await page.locator('#fnWeekP').textContent()) || '';
  ok('and carries the week it read', /Team Ortiz/.test(week), week.slice(0, 70));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
