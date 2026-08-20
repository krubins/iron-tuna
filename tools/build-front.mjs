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
//   PRESEASON<- every preseason article (headline, description, score/venue line,
//               the takeaway headings), newest first — the preseason takeaways rail.
//               One page per game (preseason-YYYY-MM-DD-away-home.html); the older
//               one-page-per-week shape (preseason-week-N.html) still reads.
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
  .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“');
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

// PRESEASON <- the preseason takeaways rail. Two page shapes feed it:
//   preseason-YYYY-MM-DD-away-home.html   one article per game (the 2026 shape)
//   preseason-week-N.html                 one article per week (the original shape)
// Per-game pages carry the date in the filename the way the auction-watch pages do,
// so a slate sorts chronologically and the Hall of Fame Game needs no week number.
// The rail's tag comes from the page's own eyebrow ("Preseason Week 1", "Hall of Fame
// Game"), not from the filename, because not every preseason game belongs to a week.
const PRESEASON_GAME = /^preseason-(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.html$/;
const PRESEASON_WEEK = /^preseason-week-(\d+)\.html$/;
const preseason = [];
for (const f of files.filter(f => PRESEASON_GAME.test(f) || PRESEASON_WEEK.test(f))) {
  const game = f.match(PRESEASON_GAME);
  const week = game ? null : +f.match(PRESEASON_WEEK)[1];
  const date = game ? game[1] : '';
  const s = read(f);
  const rawTitle = norm(s.match(/<title>([\s\S]*?)<\/title>/)[1].split('|')[0]);
  // "Preseason Week 2: the headline" / "Bengals 16, Lions 14: the headline"
  // -> headline on its own, the label already carried separately
  const headline = norm(rawTitle.replace(/^[^:]*:\s*/, '')) || rawTitle;
  const d = s.match(/<meta name="description" content="([^"]*)"/);
  // Comments are stripped first: the authoring template explains the structure in a
  // comment that mentions the tags, and those must not be scraped.
  const main = s.slice(s.indexOf('<main'), s.indexOf('<div class="cta-band"')).replace(/<!--[\s\S]*?-->/g, '');
  // The eyebrow is the rail's tag. Weekly pages predate it, so they fall back to the
  // week number in their filename rather than being skipped.
  const eb = main.match(/<div class="eyebrow">([\s\S]*?)<\/div>/);
  const label = (eb && norm(eb[1]) !== 'Preseason Takeaways' ? norm(eb[1]) : '') || (week ? 'Week ' + week : '');
  // The score-and-venue line, printed under the headline on the page and on the card.
  const gl = main.match(/<p class="gameline">([\s\S]*?)<\/p>/);
  // Each takeaway is an h2 inside <main>, minus the two closing CTA bands.
  const takeaways = [...main.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(m => norm(m[1]));
  preseason.push({
    week, label, date, headline, title: rawTitle,
    desc: d ? norm(d[1]) : '',
    gameline: gl ? norm(gl[1]) : '',
    takeaways,
    url: '/' + f.replace('.html', ''),
  });
}
// Newest game first. Dated per-game pages sort by date; undated weekly pages sort by
// week and sit behind them, so the two shapes can coexist without interleaving badly.
preseason.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.week || 0) - (a.week || 0));

let front = read('front.html');
const before = front;
front = front.replace(/var STORIES = \[[\s\S]*?\];\n/, 'var STORIES = ' + JSON.stringify(stories) + ';\n');
front = front.replace(/var PLAYERS = \{[\s\S]*?\};\n/, 'var PLAYERS = ' + JSON.stringify(Object.fromEntries(cast)) + ';\n');
front = front.replace(/var REPORTS = \[[\s\S]*?\];\n/, 'var REPORTS = ' + JSON.stringify(reports) + ';\n');
front = front.replace(/var PRESEASON = \[[\s\S]*?\];\n/, 'var PRESEASON = ' + JSON.stringify(preseason) + ';\n');
if (!/var STORIES = \[/.test(front) || !/var REPORTS = \[/.test(front) || !/var PLAYERS = \{/.test(front) || !/var PRESEASON = \[/.test(front)) {
  console.error('ABORT: could not find STORIES/REPORTS/PLAYERS/PRESEASON declarations in front.html');
  process.exit(1);
}
fs.writeFileSync(path.join(root, 'front.html'), front);
console.log(`front.html: ${stories.length} stories, ${reports.length} camp reports, ${cast.size} player photos, ${preseason.length} preseason articles${front === before ? ' (no change)' : ''}`);
