#!/usr/bin/env node
// Tests for The Pick, the daily themed column at /the-pick.
//   node tools/test-the-pick.mjs
//
// The column is written by a Routine, one entry a day, in prose. Nothing about
// prose stops it from naming a player who is not on this site's board, putting
// him on the wrong club, or quoting a projection that the projection set does
// not contain — and every one of those reads as confident advice, which is what
// makes it expensive. tools/test-insights.mjs makes that argument at length for
// the cheat-sheet notes; this file applies it to the column.
//
// Four things are checked, in rising order of how quietly they would fail:
//
//   1. STRUCTURE. Each entry carries the parts the rest of the site reads out
//      of it — theme chip, position, team, date, headline, dek, pick line,
//      statline. tools/build-front.mjs extracts the front-page card from
//      exactly those, so a missing part is a card with a hole in it.
//   2. ROSTER. Every player the pick line commits to is on the board in
//      PROJECTIONS, and every "Name (TEAM)" in a table is on that team.
//   3. NUMBERS. A table column headed "Points" is checked against the PPR total
//      computed from PROJECTIONS. This is the check that makes the column's
//      tables worth printing: a number a reader can verify on their own sheet.
//   4. TRANSLATION. /it-league.js turns each statline into the reader's own
//      dollars, but only if the statline quotes a percentage range AND one of
//      the players it is about is named in the headline or the pick line. Fail
//      either and the "Your league" line simply never appears — no error, no
//      symptom, just a missing feature on a page that looks fine.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const page = read('the-pick.html');
const front = read('front.html');
const worker = read('_worker.js');

// ── the board, lifted out of the worker ───────────────────────────────────
// Same reader as tools/test-insights.mjs: scan the literal bracket by bracket
// rather than slicing to whatever is declared next, so moving the declaration
// does not quietly turn this file into a no-op.
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

// Full PPR, the scoring the column's method box says its points are quoted in.
const pprOf = (s) => (s.passYd || 0) / 25 + (s.passTD || 0) * 4 - (s.passInt || 0) * 2
  + (s.rushYd || 0) / 10 + (s.rushTD || 0) * 6
  + (s.recYd || 0) / 10 + (s.recTD || 0) * 6 + (s.rec || 0)
  - (s.fumLost || 0) * 2;

const unesc = (t) => String(t)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
  .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');
const norm = (t) => unesc(t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// One key for both sides, so "A.J. Brown", "Harold Fannin Jr." and a non-breaking
// hyphen all reduce the same way whether they come from the pool or the prose.
const keyOf = (n) => unesc(n).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

const byName = new Map();
for (const p of PROJECTIONS) {
  const k = keyOf(p.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(p);
}

// Every "Name (TEAM)" in an entry, read one text node at a time. Flattening the
// whole entry first would let a run of words cross a cell boundary, so a table
// row would read as "PPR Standard Derrick Henry" and report a player nobody
// wrote. Within a text node the leading words are dropped one at a time until
// the pool recognises the name — a sentence can end in a capitalised word right
// before one.
function namesWithTeam(html) {
  const out = [];
  const NAME = /([A-Z][A-Za-z.'’‑-]+(?: [A-Z][A-Za-z.'’‑-]+){1,3}) \(([A-Z]{2,3})(?:, [A-Z]{2})?\)/g;
  for (const chunk of html.split(/<[^>]*>/)) {
    const text = norm(chunk);
    for (const m of text.matchAll(NAME)) {
      let words = m[1].split(' ');
      while (words.length > 2 && !byName.has(keyOf(words.join(' ')))) words = words.slice(1);
      out.push({ name: words.join(' '), team: m[2] });
    }
  }
  return out;
}

const entries = [...page.matchAll(/<article class="call pick" id="([^"]*)">([\s\S]*?)<\/article>/g)]
  .map((m) => ({ id: m[1], html: m[2] }));

// ── 1. structure ──────────────────────────────────────────────────────────
console.log('\nevery entry carries the parts the site reads out of it');
{
  ok('the column has entries', entries.length > 0, String(entries.length));

  const badId = entries.filter((e) => !/^pick-\d{4}-\d{2}-\d{2}(-\d+)?$/.test(e.id));
  ok('every id is pick-YYYY-MM-DD', badId.length === 0, badId.map((e) => e.id).join(', '));

  const dupe = entries.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i);
  ok('no two entries share an id', dupe.length === 0, dupe.join(', '));

  const PARTS = [
    ['theme chip', /<span class="chip theme">Theme: [^<]+<\/span>/],
    ['position', /<span class="cpos">[^<]+<\/span>/],
    ['team', /<span class="cteam">[^<]+<\/span>/],
    ['date', /<span class="cdate">[^<]+<\/span>/],
    ['headline', /<h2>[\s\S]*?<\/h2>/],
    ['dek', /<p class="dek">[\s\S]*?<\/p>/],
    ['pick line', /<p class="who"><b>The Pick:<\/b>[\s\S]*?<\/p>/],
    ['statline', /<p class="statline">Projected effect:[\s\S]*?<\/p>/],
  ];
  for (const [label, re] of PARTS) {
    const missing = entries.filter((e) => !re.test(e.html));
    ok(`every entry has a ${label}`, missing.length === 0, missing.map((e) => e.id).join(', '));
  }

  // The theme is the whole conceit of the column and the kicker on the front
  // page card. Two entries in a row on the same theme is a column repeating
  // itself, which is the failure mode a daily cadence actually has.
  const themes = entries.map((e) => norm((e.html.match(/<span class="chip theme">Theme: ([^<]+)<\/span>/) || [])[1] || ''));
  const repeated = themes.filter((t, i) => i > 0 && t && t === themes[i - 1]);
  ok('no two consecutive entries argue the same theme', repeated.length === 0, repeated.join(', '));

  // Newest first, which is what the page promises and what build-front.mjs's
  // sort would otherwise silently paper over.
  const dates = entries.map((e) => (e.id.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '');
  const descending = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
  ok('entries are newest first', descending, dates.join(' '));
}

// ── 2. the roster ─────────────────────────────────────────────────────────
console.log('\nthe column names players who are actually on the board');
{
  const offBoard = [], wrongTeam = [];
  for (const e of entries) {
    const who = (e.html.match(/<p class="who">([\s\S]*?)<\/p>/) || [])[1] || '';
    const named = [...who.matchAll(/<b>([^<]+)<\/b>/g)]
      .map((m) => norm(m[1])).filter((n) => !/^The Pick/i.test(n));
    for (const n of named) if (!byName.has(keyOf(n))) offBoard.push(`${e.id}: ${n}`);

    // "Name (TEAM)" appears in the pick line and in every table's player cell.
    // The club is the half that rots first — a call captioned with the wrong
    // team is worse than no call at all.
    for (const { name, team } of namesWithTeam(e.html)) {
      const rows = byName.get(keyOf(name));
      if (!rows) { offBoard.push(`${e.id}: ${name}`); continue; }
      if (!rows.some((p) => p.team === team)) wrongTeam.push(`${e.id}: ${name} is ${rows[0].team}, not ${team}`);
    }
  }
  ok('every player the column names is in PROJECTIONS', offBoard.length === 0, [...new Set(offBoard)].join('; '));
  ok('every player is named with his own team', wrongTeam.length === 0, [...new Set(wrongTeam)].join('; '));
}

// ── 3. the numbers in the tables ──────────────────────────────────────────
console.log('\na table headed "Points" agrees with the projection set');
{
  const wrong = [], checked = [];
  for (const e of entries) {
    for (const t of e.html.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
      const heads = [...(t[1].match(/<thead>[\s\S]*?<\/thead>/) || [''])[0].matchAll(/<th>([\s\S]*?)<\/th>/g)]
        .map((m) => norm(m[1]).toLowerCase());
      const col = heads.indexOf('points');
      if (col < 0) continue;
      for (const row of t[1].matchAll(/<tr[^>]*>((?:\s*<td[^>]*>[\s\S]*?<\/td>)+)\s*<\/tr>/g)) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => norm(m[1]));
        const who = cells.find((c) => /\([A-Z]{2,3}\)/.test(c));
        if (!who || cells[col] === undefined) continue;
        const rows = byName.get(keyOf(who.replace(/\s*\([^)]*\)\s*/, '')));
        if (!rows) continue; // already reported by the roster check above
        const want = Math.round(pprOf(rows[0].projectedStats) * 10) / 10;
        const got = Number(cells[col]);
        checked.push(who);
        if (!Number.isFinite(got) || Math.abs(got - want) > 0.05) {
          wrong.push(`${e.id}: ${who} prints ${cells[col]}, projections say ${want}`);
        }
      }
    }
  }
  ok('at least one entry prints checkable point totals', checked.length > 0, String(checked.length));
  ok('every printed point total matches PROJECTIONS', wrong.length === 0, wrong.join('; '));
}

// ── 4. the reader's own league ────────────────────────────────────────────
console.log('\neach entry can be translated into the reader\'s own money');
{
  ok('the page loads /it-league.js', /<script src="\/it-league\.js" defer><\/script>/.test(page));

  // /it-league.js finds an entry with el.closest('.call') and reads .cpos off
  // it, so the article must keep the coaching column's class even though this
  // column has its own look.
  const notCall = entries.filter((e) => !/<article class="call pick"/.test(page.slice(page.indexOf(`id="${e.id}"`) - 40, page.indexOf(`id="${e.id}"`) + 10)));
  ok('every entry keeps the .call class it-league.js selects on', notCall.length === 0, notCall.map((e) => e.id).join(', '));

  // pctRange() in it-league.js is what turns a statline into dollars, and it
  // needs a percentage. A statline without one is a silent no-op.
  const noPct = entries.filter((e) => {
    const s = (e.html.match(/<p class="statline">([\s\S]*?)<\/p>/) || [])[1] || '';
    return !/[+-]?\d+(\.\d+)?%/.test(s);
  });
  ok('every statline quotes a percentage', noPct.length === 0, noPct.map((e) => e.id).join(', '));

  // tailor() searches the headline and the pick line for a player it can price.
  // An entry whose subject is named nowhere in those two places is untranslatable.
  const noSubject = entries.filter((e) => {
    const h = norm((e.html.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '');
    const who = norm((e.html.match(/<p class="who">([\s\S]*?)<\/p>/) || [])[1] || '');
    return ![...(h + ' · ' + who).matchAll(/([A-Z][A-Za-z.'’\-]+(?: [A-Z][A-Za-z.'’\-]+){1,3})/g)]
      .some((m) => byName.has(keyOf(m[1])));
  });
  ok('every entry names a priceable player in its headline or pick line',
    noSubject.length === 0, noSubject.map((e) => e.id).join(', '));
}

// ── the front page ────────────────────────────────────────────────────────
console.log('\nthe front page quotes the column instead of copying it');
{
  const picks = JSON.parse((front.match(/var PICKS = (\[[\s\S]*?\]);\n/) || [])[1] || 'null');
  ok('front.html carries a PICKS array', Array.isArray(picks) && picks.length > 0);
  ok('PICKS has one row per entry', picks.length === entries.length, `${picks.length} vs ${entries.length}`);

  const titleOf = (e) => norm((e.html.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '');
  const mismatched = picks.filter((p, i) => p.title !== titleOf(entries[i]) || p.url !== '/the-pick#' + entries[i].id);
  ok('every card quotes its entry exactly', mismatched.length === 0,
    mismatched.map((p) => p.id).join(', ') + ' — run node tools/build-front.mjs');

  const noTheme = picks.filter((p) => !p.theme);
  ok('every card carries its theme', noTheme.length === 0, noTheme.map((p) => p.id).join(', '));

  // The crawlers robots.txt invites do not run JavaScript, so the band the
  // client paints is invisible to them. The static link in the served HTML is
  // the only thing that makes the column reachable at all.
  ok('the front page links /the-pick without JavaScript',
    (front.match(/href="\/the-pick"/g) || []).length >= 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
