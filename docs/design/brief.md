# Iron Tuna design brief

One page, written before the build. The post-build critique is at the end.

## Subject

Iron Tuna prices every NFL player off the betting market first and the
projection consensus second, then restates the number at the reader's own
league scoring. A visitor looks up a player, reads this week's rankings,
start/sit calls, waiver prices, trade values and DFS lineups, and reads what
the desk published about the week.

## Audience

Season-long fantasy managers and DFS players. They read sportsbook lines,
implied totals, projection tables and salary boards fluently, and they decide
in numbers. They do not need to be told what fantasy football is, and they
stop reading the moment a page sounds like a pitch.

## Primary job

Get a visitor to a current number for a player or a position in one click,
and show why that number differs from the consensus. Everything else on the
site exists to support that one move.

## What a generic default would produce for this brief, and what was removed

| The default | What it looked like here | Removed by |
|---|---|---|
| Off-white or cream page ground with a radial glow | `body` radial gradient in site.css; teal halo filter on the wordmark | Paper white ground, flat navy band, no filters |
| White rounded cards floating on a gradient with soft shadows | hover shadows and lifts on cards, lanes and story tiles; gradient "boast" cards | Hairline rules and whitespace do the grouping; the only enclosed surfaces are forms, ledgers and the sticky panel |
| Pill buttons | 999px chips, pill action rows, rounded "Customize My League" | Squared buttons at 2 to 4px; the search field is the one pill, and it is a field |
| Italic accent words | "Vegas has money on theirs" set in italic | Removed; the sentence stands in roman |
| Uppercase tracked eyebrow over every heading | `.is-eyebrow`, `.hm-promo-k`, `.nr-kicker`, monospace section numbers | Sentence-case labels at 13 or 14px, no tracking |
| Numbered section chips | `.is-sec-n`, the "1 2 3" discs in How it works | Removed; the three inputs are three outlined cards with a heading each |
| Icon tiles beside feature text | none shipped, none added | n/a |
| Monospace labels | `--font-mono` eyebrows, ranks, plate heads | One family, Geist, with tabular figures |
| Badges, ribbons, countdowns, "people viewing" | "N live" chip in the week dateline, gold "held" flags | Live state stays as a word in the figure row; no pulsing chips |
| A hero photograph with a dark fade and a rotating cover | the hour-by-hour cover rotation and the game photograph plate | A centered headline, one sentence, a search field, three entry points and a row of live market figures |
| A second navigation system in the hero | the seven-link quick strip and the eleven lane links | Three entry points as text links; the lane pages carry their own tools |
| A metal gradient wordmark on a near-black band | seven-stop gradient wordmark on #0b1614 | Navy wordmark on a white panel that starts at the screen edge and ends in an 18px slant |
| Things that move on their own | hover translateY, hourly cover turns, scroll-behavior smooth | Hover changes a background or border only; reduced motion respected |

## Mapping the spec's roles onto Iron Tuna

- **Categories** are the six positions (QB, RB, WR, TE, K, DEF). Each tile is
  a link to that position's weekly rankings page and carries one line of live
  data: how many players the board ranks and how many carry a market line.
- **The one "good" figure** is a positive market edge in points: the market
  projecting more than the consensus. Green #0A6A4C on paper, mint #9FE0C4 on
  navy. A negative gap is set in ink; the word (Sit, Fade, Downgrade) carries
  the meaning, never the color.
- **The required disclosure label** (amber) marks a figure that is an estimate
  or a snapshot: the odds timestamp line under the market row.
- **The key figure** on a market row is the gap in points; on a tile, the count
  of ranked players; on a ledger row, the figure column the row exists for.
- **Sign in and the account button.** The site has no in-season account door:
  the only sign-in lives inside the draft app, and the product decided in
  September 2026 not to show it on the content pages. The header's right side
  is therefore the one primary action, Customize My League. The classes for a
  sign-in link and an account button are in site.css for when the in-season
  subscription ships; no markup is generated for them.

## Post-build critique

Rendered at 1440 x 900 and 390 x 844 with the feeds answering and with every
feed refusing (tools/test-homepage.mjs drives both; the screenshots came from
the same harness).

**What holds.** The page reads as a ledger: one headline, one sentence, the
field, three links, a hairline, four figures. The tiles are the only colour on
the page and each carries a real count. The six desk rows scan as rows. The
navy band and the navy footer close the page without a third surface. At 390
the ribbon is the logo and Menu, the figures stack one per row, the tile row
scrolls edge to edge with the first tile on the gutter, and nothing scrolls
sideways.

**What was wrong on the first render, and fixed.** A duplicated `<style>` tag
swallowed the page's own palette, so the headline rendered at 16px; the tile
row collapsed to zero height on a phone because the flex item was the link
and not the list item; the snapped tile row scrolled 16px past its own
gutter until `scroll-padding-inline` matched it.

**The accessory removed.** The KPI band had four figures. The fourth, teams
on the board, is 32 every week of the regular season: a constant dressed as a
figure. It is gone, and the band is three figures that change.

**Still open.**
- The draft app (index.html) keeps its dark palette. It is a tool worked in
  on draft night, not a page read, and it is 1.4 MB of React this pass did
  not touch beyond the typeface. Bringing it onto paper is its own pass.
- The hand-written story and tool pages were swept mechanically (caps
  eyebrows, tracking, monospace, pills, drop shadows and gradients taken off
  at the rule level). Each should still be read on its own; a sweep cannot
  judge a layout.
  /fantasy and /dfs were read on 2026-10-10: the September scoreboard dress
  (navy nameplate, navy rail bars, tinted bands, coloured card rules, chips,
  4px corners) came off in favour of the homepage's materials. The pass is
  the block at the foot of the dress in site.css plus one block per page;
  the three-column shell and the table density stay.
  /fantasy was read again on 2026-10-11 (Ken: it still "looks very AI").
  The nameplate, the eyebrow, the two buttons, the numbered section labels,
  the four-card deck, the boxed empty states and the ten-card tool shelf
  came off. It now wears the homepage's composition: the centred hero with
  the search field and text-link entry points, the six position tiles over
  the weekly ledger, outlined cards only where a live sentence has to sit,
  the lane's four illustrated tool tiles over a link index. The left rail
  stays and the player rail folded into it, so the shell is two columns.
- The player card's search box keeps the page's own 42px field. It should
  become the shared 52px field when that page is next touched.
