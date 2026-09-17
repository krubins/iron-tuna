/* Iron Tuna — the in-season widgets that appear on more than one page.
 *
 * The "save my league" form is on the hub (/in-season §03) and on /my-league.
 * Written twice it would drift, and a form that writes a slightly
 * different record on one page than the other is worse than no form: every
 * board downstream reads the record and would quietly re-score itself wrong.
 *
 * The prediction-markets waiting list lived here too, behind the panel on the
 * hub and at the foot of /wagers. Both are retired; the form went with them.
 *
 * THE IMPORTER is the draft app's, carried over. importer() renders the cheat
 * sheet's intake — a screenshot read by OCR in the browser, a paste of the
 * platform's settings page, one-tap presets, and the draft room's own league —
 * as a PREVIEW of what was detected that the reader applies or ignores. It is
 * mounted twice: in the league form below, and on /my-league inside the by-hand
 * league form, where the alternative was typing three scoring numbers and
 * thirteen roster boxes. It is a widget rather than a form of its own precisely
 * because those two hosts store their leagues in different places — this one
 * hands back a partial and has no opinion about where it lands.
 *
 * ITInSeason (it-inseason.js) owns the record and the vocabulary;
 * ITInSeasonImport (it-inseason-import.js) owns the reading. This file owns only
 * the markup and the events. Load them in that order; the importer block hides
 * itself where its file is not loaded, and the form still works.
 *
 *   ITInSeasonUI.leagueForm(el)      the form, or the saved card, into el
 *   ITInSeasonUI.importer(el, opts)  the import widget, calling opts.onApply
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
  function all(el, sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); }

  // ── the importer ──────────────────────────────────────────────────────────
  // opts.onApply(partial, source, count)  required; the host decides what a
  //                        partial means, and gets the wording of the preview
  // opts.title             the heading, default "Copy your league in"
  // opts.note              a line under the heading, for the host's own caveat
  function importer(el, opts) {
    if (!el) return;
    var IMP = root.ITInSeasonImport;
    if (!IMP) { el.innerHTML = ''; return; }
    var o = opts || {};
    var onApply = typeof o.onApply === 'function' ? o.onApply : function () {};

    var fromDraft = null;
    try { fromDraft = IMP.fromDraftApp(); } catch (e) { fromDraft = null; }

    var tabs = [];
    if (fromDraft) tabs.push(['draft', 'From my cheat sheet']);
    tabs.push(['screenshot', 'Upload a screenshot']);
    tabs.push(['paste', 'Paste / describe in text']);
    tabs.push(['manual', 'Quick presets']);

    var tab = tabs[0][0];
    var preview = null;   // { items, partial, source }
    var status = o.status || '';
    var pasted = '';

    // One chip per rule. A paste that says "Half-PPR" at the top and "Reception
    // 0.5" further down has named one rule twice, and the parser records both
    // readings on purpose — the reader does not need to see it twice, and the
    // LAST reading is the one that ended up in the settings.
    function chips(items) {
      var order = [], seen = {};
      (items || []).forEach(function (it) {
        var k = String(it[0]);
        if (!(k in seen)) order.push(k);
        seen[k] = it[1];
      });
      return order.map(function (k) { return [k, seen[k]]; });
    }

    function show(partial, source) {
      preview = { items: chips(partial && partial.items), partial: partial, source: source };
      status = preview.items.length ? '' : 'Nothing detected. Try another method, or set the fields below by hand.';
      render();
    }
    function say(msg) { status = msg; render(); }

    function doPaste() {
      pasted = $(el, '[data-paste]') ? $(el, '[data-paste]').value : pasted;
      show(IMP.parseText(pasted), 'pasted text');
    }
    function doImage(file) {
      if (!file) return;
      preview = null;
      say('Loading OCR…');
      IMP.fromImage(file, say).then(function (res) {
        show(res, 'screenshot');
        if (!res.items.length) say('Could not read a league from that image. Try a tighter crop, or paste the text.');
      }).catch(function () {
        say('OCR could not load. Paste the text instead.');
      });
    }
    // Applied, not saved. The reader sees what landed in the fields and is the
    // one who commits it — the same order the draft app uses, and the reason a
    // bad OCR read costs a glance rather than a season of wrong numbers.
    function apply() {
      if (!preview) return;
      var n = preview.items.length, src = preview.source;
      onApply(preview.partial, src, n);
      preview = null;
      status = 'Applied ' + n + ' setting' + (n === 1 ? '' : 's') + ' from ' + src + '. Check them below, then save.';
      render();
    }

    function body() {
      if (tab === 'draft') {
        return '<p class="is-imp-hint">Your cheat sheet is set up in this browser. This copies its scoring and its starting lineup across — every yardage divisor and touchdown value, not just the three presets.</p>' +
          '<button type="button" class="is-btn sec" data-copy>Copy my draft settings</button>';
      }
      if (tab === 'paste') {
        return '<p class="is-imp-hint">Paste your league&rsquo;s settings page &mdash; scoring, and the starting lineup with it. Plain lines are enough: &ldquo;Passing TD 4&rdquo;, &ldquo;Reception 0.5&rdquo;, &ldquo;QB, RB, RB, WR, WR, TE, FLEX, K, DEF, BN&rdquo;.</p>' +
          '<textarea class="is-input is-imp-text" data-paste rows="7" placeholder="Passing TD: 4&#10;Interception: -2&#10;Reception: 0.5&#10;QB 1 / RB 2 / WR 3 / TE 1 / FLEX 1 / K 1 / DEF 1 / BN 6">' + esc(pasted) + '</textarea>' +
          '<button type="button" class="is-btn sec" data-detect>Detect my settings</button>';
      }
      if (tab === 'screenshot') {
        return '<p class="is-imp-hint">Upload a screenshot of your league&rsquo;s settings page. It is read <b>in your browser</b> and never uploaded &mdash; a tight, high-contrast crop reads best.</p>' +
          '<button type="button" class="is-btn sec" data-pick>Choose screenshot</button>' +
          '<input type="file" accept="image/*" data-file hidden>';
      }
      return '<p class="is-imp-hint">One tap for the common settings, then adjust below.</p>' +
        '<div class="is-imp-presets">' +
          '<button type="button" class="is-btn ghost" data-preset="std">Standard (0)</button>' +
          '<button type="button" class="is-btn ghost" data-preset="half">Half-PPR (0.5)</button>' +
          '<button type="button" class="is-btn ghost" data-preset="ppr">Full PPR (1)</button>' +
          '<button type="button" class="is-btn ghost" data-preset="pass4">Pass TD = 4</button>' +
          '<button type="button" class="is-btn ghost" data-preset="pass6">Pass TD = 6</button>' +
          '<button type="button" class="is-btn ghost" data-preset="tep">TE premium</button>' +
          '<button type="button" class="is-btn ghost" data-preset="superflex">Superflex</button>' +
        '</div>';
    }

    function render() {
      el.innerHTML =
        '<div class="is-imp">' +
          '<div class="is-imp-head"><b>' + esc(o.title || 'Copy your league in') + '</b>' +
            (o.note ? '<span>' + esc(o.note) + '</span>' : '') + '</div>' +
          '<div class="is-imp-tabs" role="group">' + tabs.map(function (t) {
            return '<button type="button" class="is-imp-tab' + (t[0] === tab ? ' active' : '') +
              '" data-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(t[1]) + '</button>';
          }).join('') + '</div>' +
          '<div class="is-imp-body">' + body() + '</div>' +
          (status ? '<p class="is-imp-status">' + esc(status) + '</p>' : '') +
          (preview ? '<div class="is-imp-preview"><span class="is-imp-from">Detected from ' + esc(preview.source) + ':</span>' +
            (preview.items.length
              ? preview.items.map(function (it) { return '<span class="is-imp-chip">' + esc(it[0]) + ' <b>' + esc(it[1]) + '</b></span>'; }).join('')
              : '<span class="is-imp-from">nothing detected</span>') +
            (preview.items.length ? '<div class="is-btns"><button type="button" class="is-btn primary" data-apply>Apply these settings</button>' +
              '<button type="button" class="is-btn ghost" data-discard>Discard</button></div>' : '') +
            '</div>' : '') +
        '</div>';

      all(el, '[data-tab]').forEach(function (b) {
        b.addEventListener('click', function () {
          tab = b.getAttribute('data-tab');
          preview = null; status = '';
          render();
        });
      });
      var t;
      if ((t = $(el, '[data-detect]'))) t.addEventListener('click', doPaste);
      if ((t = $(el, '[data-copy]'))) t.addEventListener('click', function () { show(fromDraft, 'your cheat sheet'); });
      if ((t = $(el, '[data-pick]'))) t.addEventListener('click', function () { $(el, '[data-file]').click(); });
      if ((t = $(el, '[data-file]'))) t.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        doImage(f);
      });
      if ((t = $(el, '[data-apply]'))) t.addEventListener('click', apply);
      if ((t = $(el, '[data-discard]'))) t.addEventListener('click', function () { preview = null; status = ''; render(); });
      all(el, '[data-preset]').forEach(function (b) {
        b.addEventListener('click', function () { show(IMP.preset(b.getAttribute('data-preset')), 'a preset'); });
      });
      // Typing survives a re-render: the textarea is rebuilt on every status
      // change, and a reader whose paste vanished when the OCR tab was touched
      // would reasonably conclude the whole widget had eaten it.
      if ((t = $(el, '[data-paste]'))) t.addEventListener('input', function () { pasted = t.value; });
    }

    render();
  }

  // ── the league form ───────────────────────────────────────────────────────
  function leagueForm(el) {
    if (!el) return;
    var L = root.ITInSeason;
    if (!L) { el.innerHTML = '<p class="is-empty">Could not read your saved settings in this browser.</p>'; return; }

    // The scoring fields the form prints, in the order a platform prints them.
    // Every one of them is a rule leagues really do vary; the rest of
    // SCORING_DEFAULTS is carried through an import untouched but not typed.
    var FIELDS = [
      ['passingYardsPerPoint', 'Passing yds / pt', 1],
      ['passingTD', 'Passing TD', 0.5],
      ['passingInt', 'Interception', 0.5],
      ['rushingYardsPerPoint', 'Rushing yds / pt', 1],
      ['rushingTD', 'Rushing TD', 0.5],
      ['receivingYardsPerPoint', 'Receiving yds / pt', 1],
      ['receivingTD', 'Receiving TD', 0.5],
      ['receptionPoints', 'Reception', 0.5],
      ['rbReceptionPoints', 'RB reception', 0.5],
      ['fumbleLost', 'Fumble lost', 0.5]
    ];

    function saved() {
      var rec = L.get();
      el.innerHTML =
        '<div class="is-card">' +
          '<span class="is-tag is-live">Saved</span>' +
          '<h3>' + esc(L.summary()) + '</h3>' +
          '<p>Every number in this section now reads at these settings. Change them any time.</p>' +
          (L.lineupLabel() ? '<p class="is-note" style="margin-top:8px">Lineup: ' + esc(L.lineupLabel()) + '</p>' : '') +
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

    // The slot boxes. Same thirteen the by-hand league form on /my-league prints
    // and the same the server stores, so a reader who later connects the league
    // is looking at the same lineup in the same order.
    function slots(roster) {
      var r = roster || L.defaultRoster();
      return '<div class="is-slots">' + L.SLOTS.map(function (s) {
        return '<label class="is-slot">' + esc(L.SLOT_LABEL[s]) +
          '<input class="is-input" type="number" min="0" max="20" data-ro="' + s + '" value="' + esc(Number(r[s]) || 0) + '"></label>';
      }).join('') + '</div>' +
      '<p class="is-hint" data-rsum>' + esc(sumLine(r)) + '</p>';
    }
    function sumLine(r) {
      var total = L.rosterSum(r);
      var bench = Number(r.BN) || 0, ir = (Number(r.IR) || 0) + (Number(r.TAXI) || 0);
      return total + ' slots — ' + (total - bench - ir) + ' starting, ' + bench + ' bench' + (ir ? ', ' + ir + ' reserve' : '');
    }

    // What is in the form right now, as a record. An import must not throw away
    // a FAAB budget the reader typed thirty seconds ago and has not saved yet.
    function readForm(v) {
      var f = $(el, 'form');
      if (!f) return v;
      var pick = function (n) { var r = f.querySelector('input[name="' + n + '"]:checked'); return r ? r.value : null; };
      var out = {
        platform: pick('platform'), scoring: pick('scoring'),
        teams: f.teams.value, faab: f.faab.value, ref: f.ref.value,
        settings: { scoring: {}, extras: { tePremium: 0 }, roster: null }
      };
      if (f.querySelector('[data-sc]')) {
        all(f, '[data-sc]').forEach(function (i) {
          var n = parseFloat(i.value);
          if (isFinite(n)) out.settings.scoring[i.getAttribute('data-sc')] = n;
        });
        var te = parseFloat((f.querySelector('[data-te]') || {}).value);
        out.settings.extras.tePremium = isFinite(te) ? te : 0;
      } else if (v && v.settings) {
        out.settings.scoring = v.settings.scoring;
        out.settings.extras = v.settings.extras;
      }
      if (f.querySelector('[data-ro]')) {
        var roster = L.emptyRoster();
        all(f, '[data-ro]').forEach(function (i) {
          roster[i.getAttribute('data-ro')] = Math.max(0, parseInt(i.value, 10) || 0);
        });
        out.settings.roster = roster;
      } else if (v && v.settings) {
        out.settings.roster = v.settings.roster;
      }
      // Scoring the form does not print — a yardage bonus ladder off a
      // screenshot, say — rides along rather than being dropped on the next
      // keystroke in an unrelated box.
      if (v && v.settings && v.settings.scoring) {
        for (var k in v.settings.scoring) {
          if (v.settings.scoring.hasOwnProperty(k) && out.settings.scoring[k] === undefined) {
            out.settings.scoring[k] = v.settings.scoring[k];
          }
        }
      }
      return out;
    }

    function form(vals, impStatus) {
      var v = L.normalize(vals || L.draft());
      var s = v.settings;
      var open = !!s;
      var scOf = function (k) { return s && s.scoring[k] !== undefined ? s.scoring[k] : L.SCORING_DEFAULTS[k]; };

      el.innerHTML =
        '<form class="is-form" novalidate>' +
          '<div data-imp></div>' +
          '<div class="is-field"><label id="lbPlat">Platform</label>' + seg('platform', L.PLATFORMS, v.platform) + '</div>' +
          '<div class="is-field"><label id="lbSc">Scoring</label>' + seg('scoring', L.SCORINGS, v.scoring) + '</div>' +
          '<div class="is-row2">' +
            '<div class="is-field"><label for="lgTeams">Teams</label>' +
              '<input class="is-input" id="lgTeams" name="teams" type="number" inputmode="numeric" min="4" max="20" value="' + esc(v.teams) + '"></div>' +
            '<div class="is-field"><label for="lgFaab">FAAB budget ($)</label>' +
              '<input class="is-input" id="lgFaab" name="faab" type="number" inputmode="numeric" min="0" step="1" value="' + esc(v.faab) + '"></div>' +
          '</div>' +
          '<details class="is-more"' + (open ? ' open' : '') + '><summary>Exact scoring <small>' +
              (s ? 'your own rules' : 'optional — the preset above is the default') + '</small></summary>' +
            '<div class="is-grid4">' + FIELDS.map(function (f) {
              return '<label class="is-slot wide">' + esc(f[1]) +
                '<input class="is-input" type="number" step="' + f[2] + '" data-sc="' + f[0] + '" value="' + esc(scOf(f[0])) + '"></label>';
            }).join('') +
            '<label class="is-slot wide">TE premium<input class="is-input" type="number" step="0.25" min="0" data-te value="' +
              esc(s && s.extras ? s.extras.tePremium : 0) + '"></label></div>' +
            '<p class="is-hint">A tight-end premium is the extra per catch, on top of the reception above.</p>' +
          '</details>' +
          '<details class="is-more"' + (s && s.roster ? ' open' : '') + '><summary>Starting lineup <small>' +
              (s && s.roster ? esc(L.labelRoster(s.roster)) : 'optional — 1QB / 2RB / 2WR / TE / FLEX / K / DEF by default') + '</small></summary>' +
            slots(s && s.roster) +
          '</details>' +
          '<div class="is-field"><label for="lgRef">League URL or ID <small>(optional &mdash; lets the FAAB Advisor read your rosters and transaction log)</small></label>' +
            '<input class="is-input" id="lgRef" name="ref" type="text" autocomplete="off" placeholder="sleeper.com/leagues/&hellip;" value="' + esc(v.ref || '') + '"></div>' +
          '<div class="is-submit">' +
            '<button type="submit" class="is-btn primary">Save my league</button>' +
            '<span class="is-hint">Stored in this browser only.</span>' +
          '</div>' +
        '</form>';

      // The whole form is re-rendered around the applied values, which takes the
      // importer's own status node with it — so the message it would have shown
      // is handed to the widget that replaces it.
      importer($(el, '[data-imp]'), {
        note: 'Scoring and lineup, off a screenshot, a paste, or the cheat sheet you already built.',
        status: impStatus || '',
        onApply: function (partial, source, n) {
          form(L.apply(readForm(v), partial),
            'Applied ' + n + ' setting' + (n === 1 ? '' : 's') + ' from ' + source + '. Check them below, then save.');
        }
      });

      // The preset and the reception fields are two readings of one rule, so
      // moving the preset moves them. The fields still win on save: they are the
      // finer instrument, and a reader who typed 0.75 meant 0.75.
      all(el, 'input[name="scoring"]').forEach(function (r) {
        r.addEventListener('change', function () {
          var rec = r.value === 'PPR' ? 1 : r.value === 'Half PPR' ? 0.5 : 0;
          ['receptionPoints', 'rbReceptionPoints'].forEach(function (k) {
            var i = $(el, '[data-sc="' + k + '"]');
            if (i) i.value = rec;
          });
        });
      });
      all(el, '[data-ro]').forEach(function (i) {
        i.addEventListener('input', function () {
          var roster = L.emptyRoster();
          all(el, '[data-ro]').forEach(function (j) { roster[j.getAttribute('data-ro')] = Math.max(0, parseInt(j.value, 10) || 0); });
          var line = $(el, '[data-rsum]');
          if (line) line.textContent = sumLine(roster);
        });
      });

      $(el, 'form').addEventListener('submit', function (e) {
        e.preventDefault();
        L.save(readForm(v));
        saved();
      });
    }

    if (L.has()) saved(); else form(null);
  }

  root.ITInSeasonUI = { leagueForm: leagueForm, importer: importer, esc: esc };
})(window, document);
