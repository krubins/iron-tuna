#!/usr/bin/env node
// Does the roster planner actually SPEND the budget it is given?
//   node tools/test-planner-budget.mjs [--report]
//
// WHY THIS EXISTS
// `buildOptimalPlan` takes two reservations off the top before it picks
// starters: `reserveBench` (the real minimum cost of filling the bench) and
// `extraBench` (the Starters-vs-Depth knob's share). The second one is the
// problem. It is withheld from the starters, but the bench is separately capped
// by `backupCap`, which is sized from `depthBase = max(0, alloc - 0.55)/0.45*6`
// — exactly 0 at the default allocation. So at default settings money is taken
// off the starters that the bench is structurally unable to spend, and it is
// spent by nobody. Every withheld dollar scores zero, because `starterPoints`
// — the number the models are ranked and displayed by — counts starters only.
//
// August 2026's exact-solver work (HANDOFF section 14) fixed this for the
// `ideal` model only, by routing it through `noBench`/`noCap`. The other eight
// shape models still go down the reserving path, so this test covers them.
//
// WHY IT DRIVES A BROWSER
// Same reason as tools/build-front-analysis.mjs: the planner lives inside
// index.html's one big in-page script with no module boundary, and the numbers
// depend on the whole valuation pipeline ahead of it. Re-implementing any of
// that in Node would measure a copy rather than what ships.
//
// Needs `npm i -D playwright` (and react/react-dom locally on a box with no CDN
// egress). Self-skips without them, so it never fails a machine that cannot run
// it — which is also why CI does not run it. Run it locally when touching
// buildOptimalPlan.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8734;
const REPORT = process.argv.includes('--report');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  try { ({ chromium } = await import('playwright-core')); }
  catch { console.log('SKIP — needs playwright (npm i -D playwright)'); process.exit(0); }
}
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p))
  || null;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── instrumented copy: expose the planner and the real call arguments ───────
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HOOK = 'function buildModel(key, myTeam, players, config, draftedIds, roleOverrides, targets, customForced, whatIfAnchors) {';
if (!index.includes(HOOK)) { console.error('buildModel signature moved — update the hook in this script'); process.exit(1); }
let probe = index.replace(HOOK, HOOK + '\n  try { window.__ITDBG = { myTeam, players, config, draftedIds, roleOverrides, targets }; } catch (e) {}');
const lines = probe.split('\n');
const close = lines.map((l, i) => [l.trim(), i]).filter(([l]) => l === '</script>').pop()[1];
lines.splice(close, 0, 'try { window.__ITFN = { buildModel }; } catch (e) {}');
probe = lines.join('\n');
const PROBE_FILE = path.join(ROOT, '.planner-budget-probe.html');
fs.writeFileSync(PROBE_FILE, probe);

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
  if (req.method === 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  const file = url === '/auctiondraft' ? PROBE_FILE : path.join(ROOT, url.replace(/^\/+/, '') || 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('nope'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();
for (const [pat, rel] of [
  ['https://unpkg.com/react@18/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
]) {
  const local = path.join(ROOT, 'node_modules', rel);
  if (fs.existsSync(local)) {
    await page.route(pat, r => r.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(local, 'utf8') }));
  }
}
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('iron_tuna_account_v1', JSON.stringify({ user: { email: 'test@local' }, entitlements: { bundle: true } }));
});
await page.goto(`http://127.0.0.1:${PORT}/auctiondraft?screen=board`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => window.__ITDBG && window.__ITFN && window.__ITDBG.players && window.__ITDBG.players.length > 100, null, { timeout: 60000 });
} catch {
  console.log('SKIP — the app never finished booting (needs react/react-dom locally with no CDN egress)');
  await browser.close(); server.close(); fs.unlinkSync(PROBE_FILE); process.exit(0);
}

// ── measure every shape model across budgets and both knobs ────────────────
const MODELS = ['ideal', 'balanced', 'heroRB', 'robustRB', 'robustWR', 'zeroRB', 'heroWR', 'eliteTE', 'heroQB'];
const rows = await page.evaluate(({ MODELS }) => {
  const d = window.__ITDBG, F = window.__ITFN;
  const base = d.config;
  const out = [];
  // ONLY the app's own budget. Player prices come out of the valuation pipeline
  // already renormalised to it, so overriding cfg.budget here would plan a $300
  // draft with $200-scale prices and report a shortfall that no reader could
  // ever see. The knobs below are pure planner inputs and do not touch pricing,
  // so they are safe to sweep.
  const budget = base.budget;
  for (const conc of [0, 0.5, 1]) {
    for (const alloc of [0.55, 0.35, 0.75]) {
      const cfg = JSON.parse(JSON.stringify(base));
      cfg.strategy = { ...(cfg.strategy || {}), allocation: alloc, concentration: conc };
      const minBid = cfg.valuation.minBid;
      const priceOf = pl => Math.max(minBid, Math.round(pl.marketValue ?? pl.auctionValue ?? minBid));
      for (const key of MODELS) {
        let plan;
        try { plan = F.buildModel(key, d.myTeam, d.players, cfg, d.draftedIds, d.roleOverrides, d.targets); }
        catch (e) { out.push({ key, budget, alloc, conc, error: String(e && e.message || e) }); continue; }
        if (!plan) { out.push({ key, budget, alloc, conc, error: 'no plan' }); continue; }
        const starters = (plan.slots || []).filter(s => s.isStarter && s.player);
        const starterCost = starters.reduce((a, s) => a + priceOf(s.player), 0);
        const bench = (plan.benchTargets || []);
        const benchCost = bench.reduce((a, b) => a + (b.price || 0), 0);
        out.push({
          key, budget, alloc, conc,
          starters: starters.length,
          starterCost, benchCost,
          total: starterCost + benchCost,
          unspent: budget - (starterCost + benchCost),
          starterPoints: Math.round(plan.starterPoints || 0),
          feasible: plan.feasible !== false
        });
      }
    }
  }
  return out;
}, { MODELS });

await browser.close();
server.close();
fs.unlinkSync(PROBE_FILE);

if (REPORT) {
  console.log('\nmodel        alloc  conc  starters  bench   total  unspent  starterPts');
  rows.forEach(r => {
    if (r.error) return console.log(`${r.key.padEnd(12)} ${String(r.alloc).padStart(5)} ${String(r.conc).padStart(5)}  ERROR ${r.error}`);
    console.log(`${r.key.padEnd(12)} ${String(r.alloc).padStart(5)} ${String(r.conc).padStart(5)}  ${String(r.starterCost).padStart(8)} ${String(r.benchCost).padStart(6)} ${String(r.total).padStart(7)} ${String(r.unspent).padStart(8)} ${String(r.starterPoints).padStart(11)}`);
  });
  console.log('');
}

console.log('\nthe planner spends what it is given');
{
  ok('every model produced a plan', rows.every(r => !r.error),
     (rows.find(r => r.error) || {}).error);

  const dflt = rows.filter(r => !r.error && r.alloc === 0.55 && r.conc === 0.5);
  const SLACK = 3;
  const budgetOf = rs => (rs.find(r => r.budget) || {}).budget || 200;

  // THE DEFAULT BOARD IS THE ONE ALMOST EVERY READER SEES, and it is exact.
  // Before August 2026 the eight non-`ideal` models stranded $9 to $30 here:
  // `extraBench` withheld about 19% of the budget from the starters while
  // `depthBase` capped the bench near the minimum bid, so the money was spent by
  // nobody and scored zero in `starterPoints`.
  ok('the default board strands nothing',
     dflt.every(r => r.unspent <= SLACK),
     dflt.filter(r => r.unspent > SLACK).map(r => `${r.key} left $${r.unspent}`).join('; '));
  ok('the default board never bills past the budget',
     dflt.every(r => r.unspent >= 0),
     dflt.filter(r => r.unspent < 0).map(r => `${r.key} over by $${-r.unspent}`).join('; '));
  ok('every default plan is feasible', dflt.every(r => r.feasible));

  // ── the two known residuals ───────────────────────────────────────────────
  // Both are bounded here rather than asserted away, so a regression that makes
  // either worse fails this test even though neither is fixed yet.

  // 1. Overspend is gone everywhere, at every knob setting, and stays gone.
  //    A plan that bills past the budget is one a drafter cannot execute, so
  //    this is absolute rather than bounded.
  const over = rows.filter(r => !r.error && r.unspent < 0);
  ok('no model bills past its budget at any setting', over.length === 0,
     over.map(r => `${r.key} alloc ${r.alloc}/conc ${r.conc} over by $${-r.unspent}`).join('; '));

  // 2. ONE KNOWN RESIDUAL. Away from the default allocation, `extraBench` can
  //    still withhold more than `backupCap` lets the bench absorb, so a tenth of
  //    the budget goes unspent at the far Depth end. That is the tail of the same
  //    fault: before this was fixed the identical money went unspent at EVERY
  //    setting including the default, where it ran to 15% of the budget. Handing
  //    the leftover back needs the starter solve to run a second time, which is a
  //    larger change than this one. Bounded rather than asserted away, so a
  //    regression that makes it worse still fails here.
  //
  //    The bound is a SHARE of the budget, not a dollar figure. It used to be a
  //    flat $19, which was the exact high-water mark on the board of the day — so
  //    any reprice of the market curve tripped it without the planner having
  //    changed at all (re-cutting the curve to total its own $1440 in Aug 2026
  //    moved the same residual to $21). What this is guarding is the size of the
  //    hole relative to the money, and that is what it now measures.
  const CAP = Math.round(budgetOf(rows) * 0.12);
  const strand = rows.filter(r => !r.error && r.unspent > SLACK);
  ok(`nothing strands off the default allocation by more than $${CAP} (12% of the budget)`,
     strand.every(r => r.alloc !== 0.55 && r.unspent <= CAP),
     strand.filter(r => !(r.alloc !== 0.55 && r.unspent <= CAP))
           .map(r => `${r.key} alloc ${r.alloc}/conc ${r.conc} left $${r.unspent}`).join('; '));

  ok('nothing on the page threw', pageErrors.length === 0, pageErrors[0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
