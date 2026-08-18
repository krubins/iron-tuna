// Rebuilds the embedded data arrays in front.html (the "/" news front page) from the
// static pages that are the source of truth:
//   STORIES  <- every auction-insights-YYYY-MM-DD.html "call" section (title, position
//               label, priced view chip, named players) joined to tools/x-posts/insights_pool.json for
//               the play/stat lines. Each story also carries `deep` (1 when the call is a
//               structural read rather than a single-player call) and `topic` (the desk
//               label shown on the front page lead). See DEEP/TOPICS below.
//   REPORTS  <- every auction-watch-YYYY-MM-DD.html page (title + meta description),
//               newest first — this is the Training Camp & Preseason desk
//   PLAYERS  <- the headshot rows for every player named by a story above, looked up
//               in tools/nfl-headshots.json. Each story carries `ppl`, the slugs of
//               the players it names, and the lead renders their photos.
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
    const ppl = findPlayers(title, body);
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
      ...(ppl.length ? { ppl } : {}),
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

let front = read('front.html');
const before = front;
front = front.replace(/var STORIES = \[[\s\S]*?\];\n/, 'var STORIES = ' + JSON.stringify(stories) + ';\n');
front = front.replace(/var PLAYERS = \{[\s\S]*?\};\n/, 'var PLAYERS = ' + JSON.stringify(Object.fromEntries(cast)) + ';\n');
front = front.replace(/var REPORTS = \[[\s\S]*?\];\n/, 'var REPORTS = ' + JSON.stringify(reports) + ';\n');
if (!/var STORIES = \[/.test(front) || !/var REPORTS = \[/.test(front) || !/var PLAYERS = \{/.test(front)) {
  console.error('ABORT: could not find STORIES/REPORTS/PLAYERS declarations in front.html');
  process.exit(1);
}
fs.writeFileSync(path.join(root, 'front.html'), front);
console.log(`front.html: ${stories.length} stories, ${reports.length} camp reports, ${cast.size} player photos${front === before ? ' (no change)' : ''}`);
