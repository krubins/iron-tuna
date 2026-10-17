#!/usr/bin/env node
// Browser test for it-metrics.js and the Meaningful use section of /admin
// (docs/growth-plan.md, Phase 1).
//   node tools/test-metrics.mjs
//
// Drives real pages in Chromium over a local server with every /api route
// stubbed, and records what the pages send to /api/track. It proves the things
// a node test reading source text cannot:
//   - a visit starts once, with the source it arrived from, and a click between
//     our own pages neither starts a visit nor changes its source
//   - UTM tags are recorded and then stripped from the address bar
//   - a populated board is one success however often it rerenders or reloads
//     within the visit, and a failed feed is a tool_error, not a success
//   - a browser driven by automation sends nothing
//   - no payload carries an email address
//   - /admin draws the section off the REAL worker's /api/admin/usage output,
//     at phone and desktop widths, with no script errors, and says "nothing
//     collected yet" rather than drawing zeros when that is the truth
//
// Needs playwright-core and Chromium, like tools/test-homepage.mjs; skips
// cleanly without them unless REQUIRE_BROWSER=1.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRE = process.env.REQUIRE_BROWSER === '1';
function absent(what, fix) {
  if (REQUIRE) { console.error('FAIL — ' + what + '. REQUIRE_BROWSER=1, so this is a failure rather than a skip.'); if (fix) console.error('       ' + fix); process.exit(1); }
  console.log('SKIP — ' + what + (fix ? ' (' + fix + ')' : ''));
  process.exit(0);
}
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch (e) { absent('needs playwright-core (' + e.message.split('\n')[0] + ')', 'npm install --no-save --no-package-lock playwright-core@1.56.1'); }
const CHROME = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome',
  (() => { try { return chromium.executablePath(); } catch (e) { return null; } })()].find(p => p && fs.existsSync(p));
if (!CHROME) absent('no Chromium binary', 'set CHROMIUM_PATH, or run `npx playwright-core install chromium`');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── the real worker's usage payload, off a seeded in-memory D1 ──────────────
const worker = (await import(path.join(ROOT, '_worker.js'))).default;
const DDL = eval(fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8').match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const s of DDL) sqlite.exec(s);
  return { sqlite, prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
    run() { sqlite.prepare(this.sql).run(...this.args); return { meta: {} }; }, all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
    first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; } }; }, batch(st) { st.forEach(s => sqlite.exec(s.sql)); return []; } };
}
async function workerJson(db, p) {
  const env = { LEADS_DB: db, LEADS_EXPORT_KEY: 'k', ASSETS: { fetch: () => new Response('') } };
  const r = await worker.fetch(new Request('https://irontuna.com' + p, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126' } }), env, { waitUntil() {} });
  return r.json();
}
const dayOf = ts => new Date(ts).toISOString().slice(0, 10);
const full = makeDb();
{
  const seed = (ts, event, uid, props) => full.sqlite.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?,?,?,?,?,?,0)').run(ts, dayOf(ts), event, uid, '/', JSON.stringify(props));
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const t = now - (i % 20) * 86400000 - 3600000, uid = 'brw' + String(i).padStart(5, '0');
    const src = ['google.com', 'direct', 'x', 'chatgpt.com'][i % 4], med = ['organic', 'none', 'social', 'ai'][i % 4];
    seed(t, 'visit_start', uid, { vid: 'v' + i, src, med, new: 1, fs: dayOf(t) });
    if (i % 2) seed(t + 1000, 'tool_success', uid, { vid: 'v' + i, tool: ['rankings', 'vegas_edge', 'lineup'][i % 3], key: 'k' });
    if (i % 5 === 0) seed(t + 2000, 'tool_error', uid, { vid: 'v' + i, tool: 'rankings', key: 'e' });
    if (i % 3 === 0) { seed(t + 3000, 'league_setup_start', uid, { vid: 'v' + i, tool: 'league_scoring', key: 'form' }); }
    if (i % 6 === 0) { seed(t + 4000, 'league_setup_complete', uid, { vid: 'v' + i, tool: 'league_scoring', key: 'save' }); }
    if (i % 4 === 0) { const t2 = t + 2 * 86400000; if (t2 < now) seed(t2, 'visit_start', uid, { vid: 'w' + i, src: 'direct', med: 'none', new: 0, fs: dayOf(t) }); }
  }
}
const USAGE_FULL = await workerJson(full, '/api/admin/usage?key=k&days=30');
const USAGE_EMPTY = await workerJson(makeDb(), '/api/admin/usage?key=k&days=30');
const TRAFFIC = await workerJson(makeDb(), '/api/admin/traffic?key=k&days=30');
ok('the worker answers the seeded usage read', USAGE_FULL.ok && USAGE_FULL.available && USAGE_FULL.visitors.visitors === 30, JSON.stringify(USAGE_FULL).slice(0, 200));

// ── the site, served locally, with /api stubbed and /api/track recorded ─────
const st = (i, k) => ({ rec: (5 - i * 0.05) * k * 14, recYd: (60 - i) * k * 14, recTD: 0.4 * k * 14, rushYd: (40 - i * 0.5) * k * 14, rushTD: 0.3 * k * 14, passYd: 250 * k * 14, passTD: 1.6 * k * 14 });
const mkPlayer = (i, name, pos) => ({
  key: pos + i, name, position: pos, team: 'ATL', games: 14, byes: [9], roleTrend: { label: 'steady', pct: 0 },
  weeks: [{ week: 3, home: i % 2 === 0, opponent: 'KC', bye: false, out: false, consensusPts: 14.2, vegasPts: 13.8, ironTunaPts: 14.0, basis: 'props' }],
  // The page scores the stat lines itself at the reader's scoring, so the
  // fixture carries them (the shape tools/test-ranks.mjs uses).
  consensus: { points: 22.4 - i * 0.3, rank: i + 1, flexRank: i + 1, stats: st(i, 1) }, vegas: { points: 20.9 - i * 0.2, basis: 'props', confidence: 'HIGH', rank: i + 2, flexRank: i + 2, stats: st(i, 0.95) },
  marketDelta: { points: (i % 3 - 1) * 1.4, rank: i % 3 - 1, classification: 'market is higher' }, ironTuna: { points: 21.6 - i * 0.25, stats: st(i, 0.98) },
});
const NAMES = [['Bijan Robinson', 'RB'], ['Ja\'Marr Chase', 'WR'], ['Josh Allen', 'QB'], ['Trey McBride', 'TE'], ['Puka Nacua', 'WR']];
const BOARDS = { ok: true, scoring: { label: 'PPR' }, season: 2026, played: 0, horizon: { label: 'This week', weeks: [3] }, sources: { props: 120, usage: 2 },
  delta: { strongRank: 8, strongPct: 0.2, minPointsStrong: 2, leanRank: 4, leanPct: 0.1, minPointsLean: 1, classes: ['STRONG VEGAS BUY', 'VEGAS LEANS HIGHER', 'MARKET AGREES', 'VEGAS LEANS LOWER', 'STRONG VEGAS FADE'] },
  players: Array.from({ length: 40 }, (_, i) => mkPlayer(i, NAMES[i % 5][0] + (i < 5 ? '' : ' ' + i), NAMES[i % 5][1])) };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let MODE = 'live';
const TRACK = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/track') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { try { TRACK.push(JSON.parse(b)); } catch (e) { TRACK.push({ bad: b }); } res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    let body = { ok: false, error: 'unavailable' };
    if (u.pathname === '/api/admin/traffic') body = TRAFFIC;
    else if (u.pathname === '/api/admin/usage') body = MODE === 'empty' ? USAGE_EMPTY : USAGE_FULL;
    else if (MODE === 'live' && u.pathname === '/api/boards') body = BOARDS;
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  const p = u.pathname === '/' ? '/front.html' : /\.[a-z0-9]+$/.test(u.pathname) ? u.pathname : u.pathname + '.html';
  const fp = path.join(ROOT, p.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const browser = await chromium.launch({ executablePath: CHROME });
// A person's browser: an ordinary user-agent and no automation flag. Playwright
// sets both by default, and it-metrics.js (rightly) sends nothing then.
async function personContext(opts = {}) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: opts.viewport || { width: 1280, height: 900 } });
  if (!opts.automated) await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
  // Third-party tags are not under test and must not reach the network.
  await ctx.route(/googletagmanager|google-analytics|doubleclick|fonts\.g/, r => r.abort());
  return ctx;
}
const settle = ms => new Promise(r => setTimeout(r, ms || 400));
const evs = (name, tool) => TRACK.filter(t => t.event === name && (!tool || (t.props && t.props.tool === tool)));
const errors = [];

// ── 1. arrival, attribution, dedup ──
{
  TRACK.length = 0; MODE = 'live';
  const ctx = await personContext(); const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('rankings: ' + e.message));
  await page.goto(BASE + '/rankings?utm_source=X&utm_medium=social&utm_campaign=2026-w07-vegas#pos=RB', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#rkBody tr').length > 0, null, { timeout: 8000 }).catch(() => {});
  await settle();
  const vs = evs('visit_start');
  ok('a visit starts once on arrival', vs.length === 1, JSON.stringify(vs));
  ok('the visit carries the UTM source, medium and campaign', vs[0] && vs[0].props.src === 'x' && vs[0].props.med === 'social' && vs[0].props.cmp === '2026-w07-vegas', JSON.stringify(vs[0]));
  ok('a first visit is marked new, with a first-seen day', vs[0] && vs[0].props.new === 1 && /^\d{4}-\d{2}-\d{2}$/.test(vs[0].props.fs));
  ok('the UTM tags are stripped from the address bar, the hash kept', !/utm_/.test(page.url()) && /#pos=RB/.test(page.url()), page.url());
  const s1 = evs('tool_success', 'rankings');
  ok('a populated rankings board is a success', s1.length === 1 && s1[0].props.rows > 0 && s1[0].props.vid === vs[0].props.vid, JSON.stringify(s1));
  // Rerender: re-sort the same board twice.
  // The header is redrawn on every sort, so each click finds it afresh.
  await page.click('#rkHead th[data-key="player"]'); await page.click('#rkHead th[data-key="player"]');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#rkBody tr').length > 0, null, { timeout: 8000 }).catch(() => {});
  await settle();
  ok('rerenders and a reload in the same visit send no second success', evs('tool_success', 'rankings').length === 1, String(evs('tool_success', 'rankings').length));
  ok('a reload inside the visit does not start a new visit', evs('visit_start').length === 1);
  // A different position is a different result.
  await page.evaluate(() => { location.hash = 'pos=WR'; });
  await page.waitForFunction(() => /WR/.test(location.hash), null, { timeout: 4000 }).catch(() => {});
  await settle(600);
  ok('a different position is a second output', evs('tool_success', 'rankings').length === 2, JSON.stringify(evs('tool_success', 'rankings').map(e => e.props.key)));
  // Internal navigation: a real click on a link to another of our pages.
  await page.evaluate(b => { const a = document.createElement('a'); a.href = b + '/guides'; a.id = 'go'; a.textContent = 'go'; document.body.appendChild(a); }, BASE);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#go')]);
  await settle();
  ok('a click between our own pages does not start a visit', evs('visit_start').length === 1, JSON.stringify(evs('visit_start').map(e => e.props.src)));
  const uidA = await page.evaluate(() => localStorage.getItem('it.uid'));
  ok('the browser keeps one random id', /^[a-z0-9]{6,24}$/.test(uidA) && TRACK.every(t => t.uid === uidA), uidA);
  await ctx.close();
}

// ── 2. a returning browser, an outside referrer, a failed feed ──
{
  TRACK.length = 0; MODE = 'fail';
  const ctx = await personContext(); const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('rankings-fail: ' + e.message));
  await page.goto(BASE + '/guides', { waitUntil: 'load' });
  await settle();
  // Age the visit past its 30 idle minutes, then arrive from a search engine.
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('it.visit')); v.last -= 31 * 60000; localStorage.setItem('it.visit', JSON.stringify(v)); });
  await page.goto(BASE + '/rankings', { waitUntil: 'load', referer: 'https://www.google.com/' });
  await settle(1200);
  const vs = evs('visit_start');
  ok('an idle half hour ends a visit; the next one starts fresh', vs.length === 2, JSON.stringify(vs.map(v => v.props.src)));
  ok('a search referrer is source google.com, medium organic', vs[1] && vs[1].props.src === 'google.com' && vs[1].props.med === 'organic', JSON.stringify(vs[1]));
  ok('the second visit is from a returning browser', vs[1] && vs[1].props.new === 0);
  ok('a failed feed is a tool_error, not a success', evs('tool_error', 'rankings').length === 1 && !evs('tool_success', 'rankings').length, JSON.stringify(TRACK.map(t => t.event)));
  await ctx.close();
}

// ── 3. automation sends nothing ──
{
  TRACK.length = 0; MODE = 'live';
  const ctx = await personContext({ automated: true }); const page = await ctx.newPage();
  await page.goto(BASE + '/rankings', { waitUntil: 'load' });
  await settle(800);
  ok('a browser flagged as automated sends no events', TRACK.length === 0, JSON.stringify(TRACK.map(t => t.event)));
  await ctx.close();
}

// ── 4. league setup on /my-league: start once, complete on save ──
{
  TRACK.length = 0; MODE = 'live';
  const ctx = await personContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('my-league: ' + e.message));
  await page.goto(BASE + '/my-league', { waitUntil: 'load' });
  await settle();
  await page.check('#lsForm input[type=radio][name=teams][value="12"]', { force: true }).catch(() => {});
  await page.check('#lsForm input[type=radio][name=format][value="0.5"]', { force: true }).catch(() => {});
  await page.evaluate(() => { const f = document.getElementById('lsForm'); if (f.requestSubmit) f.requestSubmit(); else f.submit(); });
  await settle();
  ok('touching the form starts league setup once', evs('league_setup_start').length === 1, JSON.stringify(TRACK.map(t => t.event)));
  const done = evs('league_setup_complete');
  ok('saving completes league setup', done.length === 1 && done[0].props.tool === 'league_scoring' && done[0].props.teams > 0, JSON.stringify(done));
  await ctx.close();
}

// ── 4b. every instrumented page loads cleanly with its feeds refusing ──
// The outcome calls sit in error paths, which are the paths least often seen.
{
  MODE = 'fail';
  for (const pg of ['/position#pos=RB', '/vegas-edge', '/my-week', '/faab', '/trade-finder', '/fantasy', '/my-leagues', '/previews', '/weekly-wrap', '/the-pick']) {
    TRACK.length = 0;
    const ctx = await personContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(pg + ': ' + e.message));
    await page.goto(BASE + pg, { waitUntil: 'load' });
    await settle(900);
    ok(pg + ' loads the metrics script and starts a visit', evs('visit_start').length === 1, JSON.stringify(TRACK.map(t => t.event)));
    if (/position|vegas-edge|fantasy/.test(pg)) ok(pg + ' reports its refused feed as a tool error', evs('tool_error').length >= 1, JSON.stringify(TRACK.map(t => t.event + ':' + (t.props.tool || ''))));
    await ctx.close();
  }
}

ok('no payload carries an email address', !JSON.stringify(TRACK).includes('@'));

// ── 5. /admin draws the section at both widths, and the empty state ──
for (const [w, h] of [[390, 844], [1280, 900]]) {
  for (const mode of ['full', 'empty']) {
    MODE = mode;
    const ctx = await personContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('admin ' + w + ' ' + mode + ': ' + e.message));
    await page.addInitScript(() => { try { localStorage.setItem('it_admin_key', 'k'); localStorage.setItem('ironTunaAdminKey', 'k'); } catch (e) {} });
    await page.goto(BASE + '/admin.html', { waitUntil: 'load' });
    // The gate's own key storage name is read from the page, not assumed.
    if (await page.isVisible('#gate')) { await page.fill('#keyInput', 'k'); await page.click('#unlockBtn'); }
    await page.waitForFunction(() => !/Loading/.test(document.getElementById('useMeta').textContent), null, { timeout: 6000 }).catch(() => {});
    const r = await page.evaluate(() => ({
      meta: document.getElementById('useMeta').textContent,
      tiles: document.querySelectorAll('#useTiles .tile').length,
      src: document.querySelectorAll('#useSrcTbl tr').length,
      tools: document.getElementById('useToolTbl').textContent,
      ret: document.getElementById('useRetTbl').textContent,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      zeroTiles: [...document.querySelectorAll('#useTiles .val')].map(v => v.textContent),
      wide: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.tblwrap')).slice(0, 6).map(el => el.tagName + '#' + el.id + '.' + el.className),
    }));
    if (mode === 'full') {
      ok(`admin ${w}px: eight usage tiles`, r.tiles === 8, JSON.stringify(r));
      ok(`admin ${w}px: a row per acquisition source`, r.src >= 5, String(r.src));
      ok(`admin ${w}px: tools named in plain words`, /Rankings board/.test(r.tools) && /Vegas Edge/.test(r.tools));
      ok(`admin ${w}px: maturing cohorts are labeled`, /maturing/.test(r.ret));
      ok(`admin ${w}px: percentages sit beside counts`, /\d+ \(\d+(\.\d)?%\)/.test(await page.textContent('#useTiles')), await page.textContent('#useTiles'));
      if (w === 390) await page.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'admin-usage-390.png'), fullPage: true }).catch(() => {});
    } else {
      ok(`admin ${w}px: nothing collected says so instead of drawing zeros`, /Nothing collected yet/.test(r.meta) && r.tiles === 0, JSON.stringify(r));
    }
    ok(`admin ${w}px ${mode}: no sideways scroll`, r.overflow <= 1, r.overflow + ' ' + r.wide.join(' '));
    await ctx.close();
  }
}

ok('no page threw a script error', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
