// Verification harness: the board a reader actually sees, rebuilt outside the
// worker so a story's dollar figures can be checked against it.
//
// NOTHING here is hand-copied from _worker.js. Every constant AND every
// function is READ from the worker at run time, because a copy is right about
// exactly one build and goes stale silently:
//
//   2026-08-25  PR #105 re-cut the curve by 1.125x   -> copied CURVE was wrong
//   2026-08-31  _colPrice off-curve $2 -> $1, and     -> copied functions were
//               COLUMN_NORM added                        wrong, CI still green
//   2026-09-02  the deployed bundle rolled back       -> wrong the OTHER way
//   2026-09-03  _colScore refactored to scoreStats,   -> lifting by NAME broke:
//               blendProjections gained availability     ReferenceError, and
//                                                        again CI stayed green
//
// So the lift is now TRANSITIVE. Ask for the entry points; anything they
// reference is pulled in after it throws, and so on, until the worker's own
// code runs. A refactor that moves scoring into a helper, or teaches the blend
// about injuries, is followed automatically instead of silently ignored.
//
// The pipeline below is the worker's boardCompute (§9d), in its order:
//   blendProjections(overlay) -> _colScore -> _colNormFactors/_colNormApply
//   -> round -> sort -> rank -> _colPrice
// blendProjections is the worker's own, so availability pro-rating and the
// odds blend are whatever the worker says they are, not a second opinion.
//
// Point it at a different worker with IRON_TUNA_WORKER=/path/to/_worker.js --
// that is how a DEPLOYED bundle gets checked against the repo, and the bundle
// says `var` where the source says `const`, so both are accepted.
import fs from 'fs';
const WORKER = process.env.IRON_TUNA_WORKER
  || new URL('../_worker.js', import.meta.url).pathname;
const W = fs.readFileSync(WORKER, 'utf8');
export const WORKER_PATH = WORKER;

// ── transitive lift ────────────────────────────────────────────────────────
// Where a top-level declaration starts and ends. Line-anchored first, because
// `function _colScore(` also appears inside comments and in nested scopes;
// unanchored is the fallback for a minified bundle that lost its newlines.
function declRange(name) {
  const pats = [
    new RegExp('^(?:async )?function ' + name + '\\s*\\(', 'm'),
    new RegExp('^(?:const|var|let) ' + name + '\\s*=', 'm'),
    new RegExp('(?:^|[;}\\n])(?:async )?function ' + name + '\\s*\\('),
    new RegExp('(?:^|[;}\\n])(?:const|var|let) ' + name + '\\s*=')
  ];
  for (const re of pats) {
    const m = re.exec(W);
    if (!m) continue;
    const start = m.index + (/^[;}\n]/.test(m[0]) ? 1 : 0);
    return { start, end: endOfDecl(start), name };
  }
  return null;
}
// A declaration ends at the close of its first balanced brace/bracket, or at
// the statement end for a scalar. Quote- and comment-aware, because the worker
// is full of both and a `}` inside a string would truncate the slice.
function endOfDecl(start) {
  let depth = 0, q = null, line = false, block = false, seen = false;
  for (let i = start; i < W.length; i++) {
    const c = W[i], n = W[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      else if (q === '`' && c === '$' && n === '{') { i++; depth++; }   // template hole
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; seen = true; continue; }
    if (c === ')' || c === ']' || c === '}') { if (--depth === 0 && seen && W[start] !== 'c' && W[start] !== 'v' && W[start] !== 'l') return i + 1; continue; }
    if (depth === 0 && seen && (c === ';' || c === '\n')) return i;
    if (depth === 0 && !seen && (c === ';' || c === '\n')) return i;
  }
  return W.length;
}
// A function declaration ends at its closing brace; a const ends at the
// statement. endOfDecl above handles the const case by falling through to the
// `;`/newline test once the initialiser's brackets are balanced, but a
// multi-line arrow body would end early, so functions get their own scan.
function endOfFunction(start) {
  let depth = 0, q = null, line = false, block = false;
  for (let i = W.indexOf('{', start); i < W.length; i++) {
    const c = W[i], n = W[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return W.length;
}
const declCache = new Map();
function decl(name) {
  if (declCache.has(name)) return declCache.get(name);
  let d = declRange(name);
  if (d && /^(?:async )?function/.test(W.slice(d.start, d.start + 15))) d.end = endOfFunction(d.start);
  declCache.set(name, d);
  return d;
}
const has = name => !!decl(name);

// The entry points the board needs. Everything else arrives by ReferenceError.
const ENTRY = ['PROJECTIONS', 'COLUMN_SCORING', 'COLUMN_CURVE', 'COLUMN_CURVE_BUDGET',
  'COLUMN_LEAGUE_BUDGET', 'COLUMN_MIN_BID', 'VEGAS_WEIGHT', 'COLUMN_POSITIONS',
  '_colScore', '_colPrice', '_oddsRound'];
const OPTIONAL = ['COLUMN_NORM', '_colNormFactors', '_colNormApply', 'blendProjections',
  '_AVAIL_TABLE', 'availabilityMerge', 'AVAILABILITY'];

function build(extra) {
  const want = [...ENTRY, ...OPTIONAL.filter(has), ...extra].filter(has);
  const parts = [...new Set(want)].map(decl).sort((a, b) => a.start - b.start);
  const src = parts.map(p => W.slice(p.start, p.end)).join('\n;\n');
  const give = [...new Set([...ENTRY, ...OPTIONAL])].filter(has);
  const setAvail = has('_AVAIL_TABLE') && has('availabilityMerge') && has('AVAILABILITY')
    ? ', __setAvail: function (live) { _AVAIL_TABLE = availabilityMerge(AVAILABILITY, live); }' : '';
  // esbuild wraps every function in __name() for stack traces, so a bundle
  // needs it in scope; the unbundled source never calls it.
  return new Function('__name', src + '\nreturn {' + give.join(',') + setAvail + '};')(fn => fn);
}
// Build, exercise, and on "X is not defined" pull X in and try again. The cap
// is a guard against a symbol the worker genuinely does not declare (a runtime
// global, say) turning this into a loop.
function resolve() {
  const extra = new Set();
  for (let i = 0; i < 80; i++) {
    let S;
    try {
      S = build(extra);
      smoke(S);
      return S;
    } catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message || '');
      if (m && !extra.has(m[1]) && has(m[1])) { extra.add(m[1]); continue; }
      throw new Error('cannot rebuild the board from ' + WORKER + ': ' + e.message
        + (m ? '\n  ' + m[1] + ' is referenced but not declared there.' : ''));
    }
  }
  throw new Error('cannot rebuild the board from ' + WORKER + ': lift did not converge');
}
// Enough of the pipeline to surface a call-time ReferenceError, which is the
// only way a refactor inside a function body shows up at all.
function smoke(S) {
  // BOTH blend paths. blendProjections returns early when there is no overlay,
  // so a null-only smoke never reaches _oddsNorm and the lift stops one symbol
  // short -- which then throws on the first real overlay, far from here.
  const pool = S.blendProjections ? S.blendProjections(null) : S.PROJECTIONS;
  if (S.blendProjections) S.blendProjections({});
  const p = pool[0];
  const pts = S._colScore(p.projectedStats || {}, p.position);
  if (S._colNormFactors) S._colNormApply(pts, S._colNormFactors({ [p.position]: [pts] })[p.position]);
  S._colPrice(p.position, 0);
  S._oddsRound(pts);
}
const S = resolve();

export const PROJECTIONS = S.PROJECTIONS;
export const SCORING = S.COLUMN_SCORING;
export const CURVE = S.COLUMN_CURVE;
export const CURVE_BUDGET = S.COLUMN_CURVE_BUDGET;
export const LEAGUE_BUDGET = S.COLUMN_LEAGUE_BUDGET;
export const MIN_BID = S.COLUMN_MIN_BID;
export const VEGAS_WEIGHT = S.VEGAS_WEIGHT;
// The worker re-levels each position's points to last season's top-K mean
// before it serves them, so the points on a reader's sheet are NOT raw
// stat-line scores. OPTIONAL: a worker built before 2026-08-31 has no such
// constant, and a board built from one must not normalise. Absent means
// absent, never "assume the new way".
export const NORM = S.COLUMN_NORM || null;
export const price = (pos, rankIndex) => S._colPrice(pos, rankIndex);

// The live injury list, when the caller has one. Without it the board carries
// only the committed AVAILABILITY block, which is what a repo checkout serves
// -- the deployed worker merges a live feed on top, so a player the league
// listed today is pro-rated there and not here. Pass it in to compare like
// with like.
export function setAvailability(live) {
  if (!S.__setAvail) throw new Error(WORKER + ' has no availability table');
  S.__setAvail(live || null);
}
export const hasAvailability = !!S.__setAvail;

// The worker's boardCompute, step for step (§9d).
export function board(overlayPath, useOdds = true) {
  const OV = (useOdds && overlayPath) ? JSON.parse(fs.readFileSync(overlayPath, 'utf8')) : null;
  const pool = S.blendProjections ? S.blendProjections(OV) : S.PROJECTIONS;
  const positions = S.COLUMN_POSITIONS || ['QB', 'RB', 'WR', 'TE'];
  const byPos = {}, meta = new Map();
  for (const p of pool) {
    if (positions.indexOf(p.position) < 0) continue;
    (byPos[p.position] = byPos[p.position] || []).push({
      n: p.name, pos: p.position, pts: S._colScore(p.projectedStats || {}, p.position)
    });
    meta.set(p.name, { team: p.team, rec: (p.projectedStats || {}).rec || 0, status: p.status || '' });
  }
  if (S._colNormFactors) {
    const normF = S._colNormFactors(Object.fromEntries(
      Object.entries(byPos).map(([pos, list]) => [pos, list.map(p => p.pts)])));
    for (const pos of Object.keys(byPos)) {
      for (const p of byPos[pos]) p.pts = S._oddsRound(S._colNormApply(p.pts, normF[pos]));
    }
  } else {
    for (const pos of Object.keys(byPos)) for (const p of byPos[pos]) p.pts = S._oddsRound(p.pts);
  }
  const map = new Map(), lists = {};
  for (const pos of positions) {
    const list = (byPos[pos] || []).sort((a, b) => b.pts - a.pts);
    lists[pos] = list.map(p => ({ n: p.n, pts: p.pts, team: (meta.get(p.n) || {}).team }));
    list.forEach((p, i) => {
      const m = meta.get(p.n) || {};
      map.set(p.n, { pos, team: m.team, rank: i + 1, v: S._colPrice(pos, i), pts: p.pts, rec: m.rec, status: m.status });
    });
  }
  return { map, lists };
}
