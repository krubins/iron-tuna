#!/usr/bin/env node
// The Sunday email form and the share controls, in a browser
// (docs/growth-plan.md, Phase 5, 17 Oct 2026).
//   REQUIRE_BROWSER=1 node tools/test-share-signup.mjs
//
// tools/test-newsletter.mjs proves the worker's side. This drives what a
// reader sees, at 390 px, against a local server with /api stubbed:
//   - no form anywhere while sign-up is closed; /newsletter says so;
//   - open: the form sits under the homepage examples, never as a popup;
//     it refuses a bad address and a missing consent, sends consent, scoring
//     and placement, and its metrics event carries no address;
//   - "No thanks" and a sign-up both keep the prompt away on the next visit,
//     and the permanent page still offers the form;
//   - a prompt with data-after appears only after that tool's result;
//   - the homepage's share buttons ask the worker for a dated link and copy
//     it, sending share_click; the sample's button shares the comparison;
//   - the finding page: its image loads, Copy link copies, Save image
//     downloads a PNG, each a share_click;
//   - no sideways scroll, no page errors.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

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

// ── the worker's own fills ─────────────────────────────────────────────────
const WSRC = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const lift = (a, b) => { const i = WSRC.indexOf(a); return WSRC.slice(i, WSRC.indexOf(b, i) + b.length); };
const cut = (a, b) => { const i = WSRC.indexOf(a); return WSRC.slice(i, WSRC.indexOf(b, i)); };
const W = new Function([WSRC.slice(WSRC.indexOf('// ── the scoring engine ─'), WSRC.indexOf('const COLUMN_SCORING = {')),
  lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'), lift('function _etStamp(ms) {', '\n}'),
  WSRC.slice(WSRC.indexOf('const HOME_EX_MAX = 3;'), WSRC.indexOf('function homeShellFill(html, hp) {')), lift('function homeShellFill(html, hp) {', '\n}'),
  cut('// THE SUNDAY EMAIL AND SHARED FINDINGS START', '// THE SUNDAY EMAIL AND SHARED FINDINGS END')].join('\n')
  + '\nreturn { homePrerender, homeShellFill, homeExamples, findingGapRec, findingShellFill, findingSvg, _oddsNorm };')();
const B = homeBoard(), M = homeMarkets(W._oddsNorm);
const FRONT = W.homeShellFill(fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8'), W.homePrerender(B, M));
const FID = '2026-w6-drake-london-ppr-0a1b2c3d';
const FREC = { ...W.findingGapRec({ b: B, week: 6, season: 2026, markets: M }, W.homeExamples(B, M, 'ppr')[0], 'ppr'), frozenAt: Date.UTC(2026, 9, 17, 16, 0) };
const FINDING = W.findingShellFill(fs.readFileSync(path.join(ROOT, 'finding.html'), 'utf8'), FREC, FID);

// ── the server ─────────────────────────────────────────────────────────────
let OPEN = false;
const subs = [], shares = [], track = [];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const send = (b, st) => { res.writeHead(st || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/newsletter/status') return send({ ok: true, open: OPEN, offer: 'Get the five biggest Vegas-versus-expert fantasy differences every Sunday morning.' });
    if (u.pathname === '/api/newsletter/subscribe') { subs.push(JSON.parse(body)); return send({ ok: true, state: 'check_inbox' }); }
    if (u.pathname === '/api/share/finding' || u.pathname === '/api/share/compare') {
      const b = JSON.parse(body); shares.push({ path: u.pathname, ...b });
      return send({ ok: true, id: FID, url: 'https://irontuna.com/finding/' + FID, title: 'A finding' });
    }
    if (u.pathname === '/api/track') { try { track.push(JSON.parse(body)); } catch (e) {} res.writeHead(204); return res.end(); }
    if (u.pathname.startsWith('/api/')) return send({ ok: false });
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(FRONT); }
    if (u.pathname === '/finding/' + FID) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(FINDING); }
    if (u.pathname === '/finding/' + FID + '/card.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(W.findingSvg(FREC)); }
    const p = /\.[a-z0-9]+$/.test(u.pathname) ? u.pathname : u.pathname + '.html';
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
// Not automation, so it-metrics.js sends what a reader's browser would.
await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
await ctx.route(/googletagmanager|google-analytics|espncdn|nfl\.com|wikimedia/, r => r.abort());
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const settle = () => page.waitForTimeout(400);
// SHOTS=<dir> saves what the reader sees at the main steps, for a PR.
const shot = async (name, sel) => { if (!process.env.SHOTS) return; const el = sel ? await page.$(sel) : null; await (el || page).screenshot({ path: path.join(process.env.SHOTS, name + '.png'), ...(el ? {} : { fullPage: false }) }); };

console.log('\nsign-up closed');
{
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle();
  ok('the homepage examples are there', await page.isVisible('#hmExamples'));
  ok('no form under them while sign-up is closed', await page.$eval('[data-it-newsletter="home"]', n => n.hidden && !n.querySelector('form')));
  await page.goto(BASE + '/newsletter', { waitUntil: 'networkidle' }); await settle();
  const t = await page.textContent('[data-it-newsletter="newsletter_page"]');
  ok('/newsletter says sign-up is not open yet, and has no form', /not open yet/.test(t) && !(await page.$('[data-it-newsletter] form')), t);
  ok('the footer links to it', await page.$eval('footer .foot-nav', n => !!n.querySelector('a[href="/newsletter"]')));
}

console.log('\nsign-up open, on the homepage');
{
  OPEN = true;
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle();
  const host = '[data-it-newsletter="home"]';
  ok('the form appears under the examples, inline', await page.isVisible(host + ' form') && await page.$eval(host, n => n.closest('#hmExamples') !== null && getComputedStyle(n).position !== 'fixed'));
  await shot('home-signup', '#hmExamples');
  ok('it states the offer', /five biggest Vegas-versus-expert fantasy differences every Sunday morning/.test(await page.textContent(host)));
  ok('the consent box starts unticked', !(await page.isChecked(host + ' input[type=checkbox]')));
  await page.fill(host + ' input[type=email]', 'not an email');
  await page.click(host + ' button[type=submit]');
  ok('a bad address is refused in the page', /valid email/.test(await page.textContent(host + ' .it-nl-msg')) && subs.length === 0);
  await page.fill(host + ' input[type=email]', 'reader@example.com');
  await page.click(host + ' button[type=submit]');
  ok('no consent, no request', /Tick the box/.test(await page.textContent(host + ' .it-nl-msg')) && subs.length === 0);
  await page.selectOption(host + ' select', 'half');
  await page.check(host + ' input[type=checkbox]');
  await page.click(host + ' button[type=submit]');
  await page.waitForFunction(h => /Check your inbox/.test(document.querySelector(h + ' .it-nl-msg').textContent), host);
  ok('sent: the address, the scoring, explicit consent and where it came from', subs.length === 1 && subs[0].email === 'reader@example.com' && subs[0].scoring === 'half' && subs[0].consent === true && subs[0].source === 'home', JSON.stringify(subs));
  ok('the reader is told to confirm, and that an existing subscription is unchanged', /Check your inbox and confirm\. If this address is already subscribed, nothing changes\./.test(await page.textContent(host + ' .it-nl-msg')));
  await settle();
  const ev = track.filter(t => t.event === 'subscribe_request');
  ok('a subscribe_request event for the placement', ev.length === 1 && ev[0].props.tool === 'newsletter' && ev[0].props.key === 'home', JSON.stringify(ev));
  ok('no tracked payload carries the address', !track.some(t => /reader@example\.com|@example/.test(JSON.stringify(t))));
  ok('no sideways scroll at 390', (await overflow()) <= 0);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle();
  ok('after signing up, the prompt stays away', await page.$eval(host, n => n.hidden));
  await page.goto(BASE + '/newsletter', { waitUntil: 'networkidle' }); await settle();
  await shot('newsletter-page');
  ok('and the permanent page still has the form', await page.isVisible('[data-it-newsletter="newsletter_page"] form'));
  ok('the permanent page has no "No thanks"', !(await page.$('[data-it-newsletter="newsletter_page"] .it-nl-no')));
  ok('no sideways scroll on /newsletter', (await overflow()) <= 0);
  await page.evaluate(() => localStorage.removeItem('it.nl'));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle();
  await page.click(host + ' .it-nl-no');
  ok('"No thanks" hides it', await page.$eval(host, n => n.hidden));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle();
  ok('and it stays hidden next visit', await page.$eval(host, n => n.hidden));
  await page.evaluate(() => localStorage.removeItem('it.nl'));
}

console.log('\nafter a result, not before');
{
  await page.goto(BASE + '/vegas-edge', { waitUntil: 'networkidle' }); await settle();
  const host = '[data-it-newsletter="vegas_edge"]';
  ok('/vegas-edge: the board failed to load, so no offer', await page.$eval(host, n => n.hidden));
  await page.evaluate(() => { (window.ITMetricsQ = window.ITMetricsQ || []).push(['success', 'rankings', 'x']); });
  await settle();
  ok('another tool\'s result does not bring it', await page.$eval(host, n => n.hidden));
  await page.evaluate(() => { window.ITMetricsQ.push(['success', 'vegas_edge', '6', { rows: 10 }]); });
  await settle();
  ok('the board\'s own result does', await page.isVisible(host + ' form'));
}

console.log('\nshare controls on the homepage');
{
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await settle();
  const btn = '#hmExSets ol[data-scoring="ppr"] li:first-child button.hm-share';
  ok('each example has a share button', await page.isVisible(btn) && (await page.$$('#hmExSets ol[data-scoring="ppr"] button.hm-share')).length === 3);
  const before = track.length;
  await page.click(btn);
  await page.waitForFunction(() => /Link copied|Copy this link/.test((document.querySelector('#hmExSets .it-share-msg') || {}).textContent || ''));
  ok('it asks the worker for that player at the shown scoring, and nothing else', shares.length === 1 && shares[0].path === '/api/share/finding' && shares[0].player === 'Drake London' && shares[0].scoring === 'ppr' && Object.keys(shares[0]).length === 3, JSON.stringify(shares));
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('and copies the dated link', clip === 'https://irontuna.com/finding/' + FID, clip);
  await settle();
  const sc = track.slice(before).filter(t => t.event === 'share_click');
  ok('a share_click for the examples', sc.length === 1 && sc[0].props.tool === 'home_examples' && sc[0].props.key === 'Drake London', JSON.stringify(sc));
  await page.click('#hmScore button[data-scoring="standard"]');
  await page.click('#hmExSets ol[data-scoring="standard"] li:first-child button.hm-share');
  await page.waitForFunction(() => document.querySelectorAll('#hmExSets .it-share-msg').length >= 2);
  ok('a card at another scoring shares at that scoring', shares[1] && shares[1].scoring === 'standard' && shares[1].player === 'Derrick Henry', JSON.stringify(shares[1]));
  const cmp = '#hmMwSets .hm-mw-set[data-scoring="standard"] button.hm-share';
  ok('the sample\'s flex call has a share button', await page.isVisible(cmp));
  await page.click(cmp);
  await settle();
  ok('it shares the two players as a comparison at that scoring', shares[2] && shares[2].path === '/api/share/compare' && shares[2].a === 'Flex Filler 29' && shares[2].b === 'Flex Filler 34' && shares[2].scoring === 'standard', JSON.stringify(shares[2]));
  ok('no sideways scroll with the share messages showing', (await overflow()) <= 0);
}

console.log('\nthe finding page');
{
  await page.goto(BASE + '/finding/' + FID, { waitUntil: 'networkidle' }); await settle();
  await shot('finding');
  ok('the finding is the first thing on the page', /Drake London/.test(await page.textContent('h1')) && /Dated finding/.test(await page.textContent('.fd-dated')));
  ok('its image loads at full size', await page.$eval('.fd-img', i => i.complete && i.naturalWidth === 1200));
  const labels = await page.$$eval('.fd-share button', bs => bs.map(b => b.textContent));
  ok('Copy link and Save image (Share only where the browser has a share sheet)', labels.includes('Copy link') && labels.includes('Save image'), labels.join(', '));
  const before = track.length;
  await page.click('.fd-share button:text("Copy link")');
  await page.waitForFunction(() => /Link copied|Copy this link/.test((document.querySelector('.fd-share .it-share-msg') || {}).textContent || ''));
  ok('Copy link copies the finding\'s address', (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))) === 'https://irontuna.com/finding/' + FID);
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('.fd-share button:text("Save image")');
  const d = await dl;
  ok('Save image downloads a PNG', d && /\.png$/.test(d.suggestedFilename()), d ? d.suggestedFilename() : 'no download');
  if (d) { const p = await d.path(); const head = fs.readFileSync(p).subarray(0, 8); ok('and it is a real PNG', head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG'); }
  await settle();
  const sc = track.slice(before).filter(t => t.event === 'share_click').map(t => t.props.method).sort().join(',');
  ok('each use is a share_click with its method', sc === 'copy_link,image', sc);
  ok('the page says noindex', await page.$eval('meta[name=robots]', m => m.content === 'noindex,follow'));
  ok('no sideways scroll at 390', (await overflow()) <= 0);
}

ok('no page errors anywhere', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
