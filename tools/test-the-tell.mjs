#!/usr/bin/env node
// Tests for "The Tell", the weekly column at /the-tell
// that leads the front page's Weekly Fantasy lane.
//   node tools/test-the-tell.mjs
//
// This column is different from the other two in one way that matters here: it
// does not argue from prose, it argues from THREE NUMBERS PER ENTRY, printed in
// the entry, and its whole claim on a reader is that those numbers are
// checkable. A column that says "31.4 percent of his points are touchdowns" and
// is wrong about it has done something worse than a column that says nothing.
// Every one of those numbers is recomputed here from the same sources the
// column claims to have read:
//
//   1. STRUCTURE. Each entry carries the parts the rest of the site reads out
//      of it — verdict chip, position, team, date, headline, the evidence row,
//      the tell line, the statline. tools/build-front.mjs builds the lane's
//      lead band out of exactly those, so a missing part is a hole in the lead.
//   2. ROSTER. Every player the tell line commits to is on the board in
//      PROJECTIONS, on the team the entry's own chip claims.
//   3. TOUCHDOWN SHARE. Recomputed from PROJECTIONS at full PPR. This is the
//      column's signature number and the one nobody could check by eye.
//   4. OFFENSE RANK. Recomputed from tools/team-market.json — both the implied
//      points per game and the 1-to-32 rank.
//   5. THE LEDGER TABLE. The six-row summary at the top must agree with the six
//      entries below it about rank, touchdown share, offense and verdict. Two
//      statements of the same fact on one page is how a page contradicts
//      itself, so they are checked against each other and against the board.
//   6. TRANSLATION. /it-league.js turns each statline into the reader's own
//      dollars, but only if the statline quotes a percentage range AND one of
//      the players it is about is named in the headline or the tell line. Fail
//      either and the "Your league" line simply never appears — no error, no
//      symptom, just a missing feature on a page that looks fine.
//   7. THE FRONT PAGE. The embedded TELL array is the extraction of this
//      page, so it must name the same entries in the same order.

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
const page = read('the-tell.html');
const front = read('front.html');
const worker = read('_worker.js');

// ── the board, lifted out of the worker ───────────────────────────────────
// Same reader as tools/test-the-pick.mjs: scan the literal bracket by bracket
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
const MARKET = JSON.parse(read('tools/team-market.json'));

// Full PPR, the scoring the column's method box says its points are quoted in.
const pprOf = (s) => (s.passYd || 0) / 25 + (s.passTD || 0) * 4 - (s.passInt || 0) * 2
  + (s.rushYd || 0) / 10 + (s.rushTD || 0) * 6
  + (s.recYd || 0) / 10 + (s.recTD || 0) * 6 + (s.rec || 0) - (s.fumLost || 0) * 2;
// The touchdown half of that total. Passing scores count at four, because a
// share is a share of the points a player actually banks.
const tdPtsOf = (s) => (s.passTD || 0) * 4 + (s.rushTD || 0) * 6 + (s.recTD || 0) * 6;

const unesc = (t) => String(t)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
  .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“').replace(/&middot;/g, '·')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');
const norm = (t) => unesc(t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// One key for both sides, so "A.J. Brown", "Michael Pittman Jr." and a
// non-breaking hyphen all reduce the same way whether they come from the pool
// or the prose. The suffix comes off because the board carries "Michael
// Pittman" and the ledger table prints "Michael Pittman Jr.", and neither is
// wrong — they are the same man.
const keyOf = (n) => unesc(n).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ')
  .replace(/ (jr|sr|ii|iii|iv|v)$/, '').trim();

const byName = new Map();
for (const p of PROJECTIONS) {
  const k = keyOf(p.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(p);
}

// ── ranks, the way the site produces them ─────────────────────────────────
// The board scores, rounds to a tenth, then sorts (see _colScore and
// tools/live-board.mjs), so this does too. Sorting raw and sorting rounded can
// disagree on a tie, and the rank a reader sees comes off the rounded one.
const r1 = (n) => Math.round(n * 10) / 10;
const ladder = new Map();
for (const p of PROJECTIONS) {
  if (!ladder.has(p.position)) ladder.set(p.position, []);
  ladder.get(p.position).push({ name: p.name, pts: r1(pprOf(p.projectedStats)) });
}
for (const [, list] of ladder) list.sort((a, b) => b.pts - a.pts);
const rankOf = (name, position) => {
  const list = ladder.get(position) || [];
  const i = list.findIndex((p) => keyOf(p.name) === keyOf(name));
  return i < 0 ? null : i + 1;
};

// ── the market file's offense ladder ──────────────────────────────────────
// The projections and the market file do not spell every club the same way
// (LAR/LA, JAC/JAX), which is the kind of mismatch that silently drops a team
// out of a join and leaves the check passing on five entries instead of six.
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX' };
const offense = (() => {
  const rows = Object.entries(MARKET.totals)
    .map(([team, v]) => ({ team, ppg: r1(v.pf / v.games) }))
    .sort((a, b) => b.ppg - a.ppg);
  const out = new Map();
  rows.forEach((r, i) => out.set(r.team, { ppg: r.ppg, rank: i + 1 }));
  return out;
})();
const offenseOf = (abbr) => offense.get(TEAM_ALIAS[abbr] || abbr) || null;

// ── the entries ───────────────────────────────────────────────────────────
const entries = [...page.matchAll(/<article class="call tell" id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)]
  .map(([, id, block]) => {
    const chip = block.match(/<span class="chip ([a-z]+)">([^<]*)<\/span>/) || [];
    const pick = (re) => { const m = block.match(re); return m ? norm(m[1]) : ''; };
    const whoBlock = (block.match(/<p class="who">([\s\S]*?)<\/p>/) || [])[1] || '';
    return {
      id, block,
      side: chip[1] || '', label: norm(chip[2] || ''),
      pos: pick(/<span class="cpos">([^<]*)<\/span>/),
      team: pick(/<span class="cteam">([^<]*)<\/span>/),
      date: pick(/<span class="cdate">([^<]*)<\/span>/),
      title: pick(/<h2>([\s\S]*?)<\/h2>/),
      who: norm(whoBlock),
      stat: pick(/<p class="statline">([\s\S]*?)<\/p>/),
      nums: [...((block.match(/<p class="cnum">([\s\S]*?)<\/p>/) || [])[1] || '')
        .matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => norm(m[1])),
      named: [...whoBlock.matchAll(/<b>([^<]+)<\/b>/g)]
        .map((m) => norm(m[1])).filter((n) => !/^The tell/i.test(n)),
    };
  });

console.log('\nthe column has entries and they are shaped the way the site reads them');
ok('the page has entries', entries.length >= 1, String(entries.length));
{
  const ids = entries.map((e) => e.id);
  ok('every id is tell-YYYY-MM-DD-N',
     ids.every((i) => /^tell-\d{4}-\d{2}-\d{2}-\d+$/.test(i)),
     ids.filter((i) => !/^tell-\d{4}-\d{2}-\d{2}-\d+$/.test(i)).join(', '));
  ok('no id is used twice', new Set(ids).size === ids.length);
  const VERDICTS = { up: 'Beats his rank', down: 'Misses his rank', split: 'The rank is an artifact' };
  const badChip = entries.filter((e) => VERDICTS[e.side] !== e.label);
  ok('every verdict chip is one of the three the method box defines',
     badChip.length === 0, badChip.map((e) => `${e.id}: ${e.side}/${e.label}`).join('; '));
  for (const field of ['pos', 'team', 'date', 'title', 'who', 'stat']) {
    const missing = entries.filter((e) => !e[field]);
    ok(`every entry carries its ${field}`, missing.length === 0, missing.map((e) => e.id).join(', '));
  }
  // The evidence row is the column. An entry without one is an opinion in a
  // column that promised not to print any.
  const thin = entries.filter((e) => e.nums.length < 2);
  ok('every entry shows at least two numbers', thin.length === 0, thin.map((e) => e.id).join(', '));
  const noName = entries.filter((e) => !e.named.length);
  ok('every tell line commits to a named player', noName.length === 0, noName.map((e) => e.id).join(', '));
}

console.log('\nevery player named is on the board, on the team the entry claims');
{
  const off = [], wrongTeam = [];
  for (const e of entries) {
    for (const n of e.named) {
      const rows = byName.get(keyOf(n));
      if (!rows) { off.push(`${e.id}: ${n}`); continue; }
      if (!rows.some((r) => r.team === e.team)) {
        wrongTeam.push(`${e.id}: ${n} is ${rows.map((r) => r.team).join('/')}, entry says ${e.team}`);
      }
    }
  }
  ok('every named player is in PROJECTIONS', off.length === 0, off.join('; '));
  ok('and on the team the entry chips', wrongTeam.length === 0, wrongTeam.join('; '));
  const wrongPos = entries.filter((e) => {
    const rows = byName.get(keyOf(e.named[0])) || [];
    return rows.length && !rows.some((r) => r.position === e.pos);
  });
  ok('and at the position the entry chips', wrongPos.length === 0, wrongPos.map((e) => e.id).join(', '));
}

console.log('\nevery touchdown share is the one PROJECTIONS produces');
{
  const wrong = [];
  let checked = 0;
  for (const e of entries) {
    const rows = byName.get(keyOf(e.named[0])) || [];
    const p = rows.find((r) => r.team === e.team && r.position === e.pos) || rows[0];
    if (!p) continue;
    const want = r1(tdPtsOf(p.projectedStats) / pprOf(p.projectedStats) * 100);
    for (const claim of [...e.block.matchAll(/[Tt]ouchdown share <b>(\d+\.\d)%/g)]) {
      checked++;
      if (Math.abs(Number(claim[1]) - want) > 0.05) {
        wrong.push(`${e.id}: says ${claim[1]}%, board says ${want.toFixed(1)}%`);
      }
    }
  }
  ok('there are touchdown shares to check', checked >= entries.length, String(checked));
  ok('every one matches the board', wrong.length === 0, wrong.join('; '));
}

console.log('\nevery offense claim is the one the market file produces');
{
  const wrong = [];
  let checked = 0;
  for (const e of entries) {
    const o = offenseOf(e.team);
    for (const m of e.block.matchAll(/implied <b>(\d+\.\d)<\/b> ppg, <b>(\d+)(?:st|nd|rd|th)/g)) {
      checked++;
      if (!o) { wrong.push(`${e.id}: ${e.team} is not in tools/team-market.json`); continue; }
      if (Math.abs(Number(m[1]) - o.ppg) > 0.05) wrong.push(`${e.id}: says ${m[1]} ppg, market says ${o.ppg}`);
      if (Number(m[2]) !== o.rank) wrong.push(`${e.id}: says rank ${m[2]}, market says ${o.rank}`);
    }
  }
  ok('there are offense claims to check', checked >= 1, String(checked));
  ok('every one matches tools/team-market.json', wrong.length === 0, wrong.join('; '));
}

console.log('\nevery edition\'s ledger table agrees with its entries and with the board');
{
  // One ledger per edition, each followed by that edition's articles. The page
  // is split at every <table class="ledger"> and the rows in each piece are
  // checked against the articles in the same piece — so a second edition
  // cannot pass on the strength of the first one's table, and a grade table
  // (class "grade", written by a later edition about an earlier one) is not
  // mistaken for a ledger.
  const pieces = page.split('<table class="ledger">').slice(1);
  ok('there is a ledger per edition', pieces.length >= 1
     && pieces.length === new Set(entries.map((e) => e.date)).size,
     `${pieces.length} ledgers, ${new Set(entries.map((e) => e.date)).size} edition dates`);
  const badName = [], badRank = [], badShare = [], badOff = [], badVerdict = [], badCount = [];
  for (const piece of pieces) {
    const body = (piece.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
    const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, tr]) =>
      [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => norm(m[1])));
    const ids = [...piece.matchAll(/<article class="call tell" id="([^"]+)"/g)].map((m) => m[1]);
    const local = ids.map((id) => entries.find((e) => e.id === id)).filter(Boolean);
    if (rows.length !== local.length) badCount.push(`${rows.length} rows over ${local.length} entries (${ids[0] || 'no entries'})`);
    rows.forEach((cells, i) => {
      const e = local[i];
      if (!e || cells.length < 5) return;
      const [name, rank, share, off, verdict] = cells;
      if (keyOf(name) !== keyOf(e.named[0])) badName.push(`${e.id}: ${name} vs ${e.named[0]}`);
      const rows2 = byName.get(keyOf(name)) || [];
      const p = rows2.find((r) => r.team === e.team && r.position === e.pos) || rows2[0];
      if (p) {
        const want = `${p.position}${rankOf(p.name, p.position)}`;
        if (rank !== want) badRank.push(`${e.id}: says ${rank}, board says ${want}`);
        const wantShare = r1(tdPtsOf(p.projectedStats) / pprOf(p.projectedStats) * 100).toFixed(1) + '%';
        if (share !== wantShare) badShare.push(`${e.id}: says ${share}, board says ${wantShare}`);
      }
      const o = offenseOf(e.team);
      const wantOff = o ? `${e.team}, ${o.rank}${o.rank % 10 === 1 && o.rank !== 11 ? 'st'
        : o.rank % 10 === 2 && o.rank !== 12 ? 'nd'
        : o.rank % 10 === 3 && o.rank !== 13 ? 'rd' : 'th'}` : '';
      if (o && off !== wantOff) badOff.push(`${e.id}: says "${off}", market says "${wantOff}"`);
      if (verdict !== e.label) badVerdict.push(`${e.id}: says "${verdict}", entry says "${e.label}"`);
    });
  }
  ok('each ledger has a row per entry under it', badCount.length === 0, badCount.join('; '));
  ok('the ledger names the same players in the same order', badName.length === 0, badName.join('; '));
  ok('every rank cell is the rank the board produces', badRank.length === 0, badRank.join('; '));
  ok('every touchdown-share cell matches the board', badShare.length === 0, badShare.join('; '));
  ok('every offense cell matches the market file', badOff.length === 0, badOff.join('; '));
  ok('every verdict cell matches its entry', badVerdict.length === 0, badVerdict.join('; '));
  // Only the NEWEST edition's ledger may sit above the newest entries: an edition
  // block is head, grade (optional), ledger, note, then its six articles, inserted
  // at the top of <div class="entries">. A ledger after the last article of its
  // edition is a block written in the wrong order.
  const firstLedger = page.indexOf('<table class="ledger">');
  const firstArticle = page.indexOf('<article class="call tell"');
  ok('the newest edition\'s ledger precedes its entries', firstLedger > 0 && firstLedger < firstArticle);
}

console.log('\nevery statline can be restated in the reader\'s league');
{
  // The two halves /it-league.js needs. It reads a percentage range out of the
  // statline and then looks for one of the players it is about in the headline
  // or the tell line; miss either and the "Your league" line never renders and
  // nothing says so.
  const noPct = entries.filter((e) => !/[-+−]?\d+(\.\d+)?\s*%/.test(e.stat));
  ok('every statline quotes a percentage', noPct.length === 0, noPct.map((e) => e.id).join(', '));
  const unfindable = entries.filter((e) => {
    const subject = `${e.title} · ${e.who}`;
    return !e.named.some((n) => subject.includes(n));
  });
  ok('and names its player where the translator looks', unfindable.length === 0,
     unfindable.map((e) => e.id).join(', '));
  ok('the page loads the translator', /<script src="\/it-league\.js"/.test(page));
}

console.log('\nthe front page quotes the column rather than keeping a second copy');
{
  const m = front.match(/^var TELL = (\[[\s\S]*?\]);$/m);
  ok('front.html carries the extracted array', !!m);
  if (m) {
    const band = JSON.parse(m[1]);
    ok('it has an item per entry', band.length === entries.length,
       `${band.length} in front.html, ${entries.length} on the page`);
    const drift = band.filter((b, i) => !entries[i] || b.id !== entries[i].id
      || b.title !== entries[i].title || b.side !== entries[i].side);
    ok('and every item is the entry it points at', drift.length === 0,
       drift.map((b) => b.id).join(', ') + ' — run node tools/build-front.mjs');
    const noNums = band.filter((b) => !b.nums || b.nums.length < 2);
    ok('the band carries the evidence row, not just the verdict',
       noNums.length === 0, noNums.map((b) => b.id).join(', '));
    const bad = band.filter((b) => !/^\/the-tell#/.test(b.url));
    ok('every card links back into the column', bad.length === 0, bad.map((b) => b.id).join(', '));
  }
  ok('the lane band and its ribbon jump exist', front.includes('id="tellBand"')
     && front.includes('href="#thetell"'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
