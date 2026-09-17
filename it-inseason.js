/* Iron Tuna — the reader's in-season league, on every surface that prints a
 * number for it.
 *
 * WHY THIS EXISTS SEPARATELY FROM it-league.js. That file reads the DRAFT app's
 * saved state (`iron_tuna_draft_state_v2`): teams, auction budget, and the full
 * custom scoring the app was configured with. It is the authority for draft
 * dollars and it is written only by the app. In-season needs three things the
 * draft app never asks for — which platform the league is on, the FAAB budget
 * (a waiver-period auction, not the draft one), and a league URL — and it has
 * to be settable by a reader who has never opened the draft app at all. So the
 * in-season section owns its own record here, and BORROWS from the draft one:
 * seed() below fills teams and scoring from ITLeague when nothing is saved, so
 * a reader who set the app up does not type it twice.
 *
 * Nothing here invents a league. get() returns null until the reader has
 * actually saved one, and every surface that reads it says "until you save your
 * league" rather than dressing the site's defaults up as theirs. That is the
 * same rule it-league.js follows and for the same reason.
 *
 * Free, no signup, one browser: this is localStorage and nothing else. It never
 * reaches the server, which is what the copy on every form promises.
 *
 * THE THREE PRESETS WERE NOT A LEAGUE. Until this record grew a `settings`, the
 * only scoring it could hold was PPR / Half / Standard, and /my-league said so
 * out loud: the full scoring "is set up separately, in the draft room". A reader
 * with six-point passing touchdowns, a tight-end premium or a superflex was
 * handed the nearest of three wrong answers, in the section that runs for five
 * months. `settings` carries what the league actually is — every scoring field,
 * the TE premium, and the starting lineup — scoring by SCORING_BASE's names,
 * extras.tePremium, and a roster of SLOT counts. One vocabulary for an
 * in-season league, whether it was entered by hand or copied in off a
 * screenshot by it-inseason-import.js.
 *
 * `scoring` stays, and stays truthful: it is DERIVED from the reception value
 * whenever settings are present, so the headline and the detail cannot drift
 * apart, and a surface that only wants the one-word answer still has it.
 *
 * Usage:
 *   ITInSeason.get()            the saved league, or null
 *   ITInSeason.draft()          get() ?? the seeded defaults, never null
 *   ITInSeason.save(obj)        writes and returns the normalized record
 *   ITInSeason.clear()          forgets it
 *   ITInSeason.faab()           the FAAB budget, defaulting to 100
 *   ITInSeason.settings()       {scoring, extras, roster}, or null
 *   ITInSeason.lineup()         the roster slot counts, or null
 *   ITInSeason.isSuperflex()    does a quarterback fill a second starting slot
 *   ITInSeason.scoringNote()    "Scored at PPR, 12 teams — your saved settings."
 *   ITInSeason.summary()        "Sleeper · 12 teams · PPR · $100 FAAB"
 *   ITInSeason.lineupLabel()    "QB · 2RB · 2WR · TE · FLEX · K · DEF · 6 bench"
 *   ITInSeason.apply(rec, part) a draft record with an import merged into it
 *   ITInSeason.bid(share)       a FAAB share as dollars OF THE READER'S budget
 *   ITInSeason.onChange(fn)     fires on save/clear, and across tabs
 */
(function (root) {
  'use strict';

  var KEY = 'iron_tuna_inseason_league_v1';

  var PLATFORMS = ['Sleeper', 'ESPN', 'Yahoo', 'Other'];
  var SCORINGS = ['PPR', 'Half PPR', 'Standard'];
  var DEFAULTS = { platform: 'Sleeper', scoring: 'PPR', teams: 12, faab: 100, ref: '' };

  // ── the vocabulary of an in-season league ─────────────────────────────────
  // HAND-SYNCED, both of these. SCORING_DEFAULTS is SCORING_BASE in _worker.js
  // and SCORING_DEFAULTS in it-league.js; SLOTS is LEAGUE_SLOT_ELIG's key set.
  // tools/test-inseason-league.mjs lifts all of them and fails when they differ,
  // because a scoring field this file silently drops is a rule the reader set
  // and no board ever honors.
  var SCORING_DEFAULTS = {
    passingYardsPerPoint: 25, passingYardsThreshold: 125, passingTD: 4, passingInt: -2, passing2pt: 2,
    rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingTD: 6, rushing2pt: 2,
    receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingTD: 6, receiving2pt: 2,
    receptionPoints: 1, rbReceptionPoints: 1, fumbleLost: -2, fumble2pt: 2,
    individualFumbleRecoveryTD: 6, individualKickReturnTD: 6, individualPuntReturnTD: 6
  };
  var SCORING_BONUSES = ['passingYardBonuses', 'rushingYardBonuses', 'receivingYardBonuses',
    'receptionBonuses', 'rbReceptionBonuses'];
  var SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLEX', 'REC_FLEX', 'WRRB_FLEX', 'K', 'DEF', 'BN', 'IR', 'TAXI'];
  var SLOT_LABEL = {
    QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', SFLEX: 'SUPERFLEX',
    REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', K: 'K', DEF: 'DEF', BN: 'Bench', IR: 'IR', TAXI: 'Taxi'
  };
  // The lineup the by-hand form starts from, and the one a preset patches. It is
  // the same starting nine _worker.js hands a manual league, so a reader who
  // sets a lineup here and connects the league later sees the same shape twice.
  var ROSTER_DEFAULT = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 };

  function emptyRoster() {
    var r = {};
    for (var i = 0; i < SLOTS.length; i++) r[SLOTS[i]] = 0;
    return r;
  }
  function defaultRoster() {
    var r = emptyRoster();
    for (var k in ROSTER_DEFAULT) if (ROSTER_DEFAULT.hasOwnProperty(k)) r[k] = ROSTER_DEFAULT[k];
    return r;
  }
  function rosterSum(r) {
    var n = 0;
    for (var i = 0; i < SLOTS.length; i++) n += Number(r && r[SLOTS[i]]) || 0;
    return n;
  }
  // "QB · 2RB · 2WR · TE · FLEX · K · DEF · 6 bench". The bench is named rather
  // than folded in silently: a fourteen-slot roster and an eighteen-slot roster
  // play like different games, and the waiver advice differs accordingly.
  function labelRoster(r) {
    if (!r) return '';
    var bits = [];
    ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLEX', 'REC_FLEX', 'WRRB_FLEX', 'K', 'DEF'].forEach(function (s) {
      var n = Number(r[s]) || 0;
      if (n > 0) bits.push((n > 1 ? n : '') + SLOT_LABEL[s]);
    });
    var bn = Number(r.BN) || 0;
    if (bn) bits.push(bn + ' bench');
    return bits.join(' · ');
  }
  // The one-word reading of a reception value, which is what the preset control
  // and every "scored at" line say. Anything between the named values reads as
  // the nearest one rather than inventing a fourth name for it.
  function presetOf(rec) {
    var n = Number(rec);
    if (!isFinite(n)) return null;
    return n >= 0.9 ? 'PPR' : n >= 0.4 ? 'Half PPR' : 'Standard';
  }

  var listeners = [];

  function read(key) {
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, val) {
    try { if (val == null) root.localStorage.removeItem(key); else root.localStorage.setItem(key, val); return true; }
    catch (e) { return false; }
  }

  function oneOf(list, v, fallback) {
    var s = String(v == null ? '' : v).trim();
    for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === s.toLowerCase()) return list[i];
    return fallback;
  }
  function clampInt(v, lo, hi, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  // Settings, made safe whatever came in — a parse of a screenshot, a paste, the
  // draft app's config, or a record written by an older build. Unknown scoring
  // keys are DROPPED rather than carried: nothing on this side of the site can
  // score them, and a field kept where it cannot be honored reads on the form as
  // a promise. (The server keeps them under extras.unsupported, where a synced
  // league can at least say which rules it could not model.)
  //
  // Returns null for "nothing set", never an object full of defaults. A league
  // this file invented would print numbers at settings the reader never chose,
  // which is the one thing neither this file nor it-league.js will do.
  function normalizeSettings(s) {
    if (!s || typeof s !== 'object') return null;
    var scoring = {}, any = false, k, i;
    var src = s.scoring && typeof s.scoring === 'object' ? s.scoring : {};
    for (k in SCORING_DEFAULTS) {
      if (!SCORING_DEFAULTS.hasOwnProperty(k)) continue;
      var n = Number(src[k]);
      if (src[k] !== undefined && src[k] !== null && src[k] !== '' && isFinite(n)) { scoring[k] = n; any = true; }
    }
    for (i = 0; i < SCORING_BONUSES.length; i++) {
      var b = src[SCORING_BONUSES[i]];
      if (Array.isArray(b) && b.length) { scoring[SCORING_BONUSES[i]] = b; any = true; }
    }

    var te = Number(s.extras && s.extras.tePremium);
    var extras = { tePremium: isFinite(te) && te > 0 ? te : 0 };
    if (extras.tePremium) any = true;

    var roster = null;
    if (s.roster && typeof s.roster === 'object') {
      roster = emptyRoster();
      var filled = false;
      for (i = 0; i < SLOTS.length; i++) {
        var v = clampInt(s.roster[SLOTS[i]], 0, 20, 0);
        roster[SLOTS[i]] = v;
        if (v > 0) filled = true;
      }
      if (!filled) roster = null; else any = true;
    }

    return any ? { scoring: scoring, extras: extras, roster: roster } : null;
  }

  // One shape, whatever came in. A record written by an older build, or hand-
  // edited in devtools, still reads as a league rather than throwing on the
  // first page that touches it. A record from BEFORE settings existed carries
  // its preset label and nothing else, and still reads exactly as it did.
  function normalize(o) {
    o = o || {};
    var settings = normalizeSettings(o.settings);
    // The headline follows the detail. A reader who imports 0.5-point receptions
    // and leaves the radio on PPR has said which they mean twice, and the
    // detailed answer is the one they went to the trouble of importing.
    var label = settings && settings.scoring.receptionPoints !== undefined
      ? presetOf(settings.scoring.receptionPoints)
      : null;
    return {
      platform: oneOf(PLATFORMS, o.platform, DEFAULTS.platform),
      scoring: oneOf(SCORINGS, label || o.scoring, DEFAULTS.scoring),
      teams: clampInt(o.teams, 4, 20, DEFAULTS.teams),
      faab: clampInt(o.faab, 0, 100000, DEFAULTS.faab),
      ref: String(o.ref == null ? '' : o.ref).trim().slice(0, 200),
      settings: settings
    };
  }

  // An import merged into a record, returned as a DRAFT for the form to show —
  // this writes nothing. Mirrors applyImport in index.html: scoring fields are
  // merged one by one so a paste that only found the passing rules does not
  // erase the receiving ones, while a lineup arrives whole because half a
  // lineup laid over another league's half is not either league.
  function apply(rec, partial) {
    var base = JSON.parse(JSON.stringify(rec || draft()));
    var p = partial || {};
    var s = base.settings || { scoring: {}, extras: { tePremium: 0 }, roster: null };
    s.scoring = s.scoring || {};
    s.extras = s.extras || { tePremium: 0 };

    var prevRec = s.scoring.receptionPoints, prevRb = s.scoring.rbReceptionPoints;
    if (p.scoring) for (var k in p.scoring) if (p.scoring.hasOwnProperty(k)) s.scoring[k] = p.scoring[k];
    // The running back's catch follows everyone else's unless the league has
    // said otherwise. A paste that reads "Half-PPR" names one reception value,
    // and leaving the RB field where it was would hand the reader a league that
    // pays running backs a full point and receivers half of one — which is a
    // format that exists, but not one anybody arrives at by accident.
    if (p.scoring && p.scoring.receptionPoints != null && p.scoring.rbReceptionPoints == null) {
      var following = prevRb == null || prevRb === (prevRec == null ? SCORING_DEFAULTS.receptionPoints : prevRec);
      if (following) s.scoring.rbReceptionPoints = p.scoring.receptionPoints;
    }
    if (p.extras && p.extras.tePremium != null) s.extras.tePremium = p.extras.tePremium;
    if (p.roster) s.roster = p.roster;
    // A preset patches the lineup it names and leaves the rest alone — "add a
    // superflex" must not also decide how deep the bench is.
    if (p.rosterPatch) {
      s.roster = s.roster || defaultRoster();
      for (var slot in p.rosterPatch) if (p.rosterPatch.hasOwnProperty(slot)) s.roster[slot] = p.rosterPatch[slot];
    }
    base.settings = s;
    if (p.teams) base.teams = p.teams;
    if (p.faab != null) base.faab = p.faab;
    return normalize(base);
  }

  // '\0' is "not read yet", and it has to be a value localStorage can never
  // return so that a genuinely absent record is still a cache MISS the first
  // time. Written as the escape and not as the byte: a raw NUL in the source
  // makes git call this file binary, which costs every diff and every merge on
  // it. (It was one, until 2026-09-16.)
  var cached = null, cachedRaw = '\0';
  function get() {
    var raw = read(KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (!raw) { cached = null; return null; }
    try { cached = normalize(JSON.parse(raw)); } catch (e) { cached = null; }
    return cached;
  }
  function has() { return !!get(); }

  // What to PUT IN THE FORM when nothing is saved. The draft app knows the
  // league size and the scoring already if the reader ever set it up, so the
  // form opens on their league rather than on ours. It is a starting value in
  // an unsaved form, never a number printed as though it were theirs.
  function seed() {
    var out = { platform: DEFAULTS.platform, scoring: DEFAULTS.scoring, teams: DEFAULTS.teams, faab: DEFAULTS.faab, ref: '' };
    var L = root.ITLeague;
    try {
      if (L && L.has && L.config) {
        if (L.config.teams) out.teams = clampInt(L.config.teams, 4, 20, out.teams);
        var s = L.config.scoring;
        if (s && s.receptionPoints != null) {
          out.scoring = s.receptionPoints >= 0.9 ? 'PPR' : s.receptionPoints >= 0.4 ? 'Half PPR' : 'Standard';
        }
      }
    } catch (e) {}
    return out;
  }
  function draft() { return get() || seed(); }

  function save(o) {
    var rec = normalize(o);
    write(KEY, JSON.stringify(rec));
    cachedRaw = '\0';
    emit();
    return rec;
  }
  function clear() { write(KEY, null); cachedRaw = '\0'; emit(); }

  function faab() { var L = get(); return L ? L.faab : DEFAULTS.faab; }
  function teams() { var L = get(); return L ? L.teams : DEFAULTS.teams; }
  function scoring() { var L = get(); return L ? L.scoring : DEFAULTS.scoring; }

  // The detail, for the surfaces that can use it. Null rather than defaults, so
  // a board asking "do I have this reader's actual scoring?" gets an answer
  // instead of the site's own league wearing the reader's name.
  function settings() { var L = get(); return L && L.settings ? L.settings : null; }
  function lineup() { var s = settings(); return s && s.roster ? s.roster : null; }
  function customScoring() { var s = settings(); return s ? s.scoring : null; }
  // A rule the reader set that the three presets cannot say: anything away from
  // the site's defaults other than the reception value, which the preset label
  // already carries. This is what earns the "custom scoring" tag on the card.
  function hasCustomScoring() {
    var s = settings();
    if (!s) return false;
    if (s.extras && s.extras.tePremium) return true;
    for (var k in s.scoring) {
      if (!s.scoring.hasOwnProperty(k)) continue;
      if (k === 'receptionPoints' || k === 'rbReceptionPoints') continue;
      if (SCORING_BONUSES.indexOf(k) >= 0) { if (s.scoring[k].length) return true; continue; }
      if (SCORING_DEFAULTS.hasOwnProperty(k) && s.scoring[k] !== SCORING_DEFAULTS[k]) return true;
    }
    return false;
  }
  // A quarterback fills a second STARTING slot — the one roster fact that
  // re-prices a whole position. Same question index.html asks of the draft
  // league, asked of the in-season one.
  function isSuperflex() {
    var r = lineup();
    return !!r && ((r.SFLEX || 0) > 0 || (r.QB || 0) >= 2);
  }
  function lineupLabel() { return labelRoster(lineup()); }
  function rosterSize() { var r = lineup(); return r ? rosterSum(r) : 0; }

  // A share of the budget, as dollars. The FAAB Advisor's whole point is that
  // "23% of your budget" is not a bid and "$23" is — but only if the $100 it
  // came from is the reader's $100.
  function bid(share) {
    var n = Math.round(faab() * Number(share || 0));
    return isFinite(n) ? n : 0;
  }
  function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }

  // "Custom" earns its place in these lines only when it changes a number: a
  // reader who imported their scoring and landed on plain PPR is reading the
  // same board as one who tapped the preset, and tagging it would teach them to
  // distrust the tag where it does matter. Same rule it-league.js follows.
  function scoringNote() {
    var L = get();
    if (!L) return 'Scored at PPR until you save your league.';
    return 'Scored at ' + L.scoring + (hasCustomScoring() ? ' with your own rules' : '') +
      ', ' + L.teams + ' teams — your saved settings.';
  }
  function scoringLabel() {
    var L = get();
    if (!L) return 'PPR';
    return L.scoring + (hasCustomScoring() ? ' · custom' : '') + ', ' + L.teams + ' teams';
  }
  function summary() {
    var L = get();
    if (!L) return '';
    return L.platform + ' · ' + L.teams + ' teams · ' + L.scoring + (hasCustomScoring() ? ' · custom' : '') +
      (isSuperflex() ? ' · superflex' : '') + ' · $' + L.faab + ' FAAB';
  }

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](get()); } catch (e) {} } }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  try {
    root.addEventListener('storage', function (e) {
      if (e && (e.key === KEY || e.key == null)) { cachedRaw = '\0'; emit(); }
    });
  } catch (e) {}

  root.ITInSeason = {
    KEY: KEY, PLATFORMS: PLATFORMS, SCORINGS: SCORINGS, DEFAULTS: DEFAULTS,
    SCORING_DEFAULTS: SCORING_DEFAULTS, SCORING_BONUSES: SCORING_BONUSES,
    SLOTS: SLOTS, SLOT_LABEL: SLOT_LABEL, ROSTER_DEFAULT: ROSTER_DEFAULT,
    emptyRoster: emptyRoster, defaultRoster: defaultRoster, rosterSum: rosterSum,
    labelRoster: labelRoster, presetOf: presetOf,
    get: get, has: has, draft: draft, seed: seed, save: save, clear: clear,
    normalize: normalize, normalizeSettings: normalizeSettings, apply: apply,
    faab: faab, teams: teams, scoring: scoring, bid: bid, money: money,
    settings: settings, lineup: lineup, customScoring: customScoring,
    hasCustomScoring: hasCustomScoring, isSuperflex: isSuperflex,
    lineupLabel: lineupLabel, rosterSize: rosterSize,
    scoringNote: scoringNote, scoringLabel: scoringLabel, summary: summary,
    onChange: onChange
  };
})(window);
