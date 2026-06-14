// Cloudflare Pages — advanced mode single Worker.
// Serves the static app AND the /api/coach LLM proxy. The API key stays server-side.
//
// Set in Cloudflare Pages -> Settings -> Environment variables:
//   LLM_API_KEY   (required, mark Encrypt)   OpenAI sk-...  or  Anthropic sk-ant-...
//   LLM_PROVIDER  (optional)  "openai" (default) | "anthropic"
//   LLM_MODEL     (optional)  gpt-4o-mini  /  claude-3-5-haiku-latest
//   ALLOWED_ORIGIN(optional)  your https://<project>.pages.dev  (locks the proxy to your site)
//   LLM_ENDPOINT  (optional)  OpenAI-compatible endpoint override
//   TURNSTILE_SECRET (optional) require a Turnstile token

const corsHeaders = (origin) => ({
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'vary': 'Origin',
});
const json = (obj, status, c) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...c } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/coach') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, c);
      return handleCoach(request, env, c);
    }
    return env.ASSETS.fetch(request);
  },
};

function originAllowed(request, env) {
  const allow = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allow.length) return true;
  const o = request.headers.get('Origin');
  return o && allow.includes(o);
}

async function handleCoach(request, env, c) {
  if (!originAllowed(request, env)) return json({ error: 'Origin not allowed' }, 403, c);
  if (!env.LLM_API_KEY) return json({ error: 'Server missing LLM_API_KEY' }, 500, c);
  if (Number(request.headers.get('content-length') || 0) > 80000) return json({ error: 'Payload too large' }, 413, c);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400, c); }
  const system = String(body.system || '').slice(0, 40000);
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-12);
  const wantStream = !!body.stream;

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile, request.headers.get('cf-connecting-ip'));
    if (!ok) return json({ error: 'Verification failed' }, 403, c);
  }
  if (env.RATE_KV) {
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const k = 'rl:' + ip;
    const n = parseInt((await env.RATE_KV.get(k)) || '0', 10);
    if (n >= 30) return json({ error: 'Rate limit — give it a moment.' }, 429, c);
    await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 600 });
  }

  const provider = (env.LLM_PROVIDER || 'openai').toLowerCase();
  try {
    let upstream;
    if (provider === 'anthropic') {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.LLM_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: env.LLM_MODEL || 'claude-3-5-haiku-latest', max_tokens: 700, system, messages, stream: wantStream }),
      });
    } else {
      upstream = await fetch(env.LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.LLM_API_KEY },
        body: JSON.stringify({ model: env.LLM_MODEL || 'gpt-4o-mini', temperature: 0.4, max_tokens: 700, messages: [{ role: 'system', content: system }, ...messages], stream: wantStream }),
      });
    }
    if (!upstream.ok) { const j = await upstream.json().catch(() => ({})); return json({ error: (j.error && j.error.message) || ('Provider ' + upstream.status) }, 502, c); }
    if (wantStream) return streamResponse(upstream, provider, c);
    const j = await upstream.json();
    const text = provider === 'anthropic'
      ? (j.content && j.content[0] && j.content[0].text) || ''
      : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return json({ text }, 200, c);
  } catch (e) {
    return json({ error: String(e) }, 500, c);
  }
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret); form.append('response', token); if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}

function streamResponse(upstream, provider, c) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder(); const enc = new TextEncoder();
  let buf = '';
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); return; }
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          let delta = '';
          if (provider === 'anthropic') { if (j.type === 'content_block_delta' && j.delta && j.delta.text) delta = j.delta.text; }
          else { delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; }
          if (delta) controller.enqueue(enc.encode('data: ' + JSON.stringify(delta) + '\n\n'));
        } catch (e) {}
      }
    },
    cancel() { try { reader.cancel(); } catch (e) {} },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...c } });
}
