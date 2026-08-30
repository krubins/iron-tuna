<!--
THIS FILE IS THE CANONICAL COPY of the prompt run by the Claude Routine
"Iron Tuna - lead story refresh (every 6h)" (trig_011LYewcPUQikF8izFsN2LAr,
cron `58 */6 * * *`). The Routine holds the live copy; this is the version
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

This is not hypothetical. On 2026-08-21 one run inserted two stories seven minutes apart. The second retired the first, and because the run never re-read what it had just published, the two took opposite positions on the SAME player on identical numbers: one said buy, one said pass. Both went live and sat there contradicting each other until a human pulled one.

## Where things live
- Cloudflare connector, D1 database `iron-tuna-leads`, id `75f7c43a-69cc-48eb-aa78-6ecfd91af2fb`.
- Table `lead_story(id, slug, title, dek, body_html, method, sources, category, players, verified, published, created_at, published_at)`. The table still carries a `calls` column from the retired analyst desk; leave it NULL.
- Table `odds_overlay` holds row `id=1` whose `payload` is a JSON map of `"playername|POS"` to sportsbook-implied season projections (`passYd`, `passTD`, `rushYd`, `rushTD`, `recYd`, `recTD`), and row `id=2` (provider `teamctx`) with book-implied points per game and an implied-scoring rank for all 32 teams. Both refresh daily at about **7:00 AM ET** (11:00 on the server's UTC clock; 6:00 AM ET in winter). Check `updated_at` (epoch ms) and note staleness in the method line if it is more than 36 hours old. **Write that time as ET, never as UTC** - see "Clock times are Eastern" below.
- The consensus baseline projection set (~407 players, includes `rec`, `passInt`, `fumLost`) is embedded in the `iron-tuna` Worker as `var PROJECTIONS = [...]`. Retrieve it with the Cloudflare connector's `workers_get_worker_code` on script `iron-tuna`. The result is ~625 KB, so it will be written to a file; parse it there with a script rather than reading it into context. **This array is the COMMITTED baseline. It is NOT the board and it is NOT what the reader's cheat sheet shows.** Scoring it and ranking it gives you a board nobody on the site sees. You must blend today's odds into it first — see "BUILD THE BOARD LOCALLY" below — and a run that skips that step will print prices and ranks the reader's own sheet contradicts. This has now happened three times.
- The repo `krubins/iron-tuna` is the site's own record of the season: `auction-insights-*.html`, `auction-watch-*.html`, `preseason-week-*.html` and `play-caller-premium.html`. Read these when your desk (below) calls for them.

## LEAVE A HEARTBEAT. Do this FIRST, before anything else.

Between 2026-08-24 and 2026-08-25, **five of twelve runs ended without inserting anything.** The Routine fired every time — `last_fired_at` proves it — but no row appeared and no evidence of what went wrong survived. A rule was added telling you to insert a story row either way; it did not help, because the runs were dying before they ever reached that part of this brief. Nothing written near the end of a prompt can help a run that stops in the middle.

So the first thing you do, before reading the projections or anything else, is claim a row in `lead_story_run`:

```sql
INSERT INTO lead_story_run (run_key, slot, stage, started_at, updated_at)
VALUES (?1, ?2, 'start',
        CAST(strftime('%s','now') AS INTEGER)*1000,
        CAST(strftime('%s','now') AS INTEGER)*1000);
```

`run_key` (?1) is `<slot>-<the epoch-ms you just wrote>`, e.g. `165524-1787670736000`. It only has to be unique; it exists so you can update your own row and nobody else's. `slot` (?2) is the three-hour `slot` from the section below, not `deskSlot`. Keep the `run_key` string; you will reuse it.

Then update that one row as you pass each checkpoint:

```sql
UPDATE lead_story_run SET stage = ?2, note = ?3,
       updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
WHERE run_key = ?1;
```

The stages, in order. Use these exact words:

| `stage` | you have just finished |
|---|---|
| `start` | claimed this row; nothing else done yet |
| `board` | built the blended board and passed the blend self-test |
| `research` | gathered and confirmed the desk's material |
| `drafted` | written the story and run the headline and dek checks |
| `inserted` | the INSERT into `lead_story` returned; set `story_id` too |
| `done` | retire-by-slug and the read-back check are finished |

Set `desk` on the `board` update. Set `story_id` on the `inserted` update. Use `note` for the one thing a later reader would want: which desk you skipped and why, what you could not source, what the blend self-test showed.

**Two rules about this table, and they matter more than the table does:**

1. **A heartbeat must never stop the run.** If any of these statements fails, ignore it and carry on writing the story. This table is instrumentation. It has no authority over whether a story ships, and a run that abandons a good story because it could not write a log entry has done something much worse than not logging.
2. **It is not a substitute for the story row.** The verification gate still applies: when you decide not to publish, you still insert into `lead_story` with `verified=0, published=0` and the reason in `method`. The heartbeat says how far you got; the story row says what you decided. They answer different questions.

A run that dies leaves its row at the last stage it reached, which is the whole point. A slot with no `lead_story_run` row at all, on a Routine that fired, means the run died before its first statement — which is a different failure, in the session rather than the work, and worth knowing apart.

## ROTATE THE DESK — this is required, not a preference
Compute two numbers. `slot = floor(unix_epoch_seconds / 10800)` is the three-hour slot, and it is only an identifier: it goes in `run_key` and it is what the `lead_story_one_per_slot` trigger dedupes on. The desk comes off the **six-hour** grid, because this Routine fires every six hours:

    deskSlot = floor(unix_epoch_seconds / 21600)
    desk     = DESKS[deskSlot % 6]
    DESKS    = [player, playcaller, vegas, preseason, injury, market]

**Take the desk off `deskSlot`, never off `slot`.** They used to be the same number because there were seven desks and the run was every three hours. There are now six desks and the cron is `58 */6 * * *`, so `slot` advances by two each run: `slot % 6` would step 0, 2, 4, 0, 2, 4 and `playcaller`, `preseason` and `market` would never be written again. `deskSlot` advances by one and reaches all six.

Write for THAT desk this run. The point is that a reader checking twice a day gets different kinds of story, not six variations on market-versus-consensus. What each desk means:

- **player** — one player, or a tight group, priced wrong. The whole piece is about them.
- **playcaller** — a coaching or coordinator tendency and the players it moves. Ground the coaching landscape in `play-caller-premium.html` and the repo; do not repeat a coach that column already covered this week.
- **vegas** — where the sportsbook and the consensus sheet disagree, and what to do about it.
- **preseason** — what actually happened in preseason games and camp: snap counts, series with the ones, target share, goal-line work. Web-search to confirm; also read the newest `auction-watch-*.html` and `preseason-week-*.html`.
- **injury** — a current injury or return-to-play situation and the exact price move it justifies, for the injured player AND for whoever absorbs the work. Every injury claim must be confirmed by web search this run and cited. Never assert an injury from memory.
- **market** — structure: positional repricing, clustering, where a position's curve goes flat, roster construction, budget allocation.

If your desk genuinely has no verifiable material this run (common for `injury` and `preseason` out of season), move to the NEXT desk in the list and say in your report which desk you skipped and why. Do not force a thin story to fill a slot, and do not silently fall back to `market` every time.

Store the desk you actually wrote for in the `category` column, lowercase, exactly one of: `player`, `playcaller`, `vegas`, `preseason`, `injury`, `market`. The site maps that to the label on the card and ignores anything else.

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

Scoring: passYd/25, passTD*4, passInt*-2, rushYd/10, rushTD*6, recYd/10, recTD*6, rec*1.0, fumLost*-2.

### PRICE OFF THE CHEAT SHEET'S OWN CURVE, NOT VALUE OVER REPLACEMENT

**This changed on 2026-08-23 and it changes every dollar you print.** Until then this prompt told you to price by value over replacement. The site's cheat sheet does not price that way, so a story's number for a player and the sheet's number for the same player were two different answers to one question, and readers could see both at once. A reader wrote in: a story said bid $34 for Zay Flowers "not the sheet's $27" while the sheet on the same screen had him at $21.

**The site's valuation is the only valuation.** Compute a price exactly the way `/it-league.js` computes the cheat sheet:

1. Score every player in the projection set with the scoring above.
2. Sort by points **within each position**, best first.
3. That position rank IS the slot in the market curve. Read the curve value at that slot; past the end of the curve a player is $1.
4. Multiply by `(teams x budget) / 1440` and round, with a $1 floor. At this model's 12 teams and $200 that multiplier is 1.6667.

**Read the curve out of the repo this run — do not copy it from memory or from this prompt.** It is `CURVE` and `CURVE_BUDGET` in `it-league.js`, which mirror `LEAGUE_MARKET_CURVE` and `LEAGUE_CURVE_BUDGET` in `index.html`; `tools/test-it-league.mjs` fails the build if the two ever disagree, so either one is authoritative and neither can drift from the other. The static block inside `it-league.js` is a FALLBACK for readers whose browser cannot reach `/api/board`; it is generated from the committed projections and has not seen today's odds, so never verify a price against it.

There is no priced-pool cutoff and no replacement level any more. The curve's own length is the pool: a position rank past the last slot is a $1 player, which is the same statement replacement level used to make and the one the reader's board already makes.

**THERE IS ONE BOARD, AND THE ODDS ARE ALREADY IN IT.** This is the part that went wrong on 2026-08-23 even after the curve change, so read it twice.

The projections the app is served are NOT the committed `PROJECTIONS` array. The Worker blends today's odds into them before it serves them (`blendProjections`), at `VEGAS_WEIGHT = 3`:

    blended = (committed + 3 x market_implied) / 4

per stat, only where a line exists, and `rec` is never touched because the betting market does not price catches. **That blended set is the cheat sheet.** Score it, rank within position, read the curve: those are the dollars on the reader's screen.

So do not build a second, more aggressive board by replacing the stats outright. A run did exactly that and published "$38 for Derrick Henry" beside "$47 on the consensus sheet" for a back the reader's own sheet had at $25 and $38 respectively: the recommendation was right and the consensus figure was wrong, because the consensus figure came off the unblended committed array and nothing on the site prices players that way.

**BUILD THE BOARD LOCALLY. THIS IS THE PRIMARY METHOD, NOT THE FALLBACK.** Every run so far has found `/api/board` unreachable — direct fetches to irontuna.com are blocked from this environment and the fetcher returns a permission prompt with nobody present to answer it. That is the normal case, not a failure, and **it is never a reason to skip the slot or to publish nothing.** Reproduce the served board yourself, which takes one script and is exact:

1. Read `PROJECTIONS` and `VEGAS_WEIGHT` out of `_worker.js`.
2. Read the odds from D1: `SELECT payload, length(payload) FROM odds_overlay WHERE id = 1`. Confirm the payload you parsed has the same character count the query reports, so you know you read all of it.
3. Blend per the formula above, keying on the Worker's own `_oddsNorm(name) + '|' + position`, only for stats the player already has, skipping non-finite and negative values, rounding each to one decimal.
4. Score with the Worker's `_colScore`, sort within position, price with `_colPrice`.

That is `boardPayload` in `_worker.js` §9d run by hand, so it produces the served board by construction. Say in the method line that you computed it rather than read it, and give the overlay's `updated_at`.

**Prove to yourself the blend actually happened, before you price anything.** Two checks, both one line:

- `odds_overlay` **row `id = 1`** is the player odds. Row `id = 2` is team context and contains no player lines at all, so a run that reads only row 2 has not blended anything. On 2026-08-24 a run did exactly that and its method line said so in its own words.
- Score one heavily-lined player both ways and confirm the numbers differ. Chuba Hubbard is RB34 at $3 committed and RB28 at $5 blended. **If your two boards agree on him, your blend is not running, and every price you are about to print is off the wrong board.**

**Never validate your board against `DEFAULT_BOARD_RAW` in `it-league.js`.** That block is generated from the committed array and has never seen an odds refresh, so it will agree with an unblended board perfectly and tell you nothing. A run on 2026-08-24 reported "343 players overlap, 332 match to within 0.15 points, exact on all four" against it and published six figures the served board contradicts, including Jonathan Taylor at "RB4 and $55" where the sheet says RB5 and $50. Two wrong boards agreeing is not a check. The only valid check is your blended build against the served board.

**If you believe this brief tells you to price by value over replacement, you are reading a stale copy.** It has not said that since 2026-08-23. Re-read the section above and price off the curve; do not "deviate from the brief" to reach the curve, because the curve IS the brief.

`/api/board` returns the same thing as `{n, pos, v, pts}` rows where `v` is the Market Price. **Try it once**; if it answers, use it and say so, and treat any disagreement with your local build as a bug to report rather than a number to pick between. If it does not answer, move on without further attempts — do not spend the run on it, and do not let it stop you publishing.

What the odds move is then a RANK STORY, not a second price: "the odds have him RB8 rather than RB13" is the finding, and both dollar figures still come off the one board.

**Check every board price you print against that build before you insert** — not two of them, all of them. Take each "the consensus sheet says $X" and confirm it equals that player's price and position rank in the board you just built. If one does not match, your pricing is wrong and the story is wrong; fix it rather than publishing it. This is the check a run passed in the wrong direction on 2026-08-23 by verifying against `it-league.js`'s static block, which had not seen the odds — so name in the method line exactly what you verified against, including the overlay's `updated_at`, so the next run can tell which board you meant.

**And name the board's number for every dollar figure you print, not just the headline one.** If you tell the reader to bid $15 on a player the board prices at $10, say the board says $10 and say why you disagree. A recommendation that differs from the sheet is the whole point of the column; a recommendation that differs from the sheet *silently* is the bug this column has now shipped four times, because the reader has their own sheet open and it contradicts you with no explanation. This applies to secondary players and throwaway asides, not only to the player in the headline.

If you deviate from any of this, say so in the method line.

## Hard rules
1. Never invent a number. Every figure must trace to data you queried this run or a page you fetched this run. If you cannot verify it, cut the sentence.
2. Do not assert NFL news, transactions, injuries, or depth-chart changes from memory. Web-search to confirm anything of that kind and cite it. Team labels inside `PROJECTIONS` are that dataset's labels, not verified news.
3. Read the last 8 rows (`SELECT slug,title,category,method FROM lead_story ORDER BY created_at DESC LIMIT 8`) and do not repeat a topic, a headline framing, or the same cast of named players.
4. State sample sizes, exclusions, and the scoring/auction assumptions in the method line.
5. Label dollar figures as max bids, not price predictions.
6. Never attribute a position, a ranking, or a quote to a named analyst or outlet without a source you pulled this run.

## The verification gate
Set `verified=1` only if every number in the body traces to a source you pulled this run. If anything is unverified, thin, or reasoned from memory, write the row with `verified=0` and `published=0`; it stays off the site until a human promotes it. Do not defeat this gate to get something published. Publishing nothing is an acceptable outcome.

**But INSERT A ROW EITHER WAY. Ending the run with nothing in the table is not.** On 2026-08-24 three of six slots produced no row at all — 00:58, 09:58 and 15:58 — and a slot that writes nothing is invisible twice over: nothing on the site, and nothing in D1 to say the run happened or why it held back. So when you decide not to publish, still insert the row you have with `verified=0, published=0` and put the reason in `method` as the first line: what you could not verify, what you tried, what a later run should try instead. If you got far enough to have no story at all, insert a row whose `title` says so and whose `method` explains it. The empty slot is the one outcome that leaves no evidence, and the watch that used to catch it is paused.

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
Every term below is in-house shorthand. It is clear to the model that wrote it and to nobody in the room. **Do not use the left column in the title, the dek, `body_html` or `method`.** Say the right column instead, and say it the first time, not the second.

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
The `dek` carries the elaboration and the numbers, in 3 or 4 short sentences, and the front-page card prints it directly under the title. It was 2 or 3 until a dek that passed every other check needed a fourth sentence to keep a number: the cap is there to keep the card short, and four short sentences are shorter than three long ones. It is the paragraph most readers judge the site on, so it gets its own checklist, run on the exact string immediately before the INSERT.

1. **It leads with the finding**, like the headline, and with the player and the price rather than the data pull. "Baltimore is Vegas's top-ranked offense at 26.8 implied points" is a fact about a refresh; "Flowers is a $32 buy because Vegas now prices Baltimore as the league's best offense" is the same fact doing some work.
2. **No sentence over 25 words.** Find the longest one and count it.
3. **No more than three figures in any one sentence**, with the player-and-price list the one exception. A rank range reads as one figure, not two: "backs ranked 25 to 42" costs one.
4. **Nothing from the banned-words table**, and nothing else a stranger would have to stop and decode.
5. **Every price reads as an instruction** a drafter can act on without translating it first.

This dek shipped on 2026-08-22 and failed 2, 3 and 4 in its opening sentence:

> Rebuild the auction board on today's odds refresh and replacement-level running back jumps from 126.20 half-PPR points to 137.66, a 9.1% lift that strips 23.5% off the RB25 to RB42 tier while the top six backs lose only 3.6%.

Forty-five words, five figures, four pieces of shorthand, and it opens on the run's own process. The same finding, written for the reader:

> Cheap running backs got better today, which makes the middle of the position worth less. Backs ranked 25 to 42 lose 23.5% of their value. The top six lose only 3.6%, and the $83 that comes off running back moves to receivers and quarterbacks.

Nothing was cut to get there except the shorthand. Every number a reader can act on survives.

## Insert
```sql
INSERT INTO lead_story (slug,title,dek,body_html,method,sources,category,players,verified,published,created_at,published_at)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8,<0 or 1>,<0 or 1>,
        CAST(strftime('%s','now') AS INTEGER)*1000,
        CAST(strftime('%s','now') AS INTEGER)*1000);
```
`players` (?8) is a JSON array of the full names of up to 4 players the story actually commits to, most important first, e.g. `["Brock Bowers","Trey McBride"]`. The front page uses it to put their faces on the lead, so list only players the story makes a call on, never a name mentioned in passing.

**Run this INSERT once.** See "ONE STORY PER RUN" at the top.

Slug format: short-topic-slug-YYYY-MM-DD-HH. `sources` is a JSON array of `{type,name,detail}`. Pass all text through bound parameters, never string concatenation.

## RETIRE THE PRIOR STORY BY SLUG. NEVER USE `last_insert_rowid()`.
Only if your new row went in with `verified=1` and `published=1`, unpublish everything else by binding the slug you just wrote:

```sql
UPDATE lead_story SET published = 0 WHERE slug <> ?1;
```

**Retire `published` and nothing else.** Never put `verified` in that statement. `verified` is your own assertion about your own sourcing, it is the one flag nobody can reconstruct, and a retire that zeroes it across the table empties the archive silently. That happened on 2026-08-23 and again on 2026-08-24, and it took an audit trigger to work out who did it.

**Do not use `WHERE id <> last_insert_rowid()`, which is what this prompt said until 2026-08-23.** D1 gives every statement its own session, so in a separate statement `last_insert_rowid()` returns **0**. `id <> 0` matches every row in the table, so the retire unpublished the story the run had just published along with the entire archive, and the instruction to run it as a separate statement is exactly what made it fire wrong. Measured against the live database rather than inferred: a probe table returned `meta.last_row_id = 1` on the insert and `last_insert_rowid() = 0` in the following statement. The site ran with no generated lead at all for a day because of it, and nothing looked broken to a visitor, which is why it survived that long.

If you would rather use an id, read it back first with `SELECT id FROM lead_story WHERE slug = ?1` and use that literal number. Never rely on a rowid carrying across statements.

## Check your own work, but do not hang on it
Verify through the **Cloudflare D1 connector**, not the website:

```sql
SELECT id,slug,category,verified,published,length(title) AS tlen,
       (SELECT COUNT(*) FROM lead_story WHERE published=1) AS published_rows
FROM lead_story ORDER BY created_at DESC LIMIT 2;
```

Confirm your row is the desk you intended, `verified=1`, `published=1`, `tlen` under 90, that the previous row is now `published=0`, and that `published_rows` is exactly **1**. **If `published_rows` is 0, your retire statement hit your own row:** republish it with `UPDATE lead_story SET published = 1 WHERE slug = ?1` and say so in your report. That is a repair to the row you already wrote, not a second story. **This check is read-only. If it shows something you wish you had written differently, report it; do not write another story.**

**Do not block on a WebFetch to irontuna.com.** This Routine has no pre-approved tool list, so a WebFetch can sit waiting on a permission prompt that nobody will answer, and a run on 2026-08-21 stalled there after it had already published. If you want the site check, attempt it once; if it is denied, blocked, or does not return promptly, fall back to the D1 query above and finish. Never end a run parked on a permission request.

## Report back
Finish with a short summary: the desk you wrote for (and any desk you skipped, with the reason), the headline with its character count, the dek's longest sentence in words, confirmation that title, dek and body carry nothing from the banned-words table, whether it published or was held, the named players and dollar figures you landed on, and anything that blocked you.