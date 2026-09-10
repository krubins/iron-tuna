#!/usr/bin/env node
import { draftablesToCsv, selectMainSlate } from './import-draftkings-salaries.mjs';

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

const lobby = { DraftGroups: [
  { DraftGroupId: 1, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 8, ContestStartTimeSuffix: ' (Early Only)' },
  { DraftGroupId: 2, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 14, ContestStartTimeSuffix: ' (Sun-Mon)' },
  { DraftGroupId: 3, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 12, ContestStartTimeSuffix: '' },
  { DraftGroupId: 4, Sport: 'NFL', ContestTypeId: 96, StartDate: '2026-09-13T17:00:00Z', GameCount: 1, ContestStartTimeSuffix: ' (BUF @ NYJ)' }
] };

console.log('\nthe main-slate selector');
ok('the unsuffixed Sunday Classic slate wins', selectMainSlate(lobby, Date.parse('2026-09-08T12:00:00Z')).DraftGroupId === 3);
ok('the selector refuses an expired lobby', (() => { try { selectMainSlate(lobby, Date.parse('2026-09-14T12:00:00Z')); return false; } catch { return true; } })());

const positions = ['QB', 'RB', 'WR', 'TE', 'DST'];
const draftables = [];
for (let i = 0; i < 45; i++) {
  const position = positions[i % positions.length];
  const row = { draftableId: 1000 + i, playerId: 2000 + i, playerDkId: 3000 + i, displayName: `Player ${i}`,
    position, salary: 3000 + i * 100, teamAbbreviation: i % 2 ? 'BUF' : 'NYJ',
    competition: { competitionId: 10, name: 'BUF @ NYJ', startTime: '2026-09-13T17:00:00Z' },
    draftStatAttributes: [{ id: 90, value: '10.5' }] };
  draftables.push(row);
  if (position !== 'DST') draftables.push({ ...row, draftableId: 5000 + i, rosterSlotId: 70 });
}

console.log('\nthe draftables adapter');
const converted = draftablesToCsv({ draftables });
ok('duplicate roster slots collapse to one player', converted.rows.length === 45, String(converted.rows.length));
ok('the CSV matches the existing DraftKings adapter', converted.csv.startsWith('Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n'));
ok('skill positions retain FLEX eligibility', converted.csv.includes(',RB/FLEX,'));
ok('defenses retain DST eligibility', converted.csv.includes(',DST,'));
ok('a short response cannot overwrite good data', (() => { try { draftablesToCsv({ draftables: draftables.slice(0, 10) }); return false; } catch { return true; } })());
ok('a missing position is rejected', (() => { try { draftablesToCsv({ draftables: draftables.filter(x => x.position !== 'DST') }, 20); return false; } catch { return true; } })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
