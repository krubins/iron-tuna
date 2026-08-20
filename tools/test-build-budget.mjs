#!/usr/bin/env node
// Regression test for the budget box in The Build on the front page.
//   node tools/test-build-budget.mjs
//
// WHAT IS BEING PROVED. The front page ships one solved roster — the $200 one that
// tools/build-front-analysis.mjs wrote out of the app's own engine. The budget box
// lets a reader ask for a different cap, and the page answers it in the browser: it
// rescales the shipped prices and re-solves the lineup against them. So the page is
// now doing arithmetic the generator did not check, and there are two ways it could
// quietly lie:
//
//   1. THE PRICES. front.html rescales from the shipped board rather than re-running
//      the valuation pipeline (which does not fit on a news page). That is only sound
//      because renormalizeToBudget() scales every rostered player's dollars above the
//      minimum bid by ONE league-wide factor, so a change of budget moves the total on
//      the board and nothing else about its shape.
//   2. THE LINEUP. front.html re-implements the app's multiple-choice knapsack in ~90
//      lines. A cheaper knapsack that looks plausible is the easiest bug in the repo
//      to ship, because every answer it gives is a real roster.
//
// So this test does not check the page against itself. It boots the REAL app, runs the
// REAL valuation pipeline at each budget, solves with the REAL planner, and demands the
// front page match: same prices, same roster, same spend, same points. If the two ever
// disagree the front page is wrong, because the app is what the reader buys.
//
// Needs playwright (or playwright-core) plus a Chromium binary (preinstalled at
// /opt/pw-browsers in Claude Code remote sessions, else set CHROMIUM_PATH). Skips
// cleanly rather than failing when they are absent.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8733;
// Every board the box can reach, not a sample of them: the whole point of shipping
// solved boards is that each one is checkable against the engine that solved it.
const BUDGETS = [];
for (let b = 25; b <= 500; b += 25) BUDGETS.push(b);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (e) {
    console.log('SKIP — needs playwright (' + e.message.split('\n')[0] + ')');
    process.exit(0);
  }
}
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
       .find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── instrumented copy of the app ────────────────────────────────────────────
// Two hooks: the planner itself, and the valuation pipeline with its inputs still
// bound, so the test can re-price the whole board at any budget the way the app would.
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HOOK = 'function buildModel(key, myTeam, players, config, draftedIds, roleOverrides, targets, customForced, whatIfAnchors) {';
const VALUE = '    return attachProvisionalAdp(renormalizeToBudget(applyPredictability(buildValuations(ranked, config, marketAnchors).players, config), config), config);';
if (!index.includes(HOOK)) { console.error('buildModel signature moved — update the hook in this script'); process.exit(1); }
if (!index.includes(VALUE)) { console.error('the baseValued pipeline moved — update the hook in this script'); process.exit(1); }
let probe = index
  .replace(HOOK, HOOK + '\n  try { window.__ITDBG = { myTeam, players, config, draftedIds, roleOverrides, targets }; } catch (e) {}')
  .replace(VALUE, '    try { window.__ITVAL = function (cfg) { return renormalizeToBudget(applyPredictability(buildValuations(ranked, cfg, marketAnchors).players, cfg), cfg); }; } catch (e) {}\n' + VALUE);
const lines = probe.split('\n');
const close = lines.map((l, i) => [l.trim(), i]).filter(([l]) => l === '</script>').pop()[1];
lines.splice(close, 0, 'try { window.__ITFN = { buildModel }; } catch (e) {}');
probe = lines.join('\n');
const PROBE_FILE = path.join(ROOT, '.front-analysis-probe.html');
fs.writeFileSync(PROBE_FILE, probe);

// ── static server, with the projections the Worker normally serves ──────────
const PROJ_KEY = 'tn$9xQ27z';
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const projStart = worker.indexOf('const PROJECTIONS = [');
const PROJECTIONS = eval(worker.slice(projStart, worker.indexOf('\n];', projStart) + 3).replace('const PROJECTIONS =', ''));
const xb64 = (str, key) => Buffer.from(
  Buffer.from(str, 'utf8').map((b, i) => b ^ key.charCodeAt(i % key.length))
).toString('base64');
const PROJ_BODY = xb64(JSON.stringify(PROJECTIONS), PROJ_KEY);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/projections') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(PROJ_BODY);
  }
  if (req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  const file = url === '/auctiondraft' ? PROBE_FILE
    : url === '/' ? path.join(ROOT, 'front.html')
    : path.join(ROOT, url.replace(/^\/+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('nope'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext();
const app = await ctx.newPage();
for (const [pat, rel] of [
  ['https://unpkg.com/react@18/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
]) {
  const local = path.join(ROOT, 'node_modules', rel);
  if (fs.existsSync(local)) {
    await app.route(pat, r => r.fulfill({
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(local, 'utf8'),
    }));
  }
}
app.on('pageerror', e => console.error('app page error:', e.message));
await app.addInitScript(() => {
  localStorage.setItem('iron_tuna_account_v1', JSON.stringify({ user: { email: 'test@local' }, entitlements: { bundle: true } }));
});
await app.goto(`http://127.0.0.1:${PORT}/auctiondraft?screen=board`, { waitUntil: 'domcontentloaded' });
await app.waitForFunction(() => window.__ITDBG && window.__ITFN && window.__ITVAL && window.__ITDBG.players && window.__ITDBG.players.length > 100, null, { timeout: 60000 });

// ── ground truth: the app's own board and planner, at each budget ───────────
const truth = await app.evaluate(budgets => {
  const d = window.__ITDBG, F = window.__ITFN, G = 17;
  const out = {};
  budgets.forEach(budget => {
    const cfg = { ...d.config, budget };
    const players = window.__ITVAL(cfg);
    const minBid = cfg.valuation.minBid;
    const priceOf = pl => Math.max(minBid, Math.round(pl.marketValue ?? pl.auctionValue ?? minBid));
    const spots = Object.values(cfg.roster).reduce((a, c) => a + c.total, 0);
    const myTeam = { ...d.myTeam, budgetRemaining: budget, spotsRemaining: spots };
    const plan = F.buildModel('ideal', myTeam, players, cfg, d.draftedIds, d.roleOverrides, d.targets);
    const lineup = plan.slots.filter(s => s.isStarter && s.player).map(s => ({
      slot: s.label, name: s.player.name, price: priceOf(s.player), ppg: +(s.player.projectedPoints / G).toFixed(1)
    }));
    out[budget] = {
      lineup,
      spend: lineup.reduce((a, x) => a + x.price, 0),
      ppg: +lineup.reduce((a, x) => a + x.ppg, 0).toFixed(1),
      // a price spot-check that does not depend on the solver at all
      prices: ['Jahmyr Gibbs', 'Josh Allen', 'Brock Bowers', 'Chris Olave', 'Tucker Kraft']
        .map(n => { const p = players.filter(x => x.name === n)[0]; return { n, d: p ? priceOf(p) : null }; })
    };
  });
  return out;
}, BUDGETS);

// ── the front page, driven through the box ─────────────────────────────────
const front = await ctx.newPage();
front.on('pageerror', e => console.error('front page error:', e.message));
await front.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await front.waitForFunction(() => document.querySelectorAll('#rosterStrip .rs').length > 0, null, { timeout: 20000 });

const read = () => front.evaluate(() => ({
  budget: +document.getElementById('buildBudgetInput').value,
  meta: document.getElementById('buildMeta').textContent,
  shape: (document.querySelector('#buildCards .bcard:last-child h4') || {}).textContent || '',
  cliffs: Array.from(document.querySelectorAll('#buildCards .cliff .cliff-body')).map(e => e.textContent),
  side: document.getElementById('buildSide').textContent,
  lineup: Array.from(document.querySelectorAll('#rosterStrip .rs')).map(e => ({
    slot: e.querySelector('.rs-slot').textContent,
    name: e.querySelector('.rs-name').getAttribute('title'),
    price: +e.querySelector('.rs-price').textContent.replace('$', ''),
    ppg: +e.querySelector('.rs-ppg').textContent.replace(' pts/gm', '')
  }))
}));
const setBudget = async v => {
  await front.fill('#buildBudgetInput', String(v));
  await front.dispatchEvent('#buildBudgetInput', 'change');
  await front.waitForFunction(b => document.getElementById('buildMeta').textContent.indexOf('$' + b + ' ') >= 0, v, { timeout: 20000 });
};

console.log('the box itself');
const box = await front.evaluate(() => {
  const el = document.getElementById('buildBudgetInput');
  return { present: !!el, enabled: el && !el.disabled, value: el && el.value,
    min: el && el.min, max: el && el.max, step: el && el.step, label: el && el.getAttribute('aria-label'),
    presets: Array.from(document.querySelectorAll('#buildPresets button')).map(b => b.textContent),
    pressed: Array.from(document.querySelectorAll('#buildPresets button[aria-pressed="true"]')).map(b => b.textContent),
    noteShown: !document.getElementById('buildBudgetLine').hidden };
});
ok('the budget is an input, not static type', box.present);
ok('it is live once there is a pool to re-solve against', box.enabled);
ok('it opens on the shipped budget', box.value === '200', 'got ' + box.value);
ok('it is bounded', box.min === '25' && box.max === '500', `${box.min}-${box.max}`);
ok('it steps in $25s', box.step === '25', box.step);
ok('it is labelled for screen readers', !!box.label, box.label || 'no aria-label');
ok('the presets are there', box.presets.join(',') === '$100,$200,$300,$500', box.presets.join(','));
ok('the section says what the box does', box.noteShown);
ok('the preset for the budget on show is the one marked', box.pressed.join(',') === '$200', box.pressed.join(','));

// The shipped $200 roster must survive a round trip through the box, or the page is
// contradicting the numbers the generator wrote into it.
const shipped = await read();
const ANALYSIS = JSON.parse(fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8').match(/^var ANALYSIS = (\{.*\});$/m)[1]);
const BASE_PRICE = new Map();   // name -> price on each solved board
Object.values(ANALYSIS.pool).forEach(list => list.forEach(p => BASE_PRICE.set(p.n, p.d)));
ANALYSIS.cliffs.forEach(c => { BASE_PRICE.set(c.above, c.abovePrices); BASE_PRICE.set(c.below, c.belowPrices); });
ok('opens on the shipped roster',
  JSON.stringify(shipped.lineup.map(l => [l.slot, l.name, l.price, l.ppg])) ===
  JSON.stringify(ANALYSIS.lineup.map(l => [l.slot, l.name, l.price, l.ppg])));

for (const budget of BUDGETS) {
  console.log(`$${budget}`);
  await setBudget(budget);
  const got = await read();
  const want = truth[budget];
  const bench = (ANALYSIS.spotsPerTeam - ANALYSIS.starterSlots) * ANALYSIS.minBid;

  ok('the headline number is the one asked for', got.budget === budget, String(got.budget));
  ok('the meta line and the shape card follow the box',
    got.meta.indexOf('$' + budget + ' ') >= 0 && got.shape === 'The shape of a winning $' + budget,
    got.shape);
  ok('the roster never outspends the cap', got.lineup.reduce((a, x) => a + x.price, 0) <= budget - bench,
    `spent ${got.lineup.reduce((a, x) => a + x.price, 0)} of ${budget - bench}`);
  ok('same roster the app solves', JSON.stringify(got.lineup.map(l => [l.slot, l.name])) === JSON.stringify(want.lineup.map(l => [l.slot, l.name])),
    '\n      page: ' + got.lineup.map(l => l.slot + ' ' + l.name).join(', ') +
    '\n      app:  ' + want.lineup.map(l => l.slot + ' ' + l.name).join(', '));
  ok('same prices the app charges', JSON.stringify(got.lineup.map(l => l.price)) === JSON.stringify(want.lineup.map(l => l.price)),
    'page ' + got.lineup.map(l => l.price).join('/') + ' vs app ' + want.lineup.map(l => l.price).join('/'));
  ok('same points the app projects',
    +got.lineup.reduce((a, x) => a + x.ppg, 0).toFixed(1) === want.ppg,
    `${+got.lineup.reduce((a, x) => a + x.ppg, 0).toFixed(1)} vs ${want.ppg}`);

  // The board on its own, away from the solver: players the roster never buys have to
  // be priced right too, because the cliff card names them.
  const board = ANALYSIS.budgets.indexOf(budget);
  const off = want.prices.map(p => ({ n: p.n, app: p.d, page: (BASE_PRICE.get(p.n) || [])[board] }))
    .filter(r => r.page != null && r.page !== r.app);
  ok('every shipped price is the price the app charges',
    off.length === 0, off.map(r => `${r.n} page $${r.page} vs app $${r.app}`).join('; '));
  ok('the cliff card is priced for this budget',
    got.cliffs.length === ANALYSIS.cliffs.length &&
    got.cliffs.every((t, i) => t.indexOf('($' + ANALYSIS.cliffs[i].abovePrices[board] + ')') >= 0),
    got.cliffs.join(' | '));
}

// A budget between two solved boards has to land on one of them, not be invented.
console.log('snapping');
await setBudget(200);
await front.fill('#buildBudgetInput', '260');
await front.dispatchEvent('#buildBudgetInput', 'change');
await front.waitForTimeout(500);
const snapped = await read();
ok('a budget between boards snaps to the nearest solved one', snapped.budget === 250, String(snapped.budget));
ok('the snapped board is the one on the page', snapped.shape === 'The shape of a winning $250', snapped.shape);

// Typing something silly must not leave a roster nobody could buy on the page.
console.log('bad input');
await setBudget(200);
await front.fill('#buildBudgetInput', '4');
await front.dispatchEvent('#buildBudgetInput', 'change');
await front.waitForTimeout(500);
const low = await read();
ok('a below-floor budget is clamped, not solved', low.budget === 25 && low.lineup.length === 9, String(low.budget));
await front.fill('#buildBudgetInput', '99999');
await front.dispatchEvent('#buildBudgetInput', 'change');
await front.waitForTimeout(500);
const high = await read();
ok('an absurd budget is clamped to the ceiling', high.budget === 500, String(high.budget));
await front.fill('#buildBudgetInput', '');
await front.dispatchEvent('#buildBudgetInput', 'change');
await front.waitForTimeout(500);
const blank = await read();
ok('an empty box falls back to the last good budget', blank.budget === 500 && blank.lineup.length === 9, String(blank.budget));

await browser.close();
server.close();
fs.unlinkSync(PROBE_FILE);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
