#!/usr/bin/env node
// Prints the SQL for reading `lead_story_run`, the lead-story desk's heartbeat.
//   node tools/run-report.mjs            # the queries
//   node tools/run-report.mjs --slots    # adds the slot-coverage query
//
// WHY THIS TABLE EXISTS. Between 2026-08-24 and 2026-08-25 five of twelve runs
// ended without inserting a story. The Routine fired every time, so the failure
// was inside the run, but a run that dies leaves nothing behind and there was
// no way to tell a run that decided to hold back from one that crashed halfway.
// A prompt rule to "insert a row either way" did not help: the runs were dying
// before they reached it.
//
// So each run now claims a row in `lead_story_run` as its FIRST statement and
// updates `stage` as it goes. A run that dies leaves its row at the last stage
// it reached, and that is the diagnosis. The stages are, in order:
//   start -> board -> research -> drafted -> inserted -> done
//
// HOW TO READ IT.
//   `done`                 the run finished. Normal.
//   `inserted`             wrote the story, died during retire or read-back.
//                          Check `published_rows` is still exactly 1.
//   `drafted`              had a story and never wrote it. The most costly
//                          failure: the work was done and thrown away.
//   `research` / `board`   died mid-gathering. Usually time or a blocked fetch.
//   `start`                died almost immediately.
//   NO ROW AT ALL          the Routine fired but the run never ran a statement.
//                          That is a session or environment failure, not a
//                          content one, and it needs a different fix.
//
// This table is instrumentation and has no authority over anything. Nothing
// reads it at request time and no page renders it. It is safe to truncate.
const DB = '75f7c43a-69cc-48eb-aa78-6ecfd91af2fb';   // iron-tuna-leads

const RECENT = `
SELECT run_key, slot, desk, stage, story_id,
       datetime(started_at/1000,'unixepoch') AS started,
       (updated_at - started_at)/1000 AS secs,
       substr(note,1,80) AS note
FROM lead_story_run
ORDER BY started_at DESC
LIMIT 20;`;

// Where runs die, over the last week. A column that is not almost entirely
// `done` is the thing to chase.
const STAGES = `
SELECT stage, COUNT(*) AS runs,
       ROUND(AVG((updated_at - started_at)/1000.0)) AS avg_secs
FROM lead_story_run
WHERE started_at > (strftime('%s','now') - 604800) * 1000
GROUP BY stage
ORDER BY runs DESC;`;

// Runs that got a story written and lost it. These are worth reading one by one.
const LOST = `
SELECT run_key, slot, desk,
       datetime(started_at/1000,'unixepoch') AS started,
       (updated_at - started_at)/1000 AS secs, note
FROM lead_story_run
WHERE stage IN ('drafted','research','board','start')
ORDER BY started_at DESC
LIMIT 20;`;

// Did every slot leave a heartbeat? A slot missing from BOTH this table and
// lead_story, on a Routine that fired, is the session-level failure.
const SLOTS = `
SELECT r.slot,
       datetime(MIN(r.started_at)/1000,'unixepoch') AS started,
       GROUP_CONCAT(DISTINCT r.stage) AS stages,
       (SELECT GROUP_CONCAT(s.id) FROM lead_story s
         WHERE s.created_at/21600000 = MIN(r.started_at)/21600000) AS stories
FROM lead_story_run r
WHERE r.started_at > (strftime('%s','now') - 604800) * 1000
GROUP BY r.slot
ORDER BY r.slot DESC;`;

const out = [['Recent runs', RECENT], ['Where runs end', STAGES], ['Runs that never inserted', LOST]];
if (process.argv.includes('--slots')) out.push(['Slot coverage', SLOTS]);

console.log('lead_story_run — the lead-story desk heartbeat');
console.log('D1 database iron-tuna-leads, id ' + DB);
console.log('Run these through the Cloudflare D1 connector.\n');
for (const [title, sql] of out) console.log('── ' + title + ' ' + '─'.repeat(Math.max(0, 60 - title.length)) + sql + '\n');
