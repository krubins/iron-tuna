#!/usr/bin/env node
// The rankings section: the ribbon under the header, the one rankings page it
// leads to, and the two lines under every name on it.
//   node tools/test-ranks.mjs
//
// WHAT THIS EXISTS FOR. Three failures here are silent — the page renders, the
// build gates pass, and only a reader finds out:
//
//   1. THE RIBBON DRIFTS. It is one link set on every page that carries it.
//      build-ranks.mjs generates it, but a hand edit inside the sentinels
//      survives until the next run of the tool, and nobody runs a tool they
//      have not been told is stale. So the link set is compared BYTE FOR BYTE
//      across every page that carries it, and the tool's --check is the gate
//      that keeps it there.
//   2. THE MENU IS CLIPPED. `overflow-x: auto` with `overflow-y: visible`
//      computes to `overflow-y: auto` — so a dropdown inside a sideways-
//      scrolling band is not "mostly fine", it is invisible below 46px. This
//      exact bug is why front.html's own ribbon parents its search menu to
//      <body>. The row must not be a scroll container at desktop width.
//   3. AN OLD ADDRESS GOES DARK. Until 11 Oct 2026 the section was sixteen
//      per-position pages and two hubs (/weekly-<pos>-rankings,
//      /season-long-<pos>-rankings) beside the tool; they are indexed, linked
//      from outside and printed in older copy. They are gone from the repo
//      and _worker.js 301s each one onto /rankings with the horizon and the
//      position in the hash. A page that came back, or a redirect that lost
//      a position, would both pass every other gate.
//
// It also holds /rankings to the one shared grammar for the two lines under
// a name (it-reads.js), and the front page's tiles to the one rankings page.

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
const LANES = ['stats.html', 'hidden-value.html', 'previews.html'];
// The section's pages: the tool and the three lanes beside it in the ribbon.
const SECTION = ['rankings.html'].concat(LANES);
// The retired addresses, hub and per-position, both categories.
const OLD = ['weekly', 'season-long'].flatMap((c) =>
  [`/${c}-rankings`, ...POSITIONS.concat('overall').map((p) => `/${c}-${p}-rankings`)]);

// ── the old pages are gone, and their addresses still answer ─────────────────
console.log('\nthe old pages are gone, and their addresses 301 to the one page');
{
  const stale = OLD.map((u) => u.slice(1) + '.html').filter((f) => fs.existsSync(path.join(ROOT, f)));
  ok('no weekly or season-long rankings page is in the repo', stale.length === 0, stale.join(', '));
  ok('and the board script only they loaded is gone with them', !fs.existsSync(path.join(ROOT, 'it-ranks.js')));
  ok('nothing served still loads it',
    fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).every((f) => !read(f).includes('src="/it-ranks.js"')));

  const worker = read('_worker.js');
  const m = worker.match(/const __rk = (\/\^[^\n]*?\/)\.exec\(url\.pathname\);/);
  ok('the worker matches the old addresses with one expression', !!m);
  const re = m ? new Function('return ' + m[1])() : /$^/;
  const unmatched = OLD.filter((u) => !re.test(u));
  ok('every one of the eighteen is matched', unmatched.length === 0, unmatched.join(', '));
  const over = ['/rankings', '/weekly-wrap', '/weekly-intel', '/weekly-rankings-2', '/season-long-rankingsx']
    .filter((u) => re.test(u));
  ok('and nothing else is', over.length === 0, over.join(', '));
  const block = (worker.match(/const __rk = [\s\S]{0,900}?\n    \}\n/) || [''])[0];
  ok('it is a permanent redirect', /status: 301/.test(block));
  ok('onto the one rankings page, with the horizon in the hash',
    /'\/rankings#horizon=' \+ __hz/.test(block) && /'weekly' \? 'week' : 'ros'/.test(block));
  ok('and the position, in the page\'s own upper-case keys',
    /'&pos=' \+ __rk\[2\]\.toUpperCase\(\)/.test(block));
  ok('the pooled board lands on the horizon alone', /__rk\[2\] !== 'overall'/.test(block));
  ok('before the gate, so a closed section cannot swallow the redirect',
    worker.indexOf('const __rk = ') < worker.indexOf('let __assetReq = request;'));
  ok('the player card\'s board button opens the one page on his position',
    /href="\/rankings#pos=' \+ board \+ '"/.test(worker) && !/\/weekly-' \+ board/.test(worker));
  ok('and the worker no longer pre-renders a board for pages that do not exist',
    !/ranksPrerender|rkPreHtml|RK_PRERENDER_ROWS/.test(worker));
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
  ok('it carries the five destinations, in order',
    links.join('|') === 'Stats|Rankings|Hidden Value|Previews|The Line', links.join('|'));
  ok('and lists the rankings once, not as a weekly page and a season-long one',
    !/Week|Season/.test(links.join('|')), links.join('|'));

  const menus = [...rib.matchAll(/<span class="rkr-menu"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  ok('one of them drops down', menus.length === 1, String(menus.length));
  {
    const hrefs = [...(menus[0] || '').matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    // Every position lands on the one rankings page with the position in the
    // hash, which the page reads on load and on hashchange; the tool's own
    // keys, so DST not DEF.
    const want = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map((p) => `/rankings#pos=${p}`);
    ok('the Rankings menu drops every position onto the one page', hrefs.join(',') === want.join(','), hrefs.join(','));
    const trig = (rib.match(/<a class="rkr-link" href="\/rankings"[^>]*>/) || [''])[0];
    ok('and the trigger is the page itself, marked current there', /aria-current="page"/.test(trig), trig);
  }
}

// ── what sits under the front page's hero ────────────────────────────────────
console.log('\nwhat sits under the front page\u2019s hero');
{
  // October 2026: the hero is the first section and the position tiles are
  // the second; the choose-your-game band went with the lane cards. Each tile
  // links a weekly position page, which is this section's own job.
  const front = read('front.html');
  const heroStart = front.indexOf('<section class="hero-band');
  const heroEnd = front.indexOf('</section>', heroStart);
  const tilesAt = front.indexOf('<section class="hm-sec" id="positions"');
  const nextSec = front.indexOf('<section', heroEnd);
  ok('the hero band is still the first section', heroStart > 0 && heroStart === front.indexOf('<section'));
  ok('the position tiles are the section after it', tilesAt > heroEnd && tilesAt === nextSec, `hero ends ${heroEnd}, tiles at ${tilesAt}, next ${nextSec}`);
  ok('and every position tile opens the one rankings page on that position',
     POSITIONS.filter((p) => p !== 'flex').every((p) => front.includes('href="/rankings#pos=' + p.toUpperCase() + '"')));
  ok('no tile links a weekly page', !/href="\/weekly-[a-z]+-rankings"/.test(front));
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
  const want = SECTION.map((f) => '/' + f.replace(/\.html$/, ''));
  ok('and the eighteen retired addresses are out of it', OLD.every((u) => !gated.has(u)));
  const ungated = want.filter((w) => !gated.has(w));
  ok('every page in the section is in the gate', ungated.length === 0, ungated.join(', '));

  // And the CTA. There is no in-season list to be on any more: the header button
  // is the same on every page, because the draft CTA came off the whole site for
  // the season. What it must be is the league setup — the platform connectors
  // were removed (docs/saved-league.md) — so a rankings page cannot quietly go
  // back to selling a draft sheet in September.
  const missCta = SECTION
    .filter((f) => !/<a class="cta" href="\/my-league#settings">Customize My League<\/a>/.test(read(f)));
  ok('and its CTA is the league setup that actually works', missCta.length === 0, missCta.join(', '));
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
  const tool = read('rankings.html');
  const cutFrom = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  const H = new Function(cutFrom(reads, '  var TIERS = {', '  // THE PLAYER LINE.') +
    '\nreturn { TIERS, POS_LONG, HZ, tierOf, gradeOf, ord, awayFrom, plural, listOf };')();
  // vol() calls n1(), so it is lifted with it rather than on its own.
  const H2 = new Function(cutFrom(reads, '  function n1(v)', '  // THE TIERS.') + '\nreturn { vol };')();
  H.vol = H2.vol;
  const worker = read('_worker.js');

  // ONE COPY. The grammar lives beside the page rather than in it, so a second
  // surface (the published boards carried one until 11 Oct 2026) can never
  // grow its own tiers and call the same player "a weekly WR1" on one page
  // and "a WR2" on the other.
  ok('the tiers and the grammar live in one file', /var TIERS = \{/.test(reads));
  ok('and the tool carries no second copy of them',
    !/TIERS|function tierOf|function gradeOf/.test(tool));
  ok('the tool calls it', /ITReads\.cell\(/.test(tool));
  ok('and loads it before the script that calls it',
    tool.indexOf('/it-reads.js') < tool.indexOf('function reads(r)'));
  ok('a board without it renders the row rather than throwing',
    /if \(!window\.ITReads\) return ''/.test(tool));
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
    ['week', 'next', 'next3', 'untilPlayoffs', 'ros', 'playoffs'].every((k) => H.HZ[k] && H.HZ[k].when && H.HZ[k].slate));
  ok('and the four the /rankings row offers are four the worker knows',
    (() => { const row = read('rankings.html').match(/id="rkHorizon"[\s\S]*?<\/div>/)[0];
             const keys = [...row.matchAll(/data-horizon="(\w+)"/g)].map((m) => m[1]);
             return keys.join() === 'week,next3,playoffs,ros' && keys.every((k) => H.HZ[k]); })());
  ok('the one page sorts, and is not two pages: no weekly or rest-of-season rankings page is linked from it',
    !/href="\/(?:weekly|season-long)-[a-z-]*rankings"/.test(read('rankings.html').replace(/<!--ranks:ribbon-->[\s\S]*?<!--\/ranks:ribbon-->/, '')));

  // The function's own body, not a window of N characters after its name: a
  // window is a test that fails the next time the function grows a comment.
  const playerLine = cutFrom(reads, '  function player(p, o) {', '  // THE OPPORTUNITY LINE');
  ok('the player line is ranked and scored by the CALLER, because only it knows the board',
    playerLine.includes('o.rank') && playerLine.includes('o.points') && !playerLine.includes('p.consensus'));
  ok('and the tool feeds it whichever of four boards the reader picked',
    /f \+ 'Rank'/.test(tool) && /points: bp\(r\)/.test(tool));
  ok('it is never handed a pooled flex slot: that is spelled out instead',
    /spellOut: pos === 'FLEX'/.test(tool) &&
    /o\.spellOut && POS_LONG\[p\.position\]/.test(playerLine));
  ok('a usage swing is quoted only once three games have earned it',
    /rt && rt\.applied && rt\.pct != null/.test(reads));
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
  ok('the projection ahead of him is compared with the rate he has run at, per game on both sides',
    /var fwd = pts \/ p\.games, gap = \(fwd - ppg\) \/ ppg;/.test(reads));
  ok('and only a gap of a fifth or more is the story; a smaller one is noise',
    /Math\.abs\(gap\) >= 0\.2/.test(reads));
  ok('yards are whole numbers and touches are not',
    H.vol(281.04, 'passing yards') === '281' && H.vol(19.04, 'touches') === '19.0');

  // The worker's half: the season line was already read for the role trend and
  // thrown away, and it is shipped raw so a browser that re-scores can.
  ok('the worker ships the season line every board row is graded from',
    /function seasonFormFrom\(/.test(worker) && /const form = seasonFormFrom\(/.test(worker) &&
    /roleTrend: role, form,/.test(worker));
  ok('raw, so a page that re-scores in the browser can re-score it too',
    /stats: _roundStats\(stats\), points: pts/.test(worker) && /formPpg: formPpg\(r\.p\)/.test(tool));
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

  // THE BOARD AROUND HIM. A line that says the same thing about every
  // player says nothing, so each row leads on whatever is LEAST ordinary
  // about that player against his position. This RUNS the module on a built
  // board, because every failure here is a sentence that reads fine and is
  // wrong, or the same sentence on every row.
  {
    const win = {};
    new Function('window', reads)(win);
    const R = win.ITReads;
    const wk = (team, rank, out) => {
      const ws = [];
      for (let w = 5; w <= 17; w++) {
        if (w === 9) { ws.push({ week: w, bye: true }); continue; }
        if (out && w < 8) { ws.push({ week: w, out: true, opponent: 'X', home: true }); continue; }
        ws.push({ week: w, opponent: 'X', home: true, env: { opponentDefRank: rank(w), implied: 20 + (team.charCodeAt(1) % 10), posted: false } });
      }
      return ws;
    };
    // Forty receivers with ordinary, slightly varied lines: about 1.6 points a
    // target, 12 yards a catch, two thirds caught, one score in four games.
    const line = (tg, opt = {}) => {
      const g = 4, t = Math.round(tg * g), rec = opt.rec != null ? opt.rec : Math.round(t * 0.66);
      const recYd = opt.recYd != null ? opt.recYd : rec * 12, recTD = opt.recTD != null ? opt.recTD : 1;
      const ppg = (rec + recYd / 10 + recTD * 6) / g;
      return { games: g, ppg, volume: t / g, volumeUnit: 'targets', snapPct: opt.snap != null ? opt.snap : 0.8, stats: { rec, recYd, recTD } };
    };
    const players = [];
    for (let i = 0; i < 40; i++) {
      const team = 'T' + String.fromCharCode(65 + (i % 26));
      players.push({ key: 'w' + i, name: 'Receiver ' + i, position: 'WR', team, games: 12, byes: [9],
        weeks: wk(team, () => 16, false), scheduleDifficulty: { label: 'Average', avgOpponentDefRank: 16 },
        form: line(10 - i * 0.15, { recYd: Math.round(10 - i * 0.15) * 4 * 0.66 * (11.5 + (i % 3)) | 0, snap: 0.75 + (i % 5) * 0.03 }) });
    }
    const P = (k) => players.find((p) => p.key === k);
    P('w2').form = line(9.7, { recTD: 7 });                              // touchdown-fed
    P('w5').form = line(9.2, { recYd: 24 * 21 });                        // a downfield role
    P('w30').form = line(5.5, { snap: 0.45 });                           // part-time
    P('w12').form = line(8.2, { rec: 15 });                              // drops his targets
    P('w0').weeks = wk(P('w0').team, (w) => (w < 10 ? 28 : 8), false);  // easy now, hard later
    P('w26').weeks = wk(P('w26').team, () => 16, true);                 // out, same club as w0
    const ctx = R.context(players);
    const pl = (k, pts) => R.player(P(k), { horizon: 'ros', rank: 9, points: pts != null ? pts : P(k).form.ppg * 12, ctx });
    const opp = (k) => R.opportunity(P(k), { horizon: 'ros', ctx });

    ok('the context is built once from the board and exported', typeof R.context === 'function' && ctx.pos.WR.pool >= 8);
    ok('points a game is not the lead any more', !/points a game so far/.test(pl('w20')) && !/points a game/.test(pl('w5')), pl('w20'));
    ok('a touchdown-fed line is called what it is, with his own count and the norm',
      /7 touchdowns in 4 games make up \d+% of his points \(typical starter: \d+%\)/.test(pl('w2')), pl('w2'));
    ok('a downfield role is read off his yards a catch', /21\.0 yards a catch, 1st among receivers/.test(pl('w5')), pl('w5'));
    ok('a part-time role is read off his snaps', /Played only 45% of snaps last week/.test(pl('w30')), pl('w30'));
    ok('a receiver who drops his volume is told so', /Catches only \d+% of his targets \(the lowest among receivers\)/.test(pl('w12')), pl('w12'));
    ok('four unusual players get four different leads, not one template',
      new Set(['w2', 'w5', 'w30', 'w12'].map((k) => pl(k).split('. ')[1].slice(0, 12))).size === 4);
    ok('the board disagreeing sharply with his rate is the story where it is the biggest thing',
      /The board does not buy the start: it projects/.test(pl('w20', P('w20').form.ppg * 12 * 0.3)), pl('w20', P('w20').form.ppg * 12 * 0.3));
    ok('one game is said to be one game, not read', (() => {
      const p = { ...P('w2'), form: { ...P('w2').form, games: 1 } };
      return /One game played .*too little to read/.test(R.player(p, { horizon: 'ros', rank: 1, points: 150, ctx }));
    })());
    ok('the end of a ranking reads as words, not "1st-lowest"', !/1st-(lowest|most|fewest)/.test(players.map((p) => pl(p.key)).join(' ')));
    ok('the slate leads with when the easy games are', /^The easy part is now: his next four opponents average 28th/.test(opp('w0')), opp('w0'));
    ok('a teammate out at the same position leaves his work open, named with his volume',
      /Receiver 26 is out for 3 games on this board, leaving his [\d.]+ targets a game/.test(opp('w0')), opp('w0'));
    ok('a player is never his own vacancy', !/Receiver 26 is out/.test(opp('w26')));
    ok('the games left close the line rather than open it', /13 games left|12 games left/.test(opp('w0')) && !/^1\d games left/.test(opp('w0')));
    ok('an ordinary slate says so with the worker\'s own grade', /with no stretch that stands out/.test(opp('w20')) || /^His offense/.test(opp('w20')), opp('w20'));
    ok('the tool hands it the context',
      /ITReads\.context\(payload\.players, \{ ppgOf: formPpg \}\)/.test(tool));
  }

  ok('and the tool tells the reader what the two lines are', /the two lines under a name/i.test(tool));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
