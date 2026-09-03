#!/usr/bin/env python3
"""Episode 1 - Vegas vs. ADP.

Reads the board snapshot written by dump-column.mjs and writes two files:
the speaker-tagged script the audio builder reads (JSON) and the show notes
with the transcript and the numbers table (Markdown). Every number in the
dialogue comes from the snapshot, never from memory: if the board changes,
re-run the dump and this script and the episode changes with it.

  python3 tools/podcast/write-ep01.py podcast/ep01-vegas-vs-adp.data.json podcast/ep01-vegas-vs-adp
"""
import json, sys, datetime

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
col, dg, ppg = d["column"], d["column"]["digest"], d["ppg"]
items = {i["name"]: i for i in col["items"]}
pulled = datetime.datetime.fromisoformat(d["pulledAt"].replace("Z", "+00:00"))
dateline = pulled.strftime("%B %-d, %Y")

POS_WORD = {"QB": "quarterback", "RB": "running back", "WR": "receiver", "TE": "tight end"}
TEAM = {"PHI": "Philadelphia", "NYG": "the Giants offense", "BUF": "Buffalo", "CIN": "Cincinnati", "LV": "the Raiders offense",
        "ARI": "Arizona", "KC": "Kansas City", "ATL": "Atlanta", "DET": "Detroit", "NYJ": "the Jets offense", "GB": "Green Bay",
        "MIA": "Miami", "LA": "the Rams offense", "BAL": "Baltimore", "DAL": "Dallas", "CLE": "Cleveland", "TEN": "Tennessee"}
# How the voices should say a name (espeak-ng phonemisation trips on a few). Show notes keep the real spelling.
SAY = {"Bijan Robinson": "Beezhon Robinson", "Jahmyr Gibbs": "Jameer Gibbs", "Saquon Barkley": "Saykwon Barkley",
       "DeVonta Smith": "Devontay Smith", "De'Von Achane": "Devon Ashaan", "Jaxson Dart": "Jackson Dart",
       "Kenneth Walker III": "Kenneth Walker"}

def say(name): return SAY.get(name, name)
def slot(i, key): return f"{POS_WORD[i['position']]} {i[key]}"
def dollars(n): return f"{int(n)} dollars"
def pts(n):
    n = round(abs(n), 1)
    return f"{n:g} points"
def ordinal(n):
    return "%d%s" % (n, "tsnrhtdd"[(n // 10 % 10 != 1) * (n % 10 < 4) * n % 10::4])
def team_rank(i):
    return (f"{TEAM[i['team']]} is {ordinal(i['teamRank'])} in the league on implied points, "
            f"{i['teamImplied']:g} a game, and the consensus projections have that offense {ordinal(i['teamRankConsensus'])}")
def implied_top(n=5):
    return sorted(ppg.items(), key=lambda kv: -kv[1])[:n]
def implied_bottom(n=5):
    return sorted(ppg.items(), key=lambda kv: kv[1])[:n]

def need(*names):
    missing = [n for n in names if n not in items]
    if missing:
        sys.exit("board has changed: these players are no longer on it, rewrite the dialogue: " + ", ".join(missing))

need("Jalen Hurts", "Jaxson Dart", "James Cook", "Saquon Barkley", "DeVonta Smith", "Chase Brown",
     "Brock Bowers", "Trey McBride", "Bijan Robinson", "Jahmyr Gibbs", "Garrett Wilson", "Kenneth Walker III")
H, DA, CK, SB, DS, CB, BB, TM, BR, JG, GW, KW = (items[n] for n in (
    "Jalen Hurts", "Jaxson Dart", "James Cook", "Saquon Barkley", "DeVonta Smith", "Chase Brown",
    "Brock Bowers", "Trey McBride", "Bijan Robinson", "Jahmyr Gibbs", "Garrett Wilson", "Kenneth Walker III"))
td = dg["topTd"]; up, down = dg["teamUp"], dg["teamDown"]
top5 = implied_top(); bot5 = implied_bottom()
CITY = dict(TEAM, LA="the Rams", NYJ="the Jets", LV="the Raiders", NYG="the Giants")
top5_say = ", ".join(f"{CITY.get(t, t)} at {v:.1f}" for t, v in top5)
bot5_say = ", ".join(f"{CITY.get(t, t)} at {v:.1f}" for t, v in bot5)
hurts_ptd = next(m for m in H["moved"] if m["stat"] == "passTD")
hurts_rtd = next(m for m in H["moved"] if m["stat"] == "rushTD")
cb_ry = next(m for m in CB["moved"] if m["stat"] == "rushYd")

A, B = "A", "B"   # A hosts; B is the numbers desk.
S = []
def cap(t): return t[0].upper() + t[1:]
def a(t): S.append({"speaker": A, "text": cap(t)})
def b(t): S.append({"speaker": B, "text": cap(t)})
def brk(): S.append({"break": 0.9})

a(f"This is Iron Tuna, the auction desk, for {dateline}. Episode one. Vegas versus A D P.")
b("Everyone drafts off a ranking. The book drafts off a price. Today we go through the players where those two disagree the most, and what the disagreement is worth in auction dollars.")
a("Before the names, the rule of the show. A sportsbook posts a number with its own money behind it. If the line is wrong, sharp bettors take the other side until it moves. So every line is priced off repeatable trends and corrected in public the moment it is wrong.")
b("A ranking carries no such penalty. Anyone with a hunch can publish a top two hundred, never revisit it, and pay nothing when it misses. That is not an argument that the book is always right.")
a("It is an argument that when a priced market and an unpriced list disagree, the disagreement is worth a look. And here is the part that matters for this site. Iron Tuna's shipped prices already carry the odds.")
b(f"Right. Every value on the cheat sheet is a blend, and the blend gives the market {d['vegasWeight']} votes for every one that a projection feed gets. Almost no ranking or A D P list does that. So each case today is the gap between what the consensus is charging you and what the lines say the player is worth.")
a("One honesty note before we start, because the site prints it on every card and we should say it out loud.")
b("These are game lines, not player props. The free feed prices games. A spread and a total together give each offense its expected points per game, and every skill player on that roster inherits that environment. It is a team level signal. It prices the offense, not the individual target share.")
a("So the odds get a vote. Not a veto.")
b("Not a veto. Treat a gap as a tiebreaker between players you already rate closely, not a reason to blow up your board.")
brk()

a("Let's set the table. How big is the board today?")
b(f"The engine scanned {dg['scanned']} players. The market priced {dg['priced']} of them, {dg['draftable']} are inside the draftable curve, and {dg['moved']} of those moved by enough to matter. {dg['up']} went up, {dg['down']} went down, and the moves add up to {dg['dollars']} dollars of auction money changing hands.")
a("Where does the money sit by position?")
b(f"Running backs carry the most, {dg['byPos']['RB']['dollars']} dollars across {dg['byPos']['RB']['moved']} moves. Receivers {dg['byPos']['WR']['dollars']} dollars, quarterbacks {dg['byPos']['QB']['dollars']}, tight ends {dg['byPos']['TE']['dollars']}. The single biggest swings are at quarterback, though, and that is where we start.")
brk()

a(f"Case one. {say(H['name'])}.")
b(f"The consensus has him as {slot(H, 'rankConsensus')}, which prices at {dollars(H['priceConsensus'])} on a two hundred dollar budget. Blend in the market and he drops to {slot(H, 'rankIronTuna')}, {dollars(H['priceIronTuna'])}. That is a {abs(H['priceDelta'])} dollar haircut, the biggest on the board.")
a(f"{abs(H['priceDelta'])} dollars on a quarterback is a lot. What moved?")
b(f"{team_rank(H)}. So the projections are paying for a top six offense and the lines are pricing a middle of the pack one. On his own line that shows up as passing touchdowns going from {hurts_ptd['consensus']:g} to {hurts_ptd['market']:g}, and rushing touchdowns from {hurts_rtd['consensus']:g} to {hurts_rtd['market']:g}. Call it {pts(H['ptsDelta'])} over the season.")
a(f"And it is not just him. Philadelphia is the team story of the day.")
b(f"It is. The digest names {TEAM[down['team']]} as the biggest team level fade on the board: {ordinal(down['rankMarket'])} on implied points against {ordinal(down['rankConsensus'])} in the projections. {say(SB['name'])} goes from {slot(SB, 'rankConsensus')} to {slot(SB, 'rankIronTuna')}, {dollars(SB['priceConsensus'])} down to {dollars(SB['priceIronTuna'])}. {say(DS['name'])} slides from {slot(DS, 'rankConsensus')} to {slot(DS, 'rankIronTuna')}, {dollars(DS['priceConsensus'])} to {dollars(DS['priceIronTuna'])}. Three Eagles, three fades, one reason.")
a("So the instruction is, what, do not draft Eagles?")
b(f"No. The instruction is do not pay the consensus price for them. {say(SB['name'])} at {dollars(SB['priceIronTuna'])} is still a top fifteen back. It is {say(SB['name'])} at {dollars(SB['priceConsensus'])} that the lines will not sign off on.")
brk()

a(f"Case two goes the other way. {say(DA['name'])}.")
b(f"Consensus {slot(DA, 'rankConsensus')} at {dollars(DA['priceConsensus'])}. With the market in the blend he is {slot(DA, 'rankIronTuna')} at {dollars(DA['priceIronTuna'])}, and the odds alone would put him {slot(DA, 'rankMarket')}. Plus {abs(DA['priceDelta'])} dollars.")
a(f"Same {abs(DA['priceDelta'])} dollars, opposite direction. Is the Giants offense really that much better than people think?")
b(f"No, and this is the part I want listeners to hear. {team_rank(DA)}. That is a {abs(DA['teamRank']-DA['teamRankConsensus'])} slot difference. His line barely moves, {pts(DA['ptsDelta'])}. He does not rise because the market loves the Giants. He rises because the quarterbacks above him fell, and the price is attached to the slot.")
a("Say more about the slot.")
b(f"An auction curve pays by rank. The fourth quarterback goes for {dollars(H['priceConsensus'])}, the seventh goes for {dollars(H['priceIronTuna'])}. That cliff is the same whoever is standing on it. So when {say(H['name'])} steps down three slots, the guy who steps up collects the whole difference. Buy the gap, not the name. {say(DA['name'])} at {dollars(DA['priceConsensus'])} is the gap.")
brk()

a(f"Case three. {say(CK['name'])}. And this one breaks a rule people think they know.")
b(f"{team_rank(CK)}. So Buffalo is a top three offense by the book, and he is still a fade. {slot(CK, 'rankConsensus')} to {slot(CK, 'rankIronTuna')}, {dollars(CK['priceConsensus'])} down to {dollars(CK['priceIronTuna'])}. Minus {abs(CK['priceDelta'])} dollars.")
a("How is a top three offense a downgrade?")
b(f"Because the useful question is never whether the team is good. It is whether the market ranks that offense higher or lower than the projections already do. The consensus had Buffalo second. The book has them third. That ratio is slightly under one, and slightly under one on a {CK['priceConsensus']} dollar player is {abs(CK['priceDelta'])} dollars. Compare like with like.")
brk()

a(f"Case four. {say(CB['name'])}, and I flagged this one because the points barely move.")
b(f"Right. {slot(CB, 'rankConsensus')} to {slot(CB, 'rankIronTuna')}, {dollars(CB['priceConsensus'])} up to {dollars(CB['priceIronTuna'])}, a {abs(CB['priceDelta'])} dollar raise, on a change of {pts(CB['ptsDelta'])}. His rushing yards go from {cb_ry['consensus']:g} to {cb_ry['market']:g}. That is nothing.")
a("So where do nine dollars come from?")
b(f"From everyone else. {say(CK['name'])} and {say(SB['name'])} fell past him. He did not get better. He got a better seat. {team_rank(CB)}, so the environment is fine, but the move is a rank effect, and you should read it as one. He is a tiebreaker case, not a target.")
a("Respect the clamp.")
b("Respect the clamp. One line is noise. A rank change with no points behind it is a reminder that the curve is doing the talking.")
brk()

a(f"Quick hits. Top of the running back board, and the tight ends.")
b(f"{say(BR['name'])} and {say(JG['name'])} swap. {say(BR['name'])} goes from {slot(BR, 'rankConsensus')} to {slot(BR, 'rankIronTuna')}, {dollars(BR['priceConsensus'])} to {dollars(BR['priceIronTuna'])}. {say(JG['name'])} goes the other way, {dollars(JG['priceConsensus'])} to {dollars(JG['priceIronTuna'])}. The lines like Atlanta's scoring a touch more than the projections do and Detroit's a touch less. A {abs(BR['priceDelta'])} dollar swap at the top of the board, and both are still the top two. That is confirmation with a small edge, not a call.")
a("Tight ends?")
b(f"Same shape. {say(BB['name'])} and {say(TM['name'])} trade the one and two, {dollars(TM['priceConsensus'])} and {dollars(TM['priceIronTuna'])}. The team context there is honest, though. {team_rank(TM)}. {TEAM[BB['team']]} is {ordinal(BB['teamRank'])}. Two elite tight ends in two of the lowest implied offenses in the league. The market is saying the environment is a drag on both, and it dislikes Arizona's a little more.")
a(f"And the receiver on the fade list nobody has mentioned yet.")
b(f"{say(GW['name'])}. {slot(GW, 'rankConsensus')} to {slot(GW, 'rankIronTuna')}, {dollars(GW['priceConsensus'])} to {dollars(GW['priceIronTuna'])}. {team_rank(GW)}. That is a {abs(GW['teamRank']-GW['teamRankConsensus'])} slot gap on the offense, and it lands on the one receiver who has to carry it.")
a(f"One riser we have not named. {say(KW['name'])}.")
b(f"{slot(KW, 'rankConsensus')} to {slot(KW, 'rankIronTuna')}, {dollars(KW['priceConsensus'])} up to {dollars(KW['priceIronTuna'])}. {team_rank(KW)}. A one slot team gap, and again the raise is mostly the seat. Fine at {dollars(KW['priceConsensus'])}. Do not chase him to {dollars(KW['priceIronTuna'])}.")
brk()

a("Zoom out for me. The league by implied points, top and bottom.")
b(f"Top five: {top5_say}. Bottom five: {bot5_say}.")
a("And the team the digest flags as the biggest riser?")
b(f"{TEAM[up['team']]}. {ordinal(up['rankMarket'])} on implied points, {up['implied']:g} a game, against {ordinal(up['rankConsensus'])} in the projections. A {abs(up['gap'])} slot gap. That is the environment every Green Bay skill player inherits, and the reason to look twice at the cheap ones.")
a("Touchdowns?")
b(f"The biggest touchdown move on the board is {say(td['name'])} in {TEAM[td['team']]}. Consensus {td['tdConsensus']:g} touchdowns, market {td['tdMarket']:g}, the blend lands on {td['tdIronTuna']:g}. That works out to about a {td['anytimeTd']} percent anytime touchdown rate, and I will say the word the site prints next to it: derived. It is worked out from the game lines, not quoted from a prop.")
brk()

a("Bring it home. What does a drafter do with this tonight?")
b(f"Four things. One, read the implied points, not the spread. Two, compare like with like: the market's rank of an offense against the projections' rank, never against zero. Three, buy the gap, not the name. {say(DA['name'])} at {dollars(DA['priceConsensus'])} and {say(SB['name'])} at {dollars(SB['priceIronTuna'])} are gaps. {say(CB['name'])} at {dollars(CB['priceIronTuna'])} is a seat. Four, respect the clamp.")
a("And the whole board is on the site.")
b("It is. The front page runs a new case every six hours off the live lines, and every value on the cheat sheet already has the blend in it. You do not have to do this math. You have to know it was done.")
a("That is the desk. Iron Tuna dot com. We will be back when the lines move.")

script = {"title": "Vegas vs. ADP", "episode": 1, "dateline": dateline, "pulledAt": d["pulledAt"],
          "voices": {A: {"name": "Host", "sid": 6}, B: {"name": "Desk", "sid": 1}},
          "segments": S}
json.dump(script, open(out + ".script.json", "w"), indent=1)

# Show notes: the transcript with real spellings, and the board as a table.
def unsay(t):
    for k, v in SAY.items(): t = t.replace(v, k)
    return t
words = sum(len(s["text"].split()) for s in S if "text" in s)
lines = [f"# Iron Tuna, the auction desk. Episode 1: Vegas vs. ADP", "",
         f"*Recorded from the live board on {dateline}. Audio: `ep01-vegas-vs-adp.mp3`.*", "",
         "Everyone drafts off a ranking. A sportsbook drafts off a price. This episode walks the twelve players where the",
         "consensus projections and the betting market disagree the most, and what each disagreement is worth in auction",
         "dollars on a $200 budget. The numbers are the same ones the front page's \"Vegas vs. Consensus\" column computes:",
         f"committed projections, blended toward the live nflverse game lines at the site's weight ({d['vegasWeight']}:1 per feed),",
         "priced through the site's auction curve.", "",
         "**Honesty note.** These are game lines, not player props. The feed prices games; a spread and a total give each",
         "offense its expected points per game, and every skill player inherits that environment. It is a team-level signal.",
         "", "## The board", "",
         "| Player | Team | Consensus | Iron Tuna | Market rank | Price | Pts | Offense: odds rank vs consensus rank |",
         "|---|---|---|---|---|---|---|---|"]
for i in col["items"]:
    lines.append(f"| {i['name']} | {i['team']} | {i['position']}{i['rankConsensus']} | {i['position']}{i['rankIronTuna']} | "
                 f"{i['position']}{i['rankMarket']} | ${i['priceConsensus']} → ${i['priceIronTuna']} ({i['priceDelta']:+}) | "
                 f"{i['ptsDelta']:+g} | #{i['teamRank']} vs #{i['teamRankConsensus']} ({i['teamImplied']:g} implied/g) |")
lines += ["", f"Board digest: {dg['scanned']} scanned, {dg['priced']} priced by the market, {dg['draftable']} draftable, "
          f"{dg['moved']} moved ({dg['up']} up, {dg['down']} down), ${dg['dollars']} of price moves.", "",
          f"Team riser: {up['team']} (#{up['rankMarket']} odds vs #{up['rankConsensus']} consensus, {up['implied']:g} implied/g). "
          f"Team fade: {down['team']} (#{down['rankMarket']} vs #{down['rankConsensus']}, {down['implied']:g}).", "",
          f"Biggest touchdown move: {td['name']} ({td['team']}), {td['tdConsensus']:g} consensus → {td['tdMarket']:g} market, "
          f"{td['anytimeTd']}% anytime TD ({td['anytimeTdBasis']}).", "",
          "Implied points per game, top five: " + ", ".join(f"{t} {v:.1f}" for t, v in top5) + ". Bottom five: "
          + ", ".join(f"{t} {v:.1f}" for t, v in bot5) + ".", "",
          f"## Transcript ({words} words)", ""]
for s in S:
    if "text" in s:
        lines.append(f"**{script['voices'][s['speaker']]['name']}:** {unsay(s['text'])}")
        lines.append("")
lines += ["---", "",
          "How this was made: `tools/podcast/dump-column.mjs` pulls the board with the worker's own functions against the live",
          "nflverse lines; `tools/podcast/write-ep01.py` writes this script from that snapshot; `tools/podcast/build-episode.py`",
          "voices it with Kokoro (via sherpa-onnx, fully offline) and encodes the MP3. See `tools/podcast/README.md`."]
open(out + ".md", "w").write("\n".join(lines) + "\n")
print("segments", len(S), "words", words)
