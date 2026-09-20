# AI calculation boundary

Iron Tuna treats rankings, projections and DFS values as software outputs, not LLM opinions.

## Production rule

The numeric pipeline is:

1. Normalize source data.
2. Apply deterministic projection and betting-market formulas.
3. Score the resulting stat lines under the applicable league or DFS scoring rules.
4. Rank, value and optimize in code.
5. Give the completed facts to the newsroom model for interpretation and prose.

The same inputs must produce the same numeric outputs regardless of which language model is available.

## Code that owns the numbers

- `scoreStats`, `weeklyStats`, `buildBoards` and `boardsPayload` in `_worker.js` own fantasy scoring and ranking output.
- `buildDfsSlate`, `dfsMetrics`, `dfsStackScores` in `_worker.js` and `dfs-optimizer.js` own DFS projections, value, floor, ceiling, modeled ownership, leverage and lineup construction.
- `tools/vegas-to-projections.mjs` converts betting markets into projected statistics with explicit formulas.
- `tools/merge-projections.mjs` combines projection sources with explicit weights.
- The live Worker odds path performs the same class of transformations without an LLM.

An LLM may help retrieve or normalize a source in an offline maintenance workflow, but the source data must pass through these deterministic scripts before it becomes a projection or value. An LLM-generated number must never be written directly into a ranking, projection or DFS value field.

## What Claude may do

The automated newsroom may:

- compare precomputed values;
- explain differences among Consensus, Vegas and Iron Tuna;
- identify implications already present in the research packet;
- write headlines, summaries and recommendations grounded in that packet.

It may not:

- calculate a fantasy projection;
- calculate or change a rank;
- calculate DFS value, ownership, floor, ceiling or leverage;
- interpolate a missing number;
- override a deterministic output because the model disagrees with it.

The newsroom prompt states this rule explicitly and the fact checker continues to reject numeric claims that are not in the research packet.

## Interactive features

The Value Coach is the same rule in a chat panel. On the auction board (`index.html`) and on the DFS lineup (`dfs-coach.js`, mounted by `dfs.html`) it is handed the page's completed numbers as JSON and asked to explain them. It may compare them, say which one drove a decision, and answer general football questions from its own knowledge. It may not calculate, re-rank, interpolate or replace a projection, value, floor, ceiling, ownership, leverage or salary, and it may not supply a number the page does not carry. Both prompts state this explicitly.

Neither coach holds a metric of its own: the DFS panel transports what `dfs-optimizer.js` and `buildDfsSlate`/`dfsMetrics` produced and nothing else. Both reach the model through `/api/coach`, the server-side proxy, so no provider key reaches a browser.

The DFS panel carries the WHOLE eligible board, not only the rows the page printed. `slateBoard` is every priced player in the selected games that the solve could have used, grouped by position, one delimited line each (`name|team|opp|salary|proj|ceiling|own|value|status`) built by `coachBoard()` in `dfs.html`. It is transport, not a second metric: each cell is the same number `coachRow` would carry, rounded by `coachN` and nothing more, and a line that has no number for a column leaves it empty rather than filling it in. It exists because a reader asking for the best receiver at a given salary is asking about a player the recommendation never printed, and a coach that can only see the roster answers that by refusing. The prompt says the index is the complete pool, says which columns it carries and which it does not, and says that a name absent from it is out of the game pool or not playing — never that its number is unknown and could be estimated.

The DFS panel also answers before a roster exists, at the Game Style / Games / Payout Structure selects the page opens with. The same rule holds one step earlier: it is handed the page's own catalog of options (`GAME_STYLES`, `PAYOUTS` and the shape each one solves as, plus the games on the loaded slate with their posted totals) and recommends from that list. It may not invent a contest, a payout table, an entry fee, a field size, a prize pool or an entry limit, because the page carries none of those. Where it names which structure this slate rewards, it quotes `playOfTheWeek` — the page's own comparison of a floor build, a ceiling build and a leverage build — rather than producing a recommendation of its own. Picking a structure is strategy and is in scope; naming a stake is not, and the prompt says so.

## Model policy

`NEWSROOM_LLM_MODEL` is separate from the general `LLM_MODEL`. Production pins the newsroom to `claude-sonnet-4-6`.

This separation is deliberate. A future decision to use Opus for an interactive feature must not cause automated stories to start consuming Opus. Opus can be used manually to research or recalibrate a methodology, but once a methodology is adopted it belongs in deterministic code and tests.

## CI

`tools/test-ai-boundary.mjs` is run by GitHub Actions. It fails when:

- a provider or LLM call appears inside the ranking, projection or DFS numeric engines;
- (in `tools/test-dfs-coach.mjs`) the DFS Value Coach stops forbidding recomputation, starts carrying a metric of its own, reaches a provider directly, starts recommending contest structures from outside the page's own catalog, or stops carrying the whole eligible board (the board index is capped under budget pressure, never dropped, and `coachBoard()` is executed against a fixture so a line cannot start re-deriving what it prints);
- the newsroom stops passing an explicit editorial model;
- the newsroom prompt stops prohibiting numeric recomputation;
- the deployed newsroom model is changed from Sonnet to Opus.

Existing scoring, boards, market, DFS and optimizer tests continue to verify the formulas themselves.
