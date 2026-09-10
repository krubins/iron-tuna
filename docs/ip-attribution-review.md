# Third-party IP and attribution review

Prepared 2026-09-09 during the commercial-readiness pass. This is an **inventory
of what the code actually does**, read out of the repository, plus what the
repository does and does not contain by way of permission. It is not legal
advice and it does not clear anything.

Companion documents:

- `docs/data-sources.md` — the engineering inventory of every external host the
  worker reaches, with the remediation queue (R1–R7).
- `data.html` (`/data`) — the public-facing version, linked from every footer.

**Standing rule, repeated because it is the point of this file: nothing in this
repository evidences a license, permission, endorsement or affiliation from the
NFL, any NFL club, ESPN, CBS, Yahoo, Sleeper, DraftKings, FanDuel, Underdog,
PrizePicks, or any prediction-market operator.** Where a row below says the
basis is "open license", that is a public license anyone may rely on, not a
negotiated one. Every other row is either a paid API subscription or unreviewed.

---

## 1. Inventory

| # | Asset / source | Where it is used | Apparent basis (as documented in this repo) | Attribution displayed? | License evidence in repo? | Owner review |
|---|---|---|---|---|---|---|
| 1 | **nflverse-data** (players, rosters, schedules, injuries, snap counts; also the source of the headshot *lookup*) | `tools/build-headshots.mjs`, `tools/nfl-headshots.json`, the `PROJECTIONS` and `LEAD_FACES` blocks in `_worker.js`, `player-search.js` | CC BY 4.0. Commercial use permitted with attribution, licensor identification and a statement that the data was modified. | **Yes** — generated footer on every page, front-page footer, app footer, `/data`, `llms.txt` | The public license itself; nothing bespoke needed | **Low.** Confirm the attribution string names the licensor, the license and the fact of modification. It now does on `/data`; the footer carries the short form. |
| 2 | **NFL.com player and team imagery** (`static.www.nfl.com`) | ~1,680 URL references across the deployed HTML: `_worker.js` `LEAD_FACES` (335), `front.html` (111), `player-search.js`, and every page that renders a player card or story face. Hot-linked into the browser; never fetched or stored server-side. | **None documented.** The CC BY 4.0 license on nflverse covers the *dataset that contains the URLs*, not the images those URLs resolve to. Copyright in the images remains with their owners. | Was "Player photos © NFL/ESPN"; **changed 2026-09-09** to a statement that the images remain their owners' property and that Iron Tuna is not affiliated with or endorsed by the NFL or any club. `/data` carries the same plus a takedown address. | **No** | **HIGH — the largest open item.** See §2. |
| 3 | **ESPN player headshot cutouts** (`a.espncdn.com`) | `player-search.js`, `front.html` lead artwork — used first, with the NFL URL as the fallback | **None documented.** Undocumented public image path. | Same footer/`/data` statement as row 2 | **No** | **HIGH.** Same question as row 2. |
| 4 | **ESPN public JSON endpoints** (`site.api.espn.com`) — injuries, scoreboard, game summaries, depth charts | `_worker.js` `AVAIL_FEED_URL`, `ESPN_SCOREBOARD`, `ESPN_SUMMARY`, `ESPN_DEPTH` | **None documented.** Undocumented internal endpoints with no published terms permitting commercial redisplay. Read server-side, cached, and transformed before display; no response body is passed through. | Not named in the UI | **No** | **HIGH.** This is item R1 in `docs/data-sources.md` and is live in a paid product today. nflverse publishes replacements for injuries, depth charts and rosters; the gap is live in-game scoreboard state. |
| 5 | **The Odds API** (`api.the-odds-api.com`) — game lines, totals, player props | `_worker.js` `ODDS_API_BASE`; the input to every market-implied number on the site | Paid API subscription. **Redisplay terms unconfirmed** — their public FAQ does not address it. | Not named in the UI; `/data` describes it generically as the odds provider | Subscription only; no written redisplay permission on file | **MEDIUM, and cheapest to close.** One email (item R3). Get the answer in writing and save it in `docs/`. |
| 6 | **Sleeper API** (`api.sleeper.app`) — player id/metadata map, and the reader's own league when they connect one | `_worker.js` player map (2 call sites) and `PROVIDER_SLEEPER` | Public API. Their docs describe a **free, non-commercial** grant and request attribution. Iron Tuna is a paid product. | Attribution string exists in `docs/data-sources.md` and on `/data`; not shown in the footer | **No** | **MEDIUM.** Item R2/R7. The league connector already ships **off** behind `FLAG_SLEEPER_SYNC` for exactly this reason. The player map is live. nflverse would cover the map. |
| 7 | **Yahoo Fantasy API** (`fantasysports.yahooapis.com`, `api.login.yahoo.com`) | `PROVIDER_YAHOO` | OAuth 2.0 under the Yahoo Developer Network terms, read-only scope `fspt-r`, authorized by the reader on Yahoo's own site. Tokens sealed at rest (`LEAGUE_TOKEN_KEY`). | Described on `/data` and in the Privacy Policy | No registered app yet; ships off behind `FLAG_YAHOO_SYNC` | **LOW–MEDIUM.** Register the app and confirm YDN terms permit use in a paid product before enabling. |
| 8 | **DraftKings / FanDuel salaries** | `parseDfsCsv`, `POST /api/admin/dfs` | The entrant's own contest export, uploaded by hand. The operators' own API endpoints were **removed 2026-09-06** and are now on a CI red list (`tools/test-data-sources.mjs`) that fails the build if they return. | Site labels only | N/A — no operator feed is read | **LOW.** The names are used nominatively to label a contest type. |
| 9 | **Underdog / PrizePicks / Sleeper pick'em labels** | `/dfs`, `/in-season` | Nominative use of trademarks to name a contest format. No data is read from any of them. | Named on `/data` under trademarks | N/A | **LOW.** |
| 10 | **Prediction-market data (any operator)** | **None. Nothing in the product reads or displays it.** The `/wagers` lane was retired and 301s to `/in-season`; the waiting-list form was removed. Two named operators are on the CI red list and the build fails if either name appears in a deployed file. | N/A | N/A | N/A | **NONE — but see §3.** The product does not currently have a prediction-market feature, which contradicts how the product is sometimes described. |
| 11 | **Iron Tuna's own marks and imagery** (`tuna.webp`, `tuna-mark.png`, `og.png`, the wordmark SVG, `auction-sheet.webp`, `social/*`) | Site-wide | First-party | "Iron Tuna™ · © 2026 Iron Tuna" on every page | N/A | **LOW.** The ™ is used; whether a registration exists is outside the repo. Worth confirming before a sale. |
| 12 | **Google Fonts (Bebas Neue)** | Every page | SIL Open Font License via Google Fonts | Not required | N/A | **LOW.** |
| 13 | **AI-generated editorial** (analyst personas, desk pieces, the Value Coach) | `/analysts`, `/in-season/desk`, `/lead`, the draft app | First-party output of a paid model API. The desk's own disclosure (`AI_DISCLOSURE` in `_worker.js`) is now pre-rendered on `/analysts`, `/analysts/<id>` and `/in-season/desk` rather than only arriving with the API payload. | **Yes**, since 2026-09-09 | N/A | **LOW–MEDIUM.** Provider terms on ownership and permitted use of output are a contract question, not a repo question. |

---

## 2. The imagery question (rows 2 and 3)

This is the item that would come up first in diligence, so it is stated plainly.

**What the code does.** The application never copies, stores or serves a
third-party player image. It writes `<img src="https://static.www.nfl.com/…">`
(or the ESPN equivalent) into HTML, and the reader's browser fetches the image
from the publisher's own CDN. There are roughly 1,680 such references.

**Why "attribution" did not settle it.** The footer used to read
"Player photos © NFL/ESPN". A copyright notice is not a license: it names
someone else's rights sitting next to Iron Tuna's own, and a careful reader can
take it as an assertion that permission exists. None is documented anywhere in
this repository.

**What was changed.** The wording, and only the wording. The footer and `/data`
now say what is verifiable: the images are referenced from their publishers'
own hosts, the rights remain with their owners, Iron Tuna is not affiliated
with or endorsed by the NFL or any club, and there is an address to write to
for removal.

**What was deliberately NOT changed.** The images are still there. Removing
them is a product decision, not a cleanup one: there is no permissively
licensed headshot set already in use anywhere in the application to swap in,
and pulling faces out of the front page, every player card and every story
would visibly change the product. That call belongs to the owner.

**The options, for the owner:**

1. **Leave as-is** with the corrected wording, and accept the risk that a rights
   holder objects. Hot-linking is not the same as hosting, and the practice is
   widespread, but neither fact is a defense anyone has given in writing.
2. **License** an image set (Getty, AP, USA Today Sports Images and Imagn all
   sell fantasy-sports-scale licenses).
3. **Substitute** — silhouettes, team color blocks, or initials. Cheap, ugly,
   and completely safe.
4. **Remove** headshots entirely.

An acquirer will ask which of these is in force. Options 2–4 all take
engineering time; option 1 takes a decision.

---

## 3. Prediction markets: a description-versus-product mismatch

Worth flagging because it cuts the other way from the rest of this file.

The product is sometimes described as covering prediction-market analysis. **It
does not, today.** The `/wagers` lane was retired, the waiting-list form was
deleted, and `tools/test-data-sources.mjs` red-lists two named prediction-market
operators so that the build fails if either name reappears in a deployed file.
That posture was a deliberate response to their terms (see
`docs/in-season-conversion-spec-addendum-1.md` §13.4).

Nothing on the live site claims a prediction-market feature, and the Terms and
`/data` now say plainly that Iron Tuna does not operate one — so the site is
accurate as it stands. But if the product is being marketed or sold on that
capability, the marketing is ahead of the code, and that gap is exactly the kind
of thing a purchaser reconciles line by line. Either build it (with written
consent first, per the addendum) or stop describing it.

---

## 4. What a purchaser will most likely ask for

1. Written confirmation from The Odds API that derived-line redisplay in a paid
   product is permitted. (Cheapest item here. Currently unanswered.)
2. A decision, in writing, on the imagery question in §2.
3. A plan or a completed swap for the ESPN endpoints in row 4.
4. Sleeper's written position, or the removal of the player map in favor of
   nflverse.
5. Evidence of trademark rights in "Iron Tuna" if the mark is part of the deal.
6. The AI provider's terms as they bear on ownership of generated editorial.

Items 1, 3 and 4 are engineering-adjacent and already tracked as R1–R3 in
`docs/data-sources.md`. Items 2, 5 and 6 are owner decisions.
