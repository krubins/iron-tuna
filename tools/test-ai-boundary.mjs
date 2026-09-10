#!/usr/bin/env node
// Regression guard for Iron Tuna's AI boundary.
//
// Site numbers must be reproducible software outputs:
//   raw/normalized data -> deterministic formulas -> rankings/DFS values
// The newsroom LLM may explain those numbers, but it may not calculate them.
// This is intentionally a source-level architecture test. If an LLM call moves
// into one of the numeric engines below, CI fails before the change deploys.
import fs from 'fs';

const read = p => fs.readFileSync(p, 'utf8');
const worker = read('_worker.js');
const dfsOptimizer = read('dfs-optimizer.js');
const merge = read('tools/merge-projections.mjs');
const vegas = read('tools/vegas-to-projections.mjs');
const wrangler = read('wrangler.jsonc');

let failed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); failed++; }
}
function section(src, start, end, label) {
  const a = src.indexOf(start);
  const b = a >= 0 ? src.indexOf(end, a + start.length) : -1;
  ok(a >= 0, label + ': start marker exists');
  ok(b > a, label + ': end marker exists');
  return a >= 0 && b > a ? src.slice(a, b) : '';
}
function noLlm(src, label) {
  const bad = [
    /llmText\s*\(/i,
    /api\.anthropic\.com/i,
    /api\.openai\.com/i,
    /chat\/completions/i,
    /v1\/messages/i
  ];
  for (const re of bad) ok(!re.test(src), label + ' contains no LLM/provider call: ' + re);
}

noLlm(section(worker, 'function scoreStats(', 'function tdPointsFor(', 'scoreStats'), 'scoreStats');
noLlm(section(worker, 'function buildBoards(', 'async function boardsContext(', 'buildBoards'), 'buildBoards');
noLlm(section(worker, 'function buildDfsSlate(', 'function buildDfsStacks(', 'buildDfsSlate'), 'buildDfsSlate');
noLlm(section(worker, 'function dfsMetrics(', 'function dfsStackScores(', 'dfsMetrics'), 'dfsMetrics');
noLlm(dfsOptimizer, 'dfs-optimizer.js');
noLlm(merge, 'merge-projections.mjs');
noLlm(vegas, 'vegas-to-projections.mjs');

const context = section(worker, 'async function contentContext(', '// Does a live piece want a new version?', 'contentContext');
ok(context.includes("boardsPayload(env, { horizon: 'week'"), 'contentContext receives deterministic ranking board');
ok(context.includes('buildDfsSlate('), 'contentContext builds DFS slate before writing');
ok(context.includes('dfsMetrics('), 'contentContext computes DFS metrics before writing');

const writer = section(worker, 'async function writeNewsroomPiece(', '// ── storage, tick, payloads', 'writeNewsroomPiece');
ok(writer.includes('const editorialModel = newsroomEditorialModel(env);'), 'newsroom selects its dedicated editorial model');
const calls = [...writer.matchAll(/llmText\(([^\n]+)\)/g)].map(m => m[1]);
ok(calls.length >= 1, 'newsroom has an LLM prose call');
ok(calls.every(c => /editorialModel\s*$/.test(c)), 'every newsroom LLM call uses the dedicated editorial model');

const legacyWriter = section(worker, 'async function writePiece(', '// -- the newsroom', 'legacy writePiece');
ok(legacyWriter.includes('const editorialModel = newsroomEditorialModel(env);'), 'legacy writer selects the dedicated editorial model');
const legacyCalls = [...legacyWriter.matchAll(/llmText\(([^\n]+)\)/g)].map(m => m[1]);
ok(legacyCalls.length >= 1, 'legacy writer has an LLM prose call');
ok(legacyCalls.every(c => /editorialModel\s*$/.test(c)), 'every legacy writer LLM call uses the dedicated editorial model');

const legacyPromptAt = worker.indexOf('const WRITER_SYSTEM = `');
const modernPromptAt = worker.indexOf('const NEWSROOM_SYSTEM = `');
const legacyPrompt = legacyPromptAt >= 0 ? worker.slice(legacyPromptAt, legacyPromptAt + 5000) : '';
const modernPrompt = modernPromptAt >= 0 ? worker.slice(modernPromptAt, modernPromptAt + 7000) : '';
ok(legacyPromptAt >= 0 && legacyPrompt.includes('Do not calculate, re-rank, interpolate, normalize, replace or override them.'), 'legacy writer prompt forbids recomputing numeric outputs');
ok(modernPromptAt >= 0 && modernPrompt.includes('Do not calculate, re-rank, interpolate, normalize, replace or override them.'), 'modern newsroom prompt forbids recomputing numeric outputs');

ok(worker.includes("const NEWSROOM_DEFAULT_MODEL = 'claude-sonnet-4-6';"), 'newsroom defaults to Sonnet');
ok(/"NEWSROOM_LLM_MODEL"\s*:\s*"claude-sonnet-[^"]+"/i.test(wrangler), 'deployed newsroom model is explicitly Sonnet');
ok(!/"NEWSROOM_LLM_MODEL"\s*:\s*"[^"]*opus/i.test(wrangler), 'deployed newsroom model is not Opus');

if (failed) process.exit(1);
console.log('AI calculation boundary OK');
