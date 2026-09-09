# The DFS lane is on hold

Paused 2026-09-09. Nothing was deleted. This is what is switched off, why, and
exactly how to switch it back on.

## Why

Salaries reach this site one way: a person exports a lobby CSV from DraftKings
or FanDuel and imports it at `/admin`. The operator endpoints were removed on
2026-09-06 because their terms prohibit systematic retrieval
(`docs/data-sources.md`), and no licensed feed is configured. A slate nobody
imports is an empty DFS section on the front page every week, which is a worse
advertisement than no section at all.

So the lane is closed until either the import is automated or a licensed feed
is configured. The code is all still here.

## What is off

`NEWSROOM_FLAGS.DFS_CONTENT` in `_worker.js` is the switch. It defaults to
`false` — by default rather than by an unset Cloudflare var, so a fresh
environment is also closed.

| Surface | How it closes |
|---|---|
| `/dfs` and `/in-season/dfs` | `DFS_PAGES` + `dfsClosed()` serve the in-season hub in place of the page, keeping the reader's URL. The owner's `?preview=<LEADS_EXPORT_KEY>` still opens it. |
| `/api/dfs`, `/api/dfs/slate` | Return `{ ok: false, error: 'on_hold' }`, 200 and `no-store`. |
| The desk's DFS lens and DFS metrics | Already behind the same flag. |
| Front page | The lane tabs, the DFS lane pane, its CSS and its script were removed; the page is single-lane. `dfs-optimizer.js` is no longer loaded there. |
| Nav and footer, 135 pages | The entry came out of the link set in `tools/build-chrome.mjs`. |
| `sitemap.xml`, `llms.txt` | The `/dfs` entry and the DFS section were removed. A gated page must never be advertised. |
| In-page links | The lane card on `/in-season`, the "DFS" cards on eight section pages, and the rows on `/analysts`, `/creators`, `/post-draft`. |

`dfs.html`, `dfs-optimizer.js`, the whole DFS region of `_worker.js`, the
`dfs_salaries` table and `tools/test-dfs.mjs` are untouched.

## What is deliberately still on

The salary import card at `/admin` (`POST /api/admin/dfs`). It is the only way
to load a slate and check it before the lane comes back, and no reader can see
it. Its note on the page says the lane is on hold.

## Bringing it back

1. `git revert <the commit this file arrived in>` restores the front page, the
   links, the sitemap and `llms.txt` in one move. Resolve against whatever the
   front page has become since.
2. Set `DFS_CONTENT: { dflt: true, … }` in `_worker.js`, or set
   `FLAG_DFS_CONTENT=1` in the Cloudflare vars to reopen the routes and APIs
   without a deploy. The runtime half needs only the flag; the nav, sitemap and
   front page are build-time and need step 1.
3. `node tools/build-chrome.mjs && node tools/build-seo.mjs && node tools/build-front.mjs`
4. Import a slate at `/admin` **before** announcing it, so the lane does not
   open onto the empty state that caused this.

Do not relaunch without solving the salary problem first. The options, costed:
a licensed feed (roughly $3,600–$6,000/yr plus the write path and scheduler,
which do not exist yet), or a helper that turns the manual import into one
command.
