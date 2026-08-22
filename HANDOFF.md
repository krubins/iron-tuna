# Iron Tuna — Project Handoff

Fantasy-football auction draft assistant. Live at **https://irontuna.com**.
This document is everything you need to pick the project up in Claude Code (or any editor).

---

## 1. Repository & branch

- **Repo:** https://github.com/krubins/iron-tuna
- **Work from branch:** `main` (single active branch; deploys come from `main`).
- **Clone:**
  ```bash
  git clone https://github.com/krubins/iron-tuna.git
  cd iron-tuna
  ```
- As of this handoff, `main` HEAD is `0a9f0ab` ("Cheatsheet: wrap Show toggles to next line, remove Reset ranks") plus this `HANDOFF.md` commit. The working tree is clean and fully pushed — nothing is local-only.

---

## 2. Stack

| Layer | What it is |
|---|---|
| Frontend | A **single file, `index.html`** (~1.1 MB). React + ReactDOM loaded from CDN. The app script is **pre-compiled JS** (`<script type="module">`, `React.createElement` calls — no in-browser Babel anymore). **`index.html` is the authoritative, deployed file — edit it directly.** |

> **There is no separate JSX "source" file.** `index.html` **is** the source — edit its
> `<script type="module">` block directly. (A stale `app.source.html` used to sit alongside
> it; it had drifted ~35 top-level symbols behind the real build — the whole snake-draft hub,
> mock snake draft, full 18-week schedule, best ball, affiliate portal, etc. — so "rebuilding"
> from it would have silently deleted shipped features. It was deleted in July 2026; recover it
> from git history only if you intend to regenerate a faithful source, never to rebuild from.) |
| Styling | One inline `<style>` block in `index.html` (starts at **line 35**). No Tailwind, no CSS modules, no preprocessor. |
| Backend | **`_worker.js`** — a Cloudflare Worker that (a) serves the static files and (b) proxies two API routes: `/api/coach` (LLM "Gameday Navigator") and `/api/projections` (player projection data kept server-side). |
| Data | Authoritative player projections live **inside `_worker.js`** (lightly obfuscated) and are fetched at runtime; `index.html` carries a client-side fallback/last-year stat-line remap. |

**There is no build step and no package manager.** No `package.json`, no `node_modules`, no bundler. The "build" is literally "serve these static files." React/Babel do their work client-side. (A `package.json` line appears in `.assetsignore` defensively, but none exists in the repo.)

---

## 3. Run it locally

Because there's no build, any static file server works. Two good options:

```bash
# Option A — quickest, frontend only (no /api/* routes):
python3 -m http.server 8080
# then open http://localhost:8080

# Option B — full fidelity, includes the Worker + /api routes:
npm install -g wrangler        # one-time, if not installed
wrangler dev                   # uses wrangler.jsonc; serves _worker.js + assets
# then open the URL wrangler prints (usually http://localhost:8787)
```

- Use **Option B** whenever you're testing the AI coach or projections, since those need the Worker. You'll need `LLM_API_KEY` in your environment for the coach to return real responses (see §5); the rest of the app works without it.
- **Install command:** none required for the app itself; only `npm install -g wrangler` if you want the Worker locally.
- **Dev command:** `wrangler dev` (full) or `python3 -m http.server 8080` (frontend only).

### Editing & sanity-checking
Edit `index.html` directly (in Claude Code the old size constraints don't apply). The app script is plain pre-compiled JS now, so before deploying, **always confirm it still parses** — a single bad escape silently white-screens the app:

```bash
node -e 'const fs=require("fs");
const h=fs.readFileSync("index.html","utf8");
const m=h.match(/<script type="module">([\s\S]*?)<\/script>/);
new Function(m[1]);
console.log("PARSE OK");'
```

Also beware the escape-corruption bug class that has bitten this repo three times: a `\n` or `\b`
written into a file as the *literal control byte* instead of backslash-n / backslash-b (a regex
containing a real newline is a SyntaxError that kills the whole page's script; a real backspace
byte inside a regex silently never matches). If a regex looks right but a page is dead or a match
never fires, hexdump the line.

---

## 4. How it deploys to Cloudflare

- **Project type:** Cloudflare **Pages, advanced mode** (a single `_worker.js` handles both asset serving and the API). The `_worker.js` header and the `pages.dev` references confirm Pages; `wrangler.jsonc` also lets you deploy/run it Workers-style. Confirm which surface is wired in the dashboard the first time — they share the same `_worker.js`.
- **Cloudflare project name:** `iron-tuna` (from `wrangler.jsonc` `"name": "iron-tuna"`).
- **Deploy trigger:** pushing to `main` on GitHub. Cloudflare's Git integration rebuilds automatically (typically live within ~1 minute). *(Until now, commits were made via the GitHub web "upload file" UI because the sandbox had no push credentials. In Claude Code with your Git auth, just `git add/commit/push` — that's the intended path and it triggers the same deploy.)*
- **Build command:** none (static — leave blank).
- **Output / publish directory:** repository **root** (`.`). `wrangler.jsonc` sets `"assets": { "directory": ".", "binding": "ASSETS", "run_worker_first": true }`.
- **`.assetsignore`** keeps infra files (`_worker.js`, `wrangler.jsonc`, `.assetsignore`, etc.) from being served as public static assets.
- **`wrangler.jsonc`** (the build/runtime config):
  ```jsonc
  {
    "name": "iron-tuna",
    "main": "_worker.js",
    "compatibility_date": "2025-05-01",
    "assets": { "directory": ".", "binding": "ASSETS", "run_worker_first": true },
    "vars": { "LLM_PROVIDER": "anthropic", "LLM_MODEL": "claude-sonnet-4-6" }
  }
  ```
  Manual deploy alternative: `wrangler deploy`.

---

## 5. Environment variables & secrets

Set these in the **Cloudflare dashboard → the `iron-tuna` project → Settings → Environment variables / Secrets**. Non-secret defaults also live in `wrangler.jsonc` `vars`. **Names only below — values are not in the repo and must not be committed.**

| Name | Required | Secret? | Notes |
|---|---|---|---|
| `LLM_API_KEY` | **Yes** | **Yes (encrypt)** | Anthropic `sk-ant-…` or OpenAI `sk-…`. Powers `/api/coach`. The app runs without it, but the AI coach returns a "missing key" error. |
| `LLM_PROVIDER` | No | No | `"anthropic"` (current default, in `wrangler.jsonc`) or `"openai"`. |
| `LLM_MODEL` | No | No | Defaults to `claude-sonnet-4-6` (in `wrangler.jsonc`). |
| `ALLOWED_ORIGIN` | No | No | Comma-separated origins to lock the proxy to your site. |
| `LLM_ENDPOINT` | No | No | Override for an OpenAI-compatible endpoint. |
| `TURNSTILE_SECRET` | No | Yes | If set, `/api/coach` requires a Cloudflare Turnstile token. |
| `RATE_KV` | No | n/a (binding) | Optional KV namespace binding for per-IP rate limiting on the coach route. |
| `ODDS_API_KEY` | No | Yes | The Odds API key. **Optional upgrade only** — the Vegas blend runs without it on the free nflverse provider (§9b). Setting it adds per-player props on top. |

No `.env` file is used in production; everything is configured in Cloudflare. For local `wrangler dev`, export `LLM_API_KEY` in your shell or use a `.dev.vars` file (git-ignored).

---

## 6. Where the key markup lives (all in `index.html`)

- **Global CSS:** the single `<style>` block beginning at **line 35**. To add a stylesheet "after global CSS so its tokens win," append a second `<style>` (or a `<link>`) immediately after that block, or paste rules at its end.
- **Landing/hero component render:** around **line 2276** (`<div className="landing-splash landing-page …">`). The hero proper is `.lp-hero`; hero CSS is around lines **943–965**.
- **The three value boxes (market price / true value / your max bid):** these are the **PROJ / VALUE / YOU** columns, shown in the mock-screenshot `.lp-shot` block (`.lp-shot-row`, CSS lines **1015–1029**) and explained in the caption near **line 2333**.
- **Primary call-to-action button:** `.lp-cta` — "Get my auction values" at **line 2295** (CSS at line **959**).
- **App scoring/value engine:** functions `scorePlayer` / `scoreSkillPlayer` / `scoreKicker` / `scoreDefense`, plus `applyQbActuals` (remaps each position's projected line to last year's actual line **by projected rank**), `applyBaselineRankFixes`, and `applyCustomRanks`, all feeding the `baseValued` memo.
- **User state:** all per-user customization (ranks, price overrides, scoring config, targets) is stored in the browser's `localStorage` under `iron_tuna_draft_state_v2`. Nothing a user does on the site touches the repo or other users — see §7.

---

## 7. Half-finished / fragile things to know

- **Pending: "layered dark hero" treatment.** You asked to apply `irontuna-hero-dark.css` and add class hooks `it-hero` (hero container), `it-card` (three value boxes) + `it-card--accent` (true-value box only), and `it-btn` (primary CTA), with page background `#0a0b0d`. **This is not done** — the CSS file never made it through the upload, so no `it-*` classes exist yet. Re-attach the file to finish it. (Constraints you set: keep the glow subtle — don't raise alpha in `.it-hero::before` or the button shadow; keep the accent teal via `--it-accent-rgb`.)
- **In-browser Babel = silent failures.** A JSX typo or a stray `\u` escape in a **text node** (renders literally) will white-screen the whole app with no error. Always run the compile check in §3 before pushing. Note `\u` escapes resolve fine inside JS expressions but NOT in JSX text — use the real character there.
- **One giant file.** `index.html` holds the entire UI as JSX-in-a-script. It's ~553 KB / ~6,900 lines. Search by the line references in §6; consider it a candidate for future modularization, but the in-browser-Babel setup means there's no bundler to split it today.
- **Projections exist in two places.** Server-authoritative copy in `_worker.js` (`/api/projections`, obfuscated) and a client copy/remap in `index.html`. If you change projection numbers, check whether you need to update both.
- **Default-scoring changes only affect new/cleared users.** Because state is cached in `localStorage`, anyone with a saved session won't see changes to *default* scoring until they reset or clear storage.
- **Deploy latency.** After a push, Cloudflare takes up to ~a minute to rebuild; hard-refresh (or append `?v=…`) to bypass cache when verifying.

---

## 8. The 2026 Insights system (added July 2026)

The 220-insight research set (auction/snake/best ball) is split three ways and is **fully self-publishing** — no manual action needed for releases:

- **70 public** — pre-built as 42 static drop pages, one per format per date (`auction-insights-YYYY-MM-DD.html`, `snake-insights-…`, `bestball-insights-…`): July 4 launch, Thursdays in July, Mondays + Thursdays Aug 6 – Sep 3. The first four drops carry the hand-curated 20 strongest takes. Pages are article-style: no CTA above the content; the premium band sits at the bottom. `_worker.js` 302-redirects any future-dated drop page to its format index until **9:00am ET (13:00 UTC)** on its date (2026-07-04 is exempted as the launch drop), 301s legacy `/insights-YYYY-MM-DD` URLs to the auction edition, and filters unreleased URLs out of `sitemap.xml` on the fly. `/insights` is the format-chooser hub; `/auction-insights`, `/snake-insights`, `/bestball-insights` are the per-format indexes (future drops hidden client-side). Nothing to do on release days.
- **30 vault** — email-gated on `/insights-vault`. `POST /api/insights-vault` validates the email, stores it via `saveContact` (D1 `contacts`, source `insights-vault`, also fires `LEAD_WEBHOOK`), and returns the vault JSON. (Vault copy upgraded July 2026: each insight's auction/snake/best-ball action lines are now three genuinely format-specific calls instead of one repeated sentence, and all bodies are em-dash-free.) Emails export via the existing `/api/leads/export?key=…`.
- **150 premium** (complete: the original 120 plus 30 news-reactive additions authored July 2026 from the Auction Watch corpus) — embedded in `_worker.js` as `INSIGHTS_PREMIUM`, served XOR+base64 from `GET /api/insights` (same `IT_KEY`/referer pattern as `/api/projections`). Read UI: `/my-insights` (checks localStorage entitlements, falls back to `/api/auth/me`).

Regeneration pipeline (source docs → all pages/data) lives in the session scratchpad scripts `build_insights.py` + `gen_pages.py`; the partition (which insight is public/vault/premium and which drop date) is `insights_partition.json`. To add the next 30 insights: parse them with the same field schema, append to `INSIGHTS_PREMIUM` (or swap 10 into future drop pages), and refresh `_INS_ENC` is automatic (memo re-encodes per isolate).

## 9. Daily projections-update routine (added July 2026)

A scheduled Claude session runs daily to refresh player projections:

1. The agent fetches season-long projections from **ESPN, SportsLine, and NFL.com** and verifies each source's projections were published within the **preceding 7 days** (stale or undated sources are excluded).
2. Fresh sources are written to `tools/sources/<source>.json` (schema documented at the top of `tools/merge-projections.mjs`).
3. `node tools/merge-projections.mjs` merges them: multi-source stats are a **weighted average** (see §9a — Vegas defaults to weight 3, every projection feed to 1), players are matched by normalized name+position against the existing `PROJECTIONS` roster (no adds/removes), and hard sanity checks abort on any anomaly (count change, NaN, implausible leaders, <25 matches, worker parse failure). Zero fresh sources → exit 2, no changes.
**League tailoring:** the app persists a compact sheet snapshot to localStorage (`iron_tuna_values_v1`: name/pos/$value/points + teams/budget/format) whenever `baseValued` recomputes. `/my-insights` reads it and translates each premium insight's percentage effect into the buyer's units — auction: dollars against the player's sheet price; snake/best ball: draft slots (and rounds) by re-ranking the snapshot. No snapshot → generic percentages plus a set-up-your-league hint.

4. On success it bumps `PROJ_VERSION` in `index.html` (date-stamped). Users with saved state re-baseline on next load; users who **reordered rankings** get an in-app prompt — "Use updated rankings" (clears `rankOrder`) or "Keep my reorder" (overlay persists on the new numbers).
5. The agent commits and pushes to `main` (Cloudflare auto-deploys).

Fail-safe: if fetching is blocked (environment network policy) or all sources are stale, the day is skipped with no repo changes. `tools/` is in `.assetsignore` so it never serves publicly.

---

## 9a. Vegas-weighted projections (added August 2026)

Default projections are meant to follow the **betting market** first and the consensus projection feeds second. The betting market is the sharpest public forecast available: it is priced with real money, it moves on news within minutes, and season-long totals already price in injury/availability risk (the book pays on yards actually accumulated — so **do not haircut a Vegas number again for games missed**).

**Pipeline:** raw book lines → `tools/vegas-to-projections.mjs` → `tools/sources/vegas.json` → `tools/merge-projections.mjs` → `PROJECTIONS` in `_worker.js`.

1. Drop one JSON file per sportsbook into `tools/odds/` (gitignored). Shape is documented at the top of `tools/vegas-to-projections.mjs`; a committed sample lives in `tools/odds.example/`. Season-long markets recognised: `passYd passTD passInt rushYd rushTD recYd recTD rec scrimmageTD`.
2. `node tools/vegas-to-projections.mjs` converts them. Two corrections turn a posted total into a projection:
   - **De-vig.** Both sides carry juice, so raw implied probabilities sum to >1. Each side's American price is converted to a probability and the pair normalised to sum to 1, leaving the market's honest `P(over)`.
   - **Median → mean.** The line sits near the market's *median*; fantasy scoring needs the *mean*. Modelling a season total as roughly normal, `E[X] = line + σ·Φ⁻¹(P(over))`, with σ a per-market coefficient of variation × the line. At a balanced price the mean *is* the line, so the correction only bites when a book prices one side hard — which keeps the result robust to σ being somewhat off.
   
   Multiple books are de-vigged and converted **first**, then averaged, so a book with wide juice can't drag the consensus. A combined `scrimmageTD` market is split into `rushTD`/`recTD` using the player's *current* projected ratio rather than an invented split.
3. `node tools/merge-projections.mjs` blends by **weight**, not evenly. `DEFAULT_WEIGHTS = { vegas: 3 }`, everything else 1 — so with one projection feed a merged stat lands **75% of the way from the projection to the Vegas number**. Override per source with `SOURCE_WEIGHT_<NAME>` (e.g. `SOURCE_WEIGHT_VEGAS=5`, or `=1` to restore a plain mean).

**Coverage is per stat, not per player.** Only the sources that actually carry a stat appear in its average, so a stat no book prices (`passInt`, kicker and DEF lines, deep bench players) keeps its existing projection-feed blend untouched. That is deliberate, but it means a player can end up with Vegas yardage next to projection-fed TDs — worth remembering when a line looks internally odd.

`node tools/test-vegas.mjs` covers the de-vig/probit/mean math, the TD split, and an end-to-end weighted merge against a scratch copy of the worker. Run it after touching either tool.

This offline path is the manual fallback. The **live** path is §9b, and it is the one that runs in production.

## 9b. Worker-side odds refresh (added August 2026)

The site pulls its own odds. The daily-update sandbox blocks every sportsbook host, but the Worker runs on Cloudflare's edge where outbound `fetch` is unrestricted, so the pull lives in `_worker.js`, not in `tools/`.

**Shape:** a `0 11 * * *` cron calls `runOddsRefresh(env)` → provider fetch → convert → match against `PROJECTIONS` → store the overlay in D1 (`odds_overlay`, created lazily on `LEADS_DB`). `/api/projections` calls `projectionsPayload(env)`, which reads that one cached row and serves `blendProjections(overlay)` at 3:1. **Requests never touch a data provider** — only the cron does.

### Providers

Providers run in priority order and their overlays are **merged, earlier wins per player+stat** — so a real player prop is never overwritten by the coarser team-wide inference behind it.

| Provider | Needs | What it gives |
|---|---|---|
| `the-odds-api` | `ODDS_API_KEY` (paid tier) | Per-player season props. Optional upgrade. |
| **`nflverse`** | **nothing** | **Game lines → team scoring environment. This is the one that actually runs.** |

**nflverse is free, keyless, and CC BY 4.0** (attribution only — credited in the `front.html` footer; keep that credit if you keep the data). It is fetched from a GitHub release asset, so no sportsbook ToS is involved: DraftKings' internal JSON is keyless too but their terms prohibit automated access, which is why it is not used here.

### Turning game lines into stat adjustments

`games.csv` carries a spread and a total per game, not player props. The pair implies each side's expected points — `home = total/2 + spread/2`, `away = total/2 - spread/2` — which is the scoring environment every skill player on that roster inherits.

Two things keep that honest:

- **No double counting.** The committed projections already have an opinion about which offenses are good, so scaling by raw Vegas points would apply that opinion twice. Both sides are reduced to a league-relative index and the factor is the **ratio of the two**: when Vegas and the projections agree on a team's standing the factor is exactly 1.0 and nothing moves. Only genuine disagreement changes a number.
- **Same units on both sides — points, not touchdowns.** Team offensive points are `(passTD + rushTD) * 6 + xpMade + fgMade * 3`; `recTD` is excluded because a receiving touchdown *is* the quarterback's passing touchdown. Comparing a touchdown index against Vegas points systematically over-corrects, since weak offenses take a larger share of their points from field goals: on the real 2026 lines that mismatch stretched the factor range to 0.57 and pushed Miami to 1.33, versus 0.40 and 1.15 once both sides are points.

The factor hits touchdowns at full strength and yardage damped (`TEAMENV_YARD_EXP = 0.5`), because yards track scoring environment far less tightly than touchdowns do — a judgement call, not a fit. Receptions, interceptions and fumbles are left alone. Every factor is clamped to `TEAMENV_CLAMP` (0.85–1.18) so a bad pull cannot rewrite a roster, and a team with fewer than `TEAMENV_MIN_GAMES` priced games is skipped entirely.

**Known limitation:** this is a team-wide signal, so it moves every player on a roster in the same direction. It cannot tell you that one receiver specifically is being underrated — that needs player props, i.e. `ODDS_API_KEY`. Free season-long *player* props do not appear to exist.

### Fail-safe by construction

Every step may fail and the endpoint falls back to the committed `PROJECTIONS`. A provider error, an unparseable response, a name matching no player or two players, a line outside the plausibility band (`ODDS_BANDS`), fewer than `ODDS_MIN_MATCHED` (25) players matched, or an overlay older than 14 days all mean *no overlay is written or used*, never *bad numbers are served*. A thin pull leaves the previous good overlay in place.

### Inspecting and testing

`GET /api/admin/odds-status?key=$LEADS_EXPORT_KEY` reports which providers are configured, the cached overlay's age and match count, and whether the site is serving blended or committed numbers. `&refresh=1` runs the pull immediately; `&sample=1` shows before/after stat lines for the first dozen changed players.

`node tools/test-worker-odds.mjs` lifts the Vegas section out of `_worker.js`, runs it against stub *and* real projections, asserts the worker's odds math still agrees with `tools/vegas-to-projections.mjs` (they are hand-synced — there is no build step), and **pulls the live nflverse file** so the provider is exercised against real data. `node tools/test-vegas.mjs` covers the offline path. Run both after touching either.

**One decimal everywhere.** Expected touchdowns are expectations, not counts — `28.5` is a more honest projection than `28`, and `merge-projections.mjs` already keeps a decimal for these stats. Forcing integers silently erased small adjustments (a 1.18 factor on a 1-TD player rounds straight back to 1).

## 9c. "Vegas vs. Rankings & ADP" column (added August 2026)

A recurring front-page column at `#vegas`, between Position Intel and Asset Allocation. **Thesis:** a sportsbook has money at risk on every number it prints, so its lines are priced off repeatable trends and statistical modelling and corrected in public the moment they are wrong; a ranking carries no such penalty, and anyone with a TikTok account and a hunch can publish a top 200 and never revisit it. Where a priced market and an unpriced list disagree, the column shows the disagreement — it never asserts the book is right.

**The point of the section is what the site does differently:** Iron Tuna's shipped values are already blended toward the market (§9b), and almost no ranking or ADP list is. So a case is not "the odds versus Iron Tuna" — it is *the consensus versus Iron Tuna*, with the odds as the reason they differ.

Left panel is evergreen (the thesis plus four rules for turning odds into an edge). Right panel is the **case**, and it rotates every six hours.

### The cases are computed, not written

`GET /api/vegas-column` (public, read-only, 15-minute isolate cache) reads the same D1 overlay the projections blend uses and calls `buildVegasColumn()`, which:

1. scores every QB/RB/WR/TE on **three** boards — `consensus` (committed `PROJECTIONS`, odds-blind: what a normal ranking or ADP list is built on), `ironTuna` (the same projections blended at `VEGAS_WEIGHT`, i.e. exactly what the site ships and the reader can look up), and `market` (the odds alone, undiluted);
2. ranks each position under all three and prices the consensus and Iron Tuna ranks through the same curve the client uses. **The headline gap is consensus → Iron Tuna**, because that is the number a reader can act on; the raw market rank is quoted in the evidence line as the underlying signal, never as the price;
3. drops anything under the noise floors (`COLUMN_MIN_RANK_GAP` 2 slots, `COLUMN_MIN_PRICE_GAP` $2) or outside the draftable curve, sorts by dollar gap, and returns the top `COLUMN_MAX_ITEMS` (12).

Players the market never priced are **not** items but still occupy slots on all three boards — when the odds push one player up, someone else goes down, and hiding that would overstate the gap for whoever moved.

### Agreement cases are a fallback

When conflicts do not fill the twelve slots, up to `COLUMN_MAX_AGREE` (3) **agreement** cases fill the remainder: players the market genuinely priced (`moved` non-empty) that landed on the *same* slot as the consensus, inside `COLUMN_AGREE_MAX_RANK` (24) so it is a player people actually draft — "the odds agree the WR61 is the WR61" says nothing. They are sorted by price, expensive end first, carry `kind: 'agree'`, and the card states plainly that this is confirmation rather than an edge. They never displace a conflict and never lead. Right now the real board produces a full twelve conflicts, so none appear; expect them later in the season as the projections and the market converge.

**Nothing on this section is hand-authored copy.** It cannot go stale while the lines move and it cannot claim a disagreement the data does not contain. When there is no usable overlay the card says exactly that instead of inventing a case.

### Two honesty constraints that are load-bearing

- **Game lines are not player props.** The free `nflverse` provider prices *games*; real player props need `ODDS_API_KEY`. The response carries `basis: 'gamelines' | 'props'` and the card's footer states which, plus "team-level signal — it prices the offense, not the individual target share". Presenting a team-wide inference as a prop would be the exact sloppiness the column exists to call out.
- **Team rank alone misleads.** The team-environment factor is a *ratio* of Vegas's league-relative standing to the projections', so a top-five offense can still be a downgrade if the consensus already has it top three. Every item therefore carries **both** `teamRank` (odds) and `teamRankConsensus` (from `_colTeamProjRank()`), and the card always states the pair. Brock Purdy is the live example: San Francisco is 4th in implied points and still a fade, because the consensus has them 3rd.

### The response is versioned, and that is not optional

`/api/vegas-column` is cached publicly for 15 minutes. The first contract change shipped without a version and readers saw **"QBundefined"** and **"pass TD NaN"** for a quarter of an hour: new HTML met an old cached payload whose fields had been renamed, and the fields that happened to keep their names (`rankMarket`, `priceDelta`) rendered fine, which is what made it look like a data bug rather than a cache-skew one.

Two mechanisms now prevent it, and **both** are needed:
- `COLUMN_CONTRACT` is echoed in the response and requested by the client as `?v=N`, so a page and a payload of different vintages can never meet — the cached copies are keyed apart, in the isolate (`_COLUMN_KEY`) and at the edge (distinct URL).
- The client drops any payload whose `contract` is not its own, and drops any individual item missing a field it prints (`VS_REQUIRED` / `vsUsable`). An unrecognised shape renders the empty state.

**Bump `COLUMN_CONTRACT` and `VS_CONTRACT` together on any change to the item shape.** `node render-check` (scratch harness) has a `stale` mode that replays the exact production failure. `node tools/test-it-league.mjs` asserts the two numbers match, so a one-sided bump fails a test instead of a reader's page. **Contract 3** added `statsConsensus` / `statsIronTuna` / `statsMarket` to every item — see §9f.

### Cadence

Six-hour wall-clock slots (00/06/12/18 UTC), same mechanism and the same phase shift as the front-page lead — six-hour slots divide evenly into the day, so without `+ floor(slot / n)` a reader who always checks at the same hour would be stuck on a fraction of the cases forever. Arrows and dots browse by hand and **pin** the rotation. `oddsCtxWrite()` stores the implied points per team as row 2 of `odds_overlay` on each refresh (no migration: same table, same lifecycle).

**This column does not post to X or Threads.** It refreshes on the site every six hours; the social rotation is still the three weekday slots in §10, untouched.

### Maintenance

`_colBlendStats` is **hand-synced with `blendProjections`** — if the blend weight or shape changes, the column stops quoting the number the cheat sheet shows. `COLUMN_SCORING`, `COLUMN_CURVE`, `COLUMN_CURVE_BUDGET`, `COLUMN_LEAGUE_BUDGET` and `_colScore` are **hand-synced with `index.html`** (`DEFAULT_LEAGUE_CONFIG.scoring`, `LEAGUE_MARKET_CURVE`, `LEAGUE_CURVE_BUDGET`, `scoreSkillPlayer`) — there is no build step. `_colTeamProjRank()` is hand-synced with `buildTeamEnvOverlay`'s points model. **`node tools/test-worker-column.mjs` lifts both copies out of their real files and fails loudly on drift**, runs the client's own `scoreSkillPlayer` head-to-head against the worker's port over every real player, and finishes against the live nflverse pull. Run it after touching scoring, the curve, or the odds section.

## 9d. The You column and the optimiser window (fixed August 2026)

`You` (max bid) comes from `personalValue`, built in `_basePersonalized` in `index.html`. Personal value is `switchPrice()` — how many starter points a player actually adds to *your* lineup — and that is a plan rebuild per player, so it is only run for a `relevant` set: plan targets, your stars, and **the top 20 at each position**.

**The bug:** everyone below that window fell straight back to `auctionValue`, which is the VALUE column. So `You` decayed all the way down the board and then **jumped back up at rank 21**, and the sheet priced WR21 above WR16 for no reason other than being outside the window. A cutoff in an internal optimisation was visible in a published price.

**The fix:** the window's own discount is carried past its edge. Per position, the median `personalValue / auctionValue` ratio over the cheapest five players the optimiser *did* price sets the slope for everyone below, and nobody outside the window may exceed the cheapest player inside it (`_edge[pos].cap`) — so the seam can never step up. The median rather than the single last player, so one odd line cannot set the slope for a whole tail.

**What is NOT a bug, and should not be "fixed" by flattening it:**
- **The steep decline inside the window.** `switchPrice` is a *marginal* value: once your starters are covered by better players, the next one at that position genuinely adds almost nothing, so RB17 → RB20 falling $11 → $2 is the model working. Change it by changing allocation/strategy, not by smoothing the output.
- **The flat tail.** Below the window everyone sits at or under the cheapest in-window price, which is often the min bid. That is the same statement: they are worth a dollar to *you*, whatever their VALUE says.
- **Small inversions inside the window.** `switchPrice` can rate a lower-VALUE player $1 higher because he fits the lineup better (currently Higgins $17 over Pickens $16 at WR16/17). That is real signal, not an artifact.

`node tools/test-you-column.mjs` drives the real app in Chromium and asserts PROJ and VALUE never rise down the board, that `You` does not jump at the rank-20 seam, and that nobody outside the window is priced at full VALUE. **It fails on the pre-fix code** — verified by reverting. It needs `playwright-core`, `react` and `react-dom` resolvable plus a Chromium binary, and skips cleanly when they are absent.

## 9e. The PROJ column and the frozen curve slots (fixed August 2026)

`Proj` (likely price) is `marketValue`, built by `calculateMarketValues` in `index.html`: it reads a player's rank at his position and hands him that slot of the hardcoded `LEAGUE_MARKET_CURVE`, scaled to the league's budget. It is a curve, not a market (see the two caveats at the end of §15) — so the one thing it has to get right is the *order*.

**The bug:** the slot was frozen. A `marketAnchors` map was seeded the first time a profile priced the board and then persisted with the draft state forever, and `calculateMarketValues` read `anchors[p.id]` as the slot. Nothing ever invalidated it. So when the projection pool was refreshed — a `PROJ_VERSION` bump, a CSV import, a scoring change — the board re-ordered and the prices did not, and Proj was pinned to a ranking that no longer existed. Read down the cheat sheet and the price column *climbed*: RB11 at $26 above RB10 at $15, McBride above Bowers at TE, Hurts above Burrow at QB. Worse, a player the map did not name — anyone whose id changed with a team move, since ids are `Name-POS-TEAM` — fell back to his live rank and landed on a slot an anchored player already held, so two players shared one price and another price vanished from the curve.

It did not stop at the price column. `buildOptimalPlan` prices every candidate off `marketValue`, so the plan spent its budget against the stale curve and handed the distortion straight back out as `You` — which is why the sheet also showed You climbing at RB13 → RB16 while VALUE, the one dollar column that never touches `marketValue`, stayed clean.

The anchor existed for one legitimate reason, stated in its own comment: a user's drag-to-rerank is his opinion of a player, not the room's, so it must not move what the room is expected to pay. That is real, and it survives the fix — but it never needed a frozen map, only the *uncustomized* ordering.

**The fix:** `marketCurveOrder(scored)` derives the slots in `baseValued` from the projections **before** `applyCustomRanks`, every render. A reorder still never bakes into Proj; a projection update now re-prices the board instead of leaving it stale. `marketAnchors` is gone from the state, the persisted payload and Reset Cheat Sheet. `calculateMarketValues` also hands slots out **in order** rather than reading the map as an index, so an id it does not name can no longer collide with one it does — the mapping is a bijection, one player per slot, no gaps. This also puts the app back in agreement with `/api/vegas-column` and `it-league.js`, which have always priced off live rank.

`node tools/test-market-anchors.mjs` drives the real app in Chromium across a projection update: it loads a fresh profile on one pool, stamps the saved state with an older `projVersion`, serves a refreshed pool, and asserts PROJ, VALUE and You never rise down the board — then reloads with the same pool and no saved state and asserts **the returning user's prices match the new user's row for row**. That last check is the invariant the anchor broke. **It fails on the pre-fix code** — verified by reverting. Same dependencies and the same clean skip as `test-you-column.mjs`.

`tools/test-you-column.mjs` could never have caught this: it only ever loads a fresh profile, where the anchors were seeded from the very pool being shown. Anything that depends on saved state needs a test that *has* saved state.

## 9f. The reader's own league, on every page that prints a number (added August 2026)

A story that quotes a price or a points total is quoting a *league*. Left alone, every one of them quoted the site's default — 12 teams, $200, full PPR — which is the wrong league for most readers: a $300 budget re-prices the entire board, half-PPR or six-point passing TDs re-order it. `/it-league.js` is the one place that knows what the reader actually plays, and the news pages read their numbers through it.

### Where the league comes from

Two keys, both written by the draft app on the same origin, neither of them new:

- `iron_tuna_draft_state_v2` → `config`: teams, budget, format and the full custom scoring. The authority.
- `iron_tuna_values_v1`: a snapshot of the reader's own board — every player's value and projected points **at those settings**. This is what makes a *rank* personal. Without it the library can still re-score and re-price; it just cannot re-rank, and it says so rather than guessing.

**With no saved league every accessor that speaks for the reader still reports "no league"** — `has`, `hasBoard`, `rankOf`, `findPlayer`. A reader who has never opened the app must not be shown numbers dressed up as theirs. A saved league that matches the site defaults in every respect is likewise left alone (`custom === false`): a "Your league" badge on identical numbers only teaches people to ignore the badge.

What that reader *is* shown is the **site's own board** — see "The default board" below. Labelled as the site's, never as theirs.

`custom` splits into `customScoring` (the scoring fields differ) and `customLeague` (teams or budget differ), because a story can honour one without the other — points move with scoring, prices move with the budget.

### What each page does with it

- **`/` (front.html), the Vegas column.** `myCase()` re-reads the whole card: points re-scored from the shipped stat lines, prices off the market curve at the reader's `teams × budget`, ranks off their own board. The kicker gains a **Your league** badge and the basis line names the league and the scoring. A reader with no league keeps the old card plus one line inviting them to set one.
- **`/` story cards and the lead.** `ITLeague.tailor()` turns an editorial `+12% to +18% versus price` into the reader's own dollars (or, in a snake/best-ball league, draft slots) — through the reading lens below, which the Position Intel switch controls.
- **Insight drop pages** (`auction|snake|bestball-insights-YYYY-MM-DD.html`). The library's own `tailorStatlines()` pass finds every `p.statline`, reads the call's `<h2>` for a player it recognises, and appends one `.it-yours` line. Pages opt in with nothing but the `<script src="/it-league.js" defer>` tag.
- **`/my-insights` and `/insights-vault`.** Both now call `ITLeague.tailor()` instead of carrying their own copy of the maths — `my-insights.html` had a duplicate, which is exactly how two pages start quoting different dollars for the same call.
- **`/auction-budget-allocation`.** Declarative only: `data-it-money="200"`, `data-it-teams="12"` and `data-it-pct="38-42"` restate the sentence in the reader's league and print what each allocation band actually buys.

### The default board, for a reader who has not got one

`it-league.js` carries a generated block, `DEFAULT_BOARD_RAW` — one `name|POS|points` line per skill player, scored at `SCORING_DEFAULTS` from the same `PROJECTIONS` the worker serves, ~8KB on one line (the same convention as `front.html`'s generated `STORIES`). Prices are **not** stored: the library reads the market curve at each player's positional rank, scaled to 12 × $200, which is the app's own `calculateMarketValues` recipe. Players the projections do not score (a free agent with an empty stat line, a backup under the passing-yard threshold) are dropped — they cannot be moved up or down anything.

Regenerate with **`node tools/build-default-board.mjs`** after `merge-projections.mjs` changes the worker's `PROJECTIONS`. `tools/test-it-league.mjs` regenerates the block and compares, so a forgotten run fails a test instead of quoting a reader last month's projections.

**A reader with no saved league gets all three readings in one line**, because there is no way to know which they came for and guessing one would be worse than printing both:

> **Default league:** Drake London prices at $40 in a 12-team, $200 league — worth about $3–$5, 2% of a budget, or 6–10 draft slots (about half a round).

The percentage is the durable half: a dollar figure is only true at $200, but "2% of a budget" is true in every auction league there is. It is computed from the raw share rather than the rounded dollars, so the two cannot disagree at a rounding boundary. `ITLeague.tailorLabel()` returns `Your league` or `Default league` — a page must never hard-code the first, which is the one lie this whole mechanism exists to avoid.

### A draft slot is a pick, not a points gap

`slotsMoved()` used to count every player of **any** position whose raw points fell between the old and new totals. Raw fantasy points do not compare across positions — a 300-point QB and a 300-point WR are not adjacent picks — so a routine +15% on a receiver was reported as a **25-slot move**, most of it quarterbacks he would never be drafted against. It now finds the player at his **own** position he leapfrogs (points compare fine inside a position) and measures the distance to that player on the **value-ordered** board, which is the real draft order.

Below roughly the last 1.5% of a budget the board stops being an order at all — fifty players tie at $1–$2, and the gap between two of them is an artefact of the tie-break. Moves in and out of that tier are described (`a slide into $1–$3 endgame territory`) rather than counted, because a slot count there would be precision the number does not have.

### The reading lens: dollars or draft slots

Every tailored line has to commit to a draft type before it can say anything useful, and the page must never guess. `ITLeague.readingFormat()` answers it in one order, always:

1. the reader's own switch, if they have thrown one (`iron_tuna_reading_format_v1`);
2. the format on their saved league — an auction league gets dollars, a snake or best-ball league gets slots, without anyone being asked;
3. **auction**, where nothing is saved. This is an auction site and its copy is written that way, so an unset reader is never shown draft-slot advice by accident.

`setReadingFormat()` writes the choice back, so it holds on **every** page the library runs on — Position Intel, the front-page lead, and `tailorStatlines()` on the drop pages. Two lenses, not three: best ball *is* a draft, so it reads in slots, and `label()` still names the league honestly underneath ("your 12-team best ball").

**A borrowed lens is never called their league.** `label(fmt)` says "your 10-team snake draft" when the lens matches what they saved and "**a** 10-team, $300 auction" when it does not — a snake-league reader who asked for the auction read is owed a true sentence, not a flattering one.

**Superseded, August 2026 — see §22.** The lens no longer has a control of its own. The front page's ribbon carries an **edition** switch instead (Auction Draft / Snake Draft / Best Ball, `#edSwitch` in `front.html`), every reader gets it, and `setEdition()` sets the lens underneath — so the lens is now a consequence of the edition rather than a second question. The old `#posFmt` switch is gone: it only appeared for a reader with a saved board, and two controls that can disagree about the same question are worse than one that cannot. Everything above about `readingFormat()` still holds; only the control moved. `node tools/test-position-lens.mjs` drives the ribbon switch in Chromium (skips cleanly without playwright-core or a Chromium binary); `tools/test-it-league.mjs` covers the ordering, the copy and the front page's two `tailor()` call sites.

### Money has two scales, and mixing them is the easy mistake

`price(pos, rank)` scales the curve by **`teams × budget`** — more teams means more money chasing the same players, which is what the app's `calculateMarketValues` does. `money(n)` scales editorial prose by **budget alone**, because "how to spend the $200" is about one manager's wallet and a 10-team league does not shrink it. Both are asserted in the tests.

### Why the API ships stat lines

Points are a pure function of a stat line and a scoring system, so shipping the line lets a **publicly cached** payload produce a **private** answer — the worker never learns anything about the reader. That is why contract 3 added `statsConsensus`, `statsIronTuna` and `statsMarket` to each column item rather than adding a per-league endpoint.

Ranks are the exception: they need the whole pool, which only the reader's saved board has. When the board is missing the site's ranks stand and only the money moves. When it is present, the player's own row calibrates the scale (the board carries the app's season normalisation and any per-player shaping baked into its points), and the identical adjustment is applied to both boards, so the gap between them stays exactly what the odds put there.

### Maintenance

`it-league.js` carries a **hand-synced** copy of `DEFAULT_LEAGUE_CONFIG.scoring`, `LEAGUE_MARKET_CURVE`, `LEAGUE_CURVE_BUDGET` and `scoreSkillPlayer` — same arrangement, and same risk, as `_worker.js`'s column copies. There is no build step. **`node tools/test-it-league.mjs`** lifts all three copies out of their real files, runs the client's own `scoreSkillPlayer` head-to-head against the library over every real projection, rebuilds a real column with the real worker and asserts the library reproduces its printed points and prices *to the digit* at the site defaults, and runs `front.html`'s own `myCase` as shipped. Run it after touching scoring, the curve, the column's item shape, or the library. **`node tools/test-position-lens.mjs`** covers the reading-lens switch and the default-board line end to end in a real browser. **`node tools/build-default-board.mjs`** regenerates the default board.

## 9g. Comping access from a URL, and from /admin (added August 2026)

Two admin routes hand out and pull paid access for one address, behind the same `LEADS_EXPORT_KEY` gate as every other admin route:

```
GET /api/admin/grant?key=<LEADS_EXPORT_KEY>&email=<address>
GET /api/admin/revoke?key=<LEADS_EXPORT_KEY>&email=<address>
```

The alternative was `wrangler d1 execute --remote` with a hand-written INSERT, which cannot be run from a phone and is the wrong shape for something done repeatedly. GET, matching `/api/admin/x-post-now` and `/api/admin/x-delete`, so it works from a browser address bar. Both directions are reversible — grant is undone by revoke, revoke by grant (they sign in again) — so neither carries a confirmation step that would defeat the point.

**After a grant, the person signs in at `/auctiondraft?signin=1`** with that address; the response hands back that URL so it can be pasted straight into a message. **Order matters:** `/api/auth/request` only sends a magic link to an address that is *already* entitled, and returns `ok:true` either way, so an early sign-in attempt looks like a silently broken login rather than a missing grant.

Details worth knowing:
- The address is lowercased before the write, because `isEntitled` looks it up as it appears in the session and every path that creates one lowercases it. A mixed-case row would never match.
- `revoke` delegates to `revokeEntitlement()` rather than re-implementing its deletes, so the definition of "revoked" stays in one place — it clears the entitlement **and every session**, since leaving a session behind signs nobody out.
- `changed` distinguishes a real change from a no-op, so a double-tap on a phone reads honestly.
- **The comped-in-code trap:** `COMPED_EMAILS` (module scope in `_worker.js`) always has access, so a `revoke` on one of those addresses looks like it worked and does nothing. The response says `STILL HAS ACCESS` and names the fix. That list is for **owner access only** — to comp anyone else use `grant`, because a third party's address does not belong in a source file and git history keeps it forever.

`node --experimental-sqlite tools/test-admin-grant.mjs` imports the worker module and drives the real routes against a real SQLite database via `node:sqlite` — the key gate, malformed addresses, lowercase normalisation, idempotency, session clearing, and the comped-in-code case. It does **not** use `wrangler dev`, which needs to reach Cloudflare for the `Request.cf` object and cannot run offline.

### Grant *and* send the link, in one step

`grant` leaves the second half of the job to a human: tell the person to go to `/auctiondraft?signin=1` and ask for a link. That step is where the flow breaks, because `/api/auth/request` answers `ok:true` whether or not it sent anything — a typo'd address, an address that was never granted and a working one all look identical from the outside. So there is a route that does both:

```
GET /api/admin/comp?key=<LEADS_EXPORT_KEY>&email=<address>[&days=14][&send=0]
```

It grants, mints the magic link itself, emails it, and reports **what actually happened**: `sent`, `emailError`, `changed`, `expiresAt`, and the `link` itself. **/admin drives this from a form** — the "Free access" card at the top of the dashboard — which is the intended way to use it; the GET shape is kept so it still works from a phone's address bar.

- **The link is always returned**, sent or not, so a refused email never leaves you with nothing to pass on. `send=0` grants and hands back the link without emailing, for pasting into a DM.
- **Access is granted first, then the link is minted** — the same ordering constraint as above, enforced in one request instead of trusted to whoever is doing it.
- **The grant is confirmed by reading access back**, not assumed: `grantEntitlement()` swallows its own errors, and mailing a sign-in link to an address that is not entitled would sign someone in to the free site.
- **A failed send is not a failed grant.** Resend refusing the message (unverified domain, no `RESEND_API_KEY`) still leaves the access in place; the response says `sent:false` with the reason, and `/admin` colours that result as a failure rather than a success.
- **The nonce write is not best-effort.** `/api/auth/verify` only enforces single use when `RATE_KV` is bound, and it is the same env — so if that `put` fails while KV *is* bound, the link would arrive already "used". The route refuses (`link_store_failed`) and sends nothing rather than mailing a dead link.
- **`days`** (1–90, default 14) sets how long the link stays good. It is the *link* that expires, not the access — after that they sign in normally at `/auctiondraft?signin=1`, and the comp email says so.
- The email is deliberately **not** `sendLoginEmail`. That one says "unlock your purchase", which is the wrong sentence for someone who never bought anything, and it swallows every failure.

`node tools/test-admin-comp.mjs` covers the gate, the validation, the mail-shim assertions, every "looks like success and is not" case above — and follows the link the route emits all the way through `/api/auth/verify` to `/api/auth/me`, because a link that does not actually sign anyone in is the whole failure this route exists to prevent. It also asserts `admin.html` still sends the parameters the route reads, since the page is hand-written and a renamed parameter would only show up as a form that silently 400s. Both this and the grant suite run in CI, along with a parse check on `admin.html`'s scripts.

## 9h. What a quarterback costs (re-cut August 2026)

`LEAGUE_MARKET_CURVE.QB` was drawn from historical auction spending, and it was too rich for a 1-QB room. It put QB1 level with RB1 (both about $40 on a $120-a-team board) and kept quarterbacks in double digits down to QB9.

**Why that was wrong:** the position is flat. On the current projections QB1 to QB9 is about three points a game — Allen 21.0, Nix 18.0 — so a room that only has to start one stops paying up almost immediately. Historical spend is a record of scarcity that no longer exists; the number of startable quarterbacks is what sets the price, and there are more of them than the old curve assumed.

**The re-cut**, stated on the same $120-a-team board the owner reads: QB1 lands high-20s (Allen $29, was $40), QB6 is the last double-digit quarterback ($12), and QB7 down is single digits (was $10 on a clean board and $23 on a stale-anchored one — see §9e). Everything else on the board rises a little: the QB dollars have to go somewhere, and they go to the 144 rostered skill players, which is what the room actually does.

The curve is not the price. `renormalizeToBudget` scales `marketValue` so the rostered players' prices spend the whole pool, which is why cutting the QB row needs no compensating rise anywhere else — the redistribution is automatic, and it is why a $25 curve slot prints as $29 on a $120 board. It is also why the cut has to be calibrated against what comes OUT of the app rather than against the array: the first draft of this curve was written to land Allen at $29 and, once renormalised, printed $32.

**Calibrated against VALUE, the app's own second opinion.** VALUE is VORP-based and never touches `marketValue`, so the ratio between the two columns says whether the curve is asking a sane premium. Over the top 14 at each position, before this PR and after:

| | before | after |
|---|---|---|
| QB | 2.13x | **1.19x** |
| RB | 0.91x | 1.01x |
| WR | 0.94x | 1.04x |
| TE | 0.96x | 1.06x |

QB was asking more than double what the position was worth while every other position sat within a few points of parity. 1.19x is a real premium — rooms do overpay for quarterbacks — rather than a defect.

    QB: [25, 20, 17, 14, 11, 10, 7, 5, 4, 4, 3, 3, 2, 2, 1, 1]   // was [39, 35, 30, 28, 25, 22, 18, 15, 10, 8, 8, 5, 3, 2, 2, 2]

**The premium curve is opt-in; 1-QB is the default and the fallback.** `qbIsPremium(config)` is true only when a QB can fill a second *starting* slot: QB in the flex **with a flex slot to put him in**, or two QB starters. Nothing infers it — the only things that produce either shape are the QB-format control (1 QB / 2 QB / Superflex) and a league import that finds a `SUPER_FLEX` slot. `DEFAULT_LEAGUE_CONFIG` and `BESTBALL_FLEX` both ship `eligible: ["RB", "WR", "TE"]` with one QB starter, so an untouched league is priced 1-QB.

Counting the flex slot rather than reading the eligibility list matters. `calculateReplacementLevels` hands out `flex.count * teams` flex slots, so a league with QB listed as eligible and a flex count of zero gets no share of them and VALUE prices it as 1-QB. Reading the list alone put PROJ on the premium curve for that same league — Allen $68 against a VALUE built for a $49 board — so the two columns described different leagues. A saved state can hold that shape, and so can setting superflex and then stepping the flex count down to zero.

**Superflex and 2-QB keep the old curve.** The whole argument above is a 1-QB argument; with two QB slots to fill, 24+ quarterbacks get rostered and the position genuinely is scarce. The historical curve is preserved verbatim as `SUPERFLEX_QB_CURVE` and `calculateMarketValues` picks it whenever `qbIsPremium(config)` — QB in the flex, or two QB starters. So the cut can never make a superflex board cheaper at the position. `SUPERFLEX_QB_CURVE` is declared **above** `const LEAGUE_MARKET_CURVE` on purpose: the drift checks in `test-worker-column.mjs` and `test-it-league.mjs` read the first `QB: [...]` *after* that marker, and the worker and the library both price the site's default 1-QB league.

Still open, and pre-existing: `Proj` is the only QB number that reacts to superflex through a separate curve. `it-league.js` prices the news pages off the 1-QB curve whatever league the reader has saved, and the superflex curve itself is still a 1-QB shape (QB1 below RB1), which is too cheap for a real superflex room. VALUE and You *do* re-price properly, through the replacement level. If superflex pricing gets a proper pass, that is the thing to fix.

`node tools/test-qb-curve.mjs` walks five league shapes — default, explicit 1-QB, superflex, 2-QB, and QB-eligible-with-no-flex-slot — each from a **cleared profile**, because the mutations otherwise stack and every board after the first describes a league no scenario asked for. It asserts the two 1-QB-equivalent leagues price QBs *identically to the untouched default*, not merely cheaply, and that both real two-QB-slot leagues cost more at QB1 and QB7. It also states the 1-QB shape against RB1 rather than in dollars, so that part holds at any league size: QB1 at most three quarters of RB1, QB7 under a quarter of RB1, the QB1→QB7 drop steeper than RB1→RB7, and superflex strictly more expensive than 1-QB at both QB1 and QB7. **It fails on the pre-cut curve** — verified by reverting. Remember the two mirrors: `COLUMN_CURVE` in `_worker.js` and `CURVE` in `it-league.js` both carry the 1-QB QB row, and `test-worker-column.mjs` / `test-it-league.mjs` fail loudly if they drift.

## 9i. The reader's own projections/odds blend (added August 2026)

The board is shipped **75% of the way toward the sportsbook** (§9a, §9b) — that is our editorial call, and it is not every reader's. Some trust the consensus feeds and want the odds out of it; some want the book and nothing else. The **Projections vs Vegas** slider in the Draft Models panel (`CheatHeader` in `index.html`, directly under Starters vs Depth) hands that call to the reader, anywhere from "ignore the odds" to "follow the book".

**It re-cuts a blend the server already made, from the endpoints — never from the shipped number.** `blendProjections` ships `projectedStats` already blended and `vegas[k] = [committed, marketImplied, blended]`. That third value is itself a point on the line between the first two, so blending *off* it would compound the default weighting instead of replacing it. `applyVegasWeight(players, w)` interpolates between slots 0 and 1, rewrites slot 2 to the new blend (so the `V` flag, the `▲3` rank chip and their tooltips keep describing the board on screen), and rounds exactly the way the worker's `_oddsRound` does — so `w = VEGAS_DEFAULT_W` reproduces the shipped numbers to the digit rather than off by a decimal. `VEGAS_DEFAULT_W` is `0.75`, declared above `DEFAULT_LEAGUE_CONFIG` because the config's `strategy.vegasWeight` default references it; `tools/test-vegas-weight.mjs` fails if it ever drifts from the worker's `VEGAS_WEIGHT`.

**It is applied before anything is scored** — in `baseValued`, ahead of `scorePlayer`, so one drag moves points, ranks, tiers, VALUE, You and every draft model together. Wiring it any later would move the `Proj` column and leave the rest of the board describing a projection nobody is looking at.

Three properties the control promises and the tests hold it to:

- **Only where they disagree.** Stats no book prices are passed through, and a player the book never priced is returned as the *same object*, so downstream memos stay valid. On screen he can still shift a hair, because `normalizeToLastYear` rescales the whole pool — that ripple is bounded in the browser test, not asserted away.
- **A hand-entered stat wins.** `handlePlayerEdit` drops the odds triple for any stat the reader typed over, so the slider cannot overwrite an edit the next time it moves.
- **It is undoable.** The `reset` link (shown only off-default) restores the shipped board exactly, not approximately.

Hidden entirely when no player in the pool carries odds — an inert control reads as a broken one.

**The reader has to actually have the odds, or the control is gone with no explanation.** A saved board is pinned to the pool it was saved from: while `initialState.projVersion === PROJ_VERSION` the app never re-fetches `/api/projections`. That is right for the projections, which only move on a version bump, and wrong for the odds, which the Worker refreshes daily (§9b) and which are simply **absent** from any pool fetched in a window where the D1 overlay was missing — a failed cron, or the self-heal running behind a response it is not allowed to delay. That reader keeps an odds-free board until the next version bump: no `V` flags, no rank chips, and no slider, because it hides itself. From the outside that reads as "the feature was removed".

So the load effect no longer short-circuits on `savedFresh` alone. When the saved pool is current but carries **no triples at all**, the baseline is still fetched and `graftVegasOdds(saved, baseline)` puts the odds back stat by stat: only a stat still sitting on the **committed endpoint** (`vegas[k][0]`) is moved to the shipped blend and given its triple, so a number the reader typed over or imported is left exactly where it is — the same promise `handlePlayerEdit` makes in the other direction. Matching is on normalised name + position, so a live-status team change does not lose the odds. The projections, `dataInfo` and `playersVersionRef` are untouched, nothing to graft returns the *same array* (the effect runs on every load for a reader whose board legitimately has no odds, and must not churn state), and a failed fetch on this path is silent — the saved board is current and usable, only the odds are missing. A pool the reader replaced themselves (`dataInfo.source` of `CSV import` or `Live NFL`) is skipped entirely: that is their board, not ours.

`node tools/test-vegas-weight.mjs` pins the math, the clamping, the hostile inputs, the graft and the wiring (58 assertions, no browser). `node tools/test-vegas-slider.mjs` drives the real app in Chromium: it stubs an overlay, opens the panel, drags to both ends and back, and asserts Proj, position rank, the `V` flag and the readout all follow — that reset lands back on the exact numbers it started from, and that a seeded odds-free saved board at the current `PROJ_VERSION` gets the slider and the flags back on its own. Same playwright-core/react/Chromium dependencies and the same clean skip as `test-you-column.mjs`.

## 10. X (Twitter) auto-post (added July 2026)

Posts to **@irontunafantasy** every **weekday, staggered across three slots** (13:00 / 16:00 / 19:00 UTC = 9am / noon / 3pm EDT) so the day's threads hit different audience windows instead of one same-minute botlike burst: the **auction insight thread at 13:00**, the **snake insight thread at 16:00**, and the **day's bonus post at 19:00** — Monday a poll, Tuesday+Thursday snake-draft "survival odds" feature promos, Wednesday alternating auction money-allocation strategy and Value Coach promos, and Friday (much lower volume, by design, best ball is a separate niche format) best-ball insights and ceiling/stack/championship-week feature promos. Runs via three Cloudflare Worker **Cron Triggers** (one per slot, dispatched on `event.cron` in `scheduled()`), no external scheduler needed.

**Style rule: no em dashes in any hand-authored post content, on X, Reddit, or any other platform this system ever posts to.** Use a period, comma, or colon instead depending on what the em dash was doing. This applies only to hand-authored text (`X_STRATEGY_POSTS`, `X_COACH_POSTS`, `X_COMPARISON_*_POSTS`, `X_SNAKE_FEATURE_POSTS`, `X_BESTBALL_FEATURE_POSTS`, `X_POLL_POSTS`, their per-post `cta` reply lines, `X_TAGLINE`, `X_WED_TAGLINE`, and the `INSIGHTS_VAULT` copy) — extracted insight titles/takeaways (`INSIGHTS_X_POOL`) happen not to contain any today, but if a future drop page does, re-run the extractor's `capRatio`-style guard logic (or a similar filter) rather than assuming it's clean.

**How it works:**
- `INSIGHTS_X_POOL` in `_worker.js` is a flat array of `{id, format, title, play, stat, url, date}` extracted from the public `auction-insights-*.html` / `snake-insights-*.html` / `bestball-insights-*.html` drop pages (210 insights: 70 each of auction, snake, bestball). `play` is the insight-specific half of its "The play:" line (the generic strategy sentence is stripped, keeping just the actionable verdict); `stat` is the page's quantified "Projected effect:" statline (em dashes converted to commas, word-boundary-capped at ~110 chars; 201/210 insights have one). Regenerate with `node tools/extract-insight-pool.mjs` whenever new drop pages are added, then paste the resulting `tools/x-posts/insights_pool.json` back into the `const INSIGHTS_X_POOL = [...]` line in `_worker.js` (no build step, so this is manual — see §2), **then regenerate the stat cards** (`node tools/build-insight-cards.mjs`, see the stat-card bullet below) and commit the new PNGs. The extractor drops `play` to `''` if it detects leaked non-prose content (a data-quality guard against the couple of source pages where table markup bled into a `<p class="playline">`).
- `composeThread(insight)` builds a **2-tweet thread**, not a single tweet, so real analysis fits: tweet 1 is `🏈 {title}` + `📊 Projected effect: {stat}` + `💡 {play takeaway}` — the stat line is included whenever the full trio fits in 280 (198/210 currently) and silently dropped otherwise, never truncated mid-number; the title takes whatever room the play line doesn't need and every current title+play pair fits untruncated; tweet 2 is a reply opening **"Insight N of 5 in the Jul 4, 2026 auction drop."** (N parsed from the insight id, the date rendered by `dropLabel()` from the insight's `date`, plus the format word — sells the click by promising four more takes AND makes each reply's X text unique, which matters because X permanently rejects exact-duplicate tweets: with neither URL nor hashtags in the X copy, index + drop date + format word carry uniqueness on their own — the format word is what keeps same-index auction/snake replies on a shared drop date from colliding, and the year is included so future seasons can't collide either) + `X_TAGLINE` + the insight's canonical URL + format-specific hashtags (`#FantasyFootball #AuctionDraft #FFDraft` or `#FantasyFootball #SnakeDraft #FFDraft`). **Neither the URL line nor the hashtag line ever reaches X** — `toXCopy()` in `postAndLog()` strips any line containing an irontuna.com link and any line starting with `#` before posting (Aug 2026 decisions: no site links in X posts, which is also the difference between X's $0.20 link-post and $0.015 plain-post rates, and no hashtags, which read as automated filler on current X and add nothing to distribution there) — but the compose functions still emit both so the Threads mirror (§11) keeps them. Max X tweet length across the full current pool: 279 chars, all under 280, no duplicate X reply texts (re-verified programmatically across all 256 composable threads, Aug 2026).
- `runXAutoPost(env)` picks the next auction insight and next snake insight by rotation index (`SELECT COUNT(*) FROM x_posts WHERE format=?`), so all 70 insights per format post once before any repeat. Only insights whose page `date` has already unlocked (≤ today) are eligible. If the two picks happen to share the same headline (the public drop pages occasionally cover the same player from both formats), the snake pick is bumped to the next index so the two posts never look like accidental duplicates.
- `postThread(env, tweets)` posts tweet 1, then tweet 2 as a reply via `in_reply_to_tweet_id`, using `postTweet(env, text, replyToId)` → **OAuth 1.0a** (HMAC-SHA1) signed `POST https://api.twitter.com/2/tweets`, since free/basic X API tiers only support posting via OAuth 1.0a user context, not app-only bearer tokens.
- `scheduled(event, env, ctx)` at the bottom of `_worker.js` maps `event.cron` to a slot (`slotsByCron`: the 13:00 cron → `['auction']`, 16:00 → `['snake']`, 19:00 → `['bonus']`; an unrecognized cron string falls back to a full three-slot run so a config drift never silently posts nothing — **keep `slotsByCron` in sync with `wrangler.jsonc`'s `triggers.crons` verbatim**) and calls `runXAutoPost(env, {slots})`, which logs each attempt to a D1 table `x_posts (insight_id, format, tweet_id, ok, posted_at)` — `tweet_id` is a comma-joined pair (hook,reply) when both post successfully.
- **Insight stat cards:** every extracted insight has an auto-generated 1200×675 stat-card PNG at `/social/cards/<insight id>.png` (dark card on the site's own `:root` palette: tuna mark + wordmark, format/date badge, title, gold "Projected effect" row, "The play" row — deliberately no irontuna.com text on the card, consistent with the no-site-reference-on-X decision). `runXAutoPost` attaches the card to the daily insight threads (and to Friday's extracted best-ball picks) on both X and Threads via `insightCardPath()`, which existence-checks the asset first — a pool entry with no generated card degrades to a text-only post instead of failing (this matters for Threads, whose image containers hard-fail on a 404 `image_url`). Generated by `tools/build-insight-cards.mjs` (needs `playwright-core` on the resolution path — `npm i --no-save playwright-core` — plus a Chromium binary; preinstalled at `/opt/pw-browsers/chromium` in Claude Code remote sessions, else set `CHROMIUM_PATH`). **Re-run it right after the extractor whenever new drop pages are added and commit the new PNGs.**
- **Mon-Fri bonus third post:** `X_BONUS_DAY_POOLS` maps UTC day-of-week → `{pool, compose, format}` (or `{dynamicPool, compose, format}` for Friday — see below).
  - **Monday** (day 1) posts a poll from `X_POLL_POSTS` (6 hand-authored polls; facts follow the same repo-corpus sourcing rule as the other pools) via `composePollThread`: the hook is a `{text, poll}` object — `postTweet` passes `poll` straight through to the v2 API (2-4 options, ≤25 chars each, 24-hour duration) — and the per-poll `cta` rides as a plain-text reply with no URL and no hashtags. **X-only:** the Threads API has no poll support, so `runXAutoPost` skips the Threads mirror for any thread containing a non-string entry. Polls are the engagement-first opener of the week — early engagement is what earns algorithmic distribution for the rest of the account's posts.
  - **Wednesday** (day 3) uses `X_WEDNESDAY_POOL`, a 4-way interleave of: `X_MOCK_AUCTION_POSTS` (5 tweets promoting the free email-gated Mock Auction — mock snake drafts are commodity, a real practice auction room is rare; claims grounded in the `MockAuction` component: 11 CPU managers with distinct strategy archetypes, auto-nomination, second-price winning, the user's own league config, final standings by projected starter points), `X_STRATEGY_POSTS` (8 tweets on auction budget allocation — position spend %, stars-and-scrubs vs balanced, nomination timing, the $1 endgame/handcuffs — grounded in `/auction-budget-allocation`, `/auction-nomination-strategy`, `/dollar-endgame-handcuffs`), `X_COACH_POSTS` (7 tweets promoting the live AI Value Coach — "an AI that's actually in your draft" vs. pasting your roster into a generic chatbot), and `X_COMPARISON_AUCTION_POSTS` (4 tweets contrasting Iron Tuna's one-time $9.99 + live re-pricing + Value Coach against free-but-static default host draft kits (ESPN/Yahoo) and paid monthly ranking subscriptions like FantasyPros MVP, $5.99+/mo).
  - **Tuesday and Thursday** (days 2 and 4) both use `X_SNAKE_BONUS_POOL`, a 2-way interleave of `X_SNAKE_FEATURE_POSTS` (8 tweets promoting the live survival-odds / "Will he be available?" feature — knowing who'll last to round 5 changes what you take in round 2) and `X_COMPARISON_SNAKE_POSTS` (4 tweets contrasting the same live survival-odds/Value Coach/pricing angle against free static draft rooms (Sleeper/ESPN) and paid subscription rankers), followed by `X_SNAKE_DISCOUNT_POSTS` (6 tweets, added July 2026, appended *after* the interleave so pre-existing rotation indices stay stable): a consecutive themed series on drafting the early rounds around the late-round discounts you know are coming, every post led by player-specific advice with projections as evidence, with the reply CTAs carrying the live-prediction-engine pitch (re-forecasts in real time from who's off the board + what each opponent's roster still needs — grounded in the same survival-odds/roster-needs claims as `X_SNAKE_FEATURE_POSTS`) (the 1.01 as two builds: Chase+Walker+Chase Brown 870 vs Gibbs+leftover WRs 888; named survival odds to the 1.01 turn; Lawrence-over-Daniels QB build math; LaPorta-vs-Kraft mid-TE trap; Tuten/RB31+ committee discounts; a "draft the early rounds backwards" wrap). Both days share one rotation counter (format `snakefeature`), so Tue and Thu together cycle through all 18 without repeating.
  - **Friday** (day 5) is intentionally the lightest — best ball is a smaller, separate audience, not something to post about as often as auction/snake. `X_BONUS_DAY_POOLS[5].dynamicPool()` interleaves `poolFor('bestball')` (real extracted best-ball insights, same date-gating as auction/snake — only 10 eligible as of this writing, growing as more drop pages unlock) with the 4 hand-authored `X_BESTBALL_FEATURE_POSTS` (ceiling-weighted values, live stack alerts the moment you draft a QB, championship-week (15-17) schedule weighting, "a dedicated tool, not a reskin" — grounded in `/bestball` and `/best-ball-stacking-guide`). It's called `dynamicPool()` rather than a static array (unlike the other two days) specifically so newly unlocked best-ball drop pages become eligible the moment their gate passes, not just at the next deploy. `composeBestballThread(item)` dispatches between `composeThread` (extracted insights — detected by the presence of a `play` key) and `composeBonusThread` (hand-authored posts) since the two shapes need different composers.
  - `runXAutoPost` looks up `X_BONUS_DAY_POOLS[dayOfWeek]` and, if present, posts one additional thread from that day's pool via `composeBonusThread(post, hashtags)` (each post's own `cta` line leads the reply, falling back to `X_WED_TAGLINE` if absent — per-post CTAs keep the reply copy matched to the hook and keep every reply's text unique, avoiding X's permanent duplicate-content rejection — this is load-bearing on X, where the landing-URL and hashtag lines are both stripped out (see `toXCopy` above) and the cta text is the only thing differentiating replies; day-specific hashtags — `#...AuctionDraft...` for Wednesday, `#...SnakeDraft...` for Tue/Thu, `#...BestBall...` for Friday). To test any day's bonus post outside its real weekday, call the manual trigger with `&day=<0-6>` (0=Sun..6=Sat, matches cron numbering) — `&wednesday=1` still works as shorthand for `&day=3`.
  - Competitor pricing referenced in the comparison posts (FantasyPros MVP ~$5.99/mo) was spot-checked via web search at authoring time (July 2026) — re-verify before reusing if it's been a while, since subscription pricing changes.
- **Model-derived stats in hand-authored posts:** the numbers quoted in the bonus-post copy (88 players above replacement, 60%/76% top-24/36 value share, 86% RB+WR share, QB5→QB12 = 0.7 PPG, RB12→RB24 = 3.1 vs WR12→WR24 = 1.9 PPG, RB18→RB30 = 3.3 PPG, 11 RBs outside the top 30 at 150+ pts, 53% top-2 pass-catcher share, the survival-odds examples 17%/3%/74%/6%, and the discount-series numbers: named season projections Gibbs 373 / Chase 337 / Puka 351 / G.Wilson 263 / K.Walker 274 / Chase Brown 259 / Tuten 208 / Daniels 309 / Lawrence 297 / McBride 247 / LaPorta 197 / Kraft 176 / A.Jones 190 / J.Warren 187 / Dowdle 185, the build sums 870 / 888 / 571 / 517, LaPorta→Kraft = 1.2 PPG, and the board-rank-ADP survival odds to the 1.01 turn 60% (Chase Brown) / 1% (K.Walker)) are all computed from the live `PROJECTIONS` data + the site's actual survival formula by `node tools/compute-tweet-stats.mjs` (the discount-series numbers print in its "Later-round discounts, player-specific" section; build sums add the displayed rounded values so tweet arithmetic checks out for readers). Re-run it after major projection updates; if a quoted number drifts meaningfully, update the tweet copy to match.
- **Football facts in hand-authored posts (Berry-style, added July 2026):** roughly half the bonus posts lead with a specific 2026 football fact — coordinator/coach changes (Petzing to Detroit + Campbell's Gibbs "bellcow" quote, Coen's Jacksonville rotation), personnel moves (49ers signing Evans + Kirk, A.J. Brown to New England, Dowdle's 2-yr/$12.25M deal burying Kaleb Johnson, Kyler Murray released, Stevenson/Henderson split), injuries (Mahomes ACL rehab, Bucky Irving "summer or fall", Garrett Wilson full participant), weather/schedule (Lambeau late-season snow flags vs BUF/MIA/HOU, the Rams' hard closing slate), and usage stats (Daniels 685.9 rush yds in 7 games, JSN 35.7% target share on 162 targets, Pickens' deep-role spike profile). **Every one of these is sourced from this repo's own drop pages / Auction Watch pages / `INSIGHTS_VAULT` — never from memory.** The discount series adds two more: Tucker Kraft's TE4-before-injury/PUP/Week-1 timeline (Auction Watch 2026-06-19) and Liam Coen's Tuten praise + three-back committee (Auction Watch 2026-07-11). Two maintenance rules: (1) when adding facts, grep the corpus first and quote it exactly; (2) several facts are dated news (injury timelines, camp status) — re-skim the fact-led posts when new Auction Watch pages contradict them (e.g. once Irving is cleared, that compare-auction-0 line needs refreshing; once Kraft comes off PUP or the Jags name a starter, snake-discount-2/-3 need the same) and at minimum once before each season phase (camp open, cutdowns, Week 1).
- **Comparison-card graphics:** the 8 `compare-*` posts (both auction and snake pools) each carry an `image` field pointing at `/social/compare-auction.png` or `/social/compare-snake.png` — two dark-themed comparison-table cards (1200×675 @2x) built to match the site's existing palette (`--bg`/`--panel`/`--teal`/`--gold`/`--danger` tokens from the guide pages), each showing a 4-row Iron Tuna-vs-2-competitors table (price + 3 feature rows) with a `$9.99 one-time` / `Free to start` price tag. Source template + generator script (`template.html` + `build.mjs`, Playwright/Chromium screenshot) live in the session scratchpad, not the repo — regenerate by editing the row data in a copy of that script if the comparison content changes; the repo only keeps the rendered PNGs. `postAndLog()` uploads the image via X's v1.1 `/media/upload.json` (multipart, OAuth 1.0a — the only media endpoint X's API still exposes) and attaches it to just the first tweet of the thread via `media.media_ids` on the v2 `/2/tweets` call; the reply tweet stays text-only. The daily auction/snake insight threads carry their own auto-generated stat cards instead (see the insight stat-card bullet above).
- **Manual trigger for testing:** `GET /api/admin/x-post-now?key=<LEADS_EXPORT_KEY>` runs the same `runXAutoPost` on demand and returns the composed thread text + tweet IDs — use this to verify before waiting for the next cron tick. Unlike the staggered crons, the manual trigger runs **all three slots in one go** (no `slots` restriction). Add `&day=1` (Mon poll) through `&day=5` (Fri best ball) to force that day's bonus post on an off-day test run.
- **Manual delete (cleanup):** `GET /api/admin/x-delete?key=<LEADS_EXPORT_KEY>&id=<tweet_id>` deletes a single tweet by ID via OAuth 1.0a `DELETE /2/tweets/:id` — useful for removing a bad test post.
- **Spend tracking:** X's pay-per-use pricing (as of July 2026) is $0.015 per plain post, $0.20 per post containing a link — a 13x jump. Reply tweets used to carry the irontuna.com link and dominated cost; since the Aug 2026 link removal (`toXCopy` in `postAndLog`), every X post bills at the plain $0.015 rate. `tweetCost(text)` still checks for a URL so the estimate stays correct if links ever come back. `tweetCost(text)` estimates per-tweet cost by checking for a URL; `postAndLog()` sums it across the thread's actually-created tweets (a rejected duplicate is never charged) and stores it in `x_posts.est_cost` (`ALTER TABLE x_posts ADD COLUMN est_cost REAL`). `GET /api/admin/x-spend?key=<LEADS_EXPORT_KEY>` returns total estimated spend and a per-format breakdown; add `&balance=25` (or whatever the current real balance is) to also get `estimatedRemaining`. This is an estimate for budget awareness, not authoritative billing — always cross-check the X developer console's Credits page for the real number.
- **Duplicate-text guard:** X rejects (`403 duplicate content`) any tweet whose text exactly matches one already posted from the account — forever, not just same-day. This isn't rare: several early drop dates republish the exact same title+takeaway across auction/snake/bestball with only the URL differing, since it's the same underlying research. `x_posts.text_hash` (SHA-256 of the hook tweet, added after the table's initial creation — `ALTER TABLE x_posts ADD COLUMN text_hash TEXT`) records every successful post; `pickNonDuplicate()` walks the rotation forward past any pool item whose composed text already has a matching hash before posting, and now returns `null` (skip the slot, no API call) rather than attempting a guaranteed-to-fail repost if the whole currently-eligible pool is exhausted — this can genuinely happen early on, when only 1-2 drop dates are unlocked and heavy manual testing (or, less likely, real daily posting outrunning the drop-date cadence) burns through the small shared pool before the next date unlocks. It self-resolves as more drop pages become eligible. Applies to all pools (auction, snake, wednesday, snakefeature, bestball).

**One-time setup required (not yet done as of this handoff):**

1. **Create an X Developer app for @irontunafantasy** at [developer.x.com](https://developer.x.com) (a paid API tier is required for write access on current X API pricing — check current tier pricing before committing). Enable **OAuth 1.0a** with **Read and Write** permissions, and generate:
   - API Key & Secret (`X_API_KEY` / `X_API_SECRET`)
   - Access Token & Secret **for the @irontunafantasy account specifically** (`X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`) — regenerate these after setting Read+Write, since tokens generated before that change stay read-only.
2. **Add all four as Cloudflare secrets** on the `iron-tuna` Worker (`wrangler secret put X_API_KEY`, etc., or via the dashboard → Settings → Variables and Secrets → encrypt).
3. **Create the `x_posts` D1 table** (already run against `iron-tuna-leads` as of this handoff — included here for reference / disaster recovery):
   ```sql
   CREATE TABLE IF NOT EXISTS x_posts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     insight_id TEXT NOT NULL,
     format TEXT NOT NULL,
     tweet_id TEXT,
     ok INTEGER NOT NULL,
     posted_at INTEGER NOT NULL,
     text_hash TEXT
   );
   ```
   Run via `wrangler d1 execute iron-tuna-leads --remote --command "..."` (the SQL above) or the Cloudflare dashboard's D1 console.
4. **Deploy** (`git push` to `main`, or `wrangler deploy` — the cron trigger only takes effect after a deploy since it's declared in `wrangler.jsonc`).
5. **Verify** with the manual-trigger route above before trusting the schedule.

**Notes:**
- If the four `X_*` secrets aren't set, `runXAutoPost` returns `{ok:false, error:'missing_x_credentials'}` and posts nothing — safe to deploy before the X app is ready.
- To change cadence/time, edit the `triggers.crons` entries in `wrangler.jsonc` **and keep `slotsByCron` in `scheduled()` in sync** (keys are matched against `event.cron` verbatim); to change hashtags/tagline, edit `X_TAGLINE` / `X_HASHTAGS` in `_worker.js` (hashtags only ever appear on Threads — X copy strips them).
- To draw from the 150-insight premium set instead of the public 70, a teaser/truncation strategy would be needed (premium content is currently paywalled behind `/my-insights`) — not implemented, by design, so free X posts don't give away paid-tier value.

---

## 11. Threads auto-post (added July 2026)

Mirrors whatever `runXAutoPost` posts to X onto **Threads** (@irontunafantasy, once created) the same run, same content — not a second independent rotation. Fires from the same `scheduled()` cron as X, so no separate trigger is needed. Free API (no per-post charge, unlike X's pay-per-use pricing), 500-char limit (well above anything this system composes), and images post via a plain public URL instead of a separate media-upload step.

**How it works:**
- `postAndLogThreads(env, format, id, tweets, imagePath)` is called right after each successful (or skipped) X post, using the exact same `pick.tweets` array X's run composed — so the two platforms carry the same message the same day. Two deliberate divergences (Aug 2026): Threads receives the tweets **before** `toXCopy()` runs, so Threads replies still include the irontuna.com link and the hashtag line that X posts omit (Threads' API is free, doesn't charge per link, and hashtags still function as topic tags there); and Monday's poll threads are **not** mirrored at all, since the Threads API has no poll support (`runXAutoPost` skips the mirror for any thread containing a non-string entry). If X's pool is exhausted for a slot (`no_insight_available`), Threads is skipped too for that slot, same as X.
- **2-step publish** (Meta's Threads API pattern, same shape as Instagram's Graph API): `createThreadsContainer` (`POST /{THREADS_USER_ID}/threads` with `media_type`, `text`, optional `image_url`/`reply_to_id`) returns a `creation_id`; `publishThreadsContainer` (`POST /{THREADS_USER_ID}/threads_publish` with that `creation_id`) actually publishes it. `postThreadsThread` chains a 2-post thread via `reply_to_id`, same hook+reply structure as X.
- **Images** use `media_type=IMAGE` + `image_url` pointing straight at `https://irontuna.com/social/compare-*.png` — no upload step needed, unlike X's OAuth 1.0a multipart dance, since Threads accepts any publicly reachable URL.
- **Token refresh:** Threads long-lived access tokens expire in 60 days and **cannot be refreshed after they expire**, and a Cloudflare Worker cannot rewrite its own secret at runtime — so the live token is stored in a `threads_token` D1 table (seeded from the `THREADS_ACCESS_TOKEN` secret on first use) rather than only living in the secret. `maybeRefreshThreadsToken(env)` runs before every post attempt, checks the stored token's `expires_at`, and calls Meta's `refresh_access_token` endpoint (which only needs the current valid token, no app secret) once it's within 10 days of expiring, writing the new token + expiry back to D1. As long as posting happens at least every ~50 days, this is fully self-maintaining.
- Logs to `threads_posts (insight_id, format, post_id, ok, posted_at)` — a separate table from `x_posts`, since Threads doesn't reject duplicate content the way X does, so there's no need for the hash-dedup machinery there.
- **Manual trigger:** the existing `GET /api/admin/x-post-now?key=...` now returns both platforms' results in one array (`"platform":"x"` / `"platform":"threads"` on each entry) — no separate endpoint needed.
- **Token health check:** `GET /api/admin/threads-status?key=<LEADS_EXPORT_KEY>` returns whether a refreshed token is stored in D1 yet, how many days until it expires, and when it was last refreshed.

**One-time setup required (not yet done as of this handoff):**
1. Create a **Meta Developer account + App** at [developers.facebook.com](https://developers.facebook.com), add the **Threads API** product to it.
2. Add **@irontunafantasy's Threads account** as the app's test user / connect it via the Threads Login flow, requesting scopes `threads_basic` and `threads_content_publish`.
3. Complete the OAuth flow once (Meta's Graph API Explorer in the app dashboard can generate a User Access Token directly with the right scopes, avoiding a manual redirect-URI dance) to get a **short-lived token**, then exchange it for a **long-lived token** via `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_id=<app id>&client_secret=<app secret>&access_token=<short-lived token>` (a plain browser-navigable GET — paste the filled-in URL into a browser address bar and read the JSON response).
4. Get the account's numeric **Threads user ID** via `GET https://graph.threads.net/v1.0/me?fields=id,username&access_token=<token>`.
5. Add two Cloudflare secrets on the `iron-tuna` Worker: `THREADS_ACCESS_TOKEN` (the long-lived token from step 3) and `THREADS_USER_ID` (from step 4).
6. Deploy, then verify with the manual trigger and check `/api/admin/threads-status` a few seconds later to confirm a refreshed token landed in D1.

**Notes:**
- If `THREADS_USER_ID` or a usable access token isn't set, `postAndLogThreads` returns `{ok:false, error:'missing_threads_credentials'}` and that result is silently dropped from the response (not treated as a failure) — safe to deploy before the Threads app is ready; X keeps posting on its own either way.
- Content reuses every pool already built for X verbatim (same em-dash-free style rule applies — see §10) — no separate Threads-specific content was authored, by design, to keep the two platforms in sync.

---

*Generated as part of the move to Claude Code. Questions about any section map directly to the files referenced above.*

---

## 12. August 2026: ESPN-style news front page at "/"

- **`front.html` is the site's front page.** The worker serves it at `/`; the classic
  SPA hub (HubLanding in `index.html`) moved to **`/hub`** ("Classic Home" in the nav)
  and everything else (app routes, static pages) is unchanged. Snake and best ball
  remain fully live — and since August 2026 the ribbon's **edition switch** (§22)
  delivers the whole front page in whichever of the three the reader picked,
  rather than linking them out of it.
- **Layout** (ESPN-inspired): black masthead with the fish + Bebas silver wordmark and
  red accent bar; **deep-dive lead** (see below); "Top Headlines" rail; **Position Intel** modules (QB / RB / WR / TE /
  Market) — the reading lens that used to have a switch here now follows the
  ribbon's **edition** switch (§22);
  **Asset Allocation** module (budget, nominations, $1 endgame guides + the
  in-app planner); **Training Camp & Preseason** desk (the auction-watch pages,
  newest featured).
- **Top Headlines is one merged, strictly newest-first feed.** Camp reports and insight
  calls are sorted together by date rather than pinning the newest camp report to slot 0,
  which used to let a July camp report outrank an August drop. `RAIL_MIN_TOP_DAY` keeps the
  newest day from appearing as a lone headline. The rail also excludes whatever is in the
  lead pool, so it never repeats the lead. *(If the rail ever looks stale, the cause is
  usually a new page added without re-running `build-front.mjs` — that is exactly how it
  got stuck showing July 22.)*
> **Routing note (merge of PR #39 and #40):** both branches fixed `?screen=cheat`
> landing on the draft board. PR #40's fix sent phones to `'tiers'`, which was right
> against the *old* mobile tab bar where `'tiers'` was the tab labelled "Cheat". PR #39
> relabels those tabs (`'prep'` = **Cheat**, `'tiers'` = **Tiers**), so the merged
> behaviour routes `?screen=cheat` to `'prep'` on every device. Leaving `'tiers'` in
> would have dropped phone traffic on a tab labelled "Tiers" showing the VORP tier view
> instead of the cheat sheet. Settings-exit routing for free users follows the same
> target. The paywalled board is unaffected: `?screen=cheat` is never locked,
> `?screen=board` still is.

> **Superseded, August 2026 — read §17 first.** The lead is now a *generated*
> insight, written fresh every three hours by a scheduled run and served out of
> D1. Everything in this bullet still ships and still runs, but only as the
> **fallback** the page paints before the API answers. The dated deep-dive
> rotation is what a reader sees when a run has not published, not what they
> normally see.

- **The lead is a three-hour deep dive.** It is reserved for calls that go **beyond a
  single player** — coaching, offensive line, schedule, weather, rule changes — the
  read that earns a top click rather than one more player take. Those are tagged
  `deep: 1` at build time from the insight pages' own **`Market`** position label, so
  the classification is the site's existing editorial call and does not drift as copy
  changes; single-player QB/RB/WR/TE calls are never eligible. Each also gets a `topic`
  desk label (SCHEDULE / OFFENSIVE LINE / COACHING / WEATHER / RULE CHANGE / TEAM
  TREND) matched from the **title first**, body only as a fallback, so a passing
  mention deep in a paragraph cannot relabel a story.
  - **Cadence:** the slot is derived from the wall clock rather than a carousel timer
    — so every visitor sees the *same* lead — and it turns over every **three hours**,
    at 00/03/06/09/12/15/18/21 UTC. The pool is the 8 most recent unlocked deep dives
    (`LEAD_WINDOW`), so a full pass takes a day.
  - **Why the index is not plain `slot % pool`:** at a full `LEAD_WINDOW` of 8 the pool
    divides evenly into the 8 slots a day, which would pin each story to a fixed time
    of day forever — a reader who always checks at 4pm would see the same deep dive
    every single visit. `slotIndex()` therefore adds `floor(slot / pool)`, advancing one
    extra step per completed pass, so the phase rotates daily and a fixed-hour reader
    works through the whole pool over `pool` days. The shift is skipped when the pool
    has 2 or fewer stories, where it would land on the same story twice in a row
    instead of moving on. **Keep this in mind before changing `SLOT_MS` or
    `LEAD_WINDOW`:** any cadence that divides evenly into 24h reintroduces the
    time-of-day lock without it.
  - Arrows and dots still browse by hand; doing so **pins** the lead (hides the
    countdown and stops the auto-rollover) so a reader's choice is never yanked away.
    A tab left open rolls to the next deep dive when the boundary passes.
  - The Top Headlines rail excludes whatever is in the lead pool, so it no longer
    repeats the lead now that the pool spans dates.
  - If no deep dive has unlocked yet it falls back to the latest drop's calls, so the
    lead is never empty on a fresh season.
- **Vegas vs. Rankings & ADP** (`#vegas`, between Position Intel and Asset Allocation) is
  the one section on the page whose content is **computed rather than authored** — its
  cases come from `/api/vegas-column`, not from `STORIES`, so `build-front.mjs` does not
  touch it and it never needs a copy refresh. Full contract in **§9c**.
- **The lead carries artwork** (`#leadArt`), an inline SVG plate in the featured team's
  colours. **No club logo, wordmark or player likeness is reproduced** — none of that is
  ours to publish. What is used is a team's colours (a fact, not a creative work) plus the
  abbreviation, drawn as original geometry. `TEAM_ART` in `front.html` holds the palette;
  `inkOn()` picks the type colour from the background's luminance, because white on
  Pittsburgh's yellow is unreadable.
  - The team comes from `story.team`, set by `build-front.mjs` from **the headline only**.
    The body fallback that works for topics is too loose here: "Offensive-line dispersion
    matters more this year" is a league-wide piece that cites Buffalo in paragraph three,
    and body matching handed it Buffalo's colours. League-wide stories get the neutral
    plate — currently 17 of 20 deep dives name a team, and the 3 that don't are the two
    rule-change pieces and the dispersion one, correctly.
- **Odds impact on every player row** (`vegasRankEl` / `vegasRankShifts` in `index.html`,
  wired into **`Cheatsheet`** and **`PlayersRail`** — the cheat sheet and the auction
  manager). The old `vegasFlagEl` "V" badge only said *that* the odds mattered, and only on
  hover; the chip says **how far they moved the player on the board** (`▲3` / `▼2`), which
  is the sentence a drafter actually needs. Both boards are ranked over the **same pool**,
  because a rank is relative — ranking only the priced players would invent shifts that
  never happened. Memoised per component; silent unless the rank moved or the points delta
  clears `VEGAS_FLAG_MIN_PTS`. Covered by `node tools/test-vegas-rank-chip.mjs`.
- **Every number on the page reads through the reader's own league** (`/it-league.js`,
  §9f). The Vegas card's points, prices and ranks, the lead's and the story cards'
  "Projected effect" lines, and the Asset Allocation blurb's `$200` all restate
  themselves for a reader with a saved league, and are left exactly as authored for
  one without.
- **Position Intel has a hierarchy, not a list** (`.pos-mod`). Five narrow auto-fit
  columns meant five stacks of six identical headlines; the card now leads with one
  story per position at size, with the player's face and the actual play, then three
  follow-ups that look secondary. Two columns wide (Market spans both), four stories
  a card, and only the lead carries its "your league" translation — one per card
  reads as an aside, one per row read as wallpaper.
- **`discEl(p)`** is the shared photo disc: the lead band's `faceEl` and the position
  modules both build on it. Photos are hot-linked and fall back to initials, so they
  cannot be verified in a sandbox without egress — check them on a deployed preview.
- **The Play-Caller Premium module** (`#coaching`, §15) sits between Position Intel
  and Asset Allocation, fed by `var COLUMN` from the same build script.
- **Data pipeline:** `node tools/build-front.mjs` re-extracts the embedded
  `var STORIES` / `var REPORTS` arrays in `front.html` from the
  `auction-insights-*.html` and `auction-watch-*.html` pages (joined to
  `tools/x-posts/insights_pool.json` for play/stat lines). **Run it whenever a new
  drop page or auction-watch page is added.** Insight visibility is date-gated
  client-side with the same 9am-ET rule as the worker, so future drops are safe to
  embed.
- **Camp/preseason upkeep:** a scheduled Claude Routine ("Iron Tuna camp & preseason
  desk") researches verified camp/preseason news daily, authors a new
  `auction-watch-YYYY-MM-DD.html` when there is real signal, runs `build-front.mjs`
  **and `build-seo.mjs`** (§21 — the new page needs the Google tag, its Article
  JSON-LD, a sitemap `lastmod`, and a static link from the camp desk; without the
  second command it is published untagged and reachable only from the sitemap),
  and pushes — same guardrails as the §9 projections routine (skip on no
  network/no verified news; no em dashes in authored copy).

---

## 13. August 2026: the draft board is paywalled

- **The live board (Auction Manager / Draft Board) is a paid screen.** In `index.html`,
  `boardLocked` is true whenever `view` is `board` (or the unused `split`) and the user
  has no entitlement for the live format. When it flips on, the upgrade modal opens
  automatically and the board renders inside `.board-lock`: `.board-lock-inner` gets
  `pointer-events: none` so nothing on the board can be clicked, dragged or typed into,
  and `.board-lock-veil` (an absolutely positioned scrim carrying the "…is locked" card)
  reopens the upgrade modal on any click. The header nav and the mobile tab bar sit
  outside the lock, so a free user is never trapped on the board.
- The auto-open waits for `authChecked` (the `/api/auth/me` round trip) so a buyer
  restoring access on a new device does not see the prompt flash. Unlocking, or leaving
  the board, closes the prompt.
- **Free tier is unchanged:** the cheat sheet (`prep` on desktop, `tiers` on phones),
  tiers, plan, mock auction/draft and settings are all still open.
- **`?screen=cheat` now opens the cheat sheet.** It previously fell through to the board,
  which would have put the free "Build my free cheat sheet" CTA on `front.html` behind
  the paywall. `?screen=board` still opens the board (now locked for free users).

---

## 14. August 2026: the Ideal Team is now solved exactly

Filling the open starter slots is a **multiple-choice knapsack** (one distinct
player per slot, maximise projected points, total price inside a dollar budget).
It used to be approximated by a greedy points-per-dollar hill climb in
`buildOptimalPlan`. Two defects came out of that, both measured against an
independent exact solver over the real projections:

- **The Ideal Team left roughly a fifth of the budget unspent** — every one of 27
  scenarios (budgets 100/200/300 x 0/1/2 FLEX x 0/40/90 players gone). It spent
  $153 of $193 at default settings because `extraBench` (`allocation * 0.35 * R`)
  was withheld even for a model documented as "the single highest-scoring
  starting lineup you can afford". Cost: **+30 to +117 points, typically ~5
  points a game**.
- **The greedy climb was beaten at its own budget in 9 of 27 scenarios** (up to
  +7.5 points), mostly mid-draft — precisely when the planner matters.

What changed:

- **`bestStarterSet(freeSlots, byPos, used, priceOf, budget, cap)`** (just above
  `buildOptimalPlan`) solves it exactly: an "exactly k players" knapsack per
  position, a max-plus combine across positions, maximised over every way of
  handing the FLEX slots to the positions they accept. Slots are grouped by
  eligibility signature, so it generalises to any roster/flex shape in
  `config.roster` / `config.flex`. Full player pools, no pruning — it is exact,
  not heuristic. Reconstruction hands the best players to the dedicated slots
  first (best RBs in RB1/RB2, the next one into FLEX).
- `buildOptimalPlan` keeps every budget rule it had (`reserveBench`,
  `extraBench`, overrides, forced picks, `perCap`) and only swaps the solver, so
  the nine shape models still mean what they meant — they are just optimal
  within their own constraints now. A 12th `opts` argument carries
  `{ noCap: true }`.
- **`buildModel('ideal', ...)`** no longer returns the best of the nine shape
  presets. It calls `buildOptimalPlan` directly with `noBench` and `noCap`, so it
  spends everything down to a $1 bench. Locked targets and what-if anchors are
  still honoured as constraints; if it somehow returns nothing the old
  best-of-presets path is the fallback.
- **Opponent projections use the same full-budget optimum** (the `t.isMine`
  ternary in the team-cards memo). The column promises "each team optimally fills
  its remaining starters within budget", and before this my team was optimised
  differently from everyone else's — on an empty board it read My Team 125.4
  pts/gm against 120.4 for all eleven opponents. All twelve now read 125.4.
- The Ideal model's tooltip and note say it ignores the concentration/bench
  sliders, since those shape the other models.

Cost: ~4-6 ms per model build, ~23 ms for a full 12-team board recompute.

**Verifying a change here:** `bestStarterSet` is pure, so instrument a copy of
`index.html` (append `window.__ITFN = { ... }` inside the module script, stash
`buildModel`'s arguments on `window.__ITDBG`), serve it, and compare against an
independently written knapsack in the page. The starved-budget case ($12 for 9
slots) must still render 9/9 slots with `feasible: false`.

---

## 15. August 2026: "The Build" desk on the front page

`front.html` keeps the design and running order it already had (news lead with player
photos, Top Headlines, Vegas vs. Consensus, Position Intel, Asset Allocation, Camp).
Added between **Vegas vs. Consensus** and **Position Intel** is a **The Build** desk,
and the Camp section gained a weekly preseason rail (below).

This section was originally written against a full dark-theme rewrite of the front
page. That rewrite was dropped in the merge: `main` had meanwhile shipped the photo
band, the Vegas column and per-reader pricing, all of which are better than what it
would have replaced. Only the computed modules were carried across, restyled to the
light palette. `tools/build-front.mjs` still owns `STORIES` / `REPORTS` / `PLAYERS`
and now `PRESEASON` too.

**Every number in The Build comes from `var ANALYSIS = {...};`**, rebuilt by
`node tools/build-front-analysis.mjs`. Run it whenever projections change (right after
`merge-projections.mjs`). It drives headless Chromium against a local copy of the app
and reads the app's *own* valuation pipeline and exact lineup solver, because
re-implementing the scoring in Node would drift from what users see. Needs
`npm i -D playwright` plus, on a box with no CDN egress, `npm i -D react react-dom`
(both gitignored; nothing ships). Sanity checks abort the write on an empty or
out-of-budget solve. `--dry-run` prints the JSON instead of writing.

The Build desk, all computed:
- **"The best team $200 can buy"** — the provably optimal starting lineup from §14's
  solver, with the per-position spend bar. Currently $183 for 122.1 pts/gm, most of it
  on running backs, plus the $17 bench that spends the rest of the board (§24).
- **"The cliffs"** — the largest points-per-game drop between neighbouring players at
  each position.
- **"Why the money goes to running back"** — points between the position leader and
  the replacement-level starter in a 12-team league. RB 10.0, DEF 0.8. This is the
  reason the optimum looks the way it does.
- **"What the FLEX is worth"** — re-solves with the FLEX removed (+12.4 pts/gm).

### On consensus and market language

`main` shipped a **Vegas vs. Consensus** desk, so the odds story that this work could
not build now exists and is priced off real lines. Two caveats from digging through the
value pipeline still stand and are worth an honest pass:

- **There is no consensus ADP in the player model.** `adpRedraft` is null for all 408
  players, so `attachProvisionalAdp` synthesises a rank from Iron Tuna's own
  `auctionValue`. §14 relabelled the user-facing column ("IT Rank") so it no longer
  claims to be average draft position, but anything that calls that number "consensus"
  is comparing the model to itself.
- **`calculateMarketValues` is a curve, not a market.** It assigns prices from the
  hardcoded `LEAGUE_MARKET_CURVE` indexed by our own points rank. So the in-app
  "surplus", "Bargain +$X" and "Overpay -$X" chips measure this model against a fixed
  curve. That is separate from the front page's Vegas column, which uses real lines.

`build-front-analysis.mjs` still carries an `edge` block contract (documented at the
bottom of the file, preserved across rebuilds) for feeding a third-party desk from
`ANALYSIS`. It is unused now that the Vegas column exists; keep it or delete it, but do
not fill it with anything that is not sourced.

### Weekly preseason takeaways

The Camp &amp; Preseason section leads with a **per-week takeaways rail**: one card per
`preseason-week-N.html` page, newest week first, showing the headline, the description
and up to four of the article's takeaway headings.

- **Authoring template:** `tools/templates/preseason-week.html` — the auction-watch
  chrome with `{{WEEK}}`, `{{HEADLINE}}`, `{{DESCRIPTION}}`, `{{LEDE}}`,
  `{{TAKEAWAY_TITLE}}`, `{{TAKEAWAY_BODY}}` tokens. Save as `preseason-week-N.html`
  (N is the preseason week number, no date in the filename) and it is served at
  `/preseason-week-N` with no worker change — Pages resolves it like the
  auction-watch pages.
- **Wiring it up:** `node tools/build-front.mjs` scrapes the new page into
  `var PRESEASON` alongside STORIES/REPORTS. It strips HTML comments before reading
  the takeaway headings, so the template's own instructional comment is not scraped.
  Add the URL to `sitemap.xml` the same way auction-watch pages are listed.
- **Empty state:** with no pages, the rail shows one honest line saying takeaways
  publish after each slate. It never invents a week or a date.
- **Who writes them:** the same scheduled Claude Routine that runs the camp desk
  (§12), on the morning after each preseason slate, under the same guardrails — skip
  on no network or no verified games, no em dashes in authored copy. Every claim has
  to come from a game that was actually played (snap counts, series with the ones,
  target share, goal-line work, injury exits) and has to land on what it does to the
  auction price, including when it does not move the price at all.

**None are written yet.** They could not be authored from the session that built this
rail: reporting on games requires game data, and the network policy in that
environment blocks every sports source. The rail, the template, the build step and the
empty state are all in place and tested against fixtures; the articles need a run with
network access.

### Player photos

Handled by `main`'s pipeline, not by this work: `tools/build-headshots.mjs` +
`tools/nfl-headshots.json` resolve the players a story names and the lead renders their
photos. An earlier `/players/<slug>.jpg` drop-in scheme from this branch was removed in
the merge as redundant.

---

## 16. August 2026: The Play-Caller Premium (the coaching column)

A recurring column on what a head coach or coordinator is worth in fantasy dollars. Every entry has the same two halves, and the format is the point: **a coaching tendency with a track record long enough to be checkable, and the specific current-season player that tendency lands on.** A pattern with no named player is trivia; a named player with no pattern behind him is a hunch.

The name is an auction name on purpose — the column measures what a play-caller adds to or subtracts from a price.

**"Premium" is the column's name and nothing else.** It was originally the verdict vocabulary too ("Pay the premium" / "Take the discount"), and that read as jargon: everywhere else on this site "premium" means *the paid tier* — Premium Insights, the premium set, Unlock Premium Insights — so a chip reading "Pay the premium" looked like it was describing the product, not the price. The verdicts are now the same three words the drop pages already use, **Underpriced / Overpriced / Two-sided**, and the page's method box spells out what each one means. Do not reintroduce a price word that collides with the paywall word.

### Where it lives

- **`play-caller-premium.html`** (route `/play-caller-premium`) is the **source of truth**, same discipline as the insight drop pages. Entries are static HTML — no client-side rendering and no date gating, because entries are written on the day they publish rather than scheduled ahead. Newest first.
- Each entry is one `<article class="call" id="call-YYYY-MM-DD-N">` carrying: a `.cmeta` row (chip + `.cpos` + `.cteam` + `.cdate`), an `<h2>` naming the **coach or the pattern**, two or three paragraphs of the tendency, a `<p class="who">` naming the players in `<b>` tags, and a `<p class="statline">`.
- The chip is the verdict: `chip up` ("Underpriced"), `chip down` ("Overpriced"), `chip split` ("Two-sided" — a scheme that lifts one position by taxing another). The class names still read up/down/split because they carry the colour; only the words changed.
- **`p.statline` is deliberate markup, not decoration.** It is the same class the drop pages use, so `/it-league.js` finds it and translates each entry's percentage into the reader's own dollars (§9f). The column ships `<script src="/it-league.js" defer>` for exactly that.
- The front page carries a **`#coaching` module** between Position Intel and Asset Allocation: the four newest entries as cards, each with the faces of the players it commits to.

### The build path

`node tools/build-front.mjs` extracts the column into `var COLUMN = [...]` in `front.html`, alongside STORIES/REPORTS/PLAYERS. The extractor reads each `<article class="call">` for its chip, position, team, date, headline, who-line and statline, and **takes the named players only from the `<b>` spans inside the who-line** — a name in the prose above it is context, not a call, and must not claim a photo. Player slugs resolve against `tools/nfl-headshots.json` and join the shared `PLAYERS` cast.

Two things the extractor learned the hard way and now handles: the who-line is markup, so tags come out before the text goes in (otherwise the card prints `<b>Who it moves:</b>` literally), and `unesc` now decodes **numeric** entities as well as named ones, because the column writes non-breaking hyphens as `&#8209;` to keep names like "zone-tree" from breaking across lines.

### The daily cadence

A Claude Routine (`trig_015MJSf2RFwE89n8Hua3oSG8`, "Iron Tuna — Play-Caller Premium daily entries") fires **daily at 12:00 UTC** into a fresh session and adds 3–5 entries on a branch, with a hard stop after **2026-09-13**. Its prompt carries the entry template, the editorial rule, and one instruction that matters more than the rest:

> **Ground every current-season claim in this repo.** The roster and coaching landscape here is the site's own and does not always match outside sources — read the insight pages, the camp reports and the `PROJECTIONS` block before naming anyone. Historical tendencies (real NFL coaching records) are fine from general knowledge and are the backbone of the column.

It pushes a branch and never to main. **The Routine stores no MCP connectors**, so its sessions may lack GitHub tools; the prompt therefore treats the pushed branch as the deliverable and the PR as best-effort. To change the cadence, edit the Routine; to stop it, delete it (`trig_015MJSf2RFwE89n8Hua3oSG8`).

### Writing conventions

- The headline names the **coach**, not the player. That is what makes it a column rather than another player blurb.
- Two-sided entries read "Up — **Player** … Down — **Player** …" (capitalised, em-dashed), because the who-line is also the front-page card's blurb and a card that opens mid-sentence in lower case reads like a bug.
- State the risk in the entry rather than in a footnote — the zone-tree entry says out loud that the same tree invented the committee.
- The percentage is the desk's estimate of the gap versus market price, not a stat projection, and the page's method box says so.

---

## 17. August 2026: the lead is a generated insight, not a rotation

The front page's lead used to rotate a fixed pool of eight dated deep dives on a
three-hour wall clock (§12). That mechanism was doing its job and the job was the
problem: with no new material, the best it could do was re-present July and
August drop pages as though they were news. What a reader saw was the same
stories cycling.

A scheduled Claude Routine, **"Iron Tuna — lead story refresh (every 3h)"**
(cron `58 */3 * * *`), already existed and was already working — rebuilding the
auction from the current projection set and the current sportsbook lines and
writing a genuinely new, fully sourced insight into D1 every three hours. **Nothing
on the site read the table.** Seventeen finished stories had accumulated,
unreachable. This section is the pipe that was missing.

### The data

`lead_story` on D1 `iron-tuna-leads` (`75f7c43a-69cc-48eb-aa78-6ecfd91af2fb`).
The Routine owns the writes; the site only reads.

| column | meaning |
|---|---|
| `slug` | `short-topic-YYYY-MM-DD-HH`; the URL is `/lead/<slug>` |
| `title`, `dek` | the headline and the finding. Both go on the front-page lead |
| `body_html` | the article, an HTML fragment. Never sent to the front page |
| `method`, `sources` | the receipts. `sources` is a JSON array of `{type,name,detail}` |
| `category` | which desk it was written for (added Aug 2026) |
| `players` | JSON array of the players it commits to (added Aug 2026) |
| `verified` | the run could trace every number to something it pulled that run |
| `published` | **this is the current lead.** Exactly one row at a time |

`verified` and `published` are deliberately two flags, not one:

- `verified = 0` is the run failing its own gate. Such a row never reaches a
  reader by any route. The Routine is told publishing nothing is an acceptable
  outcome, and it has used that.
- `published = 0` on a verified row means "was the lead, is not now". Those rows
  are the **Recent insights** list. So unpublishing a bad story pulls it off the
  lead without also erasing the archive.

### The routes (`_worker.js`)

- **`GET /api/lead-story`** — what the front page reads: the current lead plus
  the previous `LEAD_RECENT` (5) verified stories. Memoised for two minutes per
  isolate. **`body_html` is deliberately not in this payload** — shipping ~13 KB
  of article to every visitor to render a headline puts the whole site's front
  door on the critical path of a story nobody has clicked yet.
- **`GET /api/lead-story/body?slug=…`** — one full story. No slug means "the
  current lead", which is what `/lead` asks for.
- **`/lead` and `/lead/<slug>`** rewrite to the `lead.html` asset. The path
  pattern is `^\/lead(\/[A-Za-z0-9._-]*)?\/?$` — it is also what keeps a
  crafted path out of the asset layer, so widen it carefully.
  **The rewrite target is `/lead`, not `/lead.html`** — see the box below, which
  is not a style note.

> **Never rewrite a route onto a `<name>.html` path.** `wrangler.jsonc` sets no
> `html_handling`, so the assets layer runs Cloudflare's default,
> **`auto-trailing-slash`**: it answers a request for `/lead.html` with a **307 to
> `/lead`**, and `/faq.html` with a 307 to `/faq`. So a rewrite that asks the
> assets layer for `/lead.html` hands the browser a redirect instead of a page —
> and the redirect points at `/lead`, which is the very path the rewrite fires on.
> Worker rewrites, assets 307 back, browser asks again: **ERR_TOO_MANY_REDIRECTS**,
> which is what `/lead` did from the moment it shipped (2026-08-21) until it was
> fixed the same day. `/` had the quieter half of the same bug — rewritten to
> `/front.html`, it bounced every visitor off the canonical URL to `/front`.
> The extensionless path is what the assets layer serves **200** from, so
> `/` → `/front`, `/lead*` → `/lead`, SPA routes → `/`. None of this is visible in
> the worker's own source, which is why **`node tools/test-asset-routing.mjs`**
> exists: it lifts the real rewrite block out of `_worker.js`, models the assets
> layer against the real files on disk, follows the redirects the way a browser
> would, and fails on a target that redirects or a route that cycles. It runs in CI.

`LEAD_CATEGORIES` in the worker is the **only** place a desk name is defined.
A row whose `category` is a string nobody defined falls back to the neutral
"Insight" label rather than inventing a new desk on the front page, so a typo in
a generated row cannot reach the masthead.

### The front page

`paintGeneratedLead()` in `front.html` runs **after** `renderLead()` has already
painted the dated rotation, and it is purely additive. If the fetch fails, the
API is down, no run has published, or the published row has no slug, the reader
keeps the deep-dive lead that is already on screen. **The front page is never
blank because the desk had a bad day** — that is the property to preserve in any
change here.

When a generated story does arrive it replaces the lead outright, and the dots
and arrows are hidden (`#leadCtrls`). That is the point rather than an oversight:
the carousel existed to make a static pool feel like it was moving, and cycling a
fresh story back through week-old ones would rebuild the exact staleness this
replaced. The archive is links under the lead, never a rotation the lead walks
into. `.lead-ctrls[hidden]{display:none}` is load-bearing: the class sets
`display:flex`, which beats the `hidden` attribute on its own.

**The timestamp is the reader's clock, not the desk's.** `leadStamp()` in
`front.html` and `stamp()` in `lead.html` both print the story's `created_at` in
the visitor's own time zone, named — "Aug 21 · 8:58 AM CDT" — via
`toLocaleTimeString`, with a plain 12-hour local fallback if `Intl` is missing.
They used to print `HH:00 UTC`, which is the desk's cron clock and a puzzle for
everyone else: the audience is American fantasy managers, and a stamp they have
to convert answers nothing. The run publishes at :58, so the old version was also
truncating to the wrong hour. Keep both files in step — the same story shows both
stamps as a reader moves from the front page to `/lead`.

The lead's photo band works off `players`, slugged with the same rule
`tools/build-front.mjs` uses, so "Kenneth Walker III" and `kenneth-walker-iii`
both find the same headshot.

**The faces travel with the story.** `front.html`'s own `PLAYERS` cast is built
from the players the *authored* drop pages name — 72 of them — which is the right
cast for those stories and the wrong one here, because a run can name anybody on
the board. It named Justin Jefferson, one of the best-known receivers in the
league, and the front page had no photo of him: a four-player story rendered one
face. So `/api/lead-story` ships the faces it needs alongside the names, out of
`LEAD_FACES` in the worker, and `renderCast()` prefers the page's own entry and
falls back to the one that arrived.

`LEAD_FACES` is in `_worker.js` rather than in `front.html` deliberately. Widening
the page's cast would have cost every visitor about 39 KB on a 150 KB page to
carry photos all but four of them will not see. The worker is never downloaded by
a browser, so the map is free there and only the handful of URLs a story actually
uses travel in the payload.

- Rebuilt by **`node tools/build-worker-faces.mjs`** from `tools/nfl-headshots.json`,
  scoped to the `PROJECTIONS` pool — the desk is required to ground every named
  player there, so it is exactly the set a story can name. 335 of the 407 pool
  players have a headshot; the other 72 simply do not appear in the release.
- **Run it after `merge-projections.mjs` or `build-headshots.mjs`.** A projections
  update that adds or moves a player leaves the map stale, and the symptom is a
  missing or wrongly-captioned face — quiet enough to ship. CI rebuilds it and
  fails on any diff, the same gate `front.html` has.
- The **team comes from `PROJECTIONS`, not from the headshot release**, which is a
  season-start snapshot that goes stale on every trade. A face captioned with the
  wrong club is worse than no face.
- The ESPN id travels too, because `discEl()` tries it before the nfl.com URL, so
  a fallback face is identical to one served from the page's own cast.

### The article page

`lead.html`, one shell for every story, rendered client-side from
`/api/lead-story/body`. The stories are replaced every three hours, so the page
is `noindex,follow`: a search result pointing at one points at something already
gone. Tables in the stored body get an `overflow-x` wrapper added **at render
time**, not in the stored copy, so the authoring contract stays "write a table"
and every past story gains the fix. The sources list is collapsed by default —
on these runs it can run longer than the story it backs.

### One slot, one story

The desk publishes on a three-hour clock and each run retires the one before it,
so a slot should hold exactly one story. On 2026-08-21 slot 165494 held **four**,
twenty minutes apart: the Routine was fired by hand repeatedly while the analyst
desk was being tested. Nothing broke — the newest published row always wins, so
the site was never wrong — but three finished stories were published and buried
within minutes of each other, and anyone watching the front page saw the lead
change four times inside one slot.

**The guard is a D1 trigger, not a line in the Routine's prompt.**

```sql
CREATE TRIGGER lead_story_one_per_slot
BEFORE INSERT ON lead_story FOR EACH ROW
WHEN NEW.published = 1 AND EXISTS (
  SELECT 1 FROM lead_story
   WHERE published = 1 AND verified = 1
     AND created_at/10800000 = NEW.created_at/10800000)
BEGIN SELECT RAISE(ABORT, 'lead_story: this three-hour slot already has a published story. …'); END;
```

It lives in the database on purpose. The prompt is edited by several sessions
independently — it was pinned to one desk and restored 73 seconds later on the
same day — so a rule written there can be lost by the next person who rewrites
it, and nobody would notice until the churn came back. A trigger cannot be
clobbered by a prompt edit, fires whoever does the INSERT, and fails **loudly**
rather than silently demoting a row.

Why the `WHEN` clause is shaped the way it is:

- **It only bites on `published = 1`.** A run that held itself back (`verified=0`,
  `published=0`) is never blocked, which matters because that is the honest
  outcome the desk is told to prefer over publishing something thin.
- **It compares slots, not timestamps.** The normal flow inserts while the
  *previous* story is still published — the retiring `UPDATE` runs after — and
  that row is three hours back, in a different slot, so an ordinary run passes.
- **It requires `verified = 1` on the incumbent.** An unverified row sitting in
  the slot does not block a good story from taking it.

Two escape hatches, both verified against a scratch table before this went on:

1. **Stage it.** Insert with `published=0`, then `&promote=<id>` on the admin
   route. The guard does not fire, and promoting is one batch.
2. **Replace it.** `&pull=<id>` the story you want gone, then re-run. The pulled
   row is `published=0`, so the slot is free and the new insert lands normally.

So a deliberate re-run still works; only an accidental one is stopped.

`/api/admin/lead` reports `slot` on every row, `currentSlot`, and `doubledSlots`
naming any slot holding more than one story, so a past collision is visible
rather than something you infer from timestamps.

### Running the desk by hand

`GET /api/admin/lead?key=<LEADS_EXPORT_KEY>` lists the last 15 rows with a
`state` on each (`LIVE`, `archive`, `held (failed its own gate)`,
`unusable (no slug)`) and reports the live story by reading it back through
`leadStoryPayload()` — the same function the site uses, so the response cannot
disagree with the page.

- `&promote=<id>` makes that row the lead. It sets `verified = 1` too, so it
  can rescue a story the run held back; the response says `overrodeGate: true`
  when it did, because overriding the run's own gate should never be silent.
  A row with no slug is refused: it has no URL, so promoting it would look like
  it worked and change nothing.
- `&pull=<id>` unpublishes that row **and promotes the next-newest verified
  story in the same D1 batch**.

That pairing is the whole reason the route exists. Unpublishing the lead does
**not** promote the previous story — `leadStoryPayload()` asks for
`published = 1` specifically — so `UPDATE lead_story SET published = 0` on its
own drops the front page back to the dated deep-dive rotation. That is exactly
the staleness the generated lead replaced, reintroduced by a half-finished edit
in the D1 console. Both operations therefore go through `LEADS_DB.batch()` as
one transaction, and `pull` chooses its replacement *before* the unpublish, so
there is no window with no lead. If there genuinely is no replacement the
response says so rather than leaving it to be discovered on the site.

Any write clears `_LEAD_CACHE`, or the response would report the state it just
left.

### Category rotation

The Routine walks a fixed seven-desk cycle keyed off the slot number, so topics
rotate rather than drifting back to whatever the model finds easiest:

`player` → `playcaller` → `vegas` → `preseason` → `injury` → `market` → `analyst`

Deterministic on the clock, not on the model's mood. A run whose desk has no
verifiable material that day advances to the next desk and says so in its report
rather than publishing a thin piece to fill the slot.

The cycle length lives in the Routine's prompt (`slot % 7`), not in the worker.
`LEAD_CATEGORIES` only decides what a desk is *called*, so the two can be changed
in either order without breaking a reader: a desk the worker does not know falls
back to the neutral "Insight" label and the story still publishes. Changing the
modulus reshuffles which clock slot lands on which desk. That is fine — nothing
downstream assumes a desk keeps its hour — but it does mean the first cycle after
a change is not a continuation of the last one.

### The analyst desk (added August 2026)

`analyst`, labelled **Analysts vs. Iron Tuna**. Where the most-followed fantasy
analysts sit above or below the consensus sheet, where that lands next to Iron
Tuna's own price, and — the part that makes it a column rather than an aggregator
— why the desk agrees or disagrees. Matthew Berry (Fantasy Life), Mike Clay
(ESPN), and anyone else whose public position on a player can be quoted and dated.

**The sourcing constraint is the whole design of this desk, so it is written down
here rather than only in the prompt.** The Routine cannot read these analysts'
boards directly: `fantasylife.com` and `espn.com` are both blocked by the egress
proxy, the same wall the camp desk hit (§12), and the paid ranking sets behind
them are not ours to republish in bulk regardless. So the desk works the way a
column does, not the way a scraper does:

- **The analyst's side is a quote.** One specific, attributed, dated position
  — a rank, a round, a stated take — sourced from WebSearch result content
  attributed to a reputable outlet, which is the same verification standard the
  camp desk already publishes on. Never a reconstructed ranking list, never a
  position remembered from training data, and never more of anyone's ranking set
  than the argument actually needs.
- **Iron Tuna's side is computed.** The dollar figure, the positional rank, and
  the gap all come off the site's own board that run, the same way every other
  desk builds its numbers. This is what keeps the piece checkable: only one of
  the two sides is a claim about what somebody said, and that side carries a
  citation.
- **"Above consensus" has a fixed meaning here:** above the committed
  `PROJECTIONS` set, which is the odds-blind average the site already treats as
  the consensus baseline (§9c). It is not "above Iron Tuna" — Iron Tuna's
  shipped values are blended toward the market and are themselves off consensus,
  which is frequently the actual story.
- **The agree/disagree call is mandatory and must be a call.** A run that lists
  three analysts and declines to say who is right has written an aggregator post,
  which is the failure mode this desk is most prone to.

It is a *running* story: each run reads the prior `category = 'analyst'` rows and
continues the thread rather than restarting it — revisiting a call when news has
moved it, and not re-litigating the same analyst-player pairing while nothing has
changed.

#### The standing column: `/analyst-desk`

The lead rotation is ephemeral by design. `/lead` is `noindex` and its story is
replaced every three hours, so on its own the analyst desk would have been a
column whose back catalogue existed only as five "Recent insights" links. The
standing page is where it accumulates.

`analyst-desk.html`, served at `/analyst-desk` (Pages resolves the extensionless
path; no worker route needed). It is **indexed**, which is the deliberate
opposite of `lead.html` — that page is `noindex` because a search result would
point at a story already replaced, while this URL is stable and only grows. The
page is client-rendered from `/api/analyst-column`, so what a crawler actually
sees is the standing copy above the entries: what the column is, how to read it,
and the sourcing rules. That is the evergreen half, and it is the half worth
ranking. **If you ever need the entries themselves indexed, that is a
server-render, not a robots-tag change.**

`GET /api/analyst-column` returns every verified `category = 'analyst'` row,
newest first, capped at `ANALYST_MAX` (60), memoised two minutes per isolate the
same way the lead is. It deliberately does **not** select `body_html`: the page
links to `/lead/<slug>` for the article, and shipping sixty stories to render a
list of headlines is the same mistake `/api/lead-story` was written to avoid.
The admin route's cache-bust clears `_ANALYST_CACHE` alongside `_LEAD_CACHE`,
because `&promote=` sets `verified = 1` and that is exactly what admits a row to
this column.

**The `calls` column.** The prose lives in `body_html`; `calls` is the
structured summary the page lays out as cards and tallies into the record:

```json
[{"analyst":"Mike Clay","outlet":"ESPN","player":"Kenneth Walker III",
  "pos":"RB","team":"KC","their":"RB7, a round above the sheet",
  "ours":"$24 max bid, RB14","stance":"disagree",
  "why":"The odds do not back the workload the ranking implies"}]
```

It was added after `lead_story` already existed and arrives the way the
analytics tables do: **lazily, once per isolate, with nothing to run by hand.**
`ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` in SQLite, so the
duplicate-column error on every run after the first *is* the success case and is
swallowed on purpose. If the DDL never lands at all — a binding without write
access, a D1 that refuses it — the payload re-asks for the shape that has always
existed and the column publishes without its call cards. `tools/test-analyst-column.mjs`
covers both states.

Not every analyst story has calls to store. A piece about analyst **track
records** rather than about a player's price has no "they say $X, we say $Y" to
score, so `calls` is legitimately NULL and the entry lists on the column by
headline alone, feeding nothing into the record table. That is correct rather
than a gap, and the prompt says so explicitly, because the alternative is a run
manufacturing player calls to fill a field.

Everything about `calls` is optional and defensive, because an autonomous run
writes it and no schema enforces it at write time: malformed JSON, an object
where a list belongs, junk entries, forty calls in one row, a verdict word
nobody defined. A call with no `analyst` or no `player` is dropped outright,
which is the desk's own rule made structural — this column may not show a take
with nobody attached to it. `ANALYST_STANCES` owns the verdict vocabulary the
way `LEAD_CATEGORIES` owns the desk names: an unrecognised `stance` still
renders its call, it just carries no chip and scores in no column.

**The record table** is computed in the worker (`analystScoreboard`), not the
page, because it is arithmetic over rows the payload already holds and two
implementations of one tally is one too many. It groups case-insensitively, so
"mike clay" and "Mike Clay" are one row.

One editorial note that is load-bearing enough to live in the page copy: **an
analyst being above consensus is not the same as being above us.** Iron Tuna's
shipped values are blended toward the book, so the site is itself off consensus
on plenty of players. The page says so in its "How to read this" box, and the
desk brief pins the same definition.

#### The Routine side, which is already on

**Done, 2026-08-21.** The Routine (`trig_011LYewcPUQikF8izFsN2LAr`, "Iron Tuna —
lead story refresh (every 3h)") runs all seven desks and writes `calls`. What
follows is the record of what its prompt now says, because the prompt is not in
this repo and nothing else here would tell you.

The ordering rule still matters if this is ever redone: **flip the Routine only
after the worker side is on `main` and deployed.** A run that stores
`category = 'analyst'` against a worker that has never heard of the desk still
publishes, but it publishes under the fallback "Insight" badge. The same trap
has a second door now — the prompt was flipped to seven desks a few hours
*before* the standing column existed, so its `INSERT` did not name `calls` and
its analyst brief never mentioned it. Nothing would have failed: the story would
have published, listed on `/analyst-desk` by headline, and quietly carried no
cards and no line in the record table. **When a change adds a column the desk
must fill, the prompt edit is part of that change, not a follow-up.**

The four edits, as they now stand:

1. In the ROTATE THE DESK block, `DESKS` becomes seven entries and the modulus
   moves with it:

   ```
   DESKS = [player, playcaller, vegas, preseason, injury, market, analyst]
   ```
   `desk = DESKS[slot % 7]`, and the allowed `category` values gain `analyst`.

2. Add the desk to the list of what each desk means:

   > **analyst** — where the most-followed fantasy analysts sit versus the
   > consensus sheet, and where that lands next to Iron Tuna's price. Name them:
   > Matthew Berry (Fantasy Life), Mike Clay (ESPN), and others whose public
   > position on a player you can quote and date. **You cannot read their boards
   > directly — fantasylife.com and espn.com are blocked by the egress proxy —
   > and their paid ranking sets are not ours to republish anyway.** So take the
   > analyst's side from WebSearch result content attributed to a reputable
   > outlet, one specific dated position per analyst (a rank, a round, a stated
   > take), quoted only as far as the argument needs. Never reconstruct a
   > ranking list, and never state an analyst's position from memory. Compute
   > Iron Tuna's side off the board this run, as every other desk does. "Above
   > consensus" means above the committed `PROJECTIONS` baseline, not above Iron
   > Tuna, whose shipped values are already blended toward the market. Then make
   > the call: say whether the desk agrees or disagrees with each analyst and
   > why, in the site's own terms — usage, play-caller history, the odds, the
   > replacement level. A run that lists three takes without picking a side has
   > written an aggregator post and failed. Read the prior `analyst` rows
   > (`SELECT slug,title,dek,players FROM lead_story WHERE category = 'analyst'
   > ORDER BY created_at DESC LIMIT 6`) and continue that thread: revisit a call
   > news has moved, and do not re-run the same analyst-player pairing while
   > nothing has changed. If you cannot verify a single dated position this run,
   > skip to the next desk and say so — this desk in particular must never be
   > written from memory, because an unsourced claim here puts words in a real
   > person's mouth.

3. A dedicated section on the `calls` column, and an `INSERT` that names it as
   `?9`. `stance` must be exactly `agree`, `disagree` or `partial`; `analyst`
   and `player` are both required. The section says out loud that getting this
   wrong costs the cards and the record row while the entry still lists, so the
   run has no visible failure to notice — the reason it needs saying at all. The
   prompt also tells the run to `ALTER TABLE lead_story ADD COLUMN calls TEXT`
   itself if the `INSERT` comes back `no such column`. Its self-check runs
   through the **D1 connector**, not a WebFetch to the site — see "What the
   first runs taught" below for why that matters.

4. **"Spread the calls across analysts"** (added after the first entry). At
   least three different analysts per entry and no single analyst more than half
   the calls; search per analyst rather than mining one risers-and-fallers
   roundup; check the running record and prefer whoever the column is thin on.
   It carries a roster to draw from, names Berry and Clay as the two the site
   most wants represented, and asks the report to name any analyst it tried to
   source and could not.

   **The escape hatch is the load-bearing half and it overrides the quota.** If
   only two analysts can be sourced, the entry has two; if one, it writes fewer
   calls and says so. A spread target on a desk that cannot always reach half
   its sources is exactly the instruction that manufactures attributions, so the
   prompt says outright that three well-sourced calls across three analysts beat
   eight from one column, and both beat one invented one. Never loosen that
   sentence to make the quota bite harder.

   One mechanical rule rides along: spell each analyst's name identically every
   time, because `analystScoreboard()` groups by name and "Matt Berry" would
   split Berry into two rows.

#### The headline check (2026-08-22)

The prompt ends with four mechanical checks to run on the exact title string
immediately before the INSERT, not while drafting: count the characters (under
110), search for an em dash, confirm one sentence, and confirm it states the
finding.

All four were already stated elsewhere in the prompt as prose. A headline still
shipped at **114 characters with an em dash, leading with the setup** — three
violations in one line. Rules a run reads once at the top and then has to
remember while composing are not the same as a checklist it runs against the
finished string, which is why this is a separate step at the end rather than
another sentence in the style section.

The fourth check is the one that needs a test rather than a rule, because
"leads with the finding" is a judgement: **would this headline read exactly the
same if the analysis had come out the other way?** If yes, it is the setup. The
prompt carries the real example. "Five seasons produced five different winners,
which is what luck looks like" was the null result the piece started from;
"Kevin English has beaten the field average ten years running" was what it
arrived at. Both were true of the same story.

The self-check query now selects `length(title) AS tlen` so the run sees the
count in its own verification step, and the report-back asks for the headline
with its character count.

#### The reading view, and the column as an index (2026-08-22)

The first cut of `/analyst-desk` laid every entry out in full, call cards and
all. With two entries that was already one long scroll of stacked stories, and it
read as a feed rather than a column. The split now is:

- **`/lead/<slug>` is the story.** One piece, on its own, on a **white page in
  near-black type** — a reading view, deliberately unlike the dark chrome the
  rest of the site uses. Under the article it carries that story's own call
  cards, then the method box and sources, then **Continue reading**: the other
  stories, as links, for anyone who wants to keep going.
- **`/analyst-desk` is the index.** The standing copy, the record table, and one
  compact item per entry: kicker, date, headline, dek, and a summary line naming
  the analysts it argues with. No call cards. Every item links to its story.

The white page is `lead.html`'s own `:root`, so it applies to **every** lead
story, not only analyst ones. Three things had to change beyond swapping the
background: `--teal` darkens from `#2dd4a3` (about 1.9:1 on white, unreadable) to
`#0d7a5f`, `--danger` likewise, and the wordmark's metal gradient is inverted to
dark stops or the logo disappears. `tools/test-analyst-column.mjs` pins all
three, because "make it light" is the kind of change a later edit reverts by
copying a palette from another page.

`calls` reaches the story page through `/api/lead-story/body` as a **separate
query in its own `try`**, run only when the row's category is `analyst`. It is
not folded into the main SELECT on purpose: `calls` is a late addition to the
table, and an article page that 500s because one optional column is missing
would be far worse than an article page with no cards.

#### One story per run

The desk's prompt opens with this rule and the Insert section repeats it,
because it was learned the expensive way. On 2026-08-21 a single run inserted
**two** analyst stories seven minutes apart (ids 21 and 22). The second retired
the first, and because the run never re-read what it had just published, the two
scored the *same* analyst position on the *same* player in opposite directions:
Eisenberg on Chris Olave, agree in one and disagree in the other, off identical
numbers ($24, WR17). Both went live on the standing column and sat there
contradicting each other.

The disagreement was not about the player at all. It was about whether $24 at
WR17 is a late-second buy or a fourth-round one — a round-to-dollar conversion
the desk had never pinned down. The prompt now asks any run that converts rounds
to dollars to state the conversion in its method line, so the next one can match
it.

Two guards followed: a run that has inserted is finished writing, and the
self-check is explicitly read-only, since "verify your work" is the natural place
for a model to notice something it would rather have written differently and fix
it by publishing again. **A second insert is not a correction; it is a second
published story.**

Entry 22 was retracted on 2026-08-22 by setting `verified = 0`. Note that
`published = 0` was *not* enough and the admin route's `&pull=` would not have
worked: the row was already unpublished, and what kept it on `/analyst-desk` is
that the column selects on `verified = 1` alone. **`verified` is the flag that
governs the standing column; `published` only governs the front-page lead.**
It slightly overloads `verified`, whose documented meaning is "the run failed its
own gate" rather than "a human retracted this", but it is the only lever that
removes a row from the column while keeping it in the table.

#### What the first runs taught, 2026-08-21

Three findings from firing the desk by hand, all of which outlived the test:

- **A `fire_trigger` `text` override loses to the prompt.** Firing with an
  appended message saying "write for the `analyst` desk, ignore the clock" produced
  a `player` story: the prompt's own "ROTATE THE DESK — this is required, not a
  preference" won. To force a desk, edit the prompt itself, fire, and restore it
  immediately. The pin was live for 73 seconds and the restore is the step you
  cannot forget, or the next cron writes the pinned desk too.
- **The Routine has no pre-approved tool list**, unlike the other three. Its
  self-check `WebFetch` to irontuna.com sat in `REQUIRES_ACTION` waiting for a
  human who was never going to come, *after* the story had already published. So
  every scheduled run had been quietly skipping its own verification. The
  self-check now goes through D1, and the prompt says never to end a run parked
  on a permission request. Giving the Routine an `allowed_tools` preset would fix
  the underlying cause.
- **The desk skewed to one writer.** The first entry took six of eight calls
  from a single CBS column, because one aggregated risers-and-fallers piece is
  the cheapest thing to find. Hence edit 4 above. Judge the skew off the record
  table on `/analyst-desk`, which is exactly what it is for.
- **A scheduled slot can produce nothing at all.** The 21:58 UTC run on
  2026-08-21 wrote no row, not even a held `verified = 0` one, while every other
  slot that night walked the cycle correctly. A missing story is invisible from
  the site (the previous lead simply stays up) and invisible in D1 (there is no
  row to find). The only way to notice is a gap in the `created_at` sequence
  against the 3-hour cadence, so check for that rather than assuming every slot
  produced something.

The first entry is worth reading as the reference for what this desk should
sound like: `analyst-desk-august-moves-2026-08-21-20`. Its lead argues that the
odds had *already* paid Kyler Murray 32.1 points for winning the Vikings job on
Aug 11, so an Aug 17 upgrade on that news double-counts it, and he still lands
3.9 points short of the QB14 cutoff. That is the shape to aim for: the analyst's
claim, the board's number, and a reason they differ that a reader cannot get
from either side alone.

### Tests

`node tools/test-analyst-column.mjs` (59 assertions) covers the standing column:
the two query shapes, every malformed `calls` a run could store, the record
tally, and the page's own contract (indexable, in the sitemap, escapes what the
desk wrote, and degrades to standing copy when the API is dead).

`node tools/test-lead-story.mjs` (58 assertions, no network, no browser). It
evaluates the real section out of `_worker.js` rather than a copy, and most of it
is failure modes: no row, an unverified row, a row with no slug, an undefined
category, malformed JSON in a column, D1 throwing on `prepare`, D1 rejecting
mid-query, no database bound. **Every one must come back as "no story" rather
than as an exception**, because an exception here is a blank hero on the front
door. It also pins the route pattern against traversal and checks that the front
page still paints its own lead first.

### The countdown has to know the cron, not the clock

Found on 2026-08-22 by rendering the real front page against the live D1 row:
the lead read **"next insight in 37m"** when the next story was 95 minutes away.
It said something wrong like that in **every slot it has ever rendered**.

The cause is that a slot and a run are not the same instant. Slots are three
hours from the epoch, so they turn over at 00/03/06/09/12/15/18/21 UTC — but the
Routine's cron is `58 */3 * * *`, so a run **fires 58 minutes into the slot** and
takes about eight more to write and verify. `msToNextSlot()` counts down to the
boundary, which is right for the deep-dive rotation that genuinely turns over
there, and about an hour early for the generated lead. The lead now uses its own
`msToNextLead()`, built from `LEAD_CRON_MS` and `LEAD_WRITE_MS`.

The same mistake had a second, quieter half. The open-tab refresh looked for a
new story in the six minutes **after** the boundary — an hour before the run
fires — so it always found the same story and then waited three hours to look
again. An open tab could sit two hours stale. It now asks the question that
actually decides it: *is the story on screen from an older slot than the one we
are in?*, the same `Math.floor(ms / SLOT_MS)` the worker and the admin desk use.
That is immune to a run being early, late, or held back, where any fixed window
is not. It is capped at 20 looks so a run that publishes nothing — an outcome the
desk is explicitly allowed to choose — cannot leave every open tab polling for
the rest of the slot.

**If the cron ever changes, `LEAD_CRON_MS` changes with it.** `test-lead-story`
asserts the page's value is 58 and pins the arithmetic against slot 165501, but
nothing can read the Routine's schedule from inside this repo, so that assertion
is a reminder rather than a real check.

#### `LEAD_WRITE_MS` is measured, and the first value was guessed wrong

The first cut of the fix above guessed **eight minutes** from firing to a
published row. The 15:58 run then published at **16:12**, and pulling the whole
table showed eight was below *every* observation. Across the nine scheduled runs
on record the write took **10, 11, 12, 13, 14, 16, 21, 22 and 27 minutes** —
median 14, mean 16.2. It is now 15. (The 58- and 71-minute offsets in the table
are manual `fire_trigger` calls, not the cron; they are not evidence about the
desk's speed and must be excluded when re-measuring.)

Re-measure with:

```sql
SELECT id, category, datetime(created_at/1000,'unixepoch') AS created,
       (created_at % 10800000)/60000 - 58 AS write_min
FROM lead_story WHERE verified=1 ORDER BY created_at DESC LIMIT 12;
```

**The countdown estimate and the refresh trigger are deliberately different
numbers**, and collapsing them back into one is the mistake to avoid. The
countdown is shown to a person and may be a few minutes out either way. The
refresh must NOT wait on it: it fires from `leadFiredAt` — the moment the run
starts — because a story that lands in 10 minutes should not sit unseen for 5
more while an estimate catches up. The looks are spaced at two minutes, matching
`/api/lead-story`'s own memo (asking faster can only return the same cached
answer), and capped at 20, which covers the 40 minutes after firing — past the
27-minute worst case — and then stops.

## 18. August 2026: traffic numbers on /admin

`/admin` used to answer "how much money" and had nothing to say about "how many
people". It does now: a **Traffic** section above Sales & referrals leading with
**unique daily users**, plus page views, top pages, where arrivals came from, and
the site's named click events, over a 7 / 30 / 90-day window.

### Counting happens in the Worker, not in a script tag

`logPageView()` runs inside `fetch()` on any successful HTML response. That was
the deciding constraint: the site is ~100 static `.html` files plus the SPA, and
a beacon would have meant editing every one of them and re-editing each new
insight page forever. `run_worker_first` means every request already passes
through `_worker.js`, so counting there covers the whole site at once, keeps
counting for readers who block scripts, and cannot be missed off a new page.

The insert is wrapped in `ctx.waitUntil()`, so it never sits between the reader
and their HTML, and every path through it swallows its own errors. **A counter
that can break a page view is worse than no counter** — `tools/test-analytics.mjs`
spends a third of its assertions on exactly that (D1 throwing, D1 missing, D1
rejecting mid-query: the page still serves, intact, every time).

Not counted, because none of them are a person reading the site: bots and AI
crawlers (`BOT_RE`), prefetch/prerender hits, framed loads, `/admin*` itself, and
anything that is not a 200 HTML GET.

### A "visitor" is a day, not a person — so the unit is the unique DAILY user

`visitorHash()` is `SHA-256(day + LEADS_EXPORT_KEY + IP + user-agent)`, truncated.
No cookie, no stored IP, no stored user-agent — the raw values never reach D1,
and the salt rotates at UTC midnight so yesterday's hashes cannot be matched to
today's. That is the same shape Plausible and Fathom use, and it keeps the
`privacy.html` promise intact.

That rotation decides what can honestly be reported. Within one UTC day the hash
is stable, so **distinct visitors on a single day is a true unique-user count** —
which is why it is the headline tile and the leading chart series. Across a
window it is not: the day is baked into the hash, so `COUNT(DISTINCT visitor)`
over 30 days is exactly the sum of each day's uniques. **Someone who comes back on
three days is three user-days, not one returning person.** The wide number is
therefore labelled `userDays` in the payload and "User-days" on the tile, rather
than being passed off as an audience size.

The summary tiles (today, average/day, best day, user-days) are computed in the
worker **off the daily grid**, not re-queried, so the tiles and the chart cannot
tell different stories.

If true multi-day uniques ever matter more than the privacy property, the salt is
the one line to change — and every "user-days" label has to change with it.

### The operator's own browsing is flagged, not counted

On a site this size the person reading the dashboard was a large share of what
the dashboard reported. `/admin*` was already skipped, but browsing the actual
site was not.

Rows now carry `internal`, and every read in `/api/admin/traffic` filters
`internal = 0` — totals, the daily grid, top pages, sources, countries and the
`site_events` clicks alike, so no table on the page can disagree with another
about who counts. Rows are **recorded and filtered, never dropped**: the
exclusion is reversible, `&includeMe=1` shows the unfiltered numbers, and
`out.excluded` puts the size of what was held back on the page instead of asking
the operator to take it on trust.

The mark is a cookie, because there is nothing stable to keep a list of — a
visitor id is minted fresh every UTC day and is meant to be unmatchable. It is
tri-state on purpose:

- absent → reaching `/api/admin/traffic` with a valid key sets `it_owner=1`.
  Unlocking `/admin` is enough; there is no step to remember.
- `1` → excluded. The dashboard does not re-issue the cookie.
- `0` → counted like anyone else, set by the "Count my visits" button
  (`GET /api/admin/exclude-me?key=…&on=0`). **This has to stick**, or opening the
  dashboard would silently undo the operator's choice — hence `0` rather than
  clearing the cookie.

`HttpOnly; Secure; SameSite=Lax`, two years. It is per browser: the note under
the tiles says so, and the fix for a second device is to open `/admin` there.

### What is stored

Two D1 tables, created lazily on first use (`ANALYTICS_DDL`, cached per isolate,
with a one-at-a-time fallback for D1 versions that refuse DDL inside a batch) —
so there is no migration step to remember and nothing to run by hand:

- `page_views` — `ts, day, path, visitor, source, country, internal`. `source` is
  `utm_source` if present, else the referring host minus `www.`, else empty for
  direct. Self-referrals are dropped so the list is arrivals, not internal hops.
- `site_events` — `ts, day, event, uid, path, props, internal`, fed by `/api/track`.

`internal` was added after both tables were live, so it also appears in
`ANALYTICS_MIGRATIONS` — `ALTER TABLE … ADD COLUMN`, the same shape as
`x_posts.est_cost`. Those run one at a time and never in a batch: an already
applied migration throws "duplicate column", and inside a batch that one throw
would take the others with it. Existing rows default to `0`, i.e. counted, which
is the right way to be wrong about traffic recorded before the flag existed.

`/api/track` already existed and already had ~40 call sites in `index.html`
(`nav_click`, `paywall_viewed`, the `coach_*` family). It forwarded to
`ANALYTICS_WEBHOOK` if that was set and otherwise **dropped everything on the
floor** — the events were being collected and discarded. It now also writes to
D1, rate-limited per IP, and the webhook forward is unchanged for anyone relying
on it. The dead `window.posthog` branch in `index.html` is still dead; PostHog
has never been loaded on the site.

The daily 11:00 cron prunes both tables to 180 days (`pruneAnalytics`), so this
cannot grow without bound.

### Reading it back

`GET /api/admin/traffic?key=<LEADS_EXPORT_KEY>&days=<1-90>` — same key gate as
the other admin routes. `&includeMe=1` drops the `internal = 0` filter for one
read without touching the flag. `GET /api/admin/exclude-me?key=…&on=0|1` moves
the flag; GET so it works from an address bar, matching `/api/admin/grant`. It is
deliberately **separate** from
`/api/admin/dashboard`: that one pages through Stripe and can be slow or
misconfigured, and the traffic numbers should not wait on money numbers to
render. `admin.html` fetches both independently and the chart is now one
`lineChart()` used by both sections.

### Tests

`node tools/test-analytics.mjs` (78 assertions, no network, no browser), wired
into `.github/workflows/checks.yml` — it existed from the start but was
honour-system until Aug 2026. It drives the real `_worker.js` over an in-memory
SQLite standing in for D1, so the SQL is actually executed rather than described.
Beyond the never-break-the-page cases above, it pins who gets counted, that one
person on one day is one unique user, that no row contains an IP or user-agent,
and that the admin read stays gated.

The unique-user and exclusion sections seed SQLite directly, because the worker
can only ever write "now" and the whole question is what happens across days.
Two of them are worth knowing about before editing:

- the flag lifecycle is tested end to end, including that `it_owner=0` survives
  a dashboard load — the one bug that would quietly re-exclude a browser the
  operator had deliberately opted back in.
- the migration section re-imports `_worker.js` under a query string to get a
  fresh `__analyticsReady` cache, then drives it against a table built without
  `internal`. That is the only way to exercise the path a live D1 actually takes;
  a second plain import would find the cache already warm and skip it.

---

## 19. August 2026: the planner spends the budget it is given

Section 14 solved the Ideal Team's *starter selection* exactly. It did not fix
what the planner handed that solver to spend, and three faults in the budget
arithmetic were still live on `main`. Measured on the real board with
`node tools/test-planner-budget.mjs`, at the default 12-team $200 auction:

| model | before | after |
|---|---|---|
| ideal | $207 billed on a $200 board, 2097 pts | $200, 2075 |
| balanced | $9 unspent, 1895 | $0, **1990** |
| heroRB | $28 unspent, 2001 | $0, **2048** |
| robustRB | $22 unspent, 1942 | $0, **2070** |
| robustWR | $12 unspent, 1834 | $0, **1975** |
| zeroRB | $30 unspent, 1969 | $0, **2015** |
| heroWR | $30 unspent, 1994 | $0, **2036** |
| eliteTE | $21 unspent, 1898 | $0, **1984** |
| heroQB | $29 unspent, 1994 | $0, **2052** |

`ideal` going **down** is the correction, not a regression: it was billing $207
against a $200 budget and reporting `feasible: true`, so its old 2097 was bought
with money the roster did not have.

### The three faults

1. **The Starters-vs-Depth knob withheld money the bench could not spend.**
   `extraBench` used the raw `alloc * 0.35` — about 19% of the budget at the
   default — while `backupCap` is sized from `depthBase = max(0, alloc - 0.55)
   /0.45 * 6`, which is **exactly 0 at that same default**. The two halves were
   written against different assumptions and never reconciled, so roughly $30 of
   a $200 board was taken off the starters and handed to a bench structurally
   capped near the minimum bid. Every withheld dollar scored zero, because
   `starterPoints` — the number the models are ranked and displayed by — counts
   starters only. Both halves now key off the same midpoint.

2. **`reserveBench` assumed $1 bench seats that mostly do not exist.** The bench
   is billed at `max(position floor, price)` and the floors are QB $2 and RB $4,
   so a 7-seat bench that reserved $7 went on to bill $14. It is now costed the
   way it will be charged, from the cheapest player still available at each bench
   position. The composition is estimated from the roster shape (the starters do
   not exist yet) and trimmed **most expensive first**: a model that forces
   starters can push a seat onto a dearer position, and guessing low there bills
   past the budget with no cheaper body left to downgrade to.

3. **The bench budgeted at one price and billed at another.** It compared raw
   `priceOf` while reporting `max(floor, priceOf)`, so a plan could bill more
   than `benchBudget` and still report `feasible: true`. `benchPrice()` is now
   the single definition, used by the budget check, the upgrade loop and the
   billing alike.

A final downgrade pass makes overspend **structurally impossible** rather than
merely unlikely: if the bench still bills over, it sheds the dollar that costs
the fewest points until it fits. A plan a drafter cannot execute is worse than a
bench point.

### The one known residual

Away from the default allocation, `extraBench` can still withhold more than
`backupCap` lets the bench absorb, so up to $19 goes unspent at the far Depth
end of the knob. That is the tail of fault 1: the same money used to go unspent
at *every* setting, the default included, where it ran to $30. Handing the
leftover back needs the starter solve to run a second time. The test bounds it
rather than asserting it away, so a regression that makes it worse still fails.

### What this moved that is not in the table

`switchPrice()` — the YOU value on every player row — is a binary search over
`buildOptimalPlan`, so the reserve fix moved it too, and PR #66 had just changed
the board's colouring to grade `Proj` against **YOU** rather than against Value.
The two changes were written independently, hours apart, and neither anticipated
the other, so the shift was measured rather than argued about. Over the top 120
priced players, comparing YOU before and after:

| | |
|---|---|
| median change | **$0** |
| mean change | **-$0.20** |
| range | -$5 to +$4 |
| rows whose colour flipped | 11 of 120 |
| RED before → after | **72 → 69** |

**It is a non-event, and it goes the opposite way to the obvious guess.** A
higher reserve lowers the ceiling the search runs against, so the intuition is
that YOU drops and more rows turn red. In practice the reserve also frees the
starter solve from stranding money, the two effects very nearly cancel, and the
red count went *down* by three. No retuning is called for. Do not re-derive this
from first principles — the first-principles answer is wrong.

What that measurement did surface, and what is worth a look on its own terms: of
the 76 players the optimiser priced on a fresh board, **72 came back RED and not
one came back GREEN**, both before and after. Under the pre-#66 rule the same
board produced a mix. That is #66's rule meeting an empty roster, not anything
section 19 did, and it is the opposite of what that PR set out to achieve.
(Caveat on the number: this counted raw `switchPrice`, while the app runs a
tail-extrapolation pass afterwards that gives a `personalValue` to players the
optimiser never priced. The 76 are exact; the other 44 are not covered.)

`switchReserve` is **gone**, along with the five call sites that passed it. It
selected the better of two bench reserves for the YOU-value and opponent paths,
and the real reserve is now unconditional, so it had nothing left to switch.
Removing it shifted `opts` into position 11 at three call sites — if `noCap` ever
appears to stop working, check that first.

### Verifying a change here

`node tools/test-planner-budget.mjs [--report]` sweeps all nine shape models
across both strategy knobs and asserts no overspend anywhere and nothing
stranded on the default board. It drives real Chromium against an instrumented
copy of the app for the same reason `build-front-analysis.mjs` does: the planner
has no module boundary and depends on the whole valuation pipeline ahead of it,
so anything reimplemented in Node measures a copy rather than what ships. It
self-skips without playwright and a browser, which is why CI does not run it.

**It sweeps only the app's own budget on purpose.** Player prices arrive from
the valuation pipeline already renormalised to it, so overriding `cfg.budget`
alone plans a $300 draft with $200-scale prices and reports a shortfall no
reader could ever see. An earlier version of this test did exactly that and
produced a page of impressive, meaningless failures.

**Re-run `node tools/build-front-analysis.mjs` after any change here.** The front
page's "The Build" desk is computed from the Ideal Team, so a planner change
that is not followed by a rebuild leaves the site quoting a lineup the app no
longer produces. That is what this change did to it: $192/125.4 became
$183/122.1.

---

## 20. August 2026: what the board grades a player name against

The name on the cheat sheet and the draft board is coloured by comparing **Proj**
(the likely market price) against what the player is worth. Which number stands
for "worth" has now been wrong twice, so the history is the documentation.

### Where it landed

`boardValue(p, value, config)` — **Value, plus a scarcity premium.** On a fresh
default board that renders 37 red, 58 green, 137 neutral out of 232.

The premium is added in exactly two cases, and it takes the larger rather than
stacking them, because they are two readings of the same scarcity:

1. **The plan needs him and his replacement is overpriced.** `planPremium`, built
   in `_basePersonalized` where the optimal plan and the pool both exist. If you
   skip a player the plan puts in an open starting slot, you take the next man at
   his position the plan has not already claimed, and you pay that man's asking
   price. So you should pay above Value for the one you want by as much as the
   market is overcharging for the one you would settle for: `repAsk - repVal`,
   capped at 10% of the budget. It is an indifference argument and needs no tuned
   constant. When replacements are fairly priced there is nothing to pay up for,
   and the premium is correctly zero.
2. **He stands alone above a real positional cliff.** `scarcityPremium(fl,
   budget)`, from the existing `scarcityFlags` cliff detector, capped at 15%.
   This applies whether or not this particular plan claims him.

On the live board six players earn one and five are lifted out of red: Josh Allen,
Gibbs, Nacua, McBride, Bowers.

### The two things that were wrong

**Value alone** paints a star red for costing more than his vacuum price even
when he is the one player holding your starting lineup together. That is what the
premium fixes.

**Grading against YOU (`personalValue`) is the trap.** PR #66 tried it, on the
stated premise that "for positions with scarcity, YOU will often exceed Value".
**That premise is false and the code cannot work.** YOU is `switchPrice`, an
*indifference* price — the most you can pay before the player stops improving
your lineup — so it is structurally at or below Value. Measured on a fresh board:

| YOU vs Value | rows |
|---|---|
| YOU > Value | **3 of 232**, by at most $1 |
| YOU < Value | 81, down to -$15 |
| YOU = Value | 148 (the null-`personalValue` fallback) |

Grading against it can therefore only ever paint **more** red, never less. It did:
red 42 → 89, green 53 → 11. A variant grading against `max(Value, YOU)` returns
the pre-#66 numbers exactly, because YOU never meaningfully exceeds Value.

**Do not reach for YOU again.** It is a bidding ceiling, not a grade. If you want
a "worth to me" number that can legitimately exceed Value, it needs a different
computation, not a different comparison — which is what the plan premium above is.

### Keep these three in step

The colour, the CSV/AI `flag` field, and the coach's legend all describe the same
rule, and a reader who gets two different answers to "why is he red" has found a
bug. All three now route through `boardValue`. `tools/test-board-colour.mjs`
(23 assertions, no browser, runs in CI) pins the premium's shape and guards
against the YOU comparison coming back.

### A related fix

`nameTitle` — the sentence explaining why a name is the colour it is — was
computed in three places and **rendered in none**. Every explanation of red and
green had been invisible for as long as it has existed. It is now the name's
`title`, with the bye week appended behind it, so hovering Josh Allen reads:
"Good buy: the $49 price is about $19 under the $68 he is worth on your board.
That includes a $26 scarcity premium: he stands above a 33-point drop at QB.
Bye week 7."

---

## 21. August 2026: the discovery layer (analytics, structured data, crawlability)

Three separate things decide whether the site is found and whether being found
can be measured. All three are now generated by one idempotent tool:

```
node tools/build-seo.mjs            # writes
node tools/build-seo.mjs --check    # writes nothing, exits 1 if anything is stale
node tools/test-seo.mjs             # 35 assertions over the result
```

**Run `build-seo.mjs` whenever a page is added**, alongside `build-front.mjs`.
Running it twice changes nothing; every edit it makes is idempotent, and the
JSON-LD it owns is marked `data-seo="build-seo"` so it can rewrite its own output
and will never touch the hand-written blocks in `index.html` or `faq.html`.

**The Google tag was only half installed.** Every page carried the Google Ads tag
(`AW-18397866361`) and no page carried GA4, so Analytics reported the property as
untagged and collected nothing. The loader stays on the Ads id — gtag.js is one
library and a second `config` simply registers a second destination — and every
public page now configures both. `admin.html` is deliberately excluded: counting
the operator's own console as site traffic is the same drift the first-party
counter in §18 already guards against. **`analyst-desk.html` is NOT excluded.** It
reads like an internal tool and it is not; it is a deliberately indexed public
column, it belongs in the sitemap, and `test-analyst-column.mjs` asserts both.

**Ads and Analytics do not share events.** The Stripe success return fires two
things now, not one: the Ads conversion and a GA4 `purchase`. Both are keyed on
the checkout-session id as `transaction_id` so a revisited success URL cannot
double-count, and both sit behind the same server-verified `/api/checkout/verify`
response. Without the GA4 half, Analytics sees a buyer's session as ordinary
traffic and no channel or landing page can ever be shown to have paid off.

**The camp desk was invisible to every crawler that does not run JavaScript.**
All 24 `auction-watch-*` pages were built on the client out of `var REPORTS`, so
the served HTML contained no `<a href>` pointing at any of them — they were
reachable only from `sitemap.xml`. Googlebot renders JS on a second pass, but
Bing and the AI answer engines `robots.txt` explicitly invites (GPTBot,
PerplexityBot, ClaudeBot) generally do not, so the site was courting exactly the
crawlers that could not see a quarter of its content. `build-front.mjs` now
pre-renders `campNote`/`campFeat`/`campList` into `front.html`, and the client
render clears `campList` before refilling it — **without that clear it appends a
second copy of every row.** What a reader sees is unchanged.

**Structured data** now covers what it left out: an `Article` plus a
`BreadcrumbList` on every dated insight and camp-report page (datePublished read
from the filename, so it cannot disagree with the page), an `Article` on the
seven strategy guides (dates from `git log`, so they stay honest as the guides
are revised — omitted rather than invented if git is unavailable),
`SoftwareApplication` on the five keyword landing pages, `CollectionPage` on
`/guides`, and `WebSite` + `Organization` on the front page.

**`sitemap.xml` now carries a `<lastmod>` on every URL** (dated pages from their
own date, everything else from `git log`). Each entry stays on one line inside a
single `<url>...</url>`: the worker's drop-date filter (§12) strips undropped
insight pages with a regex over exactly that shape, and `test-seo.mjs` runs that
real regex against the real file so reshaping the entries cannot quietly publish
tomorrow's drops today.

**What is deliberately not in the repo:** Search Console verification, the GA4
property's own configuration, and backlinks. Those are account-side and cannot
be committed.

---

## 22. August 2026: the edition switch (auction / snake / best ball) on the front page

**The complaint:** the ribbon at `/` carried links called **Snake Draft** and
**Best Ball**, and both of them left the front page — they went straight into the
app's snake and best ball rooms. A reader who came for a snake draft was never
shown a snake front page; they were shown the auction one and then thrown out of
it. There was no Auction Draft button at all, because auction was the only thing
the page could be.

**What it is now:** those two links are a three-way switch — **Auction Draft /
Snake Draft / Best Ball** — and it is the one control that says which draft the
whole page is written for. Picking one delivers every piece of insight on the
page in that edition.

### Where the state lives

`iron_tuna_edition_v1` in `localStorage`, through **`it-league.js`**:
`edition()`, `setEdition()`, `editionFromLeague()`. Precedence is the same as
the reading lens: an explicit `?fmt=` on the URL, then the reader's own choice,
then the league they saved, then auction.

The **edition and the reading lens are not the same value and this is not an
oversight.** The lens (§9f) has two values because a tailored line is either
dollars or draft slots; the edition has three because best ball has its own
insight pages, its own guides and its own room in the app even though it reads
in slots. `normFormat()` folds best ball into snake, so a page switching on the
lens alone would send a best ball reader to the *snake* edition of every story.
`setEdition()` therefore sets the lens underneath it; the reverse is deliberately
not true, because the edition is the coarser choice and the one the reader makes
by hand.

**The Position Intel Auction/Snake switch is gone** (`#posFmt`). It only ever
appeared for readers with a saved board, and two controls that can disagree
about the same question are a worse answer than one that cannot.

### Switching is a re-point, not a re-fetch

Every call is already published in all three editions — `build-front.mjs` and the
insight drops produce `auction-insights-DATE`, `snake-insights-DATE` and
`bestball-insights-DATE` from one research set. Across formats the **title, the
position, the verdict chip and the measured effect are identical**; what differs
is the play line each edition's own page prints. So `var STORIES` stays **one**
array and the switch rewrites links. Tripling the array would have put two more
copies of all 70 headlines on the wire to change a URL — the same trade §17
records for `LEAD_FACES`.

`edUrl()` in `front.html` rewrites exactly **two** families:

| from | to (snake / best ball) |
|---|---|
| `/auctiondraft…` | `/snakedraft…` / `/bestball…` |
| `/auction-insights`, `/auction-insights-YYYY-MM-DD…` | `/snake-insights…` / `/bestball-insights…` |

Nothing else. `/auction-watch-*`, `/auction-budget-allocation`,
`/auction-nomination-strategy` and `/dollar-endgame-handcuffs` have **no twin in
another edition**, and rewriting them would hand the reader a 404 — the
lookaheads in `ED_APP` / `ED_INS` are what keeps `/auction-watch-` out.

**The rewrite is a DOM sweep, not a change to each renderer.** The page paints
from six independent places (lead, rail, position modules, coaching column,
Vegas case, camp desk), three of them from fetches that land whenever they land.
A `MutationObserver` (childList only — the sweep writes attributes, so it cannot
retrigger itself) re-sweeps on any render. Every anchor remembers the href it
was **born** with in `a.__ed0`, so switching twice is not rewriting a rewrite.

### What else moves, and what deliberately does not

Anything that has to be re-worded pushes a painter onto `edPainters`, and
`applyEdition()` runs the lot; the authored markup is captured at load and
**restored verbatim** for the auction edition, so the auction page a crawler sees
and the auction page a reader switches back to are the same page.

- **Moves:** the Position Intel standfirst, the masthead and tools-band buttons
  that name the room, the Asset Allocation module (heading, blurb and cards — the
  other editions get the guides that *exist* for them rather than a renamed
  budget playbook), and the camp desk's standing note.
- **Does not move:** the camp reports themselves. There is one camp desk and its
  pages are titled the way they were published; only the note above them stops
  saying "auction" to a reader who is not in one.
- **Says which currency it is in:** **The Build** is an exact dollar solve and
  cannot be restated in picks, so outside the auction edition it carries an
  "Auction solve" tag rather than letting a snake reader assume the numbers are
  theirs.

### Two things that will bite a change here

- **The generated lead must survive a switch.** §17's three-hourly story
  *replaces* the dated rotation. Re-running `renderLead()` on a switch silently
  undoes that and puts a week-old deep dive back on the front page — which is
  exactly what the old lens switch did. `repaintLead()` repaints whichever lead
  is actually on screen (`genLead` holds the last payload).
- **`?fmt=` is not a new page.** The canonical stays `https://irontuna.com/`;
  the switch uses `history.replaceState`, never `pushState`, because the back
  button belongs to the reader's last *page*, not their last format.

### Tests

`node tools/test-position-lens.mjs` (needs playwright-core + Chromium; skips
cleanly without them) drives the real switch in a browser: one click has to move
the drop links, the app links, the button that names the room, the guides module
and the camp note *together*; the auction page has to come back whole; no link
may be invented for a page that does not exist; a `?fmt=` link opens and is
remembered; and a stubbed generated lead has to still be the lead after a switch.
`node tools/test-it-league.mjs` covers the storage API and guards the argument
each renderer passes.

---

## 23. August 2026: The Pick (the daily themed story)

One story a day at **`/the-pick`**. Where the Play-Caller Premium (§16) is a
column *about coaches* and the generated lead (§17) is a run of the auction
against the day's lines, The Pick is the site's **feature story**: one idea per
entry, argued from the projection set, ending in a player you do something
about.

The format is the product, and it has three parts in this order:

1. **A theme.** Positional scarcity, scoring settings, tier cliffs, the lies a
   backfield tells. One idea per entry, stated in the chip, and never the same
   theme two days running — a daily column's real failure mode is not being
   wrong, it is repeating itself.
2. **A table.** Numbers computed from `PROJECTIONS` in `_worker.js`, the same
   pool every board on the site prices from, so a reader can check the argument
   against their own sheet instead of taking the column's word for it.
3. **A pick.** The named player, in `<b>` tags, with a percentage.

The voice is the site's own: the data discipline of a projections-first analyst
married to a sports columnist's comic register. It is allowed to be funny. It is
not allowed to be funny *instead of* being useful — every entry ends in an
instruction. **Nothing in the reader-facing copy names or imitates a real writer
by name**, and the column is bylined to Iron Tuna like everything else here.

### Where it lives

- **`the-pick.html`** (route `/the-pick`) is the **source of truth**. Static
  entries, newest first, no client rendering and no date gating — entries are
  written on the day they publish.
- Each entry is one `<article class="call pick" id="pick-YYYY-MM-DD">`. **The
  `call` class is not decoration:** `/it-league.js` finds an entry with
  `el.closest('.call')` and reads `.cpos` off it, so an entry that drops it keeps
  its look and silently loses the reader's own dollar translation (§9f).
- Inside: a `.cmeta` row (`<span class="chip theme">Theme: …</span>` + `.cpos` +
  `.cteam` + `.cdate`), an `<h2>`, a `<p class="dek">`, the prose, one or more
  `<div class="tbl"><table>…` blocks, a `<p class="who"><b>The Pick:</b> …</p>`
  naming players in `<b>`, and a `<p class="statline">Projected effect: …%</p>`.
- The front page carries a **`#thepick` band directly under the hero**: today's
  entry in full — theme, headline, dek, faces, the pick line — with the two
  behind it as an "Earlier picks" rail. A band with a *today* rather than four
  equal cards, because that is what a daily column is.

### The edition switch

The Pick has **no snake or best ball twin** — the entries are one column, written
from the auction desk, and `edUrl()` (§22) correctly leaves `/the-pick` alone the
same way it leaves `/auction-watch-*` alone. So the column takes the camp desk's
treatment: **the pages do not move, the standfirst above them does.** `ED[*].pick`
carries one line per edition and an `edPainter` swaps it, and outside the auction
edition that line says out loud which desk wrote the entries rather than letting a
snake reader assume the dollars are theirs. The statlines need no such hedge —
`/it-league.js` already restates each one in draft slots for a reader whose lens
is not dollars (§9f).

### The build path

`node tools/build-front.mjs` extracts the column into `var PICKS = [...]` in
`front.html` alongside STORIES/REPORTS/PLAYERS/COLUMN, taking the named players
only from the `<b>` spans inside the pick line — a name in the prose above it is
context, not a call, and must not claim a photo. `node tools/build-seo.mjs`
writes a `Blog` block whose `blogPost` list is read back out of the page's own
articles, so the structured data cannot claim an entry the page does not have.
Both are enforced in CI by a rebuild that must produce no diff.

`build-seo.mjs`'s `decode()` was extended at the same time to handle the
typographic entities the pages actually author (`&mdash;`, `&rsquo;`, numeric
entities). JSON-LD is JSON, not HTML: an entity that survives into it is printed
to a crawler literally, so a description would have claimed the page says
"theme &mdash; positional scarcity". Only this page's block changed.

### The checks

**`node tools/test-the-pick.mjs`** (in CI). The column is written in prose by a
Routine, so it gets the same treatment §21's insight prose does — held to the
player pool the boards price from:

- every player the pick line commits to is in `PROJECTIONS`, and every
  "Name (TEAM)" in the copy is on that team;
- **a table column headed `Points` is recomputed from `PROJECTIONS` and must
  match to a tenth.** This is the check that makes printing the tables worth
  doing;
- the statline quotes a percentage *and* one of its players is named in the
  headline or the pick line — fail either and `/it-league.js` silently never
  paints the "Your league" line;
- `PICKS` in `front.html` quotes the page exactly, and `/the-pick` is linked
  from the served HTML twice (the ribbon and the section head), because the
  crawlers `robots.txt` invites do not run JavaScript.

The name scan reads **one text node at a time**. Flattening an entry first lets
a run of capitalised words cross a table-cell boundary, and a row then reads as
a player called "PPR Standard Derrick Henry".

### The daily cadence

A Claude Routine (`trig_016JAiJJMZi2jtZDmZS1QPNK`, "Iron Tuna — The Pick (daily
story)") fires **daily at 13:00 UTC** into a fresh session and adds exactly one entry on a branch. Its
prompt carries the markup template, the theme rule, the voice, and the same
grounding instruction the other desks run under:

> **Ground every current-season claim in this repo.** The roster and coaching
> landscape here is the site's own and does not always match outside sources.

It pushes a branch and never to `main`. Like §16's Routine it **stores no MCP
connectors**, so its sessions may lack GitHub tools; the pushed branch is the
deliverable and the PR is best-effort. Publishing nothing is an acceptable
outcome and the prompt says so — a day with no checkable argument is better
served by silence than by a thin entry.

To change the cadence or the themes, edit the Routine; to stop it, delete it
(`trig_016JAiJJMZi2jtZDmZS1QPNK`). It has no hard stop date, unlike §16's
Routine — the column is about how to spend money on a fantasy roster, which
outlives draft season, and the prompt's theme list carries in-season ideas as
well as draft-day ones.

---

## 24. August 2026: The Build accounts for the whole budget

### The complaint

The desk read *"122.1 points a game for $110"* under a headline that said
*"The best team $120 can buy"*. A reader does that subtraction: $10 is missing,
so the solve must be leaving value on the board.

It was not. **§19's planner spends the budget twice over** — `spend` buys the
starting lineup, and the rest buys the bench, because a legal roster has to fill
every seat and the bench is billed at `max(position floor, price)`, not at $1.
On the default board that is $183 of starters and $17 across 7 bench seats:
$200 exactly, nothing stranded. `tools/test-planner-budget.mjs` has asserted
that for every shape model since §19.

The desk was simply publishing one half of a two-half ledger, and the missing
half was the half that made the arithmetic work. The fix is not to the solver.

### What changed

`tools/build-front-analysis.mjs` now carries both halves into `var ANALYSIS`:

- `bench: { seats, cost, share, players[] }` — the bench the planner actually
  buys, at the price it will actually be billed. The players come from the
  planner's own `benchTargets`, the same list the app hands a drafter.
- `total` (`spend + bench.cost`) and `unspent` (`budget - total`).
- **`posCost[].share` is now a share of the whole budget, not of the starter
  spend**, and the bench is one of the rows. Largest-remainder rounding, so the
  printed percentages add to exactly 100 rather than to 102. RB reads 53%, not
  58% — the old number was a true share of the wrong denominator.

A sanity check refuses to write a solve where `unspent > 0` or `total > budget`,
so the page can only ever state a budget it can account for, and
`tools/test-build-desk.mjs` (in CI) holds the shipped `ANALYSIS` and the render
to the same contract.

`front.html` renders the second half: the dek names the bench dollars and the
seat count, a named bench strip sits under the starters, the spend bar and its
key span the full budget with a bench segment, the meta line reads
`$110 starters + $10 bench = $120`, and "The shape of a winning $120" carries a
BENCH bar.

### The one trap in the render

Do **not** print the bench as `fmtMoney(bench.cost)`. `it-league.js`'s `money()`
rounds every call independently, so on a $100 board `money(183) + money(17)` is
$92 + $9 = **$101** — a page about a budget that adds up, that does not add up.
The bench is derived by subtraction instead (`budgetShown - startersShown`),
which cannot lose or invent a dollar. `tools/test-build-desk.mjs` asserts it,
and with playwright installed it renders the real page at $50/$100/$120/$200/
$300 and checks that every one of them balances on screen.

Per-player bench prices are deliberately not printed for the same reason: seven
independent rescales would not sum to the one bench total the key states.

### Known, untouched

At very small budgets (a $50 auction) `money(1)` rounds to 0, so a $1 defence
prints as **$0** in the roster strip and the spend key. That is `money()`'s
rounding, it predates this change, and flooring the display at $1 would break
the column sums this section exists to make true. Real leagues draft at $100 and
up, where it does not arise.


---

## 25. August 2026: every `var(--token)` has to resolve

**The bug that bought this check.** The royal-blue re-skin (§22's sibling, PR
#74) renamed `--red` to `--brand` and `--value-red`. The Pick's front-page band
was on a branch at the time and still said `color: var(--red)`. The two changes
touched **different lines of `front.html`**, so git merged them with no conflict,
and both CI suites went green on the merge commit that shipped it.

Nothing here could have caught it, and the reason is worth stating: an undefined
custom property is **not a parse error**. It is
[invalid at computed-value time](https://drafts.csswg.org/css-variables/#invalid-variables)
— the declaration is discarded and the property inherits instead. The
script-parse steps only read `<script>`; the rebuild gates only compare generated
output; every other suite is JavaScript. **`tools/test-css-tokens.mjs` is the
only thing in this repo that reads CSS.**

The symptom was one module on the front page that did not light up on hover.
That is exactly the size of defect that survives review, ships, and is never
reported.

### What it checks

Every `var(--x)` **without a fallback**, across all 97 pages, resolves to a
`--x:` somewhere the page can see: its own markup (stylesheet, `style=""`
attribute, or a quoted key in a React style object, which is how this app would
set one at render time), or a same-origin stylesheet it links.

`var(--x, …)` **with** a fallback is always fine. That is the language's own way
of saying "this may not be set", and it is how a component-scoped value is meant
to be written.

This is a spelling check, not a cascade simulation. It cannot tell you a token is
the *wrong* colour, only that it is nobody's colour at all — modelling which
selector is in scope for which element is a browser's job. The narrowness is the
point: the failure it does catch is invisible in review and is now impossible to
merge.

A second block asserts `front.html` still declares its palette on `:root`, so a
re-skin that drops a token has to come here and see which modules it is about to
break, and names `--red` directly to keep the story attached to the check.

`RUNTIME` in the file is an escape hatch for tokens set from JavaScript that no
static read can see. **It is empty**, and every entry would need a reason and a
file. It is a place for facts about the code, not a place to silence a finding.

### What it found on its first run

Two older ones, both in `index.html`, both pre-dating The Pick:

- **`.cheat-whb-h`** — a *rendered* element — asked for `var(--text)`, which has
  never existed in that file's palette (it has `--text-primary`,
  `--text-secondary`, `--text-muted`, `--text-faint`). A heading sitting above a
  `--text-muted` subtitle was silently inheriting its colour. Fixed to
  `--text-primary`.
- **`.lp-mode-*`** asked for `--mode-accent`, a value the card was meant to set
  on itself. `.lp-mode-dot` already spelled the fallback and the other eight
  usages did not, so they were being discarded rather than falling back.
  Chasing that down established the rules were dead: they styled a landing-page
  card component that no longer renders — the `lp-modes` **section** is still
  there, but it renders `ip-card` children now — so **the whole component was
  deleted**, thirteen rules plus its entry in a shared media query. The section
  class itself had no rule of its own, so nothing rendered changed; a render of
  the file before and after is byte-identical.

  The token check is what surfaced it. It cannot tell dead CSS from live CSS —
  it only noticed a name nothing defined, and the answer to "who was supposed to
  define this?" turned out to be "a component that left".

### Verifying a change here

Mutation-test it, the way it was built: reintroduce `var(--red)` in `front.html`
(two checks must fail), rename `--gold` on `:root` (two must fail), and swap a
rule for `var(--never-defined,#333)` (nothing may fail — a fallback is not a
bug). If a change makes any of those three behave differently, the check has
stopped doing its job.

---

## 26. August 2026: the front-page nav fits the page it is on

**The complaint.** "Fix the nav crowding."

**What was actually wrong,** measured rather than eyeballed: the ribbon's
content was **1391px inside a 1260px `.wrap`**. That is not a narrow-window
problem — it overflowed by 131px at *every* desktop width, 1600px included.
The two links on the far right, `Classic Home` and `Sign In`, were clipped for
every reader who ever loaded the page. `.ribbon .wrap` has `overflow-x:auto`,
so they were technically reachable by scrolling a row that gave no sign it
could scroll.

`Sign In` being the permanently invisible one is the part that mattered: it
was the only sign-in entry point on the page.

### What changed

1. **`Classic Home` left the ribbon.** It was already in the footer (a second
   copy bought nothing), so removing it costs no reachability.
2. **`Sign In` moved up into `.mast-nav`**, next to Cheat Sheet and Auction
   Manager. It is a thing you *do*, not a place on the page, so it belongs
   with the account buttons rather than among the section anchors. `.mast-signin`
   is dimmer than a CTA and set slightly apart, so it does not read as a third
   button.
3. **The ribbon tightens below 1240px** (`@media(max-width:1240px)`: link
   padding 11→7px, wrap gap 4→2px, switcher padding 12→9px). Those pixels are
   what keep the **edition switcher** — a control, not a link — on screen. The
   row now fits down to **1087px**; below that it scrolls, which is correct on
   a phone.
4. **The scroll finally announces itself.** A fade paints at the right edge of
   the scroller, gated on `.ribbon.is-scrollable` — toggled from script on
   scroll and resize when `scrollWidth - clientWidth - scrollLeft > 4` — so the
   cue appears only when there is more to the right and clears at the end of
   the scroll.

### Where the fade lives, and two traps it hit

The fade is a **sticky pseudo-element inside the scroller**
(`.ribbon.is-scrollable .wrap::after`, `flex:0 0 30px` cancelled by
`margin-left:-30px`) — the mobile pass's implementation with this section's
gating class added to it. Two earlier drafts were worse, and both failure modes
are easy to walk back into:

- **Do not put the fade on `.ribbon` and add `position:relative` to anchor it.**
  `.ribbon` is `position:sticky`; a later `position:relative` *overrides* that
  and silently un-sticks the nav. (Sticky already establishes a containing block
  for an absolutely positioned descendant, so the rule was destructive *and*
  unnecessary.)
- **Do not anchor it with `right:0` on `.ribbon` either.** `.ribbon` is
  viewport-wide while `.wrap` is a centred 1260px box, so `right:0` puts the
  fade out in the margin rather than at the edge of the clipped content. It
  needs `calc()` against `.wrap`'s max-width, and then that number has to track
  any later change to it. Inside the scroller, the right edge is free.

The gating is the half that has to survive: an ungated fade washes out the last
tab of a row that fits, which on a desktop is **every** row.

### The masthead bug this surfaced

`.mast .wrap` was `height:64px` while `.mast-nav` is `flex-wrap:wrap`. On a
narrow laptop the nav wrapped to a second row that **spilled out of the black
band and sat on top of the ribbon**. This was already true on `main` between
about 901px and 1000px — adding `Sign In` only widened the band that hit it.

Fixed at the root: `min-height:64px` plus 6px of vertical padding, so the band
grows to hold whatever it is given instead of overflowing. Above the wrap point
it renders pixel-identically to the old fixed height (the 40px logo plus 12px
padding is well under 64). The `@media(max-width:900px)` rule that used to say
`height:auto` no longer needs to.

Both navs also tighten below 1100px, between the phone layout and the desktop —
smaller wordmark, smaller jump labels, a smaller wrap gap. That is not cosmetic:
adding Sign In cost the masthead about 111px of headroom and moved its wrap
point from **901px up to 1012px**, which would have put a wrapped masthead in
front of every narrow laptop. The tightening puts it back at **908px**,
effectively at the 900px breakpoint where the layout changes anyway. If another
link is ever added up here, re-measure that number before shipping it.

**The masthead was restructured underneath this** by the mobile pass that landed
alongside it (PR #83): the seven section anchors moved out of `.mast-nav` into a
separate `.mast-jump` nav, and `@media(max-width:760px)` gives the phone a
two-row masthead — wordmark plus sideways-scrolling jumps on top, the two
actions full-width underneath. Sign In sits in `.mast-nav` with the actions but
at `flex:0 0 auto` rather than an equal third: it is a text link, not a button,
and an equal third would say otherwise.

### Verifying a change here

Measure it; do not look at it. A Playwright pass over
`[1600,1440,1280,1100,1000,960,900,768,600,380]` reading, for the ribbon,
`wrap.scrollWidth - wrap.clientWidth` and which children fall outside
`wrap.getBoundingClientRect()`, and for the masthead, the number of distinct
`top` values among `.mast-nav`'s children and whether the nav's bottom falls
below `.mast .wrap`'s. The contract:

- **1089px and up:** ribbon overflow 0, nothing clipped, no fade.
- **Below 1089px:** overflow is expected and the fade must be present.
- **Every width:** neither nav may extend past the bottom of `.mast .wrap`, and
  `document.documentElement` must not scroll horizontally.

Counting *rows* is not a usable signal any more — `.mast-brand`, `.mast-jump`
and `.mast-nav` are different heights and vertically centred, so their `top`
values differ on a single row. Use `.mast .wrap`'s height (64px = one row) or
the nav's bottom against the wrap's.

---

## 27. August 2026: the site says "auction" before it says anything else

**The brief.** Lean into the auction. Keep small buttons for the snake draft,
drop best ball entirely. Style the site the way DraftSharks styles theirs —
same approach, different colours, less density. Keep what is good.

The site had grown into a general fantasy football site that happened to be
best at auctions. `/` opened on a news lead, the ribbon offered three formats as
equals, the front page was light and every other content page was dark navy,
and nothing above the fold said what the tool actually did.

### 27a. The palette is now one palette

| token | was | is |
|---|---|---|
| accent | `#1f49c7` royal blue (front) / `#2dd4a3` teal (dark pages) | **`#0e7c63`** — one green, contrast-safe on white |
| money / CTA | `#f5b800` | **`#f2a900`** fill, **`#7a5300`** (`--goldink`) as *type* |
| chrome | `#101114` | **`#0b1614`** (`--mast`) |
| page | `#0b1117` dark on 91 pages | **`#ffffff`** everywhere |

**Ninety-one content pages went from dark navy to white** in one scripted pass
(`:root` swap + an rgba/hex substitution table + the wordmark gradient). They
share eleven `<style>` blocks between them, which is why a mechanical
conversion was safe; a representative of each was rendered in Chromium before
it was committed.

Three rules carry that conversion and are easy to get wrong again:

- **`#2dd4a3` is ~1.9:1 on white.** The site accent had to darken; `--teal` is
  `#0e7c63` on every page now, including the two that were already white.
- **Gold is a fill, not an ink.** `background:var(--gold)` keeps the bright
  amber (with `#1a1205` type on it); every `color:var(--gold)` was rewritten to
  `color:var(--goldink)`. 282 declarations. Skipping this leaves unreadable
  numerals in every price column on the site.
- **The wordmark is a light-on-dark metal gradient** and vanishes on white. The
  85 converted pages carry the inverted stops. `front.html` keeps the light
  version, because its masthead is still black.

`front.html` is deliberately **not** on the shared token set — it has its own
(`--ink` / `--card` / `--brand` / `--mast`) and a black masthead band over a
light page. `index.html` (the draft app) stays dark on purpose: it is a tool you
work in on draft night, not a page you read. `admin.html` stays dark because no
visitor sees it.

**`node tools/test-reading-view.mjs` is what keeps this from drifting back.** It
was rewritten from "two zones, three white pages" to the current contract, and
it now *sweeps every HTML file in the repo*: white background, the one accent,
no surviving `rgba(45,212,163…)`, no light-on-dark wordmark on a white page.
Adding a page built from an old dark template fails it.

**It earned its keep the same day.** The camp-desk Routine authored
`auction-watch-2026-08-22.html` on `main` while this branch was open, off the
pre-conversion template, and the merge brought a dark page into a light site.
CI failed on exactly those four assertions and named the file. `tools/templates/
preseason-week.html` was on the old palette too and is converted now — it is the
only authoring template left in the repo, so a new page inherits the light one.
If this recurs, the fix is the same scripted swap (`:root`, the rgba/hex table,
the wordmark stops, the shared nav), not a hand edit.

### 27b. The front page opens on the product, not on the news

`/` now goes: black masthead → green claim strip ("The Fantasy Site Built For
Auction Drafts") → **hero band** → in-page ribbon → **tool grid** → the news
desk, unchanged.

- **The hero** is copy left, product right: a real screenshot of the cheat
  sheet (`auction-sheet.webp`, 73KB — cropped and re-encoded from the
  committed `cheatsheet.png`, which was 687KB and unused). On a phone the
  frame keeps the image at half size and shows the left of it, because a
  1180px sheet scaled into a 390px column is a grey smear.
- **The `.trio` strip under it spells out PROJ / VALUE / YOU.** Those three
  columns are the entire differentiator — no ranking site has to answer any of
  them — so they get the width of the page rather than a clause in a paragraph.
- **The tool grid** is six auction tools, one row of three. The snake room is
  not a tile; it is the small switch in the ribbon.
- **The masthead nav is the site; the ribbon is the page.** Masthead: Auction
  Values / Strategy / Insights / Columns / FAQ plus Sign In and two CTAs.
  Ribbon: in-page anchors plus the edition switch. Two navs that both listed
  destinations was the density complaint.
- **Density inside the news desk:** Position Intel dropped from three
  follow-ups per card to two (four on the double-width Market module). Five
  stacks of four headlines was the block readers skimmed past.

The lead, Top Headlines, The Pick, Vegas vs. Consensus, The Build, the
Play-Caller column, Asset Allocation and the camp desk are all unchanged in
behaviour — every id the painters write into survived the restructure.

### 27c. Best ball is retired from the surface, not from the internet

**Every place that sold best ball is gone:** the front page's edition switch
(now Auction / Snake), `/hub`'s three mode cards (now two, auction first), the
Insights dropdown in the app, the Draft Format select in League Settings, the
`/insights` format chooser and its tabs, the guides page, the vault's per-format
line, the cross-edition links on every auction and snake drop page, `llms.txt`,
and the site-wide footer boilerplate.

**What was deliberately left alone:**

- **The pages themselves.** `bestball-insights*.html`, the two best-ball guides
  and the `/bestball` route still serve, and they are still in `sitemap.xml`.
  Nothing 404s and nothing loses its ranking; they are simply orphaned from
  internal links. Deleting them and 301-ing to the auction editions is a
  separate decision, and a lossy one.
- **`it-league.js` still understands `'bestball'`.** A reader whose saved league
  is best ball keeps their reading lens; the front page's
  `if (!ED[edKey]) edKey = 'auction'` guard is what lands them on the auction
  edition. That guard is now load-bearing — do not remove it.
- **The League Settings select keeps a `bestball` option, conditionally.** It
  renders only when `draft.format === 'bestball'` already. A React `<select>`
  whose `value` is not among its options renders blank, which would have
  stranded anyone mid-season in a best-ball league.
- **`_worker.js`'s insight data** still carries `bestballPositioning` /
  `bestballAction` per insight. Nothing renders them. Harmless, and removing
  them means re-cutting the premium payload.

`tools/test-position-lens.mjs` and `tools/test-it-league.mjs` were updated to
the two-edition switch, and both now assert the *absence* of a best ball surface
rather than the presence of one.

---

## 28. August 2026: the post-draft section, and the FAAB Advisor

**The brief.** A pre-draft / post-draft split like DraftSharks'. Sleeper only.
Everything post-draft free except the Value Coach. Build the FAAB Advisor. Ship
the whole section **locked**, behind "coming soon, leave your email for notice
and free access".

### 28a. Why FAAB is the right post-draft flagship

Every other in-season tool ranks waiver adds. A ranking tells you who to want;
in a FAAB league what you *pay* is the entire decision, and a dollar under the
winner buys nothing at all. FAAB is a blind auction run weekly against the same
room you drafted against — which makes it the one in-season problem this site is
already built to solve, and the reason the section leads with it rather than with
start/sit.

### 28b. The model, and the mistake it went through

`/faab` reads the reader's Sleeper league in the browser (rosters, users, league
settings, the transaction log) and prices the free-agent pool through
**`it-league.js`** — `defaultBoard()` for the pool, `price(pos, rank)` for the
reader's own budget, their saved sheet where they have one. **No valuation code
is duplicated into the page**, deliberately: a second copy of `scorePlayer` in a
second file is the drift that §9c already has a test to catch.

Four numbers, in order:

| | |
|---|---|
| `ros` | board value × (weeks left / 17) — rest-of-season, in **draft** dollars |
| `vadd` | `ros` minus the weakest player that roster would actually start at the position (slot counts read from the league's own `roster_positions`, flex included), floored at 20% of `ros` so a bench-only add is not worth literally nothing |
| `surplus` | `vadd` minus the **(adds+1)-th best** `vadd` on the wire for that roster |
| `share` | `surplus` ÷ the sum of surpluses — multiplied by a budget to get a bid |

**The surplus line is the whole model, and the first cut got it wrong twice.**

1. **First cut: no baseline at all** (`surplus = vadd`). Every free agent got a
   share of the budget proportional to his absolute value. On a real week-5 wire
   — a long flat tail where the board prices everyone at the minimum bid — that
   produced *forty identical rows*: `$2` value, `$11` going rate, `$2` max, over
   and over. It is a ranking with dollar signs on it, which is the exact thing
   the page exists not to be.
2. **Second cut: baseline = the single best alternative.** Correct in spirit,
   far too harsh: only one free agent per roster can be better than every other,
   so exactly one row survived.
3. **Shipped: baseline = the first add you would not otherwise have made.** Over
   the remaining weeks a manager makes roughly `adds = weeksLeft × 0.7` claims
   anyway, so the ones they would make regardless are not what winning *this*
   claim buys. The replacement is the (adds+1)-th best on the wire. This is
   value-over-replacement — the same idea the draft board is built on, with the
   replacement drawn off the wire instead of the draft pool.

Ten interchangeable handcuffs all sit at replacement, so all ten are worth about
a dollar however good they look on a list. **A flat wire correctly produces an
empty table and the line "save the budget", which is advice no other tool gives.**

**Going rate is computed one rival at a time**, not from a curve: their remaining
FAAB (`settings.waiver_budget_used`, which Sleeper publishes for every roster),
their hole at that position, their alternatives. A leaguemate with $0 left is not
competition however badly they need a running back, and the page names who the
real threat is. This is the one genuinely novel thing on the page.

**Two currencies, said out loud.** `ros` is draft dollars; going rate and max bid
are FAAB dollars. They are not the same scale — a $100 FAAB budget buys a handful
of claims where a $200 draft budget buys a roster — so a going rate *above* the
rest-of-season figure is normal. The column headers carry the unit and the method
note explains it; without that it reads as an arithmetic bug.

### 28c. The lock is in the worker, not the page

`POST_DRAFT_PAGES` (currently `/faab`) serves **`/post-draft` in place of
itself** unless `POST_DRAFT_OPEN` is `"1"` in the Cloudflare vars.

- **In the worker on purpose.** A static asset locked by its own JavaScript is a
  suggestion — the HTML ships to the browser either way and anyone can read it.
  The worker never hands the page over.
- **Serves, does not redirect.** The reader keeps the URL they clicked, so the
  page that opens there later is the one they were promised, and the gate records
  *which* tool they wanted (`location.pathname` → the `tool` field on the lead).
- **Owner preview:** `?preview=<LEADS_EXPORT_KEY>` parks the key in a 12-hour
  `HttpOnly` cookie and bounces to the clean URL, so the secret does not end up in
  a shared link or the next request's `Referer`.
- **To open the section:** set `POST_DRAFT_OPEN=1`, add `/faab` to `sitemap.xml`,
  and mail the list. Nothing else.

`POST /api/post-draft-notify` reuses the `/insights-vault` plumbing exactly — one
`contacts` row (`source: 'post-draft:<tool>'`), the optional `LEAD_WEBHOOK`, the
existing unsubscribe path. It grants nothing, because there is nothing to grant
yet: no entitlement, no cookie.

### 28d. The front page says which half of the season it is

Two labelled shelves: **Before the draft** (the six auction tools) and **After
the draft** (three locked cards → `/post-draft`). The masthead carries an
`In-Season` link with a `Soon` chip.

**A trap that was already in the masthead CSS and is now fixed:** the row's
tightening rules were inside `@media(max-width:1100px)`, but `.wrap` is capped at
`max-width:1260px` — so the masthead's content box is the same width at 1360px and
at 2560px. A row that does not fit in 1260 never fits, and a max-width media query
only hides the wrap *below* the breakpoint while leaving every wider screen on two
ragged rows. Those declarations are unconditional now. **Do not put them back
behind a max-width query.**

### 28e. Tests

`node tools/test-faab.mjs` (playwright-core + Chromium; skips cleanly without
them) serves the real page against a stubbed 12-team league built to have known
answers, and asserts: no max bid above the money actually left, rest-of-season
discounted for weeks played and never rising down the board, a $0 rival never
named as the competition, no going rate above the richest rival's budget, a
"Bid $n" always affordable and above the going rate, a "Let it go" never a player
the reader could have won, and a non-FAAB league unselectable.

**Two of those assertions exist because the model shipped wrong in this session
and every bound check passed on the broken output** — identical numbers are
trivially within bounds and trivially monotonic. So: *the model tells the pool
apart*, and a second fixture league whose wire is genuinely flat, where the only
correct answer is an empty table. Verified by reverting: the no-baseline model
fails the flat-wire case with exactly the `$2 / $3 / $2` rows it originally
shipped. `IT_SHOT=/tmp/faab.png node tools/test-faab.mjs` writes a rendered copy,
because the numbers can all be right while the table is unreadable.

`tools/test-asset-routing.mjs` covers the gate in both states and reads
`POST_DRAFT_PAGES` out of the worker so a page added to the section cannot be
left ungated. **It previously passed while testing nothing**: the lifted rewrite
block's own `catch (e) {}` swallowed the `ReferenceError` from the three
gate symbols the harness did not define. They are supplied now.
`tools/test-seo.mjs` reads the same set and exempts gated routes from the
sitemap-coverage check, because while the gate is closed a sitemap entry for
`/faab` would hand a crawler the gate page's body under a second URL.

### 28f. What is not built

Start/Sit and Roster Audit are named on the gate page and have no code. Start/Sit
needs **weekly** projections and the site has only season-long ones; the intended
path is season ÷ games × the per-game Vegas scoring environment the worker already
computes (§9b), not a bought feed. Neither has a route, so neither is in
`POST_DRAFT_PAGES`.
