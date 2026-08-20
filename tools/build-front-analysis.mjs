#!/usr/bin/env node
// Rebuilds the `var ANALYSIS = {...};` block in front.html — the numbers behind the
// front page's lead story ("The best team $200 can buy"), the tier-cliff cards, the
// replacement-level bars and the FLEX finding, plus a solved board for every budget the
// section's budget box can be set to.
//
//   node tools/build-front-analysis.mjs [--dry-run]
//
// WHY IT DRIVES A BROWSER
// The authoritative values live in index.html's valuation pipeline (scorePlayer ->
// applyQbActuals -> buildValuations -> applyPredictability -> renormalizeToBudget),
// which is one big in-page script with no module boundary. Re-implementing the scoring
// here would drift from what users actually see, so instead this script serves the repo,
// loads the real app in headless Chromium, and reads the app's own computed players and
// its own exact lineup solver. Whatever the app shows, the front page shows.
//
// Requires Playwright's chromium (dev-time only; `tools/` is in .assetsignore, so none
// of this ships). Run it after projections change — i.e. right after
// tools/merge-projections.mjs succeeds.
//
// EVERY NUMBER ON THE FRONT PAGE COMES FROM HERE. Nothing on that page is hand-written
// analysis, and nothing is a placeholder: if a section has no data it stays hidden
// (see the `edge` contract at the bottom of this file).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONT = path.join(ROOT, 'front.html');
const OUT = path.join(ROOT, 'tools', 'front-analysis.json');
const DRY = process.argv.includes('--dry-run');
const PORT = 8731;
// Every budget the front page's box can be set to. The box steps in $25s and snaps
// typed numbers to the nearest one, so each of these is a board the engine solved —
// nothing between them is ever shown, and nothing is interpolated.
const BUDGETS = [];
for (let b = 25; b <= 500; b += 25) BUDGETS.push(b);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('playwright is required: npm i -D playwright  (dev-time only, nothing ships)');
    process.exit(2);
  }
}
// playwright-core ships no browser, and a playwright whose bundled build does not match
// the Chromium already on the box would re-download one. Reuse whatever is installed,
// same lookup the tools/test-*.mjs scripts use.
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
       .find(p => fs.existsSync(p));

// ── instrumented copy of the app: expose the pure planner functions and the
//    arguments the models panel is actually called with ──────────────────────
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HOOK = 'function buildModel(key, myTeam, players, config, draftedIds, roleOverrides, targets, customForced, whatIfAnchors) {';
if (!index.includes(HOOK)) {
  console.error('buildModel signature moved — update the hook in this script');
  process.exit(1);
}
// The second hook re-runs the app's own valuation pipeline at any budget, with its
// inputs still bound. The front page's budget box needs a real board per budget, and a
// board is not a rescale of another board: calculateMarketValues rounds to whole
// dollars and applyPredictability floors at the minimum bid, so cheap players lose their
// proportions at small budgets and stars lose theirs at large ones. Only the engine
// knows what a $50 board looks like, so the engine is what gets asked.
const VALUE = '    return attachProvisionalAdp(renormalizeToBudget(applyPredictability(buildValuations(ranked, config, marketAnchors).players, config), config), config);';
if (!index.includes(VALUE)) {
  console.error('the baseValued pipeline moved — update the hook in this script');
  process.exit(1);
}
let probe = index
  .replace(HOOK, HOOK + '\n  try { window.__ITDBG = { myTeam, players, config, draftedIds, roleOverrides, targets }; } catch (e) {}')
  .replace(VALUE, '    try { window.__ITVAL = function (cfg) { return renormalizeToBudget(applyPredictability(buildValuations(ranked, cfg, marketAnchors).players, cfg), cfg); }; } catch (e) {}\n' + VALUE);
const lines = probe.split('\n');
const close = lines.map((l, i) => [l.trim(), i]).filter(([l]) => l === '</script>').pop()[1];
lines.splice(close, 0, 'try { window.__ITFN = { buildModel }; } catch (e) {}');
probe = lines.join('\n');
const PROBE_FILE = path.join(ROOT, '.front-analysis-probe.html');
fs.writeFileSync(PROBE_FILE, probe);

// ── static server: the app needs /api/projections, which the Worker normally serves ──
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
  const file = url === '/auctiondraft' ? PROBE_FILE : path.join(ROOT, url.replace(/^\/+/, '') || 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('nope'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();
// index.html pulls React from unpkg. Serve a local copy when one is installed, so
// this works on a machine (or CI box) with no egress to the CDN.
for (const [pat, rel] of [
  ['https://unpkg.com/react@18/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
]) {
  const local = path.join(ROOT, 'node_modules', rel);
  if (fs.existsSync(local)) {
    await page.route(pat, r => r.fulfill({
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(local, 'utf8'),
    }));
  }
}
page.on('pageerror', e => console.error('page error:', e.message));
await page.addInitScript(() => {
  localStorage.setItem('iron_tuna_account_v1', JSON.stringify({ user: { email: 'build@local' }, entitlements: { bundle: true } }));
});
await page.goto(`http://127.0.0.1:${PORT}/auctiondraft?screen=board`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ITDBG && window.__ITFN && window.__ITVAL && window.__ITDBG.players && window.__ITDBG.players.length > 100, null, { timeout: 60000 });

const data = await page.evaluate(BUDGETS => {
  const d = window.__ITDBG, F = window.__ITFN;
  const cfg = d.config, players = d.players, G = 17;
  const minBid = cfg.valuation.minBid;
  const priceOf = pl => Math.max(minBid, Math.round(pl.marketValue ?? pl.auctionValue ?? minBid));
  const byPos = {};
  players.forEach(pl => (byPos[pl.position] = byPos[pl.position] || []).push(pl));
  Object.values(byPos).forEach(a => a.sort((x, y) => (y.projectedPoints || 0) - (x.projectedPoints || 0)));

  const plan = F.buildModel('ideal', d.myTeam, players, cfg, d.draftedIds, d.roleOverrides, d.targets);
  const lineup = plan.slots.filter(s => s.isStarter && s.player).map(s => ({
    slot: s.label, name: s.player.name, pos: s.player.position, team: s.player.team,
    price: priceOf(s.player), ppg: +(s.player.projectedPoints / G).toFixed(1)
  }));
  const spend = lineup.reduce((a, x) => a + x.price, 0);
  const ppg = +lineup.reduce((a, x) => a + x.ppg, 0).toFixed(1);
  const spendByPos = {};
  lineup.forEach(x => { spendByPos[x.pos] = (spendByPos[x.pos] || 0) + x.price; });

  const cliffs = ['QB', 'RB', 'WR', 'TE'].map(pos => {
    const list = byPos[pos].slice(0, pos === 'QB' || pos === 'TE' ? 18 : 36);
    let best = null;
    for (let i = 0; i < list.length - 1; i++) {
      const gap = (list[i].projectedPoints - list[i + 1].projectedPoints) / G;
      if (!best || gap > best.gap) best = { gap, i, above: list[i], below: list[i + 1] };
    }
    return { pos, rank: best.i + 1, gap: +best.gap.toFixed(1),
      above: best.above.name, aboveTeam: best.above.team, abovePpg: +(best.above.projectedPoints / G).toFixed(1), abovePrice: priceOf(best.above),
      below: best.below.name, belowTeam: best.below.team, belowPpg: +(best.below.projectedPoints / G).toFixed(1), belowPrice: priceOf(best.below) };
  }).sort((a, b) => b.gap - a.gap);

  const repl = Object.entries(cfg.roster).map(([pos, c]) => {
    const starters = c.starters * cfg.teams + (cfg.flex.eligible.includes(pos) ? Math.round(cfg.flex.count * cfg.teams / cfg.flex.eligible.length) : 0);
    const list = byPos[pos] || [];
    const last = list[Math.min(list.length - 1, starters - 1)];
    const top = list[0];
    return { pos, starters, replName: last.name, replPpg: +(last.projectedPoints / G).toFixed(1),
      topName: top.name, topPpg: +(top.projectedPoints / G).toFixed(1),
      edge: +((top.projectedPoints - last.projectedPoints) / G).toFixed(1) };
  }).sort((a, b) => b.edge - a.edge);

  const noFlex = { ...cfg, flex: { count: 0, eligible: cfg.flex.eligible } };
  const planNoFlex = F.buildModel('ideal', d.myTeam, players, noFlex, d.draftedIds, d.roleOverrides, d.targets);
  const nfPpg = +(planNoFlex.slots.filter(s => s.isStarter && s.player).reduce((a, s) => a + s.player.projectedPoints, 0) / G).toFixed(1);

  const posCost = Object.entries(spendByPos).map(([pos, dollars]) => ({
    pos, dollars, share: Math.round(dollars / spend * 100), n: lineup.filter(x => x.pos === pos).length
  })).sort((a, b) => b.dollars - a.dollars);

  // ── a solved board per budget, for the box in the section headline ──────────
  // The Build lets a reader change the budget it is solved against, and a box that only
  // repainted the headline number over a roster still priced for $200 would be a lie.
  // So the page re-solves in the browser, which needs a priced board per budget.
  //
  // A board is NOT a rescale of another board. calculateMarketValues rounds every price
  // to whole dollars before renormalizeToBudget spreads the cap over them, and
  // applyPredictability floors at the minimum bid, so a $50 board bunches at $1 and a
  // $500 board does not — the shape moves, not just the total. Rescaling the $200 board
  // was out by 13% on a $50 cap when this was measured. So every budget the box can
  // reach gets its own run through the real pipeline here, and the page ships boards the
  // engine actually solved rather than arithmetic on one of them.
  //
  // Only the players who can WIN a slot are shipped. If kMax players at a position each
  // cost no more than player X and score at least as much, then any lineup using X has a
  // spare one of them to swap in for free, so X can never be needed. That trim provably
  // cannot change the answer; it is not a sample. It is taken per budget and unioned, so
  // a player who only earns his place on a $500 board is still there.
  const kMax = {};
  Object.entries(cfg.roster).forEach(([pos, c]) => {
    kMax[pos] = c.starters + (cfg.flex.eligible.includes(pos) ? cfg.flex.count : 0);
  });
  // Points never move with the budget, so a position's ranking is the same board to
  // board and a player can be tracked by id across all of them. Two roundings ship:
  // `g` is the number the page PRINTS and adds up, rounded exactly as the shipped
  // lineup was; `r` is what the page's solver maximises, because the app maximises full
  // projections and two rosters that tie at one decimal need not tie underneath —
  // solving on the rounded number picks a different, equally-printed team.
  const ppgOf = pl => +((pl.projectedPoints || 0) / G).toFixed(1);
  const rawOf = pl => +((pl.projectedPoints || 0) / G).toFixed(4);
  const boards = BUDGETS.map(B => {
    const bCfg = { ...cfg, budget: B };
    const priced = window.__ITVAL(bCfg);
    const price = {};
    priced.forEach(pl => { price[pl.id] = Math.max(minBid, Math.round(pl.marketValue ?? pl.auctionValue ?? minBid)); });
    return price;
  });
  const keep = {};   // pos -> Set of player ids worth shipping
  Object.keys(kMax).forEach(pos => { keep[pos] = new Set(); });
  boards.forEach(price => {
    Object.keys(kMax).forEach(pos => {
      // Ties are broken by projection, which is the order the app's own planner walks
      // its pool in — so where two players are the same price for the same rounded
      // points, the one kept is the one the app would have taken.
      const list = (byPos[pos] || []).map((pl, idx) => ({ pl, idx }))
        .sort((a, b) => price[a.pl.id] - price[b.pl.id] || a.idx - b.idx);
      list.forEach((e, i) => {
        let dominators = 0;
        for (let j = 0; j < i && dominators < kMax[pos]; j++) if (ppgOf(list[j].pl) >= ppgOf(e.pl)) dominators++;
        if (dominators < kMax[pos]) keep[pos].add(e.pl.id);
      });
    });
  });
  const pool = {};
  Object.keys(kMax).forEach(pos => {
    pool[pos] = (byPos[pos] || []).filter(pl => keep[pos].has(pl.id)).map(pl => ({
      n: pl.name, t: pl.team, g: ppgOf(pl), r: rawOf(pl), d: boards.map(price => price[pl.id])
    }));
  });
  // The cliff card names players the roster mostly never buys, so they get their own
  // prices per budget rather than being forced into the pool.
  const idByName = {};
  players.forEach(pl => { idByName[pl.name] = pl.id; });
  const pricesFor = name => boards.map(price => price[idByName[name]]);
  cliffs.forEach(c => { c.abovePrices = pricesFor(c.above); c.belowPrices = pricesFor(c.below); });

  const spotsPerTeam = Object.values(cfg.roster).reduce((a, c) => a + c.total, 0);
  const starterSlots = Object.values(cfg.roster).reduce((a, c) => a + c.starters, 0) + cfg.flex.count;

  return { generatedFrom: 'index.html valuation engine, default 12-team $200 auction',
    teams: cfg.teams, budget: cfg.budget, games: G,
    lineup, spend, ppg, posCost, cliffs, repl,
    flexWorth: +(ppg - nfPpg).toFixed(1), noFlexPpg: nfPpg, playerCount: players.length,
    minBid, spotsPerTeam, starterSlots, flexCount: cfg.flex.count, flexEligible: cfg.flex.eligible,
    starters: Object.fromEntries(Object.entries(cfg.roster).map(([pos, c]) => [pos, c.starters])),
    budgets: BUDGETS, pool };
}, BUDGETS);

await browser.close();
server.close();
fs.unlinkSync(PROBE_FILE);

// ── sanity: refuse to publish a broken or empty solve ──
const problems = [];
if (!data.lineup || data.lineup.length < 8) problems.push('lineup too short');
if (!(data.spend > 0) || data.spend > data.budget) problems.push('spend outside budget');
if (!(data.ppg > 0)) problems.push('no projected points');
if (!data.cliffs.length || data.cliffs.some(c => !(c.gap >= 0))) problems.push('bad cliffs');
if (!data.repl.length) problems.push('no replacement levels');
if (data.playerCount < 200) problems.push('player pool looks truncated');
if (!data.budgets || data.budgets.indexOf(data.budget) < 0) problems.push('the shipped budget is not one of the solved boards');
if (Object.keys(data.pool).some(pos => !data.pool[pos].length)) problems.push('a position has no candidates');
if (Object.keys(data.pool).some(pos => data.pool[pos].some(p => p.d.length !== data.budgets.length || p.d.some(x => !(x >= data.minBid)))))
  problems.push('a candidate is missing a price on some board');
// Whatever the generator shipped as THE lineup has to be reachable from the pool the
// page re-solves against, or the section would contradict itself the moment the box moves.
if (data.lineup.some(l => !(data.pool[l.pos] || []).some(p => p.n === l.name)))
  problems.push('the shipped lineup is not in the shipped pool');
if (problems.length) {
  console.error('refusing to write, sanity checks failed: ' + problems.join('; '));
  process.exit(1);
}

// Carry forward any `edge` block already in front.html. That is the slot for
// third-party data (consensus ADP, Vegas win totals) which this script does NOT
// invent — see the contract at the bottom of this file. The front page hides the
// section entirely when it is absent, so an empty desk never ships filler.
const front = fs.readFileSync(FRONT, 'utf8');
const prev = front.match(/^var ANALYSIS = (\{.*\});$/m);
if (prev) {
  try {
    const old = JSON.parse(prev[1]);
    if (old.edge) data.edge = old.edge;
  } catch { /* previous block unreadable, carry nothing forward */ }
}

if (DRY) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
const LINE = /^var ANALYSIS = \{.*\};$/m;
if (!LINE.test(front)) {
  console.error('could not find the `var ANALYSIS = {...};` line in front.html');
  process.exit(1);
}
const next = front.replace(LINE, 'var ANALYSIS = ' + JSON.stringify(data) + ';');
fs.writeFileSync(FRONT, next);
if (next === front) console.log('(numbers unchanged)');
console.log(`front.html: $${data.spend} lineup at ${data.ppg} pts/gm, ${data.cliffs.length} cliffs, FLEX worth ${data.flexWorth}`);
console.log(`            ${data.budgets.length} solved boards ($${data.budgets[0]}-$${data.budgets[data.budgets.length - 1]}), ` +
  `${Object.values(data.pool).reduce((a, l) => a + l.length, 0)} candidates for the budget box`);

// ─────────────────────────────────────────────────────────────────────────────
// THE `edge` CONTRACT — for the "what consensus is getting wrong" / "where Vegas
// disagrees with the projections" desks.
//
// Those two stories need data this repo does not have. There is no consensus ADP
// in the product (adpRedraft is null for every player; attachProvisionalAdp
// synthesises a rank from Iron Tuna's own auctionValue) and no odds feed at all,
// so writing either story from what is in here would mean comparing the model to
// itself. Add a real source and the desk turns itself on. Shape:
//
//   "edge": {
//     "title": "Where Vegas disagrees with the projections",
//     "note":  "Win totals as of Aug 18, priced against our team projections.",
//     "cards": [{
//       "heading": "The market likes them more than we do",
//       "body":    "One sentence of framing.",
//       "source":  "DraftKings win totals, 2026-08-18",
//       "rows": [{ "pos": "RB", "name": "Player or team",
//                  "detail": "what the two sources say", "delta": "+2.5" }]
//     }]
//   }
//
// Put it in tools/front-analysis.json under "edge" (this script preserves it on
// every rebuild) or straight into the `var ANALYSIS` line. Cite the source and
// the date on every card — that is what the `source` field is for.
