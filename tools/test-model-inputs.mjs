#!/usr/bin/env node
// The cheat sheet's "Ideal Team" and the auction board's projected best team must be the
// SAME roster. They are, only as long as every screen that builds my team's plan hands
// buildModel the same inputs.
//
//   node tools/test-model-inputs.mjs
//
// buildModel is pure, so two screens can only disagree by being called with different
// arguments. That is exactly how they drifted: the cheat sheet's model panel passed the
// what-if anchors and the board's team card did not, so pinning "I win Bijan at $61" on
// the cheat sheet rebuilt its Ideal Team around him while the board's card still showed
// the un-anchored lineup. There is no runtime assertion that can catch this — the two
// screens never see each other — so it is checked here, at the source.
//
// A new surface that renders a model must pass all five inputs too, and the roll call at
// the bottom fails when one appears that this test does not know about.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── split a call's argument list on top-level commas ──
function argsAt(text, openParen) {
  const out = [];
  let depth = 0, start = openParen + 1, quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' && depth === 0) { out.push(text.slice(start, i).trim()); return out; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  throw new Error('unterminated buildModel( call');
}

// ── every buildModel call, tagged with the top-level function it sits in ──
const fnStarts = [...src.matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)].map(m => ({ at: m.index, name: m[1] }));
const enclosing = at => {
  let name = '(top level)';
  for (const f of fnStarts) { if (f.at < at) name = f.name; else break; }
  return name;
};

const calls = [];
const CALL = /buildModel\(/g;
let m;
while ((m = CALL.exec(src))) {
  const at = m.index;
  if (src.slice(Math.max(0, at - 9), at) === 'function ') continue; // the definition
  calls.push({ at, host: enclosing(at), args: argsAt(src, at + 'buildModel'.length) });
}
ok('found the buildModel call sites', calls.length >= 8, `saw ${calls.length}`);

// ── the contract: key, myTeam, players, config, draftedIds, roleOverrides, then the three
//    things that shape MY roster — starred favourites, AI-built custom anchors, what-ifs ──
const SURFACES = {
  TeamsBoard: 'the auction board’s team cards',
  CheatHeader: 'the cheat sheet’s draft models',
  HeaderModelTabs: 'the board’s model tabs',
  ModelsPanel: 'the standalone models panel',
  App: 'the model-fit boxes and the board’s target-buys pane',
};
const mentions = (s, ...words) => words.some(w => s.includes(w));

console.log('\nevery screen builds my team’s model from the same inputs');
for (const c of calls) {
  const where = `${c.host} @${src.slice(0, c.at).split('\n').length}`;
  ok(`${where} passes all nine arguments`, c.args.length === 9, `got ${c.args.length}: ${c.args.join(' , ')}`);
  if (c.args.length !== 9) continue;
  ok(`${where} passes the starred favourites`, mentions(c.args[6], 'targets'), c.args[6]);
  ok(`${where} passes the custom anchors`, mentions(c.args[7], 'customForced'), c.args[7]);
  ok(`${where} passes the what-if anchors`, mentions(c.args[8], 'Anchors'), c.args[8]);
}

console.log('\nthe App hands those inputs to the screens that render a model');
const teamsBoardProps = src.slice(src.indexOf('React.createElement(TeamsBoard, {', src.indexOf('const draftBoardEl')));
ok('TeamsBoard is given the custom anchors', /customForced:\s*customForcedIds/.test(teamsBoardProps.slice(0, 1400)));
ok('TeamsBoard is given the what-if anchors', /whatIfAnchors:\s*whatIfAnchors/.test(teamsBoardProps.slice(0, 1400)));
const tabs = src.slice(src.indexOf('React.createElement(HeaderModelTabs, {'));
ok('HeaderModelTabs is given the custom anchors', /customForced:\s*customForcedIds/.test(tabs.slice(0, 700)));
ok('HeaderModelTabs is given the what-if anchors', /whatIfAnchors:\s*whatIfAnchors/.test(tabs.slice(0, 700)));

console.log('\nthe AI-built Custom model is a labelled model wherever one can be picked');
for (const fn of ['CheatHeader', 'HeaderModelTabs', 'ModelsPanel']) {
  const seg = src.slice(src.indexOf('function ' + fn));
  const list = seg.slice(seg.indexOf('const models ='), seg.indexOf(';', seg.indexOf('const models =')));
  ok(`${fn} lists Custom once it has anchors`, /customForced && customForced\.size > 0 \? \[\['custom', 'Custom'\]\]/.test(list), list.slice(-120));
}
const pane = src.slice(src.indexOf('var MODELS = ['));
ok('the board’s target-buys pane can name the Custom model', /\.concat\(\[\['custom', 'Custom'\]\]\)/.test(pane.slice(0, 600)));

// ── roll call: a screen this test has never seen is a screen nobody checked ──
console.log('\nno unreviewed screen builds a model');
const hosts = [...new Set(calls.map(c => c.host))].sort();
const unknown = hosts.filter(h => !SURFACES[h]);
ok('every buildModel caller is a known surface', unknown.length === 0, unknown.join(', '));
const missing = Object.keys(SURFACES).filter(h => !hosts.includes(h)).sort();
ok('every known surface still calls buildModel', missing.length === 0, missing.join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
