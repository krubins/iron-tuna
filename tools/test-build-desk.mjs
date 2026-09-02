#!/usr/bin/env node
// The Build desk states a budget, so it has to account for that budget.
//
// It used to publish only half the ledger: "122.1 points a game for $110" under
// a headline reading "The best team $120 can buy". The other $10 was never idle
// — it buys the bench, which a legal roster has to fill and which is billed at
// max(position floor, price), not at $1 — but the page never said so, and a
// reader who subtracts is entitled to conclude the solve left value on the
// board. See HANDOFF.md §24.
//
// Two halves to this check:
//   1. The shipped `var ANALYSIS` block balances. Plain node, always runs.
//   2. front.html's render keeps the invariants that make it balance ON SCREEN
//      at a reader's own budget. Source-level, always runs.
// With playwright installed it also renders the real page across a spread of
// budgets and reads the numbers back off the DOM; without it, that part skips
// the way tools/test-planner-budget.mjs does.
//
//   node tools/test-build-desk.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
let failed = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || !detail ? '' : '\n         ' + detail));
  if (!cond) failed++;
};

// ── 1. the numbers ──────────────────────────────────────────────────────────
console.log('var ANALYSIS balances');
const m = front.match(/^var ANALYSIS = (\{.*\});$/m);
if (!m) {
  console.error('  FAIL could not find the `var ANALYSIS = {...};` line in front.html');
  process.exit(1);
}
const A = JSON.parse(m[1]);

ok('the bench ledger is present', !!(A.bench && A.bench.players && A.bench.players.length),
   'run node tools/build-front-analysis.mjs');
// Every body the roster carries, per position, starters and bench together. The
// shape card is drawn from this whole-roster view, not from posCost alone: the
// DEF bar once read "$1" on a $120 board for a roster that carries TWO defences
// at a $1 minimum each, because the row was the starter on its own and the
// second defence sat inside BENCH with nothing to say so.
const bodies = {};
const addBody = (pos, price) => { bodies[pos] = bodies[pos] || { n: 0, dollars: 0 }; bodies[pos].n++; bodies[pos].dollars += price; };
A.lineup.forEach(l => addBody(l.pos, l.price));
if (A.bench) {
  A.bench.players.forEach(b => addBody(b.pos, b.price));
  const benchCost = A.bench.players.reduce((a, b) => a + b.price, 0);
  ok('bench.cost is what the bench players cost', benchCost === A.bench.cost,
     `players sum to $${benchCost}, bench.cost says $${A.bench.cost}`);
  ok('every bench seat has a body', A.bench.players.length === A.bench.seats,
     `${A.bench.players.length} players for ${A.bench.seats} seats`);
  ok('starters + bench = total', A.spend + A.bench.cost === A.total,
     `$${A.spend} + $${A.bench.cost} != $${A.total}`);
  // The headline claim. A dollar short here is the whole bug.
  ok('the total is the budget, with nothing stranded', A.total === A.budget && A.unspent === 0,
     `$${A.total} of $${A.budget}, $${A.unspent} unspent`);
  ok('nothing is bid past the budget', A.total <= A.budget);

  const shares = A.posCost.map(c => c.share).concat([A.bench.share]);
  ok('the printed shares add to 100%', shares.reduce((a, b) => a + b, 0) === 100,
     'shares: ' + shares.join(' + ') + ' = ' + shares.reduce((a, b) => a + b, 0));
  // Shares are of the BUDGET now, not of the starter spend. Off-by-one from the
  // largest-remainder pass is expected; off-by-five means the wrong denominator.
  A.posCost.forEach(c => {
    ok(`${c.pos}'s share is a share of the budget`,
       Math.abs(c.share - c.dollars / A.budget * 100) <= 1,
       `$${c.dollars} of $${A.budget} is ${(c.dollars / A.budget * 100).toFixed(1)}%, printed ${c.share}%`);
  });
  Object.entries(bodies).forEach(([pos, b]) => {
    ok(`${pos}: ${b.n} ${b.n === 1 ? 'body costs' : 'bodies cost'} at least a dollar each`, b.dollars >= b.n,
       `$${b.dollars} for ${b.n}`);
  });
  const whole = Object.values(bodies).reduce((a, b) => a + b.dollars, 0);
  ok('the positions together, bench included, account for the whole budget', whole === A.budget,
     `$${whole} of $${A.budget}`);
}

// ── 2. the render's invariants ──────────────────────────────────────────────
console.log('\nfront.html renders both halves');
const build = front.slice(front.indexOf('// ══════════════════ The Build: the solved roster'));
ok('the dek names the bench seats', /bench seats/.test(build));
ok('the meta line prints the ledger', /starters \+ \$' \+ benchShown \+ ' bench = \$/.test(build));
ok('the spend bar spans the budget, not the starter spend',
   !/c\.dollars \/ A\.spend/.test(build) && /c\.dollars \/ A\.budget \* 100/.test(build),
   'a bar drawn against A.spend leaves the bench outside the chart');
// money() rounds each call on its own, so money(183) + money(17) is $101 on a
// $100 board. The bench has to be what the starters leave behind, not its own
// rescale, or the page's own arithmetic contradicts itself.
ok('the bench figure is derived by subtraction, not rescaled on its own',
   /budgetShown - startersShown/.test(build) && !/fmtMoney\(bench\.cost\)/.test(build),
   'use budgetShown - startersShown; fmtMoney(bench.cost) can round to a dollar more than the budget');
ok('the shape card charts the whole roster per position, bench tail included',
   /id="shapeCard"/.test(build) && /bar-tail/.test(build) && /r\.starters \+ r\.bench/.test(build),
   'a DEF bar drawn from posCost alone reads "$1" for a roster that carries two defences');
ok('the shape card floors every position at a dollar a body',
   /Math\.max\(shapeRows\[i\]\.n, Math\.floor\(x\)\)/.test(build),
   'a $1 minimum bid times two defences is $2, whatever money() rounds the rescale to');

// ── 3. the page as a browser draws it (skips without playwright) ────────────
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* optional */ }
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p))
  || null;
if (!chromium) {
  console.log('\nrendered sweep: SKIPPED (npm i -D playwright to run it)');
} else {
  console.log('\nrendered sweep across reader budgets');
  const PORT = 8744;
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const file = path.join(ROOT, url === '/' ? 'front.html' : url.replace(/^\/+/, ''));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('nope'); }
      const ext = path.extname(file);
      res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream' });
      res.end(buf);
    });
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  // $50 is below any real auction and is here on purpose: it is where money()'s
  // rounding is harshest, so it is where a two-rescale bench would break first.
  for (const budget of [null, 50, 100, 120, 200, 300]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let pageErr = null;
    page.on('pageerror', e => { pageErr = e.message; });
    if (budget != null) {
      await page.addInitScript(b => {
        localStorage.setItem('iron_tuna_draft_state_v2', JSON.stringify({ config: { teams: 12, budget: b, format: 'auction' } }));
      }, budget);
    }
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const d = document.getElementById('buildDek');
      return d && d.textContent.length > 20;
    }, null, { timeout: 30000 });
    const seen = await page.evaluate(() => ({
      head: document.getElementById('buildHeadline').textContent,
      meta: document.getElementById('buildMeta').textContent,
      widths: [...document.querySelectorAll('#spendBar .spend-seg')].map(s => parseFloat(s.style.width) || 0),
      shape: [...document.querySelectorAll('#shapeCard .bar-row')].map(r => ({
        pos: r.dataset.pos, n: +r.dataset.n,
        val: +(r.querySelector('.bar-val').textContent.replace(/[^0-9]/g, '')),
      })),
      shapeNote: (document.querySelector('#shapeCard .bnote') || { textContent: '' }).textContent,
    }));
    const label = budget == null ? 'site default' : '$' + budget;
    ok(`${label}: no page error`, !pageErr, pageErr || '');
    const led = seen.meta.match(/\$(\d+) starters \+ \$(\d+) bench = \$(\d+)/);
    ok(`${label}: the meta line states the ledger`, !!led, seen.meta);
    if (led) {
      ok(`${label}: ${led[1]} + ${led[2]} = ${led[3]}`, +led[1] + +led[2] === +led[3]);
      const head = seen.head.match(/\$(\d+)/);
      if (head) ok(`${label}: the headline budget is the ledger's budget`, head[1] === led[3],
                   `headline $${head[1]}, ledger $${led[3]}`);
    }
    const span = seen.widths.reduce((a, b) => a + b, 0);
    ok(`${label}: the spend bar spans the whole budget`, Math.abs(span - 100) < 0.01,
       `covers ${span.toFixed(2)}%`);
    // The shape card: whole roster per position, adding to the budget, and never
    // a position printed below a dollar a body. $50 is where the floor bites:
    // two defences at $3 on the $200 board rescale to $0.75, and must print $2.
    const rows = seen.shape.map(r => `${r.pos}×${r.n} $${r.val}`).join(', ');
    ok(`${label}: the shape card has a row per position`,
       seen.shape.length === Object.keys(bodies).length, rows);
    ok(`${label}: every shape row counts the bodies the roster carries there`,
       seen.shape.every(r => bodies[r.pos] && bodies[r.pos].n === r.n), rows);
    ok(`${label}: no position prints below a dollar a body`,
       seen.shape.length > 0 && seen.shape.every(r => r.val >= r.n), rows);
    if (led) {
      const bars = seen.shape.reduce((a, r) => a + r.val, 0);
      ok(`${label}: the shape card's bars add to the budget`, bars === +led[3], `${rows} = $${bars}, budget $${led[3]}`);
      const stops = seen.shapeNote.match(/stops at \$(\d+)/);
      ok(`${label}: the shape note's starter figure is the ledger's`, !!stops && stops[1] === led[1],
         `note says ${stops ? '$' + stops[1] : 'nothing'}, ledger says $${led[1]}`);
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nThe Build accounts for every dollar it states');
process.exit(failed ? 1 : 0);
