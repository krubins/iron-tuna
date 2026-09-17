// Puts the outlined word mark (tools/wordmark.mjs) into every page's header in place
// of the <text> letters that depended on the Bebas Neue web font. One sweep over the
// site; tools/build-chrome.mjs repeats it on every run so a page copied from an old
// one is healed the same way. Idempotent.
//
//   node tools/put-wordmark.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { putWordmark } from './wordmark.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changed = [];
// The site's pages, then the page templates new pages are authored from.
const pages = fs.readdirSync(ROOT).filter((n) => n.endsWith('.html')).sort()
  .concat(fs.readdirSync(path.join(ROOT, 'tools/templates')).filter((n) => n.endsWith('.html')).sort().map((n) => 'tools/templates/' + n));
for (const f of pages) {
  const p = path.join(ROOT, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = putWordmark(before);
  if (after !== before) { fs.writeFileSync(p, after); changed.push(f); }
}
console.log(`${changed.length} page(s) now draw the outlined word mark${changed.length ? ': ' + changed.join(', ') : ''}`);
