// Which analyst is bylined on each STATIC page.
//
// The in-season newsroom (HANDOFF.md §68) bylines everything it generates: each
// row in `content_pieces` carries an analyst, `_bylineOf` turns it into a name
// and a role, and `/analysts/<id>` is that analyst's page. None of that reaches
// the site's static pages — the 83 dated drop pages, the evergreen guides, the
// coaching column, The Pick. Those were written by the Routines the migration
// retired, they are still served, still linked from the nav and the footer, and
// they are still the site's own record of the season. Until now they carried
// either "Iron Tuna Research" or no byline at all.
//
// THE ROSTER IS NOT DEFINED HERE. `ANALYSTS` in `_worker.js` is the only roster,
// and this file holds nothing but the page-to-analyst assignment; the names come
// out of the worker at build time (see `roster()` below). A second copy of any
// analyst's name in the repo is a second thing to forget to rename, and
// tools/test-bylines.mjs fails if one appears under tools/ — including in a
// comment like this one.
//
// WHERE THE ASSIGNMENTS COME FROM. Three of the five families are not a
// judgement call at all — `ROUTINE_MIGRATION` in `_worker.js` already records
// where each retired Routine's work went, and the destination kind in
// `CONTENT_KINDS` already names its analyst. Those three are that mapping,
// followed rather than invented:
//
//   camp & preseason desk  -> last-minute-intel   -> raines
//   Play-Caller Premium    -> quarterback-monday  -> dalton
//   The Pick               -> underrated          -> vega
//
// The two that had no retired Routine behind them are assigned on beat:
// the priced-call drop pages to the rankings analyst, the strategy guides to the
// roster-strategy analyst, and the stacking guide to the offence analyst because
// correlation is an offence question rather than a roster one.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lifted from the deployed source rather than copied, so a rename in the
// newsroom reaches these pages the next time the stamper runs.
export function roster() {
  const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const at = src.indexOf('const ANALYSTS = {');
  if (at < 0) throw new Error('_worker.js has no ANALYSTS roster');
  const end = src.indexOf('\nconst ANALYST_HOUSE', at);
  const block = src.slice(at, end > 0 ? end : at + 12000);
  const out = {};
  const re = /(\w+): \{ id: '(\w+)', name: '([^']+)', role: '([^']+)'/g;
  let m;
  while ((m = re.exec(block))) out[m[2]] = { id: m[2], name: m[3], role: m[4] };
  if (!Object.keys(out).length) throw new Error('could not read any analyst out of _worker.js');
  return out;
}

export const PAGE_ANALYST_PATTERNS = [
  // Priced player calls, five to a page. Rankings and valuation.
  { re: /^(?:auction|snake|bestball)-insights-\d{4}-\d{2}-\d{2}\.html$/, analyst: 'brooks' },
  // The camp desk's own pages. Its work went to Last-Minute Intel.
  { re: /^auction-watch-\d{4}-\d{2}-\d{2}\.html$/, analyst: 'raines' },
  { re: /^preseason-week-\d+\.html$/, analyst: 'raines' },
];

export const PAGE_ANALYST = {
  'play-caller-premium.html':         'dalton',   // -> quarterback-monday
  'the-pick.html':                    'vega',     // -> underrated
  'auction-draft-strategy.html':      'grant',
  'snake-draft-strategy.html':        'grant',
  'auction-budget-allocation.html':   'grant',
  'auction-nomination-strategy.html': 'grant',
  'dollar-endgame-handcuffs.html':    'grant',
  'best-ball-draft-strategy.html':    'grant',
  'best-ball-stacking-guide.html':    'dalton',
};

// NOT ON THIS LIST, ON PURPOSE: the hubs and archives (guides.html,
// auction-insights.html, auction-watch.html, insights-vault.html), the keyword
// landing pages build-seo.mjs types as SoftwareApplication rather than Article,
// and the in-season dashboards under the `is-eyebrow` template. The first two are
// lists of stories; the third is a table recomputed on every load. A byline on a
// page nobody wrote is the one kind of byline that lies.
export function analystFor(file) {
  if (PAGE_ANALYST[file]) return PAGE_ANALYST[file];
  for (const p of PAGE_ANALYST_PATTERNS) if (p.re.test(file)) return p.analyst;
  return null;
}

// One shape for every visible byline on the site, so a page cannot invent its
// own. `tail` is the page's own trailing detail — the date and the call count on
// a drop page, nothing at all on an evergreen guide.
//
// The name links to the analyst's page, which is where the standing AI
// disclosure lives: these are editorial personas, not people, and the byline has
// to be one click from the page that says so.
export function bylineHtml(a, tail, house) {
  const dot = '<span class="dot">&middot;</span>';
  const who = house
    ? '<b>Iron Tuna Research</b>'
    : `<b><a href="/analysts/${a.id}">${a.name}</a></b>${dot}${a.role}`;
  const parts = [who, 'Iron Tuna'];
  for (const t of (tail || []).filter(Boolean)) parts.push(t);
  return `<div class="byline" data-analyst="${house ? 'house' : a.id}">${parts.join(dot)}</div>`;
}
