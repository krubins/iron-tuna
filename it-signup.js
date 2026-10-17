/* The Sunday email's sign-up form (docs/growth-plan.md, Phase 5).
 *
 *   ITSignup.mount(el, { tool })   the permanent form (/sunday)
 *   ITSignup.offer(el, { tool })   the same form after a useful result, with
 *                                  "Not now"; shown at most until dismissed
 *
 * Never a popup and never in the way: it is drawn into a slot the page leaves
 * for it, after the thing the reader came for. It is not drawn at all while
 * the server says sign-ups are closed (mail not configured), so no reader is
 * ever asked for an address that would go nowhere.
 *
 * The address goes to /api/subscribe and nowhere else. The analytics event
 * (subscribe_request) carries only which form it was, never the address.
 * Every valid request gets the same answer from the server, so the message
 * here is the same whether the address was new or already on the list.
 *
 * Browser storage (all optional, and the form works without it):
 *   it.sunday     'requested' once this browser asked; the offer stops showing
 *   it.sundayNo   when "Not now" was pressed; the offer rests for 30 days
 */
(function () {
  if (window.ITSignup) return;
  function itm() { (window.ITMetricsQ = window.ITMetricsQ || []).push([].slice.call(arguments)); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var REST = 30 * 86400000;
  var openP = null;
  function isOpen() {
    if (!openP) openP = fetch('/api/subscribe', { credentials: 'omit' })
      .then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.open); })
      .catch(function () { return false; });
    return openP;
  }
  var CSS = '.it-sub{border:1px solid var(--line,#d4dde3);border-radius:10px;padding:16px 18px;margin:18px 0;background:#fff;max-width:640px}'
    + '.it-sub-h{margin:0 0 4px;font-weight:700;font-size:17px;color:var(--text,#1a2129)}'
    + '.it-sub-p{margin:0 0 12px;font-size:14.5px;color:var(--sec,#566)}'
    + '.it-sub-row{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 10px}'
    + '.it-sub-row label{display:flex;flex-direction:column;gap:4px;font-size:13.5px;color:var(--sec,#566);flex:1 1 220px}'
    + '.it-sub-row label.it-sub-sc{flex:0 1 150px}'
    + '.it-sub input[type=email],.it-sub select{font:inherit;font-size:16px;padding:9px 10px;border:1px solid var(--line,#d4dde3);border-radius:8px;background:#fff;color:var(--text,#1a2129);width:100%;box-sizing:border-box}'
    + '.it-sub-ok{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--text,#1a2129);margin:0 0 12px}'
    + '.it-sub-ok input{margin-top:3px;width:18px;height:18px;flex:none}'
    + '.it-sub-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}'
    + '.it-sub-btns{display:flex;flex-wrap:wrap;gap:10px;align-items:center}'
    + '.it-sub button{font:inherit;font-size:15.5px;font-weight:700;padding:10px 18px;border-radius:8px;border:0;background:var(--teal,#0a7d6a);color:#fff;cursor:pointer}'
    + '.it-sub button.it-sub-no{background:transparent;color:var(--sec,#566);font-weight:400;border:1px solid var(--line,#d4dde3)}'
    + '.it-sub button:focus-visible,.it-sub input:focus-visible,.it-sub select:focus-visible{outline:2px solid var(--teal,#0a7d6a);outline-offset:2px}'
    + '.it-sub button[disabled]{opacity:.6;cursor:default}'
    + '.it-sub-msg{margin:10px 0 0;font-size:14.5px;min-height:1em}'
    + '.it-sub-msg.err{color:#b3261e}.it-sub-msg.ok{color:var(--teal,#0a7d6a)}'
    + '.it-sub-fine{margin:10px 0 0;font-size:12.5px;color:var(--muted,#8595a1)}';
  function style() {
    if (document.getElementById('itSubCss')) return;
    var s = document.createElement('style'); s.id = 'itSubCss'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  var n = 0;
  var SAY = {
    invalid: 'That does not look like an email address.',
    consent: 'Tick the box to say you want the email.',
    rate: 'Too many requests from here. Try again in a few minutes.',
    busy: 'Sign-ups are busy. Try again in an hour.',
    closed: 'Sign-ups are closed right now.',
    send_failed: 'The confirmation email could not be sent. Try again in a minute.',
    jurisdiction_unavailable: 'The Sunday email covers betting-market figures and is not available in Washington.'
  };
  function preset() {
    var s = get('it.hmScoring');
    return /^(ppr|half|standard)$/.test(s || '') ? s : 'ppr';
  }
  function draw(el, o, dismissable) {
    style();
    var id = 'itSub' + (++n);
    var f = document.createElement('form');
    f.className = 'it-sub'; f.noValidate = true; f.setAttribute('aria-labelledby', id + 'h');
    f.innerHTML = '<p class="it-sub-h" id="' + id + 'h">The Sunday email</p>'
      + '<p class="it-sub-p">Get the five biggest Vegas-versus-expert fantasy differences every Sunday morning, at your scoring. Fewer when fewer qualify.</p>'
      + '<div class="it-sub-row"><label>Email<input type="email" name="email" autocomplete="email" required inputmode="email" spellcheck="false"></label>'
      + '<label class="it-sub-sc">Scoring<select name="scoring"><option value="ppr">PPR</option><option value="half">Half PPR</option><option value="standard">Standard</option></select></label></div>'
      + '<label class="it-sub-ok"><input type="checkbox" name="consent" required> <span>Email me the Sunday edition. I can unsubscribe from any edition.</span></label>'
      + '<div class="it-sub-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>'
      + '<div class="it-sub-btns"><button type="submit">Sign up</button>' + (dismissable ? '<button type="button" class="it-sub-no">Not now</button>' : '') + '</div>'
      + '<p class="it-sub-msg" role="status" aria-live="polite"></p>'
      + '<p class="it-sub-fine">Free. Nothing is sent until you confirm from the email we send. The address is used for this email only. <a href="/privacy">Privacy</a>.</p>';
    f.scoring.value = preset();
    var msg = f.querySelector('.it-sub-msg');
    var say = function (t, cls) { msg.textContent = t; msg.className = 'it-sub-msg' + (cls ? ' ' + cls : ''); };
    var no = f.querySelector('.it-sub-no');
    if (no) no.addEventListener('click', function () { put('it.sundayNo', String(Date.now())); f.remove(); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = String(f.email.value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { say(SAY.invalid, 'err'); f.email.focus(); return; }
      if (!f.consent.checked) { say(SAY.consent, 'err'); f.consent.focus(); return; }
      var b = f.querySelector('button[type=submit]');
      b.disabled = true; say('Sending…');
      fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ email: email, scoring: f.scoring.value, consent: true, tool: o.tool || 'unknown', website: f.website.value }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          b.disabled = false;
          if (j && j.ok) {
            put('it.sunday', 'requested');
            itm('event', 'subscribe_request', o.tool || 'unknown', 'sunday', { scoring: f.scoring.value });
            f.email.value = ''; f.consent.checked = false;
            say('Check your inbox for a confirmation link. Nothing is sent until you use it.', 'ok');
            return;
          }
          say(SAY[j && j.error] || 'That did not go through. Try again in a minute.', 'err');
        })
        .catch(function () { b.disabled = false; say('That did not go through. Try again in a minute.', 'err'); });
    });
    el.appendChild(f);
    return f;
  }
  // The permanent form. When sign-ups are closed it says so, plainly, rather
  // than drawing a form that would go nowhere.
  function mount(el, o) {
    if (!el) return;
    o = o || {};
    isOpen().then(function (open) {
      if (open) { draw(el, o, false); return; }
      var p = document.createElement('p');
      p.className = 'it-sub-closed';
      p.textContent = 'Sign-ups for the Sunday email are not open yet. The current differences are on the board in the meantime.';
      el.appendChild(p);
    });
  }
  // After a useful result: only while open, never once this browser has asked,
  // and not again for 30 days after "Not now".
  function offer(el, o) {
    if (!el || el.getAttribute('data-it-sub') === '1') return;
    if (get('it.sunday') === 'requested') return;
    var no = Number(get('it.sundayNo') || 0);
    if (no && Date.now() - no < REST) return;
    el.setAttribute('data-it-sub', '1');
    isOpen().then(function (open) { if (open) draw(el, o || {}, true); });
  }
  window.ITSignup = { mount: mount, offer: offer };
})();
