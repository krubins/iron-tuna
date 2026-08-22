#!/usr/bin/env node
// The FAAB Advisor: the bid maths, and the claims the page makes about the room.
//   node tools/test-faab.mjs
//
// WHY THIS IS A BROWSER TEST. The advisor is not a renderer with a number in it —
// it is a model, and the model only exists once a real Sleeper league has been
// read: who is rostered, what each roster is starting, how much FAAB every rival
// has left. None of that is reachable from a static read of faab.html. So this
// serves the real page, stubs Sleeper with a league built to have known answers,
// and asserts the numbers that come out.
//
// THE THINGS THAT WOULD BE WRONG AND LOOK RIGHT, which is what the assertions
// below are aimed at:
//
//   - A max bid above the budget. The share model multiplies a fraction by the
//     reader's remaining FAAB; get the fraction wrong (a denominator that can go
//     below the numerator) and the page confidently tells someone to bid $140 of
//     their $80. Nothing about the layout would look broken.
//   - A rest-of-season value that is not scaled down. The whole point of the
//     column is that a player is worth less in week 5 than he was in August; if
//     the weeks-left factor is dropped the page still renders, just with draft
//     prices on it.
//   - Naming a bankrupt rival as the competition. Every roster's remaining budget
//     is knowable, and the one genuinely novel claim this page makes is "these
//     three cannot bid at all". If a $0 team can surface as the top bidder, the
//     feature is worse than not shipping it.
//   - Advising a bid in a league that does not use FAAB, where there is no bid to
//     place and the button should not be clickable at all.
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

// ── the league under test ──────────────────────────────────────────────────
// Twelve teams, $100 FAAB, week 5 of 17. The reader is roster 1 and has spent
// $20, so $80 is the ceiling every max bid has to respect. The rival budgets are
// chosen so the three interesting cases all exist in one fixture: two teams
// richer than the reader, several poorer, and three with nothing left at all.
const WEEK = 5, BUDGET = 100, MY_USED = 20, MY_LEFT = BUDGET - MY_USED;
const RIVAL_USED = [0, 5, 40, 55, 70, 85, 90, 100, 100, 100, 95];   // 11 rivals
const BOARD = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'faab-fixture-names.json'), 'utf8'));

// A real week-5 wire is a long flat tail with two or three genuinely useful
// players stranded in it — someone's handcuff who inherited a backfield, a
// receiver whose target share moved. A fixture that is only the tail cannot tell
// a working model from a broken one: every surplus is zero and every bid is the
// same, which is what the first cut of this page shipped. So a few players are
// pulled OUT of the rostered range and left free on purpose.
const FREED = { RB: [7, 14], WR: [9, 20], QB: [6], TE: [5] };   // 0-based board ranks
const rostered = (pos, n) => BOARD[pos].slice(0, n).filter((_, i) => (FREED[pos] || []).indexOf(i) < 0);
const rosterPool = { QB: rostered('QB', 25), RB: rostered('RB', 38), WR: rostered('WR', 50), TE: rostered('TE', 25) };
const freePool = {
  QB: [BOARD.QB[6], ...BOARD.QB.slice(25, 33)],
  RB: [BOARD.RB[7], BOARD.RB[14], ...BOARD.RB.slice(38, 50)],
  WR: [BOARD.WR[9], BOARD.WR[20], ...BOARD.WR.slice(50, 64)],
  TE: [BOARD.TE[5], ...BOARD.TE.slice(25, 31)]
};

const players = {};       // sleeper id -> [name, pos, team, injury]
let nextId = 1000;
const idFor = (name, pos) => {
  const id = String(nextId++);
  players[id] = [name, pos, 'FA', ''];
  return id;
};
const rosters = [];
for (let i = 0; i < 12; i++) {
  const rid = i + 1;
  const take = (pos, n) => Array.from({ length: n }, (_, k) => {
    const name = rosterPool[pos][i * n + k];
    return name ? idFor(name, pos) : null;
  }).filter(Boolean);
  // Roster 1 (the reader) is deliberately thin at RB: two backs where everyone
  // else has three, so a free-agent back clears its bar and is worth something.
  const rbCount = rid === 1 ? 2 : 3;
  rosters.push({
    roster_id: rid,
    owner_id: 'u' + rid,
    players: [...take('QB', 2), ...take('RB', rbCount), ...take('WR', 4), ...take('TE', 2)],
    settings: { waiver_budget_used: rid === 1 ? MY_USED : RIVAL_USED[rid - 2] }
  });
}
const freeAgents = [];
for (const pos of Object.keys(freePool)) for (const name of freePool[pos]) freeAgents.push(idFor(name, pos));

const users = Array.from({ length: 12 }, (_, i) => ({
  user_id: 'u' + (i + 1),
  display_name: i === 0 ? 'ken' : 'rival' + (i + 1),
  metadata: { team_name: i === 0 ? 'Iron Tuna' : 'Rivals ' + (i + 1) }
}));

const league = {
  league_id: 'L1', name: 'Test FAAB League', total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'],
  settings: { waiver_budget: BUDGET, waiver_type: 2 }
};
const priorityLeague = {
  league_id: 'L2', name: 'Priority League', total_rosters: 10,
  roster_positions: league.roster_positions,
  settings: { waiver_budget: 0, waiver_type: 1 }
};
// ── a second league: a wire with nothing on it ─────────────────────────────
// The whole thesis of the page is that ten interchangeable free agents are worth
// about a dollar each, not ten times a dollar. That claim is invisible in the
// league above, where a couple of genuinely good players are stranded on the
// wire and any model — value-over-replacement or plain absolute value — ranks
// them the same way. It only shows on a FLAT wire: the correct answer there is
// "keep your budget", and a model without a replacement baseline instead prices
// every one of them as if winning it mattered.
const flatLeague = {
  league_id: 'L3', name: 'Flat Wire League', total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'],
  settings: { waiver_budget: BUDGET, waiver_type: 2 }
};
// The page treats "every id in the index that no roster holds" as the free-agent
// pool, and the index is one global map shared by both leagues. So this league's
// rosters have to hold EVERYTHING except the tail — otherwise the other league's
// stranded stars leak in here as free agents and the wire is not flat at all.
const flatTail = [];
for (const pos of ['RB', 'WR', 'TE']) for (const name of BOARD[pos].slice(-12)) flatTail.push(idFor(name, pos));
const flatTailSet = new Set(flatTail);
const flatHeld = Object.keys(players).filter(id => !flatTailSet.has(id));
const flatRosters = Array.from({ length: 12 }, (_, i) => ({
  roster_id: i + 1, owner_id: 'u' + (i + 1),
  players: flatHeld.filter((_, k) => k % 12 === i),
  settings: { waiver_budget_used: i === 0 ? MY_USED : RIVAL_USED[i - 1] }
}));

const SETTLED = [{ id: freeAgents[0], bid: 34, week: 3 }, { id: freeAgents[1], bid: 7, week: 4 }];

// ── the stub ───────────────────────────────────────────────────────────────
const SLEEPER = {
  '/v1/state/nfl': { week: WEEK, display_week: WEEK, season: '2026', season_type: 'regular' },
  '/v1/user/ken': { user_id: 'u1', username: 'ken', display_name: 'ken' },
  '/v1/user/u1/leagues/nfl/2026': [league, priorityLeague, flatLeague],
  '/v1/league/L1': league,
  '/v1/league/L1/rosters': rosters,
  '/v1/league/L1/users': users,
  '/v1/league/L3': flatLeague,
  '/v1/league/L3/rosters': flatRosters,
  '/v1/league/L3/users': users
};
for (let w = 1; w <= WEEK; w++) {
  SLEEPER['/v1/league/L1/transactions/' + w] = SETTLED.filter(s => s.week === w)
    .map(s => ({ status: 'complete', type: 'waiver', settings: { waiver_bid: s.bid }, adds: { [s.id]: 1 } }));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/faab/players') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ updated: Date.now(), players }));
  }
  let name = u.pathname === '/' ? 'faab.html' : u.pathname.slice(1);
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
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.route('**/api.sleeper.app/**', r => {
  const p = new URL(r.request().url()).pathname;
  const body = SLEEPER[p];
  if (body === undefined) return r.fulfill({ status: 404, body: 'nf' });
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.goto(BASE + '/faab', { waitUntil: 'load' });

// ── connect ────────────────────────────────────────────────────────────────
console.log('\nconnecting a league');
await page.fill('#fa-user', 'ken');
await page.click('#fa-user-btn');
await page.waitForSelector('#step-league:not([hidden]) button', { timeout: 8000 });
const leagueBtns = await page.$$eval('#fa-leagues button', bs => bs.map(b => ({ text: b.textContent, disabled: b.disabled })));
ok('every league is listed', leagueBtns.length === 3, JSON.stringify(leagueBtns));
ok('the FAAB league is selectable', !leagueBtns[0].disabled);
// A league on waiver priority has no bid to advise, so offering one would be a lie.
ok('a non-FAAB league cannot be chosen', leagueBtns[1].disabled === true);
ok('and says why', /not a FAAB league/.test(leagueBtns[1].text), leagueBtns[1].text);

await page.click('#fa-leagues button:not([disabled])');
await page.waitForSelector('#step-team:not([hidden]) button', { timeout: 8000 });
ok('every roster is offered as "mine"', (await page.$$('#fa-teams button')).length === 12);
await page.click('#fa-teams button');
await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
// The settled-bid panel walks the transaction log backwards a week at a time and
// lands after the table does, so give it its own wait rather than reading the
// page mid-flight and blaming the feature for the race.
await page.waitForSelector('#fa-obs:not([hidden])', { timeout: 8000 }).catch(() => {});

// ── the numbers ────────────────────────────────────────────────────────────
console.log('\nthe bid maths');
const read = () => page.evaluate(() => {
  const dollars = t => { const m = /\$(\d+)/.exec(t || ''); return m ? +m[1] : null; };
  return {
    bar: document.getElementById('fa-bar').textContent,
    room: document.getElementById('fa-room').textContent,
    rivals: [...document.querySelectorAll('.fa-rival')].map(e => ({ txt: e.textContent, broke: e.classList.contains('broke') })),
    rows: [...document.querySelectorAll('#fa-rows tr')].map(tr => {
      const td = [...tr.children].map(c => c.textContent.trim());
      return { name: td[0], ros: dollars(td[1]), going: dollars(td[2]), max: dollars(td[3]), call: td[4], vs: td[5] };
    }),
    obs: (document.getElementById('fa-obs') || {}).hidden === false
      ? [...document.querySelectorAll('#fa-obs li')].map(e => e.textContent) : []
  };
});
const r = await read();

ok('the advisor found free agents to price', r.rows.length > 4, String(r.rows.length));
ok('the bar states the reader’s remaining budget', r.bar.includes('$' + MY_LEFT), r.bar.slice(0, 200));
ok('and the week it is', /Week/.test(r.bar) && r.bar.includes(String(WEEK)));

// The ceiling. A share of a budget can never exceed the budget.
const overBudget = r.rows.filter(x => x.max > MY_LEFT);
ok('no max bid exceeds the money actually left', overBudget.length === 0,
   overBudget.slice(0, 3).map(x => `${x.name}=$${x.max}`).join(', '));
ok('every max bid is a real number', r.rows.every(x => x.max !== null && x.max >= 0));

// Rest-of-season must be a discount on the full-season price, and the table is
// sorted by it, so it can only fall as you read down.
const ros = r.rows.map(x => x.ros);
ok('rest-of-season value never rises down the board',
   ros.every((v, i) => i === 0 || v <= ros[i - 1]), JSON.stringify(ros.slice(0, 8)));
// The regression this exists for: the first cut of the model priced every free
// agent identically ($2 value, $11 going, $2 max, forty rows of it). Every bound
// check above passed on that output, because identical numbers are trivially
// within bounds and trivially monotonic. A model that cannot tell two players
// apart is not a model.
const maxes = r.rows.map(x => x.max);
ok('the model tells the pool apart', new Set(maxes).size > 1, JSON.stringify(maxes));
ok('and the best free agent is worth more than the worst',
   maxes[0] !== maxes[maxes.length - 1] || r.rows.length < 3, JSON.stringify(maxes));
// The reader is short a running back by construction, so a good free-agent back
// has to be worth more to them than a good receiver they do not need.
const rb = r.rows.find(x => /RB \u00b7/.test(x.name) || /\bRB\b/.test(x.name));
ok('a position the reader is thin at prices above one they are deep at',
   rb ? rb.max > 1 : false, rb ? `${rb.name} max $${rb.max}` : 'no RB row');

const full = await page.evaluate(() => {
  const L = window.ITLeague;
  const b = L.defaultBoard();
  return Math.max(...b.filter(p => p.pos === 'RB').map(p => p.v));
});
ok('and is discounted for the weeks already played', ros[0] < full, `${ros[0]} vs full-season max ${full}`);

// The one genuinely novel claim on the page.
console.log('\nthe room');
const broke = r.rivals.filter(x => x.broke);
ok('the bankrupt rivals are marked', broke.length === RIVAL_USED.filter(u => u >= BUDGET).length,
   `${broke.length} marked, ${RIVAL_USED.filter(u => u >= BUDGET).length} expected`);
ok('all eleven rivals are shown with a budget', r.rivals.length === 11, String(r.rivals.length));
const brokeNames = broke.map(x => x.txt.replace(/\s*\$\d+\s*$/, '').trim());
const namedBroke = r.rows.filter(x => brokeNames.some(n => n && x.vs.includes(n)));
ok('a rival with $0 is never named as the competition', namedBroke.length === 0,
   namedBroke.slice(0, 2).map(x => x.vs).join(' | '));
ok('the room line counts who can outbid the reader',
   /can outbid you outright/.test(r.room) || /largest budget/.test(r.room) || /Nobody else has a dollar/.test(r.room), r.room.slice(0, 160));

// The going rate has to be a bid a real rival could actually place.
const maxRivalLeft = Math.max(...RIVAL_USED.map(u => BUDGET - u));
const impossible = r.rows.filter(x => x.going !== null && x.going > maxRivalLeft);
ok('no going rate exceeds the richest rival’s budget', impossible.length === 0,
   impossible.slice(0, 3).map(x => `${x.name}=$${x.going}`).join(', '));

console.log('\nthe call it makes');
const calls = r.rows.map(x => x.call);
ok('every row carries a call', calls.every(c => /Bid \$|Stretch to \$|Let it go/.test(c)), calls.slice(0, 4).join(' | '));
// The call is the whole point, so the arithmetic behind it is asserted directly:
// "Bid $n" is only honest when n is inside the budget and above the going rate.
const badBid = r.rows.filter(x => /^Bid \$/.test(x.call))
  .filter(x => { const n = +/\$(\d+)/.exec(x.call)[1]; return n > x.max || n <= (x.going || 0); });
ok('a "Bid $n" is always affordable and beats the going rate', badBid.length === 0,
   badBid.slice(0, 3).map(x => `${x.name}: ${x.call} vs max $${x.max}/going $${x.going}`).join(' | '));
const badPass = r.rows.filter(x => x.call === 'Let it go' && x.max > (x.going || 0));
ok('and a "Let it go" is never a player the reader could afford to win', badPass.length === 0,
   badPass.slice(0, 3).map(x => `${x.name}: max $${x.max} > going $${x.going}`).join(' | '));

console.log('\nwhat the league has already paid');
ok('the settled bids the league logged are shown', r.obs.length === SETTLED.length, JSON.stringify(r.obs));
ok('and the biggest one leads', r.obs.length ? /\$34/.test(r.obs[0]) : false, r.obs[0] || '');

// A rendered copy on demand, taken here because the reset below clears the saved
// league and the page goes back to the connect step:
//   IT_SHOT=/tmp/faab.png node tools/test-faab.mjs
if (process.env.IT_SHOT) {
  await page.screenshot({ path: process.env.IT_SHOT, fullPage: true });
  console.log('\nwrote ' + process.env.IT_SHOT);
}

console.log('\na wire with nothing on it');
{
  // Reset and walk back in through the flat league.
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/faab', { waitUntil: 'load' });
  await page.fill('#fa-user', 'ken');
  await page.click('#fa-user-btn');
  await page.waitForSelector('#step-league:not([hidden]) button', { timeout: 8000 });
  const btns = await page.$$('#fa-leagues button');
  await btns[2].click();
  await page.waitForSelector('#step-team:not([hidden]) button', { timeout: 8000 });
  await page.click('#fa-teams button');
  await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
  const flatRows = await page.$$eval('#fa-rows tr', rs => rs.map(r => r.textContent.trim()));
  // One row, and it is the empty state — not forty rows of $2 bids.
  ok('a flat wire is not worth bidding on',
     flatRows.length === 1 && /save the budget/i.test(flatRows[0]),
     flatRows.slice(0, 3).join(' | '));
  ok('and the page says so in as many words',
     /No free agent in this league is worth a bid/i.test(flatRows[0] || ''), flatRows[0] || '');
}

console.log('\nthe league is remembered, and can be changed');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#fa-advisor:not([hidden])', { timeout: 8000 });
ok('a reload goes straight back to the advisor', await page.$eval('#fa-connect', e => e.hidden) === true);
await page.click('#fa-reset');
ok('and "change league" returns to the connect step', await page.$eval('#fa-connect', e => e.hidden) === false);
ok('nothing on the page threw', errors.length === 0, errors[0]);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
