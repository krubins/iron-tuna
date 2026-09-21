#!/usr/bin/env node
// The story art: a face on every story that names a player, and a game
// photograph — credited as its license requires — wherever there is one.
//   node tools/test-story-art.mjs
//
// WHAT THIS PROTECTS.
//   1. WHO GETS A FACE. player-search.js used to put faces at the head of a
//      headline only when the headline wrote the player's name in full, so a
//      story whose subject lived in its data (the desk's findings, the wrap's
//      component lines, a call's `data-players`) ran with no picture. The
//      order is now: what the page says (`data-player-focus`), then the
//      headline, then the call's cast — asserted here on the real file.
//   2. THE CREDIT IS NOT OPTIONAL. Every game photograph is a CC BY or
//      CC BY-SA file from Wikimedia Commons, and those licenses require the
//      photographer, the license and a link to it wherever the file is shown.
//      storyArt() prints the credit with the picture, and a map entry with a
//      picture but no credit fields still gets one that says where it came
//      from. A release that drops the credit is a release using the photos
//      outside their license, so it fails here.
//   3. THE BUILD TOOL'S RULES. Only the licenses the site may rely on pass
//      (never NC, never ND), a portrait file never wins over a landscape one,
//      and two football players of one name and one position resolve to
//      nobody rather than to a coin flip.
//   4. THE PAGES LOAD WHAT THEY PAINT FROM. /it-action.js before
//      player-search.js on every page that runs the figure; the deployed map
//      matches the lookup it is generated from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { licenseOk, scoreFile, pickShot, chooseEntity, positionMatches, stripHtml, emitJs, rowFor, depicts, orderPool, cleanUrl } from './build-action-shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// ── a browser, in as much as this file needs one ───────────────────────────
// The same shape tools/test-player-links.mjs builds, plus the few things the
// story figure asks for: classList, insertBefore, querySelector, firstChild,
// textContent, remove(), and img.onload/onerror left alone (never fired).
function makeDom() {
  const doc = { nodeType: 9 };
  class Node {
    constructor(type) { this.nodeType = type; this.childNodes = []; this.parentNode = null; this.ownerDocument = doc; }
    appendChild(c) {
      if (c.nodeType === 11) { c.childNodes.slice().forEach(g => this.appendChild(g)); return c; }
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this; this.childNodes.push(c); return c;
    }
    insertBefore(c, ref) {
      if (!ref) return this.appendChild(c);
      if (c.parentNode) c.parentNode.removeChild(c);
      const i = this.childNodes.indexOf(ref);
      c.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); return c;
    }
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    replaceChild(fresh, old) {
      const i = this.childNodes.indexOf(old);
      if (i < 0) return old;
      const kids = fresh.nodeType === 11 ? fresh.childNodes.slice() : [fresh];
      kids.forEach(k => { k.parentNode = this; });
      this.childNodes.splice(i, 1, ...kids);
      old.parentNode = null;
      return old;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get textContent() { return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); }
    set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new Text(String(v))); }
  }
  class Text extends Node {
    constructor(v) { super(3); this.nodeValue = v; this.nodeName = '#text'; }
  }
  class El extends Node {
    constructor(tag) {
      super(1); this.nodeName = String(tag).toUpperCase(); this.attrs = {}; this.style = {};
      const self = this;
      this.classList = {
        add(c) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(' '); },
        remove(c) { self.className = self.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
        contains(c) { return self.className.split(/\s+/).includes(c); },
        toggle(c, on) { if (on === undefined) on = !this.contains(c); on ? this.add(c) : this.remove(c); },
      };
    }
    get className() { return this.attrs['class'] || ''; }
    set className(v) { this.attrs['class'] = String(v); }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get href() { return this.attrs.href || ''; }
    set href(v) { this.attrs.href = String(v); }
    get src() { return this.attrs.src || ''; }
    set src(v) { this.attrs.src = String(v); }
    get alt() { return this.attrs.alt || ''; }
    set alt(v) { this.attrs.alt = String(v); }
    get rel() { return this.attrs.rel || ''; }
    set rel(v) { this.attrs.rel = String(v); }
    get innerHTML() { return this.textContent; }
    set innerHTML(v) { this.textContent = String(v).replace(/<[^>]+>/g, ''); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    hasAttribute(k) { return this.getAttribute(k) !== null; }
    matches(sel) {
      return String(sel).split(',').map(s => s.trim()).some(one => {
        // "main h3": an ancestor named main, then this element.
        const parts = one.split(/\s+/);
        const last = parts[parts.length - 1];
        // A compound: "a.it-art-face", "figcaption.it-art-credit", "[attr]".
        const m = last.match(/^([a-z0-9]+)?((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/i);
        if (!m) return false;
        const classes = (m[2] || '').split('.').filter(Boolean);
        const attrs = (m[3] || '').split(/[\[\]]/).filter(Boolean);
        const mine = this.className.split(/\s+/);
        const self = (!m[1] || this.nodeName === m[1].toUpperCase())
          && classes.every(c => mine.includes(c))
          && attrs.every(a => this.getAttribute(a) !== null);
        if (!self) return false;
        if (parts.length === 1) return true;
        for (let e = this.parentNode; e && e.nodeType === 1; e = e.parentNode) if (e.matches(parts.slice(0, -1).join(' '))) return true;
        return false;
      });
    }
    closest(sel) {
      for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.matches(sel)) return e;
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (c.matches(sel)) out.push(c); walk(c); } }); })(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
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
  doc.querySelector = sel => doc.querySelectorAll(sel)[0] || null;
  doc.addEventListener = () => {};
  doc.dispatchEvent = () => true;
  doc.createTreeWalker = (root) => {
    const nodes = [];
    (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 3) nodes.push(c); else walk(c); }); })(root);
    let i = -1;
    return { nextNode: () => (++i < nodes.length ? nodes[i] : null) };
  };
  const win = { document: doc, setTimeout: () => 0, CustomEvent: function () {}, El, Text };
  win.window = win;
  return win;
}
const lib = read('player-search.js');
function load(shots) {
  const w = makeDom();
  if (shots) w.ITActionShots = shots;
  new Function('window', lib + '\n;return window.ITPlayerSearch;')(w);
  return w;
}
const faces = el => el.querySelectorAll('.it-player-face');
const h = (w, tag, text) => { const e = w.document.createElement(tag); e.appendChild(w.document.createTextNode(text)); return e; };

// Two players the index certainly carries, with a two-word name each.
const W0 = load();
const two = W0.ITPlayerSearch.players.filter(p => /^(QB|RB|WR|TE)$/.test(p.p) && p.n.split(' ').length === 2).slice(0, 2);
if (two.length < 2) { console.error('the index has fewer than two skill players with two-word names'); process.exit(1); }
const [A, B] = two;

// ── 1. who gets a face ─────────────────────────────────────────────────────
console.log('\nwho a story is about');
{
  const w = load();
  const PS = w.ITPlayerSearch;
  ok("a slug resolves", PS.resolve(A.k).k === A.k);
  ok("a full name resolves", PS.resolve(A.n).k === A.k);
  ok("an object carrying either resolves", PS.resolve({ n: B.n }).k === B.k && PS.resolve({ k: B.k }).k === B.k);
  ok('a name the pool does not carry resolves to nobody', PS.resolve('Nobody Atall') === null);
  ok('names joined with | come back in order, once each',
     PS.castOf(A.n + '|' + B.n + '|' + A.n).map(p => p.k).join() === A.k + ',' + B.k);
  ok('slugs separated by spaces still work, as data-players always did',
     PS.castOf(A.k + ' ' + B.k).map(p => p.k).join() === A.k + ',' + B.k);
  ok('one name with a space in it is one player, not two words', PS.castOf(A.n).length === 1);
}
{
  // The desk's feed card: the subject is in the data, not the headline.
  const w = load();
  const main = w.document.createElement('main'); w.document.body.appendChild(main);
  const card = w.document.createElement('article');
  card.className = 'nr-card';
  card.setAttribute('data-player-focus', A.n + '|' + B.n);
  card.appendChild(h(w, 'h3', 'The finding that names nobody in its headline'));
  main.appendChild(card);
  w.ITPlayerSearch.decorateStories(w.document);
  const f = faces(card);
  ok('a card stamped with two subjects gets both faces, though the headline names neither', f.length === 2);
  ok('...at the head of the headline', card.querySelector('h3').firstChild.className === 'it-story-focus');
  w.ITPlayerSearch.decorateStories(w.document);
  ok('a second pass does not double them', faces(card).length === 2);
}
{
  // The wrap's component line: no heading, so the page names the element.
  const w = load();
  const main = w.document.createElement('main'); w.document.body.appendChild(main);
  const li = w.document.createElement('li');
  li.setAttribute('data-player-focus', A.n);
  const a = h(w, 'a', 'A finding on a line that is a link, not a heading');
  a.setAttribute('data-player-head', '');
  li.appendChild(a); main.appendChild(li);
  w.ITPlayerSearch.decorateStories(w.document);
  ok('data-player-head takes the face when the unit has no heading', faces(a).length === 1);
}
{
  // The headline still counts, and the call's cast is the last resort.
  const w = load();
  const main = w.document.createElement('main'); w.document.body.appendChild(main);
  const call = w.document.createElement('article');
  call.className = 'call';
  call.setAttribute('data-players', A.k + ' ' + B.k);
  call.appendChild(h(w, 'h2', 'A headline about the endgame dollar'));
  main.appendChild(call);
  const plain = w.document.createElement('article');
  plain.className = 'call';
  plain.appendChild(h(w, 'h2', B.n + ' is the whole entry'));
  main.appendChild(plain);
  w.ITPlayerSearch.decorateStories(w.document);
  ok('a call whose headline names nobody shows its cast (it used to need exactly one)', faces(call).length === 2);
  ok('a headline that writes a name in full still gets that face', faces(plain).length === 1);
}
{
  // The desk piece and /lead run a figure under the headline instead.
  const w = load();
  const main = w.document.createElement('main'); w.document.body.appendChild(main);
  const h1 = h(w, 'h1', A.n + ' and the week he had');
  h1.setAttribute('data-no-player-focus', '');
  main.appendChild(h1);
  w.ITPlayerSearch.decorateStories(w.document);
  ok('data-no-player-focus keeps the faces off a headline that has a figure below it', faces(h1).length === 0);
}

// ── 2. the figure, and the credit that travels with the photograph ─────────
console.log('\nthe story figure');
{
  const w = load();
  const fig = w.ITPlayerSearch.storyArt([A.n, B.n]);
  ok('with no photograph on file the figure is the faces alone', fig && !fig.classList.contains('has-photo') && faces(fig).length === 2);
  ok('each face links to the player card', fig.querySelectorAll('a.it-art-face').every(a => /^\/player\//.test(a.href)));
  ok('each face carries the name beside it', fig.textContent.indexOf(A.n) >= 0 && fig.textContent.indexOf(B.n) >= 0);
  ok('a story that names nobody the pool knows gets no figure', w.ITPlayerSearch.storyArt(['Nobody Atall']) === null);
  ok('the figure is capped at four', w.ITPlayerSearch.storyArt(w.ITPlayerSearch.players.slice(0, 9).map(p => p.k)) .querySelectorAll('a.it-art-face').length === 4);
}
{
  const shot = { u: 'https://upload.wikimedia.org/x/1200px-a.jpg', w: 1200, h: 800, a: 'Some Photographer',
                 l: 'CC BY-SA 2.0', lu: 'https://creativecommons.org/licenses/by-sa/2.0', s: 'https://commons.wikimedia.org/wiki/File:A.jpg' };
  const map = {}; map[A.k] = shot;
  const w = load(map);
  const PS = w.ITPlayerSearch;
  ok('action() reads the map by slug, and only entries with a URL', PS.action(A.k) === shot && PS.action(B.k) === null);
  const fig = PS.storyArt([B.n, A.n]);
  ok('the figure runs the photograph of the first player who has one', fig.classList.contains('has-photo') && fig.querySelector('img').src === shot.u);
  ok('the photograph is captioned with the player, for a reader who cannot see it', fig.querySelector('img').alt.indexOf(A.n) === 0);
  const credit = fig.querySelector('figcaption.it-art-credit');
  ok('the credit is printed under it', !!credit);
  ok('...naming the photographer, linked to the file page',
     credit && credit.querySelector('a').textContent === shot.a && credit.querySelector('a').href === shot.s);
  ok('...naming the license, linked to its deed with rel=license',
     credit && credit.querySelectorAll('a').some(a => a.textContent === shot.l && a.href === shot.lu && /license/.test(a.rel)));
  ok('...saying where it came from and that it was cropped', credit && /Wikimedia Commons/.test(credit.textContent) && /cropped/.test(credit.textContent));
  ok('the faces still follow the photograph', faces(fig).length === 2);
  const none = PS.storyArt([A.n], { photo: false });
  ok('photo:false leaves the photograph out on a surface that has no room for it', !none.classList.contains('has-photo'));
  const bare = {}; bare[B.k] = { u: 'https://upload.wikimedia.org/x/b.jpg' };
  const w2 = load(bare);
  const c2 = w2.ITPlayerSearch.storyArt([B.k]).querySelector('figcaption');
  ok('a row with a picture and no credit fields still says where the picture came from', c2 && /Wikimedia Commons/.test(c2.textContent));
}

// ── 3. the build tool's rules ──────────────────────────────────────────────
console.log('\nthe build tool');
{
  const meta = (short, extra) => ({ LicenseShortName: { value: short }, ...(extra || {}) });
  ok('CC BY, CC BY-SA, CC0 and public domain pass',
     ['CC BY 2.0', 'CC BY-SA 4.0', 'CC BY-SA 2.0', 'CC0', 'Public domain'].every(l => licenseOk(meta(l))));
  ok('NC and ND never pass, nor does a file with no license',
     ['CC BY-NC 2.0', 'CC BY-NC-SA 4.0', 'CC BY-ND 2.0', 'Fair use', ''].every(l => !licenseOk(meta(l))) && !licenseOk({}));
  ok('a file Commons marks as not copyrighted passes without a short name', licenseOk({ Copyrighted: { value: 'False' } }));
  const file = (title, w, h_, year, lic, curated) => ({ title, w, h: h_, year, meta: meta(lic || 'CC BY-SA 2.0'), curated: !!curated, url: 'u/' + title });
  ok('a portrait file never scores', scoreFile(file('File:A.jpg', 800, 1200, 2024)) < 0);
  ok('a small file never scores', scoreFile(file('File:A.jpg', 400, 300, 2024)) < 0);
  ok('a headshot by name never scores, whatever its shape', scoreFile(file('File:A headshot.jpg', 1200, 800, 2024)) < 0);
  ok('an NC file never scores', scoreFile(file('File:A.jpg', 1200, 800, 2024, 'CC BY-NC 2.0')) < 0);
  ok('a landscape file outscores a panorama', scoreFile(file('File:A.jpg', 1200, 800, 2020)) > scoreFile(file('File:B.jpg', 2400, 600, 2020)));
  ok('a newer game outscores an older one', scoreFile(file('File:A.jpg', 1200, 800, 2024)) > scoreFile(file('File:B.jpg', 1200, 800, 2015)));
  const best = pickShot([file('File:Old.jpg', 1200, 800, 2016), file('File:Tall.jpg', 800, 1200, 2025), file('File:New.jpg', 1200, 800, 2024), file('File:NC.jpg', 2000, 1200, 2025, 'CC BY-NC 2.0')]);
  ok('pickShot takes the newest usable landscape file', best && best.title === 'File:New.jpg');
  ok('pickShot answers null when nothing is usable', pickShot([file('File:Tall.jpg', 800, 1200, 2025)]) === null);
  ok('HTML in the artist field is stripped', stripHtml('<a href="//x">Keith Allison</a> from Hanover, MD, USA') === 'Keith Allison from Hanover, MD, USA');
}

// ── the depiction rule, written from what the first live run got wrong ─────
// A player's Commons CATEGORY is a filing cabinet, not a claim about who is in
// a picture. The 2026-09-17 run took the best-scoring landscape file out of
// each category and 54% of its rows had a title that never mentioned the
// player — including a photograph of a different tight end under Austin
// Hooper's name. Every case below is a row that run actually produced.
console.log('\nwhether the file is a picture of this man');
{
  const P = (n) => ({ k: 'x', n, p: 'WR' });
  const F = (title, curated) => ({ title: 'File:' + title, curated: !!curated, w: 1200, h: 800, year: 2024,
                                   meta: { LicenseShortName: { value: 'CC BY-SA 2.0' } } });
  ok('the entity’s own Wikidata image is trusted outright',
     depicts(F('Anything at all.jpg', true), P('Austin Hooper')));
  ok('a file whose title names him is trusted',
     depicts(F('Adam Thielen (38373209001).jpg'), P('Adam Thielen')));
  ok('...including when others are named alongside him',
     depicts(F('Aaron Rodgers & Aaron Jones Packers-Commanders OCT2023.jpg'), P('Aaron Jones')));
  ok('...and when his name carries a suffix the filename drops',
     depicts(F('092323 LSU vs Arkansas Brian Thomas.jpg'), P('Brian Thomas Jr.')));
  // The three that shipped wrong.
  ok('a photograph whose title names a DIFFERENT player is refused',
     !depicts(F('Chiefs vs Titans TE Chigoziem Okonkwo.png'), P('Austin Hooper')));
  ok('...and one whose subject is a team-mate',
     !depicts(F('Sam Howell scramble Cardinals vs Commanders SEPT2023.jpg'), P('Antonio Gibson')));
  ok('a generic fixture photograph out of his category is refused',
     !depicts(F('Washington Commanders at Philadelphia Eagles (52510560186).jpg'), P('A.J. Brown')));
  ok('a surname too short to match a filename on is refused',
     !depicts(F('Bills vs Jets SEP2023.jpg'), P('Stefon Diggs')) && !depicts(F('Titans at Broncos 1.png'), P('Bo Nix')));
  ok('the surname must be a whole word, not a fragment',
     !depicts(F('Brownsville High 2019.jpg'), P('Marquise Brown')));

  // And the events a category collects that are not football at all.
  for (const t of ['Salute to Service Boot Camp challenges Creech and Nellis Airmen.jpg',
                   'Cleveland Browns Visit NASA Glenn (GRC-2023-C-03813).jpg',
                   'Commanders Training Camp - 54752501674.jpg',
                   'Atlanta-falcons-visit 52305534772 o.jpg']) {
    ok(`not a game: ${t.slice(0, 44)}`, scoreFile({ ...F(t, true) }, P('Any Player')) < 0);
  }

  // scoreFile only applies the rule when it is given a player, so the shape
  // and license tests above still read as they did.
  const generic = F('Washington Commanders at Philadelphia Eagles.jpg');
  ok('scoreFile with no player still scores shape and license alone', scoreFile(generic) > 0);
  ok('scoreFile with a player refuses what he is not in', scoreFile(generic, P('A.J. Brown')) < 0);
  ok('pickShot passes the player through',
     pickShot([generic, F('A.J. Brown catches one.jpg')], P('A.J. Brown')).title === 'File:A.J. Brown catches one.jpg');
  ok('...and answers null when nothing is evidently him',
     pickShot([generic], P('A.J. Brown')) === null);
}

// ── spending a capped run on players who can actually appear ───────────────
// The 2026-09-17 run walked the headshot release alphabetically, resolved 23
// photographs, and only 10 of them reached the browser — the rest were players
// the site does not price, which emitJs() drops. A capped run has to buy usable
// pictures, not alphabetical ones.
console.log('\nwhich players a capped run spends itself on');
{
  const raw = [{ k: 'zeta-nobody' }, { k: 'alpha-nobody' }, { k: 'zeta-star' }, { k: 'alpha-star' }];
  const order = orderPool(raw, new Set(['alpha-star', 'zeta-star'])).map(p => p.k);
  ok('the players the site prices are looked up first',
     order.join(',') === 'alpha-star,zeta-star,alpha-nobody,zeta-nobody', order.join(','));
  ok('and it is stable, so a resumed run is predictable',
     orderPool(raw, new Set(['alpha-star', 'zeta-star'])).map(p => p.k).join(',') === order.join(','));
  ok('an empty priced set still returns every player', orderPool(raw, new Set()).length === raw.length);
  ok('it does not mutate what it is given', raw[0].k === 'zeta-nobody');
}

// ── the API's analytics query does not belong in a reader's browser ────────
// Commons hands its thumbnail URLs back with `?utm_source=commons.wikimedia.org
// &utm_campaign=imageinfo&utm_content=thumbnail` attached. Serving that to a
// reader reports every page view of ours to Wikimedia as an imageinfo click.
console.log('\nthe URL a reader actually fetches');
{
  ok('the Commons analytics query is stripped',
     cleanUrl('https://thumb.wikimedia.org/x/1280px-A.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo')
       === 'https://thumb.wikimedia.org/x/1280px-A.jpg');
  ok('a URL with no query is untouched',
     cleanUrl('https://upload.wikimedia.org/x/B.png') === 'https://upload.wikimedia.org/x/B.png');
  ok('and nothing throws on an empty one', cleanUrl(undefined) === '' && cleanUrl(null) === '');
  const js = emitJs([{ k: 'p', u: 'https://thumb.wikimedia.org/x/C.jpg?utm_source=commons.wikimedia.org', w: 1200, h: 800, a: 'X', l: 'CC0', s: 'https://s' }], ['p']);
  ok('so the deployed map carries none of it', !/utm_/.test(js) && /C\.jpg"/.test(js));
  ok('and the map on disk carries none either', !/utm_/.test(read('it-action.js')));
}
{
  const p = { k: 'josh-allen', n: 'Josh Allen', p: 'QB' };
  const qb = { id: 'Q1', football: true, positions: ['quarterback'] };
  const lb = { id: 'Q2', football: true, positions: ['linebacker'] };
  const nf = { id: 'Q3', football: false, positions: [] };
  const un = { id: 'Q4', football: true, positions: [] };
  ok('the position Wikidata records picks the right man of two', chooseEntity(p, [lb, qb, nf]) === qb);
  ok('two men of one name and one position resolve to nobody', chooseEntity(p, [qb, { ...qb, id: 'Q5' }]) === null);
  ok('a man with no recorded position is kept only when he is the sole football player', chooseEntity(p, [un, nf]) === un && chooseEntity(p, [un, lb]) === null);
  ok('a running back answers to halfback and fullback too', positionMatches('RB', ['halfback']) === true && positionMatches('RB', ['wide receiver']) === false);
}
{
  const rows = [
    { k: 'a-player', u: 'https://u/a.jpg', w: 1200, h: 800, a: 'X', l: 'CC BY 2.0', lu: 'https://l', s: 'https://s', y: 2024, q: 'Q1', f: 'File:A.jpg', at: '2026-09-16' },
    { k: 'no-photo', none: true },
    { k: 'not-priced', u: 'https://u/b.jpg', w: 1200, h: 800, a: 'Y', l: 'CC0', s: 'https://s2' },
  ];
  const js = emitJs(rows, ['a-player', 'no-photo']);
  ok('the deployed map carries only players with a photograph whom the site prices',
     /"a-player":\{/.test(js) && !/no-photo/.test(js) && !/not-priced/.test(js));
  ok('...and only the fields the page needs, never the lookup bookkeeping', !/"q":|"f":|"at":|"why":/.test(js));
  const w = makeDom();
  new Function('window', js)(w);
  ok('the emitted file defines window.ITActionShots', w.ITActionShots && w.ITActionShots['a-player'].u === 'https://u/a.jpg');
  const row = rowFor({ k: 'x', n: 'X Y', p: 'WR' }, { id: 'Q9' }, { title: 'File:X Y 2024.jpg', url: 'https://u/x.jpg', w: 1200, h: 700, year: 2024,
    meta: { Artist: { value: '<a href="/wiki/User:Z">Z</a>' }, LicenseShortName: { value: 'CC BY-SA 2.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/2.0' } } });
  ok('a row carries the credit its license requires: artist, license, deed, file page',
     row.a === 'Z' && row.l === 'CC BY-SA 2.0' && /by-sa/.test(row.lu) && /File%3AX_Y_2024\.jpg|File:X_Y_2024\.jpg/.test(row.s));
}

// ── 4. the pages load what they paint from ─────────────────────────────────
console.log('\nthe pages');
{
  // front.html was off this list between the September 2026 homepage rewrite,
  // which took every picture off the page, and the hero picture that put one
  // back. It is on it again: the hero prefers a game photograph to a headshot,
  // so it needs the map, and it needs it before the lookup that reads it.
  for (const f of ['desk.html', 'lead.html', 'front.html']) {
    const src = read(f);
    const a = src.indexOf('<script src="/it-action.js" defer>'), b = src.indexOf('<script src="/player-search.js" defer>');
    ok(`${f} loads /it-action.js before player-search.js`, a >= 0 && b > a);
  }
  ok('weekly-wrap.html loads player-search.js for the faces beside its findings', /<script src="\/player-search\.js" defer>/.test(read('weekly-wrap.html')));
  ok('desk.html stamps its feed cards, findings and calls with the player they are about',
     (read('desk.html').match(/data-player-focus=/g) || []).length >= 3);
  // The homepage's own three pictures: the hero's plate, a face on each card's
  // one reading, and the desk cards stamped with who their findings name.
  {
    const src = read('front.html');
    ok('front.html paints the hero picture from the player lookup',
       /heroEdgePlate/.test(src) && /ITPlayerSearch/.test(src) && /PS\.plate\(/.test(src));
    // "the players they are about" is the HEADLINE's subject since 2026-09-21,
    // not the piece's whole cast: a JAX-at-DEN recap headlined on a Jaguar was
    // stamped with the three Broncos its findings open on. The stamp is still
    // required; what narrows it is `named()`, and both are checked so neither
    // can be dropped without this failing.
    ok('...and stamps the desk cards with the players they are about',
       /data-player-focus=/.test(src) && /var named = function \(who, text\)/.test(src)
       && /named\(who, p\.headline/.test(src));
    ok('...and gives each card’s reading a face', /readPic\(/.test(src) && /has-pic/.test(src));
    // The page's outline is its six sections (the lead story joined them on
    // 2026-09-21) and the hero picture is not a seventh — tools/test-homepage.mjs
    // asserts that order in the browser, and this catches a stray <section>
    // before it gets that far.
    ok('the hero picture is an aside, so the page still has exactly six sections',
       /<aside class="hm-edge"/.test(src) && (src.match(/<section class=/g) || []).length === 6);
  }
  ok('it-action.js parses and defines the map', (() => { const w = makeDom(); new Function('window', read('it-action.js'))(w); return !!w.ITActionShots; })());
  let checked = '';
  try { checked = execFileSync('node', [path.join(ROOT, 'tools', 'build-action-shots.mjs'), '--check'], { encoding: 'utf8' }); } catch (e) { checked = ''; }
  ok('it-action.js matches tools/nfl-action-shots.json (build-action-shots --check)', /matches/.test(checked), checked.trim());
  const rows = JSON.parse(read('tools/nfl-action-shots.json'));
  ok('every photograph on file carries a license the site may rely on',
     rows.filter(r => r.u).every(r => licenseOk({ LicenseShortName: { value: r.l } })), rows.filter(r => r.u && !licenseOk({ LicenseShortName: { value: r.l } })).map(r => r.k).join(', '));
  ok('every photograph on file is wider than it is tall', rows.filter(r => r.u).every(r => r.w > r.h));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
