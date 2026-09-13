#!/usr/bin/env node
// The front page's recap strip: /api/recaps and the payload behind it.
// The strip is additive — the hero stands alone without it — so most of what
// is worth testing here is the ways it goes QUIET: a stale slate, an empty
// desk, a database that is not there. The rest is the one rule it shares with
// the Weekly Wrap Up: one entry per game, newest version wins.
//   node tools/test-recaps.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };

const HOUR = 3600000;
// A fresh harness per case: the payload memoizes for sixty seconds, and a
// shared one would answer the second case with the first case's rows.
const mk = (opts = {}) => new Function('contentReady', 'newsroomReady', '_pieceUrl', '_pieceTitle', '_bylineOf',
  cut("// ── the front page's recap strip ─", '// The regular season with nothing published yet:')
  + '\nreturn { recapStripPayload, RECAP_STRIP_MAX, RECAP_STRIP_FRESH_MS };'
)(
  async () => opts.ready !== false,
  async () => {},
  r => '/in-season/desk/' + r.kind + '/' + r.week + '/' + String(r.game_id || '').toLowerCase(),
  r => String(r.title || r.kind),
  () => ({ name: 'Rhea Vega' })
);
// D1's prepare().bind().all() shape, narrowed to what the payload uses.
const db = rows => ({ prepare: () => ({ bind() { return this; }, all: async () => ({ results: rows }) }) });
const boom = () => ({ prepare: () => { throw new Error('D1 is having a day'); } });
const row = (game, at, extra = {}) => ({
  kind: 'game-recap', slug: 'game-recap-2026-w1-' + game.toLowerCase(), title: 'Game Recap · ' + game,
  week: 1, season: 2026, game_id: game, headline: game + ' headline', dek: game + ' dek',
  published_at: at, created_at: at, analyst: 'vega', ...extra
});

console.log('\none entry per game, newest version wins');
{
  const H = mk();
  const now = Date.now();
  // The same game recapped twice, as it is in D1 right now: a rewrite leaves
  // both versions published.
  const out = await H.recapStripPayload({ LEADS_DB: db([
    row('2026_01_NE_SEA', now - HOUR, { headline: 'the rewrite' }),
    row('2026_01_NE_SEA', now - 2 * HOUR, { headline: 'the first draft' }),
    row('2026_01_SF_LA', now - 3 * HOUR)
  ]) });
  ok('two games, not three rows', out.ok && out.recaps.length === 2, JSON.stringify(out.recaps.map(r => r.game)));
  ok('the newest version of the rewritten game is the one kept', out.recaps[0].title === 'the rewrite');
  ok('order is newest first', out.recaps[0].game === '2026_01_NE_SEA' && out.recaps[1].game === '2026_01_SF_LA');
  ok('each entry carries the URL the desk already serves it at',
    out.recaps[0].url === '/in-season/desk/game-recap/1/2026_01_ne_sea', out.recaps[0].url);
  ok('the dek travels with it, for the wide-screen half of the strip', out.recaps[0].dek === '2026_01_NE_SEA dek');
  ok('nothing is flagged as a reason to hide', out.reason === null);
}

console.log('\nSunday afternoon: eight games final inside twenty minutes');
{
  const H = mk();
  const now = Date.now();
  const games = ['NE_SEA', 'SF_LA', 'DAL_PHI', 'BUF_MIA', 'KC_DEN', 'GB_CHI', 'NYJ_NYG', 'BAL_CIN'];
  const out = await H.recapStripPayload({ LEADS_DB: db(games.map((g, n) => row('2026_01_' + g, now - n * 60000))) });
  ok('the strip caps at six', out.recaps.length === H.RECAP_STRIP_MAX, String(out.recaps.length));
  ok('it keeps the six NEWEST, not the six oldest', out.recaps[0].game === '2026_01_NE_SEA' && out.recaps[5].game === '2026_01_GB_CHI');
}

console.log('\nthe ways it goes quiet');
{
  const now = Date.now();
  const stale = await mk().recapStripPayload({ LEADS_DB: db([row('2026_01_NE_SEA', now - 37 * HOUR)]) });
  ok('a recap over 36 hours old is not shown', stale.ok && stale.recaps.length === 0);
  ok('and the payload says why', /36h/.test(stale.reason || ''), stale.reason);

  // Judged on the newest row, not per row: once a slate is current the whole
  // slate is, or a Sunday-early game would drop out of Monday's strip while
  // the night game stayed.
  const mixed = await mk().recapStripPayload({ LEADS_DB: db([
    row('2026_01_SNF', now - 2 * HOUR), row('2026_01_EARLY', now - 40 * HOUR)
  ]) });
  ok('a fresh slate carries its own older games with it', mixed.recaps.length === 2);

  const edge = await mk().recapStripPayload({ LEADS_DB: db([row('2026_01_NE_SEA', now - 35.9 * HOUR)]) });
  ok('35.9 hours is still inside the window', edge.recaps.length === 1);

  const none = await mk().recapStripPayload({ LEADS_DB: db([]) });
  ok('no published recap is ok, not an error', none.ok === true && none.recaps.length === 0);
  ok('and that reason is stated separately from staleness', none.reason === 'no published recaps');

  const broke = await mk().recapStripPayload({ LEADS_DB: boom() });
  ok('a D1 throw is caught and reports no recaps', broke.ok === false && broke.recaps.length === 0 && broke.error === 'unavailable');

  const off = await mk({ ready: false }).recapStripPayload({});
  ok('no content tables at all is handled without throwing', off.ok === false && off.recaps.length === 0);
}

console.log('\nthe route');
{
  const route = cut("if (url.pathname === '/api/recaps') {", "if (url.pathname === '/api/analysts'");
  ok('/api/recaps is served', route.includes('recapStripPayload(env)'));
  ok('it caches for sixty seconds, not the newsroom feed’s two minutes', /max-age=60\b/.test(route));
  // 200-with-nothing, never 503: an empty strip is a normal Wednesday, and a
  // front page that logged an error every Wednesday would train Ken to ignore
  // the log by the time a real outage happened.
  ok('an empty strip still answers 200', /json\(out, 200,/.test(route));
  ok('it is a GET', /method !== 'GET'/.test(route));
}

console.log('\nthe front page holds up its half');
{
  const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
  ok('the strip ships hidden, so a page that never fetches is the page as it was',
    /<section class="rcp" id="recapStrip" hidden/.test(front));
  ok('it sits above the brand line, which is untouched beneath it',
    front.indexOf('id="recapStrip"') < front.indexOf('<div class="dominant"'));
  ok('it is only ever revealed after a recap is painted',
    /paint\(\);\s*\r?\n\s*strip\.hidden = false;/.test(front));
  ok('the count reads "N of M"', /\(i \+ 1\) \+ ' of ' \+ items\.length/.test(front));
  ok('rotation is roughly eight seconds', /var HOLD = 8000;/.test(front));
  ok('the arrows stop the rotation rather than fighting the reader',
    /function step\(n\) \{ held = true; stop\(\);/.test(front));
  ok('one recap drops the counter and the arrows', /\.rcp\[data-single\] \.rcp-nav\{display:none\}/.test(front));
  ok('the dek is the part that goes on a narrow screen', /@media \(max-width: 860px\) \{ \.rcp-dek\{display:none\} \}/.test(front));
  // Basis 0. With `auto` the dek claims its content width first and the
  // headline loses half the strip to it at any real headline length.
  ok('the headline takes the width it needs and the dek clips first', /\.rcp-dek\{flex:1 1 0;/.test(front));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
