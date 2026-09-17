#!/usr/bin/env node
// Builds the game-photograph lookup behind the story art: one openly licensed
// action photo per player, found on Wikimedia Commons and credited the way its
// license requires.
//
//   node tools/build-action-shots.mjs                 # every player without a row
//   node tools/build-action-shots.mjs --only josh-allen,bijan-robinson
//   node tools/build-action-shots.mjs --refresh       # re-resolve rows already on file
//   node tools/build-action-shots.mjs --limit 40      # stop after N lookups
//   node tools/build-action-shots.mjs --emit          # rewrite it-action.js from the JSON only
//   node tools/build-action-shots.mjs --check         # CI: it-action.js matches the JSON
//   node tools/build-action-shots.mjs --dry-run       # look, print, write nothing
//
// Behind a proxy, node's fetch needs NODE_USE_ENV_PROXY=1 (Node 22.21+).
//
// WHY WIKIMEDIA COMMONS AND NOTHING ELSE. The headshots the site runs are
// hot-linked from the publishers' own hosts under no documented license
// (docs/ip-attribution-review.md §2). A game photograph is a different class of
// asset: the wire services own theirs and sell them, and no free host carries
// NFL action imagery with terms that permit commercial redisplay — except
// Commons, where every file carries a machine-readable license. This tool only
// keeps a file whose license is one of CC0, public domain, CC BY or CC BY-SA
// (any version). NC and ND files never match the pattern and are dropped; so is
// anything Commons could not attach a license to. What CC BY and CC BY-SA ask
// in return — the photographer, the license, a link to it, a note that the
// image was cropped — travels in every row and is printed under every use
// (player-search.js storyArt()). Removing the credit from the page would put
// the photograph outside its license.
//
// HOW A PLAYER IS FOUND. Names collide (two Josh Allens have played in the
// league at once), so the lookup goes through Wikidata rather than a free-text
// search of Commons: search the name, keep the entities described as American
// football players, and check the position Wikidata records against the one
// the site prices him at. A player Wikidata cannot pin to a position is kept
// only when he is the sole football player of that name. Then the entity's own
// image (P18) and its Commons category (P373) supply the candidate files, and
// the best-scoring landscape file wins: a photograph wider than it is tall is
// the shape of a game, a portrait one is usually a headshot by another name.
//
// WHICH OF THOSE FILES IS ACTUALLY HIM. A Commons category is a filing cabinet,
// not a claim about who is in a picture, so a file has to carry evidence before
// it is used: either it IS the entity's Wikidata image (P18), or its title
// names him. See `depicts()` — the rule is there with the rows that taught it.
//
// The photos are NOT vendored. `u` is a Commons thumbnail URL at 1200px, the
// same posture as the headshots (referenced, never copied). CC permits copying,
// so vendoring is a bandwidth choice the owner can make later, not a rights one.
//
// Output:
//   tools/nfl-action-shots.json   every player looked up, resolved or not
//   it-action.js                  the deployed map, scoped to the players the
//                                 site prices (player-search.js's index)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = path.join(ROOT, 'tools', 'nfl-action-shots.json');
const JS_OUT = path.join(ROOT, 'it-action.js');
const UA = 'IronTunaBuild/1.0 (https://irontuna.com; support@irontuna.com) node-fetch';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const THUMB_W = 1200;
// The pause between calls is dynamic now — see `PAUSE` and `throttled()`.

// ── the rules, as pure functions so tools/test-story-art.mjs can hold them ──
// A license the site may rely on. Deliberately a whitelist: a new license
// string Commons starts emitting is dropped until somebody reads it.
export const LICENSE_OK = /^(?:CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? \d\.\d(?: [a-z]{2})?)$/i;
export function licenseOk(meta) {
  const m = meta || {};
  const short = String(val(m.LicenseShortName) || '').trim();
  if (LICENSE_OK.test(short)) return true;
  // Files Commons marks as not copyrighted at all (US federal government work,
  // expired copyright) sometimes carry no short name.
  return String(val(m.Copyrighted) || '').toLowerCase() === 'false';
}
function val(x) { return x && typeof x === 'object' ? x.value : x; }

// Artist and credit fields are HTML on Commons ("<a href=...>Name</a>").
export function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

// The site's positions against the labels Wikidata uses for P413.
const POS_LABELS = {
  QB: /quarterback/i,
  RB: /running back|halfback|tailback|fullback/i,
  WR: /wide receiver/i,
  TE: /tight end/i,
  FB: /fullback|running back/i,
};
export function positionMatches(pos, labels) {
  const re = POS_LABELS[pos];
  if (!re || !labels || !labels.length) return null;      // unknown: neither yes nor no
  return labels.some(l => re.test(l));
}

// Pick the entity that is this player. `cands` carry { id, description,
// football, positions: [labels] }.
export function chooseEntity(player, cands) {
  const ball = (cands || []).filter(c => c.football);
  if (!ball.length) return null;
  const yes = ball.filter(c => positionMatches(player.p, c.positions) === true);
  if (yes.length === 1) return yes[0];
  if (yes.length > 1) return null;                          // two men, same name, same position: leave it
  const unknown = ball.filter(c => positionMatches(player.p, c.positions) === null);
  return unknown.length === 1 && ball.length === 1 ? unknown[0] : null;
}

// Names that say the file is not a game photograph, whatever its shape. The
// second half of this list was added after the first live run: a player's
// Commons category is not a collection of him playing, it is everything anyone
// filed under his name, which includes the day the team toured a NASA centre.
const NOT_ACTION = /headshot|portrait|mugshot|autograph|signature|trading.?card|press.?conference|podium|interview|draft|combine|pro.?day|signing|award|ceremony|wedding|jersey.?retire|visits?\b|tour\b|training.?camp|boot.?camp|salute|airmen|military|charity|hospital|school|museum|parade|rally|media.?day|mini.?camp|ota\b|practice/i;

// DOES THE FILE DEPICT THIS MAN? The rule that was missing, and the one this
// tool exists to get right.
//
// The first live run (2026-09-17, 115 players) took the best-scoring landscape
// file out of each player's Commons CATEGORY. A category is not a claim about
// who is in a picture — it is a filing cabinet — so it handed back:
//   austin-hooper   -> "Chiefs vs Titans TE Chigoziem Okonkwo.png"   (another player)
//   antonio-gibson  -> "Sam Howell scramble Cardinals vs Commanders" (another player)
//   aidan-o-connell -> "Salute to Service Boot Camp ... Airmen"      (not football)
// Fifty-four percent of the rows had a title that never mentioned the player,
// and these were going in the homepage's hero. A wrong row is a picture of the
// wrong man, so a file now needs EVIDENCE, of one of exactly two kinds:
//
//   1. it is the entity's own image (Wikidata P18) — somebody chose that file
//      as the picture OF this person; or
//   2. its title names him.
//
// Anything else is discarded, even when it is probably fine. This trades
// coverage for never being wrong, which is the right way round for a picture
// that runs above the fold under somebody's name.
export function depicts(f, player) {
  if (!f || !player) return false;
  if (f.curated) return true;                                // Wikidata P18
  const title = String(f.title || '').toLowerCase();
  const name = String(player.n || '');
  const bare = name.replace(/\s+(?:Jr\.?|Sr\.?|I{2,3}|IV|V)$/i, '').trim();
  const parts = bare.split(/\s+/);
  const last = (parts[parts.length - 1] || '').toLowerCase();
  // A one-word or two-letter surname is too weak to match a filename on.
  if (last.length < 4) return false;
  return new RegExp('(^|[^a-z])' + last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i').test(title);
}

// Score one Commons file. `f` carries { title, w, h, year, meta, curated }.
// Landscape first, then recency, then size. Returns -1 for a file the site
// must not use. `player` is required for the depiction test; passing none
// scores only the shape and the license, which is what the unit tests do.
export function scoreFile(f, player) {
  if (!f || !licenseOk(f.meta)) return -1;
  if (!f.w || !f.h || f.w < 600) return -1;
  if (NOT_ACTION.test(f.title || '')) return -1;
  if (player && !depicts(f, player)) return -1;
  const ratio = f.w / f.h;
  let s = 0;
  if (ratio >= 1.15 && ratio <= 2.4) s += 100;
  else if (ratio > 2.4) s += 40;                             // a panorama crops, a portrait does not
  else return -1;                                            // taller than wide: a headshot by another name
  if (f.year) s += Math.max(0, Math.min(30, f.year - 2000)) * 3;
  s += Math.min(f.w, 2400) / 100;
  if (f.curated) s += 10;
  return s;
}
export function pickShot(files, player) {
  let best = null, bestScore = -1;
  for (const f of files || []) {
    const s = scoreFile(f, player);
    if (s > bestScore) { best = f; bestScore = s; }
  }
  return bestScore < 0 ? null : best;
}

// THE PLAYERS THE SITE PRICES COME FIRST. The headshot release is ~1,260 names
// in alphabetical order and `emitJs()` ships only the ones player-search.js
// indexes, so a run that walks the alphabet spends most of its budget on
// players who can never appear on a page: the 2026-09-17 run resolved 23
// photographs and only 10 of them reached the browser. Sorting the priced pool
// to the front means a capped run buys as many usable pictures as it can.
// Alphabetical within each group, so the order is stable and a resumed run is
// predictable.
export function orderPool(rows, priced) {
  const has = k => (priced instanceof Set ? priced.has(k) : !!(priced || {})[k]);
  return (rows || []).slice().sort((a, b) => {
    const pa = has(a.k) ? 0 : 1, pb = has(b.k) ? 0 : 1;
    return pa !== pb ? pa - pb : (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
  });
}

// The row that travels: what the page needs to show the picture and to credit
// it. Nothing else, so the deployed map stays small.
export function rowFor(player, ent, f) {
  const m = f.meta || {};
  return {
    k: player.k, n: player.n, q: ent ? ent.id : undefined,
    f: f.title, u: f.url, w: f.w, h: f.h, y: f.year || undefined,
    // Why this file was trusted to be him, so a reviewer can see the evidence
    // in the diff rather than taking the tool's word for it. It never reaches
    // the browser: emitJs() drops everything but the picture and its credit.
    why: f.curated ? 'p18' : 'named',
    a: stripHtml(val(m.Artist)) || stripHtml(val(m.Credit)) || 'Wikimedia Commons',
    l: String(val(m.LicenseShortName) || 'Public domain').trim(),
    lu: String(val(m.LicenseUrl) || '').trim() || undefined,
    s: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(String(f.title).replace(/ /g, '_')),
    at: new Date().toISOString().slice(0, 10),
  };
}

// The deployed file. Scoped to the players player-search.js indexes — that is
// the set every story surface can resolve a name to — so a photograph of a
// player the site does not price never ships. `--check` compares this text.
export function emitJs(rows, indexKeys) {
  const keep = new Set(indexKeys || []);
  const map = {};
  for (const r of rows) {
    if (!r || !r.u || (keep.size && !keep.has(r.k))) continue;
    map[r.k] = { u: r.u, w: r.w, h: r.h, a: r.a, l: r.l, lu: r.lu, s: r.s, y: r.y };
    for (const key of Object.keys(map[r.k])) if (map[r.k][key] === undefined) delete map[r.k][key];
  }
  const keys = Object.keys(map).sort();
  const body = keys.map(k => '  ' + JSON.stringify(k) + ':' + JSON.stringify(map[k])).join(',\n');
  return '/* Iron Tuna — game photographs for the story art. GENERATED by\n'
    + ' * tools/build-action-shots.mjs from tools/nfl-action-shots.json; do not hand-edit.\n'
    + ' * Every file is openly licensed on Wikimedia Commons (CC0, public domain,\n'
    + ' * CC BY or CC BY-SA) and the credit its license requires travels with it:\n'
    + ' * player-search.js prints it under every use. Keys are the player slugs\n'
    + ' * player-search.js indexes. */\n'
    + 'window.ITActionShots = {\n' + body + (keys.length ? '\n' : '') + '};\n';
}

// ── the network ────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── being throttled is not a failure, it is an instruction ─────────────────
// The 2026-09-17 run asked for 400 players and got:
//   looked up 400: 23 photographs, 71 without, 306 failed
// Wikidata started answering 429 after about ninety players and every request
// after that failed INSTANTLY, so the run spent three quarters of its budget
// hammering a service that had already told it to stop. A fixed 250ms pause is
// not a rate limit, it is a hope.
//
// So: a 429 or a 5xx is retried, `Retry-After` is obeyed when the server sends
// one, and the pause between every subsequent call grows and then decays back
// down. `PAUSE` is module state on purpose — the whole run shares one throttle,
// because the service is rate-limiting the CLIENT, not the request.
let PAUSE = 250;
const PAUSE_MIN = 250, PAUSE_MAX = 4000;
const RETRIES = 4;
function throttled() { PAUSE = Math.min(PAUSE_MAX, Math.max(PAUSE * 2, 1000)); }
function eased() { if (PAUSE > PAUSE_MIN) PAUSE = Math.max(PAUSE_MIN, Math.round(PAUSE * 0.9)); }
export function pauseMs() { return PAUSE; }

async function api(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params })) u.searchParams.set(k, v);
  let last = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(u, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    } catch (e) {                                            // a dropped socket is worth one more try
      last = e; throttled(); await sleep(PAUSE); continue;
    }
    if (res.ok) { eased(); return res.json(); }
    last = new Error(`${u.host} ${res.status}`);
    if (res.status !== 429 && res.status < 500) throw last;  // a 404 will not improve with time
    throttled();
    // `Retry-After` is seconds, or an HTTP date. Honour it when it is sane and
    // fall back to the growing pause with a little jitter so a whole run does
    // not come back in lockstep.
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 && ra <= 120
      ? ra * 1000
      : PAUSE * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
    await sleep(wait);
  }
  throw last || new Error(`${u.host} gave up`);
}

async function findEntity(player) {
  const s = await api(WIKIDATA, { action: 'wbsearchentities', search: player.n, language: 'en', type: 'item', limit: '8' });
  const ids = (s.search || []).map(h => h.id);
  if (!ids.length) return null;
  const e = await api(WIKIDATA, { action: 'wbgetentities', ids: ids.join('|'), props: 'claims|descriptions', languages: 'en' });
  const ents = Object.values(e.entities || {});
  const posIds = new Set();
  const cands = ents.map(ent => {
    const desc = ent.descriptions && ent.descriptions.en ? ent.descriptions.en.value : '';
    const claim = p => (ent.claims && ent.claims[p]) || [];
    const ids413 = claim('P413').map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
    ids413.forEach(id => posIds.add(id));
    const image = claim('P18').map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean)[0] || null;
    const cat = claim('P373').map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean)[0] || null;
    return { id: ent.id, football: /american football/i.test(desc), ids413, image, cat };
  });
  let labels = {};
  if (posIds.size) {
    const l = await api(WIKIDATA, { action: 'wbgetentities', ids: [...posIds].join('|'), props: 'labels', languages: 'en' });
    for (const [id, ent] of Object.entries(l.entities || {})) labels[id] = ent.labels && ent.labels.en ? ent.labels.en.value : '';
  }
  for (const c of cands) c.positions = c.ids413.map(id => labels[id]).filter(Boolean);
  return chooseEntity(player, cands);
}

async function candidateFiles(ent) {
  const titles = new Set();
  if (ent.image) titles.add('File:' + ent.image);
  if (ent.cat) {
    const r = await api(COMMONS, { action: 'query', list: 'categorymembers', cmtitle: 'Category:' + ent.cat, cmtype: 'file', cmlimit: '50' });
    for (const m of (r.query && r.query.categorymembers) || []) titles.add(m.title);
  }
  const out = [];
  const list = [...titles];
  for (let i = 0; i < list.length; i += 50) {
    const r = await api(COMMONS, { action: 'query', titles: list.slice(i, i + 50).join('|'), prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata|timestamp', iiurlwidth: String(THUMB_W), iiextmetadatalanguage: 'en' });
    for (const pg of (r.query && r.query.pages) || []) {
      const ii = pg.imageinfo && pg.imageinfo[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) continue;
      const meta = ii.extmetadata || {};
      const when = String(val(meta.DateTimeOriginal) || val(meta.DateTime) || ii.timestamp || '');
      const year = +(when.match(/(19|20)\d\d/) || [])[0] || 0;
      out.push({ title: pg.title, url: ii.thumburl || ii.url, w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height,
                 year, meta, curated: ent.image && pg.title === 'File:' + ent.image });
    }
  }
  return out;
}

function indexKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'player-search.js'), 'utf8');
  const m = src.match(/var INDEX_RAW = ("(?:[^"\\]|\\.)*");/);
  if (!m) throw new Error('player-search.js: INDEX_RAW not found');
  return JSON.parse(m[1]).split('\n').filter(Boolean).map(l => l.split('|')[0]);
}
function readRows() {
  try { return JSON.parse(fs.readFileSync(JSON_OUT, 'utf8')); } catch (e) { return []; }
}
function writeRows(rows) {
  rows.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{') + '\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = f => argv.includes(f);
  const opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const rows = readRows();
  const byKey = new Map(rows.map(r => [r.k, r]));

  if (flag('--check')) {
    const want = emitJs(rows, indexKeys());
    const have = fs.existsSync(JS_OUT) ? fs.readFileSync(JS_OUT, 'utf8') : '';
    if (want !== have) { console.error('it-action.js is stale: run node tools/build-action-shots.mjs --emit'); process.exit(1); }
    console.log(`it-action.js matches tools/nfl-action-shots.json (${rows.filter(r => r.u).length} photographs on file)`);
    return;
  }
  if (!flag('--emit')) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'nfl-headshots.json'), 'utf8'));
    // THE PLAYERS THE SITE PRICES COME FIRST. The headshot release is ~1,260
    // names in alphabetical order and `emitJs()` ships only the ones
    // player-search.js indexes, so a run that walks the alphabet spends most of
    // its budget on players who can never appear on a page: the 2026-09-17 run
    // resolved 23 photographs and only 10 of them reached the browser. Sorting
    // the priced pool to the front means a capped run buys as many usable
    // pictures as it can. Alphabetical within each group, so the order is still
    // stable and a resumed run is predictable.
    const pool = orderPool(raw, new Set(indexKeys()));
    const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
    const limit = +opt('--limit') || Infinity;
    const refresh = flag('--refresh');
    let looked = 0, found = 0, none = 0, failed = 0;
    for (const p of pool) {
      if (only && !only.has(p.k)) continue;
      const prior = byKey.get(p.k);
      if (prior && !refresh) continue;
      if (looked >= limit) break;
      looked++;
      let row = { k: p.k, n: p.n, none: true, at: new Date().toISOString().slice(0, 10) };
      try {
        const ent = await findEntity(p);
        await sleep(PAUSE);
        if (ent) {
          const files = await candidateFiles(ent);
          const best = pickShot(files, p);
          if (best) row = rowFor(p, ent, best);
          else row.q = ent.id;
        }
      } catch (e) {
        failed++;
        console.error(`  ${p.k}: ${e.message}`);
        continue;                                            // leave the prior row, if any, untouched
      }
      if (row.u) found++; else none++;
      console.log(`  ${p.k}: ${row.u ? row.f + ' (' + row.l + ')' : 'no usable photograph'}`);
      byKey.set(p.k, row);
      await sleep(PAUSE);
    }
    console.log(`looked up ${looked}: ${found} photographs, ${none} without, ${failed} failed (pause ended at ${PAUSE}ms)`);
    // A run that mostly failed produced a thin, misleading result and used to
    // look exactly like a good one. Say so where a reader and GitHub both see
    // it; the rows it did get are still valid, so this is a warning, not an
    // error, and the incremental next run picks the failures back up.
    if (looked && failed > looked / 4) {
      console.log(`::warning title=Most lookups failed::${failed} of ${looked} lookups failed, `
        + 'almost certainly rate limiting. The rows in this run are still good; re-run to continue.');
    }
    if (flag('--dry-run')) return;
    writeRows([...byKey.values()]);
  }
  const all = [...byKey.values()];
  const js = emitJs(all, indexKeys());
  if (flag('--dry-run')) { console.log(js.slice(0, 600)); return; }
  fs.writeFileSync(JS_OUT, js);
  console.log(`it-action.js: ${(js.match(/^  "/gm) || []).length} players with a game photograph`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
