// Team scoring environment, read off the sportsbooks' own game lines.
//
// A spread and a total together price BOTH sides of a game: the home side is
// total/2 + spread/2 and the away side total/2 - spread/2. That pair is the
// market's expectation for how many points a team scores and concedes, which is
// exactly the quantity a kicker's volume and a defence's points-allowed line are
// made of.
//
// ── Why a ratings fit and not an average ────────────────────────────────────
// Books post lines a few weeks out, so in September only the first stretch of
// the season is priced. Averaging those games and multiplying by 17 asks a team
// to be judged on whoever it happened to draw in September. Fitting instead
//
//     points(offence i vs defence j, at home h) = mu + off_i + def_j + hfa*h
//
// separates "this offence is good" from "those first six defences were bad",
// and the fitted ratings then project across the WHOLE 17-game schedule, which
// the file carries in full whether or not a line has been posted yet.
//
// A small ridge keeps the fit stable while a team has only a handful of priced
// games. mu and hfa are never penalised — shrinking the intercept would drag the
// league's whole scoring level down with it.
//
// HAND-SYNCED with the "team market ratings" block in _worker.js, which runs the
// same fit on the daily cron. There is no build step in this repo. Change one,
// change both; tools/test-team-market.mjs runs the two against one fixture and
// fails if they disagree.

// nflverse spells three clubs differently from the app's PROJECTIONS block.
export const NFLVERSE_TEAM = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
export const nflverseTeam = t => { const u = String(t || '').toUpperCase(); return NFLVERSE_TEAM[u] || u; };

export const MARKET_RIDGE = 0.25;     // gentle: 224 rows against 66 parameters
export const MARKET_MIN_PRICED = 48;  // priced SIDES, so 24 games: below that, too thin to fit

// Minimal quote-aware CSV splitter. games.csv carries free-text columns
// (stadium, referee) that can contain commas.
export function csvSplit(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Every regular-season row of the newest season in the file, priced or not: the
// unpriced ones still carry the fixture, which is what makes a schedule-complete
// projection possible.
export function parseSeasonGames(text) {
  const lines = String(text || '').split('\n');
  if (lines.length < 2) throw new Error('games.csv: empty');
  const head = csvSplit(lines[0]);
  const col = {};
  for (const k of ['season', 'game_type', 'home_team', 'away_team', 'spread_line', 'total_line']) {
    col[k] = head.indexOf(k);
    if (col[k] < 0) throw new Error('games.csv: missing column ' + k);
  }
  // game_id leads with the season, so the newest one is findable without
  // parsing two megabytes of CSV.
  let season = 0;
  for (let i = 1; i < lines.length; i++) {
    const u = lines[i].indexOf('_');
    if (u > 0) { const y = +lines[i].slice(0, u); if (y > season && y < 3000) season = y; }
  }
  if (!season) throw new Error('games.csv: no season found');

  const prefix = season + '_';
  const games = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    const f = csvSplit(lines[i]);
    if (f[col.game_type] !== 'REG') continue;
    const spread = parseFloat(f[col.spread_line]);
    const total = parseFloat(f[col.total_line]);
    // A junk line is worse than a missing one: keep the fixture, drop the price.
    const priced = Number.isFinite(spread) && Number.isFinite(total)
      && total >= 20 && total <= 80 && Math.abs(spread) <= 30;
    games.push({ home: f[col.home_team], away: f[col.away_team], spread, total, priced });
  }
  return { season, games };
}

// Solve A x = b in place by Gaussian elimination with partial pivoting. The
// system is 2n+2 wide (an offence and a defence rating per club, plus mu and
// hfa), which is 66 today — small enough that a dense solve is the simplest
// thing that works.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => Array.from(row).concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-12)) throw new Error('team-market: singular system');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map(r => r[n]);
}

// Ridge least squares over every priced side of every priced game.
export function fitRatings(games, ridge = MARKET_RIDGE) {
  const teams = [...new Set(games.flatMap(g => [g.home, g.away]))].sort();
  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const obs = [];
  for (const g of games) {
    if (!g.priced) continue;
    obs.push({ off: idx[g.home], def: idx[g.away], home: 1, y: g.total / 2 + g.spread / 2 });
    obs.push({ off: idx[g.away], def: idx[g.home], home: -1, y: g.total / 2 - g.spread / 2 });
  }
  if (obs.length < MARKET_MIN_PRICED) {
    return { ok: false, error: 'too_few_priced', priced: obs.length / 2, teams };
  }
  const P = 2 * n + 2;                                   // off, def, hfa, mu
  const A = Array.from({ length: P }, () => new Float64Array(P));
  const b = new Float64Array(P);
  for (const o of obs) {
    const at = [o.off, n + o.def, 2 * n, 2 * n + 1];
    const val = [1, 1, o.home, 1];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[at[i]][at[j]] += val[i] * val[j];
      b[at[i]] += val[i] * o.y;
    }
  }
  for (let i = 0; i < 2 * n; i++) A[i][i] += ridge;       // never mu, never hfa
  const x = solve(A, b);
  const off = {}, def = {};
  teams.forEach((t, i) => { off[t] = x[i]; def[t] = x[n + i]; });
  const hfa = x[2 * n], mu = x[2 * n + 1];
  let ss = 0;
  for (const o of obs) {
    const p = mu + off[teams[o.off]] + def[teams[o.def]] + hfa * o.home;
    ss += (p - o.y) ** 2;
  }
  return { ok: true, teams, off, def, hfa, mu, rmse: Math.sqrt(ss / obs.length), priced: obs.length / 2 };
}

// Ratings + the full fixture list -> a season's implied points for and against.
// Every game on the schedule counts, priced or not, so a team is judged on the
// opponents it actually plays rather than on the ones the book got to first.
export function seasonTotals(games, r) {
  if (!r || !r.ok) return null;
  const out = {};
  for (const t of r.teams) out[t] = { pf: 0, pa: 0, games: 0 };
  for (const g of games) {
    if (!out[g.home] || !out[g.away]) continue;
    const hp = r.mu + r.off[g.home] + r.def[g.away] + r.hfa;
    const ap = r.mu + r.off[g.away] + r.def[g.home] - r.hfa;
    out[g.home].pf += hp; out[g.home].pa += ap; out[g.home].games++;
    out[g.away].pf += ap; out[g.away].pa += hp; out[g.away].games++;
  }
  return out;
}

// The whole pipeline, from the raw file to { TEAM: {pf, pa, games} }.
export function marketTotals(text, ridge = MARKET_RIDGE) {
  const { season, games } = parseSeasonGames(text);
  const r = fitRatings(games, ridge);
  if (!r.ok) return { ok: false, error: r.error, season };
  return { ok: true, season, totals: seasonTotals(games, r),
           hfa: r.hfa, mu: r.mu, rmse: r.rmse, priced: r.priced, fixtures: games.length };
}
