<!--
THIS FILE IS THE CANONICAL COPY of the prompt run by the Claude Routine
"Iron Tuna - lead story refresh (every 3h)" (trig_011LYewcPUQikF8izFsN2LAr,
cron `58 */3 * * *`). The Routine holds the live copy; this is the version
under review.

It lives in the repo because HANDOFF.md Section 17 records what happens when it
does not: the prompt is edited by several sessions independently, it was once
pinned to one desk and restored 73 seconds later, and nobody could see what had
changed or when. Edit here, then push the same text to the Routine
(`update_trigger`), and the diff is in the history either way.

Everything below the marker is the prompt itself, verbatim.
-->

<!-- PROMPT BEGINS -->

Generate and publish a new deep-dive lead story for irontuna.com, a fantasy football auction-draft site. Work autonomously; nobody is watching this run.

## This story goes straight onto the front page
As of August 2026 the site READS this table. The newest row with `verified=1 AND published=1` is the lead story on irontuna.com, and `/lead/<slug>` renders the full article. There is no human in the loop between your INSERT and a reader. Write accordingly.

## ONE STORY PER RUN
**Insert exactly one row. Once you have inserted, you are finished writing.** Do not write a second, revised, expanded or "better" story in the same run, and do not insert again because the first one now looks improvable. If your first insert was wrong, say so plainly in your report and leave it for a human to pull. A second insert is not a correction; it is a second published story.

This is not hypothetical. On 2026-08-21 one run inserted two analyst stories seven minutes apart. The second retired the first, and because the run never re-read what it had just published, the two scored the SAME analyst's position on the SAME player in opposite directions: one agreed, one disagreed, on identical numbers. Both went live on the standing column at /analyst-desk and sat there contradicting each other until a human pulled one.

## Where things live
- Cloudflare connector, D1 database `iron-tuna-leads`, id `75f7c43a-69cc-48eb-aa78-6ecfd91af2fb`.
- Table `lead_story(id, slug, title, dek, body_html, method, sources, category, players, calls, verified, published, created_at, published_at)`.
- Table `odds_overlay` holds row `id=1` whose `payload` is a JSON map of `"playername|POS"` to sportsbook-implied season projections (`passYd`, `passTD`, `rushYd`, `rushTD`, `recYd`, `recTD`), and row `id=2` (provider `teamctx`) with book-implied points per game and an implied-scoring rank for all 32 teams. Both refresh daily at about **7:00 AM ET** (11:00 on the server's UTC clock; 6:00 AM ET in winter). Check `updated_at` (epoch ms) and note staleness in the method line if it is more than 36 hours old. **Write that time as ET, never as UTC** - see "Clock times are Eastern" below.
- The consensus baseline projection set (~407 players, includes `rec`, `passInt`, `fumLost`) is embedded in the `iron-tuna` Worker as `var PROJECTIONS = [...]`. Retrieve it with the Cloudflare connector's `workers_get_worker_code` on script `iron-tuna`. The result is ~625 KB, so it will be written to a file; parse it there with a script rather than reading it into context.
- The repo `krubins/iron-tuna` is the site's own record of the season: `auction-insights-*.html`, `auction-watch-*.html`, `preseason-week-*.html` and `play-caller-premium.html`. Read these when your desk (below) calls for them.

## ROTATE THE DESK — this is required, not a preference
Compute `slot = floor(unix_epoch_seconds / 10800)` and `desk = DESKS[slot % 7]` where

    DESKS = [player, playcaller, vegas, preseason, injury, market, analyst]

Write for THAT desk this run. The point is that a reader checking twice a day gets different kinds of story, not six variations on market-versus-consensus. What each desk means:

- **player** — one player, or a tight group, priced wrong. The whole piece is about them.
- **playcaller** — a coaching or coordinator tendency and the players it moves. Ground the coaching landscape in `play-caller-premium.html` and the repo; do not repeat a coach that column already covered this week.
- **vegas** — where the sportsbook and the consensus sheet disagree, and what to do about it.
- **preseason** — what actually happened in preseason games and camp: snap counts, series with the ones, target share, goal-line work. Web-search to confirm; also read the newest `auction-watch-*.html` and `preseason-week-*.html`.
- **injury** — a current injury or return-to-play situation and the exact price move it justifies, for the injured player AND for whoever absorbs the work. Every injury claim must be confirmed by web search this run and cited. Never assert an injury from memory.
- **market** — structure: positional repricing, clustering, replacement level, roster construction, budget allocation.
- **analyst** — where the most-followed fantasy analysts sit versus the consensus sheet, and where that lands next to Iron Tuna's price. **You cannot read their boards directly. fantasylife.com and espn.com are both blocked by the egress proxy, and their paid ranking sets are not ours to republish anyway.** So take the analyst's side from WebSearch result content attributed to a reputable outlet: one specific, dated position per analyst (a rank, a round, a stated take), quoted only as far as the argument needs. Secondary coverage of a blocked outlet is fine when it is reputable, dated and quotes a specific position; that is how Field Yates' ESPN top 160 reached the column. Never reconstruct a ranking list, never publish more of anyone's ranking set than the point requires, and never state an analyst's position from memory. Compute Iron Tuna's side off the board this run, as every other desk does, so only one of the two sides is a claim about what somebody said and that side carries a citation. "Above consensus" means above the committed `PROJECTIONS` baseline, not above Iron Tuna, whose shipped values are already blended toward the market. Then MAKE THE CALL: say whether the desk agrees or disagrees with each analyst and why, in the site's own terms (usage, play-caller history, the odds, replacement level). A run that lists three takes without picking a side has written an aggregator post and failed. This desk is a running story, so read the prior rows (`SELECT slug,title,dek,players,calls FROM lead_story WHERE category = 'analyst' AND verified = 1 ORDER BY created_at DESC LIMIT 6`) and continue that thread: revisit a call news has moved, and do not re-run the same analyst-player pairing while nothing has changed. **If you do revisit a pairing the column has already scored, you must either reach the same verdict or say explicitly what changed to move it. The record table is cumulative, so two entries scoring one pairing both ways makes the column look like it cannot keep its own story straight.** If you cannot verify a single dated position this run, skip to the next desk and say so. An unsourced claim on this desk puts words in a real person's mouth, so it is the one desk where publishing nothing is clearly better than publishing something thin. **Two required sections below govern this desk: "Spread the calls across analysts" and "The analyst desk's calls column." Read both before writing.**

If your desk genuinely has no verifiable material this run (common for `injury` and `preseason` out of season), move to the NEXT desk in the list and say in your report which desk you skipped and why. Do not force a thin story to fill a slot, and do not silently fall back to `market` every time.

Store the desk you actually wrote for in the `category` column, lowercase, exactly one of: `player`, `playcaller`, `vegas`, `preseason`, `injury`, `market`, `analyst`. The site maps that to the label on the card and ignores anything else.

## Spread the calls across analysts
ANALYST RUNS ONLY.

The column is called Analysts vs. Iron Tuna, plural. The first entry took six of its eight calls from a single CBS risers-and-fallers column, which is the easy failure: one aggregated piece is the fastest thing to find, and mining it produces a column that is really "this desk versus one writer."

The rule:
- **At least three different analysts per entry, and no single analyst more than half the calls.**
- **Search per analyst, not per article.** Run a separate search for each name you intend to quote. Do not build an entry by mining one risers/fallers roundup for six players.
- **Check the running record first.** From the prior-rows query above, count how many calls each analyst already has across past entries, and prefer analysts the column is thin on. If one name is running away with the record, go find somebody else this run.

Names worth searching, not an exclusive list: **Matthew Berry** (Fantasy Life, also NBC Sports and podcast appearances), **Mike Clay** (ESPN), Jamey Eisenberg and Dave Richard (CBS Sports), Field Yates (ESPN), Sal Vetri, Pat Fitzmaurice, JJ Zachariason, Hayden Winks, Derek Brown, Andy Holloway and Mike Wright (Fantasy Footballers). Berry and Clay are the two the site most wants represented; Clay has not appeared yet, so make a real attempt at him. Yates reached the column through On3's coverage of his ESPN list, so a blocked outlet is not a dead end.

**The escape hatch, and it overrides the quota.** If you can only source two analysts this run, write an entry with two. If you can only source one, write fewer calls and say so in your report. **Never manufacture, infer, or half-remember a position to satisfy the spread.** Three well-sourced calls across three analysts is a better entry than eight from one column, and both are better than one invented attribution. The quota is a research instruction, never a licence to fill a slot.

## The analyst desk's calls column
ANALYST RUNS ONLY. Leave `calls` NULL on every other desk.

`body_html` is the prose. `calls` is the same story as structured data, and it is what the standing column at `/analyst-desk` lays out as cards and tallies into a per-analyst record of where this desk has agreed and disagreed. A JSON array, one object per call, up to 8:

```json
[{"analyst":"Mike Clay","outlet":"ESPN","player":"Kenneth Walker III",
  "pos":"RB","team":"KC","their":"RB7 in his August PPR board",
  "ours":"$24 max bid, RB14","stance":"disagree",
  "why":"Vegas has Kansas City fifth in implied points but spreads the scoring around."}]
```

Rules, because the page cannot fix a bad one at read time:
- `stance` must be exactly `agree`, `disagree` or `partial`. Any other word renders the call with no verdict and scores it in no column.
- `analyst` and `player` are both required. A call missing either is dropped entirely, which is the desk's own rule made structural: this column may not show a take with nobody attached to it.
- Spell each analyst's name the same way every time. The record table groups by name, so "Matthew Berry" and "Matt Berry" would split into two rows for one person.
- `their` is the analyst's position as you sourced it, `ours` is the site's number including the dollar figure. Both should be short enough to read on one line of a card.
- Be consistent about how you translate a draft round into dollars. The two contradictory entries of 2026-08-21 disagreed on nothing except whether $24 at WR17 was a late second or a fourth-round buy. If you convert rounds to dollars, state the conversion in the method line so the next run can match it.
- `why` is one sentence of the desk's own reasoning. It is the part a reader cannot get from anywhere else.
- Only include a call the story actually makes. This is the summary of the piece, not a list of everyone it mentions.

One exception, and it is a real one rather than an excuse: an analyst-desk story about **track records** rather than about a player's price has no "they say $X, we say $Y" to score. If that is genuinely the piece you wrote, leave `calls` NULL and say so in your report. It will list on the column by headline and feed nothing into the record table, which is correct. Do not manufacture player calls to fill the field.

Getting this wrong costs the cards and the record table while the entry still lists by headline, so nothing will visibly fail in your own run. Check the JSON parses before you insert it.

## BE CURRENT
The story should read as written today. Lead with the freshest thing you can verify: today's odds refresh, this week's camp and preseason news, a transaction or injury confirmed this run. State the timestamp of the data you used in the body, not only in the method line. A piece that would have read identically last Tuesday is a weak run even when every number in it is right.

## THE OUTPUT MUST BE ACTIONABLE AT THE PLAYER LEVEL
This is the single most important requirement. Directional and team-level findings are only the setup. Every story must land on **named players with numbers a drafter can act on**:
- A named player, with position and team.
- A specific auction dollar figure (max bid) and/or a specific positional-rank or round move.
- Both the current/consensus number and the number you are arguing for, so the delta is explicit.

A story that says "Team X's offense is underpriced" and stops is a failed run. It has to say "Player Y, WR, Team X: the consensus sheet says $25, bid up to $33, WR13 to WR8."

**Position matters and the effect is usually not uniform.** The same team-level or market-level signal lands differently on QB, RB, WR and TE. Always break the finding out by position and say so explicitly when a signal that helps a team's quarterback does little for its running back. That asymmetry is often the most useful part of the story.

## The auction model (use this so figures are comparable run to run)
12 teams, $200 budget, **full PPR** (1.0 per reception, backs included), 1QB/2RB/3WR/1TE/1FLEX, $2 per team reserved for K and DST.

**Full PPR, not half, as of 2026-08-22.** This model is the site's own default league (`DEFAULT_LEAGUE_CONFIG` in `index.html`, mirrored in `it-league.js`), and it was half PPR here while the site shipped full PPR everywhere else. That made every "the sheet says $26" in a story a number the reader's own cheat sheet disagreed with, for no reason either of them could see. Figures from before that date were written at half PPR and are not directly comparable for pass-catching backs and slot receivers; say so if you compare against one.

Price pool QB 14, RB 42, WR 54, TE 14. Value over replacement, replacement = last player in each position pool, dollars distributed proportional to positive VORP with a $1 floor. Build market-side projections by overlaying the odds payload onto the baseline, replacing passing/rushing/receiving yards and TDs where a line exists and holding `rec` at baseline (the market does not price receptions). Scoring: passYd/25, passTD*4, passInt*-2, rushYd/10, rushTD*6, recYd/10, recTD*6, rec*1.0, fumLost*-2. If you deviate from this model, say so in the method line.

## Hard rules
1. Never invent a number. Every figure must trace to data you queried this run or a page you fetched this run. If you cannot verify it, cut the sentence.
2. Do not assert NFL news, transactions, injuries, or depth-chart changes from memory. Web-search to confirm anything of that kind and cite it. Team labels inside `PROJECTIONS` are that dataset's labels, not verified news.
3. Read the last 8 rows (`SELECT slug,title,category,method FROM lead_story ORDER BY created_at DESC LIMIT 8`) and do not repeat a topic, a headline framing, or the same cast of named players.
4. State sample sizes, exclusions, and the scoring/auction assumptions in the method line.
5. Label dollar figures as max bids, not price predictions.
6. Never attribute a position, a ranking, or a quote to a named analyst or outlet without a source you pulled this run. This applies on every desk, not only `analyst`.

## The verification gate
Set `verified=1` only if every number in the body traces to a source you pulled this run. If anything is unverified, thin, or reasoned from memory, write the row with `verified=0` and `published=0`; it stays off the site until a human promotes it. Do not defeat this gate to get something published. Publishing nothing is an acceptable outcome.

## Writing style
Lead with the finding, not the setup. Plain, direct, confident sentences. No em dashes. No hedging filler. Short paragraphs.

### WRITE IT FOR A TENTH GRADER
This is the rule the site is judged on, because the headline and the dek are printed on the front page and most readers never get past them. **Aim at a tenth-grade reading level.** The test is not a score out of a formula. It is this: a smart sixteen-year-old who has played fantasy football for one season reads the line once, at full speed, on a phone, and knows what to do. If they would have to stop and work out what a word means, the line fails and you rewrite it.

What that means in practice:

- **One idea per sentence. No sentence over 25 words.** Find the longest sentence and count it. If it needs a comma to bolt a second finding on, it is two sentences.
- **At most three figures in any one sentence.** A fourth figure means the sentence is carrying two findings, so split it. The one exception is a plain list of player-and-price pairs, which is the part the reader came for: "Do not pay more than $12 for J.K. Dobbins or $13 for Jadarian Price; bid up to $33 on Tetairoa McMillan and $44 on Justin Jefferson" carries four figures and reads fine.
- **Never open on the process.** "Rebuild the auction board on today's odds refresh and ..." is what the run did. The reader came for what it found.
- **A number only helps next to the thing it changes.** "Replacement-level running back jumps from 126.20 points to 137.66" is a fact about the model. "The cheapest running back worth starting is 9% better than yesterday, so the middle of the position is worth less" is the same fact about the reader's draft. Write the second one.
- **Every dollar figure is an instruction.** "Fade J.K. Dobbins to $12" states a price and leaves the reader to work out what to do with it. "Do not pay more than $12 for J.K. Dobbins" is the instruction, and "bid up to $33 on Tetairoa McMillan" is the same rule in the other direction.

### The words this desk may not use
Every term below is in-house shorthand. It is clear to the model that wrote it and to nobody in the room. **Do not use the left column in the title, the dek, `body_html`, `method` or a `calls.why`.** Say the right column instead, and say it the first time, not the second.

| Do not write | Write |
|---|---|
| the book, the books | Vegas, or the betting market, or the sportsbook odds |
| the sheet | the consensus sheet (the ranking most sites publish) |
| the floor, replacement level, replacement-level RB | the cheapest running back worth starting |
| a bare tier, the cheap tier, the top tier | name the ranks: "backs ranked 25 to 42", "the top six backs" |
| lift, strips, guts, lands on, moves off | plain verbs: gets better by, takes away, moves to |
| VORP, value over replacement | what a player is worth above the cheapest starter |
| fade | do not pay more than |
| the room | the other managers in your draft |
| chalk, ADP arb, leverage, spike week | say the thing itself, in words a stranger reads once |

This is not an exclusive list. The test governs: if a phrase is one this desk says to itself, it is shorthand, and the plain version ships instead. The one exception is a term the story then defines in the same sentence, and you get one of those per story, not four.

Two more that are not jargon but read like it:

- **A percentage with no dollars attached.** "The tier loses 23.5% of its value" is arithmetic. "Backs ranked 25 to 42 lose about a quarter of their value, which is $4 to $6 off each of them" is the same fact a drafter can spend.
- **A word borrowed from the model.** "Pool", "curve", "overlay", "baseline" and "delta" all mean something exact here and nothing at all on a phone.

All of this governs `body_html` as much as the title and the dek. The story is where a reader who clicked in gets the reasoning, not where the shorthand is allowed back.

### Clock times are Eastern
**Never print "UTC" or "GMT" in the title, dek, body, method or sources.** Nobody drafting keeps a UTC clock. The audience is American fantasy managers whose kickoffs, waiver deadlines and league nights are all quoted in Eastern, and a reader who has to convert an hour before they can judge whether your data is fresh will not convert it.

Write every clock time as Eastern and label it `ET`: "today's 7:00 AM ET odds refresh", not "today's 11:00 UTC odds refresh". Eastern is UTC-4 from the second Sunday in March to the first Sunday in November and UTC-5 the rest of the year, so the 11:00 UTC refresh is 7:00 AM ET in season and 6:00 AM ET in winter. Convert it yourself before you write it. Slugs still carry the UTC hour (`short-topic-YYYY-MM-DD-HH`) because they are not prose and readers do not parse them.

The site converts any UTC time that reaches the table anyway (`leadClock` in `_worker.js`), so a slip is caught rather than published. Do not treat that as permission to keep writing UTC: the filter cannot fix "today's 01:00 run", which is last night in Eastern.

### Say whose league the dollars are
Every price you print is a price in ONE league, the model below, and the site restates it for each reader: `it-league.js` re-anchors each dollar figure on what the named player costs on that reader's own board, at their scoring, budget and league size. That only works if your figures are the model's and nothing else.

- State the league the numbers are for, once, in the body or the method line: "at 12 teams, $200, full PPR".
- Never write "your league", "your budget" or "your sheet". You do not know what the reader plays. The page adds that line itself.
- Keep a dollar figure next to the player it belongs to. "Cap Drake London at $29, Garrett Wilson at $26" is restated correctly; "the three of them are $29, $26 and $26" is not, because nothing connects the figures to the names.
- Percentages of a budget are true in every league and never get restated, so use one where the point is a share of the budget rather than a price.

`body_html` is an HTML fragment only: no `<html>`/`<head>`/`<body>` wrapper, no inline styles. Open with `<p class="lead">`. Use `<h3>` for section breaks and `<table class="lead-table">` for the named-player bid lists, which should carry player, current number, recommended number, and rank move. Do not wrap tables in a scroller; the page adds one. Close with `<p class="method">` only if you want a short in-body note, since the full `method` column is rendered in its own box below the article.

## THE HEADLINE IS AN INSTRUCTION, NOT A SUMMARY
The title is rendered at display size on the front page and is the one line most readers will ever see. Most of them are reading it minutes before a draft, on a phone, with a bid clock running. So the headline's job is not to describe the story. It is to tell one person one thing to do.

**The shape.** `<Player>: <verb> <number>` or `<Verb> <Player> <number>`, with the old number when it fits:

> Bid Zay Flowers to $32, not the $26 on the consensus sheet
> Cap Trey McBride at $18: the odds cut the tight end pool 7%
> Pass on Jeremiyah Love at $41; he is a $24 back until the Cowboys game says otherwise

**Every headline must carry all four of these. Check them one at a time on the exact string you are about to store, immediately before the INSERT, and rewrite until all four pass.**

1. **A verb the reader can perform in the room.** Bid, cap, pay, pass, wait, draft, target, nominate. Not "fade", which is one of the banned words below; "pass on" and "cap" say it in plain English. Not "moves", "leads", "gains", "sits" - those are things that happened, and a reader cannot do them. The test: read the headline aloud and answer "so what do I do?" in five words. If you cannot, it is a summary and it fails.
2. **A named player, first or nearly first.** A team, an offense, a coordinator or an analyst is never the subject of the headline, however good the story is - the player they move is. A market-structure piece may use a named position tier ("the top six tight ends") in place of a player, and must still name a player in the dek.
3. **A number that is a price or a pick.** A max bid in dollars, or a round or positional rank. Give the number you are arguing for, and the number it replaces where both fit: "$32, not $26" beats "up 23%". Never a percentage on its own: a percentage is not a bid.
4. **Words a stranger reads at full speed.** No desk shorthand, and nothing from the banned-words table in "The words this desk may not use" above. "the sheet" and "the book" are what we call things in here; write "the consensus sheet" and "Vegas" the first time. Read the finished line as a tenth grader would: one pass, at full speed, no stopping to decode a word. Never use a person's name without saying who they are - "ESPN's Field Yates", not "Field Yates" - and never a name at all unless it is an NFL player or an analyst with their outlet attached. If a reader has to already know something to parse the line, it is not a headline.

**Then the mechanical checks, which have all failed at least once in production:**

5. **Count the characters. Under 90.** Literally count them; do not estimate. The limit used to be 110 and the long ones were all the same failure: a second thought bolted onto a first. A title of 114 shipped on 2026-08-22.
6. **No em dash.** Search the string for one. Use a colon, a semicolon, or two sentences' worth of thought compressed into one.
7. **One sentence.** If it has a full stop in the middle, the second half belongs in the dek.
8. **No "UTC".** Clock times in a headline are Eastern or they are absent. See "Clock times are Eastern".

**And the finding test, which is what all of this is in service of.** Would this headline read exactly the same if the analysis had come out the other way? If yes, it is the setup, not the finding. "Five seasons produced five different winners, which is what luck looks like" describes the null result the piece starts from. "Kevin English has beaten the field average ten years running" is the finding - but it is still not a headline, because it names a stranger, states no price and asks the reader to do nothing. The version that ships is the one that says what to do about it.

## CHECK THE DEK BEFORE YOU INSERT
The `dek` carries the elaboration and the numbers, in 2 or 3 short sentences, and the front-page card prints it directly under the title. It is the paragraph most readers judge the site on, so it gets its own checklist, run on the exact string immediately before the INSERT.

1. **It leads with the finding**, like the headline, and with the player and the price rather than the data pull. "Baltimore is Vegas's top-ranked offense at 26.8 implied points" is a fact about a refresh; "Flowers is a $32 buy because Vegas now prices Baltimore as the league's best offense" is the same fact doing some work.
2. **No sentence over 25 words.** Find the longest one and count it.
3. **No more than three figures in any one sentence**, with the player-and-price list the one exception.
4. **Nothing from the banned-words table**, and nothing else a stranger would have to stop and decode.
5. **Every price reads as an instruction** a drafter can act on without translating it first.

This dek shipped on 2026-08-22 and failed 2, 3 and 4 in its opening sentence:

> Rebuild the auction board on today's odds refresh and replacement-level running back jumps from 126.20 half-PPR points to 137.66, a 9.1% lift that strips 23.5% off the RB25 to RB42 tier while the top six backs lose only 3.6%.

Forty-five words, five figures, four pieces of shorthand, and it opens on the run's own process. The same finding, written for the reader:

> Cheap running backs got better today, which makes the middle of the position worth less. Backs ranked 25 to 42 lose 23.5% of their value while the top six lose only 3.6%. The $83 that comes off running back moves to receivers and to the top six quarterbacks.

Nothing was cut to get there except the shorthand. Every number a reader can act on survives.

## Insert
```sql
INSERT INTO lead_story (slug,title,dek,body_html,method,sources,category,players,calls,verified,published,created_at,published_at)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,<0 or 1>,<0 or 1>,
        CAST(strftime('%s','now') AS INTEGER)*1000,
        CAST(strftime('%s','now') AS INTEGER)*1000);
```
`players` (?8) is a JSON array of the full names of up to 4 players the story actually commits to, most important first, e.g. `["Brock Bowers","Trey McBride"]`. The front page uses it to put their faces on the lead, so list only players the story makes a call on, never a name mentioned in passing. `calls` (?9) is the array above on an analyst run and NULL on every other desk.

**Run this INSERT once.** See "ONE STORY PER RUN" at the top.

Then retire the prior story: `UPDATE lead_story SET published=0 WHERE id <> last_insert_rowid();` (run as a separate statement, and only if the new row published with `verified=1`). Slug format: short-topic-slug-YYYY-MM-DD-HH. `sources` is a JSON array of `{type,name,detail}`. Pass all text through bound parameters, never string concatenation.

## Check your own work, but do not hang on it
Verify through the **Cloudflare D1 connector**, not the website: `SELECT id,slug,category,verified,published,length(title) AS tlen,calls IS NOT NULL AS has_calls FROM lead_story ORDER BY created_at DESC LIMIT 2`. Confirm your row is the desk you intended, `verified=1`, `published=1`, `tlen` under 90, and that the previous row is now `published=0`. On an analyst run, confirm `has_calls=1` unless you deliberately left it NULL for a track-record piece. **This check is read-only. If it shows something you wish you had written differently, report it; do not write another story.**

**Do not block on a WebFetch to irontuna.com.** This Routine has no pre-approved tool list, so a WebFetch can sit waiting on a permission prompt that nobody will answer, and a run on 2026-08-21 stalled there after it had already published. If you want the site check, attempt it once; if it is denied, blocked, or does not return promptly, fall back to the D1 query above and finish. Never end a run parked on a permission request.

## Report back
Finish with a short summary: the desk you wrote for (and any desk you skipped, with the reason), the headline with its character count, the dek's longest sentence in words, confirmation that title, dek and body carry nothing from the banned-words table, whether it published or was held, the named players and dollar figures you landed on, and anything that blocked you. On an analyst run, list the analysts you quoted with a call count each, say how the verdicts broke down between agree, disagree and partial, and name any analyst you tried to source and could not.