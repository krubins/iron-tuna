#!/usr/bin/env node
// Tests for the generated lead story: the D1 read in _worker.js, the routes
// that serve it, and the front page's contract with them.
//   node tools/test-lead-story.mjs
//
// The thing this has to protect is the FALLBACK. The front page paints a lead
// out of its own dated deep dives first and only then asks the API for a fresh
// one, so a bad day at the insight desk costs the reader nothing. Every failure
// mode below — no row, no slug, a category nobody defined, malformed JSON in a
// column, D1 itself throwing — must come back as "no story" rather than as an
// exception, because an exception here is a blank hero on the site's front door.
//
// Like the other worker tests this evaluates the REAL source rather than a
// reimplementation, so the section cannot drift away from what deploys.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const front = fs.readFileSync(path.join(ROOT, 'front.html'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'lead.html'), 'utf8');

// ── lift the lead-story section out of the worker ──────────────────────────
const START = 'let _LEAD_CACHE = null;';
const END = '\n}\n';
const s0 = src.indexOf(START);
if (s0 < 0) { console.error('FAIL: could not locate the lead-story section in _worker.js'); process.exit(1); }
const e0 = src.indexOf('function leadSlug', s0);
const section = src.slice(s0, src.indexOf(END, e0) + END.length);

const mk = () => new Function(`
  ${section}
  return { leadStoryPayload, leadRow, leadSlug, LEAD_CATEGORIES, LEAD_RECENT, LEAD_FACES, leadSlot, LEAD_SLOT_MS,
           leadClock, etClock, etOffsetHours, LEAD_TZ };
`)();

// ── a D1 stand-in ──────────────────────────────────────────────────────────
// Close enough to the real binding to exercise the code path: prepare/bind
// chain, .first() for one row, .all() for the list. `rows` is consulted by
// which query ran, because the payload runs two different ones.
function db(rows, opts = {}) {
  return {
    LEADS_DB: {
      prepare(sql) {
        if (opts.throwOn && sql.includes(opts.throwOn)) throw new Error('d1 down');
        const args = [];
        const api = {
          bind(...a) { args.push(...a); return api; },
          async first() {
            if (opts.throwAsync) throw new Error('d1 down');
            if (sql.includes('published = 1')) return rows.find(r => r.verified && r.published) || null;
            return rows.find(r => r.slug === args[0] && r.verified) || null;
          },
          async all() {
            const lim = args[args.length - 1];
            return { results: rows.filter(r => r.verified && r.slug && r.slug !== args[0]).slice(0, lim) };
          }
        };
        return api;
      }
    }
  };
}

const ROW = (o) => ({ slug: 'a-slug', title: 'A title', dek: 'A dek', category: 'vegas',
                      players: null, created_at: 1787000000000, verified: 1, published: 0, ...o });

console.log('\nthe payload the front page reads');
{
  const w = mk();
  const rows = [
    ROW({ slug: 'newest', title: 'Newest', published: 1, created_at: 5 }),
    ROW({ slug: 'older-1', title: 'Older one', created_at: 4 }),
    ROW({ slug: 'older-2', title: 'Older two', created_at: 3 }),
    ROW({ slug: 'held-back', title: 'Held', verified: 0, created_at: 6 })
  ];
  const out = await w.leadStoryPayload(db(rows));
  ok('the published, verified row is the lead', out.ok === true && out.story.slug === 'newest');
  ok('the lead never repeats inside its own archive',
     out.recent.every(r => r.slug !== 'newest'), out.recent.map(r => r.slug).join());
  ok('retired rows still make the archive', out.recent.length === 2);
  // verified = 0 is the gate the run sets on itself when it could not stand up
  // every number. It must not reach a reader by any route, lead or archive.
  ok('an unverified row is nowhere on the page',
     out.story.slug !== 'held-back' && out.recent.every(r => r.slug !== 'held-back'));
  ok('the archive is capped', w.LEAD_RECENT === 5);
  ok('the body never rides along on the front page', out.story.body === undefined);
}

console.log('\nwhat the desk labels are allowed to be');
{
  const w = mk();
  // The user-facing desk names are the site's, not the run's. A row storing an
  // unknown string must fall back rather than invent a new desk on the lead.
  ok('every category the routine rotates is defined here',
     ['player', 'playcaller', 'vegas', 'preseason', 'injury', 'market', 'analyst']
       .every(k => typeof w.LEAD_CATEGORIES[k] === 'string' && w.LEAD_CATEGORIES[k].length));
  const bogus = w.leadRow(ROW({ category: 'whatever-the-model-felt-like' }));
  ok('an unknown category is refused', bogus.category === null && bogus.label === 'Insight');
  const none = w.leadRow(ROW({ category: null }));
  ok('a missing category still labels the card', none.label === 'Insight');
  const good = w.leadRow(ROW({ category: 'PlayCaller' }));
  ok('the category is matched case-insensitively',
     good.category === 'playcaller' && good.label === 'Play-Caller Premium', good.label);
  // The analyst desk quotes named outside analysts by name. Its label has to
  // make clear whose call is whose, or the front page reads as though Iron Tuna
  // were the one making the ranking it is arguing with.
  const an = w.leadRow(ROW({ category: 'analyst' }));
  ok('the analyst desk says whose board is whose',
     an.category === 'analyst' && /Iron Tuna/.test(an.label), an.label);
}

console.log('\nthe faces the story commits to');
{
  const w = mk();
  ok('a full name becomes the photo key build-front.mjs uses',
     w.leadSlug('Kenneth Walker III') === 'kenneth-walker-iii');
  ok('an accent is folded, not dropped', w.leadSlug('Amon-Ra St. Brown') === 'amon-ra-st-brown');
  const r = w.leadRow(ROW({ players: JSON.stringify(['Bijan Robinson', 'trey-mcbride']) }));
  ok('names and slugs both resolve', r.ppl.join() === 'bijan-robinson,trey-mcbride');
  const many = w.leadRow(ROW({ players: JSON.stringify(['a b', 'c d', 'e f', 'g h', 'i j', 'k l']) }));
  ok('the band is capped at four faces', many.ppl.length === 4);
  const junk = w.leadRow(ROW({ players: '{not json' }));
  ok('malformed players JSON is empty, not fatal', Array.isArray(junk.ppl) && junk.ppl.length === 0);
}

console.log('\nthe faces that travel with the story');
{
  const w = mk();
  // front.html's own PLAYERS cast only covers players the AUTHORED drop pages
  // name. A generated run can name anybody on the board, and did: a four-player
  // story rendered one photo because three of its names had never appeared in a
  // drop page. The worker ships the faces so the page never has to have heard of
  // the player.
  ok('the worker carries a face map', Object.keys(w.LEAD_FACES).length > 200,
     String(Object.keys(w.LEAD_FACES).length));
  const jj = w.LEAD_FACES['justin-jefferson'];
  ok('including players no drop page ever wrote about', !!jj, 'justin-jefferson missing');
  ok('a face carries what the page needs to draw it',
     !!jj && jj.n && jj.t && jj.p && jj.h, JSON.stringify(jj));
  // discEl() tries the ESPN id before the nfl.com URL, so a fallback face is
  // only identical to a local one if the id travels too.
  ok('and the ESPN id discEl prefers', !!jj && !!jj.e);

  const r = w.leadRow(ROW({ players: JSON.stringify(['Justin Jefferson', 'Jordan Addison']) }));
  ok('the story ships a face for each name it commits to', r.cast.length === 2);
  ok('the face is keyed by the same slug the page looks up',
     r.cast[0].k === 'justin-jefferson' && r.cast[0].k === r.ppl[0]);
  // A name the map has never heard of must drop out rather than render an empty
  // disc next to a real one.
  const unknown = w.leadRow(ROW({ players: JSON.stringify(['Justin Jefferson', 'Nobody At All']) }));
  ok('a name with no face is left out, not left blank',
     unknown.ppl.length === 2 && unknown.cast.length === 1);
  const none = w.leadRow(ROW({ players: null }));
  ok('a story naming nobody ships no faces', Array.isArray(none.cast) && none.cast.length === 0);
}

console.log('\nevery way the desk can have a bad day');
{
  // Each of these must come back as "no story" so the page keeps the lead it
  // already painted. None may throw.
  const w1 = mk();
  ok('no published row at all', (await w1.leadStoryPayload(db([ROW({ published: 0 })]))).ok === false);

  const w2 = mk();
  ok('a published row that never passed the gate',
     (await w2.leadStoryPayload(db([ROW({ published: 1, verified: 0 })]))).ok === false);

  // A row without a slug would render a link to /lead/null, so it counts as no
  // lead rather than as a lead nobody can open.
  const w3 = mk();
  ok('a published row with no slug',
     (await w3.leadStoryPayload(db([ROW({ published: 1, slug: null })]))).ok === false);

  const w4 = mk();
  const thrown = await w4.leadStoryPayload(db([], { throwOn: 'SELECT' }));
  ok('D1 throwing on prepare', thrown.ok === false && thrown.error === 'unavailable');

  const w5 = mk();
  const rejected = await w5.leadStoryPayload(db([ROW({ published: 1 })], { throwAsync: true }));
  ok('D1 rejecting mid-query', rejected.ok === false && rejected.error === 'unavailable');

  const w6 = mk();
  ok('no database bound at all', (await w6.leadStoryPayload({})).ok === false);
}

console.log('\nthe routes');
{
  // /lead is the current story, /lead/<slug> one from the archive. The pattern
  // is also the only thing standing between a crafted path and the asset layer.
  const re = /^\/lead(\/[A-Za-z0-9._-]*)?\/?$/;
  // The target is '/lead', NOT '/lead.html'. The assets layer's default
  // html_handling ("auto-trailing-slash") answers /lead.html with a 307 to /lead
  // — the very path this pattern fires on — so a ".html" target is an infinite
  // redirect, which is what /lead served on the day it shipped. This assertion
  // used to pin the broken form. tools/test-asset-routing.mjs covers the class.
  ok('the rewrite is in the worker', src.includes("new URL('/lead', url)"));
  ok('the rewrite target is extensionless', !src.includes("new URL('/lead.html', url)"));
  ok('/lead resolves', re.test('/lead'));
  ok('/lead/ resolves', re.test('/lead/'));
  ok('/lead/<slug> resolves', re.test('/lead/rb-repricing-max-bids-2026-08-19'));
  ok('a traversal attempt does not', !re.test('/lead/../_worker.js'));
  ok('a nested path does not', !re.test('/lead/a/b'));
  ok('a lookalike prefix does not', !re.test('/leadership'));
  ok('the JSON route is registered', src.includes("url.pathname === '/api/lead-story'"));
  ok('the body route is registered', src.includes("url.pathname === '/api/lead-story/body'"));
  // /api/lead already existed as the email capture. The two must not collide.
  ok('the pre-existing /api/lead capture still stands', src.includes("url.pathname === '/api/lead'"));
}

console.log('\nthe front page keeps its own lead as the floor');
{
  ok('it paints the dated rotation before asking for anything',
     front.indexOf('renderLead(); startTick();') < front.indexOf('loadGeneratedLead()'));
  ok('a failed fetch is swallowed', /loadGeneratedLead[\s\S]{0,400}\.catch\(function\(\)\{\}\)/.test(front));
  ok('a payload with no story paints nothing',
     /function paintGeneratedLead\(d\)\{?\s*\n\s*if \(!d \|\| !d\.ok \|\| !d\.story \|\| !d\.story\.slug\) return;/.test(front));
  ok('the generated lead retires the rotation controls', front.includes("getElementById('leadCtrls')"));
  ok('the photo band falls back to the faces the story brought',
     /PLAYERS\[k\] \|\| sent\[k\]/.test(front));
  ok('...and still prefers the page\u2019s own cast when it has one',
     front.indexOf('PLAYERS[k] || sent[k]') > 0 && !/sent\[k\] \|\| PLAYERS\[k\]/.test(front));
  ok('the controls row can actually be hidden', front.includes('.lead-ctrls[hidden]{display:none}'));
  ok('the countdown still names the three-hour cadence', front.includes('next insight in '));
  ok('the archive is links, never a carousel the lead cycles into',
     front.includes('Recent insights') && !/leadPool\.push/.test(front));
}

console.log('\nthe article page');
{
  ok('it reads its slug off the path', /location\.pathname\.match\(/.test(page));
  ok('it asks for the body, not the front page payload', page.includes('/api/lead-story/body'));
  // These stories are replaced every three hours, so a search result pointing at
  // one points at something already gone.
  ok('it is kept out of the index', /<meta name="robots" content="noindex,follow">/.test(page));
  ok('a wide bid table scrolls on its own', page.includes(".className = 'tw'"));
  ok('the sources list is collapsed by default', page.includes('<details class="srcs">'));
  ok('an unreachable desk still says something', page.includes('function fail('));
}

console.log('\none slot, one story');
{
  const w = mk();
  // The desk publishes on a three-hour clock. The run derives its desk from
  // floor(epoch_seconds / 10800); this derives the same slot from a row's
  // created_at, so a story can be placed in the slot it belongs to.
  ok('a slot is three hours', w.LEAD_SLOT_MS === 10800000);
  ok('the slot matches the run\u2019s own arithmetic',
     w.leadSlot(Date.parse('2026-08-22T04:20:54Z')) === Math.floor(Date.parse('2026-08-22T04:20:54Z') / 1000 / 10800));
  // The four rows of 2026-08-21 slot 165494, the collision this exists to make
  // visible: 19:19, 19:56, 20:09 and 20:16 all land in one slot.
  const four = ['2026-08-21T19:19:22Z', '2026-08-21T19:56:43Z', '2026-08-21T20:09:45Z', '2026-08-21T20:16:01Z']
    .map(t => w.leadSlot(Date.parse(t)));
  ok('the real collision lands in one slot',
     new Set(four).size === 1 && four[0] === 165494, four.join());
  // ...and the runs either side of it do not, or the guard would fire on every
  // ordinary night.
  ok('consecutive scheduled runs do not collide',
     w.leadSlot(Date.parse('2026-08-22T01:14:13Z')) !== w.leadSlot(Date.parse('2026-08-22T04:20:54Z')));
  ok('a missing timestamp does not throw', w.leadSlot(null) === 0 && w.leadSlot(undefined) === 0);

  const route = src.slice(src.indexOf("url.pathname === '/api/admin/lead'"),
                          src.indexOf("url.pathname === '/api/admin/odds-status'"));
  ok('the admin desk stamps each story with its slot', /slot: leadSlot\(r\.created_at\)/.test(route));
  ok('...and names the slots holding more than one', /doubledSlots/.test(route));
  ok('...and says which slot is open now', /currentSlot: leadSlot\(Date\.now\(\)\)/.test(route));
}

console.log('\nthe admin desk');
{
  // /api/admin/lead exists to make one specific mistake impossible. Unpublishing
  // the lead does NOT promote the previous story, so "SET published=0" on its own
  // drops the front page back to the dated rotation. The route must therefore
  // never issue that statement alone when there is a replacement available.
  const route = src.slice(src.indexOf("url.pathname === '/api/admin/lead'"),
                          src.indexOf("url.pathname === '/api/admin/odds-status'"));
  ok('the route is behind the same admin key as every other admin route',
     /adminOk\(env, url\.searchParams\.get\('key'\)/.test(route));
  ok('an id that is not a number is refused', /\/\^\\d\+\$\/\.test\(v\)/.test(route));
  ok('promote and pull cannot be asked for at once', route.includes("'pick_one'"));

  // The two statements of each operation go to D1.batch, which runs them as one
  // transaction. Two awaited prepare().run() calls would reopen the window.
  ok('promote is one batch, not two writes',
     /promote[\s\S]{0,900}LEADS_DB\.batch\(\[[\s\S]{0,400}SET verified = 1, published = 1[\s\S]{0,300}SET published = 0 WHERE id <> \?/.test(route));
  ok('pull is one batch, not two writes',
     /pull[\s\S]{0,900}LEADS_DB\.batch\(stmts\)/.test(route));

  // The whole point: the replacement is chosen BEFORE the unpublish, and both
  // land together.
  const pullBlock = route.slice(route.indexOf('} else if (pull !== null) {'), route.indexOf('} catch (e)'));
  ok('pull finds its replacement before unpublishing anything',
     pullBlock.indexOf('ORDER BY created_at DESC LIMIT 1') < pullBlock.indexOf('SET published = 0 WHERE id = ?'));
  ok('the replacement must itself be verified and have a slug',
     /WHERE verified = 1 AND slug IS NOT NULL AND id <> \?/.test(pullBlock));
  ok('pulling the last story says so rather than failing silently',
     pullBlock.includes('nothing left to publish'));

  // A story with no slug renders /lead/null, so promoting one would look like it
  // worked and change nothing on the page.
  ok('a story with no slug cannot be promoted', route.includes("'no_slug'"));
  // Promoting a held row overrides the run's own verification gate. Allowed, but
  // never silent.
  ok('overriding the verification gate is reported', route.includes('overrodeGate'));
  ok('a write busts the two-minute memo', /_LEAD_CACHE = null;\s*_LEAD_AT = 0;/.test(route));
  ok('the listing says why each row is or is not on the site',
     route.includes("'held (failed its own gate)'") && route.includes("'unusable (no slug)'")
     && route.includes("'LIVE'") && route.includes("'archive'"));
  // Reporting the flags would let the response disagree with the page.
  ok('it reports the live story by reading it back the way the site does',
     route.includes('await leadStoryPayload(env)'));
}

// ── the countdown points at when a story actually lands ─────────────────────
// The desk's Routine is `58 */3 * * *`. The countdown used to target the SLOT
// BOUNDARY, so it told a reader "next insight in 37m" when the run had not even
// fired yet and the story was ~95 minutes away. It was wrong by the cron offset
// in every slot, and an open tab looked for the new story an hour before it
// existed and then gave up for three hours.
{
  const SLOT_MS = 3 * 60 * 60 * 1000;
  // Pull the real constants out of front.html rather than restating them, so
  // this fails if someone edits the page and not the cron (or the reverse).
  const cron = Number((front.match(/var LEAD_CRON_MS = (\d+) \* 60 \* 1000/) || [])[1]);
  const write = Number((front.match(/var LEAD_WRITE_MS = (\d+) \* 60 \* 1000/) || [])[1]);
  ok('the page knows the run fires at :58, matching the `58 */3 * * *` cron', cron === 58);
  // MEASURED from the nine scheduled runs on record, not guessed. The first
  // version of this constant was 8 minutes, below every single observation, so
  // the countdown promised a story before any run had ever delivered one.
  const WRITES = [10, 11, 12, 13, 14, 16, 21, 22, 27];
  ok('the write estimate is not below every run ever observed',
     write >= WRITES[0]);
  ok('and is not above every one either', write <= WRITES[WRITES.length - 1]);
  ok('it sits at or near the median of what actually happened',
     Math.abs(write - WRITES[(WRITES.length - 1) / 2 | 0]) <= 3);

  // Reimplement exactly what the page computes, then check it against the clock.
  const slotOf = ms => Math.floor(ms / SLOT_MS);
  const dueAt = now => slotOf(now) * SLOT_MS + (cron + write) * 60000;
  const toNext = now => { const d = dueAt(now); return (d > now ? d : d + SLOT_MS) - now; };

  const slotStart = 165501 * SLOT_MS;               // 2026-08-22 15:00:00 UTC
  const min = n => slotStart + n * 60000;
  ok('at the slot boundary the countdown is the full cron offset, not zero',
     Math.round(toNext(slotStart) / 60000) === cron + write);
  // The bug, stated as a number: at 14:23 the old code said 37m.
  ok('37 minutes before the boundary it does NOT claim a story in 37 minutes',
     Math.round(toNext(slotStart - 37 * 60000) / 60000) === 37 + cron + write);
  // One minute after the story is due, the next one is a full slot away less
  // that minute: 180 - 1 = 179, NOT 180 - (cron + write) - 1.
  ok('once the story has landed the countdown rolls to the next slot',
     Math.round(toNext(min(cron + write + 1)) / 60000) === 179);
  ok('the countdown is never negative and never exceeds one slot', [
       slotStart - 1, slotStart, min(1), min(cron), min(cron + write), min(179),
     ].every(t => { const v = toNext(t); return v > 0 && v <= SLOT_MS; }));

  // The refetch is decided by SLOT comparison, not by a window after the
  // boundary, so an early, late or held-back run cannot strand an open tab.
  // It is gated on the run having FIRED, not on the write estimate: the write
  // time ranges 10-27 minutes and a story that lands early must not sit unseen
  // waiting for the estimate to catch up.
  const firedAt = now => slotOf(now) * SLOT_MS + cron * 60000;
  const stale = (storyMs, now) => slotOf(storyMs) < slotOf(now) && now >= firedAt(now);
  const prev = (165500 * SLOT_MS) + 116 * 60000;    // the 13:56 story, slot 165500
  ok('a tab does not go looking before the run has fired',
     !stale(prev, min(cron - 5)));
  ok('it looks as soon as the run has fired, not when the estimate says done',
     stale(prev, min(cron + 1)));
  ok('the fastest run on record is inside the looking window',
     stale(prev, min(cron + WRITES[0])));
  ok('so is the slowest, with 40 minutes of looks at two-minute spacing',
     WRITES[WRITES.length - 1] <= 40 && stale(prev, min(cron + WRITES[WRITES.length - 1])));
  ok('and it stops as soon as it is holding this slot\'s story',
     !stale(min(cron), min(cron + write + 30)));
  // The real 15:58 run: fired 15:58, published 16:12 into slot 165501.
  ok('the run this was built from would have been picked up',
     stale(prev, (165501 * SLOT_MS) + 72 * 60000));
  // The old code looked in the six minutes after the boundary. State plainly
  // that that window is before the story exists, so nothing is found there.
  ok('the six minutes after the boundary — where the old code looked — is too early',
     [1, 2, 3, 4, 5, 6].every(m => !stale(prev, min(m))));

  // Guard the regression directly: the lead stamp must not use the deep-dive
  // rotation's boundary countdown.
  const paint = front.slice(front.indexOf('function paintGeneratedLead'),
                            front.indexOf('function leadStamp'));
  ok('the generated lead does not count down to the slot boundary',
     !paint.includes('msToNextSlot()'));
  ok('it counts down to the next expected publish instead',
     (paint.match(/msToNextLead\(\)/g) || []).length >= 2);
  ok('the polling loop is bounded so a held-back run cannot poll forever',
     /looks < \d+/.test(paint));
  ok('it looks from when the run fires, not from the write estimate',
     paint.includes('leadFiredAt(now)') && !paint.includes('now >= leadDueAt(now)'));
  // Asking faster than /api/lead-story's own memo can only return the same
  // cached answer.
  ok('it never asks more often than the two-minute server memo',
     /lastLook >= 120000/.test(paint));
}

// ── the desk's clock, in a clock a reader keeps ────────────────────────────
// The runs are scheduled in UTC and wrote it into the copy: "today's 11:00 UTC
// odds refresh". The audience is American fantasy managers, none of whom keep a
// UTC clock, so the payload converts every clock time to Eastern on the way
// out. A wrong hour here would be worse than the UTC it replaced, so both the
// Intl path and the hand-rolled fallback are checked, and against each other.
console.log('\nUTC never reaches a reader');
{
  const m = mk();
  const AUG = Date.UTC(2026, 7, 22, 12, 58);      // EDT, UTC-4
  const JAN = Date.UTC(2026, 0, 15, 12, 0);       // EST, UTC-5

  ok('the odds refresh is stated in Eastern, not UTC',
     m.leadClock("Today's 11:00 UTC odds refresh ranks Baltimore first.", AUG)
     === "Today's 7:00 AM ET odds refresh ranks Baltimore first.",
     m.leadClock("Today's 11:00 UTC odds refresh ranks Baltimore first.", AUG));
  ok('winter is an hour further back, because the offset is not a constant',
     m.leadClock('pulled at 11:00 UTC', JAN) === 'pulled at 6:00 AM ET',
     m.leadClock('pulled at 11:00 UTC', JAN));
  ok('an evening run reads as the evening', m.leadClock('the 21:58 UTC run', AUG) === 'the 5:58 PM ET run');
  ok('a time written without minutes keeps its shape',
     m.leadClock('the 11 UTC refresh', AUG) === 'the 7 AM ET refresh', m.leadClock('the 11 UTC refresh', AUG));
  ok('a 12-hour source time converts from the right hour',
     m.leadClock('3:30 p.m. UTC', AUG) === '11:30 AM ET', m.leadClock('3:30 p.m. UTC', AUG));
  ok('GMT is the same clock under another name', m.leadClock('11:00 GMT', AUG) === '7:00 AM ET');
  ok('an overnight time that lands on the previous Eastern day says so',
     /9:00 PM ET \(the previous day\)/.test(m.leadClock('pulled at 01:00 UTC', AUG)),
     m.leadClock('pulled at 01:00 UTC', AUG));
  ok('copy with no clock in it is returned untouched',
     m.leadClock('Bid $32, not the sheet\u2019s $26.', AUG) === 'Bid $32, not the sheet\u2019s $26.');
  ok('a nonsense hour is left alone rather than converted into a lie',
     m.leadClock('99:00 UTC', AUG) === '99:00 UTC');
  ok('the word UTC does not survive a conversion', !/UTC/.test(m.leadClock('11:00 UTC', AUG)));

  // The fallback exists for a runtime with no time-zone data. It has to agree
  // with Intl on every day of the year, or it is a bug waiting for an outage.
  let drift = 0, driftAt = '';
  for (let d = 0; d < 365; d++) {
    const at = Date.UTC(2026, 0, 1, 16, 0) + d * 86400000;
    const intl = new Date(at).toLocaleString('en-US', { timeZone: m.LEAD_TZ, hour12: false, hour: '2-digit' });
    const want = (24 + parseInt(intl, 10) - new Date(at).getUTCHours()) % 24 - 24;
    if (want !== m.etOffsetHours(at)) { drift++; driftAt = new Date(at).toISOString(); }
  }
  ok('the no-Intl fallback agrees with Intl on every day of the year', drift === 0, `${drift} days, first ${driftAt}`);

  // The conversion has to happen in the payload, not in one page, or the front
  // page and /lead start telling a reader different times for one story.
  const row = m.leadRow({ slug: 's', title: 'Written at 11:00 UTC', dek: 'Refreshed 11:00 UTC',
                          category: 'player', players: '["Zay Flowers","Derrick Henry"]', created_at: AUG });
  ok('the headline is converted in the payload', row.title === 'Written at 7:00 AM ET', row.title);
  ok('so is the dek', row.dek === 'Refreshed 7:00 AM ET', row.dek);
  ok('the article body and its method line are converted too',
     src.includes('body: leadClock(row.body_html') && src.includes('method: leadClock(row.method'));

  // The names ride along unslugged so the pages can price the story in the
  // reader's league: the slug finds a photograph, the name finds a board row.
  ok('the players travel as names as well as slugs',
     JSON.stringify(row.names) === JSON.stringify(['Zay Flowers', 'Derrick Henry']), JSON.stringify(row.names));
  ok('and the slugs are still what the photo cast is keyed by',
     JSON.stringify(row.ppl) === JSON.stringify(['zay-flowers', 'derrick-henry']));
  const junk = m.leadRow({ slug: 's', title: 't', category: 'player', players: '{"not":"an array"}', created_at: AUG });
  ok('malformed players still yields no names rather than an exception',
     Array.isArray(junk.names) && junk.names.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
