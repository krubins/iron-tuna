#!/usr/bin/env node
// Regression test for the player links inside stories and insights.
//   node tools/test-player-links.mjs
//
// WHAT THIS PROTECTS. Every story and insight on the site names players, and a
// named player has a card at /player/<slug>. player-search.js turns those names
// into links to it at read time. The rules it follows are not obvious, and each
// one is here because getting it wrong is worse than not linking at all:
//
//   - a name already inside a link is left alone. Most headlines ARE links, to
//     the story, and a link inside a link is not a thing;
//   - a full name always resolves; a ONE-WORD short form ("Kyren", "Likely's")
//     only resolves against the players the same block has already named in
//     full, and only when exactly one of them owns that word;
//   - a word that is also ordinary English ("Likely", "Love", "Price") is left
//     as text where a sentence has just begun, because a capital letter after a
//     full stop says nothing about which one it is;
//   - a club's defense is not a player mention.
//
// It runs the REAL player-search.js in as much of a browser as it needs, so the
// index under test is the shipped one, and finishes with a sweep over every
// page that carries a story to check it actually loads the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── a browser, in as much as this file needs one ───────────────────────────
// Text nodes, elements, fragments, a tree walker and the two selector shapes
// player-search.js actually asks for (".cls" and "[attr]", comma-separated).
function makeDom() {
  const doc = { nodeType: 9 };
  class Node {
    constructor(type) { this.nodeType = type; this.childNodes = []; this.parentNode = null; this.ownerDocument = doc; }
    appendChild(c) {
      if (c.nodeType === 11) { c.childNodes.slice().forEach(g => this.appendChild(g)); return c; }
      if (c.parentNode) c.parentNode.remove(c);
      c.parentNode = this; this.childNodes.push(c); return c;
    }
    remove(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); }
    replaceChild(fresh, old) {
      const i = this.childNodes.indexOf(old);
      if (i < 0) return old;
      const kids = fresh.nodeType === 11 ? fresh.childNodes.slice() : [fresh];
      kids.forEach(k => { k.parentNode = this; });
      this.childNodes.splice(i, 1, ...kids);
      old.parentNode = null;
      return old;
    }
  }
  class Text extends Node {
    constructor(v) { super(3); this.nodeValue = v; this.nodeName = '#text'; }
  }
  class El extends Node {
    constructor(tag) { super(1); this.nodeName = String(tag).toUpperCase(); this.attrs = {}; }
    get className() { return this.attrs['class'] || ''; }
    set className(v) { this.attrs['class'] = String(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    matches(sel) {
      return String(sel).split(',').map(s => s.trim()).some(one => {
        if (one.startsWith('.')) return this.className.split(/\s+/).includes(one.slice(1));
        if (one.startsWith('[')) return this.getAttribute(one.slice(1, -1)) !== null;
        return this.nodeName === one.toUpperCase();
      });
    }
    closest(sel) {
      for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.matches(sel)) return e;
      return null;
    }
    get text() {
      return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.text)).join('');
    }
    querySelectorAll(sel) {
      const out = [];
      (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (c.matches(sel)) out.push(c); walk(c); } }); })(this);
      return out;
    }
    // Every <a class="pl-mention"> under this element, in document order.
    get mentions() {
      const out = [];
      (function walk(n) {
        n.childNodes.forEach(c => {
          if (c.nodeType !== 1) return;
          if (c.nodeName === 'A' && c.className === 'pl-mention') out.push(c);
          walk(c);
        });
      })(this);
      return out;
    }
  }
  const all = el => {
    const out = [];
    (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { out.push(c); walk(c); } }); })(el);
    return out;
  };
  doc.body = new El('body');
  doc.head = new El('head');
  doc.readyState = 'complete';
  doc.createElement = t => new El(t);
  doc.createTextNode = v => new Text(v);
  doc.createDocumentFragment = () => new Node(11);
  doc.getElementById = id => all(doc.body).concat(all(doc.head)).find(e => e.getAttribute('id') === id) || null;
  doc.querySelectorAll = sel => all(doc.body).filter(e => e.matches(sel));
  doc.addEventListener = () => {};
  doc.createTreeWalker = (root) => {
    const nodes = [];
    (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 3) nodes.push(c); else walk(c); }); })(root);
    let i = -1;
    return { nextNode: () => (++i < nodes.length ? nodes[i] : null) };
  };
  const win = { document: doc, setTimeout: () => 0, El, Text };
  win.window = win;
  return win;
}

const lib = read('player-search.js');
function load() {
  const w = makeDom();
  new Function('window', lib + '\n;return window.ITPlayerSearch;')(w);
  return w;
}

// A block of copy, as one element the linker will treat as one story.
function block(w, cls, ...paras) {
  const box = w.document.createElement('div');
  box.className = cls;
  paras.forEach(p => {
    if (typeof p === 'string') {
      const el = w.document.createElement('p');
      el.appendChild(w.document.createTextNode(p));
      box.appendChild(el);
    } else box.appendChild(p);
  });
  w.document.body.appendChild(box);
  return box;
}
const slugs = box => box.mentions.map(a => a.getAttribute('data-player'));
const hrefs = box => box.mentions.map(a => a.href);

// ── 1. a full name becomes a link to the card ──────────────────────────────
console.log('\nfull names');
{
  const w = load();
  const b = block(w, 'call', 'Jaxon Smith-Njigba is the safest WR in the pool.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the name links', slugs(b).join() === 'jaxon-smith-njigba', slugs(b).join());
  ok('it points at the card', hrefs(b).join() === '/player/jaxon-smith-njigba', hrefs(b).join());
  ok('the sentence still reads the same',
     b.text === 'Jaxon Smith-Njigba is the safest WR in the pool.', b.text);
  ok('the link text is the name as written', b.mentions[0].text === 'Jaxon Smith-Njigba');
}
{
  // The desk varies a name's punctuation and nothing else, so the pattern does
  // too: initials with or without stops, either apostrophe or none at all. Each
  // spelling gets its own story, because a story links a man once.
  for (const [text, want] of [
    ['A.J. Brown is a direct beneficiary.', 'a-j-brown'],
    ['AJ Brown is a direct beneficiary.', 'a-j-brown'],
    ['De’Von Achane is supported by talent.', 'de-von-achane'],
    ["De'Von Achane is supported by talent.", 'de-von-achane'],
    ['DeVon Achane is supported by talent.', 'de-von-achane'],
    ['T.J. Hockenson remains a risky rebound candidate.', 't-j-hockenson'],
    ['TJ Hockenson remains a risky rebound candidate.', 't-j-hockenson'],
  ]) {
    const w = load();
    const b = block(w, 'call', text);
    w.ITPlayerSearch.linkAllPlayers(w.document);
    ok(`"${text.split(' ').slice(0, 2).join(' ')}" resolves`, slugs(b).join() === want, slugs(b).join());
  }
}
{
  const w = load();
  const b = block(w, 'call', 'Kansas City is no longer a pure pass funnel, say the Kansas City Chiefs.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a club defense is not a player mention', slugs(b).length === 0, slugs(b).join());
}

// ── 2. a name already inside a link is left alone ──────────────────────────
console.log('\nlinks inside links');
{
  const w = load();
  const head = w.document.createElement('h2');
  const a = w.document.createElement('a');
  a.href = '/auction-insights-2026-07-23#call-2';
  a.appendChild(w.document.createTextNode('James Cook is one of the best prices on the board'));
  head.appendChild(a);
  const b = block(w, 'call', head, 'James Cook is worth the money.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the headline keeps its own destination', a.childNodes.length === 1 && a.childNodes[0].nodeType === 3);
  ok('the body copy still links', slugs(b).join() === 'james-cook', slugs(b).join());
}

// ── 3. the short forms the desk actually writes ────────────────────────────
console.log('\nshort forms');
{
  // The short form resolves on its own once the block has named him — here in
  // its own story, so the full name above is not the one taking the link.
  const w = load();
  const b = block(w, 'call', 'Take Kyren less in managed leagues than in best ball.');
  b.setAttribute('data-players', 'kyren-williams');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a first name the block has earned links', slugs(b).join() === 'kyren-williams', slugs(b).join());
  ok('and the link is the short form as written', b.mentions[0].text === 'Kyren');
}
{
  const w = load();
  const b = block(w, 'call',
    'Kyren Williams and Javonte Williams both carry the name.',
    'Williams is the one to draft.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a surname two of them share resolves to neither',
     slugs(b).join() === 'kyren-williams,javonte-williams', slugs(b).join());
}
{
  const w = load();
  const b = block(w, 'call', 'Take Kyren less in managed leagues.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a short form with nothing behind it stays text', slugs(b).length === 0, slugs(b).join());
}
{
  const w = load();
  const one = block(w, 'call', 'Kyren Williams has a hard schedule.');
  const two = block(w, 'call', 'Kyren is not mentioned in full here.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('one call does not lend its cast to the next', slugs(two).length === 0, slugs(two).join());
  ok('and the call that named him is unaffected', slugs(one).length === 1);
}

// ── 4. words that are also names ───────────────────────────────────────────
console.log('\nordinary English words');
{
  const w = load();
  const b = block(w, 'call',
    'Likely, the Ravens will lean on him.',
    'The offense is likely to throw more.',
    'Isaiah Likely is the best late-round TE target.');
  b.setAttribute('data-players', 'isaiah-likely');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a sentence that opens on the adverb is left alone', b.childNodes[0].mentions.length === 0);
  ok('lower case is prose, never a name', b.childNodes[1].mentions.length === 0);
  ok('so the full name below is still the first mention',
     slugs(b).join() === 'isaiah-likely' && b.mentions[0].text === 'Isaiah Likely', slugs(b).join());
}
{
  const w = load();
  const b = block(w, 'call', 'Likely’s outlook is stronger in full PPR.');
  b.setAttribute('data-players', 'isaiah-likely');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the possessive is the player, even opening a sentence',
     slugs(b).join() === 'isaiah-likely', slugs(b).join());
  ok('and the apostrophe is left outside the link', b.mentions[0].text === 'Likely');
}
{
  const w = load();
  const b = block(w, 'call', 'The Packers still trust Love in December.');
  b.setAttribute('data-players', 'jordan-love');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the same word mid-sentence is the player', slugs(b).join() === 'jordan-love', slugs(b).join());
}

// ── 5. one link per player per story ───────────────────────────────────────
console.log('\none link per player');
{
  const w = load();
  const b = block(w, 'call',
    'Kyren Williams has a hard schedule.',
    'Kyren loses the most in that environment.',
    'Take Kyren less in managed leagues than in best ball.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a story links a man once, not once a sentence',
     slugs(b).join() === 'kyren-williams', slugs(b).join());
  ok('and it is the first mention that carries it',
     b.childNodes[0].mentions.length === 1 && b.mentions[0].text === 'Kyren Williams');
  ok('the other mentions are still there as text',
     b.text.split('Kyren').length - 1 === 3, b.text);
}
{
  // Two men in one story get one link each, not one link between them.
  const w = load();
  const b = block(w, 'call',
    'DeVonta Smith and Dallas Goedert gain target share.',
    'Smith is the safer bet; Goedert is the cheaper one.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('every player named gets his own first mention',
     slugs(b).join() === 'devonta-smith,dallas-goedert', slugs(b).join());
}
{
  const w = load();
  const one = block(w, 'call', 'Josh Allen remains the safest overall QB1.');
  const two = block(w, 'call', 'Josh Allen is still the safest overall QB1.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the next story links him again — the cap is per story, not per page',
     slugs(one).join() === 'josh-allen' && slugs(two).join() === 'josh-allen');
}
{
  // Re-running must not promote the second mention to a first one.
  const w = load();
  const b = block(w, 'call', 'Josh Allen is safe. Josh Allen is expensive.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  w.ITPlayerSearch.linkAllPlayers(w.document);
  w.ITPlayerSearch.linkPlayers(b);
  ok('re-linking the same story adds nothing', slugs(b).join() === 'josh-allen', slugs(b).join());
}

// ── 6. what does and does not get read at all ──────────────────────────────
console.log('\nscope');
{
  const w = load();
  const loose = w.document.createElement('p');
  loose.appendChild(w.document.createTextNode('Josh Allen sells a lot of jerseys.'));
  w.document.body.appendChild(loose);
  const b = block(w, 'call', 'Josh Allen remains the safest overall QB1.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('copy outside a story is left alone', loose.mentions.length === 0);
  ok('copy inside one is not', slugs(b).join() === 'josh-allen');
}
{
  const w = load();
  const b = block(w, 'ins', 'Drake London is one of the best WR values on the board.');
  const c = block(w, 'div', 'Drake London is one of the best WR values on the board.');
  c.setAttribute('data-player-links', '');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a premium insight is a story', slugs(b).join() === 'drake-london');
  ok('so is anything a page marks', slugs(c).join() === 'drake-london');
}
{
  const w = load();
  const b = block(w, 'call', 'Josh Allen remains the safest overall QB1.');
  const first = w.ITPlayerSearch.linkAllPlayers(w.document);
  const again = w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the first pass links', first === 1, String(first));
  ok('a second pass changes nothing', again === 0 && slugs(b).length === 1, String(again));
}
{
  // The player card leaves its own man as text — but he is still part of the
  // call's cast, so a surname he shares cannot be read as somebody else.
  const w = load();
  const b = block(w, 'call',
    'Kyren Williams and Javonte Williams share a name.',
    'Williams is the one to draft.');
  w.ITPlayerSearch.linkPlayers(b, { skip: 'kyren-williams' });
  ok('the card’s own player is not linked back to himself',
     slugs(b).join() === 'javonte-williams', slugs(b).join());
  ok('but he still disambiguates the shared surname', b.text.includes('Williams is the one'));
}

// ── 7. a real call, straight out of a drop page ────────────────────────────
console.log('\na published call');
{
  // This call never writes "Kyren Williams" — only "Kyren" — which is exactly
  // why the build stamps the cast onto the section as data-players.
  const src = read('auction-insights-2026-08-10.html');
  const call = src.slice(src.indexOf('id="call-4"'), src.indexOf('id="call-5"'));
  const declared = (call.slice(0, 120).match(/data-players="([^"]*)"/) || [])[1] || '';
  const paras = [...call.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '')
      .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#8209;/g, '‑').replace(/&mdash;/g, '—')
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)))
    .filter(Boolean);
  const w = load();
  const b = block(w, 'call', ...paras);
  if (declared) b.setAttribute('data-players', declared);
  w.ITPlayerSearch.linkAllPlayers(w.document);
  const s = slugs(b);
  ok('the call reads as published (paragraphs found)', paras.length >= 3, String(paras.length));
  ok('the build stamped its cast on it', declared === 'kyren-williams', declared);
  ok('so the short form the desk actually wrote links',
     s.filter(k => k === 'kyren-williams').length === 1, s.join());
  ok('and it never writes the full name', !call.includes('Kyren Williams'));
  ok('every link points at a card', b.mentions.every(a => /^\/player\/[a-z0-9-]+$/.test(a.href)));
}

// ── 8. every page that carries a story loads the file ──────────────────────
console.log('\nwiring');
{
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const carriers = files.filter(f => /class="(call|ins)[" ]/.test(read(f)));
  const missing = carriers.filter(f => !read(f).includes('/player-search.js'));
  ok('every page with a .call or .ins loads player-search.js',
     missing.length === 0, missing.join(', '));
  ok('the story pages were actually found', carriers.length > 40, String(carriers.length));

  // A stamped cast that names nobody the index knows would silently do nothing,
  // and the failure mode is invisible on the page — so it fails here instead.
  const index = new Set(load().ITPlayerSearch.players.map(p => p.k));
  const stamped = [], strays = [];
  for (const f of carriers) {
    for (const m of read(f).matchAll(/data-players="([^"]*)"/g)) {
      for (const k of m[1].split(/\s+/).filter(Boolean)) {
        stamped.push(k);
        if (!index.has(k)) strays.push(`${f}: ${k}`);
      }
    }
  }
  ok('every stamped cast member is in the lookup index', strays.length === 0, strays.slice(0, 5).join('; '));
  ok('the drop pages actually carry a cast', stamped.length > 150, String(stamped.length));
  ok('the editions were all stamped, not just the auction one',
     ['auction', 'snake', 'bestball'].every(ed =>
       /data-players="/.test(read(`${ed}-insights-2026-08-10.html`))));

  // The surfaces that paint their stories from data have to ask again once they
  // have; boot() only sees what was in the served HTML.
  for (const [f, call] of [
    ['front.html', 'linkPlayers'], ['player.html', 'linkPlayers'],
    ['lead.html', 'linkPlayers'], ['my-insights.html', 'linkAllPlayers'],
    ['insights-vault.html', 'linkAllPlayers'], ['insights.html', 'linkAllPlayers'],
  ]) ok(`${f} re-links after it paints`, read(f).includes(`.${call}(`));
}


// ── every board sends a player name to the same place ──────────────────────
// The prose linker above has always pointed at /player/<slug>. The BOARDS did
// not: seven of them linked /in-season/player/<slug>?pos=<POS> instead, so one
// site had two player pages and the name in a story and the same name one row
// down on a board went to different ones.
//
// That was survivable while the card was noindex. It stopped being survivable
// when _worker.js made /player/<slug> indexable: the boards are where a
// player's name appears most, and every one of those links was pointing at a
// page that tells crawlers not to index it. So the boards were moved onto the
// card, and this is what holds them there.
console.log('\nthe boards link the card');
{
  // Every surface that renders a player row or chip. Named rather than
  // globbed: a new board that links players is meant to fail this list once,
  // and be added to it deliberately.
  //
  // _worker.js is read through rkPreHtml alone. The file renders board rows
  // there AND renders the card's own in-season button, which is SUPPOSED to
  // point at /in-season/player/<slug> — reading the whole file would fail the
  // rule on the one link the rule does not cover.
  const BOARDS = ['rankings.html', 'vegas-edge.html', 'stats.html', 'hidden-value.html',
                  'weekly-intel.html', 'it-ranks.js', '_worker.js'];
  const rowsOf = (f) => {
    const src = read(f);
    if (f !== '_worker.js') return src;
    const i = src.indexOf('function rkPreHtml(pre) {');
    return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i));
  };
  for (const f of BOARDS) {
    const src = rowsOf(f);
    ok(`${f} links /player/<slug>`, /href="\/player\/' \+ /.test(src));
    // The old address, and the dead query that rode along with it: nothing on
    // the card has ever read ?pos=.
    ok(`${f} no longer links the noindex page`, !/href="\/in-season\/player\/' \+ /.test(src));
    ok(`${f} carries no dead ?pos= on a player link`, !/\/player\/' \+ [^\n]*\?pos=/.test(src));
  }
}

// ── the in-season page is still reachable ──────────────────────────────────
// Moving the boards off /in-season/player/<slug> would have orphaned it: no
// page on the site would have linked it, and it is noindex, so nothing would
// have found it at all. The card links it back, and in season it is the card's
// FIRST button — because a reader arriving from the weekly rankings wants this
// week, and the two buttons the shell ships are both draft-room promotions.
console.log('\nthe card leads back to the week');
{
  const worker = read('_worker.js');
  ok('the worker builds the in-season pair', /function playerCta\(p\) \{/.test(worker));
  const cta = worker.slice(worker.indexOf('function playerCta(p) {'));
  ok('its first button is this week’s intel for this player',
     cta.indexOf("/in-season/player/") > 0
     && cta.indexOf("/in-season/player/") < cta.indexOf("/weekly-"));
  ok('its second is that player’s own board', /\/weekly-' \+ board \+ '-rankings/.test(cta));
  // Only while the season is open. /in-season/player/<slug> is gated on the
  // same flag, so writing the link when it is off would point at the
  // waiting-list gate.
  ok('and it is written only while the season is open',
     /if \(POST_DRAFT_OPEN\(env\)\) \{[\s\S]{0,200}playerCta/.test(worker));

  // The block the worker replaces has to still be in the shell, verbatim. A
  // replace() that matches nothing returns its input, so a renamed class here
  // would leave the draft-room buttons on every in-season arrival with no
  // error anywhere.
  const shell = read('player.html');
  ok('the shell still carries the block the worker replaces',
     /<div class="pc-cta">[\s\S]*?<\/div>/.test(shell));
  ok('and out of season it still ships the auction pair',
     /pc-cta[\s\S]{0,400}auctiondraft\?screen=cheat/.test(shell));

  // Every position on the card maps to a board, or the second button vanishes
  // for the positions it cannot name.
  const map = (worker.match(/const PC_BOARD = \{[\s\S]*?\};/) || [''])[0];
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    ok(`a ${pos} card knows its board`, new RegExp(pos + ": '").test(map));
  }
  // ...and each of those boards is a page that exists.
  for (const b of ['qb', 'rb', 'wr', 'te', 'k', 'dst']) {
    ok(`/weekly-${b}-rankings is a real page`, fs.existsSync(path.join(ROOT, `weekly-${b}-rankings.html`)));
  }
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
