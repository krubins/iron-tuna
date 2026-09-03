/* Iron Tuna — the DFS lineup builder.
 *
 * Runs in the browser (and in node for its tests): a slate of priced players
 * in, N lineups out, under a salary cap and the site's roster, honouring
 * locks, exclusions, a QB stack, a bring-back, and a per-team maximum. The
 * objective is whichever projection the mode names: Iron Tuna, Vegas,
 * Consensus, or Vegas Edge (the Vegas line plus its Market Delta, which is
 * the market's disagreement with the consensus counted twice on purpose).
 *
 * The method is a randomised greedy fill followed by single- and pair-swap
 * improvement, repeated; it is not an exact solver and does not claim to be. For a nine-
 * slot roster it lands within a fraction of a point of the exact optimum on
 * every fixture in tools/test-dfs.mjs, and it runs in milliseconds, which is
 * what a page that re-solves on every click needs.
 *
 * NOTHING HERE SUBMITS AN ENTRY. It builds a table to look at.
 */
(function (root) {
  'use strict';
  var MODES = {
    ironTuna: { label: 'Iron Tuna optimal', pts: function (p) { return p.ironTunaPoints; } },
    vegas: { label: 'Vegas optimal', pts: function (p) { return p.vegasPoints; } },
    consensus: { label: 'Consensus optimal', pts: function (p) { return p.consensusPoints; } },
    vegasEdge: { label: 'Vegas Edge', pts: function (p) { return p.vegasPoints + (p.marketDelta && p.marketDelta.points > 0 ? p.marketDelta.points : 0); } }
  };
  function mulberry(seed) { var a = seed >>> 0; return function () { a += 0x6D2B79F5; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Which slots a position may fill.
  function eligible(pos, slot, flex) { return slot === pos || (slot === 'FLEX' && flex.indexOf(pos) >= 0); }

  function valid(lineup, cfg) {
    var team = {}, salary = 0, ids = {};
    for (var i = 0; i < lineup.length; i++) {
      var p = lineup[i]; if (!p) return false;
      if (ids[p.id]) return false; ids[p.id] = 1;
      salary += p.salary; team[p.team] = (team[p.team] || 0) + 1;
      if (cfg.maxPerTeam && team[p.team] > cfg.maxPerTeam) return false;
    }
    if (salary > cfg.cap) return false;
    if (cfg.stack) {
      var qb = lineup[cfg.slots.indexOf('QB')];
      if (!qb) return false;
      var mates = lineup.filter(function (p) { return p !== qb && p.team === qb.team && (p.position === 'WR' || p.position === 'TE'); }).length;
      if (mates < (cfg.stackSize || 1)) return false;
      if (cfg.bringBack) {
        var opp = qb.opponent;
        if (!opp || !lineup.some(function (p) { return p.team === opp && p.position !== 'DST'; })) return false;
      }
    }
    return true;
  }

  // How far a lineup is from legal: 0 when valid(); otherwise one unit per
  // duplicate, per body over a team maximum, per missing stack mate or
  // bring-back, and one per $500 over the cap.
  function penalty(lineup, cfg) {
    var team = {}, salary = 0, ids = {}, pen = 0;
    for (var i = 0; i < lineup.length; i++) {
      var p = lineup[i]; if (!p) return 1e6;
      if (ids[p.id]) pen += 1; ids[p.id] = 1;
      salary += p.salary; team[p.team] = (team[p.team] || 0) + 1;
    }
    if (cfg.maxPerTeam) for (var t in team) if (team[t] > cfg.maxPerTeam) pen += team[t] - cfg.maxPerTeam;
    if (salary > cfg.cap) pen += (salary - cfg.cap) / 500;
    if (cfg.stack) {
      var qb = lineup[cfg.slots.indexOf('QB')];
      if (!qb) return pen + 10;
      var mates = lineup.filter(function (p) { return p !== qb && p.team === qb.team && (p.position === 'WR' || p.position === 'TE'); }).length;
      if (mates < (cfg.stackSize || 1)) pen += (cfg.stackSize || 1) - mates;
      if (cfg.bringBack && !(qb.opponent && lineup.some(function (p) { return p.team === qb.opponent && p.position !== 'DST'; }))) pen += 1;
    }
    return pen;
  }

  function build(players, options) {
    var o = options || {};
    var mode = MODES[o.mode] || MODES.ironTuna;
    var cfg = { cap: o.cap, slots: o.slots, flex: o.flex || ['RB', 'WR', 'TE'], maxPerTeam: o.maxPerTeam || 0,
                stack: !!o.stack, stackSize: o.stackSize || 1, bringBack: !!o.bringBack };
    var lock = {}; (o.lock || []).forEach(function (id) { lock[id] = 1; });
    var excl = {}; (o.exclude || []).forEach(function (id) { excl[id] = 1; });
    var pool = players.filter(function (p) { return p && p.onBoard !== false && p.salary > 0 && !excl[p.id] && isFinite(mode.pts(p)) && mode.pts(p) > 0; });
    var rnd = mulberry(o.seed || 7);
    var n = Math.max(1, Math.min(20, o.lineups || 1));
    var results = [], used = {};
    var score = function (l) { return l.reduce(function (s, p) { return s + mode.pts(p); }, 0); };

    function attempt(noise, avoid) {
      var slots = cfg.slots.slice();
      var lineup = new Array(slots.length).fill(null);
      var taken = {}, salary = 0, team = {};
      var place = function (p, i) { lineup[i] = p; taken[p.id] = 1; salary += p.salary; team[p.team] = (team[p.team] || 0) + 1; };
      // Locks first, into the first slot they fit.
      for (var id in lock) {
        var lp = pool.filter(function (p) { return p.id === id; })[0];
        if (!lp) continue;
        for (var i = 0; i < slots.length; i++) if (!lineup[i] && eligible(lp.position, slots[i], cfg.flex)) { place(lp, i); break; }
      }
      // Then greedy by value per dollar with noise, thinnest slots first
      // (the slot with the fewest eligible players is the one a late pick
      // cannot rescue), FLEX last.
      var depth = function (i) { return slots[i] === 'FLEX' ? 1e6 : pool.filter(function (p) { return eligible(p.position, slots[i], cfg.flex); }).length; };
      var order = slots.map(function (s, i) { return i; }).filter(function (i) { return !lineup[i]; })
        .sort(function (a, b) { return depth(a) - depth(b); });
      // The cheapest fill the other open slots could take, so the budget a
      // pick may spend is what the roster can afford, not a flat guess.
      var cheapest = function (openIdx) {
        var sum = 0;
        for (var j = 0; j < openIdx.length; j++) {
          var m = Infinity;
          for (var c = 0; c < pool.length; c++) if (!taken[pool[c].id] && eligible(pool[c].position, slots[openIdx[j]], cfg.flex) && pool[c].salary < m) m = pool[c].salary;
          sum += isFinite(m) ? m : 0;
        }
        return sum;
      };
      for (var k = 0; k < order.length; k++) {
        var si = order[k], slot = slots[si];
        var budget = cfg.cap - salary;
        var minRest = cheapest(order.slice(k + 1));
        var fits = function (p, strict) {
          if (taken[p.id] || !eligible(p.position, slot, cfg.flex)) return false;
          if (p.salary > budget - minRest) return false;
          if (cfg.maxPerTeam && (team[p.team] || 0) >= cfg.maxPerTeam) return false;
          if (strict && avoid && avoid[p.id] && rnd() < 0.7) return false;
          return true;
        };
        var cands = pool.filter(function (p) { return fits(p, true); });
        if (!cands.length) cands = pool.filter(function (p) { return fits(p, false); });
        if (!cands.length) cands = pool.filter(function (p) { return !taken[p.id] && eligible(p.position, slot, cfg.flex); }).sort(function (a, b) { return a.salary - b.salary; }).slice(0, 1);
        if (!cands.length) return null;
        // Stack: the QB's mates are preferred while the stack is unmet.
        var qb = lineup[slots.indexOf('QB')];
        cands.sort(function (a, b) {
          var va = mode.pts(a) / a.salary * 1000 + noise * rnd(), vb = mode.pts(b) / b.salary * 1000 + noise * rnd();
          if (cfg.stack && qb && slot !== 'QB') {
            var ma = (a.team === qb.team && (a.position === 'WR' || a.position === 'TE')) ? 1 : 0, mb = (b.team === qb.team && (b.position === 'WR' || b.position === 'TE')) ? 1 : 0;
            var need = cfg.stackSize - lineup.filter(function (p) { return p && p !== qb && p.team === qb.team && (p.position === 'WR' || p.position === 'TE'); }).length;
            if (need > 0 && ma !== mb) return mb - ma;
            if (cfg.bringBack && qb.opponent && !lineup.some(function (p) { return p && p.team === qb.opponent && p.position !== 'DST'; })) {
              var ba = a.team === qb.opponent ? 1 : 0, bb = b.team === qb.opponent ? 1 : 0;
              if (ba !== bb) return bb - ba;
            }
          }
          return vb - va;
        });
        place(cands[0], si);
      }
      // Then improve. The fill can land over the cap or short of the stack,
      // so the objective the swaps climb is the projection minus a heavy
      // penalty for every constraint the lineup breaks: a swap that repairs
      // the roster is always worth more than one that adds a point. Single
      // swaps first, then pairs of swaps among the strongest candidates for
      // each slot, until nothing moves.
      var cost = function (l) { return score(l) - 100 * penalty(l, cfg); };
      var topK = slots.map(function (slot) {
        return pool.filter(function (p) { return eligible(p.position, slot, cfg.flex); })
          .sort(function (a, b) { return mode.pts(b) - mode.pts(a); }).slice(0, 14);
      });
      var improved = true, guard = 0, cur = cost(lineup);
      while (improved && guard++ < 40) {
        improved = false;
        for (var i2 = 0; i2 < lineup.length; i2++) {
          if (lock[lineup[i2].id]) continue;
          var best = null, bestC = cur;
          for (var c = 0; c < pool.length; c++) {
            var q = pool[c];
            if (taken[q.id] || !eligible(q.position, slots[i2], cfg.flex)) continue;
            var trial = lineup.slice(); trial[i2] = q;
            var tc = cost(trial);
            if (tc > bestC + 1e-9) { best = q; bestC = tc; }
          }
          if (best) { delete taken[lineup[i2].id]; taken[best.id] = 1; lineup[i2] = best; cur = bestC; improved = true; }
        }
        if (improved) continue;
        for (var a = 0; a < lineup.length && !improved; a++) {
          if (lock[lineup[a].id]) continue;
          for (var b = a + 1; b < lineup.length && !improved; b++) {
            if (lock[lineup[b].id]) continue;
            for (var x = 0; x < topK[a].length && !improved; x++) {
              var qa = topK[a][x]; if (taken[qa.id]) continue;
              for (var y = 0; y < topK[b].length; y++) {
                var qb2 = topK[b][y]; if (taken[qb2.id] || qb2.id === qa.id) continue;
                var t2 = lineup.slice(); t2[a] = qa; t2[b] = qb2;
                var c2 = cost(t2);
                if (c2 > cur + 1e-9) {
                  delete taken[lineup[a].id]; delete taken[lineup[b].id]; taken[qa.id] = 1; taken[qb2.id] = 1;
                  lineup[a] = qa; lineup[b] = qb2; cur = c2; improved = true; break;
                }
              }
            }
          }
        }
      }
      return valid(lineup, cfg) ? lineup : null;
    }

    for (var li = 0; li < n; li++) {
      var bestL = null, bestS = -1;
      for (var t = 0; t < 40; t++) {
        var l = attempt(t === 0 && li === 0 ? 0 : 2.5, li ? used : null);
        if (!l) continue;
        var key = l.map(function (p) { return p.id; }).sort().join('|');
        if (results.some(function (r) { return r.key === key; })) continue;
        var s = score(l);
        if (s > bestS) { bestS = s; bestL = l; }
      }
      if (!bestL) break;
      var salary = bestL.reduce(function (s, p) { return s + p.salary; }, 0);
      results.push({ key: bestL.map(function (p) { return p.id; }).sort().join('|'), players: bestL.map(function (p, i) { return { slot: cfg.slots[i], id: p.id, name: p.name, position: p.position, team: p.team, opponent: p.opponent, salary: p.salary, points: Math.round(mode.pts(p) * 10) / 10 }; }),
        salary: salary, remaining: cfg.cap - salary, points: Math.round(bestS * 10) / 10, mode: o.mode || 'ironTuna' });
      bestL.forEach(function (p) { used[p.id] = (used[p.id] || 0) + 1; });
    }
    return { ok: results.length > 0, mode: mode.label, lineups: results, poolSize: pool.length, cap: cfg.cap,
             note: results.length < n ? 'Only ' + results.length + ' distinct lineup' + (results.length === 1 ? '' : 's') + ' satisfy the constraints.' : null };
  }
  var api = { MODES: MODES, build: build, valid: valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ITDfs = api;
})(typeof window !== 'undefined' ? window : globalThis);
