/* Iron Tuna — the NFL clock, on every in-season page.
 *
 * One answer to "what week is it", fetched once and shared, so no two pages on
 * this site can disagree about the week a reader is in. The answer itself is
 * computed in the worker off the real schedule (see the season section in
 * _worker.js): a week is current until its OWN last game has finished, which is
 * the only rule that survives Thursday openers, 9:30am London kickoffs,
 * Saturday doubleheaders, Monday night, and a postseason made of rounds rather
 * than weekdays.
 *
 * NOTHING HERE INVENTS A WEEK. If /api/season cannot answer, every surface that
 * reads this says so plainly rather than falling back to the calendar, because
 * a wrong week is worse than a missing one: it silently mislabels every number
 * on the page.
 *
 * Usage:
 *   <div data-season-strip></div>           auto-rendered on DOMContentLoaded
 *   ITSeason.load(function (s, err) { … })  the raw payload
 *   ITSeason.get()                          the payload once loaded, else null
 */
(function (root, doc) {
  'use strict';

  var API = '/api/season';
  var MEMO_MS = 60000;          // matches the edge cache on the route
  var state = null, loadedAt = 0, inFlight = null, lastError = null;

  function load(cb) {
    if (state && Date.now() - loadedAt < MEMO_MS) { if (cb) cb(state, null); return; }
    if (!inFlight) {
      inFlight = fetch(API, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : r.json().catch(function () { return { ok: false, error: 'http_' + r.status }; }); })
        .then(function (j) {
          if (j && j.ok) { state = j; loadedAt = Date.now(); lastError = null; }
          else { lastError = (j && j.error) || 'unavailable'; }
          inFlight = null;
          return j;
        })
        .catch(function (e) { lastError = String((e && e.message) || e); inFlight = null; return { ok: false, error: lastError }; });
    }
    inFlight.then(function (j) { if (cb) cb(j && j.ok ? j : null, j && j.ok ? null : ((j && j.error) || lastError)); });
  }
  function get() { return state; }
  function error() { return lastError; }

  // Every time on this site is Eastern, because that is the clock the NFL
  // schedule is written in and the one every fantasy league runs on.
  var ET = 'America/New_York';
  function fmt(ms, opts) {
    try { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: ET }, opts)).format(new Date(ms)); }
    catch (e) { return ''; }
  }
  function kickoff(ms) {
    var d = fmt(ms, { weekday: 'short', month: 'numeric', day: 'numeric' });
    var t = fmt(ms, { hour: 'numeric', minute: '2-digit' });
    return d && t ? d + ', ' + t + ' ET' : '';
  }
  function dayLabel(ms) { return fmt(ms, { weekday: 'long', month: 'long', day: 'numeric' }); }

  // "in 2 days", "in 3 hours", "in 12 minutes". Deliberately coarse: a
  // second-by-second countdown to a Sunday kickoff is motion, not information.
  function until(ms, now) {
    var d = ms - (now || Date.now());
    if (d <= 0) return '';
    var mins = Math.round(d / 60000);
    if (mins < 60) return 'in ' + mins + ' minute' + (mins === 1 ? '' : 's');
    var hrs = Math.round(d / 3600000);
    if (hrs < 36) return 'in ' + hrs + ' hour' + (hrs === 1 ? '' : 's');
    var days = Math.round(d / 86400000);
    return 'in ' + days + ' day' + (days === 1 ? '' : 's');
  }

  var STATUS_LABEL = { upcoming: 'Upcoming', in_progress: 'In progress', completed: 'Final',
                       postponed: 'Postponed', canceled: 'Cancelled' };
  function statusLabel(s) { return STATUS_LABEL[s] || s; }

  // The one line every in-season page opens with: what part of the season it
  // is, which week, and where that week stands.
  function strip(s) {
    if (!s) {
      return '<span class="its-phase its-off">NFL clock unavailable</span>' +
             '<span class="its-note">The schedule feed has not answered. Nothing on this page is dated until it does.</span>';
    }
    var w = s.week || {};
    var bits = [];
    bits.push('<span class="its-phase">' + esc(s.phaseLabel || s.phase || '') + '</span>');
    if (w.label) bits.push('<span class="its-week">' + esc(w.label) + '</span>');
    if (w.status === 'active') {
      var live = (s.counts && s.counts.inProgress) || 0;
      bits.push('<span class="its-state' + (live ? ' its-live' : '') + '">' +
        (live ? live + ' game' + (live === 1 ? '' : 's') + ' in progress' : 'Under way') + '</span>');
    } else if (w.status === 'upcoming' && w.firstKickoff) {
      bits.push('<span class="its-state">Kicks off ' + esc(kickoff(w.firstKickoff)) + '</span>');
    } else if (s.seasonComplete) {
      bits.push('<span class="its-state">Season complete</span>');
    }
    var c = s.counts || {};
    if (w.games) {
      bits.push('<span class="its-counts">' + (c.completed || 0) + ' final &middot; ' +
        (c.inProgress || 0) + ' live &middot; ' + (c.upcoming || 0) + ' to come</span>');
    }
    if (s.nextGame && s.nextGame.kickoff) {
      bits.push('<span class="its-next">Next: ' + esc(s.nextGame.away + ' at ' + s.nextGame.home) +
        ' ' + esc(until(s.nextGame.kickoff, s.now)) + '</span>');
    }
    return bits.join('');
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(el, s) {
    if (!el) return;
    el.innerHTML = strip(s);
    el.setAttribute('data-season-ready', s ? '1' : '0');
    if (s && s.phase) el.setAttribute('data-phase', s.phase);
  }

  function boot() {
    var els = [].slice.call(doc.querySelectorAll('[data-season-strip]'));
    if (!els.length) return;
    els.forEach(function (el) { if (!el.innerHTML.trim()) el.innerHTML = '<span class="its-note">Reading the NFL schedule&hellip;</span>'; });
    load(function (s) { els.forEach(function (el) { render(el, s); }); });
  }

  root.ITSeason = {
    load: load, get: get, error: error,
    kickoff: kickoff, dayLabel: dayLabel, until: until,
    statusLabel: statusLabel, strip: strip, render: render, esc: esc
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
