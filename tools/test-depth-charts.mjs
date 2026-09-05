#!/usr/bin/env node
// Guards the Value Coach's depth-chart and injury grounding.
//   node tools/test-depth-charts.mjs
//
// Why this test exists: the coach's system prompt invites the model to answer
// backfield and target-share questions from its own football knowledge, and
// with nothing to check against it answered "who's behind Bijan?" from its
// training data — a roster or two stale, stated as confidently as a right
// answer. /api/live now carries Sleeper's depth-chart slot and rank for every
// fantasy player, index.html folds that into one table per team
// (depthChartsFromLive), buildCoachContext ships the table with every question,
// and the prompt hands it to the model as authoritative, the same way
// STAFFS_2026 settles who coaches whom.
//
// Four things can silently break that, so all four are asserted here:
//   1. the worker stops emitting the slot (a field rename upstream, a dropped
//      line), or keeps serving the old shape from cache (the key must bump);
//   2. the fold gets the order wrong — Sleeper ranks receivers ACROSS its three
//      slots (LWR/RWR/SWR), so a merge that sorted within a slot would call the
//      wrong man WR2;
//   3. the table stops reaching the prompt (a rename, a dropped concat);
//   4. the prompt stops telling the model the table beats its memory, or stops
//      saying so when the table never loaded, which is when it fills the gap.
//
// The injury line rides on the same feed and the same prompt, so it is pinned
// here too: the worker's body part, note and freshness; injuryLine folding
// every source the app has (feed, roster status, the hand-kept INJURIES table,
// the news desk) into one string, and undefined — never "none" — for a healthy
// player; the board-wide injuryReport; and the prompt's rule that a missing
// field means healthy as far as the feed knows.
//
// Pure functions only — no browser, no React, no network. The real declarations
// are lifted out of index.html by brace-matching so this can never drift into
// testing a re-implementation.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── lifting the real code out of index.html ───────────────────────────────
// Same scanner as tools/test-draft-edges.mjs: skips strings, comments AND regex
// literals, so a `/WR$/` inside the function does not open a string that never
// closes and run the brace matcher past the end of the declaration.
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const REGEX_OK_AFTER = '(,=:[!&|?{};+*%<>~^' + NL;
function scan(src, start, onChar) {
  let inS = null, inC = null, prev = '';
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inC) {
      if (inC === '//' && c === NL) inC = null;
      else if (inC === '/*' && c === '*' && n === '/') { inC = null; i++; }
      continue;
    }
    if (inS) {
      if (c === BS) { i++; continue; }
      if (inS === '/' && c === '[') { inS = '/['; continue; }
      if (inS === '/[') { if (c === ']') inS = '/'; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && n === '/') { inC = '//'; i++; continue; }
    if (c === '/' && n === '*') { inC = '/*'; i++; continue; }
    if (c === '/' && REGEX_OK_AFTER.indexOf(prev) !== -1) { inS = '/'; prev = c; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; prev = c; continue; }
    const r = onChar(c, i);
    if (r !== undefined) return r;
    if (c.trim()) prev = c;
  }
  return undefined;
}
function matchFrom(src, start, open, close) {
  let d = 0;
  const r = scan(src, start, (c, i) => {
    if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return i; }
  });
  return r === undefined ? -1 : r;
}
function endOfStatement(src, start) {
  let d = 0;
  const r = scan(src, start, (c, i) => {
    if ('{[('.indexOf(c) !== -1) d++;
    else if ('}])'.indexOf(c) !== -1) d--;
    else if (c === ';' && d === 0) return i;
  });
  return r === undefined ? -1 : r;
}
function liftFunction(name) {
  const m = new RegExp('^function' + BS + 's+' + name + BS + 's*' + BS + '(', 'm').exec(idx);
  if (!m) throw new Error('cannot lift function ' + name);
  const pi = idx.indexOf('(', m.index), pe = matchFrom(idx, pi, '(', ')');
  const bi = idx.indexOf('{', pe), be = matchFrom(idx, bi, '{', '}');
  return idx.slice(m.index, be + 1);
}
function liftDecl(name) {
  const m = new RegExp('^(?:const|let)' + BS + 's+' + name + BS + 's*=', 'm').exec(idx);
  if (!m) throw new Error('cannot lift declaration ' + name);
  return idx.slice(m.index, endOfStatement(idx, m.index) + 1);
}
const src = [
  liftDecl('DEPTH_KEEP'), liftDecl('DEPTH_TAG'), liftDecl('_depthCache'), liftDecl('INJURIES'),
  liftFunction('_liveNorm'), liftFunction('applyLiveStatus'), liftFunction('depthChartsFromLive'),
  liftFunction('injuryOf'), liftFunction('injuryLine'),
  'export { applyLiveStatus, depthChartsFromLive, injuryLine };'
].join('\n');
const { applyLiveStatus, depthChartsFromLive, injuryLine } = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));

// ── 1. the worker emits the slot, under a fresh cache key ─────────────────
const liveStart = worker.indexOf("url.pathname === '/api/live'");
const liveBody = worker.slice(liveStart, liveStart + 3000);
ok('_worker.js serves /api/live', liveStart > 0);
ok('/api/live carries depth_chart_position and depth_chart_order as d',
  /rec\.d = \[p\.depth_chart_position, p\.depth_chart_order\]/.test(liveBody));
ok('/api/live leaves team defences without a slot', /p\.position !== 'DEF' && p\.depth_chart_position/.test(liveBody));
ok('/api/live bumped its edge-cache key past the shape without d',
  /'\/api\/live\?v=3'/.test(liveBody) && !/'\/api\/live\?v=2'/.test(liveBody));
// The worker's key only clears the worker's cache. The edge and the browser
// cache the URL, so the client has to ask for the same version in the URL or
// readers keep the old payload for six hours -- which is exactly how the
// depth charts "did not take" on launch day.
const workerV = (liveBody.match(/'\/api\/live\?v=(\d+)'/) || [])[1];
const clientV = (idx.match(/const LIVE_FEED_VERSION = (\d+);/) || [])[1];
ok('the client requests /api/live with the same version the worker keys on',
  !!workerV && workerV === clientV && /fetch\('\/api\/live\?v=' \+ LIVE_FEED_VERSION\)/.test(idx),
  `worker v=${workerV}, client v=${clientV}`);
ok('/api/live carries the body part, the note and the freshness of a designation',
  /rec\.b = String\(p\.injury_body_part\)/.test(liveBody) && /rec\.n = String\(p\.injury_notes\)/.test(liveBody) && /rec\.u = \+p\.news_updated/.test(liveBody));
ok('/api/live only sends injury detail for a player with a designation', /if \(inj\) \{\s*if \(p\.injury_body_part\)/.test(liveBody));

// ── 2. the fold: order, merge, tags, trim ─────────────────────────────────
// The shape /api/live serves, keyed by name. Receiver ranks run across the three
// slots, exactly as Sleeper publishes them: PHI's WR1 is at LWR, WR2 at RWR.
const live = {
  'Jalen Hurts':      { t: 'PHI', i: null, s: 'Active', d: ['QB', 1] },
  'Tanner McKee':     { t: 'PHI', i: null, s: 'Active', d: ['QB', 3] },
  'Andy Dalton':      { t: 'PHI', i: null, s: 'Active', d: ['QB', 2] },
  'Saquon Barkley':   { t: 'PHI', i: null, s: 'Active', d: ['RB', 1] },
  'Will Shipley':     { t: 'PHI', i: null, s: 'Active', d: ['RB', 3] },
  'Tank Bigsby':      { t: 'PHI', i: 'Questionable', s: 'Active', d: ['RB', 2], b: 'Hamstring', u: Date.UTC(2026, 8, 2, 12) },
  'RB Four':          { t: 'PHI', i: null, s: 'Active', d: ['RB', 4] },
  'RB Five':          { t: 'PHI', i: null, s: 'Active', d: ['RB', 5] },
  'DeVonta Smith':    { t: 'PHI', i: null, s: 'Active', d: ['LWR', 1] },
  'Dontayvion Wicks': { t: 'PHI', i: null, s: 'Active', d: ['RWR', 2] },
  'Makai Lemon':      { t: 'PHI', i: null, s: 'Active', d: ['SWR', 3] },
  'Marquise Brown':   { t: 'PHI', i: null, s: 'Active', d: ['SWR', 4] },
  'Darius Cooper':    { t: 'PHI', i: null, s: 'Active', d: ['RWR', 5] },
  'Elijah Moore':     { t: 'PHI', i: null, s: 'Active', d: ['LWR', 6] },
  'Dallas Goedert':   { t: 'PHI', i: null, s: 'Active', d: ['TE', 1] },
  'Grant Calcaterra': { t: 'PHI', i: 'IR', s: 'Inactive', d: ['TE', 3] },
  'Eli Stowers':      { t: 'PHI', i: 'Questionable', s: 'Active', d: ['TE', 2] },   // tagged, no body part
  'Johnny Wilson':    { t: 'PHI', i: 'IR', s: 'Inactive', d: [null, 9] },     // slot unknown: skipped
  'Patrick Mahomes':  { t: 'KC',  i: 'Questionable', s: 'Active', d: ['QB', 1], b: 'Knee - ACL', n: 'Surgery', u: Date.UTC(2026, 8, 1, 12) },
  'Justin Fields':    { t: 'KC',  i: null, s: 'Active', d: ['QB', 2] },
  'Jake Elliott':     { t: 'PHI', i: null, s: 'Active' },                     // no d at all (a kicker)
  'Old Team Guy':     { t: null,  i: 'Out', s: 'Active', d: ['RB', 1] },      // no team: nowhere to file him
  'Wrong Order':      { t: 'ARI', i: null, s: 'Active', d: ['RB', 'x'] },     // unparseable rank: skipped
};
const table = depthChartsFromLive(live);
ok('the fold returns a table keyed by team', !!table && typeof table === 'object');
ok('teams come out sorted', JSON.stringify(Object.keys(table)) === JSON.stringify(['KC', 'PHI']), JSON.stringify(Object.keys(table)));
ok('QB is in rank order, not feed order, and cut to QB2',
  JSON.stringify(table.PHI.QB) === JSON.stringify(['Jalen Hurts', 'Andy Dalton']), JSON.stringify(table.PHI.QB));
ok('receivers merge across LWR/RWR/SWR into one order, cut to WR5',
  JSON.stringify(table.PHI.WR) === JSON.stringify(['DeVonta Smith', 'Dontayvion Wicks', 'Makai Lemon', 'Marquise Brown', 'Darius Cooper']), JSON.stringify(table.PHI.WR));
ok('the injury tag rides on the name, abbreviated, with the body part when the feed has one',
  JSON.stringify(table.PHI.RB) === JSON.stringify(['Saquon Barkley', 'Tank Bigsby (Q, hamstring)', 'Will Shipley', 'RB Four']), JSON.stringify(table.PHI.RB));
ok('a tag without a body part stays a bare tag', table.PHI.TE[1] === 'Eli Stowers (Q)');
ok('RB is cut to RB4', table.PHI.RB.length === 4 && !table.PHI.RB.includes('RB Five'));
ok('TE is cut to TE2, so an IR TE3 never shows',
  JSON.stringify(table.PHI.TE) === JSON.stringify(['Dallas Goedert', 'Eli Stowers (Q)']), JSON.stringify(table.PHI.TE));
ok('a slot of null is skipped rather than filed under "null"',
  !Object.values(table.PHI).flat().includes('Johnny Wilson') && !('null' in table.PHI));
ok('a player without d, a player without a team, and an unparseable rank all stay out',
  !Object.values(table.PHI).flat().includes('Jake Elliott') && !table.ARI
  && !Object.values(table).flatMap(t => Object.values(t).flat()).includes('Old Team Guy'));
ok('KC carries the QB tag too, body part lower-cased, the note kept off the chart',
  JSON.stringify(table.KC.QB) === JSON.stringify(['Patrick Mahomes (Q, knee - acl)', 'Justin Fields']), JSON.stringify(table.KC.QB));
ok('the same payload is folded once (memoised by identity)', depthChartsFromLive(live) === table);
ok('a payload with no slots folds to null, not an empty table', depthChartsFromLive({ 'Jake Elliott': { t: 'PHI', i: null, s: null } }) === null);
ok('no payload folds to null', depthChartsFromLive(null) === null);

// ── applyLiveStatus puts the slot on the board player ─────────────────────
const board = applyLiveStatus([
  { id: 'a', name: 'Tank Bigsby', position: 'RB', team: 'PHI' },
  { id: 'b', name: 'Makai Lemon', position: 'WR', team: 'PHI' },
  { id: 'c', name: 'PHI DEF', position: 'DEF', team: 'PHI' },
  { id: 'd', name: 'Nobody Here', position: 'RB', team: 'PHI' },
], live);
ok('applyLiveStatus sets depthPos/depthOrder from d', board[0].depthPos === 'RB' && board[0].depthOrder === 2 && board[0].injuryStatus === 'Questionable');
ok('applyLiveStatus carries the body part, freshness and roster status onto the player',
  board[0].injuryBodyPart === 'Hamstring' && board[0].injuryUpdated === Date.UTC(2026, 8, 2, 12) && board[0].rosterStatus === 'Active' && !('injuryNotes' in board[0]));
ok('a healthy player gets no injury detail', !('injuryBodyPart' in board[1]) && !('injuryStatus' in board[1]) && board[1].rosterStatus === 'Active');
ok('a receiver keeps his raw Sleeper slot on the player', board[1].depthPos === 'SWR' && board[1].depthOrder === 3);
ok('an unmatched player is untouched', !('depthPos' in board[3]));

// ── 3 & 4. the table reaches the prompt, and the prompt says what it is ───
const ctxStart = idx.indexOf('function buildCoachContext(');
const ctxBody = idx.slice(ctxStart, ctxStart + 8000);
ok('buildCoachContext takes depthCharts off its ctx', /games,\s*depthCharts\s*\} = ctx;/.test(ctxBody));
ok('buildCoachContext ships depthCharts with the state', /depthCharts: depthCharts \|\| undefined/.test(ctxBody));
ok('each slim player carries his depth slot', /depth: p\.depthPos \?/.test(ctxBody));
ok('a receiver\'s slot is reported as WRn, not LWRn',
  /\/WR\$\/\.test\(p\.depthPos\) \? 'WR' : p\.depthPos/.test(ctxBody));
const callers = idx.match(/depthCharts: depthChartsFromLive\(LIVE_STATUS\)/g) || [];
ok('both coach call sites hand the live table over (the chat coach and the Fable dock)', callers.length === 2, `${callers.length} call sites`);
ok('fetchLiveStatus keeps the payload where the coach can find it', /if \(out\) LIVE_STATUS = out;/.test(idx));
ok('the depth block is built from the context', /_depthCtx = contextObj && contextObj\.depthCharts/.test(idx));
ok('the depth block reaches the system prompt', /const sys = _coachId \+ _seasonCtx \+ _staffCtx \+ _depthCtx/.test(idx));
ok('the prompt tells the model the table beats its memory', /overrides your memory on who starts and who backs up whom/.test(idx));
ok('the prompt explains the injury tags it will see', /Q questionable, D doubtful, O out, IR, PUP, SUS suspended/.test(idx));
ok('the prompt refuses to guess for a team off the table', /say the depth chart is not loaded for them rather than guessing/.test(idx));
ok('the prompt says so when the table never loaded', /the live depth charts did not load this session/.test(idx));

// ── the injury line: every source, one string, nothing for a healthy player ──
const inj = injuryLine(board[0]);
ok('injuryLine folds status, body part and freshness',
  inj === 'Questionable, Hamstring (updated Sep 2)', inj);
const mah = injuryLine(applyLiveStatus([{ id: 'm', name: 'Patrick Mahomes', position: 'QB', team: 'KC' }], live)[0]);
ok('injuryLine keeps the feed note', mah === 'Questionable, Knee - ACL: Surgery (updated Sep 1)', mah);
ok('a healthy player has NO injury line, not "none"', injuryLine(board[1]) === undefined && injuryLine({ name: 'Nobody', position: 'RB' }) === undefined);
ok('a non-Active roster status shows even without a designation',
  injuryLine({ name: 'X', rosterStatus: 'Injured Reserve' }) === 'roster status Injured Reserve');
ok('an Active roster status is not worth a word', injuryLine({ name: 'X', rosterStatus: 'Active' }) === undefined);
const newsLine = injuryLine({ name: 'Bijan Robinson', projOverride: { src: 'news', pct: -5.9, label: 'Out', note: 'hamstring' } });
ok('the news desk rides on the line with its percent',
  newsLine === 'news desk: Out, hamstring (-6% to his projection)', newsLine);
ok('a manual projection edit is not an injury', injuryLine({ name: 'X', projOverride: { src: 'manual', pct: 12 } }) === undefined);
const both = injuryLine({ name: 'X', injuryStatus: 'Out', injuryBodyPart: 'Knee', projOverride: { src: 'news', pct: -100, label: 'Out for the season', note: '' } });
ok('feed and news desk both show, feed first', both === 'Out, Knee; news desk: Out for the season (-100% to his projection)', both);
// Whoever the hand-kept table lists first today; the table turns over, the rule does not.
const handKept = (idx.match(/^const INJURIES = \[\[\/([^/]+)\/i, '([^']+)'\]/m) || []);
ok('the hand-kept INJURIES note fills in for a player the feed has not tagged',
  handKept.length === 3 && injuryLine({ name: handKept[1], position: 'RB' }) === handKept[2],
  handKept.length === 3 ? `${handKept[1]} -> ${injuryLine({ name: handKept[1], position: 'RB' })}` : 'INJURIES table not found');

// ── the report reaches the prompt, and the prompt says what a missing field means ──
ok('each slim player carries the whole injury line', /injury: injuryLine\(p\),/.test(ctxBody));
ok('buildCoachContext builds injuryReport off every board player, drafted or not',
  /const injuryReport = \(evalPlayers \|\| \[\]\)\.map\(p => \(\{ p, line: injuryLine\(p\) \}\)\)/.test(ctxBody));
ok('injuryReport is capped and best-projection first', /\.sort\(\(a, b\) => \(b\.p\.projectedPoints \|\| 0\) - \(a\.p\.projectedPoints \|\| 0\)\)\.slice\(0, 60\)/.test(ctxBody));
ok('injuryReport ships with the state, absent when empty', /injuryReport: injuryReport\.length \? injuryReport : undefined/.test(ctxBody));
ok('the injury block reaches the system prompt', /const sys = _coachId \+ _seasonCtx \+ _staffCtx \+ _depthCtx \+ _injuryCtx/.test(idx));
ok('the prompt says the designations beat the model\'s memory', /INJURY REPORT: [^"]*come from the same live feed as the depth charts and override your memory/.test(idx));
ok('the prompt says the news desk wins over the feed', /when it disagrees with the feed the news desk wins/.test(idx));
ok('the prompt says a missing field means healthy as far as the feed knows, and never to invent one',
  /A player with no injury field is healthy as far as the feed knows: never assert an injury the data does not show/.test(idx));
ok('the prompt joins injuries to the depth chart', /use the depth chart to name who benefits/.test(idx));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
