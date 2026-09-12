# Iron Tuna CBS Connector 0.2.0

This free browser import reads league settings, team names and rosters from the CBS football league you are signed in to. It replaces the failed 0.1.0 token-detection method. No CBS password, token, cookies or browser storage are copied to Iron Tuna.

## Install or update

1. Keep the extracted extension folder on your computer.
2. In Edge, open `edge://extensions`; in Chrome, open `chrome://extensions`.
3. For a new install, enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`. To update an existing installation after replacing its files, click **Reload** on the Iron Tuna CBS Connector card and check that it shows **0.2.0**.
4. Sign in at [My Leagues](https://irontuna.com/my-league) and leave it open.
5. In the same browser, open your CBS football league and sign in there.
6. Open the extension, confirm the season, then click **Import to Iron Tuna**. Keep the popup open while all team rosters are read.
7. Choose your team, click **Save my team**, and refresh My Leagues.

Run the extension again to refresh. There is no automatic background refresh. Disconnect in My Leagues to remove the imported league.

## Scope and privacy

Imports league name/count, roster slots, scoring, playoff start, team names, player identities and starter/bench slots. Scoring includes supported positional reception rates, thresholds, bonuses and kicker/defense ranges; unknown rules are preserved and labeled. The existing scoring engine uses fractional yardage. Confirm CBS rounding before relying on exact final-score parity.

Does not import standings, matchups, transactions or waiver balances. Confirm playoff team count and league type in Iron Tuna. This version supports the observed Active/Reserve roster layout and rejects IR or unrecognized footer layouts rather than dropping players.

Permissions are unchanged: temporary access to the CBS tab where you click the extension, plus the Iron Tuna website to use your existing sign-in. CBS reads are fixed same-origin GET requests. Only whitelisted table fields leave CBS; account identity rows, league passwords, messages and the constitution are excluded. A failed page or mismatched player count stops the import before submission.

## Validation status

The rendered live league pages were checked: all 12 teams and 204 player entries match their roster counts. Synthetic tests cover parsing, privacy exclusions, request restrictions, popup/team selection, scoring normalization, incomplete imports and idempotent refresh. The real extension request transport and final saved-league result still need validation after reloading 0.2.0 and deploying the server change. Do not present this as a completed live integration until that succeeds.
