#!/usr/bin/env node
// The Line — the wagering column on /the-line.
//   node tools/test-the-line.mjs
//
// This page is the one surface on the site that puts a number on a BET, and it
// is written by software with no human between the model and the reader. Two
// things therefore have to hold on every deploy, and neither is visible by
// reading the page:
//
//   1. THE PAGE CANNOT CONTRADICT ITSELF. The staking ladder is printed in
//      prose above the board and applied in the script below it. Two statements
//      of the same rule on one page is how a page starts lying, so the ladder is
//      lifted out of BOTH and compared here, along with the 2.0-point floor,
//      which is the worker's own GAP_AGREE and not a number this page invented.
//   2. THE FENCE AND THE NOTICES ARE NOT DECORATION. The Washington geofence
//      lives in _worker.js and cannot be tested by looking at the page; the
//      standing disclosures (no recommendation, AI is not to be relied on,
//      entertainment only, the helpline) are what makes the page publishable at
//      all. Both are asserted here rather than trusted.
//
// The behavioural half runs the page's OWN arithmetic — the real source text is
// lifted out of the-line.html and evaluated — so a staking rule that drifts in
// the script fails here rather than on the reader's screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const page = fs.readFileSync(path.join(ROOT, 'the-line.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

// ── the page is wired into the site like every other section page ───────────
console.log('\nthe page is part of the section');
ok('it carries the generated ribbon', page.includes('<!--ranks:ribbon-->'));
ok('and marks itself current on it', /<a class="rkr-link rkr-item" href="\/the-line" aria-current="page">The Line<\/a>/.test(page));
ok('the ribbon links it from every other page that carries the band',
  fs.readFileSync(path.join(ROOT, 'previews.html'), 'utf8').includes('href="/the-line">The Line</a>'));
ok('it declares its canonical URL', page.includes('<link rel="canonical" href="https://irontuna.com/the-line">'));
ok('it is in the sitemap', fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('<loc>https://irontuna.com/the-line</loc>'));
ok('it reads the market board rather than carrying its own numbers', page.includes("fetch('/api/vegas-edge')"));
ok('and no player, club or price is hard-coded into the page',
  !/\b(?:Mahomes|Allen|Jefferson|Chiefs|Bills)\b/.test(page.replace(/<!--[\s\S]*?-->/g, '')));

// ── the standing disclosures ────────────────────────────────────────────────
// Every one of these is a promise the page makes about what it is. A deploy that
// drops one is not a cosmetic regression.
console.log('\nwhat the page says about itself');
const flat = page.replace(/\s+/g, ' ');
ok('it states that it recommends no wager', /does not recommend any wager/i.test(flat));
ok('it says the stakes are hypothetical and unfunded', /hypothetical, unfunded/i.test(flat));
ok('it says an AI should not be relied on for the decision',
  /AI model should not be relied on for a wagering decision/i.test(flat));
ok('it says the page is for entertainment', /Read this for entertainment/i.test(flat));
ok('it says it is not available in Washington', /Not available in Washington State/i.test(flat));
ok('it carries the current national problem-gambling helpline', /1-800-MY-RESET/.test(flat));
ok('it says confidence is not a win probability', /not a probability of winning/i.test(flat));
ok('it does not call itself a sportsbook or an affiliate of one',
  /is not a sportsbook and is not affiliated with one/i.test(flat));

// ── the ladder is stated once and applied once ──────────────────────────────
console.log('\nthe staking ladder, in prose and in code');
const lifted = page.match(/var LADDER = \[([\s\S]*?)\];/);
const propLift = page.match(/var PROP_LADDER = \[([\s\S]*?)\];/);
ok('the script declares a game ladder', !!lifted);
ok('and a prop ladder', !!propLift);
const rungs = [...(lifted ? lifted[1] : '').matchAll(/at: ([\d.A-Z]+), stake: (\d+), label: '([A-Za-z]+)'/g)]
  .map(m => ({ at: m[1] === 'GAP' ? 2.0 : parseFloat(m[1]), stake: +m[2], label: m[3] }));
ok('the ladder has three paying rungs', rungs.length === 3, JSON.stringify(rungs));
ok('it is ordered from the biggest edge down', rungs.every((r, i) => i === 0 || rungs[i - 1].at > r.at));
ok('the biggest edge stakes exactly the $100 ceiling', rungs[0] && rungs[0].stake === 100, JSON.stringify(rungs[0]));
ok('no rung stakes more than $100', rungs.every(r => r.stake <= 100));
ok('a smaller edge never stakes more than a bigger one', rungs.every((r, i) => i === 0 || rungs[i - 1].stake > r.stake));
// The prose table above the board states the same three rungs. Compare them.
const proseRows = [...page.matchAll(/<tr><td>([^<]*?)<\/td><td>([A-Za-z]+)<\/td><td class="num">(\$\d+|No wager)<\/td><\/tr>/g)]
  .map(m => ({ edge: m[1], label: m[2], stake: m[3] }));
ok('the prose ladder prints four rows (three rungs and the pass)', proseRows.length === 4, JSON.stringify(proseRows));
for (const r of rungs) {
  const row = proseRows.find(p => p.label === r.label);
  ok(`the prose row for a ${r.label.toLowerCase()} edge stakes what the code stakes`,
    !!row && row.stake === '$' + r.stake, JSON.stringify({ code: r, prose: row }));
  ok(`and quotes the same ${r.label.toLowerCase()} threshold`,
    !!row && row.edge.includes(r.at.toFixed(1)), JSON.stringify({ code: r, prose: row }));
}
ok('the last prose row is the pass, and it stakes nothing',
  proseRows[3] && proseRows[3].label === 'Pass' && proseRows[3].stake === 'No wager');
const propRungs = [...(propLift ? propLift[1] : '').matchAll(/at: (\d+), stake: (\d+)/g)].map(m => ({ at: +m[1], stake: +m[2] }));
ok('a prop is never staked as heavily as a game', propRungs.every(p => p.stake < rungs[0].stake), JSON.stringify(propRungs));
ok('and the prose says the same', /\$50 at ten percentage points of disagreement, \$25 at six/.test(flat));

// ── the floor is the site's own, not this page's ────────────────────────────
console.log('\nthe floor under which nothing is bet');
const gapAgree = worker.match(/const GAP_AGREE = ([\d.]+);/);
const pageGap = page.match(/var GAP = ([\d.]+);/);
ok('the worker states an agreement threshold', !!gapAgree);
ok('the page states a floor', !!pageGap);
ok('and they are the same number', gapAgree && pageGap && parseFloat(gapAgree[1]) === parseFloat(pageGap[1]),
  `worker ${gapAgree && gapAgree[1]}, page ${pageGap && pageGap[1]}`);
ok('the prose quotes that floor too', new RegExp('Under ' + parseFloat(pageGap[1]).toFixed(1) + ' points').test(flat));

// ── the Washington fence ────────────────────────────────────────────────────
// The fence is in the worker because static links and direct URLs must not be
// enough to bypass it. The homepage itself is rewritten before it reaches a
// Washington browser, and the dedicated market pages return 451.
console.log('\nthe Washington fence');
const paths = worker.match(/const WA_MARKET_PAGE_PATHS = new Set\(\[([\s\S]*?)\]\);/);
ok('the worker lists the betting-market pages it fences', !!paths);
const fenced = paths ? [...paths[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
for (const p of ['/the-line', '/vegas-edge', '/game-intel', '/player-intel', '/what-they-arent-telling-you', '/hidden-value', '/previews']) {
  ok(`it fences ${p}`, fenced.includes(p), fenced.join(' '));
}
ok('it fences the /in-season market aliases as well',
  fenced.includes('/in-season/the-line') && fenced.includes('/in-season/vegas-edge') && fenced.includes('/in-season/game-intel'));
const fenceStart = worker.indexOf("if (IS_WASHINGTON(request) && WA_MARKET_PAGE_GEOFENCED(url.pathname))");
const fence = worker.slice(fenceStart, worker.indexOf('let __assetReq = request;'));
ok('the fence runs before the asset layer is asked for anything',
  fenceStart >= 0 && fenceStart < worker.indexOf('let __assetReq = request;'));
const waHelper = worker.slice(worker.indexOf('function IS_WASHINGTON(request)'), worker.indexOf('function WA_MARKET_BLOCK()'));
ok('it reads the country as well as the region code, because WA is also Western Australia',
  /country === 'US'/.test(waHelper) && /region === 'WA'/.test(waHelper));
ok('it also accepts the spelled-out region name', /regionName === 'washington'/.test(waHelper));
ok('it answers 451 rather than 404 or a redirect', /status: 451/.test(fence));
ok('the fenced answer is never cached', /'cache-control': 'no-store'/.test(fence));
ok('and it varies on the country, so no shared cache crosses regions', /'vary': 'CF-IPCountry'/.test(fence));
ok('a reader the edge cannot place is not fenced',
  !/country !== 'US'/.test(waHelper) && /country === 'US' &&/.test(waHelper));
const blocked = worker.match(/const WA_MARKET_BLOCKED_HTML = `([\s\S]*?)`;/);
ok('the notice served in Washington says why', blocked && /not available in Washington/i.test(blocked[1]));
ok('and it is not indexable', blocked && /noindex,nofollow/.test(blocked[1]));
ok('it still sends the reader to fantasy football pages', blocked && /href="\/weekly-rankings"/.test(blocked[1]));
ok('the homepage market tab is removed server-side for Washington',
  /function stripWashingtonMarketLane\(html\)/.test(worker) &&
  /id="laneTabMarket"/.test(worker) &&
  /id="laneMarket"/.test(worker) &&
  /stripWashingtonMarketLane\(waHtml\)/.test(worker));
ok('the current market APIs are also fenced in Washington',
  /IS_WASHINGTON\(request\)[\s\S]{0,180}api\/vegas-edge/.test(worker) &&
  /IS_WASHINGTON\(request\)[\s\S]{0,180}api\/signals/.test(worker) &&
  /api\/tuna-market[\s\S]{0,500}tmsCountry === 'US'[\s\S]{0,100}tmsRegion === 'WA'/.test(worker) &&
  /api\/vegas-column[\s\S]{0,120}IS_WASHINGTON\(request\)/.test(worker) &&
  /api\/market'\)[\s\S]{0,120}IS_WASHINGTON\(request\)/.test(worker) &&
  /api\/market\/movement[\s\S]{0,120}IS_WASHINGTON\(request\)/.test(worker) &&
  /api\/player-odds[\s\S]{0,120}IS_WASHINGTON\(request\)/.test(worker));

// ── the page's own arithmetic, run ──────────────────────────────────────────
// The real source, lifted and evaluated. Nothing is paraphrased: a rule that
// changes in the-line.html changes here.
console.log('\nthe arithmetic, run against the page\'s own source');
const s0 = page.indexOf('var GAP = 2.0;');
const s1 = page.indexOf('  function arrowHtml(a)');
ok('the arithmetic block can be lifted out of the page', s0 > 0 && s1 > s0);
const api = new Function(page.slice(s0, s1) +
  '\nreturn { read: read, gameReads: gameReads, props: props, rung: rung, conviction: conviction, amer: amer, open: open,' +
  ' setBoard: function (rows) { td = rows; } };')();

const GAME = (over = {}) => Object.assign({
  id: 'x', game: 'AAA at BBB', home: 'BBB', away: 'AAA', kickoff: Date.now() + 864e5, status: 'upcoming',
  total: 44, spread: 3, impliedHome: 23.5, impliedAway: 20.5,
  ironTunaTotal: 44, ironTunaHome: 23.5, ironTunaAway: 20.5, favourite: 'BBB', movement: null,
}, over);
const readOf = (g, kind) => api.gameReads(g).find(r => r.kind === kind);

ok('a four-point disagreement on the total is a $100 play',
  readOf(GAME({ ironTunaTotal: 48.5 }), 'Total').stake === 100);
ok('and it names the over, because the model is higher',
  /^Over /.test(readOf(GAME({ ironTunaTotal: 48.5 }), 'Total').side));
ok('a model four points UNDER the book names the under',
  /^Under /.test(readOf(GAME({ ironTunaTotal: 39.5 }), 'Total').side));
ok('a three-point disagreement stakes less', readOf(GAME({ ironTunaTotal: 47.2 }), 'Total').stake === 60);
ok('a two-point disagreement stakes less again', readOf(GAME({ ironTunaTotal: 46.4 }), 'Total').stake === 30);
ok('a 1.9-point disagreement is a pass, not a small bet',
  readOf(GAME({ ironTunaTotal: 45.9 }), 'Total').stake === 0 && readOf(GAME({ ironTunaTotal: 45.9 }), 'Total').label === 'Pass');
ok('a pass still states a confidence, so nothing on the board is silent',
  readOf(GAME({ ironTunaTotal: 45.9 }), 'Total').conf > 0);
ok('a fixture the model cannot price reads nothing rather than zero',
  readOf(GAME({ ironTunaTotal: null }), 'Total').label === 'No read' &&
  readOf(GAME({ ironTunaTotal: null }), 'Total').stake === 0);
ok('a game already under way is closed, whatever the edge',
  readOf(GAME({ ironTunaTotal: 52, status: 'in_progress' }), 'Total').label === 'Closed' &&
  readOf(GAME({ ironTunaTotal: 52, status: 'in_progress' }), 'Total').stake === 0);
ok('and so is a game whose kickoff has passed',
  readOf(GAME({ ironTunaTotal: 52, kickoff: Date.now() - 6e5 }), 'Total').stake === 0);
// The feed signs a spread as the home margin, so a model that likes the home
// club by more than the book does has to end up ON the home club.
const homeSide = readOf(GAME({ ironTunaHome: 27, ironTunaAway: 20 }), 'Spread');
ok('a model that likes the home side more than the book backs the home side',
  homeSide.stake === 100 && homeSide.side.indexOf('BBB') === 0, JSON.stringify(homeSide));
const awaySide = readOf(GAME({ ironTunaHome: 21, ironTunaAway: 24 }), 'Spread');
ok('and a model that likes the visitor backs the visitor',
  awaySide.stake === 100 && awaySide.side.indexOf('AAA') === 0, JSON.stringify(awaySide));
ok('the home price is quoted as the negative of the posted home margin',
  homeSide.side.indexOf('−3.0') > 0, homeSide.side);

// Props: only a price a book actually posted may be staked.
const g = GAME();
api.setBoard([
  { name: 'Quoted Player', position: 'RB', team: 'BBB', probability: 40, expectedTds: 0.8, basis: 'anytime-td-market' },
  { name: 'Derived Player', position: 'WR', team: 'AAA', probability: 70, expectedTds: 1.9, basis: 'derived' },
]);
const ps = api.props(g);
ok('a book-quoted prop is read', ps.some(p => p.name === 'Quoted Player'));
ok('a derived number is never read as a prop', !ps.some(p => p.name === 'Derived Player'));
const quoted = ps.find(p => p.name === 'Quoted Player');
ok('the quoted prop is staked when the model is far enough above the price', quoted.stake > 0);
ok('and never above the prop ceiling', quoted.stake <= Math.max(...propRungs.map(p => p.stake)));
ok('the price is printed as the odds the probability came from', /^[+-]\d+$/.test(quoted.price), String(quoted.price));
api.setBoard([{ name: 'Short Price', position: 'TE', team: 'BBB', probability: 60, expectedTds: 0.2, basis: 'anytime-td-market' }]);
const short = api.props(g)[0];
ok('a price the model thinks is too SHORT takes no wager, because the other side is not quoted',
  short.stake === 0 && short.edge < 0, JSON.stringify(short));
ok('but it still states a confidence', short.conf > 0);

// The odds conversion, both sides of even money.
ok('an even-money probability converts to +100 or -100', ['+100', '-100'].includes(api.amer(50)));
ok('a 25% chance is priced +300', api.amer(25) === '+300');
ok('an 80% chance is priced -400', api.amer(80) === '-400');
ok('an impossible probability has no price', api.amer(0) === null && api.amer(100) === null);

// ── the record: the worker files what the page shows ───────────────────────
// The page prices the week live; the worker writes each game's reads down
// before kickoff and settles them on the final. Those are two statements of
// one arithmetic, so the worker's is lifted here and run beside the page's on
// the same fixtures. A rule that drifts in either fails here, not on the
// record.
console.log('\nthe record, filed by the worker in the page\'s own arithmetic');
const w0 = worker.indexOf('const LINE_LADDER = ['), w1 = worker.indexOf('const LINE_LEDGER_DDL');
ok('the worker carries the ledger arithmetic as one block', w0 > 0 && w1 > w0);
const W = new Function('GAP_AGREE', '_oddsNorm', worker.slice(w0, w1) +
  '\nreturn { LINE_LADDER, LINE_PROP_LADDER, LINE_FULL_EDGE, LINE_PROP_FULL, LINE_GAME_PRICE, lineGameReads, lineProps, lineTicket, lineSettle, lineRecordSummary, lineRowNet, lineAmerican, lineLedgerRows };')
  (parseFloat(gapAgree[1]), s => String(s || '').toLowerCase().replace(/[^a-z]/g, ''));
ok('the worker ladder is the page ladder, rung for rung',
  JSON.stringify(W.LINE_LADDER) === JSON.stringify(rungs.map(r => ({ at: r.at, stake: r.stake, label: r.label }))), JSON.stringify(W.LINE_LADDER));
ok('and the prop ladder', JSON.stringify(W.LINE_PROP_LADDER.map(p => ({ at: p.at, stake: p.stake }))) === JSON.stringify(propRungs));
ok('and both conviction scales', page.includes('var FULL_EDGE = ' + W.LINE_FULL_EDGE.toFixed(1)) && page.includes('var PROP_FULL = ' + W.LINE_PROP_FULL + ';'));
ok('the floor it stakes from is the worker\'s own', W.LINE_LADDER[2].at === parseFloat(gapAgree[1]));
const NOW = Date.now();
const cases = [GAME(), GAME({ ironTunaTotal: 48.5 }), GAME({ ironTunaTotal: 39.5 }), GAME({ ironTunaTotal: 47.2 }), GAME({ ironTunaTotal: 46.4 }),
  GAME({ ironTunaTotal: 45.9 }), GAME({ ironTunaTotal: null }), GAME({ ironTunaTotal: 52, status: 'in_progress' }), GAME({ ironTunaTotal: 52, kickoff: NOW - 6e5 }),
  GAME({ ironTunaHome: 27, ironTunaAway: 20 }), GAME({ ironTunaHome: 21, ironTunaAway: 24 }), GAME({ ironTunaHome: 27, ironTunaAway: 20, ironTunaTotal: 50 }),
  GAME({ spread: -2.5, ironTunaHome: 19, ironTunaAway: 26 }), GAME({ spread: 0, ironTunaHome: 24, ironTunaAway: 20 }), GAME({ total: 41.5, ironTunaTotal: 43.5 })];
{
  let same = true, detail = '';
  for (const c of cases) {
    const p = api.gameReads(c).map(r => [r.kind, r.label, r.stake, r.side, r.edge, r.conf]);
    const w = W.lineGameReads(c, NOW).map(r => [r.kind, r.label, r.stake, r.side, r.edge, r.conf]);
    if (JSON.stringify(p) !== JSON.stringify(w)) { same = false; detail = JSON.stringify({ page: p, worker: w }); break; }
  }
  ok('every read the page makes, the worker makes identically: kind, label, stake, side, edge and conviction', same, detail);
  const board = [
    { key: 'quotedplayer|RB', name: 'Quoted Player', position: 'RB', team: 'BBB', probability: 40, expectedTds: 0.8, basis: 'anytime-td-market' },
    { key: 'derivedplayer|WR', name: 'Derived Player', position: 'WR', team: 'AAA', probability: 70, expectedTds: 1.9, basis: 'derived' },
    { key: 'shortprice|TE', name: 'Short Price', position: 'TE', team: 'BBB', probability: 60, expectedTds: 0.2, basis: 'anytime-td-market' },
    { key: 'elsewhere|WR', name: 'Elsewhere', position: 'WR', team: 'ZZZ', probability: 30, expectedTds: 0.9, basis: 'anytime-td-market' }
  ];
  api.setBoard(board);
  const pp = api.props(GAME()).map(p => [p.name, p.label, p.stake, p.edge, p.price, p.conf]);
  const wp = W.lineProps(GAME(), board, NOW).map(p => [p.name, p.label, p.stake, p.edge, p.price, p.conf]);
  ok('and every prop read too: name, label, stake, edge, price and conviction', JSON.stringify(pp) === JSON.stringify(wp), JSON.stringify({ page: pp, worker: wp }));
  ok('a prop row is filed under the player\'s key, which is what the stat file is indexed by', W.lineProps(GAME(), board, NOW).find(p => p.name === 'Quoted Player').market === 'td:quotedplayer|RB');
  // One stake per game: the larger edge gets the money, the other is stated.
  const both = W.lineTicket(GAME({ ironTunaHome: 30, ironTunaAway: 20, ironTunaTotal: 50 }), [], NOW);
  ok('where both markets clear the floor only the larger edge is staked', both.best && both.best.kind === 'Spread' && both.reads.filter(r => r.stake).length === 1);
  ok('and the other read is kept on the record as stated, not staked', both.reads.find(r => r.kind === 'Total').yielded === true && both.reads.find(r => r.kind === 'Total').stake === 0);
  const filed = W.lineLedgerRows(2026, 1, { ...GAME({ ironTunaTotal: 48.5 }), id: '2026_01_AAA_BBB' }, board, NOW);
  ok('a game files its two reads and its quoted props, and nothing derived', filed.length === 4 && filed.every(r => r.game_id === '2026_01_AAA_BBB') && !filed.some(r => /derived/.test(r.market)));
  ok('the filed total is the staked play and the filed spread is the pass', filed[0].market === 'total' && filed[0].stake === 100 && filed[1].market === 'spread' && filed[1].stake === 0 && filed[1].label === 'Pass');
}

console.log('\nsettling the record');
{
  const row = over => Object.assign({ market: 'total', pick: 'over', line: 44, week: 1, stake: 30 }, over);
  ok('an over wins when the final beats the posted total', W.lineSettle(row(), { homeScore: 24, awayScore: 21 }).outcome === 'win');
  ok('and loses when it does not', W.lineSettle(row(), { homeScore: 20, awayScore: 21 }).outcome === 'loss');
  ok('an under wins on that same final', W.lineSettle(row({ pick: 'under' }), { homeScore: 20, awayScore: 21 }).outcome === 'win');
  ok('a final on the number is a push', W.lineSettle(row(), { homeScore: 24, awayScore: 20 }).outcome === 'push');
  ok('the home side covers when the home margin beats the posted home margin', W.lineSettle(row({ market: 'spread', pick: 'home', line: 3 }), { home: 'BBB', homeScore: 27, awayScore: 20 }).outcome === 'win');
  ok('and does not cover on a win by less', W.lineSettle(row({ market: 'spread', pick: 'home', line: 3 }), { home: 'BBB', homeScore: 22, awayScore: 20 }).outcome === 'loss');
  ok('a visitor getting points covers a narrow loss', W.lineSettle(row({ market: 'spread', pick: 'away', line: 3 }), { home: 'BBB', homeScore: 22, awayScore: 20 }).outcome === 'win');
  ok('a favoured visitor must win by more than the number', W.lineSettle(row({ market: 'spread', pick: 'away', line: -3 }), { home: 'BBB', homeScore: 17, awayScore: 24 }).outcome === 'win' &&
    W.lineSettle(row({ market: 'spread', pick: 'away', line: -3 }), { home: 'BBB', homeScore: 21, awayScore: 23 }).outcome === 'loss');
  ok('a spread landing on the number is a push', W.lineSettle(row({ market: 'spread', pick: 'home', line: 3 }), { home: 'BBB', homeScore: 23, awayScore: 20 }).outcome === 'push');
  ok('a game without a final is left pending, never guessed', W.lineSettle(row(), null) === null && W.lineSettle(row(), { homeScore: null, awayScore: 21 }) === null);
  ok('a postponed game voids the stake', W.lineSettle(row(), { voided: 'postponed' }).outcome === 'void');
  const td = { market: 'td:quotedplayer|RB', player_key: 'quotedplayer|RB', week: 1, stake: 25, price: '+150' };
  ok('a quoted touchdown prop wins when the player scored', W.lineSettle(td, null, { throughWeek: 1, players: { 'quotedplayer|RB': { latest: { week: 1, stats: { rushTD: 1 } } } } }).outcome === 'win');
  ok('and loses when he played and did not', W.lineSettle(td, null, { throughWeek: 1, players: { 'quotedplayer|RB': { latest: { week: 1, stats: { recYd: 40 } } } } }).outcome === 'loss');
  ok('is void when the week\'s file is in and he has no line in it', W.lineSettle(td, null, { throughWeek: 1, players: {} }).outcome === 'void');
  ok('and pending while the week\'s file is not in', W.lineSettle(td, null, { throughWeek: 0, players: {} }) === null && W.lineSettle(td, null, null) === null);
  const rows = [
    { market: 'total', stake: 100, outcome: 'win', edge: 4 }, { market: 'spread', stake: 60, outcome: 'loss', edge: 3 },
    { market: 'total', stake: 30, outcome: 'push', edge: 2 }, { market: 'td:x', stake: 25, outcome: 'win', price: '+300', edge: 7 },
    { market: 'total', stake: 0, outcome: 'win', edge: 1 }, { market: 'spread', stake: 0, outcome: 'loss', edge: -1.5 },
    { market: 'total', stake: 30, outcome: null, edge: 2 }, { market: 'spread', stake: 0, outcome: 'win', edge: 0 }
  ];
  const s = W.lineRecordSummary(rows);
  ok('the record counts only staked rows as wagers', s.wagers === 5 && s.wins === 2 && s.losses === 1 && s.pushes === 1 && s.pending === 1 && s.staked === 245, JSON.stringify(s));
  ok('a game market settles at −110 and a prop at its quoted price', Math.abs(s.net - (100 * 100 / 110 - 60 + 25 * 3)) < 0.01, String(s.net));
  ok('a pass with a direction is graded as a lean, and a read with no direction is not', s.leans.right === 1 && s.leans.wrong === 1);
  ok('the page prints the same settlement price the worker uses', W.LINE_GAME_PRICE === -110 && /settled at a hypothetical &minus;110/.test(flat));
}

// ── the job, end to end against a fake D1 ─────────────────────────────────
// The real functions, with the schedule, the edge payload and the stat file
// stubbed and the database faked on the exact statements the job writes. A
// bind that does not match its column list, or a settle that rewrites a row,
// fails here.
console.log('\nthe job, filing and settling');
{
  const j0 = worker.indexOf('const LINE_LEDGER_DDL'), j1 = worker.indexOf('// The edge payload, built fresh.');
  ok('the job can be lifted as one block', j0 > 0 && j1 > j0);
  const T = [];
  const stmt = (sql, db) => ({ bind: (...b) => ({ sql, b, run: async () => run(sql, b), all: async () => all(sql, b), first: async () => (await all(sql, b)).results[0] || null }),
                               run: async () => run(sql, []), all: async () => all(sql, []) });
  const run = async (sql, b) => {
    if (/^CREATE TABLE/.test(sql)) return { success: true };
    if (/^INSERT OR IGNORE INTO line_ledger/.test(sql)) {
      const cols = sql.match(/\(([^)]+)\) VALUES/)[1].split(', ');
      if (cols.length !== b.length) throw new Error('bind count ' + b.length + ' for ' + cols.length + ' columns');
      const row = Object.fromEntries(cols.map((c, i) => [c, b[i]]));
      if (!T.some(r => r.season === row.season && r.week === row.week && r.game_id === row.game_id && r.market === row.market)) T.push({ ...row, outcome: null, note: null, graded_at: null });
      return { success: true };
    }
    if (/^UPDATE line_ledger SET outcome/.test(sql)) {
      const r = T.find(x => x.season === b[3] && x.week === b[4] && x.game_id === b[5] && x.market === b[6]);
      if (r) { r.outcome = b[0]; r.note = b[1]; r.graded_at = b[2]; }
      return { success: true };
    }
    throw new Error('unexpected write: ' + sql.slice(0, 60));
  };
  const all = async (sql, b) => {
    if (/SELECT DISTINCT game_id/.test(sql)) return { results: T.filter(r => r.season === b[0] && r.week === b[1]).map(r => ({ game_id: r.game_id })) };
    if (/WHERE outcome IS NULL AND season = \?/.test(sql)) return { results: T.filter(r => r.outcome == null && r.season === b[0]) };
    if (/^SELECT \* FROM line_ledger WHERE season = \?/.test(sql)) return { results: T.filter(r => r.season === b[0]) };
    throw new Error('unexpected read: ' + sql.slice(0, 60));
  };
  const db = { prepare: sql => stmt(sql), batch: async st => { for (const s of st) await s.run(); return []; } };
  const KICK = Date.UTC(2026, 8, 13, 17, 0);
  const sched = { season: 2026, games: [
    { id: 'g1', type: 'REG', week: 1, kickoff: KICK, home: 'BBB', away: 'AAA', homeScore: null, awayScore: null, status: null },
    { id: 'g2', type: 'REG', week: 1, kickoff: KICK, home: 'DDD', away: 'CCC', homeScore: null, awayScore: null, status: null },
    { id: 'g3', type: 'REG', week: 1, kickoff: KICK + 3 * 3600000, home: 'FFF', away: 'EEE', homeScore: null, awayScore: null, status: null }
  ] };
  const edge = { gameEnvironments: [
    { id: 'g1', game: 'AAA at BBB', home: 'BBB', away: 'AAA', kickoff: KICK, status: 'upcoming', total: 44, spread: 3, impliedHome: 23.5, impliedAway: 20.5, ironTunaTotal: 48.5, ironTunaHome: 26, ironTunaAway: 22.5 },
    { id: 'g2', game: 'CCC at DDD', home: 'DDD', away: 'CCC', kickoff: KICK, status: 'upcoming', total: 40, spread: -2.5, impliedHome: 18.75, impliedAway: 21.25, ironTunaTotal: 40.5, ironTunaHome: 17, ironTunaAway: 23.5 },
    { id: 'g3', game: 'EEE at FFF', home: 'FFF', away: 'EEE', kickoff: KICK + 3 * 3600000, status: 'upcoming', total: 50, spread: 0, ironTunaTotal: 55, ironTunaHome: 27.5, ironTunaAway: 27.5 }
  ], tdBoard: [{ key: 'quotedplayer|RB', name: 'Quoted Player', position: 'RB', team: 'BBB', probability: 40, expectedTds: 0.8, basis: 'anytime-td-market' }] };
  let usage = null;
  const H = new Function('GAP_AGREE', '_oddsNorm', 'BOARD_FREEZE_LEAD_MS', 'scheduleCacheRead', 'nflSeasonState', 'weekGames', 'vegasEdgeBuild', 'usageCacheRead', 'seasonGameStatus',
    worker.slice(w0, w1) + worker.slice(j0, j1) + '\nreturn { runLineLedger, lineRecordPayload };')(
    parseFloat(gapAgree[1]), s => String(s || '').toLowerCase().replace(/[^a-z]/g, ''), 2 * 3600000,
    async () => sched, () => ({ ok: true, week: { type: 'REG', number: 1 } }), (sc, week, now) => sc.games.filter(g => g.week === week),
    async () => edge, async () => usage,
    (g, now) => g.status === 'final' ? { status: 'completed' } : now < g.kickoff ? { status: 'upcoming' } : { status: 'in_progress' });
  const env = { LEADS_DB: db };
  const early = await H.runLineLedger(env, { now: KICK - 3 * 3600000 });
  ok('three hours out nothing is filed', early.ok && early.filed === 0 && T.length === 0, JSON.stringify(early));
  const filed = await H.runLineLedger(env, { now: KICK - 90 * 60000 });
  ok('ninety minutes out the two imminent games are filed and the later one is not', filed.filed === 5 && filed.games.join() === 'AAA@BBB,CCC@DDD' && !T.some(r => r.game_id === 'g3'), JSON.stringify(filed));
  ok('the staked total, the pass on the spread, and the quoted prop are on the record for the first game',
    T.filter(r => r.game_id === 'g1').map(r => r.market + ':' + r.stake).join() === 'total:100,spread:0,td:quotedplayer|RB:50', JSON.stringify(T.map(r => r.market + ':' + r.stake)));
  const again = await H.runLineLedger(env, { now: KICK - 60 * 60000 });
  ok('a second tick inside the window files nothing twice', again.filed === 0 && T.length === 5);
  const live = await H.runLineLedger(env, { now: KICK + 3600000 });
  ok('nothing settles while the games are under way, and the later game is filed once it is inside the window', live.graded === 0 && live.filed === 2 && live.pending === 7 && T.every(r => r.outcome == null), JSON.stringify(live));
  sched.games[0].status = 'final'; sched.games[0].homeScore = 27; sched.games[0].awayScore = 24;    // 51 points, BBB by 3: over wins, spread pushes
  sched.games[1].status = 'final'; sched.games[1].homeScore = 17; sched.games[1].awayScore = 20;    // 37 points, CCC by 3
  const done = await H.runLineLedger(env, { now: KICK + 4 * 3600000 });
  const by = m => T.find(r => r.market === m && r.game_id === 'g1');
  ok('the finals settle the game markets: the over wins, the spread pushes, the prop waits for the stat file',
    done.graded === 4 && by('total').outcome === 'win' && by('spread').outcome === 'push' && by('td:quotedplayer|RB').outcome == null, JSON.stringify(T.map(r => r.market + '=' + r.outcome)));
  ok('the pass on the second game is settled as a lean, and the second game\'s spread read is on the record',
    T.find(r => r.game_id === 'g2' && r.market === 'total').outcome === 'loss' && T.find(r => r.game_id === 'g2' && r.market === 'spread').outcome === 'win', JSON.stringify(T.filter(r => r.game_id === 'g2')));
  usage = { throughWeek: 1, players: { 'quotedplayer|RB': { latest: { week: 1, stats: { rushTD: 2 } } } } };
  await H.runLineLedger(env, { now: KICK + 2 * 86400000 });
  ok('the prop settles once the week\'s stat file is in', by('td:quotedplayer|RB').outcome === 'win');
  ok('a settled row is never settled again', (await H.runLineLedger(env, { now: KICK + 3 * 86400000 })).graded === 0);
  const rec = await H.lineRecordPayload(env, 2026);
  ok('the record payload sums the stakes: four wagers, three won and the unplayed game pending, filed at the window',
    rec.ok && rec.summary.wagers === 4 && rec.summary.wins === 3 && rec.summary.losses === 0 && rec.summary.pending === 1 && rec.summary.staked === 350 && rec.filedWithin === 2 * 3600000, JSON.stringify(rec.summary));
  ok('net is the two game wins at −110 plus the prop at its quoted +150', Math.abs(rec.summary.net - (2 * 100 * 100 / 110 + 50 * 1.5)) < 0.01, String(rec.summary.net));
  ok('and the passes are on the record as leans: the pushed spread, the wrong total, and no lean at all for a read with no direction', rec.summary.leans.right === 0 && rec.summary.leans.wrong === 1 && rec.summary.leans.push === 1 && rec.summary.leans.pending === 0, JSON.stringify(rec.summary.leans));
  ok('one week is summarised on its own', rec.weeks.length === 1 && rec.weeks[0].week === 1 && rec.weeks[0].wagers === 4);
}

console.log('\nthe record is wired in');
ok('the ledger is a scheduled job', /'line-ledger':\s*env => runLineLedger\(env\)/.test(worker) && /job: 'line-ledger'/.test(worker));
ok('it files inside the same window that freezes the week board', /g\.kickoff - now <= BOARD_FREEZE_LEAD_MS/.test(worker.slice(worker.indexOf('async function runLineLedger'))));
ok('the record API is fenced in Washington like the board', /api\/the-line\/record'\)[\s\S]{0,120}IS_WASHINGTON\(request\)/.test(worker));
ok('the page reads the record and never writes it', page.includes("fetch('/api/the-line/record')") && !/method:\s*'POST'/.test(page));
ok('the prose says every stake goes on the record, and how it settles', /Every stake goes on the record/.test(flat) && /nothing filed is ever revised/.test(flat));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
