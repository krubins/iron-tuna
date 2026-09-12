import { leagueFromUrl, ironTunaRequest } from './bridge.js';
import { readCbsPage } from './reader.js';
const $ = id => document.getElementById(id);
let sourceTab, leagueId, targetTab, importedId;
$('season').value = new Date().getFullYear();
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
  let snapshot;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://irontuna.com/*' });
    targetTab = tabs.find(t => new URL(t.url).pathname === '/my-league') || tabs[0];
    if (!targetTab) throw new Error('Open My Leagues below, sign in, then return to CBS and reopen this extension.');
    status('Checking your Iron Tuna sign-in…');
    const me = await request('/api/auth/me');
    if (!me?.signedIn) throw new Error('Sign in to Iron Tuna first, then return to CBS and try again.');
    status('Reading league settings…');
    const read = async (kind, teamId) => {
      const result = await chrome.scripting.executeScript({ target:{tabId:sourceTab.id}, func:readCbsPage, args:[leagueId,kind,teamId || null] });
      if (!result[0]?.result) throw new Error('CBS returned no league data. Open your signed-in league and retry.');
      return result[0].result;
    };
    const season = Number($('season').value);
    if (!Number.isInteger(season) || season < 2020 || season > new Date().getFullYear()+1) throw new Error('Enter the season shown on CBS.');
    const settings = await read('rules');
    const teams = await read('grid');
    if (teams.length !== settings.numTeams) throw new Error('CBS did not return every team. No import was sent.');
    snapshot = {version:1,leagueId,season,...settings,teams,rosters:[]};
    for (const [i,t] of teams.entries()) {
      status('Reading roster '+(i+1)+' of '+teams.length+'… Keep this popup open.');
      snapshot.rosters.push(await read('team',t.teamId));
    }
    status('Saving '+teams.length+' teams and their rosters to Iron Tuna…');
    const connected = await request('/api/leagues/connect', {provider:'cbs_browser',snapshot});
    if (!connected?.ok || !connected.league?.id) throw new Error(connected?.message || 'Iron Tuna could not import this league.');
    importedId = connected.league.id;
    $('connect').hidden = true;
    status('Connected: ' + connected.league.name + '.');
    if (connected.needsTeam && connected.teams.length) {
      $('team').replaceChildren(...connected.teams.map(t => { const option = document.createElement('option'); option.value = t.teamId; option.textContent = t.name; return option; }));
      $('teamSection').hidden = false;
    } else status('Connected. Refresh My Leagues to see your league.');
  } catch (error) { status(error instanceof Error ? error.message : 'Connection failed. Try again.', true); $('connect').disabled = false; }
  finally { snapshot = null; }
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
