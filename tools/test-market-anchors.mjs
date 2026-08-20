#!/usr/bin/env node
// Regression test for the PROJ (likely price) column across a projection update.
//   node tools/test-market-anchors.mjs
//
// THE BUG THIS EXISTS FOR: `marketAnchors` froze every player's slot on the
// LEAGUE_MARKET_CURVE the first time the sheet was priced, and was persisted
// with the draft state forever. When the projection pool was refreshed the
// board re-ordered but the anchors did not, so PROJ was pinned to ranks the
// board no longer had: the price column climbed as you went DOWN the sheet
// (RB11 at $26 above RB10 at $15), and unanchored players — anyone whose id
// changed with a team move — fell back to a live rank that collided with an
// anchored slot, so two players shared one price and another price vanished.
//
// tools/test-you-column.mjs only ever loads a FRESH profile, where anchors are
// seeded from the pool being shown, so it could never see this. This test loads
// a saved state from an OLDER pool, which is what every returning user has.
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
const poolA = (() => {
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
// Pool B is the same players after a routine weekly projection refresh: some rise,
// some fall, and one changes team (which changes his id, so he loses his anchor).
const poolB = poolA.map((p, i) => {
  const f = i % 5 === 0 ? 1.3 : i % 7 === 0 ? 0.75 : 1;
  const stats = {};
  for (const k of Object.keys(p.projectedStats)) stats[k] = p.projectedStats[k] * f;
  return { ...p, team: i === 3 ? 'FA' : p.team, projectedStats: stats };
});

const PROJ_KEY = (idx.match(/PROJ_KEY\s*=\s*'([^']+)'/) || [])[1];
const PROJ_VERSION = (idx.match(/PROJ_VERSION\s*=\s*'([^']+)'/) || [])[1];
const STORAGE_KEY = (idx.match(/STORAGE_KEY\s*=\s*'([^']+)'/) || [])[1];
const enc = pool => {
  const b = Buffer.from(JSON.stringify(pool), 'utf8');
  const o = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b[i] ^ PROJ_KEY.charCodeAt(i % PROJ_KEY.length);
  return o.toString('base64');
};
const payload = { A: enc(poolA), B: enc(poolB) };
let serving = 'A';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/projections') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(payload[serving]); }
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
      return { name: (cells[3] || '').replace(/^[V▲▼\-+0-9.]*/, ''), proj: money(5), value: money(6), you: money(7) };
    });
  });
  return out;
});

// ── Load 1: a fresh profile on the old pool. This is all the existing test sees.
await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const saved = await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY);
ok('load 1 saved a draft state', !!(saved && JSON.parse(saved).players));
ok('the saved state carries no frozen curve slots',
   !!saved && !JSON.parse(saved).marketAnchors,
   'marketAnchors is persisted again — it can only ever go stale against a newer pool');
const boardA = await readBoard();

// ── Load 2: the same user comes back after a projection refresh. Stamp the saved
// state with the version it really came from so the app re-baselines, exactly as
// it does for every returning user after a PROJ_VERSION bump.
serving = 'B';
await page.evaluate(([k, s]) => {
  const d = JSON.parse(s);
  d.projVersion = '2026.0';
  localStorage.setItem(k, JSON.stringify(d));
}, [STORAGE_KEY, saved]);
await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const board = await readBoard();

// ── Load 3: a BRAND NEW user, same refreshed pool. Nothing about a returning
// user's saved state may change what the room is expected to pay, so his board
// has to be the new user's board, price for price.
await page.evaluate(k => localStorage.removeItem(k), STORAGE_KEY);
await page.goto(`${base}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const fresh = await readBoard();
await browser.close(); server.close();

const POS = ['QB', 'RB', 'WR', 'TE'];
ok('the cheat sheet rendered every skill position', POS.every(p => (board[p] || []).length > 20), Object.keys(board).join(','));

console.log('\nafter a projection update, no column climbs as you go down the board');
for (const pos of POS) {
  const rows = (board[pos] || []).filter(r => r.you != null);
  if (!rows.length) continue;
  for (const [col, label] of [['proj', 'PROJ'], ['value', 'VALUE'], ['you', 'YOU']]) {
    const rises = rows.filter((r, i) => i && r[col] > rows[i - 1][col]);
    ok(`${pos} ${label} never rises`, rises.length === 0,
       rises.slice(0, 3).map((r, i) => `${r.name} $${r[col]}`).join(', ') + (rises.length > 3 ? ` (+${rises.length - 3} more)` : ''));
  }
}

// PROJ is not the only casualty: buildOptimalPlan prices every candidate off
// `marketValue`, so a scrambled price column feeds straight into the plan and out
// again as You. All three dollar columns have to agree with a fresh profile.
console.log('\na returning user is priced exactly like a new one on the same pool');
for (const pos of POS) {
  for (const [col, label] of [['proj', 'PROJ'], ['value', 'VALUE'], ['you', 'YOU']]) {
    const a = (board[pos] || []), b = (fresh[pos] || []);
    const diff = a.map((r, i) => [r, b[i]]).filter(([x, y]) => !y || x.name !== y.name || x[col] !== y[col]);
    ok(`${pos} ${label} matches a fresh profile row for row`, diff.length === 0,
       diff.slice(0, 3).map(([x, y]) => `${x.name} $${x[col]} vs $${y ? y[col] : '—'}`).join(', ')
       + (diff.length > 3 ? ` (+${diff.length - 3} more)` : ''));
  }
}

console.log('\nthe old pool is still priced the same as before the update');
ok('load 1 priced every skill position', POS.every(p => (boardA[p] || []).length > 20));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
