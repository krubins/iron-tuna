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

// ── the single-game groups ─────────────────────────────────────────────────
// DraftKings prices a Showdown on a draft group of its own: one game, its own
// salaries, and a Captain seat at 1.5x. ContestTypeId 96 is Captain Mode;
// GameCount 1 is what makes it a single game. Both are required, because a
// GameCount of 1 on its own would also match formats that are not a Captain
// roster, and the validation in showdownCsv() below is what catches anything
// that slips through rather than storing a guess.
export const SHOWDOWN_CONTEST_TYPE_IDS = new Set([96]);
export const SHOWDOWN_MULTIPLIER = 1.5;
// DraftKings rounds a Captain price to the nearest hundred, so the ratio
// against the FLEX row is 1.5 give or take that rounding.
const SHOWDOWN_RATIO_MIN = 1.45, SHOWDOWN_RATIO_MAX = 1.55;
const SHOWDOWN_MIN_PLAYERS = 12;

export function selectShowdownSlates(lobby, now = Date.now()) {
  const groups = Array.isArray(lobby && lobby.DraftGroups) ? lobby.DraftGroups : [];
  const { startDay, endDay } = targetWeekWindow(now);
  const unique = new Map();
  for (const group of groups) {
    const start = new Date(group.StartDate).getTime();
    if (!Number.isFinite(start)) continue;
    const localDay = nyDay(start);
    if (String(group.Sport || '').toUpperCase() !== 'NFL') continue;
    if (!SHOWDOWN_CONTEST_TYPE_IDS.has(Number(group.ContestTypeId))) continue;
    if (Number(group.GameCount) !== 1) continue;
    if (localDay < startDay || localDay > endDay) continue;
    const id = Number(group.DraftGroupId);
    // One group per game. DraftKings posts several Showdown contests on the
    // same matchup and they share a draft group, but if two ever differ the
    // earliest-starting one is the one the lobby leads with.
    if (Number.isInteger(id) && id > 0 && !unique.has(id)) unique.set(id, group);
  }
  return [...unique.values()].sort((a, b) => new Date(a.StartDate) - new Date(b.StartDate) || Number(a.DraftGroupId) - Number(b.DraftGroupId));
}

// One single-game group's draftables as the CSV the lobby would have exported.
//
// WHICH ROW IS THE CAPTAIN. A Showdown group lists every player twice, once per
// seat, at two prices. Nothing in this file knows DraftKings' roster-slot ids,
// so the seat is read off the PRICE, which is the same rule the worker already
// applies to a file whose Roster Position column is missing: "the cheaper row
// is the FLEX price: the multiplier seat costs more by construction on both
// sites." The ratio between the two is then checked against the 1.5x
// DraftKings actually charges, and a group that does not hold to it is
// REFUSED rather than stored — a Captain priced from a guess is a roster
// nobody can enter, which is the whole reason the desk refused these files
// until the slate column existed.
export function showdownCsv(payload, minimum = SHOWDOWN_MIN_PLAYERS) {
  const raw = Array.isArray(payload && payload.draftables) ? payload.draftables : [];
  const byPlayer = new Map();
  for (const row of raw) {
    const position = String(row.position || '').toUpperCase();
    if (!/^(QB|RB|WR|TE|K|DST)$/.test(position)) continue;
    const salary = Number(row.salary);
    if (!Number.isInteger(salary) || salary <= 0) continue;
    const competition = row.competition || (Array.isArray(row.competitions) && row.competitions[0]) || {};
    const id = row.playerId || row.playerDkId || row.displayName;
    const key = `${id}|${position}`;
    if (!byPlayer.has(key)) byPlayer.set(key, { rows: [], position, competition, displayName: row.displayName, team: row.teamAbbreviation, fppg: draftableFppg(row), id: row.playerDkId || row.playerId || row.draftableId });
    const p = byPlayer.get(key);
    if (!p.rows.some(r => Number(r.salary) === salary)) p.rows.push(row);
    if (p.fppg == null) p.fppg = draftableFppg(row);
  }
  const players = [...byPlayer.values()];
  if (!players.length) throw new Error('That draft group listed no priced players.');
  const odd = players.filter(p => p.rows.length !== 2);
  if (odd.length) throw new Error(`Refusing a single-game group where ${odd.length} of ${players.length} players are not priced at exactly two salaries; the Captain seat cannot be identified.`);
  const teams = [...new Set(players.map(p => String(p.team || '').toUpperCase()).filter(Boolean))];
  if (teams.length !== 2) throw new Error(`Refusing a single-game group naming ${teams.length} clubs rather than two.`);
  if (players.length < minimum) throw new Error(`Refusing to import ${players.length} players from a single-game group; expected at least ${minimum}.`);
  const seats = players.map(p => {
    const sorted = p.rows.slice().sort((a, b) => Number(a.salary) - Number(b.salary));
    return { ...p, flex: Number(sorted[0].salary), cpt: Number(sorted[1].salary) };
  });
  const off = seats.filter(p => {
    const ratio = p.cpt / p.flex;
    return !(ratio >= SHOWDOWN_RATIO_MIN && ratio <= SHOWDOWN_RATIO_MAX);
  });
  if (off.length) throw new Error(`Refusing a single-game group where ${off.length} of ${seats.length} players are not priced at about ${SHOWDOWN_MULTIPLIER}x between their two seats; this is not a Captain Mode pool.`);

  const header = ['Position', 'Name + ID', 'Name', 'ID', 'Roster Position', 'Salary', 'Game Info', 'TeamAbbrev', 'AvgPointsPerGame'];
  const lines = [];
  // The worker parses "AWAY@HOME ..." with no spaces; the lobby writes
  // "BUF @ NYJ". Normalized here rather than in draftablesToCsv(), which feeds
  // the Classic import and is left exactly as it is.
  const gameInfo = p => String(p.competition.name || '').replace(/\s*@\s*/, '@');
  for (const p of seats.sort((a, b) => b.cpt - a.cpt || String(a.displayName).localeCompare(String(b.displayName)))) {
    for (const [seat, salary] of [['CPT', p.cpt], ['FLEX', p.flex]]) {
      lines.push([p.position, `${p.displayName} (${p.id})`, p.displayName, p.id, seat, salary,
        gameInfo(p), p.team || '', p.fppg == null ? '' : p.fppg].map(csvCell).join(','));
    }
  }
  return { csv: [header.join(','), ...lines, ''].join('\n'), players: seats.length, rows: lines.length, teams: teams.slice().sort(), game: teams.slice().sort().join('|') };
}

const playerKey = row => {
  const position = String(row.position || '').toUpperCase();
  const competition = row.competition || (Array.isArray(row.competitions) && row.competitions[0]) || {};
  return `${row.playerId || row.playerDkId || row.displayName}|${position}|${competition.competitionId || competition.name || ''}`;
};

// DraftKings' season average rides in draftStatAttributes as stat 90. The
// value is a display string and can be blank or a dash for a player the
// lobby has not averaged yet; sortValue carries the same number where value
// is formatted. Either way a non-number is "none", never zero.
export function draftableFppg(row) {
  const stat = (Array.isArray(row && row.draftStatAttributes) ? row.draftStatAttributes : []).find(x => Number(x.id) === 90);
  if (!stat) return null;
  for (const v of [stat.value, stat.sortValue]) {
    const text = String(v == null ? '' : v).trim();
    if (text && Number.isFinite(Number(text))) return Number(text);
  }
  return null;
}

export function mergeDraftablePayloads(entries) {
  const players = new Map();
  let salaryConflicts = 0, fppgBackfilled = 0;
  for (const entry of entries) {
    const raw = Array.isArray(entry && entry.payload && entry.payload.draftables) ? entry.payload.draftables : [];
    for (const row of raw) {
      const key = playerKey(row);
      const current = players.get(key);
      if (!current) {
        players.set(key, row);
        continue;
      }
      if (Number(current.salary) > 0 && Number(row.salary) > 0 && Number(current.salary) !== Number(row.salary)) {
        // Entries arrive broadest-slate first. Keep that canonical salary and
        // count the discrepancy rather than silently changing it later.
        salaryConflicts++;
      }
      // The row that won the merge keeps its salary, but a stat block it
      // came without is taken from any later slate that has one, so a player
      // priced on several slates is not left without an average because the
      // broadest payload happened to omit it.
      if (draftableFppg(current) == null && draftableFppg(row) != null) {
        players.set(key, { ...current, draftStatAttributes: row.draftStatAttributes });
        fppgBackfilled++;
      }
    }
  }
  return { draftables: [...players.values()], salaryConflicts, fppgBackfilled };
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
  let fppgRows = 0;
  const lines = rows.sort((a, b) => b.salary - a.salary || String(a.displayName).localeCompare(String(b.displayName))).map(row => {
    const id = row.playerDkId || row.playerId || row.draftableId;
    const roster = /^(RB|WR|TE)$/.test(row.position) ? `${row.position}/FLEX` : row.position;
    const fppg = draftableFppg(row);
    if (fppg != null) fppgRows++;
    return [row.position, `${row.displayName} (${id})`, row.displayName, id, roster, row.salary,
      row.competition.name || '', row.teamAbbreviation || '', fppg == null ? '' : fppg].map(csvCell).join(',');
  });
  return { csv: [header.join(','), ...lines, ''].join('\n'), rows, fppgRows };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'IronTuna-DraftKings-Salary-Importer/1.1' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}.`);
  return response.json();
}

export async function githubOidcToken(env) {
  const requestUrl = String(env.ACTIONS_ID_TOKEN_REQUEST_URL || '');
  const requestToken = String(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || '');
  if (!requestUrl || !requestToken) throw new Error('GitHub Actions OIDC credentials are unavailable.');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', 'iron-tuna-dfs-import');
  const response = await fetch(url, { headers: { authorization: `Bearer ${requestToken}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.value) throw new Error('GitHub Actions could not issue an identity token.');
  return body.value;
}

export async function run(env = process.env, now = Date.now()) {
  const forcedId = String(env.INPUT_DRAFT_GROUP_ID || env.DRAFTKINGS_DRAFT_GROUP_ID || '').trim();
  const lobby = forcedId ? null : await getJson(LOBBY_URL);
  const slates = forcedId ? [{ DraftGroupId: Number(forcedId), GameCount: null, StartDate: null, ContestStartTimeSuffix: 'forced' }] : selectWeeklySlates(lobby, now);
  if (!slates.every(slate => Number.isInteger(Number(slate.DraftGroupId)) && Number(slate.DraftGroupId) > 0)) {
    throw new Error('A DraftKings draft group ID is invalid.');
  }

  // The single-game groups for the same week. Discovery failing must not stop
  // the Classic import, so it is caught here rather than allowed to throw: a
  // lobby that lists none is a normal week, not an error.
  let showdownSlates = [];
  try { showdownSlates = forcedId ? [] : selectShowdownSlates(lobby, now); } catch (e) { showdownSlates = []; }
  const payloads = await Promise.all(slates.map(async slate => ({ slate, payload: await getJson(DRAFTABLES_URL(slate.DraftGroupId)) })));
  // One draftables call per single-game group. A group whose payload will not
  // load is dropped here and reported by the loop below as a skip.
  const showdownPayloads = new Map();
  await Promise.all(showdownSlates.map(async g => {
    try { showdownPayloads.set(Number(g.DraftGroupId), await getJson(DRAFTABLES_URL(g.DraftGroupId))); }
    catch (e) { showdownPayloads.set(Number(g.DraftGroupId), null); }
  }));
  const merged = mergeDraftablePayloads(payloads);
  const converted = draftablesToCsv(merged, Number(env.MIN_DK_PLAYERS || MIN_PLAYERS));
  const dryRun = /^(1|true|yes)$/i.test(String(env.INPUT_DRY_RUN || ''));
  const result = {
    draftGroupIds: slates.map(slate => Number(slate.DraftGroupId)),
    groups: slates.length,
    maxGames: Math.max(...slates.map(slate => Number(slate.GameCount || 0))),
    players: converted.rows.length,
    fppgPlayers: converted.fppgRows,
    fppgBackfilled: merged.fppgBackfilled,
    salaryConflicts: merged.salaryConflicts,
    dryRun,
    showdownGroups: showdownSlates.map(g => ({ id: Number(g.DraftGroupId), label: String(g.ContestStartTimeSuffix || '').trim(), start: g.StartDate }))
  };
  if (dryRun) {
    // Discovery and validation, without posting anything. This is how a real
    // Showdown payload gets inspected before the first live import: run the
    // workflow with dry_run and read what each group validated to.
    result.showdown = { groups: showdownSlates.length, imported: [], skipped: [] };
    for (const group of showdownSlates) {
      const id = Number(group.DraftGroupId);
      try {
        const built = showdownCsv(showdownPayloads.get(id), Number(env.MIN_DK_SHOWDOWN_PLAYERS || SHOWDOWN_MIN_PLAYERS));
        result.showdown.imported.push({ game: built.game, players: built.players, rows: built.rows, dryRun: true });
      } catch (e) {
        result.showdown.skipped.push({ group: id, label: String(group.ContestStartTimeSuffix || '').trim(), reason: (e && e.message) || 'failed' });
      }
    }
    return result;
  }

  const endpoint = new URL(env.IRON_TUNA_ADMIN_URL || 'https://irontuna.com/api/admin/dfs');
  const identityToken = await githubOidcToken(env);
  const week = String(env.INPUT_WEEK || '').trim();
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${identityToken}` }, body: JSON.stringify({
    site: 'dk', csv: converted.csv, slate: 'weekly', source: 'draftkings-automation', ...(week ? { week: Number(week) } : {})
  }) });
  const body = await response.json().catch(() => ({}));
  // THE FIELD IS `stored`, NOT `rows`. dfsStore() has always answered
  // { ok, stored, ... } and this guard has always read `.rows`, so it compared
  // `undefined < MIN_PLAYERS` — false — and passed every import, including one
  // that saved nothing. The same misreading emptied the line below: `imported`
  // was undefined, JSON.stringify dropped it, and the workflow log showed how
  // many players were FETCHED from DraftKings with no mention of how many
  // reached the table. An unattended job that cannot fail is not a safe job.
  const stored = body.imported && Number(body.imported.stored);
  const attempted = body.imported && Number(body.imported.attempted);
  if (!response.ok || !body.ok || !body.imported || !Number.isFinite(stored) || stored < MIN_PLAYERS) {
    throw new Error(`Iron Tuna import failed (HTTP ${response.status}): ${body.error || (body.imported ? `stored ${stored} rows` : 'invalid response')}`);
  }
  // A partial write is its own failure: the board would be served a slate
  // missing whichever players the dropped statements carried, which reads as
  // a thin lobby rather than as a broken import.
  if (Number.isFinite(attempted) && stored < attempted) {
    throw new Error(`Iron Tuna stored ${stored} of ${attempted} rows; the slate would be incomplete.`);
  }
  const out = { ...result, imported: stored, attempted, season: body.season, week: body.week };

  // ── the single-game slates ───────────────────────────────────────────────
  // After the Classic import, never instead of it. The main board is what
  // every reader is served and what the rest of the site reads; a Showdown
  // group that will not parse must not be able to take that down, so each one
  // is imported on its own and a failure is RECORDED rather than thrown. The
  // function still throws for a broken Classic import above, which is the one
  // failure worth failing the job for.
  //
  // Each group is posted with no `slate`: the worker derives the key from the
  // two clubs the file itself prices, so this side cannot misfile one game's
  // salaries under another even if the lobby's naming changes.
  const showdown = { groups: showdownSlates.length, imported: [], skipped: [] };
  for (const group of showdownSlates) {
    const id = Number(group.DraftGroupId);
    const label = String(group.ContestStartTimeSuffix || '').trim() || `draft group ${id}`;
    try {
      const built = showdownCsv(showdownPayloads.get(id), Number(env.MIN_DK_SHOWDOWN_PLAYERS || SHOWDOWN_MIN_PLAYERS));
      if (dryRun) { showdown.imported.push({ game: built.game, players: built.players, rows: built.rows, dryRun: true }); continue; }
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${identityToken}` }, body: JSON.stringify({
        site: 'dk', csv: built.csv, source: 'draftkings-automation', ...(week ? { week: Number(week) } : {})
      }) });
      const rb = await r.json().catch(() => ({}));
      const st = rb.imported && Number(rb.imported.stored);
      const at = rb.imported && Number(rb.imported.attempted);
      if (!r.ok || !rb.ok || !Number.isFinite(st) || st < 1) throw new Error(rb.error ? `${rb.error}: ${rb.note || ''}`.trim() : `HTTP ${r.status}`);
      if (Number.isFinite(at) && st < at) throw new Error(`stored ${st} of ${at} rows`);
      showdown.imported.push({ game: rb.imported.slate ? String(rb.imported.slate).replace(/^sd:/, '') : built.game, players: built.players, rows: st });
    } catch (e) {
      showdown.skipped.push({ group: id, label, reason: (e && e.message) || 'failed' });
    }
  }
  out.showdown = showdown;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(`DraftKings salary import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
