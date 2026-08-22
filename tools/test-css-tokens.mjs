#!/usr/bin/env node
// Every var(--token) on the site resolves to a definition the page can see.
//   node tools/test-css-tokens.mjs
//
// THE BUG THIS EXISTS FOR. The royal-blue re-skin renamed `--red` to `--brand`
// and `--value-red`. The Pick's front-page band was on a branch at the time and
// still said `color: var(--red)`. The two changes touched different lines of
// front.html, so **git merged them without a conflict**, and both CI suites
// passed on the merge commit that shipped it: an undefined custom property is
// not a parse error, it is "invalid at computed-value time" — the declaration is
// thrown away and the property inherits instead. The symptom was one module on
// the front page that did not light up on hover, which is exactly the size of
// bug that survives review and ships.
//
// Nothing else here could have caught it. The script-parse steps only read
// <script>; the two rebuild gates only compare generated output; every other
// suite is JavaScript. This file is the only thing in the repo that reads CSS.
//
// It also caught two older ones on first run, both in index.html: `.cheat-whb-h`
// (a rendered element) asked for `var(--text)`, which has never existed in that
// file's palette — the heading above a `--text-muted` subtitle was silently
// inheriting; and the `.lp-mode-*` rules asked for `--mode-accent`, a value the
// card was supposed to set on itself, where `.lp-mode-dot` already spelled the
// fallback and the others did not.
//
// WHAT COUNTS AS RESOLVED. A token is fine if the same file defines it anywhere
// — this is a spelling check, not a cascade simulation, and modelling which
// selector is in scope for which element is a job for a browser. `var(--x, …)`
// with a fallback is always fine: that is the language's own way of saying "this
// may not be set", and it is how a component-scoped value like --mode-accent is
// meant to be written.
//
// The narrowness is the point. It cannot tell you a token is the WRONG colour,
// only that it is nobody's colour at all — but that is the failure that is
// invisible in review, and it is now impossible to merge.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// A use is `var(--x)` with NO comma before the closing paren. The optional
// capture group is how the two are told apart in one pass.
const USE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
// A definition is `--x:` in a stylesheet, in a style="" attribute, or as a
// quoted key in a React style object — `{'--mode-accent': '#fff'}` is how this
// app would set one at render time, and the quote is why the bare pattern below
// is joined by a quoted one.
const DEF = /(--[A-Za-z0-9_-]+)\s*:/g;
const DEF_QUOTED = /['"](--[A-Za-z0-9_-]+)['"]\s*:/g;

const usedIn = (src) => {
  const out = new Set();
  for (const m of src.matchAll(USE)) if (!m[2]) out.add(m[1]);
  return out;
};
const definedIn = (src) => {
  const out = new Set();
  for (const m of src.matchAll(DEF)) out.add(m[1]);
  for (const m of src.matchAll(DEF_QUOTED)) out.add(m[1]);
  return out;
};

// A page can also see tokens from a stylesheet it links, so those are read and
// folded in. Only same-origin, on-disk hrefs — a CDN font stylesheet defines
// nothing this site uses and cannot be read here anyway.
function linkedSheets(src) {
  const out = [];
  for (const m of src.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)) {
    const href = (m[0].match(/href=["']([^"']+)["']/) || [])[1];
    if (!href || /^https?:|^\/\//.test(href)) continue;
    const f = href.replace(/^\//, '').split(/[?#]/)[0];
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  return out;
}

// Tokens set from JavaScript at runtime, which no static read of the file can
// see. Every entry needs a reason and a file — this list is a place for facts
// about the code, not a place to silence a finding. It is empty, and a change
// that needs to add to it should say why in review.
const RUNTIME = {};

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

console.log('\nevery var(--token) resolves to a definition the page can see');
{
  const broken = [];
  let checked = 0, tokens = 0;
  for (const f of pages) {
    const src = read(f);
    const used = usedIn(src);
    if (!used.size) continue;
    checked++;
    tokens += used.size;
    const defined = definedIn(src);
    for (const sheet of linkedSheets(src)) for (const t of definedIn(read(sheet))) defined.add(t);
    for (const t of RUNTIME[f] || []) defined.add(t);
    for (const t of used) if (!defined.has(t)) broken.push(`${f}: ${t}`);
  }
  ok('there are pages with custom properties to check', checked > 0, String(checked));
  ok('the scan actually found tokens', tokens > 0, String(tokens));
  ok('no page uses a token nothing defines', broken.length === 0, broken.join('; '));
  console.log(`  (${checked} pages, ${tokens} distinct token uses)`);
}

// The regression itself, named. The bug above was a *renamed* token, so the
// palette a rename would move is asserted directly: a re-skin that drops one of
// these has to come here and see which modules it is about to break.
console.log('\nthe front page palette the modules are written against');
{
  const front = read('front.html');
  const root = (front.match(/:root\{([^}]*)\}/) || [])[1] || '';
  const defined = definedIn(root);
  const PALETTE = ['--brand', '--ink', '--ink-2', '--ink-3', '--line', '--bg', '--card', '--gold', '--teal'];
  const gone = PALETTE.filter((t) => !defined.has(t));
  ok('front.html still declares its palette on :root', gone.length === 0, gone.join(', '));

  // --red was the token the re-skin removed. Naming it keeps the story
  // attached to the check: if it ever comes back, it comes back defined.
  const usesRed = [...usedIn(front)].includes('--red');
  ok('nothing on the front page still reaches for the retired --red',
    !usesRed || defined.has('--red'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
