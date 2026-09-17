/* Iron Tuna — reading a league's scoring and lineup out of whatever the reader
 * has to hand, for the in-season league forms.
 *
 * WHY THIS IS A PORT AND NOT A NEW IDEA. The draft app has asked for a league
 * this way since the cheat sheet shipped: a screenshot of the scoring page, read
 * by OCR in the browser; a blob of pasted text; or one of a few presets — each
 * producing a PREVIEW of what it detected, which the reader applies or ignores.
 * It works because nobody types twenty scoring fields by hand, and because a
 * preview makes a wrong read visible BEFORE it is saved rather than after every
 * board has quietly re-scored itself.
 *
 * In-season asked for the same league twice and offered neither method. The
 * settings form on /my-league §02 had three radio buttons (PPR / Half /
 * Standard), so a reader with six-point passing touchdowns, a tight-end premium
 * or a superflex was told their league was one of three things it is not. The
 * by-hand league form above it exposed exactly three scoring numbers and
 * thirteen roster boxes, all typed. This file is the draft app's intake, carried
 * over so both of them can copy a league in instead.
 *
 * HAND-SYNCED WITH index.html. parseScoringText() there and parseScoring() here
 * are the same algorithm; tools/test-inseason-league.mjs runs both over the same
 * fixtures and fails when they disagree. Change them together.
 *
 * TWO THINGS ARE NEW. The app only ever recovered a LINEUP from a connected
 * Sleeper league, never from text, so a reader pasting their settings page got
 * scoring and nothing else — parseRoster() below reads the lineup out of the
 * same paste. And fromDraftApp() copies the whole league straight across from
 * the draft room, which is the shortest path of all for the reader who already
 * built a cheat sheet in this browser.
 *
 * THE SHAPE IS THE SERVER'S, not the draft app's. _worker.js
 * (leagueNormalizeSettings) is the one description of an in-season league:
 * scoring by SCORING_BASE's names, extras.tePremium, and a roster of SLOT counts
 * — QB RB WR TE FLEX SFLEX REC_FLEX WRRB_FLEX K DEF BN IR TAXI. The draft app's
 * per-position {starters, total} is an auction idea and stays in the auction;
 * anything leaving this file speaks the in-season vocabulary, so a partial can
 * go to /api/leagues/manual, into an override, or into the local record without
 * being translated again on the way.
 *
 * Nothing here writes anything. It returns a partial; the form decides whether
 * it ever reaches a record.
 *
 *   ITInSeasonImport.parseText(text)            a partial, from pasted text
 *   ITInSeasonImport.fromImage(file, onStatus)  a promise of one, via OCR
 *   ITInSeasonImport.preset(kind)               a partial, from one tap
 *   ITInSeasonImport.fromDraftApp()             a partial, from the draft room
 */
(function (root) {
  'use strict';

  var TESSERACT_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';

  // it-inseason.js owns the vocabulary — the slot names, the blank roster, the
  // label — because it is the file that has to normalize and store them. Load
  // that one first, as with it-inseason-ui.js. A second copy of a thirteen-slot
  // list is a thing that drifts, and a slot missing from one of two copies is a
  // lineup read wrong with nothing to show for it.
  var SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLEX', 'REC_FLEX', 'WRRB_FLEX', 'K', 'DEF', 'BN', 'IR', 'TAXI'];
  function emptyRoster() {
    var L = root.ITInSeason;
    if (L && L.emptyRoster) return L.emptyRoster();
    var r = {};
    for (var i = 0; i < SLOTS.length; i++) r[SLOTS[i]] = 0;
    return r;
  }
  function rosterSum(r) {
    var L = root.ITInSeason;
    if (L && L.rosterSum) return L.rosterSum(r);
    var n = 0;
    for (var i = 0; i < SLOTS.length; i++) n += Number(r && r[SLOTS[i]]) || 0;
    return n;
  }
  function lineupLabel(r) {
    var L = root.ITInSeason;
    return L && L.labelRoster ? L.labelRoster(r) : '';
  }

  function loadTesseract() {
    return new Promise(function (resolve, reject) {
      if (root.Tesseract) return resolve(root.Tesseract);
      var sc = root.document.createElement('script');
      sc.src = TESSERACT_SRC;
      sc.onload = function () { root.Tesseract ? resolve(root.Tesseract) : reject(new Error('ocr')); };
      sc.onerror = function () { reject(new Error('ocr')); };
      root.document.head.appendChild(sc);
    });
  }

  // ── scoring ───────────────────────────────────────────────────────────────
  // The app's parseScoringText, transliterated. Line by line, because platforms
  // print one rule per line and the words around the number are what say which
  // rule it is: "Passing Yards: 1 point per 25 yards" and "Passing TD: 4" are
  // both "pass" plus a number, and only the yards/TD split tells them apart.
  var TE_LINE = /\b(te|tes|tight ?ends?)\b/;
  function parseScoring(text) {
    var sc = {};
    var items = [];
    var lines = String(text || '').split(/\n|;|•|\|/).map(function (l) { return l.trim(); }).filter(Boolean);

    function numIn(s) {
      var m = s.match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    }
    // Yardage is quoted three ways — "1 point per 25 yards", "25 yards per
    // point" and "0.04 points per yard" — and all three mean the same divisor.
    function yppFrom(line) {
      var per = line.match(/per\s*(\d+(?:\.\d+)?)\s*(?:yards?|yds?)/);
      if (per) return Math.round(parseFloat(per[1]));
      var adj = line.match(/(\d+(?:\.\d+)?)\s*(?:yards?|yds?)\b/);
      if (adj) {
        var v = parseFloat(adj[1]);
        if (v >= 1) return Math.round(v);
      }
      var n = numIn(line);
      if (n == null) return null;
      if (n > 0 && n < 1) return Math.round(1 / n);
      if (n >= 1) return Math.round(n);
      return null;
    }
    function set(k, v, label) {
      if (v != null && !isNaN(v)) {
        sc[k] = v;
        items.push([label, v]);
      }
    }

    var whole = String(text || '').toLowerCase();
    if (/\bhalf[- ]?ppr\b/.test(whole)) set('receptionPoints', 0.5, 'Reception (Half-PPR)');
    else if (/\bnon[- ]?ppr\b|\bstandard\b/.test(whole)) set('receptionPoints', 0, 'Reception (Standard)');
    else if (/\bfull[- ]?ppr\b|\bppr\b/.test(whole)) set('receptionPoints', 1, 'Reception (PPR)');

    lines.forEach(function (raw) {
      var l = raw.toLowerCase();
      var isDef = /\b(def|dst|defense|opp|opponent|return|special teams)\b/.test(l);
      var v;
      if (/pass/.test(l) && /(td|touchdown)/.test(l)) set('passingTD', numIn(l), 'Passing TD');
      else if (/pass/.test(l) && /(yards?|yds?)/.test(l)) {
        v = yppFrom(l);
        if (v) set('passingYardsPerPoint', v, 'Passing yds/pt');
      }
      if (/\b(interceptions?|ints?)\b/.test(l) && /(pass|thrown|qb)/.test(l)) set('passingInt', numIn(l), 'Interception thrown');
      else if (/\b(interceptions?|ints?)\b/.test(l) && !isDef && (numIn(l) || 0) < 0) set('passingInt', numIn(l), 'Interception thrown');
      if (/rush/.test(l) && /(td|touchdown)/.test(l)) set('rushingTD', numIn(l), 'Rushing TD');
      else if (/rush/.test(l) && /(yards?|yds?)/.test(l)) {
        v = yppFrom(l);
        if (v) set('rushingYardsPerPoint', v, 'Rushing yds/pt');
      }
      if (/(rec|receiv)/.test(l) && /(td|touchdown)/.test(l)) set('receivingTD', numIn(l), 'Receiving TD');
      else if (/(rec|receiv)/.test(l) && /(yards?|yds?)/.test(l)) {
        v = yppFrom(l);
        if (v) set('receivingYardsPerPoint', v, 'Receiving yds/pt');
      }
      // A tight-end line is NOT the league-wide reception value. "TEs get 1.5
      // per catch", read as one, pays every running back and receiver 1.5 a
      // catch off a tight-end rule. parseTePremium below is what reads it here;
      // index.html carries the same guard and leaves the line alone.
      if (TE_LINE.test(l)) { /* left to parseTePremium */ }
      else if (/(reception|per catch|points? per reception)/.test(l) && !/(yards?|yds?)/.test(l)) {
        var n = numIn(l);
        if (n != null && Math.abs(n) <= 2) {
          if (/\brb\b|running ?back/.test(l)) set('rbReceptionPoints', n, 'RB reception');
          else set('receptionPoints', n, 'Reception');
        }
      }
      if (/fumble/.test(l) && /lost/.test(l)) set('fumbleLost', numIn(l), 'Fumble lost');
      if (/(extra point|\bpat\b|\bxp\b)/.test(l) && !/miss/.test(l)) set('extraPoint', numIn(l), 'Extra point');
      if (/sack/.test(l)) set('sackPoints', numIn(l), 'Sack');
      if (isDef && /\b(interceptions?|ints?)\b/.test(l)) set('interception', numIn(l), 'Def interception');
      if (isDef && /(td|touchdown)/.test(l)) set('defensiveTD', numIn(l), 'Defensive TD');
      if (/safety/.test(l)) set('safety', numIn(l), 'Safety');
    });

    return { scoring: sc, items: items };
  }

  // A tight end premium is a bonus ON TOP of the reception, which is how every
  // platform words it and how _worker.js models it (extras.tePremium). Read as a
  // reception value instead it would double-count the catch itself.
  // Platforms word it both ways, and the two mean different numbers:
  //   "TE reception BONUS 0.5"  — the bonus itself
  //   "TEs get 1.5 per catch"   — the total, of which the bonus is 1.5 minus
  //                               whatever everyone else gets for a catch
  // Read the second as the first and a 1.5-PPR tight end becomes a 2.5-PPR one.
  // `rec` is the league-wide reception value already parsed off the same text;
  // with none found, the site's own default of a full point stands in.
  function parseTePremium(text, rec) {
    var base = typeof rec === 'number' && isFinite(rec) ? rec : 1;
    var lines = String(text || '').split(/\n|;|•|\|/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].toLowerCase();
      if (!TE_LINE.test(l)) continue;
      if (!/(reception|catch|bonus|premium)/.test(l)) continue;
      var m = l.match(/-?\d+(?:\.\d+)?/);
      if (!m) continue;
      var n = parseFloat(m[0]);
      if (!(n > 0 && n <= 3)) continue;
      var bonus = /(bonus|premium|extra|additional)/.test(l) ? n : n - base;
      if (bonus > 0 && bonus <= 2) return Math.round(bonus * 100) / 100;
    }
    return null;
  }

  // ── the lineup ────────────────────────────────────────────────────────────
  // A platform prints a lineup one of two ways, and both are common enough in a
  // copy-paste that reading only one would send half the readers back to the
  // boxes:
  //
  //   SLOTS   QB, RB, RB, WR, WR, WR, TE, FLEX, K, DEF, BN, BN, BN, BN, BN, BN
  //   COUNTS  QB 1 / RB 2 / WR 3 / W/R/T 1 / Bench 6
  //
  // The slot list wins where both could be read: it carries the bench, which the
  // count form often omits.
  var SLOT_WORD = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', PK: 'K', DEF: 'DEF', DST: 'DEF' };
  var FLEX_TOKEN = /^(?:FLEX|WRT|OP)$/;
  var SUPER_TOKEN = /^(?:SUPER_FLEX|SUPERFLEX|SFLEX)$/;
  var BENCH_TOKEN = /^(?:BN|BE|BENCH|RES|RESERVE)$/;
  var IR_TOKEN = /^(?:IR|TAXI|NA)$/;

  // The slash forms are matched on the raw text and counted first, because "/"
  // has to be a token separator for everything else and would otherwise shred
  // W/R/T into three positions — a lineup with an extra WR, RB and TE in it.
  var SLASH_FORMS = [
    [/\bQ\/W\/R\/T\b|\bQB\/RB\/WR\/TE\b/g, 'SFLEX'],
    [/\bW\/R\/T\b|\bRB\/WR\/TE\b/g, 'FLEX'],
    [/\bW\/T\b|\bWR\/TE\b/g, 'REC_FLEX'],
    [/\bW\/R\b|\bRB\/WR\b/g, 'WRRB_FLEX'],
    [/\bD\/ST\b/g, 'DEF']
  ];

  // One line of a slot list, or nothing. A line counts only if EVERY word in it
  // is a slot — which is what keeps "TE reception bonus: 0.5" out of the lineup.
  // Read across the whole paste instead of line by line, that bonus line put a
  // second tight end in the reader's starting lineup, off a scoring rule.
  function slotsInLine(line) {
    var raw = String(line || '').toUpperCase();
    var roster = emptyRoster();
    var seen = 0;

    SLASH_FORMS.forEach(function (pair) {
      var hits = raw.match(pair[0]);
      if (!hits) return;
      roster[pair[1]] += hits.length;
      seen += hits.length;
      raw = raw.replace(pair[0], ' ');
    });

    var toks = raw.split(/[\s,;|/[\]"'()]+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      // A number in the line means it is quoting counts ("RB 2"), which is the
      // other reader's job, not this one's.
      if (/\d/.test(t)) return null;
      var tok = t.replace(/[^A-Z_]/g, '');
      if (!tok) continue;
      if (SLOT_WORD[tok] && tok.length <= 3) { roster[SLOT_WORD[tok]]++; seen++; continue; }
      if (SUPER_TOKEN.test(tok)) { roster.SFLEX++; seen++; continue; }
      if (FLEX_TOKEN.test(tok)) { roster.FLEX++; seen++; continue; }
      if (BENCH_TOKEN.test(tok)) { roster.BN++; seen++; continue; }
      if (IR_TOKEN.test(tok)) { roster[tok === 'TAXI' ? 'TAXI' : 'IR']++; seen++; continue; }
      return null;   // a word that is not a slot: this is prose, not a lineup
    }
    return seen ? { roster: roster, seen: seen } : null;
  }

  function parseSlotList(text) {
    var lines = String(text || '').split(/\n|;|•|\|/);
    var best = null, cur = null;

    // A slot list is written as one long line or as one slot per line, so the
    // run of consecutive slot lines is the unit, not the line.
    function flush() {
      if (cur && cur.seen >= 5 && SLOTS.some(function (s) { return cur.roster[s] > 1; })) {
        if (!best || cur.seen > best.seen) best = cur;
      }
      cur = null;
    }
    lines.forEach(function (raw) {
      // "Starting lineup: QB, RB, RB…" — the label is not part of the lineup.
      var res = slotsInLine(raw.replace(/^[^:]{0,40}:/, ' '));
      if (!res) { flush(); return; }
      if (!cur) cur = { roster: emptyRoster(), seen: 0 };
      for (var i = 0; i < SLOTS.length; i++) cur.roster[SLOTS[i]] += res.roster[SLOTS[i]];
      cur.seen += res.seen;
    });
    flush();

    // One "QB" in a paragraph is not a lineup. A real slot list names several
    // slots and repeats at least one of them: no league starts one of everything
    // and nothing else, and nothing else in a settings page looks like this.
    return best ? best.roster : null;
  }

  // Count mode. "WR 3" is a lineup line; "Receiving TD 6" is a scoring line that
  // also holds a position word and a number, and reading it as three receivers
  // is exactly the silent wrong answer a preview exists to prevent. Any line
  // with a scoring word in it is left to parseScoring.
  var SCORING_WORD = /(td|touchdown|yard|yds|point|pts|reception|catch|fumble|interception|\bint\b|sack|safety|bonus|premium|return|2pt|two.point|extra|\bfg\b|field goal|allowed|\bppr\b)/;
  var COUNT_LINE = [
    [/^(?:super[ _-]?flex|sflex|q\/w\/r\/t)\b/, 'SFLEX'],
    [/^(?:flex|w\/r\/t|wrt|rb\/wr\/te)\b/, 'FLEX'],
    [/^(?:w\/t|wr\/te|rec[ _-]?flex)\b/, 'REC_FLEX'],
    [/^(?:w\/r|rb\/wr)\b/, 'WRRB_FLEX'],
    [/^(?:qb|quarterbacks?)\b/, 'QB'],
    [/^(?:rb|running ?backs?)\b/, 'RB'],
    [/^(?:wr|wide ?receivers?)\b/, 'WR'],
    [/^(?:te|tight ?ends?)\b/, 'TE'],
    [/^(?:k|pk|kickers?)\b/, 'K'],
    [/^(?:def|dst|d\/st|defense|team defense)\b/, 'DEF'],
    [/^(?:bn|be|bench|reserve)\b/, 'BN'],
    [/^(?:ir|injured reserve)\b/, 'IR'],
    [/^(?:taxi)\b/, 'TAXI']
  ];
  function parseCounts(text) {
    var lines = String(text || '').split(/\n|;|•|\|/).map(function (l) { return l.trim(); }).filter(Boolean);
    var roster = emptyRoster();
    var hits = 0;

    lines.forEach(function (rawLine) {
      var l = rawLine.toLowerCase().replace(/^[\s\-*·]+/, '');
      if (SCORING_WORD.test(l)) return;
      var m = l.match(/(\d+)\s*$/) || l.match(/[:\s](\d+)\b/);
      if (!m) return;
      var n = parseInt(m[1], 10);
      if (!(n >= 0 && n <= 9)) return;
      for (var i = 0; i < COUNT_LINE.length; i++) {
        if (COUNT_LINE[i][0].test(l)) { roster[COUNT_LINE[i][1]] += n; hits++; return; }
      }
    });

    return hits >= 3 ? roster : null;
  }

  function parseRoster(text) {
    return parseSlotList(text) || parseCounts(text);
  }

  // Teams and the FAAB budget, wherever they are said. Teams is the one number
  // that moves a value more than any single scoring rule, and the budget is the
  // one every other tool guesses at.
  function parseTeams(text) {
    var s = String(text || '');
    var m = s.match(/(\d{1,2})\s*[- ]?\s*team\b/i) || s.match(/\bteams?\b\D{0,12}(\d{1,2})\b/i);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return n >= 4 && n <= 20 ? n : null;
  }
  function parseFaab(text) {
    var m = String(text || '').match(/\b(?:faab|free agent budget|acquisition budget|waiver budget)\b\D{0,12}\$?(\d{1,6})/i);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return n > 0 ? n : null;
  }

  // ── the intakes ───────────────────────────────────────────────────────────
  function parseText(text) {
    var res = parseScoring(text);
    var out = { items: res.items };
    if (Object.keys(res.scoring).length) out.scoring = res.scoring;

    var te = parseTePremium(text, res.scoring.receptionPoints);
    if (te != null) {
      out.extras = { tePremium: te };
      out.items.push(['TE premium', te]);
    }
    var roster = parseRoster(text);
    if (roster && rosterSum(roster) >= 3) {
      out.roster = roster;
      out.items.push(['Lineup', lineupLabel(roster)]);
    }
    var teams = parseTeams(text);
    if (teams) {
      out.teams = teams;
      out.items.push(['Teams', teams]);
    }
    var faab = parseFaab(text);
    if (faab) {
      out.faab = faab;
      out.items.push(['FAAB budget', '$' + faab]);
    }
    return out;
  }

  function fromImage(file, onStatus) {
    var say = typeof onStatus === 'function' ? onStatus : function () {};
    if (!file) return Promise.reject(new Error('nofile'));
    say('Loading OCR…');
    return loadTesseract().then(function (T) {
      return T.recognize(file, 'eng', {
        logger: function (m) {
          if (m.status === 'recognizing text') say('Reading image… ' + Math.round((m.progress || 0) * 100) + '%');
        }
      });
    }).then(function (res) {
      return parseText((res && res.data && res.data.text) || '');
    });
  }

  // The app's five one-tap settings, plus the superflex the in-season forms need
  // because a lineup is theirs to set as well. Each one changes the knob it
  // names and nothing else, which is the whole contract of a preset.
  var PRESETS = {
    std: { scoring: { receptionPoints: 0, rbReceptionPoints: 0 }, items: [['Reception', '0 (Standard)']] },
    half: { scoring: { receptionPoints: 0.5, rbReceptionPoints: 0.5 }, items: [['Reception', '0.5 (Half-PPR)']] },
    ppr: { scoring: { receptionPoints: 1, rbReceptionPoints: 1 }, items: [['Reception', '1 (Full PPR)']] },
    pass4: { scoring: { passingTD: 4 }, items: [['Passing TD', 4]] },
    pass6: { scoring: { passingTD: 6 }, items: [['Passing TD', 6]] },
    tep: { extras: { tePremium: 0.5 }, items: [['TE premium', 0.5]] },
    superflex: { rosterPatch: { SFLEX: 1 }, items: [['Superflex slot', 1]] }
  };
  function preset(kind) {
    var p = PRESETS[kind];
    return p ? JSON.parse(JSON.stringify(p)) : { items: [] };
  }

  // ── the draft room's own league ───────────────────────────────────────────
  // Scoring and lineup are sitting in this same browser under the draft app's
  // key for any reader who built a cheat sheet, and re-typing them here was
  // never anything but a chore. ITLeague owns the reading of that key; this only
  // translates what it read into the in-season vocabulary — per-position
  // {starters, total} becomes starting slots plus one bench count, and a flex
  // that admits a quarterback becomes the superflex slot it is.
  function fromDraftApp() {
    var L = root.ITLeague;
    if (!L || !L.has || !L.config) return null;
    var cfg = L.config;
    var out = { items: [] };

    if (cfg.scoring && Object.keys(cfg.scoring).length) {
      out.scoring = JSON.parse(JSON.stringify(cfg.scoring));
      out.items.push(['Scoring', 'every field']);
    }
    if (cfg.roster && Object.keys(cfg.roster).length) {
      var roster = emptyRoster();
      var bench = 0;
      Object.keys(cfg.roster).forEach(function (pos) {
        var slot = SLOT_WORD[pos] || (pos === 'DST' ? 'DEF' : null);
        var c = cfg.roster[pos] || {};
        var starters = Math.max(0, Number(c.starters) || 0);
        var total = Math.max(starters, Number(c.total) || 0);
        if (slot) roster[slot] += starters;
        bench += total - starters;
      });
      if (cfg.flex && (cfg.flex.count || 0) > 0) {
        var qb = (cfg.flex.eligible || []).indexOf('QB') >= 0;
        roster[qb ? 'SFLEX' : 'FLEX'] += cfg.flex.count;
      }
      roster.BN = bench;
      out.roster = roster;
      out.items.push(['Lineup', lineupLabel(roster)]);
    }
    if (cfg.teams) {
      out.teams = cfg.teams;
      out.items.push(['Teams', cfg.teams]);
    }
    return out.items.length ? out : null;
  }

  root.ITInSeasonImport = {
    SLOTS: SLOTS,
    PRESETS: PRESETS,
    emptyRoster: emptyRoster,
    rosterSum: rosterSum,
    lineupLabel: lineupLabel,
    parseText: parseText,
    parseScoring: parseScoring,
    parseTePremium: parseTePremium,
    parseRoster: parseRoster,
    parseTeams: parseTeams,
    parseFaab: parseFaab,
    fromImage: fromImage,
    preset: preset,
    fromDraftApp: fromDraftApp,
    loadTesseract: loadTesseract
  };
})(window);
