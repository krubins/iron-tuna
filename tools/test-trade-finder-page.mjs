#!/usr/bin/env node
// The Trade Finder page, and the FAAB Advisor's manual mode, in a browser.
//   node tools/test-trade-finder-page.mjs
//   IT_SHOT=/tmp/tf.png node tools/test-trade-finder-page.mjs   # plus rendered copies
//
// tools/test-trade-finder.mjs proves the engine. This proves the PAGE drives
// it: the paste lands as teams, a screenshot's names come back through the
// reader and resolve on the board, the horizon and balance controls reach the
// search, and every trade shown gains both sides. The FAAB manual form is here
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
// mode — which resolves against it-league.js's default board — recognises them
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
let readerCalls = 0;
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

// ── the paste ──────────────────────────────────────────────────────────────
console.log('\nthe paste');
await page.goto(BASE + '/trade-finder', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('tf-read-status').textContent === '', null, { timeout: 8000 });
await page.fill('#tf-text', PASTE);
await page.click('#tf-parse');
await page.waitForSelector('.tf-team', { timeout: 8000 });
const teams = await page.$$eval('.tf-team', els => els.map(e => ({ name: e.querySelector('input.nm').value, chips: [...e.querySelectorAll('.chip')].map(c => c.textContent.trim()), fix: e.querySelectorAll('.tf-fix div').length })));
ok('four teams, from four blocks', teams.length === 4, teams.map(t => t.name).join(' | '));
ok('the first team keeps its name and not its owner line', teams[0].name === 'Iron Tuna (Ken)', teams[0].name);
ok('"Team: Clinched" is named Clinched', teams[2].name === 'Clinched', teams[2].name);
ok('the reader’s roster landed in full', teams[0].chips.length === 12, String(teams[0].chips.length));
ok('the defence and kicker are shown as ignored, not as teams', teams[0].chips.some(c => /Bills/.test(c)) && !teams.some(t => /Bills/.test(t.name)));
ok('nothing unrecognised', teams.every(t => t.fix === 0));
ok('the status line counts it', /4 teams, 4\d players placed/.test(await page.textContent('#tf-read-status')), await page.textContent('#tf-read-status'));

// ── the screenshot path ────────────────────────────────────────────────────
console.log('\nthe screenshot reader');
{
  // A 2x2 PNG is enough for the client to shrink and post; the stub answers.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAD0lEQVQIW2P4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#tf-files', { name: 'roster.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.querySelectorAll('.tf-team').length === 5, null, { timeout: 8000 });
  ok('the reader was called once with the image', readerCalls === 1, String(readerCalls));
  const five = await page.$$eval('.tf-team', els => els.map(e => ({ name: e.querySelector('input.nm').value, chips: e.querySelectorAll('.chip').length, fix: [...e.querySelectorAll('.tf-fix span')].map(s => s.textContent) })));
  ok('the screenshot’s team joined the others', five[4].name === 'Screenshot Team', five[4].name);
  ok('its readable names resolved on the board', five[4].chips === 2, String(five[4].chips));
  ok('the misread name is offered to fix, never priced', five[4].fix.length === 1 && /Nobody/.test(five[4].fix[0]), JSON.stringify(five[4].fix));
  // Fix it by typing, then remove the team so the search below is the four-team league.
  await page.fill('.tf-team[data-i="4"] .tf-fix input', NAMES.WR[13]);
  await page.press('.tf-team[data-i="4"] .tf-fix input', 'Enter');
  await page.dispatchEvent('.tf-team[data-i="4"] .tf-fix input', 'change').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.tf-team[data-i="4"] .chip').length === 3, null, { timeout: 4000 }).catch(() => {});
  ok('a typed fix resolves and joins the roster', (await page.$$('.tf-team[data-i="4"] .chip')).length === 3);
  await page.click('.tf-team[data-i="4"] .kill');
  ok('a team can be removed', (await page.$$('.tf-team')).length === 4);
}

// ── the search ─────────────────────────────────────────────────────────────
console.log('\nthe search');
await page.click('.tf-team[data-i="0"] .mine-btn');
await page.click('#tf-find');
await page.waitForSelector('#tf-results:not([hidden]) .tf-trade', { timeout: 15000 });
const read = () => page.$$eval('.tf-trade', els => els.map(e => {
  const sides = [...e.querySelectorAll('.tf-side')].map(s => ({ who: s.querySelector('.who').textContent, gain: parseFloat(s.querySelector('.gain').textContent), horizon: s.querySelector('.gain small').textContent, give: s.querySelector('.give').textContent }));
  return { title: e.querySelector('h3').textContent, sides };
}));
let trades = await read();
ok('trades are listed', trades.length > 0 && trades.length <= 12, String(trades.length));
ok('every trade gains both sides', trades.every(t => t.sides.length === 2 && t.sides.every(s => s.gain > 0)), JSON.stringify(trades[0]));
ok('the reader is always "You"', trades.every(t => t.sides[0].who.startsWith('You')), trades[0].sides[0].who);
ok('the reader sends a running back and gets a receiver in the first trade', /Sends[^]*RB/.test(trades[0].sides[0].give) && /Gets[^]*WR/.test(trades[0].sides[0].give), trades[0].sides[0].give.slice(0, 160));
ok('the bar names the reader’s team and lineup', /Iron Tuna \(Ken\)/.test(await page.textContent('#tf-bar')) && /pts\/wk/.test(await page.textContent('#tf-bar')));
ok('both sides read the rest of the season by default', trades.every(t => t.sides.every(s => /Rest of season/.test(s.horizon))));
const evenTop = trades[0];

// The balance slider: tilted all the way, the reader's gain in the top trade
// does not fall, and the other side still gains.
await page.$eval('#tf-tilt', el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#tf-find');
await page.waitForFunction(() => /In your favour/.test(document.getElementById('tf-bar').textContent), null, { timeout: 15000 });
trades = await read();
ok('tilted, the top trade gains the reader at least as much', trades[0].sides[0].gain >= evenTop.sides[0].gain - 0.05, `${trades[0].sides[0].gain} vs ${evenTop.sides[0].gain}`);
ok('and every partner still gains', trades.every(t => t.sides[1].gain > 0));
ok('the bar says so', /In your favour/.test(await page.textContent('#tf-bar')));

// Horizons: the reader on the playoff weeks, the partners on the next three.
await page.$eval('#tf-tilt', el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#tf-hA button[data-h="playoffs"]');
await page.click('#tf-hB button[data-h="next3"]');
await page.click('#tf-find');
await page.waitForFunction(() => /Fantasy playoffs/.test(document.querySelector('#tf-bar').textContent), null, { timeout: 15000 });
trades = await read();
ok('the reader’s side is scored on the playoffs', trades.every(t => /Fantasy playoffs/.test(t.sides[0].horizon)), trades[0] && trades[0].sides[0].horizon);
ok('and the partner’s on the next three weeks', trades.every(t => /Next 3 weeks/.test(t.sides[1].horizon)), trades[0] && trades[0].sides[1].horizon);
ok('the playoff specialist is on the table', trades.some(t => t.sides[0].give.indexOf('Gets') >= 0 && t.sides[0].give.split('Gets')[1].indexOf(SPECIAL) >= 0), trades.map(t => t.title).slice(0, 4).join(' | '));

// Reload: the rosters and settings come back.
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.tf-team', { timeout: 8000 });
ok('a reload keeps the rosters', (await page.$$('.tf-team')).length === 4);
ok('and the reader’s team', await page.$eval('.tf-team[data-i="0"]', e => e.classList.contains('mine')));
ok('and the horizons', await page.$eval('#tf-hA button[data-h="playoffs"]', e => e.getAttribute('aria-pressed') === 'true'));
if (process.env.IT_SHOT) { await page.screenshot({ path: process.env.IT_SHOT, fullPage: true }); console.log('wrote ' + process.env.IT_SHOT); }
ok('nothing on the Trade Finder threw', errors.length === 0, errors[0]);

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
  ok('the unrecognised name is reported', /Not recognised.*Someone Unknown/.test(r.note), r.note.slice(-120));
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
  if (process.env.IT_SHOT) { const p2 = process.env.IT_SHOT.replace(/(\.\w+)?$/, '-faab$1'); await page.screenshot({ path: p2, fullPage: true }); console.log('wrote ' + p2); }

  // A reload comes straight back to the typed league.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
  ok('a reload returns to the typed league', await page.$eval('#fa-connect', e => e.hidden));
  ok('nothing on the FAAB page threw', errors.length === 0, errors[0]);
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
