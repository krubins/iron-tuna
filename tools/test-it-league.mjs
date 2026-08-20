#!/usr/bin/env node
// Tests for /it-league.js — the reader's own league, applied to every page that
// prints a number.
//   node tools/test-it-league.mjs
//
// The failure this file exists to catch is silent DRIFT. it-league.js carries a
// hand-synced copy of the client's scoring, its market curve and the site's
// default league, exactly as _worker.js does for the Vegas column. If the app
// changes one of those and this copy is left behind, the front page starts
// quoting readers dollars their own cheat sheet disagrees with — which is worse
// than not personalising at all. The first block lifts all three copies out of
// their real files and fails loudly when they diverge.
//
// The rest runs the REAL it-league.js in a stub DOM against a stub league, so
// the maths, the copy and the declarative rewrites are exercised as shipped.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const lib = fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');

// ── a browser, in as much as this file needs one ───────────────────────────
function makeWindow(store) {
  const nodes = [];
  const mkEl = (tag) => {
    const el = {
      tagName: tag, id: '', className: '', textContent: '', innerHTML: '',
      attrs: {}, children: [], parentNode: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      insertBefore(c) { c.parentNode = this; this.children.push(c); return c; },
      querySelector() { return null; },
      closest() { return null; }
    };
    nodes.push(el);
    return el;
  };
  const head = mkEl('head');
  const doc = {
    readyState: 'complete',
    head,
    createElement: mkEl,
    getElementById: id => nodes.find(n => n.id === id) || null,
    querySelectorAll: () => [],
    addEventListener() {},
    _nodes: nodes
  };
  return { localStorage: { getItem: k => (k in store ? store[k] : null) }, document: doc };
}
function load(store) {
  const w = makeWindow(store);
  new Function('window', lib + '\n;return window.ITLeague;')(w);
  return { L: w.ITLeague, w };
}

const DEFAULT_STATS = { passYd: 4200, passTD: 30, passInt: 10, rushYd: 400, rushTD: 4, fumLost: 2 };
const CATCHER = { rushYd: 100, rushTD: 1, rec: 90, recYd: 1200, recTD: 8, fumLost: 1 };

// ── 1. the hand-synced copies still agree with the app ─────────────────────
console.log('\nhand-sync with index.html');
{
  const { L } = load({});
  const cfgSeg = client.slice(client.indexOf('const DEFAULT_LEAGUE_CONFIG'), client.indexOf('function yardageScore'));
  const num = k => {
    const m = cfgSeg.match(new RegExp('\\b' + k + ':\\s*(-?[\\d.]+)'));
    return m ? parseFloat(m[1]) : null;
  };
  for (const k of Object.keys(L.defaults.scoring)) {
    ok(`scoring.${k} matches the client`, num(k) === L.defaults.scoring[k],
       `library ${L.defaults.scoring[k]} vs client ${num(k)}`);
  }
  const curveSeg = client.slice(client.indexOf('const LEAGUE_MARKET_CURVE'), client.indexOf('function calculateMarketValues'));
  for (const pos of Object.keys(L.defaults.curve)) {
    const m = curveSeg.match(new RegExp('\\b' + pos + ':\\s*\\[([^\\]]*)\\]'));
    const arr = m ? m[1].split(',').map(x => parseInt(x.trim(), 10)) : null;
    ok(`${pos} price curve matches the client`, !!arr && JSON.stringify(arr) === JSON.stringify(L.defaults.curve[pos]));
  }
  const cb = client.match(/LEAGUE_CURVE_BUDGET\s*=\s*(\d+)/);
  ok('curve budget matches the client', cb && +cb[1] === L.defaults.curveBudget);
  ok('default league matches the client',
     num('teams') === L.defaults.teams && num('budget') === L.defaults.budget,
     `library ${L.defaults.teams}x$${L.defaults.budget}`);
}

// ── 2. the scoring port is faithful, not just similar ──────────────────────
// The client's own scoreSkillPlayer is lifted and run head-to-head against the
// library's copy over every real projection in the worker's pool.
console.log('\nscoring port matches the client function');
{
  const { L } = load({});
  const grab = name => {
    const i = client.indexOf('function ' + name);
    if (i < 0) return '';
    return client.slice(i, client.indexOf('\n}', i) + 2);
  };
  const clientScore = new Function(`
    ${grab('yardageScore')}
    ${grab('countScore')}
    ${grab('scoreSkillPlayer')}
    return scoreSkillPlayer;
  `)();
  const cfg = { scoring: { ...L.defaults.scoring, passingYardBonuses: [], rushingYardBonuses: [],
                           receivingYardBonuses: [], receptionBonuses: [], rbReceptionBonuses: [] } };
  const pool = (() => {
    const st = worker.indexOf('const PROJECTIONS = [');
    const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
    const seg = worker.slice(st, worker.indexOf('\n];', st));
    const out = []; let m;
    while ((m = re.exec(seg))) {
      const stats = {};
      for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
      out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
    }
    return out;
  })();
  ok('the worker pool parsed', pool.length > 100, String(pool.length));
  let worst = 0, worstOf = '';
  for (const p of pool) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue;
    const d = Math.abs(clientScore(p.projectedStats, p.position, cfg) - L.score(p.projectedStats, p.position));
    if (d > worst) { worst = d; worstOf = p.name; }
  }
  ok('every real player scores identically in both copies', worst < 1e-9, `worst ${worst} on ${worstOf}`);
}

// ── 3. no saved league means nothing is personalised ───────────────────────
// A reader who has never opened the app must be shown the page's own numbers.
console.log('\nno league saved');
{
  const { L } = load({});
  ok('reports no league', L.has === false && L.hasBoard === false && L.custom === false);
  ok('tailors nothing', L.tailor('+10% to +20% versus price', 'Somebody Real', 'WR') === '');
  ok('leaves editorial dollars alone', L.money(200) === 200);
  ok('still scores at the site defaults', Math.abs(L.score(DEFAULT_STATS, 'QB') - (4200 / 25 + 30 * 4 - 10 * 2 + 40 + 24 - 4)) < 1e-9);
  ok('prices at the default league', L.price('RB', 0) === Math.round(43 * (12 * 200 / 1440)));
}

// ── 4. the reader's scoring moves the points ───────────────────────────────
console.log('\ncustom scoring');
{
  const half = { scoring: { receptionPoints: 0.5, rbReceptionPoints: 0.5, passingTD: 6 } };
  const { L } = load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'auction', ...half } }) });
  ok('a saved league is found', L.has === true);
  ok('custom scoring is flagged', L.customScoring === true);
  ok('an unchanged budget is not flagged as a custom league', L.customLeague === false);
  const full = load({}).L;
  ok('half-PPR scores a receiver 45 points lower',
     Math.abs((full.score(CATCHER, 'WR') - L.score(CATCHER, 'WR')) - 45) < 1e-9,
     `${full.score(CATCHER, 'WR')} vs ${L.score(CATCHER, 'WR')}`);
  ok('six-point passing TDs raise a passer by 60',
     Math.abs((L.score(DEFAULT_STATS, 'QB') - full.score(DEFAULT_STATS, 'QB')) - 60) < 1e-9);
  ok('unspecified scoring falls back to the site default, never to zero',
     L.config.scoring.rushingYardsPerPoint === 10 && L.config.scoring.fumbleLost === -2);
  ok('the scoring label reads back what was entered', L.scoringLabel() === 'half-PPR, 6-point passing TDs', L.scoringLabel());
}

// ── 5. the reader's budget moves the money ─────────────────────────────────
console.log('\ncustom budget');
{
  const { L } = load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 300, format: 'auction' } }) });
  ok('a different budget is a custom league', L.customLeague === true && L.custom === true);
  ok('scoring is untouched', L.customScoring === false);
  ok('the top RB costs 1.5x the default league', L.price('RB', 0) === Math.round(43 * (12 * 300 / 1440)));
  ok('editorial dollars follow the budget, not the pool', L.money(200) === 300 && L.money(40) === 60);
  ok('the league label carries the budget', L.label() === 'your 12-team, $300 auction', L.label());

  // Team count is the pool, not the wallet: more teams means more money chasing
  // the same players (prices rise), but one manager's $200 is still $200.
  const ten = load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 10, budget: 200, format: 'auction' } }) }).L;
  ok('a 10-team league prices players below a 12-team one', ten.price('WR', 0) < load({}).L.price('WR', 0));
  ok('...but does not shrink the manager’s own budget', ten.money(200) === 200);
  ok('the floor never goes below a dollar', ten.price('TE', 9999) >= 1);
}

// ── 6. the saved board carries the ranks and the tailored copy ─────────────
console.log('\nthe reader’s own board');
{
  const board = {
    ts: 1, teams: 10, budget: 300, format: 'auction',
    players: [
      { n: 'Alpha Wideout', pos: 'WR', v: 60, pts: 300 },
      { n: 'Bravo Wideout', pos: 'WR', v: 48, pts: 280 },
      { n: 'Charlie Wideout', pos: 'WR', v: 30, pts: 260 },
      { n: 'Kenneth Walker III', pos: 'RB', v: 22, pts: 210 },
      { n: 'Delta Walker', pos: 'RB', v: 9, pts: 150 },
      { n: 'Zulu Runner', pos: 'RB', v: 5, pts: 100 }
    ]
  };
  const store = {
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 10, budget: 300, format: 'auction' } }),
    iron_tuna_values_v1: JSON.stringify(board)
  };
  const { L } = load(store);
  ok('the board is found', L.hasBoard === true);
  ok('a points total ranks against the board', L.rankOf('WR', 290) === 2 && L.rankOf('WR', 1000) === 1 && L.rankOf('WR', 1) === 4);
  ok('an unknown position ranks nothing rather than guessing', L.rankOf('QB', 200) === null);
  ok('an exact name resolves', L.findPlayer('Bravo Wideout', 'WR').v === 48);
  ok('a semicolon-separated name field is tried entry by entry',
     L.findPlayer('The Ravens; Bravo Wideout; Somebody Else', 'WR').v === 48);
  ok('a bare surname resolves when only one player carries it at that position',
     L.findPlayer('Runner', 'RB').pts === 100);
  ok('an ambiguous surname resolves to nobody rather than to a coin flip',
     L.findPlayer('Walker', 'RB') === null && L.findPlayer('Wideout', 'WR') === null);
  ok('a suffix does not swallow the surname', L.findPlayer('Kenneth Walker III', 'RB').pts === 210);
  ok('a name is read out of a headline',
     L.playerInText('Charlie Wideout is a reputation trap in round two', 'WR').v === 30);
  ok('a headline naming nobody on the board resolves to nobody',
     L.playerInText('The Ravens lost hidden support structure on offense', 'RB') === null);
  ok('the wrong position never matches', L.playerInText('Alpha Wideout breaks out', 'RB') === null);

  const line = L.tailor('+10% to +20% versus price', 'Bravo Wideout is underpriced', 'WR');
  ok('an auction reader is told the dollars, in their league',
     line === 'Bravo Wideout is $48 on your sheet — worth about $5–$10 more in your 10-team, $300 auction.', line);
  const down = L.tailor('-10% versus price', 'Bravo Wideout', 'WR');
  ok('a negative effect trims rather than adds', /trim about \$5 off/.test(down), down);
  ok('a qualitative effect is never given a number',
     L.tailor('slight efficiency drag on the offense', 'Bravo Wideout', 'WR') === '');
  ok('a player the board does not know is never invented',
     L.tailor('+10% to +20% versus price', 'Nobody At All', 'WR') === '');

  const snake = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 10, budget: 200, format: 'snake' } }),
    iron_tuna_values_v1: JSON.stringify(board)
  }).L;
  const moved = snake.tailor('-40% versus price', 'Alpha Wideout', 'WR');
  ok('a snake reader is told slots, not dollars', /Move Alpha Wideout down \d+ slots/.test(moved), moved);
  ok('a format override re-reads the same call',
     /\$/.test(snake.tailor('+10% to +20% versus price', 'Bravo Wideout', 'WR', 'auction')));
}

// ── 7. the declarative rewrites ────────────────────────────────────────────
console.log('\ndeclarative markup');
{
  const { L, w } = load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 10, budget: 300, format: 'auction' } }) });
  const el = (attr, val, text) => {
    const e = w.document.createElement('span');
    e.setAttribute(attr, val); e.textContent = text;
    e.parentNode = { insertBefore: () => {} };
    return e;
  };
  const money = el('data-it-money', '200', '$200');
  const teams = el('data-it-teams', '12', '12');
  const league = el('data-it-league', '', 'a 12-team league');
  const pct = el('data-it-pct', '38-42', '38 to 42 percent');
  const inserted = [];
  pct.parentNode = { insertBefore: (c) => inserted.push(c) };
  const scope = { querySelectorAll: sel => sel === '[data-it-money]' ? [money]
    : sel === '[data-it-teams]' ? [teams] : sel === '[data-it-league]' ? [league]
    : sel === '[data-it-pct]' ? [pct] : [] };
  L.applyMarkup(scope);
  ok('a budget figure is restated', money.textContent === '$300', money.textContent);
  ok('a team count is restated', teams.textContent === '10');
  ok('a league phrase is restated', league.textContent === 'your 10-team, $300 auction', league.textContent);
  ok('an allocation band gains the reader’s dollars',
     inserted.length === 1 && inserted[0].textContent === ' ($114–$126)', JSON.stringify(inserted.map(x => x.textContent)));
  ok('a second pass does not double up', (L.applyMarkup(scope), inserted.length === 1));

  const none = load({}).L;
  const untouched = el('data-it-money', '200', '$200');
  none.applyMarkup({ querySelectorAll: sel => sel === '[data-it-money]' ? [untouched] : [] });
  ok('with no league the printed default stands', untouched.textContent === '$200');
}

// ── 8. the pages and the worker agree on the wire contract ─────────────────
// The column's payload is publicly cached; the client only renders items whose
// shape it recognises. If the worker adds a field and the page asks for the old
// contract, readers get an empty column until the cache expires.
console.log('\nwire contract');
{
  const wc = worker.match(/const COLUMN_CONTRACT = (\d+)/);
  const fc = front.match(/var VS_CONTRACT = (\d+)/);
  ok('front.html asks for the contract the worker serves', wc && fc && wc[1] === fc[1],
     `worker ${wc && wc[1]} vs front ${fc && fc[1]}`);
  ok('the worker ships the consensus stat line', /statsConsensus: _colStatLine/.test(worker));
  ok('the worker ships the odds-blended stat line', /statsIronTuna: _colStatLine/.test(worker));
  ok('the worker ships the raw-market stat line', /statsMarket: _colStatLine/.test(worker));
  ok('the front page re-scores those lines', /L\.score\(it\.statsConsensus, pos\)/.test(front));
  ok('every page that prints a story number loads the library',
     ['front.html', 'my-insights.html', 'insights-vault.html', 'auction-insights-2026-08-27.html',
      'snake-insights-2026-09-03.html', 'bestball-insights-2026-07-04.html', 'auction-budget-allocation.html']
       .every(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('/it-league.js')));
}

// ── 9. end to end: the shipped stat lines reproduce the printed numbers ────
// The whole personalisation rests on one claim — that points are a pure
// function of a stat line and a scoring system, so a page holding the stat line
// can rebuild the number the server printed. This proves it on the REAL column,
// built by the REAL worker, off the real projection pool: at the site's own
// settings the library must land on the server's points and the server's price,
// to the digit. If it cannot reproduce the default, it has no business
// reproducing a custom one.
console.log('\nend to end: the library rebuilds the worker’s own numbers');
{
  const START = '// Vegas-weighted projections';
  const a = worker.indexOf(START), b = worker.indexOf('export default {', a);
  const section = worker.slice(a, b);
  const pool = (() => {
    const st = worker.indexOf('const PROJECTIONS = [');
    const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
    const seg = worker.slice(st, worker.indexOf('\n];', st));
    const out = []; let m;
    while ((m = re.exec(seg))) {
      const stats = {};
      for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
      out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
    }
    return out;
  })();
  const W = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
    let _PROJ_ENC = null;
    ${section}
    return { buildVegasColumn, _oddsNorm };
  `)(pool, () => 'ENC', 'k', async () => { throw new Error('no network'); });

  // A synthetic overlay big enough to move real players on both boards.
  const overlay = {};
  const sample = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) sample.push(...pool.filter(p => p.position === pos).slice(0, 20));
  sample.forEach((p, i) => {
    const st = p.projectedStats, bump = i % 2 ? 1.25 : 0.78;
    const o = {};
    for (const k of ['passYd', 'passTD', 'rushYd', 'rushTD', 'recYd', 'recTD', 'rec']) {
      if (st[k] != null) o[k] = Math.round(st[k] * bump * 10) / 10;
    }
    if (Object.keys(o).length) overlay[W._oddsNorm(p.name) + '|' + p.position] = o;
  });
  const built = W.buildVegasColumn(overlay, null);
  ok('the column built for this test', built.ok && built.items.length > 3, JSON.stringify(built).slice(0, 120));

  const { L } = load({});
  const r1 = n => Math.round(n * 10) / 10;
  let ptsBad = null, priceBad = null, missing = null;
  for (const it of built.items) {
    if (!it.statsConsensus || !it.statsIronTuna || !it.statsMarket) { missing = it.name; break; }
    if (r1(L.score(it.statsConsensus, it.position)) !== it.ptsConsensus) { ptsBad = `${it.name} consensus ${r1(L.score(it.statsConsensus, it.position))} vs ${it.ptsConsensus}`; break; }
    if (r1(L.score(it.statsIronTuna, it.position)) !== it.ptsIronTuna) { ptsBad = `${it.name} iron tuna ${r1(L.score(it.statsIronTuna, it.position))} vs ${it.ptsIronTuna}`; break; }
    if (L.price(it.position, it.rankConsensus - 1) !== it.priceConsensus ||
        L.price(it.position, it.rankIronTuna - 1) !== it.priceIronTuna) { priceBad = it.name; break; }
  }
  ok('every item carries all three stat lines', missing === null, missing || '');
  ok('re-scoring the stat lines reproduces the printed points', ptsBad === null, ptsBad || '');
  ok('the curve reproduces the printed prices', priceBad === null, priceBad || '');

  // And now the point of the exercise: the same case in a $300 half-PPR league.
  const mine = load({ iron_tuna_draft_state_v2: JSON.stringify({
    config: { teams: 12, budget: 300, format: 'auction',
              scoring: { receptionPoints: 0.5, rbReceptionPoints: 0.5 } } }) }).L;
  const catcher = built.items.find(i => (i.statsIronTuna.rec || 0) > 0);
  ok('a pass-catching case is available', !!catcher, built.items.map(i => i.position).join(','));
  if (catcher) {
    ok('half-PPR drops a pass-catcher’s points',
       mine.score(catcher.statsIronTuna, catcher.position) < L.score(catcher.statsIronTuna, catcher.position));
    ok('a $300 budget raises the price at the same slot',
       mine.price(catcher.position, catcher.rankIronTuna - 1) > L.price(catcher.position, catcher.rankIronTuna - 1));
  }
}

// ── 10. front.html's own myCase, run as shipped ────────────────────────────
console.log('\nfront.html myCase');
{
  const i = front.indexOf('  function myCase(it) {');
  const j = front.indexOf('\n  }', i);
  ok('myCase was found in front.html', i > 0 && j > i);
  const myCase = new Function('window', front.slice(i, j + 4) + '\n;return myCase;')({ ITLeague: null });
  ok('no library, no personalisation', myCase({ position: 'WR' }) === null);

  const board = { ts: 1, teams: 12, budget: 400, format: 'auction', players: [
    { n: 'Top Wideout', pos: 'WR', v: 70, pts: 320 },
    { n: 'Case Wideout', pos: 'WR', v: 40, pts: 250 },
    { n: 'Third Wideout', pos: 'WR', v: 20, pts: 200 }
  ]};
  const store = {
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 400, format: 'auction' } }),
    iron_tuna_values_v1: JSON.stringify(board)
  };
  const withLeague = new Function('window', front.slice(i, j + 4) + '\n;return myCase;')({ ITLeague: load(store).L });
  const item = {
    name: 'Case Wideout', position: 'WR', rankConsensus: 9, rankIronTuna: 4, rankMarket: 3,
    statsConsensus: { rec: 70, recYd: 900, recTD: 5 },
    statsIronTuna: { rec: 80, recYd: 1000, recTD: 6 },
    statsMarket: { rec: 90, recYd: 1100, recTD: 7 }
  };
  const m = withLeague(item);
  ok('the case is re-read on the reader’s board', m && m.board === true, JSON.stringify(m));
  ok('the odds-adjusted points come back as the board’s own number', m && m.ptsIronTuna === 250, m && String(m.ptsIronTuna));
  ok('the consensus line is scaled onto the same board', m && m.ptsConsensus < m.ptsIronTuna && m.ptsConsensus > 0, m && String(m.ptsConsensus));
  ok('the player keeps his own slot on his own board', m && m.rankIronTuna === 2, m && String(m.rankIronTuna));
  ok('the weaker consensus line ranks no higher', m && m.rankConsensus >= m.rankIronTuna, m && `${m.rankConsensus} vs ${m.rankIronTuna}`);
  ok('the gap is stated in the reader’s dollars', m && m.priceDelta === m.priceIronTuna - m.priceConsensus && m.priceIronTuna > 0);
  ok('a $400 budget prices above the default league', m && m.priceIronTuna > load({}).L.price('WR', m.rankIronTuna - 1));

  // An item the worker could not describe is dropped, not half-rendered.
  ok('a stat-line-less item is refused', withLeague({ name: 'Case Wideout', position: 'WR' }) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
