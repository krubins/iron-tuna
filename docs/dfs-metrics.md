# DFS metrics: what each number is and how it is computed

The contest scores and model metrics the DFS lens prints are computed in
`dfsMetrics()` in `_worker.js`. Salary and operator FPPG are source observations:
DraftKings supplies `AvgPointsPerGame` with its salary data and FanDuel supplies
`FPPG`. Iron Tuna stores that historical average unchanged, labels it as historical,
and shows it beside the forward-looking Iron Tuna projection. When the file carries no
average for a player, `dfsOperatorFppg()` computes one from his season box score in the
usage overlay at the site's scoring and the row says so (`operatorFppgBasis`). The other metrics are
derived from the Iron Tuna week board at the site's own scoring rules.

| Metric | Definition | Notes |
|---|---|---|
| **Projection** | `ironTunaPoints`: the Iron Tuna blend (consensus moved toward the market by confidence, plus the usage role nudge once three games exist) scored under the site's rules (`SCORING_SITE.dk` / `.fd`). | The market side (`vegasPoints`) and the consensus (`consensusPoints`) ride alongside so the reader can see which side is doing the work. |
| **Operator FPPG** | Historical fantasy points per game supplied in the operator salary file (`AvgPointsPerGame` on DraftKings, `FPPG` on FanDuel). | This is not a forward projection. DFS surfaces show it beside Iron Tuna's projection, plus `projectionVsFppg = ironTunaPoints − operatorFppg`, so the user can see where the model materially differs from the historical baseline. `operatorFppgBasis` is `operator` when the number came from the salary file and `computed` when the file had none and it was built from the nflverse season line (`season.stats ÷ season.games` under `SCORING_SITE`, without the per-game yardage bonuses the overlay cannot see); `operatorFppgGames` is the game count behind a computed figure. A defense with no operator number stays blank. Every surface marks a computed figure as an estimate. |
| **Value** | Iron Tuna points per $1,000 of salary, indexed to the slate median. 100 is an ordinary dollar; 130 is a bargain; 80 is a tax. | The legacy `vegasValueScore` (market points per $1K) is still on the row. |
| **Floor** | `projection × positional floor factor × confidence factor`. Floor factors: QB 0.62, RB 0.55, WR 0.45, TE 0.45, DST 0.40, K 0.50. Confidence factor 1.00 / 0.92 / 0.84 for HIGH / MEDIUM / LOW market confidence. | A first-cut variance model, not a distribution. The projection engine does not yet produce percentiles; when it does, floor and ceiling should become the 20th and 85th percentiles. |
| **Ceiling** | `projection × positional ceiling factor × (2 − confidence factor)`. Ceiling factors: QB 1.55, RB 1.75, WR 1.95, TE 1.90, DST 2.10, K 1.60. | Wider for the positions whose scoring is spikier (touchdown-dependent receivers, defenses). |
| **Ownership** | **Modeled**, version 1. `z = 2.2·(value/100 − 1) − 1.4·(salary rank within position, 0 at the top to 1 at the bottom) + (TD probability − 30)/60`; ownership `= 42 · logistic(z)`, in percent. | No licensed feed of projected ownership exists on this site, so this is a model of how the field prices value and salary tier, scaled so a slate's skill positions sum to roughly a full roster. Every surface prints `ownershipBasis: modeled`. Replace with a feed when one is licensed. |
| **Leverage** | `ceiling ÷ ownership`. Ceiling points per point of expected ownership. | High leverage is a high-ceiling player the field is under-rostering. Chalk with a low ceiling has the least leverage. |
| **Cash score** | Floor per $1K, indexed to the slate median projection-per-$1K, ×100. | Floor and price only; ownership does not matter in a cash game. |
| **Tournament score** | Ceiling per $1K, indexed to the median, ×100, then multiplied by an ownership factor `clamp(12 ÷ ownership, 0.6, 1.6)`. | Ceiling, price and ownership together. A 12% owned player is scored at par; 6% at 1.6×; 24% at 0.6×. |
| **Chalk** | `good chalk` when ownership ≥ 20% and value ≥ 105; `bad chalk` when ownership ≥ 20% and value < 105. | "Chalk" is a statement about ownership; good and bad is a statement about price. |
| **Typical entry** | What an ordinary entry on the slate projects for. Entries are DRAWN rather than averaged: seat by seat in a shuffled order, each seat taken by an eligible player with probability proportional to his modeled ownership, nobody twice, and nobody the remaining budget cannot afford once the other open seats are paid for. 4,000 draws off a fixed seed; the mean of the ones that fill a legal roster. Computed in `fieldAverage()` in `dfs-optimizer.js`. | This is the scale the lineup card prints in parentheses beside a build's projection, so a total has something to be measured against. **Whole rosters are drawn because a per-seat average is not a lineup**: an ownership-weighted mean of each seat prices every seat as if the other eight were free, and on the test fixture it returned a typical entry twenty points above the optimal lineup, which no legal roster can be. Every draw here is a roster somebody could submit, so their mean is below the best of them by construction. It is **not** an optimum, a cash line or a winning score, it inherits every limitation of the modeled ownership above, and the seed is fixed so an unchanged board prints the same number every solve. A reader's locks and exclusions do not enter it — they change his roster, not the field's. Players marked unavailable do come off. With no ownership on the board, no cap, a seat no available player can fill, or too few legal draws to average, it returns null and the page prints nothing. |
| **Stack score** | For each game side: QB plus the two best-projected pass catchers' market points, indexed to the slate's best stack (100). | From `buildDfsStacks()`; the bring-back is the other side's top catcher. |

## Where the lineup card's numbers say they came from

Every figure in the lineup card's stat row carries its own explanation, opened
by hovering it, tabbing to it or tapping it: a short account of what the number
is, and under a rule, the arithmetic that produced **that roster's** value
rather than a definition. The triggers are real buttons, so the explanation is
reachable without a mouse, and each tip is the button's sibling wired up with
`aria-describedby`, so a screen reader announces the figure as the control and
the explanation as its description.

| Figure | What its tip shows |
|---|---|
| DraftKings FPPG | That the operator average is history and not a forecast, plus the nine averages totalled. Says so plainly when a player has no average in the salary file and there is nothing to total. |
| Iron Tuna Projection | The consensus → market → Iron Tuna ladder at roster level, with how many of the nine the books actually priced. The ladder is printed only when every seat carries both sides. |
| Tuna Edge | The subtraction itself: projection minus operator average. |
| Salary used | The spend against the cap and what is left, with why leftover money is not waste. |

The typical entry in parentheses is the one figure with no tip. The paragraph
directly under the stat row already gives it in full sentences, including how
the draws are made and that the ownership behind them is modeled rather than
fed, so a tip would be a second copy of that to keep in step. The alternate
cards print the figure without repeating the paragraph; they sit under the lead
board, which a reader has already passed.

Two cascade hazards live in this row and are commented where they bite. The
site's own `.is-stat span` rule (site.css) paints **any** span inside a stat
tile as that tile's small uppercase caption, and `.is-board .is-stat span`
repaints it in the board's muted grey; both outrank an unscoped tooltip class,
so every selector for these tips is scoped under `.is-stat` and, for colour,
under `.is-board .is-stat`. The tip is anchored to the stat **tile** rather
than to the number, because the projection and its parenthetical wrap onto two
lines in a narrow column and a tip hung off the first number covers the second.

## Contest types

`/api/dfs?site=dk|fd&contest=cash|single|3max|gpp|showdown` returns the same
rows and the same numbers; `metrics.sortBy` and `metrics.note` say what the
contest emphasizes:

| Contest | Sort | Emphasis |
|---|---|---|
| Cash | cashScore | Floor and value first. Chalk is fine. |
| Single Entry | tournamentScore | One lineup: good chalk plus one or two leverage spots. |
| 3-Max | tournamentScore | Three lineups: spread the leverage, keep the core. |
| Large-Field GPP | leverage | Ceiling and ownership decide. Fade fragile chalk. |
| Showdown | tournamentScore | One game: captain choice and correlation. Showdown salaries are not loaded; the page says so. |

## What the market actually said about him

The Vegas column carries one number for two different things, and until now
nothing downstream could tell which it was holding.

For a player the books have priced, `vegasPoints` is his own quoted props —
receiving yards, receptions, a devigged anytime-touchdown price — run through
`vegasProjection()` and scored at the site's rules. That is a forecast of *him*,
made with money at stake, and it is the best weekly prediction this site has.
For a player nobody posted a prop on, it is the game total and spread split
across an offense and handed to him by his share of it: a forecast of his
*game*, with his name on it. Over seventeen weeks the difference washes out. On
one slate it is the difference between a read and a guess.

Every slate row now carries a `market` block from `dfsMarketRead()`:

| Field | What it is |
|---|---|
| `basis` | `props` → `props-partial` → `props+gamelines` → `gamelines` → `gamelines+ratings` → `ratings` → `none`. The board's own ladder, best first. |
| `quoted` | True when a book posted a prop on him this week. This is what the page's PROPS / LINES / FITTED chip reads. |
| `priced` / `pricedLabels` | The markets a book actually posted, so a surface can say *which* props, not just that there were some. |
| `books`, `ageHours` | How many books, and how old the pull is. |
| `shrink` | How far that number is trusted — **`BLEND_SHRINK`, the same ladder the season blend uses.** One definition for the whole site; a second copy here would let the slate and the board disagree about the same player. |
| `points` (`marketPoints`) | The market number after the shrink, pulled the rest of the way back toward the consensus projection. |
| `tdProbability`, `tdBooks`, `tdDevigged` | The anytime-touchdown price — the one prop that speaks directly to a slate — with its book count, and whether it was devigged. |

**The fallback is the consensus, never a fitted number wearing a Vegas label.**
`marketPoints = consensus + shrink × (market − consensus)`. A fully quoted
player keeps his whole market number (`shrink = 1`). A player priced only off
his game line keeps 80% of the distance. A fitted team rating keeps 55%. A
player with no market at all lands exactly on the consensus (`shrink = 0`).

### Priced, and still not projectable

A quote is not automatically a projection. `VEGAS_MARKETS` names a **core** per
position, and a market projection needs one of them before any price means
anything:

| Position | Core | With only an anytime-TD price |
|---|---|---|
| WR, TE | `recYd`, `rec` | no projection |
| QB | `passYd`, `passTD` | no projection |
| RB | `rushYd`, `anytimeTD` | partial — the TD price is half its core |

So a feed that posts an anytime-touchdown price on four hundred players and a
yardage line on none of them produces a very healthy-looking row count and
**zero** market projections for receivers, tight ends and quarterbacks. Those
players fall back to the game line, and `vegas.basis` never reaches `props`.

The row carries `market.shortOfProjection` for exactly that case, with
`shortPriced` / `shortMissing` naming what was posted and what was needed. The
coverage block counts them as `quotedButShort`, separately from `priced`, and
`dfsPropNote()` leads with it when it applies — because "the books ignored him"
and "the books quoted only his touchdown" are different facts with different
fixes, and they are indistinguishable unless something says so.

### Every posted prop counts, not only the ones that make a projection

Two things used to throw market information away:

1. **The anytime-touchdown price never reached a projection at all.** A board
   row is a stat line that is scored later; the touchdown price lived in its own
   block beside the line and never touched it. So the most widely posted prop in
   football moved no number anywhere, unless a book also hung a rushing- or
   receiving-touchdown *count* market on the same player, which is rare.

2. **A player with no core market had every one of his quoted prices
   discarded.** No yardage or reception line meant `no_core_market`, and the
   whole market read went in the bin — including a perfectly good touchdown
   price.

Now:

- `applyMarketTd()` scales a stat line's own touchdown components to the
  market's expectation, preserving the rush/receive split the market says
  nothing about. A quarterback's passing touchdowns are left alone, because an
  anytime price is about him crossing the line, not throwing it. A priced
  touchdown **count** still wins — a count carries the two-score games a binary
  cannot.
- A player with quoted markets but no core market gets basis
  **`gamelines+props`**: the game-line environment as the baseline, with every
  quoted market laid on top. `BLEND_SHRINK` rates it **0.85** — better grounded
  than a game line alone (0.8), short of a projection the market could have
  produced by itself (`props-partial`, 0.9).

The implied touchdown count is the price itself, matching what
`vegasProjection.points` already does with it. Both understate a player who can
score twice — P(at least one) is below E(count) — and they understate it
identically, which is the point: the two numbers sit side by side and must not
disagree about the same market.

On the slate, such a player reads `quoted: true` (the books priced him) with
`marketStandalone: false` (not a market read on his own).

### The Market read build

`mode: 'market'` ("Market read (props first)") maximizes `marketPoints`. The
older `vegas` mode maximizes the raw market number and cannot tell a quoted
prop from a sliced-up game total, so it will spend $7,000 on a curve fit that
happens to read high; `market` will not. On a week the books have not posted,
it degrades to the consensus build and the page says so rather than presenting
an inference as a market read.

Slate-level coverage is reported as a number, not a boolean:
`props: { players, priced, coverage, basis, markets, avgBooks, freshestHours }`,
with `dfsPropNote()` saying it in one sentence that every DFS surface prints —
including, when nothing is priced, what the build is standing on instead.

### Where the props come from

`odds_snapshots` ← the market snapshot job (PropLine via `PROPLINE_API_KEY`, or
SportsGameOdds, or The Odds API via `ODDS_API_KEY`) → `marketHistoryWeek()` →
`marketPropsFrom()` → `vegasProjection()` → the week board's `vegas.basis` →
the slate. **If no provider key is configured, no prop reaches the slate**, every
row reads `gamelines` or `ratings`, and every surface says so. That is a
configuration state, not a failure, and it is why the fallback is specified as
carefully as the primary path.

## Who is on the board at all

Every metric above assumes the player is going to be on the field. That is not
a safe assumption, and getting it wrong is more expensive than getting any of
the numbers above wrong: a ruled-out receiver at $5,800 is a certain zero
occupying 12% of the cap.

The season-long availability list cannot answer it. It is deliberately shaped
around a seventeen-game question and drops everything week-to-week — a
Questionable tag, or a plain "Out" with no return date, is not a change to a
season line (HANDOFF §48). So the slate asks four sources of its own, in this
order, and `weekStatusBasis` on every row says which one answered:

| Basis | Source | Catches |
|---|---|---|
| `injury-report` | The week's designations from the ESPN injury pull, kept as a second table beside the season list (`weekly` in overlay row 3). | Out, Doubtful, Questionable for this week. |
| `reserve-list` | The season availability list, read against the week number: `gamesOut` counts from Week 1, so four games out means Weeks 1–4. | IR, PUP, NFI, suspensions, the exempt list. |
| `roster` | Sleeper's player file (`buildSleeperRoster`), the same file `/api/live` and the depth-chart job already read. | The player who is not on an active roster at all — a practice-squad signing or a free agent appears on **no** injury report, because he is not hurt. |
| `salary-file` | FanDuel's `Injury Indicator` column. DraftKings' export has none. | Whatever the operator itself marked. |

`available: false` is the result, and it is what the optimizer reads: **Out and
Doubtful come off the board; Questionable stays on it**, printed, because that
call belongs to the reader. An unavailable player is also off the value boards,
the stacks, and the ownership model — he cannot take ownership share from a
player who is playing.

Two deliberate limits:

- **A lock overrules all of it.** `ITDfs.build` keeps a locked player in the
  pool whatever his status, and the page says so. The builder declines to make
  this call on its own; it does not overrule one the reader has already made.
- **A team change is flagged, not benched.** When the roster file has a player
  at a different club than the board does, he still plays — but the projection
  beside his name was built for another offense. The row carries
  `teamChanged` and `rosterTeam`, and the page prints it.

Every source fails soft. A missing injury pull, a missing roster file, or a
slate built with no week number leaves every player available, exactly as
before any of this existed. A missing feed must never empty a board.

## Play of the Week

`ITDfs.contestPick()` picks a rung on the payout curve — Head-to-Head,
Multiplier, single-entry tournament, multi-entry tournament — by comparing
three builds of the same slate (floor, ceiling, leverage).

What decides it is the gap between Iron Tuna's number for the ceiling roster
and **the market read for the same roster** (`marketPoints`, not raw
`vegasPoints`), together with how much ceiling the tournament and leverage
builds buy for how little median.

**The thresholds scale with how much of the roster the books actually priced.**
`need = 2 − coverage`: a fully quoted roster is taken at face value, one nobody
priced needs twice the gap. The reason is that on an unquoted slate the "market"
number is the game total split across an offense, which shares most of its
inputs with the projection it is being compared to — the two agreeing means
very little and the two disagreeing means less, and stepping up a payout curve
on it is taking real risk on two models arguing with each other.

| Rung | Edge required (fully quoted) | Also requires |
|---|---|---|
| Multiplier | 1.8% | tournament median ≥ 98.5% of cash |
| Tournament, single entry | 3.5% | tournament median ≥ 97% of cash, ceiling ≥ 107% |
| Tournament, multi-entry | 5.0% | leverage median ≥ 97% of cash, ceiling ≥ 110% |

The panel prints the evidence: how many picks the books priced, across how many
books, on which markets, and how many carry a quoted rather than derived
touchdown price — or says plainly that none of them were priced and the bar was
doubled for it.

### The bug it was born with

The recommendation summed per-player projections off `ironTunaPoints`, which is
not a field on a lineup player — the builder calls it `proj`. Every total was
zero, every threshold compared zero with zero, and **the answer was
Head-to-Head on every slate the site ever served.** The builder's own
`projPoints`, `floorPoints` and `ceilingPoints` were correct the whole time and
unused. `contestPick` reads those.

## What is deliberately not here

- No metric is invented for marketing. Each row above is used by the DFS lens
  of the desk's packages (`_dfsBlock()` in the research packet) and by the
  DFS page.
- Ownership is the one number that is a model rather than an observation, and
  it is labeled as such everywhere it appears. The desk's writer is told the
  same in the packet (`ownershipBasis: 'modeled'`).


## What If lineup anchor

The DFS lineup page carries the same What If idea as the auction cheat sheet. As the
reader types a player's name, matching players from the current salary slate appear
immediately underneath the field with position, team, salary and Iron Tuna projection.
Choosing a match fills the field and adds that player's key to the optimizer's `lock`
set. The optimizer then re-solves every remaining slot under the same contest preset,
salary cap, stacking rules and exclusions. Clearing What If removes only that anchor
and rebuilds the normal lineup.

The What If choice does not change any projection or metric. It changes only the
lineup constraint: "show me the best legal lineup if I insist on this player."
