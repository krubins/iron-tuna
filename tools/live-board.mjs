// Verification harness. Every constant is READ from _worker.js at run time --
// nothing is hand-copied, because a hand-copied curve is exactly how a checker
// goes stale without noticing (PR #105 re-cut the curve by 1.125x on 2026-08-25).
import fs from 'fs';
const WORKER = new URL('../_worker.js', import.meta.url).pathname;
const W = fs.readFileSync(WORKER, 'utf8');

function lift(name) {                       // pull a top-level const out of the worker
  const re = new RegExp('const ' + name + '\\s*=\\s*');
  const m = re.exec(W);
  if (!m) throw new Error('missing ' + name + ' in _worker.js');
  const from = m.index + m[0].length;
  let depth = 0, q = null, end = -1;
  for (let i = from; i < W.length; i++) {
    const c = W[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { if (--depth === 0) { end = i + 1; break; } }
    else if (depth === 0 && (c === ';' || c === '\n')) { end = i; break; }
  }
  return new Function('return (' + W.slice(from, end) + ');')();
}
export const PROJECTIONS = lift('PROJECTIONS');
export const SCORING = lift('COLUMN_SCORING');
export const CURVE = lift('COLUMN_CURVE');
export const CURVE_BUDGET = lift('COLUMN_CURVE_BUDGET');
export const LEAGUE_BUDGET = lift('COLUMN_LEAGUE_BUDGET');
export const MIN_BID = lift('COLUMN_MIN_BID');
export const VEGAS_WEIGHT = lift('VEGAS_WEIGHT');
// The worker re-levels each position's points to last season's top-K mean
// before it serves them (COLUMN_NORM / _colNormFactors in _worker.js §9d), so
// the points on a reader's sheet are NOT raw stat-line scores. Lifted, not
// copied, for the same reason as every other constant here.
export const NORM = lift('COLUMN_NORM');
const round = v => Math.round(v * 10) / 10;
function score(stats, position) {
  const s = SCORING;
  const yd = (y, per, thr) => (y < thr || !(per > 0)) ? 0 : y / per;
  let p = 0;
  p += yd(stats.passYd || 0, s.passingYardsPerPoint, s.passingYardsThreshold);
  p += (stats.passTD || 0) * s.passingTD;
  p += (stats.passInt || 0) * s.passingInt;
  p += yd(stats.rushYd || 0, s.rushingYardsPerPoint, s.rushingYardsThreshold);
  p += (stats.rushTD || 0) * s.rushingTD;
  p += yd(stats.recYd || 0, s.receivingYardsPerPoint, s.receivingYardsThreshold);
  p += (stats.recTD || 0) * s.receivingTD;
  p += (stats.rec || 0) * (position === 'RB' ? s.rbReceptionPoints : s.receptionPoints);
  p += (stats.fumLost || 0) * s.fumbleLost;
  return p;
}
export function price(pos, rankIndex) {
  const c = CURVE[pos] || [];
  // Mirrors _colPrice: only curve prices scale with the budget. Past the end of
  // the curve the room pays the min bid flat — scaling it there put every
  // off-curve player at $2 instead of $1.
  if (rankIndex >= c.length) return MIN_BID;
  return Math.max(MIN_BID, Math.round(c[rankIndex] * (LEAGUE_BUDGET / CURVE_BUDGET)));
}

// _colNormFactors, mirrored: top-K projected mean against last year's, only
// positive scores, skipped inside a 2% dead zone. Flat per position, so ranks
// and prices never move; only the printed points do.
export function normFactor(pos, ptsList) {
  const cfg = NORM[pos];
  if (!cfg) return 1;
  const arr = ptsList.filter(v => v > 0).sort((a, b) => b - a);
  if (arr.length < 3) return 1;
  const K = Math.max(3, Math.min(cfg.k, arr.length));
  const projMean = arr.slice(0, K).reduce((a, b) => a + b, 0) / K;
  if (!(projMean > 0)) return 1;
  const f = cfg.mean / projMean;
  return (f >= 0.98 && f <= 1.02) ? 1 : f;
}
const norm = s => String(s).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, '');
export function board(overlayPath, useOdds = true) {
  const OV = overlayPath ? JSON.parse(fs.readFileSync(overlayPath, 'utf8')) : {};
  const map = new Map(), lists = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const rows = PROJECTIONS.filter(p => p.position === pos).map(p => {
      const st = { ...p.projectedStats };
      if (useOdds) {
        const v = OV[norm(p.name) + '|' + pos];
        if (v) for (const [k, val] of Object.entries(v)) {
          if (!(k in st)) continue;
          const n = Number(val);
          if (!Number.isFinite(n) || n < 0) continue;
          st[k] = round((st[k] + VEGAS_WEIGHT * n) / (1 + VEGAS_WEIGHT));
        }
      }
      return { n: p.name, team: p.team, raw: score(st, pos), rec: st.rec || 0 };
    });
    // Score, then normalise, then round, then sort — the worker's order.
    const f = normFactor(pos, rows.map(r => r.raw));
    for (const r of rows) { r.pts = round(r.raw > 0 ? r.raw * f : r.raw); delete r.raw; }
    rows.sort((a, b) => b.pts - a.pts);
    lists[pos] = rows;
    rows.forEach((p, i) => map.set(p.n, { pos, team: p.team, rank: i + 1, v: price(pos, i), pts: p.pts, rec: p.rec }));
  }
  return { map, lists };
}
