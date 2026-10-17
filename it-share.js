/* Iron Tuna share controls (docs/growth-plan.md, Phase 5).
 *
 * Two kinds of control, both sending share_click when used:
 *
 *   button[data-it-share-finding="<player>"]           a homepage example
 *   button[data-it-share-a="<player>"][data-it-share-b] the sample's two players
 *       Asks the worker to freeze the finding (/api/share/finding or
 *       /api/share/compare) and then shares the dated page it answers. The
 *       browser sends a name and a scoring only; the numbers are the worker's.
 *
 *   div.fd-share[data-it-share-url]                    the finding page
 *       Copy link, Share (when the browser has a share sheet) and Save image,
 *       which draws the page's SVG card into a canvas and shares or downloads
 *       it as a PNG, because the places people paste links do not take SVG.
 *
 * A refused clipboard or share sheet never leaves the reader with nothing:
 * the link is printed, selected, under the control.
 */
(function () {
  if (window.ITShare) return;
  window.ITShare = {};
  function itm() { (window.ITMetricsQ = window.ITMetricsQ || []).push([].slice.call(arguments)); }

  function msg(host, text, url) {
    var m = host.querySelector('.it-share-msg');
    if (!m) { m = document.createElement('p'); m.className = 'it-share-msg'; m.setAttribute('role', 'status'); host.appendChild(m); }
    m.textContent = text;
    if (url) {
      var i = document.createElement('input');
      i.type = 'text'; i.readOnly = true; i.value = url; i.className = 'it-share-url'; i.setAttribute('aria-label', 'Link to share');
      m.appendChild(document.createTextNode(' '));
      m.appendChild(i);
      try { i.focus(); i.select(); } catch (e) {}
    }
    return m;
  }
  function copy(url, host) {
    var shown = function () { msg(host, 'Copy this link:', url); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { msg(host, 'Link copied.'); }, shown);
        return;
      }
    } catch (e) {}
    shown();
  }
  function share(url, title, host) {
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function (e) { if (!e || e.name !== 'AbortError') copy(url, host); });
      return 'native';
    }
    copy(url, host);
    return 'copy_link';
  }

  // ── controls that freeze a finding first ─────────────────────────────────
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('button[data-it-share-finding], button[data-it-share-a]') : null;
    if (!b || b.disabled) return;
    ev.preventDefault();
    var host = b.parentNode;
    var scoring = b.getAttribute('data-it-share-scoring') || 'ppr';
    var cmp = b.hasAttribute('data-it-share-a');
    var body = cmp ? { a: b.getAttribute('data-it-share-a'), b: b.getAttribute('data-it-share-b'), scoring: scoring }
      : { player: b.getAttribute('data-it-share-finding'), scoring: scoring };
    var tool = cmp ? 'home_sample' : 'home_examples';
    itm('event', 'share_click', tool, (cmp ? body.a + ' v ' + body.b : body.player).slice(0, 48), { method: navigator.share ? 'native' : 'copy_link', scoring: scoring });
    b.disabled = true;
    msg(host, 'Making a dated link…');
    fetch(cmp ? '/api/share/compare' : '/api/share/finding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        b.disabled = false;
        if (!j || !j.ok || !j.url) {
          msg(host, j && j.error === 'not_current' ? 'This is no longer on the current board, so there is nothing to share. Reload for the latest.'
            : j && j.error === 'rate' ? 'Too many links just now. Try again in a few minutes.' : 'The link could not be made. Try again.');
          return;
        }
        msg(host, '');
        share(j.url, j.title || document.title, host);
      })
      .catch(function () { b.disabled = false; msg(host, 'The link could not be made. Try again.'); });
  });

  // ── the finding page ──────────────────────────────────────────────────────
  function png(src, cb) {
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = 1200; c.height = 630;
        c.getContext('2d').drawImage(img, 0, 0, 1200, 630);
        c.toBlob(function (bl) { cb(bl || null); }, 'image/png');
      } catch (e) { cb(null); }
    };
    img.onerror = function () { cb(null); };
    img.src = src;
  }
  function mount(host) {
    var url = host.getAttribute('data-it-share-url'), title = host.getAttribute('data-it-share-title') || document.title;
    var tool = host.getAttribute('data-it-share-tool') || 'finding', key = host.getAttribute('data-it-share-key') || '';
    var img = host.getAttribute('data-it-share-image');
    // it-metrics.js sends one event per tool and key per visit, so the
    // method is part of the key: a copy and then a saved image are two uses.
    var ev = function (method) { itm('event', 'share_click', tool, (method + ':' + key).slice(0, 48), { method: method }); };
    var add = function (label, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'it-share-btn'; b.textContent = label;
      b.addEventListener('click', fn); host.appendChild(b); return b;
    };
    add('Copy link', function () { ev('copy_link'); copy(url, host); });
    if (navigator.share) add('Share', function () { ev('native'); share(url, title, host); });
    if (img) add('Save image', function () {
      ev('image');
      png(img, function (bl) {
        if (!bl) { msg(host, 'The image could not be drawn here. Open it instead:', location.origin + img); return; }
        var name = 'iron-tuna-' + (key || 'finding') + '.png';
        var file = null; try { file = new File([bl], name, { type: 'image/png' }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          navigator.share({ files: [file], title: title, text: title + ' ' + url }).catch(function () {});
          return;
        }
        var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        msg(host, 'Image saved.');
      });
    });
  }
  function init() { [].forEach.call(document.querySelectorAll('.fd-share[data-it-share-url]'), mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
