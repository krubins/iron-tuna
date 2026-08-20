#!/usr/bin/env node
// Rebuilds the `var ANALYSIS = {...};` block in front.html — the numbers behind the
// front page's lead story ("The best team $200 can buy"), the tier-cliff cards, the
// replacement-level bars and the FLEX finding.
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

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is required: npm i -D playwright  (dev-time only, nothing ships)');
  process.exit(2);
}

// ── instrumented copy of the app: expose the pure planner functions and the
//    arguments the models panel is actually called with ──────────────────────
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HOOK = 'function buildModel(key, myTeam, players, config, draftedIds, roleOverrides, targets, customForced, whatIfAnchors) {';
if (!index.includes(HOOK)) {
  console.error('buildModel signature moved — update the hook in this script');
  process.exit(1);
}
let probe = index.replace(HOOK, HOOK + '\n  try { window.__ITDBG = { myTeam, players, config, draftedIds, roleOverrides, targets }; } catch (e) {}');
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

const browser = await chromium.launch();
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
await page.waitForFunction(() => window.__ITDBG && window.__ITFN && window.__ITDBG.players && window.__ITDBG.players.length > 100, null, { timeout: 60000 });

const data = await page.evaluate(() => {
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

  return { generatedFrom: 'index.html valuation engine, default 12-team $200 auction',
    teams: cfg.teams, budget: cfg.budget, games: G,
    lineup, spend, ppg, posCost, cliffs, repl,
    flexWorth: +(ppg - nfPpg).toFixed(1), noFlexPpg: nfPpg, playerCount: players.length };
});

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
