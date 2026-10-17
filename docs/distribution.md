# Distribution: the weekly checklist and the 30-day evaluation

Growth plan Phase 6 (written 2026-10-17). The tools live on /admin under
**Distribution** (post drafts, creator partners, outreach) and in **Meaningful
use**, card "Compare sources". `docs/` is not published.

Nothing on /admin posts, schedules or sends. Every post and every message to a
creator is the owner's own act.

## The weekly checklist

All times New York. Open /admin, then Distribution.

**Every day you post**

- [ ] Choose the scoring most of your audience plays (PPR unless you know
      otherwise), then "Build this week's drafts".
- [ ] Read the figures under the draft against the finding page it links to.
      If a draft says "nothing to post", post nothing for that slot.
- [ ] Choose the channel in "Tag for" before copying, so the link carries the
      right `utm_source`. One channel per copy.
- [ ] Edit the wording, not the numbers. Keep "derived" on market points and
      "not betting advice" on market posts. Keep the "As of" time.
- [ ] Check the X count is 280 or less before posting to X.
- [ ] For an image, open the finding page and use "Save image" (PNG).

**Tuesday**: the waiver finding. Build it before Thursday's kickoff: once a
game has started the draft declines, because ranks would only cover the
players still to play.

**Thursday or Friday**: market versus consensus. Build it as close to posting
as you can; the board moves with the lines. Check no named player has been
ruled out since.

**Sunday morning**: the close lineup call. Post before the early kickoffs.
Check injury news on both players first.

**Monday, ten minutes**

- [ ] Meaningful use, 7 days: "Compare sources" and "Tagged links by
      campaign". Note per campaign: visitors, useful results.
- [ ] Partners: update each partner's status. Remove nobody whose links are
      still live.
- [ ] Sunday email (Operator tools): sent, failed, confirmed subscribers.
- [ ] Write one line per post in a log you keep: date, channel, campaign,
      visitors, useful. A post that brought no visitors is a result too.

**Creators (when you choose to approach one)**

- [ ] Add them under Creator partners with a slug (letters, digits,
      hyphens). Only people you have chosen yourself.
- [ ] Build the drafts again so their tagged links exist.
- [ ] Outreach: choose them under "For", "Fill the drafts", edit every
      bracketed field, send it yourself. Claim no traffic, audience or
      results you have not measured.
- [ ] Send the sample segment only if they ask for one.

## The 30-day evaluation

Day 0 is the first day a tagged post goes out after this phase is deployed.

### What is compared

| Measure | Where | Unit |
|---|---|---|
| Useful result | Compare sources, "Useful result" | browsers with a populated tool result |
| Saved a league | Compare sources, "Saved a league" | browsers |
| Confirmed email | Compare sources, "Confirmed email" | confirmed subscriptions credited to the visit they came from |
| Came back in 7 days | Compare sources, "Came back in 7 days" | browsers first seen 8+ days ago, by the source of their first visit |
| Per post | Tagged links by campaign | visitors and useful visitors per `utm_campaign` |

Page views and raw visits are context, not outcomes.

### Periods

| Period | Days | Read on | What it answers |
|---|---|---|---|
| Baseline | the 14 days before Day 0 | Day 0 | What untagged sources (direct, search, AI, referral) produce without posting |
| Weeks 1 and 2 | Day 0 to Day 13 | Day 14 | Which channels bring any visitors who get a useful result |
| Weeks 3 and 4 | Day 14 to Day 27 | Day 28 | Whether the first two weeks repeat |
| Returns | browsers first seen Day 0 to Day 21 | Day 30 | Seven-day return by source; later browsers are still maturing on Day 30 |

Compare a channel with itself across weeks 1-2 and 3-4, and each channel with
the baseline sources. The 14-day baseline will be short of history: outcome
events started on 17 Oct 2026 (Phase 1), so a baseline that reaches further
back has no outcomes to compare.

### Sample-size limits

- **Under 20 visitors** in a row (badged "small sample"): read the counts,
  not the percentages. Do not rank channels on it.
- **Under 20 mature browsers** (badged "too young"): no return rate to compare.
- **Comparing two rates**: treat a difference as real only when both rows have
  at least 100 visitors and the difference is larger than twice
  `sqrt(p(1-p)(1/n1 + 1/n2))`, where `p` is the two rows' pooled rate. At 100
  visitors each and a 30% rate that is about 13 points. Smaller differences
  are noise at this volume.
- **Confirmed subscriptions** exist only once the Sunday email is switched on
  (see the growth plan's outstanding items). Before then the column reads 0
  for every source and says nothing. Sign-ups from before 17 Oct 2026 carry
  no source; owner test sign-ups cannot be told apart.
- A browser is not a person: a cleared, private or second browser reads as
  new, so returns are a floor for every source alike.
- A tag survives only on the first page of a visit. A reader who copies the
  address bar later shares an untagged link, which then reads as direct.

### Decision on Day 30

Write down, per channel and per partner: visitors, useful-result rate,
saved leagues, confirmed subscriptions, seven-day return (or "too young"),
and whether weeks 3-4 matched weeks 1-2. Then:

- Keep a channel whose useful-result rate clears the sample rule against the
  baseline, or whose counts are too small to judge but cost little to post.
- Stop a channel that brought visitors but no useful results in both halves.
- Do not extrapolate a month into a season, and make no traffic promise to a
  partner from these numbers.
