#!/usr/bin/env node
// Guards the Value Coach's coaching-staff grounding.
//   node tools/test-coaching-staffs.mjs
//
// Why this test exists: /api/coach's system prompt invites the model to answer
// staff and scheme questions from its own football knowledge. With nothing to
// check against, it answered them from its training data and told a manager
// that Trevor Lawrence would benefit from Doug Pederson — two Jacksonville
// hires out of date, and stated as confidently as a right answer would be.
// index.html now carries STAFFS_2026, a table quoted from this repo's own
// pages, and the prompt hands that table to the model as authoritative.
//
// Three things can silently break that, so all three are asserted here:
//   1. the table stops reaching the prompt (a rename, a dropped concat);
//   2. the table drifts from the pages it was quoted from — a coach who moved
//      teams in an Auction Watch but not in the table;
//   3. a page names a coach for a team the table assigns to someone else,
//      which is the same misattribution bug in the static copy instead.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const client = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── 1. the table exists and is wired into the prompt ───────────────────────
const decl = client.match(/const STAFFS_2026 = \{[\s\S]*?\n\};/);
ok('index.html declares STAFFS_2026', !!decl);
if (!decl) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

const STAFFS = new Function(`${decl[0]}\nreturn STAFFS_2026;`)();
ok('STAFFS_2026 covers the teams the site writes about', Object.keys(STAFFS).length >= 15,
  `${Object.keys(STAFFS).length} teams`);

ok('the staff block is built from STAFFS_2026',
  /_staffCtx = [\s\S]{0,400}STAFFS_2026/.test(client));
ok('the staff block reaches the system prompt',
  /const sys = _coachId \+ _seasonCtx \+ _staffCtx/.test(client));
ok('the prompt tells the model the table beats its memory',
  /overrides your memory on every team named/.test(client));
ok('the prompt refuses to guess for teams off the table',
  /not certain who is running that staff/.test(client));
ok('the prompt no longer offers coaching staffs as free-recall territory',
  !/answer ANY football question, including coaching staffs/.test(client));

// ── 2 & 3. the table agrees with every page that names a coach ─────────────
// Only the surnames the corpus actually uses as coaches. A first name is kept
// where the surname alone is ambiguous against a player (Johnson, Moore).
const COACHES = [
  'Mike LaFleur', 'Dave Canales', 'Ben Johnson', 'Todd Monken', 'Dan Campbell',
  'Drew Petzing', 'Shane Steichen', 'Liam Coen', 'Andy Reid', 'Mike McDaniel',
  'Klint Kubiak', 'Mike Vrabel', 'Kellen Moore', 'John Harbaugh', 'Matt Nagy',
  'Aaron Glenn', 'Mike McCarthy', 'Todd Bowles', 'Brian Daboll',
];
// Where each table row's coaches live, so a page naming a coach beside a team
// chip can be checked against the row for that team.
const teamOf = new Map();
for (const [team, staff] of Object.entries(STAFFS)) {
  for (const c of COACHES) if (staff.includes(c)) teamOf.set(c, team);
}
ok('every coach the corpus names appears in STAFFS_2026',
  COACHES.every(c => teamOf.has(c)),
  COACHES.filter(c => !teamOf.has(c)).join(', '));

// The coaching column is the one place that pairs a coach with a team chip in
// markup, which makes it mechanically checkable. Every other page states the
// pairing in prose, so it is covered by the phrase scan below instead.
const column = fs.readFileSync(path.join(ROOT, 'play-caller-premium.html'), 'utf8');
for (const art of column.match(/<article class="call"[\s\S]*?<\/article>/g) || []) {
  const id = (art.match(/id="([^"]+)"/) || [])[1];
  const team = (art.match(/class="cteam">([A-Z]+)</) || [])[1];
  const head = (art.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '';
  // The headline names the coach the entry is about; the body is free to cite
  // his previous stops, so only the headline is checked against the chip.
  for (const c of COACHES) {
    if (!head.includes(c)) continue;
    ok(`${id}: ${c} matches its ${team} chip`, teamOf.get(c) === team,
      `table says ${teamOf.get(c)}`);
  }
}

// A page introducing a coach as a team's current coach, for a team the table
// gives to someone else, is the same misattribution written into static copy.
// The patterns stay deliberately narrow: this column's whole method is citing a
// coach's PREVIOUS stops ("Daboll's Giants offenses", "Moore left for
// Philadelphia in 2024"), so anything that reads as career history has to pass.
// Only an explicit present-tense introduction counts, and the team name has to
// sit right on top of it rather than somewhere earlier in the sentence — an
// opponent named a clause away is not a job title.
const NAMES = {
  ARI: ['Cardinals', 'Arizona'], CAR: ['Panthers', 'Carolina'], CHI: ['Bears', 'Chicago'],
  CLE: ['Browns', 'Cleveland'], DET: ['Lions', 'Detroit'], IND: ['Colts', 'Indianapolis'],
  JAX: ['Jaguars', 'Jacksonville'], KC: ['Chiefs', 'Kansas City'], LAC: ['Chargers'],
  LV: ['Raiders', 'Las Vegas'], NE: ['Patriots', 'New England'], NO: ['Saints', 'New Orleans'],
  NYG: ['Giants'], NYJ: ['Jets'], PIT: ['Steelers', 'Pittsburgh'],
  TB: ['Buccaneers', 'Bucs', 'Tampa Bay'], TEN: ['Titans', 'Tennessee'],
};
const TITLE = '(?:head coach|Head coach|HC|new coach|new head coach)';
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const clashes = [];
for (const f of pages) {
  const txt = fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/&rsquo;|&#x27;|&#39;/g, "'").replace(/&#8209;/g, '-').replace(/\s+/g, ' ');
  for (const c of COACHES) {
    const home = teamOf.get(c);
    for (const [team, words] of Object.entries(NAMES)) {
      if (team === home) continue;
      for (const w of words) {
        const re = new RegExp(
          `(${w}(?:'s)? ${TITLE} ${c}\\b`                      // "Jaguars head coach Liam Coen"
          + `|${TITLE} ${c}[^.,]{0,12} (?:of|for) the ${w}\\b`  // "head coach Liam Coen of the Jaguars"
          + `|${c}[^.,]{0,40}(?:now coaches|now calls the plays for|now runs|took over|just took over|was hired by)[^.,]{0,25}${w}\\b)`);
        const m = txt.match(re);
        if (m) clashes.push(`${f}: "${m[0].slice(0, 90)}" but STAFFS_2026 has ${c} at ${home}`);
      }
    }
  }
}
ok('no page assigns a coach to a team the table gives to someone else', clashes.length === 0,
  '\n      ' + clashes.join('\n      '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
