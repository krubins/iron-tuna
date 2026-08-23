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
//   - a club's defence is not a player mention.
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
  // too: initials with or without stops, either apostrophe or none at all.
  const w = load();
  const b = block(w, 'call',
    'A.J. Brown and AJ Brown are the same man.',
    'De’Von Achane, De’Von Achane and DeVon Achane too.',
    'T.J. Hockenson remains a risky rebound candidate.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  const s = slugs(b);
  ok('both spellings of A.J. Brown link',
     s.filter(k => k === 'a-j-brown').length === 2, s.join());
  ok('every spelling of De’Von Achane links',
     s.filter(k => k === 'de-von-achane').length === 3, s.join());
  ok('T.J. Hockenson links', s.includes('t-j-hockenson'), s.join());
}
{
  const w = load();
  const b = block(w, 'call', 'Kansas City is no longer a pure pass funnel, say the Kansas City Chiefs.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a club defence is not a player mention', slugs(b).length === 0, slugs(b).join());
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
  const w = load();
  const b = block(w, 'call',
    'Kyren Williams has a hard schedule.',
    'Take Kyren less in managed leagues than in best ball.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('a first name the block has earned links',
     slugs(b).join() === 'kyren-williams,kyren-williams', slugs(b).join());
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
    'Isaiah Likely is the best late-round TE target.',
    'Likely, the Ravens will lean on him.',
    'The offense is likely to throw more.',
    'Likely’s outlook is stronger in full PPR.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  const s = slugs(b);
  ok('the full name links', s[0] === 'isaiah-likely', s.join());
  ok('the possessive links too', s.length === 2 && s[1] === 'isaiah-likely', s.join());
  ok('a sentence that opens on the adverb is left alone',
     b.childNodes[1].mentions.length === 0);
  ok('lower case is prose, never a name', b.childNodes[2].mentions.length === 0);
}
{
  const w = load();
  const b = block(w, 'call',
    'Jordan Love is quietly viable.',
    'The Packers still trust Love in December.');
  w.ITPlayerSearch.linkAllPlayers(w.document);
  ok('the same word mid-sentence is the player',
     slugs(b).join() === 'jordan-love,jordan-love', slugs(b).join());
}

// ── 5. what does and does not get read at all ──────────────────────────────
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

// ── 6. a real call, straight out of a drop page ────────────────────────────
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
     s.filter(k => k === 'kyren-williams').length >= 2, s.join());
  ok('and it never writes the full name', !call.includes('Kyren Williams'));
  ok('every link points at a card', b.mentions.every(a => /^\/player\/[a-z0-9-]+$/.test(a.href)));
}

// ── 7. every page that carries a story loads the file ──────────────────────
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
