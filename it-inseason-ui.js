/* Iron Tuna — the in-season widget that appears on more than one page.
 *
 * The "save my league" form is on the hub (/in-season §03) and on /my-league.
 * Written twice it would drift, and a form that writes a slightly
 * different record on one page than the other is worse than no form: every
 * board downstream reads the record and would quietly re-score itself wrong.
 *
 * The prediction-markets waiting list lived here too, behind the panel on the
 * hub and at the foot of /wagers. Both are retired; the form went with them.
 *
 * ITInSeason (it-inseason.js) owns the record; this file owns only the markup
 * and the events. Load both, in that order.
 *
 *   ITInSeasonUI.leagueForm(el)      the form, or the saved card, into el
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

  root.ITInSeasonUI = { leagueForm: leagueForm, esc: esc };
})(window, document);
