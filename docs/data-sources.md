# Data sources, licensing, and remediation

Working document for Section 13 and Section 14 of the In-Season Conversion Spec,
Addendum No. 1 (`docs/in-season-conversion-spec-addendum-1.md`).

This file is the **inventory of what the code actually does today**, not a plan.
Every external host reached by `_worker.js` is listed. When you add or remove a
source, edit this file in the same commit.

Verified against `_worker.js` on 2026-09-06. Public page (`/data`, `data.html`) published 2026-09-09; keep the two in step.

---

## 1. Current inventory

### Content data — the sources that feed the product

| Host | Used for | Call sites | License status |
|---|---|---|---|
| `api.the-odds-api.com` | NFL odds, totals, spreads | `ODDS_API_BASE`, `_worker.js:1575` | **Paid, terms unconfirmed.** See item R3. |
| `site.api.espn.com` | Injuries, scoreboard, game summary, depth charts | `_worker.js:1353`, `:3061`, `:5656`, `:5657` | **Red.** Undocumented endpoints, no commercial licence. See R1. |
| `api.sleeper.app` | NFL player id/metadata map | `_worker.js:7732`, `:7763` | **Red for a paid product.** Non-commercial grant only. See R2. |
| `api.sleeper.app` (league sync) | A reader's Sleeper league: settings, rosters, users, matchups, transactions | `PROVIDER_SLEEPER` in the LEAGUE SYNC region | **Red for a paid product, so behind `FLAG_SLEEPER_SYNC` (default off).** Same R2 licence question; see R7. |
| `api.login.yahoo.com` | Yahoo OAuth 2.0 (authorise, token, refresh) | `YAHOO_AUTH`, `YAHOO_TOKEN` | Service endpoint; the reader consents on Yahoo's page. See R7. |
| `fantasysports.yahooapis.com` | A reader's Yahoo league under their own OAuth grant, read-only scope `fspt-r` | `PROVIDER_YAHOO` | **Green for the reader's own data under the Yahoo Developer Network terms**; behind `FLAG_YAHOO_SYNC` until an app is registered. See R7. |
| `static.www.nfl.com` | Team and player imagery, hot-linked | ~1,680 URL references across the deployed HTML, none fetched server-side | **Unreviewed and OPEN.** Copyrighted images served from the league's CDN. See R4. |
| `DFS_SALARY_API` (env) | Licensed DFS salary feed, if configured | `PROVIDER_DFS` → `licensed-salary-feed` | Green when the licence exists. Unset today. |
| DFS lobby CSV (desk import) | DraftKings / FanDuel salaries for the week's main slate | `parseDfsCsv`, `POST /api/admin/dfs` | **Green.** The entrant exports their own file. |
| DFS lobby CSV (reader upload) | A reader's own salary file, for any classic slate | `parseDfsCsv`, `dfsSlateShape`, `POST /api/dfs/slate` | **Green.** Same file, obtained by the reader from a lobby they are already in. Parsed per request and stored nowhere; single-game files are refused rather than mispriced against the classic cap. |

### Infrastructure — not content, no data-licensing question

`api.stripe.com` (payments), `api.resend.com` (mail), `api.anthropic.com` /
`api.openai.com` (LLM), `challenges.cloudflare.com` (Turnstile),
`api.twitter.com` + `upload.twitter.com` + `graph.threads.net` (our own posting),
`api.indexnow.org` (search ping), `github.com` (links only).

These are services Iron Tuna is a paying or authenticated customer of. They do
not supply the factual data the product is built on, so Section 13 does not
reach them. They still belong in this table so the list is complete.

### Removed

| Host | Removed | Why |
|---|---|---|
| `api.draftkings.com` | 2026-09-06 | Operator's own data; terms prohibit systematic retrieval. Addendum 13.3 / 13.7. |
| `api.fanduel.com` | 2026-09-06 | Same. |

Both were behind unset env vars and had never run against the live services, so
removing them changed no behaviour. The `dfs-refresh` cron job went with them:
with no site feeds left, the CSV import is the only path, and it is an admin
action, not a scheduled one.

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

**Attribution owed once adopted:** see §3.

### R2 — Sleeper: licence it or drop it

**Where:** `_worker.js:7732`, `:7763` — both pull `/v1/players/nfl`, cached 6h.

Used only for the player id/metadata map. nflverse publishes rosters with ids
and would cover it, so this is a smaller swap than R1 and can ride along with it.

If you would rather keep Sleeper (their trending data is genuinely useful and
there is no free replacement for it), send the licensing inquiry Addendum 13.5
describes and **get the answer in writing before shipping anything else against
their API.** Attribution is requested by their docs either way.

### R3 — The Odds API: get commercial display terms in writing

**Where:** `_worker.js:1575`, `env.ODDS_API_KEY`.

Already in production. Their public FAQ does not address redisplay. Email
team@the-odds-api.com, ask specifically about displaying derived lines in a paid
subscription product, and save the reply. Addendum 13.2 and 14.6.

This is the cheapest item on the list and it is currently unanswered.

### R4 — NFL.com and ESPN imagery  *(OPEN — owner decision required)*

**Where:** ~1,680 `static.www.nfl.com` URLs plus ESPN cutout URLs built from
`tools/nfl-headshots.json`, hot-linked into rendered HTML rather than fetched
or stored server-side. `tools/build-headshots.mjs` sources the *lookup* from
nflverse (CC BY 4.0); the CC licence covers that dataset, **not** the images the
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
rather than a licence. Nothing in this repository documents permission for it.
`/data` already discloses "team marks" in the imagery row and carries the
takedown address, so the disclosure covers this; the decision does not become
lower-risk for having been disclosed. Backing it out is one edit: delete
`logoUrl` and the `<image>` tags in `renderArt`. Every plate still draws without
them, and the runtime already takes that path when a fetch fails.

### R5 — Structural rules from Section 14

- [x] `/data` page listing every source, licence, and attribution string, linked from every footer. §14.1 — shipped 2026-09-09 as `data.html`, linked from the generated Legal column (`tools/build-chrome.mjs`), the front-page footer and the app footer. **This file remains its source of truth: edit both in the same commit.**
- [ ] External-fetch boundary lint. §14.3 specifies `lib/sources/`, which does not exist — the app is a single `_worker.js` plus a root `index.html`. Restate the rule as a marked region inside `_worker.js` with a CI check that fails on `fetch('http` outside it, or budget the restructure. As written the criterion cannot be met.
- [x] No raw third-party response body returned to the browser. §14.2. Holds today: every adapter transforms server-side into an Iron Tuna shape. Needs a test to keep it true.
- [x] API keys server-side only. §14.4. All keys are worker `env` bindings.
- [x] Caching. §14.5. ESPN and Sleeper pulls are `cf.cacheTtl` cached; odds are on the job clock.
- [ ] No Kalshi or prediction-market data anywhere. §13.4. Holds today — nothing to remove — keep it that way.

### R7 — League sync providers (added 2026-09-09)

See `docs/league-sync.md` Part 3 for the full record. In short:

- **Sleeper.** The league connector uses the same API as the players map and inherits R2 exactly: free for non-commercial use, and Iron Tuna is a paid product. The connector is complete and tested against fixtures but ships **off** (`FLAG_SLEEPER_SYNC`). Turn it on only with Sleeper's written licence in `docs/`. Attribution string in §3 applies.
- **Yahoo.** OAuth 2.0 under the Yahoo Developer Network terms of use. The reader authorises Iron Tuna to read their own fantasy data (scope `fspt-r`); no password is ever seen and tokens are sealed at rest (`LEAGUE_TOKEN_KEY`). Register an app at developer.yahoo.com, set `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET`, and confirm the YDN terms permit use in a paid product before enabling `FLAG_YAHOO_SYNC`. Rate limits are per-app and undocumented; the connector caches for a minute and syncs on the job clock, never per page view.
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
licence.

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
4. Cache. It protects the quota and every green licence here permits it.
5. Keep the written record. When The Odds API or Sleeper answers, save the
   email — `docs/` is a fine home for a text copy.
