/* it-roster-grid.js — every roster in the league, off one screenshot.
 *
 * A league that prints all twelve rosters on one page is ONE screenshot, not
 * twelve, and the screenshot is on the clipboard rather than on disk: Win+Shift+S
 * and Cmd+Ctrl+Shift+4 both end with an image nobody ever saved to a file. So
 * this takes a paste, a drag or the picker, shrinks what it gets, and sends it
 * to /api/roster-read, which answers with names only — no starter, bench or IR,
 * because a grid does not print them. The reader then says which team is theirs.
 *
 * It lives in its own file because the page mounts it TWICE: once in the manual
 * league form under §01, and once in §02, where a reader who never opens §01
 * pastes their rosters into the section that promises them. Two copies of a
 * reader like this drift apart within a release.
 *
 *   ITRosterGrid.mount(host, opts) -> state
 *
 *   state.teams    [{ name, players: [{ name, position, team }] }]
 *   state.mine     index of the reader's own team, -1 until they say
 *   state.partial  the reader ran out of room; the last team may be short
 *   state.clear()  back to empty, and the box redrawn
 *
 *   opts.teams     a room already known, to open with
 *   opts.mine      which of those is the reader's
 *   opts.label     the box's heading; '' when the host already titles it
 *   opts.note      the line under the label, in the host's own words
 *   opts.onRead    (state) after a read lands
 *   opts.onPick    (state) when the reader names their team
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
    var state = { teams: [], mine: -1, partial: false, clear: null };
    var mac = /Mac|iPhone|iPad|iPod/.test((root.navigator.platform || '') + ' ' + (root.navigator.userAgent || ''));

    // The host may already be a titled card, as §02's is; a second heading over
    // the same box reads as two things stacked rather than one.
    var label = o.label === undefined ? 'Every roster from one screenshot' : o.label;
    host.innerHTML = '<div class="is-field rg-field">' + (label ? '<label>' + esc(label) + '</label>' : '') +
      '<p class="is-note" style="margin:0 0 6px">' + esc(o.note || 'A league roster grid holds all of the teams at once. Names only: your starting lineup is projected from the scoring, not read off the page. Send more than one image at a time if the grid does not fit in one shot.') + '</p>' +
      '<div class="mg-drop" data-drop tabindex="0" role="group" aria-label="Paste, drop or choose roster screenshots">' +
        '<b>Paste a screenshot, or drop one in</b>' +
        '<span>Copy the roster grid and press <kbd>' + (mac ? '⌘' : 'Ctrl+') + 'V</kbd> — here or anywhere on this form — or drag the image onto this box, or <button type="button" class="mg-pick" data-pick>choose files</button>.</span>' +
      '</div>' +
      '<input type="file" accept="image/*" multiple hidden data-file>' +
      '<p class="is-note" data-msg style="margin:6px 0 0" role="status" aria-live="polite"></p><div data-out></div></div>';

    var drop = host.querySelector('[data-drop]'), fileIn = host.querySelector('[data-file]');
    var msgEl = host.querySelector('[data-msg]'), outEl = host.querySelector('[data-out]');
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

    function read(files) {
      var list = [].slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); }).slice(0, 8);
      if (!list.length) { msg('Those are not images.', true); return; }
      msg('Reading ' + list.length + ' screenshot' + (list.length === 1 ? '' : 's') + '… a whole grid can take a minute.');
      Promise.all(list.map(shrink)).then(function (images) {
        return root.fetch('/api/roster-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images: images }) }).then(function (r) { return r.json(); });
      }).then(adopt).catch(function () { msg('The reader did not answer. Try again, or type your roster instead.', true); });
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
    }

    function render() {
      if (!state.teams.length) { outEl.innerHTML = ''; return; }
      outEl.innerHTML = '<div class="is-seg" role="group" style="flex-wrap:wrap;margin-top:6px">' + state.teams.map(function (t, i) {
        return '<label><input type="radio" name="' + id + 'mine" value="' + i + '">' + esc(t.name || ('Team ' + (i + 1))) + ' (' + t.players.length + ')</label>';
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
    }

    state.clear = function () { state.teams = []; state.mine = -1; state.partial = false; render(); msg(''); };
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
