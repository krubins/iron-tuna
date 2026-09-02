// Verification harness. Every constant AND every scoring/pricing function is
// READ from the worker at run time -- nothing is hand-copied, because a
// hand-copied curve is exactly how a checker goes stale without noticing
// (PR #105 re-cut the curve by 1.125x on 2026-08-25).
//
// Copying the FUNCTIONS was the same mistake one level up, and it bit twice:
// on 2026-08-31 the valuation pass changed _colPrice (off-curve players $2 to
// $1) and added season normalisation, and this file kept reporting the old
// numbers with CI green. So _colScore, _colPrice and the normalisation are now
// lifted and evaluated, not reimplemented. If the worker changes them again,
// this file changes with it or throws.
//
// Point it at a different worker with IRON_TUNA_WORKER=/path/to/_worker.js --
// that is how a DEPLOYED bundle gets checked against the repo, and the bundle
// says `var` where the source says `const`, so both are accepted.
import fs from 'fs';
const WORKER = process.env.IRON_TUNA_WORKER
  || new URL('../_worker.js', import.meta.url).pathname;
const W = fs.readFileSync(WORKER, 'utf8');
export const WORKER_PATH = WORKER;

function lift(name, optional = false) {     // pull a top-level const out of the worker
  const re = new RegExp('(?:const|var|let) ' + name + '\\s*=\\s*');
  const m = re.exec(W);
  if (!m) { if (optional) return null; throw new Error('missing ' + name + ' in ' + WORKER); }
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
// the points on a reader's sheet are NOT raw stat-line scores. OPTIONAL: a
// worker built before 2026-08-31 has no such constant, and a board built from
// one must not normalise. Absent means absent, never "assume the new way".
export const NORM = lift('COLUMN_NORM', true);

// ── the worker's own functions, lifted ─────────────────────────────────────
function liftFn(name, deps) {
  const i = W.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name + ' in ' + WORKER);
  let depth = 0, q = null, end = -1;
  for (let j = W.indexOf('{', i); j < W.length; j++) {
    const c = W[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) { end = j + 1; break; } }
  }
  const names = Object.keys(deps), vals = Object.values(deps);
  return new Function(...names, W.slice(i, end) + '; return ' + name + ';')(...vals);
}
const DEPS = {
  COLUMN_SCORING: SCORING, COLUMN_CURVE: CURVE, COLUMN_CURVE_BUDGET: CURVE_BUDGET,
  COLUMN_LEAGUE_BUDGET: LEAGUE_BUDGET, COLUMN_MIN_BID: MIN_BID, COLUMN_NORM: NORM,
  // esbuild wraps every function in __name() for stack traces; a lifted
  // function from a deployed bundle needs it in scope to evaluate.
  __name: (fn) => fn
};
const _colScore = liftFn('_colScore', DEPS);
const _colPrice = liftFn('_colPrice', DEPS);
const _colNormFactors = NORM ? liftFn('_colNormFactors', DEPS) : null;
const _colNormApply = NORM ? liftFn('_colNormApply', DEPS) : null;
const round = v => Math.round(v * 10) / 10;
const score = (stats, position) => _colScore(stats, position);
export const price = (pos, rankIndex) => _colPrice(pos, rankIndex);
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
    // Score, then normalise, then round, then sort — the worker's order. A
    // worker without COLUMN_NORM does not normalise at all.
    const f = _colNormFactors ? _colNormFactors({ [pos]: rows.map(r => r.raw) })[pos] : 1;
    for (const r of rows) {
      r.pts = round(_colNormApply ? _colNormApply(r.raw, f) : r.raw);
      delete r.raw;
    }
    rows.sort((a, b) => b.pts - a.pts);
    lists[pos] = rows;
    rows.forEach((p, i) => map.set(p.n, { pos, team: p.team, rank: i + 1, v: price(pos, i), pts: p.pts, rec: p.rec }));
  }
  return { map, lists };
}
