/* Iron Tuna — the reader's own league, on every page that prints a number.
 *
 * The front page and the insight drops quote points and dollars. Left alone
 * those numbers describe the site's default league (12 teams, $200, full PPR),
 * which is the wrong league for most readers: a $300 budget re-prices every
 * player on the board, and half-PPR or 6-point passing TDs re-orders it.
 * This file is the one place that knows what the reader actually plays, so a
 * story can print THEIR number instead of a stranger's.
 *
 * Two sources, both written by the draft app on this same origin:
 *   iron_tuna_draft_state_v2  — the league itself: teams, budget, format and
 *                               the full custom scoring. The authority.
 *   iron_tuna_values_v1       — a snapshot of the reader's own board: every
 *                               player's value and projected points AT THOSE
 *                               SETTINGS. This is what makes a rank personal;
 *                               without it we can still re-score and re-price,
 *                               we just cannot re-rank.
 *
 * Nothing here invents a league. With no saved settings every accessor that
 * speaks for the reader — has, hasBoard, rankOf, findPlayer — still reports
 * nothing: a reader who has never opened the app must never be shown numbers
 * dressed up as theirs.
 *
 * What they ARE shown is the site's own board (DEFAULT_BOARD_RAW below), at the
 * site's default league, labelled "Default league" and never "Your league".
 * That reader was the one least able to translate "+12% to +18% versus price"
 * on their own, and leaving them a bare percentage was not neutrality — so they
 * get all three readings of it: the dollars, the share of a budget, and the
 * draft slots. tailorLabel() is what keeps the two apart in the copy.
 *
 * It also owns the READING FORMAT — whether a tailored line is written in
 * auction dollars or in snake draft slots. The saved league decides it, auction
 * is the default where nothing is saved, and a page that offers a switch writes
 * the reader's choice back here so it holds on every other page they open.
 *
 * HAND-SYNCED with index.html: SCORING_DEFAULTS mirrors DEFAULT_LEAGUE_CONFIG.
 * scoring, CURVE mirrors LEAGUE_MARKET_CURVE, CURVE_BUDGET mirrors
 * LEAGUE_CURVE_BUDGET, and score() mirrors scoreSkillPlayer/yardageScore/
 * countScore. There is no build step. tools/test-it-league.mjs asserts the
 * copies stay in agreement — change them together.
 */
(function (root) {
  'use strict';

  var DEFAULT_TEAMS = 12, DEFAULT_BUDGET = 200;
  var SCORING_DEFAULTS = {
    passingYardsPerPoint: 25, passingYardsThreshold: 125, passingTD: 4, passingInt: -2, passing2pt: 2,
    rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingTD: 6, rushing2pt: 2,
    receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingTD: 6, receiving2pt: 2,
    receptionPoints: 1, rbReceptionPoints: 1, fumbleLost: -2, fumble2pt: 2,
    individualFumbleRecoveryTD: 6, individualKickReturnTD: 6, individualPuntReturnTD: 6
  };
  // The client's market curve, and the budget it is drawn at. A league's prices
  // are this curve scaled by (teams x budget) / CURVE_BUDGET — which is the
  // whole of "use the reader's budget": a $300 league pays 1.5x the sheet.
  //
  // CURVE_BUDGET is only honest if CURVE adds up to it: summed over a full 12-team
  // board (16 roster spots each, MIN_BID past the end of a position's curve) the
  // set must come to exactly 1440. It used to total 1298, and because this file
  // publishes the RAW curve while the app renormalises its own column to the
  // league budget, every dollar quoted here ran ~10% under the reader's own sheet.
  // Re-cut Aug 2026 by a flat 1.125x. tools/test-curve-budget.mjs pins the total.
  var CURVE_BUDGET = 1440;
  var CURVE = {
    QB: [28, 22, 19, 16, 12, 11, 8, 6, 5, 4, 3, 3, 2, 2, 1, 1],
    RB: [48, 45, 43, 37, 34, 31, 28, 26, 25, 22, 21, 20, 17, 13, 12, 10, 9, 9, 8, 7, 7, 7, 6, 5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    WR: [47, 45, 40, 39, 35, 31, 27, 27, 19, 18, 17, 16, 14, 13, 11, 10, 10, 10, 8, 7, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    TE: [36, 31, 22, 16, 12, 10, 8, 7, 6, 6, 3, 2, 2, 2, 1, 1],
    K: [2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    DEF: [3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  };
  var MIN_BID = 1;
  // Mirrors SUPERFLEX_QB_CURVE in index.html: what the room pays for a QB when
  // he can fill a SECOND starting slot (superflex, or straight 2-QB). The
  // 1-QB CURVE above priced Josh Allen at $47 for a superflex reader whose own
  // sheet said $69 — a whole QB tier of error, at the position superflex exists
  // to reprice. Which curve applies is qbPremium below, the same rule as the
  // client's qbIsPremium. Kept OUTSIDE the `var CURVE = {` ... `var MIN_BID`
  // span that tools/test-curve-budget.mjs parses the 1-QB mirror out of.
  var SUPERFLEX_QB_CURVE = [44, 39, 34, 32, 28, 25, 20, 17, 11, 9, 9, 6, 3, 2, 2, 2];
  // Default per-team roster totals (the site's default league), used to size a
  // superflex board for the renormalisation in price(). A saved league's own
  // roster shape overrides these per position.
  var ROSTER_TOTALS_DEFAULT = { QB: 2, RB: 4, WR: 4, TE: 2, K: 2, DEF: 2 };
  // Mirrors VEGAS_DEFAULT_W in index.html: how far the board leans on the
  // sportsbook where it and the projections disagree. Only used as the fallback
  // when a reader's saved config does not name their own setting.
  var VEGAS_DEFAULT_W = 0.75;
  // The snapshot shape this library can read PRICES out of. Shape 1 stored the
  // True Value column in `v`; shape 2 stores Market Price, which is the number
  // printed on the reader's sheet and the one a story means. An older snapshot
  // is still read for the league it names, never for a price, because a True
  // Value read as a market price is the bug this constant exists to end. It
  // heals itself the next time the reader opens the draft app.
  var SNAP_SHAPE = 2;
  var FORMAT_WORD = { auction: 'auction', snake: 'snake draft', bestball: 'best ball' };

  // ── the site's own board, for a reader who has not got one ────────────────
  // "name|POS|points" per line, at SCORING_DEFAULTS, generated from the same
  // PROJECTIONS the worker serves. It exists for ONE job: a reader with no
  // saved league still deserves a real number instead of a bare percentage, and
  // the only honest number to give them is the site's own — labelled as the
  // site's own, never as theirs. Points only: with no stat lines it cannot be
  // re-scored at someone else's scoring, which is exactly the promise this file
  // makes everywhere else. The points carry the app's season normalisation
  // (normalizeToLastYear, mirrored as COLUMN_NORM in _worker.js), so they sit
  // on the same scale as the sheet and as /api/board — a raw-scored block used
  // to quote Nacua at 356.0 against a sheet reading 330.0. Regenerate with
  // tools/build-default-board.mjs.
  // ── generated by tools/build-default-board.mjs — do not hand-edit ──
  var DEFAULT_BOARD_RAW = "Josh Allen|QB|364.4\nLamar Jackson|QB|320.8\nDrake Maye|QB|317\nJalen Hurts|QB|317\nJayden Daniels|QB|314\nJoe Burrow|QB|301.2\nJaxson Dart|QB|297.2\nBo Nix|QB|292.3\nBrock Purdy|QB|289.1\nPatrick Mahomes|QB|288.7\nMatthew Stafford|QB|288.4\nTrevor Lawrence|QB|285.6\nDak Prescott|QB|283.9\nJustin Herbert|QB|282.2\nCaleb Williams|QB|278.2\nDaniel Jones|QB|263.3\nTyler Shough|QB|263.2\nJared Goff|QB|262.7\nBaker Mayfield|QB|260\nJordan Love|QB|251.5\nKyler Murray|QB|247.9\nC.J. Stroud|QB|243.7\nMalik Willis|QB|237\nSam Darnold|QB|235.1\nBryce Young|QB|234.4\nGeno Smith|QB|226.6\nCam Ward|QB|219.1\nAaron Rodgers|QB|217.9\nJacoby Brissett|QB|196.8\nFernando Mendoza|QB|185.4\nShedeur Sanders|QB|141.1\nTua Tagovailoa|QB|112\nMichael Penix Jr.|QB|110.9\nDeshaun Watson|QB|77.4\nKirk Cousins|QB|43.6\nCarson Beck|QB|28.3\nTeddy Bridgewater|QB|15.9\nMason Rudolph|QB|10.8\nWill Levis|QB|10.8\nJarrett Stidham|QB|10.4\nNick Mullens|QB|10.3\nMarcus Mariota|QB|10.2\nTy Simpson|QB|9.9\nTyson Bagent|QB|9.8\nSeth Henigan|QB|9.6\nDrew Allar|QB|9.6\nTanner McKee|QB|9.5\nJoe Milton III|QB|8.7\nTyler Huntley|QB|8.7\nAdrian Martinez|QB|8.7\nDesmond Ridder|QB|8.4\nJoshua Dobbs|QB|8.4\nDavis Mills|QB|8.3\nMitch Trubisky|QB|8.3\nWill Howard|QB|8.3\nGarrett Nussmeier|QB|8.2\nCade Klubnik|QB|8\nKyle Allen|QB|8\nShane Buechele|QB|7.8\nQuinn Ewers|QB|7.7\nGardner Minshew|QB|7.2\nCole Payton|QB|4.4\nJalen Milroe|QB|1.9\nBehren Morton|QB|1\nJahmyr Gibbs|RB|346.3\nBijan Robinson|RB|333.8\nChristian McCaffrey|RB|324.1\nJonathan Taylor|RB|299.7\nDe'Von Achane|RB|278.1\nAshton Jeanty|RB|265.5\nJames Cook|RB|264.2\nJeremiyah Love|RB|262.8\nDerrick Henry|RB|259.4\nSaquon Barkley|RB|258.8\nKenneth Walker III|RB|258.8\nBreece Hall|RB|257.6\nChase Brown|RB|257\nOmarion Hampton|RB|248.5\nJavonte Williams|RB|245.5\nJosh Jacobs|RB|245.2\nTravis Etienne|RB|233.1\nKyren Williams|RB|219.4\nCam Skattebo|RB|215.1\nQuinshon Judkins|RB|215\nD'Andre Swift|RB|198.9\nBucky Irving|RB|195.1\nBhayshul Tuten|RB|193.9\nRhamondre Stevenson|RB|191.8\nTreVeyon Henderson|RB|186.9\nJadarian Price|RB|183.8\nJaylen Warren|RB|181.6\nDavid Montgomery|RB|181.1\nKenneth Gainwell|RB|180.4\nTony Pollard|RB|176.3\nRico Dowdle|RB|176\nAaron Jones|RB|167.5\nKyle Monangai|RB|167.1\nJ.K. Dobbins|RB|164.6\nChuba Hubbard|RB|162.8\nJonathon Brooks|RB|161.3\nRachaad White|RB|155.4\nBlake Corum|RB|151\nJacory Croskey-Merritt|RB|150.3\nTyjae Spears|RB|147.3\nRJ Harvey|RB|142\nJordan Mason|RB|141.5\nZach Charbonnet|RB|126.5\nWoody Marks|RB|120.1\nIsiah Pacheco|RB|116.9\nJames Conner|RB|116.3\nAlvin Kamara|RB|111.2\nJustice Hill|RB|108.2\nAJ Dillon|RB|98.5\nChristopher Brooks|RB|95.5\nSamaje Perine|RB|94.4\nBrian Robinson Jr.|RB|89.2\nKeaton Mitchell|RB|88.5\nTyler Allgeier|RB|86.3\nDylan Sampson|RB|83.1\nTy Johnson|RB|80.8\nBraelon Allen|RB|72\nChris Rodriguez Jr.|RB|67.5\nTank Bigsby|RB|61.9\nMike Washington Jr.|RB|61.1\nEmari Demercado|RB|60.7\nKaelon Black|RB|57.4\nBrashard Smith|RB|51.8\nIsaiah Davis|RB|48\nJerome Ford|RB|46.6\nTy Chandler|RB|42.7\nKyle Juszczyk|RB|41.3\nJaylen Wright|RB|40.6\nDevin Neal|RB|40.4\nTyrone Tracy Jr.|RB|38.7\nIsaac Guerendo|RB|38.3\nElijah Mitchell|RB|37.9\nKimani Vidal|RB|35\nSean Tucker|RB|34.8\nZavier Scott|RB|32.3\nAustin Ekeler|RB|30.8\nPhil Mafah|RB|30.6\nRoschon Johnson|RB|28.8\nDare Ogunbowale|RB|28.8\nJordan James|RB|27.5\nFrank Gore Jr.|RB|27.3\nMalik Davis|RB|26.4\nJam Miller|RB|26\nJeremy McNichols|RB|24.7\nAdam Randall|RB|24.1\nAmeer Abdullah|RB|23.5\nKendre Miller|RB|15.3\nSeth McGowan|RB|15\nKaytron Allen|RB|14.8\nEmanuel Wilson|RB|9.3\nMichael Burton|RB|9.2\nAndrew Beck|RB|7.6\nJawhar Jordan|RB|6.8\nPuka Nacua|WR|330\nJa'Marr Chase|WR|312\nJaxon Smith-Njigba|WR|302.4\nAmon-Ra St. Brown|WR|299.7\nJustin Jefferson|WR|271.9\nCeeDee Lamb|WR|271.3\nDrake London|WR|249.3\nRashee Rice|WR|241\nChris Olave|WR|231.4\nA.J. Brown|WR|230.2\nNico Collins|WR|229.8\nGarrett Wilson|WR|229.8\nMalik Nabers|WR|226.7\nDeVonta Smith|WR|221.3\nGeorge Pickens|WR|221.2\nZay Flowers|WR|220.8\nTetairoa McMillan|WR|219\nDavante Adams|WR|215.4\nEmeka Egbuka|WR|211.6\nLadd McConkey|WR|204.4\nTee Higgins|WR|202.2\nTerry McLaurin|WR|201.8\nJaylen Waddle|WR|197.2\nRome Odunze|WR|195.7\nDJ Moore|WR|193.1\nJameson Williams|WR|192.9\nLuther Burden III|WR|190.3\nCourtland Sutton|WR|188.3\nCarnell Tate|WR|188\nMichael Pittman|WR|182.1\nDK Metcalf|WR|181.3\nMarvin Harrison Jr.|WR|179.1\nAlec Pierce|WR|173\nChristian Watson|WR|171\nMatthew Golden|WR|171\nParker Washington|WR|170.9\nJakobi Meyers|WR|168.4\nMike Evans|WR|167.2\nMichael Wilson|WR|163.7\nBrian Thomas Jr.|WR|163.7\nWan'Dale Robinson|WR|161.7\nXavier Worthy|WR|161.2\nKhalil Shakir|WR|157\nJordan Addison|WR|157\nJayden Reed|WR|157\nQuentin Johnston|WR|153.2\nStefon Diggs|WR|151.1\nJosh Downs|WR|145\nChris Godwin|WR|144.5\nKC Concepcion|WR|143.5\nMakai Lemon|WR|142.1\nJayden Higgins|WR|138.8\nJohn Metchie III|WR|138.7\nDe'Zhaun Stribling|WR|138.7\nRomeo Doubs|WR|138.6\nTheo Wease Jr.|WR|138\nDeebo Samuel|WR|137.9\nJalen Coker|WR|136\nDenzel Boston|WR|130.9\nJerry Jeudy|WR|129.2\nRashid Shaheed|WR|129\nTre Tucker|WR|125.8\nCalvin Ridley|WR|124.9\nJalen McMillan|WR|122.5\nAdonai Mitchell|WR|117.2\nDevaughn Vele|WR|115.7\nJalen Nailor|WR|114.6\nRashod Bateman|WR|113.8\nMarquise Brown|WR|111.9\nCaleb Douglas|WR|105.9\nJauan Jennings|WR|105.1\nTravis Hunter|WR|103.6\nMalik Washington|WR|103.5\nKayshon Boutte|WR|102.5\nDontayvion Wicks|WR|101.2\nGermie Bernard|WR|100.3\nCedric Tillman|WR|95.7\nCooper Kupp|WR|94\nJa'Kobi Lane|WR|93.5\nJordyn Tyson|WR|92.5\nCalvin Austin III|WR|92.1\nBub Means|WR|91.9\nTank Dell|WR|87.9\nXavier Legette|WR|87.4\nTre' Harris|WR|83.7\nRyan Flournoy|WR|83\nJosh Palmer|WR|81.9\nDarius Slayton|WR|80.9\nOmar Cooper Jr.|WR|80.4\nJalen Tolbert|WR|77.6\nKevin Austin Jr.|WR|74.8\nZachariah Branch|WR|74.2\nTyquan Thornton|WR|72.3\nAntonio Williams|WR|71.4\nKeon Coleman|WR|68.8\nIsaac TeSlaa|WR|67.6\nDarnell Mooney|WR|66.5\nBen Skowronek|WR|66.2\nChris Bell|WR|64.8\nChris Brazzell II|WR|62.9\nMarvin Mims Jr.|WR|61.7\nJack Bech|WR|61.3\nTory Horton|WR|60.5\nTed Hurst|WR|60\nSavion Williams|WR|54.9\nAndrei Iosivas|WR|53.9\nMack Hollins|WR|52.3\nKendrick Bourne|WR|47.4\nTroy Franklin|WR|46.4\nXavier Hutchinson|WR|46.2\nDevontez Walker|WR|40.7\nZavion Thomas|WR|31.9\nOlamide Zaccheaus|WR|29.5\nChimere Dike|WR|29.3\nRoman Wilson|WR|26.8\nAshton Dulin|WR|26.7\nChristian Kirk|WR|25.5\nElic Ayomanor|WR|22.4\nTez Johnson|WR|19.2\nLuke McCaffrey|WR|16.7\nDemarcus Robinson|WR|8.5\nJahdae Walker|WR|7.8\nBrandon Aiyuk|WR|1.2\nTrey McBride|TE|241.1\nBrock Bowers|TE|240.4\nTyler Warren|TE|210\nColston Loveland|TE|204.9\nHarold Fannin Jr.|TE|188.5\nSam LaPorta|TE|188.3\nGeorge Kittle|TE|187.8\nKyle Pitts|TE|184.4\nTucker Kraft|TE|179.8\nTravis Kelce|TE|177.3\nDallas Goedert|TE|177\nMark Andrews|TE|169.1\nJake Ferguson|TE|166.6\nT.J. Hockenson|TE|158.1\nIsaiah Likely|TE|154.9\nDalton Kincaid|TE|154.1\nHunter Henry|TE|150.3\nKenyon Sadiq|TE|147.2\nJuwan Johnson|TE|143.1\nBrenton Strange|TE|142.1\nPat Freiermuth|TE|136.1\nTerrance Ferguson|TE|135.8\nDalton Schultz|TE|133\nGunnar Helm|TE|126.9\nChigoziem Okonkwo|TE|123.2\nGreg Dulcich|TE|119.4\nAJ Barner|TE|114.7\nEvan Engram|TE|106.7\nDavid Njoku|TE|105.1\nCade Otton|TE|102.8\nMike Gesicki|TE|85.5\nMichael Mayer|TE|81.2\nOronde Gadsden II|TE|76.8\nColby Parkinson|TE|75.2\nDarnell Washington|TE|72.3\nDawson Knox|TE|68.3\nMason Taylor|TE|68\nTheo Johnson|TE|61.5\nErick All|TE|60.9\nLuke Musgrave|TE|55.8\nCole Kmet|TE|54.1\nGrant Calcaterra|TE|49.4\nAustin Hooper|TE|43.9\nTommy Tremble|TE|43.5\nJa'Tavion Sanders|TE|43\nElijah Higgins|TE|43\nWill Kacmarek|TE|40\nJosh Oliver|TE|38.7\nTyler Higbee|TE|37.6\nEli Raridon|TE|37.5\nCharlie Kolar|TE|36.5\nNoah Fant|TE|36.1\nJohn Bates|TE|34.6\nAdam Trautman|TE|29.3\nDaniel Bellinger|TE|27.3\nEli Stowers|TE|26.3\nJeremy Ruckert|TE|24.6\nDavis Allen|TE|19.6\nNate Adkins|TE|19.1\nBrock Wright|TE|18.8\nNate Boerkircher|TE|18.8\nBen Sims|TE|15.3\nMarlin Klein|TE|8.8\nMatthew Hibner|TE|8.4";
  // ── end generated ──

  // ── the reading format ────────────────────────────────────────────────────
  // Every tailored line has to commit to a draft type before it can say
  // anything useful: an auction reader wants dollars off their own sheet, a
  // snake reader wants draft slots. The league the app saved answers that by
  // itself — a reader who set up an auction is given auction advice without
  // ever asking, and one who set up a snake gets slots. With no saved league
  // the answer is AUCTION: this is an auction site and its copy is written that
  // way, so an unset reader is never shown draft-slot advice by accident.
  //
  // A reader can disagree with either. The choice a switch writes here outranks
  // the saved league and is remembered across pages, because someone who drafts
  // both ways off one board should not have to re-pick on every visit.
  var READING_KEY = 'iron_tuna_reading_format_v1';
  // Two lenses, not three: best ball IS a draft, so it reads in slots. label()
  // still names the league honestly underneath — "your 12-team best ball".
  function normFormat(f) {
    return f === 'auction' ? 'auction' : (f === 'snake' || f === 'bestball') ? 'snake' : null;
  }
  var readingChoice = null;

  function readJSON(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function num(v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; }

  // ── the league ────────────────────────────────────────────────────────────
  var state = readJSON('iron_tuna_draft_state_v2');
  var snap = readJSON('iron_tuna_values_v1');
  if (snap && (!snap.players || !snap.players.length)) snap = null;

  var raw = state && state.config ? state.config : null;
  var cfg = null;
  if (raw || snap) {
    var scoring = {};
    var src = (raw && raw.scoring) || {};
    for (var k in SCORING_DEFAULTS) {
      if (SCORING_DEFAULTS.hasOwnProperty(k)) scoring[k] = num(src[k], SCORING_DEFAULTS[k]);
    }
    // Bonus ladders ride along untouched: they are arrays, and a league that
    // pays a bonus at 100 yards scores differently from one that does not.
    ['passingYardBonuses', 'rushingYardBonuses', 'receivingYardBonuses',
     'receptionBonuses', 'rbReceptionBonuses'].forEach(function (b) {
      scoring[b] = Array.isArray(src[b]) ? src[b] : [];
    });
    cfg = {
      teams: Math.max(2, Math.round(num(raw && raw.teams, num(snap && snap.teams, DEFAULT_TEAMS)))),
      budget: Math.max(1, Math.round(num(raw && raw.budget, num(snap && snap.budget, DEFAULT_BUDGET)))),
      format: (raw && raw.format) || (snap && snap.format) || 'auction',
      scoring: scoring,
      // The Vegas slider. It was dropped here for months while sitting in the
      // saved config the line above already reads, so every number this library
      // quoted a reader was at a weighting they had not chosen. It only decides
      // who wins where the odds and the projections disagree, which is exactly
      // the disagreement a story is usually about.
      //
      // typeof, not num(): num(null, 0.75) is 0, because Number(null) is 0 and
      // 0 is finite. A reader with no slider saved would have been read as one
      // who had dragged it all the way off the sportsbook. Same trap the worker
      // documents in applyVegasWeight, and the same guard, so the two files
      // answer this question identically.
      vegasWeight: (function () {
        var w = raw && raw.strategy ? raw.strategy.vegasWeight
              : (snap ? snap.vegasWeight : null);
        return typeof w === 'number' && isFinite(w)
          ? Math.min(1, Math.max(0, w)) : VEGAS_DEFAULT_W;
      })()
    };
  }

  // "Custom" is the difference the reader can see. A saved league that matches
  // the site defaults in every respect would re-print the same numbers anyway,
  // so it earns no "your league" labelling — a badge that changes nothing is
  // just noise, and worse, it teaches readers to distrust the ones that matter.
  // Scoring is tracked separately from budget and team count, because a story
  // can honour one without the other: points move with scoring, prices move
  // with the budget.
  var customScoring = false;
  if (cfg) {
    for (var sk in SCORING_DEFAULTS) {
      if (SCORING_DEFAULTS.hasOwnProperty(sk) && cfg.scoring[sk] !== SCORING_DEFAULTS[sk]) customScoring = true;
    }
    ['passingYardBonuses', 'rushingYardBonuses', 'receivingYardBonuses',
     'receptionBonuses', 'rbReceptionBonuses'].forEach(function (b) {
      if (cfg.scoring[b] && cfg.scoring[b].length) customScoring = true;
    });
  }
  var customLeague = !!cfg && (cfg.teams !== DEFAULT_TEAMS || cfg.budget !== DEFAULT_BUDGET);
  var custom = customScoring || customLeague;

  // The lens every tailored line is written through. Reader's own switch first,
  // then the league they saved, then auction. Reading it costs nothing, so a
  // page that offers the switch can ask on every render.
  try { readingChoice = normFormat(root.localStorage.getItem(READING_KEY)); } catch (e) { readingChoice = null; }
  function readingFormat() {
    return readingChoice || (cfg && normFormat(cfg.format)) || 'auction';
  }
  // Returns the format now in force, so a caller can re-render from the answer
  // instead of guessing whether an unrecognised value was taken.
  function setReadingFormat(f) {
    var v = normFormat(f);
    if (!v) return readingFormat();
    readingChoice = v;
    try { root.localStorage.setItem(READING_KEY, v); } catch (e) {}
    return v;
  }
  // True when the saved league itself answers the question — the switch starts
  // on the reader's own format rather than on the site default, and a page can
  // say so instead of implying they picked it.
  function formatFromLeague() { return !readingChoice && !!cfg && !!normFormat(cfg.format); }

  // ── the edition ───────────────────────────────────────────────────────────
  // The reading format above answers one question: dollars or draft slots. The
  // EDITION answers a different one — WHICH OF THE THREE DRAFTS the reader came
  // for. Best ball is its own edition (its own insight pages, its own guides,
  // its own room in the app) even though it reads in slots exactly like a snake
  // draft, so the two cannot share one value: normFormat() folds best ball into
  // snake, and a page that switched on that alone would send a best ball reader
  // to the snake edition of every story.
  //
  // Setting the edition also sets the reading format, so a reader who picks
  // Best Ball on the front page's ribbon is never left reading auction dollars
  // underneath. The reverse is deliberately NOT true: the edition is the
  // coarser choice, and it is the one the reader makes by hand.
  var EDITION_KEY = 'iron_tuna_edition_v1';
  function normEdition(f) {
    return (f === 'auction' || f === 'snake' || f === 'bestball') ? f : null;
  }
  var editionChoice = null;
  try { editionChoice = normEdition(root.localStorage.getItem(EDITION_KEY)); } catch (e) { editionChoice = null; }
  // Same precedence as readingFormat(): the reader's own switch, then the league
  // they saved, then auction — this is an auction site and its copy is written
  // that way, so an unset reader is never dropped into another edition.
  function edition() {
    return editionChoice || (cfg && normEdition(cfg.format)) || 'auction';
  }
  function setEdition(f) {
    var v = normEdition(f);
    if (!v) return edition();
    editionChoice = v;
    try { root.localStorage.setItem(EDITION_KEY, v); } catch (e) {}
    setReadingFormat(v);          // best ball reads in slots; normFormat folds it
    return v;
  }
  // True when nobody has picked and the edition came from the league they saved,
  // so a page can say where it got the answer instead of implying they chose it.
  function editionFromLeague() { return !editionChoice && !!cfg && !!normEdition(cfg.format); }

  // ── scoring: a faithful port of the client's scoreSkillPlayer ─────────────
  function yardageScore(yards, perPoint, threshold, bonuses) {
    if (yards < threshold) return 0;
    // A blanked scoring input saves NaN (parseFloat('')) — a bad divisor here
    // would poison every number this file prints.
    var pts = perPoint > 0 ? yards / perPoint : 0;
    (bonuses || []).forEach(function (b) { if (yards >= b.at) pts += b.points; });
    return pts;
  }
  function countScore(count, perEvent, bonuses) {
    if (!count) return 0;
    var pts = count * perEvent;
    (bonuses || []).forEach(function (b) { if (count >= b.at) pts += b.points; });
    return pts;
  }
  function score(stats, position, scoringOverride) {
    var s = scoringOverride || (cfg && cfg.scoring) || SCORING_DEFAULTS;
    stats = stats || {};
    var pts = 0;
    pts += yardageScore(stats.passYd || 0, s.passingYardsPerPoint, s.passingYardsThreshold, s.passingYardBonuses);
    pts += (stats.passTD || 0) * s.passingTD;
    pts += (stats.passInt || 0) * s.passingInt;
    pts += (stats.pass2pt || 0) * s.passing2pt;
    pts += yardageScore(stats.rushYd || 0, s.rushingYardsPerPoint, s.rushingYardsThreshold, s.rushingYardBonuses);
    pts += (stats.rushTD || 0) * s.rushingTD;
    pts += (stats.rush2pt || 0) * s.rushing2pt;
    pts += yardageScore(stats.recYd || 0, s.receivingYardsPerPoint, s.receivingYardsThreshold, s.receivingYardBonuses);
    pts += (stats.recTD || 0) * s.receivingTD;
    pts += (stats.rec2pt || 0) * s.receiving2pt;
    if (position === 'RB') pts += countScore(stats.rec || 0, s.rbReceptionPoints, s.rbReceptionBonuses);
    else pts += countScore(stats.rec || 0, s.receptionPoints, s.receptionBonuses);
    pts += (stats.fumLost || 0) * s.fumbleLost;
    pts += (stats.fum2pt || 0) * s.fumble2pt;
    pts += (stats.fumRecTD || 0) * s.individualFumbleRecoveryTD;
    pts += (stats.krTD || 0) * s.individualKickReturnTD;
    pts += (stats.prTD || 0) * s.individualPuntReturnTD;
    return pts;
  }

  // The client's qbIsPremium, on the reader's SAVED league: a QB can fill a
  // second STARTING slot only when the flex both admits him and exists, or the
  // league starts two outright. The snapshot carries no roster shape, so a
  // reader with a board but no saved config stays on the 1-QB curve — their
  // prices come off their own snapshot anyway, never off this curve.
  var qbPremium = (function () {
    var flex = raw && raw.flex;
    var flexQb = !!(flex && (flex.count || 0) > 0 &&
      Array.isArray(flex.eligible) && flex.eligible.indexOf('QB') >= 0);
    var starters = (raw && raw.roster && raw.roster.QB && raw.roster.QB.starters) || 0;
    return flexQb || starters >= 2;
  })();
  // The superflex board does not add up. The SF QB curve deliberately sits
  // above the 1-QB one, so summed over a full board the raw prices run ~10%
  // past the league's money; the app closes that by renormalising the whole
  // column to the budget (renormalizeToBudget), and quoting the raw curve at a
  // superflex reader would overquote every position by that ~10%. This is the
  // app's factor to first order: spendable dollars above the min bids, over
  // the raw curve's above-min total across the rostered slots. Computed lazily
  // and once — it needs `cfg`, and it never changes within a page view.
  var _sfScale = null;
  function sfRenorm() {
    if (_sfScale != null) return _sfScale;
    if (!qbPremium || !cfg) { _sfScale = 1; return _sfScale; }
    var scale = cfg.teams * cfg.budget / CURVE_BUDGET;
    var rostered = 0, above = 0, pos, i;
    for (pos in ROSTER_TOTALS_DEFAULT) {
      if (!ROSTER_TOTALS_DEFAULT.hasOwnProperty(pos)) continue;
      var total = (raw && raw.roster && raw.roster[pos] && raw.roster[pos].total) || ROSTER_TOTALS_DEFAULT[pos];
      var curve = pos === 'QB' ? SUPERFLEX_QB_CURVE : (CURVE[pos] || []);
      var n = Math.round(total * cfg.teams);
      rostered += n;
      for (i = 0; i < n && i < curve.length; i++) {
        above += Math.max(MIN_BID, Math.round(curve[i] * scale)) - MIN_BID;
      }
    }
    var target = cfg.teams * cfg.budget - rostered * MIN_BID;
    _sfScale = above > 0 && target > 0 ? target / above : 1;
    return _sfScale;
  }

  // Curve slot -> dollars in THIS reader's league. Same shape as the client's
  // calculateMarketValues, so a price quoted in a story is a price they can go
  // and find on their own sheet — including which QB curve their league is on.
  function price(position, rankIndex) {
    var curve = position === 'QB' && qbPremium ? SUPERFLEX_QB_CURVE : (CURVE[position] || []);
    var scale = (cfg ? cfg.teams * cfg.budget : DEFAULT_TEAMS * DEFAULT_BUDGET) / CURVE_BUDGET;
    // Only curve prices scale with the budget; past the curve the room pays the
    // min bid, full stop (mirrors calculateMarketValues — scaling the fallback
    // quoted the deep tail at $2 in a $200 league).
    if (rankIndex >= curve.length) return MIN_BID;
    var p = Math.max(MIN_BID, Math.round(curve[rankIndex] * scale));
    if (qbPremium) p = Math.max(MIN_BID, MIN_BID + Math.round((p - MIN_BID) * sfRenorm()));
    return p;
  }

  // A dollar figure written about a MANAGER'S OWN money in the site's default
  // $200 league, restated in the reader's: "how to spend the $200" becomes "how
  // to spend the $300", and a $40 stud in that prose becomes a $60 one.
  //
  // Deliberately scaled by budget alone, not by the league pool. Team count
  // belongs in price(), where more teams means more money chasing the same
  // players; it does not belong here, where the sentence is about one manager's
  // wallet and a 10-team league does not shrink it.
  function money(perTeamDollars) {
    var n = num(perTeamDollars, 0);
    if (!cfg) return Math.round(n);
    return Math.max(0, Math.round(n * cfg.budget / DEFAULT_BUDGET));
  }

  // ── the reader's board ────────────────────────────────────────────────────
  // Suffix first, THEN last word — normName("III") is "", which would bucket
  // every suffixed name under one key. Same rule as my-insights.html.
  function normName(s) {
    return String(s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '').replace(/[^a-z]/g, '');
  }
  function lastNameKey(s) {
    var w = String(s || '').trim().replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').split(/\s+/);
    return normName(w[w.length - 1]);
  }
  // One index per pool. Two pools ever exist: the reader's own saved board, and
  // the site's default board below. They are kept strictly apart — `mine` stays
  // null for a reader who has never opened the app, so every accessor that
  // speaks for "their" board still reports nothing rather than quietly
  // answering out of the site's.
  function makeIndex(players) {
    var byName = {}, byLast = {}, byPos = {};
    players.forEach(function (p) {
      byName[normName(p.n)] = p;
      var last = lastNameKey(p.n);
      if (last) (byLast[last] = byLast[last] || []).push(p);
      (byPos[p.pos] = byPos[p.pos] || []).push(p);
    });
    Object.keys(byPos).forEach(function (pos) {
      byPos[pos].sort(function (a, b) { return (b.pts || 0) - (a.pts || 0); });
    });
    return { players: players, byName: byName, byLast: byLast, byPos: byPos };
  }
  var mine = snap ? makeIndex(snap.players) : null;
  // Whether the reader's saved board may be read for PRICES. See SNAP_SHAPE:
  // before shape 2 the stored `v` was the True Value column, and quoting it as
  // the sheet's price is how a story ended up $12 above the reader's own row.
  // The league it names is still honoured either way; only the dollars wait.
  var minePrices = !!(snap && num(snap.sv, 1) >= SNAP_SHAPE);

  // The site's default board, parsed on first use — a reader who has their own
  // never pays for it. Prices come off the market curve at the site's default
  // league, which is the app's own recipe (calculateMarketValues): rank within
  // position by points, read the curve slot, scale by teams x budget.
  var defIndex = null;
  function defaultBoard() {
    if (served) return served;
    if (defIndex) return defIndex;
    var players = [];
    String(DEFAULT_BOARD_RAW).split('\n').forEach(function (line) {
      var f = line.split('|');
      if (f.length === 3 && f[0]) players.push({ n: f[0], pos: f[1], pts: num(f[2], 0) });
    });
    defIndex = makeIndex(players);
    var scale = DEFAULT_TEAMS * DEFAULT_BUDGET / CURVE_BUDGET;
    Object.keys(defIndex.byPos).forEach(function (pos) {
      var curve = CURVE[pos] || [];
      // byPos is already sorted by points, so the array index IS the curve slot.
      defIndex.byPos[pos].forEach(function (p, i) {
        p.v = i < curve.length ? Math.max(MIN_BID, Math.round(curve[i] * scale)) : MIN_BID;
      });
    });
    return defIndex;
  }

  // ── the site's board, as the site actually serves it ──────────────────────
  // The block above is generated from the COMMITTED projections. The app is
  // served those projections re-blended with today's odds, so the static copy
  // is a different board from the cheat sheet the moment a line moves — which
  // is how a story quoted "$47 on the consensus sheet" at a reader whose row
  // said $25. `/api/board` is that same blended board, priced by the same
  // curve, computed once in the worker and cached.
  //
  // Fetched, never required. The static block answers immediately and keeps
  // answering if the request fails, is blocked, or the page is offline; the
  // served board replaces it when it lands. `onBoard()` lets a page that has
  // already painted repaint on the better answer instead of showing the
  // fallback for the life of the visit.
  var served = null, boardWaiters = [], boardTried = false;
  function adoptBoard(payload) {
    if (!payload || !payload.ok || !payload.players || !payload.players.length) return false;
    var rows = [];
    for (var i = 0; i < payload.players.length; i++) {
      var p = payload.players[i];
      if (!p || !p.n || !p.pos) continue;
      var v = num(p.v, 0);
      if (v < MIN_BID) continue;
      rows.push({ n: p.n, pos: p.pos, pts: num(p.pts, 0), v: v });
    }
    if (!rows.length) return false;
    // makeIndex sorts byPos on points, so the served prices are kept as sent
    // rather than re-derived from a rank this file computed a second time.
    served = makeIndex(rows);
    return true;
  }
  function onBoard(cb) {
    if (typeof cb !== 'function') return;
    if (served || boardTried) { cb(!!served); return; }
    boardWaiters.push(cb);
  }
  function settleBoard(ok) {
    boardTried = true;
    var list = boardWaiters; boardWaiters = [];
    list.forEach(function (cb) { try { cb(ok); } catch (e) {} });
  }
  function loadBoard() {
    if (typeof root.fetch !== 'function') { settleBoard(false); return; }
    try {
      root.fetch('/api/board', { credentials: 'omit' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (d) { settleBoard(adoptBoard(d)); })
        .catch(function () { settleBoard(false); });
    } catch (e) { settleBoard(false); }
  }
  loadBoard();

  // Resolve a name field to a row on a board. The premium insight set stores
  // several names per call, semicolon-separated ("DJ Moore; Allen"), so each
  // entry is tried in order — the first one the board knows wins. A bare surname
  // only resolves when exactly one player at that position carries it; an
  // ambiguous one resolves to nothing rather than to a coin flip.
  // `idx` defaults to the reader's own board, so every existing caller is
  // unchanged; the default-board path passes its own.
  function findPlayer(name, position, idx) {
    var ix = idx || mine;
    if (!ix || !name) return null;
    var entries = String(name).split(';');
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i].trim();
      if (!e) continue;
      var hit = ix.byName[normName(e)];
      if (hit && (!position || position === 'Market' || hit.pos === position)) return hit;
      var cands = (ix.byLast[lastNameKey(e)] || []).filter(function (p) {
        return !position || position === 'Market' || p.pos === position;
      });
      if (cands.length === 1) return cands[0];
    }
    return null;
  }
  // Pull a player the board knows out of a headline. Longest match wins so
  // "Kenneth Walker" is never read as some other Walker, and the search is
  // anchored on word boundaries so "Love" cannot match inside "Loveland".
  function playerInText(text, position, idx) {
    var ix = idx || mine;
    if (!ix || !text) return null;
    var hay = ' ' + String(text).toLowerCase().replace(/[^a-z]+/g, ' ') + ' ';
    var best = null;
    var pool = (position && position !== 'Market' && ix.byPos[position]) ? ix.byPos[position] : ix.players;
    pool.forEach(function (p) {
      var full = ' ' + String(p.n).toLowerCase().replace(/[^a-z]+/g, ' ').trim() + ' ';
      if (full.length > 3 && hay.indexOf(full) >= 0 && (!best || full.length > best.len)) {
        best = { p: p, len: full.length };
      }
    });
    return best ? best.p : null;
  }
  // Where a points total would sit on the reader's board at their scoring. The
  // board is the shipped (odds-blended) one, so this answers "which slot does
  // this land on MY sheet", which is the only rank a reader can act on. Their
  // board only — a reader without one gets null, exactly as before.
  function rankOf(position, pts) {
    var list = mine && mine.byPos[position];
    if (!list || !list.length) return null;
    var n = 1;
    for (var i = 0; i < list.length; i++) if ((list[i].pts || 0) > pts) n++;
    return n;
  }
  // The overall draft order of a board, computed once per board on first use.
  // A DRAFT SLOT is a position in this order, and the order is by VALUE, not by
  // points: an auction dollar means the same thing at every position, and raw
  // fantasy points do not. Ties fall back to points so the order is total.
  function order(ix) {
    if (ix.order) return ix.order;
    ix.order = ix.players.slice().sort(function (a, b) {
      return (b.v || 0) - (a.v || 0) || (b.pts || 0) - (a.pts || 0);
    });
    ix.order.forEach(function (p, i) { p.oi = i; });
    return ix.order;
  }
  // Slots a player moves on a board when their projection shifts by `pct`.
  //
  // Points move a player WITHIN HIS POSITION — that is the only comparison raw
  // fantasy points support. A 300-point QB and a 300-point WR are not adjacent
  // picks, and counting every player of any position sitting between the old and
  // new totals (which this used to do) reported a routine +15% on a WR as a
  // 25-slot move: it was counting quarterbacks he would never be drafted
  // against. So: find the player at his own position he now leapfrogs, and
  // measure the distance to that player on the overall value-ordered board.
  // Returns BOTH the distance and the player leapfrogged: the copy has to know
  // whether the move happened anywhere that matters, and a number alone cannot
  // say. { slots: 0, target: null } when nothing moves.
  function slotMove(p, pct, idx) {
    var ix = idx || mine;
    if (!ix || !p) return { slots: 0, target: null };
    var np = (p.pts || 0) * (1 + pct);
    var list = ix.byPos[p.pos] || [];
    var target = null, i;
    if (pct > 0) {
      // list runs best-first, so the FIRST player he now outscores is the
      // highest slot he reaches; he takes that player's place.
      for (i = 0; i < list.length; i++) {
        if (list[i] === p) break;
        if ((list[i].pts || 0) <= np) { target = list[i]; break; }
      }
    } else {
      // Falling: the LAST player who now outscores him is how far he drops.
      for (i = list.length - 1; i >= 0; i--) {
        if (list[i] === p) break;
        if ((list[i].pts || 0) >= np) { target = list[i]; break; }
      }
    }
    if (!target) return { slots: 0, target: null };
    order(ix);
    return { slots: Math.abs((p.oi || 0) - (target.oi || 0)), target: target };
  }
  // The number on its own, which is all my-insights.html ever wanted.
  function slotsMoved(p, pct, idx) { return slotMove(p, pct, idx).slots; }
  // The endgame tier: players priced at roughly the last 1.5% of a budget, where
  // the board stops being an order at all. Fifty players tie at $1–$2, so the
  // gap between two of them is an artefact of the tie-break, not a draft slot —
  // quoting "63 slots" off it would be precision the number does not have.
  function dartLine(budget) { return Math.max(MIN_BID + 1, Math.round(budget * 0.015)); }
  // How far the move went, as a noun phrase: "6 draft slots (about half a
  // round)", or an honest description where a slot count would be noise.
  // Returns { text, endgame } — endgame true when the phrase describes the tier
  // rather than a distance, because that reads as a different sentence. Empty
  // text means nothing moved.
  //
  // One copy of this: the reader's line and the default-league line print the
  // same phrase, and drifting apart is how two pages start disagreeing about the
  // same call.
  //
  // `scale` restates the two board prices into the same money as `budget`. The
  // site's own board is priced at the desk's league and must stay that way —
  // boardRatio() reads it — so a caller quoting it to a reader on another budget
  // passes leagueScale() here rather than comparing $200 dollars against a $120
  // endgame line, which is how a mid-round back gets called a dart throw.
  function slotPhrase(p, target, a, b, teams, budget, word, scale) {
    if (!target || b === 0) return { text: '', endgame: false };
    var k = scale || 1;
    var pv = Math.max(MIN_BID, Math.round((p.v || 0) * k));
    var tv = Math.max(MIN_BID, Math.round((target.v || 0) * k));
    var dart = dartLine(budget), tier = '$' + MIN_BID + '\u2013$' + dart;
    var lo = Math.min(pv, tv), hi = Math.max(pv, tv);
    if (lo <= dart) {
      return {
        endgame: true,
        text: hi <= dart ? 'a shuffle inside the ' + tier + ' endgame'
            : (pv <= dart ? 'a climb out of ' : 'a slide into ') + tier + ' endgame territory'
      };
    }
    // A range that starts at nothing is not a range: the low end of the
    // editorial percentage simply does not move him, so `b` is a ceiling.
    var count = a === 0 ? b + ' ' + word + 's at most'
              : a === b ? b + ' ' + word + (b === 1 ? '' : 's')
              : a + '\u2013' + b + ' ' + word + 's';
    var rounds = b / teams, r1 = Math.round(rounds * 10) / 10;
    var note = r1 >= 0.9 && r1 <= 1.1 ? ' (about a round)'
             : rounds > 1.1 ? ' (about ' + r1 + ' rounds)'
             : rounds >= 0.45 ? ' (about half a round)' : '';
    return { text: count + note, endgame: false };
  }

  // ── copy helpers ──────────────────────────────────────────────────────────
  // The league in words. `fmtOverride` is the lens the caller is reading
  // through, and when it disagrees with the league the reader actually saved the
  // sentence stops calling it theirs: "worth $4 more in A 10-team, $300 auction"
  // is a true thing to say to a snake-league reader who asked for the auction
  // read — "in YOUR 10-team auction" is not, because they never said that.
  function label(fmtOverride) {
    if (!cfg) return '';
    var f = fmtOverride || cfg.format;
    // Compared through normFormat so best ball read as a snake is still the
    // reader's own league, and still named best ball.
    var mine = normFormat(f) === normFormat(cfg.format);
    var own = mine ? 'your ' : 'a ';
    if (normFormat(f) === 'auction') return own + cfg.teams + '-team, $' + cfg.budget + ' auction';
    return own + cfg.teams + '-team ' + (FORMAT_WORD[mine ? cfg.format : f] || 'league');
  }
  function scoringLabel() {
    if (!cfg) return '';
    var rec = cfg.scoring.receptionPoints;
    var base = rec >= 1 ? 'full PPR' : rec >= 0.5 ? 'half-PPR' : rec > 0 ? rec + ' PPR' : 'standard';
    if (cfg.scoring.passingTD !== 4) base += ', ' + cfg.scoring.passingTD + '-point passing TDs';
    if (cfg.scoring.rbReceptionPoints !== rec) base += ', ' + cfg.scoring.rbReceptionPoints + ' per RB catch';
    return base;
  }
  // "+12% to +18%" / "-4%" out of an editorial effect line. Returns [lo, hi] as
  // fractions, or null when the line is qualitative — a story that never
  // quantified itself must not be handed a fabricated dollar figure.
  function pctRange(effect) {
    var m = String(effect || '').match(/([+-]?\d+(?:\.\d+)?)\s*%\s*(?:to|–|—|-)\s*([+-]?\d+(?:\.\d+)?)\s*%/);
    if (m) return [parseFloat(m[1]) / 100, parseFloat(m[2]) / 100];
    var s = String(effect || '').match(/([+-]\d+(?:\.\d+)?)\s*%/);
    return s ? [parseFloat(s[1]) / 100, parseFloat(s[1]) / 100] : null;
  }
  // The same sentence off the SITE's board — for a reader with no saved league,
  // and for one who saved a league but has never built a board. They are the
  // readers least able to translate a bare percentage themselves, so they get
  // the most of it: what the call is worth in dollars, what share of a manager's
  // budget that is, AND the draft-slot move — because there is no way to know
  // which of the two they came for, and guessing one would be worse than
  // printing both.
  //
  // Whose dollars those are is the whole question here. The board's own prices
  // are the desk's, and they stay that way — boardRatio() reads the same rows.
  // But a reader who HAS saved a league told us their budget and their league
  // size, and that is the entire content of an auction price: the sentence is
  // restated into their money by leagueScale() and names their league, exactly
  // as the lead's prices are. Quoting them $200 dollars because their board is
  // missing would be answering a question they already answered.
  //
  // What it does NOT claim is their scoring. Without a saved board there are no
  // stat lines to re-score, so the RANKS below are the site's, at the site's
  // scoring — which is why the copy names the league (teams and budget) and
  // never the rules. A reader with a board gets the real thing, in tailor().
  //
  // The percentage is the durable half: a dollar figure is only true at one
  // budget, but "4% of a budget" is true in every auction league there is. It is
  // computed from the raw share, not from the rounded dollars, so the two never
  // disagree at the rounding boundary.
  function tailorDefault(r, name, position) {
    var b = defaultBoard();
    if (!b.players.length) return '';
    var p = playerInText(name, position, b) || findPlayer(name, position, b);
    if (!p) return '';
    if ((p.v || 0) < 1) return '';
    // The reader's money when they have said what it is, the desk's when they
    // have not. k is 1 in the second case, so nothing here moves for them.
    var k = leagueScale();
    var teams = cfg ? cfg.teams : DEFAULT_TEAMS, budget = cfg ? cfg.budget : DEFAULT_BUDGET;
    var v = deskPrice(p.v);
    var lo = Math.min(r[0], r[1]), hi = Math.max(r[0], r[1]);
    var up = (lo + hi) / 2 > 0;
    var d1 = Math.max(1, Math.round(Math.abs(lo) * v)), d2 = Math.max(1, Math.round(Math.abs(hi) * v));
    if (d2 < d1) { var t = d1; d1 = d2; d2 = t; }
    var rng = d1 === d2 ? ('$' + d2) : ('$' + d1 + '\u2013$' + d2);

    // Share of ONE manager's budget, which is what a reader spends. Sub-1%
    // rounds to "under 1%" rather than to a bare 0, which would read as "no
    // effect" when the dollars beside it plainly say otherwise.
    var q1 = Math.abs(lo) * v / budget * 100, q2 = Math.abs(hi) * v / budget * 100;
    var qa = Math.round(Math.min(q1, q2)), qb = Math.round(Math.max(q1, q2));
    qa = Math.max(1, qa);
    var pct = qb < 1 ? 'under 1% of a budget'
            : qa >= qb ? qb + '% of a budget'
            : qa + '\u2013' + qb + '% of a budget';

    var m1 = slotMove(p, lo, b), m2 = slotMove(p, hi, b);
    var sa = Math.min(m1.slots, m2.slots), sb = Math.max(m1.slots, m2.slots);
    var far = m2.slots >= m1.slots ? m2.target : m1.target;
    var slots = slotPhrase(p, far, sa, sb, teams, budget, 'draft slot', k).text ||
      'less than one draft slot';
    var where = cfg ? label('auction') : 'a ' + DEFAULT_TEAMS + '-team, $' + DEFAULT_BUDGET + ' league';
    return p.n + ' prices at $' + v + ' in ' + where + ' \u2014 ' +
      (up ? 'worth about ' : 'trim about ') + rng + ', ' + pct + ', or ' + slots + '.';
  }

  // The whole point of the file, in one sentence of copy: what this call is
  // worth on the reader's own sheet, in their dollars or their draft slots.
  // formatOverride lets a page that offers a format switcher (my-insights, and
  // the front page's Position Intel) ask for the same call read as an auction, a
  // snake draft or best ball without touching the reader's saved league.
  function tailor(effect, name, position, formatOverride) {
    var r = pctRange(effect);
    if (!r) return '';
    if (!cfg || !snap) return tailorDefault(r, name, position);
    var fmt = formatOverride || cfg.format;
    // Whole-name containment first: callers pass free text (a headline as often
    // as a name field), and findPlayer's last-name fallback would happily read
    // "...is a reputation trap" as some player called Trap. playerInText only
    // ever matches a full name, so it is the safe reading of a sentence.
    var p = playerInText(name, position) || findPlayer(name, position);
    if (!p) return '';
    var lo = Math.min(r[0], r[1]), hi = Math.max(r[0], r[1]);
    var up = (lo + hi) / 2 > 0;
    if (fmt === 'auction') {
      var v = p.v || 0;
      if (v < 1) return '';
      var d1 = Math.max(1, Math.round(Math.abs(lo) * v)), d2 = Math.max(1, Math.round(Math.abs(hi) * v));
      if (d2 < d1) { var t = d1; d1 = d2; d2 = t; }
      var rng = d1 === d2 ? ('$' + d2) : ('$' + d1 + '–$' + d2);
      return p.n + ' is $' + v + ' on your sheet — ' +
        (up ? 'worth about ' + rng + ' more in ' + label(fmt) + '.' : 'trim about ' + rng + ' off in ' + label(fmt) + '.');
    }
    var m1 = slotMove(p, lo), m2 = slotMove(p, hi);
    var a = Math.min(m1.slots, m2.slots), b = Math.max(m1.slots, m2.slots);
    var far = m2.slots >= m1.slots ? m2.target : m1.target;
    var phrase = slotPhrase(p, far, a, b, cfg.teams, cfg.budget, 'slot');
    if (!phrase.text) return 'In ' + label(fmt) + ' the shift is less than one draft slot — treat it as a hold.';
    if (phrase.endgame) return 'In ' + label(fmt) + ' that is ' + phrase.text + ' for ' + p.n + '.';
    return 'Move ' + p.n + (up ? ' up ' : ' down ') + phrase.text + ' in ' + label(fmt) + '.';
  }

  // Which of the two lines tailor() just handed back, so a page can label it
  // truthfully. "Your league" over the desk's own dollars would be the one lie
  // this whole file exists to avoid — but a reader with a saved league is no
  // longer shown those: with or without a board of their own, the dollars in the
  // line are at their budget and the copy names their league. Without a league
  // there is nothing to call theirs, and the label says so.
  function tailorLabel() { return cfg ? 'Your league' : 'Default league'; }

  // ── stories written before the scoring changed ────────────────────────────
  // repriceCopy converts a price between LEAGUES. It cannot convert one between
  // MODELS, and on 2026-08-23 the site changed model under the story writer's
  // feet: receptions went from half a point to a full one.
  //
  // Story 29 is what that looked like on the front page. It priced Zay Flowers
  // at $26 on its own half-PPR board and argued for $32. THIS board, at full
  // PPR, prices him at $20 and a reader's board at $21, so repriceCopy
  // multiplied by 21/20 and printed "bid $34, not the sheet's $27" above a
  // cheat sheet reading $21. The ratio was applied correctly. The input was
  // never on this board's scale, and nothing here checked that it was.
  //
  // The real fix is upstream and is being made there: a story's prices are
  // computed with the SAME market curve this file prices the cheat sheet with,
  // so a story's number for a player and the sheet's number for him track each
  // other, and this ratio has two comparable sides to work with.
  //
  // Every story is still restated into the reader's league, because a price in
  // a league nobody plays helps nobody. What this flag does is add one sentence
  // to the note over the older ones: their scoring is not this board's, so they
  // can disagree with the reader's cheat sheet for a reason the reader can now
  // see rather than one they have to guess at.
  var MODEL_EPOCH = Date.UTC(2026, 7, 23);
  function staleModel(at) {
    var t = num(at, 0);
    return t > 0 && t < MODEL_EPOCH;
  }


  // ── the desk's dollars, in the reader's league ────────────────────────────
  // The generated lead (front.html, /lead) is written by a scheduled run at ONE
  // league: 12 teams, $200, the site's own default scoring. It quotes real
  // dollars in its headline and dek — "bid $32, not the sheet's $26" — and every
  // one of them is wrong for a reader who plays $300, or 10 teams, or half PPR.
  // The story cannot know who is reading it. This does.
  //
  // Two different corrections, and the difference matters:
  //   * A dollar attached to a NAMED PLAYER is re-anchored on that player's own
  //     price on the reader's board. That board was priced at their scoring, so
  //     this carries scoring, budget and league size at once — a full-PPR back
  //     and a standard-scoring back are not the same player, and no amount of
  //     budget scaling would say so.
  //   * A dollar attached to nobody (a pool, a tier, a gap) is scaled by the
  //     money in the room, (teams x budget), which is what every price on an
  //     auction board scales by.
  // Nothing is invented: with no saved league this returns null and the copy
  // ships exactly as the desk wrote it, labelled as the desk's own league.
  // Both sides of this ratio must be the SAME COLUMN of the same kind of board,
  // or it is not a conversion at all. It used to divide the reader's True Value
  // by the site's Market Price and multiply a story's dollars by the result,
  // which is how "$38 for Derrick Henry" reached a reader whose own row said
  // $23. Now both sides are Market Price: the reader's is copied off the sheet
  // the app already built at their slider, scoring, budget and team count, and
  // the site's is the same column on the site's own board.
  //
  // The consequence worth keeping in mind: a story's sheet figure lands on the
  // reader's own number exactly, because siteFigure x (readerPrice / siteFigure)
  // is readerPrice. That is the whole point — the number on the page and the
  // number on their sheet are the same number, not two calculations that were
  // supposed to agree.
  function boardRatio(name) {
    if (!minePrices) return 0;
    var site = defaultBoard();
    var sp = findPlayer(name, null, site);
    var mp = mine ? findPlayer(name, null, mine) : null;
    if (!sp || !mp) return 0;
    var a = sp.v || 0, b = mp.v || 0;
    if (a < 1 || b < 1) return 0;
    return b / a;
  }
  // What the reader's own sheet prints for this player, or 0 when there is no
  // sheet to read. Pulled, never recomputed: the app has already done this sum
  // at their settings and a second attempt is only a second chance to disagree.
  function sheetPrice(name) {
    if (!minePrices || !mine) return 0;
    var mp = findPlayer(name, null, mine);
    return mp ? (mp.v || 0) : 0;
  }
  // The money in the room, relative to the room the desk writes for.
  function leagueScale() {
    return cfg ? (cfg.teams * cfg.budget) / (DEFAULT_TEAMS * DEFAULT_BUDGET) : 1;
  }
  // One price off the SITE's board, in the reader's money — the going rate that
  // board quotes, at the budget they actually spend. The board itself is left at
  // the desk's prices because boardRatio() reads it; this is the one place the
  // conversion lives, so a tile and a sentence quoting the same row cannot
  // disagree. Unchanged for a reader with no league, who is quoted the desk's.
  function deskPrice(v) {
    var n = num(v, 0);
    if (n < 1) return 0;
    return Math.max(MIN_BID, Math.round(n * leagueScale()));
  }
  function reEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Every place a story's named players are mentioned, with the ratio each one's
  // dollars move by. Surnames count as mentions — a dek names a player once in
  // full and then calls him "Henry" — but only when exactly one player in the
  // story carries that surname, because "Williams" against two Williamses would
  // price one of them off the other's board slot.
  // Names the copy uses that the story never listed. `players` carries at most
  // the four the story commits to, and a dek routinely prices a fifth in
  // passing ("...Garrett Wilson at $26 and DeVonta Smith at $26"). Left
  // undiscovered, that fifth player's dollars get attributed to the name before
  // him, which prices one player off another's board slot. Cheap to avoid: pull
  // the capitalised two- and three-word runs out of the copy and keep the ones
  // the reader's own board can name.
  function scanNames(text) {
    var re = /\b[A-Z][A-Za-z'\u2019.\-]+(?:\s+[A-Z][A-Za-z'\u2019.\-]+){1,2}/g;
    var out = [], seen = {}, m;
    while ((m = re.exec(String(text)))) {
      var words = m[0].split(/\s+/);
      for (var take = words.length; take >= 2; take--) {
        var cand = words.slice(0, take).join(' ');
        if (seen[cand]) break;
        if (mine && mine.byName[normName(cand)]) { seen[cand] = 1; out.push(cand); break; }
      }
    }
    return out;
  }
  function mentions(text, names) {
    var hay = String(text).toLowerCase(), out = [], surnames = {};
    var all = (names || []).slice();
    scanNames(text).forEach(function (n) {
      var dup = all.some(function (x) { return normName(x) === normName(n); });
      if (!dup) all.push(n);
    });
    names = all;
    (names || []).forEach(function (n) {
      var k = lastNameKey(n);
      if (k) surnames[k] = (surnames[k] || 0) + 1;
    });
    (names || []).forEach(function (n) {
      var r = boardRatio(n);
      if (!r) return;
      var full = String(n || '').trim();
      if (!full) return;
      var forms = [full];
      var k = lastNameKey(full);
      // Suffix off first: the last word of "Kenneth Walker III" is not his name.
      var bare = full.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').replace(/[.,]/g, ' ').trim().split(/\s+/);
      if (k && surnames[k] === 1 && bare.length > 1) forms.push(bare[bare.length - 1]);
      forms.forEach(function (f) {
        var re = new RegExp('\\b' + reEscape(f.toLowerCase()) + '\\b', 'g'), m;
        while ((m = re.exec(hay))) out.push({ at: m.index, end: m.index + f.length, ratio: r, who: full });
      });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }
  // A period inside a name is not the end of a sentence. The desk writes "J.K.
  // Dobbins", "A.J. Brown" and "Amon-Ra St. Brown", and a sentence cut inside a
  // player's own name leaves his dollars with no name in front of them to own
  // them: "Cap A.J. Brown at $25 and Chase Brown at $20" used to start its
  // sentence at "Brown at $25", drop A.J. out of range, and hand his figure
  // forward to the other Brown. Two tests for that, in this order:
  //   * the mention spans themselves, which is exact and covers "St." and the
  //     "Jr." that ends a name, for every player the copy actually names;
  //   * a single letter before the dot, which catches an initial in a name
  //     nobody's board can price. Deliberately not two letters: an English
  //     sentence can end in "is." and would be swallowed whole.
  function inName(spans, at) {
    for (var i = 0; i < (spans || []).length; i++) {
      if (at > spans[i].at && at < spans[i].end) return true;
    }
    return false;
  }
  function abbrevDot(text, at, spans) {
    if (text.charAt(at) !== '.') return false;
    return inName(spans, at) || /(^|[^A-Za-z])[A-Za-z]$/.test(text.slice(0, at));
  }
  // Where the sentence holding `at` begins, so a dollar figure is only ever
  // attributed to a player named in its own sentence. "Cap Drake London at $29,
  // Garrett Wilson at $26" has to give each figure to the player beside it, and
  // a name three sentences up is not that.
  function sentenceStart(text, at, spans) {
    var re = /[.!?]\s+/g, start = 0, m;
    while ((m = re.exec(text)) && m.index < at) {
      if (abbrevDot(text, m.index, spans)) continue;
      start = m.index + m[0].length;
    }
    return start;
  }
  function sentenceEnd(text, at, spans) {
    var re = /[.!?](\s|$)/g, m;
    re.lastIndex = at;
    while ((m = re.exec(text))) {
      if (abbrevDot(text, m.index, spans)) continue;
      return m.index;
    }
    return text.length;
  }
  // A dollar figure is BOUND to a name when nothing but a linking word stands
  // between the two, and that binding reads in both directions: "McMillan to
  // $33" and "$33 on McMillan" are the same claim about the same player.
  //
  // The lead of 2026-08-23 is what it costs to understand only the first one.
  // Its dek read "Cap J.K. Dobbins at $12 and Jadarian Price at $13; bid up to
  // $33 on Tetairoa McMillan and $44 on Justin Jefferson", and because every
  // figure was handed to the player named BEFORE it, McMillan's $33 was
  // restated off Price's board slot as $7 and Jefferson's $44 off McMillan's as
  // $48. The headline says the same thing name-first, so it restated McMillan
  // correctly at $36. One story, one player, two prices, on the front page.
  //
  // "and" is deliberately not a linking word. "$33 on McMillan and $44 on
  // Jefferson" is two bindings rather than one running on, and reading "and" as
  // a link is the same off-by-one in a different coat.
  var LINK_BACK = /^[\s,;:]*(?:up\s+to|at|to|for|of|near|around|about)?[\s,;:]*$/;
  var LINK_FWD = /^[\s,;:]*(?:on|for|to|upon)\s+/;
  // Two or more capitalised words: shaped like a person, whoever it turns out
  // to be. Used only to tell "$33 on Tetairoa McMillan" from "$12 to the
  // quarterback pool".
  var NAME_RUN = /^[A-Z][A-Za-z'\u2019.\-]+(?:\s+[A-Z][A-Za-z'\u2019.\-]+)+/;
  // Restate one piece of the desk's copy — a headline, a dek, a whole article —
  // in the reader's money. Returns null when there is nothing to say: no saved
  // league, no dollars in the copy, or a reader whose league prices the story
  // the same way the desk already did.
  function repriceCopy(text, names, at) {
    if (!cfg || !text) return null;
    var src = String(text);
    if (!/\$\s?\d/.test(src)) return null;
    var anchors = mentions(src, names);
    var scale = leagueScale();
    var out = '', last = 0, changed = 0, anchored = 0;
    var re = /\$\s?(\d{1,4})\b/g, m;
    while ((m = re.exec(src))) {
      var n = parseInt(m[1], 10);
      var ratio = 0;
      if (anchors.length) {
        var lo = sentenceStart(src, m.index, anchors), hi = sentenceEnd(src, m.index, anchors), i, a;
        var after = m.index + m[0].length, fwd, at;
        // 1. Bound backwards, and only to the NEAREST name before it, because
        //    "Drake London at $29, Garrett Wilson at $26" gives each figure to
        //    the player beside it and to no one further up the line.
        for (i = anchors.length - 1; i >= 0; i--) {
          a = anchors[i];
          if (a.end <= m.index && a.at >= lo) {
            if (LINK_BACK.test(src.slice(a.end, m.index))) ratio = a.ratio;
            break;
          }
        }
        // 2. Bound forwards: "bid up to $33 on Tetairoa McMillan". A figure
        //    written price-first belongs to the name it points at, not to
        //    whoever the sentence happened to mention before it.
        if (!ratio) {
          fwd = LINK_FWD.exec(src.slice(after, hi));
          if (fwd) {
            at = after + fwd[0].length;
            for (i = 0; i < anchors.length; i++) {
              if (anchors[i].at === at) { ratio = anchors[i].ratio; break; }
            }
            // Bound to somebody the reader's board cannot price. That figure is
            // still his and nobody else's, so it scales with the money in the
            // room rather than falling back onto the previous name's board
            // slot, which is the misattribution this whole block exists to
            // stop. -1 says "settled, unanchored" and reads as scale below.
            if (!ratio && NAME_RUN.test(src.slice(at, hi))) ratio = -1;
          }
        }
        // 3. Bound to nothing: the nearest name in its own sentence owns it,
        //    the one before it first, then the one after ("$32 is the bid on
        //    Flowers" opens its own sentence and falls forward).
        if (!ratio) {
          for (i = anchors.length - 1; i >= 0; i--) {
            if (anchors[i].at < m.index && anchors[i].at >= lo) { ratio = anchors[i].ratio; break; }
          }
        }
        if (!ratio) {
          for (i = 0; i < anchors.length; i++) {
            if (anchors[i].at > m.index && anchors[i].at <= hi) { ratio = anchors[i].ratio; break; }
          }
        }
        if (ratio > 0) anchored++;
      }
      if (ratio <= 0) ratio = scale;
      var v = Math.max(MIN_BID, Math.round(n * ratio));
      out += src.slice(last, m.index) + '$' + v;
      last = m.index + m[0].length;
      if (v !== n) changed++;
    }
    out += src.slice(last);
    if (!changed) return null;
    return { text: out, changed: changed, anchored: anchored, source: src };
  }
  // What league the dollars a reader is looking at belong to, said out loud.
  // The generated lead quotes prices with no percentage in sight, so tailor()'s
  // machinery has nothing to translate; what a reader needs instead is to know
  // whose league the number is for — which is the complaint that started this:
  // the front page was quoting $26 to a reader whose own sheet says $39.
  //
  // A reader who HAS saved a league is only ever told their own numbers. The
  // note used to append "the desk writes at 12 teams, $200, full PPR", and that
  // second league is what made the card unreadable: a reader on a $120 budget
  // was handed one set of prices and, in the same breath, a budget those prices
  // are not in, with nothing on screen priced at it. The desk's league is the
  // machinery, not the reading — so it is named only to the reader who is
  // actually being shown the desk's dollars, which is the reader with no league.
  //
  // `restated` is whether repriceCopy() actually moved the numbers. It only
  // chooses the verb: "restated" is a claim that something happened, and over
  // untouched figures it would be a lie in the other direction.
  function pricingNote(restated, at) {
    // A reader with no league of their own is shown the site's default league,
    // and it is named in full rather than called "the default": a reader cannot
    // check a price against a league nobody has described to them.
    var note = !cfg
      ? 'These prices are for the site\u2019s default league: ' + DEFAULT_TEAMS + ' teams, $'
        + DEFAULT_BUDGET + ', full PPR. Set up your own and every price here is restated in your money.'
      : (restated ? 'Restated for ' : 'Priced for ')
        + label('auction') + (snap ? ', ' + scoringLabel() : '') + '.';
    // An older story was written when this site scored a catch at half a point.
    // Its prices are still restated into the reader's league, but they came off
    // a differently scored board, so they can sit above a cheat sheet that
    // disagrees with them. Say that plainly instead of leaving them to wonder.
    if (staleModel(at)) {
      note += ' This story was written before the site changed its scoring on 23 August,'
        + ' so its prices can differ from your cheat sheet.';
    }
    return note;
  }

  // One stylesheet for the "Your league:" line, injected rather than copied into
  // forty pages' <style> blocks. It has to sit on the light front page and the
  // dark drop pages alike, so it borrows the reader's text colour and paints
  // only a translucent teal wash and rule — no palette assumptions beyond the
  // --teal token every page already defines, and a literal fallback if it does not.
  var STYLE_ID = 'it-league-css';
  function ensureStyle() {
    var doc = root.document;
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = '.it-yours{margin:6px 0 0;padding:6px 10px;font-size:12.5px;font-style:normal;' +
      'line-height:1.45;border-left:3px solid var(--teal,#2dd4a3);border-radius:0 4px 4px 0;' +
      'background:rgba(45,212,163,0.09)}' +
      '.it-dollars{color:var(--teal,#2dd4a3);font-weight:700;white-space:nowrap}';
    doc.head.appendChild(el);
  }

  // ── declarative rewrites, for pages that only need a number swapped ───────
  // A guide that says "in a $200, 12-team league" marks the figures up as
  // data-it-money / data-it-teams and this restates them in the reader's league.
  // Untouched when there is no league — the printed default is still true.
  // `scope` narrows WHAT is rewritten (a freshly rendered subtree, say); the
  // document is still what creates nodes, because an element is not a factory.
  function applyMarkup(scope) {
    if (!cfg) return;
    ensureStyle();
    var doc = root.document;
    var where = scope || doc;
    if (!doc || !where || !where.querySelectorAll) return;
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-money]'), function (el) {
      var v = money(el.getAttribute('data-it-money'));
      if (v > 0) el.textContent = '$' + v;
    });
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-teams]'), function (el) {
      el.textContent = String(cfg.teams);
    });
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-league]'), function (el) {
      el.textContent = label();
    });
    // Allocation copy is written in percentages because a percentage is true in
    // every league. What it BUYS is not: 38% is $76 at $200 and $114 at $300.
    // data-it-pct="38-42" prints the reader's own band beside the percentage.
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-pct]'), function (el) {
      if (el.getAttribute('data-it-filled')) return;
      var band = String(el.getAttribute('data-it-pct') || '').split('-');
      var lo = num(band[0], NaN), hi = num(band.length > 1 ? band[1] : band[0], NaN);
      if (!isFinite(lo) || !isFinite(hi)) return;
      var d1 = Math.round(cfg.budget * Math.min(lo, hi) / 100);
      var d2 = Math.round(cfg.budget * Math.max(lo, hi) / 100);
      var span = doc.createElement('span');
      span.className = 'it-dollars';
      span.textContent = ' (' + (d1 === d2 ? '$' + d2 : '$' + d1 + '\u2013$' + d2) + ')';
      el.parentNode.insertBefore(span, el.nextSibling);
      el.setAttribute('data-it-filled', '1');
    });
  }

  // Insight drop pages carry their calls as <p class="statline">Projected
  // effect: ...</p> under the call's <h2>. Any of them that quantified itself
  // gets the reader's own translation appended, once, on load.
  function tailorStatlines(scope) {
    var doc = root.document;
    var where = scope || doc;
    if (!doc || !where || !where.querySelectorAll) return 0;
    ensureStyle();
    var n = 0;
    Array.prototype.forEach.call(where.querySelectorAll('p.statline'), function (el) {
      if (el.getAttribute('data-it-tailored')) return;
      var call = el.closest ? el.closest('.call') : null;
      var host = call || el.parentNode;
      var h = host && host.querySelector ? host.querySelector('h2') : null;
      var posEl = call && call.querySelector ? call.querySelector('.cpos') : null;
      var pos = posEl ? (posEl.textContent || '').trim() : '';
      // The player can be in the headline (the insight drops name him there) or
      // in a "Who it moves" line (the coaching column's headlines name the
      // COACH, and the player only appears underneath). Search both, headline
      // first, so a call is never left untranslated because of where its
      // subject happens to sit.
      var whoEl = host && host.querySelector ? host.querySelector('p.who') : null;
      var subject = ((h ? h.textContent : '') + ' \u00b7 ' + (whoEl ? whoEl.textContent : '')).trim();
      var line = tailor(el.textContent, subject, pos, readingFormat());
      if (!line) return;
      var d = doc.createElement('p');
      d.className = 'it-yours';
      d.innerHTML = '<b>' + tailorLabel() + ':</b> ' + line.replace(/[&<>]/g, function (c) {
        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
      });
      el.parentNode.insertBefore(d, el.nextSibling);
      el.setAttribute('data-it-tailored', '1');
      n++;
    });
    return n;
  }

  root.ITLeague = {
    has: !!cfg,
    hasBoard: !!snap,
    custom: custom,
    customScoring: customScoring,
    customLeague: customLeague,
    config: cfg,
    defaults: { teams: DEFAULT_TEAMS, budget: DEFAULT_BUDGET, scoring: SCORING_DEFAULTS, curve: CURVE, curveBudget: CURVE_BUDGET },
    score: score,
    price: price,
    money: money,
    rankOf: rankOf,
    findPlayer: findPlayer,
    playerInText: playerInText,
    slotsMoved: slotsMoved,
    pctRange: pctRange,
    tailor: tailor,
    tailorLabel: tailorLabel,
    staleModel: staleModel,
    sheetPrice: sheetPrice,
    onBoard: onBoard,
    boardIsServed: function () { return !!served; },
    vegasWeight: function () { return cfg ? cfg.vegasWeight : VEGAS_DEFAULT_W; },
    repriceCopy: repriceCopy,
    pricingNote: pricingNote,
    leagueScale: leagueScale,
    deskPrice: deskPrice,
    defaultBoard: function () { return defaultBoard().players; },
    readingFormat: readingFormat,
    setReadingFormat: setReadingFormat,
    formatFromLeague: formatFromLeague,
    edition: edition,
    setEdition: setEdition,
    editionFromLeague: editionFromLeague,
    label: label,
    scoringLabel: scoringLabel,
    ensureStyle: ensureStyle,
    applyMarkup: applyMarkup,
    tailorStatlines: tailorStatlines
  };

  // Pages opt in by including this file; the two auto-passes are safe no-ops on
  // a page with neither the markup nor a statline.
  function boot() { if (cfg) ensureStyle(); applyMarkup(); tailorStatlines(); }
  if (root.document) {
    // Paint the rule as early as the document allows: a page that renders its
    // own "Your league" lines from an inline script runs before DOMContentLoaded,
    // and an unstyled flash is a worse first impression than a slow one.
    if (cfg) ensureStyle();
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
