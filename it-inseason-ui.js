/* Iron Tuna — the two in-season widgets that appear on more than one page.
 *
 * The "save my league" form is on the hub (/in-season §03) and on /my-league,
 * and the prediction-markets waiting list is on the hub (§04) and at the foot
 * of /wagers. Written twice they would drift, and a form that writes a slightly
 * different record on one page than the other is worse than no form: every
 * board downstream reads the record and would quietly re-score itself wrong.
 *
 * ITInSeason (it-inseason.js) owns the record; this file owns only the markup
 * and the events. Load both, in that order.
 *
 *   ITInSeasonUI.leagueForm(el)      the form, or the saved card, into el
 *   ITInSeasonUI.notify(el, topic)   the waiting-list form, or its done state
 *   ITInSeasonUI.esc(s)              escape, for the pages' own renderers
 */
(function (root, doc) {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(el, sel) { return el.querySelector(sel); }

  // ── the league form ───────────────────────────────────────────────────────
  function leagueForm(el) {
    if (!el) return;
    var L = root.ITInSeason;
    if (!L) { el.innerHTML = '<p class="is-empty">Could not read your saved settings in this browser.</p>'; return; }

    function saved() {
      var rec = L.get();
      el.innerHTML =
        '<div class="is-card">' +
          '<span class="is-tag is-live">Saved</span>' +
          '<h3>' + esc(L.summary()) + '</h3>' +
          '<p>Every number in this section now reads at these settings. Change them any time.</p>' +
          (rec.ref ? '<p class="is-note" style="margin-top:8px">League: ' + esc(rec.ref) + '</p>' : '') +
          '<div class="is-btns"><button type="button" class="is-btn sec" data-edit>Edit settings</button></div>' +
        '</div>';
      $(el, '[data-edit]').addEventListener('click', function () { form(L.get()); });
    }

    function seg(name, list, current) {
      return '<div class="is-seg" role="group">' + list.map(function (v) {
        return '<label><input type="radio" name="' + name + '" value="' + esc(v) + '"' +
               (v === current ? ' checked' : '') + '>' + esc(v) + '</label>';
      }).join('') + '</div>';
    }

    function form(vals) {
      var v = vals || L.draft();
      el.innerHTML =
        '<form class="is-form" novalidate>' +
          '<div class="is-field"><label id="lbPlat">Platform</label>' + seg('platform', L.PLATFORMS, v.platform) + '</div>' +
          '<div class="is-field"><label id="lbSc">Scoring</label>' + seg('scoring', L.SCORINGS, v.scoring) + '</div>' +
          '<div class="is-row2">' +
            '<div class="is-field"><label for="lgTeams">Teams</label>' +
              '<input class="is-input" id="lgTeams" name="teams" type="number" inputmode="numeric" min="4" max="20" value="' + v.teams + '"></div>' +
            '<div class="is-field"><label for="lgFaab">FAAB budget ($)</label>' +
              '<input class="is-input" id="lgFaab" name="faab" type="number" inputmode="numeric" min="0" step="1" value="' + v.faab + '"></div>' +
          '</div>' +
          '<div class="is-field"><label for="lgRef">League URL or ID <small>(optional &mdash; lets the FAAB Advisor read your rosters and transaction log)</small></label>' +
            '<input class="is-input" id="lgRef" name="ref" type="text" autocomplete="off" placeholder="sleeper.com/leagues/&hellip;" value="' + esc(v.ref || '') + '"></div>' +
          '<div class="is-submit">' +
            '<button type="submit" class="is-btn primary">Save my league</button>' +
            '<span class="is-hint">Stored in this browser only.</span>' +
          '</div>' +
        '</form>';
      $(el, 'form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        var pick = function (n) { var r = f.querySelector('input[name="' + n + '"]:checked'); return r ? r.value : null; };
        L.save({
          platform: pick('platform'), scoring: pick('scoring'),
          teams: f.teams.value, faab: f.faab.value, ref: f.ref.value
        });
        saved();
      });
    }

    if (L.has()) saved(); else form(null);
  }

  // ── the waiting list ──────────────────────────────────────────────────────
  // Validates, POSTs, and remembers locally that it asked, so a reader who has
  // already answered is not asked again on the other page that carries it.
  // A failed POST says so and keeps the address in the box: silently swapping
  // to the success state would promise an email nobody is going to send.
  function notify(el, topic) {
    if (!el) return;
    var L = root.ITInSeason;
    if (!L) return;
    topic = topic || 'markets';

    function done(email) {
      el.innerHTML =
        '<span class="is-tag is-live">You are on the list</span>' +
        '<p class="is-note" style="margin-top:8px">We will email <b>' + esc(email) + '</b> the day the markets panel opens. Nothing else until then.</p>';
    }

    function form(prefill, err) {
      el.innerHTML =
        '<form class="is-form" novalidate style="background:none;border:0;padding:0">' +
          '<div class="is-field"><label for="pmEmail">Notify me when it opens</label>' +
            '<input class="is-input" id="pmEmail" name="email" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(prefill || '') + '"></div>' +
          '<div class="is-submit">' +
            '<button type="submit" class="is-btn primary">Notify me</button>' +
            '<span class="is-hint' + (err ? ' err' : '') + '">' + esc(err || 'One email, when it opens. No list, no newsletter.') + '</span>' +
          '</div>' +
        '</form>';
      $(el, 'form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, email = String(f.email.value || '').trim();
        if (!L.validEmail(email)) { form(email, 'That does not look like an email address.'); return; }
        var btn = $(el, 'button'); btn.disabled = true; btn.textContent = 'Sending…';
        fetch('/api/notify', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email, topic: topic })
        }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
          .then(function (j) {
            if (j && j.ok) { L.setNotified(email); done(email); }
            else form(email, 'That did not go through. Try again in a moment.');
          })
          .catch(function () { form(email, 'That did not go through. Try again in a moment.'); });
      });
    }

    var already = L.notified();
    if (already) done(already); else form('', null);
  }

  root.ITInSeasonUI = { leagueForm: leagueForm, notify: notify, esc: esc };
})(window, document);
