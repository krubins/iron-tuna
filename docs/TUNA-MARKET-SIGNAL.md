# Tuna Market Signal — setup and handoff

## Architecture and scope

Iron Tuna serves static HTML through `_worker.js`, with no package install/build step.
The existing odds subsystem fetches per-event NFL props from The Odds API and blends
market expectations into projections, with other game-line sources/fallbacks. DFS
uses `dfs_salaries` in `LEADS_DB`, salary imports and its existing optimizer. This
feature adds a separate analytical layer; movement scores do not alter projections
or optimizer rankings without calibration.

The deployed `TUNA MARKET SIGNAL` section in `_worker.js` includes provider adapters,
D1 storage, a shared polling lease, normalization, scoring and routes. Existing
quarter-hour cron ticks check whether collection is due. Visitors only read stored
observations. Vegas Edge, player profiles and DFS have a searchable dashboard supplied
by `tuna-market.js` and `tuna-market.css`.

## Sources researched September 9, 2026

* [The Odds API plans](https://the-odds-api.com/): free 500 credits/month;
  20,000 credits/month is listed at $30. Current odds include game markets and
  supported player props. [Official v4 documentation](https://the-odds-api.com/liveapi/guides/v4/)
  documents event odds, quota headers, and paid historical endpoints. The adapter
  uses current odds; our retained observations provide history prospectively.
* [Provider terms](https://the-odds-api.com/terms-and-conditions.html) permit storage
  and analytical UI use, but prohibit standalone raw data redistribution. These
  routes support the Iron Tuna dashboard, not a commercial raw-data feed.
* [SportsGameOdds](https://sportsgameodds.com/pricing) offers a free tier and paid
  plans; [official API docs](https://sportsgameodds.com/docs) offer another future adapter.
* [Unabated enterprise API](https://unabated.com/odds-api/enterprise) and
  [API documentation](https://docs.unabated.com/) provide a legitimate commercial
  access route. Consumer subscriptions are not assumed to grant API/display rights.
* Action Network, Don Best, Covers, VegasInsider and OddsJam are not scraped or
  connected through private endpoints. Public betting splits need a documented,
  licensed feed. No free licensed splits feed was established in this review.

No accounts were opened, subscriptions purchased, or production credentials read.
The Odds API account/key is the only prerequisite for automatic initial collection.
Published pricing and rights should be checked when signing up.

## Configuration

Use Cloudflare Worker secrets for `ODDS_API_KEY` (existing key can be reused) and
`LEADS_EXPORT_KEY` (existing admin secret). Local development can put secrets in the
gitignored `.dev.vars`. Do not use frontend variables for either secret.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TMS_ENABLED` | unset/off | Set `1` after configuring the key to collect and serve observations |
| `TMS_PROVIDER` | `the-odds-api` | Automatic provider adapter |
| `TMS_SPORT` | `americanfootball_nfl` | Provider sport key, e.g. `basketball_nba` |
| `TMS_INTERVAL_MINUTES` | `360` | Poll interval, clamped 15–1440 minutes |
| `TMS_PROP_EVENT_IDS` | empty | At most two comma-separated provider event IDs |
| `TMS_PROP_MARKETS` | empty | Up to six supported `player_*` markets; no alternate ladders |
| `TMS_SHARP_BOOKS` | empty | Explicit comma-separated reference bookmaker keys; no presumed sharp source |
| `TMS_RETENTION_DAYS` | `30` | Snapshot retention, clamped 1–90 days |
| `TMS_LICENSED_IMPORT` | off | Set `1` only for a feed whose storage/display rights you hold |

Start with the free account and `TMS_ENABLED=1`. The default one US-region poll of
three game markets every six hours costs approximately 360 credits per 30 days.
**The existing odds integration shares the key and consumes additional credits.**
Adding prop events costs up to `events × markets` more credits per poll. Check usage
before reducing the interval; this is a low-cost sampled history, not a real-time
odds screen. Empty prop settings make no prop calls. Event IDs must be rotated as
games finish; obtain upcoming IDs with the documented provider events endpoint.
Example prop market: `player_rush_yds` or `player_pass_yds`.

`LEADS_DB` is reused; no new binding or remote migration command is required.
Idempotent initialization creates `tuna_market_snapshots` and `tuna_market_state`
on first enabled use. These names are isolated from existing tables. Successful
collection prunes expired snapshots. Account for D1 storage/read/write costs.

## API and licensed adapter contract

* `GET /api/tuna-market?kind=props&player=Name`: derived dashboard, max 200 items,
  24-hour calculation window and last 24 observed history points per series.
  `kind=games` selects game markets. No query triggers external collection.
* `POST /api/tuna-market/refresh`: uses the normal lease; cannot bypass cost limits.
* `POST /api/tuna-market/import`: authenticated, opt-in licensed feed ingestion.
  Both POST routes require `Authorization: Bearer <LEADS_EXPORT_KEY>`.

An import is JSON `{ "source": "https://licensed-provider.example", "events": [],
"splits": [] }`, limited to 500 KB and 20 events. `events` follows The Odds API's
documented event/bookmaker/market/outcome structure, **decimal prices**, and ISO
`commence_time`/`last_update` timestamps. Event IDs are isolated under
`licensed-import`; this contract currently represents one licensed source. If adding
multiple import sources, give each a distinct adapter/provider ID first.

Optional split records match `event`, `book`, `market`, `player`, `side`, and `line`
exactly, with numeric `tickets`/`money` percentages (0–100) and `at` in Unix
milliseconds. They reflect only that source's betting population, not the whole
market. Unknown/stale splits are unavailable, never invented from line movement.
Future pull adapters implement `pull(env, observed) -> { rows, quota }` in
`TMS_PROVIDERS` and normalize to the same row schema. Each must retain attribution,
use documented authorized endpoints, and preserve provider ID isolation.

## Calculation and limitations

History identity includes provider, event, book, market, player and side. Alternate
ladders are excluded. Earliest retained observation is **not** labeled opening line.
Line delta is latest minus first. Implied probability delta is `100/latest decimal
price - 100/first decimal price`, calculated only if the line is unchanged. Prices
include bookmaker margin. Prematch and live observations are not mixed; started
events are excluded from the board.

Consensus averages available fresh bookmaker implied probabilities at the identical
line. It is not ticket consensus or a vig-free probability. Configured reference
book gaps use the same comparison; a gap is a proxy, not confirmed sharp activity.

Score v1: up to 60 points for absolute probability movement (12 per percentage
point), 20 for any line change, up to 10 for additional same-line books (2 each),
and up to 10 for the absolute reference gap (2 per percentage point). It is a
descriptive 0–100 heuristic, not a calibrated forecast, bet recommendation or EV.
There must be two observations with distinct provider update times. Quotes over
one hour old receive no score. At the conservative default cadence, observations
will often be stale between polls. Public splits are displayed separately and
never added to score v1.

The query caps history to the most recent 1,000 event snapshots and indicates
truncation. Provider failures preserve prior snapshots. Timeouts are 12 seconds;
429 Retry-After is honored up to one day and the configured interval is a minimum
cooldown. No immediate retries multiply usage. Credential/plan failures are redacted
and recorded in health; unexpected storage errors return 503. Disabled mode works
without keys or D1. Historical backfill from a paid vendor is not enabled; storage
starts with the first successful collection.

## Validation and rollout

Run `node tools/test-tuna-market.mjs` (Node 22.13+ with built-in SQLite),
`node --check _worker.js`, and the existing repo checks. The dedicated suite tests
real deployed math and SQLite statements, import auth, malformed prices, freshness,
idempotency, concurrency, redaction and cooldowns. Provider calls use fixtures;
live paid access is not claimed as tested. In staging, enable the key, collect two
updated snapshots, and verify the dashboard on all three pages before shortening
the polling interval. Roll back by unsetting `TMS_ENABLED`; history remains stored.

No deployment is required to review this commit. Existing main-branch hosting
integration may deploy when changes are later pushed to main.
