#!/usr/bin/env node
// Tests for the rotating insight libraries in index.html — the notes that
// scroll above the cheat sheet.
//   node tools/test-insights.mjs
//
// The failure this file exists to catch is a note that quietly outlives the
// roster it describes. FANTASY_FACTS is hand-written prose with no build step
// and no link to the player pool, so nothing used to notice when a player it
// named changed teams, fell off the board, or stopped being a rookie. By August
// 2026 eight of its eleven backfield notes were wrong: it paired Travis Etienne
// with Tank Bigsby in Jacksonville after both had left, hung the Seattle
// timeshare on Kenneth Walker a season after Kansas City signed him, and called
// RJ Harvey "an explosive rookie" a year past his rookie season. Every one of
// those reads as confident advice, which is what makes it expensive.
//
// So the checks below hold the prose to the data the rest of the site already
// runs on — PROJECTIONS in _worker.js, the same pool that prices every board:
//
//   1. a name in an evergreen note must still be on the board;
//   2. a note whose label names a team may only name players on that team;
//   3. a rookie or second-year claim must agree with ENTRY_YEAR and the season.
//
// Rule 3 needs the one thing the pool does not carry: yearsExp arrives from
// Sleeper at runtime and is in no file here. ENTRY_YEAR below is the static
// stand-in, and SEASON is read off the AGE_<year> map in index.html so that
// rolling the site to a new season re-dates every claim at once — the note that
// says "second-year" then fails until somebody re-reads it. That is the whole
// point: rot that used to be silent now stops CI.
//
// The roster rules run against FANTASY_FACTS, not PERF_NOTES. PERF_NOTES is
// dated ("updated: Aug 19, 2026") and reports news, so it is allowed to discuss
// a player precisely because he just left the board — the Pearsall note exists
// to say he is off it. Undated advice gets no such licence.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

// ── lifting the real declarations out of the real files ───────────────────
// Scans the literal after `const NAME =` bracket by bracket rather than slicing
// to whatever happens to be declared next, so moving a declaration around does
// not quietly turn a check into a no-op.
function literalAfter(src, name) {
  const decl = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(src);
  if (!decl) throw new Error(`${name} not found — did it get renamed?`);
  const from = decl.index + decl[0].length;
  const open = src[from];
  if (open !== '[' && open !== '{') throw new Error(`${name} is not an array or object literal`);
  const close = open === '[' ? ']' : '}';
  let depth = 0, quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return new Function(`return (${src.slice(from, i + 1)});`)();
  }
  throw new Error(`${name} literal never closed`);
}

const PROJECTIONS = literalAfter(worker, 'PROJECTIONS');
const FANTASY_FACTS = literalAfter(client, 'FANTASY_FACTS');
const PERF_NOTES = literalAfter(client, 'PERF_NOTES');
const BIDDING_NOTES = literalAfter(client, 'BIDDING_NOTES');

// The season is read off the map index.html already stamps with it, so there is
// one place to bump and no second copy to forget.
const seasonDecl = /const AGE_(\d{4}) = /.exec(client);
if (!seasonDecl) throw new Error('no AGE_<year> map in index.html to date the insights against');
const SEASON = Number(seasonDecl[1]);

// ── the year each player entered the league ───────────────────────────────
// Only players an insight makes an experience claim about need an entry here;
// rule 3 fails closed when one is missing, so this cannot fall behind the
// prose. Years are the ones the site's own auction-watch reports state.
const ENTRY_YEAR = {
  'RJ Harvey': 2025,        // Denver, 2025 second round
  'Bhayshul Tuten': 2025,   // Jacksonville, 2025 fourth round
  'Jadarian Price': 2026,   // Seattle, last pick of round one
  'Jeremiyah Love': 2026    // Arizona, No. 3 overall
};

// ── reading names out of prose ────────────────────────────────────────────
// One normaliser for both sides, so "A.J. Brown", "RJ Harvey" and "Brown's"
// reduce the same way whether they come from the pool or from a sentence.
// Words, not characters: matching on token runs is what keeps "Love" from
// landing inside "Loveland" and "Rookie Jadarian" from reading as a name.
const norm = w => String(w).toLowerCase().replace(/[’']s$/, '').replace(/[^a-z]/g, '');
const words = text => String(text).split(/\s+/).filter(Boolean);
const keyOf = ws => ws.map(norm).filter(Boolean).join(' ');
const SUFFIX = /\s(jr|sr|ii|iii|iv|v)$/;

// Every pool name, indexed with and without its suffix so prose that says
// "Tyrone Tracy" still finds "Tyrone Tracy Jr." on the board.
const byName = new Map();
for (const p of PROJECTIONS) {
  const full = keyOf(words(p.name));
  for (const k of new Set([full, full.replace(SUFFIX, '')])) {
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
}
const LONGEST = Math.max(...[...byName.keys()].map(k => k.split(' ').length));

// Walks the sentence claiming the longest run of words that names somebody on
// the board. Returns each hit with the word it started at, which is what rule 3
// uses to tell which name a claim is attached to.
function scan(text) {
  const ws = words(text);
  const found = [], claimed = new Set();
  for (let i = 0; i < ws.length; i++) {
    for (let n = Math.min(LONGEST, ws.length - i); n >= 2; n--) {
      const entries = byName.get(keyOf(ws.slice(i, i + n)));
      if (!entries) continue;
      found.push({ at: i, span: n, name: entries[0].name, entries });
      for (let j = i; j < i + n; j++) claimed.add(j);
      i += n - 1;
      break;
    }
  }
  return { ws, found, claimed };
}

const TEAMS = {
  Cardinals: 'ARI', Falcons: 'ATL', Ravens: 'BAL', Bills: 'BUF', Panthers: 'CAR',
  Bears: 'CHI', Bengals: 'CIN', Browns: 'CLE', Cowboys: 'DAL', Broncos: 'DEN',
  Lions: 'DET', Packers: 'GB', Texans: 'HOU', Colts: 'IND', Jaguars: 'JAX',
  Chiefs: 'KC', Raiders: 'LV', Chargers: 'LAC', Rams: 'LAR', Dolphins: 'MIA',
  Vikings: 'MIN', Patriots: 'NE', Saints: 'NO', Giants: 'NYG', Jets: 'NYJ',
  Eagles: 'PHI', Steelers: 'PIT', '49ers': 'SF', Seahawks: 'SEA',
  Buccaneers: 'TB', Titans: 'TEN', Commanders: 'WAS', Washington: 'WAS'
};
// Capitalised words that are not people. Cities read exactly like names
// ("Green Bay", "New Orleans"), and the coaches are the ones this prose names —
// a coach the list has not met is reported until somebody adds him, which is
// the right way round for a check that is looking for names it does not know.
const NOT_PEOPLE = new Set([
  ...Object.keys(TEAMS),
  'Arizona', 'Atlanta', 'Baltimore', 'Buffalo', 'Carolina', 'Chicago', 'Cincinnati',
  'Cleveland', 'Dallas', 'Denver', 'Detroit', 'Green', 'Bay', 'Houston', 'Indianapolis',
  'Jacksonville', 'Kansas', 'City', 'Las', 'Vegas', 'Los', 'Angeles', 'Miami',
  'Minnesota', 'New', 'England', 'Orleans', 'York', 'Philadelphia', 'Pittsburgh',
  'San', 'Francisco', 'Seattle', 'Tampa', 'Tennessee',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Kellen', 'Moore', 'Liam', 'Coen', 'Dave', 'Canales', 'Mike', 'McCarthy', 'Andy', 'Reid'
].map(norm));

const teamInLabel = label => {
  for (const [word, code] of Object.entries(TEAMS)) {
    if (new RegExp(`\\b${word}\\b`).test(label)) return { word, code };
  }
  return null;
};

// ── the three rules ───────────────────────────────────────────────────────
// Each returns the complaints it found, so a clean note returns nothing. They
// are functions rather than inline assertions so the fixtures at the bottom can
// re-run them against the notes that shipped wrong.

// Two capitalised words in a row that the pool did not claim. Initials ("A.J.")
// and all-caps first names ("RJ") count; a full stop between them does not, so
// "Minnesota. Buy both" stays a sentence boundary rather than becoming a person.
// Internal capitals are ordinary in these names — MarShawn, TreVeyon, McCaffrey
// — so the shape is "starts capitalised", not "capitalised then lower case".
const CAPPED = /^(?:(?:[A-Z]\.){1,3}|[A-Z][A-Za-z’'-]*)$/;
// A surname carries lower case somewhere, which is what separates "Lloyd" and
// "McCaffrey" from the abbreviations this prose is full of — RB, PPR, TE.
const SURNAME = /^[A-Z][A-Za-z’'-]*[a-z]/;
const ENDS_SENTENCE = /[.!?]$/;
function namesOffTheBoard(note) {
  const { ws, claimed } = scan(note.text);
  const out = [];
  for (let i = 0; i + 1 < ws.length; i++) {
    if (claimed.has(i) || claimed.has(i + 1)) continue;
    const a = ws[i].replace(/[,;:]$/, ''), b = ws[i + 1].replace(/[,;:.]$/, '');
    if (!CAPPED.test(a) || !SURNAME.test(b)) continue;
    if (ENDS_SENTENCE.test(a) && !/^(?:[A-Z]\.){1,3}$/.test(a)) continue;
    if (NOT_PEOPLE.has(norm(a)) || NOT_PEOPLE.has(norm(b))) continue;
    out.push(`${a} ${b}`);
  }
  return out;
}

function wrongTeam(note) {
  const team = teamInLabel(note.label);
  if (!team) return [];
  return scan(note.text).found
    .filter(h => !h.entries.some(p => p.team === team.code))
    .map(h => `${h.name} (${h.entries[0].team}) in a ${team.word} note`);
}

// How far a claim may sit from the name it describes. Wide enough for "Bhayshul
// Tuten leads Jacksonville in year two", tight enough that the next sentence's
// subject is somebody else's business.
const CLAIM_REACH = 6;
const CLAIMS = [
  { re: /^rookie$/, seasons: 1, word: 'rookie' },
  { re: /^(?:secondyear|yeartwo)$/, seasons: 2, word: 'second-year' }
];
function badExperienceClaim(note) {
  // "second-year" and "year two" are two words on the page and one claim here.
  const ws = words(note.text).map(w => norm(w));
  const joined = ws.map((w, i) => (w === 'second' && ws[i + 1] === 'year') || (w === 'year' && ws[i + 1] === 'two') ? w + ws[i + 1] : w);
  const { found } = scan(note.text);
  const out = [];
  for (let i = 0; i < joined.length; i++) {
    const claim = CLAIMS.find(c => c.re.test(joined[i]));
    if (!claim) continue;
    // Whichever name sits closest, and only if it is close enough to be the one
    // being described — a note with no name nearby is generic advice.
    let near = null;
    for (const h of found) {
      const gap = h.at > i ? h.at - i - 1 : i - (h.at + h.span);
      if (gap <= CLAIM_REACH && (!near || gap < near.gap)) near = { h, gap };
    }
    if (!near) continue;
    const entered = ENTRY_YEAR[near.h.name];
    if (entered == null) { out.push(`no ENTRY_YEAR for ${near.h.name}, so "${claim.word}" cannot be checked`); continue; }
    const season = SEASON - entered + 1;
    if (season !== claim.seasons) out.push(`${near.h.name} is in season ${season} of ${SEASON}, not "${claim.word}"`);
  }
  return out;
}

// ── 1. the libraries are intact ───────────────────────────────────────────
console.log('\ninsight libraries');
const SETS = [
  ['FANTASY_FACTS', FANTASY_FACTS],
  ['PERF_NOTES.current', PERF_NOTES.current],
  ['PERF_NOTES.library', PERF_NOTES.library],
  ['BIDDING_NOTES', BIDDING_NOTES]
];
for (const [name, set] of SETS) {
  ok(`${name} is a non-empty list`, Array.isArray(set) && set.length > 0);
  ok(`${name} entries all carry a label and text`,
    set.every(n => n && typeof n.label === 'string' && n.label.trim() && typeof n.text === 'string' && n.text.trim()),
    JSON.stringify(set.find(n => !n || !n.label || !n.text) || ''));
  // The scroller shows one note at a time, and the dynamic notes that share the
  // slot are capped at 300 where they are built.
  const long = set.filter(n => n.text.length > 300).map(n => n.label);
  ok(`${name} entries all fit the scroller`, long.length === 0, long.join(', '));
}
ok('PERF_NOTES carries an update date',
  typeof PERF_NOTES.updated === 'string' && !Number.isNaN(Date.parse(PERF_NOTES.updated)), String(PERF_NOTES.updated));
ok('the player pool came through',
  PROJECTIONS.length > 300 && PROJECTIONS.every(p => p.name && p.team && p.position), String(PROJECTIONS.length));
ok(`the season reads as ${SEASON}`, SEASON >= 2020 && SEASON < 2100);

// ── 2. the rules, against what ships ──────────────────────────────────────
console.log('\nevergreen notes against the player pool');
for (const note of FANTASY_FACTS) {
  const strays = namesOffTheBoard(note);
  ok(`"${note.label}" names only players still on the board`, strays.length === 0, strays.join(', '));
  const off = wrongTeam(note);
  ok(`"${note.label}" keeps its players on the team it names`, off.length === 0, off.join('; '));
  const exp = badExperienceClaim(note);
  ok(`"${note.label}" dates its experience claims to ${SEASON}`, exp.length === 0, exp.join('; '));
}

console.log('\ndated notes against the player pool');
for (const note of PERF_NOTES.current) {
  const off = wrongTeam(note);
  ok(`"${note.label}" keeps its players on the team it names`, off.length === 0, off.join('; '));
}

// ── 3. the checks can still fail ──────────────────────────────────────────
// A name matcher that quietly stops matching turns every check above green.
// These are the notes exactly as they shipped before August 2026, and each one
// has to come back flagged.
console.log('\nthe checks still catch the notes that shipped wrong');
const CAUGHT = [
  ['a rookie claim a season past its rookie', badExperienceClaim, {
    label: 'Pair: Broncos backfield',
    text: 'J.K. Dobbins carries injury risk and RJ Harvey is an explosive rookie behind him. A dollar on each covers the Denver lead job.'
  }],
  ['a player who changed teams', wrongTeam, {
    label: 'Pair: Seahawks backfield',
    text: "Kenneth Walker's durability and Zach Charbonnet's knee make Seattle wide open. A dollar on each backs the side that ends up healthy and featured."
  }],
  ['two players who both left', wrongTeam, {
    label: 'Pair: Jaguars backfield',
    text: 'Travis Etienne and Tank Bigsby have flip-flopped for two years. The committee is cheap, and the winner is a weekly starter.'
  }],
  ['a player off the board entirely', namesOffTheBoard, {
    label: 'Pair: Cardinals backfield',
    text: "James Conner's age and injury history make Trey Benson the cheapest path to a featured back. Pair them for a dollar or two."
  }],
  ['a handcuff who is no longer rostered', namesOffTheBoard, {
    label: 'Pair: Packers handcuff',
    text: 'Josh Jacobs leads Green Bay, but MarShawn Lloyd at a dollar is a league-winner if Jacobs misses time. Stash the upside.'
  }],
  ['a back who slid off the depth chart', namesOffTheBoard, {
    label: 'Pair: Steelers backfield',
    text: 'Jaylen Warren (pass downs) and Kaleb Johnson (early downs) is a true split. Roster both and you hold whoever the job tilts toward.'
  }]
];
for (const [what, rule, note] of CAUGHT) {
  ok(`still catches ${what}`, rule(note).length > 0, 'came back clean');
}

// The other half of a useful checker: what it must leave alone.
console.log('\nand leaves sound notes alone');
const ALLOWED = [
  ['generic advice about rookies', badExperienceClaim, {
    label: 'Rookie RBs hit',
    text: 'Running back is the one spot where rookies routinely produce right away, so never auto-fade a rookie with a lead role.'
  }],
  ['a city that reads like a name', namesOffTheBoard, {
    label: 'Pair: Packers handcuff',
    text: 'Josh Jacobs leads Green Bay with Christopher Brooks the only back behind him.'
  }],
  ['a coach the prose names', namesOffTheBoard, {
    label: 'Pair: Saints backfield',
    text: 'Travis Etienne leads New Orleans, but Kellen Moore keeps Alvin Kamara in the rotation.'
  }],
  ['a sentence boundary between two capitals', namesOffTheBoard, {
    label: 'Pair: Vikings backfield',
    text: 'Aaron Jones and Jordan Mason both tend to go cheap in Minnesota. Buy both ends of the committee.'
  }],
  ['a former team named in passing', wrongTeam, {
    label: 'Pair: Saints backfield',
    text: 'Travis Etienne left Jacksonville on a four-year deal, and Alvin Kamara stayed in New Orleans.'
  }]
];
for (const [what, rule, note] of ALLOWED) {
  const found = rule(note);
  ok(`leaves ${what} alone`, found.length === 0, found.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
