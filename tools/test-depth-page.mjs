#!/usr/bin/env node
// Guards /depth-charts — the public depth chart board.
//   node tools/test-depth-page.mjs
//
// Why this test exists: the page publishes, to readers, the same thing the
// Value Coach is grounded on (tools/test-depth-charts.mjs), and it reads it
// from the same place — /api/live, the worker's Sleeper mirror. Three ways
// that goes silently wrong:
//
//   1. THE VERSION. /api/live is cached at the edge and in the browser BY URL.
//      When the worker bumps its cache key, a page still asking for the old
//      version serves a stale depth chart for six hours and says nothing. The
//      worker, index.html and this page must all name the same version.
//   2. THE ORDER. The feed ranks receivers ACROSS its three slots (LWR/RWR/
//      SWR), so a fold that sorted within a slot would print the wrong man as
//      WR2 — the one error on a depth chart that no reader can catch.
//   3. THE DEPTH. The page exists to answer "who is behind him", so it must
//      print at least as deep as the coach's own table, never less.
//
// Pure functions only — no browser, no network. The fold is lifted out of
// depth-charts.html rather than re-implemented, so this cannot drift into
// testing a copy.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(ROOT, 'depth-charts.html'), 'utf8');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };

// ── lifting the page's own fold ───────────────────────────────────────────
// Brace counting is enough here and nowhere else in this repo: the lifted
// declarations carry no brace inside a string or a regex literal. If that ever
// stops being true, borrow the scanner from tools/test-depth-charts.mjs.
function lift(re) {
  const m = re.exec(page);
  if (!m) throw new Error('cannot lift ' + re);
  let d = 0;
  for (let i = page.indexOf('{', m.index); i < page.length; i++) {
    if (page[i] === '{') d++;
    else if (page[i] === '}') { d--; if (d === 0) return page.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced ' + re);
}
const src = [lift(/var KEEP = /), lift(/var TAG = /), lift(/var TEAMS = /), lift(/function fold\(/),
  'export { fold, KEEP, TEAMS };'].join('\n');
const { fold, KEEP, TEAMS } = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));

// ── 1. the page, the app and the worker ask for one version of the feed ───
const workerV = (worker.match(/'\/api\/live\?v=(\d+)'/) || [])[1];
const clientV = (idx.match(/const LIVE_FEED_VERSION = (\d+);/) || [])[1];
const pageV = (page.match(/var LIVE = '\/api\/live\?v=(\d+)'/) || [])[1];
ok('the page asks /api/live for the version the worker keys on and the app requests',
  !!workerV && workerV === clientV && workerV === pageV, `worker ${workerV}, app ${clientV}, page ${pageV}`);
ok('the page fetches that constant rather than a literal URL', /fetch\(LIVE\)/.test(page));

// ── 2. the fold ───────────────────────────────────────────────────────────
const live = {
  'Jalen Hurts': { t: 'PHI', i: null, s: 'Active', d: ['QB', 1] },
  'Tanner McKee': { t: 'PHI', i: null, s: 'Active', d: ['QB', 3] },
  'Andy Dalton': { t: 'PHI', i: null, s: 'Active', d: ['QB', 2] },
  'Saquon Barkley': { t: 'PHI', i: null, s: 'Active', d: ['RB', 1] },
  'Will Shipley': { t: 'PHI', i: null, s: 'Active', d: ['RB', 3] },
  'Tank Bigsby': { t: 'PHI', i: 'Questionable', s: 'Active', d: ['RB', 2], b: 'Hamstring' },
  'DeVonta Smith': { t: 'PHI', i: null, s: 'Active', d: ['LWR', 1] },
  'Dontayvion Wicks': { t: 'PHI', i: null, s: 'Active', d: ['RWR', 2] },
  'Makai Lemon': { t: 'PHI', i: null, s: 'Active', d: ['SWR', 3] },
  'Dallas Goedert': { t: 'PHI', i: null, s: 'Active', d: ['TE', 1] },
  'Grant Calcaterra': { t: 'PHI', i: 'IR', s: 'Inactive', d: ['TE', 2] },
  'Johnny Wilson': { t: 'PHI', i: null, s: 'Active', d: [null, 9] },   // slot unknown
  'Jake Elliott': { t: 'PHI', i: null, s: 'Active' },                  // a kicker: no slot at all
  'Old Team Guy': { t: null, i: 'Out', s: 'Active', d: ['RB', 1] },    // nowhere to file him
  'Wrong Order': { t: 'ARI', i: null, s: 'Active', d: ['RB', 'x'] },   // unparseable rank
};
const t = fold(live);
ok('receivers merge across LWR/RWR/SWR into one order',
  JSON.stringify(t.PHI.WR.map(m => m.name)) === JSON.stringify(['DeVonta Smith', 'Dontayvion Wicks', 'Makai Lemon']),
  JSON.stringify(t.PHI.WR.map(m => m.name)));
ok('the order is the feed\'s rank, not the feed\'s order',
  JSON.stringify(t.PHI.QB.map(m => m.name)) === JSON.stringify(['Jalen Hurts', 'Andy Dalton', 'Tanner McKee']),
  JSON.stringify(t.PHI.QB.map(m => m.name)));
ok('a designation rides on the name as its abbreviation, with the body part in the title',
  t.PHI.RB[1].name === 'Tank Bigsby' && t.PHI.RB[1].tag === 'Q' && t.PHI.RB[1].title === 'Questionable — hamstring',
  JSON.stringify(t.PHI.RB[1]));
ok('a healthy player carries no tag', t.PHI.RB[0].tag === '' && t.PHI.RB[0].title === '');
ok('IR is spelled out as IR', t.PHI.TE[1].tag === 'IR');
ok('a player with no slot, no team or an unparseable rank stays out',
  !JSON.stringify(t).includes('Johnny Wilson') && !JSON.stringify(t).includes('Jake Elliott')
  && !JSON.stringify(t).includes('Old Team Guy') && !t.ARI);
ok('a payload with no depth order folds to an empty table, not a crash',
  JSON.stringify(fold({ 'Jake Elliott': { t: 'PHI', i: null, s: 'Active' } })) === '{}');
ok('no payload at all folds to an empty table', JSON.stringify(fold({})) === '{}');

// ── 3. the page prints at least as deep as the coach's table ──────────────
const coachKeep = JSON.parse((idx.match(/const DEPTH_KEEP = (\{[^}]*\});/) || [])[1]
  .replace(/([A-Z]+):/g, '"$1":'));
const shallow = Object.keys(coachKeep).filter(p => !(KEEP[p] >= coachKeep[p]));
ok('the reader sees at least as far down the chart as the Value Coach does',
  shallow.length === 0, shallow.map(p => `${p}: page ${KEEP[p]} < coach ${coachKeep[p]}`).join('; '));

// ── the page itself ───────────────────────────────────────────────────────
ok('the page is canonical at /depth-charts', /<link rel="canonical" href="https:\/\/irontuna\.com\/depth-charts">/.test(page));
ok('the page is in the sitemap, as a page that changes daily',
  /<loc>https:\/\/irontuna\.com\/depth-charts<\/loc>[\s\S]*?<changefreq>daily<\/changefreq>/.test(sitemap));
ok('the nav reaches it from every page', fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !['index.html', 'front.html', 'admin.html', 'lead.html', 'play-caller-premium.html', 'the-tell.html'].includes(f))
  .every(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('href="/depth-charts"')));
// FA is where the board files a player without a club, not a club.
const clubs = [...new Set([...worker.matchAll(/team: "([A-Z]{2,3})"/g)].map(m => m[1]))].filter(c => c !== 'FA');
ok('every club the site prices has a name on this page, so no card is headed by a bare abbreviation',
  clubs.length >= 32 && clubs.every(c => TEAMS[c]),
  clubs.length + ' clubs; missing ' + (clubs.filter(c => !TEAMS[c]).join(', ') || 'none'));
ok('the page says what a depth chart does not settle', /not a snap count/.test(page));
ok('the page says when the feed did not answer rather than showing an empty board',
  /did not answer/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
