#!/usr/bin/env node
// DFS (Steps 26-28): the lobby CSV adapters for both sites, the site scoring,
// the Vegas Value Score, the stacks, and the optimizer under every constraint.
//   node tools/test-dfs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const near = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol;
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };
const TA = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TA[u] || u; };
const _oddsNorm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const _oddsRound = v => Math.round(v * 10) / 10;
function _csvSplit(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
const H = new Function('teamKey', '_oddsNorm', '_oddsRound', '_csvSplit', 'fetch',
  cut('// ── the scoring engine ─', 'const COLUMN_SCORING = {') + '\n' + cut('const _median = arr =>', '// How far apart the books are') + '\n' +
  cut('// -- kickers and defenses, scored', '// -- the three boards') + '\n' +
  // The market-trust ladder is the site's, not a copy: the DFS slate shrinks
  // a market number by the same factors the season blend does, so lifting it
  // here is what keeps this test honest about which one it is exercising.
  cut('const BLEND_SHRINK', 'function blendComponents') + '\n' + cut('// -- DFS ---', '// Memoized per isolate alongside _PROJ_ENC') + '\n' +
  'return { DFS_SITES, SCORING_SITE, parseDfsCsv, dfsSlateShape, buildDfsSlate, buildDfsStacks, scoringRules, scoreStats, dfsWeekStatus, dfsAvailable, buildSleeperRoster, dfsRosterCheck, dfsMarketRead, dfsPropCoverage, dfsPropNote, BLEND_SHRINK };'
)(teamKey, _oddsNorm, _oddsRound, _csvSplit, () => { throw new Error('no network'); });
const DFS = require(path.join(ROOT, 'dfs-optimizer.js'));

console.log('\nthe lobby CSVs');
{
  const dk = 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\nQB,"Josh Allen (12345)",Josh Allen,12345,QB,8200,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\nRB,"Jahmyr Gibbs (222)",Jahmyr Gibbs,222,RB/FLEX,8900,DET@GB 09/14/2026 04:25PM ET,DET,21.3\nDST,"Bears  (333)",Bears ,333,DST,3000,CHI@MIN 09/14/2026 01:00PM ET,CHI,7.0\n';
  const a = H.parseDfsCsv('dk', dk);
  ok('a DraftKings CSV parses', !a.error && a.rows.length === 3, a.error);
  ok('DraftKings FPPG comes across as historical operator data', a.rows[0].operatorFppg === 24.1 && a.rows[1].operatorFppg === 21.3);
  ok('the opponent comes out of Game Info', a.rows[0].opponent === 'NYJ' && a.rows[1].opponent === 'GB');
  ok('a defense is a DST with its club', a.rows[2].position === 'DST' && a.rows[2].team === 'CHI');
  const fd = 'Id,Position,First Name,Nickname,Last Name,FPPG,Played,Salary,Game,Team,Opponent,Injury Indicator,Injury Details,Tier,Roster Position\n1,QB,Josh,Josh Allen,Allen,24.1,1,9200,BUF@NYJ,BUF,NYJ,,,,QB\n2,D,,Chicago Bears,,7,1,4000,CHI@MIN,CHI,MIN,,,,D\n';
  const b = H.parseDfsCsv('fd', fd);
  ok('a FanDuel CSV parses', !b.error && b.rows.length === 2, b.error);
  ok('the nickname is the name and D is a DST', b.rows[0].name === 'Josh Allen' && b.rows[1].position === 'DST');
  ok('FanDuel FPPG comes across through the same normalized field', b.rows[0].operatorFppg === 24.1);
  ok('a file from the wrong site is refused', !!H.parseDfsCsv('dk', fd).error && !!H.parseDfsCsv('fd', dk).error);
  ok('an empty file is refused', H.parseDfsCsv('dk', '').error === 'empty');
  ok('the roster position comes across', a.rows[1].rosterPosition === 'RB/FLEX' && b.rows[0].rosterPosition === 'QB');
  // FanDuel prints its own designation in the lobby file. DraftKings does not,
  // which is why the injury report behind the slate is the primary source and
  // this column is only the fallback.
  const fdInj = H.parseDfsCsv('fd', 'Id,Position,First Name,Nickname,Last Name,FPPG,Played,Salary,Game,Team,Opponent,Injury Indicator,Injury Details,Tier,Roster Position\n1,WR,Garrett,Garrett Wilson,Wilson,14.2,1,7000,BUF@NYJ,NYJ,BUF,O,Knee,,WR\n2,QB,Josh,Josh Allen,Allen,24.1,1,9200,BUF@NYJ,BUF,NYJ,,,,QB\n');
  ok('the FanDuel injury indicator is read off the file', fdInj.rows[0].injuryIndicator === 'O' && fdInj.rows[1].injuryIndicator === null);
}

// The reader upload takes whatever file the reader has, so it has to know a
// single-game file when it sees one: priced against the classic cap, a captain
// file builds a lineup nobody can enter.
console.log('\nclassic or single game');
{
  const classic = H.parseDfsCsv('dk', 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\nQB,"Josh Allen (1)",Josh Allen,1,QB,8200,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\nRB,"Jahmyr Gibbs (2)",Jahmyr Gibbs,2,RB/FLEX,8900,DET@GB 09/14/2026 04:25PM ET,DET,21.3\n');
  ok('a main-slate file is classic', H.dfsSlateShape(classic.rows) === 'classic');

  // DraftKings Showdown: the captain is a second row for the same player at a
  // 1.5x price, tagged CPT.
  const dkShow = H.parseDfsCsv('dk', 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\nQB,"Josh Allen (1)",Josh Allen,1,CPT,12300,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\nQB,"Josh Allen (2)",Josh Allen,2,FLEX,8200,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\n');
  ok('a DraftKings captain file is named', H.dfsSlateShape(dkShow.rows) === 'single-game');

  // FanDuel single game: the same shape under a different word.
  const fdShow = H.parseDfsCsv('fd', 'Id,Position,First Name,Nickname,Last Name,FPPG,Played,Salary,Game,Team,Opponent,Injury Indicator,Injury Details,Tier,Roster Position\n1,QB,Josh,Josh Allen,Allen,24.1,1,17000,BUF@NYJ,BUF,NYJ,,,,MVP\n2,QB,Josh,Josh Allen,Allen,24.1,1,15000,BUF@NYJ,BUF,NYJ,,,,FLEX\n');
  ok('a FanDuel MVP file is named', H.dfsSlateShape(fdShow.rows) === 'single-game');

  // The token is the operators' to rename, so the repeated player row is
  // caught on its own with no Roster Position column in the file at all.
  const noCol = H.parseDfsCsv('dk', 'Position,Name + ID,Name,ID,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\nQB,"Josh Allen (1)",Josh Allen,1,12300,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\nQB,"Josh Allen (2)",Josh Allen,2,8200,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\nWR,"Garrett Wilson (3)",Garrett Wilson,3,6800,BUF@NYJ 09/14/2026 01:00PM ET,NYJ,14.0\n');
  ok('a repeated player is caught without the column', H.dfsSlateShape(noCol.rows) === 'single-game');

  // Two players sharing a name on one slate is not a captain file. Six rows,
  // one collision: under the quarter-of-the-file threshold.
  const twins = { rows: [
    { name: 'Mike Williams', position: 'WR' }, { name: 'Mike Williams', position: 'WR' },
    { name: 'Josh Allen', position: 'QB' }, { name: 'Jahmyr Gibbs', position: 'RB' },
    { name: 'Garrett Wilson', position: 'WR' }, { name: 'Bears', position: 'DST' },
    { name: 'Travis Kelce', position: 'TE' }, { name: 'Bijan Robinson', position: 'RB' }
  ] };
  ok('two players with one name is still classic', H.dfsSlateShape(twins.rows) === 'classic');
  ok('an empty file is classic, not a captain file', H.dfsSlateShape([]) === 'classic');
}

console.log('\nsite scoring');
{
  const dk = H.scoringRules('ppr', H.SCORING_SITE.dk), fd = H.scoringRules('ppr', H.SCORING_SITE.fd);
  ok('DraftKings pays the 300-yard passing bonus', near(H.scoreStats({ passYd: 300, passTD: 2 }, 'QB', dk), 12 + 8 + 3));
  ok('and the 100-yard rushing bonus', near(H.scoreStats({ rushYd: 100 }, 'RB', dk), 13));
  ok('DraftKings is full PPR', near(H.scoreStats({ rec: 5 }, 'WR', dk), 5));
  ok('FanDuel is half PPR with no bonus', near(H.scoreStats({ rec: 5, rushYd: 100 }, 'RB', fd), 12.5));
  ok('both take a point per interception', near(H.scoreStats({ passInt: 1 }, 'QB', dk), -1) && near(H.scoreStats({ passInt: 1 }, 'QB', fd), -1));
  ok('a fumble costs one on DK and two on FD', near(H.scoreStats({ fumLost: 1 }, 'RB', dk), -1) && near(H.scoreStats({ fumLost: 1 }, 'RB', fd), -2));
}

// A week board with known per-game lines.
const P = (name, pos, team, opp, vegas, cons, it, extra) => ({ key: _oddsNorm(name) + '|' + pos, name, position: pos === 'DEF' ? 'DST' : pos, pos, team, games: 1, byes: [],
  consensus: { stats: cons, points: 0, rank: 1 }, vegas: { stats: vegas, points: 0, rank: 1, confidence: 'MEDIUM', basis: extra && extra.basis || 'gamelines', td: extra && extra.td || null }, ironTuna: { stats: it, points: 0, rank: 1, confidence: 'MEDIUM' },
  marketDelta: extra && extra.delta || { points: 0, rank: 0, classification: 'MARKET AGREES', significant: false }, why: { summary: '' }, injury: null,
  weeks: [{ opponent: opp, home: true, env: { implied: extra && extra.implied || 24, posted: true } }] });
const WEEK = { ok: true, players: [
  P('Josh Allen', 'QB', 'BUF', 'NYJ', { passYd: 280, passTD: 2.2, rushYd: 40, rushTD: 0.5 }, { passYd: 260, passTD: 2, rushYd: 35, rushTD: 0.4 }, { passYd: 275, passTD: 2.1, rushYd: 38, rushTD: 0.5 }, { implied: 27 }),
  P('Aaron Rodgers', 'QB', 'NYJ', 'BUF', { passYd: 230, passTD: 1.4 }, { passYd: 240, passTD: 1.6 }, { passYd: 235, passTD: 1.5 }, { implied: 20, delta: { points: -2, rank: -4, classification: 'VEGAS LEANS LOWER', significant: true } }),
  P('Jahmyr Gibbs', 'RB', 'DET', 'GB', { rushYd: 85, rushTD: 0.8, rec: 4, recYd: 35 }, { rushYd: 80, rushTD: 0.7, rec: 4, recYd: 30 }, { rushYd: 84, rushTD: 0.8, rec: 4, recYd: 34 }),
  P('Breece Hall', 'RB', 'NYJ', 'BUF', { rushYd: 60, rushTD: 0.3, rec: 3, recYd: 20 }, { rushYd: 70, rushTD: 0.5, rec: 4, recYd: 30 }, { rushYd: 64, rushTD: 0.4, rec: 3.4, recYd: 24 }, { delta: { points: -3, rank: -5, classification: 'VEGAS LEANS LOWER', significant: true } }),
  P('James Cook', 'RB', 'BUF', 'NYJ', { rushYd: 75, rushTD: 0.7, rec: 2, recYd: 15 }, { rushYd: 70, rushTD: 0.6, rec: 2, recYd: 15 }, { rushYd: 74, rushTD: 0.7, rec: 2, recYd: 15 }),
  P('Amon-Ra St. Brown', 'WR', 'DET', 'GB', { rec: 8, recYd: 95, recTD: 0.6 }, { rec: 7, recYd: 85, recTD: 0.5 }, { rec: 7.8, recYd: 93, recTD: 0.6 }),
  P('Garrett Wilson', 'WR', 'NYJ', 'BUF', { rec: 6, recYd: 75, recTD: 0.4 }, { rec: 6, recYd: 75, recTD: 0.4 }, { rec: 6, recYd: 75, recTD: 0.4 }),
  P('Khalil Shakir', 'WR', 'BUF', 'NYJ', { rec: 5, recYd: 60, recTD: 0.4 }, { rec: 5, recYd: 55, recTD: 0.3 }, { rec: 5, recYd: 59, recTD: 0.4 }),
  P('Jameson Williams', 'WR', 'DET', 'GB', { rec: 4, recYd: 65, recTD: 0.5 }, { rec: 4, recYd: 60, recTD: 0.4 }, { rec: 4, recYd: 64, recTD: 0.5 }),
  P('Jayden Reed', 'WR', 'GB', 'DET', { rec: 5, recYd: 62, recTD: 0.4 }, { rec: 5, recYd: 60, recTD: 0.4 }, { rec: 5, recYd: 62, recTD: 0.4 }),
  P('Sam LaPorta', 'TE', 'DET', 'GB', { rec: 5, recYd: 55, recTD: 0.5 }, { rec: 5, recYd: 50, recTD: 0.4 }, { rec: 5, recYd: 54, recTD: 0.5 }),
  P('Dalton Kincaid', 'TE', 'BUF', 'NYJ', { rec: 4, recYd: 45, recTD: 0.4 }, { rec: 4, recYd: 45, recTD: 0.4 }, { rec: 4, recYd: 45, recTD: 0.4 }),
  P('Tucker Kraft', 'TE', 'GB', 'DET', { rec: 3, recYd: 35, recTD: 0.3 }, { rec: 3, recYd: 35, recTD: 0.3 }, { rec: 3, recYd: 35, recTD: 0.3 }),
  P('Chicago Bears', 'DEF', 'CHI', 'MIN', { sacks: 2.5, ints: 0.8, fumRec: 0.5, defTD: 0.1, safety: 0, ptsAllowed: 20 }, { sacks: 2.4, ints: 0.7, fumRec: 0.5, defTD: 0.1, safety: 0, ptsAllowed: 21 }, { sacks: 2.5, ints: 0.8, fumRec: 0.5, defTD: 0.1, safety: 0, ptsAllowed: 20 }),
  P('Buffalo Bills', 'DEF', 'BUF', 'NYJ', { sacks: 3, ints: 1, fumRec: 0.5, defTD: 0.1, safety: 0, ptsAllowed: 17 }, { sacks: 2.8, ints: 0.9, fumRec: 0.5, defTD: 0.1, safety: 0, ptsAllowed: 18 }, { sacks: 3, ints: 1, fumRec: 0.5, defTD: 0.1, safety: 0, ptsAllowed: 17 })
] };
const SAL = [['Josh Allen', 'QB', 'BUF', 8200], ['Aaron Rodgers', 'QB', 'NYJ', 6000], ['Jahmyr Gibbs', 'RB', 'DET', 8900], ['Breece Hall', 'RB', 'NYJ', 7200], ['James Cook', 'RB', 'BUF', 6800],
  ['Amon-Ra St. Brown', 'WR', 'DET', 8600], ['Garrett Wilson', 'WR', 'NYJ', 7000], ['Khalil Shakir', 'WR', 'BUF', 5200], ['Jameson Williams', 'WR', 'DET', 6100], ['Jayden Reed', 'WR', 'GB', 5600],
  ['Sam LaPorta', 'TE', 'DET', 5500], ['Dalton Kincaid', 'TE', 'BUF', 4400], ['Tucker Kraft', 'TE', 'GB', 3800], ['Bears ', 'DST', 'CHI', 3000], ['Bills ', 'DST', 'BUF', 3600], ['Nobody Famous', 'WR', 'GB', 3000]]
  .map(([name, position, team, salary], i) => ({ name, position, team, opponent: null, salary, operatorFppg: 10 + i }));
const STATE = { ok: true, games: [{ id: 'a', home: 'NYJ', away: 'BUF', total: 47, spread: -3, impliedHome: 22, impliedAway: 25, kickoff: 1 }, { id: 'b', home: 'GB', away: 'DET', total: 51, spread: 1, impliedHome: 26, impliedAway: 25, kickoff: 1 }] };

console.log('\nthe slate');
const slate = H.buildDfsSlate('dk', SAL, WEEK, {});
{
  ok('every salary row is on the slate', slate.players.length === SAL.length);
  ok('a player the board does not know is kept but unmatched', slate.unmatched === 1 && slate.players.find(p => p.name === 'Nobody Famous').onBoard === false);
  const allen = slate.players.find(p => p.name === 'Josh Allen');
  ok('each player carries salary and all three projections', allen.salary === 8200 && allen.vegasPoints > 0 && allen.ironTunaPoints > 0 && allen.consensusPoints > 0);
  ok('the slate keeps operator FPPG and exposes the Iron Tuna edge against it', allen.operatorFppg === 10 && near(allen.projectionVsFppg, allen.ironTunaPoints - 10, 0.11));
  ok('and Market Delta, TD probability and team total', allen.marketDelta && Number.isFinite(allen.tdProbability) && allen.teamTotal === 27);
  ok('the site scoring is applied (DK 300-yard bonus is not reached at 280)', near(allen.vegasPoints, _oddsRound(280 * 0.04 + 2.2 * 4 + 4 + 0.5 * 6), 0.15), String(allen.vegasPoints));
  ok('Vegas Value Score is market points per $1K against the slate median', allen.vegasValueScore > 0 && slate.players.some(p => p.vegasValueScore && p.vegasValueScore !== 100));
  ok('a DST matches by club', (() => { const b = slate.players.find(p => p.position === 'DST' && p.team === 'CHI'); return b && b.onBoard === true && b.siteName === 'Bears' && b.vegasPoints > 0; })());
  ok('the boards are there', slate.boards.bestVegasValues.length > 0 && slate.boards.tdUpside.length > 0 && slate.boards.volumeValues.length > 0);
  ok('expensive fades are pricey players the market is lower on', slate.boards.expensiveFades.every(p => p.salary >= 6000 && p.marketDelta.points < 0) && slate.boards.expensiveFades.some(p => p.name === 'Breece Hall'));
  ok('the TD basis is said', slate.players.filter(p => p.onBoard).every(p => p.tdBasis === 'derived' || p.tdBasis === 'anytime-td-market'));
  ok('with no prop on the slate the note says so, without claiming what the books have posted',
     slate.hasProps === false && /No player prop has reached this slate/.test(slate.note) && !/No sportsbook/.test(slate.note));
  ok('...and says what it falls back to instead of presenting a fitted number as a market read',
     /falls back to the consensus projection/.test(slate.note) && slate.props.priced === 0 && slate.props.coverage === 0);
  const stacks = H.buildDfsStacks(slate, STATE);
  ok('stacks rank games by total', stacks[0].game === 'DET at GB' && stacks[0].total === 51);
  ok('each side has a QB, catchers, a back and a bring-back', stacks[1].away.qb.name === 'Josh Allen' && stacks[1].away.catchers.length >= 2 && stacks[1].bringBack.home);
  ok('a stack is priced', stacks[1].away.stackSalary > 0 && stacks[1].away.stackVegasPoints > 0);
}

// ── who is not playing on Sunday ──────────────────────────────────────────
// The bug this guards: a receiver the injury report ruled out on Friday, or
// one who is not on an NFL active roster at all, kept a positive weekly
// projection and a minimum salary, which is exactly the shape the optimizer
// reaches for first. Nothing between the board and the lineup ever asked
// whether he was going to play.
//
// Four sources answer that question, and each is pinned here, because each
// one catching a different case is the whole point: the injury report knows
// about the hurt, the reserve list knows who is still serving a long absence,
// the roster file knows who is not on a roster at all (a practice-squad
// signing appears on no injury report anywhere), and the FanDuel salary file
// carries the operator's own indicator.
console.log('\nwho is not playing this week');
{
  const avail = {
    weekly: { 'garrettwilson|WR': { status: 'Out', note: 'Knee: ruled out Friday' },
              'khalilshakir|WR': { status: 'Questionable', note: 'Ankle' },
              'jamesonwilliams|WR': { status: 'Doubtful', note: 'Hamstring' } },
    table: { 'breecehall|RB': { status: 'IR', gamesOut: 4, note: 'Knee' } }
  };
  ok('the injury report rules a man out', H.dfsWeekStatus(avail, 'garrettwilson|WR', 3, null).status === 'Out');
  ok('...and says where that came from', H.dfsWeekStatus(avail, 'garrettwilson|WR', 3, null).basis === 'injury-report');
  ok('a questionable tag is carried, not swallowed', H.dfsWeekStatus(avail, 'khalilshakir|WR', 3, null).status === 'Questionable');
  ok('a healthy player gets no status at all', H.dfsWeekStatus(avail, 'joshallen|QB', 3, null) === null);

  // gamesOut counts from Week 1, which is the convention the availability file
  // states in its own header: "first eligible Week 5" is four games out.
  ok('a reserve-list absence covers the weeks it spans', H.dfsWeekStatus(avail, 'breecehall|RB', 3, null).status === 'IR');
  ok('...and ends when it ends', H.dfsWeekStatus(avail, 'breecehall|RB', 5, null) === null);
  ok('...and says nothing at all without a week to compare', H.dfsWeekStatus(avail, 'breecehall|RB', null, null) === null);

  ok('the FanDuel file indicator is read when nothing else has him', H.dfsWeekStatus(null, 'x|WR', 3, 'O').status === 'Out'
     && H.dfsWeekStatus(null, 'x|WR', 3, 'Q').status === 'Questionable' && H.dfsWeekStatus(null, 'x|WR', 3, '') === null);
  ok('...and the report outranks it', H.dfsWeekStatus(avail, 'khalilshakir|WR', 3, 'O').status === 'Questionable');

  ok('Out and Doubtful come off the board, Questionable stays on it',
     H.dfsAvailable('Out') === false && H.dfsAvailable('Doubtful') === false && H.dfsAvailable('IR') === false
     && H.dfsAvailable('Questionable') === true && H.dfsAvailable(null) === true);

  // The roster file. A practice-squad signing is the case no injury report
  // will ever catch, because the man is not hurt.
  const roster = H.buildSleeperRoster({
    '1': { full_name: 'Jayden Reed', position: 'WR', team: 'GB', status: 'Active' },
    '2': { full_name: 'Theo Practice', position: 'WR', team: 'LAC', status: 'Practice Squad' },
    '3': { full_name: 'Traded Man', position: 'WR', team: 'NYJ', status: 'Active' },
    '4': { full_name: 'Cut Loose', position: 'WR', team: null, status: 'Active' },
    '5': { first_name: 'No', last_name: 'Position', position: 'LS', team: 'GB', status: 'Active' }
  });
  ok('the roster file reduces to fantasy players with a club and a status',
     Object.keys(roster).length === 4 && roster['jaydenreed|WR'].team === 'GB' && !roster['noposition|LS']);
  ok('an active player where the board says he is raises nothing', H.dfsRosterCheck(roster, ['Jayden Reed'], 'WR', 'GB') === null);
  ok('a practice-squad signing is caught, and the injury report never would have',
     H.dfsRosterCheck(roster, ['Theo Practice'], 'WR', 'MIA').kind === 'roster');
  ok('a player on no roster at all is caught', H.dfsRosterCheck(roster, ['Cut Loose'], 'WR', 'MIA').kind === 'roster');
  ok('a man who changed clubs is flagged, not benched — he plays, the projection is just stale',
     H.dfsRosterCheck(roster, ['Traded Man'], 'WR', 'MIA').kind === 'team' && H.dfsRosterCheck(roster, ['Traded Man'], 'WR', 'MIA').team === 'NYJ');
  ok('a player the file has never heard of is left alone', H.dfsRosterCheck(roster, ['Josh Allen'], 'QB', 'BUF') === null);
  ok('no roster file asserts nothing', H.dfsRosterCheck(null, ['Theo Practice'], 'WR', 'MIA') === null);

  // End to end: the slate marks them, and the optimizer refuses to spend the
  // cap on them. Three starters coming off the board is three replacements
  // going on it, which is what a real slate looks like on a Sunday morning, so
  // the fixture grows the same way rather than being solved against a roster
  // that can no longer be filled.
  const WEEK_D = { ok: true, players: WEEK.players.concat([
    P('Backup Wideout', 'WR', 'NYJ', 'BUF', { rec: 4, recYd: 45, recTD: 0.3 }, { rec: 4, recYd: 42, recTD: 0.3 }, { rec: 4, recYd: 44, recTD: 0.3 }),
    P('Second Wideout', 'WR', 'DET', 'GB', { rec: 3, recYd: 38, recTD: 0.3 }, { rec: 3, recYd: 36, recTD: 0.2 }, { rec: 3, recYd: 37, recTD: 0.3 }),
    P('Bench Back', 'RB', 'NYJ', 'BUF', { rushYd: 45, rushTD: 0.3, rec: 2, recYd: 14 }, { rushYd: 42, rushTD: 0.3, rec: 2, recYd: 13 }, { rushYd: 44, rushTD: 0.3, rec: 2, recYd: 14 })
  ]) };
  const SAL_D = SAL.concat([['Backup Wideout', 'WR', 'NYJ', 3400], ['Second Wideout', 'WR', 'DET', 3200], ['Bench Back', 'RB', 'NYJ', 3600]]
    .map(([name, position, team, salary]) => ({ name, position, team, opponent: null, salary, operatorFppg: 8 })));
  const marked = H.buildDfsSlate('dk', SAL_D, WEEK_D, { week: 3, availability: avail, roster });
  const wilson = marked.players.find(p => p.name === 'Garrett Wilson');
  const shakir = marked.players.find(p => p.name === 'Khalil Shakir');
  ok('the slate marks the ruled-out man unavailable and says why', wilson.available === false && wilson.weekStatus === 'Out' && /ruled out/.test(wilson.weekStatusNote));
  ok('a questionable man stays on the slate with his tag', shakir.available === true && shakir.weekStatus === 'Questionable');
  ok('the slate counts what it took off and names them', marked.unavailable >= 3 && marked.unavailableNames.some(x => x.name === 'Garrett Wilson'));
  ok('an unavailable player is off the value boards too', !marked.boards.bestVegasValues.some(p => p.available === false));
  ok('...and cannot head a stack or be a bring-back',
     !H.buildDfsStacks(marked, STATE).some(g => [g.home, g.away].some(x => (x.qb && x.qb.available === false) || x.catchers.some(c => c.available === false))));

  const play = marked.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const built = DFS.build(play, { mode: 'ironTuna', cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, lineups: 3, seed: 7 });
  ok('no lineup contains a man who is not playing', built.ok && built.lineups.every(l => l.players.every(x => {
    const p = marked.players.find(q => q.key === x.id); return !p || p.available !== false;
  })));
  ok('the builder reports who it benched rather than quietly shrinking the pool',
     built.benchedCount >= 3 && built.benched.some(b => b.name === 'Garrett Wilson' && b.status === 'Out'));
  ok('a questionable man is still available to be picked', built.poolSize > 0 && !built.benched.some(b => b.name === 'Khalil Shakir'));

  // A lock is a decision. The builder declines to make this call on its own;
  // it does not overrule one the reader has already made.
  const locked = DFS.build(play, { mode: 'ironTuna', cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, lock: ['garrettwilson|WR'], lineups: 1, seed: 7 });
  ok('a locked player is built around even when the report has him out',
     locked.ok && locked.lineups[0].players.some(x => x.id === 'garrettwilson|WR'));
  ok('...and an explicit override puts everyone back', DFS.build(play, { mode: 'ironTuna', cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, includeUnavailable: true, lineups: 1, seed: 7 }).benchedCount === 0);

  // With nothing to go on, nothing changes: this must never empty a board.
  const bare = H.buildDfsSlate('dk', SAL_D, WEEK_D, {});
  ok('with no injury report and no roster file every player stays available',
     bare.unavailable === 0 && bare.players.filter(p => p.onBoard).every(p => p.available === true));
  ok('...and the builder benches nobody', DFS.build(bare.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key })),
     { mode: 'ironTuna', cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, lineups: 1, seed: 7 }).benchedCount === 0);
}

// ── the weekly betting market ─────────────────────────────────────────────
// The request this guards: use the week's prop bets to predict players, and
// fall back to something honest when the books have not posted.
//
// The pipeline already existed — PropLine/SGO write odds_snapshots,
// marketHistoryWeek reads them, vegasProjection turns a player's quoted lines
// into fantasy points, and the board records the basis. What did not exist was
// any way for the slate or the optimizer to tell a QUOTED number from an
// INFERRED one: both arrived as `vegasPoints`, so a prop-grounded projection
// and a game total sliced across an offense competed on identical terms.
//
// Three things are pinned here: the evidence reaches the row, the trust ladder
// is the site's own (not a second copy that can drift), and the fallback is
// the consensus rather than a fitted number wearing a Vegas label.
console.log('\nthe weekly betting market');
{
  // A player the books priced: three markets, six books, an anytime-TD price.
  const priced = { vegas: { basis: 'props', confidence: 'HIGH', td: null } };
  const w0 = { env: {}, vegasProjection: { status: 'full', priced: ['rec', 'recYd', 'anytimeTD'], missing: [], books: 6, ageHours: 0.4,
                                           td: { probability: 41.2, books: 6, devigged: true } } };
  const m = H.dfsMarketRead(priced, w0, 18.4, 14.0);
  ok('a quoted player is marked quoted', m.quoted === true && m.basis === 'props');
  ok('the markets the books actually posted come across, in words', m.priced.join(',') === 'anytimeTD,rec,recYd'.split(',').sort().join(',') || m.priced.length === 3);
  ok('...with a plain-language label for each', m.pricedLabels.includes('receiving yards') && m.pricedLabels.includes('receptions'));
  ok('the book count and the age of the pull come across', m.books === 6 && m.ageHours === 0.4);
  ok('a fully quoted projection is trusted in full', m.shrink === 1 && near(m.points, 18.4, 0.05));
  ok('the devigged anytime-touchdown price comes across with its books', m.tdProbability === 41.2 && m.tdBooks === 6 && m.tdDevigged === true);

  // A player nobody priced: the number is his game's total, and it is worth
  // less. This is the case the request called "look for other predictions".
  const inferred = { vegas: { basis: 'gamelines', confidence: 'MEDIUM', td: null } };
  const g = H.dfsMarketRead(inferred, { env: {} }, 18.4, 14.0);
  ok('a player with no prop is not marked quoted', g.quoted === false && g.basis === 'gamelines');
  ok('...and his market number is discounted toward the consensus, not taken whole',
     g.shrink === 0.8 && near(g.points, 14.0 + 0.8 * 4.4, 0.05) && g.points < 18.4 && g.points > 14.0);
  ok('...and names no market, because no book posted one', g.priced.length === 0 && g.books === null);

  // PRICED BUT SHORT. The books posted on him — an anytime-touchdown price —
  // and it is not something a receiver's projection can be built from, so he
  // still carries his game's environment. This looks identical to "no book
  // looked at him" unless it is counted and said separately, which is how a
  // feed carrying one market reads as a feed carrying none.
  const shortW0 = { env: {}, vegasProjection: { status: 'unavailable', reason: 'no_core_market', priced: ['anytimeTD'], missing: ['recYd', 'rec'] } };
  const sh = H.dfsMarketRead({ vegas: { basis: 'gamelines', confidence: 'MEDIUM' } }, shortW0, 18.4, 14.0);
  ok('a man priced only on his touchdown is flagged as short of a projection', sh.shortOfProjection === true && sh.quoted === false);
  ok('...and names what the books DID post', sh.shortPricedLabels.join(',') === 'anytime TD');
  ok('...and what a projection would have needed', sh.shortMissingLabels.includes('receiving yards') && sh.shortMissingLabels.includes('receptions'));
  ok('...while still being discounted like any unquoted man', sh.shrink === 0.8 && sh.points < 18.4);
  ok('a man nobody priced at all is NOT flagged short', g.shortOfProjection === false && g.shortPriced.length === 0);

  const fitted = H.dfsMarketRead({ vegas: { basis: 'ratings', confidence: 'LOW' } }, { env: {} }, 18.4, 14.0);
  ok('a fitted team rating is trusted least of all', fitted.shrink === 0.55 && fitted.points < g.points);
  const nothing = H.dfsMarketRead({ vegas: { basis: 'none' } }, null, 18.4, 14.0);
  ok('with no market at all the number IS the consensus, never a guess', nothing.shrink === 0 && near(nothing.points, 14.0, 0.01));

  // One ladder for the whole site. A second copy here would drift from the
  // season blend and the two would disagree about the same player.
  ok('the trust ladder is the site\'s own BLEND_SHRINK, not a copy',
     H.BLEND_SHRINK.props === 1 && H.BLEND_SHRINK.gamelines === 0.8 && H.BLEND_SHRINK.ratings === 0.55 && H.BLEND_SHRINK.none === 0);
  ok('every basis the board can emit has a trust factor',
     ['props', 'props-partial', 'props+gamelines', 'gamelines+props', 'gamelines', 'gamelines+ratings', 'ratings', 'none'].every(b => H.BLEND_SHRINK[b] != null));
  // A game line with the quoted markets laid on it is better grounded than the
  // game line alone and short of what the market could produce by itself.
  ok('a game line carrying props sits between the two it is made of',
     H.BLEND_SHRINK['gamelines+props'] > H.BLEND_SHRINK.gamelines
     && H.BLEND_SHRINK['gamelines+props'] < H.BLEND_SHRINK['props-partial']);
  const laid = H.dfsMarketRead({ vegas: { basis: 'gamelines+props', confidence: 'MEDIUM' } }, { env: {} }, 18.4, 14.0);
  ok('...and a man on it counts as quoted, not as one nobody looked at', laid.quoted === true);
  ok('...while still not being a standalone market read', laid.marketStandalone === false);
  ok('...and a full props man is both', H.dfsMarketRead({ vegas: { basis: 'props' } }, { env: {} }, 18.4, 14.0).marketStandalone === true);

  // Coverage, said as a number. `hasProps` was a boolean and a boolean cannot
  // answer "priced how much of it, by how many books, how long ago".
  const rows = [
    { onBoard: true, market: { basis: 'props', quoted: true, priced: ['rec', 'recYd'], books: 6, ageHours: 2 } },
    { onBoard: true, market: { basis: 'props-partial', quoted: true, priced: ['anytimeTD'], books: 4, ageHours: 0.5 } },
    { onBoard: true, market: { basis: 'gamelines', quoted: false, priced: [], books: null, ageHours: null } },
    { onBoard: true, available: false, market: { basis: 'props', quoted: true, priced: ['rec'], books: 9, ageHours: 1 } },
    { onBoard: false }
  ];
  const cov = H.dfsPropCoverage(rows);
  ok('coverage counts the priced against the playable', cov.players === 3 && cov.priced === 2 && cov.coverage === 67);
  ok('a benched man is not counted as slate coverage', cov.avgBooks === 5);
  ok('the union of quoted markets is reported', cov.markets.join(',') === 'anytimeTD,rec,recYd');
  ok('and the freshest pull behind them', cov.freshestHours === 0.5);
  ok('the note quotes the real numbers', /2 of 3 players/.test(H.dfsPropNote(cov)) && /receiving yards/.test(H.dfsPropNote(cov)));
  // The whole slate priced on touchdowns and nothing else: the state that
  // reads as "props are working" on one page and "no props" on another.
  const tdOnlyCov = H.dfsPropCoverage([
    { onBoard: true, market: { basis: 'gamelines', quoted: false, priced: [], shortOfProjection: true, shortPriced: ['anytimeTD'] } },
    { onBoard: true, market: { basis: 'gamelines', quoted: false, priced: [], shortOfProjection: true, shortPriced: ['anytimeTD'] } },
    { onBoard: true, market: { basis: 'gamelines', quoted: false, priced: [], shortOfProjection: false, shortPriced: [] } }
  ]);
  ok('a touchdown-only slate counts the priced-but-short apart from the unpriced',
     tdOnlyCov.priced === 0 && tdOnlyCov.quotedButShort === 2 && tdOnlyCov.shortMarketLabels.join(',') === 'anytime TD');
  ok('...and the note says the books DID post, rather than claiming they did not',
     /The books have posted on 2 players/.test(H.dfsPropNote(tdOnlyCov)) && /anytime TD/.test(H.dfsPropNote(tdOnlyCov)));
  ok('...and says the prices ARE applied, rather than that they went nowhere',
     /Those prices are applied/.test(H.dfsPropNote(tdOnlyCov)) && /set that side/.test(H.dfsPropNote(tdOnlyCov)));
  ok('...and says what is still coming from the game line, and why',
     /still comes from his game/.test(H.dfsPropNote(tdOnlyCov))
     && /standalone market projection is built from/.test(H.dfsPropNote(tdOnlyCov)));

  const noneCov = H.dfsPropCoverage([{ onBoard: true, market: { basis: 'gamelines', quoted: false, priced: [] } }]);
  ok('with nothing priced the note says so and says what it falls back to',
     /No player prop has reached this slate/.test(H.dfsPropNote(noneCov)) && /falls back to the consensus/.test(H.dfsPropNote(noneCov)));
  ok('an empty slate says nothing rather than claiming 0%', H.dfsPropNote(H.dfsPropCoverage([])) === null);

  // End to end on the fixture slate, which carries no props at all: this is
  // the real state of the feed today, so it is the path that must be sound.
  ok('the slate carries a market read for every priced player',
     slate.players.filter(p => p.onBoard).every(p => p.market && p.marketPoints != null && typeof p.marketQuoted === 'boolean'));
  ok('with no props posted nothing claims to be quoted', slate.hasProps === false && slate.props.priced === 0);
  ok('...and every market number is pulled back toward the consensus for it',
     slate.players.filter(p => p.onBoard && p.vegasPoints !== p.consensusPoints)
       .every(p => Math.abs(p.marketPoints - p.consensusPoints) <= Math.abs(p.vegasPoints - p.consensusPoints) + 1e-9));

  // The optimizer. A prop-first mode that degrades to the consensus is the
  // whole request: use the market where there is one, say so where there is not.
  const play = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const opts = { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, lineups: 1, seed: 7 };
  const mk = DFS.build(play, { ...opts, mode: 'market' });
  ok('the market mode exists and names itself', !!DFS.MODES.market && /props first/i.test(DFS.MODES.market.label));
  ok('it builds a legal lineup', mk.ok && mk.lineups[0].players.length === H.DFS_SITES.dk.slots.length && mk.lineups[0].salary <= 50000);
  ok('it maximizes the market read, and the raw-Vegas mode does not beat it there',
     mk.lineups[0].points >= DFS.build(play, { ...opts, mode: 'vegas' }).lineups[0].players.reduce((s, x) => s + (x.marketPoints || 0), 0) - 1e-6);
  ok('a lineup reports how much of itself the books priced', mk.lineups[0].quoted === 0 && mk.lineups[0].marketPoints > 0);
  ok('the market evidence rides onto every picked player, for the card to print',
     mk.lineups[0].players.every(x => x.market && x.marketPoints != null));
  ok('so do the fields the fit lines had been reading off an object that never carried them',
     mk.lineups[0].players.every(x => x.vegasPoints != null && x.consensusPoints != null) && mk.lineups[0].players.some(x => x.teamTotal != null));

  // A player the books priced should be preferred over an identical player
  // they did not, at the same price. That is the entire point.
  const twin = [
    { id: 'q|WR', name: 'Quoted Man', position: 'WR', team: 'AAA', salary: 5000, onBoard: true, ironTunaPoints: 12, consensusPoints: 10, vegasPoints: 16, marketPoints: 16, marketQuoted: true, market: { basis: 'props', quoted: true, priced: ['rec'], books: 6 } },
    { id: 'u|WR', name: 'Unquoted Man', position: 'WR', team: 'BBB', salary: 5000, onBoard: true, ironTunaPoints: 12, consensusPoints: 10, vegasPoints: 16, marketPoints: 14.8, marketQuoted: false, market: { basis: 'gamelines', quoted: false, priced: [] } }
  ];
  const one = DFS.build(twin, { cap: 10000, slots: ['WR'], flex: [], lineups: 1, seed: 7, mode: 'market' });
  ok('at the same price and the same raw market number, the quoted man wins',
     one.ok && one.lineups[0].players[0].id === 'q|WR');
  const rawVegas = DFS.build(twin, { cap: 10000, slots: ['WR'], flex: [], lineups: 1, seed: 7, mode: 'vegas' });
  ok('...which the raw Vegas mode cannot see, because both read 16.0 to it',
     rawVegas.ok && rawVegas.lineups[0].points === 16);

  // The same thing end to end on a board that DOES carry props, because the
  // fixture above is the empty-feed state and the loaded state must be proven
  // too: the week a book posts is the week this whole path is for.
  const quote = (row, markets, books, td) => {
    const q = { ...row, vegas: { ...row.vegas, basis: 'props', confidence: 'HIGH', td: td || null } };
    q.weeks = row.weeks.map(w => ({ ...w, vegasProjection: { status: 'full', priced: markets, missing: [], books, ageHours: 1.2, td: td || null } }));
    return q;
  };
  const PROPWEEK = { ok: true, players: WEEK.players.map(pl =>
    pl.name === 'Amon-Ra St. Brown' ? quote(pl, ['rec', 'recYd', 'anytimeTD'], 7, { probability: 44.5, books: 7, devigged: true })
    : pl.name === 'Josh Allen' ? quote(pl, ['passYd', 'passTD'], 5, null)
    : pl) };
  const lit = H.buildDfsSlate('dk', SAL, PROPWEEK, {});
  const arsb = lit.players.find(x => x.name === 'Amon-Ra St. Brown');
  ok('a quoted player on a real slate carries his markets and his books',
     arsb.marketQuoted === true && arsb.market.books === 7 && arsb.market.pricedLabels.includes('receiving yards'));
  ok('...and his market number is taken whole, not shrunk', near(arsb.marketPoints, arsb.vegasPoints, 0.05));
  ok('...and his touchdown price is the devigged market, not a derived one',
     arsb.tdBasis === 'anytime-td-market' && arsb.tdProbability === 44.5 && arsb.tdBooks === 7 && arsb.tdDevigged === true);
  ok('the slate reports real coverage once the books have posted',
     lit.hasProps === true && lit.props.priced === 2 && lit.props.coverage > 0 && lit.props.avgBooks === 6);
  ok('the note quotes the coverage instead of denying there are props',
     /The books have priced 2 of/.test(lit.note) && /receiving yards/.test(lit.note) && !/No player prop/.test(lit.note));
  ok('an unquoted man on the same slate is still discounted',
     lit.players.filter(x => x.onBoard && !x.marketQuoted).every(x => x.marketShrink < 1));
  // Being quoted is not a licence to be expensive — a priced $8,600 receiver
  // can still lose his slot to value, and should. What being quoted buys is
  // that his market number is not marked down, which is the whole mechanism.
  const unlit = slate.players.find(x => x.name === 'Amon-Ra St. Brown');
  ok('the same man is worth more to a market build once a book has priced him',
     arsb.marketPoints > unlit.marketPoints && near(unlit.marketPoints, unlit.consensusPoints + unlit.marketShrink * (unlit.vegasPoints - unlit.consensusPoints), 0.05));
  const litPlay = lit.players.filter(x => x.onBoard).map(x => ({ ...x, id: x.key }));
  const litBuild = DFS.build(litPlay, { ...opts, mode: 'market' });
  ok('the build reports how many of its own picks the books priced, accurately',
     litBuild.ok && litBuild.lineups[0].quoted === litBuild.lineups[0].players.filter(x => x.marketQuoted).length);
  ok('and the card can name what was quoted about any of them it did take',
     litBuild.lineups[0].players.filter(x => x.marketQuoted).every(x => x.market.pricedLabels.length > 0 && x.market.books > 0));
}

// ── Play of the Week ──────────────────────────────────────────────────────
// Two things this guards.
//
// The first is the bug it was born with. The recommendation compared a cash
// build's projection against a tournament build's, and it summed those
// projections off a per-player field that does not exist on a lineup player:
// the builder calls it `proj`, the page asked for `ironTunaPoints`. Every
// total was zero, every threshold compared zero with zero, and the answer was
// Head-to-Head on every slate the site has ever served. The builder's own
// lineup totals were correct the whole time and sitting unused.
//
// The second is the request: the step up a payout curve is a real risk, and
// the gap that justifies it has to be a disagreement with MONEY. Where the
// books priced nobody, the "market" number is the game total split across an
// offense, which shares most of its inputs with the projection it is being
// compared to — so the thresholds are divided by how much of the roster was
// actually quoted, and an unquoted slate needs twice the gap.
console.log('\nPlay of the Week');
{
  // proj 100, market 90 => an 11.1% edge, comfortably past every threshold.
  const build = (proj, market, ceil, floor, quoted, n) => ({
    projPoints: proj, marketPoints: market, ceilingPoints: ceil, floorPoints: floor,
    players: Array.from({ length: n || 9 }, (_, i) => ({
      proj: proj / (n || 9), marketPoints: market / (n || 9),
      marketQuoted: i < (quoted == null ? (n || 9) : quoted),
      market: { priced: ['recYd', 'rec'], books: 6 },
      tdBasis: i < (quoted == null ? (n || 9) : quoted) ? 'anytime-td-market' : 'derived'
    }))
  });

  ok('nothing to compare yields no recommendation', DFS.contestPick({}) === null && DFS.contestPick({ cash: build(100, 90, 200, 60) }) === null);

  // A fully quoted roster with a real edge climbs the curve.
  const hot = DFS.contestPick({
    cash: build(100, 90, 150, 70),
    tournament: build(100, 90, 200, 60),
    leverage: build(99, 90, 210, 55)
  });
  ok('the projection totals are the builder\'s own, not a sum of a field that is not there',
     hot.cashProj === 100 && hot.tourProj === 100, JSON.stringify({ c: hot.cashProj, t: hot.tourProj }));
  ok('the edge is measured against the market read', near(hot.edge, 11.1, 0.2), String(hot.edge));
  ok('a fully quoted roster is taken at face value', hot.need === 1 && hot.evidence.coverage === 1);
  ok('...and a real edge moves off Head-to-Head', hot.rec !== 'Head-to-Head', hot.rec);
  ok('...all the way to multi-entry when leverage keeps the median and buys ceiling',
     hot.rec === 'Tournament - Multi-Entry', hot.rec);

  // The same numbers with nobody priced. The bar doubles, and 11.1% still
  // clears it — the evidence is reported either way.
  const unpriced = DFS.contestPick({
    cash: build(100, 90, 150, 70, 0),
    tournament: build(100, 90, 200, 60, 0),
    leverage: build(99, 90, 210, 55, 0)
  });
  ok('an unquoted roster doubles the bar', unpriced.need === 2 && unpriced.evidence.coverage === 0);
  ok('...and says nobody was priced', unpriced.evidence.quoted === 0 && unpriced.evidence.of === 9);

  // A modest edge is enough when the books are behind it, and is not when
  // they are not. This is the whole of the request, in one pair.
  // 2.0% clears the multiplier bar at full coverage (1.8%) and misses the
  // doubled one (3.6%). Same slate, same number, different evidence.
  const modest = (quoted) => DFS.contestPick({
    cash: build(100, 98, 150, 70, quoted),
    tournament: build(100, 98, 200, 60, quoted),
    leverage: build(99, 98, 205, 55, quoted)
  });
  ok('a 2% edge on a fully quoted roster is acted on', modest(9).rec === 'Multiplier', modest(9).rec);
  ok('...and the same 2% on a roster nobody priced is not', modest(0).rec === 'Head-to-Head', modest(0).rec);
  ok('...because the bar moved, not the number', near(modest(9).edge, modest(0).edge, 0.001));

  // Half-priced sits between the two.
  const half = modest(5);
  ok('partial coverage raises the bar in proportion', near(half.need, 2 - 5 / 9, 0.01));

  ok('no edge stays at the highest hit rate',
     DFS.contestPick({ cash: build(100, 100, 150, 70), tournament: build(100, 100, 152, 60) }).rec === 'Head-to-Head');
  ok('a market number of zero is not an edge of minus one hundred percent',
     DFS.contestPick({ cash: build(100, 0, 150, 70), tournament: build(100, 0, 200, 60) }).edge === 0);

  // The evidence a reader is shown.
  ok('the evidence names the markets and the books behind them',
     hot.evidence.markets.join(',') === 'rec,recYd' && hot.evidence.books === 6);
  ok('...and how many touchdown prices were quoted rather than derived', hot.evidence.tdQuoted === 9);
  ok('the floor retention and ceiling multiple are real numbers now',
     hot.floorRetention === 70 && hot.ceilingMultiple === 200);

  // End to end against a real build off the fixture slate.
  const play = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const base = { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, lineups: 1, seed: 17 };
  const real = DFS.contestPick({
    cash: DFS.build(play, { ...base, mode: 'floor', maxPerTeam: 3 }).lineups[0],
    tournament: DFS.build(play, { ...base, mode: 'ceiling', stack: true, maxPerTeam: 4 }).lineups[0],
    leverage: DFS.build(play, { ...base, mode: 'leverage', stack: true, bringBack: true, maxPerTeam: 4 }).lineups[0]
  });
  ok('a real build produces a real projection total, not zero', real.cashProj > 0 && real.tourProj > 0);
  ok('...and a recommendation from the list', ['Head-to-Head', 'Multiplier', 'Tournament - Single Entry', 'Tournament - Multi-Entry'].includes(real.rec));
  ok('...and counts the fixture slate, which no book priced, as unquoted', real.evidence.quoted === 0 && real.need === 2);
}

console.log('\nthe DFS page explanations');
{
  const page = fs.readFileSync(path.join(ROOT, 'dfs.html'), 'utf8');
  ok('DFS setup begins with three ordered dropdowns', page.indexOf('id="dfGameStyleSelect"') < page.indexOf('id="dfGamesSelect"') && page.indexOf('id="dfGamesSelect"') < page.indexOf('id="dfPayoutSelect"'));
  ok('Game Style contains the full DraftKings format menu', ['Flash Draft','Classic','Showdown Captain Mode','Pick6','Best Ball','Tiers','In-Game Showdown','Single Stat - Total Yards','Single Stat - Touchdowns','Snake','Snake Showdown','Madden Classic','Madden Showdown Captain Mode'].every(x => page.includes('>'+x+'</option>')));
  ok('Games is disabled until Game Style and is built from the loaded slate', page.includes('id="dfGamesSelect" disabled required') && page.includes('function populateGamesSelect(s)') && page.includes('All listed games') && page.includes('1 PM ET games') && page.includes('4 PM / late afternoon games') && page.includes('Primetime games') && page.includes('Custom game selection'));
  ok('single-game formats are tagged so Games can collapse to individual matchups', page.includes("'showdown-captain': { label:'Showdown Captain Mode'") && page.includes("single:true") && page.includes("if (!style.single)"));
  ok('Payout Structure contains cash, multiplier, tournament and qualifier choices', ['Head-to-Head','50/50','Double Up','Multiplier (3x / 5x / 10x)','Tournament - Single Entry','Tournament - Multi-Entry','Satellite / Qualifier','League / Private Contest'].every(x => page.includes('>'+x+'</option>')));
  ok('Payout Structure maps to optimizer risk shapes', page.includes("h2h: { label:'Head-to-Head', shape:'cash'") && page.includes("'double-up': { label:'Double Up', shape:'cash'") && page.includes("multiplier: { label:'Multiplier', shape:'single'") && page.includes("'tournament-multi': { label:'Tournament - Multi-Entry', shape:'gpp'"));
  ok('the setup is sequential and required', page.includes("if (!gameStyle || !gameChoice || !payoutStructure) return false") && page.includes("First select Game Style.") && page.includes("Next select the Games / player pool.") && page.includes("Finally select the Payout Structure."));
  ok('selected games actually filter the optimizer and every DFS board', page.includes('function filteredSlate()') && page.includes('selectedGames[playerGameKey(p)]') && page.includes('dashboard(view); envTable(view); values(view); pool(view); stacks(view); tdBoard(view);'));
  ok('non-Classic formats do not receive an illegal Classic roster', page.includes("function styleSupportsOptimizer() { return site !== 'dk' || gameStyle === 'classic'; }") && page.includes('The Classic lineup solver is hidden because this DraftKings format uses different roster or scoring rules.'));
  ok('DraftKings terminology retains hover help', page.includes('.df-term:hover::after') && page.includes('data-tip="The roster and scoring format DraftKings uses.') && page.includes('data-tip="How the contest awards prizes.'));
  // The thresholds moved into the optimizer, where they are exercised against
  // real lineups rather than matched as strings in a page.
  ok('Play of the Week evaluates payout risk and reward', page.includes('id="dfPlayWeek"') && page.includes('function renderPlayOfWeek(s)')
     && page.includes('ITDfs.contestPick(') && page.includes('moves away from it only when the model can buy enough additional ceiling or leverage'));
  ok('every contest on the curve is named by the optimizer, not the page',
     ['Head-to-Head', 'Multiplier', 'Tournament - Single Entry', 'Tournament - Multi-Entry']
       .every(r => Object.values(DFS.MODES) && JSON.stringify(DFS.contestPick({ cash: { projPoints: 1, players: [] }, tournament: { projPoints: 1, players: [] } })) !== null && fs.readFileSync(path.join(ROOT, 'dfs-optimizer.js'), 'utf8').includes(r)));
  ok('the page says what the recommendation is standing on', page.includes('The edge is measured against those quoted lines.') || page.includes('The edge below is measured against those quoted lines.'));
  ok('...and says plainly when no book priced any of it', page.includes('No book priced any pick in this build') && page.includes('not a disagreement with money'));
  ok('the page no longer re-sums lineup totals off a field that is not there', !page.includes('function lineupStat'));
  ok('DFS Academy links to the two new strategy articles', page.includes('href="/dfs-getting-started"') && page.includes('href="/dfs-strategy-guide"') && fs.existsSync(path.join(ROOT,'dfs-getting-started.html')) && fs.existsSync(path.join(ROOT,'dfs-strategy-guide.html')));
  ok('the lead roster has a larger summary, side breakdown, and player fit lines', page.includes('.df-explain-summary p{margin:0;color:#d5e2df;font-size:16px') && page.includes('Lineup Breakdown') && page.includes('class="df-fit"'));
  ok('player names expose a calculation drawer', page.includes('id="dfPlayerModal"') && page.includes('function openPlayerCalc') && page.includes('df-player-link'));
  ok('the player drawer labels modeled ownership as a model', page.includes('Modeled ownership') && page.includes('not an operator or third-party ownership feed'));
  ok('DraftKings FPPG is always paired with the Iron Tuna projection and edge', page.includes('DraftKings FPPG') && page.includes('Iron Tuna Projection') && page.includes('Tuna Edge') && page.includes('historical fantasy-points-per-game average'));
  // The What If box forced ONE player in by name, which is what Require does
  // now for any number of them, from the roster row, the alternates or the
  // drawer. Two controls for one job is one too many, so the box came out --
  // markup, styles, its five functions, its listeners and the coach's separate
  // `forcedIn` name for the player it held.
  ok('the What If box is gone, root and branch',
     !/whatIf|WhatIf|df-whatif|data-whatif-key/.test(page));
  ok('and Require is the one way in, from every roster and from any name on the board',
     page.includes("function isRequired(key) { return marks[key] === 'lock'; }")
     && page.includes('function rosterActions(p)') && page.includes('Require in every lineup'));
  // Requiring and excluding used to be reachable only from the pool table
  // inside the closed fine-tune panel. The roster is where the reader argues
  // with the solve, so the two controls sit on the roster row.
  ok('every roster row carries a Require and an Exclude control',
     page.includes('function rosterActions(p)') && page.includes("data-mark=\"lock\"") && page.includes("data-mark=\"excl\"")
     && page.includes("+ rosterActions(p) + '</span>'"));
  // They sit on the NAME LINE beside the plus, never inside the disclosure
  // row: a control that changes the roster cannot live behind a toggle the
  // reader has to find first.
  ok('and they sit on the name line, not behind the note toggle',
     /df-fit-toggle[\s\S]{0,260}rosterActions\(p\)[\s\S]{0,40}df-pname-line|df-fit-toggle[\s\S]{0,300}rosterActions\(p\)/.test(page)
     && !/df-fitrow[\s\S]{0,400}rosterActions\(p\)/.test(page));
  // The controls were on the lead board only at first, which left a reader
  // looking at Alternate 2 with no way to drop the man in front of him. The
  // row markup is shared, so the alternates carry the same pair and write the
  // same one list of constraints.
  ok('the alternates carry them too, off the same shared row markup and the same constraint list',
     !page.includes('lead ? rosterActions')
     && /var rows = l\.players\.map\([\s\S]{0,1400}rosterActions\(p\)/.test(page));
  ok('the player drawer can require or exclude anyone on the board, not only the nine on the roster',
     page.includes('Require in every lineup') && page.includes('Exclude from every lineup'));
  ok('every require/exclude control writes the same marks store and re-solves',
     page.includes('function applyMark(act, key)') && page.includes("marks[key] = 'lock'") && page.includes("marks[key] = 'excl'")
     && page.includes("['dfLineups', 'dfPlayerBody', 'dfConstraints'].forEach"));
  // A lock is a decision and the builder does not overrule a decision, but the
  // page says what the decision was: this warning used to live in the What If
  // box, and it belongs to the constraint, not to the control that set it.
  ok('requiring a man who is not playing still says so, now on the constraint itself',
     page.includes("r.kind === 'lock' && r.p.available === false")
     && page.includes('He is not playing this week')
     && page.includes('only because you put him there'));
  ok('every constraint the build carries is listed above the roster with its own undo',
     page.includes('function renderConstraints(l)') && page.includes('Your constraints') && page.includes("data-mark=\"clear\"")
     && page.includes("data-mark=\"clearall\"") && page.includes('renderConstraints(lead);'));
  // A reader who already has three men in a submitted entry has to put those
  // three IN by name; the roster rows only reach the nine the builder chose.
  // The search takes them one after another and never closes on a pick.
  ok('a player can be required by name, as many as the reader has',
     page.includes('id="dfReqInput"') && page.includes('function requireMatches(value)')
     && page.includes('function requireByKey(key)') && page.includes("marks[key] = 'lock'")
     && page.includes('data-require-key'));
  ok('and the search survives the re-solve it triggers, so the next name can be typed straight away',
     page.includes('id="dfConstraints" hidden') && page.includes("$('dfConstraintChips').innerHTML")
     && !/\$\('dfLineups'\)\.innerHTML = [^;]*dfReqInput/.test(page)
     && page.includes("input.value = ''; input.focus();"));
  ok('a name already required cannot be required twice',
     page.includes("var already = marks[p.key] === 'lock'") && page.includes('already required'));
  ok('the constraints stay on screen when they leave no legal lineup, so they can be undone',
     page.includes('renderConstraints(null);') && page.includes('Clear one of the constraints above'));
  // "Clear a constraint" is the wrong advice to a reader whose required men are
  // already in a submitted entry. The arithmetic is the useful answer.
  ok('and a roster that cannot fit the required players says why, in money',
     page.includes('function shortfallNote(players, lockKeys, slots, flex, cap)')
     && page.includes('The cheapest legal fill for the other ')
     && page.includes('cannot all be seated: this roster has no free slot'));
  ok('a required player the solve could not seat is said out loud rather than quietly dropped',
     page.includes('could not be seated under the current cap and rules'));
  ok('a man who is not playing is marked in the player pool, not quietly dropped', page.includes('function weekTag(p)') && page.includes('df-week-out') && page.includes('df-row-out'));
  ok('the page says who it took off the board and how to put him back', page.includes('function benchedNote(r)') && page.includes('off the board:') && page.includes('Lock one in the player pool below to build around him anyway.'));
  ok('forcing an unavailable player in says so rather than pretending he is a normal pick', page.includes('He is not playing this week'));
  ok('a player who changed clubs is flagged beside his stale projection', page.includes('p.teamChanged && p.rosterTeam'));
  ok('the objective row offers a prop-first market build', page.includes('data-mode="market"') && page.includes('Market read'));
  ok('the player pool says whether a man was quoted or inferred', page.includes('function marketTag(p)') && page.includes('df-mkt-quoted') && page.includes('df-mkt-inferred') && page.includes('MARKET_CHIP'));
  ok('every recommended player carries what the books actually posted on him', page.includes('function marketPhrase(p)') && page.includes('The books posted ') && page.includes('df-mktline'));
  ok('the lead card shows how much of the roster the market priced, and says so when none of it was',
     page.includes('function propsNote(l)') && page.includes('picks are priced by the books') && page.includes('No player prop is behind this lineup'));
  ok('the slate dashboard reports prop coverage as a number, not a boolean', page.includes("card('Books priced'") && page.includes('s.props.coverage'));
  ok('a quoted anytime-touchdown price is named as devigged market, never as a derived one', page.includes("p.tdBasis === 'anytime-td-market'") && page.includes('devigged'));
  ok('a partly quoted man says which part of his line is still the game environment', page.includes("m.status === 'partial'") && page.includes('still the game environment'));
  ok('a man priced only on his touchdown says so, and is not shown as unpriced', page.includes('m.shortOfProjection') && page.includes('TD ONLY') && page.includes('and nothing else'));
  const scripts = [...page.matchAll(/<script(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(Boolean);
  ok('every inline DFS script parses', (() => { try { scripts.forEach(code => new Function(code)); return true; } catch (err) { console.log(err.message); return false; } })());
}

// The homepage carried a SECOND DFS builder — its own contest setup, its own
// solved roster and its own matchup panel — inside a "DFS" lane tab. It came off
// in the September 2026 rewrite: "/" is five sections now, and the DFS card
// there links the five places on /dfs that finish the decision. /dfs is the one
// builder, so these assertions moved onto it.
console.log('\nthe DFS sheet is the only builder');
{
  const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
  const dfs = fs.readFileSync(path.join(ROOT, 'dfs.html'), 'utf8');

  ok('DFS begins with Game Style, Games and Payout Structure dropdowns',
     dfs.indexOf('id="dfGameStyleSelect"') < dfs.indexOf('id="dfGamesSelect"')
     && dfs.indexOf('id="dfGamesSelect"') < dfs.indexOf('id="dfPayoutSelect"'));
  ok('Game Style carries all DraftKings formats',
     ['Flash Draft', 'Classic', 'Showdown Captain Mode', 'Pick6', 'Best Ball', 'Tiers',
      'In-Game Showdown', 'Snake', 'Madden Classic'].every((f) => dfs.includes(f)));
  ok('Games offers time windows and individual games from the live slate',
     dfs.includes('1 PM ET games') && dfs.includes('4 PM / late afternoon games'));
  // The homepage mapped payouts straight onto optimizer objectives with a flat
  // lookup. /dfs's PAYOUTS table is the richer version and the one that ships:
  // every payout names the contest SHAPE it solves as, and every shape is a
  // preset over the same optimizer.
  ok('payout choice maps into cash, single-entry and tournament shapes',
     /h2h: \{ label:'Head-to-Head', shape:'cash'/.test(dfs)
     && /'double-up': \{ label:'Double Up', shape:'cash'/.test(dfs)
     && /'tournament-multi': \{ label:'Tournament - Multi-Entry', shape:'gpp'/.test(dfs)
     && /'tournament-single': \{ label:'Tournament - Single Entry', shape:'single'/.test(dfs));
  ok('every payout resolves to a shape the optimizer actually has',
     (() => {
       const shapes = new Set([...dfs.matchAll(/shape:'([a-z0-9]+)'/g)].map((m) => m[1]));
       const defined = new Set([...(dfs.match(/var SHAPES = \{[\s\S]*?\n  \};/) || [''])[0]
         .matchAll(/^\s*'?([a-z0-9-]+)'?: \{ mode:/gm)].map((m) => m[1]));
       return [...shapes].every((x) => defined.has(x));
     })());
  ok('the slate filters the actual eligible player pool',
     /function .*[Ff]ilter/.test(dfs) && dfs.includes('dfCustomGames'));
  ok('Play of the Week and both DFS Academy articles are on the sheet',
     dfs.includes('id="dfPlayWeekTitle"') && dfs.includes('/dfs-getting-started') && dfs.includes('/dfs-strategy-guide'));
  ok('a computed DraftKings average is marked as an estimate, in the cell and in the foot',
     dfs.includes("p.operatorFppgBasis === 'computed'") && dfs.includes('df-est'));
  // The per-player panel: /dfs prints the full calculation behind a name,
  // consensus -> market -> Iron Tuna included. (The homepage lane's lighter
  // "matchup under a name" slide, and the league-wide NFL shield artwork beside
  // its story cards, were that lane's own and went with it.)
  ok('a name on the board opens the calculation behind it',
     dfs.includes('df-player-link') && dfs.includes('id="dfPlayerBody"')
     && /Consensus ' \+ n1\(p\.consensusPoints\)/.test(dfs));

  // And the homepage keeps no second copy of any of it.
  ok('the homepage carries no DFS builder',
     !/id="dfsGameStyle"|id="dfsSubmit"|id="dfsBuild"|dfs-setup/.test(front));
  ok('it links the sheet instead, at the five places that finish the decision',
     ['/dfs#dfPlayWeek', '/dfs#lineup', '/dfs#dfTune', '/dfs#stacks', '/dfs#values']
       .every((h) => front.includes('href="' + h + '"')));
  ok('and every anchor it links is a real element or section on the sheet',
     ['dfPlayWeek', 'dfTune'].every((id) => dfs.includes('id="' + id + '"'))
     && ['lineup', 'stacks', 'values'].every((k) => dfs.includes('id="sec-' + k + '"')));
  ok('the homepage does not load the optimizer it no longer runs',
     !front.includes('/dfs-optimizer.js'));

  const frontScripts = [...front.matchAll(/<script(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((c) => c.trim());
  ok('every inline homepage script still parses', (() => { try { frontScripts.forEach((code) => new Function(code)); return true; } catch (err) { console.log(err.message); return false; } })());
}

console.log('\nthe operator average when the file has none');
{
  const usage = { players: { [_oddsNorm('Jahmyr Gibbs') + '|RB']: { season: { games: 2, stats: { rushYd: 190, rushTD: 2, rec: 6, recYd: 50 } } } } };
  const sal = SAL.map(s => s.name === 'Jahmyr Gibbs' || s.name === 'Bears ' ? { ...s, operatorFppg: null } : s);
  const s2 = H.buildDfsSlate('dk', sal, WEEK, { usage });
  const gibbs = s2.players.find(p => p.name === 'Jahmyr Gibbs');
  // 190 rushing yards, 2 TDs, 6 catches, 50 receiving yards over two games at
  // DK scoring: (19 + 12 + 6 + 5) / 2. The 100-yard bonus is per game and a
  // season total cannot say which game earned it, so it is not applied.
  ok('a missing average is computed from the season box score at site scoring, per game', near(gibbs.operatorFppg, 21, 0.06) && gibbs.operatorFppgBasis === 'computed' && gibbs.operatorFppgGames === 2, String(gibbs.operatorFppg));
  ok('and the edge is measured against it', near(gibbs.projectionVsFppg, _oddsRound(gibbs.ironTunaPoints - 21), 0.11));
  ok('a file average keeps its basis', s2.players.find(p => p.name === 'Josh Allen').operatorFppg === 10 && s2.players.find(p => p.name === 'Josh Allen').operatorFppgBasis === 'operator');
  ok('a defense with no average stays blank rather than guessed', (() => { const b = s2.players.find(p => p.position === 'DST' && p.team === 'CHI'); return b.operatorFppg === null && b.operatorFppgBasis === null; })());
  ok('no overlay: blank, with the basis null and no edge', (() => { const g = H.buildDfsSlate('dk', sal, WEEK, {}).players.find(p => p.name === 'Jahmyr Gibbs'); return g.operatorFppg === null && g.projectionVsFppg === null && g.operatorFppgBasis === null; })());
  ok('a player with no games yet stays blank', (() => { const g = H.buildDfsSlate('dk', sal, WEEK, { usage: { players: { [_oddsNorm('Jahmyr Gibbs') + '|RB']: { season: { games: 0, stats: {} } } } } }).players.find(p => p.name === 'Jahmyr Gibbs'); return g.operatorFppg === null && g.operatorFppgGames === 0; })());
  ok('every priced row carries the matchup a reader opens it for', s2.players.filter(p => p.onBoard).every(p => 'kickoff' in p && 'opponentDefRank' in p));
  const love = { name: 'Jeremiyah Love', position: 'RB', team: 'ARI', opponent: 'SEA', salary: 5900, operatorFppg: null };
  const pinned = H.buildDfsSlate('dk', [...sal, love], WEEK, {}).players.find(p => p.name === 'Jeremiyah Love');
  ok('a figure the desk pinned by hand fills a blank the overlay cannot, as an estimate', pinned.operatorFppg === 13 && pinned.operatorFppgBasis === 'computed');
  const loveUsage = { players: { [_oddsNorm('Jeremiyah Love') + '|RB']: { season: { games: 1, stats: { rushYd: 80, rushTD: 1, rec: 2, recYd: 10 } } } } };
  ok('and the overlay wins over the pin when it has his line', H.buildDfsSlate('dk', [...sal, love], WEEK, { usage: loveUsage }).players.find(p => p.name === 'Jeremiyah Love').operatorFppg === 17);
  ok('the pin is per site', H.buildDfsSlate('fd', [...sal, love], WEEK, {}).players.find(p => p.name === 'Jeremiyah Love').operatorFppg === null);
}

console.log('\nthe optimizer');
{
  const players = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const base = { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex };
  const r = DFS.build(players, { ...base, mode: 'ironTuna', lineups: 1 });
  ok('a lineup is built', r.ok && r.lineups.length === 1);
  const L = r.lineups[0];
  ok('lineup rows carry operator FPPG and the projection edge', L.players.every(p => typeof p.operatorFppg === 'number' && typeof p.projectionVsFppg === 'number'));
  ok('and say where the average came from', L.players.every(p => p.operatorFppgBasis === 'operator') && DFS.build(players.map(p => ({ ...p, operatorFppgBasis: 'computed' })), { ...base, mode: 'ironTuna', lineups: 1 }).lineups[0].players.every(p => p.operatorFppgBasis === 'computed'));
  ok('it fills every slot', L.players.length === 9 && L.players.every(p => p.id));
  ok('it respects the cap', L.salary <= 50000);
  ok('each slot holds an eligible position', L.players.every(p => p.slot === p.position || (p.slot === 'FLEX' && /RB|WR|TE/.test(p.position))));
  ok('no player twice', new Set(L.players.map(p => p.id)).size === 9);
  ok('nothing here submits anything', !/fetch\(|XMLHttpRequest|submit/i.test(fs.readFileSync(path.join(ROOT, 'dfs-optimizer.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  // Exhaustive check against the greedy answer on this small slate.
  const modePts = p => p.ironTunaPoints;
  let best = 0;
  const bySlot = base.slots.map(s => players.filter(p => p.position === s || (s === 'FLEX' && /RB|WR|TE/.test(p.position))));
  const rec = (i, used, sal, pts) => { if (i === bySlot.length) { if (pts > best) best = pts; return; } for (const p of bySlot[i]) { if (used.has(p.id) || sal + p.salary > 50000) continue; used.add(p.id); rec(i + 1, used, sal + p.salary, pts + modePts(p)); used.delete(p.id); } };
  rec(0, new Set(), 0, 0);
  ok('it finds the exact optimum on a slate small enough to enumerate', near(L.points, Math.round(best * 10) / 10, 0.11), L.points + ' vs ' + best);
  const locked = DFS.build(players, { ...base, mode: 'ironTuna', lock: ['aaronrodgers|QB'] });
  ok('a lock is honored', locked.lineups[0].players.some(p => p.id === 'aaronrodgers|QB'));
  const excluded = DFS.build(players, { ...base, mode: 'ironTuna', exclude: ['jahmyrgibbs|RB'] });
  ok('an exclusion is honored', !excluded.lineups[0].players.some(p => p.id === 'jahmyrgibbs|RB'));
  // A required player is a CONSTRAINT, not a preference, and that is the whole
  // point of a Require button: several at once all have to be seated, each in a
  // slot his position may fill.
  const backs = players.filter(p => p.position === 'RB').sort((a, b) => a.salary - b.salary).slice(0, 2).map(p => p.id);
  const manyLocks = DFS.build(players, { ...base, mode: 'ironTuna', lock: backs });
  ok('two required running backs are both seated', manyLocks.ok && backs.every(id => manyLocks.lineups[0].players.some(p => p.id === id)),
     JSON.stringify((manyLocks.lineups[0] || { players: [] }).players.map(p => p.slot + ':' + p.name)));
  ok('and every one of them lands in a slot his position may fill',
     manyLocks.ok && manyLocks.lineups[0].players.every(p => p.slot === p.position || (p.slot === 'FLEX' && /RB|WR|TE/.test(p.position))));
  // The cap, the stack and the team maximum are constraints too, and a lock may
  // never be honored by breaking one of them. When the requirements genuinely
  // do not fit, the answer is NO LINEUP -- a roster quietly missing the player
  // the reader required answers a question nobody asked.
  const tooMany = DFS.build(players, { ...base, mode: 'ironTuna', lock: players.filter(p => p.position === 'RB').map(p => p.id) });
  ok('requirements that cannot fit under the cap return no lineup, never a lineup missing one of them',
     !tooMany.ok || tooMany.lineups.every(l => l.salary <= 50000 && players.filter(p => p.position === 'RB').every(q => l.players.some(p => p.id === q.id))));
  const lockedStack = DFS.build(players, { ...base, mode: 'ironTuna', lock: ['jahmyrgibbs|RB'], stack: true, bringBack: true });
  ok('a required player does not get honored by breaking the stack or the cap',
     !lockedStack.ok || (lockedStack.lineups[0].salary <= 50000
       && lockedStack.lineups[0].players.some(p => p.id === 'jahmyrgibbs|RB')));
  // Required and excluded in the same breath is the reader contradicting
  // himself; the exclusion is the narrower instruction and it wins, rather than
  // the whole board coming back empty.
  const both = DFS.build(players, { ...base, mode: 'ironTuna', lock: ['jahmyrgibbs|RB'], exclude: ['jahmyrgibbs|RB'] });
  ok('a player required and excluded at once is excluded, and a lineup still builds',
     both.ok && !both.lineups[0].players.some(p => p.id === 'jahmyrgibbs|RB'));
  // The note is read far more often now that a reader can add constraints from
  // the roster, so it has to agree with its own number.
  const oneOnly = DFS.build(players, { ...base, mode: 'ironTuna', lineups: 3, cap: 47000 });
  ok('the shortfall note agrees with its own count',
     !oneOnly.note || /^Only 1 distinct lineup satisfies /.test(oneOnly.note) || /^Only \d+ distinct lineups satisfy /.test(oneOnly.note),
     oneOnly.note);
  const stacked = DFS.build(players, { ...base, mode: 'vegas', stack: true, stackSize: 1 });
  const qb = stacked.lineups[0].players.find(p => p.slot === 'QB');
  ok('a QB stack puts a pass-catcher from his team in the lineup', stacked.lineups[0].players.some(p => p.team === qb.team && /WR|TE/.test(p.position)), JSON.stringify(stacked.lineups[0].players.map(p => p.name)));
  const bb = DFS.build(players, { ...base, mode: 'vegas', stack: true, bringBack: true });
  const qb2 = bb.lineups[0].players.find(p => p.slot === 'QB');
  ok('a bring-back adds a player from the opponent', bb.lineups[0].players.some(p => p.team === qb2.opponent && p.position !== 'DST'), qb2.opponent + ' ' + JSON.stringify(bb.lineups[0].players.map(p => p.team)));
  const capped = DFS.build(players, { ...base, mode: 'ironTuna', maxPerTeam: 2 });
  const counts = {}; capped.lineups[0].players.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
  ok('a per-team maximum is honored', Object.values(counts).every(n => n <= 2), JSON.stringify(counts));
  const tight = DFS.build(players, { ...base, cap: 48500, mode: 'ironTuna' });
  ok('a lower cap is honored', tight.ok && tight.lineups[0].salary <= 48500, JSON.stringify(tight.note));
  const noRoster = DFS.build(players, { ...base, cap: 45000, mode: 'ironTuna' });
  ok('a cap just under the cheapest roster returns no lineup and says so, never a lineup over the cap', noRoster.ok === false && noRoster.lineups.length === 0 && /0 distinct/.test(noRoster.note));
  const many = DFS.build(players, { ...base, mode: 'ironTuna', lineups: 3 });
  ok('several lineups are distinct', many.lineups.length >= 2 && new Set(many.lineups.map(l => l.key)).size === many.lineups.length);
  ok('and ordered best first', many.lineups.every((l, i) => i === 0 || l.points <= many.lineups[i - 1].points + 0.11));
  const edge = DFS.build(players, { ...base, mode: 'vegasEdge' });
  ok('the Vegas Edge mode exists and builds', edge.ok && edge.mode === 'Vegas Edge');
  ok('the consensus mode exists and builds', DFS.build(players, { ...base, mode: 'consensus' }).ok);
  const impossible = DFS.build(players, { ...base, cap: 20000 });
  ok('an impossible cap yields no lineup rather than a broken one', impossible.ok === false && impossible.lineups.length === 0);

  // ── the contest shapes ───────────────────────────────────────────────────
  // The three objectives the site's contest switch presets. They exist because
  // the best lineup in a double-up is not the best lineup in a 150,000-entry
  // tournament, and the page would be lying if all four shapes solved the same
  // number. The fixture carries no floor/ceiling/ownership fields, so this also
  // covers the fallback path: the optimizer reconstructs them from the same
  // positional variance the worker uses rather than degrading to the median.
  const floorL = DFS.build(players, { ...base, mode: 'floor' });
  const ceilL = DFS.build(players, { ...base, mode: 'ceiling' });
  const levL = DFS.build(players, { ...base, mode: 'leverage' });
  ok('the floor, ceiling and leverage modes all build', floorL.ok && ceilL.ok && levL.ok);
  ok('each names itself', floorL.mode === 'Safest floor' && ceilL.mode === 'Highest ceiling' && levL.mode === 'Ceiling per point of ownership');
  ok('a lineup carries its projection, floor and ceiling alongside the objective',
     ['projPoints', 'floorPoints', 'ceilingPoints'].every(k => typeof ceilL.lineups[0][k] === 'number'));
  ok('the floor is under the projection and the ceiling over it',
     floorL.lineups[0].floorPoints < floorL.lineups[0].projPoints && floorL.lineups[0].projPoints < floorL.lineups[0].ceilingPoints,
     JSON.stringify({ f: floorL.lineups[0].floorPoints, p: floorL.lineups[0].projPoints, c: floorL.lineups[0].ceilingPoints }));
  ok('the ceiling mode maximizes the ceiling, and the floor mode does not beat it there',
     ceilL.lineups[0].ceilingPoints >= floorL.lineups[0].ceilingPoints - 1e-9,
     ceilL.lineups[0].ceilingPoints + ' vs ' + floorL.lineups[0].ceilingPoints);
  ok('the floor mode maximizes the floor, and the ceiling mode does not beat it there',
     floorL.lineups[0].floorPoints >= ceilL.lineups[0].floorPoints - 1e-9,
     floorL.lineups[0].floorPoints + ' vs ' + ceilL.lineups[0].floorPoints);
  ok('every shape still respects the cap and fills the roster',
     [floorL, ceilL, levL].every(r => r.lineups[0].salary <= 50000 && r.lineups[0].players.length === 9));
  // With no ownership on the slate there is nothing to discount by, so leverage
  // must fall back to the ceiling rather than to a number it cannot compute.
  ok('leverage with no ownership on the board falls back to the ceiling, not to nothing',
     near(levL.lineups[0].points, ceilL.lineups[0].points, 0.11), levL.lineups[0].points + ' vs ' + ceilL.lineups[0].points);
  // And with ownership present it must actually move off the chalk.
  const owned = players.map((p, i) => ({ ...p, ownership: i % 3 === 0 ? 34 : 4 }));
  const chalkFree = DFS.build(owned, { ...base, mode: 'leverage' });
  const heavy = l => l.players.filter(p => (owned.find(q => q.id === p.id) || {}).ownership >= 34).length;
  ok('ownership moves the leverage build off the chalk',
     chalkFree.ok && heavy(chalkFree.lineups[0]) <= heavy(DFS.build(owned, { ...base, mode: 'ceiling' }).lineups[0]),
     'leverage kept ' + heavy(chalkFree.lineups[0]) + ' chalk bodies');
  ok('a lineup reports its total modeled ownership when the board carries it',
     typeof chalkFree.lineups[0].ownership === 'number' && chalkFree.lineups[0].ownership > 0);
}
// The second number on the lineup card: what an ORDINARY entry on this slate
// projects for, so the roster's own projection has a scale beside it. The
// method is the ownership model the slate already carries -- each seat is the
// ownership-weighted mean projection of the players eligible for it -- so
// these tests are as much about what it REFUSES to print as about the number.
console.log('\nthe field\'s average entry');
{
  const players = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const base = { slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, cap: 50000 };
  ok('a board with no modeled ownership has no field to average', DFS.fieldAverage(players, base) === null);

  // Ownership that rises with the projection, which is roughly what the
  // model does: the field pays up for the best players.
  const top = Math.max(...players.map(p => p.ironTunaPoints));
  const owned = players.map(p => ({ ...p, ownership: Math.round((4 + 26 * (p.ironTunaPoints / top)) * 10) / 10 }));
  const fa = DFS.fieldAverage(owned, base);
  ok('with ownership on the board it returns a number and says where it came from',
     fa && typeof fa.points === 'number' && fa.points > 0 && fa.basis === 'modeled-ownership', JSON.stringify(fa));
  ok('it counts one seat per roster slot', fa.slots === H.DFS_SITES.dk.slots.length);
  const solved = DFS.build(owned, { ...base, cap: 50000, mode: 'ironTuna', lineups: 1 }).lineups[0];
  ok('the optimal lineup beats the typical entry', solved.projPoints > fa.points, solved.projPoints + ' vs ' + fa.points);
  // A nine-man roster of the worst bodies on the board is still a floor the
  // average cannot go under, and the best nine a ceiling it cannot go over.
  const asc = owned.slice().sort((a, b) => a.ironTunaPoints - b.ironTunaPoints);
  const worst9 = asc.slice(0, 9).reduce((n, p) => n + p.ironTunaPoints, 0);
  const best9 = asc.slice(-9).reduce((n, p) => n + p.ironTunaPoints, 0);
  ok('and it sits inside the board, between the worst nine and the best nine',
     fa.points > worst9 && fa.points < best9, [worst9, fa.points, best9].join(' / '));

  // Ownership is a weight, not a total: doubling every share describes the
  // same field and must produce the same average.
  const doubled = DFS.fieldAverage(owned.map(p => ({ ...p, ownership: p.ownership * 2 })), base);
  ok('scaling every ownership share leaves the average where it was', near(doubled.points, fa.points, 0.05));

  // The field is the field. A reader's own locks and exclusions are not
  // passed to it at all, and the one thing that does move it is a man who is
  // not playing -- nobody's average entry starts him.
  const out = owned.map(p => p.position === 'QB' ? { ...p, available: false } : p);
  ok('a slate whose every quarterback is out has no average entry', DFS.fieldAverage(out, base) === null);
  // It follows the board it is drawn from: the fixture is fifteen bodies for
  // nine seats, too tight to thin out further, so the projections move
  // instead of the pool.
  ok('a board where every projection is worth a point more raises it, by about the nine points it added',
     near(DFS.fieldAverage(owned.map(p => ({ ...p, ironTunaPoints: p.ironTunaPoints + 1 })), base).points - fa.points, 9, 0.3));
  ok('and halving every projection halves it',
     near(DFS.fieldAverage(owned.map(p => ({ ...p, ironTunaPoints: p.ironTunaPoints / 2 })), base).points, fa.points / 2, 0.6));

  // The cap is not decoration: every entry in the sample is one somebody
  // could submit, which is the whole reason the sample exists.
  ok('the typical entry can afford itself', fa.salary <= 50000, fa.salary + ' of 50000');
  // The fixture is fifteen players for nine seats under a $50,000 cap, so
  // most draws dead-end on affordability and are thrown away rather than
  // repaired into something the field would not have entered. What survives
  // still has to be a sample and not an anecdote.
  ok('and it is an average of a real sample, not of one draw', fa.entries >= 200 && fa.trials >= 200, JSON.stringify(fa));
  ok('a slate nobody could field a legal roster on returns null',
     DFS.fieldAverage(owned.map(p => ({ ...p, salary: 40000 })), base) === null);
  ok('and so does a call with no cap to build under', DFS.fieldAverage(owned, { slots: base.slots, flex: base.flex }) === null);

  // Printed to a tenth, so the tenth has to hold still. The page fixes the
  // seed, and a reader who re-solves an unchanged board must not watch the
  // field's average wander.
  ok('the same board draws the same number twice', DFS.fieldAverage(owned, base).points === fa.points);
  const shifted = DFS.fieldAverage(owned, { ...base, seed: 991 });
  ok('and a different seed lands within a quarter point of it',
     Math.abs(shifted.points - fa.points) <= 0.25, shifted.points + ' vs ' + fa.points);

  // Half a roster is not a typical entry, so a seat nobody can fill prints
  // nothing rather than a total that quietly counts eight slots.
  ok('a board with no defense at all returns null rather than an eight-man average',
     DFS.fieldAverage(owned.filter(p => p.position !== 'DST'), base) === null);
  ok('and so does a call with no roster format to fill', DFS.fieldAverage(owned, {}) === null);

  // What the page does with it.
  const page = fs.readFileSync(path.join(ROOT, 'dfs.html'), 'utf8');
  ok('the page solves the field average off the whole priced board', page.includes('ITDfs.fieldAverage(players, { slots: view.slots, flex: view.flex, cap:'));
  ok('the lineup card prints it in parentheses beside the projection',
     page.includes("stat(n1(l.projPoints) + fieldPar, 'Iron Tuna Projection', true)"));
  ok('the board says in words what the parenthetical is', page.includes('is the typical entry.'));
  ok('the coach is handed the same number rather than left to derive one',
     page.includes('typicalEntryPoints') && page.includes('vsTypicalEntry')
     && fs.readFileSync(path.join(ROOT, 'dfs-coach.js'), 'utf8').includes('typicalEntryPoints'));
  ok('the method is written down', fs.readFileSync(path.join(ROOT, 'docs/dfs-metrics.md'), 'utf8').includes('Typical entry'));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
