#!/usr/bin/env node
// Regression test for the You (what you should bid) column's shape on the cheat sheet.
//   node tools/test-you-column.mjs
//
// THE BUG THIS EXISTS FOR: personal value is computed by `switchPrice`, a plan
// rebuild per player, so it only ever ran for the top 20 at each position.
// Everyone below that silently fell back to `auctionValue` — the VALUE column —
// so You fell all the way down the board and then JUMPED BACK UP at rank 21.
// It priced WR21 above WR16 for no reason other than being outside the window.
// A cutoff in an internal optimisation must never be visible in a price.
//
// This drives the REAL app in Chromium against a stubbed projections payload,
// because the logic lives inside a React useMemo and cannot be lifted out.
//
// Needs playwright-core, react and react-dom resolvable, plus a Chromium binary
// (preinstalled at /opt/pw-browsers in Claude Code remote sessions, else set
// CHROMIUM_PATH). Skips cleanly rather than failing when they are absent, so it
// never blocks a machine that cannot run it.
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
  // React 18's "exports" map hides the UMD builds from require.resolve, so the
  // package directory is located instead and the file joined onto it.
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

// Committed projections, straight out of the worker.
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
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
const PROJ_KEY = (src.match(/PROJ_KEY\s*=\s*'([^']+)'/) || fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/PROJ_KEY\s*=\s*'([^']+)'/))[1];
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

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
// React ships from unpkg; serve the same UMD builds locally so this runs offline.
await page.route('**/unpkg.com/**', r => r.fulfill({
  status: 200, contentType: 'application/javascript',
  body: fs.readFileSync(/react-dom/.test(r.request().url()) ? reactDomPath : reactPath, 'utf8')
}));
await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.goto(`http://localhost:${server.address().port}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

const board = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.cheat-col').forEach(col => {
    const pos = ((col.querySelector('.cheat-col-head') || {}).innerText || '?').trim().split(/\s+/)[0];
    out[pos] = [...col.querySelectorAll('.cheat-row')].map(r => {
      const cells = [...r.children].map(c => c.innerText.trim());
      const money = i => { const m = (cells[i] || '').match(/-?\d+/); return m ? +m[0] : null; };
      return { name: (cells[3] || '').replace(/^[V▲▼\-+0-9.]*/, ''), proj: money(5), value: money(6), you: money(7) };
    });
  });
  return out;
});
await browser.close(); server.close();

const POS = ['QB', 'RB', 'WR', 'TE'];
ok('the cheat sheet rendered every skill position', POS.every(p => (board[p] || []).length > 20), Object.keys(board).join(','));

console.log('\nno column climbs as you go down the board');
for (const pos of POS) {
  const rows = (board[pos] || []).filter(r => r.you != null);
  if (!rows.length) continue;
  for (const [col, label] of [['proj', 'PROJ'], ['value', 'VALUE']]) {
    const rises = rows.filter((r, i) => i && r[col] > rows[i - 1][col]);
    ok(`${pos} ${label} never rises`, rises.length === 0, rises.slice(0, 2).map(r => r.name).join(', '));
  }
}

console.log('\nthe optimiser window is invisible in the You column');
// The window is the top 20 per position. The bug was a step UP as the board
// crossed out of it, so that seam is checked explicitly and hard.
for (const pos of POS) {
  const rows = (board[pos] || []).filter(r => r.you != null);
  if (rows.length < 24) continue;
  const seam = rows.slice(18, 24);                      // ranks 19-24, straddling 20/21
  const climbs = seam.filter((r, i) => i && r.you > seam[i - 1].you);
  ok(`${pos} You does not jump at the rank-20 seam`,
     climbs.length === 0,
     climbs.map(r => `${r.name} $${r.you}`).join(', '));
  const tail = rows.slice(20);
  const tailRises = tail.filter((r, i) => i && r.you > tail[i - 1].you);
  ok(`${pos} You never climbs below the window`, tailRises.length === 0,
     tailRises.slice(0, 3).map(r => `${r.name} $${r.you}`).join(', '));
  const outside = rows.slice(20);
  ok(`${pos} nobody outside the window is priced at full VALUE`,
     outside.every(r => r.value == null || r.you <= r.value),
     outside.filter(r => r.you > r.value).slice(0, 2).map(r => `${r.name} $${r.you}>$${r.value}`).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
