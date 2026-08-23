#!/usr/bin/env node
// Tests for the player lookup and the card it lands on.
//   node tools/test-player-card.mjs
//
// Three things here are quiet enough to ship broken:
//
//   1. THE INDEX GOES STALE. player-search.js carries one row per player the app
//      prices, generated from the PROJECTIONS block in _worker.js. A projections
//      update that adds, moves or renames a player and does not re-run
//      tools/build-front.mjs leaves the ribbon's box unable to find somebody the
//      site is actively pricing — and the box does not say "my index is old", it
//      says "No player by that name on the board", which reads as a fact about
//      the player. The CI rebuild gate catches a forgotten run; this catches the
//      shape of what the run produces.
//
//   2. THE TWO BOARDS DISAGREE ABOUT WHAT `v` MEANS. On the reader's own saved
//      board `v` is auctionValue — the VBD number, what he is WORTH. On the
//      site's default board in /it-league.js it is the market curve at his slot —
//      the GOING RATE. Labelling both "worth" would have the site telling a
//      reader the price is the value, which is the exact confusion the cheat
//      sheet's Proj / Value split exists to end. The card labels each for the
//      board that answered, and that is asserted here.
//
//   3. THE CARD CANNOT ADVERTISE A SECOND VALUATION. Every number on it comes
//      from /it-league.js. The moment player-search.js or player.html grows its
//      own points or prices there are two answers on the site to "what is he
//      worth", and they will drift.
//
// Plain node, no browser: it reads the shipped files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const search = read('player-search.js');
const card = read('player.html');
const front = read('front.html');
const worker = read('_worker.js');
const league = read('it-league.js');

// ── the index ──────────────────────────────────────────────────────────────
console.log('\nthe lookup index covers the pool the app prices');
const rows = (() => {
  const m = search.match(/var INDEX_RAW = ("(?:[^"\\]|\\.)*");/);
  if (!m) return null;
  return JSON.parse(m[1]).split('\n').filter(Boolean).map((l) => l.split('|'));
})();
ok('player-search.js carries a generated index', !!rows && rows.length > 0,
   rows ? String(rows.length) : 'no INDEX_RAW found');

// The projections are the pool. Same parse tools/build-front.mjs uses.
const projStart = worker.indexOf('const PROJECTIONS = [');
const projBlock = worker.slice(projStart, worker.indexOf('\n];', projStart));
const slug = (name) => name.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pool = [...projBlock.matchAll(/\{\s*name:\s*"([^"]+)",\s*position:\s*"([^"]+)",\s*team:\s*"([^"]*)"/g)]
  .map((m) => ({ k: slug(m[1]), n: m[1], pos: m[2], team: (m[3] === 'JAC' ? 'JAX' : m[3]) || 'FA' }));

// Coverage is asserted on NAME + CLUB + POSITION, never on the slug. The index
// is keyed by the headshot row's slug where one can be joined (so a card and
// the calls written about that player share an id), and those two spellings do
// not always agree — comparing slugs here would re-implement that join and then
// only ever agree with itself.
const ident = (n, t, pos) => n + '|' + t + '|' + pos;
if (rows) {
  const have = new Set(rows.map((r) => ident(r[1], r[2], r[3])));
  const missing = pool.filter((p) => !have.has(ident(p.n, p.team, p.pos)));
  ok('every priced player is findable', missing.length === 0,
     missing.slice(0, 5).map((p) => p.n).join(', '));

  // Nobody the app does NOT price: a card for a player with no board row is a
  // page of blanks, and offering him in the box promises one.
  const inPool = new Set(pool.map((p) => ident(p.n, p.team, p.pos)));
  const extra = rows.filter((r) => !inPool.has(ident(r[1], r[2], r[3])));
  ok('nothing in the index is off the board', extra.length === 0,
     extra.slice(0, 5).map((r) => r[1]).join(', '));

  ok('every row is well formed',
     rows.every((r) => r.length === 6 && r[0] && r[1] && r[2] && r[3]),
     String(rows.filter((r) => r.length !== 6 || !r[0] || !r[3]).length) + ' bad row(s)');

  const dupes = rows.map((r) => r[0]).filter((k, i, a) => a.indexOf(k) !== i);
  ok('slugs are unique, so one URL is one player', dupes.length === 0, dupes.join(', '));

  const badSlug = rows.filter((r) => !/^[a-z0-9][a-z0-9-]*$/.test(r[0]));
  ok('every slug is URL-safe', badSlug.length === 0, badSlug.slice(0, 5).map((r) => r[0]).join(', '));

  // Skill players carry a photo id; kickers and defences are expected not to.
  const skill = rows.filter((r) => ['QB', 'RB', 'WR', 'TE'].includes(r[3]));
  const faced = skill.filter((r) => r[4] || r[5]).length;
  ok('most skill players carry a headshot id', faced / skill.length > 0.9,
     `${faced}/${skill.length}`);
}

// ── one valuation, not two ─────────────────────────────────────────────────
console.log('\nthe card asks /it-league.js rather than pricing anything itself');
const uncommented = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');
const VALUATION = /LEAGUE_MARKET_CURVE|SCORING_DEFAULTS|MIN_BID|effVorp|replacementLevel|projectedPoints/;
ok('the lookup index carries identity only, no points and no dollars',
   !!rows && rows.every((r) => r.length === 6));
ok('player-search.js implements no valuation', !VALUATION.test(uncommented(search)));
ok('player.html implements no valuation', !VALUATION.test(uncommented(card)));
for (const call of ['defaultBoard', 'findPlayer', 'tailorLabel', 'tailor']) {
  ok(`player.html reads ITLeague.${call}`, card.includes(call));
}
// Script ORDER, read off the tags rather than any mention in the prose:
// player-search.js sorts its suggestions by /it-league.js's dollars, so the
// library has to be defined by the time the widget mounts.
const tagAt = (f) => card.indexOf('<script src="' + f + '"');
ok('the card loads /it-league.js before it loads the lookup',
   tagAt('/it-league.js') > 0 && tagAt('/it-league.js') < tagAt('/player-search.js'));

// ── the two boards mean different things by `v` ────────────────────────────
console.log('\nthe going rate is never labelled as worth');
// The fact this rests on, asserted at the source rather than assumed: the
// default board's dollar figure is read off the market curve.
ok('/it-league.js prices its default board off the market curve',
   /defIndex\.byPos\[pos\][\s\S]{0,400}curve\[i\]/.test(league));
ok('the card labels the default board "Going rate"',
   /numEl\('Going rate'/.test(card));
ok('the card labels the reader\'s own board "Worth"',
   /numEl\('Worth'/.test(card));
ok('"Worth" is reached only on the reader\'s own board',
   /found\.mine[\s\S]{0,120}numEl\('Worth'/.test(card));
ok('the card explains the difference in words',
   /what the room is likely to pay/.test(card) && /replacement starter/.test(card));

// ── whose dollars the going rate is in ─────────────────────────────────────
// The default board is priced at the desk's league. A reader who saved one told
// us their budget, and a going rate is nothing but a budget — so the tile is
// converted by the library's own deskPrice(), the same conversion the tailored
// sentence under it uses, and it names the room those dollars are for instead
// of the desk's $200.
ok('the going rate is quoted through the library\'s conversion, not raw',
   /numEl\('Going rate'[\s\S]{0,200}deskPrice\(r\.v\)/.test(card));
ok('the tile names the reader\'s own room when they have one',
   card.includes("L.config.teams + ' teams, $' + L.config.budget"));
ok('and falls back to the desk\'s room for a reader with no league',
   card.includes("'12 teams, $200'"));
// Points are the shared projection at the site's rules. Only the reader's own
// board carries the stat lines to re-score them, so only that board's line may
// claim their scoring.
ok('their scoring is claimed only when their own board answered',
   /var scoring = found\.mine \?/.test(card));

// ── the route ──────────────────────────────────────────────────────────────
console.log('\n/player and /player/<slug> reach the card');
ok('the worker rewrites the slug route onto the shell',
   /\/\^\\\/player\(\\\/\[A-Za-z0-9\._-\]\*\)\?\\\/\?\$\//.test(worker)
   || worker.includes("new URL('/player', url)"));
ok('the rewrite target is extensionless', !worker.includes("new URL('/player.html'"));
ok('the card is noindex, like the other rendered shells',
   /name="robots"[^>]*noindex/.test(card));
ok('the card is not advertised in the sitemap',
   !read('sitemap.xml').includes('irontuna.com/player'));

// ── the box is on the front page, and stays on screen ──────────────────────
console.log('\nthe box lives in the sticky ribbon');
ok('front.html has the search box in the ribbon',
   /<div class="ribbon">[\s\S]*?class="rb-search"[\s\S]*?<\/div><\/div>/.test(front));
ok('the ribbon is still sticky', /\.ribbon\{[^}]*position:sticky/.test(front));
ok('front.html loads the lookup', front.includes('src="/player-search.js"'));
ok('the box opts in by attribute, so both pages mount the same widget',
   front.includes('data-player-search') && card.includes('data-player-search')
   && search.includes('[data-player-search]'));
// The menu cannot live inside .ribbon .wrap: that element scrolls sideways, so
// an absolutely positioned child of it is clipped to the band's height.
ok('the ribbon band is still a sideways scroller',
   /\.ribbon \.wrap\{[^}]*overflow-x:auto/.test(front));
ok('the menu is parented to <body> and positioned in viewport coordinates',
   /doc\.body\.appendChild\(menu\)/.test(search) && /\.pl-menu\{position:fixed/.test(front));
ok('the menu follows the ribbon when the page scrolls',
   /on\(root, 'scroll'[\s\S]{0,60}place\(\)/.test(search));
// The draft app is React and mounts the widget from an effect, so mount() has
// to hand back a teardown — the menu lives on <body> and React will not clean
// up something it never rendered.
ok('mount() returns a teardown', /return function \(\) \{[\s\S]{0,400}removeChild\(menu\)/.test(search));

console.log('\nthe draft app runs the same box in its dark ribbon');
const app = read('index.html');
ok('index.html loads the lookup', app.includes('src="/player-search.js"'));
ok('the lookup is a plain script, not a module',
   /<script src="\/player-search\.js"><\/script>/.test(app));
ok('it is loaded before the app module',
   app.indexOf('src="/player-search.js"') < app.indexOf('<script type="module">'));
ok('the ribbon renders the shared widget', app.includes('function RibbonPlayerSearch'));
// Both dark ribbons — the splash and the hub — or the box is only half added.
ok('both dark ribbons carry it',
   (app.match(/React\.createElement\(RibbonPlayerSearch,/g) || []).length === 2,
   String((app.match(/React\.createElement\(RibbonPlayerSearch,/g) || []).length));
ok('the app calls mount() and honours its teardown',
   /return window\.ITPlayerSearch\.mount\(/.test(app));
ok('the dark ribbon is still sticky', /\.lp-ribbon \{[^}]*position: sticky/.test(app));
// The menu is parented to <body>, so it inherits nothing from .lp-ribbon and
// needs its own dark rules on this page.
ok('index.html styles the menu for its own palette', /\.pl-menu \{ position: fixed/.test(app));
// The one number here that is not cosmetic. .landing-splash is the surface the
// dark ribbon sits on; at the front page's z-index the menu paints underneath
// it and is simply invisible. It must clear the splash and stay under a modal,
// because a modal genuinely should cover the ribbon.
{
  const zOf = (re) => { const m = app.match(re); return m ? Number(m[1]) : null; };
  const menuZ = zOf(/\.pl-menu \{[^}]*z-index: (\d+)/);
  const splashZ = zOf(/\.landing-splash \{[^}]*z-index: (\d+)/);
  const modalZ = zOf(/\.modal-bg \{[^}]*z-index: (\d+)/);
  ok('the menu clears .landing-splash', menuZ > splashZ, `${menuZ} vs ${splashZ}`);
  ok('the menu stays under a modal', menuZ < modalZ, `${menuZ} vs ${modalZ}`);
}
ok('the app implements no second lookup',
   !/INDEX_RAW/.test(app));

// ── the card lists what the desk actually said ─────────────────────────────
console.log('\nthe calls on a card are the front page\'s own');
const cardStories = (card.match(/^var STORIES = (\[[\s\S]*?\]);$/m) || [])[1];
const frontStories = (front.match(/^var STORIES = (\[[\s\S]*?\]);\n/m) || [])[1];
ok('player.html carries a STORIES array', !!cardStories);
ok('it is byte-identical to the front page\'s', cardStories === frontStories,
   cardStories && frontStories ? 'they differ' : 'one is missing');
if (cardStories) {
  const stories = JSON.parse(cardStories);
  const named = stories.filter((s) => (s.ppl || []).length);
  ok('the calls name players to hang cards off', named.length > 0, String(named.length));
  // Every slug a story names has to resolve, or the card lists nothing for a
  // player the desk plainly wrote about.
  if (rows) {
    // A card is keyed by the same slug a story's `ppl` uses, so a mismatch
    // means the calls written about a player never reach his card. The two
    // spellings are not always identical ("Chigoziem Okonkwo" in the
    // projections, "Chig Okonkwo" in the nflverse release), which is what
    // tools/build-front.mjs joins on club and surname to fix.
    //
    // An unresolved slug is only legitimate when the app does not price that
    // player at all — a retired fullback the desk mentioned in passing has no
    // card because he has no board row, and that is right. So the exemption is
    // CHECKED rather than listed: the projections must not contain anyone at
    // his club and position with his surname.
    const shots = new Map(JSON.parse(read('tools/nfl-headshots.json')).map((p) => [p.k, p]));
    const last = (n) => slug(String(n).replace(/\s+(?:Jr\.?|Sr\.?|I{2,3}|IV|V)$/i, '').trim().split(/\s+/).pop());
    const priced = new Set(pool.map((p) => p.team + '|' + p.pos + '|' + last(p.n)));
    const have = new Set(rows.map((r) => r[0]));
    const orphan = [...new Set(stories.flatMap((s) => s.ppl || []))].filter((k) => !have.has(k));
    const shouldHave = orphan.filter((k) => {
      const hs = shots.get(k);
      return hs && priced.has(hs.t + '|' + hs.p + '|' + last(hs.n));
    });
    ok('every player a call names AND the app prices has a card',
       shouldHave.length === 0, shouldHave.join(', '));
    console.log(`  (${orphan.length} named player(s) the app does not price: ${orphan.join(', ') || 'none'})`);
  }
}
ok('the card gates unpublished drops the same way the worker does',
   /Date\.UTC\([^)]*13, 0, 0\)/.test(card));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
