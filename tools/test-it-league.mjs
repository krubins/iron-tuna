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
import * as board from './build-default-board.mjs';
import { BLOCKS, cut } from './preview-copy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
// The "n% of a budget" reading out of a tailored line, for comparing two
// leagues' slices of the same call.
const pctOf = (line) => (String(line).match(/(\d+(?:\u2013\d+)?%|under 1%) of a budget/) || [])[1] || '';
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
  return {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    document: doc
  };
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
  ok('prices at the default league', L.price('RB', 0) === Math.round(48 * (12 * 200 / 1440)));
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
  ok('the top RB costs 1.5x the default league', L.price('RB', 0) === Math.round(48 * (12 * 300 / 1440)));
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
    ts: 1, sv: 2, teams: 10, budget: 300, format: 'auction',
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
  const one = snake.tailor('-8% versus price', 'Alpha Wideout', 'WR');
  ok('one slot is a slot, not "1 slots"', / up 1 slot | down 1 slot /.test(one), one);
  ok('a format override re-reads the same call',
     /\$/.test(snake.tailor('+10% to +20% versus price', 'Bravo Wideout', 'WR', 'auction')));
}

// ── 6b. the reading format: which currency a tailored line is written in ───
// A call is worth dollars to an auction reader and draft slots to a snake one,
// and the page must never guess. The saved league answers it; auction is the
// answer when nothing is saved; and the reader's own switch outranks both and
// survives to the next page they open.
console.log('\nthe reading format');
{
  const board = {
    ts: 1, sv: 2, teams: 10, budget: 300, format: 'auction',
    players: [
      { n: 'Alpha Wideout', pos: 'WR', v: 60, pts: 300 },
      { n: 'Bravo Wideout', pos: 'WR', v: 48, pts: 280 },
      { n: 'Charlie Wideout', pos: 'WR', v: 30, pts: 260 }
    ]
  };
  const boardJSON = JSON.stringify(board);
  const league = (format, teams = 10, budget = 300) =>
    JSON.stringify({ config: { teams, budget, format } });

  ok('no saved league reads as an auction', load({}).L.readingFormat() === 'auction');
  ok('a saved auction reads as an auction',
     load({ iron_tuna_draft_state_v2: league('auction') }).L.readingFormat() === 'auction');
  ok('a saved snake reads as a snake',
     load({ iron_tuna_draft_state_v2: league('snake') }).L.readingFormat() === 'snake');
  ok('best ball is a draft, so it reads in slots',
     load({ iron_tuna_draft_state_v2: league('bestball') }).L.readingFormat() === 'snake');
  ok('the league is what set it, not the reader',
     load({ iron_tuna_draft_state_v2: league('snake') }).L.formatFromLeague() === true &&
     load({}).L.formatFromLeague() === false);

  // The switch: a snake league, read as an auction because the reader said so.
  const store = { iron_tuna_draft_state_v2: league('snake'), iron_tuna_values_v1: boardJSON };
  const { L } = load(store);
  ok('the switch starts on the saved league', L.readingFormat() === 'snake');
  ok('the switch reports the format it took', L.setReadingFormat('auction') === 'auction');
  ok('the reader’s choice outranks the saved league', L.readingFormat() === 'auction');
  ok('a tailored line follows the switch',
     /\$/.test(L.tailor('+10% to +20% versus price', 'Bravo Wideout', 'WR', L.readingFormat())));
  ok('an unrecognised format is refused rather than taken',
     L.setReadingFormat('cricket') === 'auction' && L.readingFormat() === 'auction');
  ok('the choice is written where the next page will find it',
     store.iron_tuna_reading_format_v1 === 'auction');
  ok('the next page opens on that choice, not on the saved league',
     load(store).L.readingFormat() === 'auction');
  ok('a reader-set format is not reported as the league’s',
     load(store).L.formatFromLeague() === false);
  ok('switching back leaves the saved league free to speak again',
     (() => { const n = load(store); n.L.setReadingFormat('snake'); return n.L.readingFormat() === 'snake'; })());

  // ── the edition ──
  // Three values where the lens has two, because best ball has its own pages
  // and its own room even though it reads in slots. Setting it must carry the
  // lens with it, or the ribbon says Best Ball while the copy quotes dollars.
  ok('no saved league opens on the auction edition', load({}).L.edition() === 'auction');
  ok('a saved best ball league opens on best ball',
     load({ iron_tuna_draft_state_v2: league('bestball') }).L.edition() === 'bestball');
  ok('and it is the league that set it, not the reader',
     load({ iron_tuna_draft_state_v2: league('bestball') }).L.editionFromLeague() === true &&
     load({}).L.editionFromLeague() === false);
  {
    const s2 = { iron_tuna_draft_state_v2: league('auction'), iron_tuna_values_v1: boardJSON };
    const n = load(s2).L;
    ok('the edition reports the value it took', n.setEdition('bestball') === 'bestball');
    ok('and best ball reads in slots underneath', n.readingFormat() === 'snake');
    ok('a tailored line follows the edition',
       !/\$\d/.test(n.tailor('+10% to +20% versus price', 'Bravo Wideout', 'WR', n.readingFormat())));
    ok('an unrecognised edition is refused rather than taken',
       n.setEdition('kickball') === 'bestball' && n.edition() === 'bestball');
    ok('the choice is written where the next page will find it',
       s2.iron_tuna_edition_v1 === 'bestball');
    ok('the next page opens on that edition', load(s2).L.edition() === 'bestball');
    ok('and a reader-set edition is not reported as the league’s',
       load(s2).L.editionFromLeague() === false);
  }

  // A lens the reader borrowed is never described as the league they play in.
  const borrowed = load(store).L;
  ok('the reader’s own league is called theirs',
     borrowed.label() === 'your 10-team snake draft', borrowed.label());
  ok('a borrowed lens is never called their league',
     borrowed.label('auction') === 'a 10-team, $300 auction', borrowed.label('auction'));
  ok('best ball read as a draft is still their own best ball',
     load({ iron_tuna_draft_state_v2: league('bestball') }).L.label('snake') === 'your 10-team best ball');
  const dollars = borrowed.tailor('+10% to +20% versus price', 'Bravo Wideout', 'WR', 'auction');
  ok('a snake league asked for the auction read gets honest dollars',
     /worth about \$5–\$10 more in a 10-team, \$300 auction\.$/.test(dollars), dollars);
}

// ── 6c. the site's own board, for a reader who has not got one ─────────────
// A reader with no saved league used to get nothing at all — the group least
// able to translate "+12% to +18% versus price" themselves. They now get the
// site's own numbers, all three readings of them, and a label that never
// pretends the league is theirs.
console.log('\nthe default board');
{
  const { L } = load({});
  const board = L.defaultBoard();
  ok('the board ships with the library', board.length > 300, `${board.length} players`);
  ok('it is skill positions only',
     board.every(p => ['QB', 'RB', 'WR', 'TE'].includes(p.pos)));
  ok('every row carries points and a price',
     board.every(p => p.pts > 0 && p.v >= 1));
  ok('the priciest player is priced off the top of the curve',
     Math.max(...board.map(p => p.v)) === Math.round(Math.max(...Object.values(L.defaults.curve).map(c => c[0])) *
       (L.defaults.teams * L.defaults.budget / L.defaults.curveBudget)));

  const someone = board.find(p => p.pos === 'WR' && p.v > 20);
  const line = L.tailor('+10% to +20% versus price', someone.n, 'WR');
  ok('a reader with no league still gets a real number', !!line, line);
  ok('it is the site\u2019s league, and says so', /in a 12-team, \$200 league/.test(line), line);
  ok('it prices the call in dollars', /\$\d+/.test(line), line);
  ok('it gives the share of a budget, which is true at any budget',
     /% of a budget|under 1% of a budget/.test(line), line);
  ok('and the draft-slot move beside it', /draft slot|endgame/.test(line), line);
  ok('the label never calls it theirs', L.tailorLabel() === 'Default league');
  ok('a qualitative call is still never given a number',
     L.tailor('slight efficiency drag on the offense', someone.n, 'WR') === '');
  ok('a player the board does not know is still never invented',
     L.tailor('+10% to +20% versus price', 'Nobody At All Here', 'WR') === '');
  ok('no board of the reader\u2019s own is claimed to exist',
     L.has === false && L.hasBoard === false && L.rankOf('WR', 200) === null);

  // The reader's own board still outranks the site's, in both directions.
  const own = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'auction' } }),
    iron_tuna_values_v1: JSON.stringify({ ts: 1, sv: 2, teams: 12, budget: 200, format: 'auction',
      players: [{ n: someone.n, pos: 'WR', v: 99, pts: 400 }, { n: 'Filler Wideout', pos: 'WR', v: 5, pts: 100 }] })
  }).L;
  ok('a saved board wins over the site\u2019s', /is \$99 on your sheet/.test(own.tailor('+10% versus price', someone.n, 'WR')));
  ok('and is labelled as theirs', own.tailorLabel() === 'Your league');

  // A league saved but no board built — the app writes both, so this is the
  // reader who set their league up and never opened the sheet. The site's board
  // is all there is to rank him on, but the reader told us their budget, and a
  // price is nothing but a budget: they are quoted in their own money, and never
  // handed the desk's $200 they never asked about.
  const halfPot = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 120, format: 'auction' } })
  }).L;
  const short = halfPot.tailor('+10% to +20% versus price', someone.n, 'WR');
  ok('a reader with a league but no board is priced in their money',
     new RegExp('prices at \\$' + Math.round(someone.v * 0.6) + ' in your 12-team, \\$120 auction').test(short), short);
  ok('and is never shown the desk\u2019s league instead of their own',
     !/\$200/.test(short) && !/12-team, \$200/.test(short), short);
  ok('and the line is labelled as theirs, because it is',
     halfPot.tailorLabel() === 'Your league');

  // The share of a budget is a share of THEIR budget, against the prices THEIR
  // room pays. Ten managers on $300 put less money in the room per wallet than
  // twelve on $200, so the same call is a smaller slice of what they hold — and
  // printing the desk's slice beside their dollars is the two-leagues confusion
  // in one sentence.
  const deep = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 10, budget: 300, format: 'auction' } })
  }).L;
  const rich = deep.tailor('+10% to +20% versus price', someone.n, 'WR');
  ok('a deeper budget prices the same call higher',
     new RegExp('prices at \\$' + Math.round(someone.v * (10 * 300) / (12 * 200)) +
                ' in your 10-team, \\$300 auction').test(rich), rich);
  ok('and the budget share is read against their budget, not the desk\u2019s',
     pctOf(rich) !== '' && pctOf(rich) !== pctOf(line), pctOf(rich) + ' | ' + pctOf(line));

  // The endgame tier is a share of a budget too. Comparing $200 board prices
  // against a $120 dart line would call half the mid-round board a dart throw.
  const cheap = board.filter(p => p.pos === 'WR').sort((a, b) => b.v - a.v)[14];
  ok('the endgame line is drawn in the reader\u2019s money as well',
     /endgame/.test(load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 12, format: 'auction' } }) })
       .L.tailor('+10% to +20% versus price', cheap.n, 'WR')) === true);

  // And the reader who saved nothing is still told, in as many words, that these
  // are not their numbers.
  ok('a reader with no league still gets the desk\u2019s league, named as the desk\u2019s',
     /in a 12-team, \$200 league/.test(line) && L.tailorLabel() === 'Default league');
}

// ── 6d. a draft slot is a pick, not a points gap ───────────────────────────
// THE BUG: slots were counted by walking every player of ANY position whose raw
// points fell between the old and new totals. Raw fantasy points do not compare
// across positions — a 300-point QB and a 300-point WR are not adjacent picks —
// so a routine +15% on a wide receiver was reported as a 25-slot move, most of
// it quarterbacks he would never be drafted against.
console.log('\ndraft slots');
{
  // normName() strips digits, so "W6 Wideout" and "W7 Wideout" are the SAME key.
  // Fixture names have to differ in letters or the board collapses to one row.
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const nm = i => LETTERS[i % 26].toUpperCase() + LETTERS[Math.floor(i / 26)] + 'x';

  // Two positions whose POINTS overlap and whose VALUES do not, exactly as real
  // projections behave: quarterbacks outscore receivers and cost less.
  const players = [];
  for (let i = 0; i < 12; i++) players.push({ n: nm(i) + ' Passer', pos: 'QB', v: 40 - i * 3, pts: 290 - i * 2 });
  for (let i = 0; i < 12; i++) players.push({ n: nm(i) + ' Catcher', pos: 'WR', v: 60 - i * 4, pts: 300 - i * 4 });
  const { L } = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'snake' } }),
    iron_tuna_values_v1: JSON.stringify({ ts: 1, sv: 2, teams: 12, budget: 200, format: 'snake', players })
  });
  const wr = L.findPlayer(nm(6) + ' Catcher', 'WR');
  ok('the fixture board did not collapse on itself', wr && wr.pts === 276, wr && String(wr.pts));

  const moved = L.slotsMoved(wr, 0.04);
  // What the old maths counted: every player anywhere with points in the band.
  const np = wr.pts * 1.04;
  const naive = players.filter(q => q.n !== wr.n && q.pts > wr.pts && q.pts <= np).length;
  ok('a receiver moves past receivers, not past quarterbacks',
     moved > 0 && moved < naive, `now ${moved}, cross-position count ${naive}`);
  ok('a move that passes nobody at his position is no move', L.slotsMoved(wr, 0.001) === 0);
  ok('a downgrade moves the other way', L.slotsMoved(wr, -0.05) > 0);
  const line = L.tailor('+4% versus price', nm(6) + ' Catcher', 'WR');
  ok('and the copy quotes that number', /up \d+ slots? /.test(line), line);
  ok('a range that starts at nothing is a ceiling, not a range',
     / slots at most/.test(L.tailor('0% to +4% versus price', nm(6) + ' Catcher', 'WR')),
     L.tailor('0% to +4% versus price', nm(6) + ' Catcher', 'WR'));

  // The $1-$2 tail is not an order, so a distance measured inside it is noise:
  // fifty players tie on price and the gap between two of them is a tie-break.
  const deep = [];
  for (let i = 0; i < 40; i++) deep.push({ n: nm(i) + ' Runner', pos: 'RB', v: i < 3 ? 30 - i * 5 : 1, pts: 200 - i * 2 });
  const tail = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'snake' } }),
    iron_tuna_values_v1: JSON.stringify({ ts: 1, sv: 2, teams: 12, budget: 200, format: 'snake', players: deep })
  }).L;
  const endgame = tail.tailor('+20% versus late-round price', nm(30) + ' Runner', 'RB');
  ok('a $1 dart is not quoted a precise slot count', !/\d+ slots/.test(endgame), endgame);
  ok('it is called what it is', /endgame/.test(endgame), endgame);
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

  // The reading lens, at the two places on the front page that quote a call.
  // The lead and the Position Intel modules print the SAME stories: if one of
  // them stops passing the lens it silently falls back to the saved league, and
  // the page contradicts itself a screen apart. tools/test-position-lens.mjs
  // drives the switch in a browser; this only guards the argument.
  // Two editions on the switch, not three: the auction-first pass took best
  // ball off every surface that sold it. The library still understands the
  // value (a reader with a saved best ball league keeps their lens), the front
  // page simply no longer offers it and falls back to auction.
  ok('the front page offers the edition switch',
     /id="edSwitch"/.test(front) && ['auction', 'snake'].every(f => front.includes('data-ed="' + f + '"')));
  ok('and does not sell best ball on it', !front.includes('data-ed="bestball"'));
  ok('both front-page renders read through the lens',
     (front.match(/L\.tailor\(s\.stat, s\.title, s\.pos, readFmt\)/g) || []).length === 2);
  // The edition is the coarser choice and it owns the lens: setEdition writes
  // the reading format too, so best ball (which has no lens of its own) reads
  // in slots rather than being left on auction dollars.
  ok('the switch writes the reader’s choice back to the library', /L\.setEdition\(/.test(front));
  ok('and setting an edition sets the lens under it',
     /function setEdition[\s\S]{0,400}setReadingFormat\(v\)/.test(fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8')));
  ok('the front page labels the line from the library', /L\.tailorLabel\(\)/.test(front));

  // The default board is generated, and a generated block left behind is a
  // reader being quoted last month's projections. Regenerate it here and
  // compare: a forgotten `node tools/build-default-board.mjs` fails this.
  ok('the default board is in sync with the worker\u2019s projections',
     (() => {
       const pool = board.projections(worker);
       const L = board.loadLibrary(lib);
       return lib.includes(board.block(board.boardLines(pool, L, board.normFactors(worker, pool, L))));
     })(),
     'run: node tools/build-default-board.mjs');
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

  const board = { ts: 1, sv: 2, teams: 12, budget: 400, format: 'auction', players: [
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

// ── 11. the generated lead's dollars, restated for the reader ──────────────
// The desk writes one league's prices into its headline ("bid $32, not the
// sheet's $26") and the front page used to print them at everybody. These are
// the rules that stop that being either wrong or invented.
console.log('\nthe desk\u2019s dollars in the reader\u2019s league');
{
  // Real names, because the anchor is the gap between the SITE's board and the
  // reader's, and the site's board only knows real players.
  const site = load({}).L.defaultBoard();
  const priceOf = n => (site.find(p => p.n === n) || {}).v || 0;
  const readerBoard = {
    ts: 1, sv: 2, teams: 10, budget: 300, format: 'auction',
    players: [
      { n: 'Zay Flowers', pos: 'WR', v: priceOf('Zay Flowers') * 2, pts: 260 },
      { n: 'Derrick Henry', pos: 'RB', v: priceOf('Derrick Henry'), pts: 250 },
      { n: 'DeVonta Smith', pos: 'WR', v: 1, pts: 120 }
    ]
  };
  const store = {
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 10, budget: 300, format: 'auction' } }),
    iron_tuna_values_v1: JSON.stringify(readerBoard)
  };
  const { L } = load(store);
  const names = ['Zay Flowers', 'Derrick Henry'];

  ok('a reader with no league saved is never shown numbers dressed up as theirs',
     load({}).L.repriceCopy("bid $32, not the sheet's $26", names) === null);
  ok('copy with no dollars in it is left alone',
     L.repriceCopy('Flowers moves to WR9 on the top-ranked offense', names) === null);

  const t = L.repriceCopy("Zay Flowers moves to WR9: bid $32, not the sheet's $26.", names);
  ok('a named player\u2019s dollars are re-anchored on his price on the reader\u2019s board',
     t && t.text === "Zay Flowers moves to WR9: bid $64, not the sheet's $52.", t && t.text);
  ok('the ranks are left alone, because nothing here can recompute them',
     t && /WR9/.test(t.text));

  // A dek names a player once in full and then by surname. "Flowers' line" has
  // to price off Flowers, not off whoever was named before him.
  const sur = L.repriceCopy('Zay Flowers is up. The odds add 68 yards to Flowers and $10 with them.', names);
  ok('a surname carries the same anchor as the full name', sur && /\$20/.test(sur.text), sur && sur.text);

  // Only four players travel with a story, and a dek routinely prices a fifth.
  const scan = L.repriceCopy('Cap Derrick Henry at $30 and DeVonta Smith at $26.', names);
  ok('a player the story never listed still prices off his own board slot',
     scan && /DeVonta Smith at \$1\b/.test(scan.text), scan && scan.text);

  // Money attached to nobody is a pool, a tier or a gap, and those scale with
  // the money in the room rather than with any one player.
  ok('the league scale is the money in the room', Math.abs(L.leagueScale() - (10 * 300) / (12 * 200)) < 1e-9);
  const pool = L.repriceCopy('The odds add $12 to the quarterback pool.', names);
  ok('an unattributed figure scales by teams x budget',
     pool && pool.text === 'The odds add $15 to the quarterback pool.', pool && pool.text);

  // $1 is the floor of an auction board; nothing may be restated to $0.
  const floor = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 8, budget: 25, format: 'auction' } })
  }).L.repriceCopy('A $2 flier.', []);
  ok('no price is ever restated below the $1 minimum bid', floor && /\$1\b/.test(floor.text), floor && floor.text);

  // A reader playing the league the desk writes for is told so, rather than
  // being shown a "restated" badge over numbers nothing happened to.
  const same = load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'auction' } }) }).L;
  ok('a reader on the desk\u2019s own league has nothing restated', same.repriceCopy('bid $32', []) === null);
  ok('and is still told the prices are for their league, not that nothing happened',
     /Priced for your 12-team, \$200 auction/.test(same.pricingNote(false)), same.pricingNote(false));

  ok('the note names the reader\u2019s league and their scoring', /your 10-team, \$300 auction/.test(L.pricingNote(true))
     && /PPR|standard/.test(L.pricingNote(true)), L.pricingNote(true));
  // The whole point of restating is that the reader never has to hold two
  // leagues in their head. A reader with settings hears about theirs only.
  ok('and never mentions the desk\u2019s league or its budget beside theirs',
     !/desk/i.test(L.pricingNote(true)) && !/\$200/.test(L.pricingNote(true))
     && !/desk/i.test(L.pricingNote(false)) && !/\$200/.test(L.pricingNote(false)),
     L.pricingNote(true) + ' | ' + L.pricingNote(false));
  // A reader with nothing saved is shown the site's default league, and it is
  // named in full: "the default" is not a league anybody can check a price at.
  ok('a reader with no league is shown the default league, named in full',
     /default league: 12 teams, \$200, full PPR/.test(load({}).L.pricingNote(false))
     && /Set up your own/.test(load({}).L.pricingNote(false)), load({}).L.pricingNote(false));
}

// ── 11b. which player a dollar figure belongs to ───────────────────────────
// The lead of 2026-08-23 went out with McMillan at $36 in the headline and $7
// in the dek, one player and two prices on the front page. Every figure in the
// dek was written price-first ("$33 on Tetairoa McMillan") and every one of
// them was handed to the player named BEFORE it, so McMillan was restated off
// Price's board slot and Jefferson off McMillan's. The headline says the same
// thing name-first, which is the only reason it was right.
console.log('\na dollar figure belongs to the player it is bound to');
{
  const site = load({}).L.defaultBoard();
  const priceOf = n => (site.find(p => p.n === n) || {}).v || 0;
  // The desk's own league, so nothing here moves for budget reasons and the
  // only thing under test is which player each figure was read against.
  const store = (players, cfg = { teams: 12, budget: 200, format: 'auction' }) => ({
    iron_tuna_draft_state_v2: JSON.stringify({ config: cfg }),
    iron_tuna_values_v1: JSON.stringify(Object.assign({ ts: 1, sv: 2, format: 'auction' }, cfg, { players }))
  });
  const cast = [
    { n: 'J.K. Dobbins', pos: 'RB', v: 1, pts: 110 },
    { n: 'Jadarian Price', pos: 'RB', v: 1, pts: 105 },
    { n: 'Tetairoa McMillan', pos: 'WR', v: 22, pts: 200 },
    { n: 'Justin Jefferson', pos: 'WR', v: 50, pts: 260 }
  ];
  const { L } = load(store(cast));
  const names = ['J.K. Dobbins', 'Tetairoa McMillan', 'Jadarian Price', 'Justin Jefferson'];
  const say = t => (L.repriceCopy(t, names) || {}).text || '';

  const title = say('Cap J.K. Dobbins at $12 and bid Tetairoa McMillan to $33 as cheap backs get better');
  const dek = say('Cap J.K. Dobbins at $12 and Jadarian Price at $13; bid up to $33 on Tetairoa McMillan and $44 on Justin Jefferson.');
  // What the reader's board should make of each figure: his own price for that
  // player over the site's, which is `boardRatio`. Derived rather than written
  // down, so a re-cut of the market curve moves these with it — the subject here
  // is WHICH player a figure is read against, never what the level happens to be.
  const restate = (n, who) => Math.max(1, Math.round(n * cast.find(c => c.n === who).v / priceOf(who)));
  const mcm = restate(33, 'Tetairoa McMillan'), jeff = restate(44, 'Justin Jefferson');
  ok('a figure written price-first goes to the player it points at, not the one before it',
     new RegExp('\\$' + mcm + ' on Tetairoa McMillan').test(dek), dek);
  ok('the headline and the dek cannot disagree about one player’s price',
     new RegExp('McMillan to \\$' + mcm).test(title) && new RegExp('\\$' + mcm + ' on Tetairoa McMillan').test(dek), title + ' || ' + dek);
  ok('"and" joins two bindings rather than extending one',
     new RegExp('\\$' + jeff + ' on Justin Jefferson').test(dek), dek);
  const dob = restate(12, 'J.K. Dobbins'), pri = restate(13, 'Jadarian Price');
  ok('a name-first figure still belongs to the name before it',
     new RegExp('Dobbins at \\$' + dob + ' and Jadarian Price at \\$' + pri).test(dek), dek);

  // "Cap Drake London at $29, Garrett Wilson at $26" is the case the backward
  // rule exists for, and it has to keep winning over the forward one.
  const pair = say('Cap Tetairoa McMillan at $33, Justin Jefferson at $44.');
  ok('two named prices in one clause each keep their own player',
     new RegExp('McMillan at \\$' + mcm + ', Justin Jefferson at \\$' + jeff).test(pair), pair);

  // A period inside a name is not the end of a sentence. Both Browns are on the
  // board, so neither gets a surname of his own to be found by, and the cut
  // after "A.J." used to put A.J. out of his own sentence's reach.
  const brown = load(store([
    { n: 'A.J. Brown', pos: 'WR', v: priceOf('A.J. Brown') * 2, pts: 230 },
    { n: 'Chase Brown', pos: 'RB', v: priceOf('Chase Brown'), pts: 210 }
  ])).L.repriceCopy('Cap A.J. Brown at $25 and Chase Brown at $20.', ['A.J. Brown', 'Chase Brown']);
  ok('a player written with initials is still named in his own sentence',
     brown && /A\.J\. Brown at \$50 and Chase Brown at \$20/.test(brown.text),
     brown ? brown.text : '(nothing restated at all)');

  // The one case that must NOT fall back on the previous player: a figure bound
  // to somebody this reader's board has never heard of. It is still his figure.
  const off = load(store(cast, { teams: 10, budget: 300, format: 'auction' })).L
    .repriceCopy('Cap J.K. Dobbins at $12 and bid up to $33 on Rome Odunze.', names);
  ok('a figure bound to a player the board cannot price scales with the room instead',
     off && /Odunze/.test(off.text) && /\$41 on Rome Odunze/.test(off.text), off && off.text);
  ok('and the player it is not about keeps his own number',
     off && /Dobbins at \$4\b/.test(off.text), off && off.text);
}

// ── 11c. a story written before the scoring changed ────────────────────────
// repriceCopy converts a price between LEAGUES. On 2026-08-23 the site changed
// MODELS — receptions went from half a point to a full one — and story 29,
// written the day before, priced Zay Flowers at $26 on its own half-PPR board
// and argued for $32. This board prices him at $20 and a reader's at $21, so
// the ratio came out 1.05 and the front page printed "bid $34, not the sheet's
// $27" above a cheat sheet reading $21.
//
// The fix for that is upstream: a story's prices are computed off the same
// market curve this file prices the cheat sheet with, so the two track. Down
// here every story is still restated into the reader's league, because a price
// in a league nobody plays helps nobody — and the older ones say out loud that
// their scoring is not this board's.
console.log('\nan older story is restated too, and says why it can still differ');
{
  const store = {
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'auction' } }),
    iron_tuna_values_v1: JSON.stringify({
      ts: 1, sv: 2, teams: 12, budget: 200, format: 'auction',
      players: [{ n: 'Zay Flowers', pos: 'WR', v: 21, pts: 230 }]
    })
  };
  const { L } = load(store);
  const title = "Zay Flowers moves to WR9: bid $32, not the sheet's $26.";
  const HALF = Date.parse('2026-08-22T16:12:19Z');   // story 29, rec*0.5
  const FULL = Date.parse('2026-08-23T01:13:21Z');   // story 32, rec*1.0
  // Derived off the site's own board for the same reason as §11b above: what is
  // under test is that the story IS restated, not the level the curve puts it at.
  const flowersSite = ((load({}).L.defaultBoard() || []).find(p => p.n === 'Zay Flowers') || {}).v || 0;
  const bid = new RegExp('bid \\$' + Math.max(1, Math.round(32 * 21 / flowersSite)) + '\\b');

  ok('an older story still follows the reader’s league rather than being left alone',
     bid.test((L.repriceCopy(title, ['Zay Flowers'], HALF) || {}).text || ''),
     (L.repriceCopy(title, ['Zay Flowers'], HALF) || {}).text);
  ok('and so does a current one',
     bid.test((L.repriceCopy(title, ['Zay Flowers'], FULL) || {}).text || ''));
  ok('the boundary is the day the scoring changed, not a guess about it',
     L.staleModel(Date.parse('2026-08-22T23:59:59Z')) === true
     && L.staleModel(Date.parse('2026-08-23T00:00:00Z')) === false);
  ok('a story with no date on it is treated as current, as every caller was before',
     L.staleModel(undefined) === false && L.staleModel(0) === false);

  // The note is where the reader is told why a restated price can still sit
  // above a cheat sheet that disagrees with it.
  ok('the older story’s note warns that its prices can differ from the cheat sheet',
     /before the site changed its scoring/.test(L.pricingNote(true, HALF))
     && /cheat sheet/.test(L.pricingNote(true, HALF)), L.pricingNote(true, HALF));
  ok('and it is still told to the reader as their own league',
     /Restated for your 12-team, \$200 auction/.test(L.pricingNote(true, HALF)),
     L.pricingNote(true, HALF));
  ok('a current story carries no such warning',
     !/changed its scoring/.test(L.pricingNote(true, FULL)), L.pricingNote(true, FULL));

  // "The desk" is in-house shorthand: it means nothing to a reader.
  const seen = [L.pricingNote(true, HALF), L.pricingNote(false, HALF),
                L.pricingNote(true, FULL), load({}).L.pricingNote(false)];
  ok('no reader-facing note calls it "the desk"',
     seen.every(t => !/desk/i.test(t)), seen.join(' | '));
}

// ── 11d. the number on the page is the number on the reader's sheet ────────
// The whole point, stated as a test: a story's sheet figure must land on the
// reader's own row, not near it. The app writes MARKET PRICE into the snapshot
// at the reader's slider, scoring, budget and team count, and this library
// copies it rather than recomputing it. A second calculation is only a second
// chance to disagree with the sheet.
console.log('\nthe sheet figure lands on the reader’s own row');
{
  const site = load({}).L.defaultBoard();
  const priceOf = n => (site.find(p => p.n === n) || {}).v || 0;
  const SITE_MC = priceOf('Tetairoa McMillan');       // the site's market price
  const READER_MC = 31;                                // theirs, at their settings
  const mk = extra => ({
    iron_tuna_draft_state_v2: JSON.stringify({
      config: { teams: 12, budget: 200, format: 'auction', strategy: { vegasWeight: 0.4 } }
    }),
    iron_tuna_values_v1: JSON.stringify(Object.assign({
      ts: 1, sv: 2, teams: 12, budget: 200, format: 'auction',
      players: [{ n: 'Tetairoa McMillan', pos: 'WR', v: READER_MC, tv: 44, pts: 250 }]
    }, extra))
  });
  const { L } = load(mk());

  ok('the reader’s own sheet price is readable without recomputing it',
     L.sheetPrice('Tetairoa McMillan') === READER_MC, String(L.sheetPrice('Tetairoa McMillan')));
  ok('a player the sheet does not carry has no price rather than a guessed one',
     L.sheetPrice('Nobody At All') === 0);

  // siteFigure x (readerPrice / siteFigure) === readerPrice, exactly.
  const out = L.repriceCopy(
    'The consensus sheet says $' + SITE_MC + ' for Tetairoa McMillan.', ['Tetairoa McMillan']);
  ok('a story quoting the site’s sheet price prints the reader’s sheet price',
     out && out.text === 'The consensus sheet says $' + READER_MC + ' for Tetairoa McMillan.',
     out && out.text);

  // The slider was sitting in the saved config and being thrown away.
  ok('the reader’s Vegas slider is kept, not silently replaced by the default',
     L.vegasWeight() === 0.4, String(L.vegasWeight()));
  ok('and a reader who never moved it is reported at the site default',
     load({ iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200 } }) })
       .L.vegasWeight() === 0.75);

  // Shape 1 stored True Value in `v`. Reading that as a market price is the bug
  // that put "$38 for Derrick Henry" over a sheet saying $23, so an old
  // snapshot is read for its league and never for its dollars. It heals itself
  // the next time the reader opens the draft app.
  const old = load({
    iron_tuna_draft_state_v2: JSON.stringify({ config: { teams: 12, budget: 200, format: 'auction' } }),
    iron_tuna_values_v1: JSON.stringify({
      ts: 1, teams: 12, budget: 200, format: 'auction',
      players: [{ n: 'Tetairoa McMillan', pos: 'WR', v: 44, pts: 250 }]
    })
  }).L;
  ok('a pre-Market-Price snapshot is never read for a price',
     old.sheetPrice('Tetairoa McMillan') === 0);
  ok('and its stored True Value cannot reach the page as a market price',
     !/\$44/.test((old.repriceCopy('The consensus sheet says $' + SITE_MC
        + ' for Tetairoa McMillan.', ['Tetairoa McMillan']) || {}).text || ''));
  ok('but the league it names is still honoured',
     old.config && old.config.teams === 12 && old.config.budget === 200);
}

// ── 11e. the site's board is the one the site serves ───────────────────────
// The committed block in it-league.js is generated from the COMMITTED
// projections. The app is served those projections re-blended with today's
// odds, so the static copy is a different board the moment a line moves. That
// is how "$47 on the consensus sheet" reached a reader whose row said $25.
// /api/board is the served board; the static block is only the fallback.
console.log('\nthe site board is fetched, and the static block is the fallback');
{
  // A stub fetch, so the real load path runs rather than a mock of it.
  const boardPayload = {
    ok: true, contract: 1, teams: 12, budget: 200,
    players: [{ n: 'Derrick Henry', pos: 'RB', v: 38, pts: 300 },
              { n: 'Filler Back', pos: 'RB', v: 4, pts: 120 }]
  };
  const withFetch = (payload, opts = {}) => {
    const w = makeWindow({});
    w.fetch = (url) => {
      w._asked = url;
      if (opts.reject) return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: opts.httpFail ? false : true, json: () => Promise.resolve(payload) });
    };
    new Function('window', lib + '\n;return window.ITLeague;')(w);
    return w;
  };
  const settled = (L) => new Promise(res => L.onBoard(res));

  const staticHenry = load({}).L.defaultBoard().find(p => p.n === 'Derrick Henry');
  ok('the static block prices Derrick Henry at all', staticHenry && staticHenry.v > 0);

  const w1 = withFetch(boardPayload);
  const L1 = w1.ITLeague;
  await settled(L1);
  ok('the board is fetched from /api/board', w1._asked === '/api/board', String(w1._asked));
  ok('and it is adopted as the site board', L1.boardIsServed() === true);
  ok('the served price wins over the static one',
     (L1.defaultBoard().find(p => p.n === 'Derrick Henry') || {}).v === 38,
     JSON.stringify(L1.defaultBoard().find(p => p.n === 'Derrick Henry')));
  ok('a player the served board does not carry is simply absent, not invented',
     !L1.defaultBoard().some(p => p.n === 'Zay Flowers'));

  // Every failure mode leaves the reader on the static board rather than on
  // nothing. A board that cannot be fetched is a worse answer, not a broken page.
  for (const [label, opts] of [['a rejected request', { reject: true }],
                               ['a non-200 response', { httpFail: true }]]) {
    const w = withFetch(boardPayload, opts);
    await settled(w.ITLeague);
    ok(`${label} leaves the static board in place`,
       w.ITLeague.boardIsServed() === false
       && w.ITLeague.defaultBoard().length === load({}).L.defaultBoard().length);
  }
  for (const [label, bad] of [['an empty player list', { ok: true, players: [] }],
                              ['an ok:false payload', { ok: false, players: [{ n: 'X', pos: 'RB', v: 9 }] }],
                              ['a payload with no prices', { ok: true, players: [{ n: 'X', pos: 'RB', v: 0 }] }],
                              ['a null payload', null]]) {
    const w = withFetch(bad);
    await settled(w.ITLeague);
    ok(`${label} is refused rather than adopted`, w.ITLeague.boardIsServed() === false);
  }

  // onBoard is the pages' repaint hook. It must fire for a caller that arrives
  // after the request has already settled, or a page that painted late waits
  // forever for an event that has been and gone.
  const w2 = withFetch(boardPayload);
  await settled(w2.ITLeague);
  let late = null;
  w2.ITLeague.onBoard(ok2 => { late = ok2; });
  ok('a late onBoard caller is answered immediately', late === true, String(late));

  // A page with no fetch at all (an old browser, a test rig) must not hang.
  const w3 = makeWindow({});
  new Function('window', lib + '\n;return window.ITLeague;')(w3);
  let noFetch = 'never';
  w3.ITLeague.onBoard(v => { noFetch = v; });
  ok('with no fetch available the board settles at once instead of hanging',
     noFetch === false, String(noFetch));
}

// ── 12. the pages that print the desk's dollars all go through it ──────────
console.log('\nthe front page and /lead restate before they paint');
{
  const paint = front.slice(front.indexOf('function paintGeneratedLead'), front.indexOf('function leadStamp'));
  ok('the front-page lead restates the headline', /repriceCopy\(s\.title/.test(paint));
  ok('and the dek with it', /repriceCopy\(s\.dek/.test(paint));
  ok('and says whose league the numbers are', /pricingNote\(/.test(paint));
  // Without the date the guard is dead code: every story looks current.
  ok('and hands the story\u2019s own date to both, so an old-model story is refused',
     /repriceCopy\(s\.title, names, s\.createdAt\)/.test(paint)
     && /repriceCopy\(s\.dek \|\| '', names, s\.createdAt\)/.test(paint)
     && /pricingNote\([^;]*s\.createdAt\)/.test(paint));
  ok('the retired headlines under it carry their own dates too',
     /repriceCopy\(o\.title,[\s\S]{0,120}?o\.createdAt\)/.test(front));
  ok('the old "nothing to re-price" branch is gone',
     !/Nothing to re-price/.test(front));

  const page = fs.readFileSync(path.join(ROOT, 'lead.html'), 'utf8');
  ok('/lead loads the library at all', page.includes('src="/it-league.js"'));
  ok('/lead restates the article body, not just the headline', /rp\(s\.body/.test(page));
  ok('/lead says whose league the numbers are', /pricingNote\(/.test(page));
  ok('/lead passes the story\u2019s date to the restatement and the note',
     /repriceCopy\(t, names, s\.createdAt\)/.test(page)
     && /pricingNote\(restated, s\.createdAt\)/.test(page));
  ok('/lead\u2019s archive list carries them as well',
     /repriceCopy\(x\.title,[\s\S]{0,120}?x\.createdAt\)/.test(page));

  // The served board can settle after a page has painted. The front page
  // repaints on it; /lead paints once, so it waits for it instead.
  ok('the front page repaints when the served board lands',
     /L\.onBoard\(function\(ok\)\{ if \(ok\) repaintLead\(\); \}\)/.test(front));
  ok('and registers that hook once, outside any paint',
     (front.match(/L\.onBoard\(/g) || []).length === 1);
  ok('/lead waits for the board rather than swapping dollars under the reader',
     /function afterBoard\(d\)/.test(page) && /\.then\(afterBoard\)/.test(page));
  ok('and waits on both of its fetches',
     (page.match(/\.then\(afterBoard\)/g) || []).length === 2);

  // The worker has to build that board from the SAME pool the app is served,
  // or the endpoint just moves the old mismatch behind an HTTP call.
  ok('the worker serves /api/board at all', /url\.pathname === '\/api\/board'/.test(worker));
  const bp = worker.slice(worker.indexOf('async function boardPayload'),
                          worker.indexOf('// Where the RANKINGS put each team'));
  ok('and builds it from the odds-blended pool, not the committed one',
     /blendProjections\(cached\.overlay\)/.test(bp), bp.slice(0, 200));
  ok('and prices it with the same curve the cheat sheet uses',
     /_colPrice\(pos, i\)/.test(bp));
  ok('and ranks within position by points, which is the curve slot',
     /sort\(\(a, b\) => b\.pts - a\.pts\)/.test(bp));
  ok('and ships prices only, so no second valuation can grow in it',
     !/_colStatLine|projectedStats:/.test(bp));
}

// ── 13. the preview tool still finds the copy it previews ──────────────────
// tools/preview-copy.mjs renders these surfaces by lifting the pages' OWN
// blocks, located by anchor text. An edit that moves an anchor does not break
// the site — it breaks the preview, silently, right up until someone trusts a
// half-rendered card. cut() throws on a missing anchor; this is what makes
// that throw happen in CI rather than in front of a person reading copy.
console.log('\nthe copy preview can still find every block it lifts');
{
  for (const [name, block] of Object.entries(BLOCKS)) {
    let found = '';
    try { found = cut(fs.readFileSync(path.join(ROOT, block.file), 'utf8'), block); }
    catch (e) { found = ''; ok(`the ${name} block is still in ${block.file}`, false, e.message); }
    if (found) {
      ok(`the ${name} block is still in ${block.file}`, true);
      ok(`and it is a block, not a stray line`, found.split('\n').length > 3,
         `${found.split('\n').length} lines`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
