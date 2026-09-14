// Serialized by chrome.scripting. Only whitelisted league tables leave CBS.
export async function readCbsPage(leagueId, kind, teamId, currentDocument = false) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(leagueId) || location.origin !== 'https://' + leagueId + '.football.cbssports.com') throw new Error('Open your signed-in CBS football league.');
  const path = kind === 'rules' ? '/rules' : kind === 'grid' ? '/teams/roster-grid' : kind === 'team' && /^\d{1,12}$/.test(teamId) ? '/teams/' + teamId : null;
  if (!path) throw new Error('Unsupported league page.');
  let doc = document;
  if (!currentDocument) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('unavailable');
      const html = await response.text();
      if (html.length > 4000000) throw new Error('too_large');
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch { throw new Error('CBS could not read ' + path + '. Sign in to CBS and retry. No import was sent.'); }
    finally { clearTimeout(timer); }
  }
  const text = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const rows = [...doc.querySelectorAll('table tr')];
  if (kind === 'rules') {
    const result = { name: '', numTeams: 0, roster: {}, rules: [], playoffWeekStart: null };
    const slots = { QB:'QB', RB:'RB', WR:'WR', TE:'TE', 'RB-WR-TE':'FLEX', 'QB-RB-WR-TE':'SFLEX', K:'K', DST:'DEF', Bench:'BN', 'Injured Players':'IR', 'Practice Players':'TAXI' };
    // Never read identity rows other than these two, or the constitution.
    for (const row of rows) {
      const cells = [...row.cells], label = text(cells[0]);
      if (label === 'League Name') result.name = text(cells[1]);
      if (label === 'Teams') result.numTeams = Number(text(cells[1]));
      if (label === 'Playoffs Start') result.playoffWeekStart = Number(text(cells[1]).match(/\d+/)?.[0]);
      if (Object.hasOwn(slots, label) && cells.length >= 3) result.roster[slots[label]] = Number(text(cells[2]));
    }
    const table = [...doc.querySelectorAll('table')].find(t => [...t.rows].some(r => text(r.cells[0]).toUpperCase() === 'OFFENSIVE' && text(r.cells[2]).toUpperCase() === 'SETTINGS'));
    if (!table) throw new Error('CBS scoring table was not found. No import was sent.');
    let group = 'OFFENSIVE';
    for (const row of table.rows) {
      const cells = [...row.cells], label = text(cells[0]);
      const heading = label.toUpperCase();
      if (['OFFENSIVE', 'DEFENSIVE'].includes(heading) || heading.startsWith('SPECIAL SCORING FOR ')) { group = heading; continue; }
      if (cells.length === 3 && /^[A-Za-z0-9]{1,16}$/.test(label)) result.rules.push({ group, code: label, text: text(cells[2]) });
    }
    if (!result.name || result.numTeams < 2 || result.numTeams > 32 || !result.rules.length || !Object.keys(result.roster).length) throw new Error('CBS league settings were incomplete. No import was sent.');
    return result;
  }
  if (kind === 'grid') {
    const teams = new Map();
    for (const row of rows) {
      const first = row.cells[0];
      for (const a of first?.querySelectorAll('a[href]') || []) {
        const u = new URL(a.getAttribute('href'), location.origin), m = u.pathname.match(/^\/teams\/(\d+)$/);
        if (u.origin === location.origin && m && text(a)) teams.set(m[1], { teamId: m[1], name: text(a) });
      }
    }
    if (teams.size < 2 || teams.size > 32) throw new Error('CBS roster grid was incomplete. No import was sent.');
    return [...teams.values()];
  }
  const table = [...doc.querySelectorAll('table')].find(t => [...t.rows].some(r => [...r.cells].some(c => text(c) === 'Players') && [...r.cells].some(c => text(c) === 'Pos')));
  if (!table) throw new Error('CBS roster was not found for team ' + teamId + '. No import was sent.');
  let slot = 'starter';
  const players = [], seen = new Set();
  for (const row of table.rows) {
    const cells = [...row.cells];
    if (cells.some(c => /^Reserves$/.test(text(c)))) { slot = 'bench'; continue; }
    if (cells.some(c => /^Injured(?: Reserve)?$/.test(text(c)))) { slot = 'ir'; continue; }
    const cell = cells.find(c => c.querySelector('a[href*="/players/playerpage/"]'));
    if (!cell) continue;
    const a = cell.querySelector('a[href*="/players/playerpage/"]'), u = new URL(a.getAttribute('href'), location.origin), id = u.pathname.match(/^\/players\/playerpage\/(\d+)$/)?.[1];
    if (u.origin !== location.origin || !id || seen.has(id)) throw new Error('CBS roster contains an unexpected player entry. No import was sent.');
    const meta = text(cell).match(/\b(QB|RB|WR|TE|K|DST)\s*[•·]\s*([A-Z]{2,3})\b/);
    if (!meta) throw new Error('CBS player position was missing. No import was sent.');
    const posCell = cells[cells.indexOf(cell) - 1];
    const position = meta[1] === 'DST' ? 'DEF' : meta[1];
    players.push({ providerPlayerId: id, name: text(a), position, team: meta[2], slot, slotLabel: slot === 'starter' ? ({ 'RB-WR-TE':'FLEX', DST:'DEF' }[text(posCell)] || text(posCell)) : slot === 'bench' ? 'BN' : 'IR' });
    seen.add(id);
  }
  const footer = [...table.rows].map(r => text(r.cells[0])).find(t => /^Active:\s*\d+\s+Reserve:\s*\d+/.test(t));
  const counts = footer?.match(/^Active:\s*(\d+)\s+Reserve:\s*(\d+)$/);
  if (!players.length || players.length > 60 || !counts || players.filter(p => p.slot === 'starter').length !== Number(counts[1]) || players.filter(p => p.slot === 'bench').length !== Number(counts[2]) || players.some(p => p.slot === 'ir')) throw new Error('CBS roster counts could not be verified for team ' + teamId + '. No import was sent.');
  return { teamId, players, counts:{starter:Number(counts[1]),bench:Number(counts[2])} };
}
