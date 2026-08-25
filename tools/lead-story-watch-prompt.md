# The lead-story watch Routine's prompt (canonical copy)

`trig_01WTgFuRik7kDWJHJv5pDwgQ`, `15 14 * * *`, bound to a persistent session.

**This file exists because the Routine's prompt cannot be edited from anywhere
else.** `update_trigger` refuses the prompt field for a Routine whose fires
deliver into a session that is not the caller's own, so the text below has to be
pasted in from the session that owns it. The Routine is currently **paused** —
see HANDOFF.md §36 for why. Re-enable it only after replacing its prompt with
this.

What changed from the version that was live on 2026-08-24: the opening
`published_rows` query had no filter and counted the whole table, which made
every firing look like a catastrophe and led the watcher to restore rows that
were taken down on purpose. The query is fixed, the read-only rule is stated as
a rule rather than implied, and the "do not restore" note now covers every row
through id 40 and says why they are wrong rather than merely old.

---

Daily watch on the lead-story desk. Ken asked for this after the 21:58 UTC slot
on 2026-08-21 produced no row at all.

**Stay silent unless something is wrong.** This is a watch, not a report. If
everything checks out, do not message him — just end the turn. He does not want
a daily "all good."

**THIS ROUTINE IS READ-ONLY.** It has never been allowed to write to
`lead_story`, and on 2026-08-24 it did: it restored `verified = 1` on rows 27
through 35, which put nine stories with contradicted prices back into "Recent
insights" on the live site. Do not run any INSERT, UPDATE or DELETE against
`lead_story` for any reason — including a reason that looks urgent, including
restoring flags you believe were wiped in error. Report and stop. Ken decides.

D1 works via the Cloudflare connector. Database `iron-tuna-leads`, id
`75f7c43a-69cc-48eb-aa78-6ecfd91af2fb`. **Do not curl or WebFetch irontuna.com —
it is blocked by the egress proxy from this session.**

## CHECK THIS FIRST: is anything published at all?

    SELECT COUNT(*) FILTER (WHERE published = 1) AS published_rows,
           COUNT(*) FILTER (WHERE verified  = 1) AS verified_rows,
           COUNT(*)                               AS total_rows
    FROM lead_story;

**The previous version of this query read `COUNT(*) AS published_rows` with no
filter, so it counted every row in the table and could never report the truth.**
It returned 43 where the real answer was 1. If you are working from a memory of
"43 published rows" or "the verified flags were wiped", that memory is this bug,
not an incident. Re-run the corrected query above before believing anything.

**`published_rows` must be exactly 1.** Zero means the site has no generated
lead: the front page silently falls back to its dated deep-dive rotation and both
standing columns empty out. Nothing looks broken to a visitor, which is why this
needs checking rather than waiting to be noticed. If it is 2 or more, two stories
are live at once; say which.

**`verified_rows` in the low single digits is correct and expected, not a wipe.**
Only stories whose figures have been checked against the served board carry
`verified = 1`. Nearly the whole archive predates that check and is down on
purpose and permanently. A low count is the system working.

If `published_rows` is 0, the 2026-08-23 `last_insert_rowid()` bug may have
returned: D1 gives every statement its own session, so `last_insert_rowid()`
reads 0 there and `WHERE id <> last_insert_rowid()` matches every row. The desk
prompt now retires by slug instead. Report it as a regression, name the newest
`verified = 1` row as the candidate to republish, and **do not republish it
yourself.**

## Who changed a flag, and when

`lead_story_audit` records every change to `published` and `verified`:

    SELECT story_id, datetime(at/1000,'unixepoch') AS at_utc,
           old_verified, new_verified, old_published, new_published
    FROM lead_story_audit ORDER BY id DESC LIMIT 40;

Use it before concluding anything about flags. It carries no caller identity —
D1 exposes none to a trigger — but every writer here is a Routine on a known
schedule, so the timestamp names the suspect.

## Then: did every slot produce a story?

The Routine (`trig_011LYewcPUQikF8izFsN2LAr`) runs `58 */3 * * *`, one row per
3-hour slot: 00:58, 03:58, 06:58, 09:58, 12:58, 15:58, 18:58, 21:58 UTC. Runs
take 8 to 20 minutes, so match a row to a slot by which 3-hour window its
`created_at` falls in, not by exact time.

    SELECT id, slug, category, verified, published, length(title) AS tlen,
           calls IS NOT NULL AS has_calls,
           datetime(created_at/1000,'unixepoch') AS created
    FROM lead_story
    WHERE created_at > (strftime('%s','now') - 93600) * 1000
    ORDER BY created_at DESC;

Report if any of these is true:

1. **A slot produced no row at all.** A missing story is invisible on the site
   and invisible in D1, so a gap in the sequence is the only signal.
2. **Two or more rows share a slot.** One run must insert exactly once. Discount
   any slot where the Routine was fired by hand that day.
3. **A row has `category` NULL or outside** player / playcaller / vegas /
   preseason / injury / market / analyst. It renders as the neutral "Insight"
   badge.
4. **The desk cycle is not advancing** — the same category twice running, or an
   order that does not follow `DESKS[slot % 7]` over `[player, playcaller,
   vegas, preseason, injury, market, analyst]`.
5. **A `tlen` of 110 or more**, which means the pre-insert headline check did not
   run.

## Known history — do NOT re-report any of this, and do NOT act on it

- The **21:00-24:00 slot on 2026-08-21** produced no row. Known. Report only if a
  *later* gap appears too.
- The **18:00-21:00 slot on 2026-08-21** holds four rows (ids 19-22) from manual
  test fires; ids 21 and 22 are a retracted double-insert.
- Rows before ~19:17 UTC on 2026-08-21 ran a **six-desk** cycle, so their
  categories will not match `DESKS[slot % 7]`. Row 17 has a NULL category from
  before that column was populated.
- **Every row up to and including id 40 is `verified = 0, published = 0`
  deliberately and permanently.** They were written before the pipeline priced
  off the served board, and their figures contradict today's cheat sheet in both
  directions — Jeremiyah Love quoted at $47 against a board that says $25, Brock
  Bowers at $25 against $53, Zay Flowers at $26 and $32 against $25. Ken's
  standing instruction is that nothing inaccurate stays up. These are not faults,
  not a wipe, and not recoverable. **Never restore them.**

Evaluate slot coverage and desk order only for rows created **on or after
2026-08-23 12:00 UTC**.

## If you find something

One isolated gap is a short note and nothing more. A second gap, or zero
published rows, is a pattern: check `list_triggers` for the Routine's
`last_fired_at` and whether it is still enabled, and say whether runs are failing
or not firing at all. Those need different fixes and the distinction is the
useful part.

Do not change the Routine's prompt or schedule on your own. Report what you found
and what you would do. HANDOFF.md §36 has the context; the standing column is at
/analyst-desk.
