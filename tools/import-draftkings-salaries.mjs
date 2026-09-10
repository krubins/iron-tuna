#!/usr/bin/env node
// Download the nearest upcoming NFL Sunday 1 PM ET Classic main slate from
// DraftKings and pass it through Iron Tuna's existing admin CSV importer.

import { pathToFileURL } from 'url';

export const LOBBY_URL = 'https://www.draftkings.com/lobby/getcontests?sport=NFL';
export const DRAFTABLES_URL = id => `https://api.draftkings.com/draftgroups/v1/draftgroups/${id}/draftables`;
const MIN_PLAYERS = 40;

const nyParts = value => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date(value)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));

export function selectMainSlate(lobby, now = Date.now()) {
  const groups = Array.isArray(lobby && lobby.DraftGroups) ? lobby.DraftGroups : [];
  const eligible = groups.filter(group => {
    const p = nyParts(group.StartDate);
    return String(group.Sport || '').toUpperCase() === 'NFL' && Number(group.ContestTypeId) === 21 &&
      Number(group.GameCount) > 1 && p.weekday === 'Sun' && Number(p.hour) === 13 &&
      Number(p.minute) === 0 && new Date(group.StartDate).getTime() > now;
  });
  if (!eligible.length) throw new Error('No upcoming Sunday 1 PM ET NFL Classic slate was found.');

  // The main slate has no suffix. DraftKings also exposes Early Only and
  // Sun-Mon groups at 1 PM; prefer the unsuffixed group, then the most games.
  eligible.sort((a, b) => {
    const aMain = String(a.ContestStartTimeSuffix || '').trim() === '' ? 1 : 0;
    const bMain = String(b.ContestStartTimeSuffix || '').trim() === '' ? 1 : 0;
    return new Date(a.StartDate) - new Date(b.StartDate) || bMain - aMain ||
      Number(b.GameCount || 0) - Number(a.GameCount || 0);
  });
  return eligible[0];
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
    const key = `${row.playerId || row.playerDkId || row.displayName}|${position}|${competition.competitionId || competition.name || ''}`;
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
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'IronTuna-DraftKings-Salary-Importer/1.0' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}.`);
  return response.json();
}

export async function run(env = process.env, now = Date.now()) {
  const forcedId = String(env.INPUT_DRAFT_GROUP_ID || env.DRAFTKINGS_DRAFT_GROUP_ID || '').trim();
  const lobby = forcedId ? null : await getJson(LOBBY_URL);
  const slate = forcedId ? { DraftGroupId: Number(forcedId), GameCount: null, StartDate: null } : selectMainSlate(lobby, now);
  if (!Number.isInteger(Number(slate.DraftGroupId)) || Number(slate.DraftGroupId) <= 0) throw new Error('The DraftKings draft group ID is invalid.');

  const converted = draftablesToCsv(await getJson(DRAFTABLES_URL(slate.DraftGroupId)), Number(env.MIN_DK_PLAYERS || MIN_PLAYERS));
  const dryRun = /^(1|true|yes)$/i.test(String(env.INPUT_DRY_RUN || ''));
  const result = { draftGroupId: Number(slate.DraftGroupId), games: slate.GameCount, start: slate.StartDate, players: converted.rows.length, dryRun };
  if (dryRun) return result;

  const key = String(env.IRON_TUNA_ADMIN_KEY || '').trim();
  if (!key) throw new Error('IRON_TUNA_ADMIN_KEY is required unless dry-run is enabled.');
  const endpoint = new URL(env.IRON_TUNA_ADMIN_URL || 'https://irontuna.com/api/admin/dfs');
  endpoint.searchParams.set('key', key);
  const week = String(env.INPUT_WEEK || '').trim();
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    site: 'dk', csv: converted.csv, slate: 'main', source: 'draftkings-automation', ...(week ? { week: Number(week) } : {})
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
