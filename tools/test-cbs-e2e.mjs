#!/usr/bin/env node
// Sync My League, end to end in a real browser: the CBS browser connector
// (extensions/cbs-connector) driven in Chromium against the real _worker.js.
//
//   sudo -E node tools/test-cbs-e2e.mjs
//
// What runs: one HTTPS server on 127.0.0.1:443 answers as two hosts. As
// irontuna.com it hands every request to _worker.js's fetch() with the vars
// from wrangler.jsonc, an in-memory D1 (the one tools/test-league-sync.mjs
// uses) and the repo directory as the static assets; as
// bigkahuna.football.cbssports.com it serves a fake league rendered from
// tools/fixtures/cbs-browser-league.json in the shapes reader.js expects.
// Chromium maps both hosts to 127.0.0.1 and trusts the throwaway certificate.
// The unpacked extension is loaded from the repo, then: sign in through a
// magic link, open the CBS league tab, run the popup, import, pick the team,
// and confirm the league on /api/leagues, on My Leagues and on My Week.
//
// Two harness-only liberties, both documented where they happen: the popup is
// opened as a tab (headless Chromium does not open toolbar popups) with the
// active-tab query answered the way a click on the CBS tab would answer it,
// and the fake CBS host is granted as a host permission in a temporary copy of
// the manifest, standing in for the activeTab grant that the click confers.
//
// Needs: Playwright with its Chromium (npm i -g playwright && npx playwright
// install chromium, or set PLAYWRIGHT_MODULE to its index.mjs), openssl, and
// permission to bind port 443 (E2E_PORT changes the port, but Chromium's host
// mapping cannot move a port, so anything but 443 needs a proxy in front).
// Not part of CI: checks.yml installs nothing.
//
// What this proves: the extension's transport and the server's import path.
// What it cannot prove: CBS's live markup. The fake pages are the reader's own
// expectations rendered back at it, so a change on CBS's side still shows up
// as one of the reader's "No import was sent" messages in a real run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'e2e-auth-secret';
const CBS_HOST = 'bigkahuna.football.cbssports.com';
const PORT = parseInt(process.env.E2E_PORT || '443', 10);
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/cbs-browser-league.json'), 'utf8'));
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; say('  ok   ' + name); } else { fail++; say('  FAIL ' + name + (extra ? ' — ' + String(extra).slice(0, 300) : '')); } };

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs', path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright/index.mjs')].filter(Boolean)) {
    try { return await import(spec); } catch (e) {}
  }
  console.error('Playwright not found. npm i -g playwright && npx playwright install chromium, or set PLAYWRIGHT_MODULE.'); process.exit(2);
}

// ── the in-memory D1 (the same one tools/test-league-sync.mjs drives) ──────
const PK = { league_provider_tokens: ['email', 'provider', 'provider_league_id'], leagues: ['id'], league_teams: ['league_id', 'team_id'], league_roster_players: ['league_id', 'provider_player_id'], league_matchups: ['league_id', 'week', 'team_id'],
  league_transactions: ['league_id', 'provider_txn_id'], league_snapshots: ['league_id', 'season', 'week', 'kind'], league_sync_runs: ['id'], provider_connections: ['email', 'provider'],
  player_id_map: ['provider', 'provider_player_id'], player_map_misses: ['provider', 'provider_player_id'], sessions: ['id'] };
function fakeDb() {
  const t = {}; let auto = 1;
  const table = n => (t[n] = t[n] || new Map());
  const where = (clause, args, ai) => {
    const parts = clause.replace(/[()]/g, '').split(/\s+AND\s+/i);
    const preds = [];
    for (const p of parts) {
      const fns = p.split(/\s+OR\s+/i).map(x => x.trim()).map(x => {
        let m;
        if ((m = x.match(/^(\w+)\s*(=|!=|<=|>=|<|>)\s*\?$/))) { const v = args[ai.i++]; const op = m[2], col = m[1]; return r => op === '=' ? r[col] == v : op === '!=' ? r[col] != v : op === '<=' ? r[col] <= v : op === '>=' ? r[col] >= v : op === '<' ? r[col] < v : r[col] > v; }
        if ((m = x.match(/^(\w+)\s+IS\s+\?$/))) { const v = args[ai.i++]; return r => r[m[1]] == v; }
        if ((m = x.match(/^(\w+)\s+IS\s+NULL$/))) return r => r[m[1]] == null;
        if ((m = x.match(/^(\w+)\s*(=|!=)\s*'([^']*)'$/))) return r => m[2] === '=' ? r[m[1]] == m[3] : r[m[1]] != m[3];
        return () => true;
      });
      preds.push(r => fns.some(f => f(r)));
    }
    return r => preds.every(f => f(r));
  };
  const run = (sql, args) => {
    let m;
    if (/^CREATE /i.test(sql)) return { meta: { changes: 0 } };
    if ((m = sql.match(/^INSERT (?:OR REPLACE )?INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(s => s.trim()); const row = {};
      const vals = (sql.match(/VALUES \(([^)]+)\)/i) || [])[1].split(',').map(s => s.trim()); let ai2 = 0;
      cols.forEach((c, i) => { const v = vals[i]; row[c] = v === '?' ? args[ai2++] : v === 'NULL' ? null : Number(v); });
      const tb = table(m[1]); const pk = PK[m[1]] || cols; if (!row.id && pk[0] === 'id' && !cols.includes('id')) row.id = auto++;
      const key = pk.map(k => row[k]).join('|');
      if (tb.has(key) && /ON CONFLICT/i.test(sql)) { const cur = tb.get(key); const upd = {}; for (const c of cols) if (new RegExp(c + '=excluded\\.' + c).test(sql)) upd[c] = row[c]; if (/count=count\+1/.test(sql)) upd.count = (cur.count || 0) + 1; tb.set(key, { ...cur, ...upd }); }
      else tb.set(key, row);
      return { meta: { changes: 1 } };
    }
    if ((m = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/is))) {
      const sets = m[2].split(',').map(s => s.trim()); const ai = { i: 0 }; const assign = [];
      for (const s of sets) { const mm = s.match(/^(\w+)=(\?|NULL|\d+)$/); if (!mm) continue; if (mm[2] === '?') assign.push([mm[1], args[ai.i++]]); else if (mm[2] === 'NULL') assign.push([mm[1], null]); else assign.push([mm[1], Number(mm[2])]); }
      const pred = where(m[3], args, ai); let n = 0;
      for (const [, r] of table(m[1])) if (pred(r)) { for (const [c, v] of assign) r[c] = v; n++; }
      return { meta: { changes: n } };
    }
    if ((m = sql.match(/^DELETE FROM (\w+)(?: WHERE (.+))?$/is))) { const tb = table(m[1]); const pred = m[2] ? where(m[2], args, { i: 0 }) : () => true; let n = 0; for (const [k, r] of [...tb]) if (pred(r)) { tb.delete(k); n++; } return { meta: { changes: n } }; }
    if ((m = sql.match(/^SELECT (.+?) FROM (\w+)(?: (?:r|l) LEFT JOIN .*)?(?: WHERE (.+?))?(?: GROUP BY .+?)?(?: ORDER BY .+?)?(?: LIMIT .+)?$/is))) {
      if (/JOIN|GROUP BY/i.test(sql)) return { results: [] };
      const rows = [...table(m[2]).values()].filter(m[3] ? where(m[3], args, { i: 0 }) : () => true);
      if (/COUNT\(\*\) AS n/i.test(m[1])) return { results: [{ n: rows.length }] };
      if (/MAX\((\w+)\)/i.test(m[1])) { const col = m[1].match(/MAX\((\w+)\)/i)[1]; return { results: [{ ts: rows.reduce((a, r) => Math.max(a, r[col] || 0), 0) || null }] }; }
      return { results: rows.map(r => ({ ...r })) };
    }
    return { results: [] };
  };
  const stmt = (sql, args) => ({ async run() { return run(sql, args); }, async first() { const r = run(sql, args); return r.results && r.results[0] || null; }, async all() { return run(sql, args); } });
  return { t, prepare(sql) { return { bind(...a) { return stmt(sql, a); }, run() { return stmt(sql, []).run(); }, first() { return stmt(sql, []).first(); }, all() { return stmt(sql, []).all(); } }; }, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

// ── a magic link, signed the way the worker signs one ──────────────────────
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function magicLink(email) {
  const p = b64url(JSON.stringify({ e: email, n: crypto.randomUUID(), t: 'magic', r: '/my-league', exp: Date.now() + 15 * 60 * 1000 }));
  return 'https://irontuna.com/api/auth/verify?token=' + encodeURIComponent(p + '.' + b64url(crypto.createHmac('sha256', SECRET).update(p).digest()));
}

// ── static assets, the way Workers Assets serves the repo ──────────────────
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain', xml: 'application/xml' };
const ASSETS = { async fetch(req) {
  const p = decodeURIComponent(new URL(typeof req === 'string' ? req : req.url).pathname);
  for (const t of p === '/' ? ['index.html'] : [p.slice(1), p.slice(1).replace(/\/$/, '') + '.html', p.slice(1).replace(/\/$/, '') + '/index.html']) {
    const f = path.join(ROOT, t);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f), { headers: { 'content-type': MIME[t.split('.').pop()] || 'application/octet-stream' } });
  }
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
} };

// ── the fake CBS league, the fixture rendered into reader.js's shapes ──────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function cbsPage(pathname) {
  const page = body => '<!doctype html><html><head><meta charset="utf-8"><title>CBS Fantasy Football</title></head><body><div class="nav">Home · Rules · Teams · League Password: <a href="/settings/password">manage</a></div>' + body + '</body></html>';
  if (pathname === '/rules') {
    const slotLabel = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'RB-WR-TE', SFLEX: 'QB-RB-WR-TE', K: 'K', DEF: 'DST', BN: 'Bench', IR: 'Injured Players', TAXI: 'Practice Players' };
    let t1 = '<table><tr><td>League Name</td><td>' + esc(FIX.name) + '</td></tr><tr><td>Teams</td><td>' + FIX.numTeams + '</td></tr><tr><td>League Password</td><td>hunter2</td></tr><tr><td>Playoffs Start</td><td>Week ' + FIX.playoffWeekStart + '</td></tr><tr><td>Position</td><td>Min</td><td>Max</td></tr>';
    for (const [k, n] of Object.entries(FIX.roster)) t1 += '<tr><td>' + esc(slotLabel[k] || k) + '</td><td>0</td><td>' + n + '</td></tr>';
    let t2 = '<table><tr><td>Offensive</td><td>Description</td><td>Settings</td></tr>', group = 'OFFENSIVE';
    for (const r of FIX.rules) {
      if (r.group !== group) { group = r.group; t2 += '<tr><td colspan="3">' + esc(group === 'DEFENSIVE' ? 'Defensive' : group.replace(/\w\S*/g, w => w[0] + w.slice(1).toLowerCase())) + '</td></tr>'; }
      t2 += '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.code) + ' description</td><td>' + esc(r.text) + '</td></tr>';
    }
    return page('<h1>League Rules</h1>' + t1 + '</table><h2>Scoring</h2>' + t2 + '</table><h2>Constitution</h2><p>Private constitution text.</p>');
  }
  if (pathname === '/teams/roster-grid') return page('<h1>Roster Grid</h1><table><tr><td>Team</td><td>QB</td></tr>' + FIX.teams.map(tm => '<tr><td><a href="/teams/' + tm.teamId + '">' + esc(tm.name) + '</a></td><td>-</td></tr>').join('') + '</table>');
  const m = pathname.match(/^\/teams\/(\d+)$/);
  if (!m) return null;
  const ro = FIX.rosters.find(r => r.teamId === m[1]), tm = FIX.teams.find(t => t.teamId === m[1]);
  if (!ro) return null;
  const prow = (p, label) => '<tr><td></td><td>' + esc(label) + '</td><td><a href="/players/playerpage/' + p.providerPlayerId + '">' + esc(p.name) + '</a> ' + esc(p.position === 'DEF' ? 'DST' : p.position) + ' • ' + esc(p.team) + '</td><td>Bye 7</td></tr>';
  const by = s => ro.players.filter(p => p.slot === s);
  let t = '<table><tr><td></td><td>Pos</td><td>Players</td><td>Bye</td></tr>' + by('starter').map(p => prow(p, p.slotLabel === 'FLEX' ? 'RB-WR-TE' : p.slotLabel === 'DEF' ? 'DST' : p.slotLabel)).join('');
  t += '<tr><td colspan="4">Reserves</td></tr>' + by('bench').map(p => prow(p, 'BN')).join('');
  if (by('ir').length) t += '<tr><td colspan="4">Injured Reserve</td></tr>' + by('ir').map(p => prow(p, 'IR')).join('');
  t += '<tr><td colspan="4">Active: ' + ro.counts.starter + ' Reserve: ' + ro.counts.bench + (by('ir').length ? ' Injured: ' + by('ir').length : '') + '</td></tr></table>';
  return page('<h1>' + esc(tm ? tm.name : 'Team') + '</h1>' + t);
}

// ── the server: one port, two hosts ────────────────────────────────────────
async function startServer() {
  const worker = (await import(path.join(ROOT, '_worker.js'))).default;
  const wr = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8').replace(/\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
  const db = fakeDb();
  const env = { ...(wr.vars || {}), LEADS_DB: db, AUTH_SECRET: SECRET, ASSETS };
  if (!globalThis.caches) globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'it-e2e-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '2', '-subj', '/CN=irontuna.com', '-addext', 'subjectAltName=DNS:irontuna.com,DNS:' + CBS_HOST], { stdio: 'ignore' });
  const log = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, async (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const chunks = []; for await (const c of req) chunks.push(c);
    const entry = { host, method: req.method, path: req.url, status: 0 }; log.push(entry);
    try {
      if (host === CBS_HOST) { const html = cbsPage(new URL(req.url, 'https://' + host).pathname); entry.status = html ? 200 : 404; res.writeHead(entry.status, { 'content-type': html ? 'text/html; charset=utf-8' : 'text/plain' }); res.end(html || 'not found'); return; }
      if (host !== 'irontuna.com') { entry.status = 421; res.writeHead(421); res.end('wrong host'); return; }
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !/^(host|connection|content-length|transfer-encoding)$/i.test(k)) headers.set(k, v);
      const request = new Request('https://irontuna.com' + req.url, { method: req.method, headers, body: /^(GET|HEAD)$/.test(req.method) ? undefined : Buffer.concat(chunks), duplex: 'half', redirect: 'manual' });
      const resp = await worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
      entry.status = resp.status;
      const out = {}; resp.headers.forEach((v, k) => { if (!/^(set-cookie|content-encoding|content-length)$/.test(k)) out[k] = v; });
      const cookies = resp.headers.getSetCookie(); if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(resp.status, out); res.end(Buffer.from(await resp.arrayBuffer()));
    } catch (e) { entry.status = 500; entry.error = String(e && e.stack || e); res.writeHead(500, { 'content-type': 'text/plain' }); res.end('harness error: ' + entry.error); }
  });
  await new Promise((yes, no) => server.listen(PORT, '127.0.0.1', err => err ? no(err) : yes()));
  return { db, log, close: () => new Promise(r => { server.close(r); fs.rmSync(dir, { recursive: true, force: true }); }) };
}

// ── the run ────────────────────────────────────────────────────────────────
const { chromium } = await loadPlaywright();
const H = await startServer();
say('server on 127.0.0.1:' + PORT + ' as irontuna.com and ' + CBS_HOST);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'it-e2e-ext-'));
const EXT = path.join(work, 'ext'); fs.mkdirSync(EXT);
for (const f of fs.readdirSync(path.join(ROOT, 'extensions/cbs-connector'))) fs.copyFileSync(path.join(ROOT, 'extensions/cbs-connector', f), path.join(EXT, f));
// Harness-only: the fake CBS host as a host permission, in place of the activeTab grant a toolbar click confers.
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...manifest.host_permissions, 'https://' + CBS_HOST + '/*'];
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const ctx = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
  args: ['--no-proxy-server', '--disable-extensions-except=' + EXT, '--load-extension=' + EXT, '--host-resolver-rules=MAP irontuna.com 127.0.0.1, MAP ' + CBS_HOST + ' 127.0.0.1', '--ignore-certificate-errors'],
});
ctx.on('page', p => p.on('pageerror', e => say('[pageerror ' + p.url().slice(0, 60) + ']', String(e).slice(0, 300))));
const extId = await (async () => { const p = await ctx.newPage(); await p.goto('chrome://extensions'); const ids = await p.evaluate(async () => (await chrome.developerPrivate.getExtensionsInfo()).map(e => e.id)); await p.close(); return ids[0]; })();
say('extension loaded as ' + extId);

try {
  // 1. sign in on My Leagues
  const tuna = await ctx.newPage();
  await tuna.goto(magicLink('owner@example.com'), { waitUntil: 'load' });
  ok('the magic link lands on My Leagues', /\/my-league/.test(tuna.url()), tuna.url());
  await tuna.waitForFunction(() => /No league connected/.test(document.getElementById('lsStatus')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok('My Leagues renders the signed-in reader with no league yet', /No league connected/.test(await tuna.evaluate(() => document.getElementById('lsStatus')?.textContent || '')));
  ok('/api/auth/me reports signedIn for the free account', (await tuna.evaluate(() => fetch('/api/auth/me').then(r => r.json()))).signedIn === true);

  // 2. the CBS league tab, active
  const cbs = await ctx.newPage();
  await cbs.goto('https://' + CBS_HOST + '/teams/8', { waitUntil: 'load' });
  await cbs.bringToFront();

  // 3. the popup. Headless Chromium does not open toolbar popups, so popup.html
  //    opens as a tab and the active-tab query is answered the way it would be
  //    with the CBS tab focused under the toolbar click.
  await ctx.addInitScript(({ cbsUrl }) => {
    if (!globalThis.chrome || !chrome.tabs || !chrome.tabs.query) return;
    const real = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async q => q && q.active ? real({ url: cbsUrl }) : real(q);
  }, { cbsUrl: 'https://' + CBS_HOST + '/*' });
  const runPopup = async () => {
    const popup = await ctx.newPage(); await popup.goto('chrome-extension://' + extId + '/popup.html');
    await popup.waitForFunction(() => /League:|Open your CBS/.test(document.getElementById('league')?.textContent || ''), null, { timeout: 10000 });
    return popup;
  };
  const popup = await runPopup();
  ok('the popup recognizes the CBS league from the active tab', (await popup.evaluate(() => document.getElementById('league').textContent)) === 'League: bigkahuna');
  await popup.click('#connect');
  await popup.waitForFunction(() => { const s = document.getElementById('status'); return /^Connected/.test(s.textContent) || s.dataset.error === 'true'; }, null, { timeout: 60000 }).catch(() => {});
  const fin = await popup.evaluate(() => ({ text: document.getElementById('status').textContent, error: document.getElementById('status').dataset.error, teamSection: !document.getElementById('teamSection').hidden, teams: [...document.querySelectorAll('#team option')].map(o => o.value) }));
  ok('the import reaches Connected', /^Connected:/.test(fin.text) && fin.error !== 'true', fin.text);
  ok('the popup asks which team is mine', fin.teamSection && fin.teams.join(',') === '8,9', JSON.stringify(fin.teams));
  if (fin.teamSection) {
    await popup.selectOption('#team', '8'); await popup.click('#saveTeam');
    await popup.waitForFunction(() => /team is saved|Could not/.test(document.getElementById('status').textContent), null, { timeout: 15000 }).catch(() => {});
    ok('the team is saved from the popup', /Your team is saved/.test(await popup.evaluate(() => document.getElementById('status').textContent)));
  }
  await popup.close();

  // 4. what the account holds
  const leagues = await tuna.evaluate(() => fetch('/api/leagues').then(r => r.json()));
  const L = leagues.leagues && leagues.leagues[0];
  ok('/api/leagues lists the league as a CBS browser import', !!L && L.provider === 'cbs_browser' && L.numTeams === FIX.numTeams && L.name === FIX.name && L.userTeamId === '8', JSON.stringify(leagues).slice(0, 200));
  ok('the league is ok, with no automatic refresh scheduled', L && L.sync && L.sync.status === 'ok' && L.sync.nextAt == null, L && JSON.stringify(L.sync));
  const full = L && await tuna.evaluate(id => fetch('/api/leagues/' + id).then(r => r.json()), L.id);
  const t9 = full && full.league && (full.league.rosters || []).find(r => r.teamId === '9');
  ok('an injured-reserve player is imported on the ir slot', t9 && t9.players.some(p => p.slot === 'ir'), JSON.stringify(t9 && t9.players.map(p => p.name + ':' + p.slot)));
  ok('no provider token was stored for a browser import', !(H.db.t.league_provider_tokens && H.db.t.league_provider_tokens.size));

  // 5. the pages
  await tuna.reload({ waitUntil: 'load' });
  await tuna.waitForFunction(() => document.querySelector('#lsList .is-card[data-id]'), null, { timeout: 15000 }).catch(() => {});
  const card = await tuna.evaluate(() => (document.querySelector('#lsList .is-card[data-id]') || {}).textContent || '');
  ok('My Leagues shows the league card as a CBS import', card.includes(FIX.name) && /CBS/.test(card), card.slice(0, 200));
  ok('the card has no Sync now button, only the extension note', await tuna.evaluate(() => { const c = document.querySelector('#lsList .is-card[data-id]'); return !!c && !c.querySelector('[data-act="sync"]') && /extension/.test(c.textContent); }));
  const week = await ctx.newPage(); await week.goto('https://irontuna.com/my-week', { waitUntil: 'load' });
  await week.waitForFunction(() => document.querySelector('.its-strip-sync') && document.querySelector('.its-strip-sync').textContent.length > 0, null, { timeout: 15000 }).catch(() => {});
  ok('the My Week strip names the synced league', ((await week.evaluate(() => (document.querySelector('.its-strip-sync') || {}).textContent || ''))).includes(FIX.name));

  // 6. a second run is a refresh, not a second league
  await cbs.bringToFront();
  const again = await runPopup(); await again.click('#connect');
  await again.waitForFunction(() => { const s = document.getElementById('status'); return /^Connected/.test(s.textContent) || s.dataset.error === 'true'; }, null, { timeout: 60000 }).catch(() => {});
  const list2 = await tuna.evaluate(() => fetch('/api/leagues').then(r => r.json()));
  ok('running the extension again refreshes the same league and keeps the team', list2.leagues.length === 1 && list2.leagues[0].id === L.id && list2.leagues[0].userTeamId === '8', JSON.stringify(list2.leagues.map(l => [l.id, l.userTeamId])));
  await again.close();
} catch (e) { fail++; say('  FAIL harness error — ' + (e && e.stack || e)); }

const errs = H.log.filter(l => l.error); if (errs.length) say('server errors: ' + JSON.stringify(errs.slice(0, 3)));
await ctx.close(); await H.close(); fs.rmSync(work, { recursive: true, force: true });
say(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
