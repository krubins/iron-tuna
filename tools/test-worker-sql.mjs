#!/usr/bin/env node
// Every SQL statement in the worker binds as many values as it has ?.
//   node tools/test-worker-sql.mjs
//
// THE BUG THIS EXISTS FOR. `leagueCreateRow` inserts an eighteen-column row.
// Its VALUES list ended `…,?,0)` — seventeen placeholders and a literal zero
// for `failures` — while `.bind()` passed eighteen values, the last of them a
// 0 with no placeholder left to take it. D1 answers that with
//
//     D1_ERROR: Wrong number of parameter bindings for SQL query.
//
// and it answered it for EVERY league ever created, on every provider, from
// the day the feature shipped. Nothing caught it: the statement parses, the
// file parses, and the suites around it exercise the readers rather than the
// writes, because a write needs a database. The reader who found it had pasted
// a roster grid, watched twelve teams come back, pressed Save, and been handed
// a database error.
//
// It is the kind of mistake nobody makes twice in the same line and everybody
// makes eventually in a new one: placeholders and binds are written at
// opposite ends of a long statement, and only the database counts them.
//
// WHAT THIS CHECKS. Two things, both without a network and without Cloudflare.
//
//  1. Parity, over every `prepare('…literal SQL…').bind(…)` pair in the file:
//     the count of ? in the statement equals the number of arguments bound.
//     Arguments are split at top-level commas, so a bind of `a ? b : c` or
//     `f(x, y)` counts once, as it should.
//
//  2. The league statements, prepared against the league schema itself, in an
//     in-memory SQLite built from LEAGUE_DDL. That catches a column name the
//     schema does not have as well as a count that does not line up — SQLite
//     is not D1, but the two agree about both of those.
//
// A statement built by string interpolation is skipped by the first check
// (its ? count is not knowable here) and everything else is read as written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');

let pass = 0, fail = 0;
function ok(what, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${what}`); }
  else { fail++; console.log(`  FAIL ${what}${detail ? ' — ' + detail : ''}`); }
}
const lineOf = (i) => src.slice(0, i).split('\n').length;

// A JS string or a parenthesised run, walked with quotes respected so that a
// bracket inside 'a (b' cannot move the depth.
function closer(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  let depth = 0, quote = null, esc = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (pairs[ch]) depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (!depth) return i; }
  }
  return -1;
}
// Top-level commas only: `.bind(a, f(b, c), d ? e : g)` is three values.
function args(text) {
  const out = [];
  let depth = 0, quote = null, esc = false, cur = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Every literal statement in the file, with whatever it binds.
const stmts = [];
for (const m of src.matchAll(/\.prepare\(/g)) {
  const open = m.index + m[0].length - 1;
  const close = closer(src, open);
  if (close < 0) continue;
  const expr = src.slice(open + 1, close).trim();
  if (!/^['"`]/.test(expr)) continue;                 // built at runtime, not readable here
  const sql = expr.slice(1, -1);
  if (expr[0] === '`' && sql.includes('${')) continue; // interpolated, same reason
  let k = close + 1;
  while (k < src.length && /\s/.test(src[k])) k++;
  const bound = src.startsWith('.bind(', k) ? args(src.slice(k + 6, closer(src, k + 5))) : null;
  stmts.push({ line: lineOf(m.index), sql, bound });
}

console.log('every statement binds what it asks for');
{
  ok('the worker still holds its SQL', stmts.length > 100, `${stmts.length} statements`);
  const off = stmts.filter(s => s.bound && (s.sql.match(/\?/g) || []).length !== s.bound.length);
  ok('placeholders and bound values agree, statement by statement', off.length === 0,
    off.map(s => `_worker.js:${s.line} has ${(s.sql.match(/\?/g) || []).length} ? for ${s.bound.length} values — ${s.sql.slice(0, 70)}…`).join('; '));
  const withBinds = stmts.filter(s => s.bound).length;
  console.log(`  (${stmts.length} literal statements, ${withBinds} of them bound)`);
}

// ── the league writes, against the league schema ───────────────────────────
// LEAGUE_DDL is the schema the worker creates for itself, so preparing the
// league statements against it is the closest thing to D1 that runs offline.
console.log('\nthe league statements, against the schema the worker creates');
{
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) { /* older node */ }
  if (!DatabaseSync) {
    console.log('  SKIP — this node has no node:sqlite');
  } else {
    const head = src.indexOf('const LEAGUE_DDL = [');
    const ddl = [...src.slice(head, src.indexOf('\n];', head)).matchAll(/'((?:[^'\\]|\\.)*)'/g)]
      .map(m => m[1].replace(/\\'/g, "'"))
      .filter(q => /^CREATE /i.test(q));
    ok('the league schema is in the worker', ddl.length >= 8, `${ddl.length} statements`);

    const db = new DatabaseSync(':memory:');
    let made = true;
    for (const q of ddl) { try { db.exec(q); } catch (e) { made = false; ok('schema applies', false, e.message); break; } }
    if (made) {
      ok('the schema applies cleanly', true);
      const league = stmts.filter(s => /\b(leagues|league_teams|league_roster_players|league_matchups|league_transactions|league_snapshots|league_sync_runs|player_id_map|player_map_misses|provider_connections|league_provider_tokens)\b/.test(s.sql));
      ok('there are league statements to check', league.length > 10, `${league.length} statements`);
      const broken = [];
      for (const s of league) {
        try { db.prepare(s.sql); } catch (e) { broken.push(`_worker.js:${s.line} — ${e.message} — ${s.sql.slice(0, 70)}…`); }
      }
      ok('every league statement prepares against it', broken.length === 0, broken.join('; '));

      // The row the reader's Save writes first. It is named here because this
      // is the one that was broken, and a statement that parses can still
      // refuse the values a caller passes it.
      const ins = league.find(s => /^INSERT INTO leagues \(/.test(s.sql));
      ok('creating a league is still an insert into leagues', !!ins);
      if (ins) {
        const n = (ins.sql.match(/\?/g) || []).length;
        const now = Date.now();
        const values = ['id-1', 'reader@example.com', 'manual', 'manual-abc', 'A league', 2026, 'nfl', 12,
          'unknown', '{}', '{}', 'm1', 1, now, now, 'manual', now, 0].slice(0, n);
        let wrote = null;
        try {
          db.prepare(ins.sql).run(...values);
          wrote = db.prepare('SELECT id, num_teams, user_team_id, sync_status FROM leagues WHERE id=?').get('id-1');
        } catch (e) { wrote = { error: e.message }; }
        ok('and a league row goes in', wrote && !wrote.error, wrote && wrote.error);
        ok('with the columns the caller meant', !!wrote && wrote.num_teams === 12 && wrote.user_team_id === 'm1' && wrote.sync_status === 'manual',
          JSON.stringify(wrote));
      }
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
