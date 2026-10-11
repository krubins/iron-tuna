/* Iron Tuna — the NFL week, shared by every in-season page.
 *
 * One answer to "what week is it", fetched once and shared, so no two pages on
 * this site can disagree about the week a reader is in. The visible clock strip
 * this file used to paint on each page came off on 2026-10-10 (Ken: remove the
 * NFL clock); what stays is the one read the page scripts date themselves by. The answer itself is
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
 *   ITSeason.load(function (s, err) { … })  the raw payload
 *   ITSeason.get()                          the payload once loaded, else null
 */
(function (root) {
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
                       postponed: 'Postponed', canceled: 'Canceled' };
  function statusLabel(s) { return STATUS_LABEL[s] || s; }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  root.ITSeason = {
    load: load, get: get, error: error,
    kickoff: kickoff, dayLabel: dayLabel, until: until,
    statusLabel: statusLabel, esc: esc
  };
})(window);
