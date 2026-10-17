/* Iron Tuna outcome metrics (docs/growth-plan.md, Phase 1).
 *
 * The Worker's page counter (logPageView in _worker.js) already counts every
 * HTML request with no script at all. What it cannot see is what a reader got
 * out of a page, or whether the same browser came back: its visitor id rotates
 * every UTC day by design. This file adds both, and nothing else:
 *
 *   visit_start            once per visit (30 idle minutes end one), carrying
 *                          where the visit came from and whether this browser
 *                          has been here before
 *   tool_success           a tool produced a populated result
 *   tool_empty, tool_error it produced nothing, or failed to load
 *   league_setup_start / league_setup_complete
 *   subscribe_request      an email form succeeded (the address is never sent)
 *   share_click            a share or copy-link control was used
 *   surface_click          a link marked data-it-surface was followed (the
 *                          homepage examples, its primary action, its sample)
 *
 * A success is its own event, never a click. Each one is sent at most once per
 * visit for the same tool and key, so a rerender, a retry or a reload of the
 * same board is one output, not several.
 *
 * Identity is a random id in localStorage (it.uid, the id rankings.html and
 * desk.html already used). It is not derived from anything about the reader
 * and is never joined to an email. Blocked storage means no id and no events;
 * cleared storage or another device reads as a new browser.
 *
 * Attribution: utm_source / utm_medium / utm_campaign when present, else the
 * outside referrer's host, else "direct". A click between our own pages never
 * starts a visit or changes its source. See docs/growth-plan.md for the UTM
 * convention the owner's own links follow.
 *
 * Surfaces (Phase 3): a link carrying data-it-surface="<name>" sends a
 * surface_click and remembers the surface for the rest of the visit, and the
 * next tool_success and league setup events in that visit carry it as
 * `surface`, unless the page named one itself. That is how /admin can say how
 * many visits that clicked a homepage example went on to a result or a saved
 * league, without reading anything but the events.
 */
(function () {
  if (window.ITMetrics) return;
  var VISIT_MS = 30 * 60 * 1000;
  var noop = function () {};
  // Every success is also announced in the page (Phase 5), whether or not
  // anything is sent: it-newsletter.js shows its offer after a useful
  // result. window.ITResults keeps the tools that have answered, for a
  // listener that arrives after the event.
  var emit = function (tool, key) {
    if (!tool) return;
    try { (window.ITResults = window.ITResults || {})[tool] = 1; } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('it:result', { detail: { tool: tool, key: key } })); } catch (e) {}
  };
  var api = { uid: function () { return ''; }, success: emit, empty: noop, error: noop, event: noop, visit: function () { return null; } };
  window.ITMetrics = api;
  // A page that cannot send events (automation, blocked storage) still runs
  // its queued successes through emit, and nothing else.
  var quiet = function () {
    var q0 = window.ITMetricsQ; if (q0 && q0.length) for (var j = 0; j < q0.length; j++) { try { if (q0[j][0] === 'success') emit(q0[j][1], q0[j][2]); } catch (e) {} }
    window.ITMetricsQ = { push: function (c) { try { if (c[0] === 'success') emit(c[1], c[2]); } catch (e) {} } };
  };

  // Identifiable automation sends nothing. This mirrors BOT_RE in the worker
  // and is deliberately conservative; the admin page reports the rest.
  var ua = (navigator.userAgent || '');
  if (navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|phantomjs|puppeteer|playwright|selenium/i.test(ua)) { quiet(); return; }

  var ls; try { ls = window.localStorage; ls.setItem('it.t', '1'); ls.removeItem('it.t'); } catch (e) { quiet(); return; }
  var ss = null; try { ss = window.sessionStorage; } catch (e) {}

  var get = function (k) { try { return ls.getItem(k); } catch (e) { return null; } };
  var set = function (k, v) { try { ls.setItem(k, v); } catch (e) {} };
  var rnd = function () { return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 12); };
  var day = function () { return new Date().toISOString().slice(0, 10); };

  var isNew = false;
  var uid = get('it.uid');
  if (!uid || !/^[a-z0-9]{6,24}$/.test(uid)) { uid = rnd(); set('it.uid', uid); isNew = true; set('it.first', day()); }
  // A browser whose id predates this file has visited before; its first-seen
  // day is unknown, so it reports one before every week the dashboard reads.
  if (!get('it.first')) set('it.first', '0000-00-00');

  var host = location.hostname.replace(/^www\./, '');
  var SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu|startpage|qwant)\./;
  var AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com)$/;
  var SOCIAL = /(^|\.)(x\.com|t\.co|twitter\.com|threads\.net|threads\.com|reddit\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com|discord\.com|bsky\.app|lnkd\.in)$/;
  var clip = function (v, n) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9._~:-]+/g, '-').slice(0, n || 40); };

  function arrival() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { q = { get: function () { return null; } }; }
    var us = q.get('utm_source');
    if (us) return { src: clip(us), med: clip(q.get('utm_medium') || 'unknown'), cmp: clip(q.get('utm_campaign') || '') };
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) {}
    if (ref === host) return { internal: true };
    if (!ref) return { src: 'direct', med: 'none', cmp: '' };
    return { src: clip(ref, 60), med: SEARCH.test(ref) ? 'organic' : AI.test(ref) ? 'ai' : SOCIAL.test(ref) ? 'social' : 'referral', cmp: '' };
  }

  var now = Date.now();
  var v = null; try { v = JSON.parse(get('it.visit') || 'null'); } catch (e) {}
  var a = arrival();
  var fresh = !v || !v.id || now - (v.last || 0) > VISIT_MS;
  // A new outside arrival (a tagged link, another site) mid-visit starts a new
  // visit, the way analytics tools conventionally do; an internal one never does.
  var newArrival = !a.internal && v && !fresh && (a.src !== v.src || a.cmp !== v.cmp) && a.src !== 'direct';
  if (fresh || newArrival) {
    // Arriving from our own page with no live visit (a tab restored, a link
    // opened after half an hour) is a continuation whose source is unknown.
    if (a.internal) a = { src: '(continued)', med: 'none', cmp: '' };
    v = { id: rnd(), src: a.src, med: a.med, cmp: a.cmp, land: location.pathname.slice(0, 120), n: ((v && v.n) || 0) + 1, sent: {} };
    v.last = now;
    set('it.visit', JSON.stringify(v));
    send('visit_start', { src: v.src, med: v.med, cmp: v.cmp, land: v.land, new: isNew ? 1 : 0, n: v.n });
  } else {
    v.last = now;
    set('it.visit', JSON.stringify(v));
  }
  // Strip the UTM tags once recorded, so a reader who copies the address does
  // not hand the next person a link that claims the same campaign.
  try {
    if (/[?&]utm_/.test(location.search) && history.replaceState) {
      var u = new URL(location.href);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { u.searchParams.delete(k); });
      history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    }
  } catch (e) {}

  function send(event, props) {
    try {
      var p = props || {};
      p.path = location.pathname.slice(0, 120);
      p.vid = v && v.id;
      p.fs = get('it.first') || '';
      var body = JSON.stringify({ event: event, uid: uid, props: p });
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
      if (window.fetch) fetch('/api/track', { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(noop);
    } catch (e) {}
  }

  // Only short scalar fields leave the page; the worker enforces the same list.
  var ALLOWED = { tool: 1, key: 1, rows: 1, horizon: 1, pos: 1, scoring: 1, mode: 1, kind: 1, method: 1, step: 1, status: 1, platform: 1, teams: 1, surface: 1 };
  function clean(props) {
    var o = {};
    for (var k in props) {
      if (!ALLOWED[k] || props[k] == null) continue;
      var x = props[k];
      if (typeof x === 'number' || typeof x === 'boolean') o[k] = x;
      else { x = String(x).slice(0, 48); if (!/@/.test(x)) o[k] = x; }
    }
    return o;
  }
  // Once per visit for the same event, tool and key. The visit record keeps
  // the keys it has sent, so a reload inside the visit does not resend.
  function once(event, tool, key, props) {
    if (!tool) return false;
    var id = event + '|' + tool + '|' + (key == null ? '' : String(key).slice(0, 48));
    try { v = JSON.parse(get('it.visit') || 'null') || v; } catch (e) {}
    v.sent = v.sent || {};
    if (v.sent[id]) return false;
    var n = 0; for (var s in v.sent) n++;
    if (n > 200) return false;
    v.sent[id] = 1; v.last = Date.now();
    set('it.visit', JSON.stringify(v));
    var p = clean(props || {}); p.tool = tool; if (key != null) p.key = String(key).slice(0, 48);
    if (!p.surface && v.surf && /^(tool_success|league_setup_start|league_setup_complete)$/.test(event)) p.surface = v.surf;
    send(event, p);
    return true;
  }
  // The surface a reader clicked through, kept on the visit record so the page
  // the link opens (same visit, same tab) can read it back.
  function surfaceClick(el) {
    var s = clip(el.getAttribute('data-it-surface'), 32);
    if (!s) return;
    var to = '';
    try { to = new URL(el.getAttribute('href') || '', location.href).pathname.replace(/^\/+/, '').split('/')[0]; } catch (e) {}
    try { v = JSON.parse(get('it.visit') || 'null') || v; } catch (e) {}
    v.surf = s; v.last = Date.now();
    set('it.visit', JSON.stringify(v));
    once('surface_click', clip(to || 'home', 32), s, { surface: s });
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[data-it-surface]') : null;
    if (el) surfaceClick(el);
  }, true);

  api.uid = function () { return uid; };
  api.visit = function () { return v ? { id: v.id, src: v.src, med: v.med, cmp: v.cmp, n: v.n } : null; };
  api.success = function (tool, key, props) { emit(tool, key); return once('tool_success', tool, key, props); };
  api.empty = function (tool, key, props) { return once('tool_empty', tool, key, props); };
  api.error = function (tool, key, props) { return once('tool_error', tool, key, props); };
  // league_setup_start / league_setup_complete / subscribe_request / share_click
  api.event = function (name, tool, key, props) {
    if (!/^(league_setup_start|league_setup_complete|subscribe_request|share_click)$/.test(name)) return false;
    return once(name, tool, key, props);
  };
  // Pages that load before this file can queue calls on window.ITMetricsQ.
  var q = window.ITMetricsQ; if (q && q.length) for (var i = 0; i < q.length; i++) { try { api[q[i][0]].apply(null, q[i].slice(1)); } catch (e) {} }
  window.ITMetricsQ = { push: function (c) { try { api[c[0]].apply(null, c.slice(1)); } catch (e) {} } };
})();
