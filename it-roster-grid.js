/* it-roster-grid.js — every roster in the league, off one screenshot.
 *
 * A league that prints all twelve rosters on one page is ONE screenshot, not
 * twelve, and the screenshot is on the clipboard rather than on disk: Win+Shift+S
 * and Cmd+Ctrl+Shift+4 both end with an image nobody ever saved to a file. So
 * this takes a paste, a drag or the picker, shrinks what it gets, and sends it
 * to /api/roster-read, which answers with names only — no starter, bench or IR,
 * because a grid does not print them. The reader then says which team is theirs.
 *
 * TYPED OR PASTED TEXT goes to the same reader. Half the leagues that print a
 * roster grid print it as selectable text, and a reader who has it on the
 * clipboard as words should not have to screenshot their own screen to be
 * understood. /api/roster-read has always taken a `text` field; this is the box
 * that fills it. Both boxes beside this one on /my-league take typing or a
 * screenshot, and a third that took only one of the two read as the odd one out.
 *
 * It lives in its own file because the page mounts it TWICE: once in the manual
 * league form under §01, and once in §02, where a reader who never opens §01
 * pastes their rosters into the section that promises them. Two copies of a
 * reader like this drift apart within a release.
 *
 *   ITRosterGrid.mount(host, opts) -> state
 *
 * IT ASKS ABOUT THE NAMES IT COULD NOT PLACE. A grid read off a screenshot gets
 * some names wrong, and the ones it gets wrong are the ones nobody can fix
 * afterwards: "A Bornegales" is Andy Borregales with one letter misread, and
 * "J Williams" is two players the grid does not tell apart. Every read is sent
 * to /api/roster-check, which resolves each name exactly as the save will and
 * answers with the board's nearest candidates for the ones it cannot. The
 * reader picks, the pick is re-checked, and what would have been a list of
 * names scored zero all season is a question answered in ten seconds.
 *
 *   state.teams    [{ name, players: [{ name, position, team }] }]
 *   state.mine     index of the reader's own team, -1 until they say
 *   state.partial  the reader ran out of room; the last team may be short
 *   state.unplaced how many names still have no answer, after the asks
 *   state.clear()  back to empty, and the box redrawn
 *
 *   opts.teams     a room already known, to open with
 *   opts.mine      which of those is the reader's
 *   opts.label     the box's heading; '' when the host already titles it
 *   opts.text      false to drop the textarea, where the host already prints
 *                  one of its own under this box (the by-hand form in §01)
 *   opts.note      the line under the label, in the host's own words
 *   opts.onRead    (state) after a read lands
 *   opts.onPick    (state) when the reader names their team
 *   opts.onCheck   (state) after every check, so a host's Save can see
 *                  state.unplaced before it writes a roster with holes in it
 */
(function (root) {
  'use strict';

  var doc = root.document;
  var seq = 0;
  var mounted = [];      // every live instance, for the one document listener
  var lastFocused = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }

  // Each image is shrunk here first: a phone screenshot is several megabytes and
  // the reader needs none of that to read a name.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var MAX = 1600, sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          var c = doc.createElement('canvas');
          c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
          var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          resolve({ media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).replace(/^data:[^,]*,/, '') });
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  // Every image on a clipboard or a drag, not just the first: a roster grid that
  // took three shots to capture is three images pasted together, and a reader who
  // has to send them one at a time gets three reads that each REPLACE the last
  // rather than one read of the whole room. files is what modern browsers fill;
  // items is the older path Safari still needs.
  function imagesIn(dt) {
    var out = [], i, f;
    if (!dt) return out;
    if (dt.files && dt.files.length) {
      for (i = 0; i < dt.files.length; i++) if (/^image\//.test(dt.files[i].type)) out.push(dt.files[i]);
    }
    if (!out.length && dt.items) {
      for (i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file' && /^image\//.test(dt.items[i].type)) { f = dt.items[i].getAsFile(); if (f) out.push(f); }
      }
    }
    return out;
  }

  // ONE document-level paste listener for the whole page, however many grids are
  // mounted on it. A reader who has just taken the screenshot has not necessarily
  // clicked a box first, and Ctrl+V landing nowhere reads as a feature that is
  // broken — but two grids both reading the same clipboard is worse than none.
  // So the paste goes to the box it landed in, else the box last touched, else
  // the only one on screen; with two in view and neither touched, it waits.
  function pasteTarget(e) {
    var live = mounted.filter(function (g) { return doc.body.contains(g.host); });
    var i, t = e.target;
    for (i = 0; i < live.length; i++) if (live[i].host.contains(t)) return live[i];
    if (lastFocused && live.indexOf(lastFocused) >= 0 && visible(lastFocused.host)) return lastFocused;
    var seen = live.filter(function (g) { return visible(g.host); });
    return seen.length === 1 ? seen[0] : null;
  }
  function onDocPaste(e) {
    if (e.defaultPrevented) return;                    // a box already read it
    var t = e.target, tag = t && t.tagName;
    // Fields that take a paste of their own keep it: the settings boxes read
    // images themselves, and a roster textarea takes text.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    var g = pasteTarget(e);
    if (!g) return;
    var imgs = imagesIn(e.clipboardData);
    if (!imgs.length) return;
    e.preventDefault();
    g.read(imgs);
  }
  if (doc) doc.addEventListener('paste', onDocPaste);

  function mount(host, opts) {
    if (!host) return null;
    var o = opts || {};
    var id = 'rg' + (++seq);
    var state = { teams: [], mine: -1, partial: false, unplaced: 0, clear: null };
    // Names the reader has looked at and told us to keep as written. Keyed by
    // the name itself rather than by position, because a re-read renumbers
    // every row and an answer should survive one.
    var kept = {};
    var checkSeq = 0;
    var mac = /Mac|iPhone|iPad|iPod/.test((root.navigator.platform || '') + ' ' + (root.navigator.userAgent || ''));

    // The host may already be a titled card, as §02's is; a second heading over
    // the same box reads as two things stacked rather than one.
    var label = o.label === undefined ? 'Every roster from one screenshot' : o.label;
    var wantText = o.text !== false;
    host.innerHTML = '<div class="is-field rg-field">' + (label ? '<label>' + esc(label) + '</label>' : '') +
      '<p class="is-note" style="margin:0 0 6px">' + esc(o.note || 'A league roster grid holds all of the teams at once. Names only: your starting lineup is projected from the scoring, not read off the page. Send more than one image at a time if the grid does not fit in one shot.') + '</p>' +
      (wantText
        ? '<label class="is-intake-lab" for="' + id + 'txt">Type, paste or drag in</label>' +
          '<textarea class="is-input is-intake-text" id="' + id + 'txt" data-text rows="5" spellcheck="false" ' +
            'placeholder="' + esc('Team Rocket\nJosh Allen QB BUF\nBijan Robinson RB ATL\n\nThe Other Guys\nJalen Hurts QB PHI\n…') + '"></textarea>'
        : '') +
      '<div class="mg-drop" data-drop tabindex="0" role="group" aria-label="Paste, drop or choose roster screenshots">' +
        '<b>Paste a screenshot, or drop one in</b>' +
        '<span>Copy the roster grid and press <kbd>' + (mac ? '⌘' : 'Ctrl+') + 'V</kbd> — here or anywhere on this form — or drag the image onto this box, or <button type="button" class="mg-pick" data-pick>choose files</button>.</span>' +
      '</div>' +
      '<input type="file" accept="image/*" multiple hidden data-file>' +
      (wantText ? '<div class="is-btns" style="margin:8px 0 0"><button type="button" class="is-btn sec" data-read>Read this</button></div>' : '') +
      '<p class="is-note" data-msg style="margin:6px 0 0" role="status" aria-live="polite"></p><div data-out></div><div data-ask></div></div>';

    var drop = host.querySelector('[data-drop]'), fileIn = host.querySelector('[data-file]');
    var textEl = host.querySelector('[data-text]');
    var msgEl = host.querySelector('[data-msg]'), outEl = host.querySelector('[data-out]');
    var askEl = host.querySelector('[data-ask]');
    function msg(t, bad) { msgEl.textContent = t || ''; msgEl.style.color = bad ? 'var(--danger)' : ''; }

    host.querySelector('[data-pick]').addEventListener('click', function () { fileIn.click(); });
    // The picker is cleared after every read so choosing the same file twice
    // still fires change the second time.
    fileIn.addEventListener('change', function (e) { read(e.target.files); e.target.value = ''; });
    drop.addEventListener('focus', function () { lastFocused = inst; });
    host.addEventListener('mousedown', function () { lastFocused = inst; });

    drop.addEventListener('paste', function (e) {
      var imgs = imagesIn(e.clipboardData);
      if (!imgs.length) { msg('There is no image on the clipboard. Copy the roster grid as a screenshot first.', true); return; }
      e.preventDefault(); read(imgs);
    });

    if (textEl) {
      // A screenshot pasted while the cursor sits in the box is still a
      // screenshot. The document listener steps aside for a textarea — it has
      // to, or typing into one would be hijacked — so this box handles its own.
      // Plain text falls straight through and lands in the textarea as typing.
      textEl.addEventListener('paste', function (e) {
        var imgs = imagesIn(e.clipboardData);
        if (!imgs.length) return;
        e.preventDefault(); read(imgs);
      });
      host.querySelector('[data-read]').addEventListener('click', function () { readText(); });
    }

    // A drop that misses the box is the browser navigating away to the image,
    // taking the half-filled form with it — the one failure here that costs work
    // rather than a read. The whole field catches the drag.
    var zone = host.querySelector('.rg-field') || host, deep = 0;
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'dragenter') deep++; drop.classList.add('over'); });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      zone.addEventListener(ev, function () { if (ev === 'dragleave') deep = Math.max(0, deep - 1); if (!deep || ev === 'dragend') { deep = 0; drop.classList.remove('over'); } });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault(); deep = 0; drop.classList.remove('over');
      var imgs = imagesIn(e.dataTransfer);
      if (!imgs.length) { msg('That is not an image. Drop a screenshot of the roster grid.', true); return; }
      read(imgs);
    });

    // One sender for both ways in. /api/roster-read takes images, text, or both,
    // and answers in the same shape either way, so adopt() never has to know
    // which of the two the reader used.
    function send(body) {
      return root.fetch('/api/roster-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(adopt)
        .catch(function () { msg('The reader did not answer. Try again in a moment.', true); });
    }

    function read(files) {
      var list = [].slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); }).slice(0, 8);
      if (!list.length) { msg('Those are not images.', true); return; }
      msg('Reading ' + list.length + ' screenshot' + (list.length === 1 ? '' : 's') + '… a whole grid can take a minute.');
      // Whatever is typed in the box rides along as a note: a reader who pasted
      // a screenshot AND wrote "the last two teams are cut off" meant both.
      var note = textEl ? (textEl.value || '').trim().slice(0, 2000) : '';
      Promise.all(list.map(shrink))
        .then(function (images) { return send(note ? { images: images, text: note } : { images: images }); })
        .catch(function () { msg('That image could not be read in this browser.', true); });
    }

    // The typed path. Whole rosters as words — most league pages print them as
    // selectable text, and copying them is one keystroke fewer than a screenshot.
    function readText() {
      var t = textEl ? (textEl.value || '').trim() : '';
      if (!t) { msg('Type or paste the rosters in the box first, or paste a screenshot.', true); return; }
      msg('Reading what you pasted… a whole league can take a minute.');
      send({ text: t.slice(0, 20000) });
    }

    // A read REPLACES what the last one found. Appending would double a team when
    // the same screenshot is sent twice, and nothing tells that apart from a
    // league holding two teams of the same name.
    function adopt(j) {
      if (!j || !j.ok) { msg((j && j.error) || 'The reader could not read that.', true); return; }
      state.teams = (j.teams || []).map(function (t) {
        return { name: String(t.name == null ? '' : t.name).slice(0, 60),
                 players: (t.players || []).map(function (p) { return { name: p.name, position: p.pos || null, team: p.team || null }; }).filter(function (p) { return p && p.name; }) };
      }).filter(function (t) { return t.players.length; });
      state.mine = -1; state.partial = !!j.partial;
      render();
      if (!state.teams.length) { msg('No rosters in that image.', true); return; }
      var n = state.teams.reduce(function (a, t) { return a + t.players.length; }, 0);
      msg('Read ' + state.teams.length + ' team' + (state.teams.length === 1 ? '' : 's') + ', ' + n + ' players.' +
        (state.partial ? ' The reader ran out of room, so the last team may be short — split the grid and send the pieces together.' : '') +
        ' Pick your team, then save.');
      if (typeof o.onRead === 'function') o.onRead(state);
      check();
    }

    // ── the names it could not place ─────────────────────────────────────────
    // Every name, every time — after a read and after each answer. The check
    // reads a board already in the worker's memory, so it costs a round trip
    // and nothing more, and re-asking after each pick is what lets a reader
    // type a name and be told at once whether the board has it.
    function eachPlayer(fn) {
      for (var ti = 0; ti < state.teams.length; ti++) {
        var ps = state.teams[ti].players || [];
        for (var pi = 0; pi < ps.length; pi++) fn(ps[pi], ti, pi);
      }
    }
    function check() {
      var flat = [];
      eachPlayer(function (p, ti, pi) {
        if (p && p.name) flat.push({ name: p.name, pos: p.position || '', team: p.team || '', ti: ti, pi: pi });
      });
      if (!flat.length) { state.unplaced = 0; askEl.innerHTML = ''; return; }
      var seq = ++checkSeq;
      root.fetch('/api/roster-check', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ players: flat.map(function (f) { return { name: f.name, pos: f.pos, team: f.team }; }) })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (seq !== checkSeq) return;                    // a later answer already landed
        if (!j || !j.ok || !j.players) { askEl.innerHTML = ''; return; }
        var asks = [];
        for (var i = 0; i < j.players.length && i < flat.length; i++) {
          var r = j.players[i];
          if (!r || r.ok) continue;
          if (kept[flat[i].name]) continue;
          asks.push({ at: flat[i], suggestions: r.suggestions || [] });
        }
        state.unplaced = asks.length;
        renderAsks(asks);
        if (typeof o.onCheck === 'function') o.onCheck(state);
      }).catch(function () {
        // The check is an improvement on the save, not a gate in front of it:
        // a reader whose network drops here still has their rosters.
        askEl.innerHTML = '';
        state.unplaced = 0;
        if (typeof o.onCheck === 'function') o.onCheck(state);
      });
    }

    function teamLabel(ti) {
      var t = state.teams[ti];
      return (t && t.name) || ('Team ' + (ti + 1));
    }
    var everAsked = false;
    function renderAsks(asks) {
      if (!asks.length) {
        // Silence after eight questions reads as the page having lost them.
        askEl.innerHTML = everAsked
          ? '<div class="rg-ask done"><p class="rg-ask-h"><b>Every name is placed.</b> Pick your team below if you have not, then save.</p></div>'
          : '';
        return;
      }
      everAsked = true;
      askEl.innerHTML = '<div class="rg-ask">' +
        '<p class="rg-ask-h"><b>' + asks.length + (asks.length === 1 ? ' name needs' : ' names need') + ' you.</b> ' +
        'The board could not place ' + (asks.length === 1 ? 'this one' : 'these') + ' \u2014 a screenshot misreads a letter, and one initial and a surname can be two players. ' +
        'Say who ' + (asks.length === 1 ? 'it is' : 'they are') + ', or keep the name as written and it stays on the roster scored zero.</p>' +
        '<ul class="rg-asks">' + asks.map(function (a, i) {
          var sug = a.suggestions;
          return '<li>' +
            '<span class="rg-ask-n">' + esc(a.at.name) +
              '<small>' + esc(teamLabel(a.at.ti)) + (a.at.pos ? ' \u00b7 ' + esc(a.at.pos) : '') + '</small></span>' +
            '<select class="is-input rg-ask-p" data-fix="' + i + '" aria-label="Which player is ' + esc(a.at.name) + '?">' +
              '<option value="">' + (sug.length ? 'Which player is this?' : 'Nothing close on the board\u2026') + '</option>' +
              sug.map(function (sg, k) {
                return '<option value="s' + k + '">' + esc(sg.name) + ' \u2014 ' + esc(sg.pos) + (sg.team ? ', ' + esc(sg.team) : '') + '</option>';
              }).join('') +
              '<option value="type">Type a different name\u2026</option>' +
              '<option value="keep">Not on the board \u2014 keep this name</option>' +
            '</select>' +
            '<input class="is-input rg-ask-t" data-type="' + i + '" list="' + id + 'dl' + i + '" hidden ' +
              'placeholder="Start typing a player\u2019s name" autocomplete="off" spellcheck="false">' +
            '<datalist id="' + id + 'dl' + i + '"></datalist>' +
          '</li>';
        }).join('') + '</ul></div>';

      [].slice.call(askEl.querySelectorAll('[data-fix]')).forEach(function (sel) {
        sel.addEventListener('change', function () {
          var a = asks[parseInt(sel.getAttribute('data-fix'), 10)];
          var v = sel.value;
          var typeBox = askEl.querySelector('[data-type="' + sel.getAttribute('data-fix') + '"]');
          if (v === 'type') { typeBox.hidden = false; typeBox.focus(); return; }
          typeBox.hidden = true;
          if (!v) return;
          if (v === 'keep') { kept[a.at.name] = true; check(); return; }
          var sg = a.suggestions[parseInt(v.slice(1), 10)];
          if (sg) applyFix(a.at, sg.name, sg.pos, sg.team);
        });
      });
      [].slice.call(askEl.querySelectorAll('[data-type]')).forEach(function (box) {
        var a = asks[parseInt(box.getAttribute('data-type'), 10)];
        var list = askEl.querySelector('#' + box.getAttribute('list'));
        // The suggestions here are the site's own player index, already on this
        // page. A name typed from it is a name the board knows, and the check
        // that follows says so rather than this box assuming it.
        box.addEventListener('input', function () {
          if (!root.ITPlayerSearch || !list) return;
          var hits = root.ITPlayerSearch.search(box.value, 8) || [];
          list.innerHTML = hits.map(function (h) {
            return '<option value="' + esc(h.n) + '">' + esc(h.p + (h.t ? ', ' + h.t : '')) + '</option>';
          }).join('');
        });
        box.addEventListener('change', function () {
          var v = (box.value || '').trim();
          if (!v) return;
          var hit = root.ITPlayerSearch ? (root.ITPlayerSearch.search(v, 1) || [])[0] : null;
          applyFix(a.at, (hit && hit.n === v) ? hit.n : v, hit && hit.n === v ? hit.p : '', hit && hit.n === v ? hit.t : '');
        });
      });
    }
    // A pick rewrites the player in place and asks again. The second check is
    // the whole point: it is the board answering, not this file guessing, and
    // a name typed that the board does not carry comes straight back.
    function applyFix(at, name, pos, team) {
      var t = state.teams[at.ti];
      var p = t && t.players && t.players[at.pi];
      if (!p) return;
      p.name = name;
      if (pos) p.position = pos;
      if (team) p.team = team;
      check();
    }

    function render() {
      if (!state.teams.length) { outEl.innerHTML = ''; return; }
      outEl.innerHTML = '<div class="is-seg" role="group" style="flex-wrap:wrap;margin-top:6px">' + state.teams.map(function (t, i) {
        return '<label><input type="radio" name="' + id + 'mine" value="' + i + '"' + (i === state.mine ? ' checked' : '') + '>' + esc(t.name || ('Team ' + (i + 1))) + ' (' + t.players.length + ')</label>';
      }).join('') + '</div>';
      [].slice.call(outEl.querySelectorAll('input[name="' + id + 'mine"]')).forEach(function (r) {
        r.addEventListener('change', function () {
          state.mine = parseInt(r.value, 10);
          if (typeof o.onPick === 'function') o.onPick(state);
        });
      });
    }

    // A league that already holds a room opens with it: reopening a grid league
    // to change one scoring number must not save the one typed roster and
    // silently drop the other eleven.
    if (o.teams && o.teams.length) {
      state.teams = o.teams;
      state.mine = typeof o.mine === 'number' ? o.mine : -1;
      render();
      // A league saved before the check existed can carry names nothing ever
      // placed, so reopening it asks about them rather than keeping the hole.
      check();
    }

    state.clear = function () {
      state.teams = []; state.mine = -1; state.partial = false; state.unplaced = 0;
      kept = {}; checkSeq++;
      if (textEl) textEl.value = '';
      askEl.innerHTML = '';
      render(); msg('');
    };
    state.recheck = check;
    state.say = msg;

    // A host mounted twice — the manual form is torn down and rebuilt every time
    // it opens — leaves the older instance registered against the same element,
    // and the document paste would hand the clipboard to a state object nobody
    // reads any more. The newest mount of a host is the only one.
    var inst = { host: host, read: read, state: state };
    mounted = mounted.filter(function (g) { return g.host !== host; });
    if (lastFocused && lastFocused.host === host) lastFocused = inst;
    mounted.push(inst);
    return state;
  }

  root.ITRosterGrid = { mount: mount };
})(window);
