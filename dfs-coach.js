/* Iron Tuna — the Value Coach on the DFS lineup.
 *
 * The auction board has carried a Value Coach since launch: a chat that is
 * keyed into the page's OWN numbers rather than into fantasy football in
 * general, so "how high do I go on him" is answered against this manager's
 * budget and this board's values. /dfs prints a solved roster with a thesis,
 * a sentence under every player and a breakdown beside the table — and then
 * had no way to answer the next question a reader actually has, which is
 * always a follow-up to what they just read: why him and not the cheaper
 * one, what happens to this build in a bigger field, which seat is the one
 * to change.
 *
 * So this is the same coach, aimed at the lineup. It renders a chat under the
 * recommendation, collects the page's live state through a context function
 * the page supplies, and sends that state to /api/coach — the same server-side
 * proxy the auction coach uses, so the API key stays on the server.
 *
 * It answers one step earlier too. The page solves nothing until the reader has
 * answered three selects — Game Style, Games, Payout Structure — and the payout
 * structure IS the strategy decision: it picks the objective the optimizer
 * solves for. Refusing a question there ("finish the setup and come back") told
 * a reader to fill in a form at exactly the moment they had a question about
 * it. So the context carries a mode: in "setup" the panel is answering about
 * the contest being chosen, from the page's own catalog of what those selects
 * offer; in "lineup" it is answering about the solved roster.
 *
 * IT CALCULATES NOTHING, AND IT INVENTS NO CONTEST. Every number it can speak
 * is computed by the page (dfs-optimizer.js) or the server (buildDfsSlate/
 * dfsMetrics) and handed to it as data; the model's job is to explain those
 * numbers, never to produce new ones. The same holds for the setup: it
 * recommends from the options the selects actually offer and never invents a
 * contest, an entry fee, a field size or a payout table, none of which this
 * page carries. That boundary is Iron Tuna's, it is asserted in tools/test-ai-boundary.mjs
 * for the numeric engines, and it is written into the system prompt below.
 *
 * NOTHING HERE ENTERS A CONTEST. It answers questions about a table.
 */
(function (root) {
  'use strict';

  var ENDPOINT = '/api/coach';
  var MAX_TURNS = 12;      // what the panel keeps
  var SEND_TURNS = 6;      // what rides along with the next question
  var FIRST_BYTE_MS = 45000;
  var IDLE_MS = 20000;
  // The proxy TRUNCATES a system prompt over 40,000 characters rather than
  // refusing it, which would hand the model a JSON object cut off mid-object
  // and no way to know it. A main slate is comfortably inside this, but a
  // fourteen-game board with three lineups and a deep bench is not something
  // to find out about in production, so the payload is fitted to a budget
  // here and says in the data what it dropped.
  //
  // It went to 29,000 when slateBoard arrived: the whole eligible board is
  // around 19,000 characters of delimited text on a main slate, which is most
  // of the payload, and every character the budget gives back is another two
  // dozen players the coach can still see. What is left over the prompt's own
  // length is the margin against the 40,000 cap, and tools/test-dfs-coach.mjs
  // asserts the two together stay under it.
  var JSON_BUDGET = 29000;

  // The boundary, the format and the compliance line. The live state is
  // appended as JSON by ask(); everything before it is fixed.
  var SYSTEM = [
    'You are the Iron Tuna Value Coach, answering questions about ONE thing: the Iron Tuna DFS page this reader is looking at - the contest they are setting up, the slate behind it, and the lineup Iron Tuna solves once that setup is done.',
    '',
    'WHICH OF THE TWO YOU ARE ANSWERING. The JSON carries a mode. When it is "lineup" there is a solved roster in the data and the question is about that roster. When it is "setup" the reader is still at the three selects the page opens with - Game Style (the roster format), Games (which matchups make up the eligible player pool) and Payout Structure (how the contest pays) - and there is no roster yet. In setup mode your job is that choice: what each option builds, which one fits what the reader tells you they want, and what it does to the roster Iron Tuna will solve afterwards. Setup mode also covers the case where all three ARE answered and the solve still returned nothing: whyNoRosterYet says so and a build object carries the fine-tune settings it ran under - the cap, the locks, the exclusions, the forced player, the per-team limit. Name the one most likely to be the blocker and say what dropping it costs; do not treat it as a reason to change the contest. The choices object lists exactly what those selects offer, each with the note the page prints under it. Recommend from that list and nothing else: never invent a contest, a payout table, an entry fee, a field size, a prize pool or an entry limit, because the page does not carry those and DraftKings\u2019 lobby is where they live.',
    '',
    'WHERE YOUR NUMBERS COME FROM. The JSON at the end of this prompt is the page itself: the contest the reader configured or is configuring, the roster the optimizer solved, the swap at every slot, the players it left on the board, and the game environments behind all of it. Every salary, projection, floor, ceiling, ownership, leverage, value, Tuna Edge, touchdown probability and implied team total you quote must be taken from that JSON, exactly as it is written there. Do NOT calculate, re-rank, re-project, interpolate, normalize or replace any of those numbers, and do not invent one that is not there. If a number the reader asks for is not in the data, say plainly that the page does not carry it. You may use your own football knowledge freely for everything that is NOT one of this page\'s numbers: roles, usage, schemes, injuries, matchups, why a game sets up the way the market says it does.',
    '',
    'THE WHOLE BOARD IS IN THE DATA, so a question about a player the page never printed is still a question you can answer. slateBoard is every player on this slate the solve could legally have used, grouped by position, one compact line each: the fields are separated by a pipe in the order slateBoardColumns names them, and a line stops early when the columns after it are empty. It is the complete eligible pool and not a shortlist, so answer the best receiver at a price, the cheapest body who still projects, or who else plays in a given game FROM IT, and never tell a reader the page did not surface a player who is sitting on one of those lines. A line carries the columns slateBoardColumns names and nothing more: the market read, the floor, the touchdown price, the leverage and the wording of an injury note live on the detailed rows - the roster, the swaps, boardNotInLineup - so quote what you have and say plainly what a line does not carry. A name that is not in slateBoard is not on this board at all: he is outside the games the reader selected, or he is not playing. If trimmedFromThisPrompt says the board index was cut, say the deep end of it was trimmed rather than calling a missing player unavailable.',
    '',
    'WHAT THE FIELDS MEAN. proj is Iron Tuna\'s forward projection for this week. dkFppg is the operator\'s HISTORICAL fantasy-points-per-game average, not a projection, and tunaEdge is proj minus that average. floor and ceiling are the projection widened by positional variance. own is Iron Tuna\'s MODELED ownership, not a feed from the site. leverage is ceiling per point of modeled ownership. value, cashScore and tournamentScore are indexed to the slate: 100 is ordinary, above 100 is better than the slate norm. vegas is the market-implied projection and consensus is the projection feeds; marketDelta is the market\'s disagreement with them. vvs is market-implied points per $1,000 of salary, indexed the same way. typicalEntryPoints is what an ORDINARY entry on this slate projects for - legal rosters drawn off this board on the modeled ownership, under the same cap, and averaged - and vsTypicalEntry is this roster\u2019s projection minus that. It is the page\u2019s scale for a projection, printed in parentheses beside it; it is not a cash line, not a winning score, and it is only as good as the modeled ownership under it. Salary left over is not waste: the roster keeps it when spending it would buy a worse fit.',
    '',
    'WHETHER THE BOOKS PRICED HIM, which is not the same as how good he is. Every player carries a market block. read is PROPS when a sportsbook posted his own lines, LINES when nothing of his was posted and his number was sliced out of his game total, FITTED when even the game was unpriced and the number came off a team rating, and TD ONLY when the books quoted his touchdown and nothing a projection can be built from. trust is how much of the distance from the consensus projection to the market number Iron Tuna keeps: 1 for a fully quoted man, about 0.8 off a game line, about 0.55 off a fitted rating, 0 for nobody, so points is what the market read actually uses. posted names the markets a book put up, books how many, lineLastMovedHours how long since one of his books MOVED his number (NOT how long since the feed was read: the store keeps a price only when it changes, so a settled market shows a large number with the poll running normally \u2014 never call it a stale or broken feed, and slate.marketCoverage.feedReadHoursAgo is the one number that says when the feed was actually read), and tdFromTheBooks means the touchdown probability is a devigged market price rather than derived from projected carries. marketSays, on the recommended roster, is the page\u2019s own sentence about him. USE THIS AS CONFIDENCE, NOT AS QUALITY. A quoted 16.0 and a fitted 16.0 are not the same number: say which one you are standing on when it matters, and treat an expensive quoted player as priced, not as automatically correct. slate.marketCoverage says how much of the whole board was priced, which is the honest answer to whether the market read can be trusted this week.',
    '',
    'WHETHER HE IS PLAYING. A player carries status only when this week says something about him: designation is the tag (Out, Doubtful, Questionable, IR, PUP, or a roster status), note is the wording, and from is which source answered - the week\u2019s injury report, the reserve list, the roster file (a practice-squad or free-agent body the injury report would never mention), or the operator\u2019s own salary file. A player with no status is one nothing flagged. Out and Doubtful are already off the board: playing false means the reader locked him in himself, so say so rather than discussing him as a normal option. QUESTIONABLE STAYS ON THE BOARD ON PURPOSE, because that call belongs to the reader and benching every questionable body would empty a slate. Name the designation when you recommend or defend such a player; never call a flagged man healthy, and never invent a designation the data does not carry.',
    '',
    'CHOOSING A STRUCTURE. Answer a setup question the way a sharp friend would: ask what the reader actually wants out of the night when they have not said it - a steady cash rate or a shot at first, one entry or twenty - and give a recommendation rather than a menu. The page\u2019s own read is playOfTheWeek when the JSON carries it: which structure this slate rewards and the numbers behind it, computed by Iron Tuna from a floor build, a ceiling build and a leverage build off this board. Quote it as the page\u2019s call, and say so when your advice differs from it and why. Head-to-Head, 50/50 and Double Up pay a broad field and reward floor and points per dollar. A multiplier or a single-entry tournament asks for more ceiling. A multi-entry tournament is top-heavy and asks for ceiling, correlation and leverage across several lineups. The game pool is a real strategy input and not paperwork: one game is a Showdown board, a full Sunday is a Classic one, and a player outside the pool cannot be used at all. Iron Tuna solves a roster for Classic only, so say plainly that another Game Style gets the format read and no lineup. Keep the page\u2019s order - style, then games, then payout - and say which one to answer next.',
    '',
    'THE BUILD IS NOT NEUTRAL. The reader chose a contest, and the objective follows it: cash shapes are solved on floor and salary efficiency and do not avoid a popular player for being popular; single-entry keeps projection and adds correlation selectively; large-field shapes are solved on ceiling discounted by modeled ownership. Answer inside the shape the reader is actually in, and when a question only makes sense in a different shape, say which one and why.',
    '',
    'FORMAT, this matters, your reply shows in a narrow chat panel that does NOT render markdown:',
    '- Plain conversational sentences only. NO markdown: no tables, no pipes, no asterisks or bold, no headers, no numbered or bulleted lists.',
    '- Keep it to 2-4 short sentences, about 80 words. Lead with the answer in the first sentence.',
    '- Name at most two or three players, each with one number inline, like: Nacua (18.4 proj, $7,800).',
    '- No preamble. Skip "Great question". Only go longer when the reader explicitly asks for depth.',
    '',
    'WHAT YOU ARE NOT. You are the page explaining itself, never another product. You do not enter contests, submit lineups, place bets or handle money, and you must not tell anyone what to wager. Recommending which contest STRUCTURE suits a build is strategy and is your job; how much money to put on it is not, so name no entry fee and no stake even when the reader asks for one. Projections are estimates and a lineup is a table to read. If someone asks you to enter or bet something, say the page only builds a roster to copy.',
    '',
    'LIVE DFS STATE (JSON):'
  ].join('\n');

  var STARTERS = [
    'Why is this the build for my contest?',
    'Which slot is the weakest link?',
    'Who is the riskiest player here?',
    'What changes if I play a bigger field?'
  ];
  // A reader at the three selects has not got a roster to ask about yet, so
  // the openers are the decision actually in front of them.
  var SETUP_STARTERS = [
    'Which payout structure fits this slate?',
    'How do I choose which games to include?',
    'What is the difference between a 50/50 and a Double Up?',
    'I have one entry and want the best shot at a profit. What should I play?'
  ];
  // Setup mode has a second shape: the three selects are answered and the
  // solve still came back with nothing. The question there is not which
  // contest to enter, it is which constraint to drop.
  var STUCK_STARTERS = [
    'Why does no lineup fit my settings?',
    'Which lock or exclusion should I drop first?',
    'Is the cap or the player pool the problem?',
    'Which payout structure fits this slate?'
  ];
  function startersFor(ctx) {
    if (!ctx || ctx.mode !== 'setup') return STARTERS;
    return ctx.build ? STUCK_STARTERS : SETUP_STARTERS;
  }

  // Cuts the board index down rather than dropping it, and only ever from the
  // tail of each position, which the page sorted worst-last for this contest.
  // A reader asking about a price point is asking about a player the page did
  // not print, so an index that is gone entirely puts the coach straight back
  // to refusing the question it was added to answer.
  function capBoard(o, n) {
    if (!o.slateBoard) return null;
    var cut = false;
    Object.keys(o.slateBoard).forEach(function (pos) {
      var list = o.slateBoard[pos];
      if (list && list.length > n) { o.slateBoard[pos] = list.slice(0, n); cut = true; }
    });
    return cut ? 'the deep end of the board index, which now keeps the top ' + n + ' at each position' : null;
  }
  // Shrinks in the order the reader's question is least likely to need: the
  // board rows behind the roster first, then the games, then the alternates,
  // then the swaps, and the board index last of all because it is the only
  // thing in here that can answer about a player the page never printed. The
  // roster itself and the contest it was solved for are never dropped —
  // without them there is nothing to answer about.
  function fit(ctx) {
    var out = ctx, dropped = [];
    var size = function (o) { return JSON.stringify(o).length; };
    var trims = [
      function (o) { if ((o.boardNotInLineup || []).length > 12) { o.boardNotInLineup = o.boardNotInLineup.slice(0, 12); return 'most of the board behind the roster'; } return null; },
      function (o) { if ((o.games || []).length > 6) { o.games = o.games.slice(0, 6); return 'the smaller game environments'; } return null; },
      function (o) { if ((o.lineups || []).length > 1) { o.lineups = o.lineups.slice(0, 1); return 'the alternate lineups'; } return null; },
      function (o) { if ((o.boardNotInLineup || []).length) { o.boardNotInLineup = []; return 'the rest of the board'; } return null; },
      function (o) { if ((o.pivots || []).length > 4) { o.pivots = o.pivots.slice(0, 4); return 'the smaller swaps'; } return null; },
      // Setup mode carries the catalog instead of a roster, and its longest
      // list is the games. The options themselves - the game styles and the
      // payout structures - are never trimmed: a recommendation has to come
      // from the whole menu the selects offer or it is not the page's menu.
      function (o) { if (o.choices && (o.choices.games || []).length > 8) { o.choices.games = o.choices.games.slice(0, 8); return 'the later kickoffs in the game list'; } return null; },
      function (o) { return capBoard(o, 120); },
      function (o) { return capBoard(o, 80); },
      function (o) { return capBoard(o, 40); },
      function (o) { return capBoard(o, 24); }
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

  function mount(opts) {
    var o = opts || {};
    var host = o.host;
    var getContext = typeof o.context === 'function' ? o.context : function () { return null; };
    // A host that is a floating dock is closed by its page, not minimized in
    // place: the header button shuts the whole thing and the launcher comes
    // back. Without an onClose the panel keeps its own minimize, so the module
    // still stands alone on a page that embeds it inline.
    var onClose = typeof o.onClose === 'function' ? o.onClose : null;
    if (!host) return null;

    var msgs = [];
    var busy = false;
    var ready = false;
    var openState = true;

    host.className = 'df-coach';
    host.innerHTML =
      '<div class="df-coach-head">'
        + '<span class="df-coach-title">Value Coach<span class="df-coach-live">live on this lineup</span></span>'
        + '<button type="button" class="df-coach-toggle" data-coach-toggle>' + (onClose ? 'Close' : 'Minimize') + '</button>'
      + '</div>'
      + '<div class="df-coach-main" data-coach-main>'
        + '<p class="df-coach-lede" data-coach-lede></p>'
        + '<div class="df-coach-chips" data-coach-chips></div>'
        + '<div class="df-coach-body" data-coach-body role="log" aria-live="polite"></div>'
        + '<div class="df-coach-input">'
          + '<textarea rows="1" data-coach-text aria-label="Ask the Value Coach about this page" placeholder="Ask about any slot, swap, salary or matchup in this build. Enter to send."></textarea>'
          + '<button class="btn" type="button" data-coach-send>Ask</button>'
        + '</div>'
        + '<p class="is-note df-coach-foot">The coach reads the setup and the roster above and the slate behind them, and it quotes those numbers rather than computing new ones. It does not enter contests or place bets. Projections are estimates.</p>'
      + '</div>';

    var elMain = host.querySelector('[data-coach-main]');
    var elLive = host.querySelector('.df-coach-live');
    var elLede = host.querySelector('[data-coach-lede]');
    var elChips = host.querySelector('[data-coach-chips]');
    var elBody = host.querySelector('[data-coach-body]');
    var elText = host.querySelector('[data-coach-text]');
    var elSend = host.querySelector('[data-coach-send]');
    var elToggle = host.querySelector('[data-coach-toggle]');

    // A streaming reply changes its last bubble on every token. Rebuilding the
    // list each time would re-announce the whole conversation to a screen
    // reader once per token, so a token only touches the bubble it belongs to
    // and the log is marked busy until the answer is finished — the reader
    // hears it once, complete, which is also the only point at which it means
    // anything.
    function render(streaming) {
      if (streaming && elBody.lastChild && msgs.length) {
        elBody.lastChild.innerHTML = esc(msgs[msgs.length - 1].text).replace(/\n/g, '<br>');
      } else {
        elBody.innerHTML = msgs.map(function (m) {
          return '<div class="df-coach-msg ' + (m.role === 'user' ? 'user' : 'bot') + (m.error ? ' bad' : '') + '">'
            + esc(m.text).replace(/\n/g, '<br>') + '</div>';
        }).join('');
      }
      // The panel has two shapes, and the class says which one it is in: an
      // empty one is an invitation, with the lede and the four openers spread
      // out; one with a conversation in it gives that room to the conversation
      // (the page's stylesheet folds the openers into a single scrolling row
      // and drops the lede), because on a short window those two took the space
      // the answer needed and the reply rendered into nothing.
      host.classList.toggle('df-coach-talking', msgs.length > 0);
      elBody.scrollTop = elBody.scrollHeight;
      // A new message can also push the input below the fold when the panel
      // itself is the thing scrolling, so the newest turn is brought into view
      // rather than left under it. Only on a finished render: doing it per
      // token would drag the panel back down under a reader scrolling up.
      if (!streaming && elMain) elMain.scrollTop = elMain.scrollHeight;
    }
    function push(role, text) {
      msgs.push({ role: role, text: text });
      if (msgs.length > MAX_TURNS) msgs = msgs.slice(-MAX_TURNS);
      render();
      return msgs[msgs.length - 1];
    }
    var starters = STARTERS;
    function renderChips() {
      elChips.innerHTML = starters.map(function (q) {
        return '<button type="button" class="df-coach-chip" data-coach-ask="' + esc(q) + '"' + (ready ? '' : ' disabled') + '>' + esc(q) + '</button>';
      }).join('');
    }

    // The panel is useful from two states, and says which one it is in. With a
    // solved roster it answers about that roster; at the three selects above it
    // answers about the contest being chosen, which is the decision that
    // produces the roster. Anything else - no slate, a pick'em board, an
    // infeasible solve - it says what it is waiting for rather than taking a
    // question it cannot ground.
    function grounded(ctx) { return !!(ctx && (ctx.mode === 'setup' || (ctx.lineups && ctx.lineups.length))); }
    function refresh() {
      var ctx = null;
      try { ctx = getContext(); } catch (err) { ctx = null; }
      ready = grounded(ctx);
      var setup = ready && ctx.mode === 'setup';
      starters = startersFor(ctx);
      var why = ctx && ctx.blocked ? ctx.blocked : 'Build a lineup above and the coach can answer questions about it.';
      elLede.textContent = !ready ? why : setup
        ? (ctx.awaiting || 'Ask about the contest setup above.')
          + (ctx.build ? ' It has the settings that solve ran under and the player pool behind them.' : ' It is loaded with every option those selects offer and the games on this week\u2019s board.')
        : 'Ask about the roster above. The coach is loaded with your contest setup, every player in the build, the swap at each slot, every priced player on the slate it chose from and the game environments behind them.';
      if (elLive) elLive.textContent = setup ? 'live on your setup' : 'live on this lineup';
      elText.placeholder = setup
        ? 'Ask which Game Style, game pool or payout structure fits the contest you want. Enter to send.'
        : 'Ask about any slot, swap, salary or matchup in this build. Enter to send.';
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
              var line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 2);
              if (line.indexOf('data:') !== 0) continue;
              var data = line.slice(5).trim();
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
    elToggle.addEventListener('click', function () {
      if (onClose) { onClose(); return; }
      openState = !openState;
      elMain.hidden = !openState;
      elToggle.textContent = openState ? 'Minimize' : 'Open the coach';
      host.classList.toggle('df-coach-min', !openState);
    });

    refresh();
    return { refresh: refresh, ask: ask };
  }

  var api = { mount: mount, SYSTEM: SYSTEM, STARTERS: STARTERS, SETUP_STARTERS: SETUP_STARTERS,
              STUCK_STARTERS: STUCK_STARTERS, startersFor: startersFor, tidy: tidy, fit: fit,
              JSON_BUDGET: JSON_BUDGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ITDfsCoach = api;
})(typeof window !== 'undefined' ? window : globalThis);
