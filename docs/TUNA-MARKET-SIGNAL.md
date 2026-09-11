# Tuna Market Signal — setup and handoff

## Architecture and scope

Iron Tuna serves static HTML through `_worker.js`, with no package install/build step.
The existing odds subsystem still powers Vegas projections. Tuna Market Signal is a
separate analytical layer for current betting markets, opening/current line movement,
cross-book confirmation and steam. It does not alter projections or optimizer rankings
without a separate calibrated decision.

As of September 10, 2026, **PropLine is the preferred Tuna Market Signal provider**.
If `PROPLINE_API_KEY` is present and `TMS_PROVIDER` is not explicitly set, the Worker
uses PropLine. The Odds API remains the fallback provider.

The public market endpoint is `GET /api/tuna-market`. The front-page Betting Market
Intel lane now reads that endpoint in addition to `/api/vegas-edge` and includes a
Prop & Line Movement board. DFS and other pages use `tuna-market.js`.

## Why PropLine

PropLine's documented v1 API provides:

- current NFL game markets and player props;
- per-event historical movement with opening and latest price/point;
- a movement endpoint with cross-book steam fields such as books quoting, books moved,
  consensus direction and steam score;
- a free current-odds tier, with historical movement available on paid tiers;
- terms that allow apps, models and websites to surface PropLine-derived insights and
  individual values to end users, while prohibiting bulk redistribution/resale.

Iron Tuna does not expose a raw provider passthrough. The public movement board shows
derived consensus lines and movement metrics. Per-book raw quote history remains
server-side.

The default PropLine bookmaker allowlist is sportsbooks only:

`draftkings,fanduel,pinnacle,bovada,betmgm,betrivers,fanatics,hardrock`

Prediction exchanges are intentionally excluded from this provider path.

## Configuration

Use Cloudflare Worker secrets. Never put provider keys in frontend code or GitHub.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROPLINE_API_KEY` | unset | Preferred PropLine credential |
| `ODDS_API_KEY` | unset | The Odds API fallback credential |
| `TMS_ENABLED` | unset/off | Set `1` to collect and serve Tuna Market Signal |
| `TMS_PROVIDER` | automatic | `propline` when its key exists, otherwise `the-odds-api` |
| `TMS_SPORT` | `americanfootball_nfl` | Sport key |
| `TMS_INTERVAL_MINUTES` | 60 PropLine / 360 Odds API | Poll interval, clamped 15–1440 minutes |
| `TMS_BOOKMAKERS` | sportsbook allowlist above | PropLine books, max 12 |
| `TMS_PROP_MARKETS` | fantasy core list | PropLine player-prop markets, max 12 |
| `PROPLINE_MOVEMENT` | off | Set `1` only with paid movement access; free mode uses stored snapshots |
| `TMS_PROP_EVENT_IDS` | empty | The Odds API fallback only, explicit event IDs |
| `TMS_SHARP_BOOKS` | empty | Optional reference books used by the existing gap heuristic |
| `TMS_RETENTION_DAYS` | 30 | Snapshot retention, clamped 1–90 days |
| `TMS_LICENSED_IMPORT` | off | Admin-only normalized import path |

Default PropLine prop markets are:
`player_pass_yds,player_pass_tds,player_pass_interceptions,player_rush_yds,player_rush_tds,player_reception_yds,player_reception_tds,player_receptions,player_anytime_td`.

Historical movement and steam require a PropLine tier that exposes those features.
If movement is unavailable, current game lines and props still collect and Iron Tuna
continues building prospective history from its own snapshots.

### Free production setup

The deployment configuration now selects `TMS_ENABLED=1`, `TMS_PROVIDER=propline`,
`PROPLINE_MOVEMENT=0`, and `TMS_INTERVAL_MINUTES=60`. Supply `PROPLINE_API_KEY`
as a secret on the production deployment; never commit it. Until the secret exists,
the public endpoint reports disabled and the page shows awaiting configuration.

No paid subscription is needed. Each hourly poll uses two discovery/game requests
plus at most 20 event-prop requests: at most 528 requests per 24 hours, below the
free 1,000/day allowance when this key is dedicated to this collector. Visitor reads
only access D1 and do not spend provider quota. Do not reduce the interval without
recalculating this budget. Paid movement endpoints are never called in free mode.

The public comparison window is 24 hours. A baseline is the first stored observation
in that window, not a guaranteed sportsbook opening line. A second updated quote is
needed to measure movement. Observed agreement compares fresh, comparable books
within the same provider/event/player/market/side; it measures line changes separately
from price changes at an unchanged line. New or stale books cannot manufacture a move.
The public median line delta uses paired per-book changes, excluding incomparable
quotes. `observedBooksMoved`, `observedBooksCompared`, `observedDirection`, and
`observedMovementMetric` are Iron Tuna calculations, never PropLine steam scores.
`historyBasis` distinguishes provider openings from first-observed baselines.
Hourly snapshots can miss brief moves and reversals between polls.

After setting the secret, allow the next scheduled collection or use the authenticated
`POST /api/tuna-market/refresh`. Verify `sourceName: PropLine` and current props in
`GET /api/tuna-market?kind=props`. Initially `comparable` may be false; later changed
quotes should produce observed movement with `steamScore: null`. Check the homepage
Betting Market Intel lane for Baseline, Current, and Agreement / signal columns.

## Provider behavior

The PropLine adapter does four things on each successful poll:

1. fetches current NFL spreads, totals and moneylines;
2. fetches upcoming events for the next nine days;
3. fetches the fantasy-relevant prop markets for each upcoming event;
4. where available, fetches PropLine movement data and attaches opening/current history
   plus steam metadata before storing the normalized observation.

PropLine returns American odds. The adapter converts those prices to decimal internally and selects the most balanced two-way line per book/player/market before storing it, so alternate ladders cannot be mistaken for time-series movement. The existing Tuna Market Signal probability math is otherwise unchanged.

The Odds API fallback retains its prior behavior: bulk game markets plus explicitly
configured event props.

## Public API

- `GET /api/tuna-market?kind=props&player=Name`
- `GET /api/tuna-market?kind=games`
- `POST /api/tuna-market/refresh` (admin bearer token)
- `POST /api/tuna-market/import` (admin bearer token, licensed normalized feed only)

Public items may include source name, derived consensus opening/current line,
consensus line delta, implied-probability delta, cross-book steam score, books moved,
books quoting, and the existing movement score. Book identity, raw per-book price
history and provider credentials remain server-side.

Washington requests remain blocked at the edge with HTTP 451 for Betting Market Intel.

## Storage and scoring

D1 tables remain:
- `tuna_market_snapshots`
- `tuna_market_state`

No migration is required.

When PropLine provides a native opening quote, that opening quote is used immediately
instead of waiting for Iron Tuna to accumulate two scheduled observations. Otherwise
the prior prospective-history method remains the fallback.

The existing movement score remains descriptive, not a win probability or bet
recommendation. PropLine steam can contribute a bounded amount to that score, while
the raw steam score is also displayed separately. This preserves the distinction
between provider movement data and Iron Tuna's own heuristic.

## Licensing record

Reviewed September 10, 2026:

- PropLine documentation: current odds, player props, historical movement and steam.
- PropLine terms effective April 27, 2026 permit building user-facing products and
  surfacing derived insights or individual values, while barring bulk redistribution.
- The Odds API remains an authorized analytical-display fallback under the separate
  review already recorded in `docs/data-sources.md`.
- SportsGameOdds remains in the legacy odds/projection stack but its commercial
  redisplay terms are still an open item. PropLine is not dependent on that unresolved
  license question.

Recheck provider terms when changing product scope or subscription plan.

## Validation

Run:

```sh
node tools/test-tuna-market.mjs
node --check _worker.js
```

The dedicated test suite covers The Odds API compatibility plus PropLine American-odds
normalization, native opening-line movement, cross-book steam metadata, freshness,
storage, cooldowns, auth and licensed imports.

Live production collection still requires a server-side `PROPLINE_API_KEY` and
`TMS_ENABLED=1`. No provider credential is committed to this repository.
