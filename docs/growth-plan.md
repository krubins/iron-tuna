# Iron Tuna growth plan

This file is the working record for the growth initiative. A new session that is
told "Start next phase" reads this file, finds the first phase below whose
status is not **Done**, implements only that phase, verifies it, updates this
file, and stops.

`docs/` is listed in `.assetsignore` (since 2026-10-17), so nothing here is
published at irontuna.com.

## Objective

Increase two things, in this order of evidence:

1. **Qualified traffic:** visitors who use a tool or read useful analysis, not
   just visitors who load a page.
2. **Repeat usage:** visitors who come back to make weekly fantasy decisions.

Improve the existing product and distribute its strongest findings before adding
tools or articles. The acquisition hook is the gap between betting-market
expectations and fantasy consensus. The retention feature is My Week.

## Standing rules for every phase

- Build on existing functionality. No duplicate systems, no new framework, no
  package manager (see `.claude/skills/steward/SKILL.md`).
- Never invent figures, historical predictions, explanations, testimonials or
  performance claims. A disagreement with consensus is a finding, not proof of a
  profitable edge.
- Label quoted sportsbook props apart from derived estimates, everywhere.
- Public copy: plain, professional, no generic AI styling, no em dashes, no
  gratuitous gradients or badges. Mobile first.
- Do not deploy, purchase services, send email, contact people or post
  externally. `main` deploys on merge, so a phase ends as a pushed branch, not a
  merge.
- When something needs credentials or account access, finish the independent
  work, keep the affected function disabled, and record the blocker below.
- Generated files are rebuilt with their generator, never hand-edited (table in
  the steward skill). Run the suite the steward skill describes before pushing.

## Phase checklist

| # | Phase | Status | Branch |
|---|---|---|---|
| 1 | Analytics and admin dashboard | **Done** (2026-10-17, awaiting review and merge) | `claude/growth-phase-1` |
| 2 | Reliability and search visibility | Not started | |
| 3 | First-visit experience | Not started | |
| 4 | Repeat usage (My Week) | Not started | |
| 5 | Email and sharing | Not started | |
| 6 | Distribution and evaluation | Not started | |

---

## Baseline (read 2026-10-17 from production D1, read-only)

Window: 2026-10-03 to 2026-10-17 (14 days, the last day partial), operator
browsing excluded (`internal = 0`). Source: the Worker's page counter
(`page_views`) and the click-event table (`site_events`).

| Measure | Value | Note |
|---|---|---|
| Page views | about 3,128 | |
| Visitor-days (daily uniques summed) | about 1,896 | Not people: the visitor hash rotates daily |
| Single-page visitor-days | 1,696 of 1,896 (89%) | 568 of the 1,696 were US |
| Visitor-days with 51+ views | 7 (448 views) | All averaged under 15 s per view: almost certainly automated |
| Source "direct" | 3,075 of 3,128 views | Inflated: internal clicks were stored as direct (fixed in Phase 1) |
| google.com / chatgpt.com / bing.com | 38 / 9 / 2 views | |
| Top pages | `/` 961, `/rankings` 205, `/dfs` 131, `/fantasy` 104, `/depth-charts` 81 | views |
| Outcome events of any kind | about 20 in 14 days (109 in 30 days) | Only a handful of pages sent events |

Earlier figures quoted in the brief (about 179 daily users; 320 of 5,673 visits
with a second page) are historical and are not this baseline.

What the baseline cannot say, and Phase 1 fixes from deploy onward: whether a
visit produced a result, whether any browser returned, which source produced
useful visits, and how many league setups or failures happened.

## Measurement design (Phase 1)

### Two layers, each honest about its limits

| Layer | What it counts | Strength | Limit |
|---|---|---|---|
| Worker page counter (`page_views`, unchanged) | Every 200 HTML GET from a non-bot user-agent | Works with scripts blocked; no cookie | Visitor hash rotates daily: no returns, no outcomes |
| Outcome events (`it-metrics.js` to `/api/track` to `site_events`) | Visits, results, failures, setup, sign-ups, shares, per browser | Returns and outcomes become measurable | Needs script and storage; a cleared, private or second browser reads as new |

### Identity and privacy

- `it.uid` in localStorage: a random 12-character id minted in the browser.
  Already used by `/rankings` and `/desk` before this work, now the one id.
- `it.first`: the day the id was minted. A browser whose id predates
  `it-metrics.js` reports `0000-00-00` (seen before measurement began).
- No cookie is added. The existing `it_owner` cookie is unchanged.
- Outcome events carry only a fixed list of short fields (`OUTCOME_PROPS` in
  `_worker.js`, `ALLOWED` in `it-metrics.js`). Any value that looks like an
  email address is dropped on both sides. Rosters, league names, player lists
  and typed text never leave the page; Trade Tools send a short hash of the
  input, not the input.
- `privacy.html` discloses the identifier (updated 2026-10-17).

### Event taxonomy

| Event | When | Key props |
|---|---|---|
| `visit_start` | First page of a visit (30 idle minutes end a visit) | `src`, `med`, `cmp`, `land`, `new`, `n` |
| `tool_success` | A tool produced a populated result | `tool`, `key`, `rows` |
| `tool_empty` | It answered with nothing to show | `tool`, `key`, `kind` |
| `tool_error` | It failed to load or was refused | `tool`, `key`, `kind` |
| `league_setup_start` / `league_setup_complete` | First touch of a setup form / a successful save | `tool` (`league_scoring` or `league_rosters`), `mode`, `teams` |
| `subscribe_request` | An email form returned ok (no address sent) | `tool` |
| `share_click` | A share or copy-link control was used | `tool`, `method` |

Every event also carries `vid` (visit id), `fs` (first-seen day) and `path`.
Each (event, tool, key) is sent at most once per visit, so a rerender, a retry
or a reload of the same result is one output. Successes are never inferred from
clicks; older click events (`nav_click`, `story_open`, ...) are untouched and
stay in "Clicks & actions" on /admin.

Instrumented (tool name in parentheses): `/rankings` (rankings), `/position`
(position), `/vegas-edge` (vegas_edge), `/fantasy` week board (fantasy_board),
`/my-week` modules (lineup, waiver, trade, matchup, my_week_alerts, playoffs),
`/faab` (waiver for a saved league, faab for the bid advisor), `/trade-finder`
(trade_finder, trade_evaluator), `/my-league` (league_scoring), `/my-leagues`
manual form and roster screenshot (league_rosters), share links on `/fantasy`,
`/previews`, `/weekly-wrap`, and the insights email form on 44 pages plus its
template.

Not instrumented, deliberately:
- **Player comparison.** No user-driven comparison tool exists. The `/fantasy`
  flex call compares two players automatically on load, so counting it as a
  "completed comparison" would overstate. The tool name `compare` is reserved
  for Phase 5's shareable comparisons.
- **`index.html` (the draft app at `/hub`).** Off-season, and its lead form does
  not check the response. Its own `ITAnalytics` events still flow to
  `site_events` under a separate id (`it_anon`).
- **Confirmed subscriptions.** No confirmation step exists. The dashboard shows
  confirmed subscriptions as unavailable (null), not zero, until Phase 5.

### Attribution convention

A visit's source is fixed when it starts:

1. `utm_source` / `utm_medium` / `utm_campaign` when present (lowercased,
   punctuation to hyphens). The tags are then removed from the address bar so
   a copied link does not repeat the campaign.
2. Otherwise the outside referrer's host, with medium `organic` (search
   engines), `ai` (ChatGPT, Perplexity, Claude, Gemini, Copilot), `social`
   (X, Threads, Reddit, Facebook, ...), else `referral`.
3. Otherwise `direct` / `none`.

A click between our own pages never starts a visit or changes its source. A
page opened from one of ours after the visit lapsed is `(continued)`. A new
outside arrival mid-visit (a tagged link, another site) starts a new visit.

**Tag the owner's own links this way** (Phase 6 builds this into the workflow):

| Field | Values |
|---|---|
| `utm_source` | `x`, `threads`, `reddit`, `discord`, `bluesky`, `newsletter`, `creator-<slug>` |
| `utm_medium` | `social`, `email`, `partner`, `referral` |
| `utm_campaign` | `<season>-w<NN>-<piece>`, e.g. `2026-w07-vegas-gaps` |

### Owner exclusion and automated traffic

- Unchanged: the `it_owner` cookie marks rows `internal = 1` as they are
  written, and every read filters them; "Count my visits" still flips it.
- New: opening /admin also registers this browser's `it.uid` in
  `analytics_owner`, so outcome events it sent before the cookie existed are
  excluded too. "Count my visits" removes it again.
- `BOT_RE` gained conservative tokens (Meta and OpenAI fetchers, HTTP client
  libraries, automation drivers, scanners). `it-metrics.js` sends nothing when
  `navigator.webdriver` is set or the user-agent names a headless browser.
- Behavioral flag, reported not subtracted: a visitor-day with 20+ views
  averaging under 15 s apart is shown as "likely automated" under the traffic
  tiles. Bot detection is not perfect and the page says so.
- Internal hops in `page_views` are stored as `(internal)` from 2026-10-17 and
  left out of "Where users came from". Older rows cannot be separated and still
  read as direct.

### The dashboard (/admin, "Meaningful use")

Served by `GET /api/admin/usage?key=…&days=7|30|90` (same key gate, separate
from `/api/admin/traffic` so either can fail alone). It shows, with counts
beside every percentage and `n/a` where there is no denominator:

- Visitors (browsers), new against returning.
- Sources and media: visitors, visits, useful visits (share), saved leagues.
  Rows under 20 visitors are marked small samples.
- Funnel: visited, useful result, started setup, saved setup, email sign-up.
- Tools: results, browsers, empty, failed, share empty-or-failed.
- Seven-day return by first-seen day; only cohorts with seven full days behind
  them enter the rate, younger ones show as "maturing".
- Returning browsers with a useful result, per NFL week (Tuesday to Monday,
  UTC).
- Share clicks (clicks, not completed posts) and email sign-ups (unconfirmed),
  with stored contact counts as a cross-check (counts only, never addresses).
- "Nothing collected yet" before the first event, rather than zeros.

## Phase 1 verification (2026-10-17)

- `node tools/test-usage.mjs`: 40 checks, new (unavailable vs zero, dedup,
  owner exclusion by cookie and id, props allow-list, email scrubbing, mature
  vs maturing cohorts, Tuesday weeks, likely-automated and internal-hop
  reporting, malformed legacy JSON).
- `node tools/test-metrics.mjs` (Chromium): 49 checks, new (UTM attribution and
  stripping, one visit across internal clicks and reloads, one success per
  result per visit, failure events, idle-visit expiry and search referrer,
  automation silence, league setup start/complete on `/my-league` at 390px,
  ten instrumented pages loading cleanly with feeds refusing, no email in any
  payload, /admin at 390 and 1280 off the real worker payload with no
  sideways scroll, and the empty state).
- `node tools/test-analytics.mjs`: 100 checks (one assertion updated for the
  internal-hop change, one added).
- Full CI node suite less `test-dry-run`: 73 of 73 pass. `build-chrome`,
  `build-ranks`, `build-seo`, `build-bylines --check` clean; `build-front` and
  `build-worker-faces` produce no diff; every `node --check` target parses.
- The new SQL (JSON functions, Tuesday week expression, `julianday`) was run
  read-only against production D1 and returned correctly.
- Not run: `test-dry-run.mjs` (newsroom simulation; nothing in this phase
  touches the newsroom or job schedule).

## Outstanding configuration and access

- **Merge and deploy** `claude/growth-phase-1` (owner). The dashboard reads
  "Nothing collected yet" until the first visit after deploy; retention needs
  8 days of collection before the first mature cohort.
- **Open /admin once from each browser you browse the site with** after deploy,
  so each is excluded by cookie and by id.
- **D1 read allowance.** The new route reads `site_events` only (indexed on
  `event, ts`), a few thousand rows a day at current volume. If the account is
  ever back on the D1 free tier, the 90-day view is the expensive one.
- **Search Console** (Phase 2) needs owner access to the property.

## Next steps: Phase 2 (reliability and search visibility)

Start here when told "Start next phase". Requirements, from the brief:

1. Investigate consistency of season, current NFL week, schedule status,
   projections and cache invalidation across `/`, `/rankings`, `/position`,
   `/vegas-edge`, `/player/*` and published articles. A prior public review saw
   a rankings page labeled Week 3 while others said Week 6, and some loading
   placeholders: treat these as leads, not established bugs. Start with
   `it-season.js`, `/api/season`, the worker's week resolution, and any
   pre-render cache keys.
2. Make principal public answers available in initial HTML with the existing
   worker pre-render approach (no framework migration). Keep private league data
   out of public HTML and shared caches.
3. Show accurate timestamps and distinguish current data, last available data,
   no data and failed loading. Never manufacture fallback projections.
4. Verify canonical URLs, www/non-www redirects, titles and descriptions,
   robots directives, sitemap contents, internal links, and the handling of
   private, admin and parameterized pages.
5. Improve existing player and position pages (current answer, scoring
   assumptions, update time, methodology link, next action). No thin pages.
6. Structured data only where visible content supports it.
7. Verify with raw HTTP responses and rendered browser views; list the Search
   Console checks that need the owner.
8. Use the Phase 1 events to confirm fixes: `tool_empty` and `tool_error` rates
   per tool on /admin are the before-and-after measure.

## Later phases (requirements carried from the brief)

**Phase 3, first visit.** Make the homepage promise concrete: players whose
betting-market expectation differs meaningfully from fantasy consensus. One
primary action to the current differences board; other tools in secondary
navigation. Up to three real current examples near the top, each with player
and matchup, market and consensus projection, the difference in points, one
scoring and period, a short data-supported explanation, a timestamp, and a
quoted-prop versus derived-estimate label. Suppress differences caused by
missing data, scoring mismatches, incompatible periods or unsupported
assumptions. A simple scoring selector on existing functionality. Value before
league setup. A clearly labeled populated sample My Week, separate from real
data. Fewer competing promotional sections. Track landing to useful output to
league setup (the Phase 1 funnel already does; add a `surface` prop for the
homepage examples).

**Phase 4, repeat usage.** Improve My Week (not a new dashboard): prominent for
saved leagues, a league switcher, organized around waivers, roster changes and
lineup decisions before kickoff. "What changed since your last visit" from
lightweight stored snapshots, material supported changes only, a baseline on
first visit. Brief factual rationale, scoring and freshness on each
recommendation. Call a pickup available only when the league's free-agent pool
is known; otherwise say to check availability. Preserve saved settings and
explain browser-only persistence. Better recovery from failed imports with a
manual path. Verify multiple leagues, missing rosters, changed scoring, stale
data and returning visits.

**Phase 5, email and sharing.** Offer: "Get the five biggest Vegas-versus-expert
fantasy differences every Sunday morning." Signup after useful actions and in
one permanent place, no blocking popup. Clear consent, validation, duplicate
handling, confirmation (double opt-in; this unlocks the dashboard's confirmed
count), rate limiting, working unsubscribe and suppression (`unsubscribes`
table and `sendCampaignOne` exist), sender and footer configuration
(`RESEND_API_KEY`, `MAIL_ADDRESS`). Subscriber data separate from analytics.
Mobile-friendly weekly edition (season, week, scoring, timestamp, up to five
validated differences, fewer if fewer qualify), Sunday-morning scheduling in
America/New_York through the existing `JOB_SCHEDULE`, admin preview, test mode,
duplicate-send prevention, failure logging; delivery stays disabled without
credentials. Sharing: public links for findings and player comparisons that
keep scoring, week and context without league data; live views apart from
dated findings that never silently change; restrained share images (player or
comparison, numbers, week, scoring, timestamp, Iron Tuna identity); social
metadata; copy-link and native share sending `share_click`. Prospective
collection of immutable pregame snapshots if valid history does not exist; no
reconstructed predictions; no superiority claims without evidence.

**Phase 6, distribution and evaluation.** An admin workflow for three weekly
drafts (Tuesday waiver finding; Thursday or Friday up to three market-versus-
consensus differences; Sunday one close lineup comparison), each with validated
figures, scoring, week, timestamp, a short explanation, a direct link, a share
image where available, a UTM link per the convention above, and an editable
preview. Never auto-publish. A creator-partnership package (sample segment,
customizable outreach draft, simple partner tracking, unique tagged links; no
invented creators, no sending). Compare sources by meaningful use, saved
leagues, confirmed subscriptions and returning users, labeling small samples
and immature cohorts. Deliver a weekly owner checklist and a 30-day evaluation
plan with comparison periods and sample-size limits. No traffic promises.

## How to resume

1. Read this file and `CLAUDE.md`; read the steward skill.
2. `git fetch origin main`; check whether the previous phase's branch merged.
   Branch the next phase from `main` as `claude/growth-phase-<n>`. If the prior
   phase is unmerged, branch from it and say so in the summary.
3. Implement only the next phase. Verify with the suite and the browser.
4. Update the checklist, the phase's verification section and "Next steps"
   here, then commit and push the branch. Do not open a pull request unless
   asked.
