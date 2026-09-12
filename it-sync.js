/* Iron Tuna — the reader's SYNCED league, on every in-season page.
 *
 * it-league.js knows the draft app's saved settings and it-inseason.js knows
 * the in-season form, both in this browser only. This file knows the leagues
 * the reader has CONNECTED to their Iron Tuna account (/api/leagues): the
 * exact scoring, the roster, every other roster, the free-agent pool, the
 * opponent. It is the client half of docs/league-sync.md.
 *
 * Nothing here invents a league either. state() is null until /api/leagues
 * answers for a signed-in reader with at least one league, and every page
 * that reads it falls back to what it did before: the browser records, or
 * the site defaults, labeled as such.
 *
 *   ITSync.load(force)            -> Promise<state|null>; cached a minute per tab
 *   ITSync.state()                -> the last loaded state, or null
 *   ITSync.active()               -> the active league (default, or the one picked here), or null
 *   ITSync.select(id)             -> make a league active on this device
 *   ITSync.api(path, opts)        -> fetch on this origin with the session cookie
 *   ITSync.strip(el)              -> "League: X ▼ · Sleeper · Synced 8m ago · Sync now"
 *   ITSync.cta(el, context)       -> the acquisition call, only where it belongs
 *   ITSync.callouts(root)         -> On Your Roster / Available badges on player links
 *   ITSync.ago(ts), ITSync.esc(s), ITSync.onChange(fn)
 */
(function (root, doc) {
  'use strict';
  var ACTIVE_KEY = 'it_sync_active_v1', CACHE_KEY = 'it_sync_cache_v1', CACHE_MS = 60 * 1000;
  var cur = null, loading = null, listeners = [];

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function read(store, k) { try { return root[store].getItem(k); } catch (e) { return null; } }
  function write(store, k, v) { try { if (v == null) root[store].removeItem(k); else root[store].setItem(k, v); } catch (e) {} }
  function ago(ts) {
    if (!ts) return 'never';
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  function api(path, opts) {
    var o = opts || {};
    var init = { method: o.method || 'GET', credentials: 'same-origin', headers: {} };
    if (o.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(o.body); }
    return fetch(path, init).then(function (r) { return r.json().then(function (j) { if (j && typeof j === 'object') j.__status = r.status; return j; }, function () { return { ok: false, error: 'bad_json', __status: r.status }; }); });
  }
  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](cur); } catch (e) {} } }
  function normalize(j) {
    if (!j || !j.ok) return { signedIn: j && j.__status !== 401, leagues: [], defaultId: null, providers: (j && j.providers) || null, connections: null };
    var st = { signedIn: true, leagues: j.leagues || [], defaultId: j.defaultId || null, providers: j.providers || null, connections: j.connections || null };
    var want = read('localStorage', ACTIVE_KEY);
    st.activeId = (want && st.leagues.some(function (l) { return l.id === want; })) ? want : st.defaultId;
    return st;
  }
  // The state, from the tab's cache when fresh, else from /api/leagues. A 401
  // (not signed in) is cached too, so a logged-out reader costs one call.
  function load(force) {
    if (!force) {
      if (cur) return Promise.resolve(cur);
      try { var c = JSON.parse(read('sessionStorage', CACHE_KEY) || 'null'); if (c && c.at && Date.now() - c.at < CACHE_MS && c.state) { cur = normalize(c.state); return Promise.resolve(cur); } } catch (e) {}
    }
    if (loading) return loading;
    loading = api('/api/leagues').then(function (j) {
      cur = normalize(j);
      write('sessionStorage', CACHE_KEY, JSON.stringify({ at: Date.now(), state: j }));
      loading = null; emit();
      return cur;
    }, function () { loading = null; cur = { signedIn: false, leagues: [], defaultId: null, activeId: null, providers: null, error: true }; return cur; });
    return loading;
  }
  function state() { return cur; }
  function active() { if (!cur || !cur.leagues.length) return null; for (var i = 0; i < cur.leagues.length; i++) if (cur.leagues[i].id === cur.activeId) return cur.leagues[i]; return cur.leagues[0]; }
  function select(id) { write('localStorage', ACTIVE_KEY, id); if (cur) { cur.activeId = id; emit(); } }
  function invalidate() { write('sessionStorage', CACHE_KEY, null); cur = null; }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function providerLabel(p) { return { sleeper: 'Sleeper', yahoo: 'Yahoo', cbs: 'CBS Sportsline', cbs_browser: 'CBS browser import', espn: 'ESPN', manual: 'Manual' }[p] || p; }
  function syncLine(L) {
    if (!L) return '';
    var s = L.sync || {};
    if (L.provider === 'manual') return 'Manual · entered ' + ago(s.lastAt);
    if (L.provider === 'cbs_browser') return 'CBS · imported ' + ago(s.lastOkAt || s.lastAt) + ' · refresh using the CBS extension';
    if (s.status === 'failed') return providerLabel(L.provider) + ' · last sync failed · last good ' + ago(s.lastOkAt);
    return providerLabel(L.provider) + ' · synced ' + ago(s.lastOkAt || s.lastAt) + (s.stale ? ' · may be outdated' : '');
  }

  // ── the strip ──────────────────────────────────────────────────────────────
  // League: Office League ▼   Sleeper · synced 8m ago   [Sync now]
  function strip(el, opts) {
    if (!el) return;
    var o = opts || {};
    load().then(function (st) {
      if (!st || !st.leagues.length) { el.hidden = true; el.innerHTML = ''; return; }
      var L = active();
      var sel = st.leagues.length > 1 ? '<select class="its-sel" aria-label="Active league">' + st.leagues.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === L.id ? ' selected' : '') + '>' + esc(l.name) + (l.isDefault ? ' (default)' : '') + '</option>'; }).join('') + '</select>' : '<b>' + esc(L.name) + '</b>';
      var stale = L.sync && (L.sync.stale || L.sync.status === 'failed');
      el.hidden = false;
      el.innerHTML = '<span class="its-lab">League:</span> ' + sel +
        ' <span class="its-sync' + (stale ? ' stale' : '') + '">' + esc(syncLine(L)) + '</span>' +
        (L.provider !== 'manual' && L.provider !== 'cbs_browser' ? ' <button type="button" class="its-btn" data-sync>Sync now</button>' : '') +
        ' <a class="its-link" href="/my-league">My Leagues</a>' + (o.week ? ' · <a class="its-link" href="/my-week">My Week</a>' : '') +
        (stale && L.sync.status === 'failed' ? '<span class="its-warn">League data may be outdated. Refresh recommended.</span>' : '');
      var s = el.querySelector('select'); if (s) s.addEventListener('change', function () { select(this.value); if (o.onChange) o.onChange(active()); else root.location.reload(); });
      var b = el.querySelector('[data-sync]'); if (b) b.addEventListener('click', function () {
        b.disabled = true; b.textContent = 'Syncing…';
        api('/api/leagues/' + encodeURIComponent(L.id) + '/sync', { method: 'POST' }).then(function (j) {
          invalidate();
          if (!j.ok) { b.textContent = 'Sync failed'; var w = el.querySelector('.its-sync'); if (w) { w.classList.add('stale'); w.textContent = j.message || 'Sync failed'; } setTimeout(function () { b.disabled = false; b.textContent = 'Sync now'; }, 3000); return; }
          root.location.reload();
        });
      });
    });
  }
  // ── the call to action ─────────────────────────────────────────────────────
  // Only for a reader who is signed in and has nothing connected; a synced
  // reader sees the feature instead, and a visitor sees the section's own
  // copy. `context` picks the sentence.
  var CTA = {
    pickups: 'Want recommendations based on players actually available in your league?',
    rankings: 'Connect your league to rank players using your exact scoring settings.',
    trades: 'Connect your league to find actual trade partners.',
    lineup: 'Connect your league and Iron Tuna sets your best lineup from your actual roster.',
    generic: 'Connect your league and every number on this site reads at your exact settings.'
  };
  function cta(el, context) {
    if (!el) return;
    load().then(function (st) {
      if (!st || !st.signedIn || st.leagues.length) { el.hidden = true; return; }
      el.hidden = false;
      el.innerHTML = '<div class="its-cta"><b>' + esc(CTA[context] || CTA.generic) + '</b> <a class="is-btn primary" href="/my-league#connect">Sync your league</a></div>';
    });
  }
  // ── callouts on stories and cards ──────────────────────────────────────────
  // Every /player/<slug> link inside `scope` gets a small tag: On your roster,
  // Available in your league, Rostered by X. One call per page, sixty names
  // at most, and nothing if no league is synced.
  function callouts(scope, opts) {
    var o = opts || {};
    var rootEl = scope || doc;
    return load().then(function (st) {
      var L = active();
      if (!L) return null;
      var links = [].slice.call(rootEl.querySelectorAll('a[href^="/player/"], a[href^="/in-season/player/"]'));
      var names = {}, order = [];
      links.forEach(function (a) { var n = (a.textContent || '').trim(); if (n && n.length < 40 && !names[n]) { names[n] = []; order.push(n); } if (n && names[n]) names[n].push(a); });
      if (!order.length) return null;
      return api('/api/leagues/' + encodeURIComponent(L.id) + '/availability?names=' + encodeURIComponent(order.slice(0, 60).join(','))).then(function (j) {
        if (!j || !j.ok) return null;
        var mine = [], avail = [], opp = [];
        j.players.forEach(function (p) {
          if (!p || p.status === 'unknown') return;
          var cls = p.status === 'mine' ? 'mine' : p.status === 'available' || p.status === 'waiver' ? 'avail' : p.isOpponent ? 'opp' : 'other';
          var short = p.status === 'mine' ? 'Your roster' : p.status === 'available' ? 'Available' : p.status === 'waiver' ? 'On waivers' : p.isOpponent ? 'Your opponent' : 'Rostered';
          (names[p.name] || []).forEach(function (a) { if (a.querySelector('.its-tag')) return; var t = doc.createElement('span'); t.className = 'its-tag ' + cls; t.title = p.label; t.textContent = short; a.insertAdjacentElement('afterend', t); });
          if (p.status === 'mine') mine.push(p); else if (p.status === 'available' || p.status === 'waiver') avail.push(p); else if (p.isOpponent) opp.push(p);
        });
        var box = o.summary || rootEl.querySelector('[data-it-sync-story]');
        if (box && (mine.length || avail.length || opp.length)) {
          box.hidden = false;
          box.innerHTML = '<div class="its-story"><p class="is-eyebrow">What this means for your team · ' + esc(L.name) + '</p>' +
            (mine.length ? '<p><b>ON YOUR ROSTER:</b> ' + mine.map(function (p) { return esc(p.name) + (p.slot === 'starter' ? ' (starting)' : p.slot === 'bench' ? ' (bench)' : ''); }).join(', ') + '</p>' : '') +
            (avail.length ? '<p><b>AVAILABLE IN YOUR LEAGUE:</b> ' + avail.map(function (p) { return esc(p.name) + (p.status === 'waiver' ? ' (waivers)' : ''); }).join(', ') + ' · <a href="/faab">Pickup Advisor</a></p>' : '') +
            (opp.length ? '<p><b>AFFECTS YOUR MATCHUP:</b> ' + opp.map(function (p) { return esc(p.name); }).join(', ') + ' on your opponent’s roster · <a href="/my-week">Your matchup</a></p>' : '') +
            '</div>';
        }
        return j;
      });
    });
  }
  // The shared styles, once.
  try {
    var css = doc.createElement('style');
    css.textContent = '.its-strip-sync{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:var(--sec);padding:10px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--elev);margin:12px 0}' +
      '.its-strip-sync .its-lab{font-weight:700;color:var(--text)}.its-strip-sync b{color:var(--text)}.its-sel{font:inherit;padding:4px 8px;border:1px solid var(--line2);border-radius:6px;background:#fff;color:var(--text)}' +
      '.its-sync.stale{color:var(--danger)}.its-btn{font:inherit;font-size:12px;font-weight:700;padding:5px 10px;border-radius:14px;border:1px solid var(--teal);background:rgba(14,124,99,.1);color:var(--teal);cursor:pointer}.its-btn[disabled]{opacity:.6}' +
      '.its-link{font-weight:700}.its-warn{flex-basis:100%;color:var(--danger);font-weight:700}' +
      '.its-cta{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 16px;border:1px solid var(--teal);border-radius:12px;background:rgba(14,124,99,.06);margin:14px 0}' +
      '.its-tag{display:inline-block;margin-left:5px;padding:1px 7px;border-radius:10px;font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;vertical-align:middle;border:1px solid var(--line2);color:var(--muted);background:var(--elev)}' +
      '.its-tag.mine{color:var(--teal);border-color:rgba(14,124,99,.4);background:rgba(14,124,99,.1)}.its-tag.avail{color:#8a5a00;border-color:rgba(181,120,0,.4);background:rgba(224,160,0,.12)}.its-tag.opp{color:var(--danger);border-color:rgba(160,40,40,.35);background:rgba(200,50,50,.08)}' +
      '.its-story{border-left:3px solid var(--teal);padding:10px 14px;margin:16px 0;background:var(--elev);border-radius:0 10px 10px 0}.its-story p{margin:4px 0;font-size:14px}';
    (doc.head || doc.documentElement).appendChild(css);
  } catch (e) {}
  root.ITSync = { load: load, state: state, active: active, select: select, invalidate: invalidate, api: api, strip: strip, cta: cta, callouts: callouts, ago: ago, esc: esc, onChange: onChange, providerLabel: providerLabel, syncLine: syncLine };
})(window, document);
