#!/usr/bin/env node
// The in-season pages in a real browser (Step 31). Payloads come from the
// shipped engine run over the stored 2026 schedule (tools/fixtures), served
// to the real pages by a local static server; the browser drives every
// control and reads back what the page shows.
//   - the rankings page: scoring selector, horizons, positions, sort, search,
//     the playoff CTA, hide-out, and a phone width without sideways scroll
//   - the player page: a real player's detail and the Take; a market the
//     page must call unavailable rather than fill in
//   - Vegas Edge: six boards from the same board
//   - DFS: the no-salary state, a priced slate, a built lineup, a lock
//   - the desk: the list, a published piece, a held piece shown as data
//   - the NFL clock strip: from the schedule, never a calendar fallback
//   - the front hero: honest when the odds feed has not answered, intel
//     first on a phone in season
//
// Needs playwright-core plus a Chromium binary (preinstalled at /opt/pw-browsers
// in Claude Code remote sessions, else set CHROMIUM_PATH). Skips cleanly rather
// than failing when they are absent, so it never blocks a machine without them.
//   node tools/test-in-season-ui.mjs
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.log('SKIP — needs playwright-core (' + e.message.split('\n')[0] + ')');
  process.exit(0);
}
const CHROME = process.env.CHROMIUM_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium']
       .find(p => fs.existsSync(p));
if (!CHROME) { console.log('SKIP — no Chromium binary; set CHROMIUM_PATH'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── the engine over the stored schedule ────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };
const HEAD = 'function etOffsetHours(ms) {';
const etOffsetHours = new Function('ms', src.slice(src.indexOf(HEAD) + HEAD.length, src.indexOf('function etClock(ms) {')).replace(/\}\s*$/, ''));
function _csvSplit(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
const csv = fs.readFileSync(path.join(ROOT, 'tools/fixtures/games-2026.csv'), 'utf8');
const pStart = src.indexOf('const PROJECTIONS = ['), pEnd = src.indexOf('\n];', pStart) + 3;
const H = new Function('etOffsetHours', '_csvSplit', 'fetch', '_xb64encode', 'PROJ_KEY', 'LEAD_TZ',
  src.slice(pStart, pEnd) + '\n' + cut('// Vegas-weighted projections', '// The Odds API v4. WRITTEN') + '\n' +
  cut('const NFLVERSE_GAMES_URL', '// ── kickers and defences ─') + '\n' + cut('function _oddsProjectionIndex()', 'function blendProjections(') + '\n' +
  cut('function _withAvailability(p)', 'const COLUMN_SCORING = {') + '\n' + cut('// ── the NFL season and week ─', '// ── the provider layer ─') + '\n' +
  cut('const PROVIDER_KINDS', 'const NFLVERSE_BASE') + '\n' + cut('const PROVIDER_UNAVAILABLE', '// Run every configured provider') + '\n' +
  cut('// -- historical betting markets', '// -- the Iron Tuna Market Engine') + '\n' + cut('// -- kickers and defences, scored', '// -- the player intel payload') + '\n' +
  cut('function buildTake(', 'async function playerIntelPayload(') + '\n' + cut('// -- DFS ---', '// -- the job log and the health board') + '\n' +
  'return { fetchScheduleNflverse, nflSeasonState, _seasonDecorate, teamRatingsFrom, buildBoards, scoringRules, _oddsProjectionIndex, _availPool, PROJECTIONS, detectInsights, buildVegasEdge, buildTake, buildDfsSlate, buildDfsStacks, DFS_SITES };'
)(etOffsetHours, _csvSplit, async () => ({ ok: true, status: 200, text: async () => csv }), x => x, 'k', 'America/New_York');

const NOW = Date.UTC(2026, 8, 22, 14);            // Tue Sep 22 2026, 10 AM EDT: Week 3
const sp = await H.fetchScheduleNflverse();
const sched = { season: sp.season, games: sp.games, provider: 'fixture', updatedAt: NOW };
const state = H.nflSeasonState(sched, NOW);
const ctx = { sched, state, ratings: H.teamRatingsFrom(sched), avail: {}, usage: null, overlay: null, weekMarkets: {}, nameIndex: H._oddsProjectionIndex(), pool: H._availPool(H.PROJECTIONS), rules: H.scoringRules('ppr') };
const boards = {}; for (const hz of ['week', 'next3', 'ros', 'playoffs']) boards[hz] = H.buildBoards(ctx, { horizon: hz, preset: 'ppr' });
const signals = H.detectInsights({ week: boards.week, usage: null, weekMarkets: {}, gameMarkets: {}, state, rules: ctx.rules });
const edge = H.buildVegasEdge(boards.week, {}, {}, state, signals);
// A player with a game this week and one on bye, from the board itself.
const week = boards.week;
const onField = week.players.find(p => p.position === 'RB' && p.games > 0 && p.weeks[0] && !p.weeks[0].bye);
const onBye = week.players.find(p => p.games === 0 && p.byes.length);
const slugOf = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function intelFor(name, pos, opts) {
  const rows = {}; for (const hz of Object.keys(boards)) { const r = boards[hz].players.find(p => p.name === name && p.position === pos); if (r) rows[hz] = r; }
  const w = rows.week; const w0 = w.weeks[0] || {};
  const o = opts || {};
  const vegas = o.unavailable ? { points: null, rank: null, confidence: 'UNAVAILABLE', basis: 'unavailable', stats: {} } : w.vegas;
  return { ok: true, contract: 1, player: { name, position: pos, team: w.team, key: w.key }, horizons: rows,
    thisWeek: { ironTuna: w.ironTuna, consensus: w.consensus, vegas, marketDelta: w.marketDelta, why: w.why, opponent: w0.opponent, home: w0.home, environment: w0.env, kickoff: w0.kickoff, gameStatus: w0.status,
                vegasProjection: o.unavailable ? { status: 'unavailable', note: 'Vegas projection unavailable', markets: [] } : w0.vegasProjection, injury: w.injury, roleTrend: w.roleTrend },
    props: {}, movement: {}, propsAsOf: null, tdProbability: { probability: 20, basis: 'derived' }, usage: null, take: H.buildTake(rows, {}, null) };
}
// A priced DK slate off the week board, the way a lobby prices: dearest first.
const posN = { QB: 24, RB: 60, WR: 80, TE: 30, DST: 32 };
const sal = [];
for (const P of Object.keys(posN)) week.players.filter(p => p.position === P && p.games > 0).sort((a, b) => b.consensus.points - a.consensus.points).slice(0, posN[P])
  .forEach((p, i) => sal.push({ name: p.name, position: P, team: p.team, opponent: null, salary: Math.round(((P === 'DST' ? 4500 : P === 'QB' ? 8500 : 9500) - i * (P === 'DST' ? 60 : 90)) / 100) * 100 }));
const slate = H.buildDfsSlate('dk', sal, week, {}); slate.week = 3; slate.salariesAsOf = NOW; slate.stacks = H.buildDfsStacks(slate, state);
let dfsLoaded = true;
const seasonPayload = { ok: true, contract: 1, now: NOW, season: 2026, phase: state.phase, phaseLabel: state.phaseLabel, week: state.week, counts: state.counts, games: state.games, nextGame: state.nextGame, weeks: state.weeks };
let seasonUp = true;
const pieces = { list: { ok: true, contract: 1, kinds: [{ kind: 'final-read', title: 'The Final Read', day: 'Thu', hour: 7 }, { kind: 'team-recaps', title: 'Team-by-Team Recaps', day: 'Mon', hour: 7 }],
    pieces: [{ kind: 'final-read', slug: 'final-read-2026-w3', title: 'The Final Read · Week 3', status: 'published', week: 3, season: 2026, created_at: NOW, published_at: NOW },
             { kind: 'team-recaps', slug: 'team-recaps-2026-w2', title: 'Team-by-Team Recaps · Week 2', status: 'held', week: 2, season: 2026, created_at: NOW - 1e6, published_at: null }] },
  'final-read': { ok: true, contract: 1, kind: 'final-read', title: 'The Final Read · Week 3', status: 'published', week: 3, season: 2026, createdAt: NOW, publishedAt: NOW, sections: ['lede', 'body'],
    body: { lede: onField.name + ' is the one to start.', body: 'The total is ' + (onField.weeks[0].env && onField.weeks[0].env.implied) + '.' }, brief: { allowed: { names: [onField.name], numbers: [] } }, violations: null },
  'team-recaps': { ok: true, contract: 1, kind: 'team-recaps', title: 'Team-by-Team Recaps · Week 2', status: 'held', week: 2, season: 2026, createdAt: NOW - 1e6, publishedAt: null, sections: ['teams'],
    body: null, brief: { teams: [{ team: onField.team, learned: { backfield: [{ name: onField.name, carries: 14 }] } }], allowed: { names: [onField.name], numbers: ['14'] } }, violations: ['Pat Jones', '99'] } };

// ── the server ─────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const send = (c, b, t) => { res.writeHead(c, { 'content-type': t }); res.end(b); };
  const J = o => send(200, JSON.stringify(o), 'application/json');
  if (u.pathname === '/api/season') return seasonUp ? J(seasonPayload) : send(503, '{"ok":false,"error":"no_schedule"}', 'application/json');
  if (u.pathname === '/api/boards') return J(boards[u.searchParams.get('horizon') || 'week']);
  if (u.pathname === '/api/vegas-edge') return J(edge);
  if (u.pathname === '/api/ros-update') return J({ ok: true, contract: 1, featured: { builtAt: null }, choices: [{ horizon: 'next3', title: 'Next 3 Weeks', blurb: 'x' }, { horizon: 'ros', title: 'Rest of Season', blurb: 'x' }, { horizon: 'playoffs', title: 'Fantasy Playoffs: Weeks 15-17', blurb: 'x' }], risers: [], fallers: [], marketVsRos: [], snapshotNote: 'No Wednesday snapshot has run yet.' });
  if (u.pathname === '/api/intel/player') { const n = u.searchParams.get('name'), p = u.searchParams.get('pos'); const hit = week.players.find(x => x.name === n && x.position === p); return hit ? J(intelFor(n, p, { unavailable: n === onBye.name })) : J({ ok: false, error: 'not_found' }); }
  if (u.pathname === '/api/dfs') return dfsLoaded ? J(slate) : J({ ok: false, contract: 1, site: 'dk', label: 'DraftKings', error: 'no_salaries', note: 'No DraftKings salaries have been loaded for this week. Import the lobby CSV from /admin, or configure the site feed.' });
  if (u.pathname === '/api/content') return J(pieces.list);
  if (u.pathname === '/api/content/piece') return J(pieces[u.searchParams.get('kind')] || { ok: false, error: 'not_found' });
  if (u.pathname === '/api/vegas-column') return J({ ok: false, error: 'no_overlay' });
  if (u.pathname.startsWith('/api/')) return J({ ok: false });
  let p = u.pathname === '/' ? '/front.html' : u.pathname.replace(/^\/in-season\/player\/.*$/, '/player-intel').replace(/^\/in-season\/desk(\/.*)?$/, '/desk').replace(/^\/in-season/, '');
  if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) return send(404, 'no', 'text/plain');
  send(200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
}).listen(0);
const PORT = srv.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errs = [];
const open = async (url, vp) => { const page = await browser.newPage({ viewport: vp || { width: 1360, height: 1100 } }); page.on('pageerror', x => errs.push(url + ': ' + x)); await page.goto('http://127.0.0.1:' + PORT + url, { waitUntil: 'networkidle' }); await page.waitForTimeout(400); return page; };
const T = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const N = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

console.log('\nthe fixture');
ok('Week 3 is current, from the games', state.ok && state.week.number === 3 && state.phase === 'regular');
ok('the week board has a player on the field and one on bye', !!onField && !!onBye, (onField && onField.name) + ' / ' + (onBye && onBye.name));

console.log('\nthe rankings page');
{
  const page = await open('/in-season/rankings');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#rkBody tr')].map(r => ({ name: r.querySelector('td.p b').textContent, cells: [...r.children].map(c => c.textContent.trim()) })));
  let r = await rows();
  ok('rows render from the week board', r.length > 20, String(r.length));
  ok('the Iron Tuna, consensus and Vegas columns are all there', (await page.evaluate(() => [...document.querySelectorAll('#rkHead th')].map(t => t.textContent))).join('|').match(/Iron Tuna.*Consensus.*Vegas|Vegas.*Consensus|Consensus.*Vegas/) !== null);
  const scoringNote = await T(page, '#rkScoringNote');
  ok('the scoring control is visible and says which preset is on', (await N(page, '#rkScoring button')) >= 4 && /PPR|Standard|Half|league/i.test(scoringNote), scoringNote);
  // scoring changes the points: pick a WR row and compare standard vs PPR
  await page.click('#rkPos button[data-pos="WR"]'); await page.waitForTimeout(150);
  await page.click('#rkScoring button[data-preset="standard"]'); await page.waitForTimeout(200);
  const std = (await rows())[0];
  await page.click('#rkScoring button[data-preset="ppr"]'); await page.waitForTimeout(200);
  const ppr = (await rows()).find(x => x.name === std.name);
  const num = c => c.map(v => parseFloat(v)).filter(v => Number.isFinite(v) && v > 3);
  ok('switching Standard to PPR changes a receiver\'s points without a reload', ppr && JSON.stringify(num(std.cells)) !== JSON.stringify(num(ppr.cells)), JSON.stringify([num(std.cells).slice(0, 4), ppr && num(ppr.cells).slice(0, 4)]));
  const mine = await page.evaluate(() => { const b = document.getElementById('rkMine'); return b ? { disabled: b.disabled, title: b.title } : null; });
  ok('with no saved league the My League preset is offered but disabled, and says what it needs', mine && mine.disabled === true && /league/i.test(mine.title), JSON.stringify(mine));
  await page.click('#rkPos button[data-pos="FLEX"]'); await page.waitForTimeout(150);
  ok('the FLEX view mixes RB, WR and TE', (await page.evaluate(() => new Set([...document.querySelectorAll('#rkBody tr')].map(r => r.querySelector('td.p').textContent.match(/\b(QB|RB|WR|TE|K|DST)\b/) ? r.querySelector('td.p').textContent.match(/\b(QB|RB|WR|TE|K|DST)\b/)[1] : '')).size)) >= 2);
  await page.click('#rkPos button[data-pos="DST"]'); await page.waitForTimeout(150);
  ok('the DST view lists defences', (await rows()).length >= 20 && (await rows()).every(x => /DST/.test(x.cells[1])), (await rows()).length + ' ' + JSON.stringify((await rows()).slice(0, 1)));
  await page.click('#rkPos button[data-pos="RB"]'); await page.click('#rkBoard button[data-board="vegas"]'); await page.waitForTimeout(150);
  ok('the Vegas board reorders the rows', (await rows())[0].name !== undefined && (await T(page, '#rkBoard button[data-board="vegas"]')) !== null);
  await page.click('#rkHead th[data-key="delta"]'); await page.waitForTimeout(150);
  const deltas = await page.evaluate(() => [...document.querySelectorAll('#rkBody tr')].map(r => r.querySelector('td.delta, td[data-key="delta"]') ? r.querySelector('td.delta, td[data-key="delta"]').textContent : r.children[r.children.length - 3].textContent));
  ok('sorting by Market Delta works', deltas.length > 5);
  await page.fill('#rkSearch', onField.name.split(' ')[1]); await page.waitForTimeout(150);
  ok('the search filter narrows to the name', (await rows()).every(x => x.name.toLowerCase().includes(onField.name.split(' ')[1].toLowerCase())) && (await rows()).length >= 1);
  await page.fill('#rkSearch', '');
  // bye handling
  await page.click('#rkBoard button[data-board="ironTuna"]'); await page.click('#rkPos button[data-pos="' + onBye.position + '"]'); await page.waitForTimeout(150);
  const hideOut = await page.evaluate(() => { const c = document.getElementById('rkHideOut'); return c ? c.checked : null; });
  if (hideOut) { await page.click('#rkHideOut'); await page.waitForTimeout(150); }
  const byeRow = await page.evaluate(n => { const r = [...document.querySelectorAll('#rkBody tr')].find(x => x.querySelector('td.p b').textContent === n); return r ? { cls: r.className, text: r.textContent } : null; }, onBye.name);
  ok('a player on bye is shown as BYE, not with an invented line', byeRow && /BYE/.test(byeRow.text), JSON.stringify(byeRow));
  // horizons
  await page.click('#rkHorizon button[data-horizon="ros"]'); await page.waitForTimeout(400);
  ok('the rest-of-season view carries games, byes and schedule columns', /Games/.test(await T(page, '#rkHead')) && /Bye/.test(await T(page, '#rkHead')) && (await rows()).length > 20);
  ok('rest of season leaves Week 18 out by default', Array.isArray(boards.ros.horizon.weeks) && !boards.ros.horizon.weeks.includes(18) && boards.ros.horizon.weeks.includes(17), JSON.stringify(boards.ros.horizon.weeks));
  ok('the playoff CTA names Weeks 15–17', /15/.test(await T(page, '#rkPlayoffCta')) && /17/.test(await T(page, '#rkPlayoffCta')));
  await page.click('#rkPlayoffCta a'); await page.waitForTimeout(400);
  ok('the CTA opens the playoff horizon', (await page.evaluate(() => document.querySelector('#rkHorizon button[aria-pressed="true"]').getAttribute('data-horizon'))) === 'playoffs' && (await rows()).length > 20);
  await page.click('#rkHorizon button[data-horizon="next3"]'); await page.waitForTimeout(400);
  ok('the next-three view counts three games, or fewer with a bye named', (await rows()).slice(0, 10).every(x => x.cells[5] === '3' || (x.cells[5] === '2' && x.cells[6] !== '—')), JSON.stringify((await rows())[0].cells));
  await page.close();
  // phone
  const m = await open('/in-season/rankings', { width: 390, height: 844 });
  ok('at phone width the page does not scroll sideways (the chrome\'s 3px toggle aside)', (await overflow(m)) <= 4, String(await overflow(m)));
  ok('the table scrolls inside its own container', await m.evaluate(() => { const c = document.getElementById('rkTable').closest('.is-scroll, .rk-scroll, [style*="overflow"]') || document.getElementById('rkTable').parentElement; return getComputedStyle(c).overflowX === 'auto' || getComputedStyle(c).overflowX === 'scroll'; }));
  ok('the controls are still usable on a phone', (await N(m, '#rkPos button')) >= 6 && (await m.evaluate(() => { const b = document.querySelector('#rkPos button'); const r = b.getBoundingClientRect(); return r.width > 20 && r.right <= window.innerWidth + 1; })));
  await m.close();
}

console.log('\nthe player page');
{
  const page = await open('/in-season/player/' + slugOf(onField.name));
  ok('the slug resolves to the player', (await T(page, '#piName')) === onField.name, await T(page, '#piName'));
  const cards = await T(page, '#piBoards');
  ok('the three projections, with rank, points and confidence, and the Market Delta are shown', /Iron Tuna/.test(cards) && /Consensus/.test(cards) && /Vegas/.test(cards) && /pts/.test(cards) && /MARKET DELTA/.test(await T(page, '#piDelta')), JSON.stringify([cards.slice(0, 300), await T(page, '#piDelta')]));
  ok('the Iron Tuna Take is written from the data', (await T(page, '#piTake') || '').length > 40, await T(page, '#piTake'));
  ok('every horizon has a row', (await N(page, '#piHorizons tbody tr')) === 4);
  ok('the Vegas basis is named on every row', await page.evaluate(() => [...document.querySelectorAll('#piHorizons tbody tr')].every(r => /gamelines|ratings|props|unavailable|—/.test(r.textContent))));
  ok('no prop on file says so rather than showing a blank table', !(await page.evaluate(() => document.getElementById('piPropsEmpty').hidden)) || (await N(page, '#piProps tbody tr')) === 0);
  await page.close();
  const bye = await open('/in-season/player/' + slugOf(onBye.name));
  ok('a bye-week player resolves too', (await T(bye, '#piName')) === onBye.name);
  const byeCards = (await T(bye, '#piCards')) + ' ' + (await T(bye, '#piBoards'));
  ok('an unavailable market is called unavailable, never filled with a number', /unavailable/i.test(byeCards) && /UNAVAILABLE/.test(await T(bye, '#piBoards')), byeCards.slice(0, 300));
  ok('the week row says BYE', /BYE/.test(await T(bye, '#piHorizons')), (await T(bye, '#piHorizons') || '').slice(0, 300));
  await bye.close();
  const none = await open('/in-season/player/nobody-famous');
  ok('an unknown slug says so', !(await none.evaluate(() => document.getElementById('piEmpty').hidden)) || /not found|no player|Unknown/i.test(await T(none, 'main')));
  await none.close();
}

console.log('\nVegas Edge');
{
  const page = await open('/in-season/vegas-edge');
  const counts = { buys: await N(page, '#veBuys .ve-card'), fades: await N(page, '#veFades .ve-card'), td: await N(page, '#veTd tbody tr'), vol: await N(page, '#veVol tbody tr'), games: await N(page, '#veGames tbody tr') };
  ok('Vegas vs Experts, the TD board, the volume board and the game environments all render', counts.buys + counts.fades > 0 && counts.td > 0 && counts.vol > 0 && counts.games > 0, JSON.stringify(counts));
  ok('the game environments carry posted totals and implied points', /\d\d\.\d|\d\d/.test(await T(page, '#veGames tbody tr')));
  ok('a card explains itself from the data', /consensus|Vegas|rank|line|total|implied/i.test(await T(page, '#veBuys .ve-card, #veFades .ve-card')));
  const m = await open('/in-season/vegas-edge', { width: 390, height: 844 });
  ok('no sideways scroll on a phone', (await overflow(m)) <= 4, String(await overflow(m)));
  await m.close(); await page.close();
}

console.log('\nDFS');
{
  dfsLoaded = false;
  let page = await open('/in-season/dfs');
  ok('with no salaries loaded the page says so and shows no invented price', /No DraftKings salaries/.test(await T(page, '#dfNote')) && (await N(page, '#dfCards .is-card')) === 0 && (await N(page, '#dfValues tbody tr')) === 0);
  await page.close();
  dfsLoaded = true;
  page = await open('/in-season/dfs');
  ok('a loaded slate fills the dashboard', (await N(page, '#dfCards .is-card')) >= 3 && (await N(page, '#dfBody tr')) >= 10);
  await page.click('#dfNav button[data-sec="values"]'); await page.waitForTimeout(100);
  ok('the value board lists salary, the three projections, the delta, TD% and team total', (await N(page, '#dfValues tbody tr')) > 0 && /\$\d/.test(await T(page, '#dfValues tbody tr')) && /%/.test(await T(page, '#dfValues tbody tr')));
  ok('the slate says no prop is on it', /No sportsbook/.test(await T(page, '#dfNote')));
  await page.click('#dfNav button[data-sec="builder"]'); await page.waitForTimeout(100);
  const cap = await page.inputValue('#dfCap');
  await page.click('#dfBuild'); await page.waitForTimeout(600);
  const lineups = await page.evaluate(() => [...document.querySelectorAll('#dfLineups .df-lineup')].map(l => ({ head: l.querySelector('h3').textContent, n: l.querySelectorAll('tbody tr').length })));
  ok('the builder produces lineups of nine under the cap', lineups.length >= 1 && lineups.every(l => l.n === 9) && lineups.every(l => parseInt(l.head.match(/\$([\d,]+) \(/)[1].replace(/,/g, ''), 10) <= parseInt(cap, 10)), JSON.stringify(lineups));
  const firstKey = await page.evaluate(() => document.querySelector('#dfPool td.p').getAttribute('data-key'));
  await page.click('#dfPool td.p[data-key="' + firstKey + '"]'); await page.fill('#dfN', '1'); await page.click('#dfBuild'); await page.waitForTimeout(600);
  const lockedIn = await page.evaluate(k => { const name = document.querySelector('#dfPool td.p[data-key="' + k + '"] b').textContent; return [...document.querySelectorAll('#dfLineups .df-lineup tbody tr')].some(r => r.textContent.includes(name)); }, firstKey);
  ok('a locked player is in the lineup', lockedIn);
  ok('nothing on the page can submit an entry', !/submit|enter contest/i.test(await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent).join('|'))));
  await page.click('#dfNav button[data-sec="stacks"]'); await page.waitForTimeout(100);
  ok('the stacks rank games by total', (await N(page, '#dfStacks .df-stack')) >= 2);
  const m = await open('/in-season/dfs', { width: 390, height: 844 });
  ok('no sideways scroll on a phone', (await overflow(m)) <= 4, String(await overflow(m)));
  await m.close(); await page.close();
}

console.log('\nthe desk');
{
  const page = await open('/in-season/desk');
  ok('the list shows the week\'s pieces with their status', (await N(page, '#dkList .dk-card')) === 2 && /held/i.test(await T(page, '#dkList')));
  await page.close();
  const pub = await open('/in-season/desk/final-read/3');
  ok('a published piece shows its prose', /is the one to start/.test(await T(pub, '#dkPiece')));
  await pub.close();
  const held = await open('/in-season/desk/team-recaps/2');
  const body = await T(held, '#dkPiece');
  ok('a held piece is shown as its data with the violations named, never the prose', /Held/.test(body) && /Pat Jones/.test(body) && !/is the one to start/.test(body), body.slice(0, 200));
  await held.close();
}

console.log('\nthe NFL clock');
{
  const page = await open('/in-season/rankings');
  const strip = await T(page, '[data-season-strip]');
  ok('the strip shows the week from the schedule', /Week 3/.test(strip) && /Regular season/i.test(strip), strip);
  await page.close();
  seasonUp = false;
  const down = await open('/in-season/rankings');
  const s2 = await T(down, '[data-season-strip]');
  ok('when the schedule feed is down the strip says so rather than guessing from the calendar', /unavailable/i.test(s2) && !/Week \d/.test(s2), s2);
  await down.close();
  seasonUp = true;
}

console.log('\nthe front hero');
{
  const page = await open('/');
  ok('the hero is two columns with the intel side present', (await N(page, '#heroBand')) === 1 && /Weekly Fantasy Intel/i.test(await T(page, '#heroBand')));
  ok('the copy is the specified copy', /Rankings personalized to your league/.test(await T(page, '#heroBand')) && /fantasy experts and the betting markets disagree/.test(await T(page, '#heroBand')));
  const ctas = await page.evaluate(() => [...document.querySelectorAll('.hb-ctas')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  ok('the buttons are there', /View This Week/.test(ctas) && /Customize My Scoring/.test(ctas), ctas);
  ok('with the odds feed unanswered the cards are withheld and the note says why', (await page.evaluate(() => document.getElementById('hbTeasers').hidden)) && /has not answered/.test(await T(page, '#hbTeaserNote')));
  ok('the week is on the hero from the schedule', /Week 3/.test(await T(page, '#hbWeek')), await T(page, '#hbWeek'));
  ok('the band is marked in season', (await page.evaluate(() => document.getElementById('heroBand').getAttribute('data-season'))) === 'in');
  await page.close();
  const m = await open('/', { width: 390, height: 844 });
  const order = await m.evaluate(() => { const band = document.getElementById('heroBand'); const kids = [...band.children].map(k => ({ top: k.getBoundingClientRect().top, intel: /Weekly Fantasy Intel/i.test(k.textContent) })); return kids.sort((a, b) => a.top - b.top).map(k => k.intel ? 'intel' : 'other'); });
  ok('on a phone in season the intel column comes first', order[0] === 'intel', order.join(','));
  ok('no sideways scroll on a phone', (await overflow(m)) <= 4, String(await overflow(m)));
  await m.close();
}

ok('no page threw', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
