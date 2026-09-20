# Data sources, licensing, and remediation

Working document for Section 13 and Section 14 of the In-Season Conversion Spec,
Addendum No. 1 (`docs/in-season-conversion-spec-addendum-1.md`).

This file is the **inventory of what the code actually does today**, not a plan.
Every external host reached by `_worker.js` is listed. When you add or remove a
source, edit this file in the same commit.

Verified against `_worker.js` on 2026-09-10. Public page (`/data`, `data.html`) published 2026-09-09; keep the two in step.

---

## 1. Current inventory

### Content data — the sources that feed the product

| Host | Used for | Call sites | License status |
|---|---|---|---|
| `api.sportsgameodds.com` | NFL player props, and one of the three quotes averaged into the game spread and total behind `/the-line`, `/previews` and every weekly board | `SGO_API_BASE`, `fetchOddsSgo`, `fetchGameLinesSgo` | **Paid, terms unconfirmed.** See item R8. |
| `api.prop-line.com` | Tuna Market Signal current NFL game lines and fantasy-relevant player props; paid tiers also supply native opening/latest movement and cross-book steam | `TMS_PROVIDERS.propline`, `tmsPropLineHttp` | **Green for end-user analytical display.** Terms effective 2026-04-27 permit apps/websites to surface derived insights and individual values, while prohibiting bulk redistribution. Default integration excludes exchanges. |
| `prop-line.com` | PropLine source-attribution link displayed with market results | `TMS_PROPLINE_SOURCE` | Link only; the worker does not fetch this website. Data use is covered by the API inventory entry above. |
| `api.the-odds-api.com` | NFL odds, totals, spreads, supported props, and prospective Tuna Market Signal snapshots | `ODDS_API_BASE`, `TMS_PROVIDERS` | **Green for analytical UI use.** Current terms permit storage and derived/display use, while prohibiting standalone raw-data redistribution. See R3. |
| `the-odds-api.com` | Tuna Market Signal source-attribution link | `TMS_SOURCE` | Identification link only; the Worker does not fetch this host. |
| `site.api.espn.com` | Injuries, scoreboard, game summary, depth charts, **and the game lines the scoreboard carries** | `_worker.js:1353`, `:3061`, `:5656`, `:5657`, `_espnOdds` | **Red.** Undocumented endpoints, no commercial license. The odds block adds a bookmaker's spread, total and opening line to what is taken. No page names the book; the name reaches the JSON API only. See R1. |
| `api.sleeper.app` | NFL player id/metadata map | `_worker.js:7732`, `:7763` | **Red for a paid product.** Non-commercial grant only. See R2. |
| `static.www.nfl.com` | Team and player imagery, hot-linked | ~1,680 URL references across the deployed HTML, none fetched server-side | **Unreviewed and OPEN.** Copyrighted images served from the league's CDN. See R4. |
| `thumb.wikimedia.org` and `upload.wikimedia.org` (resolved via `commons.wikimedia.org` and `www.wikidata.org` at build time) | Game photographs for the story art on `/`, `/in-season/desk`, `/lead`: one openly licensed action photo per player, hot-linked as a Commons thumbnail | `tools/build-action-shots.mjs` (build-time lookup, never the Worker), `it-action.js` (the deployed map), `storyArt()` in `player-search.js` | **Green, with an obligation.** Only CC0, public-domain, CC BY and CC BY-SA files are kept (`LICENSE_OK` in the tool; NC and ND never match). CC BY / CC BY-SA require the photographer, the license and a link to it wherever the file is shown, and that a cropped copy says so; `storyArt()` prints exactly that under every use and `tools/test-story-art.mjs` fails the build if it stops. See R9. |
| `DFS_SALARY_API` (env) | Licensed DFS salary feed, if configured | `PROVIDER_DFS` → `licensed-salary-feed` | Green when the license exists. Unset today. |
| DFS lobby CSV (desk import) | DraftKings / FanDuel salaries for the week's main slate | `parseDfsCsv`, `dfsSlateShape`, `POST /api/admin/dfs` | **Green.** The entrant exports their own file. Single-game (Showdown/MVP) files are refused rather than mis-priced against the classic cap; the refusal is unconditional, because `dfsSalariesRead` does not filter on the `slate` column and would serve one stored under any slate name, and because the scheduled workflow below posts `slate: 'weekly'`. |
| DFS lobby CSV (reader upload) | — | — | **Removed 2026-09-20.** The upload panel on `/dfs` and the `POST /api/dfs/slate` route behind it are both gone, so no reader file reaches the site at all. Nothing was ever stored, and `/dfs` now clears the CSVs the old panel had left in readers' browsers. The desk import above is the only CSV path left. |
| DraftKings lobby + draftables (scheduled repository workflow) | DraftKings NFL weekly Classic salaries across the Thursday-through-Monday game window | `tools/import-draftkings-salaries.mjs`, `.github/workflows/draftkings-salaries.yml` → `POST /api/admin/dfs` | **Red / owner-directed exception.** Undocumented, keyless operator endpoints; automated access may conflict with operator terms and can change without notice. The workflow merges all available multi-game Classic pools for the target NFL week, excludes Showdown/single-game pricing, validates 40+ players and all five positions, then imports the combined player set. It authenticates with a short-lived GitHub Actions identity token restricted to this repository, workflow and `main` branch. |

### Infrastructure — not content, no data-licensing question

`api.stripe.com` (payments), `api.resend.com` (mail), `api.anthropic.com` /
`api.openai.com` (LLM), `challenges.cloudflare.com` (Turnstile),
`api.twitter.com` + `upload.twitter.com` + `graph.threads.net` (our own posting),
`api.indexnow.org` (search ping), `github.com` (links only), `schema.org`
(the JSON-LD `@context`: a vocabulary identifier printed into the structured
data, never fetched).

These are services Iron Tuna is a paying or authenticated customer of. They do
not supply the factual data the product is built on, so Section 13 does not
reach them. They still belong in this table so the list is complete.

### Removed

| Host | Removed | Why |
|---|---|---|
| `api.draftkings.com` | 2026-09-06 | Operator's own data; terms prohibit systematic retrieval. Addendum 13.3 / 13.7. |
| `api.fanduel.com` | 2026-09-06 | Same. |

Both Worker-side integrations were behind unset env vars and had never run
against the live services, so removing them changed no behavior. The old
`dfs-refresh` Worker cron went with them. DraftKings was later added as an
owner-directed, once-weekly repository workflow that stays outside the deployed
Worker. It merges the available multi-game Classic salary pools across the
Thursday-through-Monday NFL week and sends a validated combined CSV through the
existing admin import. FanDuel remains absent.

### Evaluated and not adopted

| Host | Checked | Why not |
|---|---|---|
| `sportsbook.draftkings.com` / `sportsbook-nash.draftkings.com` (DraftKings Sportsbook JSON: game lines, player props) | 2026-09-13 | Every API path tried (`/sites/US-SB/api/v5/eventgroups/88808`, `/api/sportscontent/<site>/v1/leagues/88808`, the navigation and category endpoints) answers a non-browser client with an Akamai "Access Denied" (HTTP 403) whatever the headers, and the sportsbook page loads the Akamai Bot Manager sensor script. A scheduled workflow like the DFS salary import would be refused the same way. Getting past it means defeating bot detection, which this repo does not do, and the sportsbook terms prohibit automated access regardless. Addendum 13.3 / 13.7. DraftKings' lines and props already reach the site through the licensed providers above under the book key `draftkings`. |

The DFS lobby JSON the salary workflow reads is a different host
(`www.draftkings.com/lobby`, `api.draftkings.com/draftgroups`) and answered an
unauthenticated fetch normally on the same day: the sportsbook is fenced, the
lobby is not. Both sportsbook hosts are on the red list in
`tools/test-data-sources.mjs`, so a future attempt fails the build rather than
rediscovering this.

---

## 2. Remediation queue

Ordered by exposure. Each item names the call sites so the work is unambiguous.

### R1 — Replace the ESPN endpoints  *(largest, highest exposure)*

**Where:** `_worker.js:1353` (`AVAIL_FEED_URL`, injuries), `:3061`
(`ESPN_SCOREBOARD`), `:5656` (`ESPN_SUMMARY`), `:5657` (`ESPN_DEPTH`).

These are undocumented internal endpoints with no terms permitting commercial
redisplay, and they are live in a paid product right now. This is the item that
actually matters.

**Replacement:** nflverse-data (CC BY 4.0, commercial use permitted) publishes
injuries, depth charts, rosters, schedules and snap counts. It is a source swap,
not a feature loss. The one gap is live in-game scoreboard state, which nflverse
does not publish in real time — decide whether `/game-intel` needs live scores or
whether post-game data is enough, because that answer changes the size of R1.

**The scoreboard's odds block was the second gap, and SportsGameOdds closes
it.** Where `SGO_API_KEY` is set, `runScheduleRefresh` merges SGO's spread and
total onto every fixture that has not kicked off, and the `book` pair
(`_gameLineMove`'s open/current source) is SGO's anchor book rather than ESPN's.
That removes the reason R1 had to trade the opening line away: the swap can now
drop `_espnOdds` without losing movement. **It is not done yet** — the key is
unset, so ESPN is still the live source today, and the paragraph below still
describes what happens with no key. Take the ESPN odds block out in the same
commit that turns the key on, not before.

**The original note, still true with no key:** `_espnOdds`
reads the spread and total ESPN carries from one named book, plus that book's
own opening line, and the site now displays the movement between them. nflverse
publishes closing lines in `games.csv` and no opener at all, so this one is not
a straight swap: dropping ESPN costs the opening line and every move computed
off it. Two things follow. No page attributes the line to the book, so the
displayed number is an unattributed spread and total, the same shape as the
`games.csv` line beside it; the book's name is carried on the API payloads
(`book.name`, `moveBook`) and rendered nowhere. Whether taking a book's
opening line from an unlicensed feed needs its own answer is still a question
for R1's inquiry, but it is not a display-attribution question today, and
anything that starts printing the name changes that. And the fallback is real
rather than theoretical — `_gameLineMove` drops back to the snapshot store's own first
sighting when the book pair is absent, so pulling the feed degrades the number
instead of removing the feature.

**Attribution owed once adopted:** see §3.

### R2 — Sleeper: license it or drop it

**Where:** `_worker.js:7732`, `:7763` — both pull `/v1/players/nfl`, cached 6h.

Used only for the player id/metadata map. nflverse publishes rosters with ids
and would cover it, so this is a smaller swap than R1 and can ride along with it.

If you would rather keep Sleeper (their trending data is genuinely useful and
there is no free replacement for it), send the licensing inquiry Addendum 13.5
describes and **get the answer in writing before shipping anything else against
their API.** Attribution is requested by their docs either way.

### R3 — The Odds API analytical display rights *(CLOSED 2026-09-10)*

**Where:** `ODDS_API_BASE`, `TMS_PROVIDERS`, `env.ODDS_API_KEY`.

The provider's terms dated August 31, 2026 expressly permit storing data,
displaying it in user-facing commercial websites and analytical dashboards, and
displaying derived values. They prohibit reselling or redistributing the data as
a standalone raw feed. Tuna Market Signal serves bounded derived dashboard data
for Iron Tuna and does not expose a raw provider passthrough. Recheck the terms
when changing product scope or subscription plan and retain the dated review in
`docs/TUNA-MARKET-SIGNAL.md`.

### R8 — SportsGameOdds: get commercial display terms in writing  *(added 2026-09-10)*

**Where:** `SGO_API_BASE` and the adapter beneath it, `env.SGO_API_KEY`.

The question R3 just answered, asked of the other feed. A paid subscription is
a licence to **use** the feed; it is not automatically a licence to
**redisplay** derived numbers in a paid product, and nothing in SGO's public
documentation addresses redisplay. R3 is the template: The Odds API's terms of
August 31, 2026 expressly permit storing, displaying and deriving, and prohibit
redistributing a standalone raw feed. Ask SGO the same question in the same
words, and save the dated reply in `docs/`. Until it arrives this row is the
only unconfirmed odds source on the list.

Two things reduce the exposure while that is unanswered, and neither settles it:

- **No page names a book.** The printed spread and total are SGO's consensus,
  the same shape as the `games.csv` number beside them, and `lineConsensus`
  then averages that consensus with the spine's and the scoreboard's, so the
  printed line is not any one source's number at all. The anchor book's name
  reaches `book.name` and `moveBook` on the API payloads and is rendered
  nowhere. Anything that starts printing it changes this answer.
- **Nothing is passed through raw.** Every prop becomes an expected stat line
  server-side before it reaches a browser (§14.2).

**The adapter has never run against the live service.** It is written to SGO's
published v2 documentation and to the field names in their own TypeScript SDK
(`sports-odds-api@2.1.0`), and it is held to a committed fixture by
`tools/test-sgo.mjs`. Treat the first real pull as a test: check
`/api/admin/market-status` for the row count and the club-match rate before
believing any number it produces.

### R4 — NFL.com and ESPN imagery  *(OPEN — owner decision required)*

**Where:** ~1,680 `static.www.nfl.com` URLs plus ESPN cutout URLs built from
`tools/nfl-headshots.json`, hot-linked into rendered HTML rather than fetched
or stored server-side. `tools/build-headshots.mjs` sources the *lookup* from
nflverse (CC BY 4.0); the CC license covers that dataset, **not** the images the
URLs in it point at, which stay the publishers' property.

Not covered by Addendum Section 13, which is about data rather than images, but
it is the same class of question and it remains unreviewed. Decide deliberately:
licensed imagery, a permissively licensed substitute, or no headshots.

**Changed 2026-09-09, and only the wording.** The front-page footer used to read
"Player photos © NFL/ESPN", which states someone else's copyright next to Iron
Tuna's own and reads to a careful reader as a claim of permission. No such
permission is documented anywhere in this repository. The line now says what is
actually true — the images are referenced from their publishers' own hosts, the
rights stay with their owners, Iron Tuna is not affiliated with or endorsed by
the NFL or any club — and `/data` carries the same statement plus a takedown
address. **The images themselves were NOT removed**: there is no lawful drop-in
replacement already in use anywhere in the app, and pulling ~1,680 images out of
the front page, the player cards and every story is a product decision, not a
cleanup. It is the largest open IP item on this list.

**Widened 2026-09-09: club marks, not only player photographs.** The front-page
lead's art plate (`renderArt` in `front.html`) now references club logos from
`a.espncdn.com/i/teamlogos/nfl/500/<abbr>.png`, on the owner's instruction. Same
host and same posture as the headshots above — hot-linked, never copied or
stored, rights left with their owners, no affiliation asserted — but a different
class of right: a club mark is a **trademark** as well as a copyright work, and
using one to illustrate a story about that club is a nominative-fair-use argument
rather than a license. Nothing in this repository documents permission for it.
`/data` already discloses "team marks" in the imagery row and carries the
takedown address, so the disclosure covers this; the decision does not become
lower-risk for having been disclosed. Backing it out is one edit: delete
`logoUrl` and the `<image>` tags in `renderArt`. Every plate still draws without
them, and the runtime already takes that path when a fetch fails.

### R5 — Structural rules from Section 14

- [x] `/data` page listing every source, license, and attribution string, linked from every footer. §14.1 — shipped 2026-09-09 as `data.html`, linked from the generated Legal column (`tools/build-chrome.mjs`), the front-page footer and the app footer. **This file remains its source of truth: edit both in the same commit.**
- [ ] External-fetch boundary lint. §14.3 specifies `lib/sources/`, which does not exist — the app is a single `_worker.js` plus a root `index.html`. Restate the rule as a marked region inside `_worker.js` with a CI check that fails on `fetch('http` outside it, or budget the restructure. As written the criterion cannot be met.
- [x] No raw third-party response body returned to the browser. §14.2. Holds today: every adapter transforms server-side into an Iron Tuna shape. Needs a test to keep it true.
- [x] API keys server-side only. §14.4. All keys are worker `env` bindings.
- [x] Caching. §14.5. ESPN and Sleeper pulls are `cf.cacheTtl` cached; odds are on the job clock.
- [ ] No Kalshi or prediction-market data anywhere. §13.4. Holds today — nothing to remove — keep it that way.

### R7 — League-platform connectors (removed 2026-09-18)

There are none. The Sleeper, Yahoo and CBS league connectors, the OAuth flow
and the sealed provider tokens were removed: no provider ever carried a
reader's league in production. Iron Tuna makes no request to any fantasy
platform on a reader's behalf, holds no password or access token for one, and
stores no provider credential of any kind.

A league is the reader's own entry now — typed, pasted, or read off a roster
screenshot by `/api/roster-read` — saved through `POST /api/leagues/manual`.
See `docs/saved-league.md`.

`api.sleeper.app` stays on the inventory above for the **players id/metadata
map only**, which predates the connectors and carries the same R2 question.

### R6 — Schema note for the free-tier delay model

The addendum's `plays` table specifies `timestamptz`. Storage here is D1
(SQLite, `env.LEADS_DB`), which has no such type. Match the existing convention
in `dfs_salaries`: store `public_release_at` as integer epoch milliseconds, the
same as `fetched_at`.

---

### R9 — Wikimedia Commons game photographs: keep the credit with the picture  *(added 2026-09-16)*

**Where:** `tools/build-action-shots.mjs` → `tools/nfl-action-shots.json` →
`it-action.js` → `storyArt()` in `player-search.js`, and the lead band in
`front.html` (`renderCast`).

The first imagery on the site with a license anyone can read. Every row in the
lookup is a file Commons publishes under CC0, public domain, CC BY or CC BY-SA;
the tool refuses everything else, and the test refuses a row that slips past
it. What the two CC licenses ask in return is not optional and is not
"attribution" in the loose sense the headshot footer once used: **the
photographer's name, the license name, a link to the license deed, and a note
that the image was cropped, shown with the image.** The row carries all four
(`a`, `l`, `lu`, and the fixed "cropped" wording), the figure prints them, and
a page that showed the photograph without them would be using the file outside
its license. Do not "tidy" the credit away.

Two things this does **not** settle, for the owner:

1. **Right of publicity.** A CC license is the photographer's grant of
   copyright; it says nothing about the player's likeness. Editorial use in a
   story about that player's game is the ordinary news use these pictures
   were made for, and it is the same posture the headshots already take, but
   it is a separate right and this file is not the place it gets cleared.
2. **Hot-linking.** The pages reference Commons thumbnails rather than copying
   the files, the same posture as the headshots. Commons permits it; CC would
   equally permit vendoring the files into the repo, which trades a few
   megabytes for independence from their CDN. A bandwidth decision, not a
   rights one. `--vendor` does not exist yet; add it if the CDN ever proves
   unreliable.

The lookup itself is a network job (`node tools/build-action-shots.mjs`, with
`NODE_USE_ENV_PROXY=1` behind a proxy) and is **not run by the CI checks**:
that gate only verifies `it-action.js` matches the JSON it was generated from.

**Who runs it, and why it is a workflow.** The tool was written in a Claude
Code session whose egress policy refuses `commons.wikimedia.org` and
`www.wikidata.org` outright (403 to CONNECT), so it could be written there but
never run there — it shipped in #251 with an empty lookup and every story fell
back to headshots. `.github/workflows/action-shots.yml` is the machine that
can: a GitHub runner has ordinary outbound internet. It runs monthly and on
demand, walks a few hundred players per run (the tool skips anyone already on
file unless `--refresh`), and **opens a pull request rather than pushing** —
what it changes is a thousand rows of third-party URLs and license strings,
and a wrong row is a picture of the wrong man. The workflow runs
`tools/test-story-art.mjs` before it proposes anything, so a file that fails
the license or credit rules fails the run instead of reaching a branch.

Until a run lands, the JSON is empty, every plate falls back to the headshot
cutout, and nothing on the site breaks. That is the designed resting state,
not an outage.

## 3. Attribution strings

Publish these on `/data` and in the site footer.

**Wikimedia Commons game photographs** — required by CC BY and CC BY-SA, per
file, with the picture. `storyArt()` prints it; the shape is:

> Photo: *Photographer* (linked to the file page), *CC BY-SA 2.0* (linked to
> the deed), via Wikimedia Commons; cropped to fit.

**nflverse-data** — required by CC BY 4.0. Retain creator identification, state
that the data was modified, and link the source.

> Player, roster, schedule and injury data from nflverse-data, licensed under
> CC BY 4.0. Modified by Iron Tuna. https://github.com/nflverse/nflverse-data

**CollegeFootballData.com** — not required, but requested, so give it.

> Data provided by CollegeFootballData.com

**Sleeper** — requested by their docs, wherever their data is used under a
license.

> Player metadata from Sleeper. https://sleeper.com

**National Weather Service** — public domain, no attribution required. Credit
anyway; it costs nothing.

> Forecasts from the National Weather Service.

---

## 4. Standing rules

1. Never add a `fetch` to a new external host without adding a row to §1 in the
   same commit.
2. Never return a third-party response body to the browser. Transform
   server-side, return an Iron Tuna shape.
3. API keys are `env` bindings. Never in client code, never in the repo.
4. Cache. It protects the quota and every green license here permits it.
5. Keep the written record. Preserve dated provider terms and licensing confirmations in `docs/`.
6. PropLine's default bookmaker allowlist is sportsbook-only. Do not add exchanges to that path without a separate product and legal decision.

### R9a — the depiction rule  *(added 2026-09-17, after the first live run)*

The first run of `.github/workflows/action-shots.yml` resolved 115 players and
**54% of its rows had a file title that never mentioned the player.** It was
taking the best-scoring landscape file out of each player's Commons *category*,
and a category is a filing cabinet rather than a claim about who is in a
picture. It produced, among others:

| Row | File it chose | What that is |
|---|---|---|
| `austin-hooper` | `Chiefs vs Titans TE Chigoziem Okonkwo.png` | a different tight end |
| `antonio-gibson` | `Sam Howell scramble Cardinals vs Commanders` | a team-mate |
| `aidan-o-connell` | `Salute to Service Boot Camp … Airmen` | not football |
| `amari-cooper` | `Cleveland Browns Visit NASA Glenn` | a facility tour |

None of it was merged. `depicts()` now requires evidence of one of two kinds
before a file is used: it **is** the entity's Wikidata image (P18), or its
**title names him**. Everything else is discarded even when it is probably
fine, because these pictures run in the homepage's hero under somebody's name
and a wrong one is a picture of the wrong man. `NOT_ACTION` also now drops
visits, tours, training camp, practice, media day and military events.

The trade is coverage: replaying the rule over that run's own output keeps 46
of 115 on the title test alone, plus whatever P18 adds back. Each row also
carries `why` (`p18` or `named`) so the evidence is visible in the diff;
`emitJs()` strips it, so it never reaches a browser.

### R9b — what the browser actually fetches  *(added 2026-09-17)*

Two corrections after watching the live page make its requests.

**The host.** The Commons API returns thumbnails on **`thumb.wikimedia.org`**
(117 of 133 rows) as well as `upload.wikimedia.org` (16). The inventory above
named only the second. Both are Wikimedia's own file hosts and the licensing
position is identical; the row is corrected so the host list is true.

**The tracking query.** Every thumbnail URL the API hands back carries
`?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`.
Serving that to a reader reports every page view of ours back to Wikimedia as
an "imageinfo thumbnail" click — the API's own analytics, attached to a URL
that was never meant to leave the build. `cleanUrl()` strips the query on the
way into `it-action.js`, so the rows already on file were cleaned without
re-running the lookup. The file serves identically without it.

