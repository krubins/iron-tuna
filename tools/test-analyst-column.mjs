#!/usr/bin/env node
// Tests for the standing analyst column: the D1 read in _worker.js that backs
// /api/analyst-column, and the page that renders it.
//   node tools/test-analyst-column.mjs
//
// What this has to protect is that the column DEGRADES rather than breaks. It
// renders rows written by an autonomous run, so the shape of `calls` is a
// promise the desk makes, not one the site can enforce at write time. Every bad
// shape below — no column in the table at all, malformed JSON, a call with no
// analyst, a verdict word nobody defined, a row with no slug — must come back
// as a slightly emptier page, never as an exception and never as an entry the
// reader cannot open.
//
// Like the other worker tests this evaluates the REAL source rather than a
// reimplementation, so the section cannot drift away from what deploys.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'analyst-desk.html'), 'utf8');
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');

// ── lift the two sections the column needs out of the worker ───────────────
// leadRow/leadSlug come from the lead-story section; the column reuses them
// rather than carrying a second copy of the same row shaping.
const leadStart = src.indexOf('function leadRow(r) {');
const leadEnd = src.indexOf('\n}\n', src.indexOf('function leadSlug'));
const leadBits = src.slice(leadStart, leadEnd + 3);
const catStart = src.indexOf('const LEAD_CATEGORIES = {');
const cats = src.slice(catStart, src.indexOf('};', catStart) + 2);

const START = 'let _ANALYST_CACHE = null;';
const s0 = src.indexOf(START);
if (s0 < 0) { console.error('FAIL: could not locate the analyst-column section in _worker.js'); process.exit(1); }
const e0 = src.indexOf('async function analystColumnPayload', s0);
const section = src.slice(s0, src.indexOf('\n}\n', e0) + 3);

const mk = () => new Function(`
  ${cats}
  ${leadBits}
  ${section}
  return { analystColumnPayload, analystCalls, analystScoreboard, ANALYST_MAX, ANALYST_CALLS_MAX, ANALYST_STANCES,
           reset: () => { _ANALYST_CACHE = null; _ANALYST_AT = 0; __analystCallsReady = false; } };
`)();

// ── a D1 stand-in ──────────────────────────────────────────────────────────
// `noCallsColumn` reproduces the state of the real database before the lazy
// ALTER lands: any SELECT naming `calls` throws the way SQLite would.
function db(rows, opts = {}) {
  const ran = [];
  return {
    ran,
    env: {
      LEADS_DB: {
        prepare(sql) {
          ran.push(sql);
          if (opts.throwOnSelect && sql.startsWith('SELECT')) throw new Error('d1 down');
          if (opts.noCallsColumn && /\bcalls\b/.test(sql) && sql.startsWith('SELECT')) {
            throw new Error('no such column: calls');
          }
          const args = [];
          const api = {
            bind(...a) { args.push(...a); return api; },
            async run() {
              if (opts.ddlThrows && sql.startsWith('ALTER')) throw new Error('duplicate column name: calls');
              return { success: true };
            },
            async all() {
              if (opts.throwAsync) throw new Error('d1 down');
              const lim = args[args.length - 1];
              // Honour the projection. The fallback query deliberately does not
              // ask for `calls`, and a fake that hands it back anyway would let
              // that path pass while the real one returns undefined.
              const wantsCalls = /\bcalls\b/.test(sql);
              return { results: rows.slice(0, lim).map(r => {
                const c = { ...r };
                if (!wantsCalls) delete c.calls;
                return c;
              }) };
            }
          };
          return api;
        }
      }
    }
  };
}

const CALL = (o = {}) => ({ analyst: 'Mike Clay', outlet: 'ESPN', player: 'A Player', pos: 'rb',
                            team: 'sea', their: 'RB7', ours: '$24, RB14', stance: 'disagree',
                            why: 'The odds do not back the workload', ...o });
const ROW = (o = {}) => ({ slug: 'a-slug', title: 'A title', dek: 'A dek', category: 'analyst',
                           players: null, calls: JSON.stringify([CALL()]),
                           created_at: 1787000000000, ...o });

console.log('\nthe payload the column reads');
{
  const w = mk();
  const d = db([ROW({ slug: 'newest', title: 'Newest' }), ROW({ slug: 'older', title: 'Older' })]);
  const out = await w.analystColumnPayload(d.env);
  ok('both entries come back', out.ok === true && out.entries.length === 2);
  ok('each entry carries the URL of its full story', out.entries[0].url === '/lead/newest');
  ok('the column asks only for analyst rows',
     d.ran.some(s => s.includes("category = 'analyst'")));
  ok('an unverified row can never reach the column',
     d.ran.every(s => !s.startsWith('SELECT') || s.includes('verified = 1')));
  ok('the listing is capped', d.ran.some(s => s.includes('LIMIT ?')) && w.ANALYST_MAX === 60);
  // The body is the one thing this page never needs: it links to /lead/<slug>
  // for that, and shipping every past article to render a list of headlines is
  // the mistake /api/lead-story was written to avoid.
  ok('no article bodies ride along', d.ran.every(s => !s.includes('body_html')));
  ok('the memo is warm on the second call',
     (await w.analystColumnPayload(db([]).env)).entries.length === 2);
}

console.log('\nthe structured calls, which a run can get wrong');
{
  const w = mk();
  ok('a good call survives intact', (() => {
    const c = w.analystCalls(JSON.stringify([CALL()]))[0];
    return c.analyst === 'Mike Clay' && c.player === 'A Player' && c.stance === 'disagree';
  })());
  ok('position and team are upper-cased for the card', (() => {
    const c = w.analystCalls(JSON.stringify([CALL()]))[0];
    return c.pos === 'RB' && c.team === 'SEA';
  })());
  ok('malformed JSON is an empty list, not a throw',
     w.analystCalls('{not json').length === 0);
  ok('a JSON object where a list belongs is refused',
     w.analystCalls('{"analyst":"x"}').length === 0);
  ok('a null column is an empty list', w.analystCalls(null).length === 0);
  // These two are the desk's own rule made structural: this column may not
  // publish a take with nobody attached to it, or an attribution about nobody.
  ok('a call with no analyst is dropped',
     w.analystCalls(JSON.stringify([CALL({ analyst: '  ' })])).length === 0);
  ok('a call with no player is dropped',
     w.analystCalls(JSON.stringify([CALL({ player: '' })])).length === 0);
  ok('junk in the array is dropped, the rest kept',
     w.analystCalls(JSON.stringify([null, 'nope', 7, CALL()])).length === 1);
  ok('the calls on one entry are capped',
     w.analystCalls(JSON.stringify(Array.from({ length: 40 }, () => CALL()))).length === w.ANALYST_CALLS_MAX);
  // Same contract as LEAD_CATEGORIES: the site owns the vocabulary. A run that
  // invents a fourth verdict does not get to put it on the page.
  const odd = w.analystCalls(JSON.stringify([CALL({ stance: 'sort of' })]))[0];
  ok('an undefined verdict scores nowhere but still renders',
     odd && odd.stance === null && odd.stanceLabel === null && odd.player === 'A Player');
  const cased = w.analystCalls(JSON.stringify([CALL({ stance: 'AGREE' })]))[0];
  ok('the verdict is matched case-insensitively', cased.stance === 'agree');
  ok('every verdict the page styles is defined here',
     ['agree', 'disagree', 'partial'].every(k => typeof w.ANALYST_STANCES[k] === 'string'));
}

console.log('\nthe running record');
{
  const w = mk();
  const entries = [
    { calls: w.analystCalls(JSON.stringify([CALL({ stance: 'agree' }), CALL({ analyst: 'Matthew Berry', outlet: 'Fantasy Life', stance: 'disagree' })])) },
    { calls: w.analystCalls(JSON.stringify([CALL({ stance: 'disagree' }), CALL({ stance: 'partial' })])) }
  ];
  const board = w.analystScoreboard(entries);
  ok('one row per analyst, not one per call', board.length === 2);
  const clay = board.find(r => r.analyst === 'Mike Clay');
  ok('the verdicts tally per analyst',
     clay.total === 3 && clay.agree === 1 && clay.disagree === 1 && clay.partial === 1,
     JSON.stringify(clay));
  ok('the busiest analyst leads the table', board[0].analyst === 'Mike Clay');
  ok('the outlet rides along', board.find(r => r.analyst === 'Matthew Berry').outlet === 'Fantasy Life');
  const same = w.analystScoreboard([
    { calls: w.analystCalls(JSON.stringify([CALL({ analyst: 'mike clay' }), CALL({ analyst: 'Mike Clay' })])) }
  ]);
  ok('the same analyst under different casing is one row', same.length === 1 && same[0].total === 2);
  ok('an unscored verdict counts in the total but in no column', (() => {
    const b = w.analystScoreboard([{ calls: w.analystCalls(JSON.stringify([CALL({ stance: 'whatever' })])) }]);
    return b[0].total === 1 && b[0].agree === 0 && b[0].disagree === 0 && b[0].partial === 0;
  })());
  ok('no calls anywhere is an empty record, not a crash', w.analystScoreboard([]).length === 0);
}

console.log('\nevery way the column can have a bad day');
{
  // The page keeps its standing copy through all of these. What must never
  // happen is an exception: this is a public page, and a throw here is a blank
  // one where a quiet one would do.
  const cases = [
    ['the calls column does not exist yet', db([ROW()], { noCallsColumn: true }).env, true],
    ['the lazy ALTER is refused', db([ROW()], { ddlThrows: true }).env, true],
    ['D1 throws on prepare', db([ROW()], { throwOnSelect: true }).env, false],
    ['D1 rejects mid-query', db([ROW()], { throwAsync: true }).env, false],
    ['there is no database bound', {}, false],
    ['the desk has published nothing yet', db([]).env, false]
  ];
  for (const [name, env, expectEntries] of cases) {
    const w = mk();
    let out, threw = false;
    try { out = await w.analystColumnPayload(env); } catch (e) { threw = true; }
    ok(name + ': no exception reaches the page', !threw);
    ok(name + ': the payload is well formed',
       !threw && Array.isArray(out.entries) && Array.isArray(out.scoreboard));
    if (expectEntries) {
      ok(name + ': the entries still publish', !threw && out.entries.length === 1);
      if (name.startsWith('the calls column')) {
        ok('without the calls column an entry lists with no call cards',
           !threw && out.entries[0].calls.length === 0 && out.entries[0].title === 'A title');
      }
    } else {
      ok(name + ': it reports not-ok rather than half a page', !threw && out.ok === false);
    }
  }
}

console.log('\nrows the reader could not use');
{
  const w = mk();
  // Same rule the lead applies: no slug means no URL, and an entry that links
  // to /lead/null looks like a bug to everyone who clicks it.
  const out = await w.analystColumnPayload(
    db([ROW({ slug: null }), ROW({ slug: '' }), ROW({ slug: 'fine' }), ROW({ slug: 'x', title: '' })]).env);
  ok('a row with no slug is left off', out.entries.length === 1 && out.entries[0].slug === 'fine');
  const w2 = mk();
  const out2 = await w2.analystColumnPayload(db([ROW({ players: '{not json' })]).env);
  ok('malformed players JSON costs the faces, not the entry',
     out2.entries.length === 1 && out2.entries[0].ppl.length === 0);
}

console.log('\nthe page itself');
{
  ok('the route is in the worker', src.includes("url.pathname === '/api/analyst-column'"));
  ok('the route is GET only', /analyst-column'\)\s*\{[\s\S]{0,120}method !== 'GET'/.test(src));
  // /lead is noindex because its story is replaced every three hours. This URL
  // is stable and accumulates, so the opposite is correct — and getting this
  // backwards by copying lead.html's head is exactly the mistake to catch.
  ok('the column is indexable', !/name="robots"[^>]*noindex/.test(page));
  ok('it declares its own canonical', page.includes('href="https://irontuna.com/analyst-desk"'));
  ok('it is in the sitemap', sitemap.includes('https://irontuna.com/analyst-desk'));
  ok('it reads the column route', page.includes("fetch('/api/analyst-column')"));
  // Everything on this page comes from an autonomous run, so every field that
  // reaches the DOM as text goes through esc(). innerHTML is only ever handed
  // strings this file built.
  ok('the page escapes what the desk wrote', /function\(s\)\{ return String\(s == null \? '' : s\)\.replace/.test(page.replace(/\s+/g, ' ')) || page.includes('var esc ='));
  ok('an empty column says so instead of showing an error',
     page.includes('has not published an analyst piece yet'));
  ok('a dead API still leaves the standing copy', page.includes('unreachable right now'));
  ok('the reader is told analyst-above-consensus is not analyst-above-us',
     page.includes('is not the same as being above us'));
  ok('dollar figures are labelled max bids', page.includes('max bids'));
  // The three that make an entry followable. Every one of them exists because
  // a published piece was hard to read without it: a rank set against a price
  // with no conversion between them, a $0.51 gap described as meaningful, and
  // the age of an odds snapshot quoted at a reader who has no idea why it is
  // in the sentence. The desk writes the entries; this box has to carry the
  // vocabulary they are written in.
  ok('ranks are converted before they can disagree with a price',
     page.includes('Ranks and dollars are different units'));
  ok('a sub-dollar gap is named as noise, not a disagreement',
     page.includes('A dollar is noise') && page.includes('rounding difference'));
  ok('the odds stamp is explained as freshness',
     page.includes('freshness note'));
  ok('the why line says whose reasoning it is',
     page.includes('Why we differ') && page.includes('WHY_LABEL'));
  ok('the card layout is explained before the cards',
     page.includes('one card per analyst per player'));
  ok('the front page and the lead both link here',
     fs.readFileSync(path.join(ROOT, 'lead.html'), 'utf8').includes('/analyst-desk'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
