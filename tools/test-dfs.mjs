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
  cut('// -- kickers and defences, scored', '// -- the three boards') + '\n' + cut('// -- DFS ---', '// Memoized per isolate alongside _PROJ_ENC') + '\n' +
  'return { DFS_SITES, SCORING_SITE, parseDfsCsv, buildDfsSlate, buildDfsStacks, scoringRules, scoreStats };'
)(teamKey, _oddsNorm, _oddsRound, _csvSplit, () => { throw new Error('no network'); });
const DFS = require(path.join(ROOT, 'dfs-optimizer.js'));

console.log('\nthe lobby CSVs');
{
  const dk = 'Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\nQB,"Josh Allen (12345)",Josh Allen,12345,QB,8200,BUF@NYJ 09/14/2026 01:00PM ET,BUF,24.1\nRB,"Jahmyr Gibbs (222)",Jahmyr Gibbs,222,RB/FLEX,8900,DET@GB 09/14/2026 04:25PM ET,DET,21.3\nDST,"Bears  (333)",Bears ,333,DST,3000,CHI@MIN 09/14/2026 01:00PM ET,CHI,7.0\n';
  const a = H.parseDfsCsv('dk', dk);
  ok('a DraftKings CSV parses', !a.error && a.rows.length === 3, a.error);
  ok('the opponent comes out of Game Info', a.rows[0].opponent === 'NYJ' && a.rows[1].opponent === 'GB');
  ok('a defence is a DST with its club', a.rows[2].position === 'DST' && a.rows[2].team === 'CHI');
  const fd = 'Id,Position,First Name,Nickname,Last Name,FPPG,Played,Salary,Game,Team,Opponent,Injury Indicator,Injury Details,Tier,Roster Position\n1,QB,Josh,Josh Allen,Allen,24.1,1,9200,BUF@NYJ,BUF,NYJ,,,,QB\n2,D,,Chicago Bears,,7,1,4000,CHI@MIN,CHI,MIN,,,,D\n';
  const b = H.parseDfsCsv('fd', fd);
  ok('a FanDuel CSV parses', !b.error && b.rows.length === 2, b.error);
  ok('the nickname is the name and D is a DST', b.rows[0].name === 'Josh Allen' && b.rows[1].position === 'DST');
  ok('a file from the wrong site is refused', !!H.parseDfsCsv('dk', fd).error && !!H.parseDfsCsv('fd', dk).error);
  ok('an empty file is refused', H.parseDfsCsv('dk', '').error === 'empty');
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
  .map(([name, position, team, salary]) => ({ name, position, team, opponent: null, salary }));
const STATE = { ok: true, games: [{ id: 'a', home: 'NYJ', away: 'BUF', total: 47, spread: -3, impliedHome: 22, impliedAway: 25, kickoff: 1 }, { id: 'b', home: 'GB', away: 'DET', total: 51, spread: 1, impliedHome: 26, impliedAway: 25, kickoff: 1 }] };

console.log('\nthe slate');
const slate = H.buildDfsSlate('dk', SAL, WEEK, {});
{
  ok('every salary row is on the slate', slate.players.length === SAL.length);
  ok('a player the board does not know is kept but unmatched', slate.unmatched === 1 && slate.players.find(p => p.name === 'Nobody Famous').onBoard === false);
  const allen = slate.players.find(p => p.name === 'Josh Allen');
  ok('each player carries salary and all three projections', allen.salary === 8200 && allen.vegasPoints > 0 && allen.ironTunaPoints > 0 && allen.consensusPoints > 0);
  ok('and Market Delta, TD probability and team total', allen.marketDelta && Number.isFinite(allen.tdProbability) && allen.teamTotal === 27);
  ok('the site scoring is applied (DK 300-yard bonus is not reached at 280)', near(allen.vegasPoints, _oddsRound(280 * 0.04 + 2.2 * 4 + 4 + 0.5 * 6), 0.15), String(allen.vegasPoints));
  ok('Vegas Value Score is market points per $1K against the slate median', allen.vegasValueScore > 0 && slate.players.some(p => p.vegasValueScore && p.vegasValueScore !== 100));
  ok('a DST matches by club', (() => { const b = slate.players.find(p => p.position === 'DST' && p.team === 'CHI'); return b && b.onBoard === true && b.siteName === 'Bears' && b.vegasPoints > 0; })());
  ok('the boards are there', slate.boards.bestVegasValues.length > 0 && slate.boards.tdUpside.length > 0 && slate.boards.volumeValues.length > 0);
  ok('expensive fades are pricey players the market is lower on', slate.boards.expensiveFades.every(p => p.salary >= 6000 && p.marketDelta.points < 0) && slate.boards.expensiveFades.some(p => p.name === 'Breece Hall'));
  ok('the TD basis is said', slate.players.filter(p => p.onBoard).every(p => p.tdBasis === 'derived' || p.tdBasis === 'anytime-td-market'));
  ok('with no prop on the slate the note says so', slate.hasProps === false && /No sportsbook/.test(slate.note));
  const stacks = H.buildDfsStacks(slate, STATE);
  ok('stacks rank games by total', stacks[0].game === 'DET at GB' && stacks[0].total === 51);
  ok('each side has a QB, catchers, a back and a bring-back', stacks[1].away.qb.name === 'Josh Allen' && stacks[1].away.catchers.length >= 2 && stacks[1].bringBack.home);
  ok('a stack is priced', stacks[1].away.stackSalary > 0 && stacks[1].away.stackVegasPoints > 0);
}

console.log('\nthe optimizer');
{
  const players = slate.players.filter(p => p.onBoard).map(p => ({ ...p, id: p.key }));
  const base = { cap: 50000, slots: H.DFS_SITES.dk.slots, flex: H.DFS_SITES.dk.flex };
  const r = DFS.build(players, { ...base, mode: 'ironTuna', lineups: 1 });
  ok('a lineup is built', r.ok && r.lineups.length === 1);
  const L = r.lineups[0];
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
  ok('a lock is honoured', locked.lineups[0].players.some(p => p.id === 'aaronrodgers|QB'));
  const excluded = DFS.build(players, { ...base, mode: 'ironTuna', exclude: ['jahmyrgibbs|RB'] });
  ok('an exclusion is honoured', !excluded.lineups[0].players.some(p => p.id === 'jahmyrgibbs|RB'));
  const stacked = DFS.build(players, { ...base, mode: 'vegas', stack: true, stackSize: 1 });
  const qb = stacked.lineups[0].players.find(p => p.slot === 'QB');
  ok('a QB stack puts a pass-catcher from his team in the lineup', stacked.lineups[0].players.some(p => p.team === qb.team && /WR|TE/.test(p.position)), JSON.stringify(stacked.lineups[0].players.map(p => p.name)));
  const bb = DFS.build(players, { ...base, mode: 'vegas', stack: true, bringBack: true });
  const qb2 = bb.lineups[0].players.find(p => p.slot === 'QB');
  ok('a bring-back adds a player from the opponent', bb.lineups[0].players.some(p => p.team === qb2.opponent && p.position !== 'DST'), qb2.opponent + ' ' + JSON.stringify(bb.lineups[0].players.map(p => p.team)));
  const capped = DFS.build(players, { ...base, mode: 'ironTuna', maxPerTeam: 2 });
  const counts = {}; capped.lineups[0].players.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
  ok('a per-team maximum is honoured', Object.values(counts).every(n => n <= 2), JSON.stringify(counts));
  const tight = DFS.build(players, { ...base, cap: 48500, mode: 'ironTuna' });
  ok('a lower cap is honoured', tight.ok && tight.lineups[0].salary <= 48500, JSON.stringify(tight.note));
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
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
