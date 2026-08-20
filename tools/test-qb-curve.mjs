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

await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const oneQb = await readBoard();

// Flip the saved league to superflex and reload. Everything else is untouched.
await page.evaluate(k => {
  const d = JSON.parse(localStorage.getItem(k));
  d.config.flex = { ...d.config.flex, eligible: [...new Set([...(d.config.flex.eligible || []), 'QB'])] };
  localStorage.setItem(k, JSON.stringify(d));
}, STORAGE_KEY);
await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const superflex = await readBoard();
await browser.close(); server.close();

const qb = oneQb.QB || [], rb = oneQb.RB || [];
ok('the sheet rendered a QB and an RB column', qb.length > 12 && rb.length > 12, `${qb.length} QB, ${rb.length} RB`);

// Everything below is stated against RB1 rather than in dollars, so the test holds
// at any league size: the board scales, the shape does not.
const rb1 = rb[0] && rb[0].proj;
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

const sq = superflex.QB || [];
console.log('\nsuperflex still pays for the position');
ok('superflex renders a QB column', sq.length > 12, `${sq.length} rows`);
ok('superflex QB1 costs more than 1-QB QB1', sq[0].proj > qb[0].proj, `$${sq[0].proj} vs $${qb[0].proj}`);
ok('superflex QB7 costs more than 1-QB QB7', sq[6].proj > qb[6].proj, `$${sq[6].proj} vs $${qb[6].proj}`);
ok('superflex QB7 is still in double digits relative to RB1',
   sq[6].proj >= 0.25 * rb1, `QB7 $${sq[6].proj} vs RB1 $${rb1}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
