import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = new URL('../extensions/cbs-connector/', import.meta.url);
const source = fs.readFileSync(new URL('bridge.js', root), 'utf8');
const { leagueFromUrl, readCbsAccess, ironTunaRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
assert.deepEqual(manifest.host_permissions, ['https://irontuna.com/*']);
assert.equal(leagueFromUrl('https://bkahuna.football.cbssports.com/teams/8'), 'bkahuna');
for (const url of ['http://bkahuna.football.cbssports.com/', 'https://bkahuna.football.cbssports.com.evil.test/', 'https://user:pass@bkahuna.football.cbssports.com/', 'https://bkahuna.football.cbssports.com:8888/', 'https://www.cbssports.com/', 'bad']) assert.equal(leagueFromUrl(url), null);
const token = 'synthetic-api-token-123456789';
function read(scripts, host = 'fixture.football.cbssports.com') {
  return vm.runInNewContext('(' + readCbsAccess.toString() + ')("fixture")', { location: { protocol: 'https:', hostname: host }, document: { scripts: scripts.map(textContent => ({ src: '', textContent })) } });
}
assert.equal(read(['var token = "' + token + '";']).accessToken, token);
assert.equal(read(['var token = "' + token + '";', 'var token = "' + token + '";']).accessToken, token);
assert.equal(read(['var token = "' + token + '";', 'let token = "another-synthetic-token";']).error, 'ambiguous_token');
assert.equal(read(['var other = "' + token + '";']).error, 'token_unavailable');
assert.equal(read(['var token = "too short";']).error, 'token_unavailable');
assert.equal(read([], 'evil.test').error, 'wrong_page');
let requests = [];
async function request(path, body, origin = 'https://irontuna.com', failure = false) {
  return vm.runInNewContext('(' + ironTunaRequest.toString() + ')(path,body)', { path, body, location: { origin }, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { requests.push({ url, options }); if (failure) throw new Error(token); return { ok: true, status: 200, json: async () => ({ ok: true, signedIn: true, accessToken: token, league: { id: 'abc-123', name: 'Fixture', secret: token }, teams: [{ teamId: '8', name: 'Tuna', token }] }) }; } });
}
await request('/api/other', {});
await request('/api/leagues/connect', {}, 'https://evil.test');
assert.equal(requests.length, 0);
const response = await request('/api/leagues/connect', { provider: 'cbs', leagueId: 'fixture', accessToken: token });
assert.equal(requests[0].options.credentials, 'same-origin');
assert.equal(requests[0].options.redirect, 'error');
assert.equal(requests[0].options.method, 'POST');
assert(!JSON.stringify(response).includes(token));
assert.equal(response.teams[0].teamId, '8');
assert(!(await request('/api/leagues/connect', {}, 'https://irontuna.com', true)).message.includes(token));

// Run the actual popup against a browser API stub, including serialized functions.
const elements = new Map();
const el = id => { if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, disabled: false, hidden: false, addEventListener(type, fn) { this[type] = fn; }, replaceChildren(...children) { this.children = children; this.value = children[0]?.value; } }); return elements.get(id); };
const calls = [];
const context = vm.createContext({ leagueFromUrl, readCbsAccess, ironTunaRequest, URL, document: { getElementById: el, createElement: () => ({}) }, chrome: { tabs: { query: async filter => filter.active ? [{ id: 1, url: 'https://fixture.football.cbssports.com/' }] : [{ id: 2, url: 'https://irontuna.com/my-league' }] }, scripting: { executeScript: async req => {
  calls.push(req);
  if (req.func === readCbsAccess) return [{ result: { leagueId: 'fixture', accessToken: token } }];
  if (req.args[0] === '/api/auth/me') return [{ result: { signedIn: true } }];
  if (req.args[0].endsWith('/team')) return [{ result: { ok: true } }];
  return [{ result: { ok: true, league: { id: 'abc-123', name: 'Fixture' }, needsTeam: true, teams: [{ teamId: '8', name: 'Tuna' }] } }];
} } } });
const popup = fs.readFileSync(new URL('popup.js', root), 'utf8').replace(/^import[^\n]+\n/, '');
await vm.runInContext('(async()=>{' + popup + '})()', context);
assert.equal(el('connect').disabled, false);
await el('connect').click();
assert.equal(el('teamSection').hidden, false);
assert.equal(el('team').value, '8');
assert(calls.some(c => c.args[0] === '/api/leagues/connect' && c.args[1].accessToken === token));
await el('saveTeam').click();
assert.match(el('status').textContent, /Your team is saved/);
assert(!/localStorage|sessionStorage|chrome\.storage|document\.cookie/.test(source + popup));
console.log('CBS extension: permissions, host validation, token parsing, request boundaries, redaction, connect and team selection passed.');
