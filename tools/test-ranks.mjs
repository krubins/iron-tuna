#!/usr/bin/env node
// The rankings section: the ribbon under the header, the per-position pages
// under its two menus, and the board that fills them.
//   node tools/test-ranks.mjs
//
// WHAT THIS EXISTS FOR. Three failures here are silent — the page renders, the
// build gates pass, and only a reader finds out:
//
//   1. THE RIBBON DRIFTS. It is one link set on nineteen pages. build-ranks.mjs
//      generates it, but a hand edit inside the sentinels survives until the
//      next run of the tool, and nobody runs a tool they have not been told is
//      stale. So the link set is compared BYTE FOR BYTE across every page that
//      carries it, and the tool's --check is the gate that keeps it there.
//   2. THE MENU IS CLIPPED. `overflow-x: auto` with `overflow-y: visible`
//      computes to `overflow-y: auto` — so a dropdown inside a sideways-
//      scrolling band is not "mostly fine", it is invisible below 46px. This
//      exact bug is why front.html's own ribbon parents its search menu to
//      <body>. The row must not be a scroll container at desktop width.
//   3. A PAGE IS UNGATED. /rankings is behind POST_DRAFT_OPEN. A per-position
//      page that is not in POST_DRAFT_PAGES serves the whole board while the
//      section is shut, and tools/test-seo.mjs would then demand a sitemap entry
//      for it. The two lists are read out of their own files and compared.
//
// It also holds the pages to the promise their menus make: every position in
// the ribbon has a page, every page asks the board for that position, and only
// the season-long pages open into the weeks ahead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const POSITIONS = ['qb', 'rb', 'wr', 'te', 'flex', 'k', 'dst'];
const CATS = [
  { slug: 'weekly', horizon: 'week', weeks: '0' },
  { slug: 'season-long', horizon: 'ros', weeks: '1' },
];
const LANES = ['stats.html', 'hidden-value.html', 'previews.html'];
const pageFile = (c, p) => `${c.slug}-${p}-rankings.html`;
const hubFile = (c) => `${c.slug}-rankings.html`;
const allBoards = CATS.flatMap((c) => [hubFile(c), ...POSITIONS.map((p) => pageFile(c, p))]);

// ── the pages exist and ask for the right board ──────────────────────────────
console.log('\nevery position in the menu has a page of its own');
{
  const missing = allBoards.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  ok('all sixteen rankings pages exist', missing.length === 0, missing.join(', '));

  const wrong = [];
  for (const c of CATS) {
    for (const p of [null, ...POSITIONS]) {
      const f = p ? pageFile(c, p) : hubFile(c);
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      const h = read(f);
      const mount = (h.match(/<div class="rk-board"[\s\S]*?><\/div>/) || [''])[0];
      const attr = (k) => (mount.match(new RegExp(`data-rk-${k}="([^"]*)"`)) || [, ''])[1];
      if (attr('horizon') !== c.horizon) wrong.push(`${f}: horizon=${attr('horizon')} want ${c.horizon}`);
      if (attr('pos') !== (p ? p.toUpperCase() : 'ALL')) wrong.push(`${f}: pos=${attr('pos')}`);
      if (attr('weeks') !== c.weeks) wrong.push(`${f}: weeks=${attr('weeks')} want ${c.weeks}`);
    }
  }
  ok('each one asks the board for its own horizon and position', wrong.length === 0, wrong.slice(0, 4).join('; '));

  // Only the season-long boards can open a row: "this week" is one week, and a
  // drawer holding a single row is a control that does nothing.
  const weekOpens = CATS[0] && [hubFile(CATS[0]), ...POSITIONS.map((p) => pageFile(CATS[0], p))]
    .filter((f) => fs.existsSync(path.join(ROOT, f)) && /data-rk-weeks="1"/.test(read(f)));
  ok('no weekly board offers a week-by-week drawer', weekOpens.length === 0, weekOpens.join(', '));

  const noDrawer = [hubFile(CATS[1]), ...POSITIONS.map((p) => pageFile(CATS[1], p))]
    .filter((f) => fs.existsSync(path.join(ROOT, f)) && !/data-rk-weeks="1"/.test(read(f)));
  ok('every season-long board does', noDrawer.length === 0, noDrawer.join(', '));

  const noScript = allBoards.concat(LANES).filter((f) => fs.existsSync(path.join(ROOT, f)))
    .filter((f) => f.includes('rankings') && !read(f).includes('src="/it-ranks.js"'));
  ok('and loads the one board script', noScript.length === 0, noScript.join(', '));
}

// ── the ribbon is one link set, everywhere ───────────────────────────────────
console.log('\nthe ribbon is generated, and identical on every page that carries it');
const RIB = /<!--ranks:ribbon-->([\s\S]*?)<!--\/ranks:ribbon-->/;
const carriers = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && RIB.test(read(f))).sort();
{
  // The front page is NOT a carrier: the choose-your-game band took this slot
  // under its hero, and a reader who has just been told what the site does is
  // asked which game they play before they are offered a board.
  ok('the ribbon is off the front page', !carriers.includes('front.html'));
  ok('on the full rankings tool', carriers.includes('rankings.html'));
  ok('on all sixteen rankings pages', allBoards.every((f) => carriers.includes(f)));
  ok('and on the three other destinations', LANES.every((f) => carriers.includes(f)));

  // Byte for byte, once the one legitimate per-page difference — which item is
  // marked current — is taken out.
  const shape = (f) => read(f).match(RIB)[1].replace(/ aria-current="page"/g, '');
  const shapes = new Map();
  for (const f of carriers) {
    const s = shape(f);
    if (!shapes.has(s)) shapes.set(s, []);
    shapes.get(s).push(f);
  }
  ok('there is exactly one ribbon shape', shapes.size === 1,
    shapes.size + ' variants, e.g. ' + [...shapes.values()].map((v) => v[0]).slice(0, 4).join(' / '));

  const rib = read('rankings.html').match(RIB)[1];
  const links = [...rib.matchAll(/<a[^>]*class="rkr-link[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].trim());
  ok('it carries the six destinations, in order',
    links.join('|') === 'Stats|This Week&rsquo;s Rankings|Season Long Rankings|Hidden Value|Previews|The Line', links.join('|'));

  const menus = [...rib.matchAll(/<span class="rkr-menu"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  ok('two of them drop down', menus.length === 2, String(menus.length));
  for (const [i, c] of CATS.entries()) {
    const hrefs = [...(menus[i] || '').matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    const want = ['/' + c.slug + '-rankings', ...POSITIONS.map((p) => `/${c.slug}-${p}-rankings`)];
    ok(`the ${c.slug} menu drops every position`, hrefs.join(',') === want.join(','), hrefs.join(','));
  }
}

// ── what sits under the front page's hero ────────────────────────────────────
console.log('\nwhat sits under the front page\u2019s hero');
{
  const front = read('front.html');
  const heroStart = front.indexOf('<section class="hero-band"');
  const heroEnd = front.indexOf('</section>', heroStart);
  const bandAt = front.indexOf('<div class="hm-choose">');
  const nextSec = front.indexOf('<section', heroEnd);
  ok('the hero band is still the first section', heroStart > 0);
  ok('the choose-your-game band is after it', bandAt > heroEnd, `hero ends ${heroEnd}, band at ${bandAt}`);
  ok('and before anything else on the page', bandAt < nextSec, `next section at ${nextSec}`);
  ok('it states the question and nothing else',
     /<span class="hm-choose-k">Choose your game<\/span>/.test(front));
  // The homepage's own in-page anchor ribbon — the sticky bar of lane tabs and
  // section jumps — came off with the sections it pointed at in the September
  // 2026 rewrite, and the generated rankings ribbon came off this slot after
  // it. Neither may come back: one navigated away mid-pitch, the other was a
  // second bar of the same shape.
  ok('there is no second, in-page ribbon to confuse it with',
     !/<div class="ribbon"[^>]*>/.test(front));
  ok('and no ribbon link is left on the page', !/rkr-link/.test(front));
}

// ── the dropdown is not inside a scroll container ────────────────────────────
console.log('\nthe menu can actually hang out of the band');
{
  // overflow-x:auto with overflow-y:visible computes to overflow-y:auto, so a
  // menu inside such a row is clipped at the band's height. The desktop rule
  // must declare no overflow at all; the phone rule may, because the menus are
  // display:none there.
  const css = read('site.css').match(/\/\* ranks:css \*\/([\s\S]*?)\/\* \/ranks:css \*\//)[1];
  const desktop = css.split('@media')[0];
  ok('the desktop row is not a scroll container', !/\.rk-ribbon-in\s*\{[^}]*overflow/.test(desktop),
    (desktop.match(/\.rk-ribbon-in\s*\{[^}]*\}/) || [''])[0]);
  ok('the phone row is, because its menus are off',
    /@media[^{]*860px[\s\S]*?\.rk-ribbon-in\s*\{[^}]*overflow-x:\s*auto/.test(css));
  ok('and the menus really are off there', /@media[^{]*860px[\s\S]*?\.rkr-menu\s*\{\s*display:\s*none/.test(css));
  ok('the menu opens on focus as well as hover', /\.rkr-has-menu:focus-within \.rkr-menu/.test(css));
  // site.css is the only carrier of the block. front.html links no stylesheet
  // and held a second inline copy while the ribbon sat under its hero; with the
  // ribbon off that page, a copy left behind would be styling for an element
  // that is not there.
  ok('front.html carries no stale copy of it', !read('front.html').includes('/* ranks:css */'));
}

// ── every new page is gated with the rest of the section ─────────────────────
console.log('\nthe section is gated like the rest of the in-season tools');
{
  const worker = read('_worker.js');
  const m = worker.match(/const POST_DRAFT_PAGES = new Set\(\[([^\]]*)\]\)/);
  ok('POST_DRAFT_PAGES is still one bracketed list of literals', !!m);
  const gated = new Set((m ? m[1] : '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  ok('no entry is a computed expression', [...gated].every((g) => /^\/[a-z0-9-]+$/.test(g)),
    [...gated].filter((g) => !/^\/[a-z0-9-]+$/.test(g)).join(', '));
  const want = allBoards.concat(LANES).map((f) => '/' + f.replace(/\.html$/, ''));
  const ungated = want.filter((w) => !gated.has(w));
  ok('every page in the section is in the gate', ungated.length === 0, ungated.join(', '));

  // And the CTA. There is no in-season list to be on any more: the header button
  // is the same on every page, because the draft CTA came off the whole site for
  // the season. What it must be is the league setup — the platform connectors
  // were removed (docs/saved-league.md) — so a rankings page cannot quietly go
  // back to selling a draft sheet in September.
  const missCta = allBoards.concat(LANES)
    .filter((f) => !/<a class="cta" href="\/my-league#settings">Customize My League<\/a>/.test(read(f)));
  ok('and its CTA is the league setup that actually works', missCta.length === 0, missCta.join(', '));
}

// ── the two columns the section is for ───────────────────────────────────────
console.log('\nthe board prints the consensus against the odds');
{
  const js = read('it-ranks.js');
  ok('the two column groups are named in full',
    js.includes('>Fantasy Consensus<') && js.includes('>Betting Odds<'));
  ok('the fantasy side reads the consensus block', /p\.consensus\s*\?\s*p\.consensus\.points/.test(js));
  ok('the market side reads the vegas block', /p\.vegas\s*\?\s*p\.vegas\.points/.test(js));
  ok('and prints what the odds are built from, every row', js.includes('rk-basis'));
  ok('the gap comes from the worker\'s own classification, not a rule invented here',
    js.includes('p.marketDelta') && js.includes('d.classification') && !/strongRank|leanRank/.test(js));
  ok('a missing number is a dash, never a zero', js.includes("'—'"));
  ok('the week drawer prints both columns per week',
    js.includes('w.consensusPts') && js.includes('w.vegasPts'));
  ok('a bye and an absence are printed, not skipped', js.includes('w.bye') && js.includes('w.out'));
  ok('the board is scored on the server, so the drawer cannot disagree with its row',
    js.includes('&scoring=') && !js.includes('ITLeague'));
  ok('and a board that does not answer shows nothing rather than something stale',
    /did not answer/.test(js));
}

// ── the two lines under every name ───────────────────────────────────────────
// The sentences are the board's answer to "is he any good" and "is this a week
// to start him", and every failure they can have is silent: a clause that
// DEFAULTS instead of dropping invents a number, a grade read off the wrong
// side of a fixture (a defense judged on its own offense) is a wrong sentence
// rather than a missing one, and a second copy of the tier table drifts from
// the first inside a season. So the grammar lives in it-reads.js, once, and the
// helpers there have no DOM behind them and are lifted out and actually run.
console.log('\nevery row says what the player is and what is in front of him');
{
  const reads = read('it-reads.js');
  const js = read('it-ranks.js');
  const tool = read('rankings.html');
  const cutFrom = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  const H = new Function(cutFrom(reads, '  var TIERS = {', '  // THE PLAYER LINE.') +
    '\nreturn { TIERS, POS_LONG, HZ, tierOf, gradeOf, ord, awayFrom, plural, listOf };')();
  // vol() calls n1(), so it is lifted with it rather than on its own.
  const H2 = new Function(cutFrom(reads, '  function n1(v)', '  // THE TIERS.') + '\nreturn { vol };')();
  H.vol = H2.vol;
  const worker = read('_worker.js');

  // ONE COPY. Two surfaces print these lines; if either grew its own tiers the
  // same player would be "a weekly WR1" on one page and "a WR2" on the other.
  ok('the tiers and the grammar live in one file', /var TIERS = \{/.test(reads));
  ok('and neither board carries a second copy of them',
    !/TIERS|function tierOf|function gradeOf/.test(js) && !/TIERS|function tierOf|function gradeOf/.test(tool));
  ok('both boards call it', /ITReads\.cell\(/.test(js) && /ITReads\.cell\(/.test(tool));
  ok('and both load it before the script that calls it',
    allBoards.every((f) => read(f).indexOf('/it-reads.js') < read(f).indexOf('/it-ranks.js')) &&
    tool.indexOf('/it-reads.js') < tool.indexOf('function reads(r)'));
  ok('a board without it renders the row rather than throwing',
    /if \(!window\.ITReads\) return ''/.test(js) && /if \(!window\.ITReads\) return ''/.test(tool));
  ok('both lines are labelled, from one place',
    /rk-read-pl[^]{0,80}>Player</.test(reads) && /rk-read-op[^]{0,90}>Opportunity</.test(reads));
  ok('and site.css styles them on both boards and on neither other one',
    /\.rk-vs td\.rk-who \.rk-read\b/.test(read('site.css')) && /\.rk-table td\.p \.rk-read\b/.test(read('site.css')));

  ok('a tier is the positional shape, not one invented per player',
    ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].every((k) => Array.isArray(H.TIERS[k])));
  ok('and it differs by position, because TE6 is a starter and RB6 is not',
    H.tierOf('TE', 6) !== H.tierOf('RB', 6));
  ok('the top of a position reads as the top of it', /elite|top of/.test(H.tierOf('WR', 2)));
  ok('and the far end of it does not', /depth|deep-league|waiver/.test(H.tierOf('WR', 90)));
  ok('an unranked player gets no tier at all, rather than the bottom one', H.tierOf('WR', null) === '');
  ok('every horizon either board can ask for has words of its own',
    ['week', 'next3', 'ros', 'playoffs'].every((k) => H.HZ[k] && H.HZ[k].when && H.HZ[k].slate));

  // The function's own body, not a window of N characters after its name: a
  // window is a test that fails the next time the function grows a comment.
  const playerLine = cutFrom(reads, '  function player(p, o) {', '  // THE OPPORTUNITY LINE');
  ok('the player line is ranked and scored by the CALLER, because only it knows the board',
    playerLine.includes('o.rank') && playerLine.includes('o.points') && !playerLine.includes('p.consensus'));
  ok('the published pages feed it the consensus, which is the column they rank on',
    /ITReads\.cell\(p, \{[^]{0,240}p\.consensus\.rank/.test(js));
  ok('and the tool feeds it whichever of four boards the reader picked',
    /f \+ 'Rank'/.test(tool) && /points: bp\(r\)/.test(tool));
  ok('neither hands it a pooled flex slot: that is spelled out instead',
    /spellOut: pos === 'FLEX'/.test(js) && /spellOut: pos === 'FLEX'/.test(tool) &&
    /o\.spellOut && POS_LONG\[p\.position\]/.test(playerLine));
  ok('a usage swing is quoted only once three games have earned it',
    playerLine.includes('roleTrend.applied'));
  ok('and a player with no game on the board is not given a 0.0 projection',
    playerLine.includes('p.games > 0'));

  // A RANK IS NOT A PERFORMANCE. "RB3, elite at the position" is one fact said
  // twice; what a reader cannot get from the "#" column is what the player has
  // actually done, so the season line leads and the tier is only the fallback.
  ok('the player line leads on what he has actually done, not on a tier',
    playerLine.indexOf('p.form') < playerLine.indexOf('tierOf('),
    'tierOf must come after the form branch');
  ok('and the tier is reached only when nothing has been played',
    /\} else \{[^]{0,400}tierOf\(p\.position, rank\)/.test(playerLine));
  ok('it says the volume the scoring was built on', playerLine.includes('f.volumeUnit'));
  ok('and compares the projection ahead of him with the rate he has run at',
    playerLine.includes('forwardOf(') && /marks '? ?\+? ?\(d < 0 \? 'down' : 'up'\)/.test(reads));
  ok('that comparison is drawn only where both numbers are per-game rates',
    /hz === 'week' \? proj \+ ' projected this week' : forwardOf\(/.test(playerLine));
  ok('two numbers a tenth apart are not reported as a judgement',
    /Math\.abs\(d\) < 0\.1/.test(reads));
  ok('yards are whole numbers and touches are not',
    H.vol(281.04, 'passing yards') === '281' && H.vol(19.04, 'touches') === '19.0');

  // The worker's half: the season line was already read for the role trend and
  // thrown away, and it is shipped raw so a browser that re-scores can.
  ok('the worker ships the season line every board row is graded from',
    /function seasonFormFrom\(/.test(worker) && /const form = seasonFormFrom\(/.test(worker) &&
    /roleTrend: role, form,/.test(worker));
  ok('raw, so a page that re-scores in the browser can re-score it too',
    /stats: _roundStats\(stats\), points: pts/.test(worker) && /formPpg: ppg/.test(tool));
  ok('a player who has not played gets null, never a 0.0 he did not earn',
    /if \(!sea \|\| games <= 0\) return null;/.test(worker) && /if \(!stats\) return null;/.test(worker));
  ok('volume is the figure that position is actually counted in',
    /volumeUnit = 'touches'/.test(worker) && /volumeUnit = 'targets'/.test(worker) &&
    /volumeUnit = 'passing yards'/.test(worker));

  // A usage trend that divides a passer's attempts by his rushes is not a
  // trend, and it fed the Iron Tuna blend as well as the printed percentage.
  ok('the role trend counts the same things on both sides of its comparison',
    /rec\.season\.passAttempts \+= r\.usage\.passAttempts \|\| 0;/.test(worker) &&
    /\(seasonAtt \|\| 0\)\) \/ g;/.test(worker));
  ok('and a cache too old to support it says so rather than guessing',
    /if \(att > 0 && !\(seasonAtt > 0\)\) return \{ label: 'no data'/.test(worker));

  ok('a low defensive rank is a hard week and a high one a soft week',
    H.gradeOf(1).includes('hard') && H.gradeOf(30).includes('soft') && H.gradeOf(16).includes('average'));
  ok('and the two thresholds are the worker\'s own (11 / 22), so a week and a season grade agree',
    H.gradeOf(11).includes('hard') && H.gradeOf(12).includes('average') &&
    H.gradeOf(21).includes('average') && H.gradeOf(22).includes('soft'));
  ok('ranks are ordinals a reader can say out loud',
    [H.ord(1), H.ord(2), H.ord(3), H.ord(11), H.ord(12), H.ord(13), H.ord(21), H.ord(22)].join(' ') ===
    '1st 2nd 3rd 11th 12th 13th 21st 22nd');
  ok('a fixture level with a club\'s own mean says so rather than printing 0.0',
    H.awayFrom(0) === 'level with' && H.awayFrom(null) === 'level with' &&
    H.awayFrom(2.1) === '2.1 above' && H.awayFrom(-2.1) === '2.1 below');
  ok('three byes read as a list, not as a chain of "and"s',
    H.listOf([7]) === '7' && H.listOf([7, 8]) === '7 and 8' && H.listOf([7, 8, 9]) === '7, 8 and 9');

  ok('a multi-week slate is graded with the worker\'s own label, so it cannot contradict the column',
    /slateOpportunity[^]{0,900}scheduleDifficulty/.test(reads) &&
    /sd\.label === 'Hard'/.test(reads) && !/avgOpponentDefRank\s*<=\s*11/.test(reads));
  ok('a DEFENSE is graded on the other side of the fixture, never on its own offense',
    /position === 'DST'[^]{0,700}allowedImplied/.test(reads) &&
    /position === 'DST'[^]{0,700}allowedDelta/.test(reads));
  ok('and the worker actually ships that side of the fixture',
    /allowedImplied: env\.allowedImplied/.test(read('_worker.js')));
  ok('an unpriced fixture says it is a fitted rating rather than quoting a line',
    /fitted team rating rather than a posted line/.test(reads));
  ok('and a season mean is only quoted against a line a book has posted',
    /posted \? \(env\.impliedDelta != null/.test(reads));
  ok('a player with no game has an opportunity line that says exactly that',
    /On bye this week/.test(reads) && /Out of this week/.test(reads));
  ok('an absence is no longer printed over a fixture as a bye',
    !/filter\(function \(w\) \{ return !w\.bye && !w\.out; \}\)\[0\]/.test(js) &&
    /w0\.out \?/.test(js));

  const noRead = allBoards.filter((f) => !read(f).includes('How to read the two lines under a name'));
  ok('and all sixteen pages tell the reader what the two lines are', noRead.length === 0, noRead.join(', '));
  ok('so does the tool', /the two lines under a name/i.test(tool));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
