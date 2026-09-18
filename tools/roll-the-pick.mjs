#!/usr/bin/env node
// The Pick's rolling window.
//   node tools/roll-the-pick.mjs            trim the-pick.html to the newest PICK_WINDOW entries
//   node tools/roll-the-pick.mjs --check    report only; exit 1 if the page carries more
//
// The column publishes one entry a day and the page kept every one of them, so
// by mid-September /the-pick was ten stories deep and the tenth was a draft-day
// auction argument sitting under a Week 2 one. Ken's rule: three at a time. A
// new entry goes up, the oldest comes down, and the page is always the three
// most recent days.
//
// This is a script rather than a line in the Routine's prompt because the
// Routine is a writer: it has been asked to delete its own back catalogue
// exactly as reliably as it has been asked to do anything else, which is not
// reliably enough for a step that removes published copy. Deterministic trim,
// run in the same "Ship it" sequence as the builds, checked by
// tools/test-the-pick.mjs, which fails the build if the page ever carries more.
//
// Retiring an entry takes it off the page for good: the column's entries are
// anchors on one page (/the-pick#pick-YYYY-MM-DD), not pages of their own, so
// nothing else in the site links to one and the sitemap carries only /the-pick.
// tools/build-seo.mjs reads the page's own articles back out for its blogPost
// list, so the structured data follows the trim on the next build with no
// second edit. Git history is the archive.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Three at a time. The front page and /weekly-intel both read the newest entry
// as the lead and the rest as "Earlier picks", so this is also how many that
// band shows.
export const PICK_WINDOW = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'the-pick.html';
const ENTRY = /<article class="call pick" id="(pick-(\d{4}-\d{2}-\d{2})[^"]*)">[\s\S]*?<\/article>/g;

// Every entry in the page, in the order the page prints them.
export function pickEntries(html) {
  return [...html.matchAll(ENTRY)].map((m) => ({
    id: m[1], date: m[2], html: m[0], at: m.index, end: m.index + m[0].length,
  }));
}

// Which ids survive a trim: newest date first, ties broken by the order the
// page already has them in, so a day that published twice keeps the entry on
// top rather than the one the sort happened to reach first.
export function keepList(entries, window = PICK_WINDOW) {
  return entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => (a.date === b.date ? a.i - b.i : a.date < b.date ? 1 : -1))
    .slice(0, window)
    .sort((a, b) => a.i - b.i);
}

function main() {
  const check = process.argv.includes('--check');
  const file = path.join(ROOT, FILE);
  const html = fs.readFileSync(file, 'utf8');
  const entries = pickEntries(html);

  if (!entries.length) {
    console.error(`ABORT: no entries found in ${FILE} — has the markup changed?`);
    process.exit(1);
  }

  const keep = keepList(entries);
  const keepIds = new Set(keep.map((e) => e.id));
  const drop = entries.filter((e) => !keepIds.has(e.id));

  if (!drop.length) {
    console.log(`${FILE}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, at the ${PICK_WINDOW}-entry limit or under (no change)`);
    return;
  }

  if (check) {
    console.error(`${FILE}: ${entries.length} entries, limit is ${PICK_WINDOW}. Retire: ${drop.map((e) => e.id).join(', ')}`);
    process.exit(1);
  }

  // Cut from the back so the earlier offsets stay true, and take the blank
  // line each article sits on with it rather than leaving a run of them behind.
  let next = html;
  for (const e of [...drop].reverse()) {
    let from = e.at, to = e.end;
    while (from > 0 && /[ \t]/.test(next[from - 1])) from--;
    if (next[from - 1] === '\n' && next[to] === '\n') to++;
    next = next.slice(0, from) + next.slice(to);
  }

  fs.writeFileSync(file, next);
  console.log(`${FILE}: kept ${keep.map((e) => e.id).join(', ')}`);
  console.log(`${FILE}: retired ${drop.map((e) => e.id).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
