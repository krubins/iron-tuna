/* Iron Tuna — the reader's own league, on every page that prints a number.
 *
 * The front page and the insight drops quote points and dollars. Left alone
 * those numbers describe the site's default league (12 teams, $200, full PPR),
 * which is the wrong league for most readers: a $300 budget re-prices every
 * player on the board, and half-PPR or 6-point passing TDs re-orders it.
 * This file is the one place that knows what the reader actually plays, so a
 * story can print THEIR number instead of a stranger's.
 *
 * Two sources, both written by the draft app on this same origin:
 *   iron_tuna_draft_state_v2  — the league itself: teams, budget, format and
 *                               the full custom scoring. The authority.
 *   iron_tuna_values_v1       — a snapshot of the reader's own board: every
 *                               player's value and projected points AT THOSE
 *                               SETTINGS. This is what makes a rank personal;
 *                               without it we can still re-score and re-price,
 *                               we just cannot re-rank.
 *
 * Nothing here invents a league. With no saved settings every accessor reports
 * "no league" and the calling page prints exactly what it printed before — a
 * reader who has never opened the app must never be shown numbers dressed up
 * as theirs.
 *
 * HAND-SYNCED with index.html: SCORING_DEFAULTS mirrors DEFAULT_LEAGUE_CONFIG.
 * scoring, CURVE mirrors LEAGUE_MARKET_CURVE, CURVE_BUDGET mirrors
 * LEAGUE_CURVE_BUDGET, and score() mirrors scoreSkillPlayer/yardageScore/
 * countScore. There is no build step. tools/test-it-league.mjs asserts the
 * copies stay in agreement — change them together.
 */
(function (root) {
  'use strict';

  var DEFAULT_TEAMS = 12, DEFAULT_BUDGET = 200;
  var SCORING_DEFAULTS = {
    passingYardsPerPoint: 25, passingYardsThreshold: 125, passingTD: 4, passingInt: -2, passing2pt: 2,
    rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingTD: 6, rushing2pt: 2,
    receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingTD: 6, receiving2pt: 2,
    receptionPoints: 1, rbReceptionPoints: 1, fumbleLost: -2, fumble2pt: 2,
    individualFumbleRecoveryTD: 6, individualKickReturnTD: 6, individualPuntReturnTD: 6
  };
  // The client's market curve, and the budget it is drawn at. A league's prices
  // are this curve scaled by (teams x budget) / CURVE_BUDGET — which is the
  // whole of "use the reader's budget": a $300 league pays 1.5x the sheet.
  var CURVE_BUDGET = 1440;
  var CURVE = {
    QB: [28, 23, 19, 16, 13, 11, 8, 6, 5, 4, 3, 3, 2, 2, 1, 1],
    RB: [43, 40, 38, 33, 30, 28, 25, 23, 22, 20, 19, 18, 15, 12, 11, 9, 8, 8, 7, 6, 6, 6, 5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    WR: [42, 40, 36, 35, 31, 28, 24, 24, 17, 16, 15, 14, 12, 12, 10, 9, 9, 9, 7, 6, 6, 6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    TE: [32, 28, 20, 14, 11, 9, 7, 6, 5, 5, 3, 2, 2, 2, 1, 1],
    K: [2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    DEF: [3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  };
  var MIN_BID = 1;
  var FORMAT_WORD = { auction: 'auction', snake: 'snake draft', bestball: 'best ball' };

  function readJSON(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function num(v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; }

  // ── the league ────────────────────────────────────────────────────────────
  var state = readJSON('iron_tuna_draft_state_v2');
  var snap = readJSON('iron_tuna_values_v1');
  if (snap && (!snap.players || !snap.players.length)) snap = null;

  var raw = state && state.config ? state.config : null;
  var cfg = null;
  if (raw || snap) {
    var scoring = {};
    var src = (raw && raw.scoring) || {};
    for (var k in SCORING_DEFAULTS) {
      if (SCORING_DEFAULTS.hasOwnProperty(k)) scoring[k] = num(src[k], SCORING_DEFAULTS[k]);
    }
    // Bonus ladders ride along untouched: they are arrays, and a league that
    // pays a bonus at 100 yards scores differently from one that does not.
    ['passingYardBonuses', 'rushingYardBonuses', 'receivingYardBonuses',
     'receptionBonuses', 'rbReceptionBonuses'].forEach(function (b) {
      scoring[b] = Array.isArray(src[b]) ? src[b] : [];
    });
    cfg = {
      teams: Math.max(2, Math.round(num(raw && raw.teams, num(snap && snap.teams, DEFAULT_TEAMS)))),
      budget: Math.max(1, Math.round(num(raw && raw.budget, num(snap && snap.budget, DEFAULT_BUDGET)))),
      format: (raw && raw.format) || (snap && snap.format) || 'auction',
      scoring: scoring
    };
  }

  // "Custom" is the difference the reader can see. A saved league that matches
  // the site defaults in every respect would re-print the same numbers anyway,
  // so it earns no "your league" labelling — a badge that changes nothing is
  // just noise, and worse, it teaches readers to distrust the ones that matter.
  // Scoring is tracked separately from budget and team count, because a story
  // can honour one without the other: points move with scoring, prices move
  // with the budget.
  var customScoring = false;
  if (cfg) {
    for (var sk in SCORING_DEFAULTS) {
      if (SCORING_DEFAULTS.hasOwnProperty(sk) && cfg.scoring[sk] !== SCORING_DEFAULTS[sk]) customScoring = true;
    }
    ['passingYardBonuses', 'rushingYardBonuses', 'receivingYardBonuses',
     'receptionBonuses', 'rbReceptionBonuses'].forEach(function (b) {
      if (cfg.scoring[b] && cfg.scoring[b].length) customScoring = true;
    });
  }
  var customLeague = !!cfg && (cfg.teams !== DEFAULT_TEAMS || cfg.budget !== DEFAULT_BUDGET);
  var custom = customScoring || customLeague;

  // ── scoring: a faithful port of the client's scoreSkillPlayer ─────────────
  function yardageScore(yards, perPoint, threshold, bonuses) {
    if (yards < threshold) return 0;
    // A blanked scoring input saves NaN (parseFloat('')) — a bad divisor here
    // would poison every number this file prints.
    var pts = perPoint > 0 ? yards / perPoint : 0;
    (bonuses || []).forEach(function (b) { if (yards >= b.at) pts += b.points; });
    return pts;
  }
  function countScore(count, perEvent, bonuses) {
    if (!count) return 0;
    var pts = count * perEvent;
    (bonuses || []).forEach(function (b) { if (count >= b.at) pts += b.points; });
    return pts;
  }
  function score(stats, position, scoringOverride) {
    var s = scoringOverride || (cfg && cfg.scoring) || SCORING_DEFAULTS;
    stats = stats || {};
    var pts = 0;
    pts += yardageScore(stats.passYd || 0, s.passingYardsPerPoint, s.passingYardsThreshold, s.passingYardBonuses);
    pts += (stats.passTD || 0) * s.passingTD;
    pts += (stats.passInt || 0) * s.passingInt;
    pts += (stats.pass2pt || 0) * s.passing2pt;
    pts += yardageScore(stats.rushYd || 0, s.rushingYardsPerPoint, s.rushingYardsThreshold, s.rushingYardBonuses);
    pts += (stats.rushTD || 0) * s.rushingTD;
    pts += (stats.rush2pt || 0) * s.rushing2pt;
    pts += yardageScore(stats.recYd || 0, s.receivingYardsPerPoint, s.receivingYardsThreshold, s.receivingYardBonuses);
    pts += (stats.recTD || 0) * s.receivingTD;
    pts += (stats.rec2pt || 0) * s.receiving2pt;
    if (position === 'RB') pts += countScore(stats.rec || 0, s.rbReceptionPoints, s.rbReceptionBonuses);
    else pts += countScore(stats.rec || 0, s.receptionPoints, s.receptionBonuses);
    pts += (stats.fumLost || 0) * s.fumbleLost;
    pts += (stats.fum2pt || 0) * s.fumble2pt;
    pts += (stats.fumRecTD || 0) * s.individualFumbleRecoveryTD;
    pts += (stats.krTD || 0) * s.individualKickReturnTD;
    pts += (stats.prTD || 0) * s.individualPuntReturnTD;
    return pts;
  }

  // Curve slot -> dollars in THIS reader's league. Same shape as the client's
  // calculateMarketValues, so a price quoted in a story is a price they can go
  // and find on their own sheet.
  function price(position, rankIndex) {
    var curve = CURVE[position] || [];
    var scale = (cfg ? cfg.teams * cfg.budget : DEFAULT_TEAMS * DEFAULT_BUDGET) / CURVE_BUDGET;
    var base = rankIndex < curve.length ? curve[rankIndex] : MIN_BID;
    return Math.max(MIN_BID, Math.round(base * scale));
  }

  // A dollar figure written about a MANAGER'S OWN money in the site's default
  // $200 league, restated in the reader's: "how to spend the $200" becomes "how
  // to spend the $300", and a $40 stud in that prose becomes a $60 one.
  //
  // Deliberately scaled by budget alone, not by the league pool. Team count
  // belongs in price(), where more teams means more money chasing the same
  // players; it does not belong here, where the sentence is about one manager's
  // wallet and a 10-team league does not shrink it.
  function money(perTeamDollars) {
    var n = num(perTeamDollars, 0);
    if (!cfg) return Math.round(n);
    return Math.max(0, Math.round(n * cfg.budget / DEFAULT_BUDGET));
  }

  // ── the reader's board ────────────────────────────────────────────────────
  // Suffix first, THEN last word — normName("III") is "", which would bucket
  // every suffixed name under one key. Same rule as my-insights.html.
  function normName(s) {
    return String(s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '').replace(/[^a-z]/g, '');
  }
  function lastNameKey(s) {
    var w = String(s || '').trim().replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').split(/\s+/);
    return normName(w[w.length - 1]);
  }
  var byName = {}, byLast = {}, byPos = {};
  if (snap) {
    snap.players.forEach(function (p) {
      byName[normName(p.n)] = p;
      var last = lastNameKey(p.n);
      if (last) (byLast[last] = byLast[last] || []).push(p);
      (byPos[p.pos] = byPos[p.pos] || []).push(p);
    });
    Object.keys(byPos).forEach(function (pos) {
      byPos[pos].sort(function (a, b) { return (b.pts || 0) - (a.pts || 0); });
    });
  }
  // Resolve a name field to a row on the reader's board. The premium insight set
  // stores several names per call, semicolon-separated ("DJ Moore; Allen"), so
  // each entry is tried in order — the first one the board knows wins. A bare
  // surname only resolves when exactly one player at that position carries it;
  // an ambiguous one resolves to nothing rather than to a coin flip.
  function findPlayer(name, position) {
    if (!snap || !name) return null;
    var entries = String(name).split(';');
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i].trim();
      if (!e) continue;
      var hit = byName[normName(e)];
      if (hit && (!position || position === 'Market' || hit.pos === position)) return hit;
      var cands = (byLast[lastNameKey(e)] || []).filter(function (p) {
        return !position || position === 'Market' || p.pos === position;
      });
      if (cands.length === 1) return cands[0];
    }
    return null;
  }
  // Pull a player the reader's own board knows out of a headline. Longest match
  // wins so "Kenneth Walker" is never read as some other Walker, and the search
  // is anchored on word boundaries so "Love" cannot match inside "Loveland".
  function playerInText(text, position) {
    if (!snap || !text) return null;
    var hay = ' ' + String(text).toLowerCase().replace(/[^a-z]+/g, ' ') + ' ';
    var best = null;
    var pool = (position && position !== 'Market' && byPos[position]) ? byPos[position] : snap.players;
    pool.forEach(function (p) {
      var full = ' ' + String(p.n).toLowerCase().replace(/[^a-z]+/g, ' ').trim() + ' ';
      if (full.length > 3 && hay.indexOf(full) >= 0 && (!best || full.length > best.len)) {
        best = { p: p, len: full.length };
      }
    });
    return best ? best.p : null;
  }
  // Where a points total would sit on the reader's board at their scoring. The
  // board is the shipped (odds-blended) one, so this answers "which slot does
  // this land on MY sheet", which is the only rank a reader can act on.
  function rankOf(position, pts) {
    var list = byPos[position];
    if (!list || !list.length) return null;
    var n = 1;
    for (var i = 0; i < list.length; i++) if ((list[i].pts || 0) > pts) n++;
    return n;
  }
  // Slots a player moves on the reader's board when their projection shifts by
  // `pct`. Mirrors my-insights.html — same maths, so the two pages agree.
  function slotsMoved(p, pct) {
    if (!snap || !p) return 0;
    var np = (p.pts || 0) * (1 + pct), n = 0;
    for (var i = 0; i < snap.players.length; i++) {
      var q = snap.players[i];
      if (q === p) continue;
      if (pct > 0 ? (q.pts > p.pts && q.pts <= np) : (q.pts < p.pts && q.pts >= np)) n++;
    }
    return n;
  }

  // ── copy helpers ──────────────────────────────────────────────────────────
  function label() {
    if (!cfg) return '';
    return 'your ' + cfg.teams + '-team' +
      (cfg.format === 'auction' ? ', $' + cfg.budget + ' auction' : ' ' + (FORMAT_WORD[cfg.format] || 'league'));
  }
  function scoringLabel() {
    if (!cfg) return '';
    var rec = cfg.scoring.receptionPoints;
    var base = rec >= 1 ? 'full PPR' : rec >= 0.5 ? 'half-PPR' : rec > 0 ? rec + ' PPR' : 'standard';
    if (cfg.scoring.passingTD !== 4) base += ', ' + cfg.scoring.passingTD + '-point passing TDs';
    if (cfg.scoring.rbReceptionPoints !== rec) base += ', ' + cfg.scoring.rbReceptionPoints + ' per RB catch';
    return base;
  }
  // "+12% to +18%" / "-4%" out of an editorial effect line. Returns [lo, hi] as
  // fractions, or null when the line is qualitative — a story that never
  // quantified itself must not be handed a fabricated dollar figure.
  function pctRange(effect) {
    var m = String(effect || '').match(/([+-]?\d+(?:\.\d+)?)\s*%\s*(?:to|–|—|-)\s*([+-]?\d+(?:\.\d+)?)\s*%/);
    if (m) return [parseFloat(m[1]) / 100, parseFloat(m[2]) / 100];
    var s = String(effect || '').match(/([+-]\d+(?:\.\d+)?)\s*%/);
    return s ? [parseFloat(s[1]) / 100, parseFloat(s[1]) / 100] : null;
  }
  // The whole point of the file, in one sentence of copy: what this call is
  // worth on the reader's own sheet, in their dollars or their draft slots.
  // formatOverride lets a page that offers a format switcher (my-insights) ask
  // for the same call read as an auction, a snake draft or best ball without
  // touching the reader's saved league.
  function tailor(effect, name, position, formatOverride) {
    if (!cfg || !snap) return '';
    var r = pctRange(effect);
    if (!r) return '';
    var fmt = formatOverride || cfg.format;
    // Whole-name containment first: callers pass free text (a headline as often
    // as a name field), and findPlayer's last-name fallback would happily read
    // "...is a reputation trap" as some player called Trap. playerInText only
    // ever matches a full name, so it is the safe reading of a sentence.
    var p = playerInText(name, position) || findPlayer(name, position);
    if (!p) return '';
    var lo = Math.min(r[0], r[1]), hi = Math.max(r[0], r[1]);
    var up = (lo + hi) / 2 > 0;
    if (fmt === 'auction') {
      var v = p.v || 0;
      if (v < 1) return '';
      var d1 = Math.max(1, Math.round(Math.abs(lo) * v)), d2 = Math.max(1, Math.round(Math.abs(hi) * v));
      if (d2 < d1) { var t = d1; d1 = d2; d2 = t; }
      var rng = d1 === d2 ? ('$' + d2) : ('$' + d1 + '–$' + d2);
      return p.n + ' is $' + v + ' on your sheet — ' +
        (up ? 'worth about ' + rng + ' more in ' + label() + '.' : 'trim about ' + rng + ' off in ' + label() + '.');
    }
    var s1 = slotsMoved(p, lo), s2 = slotsMoved(p, hi);
    var a = Math.min(s1, s2), b = Math.max(s1, s2);
    if (b === 0) return 'In ' + label() + ' the shift is less than one draft slot — treat it as a hold.';
    var rounds = b / cfg.teams;
    var rt = rounds >= 0.9 ? ' (about ' + (Math.round(rounds * 10) / 10) + (rounds >= 1.5 ? ' rounds' : ' round') + ')'
           : rounds >= 0.45 ? ' (about half a round)' : '';
    return 'Move ' + p.n + (up ? ' up ' : ' down ') + (a === b ? b : a + '–' + b) + ' slots' + rt +
      ' in ' + label() + '.';
  }

  // One stylesheet for the "Your league:" line, injected rather than copied into
  // forty pages' <style> blocks. It has to sit on the light front page and the
  // dark drop pages alike, so it borrows the reader's text colour and paints
  // only a translucent teal wash and rule — no palette assumptions beyond the
  // --teal token every page already defines, and a literal fallback if it does not.
  var STYLE_ID = 'it-league-css';
  function ensureStyle() {
    var doc = root.document;
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = '.it-yours{margin:6px 0 0;padding:6px 10px;font-size:12.5px;font-style:normal;' +
      'line-height:1.45;border-left:3px solid var(--teal,#2dd4a3);border-radius:0 4px 4px 0;' +
      'background:rgba(45,212,163,0.09)}' +
      '.it-dollars{color:var(--teal,#2dd4a3);font-weight:700;white-space:nowrap}';
    doc.head.appendChild(el);
  }

  // ── declarative rewrites, for pages that only need a number swapped ───────
  // A guide that says "in a $200, 12-team league" marks the figures up as
  // data-it-money / data-it-teams and this restates them in the reader's league.
  // Untouched when there is no league — the printed default is still true.
  // `scope` narrows WHAT is rewritten (a freshly rendered subtree, say); the
  // document is still what creates nodes, because an element is not a factory.
  function applyMarkup(scope) {
    if (!cfg) return;
    ensureStyle();
    var doc = root.document;
    var where = scope || doc;
    if (!doc || !where || !where.querySelectorAll) return;
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-money]'), function (el) {
      var v = money(el.getAttribute('data-it-money'));
      if (v > 0) el.textContent = '$' + v;
    });
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-teams]'), function (el) {
      el.textContent = String(cfg.teams);
    });
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-league]'), function (el) {
      el.textContent = label();
    });
    // Allocation copy is written in percentages because a percentage is true in
    // every league. What it BUYS is not: 38% is $76 at $200 and $114 at $300.
    // data-it-pct="38-42" prints the reader's own band beside the percentage.
    Array.prototype.forEach.call(where.querySelectorAll('[data-it-pct]'), function (el) {
      if (el.getAttribute('data-it-filled')) return;
      var band = String(el.getAttribute('data-it-pct') || '').split('-');
      var lo = num(band[0], NaN), hi = num(band.length > 1 ? band[1] : band[0], NaN);
      if (!isFinite(lo) || !isFinite(hi)) return;
      var d1 = Math.round(cfg.budget * Math.min(lo, hi) / 100);
      var d2 = Math.round(cfg.budget * Math.max(lo, hi) / 100);
      var span = doc.createElement('span');
      span.className = 'it-dollars';
      span.textContent = ' (' + (d1 === d2 ? '$' + d2 : '$' + d1 + '\u2013$' + d2) + ')';
      el.parentNode.insertBefore(span, el.nextSibling);
      el.setAttribute('data-it-filled', '1');
    });
  }

  // Insight drop pages carry their calls as <p class="statline">Projected
  // effect: ...</p> under the call's <h2>. Any of them that quantified itself
  // gets the reader's own translation appended, once, on load.
  function tailorStatlines(scope) {
    if (!cfg || !snap) return 0;
    var doc = root.document;
    var where = scope || doc;
    if (!doc || !where || !where.querySelectorAll) return 0;
    ensureStyle();
    var n = 0;
    Array.prototype.forEach.call(where.querySelectorAll('p.statline'), function (el) {
      if (el.getAttribute('data-it-tailored')) return;
      var call = el.closest ? el.closest('.call') : null;
      var host = call || el.parentNode;
      var h = host && host.querySelector ? host.querySelector('h2') : null;
      var posEl = call && call.querySelector ? call.querySelector('.cpos') : null;
      var pos = posEl ? (posEl.textContent || '').trim() : '';
      var line = tailor(el.textContent, h ? h.textContent : '', pos);
      if (!line) return;
      var d = doc.createElement('p');
      d.className = 'it-yours';
      d.innerHTML = '<b>Your league:</b> ' + line.replace(/[&<>]/g, function (c) {
        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
      });
      el.parentNode.insertBefore(d, el.nextSibling);
      el.setAttribute('data-it-tailored', '1');
      n++;
    });
    return n;
  }

  root.ITLeague = {
    has: !!cfg,
    hasBoard: !!snap,
    custom: custom,
    customScoring: customScoring,
    customLeague: customLeague,
    config: cfg,
    defaults: { teams: DEFAULT_TEAMS, budget: DEFAULT_BUDGET, scoring: SCORING_DEFAULTS, curve: CURVE, curveBudget: CURVE_BUDGET },
    score: score,
    price: price,
    money: money,
    rankOf: rankOf,
    findPlayer: findPlayer,
    playerInText: playerInText,
    slotsMoved: slotsMoved,
    pctRange: pctRange,
    tailor: tailor,
    label: label,
    scoringLabel: scoringLabel,
    ensureStyle: ensureStyle,
    applyMarkup: applyMarkup,
    tailorStatlines: tailorStatlines
  };

  // Pages opt in by including this file; the two auto-passes are safe no-ops on
  // a page with neither the markup nor a statline.
  function boot() { if (cfg) ensureStyle(); applyMarkup(); tailorStatlines(); }
  if (root.document) {
    // Paint the rule as early as the document allows: a page that renders its
    // own "Your league" lines from an inline script runs before DOMContentLoaded,
    // and an unstyled flash is a worse first impression than a slow one.
    if (cfg) ensureStyle();
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
