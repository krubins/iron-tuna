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
| `<league>.football.cbssports.com` | Reader-authorized CBS league settings, teams, rosters, standings, schedules, waiver order and transaction log | `PROVIDER_CBS`, `cbsGet`; validated league subdomain, fixed HTTPS `/api/league/` resources | **Off by default (`FLAG_CBS_SYNC`).** Token access and commercial terms still require live verification. No CBS login/password collection or provider writes. See docs/league-sync.md CBS addendum. |
| `api.sportsgameodds.com` | NFL player props, and one of the three quotes averaged into the game spread and total behind `/the-line`, `/previews` and every weekly board | `SGO_API_BASE`, `fetchOddsSgo`, `fetchGameLinesSgo` | **Paid, terms unconfirmed.** See item R8. |
| `api.prop-line.com` | Tuna Market Signal current NFL game lines and fantasy-relevant player props; paid tiers also supply native opening/latest movement and cross-book steam | `TMS_PROVIDERS.propline`, `tmsPropLineHttp` | **Green for end-user analytical display.** Terms effective 2026-04-27 permit apps/websites to surface derived insights and individual values, while prohibiting bulk redistribution. Default integration excludes exchanges. |
| `api.the-odds-api.com` | NFL odds, totals, spreads, supported props, and prospective Tuna Market Signal snapshots | `ODDS_API_BASE`, `TMS_PROVIDERS` | **Green for analytical UI use.** Current terms permit storage and derived/display use, while prohibiting standalone raw-data redistribution. See R3. |
| `the-odds-api.com` | Tuna Market Signal source-attribution link | `TMS_SOURCE` | Identification link only; the Worker does not fetch this host. |
| `site.api.espn.com` | Injuries, scoreboard, game summary, depth charts, **and the game lines the scoreboard carries** | `_worker.js:1353`, `:3061`, `:5656`, `:5657`, `_espnOdds` | **Red.** Undocumented endpoints, no commercial license. The odds block adds a bookmaker's spread, total and opening line to what is taken. No page names the book; the name reaches the JSON API only. See R1. |
| `api.sleeper.app` | NFL player id/metadata map | `_worker.js:7732`, `:7763` | **Red for a paid product.** Non-commercial grant only. See R2. |
| `api.sleeper.app` (league sync) | A reader's Sleeper league: settings, rosters, users, matchups, transactions | `PROVIDER_SLEEPER` in the LEAGUE SYNC region | **Red for a paid product, so behind `FLAG_SLEEPER_SYNC` (default off).** Same R2 license question; see R7. |
| `api.login.yahoo.com` | Yahoo OAuth 2.0 (authorize, token, refresh) | `YAHOO_AUTH`, `YAHOO_TOKEN` | Service endpoint; the reader consents on Yahoo's page. See R7. |
| `fantasysports.yahooapis.com` | A reader's Yahoo league under their own OAuth grant, read-only scope `fspt-r` | `PROVIDER_YAHOO` | **Green for the reader's own data under the Yahoo Developer Network terms**; behind `FLAG_YAHOO_SYNC` until an app is registered. See R7. |
| `static.www.nfl.com` | Team and player imagery, hot-linked | ~1,680 URL references across the deployed HTML, none fetched server-side | **Unreviewed and OPEN.** Copyrighted images served from the league's CDN. See R4. |
| `DFS_SALARY_API` (env) | Licensed DFS salary feed, if configured | `PROVIDER_DFS` → `licensed-salary-feed` | Green when the license exists. Unset today. |
| DFS lobby CSV (desk import) | DraftKings / FanDuel salaries for the week's main slate | `parseDfsCsv`, `POST /api/admin/dfs` | **Green.** The entrant exports their own file. |
| DFS lobby CSV (reader upload) | A reader's own salary file, for any classic slate | `parseDfsCsv`, `dfsSlateShape`, `POST /api/dfs/slate` | **Green.** Same file, obtained by the reader from a lobby they are already in. Parsed per request and stored nowhere; single-game files are refused rather than mispriced against the classic cap. |
| DraftKings lobby + draftables (scheduled repository workflow) | DraftKings NFL weekly Classic salaries across the Thursday-through-Monday game window | `tools/import-draftkings-salaries.mjs`, `.github/workflows/draftkings-salaries.yml` → `POST /api/admin/dfs` | **Red / owner-directed exception.** Undocumented, keyless operator endpoints; automated access may conflict with operator terms and can change without notice. The workflow merges all available multi-game Classic pools for the target NFL week, excludes Showdown/single-game pricing, validates 40+ players and all five positions, then imports the combined player set. |

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

### R7 — League sync providers (added 2026-09-09)

See `docs/league-sync.md` Part 3 for the full record. In short:

- **Sleeper.** The league connector uses the same API as the players map and inherits R2 exactly: free for non-commercial use, and Iron Tuna is a paid product. The connector is complete and tested against fixtures but ships **off** (`FLAG_SLEEPER_SYNC`). Turn it on only with Sleeper's written license in `docs/`. Attribution string in §3 applies.
- **Yahoo.** OAuth 2.0 under the Yahoo Developer Network terms of use. The reader authorizes Iron Tuna to read their own fantasy data (scope `fspt-r`); no password is ever seen and tokens are sealed at rest (`LEAGUE_TOKEN_KEY`). Register an app at developer.yahoo.com, set `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET`, and confirm the YDN terms permit use in a paid product before enabling `FLAG_YAHOO_SYNC`. Rate limits are per-app and undocumented; the connector caches for a minute and syncs on the job clock, never per page view.
- **CBS Sportsline.** The connector uses a reader-supplied token scoped to one CBS football league. It calls only a fixed read-resource allowlist on the validated `<league>.football.cbssports.com` host, puts the token in the Authorization header, refuses redirects, and seals one token per league with `LEAGUE_TOKEN_KEY`. It never collects a CBS username/password or calls the mobile login endpoint. The implementation is synthetic-fixture-tested but not live-tested and ships **off** (`FLAG_CBS_SYNC`). Keep it off until a controlled live pass validates response shapes and CBS confirms permitted access and commercial use.
- **ESPN.** No supported path. Not implemented; the adapter is a documented placeholder and manual setup is the fallback. Do not add the `lm-api-reads` host.

### R6 — Schema note for the free-tier delay model

The addendum's `plays` table specifies `timestamptz`. Storage here is D1
(SQLite, `env.LEADS_DB`), which has no such type. Match the existing convention
in `dfs_salaries`: store `public_release_at` as integer epoch milliseconds, the
same as `fetched_at`.

---

## 3. Attribution strings

Publish these on `/data` and in the site footer.

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
