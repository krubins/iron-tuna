# DFS metrics: what each number is and how it is computed

Every metric the DFS lens prints is computed in `dfsMetrics()` in `_worker.js`
and carries a `basis`. None of them is a feed. The salaries are the lobby CSV
the operator exported (see `docs/data-sources.md` §13.3); everything else is
derived from the Iron Tuna week board at the site's own scoring rules.

| Metric | Definition | Notes |
|---|---|---|
| **Projection** | `ironTunaPoints`: the Iron Tuna blend (consensus moved toward the market by confidence, plus the usage role nudge once three games exist) scored under the site's rules (`SCORING_SITE.dk` / `.fd`). | The market side (`vegasPoints`) and the consensus (`consensusPoints`) ride alongside so the reader can see which side is doing the work. |
| **Operator FPPG** | Historical fantasy points per game supplied in the operator salary file (`AvgPointsPerGame` on DraftKings, `FPPG` on FanDuel). | This is not a forward projection. DFS surfaces show it beside Iron Tuna's projection, plus `projectionVsFppg = ironTunaPoints − operatorFppg`, so the user can see where the model materially differs from the historical baseline. |
| **Value** | Iron Tuna points per $1,000 of salary, indexed to the slate median. 100 is an ordinary dollar; 130 is a bargain; 80 is a tax. | The legacy `vegasValueScore` (market points per $1K) is still on the row. |
| **Floor** | `projection × positional floor factor × confidence factor`. Floor factors: QB 0.62, RB 0.55, WR 0.45, TE 0.45, DST 0.40, K 0.50. Confidence factor 1.00 / 0.92 / 0.84 for HIGH / MEDIUM / LOW market confidence. | A first-cut variance model, not a distribution. The projection engine does not yet produce percentiles; when it does, floor and ceiling should become the 20th and 85th percentiles. |
| **Ceiling** | `projection × positional ceiling factor × (2 − confidence factor)`. Ceiling factors: QB 1.55, RB 1.75, WR 1.95, TE 1.90, DST 2.10, K 1.60. | Wider for the positions whose scoring is spikier (touchdown-dependent receivers, defenses). |
| **Ownership** | **Modeled**, version 1. `z = 2.2·(value/100 − 1) − 1.4·(salary rank within position, 0 at the top to 1 at the bottom) + (TD probability − 30)/60`; ownership `= 42 · logistic(z)`, in percent. | No licensed feed of projected ownership exists on this site, so this is a model of how the field prices value and salary tier, scaled so a slate's skill positions sum to roughly a full roster. Every surface prints `ownershipBasis: modeled`. Replace with a feed when one is licensed. |
| **Leverage** | `ceiling ÷ ownership`. Ceiling points per point of expected ownership. | High leverage is a high-ceiling player the field is under-rostering. Chalk with a low ceiling has the least leverage. |
| **Cash score** | Floor per $1K, indexed to the slate median projection-per-$1K, ×100. | Floor and price only; ownership does not matter in a cash game. |
| **Tournament score** | Ceiling per $1K, indexed to the median, ×100, then multiplied by an ownership factor `clamp(12 ÷ ownership, 0.6, 1.6)`. | Ceiling, price and ownership together. A 12% owned player is scored at par; 6% at 1.6×; 24% at 0.6×. |
| **Chalk** | `good chalk` when ownership ≥ 20% and value ≥ 105; `bad chalk` when ownership ≥ 20% and value < 105. | "Chalk" is a statement about ownership; good and bad is a statement about price. |
| **Stack score** | For each game side: QB plus the two best-projected pass catchers' market points, indexed to the slate's best stack (100). | From `buildDfsStacks()`; the bring-back is the other side's top catcher. |

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
