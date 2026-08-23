// Rebuilds the embedded data arrays in front.html (the "/" news front page) from the
// static pages that are the source of truth:
//   STORIES  <- every auction-insights-YYYY-MM-DD.html "call" section (title, position
//               label, priced view chip, named players) joined to tools/x-posts/insights_pool.json for
//               the play/stat lines. Each story also carries `deep` (1 when the call is a
//               structural read rather than a single-player call) and `topic` (the desk
//               label shown on the front page lead) and `team` (the NFL team the
//               call is about, used to colour the lead's plate). See DEEP/TOPICS
//               and TEAMS below.
//   REPORTS  <- every auction-watch-YYYY-MM-DD.html page (title + meta description),
//               newest first — this is the Training Camp & Preseason desk
//   PLAYERS  <- the headshot rows for every player named by a story above, looked up
//               in tools/nfl-headshots.json. Each story carries `ppl`, the slugs of
//               the players it names, and the lead renders their photos. A team
//               story that names nobody carries `tm` instead — the club whose
//               headline player stands in, which the band prints as its label.
//   PRESEASON<- every preseason-week-N.html page (headline, description, the
//               takeaway headings), newest week first — the weekly takeaways rail
//// It also writes two files outside front.html, from the same pass:
//   player-search.js  <- the lookup index behind the ribbon's search box and the
//               player card: one line per player the app prices, "slug|Name|TEAM|
//               POS|espnId|nflId". Identity only — no points and no prices, which
//               /it-league.js already answers correctly for both a reader with a
//               saved board and one without.
//   player.html <- the same STORIES array, so a player card can list every call
//               that names him without a second extraction that could disagree
//               with the front page about what the desk said.
//
// Run after adding a new insights drop page or a new auction-watch (camp/preseason)
// page:  node tools/build-front.mjs
// Run tools/build-headshots.mjs first if a story names a player who joined the
// league since the lookup was last refreshed — otherwise that player simply gets
// no photo, which is a missing face, never a wrong one.
// The script replaces the single-line `var STORIES = [...];` / `var REPORTS = [...];`
// declarations inside front.html in place. Date gating stays client-side, so future-
// dated drop pages are safe to embed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const unesc = t => t
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
  .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
  .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
  // Numeric entities too — the coaching column writes non-breaking hyphens as
  // &#8209; so a name like "zone-tree" cannot break across lines, and those must
  // not survive into the JSON as literal "&#8209;".
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
const norm = t => unesc(t).replace(/\s+/g, ' ').trim();

const pool = JSON.parse(read('tools/x-posts/insights_pool.json'));
const byTitle = new Map(pool.filter(p => p.format === 'auction').map(p => [p.title, p]));

const files = fs.readdirSync(root);

// ── deep-dive classification ───────────────────────────────────────────────
// The front page lead is reserved for calls that go BEYOND A SINGLE PLAYER —
// the coaching, offensive-line, schedule and rule-change reads that carry a
// whole roster's worth of consequence. The insight pages already make exactly
// that distinction: every call is labelled QB/RB/WR/TE (one player) or
// "Market" (a structural read). So `deep` is the site's own editorial call,
// not a keyword guess, which is why it does not drift as copy changes.
const isDeep = pos => String(pos).toLowerCase() === 'market';

// `topic` is only the desk label printed on the lead ("SCHEDULE", "OFFENSIVE
// LINE"...). Two rules keep it honest:
//   - the TITLE is matched first and the body only as a fallback, because the
//     title is the editorial summary — a passing "tie-breaking rule" halfway
//     down a body paragraph must not relabel an offensive-line story;
//   - every alternative is fully word-bounded, so "wind" cannot match "window".
// Most specific first: a schedule story that mentions a coaching staff in
// passing is still a schedule story. A miss costs a generic kicker, never a
// wrong story.
const TOPICS = [
  ['Rule change',    /\b(rules?|pup|onside|declaration|return.window|roster limits?)\b/i],
  ['Weather',        /\b(weather|cold|winds?|snow|domes?|outdoors?|lambeau)\b/i],
  ['Offensive line', /\b(offensive.lines?|o.line|line play|blocking|pass block|run block|tackles?|centers?|guards?|tunsil|linderbaum)\b/i],
  ['Schedule',       /\b(schedules?|bye weeks?|short weeks?|weekly.prep|calendar|late.season|playoff weeks?|front.half|opens softer)\b/i],
  ['Coaching',       /\b(coach|coaches|coaching|coordinators?|schemes?|play.call(er|ing)?|install|staff|systems?|personnel groups?)\b/i],
];
const matchTopic = text => {
  for (const [label, re] of TOPICS) if (re.test(text)) return label;
  return null;
};
const topicFor = (title, body) => matchTopic(title) || matchTopic(body) || 'Team trend';

// ── team detection, for the lead's artwork ─────────────────────────────────
// The front page draws an original team-coloured plate beside the lead, so each
// story needs to know whose story it is. Same discipline as the topic matcher:
// the TITLE is the editorial summary and is matched first, the body only as a
// fallback, so a rival mentioned in passing three paragraphs down cannot claim
// the artwork. A miss costs a neutral plate, never a wrong team's colours.
//
// Ambiguity is resolved by matching CITY and NICKNAME separately: "New York"
// alone cannot pick between the Giants and the Jets, so the bare city is not a
// key at all for shared markets — only "Giants"/"Jets" are. Same for Los
// Angeles and the two California pairs.
const TEAMS = [
  ['ARI', ['Arizona', 'Cardinals']],          ['ATL', ['Atlanta', 'Falcons']],
  ['BAL', ['Baltimore', 'Ravens']],           ['BUF', ['Buffalo', 'Bills']],
  ['CAR', ['Carolina', 'Panthers']],          ['CHI', ['Chicago', 'Bears']],
  ['CIN', ['Cincinnati', 'Bengals']],         ['CLE', ['Cleveland', 'Browns']],
  ['DAL', ['Dallas', 'Cowboys']],             ['DEN', ['Denver', 'Broncos']],
  ['DET', ['Detroit', 'Lions']],              ['GB',  ['Green Bay', 'Packers']],
  ['HOU', ['Houston', 'Texans']],             ['IND', ['Indianapolis', 'Colts']],
  ['JAX', ['Jacksonville', 'Jaguars']],       ['KC',  ['Kansas City', 'Chiefs']],
  ['LV',  ['Las Vegas', 'Raiders']],          ['LAC', ['Chargers']],
  ['LAR', ['Rams']],                          ['MIA', ['Miami', 'Dolphins']],
  ['MIN', ['Minnesota', 'Vikings']],          ['NE',  ['New England', 'Patriots']],
  ['NO',  ['New Orleans', 'Saints']],         ['NYG', ['Giants']],
  ['NYJ', ['Jets']],                          ['PHI', ['Philadelphia', 'Eagles']],
  ['PIT', ['Pittsburgh', 'Steelers']],        ['SF',  ['San Francisco', '49ers', 'Niners']],
  ['SEA', ['Seattle', 'Seahawks']],           ['TB',  ['Tampa Bay', 'Buccaneers', 'Bucs']],
  ['TEN', ['Tennessee', 'Titans']],           ['WAS', ['Washington', 'Commanders']]
];
const matchTeam = text => {
  // Earliest mention wins, so "Cleveland's environment should improve more than
  // Pittsburgh expects" is a Cleveland story, not a Pittsburgh one.
  let best = null, at = Infinity;
  for (const [abbr, names] of TEAMS) {
    for (const n of names) {
      const m = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').exec(text);
      if (m && m.index < at) { at = m.index; best = abbr; }
    }
  }
  return best;
};
// TITLE ONLY — deliberately. The body fallback that works for topics is too
// loose here: "Offensive-line dispersion matters more this year" is a
// league-wide piece that happens to cite Buffalo in paragraph three, and body
// matching handed it Buffalo's colours. A league-wide story should get the
// neutral plate, so if the headline does not name a team, nothing does.
const teamFor = (title) => matchTeam(title) || null;
// ── player photos ──────────────────────────────────────────────────────────
// The lead runs a photo of the players its story is actually about. Names are
// matched against tools/nfl-headshots.json (built from the nflverse players
// release by tools/build-headshots.mjs), never guessed, so a photo can only
// ever appear for a player the copy really names.
//
// Matching rules that keep the wrong face off the front page:
//   - full first + last name only. A bare "Brown" or "Smith" is ambiguous and
//     is ignored; article copy names a player in full on first mention anyway.
//   - longest name first, so "Marvin Harrison Jr." wins over "Marvin Harrison"
//     and the two never both fire on one sentence.
//   - the generational suffix is optional in the copy ("Michael Penix" matches
//     Michael Penix Jr.), because that is how the desk writes it.
//
// Ranking is editorial, not alphabetical: a player named in the headline leads,
// then whoever the body leans on most, then order of first mention. The lead
// shows at most LEAD_FACES of them.
const LEAD_FACES = 3;
const headshots = JSON.parse(read('tools/nfl-headshots.json'));
const SUFFIX = /\s+(?:Jr\.?|Sr\.?|I{2,3}|IV|V)$/i;
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Same slug rule tools/build-headshots.mjs keys its rows by, so a name read out
// of the projections lands on the right headshot row.
const slug = name => name.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// One player can be written more than one way, so index every spelling we are
// willing to accept and point them all at the same roster entry.
const nameIndex = new Map();
for (const pl of headshots) {
  const bare = pl.n.replace(SUFFIX, '').trim();
  for (const variant of new Set([pl.n, bare])) {
    if (variant.trim().split(/\s+/).length < 2) continue;   // last name alone: too ambiguous
    if (!nameIndex.has(variant)) nameIndex.set(variant, pl);
  }
}
const NAME_RE = new RegExp(
  '\\b(' + [...nameIndex.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|') + ')\\b',
  'g',
);

const findPlayers = (title, body) => {
  const rank = new Map();   // slug -> {pl, hits, first, inTitle}
  const scan = (text, inTitle) => {
    for (const m of String(text).matchAll(NAME_RE)) {
      const pl = nameIndex.get(m[1]);
      if (!pl) continue;
      const cur = rank.get(pl.k);
      if (cur) { cur.hits++; cur.inTitle = cur.inTitle || inTitle; }
      else rank.set(pl.k, { pl, hits: 1, first: m.index, inTitle });
    }
  };
  scan(title, true);
  scan(body, false);
  return [...rank.values()]
    .sort((a, b) => (b.inTitle - a.inTitle) || (b.hits - a.hits) || (a.first - b.first))
    .slice(0, LEAD_FACES)
    .map(r => r.pl.k);
};

// Only the players actually named on the front page get embedded, so the page
// carries a handful of roster rows rather than the whole league.
const cast = new Map();
const enlist = keys => {
  for (const k of keys) {
    if (cast.has(k)) continue;
    const pl = headshots.find(p => p.k === k);
    if (pl) cast.set(k, { n: pl.n, t: pl.t, p: pl.p, e: pl.e, h: pl.h });
  }
};

// ── the team's face, for a story that names nobody ─────────────────────────
// Some deep dives are about a whole team — a schedule, a coaching staff, an
// offensive line — and name no player. Those run the team's headline player
// instead, and the band says so: it is labelled with the team, not "In this
// story", so the photo never implies a quote the story never made.
//
// "Headline player" is the site's own answer, not a popularity guess: the
// highest full-PPR projection on that roster, read straight out of the
// PROJECTIONS block in _worker.js that prices the whole app.

// Full-PPR season points, the ranking the whole site is priced on. Only the
// order matters here, so the default scoring is enough — no league settings.
const ppr = s =>
  (s.passYd || 0) / 25 + (s.passTD || 0) * 4 - (s.passInt || 0) * 2 +
  (s.rushYd || 0) / 10 + (s.rushTD || 0) * 6 +
  (s.recYd || 0) / 10 + (s.recTD || 0) * 6 + (s.rec || 0) - (s.fumLost || 0) * 2;

const worker = read('_worker.js');
const projStart = worker.indexOf('const PROJECTIONS = [');
if (projStart < 0) {
  console.error('ABORT: could not find PROJECTIONS in _worker.js');
  process.exit(1);
}
const projBlock = worker.slice(projStart, worker.indexOf('\n];', projStart));
const bySlug = new Map(headshots.map(p => [p.k, p]));
const depth = new Map();   // team -> [{slug, pts}] best first
const priced = [];         // every skill player the app puts a price on
for (const m of projBlock.matchAll(
  /\{\s*name:\s*"([^"]+)",\s*position:\s*"([^"]+)",\s*team:\s*"([^"]*)",\s*projectedStats:\s*\{([^}]*)\}/g)) {
  const [, name, pos, rawTeam] = m;
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;   // no kickers or defenses as a team's face
  const team = rawTeam === 'JAC' ? 'JAX' : rawTeam;        // both spellings appear in the projections
  if (!team || team === 'FA') continue;                    // a free agent is nobody's face
  const stats = Object.fromEntries([...m[4].matchAll(/(\w+)\s*:\s*(-?[\d.]+)/g)].map(s => [s[1], +s[2]]));
  const pts = ppr(stats);
  if (!depth.has(team)) depth.set(team, []);
  depth.get(team).push({ k: slug(name), pts });
  priced.push({ k: slug(name), n: name, pos, pts });
}
for (const list of depth.values()) list.sort((a, b) => b.pts - a.pts);

// ── the player lookup index (player-search.js) ─────────────────────────────
// Every player the app puts a price on, in the projections' own order, joined
// to whichever headshot row shares his slug. Written as one delimited line each
// rather than JSON: it is ~400 rows of five short fields, and the delimited
// form is a third of the size for exactly the same data. The two headshot hosts
// each key a player by one id, so only the ids travel and player-search.js
// rebuilds the URLs.
//
// SCOPE IS THE WHOLE PRICED POOL, kickers and defences included. They carry no
// editorial and no photo, and player-search.js sorts them below the skill
// players for that reason — but a reader who types "Bates" and is told the
// board has never heard of him has been told something untrue.
//
// THE SLUG IS THE HEADSHOT ROW'S, NOT THE PROJECTION NAME'S, wherever the two
// can be joined. Every story already carries `ppl` — the headshot slugs of the
// players it names — and a card keyed the other way could not find the calls
// written about the player it is a card for. The projections and the nflverse
// release do not always spell a man the same way ("Chigoziem Okonkwo" against
// "Chig Okonkwo", "Deebo Samuel" against "Deebo Samuel Sr."), so an exact slug
// match is tried first and a club-and-position match on the surname second —
// narrow enough that it is one man or nobody, and an ambiguous surname resolves
// to nothing rather than to the wrong face and the wrong article list.
const NFL_SHOT = 'https://static.www.nfl.com/image/upload/f_auto,q_auto/league/';
const lastName = (n) => slug(n.replace(SUFFIX, '').trim().split(/\s+/).pop());
const byClub = new Map();                                // "TEAM|POS|lastname" -> rows
for (const pl of headshots) {
  const key = pl.t + '|' + pl.p + '|' + lastName(pl.n);
  byClub.set(key, (byClub.get(key) || []).concat(pl));
}
const searchRows = [];
const seenSlug = new Set();
for (const m of projBlock.matchAll(
  /\{\s*name:\s*"([^"]+)",\s*position:\s*"([^"]+)",\s*team:\s*"([^"]*)"/g)) {
  const [, name, pos, rawTeam] = m;
  const team = (rawTeam === 'JAC' ? 'JAX' : rawTeam) || 'FA';
  let shot = bySlug.get(slug(name));
  if (!shot) {
    const near = byClub.get(team + '|' + pos + '|' + lastName(name)) || [];
    if (near.length === 1) shot = near[0];
  }
  const k = shot ? shot.k : slug(name);
  if (!k || seenSlug.has(k)) continue;                   // first spelling wins
  seenSlug.add(k);
  // A delimiter inside a field would silently split the row into nonsense, so
  // it fails the build instead. Neither character occurs in an NFL name today.
  for (const field of [name, team, pos]) {
    if (/[|\n]/.test(field)) {
      console.error(`ABORT: "${field}" contains the player-index delimiter`);
      process.exit(1);
    }
  }
  searchRows.push([k, name, team, pos, shot ? shot.e : '',
                   shot ? String(shot.h).replace(NFL_SHOT, '') : ''].join('|'));
}

// Walk down the depth chart until someone has a photo, so a team whose leader
// is too new for the headshot release still gets a face rather than none.
const teamFace = ab => (depth.get(ab) || []).map(r => r.k).find(k => bySlug.has(k)) || null;

// ── a bare name with no team anywhere ──────────────────────────────────────
// "Maye's 2025 efficiency profile was not fluky" names a player and nothing
// else: no full name, no club. Reading a lone surname against the whole league
// would be reckless, but against the ~345 players this app actually prices, and
// only at the position the call itself is filed under, it is a narrow question:
// among priced quarterbacks, "Maye" is one man.
//
// Where it is still not one man, the projection settles it — but only when the
// gap is decisive. "Allen" at QB is Josh (357 points) and Kyle (4); a call about
// "another QB1 finish" is plainly the former, and DOMINANCE keeps the rule from
// quietly picking a favourite in a genuine tie. Title only: this is the widest
// net in the file, and a headline is a deliberate sentence, where a capitalised
// word is a name rather than prose that happened to start a sentence.
const DOMINANCE = 5;
const pricedByPos = new Map();
for (const pl of priced) {
  if (!bySlug.has(pl.k)) continue;                       // no photo, nothing to show
  if (!pricedByPos.has(pl.pos)) pricedByPos.set(pl.pos, new Map());
  const idx = pricedByPos.get(pl.pos);
  for (const tok of pl.n.replace(SUFFIX, '').trim().split(/\s+/).filter((_, i, a) => i === 0 || i === a.length - 1)) {
    if (tok.length < 4) continue;
    idx.set(tok, (idx.get(tok) || []).concat(pl));
  }
}
const findByPricedName = (pos, title) => {
  const idx = pricedByPos.get(pos);
  if (!idx) return [];
  const re = new RegExp('\\b(' + [...idx.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|') + ')\\b', 'g');
  const out = [];
  for (const m of String(title).matchAll(re)) {
    const runners = idx.get(m[1]).slice().sort((a, b) => b.pts - a.pts);
    if (runners.length > 1 && !(runners[0].pts >= DOMINANCE * Math.max(runners[1].pts, 1))) continue;
    if (!out.includes(runners[0].k)) out.push(runners[0].k);
  }
  return out.slice(0, LEAD_FACES);
};

// ── short names ────────────────────────────────────────────────────────────
// Headlines drop the first name once a player is established — "Bowers",
// "Kyren", "Kraft". Resolving those league-wide would be reckless (half the
// league answers to "Williams", and "Likely" is an ordinary English word), so
// a bare name is only read against the roster of the team the story is about,
// and only when exactly one player there answers to it. Anything ambiguous is
// left unmatched: a missing face costs nothing, a wrong one costs trust.
const rosters = new Map();
for (const pl of headshots) {
  if (!rosters.has(pl.t)) rosters.set(pl.t, []);
  rosters.get(pl.t).push(pl);
}
const shortIndex = ab => {
  const idx = new Map();
  for (const pl of rosters.get(ab) || []) {
    const parts = pl.n.replace(SUFFIX, '').trim().split(/\s+/);
    for (const tok of [parts[0], parts[parts.length - 1]]) {
      if (!tok || tok.length < 4) continue;                   // "Cam", "Bo": too short to be safe
      idx.set(tok, idx.has(tok) ? null : pl);                 // null marks the name as taken twice
    }
  }
  return idx;
};
const findByShortName = (ab, title, body) => {
  const idx = shortIndex(ab);
  const names = [...idx.keys()].filter(t => idx.get(t)).sort((a, b) => b.length - a.length);
  if (!names.length) return [];
  // Case-sensitive on purpose: it is what separates the tight end Likely from
  // the adverb likely.
  const re = new RegExp('\\b(' + names.map(reEsc).join('|') + ')\\b', 'g');
  const rank = new Map();
  const scan = (text, inTitle) => {
    for (const m of String(text).matchAll(re)) {
      const pl = idx.get(m[1]);
      const cur = rank.get(pl.k);
      if (cur) { cur.hits++; cur.inTitle = cur.inTitle || inTitle; }
      else rank.set(pl.k, { pl, hits: 1, first: m.index, inTitle });
    }
  };
  scan(title, true);
  scan(body, false);
  return [...rank.values()]
    .sort((a, b) => (b.inTitle - a.inTitle) || (b.hits - a.hits) || (a.first - b.first))
    .slice(0, LEAD_FACES)
    .map(r => r.pl.k);
};

const stories = [];
for (const f of files.filter(f => /^auction-insights-\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort()) {
  const date = f.match(/(\d{4}-\d{2}-\d{2})/)[1];
  const s = read(f);
  for (const m of s.matchAll(/<section class="call" id="call-(\d+)">([\s\S]*?)<\/section>/g)) {
    const blk = m[2];
    const title = norm(blk.match(/<h2>([\s\S]*?)<\/h2>/)[1]);
    const cpos = blk.match(/<span class="cpos">([\s\S]*?)<\/span>/);
    const chip = blk.match(/<span class="chip (\w+)">([\s\S]*?)<\/span>/);
    const p = byTitle.get(title) || {};
    const pos = cpos ? norm(cpos[1]) : '';
    const body = norm(blk.replace(/<[^>]+>/g, ' '));
    const deep = isDeep(pos);
    const story_team = teamFor(title);
    let ppl = findPlayers(title, body), teamLabel = '';
    if (!ppl.length) {
      // Nobody named in full. Two different questions follow, and they deserve
      // two different levels of caution:
      //
      //   which roster does a bare "Bowers" belong to?  The body may answer it.
      //     Reading a surname against the wrong roster simply fails to match.
      //   whose face do we put up when nobody was named?  Title only, per the
      //     plate's rule above. A league-wide piece that cites Buffalo in
      //     paragraph three must not end up fronted by a Bill.
      const nameScope = story_team || matchTeam(body);
      if (nameScope) ppl = findByShortName(nameScope, title, body);
      // Still nothing, and no club to read against either: fall back to the
      // priced roster at this call's own position.
      if (!ppl.length && ['QB', 'RB', 'WR', 'TE'].includes(pos)) ppl = findByPricedName(pos, title);
      if (!ppl.length && story_team) {
        const face = teamFace(story_team);
        if (face) { ppl = [face]; teamLabel = story_team; }
      }
    }
    enlist(ppl);
    stories.push({
      title,
      pos,
      view: chip ? norm(chip[2]) : '',
      viewCls: chip ? chip[1] : '',
      play: p.play || '',
      stat: p.stat || '',
      date,
      url: '/' + f.replace('.html', '') + '#call-' + m[1],
      ...(deep ? { deep: 1, topic: topicFor(title, body) } : {}),
      ...(story_team ? { team: story_team } : {}),
      ...(ppl.length ? { ppl } : {}),
      ...(teamLabel ? { tm: teamLabel } : {}),
    });
  }
}

const reports = [];
for (const f of files.filter(f => /^auction-watch-\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse()) {
  const date = f.match(/(\d{4}-\d{2}-\d{2})/)[1];
  const s = read(f);
  const title = norm(s.match(/<title>([\s\S]*?)<\/title>/)[1].split('|')[0]);
  const d = s.match(/<meta name="description" content="([^"]*)"/);
  reports.push({ date, title, desc: d ? norm(d[1]) : '', url: '/' + f.replace('.html', '') });
}

// ── the coaching column ────────────────────────────────────────────────────
// play-caller-premium.html is the source of truth, exactly as the drop pages
// are for STORIES: each <article class="call"> yields its chip, position, team,
// date, headline, and the named players out of its "Who it moves" line. Adding
// entries to the column therefore updates the front page by re-running this
// script, with no second copy of the copy to keep in sync.
// Cap on a word boundary, never mid-word, and only add an ellipsis when
// something was actually dropped.
const clip = (t, n) => {
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 0)).replace(/[,;:.\s]+$/, '') + '…';
};

const column = [];
{
  const src = read('play-caller-premium.html');
  const re = /<article class="call" id="([^"]+)">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(src))) {
    const [id, block] = [m[1], m[2]];
    const chip = (block.match(/<span class="chip ([a-z]+)">([^<]*)<\/span>/) || []);
    const pos = norm((block.match(/<span class="cpos">([^<]*)<\/span>/) || [])[1] || '');
    const team = norm((block.match(/<span class="cteam">([^<]*)<\/span>/) || [])[1] || '');
    const title = norm((block.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '');
    // Tags out before entities in: the line is written with <b> around every
    // player it names, and the card wants the sentence, not the markup. Only the
    // first sentence rides along — the card is a doorway, not the entry.
    const whoRaw = norm(((block.match(/<p class="who">([\s\S]*?)<\/p>/) || [])[1] || '')
      .replace(/<[^>]*>/g, ''));
    const who = clip(whoRaw.replace(/^Who it moves:\s*/i, ''), 165);
    const stat = norm(((block.match(/<p class="statline">([\s\S]*?)<\/p>/) || [])[1] || '')
      .replace(/<[^>]*>/g, '')).replace(/^Projected effect:\s*/i, '');
    if (!title) continue;
    // The named players are the <b> spans inside the "Who it moves" line, which
    // is the only place the column commits to a player — a name in the prose
    // above it is context, not a call, and must not claim a photo.
    const named = [...(((block.match(/<p class="who">([\s\S]*?)<\/p>/) || [])[1]) || '')
      .matchAll(/<b>([^<]+)<\/b>/g)].map(x => norm(x[1])).filter(n => !/^Who it moves/i.test(n));
    const keys = named.map(n => slug(n)).filter(k => bySlug.has(k));
    enlist(keys);
    column.push({
      id, title, pos, team,
      date: (id.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '',
      side: chip[1] || '', label: norm(chip[2] || ''),
      who, stat, url: '/play-caller-premium#' + id,
      ppl: keys
    });
  }
  column.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ── The Pick ───────────────────────────────────────────────────────────────
// the-pick.html is the source of truth, same discipline as the coaching column
// above: one themed story a day, and the front page quotes it rather than
// keeping a second copy of the copy. What the card needs that the coaching card
// does not is the THEME — the whole conceit of this column is that each entry
// argues one idea, so the theme is the kicker and the headline is the payoff.
const picks = [];
{
  const src = read('the-pick.html');
  const re = /<article class="call pick" id="([^"]+)">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(src))) {
    const [id, block] = [m[1], m[2]];
    // The chip carries "Theme: tier cliffs". The card prints the theme alone —
    // it already sits under a heading that says what column this is.
    const theme = norm((block.match(/<span class="chip theme">([^<]*)<\/span>/) || [])[1] || '')
      .replace(/^Theme:\s*/i, '');
    const pos = norm((block.match(/<span class="cpos">([^<]*)<\/span>/) || [])[1] || '');
    const team = norm((block.match(/<span class="cteam">([^<]*)<\/span>/) || [])[1] || '');
    const title = norm((block.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '');
    const dek = norm(((block.match(/<p class="dek">([\s\S]*?)<\/p>/) || [])[1] || '').replace(/<[^>]*>/g, ''));
    const whoHtml = ((block.match(/<p class="who">([\s\S]*?)<\/p>/) || [])[1] || '');
    const who = clip(norm(whoHtml.replace(/<[^>]*>/g, '')).replace(/^The Pick:\s*/i, ''), 190);
    const stat = norm(((block.match(/<p class="statline">([\s\S]*?)<\/p>/) || [])[1] || '')
      .replace(/<[^>]*>/g, '')).replace(/^Projected effect:\s*/i, '');
    if (!title) continue;
    // Same rule as the coaching column: only the <b> spans inside the pick line
    // are a commitment, and the "The Pick:" label is a label, not a player.
    const named = [...whoHtml.matchAll(/<b>([^<]+)<\/b>/g)]
      .map(x => norm(x[1])).filter(n => !/^The Pick/i.test(n));
    const keys = named.map(n => slug(n)).filter(k => bySlug.has(k));
    enlist(keys);
    picks.push({
      id, theme, title, dek, pos, team,
      date: (id.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '',
      who, stat, url: '/the-pick#' + id,
      ppl: keys,
    });
  }
  picks.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// PRESEASON <- every preseason-week-N.html page: the takeaways article for one week
// of preseason games. Sorted by week number so the newest week leads the desk.
const preseason = [];
for (const f of files.filter(f => /^preseason-week-\d+\.html$/.test(f))) {
  const week = +f.match(/preseason-week-(\d+)/)[1];
  const s = read(f);
  const rawTitle = norm(s.match(/<title>([\s\S]*?)<\/title>/)[1].split('|')[0]);
  // "Preseason Week 2: the headline" -> headline on its own, week already known
  const headline = norm(rawTitle.replace(/^Preseason Week\s*\d+\s*[:\u2014-]\s*/i, ''));
  const d = s.match(/<meta name="description" content="([^"]*)"/);
  // Each takeaway is an h2 inside <main>, minus the two closing CTA bands.
  // Comments are stripped first: the authoring template explains the structure in a
  // comment that mentions the tags, and those must not be scraped as takeaways.
  const main = s.slice(s.indexOf('<main'), s.indexOf('<div class="cta-band"')).replace(/<!--[\s\S]*?-->/g, '');
  const takeaways = [...main.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(m => norm(m[1]));
  preseason.push({
    week, headline, title: rawTitle,
    desc: d ? norm(d[1]) : '',
    takeaways,
    url: '/' + f.replace('.html', ''),
  });
}
preseason.sort((a, b) => b.week - a.week);

let front = read('front.html');
const before = front;
front = front.replace(/var STORIES = \[[\s\S]*?\];\n/, 'var STORIES = ' + JSON.stringify(stories) + ';\n');
front = front.replace(/var PLAYERS = \{[\s\S]*?\};\n/, 'var PLAYERS = ' + JSON.stringify(Object.fromEntries(cast)) + ';\n');
front = front.replace(/var REPORTS = \[[\s\S]*?\];\n/, 'var REPORTS = ' + JSON.stringify(reports) + ';\n');
front = front.replace(/var COLUMN = \[[\s\S]*?\];\n/, 'var COLUMN = ' + JSON.stringify(column) + ';\n');
front = front.replace(/var PICKS = \[[\s\S]*?\];\n/, 'var PICKS = ' + JSON.stringify(picks) + ';\n');

// ── static camp desk, for crawlers that never run the script ────────────────
// The camp desk used to be built entirely on the client out of REPORTS, which
// left every auction-watch page with no <a href> pointing at it anywhere in the
// served HTML — reachable only from sitemap.xml. Googlebot renders JS on a
// second pass, but Bing and the AI answer-engine crawlers robots.txt explicitly
// welcomes (GPTBot, PerplexityBot, ClaudeBot) generally do not, so the whole
// camp desk was invisible to them.
//
// So the same markup the client would produce is written into the page at build
// time. The client render replaces campNote/campFeat and clears campList before
// refilling it, so what a reader sees is unchanged and the two cannot drift.
const escText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const fmtDate = (d) => { const p = d.split('-'); return `${MONTHS[+p[1] - 1]} ${+p[2]}, ${p[0]}`; };
const fmtShort = (d) => { const p = d.split('-'); return `${MONTHS[+p[1] - 1].slice(0, 3)} ${+p[2]}`; };

if (reports.length) {
  const f = reports[0];
  const note = 'Verified, auction-relevant signals from camps and preseason games. '
    + `This desk updates as news breaks — <b>latest report: ${fmtDate(f.date)}</b>.`;
  const feat = '<span><span class="badge badge-pos">Latest report</span></span>'
    + `<h3><a href="${f.url}">${escText(f.title)}</a></h3>`
    + `<p>${escText(f.desc)}</p>`
    + `<a class="lead-link" href="${f.url}">Read the report &rarr;</a>`;
  // Four, not all of them. The desk used to print every report ever published —
  // 24 rows of "Auction Watch: <date>" reaching back to June, which is a
  // directory listing rather than a section, and the single densest block of
  // near-identical link text on the page. The archive at /auction-watch is where
  // the run lives now; the front page carries the latest and the last four.
  const CAMP_ON_FRONT = 4;
  const list = reports.slice(1, 1 + CAMP_ON_FRONT)
    .map(r => `<li><span class="cd">${fmtShort(r.date)}</span><a href="${r.url}">${escText(r.title)}</a></li>`)
    .join('');
  front = front.replace(/<p class="camp-note" id="campNote">[\s\S]*?<\/p>/, `<p class="camp-note" id="campNote">${note}</p>`);
  front = front.replace(/<div class="camp-feat" id="campFeat">[\s\S]*?<\/div>/, `<div class="camp-feat" id="campFeat">${feat}</div>`);
  front = front.replace(/<ul class="camp-list" id="campList">[\s\S]*?<\/ul>/, `<ul class="camp-list" id="campList">${list}</ul>`);
  if (!front.includes(`<ul class="camp-list" id="campList">${list}</ul>`)) {
    console.error('ABORT: could not write the static camp desk into front.html');
    process.exit(1);
  }
}
// ── the camp archive: /auction-watch ─────────────────────────────────────────
// Every report, newest first, on a page of its own. The front page's desk shows
// the latest plus four; this is where the other twenty live, and it is what the
// "Every report" link and the camp reports' own breadcrumb (build-seo.mjs) point
// at. Generated from the same scan, so the two can never disagree about what has
// been published.
if (reports.length) {
  const watchFile = path.join(root, 'auction-watch.html');
  const watchBefore = fs.readFileSync(watchFile, 'utf8');
  const rows = reports
    .map(r => `<li><span class="wd">${fmtShort(r.date)}</span><a href="${r.url}">${escText(r.title)}</a>`
      + `<p>${escText(r.desc)}</p></li>`)
    .join('');
  const watchNext = watchBefore.replace(
    /<ul class="watch-list" id="watchList">[\s\S]*?<\/ul>/,
    `<ul class="watch-list" id="watchList">${rows}</ul>`);
  if (!watchNext.includes(`<ul class="watch-list" id="watchList">${rows}</ul>`)) {
    console.error('ABORT: could not write the camp archive into auction-watch.html');
    process.exit(1);
  }
  if (watchNext !== watchBefore) fs.writeFileSync(watchFile, watchNext);
}

front = front.replace(/var PRESEASON = \[[\s\S]*?\];\n/, 'var PRESEASON = ' + JSON.stringify(preseason) + ';\n');
if (!/var STORIES = \[/.test(front) || !/var REPORTS = \[/.test(front) || !/var PLAYERS = \{/.test(front) || !/var COLUMN = \[/.test(front) || !/var PICKS = \[/.test(front) || !/var PRESEASON = \[/.test(front)) {
  console.error('ABORT: could not find STORIES/REPORTS/PLAYERS/COLUMN/PICKS/PRESEASON declarations in front.html');
  process.exit(1);
}
fs.writeFileSync(path.join(root, 'front.html'), front);
console.log(`front.html: ${stories.length} stories, ${reports.length} camp reports, ${cast.size} player photos, ${picks.length} picks, ${preseason.length} preseason weeks${front === before ? ' (no change)' : ''}`);

// ── player-search.js: the lookup index ─────────────────────────────────────
// Replaced between the same sentinels tools/build-default-board.mjs uses in
// /it-league.js, so this only ever rewrites its own block and the hand-written
// widget around it is never touched.
{
  const file = 'player-search.js';
  const src = read(file);
  const START = '  // ── generated by tools/build-front.mjs — do not hand-edit ──\n';
  const END = '  // ── end generated ──';
  const i = src.indexOf(START), j = src.indexOf(END);
  if (i < 0 || j < 0 || j < i) {
    console.error(`ABORT: could not find the generated block in ${file}`);
    process.exit(1);
  }
  const next = src.slice(0, i) + START
    + '  var INDEX_RAW = ' + JSON.stringify(searchRows.join('\n')) + ';\n'
    + src.slice(j);
  const changed = next !== src;
  if (changed) fs.writeFileSync(path.join(root, file), next);
  console.log(`${file}: ${searchRows.length} players${changed ? '' : ' (no change)'}`);
}

// ── player.html: the calls that name a player ──────────────────────────────
// The SAME `stories` array the front page just got. A card that listed calls
// extracted a second time could disagree with the front page about what the
// desk said, which is the one thing a player card must never do.
{
  const file = 'player.html';
  const src = read(file);
  if (!/^var STORIES = \[[\s\S]*?\];$/m.test(src)) {
    console.error(`ABORT: could not find the STORIES declaration in ${file}`);
    process.exit(1);
  }
  const next = src.replace(/^var STORIES = \[[\s\S]*?\];$/m,
    () => 'var STORIES = ' + JSON.stringify(stories) + ';');
  const changed = next !== src;
  if (changed) fs.writeFileSync(path.join(root, file), next);
  console.log(`${file}: ${stories.length} stories${changed ? '' : ' (no change)'}`);
}
