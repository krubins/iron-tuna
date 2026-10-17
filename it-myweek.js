/* Iron Tuna — My Week's "since your last visit" (growth plan Phase 4,
 * 17 Oct 2026).
 *
 * A returning reader's first question is what moved since they last looked.
 * This keeps one small snapshot per saved league in this browser (never on
 * the server: it is a reading aid, not a record) and compares the next visit
 * against it. Only changes the data supports and a manager would act on:
 *
 *   injury       a rostered player's designation appeared, changed or cleared
 *   lineup       a player moved into or out of the best lineup
 *   roster       a player was added to or dropped from the saved roster
 *   projection   a starter's projection moved 2 points AND 20% or more
 *
 * Two things reset rather than compare. A new NFL week is a new baseline,
 * because last week's projections are not this week's. A changed scoring
 * restates every number, so projection moves are not reported that visit
 * (the other kinds still are) and the change itself is said.
 *
 *   ITMyWeek.snapshot(lineupPayload, meta)  -> snapshot | null
 *   ITMyWeek.diff(prev, cur)                -> { baseline, reason, items[], prevAt }
 *   ITMyWeek.load(leagueId) / save(leagueId, snap)   (storage may throw; both guard)
 */
(function (root) {
  'use strict';
  var KEY = 'it.mw.snap.', V = 1, MAX = 8;
  var PROJ_PTS = 2, PROJ_PCT = 0.2;

  function r1(v) { return Math.round(Number(v) * 10) / 10; }
  function healthy(s) { return !s || /^(active|probable)$/i.test(String(s)); }

  function snapshot(lu, meta) {
    if (!lu || !lu.ok || !Array.isArray(lu.lineup)) return null;
    var m = meta || {}, roster = {};
    var put = function (p, start) {
      if (!p || !p.name) return;
      var k = p.key || p.name;
      roster[k] = { n: p.name, pos: p.position || null, start: !!start, pts: p.projected == null ? null : r1(p.projected), inj: healthy(p.injury) ? null : String(p.injury) };
    };
    lu.lineup.forEach(function (s) { if (!s.empty) put(s, true); });
    (lu.bench || []).forEach(function (b) { put(b, false); });
    (lu.reserve || []).forEach(function (b) { put(b, false); });
    return { v: V, at: m.now || Date.now(), week: lu.week != null ? lu.week : null, scoring: m.scoring || lu.scoring || null, roster: roster };
  }

  function diff(prev, cur) {
    if (!cur) return { baseline: true, reason: 'none', items: [], prevAt: null };
    if (!prev || prev.v !== V || !prev.roster) return { baseline: true, reason: 'first', items: [], prevAt: null };
    if (prev.week !== cur.week) return { baseline: true, reason: 'week', items: [], prevAt: prev.at, week: cur.week };
    var items = [], P = prev.roster, C = cur.roster, k;
    var rescored = (prev.scoring || '') !== (cur.scoring || '');
    if (rescored) items.push({ kind: 'scoring', rank: 0, text: 'Your scoring changed (' + (prev.scoring || 'unknown') + ' to ' + (cur.scoring || 'unknown') + '). Every projection is restated, so point moves are not compared this visit.' });
    for (k in C) {
      var c = C[k], p = P[k];
      if (!p) { items.push({ kind: 'roster', rank: 3, text: c.n + ' is new on your saved roster.' }); continue; }
      if ((p.inj || null) !== (c.inj || null)) {
        items.push({ kind: 'injury', rank: 1, text: c.n + ': ' + (c.inj ? 'now ' + c.inj + (p.inj ? ' (was ' + p.inj + ')' : '') : 'no longer listed (was ' + p.inj + ')') + '.' });
      }
      if (p.start !== c.start) items.push({ kind: 'lineup', rank: 2, text: c.n + (c.start ? ' moves into your best lineup.' : ' drops out of your best lineup.') });
      if (!rescored && (c.start || p.start) && p.pts != null && c.pts != null) {
        var d = r1(c.pts - p.pts);
        if (Math.abs(d) >= PROJ_PTS && p.pts > 0 && Math.abs(d) / p.pts >= PROJ_PCT) {
          items.push({ kind: 'projection', rank: 4, text: c.n + ': projection ' + p.pts.toFixed(1) + ' to ' + c.pts.toFixed(1) + ' (' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ').' });
        }
      }
    }
    for (k in P) if (!C[k]) items.push({ kind: 'roster', rank: 3, text: P[k].n + ' is off your saved roster.' });
    items.sort(function (a, b) { return a.rank - b.rank || (a.text < b.text ? -1 : 1); });
    return { baseline: false, reason: rescored ? 'scoring' : 'compared', items: items.slice(0, MAX), more: Math.max(0, items.length - MAX), prevAt: prev.at };
  }

  function load(id) {
    try { var s = JSON.parse(root.localStorage.getItem(KEY + id) || 'null'); return s && s.v === V ? s : null; } catch (e) { return null; }
  }
  function save(id, snap) {
    try { if (snap) root.localStorage.setItem(KEY + id, JSON.stringify(snap)); return true; } catch (e) { return false; }
  }

  root.ITMyWeek = { snapshot: snapshot, diff: diff, load: load, save: save };
})(typeof window !== 'undefined' ? window : this);
