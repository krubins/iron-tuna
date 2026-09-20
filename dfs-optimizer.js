/* Iron Tuna — the DFS lineup builder.
 *
 * Runs in the browser (and in node for its tests): a slate of priced players
 * in, N lineups out, under the contest's cap and the contest's roster,
 * honoring locks, exclusions, a QB stack, a bring-back, and a per-team
 * maximum. The objective is whichever number the mode names: Iron Tuna,
 * Vegas, Consensus, Vegas Edge (the Vegas line plus its Market Delta, which
 * is the market's disagreement with the consensus counted twice on purpose),
 * or one of the three contest shapes -- floor, ceiling, leverage -- which
 * exist because the best lineup in a double-up is not the best lineup in a
 * 150,000-entry tournament.
 *
 * THE ROSTER IS NOT ALWAYS THE CLASSIC ONE. A lobby sells a dozen shapes of
 * contest and they do not share a roster, so for a year this file could only
 * answer one of them and every other Game Style on /dfs was met with "the
 * solver is hidden". FORMATS below is the table of what each one actually
 * builds, and build() solves whichever of them it is handed:
 *
 *   classic    — nine slots, one FLEX, the site's cap. What this always did.
 *   showdown   — a single game: one Captain at 1.5x points and 1.5x salary,
 *                five FLEX, any position in any seat, both teams represented.
 *                FanDuel sells the same roster and calls the seat MVP.
 *   tiers      — no salary cap at all. One player out of each posted tier, so
 *                the whole contest is which body inside a bucket, not price.
 *   draft      — a snake or a live draft. No cap either, because there is
 *                nothing to spend; what the solve is worth is the ORDER.
 *   picks      — Pick6 and the single-stat contests, which are not a roster:
 *                they ask for players and a direction on a posted line. These
 *                do not go through build() at all; pickBoard() answers them.
 *
 * The method for the roster formats is a randomized greedy fill followed by
 * single-swap, pair-swap and seat-exchange improvement, repeated; it is not an
 * exact solver and does not claim to be. For a nine-slot roster it lands
 * within a fraction of a point of the exact optimum on every fixture in
 * tools/test-dfs.mjs, and it runs in milliseconds, which is what a page that
 * re-solves on every click needs.
 *
 * A man who is not going to play on Sunday never reaches the board at all.
 * The slate decides that (rows carry available:false, and weekStatus says
 * why); this file only refuses to spend the cap on him, and a reader's lock
 * is the one thing that puts him back.
 *
 * NOTHING HERE SUBMITS AN ENTRY. It builds a table to look at.
 */
(function (root) {
  'use strict';
  // Floor and ceiling come off the slate when the server has computed them
  // (dfsMetrics writes floor/ceiling/ownership onto every priced row). When it
  // has not, they are reconstructed here from the same positional variance the
  // server uses, so a mode never silently degrades into the median projection.
  // These multipliers are HAND-SYNCED with DFS_VARIANCE in _worker.js.
  var VARIANCE = { QB: { floor: 0.62, ceil: 1.55 }, RB: { floor: 0.55, ceil: 1.75 }, WR: { floor: 0.45, ceil: 1.95 },
                   TE: { floor: 0.45, ceil: 1.9 }, DST: { floor: 0.4, ceil: 2.1 }, K: { floor: 0.5, ceil: 1.6 } };
  function band(p) { return VARIANCE[p.position] || VARIANCE.WR; }
  // A row the slate stands behind, whichever rung of the projection ladder
  // produced its number. This used to read `p.onBoard !== false`, which asked
  // whether the player was in the curated preseason pool -- a different
  // question, and the one that kept every $3,000 body off the optimizer even
  // after the slate had priced and measured him. A slate built before the
  // ladder existed carries no `projected`, so an onBoard row still qualifies.
  function projected(p) { return p && (p.projected === true || (p.projected === undefined && p.onBoard !== false)); }
  function ceilOf(p) { return isFinite(p.ceiling) && p.ceiling > 0 ? p.ceiling : p.ironTunaPoints * band(p).ceil; }
  function floorOf(p) { return isFinite(p.floor) && p.floor > 0 ? p.floor : p.ironTunaPoints * band(p).floor; }
  function ownOf(p) { return isFinite(p.ownership) && p.ownership > 0 ? p.ownership : null; }

  // The objective a mode climbs. The first four are projections; the last three
  // are contest shapes, and they exist because "the best lineup" is a different
  // lineup in a double-up than it is in a 150,000-entry tournament.
  //
  //   floor    — cash games. The worst plausible Sunday is what has to clear
  //              the line, so the roster is built on floors, not medians.
  //   ceiling  — small-field tournaments. The median stops mattering once you
  //              have to beat 200 people rather than 50% of them.
  //   leverage — large-field GPP. Ceiling discounted by how many other entries
  //              are expected to own the same player: a 22-point ceiling nobody
  //              is on is worth more than a 24-point ceiling half the field has.
  //              The discount is bounded so it tilts the roster toward the
  //              longer shots without handing every slot to an unownable body.
  var MODES = {
    ironTuna: { label: 'Iron Tuna optimal', pts: function (p) { return p.ironTunaPoints; } },
    vegas: { label: 'Vegas optimal', pts: function (p) { return p.vegasPoints; } },
    consensus: { label: 'Consensus optimal', pts: function (p) { return p.consensusPoints; } },
    vegasEdge: { label: 'Vegas Edge', pts: function (p) { return p.vegasPoints + (p.marketDelta && p.marketDelta.points > 0 ? p.marketDelta.points : 0); } },
    // The weekly betting market, taken at the strength of its own evidence.
    // `vegas` above maximizes the raw market number and cannot tell a quoted
    // prop from a game total sliced up, so it will spend $7,000 on a curve fit
    // that happens to read high. This one maximizes the slate's marketPoints:
    // the same number shrunk by how it was arrived at and pulled the rest of
    // the way back toward the consensus, which is also its fallback on a week
    // the books have not posted. It prefers the player somebody actually
    // priced, and when nobody was priced it quietly becomes the consensus
    // build rather than pretending otherwise.
    market: { label: 'Market read (props first)', pts: function (p) { return isFinite(p.marketPoints) ? p.marketPoints : (isFinite(p.ironTunaPoints) ? p.ironTunaPoints : 0); } },
    // `cash: true` marks a mode that is won on certainty rather than upside.
    // A supplemental projection is a season average -- what a man has already
    // done -- and a season average is the one number that cannot tell you
    // whether he has a floor THIS week. So these modes decline to spend the
    // cap on one unless the reader locks him, which is a decision, and the
    // builder does not overrule a decision.
    floor: { label: 'Safest floor', cash: true, pts: function (p) { return floorOf(p); } },
    ceiling: { label: 'Highest ceiling', pts: function (p) { return ceilOf(p); } },
    leverage: { label: 'Ceiling per point of ownership', pts: function (p) {
      var own = ownOf(p), c = ceilOf(p);
      if (own == null) return c;
      // 12% is the reference ownership: at 12 the multiplier is 1, chalk is
      // discounted toward 0.72 and a contrarian body is lifted toward 1.35.
      return c * Math.min(1.35, Math.max(0.72, Math.pow(12 / Math.max(2, own), 0.35)));
    } }
  };
  function mulberry(seed) { var a = seed >>> 0; return function () { a += 0x6D2B79F5; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ── what each contest actually builds ─────────────────────────────────────
  // A slot that names a position (QB, RB, DST) takes that position and nothing
  // else. Every other seat -- FLEX on the classic roster, CPT on a DraftKings
  // Showdown, MVP on a FanDuel single game, UTIL anywhere -- is an open seat,
  // and `flex` is the format's list of the positions allowed to sit in one.
  // That is the whole difference between a classic FLEX (three positions) and
  // a Showdown FLEX (all six), and it is why eligibility is a property of the
  // format rather than a constant in this file.
  var ANY_POSITION = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  var POSITION_SLOT = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 };
  var CLASSIC_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DST'];
  var CLASSIC_FLEX = ['RB', 'WR', 'TE'];

  // Verified against the operators' published rules, 20 Sep 2026. Both caps,
  // both multiplier seats and the both-teams rule are what the lobby enforces
  // at the moment this was written; when an operator changes one, THIS TABLE
  // is the only thing that should have to change. FanDuel moved its MVP to
  // 1.5x salary (it used to be free) and added a sixth seat in 2025, which is
  // why the two single-game rosters are now the same shape at different caps.
  var FORMATS = {
    'dk-classic': { key: 'dk-classic', kind: 'salary', site: 'dk', label: 'DraftKings Classic',
      roster: 'One QB, two RB, three WR, one TE, one FLEX and a defense, under a $50,000 cap.',
      cap: 50000, slots: CLASSIC_SLOTS, flex: CLASSIC_FLEX },
    'dk-showdown': { key: 'dk-showdown', kind: 'salary', site: 'dk', single: true, label: 'DraftKings Showdown Captain Mode',
      roster: 'One Captain and five FLEX out of a single game, under a $50,000 cap. The Captain scores 1.5x and costs 1.5x, and both teams have to be represented.',
      cap: 50000, slots: ['CPT', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], flex: ANY_POSITION,
      mult: { CPT: 1.5 }, minTeams: 2 },
    'fd-classic': { key: 'fd-classic', kind: 'salary', site: 'fd', label: 'FanDuel Classic',
      roster: 'One QB, two RB, three WR, one TE, one FLEX and a defense, under a $60,000 cap.',
      cap: 60000, slots: CLASSIC_SLOTS, flex: CLASSIC_FLEX },
    'fd-single': { key: 'fd-single', kind: 'salary', site: 'fd', single: true, label: 'FanDuel Single Game',
      roster: 'One MVP and five FLEX out of a single game, under a $60,000 cap. The MVP scores 1.5x and costs 1.5x, and both teams have to be represented.',
      cap: 60000, slots: ['MVP', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], flex: ANY_POSITION,
      mult: { MVP: 1.5 }, minTeams: 2 },
    // No cap, so there is no value-per-dollar to solve: the contest is one
    // body out of each posted bucket. The tiers come off the lobby file --
    // FanDuel prints a Tier column and DraftKings names the tier in the roster
    // position -- and tierFormat() below turns whatever the file carried into
    // a roster. A slate with no tiers on it cannot be solved as a Tiers
    // contest, and says so rather than inventing buckets out of salary.
    tiers: { key: 'tiers', kind: 'tiers', label: 'Tiers',
      roster: 'One player out of each posted tier. There is no salary cap, so the question at every tier is which body, never which price.',
      cap: 0, flex: ANY_POSITION },
    // A draft has no cap either, and the roster is filled a pick at a time
    // against opponents who are taking the same players. So the solve is a
    // TARGET -- the roster to draft toward if the board falls your way -- and
    // the order beside it is what to take first. Neither is a cap solution and
    // the page does not print one.
    draft: { key: 'draft', kind: 'draft', label: 'Snake draft',
      roster: 'A live draft has no salary cap; what it has is a board that empties. The roster below is the target and the order beside it is the priority.',
      cap: 0, slots: CLASSIC_SLOTS, flex: CLASSIC_FLEX },
    'draft-single': { key: 'draft-single', kind: 'draft', single: true, label: 'Single-game snake draft',
      roster: 'A live draft out of one game. No salary cap, six open seats, and the order beside the roster is the priority.',
      cap: 0, slots: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], flex: ANY_POSITION, minTeams: 2 },
    // Not a roster at all. Pick6 and the single-stat contests hand you a line
    // the operator posted and ask for a direction on it, so a lineup card
    // would be the wrong answer in the right shape. pickBoard() answers these.
    picks: { key: 'picks', kind: 'picks', label: 'Player picks',
      roster: 'These contests post their own line on a player and ask which side of it you want. There is no roster and no cap, so the answer is the players the model disagrees with the market about, and by how much.' },
    // Season-long. The site has a whole draft room for this and the weekly
    // slate is the wrong tool; naming it here is what keeps /dfs from
    // pretending otherwise.
    season: { key: 'season', kind: 'season', label: 'Best Ball',
      roster: 'Best Ball drafts once for a season and starts the best scorers for you. That is a draft question, not a slate question.' }
  };

  // The DraftKings lobby's Game Style, and which roster above it builds. The
  // Madden styles are the same rosters over a simulated slate, and In-Game
  // Showdown is the Showdown roster entered late -- the roster rules do not
  // change once the ball is in the air, only what is left to project.
  var GAME_STYLE_FORMAT = {
    classic: 'classic', 'madden-classic': 'classic',
    'showdown-captain': 'showdown', 'in-game-showdown': 'showdown', 'madden-showdown-captain': 'showdown',
    tiers: 'tiers',
    snake: 'draft', 'flash-draft': 'draft', 'snake-showdown': 'draft-single',
    pick6: 'picks', 'single-stat-yards': 'picks', 'single-stat-touchdowns': 'picks',
    'best-ball': 'season'
  };
  // A Game Style names a roster; the site names the cap and the seat. Resolve
  // both together so nothing downstream has to know that DraftKings calls the
  // multiplier seat a Captain and FanDuel calls it an MVP.
  function formatFor(site, gameStyle) {
    var s = site === 'fd' ? 'fd' : 'dk';
    var fam = GAME_STYLE_FORMAT[gameStyle] || 'classic';
    if (fam === 'classic') return FORMATS[s + '-classic'];
    if (fam === 'showdown') return FORMATS[s === 'fd' ? 'fd-single' : 'dk-showdown'];
    return FORMATS[fam] || FORMATS[s + '-classic'];
  }
  // A Tiers roster out of whatever tiers the lobby file actually carried. One
  // seat per distinct tier, in the file's own order, and nothing at all when
  // the file carried none -- a Tiers contest solved against invented buckets
  // is a lineup nobody can enter.
  function tierFormat(players) {
    var seen = {}, order = [];
    (players || []).forEach(function (p) {
      var t = p && p.tier != null && p.tier !== '' ? String(p.tier) : null;
      if (!t || seen[t]) return;
      seen[t] = 1; order.push(t);
    });
    order.sort(function (a, b) {
      var na = parseFloat(a), nb = parseFloat(b);
      if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    if (!order.length) return null;
    var slots = [], tierSlots = {};
    order.forEach(function (t, i) { var name = 'T' + (i + 1); slots.push(name); tierSlots[name] = t; });
    var f = FORMATS.tiers;
    return { key: 'tiers', kind: 'tiers', label: f.label, roster: f.roster, cap: 0,
             slots: slots, tierSlots: tierSlots, flex: ANY_POSITION, tiers: order };
  }

  // Which slots a player may fill. A tier seat asks one question and one only;
  // everything else is a position seat or an open seat.
  function eligible(p, slot, cfg) {
    if (cfg.tierSlots && cfg.tierSlots[slot] != null) return p.tier != null && String(p.tier) === String(cfg.tierSlots[slot]);
    if (slot === p.position) return true;
    return !POSITION_SLOT[slot] && (cfg.flex || CLASSIC_FLEX).indexOf(p.position) >= 0;
  }
  // A multiplier seat scores 1.5x and costs 1.5x. BOTH numbers, or the roster
  // is a fiction: a Captain carried at his FLEX price is several thousand
  // dollars of cap nobody gave you, and the lineup does not exist in the lobby.
  function slotMult(cfg, i) { var m = cfg.mult && cfg.mult[cfg.slots[i]]; return isFinite(m) && m > 0 ? m : 1; }
  function salAt(cfg, p, i) {
    var slot = cfg.slots[i];
    // The lobby file is the authority when it carries the number. DraftKings
    // exports the Captain as his own row at his own price, so a slate built
    // from that file knows what the seat costs rather than deriving it.
    if (p.salaryBySlot && isFinite(p.salaryBySlot[slot])) return Number(p.salaryBySlot[slot]);
    var base = Number(p.salary);
    if (!isFinite(base)) return 0;
    var m = slotMult(cfg, i);
    return m === 1 ? base : Math.round(base * m);
  }
  // The QB the stack is built around. On the classic roster he sits in the QB
  // slot; on a Showdown there is no QB slot at all and he is whichever seat a
  // quarterback took -- the Captain as often as not, which is the single most
  // common Showdown build there is.
  function qbOf(lineup, cfg) {
    var at = cfg.slots.indexOf('QB');
    if (at >= 0) return lineup[at] || null;
    for (var i = 0; i < lineup.length; i++) if (lineup[i] && lineup[i].position === 'QB') return lineup[i];
    return null;
  }

  function valid(lineup, cfg) {
    var team = {}, salary = 0, ids = {}, teams = 0;
    for (var i = 0; i < lineup.length; i++) {
      var p = lineup[i]; if (!p) return false;
      if (ids[p.id]) return false; ids[p.id] = 1;
      if (!eligible(p, cfg.slots[i], cfg)) return false;
      salary += salAt(cfg, p, i);
      if (!team[p.team]) teams++;
      team[p.team] = (team[p.team] || 0) + 1;
      if (cfg.maxPerTeam && team[p.team] > cfg.maxPerTeam) return false;
    }
    if (cfg.cap > 0 && salary > cfg.cap) return false;
    // Both teams, on a single-game roster. DraftKings and FanDuel both reject
    // an entry that is six bodies from one side, so a solver that can return
    // one is a solver that hands a reader a rejected entry.
    if (cfg.minTeams && teams < cfg.minTeams) return false;
    // A required player is a CONSTRAINT, not a preference. The greedy fill can
    // fail to seat one (two locked quarterbacks, a lock whose only slot was
    // taken), and a roster that quietly drops the player the reader asked for
    // is worse than no roster at all: it answers a question nobody asked.
    if (cfg.lock) for (var lid in cfg.lock) if (!ids[lid]) return false;
    if (cfg.stack) {
      var qb = qbOf(lineup, cfg);
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
  // duplicate, per body over a team maximum, per team short of the minimum,
  // per missing stack mate or bring-back, and one per $500 over the cap.
  function penalty(lineup, cfg) {
    var team = {}, salary = 0, ids = {}, pen = 0, teams = 0;
    for (var i = 0; i < lineup.length; i++) {
      var p = lineup[i]; if (!p) return 1e6;
      if (ids[p.id]) pen += 1; ids[p.id] = 1;
      salary += salAt(cfg, p, i);
      if (!team[p.team]) teams++;
      team[p.team] = (team[p.team] || 0) + 1;
    }
    if (cfg.lock) for (var lid in cfg.lock) if (!ids[lid]) pen += 1;
    if (cfg.maxPerTeam) for (var t in team) if (team[t] > cfg.maxPerTeam) pen += team[t] - cfg.maxPerTeam;
    if (cfg.minTeams && teams < cfg.minTeams) pen += cfg.minTeams - teams;
    if (cfg.cap > 0 && salary > cfg.cap) pen += (salary - cfg.cap) / 500;
    if (cfg.stack) {
      var qb = qbOf(lineup, cfg);
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
    // A format supplies the roster; explicit slots/cap/flex still win, because
    // the fine-tune panel lets a reader lower the cap on a format that names
    // one and the page has always passed those three straight through.
    var fmt = typeof o.format === 'string' ? FORMATS[o.format] : (o.format || null);
    var cap = o.cap != null ? o.cap : (fmt ? fmt.cap : 0);
    var cfg = { cap: isFinite(cap) && cap > 0 ? cap : 0,
                slots: o.slots || (fmt && fmt.slots) || CLASSIC_SLOTS,
                flex: o.flex || (fmt && fmt.flex) || CLASSIC_FLEX,
                mult: o.mult || (fmt && fmt.mult) || null,
                tierSlots: o.tierSlots || (fmt && fmt.tierSlots) || null,
                minTeams: o.minTeams != null ? o.minTeams : (fmt && fmt.minTeams) || 0,
                maxPerTeam: o.maxPerTeam || 0,
                stack: !!o.stack, stackSize: o.stackSize || 1, bringBack: !!o.bringBack };
    var capped = cfg.cap > 0;
    // A seat that pays a multiple has to be able to move between seats, and
    // the pair-swap below can only exchange a rostered player for a pool one.
    // Without this flag the Captain is whoever the greedy fill happened to
    // seat first, which is the difference between a Showdown build and a list.
    var multiplied = false;
    for (var mi = 0; mi < cfg.slots.length; mi++) if (slotMult(cfg, mi) !== 1) { multiplied = true; break; }
    var lock = {}; (o.lock || []).forEach(function (id) { lock[id] = 1; });
    var excl = {}; (o.exclude || []).forEach(function (id) { excl[id] = 1; });
    // A player who is not playing this week is not a cheap play, he is a zero,
    // and a zero at $5,800 is the worst thing this function can do with a cap.
    // The slate marks him available:false; he comes off the board before a
    // single lineup is seeded, unless the reader has explicitly locked him --
    // a lock is a decision, and the builder does not overrule a decision, it
    // only declines to make this one on its own.
    var benched = [], thin = [];
    var pool = players.filter(function (p) {
      // An uncapped format prices nobody, so a missing salary is the normal
      // state there rather than a row the board could not read.
      if (!(projected(p) && (capped ? p.salary > 0 : true) && !excl[p.id] && isFinite(mode.pts(p)) && mode.pts(p) > 0)) return false;
      if (p.available === false && !lock[p.id] && !o.includeUnavailable) { benched.push({ id: p.id, name: p.name, position: p.position, team: p.team, salary: p.salary, status: p.weekStatus || 'Out' }); return false; }
      // Reported the way the benched are, rather than dropped in silence: a
      // reader who asked for the safest floor is entitled to know which cheap
      // bodies were available and which the mode declined to reach for.
      if (p.supplemental && mode.cash && !lock[p.id] && !o.includeSupplemental) { thin.push({ id: p.id, name: p.name, position: p.position, team: p.team, salary: p.salary, basis: p.projectionBasis || 'usage' }); return false; }
      return true;
    });
    // A lock the board cannot honor -- a player who is off the slate, unpriced,
    // or excluded in the same breath -- is dropped here rather than made into a
    // constraint no lineup can satisfy. What survives, valid() enforces. An
    // unavailable player the reader locked stays: the filter above kept him.
    var inPool = {}; pool.forEach(function (p) { inPool[p.id] = 1; });
    for (var lid in lock) if (!inPool[lid]) delete lock[lid];
    cfg.lock = lock;
    var rnd = mulberry(o.seed || 7);
    var n = Math.max(1, Math.min(20, o.lineups || 1));
    var results = [], used = {};
    var score = function (l) { return l.reduce(function (s, p, i) { return s + mode.pts(p) * slotMult(cfg, i); }, 0); };
    // Two lineups made of the same six men with a different Captain are two
    // different entries, so on a multiplier roster the seat is part of what
    // makes a lineup distinct. On a classic roster it is not, and the key is
    // the sorted list of ids it has always been.
    var keyOf = function (l) {
      return l.map(function (p, i) { return (multiplied && slotMult(cfg, i) !== 1 ? cfg.slots[i] + ':' : '') + p.id; }).sort().join('|');
    };

    function attempt(noise, avoid) {
      var slots = cfg.slots.slice();
      var lineup = new Array(slots.length).fill(null);
      var taken = {}, salary = 0, team = {};
      var place = function (p, i) { lineup[i] = p; taken[p.id] = 1; salary += salAt(cfg, p, i); team[p.team] = (team[p.team] || 0) + 1; };
      // Locks first, into a dedicated slot before the open seats: a required
      // running back who takes the FLEX because it was scanned first strands
      // the other required back with nowhere legal to sit.
      for (var id in lock) {
        var lp = pool.filter(function (p) { return p.id === id; })[0];
        if (!lp) continue;
        var fit = [];
        for (var i = 0; i < slots.length; i++) if (!lineup[i] && eligible(lp, slots[i], cfg)) fit.push(i);
        fit.sort(function (a, b) { return (POSITION_SLOT[slots[a]] ? 0 : 1) - (POSITION_SLOT[slots[b]] ? 0 : 1); });
        if (fit.length) place(lp, fit[0]);
      }
      // Then greedy by value per dollar with noise, thinnest slots first
      // (the slot with the fewest eligible players is the one a late pick
      // cannot rescue), open seats last.
      // A position seat and a tier seat both draw from a narrow list, so they
      // are filled first; an open seat can take anyone left and goes last.
      var narrow = function (i) { return !!POSITION_SLOT[slots[i]] || !!(cfg.tierSlots && cfg.tierSlots[slots[i]] != null); };
      var depth = function (i) { return narrow(i) ? pool.filter(function (p) { return eligible(p, slots[i], cfg); }).length : 1e6; };
      var order = slots.map(function (s, i) { return i; }).filter(function (i) { return !lineup[i]; })
        .sort(function (a, b) { return depth(a) - depth(b); });
      // The cheapest fill the other open slots could take, so the budget a
      // pick may spend is what the roster can afford, not a flat guess.
      var cheapest = function (openIdx) {
        if (!capped) return 0;
        var sum = 0;
        for (var j = 0; j < openIdx.length; j++) {
          var m = Infinity;
          for (var c = 0; c < pool.length; c++) if (!taken[pool[c].id] && eligible(pool[c], slots[openIdx[j]], cfg) && salAt(cfg, pool[c], openIdx[j]) < m) m = salAt(cfg, pool[c], openIdx[j]);
          sum += isFinite(m) ? m : 0;
        }
        return sum;
      };
      for (var k = 0; k < order.length; k++) {
        var si = order[k], slot = slots[si];
        var budget = capped ? cfg.cap - salary : Infinity;
        var minRest = cheapest(order.slice(k + 1));
        var fits = function (p, strict) {
          if (taken[p.id] || !eligible(p, slot, cfg)) return false;
          if (capped && salAt(cfg, p, si) > budget - minRest) return false;
          if (cfg.maxPerTeam && (team[p.team] || 0) >= cfg.maxPerTeam) return false;
          if (strict && avoid && avoid[p.id] && rnd() < 0.7) return false;
          return true;
        };
        var cands = pool.filter(function (p) { return fits(p, true); });
        if (!cands.length) cands = pool.filter(function (p) { return fits(p, false); });
        if (!cands.length) cands = pool.filter(function (p) { return !taken[p.id] && eligible(p, slot, cfg); }).sort(function (a, b) { return salAt(cfg, a, si) - salAt(cfg, b, si); }).slice(0, 1);
        if (!cands.length) return null;
        // Stack: the QB's mates are preferred while the stack is unmet.
        var qb = qbOf(lineup, cfg);
        var rank = function (p) {
          // With no cap there is no per-dollar question: an uncapped format is
          // won by taking the most points, and dividing by a salary the
          // contest never charges would rank the board by price for nothing.
          return capped ? mode.pts(p) / Math.max(1, salAt(cfg, p, si)) * 1000 : mode.pts(p);
        };
        cands.sort(function (a, b) {
          var va = rank(a) + noise * rnd(), vb = rank(b) + noise * rnd();
          if (cfg.stack && qb && a !== qb && b !== qb) {
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
      // each slot, then -- on a roster with a multiplier seat -- exchanging
      // two rostered players' seats, until nothing moves.
      var cost = function (l) { return score(l) - 100 * penalty(l, cfg); };
      var topK = slots.map(function (slot) {
        return pool.filter(function (p) { return eligible(p, slot, cfg); })
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
            if (taken[q.id] || !eligible(q, slots[i2], cfg)) continue;
            var trial = lineup.slice(); trial[i2] = q;
            var tc = cost(trial);
            if (tc > bestC + 1e-9) { best = q; bestC = tc; }
          }
          if (best) { delete taken[lineup[i2].id]; taken[best.id] = 1; lineup[i2] = best; cur = bestC; improved = true; }
        }
        if (improved) continue;
        // Who wears the multiplier. Both the points and the salary scale by
        // the same 1.5, so value per dollar cannot tell the greedy fill which
        // of six men to captain -- it is the same ratio for all of them. The
        // answer only shows up in the TOTAL, which is what this move reads.
        if (multiplied) {
          for (var s1 = 0; s1 < lineup.length && !improved; s1++) {
            for (var s2 = s1 + 1; s2 < lineup.length; s2++) {
              if (slotMult(cfg, s1) === slotMult(cfg, s2)) continue;
              if (!eligible(lineup[s2], slots[s1], cfg) || !eligible(lineup[s1], slots[s2], cfg)) continue;
              var t3 = lineup.slice(); t3[s1] = lineup[s2]; t3[s2] = lineup[s1];
              var c3 = cost(t3);
              if (c3 > cur + 1e-9) { lineup[s1] = t3[s1]; lineup[s2] = t3[s2]; cur = c3; improved = true; break; }
            }
          }
          if (improved) continue;
        }
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
        var key = keyOf(l);
        if (results.some(function (r) { return r.key === key; })) continue;
        var s = score(l);
        if (s > bestS) { bestS = s; bestL = l; }
      }
      if (!bestL) break;
      var salary = bestL.reduce(function (s, p, i) { return s + salAt(cfg, p, i); }, 0);
      // The objective is `points`, and it is not always a projection: in the
      // leverage mode it is a discounted ceiling, which is a ranking number and
      // not a total anybody should read as "what this lineup scores". So the
      // real projection, the floor, the ceiling and the modeled ownership ride
      // alongside it and the page prints those.
      //
      // Every number below that answers "what does THIS SEAT contribute" is
      // scaled by the seat's multiplier -- the salary charged, the points, the
      // projection, the floor and ceiling, the operator's average and the
      // market read -- because that is what the seat is worth and what the
      // lineup totals have to add up to. The numbers that describe the PLAYER
      // rather than the seat (his ownership, his touchdown probability, his
      // team's total, the raw Vegas and consensus lines) are his own and are
      // left alone. `baseSalary`, `baseProj` and `multiplier` ride along so a
      // card can print both halves of that.
      var owned = bestL.map(ownOf).filter(function (v) { return v != null; });
      var seat = function (p, i, v) { return v == null || !isFinite(v) ? null : Math.round(v * slotMult(cfg, i) * 10) / 10; };
      results.push({ key: keyOf(bestL), players: bestL.map(function (p, i) { return { slot: cfg.slots[i], multiplier: slotMult(cfg, i), tier: p.tier != null ? p.tier : null,
          id: p.id, name: p.name, position: p.position, team: p.team, opponent: p.opponent,
          salary: salAt(cfg, p, i), baseSalary: isFinite(p.salary) ? Number(p.salary) : null,
          points: Math.round(mode.pts(p) * slotMult(cfg, i) * 10) / 10,
          proj: seat(p, i, p.ironTunaPoints), baseProj: isFinite(p.ironTunaPoints) ? Math.round(p.ironTunaPoints * 10) / 10 : null,
          operatorFppg: p.operatorFppg == null ? null : seat(p, i, Number(p.operatorFppg)),
          operatorFppgBasis: p.operatorFppg == null ? null : (p.operatorFppgBasis || 'operator'),
          projectionVsFppg: p.projectionVsFppg == null ? null : seat(p, i, Number(p.projectionVsFppg)),
          floor: seat(p, i, floorOf(p)), ceiling: seat(p, i, ceilOf(p)), ownership: ownOf(p), leverage: isFinite(p.leverage) ? p.leverage : null,
          // The market evidence rides along so a card can say what the books
          // said about a man rather than only what he is projected for. These
          // also feed the fit lines, which had been reading vegasPoints and
          // teamTotal off an object that never carried either.
          vegasPoints: isFinite(p.vegasPoints) ? p.vegasPoints : null, consensusPoints: isFinite(p.consensusPoints) ? p.consensusPoints : null,
          marketPoints: isFinite(p.marketPoints) ? seat(p, i, p.marketPoints) : null, marketQuoted: !!p.marketQuoted,
          market: p.market || null, teamTotal: isFinite(p.teamTotal) ? p.teamTotal : null,
          tdProbability: isFinite(p.tdProbability) ? p.tdProbability : null, tdBasis: p.tdBasis || null, tdBooks: isFinite(p.tdBooks) ? p.tdBooks : null,
          // Where this seat's number came from. A card that prints a $3,000
          // body next to a $9,000 one owes the reader the difference between
          // a blended projection and a season average.
          projectionBasis: p.projectionBasis || 'board', supplemental: !!p.supplemental,
          weekStatus: p.weekStatus || null, available: p.available !== false }; }),
        salary: salary, remaining: capped ? cfg.cap - salary : null, points: Math.round(bestS * 10) / 10, mode: o.mode || 'ironTuna',
        projPoints: Math.round(bestL.reduce(function (s, p, i) { return s + p.ironTunaPoints * slotMult(cfg, i); }, 0) * 10) / 10,
        floorPoints: Math.round(bestL.reduce(function (s, p, i) { return s + floorOf(p) * slotMult(cfg, i); }, 0) * 10) / 10,
        ceilingPoints: Math.round(bestL.reduce(function (s, p, i) { return s + ceilOf(p) * slotMult(cfg, i); }, 0) * 10) / 10,
        ownership: owned.length === bestL.length ? Math.round(owned.reduce(function (s, v) { return s + v; }, 0) * 10) / 10 : null,
        marketPoints: Math.round(bestL.reduce(function (s, p, i) { return s + (isFinite(p.marketPoints) ? p.marketPoints * slotMult(cfg, i) : 0); }, 0) * 10) / 10,
        quoted: bestL.filter(function (p) { return p.marketQuoted; }).length,
        supplemental: bestL.filter(function (p) { return p.supplemental; }).length });
      bestL.forEach(function (p) { used[p.id] = (used[p.id] || 0) + 1; });
    }
    return { ok: results.length > 0, mode: mode.label, lineups: results, poolSize: pool.length, cap: cfg.cap,
             format: fmt ? fmt.key : null, formatLabel: fmt ? fmt.label : null, kind: fmt ? fmt.kind : 'salary',
             slots: cfg.slots.slice(), capped: capped, multiplier: cfg.mult || null, minTeams: cfg.minTeams || 0,
             benched: benched, benchedCount: benched.length,
             thin: thin, thinCount: thin.length,
             note: results.length < n ? 'Only ' + results.length + ' distinct lineup' + (results.length === 1 ? ' satisfies' : 's satisfy') + ' the constraints.' : null };
  }

  // ── the contests that are not a roster ───────────────────────────────────
  // Pick6 and the single-stat contests post their own line on a player and ask
  // which side of it you want. There is no cap and no roster, so a lineup card
  // would be the wrong answer in the right shape. What the model can honestly
  // offer is the players it disagrees with the MARKET about most, and by how
  // much -- a posted line is beatable exactly where somebody's number is wrong,
  // and the size of the disagreement is the whole case for taking a side.
  //
  // The operator's own line is not in this data and this does not pretend it
  // is: `basis` says whether the comparison was against a quoted prop or
  // against the game line sliced up, and an unquoted read is the weaker case
  // by construction. The touchdown variant ranks on the anytime-touchdown
  // number instead, because that is the stat that contest settles on.
  function pickBoard(players, options) {
    var o = options || {};
    var n = Math.max(1, Math.min(24, o.picks || 6));
    var stat = o.stat === 'touchdowns' ? 'touchdowns' : o.stat === 'yards' ? 'yards' : 'points';
    var pool = (players || []).filter(function (p) {
      return projected(p) && p.available !== false && isFinite(p.ironTunaPoints) && p.ironTunaPoints > 0;
    });
    var rows = pool.map(function (p) {
      var market = isFinite(p.marketPoints) ? p.marketPoints : (isFinite(p.consensusPoints) ? p.consensusPoints : null);
      var edge = market == null ? null : Math.round((p.ironTunaPoints - market) * 10) / 10;
      return { id: p.id, name: p.name, position: p.position, team: p.team, opponent: p.opponent,
               salary: isFinite(p.salary) ? Number(p.salary) : null,
               proj: Math.round(p.ironTunaPoints * 10) / 10,
               market: market == null ? null : Math.round(market * 10) / 10,
               edge: edge, direction: edge == null ? null : (edge >= 0 ? 'more' : 'less'),
               tdProbability: isFinite(p.tdProbability) ? p.tdProbability : null,
               // A supplemental row has no game line behind it either: its
               // number is his own season average, and calling that a
               // game-line read would overstate the case for taking a side.
               basis: p.marketQuoted ? 'quoted-prop' : p.supplemental ? 'season-average' : 'game-line',
               quoted: !!p.marketQuoted, supplemental: !!p.supplemental };
    }).filter(function (r) { return stat === 'touchdowns' ? r.tdProbability != null : r.edge != null; });
    rows.sort(function (a, b) {
      if (stat === 'touchdowns') return (b.tdProbability - a.tdProbability) || (Math.abs(b.edge || 0) - Math.abs(a.edge || 0));
      // A quoted disagreement is a disagreement with money; an unquoted one is
      // two models arguing. Both are printed, the quoted one first.
      if (a.quoted !== b.quoted) return a.quoted ? -1 : 1;
      return Math.abs(b.edge) - Math.abs(a.edge);
    });
    var picks = rows.slice(0, n);
    var quoted = picks.filter(function (r) { return r.quoted; }).length;
    return { ok: picks.length > 0, kind: 'picks', stat: stat, picks: picks, poolSize: pool.length,
             quoted: quoted, of: picks.length,
             note: !picks.length ? 'Nothing on this slate carries both a projection and a market number to compare it to.'
                 : quoted ? quoted + ' of these ' + picks.length + ' carry a posted prop; the rest are the game line sliced up, which is a weaker case for taking a side.'
                 : 'The books have not posted props on this slate, so every read here is the game line sliced up rather than a disagreement with money.' };
  }

  // ── what an ordinary entry scores ────────────────────────────────────────
  // A projection printed by itself has no scale. 133.8 is a good number or a
  // bad one entirely according to what the rest of the field puts up, and the
  // page never said what that was. This is the second number: what a typical
  // entry on this slate, under this cap, in this roster format, projects for.
  //
  // It is built out of the one thing the slate already models about the
  // field, which is projected ownership -- the share of entries expected to
  // roster a man (MODELED on this site, not a licensed feed; see
  // docs/dfs-metrics.md). The method is to draw entries the way the field
  // fills them: seat by seat in a shuffled order, each seat taken by a player
  // eligible for it with probability proportional to his ownership, nobody
  // twice, and nobody the remaining budget cannot afford once the other open
  // seats are paid for. Average what those entries project for.
  //
  // IT IS A SAMPLE MEAN, AND IT IS DRAWN THAT WAY ON PURPOSE. The obvious
  // shortcut -- average each seat's eligible players by ownership and add the
  // seats up -- is not the average of any field, because nothing in it has to
  // pay for itself: it prices every seat as if the other eight were free. On
  // the test fixture that shortcut returned a "typical entry" twenty points
  // ABOVE the optimal lineup, which is a provable impossibility, since the
  // optimum is the most any legal roster projects for. Tilting the weights
  // toward cheaper players until the average spend hits the cap fixed the
  // size of the error and not its nature; it was still above the optimum.
  // Drawing whole legal rosters cannot be: every entry in the sample is one
  // somebody could submit, so their average is under the best of them.
  //
  // The draw is seeded, so a board that has not changed prints the same
  // number every time it is solved. What it is NOT: an optimum, a cash line,
  // or a score any particular entry will land on. The field's average does
  // not win a tournament and is not offered as a target -- it is the bar a
  // build clears before its other claims matter.
  function fieldAverage(players, options) {
    var o = options || {};
    var slots = o.slots || [];
    var flex = o.flex || CLASSIC_FLEX;
    var cap = isFinite(o.cap) && o.cap > 0 ? Number(o.cap) : 0;
    // The seats of whatever roster this is. A Showdown's Captain charges half
    // again as much and scores half again as much, so the field's entries are
    // drawn against the seat's numbers, not the man's -- an average entry
    // priced at FLEX salaries across a Captain roster is an average of
    // rosters nobody could submit.
    var cfg = { slots: slots, flex: flex, mult: o.mult || null, tierSlots: o.tierSlots || null };
    var minTeams = o.minTeams || 0;
    // Four thousand draws holds the printed tenth steady: across seeds the
    // sample mean of a full main slate moves by about a quarter point, and
    // the seed is fixed anyway, so the same board always prints the same
    // number. It costs a few tens of milliseconds next to the solve's
    // seconds.
    var trials = Math.max(200, Math.min(20000, o.trials || 4000));
    if (!slots.length || !cap) return null;
    // The field is the field. A reader's locks and exclusions change his own
    // roster, not what the other entries are going to own, so neither is
    // applied here. The unavailable do come off: nobody's average entry
    // starts a man who is not playing.
    var pool = (players || []).filter(function (p) {
      return projected(p) && p.available !== false && p.salary > 0
        && isFinite(p.ironTunaPoints) && p.ironTunaPoints > 0
        && isFinite(p.ownership) && p.ownership > 0;
    });
    if (pool.length < slots.length) return null;
    // Who can sit in which seat, and the cheapest body each seat could ever
    // be filled with, resolved once: both are asked for on every one of the
    // thousands of draws below and neither changes between them. The seats
    // are kept as parallel numeric arrays rather than lists of player
    // objects, because the draw walks them end to end a few hundred thousand
    // times and a property lookup per step is the whole cost of this.
    var seats = [], floorCost = [];
    for (var i = 0; i < slots.length; i++) {
      var idx = [], min = Infinity;
      for (var j = 0; j < pool.length; j++) {
        if (!eligible(pool[j], slots[i], cfg)) continue;
        idx.push(j); if (salAt(cfg, pool[j], i) < min) min = salAt(cfg, pool[j], i);
      }
      // A seat no available, owned player can fill has no average, and eight
      // seats out of nine is not an entry.
      if (!idx.length) return null;
      var seat = { n: idx.length, at: new Int32Array(idx.length), own: new Float64Array(idx.length),
                   sal: new Float64Array(idx.length), pts: new Float64Array(idx.length) };
      var m = slotMult(cfg, i);
      for (var c0 = 0; c0 < idx.length; c0++) {
        var q = pool[idx[c0]];
        seat.at[c0] = idx[c0]; seat.own[c0] = q.ownership;
        seat.sal[c0] = salAt(cfg, q, i); seat.pts[c0] = q.ironTunaPoints * m;
      }
      seats.push(seat); floorCost.push(min);
    }
    var rnd = mulberry(o.seed || 7);
    var order = [], taken = new Uint8Array(pool.length), chosen = new Int32Array(slots.length);
    for (var s0 = 0; s0 < slots.length; s0++) order.push(s0);
    var drawn = 0, total = 0, spend = 0;
    for (var t = 0; t < trials; t++) {
      // Shuffle the seats. Filling them in a fixed order would hand the last
      // seat every one of the cap's rounding errors and quietly make one slot
      // the slate's bargain bin in every entry the sample draws.
      for (var sh = order.length - 1; sh > 0; sh--) {
        var k = Math.floor(rnd() * (sh + 1)), tmp = order[sh]; order[sh] = order[k]; order[k] = tmp;
      }
      var salary = 0, pts = 0, filled = 0, dead = false;
      for (var a = 0; a < order.length && !dead; a++) {
        var seat2 = seats[order[a]];
        // What the other open seats still have to be paid for.
        var rest = 0;
        for (var b = a + 1; b < order.length; b++) rest += floorCost[order[b]];
        var room = cap - salary - rest;
        var w = 0, c, at;
        for (c = 0; c < seat2.n; c++) { if (!taken[seat2.at[c]] && seat2.sal[c] <= room) w += seat2.own[c]; }
        if (!(w > 0)) { dead = true; break; }
        var hit = rnd() * w, pick = -1;
        for (c = 0; c < seat2.n; c++) {
          if (taken[seat2.at[c]] || seat2.sal[c] > room) continue;
          hit -= seat2.own[c]; if (hit <= 0) { pick = c; break; }
        }
        if (pick < 0) { dead = true; break; }
        at = seat2.at[pick]; taken[at] = 1; chosen[filled++] = at;
        salary += seat2.sal[pick]; pts += seat2.pts[pick];
      }
      // Both teams, where the roster requires them. The whole claim this
      // number rests on is that every entry in the sample is one somebody
      // could submit; a six-man Showdown entry from one side of the game is
      // rejected at the lobby, so it is rejected here rather than averaged in.
      if (!dead && minTeams > 1) {
        var side = {}, sides = 0;
        for (var g = 0; g < filled; g++) { var tm = pool[chosen[g]].team; if (!side[tm]) { side[tm] = 1; sides++; } }
        if (sides < minTeams) dead = true;
      }
      for (var f = 0; f < filled; f++) taken[chosen[f]] = 0;
      if (dead) continue;
      drawn++; total += pts; spend += salary;
    }
    // A board that cannot be filled legally has no typical entry, and a
    // sample too thin to average is not one either: a board where nine legal
    // seats can hardly be drawn at all is a board whose typical entry this
    // does not know, and saying so is the answer.
    if (drawn < Math.max(100, trials * 0.05)) return null;
    return { points: Math.round(total / drawn * 10) / 10,
             salary: Math.round(spend / drawn),
             basis: 'modeled-ownership', entries: drawn, trials: trials,
             pool: pool.length, slots: slots.length };
  }

  // ── which contest this slate is worth entering ───────────────────────────
  // A step up the payout curve — Head-to-Head, Multiplier, single-entry
  // tournament, multi-entry tournament — trades a lower chance of cashing for
  // a bigger payoff. The case for taking a step is that the model can buy
  // ceiling without giving up much median, and the measure of that is the gap
  // between Iron Tuna's number for a roster and THE MARKET's for the same one.
  //
  // That gap is only worth acting on to the extent the market's number is
  // really the market's. On a slate the books have priced, it is a
  // disagreement with money. On a slate they have not, the "market" number is
  // the game total split across an offense — which shares most of its inputs
  // with the projection it is being compared to, so the two agreeing means
  // very little and the two disagreeing means less. Acting on that gap is
  // taking real risk on the strength of two models arguing with each other.
  //
  // So the thresholds are divided by how much of the roster was actually
  // quoted. A fully quoted roster moves up the curve on the evidence it has.
  // An unquoted one needs twice the gap to justify the same risk, which on
  // most weeks leaves it where the chance of winning is best.
  var PICKS = {
    h2h: { rec: 'Head-to-Head', tag: 'Highest hit rate',
      why: 'The highest-confidence path is still to maximize the chance of beating one opponent. The current slate does not offer enough extra ceiling at a small enough projection cost to justify moving materially up the payout curve.' },
    multiplier: { rec: 'Multiplier', tag: 'Measured step up the payout curve',
      why: 'The slate offers enough projected edge and upside to take more risk than Head-to-Head, but not enough to justify the volatility of a large tournament. A multiplier is the middle ground: fewer winners, meaningfully better payoff, and less dependence on a perfect ceiling outcome.' },
    single: { rec: 'Tournament - Single Entry', tag: 'Upside without a major projection sacrifice',
      why: 'The tournament build adds meaningful ceiling and correlation without giving away much median projection. This is the kind of week where accepting a lower cashing probability can be justified by the larger payoff available when the roster hits.' },
    multi: { rec: 'Tournament - Multi-Entry', tag: 'Risk justified by separation',
      why: 'The leverage build keeps nearly all of the high-floor lineup’s median projection while creating materially more ceiling and differentiation. That combination makes the larger payout curve more attractive than it is on a normal week, despite the lower chance of cashing.' }
  };
  function sum(l, key) { return l && l.players ? l.players.reduce(function (n, p) { var v = Number(p[key]); return n + (isFinite(v) ? v : 0); }, 0) : 0; }
  // How much of a roster the books actually priced, and on what.
  function evidenceOf(l) {
    var ps = (l && l.players) || [];
    var quoted = ps.filter(function (p) { return p.marketQuoted; });
    var mkts = {};
    quoted.forEach(function (p) { ((p.market && p.market.priced) || []).forEach(function (m) { mkts[m] = (mkts[m] || 0) + 1; }); });
    var tdMkt = ps.filter(function (p) { return p.tdBasis === 'anytime-td-market'; }).length;
    var books = quoted.map(function (p) { return (p.market && p.market.books) || 0; }).filter(function (n) { return n > 0; });
    return { quoted: quoted.length, of: ps.length,
             coverage: ps.length ? quoted.length / ps.length : 0,
             markets: Object.keys(mkts).sort(),
             tdQuoted: tdMkt,
             books: books.length ? Math.round(books.reduce(function (a, b) { return a + b; }, 0) / books.length * 10) / 10 : null };
  }
  function contestPick(o) {
    var C = o && o.cash, T = o && o.tournament, L = (o && o.leverage) || T;
    if (!C || !T) return null;
    // The lineup's OWN aggregates. Summing a per-player field here is how this
    // came to compare zeroes for a year: the builder already totals the
    // projection, the floor and the ceiling, and those totals are correct.
    var cashProj = isFinite(C.projPoints) ? C.projPoints : sum(C, 'proj');
    var cashFloor = isFinite(C.floorPoints) ? C.floorPoints : 0;
    var cashCeil = isFinite(C.ceilingPoints) ? C.ceilingPoints : 0;
    var tourProj = isFinite(T.projPoints) ? T.projPoints : sum(T, 'proj');
    var tourCeil = isFinite(T.ceilingPoints) ? T.ceilingPoints : 0;
    var levProj = isFinite(L.projPoints) ? L.projPoints : sum(L, 'proj');
    var levCeil = isFinite(L.ceilingPoints) ? L.ceilingPoints : 0;
    // Against the market read, which is the quoted props where there are any
    // and the game line discounted for not being quoted where there are not.
    var market = isFinite(T.marketPoints) && T.marketPoints > 0 ? T.marketPoints : sum(T, 'marketPoints');
    var edge = market > 0 && tourProj > 0 ? (tourProj - market) / market : 0;
    var ev = evidenceOf(T);
    var need = 2 - ev.coverage;                 // fully quoted 1x, unquoted 2x
    var pick = PICKS.h2h;
    if (edge >= 0.05 * need && levProj >= cashProj * 0.97 && levCeil >= cashCeil * 1.10) pick = PICKS.multi;
    else if (edge >= 0.035 * need && tourProj >= cashProj * 0.97 && tourCeil >= cashCeil * 1.07) pick = PICKS.single;
    else if (edge >= 0.018 * need && tourProj >= cashProj * 0.985) pick = PICKS.multiplier;
    return { rec: pick.rec, tag: pick.tag, rationale: pick.why,
             edge: Math.round(edge * 1000) / 10, need: Math.round(need * 100) / 100,
             marketPoints: Math.round(market * 10) / 10,
             cashProj: cashProj, tourProj: tourProj, levProj: levProj,
             floorRetention: cashProj > 0 ? Math.round(cashFloor / cashProj * 100) : 0,
             ceilingMultiple: tourProj > 0 ? Math.round(tourCeil / tourProj * 100) : 0,
             evidence: ev };
  }

  var api = { MODES: MODES, FORMATS: FORMATS, GAME_STYLE_FORMAT: GAME_STYLE_FORMAT, ANY_POSITION: ANY_POSITION,
              formatFor: formatFor, tierFormat: tierFormat, eligibleIn: eligible,
              build: build, valid: valid, ceilingOf: ceilOf, floorOf: floorOf,
              contestPick: contestPick, fieldAverage: fieldAverage, pickBoard: pickBoard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ITDfs = api;
})(typeof window !== 'undefined' ? window : globalThis);
