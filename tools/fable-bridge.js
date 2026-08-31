#!/usr/bin/env node
/*
 * Iron Tuna -> Fable bridge
 * ------------------------------------------------------------------
 * Relays questions from the in-app Fable panel to `claude -p --model fable`,
 * so draft-night answers run on your Claude subscription instead of being
 * billed against the Anthropic API.
 *
 * Run it before your draft:
 *     node tools/fable-bridge.js
 *
 * Then open irontuna.com/auctiondraft?admin=1 and the Fable panel will
 * connect to it automatically.
 *
 * Binds 127.0.0.1 only -- nothing else on your network can reach it.
 */

const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.FABLE_BRIDGE_PORT || 8787);
const MODEL = process.env.FABLE_BRIDGE_MODEL || 'fable';
const ASK_TIMEOUT_MS = Number(process.env.FABLE_BRIDGE_TIMEOUT_MS || 300000);

/*
 * On Windows `claude` on PATH is a .cmd shim, which Node's spawn() cannot exec
 * without a shell -- and routing a multi-kilobyte system prompt through cmd.exe
 * quoting is a good way to get a mangled prompt. The shim just points at a
 * native claude.exe, so find that and spawn it directly: no shell, argv passed
 * verbatim, no length or escaping limits.
 */
function resolveClaude() {
  if (process.env.FABLE_BRIDGE_CLAUDE) {
    return { cmd: process.env.FABLE_BRIDGE_CLAUDE, shell: false };
  }
  if (process.platform !== 'win32') return { cmd: 'claude', shell: false };

  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules',
      '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  }
  const home = os.homedir();
  candidates.push(path.join(home, '.local', 'bin', 'claude.exe'));
  candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'));
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'claude.exe'));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return { cmd: c, shell: false }; } catch (e) {}
  }
  return { cmd: 'claude', shell: true }; // last resort
}

const CLAUDE = resolveClaude();

const SYSTEM_PROMPT =
  "You are Iron Tuna, an elite fantasy-football draft strategist sitting next to the " +
  "manager during a live draft. You are given the live board state as JSON.\n\n" +
  "The three-number system: Proj = the likely market/auction price. Value = VBD worth " +
  "in a vacuum. You = the most THIS manager should personally pay given their roster, " +
  "budget, and the live market. A player is flagged RED when Proj is above Value (the " +
  "room will overpay) and GREEN when Proj is below Value (a bargain). A RED player is " +
  "not automatically a pass -- paying above Value is correct when his points-per-game " +
  "edge over replacement at his position beats what the same dollars buy elsewhere. " +
  "That is exactly why 'You' can sit above 'Value'.\n\n" +
  "Never invent Proj / Value / You numbers -- take those only from the JSON. For general " +
  "football knowledge (coaching staffs, target shares, depth charts, injuries, schemes) " +
  "use your own expertise, and say so if you are unsure of a specific stat.\n\n" +
  "You have room to actually think here -- this panel is for the harder between-nomination " +
  "questions, not for snap bid calls. Reason about budget shape, positional scarcity, what " +
  "the rest of the room still needs, and how the endgame plays out. Lead with the bottom " +
  "line, then give the reasoning that supports it. Plain prose, no markdown tables or " +
  "bullet lists -- this renders in a narrow chat panel.";

// ---------------------------------------------------------------- CORS

const ALLOWED_EXACT = new Set([
  'https://irontuna.com',
  'https://www.irontuna.com',
]);

function originAllowed(o) {
  if (!o) return false;
  if (ALLOWED_EXACT.has(o)) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(o)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(o)) return true;
  // Cloudflare Pages preview deploys
  if (/^https:\/\/[a-z0-9-]+\.iron-tuna\.pages\.dev$/.test(o)) return true;
  return false;
}

function cors(req, res) {
  const o = req.headers.origin;
  if (originAllowed(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    /*
     * Private Network Access. https://irontuna.com is a public origin reaching
     * a loopback address, which Chrome blocks (ERR_BLOCKED_BY_CLIENT) unless
     * the local server explicitly opts in on the preflight. Without this the
     * panel shows offline on the live site while working fine from localhost.
     */
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    return true;
  }
  return false;
}

// ------------------------------------------------------- child process env

/*
 * If the bridge happens to be launched from inside a Claude Code session, that
 * session's harness variables leak into the child and break auth ("Not logged
 * in"). Strip them so the child always resolves your normal credentials.
 */
function childEnv() {
  const e = { ...process.env };
  delete e.ANTHROPIC_BASE_URL;
  delete e.CLAUDECODE;
  delete e.CLAUDE_PID;
  delete e.CLAUDE_EFFORT;
  for (const k of Object.keys(e)) {
    if (k.startsWith('CLAUDE_CODE_') || k.startsWith('CLAUDE_AGENT_')) delete e[k];
  }
  return e;
}

function buildPrompt({ state, history, question }) {
  const parts = [];
  parts.push('LIVE DRAFT STATE (JSON):');
  parts.push(JSON.stringify(state));
  if (Array.isArray(history) && history.length) {
    parts.push('');
    parts.push('EARLIER IN THIS CONVERSATION:');
    history.slice(-6).forEach(m => {
      const who = m.role === 'bot' ? 'You' : 'Manager';
      parts.push(who + ': ' + String(m.text || '').slice(0, 1200));
    });
  }
  parts.push('');
  parts.push('MANAGER ASKS: ' + question);
  return parts.join('\n');
}

// ------------------------------------------------------------------ ask

function handleAsk(req, res, body) {
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'bad json' }));
  }

  const question = String(payload.question || '').trim();
  if (!question) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'no question' }));
  }

  const prompt = buildPrompt({
    state: payload.state || {},
    history: payload.history || [],
    question,
  });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = obj => {
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
  };

  // `--tools ""` disables every built-in tool: this path only ever needs prose
  // back, and it keeps draft data from reaching the filesystem. `--safe-mode`
  // drops CLAUDE.md / skills / plugins / MCP so the child starts clean and fast.
  const args = [
    '-p',
    '--model', MODEL,
    '--safe-mode',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--system-prompt', SYSTEM_PROMPT,
    '--tools', '',
  ];

  const started = Date.now();
  console.log('  ask: ' + question.slice(0, 60).replace(/\s+/g, ' ') + (question.length > 60 ? '…' : '') +
    '  (timeout ' + Math.round(ASK_TIMEOUT_MS / 1000) + 's)');
  let child;
  try {
    child = spawn(CLAUDE.cmd, args, {
      cwd: os.tmpdir(),
      env: childEnv(),
      shell: CLAUDE.shell,
      windowsHide: true,
    });
  } catch (e) {
    send({ error: 'could not start claude: ' + e.message });
    return res.end();
  }

  let full = '';
  let resultText = '';
  let cost = null;
  let stderr = '';
  let buf = '';

  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  child.stdout.on('data', chunk => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch (e) { continue; }

      // Partial text deltas. Shapes vary across CLI versions, so accept several
      // and treat the final `result` as authoritative either way.
      try {
        if (ev.type === 'stream_event' && ev.event) {
          const d = ev.event.delta;
          if (d && typeof d.text === 'string') { full += d.text; send({ delta: d.text }); }
        } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          const t = ev.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
          if (t && t.length > full.length) { send({ replace: t }); full = t; }
        } else if (ev.type === 'result') {
          if (typeof ev.result === 'string') resultText = ev.result;
          if (typeof ev.total_cost_usd === 'number') cost = ev.total_cost_usd;
          if (ev.is_error) send({ error: ev.result || 'claude reported an error' });
        }
      } catch (e) {}
    }
  });

  child.stderr.on('data', c => { stderr += c.toString().slice(0, 2000); });

  let closed = false;
  const finish = code => {
    if (closed) return;
    closed = true;
    console.log('  done in ' + Math.round((Date.now() - started) / 1000) + 's  (exit ' + code + ', ' +
      ((resultText || full || '').trim().length) + ' chars)');
    let text = (resultText || full || '').trim();
    // By far the most likely failure: the CLI is not signed in. Say what to do
    // about it rather than passing through a bare "/login" hint.
    if (/not logged in/i.test(text)) {
      const help = 'The claude CLI is not signed in, so Fable cannot answer.\n\n' +
        'In the bridge window: press Ctrl+C, run  claude auth login , sign in, ' +
        'then double-click Start-Fable.bat again.';
      send({ error: help });
      send({ done: true, text: '', cost, ms: Date.now() - started });
      return res.end();
    }
    if (!text) {
      send({ error: stderr.trim() || ('claude exited with code ' + code + ' and no output') });
    }
    send({ done: true, text, cost, ms: Date.now() - started });
    res.end();
  };

  child.on('error', e => { send({ error: e.message }); finish(-1); });
  child.on('close', finish);

  /*
   * Hard ceiling. Fable turns are long by design, but an unauthenticated or
   * wedged CLI can sit there producing nothing forever -- and a panel that
   * spins indefinitely during a live draft is worse than one that admits
   * defeat. Generous enough not to cut off real thinking.
   */
  const cap = setTimeout(() => {
    if (closed) return;
    try { child.kill(); } catch (e) {}
    send({ error: 'Fable did not respond within ' + Math.round(ASK_TIMEOUT_MS / 1000) + 's. If this keeps happening, check that `claude` is logged in (the bridge prints a login check at startup).' });
    finish(-2);
  }, ASK_TIMEOUT_MS);
  const clearCap = () => clearTimeout(cap);
  child.on('close', clearCap);
  child.on('error', clearCap);

  /*
   * If the panel gives up (user hit Stop, or closed the tab), kill the child so
   * we don't leave a Fable turn running in the background.
   *
   * This must listen on `res`, not `req`: the request stream has already ended
   * by the time we get here (the body was read before handleAsk was called), so
   * `req` emits 'close' immediately and would abort every single ask on arrival.
   */
  res.on('close', () => {
    if (!closed) {
      closed = true;
      clearTimeout(cap);
      try { child.kill(); } catch (e) {}
      console.log('  client disconnected after ' + Math.round((Date.now() - started) / 1000) + 's');
    }
  });
}

// ------------------------------------------------------------ auth probe

function probeAuth(cb) {
  let done = false;
  const finish = r => { if (!done) { done = true; cb(r); } };
  let child;
  try {
    child = spawn(CLAUDE.cmd,
      ['-p', '--model', 'haiku', '--safe-mode', '--output-format', 'json', '--tools', ''],
      { cwd: os.tmpdir(), env: childEnv(), shell: CLAUDE.shell, windowsHide: true });
  } catch (e) {
    return finish({ authed: false, detail: 'could not start claude: ' + e.message });
  }
  let out = '';
  child.stdin.on('error', () => {});
  child.stdin.end('Reply with the single word OK.');
  child.stdout.on('data', c => { out += c.toString(); });
  const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish({ authed: false, detail: 'timed out after 45s' }); }, 45000);
  child.on('error', e => { clearTimeout(timer); finish({ authed: false, detail: e.message }); });
  child.on('close', () => {
    clearTimeout(timer);
    let j = null;
    try { j = JSON.parse(out); } catch (e) {}
    if (j && j.is_error) return finish({ authed: false, detail: String(j.result || 'unknown error') });
    if (j && typeof j.result === 'string') return finish({ authed: true, detail: j.result.trim().slice(0, 120) });
    finish({ authed: false, detail: (out || 'no output from claude').slice(0, 200) });
  });
}

// --------------------------------------------------------------- server

const server = http.createServer((req, res) => {
  const ok = cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(ok ? 204 : 403);
    return res.end();
  }
  if (!ok) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'origin not allowed' }));
  }

  const path = (req.url || '').split('?')[0];

  if (req.method === 'GET' && path === '/health') {
    // ?deep=1 actually exercises the CLI to confirm you are logged in. It runs
    // on haiku, not fable -- auth is the same either way, and this keeps a
    // connection test from burning a real Fable turn.
    if (/[?&]deep=1/.test(req.url || '')) {
      return probeAuth(result => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ ok: true, model: MODEL, bin: CLAUDE.cmd }, result)));
      });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, model: MODEL, bin: CLAUDE.cmd }));
  }

  if (req.method === 'POST' && path === '/ask') {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 2e6) req.destroy();
    });
    req.on('end', () => handleAsk(req, res, body));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Iron Tuna -> Fable bridge');
  console.log('  listening on http://127.0.0.1:' + PORT + '  (model: ' + MODEL + ')');
  console.log('  claude binary: ' + CLAUDE.cmd + (CLAUDE.shell ? '  [via shell -- not ideal]' : ''));
  console.log('');
  process.stdout.write('  checking login... ');
  probeAuth(r => {
    if (r.authed) {
      console.log('OK, you are logged in.');
      console.log('');
      console.log('  Open your draft with ?admin=1 and the Fable panel will connect.');
    } else {
      console.log('FAILED.');
      console.log('  ' + r.detail);
      console.log('');
      console.log('  One-time fix: press Ctrl+C, then run');
      console.log('');
      console.log('      claude auth login');
      console.log('');
      console.log('  Sign in, then double-click Start-Fable.bat again.');
      console.log('  (The desktop app and this CLI keep separate logins.)');
    }
    console.log('  Ctrl+C to stop.');
    console.log('');
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error('  Port ' + PORT + ' is already in use, so the bridge did NOT start.');
    console.error('');
    console.error('  Something else on this machine is holding that port. Usually it is a');
    console.error('  local dev server for this same site rather than a second bridge, so');
    console.error('  look before assuming the bridge is already running:');
    console.error('');
    console.error('      Windows:  netstat -ano | findstr :' + PORT);
    console.error('      mac/Linux:  lsof -i :' + PORT);
    console.error('');
    console.error('  Either stop that program, or put the bridge on another port:');
    console.error('');
    console.error('      Windows:  set FABLE_BRIDGE_PORT=8788 && node tools\\fable-bridge.js');
    console.error('      mac/Linux:  FABLE_BRIDGE_PORT=8788 node tools/fable-bridge.js');
    console.error('');
    console.error('  Moving the port is only half the job. The panel\'s bridge URL is baked');
    console.error('  into index.html as 127.0.0.1:' + PORT + ' and there is no setting for it, so');
    console.error('  the panel keeps calling the old port until you repoint it. Paste this');
    console.error('  into the browser console on the draft page:');
    console.error('');
    console.error('      (()=>{const k="it_fable_dock_v1",s=JSON.parse(localStorage.getItem(k)||"{}");');
    console.error('       s.bridge="http://127.0.0.1:8788";localStorage.setItem(k,JSON.stringify(s));location.reload()})()');
    console.error('');
  } else {
    console.error('');
    console.error('  Bridge failed to start: ' + (e.message || e));
    console.error('');
  }
  process.exit(1);
});
