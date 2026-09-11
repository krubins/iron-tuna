// These functions are self-contained because Chrome serializes injected functions.
export function leagueFromUrl(value) {
  try {
    const u = new URL(value);
    const m = u.hostname.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.football\.cbssports\.com$/);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && m ? m[1] : null;
  } catch { return null; }
}

export function readCbsAccess(expectedLeague) {
  if (location.protocol !== 'https:' || location.hostname !== expectedLeague + '.football.cbssports.com') return { error: 'wrong_page' };
  // The historical CBS league page declares `var token = "..."`. Read only
  // that declaration, never arbitrary cookies, storage, forms or global objects.
  const candidates = new Set();
  for (const script of document.scripts) {
    if (script.src) continue;
    for (const match of script.textContent.matchAll(/\b(?:var|let|const)\s+token\s*=\s*(["'])([^"'\r\n]+)\1\s*;/g)) {
      const value = match[2];
      if (value.length >= 16 && value.length <= 8192 && !/[\s\\\x00-\x1f\x7f]/.test(value)) candidates.add(value);
    }
  }
  if (candidates.size !== 1) return { error: candidates.size ? 'ambiguous_token' : 'token_unavailable' };
  return { leagueId: expectedLeague, accessToken: [...candidates][0] };
}

export async function ironTunaRequest(path, body) {
  if (location.origin !== 'https://irontuna.com') return { ok: false, message: 'Open Iron Tuna and try again.' };
  if (path !== '/api/auth/me' && path !== '/api/leagues/connect' && !/^\/api\/leagues\/[a-zA-Z0-9-]+\/team$/.test(path)) return { ok: false, message: 'Unsupported request.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    // Only the fields the popup needs leave the Iron Tuna tab; never credentials.
    return { ok: response.ok && result.ok !== false, signedIn: result.signedIn === true, status: response.status,
      message: result.detail || result.message || result.error, league: result.league ? { id: result.league.id, name: result.league.name } : null,
      needsTeam: !!result.needsTeam, teams: Array.isArray(result.teams) ? result.teams.map(t => ({ teamId: String(t.teamId), name: t.name })) : [] };
  } catch { return { ok: false, message: 'The connection timed out or was interrupted. Check My Leagues before retrying; an import may still finish.' }; }
  finally { clearTimeout(timer); }
}
