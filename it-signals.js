/* Iron Tuna — the signal engine, read on a page.
 *
 * /api/signals is the site's insight detection engine: twelve rules run over
 * the boards, the line history and the usage overlay, each one returning the
 * NUMBERS IT FIRED ON. /api/ros-update is the Wednesday snapshot diff, and is
 * the only source on this site that knows what CHANGED about a player rather
 * than what is true about him.
 *
 * This file puts words to both, and paints the rail that shows them one
 * player at a time. It exists because /fantasy and /dfs both wear that rail
 * and the templates are the part that must not drift: two copies of "the book
 * projects X against a consensus Y" is two pages that will eventually round
 * the same number two different ways.
 *
 *   ITSignals.read(preset)        -> Promise<{movers, signals, insights}>; one
 *                                    request each, both failing soft to empty
 *   ITSignals.sentence(insight)   -> the insight as a sentence, as HTML
 *   ITSignals.headline(insight)   -> the insight as a headline, as text
 *   ITSignals.items(movers, ins)  -> rail items, movers first, one per player
 *   ITSignals.rail(els, items)    -> paint the rail and wire it
 *
 * NOTHING HERE WRITES A SENTENCE A PAYLOAD DID NOT SUPPLY THE NUMBERS FOR.
 * The templates can point at a number; they cannot invent a reason. That is
 * buildTake's contract in the worker (_worker.js) and it is this file's too.
 * A rule this file has no template for still prints — its label, its subject,
 * and nothing invented around them.
 */
(function (root, doc) {
  'use strict';

  function e(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function n1(v) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(1); }
  function sg(v) { return (v == null || !isFinite(v)) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1); }
  function si(v) { return (v == null || !isFinite(v)) ? '—' : (v > 0 ? '+' : '') + Math.round(v); }
  function slug(n) { return String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  // What a Vegas number is built from, in words. The board's own `basis`
  // vocabulary; a page never prints the raw token.
  function basisWord(b) {
    b = String(b || '');
    if (b.indexOf('props') === 0) return 'a posted player prop';
    if (b.indexOf('gamelines') === 0) return 'the posted game line rather than a quoted prop';
    if (b === 'ratings') return 'fitted team ratings, which no book has priced yet';
    return b || 'the market feed';
  }
  function who(s) {
    if (!s || !s.name) return '';
    return '<b>' + e(s.name) + '</b>' + (s.position ? ' (' + e(s.position) + (s.team ? ', ' + e(s.team) : '') + ')' : '');
  }

  // ── one detected insight, as a sentence ───────────────────────────────────
  // One template per rule, each naming only the fields that rule returns.
  function sentence(ins) {
    if (!ins) return '';
    var d = ins.data || {}, s = ins.subject || {}, w = who(s);
    switch (ins.type) {
      case 'vegas_above_consensus':
      case 'vegas_below_consensus':
        return w + ': the book projects ' + n1(d.vegasPoints) + ' points this week against a consensus ' +
          n1(d.consensusPoints) + ' — ' + sg(d.pointsDelta) + ' points and ' + si(d.rankDelta) +
          ' places, off ' + basisWord(d.basis) + '. Iron Tuna blends the two to ' + n1(d.ironTunaPoints) + '.' +
          (d.summary ? ' ' + e(d.summary) : '');
      case 'line_movement':
        if (d.currentProbability != null) {
          return w + ': his anytime-touchdown price has moved from ' + n1(d.openProbability) + '% to ' +
            n1(d.currentProbability) + '% since it opened, at ' + e(d.booksMoved) + ' of ' + e(d.books) + ' books.';
        }
        return w + ': the ' + e(String(d.label || d.market).toLowerCase()) + ' line has moved from ' + e(d.open) +
          ' to ' + e(d.current) + ', ' + si(d.percentChange) + '%, at ' + e(d.booksMoved) + ' of ' + e(d.books) + ' books.';
      case 'role_increase':
      case 'role_decrease':
        return w + ': ' + e(d.latestTouches) + ' touches in Week ' + e(d.latestWeek) + ' against a season average of ' +
          n1(d.seasonAvgTouches) + ' over ' + e(d.games) + ' games — ' + si(d.pct) + '% on his own baseline' +
          (d.snapPct != null ? ', on ' + Math.round(d.snapPct * 100) + '% of the snaps' : '') + '.';
      case 'production_below_opportunity':
        return w + ': ' + e(d.touches) + ' touches in Week ' + e(d.week) + ' were worth ' + n1(d.expectedPoints) +
          ' points at the league rate and returned ' + n1(d.actualPoints) + '. The work is there; the points are not yet.';
      case 'production_above_opportunity':
        return w + ': ' + e(d.touches) + ' touches in Week ' + e(d.week) + ' returned ' + n1(d.actualPoints) +
          ' points against the ' + n1(d.expectedPoints) + ' the league rate implies. That is efficiency, not volume.';
      case 'target_consolidation':
      case 'backfield_consolidation':
        return w + ': ' + n1(d.share) + '% of ' + e(d.team) + '’s ' +
          (ins.type === 'target_consolidation' ? 'targets' : 'carries') + ' in Week ' + e(d.week) +
          ', against ' + n1(d.seasonShare) + '% across the season so far.';
      case 'td_regression':
        return w + ': ' + n1(d.actualTdsPerGame) + ' touchdowns a game over ' + e(d.games) +
          ' against a projected ' + n1(d.projectedTdsPerGame) + '. ' + (d.direction === 'negative'
            ? 'He is scoring faster than the projection carries him, and that is the direction regression runs against.'
            : 'He is scoring slower than the projection carries him, and that is the direction regression runs in his favour.');
      case 'game_script_change':
        return '<b>' + e(s.game || s.team) + '</b>: the spread has moved ' + sg(d.spreadMove) + ' and the total ' +
          sg(d.totalMove) + ' since it opened. ' + e(d.interpretation || '');
      default:
        return (w || '<b>' + e(s.game || s.team || '') + '</b>') + ': ' + e(ins.label) + '.';
    }
  }

  // ── the same insight, as a headline ───────────────────────────────────────
  function headline(ins) {
    if (!ins) return '';
    var d = ins.data || {}, s = ins.subject || {}, nm = s.name || s.game || s.team || '';
    switch (ins.type) {
      case 'vegas_above_consensus': return 'The book is ' + n1(Math.abs(d.pointsDelta)) + ' points above the consensus on ' + nm;
      case 'vegas_below_consensus': return 'The book is ' + n1(Math.abs(d.pointsDelta)) + ' points below the consensus on ' + nm;
      case 'line_movement': return 'The market has moved on ' + nm + ' since the line opened';
      case 'role_increase': return nm + ' is playing a bigger role than his season average says';
      case 'role_decrease': return nm + ' is playing a smaller role than his season average says';
      case 'production_below_opportunity': return nm + ' is not converting the work he is already getting';
      case 'production_above_opportunity': return nm + ' is beating the work he is getting';
      case 'target_consolidation': return nm + ' is taking a bigger share of the targets';
      case 'backfield_consolidation': return nm + ' is taking a bigger share of the carries';
      case 'td_regression': return nm + ' is scoring at a rate the projection does not carry';
      case 'game_script_change': return 'The game script has moved in ' + nm;
      default: return ins.label + ' — ' + nm;
    }
  }

  // ── the two reads ─────────────────────────────────────────────────────────
  // Both fail soft, because a rail with nothing in it is a rail that says so
  // and a page that threw is a page with a hole in it.
  function readMovers(preset) {
    return fetch('/api/ros-update?scoring=' + (preset || 'ppr'), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return [];
        var out = [];
        [].concat(j.risers || [], j.fallers || []).forEach(function (m) {
          if (!m || !m.name || m.currentRank == null) return;
          out.push({
            sort: Math.abs(m.move || 0),
            key: String(m.name).toLowerCase(),
            kicker: 'Rest of season · ' + (m.move > 0 ? 'riser' : 'faller'),
            name: m.name, meta: m.position + ' · ' + m.team, href: '/player/' + slug(m.name),
            html: 'Iron Tuna has moved him ' + e(m.position + m.previousRank) + ' to <b>' + e(m.position + m.currentRank) +
              '</b> on the rest-of-season board' + (m.reasons && m.reasons.length ? ': ' + e(m.reasons.join('; ')) : '') + '.'
          });
        });
        out.sort(function (a, b) { return b.sort - a.sort; });
        return out;
      })
      .catch(function () { return []; });
  }
  function readSignals(preset) {
    return fetch('/api/signals?scoring=' + (preset || 'ppr'), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.ok && j.insights) ? j : null; })
      .catch(function () { return null; });
  }
  function read(preset) {
    return Promise.all([readMovers(preset), readSignals(preset)]).then(function (both) {
      var sig = both[1];
      return { movers: both[0] || [], signals: sig, insights: (sig && sig.insights) || [] };
    });
  }

  // ── the rail's items ──────────────────────────────────────────────────────
  // The Wednesday movers lead, because they are the only entries here that are
  // a CHANGE. The engine's own detections follow. One entry per player, so a
  // man the board moved and the engine also fired on appears once, as the
  // change rather than the state.
  function items(movers, insights, cap) {
    var out = [], used = {}, max = cap || 12;
    (movers || []).forEach(function (m) {
      if (used[m.key] || out.length >= max) return;
      used[m.key] = 1; out.push(m);
    });
    (insights || []).forEach(function (x) {
      var s = x.subject || {};
      if (!s.name || out.length >= max) return;
      var key = String(s.name).toLowerCase();
      if (used[key]) return;
      used[key] = 1;
      out.push({
        kicker: 'This week · ' + x.label, name: s.name,
        meta: (s.position || '') + (s.team ? ' · ' + s.team : ''),
        href: '/player/' + slug(s.name), html: sentence(x)
      });
    });
    return out;
  }

  // ── the rail ──────────────────────────────────────────────────────────────
  // One player at a time. It rotates on a timer that stops the moment a reader
  // touches it, and never starts at all for a reader who has asked for reduced
  // motion. `els` names the nodes rather than assuming ids, because the two
  // pages that wear this prefix theirs differently.
  var REDUCED = (function () {
    try { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (x) { return false; }
  })();
  function rail(els, list) {
    if (!els) return;
    var at = 0, timer = null;
    function empty(head, detail) {
      if (els.emptyH) els.emptyH.textContent = head;
      if (els.emptyP) els.emptyP.textContent = detail || '';
    }
    if (!list || !list.length) {
      empty('No player update has landed yet.',
        'The Wednesday board has not moved anybody and the signal engine has not fired. That is a reading, not a gap.');
      return;
    }
    function paint() {
      at = (at % list.length + list.length) % list.length;
      var it = list[at];
      els.body.innerHTML = '<span class="sl-upd-k">' + e(it.kicker) + '</span>' +
        '<p class="sl-upd-name">' + (it.href ? '<a href="' + e(it.href) + '">' + e(it.name) + '</a>' : e(it.name)) + '</p>' +
        (it.meta ? '<span class="sl-upd-meta">' + e(it.meta) + '</span>' : '') +
        '<p>' + it.html + '</p>';
      if (els.n) els.n.textContent = (at + 1) + ' of ' + list.length;
      if (els.dots) els.dots.innerHTML = list.map(function (x, i) { return '<i' + (i === at ? ' class="on"' : '') + '></i>'; }).join('');
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() { if (!REDUCED && !timer && list.length > 1) timer = setInterval(function () { at++; paint(); }, 8000); }
    if (els.empty) els.empty.hidden = true;
    els.box.hidden = false;
    paint(); start();
    if (els.prev) els.prev.addEventListener('click', function () { stop(); at--; paint(); });
    if (els.next) els.next.addEventListener('click', function () { stop(); at++; paint(); });
    els.box.addEventListener('mouseenter', stop);
    els.box.addEventListener('focusin', stop);
    els.box.addEventListener('mouseleave', start);
  }

  root.ITSignals = { read: read, sentence: sentence, headline: headline, items: items, rail: rail,
                     esc: e, n1: n1, sg: sg, si: si, slug: slug, basisWord: basisWord };
})(window, document);
