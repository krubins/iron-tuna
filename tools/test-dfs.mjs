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
  cut('const BLEND_SHRINK', 'function blendComponents') + '\n' +
  // The box-score stat line lives with the box scores, not with the DFS
  // block, because the recaps score the same afternoon through it.
  cut('function boxScoreStatLine', '\n// \u2500\u2500 what the week') + '\n' +
  // The "how long ago" phrasing is shared with the health board, so it is cut
  // in rather than restated here: the slate note and the board must not drift.
  cut('const PROPS_STALE_HOURS', 'async function propsHealth') + '\n' +
  // weeklyStats and the two environment sets are the board's own scaler, and
  // the projection ladder puts a supplemental row through the SAME one rather
  // than a second rule that could drift from it. Cut in for that reason: the
  // test must exercise the real scaler, not a stand-in that always agrees.
  cut('// A season line, made per game', 'const _addStats =') + '\n' +
  cut('const WEEK_ENV_CLAMP', '// The blend weight on the Vegas side') + '\n' +
  cut('// -- DFS ---', '// Memoized per isolate alongside _PROJ_ENC') + '\n' +
  // The contest scores, so the ladder's cash exclusion is tested against the
  // real dfsMetrics rather than asserted about it.
  cut('const DFS_CONTESTS = {', '// \u2500\u2500 analyst memory') + '\n' +
  'return { DFS_SITES, SCORING_SITE, parseDfsCsv, dfsSlateShape, dfsCollapseSingleGame, buildDfsSlate, buildDfsStacks, scoringRules, scoreStats, dfsWeekStatus, dfsAvailable, buildSleeperRoster, dfsRosterCheck, dfsMarketRead, dfsPropCoverage, dfsPropNote, dfsActualFor, scoreAny, SCORING_KDEF, BLEND_SHRINK, dfsMetrics, dfsSupplemental };'
)(teamKey, _oddsNorm, _oddsRound, _csvSplit, () => { throw new Error('no network'); });
const DFS = require(path.join(ROOT, 'dfs-optimizer.js'));
// The scheduled workflow's own CSV writer, so the false-positive gate below
// tests the file the import actually receives rather than a hand-rolled one.
const { draftablesToCsv } = await import('./import-draftkings-salaries.mjs');
const parseDfsCsv_forTest = csv => H.parseDfsCsv('dk', csv);

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

  // The shape test guards the ONE CSV path left in. The reader upload that
  // first used it went away with its panel on 2026-09-20, so if the desk's
  // import stops calling it, nothing does and a Showdown file priced against
  // the classic cap reaches every reader. Asserted against the route source
  // because the import needs a key and a D1 to run for real.
  const adminRoute = cut("if (url.pathname === '/api/admin/dfs')", 'return json(out, 200, c);');
  ok('the desk import still reads the shape of the file before storing it',
     /dfsSlateShape\(parsed\.rows\)/.test(adminRoute)
     && adminRoute.indexOf('dfsSlateShape') < adminRoute.indexOf('dfsStore'), 'the shape must be known before dfsStore');
  // THE GUARANTEE, which has not moved: a single-game file must never become
  // the board a reader asking for the main slate is served. What HAS moved is
  // how it is kept. It used to be an outright refusal, because
  // dfsSalariesRead() ignored the slate column and one stored anywhere was the
  // main board. The read now filters, so the file is accepted and filed under
  // the matchup it prices -- and the four assertions below are what keep the
  // old guarantee standing under the new mechanism.
  //
  // 1. The key is derived from the file's own clubs, never taken from the
  //    caller, so no post can file one game's salaries under another.
  ok('a single-game file is stored under the matchup it actually prices',
     /const key = dfsSingleGameSlateKey\(parsed\.rows\)/.test(adminRoute)
     && /under = key;/.test(adminRoute) && /slate: under/.test(adminRoute));
  // 2. A caller naming a different slate is refused rather than quietly
  //    overridden -- including one naming 'main' or 'weekly', which is the
  //    exact move the original refusal existed to stop.
  ok('...and a post naming a different slate is refused, not silently re-filed',
     /asked && asked !== key/.test(adminRoute) && /slate_mismatch/.test(adminRoute));
  // 3. The mirror image: a main-slate file must not land under a game key,
  //    or the page solves a six-seat roster out of nine-seat prices.
  ok('...and a main-slate file cannot be stored under a single-game key',
     /asked && dfsIsSingleSlate\(asked\)/.test(adminRoute));
  // 4. And the read that made the old refusal necessary now excludes the
  //    single-game slates by default, so a Showdown import cannot be handed to
  //    a caller who asked for the classic board. Both halves matter: the
  //    filter, and taking MAX(fetched_at) WITHIN the slate rather than across
  //    the week -- across it, a 9am Showdown import would blank an 8am Classic
  //    one by owning a timestamp the filtered read never returns.
  const salariesRead = cut('async function dfsSalariesRead', 'async function dfsSingleSlates');
  ok('the classic read excludes the single-game slates rather than trusting the refusal',
     /slate NOT LIKE 'sd:%'/.test(salariesRead));
  ok('...and takes its newest import within that slate, never across the week',
     (salariesRead.match(/MAX\(fetched_at\)/g) || []).length === 2
     && !/MAX\(fetched_at\) AS ts FROM dfs_salaries WHERE site = \? AND season IS \? AND week IS \?"/.test(salariesRead));
}

// The scheduled DraftKings workflow posts to that same import, and it merges
// every Classic pool for the week into one file. A weekly merge repeats no
// player, but this is the false positive that would take the Monday import
// down silently, so it is pinned with the importer's own CSV writer rather
// than reasoned about.
console.log('\nthe weekly import is not mistaken for a captain file');
{
  const TEAMS = 'BUF NYJ MIA NE KC LV LAC DEN BAL CIN CLE PIT HOU IND JAX TEN PHI DAL NYG WAS GB CHI DET MIN SF SEA LA ARI'.split(' ');
  const FIRST = 'James Michael Robert John David William Richard Joseph Thomas Charles Daniel Matthew Anthony Donald Mark Paul Steven Andrew Kenneth Joshua Kevin Brian George Edward Ronald Timothy Jason Jeffrey Ryan Jacob'.split(' ');
  const LAST = 'Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Hernandez Lopez Gonzalez Wilson Anderson Taylor Moore Jackson Martin Lee Perez Thompson White Harris Clark Lewis Robinson Walker Young King'.split(' ');
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'DST', 'WR', 'RB', 'TE'];
  const draftables = [];
  let n = 0;
  for (let g = 0; g < 14; g++) {
    const away = TEAMS[g * 2], home = TEAMS[g * 2 + 1];
    for (const team of [away, home]) {
      for (let k = 0; k < SLOTS.length; k++) {
        const position = SLOTS[k];
        // Distinct names the way a real lobby has them: dfsSlateShape compares
        // on letters only, so "Player 1" and "Player 2" would read as one man.
        const displayName = position === 'DST' ? team + ' Defense'
          : FIRST[n % FIRST.length] + ' ' + LAST[(n * 7 + k) % LAST.length] + (n % 29 === 0 ? ' Jr.' : '');
        n++;
        const row = { draftableId: 100000 + n * 7 + k, playerId: 200000 + n * 7 + k, playerDkId: 300000 + n * 7 + k,
          displayName, position, salary: 3000 + ((n * 137) % 60) * 100, teamAbbreviation: team,
          competition: { competitionId: g, name: away + ' @ ' + home, startTime: '2026-09-13T17:00:00Z' },
          draftStatAttributes: [{ id: 90, value: '10.5' }] };
        draftables.push(row);
        // The lobby lists a skill player twice, once per roster slot. The
        // importer collapses that; if it ever stops, this is where it shows.
        if (position !== 'DST') draftables.push({ ...row, draftableId: 900000 + n * 7 + k, rosterSlotId: 70 });
      }
    }
  }
  const weekly = parseDfsCsv_forTest(draftablesToCsv({ draftables }).csv);
  ok('the merged weekly file parses', !weekly.error && weekly.rows.length === 14 * 2 * SLOTS.length, weekly.error || String(weekly.rows.length));
  ok('and a full week of real games is classic, not a captain file', H.dfsSlateShape(weekly.rows) === 'classic');
  const names = new Set(weekly.rows.map(r => r.name.toLowerCase().replace(/[^a-z]/g, '') + '|' + r.position));
  ok('because a week repeats no player, which is what the quarter-file rule counts', names.size === weekly.rows.length,
     names.size + ' of ' + weekly.rows.length);
}

console.log('\nsite scoring');
{
  // The defense, on DraftKings' table rather than the site's season-long one.
  // Every K/DEF key an operator supplies used to be dropped by scoringRules,
  // which reads SCORING_BASE only, so a DST was scored on SCORING_KDEF: a
  // four-point defensive touchdown, a four-point safety, and a ladder that
  // pays 5 for ten points allowed where DraftKings pays 4.
  const dk = H.scoringRules('ppr', H.SCORING_SITE.dk);
  const D = (o, g) => H.scoreAny({ sacks: 0, ints: 0, fumRec: 0, defTD: 0, stTD: 0, safety: 0, ...o }, 'DST', dk, g || 1);
  ok('a site\'s defensive rules survive scoringRules at all', dk.defensiveTD === 6 && Array.isArray(dk.pointsAllowed) && dk.pointsAllowed.length === 7,
     JSON.stringify({ td: dk.defensiveTD, tiers: dk.pointsAllowed && dk.pointsAllowed.length }));
  ok('a defensive touchdown is six on DraftKings, not the site default of four', near(D({ defTD: 1, ptsAllowed: 24 }), 6, 0.001), String(D({ defTD: 1, ptsAllowed: 24 })));
  ok('a return touchdown is six', near(D({ stTD: 1, ptsAllowed: 24 }), 6, 0.001));
  ok('a safety is two, not four', near(D({ safety: 1, ptsAllowed: 24 }), 2, 0.001), String(D({ safety: 1, ptsAllowed: 24 })));
  ok('a sack is one and a takeaway is two', near(D({ sacks: 1, ptsAllowed: 24 }), 1, 0.001) && near(D({ ints: 1, ptsAllowed: 24 }), 2, 0.001) && near(D({ fumRec: 1, ptsAllowed: 24 }), 2, 0.001));
  ok('and five sacks earn no bonus, which the site default would pay', near(D({ sacks: 5, ptsAllowed: 24 }), 5, 0.001), String(D({ sacks: 5, ptsAllowed: 24 })));
  // The ladder, rung by rung. A shutout is ten and a blowout costs four.
  const ladder = [[0, 10], [3, 7], [6, 7], [7, 4], [13, 4], [14, 1], [20, 1], [21, 0], [27, 0], [28, -1], [34, -1], [35, -4], [52, -4]];
  const wrong = ladder.filter(([pa, want]) => !near(D({ ptsAllowed: pa }), want, 0.001));
  ok('the points-allowed ladder pays DraftKings\' figure at every rung', !wrong.length,
     wrong.map(([pa, want]) => pa + ' allowed wanted ' + want + ', got ' + D({ ptsAllowed: pa })).join('; '));
}
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
  const w0 = { env: {}, vegasProjection: { status: 'full', priced: ['rec', 'recYd', 'anytimeTD'], missing: [], books: 6, lastMoveHours: 0.4,
                                           td: { probability: 41.2, books: 6, devigged: true } } };
  const m = H.dfsMarketRead(priced, w0, 18.4, 14.0);
  ok('a quoted player is marked quoted', m.quoted === true && m.basis === 'props');
  ok('the markets the books actually posted come across, in words', m.priced.join(',') === 'anytimeTD,rec,recYd'.split(',').sort().join(',') || m.priced.length === 3);
  ok('...with a plain-language label for each', m.pricedLabels.includes('receiving yards') && m.pricedLabels.includes('receptions'));
  ok('the book count and the age of his last line move come across', m.books === 6 && m.lastMoveHours === 0.4);
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
    { onBoard: true, projected: true, market: { basis: 'props', quoted: true, priced: ['rec', 'recYd'], books: 6, lastMoveHours: 2 } },
    { onBoard: true, projected: true, market: { basis: 'props-partial', quoted: true, priced: ['anytimeTD'], books: 4, lastMoveHours: 0.5 } },
    { onBoard: true, projected: true, market: { basis: 'gamelines', quoted: false, priced: [], books: null, lastMoveHours: null } },
    { onBoard: true, projected: true, available: false, market: { basis: 'props', quoted: true, priced: ['rec'], books: 9, lastMoveHours: 1 } },
    { onBoard: false, projected: false }
  ];
  const cov = H.dfsPropCoverage(rows, Date.now() - 30 * 60000);
  ok('coverage counts the priced against the playable', cov.players === 3 && cov.priced === 2 && cov.coverage === 67);
  ok('a benched man is not counted as slate coverage', cov.avgBooks === 5);
  ok('the union of quoted markets is reported', cov.markets.join(',') === 'anytimeTD,rec,recYd');
  ok('and the most recently moved line behind them', cov.freshestMoveHours === 0.5);
  // The two clocks are different questions and the note used to answer only
  // the first while claiming it was the second. A feed read half an hour ago
  // is live however long the books have sat on their numbers.
  ok('...beside when the feed was actually read', cov.pullAgeHours === 0.5 && cov.pullAgeHours !== null);
  ok('the note quotes the real numbers', /2 of 3 players/.test(H.dfsPropNote(cov)) && /receiving yards/.test(H.dfsPropNote(cov)));
  ok('the note says read, not pulled, and keeps the move separate',
     /feed was read within the hour/.test(H.dfsPropNote(cov))
     && /most recent line move on the slate landed within the hour/.test(H.dfsPropNote(cov))
     && !/pulled/.test(H.dfsPropNote(cov)));
  ok('a slate with no pull clock yet simply does not claim one',
     !/feed was read/.test(H.dfsPropNote(H.dfsPropCoverage(rows))));
  // The whole slate priced on touchdowns and nothing else: the state that
  // reads as "props are working" on one page and "no props" on another.
  const tdOnlyCov = H.dfsPropCoverage([
    { onBoard: true, projected: true, market: { basis: 'gamelines', quoted: false, priced: [], shortOfProjection: true, shortPriced: ['anytimeTD'] } },
    { onBoard: true, projected: true, market: { basis: 'gamelines', quoted: false, priced: [], shortOfProjection: true, shortPriced: ['anytimeTD'] } },
    { onBoard: true, projected: true, market: { basis: 'gamelines', quoted: false, priced: [], shortOfProjection: false, shortPriced: [] } }
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

  const noneCov = H.dfsPropCoverage([{ onBoard: true, projected: true, market: { basis: 'gamelines', quoted: false, priced: [] } }]);
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
  // This used to assert the limitation -- Classic or nothing -- because that
  // was the only way to be sure a Showdown never got a nine-slot roster. The
  // guarantee is the same and the mechanism is not: every Game Style resolves
  // to its OWN roster, and the only thing that stops a solve is a slate that
  // cannot price the roster the format asks for.
  ok('every format is solved against its own roster, and never against another format\u2019s',
     page.includes('function solveFormat()') && page.includes('ITDfs.formatFor(site, style)')
     && page.includes('format: f.fmt, slots: f.fmt.slots, flex: f.fmt.flex')
     && page.includes("mult: f.fmt.mult || null, tierSlots: f.fmt.tierSlots || null, minTeams: f.fmt.minTeams || 0"));
  // The guarantee: a single-game roster is never priced off main-slate
  // salaries. What the reader is offered instead is the one thing that fixes
  // it -- the contest's own export -- and the control for that is rendered
  // into this notice rather than sitting over every board.
  ok('a single-game roster is never priced off the main slate, and asks for the file that would fix it',
     page.includes("fmt.kind === 'salary' && fmt.single && priced !== 'single-game'")
     && page.includes('a roster you could not enter')
     && page.includes('so the board declines rather than printing one')
     && page.includes('out.needsFile = true;')
     && page.includes("f.needsFile ? uploadControl(fmt) : ''"));
  // AN UNPRICED WEEK IS NOT A DEAD END. The desk imports one main slate a week;
  // before it lands, /dfs answered every format and every setup with the same
  // sentence -- "There is no lineup to solve until the salaries are posted" --
  // written straight into the lineup box by slateNone(). A reader who had
  // answered all three steps for a Showdown Captain got that and nothing else,
  // and the file route that would have priced their contest is rendered INTO
  // that box, so it could never be reached. The contest is already priced in
  // the reader's own lobby and /api/dfs/slate prices that file without the
  // desk, so the board asks for it instead of sending them away.
  ok('an unpriced week names what is missing and offers the file, rather than one flat sentence',
     // The markup assignment, not the prose: the sentence itself survives in
     // the comment that records why it went, and a gate that could not tell
     // the two apart would fail the next time that comment is reflowed.
     !page.includes('<p class="is-empty">There is no lineup to solve')
     && page.includes('if (!slate) {\n      out.ready = false;')
     && page.includes('No \' + siteLabel() + \' salaries are posted for this week yet')
     && page.includes('the contest you are entering is already priced on its own page in the lobby'));
  ok('...and the board is actually re-solved for it, at load and on every answer the reader gives',
     page.includes('if (!window.ITDfs) { coachSync(); return; }')
     && !page.includes('if (!slate || !window.ITDfs) { coachSync(); return; }')
     && page.includes("if (f0.kind === 'season') sec = 'lineup';")
     && page.includes("$('dfNav').hidden = !setupReady() || f0.kind === 'season';"));
  // A pick contest has no roster and no lobby export, so it is never asked for
  // a file it cannot produce.
  ok('...but a pick contest is told what it is waiting for rather than asked for an export',
     page.includes("if (fmt.kind === 'picks') {")
     && page.includes('The board fills in as soon as the salaries post.'));
  // THE DESK'S OWN SINGLE-GAME SLATES. A Showdown used to have exactly one
  // route to real prices: a CSV the reader downloaded. The desk imports them
  // now, so the page asks for the matchup it needs and only falls back to the
  // file where the desk has not priced that game.
  ok('a single-game format asks the desk for its own matchup rather than the main board',
     page.includes('function deskSlateFor()')
     && page.includes("return availableSingles.indexOf(keys[0]) >= 0 ? 'sd:' + keys[0] : null;")
     && page.includes("'&slate=' + encodeURIComponent(want)"));
  // ...and only for a game the desk actually holds: an unimported matchup
  // returns null so the board reaches the file notice instead of fetching a
  // slate nobody stored.
  ok('...only for a game the desk has actually priced', page.includes('availableSingles.indexOf(keys[0]) >= 0'));
  // Re-solving on every keystroke would throw away the reader's locks and
  // excludes for a slate that did not change.
  ok('...and re-fetches only when the answer changed', page.includes('if (want === loadedSlate) return false;'));
  // A reader who handed over their own file keeps it; the desk does not
  // silently replace what they chose.
  ok('...and never over a file the reader handed over themselves', page.includes('if (upGet(site)) return false;'));
  // Switching back to a multi-game format has to come back to the main board,
  // or the page solves a nine-seat roster against six-seat prices.
  ok('...and every setup change routes through it, falling back to a plain render',
     (page.match(/if \(!syncSlate\(\)\) render\(\);/g) || []).length === 3);
  ok('a Tiers roster is never invented out of salary bands',
     page.includes("ITDfs.tierFormat(") && page.includes('inventing them out of salary would build a roster nobody can enter'));
  // The always-on panel that #293 removed does not come back. The route does,
  // because five formats are priced on a file the desk import never stores,
  // and the control for it is scoped to the notice that needs it.
  ok('the file control is scoped to the format that needs one, not a panel over every board',
     page.includes('function uploadControl(fmt)') && !page.includes('id="dfUp"')
     && page.includes("fetch('/api/dfs/slate'"));
  ok('and a reader\u2019s own file is kept rather than purged on every load',
     !page.includes("localStorage.removeItem('it.dfs.csv.'")
     && page.includes('var mine = upGet(site);') && page.includes('if (mine) loadUpload(mine); else loadSite();'));
  // Handing over a single-game export changes the pool under the reader, and
  // the universe-change reset used to clear every game they had picked -- so
  // the upload landed on "Next select the Games" with one matchup in the list
  // and no roster on the board.
  ok('a pool change keeps the games that survive it rather than clearing the lot',
     page.includes('var live = {}; games.forEach(function (g) { live[g.key] = 1; });')
     && page.includes('if (lost || !Object.keys(kept).length)'));
  ok('...and one game on the slate is chosen rather than asked about',
     page.includes('if (games.length === 1 && !selectedGameKeys().length)')
     && page.includes("gameChoice = 'game:' + games[0].key;"));
  // The payout advice is "what should I enter with this roster", so it has to
  // be about the contest the READER picked, not the one the slate was priced
  // for. And it has to say something on the two shapes that have no payout
  // curve at all, because a box that goes blank reads like a failure.
  ok('the payout advice is solved for the format the reader chose',
     page.includes('var pf = solveFormat();')
     && page.includes('var fmt = pf.ready && pf.fmt && pf.fmt.slots ? pf.fmt : null;')
     && page.includes('var base={cap:(fmt?fmt.cap:s.cap),slots:(fmt?fmt.slots:s.slots)'));
  ok('...and says so plainly on a contest with no cap to trade against',
     page.includes('no cap to trade against') && page.includes('With nothing to spend there is no trade to weigh'));
  ok('...and on a pick contest, which has no roster to compare shapes across',
     page.includes('not a payout question') && page.includes('no payout curve to move along'));
  ok('...and names the format it advised on, once the reader has chosen one',
     page.includes("var named = fmt && fmt.label && setupReady();"));
  ok('a slate priced from a reader\u2019s file says so, and offers the way back',
     page.includes("slate.source === 'upload'") && page.includes('Priced from your own file, kept in this browser')
     && page.includes("id=\"dfUpClear\""));
  ok('a contest with no roster gets the board it actually asks for, not a lineup card',
     page.includes('function renderPicks(f, players)') && page.includes('ITDfs.pickBoard(players,')
     && page.includes('Model leans') && page.includes('posts its own line on a player'));
  // The pick contests are the one format with no seats to count, and the line
  // above the board counted them unguarded: `fmt.slots.length` on a format
  // that has no slots threw inside build(), which left the page showing the
  // "complete the setup" placeholder for a setup that was complete.
  ok('and the line above the board counts no seats where a format has none',
     page.includes("if (fmt.slots && fmt.slots.length) bits.push(fmt.slots.length + ' seat'"));
  ok('an uncapped roster draws no cap meter and prints no spend',
     page.includes('var capped = l.remaining != null;') && page.includes("'No salary cap'")
     && page.includes("var meter = !capped ? '' :"));
  ok('a multiplier seat is chipped on the roster row and keeps its base price behind it',
     page.includes('df-mult') && page.includes('This seat scores ') && page.includes('in a FLEX seat'));
  // A Showdown roster has no QB SLOT -- the seats are a Captain and five FLEX
  // -- so every sentence that looked for the quarterback by slot ("there is no
  // same-team QB/pass-catcher stack in this build") was written about a
  // quarterback the page had failed to find, with one sitting in the Captain
  // seat. He is found by position now, everywhere it matters.
  ok('the quarterback is found wherever he is sitting, not only in a QB slot',
     page.includes('function lineupQb(l)')
     && page.includes("for (var j = 0; j < ps.length; j++) if (ps[j].position === 'QB') return ps[j];")
     && !/for \(var k = 0; k < l\.players\.length; k\+\+\) if \(l\.players\[k\]\.slot === 'QB'\)/.test(page)
     && (page.match(/lineupQb\(/g) || []).length >= 4);
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
  ok('and Require is the one way in, from the pill above the roster or from any name on the board',
     page.includes("function isRequired(key) { return marks[key] === 'lock'; }")
     && page.includes('id="dfReqOpen"') && page.includes('Require in every lineup'));
  // Requiring and excluding used to be reachable only from the pool table
  // inside the closed fine-tune panel. The roster is where the reader argues
  // with the solve, so the two controls sit on the roster row.
  // Dropping a man is a cross at the LEFT of his row, ahead of his face,
  // which is where a list of removable things puts it. It is the only control
  // on the roster: requiring starts above it, because the man a reader wants
  // to require is usually not one of the nine already on screen.
  // Two glyphs at the LEFT of the row, ahead of the face: pin him in, cross
  // him out. Worded buttons on the name line put the same two words on
  // eighteen rows.
  ok('every roster row carries a cross and a pin, ahead of his face',
     page.includes('function rosterMarks(p)') && page.includes('class="df-x"') && page.includes('class="df-pin"')
     && page.includes("data-mark=\"excl\"") && page.includes("data-mark=\"lock\"")
     && page.includes("rosterMarks(p) + faceHtml(p)"));
  ok('and the pin shows whether that player is being held',
     /df-pin[\s\S]{0,200}aria-pressed="' \+ \(req \? 'true' : 'false'\)/.test(page)
     && page.includes(".df-pin[aria-pressed=\"true\"]"));
  ok('the roster carries no worded Require or Exclude button any more',
     !page.includes('function rosterActions(p)') && !/df-pname-line[\s\S]{0,400}data-mark="lock"/.test(page));
  // The control that showed a man was required is gone from the row, so the
  // row says it another way.
  ok('a required player is still marked as such on his row',
     page.includes('function requiredTag(p)') && page.includes('df-tag req')
     && page.includes('playerTag(p, qb) + requiredTag(p)'));
  // The controls were on the lead board only at first, which left a reader
  // looking at Alternate 2 with no way to drop the man in front of him. The
  // row markup is shared, so the alternates carry the same pair and write the
  // same one list of constraints.
  ok('the alternates carry both marks too, off the same shared row markup and the same constraint list',
     !page.includes('lead ? rosterMarks')
     && /var rows = l\.players\.map\([\s\S]{0,1400}rosterMarks\(p\)/.test(page));
  // The pin and the search reach different men on purpose: the search is for
  // somebody not in the roster, the pin holds one the builder already found.
  ok('the pin and the name search are both kept, because they reach different players',
     page.includes('id="dfReqOpen"') && page.includes('class="df-pin"')
     && page.includes('puts him in the <b>Must include</b> box above'));
  // The search is behind a pill now, so it is a thing the reader asks for
  // rather than a field sitting open above every roster.
  ok('the require search opens from a pill and stays open for the next name',
     page.includes('function openRequire(on)') && page.includes('id="dfReqSearch" hidden')
     && page.includes("pill.setAttribute('aria-expanded', on ? 'true' : 'false')")
     && page.includes("input.value = ''; input.focus();"));
  // A pick empties the list it was clicked in, and a detached node reports no
  // ancestors -- so without this the click read as "outside the search" and
  // closed it after every name.
  ok('and a pick does not read as a click outside the search',
     /data-require-key[\s\S]{0,600}ev\.stopPropagation\(\);[\s\S]{0,80}requireByKey/.test(page));
  ok('the player drawer can require or exclude anyone on the board, not only the nine on the roster',
     page.includes('Require in every lineup') && page.includes('Exclude from every lineup'));
  ok('every require/exclude control writes the same marks store and re-solves',
     page.includes('function applyMark(act, key)') && page.includes("marks[key] = 'lock'") && page.includes("marks[key] = 'excl'")
     && page.includes("['dfLineups', 'dfPlayerBody', 'dfConstraints'].forEach"));
  // A lock is a decision and the builder does not overrule a decision, but the
  // page says what the decision was: this warning used to live in the What If
  // box, and it belongs to the constraint, not to the control that set it.
  ok('a man in the box who is not playing still says so, on the box itself',
     page.includes('must.filter(function (r) { return r.p.available === false; })')
     && page.includes('He is not playing this week')
     && page.includes('only because you put him there'));
  // The box is the point: a container at the top of the roster that the reader
  // fills with the men already committed, so it reads as "these are in" rather
  // than as a row of settings.
  ok('the players who must be included sit in a box of their own at the top of the roster',
     page.includes('function renderConstraints(l)') && page.includes('>Must include<')
     && page.includes('id="dfMustBox"') && page.includes("$('dfMustChips').innerHTML")
     && page.includes("data-mark=\"clear\"") && page.includes("data-mark=\"clearall\"")
     && page.includes('renderConstraints(lead);'));
  ok('the box keeps its shape when it is empty, and says so',
     page.includes('id="dfMustEmpty"') && page.includes('min-height:48px')
     && page.includes('Nobody yet'));
  ok('an exclusion is filed under the box, not mixed in with the men who are in',
     page.includes('Also excluded') && page.includes("host.classList.toggle('has', must.length > 0)"));
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
  // It takes the resolved FORMAT now, not a bare slot list: on a multiplier
  // roster the Captain seat costs half again as much, and arithmetic that
  // priced the man rather than the seat would tell a reader his required pair
  // fits under the cap when it does not.
  ok('and a roster that cannot fit the required players says why, in money',
     page.includes('function shortfallNote(players, lockKeys, f, cap)')
     && page.includes('The cheapest legal fill for the other ')
     && page.includes('cannot all be seated: this roster has no free slot')
     && page.includes('var seatCost = function (q, slot)'));
  ok('a required player the solve could not seat is said out loud rather than quietly dropped',
     page.includes('could not be seated under the current cap and rules'));
  ok('a man who is not playing is marked in the player pool, not quietly dropped', page.includes('function weekTag(p)') && page.includes('df-week-out') && page.includes('df-row-out'));
  ok('the page says who it took off the board and how to put him back', page.includes('function benchedNote(r)') && page.includes('off the board:') && page.includes('Lock one in the player pool below to build around him anyway.'));
  ok('forcing an unavailable player in says so rather than pretending he is a normal pick', page.includes('He is not playing this week'));
  ok('a player who changed clubs is flagged beside his stale projection', page.includes('p.teamChanged && p.rosterTeam'));
  ok('the objective row offers a prop-first market build', page.includes('data-mode="market"') && page.includes('Market read'));
  ok('the player pool says whether a man was quoted or inferred', page.includes('function marketTag(p)') && page.includes('df-mkt-quoted') && page.includes('df-mkt-inferred') && page.includes('MARKET_CHIP'));
  ok('every recommended player carries what the books actually posted on him', page.includes('function marketPhrase(p)') && page.includes('The books posted ') && page.includes('df-mktline'));
  // The store writes a row only when a price changes, so the per-player age is
  // the last MOVE, never the last pull. Calling it a pull told a reader the
  // feed was two days dead when it had been read minutes earlier.
  ok('a player\u2019s market age is called a line move, not a pull',
     page.includes('His line last moved ') && page.includes('m.lastMoveHours')
     && !/pulled '/.test(page) && !page.includes('pulledHoursAgo'));
  ok('the lead card shows how much of the roster the market priced, and says so when none of it was',
     page.includes('function propsNote(l)') && page.includes(' priced by the books.</b>')
     && page.includes('No player prop is behind ') && page.includes('the rest of this lineup') && page.includes('this lineup'));
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

console.log('\nthe projection ladder');
{
  // The bug this section exists for: DraftKings prices roughly twice as many
  // bodies as the curated PROJECTIONS pool carries, and the surplus is almost
  // exactly the $3,000 minimum-salary tier. Every one of them used to arrive
  // as a stub with onBoard:false and be filtered out of the metrics, the
  // value boards, the stacks and the optimizer -- so a punt play the operator
  // had priced was invisible on the slate that priced it.
  const punt = { name: 'Elic Ayomanor', position: 'WR', team: 'DET', opponent: 'GB', salary: 3000, operatorFppg: null };
  const debut = { name: 'Nobody Atall', position: 'RB', team: 'BUF', opponent: 'NYJ', salary: 3000, operatorFppg: null };
  const vet = { name: 'Priced Veteran', position: 'TE', team: 'NYJ', opponent: 'BUF', salary: 3000, operatorFppg: 6.4 };
  // Four games: 20 catches, 240 receiving yards, 2 TDs. At DK PPR that is
  // (20 + 24 + 12) / 4 = 14 a game, and no 100-yard bonus, because a season
  // total cannot say which game earned one.
  const puntUsage = { players: { [_oddsNorm('Elic Ayomanor') + '|WR']: { season: { games: 4, stats: { rec: 20, recYd: 240, recTD: 2 } } } } };
  const s = H.buildDfsSlate('dk', [...SAL, punt, debut, vet], WEEK, { usage: puntUsage });
  const row = s.players.find(p => p.name === 'Elic Ayomanor');
  const none = s.players.find(p => p.name === 'Nobody Atall');
  const oper = s.players.find(p => p.name === 'Priced Veteran');

  ok('a priced man the board has never heard of still reaches the slate', !!row && row.onBoard === false);
  ok('...and carries a projection off his own season line', near(row.ironTunaPoints, 14, 0.11), String(row.ironTunaPoints));
  ok('...which says out loud that it is a season line, not a board projection', row.projectionBasis === 'usage' && row.supplemental === true && row.supplementalGames === 4);
  ok('...and is graded low, because it is what he has done and not a forecast of Sunday', row.vegasConfidence === 'LOW');
  ok('...and gets a key, without which the optimizer cannot hold him', row.key === _oddsNorm('Elic Ayomanor') + '|WR');
  ok('...and his three numbers agree, because one line produced all three', row.vegasPoints === row.ironTunaPoints && row.consensusPoints === row.ironTunaPoints);
  ok('...and claims no market, rather than a fit nobody fitted', row.market.basis === 'none' && row.marketQuoted === false && row.market.points === row.ironTunaPoints);
  ok('...and no touchdown price, rather than a zero that reads like a forecast', row.tdProbability === null && row.tdBasis === null);
  ok('...and takes the club’s fixture off the board rather than leaving it blank', row.opponent === 'GB' && row.teamTotal === 24);

  // Found by rendering the page: the edge column printed 0.0 for every
  // supplemental row, which reads as "the model agrees with DraftKings to the
  // tenth" when it actually means both figures are the same number.
  ok('...and claims no edge over an average derived from the same line it was built from', row.projectionVsFppg === null);
  // The page has a client-side fallback that recomputes the edge when the
  // server sends none, for slates served before projectionVsFppg existed. On
  // a supplemental row the null is a decision, not a gap, and letting that
  // fallback fire put the flat 0.0 straight back on screen.
  ok('...and the page does not quietly recompute the edge it was deliberately not sent',
     /if \(p\.supplemental\) return null;/.test(fs.readFileSync(path.join(ROOT, 'dfs.html'), 'utf8')));
  const twoSource = { name: 'Two Source', position: 'WR', team: 'DET', opponent: 'GB', salary: 3000, operatorFppg: 9.5 };
  const ts = H.buildDfsSlate('dk', [...SAL, twoSource], WEEK, { usage: { players: { [_oddsNorm('Two Source') + '|WR']: { season: { games: 2, stats: { rec: 10, recYd: 120, recTD: 1 } } } } } })
    .players.find(p => p.name === 'Two Source');
  ok('...but keeps the edge where his own line really is a second source against the operator’s',
     ts.projectionBasis === 'usage' && ts.operatorFppgBasis === 'operator' && near(ts.projectionVsFppg, _oddsRound(ts.ironTunaPoints - 9.5), 0.11));

  ok('a man with no football behind him falls to the operator’s own average', oper.projectionBasis === 'operator' && near(oper.ironTunaPoints, 6.4, 0.01) && oper.supplemental === true);
  ok('and a true debut stays off the board rather than being given an invented number', none.projected === false && none.projectionBasis === 'none' && none.ironTunaPoints === undefined);

  ok('a board row says which rung it came off too', s.players.find(p => p.name === 'Josh Allen').projectionBasis === 'board' && s.players.find(p => p.name === 'Josh Allen').supplemental === false);
  // Three rescued, not two: the fixture's own $3,000 'Nobody Famous' is a man
  // the board has never carried and the operator has priced, which is the
  // case this whole section is about, and he is now picked up by the same
  // ladder rather than staying a stub.
  ok('the slate counts the rescued and the genuinely missing apart',
     s.supplemented === 3 && s.unprojected === 1 && s.unmatched === 4,
     s.supplemented + '/' + s.unprojected + '/' + s.unmatched);
  ok('...and the fixture\u2019s own unmatched $3,000 body is one of the rescued',
     s.players.find(p => p.name === 'Nobody Famous').projectionBasis === 'operator');

  // The number moves with the game, exactly as a board projection does: this
  // is weeklyStats' own rule (touchdowns follow the environment, yards at the
  // square root) rather than a second scaler that could drift from it.
  const hot = { ...WEEK, players: WEEK.players.map(p => p.team === 'DET'
    ? { ...p, weeks: [{ ...p.weeks[0], env: { ...p.weeks[0].env, factor: 1.2 } }] } : p) };
  const scaled = H.buildDfsSlate('dk', [...SAL, punt], hot, { usage: puntUsage }).players.find(p => p.name === 'Elic Ayomanor');
  ok('a supplemental number is scaled by his club’s week, like every other row', scaled.ironTunaPoints > row.ironTunaPoints, scaled.ironTunaPoints + ' vs ' + row.ironTunaPoints);

  // A defense matches by club, so an unmatched one means the board itself is
  // missing -- and there is no per-player usage line behind a defense to fall
  // back on. Supplementing one would be inventing the number outright.
  const ghostD = { name: 'Ghost Defense', position: 'DST', team: 'MIN', opponent: 'CHI', salary: 3000, operatorFppg: 8 };
  ok('a defense is never supplemented, because there is no line behind it to use',
     H.buildDfsSlate('dk', [...SAL, ghostD], WEEK, { usage: puntUsage }).players.find(p => p.name === 'Ghost Defense').projected === false);

  // The measured board, which is what every DFS surface actually reads.
  const gpp = H.dfsMetrics(s.players, 'gpp');
  ok('a supplemental row is measured with everyone else in a tournament', gpp.rows.some(r => r.name === 'Elic Ayomanor') && gpp.supplemental === 3, String(gpp.supplemental));
  ok('...and is scored on the same value scale rather than a private one', typeof gpp.rows.find(r => r.name === 'Elic Ayomanor').value === 'number');
  // Cash is won on a floor, and a season average is the one number that
  // cannot tell you whether a man has one this week.
  const cash = H.dfsMetrics(s.players, 'cash');
  ok('...and is kept out of a cash build, where certainty is the whole game', !cash.rows.some(r => r.supplemental) && cash.supplemental === 0);
  ok('...while the board rows are all still there', cash.rows.length === gpp.rows.length - 3, cash.rows.length + ' vs ' + gpp.rows.length);

  // An unavailable supplemental man is benched like anyone else: a $3,000
  // certain zero is still a certain zero.
  const outSlate = H.buildDfsSlate('dk', [...SAL, punt], WEEK, { usage: puntUsage, week: 1,
    availability: { weekly: { [_oddsNorm('Elic Ayomanor') + '|WR']: { status: 'Out', note: 'hamstring' } } } });
  const benched = outSlate.players.find(p => p.name === 'Elic Ayomanor');
  ok('a supplemental man the report ruled out is benched like anyone else', benched.available === false && benched.weekStatus === 'Out');
  ok('...and is named in the slate’s unavailable list rather than dropped in silence', outSlate.unavailableNames.some(u => u.name === 'Elic Ayomanor'));

  // The optimizer is the surface the tier exists for.
  const pool = s.players.filter(p => p.projected).map(p => ({ ...p, id: p.key }));
  const gppBuild = DFS.build(pool, { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, mode: 'ceiling', lineups: 1 });
  ok('the optimizer can now reach a minimum-salary body at all', gppBuild.ok && gppBuild.poolSize > slate.players.filter(p => p.onBoard).length);
  const floorBuild = DFS.build(pool, { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, mode: 'floor', lineups: 1 });
  ok('...but the safest-floor build declines to spend the cap on one', floorBuild.ok && floorBuild.lineups[0].players.every(p => !p.supplemental) && floorBuild.thinCount === 3, String(floorBuild.thinCount));
  ok('...and says which ones it declined, rather than dropping them in silence', floorBuild.thin.some(t => t.name === 'Elic Ayomanor' && t.basis === 'usage'));
  const doc = fs.readFileSync(path.join(ROOT, 'docs/dfs-metrics.md'), 'utf8');
  ok('the ladder is written down, every rung of it',
     /Where a player\u2019s projection comes from|Where a player's projection comes from/.test(doc)
     && ['`board`', '`usage`', '`operator`', '`none`'].every(r => doc.includes(r))
     && /backward-looking/.test(doc) && /does not claim to have found the leverage/.test(doc));
  const locked = DFS.build(pool, { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, mode: 'floor', lock: [_oddsNorm('Elic Ayomanor') + '|WR'], lineups: 1 });
  ok('...unless the reader locks him, because a lock is a decision', locked.ok && locked.lineups[0].players.some(p => p.id === _oddsNorm('Elic Ayomanor') + '|WR'));
  ok('a lineup seat says which rung its number came off', gppBuild.lineups[0].players.every(p => typeof p.projectionBasis === 'string'));

  // A board outage is a different failure from one man missing from the pool:
  // every row falls to a season average, and a page that says "4 of them"
  // when it means "all of them" reads like a working board built the usual
  // way. The card changes its sentence rather than understating it.
  const noBoard = H.buildDfsSlate('dk', [...SAL, punt], null, { usage: puntUsage });
  ok('with no board at all every skill row falls to a season line rather than the page emptying',
     noBoard.supplemented > 0 && noBoard.players.filter(p => p.projected).every(p => p.supplemental));
  ok('...and the page says so in place of the count, rather than understating it',
     /None of this slate is on Iron Tuna\u2019s board|None of this slate is on Iron Tuna’s board/.test(fs.readFileSync(path.join(ROOT, 'dfs.html'), 'utf8')));

  // The ladder and the played-game work have to compose, and they meet on
  // exactly the row most likely to be misread: a backward-looking number and
  // a finished game look identical until one of them says which it is. A
  // supplemental row banks its box score like every other visible row, so it
  // is never the one man on the slate still quoting a season average at a
  // game that has been played.
  {
    const bl = (name, team, o) => ({ name, key: _oddsNorm(name), team,
      pass: { att: 0, cmp: 0, yd: 0, td: 0, int: 0 }, rush: { att: 0, yd: 0, td: 0, ...((o || {}).rush || {}) },
      rec: { tgt: 0, rec: 0, yd: 0, td: 0, ...((o || {}).rec || {}) }, fumLost: 0 });
    const ayo = bl('Elic Ayomanor', 'DET', { rec: { tgt: 9, rec: 7, yd: 88, td: 1 } });
    const acts = { games: 13, final: 2, teams: new Set(['DET', 'GB']),
      lines: new Map([[ayo.key, [ayo]]]) };
    const done = H.buildDfsSlate('dk', [...SAL, punt], WEEK, { usage: puntUsage, actuals: acts })
      .players.find(p => p.name === 'Elic Ayomanor');
    // 7 receptions, 88 yards, a touchdown at DraftKings PPR: 7 + 8.8 + 6.
    ok('a supplemental man whose game is over banks his box score like anyone else',
       done.gamePlayed === true && done.actualBasis === 'box-score' && near(done.actualPoints, 21.8, 0.11), JSON.stringify({ g: done.gamePlayed, a: done.actualPoints }));
    ok('...and still says his projection was a season line, because that is what it was',
       done.projectionBasis === 'usage' && done.supplemental === true);
    ok('...and the optimizer will not spend a seat on a finished afternoon',
       DFS.build([done].concat(s.players.filter(p => p.projected && p.name !== 'Elic Ayomanor')).map(p => ({ ...p, id: p.key })),
         { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, mode: 'ceiling', lineups: 1 })
         .played.some(x => x.name === 'Elic Ayomanor'));
  }

  // A slate served before the ladder shipped has no `projected` field at all,
  // and a reader with a cached page must not lose his board to a missing key.
  const legacy = s.players.filter(p => p.onBoard).map(p => { const q = { ...p, id: p.key }; delete q.projected; delete q.supplemental; return q; });
  ok('a pre-ladder slate still builds, because onBoard answers when projected is absent',
     DFS.build(legacy, { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, mode: 'ironTuna', lineups: 1 }).ok);
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

// ── the contests that are not Classic ──────────────────────────────────────
// A lobby sells a dozen shapes of contest out of files with the same columns
// and completely different rosters behind them. For a year this page could
// only answer one of them. These are the rest: the roster each one builds,
// where that roster comes from, and the two things that must never happen --
// a Captain priced at his FLEX salary, and a roster invented for a contest
// whose rules this slate does not carry.
console.log('\nthe single-game file');
{
  // DraftKings exports the Captain as his own row at 1.5x the FLEX price.
  const dkShowCsv = 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n'
    + 'QB,"Josh Allen (1)",Josh Allen,1,CPT,17100,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\n'
    + 'QB,"Josh Allen (2)",Josh Allen,2,FLEX,11400,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\n'
    + 'RB,"Breece Hall (3)",Breece Hall,3,CPT,15300,BUF@NYJ 09/14/2026 01:00PM ET,NYJ,17.5\n'
    + 'RB,"Breece Hall (4)",Breece Hall,4,FLEX,10200,BUF@NYJ 09/14/2026 01:00PM ET,NYJ,17.5\n';
  const parsed = H.parseDfsCsv('dk', dkShowCsv);
  ok('a Showdown export is named a single-game file', H.dfsSlateShape(parsed.rows) === 'single-game');
  const folded = H.dfsCollapseSingleGame(parsed.rows, 'dk');
  ok('and the two rows for one man fold into one', folded.length === 2);
  ok('the row keeps the FLEX price, which is the number every board compares against',
     folded.every(r => r.salary === 11400 || r.salary === 10200));
  // The seat price comes off the FILE, not from 1.5x arrived at here: it is
  // the operator's own number and the only one a reader can check in the lobby.
  ok('and carries the operator’s own price for the Captain seat',
     folded.find(r => r.name === 'Josh Allen').salaryBySlot.CPT === 17100
     && folded.find(r => r.name === 'Breece Hall').salaryBySlot.CPT === 15300);
  // FanDuel writes one row per player with the seat in its roster-position
  // list, the way DraftKings writes "RB/FLEX" on a main slate. One row is one
  // price, and it is the base price.
  const fdShow = H.parseDfsCsv('fd', 'Id,Position,First Name,Nickname,Last Name,FPPG,Played,Salary,Game,Team,Opponent,Injury Indicator,Injury Details,Tier,Roster Position\n'
    + '1,QB,Josh,Josh Allen,Allen,24.1,1,15000,BUF@NYJ,BUF,NYJ,,,,MVP/FLEX\n'
    + '2,RB,Breece,Breece Hall,Hall,17.5,1,13000,BUF@NYJ,NYJ,BUF,,,,MVP/FLEX\n');
  const fdFold = H.dfsCollapseSingleGame(fdShow.rows, 'fd');
  ok('a FanDuel single-game row is left at the price the file gave it, not divided by 1.5',
     fdFold.length === 2 && fdFold[0].salary === 15000 && !fdFold[0].salaryBySlot);

  // End to end: the roster comes off the shape of the file.
  const one = SAL.filter(s => s.team === 'BUF' || s.team === 'NYJ');
  const show = H.buildDfsSlate('dk', one, WEEK, { shape: 'single-game' });
  ok('a single-game slate is built for the single-game roster',
     show.format === 'single-game' && show.slots.length === 6 && show.slots[0] === 'CPT'
     && show.cap === 50000 && show.minTeams === 2 && show.multiplierSeat === 'CPT',
     JSON.stringify({ slots: show.slots, cap: show.cap }));
  ok('...where any position may sit in any seat, which is the whole difference from a FLEX',
     ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].every(p => show.flex.includes(p)));
  ok('a main slate is untouched by any of it',
     slate.format === 'classic' && slate.slots.length === 9 && slate.multiplier === null && slate.minTeams === 0);
  ok('the two roster tables agree, because a reader compares the page to the lobby and not to us',
     (() => {
       const w = H.DFS_SITES.dk.single, o = DFS.FORMATS['dk-showdown'];
       const wf = H.DFS_SITES.fd.single, of = DFS.FORMATS['fd-single'];
       return w.cap === o.cap && w.slots.join() === o.slots.join() && w.flex.join() === o.flex.join()
         && w.mult.CPT === o.mult.CPT && w.minTeams === o.minTeams
         && wf.cap === of.cap && wf.slots.join() === of.slots.join() && wf.mult.MVP === of.mult.MVP;
     })());
}

console.log('\nthe tiers a Tiers contest posts');
{
  const fd = H.parseDfsCsv('fd', 'Id,Position,First Name,Nickname,Last Name,FPPG,Played,Salary,Game,Team,Opponent,Injury Indicator,Injury Details,Tier,Roster Position\n'
    + '1,QB,Josh,Josh Allen,Allen,24.1,1,9200,BUF@NYJ,BUF,NYJ,,,1,QB\n'
    + '2,RB,Breece,Breece Hall,Hall,17.5,1,8000,BUF@NYJ,NYJ,BUF,,,2,RB\n');
  ok('FanDuel’s Tier column comes across', fd.rows[0].tier === '1' && fd.rows[1].tier === '2');
  const dkTier = H.parseDfsCsv('dk', 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n'
    + 'QB,"Josh Allen (1)",Josh Allen,1,TIER 1,8200,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\n'
    + 'RB,"Jahmyr Gibbs (2)",Jahmyr Gibbs,2,RB/FLEX,8900,DET@GB 09/14/2026 04:25PM ET,DET,21.3\n');
  ok('DraftKings names its tier in the roster-position cell, and a main slate’s does not',
     dkTier.rows[0].tier === '1' && dkTier.rows[1].tier === null);
  // The buckets are the contest's, never ours. A slate with none cannot be
  // solved as a Tiers contest, and says so rather than banding by salary.
  ok('a slate with no tiers builds no Tiers roster at all',
     DFS.tierFormat(slate.players.filter(p => p.onBoard)) === null);
  const tiered = slate.players.filter(p => p.onBoard).map((p, i) => ({ ...p, id: p.key, tier: String((i % 4) + 1) }));
  const tf = DFS.tierFormat(tiered);
  ok('and a slate that carries them gets one seat per tier, in the contest’s own order',
     tf.slots.length === 4 && tf.tiers.join() === '1,2,3,4' && tf.cap === 0);
  const tr = DFS.build(tiered, { format: tf, mode: 'ironTuna' });
  ok('the roster takes exactly one player out of each tier',
     tr.ok && tr.lineups[0].players.length === 4
     && tr.lineups[0].players.map(p => String(p.tier)).sort().join() === '1,2,3,4',
     JSON.stringify((tr.lineups[0] || { players: [] }).players.map(p => p.slot + '=' + p.tier)));
  ok('...and no cap is reported, because the contest charges none',
     tr.lineups[0].remaining === null && tr.capped === false);
}

console.log('\nthe Showdown roster');
{
  const one = H.buildDfsSlate('dk', SAL.filter(s => s.team === 'BUF' || s.team === 'NYJ'), WEEK, { shape: 'single-game' });
  const players = one.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const fmt = DFS.formatFor('dk', 'showdown-captain');
  const r = DFS.build(players, { format: fmt, mode: 'ironTuna', lineups: 3, seed: 7 });
  ok('a Showdown lineup is built', r.ok && r.lineups[0].players.length === 6 && r.kind === 'salary');
  const L = r.lineups[0];
  const cpt = L.players.find(p => p.slot === 'CPT');
  ok('one seat is the Captain and the rest are FLEX',
     !!cpt && L.players.filter(p => p.slot === 'FLEX').length === 5);
  // BOTH numbers, or the roster is a fiction: a Captain carried at his FLEX
  // price is several thousand dollars of cap nobody gave you.
  ok('the Captain scores 1.5x AND costs 1.5x', cpt.multiplier === 1.5
     && near(cpt.proj, Math.round(cpt.baseProj * 1.5 * 10) / 10, 0.11)
     && cpt.salary === Math.round(cpt.baseSalary * 1.5));
  ok('the lineup totals are the seats, not the men',
     L.salary === L.players.reduce((s, p) => s + p.salary, 0)
     && near(L.projPoints, L.players.reduce((s, p) => s + p.proj, 0), 0.31),
     JSON.stringify({ salary: L.salary, proj: L.projPoints }));
  ok('it respects the cap at the prices the seats actually charge', L.salary <= 50000);
  ok('both teams are in it, because an entry with one is rejected at the lobby',
     new Set(L.players.map(p => p.team)).size >= 2);
  ok('every seat takes any position, which a classic FLEX does not',
     r.lineups.some(l => l.players.some(p => p.slot === 'FLEX' && (p.position === 'QB' || p.position === 'DST'))));
  // Both the points and the salary scale by the same 1.5, so value per dollar
  // is identical for every candidate and cannot pick the Captain. The answer
  // only shows up in the total, which is what the seat-exchange move reads.
  ok('the Captain is chosen by the lineup total, not by value per dollar',
     near(L.points, (() => {
       let best = 0;
       const cap = 50000;
       for (let ci = 0; ci < players.length; ci++) {
         const rest = players.filter((_, i) => i !== ci);
         const rec = (start, picked, sal, pts) => {
           if (picked.length === 5) {
             if (sal > cap) return;
             if (new Set([players[ci].team, ...picked.map(p => p.team)]).size < 2) return;
             if (pts > best) best = pts;
             return;
           }
           for (let i = start; i < rest.length; i++) {
             const q = rest[i];
             if (sal + q.salary > cap) continue;
             picked.push(q); rec(i + 1, picked, sal + q.salary, pts + q.ironTunaPoints); picked.pop();
           }
         };
         rec(0, [], Math.round(players[ci].salary * 1.5), players[ci].ironTunaPoints * 1.5);
       }
       return Math.round(best * 10) / 10;
     })(), 0.11), String(L.points));
  // Two lineups made of the same six men with a different Captain are two
  // different entries, and a de-duplicator that could not tell them apart
  // would quietly refuse to offer the second one.
  ok('the same six men with a different Captain are a different lineup',
     new Set(r.lineups.map(l => l.key)).size === r.lineups.length);
  ok('a locked player is seated and may still wear the Captain seat',
     (() => { const k = players.find(p => p.position === 'TE').key;
              const lk = DFS.build(players, { format: fmt, mode: 'ironTuna', lock: [k] });
              return lk.ok && lk.lineups[0].players.some(p => p.id === k); })());
  // Both operators reject a six-body entry from one side of the game.
  const oneSide = players.filter(p => p.team === 'BUF');
  ok('a pool with only one team in it builds nothing rather than a rejected entry',
     DFS.build(oneSide, { format: fmt, mode: 'ironTuna' }).ok === false);
  // The file's own price for the seat wins over 1.5x derived here.
  const priced = players.map(p => ({ ...p, salaryBySlot: { CPT: p.salary * 2 } }));
  const pr = DFS.build(priced, { format: fmt, mode: 'ironTuna' });
  ok('when the file priced the Captain seat, that is the price charged',
     pr.ok && (() => { const c = pr.lineups[0].players.find(p => p.slot === 'CPT'); return c.salary === c.baseSalary * 2; })());
  // main's field average draws whole legal rosters and averages what they
  // project for, and the claim it rests on is that every entry in the sample
  // is one somebody could submit. On a Captain roster that means the seat's
  // price and the seat's points, not the man's, and it means both teams --
  // a six-man entry from one side of the game is rejected at the lobby.
  {
    const top = Math.max(...players.map(p => p.ironTunaPoints));
    const owned = players.map(p => ({ ...p, ownership: Math.round((4 + 26 * (p.ironTunaPoints / top)) * 10) / 10 }));
    const fa = DFS.fieldAverage(owned, { slots: fmt.slots, flex: fmt.flex, cap: fmt.cap, mult: fmt.mult, minTeams: fmt.minTeams });
    ok('the field average draws the Showdown roster too', fa && fa.slots === 6 && fa.basis === 'modeled-ownership', JSON.stringify(fa));
    // The optimum is the most any legal roster projects for, so an average of
    // legal rosters cannot exceed it. It did on a Captain roster while the
    // draw was still pricing seats at FLEX salaries.
    const best = DFS.build(owned, { format: fmt, mode: 'ironTuna' }).lineups[0];
    ok('...and the typical entry stays under the optimum, which is what says the seats were priced',
       fa.points < best.projPoints, fa.points + ' vs ' + best.projPoints);
    ok('...and spends no more than the cap the seats actually charge', fa.salary <= fmt.cap, String(fa.salary));
    // A pool with one team in it can draw no legal single-game entry at all,
    // so there is no typical one and it says so rather than averaging entries
    // the lobby would reject.
    ok('a one-team pool has no field to average on a roster that needs two',
       DFS.fieldAverage(owned.filter(p => p.team === 'BUF'), { slots: fmt.slots, flex: fmt.flex, cap: fmt.cap, mult: fmt.mult, minTeams: 2 }) === null);
  }
  ok('FanDuel sells the same roster at its own cap and calls the seat MVP',
     (() => { const f = DFS.formatFor('fd', 'showdown-captain');
              const fr = DFS.build(players, { format: f, mode: 'ironTuna' });
              return f.cap === 60000 && fr.ok && fr.lineups[0].players[0].slot === 'MVP'
                && fr.lineups[0].salary <= 60000; })());
}

console.log('\nthe formats with no cap at all');
{
  const players = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const dr = DFS.formatFor('dk', 'snake');
  const r = DFS.build(players, { format: dr, mode: 'ironTuna' });
  ok('a draft target is built over the classic seats with no cap',
     r.ok && r.capped === false && r.lineups[0].players.length === 9 && r.lineups[0].remaining === null);
  // With no cap there is no per-dollar question, and dividing by a salary the
  // contest never charges would rank the board by price for nothing.
  ok('...and it takes the best player at every seat rather than the best value',
     (() => {
       const best = {};
       players.forEach(p => { if (!best[p.position] || p.ironTunaPoints > best[p.position].ironTunaPoints) best[p.position] = p; });
       const qb = r.lineups[0].players.find(p => p.slot === 'QB');
       return qb.id === best.QB.id;
     })());
  ok('a single-game draft seats six and still needs both teams',
     (() => { const f = DFS.formatFor('dk', 'snake-showdown');
              const one = players.filter(p => p.team === 'BUF' || p.team === 'NYJ');
              const dd = DFS.build(one, { format: f, mode: 'ironTuna' });
              return f.slots.length === 6 && f.minTeams === 2 && dd.ok
                && new Set(dd.lineups[0].players.map(p => p.team)).size >= 2; })());
  ok('a player with no salary at all is still draftable, because a draft prices nobody',
     (() => { const free = players.map(p => ({ ...p, salary: 0 }));
              return DFS.build(free, { format: dr, mode: 'ironTuna' }).ok === true
                && DFS.build(free, { format: DFS.FORMATS['dk-classic'], mode: 'ironTuna' }).ok === false; })());
}

console.log('\nthe contests that are not a roster');
{
  const players = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const pb = DFS.pickBoard(players, { picks: 6 });
  ok('Pick6 gets a board of picks, not a roster', pb.ok && pb.kind === 'picks' && pb.picks.length === 6);
  ok('every pick carries the model, the market, the gap and the side it points to',
     pb.picks.every(p => typeof p.proj === 'number' && typeof p.market === 'number'
       && typeof p.edge === 'number' && (p.direction === 'more' || p.direction === 'less')));
  ok('the largest disagreement is first', pb.picks.every((p, i) => i === 0 || Math.abs(p.edge) <= Math.abs(pb.picks[i - 1].edge) + 1e-9));
  // A quoted disagreement is a disagreement with money; an unquoted one is two
  // models sharing most of their inputs. The board says which, on every row.
  ok('and says on every row whether a book actually posted a price',
     pb.picks.every(p => p.basis === 'quoted-prop' || p.basis === 'game-line')
     && /the game line sliced up/.test(pb.note));
  const td = DFS.pickBoard(players, { stat: 'touchdowns', picks: 5 });
  ok('the touchdown contest ranks on the touchdown number instead',
     td.ok && td.stat === 'touchdowns'
     && td.picks.every((p, i) => i === 0 || p.tdProbability <= td.picks[i - 1].tdProbability + 1e-9));
  ok('Best Ball is named a season format rather than given a Sunday roster',
     DFS.formatFor('dk', 'best-ball').kind === 'season');
  ok('every Game Style on the page resolves to a format',
     ['flash-draft', 'classic', 'showdown-captain', 'pick6', 'best-ball', 'tiers', 'in-game-showdown',
      'single-stat-yards', 'single-stat-touchdowns', 'snake', 'snake-showdown', 'madden-classic', 'madden-showdown-captain']
       .every(k => { const f = DFS.formatFor('dk', k); return f && typeof f.roster === 'string' && f.roster.length; }));
  ok('the Madden styles build the rosters they are modelled on',
     DFS.formatFor('dk', 'madden-classic').key === 'dk-classic'
     && DFS.formatFor('dk', 'madden-showdown-captain').key === 'dk-showdown'
     && DFS.formatFor('dk', 'in-game-showdown').key === 'dk-showdown');
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
  // The field is entering the contest the READER picked, so it is drawn for
  // the resolved format -- its seats, its cap, its multiplier seat and its
  // both-teams rule -- and not for whatever roster the slate was priced for.
  // Those differ: a snake draft over a main slate carries a $50,000 cap the
  // contest does not charge.
  ok('the page solves the field average off the whole priced board, for the roster it is actually solving',
     page.includes('ITDfs.fieldAverage(players, { slots: f.fmt.slots, flex: f.fmt.flex, cap: cap,')
     && page.includes("mult: f.fmt.mult || null, tierSlots: f.fmt.tierSlots || null, minTeams: f.fmt.minTeams || 0 }) : null;"));
  ok('the lineup card prints it in parentheses beside the projection',
     page.includes("stat(projStat + fieldPar, 'Iron Tuna Projection', true)")
     && page.includes("' <small class=\"is-par\">(' + n1(fieldAvg.points) + ')</small>'"));
  // The paragraph under the stat row explains this number in full sentences,
  // so the parenthetical carries no tip of its own and no native title. Two
  // copies of one explanation is two copies to keep in step.
  ok('and the parenthetical leans on that paragraph rather than repeating it behind a hover',
     !/is-par\">\(' \+ tip\(/.test(page) && !/class="is-par" title=/.test(page)
     && page.includes('is the typical entry.'));

  // Every figure in the stat row says where it came from. These are source
  // assertions because no node gate here has a DOM; the hover, the focus and
  // the tap were driven in a browser before the change was pushed.
  ok('all four stats carry an explanation, not just the projection',
     ['fppgStat', 'projStat', 'edgeStat', 'salStat'].every(v => page.includes('var ' + v + ' = tip(')));
  ok('and only those four, since nothing else on the card explains them',
     (page.match(/= tip\(|\+ tip\(/g) || []).length === 4);
  ok('the trigger is a real button, so a keyboard and a phone can open it too',
     page.includes('<button type="button" class="is-tipbtn" aria-describedby="'));
  // The tip must be the button's SIBLING. As a child it becomes part of the
  // button's accessible name, and a screen reader reads the whole paragraph
  // where it should read "133.8".
  ok('the tip is described by the button rather than swallowed into its name',
     /<\/button>'\s*\n?\s*\+ '<span class="is-tip" id="' \+ id \+ '" role="tooltip">/.test(page));
  ok('the tip survives the pointer travelling onto it, so the arithmetic can be copied',
     /\.is-stat \.is-tip:hover\{[\s\S]{0,80}?opacity:1/.test(page));
  // The site's own label rule, `.is-stat span`, paints every span in a stat
  // tile as that tile's little uppercase caption, and it outranks a bare
  // `.is-tip`. A browser caught this the first time: the tooltip rendered in
  // uppercase mono and the 42-point figure shrank to caption size. The board
  // variant of the same rule then repainted every figure in the muted grey.
  ok('the tooltip selectors outrank the stat tile\'s own label rule',
     !/\n\.is-tip\{/.test(page) && !/\n\.is-tipwrap\{/.test(page)
     && page.includes('.is-stat .is-tip{') && page.includes('.is-stat .is-tipwrap{')
     && page.includes('.is-board .is-stat .is-tipwrap{'));
  ok('and the tip uses a font token this stylesheet actually defines',
     !page.includes('var(--font-sans)') && page.includes('.is-stat .is-tip{')
     && /\.is-stat \.is-tip\{[\s\S]{0,400}?font-family:var\(--font-body\)/.test(page));
  ok('every tip carries this roster\'s own arithmetic rather than a definition',
     page.includes('is-tipsum') && page.includes("'Consensus ' + n1(conTot)")
     && page.includes("seats + ' operator averages = '") && page.includes("DraftKings FPPG ' + n1(dkFppg)")
     && page.includes("money(l.salary) + ' of ' + money(full)"));
  // Every one of those sentences used to say "nine", which is the Classic
  // roster's seat count and no other format's: a Showdown seats six and a
  // Tiers board seats whatever the contest posted.
  ok('and counts the seats actually in front of the reader, not always nine',
     page.includes('var seats = l.players.length;')
     && page.includes("var seatWord = seats + ' player' + (seats === 1 ? '' : 's');")
     && !/'Nine (operator|player)/.test(page) && !/these same nine players/.test(page));
  ok('the parenthetical no longer carries a native title, which would open a second tooltip over the first',
     !/class="is-par" title=/.test(page));
  ok('the board says in words what the parenthetical is', page.includes('is the typical entry.'));
  ok('the coach is handed the same number rather than left to derive one',
     page.includes('typicalEntryPoints') && page.includes('vsTypicalEntry')
     && fs.readFileSync(path.join(ROOT, 'dfs-coach.js'), 'utf8').includes('typicalEntryPoints'));
  ok('the method is written down', fs.readFileSync(path.join(ROOT, 'docs/dfs-metrics.md'), 'utf8').includes('Typical entry'));
}

// A slate that is partly played. Once a game is final the projection beside a
// man's name is describing an afternoon that already happened, so the board
// stops quoting it: the roster totals on what he SCORED, and so does the
// typical entry, because the field submitted its entries before kickoff and
// owns him at his real number.
console.log('\nthe slate, partly played');
{
  const rules = H.scoringRules('ppr', H.SCORING_SITE.dk);
  const line = (name, team, o = {}) => ({ name, key: _oddsNorm(name), team,
    pass: { att: 0, cmp: 0, yd: 0, td: 0, int: 0, ...(o.pass || {}) },
    rush: { att: 0, yd: 0, td: 0, ...(o.rush || {}) },
    rec: { tgt: 0, rec: 0, yd: 0, td: 0, ...(o.rec || {}) },
    fumLost: o.fumLost || 0 });
  const actualsOf = (teams, lines) => ({ games: 13, final: teams.length, teams: new Set(teams),
    lines: lines.reduce((m, l) => (m.set(l.key, (m.get(l.key) || []).concat([l])), m), new Map()) });

  // 320 passing yards is 12.8 plus the 300-yard bonus; three touchdowns are
  // 12; the interception is -1; 30 rushing yards are 3 and the score is 6.
  const qb = line('Josh Allen', 'BUF', { pass: { yd: 320, td: 3, int: 1 }, rush: { att: 4, yd: 30, td: 1 } });
  const A = actualsOf(['BUF', 'NYJ'], [qb]);
  const got = H.dfsActualFor(A, 'Josh Allen', 'BUF', 'QB', rules);
  ok('a finished game is scored on the box score, at the site\'s own rules',
     got.gamePlayed === true && got.actualBasis === 'box-score' && near(got.actualPoints, 35.8, 0.01), JSON.stringify(got));
  ok('a man whose game has not kicked off carries no actual at all',
     H.dfsActualFor(A, 'Somebody Else', 'KC', 'WR', rules).gamePlayed === false);
  // He dressed and did nothing. That is a zero, not an unknown, and the board
  // has to say zero rather than keep quoting Thursday's estimate at him.
  const none = H.dfsActualFor(A, 'Khalil Shakir', 'BUF', 'WR', rules);
  ok('a played man with no box-score line is a zero, not a missing number',
     none.gamePlayed === true && none.actualPoints === 0 && none.actualBasis === 'box-score-absent', JSON.stringify(none));
  // A defense IS scorable now: normalizeGameSummary builds its line by
  // inverting the offense across from it. What it cannot do is invent one for
  // a game stored before that line existed, and a summary at the old contract
  // has none -- `A` above carries no defence map, which is exactly that case.
  const dst = H.dfsActualFor(A, 'Bills', 'BUF', 'DST', rules);
  ok('a defense from a box score stored before the line existed still has no actual',
     dst.gamePlayed === true && dst.actualPoints === null && dst.actualBasis === 'no-defense-box-score', JSON.stringify(dst));
  const dline = { sacks: 3, ints: 1, fumRec: 1, defTD: 0, stTD: 0, safety: 0, ptsAllowed: 17 };
  const withD = { ...A, defense: new Map([['BUF', dline]]) };
  const scored = H.dfsActualFor(withD, 'Bills', 'BUF', 'DST', rules);
  ok('and one whose line is stored is scored from it',
     scored.gamePlayed === true && scored.actualBasis === 'box-score' && scored.actualPoints != null, JSON.stringify(scored));
  // The invariant that matters: the actual runs through the SAME engine, the
  // same rules and the same games count as the projection beside it, so the
  // two are comparable rather than two different scales on one row.
  ok('through the same call the projection uses',
     near(scored.actualPoints, _oddsRound(H.scoreAny(dline, 'DST', rules, 1)), 0.001),
     scored.actualPoints + ' vs ' + H.scoreAny(dline, 'DST', rules, 1));
  // Three sacks at a point, a pick and a fumble at two each, and seventeen
  // allowed landing on DraftKings' 14-20 rung for one. Added up by hand.
  ok('and the arithmetic is the sum of its parts, on DraftKings\' own table',
     near(scored.actualPoints, 3 + 2 + 2 + 1, 0.001), String(scored.actualPoints));
  // A defense in a game that has not kicked off is untouched by any of this.
  ok('a defense whose game is still to come carries no actual at all',
     H.dfsActualFor(withD, 'Chiefs', 'KC', 'DST', rules).gamePlayed === false);
  // A kicker is the same case as the defense: field goals and extra points
  // are not in the stored box score either, so scoring him off it would bank
  // a silent zero on a man who might have kicked four.
  const k = H.dfsActualFor(A, 'Tyler Bass', 'BUF', 'K', rules);
  ok('a kicker whose game is over keeps his projection too, for the same reason',
     k.gamePlayed === true && k.actualPoints === null && k.actualBasis === 'no-kicking-box-score', JSON.stringify(k));
  // Two men normalize to the same name often enough that taking the first is
  // somebody's wrong stat line. The club breaks the tie.
  const twins = actualsOf(['BUF', 'NYJ', 'LA'], [line('Mike Williams', 'NYJ', { rec: { rec: 4, yd: 50 } }), line('Mike Williams', 'LA', { rec: { rec: 9, yd: 140, td: 2 } })]);
  ok('two players with the same normalized name are told apart by their club',
     near(H.dfsActualFor(twins, 'Mike Williams', 'NYJ', 'WR', rules).actualPoints, 9, 0.01)
     && near(H.dfsActualFor(twins, 'Mike Williams', 'LA', 'WR', rules).actualPoints, 38, 0.01));

  // ── and what the optimizer does with it ────────────────────────────────
  // A board of its own, because the slate fixture above is fifteen bodies
  // for nine seats with $6,800 of headroom: locking anybody expensive in it
  // is infeasible whether or not his game has been played, which would test
  // the cap rather than this.
  const mk = (id, position, pts, salary, team) => ({ id, key: id, name: id, position, team,
    ironTunaPoints: pts, vegasPoints: pts, consensusPoints: pts, marketPoints: pts,
    salary, onBoard: true, available: true, ownership: 10 });
  const players = [
    mk('qb1', 'QB', 22, 7000, 'BUF'), mk('qb2', 'QB', 18, 6000, 'KC'),
    mk('rb1', 'RB', 20, 7000, 'DET'), mk('rb2', 'RB', 16, 6000, 'NYJ'), mk('rb3', 'RB', 12, 5000, 'LA'),
    mk('wr1', 'WR', 19, 7000, 'CIN'), mk('wr2', 'WR', 15, 6000, 'MIA'), mk('wr3', 'WR', 13, 5000, 'SEA'), mk('wr4', 'WR', 11, 4000, 'ATL'),
    mk('te1', 'TE', 12, 4000, 'KC'), mk('te2', 'TE', 9, 3000, 'BAL'),
    mk('d1', 'DST', 8, 3000, 'CHI'), mk('d2', 'DST', 7, 2500, 'PIT')
  ];
  const base = { slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex, cap: 50000 };
  // His game is over and he went off for fifty. He is still not a play.
  const bank = (id, pts) => players.map(p => p.id === id ? { ...p, gamePlayed: true, actualPoints: pts, actualBasis: 'box-score' } : p);
  const played = bank('qb1', 50);
  const built = DFS.build(played, { ...base, mode: 'ironTuna', lineups: 1 });
  ok('a man whose game is finished is off the board, however well he scored',
     built.ok && !built.lineups[0].players.some(p => p.id === 'qb1'));
  ok('and the build says where he went rather than leaving a reader to wonder',
     built.playedCount === 1 && built.played[0].id === 'qb1' && near(built.played[0].points, 50, 0.01), JSON.stringify(built.played));
  // A lock is a decision, here as everywhere else in the builder: a reader
  // totalling an entry he already has is saying those seats are taken.
  const locked = DFS.build(played, { ...base, mode: 'ironTuna', lineups: 1, lock: ['qb1'] });
  const row = locked.ok ? locked.lineups[0].players.find(p => p.id === 'qb1') : null;
  ok('a locked one is seated, at what he actually scored', row && near(row.points, 50, 0.01) && near(row.actual, 50, 0.01) && row.gamePlayed === true, JSON.stringify(row));
  ok('and a played afternoon has no spread left: his floor and his ceiling are that number too',
     row && near(row.floor, 50, 0.01) && near(row.ceiling, 50, 0.01), row ? [row.floor, row.ceiling].join(' / ') : 'no row');
  ok('the card splits what is banked from what is still a guess',
     locked.lineups[0].bankedPlayers === 1 && near(locked.lineups[0].bankedPoints, 50, 0.01)
     && locked.lineups[0].projPoints > 50, JSON.stringify({ b: locked.lineups[0].bankedPoints, p: locked.lineups[0].projPoints }));
  // Zero is a value. The pool drops anyone the objective scores at nothing,
  // which would quietly lose a locked man whose game ended 0.0 -- the one
  // case where the reader already knows the number and asked for it anyway.
  const goose = DFS.build(bank('qb1', 0), { ...base, mode: 'ironTuna', lineups: 1, lock: ['qb1'] });
  ok('a locked man who scored nothing is still seated on his zero',
     goose.ok && goose.lineups[0].players.some(p => p.id === 'qb1' && p.points === 0));
  // A defense whose game is over has gamePlayed with a NULL actual, because
  // the stored box score has no defensive line. `isFinite(null)` is true in
  // JavaScript -- the global coerces and Number(null) is 0 -- so without an
  // explicit null check it banks at zero: the defense drops off the board and
  // out of the field's draw, scored nothing. A page render caught this.
  const dstOver = players.map(p => p.id === 'd1' ? { ...p, gamePlayed: true, actualPoints: null, actualBasis: 'no-defense-box-score' } : p);
  const withDst = DFS.build(dstOver, { ...base, mode: 'ironTuna', lineups: 1 });
  const dstRow = withDst.ok ? withDst.lineups[0].players.find(p => p.slot === 'DST') : null;
  ok('a played defense with no actual keeps its projection rather than banking a zero',
     withDst.ok && withDst.playedCount === 0 && dstRow && dstRow.id === 'd1' && near(dstRow.points, 8, 0.01) && dstRow.actual === null,
     JSON.stringify({ played: withDst.playedCount, row: dstRow }));
  ok('and it stays in the field\'s draw at that projection, not at nothing',
     near(DFS.fieldAverage(dstOver, base).points, DFS.fieldAverage(players, base).points, 0.01));

  // Leverage discounts a CEILING by how many entries own it. There is nothing
  // to discount once the points are in the books.
  const lev = DFS.build(bank('qb1', 50).map(p => ({ ...p, ownership: 40 })), { ...base, mode: 'leverage', lineups: 1, lock: ['qb1'] });
  ok('leverage does not discount points a man has already scored',
     lev.ok && near(lev.lineups[0].players.find(p => p.id === 'qb1').points, 50, 0.01));

  // ── and what the typical entry does with it ────────────────────────────
  const fa0 = DFS.fieldAverage(players, base);
  // The field owns him at what he scored, not at what he was projected for,
  // because the field submitted before kickoff. So the benchmark moves with
  // his result in both directions.
  const faUp = DFS.fieldAverage(bank('qb1', 60), base);
  const faDown = DFS.fieldAverage(bank('qb1', 0), base);
  ok('a big afternoon from a rostered man lifts the typical entry', faUp.points > fa0.points, faUp.points + ' vs ' + fa0.points);
  ok('and a goose egg from one drags it down', faDown.points < fa0.points, faDown.points + ' vs ' + fa0.points);
  ok('the benchmark stops calling itself a pure projection once part of the slate is played',
     faUp.basis === 'modeled-ownership,part-played' && faUp.bankedPool === 1 && fa0.basis === 'modeled-ownership', faUp.basis);
  // A man who scored nothing is still a man the field rostered: dropping him
  // from the draw would flatter the benchmark by replacing him with somebody
  // who is still projecting.
  ok('a banked zero stays in the field\'s draw rather than being filtered out as a missing projection',
     faDown.bankedPool === 1 && faDown.pool === fa0.pool, JSON.stringify({ pool: faDown.pool, was: fa0.pool, banked: faDown.bankedPool }));

  // What the page does with it.
  const page = fs.readFileSync(path.join(ROOT, 'dfs.html'), 'utf8');
  ok('the page marks a banked line rather than printing it as a projection', page.includes('df-banked'));
  ok('and says in words how much of the total is already in the books', page.includes('already in the books'));
  ok('the coach is told which part of the roster is a result', page.includes('bankedPoints')
     && fs.readFileSync(path.join(ROOT, 'dfs-coach.js'), 'utf8').includes('bankedPoints'));
  ok('the method is written down', fs.readFileSync(path.join(ROOT, 'docs/dfs-metrics.md'), 'utf8').includes('Played games'));

  // The prose. Every sentence this page generates about a player is written
  // forward -- a projection, a ceiling, a market gap, a downside, a touchdown
  // price -- and none of it is true once the game has been played. These pin
  // the branches that say so instead; the wording is checked by rendering the
  // page, which is the only thing that can read it.
  ok('the page asks whether a seat has played before it writes a sentence about him',
     page.includes('function actualOf(') && page.includes('function isBanked(') && page.includes('function isPlayed(') && page.includes('function stillToPlay('));
  ok('a finished seat gets its own fit line rather than an anchor-or-punt thesis',
     page.includes('His game is final: ') && page.includes('The seat is settled whatever the rest of the roster does.'));
  ok('and a played defense says its number is still the pre-game estimate',
     page.includes('still the pre-game estimate'));
  ok('the market read on a finished game is history, not a price to act on',
     page.includes('What the books priced beforehand is settled now'));
  ok('the roster summary draws its market signal from the seats still to play',
     page.includes('var live = stillToPlay(l.players)') && page.includes('signal still to play is'));
  ok('and it stops calling a banked man a projected scoring base',
     page.includes('already in the books') && page.includes('providing the largest projected scoring base'));
  ok('the breakdown picks its market gap and its risk from the seats still to play',
     page.includes('among the seats still to play') && page.includes('among the offensive players still to play'));
  ok('a stack whose game is over is described as spent, not as correlation to come',
     page.includes('stack has already played') && page.includes('stack has been played'));
  ok('the breakdown says how much of the spend has already returned',
     page.includes('of that spend has already returned'));
  ok('a roster with nothing left to play says so rather than warning about risk',
     page.includes('There is no risk left in this roster to describe')
     && page.includes('Every game in this roster has been played')
     && page.includes('Every seat has played, so there is no market case left to make'));
  ok('the prop note counts only the seats that still carry a market',
     page.includes('picks still to play') && page.includes('no longer ') && page.includes('Best quoted touchdown price still to come'));
  ok('neither side of a pivot can be a finished game',
     page.includes('if (isPlayed(cur)) return;') && page.includes('|| isPlayed(q)) return false'));
  ok('the pool table prints the same number for a played man as the roster does',
     page.includes("n1(actualOf(p) != null ? actualOf(p) : p.ironTunaPoints) + bankedMark(p)"));
  // The boards that answer "who is worth a seat" are not reference lists: a
  // man whose game is over cannot take one, and value, cash score and
  // tournament score are all indexed off a projection the result has
  // overtaken. He comes off them, and the page says so rather than leaving a
  // reader to wonder where a name went.
  ok('the value boards and the metrics board drop the men whose games are over',
     page.includes('var rows = stillToPlay(priced)') && page.includes('var list = stillToPlay(full)'));
  ok('and both say how many came off and where to still find them',
     page.includes('function playedOffNote(host, off, total)')
     && page.includes('not listed because their games are over')
     && page.includes('The player pool below still carries ')
     && page.includes("playedOffNote($('dfMetricsNote')") && page.includes("playedOffNote($('dfContestNote')"));
  ok('the note is replaced rather than stacked when a reader switches boards',
     page.includes("host.innerHTML.replace(/\\s*<span class=\"df-playedoff\">[\\s\\S]*?<\\/span>/, '')"));
  // The calculation modal is a record of how the projection was built. It
  // stays -- but it leads with what actually happened, rather than walking a
  // reader through eight steps of forecast for a game that is over.
  ok('the player calculation leads with the result and frames the rest as pre-game',
     page.includes("metricBox(n1(scored), 'Final')")
     && page.includes("scored != null ? 'Projected beforehand' : 'Iron Tuna Projection'")
     && page.includes('a record of the calculation, not a read on him now'));
  // Requiring a played man is exactly how a reader tells the builder about an
  // entry he already holds, so he stays in the search -- at what he scored.
  ok('the require-a-player search offers a played man at his actual score',
     page.includes("actualOf(p) != null ? n1(actualOf(p)) + ' final'") && page.includes("' est, game over'"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
