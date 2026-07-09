// Builds tools/x-posts/insights_pool.json from the public insight drop pages
// (auction-insights-YYYY-MM-DD.html, snake-insights-YYYY-MM-DD.html).
// Re-run whenever a new drop page is added so the X-post rotation picks it up.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FORMATS = ['auction', 'snake'];

function extractPage(format, file) {
  const html = readFileSync(ROOT + file, 'utf8');
  const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : null;
  const slug = file.replace(/\.html$/, '');
  const titles = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) =>
    m[1]
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x2014;|&mdash;/g, '—')
  );
  return titles.map((title, i) => ({
    id: `${slug}-${i}`,
    format,
    title,
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
console.log(`Wrote ${pool.length} insights (${pool.filter((p) => p.format === 'auction').length} auction, ${pool.filter((p) => p.format === 'snake').length} snake) to tools/x-posts/insights_pool.json`);
