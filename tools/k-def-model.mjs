// What the market's team totals say a kicker and a defence are worth.
//
// Neither position has a season-long prop market, so nothing here comes from a
// player line. Both are made almost entirely of team scoring environment, and
// the game lines price that directly (tools/team-market.mjs), so the same file
// that moves a running back's touchdowns can move a kicker's extra points and a
// defence's points allowed.
//
// ── Every constant below was measured, not chosen ───────────────────────────
// Fitted over the 64 real team-seasons in nflverse stats_team_reg_2024.csv and
// stats_team_reg_2025.csv, against each club's actual points scored:
//
//   pat_made = -17.0  + 0.1396 * points      r = 0.96
//   fg_made  =  24.3  + 0.0126 * points      r = 0.15
//   fg_att   =  29.7  + 0.0120 * points      r = 0.14
//
// Extra points are very nearly a restatement of the team total. FIELD GOALS ARE
// NOT: a kicker on a bad offence trades touchdowns for field goals, so the two
// effects cancel and team quality explains almost nothing about make volume.
// Any kicker board with a wide spread in projected field goals is asserting a
// signal that is not in the data.
//
// Year-over-year club correlation, 2024 -> 2025, is the second measurement, and
// it is what sets how much of a committed line survives the shrink:
//
//   points allowed 0.45 (and -0.03 from 2023 -> 2024)   def sacks       0.33
//   fg_made        0.33                                 def ints        0.13
//   pat_made       0.31                                 fumble rec.     0.01
//
// A projection is an EXPECTATION, so its spread has to be narrower than the
// spread of outcomes by roughly that factor. Carrying the full outcome spread —
// a 318-to-520 points-allowed board, a 22-to-36 field-goal board — sells noise
// as information.
//
// HAND-SYNCED with the "team market ratings" block in _worker.js. Change one,
// change both; tools/test-team-market.mjs runs the two side by side.

// ── league level, from the same 64 team-seasons ─────────────────────────────
export const LEAGUE = {
  points: 391,          // mean points scored / allowed per club per season
  fgMade: 29.5,
  fgPct: 0.85,          // 84.0% in 2024, 85.6% in 2025
  xpPct: 0.958,
  sacks: 40.4,          // 40.8 and 39.9
  fumRec: 8.0,          // 8.4 and 7.7
  defTD: 1.5,           // 48 and 47 league-wide, over 32 clubs
  takeaways: 20.0       // ints + fumble recoveries
};

// ── kicker ──────────────────────────────────────────────────────────────────
export const K_MODEL = {
  xpA: -17.0, xpB: 0.1396,   // extra points from the implied team total (r=0.96)
  fgA: 24.3,  fgB: 0.0126,   // field goals barely move with it (r=0.15)
  // How much of the committed line survives the market anchor. Extra points are
  // the market's to call; make volume and accuracy are the kicker's own, so the
  // site's view of a leg keeps more weight there.
  xpOwnView: 0.25,
  fgOwnView: 0.35,
  // A projected make rate is an expectation, and no starting kicker's
  // expectation is a 74% season. The floor is roughly two points of accuracy
  // below the league rate; the ceiling stops one good year becoming a forecast.
  pctOwnView: 0.35, pctMin: 0.82, pctMax: 0.90
};

// ── defence ────────────────────────────────────────────────────────────────
export const D_MODEL = {
  // Points allowed is the one defensive stat the market prices directly and the
  // one that dominates the fantasy line. Anchor on it and keep a sixth of our
  // own disagreement — enough for a real roster opinion to show, not enough to
  // put a 520-point season on a board.
  paOwnView: 0.15,
  // Deviations are measured from the POOL's own mean and re-centred on the
  // league's, so a feed that runs hot across the board is corrected rather than
  // shrunk toward its own bias.
  sackKeep: 0.35,      // yoy r 0.33
  fumRecKeep: 0.35,    // yoy r 0.01 — even this is generous
  // Defensive touchdowns are the position's biggest single scoring event and its
  // least predictable. Real clubs average 1.5 and six to eight of them score
  // NONE, so a board that floors every defence at 2 invents about thirty
  // touchdowns a season. The small tilt that remains follows takeaways, which is
  // the only thing a return score can come from.
  tdTilt: 0.8, tdMin: 1.0, tdMax: 2.2
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round1 = v => Math.round(v * 10) / 10;

// impliedPoints -> the market's own view of a kicker's line, before the site's
// committed opinion is blended back in.
export function marketKicker(impliedPoints) {
  const xp = Math.max(0, K_MODEL.xpA + K_MODEL.xpB * impliedPoints);
  const fg = Math.max(0, K_MODEL.fgA + K_MODEL.fgB * impliedPoints);
  return { fgMade: fg, xpMade: xp };
}

// The committed line and the market's view -> the line to ship. `committed` may
// be null for a kicker the board has never carried, in which case the market's
// view stands on its own at league-average accuracy.
export function blendKicker(committed, impliedPoints) {
  const m = marketKicker(impliedPoints);
  const c = committed || null;
  const cAtt = c ? (c.fgMade || 0) + (c.fgMissed || 0) : 0;
  const cPct = cAtt > 0 ? c.fgMade / cAtt : LEAGUE.fgPct;

  const xpMade = c ? m.xpMade + K_MODEL.xpOwnView * ((c.xpMade || 0) - m.xpMade) : m.xpMade;
  // Field goals shrink toward the LEAGUE mean, not toward the market's own
  // curve, because the market's curve on this stat is nearly flat anyway.
  const fgMade = c
    ? m.fgMade + K_MODEL.fgOwnView * ((c.fgMade || 0) - LEAGUE.fgMade)
    : m.fgMade;
  const pct = clamp(LEAGUE.fgPct + K_MODEL.pctOwnView * (cPct - LEAGUE.fgPct),
                    K_MODEL.pctMin, K_MODEL.pctMax);
  const fgMissed = Math.max(0, fgMade / pct - fgMade);
  const xpMissed = Math.max(0, xpMade / LEAGUE.xpPct - xpMade);
  return {
    fgMade: round1(fgMade), fgMissed: round1(fgMissed),
    xpMade: round1(xpMade), xpMissed: round1(xpMissed)
  };
}

// The committed defensive line and the market's implied points against -> the
// line to ship. Sacks, interceptions and fumble recoveries are not priced by any
// book; they are shrunk toward the league mean by their own measured stickiness.
export function blendDefense(committed, impliedAgainst, poolMean = {}) {
  const c = committed || {};
  const cSack = poolMean.sacks ?? LEAGUE.sacks;
  const cFum = poolMean.fumRec ?? LEAGUE.fumRec;
  const pa = impliedAgainst + D_MODEL.paOwnView * ((c.ptsAllowed ?? impliedAgainst) - impliedAgainst);
  const sacks = LEAGUE.sacks + D_MODEL.sackKeep * ((c.sacks ?? cSack) - cSack);
  const fumRec = LEAGUE.fumRec + D_MODEL.fumRecKeep * ((c.fumRec ?? cFum) - cFum);
  const ints = c.ints ?? 12;              // level and spread already check out
  const takeIdx = (ints + fumRec) / LEAGUE.takeaways;
  const defTD = clamp(LEAGUE.defTD * (1 + D_MODEL.tdTilt * (takeIdx - 1)),
                      D_MODEL.tdMin, D_MODEL.tdMax);
  return {
    sacks: round1(sacks), fumRec: round1(fumRec), ints: round1(ints),
    defTD: round1(defTD), safety: c.safety ?? 0, ptsAllowed: Math.round(pa)
  };
}
