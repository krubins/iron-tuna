#!/usr/bin/env node
// Download every DraftKings NFL Classic salary pool available for the target
// Thursday-through-Monday week, merge them into one weekly player set, and
// pass it through Iron Tuna's existing admin CSV importer.

import { pathToFileURL } from 'url';

export const LOBBY_URL = 'https://www.draftkings.com/lobby/getcontests?sport=NFL';
export const DRAFTABLES_URL = id => `https://api.draftkings.com/draftgroups/v1/draftgroups/${id}/draftables`;
const MIN_PLAYERS = 40;
const DAY_MS = 86400000;
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const nyParts = value => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date(value)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));

const nyDay = value => {
  const p = nyParts(value);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
};

export function targetWeekWindow(now = Date.now()) {
  const p = nyParts(now);
  const weekday = WEEKDAY[p.weekday];
  if (!Number.isInteger(weekday)) throw new Error('Could not determine the New York weekday.');
  const today = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  // Tuesday/Wednesday prepare the coming NFL week. Thursday through Monday
  // stay on the current NFL week that began on Thursday.
  const delta = weekday === 2 || weekday === 3 ? 4 - weekday : -((weekday - 4 + 7) % 7);
  const thursday = today + delta * DAY_MS;
  return { startDay: thursday, endDay: thursday + 4 * DAY_MS };
}

export function selectWeeklySlates(lobby, now = Date.now()) {
  const groups = Array.isArray(lobby && lobby.DraftGroups) ? lobby.DraftGroups : [];
  const { startDay, endDay } = targetWeekWindow(now);
  const eligible = groups.filter(group => {
    const start = new Date(group.StartDate).getTime();
    if (!Number.isFinite(start)) return false;
    const localDay = nyDay(start);
    return String(group.Sport || '').toUpperCase() === 'NFL' && Number(group.ContestTypeId) === 21 &&
      Number(group.GameCount) > 1 && localDay >= startDay && localDay <= endDay;
  });
  if (!eligible.length) throw new Error('No NFL Classic multi-game salary pools were found for the target Thursday-through-Monday week.');

  // Read every Classic game set for the week so players from Thursday,
  // Sunday night and Monday are not lost when they are absent from the
  // Sunday 1 PM main slate. Start with the broadest group so its salary wins
  // if DraftKings exposes an overlapping player at different salaries.
  const unique = new Map();
  for (const group of eligible) {
    const id = Number(group.DraftGroupId);
    if (Number.isInteger(id) && id > 0 && !unique.has(id)) unique.set(id, group);
  }
  const selected = [...unique.values()].sort((a, b) =>
    Number(b.GameCount || 0) - Number(a.GameCount || 0) ||
    new Date(a.StartDate) - new Date(b.StartDate) ||
    String(a.ContestStartTimeSuffix || '').localeCompare(String(b.ContestStartTimeSuffix || ''))
  );
  if (!selected.length) throw new Error('The target NFL week had no valid DraftKings draft-group IDs.');
  return selected;
}

const playerKey = row => {
  const position = String(row.position || '').toUpperCase();
  const competition = row.competition || (Array.isArray(row.competitions) && row.competitions[0]) || {};
  return `${row.playerId || row.playerDkId || row.displayName}|${position}|${competition.competitionId || competition.name || ''}`;
};

export function mergeDraftablePayloads(entries) {
  const players = new Map();
  let salaryConflicts = 0;
  for (const entry of entries) {
    const raw = Array.isArray(entry && entry.payload && entry.payload.draftables) ? entry.payload.draftables : [];
    for (const row of raw) {
      const key = playerKey(row);
      const current = players.get(key);
      if (!current) {
        players.set(key, row);
      } else if (Number(current.salary) > 0 && Number(row.salary) > 0 && Number(current.salary) !== Number(row.salary)) {
        // Entries arrive broadest-slate first. Keep that canonical salary and
        // count the discrepancy rather than silently changing it later.
        salaryConflicts++;
      }
    }
  }
  return { draftables: [...players.values()], salaryConflicts };
}

const csvCell = value => {
  const s = String(value == null ? '' : value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function draftablesToCsv(payload, minimum = MIN_PLAYERS) {
  const raw = Array.isArray(payload && payload.draftables) ? payload.draftables : [];
  const players = new Map();
  for (const row of raw) {
    const position = String(row.position || '').toUpperCase();
    const competition = row.competition || (Array.isArray(row.competitions) && row.competitions[0]) || {};
    const key = playerKey(row);
    if (!players.has(key) && /^(QB|RB|WR|TE|DST)$/.test(position) && Number.isInteger(Number(row.salary)) && Number(row.salary) > 0) {
      players.set(key, { ...row, position, competition });
    }
  }
  const rows = [...players.values()];
  const positions = new Set(rows.map(row => row.position));
  if (rows.length < minimum) throw new Error(`Refusing to import ${rows.length} players; expected at least ${minimum}.`);
  for (const position of ['QB', 'RB', 'WR', 'TE', 'DST']) {
    if (!positions.has(position)) throw new Error(`Refusing to import a slate with no ${position} players.`);
  }

  const header = ['Position', 'Name + ID', 'Name', 'ID', 'Roster Position', 'Salary', 'Game Info', 'TeamAbbrev', 'AvgPointsPerGame'];
  const lines = rows.sort((a, b) => b.salary - a.salary || String(a.displayName).localeCompare(String(b.displayName))).map(row => {
    const id = row.playerDkId || row.playerId || row.draftableId;
    const roster = /^(RB|WR|TE)$/.test(row.position) ? `${row.position}/FLEX` : row.position;
    const stat = (Array.isArray(row.draftStatAttributes) ? row.draftStatAttributes : []).find(x => Number(x.id) === 90);
    return [row.position, `${row.displayName} (${id})`, row.displayName, id, roster, row.salary,
      row.competition.name || '', row.teamAbbreviation || '', stat ? stat.value : ''].map(csvCell).join(',');
  });
  return { csv: [header.join(','), ...lines, ''].join('\n'), rows };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'IronTuna-DraftKings-Salary-Importer/1.1' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}.`);
  return response.json();
}

export async function run(env = process.env, now = Date.now()) {
  const forcedId = String(env.INPUT_DRAFT_GROUP_ID || env.DRAFTKINGS_DRAFT_GROUP_ID || '').trim();
  const lobby = forcedId ? null : await getJson(LOBBY_URL);
  const slates = forcedId ? [{ DraftGroupId: Number(forcedId), GameCount: null, StartDate: null, ContestStartTimeSuffix: 'forced' }] : selectWeeklySlates(lobby, now);
  if (!slates.every(slate => Number.isInteger(Number(slate.DraftGroupId)) && Number(slate.DraftGroupId) > 0)) {
    throw new Error('A DraftKings draft group ID is invalid.');
  }

  const payloads = await Promise.all(slates.map(async slate => ({ slate, payload: await getJson(DRAFTABLES_URL(slate.DraftGroupId)) })));
  const merged = mergeDraftablePayloads(payloads);
  const converted = draftablesToCsv(merged, Number(env.MIN_DK_PLAYERS || MIN_PLAYERS));
  const dryRun = /^(1|true|yes)$/i.test(String(env.INPUT_DRY_RUN || ''));
  const result = {
    draftGroupIds: slates.map(slate => Number(slate.DraftGroupId)),
    groups: slates.length,
    maxGames: Math.max(...slates.map(slate => Number(slate.GameCount || 0))),
    players: converted.rows.length,
    salaryConflicts: merged.salaryConflicts,
    dryRun
  };
  if (dryRun) return result;

  const key = String(env.IRON_TUNA_ADMIN_KEY || '').trim();
  if (!key) throw new Error('IRON_TUNA_ADMIN_KEY is required unless dry-run is enabled.');
  const endpoint = new URL(env.IRON_TUNA_ADMIN_URL || 'https://irontuna.com/api/admin/dfs');
  endpoint.searchParams.set('key', key);
  const week = String(env.INPUT_WEEK || '').trim();
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    site: 'dk', csv: converted.csv, slate: 'weekly', source: 'draftkings-automation', ...(week ? { week: Number(week) } : {})
  }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.imported || body.imported.rows < MIN_PLAYERS) {
    throw new Error(`Iron Tuna import failed (HTTP ${response.status}): ${body.error || 'invalid response'}`);
  }
  return { ...result, imported: body.imported.rows, season: body.season, week: body.week };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(`DraftKings salary import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
