#!/usr/bin/env node
// What the board grades a player name against.
//   node tools/test-board-colour.mjs
//
// THE HISTORY MATTERS, because it is easy to get this wrong twice.
//
// The name is coloured by comparing Proj (the likely market price) against what
// the player is worth. "Worth" was Value — the VBD price in a vacuum — which
// paints a star red for costing more than his vacuum price even when he is the
// one player holding your starting lineup together.
//
// PR #66 changed it to grade against YOU (`personalValue`) instead, on the
// premise that "for positions with scarcity, YOU will often exceed Value". That
// premise is false. YOU is `switchPrice`, an INDIFFERENCE price: the most you
// can pay before the player stops improving your lineup. Measured on a fresh
// board it sat above Value on 3 of 232 rows, by at most $1, and below it on 81.
// Grading against it could only ever paint MORE red, and it did: red went 42 ->
// 89 and green collapsed 53 -> 11 out of 232.
//
// It now grades against Value plus a scarcity premium, which restores the old
// distribution and then improves on it (37 red, 58 green) by lifting exactly
// the players the old rule got wrong. The assertions below pin the shape of
// that premium so neither mistake can come back.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── lift the two pure functions out of the app ─────────────────────────────
const START = 'function scarcityPremium(fl, budget) {';
const END = 'function TeamsBoard({';
const a = src.indexOf(START), b = src.indexOf(END, a);
if (a < 0 || b < 0) { console.error('FAIL: could not locate the grading helpers in index.html'); process.exit(1); }
const { scarcityPremium, boardValue, boardGrade, boardGradeColor } = new Function(`
  ${src.slice(a, b)}
  return { scarcityPremium, boardValue, boardGrade, boardGradeColor };
`)();

const CFG = { budget: 200 };

console.log('\nwhat the cliff premium is worth');
{
  ok('no cliff, no premium', scarcityPremium(null, 200) === 0);
  // A lone player above a cliff is scarcer than one of three above the same one.
  const alone = scarcityPremium({ count: 1, gapPts: 30 }, 200);
  const crowd = scarcityPremium({ count: 3, gapPts: 30 }, 200);
  ok('standing alone above a cliff beats sharing it', alone > crowd, `${alone} vs ${crowd}`);
  // A bigger drop is worth more, but not without limit.
  ok('a bigger drop is worth more',
     scarcityPremium({ count: 1, gapPts: 30 }, 200) > scarcityPremium({ count: 1, gapPts: 8 }, 200));
  ok('the premium is capped at 15% of the budget',
     scarcityPremium({ count: 1, gapPts: 100000 }, 200) <= 30);
  ok('it scales with the budget, not with dollars',
     scarcityPremium({ count: 1, gapPts: 30 }, 400) > scarcityPremium({ count: 1, gapPts: 30 }, 200));
}

console.log('\nwhat the board grades a name against');
{
  const plain = { planTarget: false, scarce: null, planPrem: null };
  ok('an ordinary player is graded on Value alone', boardValue(plain, 40, CFG) === 40);
  ok('a null Value stays null', boardValue(plain, null, CFG) === null);
  ok('a missing player object does not throw', boardValue(null, 40, CFG) === 40);

  // The premium is for players the plan actually needs. Wanting him is not
  // enough on its own — there has to be something that costs you to miss.
  const wanted = { planTarget: true, scarce: null, planPrem: null };
  ok('a plan target with no scarcity behind him gets nothing',
     boardValue(wanted, 40, CFG) === 40);

  const needed = { planTarget: true, scarce: null, planPrem: { prem: 9, repName: 'X', repAsk: 20, repVal: 11 } };
  ok('a plan target whose replacement is overpriced is lifted',
     boardValue(needed, 40, CFG) === 49);

  const cliff = { planTarget: false, scarce: { count: 1, gapPts: 30 }, planPrem: null };
  ok('a player above a real cliff is lifted even if this plan does not claim him',
     boardValue(cliff, 40, CFG) > 40);

  // Both premiums read the SAME scarcity from two angles. Stacking them would
  // double-count it, so the larger wins.
  const both = { planTarget: true, scarce: { count: 1, gapPts: 30 }, planPrem: { prem: 5, repName: 'X', repAsk: 9, repVal: 4 } };
  const viaCliff = 40 + scarcityPremium(both.scarce, 200);
  ok('the two premiums do not stack', boardValue(both, 40, CFG) === Math.max(45, viaCliff), String(boardValue(both, 40, CFG)));
  ok('...and the larger of the two is the one that counts', boardValue(both, 40, CFG) === viaCliff);
}

console.log('\nthe rule the renderer and the export both follow');
{
  // Regression guards for PR #66's mistake. `you` must not be what the name is
  // graded against, in either place.
  ok('the name is coloured through boardGrade', src.includes('nameColor = boardGradeColor(grade, cost)'));
  ok('the name is NOT coloured against YOU', !src.includes('nameColor = costColor(cost, you)'));
  ok('the name is NOT coloured against the ceiling', !src.includes('nameColor = costColor(cost, graded)'));
  ok('the grade comes from boardGrade', src.includes('const grade = boardGrade(p, value, cost, config)'));
  // The CSV/AI flag and the on-screen colour must agree, or a reader gets two
  // different answers to "why is he red".
  ok('the export grades with the same function', src.includes('const _b = boardGrade(p, p.auctionValue, p.marketValue, config)'));
  ok('the export no longer talks about You', !/Proj (above|below) You/.test(src));
  // The premium's own definition, in the memo that has the plan and the pool.
  ok('the plan premium is capped at 10% of the budget',
     /const cap = Math\.round\(\(config\.budget \|\| 200\) \* 0\.10\)/.test(src));
  ok('the replacement skips players the plan already claimed',
     /arr\.slice\(idx \+ 1\)\.find\(pl => !planTargetIds\.has\(pl\.id\)\)/.test(src));
  ok('the premium is how far the replacement is priced above his own worth',
     /Math\.max\(0, Math\.min\(cap, Math\.round\(repAsk - repVal\)\)\)/.test(src));
  // The coach must describe the rule the board actually uses.
  ok('the AI legend describes Proj against Value', /explain it from his Proj against Value/.test(src));
  ok('the AI is told YOU is a ceiling, not a grade', /indifference/.test(src));
}

// ── what the row is allowed to CLAIM ───────────────────────────────────────
// Reported from a real 10-team $150 board: Josh Allen showed a $31 Proj against
// a printed $27 Value and came out GREEN, with hover text citing "the $38 he is
// worth on your board" — a number in no column of that row. The premium is not
// the problem; quoting it as his worth, and letting it paint green over two
// visible numbers that say "slightly over", is.
console.log('\nthe premium can cancel red, never manufacture green');
{
  // The reported row, to the dollar: Value 27, Proj 31, an 11-dollar cliff premium.
  const allen = { planTarget: false, planPrem: null, scarce: { count: 1, gapPts: 33 } };
  const prem = scarcityPremium(allen.scarce, 150);
  const g = boardGrade(allen, 27, 31, { budget: 150 });
  ok('the ceiling is still Value plus the premium', g.ceiling === 27 + prem, `${g.ceiling}`);
  ok('a price ABOVE the printed Value is never green', g.sign !== 'under', g.sign);
  ok('...and the premium keeps it out of red too', g.sign === 'neutral', g.sign);
  ok('a neutral name takes no tint', boardGradeColor(g, 31) === 'var(--text-primary)');

  // Green still means exactly what the two printed columns show.
  const cheap = boardGrade(allen, 27, 18, { budget: 150 });
  ok('Proj below Value is green', cheap.sign === 'under');
  ok('green is measured off Value, not off the ceiling',
     boardGradeColor(cheap, 18) === boardGradeColor({ ...cheap, ceiling: cheap.value, premium: 0 }, 18));

  // Past the ceiling the premium has nothing left to give.
  const dear = boardGrade(allen, 27, 27 + prem + 6, { budget: 150 });
  ok('a price past the ceiling is red', dear.sign === 'over');

  // A player with no premium grades on Value alone, unchanged.
  const plainP = { planTarget: false, scarce: null, planPrem: null };
  ok('no premium, no band', boardGrade(plainP, 40, 45, CFG).sign === 'over');
  ok('no premium, still green below Value', boardGrade(plainP, 40, 30, CFG).sign === 'under');
  ok('a dollar either way is noise', boardGrade(plainP, 40, 41, CFG).sign === 'neutral');
  ok('a null Value cannot be graded', boardGrade(plainP, null, 10, CFG).sign === 'neutral');
}

console.log('\nwhat the hover text is allowed to say');
{
  ok('it quotes the Value the row prints',
     /Good buy: the \$\$\{cost\} price is about \$\$\{tgap\} under his \$\$\{value\} Value/.test(src));
  // The comment above boardGrade quotes the old wording on purpose, so match the
  // template that would actually render rather than the prose describing it.
  ok('it no longer asserts a worth the row does not show',
     !/\$\{graded\} he is worth on your board/.test(src) && !/what he is worth on your board \(/.test(src));
  ok('the ceiling is named as Value plus a premium, not as his worth',
     /Your board would go to \$\$\{graded\} for him: the \$\$\{value\} Value plus a \$\$\{_prem\} scarcity premium/.test(src));
  ok('the premium is visible in the row, not only on hover',
     /className: "cheat-prem"/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
