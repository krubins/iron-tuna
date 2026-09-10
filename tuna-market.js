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
        el('p', `${r.market.replaceAll('_', ' ')} · ${r.book} · ${r.player ? r.matchup : r.sport}`, card);
        el('strong', r.score == null ? (r.stale ? 'Stale observation — unscored' : 'Waiting for a second updated quote') : `Movement score ${r.score}/100`, card);
        el('p', `Line ${r.line ?? '—'} · Decimal odds ${r.price.toFixed(2)} · Line change ${fmt(r.lineDelta)} · Implied probability change ${fmt(r.probabilityDelta, ' pp')}`, card);
        el('p', `Same-line sportsbook consensus: ${r.consensusProbability == null ? 'Unavailable' : r.consensusProbability.toFixed(1) + '%'} (${r.books} books). Reference-book gap: ${fmt(r.sharpGap, ' pp')}. Prices include margin.`, card);
        el('p', r.publicSplit ? `Public splits: ${r.publicSplit.tickets}% tickets / ${r.publicSplit.money}% money, reported ${new Date(r.publicSplit.at).toLocaleString()}.` : 'Public betting splits: unavailable; sportsbook consensus is not public bet volume.', card);
        el('small', `Source: ${r.provider} · Book updated ${new Date(r.updated).toLocaleString()} · Collected ${new Date(r.observed).toLocaleString()}`, card);
        const source = el('a', 'Source website', card); source.href = r.source; source.rel = 'noopener noreferrer'; source.target = '_blank';
        const details = el('details', null, card); el('summary', 'Observed history', details);
        el('p', 'First observed within this window, not the sportsbook opening line. Price changes are compared only at an unchanged line.', details);
        const list = el('ul', null, details);
        for (const point of r.history) el('li', `${new Date(point.at).toLocaleString()}: line ${point.line ?? '—'}, decimal odds ${point.price.toFixed(2)}`, list);
      }
    } catch { status.textContent = 'Market signals are temporarily unavailable. Try again later.'; }
    finally { button.disabled = false; }
  });
})();
