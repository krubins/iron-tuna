// The homepage's examples and sample My Week (docs/growth-plan.md, Phase 3,
// 17 Oct 2026).
//
// The worker writes up to three current market-versus-consensus examples into
// "/", one list per scoring preset, and a labelled sample My Week. This pins:
//   - each suppression rule in homeExamples, one fixture player per rule
//     (tools/fixtures/home-board.mjs), across all three presets;
//   - the numbers are the rankings page's own: both sides scored from their
//     stat lines at the card's preset, by it-league.js's engine;
//   - every card names the player, the fixture, the week and scoring, the gap,
//     both projections, a derived-estimate label on the market points and a
//     quoted-prop label on the line a book quoted, with when it was seen;
//   - the sample's two players do not change with the scoring, and the shell
//     fill writes only what exists.
// Node only; tools/test-homepage.mjs drives the filled page in a browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { homeBoard, homeMarkets, SEEN, UPDATED } from './fixtures/home-board.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? ' — ' + x : ''}`); } };
const lift = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };

const ENGINE = src.slice(src.indexOf('// ── the scoring engine ─'), src.indexOf('const COLUMN_SCORING = {'));
const HOME = src.slice(src.indexOf('const HOME_EX_MAX = 3;'), src.indexOf('function homeShellFill(html, hp) {'));
const H = new Function([ENGINE, lift('const _oddsNorm = ', ';\n'), lift('const _preEsc = ', ';\n'), lift('function _etStamp(ms) {', '\n}'),
  HOME, lift('function homeShellFill(html, hp) {', '\n}')].join('\n')
  + '\nreturn { homeExamples, homeSamplePair, homeSample, homeExampleHtml, homePrerender, homeShellFill, _oddsNorm, _etStamp };')();

const B = homeBoard(), M = homeMarkets(H._oddsNorm);
const names = (xs) => xs.map(x => x.name).join(', ');
const ex = { ppr: H.homeExamples(B, M, 'ppr'), half: H.homeExamples(B, M, 'half'), standard: H.homeExamples(B, M, 'standard') };

// ── which players ───────────────────────────────────────────────────────────
console.log('\nwhich players are examples');
ok('PPR: the three widest qualifying gaps, widest first', names(ex.ppr) === 'Drake London, Derrick Henry, Goal Line Back', names(ex.ppr));
ok('with the gap in points, signed', ex.ppr.map(x => x.gap).join(' ') === '5 -4.8 3.8', ex.ppr.map(x => x.gap).join(' '));
ok('never more than three: a fourth that qualifies (Cam Ward) is left off', !ex.ppr.some(x => x.name === 'Cam Ward') && H.homeExamples({ ...B, players: B.players.filter(p => p.name !== 'Drake London') }, M, 'ppr').some(x => x.name === 'Cam Ward'));
ok('Half PPR re-scores and re-orders', names(ex.half) === 'Derrick Henry, Drake London, Goal Line Back' && ex.half[1].gap === 4, names(ex.half) + ' ' + ex.half.map(x => x.gap).join(' '));
ok('Standard admits a disagreement PPR does not have (Yards Guy)', names(ex.standard) === 'Derrick Henry, Goal Line Back, Yards Guy', names(ex.standard));
ok('and PPR leaves it out: at PPR his lost catches cancel the yards', !ex.ppr.some(x => x.name === 'Yards Guy'));
const RULED = {
  'Questionable Runner': 'an injury designation other than Active or Probable', 'Priced Out Wideout': 'the books leaving him off a priced game',
  'Partly Priced': 'a partial market projection', 'Missing Market': 'a missing market', 'Game Lines Only': 'a market side off the game lines',
  'One Book': 'one book', 'Promoted Backup': 'a consensus under the floor (a stale backup line)', 'Kicked Off': 'a game that has kicked off',
  'Bye Week': 'a bye', 'Listed Out': 'a listed absence', 'Small Gap': 'a gap under 2 points', 'Deep Bench': 'a player far from the start line on both sides',
  'No Quoted Line': 'no quoted line to explain the gap', 'Kicker Guy': 'a kicker'
};
const all = [...ex.ppr, ...ex.half, ...ex.standard].map(x => x.name);
for (const [n, why] of Object.entries(RULED)) ok(`not an example at any scoring: ${why}`, !all.includes(n));
// Each of those really would lead without its rule: put one back to health
// and it heads the list. (Proves the rule, not the fixture, keeps it out.)
{
  const healed = { ...B, players: B.players.map(p => p.name === 'Questionable Runner' ? { ...p, injury: null } : p) };
  ok('and the rule is what keeps them out: healed, the Questionable Runner leads', H.homeExamples(healed, M, 'ppr')[0].name === 'Questionable Runner');
  const priced = { ...B, players: B.players.map(p => p.name === 'Game Lines Only' ? { ...p, vegas: { ...p.vegas, basis: 'props' } } : p) };
  ok('priced off props, Game Lines Only leads', H.homeExamples(priced, M, 'ppr')[0].name === 'Game Lines Only');
  ok('an Active designation is not an injury', H.homeExamples({ ...B, players: B.players.map(p => p.name === 'Questionable Runner' ? { ...p, injury: { status: 'Active' } } : p) }, M, 'ppr')[0].name === 'Questionable Runner');
}
ok('no week board, no examples: another horizon', H.homeExamples({ ...B, horizon: { key: 'ros', weeks: [6, 7] } }, M, 'ppr') === null);
ok('and a failed board', H.homeExamples({ ok: false }, M, 'ppr') === null);
ok('no quoted lines at all, no examples (not invented ones)', H.homeExamples(B, {}, 'ppr').length === 0);

// ── the numbers are the rankings page's ────────────────────────────────────
console.log('\nthe numbers are the ones /rankings prints at the same scoring');
{
  const box = { window: {}, localStorage: { getItem() { return null; }, setItem() {} }, document: { addEventListener() {}, cookie: '' } };
  box.window.localStorage = box.localStorage;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'it-league.js'), 'utf8'), box);
  const L = box.window.ITLeague;
  // rankings.html's rules(): the defaults with the reception fields set.
  const rules = (preset) => { const r = { ...L.defaults.scoring }, rec = preset === 'standard' ? 0 : preset === 'half' ? 0.5 : 1; r.receptionPoints = rec; r.rbReceptionPoints = rec; return r; };
  const byName = Object.fromEntries(B.players.map(p => [p.name, p]));
  let same = 0, n = 0;
  for (const preset of ['ppr', 'half', 'standard']) for (const x of ex[preset]) {
    const p = byName[x.name], r1 = v => Math.round(v * 10) / 10;
    n += 2;
    if (r1(L.score(p.consensus.stats, p.position, rules(preset), 1)) === x.consensus) same++;
    if (r1(L.score(p.vegas.stats, p.position, rules(preset), 1)) === x.market) same++;
  }
  ok('every consensus and market figure matches it-league.js at the card\'s preset', same === n && n > 0, `${same}/${n}`);
}

// ── why: the quoted line ───────────────────────────────────────────────────
console.log('\nthe explanation is a line a book quoted');
{
  const [lon, hen, gl] = ex.ppr;
  ok('a receiver\'s gap is his receiving yards: the quoted line against the consensus', lon.why.kind === 'line' && lon.why.label === 'receiving yards' && lon.why.line === 89.5 && lon.why.cons === 60, JSON.stringify(lon.why));
  ok('a back fading on yardage cites the rushing line, not the touchdown', hen.why.label === 'rushing yards' && hen.why.line === 59.5 && hen.why.cons === 90, JSON.stringify(hen.why));
  ok('a gap carried by touchdowns cites the anytime price, with the consensus as a probability beside it',
     gl.why.kind === 'td' && gl.why.prob === 55.2 && gl.why.consTds === 0.3 && gl.why.consProb === 26, JSON.stringify(gl.why));
  ok('each carries when the line was last seen and how many books', [lon, hen, gl].every(x => x.why.lastSeen === SEEN && x.why.books >= 4));
}

// ── the card ───────────────────────────────────────────────────────────────
console.log('\nthe card');
{
  const h = H.homeExampleHtml(ex.ppr[0], 6, 'ppr');
  ok('the player links to his page and is marked as the examples surface', h.includes('<a href="/player/drake-london" data-it-surface="home_examples"><b>Drake London</b></a>'), h);
  ok('position, club, fixture and kickoff', h.includes('WR ATL vs CAR &middot; ' + H._etStamp(Date.UTC(2026, 9, 18, 17, 0))), h);
  ok('the gap, green when the market is higher', h.includes('<p class="hm-ex-gap good">+5.0 pts</p>'), h);
  ok('both projections, then the week and scoring they are for', h.includes('Market <b>16.0</b> &middot; consensus <b>11.0</b>') && h.includes('Week 6, PPR'), h);
  ok('the market points are labelled a derived estimate', /<span class="hm-tag">Derived estimate<\/span> Market points converted from 6 books/.test(h), h);
  ok('the sentence under them is labelled the quoted prop', h.includes('<span class="hm-tag q">Quoted prop</span> Books quote 89.5 receiving yards; the consensus projects 60.') && h.includes('Line last seen ' + H._etStamp(SEEN) + '.'), h);
  const f = H.homeExampleHtml(ex.ppr[1], 6, 'ppr');
  ok('a fade is ink with a real minus sign, not green', f.includes('<p class="hm-ex-gap">−4.8 pts</p>'), f);
  const t = H.homeExampleHtml(ex.ppr[2], 6, 'ppr');
  ok('the touchdown sentence', t.includes('Books price an anytime touchdown at 55.2%; the consensus projects 0.3 touchdowns, about 26%.'), t);
  const evil = H.homeExampleHtml({ ...ex.ppr[0], name: '<img src=x onerror=alert(1)>' }, 6, 'ppr');
  ok('a name is escaped', !evil.includes('<img') && evil.includes('&lt;img'), evil);
  ok('no em dash in the copy', !/—/.test(h + f + t));
}

// ── the sample My Week ─────────────────────────────────────────────────────
console.log('\nthe sample My Week');
{
  const pair = H.homeSamplePair(B);
  ok('FLEX 30 against the first player from FLEX 34 down who projects less (Fillers 30 to 33 tie Filler 29 and are passed)',
     pair && pair[0].name === 'Flex Filler 29' && pair[1].name === 'Flex Filler 34', pair && pair.map(p => p.name).join(' / '));
  const s = { ppr: H.homeSample(pair, 'ppr', ex.ppr), standard: H.homeSample(pair, 'standard', ex.standard) };
  ok('the same two players at every scoring', s.ppr.start.name === s.standard.start.name && s.ppr.sit.name === s.standard.sit.name);
  ok('the starter projects more', s.ppr.start.pts === 24.2 && s.ppr.sit.pts === 23.2, JSON.stringify(s.ppr));
  ok('the alert is the widest example at that scoring', s.ppr.alert.name === 'Drake London' && s.standard.alert.name === 'Derrick Henry');
  const lvl = H.homeSample([pair[0], { ...pair[1], ironTuna: pair[0].ironTuna }], 'ppr', []);
  ok('two level players are called level, not "start one over his equal"', lvl.level === true && lvl.alert === null);
  ok('fewer than 34 healthy flex players: no sample', H.homeSamplePair({ ...B, players: B.players.slice(0, 40) }) === null);
}

// ── the whole pre-render and the shell ─────────────────────────────────────
console.log('\nthe pre-render and the shell');
{
  const hp = H.homePrerender(B, M);
  ok('one list per preset, PPR showing and the other two hidden',
     /<ol class="hm-ex-list" data-scoring="ppr">/.test(hp.ex) && /<ol class="hm-ex-list" data-scoring="half" hidden>/.test(hp.ex) && /<ol class="hm-ex-list" data-scoring="standard" hidden>/.test(hp.ex));
  ok('three cards in each', hp.counts.ppr === 3 && hp.counts.half === 3 && hp.counts.standard === 3, JSON.stringify(hp.counts));
  ok('one sample per preset, PPR showing', /<div class="hm-mw-set" data-scoring="ppr">/.test(hp.sample) && /data-scoring="standard" hidden/.test(hp.sample));
  ok('the sample prints no pickup it cannot know', /Shown once your league&rsquo;s rosters are saved/.test(hp.sample) && !/ADD /.test(hp.sample));
  ok('the as-of line: week, when the board was computed, when the odds were read',
     hp.asOf === 'Week 6 &middot; board computed ' + H._etStamp(UPDATED.board) + ' &middot; market points priced off odds read ' + H._etStamp(UPDATED.odds) + '.', hp.asOf);
  ok('with no odds read, the line says nothing about odds rather than inventing a time', !/odds/.test(H.homePrerender({ ...B, updated: { board: UPDATED.board, odds: null } }, M).asOf));
  const onlyStd = H.homePrerender({ ...B, players: B.players.filter(p => !['Drake London', 'Derrick Henry', 'Goal Line Back', 'Cam Ward'].includes(p.name)) }, M);
  ok('a preset with nothing gets that sentence and a link to the board',
     onlyStd.counts.ppr === 0 && /data-scoring="ppr">\s*<li class="hm-ex-none">No player clears the bar at PPR right now\. See the <a href="\/vegas-edge#board">whole board<\/a>\.<\/li>/.test(onlyStd.ex), onlyStd.ex.slice(0, 300));
  ok('nothing at any preset: no pre-render at all, so the block stays hidden', H.homePrerender(B, {}) === null);
  ok('another horizon or a failed board: none', H.homePrerender({ ...B, horizon: { key: 'next3', weeks: [6, 7, 8] } }, M) === null && H.homePrerender(null, M) === null);

  const shell = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
  const filled = H.homeShellFill(shell, hp);
  ok('the shell carries the hosts the worker fills, hidden', shell.includes('<div class="hm-examples" id="hmExamples" hidden>') && shell.includes('<section class="hm-sec" id="sample" hidden aria-labelledby="sampleHead">'));
  ok('filled: the examples are shown, with all three lists and the as-of line',
     filled.includes('<div class="hm-examples" id="hmExamples">') && (filled.match(/class="hm-ex-list"/g) || []).length === 3 && filled.includes('<p class="hm-fine" id="hmExAsOf">Week 6 &middot;'));
  ok('and the sample section shown with its sets', filled.includes('<section class="hm-sec" id="sample" aria-labelledby="sampleHead">') && (filled.match(/class="hm-mw-set"/g) || []).length === 3);
  const noSample = H.homeShellFill(shell, { ...hp, sample: '' });
  ok('no sample: the section stays hidden and empty', noSample.includes('id="sample" hidden') && noSample.includes('<div class="hm-mw-sets" id="hmMwSets"></div>'));
  ok('no pre-render: the shell is served as it is', H.homeShellFill(shell, null) === shell);
  ok('a page without the hosts is left alone', H.homeShellFill('<p>other</p>', hp) === '<p>other</p>');
  ok('a $ in the data is written literally, not read as a replacement pattern', H.homeShellFill(shell, { ...hp, asOf: "$& $' $1" }).includes("<p class=\"hm-fine\" id=\"hmExAsOf\">$& $' $1</p>"));
}

// ── the route ──────────────────────────────────────────────────────────────
console.log('\nthe route');
{
  const at = src.indexOf("if (__seoKey === '/' && !IS_WASHINGTON(request))");
  const block = src.slice(at, src.indexOf('return secure(__r);', at));
  ok('"/" is filled outside Washington only', at > 0);
  ok('off the week board still to play, at PPR, the one /rankings pre-renders from',
     block.includes("boardStillToPlay(await boardsPayload(env, { horizon: 'week', position: 'ALL', preset: 'ppr', through: null }))"));
  ok('with the week\'s quoted lines from the market digest', block.includes('marketHistoryWeek(env, __b.season, __wk)'));
  ok('a failure serves the plain shell', /catch \(e\) \{ __hp = null; \}/.test(block) && block.includes('homeShellFill(await resp.text(), __hp)'));
  ok('and the page is never cached', block.includes("'no-cache, no-store, must-revalidate'"));
  ok('the homepage no longer reads /api/vegas-edge in the browser', !fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8').includes('/api/vegas-edge'));
}

// ── the real worker, end to end, with no data behind it ───────────────────
console.log('\nthe real worker with no board');
{
  const worker = (await import(path.join(ROOT, '_worker.js'))).default;
  const ASSETS = { fetch: async (req) => {
    const p = new URL(req.url).pathname.replace(/^\//, '') || 'front';
    const fp = path.join(ROOT, p + (p.endsWith('.html') ? '' : '.html'));
    return fs.existsSync(fp) ? new Response(fs.readFileSync(fp), { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('nf', { status: 404 });
  } };
  const res = await worker.fetch(new Request('https://irontuna.com/', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126' } }), { ASSETS, POST_DRAFT_OPEN: '1' }, { waitUntil() {} });
  const html = await res.text();
  ok('"/" still answers 200', res.status === 200);
  ok('with the examples hidden and empty, never an invented one', html.includes('<div class="hm-examples" id="hmExamples" hidden>') && html.includes('<div class="hm-ex-sets" id="hmExSets"></div>'));
  ok('and the sample hidden', html.includes('<section class="hm-sec" id="sample" hidden aria-labelledby="sampleHead">'));
  ok('the primary action is in the HTML regardless', html.includes('<a class="hm-primary" href="/vegas-edge#board" data-it-surface="home_primary">'));
  ok('and the page stays out of shared caches', /no-store/.test(res.headers.get('cache-control') || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
