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
- **The three value boxes (market price / true value / what you should bid):** these are the **PROJ / VALUE / YOU** columns, shown in the mock-screenshot `.lp-shot` block (`.lp-shot-row`, CSS lines **1015–1029**) and explained in the caption near **line 2333**.
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

`You` (what you should bid) comes from `personalValue`, built in `_basePersonalized` in `index.html`. Personal value is `switchPrice()` — how many starter points a player actually adds to *your* lineup — and that is a plan rebuild per player, so it is only run for a `relevant` set: plan targets, your stars, and **the top 20 at each position**.

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

## 9j. Does the sheet's money add up? (fixed August 2026)

Twelve managers at $120 bring **$1440** into the room and they spend all of it. So
every dollar column on the cheat sheet has to total $1440 across a full board — 12
teams x the 16 roster spots, 192 players — plus a dollar apiece for the undraftable
tail past those spots, which can only push the whole-board figure *up*. A column
that totals less is telling a room to spend less money than it has.

Measured against the committed projections at 12 x $120, before this fix:

| column | over the 192 rostered | should be |
|---|---|---|
| Proj (`marketValue`) | $1441 | $1440 |
| Value (`auctionValue`) | $1435 | $1440 |
| **the raw curve, unnormalised** | **$1298** | **$1440** |

**The bug was in the third row.** `LEAGUE_CURVE_BUDGET = 1440` says out loud that
`LEAGUE_MARKET_CURVE` is drawn at 12 teams x $120, and a league's prices are that
curve scaled by `(teams x budget) / 1440`. But the curve did not add up to it: the
1-QB set came to **$1298**, ~10% light, so the constant was an assertion the data
did not support and every price scaled off it inherited the shortfall.

Inside the app this was invisible, which is why it survived. `renormalizeToBudget`
re-scales Proj and Value to the league's budget on every render, so it quietly
stretched a $1298 curve back to $1440 — a hidden ~1.13x nobody had asked for.
**`/it-league.js` and the worker's `/api/vegas-column` have no such step.** They
price straight off the raw curve, so off-app copy quoted WR1 at **$42** against a
cheat sheet reading **$50** — the same class of failure as the True-Value-as-Market-
Price bug in §11b, arriving by a different road.

### What changed

1. **The curve was re-cut by a flat 1.125x** in all three hand-synced copies
   (`index.html`, `it-league.js`, `_worker.js`), plus `SUPERFLEX_QB_CURVE` by the
   same factor so the QB-premium board keeps its exact relationship to the rest.
   **Level only — every ratio between players and between positions is preserved**,
   so nothing in §9h's re-cut of what a quarterback costs is disturbed
   (`tools/test-qb-curve.mjs` is all ratios, and still passes untouched). K and DEF
   do not move: their entries are $1-$2 and round to themselves.
2. **`renormalizeToBudget` now hands out whole dollars by largest remainder.**
   Rounding each price on its own leaks money — every price that rounds down takes
   a dollar off a board that has to total the budget, and a dozen of those is why
   Proj read $1441 and Value $1435 for the same league. Prices are now FLOORED and
   the leftover dollars handed back to whoever the floor cost most. A bump is
   skipped when it would lift a player above the one ranked directly ahead of him,
   so the column still never rises as you read down it.

Both columns now total the league budget **exactly**, at every league shape tested.

### What did NOT change, and why

**The You column totals $1108 of $1440, and that is correct.** You is
`switchPrice` — an *indifference* price, the most you can pay before a player stops
improving *your* lineup — so it is structurally at or below Value (§9d, and the
measured table in "Grading against YOU is the trap"). It is one team's bidding
ceiling, not a share of a market that has to clear, so there is no budget for it to
add up to and renormalising it would destroy exactly the marginal signal it exists
to carry. **Do not "fix" the You column by scaling it to the budget.**

One quirk worth knowing rather than fixing: K and DEF skip `switchPrice` entirely,
so You falls back to Value for them and reads *above* Proj at those two positions
($31 vs $24 at K, $35 vs $25 at DEF).

**Past the end of a position's curve the floor is `minBid` scaled by the league
ratio, not a literal $1.** So an undraftable costs $2 in a $200 league and $3 in a
$300 one, while Value prices the same player at $1. That is deliberate and pinned
by `tools/test-worker-column.mjs` ("the client scales the min bid by the league/curve
ratio too... matching that exactly is the point"), and it is why the whole-board
Proj and Value totals separate above $120 a team. It does not touch the $1440
question — at 12 x $120 the ratio is 1 and the tail really is $1 a head.

### The test

`node tools/test-curve-budget.mjs` — 45 assertions, **no browser, no network**. It
lifts the real `LEAGUE_MARKET_CURVE`, `renormalizeToBudget` and the whole valuation
pipeline out of `index.html` by brace-matching rather than re-implementing them, runs
them over the committed projections, and asserts: the raw curve totals the budget it
names; every position's curve still falls and never dips under the min bid; Proj and
Value total the league budget **exactly** at 12x$120, 12x$200, 10x$200, 12x$300 and
14x$100; neither column rises down a position; the tail only adds; and all three
copies of the curve and the curve budget still agree.

Two existing tests carried the old curve as a magic number and were updated with it:
`tools/test-worker-column.mjs` and `tools/test-it-league.mjs` both hard-coded RB1 at
`43`. The story-reprice fixtures in `test-it-league.mjs` went further and pinned
whole restated sentences ("$36 on Tetairoa McMillan") to the board of the day; those
now derive their expected figures from `defaultBoard()` the way `boardRatio` does, so
what they test is which player a figure is read against rather than what the level
happens to be. `tools/test-planner-budget.mjs` bounded a known planner residual at a
flat `$19`, which was the exact high-water mark on the old board — so a reprice
tripped it with the planner unchanged (the same residual is $21 on the new one). It
now bounds the hole as a **share of the budget** (12%), which is what it was always
trying to guard.

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
- **Football facts in hand-authored posts (Berry-style, added July 2026):** roughly half the bonus posts lead with a specific 2026 football fact — coordinator/coach changes (Petzing to Detroit + Campbell's Gibbs "bellcow" quote, Coen's Jacksonville rotation), personnel moves (49ers signing Evans + Kirk, A.J. Brown to New England, Dowdle's 2-yr/$12.25M deal burying Kaleb Johnson, Kyler Murray released, Stevenson/Henderson split), injuries (Mahomes targeting Week 1, Kamara's MCL sprain and Jayden Higgins' ACL, Garrett Wilson full participant), weather/schedule (Lambeau late-season snow flags vs BUF/MIA/HOU, the Rams' hard closing slate), and usage stats (Daniels 685.9 rush yds in 7 games, JSN 35.7% target share on 162 targets, Pickens' deep-role spike profile). **Every one of these is sourced from this repo's own drop pages / Auction Watch pages / `INSIGHTS_VAULT` — never from memory.** The discount series adds two more: Tucker Kraft's TE4-before-injury/PUP/Week-1 timeline (Auction Watch 2026-06-19) and Liam Coen's Tuten praise + three-back committee (Auction Watch 2026-07-11). Two maintenance rules: (1) when adding facts, grep the corpus first and quote it exactly; (2) several facts are dated news (injury timelines, camp status) — re-skim the fact-led posts when new Auction Watch pages contradict them (done once already in August 2026: `compare-auction-0` had been leading with Irving's "summer or fall" shoulder timeline months after Auction Watch 2026-07-02 restored him to "the clear anchor", and `strategy-4`/`poll-3` still had Mahomes with "no guaranteed Week 1 return" after Auction Watch 2026-08-18 had him saying the knee "feels great"; all three now quote the newest page instead. Still outstanding: once Kraft comes off PUP or the Jags name a starter, snake-discount-2/-3 need the same) and at minimum once before each season phase (camp open, cutdowns, Week 1).
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
  `auction-watch-YYYY-MM-DD.html` when there is real signal, runs `build-front.mjs`,
  **`build-seo.mjs`** (§21 — the new page needs the Google tag, its Article
  JSON-LD, a sitemap `lastmod`, and a static link from the camp desk; without that
  command it is published untagged and reachable only from the sitemap)
  **and `build-chrome.mjs`** (§24 — without it the page ships with no nav, no
  footer and no stylesheet link, and the `build-chrome.mjs --check` gate fails CI
  on the next PR), and pushes — same guardrails as the §9 projections routine (skip on no
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

### The staff table is the arbiter (added August 2026)

A column entry that names the wrong team for a coach is not a typo, it is the whole
thesis pointing at the wrong roster, and the first one shipped: `call-2026-08-19-7`
had Ben Johnson taking over **Tampa Bay** and pinned Emeka Egbuka to him, when this
repo's own Auction Watch pages (2026-07-04, 2026-08-21) and `INSIGHTS_VAULT` code
`W68` all have him in **Chicago**, and 2026-06-22 has Todd Bowles in Tampa Bay. The
entry had merged two adjacent items from the July 4 camp report — Burden inheriting
Chicago's vacated targets, and Egbuka inheriting Evans's — into one coach. It now
runs as a Chicago entry on Luther Burden III.

`STAFFS_2026` in `index.html` is the table that settles this, one row per team the
site has actually named, each row carrying the page it was quoted from. It does two
jobs:

1. **It grounds the Value Coach.** `/api/coach`'s system prompt invites the model to
   answer scheme and staff questions from its own football knowledge, and it used to
   answer them from its training data — a reader was told Trevor Lawrence would
   benefit from *Doug Pederson*, two Jacksonville hires stale, in the same confident
   register as a right answer. The prompt now hands over the table as authoritative,
   and instructs the model to say it is not sure for any team the table omits rather
   than reaching for a name.
2. **It is the audit baseline for the column.** `node tools/test-coaching-staffs.mjs`
   checks every entry's headline coach against its `.cteam` chip, and scans every
   page for a coach introduced as some other team's current head coach. Run it after
   adding entries.

Teams stay off the table until a page names them, on purpose: a gap produces "I'm not
sure", a wrong row produces another Pederson. When an Auction Watch moves a coach,
move the row and re-run the test.

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
  "ours":"$24 bid, RB14","stance":"disagree",
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

#### The prompt's model paragraph went stale, and the runs were right (2026-08-24)

The desk's prompt carried the auction model as a literal paragraph: "12 teams,
$200 budget, half PPR". The site moved to **full PPR** on 2026-08-23
(`0cf3b79`, and `it-league.js` now says "receptions went from half a point to a
full one"). The prompt still said half PPR for a day afterwards.

**The runs noticed and priced at full PPR anyway**, disclosing the deviation in
their method lines exactly as the rule allows. Stories written before the switch
(ids 27-31) say half PPR and were right at the time; everything from id 32 on
says full. Nothing was mispriced. The desk followed the shipped site over its own
prompt, which is the behaviour you want and the opposite of what a stale
instruction usually produces.

The prompt now says full PPR **and says the paragraph is a copy**: read
`SCORING_DEFAULTS` and the curve in `it-league.js` before pricing, follow the
repo when they disagree, and say so in the method line. It also asks for two or
three named-player spot checks against the shipped cheat sheet, which the better
runs were already doing unprompted (id 33's method line reconciles Nico Collins
at $23 and Garrett Wilson at $28 against the live sheet).

**The general lesson, worth more than this instance:** any number copied from
the site into the desk's prompt is a number that can go stale silently, because
the prompt is not in the repo and no test covers it. Prefer pointing at the file
over restating its contents.

#### last_insert_rowid() is 0 in a separate statement (2026-08-23)

**This one took the whole site's generated lead down and nobody noticed for a
day.** On the morning of 2026-08-23, `lead_story` had **zero published rows and
zero verified rows** out of 34. The front page had silently fallen back to its
dated deep-dive rotation, `/analyst-desk` showed its empty state, and `/lead`
returned not-found. Nothing looked broken to a visitor, which is exactly why it
survived a day.

The cause was in the desk's own prompt, from the beginning:

```sql
UPDATE lead_story SET published=0 WHERE id <> last_insert_rowid();
-- "run as a separate statement"
```

**D1 gives every statement its own session, so `last_insert_rowid()` returns 0
there.** `id <> 0` matches every row in the table, so the retire unpublished the
story the run had just published, along with the entire archive. The instruction
to run it separately is what made it fire wrong.

Measured, not inferred, against the live database:

```sql
CREATE TABLE _lastid_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT);
INSERT INTO _lastid_probe (x) VALUES ('probe');   -- meta.last_row_id = 1
SELECT last_insert_rowid();                        -- 0
```

The prompt now retires by binding the slug it just wrote
(`UPDATE lead_story SET published = 0 WHERE slug <> ?1`), says explicitly never
to use `last_insert_rowid()` and why, and its self-check selects
`(SELECT COUNT(*) FROM lead_story WHERE published=1) AS published_rows` with an
instruction to republish itself if that comes back 0. The daily watch checks the
same count first, before anything else.

**It recurred on 2026-08-24, narrowly.** Id 35, the story published and read in
full the day before, came back `verified = 0` while ids 41, 42 and 43 kept their
flags. So it is not a blanket wipe and not the retire statement, which touches
`published` only. Still unexplained. The prompt now says outright never to write
`verified` on a row that is not yours, since it is the one flag nobody can
reconstruct.

**Two things this cost, worth remembering.** It looked for a while like an
external writer was vandalising the table, because rows kept changing state
between reads; it was the desk doing it to itself on a three-hour timer. And it
is not fully explained: the `published` wipe is accounted for, but **nothing here
explains `verified` also being zeroed** on all 34 rows. If verified ever wipes
again with published intact, that is a second, separate bug and this section is
not the answer.

**Resolved, same day: the `verified` wipe was deliberate, and it was not this
bug.** A concurrent session, working from the site owner's instruction that
nothing inaccurate was to stay up, ran
`UPDATE lead_story SET verified = 0, published = 0` across every row three times
between 04:08 and 16:30 on 2026-08-23 — because every stored story priced players
by a valuation the cheat sheet does not use (see the section below on Market
Price versus True Value). So there is no second bug to hunt here.

The two sessions then spent the morning undoing each other: one restored rows it
read as vandalised, the other retired them again as inaccurate, and each read the
other's writes as "rows changing state between reads". **That is the lesson worth
keeping from this pair of entries.** `lead_story` has no audit trail, so a state
change carries no author, and two agents with write access and different
instructions cannot tell each other apart from a bug. Before concluding that a
table is being corrupted, check whether another session is working to a different
brief — `list_sessions` will show them.

**The archive was restored on 2026-08-24, by reading it.** Ids 27 to 35 were
checked one at a time against a stated standard: valid, named, dated sources
(7 to 14 per row); a method line stating the model and the data timestamps;
every external-fact claim matched to a source entry; and numbers consistent
across dek, body and calls. All nine held up on that reading. Two were better
than the standard required: id 28 states its own null model and assumptions for
a probability claim, and id 33 reconciles two named players against the shipped
cheat sheet.

**The restore did not stand, and that was the right outcome.** Ids 27 to 35 are
`verified = 0` today and should stay there. The `lead_story_audit` trail (see
the closing subsection of the 08-24 entry below) shows exactly one of the nine
ever reaching `verified = 1` after the audit trigger was installed — id 27, at
15:01:34 on 08-24 — and shows it back at 0 six seconds later. The reason is the
one this section already gives: documentary re-reading is a weaker claim than
the one the flag encodes, and the daily watch's own prompt was updated the same
minute to say so ("Ids 27 through 34 were left `verified=0` after the 08-23
wipe, deliberately ... do not restore them"). Anyone reading the paragraph above
and finding zeros should not treat that as a regression to fix.

Be precise about what that flag now means on those rows. It is **documentary
verification** — the sources and method each claim requires are present and
internally consistent — not independent re-derivation, because the external
articles cannot be re-fetched from this environment. That is a weaker claim than
the runs' own, and it is the honest one.

**The original note, kept because the reasoning still applies.** Only `published = 1` was put back, on the
single newest story, after reading it. `verified` is each run's own assertion
that it traced every number to a source it pulled that run; the original values
are not recoverable from D1, and setting them to 1 in bulk would manufacture
claims no run ever made. Ids 27 through 34 are still `verified = 0` on purpose,
so the archive and the record table are thinner than they should be. That is the
honest state, not a pending chore.

#### SUPERSEDED 2026-08-25: documentary verification is not the standard

Read the two paragraphs above as history. **Ids 27 to 35 are `verified = 0` and
`published = 0`, permanently**, and the documentary re-verification recorded
above does not put them back.

Both accounts were right about their own test and neither was the site's. The
documentary standard asks whether a story cites what it claims to cite and holds
together internally; all nine passed it. The site's standard is Ken's, stated
twice: *use the same valuation as the cheat sheet* and *the two values should
always track identically*. Against that, those rows fail on the only thing a
reader can check — Jeremiyah Love quoted at $47 against a board that says $25,
Brock Bowers at $25 against $53, Zay Flowers at $26 and $32 against $25. A story
whose sourcing is impeccable and whose price contradicts the sheet open on the
reader's other tab is still the bug this whole thread is about.

So: **a story is verified when its board figures reproduce against the served
board, and not otherwise.** Sourcing is necessary and not sufficient. Ken settled
this on 2026-08-25 when the two positions were put to him.

The "verified wipe recurred on 2026-08-24, narrowly, still unexplained" note in
the entry above is also resolved, and it was not a wipe. Another session retired
ids 27 to 35 deliberately at 14:58 UTC on price grounds, having recomputed the
board; id 35 came back to 0 while 41 to 43 kept their flags because those three
had been checked and held. There is now an audit trail (§36) so the next such
change carries a timestamp instead of an inference.

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
**unique daily users**, plus page views, time on site, top pages, where arrivals
came from, and the site's named click events, over a 7 / 30 / 90-day window.

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

### Time on site is read off the log, and says where it stops being able to

There is no beacon (see above — that was the whole point), so nothing reports how
long a page stayed open. What the log does support is the gap between one view
and the next: consecutive views by the same visitor less than **30 minutes** apart
are one visit, and a visit is measured from its first view to its last. Thirty
minutes is the same idle window `activeNow` already uses.

The visitor id is minted fresh at UTC midnight, so a visit can never span two
days. The gap rule is only ever doing work inside a day.

That measure has one limitation, and it is a big enough one that the dashboard
states it rather than letting the number stand: **the last page of a visit has no
following view to measure against, so a one-page visit reads as 0:00.** On a site
where a guide can be the whole reason someone came, that is a lot of zeroes, and
an average over all of them understates.

The answer is not to invent a dwell time for the final page — that would make the
number look better and mean less. It is the same answer as "user-days": ship both
figures and name what each one is.

- **Time on site** — `avgSec`, the mean over *every* visit, zeroes included. The
  honest floor, and the one that leads.
- **Time on site, 2+ pages** — `avgEngagedSec`, the mean over visits that turned
  at least one page, i.e. the ones where something was actually measured.

`medianSec`, `visits`, `engagedVisits`, `singlePageVisits`, `totalSec` and
`gapMinutes` all ship alongside, and the note under the tiles spells the rule out
including how many visits in the window read as zero.

The sessionisation is one SQL statement (`LAG` for the gap, a running `SUM` over
the gap flags for the visit number), so what comes back is one row per visit
rather than every pageview in the window. It carries the same `internal = 0`
filter as every other read: the operator reading their own site for twenty
minutes does not become the site's time on site, and `&includeMe=1` puts it back.

If a real dwell time ever matters more than not touching ~100 static files, the
shape is a `pagehide` beacon to `/api/track` and `timeOnSite` becomes a read over
`site_events` — but the two-number habit should survive it, because a beacon that
is blocked or fires late has its own way of being wrong.

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

`node tools/test-analytics.mjs` (93 assertions, no network, no browser), wired
into `.github/workflows/checks.yml` — it existed from the start but was
honour-system until Aug 2026. It drives the real `_worker.js` over an in-memory
SQLite standing in for D1, so the SQL is actually executed rather than described.
Beyond the never-break-the-page cases above, it pins who gets counted, that one
person on one day is one unique user, that no row contains an IP or user-agent,
and that the admin read stays gated.

The time-on-site sections seed SQLite directly too, for the same reason: the gaps
between timestamps are the entire subject and the worker can only ever write
"now". They pin both edges of the 30-minute rule (a gap of exactly 30 minutes is
still one visit; a millisecond past it is two), that a one-page visit reads as
zero and is counted as such, and that an empty window gives zeroes rather than
NaNs — the shape a mean over no rows takes if nobody guards it.

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

**Run `build-seo.mjs` whenever a page is added**, alongside `build-front.mjs` and `build-chrome.mjs` (§24). All three are idempotent, all three are gated in CI, and a new page needs all three.
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
story)") fires **daily at 13:00 UTC** into a fresh session and adds exactly one
entry, publishing hands-off. Its prompt carries the markup template, the theme
rule, the voice, and the same grounding instruction the other desks run under:

> **Ground every current-season claim in this repo.** The roster and coaching
> landscape here is the site's own and does not always match outside sources.

**It pushes straight to `main`, as of 2026-09-01.** Until then it pushed a
branch and never `main`, matching a spec line that predates the outage below;
Ken changed that so the column needs no daily human merge to appear, the same
as §16's Routine and the camp desk. `git push origin HEAD:main` is the ship
step; a rejected push is retried with a rebase up to three times, and only
falls back to a `claude/the-pick-YYYY-MM-DD` branch (with a loud report) if
`main` itself keeps refusing it. Like §16's Routine it **stores no MCP
connectors**, so its sessions may lack GitHub tools — irrelevant now that the
push itself is the publish step. Publishing nothing is an acceptable outcome
and the prompt says so — a day with no checkable argument is better served by
silence than by a thin entry.

**The Routine also stores no git source — and that silently disabled the
column for ten days.** Unlike §16's and the camp desk's Routines, whose
trigger configs carry `sources: [krubins/iron-tuna]` (their fresh sessions
start with the repo checked out and push credentials in hand), this Routine's
config has neither. Every fresh session started with no checkout, hit the
prompt's old stop condition ("if `the-pick.html` does not exist in the
checkout, stop and report"), reported success into a transcript nobody read,
and ended. See §46 for the incident. The prompt was rewritten on 2026-09-01
to clone the repo itself instead of stopping; the canonical copy is
`tools/the-pick-routine-prompt.md`, same discipline as
`tools/lead-story-routine-prompt.md` — edit there, push the same text to the
Routine, and the diff survives in history. The durable fix is still to
re-create the Routine with the repo attached as a source, which only the
claude.ai Routines UI can do; the prompt's clone path is the bridge until
then.

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


### September 2026: the $1 defence in "The shape of a winning $120"

The shape card drew its position bars from `posCost`, which is the **starting
lineup's** spend by position, with the bench as a row of its own. On a $120
board that printed `DEF $1` for a roster whose default shape carries **two**
defences (`roster.DEF.total: 2`) at a $1 minimum each. The solve was right:
PIT at $2 starts, MIA at $1 sits on the bench, $3 for two defences on the $200
board. But the second defence was inside the BENCH bar with nothing to say so,
and `money(2)` at $120 is $1.20, rounded down on top of it. A story error, not
a solver error, so the fix is in `front.html`'s render.

The card (`#shapeCard`) now charts each position's whole seat count, starters
plus bench, with the bench seats drawn as a lighter tail of the same bar and a
`×n` body count on the label; the separate BENCH row is gone from that card.
The spend bar and its key above it are still the starters-vs-bench ledger, now
with `×n` counts too, so a reader can see the key's DEF is one body and the
bench is seven. Printed dollars in the shape card are allocated per row as
`max(bodies, floor(exact rescale))`, with the leftover handed to the largest
remainders, so the column adds to the budget the card names and no position
ever prints below a dollar a body (the same largest-remainder rule
`renormalizeToBudget` uses). On the site's own $200 board that is the
identity. At $50 the floor bites (two defences at $3 rescale to $0.75 and
print $2) and the shortfall comes out of the biggest row, so the column still
adds to $50.

`tools/test-build-desk.mjs` asserts all of it: in the data (every position's
bodies cost at least a dollar each; the positions, bench included, sum to the
budget) and in the rendered sweep (a row per position, each row's count is the
roster's, none prints below a dollar a body, the bars add to the ledger's
budget, and the note's "stops at $X" is the ledger's starter figure).

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

**Two currencies, said out loud.** `ros` is draft dollars; going rate and what you should bid
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
answers, and asserts: no recommended bid above the money actually left, rest-of-season
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
---

## 29. The shared chrome and `site.css` (PR #85, merged August 2026)

Until August 2026 every page carried its own copy of the header, the footer and
the CSS that styles them. They drifted: **10 different nav link sets across 95
pages, and 13 different footers.** The cost was navigational rather than
cosmetic — from `the-pick.html` a reader could not reach Insights, FAQ, Insight
Vault, Play-Caller Premium or Analyst Desk at all, and no page on the site
linked Privacy and Terms together.

- **`site.css`** is the single source of truth for the palette, the type scale,
  the base resets and all the chrome. Pages link it **before** their own
  `<style>`, so a page still has the last word on anything it declares itself
  and a rule left behind inline is inert rather than conflicting.
- **`tools/build-chrome.mjs`** generates the header and footer from one link
  set, between `<!--chrome:*-->` sentinels, so it replaces only its own output.
  Idempotent, with a `--check` mode, exactly like `build-seo.mjs`.
  ```bash
  node tools/build-chrome.mjs           # writes
  node tools/build-chrome.mjs --check   # writes nothing, exits 1 if stale
  ```
- **Run it whenever a page is added.** A page published without it has no nav,
  no footer and no stylesheet, and the CI gate fails on the next PR. This is
  what the camp/preseason Routine (§12) had to be taught.

**Three visual zones, deliberately.** The content pages and the app are dark;
`front.html` is light and owns its own stylesheet and three-row masthead; the
three READING pages — `lead.html`, `analyst-desk.html`,
`play-caller-premium.html` — are white, and `tools/test-reading-view.mjs` owns
that palette. The reading pages are a `NAV_EXCLUDE` set in the generator: they
take the footer and the stylesheet but keep their own short header, because an
eleven-item nav does not belong on a page you read. They do take the shared
**typeface** — leaving three pages on `-apple-system` while the other 91 render
in Inter puts the split back on the pages a reader spends longest on.

**Excluded entirely:** `index.html` (React renders its own header),
`front.html` (its masthead is its own design; its ribbon and footer carry the
same link set so nothing is unreachable) and `admin.html` (internal).

**On mobile** the nav is a disclosure menu, not a scrolling strip. The strip
that `cee7d10` shipped was right for the three links that nav then held; at
eleven it hides most of them behind a scroll with no affordance. The header is
still one line at 52px as that commit intended, and the CTA sits **outside**
`<nav>` so it stays in the bar rather than collapsing into the menu.

**Guards.** `tools/test-chrome.mjs` asserts the link set is complete, the CTA is
format-correct, the disclosure nav is wired for assistive tech, and
header/nav/footer/main are balanced — that last one because
`auction-watch-2026-07-05.html` shipped with no `</header>` and nested its whole
article inside a 1740px sticky header. `tools/test-asset-routing.mjs` asserts
every local asset a page points at exists on disk, because renaming `tuna.png`
to `tuna.webp` left 91 pages pointing at a deleted file twice — once on the
rename and once when a merge took the other side — and nothing else noticed.

---

## 30. August 2026: how #88 and #85 were reconciled

Two design passes ran at the same time on separate branches and both were right
about something. **PR #85** (merged to `main` first) built the structure: one
shared `site.css` owning the palette, and `tools/build-chrome.mjs` generating the
header and footer from a single link set, killing 10 divergent nav sets and 13
footers across 95 pages. **PR #88** built the direction: auction-first, best ball
retired, and the whole site on one *light* surface.

They collided in 98 files, because #85 centralised a **dark** palette while #88
converted 91 pages to a light one inline.

**The resolution was #88's direction on #85's structure**, which is strictly
better than either branch shipped:

- `site.css` keeps its job and changes its values. The palette is light there and
  nowhere else, so the site's colour is now **one file**, not ninety-one.
- `build-chrome.mjs` keeps its job and changes its link set: auction-first, no
  best ball, `/post-draft` present, `/insights` (the three-format chooser)
  dropped in favour of `/auction-insights`.
- `OWNED` learned the light `:root` spelling as well as the dark one, so pages
  that carried an inline palette from #88 were stripped of it. **This matters:
  `site.css` is linked BEFORE each page's own `<style>`, so a leftover inline
  `:root` silently wins** — which is precisely how the ninety-one divergent
  copies happened the first time.
- The CTA stays format-aware, with one deliberate exception: a best-ball page
  resolves to the **auction** sheet, not the best-ball room. The line is retired;
  its pages still serve, and their one button now points at what the site sells.

### What taking "ours" on 97 files cost, and how it was caught

Resolving every HTML conflict in #88's favour reverted two of #85's real fixes,
and neither was obvious:

- **`auction-watch-2026-07-05.html` lost its `</header>` again.** #85 had fixed a
  page that nested its whole article inside a 1740px sticky blurred header. Taking
  our side put the bug back. `tools/test-chrome.mjs` caught it on the unbalanced
  tag count — that assertion exists because the HTML still parses and the page
  still renders, so nothing else notices. The file was taken from `main` and
  re-converted rather than hand-patched.
- **94 pages pointed at a deleted `tuna.png`.** #85 renamed it to `tuna.webp`;
  our side still referenced the old name, so every one of those pages had a broken
  image twice over. `tools/test-asset-routing.mjs` asserts every local asset a page
  points at exists on disk — added by #85 for this exact failure, and it earned it
  within the hour.

**The lesson for the next parallel pass:** `--ours` on a large conflict is not a
resolution, it is a bet that the other side changed nothing you needed. Both
things it cost here were caught by tests rather than by review.

### Tests that changed with the contract

`test-chrome.mjs` and `test-reading-view.mjs` both asserted the *old* shape and
had to be re-pointed, not deleted:

- The palette sweep no longer looks for a white `:root` in every page — it asserts
  the opposite, that **no content page declares a palette at all** and every one
  links the shared file, then checks `site.css` itself. The three reading pages
  keep their own `:root` by design and are exempt, the same set `build-chrome.mjs`
  excludes.
- `site.css --bg` is asserted **light**, and `--teal` pinned to `#0e7c63`, because
  `#2dd4a3` is about 1.9:1 on white.
- The nav reachability set lost `/insights` and `/bestball-insights` and gained
  `/fantasy-football-auction-values` and `/post-draft`.

## 31. August 2026: the generated lead speaks the reader's league, and its own clock

Three complaints about the same card on the front page, all of them fair, all of
them about copy the site did not write. The lead is generated by a Routine every
three hours (§17) and the site was printing what it stored, verbatim:

1. **The dollars were somebody else's.** "Bid $32, not the sheet's $26" is a
   price in a 12-team, $200 league. A reader who plays $300, or ten teams, or
   half PPR was being quoted numbers their own cheat sheet on this same site
   disagreed with. The site knows their league — `it-league.js` has known it
   since §9f — and `paintGeneratedLead()` explicitly opted out of using it, on
   the reasoning that the story "already quotes real dollars off the live board".
   It does. Just not off *theirs*.
2. **It said UTC.** "Today's 11:00 UTC odds refresh." The audience is American
   fantasy managers. Nobody keeps a UTC clock, and the stamp underneath the
   headline had already been converted to the reader's own zone (§17), so one
   card carried two clocks and only one of them was readable.
3. **The headlines described the story instead of instructing the reader.**
   "Zay Flowers moves to WR9 on the book's top-ranked offense" is a thing that
   happened. "Kevin English has beaten the field average ten years running" is a
   stranger's name and no price at all.

### 1. Every price restated in the reader's money

`repriceCopy(text, names)` in `it-league.js`. It rewrites the dollar figures in a
headline, a dek, an article body or an archive link, and it makes two different
corrections on purpose:

- **A dollar attached to a named player** is re-anchored on that player's own
  price on the reader's board: `myValue / siteValue`, both read off the same
  curve model, one at the reader's settings and one at the site's defaults. That
  ratio carries scoring, budget and league size at once. Scoring is the half no
  amount of budget arithmetic can do: a full-PPR back and a standard-scoring back
  are not the same player, and only the reader's own board knows that.
- **A dollar attached to nobody** — a pool, a tier, a gap — scales by
  `(teams x budget)`, which is what every price on an auction board scales by.

Attribution is by **binding**, and this is the part that has been wrong in
production. A figure is bound to a name when nothing but a linking word stands
between the two, and that reads in both directions:

1. **Backwards** — "Drake London at $29" — and only to the NEAREST name before
   the figure, so "Cap Drake London at $29, Garrett Wilson at $26" gives each
   figure to the player beside it.
2. **Forwards** — "bid up to $33 on Tetairoa McMillan" — where the figure is
   written price-first and points at the name that follows it.
3. **Unbound** — the nearest name in the figure's own sentence, the one before
   it first, then the one after ("$32 is the bid on Flowers" opens its own
   sentence and falls forward).

`scanNames()` also pulls capitalised runs out of the copy and keeps the ones the
reader's board can name, because only four players travel with a story and a dek
routinely prices a fifth ("...Garrett Wilson at $26 and DeVonta Smith at $26").
Without that, the fifth player's dollars were priced off the fourth player's
board slot.

#### The off-by-one that put two prices on one player (2026-08-23)

Only rule 1 existed. Every figure went to the name before it, whatever the
sentence actually said, and story 31 shipped this on the front page:

> **Cap J.K. Dobbins at $4 and bid Tetairoa McMillan to $36 as cheap backs get better**
>
> ... Cap J.K. Dobbins at $4 and Jadarian Price at $3; bid up to **$7** on
> Tetairoa McMillan and $48 on Justin Jefferson.

McMillan at $36 in the headline and $7 in the dek, four words apart. **The stored
row was fine**: it says $33 for McMillan in both, and every figure in it is
internally consistent. The split was made at read time, in the browser, and only
for readers with a saved league — which is why it survived every check the desk
runs on its own copy before the INSERT.

The headline was right by luck. It writes the price name-first ("McMillan to
$33"), so rule 1 found McMillan. The dek writes it price-first ("$33 on Tetairoa
McMillan"), so rule 1 walked back past the semicolon to **Jadarian Price** and
restated a $33 receiver off a $5 running back's board slot: $33 x 1/5 = $7.
Jefferson's $44 then came off McMillan's slot at $48. Every price-first figure in
the site's history was one player out.

Three things to take from it, none of them specific to this file:

- **A rule that is right on the copy in front of you is not a rule.** "The player
  before it owns it" was tested against name-first copy only, and the prompt's
  own worked example is price-first. Test the phrasing you did not write.
- **`and` is not a linking word**, deliberately. "$33 on McMillan and $44 on
  Jefferson" is two bindings, not one running on. Reading `and` as a link is the
  same off-by-one in a different coat.
- **A figure bound to a player the reader's board cannot price now scales with
  the room**, rather than falling back onto the previous name. It is still his
  figure; the fallback is what caused this.

A second defect fell out of the same reading. `sentenceStart` cut on any `". "`,
so **a period inside a name ended the sentence**: "Cap A.J. Brown at $25 and
Chase Brown at $20" started its sentence at "Brown at $25", put A.J. out of his
own reach, and handed his $25 to the other Brown. Both Browns are on the board,
so neither gets a surname of his own to be found by, and the fifth-player scan
could not save it. Sentence boundaries now skip a period that falls inside a
name mention (exact, and it covers "St." and a trailing "Jr.") or that follows a
single letter (an initial in a name nobody's board can price). Two letters was
tempting and is wrong: an English sentence can end in "is."

`tools/test-it-league.mjs` block 11b pins all of it, including the published
title and dek as one case that asserts the two cannot disagree about one player.
Five of its eight checks fail on the pre-fix library, verified by reverting.

#### Restating between LEAGUES is not restating between MODELS (2026-08-23)

The next report was "a story says bid $34 for Zay Flowers, not the sheet's $27,
but the sheet has him far lower." It did, and everything in that sentence was
working as designed.

Story 29 (`zay-flowers-wr9-odds-2026-08-22-16`) was written at **half PPR** —
its own method line says `rec*0.5` — and priced by **value over replacement**
with the odds overlaid. It put Flowers at $26 on the consensus baseline and
argued for $32. `it-league.js` is a different animal on both counts: it prices
at **full PPR** off a **fixed rank curve** with no odds, which puts Flowers at
$20, WR14. A reader's own board said $21. So `boardRatio` came out at 21/20 and
`repriceCopy` multiplied half-PPR figures by a full-PPR ratio, printing **$34
and $27 above a cheat sheet that reads $21**, under a heading saying "Your
league".

Nothing misfired. The ratio was computed correctly and applied to the right
player. The defect is one assumption nobody had written down:

> **`repriceCopy` assumed a dollar written by a story was a dollar on this
> board.** `mine / site` converts a price between LEAGUES, inside one model. It
> cannot convert one between MODELS, and it has no way to notice it is being
> asked to.

**The fix is upstream, and it is the one the site's own rules already demanded.**
There is supposed to be ONE valuation here: the player card carries none of its
own, and `tools/test-player-card.mjs` fails the build if it grows one. The
lead-story run was a second valuation that lived outside the browser, where that
test could not see it. So the run now prices the way the cheat sheet prices:
rank by points within position, read the market curve at that slot, scale by
`(teams x budget) / 1440`, $1 floor. `tools/lead-story-routine-prompt.md` carries
the recipe, tells the run to read `CURVE`/`CURVE_BUDGET` out of the repo rather
than from memory, and makes it check two printed consensus prices against the
cheat sheet before it inserts. Value over replacement is gone from the prompt,
along with the priced-pool cutoff: the curve's own length is the pool, and a
rank past its last slot is a $1 player. **The Routine holds the live copy — this
change is not in effect until the same text is pushed to it with
`update_trigger`.**

Downstream, three rules, all of them decided by the site's owner after the
report:

- **Every story is restated into the reader's league**, old model or new. A
  price in a league nobody plays helps nobody, so refusing to convert is not an
  option: it leaves the reader doing the arithmetic the page exists to do.
- **A reader with no league is shown the site's default, named in full** —
  "the site's default league: 12 teams, $200, full PPR" — because "the default"
  is not a league anybody can check a price against.
- **Nothing a reader sees calls it "the desk."** It was in-house shorthand for
  the scheduled run, it meant nothing to anybody outside this repo, and it was
  on the front page, the `/lead` error state, the camp note and the pricing
  note. All four now say what they mean.

`staleModel(createdAt)` survives, but only to LABEL: a story from before the
scoring change is restated like any other and its note adds one plain sentence
saying it was written before the site changed its scoring, so its prices can
differ from the reader's cheat sheet. All four call sites — the front-page lead,
its "Recent insights" list, the `/lead` article and its archive — pass the
story's own `createdAt`, and block 12 asserts each one does, because without the
date the flag is dead code and every story looks current.

**29 of the 30 verified rows predate the model change** and cannot be made to
track the cheat sheet by any amount of arithmetic: their dollars came off a
board that no longer exists. They are labelled, not corrected. Retiring them
(`UPDATE lead_story SET verified = 0 WHERE created_at < 1787443200000`) is the
only thing that makes them stop quoting prices the sheet disagrees with, and it
is a data decision rather than a code one.

The general lesson, which is the one worth carrying: **a conversion has to know
what it is converting from.** `repriceCopy` knew the reader's league and assumed
the rest.

#### Two different columns over each other, and the board that was never the board (2026-08-23)

The report that finally reached the bottom of this: *"the numbers you just gave
me are above what's on my sheet. Does the site have the ability to look at the
cheat sheet and see what the sliders are set to?"*

It did. It was throwing both away.

**Defect one: the snapshot stored the wrong column.** `index.html` wrote
`v: p.auctionValue` into `iron_tuna_values_v1` — the **True Value** column,
value over replacement. `it-league.js`'s own board stores the market curve
price — the **Market Price** column. `boardRatio` then computed
`mine.v / site.v` and multiplied every story dollar by it. That is not a league
conversion. It is two different columns of one sheet divided by each other, at
two different Vegas settings, which is why the error ran in both directions and
why three rounds of fixing the story pipeline never moved it. The snapshot now
stores Market Price (with True Value alongside as `tv`, and `sv: 2` marking the
shape), copied off `baseValued` — which has already been through
`applyVegasWeight()` at the reader's own slider, scoring, budget and team count.
**Nothing is recomputed for it on purpose: a second calculation is only a second
chance to disagree with the sheet.** A shape-1 snapshot is read for the league it
names and never for a price, and heals on the reader's next app open.

**Defect two: the Vegas slider was read and discarded.** `cfg` kept teams,
budget, format and scoring out of a saved config that also carried
`strategy.vegasWeight`, so every number this library quoted was at a weighting
the reader had not chosen. Kept now, guarded with `typeof` rather than `num()`:
`num(null, 0.75)` is **0**, because `Number(null)` is 0 and 0 is finite, so a
reader with no slider saved would have been read as one who had dragged it fully
off the sportsbook. Same trap `_worker.js` documents in `applyVegasWeight`.

**Defect three, and the reason a static board can never be right.** The board in
`it-league.js` is generated from the **committed** `PROJECTIONS`. The app is
served `blendProjections(overlay)` — those projections re-blended with TODAY's
odds at `VEGAS_WEIGHT = 3`. Two different boards, diverging every time a line
moves. Measured on the day: Derrick Henry $25 RB13 on the static block, **$38
RB8** on the board the reader actually sees; Jeremiyah Love $47 RB6 static,
**$25 RB13** served. A story quoted the $47 as "the consensus sheet" at readers
whose row said $25, and it was *right* to quote its $38 recommendation, which is
the served number exactly.

So the board is now **served, not shipped**: `/api/board` (§9d in `_worker.js`)
builds it from the same blended pool the app gets, prices it with `_colPrice`,
and caches it for fifteen minutes. `it-league.js` fetches it and adopts it over
the static block, which survives only as the fallback for a browser that cannot
reach it — a rejected request, a non-200, an empty or price-less payload all
leave the reader on the static board rather than on nothing. `onBoard(cb)` is
the repaint hook: the front page registers it **once, outside any paint** (a
waiter registered inside a paint repaints itself forever, because `onBoard`
fires immediately once the request has settled), and `/lead` paints once so it
*waits* on the board rather than swapping dollars under the reader.

The prompt now sends the run to `/api/board` for every "the consensus sheet says
$X" and tells it to verify against that endpoint by name. The run of
2026-08-23 10:15 passed its own price check against `it-league.js`'s static
block and reported "all three match" — true, and worthless, because it was
checking against a board no reader sees.

**The lesson, third time of asking: do not recompute a number the site has
already published. Read it.** Every one of these three defects is a second
calculation that was supposed to agree with the first and did not.

`tools/test-it-league.mjs` blocks 11d and 11e pin it: the sheet figure landing on
the reader's own row, the slider kept and the `num(null)` trap, a shape-1
snapshot refused for prices, the fetch and adoption of `/api/board`, all four
failure modes falling back to the static block, the late-`onBoard` caller, the
no-`fetch` case settling instead of hanging, and both pages' hooks.

### Tests

- `tools/test-it-league.mjs` — the anchoring rules, the surname case, the
  scanned fifth player, the `$1` floor, the no-league refusal, the note's
  wording, and that both pages actually call `repriceCopy` before painting.
  Block 11b covers which player a figure belongs to: price-first and name-first
  phrasing, `and` as a separator rather than a link, a name written with
  initials, and a figure bound to a player the reader's board cannot price.
  Block 11c covers the story written before the scoring changed: restated like
  any other, warned about in the note, the boundary date itself, and that no
  reader-facing note says "the desk".
- `tools/test-lead-story.mjs` — the clock conversions in both DST halves, the
  12-hour and no-minutes forms, the previous-day marker, the nonsense-hour
  refusal, the fallback-versus-`Intl` sweep, and `names` in the payload.

---

## 32. August 2026: the player lookup, and the card it lands on

**What a reader can now do.** Type a name in the ribbon, pick a face out of the
list, and land on that player's card at `/player/<slug>`. Every ribbon is
`position: sticky`, so the box is on screen the whole way down the page rather
than only at the top.

**Four surfaces, one widget.** The front page's white ribbon (`front.html`), the
draft app's dark ribbon in both its forms — the splash and the hub, which share
`.lp-ribbon` in `index.html` — and the card itself, because the second thing a
reader does on a player card is look up another player. All four mount the same
`/player-search.js`; there is one search box on this site, not four that drift.

### The pieces

- **`player-search.js`** — the lookup index and the widget that reads it, as one
  plain file loaded by `front.html`, `player.html` and `index.html` alike. It
  carries **identity only**: `slug|Name|TEAM|POS|espnId|nflId`, one line per
  player, ~28 KB for 407 rows. The block between the `generated by
  tools/build-front.mjs` sentinels is generated, exactly like
  `DEFAULT_BOARD_RAW` in `/it-league.js`.
  - **`mount()` returns a teardown.** The app is React and mounts the box from
    an effect; the menu it opens is parented to `<body>`, so React will not
    clean up something it never rendered. Every listener is registered through
    the widget's own `on()` for that reason.
  - **The app deliberately does NOT search its own board.** The board only
    exists once a reader has opened the app and configured a league, and the box
    has to work on the splash screen, before any of that. So it offers identity
    and hands the pricing to the card, like every other surface.
- **`player.html`** — the card, served at `/player` and `/player/<slug>`. It is
  a shell: the slug is read off the path and the card is assembled in the
  browser. `noindex,follow` and deliberately absent from `sitemap.xml`, for the
  same reason `/lead` is — one file answering at ~400 URLs, with nothing in the
  served HTML for a crawler to read. `tools/test-seo.mjs` asserts both halves of
  that.
- **The route** — `_worker.js` rewrites `/player/<slug>` onto `/player`, the
  same shape as `/lead/<slug>`. **Extensionless**, or the assets layer answers a
  `.html` target with a 307 back to the path the rewrite fires on
  (`ERR_TOO_MANY_REDIRECTS`, §12's routing note). Pinned by
  `tools/test-asset-routing.mjs`.
- **`tools/build-front.mjs`** now writes three things, not one: `front.html`'s
  data blocks as before, `player-search.js`'s index, and `player.html`'s
  `STORIES`. **Run it after every projections update.** CI diffs all three.

### The card carries no valuation of its own

Every number on it comes from **`/it-league.js`** — the reader's own saved board
when they have one, the site's default 12-team $200 board when they do not, and
`tailorLabel()` says which just answered. Nothing on the card computes points or
dollars. A second valuation on the site is a second answer to "what is he
worth", and §20 is the monument to how that goes.
`tools/test-player-card.mjs` fails the build if either file grows one.

### The trap: the two boards do not mean the same thing by `v`

| board | `v` is | in the app |
|---|---|---|
| the reader's saved board (`iron_tuna_values_v1`) | `auctionValue` — the VBD number, **what he is worth** | `buildValuations` |
| the site's default board (`DEFAULT_BOARD_RAW` + the curve) | the market curve at his slot — **the going rate** | `calculateMarketValues` |

So the card labels the tile for whichever board answered — **Worth** on the
reader's own, **Going rate** on the default — and the line under it says the
same thing in words. Labelling both "worth" would have the site telling a reader
the price is the value, which is the confusion the cheat sheet's Proj / Value
split exists to end. Asserted in `tools/test-player-card.mjs`, including the
fact it rests on (that `/it-league.js` reads its default price off the curve).

### Two smaller things that are load-bearing

- **The suggestion menu is a child of `<body>`, positioned in viewport
  coordinates.** It cannot be nested under the input: `.ribbon .wrap` is a
  sideways scroller, and an absolutely positioned child of it is clipped to the
  band's 44px — which is to say invisible. It re-places on scroll, because the
  ribbon moves under the page.
- **Its `z-index` is per page, and in `index.html` the number is load-bearing.**
  60 clears the front page's ribbon (40). In the app it has to clear
  **`.landing-splash`, which is 1000** — the surface the dark ribbon sits on —
  or the menu paints underneath it and is simply invisible, with no error and
  nothing in the DOM to show for it. It is 1050 there: above the splash, below
  `.modal-bg` (1100), because a modal genuinely should cover the ribbon.
  `tools/test-player-card.mjs` asserts both inequalities against the real
  declarations rather than the literal number.
- **The index is keyed by the HEADSHOT slug, not the projection name's.** Every
  story carries `ppl`, the headshot slugs of the players it names, and a card
  keyed the other way could not find the calls written about its own player. The
  two spellings do not always agree — "Chigoziem Okonkwo" against "Chig
  Okonkwo", "Deebo Samuel" against "Deebo Samuel Sr." — so `build-front.mjs`
  tries an exact slug match first and a club-and-position match on the surname
  second. Anything still ambiguous resolves to nothing rather than to the wrong
  face and the wrong article list.

### Scope

Kickers and defences are in the index, because a reader who types "Bates" and is
told the board has never heard of him has been told something untrue. They sort
below the skill players, and their cards say plainly that the shared library
carries points for QB/RB/WR/TE only and point at the cheat sheet.

### Tests

- `tools/test-player-card.mjs` — index coverage against `PROJECTIONS` (by name,
  club and position, never by slug), slug uniqueness and URL-safety, the
  no-second-valuation rule, the Worth/Going-rate split, the route, the box's
  place in both the white and the dark sticky ribbons, the menu's stacking
  against `.landing-splash` and `.modal-bg`, and that every player a published
  call names *and the app prices* has a card.
- `tools/test-asset-routing.mjs` — `/player`, `/player/`, `/player/<slug>`.
- `tools/test-seo.mjs` — the card is noindex and out of the sitemap.

---

## 33. August 2026: every player named in a story links to his card

**What a reader can now do.** Read a call, an insight or a story, see a player's
name in the copy, and click straight through to his card at `/player/<slug>`.
Not a name in a list of links at the bottom of the page — the name where the
desk actually wrote it.

### Where it lives, and why there

**`player-search.js`.** That file is already the site's answer to "who is this
name, and where is his card": the ~400-row identity index behind the ribbon's
search box. Linking a mention is the same question asked from the other end, so
it is the same file. `/it-league.js` answers what a player is **worth**, which
is a different question, and a second name index on this site would be a second
answer to "who is this" — §20 is the monument to how a second answer goes.

It exposes two calls and one automatic pass:

- **`linkPlayers(scope, opts)`** — link the players named inside ONE story.
  `scope` is the element, or an array of them when a page paints one story into
  several boxes (`/lead` writes the headline, the dek, the body and the calls
  list separately, and they are still one story).
  - `opts.cast` — who the story is about, as slugs or as full names, for a
    surface rendering from data that already knows. It only ever ENABLES a short
    form; a full name in the copy resolves with or without it.
  - `opts.skip` — a slug to leave as plain text. The player card passes its own
    man: a link back to the page you are already reading is a dead end wearing a
    link's clothes. He stays in the cast, so a surname he shares still cannot be
    read as somebody else.
- **`linkAllPlayers(scope)`** — every story inside `scope`, each read on its
  own.
- **On boot**, `linkAllPlayers(document)` — the stories already in the served
  HTML.

### What counts as one story

`.call` — the block the drop pages, `/the-pick`, `/lead` and
`/play-caller-premium` all wrap a single call in — or `.ins`, the article the
premium and vault lists render, or anything a page marks `data-player-links`.

**This is not decoration.** The block is the unit the short-form pass is scoped
to. The desk writes "Kyren" after it has named him, and the only safe way to
read a bare word is against the players that same block has already committed
to. Two calls on one page never share a cast: one call's "Allen" must not be
read out of the other's.

### One link per player per story

A call about Kyren Williams names him six times. Six links to the same card is
not navigation, it is a paragraph with a rash — so only the **first** mention of
each player in a story becomes a link. The first time a reader meets the name is
the moment the card is useful; after that they have already been offered it and
are trying to read a sentence. Every later mention stays as plain text.

The cap is **per story, not per page**: the next call links him again, because a
reader who starts there has not been offered anything yet. And `linkPlayers`
counts the links already standing in a scope before it starts, so re-running it
over the same DOM cannot promote the second mention to a first one.

### The four rules that keep a link off an adverb

1. **A name already inside a link is left alone.** Most story headlines ARE
   links, to the story, and a link inside a link is not a thing. The headline
   keeps its own destination; the copy under it carries the player links.
2. **A full name always resolves**, with the punctuation the desk actually
   varies: `A.J. Brown` also answers to `AJ Brown`, `De'Von` to the curly
   apostrophe the CMS writes and to `DeVon`, and every hyphen to the
   non-breaking one that stops a name wrapping mid-word.
3. **A one-word short form resolves only against the block's cast**, and only
   when exactly one member of it owns that word. A surname two of them share
   resolves to neither — the same rule `findPlayer` follows in `/it-league.js`.
4. **A word that is also ordinary English** — `likely`, `love`, `price`, `all`,
   `will` — is left as text where a sentence has just begun, because a capital
   letter after a full stop says nothing about which one it is. Mid-sentence, or
   in the possessive, it is the player: "Likely's outlook" is Isaiah Likely,
   "Likely, the Ravens will..." is an adverb. Written out in full it links like
   any other name; the list only ever sees the one-word form.

A club's defence is not a player mention: "Kansas City Chiefs" in a sentence is
a team, and DEF rows are dropped from the pattern.

### The trap: the desk does not always write a man out in full

`auction-insights-2026-08-10#call-4` says **"Kyren" four times and "Kyren
Williams" never**. Rule 3 alone leaves that call with no links at all, and
relaxing it — reading a bare word against the whole league — is how a tight end
called Likely turns every adverb on the site into a link.

So **the answer travels with the call**. `tools/build-front.mjs` already works
out who each call names, for the front page's faces; it now stamps that same
list onto the section as `data-players`, and `linkPlayers` seeds the cast from
it. One question, asked once, in the place that already asks it.

- **Stamped in all three editions.** A drop is published as auction / snake /
  bestball off one research set, and `call-3` on a date is the same call in
  each, so the cast read out of the auction edition is the cast of all three.
  `/insights` lifts these sections straight out of the drop page, which is how
  the attribute reaches that page too.
- **Only players the site prices are stamped.** The fullback the Ravens story
  names earns a photo on the front page — `ppl` keeps him — but he has no card,
  so he cannot be a link.
- **The extraction regexes had to stop assuming a bare tag.** `build-front.mjs`
  matched `<section class="call" id="call-N">` exactly; the first run after
  stamping found six stories instead of seventy and rewrote both data blocks
  with them. Both call regexes now allow attributes. CI diffs the WHOLE tree
  after a build for this reason, not the three files that carry data blocks.

### The surfaces

| where | how it links |
|---|---|
| the drop pages, `/the-pick`, `/play-caller-premium` | boot pass over `.call` |
| `/insights` and its per-format twins | the calls are fetched out of the drop page, then `linkAllPlayers` on the box |
| `/my-insights`, `/insights-vault` | `linkAllPlayers` after every redraw — a filter change repaints the list |
| `/lead` | `linkPlayers` over the four boxes as one story, cast from the run's own `names` |
| `/analyst-desk` | `linkPlayers` per entry, cast from the analysts' calls |
| the front page lead | `linkPlayers` on `#leadBody` at the tail of both painters, cast from the story's `ppl` |
| the player card's call list | `linkPlayers` per call, `skip` the card's own man |

The front page's story rails and the card's headlines are wholly inside `<a>`
already, so rule 1 leaves them alone — that is the correct outcome, not a gap.

### Tests

- `tools/test-player-links.mjs` — the four rules above, each with the case that
  would break it; the one-link-per-story cap, that it is the FIRST mention that
  carries the link, that two men in one story get one each, and that the next
  story links the same man again; the cast scoping, including that two calls on
  a page do not share one; `skip`; idempotency; a real published call out of
  `auction-insights-2026-08-10.html`, which is the one that never writes the
  full name; that every stamped slug is a player the index knows; and that every
  page carrying a `.call` or `.ins` actually loads `/player-search.js`.
- The freshness check in CI now diffs the whole tree after `build-front.mjs`,
  because a stale stamp fails silently — the page renders, the short forms just
  stop linking.

---

## 34. August 2026: every card says how the odds rate him, and the front page says so daily

**What a reader can now do.** Open any player card and read, in one panel, where
the consensus rankings put him and where he lands once the betting market is
priced in — for all four hundred players, not the twelve the front page happens
to be rotating. And read on the front page, above the case, what the two boards
argued about *today*.

Both are counted off the same daily odds pull (§9b, `0 11 * * *`), and both are
computed rather than written, for the same reason §9c is: a hand-authored line
about a market goes stale the day after it is written.

### One computation, three surfaces

The change is mostly a refactor. `buildVegasColumn` used to build its twelve
cases inline; the ranking work is now `buildVegasBoard(overlay, ctx)`, which
returns **a row for every skill player**, and three things read it:

| surface | reads the board as | endpoint |
|---|---|---|
| the front page's `#vegas` case | a filter — priced, draftable, past the noise floors, top twelve by dollar gap | `/api/vegas-column` |
| a player card's odds panel | a lookup — one row, plus his place in the day's queue of risers or faders | `/api/player-odds` |
| the front page's dateline | a count — how wide the disagreement is today | `digest` on both |

That is the point of the split, not a side effect of it. A card and the column
quoting two different slots for the same man is the failure this makes
structurally impossible, and `tools/test-player-odds.mjs` asserts it directly:
every case the column ships is looked up again through the card's path and the
numbers have to match.

Two flags are new on a row and deliberately do **not** leave the worker on the
column's payload (`buildVegasColumn` deletes them, and a test checks it):

- **`priced`** — a book moved *this man's own* numbers.
- **`draftable`** — either board still has him inside the curve.

The column needs both true. A card needs neither, which is the whole reason the
per-player answer exists.

### A player nobody priced still has an answer

This is the case the column could never cover and the most common one on the
site. A board is a queue: when the market raises the backs around him, his own
slot moves without a single line being posted on him. The card says exactly
that — *"No book posted a line on Achane himself. He still slides 2 slots down
the RB board… because the market moved the players around him."* — rather than
hiding the panel, which reads as a bug.

Five true lead sentences, chosen by what the day's lines actually did:

1. priced and moved → the slot change and the dollars.
2. priced and landed on the same slot → confirmation, and it says it is
   confirmation rather than an edge.
3. not priced but the slot moved anyway → the sentence above.
4. not priced and nothing around him moved → both boards agree, stated plainly.
5. a kicker or a defence → **no book posts a season-long market this site
   models for either**, so there is nothing to hold a ranking up against. Said
   out loud, because §32 already puts K and DEF in the lookup and a silent
   panel on one position group and not the others reads as breakage.

### The daily dateline on the front page

Twelve cases at one every six hours is three days of rotation, so the case on
screen cannot by itself say what changed today. `buildVegasDigest(board)` counts
it: how many players a book priced, how many draftable players the two boards
part company on, the up/down split, the total dollars of disagreement, the split
by position, the biggest raise and the biggest fade, and the club at each end of
the argument. `#vsDay` renders it as one paragraph above the thesis.

Three things it will not do:

- **No digest, no dateline.** An older cached payload or a missing overlay
  hides the element rather than printing a sentence full of zeroes.
- **A quiet day is stated, not faked.** Nought disagreements gets its own
  sentence — *"…did not move one of them far enough to change a slot"* — which
  is itself the answer.
- **The team clause always states both ranks.** Same constraint as §9c: the
  team-environment signal is a *ratio*, so "the market has them #4" alone is
  misleading when the consensus already has them #3.

The digest is sorted with a name as the final tiebreak (`_colByRise` /
`_colByFade`) so two reads of one overlay produce the identical dateline. A
front-page paragraph that reshuffles on reload reads as noise, not as news.

**It lives inside a section that can leave the page.** `setVegasVisible()`,
added on main alongside this work, pulls the whole column — head, dek, thesis
and its ribbon jump-link — when the odds feed has no case to make. The dateline
is a sibling of `#vegasWrap`, not a child, so `renderDay()` gates on
`vsItems.length` as well as the digest, and `renderCase()` runs first: a
dateline left standing over nothing is the same floating-orphan problem that
removal was for, one paragraph smaller.

### Contracts, and the cache that made them necessary

`COLUMN_CONTRACT` went **3 → 4** with the digest, and `VS_CONTRACT` in
`front.html` with it — the pair is asserted by `tools/test-it-league.mjs` and
again here. §9c's monument to why is still accurate: fifteen minutes of public
cache means new HTML meets an old payload unless the two are keyed apart.

`/api/player-odds` carries its **own** contract, `PODDS_CONTRACT` (1, matched by
`PC_ODDS_CONTRACT` in `player.html`). Separate on purpose: the two endpoints
ship different shapes and are cached separately, so one can grow a field without
throwing away a quarter of an hour of the other's cache. The card drops any
payload whose contract is not its own, and drops any player missing a field it
prints (`PC_ODDS_REQUIRED`), exactly as the column does.

**The daily pull now drops both caches.** `runOddsRefresh` clears
`_COLUMN_CACHE` and `_PODDS_BOARD` on success. They would age out inside the
quarter hour anyway, but the whole promise of these two surfaces is that they
are current, and the pull is the moment they stop being.

### Why a per-player query rather than one payload

The full board is ~350 rows with three stat lines each; a card needs one of
them. The board is built **once per isolate** and every card slices it, so four
hundred distinct URLs cost a map lookup each, not a rebuild and not a D1 read.
The response stays public and cacheable — nothing in it is specific to a reader.

### Money on the card

Ranks are the site's default scoring and say so. Dollars go through
`ITLeague.deskPrice()` — the library's own conversion, the one the card's
"Going rate" tile already uses — so a reader with a saved league is quoted the
same going rate in their own money, and the tile and the panel cannot disagree
on the same page. Points are deliberately **not** printed beside the boards:
this endpoint scores at the site's rules and the Projected tile above may be
scored on the reader's own board, and two point scales on one card is the §32
`v` trap in another costume.

### Tests

- `tools/test-player-odds.mjs` (in CI) — the contracts on both sides; that the
  board covers every skill player and that each position's ranks are a clean
  1..N on both boards; that the column is a filter over the board and never
  disagrees with a card about a player; every refusal (`unpriced_position`,
  `off_board`, `ambiguous`, `no_player`, no overlay); the digest recounted
  against the rows it claims to summarise, including that the biggest raise
  really is the biggest and that two builds of one overlay match; and then the
  **real renderers, lifted out of `player.html` and `front.html` and driven on
  real payloads through a minimal DOM** — every lead sentence, the kicker
  answer, the money-line clause, a saved league's money, and the empty states,
  each asserted to contain no `undefined` and no `NaN`. It finishes on the live
  nflverse pull and checks that *every* skill player on the real board gets an
  answer, then prints the day's dateline as a reader would read it.
- `tools/test-worker-column.mjs` and `tools/test-it-league.mjs` are unchanged
  and still pass — the column's payload shape did not move.

---

## 35. August 2026: three stories staged in the queue, and the report that backs them

Three lead stories were written to order on 2026-08-23 and inserted with
`verified=1, published=0`, which is the "stage it" path in §17 rather than a slot
run. They sit in the queue until somebody promotes one with
`/api/admin/lead?promote=<id>`. Nothing was retired to make room for them, and
the trigger `lead_story_one_per_slot` never fires on an unpublished insert, so
all three share one clock slot without colliding.

| id | slug | desk | what it argues |
|---|---|---|---|
| 38 | `coach-changes-help-hurt-2026-08-23-20` | playcaller | the five players a 2026 staff change helps and the five it costs |
| 39 | `rankings-vs-odds-widest-gaps-2026-08-23-20` | vegas | the five widest rankings-versus-odds gaps each way, in dollars |

### All three are BLOCKED on the one-board rule, and none should be promoted as written

They were written on 2026-08-23 against the pricing model that this repo
replaced the same day. Each one prints **two** dollar figures per player: a
"consensus sheet" price taken from the player's rank on the raw committed
projections, and a recommended bid taken from his rank on the blended pool.

The blended figure is right. It is `_colPrice` at the blended rank, which is
exactly what `boardPayload` serves at `/api/board` and what `/it-league.js`
puts on a reader's screen. **The left-hand figure is the bug.** No page on this
site prices a player off the unblended array, so that number does not exist
anywhere a reader can check it, and printing it as "the consensus sheet says
$47" is the failure "PRICE OFF THE CHEAT SHEET'S OWN CURVE" in
`tools/lead-story-routine-prompt.md` was written to stop.

Story 39 was promoted at 02:16 UTC on 2026-08-24 and pulled roughly ten minutes
later for this reason; id 36 went back to being the lead. Before any of the
three is promoted, the fix is the same in each: **one price per player, the
board price, and tell the odds disagreement as a rank move.** "The odds have him
RB8 rather than RB13" is the finding, and it needs no second dollar figure.
Story 39 loses its organising idea in that rewrite, because "the widest gaps in
dollars" is a ranking of an artefact; the honest version ranks by rank move.

### `verified` wiped a second time, on 2026-08-24 — closed 2026-08-30

§17 ends by saying that if `verified` ever zeroes again with `published`
intact, that is a second and separate bug. It happened, inside a ten-minute
window that is worth writing down because the first occurrence had a day-long
one.

- 02:16:37 UTC: id 39 promoted. Read back immediately: `verified=1`,
  `published=1`, `published_rows=1`, `live_rows=1`.
- Between then and 02:2x: only read-only `SELECT`s against this database from
  this session.
- 02:2x: a single `UPDATE ... SET published = ...` that named no other column.
  Read back after it: **all 39 rows `verified=0`**, `verified_rows=0`,
  `live_rows=0`. The site had no generated lead and had silently fallen back to
  the dated rotation, exactly as in the first incident.

What that rules out, measured rather than assumed:

- **Not the Worker.** `grep verified _worker.js` finds exactly one write,
  `UPDATE lead_story SET verified = 1, published = 1 WHERE id = ?` in the
  `promote` branch. There is no code path in the site that sets it to 0.
- **Not a trigger.** `lead_story_one_per_slot` is the only trigger on the table,
  it is `BEFORE INSERT`, and it only reads `verified`.
- **Not an insert or a delete.** `sqlite_sequence` for `lead_story` was still
  40 afterwards, so no insert was attempted and rolled back, and the only
  missing id in 1..40 is 2, which predates all of this.

So the writer is outside the site: the Routine's own D1 connector, or another
session holding the same credentials. The blanket shape of it (39 of 39 rows,
including rows that were already 0) fits an `UPDATE` whose `WHERE` matched
everything, which is the same shape as the `id <> last_insert_rowid()` fault in
§17 but on a different column. **Nothing found here proves that, and the next
person should not treat it as proven.**

Recovery was deliberately narrow. `verified = 1` went back on exactly the four
rows whose value was observed as 1 earlier in the same session (36, 38, 39, 40)
and on nothing else, for the reason §17 gives: `verified` is a claim a run made
about its own sourcing, and restoring it in bulk manufactures claims nobody
made. Ids 1 to 35 stay at 0.

**The daily watch does not catch this.** `Iron Tuna: watch for empty lead-story
slots` checks `published_rows` first, and `published_rows` was 1 throughout. A
watch that tested `live_rows`, meaning `published = 1 AND verified = 1`, would
have caught both this and the original incident, because that is the pair the
site actually reads.

#### Closed. It was other agents, and it stopped when the audit trail went in.

Asked on 2026-08-30 to find what keeps zeroing `verified`, and the answer is
that nothing does any more. The thing that settled it is the trigger this
section's successor installed:

```sql
CREATE TRIGGER lead_story_flag_audit AFTER UPDATE OF published, verified ON lead_story
FOR EACH ROW WHEN old.published <> new.published OR old.verified <> new.verified
BEGIN INSERT INTO lead_story_audit (story_id, at, old_published, new_published, old_verified, new_verified)
  VALUES (old.id, CAST(strftime('%s','now') AS INTEGER) * 1000, old.published, new.published, old.verified, new.verified); END
```

It has been in place since 15:01 UTC on 2026-08-24. In the six days since, the
whole table has produced **25 flag changes**, and only four of them lower
`verified`:

| audit id | story | when (UTC) | published | verified | what it was |
|---|---|---|---|---|---|
| 2 | 27 | 08-24 15:01:40 | 0→0 | 1→0 | the archive restore above, reverted on purpose 6s later |
| 4 | 44 | 08-24 19:40:02 | 1→0 | 1→0 | the retraction written up under "Row 44, and the check that could not fail" |
| 9 | 46 | 08-25 11:18:34 | 0→0 | 1→0 | a hand retraction with no reason recorded anywhere — the one gap left |
| 19 | 53 | 08-28 11:26:53 | 0→0 | 1→0 | retired deliberately, noted in the desk prompt |

Every one of the other twenty-one is a run retiring its predecessor, and every
one of those reads `published 1→0, verified 1→1`. The retire-by-slug fix holds:
**`verified` has not been collaterally touched since 08-24.**

The zeros that remain are therefore all accounted for, and none of them is a
live bug:

- **Ids 1 to 40** were zeroed before the trigger existed, by the two incidents
  this section and §17 describe. They have not moved since. §17's "it is not
  fully explained" is now answered as far as it can be: a second session running
  `UPDATE lead_story SET verified = 0, published = 0` to a different brief, plus
  the `last_insert_rowid()` fault, plus the 08-24 blanket `UPDATE` above.
- **Ids 44, 46, 53** are the four rows in the table — deliberate retractions.
- **Everything else is 1.**

Three things to carry forward, because the shape of this recurs:

1. **The suspicion was of a mystery writer, and the writers were all ours.** Six
   Routines hold the same D1 credentials and work to different briefs. A state
   change with no author looks identical to corruption. The audit trigger is
   what turns "the table keeps changing" into "this agent did this at this
   second", and it cost four lines of SQL.
2. **Ask for transitions, not end states.** Every earlier pass at this read
   current `verified` values and tried to infer history from the pattern of
   zeros. The pattern is unreadable — post-fix zeros (deliberate retractions)
   and pre-fix zeros (the wipes) interleave by id, so no cutoff separates them.
   Only `old_verified=1 AND new_verified=0` separates them, and that needs the
   trail.
3. **`Iron Tuna: watch for empty lead-story slots` is paused, and its title says
   why: it restored retired rows.** It was armed to catch empty slots and its
   own brief pushed it toward republishing the newest `verified=1` row; it
   fired at 14:18 on 08-24 and was paused 43 minutes later. If it is ever
   re-enabled, that is the line to fix first — and the `live_rows` gap in the
   paragraph above is still unfixed in its prompt.

| 40 | `weekly-swing-steady-varied-2026-08-23-20` | market | the five steadiest week to week and the five most varied |

A staged row that is `verified=1` is **not invisible**. `published=0` on a
verified row is the *Recent insights* list under the front-page lead (§17), so
these are reachable from the moment they land. They are simply not the lead.
If that is not wanted, `verified=0` hides a row completely, but it also means
"the run failed its own gate", which is a lie about these three.

### `tools/board-report.mjs`

The numbers in stories 39 and 40 are not hand-derived. `node tools/board-report.mjs`
prints them, and it exists so the next desk run does not re-derive them either.

It lifts the **real** Vegas section out of `_worker.js` with the same
`new Function` harness `tools/test-worker-column.mjs` uses, so it runs
`buildVegasBoard` itself rather than a copy: the report cannot drift from what
`/api/vegas-column` and the player cards serve. Two markers are load-bearing,
`// Vegas-weighted projections` and `export default {`, and the script exits
non-zero with a named error if either moves or the projection parse comes back
short.

- **`--games <path>`** reads a local `games.csv` instead of fetching the
  nflverse release, which is how it runs without network.
- **`--json`** prints every row with its ranks, prices, team context and shape
  figures, which is the form the stories were written from.
- It rebuilds the odds side from today's game lines rather than reading
  `odds_overlay` out of D1. Spot-checked against the stored row on 2026-08-23:
  agreement within 0.3%, the difference being lines that moved between the
  7:00 AM ET refresh and the run. **If a story needs to quote exactly what the
  site is serving right now, read D1; if it needs to be reproducible from the
  repository, use this.** Story 39 says which one it used.

### The week-to-week model is this file's, and only this file's

`PROJECTIONS` holds season totals and no game logs, so **week-to-week variance
cannot be measured anywhere in this repository.** The `shape()` function derives
it instead, and the derivation is written out in full in the comment above it:
every scoring event is treated as a Poisson count over 17 games, so points of
size `k` arriving `m` times a game contribute `k² · m` of variance, and the
pieces sum. There are no fitted constants. There are two assumed league-level
rates, 4.3 yards a carry and 11.5 yards a completion, used only to turn
projected yardage back into a count of events.

Two things follow, and both are in the story rather than buried here:

1. **It is a floor, not a forecast.** It cannot see injuries, game script, or the
   fact that a touchdown catch is also a catch. Real Sundays are wider.
2. **The raw ranking is mostly a position ranking.** Backs collect hundreds of
   small events and tight ends collect dozens, so a raw list puts five backs at
   the steady end and tight ends at the other every time. That is why the report
   also prints `spreadZ`, each player against the mean at *his own* position,
   which is the comparison that is not knowable before you read the names.

Do not promote this model into `_worker.js` or quote its decimals on a page. It
is a desk instrument for ordering players, and the order is the only part of it
that is robust.

## 36. August 2026: who flipped the flag, and the watcher that kept flipping it back

`lead_story` has two flags and both decide what a reader sees. `published = 1`
puts a row on the front page. **`verified = 1` alone is enough to put a row in
"Recent insights"** (`WHERE verified = 1 AND slug IS NOT NULL`), which is the
part that keeps being missed: taking a story *down* means clearing both, and
`published = 0` on its own leaves it visible.

### The recurring incident

Rows written before the pipeline priced off the served board quote figures the
cheat sheet contradicts in both directions — Jeremiyah Love at $47 against a
board that says $25, Brock Bowers at $25 against $53, Zay Flowers at $26 and
$32 against $25. Every row up to and including id 40 was cleared to
`verified = 0, published = 0` deliberately, and is not recoverable: their
figures are wrong, not merely old.

Three times those rows came back. On 2026-08-24 ids 27 through 35 went from
cleared at 12:40 UTC to `verified = 1` at 14:56 UTC, which put nine stale
stories back into "Recent insights" on the live site. The only write in that
window that could have done it was the daily watch Routine
(`trig_01WTgFuRik7kDWJHJv5pDwgQ`, `15 14 * * *`, fired 14:18:26 UTC); the
lead-story Routine retires by slug and touches `published` only, and the two
column Routines write HTML, not D1.

**The watcher's own SQL is what convinced it.** Its prompt opened with:

```sql
SELECT COUNT(*) AS published_rows, COUNT(*) FILTER (WHERE verified=1) AS verified_rows
FROM lead_story;
```

`COUNT(*)` with no filter counts the whole table. It reported 43 where the
truth was 1, next to a `verified_rows` that had legitimately fallen to single
digits — a reading that looks exactly like "the flags were wiped," which is a
thing that genuinely happened on 2026-08-23. The watcher was fed a false
positive by its own query and repaired damage that did not exist. The
corrected form:

```sql
SELECT COUNT(*) FILTER (WHERE published = 1) AS published_rows,
       COUNT(*) FILTER (WHERE verified  = 1) AS verified_rows,
       COUNT(*)                               AS total_rows
FROM lead_story;
```

A `verified_rows` in the low single digits is the system working, not a wipe.
Only stories checked against the served board carry the flag.

The Routine is **paused**, because its prompt cannot be edited from a session
other than the one its fires deliver into — `update_trigger` refuses. The
corrected prompt is kept at `tools/lead-story-watch-prompt.md`; re-enabling the
Routine means pasting that in first, from the session that owns it.

### The audit trail

`lead_story` had none, which is why three sessions each read the others' writes
as corruption and why the paragraph above had to be argued from fire times
instead of read off a table. There is now one:

```sql
CREATE TABLE lead_story_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  old_published INTEGER, new_published INTEGER,
  old_verified  INTEGER, new_verified  INTEGER
);

CREATE TRIGGER lead_story_flag_audit
AFTER UPDATE OF published, verified ON lead_story
FOR EACH ROW WHEN old.published <> new.published OR old.verified <> new.verified
BEGIN
  INSERT INTO lead_story_audit (story_id, at, old_published, new_published, old_verified, new_verified)
  VALUES (old.id, CAST(strftime('%s','now') AS INTEGER) * 1000,
          old.published, new.published, old.verified, new.verified);
END;
```

Both are live on `iron-tuna-leads`. It records **what changed and when**, not
who: D1 exposes no caller identity to a trigger. That is still enough, because
every writer here is a Routine on a known schedule, so a timestamp names the
suspect. Read it with:

```sql
SELECT story_id, datetime(at/1000,'unixepoch') AS at_utc,
       old_verified, new_verified, old_published, new_published
FROM lead_story_audit ORDER BY id DESC LIMIT 40;
```

The trigger fires on the flags only, so a normal retire-by-slug leaves one row
per story and the table stays small. It is additive and touches no read path.

### Verifying a story's prices, which is the whole point of the flags

Never verify against `DEFAULT_BOARD` in `/it-league.js` — that is built from the
committed `PROJECTIONS` and is the fallback, not the board. The served board is
`/api/board` (`_worker.js` §9d): the same projections re-blended with the day's
odds at `VEGAS_WEIGHT = 3`, scored with `_colScore`, priced with `_colPrice`.
When the endpoint is unreachable, reproduce it locally from `_worker.js` plus
the stored overlay rather than trusting any other number:

```sql
SELECT payload FROM odds_overlay WHERE id = 1;   -- check length(payload) matches what you saved
```

Row 43 (Omarion Hampton, 2026-08-24) was checked this way: RB15 at $18, Ladd
McConkey WR23 at $10, every Chargers tight end at $2 — all exact. Row 42
(LaPorta) reproduced seven figures exactly against an overlay that had
refreshed *after* it was written.

### The empty slots, and what the price check now says

Three of the six lead-story slots on 2026-08-24 produced no row at all — 00:58,
09:58 and 15:58 — while `last_fired_at` on `trig_011LYewcPUQikF8izFsN2LAr`
confirms the Routine did fire. A slot that writes nothing is invisible twice
over: nothing on the site, and nothing in D1 to say the run happened or why it
held back. That is now forbidden by the prompt: a run that decides not to
publish still inserts its row at `verified=0, published=0` with the reason as
the first line of `method`.

The likely cause, and the reason the prompt changed with it: this prompt used to
say **"the easiest correct route: read `/api/board`"**, and `/api/board` has
never once been reachable from a Routine's environment. Direct fetches to
irontuna.com are blocked and the fetcher returns a permission prompt nobody is
there to answer — rows 42 and 43 both say so in their own method lines. Every
story that shipped did so by working around the instruction. So the prompt now
makes the local reproduction the primary method, spells out the four steps, and
says plainly that an unreachable endpoint is never a reason to skip a slot.

Two other rules went in at the same time:

- **Check every board price you print, not two of them.** The old text asked for
  two spot checks, which is how a story can carry five figures and have three of
  them unverified.
- **Name the board's number for every dollar figure, not just the headline one.**
  Row 43 told readers to "bid up to $15 on Ladd McConkey" against a board that
  prices him at $10, and never mentioned the $10. Not false, but it is the same
  reader-versus-their-own-sheet collision that started this whole thread, and it
  had survived four rounds of fixes because every rule so far was written about
  the headline player.

The canonical prompt is `tools/lead-story-routine-prompt.md`; the live copy was
verified byte-identical to it after the push.

### Row 44, and the check that could not fail

The 18:58 run on 2026-08-24 published a preseason story priced entirely off the
**committed** array. Its own method line is the confession:

> The 407-player PROJECTIONS array was pulled from the iron-tuna Worker this
> run, parsed to a file, and re-scored at SCORING_DEFAULTS. The result was
> checked against DEFAULT_BOARD_RAW, the generated cheat sheet committed in
> it-league.js: 343 players overlap, 332 match to within 0.15 points ... Exact
> on all four.

`DEFAULT_BOARD_RAW` is built from the committed array. An unblended board
checked against it agrees perfectly and proves nothing — two wrong boards
agreeing. The run also read `odds_overlay` **row 2** (team context) and never
row 1 (the player lines), so no blend ever happened. Six of its eight board
claims match the committed board and not the served one, the worst being
"Jonathan Taylor at RB4 and $55" where the sheet says **RB5 and $50**. It also
wrote "Alec Pierce carries 199.3 projected points **on the shipped board**";
the shipped board says 196.1.

The dollar recommendations happened to be right, because the curve is flat
where most of those players sit. That is luck, not method. Row 44 was retired
and row 43 restored as the published lead.

The prompt now carries three specific guards, all added because this run got
past the general ones:

1. At the `PROJECTIONS` bullet: **this array is the committed baseline, not the
   board.**
2. A blend self-test with a named player — Chuba Hubbard is RB34/$3 committed
   and RB28/$5 blended. If your two boards agree on him, the blend is not
   running.
3. **Never validate against `DEFAULT_BOARD_RAW`**, stated where the validation
   step is, not three sections away.

Plus a line for a run that believes the brief still says value over replacement:
it does not, and has not since 2026-08-23; that belief means a stale copy.

**It worked.** Row 45 (00:58 on 2026-08-25, the tight-end pricing piece) is the
first story that demonstrably used the served board: it prices Brock Bowers at
$53, which is TE1 blended, where the committed board says $47. Thirteen named
board figures and eight derived arithmetic claims all reproduce exactly, and it
carries a "Board price" column naming the sheet's number next to every
recommendation — the rule added the same day after row 43 quietly told readers
to bid $15 on a $10 player.

Slot coverage is still not fixed: 21:58 on 2026-08-24 produced no row either,
which is the fourth empty slot that day and the first since the "insert a row
either way" rule landed. Watch it.

### PR #105 moved every dollar, and what that cost

Merging #105 on 2026-08-25 re-cut `LEAGUE_MARKET_CURVE` by a level factor so the
column adds up to the league budget. Ranks are untouched and every ratio is
preserved — but **every published dollar figure became wrong at once**, and the
site had five stories carrying them: one live lead and four in "Recent
insights". Gibbs $72 to $80, Bowers $53 to $60, Josh Allen $42 to $47, Walker
$42 to $47, LaPorta $18 to $20.

Two things are worth keeping from the cleanup.

**`repriceCopy` does not save you here, and it is easy to assume it does.**
`it-league.js` restates a story's dollars against the reader's own board, which
is why the column can be written in one league and read in another. But
`boardRatio()` is *reader's board ÷ desk's board*: it converts between leagues,
not between curves. When the desk's board moves, the ratio is still 1 and the
stale number passes straight through to the reader. A curve change has to be
fixed in the stored text.

**All five were repriced rather than retired**, on Ken's instruction, and the
repricing was derived, never scaled. Every figure came from `COLUMN_CURVE`,
`COLUMN_SCORING` and `VEGAS_WEIGHT` read out of the deployed `_worker.js` at
repricing time and blended with the current `odds_overlay` — including the
derived ones: round boundaries by overall price rank, cost-per-point tables,
marginal dollar totals, catch- and touchdown-sensitivity thresholds. Sixty
figures were re-checked afterwards against the board and all sixty matched.

Two findings changed shape rather than level, and were rewritten to say what is
now true instead of being forced back into the old sentence: the tight-end
premium is 2.5x rather than 2.4x, and there are now two non-tight-end upgrades
above the cheapest tight-end upgrade rather than one.

**The harness that checks this used to carry the curve as a hand-copied
constant**, which would have made it agree with the pre-#105 board forever
without complaining. It now lifts `PROJECTIONS`, `COLUMN_CURVE`,
`COLUMN_SCORING`, `COLUMN_CURVE_BUDGET`, `COLUMN_LEAGUE_BUDGET`, `COLUMN_MIN_BID`
and `VEGAS_WEIGHT` out of `_worker.js` at run time. Any checker with a copied
number in it is a checker that will eventually pass a wrong board — the same
failure as validating against `DEFAULT_BOARD_RAW`, one level up.

### Cadence: 6-hourly from 2026-08-25

`trig_011LYewcPUQikF8izFsN2LAr` ran `58 */3 * * *` and five of twelve slots
produced no row at all, while the runs that did finish took 15 to 24 minutes
against a stated 8-to-20 band. Two prompt-level attempts to fix it failed,
including an "insert a row either way" rule that could not help because runs were
dying before they reached it. The schedule is now `58 */6 * * *`: four runs a day
that finish beats eight where half do not, and it halves the chance of a story
sitting live across the daily odds refresh. The underlying question — why a run
ends without inserting — is still open, and a heartbeat table would answer it
without touching the story-insert path.

### `lead_story_run`: the heartbeat, and why the last two fixes could not have worked

Five of twelve runs between 2026-08-24 and 2026-08-25 ended without inserting a
story. Two attempts to fix that failed, and both failed for the same reason,
which is the part worth keeping.

The first told the run to insert a story row either way. The second added the
blend guards. Both were placed where they belonged topically — the verification
gate, the pricing section — which is to say **most of the way through a 43,000
character brief**. If a run is dying before it gets there, no wording in those
sections can reach it. A rule only fires if the run survives to read it.

So the heartbeat is the first instruction in the prompt, before the projections,
before the desk rotation, before anything. The run claims a row and then updates
one column as it passes each checkpoint:

    start -> board -> research -> drafted -> inserted -> done

```sql
CREATE TABLE lead_story_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key TEXT NOT NULL UNIQUE,   -- '<slot>-<started_at ms>', so a run can
  slot INTEGER,                   -- update its own row and nobody else's
  desk TEXT,
  stage TEXT NOT NULL,
  story_id INTEGER,
  note TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX lead_story_run_started ON lead_story_run(started_at DESC);
```

A run that dies leaves its row at the last stage it reached. That is the
diagnosis, and it distinguishes the cases that matter: `drafted` means the story
was written and thrown away, which is the expensive failure; `research` or
`board` means it ran out of room gathering; **no row at all**, on a Routine whose
`last_fired_at` says it fired, means the session died before its first statement,
which is an environment failure and needs a different fix entirely. Until now
those four were indistinguishable from each other and from a deliberate hold.

`tools/run-report.mjs` prints the queries, with a legend for reading them.

**Two design constraints, both deliberate.**

It is a **separate table with no trigger on `lead_story`**. The obvious cheaper
design — insert a stub story row up front and update it at the end — was
rejected: it puts instrumentation directly in the path of the publish, and this
column has already shipped a double-insert once (2026-08-21, two contradictory
analyst stories seven minutes apart). Diagnosing a reliability problem must not
risk the correctness problem that is already fixed.

And the prompt says plainly that **a failed heartbeat must never stop the run**.
A run that abandoned a good story because it could not write a log entry would
have done something far worse than not logging. Instrumentation gets no
authority over the thing it measures.

The heartbeat says how far a run got. The `verified=0` story row says what it
decided. Both still apply; they answer different questions.

### The analyst desk, retired 2026-08-30

Ken: *"I don't need anything about the other analysts."* The desk that compared
Matthew Berry, Mike Clay and others against the Iron Tuna board is gone — the
rotation slot, the standing column, the API, the tests and the nine stories.

What came out, so a later reader is not hunting a half-removed feature:

| where | what |
|---|---|
| `_worker.js` | the whole `── The Analyst Desk` block (`analystCalls`, `analystScoreboard`, `analystCallsReady`, `analystColumnPayload`, the caches and the three constants), the `analyst` entry in `LEAD_CATEGORIES`, the `calls` side-query on `/api/lead-story/body`, and the `GET /api/analyst-column` route |
| pages | `analyst-desk.html` deleted; its nav and footer links stripped from 107 pages and from `tools/build-chrome.mjs`, which is what would have put them back. Nav "Columns" now points at `/play-caller-premium` |
| `lead.html` | the call-card CSS, the `#calls` container and the render block |
| tests | `tools/test-analyst-column.mjs` deleted; `test-reading-view`, `test-chrome`, `test-seo`, `test-asset-routing` and `test-lead-story` updated |
| `sitemap.xml` | `/analyst-desk` removed — a sitemap advertising a 404 is worse than a short one |
| D1 | the nine `category='analyst'` rows set `verified=0, published=0`. Four were verified; the audit trail has the transitions |

**The `calls` column stays on `lead_story`.** Dropping it would rewrite the
table for no gain, and the nine retired rows still hold their JSON. The prompt
says to leave it NULL.

**The arithmetic that nearly broke this, and the reason to read a change like
it twice.** Seven desks became six, and the obvious edit — `DESKS[slot % 7]` to
`DESKS[slot % 6]` — would have silently stranded half of them. `slot` is on a
three-hour grid but the Routine has fired every **six** hours since 08-25, so
`slot` advances by two each run. With seven desks that was harmless, because
gcd(2,7) = 1 and the cycle still reached all seven. With six it is gcd(2,6) = 2:
`slot % 6` steps 0, 2, 4, 0, 2, 4 forever, and `playcaller`, `preseason` and
`market` would never have been written again. Nothing would have errored. The
prompt now takes the desk off `deskSlot = floor(epoch / 21600)` and keeps `slot`
for `run_key` and the `lead_story_one_per_slot` dedupe, which is what each is
actually for.

The desk's other legacy is worth keeping: it is what produced the audit trigger,
and the sourcing rule it was built under (never state a named person's position
without a source pulled that run) survives as hard rule 6, now scoped to every
desk rather than to one.
### The 2026-08-26 11:00Z refresh: what a board move actually breaks

The first odds refresh after PR #105 landed at 11:00:35Z on 2026-08-26
(`odds_overlay` row 1, `updated_at` 1787742035336, 16,897 chars, up from
1787655628685 / 16,889). It is the first refresh checked end to end against
every live row, and the result is worth writing down because it sets the size
of the problem.

**241 of 312 players changed.** Almost all of it was noise — a tenth of a yard.
Only **twelve players changed rank**, all of them adjacent-pair swaps, and only
**two changed price**: Javonte Williams RB16 $17 to RB17 $15, and Cam Skattebo
RB17 $15 to RB16 $17, a straight exchange.

So the useful diff is not the overlay. It is the board:

    node tools/board-diff.mjs old-overlay.json new-overlay.json

That reduced a 241-player overlay diff to a twelve-name list, and from there to
the four stories that could possibly be affected. Do this before re-reading any
copy; reading nine stories to find one wrong number is the slow way round.

**Every dollar figure in all nine live rows survived.** The originating
complaint — a story quoting a price the reader's own cheat sheet contradicts —
did not recur. What drifted was the supporting arithmetic, which no rule had
ever been written about:

| row | figure | said | was |
|---|---|---|---|
| 41 | QB5-to-QB12 spread | "less than one and a half" a game | 1.76 |
| 41 | Mayfield behind Allen | 3.9 | 3.8 |
| 42 | LaPorta / Pitts blended projections | 194.0 / 191.3 | 194.7 / 191.2 |
| 45 | QB12 baseline, QB marginal points, QB cost per point | 291.4 / 287.9 / $0.59 | 291.3 / 292.3 / $0.58 |
| 45 | RB / WR / TE marginal points | 1,519.4 / 1,813.3 / 226.9 | 1,521.6 / 1,815.7 / 226.7 |
| 45 | McLaurin above the WR36 baseline | 23.8 | 23.6 |
| 47 | Kelce at 58 catches | TE15 | TE16 |
| 48 | running back disagreement total | $116 | $120 |
| 49 | Tank Dell, Higgins yards, Collins blended yards | WR86 / 635.7 / 1,173.9 | WR87 / 631.8 / 1,168.6 |
| 50 | Flowers' Vegas receiving yards | 1,241.9 | 1,241.7 |

All corrected in place. Nothing was retired: a story whose argument still holds
and whose prices still reproduce does not come down over a tenth of a point.

**Every one of these was exact at publication.** Row 45 is the clearest case —
more than twenty computed aggregates, and all of them reproduced on the board
its method line names. These are not errors. They are a snapshot ageing.

### Two rules that came out of it

**A story is a snapshot; the cheat sheet is live.** Where the two can disagree,
the copy must say which board it means. Rows 48, 49 and 51 now name their
refresh and state the current value beside it. Rows that assert a bare present
tense get updated to current instead.

**Never write a bare "today."** Rows 48 and 49 both said "today" and "this
morning" about the previous day's refresh, which reads as though the reader's
sheet had just moved when it had not. Every row sits in "Recent insights" for
days and nobody comes back to date it. The prompt now bans `today, today's,
this morning, tonight, yesterday, tomorrow, right now, as of now` in title,
dek, body and table headers, and its own worked example was changed — the old
one said "today's 7:00 AM ET odds refresh" and was teaching the defect.

### Definitions matter more than arithmetic here

Two figures looked wrong and were not, both because a checker guessed the
definition rather than reading it:

- Row 48's receiver disagreement is **$66 over the committed top 24**, which is
  what its left column names. Summing over the union of both boards' top 24
  gives $68. The story is right; the union is the wrong question.
- Row 45's "upgrade" is a player priced above the positional baseline, costed
  **against that baseline** — not the step from one rank to the next. Under the
  step reading Bowers costs $0.30 a point and thirty-nine non-tight-ends beat
  him. Under the story's own reading he costs $0.84 and exactly two do, which
  is what it says.

Work out which definition the copy used before calling a number wrong. Both of
these were nearly reported as defects.

### The harness has to read the worker, not remember it

`scratchpad/recheck-all.mjs` was run first and reported all five older rows
failing on every figure. It was wrong: its claims table was hand-copied from
the stories **before** the PR #105 reprice, so it was comparing pre-reprice
claims against a post-reprice board. Same failure mode as the curve that
`live-board.mjs` was written to fix, one level up — the constants were lifted
correctly, and then the *claims* went stale instead.

Rebuild claims from the live `dek` and `body_html` each time. A verification
table that is not regenerated is a second thing to keep in sync, and it will
lose sync exactly when it matters.

The harness itself is now in the repo rather than a scratch directory:
`tools/live-board.mjs` lifts `PROJECTIONS`, `COLUMN_SCORING`, `COLUMN_CURVE`,
`COLUMN_CURVE_BUDGET`, `COLUMN_LEAGUE_BUDGET`, `COLUMN_MIN_BID` and
`VEGAS_WEIGHT` straight out of `_worker.js` at run time, so it cannot disagree
with what the site serves. `board(path)` gives the blended board,
`board(null, false)` the committed one. That pair is what every claim in this
section was checked against.

### State at 2026-08-26 12:00Z

Live and verified: **51** (playcaller, Kyle Pitts). Verified, retired: 41, 42,
43, 45, 47, 48, 49, 50. Rows 1-40, 44, 46 down permanently. Curve unchanged
since `0d3677d`. `lead_story_audit` still shows exactly two flag transitions,
both from 2026-08-24, both accounted for.

The heartbeat has now recorded three complete runs and no failures: 898s
(injury, row 49), 714s (analyst, row 50), 1,479s (playcaller, row 51). The
playcaller run's `board` note is what the instrumentation was for — it names
the overlay it matched (1787655628685), the match rate (312 of 407) and the
Chuba Hubbard self-test result, so the board it used is recoverable after the
fact rather than inferred.

**The live Routine prompt has NOT been updated with the dated-time rule.** The
repo copy here has it; `trig_011LYewcPUQikF8izFsN2LAr` still runs the previous
text. Pushing it means resending all 44,360 characters through
`update_trigger`, and a transcription slip in a brief that publishes to the
front page with no human in the loop is a worse outcome than one more story
saying "today". Push it from a session that can hold the file, then diff the
Routine's stored prompt back against `tools/lead-story-routine-prompt.md` below
the `<!-- PROMPT BEGINS -->` marker; the two are identical apart from that
marker and the header above it.

### The heartbeat's first catch: 2026-08-26 12:58Z

The 12:58Z slot produced no story. Unlike the five silent failures of 08-24 and
08-25, this one left evidence:

    run_key                   desk      stage   secs
    165532-1787749542000      (unset)   start   0

The row was claimed at 13:05:53Z — about eight minutes after the Routine fired,
which is session startup — and `updated_at` never moved again. At 13:44Z it had
been sitting at `start` for 38.75 minutes. No `lead_story` row was written;
`max(id)` is still 51.

**That narrows the fault to one window.** `board` means "built the blended board
and passed the blend self-test", and the healthy 06:58Z run reached it in 227
seconds. So the run died somewhere between claiming its row and finishing the
board — before research, before drafting, before any of the publishing rules.
Every prompt fix attempted before the heartbeat existed was written for the
back half of the brief, which is why none of them helped: the runs were never
getting there. That is now a measurement rather than a guess.

**The heaviest thing in that window is the projections fetch.** The prompt has
runs pull the ~625 KB `PROJECTIONS` array out of the deployed Worker with the
Cloudflare connector's `workers_get_worker_code`. In this environment a tool
result that size is diverted to a file rather than returned, and it is by some
distance the largest operation a run performs.

It is also unnecessary. `_worker.js` is in the repo, the Worker is deployed
from `main` by the git integration, and the run already reads `it-league.js`
out of the repo for the curve. `tools/live-board.mjs` (added earlier the same
day) does exactly this: lifts `PROJECTIONS`, `COLUMN_SCORING`, `COLUMN_CURVE`,
`COLUMN_CURVE_BUDGET`, `COLUMN_LEAGUE_BUDGET`, `COLUMN_MIN_BID` and
`VEGAS_WEIGHT` from the local file. That the boards agree is not an assumption:
every figure in all nine live rows was verified against it on 2026-08-26, and
those rows were written by runs that used the connector fetch.

So the candidate fix is to point the board build at `tools/live-board.mjs` and
drop the connector fetch. **This is one data point and it is a hypothesis, not
a diagnosis.** Confirm it with the next failure: if a run again stalls at
`start`, the window is the same and the fetch is the prime suspect. If one
stalls at `board` or later, this is wrong.

Do not respond to a stalled run by editing the back half of the brief. That has
been tried twice and cannot work.

**Failure rate to date: roughly six of sixteen slots.** Five of twelve across
08-24/25, plus this one. Row 51 remained live and correct throughout, so a
missed slot costs a fresh story, not an inaccurate one.

### The 18:58Z run, and why the stall hypothesis is not confirmed

The 18:58Z slot succeeded: `done` in 724 seconds, row 52, market desk. It
reached `board` normally, which means **the `workers_get_worker_code` path is
not deterministically broken** and the 12:58Z stall was intermittent. The
hypothesis in the previous section is neither confirmed nor refuted — it is
weaker as a deterministic cause and still open as an intermittent one. Do not
act on it until a stall repeats and lands in the same window.

Run 52 is the best-documented run so far. Its method line names the overlay's
`updated_at`, states the character count it parsed and that it matched
`length(payload)`, records the Chuba Hubbard self-test, lists all fourteen
figures it re-checked before insert, and says plainly that it did not attempt
`/api/board` and why. Every one of those fourteen reproduced here, as did every
derived figure: the committed Rice-London gap of 11.4 against the blended 22.9,
London at -7.9 and Rice at +3.6 across the blend, Burrow's committed QB8 and
$10, the $13 eighth-to-ninth receiver step being the widest inside any top ten,
and the first $2 rank at TE15, RB35 and WR40.

### `method` is reader-visible, and the sweep has to include it

`_worker.js` line 2826 serves `method` to the page through `leadClock`. The
2026-08-26 morning sweep for undated time words checked `title`, `dek` and
`body_html` and **missed `method` entirely**, which left two inconsistencies
that the same morning's edits had created:

- Row 48's method explained that `"Iron Tuna today" is the blended price`,
  naming a table column that had just been renamed to `"Iron Tuna, August 25"`.
- Row 49's body was updated to the August 26 overlay (631.8 receiving yards for
  Jayden Higgins) while its method still quoted the August 25 values, 635.7 and
  3.7. The two halves of one story disagreed about the same number.

Both are the same mistake: **a story's method describes its body, so editing
one without re-reading the other splits them.** After any correction, re-check
`title`, `dek`, `body_html` AND `method` together, and diff the story against
itself before moving on.

Six further methods carried a bare "today" or "this morning" and are now dated.
All ten live rows are clean across all four fields.

Row 52 arrived with seven undated time references, exactly as expected — it ran
the live Routine prompt, which still lacks the dated-time rule. They were dated
by hand before the 08-27 refresh could make them false.

### The 00:58Z run, and a gap in what "verify every figure" covers

The 00:58Z slot on 2026-08-27 succeeded: `done` in 815s, row 53, player desk.
Two clean runs in a row after the 12:58Z stall, and the overlay had not moved,
so the older rows needed no re-verification.

Row 53 verified almost completely. Every board figure reproduced — Maye QB3
$32 at 322.7, Dart QB5 $20 at 321.2, Daniels QB7 $13 at 308.5, the 1.5-point
gap, the $12 price difference, QB6 at $18 — as did every committed-versus-
blended claim: A.J. Brown's one-dollar move from WR11 $28 to WR12 $27, Terry
McLaurin not moving at all, TreVeyon Henderson's $10 to $12, the $7 cut to
Daniels. So did both cost-per-point figures ($19 buying 14.2 points at
quarterback, $13 buying 21.8 at receiver) and all three team lines from
`odds_overlay` row 2 (New England 14th at 23.7, the Giants 16th at 23.3,
Washington 17th at 23.3).

**One claim was wrong.** The story said Vegas gives Dart "7.5 rushing
touchdowns, five more scores on the ground than Maye." Maye's overlay line is
3.1. The difference is 4.4, not five. Corrected to "four more".

That is a different failure from everything logged above it. It is not drift —
it was wrong the moment it was written — and the run's own verification pass
did not catch it, because **the pass is not scoped to catch it.** The rule in
the brief says to check every board price and position rank printed against the
build. Row 53 did exactly that, and its method line lists the checks. But
"five more scores on the ground" is arithmetic on two raw overlay stats, not a
price or a rank, so nothing in the brief told the run to check it.

So the verification rule needs a third clause: **any number derived from the
overlay or the projections — a difference, a ratio, a count, a "more than" —
gets recomputed and checked, not just prices and ranks.** Added to the pending
prompt edits below.

Row 53 also arrived with two undated time references ("WR25 today", "cost right
now"), both dated by hand. It did correctly write "refreshed at 7:00 AM ET on
August 26" unprompted, which is the form the pending rule asks for.

### Pending prompt edits, in priority order

None of these are live. All three are in the repo copy only.

1. **Point the board build at `tools/live-board.mjs`** instead of the ~625 KB
   `workers_get_worker_code` fetch. Reliability, and the prime suspect for the
   12:58Z stall — though the two successes since mean it is intermittent at
   worst, and unconfirmed.
2. **Verify derived numbers, not only prices and ranks** (this section).
3. **No bare "today"** — the dated-time rule.

### 2026-08-27: the correction loop does not converge

The 11:00Z refresh on 08-27 (`odds_overlay` row 1, `updated_at` 1787828413360,
16,885 chars) moved eighteen ranks and six prices. All three runs since the
last audit succeeded — 724s (52), 815s (53), 1136s (54) — and the overlay had
not moved between them, so the only work was this refresh.

**Two figures corrected on 08-26 had to be reverted on 08-27, because the
correction was the error.** Row 41's quarterback 5-to-12 spread and Baker
Mayfield's gap behind Josh Allen:

| figure | 08-25 | 08-26 | 08-27 |
|---|---|---|---|
| QB5-to-QB12 spread, per game | 1.4941 | 1.7588 | 1.4941 |
| Mayfield behind Allen, per game | 3.8529 | 3.8471 | 3.8529 |

08-25 and 08-27 are identical to four decimal places. The 08-26 board was a
one-day excursion, and "less than one and a half points" — the original text —
was right on two of the three days. Rewriting it to "1.8" made a correct
sentence wrong.

The same shape appears elsewhere. Tank Dell went WR86, WR87, WR86 on
consecutive days; row 49 was edited twice and is now back where it started.
Row 48's running back disagreement total went $116, $120, $116. Jayden Higgins'
receiving line went 635.7, 631.8, 635.9.

**This is the finding, not the corrections.** Chasing a daily refresh with
hand-edits is not a convergent process. It is tracking noise, it costs an edit
per figure per day, it grows with the story count, and — demonstrated above —
it introduces errors of its own. Every one of these figures was exact when its
run wrote it.

### What actually needs to hold, and what does not

Across three refreshes and thirteen live rows, **no dollar figure has ever been
wrong except when a genuine rank change moved it.** That has happened four
times in three days: Javonte Williams RB17 $15 to RB16 $17, Cam Skattebo the
reverse, Jordyn Tyson WR33 $5 to WR34 $3, Michael Pittman the reverse. Those
are real and must be fixed, and `tools/board-diff.mjs` finds them in one
command.

Everything else that has needed correcting is a point total, a rank deep in the
board, or an aggregate over the whole board — quantities the market perturbs
daily and which no reader checks against anything.

So the standard should split:

- **Dollar figures and position ranks must reproduce against the current
  board.** They are what the reader compares to their cheat sheet, they are
  quantised by the curve, and they almost never move. This is Ken's actual
  requirement and it is being met.
- **Point totals, spans and derived aggregates should be stated as of a named
  board and left alone.** Every story already names its refresh in the method
  line; rows 48, 49, 51 and 54 now name it in the body too. A figure that is
  true of a dated board does not become false when the board moves.

That change belongs in the prompt, not in a nightly edit pass: have each story
carry its board date next to its point totals, and round season points to whole
numbers so a tenth of a point cannot churn them.

### Corrections applied 2026-08-27

Rows 42, 45, 49, 52, 53 and 54 corrected against the new board; row 41 reverted.
Each carries a dated `CORRECTED 2026-08-27` line in its method saying the
figures were re-derived and the run's own verification record was left as it
stood. Detail worth keeping:

- **Row 42** claimed Detroit was "the highest-scoring offense in football, first
  of all 32 teams". Baltimore is now first at 26.79 to Detroit's 26.75. Fixed
  to second, in dek and body.
- **Row 45** lost its named exception: "Jordyn Tyson, WR33, at $1.05" is now
  Michael Pittman at WR33 and $1.11, with Tyson at WR34 $3 and no longer an
  upgrade at all. The *claim* — exactly two non-tight-end upgrades cost more
  than the cheapest tight end one — survived; only the name did not.
- **Row 52** had "Javonte Williams and Kyren Williams both price at $15", which
  a real price move broke. Rewritten to $17 and $15.
- **Row 53** took the most damage: the Maye-to-Dart gap went from 1.5 points to
  6.0, and the three team lines behind "Vegas cannot tell these three offenses
  apart" moved to 13th, 16th and 19th, a 0.94-point spread. Renumbered, and the
  heading changed to "inside a point a game", which is what the data now says.
  Its recommendation is unchanged and every dollar figure still reproduces.
- **Row 54** was exact at publish on all six tight end ranks and prices, which
  this refresh left untouched. Only three cross-position spans moved.

### The stalls are slot-specific, not random: 12:58Z collides with two other Routines

The 12:58Z slot failed again on 2026-08-27 — run `165540-1787835558000` claimed
its row at 12:59:28Z and never moved off `start`. That is the second stall, and
both have been the same slot.

    slot     runs   stalls
    00:58Z     2      0
    06:58Z     2      0
    12:58Z     2      2
    18:58Z     2      0

12:58Z is also the only lead-story slot with neighbours:

    12:00Z   Iron Tuna — Play-Caller Premium daily entries   (0 12 * * *)
    12:58Z   Iron Tuna — lead story refresh                  (58 */6 * * *)
    13:00Z   Iron Tuna — The Pick (daily story)              (0 13 * * *)

The lead-story run claims its heartbeat and then, ninety seconds later, a
second Routine starts. On 08-26 it claimed at 13:05:53, five minutes *after*
The Pick had already begun. Both times it died before finishing the board.

**This displaces the `workers_get_worker_code` hypothesis.** A 625 KB fetch that
was too heavy would fail at every slot, and 00:58Z, 06:58Z and 18:58Z are six
for six. Contention with a neighbouring Routine explains the pattern the fetch
hypothesis cannot: why only this slot, and why every time.

Two data points is not proof, and the mechanism is inferred rather than observed
— there is no log showing what the dying session was doing. But the correlation
is exact and the mechanism is specific, so the next stall should be checked
against this first.

**The fix is a cron change, not a prompt change.** `update_trigger` can set
`cron_expression` without resending the 44,000-character prompt, so unlike the
four pending prompt edits this one is not blocked. Shifting the lead story an
hour, to `58 1,7,13,19 * * *`, puts the slots at 01:58, 07:58, 13:58 and 19:58,
none of them within half an hour before another Routine's start. Avoid
`58 2,8,14,20` (14:58 lands two minutes before the camp desk at 15:00) and
`58 5,11,17,23` (11:58 lands two minutes before Play-Caller Premium).

**Not applied.** The schedule is Ken's configuration and a missed slot costs a
story, not an inaccuracy, so this is recommended rather than done. If it stalls
a third time at 12:58Z the case is strong enough to raise again.

### Row 55, and a field the sweep had not covered

The 18:58Z run published row 55 (analyst desk, Derrick Henry) in 1041s and it
verified completely: all four rank moves against both boards (Henry RB13 to RB8,
Cook RB12 to RB14, Chase Brown RB14 to RB12, Hall RB8 to RB11), the $11 cut to
Cook, Henry's league-leading 1,569.3 rushing yards and second-place 13.4 rushing
touchdowns behind Gibbs, the 101.9-yard gap worth about 10 points, the
five-touchdown split worth 30, and all four round bands the analyst tiers are
translated into.

It also carried five undated time references, one of them inside `calls` —
**the analyst desk's JSON column, which no previous sweep had checked.** `calls`
renders on the standing column at /analyst-desk, so it needs the same treatment
as `title`, `dek`, `body_html` and `method`. Edited with `replace()` and
re-checked with `json_valid(calls)` afterwards; rows 42, 50 and 55 are the only
ones carrying it and all three still parse.

Sweep all five fields. The count of places a story states something has gone up
twice now — `method` on 08-26, `calls` on 08-27 — both times because the sweep
was written from what the last defect touched rather than from the schema.

### 2026-08-28: the slot-collision hypothesis is refuted

The 06:58Z slot stalled — run `165546-1787900354000`, claimed at 06:59:23Z,
never moved off `start`. That is a slot with no neighbouring Routine, which is
the test the previous section set in advance, and it fails.

    slot     runs   stalls
    00:58Z     3      0
    06:58Z     3      1
    12:58Z     2      2
    18:58Z     2      0

Three stalls in ten runs. 12:58Z is still 2 for 2 and the other slots are 1 in
8, so the skew may be real, but **contention with a 13:00Z Routine cannot
explain a 06:59Z failure.** The mechanism is wrong even if the correlation
survives. The cron change is no longer recommended on this evidence; it would
have moved the schedule for nothing.

Two hypotheses have now been raised and knocked down — the 625 KB
`workers_get_worker_code` fetch (killed by three clean slots on 08-27) and slot
collision (killed here). What survives is only what the heartbeat measures
directly: **runs die between claiming their row and finishing the board, at a
rate of roughly one in three, at any slot.** Anything beyond that is inference,
and inference has now been wrong twice.

Do not raise a third mechanism without evidence that distinguishes it. The
useful next step is not a better guess, it is a finer-grained heartbeat: a stage
between `start` and `board` written immediately after the projections are
parsed. That splits the failing window in two and is a prompt edit, not a
diagnosis.

### The Maye and Burrow swap: this is the class that must be fixed

The 08-28 refresh moved eight ranks and four prices. Two of them mattered:

    Drake Maye   QB3 $32  ->  QB4 $27
    Joe Burrow   QB4 $27  ->  QB3 $32

Five rows named one or both, and unlike a drifting decimal these are prices a
reader checks. Fixed in 41 (table row), 45, 48 and 52; row 53 was taken down.

**Row 45 lost a claim, not a decimal.** "Only two non-tight-end upgrades cost
more than the cheapest tight end one" is now one: Maye's cost above the
quarterback baseline fell from $27 to $22, taking him from $0.86 a point to
$0.70 and out of the exception list. Michael Pittman is the only one left. The
"everything else comes in under $0.72" line went with it — the dearest is now
Joe Burrow at $0.83 — and is restated against the tight end minimum instead.

**Row 52's call landed.** It had said to buy Maye like the 4th quarterback and
Burrow like the 3rd. The market has since done exactly that. The table now
states the current prices and says so, which is reporting the board rather than
re-arguing it.

**Row 48 understated a move it was built on.** Burrow's rise is now QB8 to QB3
and $10 to $32, worth $22 rather than $17, and he displaces Jalen Hurts as the
position's biggest single swing.

And the discipline from 08-27 held: the marginal-points column in row 45 moved
again (287.8 to 287.4, 1,521.5 to 1,520, 226.0 to 225.2) and was **left alone**.
Those are the figures that oscillate. Chasing them is what produced the reverted
edit.

### Row 53 retired

The swap put a wrong dollar figure in a headline: "Pass on Drake Maye at $32 ...
and keep the $12", for a quarterback the reader's sheet now prices at $27. That
is the originating complaint, on the most prominent text a story has.

Repairing it meant rewriting the headline, the dek and the central comparison —
authoring, not correcting — and the entry had already needed its thesis gap
(1.5 points to 6.0) and all three of its team lines re-derived the day before.
Two consecutive days of structural repair on the same row is the signal to stop
repairing it. `verified` and `published` both set to 0, with the reason recorded
in its method.

This is the first row retired for drift rather than for a defect present at
publication, and it sets the line: **a story comes down when correcting it would
mean rewriting its argument, and stays up when the argument holds and only
figures have moved.**

### 2026-08-29: a modelling error, not drift — the vacated-slot off-by-one

The 11:00Z refresh moved six ranks and **no prices**. The audit's real find was
in row 59, the live lead, and it was wrong when published.

Row 59 caps Ashton Jeanty on the theory that a missed game costs him rank. Its
method states the model exactly, which is what made the error findable:

> 288.11 x 16/17 = 271.16 points, which slots ninth among running backs and
> prices at $42; 288.11 x 15/17 = 254.21, which slots sixteenth and prices at $17.

The points are right. The slots are not. The run compared 271.16 against the
board **as it stands with Jeanty still at RB6** — where it lands just above Josh
Jacobs at RB9 — and forgot that removing Jeanty from RB6 shifts every back below
him up one. He actually lands above Jacobs at **RB8, $43**. Same error at two
games: **RB15, $20**, not RB16 and $17.

That put a wrong dollar figure in the headline ("Cap Ashton Jeanty at $42") and
inverted a comparison in the body ("Omarion Hampton costs $20, which is more
than Jeanty is worth if he misses two" — they are level). Corrected throughout,
including the rhetorical hook, which had rested on $42 being "exactly what Josh
Jacobs costs"; at $43 that is Derrick Henry. The method now carries both the
corrected slots and a note explaining the original mistake.

**This is a general trap, not a one-off.** Any story that reprices a player by
changing his projection has to re-rank the position with him removed from his
old slot, not read the adjusted score against the standing list. Row 47's catch
sensitivities got this right by rebuilding the whole ladder; row 59 did not.
Added to the pending prompt edits.

### Row 54's market-only ordering was wrong at publication too

Row 54 lists the six tight ends in odds-only order as "Mark Andrews, George
Kittle, Kraft, Travis Kelce, Goedert, then Harold Fannin Jr." Its own method
says the model keeps each player's committed reception count. Under that model
the order is **Kittle, Andrews, Kelce, Kraft, Goedert, Fannin** — the first two
and the middle two are both transposed. The order is stable across the 08-27,
08-28 and 08-29 boards, so this is not drift.

The claim the section rests on does survive: Kraft and Kelce, the two cheapest,
both finish ahead of Goedert and Fannin, the two the sheet charges $10 for. Only
the printed sequence was wrong. Corrected.

Worth noting how it was caught: computing the ordering two ways — with and
without receptions — and finding that *neither* matched, which forced a read of
the method to learn which model the run had declared. A single-model check would
have produced a confident wrong answer either way.

### Stalls: three slots now, and the rate is holding

The 00:58Z slot stalled on 08-29 — the third distinct slot to do so.

    slot     runs   stalls
    00:58Z     4      1
    06:58Z     4      1
    12:58Z     3      2
    18:58Z     3      0

Four stalls in fourteen runs, 29%, and no longer concentrated anywhere. All four
sit at `start` with `updated_at` never moving. Nothing new has been learned since
the mechanism guesses were withdrawn, and nothing should be guessed now. The
finer-grained heartbeat is the only next step that would add information.

### Corrections applied 2026-08-29

Rows 45, 54, 57, 58 and 59, each with a dated `CORRECTED 2026-08-29` line.
Goedert and Fannin swapping TE9/TE10 was the only rank move any entry named;
both prices stayed $10, so no dollar figure moved on the refresh itself. Row 57
verified clean on every one of its figures — the four points-per-dollar rates,
the 117-point trade, $107 against $23, and "ten of the top twelve quarterbacks"
— and Saquon Barkley's 0.8-point drift was left alone under the noise rule.

### 2026-08-30: the prompt edits are live

Pushed to `trig_011LYewcPUQikF8izFsN2LAr` at 02:46Z, four hours before the
06:58Z run. The stored prompt is **byte-identical to
`tools/lead-story-routine-prompt.md` below the `<!-- PROMPT BEGINS -->` marker**,
46,923 characters, verified twice: once against the write's own echo and once
against an independent `list_triggers` read. `cron_expression`, `enabled` and
`next_run_at` are unchanged.

Six edits, in the order they matter:

1. **Re-rank with the player removed from his old slot** when repricing on a
   changed projection. Sits in the board-building section, next to the worked
   example, because that is where a run is when it needs it.
2. **The verification pass covers derived numbers**, not only prices and ranks —
   differences, ratios, counts, spans, "more than" claims.
3. **A `parsed` heartbeat stage** between `start` and `board`, written the moment
   the projections and the odds payload are both in hand. Every stall so far has
   been in that window; this splits it.
4. **Name the board beside any point total.** Prices are quantised and hold;
   point totals move every refresh, forever.
5. **No bare "today"** (already live since 2026-08-26, unchanged here).
6. **`tools/live-board.mjs` as a documented fallback** if the connector fetch
   fails — explicitly *not* the primary, because the checkout can sit behind
   what is deployed.

**Two of these were downgraded from what was originally proposed, and the reason
matters.** Edit 6 was going to replace the 625 KB connector fetch outright, on
the theory that the fetch was killing runs. That theory was refuted on 08-27, so
replacing the authoritative source with a checkout that can lag would have traded
a real property for nothing. It went in as a fallback instead. Edit 4 was going
to require season points rounded to whole numbers; that would have broken row
45's cost-per-point analysis, which needs tenths, so only the name-the-board half
shipped.

**A drafting error was caught by reading the assembled prompt back before
pushing, not by the diff.** The first pass inserted the two new verification
paragraphs in the middle of an existing sentence pair, orphaning "If one does not
match, your pricing is wrong" three paragraphs from what it referred to. The
character count and the hunk count both looked fine. Only reading it in sequence
showed it. Re-read the passages you edit, in full, in order.

### PR #107 merged 2026-08-30

Merged at Ken's instruction as `e792090`. Both checks were green on the head
commit (`checks`, `Workers Builds: iron-tuna`) and `mergeable_state` was clean.

`lead_story_run` had been live on D1 since 2026-08-25 and the prompt section
had been running on the Routine since then, so the merge changed nothing about
how the desk behaves. What it did was put the repo's record back in step with
production, which had been the whole reason it was outstanding.

**The prompt copy #107 landed is already superseded.** It carries the original
six-stage heartbeat; the live Routine and this branch carry the seven-stage
version with `parsed`, plus the five other edits pushed on 2026-08-30. Merging
this branch resolves that, and it resolves in this branch's favour because it
already carried #107's commit as an ancestor.

**Checked while merging, because main had moved further than expected.** Main had
taken PR #110 and PR #108 and five camp-watch commits since this branch last
saw it. PR #110's title — "cheat-sheet-dollar-check" — reads like a pricing
change and would have meant repricing every published row. It is not: it touches
one line of `auction-watch.html`. Verified properly rather than by title:

- Every pricing constant (`COLUMN_CURVE`, `COLUMN_CURVE_BUDGET`,
  `COLUMN_LEAGUE_BUDGET`, `COLUMN_MIN_BID`, `VEGAS_WEIGHT`) is unchanged.
- `it-league.js` is byte-identical between main and this branch.
- The `PROJECTIONS` block hashes the same on both (`a8e4a3593b44`).
- `_worker.js` differs by exactly the +41 lines of PR #108's admin analytics.

So the harness has been reading the right board throughout, and no republished
figure moved. Confirmed after the merge by rebuilding the board and re-checking
the live lead's figures: Jeanty RB6 $52, Jacobs RB9 $42, Henry RB8 $43, Hampton
RB15 $20, Washington RB67 $2, Bowers TE1 $60 — all unchanged.

A branch that has fallen behind main is a stale-board risk, not just a merge
conflict risk. `tools/live-board.mjs` reads the checked-out `_worker.js`, so an
out-of-date checkout means an out-of-date board and a verification pass that
confidently agrees with the wrong numbers. Check `PROJECTIONS` and the curve
constants against main whenever the branch has drifted.

### 2026-08-30: the analyst column was emptied by something that is not this session

At **03:00:21Z on 2026-08-30**, in a single operation, `verified` was set from 1
to 0 on rows **42, 50, 55 and 60** — every analyst-desk row that still had it.
The audit trigger caught all four at the same timestamp:

    42  2026-08-30 03:00:21  ver 1->0  pub 0->0
    50  2026-08-30 03:00:21  ver 1->0  pub 0->0
    55  2026-08-30 03:00:21  ver 1->0  pub 0->0
    60  2026-08-30 03:00:21  ver 1->0  pub 0->0

**`/analyst-desk` now renders nothing.** `_worker.js:2488` selects
`WHERE verified = 1 AND category = 'analyst' AND slug IS NOT NULL`, and that
count is now zero of nine analyst rows.

**It was not this session and it was not a lead-story run.** At 03:00Z this
session was pushing git branches, between the #111 merge and the branch restart;
its last D1 write before then was during the 08-29 audit. The lead-story Routine
fires at :58 past 00/06/12/18, and its 00:58Z run finished at 01:21:56. No other
Routine is scheduled near 03:00Z.

**Not reversed, deliberately.** The standing rule is that `verified` is each
run's own assertion and restoring flags in bulk manufactures claims nobody made
— which is exactly what a bulk 0→1 here would do. It is also the safe direction:
this is a takedown, so nothing inaccurate reached a reader. The recurring
incident this database has a history of was the opposite, unauthorised 0→1
restores putting retired rows back on the site.

Worth noting the tamper query in every check-in since 08-24 would **not** have
flagged this. Its predicate is
`(old_verified=0 AND new_verified=1) OR (old_published=0 AND new_published=1)` —
built to catch restores, because restores were the problem. A mass takedown
matches neither clause. It surfaced only because the verified-row list was
compared against the previous check-in's and three ids had vanished.

**Add a second predicate.** Alongside the restore check, count verified rows per
category and compare with the previous run: a whole desk going to zero is worth
a sentence either way, whoever did it.

Rows 42, 50 and 55 were each verified accurate against the served board on the
day they were checked, so if this was not deliberate the content is sound and
they can be restored individually. Row 60 was published normally on 08-29 and
retired by slug when 61 replaced it; it was **not** held by the verification
gate, contrary to a first reading of its flags.

### The first run on the new prompt stalled, and what that does and does not show

The 06:58Z run on 08-30 — the first to use the seven-stage prompt — stalled at
`start` and never wrote `parsed` (run_key `165562-1788073128000`, 42 minutes
idle at the check, no story row).

That is *consistent with* dying before the projections and the odds payload are
both in hand, which would put the failure in the reads rather than in
blend/score/self-test. **It does not establish it.** No run has yet reached
`board` on the new prompt, so "died before parsing" and "the `parsed` update is
not being written at all" are still indistinguishable. The next run that reaches
`board` settles it in one observation: if it writes `parsed` on the way, the
stage works and the stall means what it looks like.

Stall record: 12:58Z 08-26, 12:58Z 08-27, 06:58Z 08-28, 00:58Z 08-29, 06:58Z
08-30 — five in seventeen, four different slots.

## 37. August 30: the quarterback swap, and the first price defect the new prompt would have caught

The 11:00Z refresh on 2026-08-30 moved 175 of 312 players, and exactly two of
them changed rank or price:

```
Jayden Daniels    QB7 $13  ->  QB8 $10   PRICE
Patrick Mahomes   QB8 $10  ->  QB7 $13   PRICE
```

An adjacent swap on a margin of **0.1 season points** — 308.3 against 308.2.
Daniels lost 8.4 points of blended projection, the largest single move in the
refresh, and that was enough to drop him one slot. `board-diff` found it in one
command, as it has every time.

This is the fifth genuine price move in eight days, and it is worth being precise
about what that means: **no dollar figure on this site has ever been wrong except
when a real rank change moved it.** The originating bug — a story quoting a price
the cheat sheet contradicts — is not recurring on its own. It recurs only as the
downstream consequence of the board moving under published copy, which is exactly
what the daily sweep exists to catch.

### Six rows named one of the two, and they did not all need the same treatment

The sweep across all five fields (`title`, `dek`, `body_html`, `method`, `calls`)
found six verified rows naming Mahomes or Daniels. They split three ways, and the
split is the useful part of this record:

**Corrected in place (41, 47, 52).** Row 41's thesis is "quarterback is flat in
the middle, wait" — just as true at $13 as at $10. Ten substitutions: the title,
the dek, the rank and price in prose, the two table rows swapped, `$37` savings
to `$34`, and the recommendation line. Two derived figures that no longer
reproduced were fixed in the same pass: Lamar Jackson trails Allen by 1.6 points
a game, not 1.5, and beats Mahomes by 1.8, not 1.9. Row 47 needed one clause —
the blend moves Mahomes six dollars and three spots now, not three dollars and
two spots; the other three players in that paragraph still reproduce exactly.

Row 52 is the interesting one. It **predicted this swap**: its max-bid column
said "do not pay more than $10" for Daniels and "bid up to $13" for Mahomes, and
the board has now done precisely that. It also already carried the right device —
"the board has since moved him here" — from when the August 28 refresh swapped
Maye and Burrow. So the fix was to reuse the row's own annotation on the two QB
rows and extend the sentence that follows. Its consensus-sheet column still shows
the August 27 sheet, which the row states in its own text.

**Retired (57).** Row 57 made row 41's argument with far more arithmetic hanging
off Mahomes's price: `$84` saved, `$23` spent, `$175` left, `$29` a spot, "clears
by `$81`" — a dozen derived figures. Two things made it unfixable rather than
merely tedious. Its headline instruction was "spend the $37 on Saquon Barkley",
and Barkley costs $37; at a $34 gap that sentence stops being true no matter how
it is reworded. And its load-bearing paragraph is a narrative about a *specific
past refresh* — "that refresh moved ten of the top twelve quarterbacks" — so
re-dating the story to August 30, where the refresh moved two, would falsify it,
while leaving it dated August 28 leaves a headline price the cheat sheet
contradicts. **That is the definition of the retire case**: correcting it would
mean rewriting the argument. Retiring it also leaves row 41 carrying the same
thesis accurately, rather than two rows saying it and one of them wrong.

**Left alone (43, 45).** Row 43's method quotes "Mahomes 308.3 points, QB8, $8"
inside an explicit claim about *figures this site published from earlier
refreshes* — a provenance record, not a current price, and editing it would
falsify the record. Row 45 mentions Mahomes with no number attached. The
temptation to sweep these too is the failure mode that caused the 08-26 → 08-27
revert loop: **a name is not a defect. A stale number is.**

### Two rules from the prompt did real work here, in opposite directions

The board-naming rule justified *leaving* dated figures alone — rows 45 and 52
both survive because they say which board they came from. The derived-numbers
rule justified *changing* figures nobody complained about: 1.5 → 1.6 and 1.9 →
1.8 in row 41 were never reported by anyone and would not have been found by
checking prices alone.

The 06:58Z run on 08-30 still stands as the only run on the new prompt, and it
stalled at `start`. **Open question 1 is unchanged**: no run has yet reached
`board`, so whether `parsed` is ever written remains undetermined. The next run
to reach `board` settles it in one observation.

**Open question 2 is also unchanged.** The analyst column is still zero of nine;
the 03:00:21Z mass takedown of rows 42, 50, 55 and 60 has not been touched, and
the audit table shows no `0 -> 1` restore by anyone. Not reversed, and not to be
reversed without Ken.

State at the end of this pass: live and verified **62** (unaffected — it names no
quarterback that moved); `published_rows=1`; Recent insights **14** rows, down one
from the retirement; /analyst-desk **0**; overlay `1788087628630`, 16,901 bytes,
reconstructed and checked byte-for-byte against `length(payload)` with all 312
per-player sums matched against the database's own computation before any copy
was read.

## 38. August 30: the live prompt was replaced by something outside this session

At **`2026-08-30T03:04:45Z`** the prompt on Routine `trig_011LYewcPUQikF8izFsN2LAr`
was overwritten. This session pushed the seven-edit prompt at about 02:47Z and
verified it byte-identical against the repo copy twice. Seventeen minutes later
the live prompt became a different document: **36,970 characters against this
repo's 46,923**, with all six accuracy edits gone.

This was found by comparing the live prompt to `tools/lead-story-routine-prompt.md`
during a check-in that was looking at something else entirely. **No alarm fired.**
The tamper predicates watch `lead_story` flags; nothing watches the Routine.

### What the replacement actually does

It is not vandalism. It is a coherent, well-argued revision by someone who knows
the project, and it fixes two real bugs this HANDOFF documents:

- **It retires the analyst desk.** `DESKS` is now the six
  `[player, playcaller, vegas, preseason, injury, market]`. The analyst section is
  gone, and `calls` is described as a column "from the retired analyst desk; leave
  it NULL". The stated reason is the one §36 ran into: the analysts' boards are
  behind the egress proxy and their paid ranking sets are not ours to republish.
- **It fixes the desk-rotation bug that retirement would have caused.** With seven
  desks and a six-hour cron, `slot` advances by two and `slot % 7` still reaches
  every desk, because 2 and 7 are coprime. Drop to six desks and `slot % 6` steps
  0, 2, 4, 0, 2, 4 — `playcaller`, `preseason` and `market` would never be written
  again. The replacement introduces `deskSlot = floor(epoch / 21600)` and takes the
  desk off that. The reasoning is correct.
- **It adds "Retire `published` and nothing else. Never put `verified` in that
  statement."** — which is exactly the failure of 2026-08-23 and 08-24.

### This answers both standing open questions

**OPEN QUESTION 1 is closed, and the answer is that the question was malformed.**
`parsed` is never written because **the live prompt has no `parsed` stage** — the
edit that added it is not deployed. The 06:58Z stall on 08-30 therefore says
nothing new, and five days of "does `parsed` get written" was measuring a stage
that does not exist. The lesson is narrow and worth keeping: *before diagnosing a
Routine from its telemetry, confirm the telemetry you are reading for is actually
in the prompt the Routine is running.*

**OPEN QUESTION 2 is closed.** The analyst column was emptied at `03:00:21Z` and
the prompt was rewritten at `03:04:45Z` — four minutes apart. They are one
operation: the desk was retired, and its nine rows came down with it. This was a
deliberate product decision, not tampering. **Not restoring rows 42, 50, 55 and 60
was the right call, and they should stay down** — the desk that produced them no
longer exists.

### What was done about it, and what deliberately was not

**Nothing was deployed.** Overwriting the live prompt would clobber someone's
considered work, and it is the outward-facing, hard-to-reverse action that needs
Ken's word first. Instead:

- `tools/lead-story-routine-prompt.live-2026-08-30.md` — what is actually live.
- `tools/lead-story-routine-prompt.merged.md` — the replacement's base with the six
  accuracy edits re-applied on top. Verified both directions: the base's four
  decisions (six desks, `deskSlot`, retire-`published`-only, analyst retired) all
  survive, and all six edits are present.
- `tools/lead-story-routine-prompt.md` now carries a banner saying it no longer
  mirrors the Routine, because a canonical copy that silently disagrees with live
  is worse than no copy at all.

Building the merge surfaced a real defect that a one-line port would have shipped.
The `today` ban is not one paragraph, it is **four**: the ban itself, a reworded
"BE CURRENT" lead-in, a dated example under "Clock times are Eastern", and a note
that `leadClock` cannot put a date on a bare "today". Porting only the ban would
have left the prompt instructing the run to write `"today's 7:00 AM ET odds
refresh"` as the *correct* form two sections below the rule forbidding it. Reading
the assembled text back in order is what caught it — the same check that caught
the orphaned sentence when these edits were first drafted.

### The gap this leaves

Six accuracy edits are **not live**, including the two aimed straight at the bug
Ken has reported four times: vacated-slot re-ranking, and recomputing derived
numbers. Every lead story written since 03:04:45Z has run without them. Two runs
have fired since: 06:58Z stalled at `start`, and 12:58Z fired at 12:58:58Z
(session `cse_01M5dQVbEuFtjknBgoHqivas`) and was still `PENDING` with no heartbeat
row at all 32 minutes later — a new failure shape, since every previous stall at
least wrote `start`.

**Add the Routine itself to the daily sweep.** Diffing the live prompt against the
repo copy is one comparison and would have caught this in ten hours instead of
never.

## 39. August 30: the merge is live, and the mystery was Ken

Ken answered both questions in §38 directly: **deploy the merge, and the
03:04:45Z change was his own.** That closes the investigation. There is no third
party with write access to the Routines, nothing to chase, and the analyst-desk
retirement is his product decision — which is why the four rows that came down
with it stay down.

`tools/lead-story-routine-prompt.merged.md` was deployed to
`trig_011LYewcPUQikF8izFsN2LAr` at **2026-08-30T16:54:17Z** and verified
byte-identical against the repo: **40,550 characters, sha256 `f4a3fc0420d4…`,
diff empty**. Cron unchanged at `58 */6 * * *`, enabled, next run 18:58Z. The
canonical file is canonical again — the body below its marker round-trips to the
deployed text exactly, and the "no longer mirrors" banner is gone. The
pre-merge revision is kept as `lead-story-routine-prompt.live-2026-08-30.md`
purely as history.

So the live prompt now carries **both** sets of decisions:

- Ken's: six desks, `deskSlot` off the six-hour grid, `calls` left NULL, and
  "retire `published` and nothing else, never `verified`".
- The six accuracy edits: vacated-slot re-ranking, derived-number checking,
  board-naming beside point totals, the dated-currency rule in all four of its
  places, the `parsed` heartbeat stage, and `tools/live-board.mjs` as a
  documented fallback.

### What this run should be remembered for

Two conclusions in this HANDOFF were wrong in a way worth naming, because both
came from reasoning about a system without checking what it was actually running.

**"The first run on the new prompt stalled"** (§36) was false. There was no new
prompt — it had been replaced six hours before that run fired. Five days of
`parsed` telemetry was measuring a stage that did not exist in the live document.
The rule earned here: *before diagnosing a Routine from its telemetry, diff the
prompt it is running against the one you think it is running.* That check is one
comparison and is now step 0 of the daily audit.

**"Something outside this session"** was Ken. The evidence genuinely pointed at an
external write — an unattributed change, a bulk flag update nothing this session
made, and a rewrite seventeen minutes after a verified push. But "unattributed"
is not "unauthorized", and the right move was the one taken: record it precisely,
change nothing, and ask. Reverting the analyst retirement on my own reading would
have undone a deliberate product decision and put nine rows back that their own
desk no longer supports.

The narrower lesson stands too: **nothing watched the Routine.** The tamper
predicates cover `lead_story` flags, so a total rewrite of the prompt that
generates every story was invisible for ten hours and surfaced only because a
check-in about something else happened to compare two files. Watch the thing that
writes, not only the thing it writes to.

State at the end of this session: live and verified **62**; `published_rows=1`;
Recent insights **14**; /analyst-desk **0**, which is now correct rather than a
defect. Overlay `1788087628630`, 16,901 bytes. Mahomes QB7 $13, Daniels QB8 $10.
Live prompt and repo canonical in agreement, verified byte-for-byte.

## 40. August 30: the merged prompt's first run, and a test that could not have worked

The 18:58Z run on 08-30 was the first on the merged prompt (deployed 16:54:17Z).
It published **row 63**, "Pass on Josh Jacobs at $42; bid Tucker Kraft to $12,
not $5", and every part of it checks out.

**The six-desk rotation is correct.** Started 18:59:13, epoch 1788116353,
`deskSlot = floor(1788116353 / 21600) = 82783`, `82783 % 6 = 1`, `DESKS[1] =
playcaller` — and the row was written as `playcaller`. Computed independently
here and in the run's own method line, which now shows its work. `slot` came out
165566 and matches the `run_key`.

**Every price and rank reproduces exactly** against the August 30 board — ten of
ten checked: Jacobs RB9 $42 (RB11 $35 committed), Kraft TE11 $5, Andrews TE8 $12,
Goedert TE10 $10, Fannin TE9 $10, Golden WR35 $3, Watson WR45 $2, Reed WR49 $2,
Love QB23 $2, Brooks RB59 $2. MarShawn Lloyd is correctly absent from the board
and the story says so instead of inventing a price for him. "Not one Green Bay
receiver costs more than $3" holds — Golden at $3 is the most expensive. The
method's stated sample, 64 QB / 93 RB / 124 WR / 64 TE, matches the build exactly.

**All three new rules are visibly in force.** The board is named beside every
point total ("179.22 points on the August 30 board", "262.39 points on the same
board"), the bid table's header column is literally "Iron Tuna, August 30", there
are zero occurrences of today/this morning/tonight and zero of "UTC", and the
method carries a DERIVED FIGURES CHECKED section recomputing the gaps it prints.
Ken's retire rule held too: the run's note records that retire-by-slug "touched
published only and changed 62 rows; verified untouched".

### The `parsed` test was malformed, and no run could ever have passed it

`lead_story_run` holds **one row per run, updated in place**. `stage` therefore
carries only the *last* stage reached. A run that finishes ends at `done` no
matter which stages it passed through, so a successful run can never demonstrate
that `parsed` was written. The check-in that asked "did it reach `board` with
`parsed` on the way?" was asking for something the schema cannot show.

This does not mean the stage is useless — it means the stage is only ever
observable in the situation it was built for. **`parsed` will be seen only on a
run that dies between parsing and the board.** If the next stall shows `parsed`
instead of `start`, the failure is in blend/score/self-test; if it still shows
`start`, the failure is in the reads. Either way the question is settled by the
next stall, not by the next success.

That is the second time in one day a conclusion here rested on a check that could
not have produced the answer — the first being five days of `parsed` telemetry
against a prompt that had no `parsed` stage. Same failure both times: *confirm
the observation is capable of distinguishing the cases before drawing anything
from it.*

State: live and verified **63**; `published_rows=1`; Recent insights **15**;
/analyst-desk 0. Overlay unchanged at `1788087628630`, 16,901 bytes. Live prompt
still byte-identical to the repo canonical.

## 41. August 31: a projection re-baseline, and what it did to the archive

On 2026-08-30 the committed projection set was replaced with an owner-supplied
423-player file (PR #112) and deployed. This is a different event from a daily
odds refresh and it needs its own name in this file, because everything the
daily audit was built to catch assumed the projections were fixed and only the
overlay moved.

**Scale.** 38 of 345 priced players changed PRICE. An odds refresh moves two.
James Cook went RB14 $22 to RB9 $42. Saquon Barkley $37 to $28. Mahomes and
Daniels swapped straight back, undoing a correction made twelve hours earlier.

**The runs were fine; the archive was not.** Row 64, written at 01:09Z on the new
set, verifies exactly against the deployed board and `/api/board` answered and
agreed. The system self-corrected the moment the projections shipped. But every
story written before the deploy was priced off a board that no longer exists, and
**11 of 15 archived rows printed a price next to a player the reader's sheet
contradicted.** That is the originating complaint, at scale, caused by the site
changing its own numbers rather than the market moving.

Ken's call was to correct all eleven in place, retiring only rows the new numbers
destroyed. Result: **nine corrected (41, 45, 47, 48, 52, 56, 58, 59, 62), two
retired (54, 63).** A precise re-scan afterwards — does any row still print a
mover's old price beside his name — comes back zero of fourteen.

### What separated the nine from the two

The rule that did the work: **a story survives if its finding survives the new
numbers, whatever happens to the figures.**

- **Row 45** was the heaviest recompute and the cleanest survivor. Its whole
  cost-per-point model had to be rebuilt — baselines, marginal dollars and points
  at four positions, the repriced tight end table — and its headline came out
  *identical*: Bowers still reprices to exactly $31 against $60. The
  position table moved (TE $0.96 a point against $0.40 at running back) and the
  finding did not.
- **Row 48** survived in its primary claim and lost a secondary one. Running back
  still shows the widest consensus-versus-odds disagreement, but "tight end is
  where nothing happened" reversed: Loveland and Warren now trade places across
  the blend. That paragraph was rewritten to what the board shows, and the
  headline was untouched.
- **Row 54 was retired because the update granted its wish.** It argued the sheet
  underpriced Tucker Kraft against Dallas Goedert. The new projections already
  put Kraft ahead — TE9 $10 committed, TE8 $12 served, Goedert TE11 $5. A story
  whose recommendation has become the board's own price has nothing left to
  recommend, and no edit fixes that.
- **Row 63 was retired for the same reason plus a dead headline.** "Bid Tucker
  Kraft to $12, not $5" is void when the board says $12. Its reporting stays
  accurate; the price argument built on it does not.

### The convergence rule now has a third data point, and it is worse

Rows 41 and 52 were corrected on 08-30 for the Mahomes/Daniels swap and corrected
back on 08-31, because the projection update reversed it. Two figures, three
passes, same two players. The standing rule said retire on a third correction;
these were corrected instead because Ken asked for correction in place, and
because the swap is now *documented inside row 52* rather than presented as a
fixed fact. That is the better answer to an oscillating figure: **say that it
oscillates.** Row 52 now reads that the two have traded places twice and that the
desk's call does not depend on which way it lands.

### Two things this changed permanently

**The daily audit now diffs the projections, not just the overlay.** Nothing was
watching the committed set, because nothing had ever changed it. `board-diff`
compares two overlays and would have reported "no change" all the way through.

**`tools/live-board.mjs` cannot read a deployed bundle.** It lifts `const NAME`;
esbuild emits `var`. Building a board from deployed code needs a scratch copy
patched to `(?:const|var|let)`. Worth fixing properly, since checking the archive
against what is actually served is now a routine operation.

### Left undone, deliberately

`tools/test-the-pick.mjs` is still red. Ken asked for the printed totals to be
updated to match, but **both Pick entries' central findings have reversed**, not
just their totals. The QB entry says the drop from QB1 to QB4 beats the drop from
QB4 to QB16: it is now 47.4 against 53.7. The TE entry says the TE2-to-TE3 gap
beats TE3-to-TE12: now 30.4 against 40.9. And Tucker Kraft, the actual Pick, is
TE9 rather than TE12. Updating the numbers alone would publish two entries that
contradict their own headlines and deks, so it was left for a decision.

State: live and verified **64**; `published_rows=1`; Recent insights **14**;
/analyst-desk 0. Live prompt 40,786 chars, sha256 `af5384664474`, matching the
repo canonical copy.

## 42. August 31: The Pick retires two entries, and the third turned out to be broken too

Ken's call on §41's open item was to retire both stale Pick entries. Done:
`pick-2026-08-21` (quarterback scarcity) and `pick-2026-08-19` (tight end tier
cliffs) are removed from `the-pick.html`, and `tools/build-seo.mjs` and
`tools/build-front.mjs` regenerated the JSON-LD and the front page's `PICKS`
array so nothing references them.

Both were retired rather than corrected for the reason recorded in §41: their
findings had *reversed*, not merely drifted. The QB entry's claim that the
QB1-to-QB4 drop beats QB4-to-QB16 is now 47.4 against 53.7. The TE entry's claim
that the TE2-to-TE3 gap beats TE3-to-TE12 is now 30.4 against 40.9.

### Removing them exposed that the survivor was wrong as well

`pick-2026-08-20` was never flagged, because `tools/test-the-pick.mjs` only
validates a table column headed **Points**, and that entry's table prints
**ranks at three scoring settings** instead. Nothing checked it. Checked by hand
against the updated projections, 16 of its 18 rank cells were wrong and so was
its headline: Derrick Henry moves **four** spots from full PPR to standard
(RB9 to RB5), not eight.

Its argument survives — a catch being worth a point still reorders the RB5-to-RB18
band, and Henry still gains while Love and Jeanty lose — so it was corrected in
place rather than retired, per the same rule §41 used on the nine archive rows.
All six rows re-derived and re-verified: catches, and full PPR / half PPR /
standard ranks, all match. Henry's prose figures now read RB9 at 273.2 and RB5 at
252.2, on 1,484 rushing yards and thirteen touchdowns.

One sentence was reworded rather than renumbered. "The top four do not move at
all" named Gibbs, McCaffrey, Robinson and Taylor as RB1 through RB4 in every
format. The four still hold the top four slots, but McCaffrey and Taylor now swap
between full PPR and standard, so the claim is stated as the set holding the top
of the board rather than each holding a fixed rank.

### The test is still red, and it should be

`tools/test-the-pick.mjs` now fails one assertion: **"at least one entry prints
checkable point totals — 0."** That is a coverage guard. It exists so the
"every printed point total matches PROJECTIONS" check can never pass vacuously,
and with the two retired entries gone the column has no Points table left to
validate — `pick-2026-08-20` prints ranks.

**It was left failing on purpose.** Relaxing it would restore a silent-pass hole
in exactly the check that guards the originating bug. Closing it honestly needs a
content decision: publish a new entry with a Points table, or add a points column
to the surviving entry. Either is Ken's call, not a test edit.

The gap it revealed is worth fixing regardless: **the column's rank claims are
checked by nothing.** A `Points` column is validated; `RB9` in a table cell is
not. That is how `pick-2026-08-20` sat wrong with a green-ish suite. Extending
the test to validate rank cells the same way it validates points would have
caught it the day the projections changed.

State: `the-pick.html` carries one entry, corrected and verified. 26 of 27 checks
pass; the one failure is the coverage guard above.

## 43. August 31: the rank cells are checked now

§42 ended with the gap that let `pick-2026-08-20` sit wrong: `test-the-pick.mjs`
validated a table column headed **Points** and nothing else, so a cell reading
`RB9` was decoration. That entry's only table is a rank table, so the entry was
unchecked end to end.

`tools/test-the-pick.mjs` now checks rank cells the same way it checks points.

**How it decides what a rank means.** A rank is meaningless until you know what a
catch is worth in it, so a column is only graded when its header says: "Full PPR"
(1.0), "Half PPR" (0.5), "Standard" or "non-PPR" (0), and a bare "Rank" as the
site's own model, full PPR since 2026-08-22. Everything else — "Max bid", "Rank
move" — is left alone, because those are arguments, not facts. A cell is graded
only when it reads exactly `RB9`; anything wordier is prose or a move ("RB8 to
RB6") and this is not the file that grades those.

Two things fall out of that. The position prefix is checked against the player's
own position, so `WR9` on a running back is caught. And the ladder is built the
way the site builds it — score, round to a tenth, *then* sort, matching
`_colScore` and `tools/live-board.mjs` — because sorting raw and sorting rounded
can disagree on a tie and the reader sees the rounded one. The scoring formula
was parameterised rather than copied, so a second copy cannot drift from the
first the next time a coefficient changes.

**The coverage guard now counts ranks.** It exists so the correctness checks
cannot pass on an empty set, and holding out specifically for a "Points" column
is what let this entry through. It fails if an entry prints no checkable number
of either kind.

### It was verified by mutation, not by going green

A check that passes without catching anything is the failure it is meant to
prevent, so it was tested against four deliberate corruptions before being
trusted: a wrong rank value (caught, naming the column), a wrong position prefix
(caught), a wrong half-PPR cell (caught), and the table deleted entirely (the
coverage guard fired). Then the pre-correction table was pasted back, and the
check independently reported **exactly the 16 stale cells §42 found by hand**,
column by column.

Full suite: **27 passed, 0 failed** — green for the first time since the
projections were replaced.

## 44. August 31: hand-correcting the archive does not converge, and now there is proof

The 11:00Z refresh on 08-31 moved **60 of 345 prices**. Yesterday's projection
re-baseline moved 38; an ordinary odds refresh moves two. This was an ordinary
refresh — the feed was checked and is healthy: 811 stat fields became 810, 58
players lost a line and 54 gained one, two were added (Michael Penix, Deebo
Samuel), and nothing was truncated. The market simply moved a long way.

**Every one of the 15 rows in Recent insights now prints at least one stale
price.** And the part that settles the argument:

> **21 of the figures corrected twelve hours earlier were already stale again.**
> Row 41's Daniels $13 → $20. Row 45's Kelce $3 → $10. Row 48's Burrow $32 → $13.
> Row 58's Collins $18 → $30.

§41 corrected nine rows by hand against the 08-31 board. Less than a day later
those same figures are wrong, in rows that were *already* on their second or
third correction of the same players. The convergence warning in this file has
been about individual figures oscillating; this is the whole archive doing it at
once, and it means hand-correction is not a maintenance strategy. It is a
treadmill that loses.

**So the archive was not corrected again.** Only the live lead was, because a
front-page headline contradicting the reader's own sheet is the originating
complaint and cannot wait for a decision.

### What was done to row 65

Row 65 is honest work: it dates its board in the prose, in the bid-table header
("Iron Tuna, August 30") and in its closing line, and every figure reproduces
against that board. The refresh moved Kyle Pitts to TE8 and **$12** — exactly
the cap the story argued for. The call came true in four hours.

Three things read as live claims rather than dated ones, and those were fixed:
the headline's "not $17", the dek's "still prices Pitts at $17", and "Bijan
Robinson is still a $72 buy at RB3" (now RB2 and $75). The story now says
plainly that the August 31 refresh moved the board onto its own number, which is
the row 52 device and the truthful framing: a column whose call the market
confirms the same morning is the column working.

### The structural options, for a decision

Hand-correction is out. The real choices:

1. **Age rows out of Recent insights.** A story stops being a live
   recommendation after a day or two and moves to a dated archive. Cheapest, and
   it matches what the copy already does by naming its board.
2. **Re-anchor archived prices from the live board at render time.** The site
   already owns this machinery — `it-league.js` re-anchors dollar figures on the
   reader's own board. Pointing it at archived rows would make prices track by
   construction instead of by maintenance.
3. **Require every dollar figure to carry its board date in the copy**, and
   accept archived stories as historical record rather than advice.

Option 2 is the one that actually fixes the originating bug, because it removes
the human step entirely. Option 1 is the cheapest thing that stops the bleeding
today.

State: live and verified **65**, corrected; `published_rows=1`; Recent insights
15; /analyst-desk 0. Overlay `1788174013112`, 16,922 bytes, reconstruction
verified six ways including sum-of-squares. Deployed `PROJECTIONS` semantically
identical to the repo across all 407 players; every pricing constant identical.
Live prompt 40,786 chars / `af5384664474`, matching the repo. CI 27 of 27.

## 45. September 1: the checker was wrong, and nothing in the suite said so

The valuation pass merged overnight (PR #116/#117) changed two things inside
`_worker.js` that `tools/live-board.mjs` **reimplements rather than lifts**, and
the harness went silently wrong the moment they deployed:

- `_colPrice` now returns `COLUMN_MIN_BID` flat past the end of the curve
  instead of scaling it. That moves **217 of 345 players from $2 to $1** on the
  served sheet.
- `boardPayload` re-levels each position's points to last season's top-K mean
  (`COLUMN_NORM` / `_colNormFactors`) before serving them. The points on a
  reader's sheet are not raw stat-line scores: Puka Nacua is 356.0 raw and
  **330.0 on the sheet**.

Every check run through the harness today would have been wrong by $1 on two
thirds of the board and wrong on every point total, and **CI was green
throughout** — the repo's own tests cover the worker and the app, not this
verification tool.

The file already warned that "a hand-copied curve is exactly how a checker goes
stale". The warning was too narrow. These were hand-copied **functions**, and
lifting the constants around them protected nothing. `COLUMN_NORM` is now lifted
like every other constant, `price()` mirrors `_colPrice`, and `board()` applies
score → normalise → round → sort, which is the worker's order.

**Verified against something the site generates itself**: `it-league.js`'s
`DEFAULT_BOARD_RAW`, built by `tools/build-default-board.mjs` through the same
pipeline. **344 of 344 rows match on points, zero mismatches**, and the harness
independently reproduces the worker's own documented example of Nacua at 330.0.
That is the check this tool never had — it had been trusted because it lifted
constants, not because anything compared its output to the site's.

### The live lead was not the row this file said it was

§44 left row 65 as the live lead. Four runs had published since (66, 67, 68,
69), so the front page was row 69 — the Eagles play-caller story. The lesson is
small and worth keeping: **re-read which row is published rather than carrying
it forward from the last check-in.** The edit made to 65 was still right, but it
was an archive edit described as a front-page one.

Row 69 dates its board correctly in the dek and in its bid-table header, so the
body is honest. One undated claim was contradicted: the headline's "cap Jalen
Hurts at $13, not $18", when the 09-01 refresh had already moved Hurts to QB7
and **$13** — the exact cap the story argued for. Barkley at $22 and Breece Hall
at $28 both still reproduce. The headline dropped the stale half; the dek now
records that the refresh moved the board onto the desk's number.

That is twice in two days that a call landed within hours of publication. It is
worth noticing that this is the column being right, not a defect — the defect is
only ever the undated half of a sentence.

Row 65's dek still said "Take Charlie Kolar at $1 ahead of the other Chargers
tight ends" at $2; the off-curve change had moved all three Chargers tight ends
to $1. Fixed.

**The archive question from §44 is still open and still unanswered**, so the
archive was again left alone. It is now worse than it was: on top of the odds
movement, 217 players changed price for a reason that has nothing to do with the
market. Option 2 — re-anchoring archived prices from the live board through
`it-league.js` — would have absorbed both changes without a single edit.

State: live and verified **69**, corrected; `published_rows=1`; Recent insights
19; /analyst-desk 0. Overlay `1788260457157`, 16,913 bytes, 314 players. Live
prompt 40,786 / `af5384664474`, matching the repo. CI 27 of 27.

## 46. September 1: The Pick never ran once, and every run said it had

Ken reported the site's stories looking "about a week old". The audit that
followed found every desk current except one: the lead story published at
07:15 this morning (row 69), the camp watch and the Play-Caller column both
landed entries on 2026-08-31, the twice-weekly drop pages are on schedule —
and **The Pick's newest entry was `pick-2026-08-20`, twelve days old, in the
band directly under the front page's hero.** After §42 retired the two stale
entries beside it, that one entry is the whole column.

### The failure

The Pick's Routine (`trig_016JAiJJMZi2jtZDmZS1QPNK`) has fired daily at 13:00
UTC since 2026-08-22 and **every run reported SUCCEEDED. Not one of them ever
added an entry.** The three entries the column launched with (08-19/20/21)
came from the launch branch; nothing has landed since. No
`claude/the-pick-*` branch exists on the remote — ten runs, zero pushes,
each one a 13-minute, ~$2 session that did real reading and then stopped.

The cause is a configuration difference visible only in the trigger configs.
The camp desk's and Play-Caller's Routines carry, in their
`session_context`:

    sources:  [{ git_repository: { url: https://github.com/krubins/iron-tuna } }]
    outcomes: [{ git_repository: { git_info: { repo: krubins/iron-tuna, branches: [claude/…] } } }]

so their fresh sessions start with the repo checked out and credentialed.
The Pick's Routine has **neither** — created via a different path
(`created_via: meta_mcp`, synthetic event) that never attached the repo. Its
fresh sessions therefore started with an empty working directory, and the
prompt's very first instruction was:

> **Stop condition.** If `the-pick.html` does not exist in the checkout, the
> column has not merged to `main` yet. Do not create it from scratch. Stop
> and report that.

An empty checkout has no `the-pick.html`. Every run obeyed, wrote its
stop-report into a transcript nobody opened, and exited SUCCEEDED — the
Routine's run status measures whether the session finished, not whether the
column published. The stop condition was written to guard the launch window
(the Routine was created hours before the column merged) and became a
permanent trapdoor the moment it was paired with a config that never has a
checkout. Two safety rails multiplied into silence: "publishing nothing is
acceptable" (true per-day, wrong as a ten-day streak) and "stop rather than
create from scratch" (right about the file, wrong about why it was absent).

### What changed today

- **The Routine's prompt was rewritten in place** (same trigger id, history
  kept). The stop condition now reads the other way: a missing checkout is
  the Routine's own known defect, never a reason to stop — clone
  `krubins/iron-tuna` and carry on; only `the-pick.html` missing from `main`
  itself still stops a run. The push step now requires the run to name the
  branch it pushed in its report and to open the report with the push error,
  verbatim, if the push failed — a stranded entry with a quiet success
  report is this column's worst known failure mode. The canonical copy of
  the live prompt is **`tools/the-pick-routine-prompt.md`**; §23 points at
  it.
- **§23's cadence section** now records the missing-source defect so the
  next reader of the spec knows the trigger config is the fragile part.

An attempt to re-create the Routine with the repo attached as a source (the
durable fix, matching the working desks) was blocked by the session's
permission classifier — trigger creation is not something a session in auto
mode may do here. **That re-creation is Ken's move, in the claude.ai
Routines UI: recreate "Iron Tuna — The Pick (daily story)" with
`krubins/iron-tuna` attached as its repo, paste the prompt from
`tools/the-pick-routine-prompt.md`, keep `0 13 * * *`, then delete the old
trigger.** Until then the rewritten prompt's clone path is the bridge, and
whether it holds depends on whether a sourceless session's git proxy will
authenticate the clone and the push — today's 13:03 UTC run is the test.

### What did not change, at first — and then did, an hour later

The branch-per-day flow (`claude/the-pick-YYYY-MM-DD`, never `main`) stood
at first, per the spec as it read that morning. That meant a pushed entry
still needed a human merge to publish, and ten days of silence also proved
nobody was watching for those branches.

Ken's call, put to him directly: make the column publish hands-off, the same
as the camp desk and Play-Caller. **The prompt was updated again at
2026-09-01T12:14Z** — same trigger, same checkout fix from the first
rewrite, only the ship step changed. It now runs `git push origin HEAD:main`
instead of pushing a dated branch, with the same "loud failure, never a
quiet stranded commit" discipline: a rejected push gets a rebase and up to
three retries, and only falls back to a `claude/the-pick-YYYY-MM-DD` branch
(reporting the push error verbatim) if `main` itself keeps refusing it.
`tools/the-pick-routine-prompt.md` and §23 both carry the new text; the file
was re-verified byte-identical to the Routine's stored prompt after the
update (9,568 chars, sha256 `30a87ea80a4b...`).

This does not touch the missing-git-source defect from the first half of
this section — that fix (clone-if-absent) is independent of where the run
pushes to, and the durable repair (attaching the repo as a source in the
Routines UI) is still Ken's move, not done here.

State: `the-pick.html` unchanged (one entry, `pick-2026-08-20`); Routine
prompt updated twice today, 2026-09-01T12:02Z then 2026-09-01T12:14Z; next
fire 13:03 UTC today will be the first to test both the clone path and the
push-to-`main` path in one run.

## 47. September 1: two Pick Routines exist now, and only one can be edited from here

§46 fixed the checkout defect and, separately, switched publishing from a
dated branch to a direct push to `main`. This section is what happened when
both fires landed on the same afternoon, plus a second Routine nobody here
created.

### The rail and Position Intel fix, and why it is not part of this section

Ken separately reported "Top Headlines", Position Intel and the Market card
all stuck on Aug 20 entries. That was a front-page allocation bug, unrelated
to The Pick or its Routine — see the `front.html` commits `dc88438` and
`38f56ac` for the fix (every section now takes its own newest content
independently, instead of competing for one shared, exclusively-claimed
pool). Mentioned here only because it landed in the same session, on the
same afternoon, and touched `front.html` the way this section's commit does
too.

### A second Pick Routine exists, created outside this session

`list_triggers` this afternoon showed two enabled Routines both named for
The Pick:

| trigger | cron | git source | prompt | last run |
|---|---|---|---|---|
| `trig_016JAiJJMZi2jtZDmZS1QPNK` ("Iron Tuna — The Pick (daily story)") | `0 13 * * *` | none (clones itself) | push-to-`main`, updated 12:14Z | fired 13:09Z, reported SUCCEEDED, added nothing to `main` |
| `trig_01K2obtrMAKiwGn3N4UroTEv` ("The Pick (Story) — Updated") | `0 12 * * *` | `krubins/iron-tuna` attached | push-to-branch (the pre-12:14Z text — copied before the last edit) | fired 12:18Z, SUCCEEDED, pushed `claude/the-pick-2026-09-01` |

`trig_01K2obtrMAKiwGn3N4UroTEv` was created at 12:10:45Z via `created_via:
http_api` — outside this session, almost certainly Ken pasting the
then-current prompt into the claude.ai Routines UI and attaching the repo as
a source, which is exactly the durable fix §46 said only that UI could do.
It is the more robust of the two now: a real git source instead of a
clone-on-every-run workaround. Its prompt is simply a slightly earlier draft
of this file's, copied before the 12:14Z edit that switched the ship step
to `main`.

**This session cannot edit or disable it.** `update_trigger` refuses both a
prompt change and `enabled=false` with the same answer: *"this routine was
created via http_api, not by an agent. Agents can only update routines they
created."* Only Ken, in the Routines UI, can change its prompt or turn it
off.

### What each run actually did

`trig_01K2obtrMAKiwGn3N4UroTEv`'s 12:18Z run cloned `main` while it still
sat at `55add36` (before PR #119 merged), wrote a real, well-grounded entry
— theme "committee backfields", Jaylen Warren vs. Rico Dowdle in Pittsburgh,
with New England's and New Orleans' own backfield splits in the same table
as further evidence — and pushed it to `claude/the-pick-2026-09-01`, per its
(older) branch-only prompt. Every
number in it was checked against current `PROJECTIONS` by hand this
afternoon and matched exactly; the Henderson/Stevenson snap-share claim
traces to `play-caller-premium.html`'s own 2026-09-01 entry, one of this
column's allowed sources. **Ported onto current `main` and pushed** (commit
`26cc9f6`), since the branch's base predated today's merges and nothing was
going to land it otherwise.

`trig_016JAiJJMZi2jtZDmZS1QPNK`'s 13:09Z run — the one with the correct
push-to-`main` prompt — reported SUCCEEDED but **`main`'s `the-pick.html`
was unchanged by it**: still the one entry it had before this session's own
push. Why is still open. The `git branch -r`/`git log --all` visibility this
run's checkout may have had into the other trigger's already-pushed branch
is one candidate (a session that lists remote branches could plausibly read
`claude/the-pick-2026-09-01`'s `pick-2026-09-01` id and conclude a same-day
entry already existed, even though the prompt's own de-dup check names only
`the-pick.html` on the checkout) but this was not confirmed — this session
had no transcript access to the run, only its `SUCCEEDED` status and
`main`'s unchanged state. Worth watching on the next fire.

### Left for Ken

1. **Two Routines firing daily for one column is a standing risk** — not
   today's collision (harmless: one produced nothing, the other's entry got
   ported by hand), but tomorrow's, where both could write competing entries
   with no way for either to see the other's branch-only or main-only work
   before publishing. Pick one:
   - Update `trig_01K2obtrMAKiwGn3N4UroTEv`'s prompt to the push-to-`main`
     text in `tools/the-pick-routine-prompt.md` (it already has the better
     git-source setup) and disable or delete
     `trig_016JAiJJMZi2jtZDmZS1QPNK`; or
   - Keep `trig_016JAiJJMZi2jtZDmZS1QPNK` and disable/delete the new one.
   Either leaves exactly one Routine publishing straight to `main`.
2. The stale branch `claude/the-pick-2026-09-01` is fully merged into `main`
   and safe to delete from the GitHub UI; this session's push credentials
   returned a 403 attempting to delete it directly.
3. If `trig_016JAiJJMZi2jtZDmZS1QPNK` is the one kept, its no-op-despite-
   success run is still unexplained and worth a closer look on the next
   fire — a run that reports SUCCEEDED without writing is exactly the
   failure mode §46 was written to close, back in a new shape.

State: `the-pick.html` carries two entries (`pick-2026-08-20`,
`pick-2026-09-01`); front page allocation fixed in the same session; two
Pick Routines active, one Ken-created and only Ken-editable.

## 48. September 2: the board never heard about the injuries

Ken reported two symptoms: Jayden Higgins still priced on the board two weeks
after his season-ending ACL tear, and Josh Jacobs still RB9 three days after the
league put him on the commissioner's exempt list. They are one bug.

**Why the rankings were stale.** A rank on this site is nothing but the
`PROJECTIONS` stat lines in `_worker.js` scored at the reader's settings, and
nothing that runs on a schedule can change a single player's line:

- The daily projections routine (§9) fetches ESPN, SportsLine and NFL.com
  projection feeds and merges them. Every one of those hosts is blocked from the
  sandbox it runs in (`espn fantasy 000`, `sleeper 000`, checked 2026-09-02), so
  the routine's fail-safe skips every day. The last change to the projection set
  was the owner-supplied 423-player file on 2026-08-30 (§41), which was itself a
  full-season line for every player including the ones already lost.
- The odds refresh (§9b) is the nflverse game-line provider, a per-TEAM scoring
  factor between 0.85 and 1.18. It scales a player's own projection; it cannot
  see that he will not play. And because the overlay is cached in D1 and blended
  at 3:1, a fix to `PROJECTIONS` alone would have had the stale overlay blending
  three quarters of the old line back in until the next 11:00Z cron.
- The client's Sleeper status (`/api/live`) shows a badge and adds 0.15 to the
  risk score. It never touches points or rank. Its fallback list `INJURIES` in
  `index.html` was three hand-written entries from July.
- The news desk knew. Auction Watch carried Higgins' ACL on 08-22 and 08-25 and
  Jacobs' exempt-list placement on 08-31 and 09-02, and the compare-post on X
  says "Iron Tuna re-prices 408 players live" over the Higgins news. Nothing
  connects a story to a row.

**What changed.** `tools/availability.json` is the list of board players who
cannot play a full season as of its `asOf` date, with a status, the games
expected missed, a note and a source per entry. `tools/apply-availability.mjs`
pro-rates each committed row to `season x (17 - gamesOut) / 17` (rounded the way
`merge-projections.mjs` rounds), captures the full-season line into the file the
first time so it can be restored, regenerates an `AVAILABILITY` block in
`_worker.js`, regenerates the client `INJURIES` fallback, and bumps
`PROJ_VERSION`. `--check` is a CI step now; `--fetch` reads ESPN's public
injury feed (reachable from here) and prints board players it lists as IR, PUP,
suspended or exempt who are not in the file, and file entries it no longer
lists.

In the worker, `oddsCacheRead` runs the overlay through `applyAvailability`
so every reader of it (the blend, the Vegas column, `/api/board`) sees the
same factor the rows carry, and `blendProjections` attaches `status`, `gamesOut`
and `note` so the client's injury column reads "IR" before Sleeper answers.
`buildInitialPlayers` in `index.html` carries that status as `injuryStatus`.

**Applied 2026-09-02, 18 players.** Out for the season (line zeroed, player kept
on the board at the bottom of his position because every generated index and
story test expects the roster fixed): Jayden Higgins, Devin Neal, Ty Chandler,
Calvin Austin III. Josh Jacobs at 6 games out: there is no timeline on the
exempt list, his first court date is Nov. 17, and six is a working number to
revisit weekly. Jordyn Tyson 8. The IR-with-designation and reserve/PUP group
at the 4-game minimum: James Conner, Adam Randall, Isiah Pacheco, Savion
Williams, Luke Musgrave, Tank Dell, Ben Sims, Grant Calcaterra, Christian Kirk,
Isaac Guerendo, Zach Charbonnet, Jeremy McNichols. On the committed default
board (no odds) Jacobs went RB16, 245 points, to RB36, 160; the RB9 Ken saw was
the served board, where Green Bay's 1.137 team factor had lifted him further.
Higgins went WR52 to zero points, the bottom of the WR list in the app and off
the `it-league.js` fallback board, which drops zero-point rows.

Left alone on purpose: anyone ESPN lists only as Questionable for Week 1
(Kamara's MCL, Love's ankle, Jeanty, Kraft, Mahomes). A one-game absence is not
a season line change, and the book still prices those players.

**Knock-ons.** `pick-2026-08-20` printed RB ranks with Jacobs at RB9 above the
players it names; the rank cells and the two prose ranks were moved up one to
match the pool, which `test-the-pick.mjs` now requires. One assertion in
`test-it-league.mjs` had a hard-coded "$3" for Jadarian Price that was really a
function of the default board; it now derives the figure the way its neighbours
do. `it-league.js` DEFAULT_BOARD, `front.html`, `player.html`, `auction-watch.html`
and `sitemap.xml` were regenerated with the repo's own tools (the last two were
already a build behind from the 09-02 camp report).

**What this does not fix.** The projection feeds are still unreachable, so
season-long numbers still only move by hand or by the owner's upload. And the
list is hand-kept: run `node tools/apply-availability.mjs --fetch` at least
weekly, act on what it prints, and re-run without flags. A weekly Routine that
does exactly that and opens a PR is the obvious next step; it was not built
here because it needs the same Routine plumbing §46 and §47 are still sorting
out.

## 49. September 2: the auction engine, re-cut for the draft it is actually in

Ken asked for every change that would make the site better at drafting the best
team: the quality of the rankings and the efficiency of the dollar allocation.
This section is what shipped, what each change does to a number the reader sees,
and what it deliberately does not claim.

### 49a. VALUE re-solves on the board that is left

Before this, VALUE was built once from the whole pool and the whole league's
starter demand, and during the draft it was only ever **scaled** by one
inflation factor. The gaps between players — the thing a replacement level
exists to set — never moved. Six teams could hoard three running backs each and
the sheet still priced RB19 against a replacement who had been off the board for
an hour.

`applyInflation` now calls **`revalueRemaining`** (next to it in `index.html`):
`remainingDemand(teams, config)` sums what every team still has to buy (open
starter slots per position, open roster spots per position, open FLEX slots,
counting a flex used by a surplus RB as used), then the same pipeline runs over
the undrafted pool — `calculateReplacementLevels(byPos, config, demand)` →
`calculateVORP` → `calculateAuctionValues(players, config, {demand, budget,
spots})` → `renormalizeToBudget(players, config, {budget, rosteredCounts,
keys: ['auctionValue']})` — against the money actually left in the room. The
three functions gained an optional last argument for this; with it omitted they
are the pre-draft board, unchanged. `inflatedValue` is the live figure, and it
now carries `liveReplacement` and `liveVorp` beside it. The reader's tier
instructions ("value elite RBs 20% more") survive the re-solve through
`valueAdjustMultipliers`. The cheat sheet's Value column, the board colour and
the plan premium's replacement all read the live figure once picks are logged.

With nothing drafted the result is `auctionValue` to the dollar, by
construction. `tools/test-live-value.mjs` (no browser, in CI) pins that, pins
the column still adding up to the money left and never rising down a position,
and shows the point of it: 18 RBs hoarded by six teams lifts the next twelve RBs
and drops the RB replacement level; one RB a team leaves it exactly where it was.

### 49b. One risk discount, written down

VALUE carried the same haircut twice under two names: `POS_RELIABILITY` inside
`effVorp` and `POSITION_PREDICTABILITY` multiplied onto the finished dollar. A
running back was 0.90 × 0.90 = 0.81 against a receiver at 0.97 — a 16% relative
discount nobody had stated. `applyPredictability` and its table are gone; the
one table is `POS_RELIABILITY` (QB 0.99, RB 0.86, WR 0.97, TE 0.90, K 0.19, DEF
0.28), with the rank decay as named constants beside it. RB/WR sits at 0.887
(was 0.835 stacked, 0.928 single); K/DEF keep their stacked products so they
still price at the $1–3 a roster pays for them.

**These are not fitted, and the comment on the table says so.** There is no
ex-ante preseason projection set in the repo — `PROJ_2025` sits within 1.5% of
`ACT_2025` and is not one. `tools/backtest-projections.mjs` is the fit: drop
`tools/sources/preseason-<year>.json` and `actuals-<year>.json` in (the
merge-projections schema) and it prints the ex-ante level factor per position,
the realised-over-projected VORP share (which is what a reliability factor is),
the rank decay by bucket, and the concavity that best matches projected dollar
shares to realised ones. Until then it exits 0 with a message. Move what it
prints into the table by hand and note the year.

### 49c. The last-year calibration compares like with like

`normalizeToLastYear` scaled each position so its projected top-K mean matched
last season's **realised** top-K — a top-13 slice at QB and TE against top-31
at RB and WR. A realised top-K is the set that got lucky as well as good, so
the comparison is biased by construction and by a different amount per
position. It now runs over the full depth of the tables (32 a position, the
same everywhere), applies half the measured gap, and never more than 8%. On the
committed board the factors moved QB 1.000 → 0.946, RB 0.960 → 0.978, WR 0.927
→ 0.963, TE unchanged; top-12 QB VALUE fell $207 → $192 on a $229 Proj, which is
the 1.19x premium §9h calibrated to, restored.

### 49d. The plan prices what the room will make you pay

`buildOptimalPlan` priced every candidate at Proj and `switchPrice` assumed the
rest of the plan could be bought at exactly that. **`expectedPlanPrices`**
measures, per undrafted player, the contest for him — rivals who still have an
open slot he fits (`teamNeedsPosition`, dedicated and flex) and can afford his
price, over comparable players still on the board — against the same ratio on
the pre-draft board, on a log scale, capped 0.90–1.12. Pre-draft the map is
empty and Proj stands, because the curve already priced a full room; the $1–4
tail is never touched. It feeds `buildOptimalPlan` through `opts.expectedPrice`
and `switchPrice` through a new trailing `opts`, for **your** team's plan and
the You column only. Proj on the sheet is untouched; the row carries
`expectedPrice` so the cell can say so.

### 49e. Handcuffs and byes are in the dollars

- **`handcuffsOf` / `handcuffDollars`.** The backup to a lead RB **you own**
  (same 1.3x rule as the board's H chip) is worth his own bid plus the cover: 3
  games missed × (80% of the lead's per-game production − replacement level),
  turned into dollars at the board's own `dollarsPerPoint`. Only the team that
  owns the starter gets it; a rival's starter makes his backup worth $1 to you,
  which is the $1 endgame the guides describe and the sheet never priced. He is
  exempt from the You no-rise clamp — the one legitimate inversion.
- **`byeStackDollars`.** A starter sharing a bye with one you already have at
  the same slot group costs the second hole (the bench covers one, the waiver
  body covers the other, 15% under). Usually a dollar. The row carries
  `handcuffOf`, `handcuffPrem` and `byeClash`.

`tools/test-plan-pricing.mjs` (no browser, in CI) covers all three on a
synthetic league.

### 49f. Smaller things that moved a price

- **K/DEF You** was VALUE and read above Proj ($31 vs $24 at K, §9j). It is now
  `min(Value, Proj)`: paying over the room for a kicker is a pure leak.
- **`SUPERFLEX_QB_CURVE`** was the old 1-QB shape at a higher level — sixteen
  entries, $3 at QB13, in a format where QB13 starts. It runs thirty deep now,
  double digits through QB16, mirrored in `it-league.js`. On the default board
  superflex prices QB1 $60 against RB1 $65, QB7 $37. A judgement of shape, stated
  as such; `test-qb-curve.mjs` pins the invariants.
- **The planner's stranded money** (§19's residual) is gone: `buildOptimalPlan`
  solves twice when the Starters-vs-Depth knob withholds more than the bench can
  absorb, handing the difference back to the starters. At the Depth end of the
  slider the unspent figure is now $0–6 across the nine models (was up to $19);
  the whole-dollar bench floors account for the rest. `test-planner-budget.mjs`
  reports it.
- **`marketAdjustedPrice` is deleted.** It moved a "recommended price" DOWN when
  a position ran hot while inflation and positional demand moved Proj UP, and
  nothing on the page read its output. `computeMarketState` and the heat strip
  stay.
- **Dead code removed:** `applyTierShaping` (with its hand-written per-player
  multipliers from July), `applyQbActuals`, `applyBaselineRankFixes`,
  `computePersonalValue`, `recommendBid`, `buildReasoning` and the unused
  `FORMATS.auction.recommend`. None was reachable.

### 49g. The worker keeps the injury list itself

§48 left the availability list hand-kept. `runAvailabilityRefresh(env)` in
`_worker.js` now pulls ESPN's public injury feed on the same 11:00Z cron as the
odds, maps IR / IR-R / PUP-R / NFI-R / RESERVE-SUS / RESERVE-CEL / Out-with-a-date
to a `gamesOut` with the same rules as `apply-availability.mjs --fetch` (reserve
lists floor at 4, season-ending text or ≥17 weeks → 17, Questionable/Doubtful
ignored), and stores it as row 3 of `odds_overlay` (`provider='espn-injuries'`).
`availabilityMerge` unions it over the committed `AVAILABILITY` block: the live
row wins status, note and source, `gamesOut` is `max(live, committed)` because
the feed's return dates are placeholders (it says Jacobs 2 where the file says
6) and a pure overlay-wins would silently reinstate players. Reinstatement stays
manual. Fail-safe like the odds: bad feed, fewer than 5 matched, fewer than 28
teams, or a row older than 14 days means the previous table stands.
`/api/admin/odds-status?...&availability=1` reports; `&availability=refresh`
pulls now.

Two things this forced out into the open: `buildTeamEnvOverlay` was building
the market line from already pro-rated rows and `oddsCacheRead` scaled them
again, so the nflverse provider double-applied the injury factor for every
listed player; and `blendProjections` now applies availability before the
blend so a fresh IR reads as an injury rather than a market fade. The cached
overlay in production corrects itself at the next pull. `tools/test-worker-
availability.mjs` (101 assertions, in CI, live feed when reachable) covers the
mapping, the merge, the once-only factor and the fail-safes. Not verified from
here: that Cloudflare's egress gets the same 200 from ESPN's edge that this
sandbox does with the worker's user agent.

### 49h. What this does not do, and why

- **Projection feeds are still not pulled.** ESPN's fantasy API and Sleeper are
  unreachable from this sandbox (checked 2026-09-02), so a worker-side feed
  refresh could not be validated and was not written. Season lines still move
  only by upload.
- **The snake tool's survival odds still run on the site's own rank**, not a
  market ADP (`attachProvisionalAdp`). That is the biggest snake-side gap and
  is out of this section's auction scope.
- **No constant here is backtested.** 49b says how to fix that.

`node tools/build-front-analysis.mjs` was re-run (The Build now reads $186 at
122.4 pts/gm + $14 bench); `build-front`, `build-seo --check`, `build-chrome
--check` and `apply-availability --check` are clean. Local dev needs
`npm i --no-save playwright playwright-core react react-dom` for the browser
tests; all four are gitignored.
