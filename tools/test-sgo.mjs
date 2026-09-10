#!/usr/bin/env node
// The SportsGameOdds adapter: the paid feed behind /the-line, /previews and
// every market-implied number on the boards.
//   node tools/test-sgo.mjs
//
// The adapter is written to SGO's published v2 documentation and to the field
// names in their own TypeScript SDK, and it has NEVER RUN against the live
// service — no key is configured and the host is unreachable from the sandbox
// this repo is developed in. That makes a committed fixture the only thing
// standing between a schema assumption and a silently wrong betting line, so
// every shape the adapter depends on is asserted here rather than trusted:
//
//   1. THE PAIRING. SGO ships each side of a market as its own entry. An over
//      whose under is lost is a line with no price, and a market emitted twice
//      is a book counted twice in the consensus.
//   2. THE SIGN. A book quotes the home side's handicap; the spine writes the
//      same game as a home margin. A missed flip inverts every favorite on the
//      site and nothing about the page would look wrong.
//   3. THE PAIR BEHIND A MOVE. Open and current must come from ONE book, or
//      "it opened at 46.5 and it is 48.5 now" is a sentence about two books.
//   4. THE KEY. It travels in a header, never in a URL, and never in a row.
//
// The adapter is lifted out of the real _worker.js, so a rename fails here
// instead of on a reader's screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const head = t => console.log('\n' + t);

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) { console.error('FAIL: could not locate ' + JSON.stringify(from.slice(0, 48))); process.exit(1); }
  return src.slice(a, b);
};
const adapter = cut('// SportsGameOdds v2. WRITTEN TO', 'const NFLVERSE_GAMES_URL');
const merge = cut('// The paid feed\'s game lines onto the schedule.', '// ── the clock');

// The three symbols the lifted code closes over. PROJECTIONS is real in the
// worker; here it is the DEF rows only, which is all the club index reads.
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TEAM_ALIAS[u] || u; };
const PROJECTIONS = [
  { name: 'Buffalo Bills', position: 'DEF', team: 'BUF' },
  { name: 'Kansas City Chiefs', position: 'DEF', team: 'KC' },
  { name: 'Philadelphia Eagles', position: 'DEF', team: 'PHI' },
  { name: 'Dallas Cowboys', position: 'DEF', team: 'DAL' },
  { name: 'New England Patriots', position: 'DEF', team: 'NE' },
  { name: 'New York Jets', position: 'DEF', team: 'NYJ' },
  { name: 'Los Angeles Rams', position: 'DEF', team: 'LAR' },
  { name: 'Josh Allen', position: 'QB', team: 'BUF' }
];
let FETCH = async () => { throw new Error('no fetch stub installed'); };
const M = new Function('teamKey', 'PROJECTIONS', 'fetch',
  adapter + '\n' + merge + '\n' +
  'return { sgoParts, sgoTeamKey, sgoPlayerName, sgoOpposite, parseSgoEventProps, parseSgoEventLine, ' +
  'parseSgoEventGame, fetchOddsSgo, fetchGameLinesSgo, mergeGameLines, SGO_API_BASE, SGO_PROP_MARKETS };'
)(teamKey, PROJECTIONS, (...a) => FETCH(...a));

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'sgo-nfl-week.json'), 'utf8'));
const byId = id => FIX.data.find(e => e.eventID === id);
const KC = byId('sgo-evt-kc-buf'), PHI = byId('sgo-evt-dal-phi'), NE = byId('sgo-evt-nyj-ne');
// The site's own name key, copied from _worker.js. A prop whose player does not
// normalize to the same string a projection row does is a prop for nobody.
const _oddsNorm = s => String(s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '').replace(/[^a-z]/g, '');

// ── the oddID ───────────────────────────────────────────────────────────────
head('an oddID is read as five parts');
ok('the entry\'s own fields win over the key',
   M.sgoParts({ oddID: 'x-y-z-w-q', statID: 'passing_yards', statEntityID: 'JOSH_ALLEN_1_NFL',
                periodID: 'game', betTypeID: 'ou', sideID: 'over' }).statID === 'passing_yards');
const parsed = M.sgoParts({ oddID: 'receiving_receptions-CEEDEE_LAMB_1_NFL-game-ou-over' });
ok('and the key is parsed when they are absent',
   parsed.statID === 'receiving_receptions' && parsed.statEntityID === 'CEEDEE_LAMB_1_NFL' &&
   parsed.periodID === 'game' && parsed.betTypeID === 'ou' && parsed.sideID === 'over',
   JSON.stringify(parsed));
ok('an id with the wrong number of parts yields nulls, not guesses',
   M.sgoParts({ oddID: 'points-home-game' }).statID === null);
ok('the other side is found by its declared id',
   M.sgoOpposite(KC.odds, KC.odds['passing_yards-JOSH_ALLEN_1_NFL-game-ou-over'], 'over', 'under')
     .oddID === 'passing_yards-JOSH_ALLEN_1_NFL-game-ou-under');
ok('and by swapping the side when none is declared',
   M.sgoOpposite(KC.odds, KC.odds['rushing_yards-JAMES_COOK_1_NFL-game-ou-over'], 'over', 'under')
     .oddID === 'rushing_yards-JAMES_COOK_1_NFL-game-ou-under');

// ── clubs and players ───────────────────────────────────────────────────────
head('a club resolves to the site\'s own key');
ok('off the full name', M.sgoTeamKey(KC.teams.home) === 'BUF');
ok('off the teamID when there is no name block',
   M.sgoTeamKey({ teamID: 'KANSAS_CITY_CHIEFS_NFL' }) === 'KC');
ok('the alias table still applies',
   M.sgoTeamKey({ names: { long: 'Los Angeles Rams' } }) === 'LA');
ok('an abbreviation is accepted only when it looks like one',
   M.sgoTeamKey({ names: { short: 'SEA' } }) === 'SEA' &&
   M.sgoTeamKey({ names: { short: 'Some Expansion Club' } }) === null);
ok('an unknown club is null rather than a guess', M.sgoTeamKey({ names: { long: 'London Broncos' } }) === null);

head('a player prop names a player the boards can match');
ok('the event\'s player map is the authority',
   M.sgoPlayerName(KC, 'JOSH_ALLEN_1_NFL') === 'Josh Allen');
ok('first and last are joined when there is no name field',
   M.sgoPlayerName(KC, 'JAMES_COOK_1_NFL') === 'James Cook');
const derived = M.sgoPlayerName(PHI, 'CEEDEE_LAMB_1_NFL');
ok('an id with no map entry still yields a matchable name',
   _oddsNorm(derived) === 'ceedeelamb', derived);
ok('a team entity is not a player', M.sgoPlayerName(KC, 'home') === null);

// ── player props ────────────────────────────────────────────────────────────
head('the props of one event');
const rows = M.parseSgoEventProps(KC);
const of = (player, market) => rows.filter(r => r.player === player && r.market === market);
ok('every row is game-scoped, so the season overlay refuses them',
   rows.length > 0 && rows.every(r => r.scope === 'game'));
ok('every row carries both clubs and the event id',
   rows.every(r => r.home === 'BUF' && r.away === 'KC' && r.gameId === 'sgo-evt-kc-buf'));
const pass2 = of('Josh Allen', 'passYd');
ok('a two-book market is two rows, one per book', pass2.length === 2, String(pass2.length));
const alpha = pass2.find(r => r.book === 'alpha');
ok('each book keeps its own line and both prices',
   alpha && alpha.line === 241.5 && alpha.overOdds === -112 && alpha.underOdds === -108,
   JSON.stringify(alpha));
const beta = pass2.find(r => r.book === 'beta');
ok('a book that has pulled one side keeps the side it still quotes',
   beta && beta.line === 244.5 && beta.overOdds === -105 && beta.underOdds === null,
   JSON.stringify(beta));
const td = of('James Cook', 'anytimeTD');
ok('an anytime touchdown is stored as a price, with the line pinned to 1',
   td.length === 1 && td[0].line === 1 && td[0].overOdds === 105 && td[0].underOdds === -135,
   JSON.stringify(td[0]));
ok('the market is emitted once, not once per side',
   of('Josh Allen', 'passYd').length === 2 && rows.filter(r => r.market === 'rushYd').length === 1);
ok('a first-half line is not this week\'s market', !rows.some(r => r.market === 'points'));
ok('a team-level market is not a player prop', !rows.some(r => r.player === 'home' || r.player === 'all'));
ok('an unmapped stat is dropped rather than guessed at',
   !rows.some(r => /tackle/i.test(String(r.market))));
ok('a total-touchdowns over/under is not mistaken for an anytime price',
   td.length === 1);
const phiRows = M.parseSgoEventProps(PHI);
const lamb = phiRows.find(r => r.market === 'rec');
ok('a response with no per-book detail still yields the consensus',
   lamb && lamb.book === 'sgo-consensus' && lamb.line === 6.5 &&
   lamb.overOdds === -118 && lamb.underOdds === -104, JSON.stringify(lamb));

// ── game lines ──────────────────────────────────────────────────────────────
head('the game line of one event');
const line = M.parseSgoEventLine(KC);
ok('the PRINTED spread is the consensus, flipped into the spine\'s home-margin convention',
   line.spread === 2.5, String(line.spread));
ok('and the printed total is the consensus too', line.total === 48.5, String(line.total));
ok('the book block is the anchor book\'s OWN number, not the consensus',
   line.book.name === 'alpha' && line.book.spread === 3 && line.book.total === 49,
   JSON.stringify(line.book));
ok('current and open in that block come from the one book',
   line.book.spreadOpen === 1.5 && line.book.totalOpen === 46.5, JSON.stringify(line.book));
ok('the opener is flipped with the number it is compared to',
   Math.sign(line.book.spread) === Math.sign(line.book.spreadOpen));
ok('the total and its opener are not flipped', line.book.total > 0 && line.book.totalOpen > 0);
ok('the block is the shape _gameLineMove reads',
   ['name', 'spread', 'spreadOpen', 'total', 'totalOpen'].every(k => k in line.book));
ok('a book quoting only one market is not preferred over one quoting both',
   line.book.name === 'alpha');
const pk = M.parseSgoEventLine(PHI);
ok('a pick\'em survives the flip as 0, not -0',
   Object.is(pk.spread, 0), String(pk.spread));
ok('with no per-book detail there is a printed line and no book block',
   pk.book === null && pk.total === 44.5, JSON.stringify(pk));
ok('an event with neither market reads null, not an empty line',
   M.parseSgoEventLine({ odds: {} }) === null && M.parseSgoEventLine({}) === null);
const game = M.parseSgoEventGame(KC);
ok('the event becomes a matchable fixture',
   game.home === 'BUF' && game.away === 'KC' &&
   game.kickoff === Date.parse('2026-09-13T17:00:00.000Z') && game.spread === 2.5,
   JSON.stringify(game));
ok('an event with no kickoff is not a fixture',
   M.parseSgoEventGame({ eventID: 'x', teams: KC.teams, status: {} }) === null);

// ── the merge ───────────────────────────────────────────────────────────────
head('the lines onto the schedule');
const KICK = Date.parse('2026-09-13T17:00:00.000Z');
const schedule = [
  { id: 'g1', away: 'KC', home: 'BUF', kickoff: KICK, spread: 1.5, total: 45.5, status: null },
  { id: 'g2', away: 'NYJ', home: 'NE', kickoff: Date.parse('2026-09-06T17:00:00.000Z'), spread: 6.5, total: 43.5, status: 'final' },
  { id: 'g3', away: 'MIA', home: 'MIN', kickoff: KICK, spread: -1, total: 41.5, status: null }
];
const lines = [M.parseSgoEventGame(KC), M.parseSgoEventGame(NE)];
const merged = M.mergeGameLines(schedule, lines, KICK - 86400000);
const g1 = merged.games.find(g => g.id === 'g1'), g2 = merged.games.find(g => g.id === 'g2');
ok('an upcoming fixture is repriced off the paid feed',
   g1.spread === 2.5 && g1.total === 48.5 && g1.lineSrc === 'sportsgameodds',
   JSON.stringify(g1));
ok('and carries the book pair the movement is computed from',
   g1.book && g1.book.spreadOpen === 1.5 && g1.book.totalOpen === 46.5);
ok('a game already played keeps its own closing line',
   g2.spread === 6.5 && g2.total === 43.5 && g2.lineSrc === undefined, JSON.stringify(g2));
ok('but still takes the book pair, which belongs to the book',
   !!g2.book && g2.book.spread === 6.5 && g2.book.spreadOpen === 4.5);
const stale = M.mergeGameLines(
  [{ id: 'g5', away: 'DAL', home: 'PHI', kickoff: Date.parse('2026-09-13T20:25:00.000Z'), spread: 1, total: 43,
     status: null, book: { name: 'espn', spread: 1, spreadOpen: 2, total: 43, totalOpen: 44 } }],
  [M.parseSgoEventGame(PHI)], KICK - 86400000);
ok('a repriced fixture never keeps a stale pair from the feed it replaced',
   stale.games[0].book === null && stale.games[0].total === 44.5, JSON.stringify(stale.games[0]));
ok('a fixture the feed did not price is untouched',
   merged.games.find(g => g.id === 'g3').spread === -1);
ok('the counts say what happened', merged.priced === 1 && merged.booked === 2,
   merged.priced + '/' + merged.booked);
ok('the input schedule is not mutated', schedule[0].spread === 1.5);
const far = M.mergeGameLines(
  [{ id: 'g4', away: 'KC', home: 'BUF', kickoff: KICK + 5 * 86400000, spread: null, total: null, status: null }],
  [M.parseSgoEventGame(KC)], KICK);
ok('the same clubs a week apart are two different games', far.priced === 0);

// ── the fetch ───────────────────────────────────────────────────────────────
head('the pull');
const calls = [];
const respond = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
FETCH = async (url, init) => { calls.push({ url: String(url), init }); return respond(200, FIX); };
const lineRows = await M.fetchGameLinesSgo({ SGO_API_KEY: 'sk-secret-do-not-leak' });
ok('it reads SportsGameOdds and nothing else',
   calls.every(c => c.url.startsWith('https://api.sportsgameodds.com/v2/events?')), calls[0] && calls[0].url);
ok('the key travels in a header',
   calls[0].init.headers['x-api-key'] === 'sk-secret-do-not-leak');
ok('and never in the URL', !calls.some(c => /sk-secret-do-not-leak/.test(c.url)));
ok('it asks for one league', /leagueID=NFL/.test(calls[0].url));
ok('it asks for the openers, which is the whole reason for the feed',
   /includeOpenCloseOdds=true/.test(calls[0].url));
ok('it asks for two markets rather than the whole board',
   /points-home-game-sp-home/.test(calls[0].url) && /points-all-game-ou-over/.test(calls[0].url));
ok('every priced event comes back as a fixture', lineRows.length === 3);
ok('no row carries the key', !JSON.stringify(lineRows).includes('sk-secret-do-not-leak'));

calls.length = 0;
const propRows = await M.fetchOddsSgo({ SGO_API_KEY: 'k' });
ok('the props pull asks for the markets the boards actually score',
   Object.keys(M.SGO_PROP_MARKETS).every(s => calls[0].url.includes(encodeURIComponent(s + '-PLAYER_ID-game-ou-over'))),
   calls[0].url);
ok('and for the other side of each of them', /includeOpposingOdds=true/.test(calls[0].url));
ok('it returns the props of every event on the board',
   propRows.length === M.parseSgoEventProps(KC).length + M.parseSgoEventProps(PHI).length);

calls.length = 0;
let page = 0;
FETCH = async (url) => {
  calls.push({ url: String(url) });
  page++;
  return respond(200, page === 1 ? { data: FIX.data.slice(0, 1), nextCursor: 'c2' } : { data: FIX.data.slice(1), nextCursor: '' });
};
const paged = await M.fetchGameLinesSgo({ SGO_API_KEY: 'k' });
ok('a cursor is followed', calls.length === 2 && /cursor=c2/.test(calls[1].url));
ok('and every page is kept', paged.length === 3, String(paged.length));

page = 0;
FETCH = async () => { page++; return page === 1 ? respond(200, { data: FIX.data.slice(0, 1), nextCursor: 'c2' }) : respond(500, {}); };
const partial = await M.fetchGameLinesSgo({ SGO_API_KEY: 'k' });
ok('a later page failing keeps the slate already read', partial.length === 1);

FETCH = async () => respond(429, {});
let threw = null;
try { await M.fetchGameLinesSgo({ SGO_API_KEY: 'k' }); } catch (e) { threw = e.message; }
ok('a first page failing is a failed pull, not an empty week', /429/.test(String(threw)), String(threw));

threw = null;
try { await M.fetchOddsSgo({}); } catch (e) { threw = e.message; }
ok('no key is an error that names the binding', /SGO_API_KEY/.test(String(threw)), String(threw));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
