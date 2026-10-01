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

  // THE BOARD AROUND HIM. "14.2 points a game on 7.1 targets" is two numbers
  // a reader cannot judge alone: is 7.1 a lot, is 2.0 points a target good, is
  // a third of his scoring coming from touchdowns normal? The answer to every
  // one is the rest of the board, which the caller already holds. So the
  // caller builds this ONCE per render from the rows it prints, and both lines
  // read a player against his own position: where his volume ranks, what a
  // typical starter does with the same work, how his offense's scoring
  // environment ranks, and which teammate's work is open because he is out.
  //
  // "Typical" is the median of the position's starter pool, by volume (the top
  // 24 QBs, 36 RBs, 48 WRs, 18 TEs that have played), not of every name on
  // the board: a WR90's two targets a game would drag every norm toward zero.
  // Everything is the payload's own fields. Touchdown points are counted at 6
  // a rushing or receiving score and 4 a passing one, which is what all three
  // published presets pay; a custom league that pays otherwise moves a share
  // by a few points, never across a threshold below that matters.
  var POOL = { QB: 24, RB: 36, WR: 48, TE: 18 };
  var MIN_GAMES = 2;   // a read on one game is a read on one game
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function tdPerGame(f) {
    var st = f.stats || {};
    return (6 * ((st.rushTD || 0) + (st.recTD || 0)) + 4 * (st.passTD || 0)) / f.games;
  }
  function rushPerGame(f) {
    var st = f.stats || {};
    return ((st.rushYd || 0) / 10 + 6 * (st.rushTD || 0)) / f.games;
  }
  function outWeeks(p) {
    var n = 0;
    (p.weeks || []).forEach(function (w) { if (w && w.out) n++; });
    return n;
  }
  // The work a teammate's absence opens is only the SAME work: a back's touches
  // go to backs, and receivers and tight ends draw on one pool of targets.
  function workGroup(position) { return position === 'RB' ? 'RB' : position === 'WR' || position === 'TE' ? 'PC' : ''; }

  function context(players, o) {
    o = o || {};
    var ppgOf = o.ppgOf || function (p) { return p.form ? p.form.ppg : null; };
    var byPos = {}, teamEnv = {}, open = {};
    (players || []).forEach(function (p) {
      var f = p.form;
      if (f && f.games > 0) {
        var ppg = ppgOf(p);
        if (ppg != null && isFinite(ppg)) {
          (byPos[p.position] = byPos[p.position] || []).push({ key: p.key, f: f, ppg: ppg });
        }
      }
      // One club's scoring environment is the same on every one of its rows,
      // so the first row to carry a week settles it.
      (p.weeks || []).forEach(function (w) {
        if (!w || w.bye || !w.env) return;
        var v = w.env.implied != null ? w.env.implied : w.env.expected;
        if (v == null || !isFinite(v)) return;
        var t = teamEnv[p.team] || (teamEnv[p.team] = {});
        if (t[w.week] == null) t[w.week] = v;
      });
      var g = workGroup(p.position), out = outWeeks(p);
      if (g && out && f && f.games >= MIN_GAMES && f.volume > 0) {
        var k = p.team + '|' + g;
        (open[k] = open[k] || []).push({ key: p.key, name: p.name, out: out, volume: f.volume, unit: f.volumeUnit,
          status: p.injury && p.injury.status ? p.injury.status : 'out' });
      }
    });

    var pos = {};
    Object.keys(byPos).forEach(function (k) {
      var list = byPos[k].filter(function (r) { return r.f.volume != null && r.f.volume > 0; })
        .sort(function (a, b) { return b.f.volume - a.f.volume; });
      var rank = {};
      list.forEach(function (r, i) { rank[r.key] = i + 1; });
      var pool = list.slice(0, POOL[k] || 0).filter(function (r) { return r.f.games >= MIN_GAMES && r.ppg > 0; });
      pos[k] = {
        volRank: rank, n: list.length, pool: pool.length,
        eff: median(pool.map(function (r) { return r.ppg / r.f.volume; })),
        tdShare: median(pool.map(function (r) { return Math.min(1, tdPerGame(r.f) / r.ppg); })),
        rushShare: median(pool.map(function (r) { return Math.min(1, rushPerGame(r.f) / r.ppg); }))
      };
    });

    var teams = Object.keys(teamEnv).map(function (t) {
      var ws = teamEnv[t], sum = 0, n = 0;
      Object.keys(ws).forEach(function (w) { sum += ws[w]; n++; });
      return { team: t, avg: n ? sum / n : null };
    }).filter(function (t) { return t.avg != null; }).sort(function (a, b) { return b.avg - a.avg; });
    var env = {};
    teams.forEach(function (t, i) { env[t.team] = { avg: t.avg, rank: i + 1 }; });

    return { pos: pos, env: env, teams: teams.length, open: open };
  }

  // THE READ. One sentence on what kind of production it is, because that is
  // what decides whether it lasts, and a points-a-game figure cannot say it.
  // Checked in order of how much it should change a reader's mind, and only
  // the first that fires is said: a touchdown-fed line first (the most
  // fragile), then volume that has not yet paid (the buy), then efficiency on
  // thin work (the sell), then volume at an ordinary rate (the safe kind).
  // A player who is none of these gets no read rather than a filler one.
  function readOf(p, ppg, c) {
    var f = p.form, P = c && c.pos ? c.pos[p.position] : null;
    if (!f || f.games < MIN_GAMES || !P || P.pool < 8 || !(ppg > 0)) return '';
    var pl = POS_LONG[p.position] || 'players';
    var typical = 'typical starter';
    var vr = P.volRank[p.key], deep = POOL[p.position] || 0;
    var td = Math.min(1, tdPerGame(f) / ppg);
    var pct = function (x) { return Math.round(x * 100) + '%'; };
    if (P.tdShare != null && td >= 0.4 && td - P.tdShare >= 0.12) {
      return 'Touchdowns are ' + pct(td) + ' of his points (' + typical + ': ' + pct(P.tdShare) +
        '), the least repeatable kind of scoring; expect it to cool unless his volume rises.';
    }
    if (p.position === 'QB') {
      var rs = Math.min(1, rushPerGame(f) / ppg);
      if (rs >= 0.25 && (P.rushShare == null || rs - P.rushShare >= 0.1)) {
        return 'His legs supply ' + pct(rs) + ' of his points (' + typical + ': ' + pct(P.rushShare || 0) +
          '), a floor most passers lack on a quiet day through the air.';
      }
      return '';
    }
    if (P.eff == null || vr == null || !(f.volume > 0)) return '';
    var eff = ppg / f.volume, unit = f.volumeUnit === 'touches' ? 'touch' : 'target';
    var r2 = function (x) { return (Math.round(x * 100) / 100).toFixed(2); };
    if (vr <= Math.ceil(deep / 3) && eff <= 0.8 * P.eff) {
      return 'The role is there (' + ord(vr) + ' in ' + esc(f.volumeUnit) + ' among ' + pl + ') but at ' +
        r2(eff) + ' points a ' + unit + ' (' + typical + ': ' + r2(P.eff) + ')' +
        (P.tdShare != null && td <= P.tdShare - 0.1 ? ', with few touchdowns,' : '') +
        ' the points lag it, and that gap usually closes.';
    }
    if (vr > Math.ceil(deep / 2) && eff >= 1.25 * P.eff) {
      return 'He is living on efficiency: ' + r2(eff) + ' points a ' + unit + ' (' + typical + ': ' + r2(P.eff) +
        ') on volume only ' + ord(vr) + ' among ' + pl + ', which rarely lasts without more of the ball.';
    }
    if (vr <= Math.ceil(deep / 4)) {
      return 'The production is built on volume (' + ord(vr) + ' in ' + esc(f.volumeUnit) + ' among ' + pl +
        ') at a normal rate per ' + unit + ', the most repeatable kind.';
    }
    return '';
  }

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
    var read = '';
    if (played) {
      var ppg = o.formPpg == null ? f.ppg : o.formPpg;
      read = readOf(p, ppg, o.ctx);
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
      // The two counts behind the percentage, where the worker sent them: "up
      // 35%" is a direction, "24 against an average of 17.8" is a role.
      var rt = p.roleTrend;
      s += ', with usage ' + (rt.pct > 0 ? 'up ' : 'down ') + Math.abs(rt.pct) + '% on his own average' +
        (rt.latestTouches != null && rt.avgTouches != null
          ? ' (' + rt.latestTouches + ' ' + (p.position === 'QB' ? 'plays' : 'touches and targets') + ' last week against ' + n1(rt.avgTouches) + ')'
          : '');
    }
    return s + '.' + (read ? ' ' + read : '');
  }

  // THE OPPORTUNITY LINE. What is in front of him, which on a one-week board is
  // a fixture and on every other horizon is a slate.
  function opportunity(p, o) {
    o = o || {};
    var hz = HZ[o.horizon] ? o.horizon : 'week';
    var base = hz === 'week' ? weekOpportunity(p) : slateOpportunity(p, hz, o.ctx);
    var more = [];
    var v = vacancy(p, hz, o.ctx);
    if (v) more.push(v);
    return base + (more.length ? ' ' + more.join(' ') : '');
  }

  // THE WORK A TEAMMATE LEAVES. The most direct opportunity there is: a back
  // whose partner is out inherits carries no projection had priced in. Named
  // only where the payload shows the teammate OUT on this board (weeks[].out)
  // and has his season volume, which is the number of touches or targets
  // actually left on the table. Not a claim about who gets them, which no
  // field here says; the sentence says the work is open, and stops.
  function vacancy(p, hz, c) {
    if (!c || !c.open || !(p.games > 0)) return '';
    var g = workGroup(p.position);
    // On a one-week board the only weeks are this one, so "out on this board"
    // already means out this week.
    var list = g ? (c.open[p.team + '|' + g] || []).filter(function (t) { return t.key !== p.key; }) : [];
    if (!list.length) return '';
    list.sort(function (a, b) { return b.volume - a.volume; });
    var t = list[0];
    // A depth player's two targets a game being "open" is not news.
    if (!(t.volume >= (t.unit === 'touches' ? 8 : 4))) return '';
    return esc(t.name) + ' is ' + (/^(out|ir)/i.test(t.status) ? 'out' : 'listed ' + esc(String(t.status).toLowerCase())) +
      (hz === 'week' ? ' this week' : ' for ' + plural(t.out, 'game') + ' on this board') + ', leaving his ' + vol(t.volume, t.unit) +
      ' ' + esc(t.unit) + ' a game to go elsewhere in this offense.';
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

  function slateOpportunity(p, hz, c) {
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
    var more = p.position === 'DST' ? [] : slateShape(p, hz, c);
    return bits.join(', ') + '.' + (more.length ? ' ' + more.join(' ') : '');
  }

  // WHEN THE SLATE IS EASY, AND WHAT HIS OFFENSE IS EXPECTED TO SCORE. One
  // average over thirteen games hides the two things a season-long manager
  // acts on: whether the soft games are now or later (hold, or sell high), and
  // what the slate looks like in weeks 15 to 17, when a title is decided. And
  // a matchup grade says nothing about the offense he plays in, which caps or
  // lifts every player in it. Each is said only where it is NOTABLE: an even
  // schedule, an average playoff draw and a mid-pack offense earn no words.
  function slateShape(p, hz, c) {
    var out = [];
    var games = (p.weeks || []).filter(function (w) { return w && !w.bye && !w.out && w.env && w.env.opponentDefRank; });
    var avg = function (ws) {
      var s = 0;
      ws.forEach(function (w) { s += w.env.opponentDefRank; });
      return ws.length ? s / ws.length : null;
    };
    if (games.length >= 6) {
      var early = games.slice(0, 4), late = games.slice(4), ea = avg(early), la = avg(late);
      if (Math.abs(ea - la) >= 5) {
        var soft = ea > la;
        out.push((soft ? 'The easy part is now' : 'The hard part is now') + ': his next four opponents average ' +
          ord(ea) + ' by points allowed, the ' + late.length + ' after that ' + ord(la) +
          (soft ? '.' : ', so the schedule eases.'));
      }
    }
    if (hz === 'ros') {
      var po = games.filter(function (w) { return w.week >= 15 && w.week <= 17; });
      if (po.length >= 2) {
        var pa = avg(po), g = gradeOf(pa);
        if (g !== 'an average') {
          out.push('Weeks 15 to 17, the fantasy playoffs, are ' + g + ' draw (opponents average ' + ord(pa) + ').');
        }
      }
    }
    var e = c && c.env ? c.env[p.team] : null;
    if (e && c.teams >= 20) {
      if (e.rank <= 8) {
        out.push('His offense projects for ' + n1(e.avg) + ' points a game over this stretch, ' + ord(e.rank) + ' of ' + c.teams + '.');
      } else if (e.rank > c.teams - 8) {
        out.push('His offense projects for only ' + n1(e.avg) + ' points a game over this stretch, ' + ord(e.rank) + ' of ' + c.teams + ', which caps everyone in it.');
      }
    }
    return out;
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

  window.ITReads = { cell: cell, player: player, opportunity: opportunity, context: context,
                     tierOf: tierOf, gradeOf: gradeOf, ord: ord, awayFrom: awayFrom,
                     plural: plural, listOf: listOf, TIERS: TIERS, POS_LONG: POS_LONG, HZ: HZ };
})();
