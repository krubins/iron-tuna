#!/usr/bin/env node
import { draftablesToCsv, githubOidcToken, mergeDraftablePayloads, selectWeeklySlates, targetWeekWindow } from './import-draftkings-salaries.mjs';

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
ok('DraftKings FPPG is carried into the CSV', converted.fppgRows === 45 && converted.csv.includes(',10.5\n'));
ok('skill positions retain FLEX eligibility', converted.csv.includes(',RB/FLEX,'));
ok('defenses retain DST eligibility', converted.csv.includes(',DST,'));
ok('a short response cannot overwrite good data', (() => { try { draftablesToCsv({ draftables: draftables.slice(0, 10) }); return false; } catch { return true; } })());
ok('a missing position is rejected', (() => { try { draftablesToCsv({ draftables: draftables.filter(x => x.position !== 'DST') }, 20); return false; } catch { return true; } })());

console.log('\nthe GitHub identity request');
const realFetch = globalThis.fetch;
let tokenRequest;
globalThis.fetch = async (url, options) => {
  tokenRequest = { url: String(url), auth: options.headers.authorization };
  return new Response(JSON.stringify({ value: 'signed-token' }), { headers: { 'content-type': 'application/json' } });
};
const token = await githubOidcToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example/token?job=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' });
globalThis.fetch = realFetch;
ok('the workflow requests the narrow importer audience', new URL(tokenRequest.url).searchParams.get('audience') === 'iron-tuna-dfs-import');
ok('the workflow authenticates its token request', tokenRequest.auth === 'Bearer request-token');
ok('the signed token is returned for the import', token === 'signed-token');
ok('running outside GitHub Actions is rejected', await githubOidcToken({}).then(() => false, () => true));

console.log('\nthe schedule the reader is told');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/draftkings-salaries.yml'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const crons = [...workflow.matchAll(/- cron: '(\d+) (\d+) \* \* (\d)'/g)].map(m => ({ dow: Number(m[3]), hour: Number(m[2]), minute: Number(m[1]) }));
const noteStart = worker.indexOf('const DFS_IMPORT_SCHEDULE');
const noteEnd = worker.indexOf('const DFS_DDL', noteStart);
const N = new Function('DFS_SITES', worker.slice(noteStart, noteEnd) + '\nreturn { DFS_IMPORT_SCHEDULE, dfsImportWindow, dfsNoSalariesNote };')(
  { dk: { label: 'DraftKings' }, fd: { label: 'FanDuel' } });
ok('the workflow runs on the hour', crons.length > 0 && crons.every(c => c.minute === 0));
ok('the Worker mirrors every workflow cron slot', JSON.stringify(crons.map(c => ({ dow: c.dow, hour: c.hour }))) === JSON.stringify(N.DFS_IMPORT_SCHEDULE),
   JSON.stringify(crons) + ' vs ' + JSON.stringify(N.DFS_IMPORT_SCHEDULE));
ok('the first slot is Tuesday 6 AM EDT, before the week\'s first reader', N.DFS_IMPORT_SCHEDULE[0].dow === 2 && N.DFS_IMPORT_SCHEDULE[0].hour === 10);
const tue = N.dfsNoSalariesNote('dk', Date.parse('2026-09-15T09:00:00Z'));
ok('a Tuesday pre-dawn board names the 6 AM update', /next scheduled update is Tue, Sep 15, 6:00 AM ET\./.test(tue.note) && tue.nextImportAt === Date.parse('2026-09-15T10:00:00Z'), tue.note);
const tueLate = N.dfsNoSalariesNote('dk', Date.parse('2026-09-15T12:36:00Z'));
ok('once the 6 AM slot has passed the note names the 10 AM retry', /next scheduled update is Tue, Sep 15, 10:00 AM ET\./.test(tueLate.note) && tueLate.lastImportAt === Date.parse('2026-09-15T10:00:00Z'), tueLate.note);
const thu = N.dfsNoSalariesNote('dk', Date.parse('2026-09-17T15:00:00Z'));
ok('inside the game week the note says the update ran and found nothing', /last ran Wed, Sep 16, 10:00 AM ET and found no posted slate/.test(thu.note) && /next scheduled update is Tue, Sep 22, 6:00 AM ET/.test(thu.note), thu.note);
ok('standard time is printed in New York time, not UTC', /Tue, Dec 1, 5:00 AM ET/.test(N.dfsNoSalariesNote('dk', Date.parse('2026-12-01T09:00:00Z')).note));
const fd = N.dfsNoSalariesNote('fd', Date.parse('2026-09-15T12:36:00Z'));
ok('FanDuel, which has no import job, is promised no update', fd.nextImportAt == null && !/scheduled update/.test(fd.note));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
