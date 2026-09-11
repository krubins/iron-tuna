/* Tuna Market Signal: read-only dashboard; visitor requests never poll vendors. */
(() => {
  const mount = document.getElementById('tuna-market');
  if (!mount) return;
  const el = (tag, text, parent = mount) => { const node = document.createElement(tag); if (text != null) node.textContent = text; parent.append(node); return node; };
  el('h2', 'Tuna Market Signal');
  el('p', 'Follow observed line and price changes across sportsbooks. The score measures movement, not winning probability or confirmed sharp money.');
  const controls = el('div', null);
  const label = el('label', 'Markets ', controls), kind = el('select', null, label);
  for (const [value, text] of [['', 'All markets'], ['props', 'Player props'], ['games', 'Game lines']]) { const o = el('option', text, kind); o.value = value; }
  kind.value = mount.dataset.kind || '';
  const searchLabel = el('label', ' Player ', controls), search = el('input', null, searchLabel);
  search.type = 'search'; search.placeholder = 'Player name'; search.maxLength = 100;
  const button = el('button', 'Load market signals', controls); button.type = 'button';
  const status = el('p', 'Load the latest stored observations. No live provider request is made.'); status.setAttribute('role', 'status');
  const output = el('div', null); output.className = 'tms-results';
  const fmt = (n, suffix = '') => n == null ? 'Unavailable' : `${n > 0 ? '+' : ''}${n.toFixed(2)}${suffix}`;
  button.addEventListener('click', async () => {
    if (!search.value.trim() && document.getElementById('pcName')?.textContent.trim()) search.value = document.getElementById('pcName').textContent.trim();
    button.disabled = true; status.textContent = 'Loading…'; output.replaceChildren();
    try {
      const params = new URLSearchParams({ kind: kind.value, player: search.value.trim() });
      const response = await fetch('/api/tuna-market?' + params, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (data.status === 'disabled') { status.textContent = 'Market signals are awaiting provider configuration.'; return; }
      status.textContent = data.items.length ? `Showing ${data.items.length} of ${data.total} observations from the last 24 hours.${data.truncated ? ' History is capped; the observation window may be shorter.' : ''}` : 'No matching observations yet. History begins when collection is enabled.';
      if (data.health?.status === 'error') status.textContent += ' The latest collection failed; stored observations may be stale.';
      for (const r of data.items) {
        const card = el('article', null, output); card.className = 'tms-card';
        el('h3', `${r.player || r.matchup} · ${r.side}`, card);
        el('p', `${r.market.replaceAll('_', ' ')} · ${r.player ? r.matchup : r.sport}`, card);
        el('strong', r.score == null ? (r.stale ? 'Stale observation — unscored' : 'Waiting for a second updated quote') : `Movement score ${r.score}/100`, card);
        const openLine = r.consensusOpeningLine == null ? 'Unavailable' : r.consensusOpeningLine.toFixed(1);
        const currentLine = r.consensusLine == null ? 'Unavailable' : r.consensusLine.toFixed(1);
        el('p', `Consensus baseline (${r.historyBasis === 'provider-opening' ? 'provider opening' : 'first observed in stored window'}): ${openLine}. Current: ${currentLine}. Median comparable-book line change ${fmt(r.consensusLineDelta ?? r.lineDelta)} · Implied probability change ${fmt(r.probabilityDelta, ' pp')}`, card);
        if (r.observedBooksCompared > 0) el('p', `Observed agreement: ${r.observedBooksMoved} of ${r.observedBooksCompared} books · ${r.observedDirection} (${r.observedMovementMetric}). Snapshot comparisons can miss changes between polls; this is not confirmed sharp money.`, card);
        el('p', `Sportsbook consensus: ${r.consensusProbability == null ? 'Unavailable' : r.consensusProbability.toFixed(1) + '%'} across ${r.marketBooks ?? r.books} books. Consensus gap: ${fmt(r.sharpGap, ' pp')}. Prices include margin.`, card);
        if (r.steamScore != null) el('p', `Cross-book steam score ${r.steamScore.toFixed(1)}/100${r.booksMoved != null && r.booksQuoting != null ? ` · ${r.booksMoved} of ${r.booksQuoting} books moving` : ''}${r.movementDirection ? ` · ${r.movementDirection}` : ''}. Source: ${r.sourceName || 'market feed'}.`, card);
        el('p', r.publicSplit ? `Public splits: ${r.publicSplit.tickets}% tickets / ${r.publicSplit.money}% money, reported ${new Date(r.publicSplit.at).toLocaleString()}.` : 'Public betting splits: unavailable; sportsbook consensus is not public bet volume.', card);
        el('small', `Latest market update ${new Date(r.updated).toLocaleString()} · Signal collected ${new Date(r.observed).toLocaleString()}`, card);
        const details = el('details', null, card); el('summary', 'How to read this signal', details);
        el('p', 'The public signal is derived from stored sportsbook observations. Book identity, raw current prices and raw quote history stay server-side; the score describes movement and consensus, not a guaranteed edge or confirmed sharp action.', details);
      }
    } catch { status.textContent = 'Market signals are temporarily unavailable. Try again later.'; }
    finally { button.disabled = false; }
  });
})();
