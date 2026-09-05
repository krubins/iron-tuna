#!/usr/bin/env node
// Tests that the Value Coach and the Fable panel actually SEE the rest of the room.
//   node tools/test-coach-room.mjs
//
// THE BUG THIS EXISTS FOR: buildCoachContext destructured `teams` and
// `marketState` out of its ctx and then never put either into the object it
// returned. Both coaches shipped knowing the league SIZE and nothing else about
// the other managers — no budgets, no roster holes, no read on who could outbid
// you — while the insight strip six inches away had computed all of it since
// generateTeamInsights was written. An auction turns on exactly those questions,
// so the coach was answering "can I be outbid on him?" from data it did not have.
//
// These checks pin the fields down by behaviour, not by presence: a rival who
// cannot afford a player must not count as a bidder, and runnerUp must track the
// SECOND-best able bidder, because that is where the price actually settles.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// The coach helpers are plain top-level function declarations in the app script,
// so they lift out and run without a DOM. Declarations only bind names, so
// pulling all of them in costs nothing and keeps this from breaking every time
// buildCoachContext picks up another helper.
const script = html.slice(html.indexOf('<script type="module">') + 22);
const src = script.slice(0, script.indexOf('</script>'));
const decls = [];
const re = /^function [A-Za-z_$][\w$]*\s*\(/gm;
let m;
while ((m = re.exec(src))) {
  const start = m.index;
  re.lastIndex = start + m[0].length;
  const next = src.slice(start + 1).search(/^(?:function |const |let |var |class )/m);
  decls.push(src.slice(start, next < 0 ? src.length : start + 1 + next));
}
// Live-feed tables the helpers read at call time. Empty is the honest fixture:
// nobody in this league has an injury designation or a news-desk note.
const sandbox = { console, Math, Date, JSON, Set, Map, Object, Array, Number, String, isNaN, parseInt, parseFloat, INJURIES: [], LIVE_STATUS: null, NEWS_DESK: [] };
vm.createContext(sandbox);
new vm.Script(decls.join('\n')).runInContext(sandbox);
ok('buildCoachContext lifts out of index.html', typeof sandbox.buildCoachContext === 'function');
if (typeof sandbox.buildCoachContext !== 'function') { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

// ------------------------------------------------------------------- fixture
// A 4-team, $200 auction: 1QB/2RB/2WR/1TE plus a flex.
const config = {
  format: 'auction', teams: 4, budget: 200,
  scoring: { receptionPoints: 1 },
  roster: { QB: { starters: 1, total: 1 }, RB: { starters: 2, total: 3 }, WR: { starters: 2, total: 2 }, TE: { starters: 1, total: 1 } },
  flex: { count: 1, eligible: ['RB', 'WR', 'TE'] },
  valuation: { minBid: 1, benchValueShare: 0.1, inflationFactor: 1 },
  leagueNotes: ''
};
const P = (id, name, position, auctionValue, marketValue, pts) => ({
  id, name, position, team: 'FA', adp: 20, projectedPoints: pts,
  auctionValue, marketValue, personalValue: auctionValue
});
const CHASE = "Ja'Marr Chase";
const players = [
  P('rb1', 'Bijan Robinson', 'RB', 52, 55, 289),
  P('rb2', 'Kyren Williams', 'RB', 30, 28, 221),
  P('wr1', CHASE, 'WR', 58, 61, 306),
  P('qb1', 'Josh Allen', 'QB', 22, 24, 391),
  P('te1', 'Brock Bowers', 'TE', 26, 27, 238)
];
// Mine plus three rivals. Rich has money and an empty backfield. Broke needs a
// back too but holds $4 against three open slots, so his real ceiling is $2.
const teams = [
  { id: 'me', name: 'Me', isMine: true, budgetRemaining: 150, spotsRemaining: 6, roster: [] },
  { id: 'rich', name: 'Rich', budgetRemaining: 120, spotsRemaining: 5, roster: [] },
  { id: 'mid', name: 'Mid', budgetRemaining: 70, spotsRemaining: 4, roster: [] },
  { id: 'broke', name: 'Broke', budgetRemaining: 4, spotsRemaining: 3, roster: [] }
];
const draftHistory = [
  { playerId: 'qb1', teamId: 'rich', price: 30, position: 'QB', timestamp: 1 },
  { playerId: 'te1', teamId: 'mid', price: 12, position: 'TE', timestamp: 2 }
];
const marketState = {
  QB: { drafted: 1, ratio: 1.36, avgDelta: 8, heat: 'hot', sampleSize: 3, remainingFairValue: 60, remainingCount: 9 },
  RB: { drafted: 0, ratio: 1, avgDelta: 0, heat: 'neutral', sampleSize: 0, remainingFairValue: 300, remainingCount: 20 }
};
// Rich already owns Josh Allen and Mid already owns Brock Bowers, matching the
// draft log above; a rival's roster and the log have to agree or the model gets
// two different stories about the same pick.
teams[1].roster.push({ playerId: 'qb1', price: 30, position: 'QB' });
teams[2].roster.push({ playerId: 'te1', price: 12, position: 'TE' });
const base = {
  evalPlayers: players, myTeam: teams[0], teams, config,
  draftedIds: new Set(['qb1', 'te1']), plan: null, marketState,
  games: 17, draftHistory
};
const ctx = sandbox.buildCoachContext('what now', { ...base, onTheBlock: players[0] });

// -------------------------------------------------------------------- rivals
ok('rivals reaches the model at all', Array.isArray(ctx.rivals) && ctx.rivals.length === 3,
  JSON.stringify(ctx.rivals && ctx.rivals.length));
const rich = (ctx.rivals || []).find(r => r.team === 'Rich');
const broke = (ctx.rivals || []).find(r => r.team === 'Broke');
ok('my own team is not listed as a rival', !(ctx.rivals || []).some(r => r.team === 'Me'));
// $120 across 5 slots: he can put 120 - 4*1 on one man and still fill the rest.
ok('maxBid leaves a dollar for every other open slot', rich && rich.maxBid === 116, rich && String(rich.maxBid));
ok('a broke rival is capped at what he can really bid', broke && broke.maxBid === 2, broke && String(broke.maxBid));
ok('rival starter holes are named', rich && rich.openStarterNeeds && /starter/.test(rich.openStarterNeeds.RB || ''),
  JSON.stringify(rich && rich.openStarterNeeds));
ok('a filled position drops off the needs list', rich && rich.openStarterNeeds && !rich.openStarterNeeds.QB,
  JSON.stringify(rich && rich.openStarterNeeds));
ok('rival rosters carry the name and the price', rich && rich.roster.length === 1 && /Josh Allen QB \$30/.test(rich.roster[0]),
  JSON.stringify(rich && rich.roster));

// --------------------------------------------------------------- competition
const block = ctx.onTheBlock;
ok('the player on the block reaches the model without being typed', block && block.name === 'Bijan Robinson');
ok('the player on the block carries a bidder read', block && block.competition && typeof block.competition.runnerUp === 'number',
  JSON.stringify(block && block.competition));
// Rich ($116) and Mid ($67) can both cover Bijan's $55 price; Broke ($2) cannot.
ok('a rival who cannot afford him is not counted as a bidder', block.competition.bidders === 2,
  JSON.stringify(block.competition));
// The price settles a dollar over the SECOND-best able bidder, i.e. Mid.
ok('runnerUp is the second-best able bidder, not the richest', block.competition.runnerUp === 67,
  JSON.stringify(block.competition));

// ---------------------------------------------------- market heat and recency
ok('positional inflation reaches the model', ctx.marketHeat && ctx.marketHeat.QB && ctx.marketHeat.QB.paidVsValue === 1.36,
  JSON.stringify(ctx.marketHeat));
ok('a position with no sales is left out rather than reported as neutral', ctx.marketHeat && !ctx.marketHeat.RB,
  JSON.stringify(ctx.marketHeat));
ok('the last picks reach the model newest first', Array.isArray(ctx.recentPicks) && ctx.recentPicks[0].name === 'Brock Bowers',
  JSON.stringify(ctx.recentPicks));
ok('a pick carries what it went for against its Value', ctx.recentPicks[0].paid === 12 && ctx.recentPicks[0].value === 26,
  JSON.stringify(ctx.recentPicks[0]));
ok('a pick names the team that won him', ctx.recentPicks[0].to === 'Mid', JSON.stringify(ctx.recentPicks[0]));

// Every assignment has to be in the NEXT answer, which is the whole point: the
// context is rebuilt per ask, so a player logged a second ago shows up with
// nothing else touched.
const after = sandbox.buildCoachContext('what now', {
  ...base,
  draftedIds: new Set(['qb1', 'te1', 'wr1']),
  teams: teams.map(t => t.id === 'rich'
    ? { ...t, budgetRemaining: 59, spotsRemaining: 4, roster: [...t.roster, { playerId: 'wr1', price: 61, position: 'WR' }] }
    : t),
  draftHistory: [...draftHistory, { playerId: 'wr1', teamId: 'rich', price: 61, position: 'WR', timestamp: 3 }]
});
ok('a freshly assigned player lands in the next answer',
  after.recentPicks[0].name === CHASE && after.recentPicks[0].paid === 61,
  JSON.stringify(after.recentPicks[0]));
const richAfter = after.rivals.find(r => r.team === 'Rich');
ok("the winner's budget and roster move with him",
  richAfter.budgetRemaining === 59 && richAfter.maxBid === 56 && richAfter.roster.length === 2,
  JSON.stringify(richAfter));
ok('a drafted player leaves the available board',
  !(after.topAvailableByPosition.WR || []).some(p => p.name === CHASE));

// -------------------------------------------------------------------- legend
ok('the room fields come with an explanation the model can use',
  typeof ctx.legendRoom === 'string' && /runnerUp/.test(ctx.legendRoom) && /maxBid/.test(ctx.legendRoom));

// ------------------------------------------------------- snake has no bidding
const snake = sandbox.buildCoachContext('what now', {
  ...base,
  config: { ...config, format: 'snake', snake: { draftSlot: 3 } },
  onTheBlock: players[0]
});
ok('a snake draft reports holes but not budgets',
  snake.rivals && snake.rivals.every(r => r.budgetRemaining === undefined && r.maxBid === undefined),
  JSON.stringify(snake.rivals && snake.rivals[0]));
ok('a snake draft carries no auction inflation table', snake.marketHeat === undefined);

// -------------------------------------------------------------- panel wiring
// Cheap text checks: the context can be perfect and still be handed nothing.
const mounts = (html.split('React.createElement(ValueCoach, {').length - 1)
  + (html.split('React.createElement(FableDock, {').length - 1);
for (const prop of ['draftHistory: draftHistory,', 'currentNomination: currentNomination,']) {
  const got = html.split(prop).length - 1;
  ok(`every coach mount is handed ${prop.split(':')[0]}`, got >= mounts, `${got} of ${mounts}`);
}
ok('the Fable panel forwards the player on the block', /draftHistory, onTheBlock: currentNomination/.test(html));
ok('the Value Coach forwards the player on the block', /onTheBlock: currentNomination/.test(html));
ok('the system prompt tells the model what runnerUp means', /THE ROOM:/.test(html) && /runnerUp/.test(html));
const bridge = fs.readFileSync(path.join(ROOT, 'tools', 'fable-bridge.js'), 'utf8');
ok('the Fable bridge prompt explains the room too', /THE ROOM:/.test(bridge) && /runnerUp/.test(bridge));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
