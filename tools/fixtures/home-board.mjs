// A week board shaped like boardsPayload's, for the homepage examples
// (docs/growth-plan.md, Phase 3). Read by tools/test-home-examples.mjs and
// tools/test-homepage.mjs. Every player below the three that qualify is here
// to fail exactly one of homeExamples' rules, and is named for the rule.
//
// Points are not on the rows on purpose: the worker scores the stat lines at
// each preset, so a fixture `points` field would only be something to ignore.

const KICK = Date.UTC(2026, 9, 18, 17, 0);           // Sun 10/18, 1:00 PM ET
export const UPDATED = { board: Date.UTC(2026, 9, 17, 18, 13), odds: Date.UTC(2026, 9, 17, 11, 0) };
export const SEEN = Date.UTC(2026, 9, 17, 16, 40);    // Sat 10/17, 12:40 PM ET

function pl(name, position, team, opponent, cons, veg, o = {}) {
  const w = { week: 6, opponent, home: !!o.home, kickoff: KICK, status: 'scheduled', gameState: o.gameState || 'upcoming',
    bye: !!o.bye, out: !!o.out,
    vegasProjection: { status: o.vpStatus || 'full', missing: o.missing || [], books: o.books == null ? 6 : o.books, priced: ['rec', 'recYd'] } };
  return {
    name, position, pos: position, team, key: name.toLowerCase().replace(/[^a-z]/g, '') + '|' + position, games: 1, byes: o.bye ? [6] : [],
    weeks: [w], injury: o.injury ? { status: o.injury } : null, ...(o.marketOut ? { marketOut: { week: 6, status: 'out' } } : {}),
    consensus: { stats: cons, rank: o.cRank || 10 }, vegas: { stats: veg, basis: o.basis || 'props', confidence: 'HIGH', rank: o.vRank || 10 },
    ironTuna: { stats: o.it || cons, confidence: 'HIGH', rank: 10 }
  };
}

const BIG_C = { rec: 5, recYd: 60 }, BIG_V = { rec: 8, recYd: 100 };   // +7.0 at PPR: would lead if allowed

export function homeBoard() {
  const players = [
    // The three that qualify at PPR, widest first: +5.0, -4.8, +3.8.
    pl('Drake London', 'WR', 'ATL', 'CAR', { rec: 5, recYd: 60 }, { rec: 7, recYd: 90 }, { home: true }),
    pl('Derrick Henry', 'RB', 'BAL', 'CIN', { rushYd: 90, rushTD: 0.8 }, { rushYd: 60, rushTD: 0.5 }),
    pl('Goal Line Back', 'RB', 'DET', 'GB', { rushYd: 40, rushTD: 0.3 }, { rushYd: 42, rushTD: 0.9 }),
    // Qualifies (+2.4, 16.7%) and is fourth: the cap is three.
    pl('Cam Ward', 'QB', 'TEN', 'IND', { passYd: 220, passTD: 1.4 }, { passYd: 260, passTD: 1.6 }),
    // A disagreement at Standard only: the catches it loses cancel the yards at PPR.
    pl('Yards Guy', 'WR', 'SEA', 'LAR', { rec: 8, recYd: 50 }, { rec: 6, recYd: 85 }),
    // One rule each.
    pl('Questionable Runner', 'RB', 'PHI', 'JAX', BIG_C, BIG_V, { injury: 'Questionable' }),
    pl('Priced Out Wideout', 'WR', 'PHI', 'JAX', BIG_C, BIG_V, { marketOut: true }),
    pl('Partly Priced', 'WR', 'NYG', 'DAL', BIG_C, BIG_V, { vpStatus: 'partial' }),
    pl('Missing Market', 'WR', 'NYG', 'DAL', BIG_C, BIG_V, { missing: ['recYd'] }),
    pl('Game Lines Only', 'WR', 'MIA', 'BUF', BIG_C, BIG_V, { basis: 'gamelines' }),
    pl('One Book', 'WR', 'MIA', 'BUF', BIG_C, BIG_V, { books: 1 }),
    pl('Promoted Backup', 'QB', 'CHI', 'GB', { passYd: 20, passTD: 0.1 }, { passYd: 240, passTD: 1.5 }),
    pl('Kicked Off', 'WR', 'DEN', 'KC', BIG_C, BIG_V, { gameState: 'in_progress' }),
    pl('Bye Week', 'WR', 'CLE', 'BYE', BIG_C, BIG_V, { bye: true }),
    pl('Listed Out', 'WR', 'CLE', 'PIT', BIG_C, BIG_V, { out: true }),
    pl('Small Gap', 'WR', 'NO', 'TB', { rec: 5, recYd: 60 }, { rec: 5, recYd: 75 }),
    pl('Deep Bench', 'WR', 'NO', 'TB', BIG_C, BIG_V, { cRank: 60, vRank: 55 }),
    pl('No Quoted Line', 'WR', 'ARI', 'SF', BIG_C, BIG_V),
    pl('Kicker Guy', 'K', 'ARI', 'SF', BIG_C, BIG_V),
    pl('Active Receiver', 'TE', 'KC', 'LV', { rec: 4, recYd: 40 }, { rec: 4, recYd: 40 }, { injury: 'Active' }),
    pl('<b>Escaped</b>', 'TE', 'KC', 'LV', { rec: 4, recYd: 40 }, { rec: 4, recYd: 40 })
  ];
  // Forty healthy flex players with no disagreement at all, so the sample My
  // Week has a pool to choose its two from: Iron Tuna projects Filler 0 the
  // highest, Filler 39 the lowest, a fifth of a point apart and all above
  // everyone else on the board, except Fillers 30 to 33, who project exactly
  // Filler 29's figure: FLEX 34 then ties FLEX 30 and is passed over for the
  // first one down who projects less, Filler 34.
  for (let k = 0; k < 40; k++) {
    const yd = k >= 29 && k <= 33 ? 300 - 29 * 2 : 300 - k * 2;
    players.push(pl('Flex Filler ' + k, 'WR', 'T' + (k % 16), 'OPP', { rec: 0, recYd: 30 }, { rec: 0, recYd: 30 }, { it: { rec: 0, recYd: yd }, cRank: 70, vRank: 70 }));
  }
  return {
    ok: true, contract: 1, horizon: { key: 'week', label: 'This Week', weeks: [6], through: null }, season: 2026, currentWeek: 6,
    scoring: { preset: 'ppr', label: 'PPR' },
    delta: { strongRank: 8, leanRank: 3, strongPct: 0.15, leanPct: 0.05, minPointsStrong: 2, minPointsLean: 0.6,
      classes: ['STRONG VEGAS BUY', 'VEGAS LEANS HIGHER', 'MARKET AGREES', 'VEGAS LEANS LOWER', 'STRONG VEGAS FADE'] },
    prominentBand: { QB: 12, RB: 24, WR: 24, TE: 12 }, players, updated: { ...UPDATED }, played: 0, absent: []
  };
}

// The week's quoted lines, as marketHistoryWeek returns them: keyed by the
// store's normalised name (pass the worker's _oddsNorm), one history per market.
export function homeMarkets(norm) {
  const line = (current, books) => ({ current, median: current, books, lastSeen: SEEN, tdCurrentProbability: null });
  const td = (p, books) => ({ current: 1, books, lastSeen: SEEN, tdCurrentProbability: p });
  const big = { recYd: line(99.5, 6), rec: line(7.5, 6) };
  const m = {
    'Drake London': { recYd: line(89.5, 6), rec: line(6.5, 6) },
    'Derrick Henry': { rushYd: line(59.5, 7), anytimeTD: td(38.1, 4) },
    'Goal Line Back': { rushYd: line(41.5, 5), anytimeTD: td(55.2, 4) },
    'Cam Ward': { passYd: line(259.5, 6), passTD: line(1.5, 6) },
    'Yards Guy': { recYd: line(84.5, 6), rec: line(5.5, 6) },
    'Questionable Runner': big, 'Priced Out Wideout': big, 'Partly Priced': big, 'Missing Market': big, 'Game Lines Only': big,
    'One Book': big, 'Promoted Backup': { passYd: line(239.5, 6) }, 'Kicked Off': big, 'Bye Week': big, 'Listed Out': big,
    'Small Gap': big, 'Deep Bench': big, 'Kicker Guy': big
  };
  const out = {};
  for (const [name, v] of Object.entries(m)) out[norm(name)] = v;
  return out;
}
