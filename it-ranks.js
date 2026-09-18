/* Iron Tuna — the rankings board behind /weekly-*-rankings and /season-long-*-rankings.
 *
 * ONE FILE, SIXTEEN PAGES. Every page in the rankings section is the same board
 * with a different horizon and a different position; the page carries those two
 * facts as data attributes on an empty <div> and this builds the rest.
 *
 *   <div data-rk-board
 *        data-rk-horizon="week|ros"   the /api/boards horizon
 *        data-rk-pos="QB|RB|…|FLEX|ALL"
 *        data-rk-weeks="0|1"          whether a row opens into the weeks ahead
 *        data-rk-label="This week">
 *
 * WHAT THE BOARD IS FOR. Two numbers on the same player, side by side, and the
 * argument between them:
 *
 *   FANTASY CONSENSUS  the projection consensus at the chosen scoring, nudged by
 *                      live usage once three games have earned it. No odds in it.
 *   BETTING ODDS       the same player off the sportsbook — his own posted props
 *                      where a book has quoted them, else the posted game line's
 *                      scoring environment applied to his line, else a fitted
 *                      team rating for a fixture nobody has posted yet. The
 *                      `basis` under the number says which of the three it is,
 *                      every time, because "the market says" means three quite
 *                      different things and only one of them is a quote.
 *
 * The gap column is the second minus the first, in points AND in rank slots,
 * classified with the site's own standing thresholds (payload.delta) rather than
 * with a rule invented here.
 *
 * SCORED ON THE SERVER. Unlike /rankings, which ships stat lines and re-scores
 * them in the browser, this asks /api/boards for a board already scored at the
 * chosen preset. The week-by-week drawer prints per-week points, and there is no
 * per-week stat line in the payload to recompute them from — so re-scoring here
 * would leave the drawer disagreeing with the row above it. One fetch per preset
 * (edge-cached five minutes) buys a board that cannot contradict itself.
 *
 * TWO LINES UNDER EVERY NAME. The columns are all "how many points", and a
 * reader arrives with two questions they do not answer: is he any good, and is
 * this a week to start him. So each row carries a PLAYER sentence (his rank at
 * his own position, what that rank is worth there, the points behind it, and an
 * injury or a usage swing where there is one) and an OPPORTUNITY sentence (on a
 * week board the fixture, the matchup and the scoring environment; on a season
 * board the games, byes and slate still to come). Both are the payload's own
 * numbers said in words — see "the two lines under a player's name" below.
 *
 * NOTHING IS INVENTED. A number the payload does not carry prints as an em dash.
 * A board that does not answer prints why and shows no table at all, rather than
 * a stale one. The sentences hold to the same rule: a clause whose field is
 * missing is dropped, never defaulted.
 */
(function () {
  'use strict';

  // Ranking pages are generated from this one file, so load the shared player
  // identity/media helper here rather than duplicating it across every shell.
  if (!window.ITPlayerSearch && !document.querySelector('script[src="/player-search.js"]')) {
    var mediaScript = document.createElement('script');
    mediaScript.src = '/player-search.js';
    mediaScript.async = true;
    document.head.appendChild(mediaScript);
  }

  var PRESETS = [['standard', 'Standard'], ['half', 'Half PPR'], ['ppr', 'PPR']];
  var STORE = 'it.ranks.scoring';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function n1(v) { return v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1); }
  function signed(v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1); }
  function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  // The reader's last scoring choice, remembered across the sixteen pages so
  // walking from receivers to tight ends does not reset it. A browser that
  // refuses storage simply gets the default.
  function remembered() {
    try { var v = localStorage.getItem(STORE); return /^(standard|half|ppr)$/.test(v || '') ? v : 'ppr'; }
    catch (e) { return 'ppr'; }
  }
  function remember(v) { try { localStorage.setItem(STORE, v); } catch (e) {} }

  // ── the two lines under a player's name ──────────────────────────────────
  // The board answers "how many points" in nine columns and answers the two
  // questions a reader actually arrives with — IS HE ANY GOOD, and IS THIS A
  // WEEK TO START HIM — in none of them. Both facts are on the row already,
  // scattered across a rank, a positional tier nobody prints, an opponent, a
  // schedule grade and a note, four columns apart and off the right edge of a
  // phone. So every row carries two sentences under the name: the first about
  // the PLAYER, the second about the OPPORTUNITY in front of him.
  //
  // THEY ARE THE SAME NUMBERS, SAID IN WORDS. Nothing here fetches anything,
  // computes a projection or invents a grade. Every clause is a field of the
  // payload the columns are built from, and a clause whose field is missing is
  // DROPPED rather than defaulted: an unpriced fixture says it is a fitted
  // rating, a board with no usage behind it says nothing about usage, and a
  // player with no game says exactly that. Where the worker publishes its own
  // classification (scheduleDifficulty.label) the sentence uses it, so a line
  // cannot contradict the column beside it.
  //
  // THE TIERS. A rank is a number; "WR9" does not tell a reader whether that
  // is a lineup lock or a bench stash, and the answer differs by position —
  // TE6 is a weekly starter and RB6 is a first-rounder. These are the standing
  // shapes of the positions, not a read on any player, and they are applied to
  // the CONSENSUS POSITIONAL rank every time, including on the FLEX pages
  // where the "#" column is a pooled RB/WR/TE slot: "the 9th-best receiver" is
  // a statement about the player, "flex 23" is a statement about a lineup slot.
  var TIERS = {
    QB:  [[3, 'elite at the position'], [8, 'an every-week starter'], [14, 'a matchup starter'], [22, 'a streamer'], [Infinity, 'bench depth']],
    RB:  [[5, 'elite at the position'], [12, 'a weekly RB1'], [24, 'an RB2'], [36, 'a flex play'], [48, 'bench depth'], [Infinity, 'a deep-league name']],
    WR:  [[5, 'elite at the position'], [12, 'a weekly WR1'], [24, 'a WR2'], [36, 'a flex play'], [48, 'bench depth'], [Infinity, 'a deep-league name']],
    TE:  [[2, 'elite at the position'], [6, 'an every-week starter'], [12, 'a matchup starter'], [18, 'a streamer'], [Infinity, 'bench depth']],
    K:   [[5, 'top of the position'], [12, 'startable'], [20, 'a streamer'], [Infinity, 'waiver depth']],
    DST: [[5, 'top of the position'], [12, 'startable'], [20, 'a streamer'], [Infinity, 'waiver depth']]
  };
  function tierOf(position, rank) {
    var t = TIERS[position];
    if (!t || rank == null || !isFinite(rank)) return '';
    for (var i = 0; i < t.length; i++) if (rank <= t[i][0]) return t[i][1];
    return '';
  }
  // A defensive rank is 1 = allows the fewest points, so a LOW number is a hard
  // week. The two thresholds are the worker's own (scheduleDifficulty: <= 11
  // Hard, >= 22 Easy), so a week grade and a season grade mean the same thing.
  function gradeOf(defRank) { return defRank <= 11 ? 'a hard' : defRank >= 22 ? 'a soft' : 'an average'; }
  function ord(n) {
    var r = Math.round(n), v = Math.abs(r) % 100, t = v % 10;
    return r + (v >= 11 && v <= 13 ? 'th' : t === 1 ? 'st' : t === 2 ? 'nd' : t === 3 ? 'rd' : 'th');
  }
  // "2.1 above" / "1.4 points a game below" / "level with", for a delta that is
  // already the difference between a fixture and a club's own season mean.
  function awayFrom(d, unit) {
    if (d == null || !isFinite(d) || Math.abs(d) < 0.05) return 'level with';
    return (Math.round(Math.abs(d) * 10) / 10).toFixed(1) + (unit ? ' ' + unit : '') + (d > 0 ? ' above' : ' below');
  }
  var POS_LONG = { QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'tight ends', K: 'kickers', DST: 'defenses' };
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function listOf(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  function Board(host) {
    var horizon = host.getAttribute('data-rk-horizon') === 'ros' ? 'ros' : 'week';
    var pos = (host.getAttribute('data-rk-pos') || 'ALL').toUpperCase();
    var wantWeeks = host.getAttribute('data-rk-weeks') === '1';
    var label = host.getAttribute('data-rk-label') || '';
    var preset = remembered();
    var cache = {};              // preset -> payload
    var q = '';
    var sortKey = 'rank', sortDir = 1;
    var open = {};               // player key -> drawer open
    var allOpen = false;

    // ── the chrome around the table ────────────────────────────────────────
    var tools = el('div', 'rk-tools');
    var seg = el('div', 'rk-seg2');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Scoring');
    PRESETS.forEach(function (p) {
      var b = el('button', null, p[1]);
      b.type = 'button';
      b.setAttribute('data-preset', p[0]);
      seg.appendChild(b);
    });
    var find = el('label', 'rk-find');
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Filter by player or team';
    input.setAttribute('aria-label', 'Filter by player or team');
    find.appendChild(input);
    var expand = null;
    if (wantWeeks) {
      expand = el('button', null, 'Open every week');
      expand.type = 'button';
      expand.className = 'rk-seg2';
      expand.setAttribute('aria-pressed', 'false');
      // A lone button styled as a one-cell segment, so it sits with the group.
      expand.style.padding = '0 12px';
      expand.style.minHeight = '36px';
      expand.style.font = 'inherit';
      expand.style.fontSize = '12px';
      expand.style.fontWeight = '800';
      expand.style.letterSpacing = '.06em';
      expand.style.textTransform = 'uppercase';
      expand.style.cursor = 'pointer';
      expand.style.background = 'var(--bg)';
      expand.style.color = 'var(--sec)';
    }
    tools.appendChild(seg);
    if (expand) tools.appendChild(expand);
    tools.appendChild(find);

    var stamp = el('p', 'is-note');
    var scroll = el('div', 'is-scroll');
    var table = el('table', 'is-table rk-vs');
    table.hidden = true;
    var thead = document.createElement('thead');
    var tbody = document.createElement('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    scroll.appendChild(table);
    var empty = el('p', 'is-empty', 'Reading the board&hellip;');
    var foot = el('p', 'is-note');

    host.appendChild(tools);
    host.appendChild(stamp);
    host.appendChild(scroll);
    host.appendChild(empty);
    host.appendChild(foot);

    // ── the columns ───────────────────────────────────────────────────────
    // Two spanning groups over the pair that matters, so the eye reads
    // "consensus vs odds" and not "eleven numbers".
    function headHtml() {
      var lead = [
        wantWeeks ? '<th scope="col"><span class="is-status">Wks</span></th>' : '',
        th('rank', '#'),
        th('player', 'Player'),
        th('team', 'Team'),
        horizon === 'week' ? th('opp', 'Opponent') : th('games', 'Games'),
      ].join('');
      var group = '<tr>' +
        '<th colspan="' + (wantWeeks ? 5 : 4) + '"></th>' +
        '<th class="rk-grp fan" colspan="2" scope="colgroup">Fantasy Consensus</th>' +
        '<th class="rk-grp mkt" colspan="2" scope="colgroup">Betting Odds</th>' +
        '<th colspan="2"></th>' +
        '</tr>';
      var cols = '<tr>' + lead +
        th('cpts', 'Proj', 'rk-fan num') + th('crank', 'Rank', 'rk-fan num') +
        th('vpts', 'Proj', 'rk-mkt num') + th('vrank', 'Rank', 'rk-mkt num') +
        th('gap', 'Gap', 'num') +
        th('extra', horizon === 'week' ? 'Note' : 'Schedule') +
        '</tr>';
      return group + cols;
    }
    function th(key, text, cls) {
      var on = key === sortKey;
      return '<th scope="col" data-key="' + key + '"' + (cls ? ' class="' + cls + '"' : '') +
        (on ? ' aria-sort="' + (sortDir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + esc(text) + '</th>';
    }

    function rankOf(p, side) {
      var b = p[side];
      if (!b) return null;
      return pos === 'FLEX' ? b.flexRank : b.rank;
    }
    // The board's own rank, which is what "#" means on the page: the fantasy
    // consensus order, because that is the column the ranking is published on.
    // The odds column keeps its own rank beside it so the disagreement is
    // visible in slots, not only in points.
    function primaryRank(p) { return rankOf(p, 'consensus'); }

    function gapCell(p) {
      var d = p.marketDelta || {};
      var cls = d.points == null ? 'flat' : d.points > 0.05 ? 'up' : d.points < -0.05 ? 'down' : 'flat';
      var slots = d.rank == null ? '' : (d.rank > 0 ? '+' : '') + d.rank + ' slots';
      return '<td class="rk-gap ' + cls + '"><b>' + signed(d.points) + '</b>' +
        '<span>' + esc(d.classification || '') + (slots ? ' &middot; ' + esc(slots) : '') + '</span></td>';
    }

    function extraCell(p) {
      if (horizon === 'week') {
        var bits = [];
        if (p.injury && p.injury.status) bits.push(esc(p.injury.status) + (p.injury.gamesOut ? ' (' + p.injury.gamesOut + ')' : ''));
        if (p.why && p.why.summary) bits.push(esc(p.why.summary));
        if (!bits.length && p.roleTrend && p.roleTrend.applied) bits.push('usage ' + esc(p.roleTrend.label) + (p.roleTrend.pct != null ? ' ' + (p.roleTrend.pct > 0 ? '+' : '') + p.roleTrend.pct + '%' : ''));
        return '<td>' + (bits.length ? bits.join(' &middot; ') : '—') + '</td>';
      }
      var s = p.scheduleDifficulty;
      var byes = p.byes && p.byes.length ? ' &middot; bye ' + esc(p.byes.join(', ')) : '';
      return '<td>' + (s ? esc(s.label) + ' <span class="is-status">' + esc(s.avgOpponentDefRank) + '</span>' : '—') + byes + '</td>';
    }

    // THE PLAYER LINE. Who he is on this board, in the order a reader asks it:
    // where he ranks at his own position, what that rank is worth at that
    // position, and the points behind it (per game on a season board, where a
    // total over a different number of games is not a comparison).
    function playerLine(p) {
      var rank = p.consensus ? p.consensus.rank : null;
      // ON THE FLEX PAGES the "#" column is a POOLED RB/WR/TE slot, printed with
      // the position's own letters ("RB23"). The compact form here would read as
      // that same number and disagree with it, so the rank is spelled out
      // instead. The tier below it is a statement about the player at his own
      // position, and it has to be legible as one.
      var head = rank == null ? esc(p.position)
        : pos === 'FLEX' && POS_LONG[p.position] ? ord(rank) + ' among ' + POS_LONG[p.position]
        : esc(p.position) + rank;
      var bits = [head + (horizon === 'ros' ? ' the rest of the way' : ' this week')];
      var tier = tierOf(p.position, rank);
      if (tier) bits.push(tier);
      // The points clause is dropped for a player with no game on this board: a
      // 0.0 there is an absence, not a projection, and printing it as one beside
      // a tier would read as a collapse.
      var pts = p.consensus ? p.consensus.points : null;
      if (pts != null && isFinite(pts) && p.games > 0) {
        bits.push(horizon === 'ros' ? n1(pts / p.games) + ' points a game' : n1(pts) + ' points projected');
      }
      var s = bits.join(', ');
      // ONE trailing clause, not two. An injury is the fact that changes a
      // lineup, so it wins where there is one; otherwise the usage trend, and
      // only once three games have earned it (roleTrend.applied), which is the
      // same bar the consensus column nudges itself on.
      if (p.injury && p.injury.status) {
        s += ', listed ' + esc(p.injury.status) +
          (p.injury.gamesOut ? ' for the next ' + (p.injury.gamesOut === 1 ? 'game' : p.injury.gamesOut + ' games') : '');
      } else if (p.roleTrend && p.roleTrend.applied && p.roleTrend.label !== 'flat' && p.roleTrend.pct != null) {
        s += ', with usage ' + (p.roleTrend.pct > 0 ? 'up ' : 'down ') + Math.abs(p.roleTrend.pct) + '% on his own average';
      }
      return s + '.';
    }

    // THE OPPORTUNITY LINE. What is in front of him, which on a week board is
    // one fixture and on a season board is a slate.
    function opportunityLine(p) { return horizon === 'ros' ? seasonOpportunity(p) : weekOpportunity(p); }

    function weekOpportunity(p) {
      var w = (p.weeks || [])[0];
      if (!w) return 'No fixture on this board for the week.';
      if (w.bye) return 'On bye this week, with no game to grade.';
      var at = esc((w.home ? 'vs ' : 'at ') + w.opponent);
      if (w.out) return 'Out of this week&rsquo;s game ' + at + '.';
      var env = w.env || {};
      var posted = !!env.posted;
      // A DEFENSE IS GRADED ON THE OTHER SIDE OF THE FIXTURE. `opponentDefRank`
      // and `implied` describe this club's OFFENSE, which is not what a DST
      // scores off; its line reads the allowed side instead — what the opponent
      // is expected to score, against what this club allows across its own
      // schedule. Grading a defense on the offense's numbers would be a wrong
      // sentence rather than a missing one.
      if (p.position === 'DST') {
        var opp = env.allowedImplied != null ? env.allowedImplied : env.allowedExpected;
        if (opp == null) return at + ', a fixture no book has priced and no rating can grade.';
        return at + ', an offense ' + (posted ? 'implied for ' : 'rated for ') + n1(opp) + ' points' +
          (posted ? (env.allowedDelta != null ? ', ' + awayFrom(env.allowedDelta) + ' what this defense allows across its own schedule' : '')
                  : ' off a fitted team rating rather than a posted line') + '.';
      }
      var parts = [at];
      if (env.opponentDefRank) parts.push(gradeOf(env.opponentDefRank) + ' matchup (' + ord(env.opponentDefRank) + ' by points allowed)');
      var imp = env.implied != null ? env.implied : env.expected;
      // An unposted fixture says so ONCE, folded into the number it qualifies
      // rather than trailing it as a second clause: "rated for 24.8 points off a
      // fitted team rating" and not "rated for 24.8 points, off a fitted team
      // rating". A season mean is only quoted against a posted line, because a
      // fitted rating measured against a mean of fitted ratings says nothing.
      if (imp != null) {
        parts.push('with the offense ' + (posted ? 'implied for ' : 'rated for ') + n1(imp) + ' points' +
          (posted ? (env.impliedDelta != null ? ', ' + awayFrom(env.impliedDelta) + ' its own season mean' : '')
                  : ' off a fitted team rating rather than a posted line'));
      } else if (!posted) {
        parts.push('on a fitted team rating rather than a posted line');
      }
      return parts.join(', ') + '.';
    }

    function seasonOpportunity(p) {
      if (!(p.games > 0)) return 'No game left on this board to grade.';
      var bits = [plural(p.games, 'game') + ' left'];
      if (p.byes && p.byes.length) {
        bits.push(p.byes.length === 1 ? 'a bye in week ' + p.byes[0] : 'byes in weeks ' + listOf(p.byes));
      }
      if (p.position === 'DST') {
        var d = avgAllowedDelta(p);
        bits.push(d == null
          ? 'and no posted line yet covers the offenses ahead of it'
          : 'and the offenses ahead are implied ' + awayFrom(d, 'points a game') + ' what this defense allows across its own schedule');
      } else {
        var sd = p.scheduleDifficulty;
        // The worker's own label, not a rule invented here, so the sentence and
        // the Schedule column cannot disagree.
        bits.push(sd
          ? 'against ' + (sd.label === 'Hard' ? 'a hard' : sd.label === 'Easy' ? 'a soft' : 'an average') +
            ' slate of defenses, averaging ' + ord(sd.avgOpponentDefRank) + ' by points allowed'
          : 'against a slate this board cannot grade');
      }
      return bits.join(', ') + '.';
    }

    // A defense's remaining slate, from the weeks the payload already carries:
    // the mean of each fixture's allowed delta, over the weeks that have one.
    // Byes, absences and unpriced fixtures are skipped rather than counted as
    // zero, which would drag every grade toward "level with".
    function avgAllowedDelta(p) {
      var sum = 0, n = 0;
      (p.weeks || []).forEach(function (w) {
        if (!w || w.bye || w.out || !w.env || w.env.allowedDelta == null) return;
        sum += w.env.allowedDelta; n++;
      });
      return n ? sum / n : null;
    }

    function rowHtml(p) {
      // The week's fixture. A player ruled OUT still has an opponent, and
      // printing BYE over his fixture — which the earlier filter did — is a
      // different fact, and one the Opportunity line below would contradict.
      var w0 = p.weeks && p.weeks[0];
      var oppCell = horizon === 'week'
        ? '<td>' + (!w0 || w0.bye ? '<span class="is-status">BYE</span>'
            : esc((w0.home ? 'vs ' : 'at ') + w0.opponent) + (w0.out ? ' <span class="is-status">OUT</span>' : '')) + '</td>'
        : '<td class="num">' + (p.games == null ? '—' : p.games) + '</td>';
      var opener = wantWeeks
        ? '<td><button class="rk-open" type="button" data-open="' + esc(p.key) + '" aria-expanded="' + (open[p.key] ? 'true' : 'false') +
          '" aria-label="Show every remaining week for ' + esc(p.name) + '">' + (open[p.key] ? '&minus;' : '+') + '</button></td>'
        : '';
      return '<tr>' + opener +
        '<td class="num">' + (primaryRank(p) == null ? '—' : esc(p.position) + primaryRank(p)) + '</td>' +
        '<td class="rk-who"><a href="/in-season/player/' + slug(p.name) + '?pos=' + esc(p.position) + '"><b>' + esc(p.name) + '</b></a>' +
          (pos === 'ALL' || pos === 'FLEX' ? '<small>' + esc(p.position) + '</small>' : '') +
          '<span class="rk-read rk-read-pl"><span class="rk-read-k">Player</span>' + playerLine(p) + '</span>' +
          '<span class="rk-read rk-read-op"><span class="rk-read-k">Opportunity</span>' + opportunityLine(p) + '</span>' +
        '</td>' +
        '<td>' + esc(p.team) + '</td>' + oppCell +
        '<td class="rk-fan rk-pts">' + n1(p.consensus ? p.consensus.points : null) + '</td>' +
        '<td class="rk-fan rk-rnk">' + (rankOf(p, 'consensus') == null ? '—' : esc(p.position) + rankOf(p, 'consensus')) + '</td>' +
        '<td class="rk-mkt rk-pts">' + n1(p.vegas ? p.vegas.points : null) +
          '<div class="rk-basis">' + esc(p.vegas ? p.vegas.basis : '') + '</div></td>' +
        '<td class="rk-mkt rk-rnk">' + (rankOf(p, 'vegas') == null ? '—' : esc(p.position) + rankOf(p, 'vegas')) + '</td>' +
        gapCell(p) + extraCell(p) +
        '</tr>';
    }

    // ── the week-by-week drawer ───────────────────────────────────────────
    // The whole reason a season-long board is worth opening: a rest-of-season
    // total is a sum, and the useful question is which weeks it came from and
    // where the two columns stop agreeing. A bye and an absence are printed as
    // rows of their own rather than skipped, so the weeks still read 1..18.
    function weeksHtml(p, span) {
      var rows = (p.weeks || []).map(function (w) {
        if (w.bye) return '<tr class="off"><td>Wk ' + w.week + '</td><td>Bye</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>—</td></tr>';
        if (w.out) return '<tr class="off"><td>Wk ' + w.week + '</td><td>' + esc((w.home ? 'vs ' : 'at ') + w.opponent) + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>Out</td></tr>';
        return '<tr><td>Wk ' + w.week + '</td><td>' + esc((w.home ? 'vs ' : 'at ') + w.opponent) + '</td>' +
          '<td class="num fan">' + n1(w.consensusPts) + '</td>' +
          '<td class="num mkt">' + n1(w.vegasPts) + '</td>' +
          '<td class="num">' + n1(w.ironTunaPts) + '</td>' +
          '<td><span class="is-status">' + esc(w.basis || '') + '</span></td></tr>';
      }).join('');
      var totals = '<tfoot><tr><td colspan="2">Total over ' + (p.games || 0) + ' game' + (p.games === 1 ? '' : 's') + '</td>' +
        '<td class="num">' + n1(p.consensus ? p.consensus.points : null) + '</td>' +
        '<td class="num">' + n1(p.vegas ? p.vegas.points : null) + '</td>' +
        '<td class="num">' + n1(p.ironTuna ? p.ironTuna.points : null) + '</td><td></td></tr></tfoot>';
      return '<tr class="rk-weeks"><td colspan="' + span + '">' +
        '<h4>' + esc(p.name) + ' &middot; every week still to come</h4>' +
        '<div class="is-scroll"><table class="rk-wk"><thead><tr>' +
        '<th scope="col">Week</th><th scope="col">Opponent</th>' +
        '<th scope="col" class="num">Fantasy Consensus</th><th scope="col" class="num">Betting Odds</th>' +
        '<th scope="col" class="num">Iron Tuna</th><th scope="col">Odds basis</th>' +
        '</tr></thead><tbody>' + rows + '</tbody>' + totals + '</table></div>' +
        '</td></tr>';
    }

    // ── sorting ───────────────────────────────────────────────────────────
    function sortVal(p, key) {
      switch (key) {
        case 'rank': return primaryRank(p) == null ? 1e6 : primaryRank(p);
        case 'player': return p.name;
        case 'team': return p.team;
        case 'opp': return (p.weeks && p.weeks[0] && p.weeks[0].opponent) || 'zzz';
        case 'games': return -(p.games || 0);
        case 'cpts': return -((p.consensus && p.consensus.points) || 0);
        case 'crank': return rankOf(p, 'consensus') == null ? 1e6 : rankOf(p, 'consensus');
        case 'vpts': return -((p.vegas && p.vegas.points) || 0);
        case 'vrank': return rankOf(p, 'vegas') == null ? 1e6 : rankOf(p, 'vegas');
        case 'gap': return -((p.marketDelta && p.marketDelta.points) || 0);
        case 'extra': return p.scheduleDifficulty ? p.scheduleDifficulty.avgOpponentDefRank : 99;
      }
      return 0;
    }

    function render() {
      var payload = cache[preset];
      if (!payload) { load(); return; }
      [].forEach.call(seg.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-preset') === preset ? 'true' : 'false');
      });

      var rows = payload.players.slice();
      if (q) {
        var qq = q.toLowerCase();
        rows = rows.filter(function (p) {
          return p.name.toLowerCase().indexOf(qq) >= 0 || String(p.team).toLowerCase() === qq;
        });
      }
      rows.sort(function (a, b) {
        var x = sortVal(a, sortKey), y = sortVal(b, sortKey);
        var c = (x < y ? -1 : x > y ? 1 : 0) * sortDir;
        return c || ((primaryRank(a) || 1e6) - (primaryRank(b) || 1e6));
      });

      var span = (wantWeeks ? 11 : 10);
      thead.innerHTML = headHtml();
      tbody.innerHTML = rows.slice(0, 250).map(function (p) {
        return rowHtml(p) + (wantWeeks && open[p.key] ? weeksHtml(p, span) : '');
      }).join('');
      table.hidden = !rows.length;
      empty.hidden = !!rows.length;
      if (!rows.length) empty.textContent = 'Nothing matches that filter.';

      var hz = payload.horizon || {};
      var weeks = hz.weeks || [];
      stamp.innerHTML = 'Scored at <b>' + esc(payload.scoring ? payload.scoring.label : preset) + '</b> &middot; ' +
        esc(label || hz.label || '') +
        (weeks.length ? ' (week' + (weeks.length > 1 ? 's ' + weeks[0] + '&ndash;' + weeks[weeks.length - 1] : ' ' + weeks[0]) + ')' : '') +
        ' &middot; ' + rows.length + ' player' + (rows.length === 1 ? '' : 's') +
        (payload.season ? ' &middot; ' + esc(payload.season) + ' season' : '') +
        (payload.played ? ' &middot; ' + payload.played + ' player' + (payload.played === 1 ? ' whose game has' : 's whose games have') + ' kicked off are off the board' : '');

      var src = payload.sources || {};
      foot.innerHTML = 'The <b>Betting Odds</b> column reads its basis off the market: <b>props</b> is a priced player prop, ' +
        '<b>gamelines</b> is the posted game line&rsquo;s scoring environment applied to his line, and <b>ratings</b> is a fixture no ' +
        'book has posted yet, projected from fitted team ratings and graded low. ' +
        (src.props ? esc(src.props) + ' players carry a prop this week. ' : 'No priced player prop has reached this board for the week. Books post them; this feed is not carrying them. ') +
        (src.usage ? 'Usage through week ' + esc(src.usage) + '.' : 'No weekly usage has been published yet.');
    }

    function load() {
      empty.hidden = false;
      empty.textContent = 'Reading the board…';
      table.hidden = true;
      var url = '/api/boards?horizon=' + encodeURIComponent(horizon) +
        '&pos=' + encodeURIComponent(pos) + '&scoring=' + encodeURIComponent(preset);
      fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.players) {
          empty.textContent = 'The board did not answer. Nothing is shown rather than a ranking that may be stale.';
          return;
        }
        cache[preset] = j;
        render();
      }).catch(function () {
        empty.textContent = 'The board did not answer. Nothing is shown rather than a ranking that may be stale.';
      });
    }

    // ── events ────────────────────────────────────────────────────────────
    seg.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      preset = b.getAttribute('data-preset');
      remember(preset);
      render();
    });
    input.addEventListener('input', function () { q = this.value.trim(); render(); });
    thead.addEventListener('click', function (ev) {
      var h = ev.target.closest('th[data-key]');
      if (!h) return;
      var k = h.getAttribute('data-key');
      if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render();
    });
    tbody.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-open]');
      if (!b) return;
      var k = b.getAttribute('data-open');
      open[k] = !open[k];
      render();
    });
    if (expand) {
      expand.addEventListener('click', function () {
        allOpen = !allOpen;
        var payload = cache[preset];
        open = {};
        if (allOpen && payload) payload.players.slice(0, 250).forEach(function (p) { open[p.key] = true; });
        expand.setAttribute('aria-pressed', allOpen ? 'true' : 'false');
        expand.textContent = allOpen ? 'Close every week' : 'Open every week';
        expand.style.background = allOpen ? 'var(--text)' : 'var(--bg)';
        expand.style.color = allOpen ? '#fff' : 'var(--sec)';
        render();
      });
    }

    load();
  }

  function boot() {
    [].forEach.call(document.querySelectorAll('[data-rk-board]'), Board);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
