---
name: iron-tuna-recap
description: Write Iron Tuna post-game recaps into the irontuna.com lead_story rotation
  from Cloudflare D1 game_summaries rows, then publish the ones that verify clean. Use
  when asked to run recaps, check for uncovered final games, write up a week's games, or
  refresh the recap banner. Computes every statistic from the stored payload only.
---

# Iron Tuna post-game recap run

Write one recap per newly finished game into the lead_story rotation. Compute every
number from the stored payload. Never use memory, an outside box score, or a web search
for any statistic. The site holds no sports data licenses, so no figure may enter a
recap from anywhere but the game_summaries row it describes.

## Database

Cloudflare D1, name iron-tuna-leads, uuid 75f7c43a-69cc-48eb-aa78-6ecfd91af2fb. Use the
Cloudflare D1 MCP tool if connected, otherwise
`npx wrangler d1 execute iron-tuna-leads --remote --json --command "<sql>"`.

Pass values as bound parameters, never inlined into the SQL string. Recap bodies contain
single quotes, double quotes and HTML, and inlining them will corrupt a row.

Target table:

    lead_story (id INTEGER PK AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL,
    dek TEXT, body_html TEXT NOT NULL, method TEXT, sources TEXT, verified INTEGER
    NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0, created_at INTEGER
    NOT NULL, published_at INTEGER, category TEXT, players TEXT, calls TEXT)

Slug uniqueness is the concurrency guard. A scheduled cloud task runs this same job, so
two runs may overlap. Always check for an existing slug before inserting and never
UPDATE a row another run created.

## Step 1. Find finished games with no recap

    SELECT espn_id, game_id, week, payload FROM game_summaries WHERE final=1;
    SELECT slug FROM lead_story WHERE category='recap';

Slug format is recap-<away>-<home>-YYYY-MM-DD, lowercase. Away and home come from
game_id, so 2026_01_SF_LA gives recap-sf-la-. The date is the payload kickoff converted
to US Eastern.

Convert with a real IANA America/New_York conversion. Do not hardcode a UTC offset.
Eastern is UTC-4 through November 1, 2026 and UTC-5 after, and a fixed offset will
mis-date late-window games and create duplicate recaps under wrong dates.

Skip any game whose slug already exists. If every final game already has a recap, write
nothing and stop. A run that finds no new final games is a normal quiet run.

## Step 2. Compute the numbers

The payload carries, per player: pass {att,cmp,yd,td,int,sacked}, rush {att,yd,td},
rec {tgt,rec,yd,td}, fumLost, rzTouches, rzTargets, glCarries, position, and a tds array
of scoring play text. It also carries home and away scores, a defense block and an
injuries array.

Derive and check: team target total as the sum of tgt; target share as player tgt over
team total; running-back carry share as player rush att over the sum of rush att among
players with position RB, so quarterback scrambles are excluded and reported separately;
catch rate as rec over tgt; yards per target as rec yd over tgt; yards per attempt as
pass yd over pass att; team red-zone touches and team red-zone targets. Recompute each
figure rather than carrying one over.

Compute aggregates in SQL with json_each and window functions rather than by hand.

## Step 2a. Data defects you will hit

Disclose each one in the body and in method. Never smooth one over and never let one
produce an absurd published number.

1. `position` is null for many backs and some receivers. When the RB-only denominator is
   0 or 1 carry, the carry share is meaningless or divides by zero. Do not print it.
   Report raw carries plus share of all team rush attempts instead, and say why. When a
   real back is excluded from the denominator because position is null, give both the
   RB-only split and the all-carries split and say which to trust.
2. Some touchdowns have no entry in the scoring player's tds array. Report the touchdown
   from rec.td or rush.td and say the payload carries no scoring play text. Do not supply
   the play text from anywhere else.
3. rzTouches and glCarries sometimes read 0 for a player whose tds array shows a short
   rushing score. Name the inconsistency and treat that team's red-zone split as
   directional rather than settled.

## Step 2b. Scope filter

Site scope covers the top 50 RB/WR and top 32 QB/TE on current season-long rankings, not
preseason. Check whether this database holds a current rankings table and use it if so.

Name in the body only players inside that scope, plus any quarterback who started. A
player outside scope may be counted in a team total or a share but is not named and does
not go in the players array.

If you cannot establish current rankings from stored data, say so in method and write
each recap to the top five charted players per team by touches. Do not estimate rankings
from memory.

## Step 3. Write the recap

A headline stating the single most actionable fact, a dek of two or three sentences, and
a body in exactly three sections.

    <h3>1. What scored</h3>

Box score that produced fantasy points: passing, rushing and receiving yards, touchdowns
with the scoring play, receptions.

    <h3>2. What the opportunity says</h3>

Volume regardless of outcome: carries and carry share, targets and target share, touch
totals, backfield and target splits, anyone whose volume and production disagree.

    <h3>3. Next level</h3>

Tendencies and where usage is heading: red-zone and goal-line distribution, whether a
team throws or runs inside the 20, yards per target and per attempt, target
concentration, game-script effects that inflate or suppress a share, and injuries in the
payload that change next week's usage. Say plainly which numbers are repeatable and
which are one-game artifacts.

Tier three is deliberately backward-looking and box-score derived. The site's ranking
columns carry the Vegas lens; recaps do not. Do not wire an odds source into a recap
without being asked.

Formatting: `<p class="lead">` for the opening paragraph, `<h3>` for the three headers,
`<ul>`/`<li>` for items, `<strong>` around player names on first mention. Plain language,
main clause first, no em dashes.

The headline sits in a rotating banner above the hero, so keep the title at or under 65
characters. The dek carries the detail.

## Step 4. Insert

    INSERT INTO lead_story (slug,title,dek,body_html,method,sources,verified,published,
      created_at,category,players,calls)
    VALUES (?,?,?,?,?,?,1,0,CAST(? AS INTEGER),'recap',?,NULL)

created_at is the current time in milliseconds passed as a string.

players is a JSON array of the display names used in the body.

method is a short provenance block naming the game_summaries row, the sums computed, how
each rate was defined, how scope was determined, and any data defect disclosed.

sources is a JSON array of one object:

    [{"type":"database",
      "name":"Cloudflare D1 iron-tuna-leads, game_summaries row espn_id=<id>",
      "detail":"<game_id>, STATUS_FINAL, <n> charted players, kickoff <ms>. Queried this run."}]

## Step 5. Verify, publish, then re-check

Confirm each inserted row reads back with created_at stored as an integer, players
parsing as valid JSON, all three section headers present, and title at or under 65
characters.

Publish each verified row by setting published=1 and published_at equal to created_at.

Hold a row at published=0 when a defect from Step 2a prevented reporting a rate the
section requires, or when payload fields contradict each other. A missing scoring play
text is disclosed inline and does not hold publication. Report every held row and why.

Then re-run the Step 1 gap query. Games go final while a run is in progress, so a game
that was not final at the start may be final now. Write up anything new and take it
through the same verification and publish gate before finishing.

Report which games were written and published, which were held and why, which were
skipped as already covered, any game still showing final=0, and every data defect
disclosed.

Never invent a statistic. If the payload does not support a claim, leave it out.
