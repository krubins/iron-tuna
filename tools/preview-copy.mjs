#!/usr/bin/env node
// The reader-facing copy, in any league, without opening a browser.
//
//   node tools/preview-copy.mjs                        a reader with nothing saved
//   node tools/preview-copy.mjs --budget=120           a $120 reader who never built a board
//   node tools/preview-copy.mjs --budget=120 --board   ...and one who did
//   node tools/preview-copy.mjs --teams=10 --budget=300 --half-ppr --pass-td=6
//   node tools/preview-copy.mjs --budget=120 --vs-desk both readings, side by side
//   node tools/preview-copy.mjs --player="Bijan Robinson"
//   node tools/preview-copy.mjs --title="Cap X at $34, not the $57 on the sheet" --dek="..."
//
// Three surfaces quote hard dollars at a reader — the front page's generated
// lead, its Position Intel modules, and the player card — and every one of them
// is written by /it-league.js against the league that reader saved. Which means
// the only way to know what a copy change actually says is to pick a league and
// read it. This prints that.
//
// It LIFTS the pages' own blocks out of front.html and player.html and runs them
// against the real library rather than restating what they do: a preview that
// paraphrases the page is a preview of nothing, and the paraphrase is exactly
// what rots first. The blocks are found by anchor TEXT, never by line number, so
// ordinary edits above them cannot silently shift the window — and a missing
// anchor is a loud failure rather than a quiet half-render.
// tools/test-it-league.mjs asserts the anchors are still in the pages.
//
// Two things here are stand-ins, and both are labelled as such in the output:
// the desk story (real stories come from D1, so a sample one ships in the flags)
// and, under --board, the reader's board — synthesised from the site's own rows
// at their budget, because a real one is built by the app from their scoring.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── the pages' own code, cut out by anchor ─────────────────────────────────
// `to` is exclusive when `endBefore` is set, so a block can end at whatever
// comes next instead of needing an anchor on its own closing brace.
export const BLOCKS = {
  lead: {
    file: 'front.html',
    what: 'the generated lead: headline, dek and the "Your league" note',
    from: 'var names = (s.names && s.names.length) ? s.names',
    to: 'yours.hidden = !note;',
    needs: ['s', 'L', 'esc', 'document']
  },
  board: {
    file: 'player.html',
    what: 'the player card: which board answered, and his rank on it',
    from: 'function boardRow(p) {',
    to: 'function numEl(label, value, note, money) {',
    endBefore: true,
    needs: ['window', 'S']
  },
  card: {
    file: 'player.html',
    what: 'the player card: the three tiles and the basis sentence',
    from: "nums.appendChild(numEl('Projected'",
    to: "'needs your league: build the sheet below and this card reprices itself.'));",
    needs: ['L', 'found', 'r', 'rk', 'p', 'nums', 'numEl', 'basis', 'esc', 'doc']
  }
};

export function cut(src, block) {
  const lines = src.split('\n');
  const at = (needle, from = 0) => {
    const i = lines.findIndex((l, n) => n >= from && l.includes(needle));
    if (i < 0) {
      throw new Error(
        `preview-copy: ${block.file} no longer contains the anchor\n    ${needle}\n` +
        `  The page moved out from under this tool. Re-point BLOCKS in ` +
        `tools/preview-copy.mjs at the code that replaced it — do not guess a ` +
        `line number, and do not let it print a half-rendered card.`);
    }
    return i;
  };
  const a = at(block.from);
  const b = at(block.to, a + 1);
  return lines.slice(a, block.endBefore ? b : b + 1).join('\n');
}

// ── a reader ───────────────────────────────────────────────────────────────
const lib = read('it-league.js');
function libFor(store) {
  const w = { localStorage: { getItem: (k) => store[k] || null, setItem() {} }, document: null };
  return new Function('window', lib + '\n;return window.ITLeague;')(w);
}

// A board of the reader's own, standing in for the one the app writes. Their
// budget is real — it is what they saved — so the prices are the site's rows at
// their money. Their SCORING is not applied, because re-scoring needs the stat
// lines only the app has: what this exists to exercise is the "has a board"
// path, and the output says so rather than passing it off as their sheet.
function synthBoard(teams, budget, format) {
  const site = libFor({}).defaultBoard();
  const k = (teams * budget) / (12 * 200);
  return JSON.stringify({
    ts: 1, sv: 2, teams, budget, format,
    players: site.map((p) => ({ n: p.n, pos: p.pos, pts: p.pts, v: Math.max(1, Math.round(p.v * k)) }))
  });
}

function storeFor(o) {
  const store = {};
  if (!o.league) return store;
  store.iron_tuna_draft_state_v2 = JSON.stringify({
    config: { teams: o.teams, budget: o.budget, format: o.format, scoring: o.scoring }
  });
  if (o.board) store.iron_tuna_values_v1 = synthBoard(o.teams, o.budget, o.format);
  return store;
}

// ── the surfaces ───────────────────────────────────────────────────────────
const strip = (s) => String(s)
  .replace(/<[^>]+>/g, '').replace(/&mdash;/g, '—').replace(/&rarr;/g, '→')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function renderLead(L, story) {
  const el = {};
  const document = { getElementById: (id) => (el[id] = el[id] || { innerHTML: '', hidden: false }) };
  new Function('s', 'L', 'esc', 'document', cut(read('front.html'), BLOCKS.lead))
    (story, L, (x) => String(x), document);
  return {
    HEADLINE: strip(el.leadTitle.innerHTML),
    DEK: strip(el.leadPlay.innerHTML),
    NOTE: strip(el.leadYours.innerHTML)
  };
}

// front.html asks the library for this line (renderPositions -> L.tailor, and
// L.tailorLabel for the label beside it), so there is no block to lift: these
// two calls ARE the surface. Real insight rows, read out of front.html's own
// data rather than invented here.
function renderIntel(L, howMany) {
  const rows = [...read('front.html').matchAll(/\{"title":"[^"]*","pos":"[^"]*"[^}]*"stat":"[^"]*"[^}]*\}/g)]
    .map((m) => { try { return JSON.parse(m[0]); } catch (e) { return null; } })
    .filter((r) => r && /%/.test(r.stat || ''));
  const out = [];
  for (const s of rows) {
    if (out.length >= howMany) break;
    const line = L.tailor(s.stat, s.title, s.pos, L.readingFormat());
    if (line) out.push({ title: s.title, effect: s.stat, line: L.tailorLabel() + ': ' + line });
  }
  return out;
}

function renderCard(L, name) {
  const src = read('player.html');
  const { boardRow, posRank } = new Function('window', 'S',
    cut(src, BLOCKS.board) + '\n;return { boardRow: boardRow, posRank: posRank };'
  )({ ITLeague: L }, null);

  const site = L.defaultBoard();
  const known = site.find((x) => x.n.toLowerCase() === String(name).toLowerCase());
  if (!known) return null;
  const p = { n: known.n, p: known.pos };
  const found = boardRow(p);
  if (!found) return null;
  const r = found.row, rk = posRank(p, found);

  const tiles = [];
  const numEl = (label, value, note) => ({ label, value, note });
  const nums = { appendChild: (t) => tiles.push(t) };
  const basis = { innerHTML: '' };
  new Function('L', 'found', 'r', 'rk', 'p', 'nums', 'numEl', 'basis', 'esc', 'doc',
    cut(src, BLOCKS.card))(L, found, r, rk, p, nums, numEl, basis, (x) => String(x), null);

  const call = L.tailor('+10% to +20% versus price', p.n, p.p);
  return { who: p.n, tiles, basis: strip(basis.innerHTML), call: call ? L.tailorLabel() + ': ' + call : '' };
}

// ── the CLI ────────────────────────────────────────────────────────────────
const SAMPLE = {
  url: '/insight/sample',
  label: 'Preseason',
  title: 'Cap Cam Skattebo at $34, not the $57 on the consensus sheet',
  dek: "Cam Skattebo ran one route in the Giants' preseason opener and drew no targets. "
     + 'Tyrone Tracy ran three and drew one. Give Tracy that share of the catches and the '
     + 'two backs come out level, so bid either one to about $17.',
  names: ['Cam Skattebo', 'Tyrone Tracy Jr.']
};

function parse(argv) {
  const hit = (name) => argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  const flag = (name, dflt) => {
    const h = hit(name);
    if (!h) return dflt;
    const eq = h.indexOf('=');
    return eq < 0 ? true : h.slice(eq + 1);
  };
  const n = (name, dflt) => { const v = flag(name, null); return v === null ? dflt : Number(v); };

  const scoring = {};
  if (flag('half-ppr', false)) { scoring.receptionPoints = 0.5; scoring.rbReceptionPoints = 0.5; }
  if (flag('standard', false)) { scoring.receptionPoints = 0; scoring.rbReceptionPoints = 0; }
  if (hit('pass-td')) scoring.passingTD = n('pass-td', 4);
  if (hit('rb-rec')) scoring.rbReceptionPoints = n('rb-rec', 1);

  const league = !!(hit('teams') || hit('budget') || hit('format') || hit('board') ||
                    Object.keys(scoring).length);
  return {
    league,
    teams: n('teams', 12),
    budget: n('budget', 200),
    format: String(flag('format', 'auction')),
    scoring,
    board: !!flag('board', false),
    player: String(flag('player', 'Cam Skattebo')),
    intel: n('intel', 3),
    vsDesk: !!flag('vs-desk', false),
    help: !!flag('help', false),
    story: Object.assign({}, SAMPLE, {
      title: String(flag('title', SAMPLE.title)),
      dek: String(flag('dek', SAMPLE.dek))
    })
  };
}

const bold = (s) => (process.stdout.isTTY ? '\x1b[1m' + s + '\x1b[0m' : s);
const rule = (s) => '\n' + bold(s) + '\n' + '─'.repeat(Math.min(72, s.length + 8));

function whoIsReading(L, o) {
  if (!L.has) return 'a reader with no league saved — the desk’s own dollars';
  return 'a reader on ' + L.label('auction') + (L.hasBoard ? ', with a board' : ', no board built')
       + (L.hasBoard ? ' (synthesised at their budget; scoring not re-scored)' : '');
}

function report(o, store) {
  const L = libFor(store);
  console.log(rule('READING AS: ' + whoIsReading(L, o)));

  const lead = renderLead(L, o.story);
  console.log('\n' + bold('The front page lead') + '   ' + BLOCKS.lead.file + ', its own block');
  console.log('  sample desk copy — override with --title / --dek');
  Object.keys(lead).forEach((k) => console.log('  ' + k.padEnd(9) + lead[k]));

  const intel = renderIntel(L, o.intel);
  if (intel.length) {
    console.log('\n' + bold('Position Intel') + '        front.html, via L.tailor()');
    intel.forEach((it) => {
      console.log('  ' + it.title.slice(0, 64) + (it.title.length > 64 ? '…' : ''));
      console.log('  effect:  ' + it.effect);
      console.log('  ' + it.line + '\n');
    });
  }

  const card = renderCard(L, o.player);
  console.log('\n' + bold('The player card') + '       ' + BLOCKS.card.file + ', its own block');
  if (!card) {
    console.log('  ' + o.player + ' is not on the shared board (QB/RB/WR/TE only).');
  } else {
    card.tiles.forEach((t) => console.log('  ' + (t.label + ':').padEnd(12) + String(t.value).padEnd(8) + '(' + t.note + ')'));
    console.log('  ' + card.basis);
    if (card.call) console.log('  ' + card.call);
  }
}

function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) {
    // The header comment IS the help text — one copy, so the flags cannot
    // drift from what they are documented to do. Read to the first line that
    // is not a comment.
    const head = [];
    for (const l of read('tools/preview-copy.mjs').split('\n').slice(1)) {
      if (!l.startsWith('//')) break;
      head.push(l.replace(/^\/\/ ?/, ''));
    }
    console.log(head.join('\n'));
    return;
  }
  report(o, storeFor(o));
  if (o.vsDesk) report(Object.assign({}, o, { league: false }), {});
  console.log('');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
