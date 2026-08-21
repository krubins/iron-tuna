#!/usr/bin/env node
// End-to-end test for the Draft Models "Projections vs Vegas" slider.
//   node tools/test-vegas-slider.mjs
//
// tools/test-vegas-weight.mjs pins the blend math. This drives the REAL app in
// Chromium and checks the thing the reader actually cares about: dragging the
// control re-prices the board — Proj, the order of the column, and the V flag
// that claims the odds moved someone — and dragging it back restores exactly
// what was there before.
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
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DEFAULT_W = parseFloat(html.match(/const VEGAS_DEFAULT_W = ([\d.]+);/)[1]);
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

// Stand in for a real overlay: one mid-pack WR the book likes far more than the
// consensus does. Everything shipped to the page is blended at the default
// weight and carries its [committed, marketImplied, blended] triple, exactly
// as blendProjections in _worker.js writes it.
const round1 = v => Math.round(v * 10) / 10;
const wrs = pool.filter(p => p.position === 'WR').sort((a, b) => (b.projectedStats.recYd || 0) - (a.projectedStats.recYd || 0));
const HERO = wrs[24];
const CONTROL = wrs[25];                        // no odds at all — must never move
const COMMITTED = HERO.projectedStats.recYd;
const MARKET = round1(COMMITTED + 700);         // enough to jump him up the column
HERO.projectedStats = { ...HERO.projectedStats, recYd: round1(COMMITTED + (MARKET - COMMITTED) * DEFAULT_W) };
HERO.vegas = { recYd: [COMMITTED, MARKET, HERO.projectedStats.recYd] };

const PROJ_KEY = html.match(/PROJ_KEY\s*=\s*'([^']+)'/)[1];
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
await page.route('**/unpkg.com/**', r => r.fulfill({
  status: 200, contentType: 'application/javascript',
  body: fs.readFileSync(/react-dom/.test(r.request().url()) ? reactDomPath : reactPath, 'utf8')
}));
await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.goto(`http://localhost:${server.address().port}/auctiondraft?screen=cheat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// The panel starts collapsed behind "Models, columns & tools".
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Models, columns & tools/.test(x.innerText));
  if (!b) return false;
  b.click();
  return true;
});
ok('the tools panel opens', opened);
await page.waitForTimeout(600);

const SEL = 'input[type=range][aria-label*="sportsbook odds"]';
const read = () => page.evaluate(({ sel, hero, control }) => {
  const el = document.querySelector(sel);
  const rowsOf = name => {
    for (const col of document.querySelectorAll('.cheat-col')) {
      const rows = [...col.querySelectorAll('.cheat-row')];
      const i = rows.findIndex(r => (r.children[3] || {}).innerText && r.children[3].innerText.includes(name));
      if (i >= 0) {
        const cells = [...rows[i].children].map(c => c.innerText.trim());
        const n = j => { const m = (cells[j] || '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
        // Row shape: ['', star, rank, name, bye/sos, VALUE, MKT, YOU, ppg].
        return { rank: n(2), proj: n(8), flagged: /^V/.test((cells[3] || '').trim()) };
      }
    }
    return null;
  };
  return {
    exists: !!el,
    value: el ? parseFloat(el.value) : null,
    readout: el && el.parentElement ? el.parentElement.innerText.replace(/\s+/g, ' ').trim() : '',
    hero: rowsOf(hero),
    control: rowsOf(control)
  };
}, { sel: SEL, hero: HERO.name, control: CONTROL.name });

const setSlider = v => page.evaluate(({ sel, v }) => {
  const el = document.querySelector(sel);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, { sel: SEL, v });

const base = await read();
ok('the slider renders in the Draft Models panel', base.exists);
ok('it starts at the weight the board ships at', base.value === DEFAULT_W, String(base.value));
ok('the readout names the split', /75% Vegas \/ 25% projections/.test(base.readout), base.readout);
ok('both fixtures are on the board', !!base.hero && !!base.control);
ok('the hero carries the V flag at the default blend', base.hero && base.hero.flagged);

await setSlider(0); await page.waitForTimeout(700);
const off = await read();
ok("dragging to Projections drops the hero's projected ppg", off.hero.proj < base.hero.proj, `${off.hero.proj} vs ${base.hero.proj}`);
ok('dragging to Projections drops him down the column', off.hero.rank > base.hero.rank, `${off.hero.rank} vs ${base.hero.rank}`);
ok('the V flag goes away when the odds are ignored', !off.hero.flagged);
ok('the readout says the odds are ignored', /Odds ignored/.test(off.readout), off.readout);
// A player the book never priced keeps his own stats untouched (pinned by
// identity in tools/test-vegas-weight.mjs). On the board he can still shift by
// a rounding hair, because normalizeToLastYear rescales the WHOLE pool to a
// season-total distribution and the hero just moved inside it. A hair is the
// ripple; anything more would mean the slider is re-pricing players it has no
// business touching.
const HAIR = 0.02;
const moved = (a, b) => Math.abs(a - b) / b;
ok('a player the book never priced barely moves', moved(off.control.proj, base.control.proj) < HAIR,
   `${off.control.proj} vs ${base.control.proj}`);
ok('the hero moves far more than that ripple', moved(off.hero.proj, base.hero.proj) > 5 * HAIR,
   `${off.hero.proj} vs ${base.hero.proj}`);

await setSlider(1); await page.waitForTimeout(700);
const all = await read();
ok("dragging to Vegas lifts the hero's projected ppg above the default blend", all.hero.proj > base.hero.proj, `${all.hero.proj} vs ${base.hero.proj}`);
ok('dragging to Vegas lifts him up the column', all.hero.rank < base.hero.rank, `${all.hero.rank} vs ${base.hero.rank}`);
ok('the readout says Vegas only', /Vegas lines only/.test(all.readout), all.readout);
ok('a player the book never priced still barely moves', moved(all.control.proj, base.control.proj) < HAIR,
   `${all.control.proj} vs ${base.control.proj}`);

// The reset link has to put the board back exactly, not approximately — a
// slider you cannot undo is a slider nobody drags.
const resetClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.ch-models button')].find(x => x.innerText.trim() === 'reset');
  if (!b) return false;
  b.click();
  return true;
});
ok('the reset link is offered once the slider is off default', resetClicked);
await page.waitForTimeout(700);
const backAgain = await read();
ok('reset returns the slider to the default weight', backAgain.value === DEFAULT_W, String(backAgain.value));
ok("reset restores the hero's projected ppg exactly", backAgain.hero.proj === base.hero.proj, `${backAgain.hero.proj} vs ${base.hero.proj}`);
ok('reset restores his place in the column', backAgain.hero.rank === base.hero.rank, `${backAgain.hero.rank} vs ${base.hero.rank}`);
ok('the reset link hides again at the default', await page.evaluate(() =>
  ![...document.querySelectorAll('.ch-models button')].some(x => x.innerText.trim() === 'reset')));

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
