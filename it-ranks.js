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
 * numbers said in words, and the grammar and the tiers behind them live in
 * it-reads.js, shared with /rankings so the two cannot drift apart. This board
 * decides only WHAT TO FEED IT: the consensus rank and points, because that is
 * the column this ranking is published on.
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
  // The columns ?sort= may name. A closed list, because the value lands in
  // sortVal's switch and an unknown key would silently sort by nothing.
  var SORT_KEYS = ['rank', 'player', 'team', 'opp', 'games', 'cpts', 'crank',
                   'vpts', 'vrank', 'gap', 'extra'];

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
    var focus = '';              // the row ?player= names, until the reader moves
    var painted = false;         // whether the live board has rendered once

    // The board served WITH the page: the top of it, at PPR, written into this
    // host at the edge by ranksPrerender in _worker.js. It is a real board, not
    // a placeholder — the same boardsPayload the fetch below asks for — so it
    // stands until the live one has painted, and the reader never sees
    // "Reading the board…" on a page that arrived with 60 rows on it.
    var pre = host.querySelector('[data-rk-prerender]');

    // ── the view, in the URL ───────────────────────────────────────────────
    // Sixteen boards, one address each: a reader who sorted by the gap,
    // filtered to one club and found the row worth arguing about could send the
    // group chat nothing but "go to the rankings page and do what I did". So
    // the URL now says what is on screen, and an address that says so restores
    // it — for the next reader, and for a crawler, which sees as many useful
    // views as there are links to them.
    //
    // ?player= and #p-<slug> name the same row. The hash is the one that works
    // with no script at all, so it is honored too and it is what the share
    // button writes alongside the query.
    (function readUrl() {
      var qs;
      try { qs = new URLSearchParams(location.search); } catch (e) { return; }
      var sc = qs.get('scoring');
      if (/^(standard|half|ppr)$/.test(sc || '')) preset = sc;
      var so = qs.get('sort');
      if (so && SORT_KEYS.indexOf(so) >= 0) sortKey = so;
      if (qs.get('dir') === 'desc') sortDir = -1;
      q = (qs.get('q') || '').trim();
      focus = String(qs.get('player') || '').toLowerCase();
      if (!focus && /^#p-[a-z0-9-]+$/.test(location.hash || '')) focus = location.hash.slice(3);
    })();

    // The reader's own params, laid over whatever else is on the URL. Built by
    // EDITING the current query rather than by replacing it, so a campaign tag
    // or a referrer param survives a click on a column heading.
    //
    // A value at its default is deleted rather than written: a bare page should
    // have a bare URL, or every share carries ?sort=rank&dir=asc and the reader
    // has to read three defaults to find the one thing that is not.
    function viewQuery(slug) {
      var qs;
      try { qs = new URLSearchParams(location.search); } catch (e) { qs = new URLSearchParams(); }
      var put = function (k, v) { if (v) qs.set(k, v); else qs.delete(k); };
      put('scoring', preset !== 'ppr' ? preset : '');
      put('sort', sortKey !== 'rank' ? sortKey : '');
      put('dir', sortDir < 0 ? 'desc' : '');
      put('q', q);
      put('player', slug || '');
      return qs.toString();
    }
    // replaceState, never pushState: sorting a column is not a page the back
    // button should have to walk back out through.
    var syncTimer = null;
    function syncUrl() {
      // Coalesced, because render() runs on every keystroke in the filter box
      // and browsers rate-limit replaceState. The last state within the window
      // is the one that lands, which is the one on screen.
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(syncUrlNow, 250);
    }
    function syncUrlNow() {
      if (!window.history || !history.replaceState) return;
      var s = viewQuery(focus);
      try {
        history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + (focus ? '#p-' + focus : ''));
      } catch (e) {}
    }
    function shareUrl(slug) {
      var s = viewQuery(slug);
      return location.origin + location.pathname + (s ? '?' + s : '') + '#p-' + slug;
    }

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

    // The buttons go ABOVE the pre-rendered board and everything else below
    // it, so for the moment both are on screen the page reads in its normal
    // order: controls, board, notes. When render() drops the pre-render the
    // arrangement is the one this file has always produced.
    if (pre) host.insertBefore(tools, pre); else host.appendChild(tools);
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

    // THE TWO LINES, from the shared grammar in it-reads.js. All this board has
    // to decide is what to feed it, and here that is settled: the ranking is
    // PUBLISHED on the consensus board, so the rank and the points are the
    // consensus ones, at his own position — never `primaryRank`, which is a
    // pooled RB/WR/TE slot on the FLEX pages. There the number is spelled out
    // instead, so it cannot be read as the "#" beside it.
    function reads(p) {
      if (!window.ITReads) return '';
      return ITReads.cell(p, { horizon: horizon, spellOut: pos === 'FLEX',
        rank: p.consensus ? p.consensus.rank : null,
        points: p.consensus ? p.consensus.points : null });
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
      // The row's own address. The id is what #p-<slug> lands on with no
      // script running at all; the button copies the whole view, this row
      // included, which is the thing a reader actually wants to paste.
      var sl = slug(p.name);
      return '<tr id="p-' + esc(sl) + '"' + (focus && focus === sl ? ' class="rk-hit"' : '') + '>' + opener +
        '<td class="num">' + (primaryRank(p) == null ? '—' : esc(p.position) + primaryRank(p)) + '</td>' +
        '<td class="rk-who"><a href="/in-season/player/' + sl + '?pos=' + esc(p.position) + '"><b>' + esc(p.name) + '</b></a>' +
          (pos === 'ALL' || pos === 'FLEX' ? '<small>' + esc(p.position) + '</small>' : '') +
          '<button class="rk-share" type="button" data-share="' + esc(sl) +
            '" aria-label="Copy a link to ' + esc(p.name) + ' on this board">Link</button>' +
          reads(p) +
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
      // A linked row arrives closed, and a season board's whole answer for one
      // player is inside the drawer. Opening it is done once, on the first
      // paint, so a reader who then closes it does not have it reopened under
      // them on the next sort.
      if (focus && !painted && wantWeeks) {
        rows.forEach(function (p) { if (slug(p.name) === focus) open[p.key] = true; });
      }
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

      // The live board has painted, so the copy served with the page steps
      // aside. Removed rather than hidden: two tables of the same rows in the
      // DOM is two tables a screen reader walks and a crawler weighs.
      if (pre) { pre.remove(); pre = null; }

      // Take the reader to the row their link named, once.
      if (focus && !painted) {
        var hit = null;
        // ?player= is whatever was typed into the address bar, and a selector
        // built from it can be invalid. A row that cannot be found is not an
        // error worth breaking the board over.
        try { hit = tbody.querySelector('#p-' + (window.CSS && CSS.escape ? CSS.escape(focus) : focus)); } catch (e) {}
        if (hit && hit.scrollIntoView) {
          try { hit.scrollIntoView({ block: 'center' }); } catch (e) { hit.scrollIntoView(); }
        }
      }
      painted = true;
      syncUrl();

      var src = payload.sources || {};
      foot.innerHTML = 'The <b>Betting Odds</b> column reads its basis off the market: <b>props</b> is a priced player prop, ' +
        '<b>gamelines</b> is the posted game line&rsquo;s scoring environment applied to his line, and <b>ratings</b> is a fixture no ' +
        'book has posted yet, projected from fitted team ratings and graded low. ' +
        (src.props ? esc(src.props) + ' players carry a prop this week. ' : 'No priced player prop has reached this board for the week. Books post them; this feed is not carrying them. ') +
        (src.usage ? 'Usage through week ' + esc(src.usage) + '.' : 'No weekly usage has been published yet.');
    }

    function load() {
      // With a board already on screen there is nothing to wait for, and
      // replacing 60 real rows with the word "Reading" would be a downgrade the
      // reader watches happen.
      empty.hidden = !!pre;
      empty.textContent = 'Reading the board…';
      table.hidden = true;
      var url = '/api/boards?horizon=' + encodeURIComponent(horizon) +
        '&pos=' + encodeURIComponent(pos) + '&scoring=' + encodeURIComponent(preset);
      fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.players) { stall(); return; }
        cache[preset] = j;
        render();
      }).catch(function () { stall(); });
    }

    // The board did not answer. Which sentence is honest depends on whether
    // anything is on screen.
    //
    // With nothing up, the rule the rest of this file holds to applies: show no
    // table rather than one that may be stale.
    //
    // With the pre-render up, that rule does not apply and repeating it would
    // be false. Those rows were built at the edge for THIS request and arrived
    // with the HTML — they are as old as the page, not as old as a cache. What
    // is actually lost is the rest of the board and the buttons, so that is
    // what it says.
    function stall() {
      if (pre) {
        empty.hidden = false;
        empty.textContent = 'Showing the top of the board, which was served with this page. '
          + 'The full board and the scoring buttons need a connection to the site.';
        return;
      }
      empty.hidden = false;
      empty.textContent = 'The board did not answer. Nothing is shown rather than a ranking that may be stale.';
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
      var sh = ev.target.closest('button[data-share]');
      if (sh) {
        var sl = sh.getAttribute('data-share');
        // The address bar is updated FIRST and unconditionally. A browser that
        // refuses the clipboard — no permission, no secure context, an old
        // engine — still leaves the reader with the right URL in front of them
        // to copy by hand, which is the whole job; the button is the shortcut.
        focus = sl;
        syncUrl();
        var done = function () {
          sh.setAttribute('data-copied', '1');
          sh.textContent = 'Copied';
          setTimeout(function () { sh.removeAttribute('data-copied'); sh.textContent = 'Link'; }, 1600);
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl(sl)).then(done, function () {});
          }
        } catch (e) {}
        // Move the highlight onto the row whose link was just taken.
        [].forEach.call(tbody.querySelectorAll('tr.rk-hit'), function (tr) { tr.classList.remove('rk-hit'); });
        var tr = sh.closest('tr');
        if (tr) tr.classList.add('rk-hit');
        return;
      }
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
