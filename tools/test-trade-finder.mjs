#!/usr/bin/env node
// The Trade Finder's engine: the roster parser, the lineup valuation and the
// trade search, plus the worker's screenshot reader (the part that runs
// without a model).
//   node tools/test-trade-finder.mjs
//
// Plain node, no browser, no network: it-trade.js is a UMD module by design so
// the exact code the page runs is the code under test here.
//
// THE THINGS THAT WOULD BE WRONG AND LOOK RIGHT:
//   - A trade the other side does not gain from. The page's one promise is that
//     both lineups improve; a search that reports the reader's gain and never
//     checks the partner's would produce a confident list of trades nobody
//     accepts.
//   - Gains measured at the wrong horizon. A team on the playoff clock and a
//     team chasing a spot are scored on different weeks, and if the engine
//     quietly used one horizon for both, the feature that justifies the page is
//     a label with nothing behind it.
//   - A paste that turns a slot label or a defence into a team. "QB - BUF (3)"
//     and "Bills D/ST" are not managers, and a parser that promotes them
//     silently produces a 14-team league out of a 12-team paste.
//   - A lineup filled in the wrong order. Flex must take the best of what the
//     named slots leave, never a player a named slot should have held.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, 'it-trade.js'));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── a pool with the awkward names in it ─────────────────────────────────────
const POOL_ROWS = [
  ['Josh Allen', 'QB', 'BUF'], ['Lamar Jackson', 'QB', 'BAL'], ['Jayden Daniels', 'QB', 'WAS'], ['Joe Burrow', 'QB', 'CIN'],
  ['Bijan Robinson', 'RB', 'ATL'], ['Derrick Henry', 'RB', 'BAL'], ['Kenneth Walker III', 'RB', 'SEA'], ['Jahmyr Gibbs', 'RB', 'DET'],
  ['De\'Von Achane', 'RB', 'MIA'], ['James Cook', 'RB', 'BUF'], ['Josh Jacobs', 'RB', 'GB'], ['Chase Brown', 'RB', 'CIN'],
  ['Ja\'Marr Chase', 'WR', 'CIN'], ['A.J. Brown', 'WR', 'PHI'], ['Amon-Ra St. Brown', 'WR', 'DET'], ['Marvin Harrison Jr.', 'WR', 'ARI'],
  ['Jaxon Smith-Njigba', 'WR', 'SEA'], ['CeeDee Lamb', 'WR', 'DAL'], ['Justin Jefferson', 'WR', 'MIN'], ['Nico Collins', 'WR', 'HOU'],
  ['Jaylen Waddle', 'WR', 'MIA'], ['Tee Higgins', 'WR', 'CIN'], ['Drake London', 'WR', 'ATL'], ['DJ Moore', 'WR', 'CHI'],
  ['Brock Bowers', 'TE', 'LV'], ['Trey McBride', 'TE', 'ARI'], ['George Kittle', 'TE', 'SF'], ['Sam LaPorta', 'TE', 'DET'],
  ['Buffalo Bills', 'DST', 'BUF'], ['Baltimore Ravens', 'DST', 'BAL'], ['Justin Tucker', 'K', 'BAL'], ['Brandon Aubrey', 'K', 'DAL']
];
const POOL = T.makePool(POOL_ROWS.map(([name, pos, team], i) => ({ name, pos, team, id: 'p' + i })));

console.log('\nthe resolver');
{
  const r = (s, h) => { const x = T.resolve(s, POOL, h); return x ? x.name : null; };
  ok('a plain name', r('Josh Allen') === 'Josh Allen');
  ok('a name with its club and position after it', r('Ja\'Marr Chase WR - CIN') === 'Ja\'Marr Chase');
  ok('"Last, First"', r('Chase, Ja\'Marr') === 'Ja\'Marr Chase');
  ok('an initial and a surname', r('J. Chase') === 'Ja\'Marr Chase');
  ok('the initial disambiguates by first letter', r('L. Jackson') === 'Lamar Jackson');
  ok('a suffix dropped', r('Marvin Harrison') === 'Marvin Harrison Jr.');
  ok('a suffix kept but unpunctuated', r('Kenneth Walker III RB SEA') === 'Kenneth Walker III');
  ok('initials run together', r('AJ Brown') === 'A.J. Brown');
  ok('initials spaced', r('A J Brown WR') === 'A.J. Brown');
  ok('a hyphen and a period', r('Amon-Ra St Brown') === 'Amon-Ra St. Brown');
  ok('the tail of a name', r('St. Brown') === 'Amon-Ra St. Brown');
  ok('a hyphenated surname alone', r('Smith-Njigba') === 'Jaxon Smith-Njigba');
  ok('a unique surname alone', r('Henry') === 'Derrick Henry');
  ok('an ambiguous surname resolves to nothing', r('Brown') === null);
  ok('the position hint settles an ambiguous surname', r('Brown RB') === 'Chase Brown');
  ok('a position hint rejects a mismatch', r('Josh Allen RB') === null);
  ok('a defence by nickname', r('Bills D/ST') === 'Buffalo Bills');
  ok('a defence by city', r('Buffalo DEF') === 'Buffalo Bills');
  ok('a defence by abbreviation', r('BAL DST') === 'Baltimore Ravens');
  ok('a kicker by surname and position', r('Tucker K BAL') === 'Justin Tucker');
  ok('nothing from noise', r('QB - BUF (3)') === null && r('Bye: 7') === null);
  ok('a name the board does not carry', r('Random Person WR') === null);
}

console.log('\nthe roster parser');
{
  const PASTE = `Team Awesome (Ken)
Owner: Ken
QB\tJosh Allen\tBUF - QB\t24.1
RB\tBijan Robinson\tATL - RB\t19.8
RB - SEA (5)
Walker III, Kenneth
WR\tJ. Chase\tCIN
Marvin Harrison Jr WR ARI
TE Brock Bowers LV
FLEX Jaylen Waddle
Bills D/ST
Tucker K BAL
Bench
James Cook RB BUF
Proj 118.4

The Hammers
Lamar Jackson
Derrick Henry
AJ Brown WR
St. Brown
Bowers TE LV
Gibbs
Trey McBride
Brown
BAL DEF
---
Team: Third Wheel
Jayden Daniels QB
Achane
CeeDee Lamb
Justin Jefferson
Kittle
`;
  const r = T.parseRosters(PASTE, POOL);
  const names = t => t.players.map(p => p.name);
  ok('three teams, not more', r.teams.length === 3, r.teams.map(t => t.name).join(' | '));
  ok('the first team keeps its first name', r.teams[0].name === 'Team Awesome (Ken)', r.teams[0].name);
  ok('"Owner:" does not open a second team', !r.teams.some(t => /Owner/.test(t.name)));
  ok('a slot line with a club and a bye is not a team', !r.teams.some(t => /SEA/.test(t.name)));
  ok('"Bench" is not a team', !r.teams.some(t => /bench/i.test(t.name)));
  ok('"Proj 118.4" is not a team', !r.teams.some(t => /Proj/.test(t.name)));
  ok('a defence is a player, not a team', !r.teams.some(t => /Bills/.test(t.name)) && names(r.teams[0]).includes('Buffalo Bills'));
  ok('"Team: X" opens a team called X', r.teams[2].name === 'Third Wheel', r.teams[2].name);
  ok('a table row resolves off its player cell', names(r.teams[0]).includes('Josh Allen') && names(r.teams[0]).includes('Bijan Robinson'));
  ok('every awkward name on team one landed', ['Kenneth Walker III', 'Ja\'Marr Chase', 'Marvin Harrison Jr.', 'Brock Bowers', 'Jaylen Waddle', 'Justin Tucker', 'James Cook'].every(n => names(r.teams[0]).includes(n)), names(r.teams[0]).join(', '));
  ok('team two got its seven, the duplicate and the ambiguous name left out', names(r.teams[1]).length === 7, names(r.teams[1]).join(', '));
  ok('an ambiguous surname is reported, not guessed', r.teams[1].unresolved.includes('Brown'), JSON.stringify(r.teams[1].unresolved));
  ok('a player listed twice stays with the first team', r.duplicates.length === 1 && r.duplicates[0].name === 'Brock Bowers' && names(r.teams[1]).indexOf('Brock Bowers') < 0, JSON.stringify(r.duplicates));
  ok('team three resolved by surname where unique', ['Jayden Daniels', 'De\'Von Achane', 'CeeDee Lamb', 'Justin Jefferson', 'George Kittle'].every(n => names(r.teams[2]).includes(n)), names(r.teams[2]).join(', '));
  const none = T.parseRosters('', POOL);
  ok('an empty paste is no teams', none.teams.length === 0);
  const headless = T.parseRosters('Josh Allen\nBijan Robinson', POOL);
  ok('a paste with no header is one team', headless.teams.length === 1 && headless.teams[0].players.length === 2);
}

console.log('\nthe lineup');
{
  const pts = { QB1: 20, QB2: 18, RB1: 15, RB2: 14, RB3: 13, RB4: 5, WR1: 16, WR2: 12, WR3: 11, TE1: 9, TE2: 8, K1: 8, D1: 7 };
  const roster = Object.keys(pts).map(k => ({ id: k, pos: k.replace(/\d/, '').replace('D', 'DEF') }));
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 0 };
  const L = T.lineupValue(roster, slots, p => pts[p.id]);
  const starters = L.starters.map(r => r.p.id).sort().join(',');
  ok('the named slots take the best at each position', /QB1/.test(starters) && /RB1/.test(starters) && /RB2/.test(starters) && /WR1/.test(starters) && /WR2/.test(starters) && /TE1/.test(starters), starters);
  ok('flex takes the best of what is left, whatever the position', L.starters.find(r => r.slot === 'FLEX').p.id === 'RB3', starters);
  ok('kickers and defences are not in the lineup', !/K1|D1/.test(starters));
  const startPts = 20 + 15 + 14 + 16 + 12 + 9 + 13;
  ok('starters add up', near(L.total - L.benchValue, startPts), String(L.total - L.benchValue));
  // The bench: WR3 (11) at .25, TE2 (8) at .15, QB2 (18) at .08 x .3 in a 1-QB league.
  const benchExpected = 11 * 0.25 + 8 * 0.15 + 18 * 0.08 * 0.3;
  ok('the bench is weighted, and a backup QB in a 1-QB league barely counts', near(L.benchValue, benchExpected, 1e-9), `${L.benchValue} vs ${benchExpected}`);
  const SF = T.lineupValue(roster, { ...slots, SFLEX: 1 }, p => pts[p.id]);
  ok('a superflex slot starts the second quarterback', SF.starters.some(r => r.slot === 'SFLEX' && r.p.id === 'QB2'));
  ok('and the lineup is worth more for it', SF.total > L.total);
  const two = T.lineupValue(roster, { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 }, p => pts[p.id]);
  ok('a three-WR two-flex league starts nine', two.starters.length === 9, String(two.starters.length));
}

console.log('\nthe trade search');
{
  // Six teams. Team 0 (the reader) is deep at RB and thin at WR; team 1 is the
  // mirror image. Team 2 is balanced and good; team 3 is weak everywhere; teams
  // 4 and 5 are filler. Points differ by horizon: `late` favours certain
  // players in the playoff weeks, so a horizon switch changes the answer.
  const mk = (id, pos, ros, late, week) => ({ id, name: id, pos, ros, late: late == null ? ros * 3 / 12 : late, week: week == null ? ros / 12 : week });
  const teams = [
    { name: 'Reader', players: [mk('Q0', 'QB', 300), mk('R0a', 'RB', 260), mk('R0b', 'RB', 240), mk('R0c', 'RB', 220), mk('R0d', 'RB', 200), mk('W0a', 'WR', 150), mk('W0b', 'WR', 120), mk('W0c', 'WR', 60), mk('T0', 'TE', 120)] },
    { name: 'Mirror', players: [mk('Q1', 'QB', 290), mk('R1a', 'RB', 150), mk('R1b', 'RB', 110), mk('R1c', 'RB', 60), mk('W1a', 'WR', 270), mk('W1b', 'WR', 250), mk('W1c', 'WR', 230), mk('W1d', 'WR', 210), mk('T1', 'TE', 110)] },
    { name: 'Balanced', players: [mk('Q2', 'QB', 310), mk('R2a', 'RB', 230), mk('R2b', 'RB', 200), mk('R2c', 'RB', 150), mk('W2a', 'WR', 240), mk('W2b', 'WR', 200), mk('W2c', 'WR', 150), mk('T2', 'TE', 130)] },
    { name: 'Weak', players: [mk('Q3', 'QB', 200), mk('R3a', 'RB', 120), mk('R3b', 'RB', 100), mk('W3a', 'WR', 130), mk('W3b', 'WR', 110), mk('T3', 'TE', 60)] },
    { name: 'Four', players: [mk('Q4', 'QB', 250), mk('R4a', 'RB', 180), mk('R4b', 'RB', 170), mk('W4a', 'WR', 190), mk('W4b', 'WR', 170), mk('T4', 'TE', 90)] },
    // Five holds a playoff-week specialist: ordinary over the season, huge in
    // weeks 15-17 — the player a clinched team should want and a bubble team
    // should sell.
    { name: 'Five', players: [mk('Q5', 'QB', 240), mk('R5a', 'RB', 170), mk('R5b', 'RB', 160), mk('W5a', 'WR', 180, 110), mk('W5b', 'WR', 160), mk('T5', 'TE', 80)] }
  ];
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 };
  const WEEKS = { week: 1, next3: 3, ros: 12, playoffs: 3 };
  const points = (p, h) => h === 'playoffs' ? p.late : h === 'week' ? p.week : h === 'next3' ? p.ros * 3 / 12 : p.ros;
  const base = { slots, points, weeks: h => WEEKS[h], horizon: () => 'ros', mine: 0, tilt: 0, minGain: 0.5 };

  const even = T.findTrades(teams, base);
  ok('trades were found', even.trades.length > 0, String(even.considered));
  ok('every trade improves both lineups', even.trades.every(t => t.gainA >= 0.5 && t.gainB >= 0.5),
     JSON.stringify(even.trades.slice(0, 2).map(t => [t.gainA, t.gainB])));
  ok('every trade involves the reader', even.trades.every(t => t.a === 0 || t.b === 0));
  ok('the first trade sends a running back and returns a receiver',
     even.trades[0].giveA.some(p => p.pos === 'RB') && even.trades[0].giveB.some(p => p.pos === 'WR'),
     `${even.trades[0].giveA.map(p => p.id)} for ${even.trades[0].giveB.map(p => p.id)}`);
  ok('the mirror-image roster is the natural partner', even.trades[0].b === 1, String(even.trades[0].b));
  ok('even trades are scored on the smaller gain', even.trades.every(t => near(t.score, Math.min(t.gainA, t.gainB) - 0.1 * Math.max(0, t.giveA.length + t.giveB.length - 2))));
  ok('no trade is a 3-for-1', even.trades.every(t => Math.abs(t.giveA.length - t.giveB.length) <= 1));
  ok('the reader’s side has lineup lines', even.trades[0].linesA && even.trades[0].linesA.startsNow.length > 0);

  // The gains are the lineup deltas, recomputed here independently.
  const t0 = even.trades[0];
  const val = (ps, h) => T.lineupValue(ps, slots, p => points(p, h)).total;
  const A = teams[0].players, B = teams[t0.b].players;
  const after = A.filter(p => t0.giveA.indexOf(p) < 0).concat(t0.giveB);
  ok('the reader’s gain is the lineup delta per week', near(t0.gainA, (val(after, 'ros') - val(A, 'ros')) / 12, 1e-9), String(t0.gainA));
  const afterB = B.filter(p => t0.giveB.indexOf(p) < 0).concat(t0.giveA);
  ok('so is the partner’s', near(t0.gainB, (val(afterB, 'ros') - val(B, 'ros')) / 12, 1e-9), String(t0.gainB));

  // Tilt: the reader's gain never goes down as the slider moves toward them,
  // and the floor under the partner never moves.
  const tilted = T.findTrades(teams, { ...base, tilt: 1 });
  ok('tilted toward the reader, the top trade gains the reader at least as much', tilted.trades[0].gainA >= even.trades[0].gainA - 1e-9, `${tilted.trades[0].gainA} vs ${even.trades[0].gainA}`);
  ok('and the partner still gains', tilted.trades.every(t => t.gainB >= 0.5));
  ok('tilted trades are scored on the reader’s gain', tilted.trades.every(t => near(t.score, t.gainA - 0.1 * Math.max(0, t.giveA.length + t.giveB.length - 2))));

  // Horizons: the reader has clinched and is scored on the playoff weeks; team
  // 5, on the bubble, is scored on the next three. The playoff specialist
  // should move to the reader in a trade that is right for both.
  const split = T.findTrades(teams, { ...base, mine: 0, horizon: i => i === 0 ? 'playoffs' : 'next3', tilt: 0.5, limit: 40 });
  const spec = split.trades.find(t => t.b === 5 && t.giveB.some(p => p.id === 'W5a'));
  ok('a playoff-only team is offered the playoff specialist', !!spec, split.trades.slice(0, 3).map(t => t.giveB.map(p => p.id).join('+')).join(' | '));
  ok('and its gain is measured on the playoff weeks', spec && spec.hA === 'playoffs' && spec.hB === 'next3');
  const same = T.findTrades(teams, { ...base, mine: 0, horizon: () => 'ros', tilt: 0.5, limit: 40 });
  const specRos = same.trades.find(t => t.b === 5 && t.giveB.some(p => p.id === 'W5a'));
  ok('over the whole season that same player is not the headline', !specRos || specRos.score < spec.score, specRos ? String(specRos.score) : 'absent');

  // Every pair.
  const all = T.findTrades(teams, { ...base, mine: null, limit: 30 });
  ok('with no reader named, trades come from every pair', new Set(all.trades.map(t => t.a + '-' + t.b)).size > 3, String(new Set(all.trades.map(t => t.a + '-' + t.b)).size));
  ok('still both-sided', all.trades.every(t => t.gainA >= 0.5 && t.gainB >= 0.5));
  const cap = T.findTrades(teams, { ...base, limit: 3 });
  ok('the limit holds', cap.trades.length <= 3);
  // A pair with nothing to offer each other produces nothing rather than a
  // trade dressed up as balanced.
  const nothing = T.findTrades([teams[3], teams[3]], { ...base, mine: 0 });
  ok('identical rosters have no trade', nothing.trades.length === 0, String(nothing.trades.length));
  ok('the team summary carries each side’s horizon and per-week value', split.teams[0].horizon === 'playoffs' && split.teams[5].horizon === 'next3' && split.teams[0].perWeek > 0);
}

console.log('\nthe worker’s screenshot reader, without a model');
{
  const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const cut = (from, to) => {
    const a = src.indexOf(from), b = src.indexOf(to, a);
    if (a < 0 || b < 0) { console.error('FAIL: could not locate ' + from.slice(0, 50)); process.exit(1); }
    return src.slice(a, b);
  };
  const W = new Function(cut('// ── the roster reader ─', '// ── /the roster reader ─') + '\nreturn { rosterReadParse, ROSTER_READ_SYSTEM, ROSTER_READ_MAX_IMAGES, ROSTER_READ_MAX_BYTES };')();
  ok('the system prompt asks for JSON and forbids invention', /JSON/.test(W.ROSTER_READ_SYSTEM) && /never|do not|not invent|Do not/i.test(W.ROSTER_READ_SYSTEM));
  const good = W.rosterReadParse('Here you go:\n```json\n{"teams":[{"name":"Team A","players":[{"name":"Josh Allen","pos":"QB","team":"BUF"},{"name":"Bijan Robinson","pos":"RB"}]},{"name":"","players":[{"name":"Lamar Jackson","pos":"qb"}]}]}\n```');
  ok('a fenced JSON reply parses', good.ok && good.teams.length === 2, JSON.stringify(good).slice(0, 200));
  ok('positions are upper-cased and a missing club is tolerated', good.teams[0].players[1].pos === 'RB' && good.teams[0].players[1].team === '' && good.teams[1].players[0].pos === 'QB');
  ok('a nameless team gets a numbered name', good.teams[1].name === 'Team 2', good.teams[1].name);
  const junk = W.rosterReadParse('I could not read the image.');
  ok('prose without JSON is a clean failure', junk.ok === false && junk.error);
  const empty = W.rosterReadParse('{"teams":[]}');
  ok('no teams is a clean failure too', empty.ok === false);
  const bad = W.rosterReadParse('{"teams":[{"name":"X","players":"Josh Allen"}]}');
  ok('a malformed team is dropped rather than thrown on', bad.ok === false);
  const long = W.rosterReadParse(JSON.stringify({ teams: Array.from({ length: 40 }, (_, i) => ({ name: 'T' + i, players: Array.from({ length: 60 }, (_, k) => ({ name: 'P' + k, pos: 'WR' })) })) }));
  ok('team and player counts are capped', long.teams.length <= 24 && long.teams[0].players.length <= 40, `${long.teams.length} x ${long.teams[0].players.length}`);
  ok('the image budget is bounded', W.ROSTER_READ_MAX_IMAGES >= 1 && W.ROSTER_READ_MAX_IMAGES <= 12 && W.ROSTER_READ_MAX_BYTES <= 12 * 1024 * 1024);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
