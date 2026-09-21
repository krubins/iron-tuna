#!/usr/bin/env node
import { draftableFppg, draftablesToCsv, githubOidcToken, mergeDraftablePayloads, run, selectWeeklySlates, selectShowdownSlates, showdownCsv, targetWeekWindow, SHOWDOWN_CONTEST_TYPE_IDS } from './import-draftkings-salaries.mjs';

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

console.log('\nthe season average across pools');
const noStat = { ...row(4, 5000), draftStatAttributes: [{ id: 90, value: '-' }] };
const withStat = { ...row(4, 5100), draftStatAttributes: [{ id: 90, value: '12.3' }] };
const backfilled = mergeDraftablePayloads([{ slate: selected[0], payload: { draftables: [noStat] } }, { slate: selected[1], payload: { draftables: [withStat] } }]);
ok('a stat block the broadest pool lacks is taken from a narrower one, salary kept', backfilled.draftables[0].salary === 5000 && draftableFppg(backfilled.draftables[0]) === 12.3 && backfilled.fppgBackfilled === 1, JSON.stringify(backfilled));
ok('a pool that has the average keeps its own', mergeDraftablePayloads([{ payload: { draftables: [withStat] } }, { payload: { draftables: [{ ...noStat, draftStatAttributes: [{ id: 90, value: '1.0' }] }] } }]).fppgBackfilled === 0);
ok('a dash or blank average is none, never zero', draftableFppg({ draftStatAttributes: [{ id: 90, value: '-' }] }) === null && draftableFppg({ draftStatAttributes: [{ id: 90, value: '' }] }) === null && draftableFppg({}) === null);
ok('a formatted value falls back to sortValue', draftableFppg({ draftStatAttributes: [{ id: 90, value: 'n/a', sortValue: '9.75' }] }) === 9.75);

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
ok('a pool without the average leaves every CSV cell empty rather than zero', (() => { const c = draftablesToCsv({ draftables: draftables.map(r => ({ ...r, draftStatAttributes: [{ id: 90, value: '-' }] })) }); return c.fppgRows === 0 && c.csv.split('\n').slice(1, 46).every(l => /,$/.test(l)); })());
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


// ── the single-game groups ─────────────────────────────────────────────────
// I could not reach api.draftkings.com from the session that wrote this, so
// there is no captured Showdown payload to test against. What CAN be proved
// without one is that the CSV this importer writes is a file the WORKER
// already knows how to read: the assertions at the foot of this block put the
// output through _worker.js's own parseDfsCsv, dfsSlateShape,
// dfsSingleGameSlateKey and dfsCollapseSingleGame. If those four agree, the
// importer's output is correct by the site's own definition, and the only
// thing left unverified is the shape of DraftKings' payload — which the
// workflow's dry run reports before anything is stored.
console.log('\nthe single-game group selector');
{
  const picked = selectShowdownSlates(lobby, Date.parse('2026-09-10T13:00:00Z'));
  ok('the Showdown group is selected', picked.map(x => x.DraftGroupId).join(',') === '4', picked.map(x => x.DraftGroupId).join(','));
  ok('...and no Classic pool comes with it', !picked.some(x => Number(x.ContestTypeId) === 21));
  ok('...and the following NFL week is still excluded', !picked.some(x => x.DraftGroupId === 20));
  ok('Captain Mode is the contest type this keys on', SHOWDOWN_CONTEST_TYPE_IDS.has(96));
  // The two selectors must not overlap, or a Showdown pool's prices would be
  // merged into the main board.
  const classic = selectWeeklySlates(lobby, Date.parse('2026-09-10T13:00:00Z')).map(x => x.DraftGroupId);
  ok('the two selectors share no group', !picked.some(x => classic.includes(x.DraftGroupId)));
}

console.log('\nthe single-game CSV');
{
  // DraftKings lists each player twice in a Showdown group, once per seat.
  // 1.5x, rounded to the nearest hundred, which is what the lobby charges.
  const cptOf = flex => Math.round(flex * 1.5 / 100) * 100;
  const sdRow = (id, name, position, team, flex, seat) => ({
    draftableId: 9000 + id * 2 + (seat === 'CPT' ? 1 : 0), playerId: 200 + id, playerDkId: 300 + id,
    displayName: name, position, salary: seat === 'CPT' ? cptOf(flex) : flex, teamAbbreviation: team,
    competition: { competitionId: 77, name: 'BUF @ NYJ', startTime: '2026-09-13T17:00:00Z' },
    draftStatAttributes: [{ id: 90, value: '14.2' }]
  });
  const pool = [
    [1, 'Josh Allen', 'QB', 'BUF', 11400], [2, 'James Cook', 'RB', 'BUF', 8800], [3, 'Khalil Shakir', 'WR', 'BUF', 7000],
    [4, 'Dalton Kincaid', 'TE', 'BUF', 6000], [5, 'Bills ', 'DST', 'BUF', 4600], [6, 'Tyler Bass', 'K', 'BUF', 4000],
    [7, 'Aaron Rodgers', 'QB', 'NYJ', 9800], [8, 'Breece Hall', 'RB', 'NYJ', 10200], [9, 'Garrett Wilson', 'WR', 'NYJ', 9000],
    [10, 'Tyler Conklin', 'TE', 'NYJ', 5200], [11, 'Jets ', 'DST', 'NYJ', 4200], [12, 'Greg Zuerlein', 'K', 'NYJ', 3800]
  ];
  const draftables = pool.flatMap(([id, name, pos, team, flex]) => [sdRow(id, name, pos, team, flex, 'FLEX'), sdRow(id, name, pos, team, flex, 'CPT')]);
  const built = showdownCsv({ draftables });
  ok('every player is written twice, once per seat', built.players === 12 && built.rows === 24, JSON.stringify({ p: built.players, r: built.rows }));
  ok('the game is named by its two clubs, alphabetically', built.game === 'BUF|NYJ', built.game);

  // THE CHAIN. The worker's own readers, run over the importer's output.
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cut ' + a.slice(0, 30)); return src.slice(i, j); };
  const TA = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
  const teamKey = t => { const u = String(t || '').toUpperCase(); return TA[u] || u; };
  const _oddsNorm = x => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
  const _csvSplit = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
  const W = new Function('teamKey', '_oddsNorm', '_csvSplit',
    cut('const DFS_SINGLE_FLEX', 'const SCORING_SITE = {') + '\n' +
    cut('const _dfsPos =', 'const DFS_FPPG_PINS = {') + '\n' +
    'return { parseDfsCsv, dfsSlateShape, dfsSingleGameSlateKey, dfsCollapseSingleGame };'
  )(teamKey, _oddsNorm, _csvSplit);

  const parsed = W.parseDfsCsv('dk', built.csv);
  ok('the worker parses it without complaint', !parsed.error && parsed.rows.length === 24, parsed.error || String(parsed.rows.length));
  ok('...and reads it as a single-game file', W.dfsSlateShape(parsed.rows) === 'single-game');
  ok('...and files it under the matchup the desk would store it as',
     W.dfsSingleGameSlateKey(parsed.rows) === 'sd:BUF|NYJ', String(W.dfsSingleGameSlateKey(parsed.rows)));
  const folded = W.dfsCollapseSingleGame(parsed.rows, 'dk');
  ok('...and folds back to one row per player', folded.length === 12, String(folded.length));
  const allen = folded.find(r => r.name === 'Josh Allen');
  ok('...carrying the FLEX price as the salary and the Captain price beside it',
     allen.salary === 11400 && allen.salaryBySlot.CPT === 17100, JSON.stringify({ s: allen.salary, c: allen.salaryBySlot }));
  // Game Info: the lobby writes "BUF @ NYJ" and the worker's parser wants no
  // spaces. Writing it through unchanged left every opponent null.
  ok('the opponent comes across, so the spaces around the @ were normalized',
     parsed.rows.every(r => r.opponent === 'BUF' || r.opponent === 'NYJ'),
     JSON.stringify([...new Set(parsed.rows.map(r => r.opponent))]));

  // ── what it refuses ──────────────────────────────────────────────────────
  // Every one of these would otherwise store a Captain price arrived at by
  // guesswork, which is a roster nobody can enter.
  const refuses = (what, list) => { try { showdownCsv({ draftables: list }); return `no error (${what})`; } catch (e) { return null; } };
  ok('a group listing a player at only one price is refused',
     refuses('one price', draftables.filter(r => r.salary !== 17100)) === null);
  ok('a group whose two seats are not about 1.5x apart is refused',
     refuses('bad ratio', draftables.map(r => r.displayName === 'Josh Allen' && r.salary === 17100 ? { ...r, salary: 12000 } : r)) === null);
  ok('a group naming three clubs is refused',
     refuses('three clubs', draftables.concat([sdRow(13, 'Somebody Else', 'WR', 'KC', 5000, 'FLEX'), sdRow(13, 'Somebody Else', 'WR', 'KC', 5000, 'CPT')])) === null);
  ok('a group too thin to be a real pool is refused',
     refuses('too thin', draftables.slice(0, 4)) === null);
  ok('an empty payload is refused rather than posted as a slate',
     refuses('empty', []) === null);
}


// ── the whole run, against a stubbed lobby ─────────────────────────────────
// The orchestration is the part no unit test above reaches: that the Classic
// import goes first and still fails the job when it fails, that each
// single-game group is posted on its own, and that one bad group cannot take
// the main board down with it. Every network call goes through globalThis
// .fetch, so one stub covers the lobby, the draftables, the OIDC token and
// the admin endpoint.
console.log('\nthe run');
{
  const cptOf = flex => Math.round(flex * 1.5 / 100) * 100;
  const sdPool = (teamA, teamB) => {
    const out = [];
    let i = 0;
    for (const [name, pos, team, flex] of [
      ['Ay One', 'QB', teamA, 11000], ['Ay Two', 'RB', teamA, 9000], ['Ay Three', 'WR', teamA, 8000],
      ['Ay Four', 'TE', teamA, 6000], ['Ay Five', 'K', teamA, 4000], [teamA + ' Defense', 'DST', teamA, 4400],
      ['Bee One', 'QB', teamB, 10000], ['Bee Two', 'RB', teamB, 8600], ['Bee Three', 'WR', teamB, 7600],
      ['Bee Four', 'TE', teamB, 5600], ['Bee Five', 'K', teamB, 3800], [teamB + ' Defense', 'DST', teamB, 4200]
    ]) {
      i++;
      for (const salary of [flex, cptOf(flex)]) {
        out.push({ draftableId: 70000 + i * 4 + (salary === flex ? 0 : 1), playerId: 700 + i, playerDkId: 800 + i,
          displayName: name, position: pos, salary, teamAbbreviation: team,
          competition: { competitionId: 1, name: `${teamA} @ ${teamB}`, startTime: '2026-09-13T17:00:00Z' },
          draftStatAttributes: [{ id: 90, value: '11.0' }] });
      }
    }
    return out;
  };
  // A classic pool big enough to clear the importer's own floor.
  const classicPool = [];
  for (let i = 0; i < 45; i++) {
    const pos = ['QB', 'RB', 'WR', 'TE', 'DST'][i % 5];
    classicPool.push({ draftableId: 100 + i, playerId: 200 + i, playerDkId: 300 + i, displayName: `Main ${i}`,
      position: pos, salary: 3000 + i * 100, teamAbbreviation: i % 2 ? 'BUF' : 'NYJ',
      competition: { competitionId: 9, name: 'BUF @ NYJ', startTime: '2026-09-13T17:00:00Z' },
      draftStatAttributes: [{ id: 90, value: '10.5' }] });
  }
  const runLobby = { DraftGroups: [
    { DraftGroupId: 1, Sport: 'NFL', ContestTypeId: 21, StartDate: '2026-09-13T17:00:00Z', GameCount: 14, ContestStartTimeSuffix: ' (Sun-Mon)' },
    { DraftGroupId: 41, Sport: 'NFL', ContestTypeId: 96, StartDate: '2026-09-13T17:00:00Z', GameCount: 1, ContestStartTimeSuffix: ' (BUF @ NYJ)' },
    { DraftGroupId: 42, Sport: 'NFL', ContestTypeId: 96, StartDate: '2026-09-13T20:25:00Z', GameCount: 1, ContestStartTimeSuffix: ' (DET @ GB)' },
    // Broken on purpose: one price per player, so the Captain seat cannot be
    // identified and the group must be skipped rather than guessed at.
    { DraftGroupId: 43, Sport: 'NFL', ContestTypeId: 96, StartDate: '2026-09-14T00:20:00Z', GameCount: 1, ContestStartTimeSuffix: ' (KC @ LAC)' }
  ] };
  const draftablesFor = id => id === 1 ? classicPool
    : id === 41 ? sdPool('BUF', 'NYJ')
    : id === 42 ? sdPool('DET', 'GB')
    : sdPool('KC', 'LAC').filter(r => r.salary < 11000 && r.salary % 3 !== 0).slice(0, 12);
  const posts = [];
  const stub = (adminAnswer) => async (url, options) => {
    const u = String(url);
    if (u.includes('actions.example')) return new Response(JSON.stringify({ value: 'tok' }), { headers: { 'content-type': 'application/json' } });
    if (u.includes('lobby/getcontests')) return new Response(JSON.stringify(runLobby), { headers: { 'content-type': 'application/json' } });
    const m = /draftgroups\/(\d+)\/draftables/.exec(u);
    if (m) return new Response(JSON.stringify({ draftables: draftablesFor(Number(m[1])) }), { headers: { 'content-type': 'application/json' } });
    const body = JSON.parse(options.body);
    posts.push(body);
    return adminAnswer(body);
  };
  const baseEnv = { IRON_TUNA_ADMIN_URL: 'https://iron.example/api/admin/dfs', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt' };
  const okAnswer = (body) => {
    const rows = body.csv.trim().split('\n').length - 1;
    const slate = body.slate || 'derived';
    return new Response(JSON.stringify({ ok: true, season: 2026, week: 2, imported: { ok: true, stored: rows, attempted: rows, slate } }), { headers: { 'content-type': 'application/json' } });
  };

  const realFetch2 = globalThis.fetch;
  globalThis.fetch = stub(okAnswer);
  const live = await run({ ...baseEnv }, Date.parse('2026-09-10T13:00:00Z'));
  globalThis.fetch = realFetch2;

  ok('the Classic pool is imported first', posts.length && posts[0].slate === 'weekly');
  ok('...and its own success is still reported from `stored`', live.imported === 45, String(live.imported));
  ok('two sound single-game groups are imported', live.showdown.imported.length === 2, JSON.stringify(live.showdown.imported));
  // The slate key is the worker's to derive, so this side must not send one.
  ok('...each posted with no slate of its own, so the worker derives the matchup',
     posts.slice(1).every(p => p.slate === undefined), JSON.stringify(posts.slice(1).map(p => p.slate)));
  ok('...and posted as the automation, like the Classic import', posts.slice(1).every(p => p.source === 'draftkings-automation'));
  ok('the group that cannot be read is skipped, not guessed at', live.showdown.skipped.length === 1
     && /Captain seat cannot be identified|not priced at exactly two salaries|at least/.test(live.showdown.skipped[0].reason),
     JSON.stringify(live.showdown.skipped));
  ok('...and it is named, so a skipped game is findable in the log',
     live.showdown.skipped[0].label === '(KC @ LAC)', JSON.stringify(live.showdown.skipped[0]));
  ok('one bad group does not take the main board down with it', live.imported === 45 && live.showdown.imported.length === 2);

  // A Classic failure is still the one failure worth failing the job for.
  globalThis.fetch = stub((body) => body.slate === 'weekly'
    ? new Response(JSON.stringify({ ok: true, imported: { ok: true, stored: 0, attempted: 45 } }), { headers: { 'content-type': 'application/json' } })
    : okAnswer(body));
  const threw = await run({ ...baseEnv }, Date.parse('2026-09-10T13:00:00Z')).then(() => false, () => true);
  globalThis.fetch = realFetch2;
  ok('a Classic import that stored nothing still fails the job', threw);

  // The dry run: discovery and validation, nothing posted. This is how a real
  // Showdown payload gets inspected before the first live import.
  const before = posts.length;
  globalThis.fetch = stub(okAnswer);
  const dry = await run({ ...baseEnv, INPUT_DRY_RUN: '1' }, Date.parse('2026-09-10T13:00:00Z'));
  globalThis.fetch = realFetch2;
  ok('a dry run posts nothing at all', posts.length === before, String(posts.length - before));
  ok('...and still reports every single-game group it found', dry.showdownGroups.length === 3, JSON.stringify(dry.showdownGroups.map(g => g.id)));
  ok('...and which of them would import and which would not',
     dry.showdown.imported.length === 2 && dry.showdown.skipped.length === 1
     && dry.showdown.imported.every(x => x.dryRun === true), JSON.stringify(dry.showdown));
  ok('...naming the matchups by the key the desk would store them under',
     dry.showdown.imported.map(x => x.game).sort().join() === 'BUF|NYJ,DET|GB', JSON.stringify(dry.showdown.imported.map(x => x.game)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
