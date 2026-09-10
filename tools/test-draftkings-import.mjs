#!/usr/bin/env node
import { draftablesToCsv, mergeDraftablePayloads, selectWeeklySlates, targetWeekWindow } from './import-draftkings-salaries.mjs';

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

const lobby = { DraftGroups: [
  { DraftGroupId: 10, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-11T00:20:00Z', GameCount: 16, ContestStartTimeSuffix: ' (Thu-Mon)' },
  { DraftGroupId: 1, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 8, ContestStartTimeSuffix: ' (Early Only)' },
  { DraftGroupId: 2, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 14, ContestStartTimeSuffix: ' (Sun-Mon)' },
  { DraftGroupId: 3, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 12, ContestStartTimeSuffix: '' },
  { DraftGroupId: 4, Sport: 'NFL', ContestTypeId: 96, StartDate: '2026-09-13T17:00:00Z', GameCount: 1, ContestStartTimeSuffix: ' (BUF @ NYJ)' },
  { DraftGroupId: 20, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-18T00:20:00Z', GameCount: 16, ContestStartTimeSuffix: ' (Thu-Mon)' }
] };

console.log('\nthe weekly slate selector');
const selected = selectWeeklySlates(lobby, Date.parse('2026-09-10T13:00:00Z'));
ok('all current-week Classic pools are selected', selected.map(x => x.DraftGroupId).join(',') === '10,2,3,1', selected.map(x => x.DraftGroupId).join(','));
ok('the broadest weekly pool is first', selected[0].GameCount === 16, String(selected[0].GameCount));
ok('Showdown is excluded', !selected.some(x => x.DraftGroupId === 4));
ok('the following NFL week is excluded', !selected.some(x => x.DraftGroupId === 20));
const tuesdayWindow = targetWeekWindow(Date.parse('2026-09-15T14:00:00Z'));
ok('Tuesday prepares the coming Thursday-through-Monday week', tuesdayWindow.startDay === Date.UTC(2026, 8, 17));

console.log('\nthe weekly pool merge');
const row = (id, salary, name = `Player ${id}`) => ({
  draftableId: 1000 + id, playerId: 2000 + id, playerDkId: 3000 + id, displayName: name,
  position: 'QB', salary, teamAbbreviation: 'BUF', competition: { competitionId: 10, name: 'BUF @ NYJ' }
});
const merged = mergeDraftablePayloads([
  { slate: selected[0], payload: { draftables: [row(1, 7000), row(2, 6500)] } },
  { slate: selected[1], payload: { draftables: [row(1, 7100), row(3, 6000)] } }
]);
ok('players unique to narrower pools are added', merged.draftables.length === 3, String(merged.draftables.length));
ok('the broadest-pool salary wins an overlap', merged.draftables.find(x => x.playerId === 2001).salary === 7000);
ok('salary conflicts are counted', merged.salaryConflicts === 1, String(merged.salaryConflicts));

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
