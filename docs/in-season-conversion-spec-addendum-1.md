# Iron Tuna — In-Season Conversion Spec, Addendum No. 1

**Version:** v2 (Addendum to v1 dated September 7, 2026)
**Date:** September 7, 2026
**Effect:** This addendum supersedes v1 Sections 3 (Phase 2), 5.3 (prediction markets bullet), 5.1 (platform sync), and 8 (Free tier). It adds new Section 13 (Data Sources) and Section 14 (Data Licensing Rules). All other provisions of v1 remain in force.

---

## Summary of changes

1. **Prediction market price comparison is cut from v1.** Kalshi's data terms prohibit it. See 13.4.
2. **Platform sync (Sleeper) is not a free fast-follow.** Sleeper is licensed for non-commercial use only. See 13.5.
3. **DFS salaries are ingested by user CSV upload, not by scraping operators.** See 13.3.
4. **Free tier is the delay model**, with a specific and deliberate design: free users get the same card 24 hours before lock, with the line movement since publication shown. See revised Section 8.
5. **Auction archive is usage-triggered with a hard backstop of October 31,** not a fixed September 30 date. See revised Phase 2.

---

## 13. Data sources

You have no data licenses. Everything below is either openly licensed, expressly permits commercial use, or costs less than a phone bill. **Verified September 7, 2026.** Re-verify each item's terms before launch; terms change.

### 13.1 Green — openly licensed, commercial use permitted

| Source | Covers | License | Cost |
|---|---|---|---|
| [nflverse-data](https://github.com/nflverse/nflverse-data) | NFL play-by-play back to 1999, rosters, schedules, depth charts, snap counts, injuries, next-gen stats | CC BY 4.0 | Free |
| [CollegeFootballData.com](https://collegefootballdata.com/terms) | NCAAF games, teams, players, advanced stats, ratings (SP+, Elo), recruiting, **and betting lines** | Custom; commercial use expressly permitted | Free tier; paid tiers raise quota |
| [api.weather.gov](https://www.weather.gov/documentation/services-web-api) | Forecasts for outdoor stadiums | U.S. government work, public domain | Free, no key |

**nflverse is the backbone.** It is Creative Commons Attribution 4.0, which grants a worldwide, royalty-free, irrevocable license to reproduce and share the material, including commercially, on condition of attribution. Attribution requirement: retain creator identification, note that you modified the data, and link to the source. Put this in the site footer and in a `/data` page.

**CollegeFootballData is the single best find here.** Its terms state plainly that "Commercial use is permitted. Your subscription tier determines your API usage quota, not whether you may use the API commercially," and expressly allow use in paid and subscription applications, private caching, display of reasonable portions of factual data, and publication of your own derived models and predictions. It also carries betting lines, which means the entire college half of Bettor's Edge runs on a source that permits exactly what you want to do.

**What CFBD prohibits, and what it means for the build:** you may not sell or publish the data as a standalone dataset, operate a mirror or proxy, or expose raw API responses to your users. Practical rule: never build an endpoint that returns a CFBD response body to the browser. Always transform server-side and return your own derived object. Attribution is not required but is requested; include "Data provided by CollegeFootballData.com" anyway.

### 13.2 Yellow — paid, but trivially so

**NFL odds: [The Odds API](https://the-odds-api.com/).** The free tier is 500 credits per month, which is not enough to run a weekly card. The 20,000-credit plan is $30 per month, the 100,000-credit plan $59. Budget the $30 plan and design polling to fit it.

At $30 a month this is a line item, not a licensing negotiation, and it removes any temptation to scrape a sportsbook. **Confirm commercial display terms directly with The Odds API before launch** (team@the-odds-api.com); their public FAQ does not address redisplay, and a one-email answer in writing is worth having in the file.

**Polling budget for the $30 plan.** Do not poll continuously. Fetch on a schedule tied to the publishing cadence in v1 Section 9: Tuesday open, Thursday, Saturday, Sunday morning, plus one fetch immediately before each game's lock to record the closing line for CLV. That is roughly 5 to 6 pulls per game week, well inside 20,000 credits.

### 13.3 DFS salaries — user upload, not scraping

Do not scrape DraftKings or FanDuel salary endpoints. Those undocumented JSON endpoints are the operators' own data, their terms prohibit systematic retrieval, and Iron Tuna is a commercial product with a public face and your name on the LLC. The risk is small but it is entirely avoidable.

**Build instead:** a CSV upload. Contest entrants can export the salary file from the operator themselves; the user uploads it, Iron Tuna parses it and runs the allocation. This moves the act of obtaining the data to the person already entitled to it, costs you nothing legally, and takes about a day to build.

Parse defensively: column headers change, and a hardened parser with clear error messaging is the whole feature.

### 13.4 Prediction markets — cut from v1

**Kalshi's data terms do not permit this feature as specified.** They limit access to personal, non-commercial use, prohibit publicly displaying, publishing, distributing or disseminating Kalshi data without prior written authorization, prohibit scraping and systematic retrieval, and expressly prohibit use of the data for machine learning or artificial intelligence.

Remove the price-comparison feature from the Bettor's Edge scope. Three options, in order of preference:

1. **Drop it.** It was a differentiator, not a core feature, and the card works without it.
2. **Ask.** Kalshi's terms contemplate written authorization. A short licensing request costs one email and might succeed; do not build against it until you have the written consent in hand.
3. **Write about it without displaying data.** Editorial commentary about how event-contract pricing differs from sportsbook pricing is speech and needs no license. What you cannot do is ingest and display their prices.

**Do not substitute another prediction market without reading its terms first.** Assume the same posture applies until verified.

### 13.5 Platform sync — licensing required, not free

Sleeper's API is read-only and requires no key, but its documentation states it is "free to use for non-commercial purposes" and directs commercial users to contact them for licensing. Iron Tuna is a paid subscription product, so the non-commercial grant does not cover you.

**Revised approach for v1 Section 5.1:** ship manual league entry (roster, remaining FAAB, scoring settings) as the launch path. It is less elegant, but it works today and it carries no license risk. In parallel, send Sleeper a licensing inquiry. Sleeper is the most developer-friendly of the platforms and a license may well be cheap or free; get it in writing before you build the integration. ESPN and Yahoo have no public fantasy API worth building against and should not be attempted.

Where you do use Sleeper's trending data under any arrangement, their docs request attribution; give it.

### 13.6 Projections — build your own

There is no free, commercially licensed source of fantasy point projections. Do not scrape consensus rankings or projections from FantasyPros or similar aggregators; those are the product those companies sell.

**This is not a gap, it is the moat.** Build projections from nflverse historical play-by-play, which you are fully licensed to use commercially. The distribution outputs required by v1 Section 4.1 (median, floor, ceiling, variance) are something most free sources do not publish anyway, so building them yourself produces the input the allocation engine actually needs rather than a point estimate you would have to reverse-engineer a distribution from.

Estimated scope: this is the largest single work item in the conversion. Budget accordingly and consider launching Season-Long and Bettor's Edge first, with DFS following once projections are stable.

### 13.7 Red — do not use

- ESPN's undocumented endpoints. No license, no terms permitting commercial redisplay, and they break without notice.
- DraftKings and FanDuel internal JSON endpoints. See 13.3.
- Any scraped projection or ranking aggregator.
- Kalshi and other prediction market data, absent written consent. See 13.4.

---

## 14. Data licensing rules for the codebase

Enforce these the same way v1 Section 7 enforces the compliance rules, in CI rather than in policy.

1. **A `/data` page listing every source, its license, and its attribution string.** Link it from the footer of every page. This satisfies CC BY 4.0 and is the first thing you will want if anyone ever asks.
2. **No raw third-party response body is ever returned to the browser.** Every API route returns an Iron Tuna-shaped object built server-side. This is required by the CFBD terms and is good practice everywhere else.
3. **All third-party data access is confined to a single `lib/sources/` directory**, one adapter per source, each with a header comment stating the license and its restrictions. If a fetch call to an external host appears outside that directory, the build fails. Add that lint.
4. **API keys server-side only.** CFBD's terms prohibit exposing keys in public code; treat this as universal.
5. **Cache aggressively.** Caching protects your quota and is expressly permitted by both CFBD and CC BY 4.0. Cache CFBD and nflverse pulls for at least an hour; cache odds per the polling schedule in 13.2.
6. **Keep the written record.** When you get an answer from The Odds API or Sleeper, save the email. A file of short written confirmations is cheap insurance and you already know why.

---

## Revised Section 8 — Entitlements and pricing

Single subscription, as in v1. The free tier is the **delay model**, designed as follows.

| | Paid | Free |
|---|---|---|
| The Ledger | Full | **Full.** Never gated. |
| `/learn` library (220 insights) | Full | Full |
| Bettor's Edge card | At publication (Tue for the week, Thu/Sat for day-of) | **The same card, 24 hours before that game's lock** |
| Position sizing | Yes | Yes, on the delayed card |
| DFS allocation and stacking | Yes | No |
| Season-Long FAAB and trade tools | Yes | Start/sit only |
| Auction tool (while live) | Yes | Limited |

**The design point:** the free card is released 24 hours before lock, not after the game. A free user can still act on it. What they cannot do is get the number the subscriber got, and the delayed card displays exactly that gap:

> *Published Tuesday to subscribers at +3.5. Current line: +2.5.*

That comparison is the entire conversion argument, it is honest, it is computed from data you already store for closing line value, and it markets the product without a single performance claim. When the line has not moved, show that too. Suppressing the unflattering cases would make the feature a performance claim rather than a disclosure, and would put it back inside the substantiation problem v1 Section 7 exists to prevent.

Build requirement: the `plays` table in v1 Section 6 needs two additional columns.

```
plays
  ...
  public_release_at     timestamptz    -- computed: lock_time minus 24h
  line_at_release       numeric        -- captured at public_release_at
```

Gate on `public_release_at`, server-side. Never ship the paid card to the client and hide it with CSS.

---

## Revised Phase 2 — Auction archive

**September 30 was arbitrary. Replace it with a usage trigger and a hard backstop.**

The auction tool is already built and already deployed, so the marginal cost of leaving it running is near zero. The only real cost is attention, and Phase 1 already solves that by demoting it in the navigation. Meanwhile late drafts are real: dynasty and devy auctions, best ball, and in-season free agent auctions all run past September, and every one of those users is someone you want on the 2027 waitlist.

**Trigger:** archive the interactive auction when weekly sessions fall below 25 for two consecutive weeks, **or on October 31, 2026, whichever comes first.** The Phase 0 instrumentation gives you the number; if the threshold turns out to be wrong once you see real traffic, adjust the threshold, not the backstop.

The hard backstop matters. Without a date, the flag never gets flipped and the tool quietly rots into a support liability with stale player data, which is a worse outcome than archiving a week early.

Everything else in Phase 2 stands: `FEATURE_AUCTION_LIVE` flag, static `/draft` page with the 2027 waitlist, saved boards read-only for 90 days with 14 days notice before purge, and the `/learn` library live permanently.

---

## Revised acceptance criteria (additions)

- [ ] `/data` page live, listing every source with license and attribution
- [ ] `lib/sources/` lint in CI; build fails on external fetch outside that directory
- [ ] No raw third-party response body reachable from any client route (verified by test)
- [ ] DFS salary CSV upload parses current DraftKings and FanDuel exports, with clear failure messaging
- [ ] Free card gating enforced server-side on `public_release_at`
- [ ] Line-movement comparison renders on the delayed card, including when the line has not moved
- [ ] Written confirmation on file from The Odds API regarding commercial display
- [ ] No Kalshi or prediction market data anywhere in the codebase

---

## Sources verified September 7, 2026

- nflverse-data license (CC BY 4.0): https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md
- CollegeFootballData terms of use: https://collegefootballdata.com/terms
- CollegeFootballData API tiers: https://collegefootballdata.com/api-tiers
- The Odds API pricing: https://the-odds-api.com/
- Kalshi Data Terms of Use: https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf
- Sleeper API documentation: https://docs.sleeper.com/
- National Weather Service API: https://www.weather.gov/documentation/services-web-api

---

## Implementation status

Tracked in [`data-sources.md`](data-sources.md), which holds the live inventory of
every external host the code reaches and the remediation queue for the red-list
items already in production.
