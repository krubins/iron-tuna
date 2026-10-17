// My Week for a returning reader (docs/growth-plan.md, Phase 4, 17 Oct 2026).
//
//   node tools/test-myweek.mjs
//
// Two halves. Node: it-myweek.js's snapshot and diff, which decide what
// "since your last visit" may say (only material, supported changes; a new
// week or a changed scoring resets rather than compares). Browser: my-week.html
// against stubbed league APIs, proving the cases the plan names: multiple
// leagues and the switcher, missing rosters (pickups say to check
// availability), changed scoring, stale data, and returning visits, plus the
// homepage's way back and the rosters box's typed path when a read fails.
// The browser half needs playwright-core and Chromium, and skips cleanly
// without them unless REQUIRE_BROWSER=1.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── the snapshot and the diff ──────────────────────────────────────────────
const box = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'it-myweek.js'), 'utf8'), box);
const M = box.window.ITMyWeek;
const LU = (o = {}) => ({ ok: true, week: o.week || 6, scoring: o.scoring || 'PPR · 12 teams',
  lineup: [
    { slot: 'QB', key: 'qb1', name: 'Josh Allen', position: 'QB', projected: o.qb == null ? 22.4 : o.qb, injury: null },
    { slot: 'RB', key: 'rb1', name: 'Bijan Robinson', position: 'RB', projected: 18.1, injury: o.bijanInj || null },
    { slot: 'WR', key: o.swap ? 'wr2' : 'wr1', name: o.swap ? 'Second Wideout' : 'First Wideout', position: 'WR', projected: 12.0, injury: null },
    { slot: 'FLEX', empty: true }
  ],
  bench: [
    { key: o.swap ? 'wr1' : 'wr2', name: o.swap ? 'First Wideout' : 'Second Wideout', position: 'WR', projected: 9.0, injury: null },
    ...(o.drop ? [] : [{ key: 'te9', name: 'Bench Tight End', position: 'TE', projected: 4.0, injury: 'Probable' }]),
    ...(o.add ? [{ key: 'rb7', name: 'New Back', position: 'RB', projected: 6.0, injury: null }] : [])
  ], reserve: [] });
console.log('\nsince your last visit: what it compares');
{
  const base = M.snapshot(LU(), { now: 1000 });
  ok('a snapshot keeps each rostered player\'s start, projection and designation, keyed by player', base.roster.qb1.start === true && base.roster.wr2.start === false && base.roster.qb1.pts === 22.4 && base.week === 6);
  ok('Probable is not a designation worth reporting', base.roster.te9.inj === null);
  ok('an empty slot is not a player', Object.keys(base.roster).length === 5);
  ok('first visit: a baseline, nothing to list', M.diff(null, base).baseline === true && M.diff(null, base).reason === 'first');
  ok('the same roster again: compared, and no change', (() => { const d = M.diff(base, M.snapshot(LU())); return !d.baseline && d.items.length === 0; })());
  const d1 = M.diff(base, M.snapshot(LU({ bijanInj: 'Questionable', swap: true, add: true, drop: true, qb: 17.0 })));
  const kinds = d1.items.map(i => i.kind).join(',');
  // The swap is itself a projection move (12.0 and 9.0 trade places), so the
  // two wideouts' moves are listed with the quarterback's.
  ok('an injury, a lineup swap, a roster add and drop, and the starters\' projection moves are all listed', kinds === 'injury,lineup,lineup,roster,roster,projection,projection,projection', kinds);
  ok('injury first, written with what it was', d1.items[0].text === 'Bijan Robinson: now Questionable.', d1.items[0].text);
  ok('the lineup lines name who moved in and out', d1.items.some(i => i.text === 'Second Wideout moves into your best lineup.') && d1.items.some(i => i.text === 'First Wideout drops out of your best lineup.'));
  ok('roster lines for the add and the drop', d1.items.some(i => i.text === 'New Back is new on your saved roster.') && d1.items.some(i => i.text === 'Bench Tight End is off your saved roster.'));
  ok('the projection line gives both numbers and the move, with a real minus', d1.items.some(i => i.text === 'Josh Allen: projection 22.4 to 17.0 (−5.4).'), JSON.stringify(d1.items));
  ok('a cleared designation is said too', M.diff(M.snapshot(LU({ bijanInj: 'Doubtful' })), base).items[0].text === 'Bijan Robinson: no longer listed (was Doubtful).');
  ok('a small move is not material: 22.4 to 21.0 is under 2 points', M.diff(base, M.snapshot(LU({ qb: 21.0 }))).items.length === 0);
  ok('nor is 2 points on a big number under 20%', M.diff(M.snapshot(LU({ qb: 30 })), M.snapshot(LU({ qb: 27.5 }))).items.length === 0);
  const wk = M.diff(base, M.snapshot(LU({ week: 7, qb: 10 })));
  ok('a new week is a new baseline, not a list of last week against this', wk.baseline === true && wk.reason === 'week' && wk.week === 7 && wk.items.length === 0);
  const sc = M.diff(base, M.snapshot(LU({ scoring: 'Half PPR · 12 teams', qb: 15, bijanInj: 'Out' })));
  ok('a changed scoring is said first, and projection moves are not compared', sc.reason === 'scoring' && sc.items[0].kind === 'scoring' && /PPR · 12 teams to Half PPR · 12 teams/.test(sc.items[0].text) && !sc.items.some(i => i.kind === 'projection'), JSON.stringify(sc.items));
  ok('but an injury still is', sc.items.some(i => i.kind === 'injury'));
  ok('a failed lineup answer makes no snapshot', M.snapshot({ ok: false }) === null && M.snapshot(null) === null);
  ok('an old snapshot version is a fresh baseline', M.diff({ v: 0, roster: {} }, base).reason === 'first');
  ok('no em dash in anything it writes', !/—/.test(JSON.stringify(d1) + JSON.stringify(sc)));
}

// ── the browser half ───────────────────────────────────────────────────────
const REQUIRE = process.env.REQUIRE_BROWSER === '1';
let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch (e) { chromium = null; }
const CHROME = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome',
  (() => { try { return chromium && chromium.executablePath(); } catch (e) { return null; } })()].find(p => p && fs.existsSync(p));
if (!chromium || !CHROME) {
  if (REQUIRE) { ok('a browser is available (REQUIRE_BROWSER=1)', false); }
  else console.log('\nSKIP browser half: needs playwright-core and Chromium');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const NOW = Date.now();
const LEAGUES = (n) => ({ ok: true, defaultId: n ? 'league-aaaa1111' : null, leagues: n === 0 ? [] : [
  { id: 'league-aaaa1111', name: 'Office League', isDefault: true, userTeamId: 'm1', label: 'PPR · 12 teams', sync: { lastAt: NOW - 3600000 } },
  ...(n > 1 ? [{ id: 'league-bbbb2222', name: 'Family League', isDefault: false, userTeamId: 'm1', label: 'Half PPR · 10 teams', sync: { lastAt: NOW - 9 * 86400000 } }] : [])
] });
// Per league: the knobs a test turns between visits.
const W = { 'league-aaaa1111': { week: 6, scoring: 'PPR · 12 teams', pool: { known: true, teams: 12, rostered: 12, complete: 12 }, saved: NOW - 3600000, qb: 22.4, inj: null },
            'league-bbbb2222': { week: 6, scoring: 'Half PPR · 10 teams', pool: { known: false, teams: 10, rostered: 1, complete: 0 }, saved: NOW - 9 * 86400000, qb: 20.0, inj: null } };
const asOf = (w) => ({ board: Date.UTC(2026, 9, 17, 18, 13), odds: Date.UTC(2026, 9, 17, 11, 0), week: w.week, leagueSaved: w.saved, leagueStale: NOW - w.saved > 7 * 86400000 });
function advice(id, mod) {
  const w = W[id];
  if (mod === 'lineup') return { ok: true, week: w.week, scoring: w.scoring, asOf: asOf(w), slotsKnown: false, changes: [], decisions: [], projectedTotal: 52.4, unranked: [],
    lineup: [{ slot: 'QB', key: 'qb1', name: 'Josh Allen', position: 'QB', team: 'BUF', projected: w.qb, injury: w.inj, why: '' }, { slot: 'RB', key: 'rb1', name: 'Bijan Robinson', position: 'RB', team: 'ATL', projected: 18.1, injury: null, why: '' }],
    bench: [{ key: 'wr2', name: 'Bench Wideout', position: 'WR', team: 'NYJ', projected: 8.0, injury: null }], reserve: [] };
  if (mod === 'pickups') return { ok: true, pool: w.pool, scoring: w.scoring, asOf: asOf(w), rosterFull: true, pickups: [
    { name: 'Waiver Back', position: 'RB', team: 'NYJ', priority: 'High', cracksLineup: true, verified: w.pool.known, status: w.pool.known ? 'available' : 'unverified', drop: { name: 'Bench Wideout' }, faab: { low: 20, high: 35, budget: 100 }, why: 'starts for you this week (+3.1 vs NE).' }] };
  if (mod === 'matchup') return { ok: true, week: w.week, you: { name: 'Mine', projected: 100, injuryRisk: [] }, opponent: null, swing: [], upgrades: [], note: 'n', pool: w.pool, scoring: w.scoring, asOf: asOf(w) };
  if (mod === 'intel') return { ok: true, alerts: [], asOf: NOW, quiet: true };
  if (mod === 'trades') return { ok: true, trades: [], targets: [], needs: [] };
  if (mod === 'playoffs') return { ok: true, weeks: [15, 16, 17], rankInLeague: 3, of: 12, positions: [], favorable: [], concerning: [], benchMoves: [{ name: 'Late Stash', position: 'WR', playoffPoints: 30 }], dstStreaming: [], note: 'n', pool: w.pool };
  return { ok: false };
}
let LEAGUE_COUNT = 2, SIGNED_IN = true;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (b, st) => { res.writeHead(st || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (u.pathname === '/api/leagues') return SIGNED_IN ? send(LEAGUES(LEAGUE_COUNT)) : send({ ok: false, error: 'not_signed_in' }, 401);
  const m = u.pathname.match(/^\/api\/leagues\/([a-z0-9-]+)\/advice$/);
  if (m) return send(advice(m[1], u.searchParams.get('module')));
  if (u.pathname === '/api/roster-read') return send({ ok: false, error: 'The reader could not read that.' });
  if (u.pathname.startsWith('/api/')) return send({ ok: false });
  const p = u.pathname === '/' ? '/front.html' : /\.[a-z0-9]+$/.test(u.pathname) ? u.pathname : u.pathname + '.html';
  const fp = path.join(ROOT, p.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route(/googletagmanager|google-analytics|espncdn|nfl\.com|wikimedia/, r => r.abort());
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const visit = async () => {
  await page.goto(BASE + '/my-week', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/Reading your roster/.test(document.getElementById('mwSince').textContent), null, { timeout: 6000 }).catch(() => {});
  return page.evaluate(() => ({
    since: document.getElementById('mwSince').innerText.replace(/\s+/g, ' ').trim(),
    items: [...document.querySelectorAll('#mwSince li')].map(li => li.innerText.replace(/\s+/g, ' ').trim()),
    pick: document.getElementById('mwPick').innerText.replace(/\s+/g, ' ').trim(),
    pickH: document.getElementById('mwPickH').textContent, lineup: document.getElementById('mwLineup').innerText.replace(/\s+/g, ' ').trim(),
    match: document.getElementById('mwMatch').innerText.replace(/\s+/g, ' ').trim(), play: document.getElementById('mwPlay').innerText.replace(/\s+/g, ' ').trim(),
    stale: !!document.querySelector('#mwLineup .mw-meta.stale'), select: [...document.querySelectorAll('#mwSync select option')].map(o => o.textContent),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
};
console.log('\nMy Week in a browser');
{
  let r = await visit();
  ok('two saved leagues: the switcher lists both, the default first', r.select.join(' | ') === 'Office League (default) | Family League', r.select.join(' | '));
  ok('first visit: says it set the baseline, for that league, in this browser', /first visit for Office League in this browser/.test(r.since), r.since);
  ok('and explains where things are kept: this browser for the baseline, the account for the league', /Kept in this browser only/.test(r.since) && /saved to your Iron Tuna account/.test(r.since));
  ok('every pool known: pickups are called available, with ADD', r.pickH === 'Available in your league' && /ADD Waiver Back/.test(r.pick) && !/check availability/i.test(r.pick), r.pick);
  ok('each recommendation carries its scoring, week and freshness', /At PPR · 12 teams · Week 6 · board computed Sat 2:13 PM ET · odds read Sat 7:00 AM ET · league saved 1h ago\./.test(r.lineup), r.lineup);
  ok('a league saved an hour ago is not flagged stale', r.stale === false);
  r = await visit();
  ok('returning with nothing changed: says so, with when', /No material change since your last visit just now/.test(r.since), r.since);
  W['league-aaaa1111'].qb = 15.0; W['league-aaaa1111'].inj = 'Questionable';
  r = await visit();
  ok('returning after news: the injury, then the projection move', r.items.join(' | ') === 'INJURY Josh Allen: now Questionable. | PROJECTION Josh Allen: projection 22.4 to 15.0 (−7.4).', r.items.join(' | '));
  W['league-aaaa1111'].scoring = 'Half PPR · 12 teams'; W['league-aaaa1111'].qb = 13.0;
  r = await visit();
  ok('a changed scoring is said, and its restated points are not called moves', /^SCORING Your scoring changed/.test(r.items[0] || '') && !r.items.some(i => /^PROJECTION/.test(i)), r.items.join(' | '));
  W['league-aaaa1111'].week = 7;
  r = await visit();
  ok('a new week sets a new baseline', /A new week \(Week 7\)/.test(r.since) && r.items.length === 0, r.since);
  // Switch to the league with one roster of ten, saved nine days ago.
  await page.selectOption('#mwSync select', 'league-bbbb2222');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !/Reading your roster/.test(document.getElementById('mwSince').textContent), null, { timeout: 6000 }).catch(() => {});
  r = await page.evaluate(() => ({ since: document.getElementById('mwSince').innerText, pick: document.getElementById('mwPick').innerText.replace(/\s+/g, ' '), pickH: document.getElementById('mwPickH').textContent,
    stale: !!document.querySelector('#mwLineup .mw-meta.stale'), staleText: (document.querySelector('#mwLineup .mw-meta') || {}).innerText || '', play: document.getElementById('mwPlay').innerText }));
  ok('switching leagues keeps a separate baseline per league', /first visit for Family League/.test(r.since), r.since);
  ok('one roster of ten: the card says it cannot tell who is a free agent, and how to fix it', r.pickH === 'Worth checking on your wire' && /has 1 of 10 rosters for this league, so it cannot tell who is a free agent/.test(r.pick) && /Save every roster/.test(r.pick), r.pick);
  ok('and the pickup reads "If available", tagged check availability, never ADD', /If available: Waiver Back/.test(r.pick) && /check availability/.test(r.pick) && !/ADD Waiver Back/.test(r.pick), r.pick);
  ok('the playoff bench moves say the same', /check availability/.test(r.play), r.play);
  ok('a league saved nine days ago is flagged stale beside the advice, with the fix', r.stale && /saved over a week ago/.test(r.staleText) && /update them/.test(r.staleText), r.staleText);
  const fr = await (async () => { await page.goto(BASE + '/', { waitUntil: 'networkidle' }); return page.evaluate(() => ({ shown: !document.getElementById('hmYours').hidden, text: document.getElementById('hmYours').innerText, href: document.querySelector('#hmYours a').getAttribute('href') })); })();
  ok('the homepage now offers the way back, by the league\'s name', fr.shown && /Your week in Family League/.test(fr.text) && fr.href === '/my-week', JSON.stringify(fr));
  // No league on the account any more: the flag clears, the homepage stops offering it.
  LEAGUE_COUNT = 0;
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + '/my-week', { waitUntil: 'networkidle' });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('with no saved league the homepage link goes away', await page.evaluate(() => document.getElementById('hmYours').hidden));
  ok('no sideways scroll on My Week at 390px', (await visit()).overflow <= 1);
}
console.log('\nthe rosters box: a failed read offers the typed path');
{
  LEAGUE_COUNT = 1;
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + '/my-leagues', { waitUntil: 'networkidle' });
  const ta = await page.$('#mlIntake textarea');
  if (ta) {
    await ta.fill('Team A: Josh Allen, Bijan Robinson');
    const btn = await page.$('#mlIntake button:has-text("Read")');
    if (btn) await btn.click();
    await page.waitForTimeout(600);
  }
  const offered = await page.$('#mlGridManual');
  ok('a reader failure offers "Type your roster instead" beside the retry', !!offered, ta ? 'no button' : 'no rosters textarea found');
  if (offered) {
    await offered.click();
    await page.waitForTimeout(200);
    const f = await page.evaluate(() => ({ shown: !document.getElementById('lsManual').hidden, note: (document.querySelector('#lsManual .is-note b') || {}).textContent || '', copy: document.querySelector('#lsManual .is-note').textContent }));
    ok('and it opens the by-hand form, saying what to do', f.shown && /Type your roster below/.test(f.note), JSON.stringify(f));
    ok('whose copy no longer promises everyone off your team is a free agent', /cannot tell who is a free agent/.test(f.copy) && !/the free-agent pool is everyone not on your team/.test(f.copy), f.copy);
  }
}
ok('no page threw', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
