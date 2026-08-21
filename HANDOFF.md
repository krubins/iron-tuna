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

The switch itself lives in the Position Intel section header (`#posFmt` in `front.html`) and **only appears for a reader with a saved league and a board**: with no board there is no tailored line to re-word, and a control that changes nothing on screen is worse than no control. Clicking it re-renders the modules *and* the lead together — they quote the same stories, and a page that contradicts itself one screen apart is worse than one that never personalised at all. `node tools/test-position-lens.mjs` drives that switch in Chromium (skips cleanly without playwright-core or a Chromium binary); `tools/test-it-league.mjs` covers the ordering, the copy and the front page's two `tailor()` call sites.

### Money has two scales, and mixing them is the easy mistake

`price(pos, rank)` scales the curve by **`teams × budget`** — more teams means more money chasing the same players, which is what the app's `calculateMarketValues` does. `money(n)` scales editorial prose by **budget alone**, because "how to spend the $200" is about one manager's wallet and a 10-team league does not shrink it. Both are asserted in the tests.

### Why the API ships stat lines

Points are a pure function of a stat line and a scoring system, so shipping the line lets a **publicly cached** payload produce a **private** answer — the worker never learns anything about the reader. That is why contract 3 added `statsConsensus`, `statsIronTuna` and `statsMarket` to each column item rather than adding a per-league endpoint.

Ranks are the exception: they need the whole pool, which only the reader's saved board has. When the board is missing the site's ranks stand and only the money moves. When it is present, the player's own row calibrates the scale (the board carries the app's season normalisation and any per-player shaping baked into its points), and the identical adjustment is applied to both boards, so the gap between them stays exactly what the odds put there.

### Maintenance

`it-league.js` carries a **hand-synced** copy of `DEFAULT_LEAGUE_CONFIG.scoring`, `LEAGUE_MARKET_CURVE`, `LEAGUE_CURVE_BUDGET` and `scoreSkillPlayer` — same arrangement, and same risk, as `_worker.js`'s column copies. There is no build step. **`node tools/test-it-league.mjs`** lifts all three copies out of their real files, runs the client's own `scoreSkillPlayer` head-to-head against the library over every real projection, rebuilds a real column with the real worker and asserts the library reproduces its printed points and prices *to the digit* at the site defaults, and runs `front.html`'s own `myCase` as shipped. Run it after touching scoring, the curve, the column's item shape, or the library. **`node tools/test-position-lens.mjs`** covers the reading-lens switch and the default-board line end to end in a real browser. **`node tools/build-default-board.mjs`** regenerates the default board.

## 9g. Comping access from a URL (added August 2026)

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
  remain fully live — linked from the front page's secondary nav.
- **Layout** (ESPN-inspired): black masthead with the fish + Bebas silver wordmark and
  red accent bar; **deep-dive lead** (see below); "Top Headlines" rail; **Position Intel** modules (QB / RB / WR / TE /
  Market) with an **Auction / Snake** reading-lens switch in the section header (§9f);
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
  `auction-watch-YYYY-MM-DD.html` when there is real signal, runs `build-front.mjs`,
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
  on running backs.
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

The name is an auction name on purpose — the column measures what a play-caller adds to or subtracts from a price, and "premium" is the word the rest of the site already uses for that.

### Where it lives

- **`play-caller-premium.html`** (route `/play-caller-premium`) is the **source of truth**, same discipline as the insight drop pages. Entries are static HTML — no client-side rendering and no date gating, because entries are written on the day they publish rather than scheduled ahead. Newest first.
- Each entry is one `<article class="call" id="call-YYYY-MM-DD-N">` carrying: a `.cmeta` row (chip + `.cpos` + `.cteam` + `.cdate`), an `<h2>` naming the **coach or the pattern**, two or three paragraphs of the tendency, a `<p class="who">` naming the players in `<b>` tags, and a `<p class="statline">`.
- The chip is the verdict: `chip up` ("Pay the premium"), `chip down` ("Take the discount"), `chip split` ("Two-sided" — a scheme that lifts one position by taxing another).
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

The lead's photo band works off `players`, slugged with the same rule
`tools/build-front.mjs` uses, so "Kenneth Walker III" and `kenneth-walker-iii`
both find the same headshot. **Known limitation:** the band can only show players
already in `front.html`'s `PLAYERS` cast, which is built from the authored drop
pages. A generated story naming four players may show two faces. It never shows a
wrong face, and the "In this story" label does not claim to be exhaustive.

### The article page

`lead.html`, one shell for every story, rendered client-side from
`/api/lead-story/body`. The stories are replaced every three hours, so the page
is `noindex,follow`: a search result pointing at one points at something already
gone. Tables in the stored body get an `overflow-x` wrapper added **at render
time**, not in the stored copy, so the authoring contract stays "write a table"
and every past story gains the fix. The sources list is collapsed by default —
on these runs it can run longer than the story it backs.

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

#### Turning it on

The desk is defined in the worker and covered by tests, but the Routine
(`trig_011LYewcPUQikF8izFsN2LAr`, "Iron Tuna — lead story refresh (every 3h)") is
what actually writes a story, and its desk list lives in its prompt. **Flip it
after this is on `main` and deployed, not before** — a run that stores
`category = 'analyst'` against a worker that has never heard of the desk still
publishes, but it publishes under the fallback "Insight" badge. Two edits to the
prompt:

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

### Tests

`node tools/test-lead-story.mjs` (58 assertions, no network, no browser). It
evaluates the real section out of `_worker.js` rather than a copy, and most of it
is failure modes: no row, an unverified row, a row with no slug, an undefined
category, malformed JSON in a column, D1 throwing on `prepare`, D1 rejecting
mid-query, no database bound. **Every one must come back as "no story" rather
than as an exception**, because an exception here is a blank hero on the front
door. It also pins the route pattern against traversal and checks that the front
page still paints its own lead first.

## 18. August 2026: traffic numbers on /admin

`/admin` used to answer "how much money" and had nothing to say about "how many
people". It does now: a **Traffic** section above Sales & referrals with page
views, visitors, top pages, where arrivals came from, and the site's named click
events, over a 7 / 30 / 90-day window.

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

### A "visitor" is a day, not a person

`visitorHash()` is `SHA-256(day + LEADS_EXPORT_KEY + IP + user-agent)`, truncated.
No cookie, no stored IP, no stored user-agent — the raw values never reach D1,
and the salt rotates at UTC midnight so yesterday's hashes cannot be matched to
today's. That is the same shape Plausible and Fathom use, and it keeps the
`privacy.html` promise intact.

The cost is real and worth stating plainly: **over a multi-day window, someone
who comes back on three days counts as three visitors.** The admin page says so
under the tile rather than implying otherwise. If true multi-day uniques ever
matter more than the privacy property, the salt is the one line to change — and
the honesty note under the tile has to change with it.

### What is stored

Two D1 tables, created lazily on first use (`ANALYTICS_DDL`, cached per isolate,
with a one-at-a-time fallback for D1 versions that refuse DDL inside a batch) —
so there is no migration step to remember and nothing to run by hand:

- `page_views` — `ts, day, path, visitor, source, country`. `source` is
  `utm_source` if present, else the referring host minus `www.`, else empty for
  direct. Self-referrals are dropped so the list is arrivals, not internal hops.
- `site_events` — `ts, day, event, uid, path, props`, fed by `/api/track`.

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
the other admin routes. It is deliberately **separate** from
`/api/admin/dashboard`: that one pages through Stripe and can be slow or
misconfigured, and the traffic numbers should not wait on money numbers to
render. `admin.html` fetches both independently and the chart is now one
`lineChart()` used by both sections.

### Tests

`node tools/test-analytics.mjs` (38 assertions, no network, no browser). It
drives the real `_worker.js` over an in-memory SQLite standing in for D1, so the
SQL is actually executed rather than described. Beyond the never-break-the-page
cases above, it pins who gets counted, that one person on one day is one visitor,
that no row contains an IP or user-agent, and that the admin read stays gated.

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
