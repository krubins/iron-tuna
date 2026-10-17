/* Iron Tuna Sunday email sign-up (docs/growth-plan.md, Phase 5).
 *
 * Fills every [data-it-newsletter="<placement>"] with one small form. There
 * is no popup and nothing covers the page:
 *
 *   data-it-newsletter-permanent   /newsletter, the one permanent place. It
 *                                  always says something, including that the
 *                                  email is not open yet.
 *   data-after="<tool>"            appears only once that tool has produced a
 *                                  result in this page (it-metrics.js sends
 *                                  an it:result event for every success), so
 *                                  the offer follows a useful answer.
 *   neither                        appears as soon as sign-up is open.
 *
 * Prompts (not the permanent page) stay away once this browser has signed up
 * or said no thanks (localStorage it.nl). Nothing appears at all unless
 * /api/newsletter/status says sign-up is open, which it is only when the
 * worker can actually send the confirmation email.
 *
 * The form sends the address, a scoring and an explicit consent flag; the
 * metrics event that follows never carries the address.
 */
(function () {
  if (window.ITNewsletter) return;
  window.ITNewsletter = {};
  var nodes = [].slice.call(document.querySelectorAll('[data-it-newsletter]'));
  if (!nodes.length) return;
  var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  // Where this visit came from (Phase 6), so a confirmed subscription can be
  // counted against its source on /admin. it-metrics.js's own attribution:
  // source, medium and campaign, nothing else.
  function visitSource() {
    try { var v = window.ITMetrics && window.ITMetrics.visit && window.ITMetrics.visit(); return v ? { src: v.src, med: v.med, cmp: v.cmp } : null; } catch (e) { return null; }
  }
  function itm() { (window.ITMetricsQ = window.ITMetricsQ || []).push([].slice.call(arguments)); }
  var RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
  var OFFER = 'Get the five biggest Vegas-versus-expert fantasy differences every Sunday morning.';
  var seq = 0;
  var results = {};
  try { for (var k0 in (window.ITResults || {})) results[k0] = 1; } catch (e) {}
  document.addEventListener('it:result', function (e) {
    var t = e && e.detail && e.detail.tool;
    if (!t) return;
    results[t] = 1;
    nodes.forEach(function (n) { if (n._itReady && n.getAttribute('data-after') === t) show(n); });
  });

  function el(tag, attrs, text) {
    var x = document.createElement(tag);
    for (var k in attrs) x.setAttribute(k, attrs[k]);
    if (text != null) x.textContent = text;
    return x;
  }
  function build(host, offer) {
    var id = 'itnl' + (++seq), place = host.getAttribute('data-it-newsletter') || 'unknown';
    var permanent = host.hasAttribute('data-it-newsletter-permanent');
    host.innerHTML = '';
    host.classList.add('it-nl');
    if (!permanent) {
      host.appendChild(el('p', { 'class': 'it-nl-head' }, 'The Sunday email'));
      host.appendChild(el('p', { 'class': 'it-nl-offer' }, offer || OFFER));
    }
    var f = el('form', { 'class': 'it-nl-form', novalidate: '' });
    var row = el('div', { 'class': 'it-nl-row' });
    var lab = el('label', { 'for': id + 'e' }, 'Email');
    var inp = el('input', { id: id + 'e', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: '', placeholder: 'you@example.com' });
    var sl = el('label', { 'for': id + 's' }, 'Scoring');
    var sel = el('select', { id: id + 's', name: 'scoring' });
    [['ppr', 'PPR'], ['half', 'Half PPR'], ['standard', 'Standard']].forEach(function (o) { sel.appendChild(el('option', { value: o[0] }, o[1])); });
    try { var hs = get('it.hmScoring'); if (/^(ppr|half|standard)$/.test(hs || '')) sel.value = hs; } catch (e) {}
    var d1 = el('div', { 'class': 'it-nl-f' }); d1.appendChild(lab); d1.appendChild(inp);
    var d2 = el('div', { 'class': 'it-nl-f it-nl-sc' }); d2.appendChild(sl); d2.appendChild(sel);
    row.appendChild(d1); row.appendChild(d2);
    f.appendChild(row);
    var cl = el('label', { 'class': 'it-nl-consent', 'for': id + 'c' });
    var cb = el('input', { id: id + 'c', type: 'checkbox', name: 'consent' });
    cl.appendChild(cb);
    cl.appendChild(document.createTextNode(' Send me the Iron Tuna Sunday email. I can unsubscribe from any email. '));
    var pl = el('a', { href: '/privacy' }, 'Privacy');
    cl.appendChild(pl);
    f.appendChild(cl);
    var hp = el('div', { 'class': 'it-nl-hp', 'aria-hidden': 'true' });
    hp.appendChild(el('input', { type: 'text', name: 'company', tabindex: '-1', autocomplete: 'off' }));
    f.appendChild(hp);
    var act = el('div', { 'class': 'it-nl-act' });
    var btn = el('button', { type: 'submit' }, 'Sign up');
    act.appendChild(btn);
    if (!permanent) {
      var no = el('button', { type: 'button', 'class': 'it-nl-no' }, 'No thanks');
      no.addEventListener('click', function () { set('it.nl', 'dismissed'); host.hidden = true; });
      act.appendChild(no);
    }
    f.appendChild(act);
    var m = el('p', { 'class': 'it-nl-msg', role: 'status', 'aria-live': 'polite' });
    f.appendChild(m);
    f.appendChild(el('p', { 'class': 'it-nl-fine' }, 'Up to five, fewer when fewer clear the bar. We email you once to confirm; nothing else is sent until you do.'));
    host.appendChild(f);
    var say = function (t, ok) { m.textContent = t; m.className = 'it-nl-msg ' + (ok ? 'ok' : 'err'); };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = inp.value.trim();
      if (!RE.test(email)) { say('Enter a valid email address.', false); inp.focus(); return; }
      if (!cb.checked) { say('Tick the box to agree to the email.', false); cb.focus(); return; }
      btn.disabled = true; say('Sending…', true);
      fetch('/api/newsletter/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email, scoring: sel.value, consent: true, source: place, att: visitSource(), company: hp.firstChild.value }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (j) {
          if (j && j.ok) {
            f.reset(); btn.disabled = true;
            say('Check your inbox and confirm. If this address is already subscribed, nothing changes.', true);
            set('it.nl', 'done');
            itm('event', 'subscribe_request', 'newsletter', place, { scoring: sel.value });
            return;
          }
          btn.disabled = false;
          var er = j && j.error;
          say(er === 'invalid_email' ? 'Enter a valid email address.'
            : er === 'consent_required' ? 'Tick the box to agree to the email.'
            : er === 'rate' ? 'Too many sign-ups just now. Try again in a few minutes.'
            : er === 'closed' ? 'Sign-up is closed right now.'
            : er === 'region' ? 'The Sunday email is not available in Washington.'
            : 'That did not go through. Try again in a minute.', false);
        })
        .catch(function () { btn.disabled = false; say('That did not go through. Try again in a minute.', false); });
    });
  }
  function show(n) { if (n._itShown) return; n._itShown = true; n.hidden = false; }

  fetch('/api/newsletter/status').then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (j) {
    var open = !!(j && j.open), prompted = /^(done|dismissed)$/.test(get('it.nl') || '');
    nodes.forEach(function (n) {
      var permanent = n.hasAttribute('data-it-newsletter-permanent');
      if (!open) {
        if (permanent) { n.innerHTML = ''; n.appendChild(el('p', { 'class': 'it-nl-closed' }, 'Sign-up is not open yet. This page will carry the form as soon as the first edition can be sent.')); n.hidden = false; }
        return;
      }
      if (!permanent && prompted) return;
      build(n, j.offer);
      n._itReady = true;
      var after = n.getAttribute('data-after');
      if (permanent || !after || results[after]) show(n);
    });
  });
})();
