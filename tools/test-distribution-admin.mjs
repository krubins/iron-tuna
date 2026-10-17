#!/usr/bin/env node
// Browser test for the /admin cards of growth plan Phase 6 (17 Oct 2026): the
// weekly drafts, creator partners, and the source comparison.
//   REQUIRE_BROWSER=1 node tools/test-distribution-admin.mjs
//
// The drafts are built by the worker's own distDraft over the fixture boards
// (tools/fixtures/home-board.mjs), and the partner and usage reads come from
// the REAL worker over an in-memory D1, so the page is drawn off true payloads.
// It checks, at 390 and 1280 px: Build makes one POST and nothing else; the
// figures, the explanation and the editable text appear; the counter follows
// edits and warns past the channel's length; Copy reaches the clipboard and
// says nothing was posted; "nothing clears" is said plainly; a partner can be
// added and becomes a channel; the package fills the outreach draft; the
// source table carries returns and confirmed sign-ups; the campaign table
// draws; no sideways scroll; no script errors.
//
// Needs playwright-core and Chromium; skips cleanly without them unless
// REQUIRE_BROWSER=1.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { homeBoard, homeMarkets } from './fixtures/home-board.mjs';

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

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const lift = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); const j = src.indexOf(b, i); return src.slice(i, j + b.length); };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cut ' + a); return src.slice(i, j); };
const ANALYTICS_DDL = eval(src.match(/const ANALYTICS_DDL = (\[[\s\S]*?\]);/)[1]);
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const s of ANALYTICS_DDL) sqlite.exec(s);
  return { sqlite, prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
    async run() { const r = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; },
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; },
    async first() { return sqlite.prepare(this.sql).all(...this.args)[0] || null; } }; } };
}

// ── draft payloads from the worker's own code over the fixtures ───────────
const NORM = new Function(lift('const _oddsNorm = ', ';\n') + '\nreturn _oddsNorm;')();
const M = homeMarkets(NORM);
const H = new Function('__board', '__markets', 'LEAD_TZ', [
  src.slice(src.indexOf('// ── the scoring engine ─'), src.indexOf('const COLUMN_SCORING = {')),
  lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'), lift('function _etStamp(ms) {', '\n}'),
  src.slice(src.indexOf('const HOME_EX_MAX = 3;'), src.indexOf('function homeShellFill(html, hp) {')),
  lift('const PICKUP_ROSTERED = ', ';\n'),
  'const boardsPayload = async () => __board(); const boardStillToPlay = (b) => b; const marketHistoryWeek = async () => __markets;',
  cut('// THE SUNDAY EMAIL AND SHARED FINDINGS START', '// THE SUNDAY EMAIL AND SHARED FINDINGS END'),
  cut('// THE WEEKLY DRAFTS AND PARTNERS START', '// THE WEEKLY DRAFTS AND PARTNERS END')
].join('\n') + '\nreturn { distDraft };');
const L = H(() => homeBoard(), M, 'America/New_York');
const SAT = Date.UTC(2026, 9, 17, 14, 0);
const ddb = makeDb();
const DRAFT = {};
for (const ch of ['x', 'threads']) DRAFT['market|' + ch] = (await L.distDraft({ LEADS_DB: ddb }, 'https://irontuna.com', { kind: 'market', scoring: 'ppr', channel: ch }, SAT)).body;
DRAFT.none = (await L.distDraft({ LEADS_DB: ddb }, 'https://irontuna.com', { kind: 'market', scoring: 'ppr', channel: 'x' }, Date.UTC(2026, 9, 18, 16, 30))).body;
ok('fixture drafts: one with three players, one with nothing', DRAFT['market|x'].figures.length === 3 && !!DRAFT.none.none, JSON.stringify(DRAFT.none).slice(0, 200));

// ── the real worker for every other admin read ────────────────────────────
const worker = (await import(path.join(ROOT, '_worker.js'))).default;
const rdb = makeDb();
{
  const day = (ts) => new Date(ts).toISOString().slice(0, 10);
  const seed = (ts, ev, uid, props) => rdb.sqlite.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?,?,?,?,?,?,0)').run(ts, day(ts), ev, uid, '/', JSON.stringify(props));
  const now = Date.now();
  for (let i = 0; i < 24; i++) {
    const t = now - (i % 12) * 86400000 - 3600000, uid = 'dst' + String(i).padStart(5, '0');
    const s = [['x', 'social', '2026-w06-vegas-gaps'], ['google.com', 'organic', ''], ['creator-some-show', 'partner', '2026-w06-partner']][i % 3];
    seed(t, 'visit_start', uid, { vid: 'v' + i, src: s[0], med: s[1], cmp: s[2], new: 1, fs: day(t) });
    if (i % 2) seed(t + 1000, 'tool_success', uid, { vid: 'v' + i, tool: 'vegas_edge', key: 'w6' });
    if (i % 4 === 0 && t + 2 * 86400000 < now) seed(t + 2 * 86400000, 'visit_start', uid, { vid: 'w' + i, src: 'direct', med: 'none', new: 0 });
  }
}
const wenv = { LEADS_DB: rdb, LEADS_EXPORT_KEY: 'k', ASSETS: { fetch: () => new Response('') } };
// Seed the subscriber table through the worker's own migration path.
await worker.fetch(new Request('https://irontuna.com/api/admin/partners?key=k', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126' } }), wenv, { waitUntil() {} });
rdb.sqlite.prepare("INSERT INTO newsletter_subscribers (email, status, scoring, created_at, updated_at, confirmed_at, visit_src, visit_med, visit_cmp) VALUES ('a@ex.com','confirmed','ppr',1,1,?, 'x','social','2026-w06-vegas-gaps')").run(Date.now() - 1000);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let MODE = 'full';
const CALLS = [];
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/finding/')) {
    CALLS.push(req.method + ' ' + u.pathname);
    let out = { ok: false, error: 'unavailable' }, status = 200;
    if (u.pathname === '/api/admin/drafts') {
      const b = JSON.parse(body || '{}');
      out = req.method !== 'POST' ? { ok: false } : MODE === 'none' ? DRAFT.none : DRAFT['market|' + b.channel] || DRAFT['market|x'];
    } else if (/^\/api\/admin\/(traffic|usage|partners)/.test(u.pathname)) {
      const r = await worker.fetch(new Request('https://irontuna.com' + u.pathname + u.search, { method: req.method, body: req.method === 'POST' ? body : undefined, headers: { 'user-agent': 'Mozilla/5.0 Chrome/126', 'content-type': 'application/json' } }), wenv, { waitUntil() {} });
      out = await r.json(); status = r.status;
    } else if (u.pathname.startsWith('/finding/')) {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630"/></svg>'); return;
    }
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(''); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];

for (const [w, h] of [[390, 844], [1280, 900]]) {
  MODE = 'full';
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(w + ': ' + e.message));
  await page.addInitScript(() => { try { localStorage.setItem('it_admin_key', 'k'); } catch (e) {} });
  await page.goto(BASE + '/admin.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('useMeta').textContent), null, { timeout: 8000 }).catch(() => {});
  const srcHead = await page.textContent('#useSrcTbl');
  ok(`${w}px: the source table compares returns and confirmed sign-ups`, /Came back in 7 days/.test(srcHead) && /Confirmed email/.test(srcHead) && /creator-some-show/.test(srcHead), srcHead.slice(0, 300));
  ok(`${w}px: the source notes say how each is credited`, /first visit in this window/.test(await page.textContent('#useSrcNote2')));
  const cmp = await page.textContent('#useCmpTbl');
  ok(`${w}px: the campaign table lists the tagged campaigns, small samples marked`, /2026-w06-vegas-gaps/.test(cmp) && /2026-w06-partner/.test(cmp) && /small sample/.test(cmp), cmp.slice(0, 300));

  // The operator tools, then the drafts card.
  await page.click('#ops > summary');
  await page.waitForFunction(() => /No partners yet|Partner/.test(document.getElementById('ptTbl').textContent), null, { timeout: 6000 }).catch(() => {});
  // The first pass adds a partner, so only it sees the empty list.
  if (w === 390) ok(`${w}px: no partners are suggested; the list starts empty`, /No partners yet/.test(await page.textContent('#ptTbl')) && /none are suggested/.test(await page.textContent('#ptTbl')));
  CALLS.length = 0;
  await page.selectOption('#distKind', 'market');
  await page.click('#distBuild');
  await page.waitForFunction(() => !document.getElementById('distOut').hidden, null, { timeout: 6000 }).catch(() => {});
  ok(`${w}px: Build made exactly one POST to the drafts route (and fetched its image)`, CALLS.filter(c => c.startsWith('POST')).length === 1 && CALLS[0] === 'POST /api/admin/drafts' && CALLS.every(c => c === 'POST /api/admin/drafts' || c.startsWith('GET /finding/')), CALLS.join(', '));
  const d = DRAFT['market|x'];
  const got = await page.evaluate(() => ({ text: document.getElementById('distText').value, rows: document.querySelectorAll('#distFig tr').length,
    why: document.getElementById('distWhy').textContent, link: document.getElementById('distLink').value, count: document.getElementById('distCount').textContent,
    msg: document.getElementById('distMsg').textContent, stamp: document.getElementById('distStamp').textContent, img: document.getElementById('distImgPrev').getAttribute('src'),
    open: document.getElementById('distOpen').getAttribute('href') }));
  ok(`${w}px: the figures, one row per player`, got.rows === 3, String(got.rows));
  ok(`${w}px: the explanation carries the labels`, /Quoted prop/.test(got.why) && /derived estimate/.test(got.why));
  ok(`${w}px: the editable text is the draft, the link the tagged one`, got.text === d.text && got.link === d.link && /utm_source=x&utm_medium=social/.test(got.link));
  ok(`${w}px: the counter, against X's 280`, got.count.startsWith(d.chars + ' of 280'), got.count);
  ok(`${w}px: says it is not posted, with the campaign and the stamps`, /Not posted/.test(got.msg) && /campaign 2026-w06-vegas-gaps/.test(got.stamp) && /board computed/.test(got.stamp));
  ok(`${w}px: the image and the dated finding are linked`, got.img === d.image && got.open === d.findingUrl);
  if (w === 390) await page.locator('#distCard').screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'admin-draft-card-390.png') }).catch(() => {});
  await page.fill('#distText', d.text + ' ' + 'x'.repeat(200));
  ok(`${w}px: an edit past the length is flagged`, /too long for this channel/.test(await page.textContent('#distCount')));
  await page.fill('#distText', 'My own words. ' + d.link);
  ok(`${w}px: X counts the link as 23`, (await page.textContent('#distCount')).startsWith((14 + 23) + ' of 280'), await page.textContent('#distCount'));
  await page.click('#distCopy');
  await page.waitForTimeout(150);
  ok(`${w}px: Copy puts the edited text on the clipboard and says nothing was posted`, (await page.evaluate(() => navigator.clipboard.readText())) === 'My own words. ' + d.link && /Nothing has been posted/.test(await page.textContent('#distMsg')));
  await page.selectOption('#distChannel', 'threads');
  await page.click('#distBuild');
  await page.waitForFunction(() => /of 500/.test(document.getElementById('distCount').textContent), null, { timeout: 4000 }).catch(() => {});
  ok(`${w}px: another channel, another limit and tag`, /of 500/.test(await page.textContent('#distCount')) && /utm_source=threads/.test(await page.inputValue('#distLink')));
  MODE = 'none';
  await page.click('#distBuild');
  await page.waitForFunction(() => /Nothing to post/.test(document.getElementById('distMsg').textContent), null, { timeout: 4000 }).catch(() => {});
  ok(`${w}px: nothing clears: said plainly, no draft left on screen`, /Nothing to post: No player clears the homepage bar/.test(await page.textContent('#distMsg')) && await page.evaluate(() => document.getElementById('distOut').hidden));
  MODE = 'full';

  // Partners: add one, see it listed and offered as a channel, build its package.
  if (w === 390) {
    await page.fill('#ptName', 'Some Show');
    await page.fill('#ptChannel', 'YouTube');
    await page.selectOption('#ptStatus', 'active');
    await page.click('#ptSave');
    await page.waitForFunction(() => /Some Show/.test(document.getElementById('ptTbl').textContent), null, { timeout: 6000 }).catch(() => {});
  } else {
    await page.waitForFunction(() => /Some Show/.test(document.getElementById('ptTbl').textContent), null, { timeout: 6000 }).catch(() => {});
  }
  const pt = await page.textContent('#ptTbl');
  ok(`${w}px: the partner is listed with its tag and its traffic`, /Some Show/.test(pt) && /creator-some-show/.test(pt) && /active/.test(pt), pt.slice(0, 300));
  ok(`${w}px: and offered as a channel for the drafts`, await page.evaluate(() => [...document.querySelectorAll('#distChannel option')].some(o => o.value === 'creator-some-show')));
  await page.click('[data-pt-pkg="0"]');
  await page.waitForFunction(() => !document.getElementById('ptPkg').hidden, null, { timeout: 6000 }).catch(() => {});
  const out = await page.inputValue('#ptOutreach');
  ok(`${w}px: the package: tagged links and an outreach draft to send yourself`, (await page.$$('#ptLinks tr')).length === 5 && out.includes('Hi Some Show,') && /Nothing has been sent/.test(await page.textContent('#ptPkgNote')));
  if (w === 390) await page.locator('#ptCard').screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'admin-partner-card-390.png') }).catch(() => {});
  const ov = await page.evaluate(() => ({ o: document.documentElement.scrollWidth - window.innerWidth,
    wide: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.tblwrap')).slice(0, 6).map(el => el.tagName + '#' + el.id + '.' + el.className) }));
  ok(`${w}px: no sideways scroll`, ov.o <= 1, ov.o + ' ' + ov.wide.join(' '));
  if (w === 390) await page.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'admin-drafts-390.png'), fullPage: true }).catch(() => {});
  await ctx.close();
}
ok('no page threw a script error', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
