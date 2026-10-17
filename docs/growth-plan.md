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
| 1 | Analytics and admin dashboard | **Done** (2026-10-17, merged as #442) | `claude/growth-phase-1` |
| 2 | Reliability and search visibility | **Done** (2026-10-17, merged as #443) | `claude/growth-phase-2` |
| 3 | First-visit experience | **Done** (2026-10-17, merged as #444) | `claude/growth-phase-3` |
| 4 | Repeat usage (My Week) | **Done** (2026-10-17, merged as #445) | `claude/growth-phase-4` |
| 5 | Email and sharing | **Done** (2026-10-17, merged as #446; delivery off until configured) | `claude/growth-phase-5` |
| 6 | Distribution and evaluation | **Done** (2026-10-17, awaiting review and merge) | `claude/growth-phase-6` |

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

- **Merge and deploy** `claude/growth-phase-6` (owner). Phases 1 to 5 merged
  as #442, #443, #444, #445 and #446.
- **Privacy policy, Phase 6 addition** (owner). A Sunday-email sign-up now
  also stores the source labels of the visit it happened in (site name or
  UTM source, medium, campaign; never the browser id). Mention it when the
  policy is updated for the Sunday email.
- **Turn on the Sunday email** (owner, Phase 5). Until all of these are set,
  the sign-up form does not appear anywhere, `/newsletter` says sign-up is not
  open, and the Sunday job logs "disabled": `RESEND_API_KEY` (already used by
  sign-in mail), `MAIL_ADDRESS` (a real postal address; the law requires it in
  every marketing email), `AUTH_SECRET` (already set), and
  `NEWSLETTER_ENABLED=1`. Optional: `EMAIL_FROM_NEWSLETTER` (defaults to
  `EMAIL_FROM_MARKETING`, then `Iron Tuna <hello@irontuna.com>`); the sending
  domain must be verified in Resend. Before switching it on, send yourself a
  test from /admin (Operator tools, Sunday email), which works with the mail
  settings alone, and read the preview at each scoring.
- **Privacy policy** (owner). `/privacy` does not yet describe the Sunday
  email (what is stored: address, scoring, where they signed up, the consent
  wording and times; Resend as processor; how to unsubscribe). The sign-up
  form links to it, so it should say so before the switch is turned on. Not
  edited here: a policy is the owner's statement, not copy to draft unasked.
- **Washington.** Sign-up is not offered to visitors located in Washington,
  matching the market lane's removal there. An email cannot be geofenced: a
  subscriber who signed up elsewhere still receives it in Washington. Owner
  decision whether that is acceptable. On 2026-10-17 production held no outcome events yet;
  check /admin's Tools table shows rows within a day, and if not, check that
  `/api/track` is accepting them. Retention needs 8 days of collection before
  the first mature cohort.
- **Open /admin once from each browser you browse the site with** after deploy,
  so each is excluded by cookie and by id.
- **D1 read allowance.** The new route reads `site_events` only (indexed on
  `event, ts`), a few thousand rows a day at current volume. If the account is
  ever back on the D1 free tier, the 90-day view is the expensive one.
- **Search Console**: the Phase 2 owner checks above need access to the property.

## Phase 2: reliability and search visibility (2026-10-17)

### What the audit found (live site, Saturday of Week 6)

Read with raw HTTP and in Chromium at 390px against production, before any change.

| Lead or check | Finding | Action |
|---|---|---|
| Rankings said Week 3 while others said Week 6 | Not reproduced. `/api/season`, `/api/boards`, `/`, `/rankings`, `/position`, `/vegas-edge`, `/fantasy` and `/previews` all said Week 6. Every page dates itself off the one `/api/season` read (`it-season.js`) or the board's own `currentWeek`. Likely the pre-2026-10-11 rankings pages, since removed. | None needed |
| Player weekly page on a bye | Ja'Marr Chase (CIN bye) read "WR99, 0.0 pts, LOW", "Market Delta: market agrees" and "The market and the consensus agree on him this week." | Fixed: bye and listed-out weeks are stated, not ranked |
| Player "Current props" | Showed his Week 5 lines, last seen six days earlier, as current. `marketHistoryAll` read every week the store holds, so "Open" was also the season's first line, not the week's. | Fixed: this week's rows only |
| Initial HTML | No principal page carried its answer: `/rankings` shipped "Reading the board…", the player page a name only. | Fixed for `/rankings`, player pages, desk pieces |
| Timestamps | The boards payload carried no time at all, so no page could say when its numbers were computed. | Fixed: `updated` on the payload, printed on both pages |
| Desk articles | Every `/in-season/desk/<kind>/<week>` served the desk's own title and a canonical of `/in-season/desk`: to a search engine, one page. None is in the sitemap. | Fixed head, canonical, first screen and Article markup. Sitemap entry still open (below) |
| Unknown `/player/<slug>` | 200 with noindex (a soft 404). | Fixed: 404, same page |
| Sitemap (563 URLs, all fetched) | All 200, self-canonical, titled and described, none noindex, except `/hub`, which canonicalises to `/auctiondraft`. | `/hub` removed |
| `/rankings/`, `/rankings.html` | 307 to `/rankings` (Cloudflare's asset `html_handling`). A permanent 301/308 would consolidate more firmly. | Not changed: config, see below |
| Retired `/weekly-*-rankings` | 301 to `/rankings#…` | None needed |
| robots.txt, `/admin`, `/in-season/*` aliases | Open to all crawlers; `/admin` noindex,nofollow; aliases canonicalise to the bare page. | None needed |
| `www.` and `http://` | Could not be tested from this session (the proxy refuses `www.irontuna.com`; `http://` was answered through the proxy). | Owner check below |

### What changed

- **`/api/boards` payload** gains `updated: { board, odds }` (additive): when the
  answer was computed and when the projection overlay it priced was pulled, null
  when none was. `/rankings` prints it under the scoring note; the player page in
  its freshness line. A payload without it (a synced league's board) prints
  nothing.
- **`/rankings` initial HTML**: the worker pre-renders the opening view (This
  Week, quarterbacks, Iron Tuna board, PPR) into the table, with the scoring
  note and the time line. It scores the stat lines with `scoreStats` exactly as
  the page does, ranks over the rows the week board still carries, and lifts
  the page's Market Delta rule (`_rkClassify`). Against live Week 6 data all 40
  rows were identical before and after hydration at 390px and 1280px. Default
  board only; a saved league is still applied in the browser. Not in
  Washington.
- **Player weekly page** (`player-intel.html`, `playerIntelPayload`,
  `buildTake`): a bye or a listed-out week shows "On bye in Week 6" or "Listed
  Out for Week 6" with no rank and no Market Delta; a kicked-off game says its
  numbers are pregame; props are this week's only (`marketHistoryAll` takes
  season and week), titled "This week's props", stamped "last seen", and absent
  for a bye or an absence with the reason. A freshness line under the name gives
  the week, the scoring, both times, a link to the method (`/rankings#method`)
  and "Score it at my league". The take moved above the detail and is
  pre-rendered with the freshness line. Payload gains `season`, `week`,
  `updated`, and `thisWeek.week`, `bye`, `out`, `gameState` (all additive).
- **Desk pieces**: title, description, canonical and social tags from the piece
  itself (the undated "latest" address canonicalises to its dated one); the
  eyebrow, headline, kicker, publication time and dek pre-rendered; Article
  JSON-LD for published pieces, authored by the organization rather than an AI
  persona. A held or skipped piece is noindex. A piece that does not exist is a
  404.
- **Structured data**: only the Article markup above, which the page visibly
  supports. Rankings got none: an ItemList of a board that reorders by scoring
  would describe one view of many.
- `sitemap.xml` loses `/hub`.

### Phase 2 verification (2026-10-17)

- `node tools/test-prerender.mjs` (new, in CI): 61 checks. The Market Delta rule
  against the page's own on 2,000 cases; the time format against
  `it-season.js`; ranking by scored stat lines (fixture `points` deliberately
  wrong), tie by name, BYE, escaping, and no pre-render for a failed, empty or
  other-horizon board; the take for a bye, an absence and a game; the
  freshness line and the page's own copy of it; this week's props by real SQL
  on SQLite; the desk head, Article markup and held-piece handling; the real
  worker end to end with no data (unknown player 404, known player 200 with no
  invented take, `/rankings` and a desk piece falling back to the plain shell,
  no-store headers, desk front untouched).
- Full CI node suite less `test-dry-run`: 74 of 74 pass. `build-chrome`,
  `build-ranks`, `build-seo`, `build-bylines --check` clean; `build-front` and
  `build-worker-faces` produce no diff; every `node --check` target parses.
- Browser, against live production data through the branch's pre-render and
  pages (a scratch harness, not committed): `/rankings` 40 of 40 rows identical
  with and without script, note and time line identical, no page errors, no
  sideways scroll at 390 or 1280; player pages for a bye (Chase), a listed-out
  quarterback (Lamar Jackson) and a playing one (Josh Allen) with identical
  freshness line and take before and after hydration; a desk piece with
  identical title, headline, kicker and publication line, body filled on
  hydration.
- Not run: `test-dry-run.mjs` (nothing here touches the newsroom schedule).
- **Before-and-after events**: Phase 1 is live (`it-metrics.js` serves on
  `/rankings`), but production `site_events` held no `tool_success`,
  `tool_empty` or `tool_error` rows on 2026-10-17. There is no "before" to
  compare. Read the Tools table on /admin after this deploys; the comparison
  that matters is `rankings` and player-page errors per visit over the first
  full week.

### Owner checks (Search Console and configuration)

1. Search Console, URL Inspection, live test: `/rankings`, one
   `/player/<slug>`, one `/in-season/desk/<kind>/<week>`. Confirm the rendered
   HTML carries the table, the take, and the piece's own canonical.
2. Search Console, Pages report: watch "Duplicate, Google chose different
   canonical" for desk pieces fall, and "Soft 404" for `/player/*` clear.
3. Resubmit `sitemap.xml` (it lost `/hub`).
4. Confirm `www.irontuna.com` and `http://irontuna.com` redirect permanently to
   `https://irontuna.com` (Cloudflare: a redirect rule, and Always Use HTTPS).
   Not testable from this session.
5. Optional: set the asset `html_handling` so `/page/` and `/page.html` answer
   308 rather than 307, or add a redirect rule. Low value; the canonical tags
   already name the clean address.

### Still open from Phase 2

- **Desk pieces in the sitemap.** They are database rows, not files, so
  `build-seo` cannot list them. A worker-served `/sitemap-desk.xml`, listed in
  `robots.txt`, would; it was left out to keep this phase to fixing what exists.
- **`/position`, `/vegas-edge`, `/fantasy` are still client-rendered.**
  `/position` reads its position from the hash, which the worker never sees, so
  a pre-render would have to guess. `/vegas-edge` is the next candidate (Phase 3
  leans on it).
- The rest of the desk body stays client-rendered: its sections are typed data
  that only `desk.html` knows how to lay out.

## Phase 3: first-visit experience (2026-10-17)

### What changed

- **The promise and one action.** The homepage's h1 is now "Where the betting
  market and fantasy consensus disagree.", with one sentence under it and one
  primary action, "See this week's differences", to `/vegas-edge#board`. The
  search field and the other tools (Rankings, Start / Sit, Waivers, Trade
  tools, DFS lineups, Articles) sit under the examples as plain secondary
  links. Title, description and social tags restate the promise
  (`build-seo` regenerated the JSON-LD and Twitter tags).
- **Up to three current examples, in the first HTML.** The worker writes them
  into `/` (`homeExamples`, `homePrerender`, `homeShellFill` in `_worker.js`)
  off the same week board `/rankings` pre-renders from, plus the week's quoted
  lines from the market digest (`marketHistoryWeek`, one small read). Each
  card: player, position, club, fixture and kickoff; the gap in points; market
  and consensus projections; "Week N, <scoring>"; a **Derived estimate** label
  on the market points ("converted from N books' props"); a **Quoted prop**
  label on the sentence that explains the gap ("Books quote 31.5 rushing
  yards; the consensus projects 63.8. Line last seen ..."). Under the cards:
  the week, when the board was computed, and when the odds behind the market
  points were read.
- **Suppression.** A player is an example only when: skill position; one game
  this week, still to be played; no bye, no listed absence, no injury
  designation but Active or Probable, not left off a priced game; market side
  priced entirely off quoted props (`basis` `props`, full projection, no
  missing market, two or more books); consensus at least 3 points (a stale
  backup line otherwise); both sides scored from their stat lines at the
  card's own preset; gap at least `delta.minPointsStrong` (2) points and
  `delta.strongPct` (15%); within twice `prominentBand` on either side's rank;
  and the stat that moves the gap most has a line a book quoted this week.
  Widest gap first, at most three; fewer is shown as fewer, none as one line
  linking to the board, and no board or no lines at all leaves the block
  hidden. Not in Washington.
- **Scoring selector.** PPR, Half PPR and Standard buttons switch between
  three lists the worker already computed (nothing is re-scored in the
  browser). The choice is remembered in this browser (`it.hmScoring`) and the
  page works without storage.
- **Sample My Week**, a new section after the hero, labelled "Sample" in its
  heading and "A made-up roster of real players ... not your league, and
  nothing here is saved" under it. Three cards at the chosen scoring: a flex
  call between the players ranked FLEX 30 and FLEX 34 (chosen once, so the
  roster does not change with the scoring), a market alert (the widest
  example), and pickups explicitly deferred until a league's rosters are
  saved. Its action goes to `/my-leagues#connect`.
- **Fewer competing sections.** The rotating five-tab market band, the "Play
  Your Way" lane tiles (two lanes, eight tool tiles) and the KPI band are
  gone. The page is now hero, sample My Week, position tiles, desk, How it
  works. The homepage no longer fetches `/api/vegas-edge` (334 KB) at all.
- **Measurement.** A link marked `data-it-surface` (`home_primary`,
  `home_examples`, `home_sample`) sends a new outcome event, `surface_click`,
  and `it-metrics.js` tags the rest of that visit's `tool_success` and league
  setup events with `surface`. Picking a scoring is itself a `tool_success`
  for tool `home_examples`. `/api/admin/usage` gains `surfaces` (visits that
  clicked, then a result, then a saved league, plus visits with a tagged
  result), shown on /admin as "Homepage surfaces: clicked, then used".

### What the live data produced

Run against production's Week 6 board and prop lines on 2026-10-17 (a scratch
harness, not committed). At PPR: Omarion Hampton −9.5 (books quote 31.5
rushing yards against a consensus 63.8), Braelon Allen +8.9 (65.5 against
20.5), Marvin Harrison Jr. −6.6 (21.5 receiving yards against 56.1). These are
disagreements between two projections, not claims about outcomes. Kendre
Miller (consensus 0.9) and every no-line fade were suppressed.

### Phase 3 verification (2026-10-17)

- `node tools/test-home-examples.mjs` (new, in CI): 74 checks. One fixture
  player per suppression rule, each proven to lead once its rule is lifted;
  the cap at three; Half PPR and Standard re-ordering, and a Standard-only
  disagreement; every figure equal to `it-league.js` at the card's preset;
  the explanation's quoted line and touchdown sentence; card markup, labels,
  escaping, no em dash; the sample pair fixed across presets, the tie skip and
  the level case; the shell fill (literal `$`, untouched without data); the
  route; the real worker with no data serving the shell with both blocks
  hidden and no-store.
- `tools/test-homepage.mjs` (Chromium, in CI) rewritten for the new page: 139
  checks, including the scoring switch, persistence, blocked storage, phone
  stacking, focus rings, no `/api/vegas-edge` read, and the refusing pass.
- `tools/test-metrics.mjs`: 62 checks (13 new: surface counts off the real
  worker SQL on SQLite, the scoring pick as one result, `surface_click` on the
  primary action, the next rankings result and a league save tagged with the
  surface, a later visit untagged, the /admin table).
- `test-ranks`, `test-player-links`, `test-player-card` updated for the
  deliberate changes (sample section before the tiles; homepage names are
  linked by the worker, not repainted).
- Full CI node suite less `test-dry-run`: 75 of 75 pass. `build-chrome`,
  `build-ranks`, `build-seo`, `build-bylines --check` clean; `build-front`
  and `build-worker-faces` produce no diff.
- Browser against live production data through the branch's pre-render: no
  page errors, no sideways scroll at 390 or 1280.
- Not run: `test-dry-run.mjs` (nothing here touches the newsroom schedule).

### Still open from Phase 3

- **Baseline for the funnel.** No `surface_click` exists before this deploys.
  After a full week, read /admin: homepage visits that clicked an example or
  the primary action, and the share that went on to a result and to a saved
  league. Small samples are flagged.
- `/vegas-edge` itself is still client-rendered; its first screen is still
  "the board did not answer" until its script runs.
- The examples use the default board. A reader with a saved league sees the
  presets, not their own scoring, on the homepage (every other board restates
  in their points).

## Phase 4: repeat usage, My Week (2026-10-17)

### What the audit found

- **"Available" was a guess.** A player on no saved roster was called
  available everywhere (My Week's pickups and matchup, the rankings tag, the
  player page, story callouts). A manual league is usually the reader's own
  roster in a twelve-team room, so every player on eleven other teams was
  called a free agent and priced for FAAB. My Leagues' own copy said so
  ("without them the free-agent pool is everyone not on your team").
- No module said at what scoring or from how fresh a board its advice was, and
  nothing flagged a league the reader had not re-saved in weeks.
- My Week had no memory: a returning reader saw the same page with no hint of
  what had moved.
- A failed roster read or save left only a red message and the same button.

### What changed

- **The free-agent pool (`leaguePool`, `_worker.js`).** Known only when every
  team in the league has a saved roster at least as long as its starting
  lineup. Otherwise a player on no saved roster is `unverified`, not
  `available`: in the league board, the pickup advisor (each pickup carries
  `verified`), matchup upgrades, playoff bench moves and the availability
  lookup ("Not on a saved roster: check availability in your league"). The
  advice still says what he would add. Rankings, the player page and story
  callouts no longer tag such a player "Available"; the player page links to
  saving every roster instead.
- **My Week's pickups card** reads "Worth checking on your wire" when the pool
  is unknown, says how many of the league's rosters are saved and that Iron
  Tuna cannot tell who is a free agent, writes "If available:" with a "check
  availability" tag instead of ADD, and links to saving every roster.
- **Rationale, scoring and freshness on each recommendation.** Lineup,
  pickups and matchup answers gain `scoring` and `asOf` (week, board computed,
  odds read, league saved, `leagueStale`); lineup rows gain `key` and `injury`
  (all additive). Each card on My Week ends with "At <scoring> · Week N ·
  board computed ... · odds read ... · league saved ...", in red with an
  "update them" link when the league was last saved over a week ago
  (`LEAGUE_ROSTER_STALE_MS`).
- **Since your last visit (`it-myweek.js`, new).** One small snapshot per
  league in this browser (`it.mw.snap.<id>`), never on the server. Reports
  only material, supported changes: an injury designation appeared, changed
  or cleared; a player moved into or out of the best lineup; a player was
  added to or dropped from the saved roster; a starter's projection moved 2
  points and 20%. A first visit says it set the baseline; a new NFL week sets
  a new one; a changed scoring is said and its restated points are not called
  moves. Capped at eight lines.
- **Persistence explained.** The section says the baseline is kept in this
  browser only and that the league itself is saved to the reader's account
  and follows them to any signed-in device.
- **League switcher and prominence.** The existing switcher (it-sync strip)
  keeps a separate baseline per league. My Week remembers the active league's
  name in this browser (`it.myweek`), and the homepage then shows "Your week
  in <league>" under the primary action (surface `home_myweek`); it clears
  when the account has no league or the reader is signed out.
- **Recovery from failed imports.** `it-roster-grid.js` reports a failed read
  (`onFail`); My Leagues then offers "Type your roster instead", which opens
  the by-hand form with the reader's team as read already in it, and the same
  on a failed save. The form's copy now says what missing rosters cost.

### Phase 4 verification (2026-10-17)

- `REQUIRE_BROWSER=1 node tools/test-myweek.mjs` (new, in CI): 41 checks.
  Node: what the diff reports and what it does not (Probable, sub-threshold
  moves, the swap as projection moves), cleared designations, new week,
  changed scoring, bad input, no em dash. Browser at 390px against stubbed
  league APIs: two leagues in the switcher; first visit; no change; injury
  and projection lines; changed scoring; new week; switching league keeps a
  separate baseline; one roster of ten (card copy, "If available", playoff
  note); a league saved nine days ago flagged stale; the homepage link
  appears and clears; the rosters box's typed path on a failed read; no
  sideways scroll; no page errors.
- `tools/test-league-sync.mjs`: 118 checks (the manual-league pickup check
  rewritten for the unknown pool, plus pool known for a full room, a short
  roster leaving it unknown, the board and lookup saying "check", scoring and
  freshness on the answers, the stale flag, and the lineup's `key` and
  `injury`).
- Full CI node suite less `test-dry-run`: 76 of 76 pass. Generators clean.
- Not run: `test-dry-run.mjs` (newsroom untouched); `test-faab` (FAAB maths
  untouched).

### Still open from Phase 4

- `/faab`'s league line now says how many rosters it has and to check before
  bidding when the pool is unknown. The Trade Finder reads rostered players
  only, so it is unaffected; its page was not reviewed further.
- "Since your last visit" covers the lineup answer only (roster, lineup,
  injuries, projections). Waiver-wire changes are not compared, because the
  wire is only known for a full room.
- Read /admin after a week: `home_myweek` clicks, and `lineup` / `waiver`
  results from returning browsers by NFL week.

## Phase 5: email and sharing (2026-10-17)

### What existed

`sendCampaignOne`, the `unsubscribes` table and a signed `/api/unsubscribe`
(GET and POST, so one-click works), a `contacts` table every older form writes
to without newsletter consent, `share_click` on three pages, and the hourly
`JOB_SCHEDULE`. There was no confirmation step, no subscriber status, no
edition and no share page: a shared homepage example pointed at the live
player page, whose numbers move.

### What changed

- **The offer, in one permanent place and after useful results.** "Get the
  five biggest Vegas-versus-expert fantasy differences every Sunday morning."
  `/newsletter` (new page, footer link "Sunday Email" on every page via
  `build-chrome`, in the sitemap) says what is in it, how the bar works, that
  fewer than five is possible and that none means no email. `it-newsletter.js`
  (new) puts one inline form under the homepage examples, under the
  `/vegas-edge` board once it has answered, and under My Week once the lineup
  has answered (`data-after`, driven by a new `it:result` page event that
  `it-metrics.js` emits on every success, including for automation, which
  still sends nothing). No popup. "No thanks" or a sign-up keeps the prompts
  away in that browser (`it.nl`); the permanent page always has the form. The
  form appears only when `/api/newsletter/status` says sign-up is open.
- **Consent and validation.** Email, scoring (PPR, Half PPR, Standard;
  defaults to the homepage choice) and an unticked consent box that must be
  ticked ("Send me the Iron Tuna Sunday email. I can unsubscribe from any
  email.", linked to /privacy). The worker requires `consent: true`, stores the
  consent wording with a version, validates the address, and has a honeypot.
- **Double opt-in (`newsletter_subscribers`, its own table).** A sign-up is
  `pending` until the owner of the address presses "Confirm my subscription".
  Opening the emailed link only shows that button; the POST confirms, so a
  mail scanner that opens every link cannot subscribe anyone. Only the newest
  link works, for seven days. The answer is always "check your inbox" (new,
  pending or already confirmed), so the form cannot be used to learn who is
  subscribed; a confirmed address is not mailed again and its scoring cannot
  be changed by someone typing it in.
- **Rate limits that hold without KV.** The route's KV limiter (10 per 10
  minutes per IP), plus, in the database: one confirmation email per address
  per 15 minutes and at most 200 confirmation emails an hour in total. A
  confirmation that fails to send says so and can be retried at once.
- **Unsubscribe and suppression.** Every edition carries the existing signed
  unsubscribe link and `List-Unsubscribe` / `List-Unsubscribe-Post` headers.
  `/api/unsubscribe` now also marks the newsletter row. The send query skips
  anyone with a suppression row newer than their confirmation, so a fresh,
  confirmed sign-up after an unsubscribe is honoured and nothing older is.
- **Subscriber data apart from analytics.** Addresses live only in
  `newsletter_subscribers` and `newsletter_deliveries`. `site_events` gets
  `subscribe_request` with the placement and scoring, never the address (the
  browser test checks every tracked payload).
- **The edition (`newsletterEdition`).** Cut from `homeExamples`, the rules
  that already decide what the homepage may print, at each preset: up to five,
  widest first, fewer when fewer qualify. A player kicking off within four
  hours of the build is left out (a 9:30 London game is under way before the
  reader opens it). It is built and frozen once per NFL week
  (`newsletter_editions`); every subscriber that week gets the same figures.
  No qualifying player at any scoring: no email, and the job says so. A
  scoring with none while others have some: that subscriber is skipped and the
  delivery row says why.
- **The email (`newsletterEmail`).** One column, 560 px, inline styles, a
  plain-text part. Week, scoring, when built, when the odds were read; per
  player the fixture and kickoff, the gap, market and consensus, the
  **Derived estimate** and **Quoted prop** labels with when the line was last
  seen; the bar it had to clear; "not a prediction of the result and not
  betting advice"; why they received it, unsubscribe, the site's 21+ and
  gambling-help notice, `MAIL_ADDRESS`. Each
  name links to its dated finding with `utm_source=newsletter`,
  `utm_medium=email`, `utm_campaign=<season>-w<NN>-sunday`.
- **Sunday-morning scheduling.** `newsletter-send` in `JOB_SCHEDULE`: Sunday
  7:00 to 11:45 AM ET, quarter-hourly, phase 3, through the job log. It sends
  nothing outside Sunday 7 AM to noon ET, 40 per run (the subrequest cap; the
  next quarter-hour carries on), and logs `disabled` with what is missing when
  off.
- **Duplicate-send prevention.** One `newsletter_deliveries` row per address
  per week, claimed on its primary key before the send, so overlapping or
  repeated runs cannot mail anyone twice. A failed send is logged with the
  provider's answer and not retried (a provider that timed out may still have
  delivered it). Every send in a run failing makes the run a logged failure.
- **Admin.** /admin, Operator tools, "Sunday email": on or off and exactly
  what is missing, confirmed, pending and unsubscribed counts, each edition's
  counts per scoring and its sent, failed and skipped, recent failures with
  masked addresses, a preview of this week's edition at any scoring (the
  frozen one once it exists, otherwise built for the preview and not stored),
  and a test send to one address, marked as a test and not recorded as a
  delivery. The Meaningful use tile and `/api/admin/usage` now report
  confirmed subscribers (`subscriptions.confirmed`, `confirmedInWindow`,
  `pending`).
- **Dated findings (`findings`, `/finding/<id>`).** A finding is one player's
  market-versus-consensus gap, or two players' projections, at one scoring,
  frozen when it is shared or mailed. The worker cuts it from its own current
  board; the browser sends a name and a scoring only, so nothing from a league
  can reach one. Its id carries a hash of its figures: the same numbers shared
  twice are one page, different numbers a different page, and a row is never
  updated. The page (`finding.html` shell, filled by the worker, `noindex`
  because one page per shared link is thin by design) says "Dated finding.
  Frozen ... These numbers do not update." and links to the live player page
  and board. Social title, description, canonical and URL name the finding.
- **Share images.** `/finding/<id>/card.svg`: the player or pair, the
  numbers, the week, the scoring, when frozen, the market label and the site
  name, on the site's dark ground. The finding page's "Save image" turns it
  into a PNG in the browser and shares it through the phone's share sheet or
  downloads it. **Limit:** link previews (`og:image`) still use `og.png`,
  because X and Facebook do not accept SVG and the worker has no rasterizer.
  A per-finding preview image needs Cloudflare Browser Rendering or an image
  service; an owner decision, not built.
- **Share controls.** "Share this difference" on each homepage example and
  "Share this comparison" on the sample flex call (`it-share.js`, new): freeze,
  then the native share sheet or copy link, with the link printed if both are
  refused. The finding page has Copy link, Share (where the browser has a
  share sheet) and Save image. All send `share_click` with the method.
- **Washington.** No sign-up and no findings there, matching the market lane.
- **Pregame history.** `board-freeze` already stores an immutable pre-kickoff
  board per game (`week_board_snapshots`), and every finding and edition is
  itself a frozen pregame record. No reconstructed predictions were added; no
  copy claims the market is right more often.

### Phase 5 verification (2026-10-17)

- `node tools/test-newsletter.mjs` (new, in CI): 111 checks, against SQLite
  and a recorded Resend. Edition (homepage prefix, four at PPR, five of eight,
  suppression carried over, kickoff margin at 3h59 and 4h01, no board, no
  lines); email (subject, labels, UTM, finding links, footer, text part,
  escaping, test banner, the 21+ notice, no em dash); the switch; sign-up (closed, invalid,
  consent, honeypot, normalisation, generic answers, both throttles, a GET
  that changes nothing, stale and expired links, a failed send retried); the
  job (disabled, outside the window, one per confirmed unsuppressed address at
  its scoring, signed one-click headers, frozen findings, no second send, the
  frozen edition after the board moves, a claimed row, batches of 40, logged
  failures, all-failed as a failed run, nothing qualifying); findings
  (deterministic ids, immutability, shell fill, image, comparison rules,
  nothing from a league, escaping); the real worker's routes (status,
  subscribe, GET then POST confirm, one-click unsubscribe, `/finding/<id>`
  200 and 404, its image, sharing with no board, the admin gate and payloads,
  Washington). Three deliberate mutations (suppression clause, GET-confirm,
  re-mailing confirmed addresses) each fail it.
- `REQUIRE_BROWSER=1 node tools/test-share-signup.mjs` (new, in CI): 41
  checks at 390 px. No form while closed; inline under the examples when
  open; bad address and missing consent refused in the page; payload has
  consent, scoring and placement; no tracked payload carries the address;
  "No thanks" and a sign-up persist; the permanent page keeps the form;
  `/vegas-edge`'s offer only after its own result; share buttons post only a
  name and scoring and copy the dated link; the comparison; the finding page's
  image, Copy link and a real PNG download; `share_click` per method; no
  sideways scroll; no page errors.
- Updated for deliberate changes: `test-chrome` (eleven footer links),
  `test-seo` (finding shell not listed), `test-jobs` (the new job),
  `test-usage` (confirmed is counted when the table exists),
  `test-data-sources` and `docs/data-sources.md` (`www.w3.org`, the SVG
  namespace, never fetched).
- Full CI node suite less `test-dry-run`: 78 of 78 pass (with
  `REQUIRE_BROWSER=1`). `test-dry-run.mjs` run as well, because the job
  schedule changed: 115 of 115. `build-chrome`, `build-ranks`, `build-seo`,
  `build-bylines --check` clean; `build-front` and `build-worker-faces`
  produce no diff.

### Still open from Phase 5

- The owner items under "Outstanding configuration and access": the four
  settings, the privacy policy, Washington.
- Per-finding link-preview images (above).
- My Week's own lineup calls are not shareable: a league's scoring may not be
  a preset, and a share must not carry league data. The homepage sample's
  comparison is.
- After the first Sunday: read /admin for confirmed subscribers, sent and
  failed, and `share_click` by method; Phase 6 compares sources by confirmed
  subscriptions.

## Phase 6: distribution and evaluation (2026-10-17)

### What changed

- **Weekly drafts on /admin** (Operator tools, "Weekly drafts"; worker
  section "THE WEEKLY DRAFTS AND PARTNERS"). `POST /api/admin/drafts` with a
  kind, a scoring and a channel. Built only on the owner's press (POST, so a
  prefetch freezes nothing); never posted, scheduled or sent.
  - Tuesday waiver finding (`waiverFindingPick`): from the three-week board,
    Iron Tuna ranks him inside the depth a 12-team league rosters
    (`PICKUP_ROSTERED`: QB 17, RB 60, WR 72, TE 18) and the consensus ranks
    him outside it; a game every week of the span; Active, Probable or no tag;
    role not trending down; best Iron Tuna rank wins. Never says "available":
    no league is read, so the post and page say to check.
  - Thursday or Friday: the homepage's own examples (`homeExamples`) at the
    chosen scoring, up to three, as one dated page.
  - Sunday: the homepage sample's flex pair (`homeSamplePair`, then
    `findingCompareRec`).
  - Each: validated figures, scoring, week, board and odds timestamps, the
    explanation with the Derived estimate and Quoted prop labels, a dated
    finding (link and share image), a link tagged per the convention
    (`utm_source` by channel or `creator-<slug>`, `utm_medium` social or
    partner, `utm_campaign` `<season>-w<NN>-<waiver|vegas-gaps|lineup>`), and
    editable text with a counter at the channel's length (X counts a link
    as 23). Nobody kicking off within the hour. When nothing clears, the
    draft says so and nothing is frozen.
- **Two new dated finding kinds**: `set` (up to three gaps on one page) and
  `waiver`. Page, title, description and SVG image for each. A gap or
  comparison hashes exactly as before, so Phase 5 links keep their ids.
- **Creator partners** (`partners` table, `GET/POST /api/admin/partners`,
  `GET /api/admin/partners/package`). The owner's own list, never seeded:
  name, slug, channel, URL, status (prospect, contacted, agreed, active,
  paused, ended), notes. Per partner: visitors, useful visits, saved leagues,
  confirmed email sign-ups off `utm_source=creator-<slug>`. The package: four
  tagged links, a sample segment from the current board (not frozen), and an
  outreach draft with the owner's choices left in brackets. Nothing is sent.
  A partner can be picked as a draft's channel.
- **Comparing sources** (`/api/admin/usage`, shown on /admin). The source
  query is now `usageSourceRows`, shared with the partner list. Each source
  row adds return within 7 days (browsers credited to the source of their
  first visit in the window, mature only, otherwise "maturing") and confirmed
  subscriptions. New "Campaigns" table: per `utm_campaign`, visitors, useful
  visits, saved leagues, confirmed sign-ups. Small samples marked under 20.
- **Sign-up attribution.** `it-newsletter.js` sends the visit's source,
  medium and campaign with a sign-up; `newsletter_subscribers` gains
  `visit_src`, `visit_med`, `visit_cmp` (added on first use by
  `NL_MIGRATIONS`). Labels only; anything containing `@` is dropped.
- **The owner's playbook** (`docs/distribution-playbook.md`): the weekly
  checklist, the link tags, and the 30-day evaluation plan with comparison
  periods, sample-size limits and decision rules. No traffic promises.

### Phase 6 verification (2026-10-17)

- `node tools/test-distribution.mjs` (new, in CI): 82 checks over SQLite.
  The waiver rule (each exclusion, the tie-break, the explanation, never
  "available"); the three drafts (figures, the frozen finding, tagged links,
  X and Threads lengths, the kickoff margin, fewer when fewer qualify,
  nothing invented with no board or nothing qualifying, no outside request
  while building); the new finding kinds' pages and images; a gap finding's
  id unchanged from Phase 5; partners (validation, upsert, metrics with the
  owner excluded, the package, nothing sent); the sign-up's source labels
  and the migration of a Phase 5 table; the real worker's routes (key gate,
  POST-only drafts, 409 with no board, partners). Three deliberate mutations
  (the consensus-inside rule, the kickoff margin, the Phase 5 id) each fail it.
- `REQUIRE_BROWSER=1 node tools/test-distribution-admin.mjs` (new, in CI):
  41 checks at 390 and 1280 px off true payloads. One POST per Build and
  nothing else; figures, labels, editable text, counter and over-length
  warning; clipboard copy that says nothing was posted; another channel's
  limit and tag; "nothing to post" said plainly; a partner added, listed,
  offered as a channel and packaged; the new source columns and campaign
  table; no sideways scroll (a long select overflowed at 390 and was fixed);
  no script errors.
- `test-usage` gained 10 checks (returns by first source, mature only;
  confirmed by source; campaigns; the owner excluded; unavailable without a
  subscriber table).
- Full CI node suite less `test-dry-run`: 80 of 80 pass (with
  `REQUIRE_BROWSER=1`). `test-worker-sql` caught a ternary inside the new
  source query's string on the first run; the query was restructured.
  `build-chrome`, `build-ranks`, `build-seo`, `build-bylines --check` clean;
  `build-front` and `build-worker-faces` produce no diff. Nothing in the
  newsroom or job schedule changed, so `test-dry-run` was not run.

### Still open from Phase 6

- Every owner item under "Outstanding configuration and access".
- The evaluation needs data that does not exist yet: run the 30-day plan in
  `docs/distribution-playbook.md` from the first post.
- Per-finding link-preview images (Phase 5 limit) still apply to drafts:
  platforms show `og.png` in the card; attach the share image by hand.
- Confirmed sign-ups made before Phase 6 carry no source.

## Next steps

All six phases are implemented. There is no further phase in this plan.
After merge, follow the weekly checklist and the 30-day evaluation plan in
`docs/distribution-playbook.md`, and decide the next initiative from its
day-30 read.

## Phase 2 requirements, as given (for reference)

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
