/* Iron Tuna — the trade engine.
 *
 * Three things, all pure functions, so /trade-finder can run them in the
 * browser and tools/test-trade-finder.mjs can run the same code in node:
 *
 *   1. NAMES. A pasted roster is text written by a person or copied off a
 *      league site: "Ja'Marr Chase WR - CIN", "Chase, Ja'Marr", "J. Chase",
 *      "Marvin Harrison Jr." — and between the players, team names, slot
 *      labels, byes and projections. resolve() turns one line into one player
 *      the board knows, or nothing; parseRosters() turns a whole paste into
 *      teams. Nothing here invents a player: a name the board does not carry
 *      is reported as unresolved, never guessed — and suggest() then offers the
 *      reader the names it is nearest to, because an empty box on a page that
 *      knows the whole board is a question asked of the wrong party. An
 *      unresolved line is also never promoted to a TEAM name: that was how a
 *      misread player used to invent a thirteenth team and take a real one's
 *      roster with it (see nameShape).
 *
 *   2. LINEUPS. A roster is worth what it STARTS. lineupValue() fills the
 *      league's own slots (QB/RB/WR/TE, flex, superflex) greedily by points —
 *      optimal for this slot shape, because every flex accepts what a named
 *      slot accepts — and adds a small weight for the bench, which is injury
 *      insurance and worth something but not what a starter is worth. Every
 *      slot is measured against the WIRE: a slot nobody on the roster fills
 *      is started by the best free agent at the position (replacementLevel),
 *      not by nothing, and a roster is a fixed number of spots, so a player a
 *      trade adds has to displace someone and a spot a trade opens is filled
 *      off the wire. Without that, a 2-for-1 that sent the reader's best
 *      player for two lesser ones came back as a gain for BOTH sides: the
 *      throw-in "filled" a slot at his full projection that waivers would
 *      have filled for free.
 *
 *   3. TRADES. findTrades() enumerates one- and two-player packages between
 *      two rosters and keeps only the ones where BOTH lineups get better at
 *      their OWN horizon. That last clause is the feature: a team chasing a
 *      playoff spot is scored on the next three weeks, a team that has
 *      clinched on weeks 15-17, and a trade can be right for both at once.
 *      The tilt is a slider from "even" to "favor my side" — but the floor
 *      never moves: a trade the other side does not gain from is not offered.
 *
 *      A lineup gain is necessary and not sufficient. A manager who is asked
 *      to send the best player in the deal, or forty points more of
 *      projection than comes back, for a lineup that improves by half a point
 *      a week says no, and so did every reader shown that trade. So each side
 *      gets a CASE (judgeSide): the lineup gain, who gets the best player,
 *      projected points sent against received, throw-ins that would only be
 *      cut, the depth left behind, and for a team scored on the next few
 *      weeks what the deal costs over the season. A trade is offered only
 *      when both cases come back accepted, and the case is what the page
 *      shows under each side: why that manager would want it.
 *
 * Points come from the caller. The engine is handed a function
 * points(player, horizonKey) and never sees a stat line, so the scoring is
 * whatever it-league.js says the reader plays, and this file cannot drift
 * from it. Kickers and defenses are recognized by the parser (so a "Bills
 * D/ST" line does not become a team name) and ignored by the search.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ITTrade = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function fold(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Initials run together: "A.J. Brown" and "AJ Brown" are one man, and so
    // are "D/ST" and "DST". Two passes so "c j" and "t j" both collapse.
    t = t.replace(/\b([a-z]) ([a-z])\b/g, '$1$2').replace(/\b([a-z]) ([a-z])\b/g, '$1$2').replace(/\bd st\b/g, 'dst');
    return t.replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');
  }
  function words(s) { return fold(s).split(' ').filter(Boolean); }

  // Everything a roster paste carries that is not a player and not a team.
  var SLOT_WORDS = {};
  ['qb', 'rb', 'wr', 'te', 'k', 'pk', 'def', 'dst', 'd', 'st', 'flex', 'w', 'r', 't', 'wrt', 'rwt', 'wrrb', 'rbwr', 'sflex', 'superflex', 'sf',
   'op', 'bn', 'be', 'bench', 'ir', 'taxi', 'starter', 'starters', 'reserve', 'reserves', 'pos', 'position', 'player', 'players',
   'opp', 'status', 'proj', 'pts', 'points', 'bye', 'byes', 'total', 'totals', 'slot', 'rank', 'roster', 'lineup', 'name', 'avg',
   'fpts', 'fan', 'rost', 'start', 'sit', 'inj', 'injured', 'na', 'vs', 'at', 'out', 'o', 'q', 'p', 'dnp', 'questionable', 'doubtful',
   'probable', 'pup', 'sus', 'ret', 'cov', 'week', 'wk', 'fa', 'empty', 'none', 'week', 'the', 'and', 'of', 'in', 'a', 'to'
  ].forEach(function (w) { SLOT_WORDS[w] = 1; });
  var TEAM_ABBR = {};
  ['ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle', 'dal', 'den', 'det', 'gb', 'gnb', 'hou', 'ind', 'jax', 'jac', 'kc', 'kan',
   'lac', 'lar', 'la', 'lv', 'lvr', 'mia', 'min', 'ne', 'nwe', 'no', 'nor', 'nyg', 'nyj', 'phi', 'pit', 'sea', 'sf', 'sfo', 'tb', 'tam',
   'ten', 'was', 'wsh', 'oak', 'sd', 'stl'].forEach(function (t) { TEAM_ABBR[t] = 1; });
  var POS_HINT = { qb: 'QB', rb: 'RB', wr: 'WR', te: 'TE', k: 'K', pk: 'K', def: 'DEF', dst: 'DEF' };

  // ── the pool ──────────────────────────────────────────────────────────────
  // players: [{ name, pos, team, ... }]. pos is one of QB/RB/WR/TE/K/DEF (a
  // board that says DST is normalized). The index keeps the caller's objects.
  function makePool(players) {
    var list = [], byFull = {}, byLast = {}, folded = [];
    (players || []).forEach(function (p) {
      if (!p || !p.name) return;
      var pos = String(p.pos || p.position || '').toUpperCase();
      if (pos === 'DST') pos = 'DEF';
      var f = fold(p.name);
      if (!f) return;
      var row = { p: p, name: p.name, pos: pos, team: String(p.team || '').toUpperCase(), f: f, w: f.split(' ') };
      list.push(row);
      if (!byFull[f]) byFull[f] = row;
      var last = row.w[row.w.length - 1];
      (byLast[last] = byLast[last] || []).push(row);
      if (pos === 'DEF') {
        // "Bills D/ST", "Buffalo", "BUF DEF" all mean the same roster line, so
        // a defense answers to its city, its nickname and its abbreviation.
        var city = row.w.slice(0, -1).join(' ');
        [city, row.w[row.w.length - 1], row.team.toLowerCase()].forEach(function (k) {
          if (!k) return;
          if (!byFull[k + ' def']) byFull[k + ' def'] = row;
          if (!byFull[k + ' dst']) byFull[k + ' dst'] = row;
        });
        if (city && !byFull[city]) byFull[city] = row;
      }
    });
    // Longest names first, so "Kenneth Walker" is tried before any other Walker.
    folded = list.slice().sort(function (a, b) { return b.f.length - a.f.length; });
    return { list: list, byFull: byFull, byLast: byLast, folded: folded, teams: teamsOf(list) };
  }
  function teamsOf(list) {
    var t = {};
    list.forEach(function (r) { if (r.team) t[r.team.toLowerCase()] = 1; });
    return t;
  }
  function posOf(line) {
    var hit = null;
    words(line).forEach(function (w) { if (!hit && POS_HINT[w]) hit = POS_HINT[w]; });
    return hit;
  }

  // One line → one player. Tries, in order: the whole line as a name; "Last,
  // First"; the longest board name that appears whole inside the line; and an
  // initial plus surname ("J. Chase") when exactly one player fits it. The
  // position written on the line, if any, breaks ties and rejects mismatches.
  function resolve(text, pool, posHint) {
    if (!pool || !text) return null;
    var raw = String(text).replace(/\t/g, ' ');
    var hint = posHint || posOf(raw);
    var f = fold(raw);
    if (!f) return null;
    var okPos = function (r) { return !hint || r.pos === hint; };
    var row = pool.byFull[f];
    if (row && okPos(row)) return row;
    // "Chase, Ja'Marr" and "Chase, Ja'Marr WR"
    var comma = raw.indexOf(',');
    if (comma > 0) {
      var last = fold(raw.slice(0, comma)), first = words(raw.slice(comma + 1))[0];
      if (last && first) {
        row = pool.byFull[first + ' ' + last];
        if (row && okPos(row)) return row;
        var cands = (pool.byLast[last.split(' ').pop()] || []).filter(function (r) { return r.w[0] === first && okPos(r); });
        if (cands.length === 1) return cands[0];
      }
    }
    // The longest full name that sits whole in the line.
    var hay = ' ' + f + ' ';
    for (var i = 0; i < pool.folded.length; i++) {
      var r = pool.folded[i];
      if (r.w.length < 2 && r.pos !== 'DEF') continue;      // a bare surname in the pool is not a name to match on
      if (hay.indexOf(' ' + r.f + ' ') >= 0 && okPos(r)) return r;
    }
    // A defense by city or abbreviation: "Buffalo D/ST", "BUF DEF".
    var w = f.split(' ');
    // Both spellings stay in the accept list: this reads a reader's pasted
    // roster, and what they typed is not the site's copy to correct.
    if (w.some(function (x) { return x === 'def' || x === 'dst' || x === 'defense' || x === 'defence'; })) {
      for (var d = 0; d < w.length; d++) {
        var cityRow = pool.byFull[w[d] + ' def'] || pool.byFull[w[d]];
        if (cityRow && cityRow.pos === 'DEF') return cityRow;
      }
    }
    // Initial and surname: "J. Chase", "J Chase WR".
    var m = f.match(/^([a-z])\s+([a-z]+)(?:\s|$)/);
    if (m) {
      var c2 = (pool.byLast[m[2]] || []).filter(function (r) { return r.w[0].charAt(0) === m[1] && okPos(r); });
      if (c2.length === 1) return c2[0];
    }
    // The tail of a name ("St. Brown", "Smith-Njigba", "Harrison Jr"): the
    // line is the last words of exactly one player's name.
    if (w.length <= 3) {
      var tail = ' ' + f, c4 = [];
      for (var t = 0; t < pool.list.length; t++) {
        var pr = pool.list[t];
        if ((' ' + pr.f).slice(-tail.length) === tail && okPos(pr)) c4.push(pr);
      }
      if (c4.length === 1) return c4[0];
    }
    // A surname alone ("Henry", "Tucker K BAL"), when exactly one player — at
    // the hinted position if there is one — carries it. "Brown" stays
    // unresolved, correctly: there are five of him.
    if (w.length === 1 || (hint && w.length <= 3)) {
      var c3 = (pool.byLast[w[0]] || []).filter(okPos);
      if (c3.length === 1) return c3[0];
    }
    return null;
  }

  // ── what it might have been ───────────────────────────────────────────────
  // WHY THIS EXISTS. A line the resolver cannot place is handed back to the
  // reader as an empty box: "type the name". That box knows the whole board
  // and was telling the reader nothing — so a name it half-read ("K Mon…")
  // had to be retyped in full, from memory, by someone who was pasting a
  // roster precisely so they would not have to type it.
  //
  // resolve() is deliberately strict: it answers one player or nothing, and it
  // never guesses, because a guess puts a stranger on a roster. This is the
  // other half of that bargain. It is allowed to be generous, because nothing
  // it returns is acted on — every one of these is a name the reader has to
  // pick before it counts, and resolve() still has the last word on the pick.
  //
  // Capped Levenshtein: past `max` the exact distance does not matter, and the
  // cap is what keeps this cheap over a board of four hundred rows typed at.
  // Transpositions count as ONE edit, not two. Two letters swapped is the
  // commonest typo there is and a routine screenshot misread, and plain
  // Levenshtein charges it double: "Waddel" sits two edits from "Waddle",
  // outside a six-letter surname's allowance, so the box offered nothing for
  // a name that was one slip away. Widening the allowance instead would have
  // let "Hall" reach "Hill", which are two players.
  //
  // The early abandon is safe: every path to the end crosses every row, so the
  // final distance is never less than the smallest cell in any row.
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j, best;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
        }
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }
  // How far apart two words may be and still be the same word. A four-letter
  // surname tolerates one edit and no more — "Hall" is one edit from "Hill"
  // and they are different players — while a long one survives a typo without
  // being mistaken for anyone. Measured on the shorter, so a three-letter
  // fragment cannot borrow a long name's allowance.
  function slack(a, b) { return Math.max(1, Math.min(2, Math.floor(Math.min(a.length, b.length) / 4))); }

  // One line (or one half-typed name) → the players it could be, best first.
  //   suggest(pool, 'k mon')          → Kyle Monangai, …
  //   suggest(pool, 'K Bornegales K') → the kicker whose surname is one edit off
  //   suggest(pool, '')               → the top of the board, which is what an
  //                                     empty box should offer to open with
  // Slot words, club abbreviations and bare numbers are dropped first, so a
  // whole pasted line works as well as a typed fragment. A position written on
  // the line is obeyed: "K Mon RB" never offers a kicker.
  function suggest(pool, text, limit) {
    if (!pool || !pool.list) return [];
    var n = Math.max(1, Math.min(25, limit || 8));
    var all = words(text);
    // A LEADING SINGLE LETTER IS AN INITIAL, NOT A SLOT. Every one-letter slot
    // label — k, d, w, r, t — is also somebody's first initial, and posOf()
    // takes the first hit it finds: "K Monangai RB" read as a kicker, and the
    // running back it plainly says it is was filtered out of its own answer.
    // So the hint here comes from the spelled-out labels only, and the leading
    // letter is kept as what it is, the initial that tells Kyle from Kenneth.
    var hint = posOf(all.filter(function (w, i) { return !(i === 0 && w.length === 1); }).join(' '));
    var toks = all.filter(function (w, i) {
      if (i === 0 && w.length === 1) return true;
      return !SLOT_WORDS[w] && !TEAM_ABBR[w] && !pool.teams[w] && !/^[0-9.]+$/.test(w);
    });
    var q = toks.join(' ');
    // fold() turns punctuation into a space, so "Ja'Marr" is two words here
    // and a reader typing "jamarr" prefixes neither. The run-together copy is
    // only ever compared as a prefix, so it costs nothing and answers that.
    var qq = q.replace(/ /g, '');
    var out = [];
    for (var i = 0; i < pool.list.length; i++) {
      var r = pool.list[i];
      if (hint && r.pos !== hint) continue;
      var rank = q ? rankFor(r, toks, q, qq) : 4;
      if (rank < 0) continue;
      out.push({ r: r, rank: rank, i: i });
      if (!q && out.length >= n) break;            // the board is already in order
    }
    // The pool arrives in board order, so index is value order: among names
    // that match equally well, the one worth more is the one being looked for.
    out.sort(function (a, b) { return (a.rank - b.rank) || (a.i - b.i); });
    return out.slice(0, n).map(function (h) { return h.r; });
  }
  function rankFor(r, toks, q, qq) {
    if (r.f.indexOf(q) === 0) return 0;                       // "ja marr" → Ja'Marr Chase
    if (qq.length >= 2 && r.f.replace(/ /g, '').indexOf(qq) === 0) return 0;  // "jamarr" → the same man
    var last = toks[toks.length - 1], surname = r.w[r.w.length - 1];
    // Initial (or first name) and surname, the way a grid prints one. Both
    // halves have to fit, or "j w" offers every W and every J on the board.
    if (toks.length > 1 && surname.indexOf(last) === 0 && r.w[0].indexOf(toks[0]) === 0) return 1;
    for (var t = 0; t < toks.length; t++) {
      if (toks[t].length < 2) continue;                       // a lone initial is not a search
      for (var w = 0; w < r.w.length; w++) if (r.w[w].indexOf(toks[t]) === 0) return 2;
    }
    // A misread letter. Only on the surname, and only once the reader has
    // typed enough of it to mean something.
    if (last && last.length >= 4 && editDistance(last, surname, slack(last, surname)) <= slack(last, surname)) return 3;
    return -1;
  }

  // Is this non-player line a team name, or noise? Noise is anything made only
  // of slot labels, club abbreviations, numbers and short status tokens —
  // "QB - BUF (3)", "Bye: 7", "Proj 18.4", "W/R/T". A team name has at least
  // one real word in it.
  function isNoise(line, pool) {
    var w = words(line);
    if (!w.length) return true;
    var real = w.filter(function (x) {
      if (SLOT_WORDS[x] || TEAM_ABBR[x] || (pool && pool.teams[x])) return false;
      if (/^\d+(\.\d+)?$/.test(x)) return false;
      if (x.length <= 1) return false;
      return true;
    });
    return real.length === 0;
  }
  var HEADER_PREFIX = /^\s*(team|roster|owner|manager)\s*[:#-]\s*/i;
  // A line that opens with one of these is announcing a team, whatever follows
  // it. "Team Kelce" is a manager with a favourite player, not a tight end.
  var HEADER_WORD = { team: 1, roster: 1, owner: 1, manager: 1, squad: 1, the: 1 };

  // IS THIS UNPLACEABLE LINE A PLAYER, OR A TEAM NAME?
  //
  // THE BUG THIS EXISTS FOR. A bare name the board could not place — "J
  // Williams", "A Bornegales", the shapes a screenshot produces — was promoted
  // to a TEAM NAME, and then swallowed every player under it. A twelve-team
  // paste came back as thirteen teams, one of them called after a running back,
  // with the real team's name gone and its players filed under a stranger. The
  // reader was told none of it: an unplaceable player is reported in the fix
  // box, but a team name is just a team name, so the line that went wrong was
  // the one line that produced no complaint.
  //
  // The two are told apart by SHAPE, and there are two shapes worth telling:
  //
  //   'initial'  An initial and a surname — "J Williams", "D Hampton", "S
  //              Vaki". This is how a roster grid prints a player and it is
  //              not how anybody names a team. Nothing else has to agree: even
  //              a name the board has never carried is a player written this
  //              way, which matters, because a player the board does not carry
  //              is exactly the one that used to disappear.
  //
  //   'surname'  Two ordinary words whose second is a surname the board
  //              carries, or is one slip from one: "Mike Johnson", "Andy
  //              Borregales". Half the leagues in the world name their teams
  //              after the people who manage them, so this shape is a player
  //              only in the middle of a roster — see the caller.
  //
  // Everything else is a team. A name that announces itself ("Team:", "Roster
  // —"), one that opens with a team word, one whose last word is nobody's
  // surname: "Ken's Krushers", "Gridiron Giants" and "Mahomes Alone" all stay
  // teams. A defense is skipped when checking surnames, because the pool
  // indexes one under its nickname and its city, and a team named after the
  // Giants is not a man called Giants.
  //
  // Where it stays genuinely ambiguous this errs toward PLAYER, because the
  // two mistakes do not cost the same. A team name read as a player shows up
  // in the fix box, where one click drops it. A player read as a team invents
  // a team, steals the players beneath it, and says nothing at all.
  function nameShape(line, pool) {
    if (!pool || !pool.list) return '';
    var all = words(line);
    if (!all.length || HEADER_WORD[all[0]]) return '';
    // Slot labels, clubs and numbers are not part of a name — but a LEADING
    // single letter is an initial, and the one thing telling Kyle from Kenneth.
    var toks = all.filter(function (w, i) {
      if (i === 0 && w.length === 1) return true;
      return !SLOT_WORDS[w] && !TEAM_ABBR[w] && !pool.teams[w] && !/^[0-9.]+$/.test(w);
    });
    if (toks.length !== 2) return '';
    var last = toks[1];
    if (last.length < 3) return '';
    if (toks[0].length === 1) return 'initial';
    for (var i = 0; i < pool.list.length; i++) {
      var r = pool.list[i];
      if (r.pos === 'DEF') continue;
      var surname = r.w[r.w.length - 1];
      if (surname === last || editDistance(last, surname, slack(last, surname)) <= slack(last, surname)) return 'surname';
    }
    return '';
  }

  // A whole paste → teams. Every line is either a player the board knows, noise,
  // or a team name. A team name opens a new team once the current one has a
  // player in it; before that, the first name seen is the one kept, so
  // "Team Awesome / Owner: Ken / Josh Allen" is one team called Team Awesome.
  // Duplicates (the same player under two teams) stay with the first team and
  // are reported, because a roster paste that lists one man twice is a paste
  // to fix, not a league to price.
  function parseRosters(text, pool) {
    var teams = [], cur = null, unresolved = [], dupes = [], seen = {};
    var lines = String(text || '').split(/\r?\n/);
    function open(name) {
      cur = { name: name || ('Team ' + (teams.length + 1)), players: [], unresolved: [] };
      teams.push(cur);
    }
    // A blank line is how a paste separates one team from the next, and it is
    // the one thing that tells a manager-named team from a misread player.
    // Plenty of leagues call a team "Mike Johnson"; nothing about those two
    // words says team rather than man, but after a blank it is announcing a
    // roster and mid-roster it is on one. True to start with, because the
    // first line of a paste is a header, not a stray.
    var blankBefore = true;
    lines.forEach(function (rawLine) {
      var line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      if (!line) { blankBefore = true; return; }
      if (/^[-=_~*#]{3,}$/.test(line)) { blankBefore = true; return; }
      var afterBreak = blankBefore;
      blankBefore = false;
      // Cells of a table row: the player is usually the first cell that resolves.
      var cells = line.split(/\t|\s{3,}|\s\|\s/).map(function (c) { return c.trim(); }).filter(Boolean);
      var row = null;
      for (var i = 0; i < cells.length && !row; i++) row = resolve(cells[i], pool, null);
      if (!row && cells.length > 1) row = resolve(line, pool, null);
      if (row) {
        if (!cur) open(null);
        var key = row.f + '|' + row.pos;
        if (seen[key]) { dupes.push({ name: row.name, team: seen[key], again: cur.name }); return; }
        seen[key] = cur.name;
        cur.players.push(row);
        return;
      }
      var explicit = HEADER_PREFIX.test(line);
      var body = line.replace(HEADER_PREFIX, '').trim();
      if (!explicit && isNoise(body, pool)) return;
      // A line with letters that no player matched: a team name if it reads like
      // one, otherwise a player we could not place — those are told apart by the
      // word count and whether the line carried a position or club marker.
      var bw = words(body);
      var shape = explicit ? '' : nameShape(line, pool);
      var looksLikePlayer = !explicit && ((posOf(line) && bw.length >= 2 && bw.length <= 6)
        // One word that is a surname the board carries more than once ("Brown")
        // is a player we cannot place, not a team called Brown.
        || (bw.length === 1 && (pool.byLast[bw[0]] || []).length > 1)
        // A bare name with no position on it, which is what a grid prints and
        // what a screenshot returns. See nameShape above for the whole story:
        // these two clauses are what stops "J Williams" becoming a team.
        || shape === 'initial'
        // The ordinary-looking one only mid-roster: after a blank line, or as
        // the first thing in the paste, the same two words are a team.
        || (shape === 'surname' && !afterBreak && cur && cur.players.length > 0));
      if (looksLikePlayer) {
        // Into a team, not into a bag the page never reads: an unplaceable
        // player is only worth reporting where the reader can answer for it.
        if (!cur) open(null);
        cur.unresolved.push(line);
        return;
      }
      if (!cur || cur.players.length) open(body.slice(0, 60));
      // A second header before any player. Two cases, and they used to be one:
      //
      //   "Team Awesome / Owner: Ken / <players>" is ONE team, and the first
      //   name is the one to keep — the second line is a subtitle.
      //
      //   But a junk line that opened a team of its own, then a blank, then
      //   the real header, is not that. The empty team was never real: it was
      //   a garbled line the parser could not place, and discarding the header
      //   that follows it cost the reader their team's name AND filed its
      //   whole roster under the junk. A header after a break renames the
      //   empty team rather than being thrown away.
      else if (afterBreak) cur.name = body.slice(0, 60);
    });
    teams = teams.filter(function (t) { return t.players.length || t.unresolved.length; });
    return { teams: teams, unresolved: unresolved, duplicates: dupes };
  }

  // ── lineups ───────────────────────────────────────────────────────────────
  var FLEX_ELIG = { RB: 1, WR: 1, TE: 1 };
  var SFLEX_ELIG = { QB: 1, RB: 1, WR: 1, TE: 1 };
  var BENCH_W = [0.25, 0.15, 0.08];      // the third bench player is a roster spot, not a starter
  function normSlots(s) {
    s = s || {};
    var n = function (k, d) { var v = Number(s[k]); return isFinite(v) && v >= 0 ? Math.floor(v) : d; };
    return { QB: n('QB', 1), RB: n('RB', 2), WR: n('WR', 2), TE: n('TE', 1), FLEX: n('FLEX', 1), SFLEX: n('SFLEX', 0) };
  }
  // players: [{ pos, ... }], pts(player) → number. Returns the lineup and its
  // value. Greedy by points into named slots, then flex, then superflex.
  //
  // opts, both optional:
  //   repl  function(pos) → what the best free agent at that position scores
  //         over the same span as pts. With it, a starting slot nobody on the
  //         roster fills is started by a free agent at that value, and the
  //         bench is padded to BENCH_W.length with free agents the same way.
  //         Those rows carry free:true and a player named "a free agent".
  //         A player scoring less than the wire at his position (hurt, or
  //         just bad) never starts over one and is first to be cut: a
  //         manager would drop him for the free agent, so a zero on the
  //         roster is not a zero in the lineup. Without repl a hole scores
  //         zero, which is wrong whenever a trade opens or fills one (see
  //         replacementLevel).
  //   size  the roster's number of spots. Holding more players than that, the
  //         weakest bench players are cut down to it before the lineup is
  //         scored (returned as `cut`); a starter is never cut.
  function lineupValue(players, slots, pts, opts) {
    var S = normSlots(slots), o = opts || {};
    var repl = typeof o.repl === 'function' ? function (pos) { var v = Number(o.repl(pos)); return isFinite(v) && v > 0 ? v : 0; } : null;
    var size = isFinite(Number(o.size)) && Number(o.size) > 0 ? Math.floor(Number(o.size)) : null;
    var rows = [];
    (players || []).forEach(function (p) {
      var pos = String(p.pos || '').toUpperCase();
      if (!SFLEX_ELIG[pos]) return;
      var v = Number(pts(p)); if (!isFinite(v)) v = 0;
      rows.push({ p: p, pos: pos, v: v });
    });
    rows.sort(function (a, b) { return b.v - a.v; });
    var left = { QB: S.QB, RB: S.RB, WR: S.WR, TE: S.TE }, flex = S.FLEX, sflex = S.SFLEX;
    var starters = [], bench = [], rest = [];
    rows.forEach(function (r) {
      if (repl && r.v < repl(r.pos)) { r.sub = true; rest.push(r); }
      else if (left[r.pos] > 0) { left[r.pos]--; r.slot = r.pos; starters.push(r); }
      else bench.push(r);
    });
    bench.forEach(function (r) {
      if (flex > 0 && FLEX_ELIG[r.pos]) { flex--; r.slot = 'FLEX'; starters.push(r); }
      else if (sflex > 0 && SFLEX_ELIG[r.pos]) { sflex--; r.slot = 'SFLEX'; starters.push(r); }
      else rest.push(r);
    });
    var qbW = S.SFLEX === 0 ? 0.3 : 1;
    var agent = function (pos, v, slot) { return { p: { name: 'a free agent', pos: pos, free: true }, pos: pos, v: v, slot: slot, free: true }; };
    var best = function (elig, w) { var top = null; Object.keys(elig).forEach(function (pos) { var v = repl(pos) * (w && pos === 'QB' ? qbW : 1); if (!top || v > top.v) top = { pos: pos, v: v }; }); return top; };
    // A slot nobody fills is started off the wire.
    if (repl) {
      ['QB', 'RB', 'WR', 'TE'].forEach(function (pos) { while (left[pos] > 0) { left[pos]--; starters.push(agent(pos, repl(pos), pos)); } });
      var f = best(FLEX_ELIG); while (flex > 0) { flex--; starters.push(agent(f.pos, f.v, 'FLEX')); }
      var sf = best(SFLEX_ELIG); while (sflex > 0) { sflex--; starters.push(agent(sf.pos, sf.v, 'SFLEX')); }
    }
    var total = 0;
    starters.forEach(function (r) { total += r.v; });
    // The bench: what the roster can absorb when a starter goes down. A backup
    // quarterback in a one-QB league is almost never the answer to anything.
    rest.forEach(function (r) { r.bv = r.v * (r.pos === 'QB' ? qbW : 1); });
    rest.sort(function (x, y) { return y.bv - x.bv; });
    // More players than spots: the weakest bench players are cut.
    var cut = [];
    if (size != null) while (rows.length - cut.length > size && rest.length) cut.push(rest.pop());
    // Fewer bench players above the wire than the bench weights reach: the
    // spots hold free agents, so losing a bench player in a 2-for-1 costs
    // what he scores over the wire, and gaining one is worth the same. A
    // player below the wire is not a bench player for this count: the spot
    // he holds is a free agent's the moment the manager wants it to be.
    if (repl) {
      var fa = best(SFLEX_ELIG, true), above = rest.filter(function (r) { return !r.sub; }).length;
      while (above < BENCH_W.length) { above++; rest.push(agent(fa.pos, fa.v / (fa.pos === 'QB' ? qbW : 1), null)); }
      rest.forEach(function (r) { r.bv = r.v * (r.pos === 'QB' ? qbW : 1); });
      rest.sort(function (x, y) { return y.bv - x.bv; });
    }
    var b = 0;
    rest.forEach(function (r, k) {
      if (k >= BENCH_W.length) return;
      r.benchW = BENCH_W[k];
      total += r.bv * BENCH_W[k]; b += r.bv * BENCH_W[k];
    });
    return { total: total, starters: starters, bench: rest, benchValue: b, cut: cut,
             free: starters.filter(function (r) { return r.free; }).length };
  }

  // ── the wire ──────────────────────────────────────────────────────────────
  // The best free agent at each position, by rank on the board. In a league
  // of N teams, about N × (the starters at the position, with a share of the
  // flex) players are started every week and a share of a bench round is
  // held behind them; the next player down is roughly the best one nobody
  // holds, and every lineup is measured against him. At the site's default
  // shape in a 12-team league that is QB15, RB36, WR36 and TE15.
  //   pool        every player the board carries (the rows findTrades scores)
  //   slots       the league's starting slots
  //   leagueSize  teams in the league (default 12)
  //   pt          function(player, horizonKey) → points over that horizon
  // Returns function(pos, horizonKey) → points over that horizon.
  function replacementLevel(pool, slots, leagueSize, pt) {
    var S = normSlots(slots), N = Math.max(2, Math.floor(Number(leagueSize) || 12));
    var rank = {
      QB: N * (S.QB + 0.75 * S.SFLEX + 0.25),
      RB: N * (S.RB + 0.5 * S.FLEX + 0.125 * S.SFLEX + 0.5),
      WR: N * (S.WR + 0.5 * S.FLEX + 0.125 * S.SFLEX + 0.5),
      TE: N * (S.TE + 0.25)
    };
    var list = (pool || []).map(function (r) { return r.p || r; }), memo = {};
    return function (pos, h) {
      pos = String(pos || '').toUpperCase();
      var k = pos + '|' + h;
      if (memo[k] !== undefined) return memo[k];
      var at = [];
      list.forEach(function (p) {
        if (String(p.pos || '').toUpperCase() !== pos) return;
        var v = Number(pt(p, h)); at.push(isFinite(v) ? v : 0);
      });
      at.sort(function (a, b) { return b - a; });
      var i = Math.min(at.length, Math.max(1, Math.round(rank[pos] || 0))) - 1;
      memo[k] = i >= 0 ? at[i] : 0;
      return memo[k];
    };
  }

  // ── trades ────────────────────────────────────────────────────────────────
  function combos(list, size) {
    var out = [];
    if (size === 1) return list.map(function (x) { return [x]; });
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      if (size === 2) out.push([list[i], list[j]]);
      else for (var k = j + 1; k < list.length; k++) out.push([list[i], list[j], list[k]]);
    }
    return out;
  }
  function without(roster, gone) {
    return roster.filter(function (p) { return gone.indexOf(p) < 0; });
  }
  function idOf(p) { return p.id || p.key || (p.name + '|' + p.pos); }

  // opts:
  //   slots      the league's starting slots
  //   points     function(player, horizonKey) → points over that horizon
  //   weeks      function(horizonKey) → how many weeks the horizon spans (≥1)
  //   horizon    function(teamIndex) → horizonKey for that team
  //   mine       index of the reader's team, or null for every pair
  //   tilt       0 = even, 1 = as much for my side as the other side will bear
  //   maxSize    players per side, 1..3 (default 2)
  //   minGain    points per week each side must gain (default 0.75)
  //   candidates players per roster considered (default 14), by points
  //   limit      trades returned (default 12)
  //   pool       every player the board carries, for the wire (replacementLevel);
  //              or `replacement`, function(pos, horizonKey) → points, directly.
  //              With neither, a hole in a lineup scores zero.
  //   leagueSize teams in the league, for the wire (default 12)
  //   season     the horizon key a short-clock team is also checked on
  //              (default 'ros'); see judgeSide
  //   label      function(horizonKey) → the words for it in a reason
  function findTrades(teams, opts) {
    var o = opts || {};
    var S = normSlots(o.slots);
    var points = o.points, weeks = o.weeks || function () { return 1; }, horizonOf = o.horizon || function () { return 'ros'; };
    var tilt = Math.max(0, Math.min(1, Number(o.tilt) || 0));
    var maxSize = Math.max(1, Math.min(3, Math.floor(Number(o.maxSize) || 2)));
    var minGain = isFinite(Number(o.minGain)) ? Number(o.minGain) : 0.75;
    var CAND = Math.max(4, Math.floor(Number(o.candidates) || 14));
    var limit = Math.max(1, Math.floor(Number(o.limit) || 12));
    var mine = (o.mine == null || o.mine === '' || !isFinite(Number(o.mine))) ? null : Number(o.mine);
    var caseOpts = { minGain: minGain, season: o.season, weeks: weeks, label: o.label };

    // Points per player per horizon, computed once.
    var memo = {};
    function pt(p, h) {
      var k = idOf(p) + '|' + h;
      if (memo[k] === undefined) { var v = Number(points(p, h)); memo[k] = isFinite(v) ? v : 0; }
      return memo[k];
    }
    var repl = wireOf(o, S, pt);
    function value(roster, h, size) { return lineupValue(roster, S, function (p) { return pt(p, h); }, lineupOpts(repl, h, size)).total; }
    var T = teams.map(function (t, i) {
      var h = horizonOf(i);
      var roster = (t.players || []).map(function (r) { return r.p || r; }).filter(function (p) { return SFLEX_ELIG[String(p.pos || '').toUpperCase()]; });
      var wk = Math.max(1, Number(weeks(h)) || 1);
      var starts = {};
      lineupValue(roster, S, function (p) { return pt(p, h); }, lineupOpts(repl, h, roster.length)).starters.forEach(function (r) { if (!r.free) starts[idOf(r.p)] = r.slot; });
      return { i: i, name: t.name, h: h, wk: wk, roster: roster, size: roster.length, base: value(roster, h, roster.length), slots: S, repl: repl, starts: starts,
               cands: roster.slice().sort(function (a, b) { return pt(b, h) - pt(a, h); }).slice(0, CAND) };
    });
    // Padding. A package can carry a pair that changes nothing: a player
    // neither side would start swapped for another neither side would start,
    // or two near-equal players at one position swapped straight across. The
    // bench weights make such a pair worth a fraction of a point, enough to
    // edge the padded package past the clean one in the ranking, so the
    // clean one is what gets offered and the padded one is dropped here.
    function churn(A, ga, cA, B, gb, cB) {
      if (ga.length + gb.length < 3) return false;
      for (var i = 0; i < ga.length; i++) for (var j = 0; j < gb.length; j++) {
        var p = ga[i], q = gb[j], pid = idOf(p), qid = idOf(q);
        var benchBoth = !A.starts[pid] && !cA.starts[qid] && !B.starts[qid] && !cB.starts[pid];
        if (benchBoth) return true;
        if (String(p.pos).toUpperCase() === String(q.pos).toUpperCase()
            && Math.abs(pt(p, A.h) - pt(q, A.h)) / A.wk < 2 * minGain
            && Math.abs(pt(p, B.h) - pt(q, B.h)) / B.wk < 2 * minGain) return true;
      }
      return false;
    }
    function packages(t) {
      var out = [];
      for (var s = 1; s <= maxSize && s <= t.cands.length; s++) out = out.concat(combos(t.cands, s));
      return out;
    }
    var pairs = [];
    if (mine != null) { T.forEach(function (t) { if (t.i !== mine) pairs.push([mine, t.i]); }); }
    else for (var a = 0; a < T.length; a++) for (var b = a + 1; b < T.length; b++) pairs.push([a, b]);

    var found = [], refused = 0;
    pairs.forEach(function (pr) {
      var A = T[pr[0]], B = T[pr[1]];
      if (!A.roster.length || !B.roster.length) return;
      var PA = packages(A), PB = packages(B);
      PA.forEach(function (ga) {
        PB.forEach(function (gb) {
          if (Math.abs(ga.length - gb.length) > 1) return;
          var ra = without(A.roster, ga).concat(gb), rb = without(B.roster, gb).concat(ga);
          var gA = (value(ra, A.h, A.size) - A.base) / A.wk;
          if (gA < minGain) return;
          var gB = (value(rb, B.h, B.size) - B.base) / B.wk;
          if (gB < minGain) return;
          // Both lineups gain. Now: would each manager actually say yes?
          var cA = judgeSide(A, ga, gb, pt, caseOpts, gB), cB = judgeSide(B, gb, ga, pt, caseOpts, gA);
          if (!cA.accept || !cB.accept) { refused++; return; }
          if (churn(A, ga, cA, B, gb, cB)) return;
          var score = tilt * gA + (1 - tilt) * Math.min(gA, gB) - 0.1 * Math.max(0, ga.length + gb.length - 2);
          found.push({ a: A.i, b: B.i, giveA: ga, giveB: gb, gainA: gA, gainB: gB, hA: A.h, hB: B.h, score: score, caseA: cA, caseB: cB });
        });
      });
    });
    found.sort(function (x, y) { return y.score - x.score; });

    // Diversity: the best two trades built around each pair of headline
    // players, and no more than four with the same partner, so the list is
    // twelve different ideas rather than one idea with twelve throw-ins.
    var out = [], perCore = {}, perPartner = {};
    var head = function (pk, h) { return pk.slice().sort(function (x, y) { return pt(y, h) - pt(x, h); })[0]; };
    for (var i = 0; i < found.length && out.length < limit; i++) {
      var t = found[i];
      var core = idOf(head(t.giveA, T[t.a].h)) + '>' + idOf(head(t.giveB, T[t.b].h)) + '|' + t.a + '|' + t.b;
      var partner = mine != null ? String(t.b === mine ? t.a : t.b) : t.a + '|' + t.b;
      if ((perCore[core] || 0) >= 2 || (perPartner[partner] || 0) >= 4) continue;
      perCore[core] = (perCore[core] || 0) + 1; perPartner[partner] = (perPartner[partner] || 0) + 1;
      t.linesA = t.caseA.lines;
      t.linesB = t.caseB.lines;
      out.push(t);
    }
    return { trades: out, teams: T.map(function (t) { return { name: t.name, horizon: t.h, weeks: t.wk, base: t.base, perWeek: t.base / t.wk }; }),
             considered: found.length, refused: refused };
  }
  // What actually changes in a lineup: who starts now that did not before, and
  // who stops. This is the sentence a reader can take to the other manager.
  // One proposed trade, judged. findTrades only ever shows swaps that clear the
  // floor for both sides; a reader who brings their own offer needs the other
  // answers too ("you lose", "they would refuse"), so each side gets a call:
  // 'gain' at or above minGain per week, 'loss' at or below minus it, 'even'
  // between. Same lineup fill, same per-week scale, same horizons per team.
  //   a, b        indexes of the two teams in `teams`
  //   giveA/giveB the players each side sends (objects from that team's roster)
  //   slots, points, weeks, horizon, minGain, pool/replacement, leagueSize as in findTrades
  function evaluateTrade(teams, opts) {
    var o = opts || {};
    var S = normSlots(o.slots);
    var points = o.points, weeks = o.weeks || function () { return 1; }, horizonOf = o.horizon || function () { return 'ros'; };
    var minGain = isFinite(Number(o.minGain)) ? Number(o.minGain) : 0.75;
    var memo = {};
    function pt(p, h) {
      var k = idOf(p) + '|' + h;
      if (memo[k] === undefined) { var v = Number(points(p, h)); memo[k] = isFinite(v) ? v : 0; }
      return memo[k];
    }
    var repl = wireOf(o, S, pt);
    var caseOpts = { minGain: minGain, season: o.season, weeks: weeks, label: o.label };
    function side(i, give, get) {
      var t = teams[i] || {}, h = horizonOf(i);
      var roster = (t.players || []).map(function (r) { return r.p || r; }).filter(function (p) { return SFLEX_ELIG[String(p.pos || '').toUpperCase()]; });
      var T = { name: t.name, h: h, wk: Math.max(1, Number(weeks(h)) || 1), roster: roster, size: roster.length, slots: S, repl: repl };
      var ln = lines(T, give, get, pt);
      var gain = (ln.after - ln.before) / T.wk;
      return { name: t.name, h: h, weeks: T.wk, perWeek: ln.before / T.wk, gain: gain, lines: ln, T: T,
               call: gain >= minGain ? 'gain' : gain <= -minGain ? 'loss' : 'even' };
    }
    var giveA = (o.giveA || []).filter(Boolean), giveB = (o.giveB || []).filter(Boolean);
    var A = side(o.a, giveA, giveB), B = side(o.b, giveB, giveA);
    // The case each manager would make, judged against the other's gain. A
    // caller scoring one team of a bigger deal passes the other side's gain
    // in as otherGain (a number, or one per side as { a, b }).
    var og = o.otherGain, ogA = og == null ? B.gain : (typeof og === 'object' ? og.a : og), ogB = og == null ? A.gain : (typeof og === 'object' ? og.b : og);
    A.case = judgeSide(A.T, giveA, giveB, pt, caseOpts, ogA);
    B.case = judgeSide(B.T, giveB, giveA, pt, caseOpts, ogB);
    delete A.T; delete B.T;
    return { a: o.a, b: o.b, giveA: giveA, giveB: giveB, A: A, B: B, minGain: minGain,
             both: A.call === 'gain' && B.call === 'gain', accept: A.case.accept && B.case.accept };
  }

  // ── the case ──────────────────────────────────────────────────────────────
  // One side of a trade, argued from that manager's chair. Returns
  //   { accept, gain, sent, got, best, spots, filler, depth, season, why, against, lines, starts }
  // `why` is the list of reasons this manager would want the deal and
  // `against` the objections, as sentences; `accept` is false when an
  // objection is one a manager does not get past:
  //   - the lineup does not gain minGain a week on their own horizon;
  //   - they send the best player in the deal and the lineup gains less than
  //     twice the floor for it (nobody gives up the best player for a bump);
  //   - they send materially more projection than they get back (more than
  //     the floor, and more than twice what the lineup gains): the manager
  //     sees forty points leaving and half a point arriving;
  //   - a throw-in they would have to open a roster spot for is worth no more
  //     than the player they would cut to make room, so they are being asked
  //     to cut a player to hold a player they would cut;
  //   - the trade opens a hole at a position they cannot fill;
  //   - their gain is under thirty percent of the other side's and under two
  //     points a week: a manager who runs the numbers asks for more;
  //   - they are scored on this week or the next three and the deal costs
  //     them over the season (opts.season, default 'ros') more than twice
  //     what it earns them now. A bubble team buys now; it does not give the
  //     season away for a rental.
  // A thin bench after the trade is noted, not disqualifying.
  //   T          { name, h, wk, roster, slots } as findTrades builds it
  //   give/get   the players leaving and arriving
  //   pt         function(player, horizonKey) → points over that horizon
  //   opts       { minGain, season, weeks, label }
  //   otherGain  the other side's gain per week, if known
  function judgeSide(T, give, get, pt, opts, otherGain) {
    var o = opts || {};
    var minGain = isFinite(Number(o.minGain)) ? Number(o.minGain) : 0.75;
    var season = o.season === undefined ? 'ros' : o.season;
    var label = typeof o.label === 'function' ? o.label : function (h) { return h; };
    var wk = T.wk, h = T.h, S = normSlots(T.slots);
    var per = function (p) { return pt(p, h) / wk; };
    var n1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
    var signed = function (v) { return (v < 0 ? '\u2212' : '+') + n1(Math.abs(v)); };
    var names = function (list) { return list.map(function (p) { return p.name; }).join(' and '); };
    var ln = lines(T, give, get, pt);
    var gain = (ln.after - ln.before) / wk;
    var why = [], against = [], accept = true;

    // 1. The lineup, on this team's own clock.
    var starts = ln.startsNow.map(function (r) { return r.p.name + ' at ' + r.slot; });
    if (gain >= minGain) {
      why.push('The lineup gains ' + signed(gain) + ' a week on ' + label(h) + (starts.length ? ': ' + starts.join(', ') + ' now start' + (starts.length === 1 ? 's' : '') + '.' : '.'));
    } else {
      accept = false;
      against.push('The lineup ' + (gain <= -minGain ? 'loses ' + n1(-gain) : 'gains ' + signed(gain)) + ' a week on ' + label(h) + ', ' + (gain <= -minGain ? 'so this is a step back.' : 'which is not enough to bother.'));
    }

    // 2. Who gets the best player in the deal, as this manager sees it.
    var all = give.concat(get).slice().sort(function (a, b) { return per(b) - per(a); });
    var best = all[0] || null, bestSide = 'even';
    if (best) {
      var topGive = give.length ? Math.max.apply(null, give.map(per)) : -Infinity, topGet = get.length ? Math.max.apply(null, get.map(per)) : -Infinity;
      bestSide = topGive > topGet + 1e-9 ? 'gives' : topGet > topGive + 1e-9 ? 'gets' : 'even';
    }
    if (bestSide === 'gets') why.push('Gets the best player in the deal, ' + best.name + ' (' + n1(per(best)) + ' a week).');
    else if (bestSide === 'gives') {
      if (gain >= 2 * minGain) why.push('Sends the best player in the deal, ' + best.name + ', but the lineup gains more than that at the slots it needed.');
      else { accept = false; against.push('Sends the best player in the deal, ' + best.name + ' (' + n1(per(best)) + ' a week), for a lineup gain of ' + signed(gain) + '. No manager gives up the best player for a bump.'); }
    }

    // 3. Projection sent against projection received.
    var sent = 0, got = 0;
    give.forEach(function (p) { sent += per(p); }); get.forEach(function (p) { got += per(p); });
    var deficit = sent - got;
    if (deficit > minGain && deficit > 2 * gain) {
      accept = false;
      against.push('Sends ' + n1(sent) + ' a week of projection and gets ' + n1(got) + ' back; the lineup only gains ' + signed(gain) + ' for the ' + n1(deficit) + ' given up.');
    } else if (got - sent > minGain) why.push('Takes in more projection than it sends: ' + n1(got) + ' a week against ' + n1(sent) + '.');
    else if (deficit > minGain) why.push('Sends ' + n1(deficit) + ' a week more projection than it gets, which the lineup gain covers.');

    // 4. What was sent that was not starting anyway.
    var lo = lineupOpts(T.repl, h, T.size);
    var after = lineupValue(without(T.roster, give).concat(get), S, function (p) { return pt(p, h); }, lo);
    var wasStarting = {};
    lineupValue(T.roster, S, function (p) { return pt(p, h); }, lo).starters.forEach(function (r) { if (!r.free) wasStarting[idOf(r.p)] = r.slot; });
    var idle = give.filter(function (p) { return !wasStarting[idOf(p)]; });
    if (idle.length && idle.length === give.length) why.push(names(idle) + (idle.length === 1 ? ' was' : ' were') + ' not starting, so the lineup loses nothing by sending ' + (idle.length === 1 ? 'him' : 'them') + '.');
    else if (idle.length) why.push(names(idle) + (idle.length === 1 ? ' was' : ' were') + ' on the bench.');

    // 5. Throw-ins that would only be cut. A side taking more players than
    // it sends has to cut as many; the cuts are the least valuable players on
    // the roster after the trade, and a player arriving at or under that
    // line is one the manager would cut to make room for himself.
    var spots = Math.max(0, get.length - give.length);
    var startsAfter = {};
    after.starters.forEach(function (r) { if (!r.free) startsAfter[idOf(r.p)] = r.slot; });
    var filler = [];
    if (spots) {
      var rank = without(T.roster, give).concat(get).map(per).sort(function (a, b) { return a - b; });
      var cutLine = rank[Math.min(spots, rank.length) - 1];
      // A player the lineup fill itself cut to make room (lines.cut) is a
      // throw-in by definition; so is one worth no more than the cut line.
      filler = get.filter(function (p) { return !startsAfter[idOf(p)] && (per(p) <= cutLine + 1e-9 || ln.cut.some(function (c) { return c.p === p; })); });
    }
    if (filler.length) {
      accept = false;
      against.push('Would have to open ' + (spots === 1 ? 'a roster spot' : spots + ' roster spots') + ' for ' + names(filler) + ', who would not start and would be the next cut.');
    } else if (spots) why.push('Takes ' + (get.length) + ' for ' + give.length + ', and every player arriving has a place on the roster.');

    // 6. Depth: holes are refused, a thin bench is noted.
    var depth = {}, posList = ['QB', 'RB', 'WR', 'TE'];
    posList.forEach(function (ps) { depth[ps] = { before: 0, after: 0, slots: S[ps] }; });
    T.roster.forEach(function (p) { var ps = String(p.pos || '').toUpperCase(); if (depth[ps]) depth[ps].before++; });
    without(T.roster, give).concat(get).forEach(function (p) { var ps = String(p.pos || '').toUpperCase(); if (depth[ps]) depth[ps].after++; });
    posList.forEach(function (ps) {
      var d = depth[ps];
      if (d.after < d.slots && d.before >= d.slots) { accept = false; against.push('Opens a hole at ' + ps + ': ' + d.after + ' left for ' + d.slots + ' starting slot' + (d.slots === 1 ? '' : 's') + '.'); }
      else if ((ps === 'RB' || ps === 'WR') && d.slots > 0 && d.after === d.slots && d.before > d.slots) against.push('Leaves no backup at ' + ps + '.');
    });

    // 7. A team on a short clock is also asked what the deal costs over the season.
    var seasonNote = null;
    if (season && h !== season && h !== 'playoffs' && typeof o.weeks === 'function') {
      var swk = Math.max(1, Number(o.weeks(season)) || 1);
      var so = lineupOpts(T.repl, season, T.size);
      var sBefore = lineupValue(T.roster, S, function (p) { return pt(p, season); }, so).total;
      var sAfter = lineupValue(without(T.roster, give).concat(get), S, function (p) { return pt(p, season); }, so).total;
      if (sBefore > 0 || sAfter > 0) {
        var sGain = (sAfter - sBefore) / swk;
        seasonNote = { h: season, weeks: swk, gain: sGain };
        if (sGain <= -minGain) {
          if (gain < 0.5 * -sGain) { accept = false; against.push('Costs ' + n1(-sGain) + ' a week over ' + label(season) + ' for ' + signed(gain) + ' now: the season given away for a rental.'); }
          else against.push('Costs ' + n1(-sGain) + ' a week over ' + label(season) + ', the price of winning now.');
        } else if (sGain >= minGain) why.push('Also gains ' + signed(sGain) + ' a week over ' + label(season) + '.');
      }
    }

    // 8. The other side's gain, when known: nobody signs the deal that pays the other manager ten times over.
    if (isFinite(Number(otherGain)) && otherGain > 0 && gain < 2 && gain < 0.3 * otherGain) {
      accept = false;
      against.push('Gains ' + signed(gain) + ' a week while the other side gains ' + signed(otherGain) + '; a manager who runs the numbers asks for more.');
    }

    return { accept: accept, gain: gain, sent: sent, got: got, best: best ? { p: best, side: bestSide } : null, spots: spots, filler: filler,
             depth: depth, season: seasonNote, why: why, against: against, lines: ln, starts: startsAfter };
  }

  // The wire for a search or a judgment: the board's pool through
  // replacementLevel, a replacement function handed in directly, or nothing.
  function wireOf(o, S, pt) {
    if (o.pool && o.pool.length) return replacementLevel(o.pool, S, o.leagueSize, pt);
    return typeof o.replacement === 'function' ? o.replacement : null;
  }
  function lineupOpts(repl, h, size) {
    return { repl: repl ? function (pos) { return repl(pos, h); } : null, size: size };
  }
  // A side's lineup before and after, scored at the same number of roster
  // spots (the roster's own count, so a 2-for-1 cuts a bench player on the
  // side taking two and refills the spot off the wire on the side sending
  // two) and against the same wire. Free agents are never named in the lines:
  // "starts now" is a player who arrived or came off the bench, "to the
  // bench" a player who was starting and is still on the roster.
  function lines(T, give, get, pt) {
    var pts = function (p) { return pt(p, T.h); }, o = lineupOpts(T.repl, T.h, T.size);
    var before = lineupValue(T.roster, T.slots, pts, o);
    var after = lineupValue(without(T.roster, give).concat(get), T.slots, pts, o);
    var was = {}, now = {};
    before.starters.forEach(function (r) { if (!r.free) was[idOf(r.p)] = r.slot; });
    after.starters.forEach(function (r) { if (!r.free) now[idOf(r.p)] = r.slot; });
    var row = function (r) { return { p: r.p, slot: r.slot, v: r.v }; };
    return {
      before: before.total, after: after.total,
      startsNow: after.starters.filter(function (r) { return !r.free && !was[idOf(r.p)]; }).map(row),
      stopsStarting: before.starters.filter(function (r) { return !r.free && !now[idOf(r.p)] && give.indexOf(r.p) < 0; }).map(row),
      cut: after.cut.map(row)
    };
  }

  return {
    fold: fold, makePool: makePool, resolve: resolve, suggest: suggest, parseRosters: parseRosters, isNoise: isNoise,
    lineupValue: lineupValue, replacementLevel: replacementLevel, normSlots: normSlots, findTrades: findTrades, evaluateTrade: evaluateTrade, judgeSide: judgeSide, BENCH_W: BENCH_W
  };
});
