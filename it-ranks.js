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
 * NOTHING IS INVENTED. A number the payload does not carry prints as an em dash.
 * A board that does not answer prints why and shows no table at all, rather than
 * a stale one.
 */
(function () {
  'use strict';

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

    function rowHtml(p) {
      var w0 = p.weeks && p.weeks.filter(function (w) { return !w.bye && !w.out; })[0];
      var oppCell = horizon === 'week'
        ? '<td>' + (w0 ? esc((w0.home ? 'vs ' : 'at ') + w0.opponent) : '<span class="is-status">BYE</span>') + '</td>'
        : '<td class="num">' + (p.games == null ? '—' : p.games) + '</td>';
      var opener = wantWeeks
        ? '<td><button class="rk-open" type="button" data-open="' + esc(p.key) + '" aria-expanded="' + (open[p.key] ? 'true' : 'false') +
          '" aria-label="Show every remaining week for ' + esc(p.name) + '">' + (open[p.key] ? '&minus;' : '+') + '</button></td>'
        : '';
      return '<tr>' + opener +
        '<td class="num">' + (primaryRank(p) == null ? '—' : esc(p.position) + primaryRank(p)) + '</td>' +
        '<td class="rk-who"><a href="/in-season/player/' + slug(p.name) + '?pos=' + esc(p.position) + '"><b>' + esc(p.name) + '</b></a>' +
          (pos === 'ALL' || pos === 'FLEX' ? '<small>' + esc(p.position) + '</small>' : '') + '</td>' +
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
        (payload.season ? ' &middot; ' + esc(payload.season) + ' season' : '');

      var src = payload.sources || {};
      foot.innerHTML = 'The <b>Betting Odds</b> column reads its basis off the market: <b>props</b> is a priced player prop, ' +
        '<b>gamelines</b> is the posted game line&rsquo;s scoring environment applied to his line, and <b>ratings</b> is a fixture no ' +
        'book has posted yet, projected from fitted team ratings and graded low. ' +
        (src.props ? esc(src.props) + ' players carry a prop this week. ' : 'No sportsbook has posted a player prop for this week yet. ') +
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
