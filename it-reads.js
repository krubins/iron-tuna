/* Iron Tuna — the two lines under a player's name, on every board that prints one.
 *
 * WHAT THEY ARE. A rankings board answers "how many points" in nine or fourteen
 * columns and answers the two questions a reader actually arrives with in none
 * of them: IS HE ANY GOOD, and IS THIS A WEEK TO START HIM. Both facts are on
 * the row already, scattered across a rank, a positional tier nobody prints, an
 * opponent, a schedule grade and an injury column, ten columns apart and off the
 * right edge of a phone. So every row carries two sentences under the name:
 *
 *   PLAYER       where he ranks at his own position, WHAT HE HAS ACTUALLY DONE
 *                (the points a game he has scored, the volume behind them, and
 *                whether the projection ahead of him backs that rate or marks
 *                it down), and an injury or a usage swing where there is one.
 *                A rank is not a performance, so the positional tier is the
 *                FALLBACK, for a player who has not played yet.
 *   OPPORTUNITY  what is in front of him — on a one-week board the fixture, the
 *                matchup and the scoring environment; on a multi-week board the
 *                games, byes and slate still to come.
 *
 * WHY IT IS A FILE OF ITS OWN. Two surfaces print these lines and they compute
 * their inputs differently. /weekly-*-rankings and /season-long-*-rankings
 * (it-ranks.js) publish on the consensus board, scored on the server, two
 * horizons. /rankings re-scores every stat line in the browser at the reader's
 * own league settings and publishes on whichever of four boards he has picked,
 * across four horizons. If each wrote its own sentences the TIERS would drift
 * apart within a season and the same player would be "a weekly WR1" on one page
 * and "a WR2" on the other. So the grammar and the tiers live here, once, and
 * the caller passes in the two things only it can know: WHICH RANK and WHICH
 * POINTS, at the scoring and on the board the reader is actually looking at.
 *
 * THEY ARE THE SAME NUMBERS, SAID IN WORDS. Nothing here fetches anything,
 * computes a projection or invents a grade. Every clause is a field of the
 * payload the columns are built from, and a clause whose field is missing is
 * DROPPED rather than defaulted: an unpriced fixture says it is a fitted rating
 * instead of quoting a line, a board with no usage behind it says nothing about
 * usage, and a player with no game says exactly that. Where the worker publishes
 * its own classification (scheduleDifficulty.label) the sentence uses it, so a
 * line cannot contradict the column beside it.
 */
(function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function n1(v) { return v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1); }
  // Volume reads in the units the figure is actually counted in: a tenth of a
  // target or a touch is a real distinction over a season, a tenth of a yard is
  // not, and "281.0 passing yards a game" is a decimal nobody asked for.
  function vol(v, unit) { return unit === 'passing yards' ? String(Math.round(v)) : n1(v); }

  // THE TIERS. A rank is a number; "WR9" does not tell a reader whether that is
  // a lineup lock or a bench stash, and the answer differs by position — TE6 is
  // a weekly starter and RB6 is a first-rounder. These are the standing shapes
  // of the positions, not a read on any player, and they are applied to the
  // POSITIONAL rank every time, never to a pooled flex slot.
  var TIERS = {
    QB:  [[3, 'elite at the position'], [8, 'an every-week starter'], [14, 'a matchup starter'], [22, 'a streamer'], [Infinity, 'bench depth']],
    RB:  [[5, 'elite at the position'], [12, 'a weekly RB1'], [24, 'an RB2'], [36, 'a flex play'], [48, 'bench depth'], [Infinity, 'a deep-league name']],
    WR:  [[5, 'elite at the position'], [12, 'a weekly WR1'], [24, 'a WR2'], [36, 'a flex play'], [48, 'bench depth'], [Infinity, 'a deep-league name']],
    TE:  [[2, 'elite at the position'], [6, 'an every-week starter'], [12, 'a matchup starter'], [18, 'a streamer'], [Infinity, 'bench depth']],
    K:   [[5, 'top of the position'], [12, 'startable'], [20, 'a streamer'], [Infinity, 'waiver depth']],
    DST: [[5, 'top of the position'], [12, 'startable'], [20, 'a streamer'], [Infinity, 'waiver depth']]
  };
  var POS_LONG = { QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'tight ends', K: 'kickers', DST: 'defenses' };
  // How each horizon refers to itself, in the two places a sentence needs it.
  var HZ = {
    week:     { when: ' this week',                  slate: 'left this week' },
    next3:    { when: ' over the next three weeks',  slate: 'over the next three weeks' },
    ros:      { when: ' the rest of the way',        slate: 'left' },
    playoffs: { when: ' in weeks 15&ndash;17',       slate: 'in weeks 15 to 17' }
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
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  // The board's forward rate against the rate he has actually run at. The
  // threshold is a tenth of a point, below which the two numbers are the same
  // number and saying either "marks down" or "backs" would be reading a
  // rounding difference as a judgement.
  function forwardOf(ppg, projPerGame, proj) {
    var d = projPerGame - ppg;
    if (!isFinite(d) || Math.abs(d) < 0.1) return 'and the board projects much the same going forward';
    return 'which the board marks ' + (d < 0 ? 'down' : 'up') + ' to ' + proj + ' going forward';
  }
  function listOf(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  // THE PLAYER LINE. Who he is on the board the reader is looking at, in the
  // order a reader asks it: where he ranks at his own position, what that rank
  // is worth at that position, and the points behind it.
  //
  // `o.rank` and `o.points` are the CALLER's, because only the caller knows
  // which board is on screen and at whose scoring it was computed. `o.points`
  // is the total over the horizon; a multi-week board prints it per game,
  // because a total over a different number of games is not a comparison.
  function player(p, o) {
    o = o || {};
    var hz = HZ[o.horizon] ? o.horizon : 'week';
    var rank = o.rank == null || !isFinite(o.rank) ? null : o.rank;
    // WHERE THE "#" COLUMN IS A POOLED RB/WR/TE SLOT the caller passes
    // spellOut: the compact "RB23" here would read as that same pooled number
    // and disagree with it. The tier below is a statement about the player at
    // his own position, and it has to be legible as one.
    var head = rank == null ? esc(p.position)
      : o.spellOut && POS_LONG[p.position] ? ord(rank) + ' among ' + POS_LONG[p.position]
      : esc(p.position) + rank;
    var bits = [head + HZ[hz].when];
    // The points clause is dropped for a player with no game on this board: a
    // 0.0 there is an absence, not a projection, and printing it as one beside
    // a rank would read as a collapse.
    var pts = o.points;
    var proj = pts != null && isFinite(pts) && p.games > 0
      ? (hz === 'week' ? n1(pts) : n1(pts / p.games))
      : null;

    // WHAT HE HAS ACTUALLY DONE COMES FIRST, where the board knows it. A rank
    // is not a performance, and the positional tier that used to sit here was
    // the rank said a second way: "RB3, elite at the position" tells a reader
    // nothing he did not already have from the "#" column. The season line
    // does — what he has scored, the volume he scored it on, and whether the
    // projection ahead of him backs that rate or marks it down.
    //
    // THE COMPARISON IS THE INSIGHT. A board projecting well under a player's
    // own rate is saying his scoring has outrun what is driving it; one
    // projecting over it is saying the opposite. Both are worth a reader's
    // attention and neither is visible in a rank. It is only drawn on a
    // multi-week horizon, where the projection is a per-game rate and the two
    // numbers are the same kind of thing; a one-week total against a season
    // average would be a comparison between different units.
    var f = p.form;
    var played = f && f.games > 0 && f.ppg != null && isFinite(o.formPpg == null ? f.ppg : o.formPpg);
    if (played) {
      var ppg = o.formPpg == null ? f.ppg : o.formPpg;
      var run = n1(ppg) + ' points a game so far' +
        (f.volume != null && f.volumeUnit ? ' on ' + vol(f.volume, f.volumeUnit) + ' ' + esc(f.volumeUnit) : '') +
        ' over ' + plural(f.games, 'game');
      bits.push(run);
      if (proj != null) {
        bits.push(hz === 'week' ? proj + ' projected this week' : forwardOf(ppg, pts / p.games, proj));
      }
    } else {
      // NOTHING PLAYED YET, so there is nothing to report and the tier is all
      // the board has to say about him. In September that is every row.
      var tier = tierOf(p.position, rank);
      if (tier) bits.push(tier);
      if (proj != null) bits.push(proj + (hz === 'week' ? ' points projected' : ' points a game projected'));
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

  // THE OPPORTUNITY LINE. What is in front of him, which on a one-week board is
  // a fixture and on every other horizon is a slate.
  function opportunity(p, o) {
    o = o || {};
    var hz = HZ[o.horizon] ? o.horizon : 'week';
    return hz === 'week' ? weekOpportunity(p) : slateOpportunity(p, hz);
  }

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

  function slateOpportunity(p, hz) {
    if (!(p.games > 0)) return 'No game on this board to grade.';
    var bits = [plural(p.games, 'game') + ' ' + HZ[hz].slate];
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

  // Both lines as the markup every board prints them in, so the class names and
  // the two keys live in one place rather than in each caller's row builder.
  function cell(p, o) {
    return '<span class="rk-read rk-read-pl"><span class="rk-read-k">Player</span>' + player(p, o) + '</span>' +
      '<span class="rk-read rk-read-op"><span class="rk-read-k">Opportunity</span>' + opportunity(p, o) + '</span>';
  }

  window.ITReads = { cell: cell, player: player, opportunity: opportunity,
                     tierOf: tierOf, gradeOf: gradeOf, ord: ord, awayFrom: awayFrom,
                     plural: plural, listOf: listOf, TIERS: TIERS, POS_LONG: POS_LONG, HZ: HZ };
})();
