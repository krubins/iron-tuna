# Sync My League: audit, architecture and status

Working document for the League Sync feature. Part 1 is the audit of what the
repo already had on the day this was written (2026-09-09). Part 2 is the design
that was built on it. Part 3 is the status of each deliverable, the provider
terms, the flags, the env vars and the deployment steps. HANDOFF.md carries
the short version; this is the long one.

---

## Part 1. Audit of the existing application

Everything below was read out of the repo, not assumed.

| # | Area | What exists | Where |
|---|---|---|---|
| 1 | Authentication | Magic-link email login. `/api/auth/request` mails a signed link to an **entitled** address only; `/api/auth/verify` sets the `it_sess` cookie, an HMAC-SHA256 token `{sid, e, t:'sess', exp}` signed with `AUTH_SECRET`, 90 days, device cap `MAX_DEVICES`. `/api/auth/me`, `/api/auth/logout`. No passwords anywhere. | `_worker.js` §auth helpers (`makeToken`, `readToken`, `parseCookie`), routes near `/api/auth/*` |
| 2 | User-account model | There is no `users` table. Identity is the **email** in the session token. `entitlements(email, product, paid_at)` is paid access; `sessions(id, email, created_at, last_seen, ua)` is the device list; `codes`, `contacts` are leads and claim codes. `COMPED_EMAILS` and `isEntitled()` decide access. | `isEntitled`, `grantEntitlement`, `revokeEntitlement` |
| 3 | League settings | Two **browser-only** records. `iron_tuna_draft_state_v2` (the draft app: teams, budget, format, full custom scoring) read by `it-league.js` as `ITLeague`; `iron_tuna_inseason_league_v1` (platform, PPR preset, teams, FAAB, optional league URL) owned by `it-inseason.js` as `ITInSeason`, with the shared form in `it-inseason-ui.js`. Nothing reaches the server. | `it-league.js`, `it-inseason.js`, `it-inseason-ui.js`, `/my-league`, `/in-season#league` |
| 4 | Scoring settings | One engine, three hand-synced copies (worker, `it-league.js`, `index.html`), held together by `tools/test-scoring.mjs`. `SCORING_BASE` (yard divisors, thresholds, bonuses, TDs, INTs, 2-pt, receptions with a separate RB reception value, fumbles, return TDs), presets `standard/half/ppr`, `scoringRules(preset, custom)`, `scoreStats`, `scoreAny(stats, pos, rules, games)`; K and DEF through `SCORING_KDEF`. Internal stat keys: `passYd passTD passInt pass2pt rushYd rushTD rush2pt recYd recTD rec2pt rec fumLost fum2pt fumRecTD krTD prTD`, K `fgMade fgMissed xpMade xpMissed`, DEF `sacks ints fumRec defTD stTD safety ptsAllowed`. No TE-premium field; `receptionPoints` covers WR and TE alike. | `_worker.js` `SCORING_BASE`, `scoringRules`, `scoreAny` |
| 5 | Manual league setup | The `ITInSeasonUI.leagueForm` on the hub and `/my-league`. Free, no signup, one browser. | as above |
| 6 | Roster functionality | Two paths, both client-side. The **FAAB Advisor** (`faab.html`) reads a Sleeper league directly from the browser (`/v1/user`, `/v1/league`, `/rosters`, `/users`, `/transactions/<round>`, `/state/nfl`) and identifies the reader's roster by Sleeper username; the **Trade Finder** (`trade-finder.html`) takes pasted rosters or screenshots (`/api/roster-read`, an LLM read that returns names only) and resolves them with `ITTrade.makePool/resolve/parseRosters`. No roster is stored server-side. | `faab.html`, `trade-finder.html`, `it-trade.js` |
| 7 | Player database and IDs | `PROJECTIONS` in `_worker.js`: `{name, position (QB/RB/WR/TE/K/DEF), team, projectedStats}`; DEF rows are named by the club ("Houston Texans"). The de-facto key everywhere is `_oddsNorm(name) + '|' + position` (lower-case letters only, suffix stripped). Team codes through `teamKey` and `TEAM_ALIAS` (LA, JAX, WAS, LV). `/api/faab/players` and `/api/live` already proxy Sleeper's `/v1/players/nfl` (cached 6 h) and reduce it to `{sleeperId: [name, pos, team, injury]}`. No canonical cross-provider ID table existed. | `PROJECTIONS`, `_oddsNorm`, `teamKey`, `/api/faab/players` |
| 8 | Rankings | `/api/boards?horizon=week|next3|ros|playoffs&pos&scoring=preset&through` → `buildBoards`: per player `{key, name, position, team, games, byes, weeks[{week, opponent, home, bye, out, consensusPts, vegasPts, ironTunaPts, ...}], injury, consensus/vegas/ironTuna {stats, points, rank, flexRank}, marketDelta, why}`. `boardsContext` already accepts `custom` scoring (`scoringRules(o.preset, o.custom)`) but the route only ever passed a preset and the memo key ignored `custom`. `rankings.html` fetches PPR and re-scores stat lines in the browser from `ITLeague`. Flag `PERSONALIZED_RANKINGS` already exists. | `buildBoards`, `boardsPayload`, `rankings.html` |
| 9 | Weekly projections | `weeks[].ironTunaPts` etc. on the week board; `/api/market` per-player-per-week records. | `buildMarketRecords` |
| 10 | Rest-of-season | Horizons `next3`, `ros` (through week 17 by default), `playoffs` (15–17); Tuesday `ros-snapshot` job freezes the board into `ros_rankings` for risers/fallers (`/api/ros-update`). | `HORIZONS`, `runRosSnapshot` |
| 11 | Waivers / pickups | The Wednesday **Pickup Advisor** content piece (Tyler Grant) for 10/12/14 teams; the FAAB Advisor prices free agents against the reader's Sleeper room. | `CONTENT_KINDS['pickup-advisor']`, `faab.html` |
| 12 | Trades | `ITTrade.findTrades(teams, {slots, points, weeks, horizon, mine, tilt, maxSize, minGain})`: greedy `lineupValue` per roster, both sides must gain on their own horizon. Runs in the browser. | `it-trade.js` |
| 13 | Matchups | NFL games only (`nflSeasonState`, `/api/season`). No fantasy matchup concept existed. | `seasonPayload` |
| 14 | Database | D1 `env.LEADS_DB`. Tables are created lazily with `CREATE TABLE IF NOT EXISTS` behind a per-isolate `_X_READY` memo (`jobReady`, `rosReady`, `dfsReady`). Tables: contacts, codes, entitlements, sessions, unsubscribes, x_posts, threads_token, threads_posts, lead_story, odds_overlay, odds_snapshots, ros_rankings, content_pieces, game_summaries, analyst_calls, newsroom_settings, news_events, news_state, dfs_salaries, job_runs, page_views, site_events. No migration runner. | throughout |
| 15 | External fantasy-platform integrations | Sleeper players map (server + FAAB page client-side). ESPN undocumented endpoints for injuries, scoreboard, summaries and depth charts. Both are **red** in `docs/data-sources.md`; Sleeper's grant is non-commercial only (Addendum 13.5). No Yahoo. | `docs/data-sources.md`, `tools/test-data-sources.mjs` |
| 16 | API abstraction | `PROVIDERS = {kind: [{name, free, needs(env), fetch(env, ctx)}]}` run by `providerRun`; `providerReport` reports presence, never keys. Every adapter transforms into an Iron Tuna shape; no raw third-party body reaches the browser. | `providerRun`, `providerReport` |
| 17 | Scheduled jobs | One quarter-hourly cron → `runScheduledTick` → `JOB_SCHEDULE` (New York time, days/hours/minutes, three phases) → `jobRun` → `job_runs` log; `JOB_SCHEDULE_JSON` env override; health board reads the log. | `JOB_FNS`, `JOB_SCHEDULE`, `jobRun` |
| 18 | Security / encryption | HMAC-SHA256 tokens, HMAC-SHA1 for X OAuth 1.0a, `timingSafeEq`, SHA-256 visitor hashing, per-IP rate limit in `RATE_KV` (fails open), Turnstile on the coach. No encryption-at-rest primitive existed. Secrets are worker `env` bindings. | `hmacSign`, `rl`, `oauth1Signature` |
| 19 | Frontend patterns | Plain HTML pages, `site.css` (`.is-card`, `.is-tag`, `.is-btn`, `.is-grid`, `.is-note`), nav/footer generated into `<!--chrome:nav-->` blocks by `tools/build-chrome.mjs` from one link set (`node tools/build-chrome.mjs`, checked in CI), SEO layer by `tools/build-seo.mjs`, shared IIFE libraries (`ITSeason`, `ITLeague`, `ITInSeason`, `ITTrade`) loaded with `<script defer>`; pages call `/api/*` on the same origin with the session cookie. Analyst personas live in `ANALYSTS` (Grant: pickups; Brooks: rankings; Vega: market; Raines: usage; Dalton: QB/lineups). | `tools/build-chrome.mjs`, `site.css`, `ANALYSTS` |

**Conclusions the design follows.**
- There is no bundler and the repo's own tests lift code out of `_worker.js` by
  marker, so the sync layer lives in one marked region of `_worker.js`
  (`// ══ LEAGUE SYNC` … `// ══ /LEAGUE SYNC`), not in a new module.
- The scoring engine is reused, not copied. A synced league's scoring is
  expressed as a `scoringRules` custom object plus a small `extras` bag for
  what the engine does not model (TE premium, position-specific PPR beyond
  RB, provider-specific bonuses). `leagueScore()` applies the extras on top.
- The manual browser records (`ITInSeason`, `ITLeague`) stay. A synced league
  is an additional, server-side source that the pages prefer when it exists;
  a manual league can also be created server-side through the same model.
- The canonical player key is the one the site already ranks by,
  `_oddsNorm(name)|position`; provider IDs map onto it in `player_id_map`.
- Sleeper's commercial-use problem is real and already on the record here, so
  the Sleeper connector ships behind `FLAG_SLEEPER_SYNC`, default **off**.

---

## Part 2. Design

### 2.1 Normalized league model (`LEAGUE_CONTRACT = 1`)

```
league = {
  id, provider ('sleeper'|'yahoo'|'espn'|'manual'), providerLeagueId, name,
  season, sport: 'nfl', numTeams, status ('pre_draft'|'in_season'|'complete'|'unknown'),
  settings: {
    scoring:  { ...SCORING_BASE keys, ...SCORING_KDEF keys }   // scoringRules-compatible
    extras:   { tePremium, wrReceptionPoints, teReceptionPoints, unsupported: {providerKey: value} }
    roster:   { QB, RB, WR, TE, FLEX, SFLEX, K, DEF, BN, IR, TAXI, other: {label: n} }
    faab: number|null, waiverType, playoffWeekStart, playoffTeams, leagueType
  },
  overrides: { scoring?, roster?, faab? }      // the reader's corrections, never overwritten by sync
  userTeamId, isDefault, sync: { status, lastAt, lastOk, error, nextAt, provider }
  teams[]:   { teamId, name, manager, wins, losses, ties, pointsFor, pointsAgainst, standing, faabLeft, waiverPosition, isUser }
  rosters[]: { teamId, players: [{ providerPlayerId, key|null, name, position, nflTeam, slot ('starter'|'bench'|'ir'|'taxi'), slotLabel }] }
  matchups[]: { week, matchupId, teamId, opponentId, points, opponentPoints, played }
  transactions[]: { providerTxnId, type, teamId, adds[], drops[], faab, status, ts }
}
```

`leagueEffectiveSettings(league)` = synced settings with the overrides applied,
and says which fields are overridden so the UI can label them.

### 2.2 Provider adapters (`LEAGUE_PROVIDERS`)

```
{ id, label, auth: 'public' | 'oauth2' | 'unavailable', flag,
  discover(env, conn, input)   -> [{ providerLeagueId, name, season, numTeams }]
  pull(env, conn, providerLeagueId, ctx) -> raw provider payloads
  normalize(raw, ctx)          -> the model above (players carry providerPlayerId; keys resolved after) }
```

`leagueSync(env, league)` = pull → normalize → `playerMapResolveAll` →
idempotent upsert (provider IDs are the primary keys everywhere) → weekly
snapshot → `league_sync_runs` row. It never deletes a league on a provider
failure; it records the failure and schedules a retry with backoff.

### 2.3 Player-ID mapping

`player_id_map(provider, provider_player_id) -> player_key` with a confidence.
Sleeper's players file carries `espn_id`, `yahoo_id`, `gsis_id`, `sportradar_id`,
so one Sleeper refresh seeds the ESPN and Yahoo crosswalks too. Resolution
order: exact `name|position` on the projections pool → position match with
suffix stripped → single candidate by last name + team. Anything else is a
recorded miss in `player_map_misses`, never a guess. Defenses map by team code.

### 2.4 Personalization engine

All server-side, all deterministic, all read from local D1 data plus the
existing boards. `leagueBoard(env, league, horizon)` calls the existing
`boardsPayload` with the league's custom scoring (the memo key now includes a
hash of it) and annotates every row with `roster: {status, teamId, teamName, slot}`.
Modules: `rankings`, `pickups`, `lineup`, `matchup`, `intel`, `trades` (data
for the existing client engine), `playoffs`, `availability`.

---

## Part 3. Status, terms, flags, env, deployment

### 3.1 The deliverables (spec §47)

| # | Deliverable | Status |
|---|---|---|
| 1 | Existing architecture audit | Part 1 above. |
| 2 | Normalized league-data architecture | Part 2.1; `leagueNormalizeSettings`, `leagueEffectiveSettings`, the ten tables in `LEAGUE_DDL`. |
| 3 | Provider adapter design | Part 2.2; `LEAGUE_PROVIDERS` with `discover / pull / normalize`, `LeagueProviderError` codes shared by every adapter. |
| 4 | Player-ID normalization design | Part 2.3; `leagueResolvePlayer`, `leagueMapPlayers`, `player_id_map`, `player_map_misses`; Sleeper's file carries ESPN/Yahoo/gsis ids for the crosswalk. |
| 5 | Sleeper implementation | **Complete and tested** (fixtures): settings, scoring incl. bonuses and TE premium, roster slots incl. superflex/IR/taxi, users, rosters with starter/bench/IR labels, matchups (history on first sync, a window after), transactions with FAAB bids, user-team identification by owner or co-owner. |
| 6 | Sleeper commercial dependency | **Blocking for production.** Non-commercial grant only; ships behind `FLAG_SLEEPER_SYNC` = off. Needs Sleeper's written license (docs/data-sources.md R2/R7). |
| 7 | Yahoo implementation | **Built, fixture-tested, not yet exercised against a live Yahoo account** (no app credentials in this environment). OAuth 2.0 start/callback/refresh/disconnect, sealed tokens, discovery, league/settings/standings/rosters/scoreboard/transactions pull, stat-id scoring map, roster-position map, user team by `is_owned_by_current_login`. Behind `FLAG_YAHOO_SYNC`. Watch the first live run on the admin board for shape surprises in Yahoo's JSON. |
| 8 | Yahoo OAuth architecture | `/api/oauth/yahoo/start` (signed state bound to the session) → Yahoo → `/callback` (server-side code exchange, Basic auth, tokens sealed with AES-GCM under `LEAGUE_TOKEN_KEY`) → `yahooAccessToken` refreshes within two minutes of expiry and marks the connection `expired` when Yahoo refuses → the UI shows Reconnect Yahoo. `/disconnect` deletes the tokens. The browser never sees a token. |
| 9 | ESPN investigation | No public API, no OAuth, the undocumented endpoint is already red-listed, and a private league needs the reader's session cookies. **Not implemented**; the adapter placeholder reports why; manual is the fallback. Adding it later touches `PROVIDER_ESPN` only. |
| 10 | Manual fallback | `PROVIDER_MANUAL` + `/api/leagues/manual`: settings form, roster by name (the one place name matching is allowed), optional other rosters; same model, same modules. The browser-only records (`ITInSeason`, `ITLeague`) are untouched and still work. |
| 11 | Database changes | Ten tables, created lazily by `leagueReady` (the repo's pattern): leagues, league_teams, league_roster_players, league_matchups, league_transactions, league_snapshots, league_sync_runs, provider_connections, player_id_map, player_map_misses. No existing table changed. |
| 12 | UI changes | it-sync.js; My Leagues (my-league.html); My Week (my-week.html); hooks on rankings, FAAB, Trade Finder, player card, fantasy hub, in-season hub, lead story, desk pieces; the admin card; nav and footer (My Leagues, My Week); the privacy policy. |
| 13 | Sync scheduling | Job `league-sync` hourly (phase 2); per-league due time from `leagueNextSyncAt`: hourly Sunday 8 AM to 4 PM ET, three-hourly Tue/Wed, six-hourly otherwise; backoff 15 min doubling to 24 h on failure; 40 leagues per tick, three at a time; Sync Now limited to one per two minutes per league. |
| 14 | Security | Session cookie on every reader route; every query scoped by the session's email; AES-GCM sealed OAuth tokens; signed OAuth state; the client secret only in the token exchange's Authorization header; `cache-control: no-store` on every league response; the admin key on the admin route; no token in any payload or the admin UI; a per-IP rate limit on connect. |
| 15 | Privacy | privacy.html "If you connect a fantasy league" paragraph; the same text on My Leagues; disconnect explains what is removed and retained. |
| 16 | Personalized Weekly Rankings | `/api/leagues/:id/board` and the rankings page's "Your league (synced)" preset: exact scoring incl. TE premium, roster badges (Your team / Available / Waivers / owner), "Customized for your league". |
| 17 | Personalized Pickup Advisor | `leaguePickups`: only unrostered players, lineup gain this week / next 3 / ROS, a drop that costs less than the add, priority, FAAB range from the remaining budget, stash flag, byes; faab.html shows it above the generic 10/12/14 flow. |
| 18 | Personalized Start/Sit | `leagueLineup`: best lineup incl. FLEX / Superflex / W-R / W-T, byes and injuries scored zero, close decisions with graded confidence and a reason, changes against the set lineup; My Week. |
| 19 | Trade Advisor | `leagueTrades`: real partners, needs against the room's average starter, packages that improve both best lineups (ROS), labels BEST FIT / ROSTER MATCH / BUY LOW / EXPENSIVE BUT WORTH ASKING / UNLIKELY; rosters and points handed to the browser engine (`ITTrade.findTrades`) on the Trade Finder. |
| 20 | Personalized stories | `ITSync.callouts`: On Your Roster / Available in Your League / Affects Your Matchup badges on player links in the lead story and desk pieces, plus a "What this means for your team" block; one common article, a personal layer. `FLAG_PERSONALIZED_STORIES` is reported on the admin board; the availability route is what the callouts read. |
| 21 | Testing results | `tools/test-league-sync.mjs`: 112 assertions, all passing; the pre-existing suites pass (jobs, health, newsroom updated for the new job and the off-by-default flags). |
| 22 | Known provider limitations | Sleeper: the license; waiver status is derived ("dropped in the last two days"); future-week matchups depend on Sleeper exposing them. Yahoo: untested live; JSON is tolerant-parsed; the transactions resource is optional. ESPN: none. Manual: no opponent or matchups unless entered. |
| 23 | Feature flags | `FLAG_LEAGUE_SYNC` (on), `FLAG_SLEEPER_SYNC` (off), `FLAG_YAHOO_SYNC` (off), `FLAG_ESPN_SYNC` (off, no effect), `FLAG_PERSONALIZED_WAIVERS`, `FLAG_PERSONALIZED_LINEUP`, `FLAG_PERSONALIZED_TRADES`, `FLAG_PERSONALIZED_STORIES` (on). The existing `FLAG_PERSONALIZED_RANKINGS` gates the league board. |
| 24 | Environment variables | `LEAGUE_TOKEN_KEY` (secret; any long random string; required for Yahoo), `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` (secrets), `YAHOO_REDIRECT_URI` (optional; defaults to `<origin>/api/oauth/yahoo/callback`), the flags above. Existing and reused: `AUTH_SECRET`, `LEADS_DB`, `RATE_KV`, `LEADS_EXPORT_KEY`. |
| 25 | Deployment steps | 1. Merge; the git integration deploys. 2. The tables create themselves on first use. 3. In Cloudflare, set `LEAGUE_TOKEN_KEY`. 4. Register a Yahoo app (developer.yahoo.com, Fantasy Sports read scope) with the callback URL, set `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET`, then `FLAG_YAHOO_SYNC=1`. 5. Obtain Sleeper's license in writing, save it in docs/, then `FLAG_SLEEPER_SYNC=1`. 6. Watch /admin → League sync for failures, rate limits and unmatched players. |
| 26 | Recommended next providers | Fantrax (public API with league export, permissive terms), MyFantasyLeague (documented API with per-league keys), CBS (partner API, commercial agreement). Each is one adapter. |

### 3.2 Manual QA scenarios (spec §38)

To run once a provider is enabled in production, on the admin board and My Week: A 12-team PPR; B 10-team standard; C 12-team superflex; D TE premium; E unusual bonuses; F one account, several leagues; G a waiver target free in one league and rostered in another. The automated suite covers each shape against fixtures; the live pass confirms the provider payloads match them.
