#!/usr/bin/env node
// Guards the Value Coach on the DFS lineup — /dfs, dfs-coach.js.
//   node tools/test-dfs-coach.mjs
//
// The auction board's coach has always been keyed into the page's own numbers
// rather than into fantasy football in general; this is that coach aimed at
// the solved DFS roster, so a reader can ask the follow-up question the
// recommendation provokes. Four ways that goes wrong quietly:
//
//   1. THE BOUNDARY. Iron Tuna's numbers are software outputs (see
//      docs/ai-calculation-boundary.md). A chat panel sitting under a salary
//      table is the easiest place on the site for a model to start inventing
//      a projection, so the prompt has to forbid it in as many words and the
//      module has to carry no metric of its own to compute one from.
//   2. THE KEY. The coach must reach the model through /api/coach, the
//      server-side proxy, and never through a provider endpoint with a key in
//      the browser.
//   3. THE WIRING. The panel reads the page through coachContext() on every
//      ask, so every state that changes the roster — a rebuild, an infeasible
//      solve, an incomplete setup, a format with no Classic roster, a slate
//      that did not load, the pick'em board — has to tell it to look again.
//      Miss one and the coach answers about a lineup that is no longer there.
//   4. THE SIZE. /api/coach refuses a body over 80,000 bytes, so the context
//      is capped where it is assembled rather than trusted to stay small.
//
// Pure source reading plus the module itself — no browser, no network.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const page = read('dfs.html');
const src = read('dfs-coach.js');
const coach = require(path.join(ROOT, 'dfs-coach.js'));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Lift a declaration out of the page by counting braces. Safe here because the
// lifted functions carry no brace inside a string or a regex literal.
function lift(re) {
  const m = re.exec(page);
  if (!m) throw new Error('cannot lift ' + re);
  let d = 0;
  for (let i = page.indexOf('{', m.index); i < page.length; i++) {
    if (page[i] === '{') d++;
    else if (page[i] === '}') { d--; if (d === 0) return page.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced ' + re);
}

console.log('the module');
{
  ok('it exports a panel to mount and the prompt it mounts with',
     typeof coach.mount === 'function' && typeof coach.SYSTEM === 'string' && Array.isArray(coach.STARTERS));
  ok('it offers the reader somewhere to start', coach.STARTERS.length >= 3 && coach.STARTERS.every((q) => /\?$/.test(q)));
  // The prompt is prose about the page's numbers, so it is cut out before the
  // module's own code is read: what matters is that the CODE names none.
  const body = strip(src);
  const code = body.slice(0, body.indexOf('var SYSTEM = [')) + body.slice(body.indexOf("'LIVE DFS STATE (JSON):'"));
  ok('it talks to the server-side proxy and nothing else',
     /var ENDPOINT = '\/api\/coach'/.test(body) && (body.match(/fetch\(/g) || []).length === 1 && /fetch\(ENDPOINT,/.test(body));
  ok('no provider endpoint and no API key in the browser',
     !/api\.anthropic\.com|api\.openai\.com|chat\/completions|v1\/messages|x-api-key|Bearer /.test(body));
  ok('nothing here enters a contest',
     !/submitEntry|enterContest|\/api\/(entry|entries|bet)/i.test(body));
  // The module transports the page's numbers; it names none of them, so there
  // is nothing in it to recompute one from.
  ok('the module carries no metric of its own',
     !/ironTunaPoints|vegasPoints|consensusPoints|ceilingOf|floorOf|ownership|tdProbability/.test(code));
}

console.log('\nthe prompt');
{
  const s = coach.SYSTEM;
  ok('it forbids recomputing the page’s numbers',
     /Do NOT calculate, re-rank, re-project, interpolate, normalize or replace/.test(s));
  ok('it forbids inventing one that is not there',
     /do not invent one that is not there/.test(s) && /say plainly that the page does not carry it/.test(s));
  ok('it names the JSON as the only source of those numbers',
     /must be taken from that JSON, exactly as it is written there/.test(s));
  ok('it still lets the model use football knowledge for everything else',
     /use your own football knowledge freely for everything that is NOT one of this page/.test(s));
  ok('it explains the fields a reader will ask about',
     ['dkFppg', 'tunaEdge', 'leverage', 'own is Iron Tuna', 'vvs'].every((k) => s.includes(k)));
  ok('it says the operator average is history, not a projection',
     /HISTORICAL fantasy-points-per-game average, not a projection/.test(s));
  ok('it answers inside the contest shape the reader chose',
     /Answer inside the shape the reader is actually in/.test(s));
  ok('it writes for a chat panel that renders no markdown', /does NOT render markdown/.test(s) && /NO markdown/.test(s));
  ok('it places no bets and enters no contests',
     /must not tell anyone what to wager/.test(s) && /only builds a roster to copy/.test(s));
}

console.log('\nthe reply');
{
  ok('a bolded name is unbolded rather than shown with its asterisks',
     coach.tidy('**Nacua** is the play') === 'Nacua is the play');
  ok('a bulleted list loses its bullets', coach.tidy('- one\n- two') === 'one\ntwo');
  ok('a heading loses its hashes', coach.tidy('## The call\nTake him') === 'The call\nTake him');
  ok('plain prose is left alone', coach.tidy('Take Nacua at $7,800.') === 'Take Nacua at $7,800.');
}

console.log('\nthe payload the proxy will accept');
{
  // /api/coach slices `system` at 40,000 characters rather than refusing it,
  // so an oversized context would arrive as JSON cut off mid-object with the
  // model none the wiser. fit() is what stops that being possible.
  const row = (i) => ({ name: 'Player ' + i, pos: 'WR', team: 'LAR', salary: 5000 + i, proj: 12.3, floor: 6.1,
                        ceiling: 24.4, own: 9.1, leverage: 2.7, vegas: 12.9, consensus: 11.8, value: 104,
                        role: 'Supplies the salary relief that keeps the premium core intact while still projecting points, '.repeat(6) });
  const big = {
    slate: { site: 'DraftKings' }, setup: { contestShape: 'Cash' }, build: { objective: 'Safest floor' },
    thesis: 'x', lineups: [1, 2, 3].map(() => ({ players: Array.from({ length: 9 }, (_, i) => row(i)) })),
    pivots: Array.from({ length: 9 }, (_, i) => ({ slot: 'FLEX', outName: 'a', inName: 'b', dProj: i })),
    boardNotInLineup: Array.from({ length: 30 }, (_, i) => row(i)),
    games: Array.from({ length: 16 }, (_, i) => ({ game: 'A at B ' + i, total: 44.5 }))
  };
  const before = JSON.stringify(big).length;
  const after = coach.fit(JSON.parse(JSON.stringify(big)));
  ok('a payload already inside the budget is left exactly as it is',
     JSON.stringify(coach.fit({ lineups: [{ players: [row(1)] }] })) === JSON.stringify({ lineups: [{ players: [row(1)] }] }));
  ok('an oversized payload is fitted under the budget', JSON.stringify(after).length <= coach.JSON_BUDGET,
     before + ' -> ' + JSON.stringify(after).length + ' (budget ' + coach.JSON_BUDGET + ')');
  ok('the budget leaves room for the prompt inside the proxy\u2019s 40,000-character cap',
     coach.JSON_BUDGET + coach.SYSTEM.length < 40000);
  ok('the roster and the contest it was solved for survive every trim',
     after.lineups.length >= 1 && after.lineups[0].players.length === 9 && after.setup && after.build && after.thesis);
  ok('and the model is told what was dropped rather than left to assume it saw everything',
     Array.isArray(after.trimmedFromThisPrompt) && after.trimmedFromThisPrompt.length > 0,
     JSON.stringify(after.trimmedFromThisPrompt));
}

console.log('\nthe row the coach is handed');
{
  const mod = [lift(/function fppgEdge\(/), lift(/function coachN\(/), lift(/function coachRow\(/),
    'export { coachN, coachRow };'].join('\n');
  const { coachN, coachRow } = await import('data:text/javascript;base64,' + Buffer.from(mod, 'utf8').toString('base64'));
  ok('a number is rounded, never re-derived', coachN(18.44) === 18.4 && coachN(18.46) === 18.5 && coachN(0.0173, 2) === 0.02);
  ok('a missing number stays missing', coachN(null) === null && coachN(undefined) === null && coachN('x') === null);

  const p = { name: 'Puka Nacua', position: 'WR', team: 'LAR', opponent: 'SEA', home: false, salary: 7800,
              ironTunaPoints: 18.44, operatorFppg: 16.2, projectionVsFppg: 2.24, floor: 8.3, ceiling: 35.96,
              ownership: 21.4, leverage: 1.68, vegasPoints: 19.1, consensusPoints: 17.6,
              marketDelta: { classification: 'BUY', points: 1.5 }, tdProbability: 48.2, teamTotal: 24.5,
              value: 118, vegasValueScore: 121, cashScore: 109, tournamentScore: 114, chalk: 'chalk' };
  const r = coachRow(p, { slot: 'FLEX' });
  ok('every number rides through as the page computed it',
     r.salary === 7800 && r.proj === 18.4 && r.dkFppg === 16.2 && r.tunaEdge === 2.2
     && r.floor === 8.3 && r.ceiling === 36 && r.own === 21.4 && r.leverage === 1.7
     && r.value === 118 && r.vvs === 121 && r.cashScore === 109 && r.tourneyScore === 114,
     JSON.stringify(r));
  ok('the matchup reads the way the page prints it', r.opp === '@SEA' && r.slot === 'FLEX');
  ok('the market disagreement rides along as its own words', r.marketDelta === 'BUY +1.5');

  const thin = coachRow({ name: 'Bears ', position: 'DST', team: 'CHI', salary: 2600, ironTunaPoints: 7.1 });
  ok('a field the board does not carry is absent, not zero',
     !('own' in thin) && !('dkFppg' in thin) && !('tdPct' in thin) && thin.proj === 7.1,
     JSON.stringify(thin));
}

console.log('\nthe page');
{
  ok('the sheet loads the coach', page.includes('<script src="/dfs-coach.js" defer></script>'));
  ok('the panel sits with the lineup, under the roster and its pivots', (() => {
    const sec = page.indexOf('<section id="sec-lineup">');
    const end = page.indexOf('</section>', sec);
    const host = page.indexOf('<div id="dfCoach"></div>');
    return sec >= 0 && host > page.indexOf('<div id="dfPivots">', sec) && host < end;
  })());
  ok('it is mounted against the page’s own state, not a copy',
     /ITDfsCoach\.mount\(\{ host: \$\('dfCoach'\), context: coachContext \}\)/.test(page));
  ok('a deferred script that has not landed yet cannot break a build',
     /if \(window\.ITDfsCoach\) coachPanel = ITDfsCoach\.mount/.test(page)
     && /function coachSync\(\) \{ if \(coachPanel\) try \{ coachPanel\.refresh\(\); \} catch/.test(page));

  const ctx = lift(/function coachContext\(/);
  ok('with no roster on the page the coach is told why, rather than asked anyway',
     (ctx.match(/return \{ blocked:/g) || []).length >= 5);
  ok('the blocked reasons cover every state that has no lineup',
     [/isPickem\(\)/, /!slate/, /!setupReady\(\)/, /!styleSupportsOptimizer\(\)/, /!built \|\| !built\.lineups/]
       .every((re) => re.test(ctx)));
  ok('the context carries the contest, the roster, the swaps and the board behind them',
     ['slate:', 'setup:', 'build:', 'thesis:', 'lineups:', 'pivots:', 'boardNotInLineup:', 'games:']
       .every((k) => ctx.includes(k)));
  ok('it carries the locks, exclusions and the forced player the reader set',
     /forcedIn: whatIfKey/.test(ctx) && /locked:/.test(ctx) && /excluded:/.test(ctx));
  // /api/coach refuses a body over 80,000 bytes. Every list in the payload is
  // capped where it is built, so a 14-game slate cannot silently 413.
  ok('every list in the payload is capped',
     /pivotRows\(lead, solverPool\)\.slice\(0, 9\)/.test(ctx) && /\.slice\(0, 30\)/.test(ctx)
     && /\(view\.stacks \|\| \[\]\)\.slice\(0, 16\)/.test(ctx) && /built\.lineups\.slice\(0, 3\)/.test(ctx));

  // Every terminal state re-points the coach at the page.
  const syncs = (page.match(/coachSync\(\);/g) || []).length;
  ok('every state that changes the roster tells the coach to look again', syncs >= 7, syncs + ' calls');
  ok('including the solve that finds nothing legal',
     /No lineup satisfies those constraints[\s\S]{0,200}coachSync\(\);/.test(page));
  ok('including an incomplete DraftKings setup',
     /function showGameScopeRequired\(\)[\s\S]*?coachSync\(\);\n  \}/.test(page));
  ok('including a format with no Classic roster to show',
     /function renderFormatNotice\(\)[\s\S]*?coachSync\(\);\n  \}/.test(page));
  ok('including a slate that never loaded',
     /function slateNone\([\s\S]*?coachSync\(\);\n  \}/.test(page));
  ok('and the pick’em board, which has no cap and no roster at all',
     /loadPickem\(\);/.test(page) && /coachSync\(\);\n      loadPickem\(\);/.test(page));

  ok('the reader is told what the panel is and is not',
     page.includes('It does not enter contests or place bets.') || src.includes('It does not enter contests or place bets.'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
