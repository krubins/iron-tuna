#!/usr/bin/env node
// generate-trend-insights.mjs — data-driven insight generator built on
// next-level environment trends: offensive-coordinator tendencies,
// offensive-line quality, and schedule (full season + championship weeks).
//
// Usage:
//   node tools/generate-trend-insights.mjs [--dry-run] [--top=N]
//        [--min-conviction=X] [--allow-stale] [--max-age-days=N]
//
// Inputs:
//   _worker.js                        — authoritative PROJECTIONS roster
//   tools/context/coordinators.json   — play-caller tendency profiles
//   tools/context/offensive-line.json — O-line tier profiles
//   tools/context/schedule.json       — schedule lean profiles
//
// The context files are hand-maintained from the repo's own drop pages and
// Auction Watch corpus (per the HANDOFF rule: facts come from the corpus,
// never from memory). Each file carries an asOf date; files older than the
// freshness window (default 45 days) are treated as stale and excluded
// unless --allow-stale is passed. Zero fresh datasets -> exit 2, nothing
// written (same fail-safe convention as merge-projections.mjs).
//
// How it works:
//   1. Every skill player is scored in full PPR (same formula as
//      compute-tweet-stats.mjs) and ranked at his position.
//   2. Each context dataset contributes weighted, directional signals to the
//      players it touches (e.g. bellcow role +2.0, league-worst pass
//      protection -1.2 for a QB, hostile championship-week slate -1.0
//      weighted toward best ball).
//   3. Signals are summed into a net score; agreement across distinct signal
//      kinds earns an alignment bonus (stacked signals are the whole point
//      of cross-referencing datasets). Conflicting large signals become
//      "mixed profile" insights instead of buys/fades.
//   4. The net score maps to a projected effect band (% of baseline
//      projection, converted to PPG), and to format-specific actions:
//      auction (price guidance), snake (slot/round movement computed by
//      re-ranking the player at his adjusted point total), and best ball
//      (championship-week weighting).
//
// Output (unless --dry-run):
//   tools/trend-insights/trend-insights-YYYY-MM-DD.json — full structured set
//   tools/trend-insights/trend-insights-YYYY-MM-DD.md   — human-readable digest
//
// Style rule: no em dashes in any generated copy (HANDOFF §10 applies to
// everything this system might ever publish).
//
// Sanity rules (any violation aborts with no changes):
//   - every team code in a context file must exist in the PROJECTIONS roster
//   - all signal values must be finite numbers inside their documented range
//   - at least one insight must survive filtering

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, '_worker.js');
const CTX_DIR = path.join(ROOT, 'tools', 'context');
const OUT_DIR = path.join(ROOT, 'tools', 'trend-insights');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const DRY = flag('dry-run');
const TOP = Math.max(1, parseInt(opt('top', '25'), 10) || 25);
const MIN_CONVICTION = parseFloat(opt('min-conviction', '1.2'));
const MAX_AGE_DAYS = parseInt(opt('max-age-days', '45'), 10) || 45;
const ALLOW_STALE = flag('allow-stale');
const TODAY = new Date().toISOString().slice(0, 10);

const die = (msg) => { console.error(`ABORT: ${msg}`); process.exit(1); };

// ---------------------------------------------------------------- roster
const src = fs.readFileSync(WORKER, 'utf8');
const projMatch = src.match(/const PROJECTIONS = (\[[\s\S]*?\]);/);
if (!projMatch) die('could not locate PROJECTIONS in _worker.js');
const rosterRaw = (0, eval)(projMatch[1]);

// Full PPR, identical to compute-tweet-stats.mjs.
const pprPts = (s) =>
  (s.passYd || 0) * 0.04 + (s.passTD || 0) * 4 - (s.passInt || 0) * 2 +
  (s.rushYd || 0) * 0.1 + (s.rushTD || 0) * 6 +
  (s.rec || 0) * 1 + (s.recYd || 0) * 0.1 + (s.recTD || 0) * 6 -
  (s.fumLost || 0) * 2;

const normTeam = (t) => (t === 'JAC' ? 'JAX' : t);
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

const players = rosterRaw
  .filter((p) => SKILL.has(p.position) && p.team && normTeam(p.team) !== 'FA')
  .map((p) => ({
    name: p.name,
    pos: p.position,
    team: normTeam(p.team),
    pts: pprPts(p.projectedStats || {}),
    stats: p.projectedStats || {},
  }));
if (players.some((p) => !Number.isFinite(p.pts))) die('NaN in projected points');

const rosterTeams = new Set(players.map((p) => p.team));

// Positional + team-role ranks.
const byPos = {};
for (const p of players) (byPos[p.pos] = byPos[p.pos] || []).push(p);
for (const k in byPos) {
  byPos[k].sort((a, b) => b.pts - a.pts);
  byPos[k].forEach((p, i) => { p.posRank = i + 1; });
}
const byTeamPos = {};
for (const p of players) {
  const key = `${p.team}|${p.pos}`;
  (byTeamPos[key] = byTeamPos[key] || []).push(p);
}
for (const k in byTeamPos) {
  byTeamPos[k].sort((a, b) => b.pts - a.pts);
  byTeamPos[k].forEach((p, i) => { p.teamRole = i + 1; }); // 1 = team's top player at pos
}

// Only players plausibly on draft boards get insights.
const RANK_CAP = { QB: 30, RB: 60, WR: 72, TE: 30 };
const relevant = players.filter((p) => p.posRank <= RANK_CAP[p.pos]);

// ---------------------------------------------------------------- context
function loadContext(file, kind) {
  const fp = path.join(CTX_DIR, file);
  if (!fs.existsSync(fp)) { console.error(`SKIP ${file}: missing`); return null; }
  let j;
  try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (e) { die(`${file} unparseable: ${e.message}`); }
  if (j.kind !== kind) die(`${file}: kind "${j.kind}" != expected "${kind}"`);
  const asOf = Date.parse(j.asOf || '');
  if (!Number.isFinite(asOf)) die(`${file}: missing/invalid asOf date`);
  const ageDays = (Date.now() - asOf) / 86400000;
  if (ageDays > MAX_AGE_DAYS && !ALLOW_STALE) {
    console.error(`SKIP ${file}: asOf is ${ageDays.toFixed(0)} days old (> ${MAX_AGE_DAYS}); refresh it or pass --allow-stale`);
    return null;
  }
  for (const team of Object.keys(j.teams || {})) {
    if (!rosterTeams.has(normTeam(team))) die(`${file}: unknown team code "${team}"`);
  }
  const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  for (const [team, t] of Object.entries(j.teams || {})) {
    if (kind === 'coordinators') {
      for (const f of ['passLean', 'playActionLean', 'rbPassGameUsage'])
        if (!inRange(t[f], -2, 2)) die(`${file}: ${team}.${f} out of range`);
      if (!['bellcow', 'lead-plus-change', 'committee'].includes(t.backfieldStyle))
        die(`${file}: ${team}.backfieldStyle invalid`);
    } else if (kind === 'offensive-line') {
      for (const f of ['overallTier', 'runBlockTier', 'passProtectTier'])
        if (!inRange(t[f], 1, 5)) die(`${file}: ${team}.${f} out of range`);
    } else if (kind === 'schedule') {
      for (const f of ['seasonLean', 'champWeeksLean'])
        if (!inRange(t[f], -2, 2)) die(`${file}: ${team}.${f} out of range`);
    }
  }
  console.error(`loaded ${file}: ${Object.keys(j.teams).length} teams, asOf ${j.asOf}`);
  return j;
}

const CO = loadContext('coordinators.json', 'coordinators');
const OL = loadContext('offensive-line.json', 'offensive-line');
const SC = loadContext('schedule.json', 'schedule');
if (!CO && !OL && !SC) { console.error('zero fresh context datasets, nothing to analyze'); process.exit(2); }

// ---------------------------------------------------------------- signals
// A signal: { kind, weight, bestballWeight, why, source }
// kind ∈ coordinator | oline | schedule ; weight sign = direction.

function signalsFor(p) {
  const sigs = [];
  const push = (kind, weight, why, source, bestballWeight) => {
    if (!Number.isFinite(weight) || Math.abs(weight) < 0.05) return;
    const [label, note] = why.includes(': ') ? [why.slice(0, why.indexOf(': ')), why.slice(why.indexOf(': ') + 2)] : [why, why];
    sigs.push({ kind, weight: +weight.toFixed(2), why: label, note, source,
      bestballWeight: +(bestballWeight ?? weight).toFixed(2) });
  };

  const co = CO?.teams[p.team];
  if (co) {
    const srcCo = co.sourcedFrom;
    if (p.pos === 'RB') {
      if (co.backfieldStyle === 'bellcow' && p.teamRole === 1)
        push('coordinator', 2.0, `Locked-in bellcow role: ${co.note}`, srcCo);
      if (co.backfieldStyle === 'committee' && p.teamRole === 1)
        push('coordinator', -1.5, `Committee backfield caps the lead back's ceiling: ${co.note}`, srcCo);
      if (co.backfieldStyle === 'committee' && p.teamRole === 2 && p.pts >= 110)
        push('coordinator', 1.0, `Cheap side of a committee with standalone value: ${co.note}`, srcCo);
      if (co.backfieldStyle === 'lead-plus-change' && p.teamRole === 1)
        push('coordinator', 1.0, `Clear lead-back role: ${co.note}`, srcCo);
      if (co.isNewHire && co.rbPassGameUsage >= 1 && p.teamRole <= 2 && (p.stats.rec || 0) >= 35)
        push('coordinator', 0.75 * co.rbPassGameUsage,
          `New play-caller feeds backs in the passing game: ${co.note}`, srcCo);
    }
    if (p.pos === 'QB' && co.playActionLean >= 1 && p.teamRole === 1)
      push('coordinator', 0.6 * co.playActionLean,
        `Play-action-heavy scheme lifts passing efficiency: ${co.note}`, srcCo);
    if (p.pos === 'TE' && co.playActionLean >= 1 && p.teamRole === 1)
      push('coordinator', 0.5 * co.playActionLean,
        `Play-action and layered middle-of-field throws favor the tight end: ${co.note}`, srcCo);
    if (p.pos === 'WR' && co.playActionLean >= 2 && p.teamRole <= 2)
      push('coordinator', 0.4 * co.playActionLean,
        `Explosive, downfield-leaning scheme: ${co.note}`, srcCo);
    if (co.passLean) {
      if (p.pos === 'QB' || p.pos === 'WR') push('coordinator', 0.5 * co.passLean, co.note, srcCo);
      if (p.pos === 'RB') push('coordinator', -0.3 * co.passLean, co.note, srcCo);
    }
  }

  const ol = OL?.teams[p.team];
  if (ol) {
    const d = (tier) => 3 - tier; // tier1 -> +2 ... tier5 -> -2
    if (p.pos === 'RB' && d(ol.runBlockTier))
      push('oline', 0.75 * d(ol.runBlockTier), `Run blocking tier ${ol.runBlockTier} of 5: ${ol.note}`, ol.sourcedFrom);
    if (p.pos === 'QB' && d(ol.passProtectTier))
      push('oline', 0.6 * d(ol.passProtectTier), `Pass protection tier ${ol.passProtectTier} of 5: ${ol.note}`, ol.sourcedFrom);
    if ((p.pos === 'WR' || p.pos === 'TE') && d(ol.passProtectTier))
      push('oline', 0.5 * d(ol.passProtectTier), `Pass protection tier ${ol.passProtectTier} of 5 shapes target quality: ${ol.note}`, ol.sourcedFrom);
  }

  const sc = SC?.teams[p.team];
  if (sc) {
    if (sc.seasonLean)
      push('schedule', 0.6 * sc.seasonLean, `Season slate lean ${sc.seasonLean > 0 ? '+' : ''}${sc.seasonLean}: ${sc.note}`, sc.sourcedFrom);
    if (sc.champWeeksLean)
      // Half weight in the overall score, full weight for best ball.
      push('schedule', 0.25 * sc.champWeeksLean,
        `Championship-weeks (15 to 17) lean ${sc.champWeeksLean > 0 ? '+' : ''}${sc.champWeeksLean}: ${sc.note}`,
        sc.sourcedFrom, 0.5 * sc.champWeeksLean);
    if (sc.volatility)
      push('schedule', -0.4, `Week-to-week schedule volatility hurts managed-league consistency: ${sc.note}`, sc.sourcedFrom, -0.2);
    if (sc.weather && (p.pos === 'QB' || p.pos === 'WR') && sc.champWeeksLean < 0)
      push('schedule', -0.3, `Late-season weather flag: ${sc.weather}`, sc.sourcedFrom);
  }

  return sigs;
}

// ---------------------------------------------------------------- compose
const KIND_PHRASE = {
  coordinator: 'play-caller tendencies',
  oline: 'offensive-line grade',
  schedule: 'schedule',
};
const clampPct = (v) => Math.max(-15, Math.min(15, v));

// Overall board (all relevant skill players by points) for snake slot math.
const board = [...relevant].sort((a, b) => b.pts - a.pts);
const boardIndex = new Map(board.map((p, i) => [p, i]));
const slotDelta = (p, midPct) => {
  const adj = p.pts * (1 + midPct / 100);
  let newIdx = 0;
  while (newIdx < board.length && board[newIdx].pts > adj) newIdx++;
  if (board[newIdx] === p) newIdx = boardIndex.get(p);
  return boardIndex.get(p) - newIdx; // + = moves up the board
};

function composeInsight(p, sigs) {
  const net = +sigs.reduce((s, x) => s + x.weight, 0).toFixed(2);
  const netBB = +sigs.reduce((s, x) => s + x.bestballWeight, 0).toFixed(2);
  const kindsFor = (sign) => new Set(sigs.filter((x) => Math.sign(x.weight) === sign).map((x) => x.kind));
  const posKinds = kindsFor(1), negKinds = kindsFor(-1);
  const domSign = Math.sign(net);
  const aligned = domSign > 0 ? posKinds : negKinds;
  const conviction = +(Math.abs(net) + Math.max(0, aligned.size - 1) * 0.5).toFixed(2);

  const sumAbs = sigs.reduce((s, x) => s + Math.abs(x.weight), 0);
  let direction;
  if (net >= 1) direction = 'buy';
  else if (net <= -1) direction = 'fade';
  else if (sumAbs >= 2.2 && posKinds.size && negKinds.size) direction = 'mixed';
  else return null;

  const lowPct = clampPct(+(net * 1.5).toFixed(1));
  const highPct = clampPct(+(net * 2.75).toFixed(1));
  const ppg = p.pts / 17;
  const ppgLow = +(ppg * lowPct / 100).toFixed(1);
  const ppgHigh = +(ppg * highPct / 100).toFixed(1);
  const midPct = (lowPct + highPct) / 2;
  const slots = slotDelta(p, midPct);
  const rounds = +(slots / 12).toFixed(1);

  const kindList = [...aligned].map((k) => KIND_PHRASE[k]);
  const listPhrase = kindList.length > 1
    ? kindList.slice(0, -1).join(', ') + ' and ' + kindList[kindList.length - 1]
    : kindList[0];

  let title;
  if (direction === 'mixed') {
    title = `${p.name} is a split decision: ${[...posKinds].map((k) => KIND_PHRASE[k]).join(' + ')} up, ${[...negKinds].map((k) => KIND_PHRASE[k]).join(' + ')} down`;
  } else if (aligned.size >= 2) {
    title = `${p.name} gets a stacked ${direction === 'buy' ? 'green light' : 'red flag'}: ${listPhrase} all point the same way`;
  } else {
    title = `${p.name} is a ${direction} on ${listPhrase} alone`;
  }

  // Body: the strongest signals' labels, then each unique corpus note once.
  const ordered = [...sigs].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const labels = [...new Set(ordered.map((s) => s.why))].slice(0, 3);
  const notes = [...new Set(ordered.map((s) => s.note))].slice(0, 3);
  const body = `${labels.join('. ')}. ${notes.join(' ')}`;

  const absLo = Math.min(Math.abs(lowPct), Math.abs(highPct));
  const absHi = Math.max(Math.abs(lowPct), Math.abs(highPct));
  const sign = domSign >= 0 ? '+' : '-';
  const statLine = `${sign}${absLo}% to ${sign}${absHi}% versus baseline projection (${sign}${Math.min(Math.abs(ppgLow), Math.abs(ppgHigh))} to ${sign}${Math.max(Math.abs(ppgLow), Math.abs(ppgHigh))} PPG, full PPR)`;

  const roundPhrase = (r) => {
    const v = Math.abs(r);
    return `${v} round${v === 1 ? '' : 's'} in a 12-team`;
  };
  const actions = {};
  if (direction === 'buy') {
    actions.auction = `Pay up to ${absHi}% over sheet price before walking away; the environment signals are not in the market price yet.`;
    actions.snake = slots > 0
      ? `Worth taking about ${Math.max(1, Math.round(slots))} slot${Math.round(slots) === 1 ? '' : 's'} (${roundPhrase(rounds)}) ahead of his baseline board position.`
      : `Take him at his current board position with confidence; the trend data supports the price.`;
    actions.bestball = netBB > net
      ? `Extra bump in best ball: the championship-weeks slate adds value exactly when it counts. Move him up a tier in weeks-15-to-17-weighted builds.`
      : `Standard bump in best ball; draft to the high end of the effect range.`;
  } else if (direction === 'fade') {
    actions.auction = `Require roughly ${absLo}% to ${absHi}% off sheet price; let another manager pay for the name.`;
    actions.snake = slots < 0
      ? `Let him fall about ${Math.max(1, Math.round(-slots))} slot${Math.round(-slots) === 1 ? '' : 's'} (${roundPhrase(rounds)}) past his baseline board position before considering.`
      : `Only draft at a discount to his baseline board position.`;
    actions.bestball = netBB < net
      ? `Fade harder in best ball: the championship-weeks slate is hostile right when it matters most. Prefer him in managed leagues where you can bench the bad closing weeks.`
      : `Standard fade in best ball; draft only at the low end of the effect range.`;
  } else {
    actions.auction = `Price him at sheet value, not above: the upside and downside signals roughly cancel, so pay for the baseline, never the story.`;
    actions.snake = `Hold his baseline board position; do not reach on the positive half of the profile.`;
    actions.bestball = `The volatility itself has mild value in best ball, where spike weeks count and bad weeks are benched automatically.`;
  }

  return {
    id: `trend-${TODAY}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    date: TODAY,
    player: p.name, team: p.team, pos: p.pos, posRank: p.posRank,
    baselinePts: +p.pts.toFixed(1), baselinePpg: +ppg.toFixed(1),
    direction, conviction, netSignal: net, netSignalBestball: netBB,
    effectPct: { low: lowPct, high: highPct },
    effectPpg: { low: ppgLow, high: ppgHigh },
    snakeSlotDelta: slots,
    title, body, statLine, actions,
    signals: sigs,
    sources: [...new Set(sigs.map((s) => s.source))],
  };
}

// ---------------------------------------------------------------- run
const insights = [];
for (const p of relevant) {
  const sigs = signalsFor(p);
  if (!sigs.length) continue;
  const ins = composeInsight(p, sigs);
  if (ins && ins.conviction >= MIN_CONVICTION) insights.push(ins);
}
insights.sort((a, b) => b.conviction - a.conviction || a.player.localeCompare(b.player));

// Cap entries per team so one loaded environment (e.g. six Broncos) doesn't
// crowd out the rest of the league; keep the highest-conviction ones.
const PER_TEAM_CAP = 4;
const teamCount = {};
const capped = insights.filter((i) => (teamCount[i.team] = (teamCount[i.team] || 0) + 1) <= PER_TEAM_CAP);
const top = capped.slice(0, TOP);

if (!top.length) { console.error('no insights met the conviction threshold'); process.exit(2); }
for (const i of top)
  for (const v of [i.conviction, i.effectPct.low, i.effectPct.high, i.effectPpg.low, i.effectPpg.high])
    if (!Number.isFinite(v)) die(`non-finite number in insight ${i.id}`);
if (top.some((i) => /—/.test(JSON.stringify(i)))) die('em dash detected in generated copy (style rule violation)');

// ---------------------------------------------------------------- output
const coverage = {
  coordinators: CO ? Object.keys(CO.teams).length : 0,
  offensiveLine: OL ? Object.keys(OL.teams).length : 0,
  schedule: SC ? Object.keys(SC.teams).length : 0,
};
const payload = {
  generatedAt: new Date().toISOString(),
  scoring: 'full PPR (matches compute-tweet-stats.mjs)',
  datasets: {
    coordinators: CO ? { asOf: CO.asOf, teams: coverage.coordinators } : null,
    offensiveLine: OL ? { asOf: OL.asOf, teams: coverage.offensiveLine } : null,
    schedule: SC ? { asOf: SC.asOf, teams: coverage.schedule } : null,
  },
  insightCount: top.length,
  insights: top,
};

const dirEmoji = { buy: 'BUY', fade: 'FADE', mixed: 'MIXED' };
const mdBlocks = top.map((i, n) => [
  `### ${n + 1}. [${dirEmoji[i.direction]}] ${i.title}`,
  ``,
  `**${i.player}** (${i.pos}${i.posRank}, ${i.team}) | baseline ${i.baselinePpg} PPG | conviction ${i.conviction}`,
  ``,
  i.body,
  ``,
  `**Projected effect:** ${i.statLine}`,
  ``,
  `- **Auction:** ${i.actions.auction}`,
  `- **Snake:** ${i.actions.snake}`,
  `- **Best ball:** ${i.actions.bestball}`,
  ``,
  `_Signals: ${i.signals.map((s) => `${s.kind} ${s.weight > 0 ? '+' : ''}${s.weight}`).join(', ')} | Sources: ${i.sources.join('; ')}_`,
].join('\n')).join('\n\n');

const md = `# Trend Insights, ${TODAY}

Data-driven insights cross-referencing play-caller tendencies (${coverage.coordinators} teams), offensive-line grades (${coverage.offensiveLine} teams), and schedule analysis (${coverage.schedule} teams) against the live ${players.length}-player projection set. ${top.length} insights cleared conviction ${MIN_CONVICTION}. Buys: ${top.filter((i) => i.direction === 'buy').length}, fades: ${top.filter((i) => i.direction === 'fade').length}, mixed: ${top.filter((i) => i.direction === 'mixed').length}.

${mdBlocks}
`;

if (DRY) {
  console.log(md);
  console.error(`dry run: would write ${top.length} insights to ${OUT_DIR}/`);
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `trend-insights-${TODAY}.json`);
  const mdPath = path.join(OUT_DIR, `trend-insights-${TODAY}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(mdPath, md);
  console.error(`wrote ${jsonPath}`);
  console.error(`wrote ${mdPath}`);
}
console.error(`done: ${top.length} insights kept (${insights.length} generated, ${capped.length} after the ${PER_TEAM_CAP}-per-team cap, --top=${TOP})`);
