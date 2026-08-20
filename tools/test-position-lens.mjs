#!/usr/bin/env node
// Regression test for the Position Intel reading lens on the front page.
//   node tools/test-position-lens.mjs
//
// THE BUG THIS EXISTS FOR: every "Your league" line under a story has to commit
// to a draft type, and the page used to take that silently from the saved
// league. A reader whose app is set up for a snake draft got the whole of an
// AUCTION site's front page written in draft slots, with no way to say
// otherwise — and no reader who had never opened the app got anything at all.
// The lens is now a switch: it starts on their league, defaults to auction, and
// whatever they pick is remembered on every page it-league.js runs on.
//
// The maths and the copy are covered by tools/test-it-league.mjs against a stub
// DOM. What only a browser can prove is the WIRING: that the switch appears for
// the right readers, that clicking it re-renders the modules AND the lead
// together, and that the choice survives a reload.
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
  ts: 1, teams: 10, budget: 300, format: 'snake',
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
  shown: document.getElementById('posFmt').getClientRects().length > 0,
  on: [...document.querySelectorAll('#posFmt button')].filter(b => b.classList.contains('on')).map(b => b.dataset.fmt).join(),
  sub: document.getElementById('posSub').textContent,
  lines: [...document.querySelectorAll('#posGrid .it-yours')].map(e => e.textContent),
  labels: [...new Set([...document.querySelectorAll('#posGrid .it-yours b')].map(e => e.textContent.replace(/:$/, '')))],
  lead: (document.getElementById('leadYours') || {}).textContent || ''
}));

// ── 1. a snake league opens in slots, and can be read as an auction ────────
console.log('\na snake league on an auction front page');
{
  const store = { iron_tuna_draft_state_v2: league('snake'), iron_tuna_values_v1: JSON.stringify(BOARD) };
  const { page, ctx } = await open(store);
  const before = await read(page);
  ok('the switch is offered', before.shown === true);
  ok('it opens on the league they saved', before.on === 'snake');
  ok('the stories are written in draft slots',
     before.lines.length > 0 && before.lines.every(l => /slot/.test(l)) && !before.lines.some(l => /\$/.test(l)),
     before.lines[0]);
  ok('the standfirst says which lens it is', /slots on your own board/.test(before.sub), before.sub);

  await page.click('#posFmt button[data-fmt="auction"]');
  const after = await read(page);
  ok('one click re-prices every story', after.on === 'auction' && after.lines.every(l => /\$/.test(l)), after.lines[0]);
  ok('the same number of stories survives the switch', after.lines.length === before.lines.length);
  ok('a borrowed lens does not claim to be their league',
     after.lines.every(l => !/your \d+-team snake/.test(l)), after.lines[0]);
  ok('the standfirst follows the switch', /dollars on your own sheet/.test(after.sub), after.sub);

  await page.reload({ waitUntil: 'load' });
  const back = await read(page);
  ok('the choice survives a reload', back.on === 'auction' && back.lines.every(l => /\$/.test(l)));
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
  ok('the switch stays out of the way', s.shown === false);
  ok('the shipped standfirst stands', /New drops land through Labor Day\.$/.test(s.sub.trim()), s.sub);
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
    await page.click('#posFmt button[data-fmt="snake"]');
    const moved = await leadAt();
    ok('the lead follows the same switch as the modules', /slot|hold/.test(moved) && !/\$\d/.test(moved), moved);
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
