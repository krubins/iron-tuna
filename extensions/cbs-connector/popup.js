import { leagueFromUrl, readCbsAccess, ironTunaRequest } from './bridge.js';
const $ = id => document.getElementById(id);
let sourceTab, leagueId, targetTab, importedId;
function status(text, bad = false) { $('status').textContent = text; $('status').dataset.error = String(bad); }
async function request(path, body) {
  const args = body === undefined ? [path] : [path, body];
  const results = await chrome.scripting.executeScript({ target: { tabId: targetTab.id }, func: ironTunaRequest, args });
  return results[0]?.result;
}
try {
  [sourceTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  leagueId = leagueFromUrl(sourceTab?.url);
  $('league').textContent = leagueId ? 'League: ' + leagueId : 'Open your CBS football league, then click this extension again.';
  $('connect').disabled = !leagueId;
} catch { status('Could not read the current tab. Reopen the extension on your CBS league.', true); }

$('connect').addEventListener('click', async () => {
  $('connect').disabled = true;
  let access;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://irontuna.com/*' });
    targetTab = tabs.find(t => new URL(t.url).pathname === '/my-league') || tabs[0];
    if (!targetTab) throw new Error('Open My Leagues below, sign in, then return to CBS and reopen this extension.');
    status('Checking your Iron Tuna sign-in…');
    const me = await request('/api/auth/me');
    if (!me?.signedIn) throw new Error('Sign in to Iron Tuna first, then return to CBS and try again.');
    status('Reading access from this CBS league…');
    const results = await chrome.scripting.executeScript({ target: { tabId: sourceTab.id }, func: readCbsAccess, args: [leagueId] });
    access = results[0]?.result;
    if (!access?.accessToken || access.leagueId !== leagueId) throw new Error('CBS did not expose a usable league API token on this page. This connection method needs further work; no league was imported.');
    status('Importing league settings and rosters… Keep this popup open.');
    const connected = await request('/api/leagues/connect', { provider: 'cbs', leagueId, accessToken: access.accessToken });
    access.accessToken = '';
    if (!connected?.ok || !connected.league?.id) throw new Error(connected?.message || 'Iron Tuna could not import this league.');
    importedId = connected.league.id;
    $('connect').hidden = true;
    status('Connected: ' + connected.league.name + '.');
    if (connected.needsTeam && connected.teams.length) {
      $('team').replaceChildren(...connected.teams.map(t => { const option = document.createElement('option'); option.value = t.teamId; option.textContent = t.name; return option; }));
      $('teamSection').hidden = false;
    } else status('Connected. Refresh My Leagues to see your league.');
  } catch (error) { status(error instanceof Error ? error.message : 'Connection failed. Try again.', true); $('connect').disabled = false; }
  finally { if (access) access.accessToken = ''; }
});
$('saveTeam').addEventListener('click', async () => {
  $('saveTeam').disabled = true;
  try {
    const result = await request('/api/leagues/' + encodeURIComponent(importedId) + '/team', { teamId: $('team').value });
    if (!result?.ok) throw new Error(result?.message || 'Could not save your team.');
    $('teamSection').hidden = true;
    status('Your team is saved. Refresh My Leagues to see your league.');
  } catch (error) { status(error.message || 'Could not save your team.', true); $('saveTeam').disabled = false; }
});
