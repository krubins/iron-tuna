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

## Model policy

`NEWSROOM_LLM_MODEL` is separate from the general `LLM_MODEL`. Production pins the newsroom to `claude-sonnet-4-6`.

This separation is deliberate. A future decision to use Opus for an interactive feature must not cause automated stories to start consuming Opus. Opus can be used manually to research or recalibrate a methodology, but once a methodology is adopted it belongs in deterministic code and tests.

## CI

`tools/test-ai-boundary.mjs` is run by GitHub Actions. It fails when:

- a provider or LLM call appears inside the ranking, projection or DFS numeric engines;
- the newsroom stops passing an explicit editorial model;
- the newsroom prompt stops prohibiting numeric recomputation;
- the deployed newsroom model is changed from Sonnet to Opus.

Existing scoring, boards, market, DFS and optimizer tests continue to verify the formulas themselves.
