#!/usr/bin/env node
// Tests for the Vegas odds -> projections pipeline.
//   node tools/test-vegas.mjs
// Covers the de-vig / median->mean math, the combined-TD split, and an
// end-to-end weighted merge run against a scratch copy of _worker.js.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { impliedProb, devigOver, probit, expectedTotal, buildSource, norm } from './vegas-to-projections.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('\nimplied probability');
ok('-110 favourite', near(impliedProb(-110), 110 / 210, 1e-9));
ok('+150 underdog', near(impliedProb(150), 100 / 250, 1e-9));
ok('even money', near(impliedProb(100), 0.5, 1e-9));
ok('rejects garbage', impliedProb('abc') === null);

console.log('\nde-vig');
ok('symmetric -110/-110 -> 0.5', near(devigOver(-110, -110), 0.5, 1e-9));
{
  const p = devigOver(-140, 110);
  ok('juiced over > 0.5', p > 0.5, `got ${p}`);
  ok('de-vigged pair sums to 1', near(p + devigOver(110, -140), 1, 1e-9));
}

console.log('\nprobit');
ok('median is 0', near(probit(0.5), 0, 1e-9));
ok('97.5th pct ~ 1.96', near(probit(0.975), 1.959964, 1e-4));
ok('2.5th pct ~ -1.96', near(probit(0.025), -1.959964, 1e-4));

console.log('\nline -> expected total');
ok('balanced price returns the line', near(expectedTotal(4000, 0.5, 'passYd'), 4000, 1e-6));
{
  const hi = expectedTotal(4000, 0.60, 'passYd');
  const lo = expectedTotal(4000, 0.40, 'passYd');
  ok('over-juiced line projects above the line', hi > 4000, `got ${hi}`);
  ok('under-juiced line projects below the line', lo < 4000, `got ${lo}`);
  ok('skew is symmetric about the line', near(hi - 4000, 4000 - lo, 1e-6));
  ok('correction stays modest near 50/50', hi - 4000 < 4000 * 0.06, `got ${hi - 4000}`);
  ok('missing price falls back to the line', near(expectedTotal(4000, null, 'passYd'), 4000));
  ok('never negative', expectedTotal(1, 0.001, 'recTD') >= 0);
}

console.log('\nbuildSource');
{
  const books = [{
    book: 'bookA', publishedAt: '2026-08-14T00:00:00Z', fetchedAt: '2026-08-15T00:00:00Z',
    markets: [
      { player: 'Josh Allen', position: 'QB', team: 'BUF', market: 'passYd', line: 4000, overOdds: -110, underOdds: -110 },
      { player: 'Josh Allen', position: 'QB', team: 'BUF', market: 'passTD', line: 28.5, overOdds: -110, underOdds: -110 }
    ]
  }, {
    book: 'bookB', publishedAt: '2026-08-15T00:00:00Z', fetchedAt: '2026-08-15T00:00:00Z',
    markets: [
      { player: 'Josh Allen', position: 'QB', team: 'BUF', market: 'passYd', line: 4200, overOdds: -110, underOdds: -110 }
    ]
  }];
  const { players, marketCount } = buildSource(books);
  ok('one player across two books', players.length === 1);
  ok('counted every market', marketCount === 3, `got ${marketCount}`);
  ok('consensus is the mean of books', near(players[0].stats.passYd, 4100, 1e-6), JSON.stringify(players[0].stats));
  ok('TD stat keeps one decimal', near(players[0].stats.passTD, 28.5, 1e-9), String(players[0].stats.passTD));

  const unknown = buildSource([{ book: 'x', publishedAt: '2026-08-14T00:00:00Z', markets: [
    { player: 'Nobody', position: 'WR', market: 'jerseyNumber', line: 5, overOdds: -110, underOdds: -110 }
  ] }]);
  ok('unknown market is dropped, not guessed', unknown.players.length === 0 && unknown.warnings.length === 1);
}

console.log('\nscrimmageTD split');
{
  // Current site line: 12 rush TD / 3 rec TD -> 80% of scrimmage TDs are rushing.
  const current = new Map([['bijanrobinson|RB', { stats: { rushTD: 12, recTD: 3 } }]]);
  const { players } = buildSource([{ book: 'a', publishedAt: '2026-08-14T00:00:00Z', markets: [
    { player: 'Bijan Robinson', position: 'RB', team: 'ATL', market: 'scrimmageTD', line: 10, overOdds: -110, underOdds: -110 }
  ] }], current);
  const s = players[0].stats;
  ok('combined market is split, not passed through', s.scrimmageTD === undefined);
  ok('split follows the current rush/rec ratio', s.rushTD === 8 && s.recTD === 2, JSON.stringify(s));

  const noCur = buildSource([{ book: 'a', publishedAt: '2026-08-14T00:00:00Z', markets: [
    { player: 'Ghost Player', position: 'WR', market: 'scrimmageTD', line: 10, overOdds: -110, underOdds: -110 }
  ] }]).players[0].stats;
  // WR norm is a 95/5 rec/rush split of the 10 scrimmage TDs, kept at one decimal.
  ok('unknown player falls back to position norms', near(noCur.recTD, 9.5) && near(noCur.rushTD, 0.5), JSON.stringify(noCur));
}

console.log('\nend-to-end weighted merge');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itmerge-'));
  const workerSrc = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.mkdirSync(path.join(tmp, 'tools', 'sources'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '_worker.js'), workerSrc);
  fs.writeFileSync(path.join(tmp, 'index.html'), idxSrc);
  fs.copyFileSync(path.join(ROOT, 'tools', 'merge-projections.mjs'), path.join(tmp, 'tools', 'merge-projections.mjs'));

  // Read the real pool so the fixtures name players that actually exist.
  const start = workerSrc.indexOf('const PROJECTIONS = [');
  const re = /\{ name: "([^"]+)", position: "([^"]+)", team: "([^"]+)", projectedStats: \{ ([^}]*) \}\}/g;
  const pool = [];
  let m;
  while ((m = re.exec(workerSrc.slice(start, workerSrc.indexOf('\n];', start))))) {
    const stats = {};
    for (const kv of m[4].split(',')) {
      const p = kv.trim().match(/^(\w+): (-?[\d.]+)$/);
      if (p) stats[p[1]] = parseFloat(p[2]);
    }
    pool.push({ name: m[1], position: m[2], team: m[3], stats });
  }
  const qbs = pool.filter(p => p.position === 'QB' && p.stats.passYd > 0).slice(0, 40);
  const now = new Date().toISOString();
  // Same 40 players in both sources, disagreeing on passYd by a known amount.
  const espn = qbs.map(p => ({ name: p.name, position: p.position, team: p.team, stats: { passYd: 3000 } }));
  const vegas = qbs.map(p => ({ name: p.name, position: p.position, team: p.team, stats: { passYd: 5000 } }));
  fs.writeFileSync(path.join(tmp, 'tools', 'sources', 'espn.json'),
    JSON.stringify({ source: 'espn', publishedAt: now, fetchedAt: now, players: espn }));
  fs.writeFileSync(path.join(tmp, 'tools', 'sources', 'vegas.json'),
    JSON.stringify({ source: 'vegas', publishedAt: now, fetchedAt: now, players: vegas }));

  let out = '';
  try {
    out = execFileSync('node', ['tools/merge-projections.mjs'], { cwd: tmp, encoding: 'utf8', env: { ...process.env } });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    ok('merge ran', false, out.slice(-400));
  }
  ok('merge reported the vegas weight', /weight vegas = 3/.test(out), out.slice(0, 300));
  const merged = fs.readFileSync(path.join(tmp, '_worker.js'), 'utf8');
  const first = qbs[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const got = merged.match(new RegExp(`\\{ name: "${first}"[^}]*passYd: ([\\d.]+)`));
  // vegas 3 : espn 1  ->  (3*5000 + 1*3000) / 4 = 4500
  ok('weighted mean lands 75% toward Vegas', got && near(parseFloat(got[1]), 4500, 0.05), got ? got[1] : 'no match');

  // Same inputs, equal weights -> the old plain average.
  fs.writeFileSync(path.join(tmp, '_worker.js'), workerSrc);
  fs.writeFileSync(path.join(tmp, 'index.html'), idxSrc);
  execFileSync('node', ['tools/merge-projections.mjs'], {
    cwd: tmp, encoding: 'utf8', env: { ...process.env, SOURCE_WEIGHT_VEGAS: '1' }
  });
  const eq = fs.readFileSync(path.join(tmp, '_worker.js'), 'utf8')
    .match(new RegExp(`\\{ name: "${first}"[^}]*passYd: ([\\d.]+)`));
  ok('SOURCE_WEIGHT_VEGAS=1 restores the plain mean', eq && near(parseFloat(eq[1]), 4000, 0.05), eq ? eq[1] : 'no match');

  // A stat only ESPN carries must be untouched by the Vegas weighting.
  ok('unpriced stats keep their own blend',
    /passInt: /.test(merged) && !/passInt: NaN/.test(merged));

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
