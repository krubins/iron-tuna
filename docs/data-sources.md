# Data sources, licensing, and remediation

Working document for Section 13 and Section 14 of the In-Season Conversion Spec,
Addendum No. 1 (`docs/in-season-conversion-spec-addendum-1.md`).

This file is the **inventory of what the code actually does today**, not a plan.
Every external host reached by `_worker.js` is listed. When you add or remove a
source, edit this file in the same commit.

Verified against `_worker.js` on 2026-09-06.

---

## 1. Current inventory

### Content data — the sources that feed the product

| Host | Used for | Call sites | License status |
|---|---|---|---|
| `api.the-odds-api.com` | NFL odds, totals, spreads | `ODDS_API_BASE`, `_worker.js:1575` | **Paid, terms unconfirmed.** See item R3. |
| `site.api.espn.com` | Injuries, scoreboard, game summary, depth charts | `_worker.js:1353`, `:3061`, `:5656`, `:5657` | **Red.** Undocumented endpoints, no commercial licence. See R1. |
| `api.sleeper.app` | NFL player id/metadata map | `_worker.js:7732`, `:7763` | **Red for a paid product.** Non-commercial grant only. See R2. |
| `static.www.nfl.com` | Team and player imagery, hot-linked | ~335 URL references, none fetched server-side | **Unreviewed.** Copyrighted images served from the league's CDN. See R4. |
| `DFS_SALARY_API` (env) | Licensed DFS salary feed, if configured | `PROVIDER_DFS` → `licensed-salary-feed` | Green when the licence exists. Unset today. |
| DFS lobby CSV | DraftKings / FanDuel salaries | `parseDfsCsv`, `POST /api/admin/dfs` | **Green.** The entrant exports their own file. |

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

### R4 — NFL.com imagery

**Where:** ~335 `static.www.nfl.com` URLs, hot-linked into rendered HTML rather
than fetched server-side.

Not covered by Addendum Section 13, which is about data rather than images, but
it is the same class of question and it is unreviewed. Decide deliberately:
licensed imagery, a permissively licensed substitute, or no headshots.

### R5 — Structural rules from Section 14

- [ ] `/data` page listing every source, licence, and attribution string, linked from every footer. §14.1. **This file is its source of truth.**
- [ ] External-fetch boundary lint. §14.3 specifies `lib/sources/`, which does not exist — the app is a single `_worker.js` plus a root `index.html`. Restate the rule as a marked region inside `_worker.js` with a CI check that fails on `fetch('http` outside it, or budget the restructure. As written the criterion cannot be met.
- [x] No raw third-party response body returned to the browser. §14.2. Holds today: every adapter transforms server-side into an Iron Tuna shape. Needs a test to keep it true.
- [x] API keys server-side only. §14.4. All keys are worker `env` bindings.
- [x] Caching. §14.5. ESPN and Sleeper pulls are `cf.cacheTtl` cached; odds are on the job clock.
- [ ] No Kalshi or prediction-market data anywhere. §13.4. Holds today — nothing to remove — keep it that way.

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
