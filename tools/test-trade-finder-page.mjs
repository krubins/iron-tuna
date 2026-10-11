#!/usr/bin/env node
// The Trade Finder page, and the FAAB Advisor's manual mode, in a browser.
//   node tools/test-trade-finder-page.mjs
//   IT_SHOT=/tmp/tf.png node tools/test-trade-finder-page.mjs   # plus rendered copies
//
// tools/test-trade-finder.mjs proves the engine. This proves the PAGE drives
// it: the paste lands as teams, a screenshot's names come back through the
// reader and resolve on the board, the horizon and balance controls reach the
// search, and every trade shown gains both sides. Since 2026-10-10 the page
// is two tools under one tab bar: the Trade Evaluator (the deal first, the
// rosters second and optional) and the Trade Finder (rosters only), so the
// tab, the step order and a trade judged with no roster behind it are proved
// here too, and so is the gauge under the verdict (every side scored again
// on the next three weeks and the long term, the reader's weighted needle,
// the Go / No go call and the situation row). The FAAB manual form is here
// too, because it is the same kind of claim: a league typed by hand has to
// produce the same shape of answer the Sleeper path does, and the typed bid
// history has to move the going rate.
//
// /api/boards is stubbed with a fixture league of sixty players whose stat
// lines scale by horizon, so the numbers are known and the network is never
// touched. Needs playwright-core plus Chromium; skips cleanly without them.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch (e) { console.log('SKIP — needs playwright-core (' + e.message.split('\n')[0] + ')'); process.exit(0); }
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(p => fs.existsSync(p));
if (!CHROME) { console.log('SKIP — no Chromium binary; set CHROMIUM_PATH'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── the fixture league ─────────────────────────────────────────────────────
// Names are the site's own (tools/faab-fixture-names.json), so the FAAB manual
// mode — which resolves against it-league.js's default board — recognizes them
// too. Season stat lines fall off by rank; horizons scale them by week count.
const NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'faab-fixture-names.json'), 'utf8'));
const CUR = 5, ROS_WEEKS = 13, PLAYOFF = [15, 16, 17];
const HZ = { week: [CUR], next3: [CUR, CUR + 1, CUR + 2], ros: Array.from({ length: ROS_WEEKS }, (_, i) => CUR + i), playoffs: PLAYOFF };
const line = (pos, i) => {
  const f = Math.max(0.25, 1 - i * 0.045);
  if (pos === 'QB') return { passYd: 4300 * f, passTD: 30 * f, passInt: 10, rushYd: 250 * f, rushTD: 3 * f };
  if (pos === 'RB') return { rushYd: 1250 * f, rushTD: 10 * f, rec: 45 * f, recYd: 350 * f, recTD: 2 * f };
  if (pos === 'WR') return { rec: 95 * f, recYd: 1300 * f, recTD: 9 * f, rushYd: 20 };
  return { rec: 70 * f, recYd: 800 * f, recTD: 6 * f };
};
const POOL = [];
for (const [pos, n] of [['QB', 12], ['RB', 20], ['WR', 20], ['TE', 8]]) for (let i = 0; i < n; i++) POOL.push({ name: NAMES[pos][i], pos, team: 'T' + (i % 8), season: line(pos, i) });
POOL.push({ name: 'Buffalo Bills', pos: 'DEF', team: 'BUF', season: { sacks: 40 } }, { name: 'Justin Tucker', pos: 'K', team: 'BAL', season: { fgMade: 30 } });
// One playoff specialist: WR index 9 is ordinary over the season and a star in weeks 15-17.
const SPECIAL = NAMES.WR[9];
function boards(h) {
  const weeks = HZ[h];
  const players = POOL.map((p, ix) => {
    let scale = weeks.length / 17;
    if (p.name === SPECIAL && h === 'playoffs') scale *= 2.2;
    if (p.name === SPECIAL && h === 'week') scale *= 0.6;
    const stats = Object.fromEntries(Object.entries(p.season).map(([k, v]) => [k, Math.round(v * scale * 10) / 10]));
    return {
      name: p.name, position: p.pos === 'DEF' ? 'DST' : p.pos, pos: p.pos, team: p.team, key: p.name.toLowerCase().replace(/[^a-z]/g, '') + '|' + p.pos,
      games: weeks.length, byes: [], weeks: weeks.map(w => ({ week: w, opponent: 'X', home: true })), injury: null,
      consensus: { stats, points: 0 }, vegas: { stats, points: 0, confidence: 'MEDIUM', basis: 'gamelines' }, ironTuna: { stats, points: 0, confidence: 'MEDIUM' }
    };
  });
  return { ok: true, contract: 1, horizon: { key: h, label: h, weeks }, currentWeek: CUR, players, delta: {}, scoring: { preset: 'ppr' } };
}

// Four teams. Team 1 (the reader) hoards running backs and is thin at receiver;
// team 2 is the mirror; team 3 holds the playoff specialist; team 4 is filler.
const T = (pos, ...idx) => idx.map(i => NAMES[pos][i]);
const PASTE = [
  'Iron Tuna (Ken)', 'Owner: Ken', ...T('QB', 0), ...T('RB', 0, 1, 2, 3, 6), ...T('WR', 15, 16, 17), ...T('TE', 0), 'Bills D/ST', 'Tucker K BAL', '',
  'The Hammers', ...T('QB', 1), ...T('RB', 15, 16, 17), ...T('WR', 0, 1, 2, 3, 6), ...T('TE', 1), '',
  'Team: Clinched', ...T('QB', 2), ...T('RB', 4, 5, 10), ...T('WR', 4, 5, 9, 12), ...T('TE', 2), '',
  'Bubble Boys', ...T('QB', 3), ...T('RB', 7, 8, 9), ...T('WR', 7, 8, 10, 11), ...T('TE', 3)
].join('\n');

// ── the server ─────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
let readerCalls = 0, coachCalls = 0, coachBody = '';
// A saved league, switched on only for the last section: seven teams, any of
// which a team box loads when its name is typed.
let SYNCED = false;
const key = (name, pos) => name.toLowerCase().replace(/[^a-z]/g, '') + '|' + pos;
const LEAGUE_TEAMS = [
  ['Rival A', [['QB', 5], ['RB', 12], ['WR', 13]]], ['Rival B', [['QB', 6], ['RB', 13], ['WR', 14]]],
  ['My Squad', [['QB', 0], ['RB', 0], ['RB', 1], ['WR', 15]], true], ['Rival C', [['QB', 7], ['RB', 14], ['WR', 18]]],
  ['Rival D', [['QB', 8], ['RB', 18], ['WR', 19]]], ['Rival E', [['QB', 9], ['RB', 19], ['TE', 4]]], ['Rival F', [['QB', 10], ['TE', 5], ['TE', 6]]]
].map(([name, list, isUser]) => ({ name, isUser: !!isUser, players: list.map(([pos, i]) => ({ id: key(NAMES[pos][i], pos), name: NAMES[pos][i], position: pos, ranked: true })) }));
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/boards') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(boards(u.searchParams.get('horizon') || 'week')));
  }
  if (u.pathname === '/api/season') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, week: { type: 'REG', number: CUR } }));
  }
  if (u.pathname === '/api/roster-read') {
    // The reader, stubbed: a fixed transcription, one name deliberately misread.
    readerCalls++;
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, images: (j.images || []).length, teams: [
        { name: 'Screenshot Team', players: [{ name: NAMES.QB[4], pos: 'QB', team: '' }, { name: NAMES.RB[11], pos: 'RB', team: '' }, { name: 'Nobody Realname', pos: 'WR', team: '' }] }
      ] }));
    });
    return;
  }
  if (u.pathname === '/api/coach') {
    // The model, stubbed: it records what the page sent and answers in a line.
    coachCalls++;
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      coachBody = (j.messages && j.messages[0] && j.messages[0].content) || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'Your notes say the Hammers need wins now.\n\nSend it.' }));
    });
    return;
  }
  if (SYNCED && u.pathname === '/api/leagues') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, defaultId: 'L1', leagues: [{ id: 'L1', name: 'Office League', label: 'PPR · 7 teams', isDefault: true, sync: { lastAt: Date.now() - 60000 } }] }));
  }
  if (SYNCED && u.pathname === '/api/leagues/L1/advice') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, teams: LEAGUE_TEAMS, slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 0 }, trades: [], targets: [], needs: [] }));
  }
  if (u.pathname === '/api/faab/players') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"players":{}}'); }
  let name = u.pathname === '/' ? 'trade-finder.html' : u.pathname.slice(1);
  if (!path.extname(name)) name += '.html';
  const fp = path.join(ROOT, name);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));

// ── the team boxes ─────────────────────────────────────────────────────────
console.log('\nthe team boxes');
const R = i => `#tf-teams .tf-team[data-i="${i}"]`, S = i => `#tf-sends .tf-team[data-i="${i}"]`;
const rosterIn = i => R(i) + ' .tf-type', sendIn = i => S(i) + ' .tf-type';
// Type a few letters, wait for the list, take the highlighted name.
const typeAndPick = async (sel, text) => {
  await page.fill(sel, '');
  await page.type(sel, text, { delay: 5 });
  await page.waitForSelector(sel + ' + .tf-sug:not([hidden]) li', { timeout: 4000 });
  await page.press(sel, 'Enter');
};
const pasteInto = (sel, text) => page.$eval(sel, (el, t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
const names = () => page.$$eval('#tf-teams .tf-team', els => els.map(e => e.querySelector('input.nm').value));
const chipsOf = i => page.$$eval(R(i) + ' .chip', els => els.map(e => e.textContent));
// The layout under the current tool: which steps show, in what order, and
// where the team-count dropdown and the two buttons are.
const layout = () => page.evaluate(() => ({
  deal: document.getElementById('tf-deal').getBoundingClientRect().top, rosters: document.getElementById('tf-rosters').getBoundingClientRect().top,
  dealShown: !!document.getElementById('tf-deal').offsetParent, find: !!document.getElementById('tf-find').offsetParent, evalBtn: !!document.getElementById('tf-eval').offsetParent,
  countIn: document.getElementById('tf-count').closest('.tf-step').id
}));
const selectedTool = () => page.$eval('#tf-tool button[aria-selected="true"]', e => e.getAttribute('data-tool'));
let lay;
{
  await page.goto(BASE + '/trade-finder', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('tf-read-status').textContent === '', null, { timeout: 8000 });
  ok('the dropdown starts at two teams', await page.$eval('#tf-count', e => e.value) === '2');
  ok('it offers two, three or four', (await page.$$eval('#tf-count option', os => os.map(o => o.value))).join() === '2,3,4');
  ok('two roster boxes and two trade boxes', (await page.$$('#tf-teams .tf-team')).length === 2 && (await page.$$('#tf-sends .tf-team')).length === 2);
  ok('the first box is the reader’s', await page.$eval(R(0), e => e.classList.contains('mine')));
  ok('evaluate waits for a player in the trade', await page.$eval('#tf-eval', e => e.disabled));
  ok('the factors box is there', !!(await page.$('#tf-factors')));

  // Two tools in one page. The Evaluator is the default and leads with the deal.
  const tabs = await page.$$eval('#tf-tool button[data-tool]', bs => bs.map(b => b.getAttribute('data-tool') + ':' + b.getAttribute('aria-selected')));
  ok('two tools in a tab bar, the Evaluator selected', tabs.join() === 'evaluator:true,finder:false', tabs.join());
  lay = await layout();
  ok('the Evaluator puts the players in the trade above the rosters', lay.dealShown && lay.deal < lay.rosters, JSON.stringify(lay));
  ok('the team count sits in that first step, and the rosters are marked optional', lay.countIn === 'tf-deal' && /optional/.test(await page.textContent('#tf-rosters-h')), JSON.stringify(lay));
  ok('only the Evaluate button shows', lay.evalBtn && !lay.find, JSON.stringify(lay));

  await page.selectOption('#tf-count', '4');
  ok('four teams, four of each box', (await page.$$('#tf-teams .tf-team')).length === 4 && (await page.$$('#tf-sends .tf-team')).length === 4);
  await page.selectOption('#tf-count', '3');
  ok('three teams, three of each', (await page.$$('#tf-teams .tf-team')).length === 3 && (await page.$$('#tf-sends .tf-team')).length === 3);
  await page.selectOption('#tf-count', '2');

  // Typing fills in: three letters of a surname bring the player up.
  const qb = NAMES.QB[0], last = qb.split(' ').pop();
  await page.type(rosterIn(0), last.slice(0, 4), { delay: 5 });
  await page.waitForSelector(rosterIn(0) + ' + .tf-sug:not([hidden]) li', { timeout: 4000 });
  const sug = await page.$$eval(rosterIn(0) + ' + .tf-sug li', ls => ls.map(l => l.textContent));
  ok('a few letters bring up the player', sug.some(s => s.indexOf(qb) === 0), sug.join(' | '));
  const k = sug.findIndex(s => s.indexOf(qb) === 0);
  for (let n = 0; n < k; n++) await page.press(rosterIn(0), 'ArrowDown');
  await page.press(rosterIn(0), 'Enter');
  ok('Enter adds the highlighted player', (await chipsOf(0)).some(c => c.indexOf(qb) === 0), (await chipsOf(0)).join(' | '));
  ok('and the box is ready for the next', await page.$eval(rosterIn(0), e => e.value === '' && document.activeElement === e));
  await typeAndPick(rosterIn(0), NAMES.RB[0]);
  ok('a full name lands too', (await chipsOf(0)).length === 2);
  await page.fill(rosterIn(0), 'Zzyzx Notaplayer');
  await page.press(rosterIn(0), 'Enter');
  ok('a name the board lacks is refused, not guessed', (await chipsOf(0)).length === 2 && /not on the board/.test(await page.textContent('#tf-read-status')));

  // A pasted league: four teams land in four boxes and the dropdown follows.
  await pasteInto(rosterIn(0), PASTE);
  await page.waitForFunction(() => document.querySelectorAll('#tf-teams .tf-team').length === 4, null, { timeout: 4000 }).catch(() => {});
  const nm = await names();
  ok('a pasted league fills four boxes', nm.length === 4 && await page.$eval('#tf-count', e => e.value) === '4', nm.join(' | '));
  ok('with their own names', nm[0] === 'Iron Tuna (Ken)' && nm[1] === 'The Hammers' && nm[3] === 'Bubble Boys', nm.join(' | '));
  ok('the reader’s box holds the first team', (await chipsOf(0)).length === 12, String((await chipsOf(0)).length));
  // Forty players in the paste; the two typed above were already in the box.
  ok('the status line counts it', /From the paste: 38 players placed/.test(await page.textContent('#tf-read-status')), await page.textContent('#tf-read-status'));

  // Stepping down to two and back keeps the rosters typed.
  await page.selectOption('#tf-count', '2');
  await page.selectOption('#tf-count', '4');
  ok('two and back to four keeps every roster', (await names()).join() === nm.join() && (await chipsOf(3)).length === 9);
}

// ── the screenshot path ────────────────────────────────────────────────────
console.log('\nthe screenshot reader');
{
  // A 2x2 PNG is enough for the client to shrink and post; the stub answers.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAD0lEQVQIW2P4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  // Clear the fourth box so the screenshot has somewhere to go.
  while ((await page.$$(R(3) + ' .chip button')).length) await page.click(R(3) + ' .chip button');
  await page.fill(R(3) + ' input.nm', ''); await page.press(R(3) + ' input.nm', 'Tab');
  ok('an emptied box goes back to its default name', (await names())[3] === 'Team 4');
  await page.setInputFiles(R(3) + ' input[data-shot]', { name: 'roster.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => /From the screenshot/.test(document.getElementById('tf-read-status').textContent), null, { timeout: 8000 });
  ok('the reader was called once with the image', readerCalls === 1, String(readerCalls));
  const box = await page.$eval(R(3), e => ({ name: e.querySelector('input.nm').value, chips: e.querySelectorAll('.chip').length, fix: [...e.querySelectorAll('.tf-fix span')].map(s => s.textContent) }));
  ok('the screenshot fills the box it was added to', box.name === 'Screenshot Team', box.name);
  ok('its readable names resolved on the board', box.chips === 2, String(box.chips));
  ok('the misread name is offered to fix, never priced', box.fix.length === 1 && /Nobody/.test(box.fix[0]), JSON.stringify(box.fix));
  await page.fill(R(3) + ' .tf-fix input', NAMES.WR[13]);
  await page.press(R(3) + ' .tf-fix input', 'Enter');
  await page.dispatchEvent(R(3) + ' .tf-fix input', 'change').catch(() => {});
  await page.waitForFunction(sel => document.querySelectorAll(sel + ' .chip').length === 3, R(3), { timeout: 4000 }).catch(() => {});
  ok('a typed fix resolves and joins the roster', (await page.$$(R(3) + ' .chip')).length === 3);

  // The same screenshot pasted rather than picked. Ctrl+V with the cursor in
  // a box lands in that box through the document listener; the Paste button
  // reads the clipboard itself (stubbed here: headless Chromium has no system
  // clipboard to put a PNG on); and a browser with no clipboard reader is told
  // the shortcut and left with the cursor in the box, so the shortcut works.
  const emptyBox3 = async () => {
    while ((await page.$$(R(3) + ' .chip button')).length) await page.click(R(3) + ' .chip button');
    while ((await page.$$(R(3) + ' .tf-fix button[data-drop]')).length) await page.click(R(3) + ' .tf-fix button[data-drop]');
    await page.fill(R(3) + ' input.nm', ''); await page.press(R(3) + ' input.nm', 'Tab');
    await page.$eval('#tf-read-status', e => { e.textContent = ''; });
  };
  const readBack = () => page.waitForFunction(() => /From the screenshot/.test(document.getElementById('tf-read-status').textContent), null, { timeout: 8000 });
  const pasteImage = sel => page.$eval(sel, (el, b64) => {
    const bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([arr], 'shot.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await emptyBox3();
  await page.focus(rosterIn(3)); await pasteImage(rosterIn(3));
  await readBack();
  ok('a screenshot pasted with Ctrl+V lands in the box the cursor was in', readerCalls === 2 && (await names())[3] === 'Screenshot Team' && (await chipsOf(3)).length === 2, readerCalls + ' ' + (await names())[3]);
  await emptyBox3();
  await page.evaluate(b64 => {
    const bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: () => Promise.resolve([{ types: ['text/plain', 'image/png'], getType: () => Promise.resolve(blob) }]) } });
  }, png.toString('base64'));
  await page.click(R(3) + ' button[data-paste]');
  await readBack();
  ok('the Paste button reads the clipboard into its own box', readerCalls === 3 && (await names())[3] === 'Screenshot Team' && (await chipsOf(3)).length === 2, readerCalls + ' ' + (await names())[3]);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: () => Promise.resolve([{ types: ['text/plain'], getType: () => Promise.reject(new Error('no')) }]) } }); });
  await page.click(R(3) + ' button[data-paste]');
  await page.waitForFunction(() => /no image on the clipboard/.test(document.getElementById('tf-read-status').textContent), null, { timeout: 4000 });
  ok('words on the clipboard are not sent to the reader', readerCalls === 3, String(readerCalls));
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} }); });
  await page.click(R(3) + ' button[data-paste]');
  const noReader = await page.textContent('#tf-read-status');
  ok('without a clipboard reader the button names the shortcut', /Ctrl\+V/.test(noReader) && readerCalls === 3, noReader);
  ok('and leaves the cursor in that box for it', await page.$eval(rosterIn(3), e => e === document.activeElement));
  await page.evaluate(() => { delete navigator.clipboard; });
  await emptyBox3();
  // Put the fourth team back the way the paste had it, for the search below.
  while ((await page.$$(R(3) + ' .chip button')).length) await page.click(R(3) + ' .chip button');
  await page.fill(R(3) + ' input.nm', 'Bubble Boys'); await page.press(R(3) + ' input.nm', 'Tab');
  for (const n of [...T('QB', 3), ...T('RB', 7, 8, 9), ...T('WR', 7, 8, 10, 11), ...T('TE', 3)]) await typeAndPick(rosterIn(3), n);
  ok('a roster typed by hand, nine names', (await chipsOf(3)).length === 9);
}

// ── the search ─────────────────────────────────────────────────────────────
console.log('\nthe search');
await page.click('#tf-tool button[data-tool="finder"]');
lay = await layout();
ok('the Finder tab hides the deal and leads with the rosters', !lay.dealShown && lay.find && !lay.evalBtn && lay.countIn === 'tf-rosters', JSON.stringify(lay));
ok('and the hash names it', await page.evaluate(() => location.hash) === '#finder');
ok('the rosters typed under the Evaluator are still there', (await names()).length === 4 && (await chipsOf(0)).length === 12);
await page.click('#tf-find');
await page.waitForSelector('#tf-results:not([hidden]) .tf-trade', { timeout: 15000 });
const read = () => page.$$eval('.tf-trade', els => els.map(e => {
  const sides = [...e.querySelectorAll('.tf-side')].map(s => ({ who: s.querySelector('.who').textContent, gain: parseFloat(s.querySelector('.gain').textContent.replace('−', '-')), horizon: s.querySelector('.gain small').textContent, give: s.querySelector('.give').textContent }));
  return { title: e.querySelector('h3').textContent, sides };
}));
let trades = await read();
ok('with no players in the trade, the finder searches', trades.length > 0 && trades.length <= 12, String(trades.length));
ok('every trade gains both sides', trades.every(t => t.sides.length === 2 && t.sides.every(s => s.gain > 0)), JSON.stringify(trades[0]));
ok('the reader is always "You"', trades.every(t => t.sides[0].who.startsWith('You')), trades[0].sides[0].who);
ok('the reader sends a running back and gets a receiver in the first trade', /Sends[^]*RB/.test(trades[0].sides[0].give) && /Gets[^]*WR/.test(trades[0].sides[0].give), trades[0].sides[0].give.slice(0, 160));
ok('the bar names the reader’s team and lineup', /Iron Tuna \(Ken\)/.test(await page.textContent('#tf-bar')) && /pts\/wk/.test(await page.textContent('#tf-bar')));
ok('both sides read the rest of the season by default', trades.every(t => t.sides.every(s => /Rest of season/.test(s.horizon))));
ok('no notes typed, no model read', await page.$eval('#tf-take', e => e.hidden) && coachCalls === 0);
const evenTop = trades[0];

await page.$eval('#tf-tilt', el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#tf-find');
await page.waitForFunction(() => /In your favor/.test(document.getElementById('tf-bar').textContent), null, { timeout: 15000 });
trades = await read();
ok('tilted, the top trade gains the reader at least as much', trades[0].sides[0].gain >= evenTop.sides[0].gain - 0.05, `${trades[0].sides[0].gain} vs ${evenTop.sides[0].gain}`);
ok('and every partner still gains', trades.every(t => t.sides[1].gain > 0));

await page.$eval('#tf-tilt', el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#tf-settings summary');
// The reader's focus is a slider: four stops, this week → get me to the
// playoffs → playoffs → rest of the season. Drag it to the third stop.
await page.$eval('#tf-focus-range', el => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
ok('the focus slider names its stop', await page.$eval('#tf-focus-range', e => e.getAttribute('aria-valuetext')) === 'Playoffs' && await page.$eval('#tf-hA button[data-h="playoffs"]', e => e.getAttribute('aria-pressed') === 'true'));
ok('and says what it scores', /fantasy playoff weeks/.test(await page.textContent('#tf-focus-note')));
await page.click('#tf-hB button[data-h="next3"]');
await page.click('#tf-find');
await page.waitForFunction(() => /Fantasy playoffs/.test(document.querySelector('#tf-bar').textContent), null, { timeout: 15000 });
trades = await read();
ok('the reader’s side is scored on the playoffs', trades.every(t => /Fantasy playoffs/.test(t.sides[0].horizon)), trades[0] && trades[0].sides[0].horizon);
ok('and the others on the next three weeks', trades.every(t => /Next 3 weeks/.test(t.sides[1].horizon)), trades[0] && trades[0].sides[1].horizon);
ok('the playoff specialist is on the table', trades.some(t => t.sides[0].give.indexOf('Gets') >= 0 && t.sides[0].give.split('Gets')[1].indexOf(SPECIAL) >= 0), trades.map(t => t.title).slice(0, 4).join(' | '));

// Two teams in the dropdown narrows the search to those two.
await page.selectOption('#tf-count', '2');
await page.click('#tf-find');
await page.waitForFunction(() => !document.getElementById('tf-results').hidden && [...document.querySelectorAll('.tf-trade .with')].every(e => /The Hammers/.test(e.textContent)), null, { timeout: 15000 });
trades = await read();
ok('with two teams, every trade is between them', trades.length > 0 && trades.every(t => /The Hammers/.test(t.title)), trades.map(t => t.title).slice(0, 3).join(' | '));

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('#tf-teams .chip').length > 0, null, { timeout: 8000 });
ok('a reload keeps the rosters', (await names()).join() === 'Iron Tuna (Ken),The Hammers');
ok('and the hidden two', await page.$eval('#tf-count', e => e.value) === '2' && (await (async () => { await page.selectOption('#tf-count', '4'); const n = await names(); await page.selectOption('#tf-count', '2'); return n.length === 4 && n[2] === 'Clinched'; })()));
ok('and the horizons', await page.$eval('#tf-hA button[data-h="playoffs"]', e => e.getAttribute('aria-pressed') === 'true') && await page.$eval('#tf-focus-range', e => e.value) === '2');
ok('and the tool', await selectedTool() === 'finder');
if (process.env.IT_SHOT) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: process.env.IT_SHOT, fullPage: true }); console.log('wrote ' + process.env.IT_SHOT); }
ok('nothing on the Trade Finder threw', errors.length === 0, errors[0]);

// ── evaluating a trade the reader brings ──────────────────────────────────
console.log('\nevaluate a two-team trade');
const verdict = () => page.evaluate(() => ({ cls: document.querySelector('.tf-verdict').className, h: document.querySelector('.tf-verdict h3').textContent,
  sides: [...document.querySelectorAll('.tf-proposed .tf-side')].map(s => ({ who: s.querySelector('.who').textContent, t: s.querySelector('.gain').textContent, neg: s.querySelector('.gain').classList.contains('neg'), give: s.querySelector('.give').textContent })),
  alt: document.querySelector('.tf-alt') && document.querySelector('.tf-alt').textContent, altTrades: document.querySelectorAll('.tf-trade:not(.tf-proposed)').length }));
const clearDeal = async () => { for (const sel of ['#tf-sends .chip button']) while ((await page.$$(sel)).length) await page.click(sel); };
// The gauge: the call, the needle's place on the track (0 is three points a
// week lost, 100 three gained, the zone edges at 37.5 and 62.5), the fill's
// colour, and the three rows' text.
const gauge = () => page.evaluate(() => {
  const g = document.getElementById('tf-gauge'), pin = g.querySelector('.pin'), meter = g.querySelector('.tf-meter');
  return { hidden: g.hidden, call: (g.querySelector('.tf-call .v') || {}).textContent, data: (g.querySelector('.tf-call .v') || { getAttribute: () => null }).getAttribute('data-call'),
    why: (g.querySelector('.tf-call .s') || {}).textContent, pos: pin ? +pin.getAttribute('data-pos') : null, no: !!(meter && meter.classList.contains('no')),
    fill: meter ? getComputedStyle(meter.querySelector('.fill')).backgroundColor : null, aria: meter ? meter.getAttribute('aria-label') : null,
    rows: [...g.querySelectorAll('.tf-gauge-rows .row')].map(r => ({ k: r.querySelector('.k').textContent, v: r.querySelector('.v').textContent, w: r.querySelector('.w').textContent })) };
});
{
  await page.click('#tf-tool button[data-tool="evaluator"]');
  ok('switching tools puts the result away', await page.$eval('#tf-results', e => e.hidden));
  if (!(await page.$eval('#tf-settings', e => e.open))) await page.click('#tf-settings summary');
  await page.click('#tf-hA button[data-h="ros"]');   // a tap on a stop label moves the slider too
  ok('a stop label moves the focus slider', await page.$eval('#tf-focus-range', e => e.value) === '3');
  await page.click('#tf-hB button[data-h="ros"]');
  ok('each trade box is named for its team', /Iron Tuna \(Ken\) sends/.test(await page.textContent(S(0))) && /The Hammers sends/.test(await page.textContent(S(1))));
  // The sends box offers that team's own players first.
  await page.type(sendIn(1), NAMES.WR[6].split(' ').pop().slice(0, 4), { delay: 5 });
  await page.waitForSelector(sendIn(1) + ' + .tf-sug:not([hidden]) li', { timeout: 4000 });
  const offered = await page.$$eval(sendIn(1) + ' + .tf-sug li', ls => ls.map(l => l.textContent));
  ok('a trade box suggests from its own roster', offered.length > 0 && offered.every(o => o.indexOf(NAMES.WR[6]) === 0 || !o.includes(NAMES.RB[0])), offered.join(' | '));
  await page.fill(sendIn(1), '');
  // A fair swap: the reader's fourth back for the partner's fifth receiver.
  await typeAndPick(sendIn(0), NAMES.RB[3]);
  await typeAndPick(sendIn(1), NAMES.WR[6]);
  ok('evaluate is ready once a player is in', await page.$eval('#tf-eval', e => !e.disabled));
  await page.click('#tf-eval');
  await page.waitForSelector('#tf-results:not([hidden]) .tf-verdict', { timeout: 15000 });
  const v1 = await verdict();
  ok('a swap that helps both is called a win', /win/.test(v1.cls) && /Both sides win/.test(v1.h), JSON.stringify(v1));
  ok('the reader’s side reads first', /^You/.test(v1.sides[0].who) && v1.sides.length === 2);
  let g = await gauge();
  ok('the gauge is shown under the verdict', !g.hidden && g.rows.length === 3, JSON.stringify(g));
  ok('a clear gain for the reader is a Go', g.data === 'go' && /^Go$/.test(g.call) && /clear gain/.test(g.why), JSON.stringify([g.call, g.why]));
  ok('with the needle in the Send it zone, filled in teal', g.pos > 62.5 && g.pos <= 100 && !g.no && g.fill === 'rgb(11, 79, 108)', JSON.stringify([g.pos, g.fill]));
  ok('the short-term row scores the next three weeks for everyone', /Short term · Next 3 weeks/.test(g.rows[0].k) && /^\+\d/.test(g.rows[0].v) && /Helps The Hammers most/.test(g.rows[0].w), JSON.stringify(g.rows[0]));
  ok('the long-term row scores the rest of the season', /Long term · Rest of season/.test(g.rows[1].k) && /^\+\d/.test(g.rows[1].v) && /Helps The Hammers most, \+\d+\.\d a week against \+\d+\.\d for you\./.test(g.rows[1].w), JSON.stringify(g.rows[1]));
  ok('the situation row reads the settings and weighs 35/65', /Your situation/.test(g.rows[2].k) && /Whole season/.test(g.rows[2].v) && /From the settings/.test(g.rows[2].w) && /count 35% and rest of season 65%/.test(g.rows[2].w), JSON.stringify(g.rows[2]));
  ok('and the roster fit is read off the lineup', /weakest start/.test(g.rows[2].w) && !/Add your roster/.test(g.rows[2].w), g.rows[2].w);
  ok('the meter is described for a screen reader', /^Go: \+\d+\.\d points a week/.test(g.aria), g.aria);

  // An overpay: the reader's only quarterback for the partner's tight end.
  await clearDeal();
  await typeAndPick(sendIn(0), NAMES.QB[0]);
  await typeAndPick(sendIn(1), NAMES.TE[1]);
  await page.click('#tf-eval');
  await page.waitForFunction(() => /Don/.test(document.querySelector('.tf-verdict h3').textContent), null, { timeout: 15000 });
  const v2 = await verdict();
  ok('an overpay is called a loss for the reader', /lose/.test(v2.cls) && v2.sides[0].neg && /^−/.test(v2.sides[0].t), JSON.stringify(v2.sides));
  ok('and better trades among the same teams are offered', /these teams/.test(v2.alt || '') && v2.altTrades > 0, JSON.stringify(v2));
  g = await gauge();
  ok('an overpay is a No go', g.data === 'no' && /^No go$/.test(g.call) && /clear loss/.test(g.why), JSON.stringify([g.call, g.why]));
  ok('with the needle in the Walk away zone, filled in the danger brown', g.pos >= 0 && g.pos < 37.5 && g.no && g.fill === 'rgb(138, 59, 0)', JSON.stringify([g.pos, g.fill]));
  ok('the rows say nobody gains, with every side’s figure', g.rows.slice(0, 2).every(r => /^−\d/.test(r.v) && /Nobody gains here: you −\d+\.\d, The Hammers [+−]\d+\.\d\./.test(r.w)), JSON.stringify(g.rows));
  ok('and that the only quarterback leaving opens a hole at QB', /Opens a hole: QB goes unfilled; .* was starting there/.test(g.rows[2].w), g.rows[2].w);
  if (process.env.IT_SHOT) { const p4 = process.env.IT_SHOT.replace(/(\.\w+)?$/, '-gauge$1'); await page.$eval('#tf-gauge', e => e.scrollIntoView()); await page.locator('#tf-gauge').screenshot({ path: p4 }); console.log('wrote ' + p4); }
  await clearDeal();
  ok('an empty trade turns evaluate back off', await page.$eval('#tf-eval', e => e.disabled));
}

console.log('\nevaluate a three-team trade, with notes');
{
  await page.selectOption('#tf-count', '3');
  ok('three trade boxes, each player with a destination', (await page.$$('#tf-sends .tf-team')).length === 3);
  // Reader sends a back to The Hammers; The Hammers send a receiver to the
  // reader; Clinched sends the playoff specialist to The Hammers and gets a
  // back from the reader.
  await typeAndPick(sendIn(0), NAMES.RB[3]);
  await typeAndPick(sendIn(0), NAMES.RB[6]);
  await typeAndPick(sendIn(1), NAMES.WR[6]);
  await typeAndPick(sendIn(2), SPECIAL);
  const dests = await page.$$eval('#tf-sends select[data-to]', ss => ss.map(s => ({ k: s.getAttribute('data-to'), v: s.value, opts: [...s.options].map(o => o.textContent) })));
  ok('every player in a three-team deal gets a “to” dropdown', dests.length === 4, JSON.stringify(dests));
  ok('a dropdown never offers the team sending him', dests.every(d => d.opts.length === 2));
  ok('the reader’s players default to the first other team, the rest to the reader', dests.find(d => d.k === '0:0').v === '1' && dests.find(d => d.k === '1:0').v === '0', JSON.stringify(dests));
  await page.selectOption('#tf-sends select[data-to="0:1"]', '2');
  await page.selectOption('#tf-sends select[data-to="2:0"]', '1');
  // The notes set each team's horizon; each box says how it was read.
  const hz = () => page.$$eval('#tf-teams .tf-hz', els => els.map(e => e.textContent));
  ok('with no notes, every box is scored from the settings', (await hz()).every(t => /Rest of season · from the settings/.test(t)), JSON.stringify(await hz()));
  const reads = [
    ['Iron Tuna hasn’t clinched yet.', 0, /Next 3 weeks.*hasn't clinched/],
    ['My team is 8-1.', 0, /Fantasy playoffs.*8-1/],
    ['The Hammers must win this week or they are done.', 1, /This week.*must win this week/],
    ['The Hammers lost again. They are eliminated.', 1, /Rest of season.*eliminated/],
    ['Clinched is 2-7, rebuilding for next year.', 2, /Rest of season.*rebuilding/],
    ['We are 5-4 and on the bubble.', 0, /Next 3 weeks.*bubble/],
    ['the hammers are 6-3.', 1, /Rest of season · from the settings/],
    ['I have clinched a bye; Clinched needs wins.', 2, /Next 3 weeks.*needs wins/]
  ];
  for (const [note, i, want] of reads) {
    await page.fill('#tf-factors', note);
    const got = (await hz())[i];
    ok('“' + note + '” is read', want.test(got), got);
  }
  await page.fill('#tf-factors', 'Clinched has clinched nothing.');
  ok('a single-word team name only counts capitalized', /from the settings/.test((await hz())[0]) && /Next 3 weeks|Fantasy playoffs/.test((await hz())[2]), JSON.stringify(await hz()));
  await page.fill('#tf-factors', 'I am 7-2 and have clinched. The Hammers are 3-6 and need wins now.');
  const h3 = await hz();
  ok('the reader’s team reads as playoffs from “clinched”', /Fantasy playoffs.*have clinched|Fantasy playoffs.*clinched/.test(h3[0]), h3[0]);
  ok('The Hammers read as the next three weeks', /Next 3 weeks.*need wins/.test(h3[1]), h3[1]);
  ok('a team the notes skip keeps the settings', /Rest of season · from the settings/.test(h3[2]), h3[2]);
  await page.click('#tf-eval');
  await page.waitForFunction(() => document.querySelectorAll('.tf-proposed .tf-side').length === 3, null, { timeout: 15000 });
  const v3 = await verdict();
  ok('every team in the deal is scored', v3.sides.length === 3 && /3-team trade/.test(await page.textContent('.tf-proposed h3')), JSON.stringify(v3.sides.map(s => s.who)));
  const ham = v3.sides.find(s => /The Hammers/.test(s.who)), cl = v3.sides.find(s => /Clinched/.test(s.who));
  ok('The Hammers get a back and the specialist', /Gets[^]*\b/.test(ham.give) && ham.give.split('Gets')[1].includes(NAMES.RB[3]) && ham.give.split('Gets')[1].includes(SPECIAL), ham.give);
  ok('Clinched gets the other back', cl.give.split('Gets')[1].includes(NAMES.RB[6]), cl.give);
  const horizons = await page.$$eval('.tf-proposed .tf-side', ss => ss.map(x => x.querySelector('.gain small').textContent));
  ok('each team is scored on the horizon its notes set', /Fantasy playoffs/.test(horizons[0]) && /Next 3 weeks/.test(horizons[1]) && /Rest of season/.test(horizons[2]), JSON.stringify(horizons));
  ok('the reader gets the receiver and sends two', v3.sides[0].give.split('Gets')[1].includes(NAMES.WR[6]) && /^You/.test(v3.sides[0].who), v3.sides[0].give);
  const g3 = await gauge();
  ok('a clinched reader’s long term is the fantasy playoffs', /Long term · Fantasy playoffs/.test(g3.rows[1].k) && /Short term · Next 3 weeks/.test(g3.rows[0].k), JSON.stringify(g3.rows.map(r => r.k)));
  ok('the situation row reads the notes and weighs 25/75', /Playoff-bound/.test(g3.rows[1 + 1].v) && /From your notes: “[^”]*clinched”/.test(g3.rows[2].w) && /count 25% and fantasy playoffs 75%/.test(g3.rows[2].w), JSON.stringify(g3.rows[2]));
  ok('every side in a three-team deal is on each row', g3.rows.slice(0, 2).every(r => /Helps .* most, [+−]\d+\.\d a week against [+−]\d+\.\d for .*, [+−]\d+\.\d for .*\./.test(r.w)), JSON.stringify(g3.rows.slice(0, 2)));
  ok('and the call is made', /^(Go|No go)/.test(g3.call) && g3.pos >= 0 && g3.pos <= 100, JSON.stringify([g3.call, g3.pos]));
  ok('a team taking more players than it sends is told it needs room', /roster spot/.test(await page.textContent('.tf-proposed')));
  await page.waitForFunction(() => /notes say/.test(document.getElementById('tf-take').textContent), null, { timeout: 8000 });
  ok('the notes go to the model with the scored trade', coachCalls === 1 && /7-2/.test(coachBody) && /The Hammers sends/.test(coachBody) && /pts\/week/.test(coachBody), coachBody.slice(0, 200));
  ok('and so does the gauge', /Short term \(Next 3 weeks\)/.test(coachBody) && /Long term \(Fantasy playoffs\)/.test(coachBody) && /Engine call for me: (GO|NO GO)/.test(coachBody), coachBody.slice(-400));
  ok('and its read is shown under the numbers, marked as such', /language model/.test(await page.textContent('#tf-take')));
  // Shrinking to two teams drops the third team's players from the deal and
  // points everyone else's at the one partner left.
  await page.selectOption('#tf-count', '2');
  ok('down to two, the third team’s players leave the deal', !(await page.textContent('#tf-sends')).includes(SPECIAL));
  ok('and no “to” dropdowns are left', (await page.$$('#tf-sends select[data-to]')).length === 0);
  await clearDeal();
  ok('nothing threw while evaluating', errors.length === 0, errors[0]);
}

// ── the Evaluator with no rosters ─────────────────────────────────────────
// The rosters are optional. A deal typed with nothing behind it is scored on
// the players alone and says so; the same deal with the rosters pasted in is
// scored on the lineups.
console.log('\nevaluate with no rosters entered');
{
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/trade-finder', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('tf-read-status').textContent === '', null, { timeout: 8000 });
  ok('a fresh page opens on the Evaluator', await selectedTool() === 'evaluator');
  ok('with empty rosters', (await chipsOf(0)).length === 0 && (await chipsOf(1)).length === 0);
  // The trade box offers the board when there is no roster behind it.
  await typeAndPick(sendIn(0), NAMES.RB[3]);
  ok('a player typed into the trade lands there', (await page.textContent(S(0) + ' .tf-send-list')).includes(NAMES.RB[3]));
  ok('and joins his team’s roster', (await chipsOf(0)).length === 1, String((await chipsOf(0)).length));
  // And keeps offering it after the first pick, when the roster is only him.
  await page.type(sendIn(0), NAMES.RB[6], { delay: 5 });
  await page.waitForSelector(sendIn(0) + ' + .tf-sug:not([hidden]) li', { timeout: 4000 });
  const more = await page.$$eval(sendIn(0) + ' + .tf-sug li', ls => ls.map(l => l.textContent));
  ok('the box still offers the board after the first pick', more.length && more[0].indexOf(NAMES.RB[6]) === 0, more.join(' | '));
  await page.press(sendIn(0), 'Enter');
  ok('two in the trade, two on the roster', (await page.$$(S(0) + ' .chip')).length === 2 && (await chipsOf(0)).length === 2);
  // Taking him back out of the trade takes him off a roster the reader never typed.
  await page.click(S(0) + ' .tf-send-row:nth-child(2) .chip button');
  ok('out of the trade, out of the roster too', (await page.$$(S(0) + ' .chip')).length === 1 && (await chipsOf(0)).length === 1, (await chipsOf(0)).join(' | '));
  await typeAndPick(sendIn(1), NAMES.WR[6]);
  await page.click('#tf-eval');
  await page.waitForSelector('#tf-results:not([hidden]) .tf-verdict', { timeout: 15000 });
  const v0 = await verdict();
  ok('a trade with no rosters is still judged', v0.sides.length === 2 && /^You/.test(v0.sides[0].who), JSON.stringify(v0));
  ok('each side says it was scored on the players alone', (await page.$$('.tf-proposed .lines.bare')).length === 2);
  ok('the bar says no roster was entered', /no roster entered/.test(await page.textContent('#tf-bar')));
  ok('the note says what the rosters would add, and no search ran', /Add the rosters/.test(await page.textContent('#tf-results-note')) && !(await page.$('.tf-alt')));
  // The fourth back outscores the seventh receiver, so on the names alone the
  // reader loses; with the rosters in (a back-heavy team thin at receiver)
  // the same swap was a win above.
  ok('on the players alone, the better player going out is a loss', v0.sides[0].neg && /Don/.test(v0.h), JSON.stringify(v0));
  const g0 = await gauge();
  ok('and the gauge says No go', g0.data === 'no' && g0.pos < 50, JSON.stringify([g0.call, g0.pos]));
  ok('with no roster, the fit asks for one', /Add your roster in step 2/.test(g0.rows[2].w), g0.rows[2].w);
  await pasteInto(rosterIn(0), PASTE);
  await page.waitForFunction(() => document.querySelectorAll('#tf-teams .tf-team').length === 4, null, { timeout: 4000 });
  ok('the paste fills the rosters under the Evaluator too', (await names()).join() === 'Iron Tuna (Ken),The Hammers,Clinched,Bubble Boys' && (await chipsOf(0)).length === 12, (await names()).join());
  ok('the trade is still listed', (await page.$$('#tf-sends .chip')).length === 2);
  await page.click('#tf-eval');
  await page.waitForFunction(() => !document.getElementById('tf-results').hidden && !document.querySelector('.tf-proposed .lines.bare'), null, { timeout: 15000 });
  const v1 = await verdict();
  ok('with the rosters in, the same deal is scored on the lineups, and wins', /win/.test(v1.cls), JSON.stringify(v1));
  const g1 = await gauge();
  ok('and the gauge turns to Go', g1.data === 'go' && g1.pos > 62.5 && /weakest start/.test(g1.rows[2].w), JSON.stringify([g1.call, g1.pos, g1.rows[2].w]));
  ok('and the bar prices the lineup', /pts\/wk/.test(await page.textContent('#tf-bar')));
  // The ribbon is sticky at the top of the window: scrolled to the verdict, it is still at 0.
  ok('the header ribbon stays anchored to the top while scrolled', await page.evaluate(() => { const h = document.querySelector('header.site'); return window.scrollY > 100 && getComputedStyle(h).position === 'sticky' && Math.round(h.getBoundingClientRect().top) === 0; }), String(await page.evaluate(() => [window.scrollY, document.querySelector('header.site').getBoundingClientRect().top])));
  // A full-page screenshot is taken from the top, or the sticky ribbon lands mid-picture.
  if (process.env.IT_SHOT) { const p3 = process.env.IT_SHOT.replace(/(\.\w+)?$/, '-evaluator$1'); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: p3, fullPage: true }); console.log('wrote ' + p3); }
  // A link can open either tool: the hash switches in place (this goto is a
  // same-document navigation, so nothing reloads) and a fresh load reads it.
  await page.goto(BASE + '/trade-finder#finder', { waitUntil: 'load' });
  ok('a hash change switches the tool in place', await selectedTool() === 'finder' && await page.$eval('#tf-results', e => e.hidden));
  await page.click('#tf-find');
  await page.waitForSelector('#tf-results:not([hidden]) .tf-trade', { timeout: 15000 });
  ok('the Finder shows no gauge', await page.$eval('#tf-gauge', e => e.hidden && e.innerHTML === ''));
  await page.goto('about:blank');
  await page.goto(BASE + '/trade-finder#finder', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('tf-read-status').textContent === '', null, { timeout: 8000 });
  lay = await layout();
  ok('/trade-finder#finder opens the Finder', await selectedTool() === 'finder' && !lay.dealShown && lay.countIn === 'tf-rosters', JSON.stringify(lay));
  ok('with the rosters and the trade kept', (await names()).length === 4 && (await page.$$('#tf-sends .chip')).length === 2);
  ok('nothing threw without rosters', errors.length === 0, errors[0]);
}

// ── the FAAB Advisor by hand ───────────────────────────────────────────────
console.log('\nthe FAAB Advisor, entered by hand');
{
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/faab', { waitUntil: 'load' });
  ok('the manual step is offered', await page.$eval('#step-manual', e => !e.hidden));
  await page.click('#fa-manual-btn');
  ok('and opens', await page.$eval('#fa-manual', e => !e.hidden));
  await page.waitForFunction(() => document.getElementById('fm-week').value === '5', null, { timeout: 4000 }).catch(() => {});
  ok('the week comes from the site’s clock', await page.$eval('#fm-week', e => e.value) === '5', await page.$eval('#fm-week', e => e.value));
  await page.fill('#fm-teams', '12'); await page.fill('#fm-budget', '100'); await page.fill('#fm-left', '80');
  await page.fill('#fm-rivals', ['Hammers $95', 'Clinched 60', 'Bubble Boys $0', 'Rival 4 $20', 'Rival 5 $100'].join('\n'));
  // The reader is thin at RB (two backs, three slots with flex), so a free-agent
  // back clears the bar; the wire also carries a receiver and a quarterback.
  await page.fill('#fm-mine', [NAMES.QB[0], NAMES.RB[20], NAMES.RB[25], NAMES.WR[0], NAMES.WR[1], NAMES.WR[2], NAMES.TE[0]].join('\n'));
  await page.fill('#fm-wire', [NAMES.RB[6] + ' RB', NAMES.WR[12], NAMES.QB[8] + ' QB', 'Someone Unknown WR'].join('\n'));
  await page.click('#fm-go');
  await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
  const rd = () => page.evaluate(() => {
    const d = t => { const m = /\$(\d+)/.exec(t || ''); return m ? +m[1] : null; };
    return {
      bar: document.getElementById('fa-bar').textContent, room: document.getElementById('fa-room').textContent,
      rivals: [...document.querySelectorAll('.fa-rival')].map(e => ({ txt: e.textContent, broke: e.classList.contains('broke') })),
      rows: [...document.querySelectorAll('#fa-rows tr')].map(tr => { const td = [...tr.children].map(c => c.textContent.trim()); return { name: td[0], ros: d(td[1]), going: d(td[2]), max: d(td[3]), call: td[4], vs: td[5] }; }),
      note: document.getElementById('fa-note').textContent, obs: document.getElementById('fa-obs').hidden ? '' : document.getElementById('fa-obs').textContent
    };
  });
  let r = await rd();
  ok('the bar states the budget typed', /\$80/.test(r.bar) && /Week/.test(r.bar) && /5/.test(r.bar), r.bar.slice(0, 120));
  ok('five rivals, one of them broke', r.rivals.length === 5 && r.rivals.filter(x => x.broke).length === 1, JSON.stringify(r.rivals));
  ok('the room counts who can outbid', /2 teams can outbid you/.test(r.room), r.room.slice(0, 160));
  ok('the wire is priced', r.rows.length >= 3 && r.rows.every(x => x.max !== null), JSON.stringify(r.rows.slice(0, 3)));
  ok('the named back leads it', r.rows[0].name.indexOf(NAMES.RB[6]) === 0, r.rows[0].name);
  ok('no recommended bid exceeds the money left', r.rows.every(x => x.max <= 80));
  ok('no going rate exceeds the richest rival', r.rows.every(x => x.going == null || x.going <= 100));
  ok('a $0 rival is never the competition', !r.rows.some(x => /Bubble Boys/.test(x.vs)));
  ok('the unrecognized name is reported', /Not recognized.*Someone Unknown/.test(r.note), r.note.slice(-120));
  ok('and the note says rivals’ holes were assumed', /assumed to have a hole/.test(r.note));
  const goingBefore = r.rows[0].going;

  // History: three settled bids at a rate far above the model's move the
  // going rate up; the rate line says how many bids it rests on.
  await page.click('#fa-reset');
  await page.waitForSelector('#fa-manual:not([hidden])', { timeout: 4000 });
  await page.fill('#fm-hist', ['Week 2: ' + NAMES.RB[8] + ' $61', 'wk 3 - ' + NAMES.WR[10] + ' - $55', NAMES.TE[6] + ' 40 week 4', 'Week 1 Nobody Here $5'].join('\n'));
  await page.click('#fm-go');
  await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
  r = await rd();
  ok('the settled bids are listed', /\$61/.test(r.obs) && /\$55/.test(r.obs), r.obs.slice(0, 200));
  ok('and the unknown one is not', !/Nobody/.test(r.obs));
  ok('three bids make a rate', /From 3 settled bids/.test(r.obs), r.obs.slice(-260));
  ok('the going rate moved toward what the room pays', r.rows[0].going != null && r.rows[0].going > goingBefore, `${r.rows[0].going} vs ${goingBefore}`);
  ok('still never above the richest rival', r.rows.every(x => x.going == null || x.going <= 100));
  ok('a "Bid $n" still beats the going rate and is affordable', r.rows.filter(x => /^Bid/.test(x.call)).every(x => { const b = +/\$(\d+)/.exec(x.call)[1]; return b > (x.going || 0) && b <= 80; }));
  if (process.env.IT_SHOT) { const p2 = process.env.IT_SHOT.replace(/(\.\w+)?$/, '-faab$1'); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: p2, fullPage: true }); console.log('wrote ' + p2); }

  // A reload comes straight back to the typed league.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
  ok('a reload returns to the typed league', await page.$eval('#fa-connect', e => e.hidden));
  ok('nothing on the FAAB page threw', errors.length === 0, errors[0]);
}

// ── a saved league ─────────────────────────────────────────────────────────
console.log('\nthe saved league, teams typed by name');
{
  SYNCED = true;
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const pg = await c2.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await pg.goto(BASE + '/trade-finder', { waitUntil: 'load' });
  await pg.waitForSelector('#tf-synced:not([hidden])', { timeout: 8000 });
  await pg.click('#tf-load-league');
  await pg.waitForFunction(() => /7 teams/.test(document.getElementById('tf-load-status').textContent), null, { timeout: 8000 });
  const nm = () => pg.$$eval('#tf-teams .tf-team input.nm', els => els.map(e => e.value));
  ok('the reader’s team loads into the first box', (await nm())[0] === 'My Squad');
  ok('with its roster', (await pg.$$('#tf-teams .tf-team[data-i="0"] .chip')).length === 4);
  ok('and is marked as the reader’s', await pg.$eval('#tf-teams .tf-team[data-i="0"]', e => e.classList.contains('mine')));
  ok('every league team is offered by name', (await pg.$$eval('#tf-league-names option', os => os.map(o => o.value))).length === 7);
  // Typing a team's name brings its roster.
  await pg.fill('#tf-teams .tf-team[data-i="1"] input.nm', 'Rival C');
  await pg.press('#tf-teams .tf-team[data-i="1"] input.nm', 'Tab');
  ok('typing a league team fills its roster', (await nm())[1] === 'Rival C' && (await pg.$$('#tf-teams .tf-team[data-i="1"] .chip')).length === 3);
  await pg.selectOption('#tf-count', '4');
  await pg.fill('#tf-teams .tf-team[data-i="3"] input.nm', 'rival f');
  await pg.press('#tf-teams .tf-team[data-i="3"] input.nm', 'Tab');
  ok('in any box, whatever the case', (await nm())[3] === 'Rival F' && (await pg.$$('#tf-teams .tf-team[data-i="3"] .chip')).length === 3);
  ok('the saved league page threw nothing', errs.length === 0, errs[0]);
  await c2.close();
}

// ── a phone, keyboard up ───────────────────────────────────────────────────
// The on-screen keyboard leaves a short visual viewport, and the sticky
// masthead and the fixed tab bar cover the ends of it. A box in the bottom
// half opens its list straight under the keyboard unless the page moves the
// box up first, so the list has to land inside what is on screen.
console.log('\na phone with the keyboard up');
{
  const c3 = await browser.newContext({ viewport: { width: 390, height: 320 }, isMobile: true, hasTouch: true });
  const pg = await c3.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await pg.goto(BASE + '/trade-finder#evaluator', { waitUntil: 'load' });
  await pg.waitForFunction(() => document.getElementById('tf-read-status').textContent === '', null, { timeout: 8000 });
  const box = '#tf-sends .tf-team[data-i="1"] .tf-type';
  // Where the keyboard would put the box: at the foot of the visible screen.
  await pg.$eval(box, el => { el.scrollIntoView({ block: 'end' }); el.focus(); });
  await pg.type(box, NAMES.WR[2].slice(0, 4), { delay: 5 });
  await pg.waitForSelector(box + ' + .tf-sug:not([hidden]) li', { timeout: 4000 });
  const fit = await pg.$eval(box, el => {
    const ul = el.parentNode.querySelector('.tf-sug'), r = ul.getBoundingClientRect(), b = el.getBoundingClientRect();
    const head = document.querySelector('header.site').getBoundingClientRect(), tab = document.querySelector('.tabbar').getBoundingClientRect();
    return { listTop: r.top, listBottom: r.bottom, boxTop: b.top, headBottom: head.bottom, tabTop: tab.top, h: innerHeight };
  });
  ok('the list opens on screen, above the tab bar', fit.listBottom <= fit.tabTop && fit.listBottom <= fit.h, JSON.stringify(fit));
  ok('and the box is not pushed under the masthead', fit.boxTop >= fit.headBottom, JSON.stringify(fit));
  ok('the phone page threw nothing', errs.length === 0, errs[0]);
  await c3.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
