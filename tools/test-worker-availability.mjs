#!/usr/bin/env node
// Tests for the live availability list inside _worker.js (HANDOFF.md §48).
//   node tools/test-worker-availability.mjs
//
// The 11:00Z cron pulls ESPN's public injury report, reduces it to board
// players on a reserve list, stores that as row 3 of odds_overlay, and the
// request path serves the UNION of the committed AVAILABILITY block and that
// row. Like tools/test-worker-odds.mjs this lifts the real Vegas section out
// of _worker.js by locating its markers and evaluates it against stub
// PROJECTIONS, so what runs here is the worker's own code, not a copy. It
// finishes against the live ESPN feed and skips that block cleanly when the
// network is not there.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── lift the section out of the worker ─────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const START = '// Vegas-weighted projections';
const s = src.indexOf(START);
const e = src.indexOf('export default {', s);
if (s < 0 || e < 0) { console.error('FAIL: could not locate the Vegas section in _worker.js'); process.exit(1); }
const section = src.slice(s, e);

const harness = new Function('PROJECTIONS', '_xb64encode', 'PROJ_KEY', 'fetch', `
  let _PROJ_ENC = null;
  ${section}
  return { AVAILABILITY, AVAILABILITY_GAMES, AVAIL_MIN_MATCHED, AVAIL_MIN_TEAMS, AVAIL_MIN_GAMES, AVAIL_RESERVE_MIN,
           AVAIL_FEED_URL, _oddsNorm, _oddsRound, _availF, _availStatusOf, _availKickoff, _availGamesOut,
           _availBoardIndex, buildAvailabilityOverlay, availabilityMerge, availabilityTable, _availTable,
           _availFactor, _availRowFactor, applyAvailability, blendProjections, _withAvailability, _availPool,
           availabilityCacheRead, availabilityCacheWrite, runAvailabilityRefresh, availabilityReport,
           fetchInjuriesEspn, oddsCacheRead, projectionsPayload, boardPayload, buildTeamEnvOverlay,
           buildVegasBoard, VEGAS_WEIGHT,
           get encoded() { return _PROJ_ENC; } };
`);
const noNet = async () => { throw new Error('no network in tests'); };

// ── the committed block, as the worker itself carries it ───────────────────
// Stub players are built off REAL committed keys so the "both list him" path
// runs against whatever tools/availability.json says today, not a frozen copy.
const probe = harness([], () => 'ENC', 'k', noNet);
const G = probe.AVAILABILITY_GAMES;
const committedKeys = Object.keys(probe.AVAILABILITY);
const partialKey = committedKeys.find(k => probe.AVAILABILITY[k].gamesOut > 0 && probe.AVAILABILITY[k].gamesOut < G);
const seasonKey = committedKeys.find(k => probe.AVAILABILITY[k].gamesOut >= G);
if (!partialKey || !seasonKey) { console.error('FAIL: the committed block needs one partial and one out-for-season entry for these tests'); process.exit(1); }
const partial = probe.AVAILABILITY[partialKey], season = probe.AVAILABILITY[seasonKey];
const fPartial = 1 - partial.gamesOut / G;
// A normalized key maps back onto a name that normalizes to itself.
const nameOf = k => k.split('|')[0], posOf = k => k.split('|')[1];

// Rows for committed players are ALREADY pro-rated in the worker (that is what
// tools/apply-availability.mjs does), so the stub carries the same convention:
// the partial player's row is season x fPartial, the season player's row is zero.
const FULL = { rushYd: 1000, rushTD: 8, rec: 40, recYd: 300, recTD: 2, fumLost: 0 };
const scaleRow = (row, f) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Math.round(v * f * 10) / 10]));
const STUB = [
  { name: 'Healthy Back', position: 'RB', team: 'AAA', projectedStats: { ...FULL } },
  { name: 'Fresh Injury', position: 'WR', team: 'BBB', projectedStats: { rec: 80, recYd: 1200, recTD: 8, rushYd: 20, rushTD: 0, fumLost: 1 } },
  { name: 'Kicker Man', position: 'K', team: 'CCC', projectedStats: { xpMade: 40, fgMade: 30 } },
  { name: "D'Andre Suffix Jr.", position: 'TE', team: 'DDD', projectedStats: { rec: 50, recYd: 600, recTD: 4 } },
  { name: 'Two Ways', position: 'RB', team: 'EEE', projectedStats: { rushYd: 500, rushTD: 3, rec: 10, recYd: 80, recTD: 1 } },
  { name: 'Two Ways', position: 'WR', team: 'EEE', projectedStats: { rec: 30, recYd: 400, recTD: 2 } },
  { name: 'Other Position', position: 'RB', team: 'FFF', projectedStats: { rushYd: 700, rushTD: 5 } },
  { name: 'Dup Name', position: 'RB', team: 'III', projectedStats: { rushYd: 400, rushTD: 2 } },
  { name: 'Dup Name', position: 'RB', team: 'JJJ', projectedStats: { rushYd: 300, rushTD: 1 } },
  { name: nameOf(partialKey), position: posOf(partialKey), team: 'GGG', projectedStats: scaleRow(FULL, fPartial) },
  { name: nameOf(seasonKey), position: posOf(seasonKey), team: 'HHH', projectedStats: scaleRow(FULL, 0) }
];
const W = harness(STUB, str => 'ENC:' + str.length, 'k', noNet);

// ── a stub feed in ESPN's shape ────────────────────────────────────────────
const YEAR = 2026;
const kickoff = W._availKickoff(YEAR);
const day = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const entry = (name, pos, status, fantasy, ret, extra = {}) => ({
  status, shortComment: extra.short || `${name} (${extra.type || 'knee'}) was placed on the list.`,
  longComment: extra.long || '',
  athlete: { displayName: name, position: { abbreviation: pos } },
  details: { fantasyStatus: fantasy ? { abbreviation: fantasy, description: fantasy } : undefined,
             type: extra.type || 'Knee', returnDate: ret }
});
const feedOf = (entries, teams = 32) => ({
  timestamp: '2026-09-02T15:22:53Z', season: { year: YEAR },
  injuries: Array.from({ length: teams }, (_, i) => ({ id: String(i + 1), displayName: 'Team ' + (i + 1), injuries: i === 0 ? entries : [] }))
});

console.log('\nkickoff arithmetic');
{
  ok('2026 kicks off Thursday, September 10', iso(W._availKickoff(2026)) === '2026-09-10', iso(W._availKickoff(2026)));
  ok('2025 kicks off Thursday, September 4', iso(W._availKickoff(2025)) === '2025-09-04', iso(W._availKickoff(2025)));
  ok('2024 kicks off Thursday, September 5', iso(W._availKickoff(2024)) === '2024-09-05', iso(W._availKickoff(2024)));
}

console.log('\nstatus mapping on a stub feed');
{
  const built = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day)),                       // Week 5 Sunday
    entry('Fresh Injury', 'WR', 'Injured Reserve', 'IR', '2027-02-15', { type: 'Knee - ACL' }),
    entry("D'Andre Suffix Jr.", 'TE', 'Out', 'PUP-R', iso(kickoff + 31 * day), { type: 'Neck' }),
    entry('Kicker Man', 'PK', 'Out', 'NFI-R', iso(kickoff + 38 * day), { type: 'Undisclosed' }),
    entry('Other Position', 'RB', 'Out', 'RESERVE-CEL', iso(kickoff + 17 * day), { type: 'Personal' })     // Week 3
  ]));
  const P = built.players;
  ok('teams and entries are counted', built.teams === 32 && built.entries === 5);
  ok('every board player on a reserve list is matched', built.matched === 5, JSON.stringify(Object.keys(P)));
  ok('IR with a return designation maps to IR at the four-game floor',
    P['healthyback|RB'] && P['healthyback|RB'].status === 'IR' && P['healthyback|RB'].gamesOut === 4, JSON.stringify(P['healthyback|RB']));
  ok('a return date past the season is out for the year',
    P['freshinjury|WR'] && P['freshinjury|WR'].status === 'IR' && P['freshinjury|WR'].gamesOut === G, JSON.stringify(P['freshinjury|WR']));
  ok('reserve/PUP maps to PUP', P['dandresuffix|TE'] && P['dandresuffix|TE'].status === 'PUP' && P['dandresuffix|TE'].gamesOut === 4);
  ok('a suffix and an apostrophe still match the board', !!P['dandresuffix|TE']);
  ok("ESPN's PK is the board's K, and reserve/NFI maps to NFI",
    P['kickerman|K'] && P['kickerman|K'].status === 'NFI' && P['kickerman|K'].gamesOut === 5, JSON.stringify(P['kickerman|K']));
  ok('the exempt list maps to Exempt with the weeks the feed gives',
    P['otherposition|RB'] && P['otherposition|RB'].status === 'Exempt' && P['otherposition|RB'].gamesOut === 2, JSON.stringify(P['otherposition|RB']));
  ok('entries carry name, position, team, note and source in the file\'s shape',
    Object.values(P).every(p => p.name && p.position && p.team && typeof p.note === 'string' && /ESPN injury feed 2026-09-02/.test(p.source) && p.asOf === '2026-09-02'));
  ok('the injury type prefixes the note, boilerplate types do not',
    /^Knee - ACL: /.test(P['freshinjury|WR'].note) && !/^Undisclosed/.test(P['kickerman|K'].note) && !/^Personal/.test(P['otherposition|RB'].note),
    P['freshinjury|WR'].note + ' | ' + P['kickerman|K'].note);
  ok('the feed timestamp is the asOf', built.asOf === '2026-09-02T15:22:53.000Z', built.asOf);
}
{
  const built = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Questionable', 'QUESTIONABLE', iso(kickoff + 3 * day)),
    entry('Fresh Injury', 'WR', 'Doubtful', 'DOUBTFUL', iso(kickoff + 3 * day)),
    entry('Kicker Man', 'PK', 'Probable', 'PROBABLE', iso(kickoff + 3 * day)),
    entry("D'Andre Suffix Jr.", 'TE', 'Day-To-Day', undefined, iso(kickoff + 3 * day)),
    entry('Other Position', 'RB', 'Active', undefined, undefined),
    entry('Two Ways', 'RB', 'Out', 'PUP-P', iso(kickoff + 3 * day))                 // active/PUP: can be activated any day
  ]));
  ok('week-to-week statuses map to nothing', built.matched === 0 && built.skipped.weekToWeek === 6, JSON.stringify(built.skipped));
}
{
  const built = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Suspension', 'RESERVE-SUS', iso(kickoff + 10 * day)),   // back for Week 2: one game
    entry('Fresh Injury', 'WR', 'Out', undefined, iso(kickoff + 10 * day)),              // plain Out, one game
    entry('Kicker Man', 'PK', 'Out', undefined, undefined),                              // plain Out, nothing to go on
    entry('Other Position', 'RB', 'Out', 'RESERVE-CEL', iso(kickoff - 2 * day))          // exempt but back before kickoff
  ]));
  ok('a one-game absence is not a season line change', built.matched === 0 && built.skipped.short === 4, JSON.stringify(built.skipped));
  const built2 = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Suspension', 'RESERVE-SUS', iso(kickoff + 24 * day), { short: 'The NFL suspended Back three games.' }),
    entry('Fresh Injury', 'WR', 'Out', undefined, iso(kickoff + 24 * day))
  ]));
  ok('a three-game suspension is Suspended, 3',
    built2.players['healthyback|RB'] && built2.players['healthyback|RB'].status === 'Suspended' && built2.players['healthyback|RB'].gamesOut === 3,
    JSON.stringify(built2.players['healthyback|RB']));
  ok('a plain multi-week Out is kept with the weeks the feed gives',
    built2.players['freshinjury|WR'] && built2.players['freshinjury|WR'].status === 'Out' && built2.players['freshinjury|WR'].gamesOut === 3);
}
{
  const built = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Injured Reserve', 'IR', undefined, { short: 'Back tore his ACL and is out for the season.' }),
    entry('Fresh Injury', 'WR', 'Injured Reserve', 'IR-R', undefined),
    entry('Kicker Man', 'PK', 'Injured Reserve', 'IR-R', iso(kickoff + 10 * day))       // a date inside the floor
  ]));
  ok('a season-ending comment is out for the year even without a date', built.players['healthyback|RB'].gamesOut === G);
  ok('IR with no date at all sits at the four-game floor', built.players['freshinjury|WR'].gamesOut === W.AVAIL_RESERVE_MIN);
  ok('IR never goes below the floor whatever the date says', built.players['kickerman|K'].gamesOut === W.AVAIL_RESERVE_MIN);
  const opener = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day), { short: 'Back will miss the season opener and three more.' })
  ]));
  ok('a comment about the season opener does not zero a line', opener.players['healthyback|RB'].gamesOut === 4);
}

console.log('\nmatching');
{
  const built = W.buildAvailabilityOverlay(feedOf([
    entry('Nobody At All', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day)),
    entry('Other Position', 'WR', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day)),   // board has him at RB
    entry('Dup Name', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day)),         // same name AND position twice on the board
    entry('HEALTHY  BACK', 'rb', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day))     // case and spacing
  ]));
  ok('an unknown player is skipped', !built.players['nobodyatall|RB'] && built.skipped.unlisted >= 1);
  ok('position must match, not just the name', !built.players['otherposition|WR'] && !built.players['otherposition|RB']);
  ok('an ambiguous name is dropped, not guessed', !built.players['dupname|RB']);
  ok('normalization matches on case and spacing', !!built.players['healthyback|RB']);
  ok('matched counts only what landed', built.matched === 1, String(built.matched));
  const idx = W._availBoardIndex();
  ok('the board index carries name, position and team', idx.get('healthyback|RB').team === 'AAA' && idx.get('dupname|RB') === null);
  ok('the same name at two positions is two players, not an ambiguity', idx.get('twoways|RB') && idx.get('twoways|WR'));
}
{
  // Two feed entries for one man: the longer absence stands.
  const built = W.buildAvailabilityOverlay(feedOf([
    entry('Healthy Back', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day)),
    entry('Healthy Back', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 60 * day))
  ]));
  ok('duplicate entries keep the longer absence', built.players['healthyback|RB'].gamesOut === 8, String(built.players['healthyback|RB'].gamesOut));
}

console.log('\nunion: committed block + live row');
{
  const committed = { 'a|RB': { status: 'IR', gamesOut: 6, note: 'hand', asOf: '2026-09-02' },
                      'b|WR': { status: 'IR', gamesOut: G, note: 'hand', asOf: '2026-09-02' },
                      'c|TE': { status: 'PUP', gamesOut: 4, note: 'hand', asOf: '2026-09-02' } };
  const live = { 'a|RB': { status: 'Exempt', gamesOut: 2, note: 'feed', source: 'ESPN', asOf: '2026-09-05' },
                 'c|TE': { status: 'IR', gamesOut: 9, note: 'feed', source: 'ESPN', asOf: '2026-09-05' },
                 'd|QB': { status: 'IR', gamesOut: 4, note: 'feed', source: 'ESPN', asOf: '2026-09-05' } };
  const m = W.availabilityMerge(committed, live);
  ok('a committed entry the feed no longer lists survives (no automatic reinstatement)', m['b|WR'] && m['b|WR'].gamesOut === G && !m['b|WR'].live);
  ok('a live-only player is added', m['d|QB'] && m['d|QB'].live && m['d|QB'].gamesOut === 4 && m['d|QB'].committedGamesOut === 0);
  ok('live wins on status, note, source and asOf when both list him',
    m['a|RB'].status === 'Exempt' && m['a|RB'].note === 'feed' && m['a|RB'].source === 'ESPN' && m['a|RB'].asOf === '2026-09-05' && m['a|RB'].live);
  ok('...but games out never drops below the committed number (that is a hand edit)', m['a|RB'].gamesOut === 6);
  ok('live wins on games out when it says more', m['c|TE'].gamesOut === 9 && m['c|TE'].status === 'IR');
  ok('every entry records what the committed row already carries',
    m['a|RB'].committedGamesOut === 6 && m['b|WR'].committedGamesOut === G && m['c|TE'].committedGamesOut === 4);
  ok('a null live row is the committed block', Object.keys(W.availabilityMerge(committed, null)).length === 3);
  ok('the merge never edits its inputs', committed['a|RB'].gamesOut === 6 && !('committedGamesOut' in committed['a|RB']));
}

console.log('\nthe pro-rating is applied once');
{
  // No live row loaded: the table is the committed block.
  const t = W._availTable();
  ok('the default table is the committed block', Object.keys(t).length === committedKeys.length && t[partialKey].committedGamesOut === partial.gamesOut);
  ok('a committed row already carries its factor, so its row factor is 1', W._availRowFactor(partialKey) === 1 && W._availRowFactor(seasonKey) === 1);
  ok('the market factor is the whole factor', near(W._availFactor(partialKey), fPartial) && W._availFactor(seasonKey) === 0);
  const pool = W.blendProjections(null);
  const pp = pool.find(p => p.name === nameOf(partialKey));
  const orig = STUB.find(p => p.name === nameOf(partialKey));
  ok('a committed row is passed through by reference, status attached',
    pp.projectedStats === orig.projectedStats && pp.status === partial.status && pp.gamesOut === partial.gamesOut);
  ok('an unlisted row is untouched and unbadged', pool.find(p => p.name === 'Healthy Back') === STUB[0]);
  // The overlay side: a full-season market line for the committed player is scaled by the whole factor, once.
  const ov = W.applyAvailability({ [partialKey]: { rushYd: 1000 }, 'healthyback|RB': { rushYd: 1000 } });
  ok('applyAvailability scales a listed player\'s market line by his factor', near(ov[partialKey].rushYd, W._oddsRound(1000 * fPartial)));
  ok('...and leaves an unlisted player alone', ov['healthyback|RB'].rushYd === 1000);
  const blended = W.blendProjections(ov).find(p => p.name === nameOf(partialKey));
  // committed row (already x f) blended 1:3 with the market line (x f) = the full-season blend x f.
  const expect = W._oddsRound((orig.projectedStats.rushYd + W.VEGAS_WEIGHT * ov[partialKey].rushYd) / (1 + W.VEGAS_WEIGHT));
  ok('the blend of two pro-rated lines is pro-rated once', near(blended.projectedStats.rushYd, expect), `${blended.projectedStats.rushYd} vs ${expect}`);
  ok('an out-for-season market line is zeroed', W.applyAvailability({ [seasonKey]: { rushYd: 1000 } })[seasonKey].rushYd === 0);
}
{
  // Now load a live row: the committed partial goes from his committed number to more,
  // and a fresh injury the file never saw comes in from the feed.
  const more = Math.min(G, partial.gamesOut + 4);
  const liveRow = { asOf: '2026-09-05', players: {
    [partialKey]: { name: nameOf(partialKey), position: posOf(partialKey), team: 'GGG', status: 'IR', gamesOut: more, note: 'feed', source: 'ESPN', asOf: '2026-09-05' },
    'freshinjury|WR': { name: 'Fresh Injury', position: 'WR', team: 'BBB', status: 'IR', gamesOut: 4, note: 'feed', source: 'ESPN', asOf: '2026-09-05' }
  } };
  const db = mockDb({ 3: { payload: JSON.stringify(liveRow), provider: 'espn-injuries', matched: 2, updated_at: Date.now() } });
  const L = harness(STUB, str => 'ENC', 'k', noNet);
  await L.availabilityTable({ LEADS_DB: db });
  const t = L._availTable();
  ok('the live row is unioned into the table', t['freshinjury|WR'] && t['freshinjury|WR'].live && t[partialKey].gamesOut === more && t[seasonKey] && !t[seasonKey].live);
  const fMore = 1 - more / G, fFresh = 1 - 4 / G;
  ok('a live-only player\'s row factor is his whole factor', near(L._availRowFactor('freshinjury|WR'), fFresh));
  ok('a committed player who lost more games gets only the DIFFERENCE on his row',
    near(L._availRowFactor(partialKey), Math.min(1, fMore / fPartial)), String(L._availRowFactor(partialKey)));
  ok('...and the whole factor on the market side', near(L._availFactor(partialKey), fMore));
  const pool = L.blendProjections(null);
  const fresh = pool.find(p => p.name === 'Fresh Injury');
  ok('a fresh injury\'s committed (full-season) row is pro-rated on the way out',
    near(fresh.projectedStats.recYd, L._oddsRound(1200 * fFresh)) && fresh.status === 'IR' && fresh.gamesOut === 4 && fresh.note === 'feed',
    JSON.stringify(fresh.projectedStats));
  const pp = pool.find(p => p.name === nameOf(partialKey));
  const orig = STUB.find(p => p.name === nameOf(partialKey));
  ok('the committed partial\'s row is re-rated by the difference, landing on season x new factor',
    near(pp.projectedStats.rushYd, L._oddsRound(orig.projectedStats.rushYd * Math.min(1, fMore / fPartial))) &&
    Math.abs(pp.projectedStats.rushYd - 1000 * fMore) <= 1.5,
    `${pp.projectedStats.rushYd} vs ${1000 * fMore}`);
  // Blend a full-season market line over the fresh injury: both sides x f, once.
  const ov = L.applyAvailability({ 'freshinjury|WR': { recYd: 1600 } });
  const b = L.blendProjections(ov).find(p => p.name === 'Fresh Injury');
  const full = (1200 + L.VEGAS_WEIGHT * 1600) / (1 + L.VEGAS_WEIGHT);
  ok('blend(fresh) == full-season blend x factor, within rounding', Math.abs(b.projectedStats.recYd - full * fFresh) <= 1.0, `${b.projectedStats.recYd} vs ${full * fFresh}`);
  ok('the vegas evidence quotes the pro-rated committed line as "before"', b.vegas && near(b.vegas.recYd[0], L._oddsRound(1200 * fFresh)));
  // Reads are memoized per isolate.
  db.reads = 0;
  await L.availabilityTable({ LEADS_DB: db });
  ok('the merged table is memoized (no second D1 read inside the window)', db.reads === 0);
  // The column's consensus side uses the same rows the app ships.
  const board = L.buildVegasBoard({ 'healthyback|RB': { rushYd: 1100 } }, null);
  const row = board.rows.find(r => r.name === 'Fresh Injury');
  ok('the Vegas board\'s consensus side carries the injury too', row && near(row.statsConsensus.recYd, L._oddsRound(1200 * fFresh)), row && JSON.stringify(row.statsConsensus));
}
{
  // The team-environment provider builds off PROJECTIONS rows that already carry the
  // committed factor, so it must store a FULL-SEASON market line for them.
  const teams = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC'.split(' ');
  const pool = teams.map(t => ({ name: 'Passer ' + t, position: 'QB', team: t, projectedStats: { passYd: 4000, passTD: 25, rushYd: 200, rushTD: 2 } }));
  pool.push({ name: nameOf(partialKey), position: posOf(partialKey), team: 'GB', projectedStats: scaleRow(FULL, fPartial) });
  pool.push({ name: nameOf(seasonKey), position: posOf(seasonKey), team: 'KC', projectedStats: scaleRow(FULL, 0) });
  pool.push({ name: 'Healthy Back', position: 'RB', team: 'GB', projectedStats: { ...FULL } });
  const T = harness(pool, () => 'ENC', 'k', noNet);
  // Every team's Vegas number equal to its projection index (the worker's own
  // points model: touchdowns x 6, no kickers in this pool) -> every factor is 1.
  const ppg = {};
  for (const p of pool) ppg[p.team] = (ppg[p.team] || 0) + ((p.projectedStats.passTD || 0) + (p.projectedStats.rushTD || 0)) * 6;
  const built = T.buildTeamEnvOverlay(ppg);
  ok('agreement gives a unit factor everywhere', Object.values(built.factors).every(f => near(f, 1)));
  const ovP = built.overlay[partialKey];
  ok('a committed (pro-rated) row is un-rated into a full-season market line',
    ovP && near(ovP.rushYd, T._oddsRound(scaleRow(FULL, fPartial).rushYd / fPartial), 0.11), ovP && String(ovP.rushYd));
  ok('an unlisted row is stored as is', near(built.overlay['healthyback|RB'].rushYd, FULL.rushYd));
  ok('a zeroed (out-for-season) row is skipped rather than divided by zero', !built.overlay[seasonKey]);
  const after = T.applyAvailability(built.overlay);
  ok('after applyAvailability the market line is back at the row\'s own scale — the factor landed once',
    Math.abs(after[partialKey].rushYd - scaleRow(FULL, fPartial).rushYd) <= 0.2, `${after[partialKey].rushYd} vs ${scaleRow(FULL, fPartial).rushYd}`);
}

// ── a D1 stand-in for the three statements the cache uses ──────────────────
function mockDb(rows = {}) {
  const db = { rows, writes: [], reads: 0 };
  db.prepare = sql => {
    const id = (sql.match(/VALUES \((\d)/) || sql.match(/WHERE id=(\d)/) || [])[1];
    const stmt = args => ({
      run: async () => { if (/INSERT/.test(sql)) { db.writes.push({ id, args }); rows[id] = { payload: args[0], provider: args[1], matched: args[2], updated_at: args[3] }; } return {}; },
      first: async () => { db.reads++; return rows[id] || null; },
      bind: (...a) => stmt(a)
    });
    return stmt([]);
  };
  return db;
}
const feedFetch = body => async (u, opts) => ({ ok: true, status: 200, json: async () => (typeof body === 'function' ? body(u, opts) : body) });
const goodFeed = () => feedOf([
  entry('Healthy Back', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day)),
  entry('Fresh Injury', 'WR', 'Injured Reserve', 'IR', '2027-02-15'),
  entry("D'Andre Suffix Jr.", 'TE', 'Out', 'PUP-R', iso(kickoff + 31 * day)),
  entry('Kicker Man', 'PK', 'Out', 'NFI-R', iso(kickoff + 38 * day)),
  entry('Other Position', 'RB', 'Out', 'RESERVE-CEL', iso(kickoff + 17 * day)),
  entry(nameOf(partialKey), posOf(partialKey), 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day))
]);

console.log('\nfail-safe: the pull');
{
  const r = await W.runAvailabilityRefresh({});
  ok('no database is a no-op, not a throw', r.ok === false && r.error === 'no_db');
}
{
  const db = mockDb();
  const r = await harness(STUB, () => 'ENC', 'k', noNet).runAvailabilityRefresh({ LEADS_DB: db });
  ok('a provider error never writes a row', r.ok === false && /no network/.test(r.error) && db.writes.length === 0, JSON.stringify(r));
}
{
  const db = mockDb();
  const r = await harness(STUB, () => 'ENC', 'k', async () => ({ ok: false, status: 503 })).runAvailabilityRefresh({ LEADS_DB: db });
  ok('an HTTP error never writes a row', r.ok === false && /503/.test(r.error) && db.writes.length === 0, JSON.stringify(r));
}
{
  const db = mockDb();
  const r = await harness(STUB, () => 'ENC', 'k', async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })).runAvailabilityRefresh({ LEADS_DB: db });
  ok('unparseable JSON never writes a row', r.ok === false && /unparseable/.test(r.error) && db.writes.length === 0, JSON.stringify(r));
  const r2 = await harness(STUB, () => 'ENC', 'k', feedFetch({ hello: 'world' })).runAvailabilityRefresh({ LEADS_DB: db });
  ok('JSON of the wrong shape never writes a row', r2.ok === false && /shape/.test(r2.error) && db.writes.length === 0, JSON.stringify(r2));
}
{
  const db = mockDb();
  const thin = goodFeed(); thin.injuries = thin.injuries.slice(0, 10);
  const r = await harness(STUB, () => 'ENC', 'k', feedFetch(thin)).runAvailabilityRefresh({ LEADS_DB: db });
  ok('a feed missing most of the league is rejected', r.ok === false && r.error === 'thin_feed' && db.writes.length === 0, JSON.stringify(r));
  ok('the floor is real', W.AVAIL_MIN_TEAMS >= 28);
}
{
  const db = mockDb();
  const few = feedOf([entry('Healthy Back', 'RB', 'Injured Reserve', 'IR-R', iso(kickoff + 31 * day))]);
  const r = await harness(STUB, () => 'ENC', 'k', feedFetch(few)).runAvailabilityRefresh({ LEADS_DB: db });
  ok('fewer matches than the floor is treated as broken', r.ok === false && r.error === 'insufficient_coverage' && r.matched === 1 && db.writes.length === 0, JSON.stringify(r));
  ok('the match floor is at least a handful', W.AVAIL_MIN_MATCHED >= 3);
}
{
  const db = mockDb();
  let seenUrl = null, seenUa = null;
  const R = harness(STUB, () => 'ENC', 'k', feedFetch((u, o) => { seenUrl = u; seenUa = o && o.headers && o.headers['user-agent']; return goodFeed(); }));
  const r = await R.runAvailabilityRefresh({ LEADS_DB: db });
  ok('a good pull writes row 3', r.ok === true && db.writes.length === 1 && db.writes[0].id === '3', JSON.stringify(r).slice(0, 300));
  ok('it hits the ESPN feed with the product token ESPN accepts', /site\.api\.espn\.com.*injuries/.test(seenUrl) && seenUa === 'iron-tuna-availability/1.0', seenUrl + ' ' + seenUa);
  const row = db.rows[3];
  const payload = JSON.parse(row.payload);
  ok('the row is provider espn-injuries, matched = board players listed, updated_at = now',
    row.provider === 'espn-injuries' && row.matched === 6 && Date.now() - row.updated_at < 5000);
  ok('the payload is { asOf, players }', payload.asOf === '2026-09-02T15:22:53.000Z' && payload.players && Object.keys(payload.players).length === 6);
  ok('the result names what the file does not have and what the feed no longer lists',
    r.added.includes('freshinjury|WR') && !r.added.includes(partialKey) && r.notInFeed.includes(seasonKey) && !r.notInFeed.includes(partialKey));
  // ...and the serving path reads it back.
  const back = await R.availabilityCacheRead({ LEADS_DB: db });
  ok('the row reads back', back && back.matched === 6 && back.asOf === payload.asOf && back.players['freshinjury|WR'].gamesOut === G);
  const table = await R.availabilityTable({ LEADS_DB: db });
  ok('the memo was dropped by the write, so the table has the new row', table['freshinjury|WR'] && table['freshinjury|WR'].live);
  ok('the committed block is still all there', committedKeys.every(k => table[k]));
  ok('a committed player the feed lists at fewer games keeps the committed number',
    table[partialKey].gamesOut === Math.max(4, partial.gamesOut) && table[partialKey].live);
}

console.log('\nfail-safe: the serving path');
{
  // A stale row (older than the window) is ignored: the committed block alone.
  const stale = mockDb({ 3: { payload: JSON.stringify({ asOf: 'x', players: { 'freshinjury|WR': { status: 'IR', gamesOut: 4 } } }), provider: 'espn-injuries', matched: 1, updated_at: Date.now() - 15 * 86400000 } });
  const S = harness(STUB, str => 'ENC', 'k', noNet);
  const t = await S.availabilityTable({ LEADS_DB: stale });
  ok('a row older than 14 days is ignored', !t['freshinjury|WR'] && Object.keys(t).length === committedKeys.length);
}
{
  const bad = [
    { players: 'nope' },
    { players: { 'freshinjury|WR': { status: 'IR', gamesOut: 0 } } },
    { players: { 'freshinjury|WR': { status: 'IR', gamesOut: 99 } } },
    { players: { 'freshinjury|WR': { status: '', gamesOut: 4 } } },
    { players: { 'fresh injury|WR': { status: 'IR', gamesOut: 4 } } },
    { 'freshinjury|WR': { rushYd: 4200 } },        // an odds overlay by mistake
    null
  ];
  let ignored = 0;
  for (const b of bad) {
    const db = mockDb({ 3: { payload: JSON.stringify(b), provider: 'x', matched: 1, updated_at: Date.now() } });
    const t = await harness(STUB, () => 'ENC', 'k', noNet).availabilityTable({ LEADS_DB: db });
    if (!t['freshinjury|WR'] && Object.keys(t).length === committedKeys.length) ignored++;
  }
  ok('a malformed row is not half-used', ignored === bad.length, `${ignored}/${bad.length}`);
  const db = mockDb({ 3: { payload: '{not json', provider: 'x', matched: 1, updated_at: Date.now() } });
  const t = await harness(STUB, () => 'ENC', 'k', noNet).availabilityTable({ LEADS_DB: db });
  ok('an unparseable row is ignored', Object.keys(t).length === committedKeys.length);
  const boom = { prepare: () => { throw new Error('d1 down'); } };
  const t2 = await harness(STUB, () => 'ENC', 'k', noNet).availabilityTable({ LEADS_DB: boom });
  ok('a D1 failure leaves the committed block in force', Object.keys(t2).length === committedKeys.length);
}
{
  // projectionsPayload with no overlay at all still serves availability.
  let encoded = null;
  const P = harness(STUB, str => { encoded = str; return 'ENC'; }, 'k', noNet);
  const liveRow = { asOf: '2026-09-05', players: { 'freshinjury|WR': { status: 'IR', gamesOut: 4, note: 'feed' } } };
  const db = mockDb({ 3: { payload: JSON.stringify(liveRow), provider: 'espn-injuries', matched: 1, updated_at: Date.now() } });
  await P.projectionsPayload({ LEADS_DB: db });
  const served = JSON.parse(encoded);
  const fresh = served.find(p => p.name === 'Fresh Injury');
  ok('with no odds overlay the served pool still carries the live injury',
    fresh && fresh.status === 'IR' && near(fresh.projectedStats.recYd, P._oddsRound(1200 * (1 - 4 / G))), fresh && JSON.stringify(fresh.projectedStats));
  ok('an unlisted player is served as committed', served.find(p => p.name === 'Healthy Back').projectedStats.rushYd === 1000);
  const b = await P.boardPayload({ LEADS_DB: db });
  ok('the served board is built off the same pool', b && b.ok !== false);
  let enc2 = null;
  const Q = harness(STUB, str => { enc2 = str; return 'ENC'; }, 'k', noNet);
  await Q.projectionsPayload({});
  ok('no database still serves the committed pool with the committed block', /"Healthy Back"/.test(enc2) && JSON.parse(enc2).find(p => p.name === nameOf(partialKey)).status === partial.status);
}
{
  // oddsCacheRead scales the odds overlay by the MERGED table.
  const liveRow = { asOf: '2026-09-05', players: { 'freshinjury|WR': { status: 'IR', gamesOut: 4 } } };
  const db = mockDb({
    1: { payload: JSON.stringify({ 'freshinjury|WR': { recYd: 1600 } }), provider: 'nflverse', matched: 30, updated_at: Date.now() },
    3: { payload: JSON.stringify(liveRow), provider: 'espn-injuries', matched: 1, updated_at: Date.now() }
  });
  const O = harness(STUB, () => 'ENC', 'k', noNet);
  const cached = await O.oddsCacheRead({ LEADS_DB: db });
  ok('the overlay read from D1 is scaled by the live list', cached && near(cached.overlay['freshinjury|WR'].recYd, O._oddsRound(1600 * (1 - 4 / G))), cached && JSON.stringify(cached.overlay));
}
{
  const db = mockDb({ 3: { payload: JSON.stringify({ asOf: '2026-09-05', players: { 'freshinjury|WR': { status: 'IR', gamesOut: 4, note: 'feed' } } }), provider: 'espn-injuries', matched: 1, updated_at: Date.now() - 3600000 } });
  const rep = await harness(STUB, () => 'ENC', 'k', noNet).availabilityReport({ LEADS_DB: db });
  ok('the admin report says how old the row is and how many it matched', rep.live && rep.live.matched === 1 && rep.live.ageHours >= 1 && rep.live.ageHours < 1.1, JSON.stringify(rep.live));
  ok('...and lists every affected player with both numbers and his factors',
    rep.affected.length === committedKeys.length + 1 &&
    rep.affected.every(a => a.name && a.position && typeof a.gamesOut === 'number' && typeof a.committedGamesOut === 'number' && typeof a.factor === 'number' && typeof a.rowFactor === 'number') &&
    rep.addedByLive.includes('Fresh Injury'), JSON.stringify(rep.affected.slice(0, 2)));
  const rep2 = await harness(STUB, () => 'ENC', 'k', noNet).availabilityReport({});
  ok('with no row it says the committed block is serving', rep2.live === null && /committed block only/.test(rep2.serving) && rep2.affected.length === committedKeys.length);
}

// ── end to end on the real feed and the real pool ──────────────────────────
const realPool = (() => {
  const st = src.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const out = []; let m;
  const seg = src.slice(st, src.indexOf('\n];', st));
  while ((m = re.exec(seg))) {
    const stats = {};
    for (const kv of m[4].split(',')) { const q = kv.trim().match(/^(\w+): (-?[\d.]+)$/); if (q) stats[q[1]] = parseFloat(q[2]); }
    out.push({ name: m[1], position: m[2], team: m[3], projectedStats: stats });
  }
  return out;
})();

console.log('\nlive ESPN injury feed (real network)');
{
  // Node's fetch may not honour the sandbox's proxy; curl does. Try the
  // worker's own fetch path first, then curl, then skip.
  const curlFetch = async (u) => {
    const body = execFileSync('curl', ['-sS', '-m', '90', '-A', 'iron-tuna-availability/1.0', u], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
  let feed = null, how = '';
  for (const [label, f] of [['fetch', globalThis.fetch], ['curl', curlFetch]]) {
    try { feed = await harness(realPool, () => 'ENC', 'k', f).fetchInjuriesEspn(); how = label; break; }
    catch (err) { console.log(`  (${label}: ${err.message})`); }
  }
  if (!feed) {
    console.log('  SKIP live pull — network unavailable');
  } else {
    const R = harness(realPool, () => 'ENC', 'k', feedFetch(feed));
    const built = R.buildAvailabilityOverlay(feed);
    ok(`the feed came back (${how}) with a full league`, built.teams >= R.AVAIL_MIN_TEAMS, String(built.teams));
    ok('it lists a plausible number of board players on reserve lists', built.matched >= R.AVAIL_MIN_MATCHED, String(built.matched));
    ok('every entry is in the file\'s vocabulary with a sane games-out',
      Object.values(built.players).every(p => /^(IR|PUP|NFI|Exempt|Suspended|Out)$/.test(p.status) && p.gamesOut >= R.AVAIL_MIN_GAMES && p.gamesOut <= G));
    const committedInFeed = committedKeys.filter(k => built.players[k]);
    const statusAgrees = committedInFeed.filter(k => built.players[k].status === R.AVAILABILITY[k].status);
    ok('the feed agrees with the hand file on status for the players both list',
      statusAgrees.length === committedInFeed.length,
      committedInFeed.filter(k => built.players[k].status !== R.AVAILABILITY[k].status).map(k => `${k}: feed ${built.players[k].status} file ${R.AVAILABILITY[k].status}`).join(', '));
    const db = mockDb();
    const r = await R.runAvailabilityRefresh({ LEADS_DB: db });
    ok('the real pull writes a row', r.ok === true && db.writes.length === 1, JSON.stringify(r).slice(0, 200));
    const table = await R.availabilityTable({ LEADS_DB: db });
    ok('the union keeps every committed entry', committedKeys.every(k => table[k]));
    ok('no committed player is moved to fewer games out', committedKeys.every(k => table[k].gamesOut >= R.AVAILABILITY[k].gamesOut));
    const pool = R.blendProjections(null);
    ok('pool length is preserved', pool.length === realPool.length);
    const rerated = pool.filter((p, i) => p.projectedStats !== realPool[i].projectedStats);
    ok('only players the live list added or lengthened are re-rated',
      rerated.every(p => table[R._oddsNorm(p.name) + '|' + p.position] && R._availRowFactor(R._oddsNorm(p.name) + '|' + p.position) < 1), rerated.map(p => p.name).join(', '));
    console.log(`       feed ${built.asOf}: ${built.teams} teams, ${built.entries} entries, ${built.matched} board players on reserve lists`);
    console.log('       new since the file    :', r.added.length ? r.added.map(k => `${built.players[k].name} (${built.players[k].position}, ${built.players[k].status} ${built.players[k].gamesOut})`).join('; ') : 'none');
    console.log('       in file, not in feed  :', r.notInFeed.length ? r.notInFeed.join(', ') : 'none');
    console.log('       feed says fewer games :', committedInFeed.filter(k => built.players[k].gamesOut < R.AVAILABILITY[k].gamesOut).map(k => `${k} ${built.players[k].gamesOut} < ${R.AVAILABILITY[k].gamesOut} (file stands)`).join('; ') || 'none');
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
