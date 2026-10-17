# Distribution playbook (growth plan Phase 6)

The owner's working guide for distributing Iron Tuna's findings and judging
what worked. `docs/` is in `.assetsignore`, so nothing here is published.

Everything below is done by hand. Nothing in the site posts, schedules, emails
or contacts anyone on the owner's behalf. The X and Threads automation that
predates this phase is separate and unchanged.

## The tools on /admin (Operator tools)

| Card | What it does | What it never does |
|---|---|---|
| Weekly drafts | Builds the Tuesday, Thursday/Friday or Sunday draft from the current board at a chosen scoring, for a chosen channel or partner. Freezes a dated finding, shows the figures, the explanation and the labels, and gives editable text, a tagged link and a share image. | Post, schedule, or invent a finding when none clears the rule. |
| Creator partners | Your own list of creators, each with a tagged link (`utm_source=creator-<slug>`, `utm_medium=partner`), their visitors, useful visits, saved leagues and confirmed email sign-ups. "Package" gives four tagged links, a sample segment from this week's board, and an outreach draft. | Suggest creators, send the outreach, or promise results. |
| Where visitors came from | Per source: visitors, useful visits, saved leagues, return within 7 days (mature browsers only), confirmed email sign-ups. | Treat a small or immature sample as a result. |
| Campaigns | Per tagged campaign (each draft, each partner, the Sunday email): the same measures. | Count your own browsers (opening /admin excludes them). |

### The three drafts and their rules

| Draft | Rule (all deterministic, from code the site already prints by) |
|---|---|
| Tuesday waiver finding | From the three-week board: a QB, RB, WR or TE that Iron Tuna ranks inside the depth a 12-team league rosters at his position (QB 17, RB 60, WR 72, TE 18) and the consensus ranks outside it; plays every week of the span; Active, Probable or no tag; role not trending down. Best Iron Tuna rank wins. Availability is never claimed: the post says to check your league. |
| Thursday/Friday market differences | The homepage's own examples at your scoring (fully priced off quoted props from 2+ books, a gap past the board's strong threshold in points and share, near the start line), widest first, up to three, nobody kicking off within the hour. One dated page holds all three. |
| Sunday lineup comparison | The homepage sample's flex call: Iron Tuna's FLEX 30 against the next player at or below FLEX 34 who projects less, both healthy and still to play. |

### Link tags

| Field | Values |
|---|---|
| `utm_source` | `x`, `threads`, `bluesky`, `reddit`, `discord`, `newsletter`, `creator-<slug>` |
| `utm_medium` | `social`, `email`, `partner` |
| `utm_campaign` | `<season>-w<NN>-<piece>`: `waiver`, `vegas-gaps`, `lineup`, `partner`, `sunday` |

The drafts and partner packages apply these for you. If you post a link by
hand, copy it from /admin rather than typing tags, so the campaign table can
group it.

## Weekly owner checklist

**Tuesday (after Monday night's game is final)**
- [ ] /admin, Weekly drafts: Tuesday waiver finding, your usual scoring, your channel. Build.
- [ ] Read the figures and the explanation. If the draft says nothing clears, post nothing about waivers this week.
- [ ] Edit the text into your own voice. Keep the ranks, the "check your league" line and the link.
- [ ] Open the dated finding and the share image; attach the image if the platform takes one. Post. Build again for a second channel (each channel gets its own tag).
- [ ] Glance at last week's campaigns on /admin (7-day range): note visitors and useful visits per post in the log below.

**Thursday or Friday**
- [ ] Build the market differences draft. Confirm every player is still Active or Probable on the dated finding; if a tag changed since the build, build again.
- [ ] Keep the "derived from sportsbook props" and "not betting advice" lines. Post.

**Sunday morning**
- [ ] Build the lineup comparison. Check neither player's status changed overnight. Post before the early games.
- [ ] If the Sunday email is on: /admin, Sunday email, confirm the edition built and the sent and failed counts.

**Any day, partners**
- [ ] Add a creator only after you have looked at their work yourself. Status `prospect`.
- [ ] Package, edit the bracketed parts of the outreach draft, send it from your own email. Set status `contacted`, note the date.
- [ ] When they agree and use the link, set `agreed` or `active`. Review their row weekly; set `paused` or `ended` rather than deleting.

**Weekly log (keep it in your own notes)**

| Week | Post | Channel | Posted at | Visitors | Useful visits | Saved leagues | Confirmed emails | Notes |
|---|---|---|---|---|---|---|---|---|

## 30-day evaluation plan

**Question.** Which sources and which of the three weekly posts bring visitors
who get a useful result, save a league, confirm the Sunday email, and come
back within a week?

**Periods.**
- Baseline: the 14 days before the first draft is posted (read from /admin
  with the 30-day range after the fact; Phase 1 measurement must have been
  live for the whole baseline, or the comparison starts later).
- Test: days 1 to 30 from the first post.
- Read the test period at day 14 (interim, no decisions) and day 30 (decision),
  plus 8 days after day 30 so the last cohorts mature for the return measure.

**Measures, per source and per campaign** (all on /admin):
1. Useful visits as a share of visits (primary).
2. Browsers that saved a league.
3. Confirmed Sunday-email subscriptions (counted only from Phase 6 on).
4. Return within 7 days, mature browsers only.
5. Visitors (context, not a success measure).

**Comparisons.**
- Each channel's posts against each other over the 30 days (about four posts
  per draft type per channel).
- Draft type against draft type (waiver vs. market vs. lineup) within a channel.
- Test period against baseline for the site as a whole: useful-visit share,
  saved leagues per 100 visitors, 7-day return.
- Each partner against the social channels, only once the partner has 20+
  visitors.

**Sample-size limits. Read these before drawing any conclusion.**
- A row under 20 visitors is marked "small sample" and supports no
  conclusion. At current volume (about 1,900 visitor-days in 14 days at
  baseline, 89% single-page) most single-post rows will be small.
- A difference in a share between two rows of 50 visitors each needs to be
  roughly 20 percentage points or more before it is unlikely to be noise; at
  20 visitors each, roughly 30 points. Treat smaller gaps as no difference.
- Returns: a browser counts only once it is 8 days old. A cohort first seen
  in the last week is "maturing", not a miss.
- Confirmed subscriptions: subscribers before Phase 6 carry no source. Owner
  test sign-ups are not excluded from the subscriber counts.
- Identity: one browser is one visitor. A cleared, private or second browser
  reads as new, so returns are undercounted and the same person on phone and
  laptop is two visitors.
- Seasonality: the NFL calendar moves interest week to week (byes, injuries,
  a prime-time game). Compare posts within the same week where you can, and
  prefer four-week totals to single weeks.
- Bot traffic and link previews: platforms fetch links before people click.
  The worker filters known bots; /admin reports likely automation separately.

**Decision rules at day 30.**
- Keep a channel or draft type whose rows reach 20+ visitors and whose
  useful-visit share is at or above the site average. Drop or change one that
  stays under 20 visitors across four posts.
- A partner: continue when their rows reach 20+ visitors with useful visits at
  or above the site average; otherwise pause.
- Nothing here sets a traffic target, and no result should be quoted as a
  forecast.

**What this plan cannot tell you.** Whether a post caused a later direct
visit (no cross-device or cross-session attribution), how many people saw a
post without clicking, or whether a finding was "right": a gap between the
market and the consensus is a disagreement, not a prediction, and no
performance claim should be made from it.
