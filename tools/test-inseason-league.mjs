#!/usr/bin/env node
// Tests for the in-season league: the record (/it-inseason.js) and the intake
// that fills it (/it-inseason-import.js).
//   node tools/test-inseason-league.mjs
//
// THE FAILURE THIS GUARDS AGAINST IS A LEAGUE READ WRONG AND SAVED ANYWAY.
// The in-season settings form used to offer three scoring presets, so the worst
// it could do was be approximately wrong in a way the reader could see. It now
// takes a whole league off a screenshot, a paste or the draft app, which is a
// much better answer and a much quieter failure: nobody proof-reads twenty
// scoring fields, and a board that re-scores itself at the wrong ones looks
// exactly like a board that is right.
//
// So three things are pinned here.
//
// 1. THE VOCABULARY. it-inseason.js carries hand-synced copies of the scoring
//    field names (_worker.js SCORING_BASE, it-league.js SCORING_DEFAULTS) and of
//    the roster slots (_worker.js leagueEmptyRoster). A field or a slot that
//    exists in one copy and not another is a rule the reader set and no board
//    ever honors — silent, and invisible in review.
//
// 2. THE PARSER. parseScoring() here is a port of parseScoringText() in
//    index.html. Both are lifted and run over the same fixtures; they must agree
//    field for field, or the cheat sheet and the in-season form have quietly
//    become two different readings of one screenshot.
//
// 3. THE READING ITSELF, over the shapes platforms actually print — and over the
//    scoring lines that look like lineup lines, which is where a lineup parser
//    goes wrong ("Receiving TD 6" is not six receivers).

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const recordSrc = read('it-inseason.js');
const importSrc = read('it-inseason-import.js');
const uiSrc = read('it-inseason-ui.js');
const leagueSrc = read('it-league.js');
const client = read('index.html');
const worker = read('_worker.js');

// ── a browser, in as much as this file needs one ───────────────────────────
function load(store = {}, leagueStub = null) {
  const w = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    addEventListener() {},
    document: { createElement: () => ({}), head: { appendChild() {} } }
  };
  if (leagueStub) w.ITLeague = leagueStub;
  new Function('window', recordSrc)(w);
  new Function('window', importSrc)(w);
  return { L: w.ITInSeason, IMP: w.ITInSeasonImport, store, w };
}

// ── 1. the hand-synced vocabulary ──────────────────────────────────────────
console.log('\nthe vocabulary is one vocabulary');
{
  const { L } = load();

  // it-league.js and _worker.js both declare the scoring fields; every numeric
  // one of them has to exist here with the same default, or an imported field
  // lands somewhere nothing reads.
  const lift = (src, decl) => {
    const s = src.indexOf(decl);
    const body = src.slice(s + decl.length, src.indexOf('};', s) + 1);
    return new Function('return {' + body)();
  };
  const leagueDefaults = lift(leagueSrc, 'var SCORING_DEFAULTS = {');
  const workerBase = lift(worker, 'const SCORING_BASE = {');

  const mine = L.SCORING_DEFAULTS;
  const missing = Object.keys(leagueDefaults).filter(k => !(k in mine));
  ok('every it-league.js scoring field is known here', missing.length === 0, missing.join(', '));
  const wrong = Object.keys(leagueDefaults).filter(k => mine[k] !== leagueDefaults[k]);
  ok('and carries the same default', wrong.length === 0,
    wrong.map(k => `${k}: ${mine[k]} vs ${leagueDefaults[k]}`).join('; '));
  const workerNums = Object.keys(workerBase).filter(k => typeof workerBase[k] === 'number');
  const offWorker = workerNums.filter(k => mine[k] !== workerBase[k]);
  ok('and the same default as the worker\'s SCORING_BASE', offWorker.length === 0,
    offWorker.map(k => `${k}: ${mine[k]} vs ${workerBase[k]}`).join('; '));
  const bonusesMissed = L.SCORING_BONUSES.filter(b => !(b in workerBase));
  ok('the bonus ladders the worker models are the ones kept here', bonusesMissed.length === 0, bonusesMissed.join(', '));

  // The slots. leagueEmptyRoster() is the server's list; `other` is its bucket
  // for slots no lineup understands and is not a slot.
  const ers = worker.indexOf('function leagueEmptyRoster()');
  const emptyRoster = new Function('return ' + worker.slice(worker.indexOf('{', worker.indexOf('return', ers)), worker.indexOf(';', ers)))();
  const serverSlots = Object.keys(emptyRoster).filter(k => k !== 'other');
  ok('the roster slots are the server\'s roster slots', eq(serverSlots.slice().sort(), L.SLOTS.slice().sort()),
    `server ${serverSlots.join(',')} vs record ${L.SLOTS.join(',')}`);
  ok('every slot has a label', L.SLOTS.every(s => !!L.SLOT_LABEL[s]));
  ok('the default lineup is a lineup, not an empty roster', L.rosterSum(L.defaultRoster()) === 15);
}

// ── 2. the parser has not drifted from the app's ───────────────────────────
console.log('\nthe scoring parser still agrees with index.html');
{
  const { IMP } = load();
  const s0 = client.indexOf('function parseScoringText(text) {');
  const e0 = client.indexOf('async function fetchSleeperLeague', s0);
  if (s0 < 0 || e0 < 0) {
    fail++; console.log('  FAIL could not locate parseScoringText in index.html');
  } else {
    const appParse = new Function(client.slice(s0, e0) + '; return parseScoringText;')();
    const FIXTURES = [
      'Passing TD: 4\nInterception: -2\nRushing TD: 6\nReception: 0.5\nReceiving TD: 6',
      'Passing Yards 1 point per 25 yards\nPassing Touchdowns 6\nRushing Yards 1 pt / 10 yds\nReceptions 1',
      'Half-PPR, 12 teams\nPass TD 4\nFumble lost -2\nSack 1\nDEF interception 2\nSafety 2',
      'RB reception 0.5\nReception 1\nReceiving yards 0.1 points per yard\nExtra point 1',
      'Standard scoring\nInterceptions thrown -2\nDefensive TD 6\nKickoff return TD 6',
      // The tight-end premium line, which reads as a league-wide reception
      // value unless both parsers are told otherwise.
      'Reception: 1\nTE reception bonus: 0.5\nPassing TD: 4',
      'nothing here looks like a scoring rule at all'
    ];
    let same = 0;
    for (const fx of FIXTURES) {
      const a = appParse(fx), b = IMP.parseScoring(fx);
      if (eq(a.scoring, b.scoring) && eq(a.items, b.items)) same++;
      else console.log(`       drift on: ${JSON.stringify(fx.slice(0, 40))}\n         app ${JSON.stringify(a.scoring)}\n         ours ${JSON.stringify(b.scoring)}`);
    }
    ok(`all ${FIXTURES.length} fixtures read identically in both`, same === FIXTURES.length, `${same}/${FIXTURES.length}`);
  }
}

// ── 3. reading a league out of a paste ─────────────────────────────────────
console.log('\nthe lineup, off the two shapes platforms print');
{
  const { IMP } = load();

  const slotList = 'Roster: QB, RB, RB, WR, WR, WR, TE, FLEX, K, DEF, BN, BN, BN, BN, BN, BN';
  const r1 = IMP.parseRoster(slotList);
  ok('a slot list reads as a lineup', !!r1 && r1.QB === 1 && r1.RB === 2 && r1.WR === 3 && r1.TE === 1 && r1.FLEX === 1 && r1.BN === 6,
    JSON.stringify(r1));

  const counts = 'QB 1\nRB 2\nWR 2\nTE 1\nW/R/T 1\nK 1\nDEF 1\nBench 6\nIR 1';
  const r2 = IMP.parseRoster(counts);
  ok('a count list reads as the same kind of lineup',
    !!r2 && r2.QB === 1 && r2.RB === 2 && r2.WR === 2 && r2.FLEX === 1 && r2.BN === 6 && r2.IR === 1, JSON.stringify(r2));

  const sflex = 'QB, RB, RB, WR, WR, TE, FLEX, SUPER_FLEX, K, DEF, BN, BN, BN, BN, BN';
  const r3 = IMP.parseRoster(sflex);
  ok('a superflex slot is not just another flex', !!r3 && r3.SFLEX === 1 && r3.FLEX === 1, JSON.stringify(r3));

  const slash = 'QB / RB / RB / WR / WR / TE / W/R/T / K / DEF / BN / BN / BN / BN / BN / BN';
  const r4 = IMP.parseRoster(slash);
  ok('W/R/T is one flex, not a WR, an RB and a TE',
    !!r4 && r4.FLEX === 1 && r4.WR === 2 && r4.RB === 2 && r4.TE === 1, JSON.stringify(r4));

  // The trap. Every line here holds a position word and a number.
  const scoringOnly = 'Passing TD 4\nRushing TD 6\nReceiving TD 6\nReception 1\nRB reception 1\nTE reception 1\nDEF interception 2\nK extra point 1';
  ok('a scoring page is not read as a lineup', IMP.parseRoster(scoringOnly) === null,
    JSON.stringify(IMP.parseRoster(scoringOnly)));
  ok('and a sentence about running backs is not either',
    IMP.parseRoster('Start two running backs in this league if you can, or a WR in the flex.') === null);

  // The whole paste, end to end.
  const whole = [
    '12-team league, Half-PPR',
    'Passing Yards: 1 point per 25 yards',
    'Passing TD: 6',
    'Interception: -2',
    'Reception: 0.5',
    'TE reception bonus: 0.5',
    'FAAB budget: $200',
    'Starting lineup: QB, RB, RB, WR, WR, TE, FLEX, K, DEF, BN, BN, BN, BN, BN, BN'
  ].join('\n');
  const p = IMP.parseText(whole);
  ok('a real settings paste gives scoring, lineup, teams and budget at once',
    p.scoring.passingTD === 6 && p.scoring.receptionPoints === 0.5 && p.scoring.passingYardsPerPoint === 25 &&
    p.extras.tePremium === 0.5 && p.teams === 12 && p.faab === 200 && p.roster.FLEX === 1 && p.roster.BN === 6,
    JSON.stringify({ sc: p.scoring, ex: p.extras, teams: p.teams, faab: p.faab, roster: p.roster }));
  ok('and says so in the preview the reader confirms', p.items.length >= 6, JSON.stringify(p.items));
  ok('a tight-end bonus line is not a second tight end in the lineup', p.roster.TE === 1, JSON.stringify(p.roster));
  ok('nor the league-wide reception value', p.scoring.receptionPoints === 0.5, String(p.scoring.receptionPoints));

  // The two ways a platform words a tight-end premium mean different numbers:
  // a BONUS is the premium itself, a per-catch TOTAL is the premium plus what
  // everyone else gets. Read the second as the first and a 1.5-PPR tight end
  // becomes a 2.5-PPR one.
  const te = (t) => { const r = IMP.parseText(t); return [r.extras ? r.extras.tePremium : null, r.scoring ? r.scoring.receptionPoints : null]; };
  ok('"TE reception bonus 0.5" is a 0.5 premium', eq(te('TE reception bonus: 0.5'), [0.5, undefined]), JSON.stringify(te('TE reception bonus: 0.5')));
  ok('"TEs get 1.5 per catch" in a PPR league is the same 0.5 premium',
    eq(te('Full PPR\nTEs get 1.5 per catch'), [0.5, 1]), JSON.stringify(te('Full PPR\nTEs get 1.5 per catch')));
  ok('and neither one moves the league-wide reception value',
    te('Half-PPR\nTight end reception: 1.0')[1] === 0.5, JSON.stringify(te('Half-PPR\nTight end reception: 1.0')));
  ok('a tight end who only scores a touchdown has no premium', te('Reception 1\nTE touchdown 6')[0] === null);
  // "Interception" contains "te". The guard is word-bounded for this reason.
  ok('the guard does not swallow every line with a t and an e in it',
    IMP.parseText('Reception: 0.5\nInterception: -2').scoring.passingInt === -2);

  // One slot per line is how most platforms actually print it.
  const perLine = 'Roster positions\nQB\nRB\nRB\nWR\nWR\nTE\nFLEX\nK\nDEF\nBN\nBN\nBN\nBN\nBN\nBN';
  const r5 = IMP.parseRoster(perLine);
  ok('a lineup printed one slot per line reads too',
    !!r5 && r5.QB === 1 && r5.RB === 2 && r5.WR === 2 && r5.FLEX === 1 && r5.BN === 6, JSON.stringify(r5));
}

// ── 3b. one question at a time ─────────────────────────────────────────────
// /my-league §02 asks three separate questions in three separate boxes, and the
// failure that costs the most is the quiet one: a box labelled FAAB that
// accepts a scoring screenshot and rewrites a lineup out of it. parseFor()
// exists so a box can only ever answer its own question, and an empty answer is
// an answer.
console.log('\nthe three boxes each read their own domain');
{
  const { IMP } = load();
  const WHOLE = [
    'Passing TD: 4',
    'Interception: -2',
    'Reception: 0.5',
    'QB 1 / RB 2 / WR 3 / TE 1 / FLEX 1 / K 1 / DEF 1 / BN 6',
    'FAAB budget: $250',
    '12 team league'
  ].join('\n');

  const sc = IMP.parseFor(WHOLE, 'scoring');
  ok('the scoring box reads the scoring', sc.scoring && sc.scoring.passingTD === 4 && sc.scoring.receptionPoints === 0.5);
  ok('and does not touch the lineup or the budget', !sc.roster && sc.faab === undefined && sc.teams === undefined);

  const ro = IMP.parseFor(WHOLE, 'roster');
  ok('the roster box reads the lineup', !!ro.roster && ro.roster.WR === 3 && ro.roster.BN === 6);
  ok('and does not touch the scoring or the budget', !ro.scoring && ro.faab === undefined);
  ok('and shows it a slot at a time, so a wrong read is checkable',
    ro.items.some(i => i[0] === 'WR' && i[1] === 3) && ro.items.some(i => i[0] === 'Bench' && i[1] === 6));

  const fa = IMP.parseFor(WHOLE, 'faab');
  ok('the FAAB box reads the budget and the teams bidding into it', fa.faab === 250 && fa.teams === 12);
  ok('and does not touch the scoring or the lineup', !fa.scoring && !fa.roster);

  // The wrong screenshot in the right box: nothing, rather than something.
  const only = 'Passing TD: 6\nReception: 1';
  ok('a scoring screenshot in the FAAB box finds nothing at all',
    IMP.parseFor(only, 'faab').items.length === 0);
  ok('and in the roster box finds nothing at all',
    IMP.parseFor(only, 'roster').items.length === 0);
  ok('a partial that found nothing is still a partial', eq(IMP.parseFor('', 'scoring').items, []));

  ok('the three scopes are the three the UI names', eq(IMP.SCOPES, ['scoring', 'roster', 'faab']));

  // The one-line count form, which is what the roster box suggests, and the
  // bench-only read that must NOT come back as a lineup: the record applies a
  // roster whole, so a partial one would erase the starters it does not name.
  ok('counts along one line read as a lineup',
    eq(IMP.parseRoster('QB 1 / RB 2 / WR 3 / TE 1 / FLEX 1 / K 1 / DEF 1 / Bench 6'),
       IMP.parseRoster('QB 1\nRB 2\nWR 3\nTE 1\nFLEX 1\nK 1\nDEF 1\nBench 6')));
  ok('and so do counts separated by commas',
    (IMP.parseRoster('QB 1, RB 2, WR 2, TE 1, W/R/T 1, K 1, D/ST 1, Bench 6') || {}).WRRB_FLEX === 0);
  ok('a bench and an IR slot are not a lineup', IMP.parseRoster('Bench: 6, IR: 1, Taxi: 0') === null);

  // THE PLACEHOLDERS ARE PROMISES. Each box shows an example of what to type,
  // and a reader types what they are shown. One that the parser reads as
  // something else — "Receiving yards: 1 per 10" came back as one yard per
  // point — is a wrong answer the site suggested itself.
  const phs = [...uiSrc.matchAll(/kind: '(\w+)', n: '[^']*', title: '[^']*',[\s\S]*?ph: '((?:[^'\\]|\\.)*)'/g)]
    .map(m => [m[1], m[2].replace(/\\n/g, '\n')]);
  ok('all three boxes show an example', phs.length === 3, phs.map(x => x[0]).join(', '));
  for (const [kind, ph] of phs) {
    const got = IMP.parseFor(ph, kind);
    ok(`the ${kind} box's example reads back as ${kind}`, got.items.length > 0, JSON.stringify(ph));
  }
  const phScoring = (phs.find(x => x[0] === 'scoring') || [])[1] || '';
  ok('and the yardage line in it means the divisor it says',
    IMP.parseFor(phScoring, 'scoring').scoring.receivingYardsPerPoint === 10);
}

// ── 4. copying the draft room across ───────────────────────────────────────
console.log('\nthe draft room\'s league, translated');
{
  const stub = {
    has: true,
    config: {
      teams: 10,
      scoring: { receptionPoints: 0.5, rbReceptionPoints: 0.5, passingTD: 6 },
      roster: { QB: { starters: 1, total: 2 }, RB: { starters: 2, total: 5 }, WR: { starters: 2, total: 5 }, TE: { starters: 1, total: 2 }, K: { starters: 1, total: 1 }, DEF: { starters: 1, total: 1 } },
      flex: { count: 1, eligible: ['RB', 'WR', 'TE', 'QB'] }
    }
  };
  const { IMP } = load({}, stub);
  const p = IMP.fromDraftApp();
  ok('the scoring comes across whole', p.scoring.passingTD === 6 && p.scoring.receptionPoints === 0.5);
  ok('starters become starting slots', p.roster.QB === 1 && p.roster.RB === 2 && p.roster.WR === 2 && p.roster.TE === 1);
  ok('a flex that admits a QB becomes the superflex it is', p.roster.SFLEX === 1 && p.roster.FLEX === 0, JSON.stringify(p.roster));
  ok('the auction\'s per-position depth becomes one bench', p.roster.BN === 8, String(p.roster.BN));
  ok('the league size comes too', p.teams === 10);

  const { IMP: none } = load({}, null);
  ok('a reader who never opened the draft app is offered nothing', none.fromDraftApp() === null);
}

// ── 5. the record ──────────────────────────────────────────────────────────
console.log('\nthe record');
{
  const { L } = load();
  ok('nothing is saved until the reader saves something', L.get() === null && L.has() === false);
  ok('and nothing is invented in the meantime', L.settings() === null && L.lineup() === null);

  // A record written before `settings` existed still reads as the league it was.
  const old = load({ iron_tuna_inseason_league_v1: JSON.stringify({ platform: 'Yahoo', scoring: 'Half PPR', teams: 10, faab: 200, ref: '' }) });
  ok('a record from before the detail existed still reads',
    old.L.get().scoring === 'Half PPR' && old.L.teams() === 10 && old.L.settings() === null);
  ok('and claims no custom scoring it does not have', old.L.hasCustomScoring() === false);

  // An import, applied and saved.
  const { L: L2, IMP } = load();
  const p = IMP.parseText('12 teams, PPR\nPassing TD: 6\nReception: 1\nQB, RB, RB, WR, WR, TE, SUPER_FLEX, K, DEF, BN, BN, BN, BN, BN, BN');
  const draft = L2.apply(L2.draft(), p);
  ok('applying an import writes nothing on its own', L2.get() === null);
  const rec = L2.save(draft);
  ok('the saved record carries the exact scoring', rec.settings.scoring.passingTD === 6);
  ok('and the lineup', rec.settings.roster.SFLEX === 1 && rec.settings.roster.BN === 6);
  ok('six-point passing touchdowns count as custom scoring', L2.hasCustomScoring() === true);
  ok('a superflex league says so', L2.isSuperflex() === true);
  ok('the one-word label still answers', L2.scoring() === 'PPR');
  ok('the summary says both', /PPR/.test(L2.summary()) && /custom/.test(L2.summary()) && /superflex/.test(L2.summary()), L2.summary());
  ok('the lineup has a name', /SUPERFLEX/.test(L2.lineupLabel()), L2.lineupLabel());

  // The headline follows the detail, not the other way round.
  const { L: L3 } = load();
  const half = L3.save({ platform: 'ESPN', scoring: 'PPR', teams: 12, faab: 100, settings: { scoring: { receptionPoints: 0.5 } } });
  ok('a record whose detail says half-PPR is not labelled PPR', half.scoring === 'Half PPR', half.scoring);

  // Plain PPR imported from a screenshot is still plain PPR.
  const { L: L4, IMP: I4 } = load();
  L4.save(L4.apply(L4.draft(), I4.preset('ppr')));
  ok('an import that changes nothing earns no "custom" tag', L4.hasCustomScoring() === false, L4.summary());

  // The RB catch follows the general one, but only while it was following it.
  const { L: L6, IMP: I6 } = load();
  const halfPaste = L6.apply(L6.save({ platform: 'Sleeper', scoring: 'PPR', teams: 12, faab: 100, settings: { scoring: { receptionPoints: 1, rbReceptionPoints: 1 } } }), I6.parseText('12-team Half-PPR league\nPassing TD: 6'));
  ok('a half-PPR paste moves the RB reception with it', halfPaste.settings.scoring.rbReceptionPoints === 0.5,
    String(halfPaste.settings.scoring.rbReceptionPoints));
  const { L: L7, IMP: I7 } = load();
  const rbPrem = L7.apply(L7.save({ platform: 'Sleeper', scoring: 'Standard', teams: 12, faab: 100, settings: { scoring: { receptionPoints: 0, rbReceptionPoints: 0.5 } } }), I7.parseText('Full PPR scoring this year'));
  ok('but an RB-only value the reader set survives a paste that does not mention it', rbPrem.settings.scoring.rbReceptionPoints === 0.5,
    String(rbPrem.settings.scoring.rbReceptionPoints));

  // A preset patches the slot it names.
  const { L: L5, IMP: I5 } = load();
  const sf = L5.apply(L5.draft(), I5.preset('superflex'));
  ok('the superflex preset adds the slot and leaves the bench alone',
    sf.settings.roster.SFLEX === 1 && sf.settings.roster.BN === L5.ROSTER_DEFAULT.BN, JSON.stringify(sf.settings.roster));

  // Junk in.
  const bad = load({ iron_tuna_inseason_league_v1: JSON.stringify({ teams: 99, faab: -5, settings: { scoring: { passingTD: 'four', nonsenseField: 3 }, roster: { QB: 99, NOPE: 2 } } }) });
  const b = bad.L.get();
  ok('a hand-edited record is clamped rather than believed', b.teams === 20 && b.faab === 0);
  ok('a scoring field that is not a number is dropped', b.settings.scoring.passingTD === undefined);
  ok('a scoring field nothing can score is dropped', b.settings.scoring.nonsenseField === undefined);
  ok('a slot that is not a slot is dropped, and a real one is clamped', b.settings.roster.NOPE === undefined && b.settings.roster.QB === 20);
}

// ── 6. the widgets are wired to the record ─────────────────────────────────
console.log('\nthe form and the importer');
{
  // No DOM here, so this is a source check rather than a render: it catches the
  // two ways these three files come apart — the UI calling something the record
  // does not export, and a page loading the form without the intake.
  const calls = [...uiSrc.matchAll(/\bL\.([a-zA-Z_]+)\(/g)].map(m => m[1]);
  const { L } = load();
  const unknown = [...new Set(calls)].filter(k => typeof L[k] !== 'function');
  ok('every ITInSeason call the form makes exists', unknown.length === 0, unknown.join(', '));

  const impCalls = [...uiSrc.matchAll(/\bIMP\.([a-zA-Z_]+)\(/g)].map(m => m[1]);
  const { IMP } = load();
  const unknownImp = [...new Set(impCalls)].filter(k => typeof IMP[k] !== 'function');
  ok('every ITInSeasonImport call it makes exists', unknownImp.length === 0, unknownImp.join(', '));

  for (const page of ['my-league.html', 'in-season.html']) {
    const src = read(page);
    const i = src.indexOf('/it-inseason.js'), j = src.indexOf('/it-inseason-import.js'), k = src.indexOf('/it-inseason-ui.js');
    ok(`${page} loads all three, in order`, i >= 0 && j > i && k > j);
  }
  ok('the by-hand league form mounts the importer',
    read('my-league.html').includes('id="mfImp"') && read('my-league.html').includes('ITInSeasonUI.importer($(\'mfImp\')'));

  // §02 mounts the three boxes, and mounts the form WITHOUT its own importer.
  // Both halves matter: the boxes with no handle to apply through would read a
  // league and have nowhere to put it, and the form keeping its four-tab
  // importer would ask the same question twice on one screen.
  {
    const ml = read('my-league.html');
    ok('/my-league §02 mounts the three boxes', ml.includes('id="mlIntake"') && ml.includes('ITInSeasonUI.intake('));
    ok('and drops the form\'s own importer so the page asks once', /leagueForm\([\s\S]{0,120}?importer:\s*false/.test(ml));
    ok('and hands what a box read to the form', /intake\([\s\S]{0,400}form\.apply\(/.test(ml));
  }
  ok('the form returns the handle the boxes apply through',
    /return \{\s*\n[\s\S]{0,600}apply: function \(partial, source, n\)/.test(uiSrc));
  // The styles the widget names have to exist, or the reader gets an unstyled
  // pile of buttons in the middle of a form.
  const css = read('site.css');
  // Every is-* class the widgets render, wherever it sits in the attribute —
  // the three boxes write class="is-input is-intake-text", and a sweep anchored
  // to the start of the attribute would have missed the second name in it.
  const classes = [...new Set(
    [...uiSrc.matchAll(/class="([^"]+)"/g)]
      .flatMap(m => m[1].split(/\s+/))
      .filter(c => /^(is-imp[a-z-]*|is-intake[a-z-]*|is-more|is-grid4|is-slots|is-slot)$/.test(c))
  )];
  const unstyled = classes.filter(c => !css.includes('.' + c));
  ok('every class the widget renders is styled', unstyled.length === 0, unstyled.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
