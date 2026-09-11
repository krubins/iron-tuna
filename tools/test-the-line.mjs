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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
