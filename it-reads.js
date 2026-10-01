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
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : many || word + 's'); }
  function listOf(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  // THE BOARD AROUND HIM. A player's numbers mean nothing alone: is 7.1
  // targets a game a lot, is 15 yards a catch, is half his scoring coming from
  // touchdowns normal? The answer is the rest of the board, which the caller
  // already holds. So the caller builds this ONCE per render from every row
  // the payload carries, and both lines read a player against his position.
  //
  // Two reference groups, for two different questions. "Nth among receivers"
  // ranks him against every receiver who has played two games. "Unusual" is
  // judged against the position's STARTER pool (the top 24 QBs, 36 RBs, 48
  // WRs, 18 TEs by volume): a WR90's two targets a game would otherwise make
  // every starter look extreme on everything.
  //
  // Touchdown points are counted at 6 a rushing or receiving score and 4 a
  // passing one, which is what all three published presets pay.
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

  // THE METRICS. Each is one number off the season line that says something
  // a points-a-game figure cannot, defined per position because what matters
  // differs: a receiver's yards a catch, a back's catches, a passer's legs.
  // A metric returns null when the line cannot support it (too few catches
  // for a yards-a-catch figure to mean anything), and a null is never ranked.
  var METRICS = {
    vol: function (f) { return f.volume > 0 ? f.volume : null; },
    td: function (f, ppg) { return ppg > 3 ? Math.min(1, tdPerGame(f) / ppg) : null; },
    ypr: function (f) { var s = f.stats || {}; return (s.rec || 0) >= 4 ? s.recYd / s.rec : null; },
    ctch: function (f) { var s = f.stats || {}; return f.volume > 0 && (s.rec || 0) > 0 ? Math.min(1, s.rec / (f.volume * f.games)) : null; },
    recg: function (f) { var s = f.stats || {}; return (s.rec || 0) / f.games; },
    ypc: function (f) {
      var s = f.stats || {}, car = f.volume * f.games - (s.rec || 0);
      return car >= 12 ? (s.rushYd || 0) / car : null;
    },
    ptd: function (f) { var s = f.stats || {}; return (s.passTD || 0) / f.games; },
    int: function (f) { var s = f.stats || {}; return (s.passInt || 0) / f.games; },
    rush: function (f, ppg) { return ppg > 3 ? Math.min(1, rushPerGame(f) / ppg) : null; },
    snap: function (f) { return f.snapPct != null && isFinite(f.snapPct) ? (f.snapPct > 1 ? f.snapPct / 100 : f.snapPct) : null; }
  };
  var BY_POS = {
    WR: ['vol', 'td', 'ypr', 'ctch', 'snap'],
    TE: ['vol', 'td', 'ypr', 'ctch', 'snap'],
    RB: ['vol', 'td', 'recg', 'ypc', 'snap'],
    QB: ['vol', 'ptd', 'int', 'rush']
  };

  function context(players, o) {
    o = o || {};
    var ppgOf = o.ppgOf || function (p) { return p.form ? p.form.ppg : null; };
    var byPos = {}, teamEnv = {}, open = {}, sched = {};
    (players || []).forEach(function (p) {
      var f = p.form;
      if (f && f.games >= MIN_GAMES) {
        var ppg = ppgOf(p);
        if (ppg != null && isFinite(ppg)) (byPos[p.position] = byPos[p.position] || []).push({ p: p, f: f, ppg: ppg });
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
      if (p.scheduleDifficulty && p.scheduleDifficulty.avgOpponentDefRank != null) {
        (sched[p.position] = sched[p.position] || []).push(p.scheduleDifficulty.avgOpponentDefRank);
      }
      var g = workGroup(p.position), out = outWeeks(p);
      if (g && out && f && f.games >= MIN_GAMES && f.volume > 0) {
        var k = p.team + '|' + g;
        (open[k] = open[k] || []).push({ key: p.key, name: p.name, out: out, volume: f.volume, unit: f.volumeUnit,
          status: p.injury && p.injury.status ? p.injury.status : 'out' });
      }
    });

    var pos = {};
    Object.keys(byPos).forEach(function (k) {
      var all = byPos[k];
      var pool = all.filter(function (r) { return r.f.volume > 0; })
        .sort(function (a, b) { return b.f.volume - a.f.volume; }).slice(0, POOL[k] || 0);
      var m = {};
      (BY_POS[k] || []).forEach(function (name) {
        var fn = METRICS[name];
        var vals = function (rows) {
          return rows.map(function (r) { return fn(r.f, r.ppg); }).filter(function (v) { return v != null && isFinite(v); });
        };
        m[name] = { all: vals(all).sort(function (a, b) { return b - a; }), pool: vals(pool).sort(function (a, b) { return a - b; }) };
        m[name].median = median(m[name].pool);
      });
      var mk = all.map(function (r) { return r.p.marketDelta && r.p.marketDelta.rank != null ? Math.abs(r.p.marketDelta.rank) : null; })
        .filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
      pos[k] = { m: m, pool: pool.length, poolKeys: pool.reduce(function (o2, r) { o2[r.p.key] = 1; return o2; }, {}), mkt: mk };
    });

    var teams = Object.keys(teamEnv).map(function (t) {
      var ws = teamEnv[t], sum = 0, n = 0;
      Object.keys(ws).forEach(function (w) { sum += ws[w]; n++; });
      return { team: t, avg: n ? sum / n : null };
    }).filter(function (t) { return t.avg != null; }).sort(function (a, b) { return b.avg - a.avg; });
    var env = {};
    teams.forEach(function (t, i) { env[t.team] = { avg: t.avg, rank: i + 1 }; });
    Object.keys(sched).forEach(function (k) { sched[k].sort(function (a, b) { return a - b; }); });

    return { pos: pos, env: env, teams: teams.length, open: open, sched: sched };
  }

  // Where a value sits in a sorted list: 0 the bottom, 1 the top.
  function pctile(sorted, v) {
    if (!sorted || !sorted.length) return 0.5;
    var below = 0, eq = 0;
    for (var i = 0; i < sorted.length; i++) { if (sorted[i] < v) below++; else if (sorted[i] === v) eq++; }
    return (below + eq / 2) / sorted.length;
  }
  // His place among every player at the position with two games, 1 = most.
  // "the most" rather than "1st-most", and so on for the other ends.
  function endRank(r, word) { return r === 1 ? 'the ' + word : ord(r) + '-' + word; }
  function rankIn(desc, v) {
    var r = 1;
    for (var i = 0; i < desc.length; i++) if (desc[i] > v) r++;
    return r;
  }

  // THE SIGNALS. Every metric is scored for HOW UNUSUAL this player is on it,
  // as distance from the middle of the starter pool (0 typical, 1 the most
  // extreme), and the line says the most unusual one or two. That is what
  // makes the analysis his: a receiver whose targets are ordinary and whose
  // yards a catch lead the position gets a sentence about his yards a catch,
  // and the next row gets a sentence about whatever is unusual about HIM.
  // Percentiles are the same scale for every metric, so no one angle wins
  // every row by construction.
  //
  // Each sentence carries his own numbers and his rank, so two rows that land
  // on the same angle still say different things.
  function signals(p, ppg, o) {
    var f = p.form, c = o.ctx, P = c && c.pos ? c.pos[p.position] : null, out = [];
    var pl = POS_LONG[p.position] || 'players';
    var s = f.stats || {};
    var inPool = !!(P && P.poolKeys[p.key]);
    if (P && P.pool >= 8) {
      (BY_POS[p.position] || []).forEach(function (name) {
        var M = P.m[name], v = METRICS[name](f, ppg);
        if (!M || v == null || !isFinite(v) || M.pool.length < 8) return;
        var q = pctile(M.pool, v), x = Math.abs(2 * q - 1), hi = q >= 0.5;
        var rk = rankIn(M.all, v), lowRk = M.all.length - rk + 1;
        var t = phrase(name, hi, v, rk, lowRk, p, f, s, pl, M.median, inPool);
        if (t) out.push({ name: name, x: x, text: t });
      });
    }
    // Last week against his own average: a role on the move, measured on
    // HIS scale rather than the position's, so it is scored by its size.
    var rt = p.roleTrend;
    if (rt && rt.applied && rt.pct != null && Math.abs(rt.pct) >= 25 && rt.latestTouches != null && rt.avgTouches != null) {
      var unit = p.position === 'QB' ? 'plays' : p.position === 'RB' ? 'touches' : 'looks';
      out.push({ name: 'trend', x: Math.min(1, Math.abs(rt.pct) / 60),
        text: rt.pct > 0
          ? 'His work jumped last week: ' + rt.latestTouches + ' ' + unit + ' against a ' + n1(rt.avgTouches) + ' average, a role on the rise.'
          : 'His work fell last week: ' + rt.latestTouches + ' ' + unit + ' against a ' + n1(rt.avgTouches) + ' average, worth watching before you start him.' });
    }
    // The board against his own rate: a wide gap is the board saying the
    // start was a mirage, or that more is coming. Scored by the size of it.
    var pts = o.points;
    if (pts != null && isFinite(pts) && p.games > 0 && ppg > 3) {
      var fwd = pts / p.games, gap = (fwd - ppg) / ppg;
      if (Math.abs(gap) >= 0.2) {
        out.push({ name: 'fwd', x: Math.min(1, Math.abs(gap) / 0.6),
          text: gap < 0
            ? 'The board does not buy the start: it projects ' + n1(fwd) + ' a game from here against the ' + n1(ppg) + ' he has scored.'
            : 'The board expects more than he has shown: ' + n1(fwd) + ' a game from here against ' + n1(ppg) + ' so far.' });
      }
    }
    // The betting market against the consensus, in rank slots, where the
    // site's own classification calls it a real disagreement.
    var d = p.marketDelta;
    if (d && d.rank != null && d.classification && !/AGREE/i.test(d.classification) && P && P.mkt.length >= 8) {
      var mx = Math.abs(2 * pctile(P.mkt, Math.abs(d.rank)) - 1);
      out.push({ name: 'mkt', x: mx,
        text: 'Betting odds rank him ' + Math.abs(d.rank) + ' spot' + (Math.abs(d.rank) === 1 ? '' : 's') + ' ' +
          (d.rank > 0 ? 'higher' : 'lower') + ' than the consensus does, a gap the market is pricing that the experts are not.' });
    }
    return out.sort(function (a, b) { return b.x - a.x; });
  }

  // The words for one metric, in the direction he is unusual. A direction that
  // is not news (a deep reserve with few targets) returns '' and is skipped.
  function phrase(name, hi, v, rk, lowRk, p, f, s, pl, med, inPool) {
    var pc = function (x) { return Math.round(x * 100) + '%'; };
    var r1 = function (x) { return (Math.round(x * 10) / 10).toFixed(1); };
    var g = f.games, tds = (s.rushTD || 0) + (s.recTD || 0);
    switch (name) {
      case 'vol':
        if (p.position === 'QB') {
          return hi ? Math.round(v) + ' passing yards a game, ' + ord(rk) + ' among ' + pl + ', so the volume floor is real.'
            : inPool ? 'Only ' + Math.round(v) + ' passing yards a game (' + endRank(lowRk, 'fewest') + ' among ' + pl + '), so he needs touchdowns or his legs to pay.' : '';
        }
        var u = p.position === 'RB' ? 'touches' : 'targets';
        return hi ? r1(v) + ' ' + u + ' a game, ' + ord(rk) + ' among ' + pl + (p.position === 'RB' ? ', a workhorse share.' : ', so the role is not in doubt.')
          : inPool ? 'Only ' + r1(v) + ' ' + u + ' a game (' + ord(rk) + ' among ' + pl + (p.position === 'RB' ? '), a split backfield he has to beat.' : '), so his line leans on doing a lot with a little.') : '';
      case 'td':
        if (hi) {
          return (p.position === 'QB'
            ? 'Touchdowns are ' + pc(v) + ' of his points (typical starter: ' + pc(med) + ')'
            : plural(tds, 'touchdown') + ' in ' + plural(g, 'game') + ' make up ' + pc(v) + ' of his points (typical starter: ' + pc(med) + ')') +
            ', the part of a line least likely to repeat.';
        }
        return inPool && tds <= 1 ? (tds ? 'One touchdown' : 'No touchdowns') + ' in ' + plural(g, 'game') + ' despite the work, and scores tend to follow volume.' : '';
      case 'ypr':
        return hi ? r1(v) + ' yards a catch, ' + ord(rk) + ' among ' + pl + ': a downfield role with big weeks and quiet ones.'
          : r1(v) + ' yards a catch (' + endRank(lowRk, 'lowest') + ' among ' + pl + '), a short-area role that needs volume to pay.';
      case 'ctch':
        return hi ? 'Catches ' + pc(v) + ' of his targets, ' + ord(rk) + ' among ' + pl + ', a dependable floor in PPR.'
          : 'Catches only ' + pc(v) + ' of his targets (' + endRank(lowRk, 'lowest') + ' among ' + pl + '), so his volume is worth less than it looks.';
      case 'recg':
        return hi ? r1(v) + ' catches a game, ' + ord(rk) + ' among ' + pl + ', a receiving role that pays in PPR.'
          : inPool ? 'Almost no passing-game work (' + r1(v) + ' catches a game), so his weeks ride on carries and scores.' : '';
      case 'ypc':
        return hi ? r1(v) + ' yards a carry, ' + ord(rk) + ' among ' + pl + ', against ' + r1(med) + ' for a typical starter; efficiency like that tends to drift back.'
          : r1(v) + ' yards a carry (' + endRank(lowRk, 'lowest') + ' among ' + pl + ', typical starter ' + r1(med) + '), so the volume is doing the work.';
      case 'ptd':
        return hi ? r1(v) + ' touchdown passes a game, ' + ord(rk) + ' among ' + pl + '.'
          : inPool ? 'Just ' + plural(s.passTD || 0, 'touchdown pass', 'touchdown passes') + ' in ' + plural(g, 'game') + ', so the scoring has room to come.' : '';
      case 'int':
        return hi ? plural(s.passInt || 0, 'interception') + ' in ' + plural(g, 'game') + ', ' + endRank(rk, 'most') + ' among ' + pl + ', a drag on his floor.' : '';
      case 'rush':
        return hi ? 'His legs supply ' + pc(v) + ' of his points (typical starter: ' + pc(med) + '), a floor most passers lack.' : '';
      case 'snap':
        return hi ? 'On the field for ' + pc(v) + ' of snaps last week, an every-down role.'
          : inPool ? 'Played only ' + pc(v) + ' of snaps last week, a part-time role that caps his ceiling.' : '';
    }
    return '';
  }

  // THE PLAYER LINE. Where he ranks, then what is unusual about HIM.
  //
  // `o.rank` and `o.points` are the CALLER's, because only the caller knows
  // which board is on screen and at whose scoring it was computed. `o.points`
  // is the total over the horizon.
  //
  // POINTS A GAME IS NOT THE LEAD. It used to be ("14.2 points a game so far on
  // 7.1 targets over 4 games"), and it is the number every row already carries
  // in some form; a reader learns nothing from it. The line now leads on the
  // one or two things about his season that are least like the rest of his
  // position, and quotes points a game only where the board's projection
  // disagrees with it sharply enough to be the story.
  function player(p, o) {
    o = o || {};
    var hz = HZ[o.horizon] ? o.horizon : 'week';
    var rank = o.rank == null || !isFinite(o.rank) ? null : o.rank;
    // WHERE THE "#" COLUMN IS A POOLED RB/WR/TE SLOT the caller passes
    // spellOut: the compact "RB23" here would read as that same pooled number
    // and disagree with it.
    var head = rank == null ? esc(p.position)
      : o.spellOut && POS_LONG[p.position] ? ord(rank) + ' among ' + POS_LONG[p.position]
      : esc(p.position) + rank;
    // The points clause is dropped for a player with no game on this board: a
    // 0.0 there is an absence, not a projection.
    var pts = o.points;
    var proj = pts != null && isFinite(pts) && p.games > 0
      ? (hz === 'week' ? n1(pts) : n1(pts / p.games))
      : null;
    var f = p.form;
    var ppg = f && f.games > 0 ? (o.formPpg == null ? f.ppg : o.formPpg) : null;
    var played = ppg != null && isFinite(ppg);
    var lead = head + HZ[hz].when;
    var body = [];
    if (played && f.games >= MIN_GAMES) {
      var sig = signals(p, ppg, o);
      // The strongest angle always, a second only if it is also unusual and
      // says something different.
      if (sig.length && sig[0].x >= 0.5) body.push(sig[0].text);
      if (sig.length > 1 && sig[1].x >= 0.7) body.push(sig[1].text);
      if (!body.length) {
        var tier = tierOf(p.position, rank);
        body.push('Nothing in his line is far from a typical ' + (POS_LONG[p.position] ? POS_LONG[p.position].replace(/s$/, '') : 'player') +
          '\'s' + (proj != null ? '; the board has him at ' + proj + (hz === 'week' ? ' this week' : ' a game') : '') +
          (tier ? ', ' + tier : '') + '.');
      }
    } else if (played) {
      // One game is one game: say what it was and that it is not a read.
      body.push('One game played (' + n1(ppg) + ' points' +
        (f.volume != null && f.volumeUnit ? ' on ' + vol(f.volume, f.volumeUnit) + ' ' + esc(f.volumeUnit) : '') +
        '), too little to read' + (proj != null ? '; the board projects ' + proj + (hz === 'week' ? ' this week' : ' a game') : '') + '.');
    } else {
      // NOTHING PLAYED YET, so the tier is all the board has to say about him.
      var t0 = tierOf(p.position, rank);
      var bits = [];
      if (t0) bits.push(t0);
      if (proj != null) bits.push(proj + (hz === 'week' ? ' points projected' : ' points a game projected'));
      if (bits.length) lead += ', ' + bits.join(', ');
    }
    var s = lead;
    // An injury is the fact that changes a lineup, so it rides on the lead.
    if (p.injury && p.injury.status) {
      s += ', listed ' + esc(p.injury.status) +
        (p.injury.gamesOut ? ' for the next ' + (p.injury.gamesOut === 1 ? 'game' : p.injury.gamesOut + ' games') : '');
    }
    return s + '.' + (body.length ? ' ' + body.join(' ') : '');
  }

  // THE OPPORTUNITY LINE. What is in front of him, which on a one-week board is
  // a fixture and on every other horizon is a slate.
  function opportunity(p, o) {
    o = o || {};
    var hz = HZ[o.horizon] ? o.horizon : 'week';
    var base = hz === 'week' ? weekOpportunity(p) : slateOpportunity(p, hz, o.ctx);
    var more = [];
    // On a season board the vacancy is one of the slate's own signals.
    var v = hz === 'week' ? vacancy(p, hz, o.ctx) : '';
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

  // THE SLATE, LED BY WHAT IS UNUSUAL ABOUT IT. "13 games left, a bye in week
  // 11, against an average slate" is true of most of the league and was the
  // opening of every row. Now each thing a season-long manager acts on is
  // scored for how far it is from ordinary, and the line leads with the one
  // or two that are, so the next row says something else:
  //
  //   a teammate out whose work is open        (always notable)
  //   soft games now and hard later, or the reverse
  //   the fantasy playoffs, weeks 15 to 17, graded on their own
  //   his offense's projected scoring, among the top or bottom eight clubs
  //   his whole remaining slate, against everyone else at his position
  //
  // The games left and the bye close the line in a few words, because the
  // Games column already carries them. A slate with nothing unusual about it
  // says so, with the worker's own grade, so the sentence and the Schedule
  // column cannot disagree.
  function slateOpportunity(p, hz, c) {
    if (!(p.games > 0)) return 'No game on this board to grade.';
    var tail = plural(p.games, 'game') + ' ' + HZ[hz].slate +
      (p.byes && p.byes.length ? (p.byes.length === 1 ? ', bye in week ' + p.byes[0] : ', byes in weeks ' + listOf(p.byes)) : '');
    if (p.position === 'DST') {
      var d = avgAllowedDelta(p);
      return tail + (d == null
        ? ', and no posted line yet covers the offenses ahead of it.'
        : ', and the offenses ahead are implied ' + awayFrom(d, 'points a game') + ' what this defense allows across its own schedule.');
    }
    var sd = p.scheduleDifficulty;
    var grade = sd ? (sd.label === 'Hard' ? 'a hard' : sd.label === 'Easy' ? 'a soft' : 'an average') : '';
    var picks = slateSignals(p, hz, c).filter(function (x) { return x.x >= 0.5; }).slice(0, 2);
    if (!picks.length) {
      return tail + (sd
        ? ', against ' + grade + ' slate of defenses, averaging ' + ord(sd.avgOpponentDefRank) + ' by points allowed, with no stretch that stands out.'
        : ', against a slate this board cannot grade.');
    }
    return picks.map(function (x) { return x.text; }).join(' ') + ' ' + tail.charAt(0).toUpperCase() + tail.slice(1) + '.';
  }

  function slateSignals(p, hz, c) {
    var out = [];
    var v = vacancy(p, hz, c);
    if (v) out.push({ x: 0.95, text: v });
    var games = (p.weeks || []).filter(function (w) { return w && !w.bye && !w.out && w.env && w.env.opponentDefRank; });
    var avg = function (ws) {
      var s = 0;
      ws.forEach(function (w) { s += w.env.opponentDefRank; });
      return ws.length ? s / ws.length : null;
    };
    if (games.length >= 6) {
      var early = games.slice(0, 4), late = games.slice(4), ea = avg(early), la = avg(late), gap = Math.abs(ea - la);
      if (gap >= 4) {
        var soft = ea > la;
        out.push({ x: Math.min(1, gap / 10),
          text: (soft ? 'The easy part is now: his next four opponents average ' : 'The hard part is now: his next four opponents average ') +
            ord(ea) + ' by points allowed and the ' + late.length + ' after that ' + ord(la) +
            (soft ? ', so the next month is the time to play him or sell.' : ', so a slow stretch is the schedule and the back half eases.') });
      }
    }
    if (hz === 'ros') {
      var po = games.filter(function (w) { return w.week >= 15 && w.week <= 17; });
      if (po.length >= 2) {
        var pa = avg(po), g = gradeOf(pa);
        if (g !== 'an average') {
          out.push({ x: Math.min(1, Math.abs(pa - 16.5) / 10),
            text: 'The fantasy playoffs, weeks 15 to 17, are ' + g + ' draw (opponents average ' + ord(pa) + ').' });
        }
      }
    }
    var e = c && c.env ? c.env[p.team] : null;
    if (e && c.teams >= 20 && (e.rank <= 8 || e.rank > c.teams - 8)) {
      var top = e.rank <= 8;
      out.push({ x: Math.abs(2 * (1 - (e.rank - 0.5) / c.teams) - 1),
        text: 'His offense projects for ' + (top ? '' : 'only ') + n1(e.avg) + ' points a game over this stretch, ' + ord(e.rank) + ' of ' + c.teams +
          (top ? ', a lift for everyone in it.' : ', which caps everyone in it.') });
    }
    var sd = p.scheduleDifficulty, list = c && c.sched ? c.sched[p.position] : null;
    if (sd && list && list.length >= 12) {
      // Remaining slates bunch tightly (most average 14th to 19th), so a
      // percentile alone would call 18th "one of the softest". It has to be
      // far from the middle of the league in absolute terms too.
      var q = pctile(list, sd.avgOpponentDefRank);
      out.push({ x: Math.min(Math.abs(2 * q - 1), Math.abs(sd.avgOpponentDefRank - 16.5) / 5),
        text: (q >= 0.5 ? 'One of the softest remaining slates among ' : 'One of the hardest remaining slates among ') +
          (POS_LONG[p.position] || 'players') + ': opponents average ' + ord(sd.avgOpponentDefRank) + ' by points allowed.' });
    }
    return out.sort(function (a, b) { return b.x - a.x; });
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
