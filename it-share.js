/* Share controls for findings and comparisons (docs/growth-plan.md, Phase 5).
 *
 *   ITShare.buttons(container, {
 *     tool:  'home_examples' | 'flex_call' | 'finding',   the share_click tool
 *     key:   a short key for the thing shared (once per visit per method)
 *     link:  function () returning a Promise of the URL to share, or a URL
 *     title, text: what a native share sheet shows
 *     image: optional URL of the finding's SVG share image
 *   })
 *
 * Draws up to three plain buttons: Copy link, Share (only where the browser
 * has a share sheet) and Save image (only with an image). Each one used sends
 * one share_click with its method, which counts the control being used, not a
 * post being made: nothing here can see what happens after the sheet opens.
 *
 * The link is asked for only when a button is pressed, because making one
 * stores a dated finding on the server; a page that is merely viewed stores
 * nothing. The answer is kept for the rest of the page's life, so pressing
 * twice shares one finding.
 */
(function () {
  if (window.ITShare) return;
  function itm() { (window.ITMetricsQ = window.ITMetricsQ || []).push([].slice.call(arguments)); }
  var CSS = '.it-share{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}'
    + '.it-share button{font:inherit;font-size:14px;line-height:1.2;padding:7px 12px;border-radius:8px;border:1px solid var(--line,#d4dde3);background:#fff;color:var(--text,#1a2129);cursor:pointer}'
    + '.it-share button:hover{border-color:var(--teal,#0a7d6a)}'
    + '.it-share button:focus-visible{outline:2px solid var(--teal,#0a7d6a);outline-offset:2px}'
    + '.it-share button[disabled]{opacity:.6;cursor:default}'
    + '.it-share-msg{flex-basis:100%;margin:2px 0 0;font-size:13px;color:var(--sec,#566)}'
    + '.it-share-msg input{width:100%;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line,#d4dde3);border-radius:6px}';
  function style() {
    if (document.getElementById('itShareCss')) return;
    var s = document.createElement('style'); s.id = 'itShareCss'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function btn(label, method) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('data-share-method', method);
    return b;
  }
  // The PNG a share sheet or a download wants, drawn from the SVG in this
  // browser. Resolves null when the browser cannot (no canvas, a refused image).
  function png(src) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var c = document.createElement('canvas'); c.width = 1200; c.height = 630;
            c.getContext('2d').drawImage(img, 0, 0, 1200, 630);
            c.toBlob(function (b) { resolve(b || null); }, 'image/png');
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = src;
      } catch (e) { resolve(null); }
    });
  }
  function buttons(el, o) {
    if (!el || !o) return null;
    style();
    var box = document.createElement('div');
    box.className = 'it-share';
    var msg = document.createElement('p');
    msg.className = 'it-share-msg'; msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    var cached = null;
    function link() {
      if (!cached) cached = Promise.resolve(typeof o.link === 'function' ? o.link() : o.link);
      return cached.then(function (u) { if (!u) cached = null; return u; }, function () { cached = null; return null; });
    }
    function sent(method) { itm('event', 'share_click', o.tool, (o.key || 'x') + '|' + method, { method: method }); }
    function failed() { msg.textContent = 'This could not be shared right now. It may have changed since the page loaded.'; }
    var copy = btn('Copy link', 'copy_link');
    copy.addEventListener('click', function () {
      sent('copy_link');
      copy.disabled = true;
      link().then(function (u) {
        copy.disabled = false;
        if (!u) return failed();
        var shown = function () {
          // A refused clipboard still leaves the reader the address, selected.
          msg.textContent = '';
          var i = document.createElement('input'); i.readOnly = true; i.value = u; i.setAttribute('aria-label', 'Link to share');
          msg.appendChild(i); try { i.select(); } catch (e) {}
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(u).then(function () { msg.textContent = 'Link copied.'; }, shown);
          } else shown();
        } catch (e) { shown(); }
      });
    });
    box.appendChild(copy);
    if (navigator.share) {
      var sh = btn('Share', 'native');
      sh.addEventListener('click', function () {
        sent('native');
        link().then(function (u) {
          if (!u) return failed();
          try { navigator.share({ title: o.title || document.title, text: o.text || '', url: u }).catch(function () {}); } catch (e) {}
        });
      });
      box.appendChild(sh);
    }
    if (o.image) {
      var im = btn('Save image', 'image');
      im.addEventListener('click', function () {
        sent('image');
        im.disabled = true;
        Promise.all([png(o.image), link()]).then(function (r) {
          im.disabled = false;
          var blob = r[0], u = r[1];
          if (!blob) { msg.textContent = 'This browser could not draw the image. The link works on its own.'; return; }
          var file = null;
          try { file = new File([blob], 'iron-tuna-finding.png', { type: 'image/png' }); } catch (e) {}
          if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            navigator.share({ files: [file], title: o.title || '', text: (o.text ? o.text + ' ' : '') + (u || '') }).catch(function () {});
            return;
          }
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = 'iron-tuna-finding.png';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        });
      });
      box.appendChild(im);
    }
    box.appendChild(msg);
    el.appendChild(box);
    return box;
  }
  // A dated finding, made by the server from its own board. Resolves the URL,
  // or null when the player no longer qualifies (the board moved).
  function finding(body) {
    return fetch('/api/finding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j && j.ok && j.id ? location.origin + '/f/' + j.id : null; })
      .catch(function () { return null; });
  }
  window.ITShare = { buttons: buttons, finding: finding };
})();
