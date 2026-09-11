# Editorial calendar migration: draft season to in-season newsroom

**Date:** September 8, 2026 (Week 1 of the 2026 regular season is underway).
**Scope:** every scheduled, recurring or automated item that produces an Iron
Tuna story, page, module or social post. Two schedulers exist and both are
covered: the Cloudflare Worker's cron triggers (`wrangler.jsonc` +
`scheduled()` in `_worker.js`) and the Claude Routines that push to `main` or
write to D1 from outside the repository.

This document is the migration analysis required before the in-season
scheduling system was changed. The implementation that follows it is in
`_worker.js` (`CONTENT_KINDS`, `LEGACY_CONTENT`, `ANALYSTS`, `NEWSROOM_*`),
and the admin board's **Legacy content migration** table is generated from
the same `LEGACY_CONTENT` table so the two cannot disagree.

## 1. Inventory

### 1a. Worker cron triggers (before)

| Cron (UTC) | What it ran | Audience | Content it produced | Disposition |
|---|---|---|---|---|
| `0 13 * * 1-5` | X/Threads auction insight thread (`runXAutoPost` slot `auction`) | draft | a social post mirrored onto the front page's **Just Posted** module | **RETIRE** for the regular season |
| `0 16 * * 1-5` | X/Threads snake insight thread (slot `snake`) | draft | same | **RETIRE** for the regular season |
| `0 19 * * 1-5` | X/Threads bonus post (Mon poll, Tue/Thu snake feature, Wed auction strategy, Fri best ball) | draft | same | **RETIRE** for the regular season |
| `0 * * * *` | the data clock (`JOB_SCHEDULE`) and the content desk tick | in-season | the eleven desk pieces below, plus every data pull | **RETAIN, MODIFY** (quarter-hour tick, see §3) |

### 1b. Content desk kinds (before), all on the hourly tick

| Existing kind | Slot (ET) | Purpose | Lens | Disposition | New destination |
|---|---|---|---|---|---|
| `team-recaps` | Mon 7 AM | one recap per club | weekly | **RETIRE** | its per-club usage data feeds **What Sunday Taught Us**; the spec forbids conventional recaps |
| `mnf-breakdown` | Tue 7 AM | Monday game, what we learned | weekly | **MERGE** | **Rest-of-Season Rankings** (Tue) carries a "what Monday night changed" section |
| `what-they-arent-telling-you` | Tue 7 AM | insight-engine feature | weekly | **MERGE** | **Most Underrated Player: What the Experts Aren't Telling You** (Thu, Vega) |
| `opportunity-report` | Wed 7 AM | usage risers/fallers, targets, backfields | weekly | **MERGE** | **Wideout Wednesday** (targets) and **Tailback Tuesday** (backfields) |
| `rankings-update` | Wed 7 AM | ROS/next-3/playoffs movers | weekly | **MERGE** | **Rest-of-Season Rankings** (Tue) |
| `final-read` | Thu 7 AM | market vs consensus, start/sit pressure | weekly | **MERGE** | **Weekend Preview** (Fri) |
| `tnf-preview` | Thu 7 AM | Thursday game preview | weekly | **RETAIN, MODIFY** | **Thursday Night Football Preview** (Thu, Dalton) with a DFS showdown lens |
| `tnf-aftermath` | Fri 7 AM | Thursday game, what we learned | weekly | **MERGE** | **Thursday Night: What Matters** (Fri, Raines) |
| `weekend-game-plan` | Fri 7 AM | one card per game | weekly | **MERGE** | **Weekend Preview** (Fri) |
| `what-changed-today` | Sun 8 PM | Sunday games final by then | weekly | **MERGE** | **What Sunday Taught Us** (Sun 7:30 PM, Mercer) |
| `snf-what-we-learned` | Mon 1 AM | the Sunday night game | weekly | **MERGE** | a live **update** of What Sunday Taught Us once the night game is final, not a second story |

### 1c. Claude Routines (outside the repository)

| Routine (trigger id) | Schedule | Purpose | Audience | Disposition | Reason / destination |
|---|---|---|---|---|---|
| Iron Tuna camp & preseason desk (`trig_013vFwxbbFTQNwCpxLbv5FqY`) | daily 15:00Z | publishes `auction-watch-YYYY-MM-DD.html`, the front page's Training Camp & Preseason desk | draft | **RETIRE** | camp is over; its injury and role tracking is carried by `availability-refresh`, `depth-charts`, **Last-Minute Intel** and the breaking-news workflow |
| Iron Tuna — Play-Caller Premium daily entries (`trig_015MJSf2RFwE89n8Hua3oSG8`) | daily 12:00Z, hard stop 2026-09-13 | coaching-tendency column priced against auction values | draft | **RETIRE** | its concept (coaching and scheme) is Chris Dalton's beat in **Quarterback Monday** and the passing-game analysis |
| Iron Tuna — The Pick (daily story) (`trig_016JAiJJMZi2jtZDmZS1QPNK`) | daily 13:00Z | one themed story a day from the season projection set, ending in a player and a price | draft | **RETIRE** | duplicate of the next row; the one-player-a-day idea is **Most Underrated Player** (Thu, Vega) |
| The Pick (Story) - Updated (`trig_01K2obtrMAKiwGn3N4UroTEv`) | daily 12:00Z | the same column, a second Routine | draft | **RETIRE** | two Routines publishing one column (HANDOFF §47, §57) is exactly the duplication this migration removes |
| Iron Tuna — lead story refresh (every 6h) (`trig_011LYewcPUQikF8izFsN2LAr`) | `58 */6 * * *` | rebuilds the auction from the day's lines and writes a `lead_story` row that becomes the front page lead | draft | **RETIRE** | the lead is now the newest in-season desk piece (`/api/lead-story` switches in the regular season); the archive at `/lead/<slug>` stays readable |
| Iron Tuna: watch for empty lead-story slots (`trig_01WTgFuRik7kDWJHJv5pDwgQ`) | daily 14:15Z, already paused | watches the retired Routine above | draft | **RETIRE** | nothing left to watch |
| Projections update — daily (Aug–Sep, draft season) (`trig_01PMc44HMe6Z5yjaGGK64ZXv`) | `0 10 * 8,9 *` | refreshes the committed season projection set from three feeds | both | **RETAIN** (data job, not a story) | the ROS and playoff boards price off this set; its own prompt says to stop after September 10, and the cron ends with September. Recommendation in the final report: a weekly Monday cadence through Week 17 |
| Projections update — weekly (Mondays, July) (`trig_01HwcprHsvuAe233Bxx4Jqfk`) | `0 10 * 7 1` | the same job, July only | draft | **RETAIN** (dormant until July 2027) | fires nothing this season |
| Iron Tuna — The Tell (weekly column) (`trig_01LvL8PwjZ89dkhKq7gSaVGS`) | Tue 14:00Z | a hand-voiced weekly column arguing with the ranking's composition | weekly | **RETAIN** | distinct editorial function (rank versus projection composition); nothing in the new calendar duplicates it. It is registered on Evan Brooks's desk in the analyst system; see the open item in §5 |
| Iron Tuna daily audit 09-09 (`trig_017eMPVFmgrCz27djUckQRkS`) | one-shot 2026-09-09 | an owner-created audit of the lead-story desk | n/a | **LEAVE** | not editorial; owner's own tool |

### 1d. Static columns and one-off pages that the front page promotes

| Item | Disposition | Reason |
|---|---|---|
| `the-pick.html` (The Pick band on the front page) | historical: keep the page, demote the band in the regular season | draft-priced column; its Routines are retired |
| `play-caller-premium.html` (the Columns band) | historical: keep the page, demote the band | as above |
| `auction-watch-*.html` (Training Camp & Preseason band) | historical: keep the pages, hide the band in the regular season | camp is over |
| `auction-insights-*`, `snake-insights-*`, `bestball-insights-*` (Position Intel, Just Posted) | historical: keep the pages, hide Just Posted in the regular season | draft-day insights |
| The Build, Asset Allocation, Vegas vs. Consensus (cheat sheet) bands | hidden in the regular season | draft-day modules; the tools stay one click away in the nav |
| `waiver-watch-2026-09-01.html` | historical | a one-off; its function is the Wednesday **Pickup Advisor** |
| `the-tell.html` (The Tell band) | retained | see 1c |

## 2. The calendar after migration

All times America/New_York. **Write time and publication time are deliberately
separate.** Except for time-sensitive stories, Claude generates the package
between midnight and 6 AM ET and stores it under a `scheduled` embargo. The
quarter-hour worker releases it at the publication time without a second model
call. If overnight generation fails, retries remain in the overnight window;
after 6 AM the next permitted model call is the publication slot itself as a
last-resort fallback.

One canonical research packet per package; every package with `lens: both`
publishes a Weekly Fantasy and a DFS lens from the same facts.

| Kind | Preferred write time (ET) | Publication time (ET) | Primary analyst | Market / DFS voice | Lens |
|---|---:|---:|---|---|---|
| `last-minute-intel` | at publication, because inactives are time-sensitive | Sun 12:15 PM, live updates to kickoff | Mike Raines | Lena Park | both |
| `what-sunday-taught-us` | at publication, because Sunday games must finish first | Sun 7:30 PM, updated as later games go final | Jack Mercer | Lena Park | both |
| `early-rankings` / **Monday Morning Brief** | Mon 3:15 AM | Mon 6:00 AM | Evan Brooks, with Chris Dalton for MNF | Nate Vega / Lena Park | both |
| `quarterback-monday` | Mon 4:15 AM | Mon 12:15 PM | Chris Dalton | Lena Park | both |
| `ros-rankings` | Tue 1:15 AM | Tue 7:00 AM | Evan Brooks | Nate Vega | both |
| `tailback-tuesday` | Tue 2:15 AM | Tue 1:15 PM | Evan Brooks | Lena Park | both |
| `pickup-advisor` | Wed 1:15 AM | Wed 6:00 AM | Tyler Grant | Lena Park | both |
| `wideout-wednesday` | Wed 2:15 AM | Wed 1:15 PM | Mike Raines | Lena Park | both |
| `tnf-preview` | Thu 1:15 AM | Thu 6:00 AM | Chris Dalton | Chris Dalton | both |
| `underrated` | Thu 2:15 AM | Thu 10:15 AM | Nate Vega | Nate Vega | both |
| `trade-desk` | Thu 3:15 AM | Thu 1:45 PM | Evan Brooks | Nate Vega | both |
| `tight-end-thursday` | Thu 4:15 AM | Thu 4:45 PM | Evan Brooks | Lena Park | both |
| `tnf-what-matters` | Fri 1:15 AM, once TNF is final | Fri 6:00 AM | Mike Raines | Lena Park | both |
| `weekend-preview` | Fri 2:15 AM | Fri 11:15 AM | Sam Porter | Lena Park | both |
| `kickers-defenses` | Fri 3:15 AM | Fri 2:45 PM | Sam Porter | Lena Park | both |
| `market-movers` | Sat 5:15 AM | Sat 11:30 AM | Nate Vega | Lena Park | both |
| `breaking` | immediately when significant news clears the threshold | immediately | Jack Mercer | Lena Park | both |

The former standalone `mnf-preview` package is retired as a separate
publication. Its showdown/start-sit material is folded into the Monday Morning
Brief so Monday does not dump two stories at 6 AM.

## 3. Scheduler changes

- `wrangler.jsonc` triggers go from four to one: `*/15 * * * *`. The three
  weekday social crons are removed. The quarter-hour tick is what makes a
  12:15 PM and a 7:30 PM slot possible in Eastern time without a UTC cron
  that drifts an hour every November.
- `scheduled()` still recognizes the old social cron strings, and refuses to
  post draft-season insight threads during the regular season unless
  `DRAFT_SEASON_SOCIAL=1` is set. The code is kept for 2027.
- `JOB_SCHEDULE` entries gain `minutes`. The data pulls stay on their hourly
  rows; the schedule refresh and the content tick run every quarter hour on
  game days so a 12:15 piece sees the 11:30 inactives.
- For editorial packages, `CONTENT_KINDS.hour/minute` is the **publication**
  schedule. `generateHour/generateMinute` is the preferred model-compute
  schedule. Those fields must not be conflated.
- Prewritten pieces are stored as `scheduled` and are not returned by the
  public list, piece or newsroom-feed APIs before their embargo expires.
- Sunday Last-Minute Intel, Sunday evening analysis, breaking news and any
  missed overnight fallback are exceptions because freshness is more important
  than avoiding daytime compute.

## 4. Duplicate prevention

`newsroomAudit()` in `_worker.js` (and `tools/test-newsroom.mjs`) fail when:

- two active kinds share a slot and a subject (same day, hour, minute and
  target rule) or a title;
- a retired kind is still runnable;
- a legacy kind appears in the active table;
- more than one cron string in `wrangler.jsonc` would run the content tick.

## 5. Open items for the owner

1. The retired Routines are disabled from this session where the API allows
   it. Any that refuse (a Routine created from another session may reject
   `update_trigger`) are listed in the final report with the exact ids; the
   worker-side changes make their output harmless either way, but they should
   be disabled in the Routines UI.
2. The Tell is bylined to a pen name, Artie Kesselman. The analyst roster in
   the specification has eight names and no ninth. The column is registered
   on Evan Brooks's desk (it argues about what is inside a ranking); re-
   bylining it to Brooks means editing `tools/the-tell-routine-prompt.md`,
   the page's method box and the Routine prompt, which were written by the
   owner hours before this migration and are left as they are pending that
   decision.
3. The season projection Routine stops after September. The ROS boards keep
   pricing off the committed set until it is next refreshed.
