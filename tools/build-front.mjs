// Rebuilds the embedded data arrays in front.html (the "/" news front page) from the
// static pages that are the source of truth:
//   STORIES  <- every auction-insights-YYYY-MM-DD.html "call" section (title, position
//               label, priced view chip) joined to tools/x-posts/insights_pool.json for
//               the play/stat lines
//   REPORTS  <- every auction-watch-YYYY-MM-DD.html page (title + meta description),
//               newest first — this is the Training Camp & Preseason desk
//   PRESEASON<- every preseason-week-N.html page (headline, description, the <h2>
//               takeaway titles), newest week first — the weekly takeaways rail
//
// Run after adding a new insights drop page or a new auction-watch (camp/preseason)
// page:  node tools/build-front.mjs
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
    stories.push({
      title,
      pos: cpos ? norm(cpos[1]) : '',
      view: chip ? norm(chip[2]) : '',
      viewCls: chip ? chip[1] : '',
      play: p.play || '',
      stat: p.stat || '',
      date,
      url: '/' + f.replace('.html', '') + '#call-' + m[1],
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
front = front.replace(/var REPORTS = \[[\s\S]*?\];\n/, 'var REPORTS = ' + JSON.stringify(reports) + ';\n');
front = front.replace(/var PRESEASON = \[[\s\S]*?\];\n/, 'var PRESEASON = ' + JSON.stringify(preseason) + ';\n');
if (!/var STORIES = \[/.test(front) || !/var REPORTS = \[/.test(front) || !/var PRESEASON = \[/.test(front)) {
  console.error('ABORT: could not find STORIES/REPORTS/PRESEASON declarations in front.html');
  process.exit(1);
}
fs.writeFileSync(path.join(root, 'front.html'), front);
console.log(`front.html: ${stories.length} stories, ${reports.length} camp reports, ${preseason.length} preseason weeks${front === before ? ' (no change)' : ''}`);
