// Reading player names out of hand-written prose, held against the board.
//
// This started inside tools/test-insights.mjs, which exists because the site's
// notes quietly outlive the roster they describe (its header tells that story).
// It moved here when a second checker needed the same matcher:
// tools/test-advice-names.mjs asks a different question of the same sentences —
// not "is this name still on the board" but "can the reader actually do what
// this note tells him to do".
//
// One copy, because a name matcher that quietly stops matching turns every
// check that uses it green. Two copies drift, and the drift is invisible
// exactly when it matters.

// Scans the literal after `const NAME =` bracket by bracket rather than slicing
// to whatever happens to be declared next, so moving a declaration around does
// not quietly turn a check into a no-op.
export function literalAfter(src, name) {
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

// One normaliser for both sides, so "A.J. Brown", "RJ Harvey" and "Brown's"
// reduce the same way whether they come from the pool or from a sentence.
// Words, not characters: matching on token runs is what keeps "Love" from
// landing inside "Loveland" and "Rookie Jadarian" from reading as a name.
export const norm = w => String(w).toLowerCase().replace(/[’']s$/, '').replace(/[^a-z]/g, '');
export const words = text => String(text).split(/\s+/).filter(Boolean);
export const keyOf = ws => ws.map(norm).filter(Boolean).join(' ');
const SUFFIX = /\s(jr|sr|ii|iii|iv|v)$/;

export const TEAMS = {
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
export const NOT_PEOPLE = new Set([
  ...Object.keys(TEAMS),
  'Arizona', 'Atlanta', 'Baltimore', 'Buffalo', 'Carolina', 'Chicago', 'Cincinnati',
  'Cleveland', 'Dallas', 'Denver', 'Detroit', 'Green', 'Bay', 'Houston', 'Indianapolis',
  'Jacksonville', 'Kansas', 'City', 'Las', 'Vegas', 'Los', 'Angeles', 'Miami',
  'Minnesota', 'New', 'England', 'Orleans', 'York', 'Philadelphia', 'Pittsburgh',
  'San', 'Francisco', 'Seattle', 'Tampa', 'Tennessee',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Kellen', 'Moore', 'Liam', 'Coen', 'Dave', 'Canales', 'Mike', 'McCarthy', 'Andy', 'Reid',
  'Shane', 'Steichen'
].map(norm));

// Imperative verbs this prose opens sentences with. "Fade Jacobs above stash
// pricing" is a capitalised word followed by a surname, which is the exact
// shape of a name, so without this the advice reports its own verb as somebody
// called Fade. Checked at the FIRST word only, and kept to words that are not
// also first names: Chase (Chase Brown), Price and Love all stay off it, or the
// list would start hiding real players from the very check it feeds.
export const NOT_FIRST_NAME = new Set([
  'fade', 'buy', 'grab', 'add', 'stash', 'draft', 'bid', 'roster', 'avoid',
  'treat', 'pay', 'target', 'nominate', 'bench', 'sell', 'hold', 'start',
  'take', 'get', 'keep', 'leave', 'pair', 'stream', 'trade'
].map(norm));

export const teamInLabel = label => {
  for (const [word, code] of Object.entries(TEAMS)) {
    if (new RegExp(`\\b${word}\\b`).test(label)) return { word, code };
  }
  return null;
};

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

// Everything below needs the board, so it comes back bound to one pool. Pass
// PROJECTIONS (or any [{name, position, team}]).
export function proseNames(pool) {
  // Every pool name, indexed with and without its suffix so prose that says
  // "Tyrone Tracy" still finds "Tyrone Tracy Jr." on the board.
  const byName = new Map();
  for (const p of pool) {
    const full = keyOf(words(p.name));
    for (const k of new Set([full, full.replace(SUFFIX, '')])) {
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);
    }
  }
  const LONGEST = Math.max(...[...byName.keys()].map(k => k.split(' ').length));

  // Walks the sentence claiming the longest run of words that names somebody on
  // the board. Returns each hit with the word it started at, which is what the
  // experience-claim rule uses to tell which name a claim is attached to.
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

  // Capitalised pairs the pool did not claim, with the word each starts at so a
  // caller can ask what the sentence was doing to that name. The bare-string
  // shape the older checks expect is `.map(s => s.text)`.
  function strayNames(text) {
    const { ws, claimed } = scan(text);
    const out = [];
    for (let i = 0; i + 1 < ws.length; i++) {
      if (claimed.has(i) || claimed.has(i + 1)) continue;
      const a = ws[i].replace(/[,;:]$/, ''), b = ws[i + 1].replace(/[,;:.]$/, '');
      if (!CAPPED.test(a) || !SURNAME.test(b)) continue;
      if (NOT_FIRST_NAME.has(norm(a))) continue;
      if (ENDS_SENTENCE.test(a) && !/^(?:[A-Z]\.){1,3}$/.test(a)) continue;
      if (NOT_PEOPLE.has(norm(a)) || NOT_PEOPLE.has(norm(b))) continue;
      out.push({ at: i, span: 2, text: `${a} ${b}` });
    }
    return out;
  }

  return { byName, LONGEST, scan, strayNames };
}
