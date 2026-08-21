#!/usr/bin/env node
// Regression test for what the room is expected to pay for a quarterback.
//   node tools/test-qb-curve.mjs
//
// WHY THIS EXISTS: `LEAGUE_MARKET_CURVE.QB` was drawn from historical auction
// spending, and it priced QB1 level with RB1 and kept quarterbacks in double
// digits down to QB9. That is not what a 1-QB room does when the position is
// this flat — QB1 to QB9 is about three points a game on the current
// projections, so the room stops paying up almost immediately. The curve was
// re-cut in August 2026 to land QB1 near the high 20s / low 30s of a
// $120-a-team board and to put every QB after QB6 in single digits.
//
// The old, richer curve is kept as SUPERFLEX_QB_CURVE and still applies when a
// QB can fill more than one starting slot, so this cut can never make a
// superflex or 2-QB board cheaper at the position.
//
// Needs playwright-core, react and react-dom resolvable, plus a Chromium binary
// (preinstalled at /opt/pw-browsers in Claude Code remote sessions, else set
// CHROMIUM_PATH). Skips cleanly rather than failing when they are absent.
import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium, reactPath, reactDomPath;
try {
  ({ chromium } = await import('playwright-core'));
  const pkgDir = n => path.dirname(require.resolve(n + '/package.json'));
  reactPath = path.join(pkgDir('react'), 'umd/react.production.min.js');
  reactDomPath = path.join(pkgDir('react-dom'), 'umd/react-dom.production.min.js');
  for (const f of [reactPath, reactDomPath]) if (!fs.existsSync(f)) throw new Error('missing UMD build: ' + f);
} catch (e) {
  console.log('SKIP — needs playwright-core + react + react-dom (' + e.message.split('\n')[0] + ')');
  process.exit(0);
}
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
       .find(p => fs.existsSync(p));
if (!CHROME) { console.log('SKIP — no Chromium binary; set CHROMIUM_PATH'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pool = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  const seg = src.slice(st, src.indexOf('\n];', st));
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();
const PROJ_KEY = idx.match(/PROJ_KEY\s*=\s*'([^']+)'/)[1];
const STORAGE_KEY = idx.match(/STORAGE_KEY\s*=\s*'([^']+)'/)[1];
const payload = (() => {
  const b = Buffer.from(JSON.stringify(pool), 'utf8');
  const o = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b[i] ^ PROJ_KEY.charCodeAt(i % PROJ_KEY.length);
  return o.toString('base64');
})();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/projections') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(payload); }
  if (u.pathname.startsWith('/api/')) { res.writeHead(u.pathname === '/api/auth/me' ? 401 : 200, { 'content-type': 'application/json' }); return res.end('{}'); }
  let f = u.pathname === '/' ? 'front.html' : u.pathname.slice(1);
  if (['auctiondraft', 'snakedraft', 'bestball', 'hub'].includes(f)) f = 'index.html';
  const fp = path.join(ROOT, f);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': fp.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.route('**/unpkg.com/**', r => r.fulfill({
  status: 200, contentType: 'application/javascript',
  body: fs.readFileSync(/react-dom/.test(r.request().url()) ? reactDomPath : reactPath, 'utf8')
}));
await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));

const readBoard = () => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.cheat-col').forEach(col => {
    const pos = ((col.querySelector('.cheat-col-head') || {}).innerText || '?').trim().split(/\s+/)[0];
    out[pos] = [...col.querySelectorAll('.cheat-row')].map(r => {
      const cells = [...r.children].map(c => c.innerText.trim());
      const money = i => { const m = (cells[i] || '').match(/-?\d+/); return m ? +m[0] : null; };
      return { name: (cells[3] || '').replace(/^[V▲▼\-+0-9.]*/, ''), proj: money(5), value: money(6) };
    });
  });
  return out;
});

// Every league shape the QB-format control can produce, plus the shapes a saved
// state or a league import can produce that the control cannot. The premium curve
// is OPT-IN: nothing but an explicit two-QB-slot league may turn it on.
const SCENARIOS = [
  ['default',        null],
  ['1QB explicit',   c => { c.roster.QB.starters = 1; c.flex.eligible = c.flex.eligible.filter(x => x !== 'QB'); }],
  ['superflex',      c => { c.flex.count = 1; c.flex.eligible = [...new Set([...c.flex.eligible, 'QB'])]; }],
  ['2QB',            c => { c.roster.QB.starters = 2; c.roster.QB.total = 3; }],
  // QB is listed as flex-eligible but there is no flex slot to start him in. The
  // replacement level that drives VALUE reads `flex.count * teams`, so it prices
  // this league as 1-QB; PROJ has to agree or the two columns describe different
  // leagues. Reachable from a saved state, or by setting superflex and then
  // stepping the flex count to zero.
  ['QB eligible, no flex slot', c => { c.flex.count = 0; c.flex.eligible = [...new Set([...c.flex.eligible, 'QB'])]; }]
];

const boards = {};
for (const [name, mutate] of SCENARIOS) {
  // Each scenario starts from a clean profile. Without this the mutations stack —
  // the 2-QB league inherits the superflex league's flex list — and every board
  // after the first describes a league no scenario asked for.
  await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(k => localStorage.removeItem(k), STORAGE_KEY);
  await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(mutate ? 6000 : 6000);
  if (mutate) {
    await page.evaluate(([k, src]) => {
      const d = JSON.parse(localStorage.getItem(k));
      (new Function('c', src))(d.config);
      localStorage.setItem(k, JSON.stringify(d));
    }, [STORAGE_KEY, '(' + mutate.toString() + ')(c)']);
    await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
  }
  const cfg = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).config, STORAGE_KEY);
  boards[name] = await readBoard();
  boards[name]._cfg = cfg;
}
await browser.close(); server.close();

const qbOf = n => (boards[n].QB || []);
const rbOf = n => (boards[n].RB || []);
const cfgOf = n => boards[n]._cfg;
ok('every scenario rendered a board', SCENARIOS.every(([n]) => qbOf(n).length > 12 && rbOf(n).length > 12),
   SCENARIOS.map(([n]) => `${n}:${qbOf(n).length}`).join(' '));

// The league the mutation asked for is the league the app actually loaded. Without
// this the pricing assertions below could all pass against an unmodified config.
console.log('\nthe scenarios really are different leagues');
ok('superflex kept QB in the flex', (cfgOf('superflex').flex.eligible || []).includes('QB') && cfgOf('superflex').flex.count >= 1);
ok('2QB kept two QB starters', cfgOf('2QB').roster.QB.starters === 2);
ok('the no-flex-slot league kept QB eligible with no slot',
   (cfgOf('QB eligible, no flex slot').flex.eligible || []).includes('QB') && cfgOf('QB eligible, no flex slot').flex.count === 0);

for (const [n] of SCENARIOS) {
  const q = qbOf(n), r = rbOf(n), c = cfgOf(n);
  console.log(`  [${n}] flex ${c.flex.count}x[${(c.flex.eligible||[]).join('/')}] QBstart ${c.roster.QB.starters}  QB1 $${q[0].proj} QB7 $${q[6].proj}  RB1 $${r[0].proj} RB7 $${r[6].proj}  QB1val $${q[0].value}`);
}
const qb = qbOf('default'), rb = rbOf('default');
const rb1 = rb[0].proj;
console.log(`\na 1-QB room does not pay up for a flat position (RB1 = $${rb1})`);
ok('QB1 costs no more than three quarters of RB1',
   qb[0].proj <= 0.75 * rb1, `QB1 $${qb[0].proj} vs RB1 $${rb1} (${(qb[0].proj / rb1).toFixed(2)})`);
ok('QB7 costs under a quarter of RB1 — single digits on a $120-a-team board',
   qb[6].proj < 0.25 * rb1, `QB7 $${qb[6].proj} vs RB1 $${rb1} (${(qb[6].proj / rb1).toFixed(2)})`);
ok('the QB curve never rises', qb.every((r, i) => !i || r.proj <= qb[i - 1].proj),
   qb.filter((r, i) => i && r.proj > qb[i - 1].proj).map(r => r.name).join(', '));
ok('the drop from QB1 to QB7 is steeper than RB1 to RB7',
   qb[6].proj / qb[0].proj < rb[6].proj / rb[0].proj,
   `QB ${(qb[6].proj / qb[0].proj).toFixed(2)} vs RB ${(rb[6].proj / rb[0].proj).toFixed(2)}`);

// The premium curve is opt-in. A league that never asked for a second QB slot must
// price identically to the untouched default — not merely "cheaply".
console.log('\nthe premium curve is opt-in: 1-QB is the default and the fallback');
for (const name of ['1QB explicit', 'QB eligible, no flex slot']) {
  const rows = qbOf(name);
  const diff = rows.map((r, i) => [r, qb[i]]).filter(([x, y]) => !y || x.name !== y.name || x.proj !== y.proj);
  ok(`${name} prices QBs exactly like the default league`, diff.length === 0,
     diff.slice(0, 3).map(([x, y]) => `${x.name} $${x.proj} vs $${y ? y.proj : '—'}`).join(', ')
     + (diff.length > 3 ? ` (+${diff.length - 3} more)` : ''));
}

console.log('\na league that DOES start two QBs pays for the position');
for (const name of ['superflex', '2QB']) {
  const rows = qbOf(name);
  ok(`${name} QB1 costs more than the 1-QB board`, rows[0].proj > qb[0].proj, `$${rows[0].proj} vs $${qb[0].proj}`);
  ok(`${name} QB7 costs more than the 1-QB board`, rows[6].proj > qb[6].proj, `$${rows[6].proj} vs $${qb[6].proj}`);
  ok(`${name} QB7 is still in double digits relative to RB1`,
     rows[6].proj >= 0.25 * rbOf(name)[0].proj, `QB7 $${rows[6].proj} vs RB1 $${rbOf(name)[0].proj}`);
}

// A superflex room starts ~2 QBs a team, so the position is genuinely scarce and the
// board has to read like one: the best QB is the most expensive player on it, and the
// curve stays priced all the way down to the last starter instead of falling off a
// cliff at the end of a 16-entry row built for a 1-QB league.
console.log('\nsuperflex prices the position like the scarce commodity it is');
{
  const q = qbOf('superflex'), r = rbOf('superflex'), w = (boards['superflex'].WR || []);
  ok('superflex QB1 is the most expensive player on the board',
     q[0].proj > r[0].proj && q[0].proj > w[0].proj, `QB1 $${q[0].proj} vs RB1 $${r[0].proj}, WR1 $${w[0].proj}`);
  ok('the superflex QB curve never rises', q.every((x, i) => !i || x.proj <= q[i - 1].proj),
     q.filter((x, i) => i && x.proj > q[i - 1].proj).map(x => x.name).join(', '));
  // 24 starting QBs in a 12-team superflex. The old row ran out at 16 and dumped
  // everyone after it on the min bid, which priced a starter like a handcuff.
  const floor = q[q.length - 1].proj;
  ok('QB24 is still priced as a starter, not at the floor',
     q.length >= 24 && q[23].proj > floor, `QB24 $${q[23] && q[23].proj} vs floor $${floor}`);
  ok('superflex QB24 costs more than the 1-QB board pays for QB24',
     q.length >= 24 && qb.length >= 24 && q[23].proj > qb[23].proj,
     `$${q[23] && q[23].proj} vs $${qb[23] && qb[23].proj}`);
  // VALUE already carries the superflex scarcity through the replacement level, so the
  // curve only has to add the room's premium ON TOP — and that premium should be the
  // one the 1-QB board carries, not a bigger one invented for the format.
  //
  // Measured as QB's OWN PROJ/VALUE, not as QB's ratio relative to RB/WR/TE. The
  // relative version looks like the more robust metric and is not: superflex moves a
  // quarter of the pool onto quarterbacks, so every other position's PROJ/VALUE drops
  // with it and the relative figure swings on the reallocation rather than on the
  // premium. QB against its own VALUE holds still across formats.
  const mean = (rows, k) => rows.slice(0, 14).reduce((s, x) => s + (x[k] || 0), 0) / 14;
  const ratio = (b, pos) => mean(b[pos] || [], 'proj') / mean(b[pos] || [], 'value');
  const one = ratio(boards['default'], 'QB'), sf = ratio(boards['superflex'], 'QB');
  ok('superflex asks the same premium over VALUE that the 1-QB board asks',
     Math.abs(sf - one) <= 0.10, `superflex ${sf.toFixed(2)}x vs 1-QB ${one.toFixed(2)}x`);
  // The room overpays for the position, but it cannot overpay by a landslide: what the
  // curve asks for the 24 starting QBs, against what VALUE says they are worth.
  const share = (b, k) => (b.QB || []).slice(0, 24).reduce((s, x) => s + (x[k] || 0), 0);
  const prem = share(boards['superflex'], 'proj') / share(boards['superflex'], 'value');
  ok('the 24 starting QBs cost a premium over their VALUE, not a multiple',
     prem > 1.05 && prem < 1.35, `$${share(boards['superflex'], 'proj')} asked vs $${share(boards['superflex'], 'value')} worth (${prem.toFixed(2)}x)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
