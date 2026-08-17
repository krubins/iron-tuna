#!/usr/bin/env node
// Convert raw Las Vegas season-long player props into a merge-projections source
// file (tools/sources/vegas.json).
//
// Usage:  node tools/vegas-to-projections.mjs [--in tools/odds] [--out tools/sources/vegas.json]
//
// INPUT — one JSON file per book in tools/odds/*.json:
//   {
//     "book": "draftkings",
//     "publishedAt": "2026-08-14T00:00:00Z",   // when the book posted//updated these lines
//     "fetchedAt":   "2026-08-15T10:00:00Z",
//     "markets": [
//       { "player": "Josh Allen", "position": "QB", "team": "BUF",
//         "market": "passYd", "line": 3950.5, "overOdds": -115, "underOdds": -105 },
//       { "player": "Bijan Robinson", "position": "RB", "team": "ATL",
//         "market": "scrimmageTD", "line": 9.5, "overOdds": -120, "underOdds": 100 }
//     ]
//   }
//
// Recognised markets (season-long totals):
//   passYd  passTD  passInt  rushYd  rushTD  recYd  recTD  rec
//   scrimmageTD   — combined rush+rec TDs, split using the player's current
//                   projection ratio rather than an invented split.
//
// OUTPUT — the schema tools/merge-projections.mjs already consumes:
//   { source: "vegas", publishedAt, fetchedAt, players: [ { name, position, team, stats } ] }
//
// ── The math ────────────────────────────────────────────────────────────────
// A posted total is not a projection. Two corrections turn it into one:
//
// 1. DE-VIG. Both sides carry juice, so raw implied probabilities sum to >1.
//    We convert each side's American price to an implied probability and
//    normalise them to sum to 1 (multiplicative method). What survives is the
//    market's honest opinion of P(over).
//
// 2. MEDIAN -> MEAN. The line sits near the market's MEDIAN outcome; fantasy
//    scoring needs the MEAN. Modelling a season total as roughly normal,
//        E[X] = line + sigma * PHI^-1(P(over))
//    At a balanced price (P = 0.5) the mean is the line, which is the common
//    case; the correction only bites when a book prices one side hard. sigma
//    is a per-market coefficient of variation times the line. Because the
//    correction is small near P = 0.5, the result is robust to getting the
//    CV somewhat wrong.
//
// Season-long totals already price in injury/availability risk (the book pays
// on yards actually accumulated), so the output is an availability-adjusted
// expectation. Do NOT haircut it again for games missed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const IN_DIR = path.resolve(ROOT, argOf('--in', path.join('tools', 'odds')));
const OUT = path.resolve(ROOT, argOf('--out', path.join('tools', 'sources', 'vegas.json')));
const WORKER = path.join(ROOT, '_worker.js');

// Spread of a full-season total around its mean, as a fraction of the line.
// Used only for the median->mean skew correction described above.
const CV = {
  passYd: 0.20, passTD: 0.28, passInt: 0.35,
  rushYd: 0.30, rushTD: 0.40,
  recYd: 0.30, recTD: 0.40, rec: 0.28,
  scrimmageTD: 0.40
};
const MARKETS = new Set(Object.keys(CV));
// Markets the site models as whole numbers.
const INTEGER_STATS = new Set(['passTD', 'passInt', 'rushTD', 'recTD', 'fumLost']);

export const norm = s => String(s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
  .replace(/[^a-z]/g, '');

// American odds -> implied probability (juice included).
export function impliedProb(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

// Remove the vig from a two-way market; returns de-vigged P(over).
export function devigOver(overOdds, underOdds) {
  const po = impliedProb(overOdds);
  const pu = impliedProb(underOdds);
  if (po == null || pu == null) return null;
  const sum = po + pu;
  if (!(sum > 0)) return null;
  return po / sum;
}

// Acklam's inverse normal CDF approximation (|error| < 1.15e-9).
export function probit(p) {
  if (!(p > 0 && p < 1)) return null;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// line + de-vigged P(over) -> expected season total.
export function expectedTotal(line, pOver, market) {
  const L = Number(line);
  if (!Number.isFinite(L) || L < 0) return null;
  if (pOver == null) return L;                 // no usable price: the line is the estimate
  const z = probit(Math.min(0.995, Math.max(0.005, pOver)));
  if (z == null) return L;
  const sigma = (CV[market] ?? 0.30) * L;
  return Math.max(0, L + sigma * z);
}

// ── current site projections (used only to split combined TD markets) ───────
function currentProjections() {
  const w = fs.readFileSync(WORKER, 'utf8');
  const start = w.indexOf('const PROJECTIONS = [');
  const end = w.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error('PROJECTIONS block not found in _worker.js');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const map = new Map();
  let m;
  while ((m = re.exec(w.slice(start, end)))) {
    const stats = {};
    for (const kv of m[4].split(',')) {
      const p = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
      if (p) stats[p[1]] = parseFloat(p[2]);
    }
    map.set(norm(m[1]) + '|' + m[2].toUpperCase(), { name: m[1], position: m[2], team: m[3], stats });
  }
  return map;
}

// ── load raw book files ────────────────────────────────────────────────────
export function loadBooks(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!j.book || !Array.isArray(j.markets)) throw new Error(`${f}: missing book/markets`);
    return { file: f, ...j };
  });
}

// Consensus across books: de-vig each book, convert to an expected total, then
// average the books. Averaging AFTER conversion keeps a book with wide juice
// from dragging the consensus line around.
export function buildSource(books, current = new Map()) {
  const perPlayer = new Map();
  const warnings = [];
  let marketCount = 0;

  for (const b of books) {
    for (const m of b.markets) {
      if (!m.player || !m.position || !m.market) { warnings.push(`${b.book}: market missing player/position/market`); continue; }
      if (!MARKETS.has(m.market)) { warnings.push(`${b.book}: unknown market "${m.market}" for ${m.player}`); continue; }
      const pOver = devigOver(m.overOdds, m.underOdds);
      const exp = expectedTotal(m.line, pOver, m.market);
      if (exp == null) { warnings.push(`${b.book}: unusable line for ${m.player} ${m.market}`); continue; }
      const key = norm(m.player) + '|' + String(m.position).toUpperCase();
      if (!perPlayer.has(key)) {
        perPlayer.set(key, { name: m.player, position: String(m.position).toUpperCase(), team: m.team || null, samples: {} });
      }
      const rec = perPlayer.get(key);
      (rec.samples[m.market] = rec.samples[m.market] || []).push(exp);
      marketCount++;
    }
  }

  const players = [];
  for (const [key, rec] of perPlayer) {
    const stats = {};
    for (const [mk, arr] of Object.entries(rec.samples)) {
      stats[mk] = arr.reduce((a, c) => a + c, 0) / arr.length;
    }
    // Split a combined rush+rec TD total using the player's current projected
    // ratio; if we have no current line for them, fall back to position norms.
    if (stats.scrimmageTD != null) {
      const cur = current.get(key);
      const cr = cur?.stats?.rushTD ?? null;
      const cc = cur?.stats?.recTD ?? null;
      let share;                                   // share of scrimmage TDs that are rushing
      if (cr != null && cc != null && (cr + cc) > 0) share = cr / (cr + cc);
      else share = rec.position === 'RB' ? 0.8 : rec.position === 'QB' ? 1 : 0.05;
      if (stats.rushTD == null) stats.rushTD = stats.scrimmageTD * share;
      if (stats.recTD == null) stats.recTD = stats.scrimmageTD * (1 - share);
      delete stats.scrimmageTD;
    }
    for (const k of Object.keys(stats)) {
      stats[k] = INTEGER_STATS.has(k) ? Math.round(stats[k]) : Math.round(stats[k] * 10) / 10;
    }
    players.push({ name: rec.name, position: rec.position, team: rec.team, stats });
  }

  players.sort((a, b) => a.name.localeCompare(b.name));
  return { players, warnings, marketCount };
}

// ── CLI ────────────────────────────────────────────────────────────────────
function main() {
  const books = loadBooks(IN_DIR);
  if (!books.length) {
    console.error(`no book files in ${IN_DIR} — nothing to convert.`);
    console.error('Drop one JSON file per sportsbook there (see the header of this file for the shape).');
    process.exit(2);
  }
  const current = currentProjections();
  const { players, warnings, marketCount } = buildSource(books, current);
  if (!players.length) { console.error('ABORT: no usable markets'); process.exit(1); }

  // publishedAt = the OLDEST book, so merge-projections' freshness rule is
  // judged against the stalest input rather than the newest.
  const pubs = books.map(b => Date.parse(b.publishedAt || '')).filter(Number.isFinite);
  if (!pubs.length) { console.error('ABORT: no book carries a parseable publishedAt'); process.exit(1); }

  const out = {
    source: 'vegas',
    books: books.map(b => b.book),
    publishedAt: new Date(Math.min(...pubs)).toISOString(),
    fetchedAt: new Date(Math.max(...books.map(b => Date.parse(b.fetchedAt || '') || 0), 0)).toISOString(),
    players
  };

  const matched = players.filter(p => current.has(norm(p.name) + '|' + p.position)).length;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  for (const w of warnings.slice(0, 20)) console.log('warn:', w);
  if (warnings.length > 20) console.log(`warn: ...and ${warnings.length - 20} more`);
  console.log(`${marketCount} markets from ${books.length} book(s) -> ${players.length} players (${matched} on the site roster)`);
  console.log('wrote', path.relative(ROOT, OUT));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
