// Computes the model-derived stats quoted in the hand-authored X post pools in _worker.js
// (X_STRATEGY_POSTS, X_COACH_POSTS, X_COMPARISON_*_POSTS, X_SNAKE_FEATURE_POSTS,
// X_BESTBALL_FEATURE_POSTS). Re-run after projection updates; if a number here drifts
// meaningfully from what a tweet claims, update the tweet copy.
//
// Scoring: full PPR (1 pt/rec, 0.1/yd rush+rec, 6/TD, 0.04/passYd, 4/passTD, -2 int, -2 fum).
// Survival odds use the exact formula from index.html's Will-He-Be-Available tool:
// sd = max(3, 0.16 * ADP), survives = 1 - normalCdf((nextPick - adp) / sd).
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + '_worker.js', 'utf8');
const players = (0, eval)(src.match(/const PROJECTIONS = (\[[\s\S]*?\]);/)[1]);

const pts = (p) => {
  const s = p.projectedStats;
  return (s.passYd || 0) * 0.04 + (s.passTD || 0) * 4 - (s.passInt || 0) * 2 +
    (s.rushYd || 0) * 0.1 + (s.rushTD || 0) * 6 +
    (s.rec || 0) * 1 + (s.recYd || 0) * 0.1 + (s.recTD || 0) * 6 - (s.fumLost || 0) * 2;
};

const byPos = {};
for (const p of players) (byPos[p.position] = byPos[p.position] || []).push({ name: p.name, team: p.team, pts: pts(p) });
for (const k in byPos) byPos[k].sort((a, b) => b.pts - a.pts);
const g = (pos, rank) => byPos[pos][rank - 1].pts;
const ppg = (x) => (x / 17).toFixed(1);

console.log('— Positional gaps (PPG, full PPR) —');
console.log('QB5→QB12:', ppg(g('QB', 5) - g('QB', 12)));
console.log('RB12→RB24:', ppg(g('RB', 12) - g('RB', 24)));
console.log('RB18→RB30:', ppg(g('RB', 18) - g('RB', 30)));
console.log('WR12→WR24:', ppg(g('WR', 12) - g('WR', 24)));
console.log('WR24→WR48:', ppg(g('WR', 24) - g('WR', 48)));
console.log('TE1 / TE12 PPG:', ppg(g('TE', 1)), '/', ppg(g('TE', 12)));

// Value over replacement at 12-team baselines (QB13/RB30/WR36/TE13).
const repl = { QB: g('QB', 13), RB: g('RB', 30), WR: g('WR', 36), TE: g('TE', 13) };
const vor = [];
for (const pos of ['QB', 'RB', 'WR', 'TE'])
  for (const p of byPos[pos]) { const v = p.pts - repl[pos]; if (v > 0) vor.push({ pos, v }); }
vor.sort((a, b) => b.v - a.v);
const tot = vor.reduce((s, p) => s + p.v, 0);
const share = (arr) => Math.round(100 * arr.reduce((s, p) => s + p.v, 0) / tot) + '%';
console.log('\n— Value over replacement (12-team) —');
console.log('players above replacement:', vor.length, '(of 192 rostered)');
console.log('top-24 share:', share(vor.slice(0, 24)), '| top-36 share:', share(vor.slice(0, 36)));
console.log('RB+WR share:', share(vor.filter((p) => p.pos === 'RB' || p.pos === 'WR')));

console.log('\n— Depth / endgame —');
console.log('RBs ranked 31+ with 150+ season pts:', byPos.RB.slice(30).filter((p) => p.pts >= 150).length);

// Stack correlation basis: top-2 pass catchers' share of team passing yards.
const teamPass = {};
for (const p of players) if (p.position === 'QB') teamPass[p.team] = Math.max(teamPass[p.team] || 0, p.projectedStats.passYd || 0);
const shares = [];
for (const t in teamPass) {
  if (!teamPass[t]) continue;
  const rec = players.filter((p) => p.team === t && p.position !== 'QB').map((p) => p.projectedStats.recYd || 0).sort((a, b) => b - a);
  if (rec.length >= 2) shares.push((rec[0] + rec[1]) / teamPass[t]);
}
console.log('\n— Stacking —');
console.log('avg top-2 pass-catcher share of QB pass yards:', Math.round(100 * shares.reduce((a, b) => a + b, 0) / shares.length) + '%');

// Survival odds (index.html formula).
function ncdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const surv = (adp, nextPick) => Math.round(100 * (1 - ncdf((nextPick - adp) / Math.max(3, 0.16 * adp)))) + '%';
console.log('\n— Survival odds (site formula) —');
console.log('ADP 45, pick 52 (12 later):', surv(45, 52), '| ADP 40:', surv(40, 52), '| ADP 58:', surv(58, 52));
console.log('ADP 33, pick 41 (8 later):', surv(33, 41));
