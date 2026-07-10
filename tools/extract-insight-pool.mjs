// Builds tools/x-posts/insights_pool.json from the public insight drop pages
// (auction-insights-YYYY-MM-DD.html, snake-insights-YYYY-MM-DD.html).
// Re-run whenever a new drop page is added so the X-post rotation picks it up.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FORMATS = ['auction', 'snake', 'bestball'];

function extractPage(format, file) {
  const html = readFileSync(ROOT + file, 'utf8');
  const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : null;
  const slug = file.replace(/\.html$/, '');
  const unescape = (s) =>
    s
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x2014;|&mdash;/g, '—');
  const titles = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => unescape(m[1]));
  // Each playline is "<generic strategy sentence>. <specific verdict sentence>." — the
  // specific sentence (last one) is the actionable, insight-specific takeaway worth tweeting.
  const plays = [...html.matchAll(/<p class="playline"><b>The play:<\/b>([^<]*)<\/p>/g)].map((m) => {
    const full = unescape(m[1]).trim();
    const sentences = full.split(/(?<=\.) /).filter(Boolean);
    let last = (sentences[sentences.length - 1] || full).trim();
    // Guard against source-data glitches (e.g. a stray data table bled into the paragraph) —
    // a genuine one-sentence takeaway is always short; anything longer isn't a clean sentence.
    if (last.length > 200) last = last.slice(0, 180).replace(/\s+\S*$/, '') + '…';
    // A real sentence has a low ratio of mid-sentence capitalized words; a leaked data table
    // (names/labels strung together) doesn't. Only check on longer strings — short takeaways
    // legitimately trip a high ratio just by naming one player (e.g. "...target Herbert.").
    if (last.length > 120) {
      const words = last.split(/\s+/).slice(1);
      const capRatio = words.length ? words.filter((w) => /^[A-Z]/.test(w)).length / words.length : 0;
      if (capRatio > 0.3) return '';
    }
    return last;
  });
  return titles.map((title, i) => ({
    id: `${slug}-${i}`,
    format,
    title,
    play: plays[i] || '',
    url: `https://irontuna.com/${slug}`,
    date,
  }));
}

const pool = [];
for (const format of FORMATS) {
  const files = readdirSync(ROOT)
    .filter((f) => new RegExp(`^${format}-insights-\\d{4}-\\d{2}-\\d{2}\\.html$`).test(f))
    .sort();
  for (const file of files) pool.push(...extractPage(format, file));
}

writeFileSync(
  ROOT + 'tools/x-posts/insights_pool.json',
  JSON.stringify(pool, null, 2) + '\n'
);
console.log(`Wrote ${pool.length} insights (${FORMATS.map((f) => `${pool.filter((p) => p.format === f).length} ${f}`).join(', ')}) to tools/x-posts/insights_pool.json`);
