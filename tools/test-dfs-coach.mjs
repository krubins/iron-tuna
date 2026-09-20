#!/usr/bin/env node
// Guards the Value Coach on the DFS lineup — /dfs, dfs-coach.js.
//   node tools/test-dfs-coach.mjs
//
// The auction board's coach has always been keyed into the page's own numbers
// rather than into fantasy football in general; this is that coach aimed at
// the solved DFS roster, so a reader can ask the follow-up question the
// recommendation provokes. Five ways that goes wrong quietly:
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
//   5. THE SETUP. The coach also answers at the three selects the page opens
//      with, before any roster exists, because choosing the contest is the
//      decision that produces the roster. That mode has its own way to go
//      wrong: a model asked "which contest should I enter" will happily
//      invent one, or an entry fee, or a field size, none of which the page
//      carries. It answers from the page's own catalog of options or not at
//      all, and it still names no stake.
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
  // A reader at the three selects has no roster to ask about, so the openers
  // cannot be about one.
  ok('and somewhere else to start when there is no roster yet, only a contest to pick',
     Array.isArray(coach.SETUP_STARTERS) && coach.SETUP_STARTERS.length >= 3
     && coach.SETUP_STARTERS.every((q) => /\?$/.test(q))
     && !coach.SETUP_STARTERS.some((q) => coach.STARTERS.includes(q)));
  ok('the openers follow the mode the page is in',
     coach.startersFor({ mode: 'setup' }) === coach.SETUP_STARTERS
     && coach.startersFor({ mode: 'lineup' }) === coach.STARTERS
     && coach.startersFor(null) === coach.STARTERS);
  ok('a setup with no lineup is something to answer, not something to wait for',
     /function grounded\(ctx\) \{ return !!\(ctx && \(ctx\.mode === 'setup' \|\| \(ctx\.lineups && ctx\.lineups\.length\)\)\); \}/.test(src)
     && /if \(!grounded\(ctx\)\) \{ refresh\(\); return; \}/.test(src));
  ok('and the chrome says which of the two it is reading, rather than claiming a lineup that is not there',
     /elLive\.textContent = setup \? 'live on your setup' : 'live on this lineup'/.test(src)
     && /elText\.placeholder = setup/.test(src)
     && /starters = startersFor\(ctx\)/.test(src));
  // A dock is closed by its page; an inline panel minimizes itself. The module
  // does both so it does not depend on being floated.
  ok('a host that closes is closed, and one that does not still minimizes in place',
     /var onClose = typeof o\.onClose === 'function' \? o\.onClose : null;/.test(src)
     && /\(onClose \? 'Close' : 'Minimize'\)/.test(src)
     && /if \(onClose\) \{ onClose\(\); return; \}/.test(src));
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
  // THE LINE IN SETUP MODE. "Which contest should I enter" is a strategy
  // question and the coach answers it. "How much should I put on it" is not.
  ok('picking a structure is its job; naming a stake is not',
     /Recommending which contest STRUCTURE suits a build is strategy and is your job/.test(s)
     && /name no entry fee and no stake even when the reader asks for one/.test(s));
  ok('it knows which of the two questions it is being asked',
     /The JSON carries a mode\./.test(s) && /When it is "setup"/.test(s) && /When it is "lineup"/.test(s));
  ok('it recommends only from the options the page actually offers',
     /Recommend from that list and nothing else/.test(s)
     && /never invent a contest, a payout table, an entry fee, a field size, a prize pool or an entry limit/.test(s));
  ok('the contest recommendation is the page\u2019s, quoted, not the model\u2019s own',
     /The page\u2019s own read is playOfTheWeek/.test(s) && /Quote it as the page\u2019s call/.test(s));
  ok('it keeps the order the page asks the three questions in',
     /Keep the page\u2019s order - style, then games, then payout/.test(s));
  ok('and it says plainly which format Iron Tuna solves a roster for',
     /Iron Tuna solves a roster for Classic only/.test(s));
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
  // THE BUG THIS REPLACED. The panel used to sit inside #sec-lineup under the
  // pivots, which put it a full screen below the lineup, at the end of the
  // section, competing with the fine-tune panel. A reader reading the roster
  // never met it. It is a launcher and a dock now, both at page level so a
  // section switch cannot take them away and a fixed dock is not nested in a
  // container that scrolls or hides.
  ok('the launcher and the dock are at page level, not buried in a section', (() => {
    const lastSection = page.lastIndexOf('</section>');
    const fab = page.indexOf('<button type="button" class="df-coach-fab"');
    const dock = page.indexOf('<div id="dfCoach"');
    return fab > lastSection && dock > fab && dock < page.indexOf('</main>');
  })());
  ok('the dock is closed until the launcher asks for it',
     /<div id="dfCoach" class="df-coach" role="dialog"[^>]*hidden>/.test(page)
     && /aria-expanded="false" aria-controls="dfCoach"/.test(page));
  ok('the launcher says what it opens, in text and not only in an icon',
     /<span>Value Coach<\/span>/.test(page) && /class="df-coach-fab"[\s\S]{0,400}<svg/.test(page));
  ok('opening and closing move the same two things, so they cannot disagree',
     /function coachOpen\(\) \{ return !\$\('dfCoach'\)\.hidden; \}/.test(page)
     && /dock\.hidden = false;\s*\n\s*fab\.setAttribute\('aria-expanded', 'true'\);/.test(page)
     && /dock\.hidden = true;\s*\n\s*fab\.setAttribute\('aria-expanded', 'false'\);/.test(page));
  ok('a dock opened before the roster existed re-reads the page as it opens',
     /dock\.hidden = false;[\s\S]{0,200}coachSync\(\);/.test(page));
  ok('opening moves focus into the dock and closing gives it back to the launcher',
     /box && !box\.disabled \? box : dock\.querySelector\('\.df-coach-toggle'\)/.test(page)
     && /fab\.focus\(\)/.test(page));
  ok('Escape closes the dock, and the player modal still goes first because it is on top',
     /if \(!\$\('dfPlayerModal'\)\.hidden\) \{ closePlayerCalc\(\); return; \}/.test(page)
     && /if \(coachOpen\(\)\) closeCoach\(\);/.test(page));
  ok('the launcher is wired to the toggle', /\$\('dfCoachFab'\)\.addEventListener\('click', toggleCoach\);/.test(page));
  ok('the dock is under the player modal and over the tooltips', (() => {
    const z = (re) => Number((page.match(re) || [])[1]);
    return z(/\.df-coach\{position:fixed;[^}]*z-index:(\d+)/) < 1000
        && z(/\.df-coach\{position:fixed;[^}]*z-index:(\d+)/) > 121;
  })());
  ok('the dock scrolls its conversation rather than growing past the window',
     /\.df-coach\{position:fixed;[^}]*max-height:min\(76vh,700px\)/.test(page)
     && /\.df-coach-body\{[^}]*overflow-y:auto/.test(page));
  ok('on a phone it is a sheet across the width, not a 390px box off the edge',
     /\.df-coach\{right:8px;left:8px;bottom:8px;width:auto/.test(page));
  ok('it is mounted against the page’s own state, not a copy',
     /ITDfsCoach\.mount\(\{ host: \$\('dfCoach'\), context: coachContext, onClose: closeCoach \}\)/.test(page));
  ok('a deferred script that has not landed yet cannot break a build',
     /if \(!mountCoach\(\)\) \{/.test(page)
     && /function coachSync\(\) \{ if \(coachPanel\) try \{ coachPanel\.refresh\(\); \} catch/.test(page));

  // THE BUG THIS BLOCK EXISTS FOR. The panel used to be an empty <div> that
  // dfs-coach.js filled, so a page served without that file showed nothing at
  // all between the pivots and the fine-tune panel: no coach, no error, no
  // clue. The chrome now ships in the markup and the script only replaces it.
  ok('the panel is in the markup, so a missing script leaves a reason and not a gap', (() => {
    const at = page.indexOf('<div id="dfCoach"');
    const host = page.slice(at, page.indexOf('</main>', at));
    return /class="df-coach"/.test(host) && /df-coach-title/.test(host) && /id="dfCoachBoot"/.test(host);
  })());
  ok('and the launcher stops looking ready when the coach behind it never loaded',
     /fab\.classList\.add\('df-coach-fab-bad'\); fab\.title = msg;/.test(page)
     && /\.df-coach-fab-bad\{/.test(page));
  ok('a retry that works puts the launcher back',
     /if \(mountCoach\(\)\) \{ var fab = \$\('dfCoachFab'\); if \(fab\) \{ fab\.classList\.remove\('df-coach-fab-bad'\)/.test(page));
  ok('the mount is guarded on the script being there AND on it not throwing',
     /if \(!window\.ITDfsCoach \|\| typeof ITDfsCoach\.mount !== 'function'\) return false;/.test(page)
     && /catch \(err\) \{ coachPanel = null; \}/.test(page));
  ok('a coach that never loaded says so where the panel would be',
     /coachBoot\('The Value Coach did not load with the page\.', true\)/.test(page));
  ok('and offers a retry that re-fetches the file rather than only telling the reader to reload',
     /function coachReload\(\)/.test(page) && /sc\.src = '\/dfs-coach\.js\?r=' \+ Date\.now\(\)/.test(page)
     && /sc\.onerror = function/.test(page));
  ok('a retry that arrives but cannot start is not silent either',
     /else coachBoot\('The coach loaded but could not start\. Reload the page\.', false\);/.test(page));
  ok('the retry button has a style to wear', /\.df-coach-retry\{/.test(page));
  ok('the badge stops saying "starting" once it is clear nothing started',
     /var live = \$\('dfCoachLive'\); if \(live\) live\.textContent = badge \|\| 'not loaded';/.test(page));

  const ctx = lift(/function coachContext\(/);
  ok('with nothing on the page to ground an answer the coach is told why, rather than asked anyway',
     (ctx.match(/return \{ blocked:/g) || []).length >= 3);
  ok('the blocked reasons cover the states with neither a roster nor a setup to talk about',
     [/isPickem\(\)/, /!slate/, /!built \|\| !built\.lineups/].every((re) => re.test(ctx)));
  // THE CHANGE THIS BLOCK EXISTS FOR. An unfinished setup used to be a refusal:
  // the reader was told to go and fill in three selects, which is exactly the
  // moment they had a question. Both of those states hand the coach the setup
  // now, and only the thing it is looking at changes.
  ok('an unfinished setup and a format with no Classic roster are answered, not refused',
     /if \(site === 'dk' && \(!setupReady\(\) \|\| !styleSupportsOptimizer\(\)\)\) return setupContext\(\);/.test(ctx)
     && !ctx.split('\n').some((l) => /!setupReady\(\)|!styleSupportsOptimizer\(\)/.test(l) && /return \{ blocked:/.test(l)));
  ok('the context carries the contest, the roster, the swaps and the board behind them',
     ['slate:', 'setup:', 'build:', 'thesis:', 'lineups:', 'pivots:', 'boardNotInLineup:', 'games:']
       .every((k) => ctx.includes(k)));
  ok('and says which of the two questions it is answering, so the panel and the model agree',
     /mode: 'lineup'/.test(ctx) && /mode: 'setup'/.test(lift(/function setupContext\(/)));
  ok('the roster context carries the other payout structures too, because that question outlives the build',
     /choices: setupChoices\(false\)/.test(ctx) && /playOfTheWeek: playWeek/.test(ctx));
  ok('it carries the locks, exclusions and the forced player the reader set',
     /forcedIn: whatIfKey/.test(ctx) && /locked:/.test(ctx) && /excluded:/.test(ctx));
  // /api/coach refuses a body over 80,000 bytes. Every list in the payload is
  // capped where it is built, so a 14-game slate cannot silently 413.
  const setup = lift(/function setupContext\(/);
  ok('the setup context carries the three choices, what is still missing and the slate behind them',
     ['awaiting:', 'readerIsChoosing:', 'setup:', 'choices:', 'slate:', 'playOfTheWeek:'].every((k) => setup.includes(k)));
  ok('it says which format Iron Tuna solves a roster for rather than leaving an empty board unexplained',
     /ironTunaSolvesARoster: styleSupportsOptimizer\(\)/.test(setup) && /whyNoRosterYet:/.test(setup));
  ok('a page with no salaries still answers on the two choices that do not need them',
     /No salary slate is loaded yet, so the page lists no games to choose from/.test(setup));
  ok('every list in the payload is capped',
     /pivotRows\(lead, solverPool\)\.slice\(0, 9\)/.test(ctx) && /\.slice\(0, 30\)/.test(ctx)
     && /\(view\.stacks \|\| \[\]\)\.slice\(0, 16\)/.test(ctx) && /built\.lineups\.slice\(0, 3\)/.test(ctx)
     && /\.slice\(0, 16\)\.map/.test(lift(/function setupChoices\(/)));

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

  // The floating launcher is at the bottom of the window; the three selects are
  // at the top of the page. A reader stuck on them should not have to guess
  // that the thing in the corner answers on this too.
  ok('the setup plate carries its own way into the coach',
     /<button type="button" class="df-setup-coach" id="dfSetupCoach" aria-controls="dfCoach"[^>]*>/.test(page)
     && /Ask the Value Coach/.test(page) && /\.df-setup-coach\{/.test(page));
  ok('and it opens the dock rather than toggling it shut from across the page',
     /\$\('dfSetupCoach'\)\.addEventListener\('click', openCoach\);/.test(page));
  // The page compares a floor build, a ceiling build and a leverage build and
  // prints which structure this slate rewards. The coach quotes that; without
  // it, "which contest should I enter" has no page number behind it at all.
  ok('the page\u2019s own contest recommendation is kept for the coach to quote',
     /playWeek=\{ recommendedPayout:rec/.test(page) && /projectionVsVegasPct:coachN\(edge\*100\)/.test(page));
  ok('and it is cleared rather than left stale when the slate cannot support one',
     /playWeek=null;\n    if\(players\.length<9\)/.test(page));
  ok('a setup choice that rebuilds nothing still tells the coach to look again',
     (lift(/function updateSetupState\(/).match(/coachSync\(\);/g) || []).length >= 2);
}

console.log('\nthe catalog the setup coach recommends from');
{
  // Executed against the page's own tables, because the whole point of the
  // catalog is that it IS the page's options: a recommendation has to be one
  // of the things in the select in front of the reader.
  const mod = [
    lift(/var GAME_STYLES = \{/), lift(/var PAYOUTS = \{/), lift(/var SHAPES = \{/), lift(/function coachN\(/),
    "var gameStyle = 'classic', payoutStructure = 'double-up';",
    "var selectedGames = { 'LAR|SEA': true };",
    "var slate = { stacks: [{ game: 'LAR @ SEA', away: { team: 'LAR' }, home: { team: 'SEA' }, total: 47.53, impliedAway: 23.29, impliedHome: 24.24 }] };",
    "function stackGameKey(g) { return g.away.team + '|' + g.home.team; }",
    "function kickoffText() { return 'Sun 4:05 PM ET'; }",
    "function gamesForSlate() { return Array.from({ length: 20 }, (_, i) => ({ key: i ? 'A' + i + '|B' + i : 'LAR|SEA', label: i ? 'A' + i + ' @ B' + i : 'LAR @ SEA', players: 40, start: null })); }",
    lift(/function setupChoices\(/),
    'export { setupChoices, PAYOUTS, GAME_STYLES };'
  ].join('\n');
  const { setupChoices, PAYOUTS, GAME_STYLES } = await import('data:text/javascript;base64,' + Buffer.from(mod, 'utf8').toString('base64'));
  const all = setupChoices(true);

  ok('every payout structure the select offers is in the catalog, with the note the page prints under it',
     all.payouts.length === Object.keys(PAYOUTS).length
     && Object.keys(PAYOUTS).every((k) => all.payouts.some((r) => r.payout === PAYOUTS[k].label && r.means === PAYOUTS[k].note)),
     JSON.stringify(all.payouts.map((r) => r.payout)));
  ok('each one says what Iron Tuna would solve for it, so the advice lands on a build and not a vibe',
     all.payouts.every((r) => typeof r.ironTunaSolvesItAs === 'string' && r.ironTunaSolvesItAs.length));
  ok('every game style the select offers is there too',
     all.gameStyles.length === Object.keys(GAME_STYLES).length);
  ok('and only Classic claims a solved roster',
     all.gameStyles.filter((r) => r.ironTunaSolvesARoster).map((r) => r.gameStyle).join() === GAME_STYLES.classic.label);
  ok('what the reader has already chosen is marked as chosen',
     all.payouts.filter((r) => r.chosen).map((r) => r.payout).join() === 'Double Up'
     && all.gameStyles.filter((r) => r.chosen).map((r) => r.gameStyle).join() === 'Classic');
  ok('the games carry the market the page posted for them, rounded and not re-derived',
     all.games[0].game === 'LAR @ SEA' && all.games[0].total === 47.5
     && all.games[0].impliedAway === 23.3 && all.games[0].impliedHome === 24.2 && all.games[0].selected === true,
     JSON.stringify(all.games[0]));
  ok('a game with no posted total is absent, not zero',
     all.games[1].total === null && !('selected' in all.games[1]));
  ok('the game list is capped where it is built', all.games.length === 16);
  ok('the roster context takes the payouts alone, because that is the question a reader asks with a lineup on screen',
     !!setupChoices(false).payouts && !setupChoices(false).games && !setupChoices(false).gameStyles);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
