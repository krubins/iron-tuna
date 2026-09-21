/* Iron Tuna — the Value Coach on the season-long side.
 *
 * The Value Coach has existed twice on this site and both times it was aimed
 * at a one-night decision: in the auction room it answers "how high do I go on
 * him", on /dfs it answers "why this slot and not the cheaper one". The season
 * is the other half of the product and had no coach at all, so the questions
 * that actually run from September to December — start him or sit him, is this
 * trade good for me, what is a waiver claim worth, who is the rest-of-season
 * buy — had nowhere to be asked.
 *
 * This is that coach. It renders a chat, collects the page's live state through
 * a context function the page supplies, and sends it to /api/coach, the same
 * server-side proxy the other two use, so the API key stays on the server.
 *
 * IT CALCULATES NOTHING. Every number it can speak comes off /api/boards —
 * built by the worker, scored at the reader's own settings, handed to it as
 * data. The model's job is to explain those numbers and never to produce new
 * ones. That boundary is Iron Tuna's, it is asserted for the numeric engines in
 * tools/test-ai-boundary.mjs, and it is written into the system prompt below.
 *
 * WHY THIS IS NOT dfs-coach.js. The chat plumbing here — the streaming reader,
 * the turn buffer, the markdown scrub, the payload budget — is the same shape
 * as that file's, deliberately, so a fix to one reads as the fix the other
 * needs. What differs is everything that matters: the boundary, the grounding
 * data, what counts as grounded, and what gets trimmed when the payload is too
 * big. Merging them would mean one module carrying two boundaries, and the
 * boundary is the part that must not blur. When a third coach appears, extract
 * the plumbing then, with three examples of what is genuinely shared.
 *
 * NOTHING HERE SETS A LINEUP. It answers questions about a board.
 */
(function (root) {
  'use strict';

  var ENDPOINT = '/api/coach';
  var MAX_TURNS = 12;      // what the panel keeps
  var SEND_TURNS = 6;      // what rides along with the next question
  var FIRST_BYTE_MS = 45000;
  var IDLE_MS = 20000;

  // The boundary, the format and the compliance line. The live state is
  // appended as JSON by ask(); everything before it is fixed.
  var SYSTEM = [
    'You are the Iron Tuna Value Coach, answering questions about ONE thing: this reader’s season-long fantasy football team, priced against the Iron Tuna boards in the JSON at the end of this prompt.',
    '',
    'WHERE YOUR NUMBERS COME FROM. The JSON is the board itself: every player Iron Tuna projects, at two horizons - the rest of the season and this week - already scored at the reader’s own settings. Every projection, rank, market number, market delta, game count, bye count, schedule grade and injury designation you quote must be taken from that JSON exactly as it is written there. Do NOT calculate, re-rank, re-project, interpolate, average, normalize or replace any of those numbers, and do not invent one that is not there. In particular: do not add two projections together to value a trade, and do not compute a per-game rate the board does not carry. If a number the reader asks for is not in the data, say plainly that the board does not carry it. You may use your own football knowledge freely for everything that is NOT one of these numbers: roles, usage, schemes, injuries, matchups, why a club is built the way it is.',
    '',
    'THE WHOLE BOARD IS IN THE DATA, so a question about a player the reader did not see on a page is still a question you can answer. rosBoard is the rest-of-season board and weekBoard is this week’s, each grouped by position, one compact line per player: the fields are separated by a pipe in the order rosBoardColumns and weekBoardColumns name them, and a line stops early when the columns after it are empty. Answer the best rest-of-season receiver, the cheapest startable tight end or who is worth a claim FROM THOSE LINES, and never tell a reader a player is missing when he is sitting on one. A name in neither board is not projected by Iron Tuna at all: he is not on an NFL roster the projections carry, or his own week is already being played. If trimmedFromThisPrompt says a board was cut, say the deep end of it was trimmed rather than calling a missing player unprojected.',
    '',
    'WHAT THE FIELDS MEAN. ironTuna is Iron Tuna’s own projection and is the number the site ranks on: the market read and the consensus projections blended, at the reader’s scoring. consensus is the projection feeds alone. market is the sportsbook-implied projection alone. marketDelta is market minus consensus, in points, and is the disagreement the whole site is built on - positive means the books price him ABOVE the projection industry, negative means below. posRank is his rank at his own position on that board, not overall. games is how many he has left to play and byes how many byes are inside that, so a rest-of-season total is a sum over a different number of games for different players and you must say so when you compare two. schedule is the grade of the defenses ahead of him - Hard, Average or Easy - computed from points allowed. injury is the designation this week carries on him, and a player with none is one nothing flagged. roleTrend is which way his usage has moved. A number that is absent is absent: say so rather than reaching for the other horizon’s number in its place.',
    '',
    'THE TWO HORIZONS ARE DIFFERENT QUESTIONS and must not be mixed. A start-or-sit question is answered off weekBoard, because it is about one week. A trade, a stash, a rest-of-season ranking or a keeper question is answered off rosBoard. Say which board you are standing on whenever both could plausibly apply, and never quote a rest-of-season total as though it were a weekly expectation.',
    '',
    'THE SCORING IS THE READER’S, NOT A DEFAULT. scoring says which settings the boards were built at and where those settings came from. When it says the reader has not described their league, the boards are full PPR and you must say so the first time scoring matters to an answer, because half-PPR and standard move receivers and pass-catching backs materially. league carries whatever the reader did describe - team count, scoring, FAAB budget, lineup - and a FAAB answer that ignores their budget is not an answer. Do not guess at a setting the reader has not given; ask for it.',
    '',
    'WHAT A WAIVER CLAIM IS WORTH. Price a claim against the reader’s own FAAB budget when league carries one, as a share of that budget, and say what the player has to return to justify it. Never quote a dollar figure the JSON does not carry as though Iron Tuna computed it; reason from the budget and the board and say that is what you are doing.',
    '',
    'A TRADE HAS TWO SIDES. Answer a trade question on the rest-of-season board and on the reader’s own roster need, name what each side gives up, and say plainly when the deal is close enough that either answer is defensible. Never tell a reader a trade is a steal off a points total alone: games remaining, byes and schedule are in the data for exactly this reason.',
    '',
    'FORMAT, this matters, your reply shows in a narrow chat panel that does NOT render markdown:',
    '- Plain conversational sentences only. NO markdown: no tables, no pipes, no asterisks or bold, no headers, no numbered or bulleted lists.',
    '- Keep it to 2-4 short sentences, about 80 words. Lead with the answer in the first sentence.',
    '- Name at most two or three players, each with one number inline, like: Nacua (14.8 rest-of-season, WR4).',
    '- No preamble. Skip "Great question". Only go longer when the reader explicitly asks for depth.',
    '',
    'WHAT YOU ARE NOT. You are the board explaining itself, never another product. You do not set a lineup, submit a claim, accept a trade, place a bet or handle money. Recommending which player to start is advice about a projection and is your job; telling anyone what to wager is not, so name no stake even when the reader asks for one. Projections are estimates and a board is a table to read.',
    '',
    'LIVE SEASON STATE (JSON):'
  ].join('\n');

  // The proxy TRUNCATES a system prompt over 40,000 characters rather than
  // refusing it, which would hand the model a JSON object cut off mid-object
  // and no way to know it. Two full boards are far larger than that, so the
  // payload is fitted to a budget here and says in the data what it dropped.
  //
  // DERIVED FROM THE PROMPT, not written down beside it, for the reason
  // dfs-coach.js learned the hard way: two hand-kept numbers that have to sum
  // to less than a third cannot both be edited safely, and the failure is
  // silent — the prompt is sliced, not refused.
  var PROXY_SYSTEM_CAP = 40000;   // /api/coach slices `system` at this
  var PROMPT_JOIN = 1;            // ask() puts a newline between the two
  var PROMPT_HEADROOM = 500;      // slack, so a small prompt edit costs nothing
  var JSON_BUDGET = PROXY_SYSTEM_CAP - SYSTEM.length - PROMPT_JOIN - PROMPT_HEADROOM;

  var STARTERS = [
    'Who is my best trade target for the rest of the season?',
    'Which of my starts this week is the shakiest?',
    'Who is worth a waiver claim, and how much of my budget?',
    'Where does the betting market disagree with the projections most?'
  ];

  // Cuts a board down rather than dropping it, and only from the tail of each
  // position, which the board sorted worst-last. A reader asking about a
  // depth player is asking about a line near that tail, so a board that is
  // gone entirely puts the coach straight back to refusing the question it
  // was added to answer.
  function capBoard(o, which, n) {
    if (!o[which]) return null;
    var cut = false;
    Object.keys(o[which]).forEach(function (pos) {
      var list = o[which][pos];
      if (list && list.length > n) { o[which][pos] = list.slice(0, n); cut = true; }
    });
    return cut ? 'the deep end of the ' + (which === 'rosBoard' ? 'rest-of-season' : 'weekly') +
      ' board, which now keeps the top ' + n + ' at each position' : null;
  }
  // Shrinks in the order the reader's question is least likely to need. The
  // weekly board goes first and further: it answers one question (start or
  // sit) and it answers it about players the reader already owns, which is a
  // short list, while the rest-of-season board is the one that has to answer
  // about a man nobody has mentioned yet. Neither is ever dropped outright —
  // without them there is nothing to ground an answer on.
  function fit(ctx) {
    var out = ctx, dropped = [];
    var size = function (o) { return JSON.stringify(o).length; };
    var trims = [
      function (o) { return capBoard(o, 'weekBoard', 40); },
      function (o) { return capBoard(o, 'rosBoard', 60); },
      function (o) { return capBoard(o, 'weekBoard', 24); },
      function (o) { return capBoard(o, 'rosBoard', 40); },
      function (o) { return capBoard(o, 'weekBoard', 14); },
      function (o) { return capBoard(o, 'rosBoard', 24); },
      function (o) { return capBoard(o, 'rosBoard', 14); }
    ];
    for (var i = 0; i < trims.length && size(out) > JSON_BUDGET; i++) {
      var copy = JSON.parse(JSON.stringify(out));
      var what = trims[i](copy);
      if (!what) continue;
      out = copy;
      dropped.push(what);
    }
    if (dropped.length) out.trimmedFromThisPrompt = dropped;
    return out;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // The model is told not to write markdown and mostly obeys. The odd stray
  // asterisk or bullet is cleaned here rather than shown, because a chat
  // bubble that renders "**Nacua**" literally reads like a bug.
  function tidy(t) {
    return String(t || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .trim();
  }

  // ── the board, compacted ───────────────────────────────────────────────────
  // One line per player instead of one object, for the reason the DFS coach
  // carries slateBoard the same way: a board of objects is mostly field names,
  // and field names repeated four hundred times are the budget. The column
  // list travels with the lines so the prompt can name what a field is.
  var ROS_COLUMNS = ['name', 'team', 'posRank', 'ironTuna', 'consensus', 'market',
                     'marketDelta', 'games', 'byes', 'schedule', 'injury', 'roleTrend'];
  var WEEK_COLUMNS = ['name', 'team', 'posRank', 'ironTuna', 'consensus', 'market',
                      'marketDelta', 'opponent', 'injury'];

  function n1(v) { return (v == null || !isFinite(v)) ? '' : String(Math.round(Number(v) * 10) / 10); }
  // Trailing empties are dropped, so a player nothing is flagged on costs no
  // bytes for the columns that would have said so.
  function line(cells) {
    var out = cells.slice();
    while (out.length && (out[out.length - 1] === '' || out[out.length - 1] == null)) out.pop();
    return out.join('|');
  }
  function rosLine(p) {
    var sd = p.scheduleDifficulty || null;
    return line([
      p.name, p.team || '', p.ironTuna && p.ironTuna.rank != null ? String(p.ironTuna.rank) : '',
      n1(p.ironTuna && p.ironTuna.points), n1(p.consensus && p.consensus.points), n1(p.vegas && p.vegas.points),
      n1(p.marketDelta && p.marketDelta.points),
      p.games == null ? '' : String(p.games), p.byes == null ? '' : String(p.byes),
      sd ? sd.label : '', p.injury && p.injury.status ? p.injury.status : '',
      // "no data" is what roleTrendFrom returns for a player the usage cache
      // cannot support, and it is not a trend. Sent as a blank, which the
      // prompt already defines as absent, rather than as a word the model can
      // quote back at a reader as though it meant something.
      p.roleTrend && p.roleTrend.label && p.roleTrend.label !== 'no data' ? p.roleTrend.label : ''
    ]);
  }
  function weekLine(p) {
    var wk = (p.weeks || [])[0] || null;
    return line([
      p.name, p.team || '', p.ironTuna && p.ironTuna.rank != null ? String(p.ironTuna.rank) : '',
      n1(p.ironTuna && p.ironTuna.points), n1(p.consensus && p.consensus.points), n1(p.vegas && p.vegas.points),
      n1(p.marketDelta && p.marketDelta.points),
      wk && wk.opponent ? wk.opponent : '', p.injury && p.injury.status ? p.injury.status : ''
    ]);
  }
  // Grouped by position, best first, because every trim below cuts from the
  // tail and a tail that is not the worst players is a trim that removes the
  // wrong men.
  function group(players, toLine) {
    var out = {};
    (players || []).slice()
      .sort(function (a, b) {
        var ap = a.ironTuna && a.ironTuna.points, bp = b.ironTuna && b.ironTuna.points;
        return (isFinite(bp) ? bp : -1) - (isFinite(ap) ? ap : -1);
      })
      .forEach(function (p) {
        var pos = p.position || 'NA';
        (out[pos] = out[pos] || []).push(toLine(p));
      });
    return out;
  }

  function mount(opts) {
    var o = opts || {};
    var host = o.host;
    var getContext = typeof o.context === 'function' ? o.context : function () { return null; };
    if (!host) return null;

    var msgs = [];
    var busy = false;
    var ready = false;

    host.className = 'vc-coach';
    host.innerHTML =
      '<div class="vc-coach-head">'
        + '<span class="vc-coach-title">Value Coach<span class="vc-coach-live" data-coach-live>starting</span></span>'
      + '</div>'
      + '<div class="vc-coach-main" data-coach-main>'
        + '<p class="vc-coach-lede" data-coach-lede></p>'
        + '<div class="vc-coach-chips" data-coach-chips></div>'
        + '<div class="vc-coach-body" data-coach-body role="log" aria-live="polite"></div>'
        + '<div class="vc-coach-input">'
          + '<textarea rows="1" data-coach-text aria-label="Ask the Value Coach about your season" placeholder="Ask about a start, a trade, a claim or a rest-of-season rank. Enter to send."></textarea>'
          + '<button class="btn" type="button" data-coach-send>Ask</button>'
        + '</div>'
        + '<p class="is-note vc-coach-foot">The coach reads the rest-of-season and weekly boards at your settings and quotes those numbers rather than computing new ones. It does not set a lineup, submit a claim or place a bet. Projections are estimates.</p>'
      + '</div>';

    var elMain = host.querySelector('[data-coach-main]');
    var elLive = host.querySelector('[data-coach-live]');
    var elLede = host.querySelector('[data-coach-lede]');
    var elChips = host.querySelector('[data-coach-chips]');
    var elBody = host.querySelector('[data-coach-body]');
    var elText = host.querySelector('[data-coach-text]');
    var elSend = host.querySelector('[data-coach-send]');

    // A streaming reply changes its last bubble on every token. Rebuilding the
    // list each time would re-announce the whole conversation to a screen
    // reader once per token, so a token only touches the bubble it belongs to
    // and the log is marked busy until the answer is finished.
    function render(streaming) {
      if (streaming && elBody.lastChild && msgs.length) {
        elBody.lastChild.innerHTML = esc(msgs[msgs.length - 1].text).replace(/\n/g, '<br>');
      } else {
        elBody.innerHTML = msgs.map(function (m) {
          return '<div class="vc-coach-msg ' + (m.role === 'user' ? 'user' : 'bot') + (m.error ? ' bad' : '') + '">'
            + esc(m.text).replace(/\n/g, '<br>') + '</div>';
        }).join('');
      }
      // An empty panel is an invitation, with the lede and the four openers
      // spread out; one with a conversation in it gives that room to the
      // conversation. The class says which shape it is in.
      host.classList.toggle('vc-coach-talking', msgs.length > 0);
      elBody.scrollTop = elBody.scrollHeight;
      if (!streaming && elMain) elMain.scrollTop = elMain.scrollHeight;
    }
    function push(role, text) {
      msgs.push({ role: role, text: text });
      if (msgs.length > MAX_TURNS) msgs = msgs.slice(-MAX_TURNS);
      render();
      return msgs[msgs.length - 1];
    }
    function renderChips() {
      elChips.innerHTML = STARTERS.map(function (q) {
        return '<button type="button" class="vc-coach-chip" data-coach-ask="' + esc(q) + '"' + (ready ? '' : ' disabled') + '>' + esc(q) + '</button>';
      }).join('');
    }

    // GROUNDED MEANS THE REST-OF-SEASON BOARD ANSWERED. Everything else here
    // is optional: a reader with no saved league still gets a coach (on full
    // PPR, and the prompt makes it say so), and a week whose board is empty
    // still leaves every trade, stash and rest-of-season question askable.
    // Without the season board there is nothing to ground an answer on, and a
    // coach that answers from football knowledge alone is the one thing this
    // page must never be.
    function grounded(ctx) {
      if (!ctx || !ctx.rosBoard) return false;
      return Object.keys(ctx.rosBoard).some(function (k) { return (ctx.rosBoard[k] || []).length > 0; });
    }
    function refresh() {
      var ctx = null;
      try { ctx = getContext(); } catch (err) { ctx = null; }
      ready = grounded(ctx);
      elLede.textContent = ready
        ? 'Ask about your season. The coach is loaded with every player Iron Tuna projects, at your scoring, for the rest of the season and for this week.'
        : (ctx && ctx.blocked) || 'The boards have not answered yet. They are cached and refreshed on a schedule, so a reload in a few minutes usually finds them.';
      if (elLive) elLive.textContent = ready
        ? (ctx.scoring && ctx.scoring.label ? 'live at ' + ctx.scoring.label : 'live on your board')
        : 'waiting for the board';
      elText.disabled = !ready || busy;
      elSend.disabled = !ready || busy;
      renderChips();
      return ready;
    }

    function fail(slot, message) {
      slot.text = message;
      slot.error = true;
      render();
    }

    function ask(question) {
      var q = String(question || '').trim();
      if (!q || busy) return;
      var ctx = null;
      try { ctx = getContext(); } catch (err) { ctx = null; }
      if (!grounded(ctx)) { refresh(); return; }

      push('user', q);
      elText.value = '';
      var slot = push('bot', '…');
      busy = true;
      elSend.disabled = true;
      elText.disabled = true;
      elBody.setAttribute('aria-busy', 'true');

      var hist = msgs.filter(function (m) { return m.text && m.text !== '…' && !m.error; })
        .slice(-(SEND_TURNS + 1), -1)
        .map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text }; });
      while (hist.length && hist[0].role !== 'user') hist.shift();
      hist.push({ role: 'user', content: q });

      var ctrl = new AbortController();
      var timer = setTimeout(function () { try { ctrl.abort(); } catch (err) {} }, FIRST_BYTE_MS);
      var bump = function () {
        clearTimeout(timer);
        timer = setTimeout(function () { try { ctrl.abort(); } catch (err) {} }, IDLE_MS);
      };
      var done = function () {
        clearTimeout(timer);
        elBody.setAttribute('aria-busy', 'false');
        busy = false;
        elSend.disabled = !ready;
        elText.disabled = !ready;
        try { elText.focus(); } catch (err) {}
      };

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: SYSTEM + '\n' + JSON.stringify(fit(ctx)), messages: hist, stream: true }),
        signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok || !r.body) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            throw new Error((j && j.error) || 'The coach did not answer (' + r.status + ').');
          });
        }
        var reader = r.body.getReader();
        var dec = new TextDecoder();
        var buf = '', full = '';
        var pump = function () {
          return reader.read().then(function (res) {
            if (res.done) return full;
            bump();
            buf += dec.decode(res.value, { stream: true });
            var idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              var ln = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 2);
              if (ln.indexOf('data:') !== 0) continue;
              var data = ln.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                var delta = JSON.parse(data);
                if (typeof delta === 'string' && delta) {
                  full += delta;
                  slot.text = tidy(full);
                  render(true);
                }
              } catch (err) {}
            }
            return pump();
          });
        };
        return pump();
      }).then(function (full) {
        if (!String(full || '').trim()) fail(slot, 'The coach came back empty. Ask again in a moment.');
        else { slot.text = tidy(full); render(); }
        done();
      }).catch(function (err) {
        var msg = String(err && err.message || err);
        fail(slot, /abort/i.test(msg)
          ? 'That one timed out before the coach finished. Ask again, or ask something narrower.'
          : msg || 'The coach did not answer. Try again in a moment.');
        done();
      });
    }

    elSend.addEventListener('click', function () { ask(elText.value); });
    elText.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ask(elText.value); }
    });
    elChips.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-coach-ask]');
      if (b && !b.disabled) ask(b.getAttribute('data-coach-ask'));
    });

    refresh();
    return { refresh: refresh, ask: ask };
  }

  var api = { mount: mount, SYSTEM: SYSTEM, STARTERS: STARTERS, tidy: tidy, fit: fit,
              group: group, rosLine: rosLine, weekLine: weekLine,
              ROS_COLUMNS: ROS_COLUMNS, WEEK_COLUMNS: WEEK_COLUMNS,
              JSON_BUDGET: JSON_BUDGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ITCoach = api;
})(typeof window !== 'undefined' ? window : globalThis);
