// deploy: activate STRIPE_SECRET_KEY (2026-06-20T21:27Z); LEADS_EXPORT_KEY + auth secrets (2026-06-28)
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

// Only reflect the CORS origin for our own site / Pages preview / localhost; any other
// origin falls back to the canonical host so third-party sites can't read these APIs in a
// browser. (Same-origin app requests are unaffected — CORS doesn't apply to them.)
const ALLOW_ORIGIN = o => !!o && (/^https?:\/\/(www\.)?irontuna\.com$/.test(o) || /\.pages\.dev$/.test(o) || /^https?:\/\/localhost(:\d+)?$/.test(o));
const SEC = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};
function secure(r) { for (const k in SEC) r.headers.set(k, SEC[k]); return r; }
const corsHeaders = (origin) => ({
  'access-control-allow-origin': ALLOW_ORIGIN(origin) ? origin : 'https://irontuna.com',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'vary': 'Origin',
});
// Per-IP rate limit using RATE_KV. Fails OPEN if RATE_KV isn't bound (no breakage), so it
// only takes effect once the KV namespace is attached in Cloudflare.
async function rl(env, request, bucket, max, ttlSec) {
  if (!env.RATE_KV) return false;
  try {
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const k = 'rl:' + bucket + ':' + ip;
    const n = parseInt((await env.RATE_KV.get(k)) || '0', 10);
    if (n >= max) return true;
    await env.RATE_KV.put(k, String(n + 1), { expirationTtl: ttlSec });
    return false;
  } catch (e) { return false; }
}
// ── the post-draft section, and the one switch that opens it ────────────────
// The in-season tools are built and deployed but not open: it is draft season,
// and every one of them needs a played week before it has anything to say. Until
// POST_DRAFT_OPEN is "1" in the Cloudflare vars, every route in POST_DRAFT_PAGES
// serves /post-draft (the waiting-list gate) instead of itself.
//
// This is enforced HERE rather than in the page, because a client-side lock on a
// static asset is a suggestion: the HTML ships to the browser either way and
// anyone can read it. The worker never hands over the page at all.
//
// The escape hatch is `?preview=<LEADS_EXPORT_KEY>` — the same owner secret the
// leads export and the odds status route already use. It sets a short-lived
// cookie so the owner can click around the section instead of re-appending the
// key to every URL.
// The in-season section. Every route here is DEPLOYED but CLOSED until
// POST_DRAFT_OPEN is set: the worker serves /post-draft in their place, so the
// reader keeps the URL they clicked and the page that opens there later is the
// one they were promised. The lock is here rather than in the pages because a
// static asset locked by its own JavaScript is a suggestion; the HTML reaches
// the browser either way. tools/test-asset-routing.mjs and tools/test-seo.mjs
// both read this set, so a page added to the section cannot be left ungated or
// advertised in the sitemap while the gate is shut.
const POST_DRAFT_PAGES = new Set(['/faab', '/weekly-intel', '/rankings', '/vegas-edge',
  '/what-they-arent-telling-you', '/game-intel', '/waivers', '/dfs', '/my-league', '/player-intel']);
function POST_DRAFT_OPEN(env) { return String(env && env.POST_DRAFT_OPEN || '') === '1'; }
function postDraftPreview(env, url, request) {
  if (adminOk(env, url.searchParams.get('preview'))) return true;
  try { return adminOk(env, parseCookie(request.headers.get('Cookie'))['it_pd_preview']); } catch (e) { return false; }
}
function adminOk(env, key) { return !!env.LEADS_EXPORT_KEY && timingSafeEq(String(key || ''), env.LEADS_EXPORT_KEY); }
const json = (obj, status, c) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...SEC, ...c } });

// ── auth helpers (magic-link login + device cap) ──
function b64urlEncode(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlToBytes(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const b = atob(str); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
async function hmacSign(secret, data) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)); return b64urlEncode(new Uint8Array(sig)); }
function timingSafeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function makeToken(secret, obj) { const p = b64urlEncode(new TextEncoder().encode(JSON.stringify(obj))); return p + '.' + await hmacSign(secret, p); }
async function readToken(secret, token) { const parts = (token || '').split('.'); if (parts.length !== 2) return null; if (!timingSafeEq(parts[1], await hmacSign(secret, parts[0]))) return null; try { const o = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); if (o.exp && Date.now() > o.exp) return null; return o; } catch (e) { return null; } }
function parseCookie(str) { const o = {}; (str || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
// Comped accounts: these emails always have full access, no purchase required.
// Kept in code (not the DB) so owner access survives a DB reset. Module scope so
// /api/admin/grant can tell you when a DB row is redundant, and so /api/admin/
// revoke can warn that it cannot remove access granted here.
//
// This list is for OWNER access. To comp someone else, use /api/admin/grant —
// a third party's address does not belong in a source file, and git history
// keeps it forever.
const COMPED_EMAILS = ['kennethrubinstein@gmail.com', 'kennethrubinstein@icloud.com'];
async function isEntitled(env, email) {
  // Authoritative: the entitlements table, written only on a VERIFIED-paid session
  // (see /api/checkout/verify + stripe-webhook). Do NOT fall back to contacts:
  // /api/checkout writes a 'purchase' contact at checkout START, before payment.
  if (!email) return false;
  if (COMPED_EMAILS.includes(String(email).toLowerCase().trim())) return true;
  if (!env.LEADS_DB) return false;
  try { return !!(await env.LEADS_DB.prepare('SELECT 1 FROM entitlements WHERE email=?').bind(email).first()); } catch (e) { return false; }
}
async function grantEntitlement(env, email) {
  if (!email || !env.LEADS_DB) return;
  try { await env.LEADS_DB.prepare('INSERT OR REPLACE INTO entitlements (email, product, paid_at) VALUES (?, ?, ?)').bind(email.toLowerCase(), 'bundle', Date.now()).run(); } catch (e) {}
}
async function revokeEntitlement(env, email) {
  // Pull paid access on refund / chargeback: removes the entitlement and signs
  // the user out everywhere (so they can't restore on another device).
  if (!email || !env.LEADS_DB) return;
  const e = email.toLowerCase();
  try { await env.LEADS_DB.prepare('DELETE FROM entitlements WHERE email=?').bind(e).run(); } catch (err) {}
  try { await env.LEADS_DB.prepare('DELETE FROM sessions WHERE email=?').bind(e).run(); } catch (err) {}
}
async function chargeEmail(env, ch) {
  let email = (ch && ch.billing_details && ch.billing_details.email) || (ch && ch.receipt_email) || null;
  if (!email && ch && ch.id && env.STRIPE_SECRET_KEY) {
    try { const r = await fetch('https://api.stripe.com/v1/charges/' + encodeURIComponent(ch.id), { headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } }); const cj = await r.json(); email = (cj.billing_details && cj.billing_details.email) || cj.receipt_email || null; } catch (e) {}
  }
  return email;
}
async function sendLoginEmail(env, email, link) {
  if (!env.RESEND_API_KEY) return;
  const from = env.EMAIL_FROM || 'Iron Tuna <login@irontuna.com>';
  const html = '<div style="font-family:system-ui,Arial;max-width:480px"><h2 style="color:#0b1117">Sign in to Iron Tuna</h2><p>Tap to unlock your purchase on this device:</p><p><a href="' + link + '" style="background:#e3b53a;color:#1a1205;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Sign in to Iron Tuna</a></p><p style="color:#667;font-size:13px">This link expires in 15 minutes and can be used once. If you did not request it, ignore this email.</p></div>';
  try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: from, to: email, subject: 'Your Iron Tuna sign-in link', html: html }) }); } catch (e) {}
}
// The comp email is deliberately not sendLoginEmail. That one says "unlock your
// purchase", which is the wrong sentence for someone who never bought anything,
// and it swallows every failure — fine for a self-serve login that answers
// ok:true either way, useless for an admin who needs to know whether the thing
// they just sent actually left the building. So this one reports what happened.
async function sendCompEmail(env, email, link, days) {
  if (!env.RESEND_API_KEY) return { sent: false, error: 'RESEND_API_KEY is not set' };
  const from = env.EMAIL_FROM || 'Iron Tuna <login@irontuna.com>';
  const life = days === 1 ? '24 hours' : days + ' days';
  const html = '<div style="font-family:system-ui,Arial;max-width:480px"><h2 style="color:#0b1117">You have free access to Iron Tuna</h2><p>Someone at Iron Tuna comped you the full bundle — every draft tool, board and premium insight, no payment needed.</p><p><a href="' + link + '" style="background:#e3b53a;color:#1a1205;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Open Iron Tuna</a></p><p style="color:#667;font-size:13px">This link works once and expires in ' + life + '. After that you can get back in any time at <a href="https://irontuna.com/auctiondraft?signin=1">irontuna.com/auctiondraft</a> with this address — the access itself does not expire.</p></div>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: from, to: email, subject: 'Your free access to Iron Tuna', html: html })
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = (j && (j.message || j.error || j.name)) || ''; } catch (e) {}
      return { sent: false, error: 'Resend returned ' + r.status + (detail ? ': ' + detail : '') };
    }
    return { sent: true, error: null };
  } catch (e) { return { sent: false, error: (e && e.message) || 'network error' }; }
}

// ── projections data kept server-side (not shipped in the client HTML) ──
const IT_KEY = 'IT_pk_7c1a93f0';
const PROJ_KEY = 'tn$9xQ27z';
let _PROJ_ENC = null; // memoized XOR+base64 payload (same every request; encode once per isolate)
function _xb64encode(str, key) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ^ key.charCodeAt(i % key.length));
  return btoa(bin);
}
// ── 2026 insight sets kept server-side: premium (Draft Day unlock) + vault (email opt-in) ──
let _INS_ENC = null;
// ── X (Twitter) auto-post pool: public insight titles + drop-page URLs, extracted by tools/extract-insight-pool.mjs ──
const INSIGHTS_X_POOL = [{"id":"auction-insights-2026-07-04-0","format":"auction","title":"Patrick Mahomes is a reputation trap if drafted as a top-tier fantasy QB","play":"Only buy if he falls into the Herbert tier.","stat":"-4% to -7% versus an elite-QB price","url":"https://irontuna.com/auction-insights-2026-07-04","date":"2026-07-04"},{"id":"auction-insights-2026-07-04-1","format":"auction","title":"Miami is the most fragile fantasy ecosystem in football","play":"Treat Miami outside Achane as a mostly avoid situation in redraft.","stat":"-10% to -15% team passing expectation versus league median","url":"https://irontuna.com/auction-insights-2026-07-04","date":"2026-07-04"},{"id":"auction-insights-2026-07-04-2","format":"auction","title":"Bijan Robinson is still a smash talent, but his market no longer leaves room for hidden upside","play":"Excellent pick, not an exploitable inefficiency.","stat":"-1% to +4% versus price","url":"https://irontuna.com/auction-insights-2026-07-04","date":"2026-07-04"},{"id":"auction-insights-2026-07-04-3","format":"auction","title":"Jaylen Waddle is a major fantasy winner from moving to Denver","play":"Strong upside WR2 target.","stat":"+12% to +18% versus price if the market is still anchored to damaged Miami context","url":"https://irontuna.com/auction-insights-2026-07-04","date":"2026-07-04"},{"id":"auction-insights-2026-07-04-4","format":"auction","title":"Trey McBride is one of the few expensive tight ends still likely to return value","play":"Pay up if you want a weekly structural edge.","stat":"+5% to +10% versus price because the role is truly elite","url":"https://irontuna.com/auction-insights-2026-07-04","date":"2026-07-04"},{"id":"auction-insights-2026-07-09-0","format":"auction","title":"Drake Maye is the best elite-QB value","play":"Aggressively target in round structures where he goes after Allen/Lamar/Hurts.","stat":"+6% to +10% versus current price","url":"https://irontuna.com/auction-insights-2026-07-09","date":"2026-07-09"},{"id":"auction-insights-2026-07-09-1","format":"auction","title":"New England became a classic year-three quarterback breakout setup in one offseason","play":"The Patriots are one of the best stackable offenses in fantasy.","stat":"+5% to +8% team-pass expectation relative to market conservatism","url":"https://irontuna.com/auction-insights-2026-07-09","date":"2026-07-09"},{"id":"auction-insights-2026-07-09-2","format":"auction","title":"De’Von Achane is being supported almost entirely by talent rather than environment","play":"Draft for ceiling, but understand the offense can collapse around him.","stat":"-4% to -8% versus if he were in the 2025 Miami environment","url":"https://irontuna.com/auction-insights-2026-07-09","date":"2026-07-09"},{"id":"auction-insights-2026-07-09-3","format":"auction","title":"CeeDee Lamb remains elite but is less likely to monopolize the offense with George Pickens still there","play":"Near market, not a screaming value.","stat":"slightly more efficiency, slightly less pure volume","url":"https://irontuna.com/auction-insights-2026-07-09","date":"2026-07-09"},{"id":"auction-insights-2026-07-09-4","format":"auction","title":"Isaiah Likely is the best late-round TE target","play":"One of the best cheap TE targets in the player pool.","stat":"+12% to +18% versus late-round cost","url":"https://irontuna.com/auction-insights-2026-07-09","date":"2026-07-09"},{"id":"auction-insights-2026-07-16-0","format":"auction","title":"Josh Allen remains the safest overall QB1, but not the best pure value","play":"Draft him if you want floor dominance, not because he is discounted.","stat":"+0% to +4% versus price","url":"https://irontuna.com/auction-insights-2026-07-16","date":"2026-07-16"},{"id":"auction-insights-2026-07-16-1","format":"auction","title":"Arizona is the clearest macro fade because the offense got worse and the schedule got harder","play":"Draft Trey McBride because he can beat team weakness, but haircut the rest.","stat":"-5% to -10% to broad Cardinals scoring environment","url":"https://irontuna.com/auction-insights-2026-07-16","date":"2026-07-16"},{"id":"auction-insights-2026-07-16-2","format":"auction","title":"Jahmyr Gibbs is appropriately expensive","play":"Pay up if you want stability, but do not expect a big discount.","stat":"-1% to +3% versus price","url":"https://irontuna.com/auction-insights-2026-07-16","date":"2026-07-16"},{"id":"auction-insights-2026-07-16-3","format":"auction","title":"Puka Nacua is expensive and still deserves it","play":"No need to galaxy-brain fade.","stat":"0% to +5% versus market","url":"https://irontuna.com/auction-insights-2026-07-16","date":"2026-07-16"},{"id":"auction-insights-2026-07-16-4","format":"auction","title":"Tyler Warren is one of the best breakout TE values","play":"Priority target if you miss McBride/Bowers.","stat":"+10% to +14% versus price","url":"https://irontuna.com/auction-insights-2026-07-16","date":"2026-07-16"},{"id":"auction-insights-2026-07-23-0","format":"auction","title":"Lamar Jackson’s market still prices old rushing certainty, but the current projection is more fragile than Allen/Maye","play":"Draft, but prefer him only if he slips.","stat":"-2% to -5% versus market if drafted as a clear top-two QB","url":"https://irontuna.com/auction-insights-2026-07-23","date":"2026-07-23"},{"id":"auction-insights-2026-07-23-1","format":"auction","title":"James Cook is one of the best prices on the board","play":"Aggressively target in round-two or round-three builds.","stat":"+8% to +12% versus price","url":"https://irontuna.com/auction-insights-2026-07-23","date":"2026-07-23"},{"id":"auction-insights-2026-07-23-2","format":"auction","title":"Ashton Jeanty has one of the widest and most attractive ranges at running back","play":"Clear target, but avoid overleveraging at ceiling price.","stat":"+10% to +18% if he takes more of the Raiders’ high-value touches than projected","url":"https://irontuna.com/auction-insights-2026-07-23","date":"2026-07-23"},{"id":"auction-insights-2026-07-23-3","format":"auction","title":"DJ Moore is a big winner in Buffalo","play":"One of my favorite WR targets outside the top tier.","stat":"+10% to +14% versus price if health holds","url":"https://irontuna.com/auction-insights-2026-07-23","date":"2026-07-23"},{"id":"auction-insights-2026-07-23-4","format":"auction","title":"Jaxon Smith-Njigba is the safest WR in the pool, not necessarily the highest ceiling","play":"Great anchor in full PPR, less urgent in standard.","stat":"fair to slightly positive at price","url":"https://irontuna.com/auction-insights-2026-07-23","date":"2026-07-23"},{"id":"auction-insights-2026-07-30-0","format":"auction","title":"The 2026 PUP return-window change slightly increases stash value","play":"Be more aggressive with shallow-bench IR/PUP specs.","stat":"+5% to +10% roster utility for early-season stashes","url":"https://irontuna.com/auction-insights-2026-07-30","date":"2026-07-30"},{"id":"auction-insights-2026-07-30-1","format":"auction","title":"Detroit’s offense gets the single cleanest schedule signal in the league","play":"Do not fade Gibbs, Amon-Ra, or Jameson on “too expensive” schedule arguments.","stat":"+2% to +4% to Lions pass-catcher and RB expectation versus neutral schedule","url":"https://irontuna.com/auction-insights-2026-07-30","date":"2026-07-30"},{"id":"auction-insights-2026-07-30-2","format":"auction","title":"The Rams’ late-season schedule is a hidden playoff risk","play":"Prefer Puka and Stafford more than ancillary Rams in managed leagues.","stat":"-1.0 to -1.8 fantasy points per game in playoff weeks for volatile Rams pieces","url":"https://irontuna.com/auction-insights-2026-07-30","date":"2026-07-30"},{"id":"auction-insights-2026-07-30-3","format":"auction","title":"Trevor Lawrence is still one of the cleanest bounce-forward bets","play":"Target as a post-elite QB with top-five upside.","stat":"+5% to +9% versus current draft cost if the volume stays high","url":"https://irontuna.com/auction-insights-2026-07-30","date":"2026-07-30"},{"id":"auction-insights-2026-07-30-4","format":"auction","title":"Arizona’s quarterback downgrade actually strengthens McBride’s target-floor case","play":"Best in full PPR.","stat":"catch floor intact, TD ceiling somewhat capped","url":"https://irontuna.com/auction-insights-2026-07-30","date":"2026-07-30"},{"id":"auction-insights-2026-08-06-0","format":"auction","title":"Cleveland’s team environment should improve more than the public thinks","play":"Target Browns as a secondary breakout offense, especially cheaper pieces.","stat":"+6% to +9% offense-level efficiency versus 2025","url":"https://irontuna.com/auction-insights-2026-08-06","date":"2026-08-06"},{"id":"auction-insights-2026-08-06-1","format":"auction","title":"New York Giants volume is likely to shift from three-WR spread to heavier TE/RB personnel","play":"Upweight Isaiah Likely and backs, slightly downweight secondary Giants WRs.","stat":"WR target concentration drops slightly; TE and RB route value rises","url":"https://irontuna.com/auction-insights-2026-08-06","date":"2026-08-06"},{"id":"auction-insights-2026-08-06-2","format":"auction","title":"Allen’s path to another QB1 finish now runs more through efficiency than raw rushing expansion","play":"Rank him first, but do not expect a major rushing spike.","stat":"his median is intact, but ceiling is more +3 passing TDs than +100 rushing yards","url":"https://irontuna.com/auction-insights-2026-08-06","date":"2026-08-06"},{"id":"auction-insights-2026-08-06-3","format":"auction","title":"Tennessee’s offense should throw deeper in 2026","play":"Favor Titans WR spike-week bets over “safe floor” builds.","stat":"+0.8 to +1.5 aDOT-related boom weeks for Titans WRs, with added volatility","url":"https://irontuna.com/auction-insights-2026-08-06","date":"2026-08-06"},{"id":"auction-insights-2026-08-06-4","format":"auction","title":"Klint Kubiak’s arrival is mildly positive for Bowers because the Raiders need easy middle-of-field offense","play":"Slight upgrade versus static-rank assumptions.","stat":"","url":"https://irontuna.com/auction-insights-2026-08-06","date":"2026-08-06"},{"id":"auction-insights-2026-08-10-0","format":"auction","title":"Buffalo combines elite QB play, top-tier line play, and a major WR upgrade","play":"Be willing to stack Bills more aggressively than market norms.","stat":"+4% to +6% passing efficiency spillover across the offense","url":"https://irontuna.com/auction-insights-2026-08-10","date":"2026-08-10"},{"id":"auction-insights-2026-08-10-1","format":"auction","title":"Maye’s 2025 efficiency profile was not fluky","play":"Use him as your preferred premium QB spend after Allen.","stat":"another 300-plus fantasy-point season is the base case","url":"https://irontuna.com/auction-insights-2026-08-10","date":"2026-08-10"},{"id":"auction-insights-2026-08-10-2","format":"auction","title":"Denver has one of the cleanest offensive-line and schedule combinations for fantasy","play":"Lean into Denver receivers and ancillary backs at fair prices.","stat":"+3% to +6% to Bo Nix and Broncos skill-player efficiency","url":"https://irontuna.com/auction-insights-2026-08-10","date":"2026-08-10"},{"id":"auction-insights-2026-08-10-3","format":"auction","title":"Kyren’s hard schedule amplifies the risk of smaller volume","play":"Take Kyren less in managed leagues than in best ball.","stat":"-0.5 FPPG or so from environment","url":"https://irontuna.com/auction-insights-2026-08-10","date":"2026-08-10"},{"id":"auction-insights-2026-08-10-4","format":"auction","title":"Loveland’s biggest hidden drag is schedule irregularity, not target competition","play":"Slightly better in best ball than managed redraft.","stat":"","url":"https://irontuna.com/auction-insights-2026-08-10","date":"2026-08-10"},{"id":"auction-insights-2026-08-13-0","format":"auction","title":"The Jets’ schedule opens softer than the market is pricing","play":"Front-load Jets in best-ball and early-season DFS.","stat":"front-half offensive boost, especially for startable Jets in September","url":"https://irontuna.com/auction-insights-2026-08-13","date":"2026-08-13"},{"id":"auction-insights-2026-08-13-1","format":"auction","title":"The Tunsil protection case for Daniels is on hold","play":"Maintain high upside exposure, especially stacked with Terry or Okonkwo.","stat":"protection upside withdrawn until Tunsil returns; rushing floor unchanged","url":"https://irontuna.com/auction-insights-2026-08-13","date":"2026-08-13"},{"id":"auction-insights-2026-08-13-2","format":"auction","title":"Philadelphia’s passing tree got narrower after the A.J. Brown trade, but the schedule got friendlier","play":"Treat Eagles receivers as role-up bets, not offense-up bets.","stat":"DeVonta Smith and Dallas Goedert gain target share, but overall passing efficiency modestly falls","url":"https://irontuna.com/auction-insights-2026-08-13","date":"2026-08-13"},{"id":"auction-insights-2026-08-13-3","format":"auction","title":"Dallas’ passing efficiency should keep Javonte’s touchdown odds healthy","play":"Neutral to slightly positive at fair mid-round price.","stat":"modest TD expectation upside despite hard schedule","url":"https://irontuna.com/auction-insights-2026-08-13","date":"2026-08-13"},{"id":"auction-insights-2026-08-13-4","format":"auction","title":"Drake London is one of the best WR values on the board","play":"Strong target in round-two builds.","stat":"+8% to +12% versus price","url":"https://irontuna.com/auction-insights-2026-08-13","date":"2026-08-13"},{"id":"auction-insights-2026-08-17-0","format":"auction","title":"Chicago’s 2026 schedule creates unusual weekly-prep volatility","play":"Draft Bears talent, but expect more week-to-week variance than rankings imply.","stat":"small downgrade to fragile rookies and secondary pieces, little effect on stars","url":"https://irontuna.com/auction-insights-2026-08-17","date":"2026-08-17"},{"id":"auction-insights-2026-08-17-1","format":"auction","title":"Hurts’ favorable schedule prevents a stronger fade","play":"Treat Hurts as appropriately priced, not undervalued.","stat":"schedule gives back roughly half the passing downgrade","url":"https://irontuna.com/auction-insights-2026-08-17","date":"2026-08-17"},{"id":"auction-insights-2026-08-17-2","format":"auction","title":"Dallas Goedert is a direct beneficiary of the A.J. Brown trade","play":"Strong mid-round TE target in full PPR.","stat":"+8% to +12% versus prior target baselines","url":"https://irontuna.com/auction-insights-2026-08-17","date":"2026-08-17"},{"id":"auction-insights-2026-08-17-3","format":"auction","title":"Blake Corum is the most important handcuff-plus back in fantasy","play":"Priority target wherever Kyren is expensive.","stat":"+15% to +25% versus late-round price if workload even partially equalizes","url":"https://irontuna.com/auction-insights-2026-08-17","date":"2026-08-17"},{"id":"auction-insights-2026-08-17-4","format":"auction","title":"Rome Odunze is one of the best breakout WR bets in fantasy","play":"Priority target in the WR2/WR3 range.","stat":"+12% to +18% versus price","url":"https://irontuna.com/auction-insights-2026-08-17","date":"2026-08-17"},{"id":"auction-insights-2026-08-20-0","format":"auction","title":"Green Bay’s late-season home weather is a real hidden edge","play":"Bump Lambeau-based Packers in fantasy playoff tiebreakers.","stat":"modest passing downgrade for visiting warm-weather teams and a slight run-game boost for Green Bay","url":"https://irontuna.com/auction-insights-2026-08-20","date":"2026-08-20"},{"id":"auction-insights-2026-08-20-1","format":"auction","title":"Purdy’s weapon room is stronger but target competition is real","play":"Buy Purdy more than individual non-Evans ancillary receivers.","stat":"higher efficiency, slightly lower concentration","url":"https://irontuna.com/auction-insights-2026-08-20","date":"2026-08-20"},{"id":"auction-insights-2026-08-20-2","format":"auction","title":"Harold Fannin Jr. is exactly the sort of second-wave tight end to buy in deeper leagues","play":"Strong upside target.","stat":"+10% to +16% versus cost if Cleveland’s scheme change lands","url":"https://irontuna.com/auction-insights-2026-08-20","date":"2026-08-20"},{"id":"auction-insights-2026-08-20-3","format":"auction","title":"Kenneth Walker is one of the biggest team-change winners in fantasy","play":"Strong target if the market has not fully internalized the landing spot.","stat":"+10% to +15% versus old-team expectation","url":"https://irontuna.com/auction-insights-2026-08-20","date":"2026-08-20"},{"id":"auction-insights-2026-08-20-4","format":"auction","title":"Romeo Doubs’ signing matters because it raises New England’s pass-game floor, not because it crushes A.J. Brown","play":"Stack Maye/Brown freely.","stat":"offense-wide efficiency positive, small target-share negative to secondary Patriots","url":"https://irontuna.com/auction-insights-2026-08-20","date":"2026-08-20"},{"id":"auction-insights-2026-08-24-0","format":"auction","title":"The anytime onside-kick declaration rule marginally helps trailing pass volume","play":"Ignore in projections, but it slightly raises spike-week tail outcomes.","stat":"tiny league-wide effect, biggest for elite QBs in negative script","url":"https://irontuna.com/auction-insights-2026-08-24","date":"2026-08-24"},{"id":"auction-insights-2026-08-24-1","format":"auction","title":"Justin Herbert is the best midrange QB value","play":"Target as the ideal balance of floor and discount.","stat":"+8% to +12% versus market","url":"https://irontuna.com/auction-insights-2026-08-24","date":"2026-08-24"},{"id":"auction-insights-2026-08-24-2","format":"auction","title":"Kraft gets a slight late-season bump from Green Bay weather context","play":"Subtle playoff tiebreaker upgrade.","stat":"more red-zone and short-area emphasis late in the year","url":"https://irontuna.com/auction-insights-2026-08-24","date":"2026-08-24"},{"id":"auction-insights-2026-08-24-3","format":"auction","title":"Baltimore’s loss of Ricard, Likely, and Linderbaum is the first meaningful structural hit to Henry’s fantasy value in a while","play":"Take him, but downgrade slightly against younger elites.","stat":"-2% to -5% rushing efficiency and short-yardage conversion risk","url":"https://irontuna.com/auction-insights-2026-08-24","date":"2026-08-24"},{"id":"auction-insights-2026-08-24-4","format":"auction","title":"Tetairoa McMillan remains a good player in a less obvious team context","play":"Take when he falls; do not force.","stat":"fair price with moderate upside","url":"https://irontuna.com/auction-insights-2026-08-24","date":"2026-08-24"},{"id":"auction-insights-2026-08-27-0","format":"auction","title":"The Ravens lost hidden support structure on offense","play":"Still draft stars, but do not overproject Ravens role players.","stat":"slight efficiency drag on Lamar/Henry/Andrews relative to 2025 peak usage","url":"https://irontuna.com/auction-insights-2026-08-27","date":"2026-08-27"},{"id":"auction-insights-2026-08-27-1","format":"auction","title":"Matthew Stafford is expensive for a non-rushing QB, but the case is real","play":"Fine in best ball, slightly less appealing in managed leagues because of the closing schedule.","stat":"+0% to +4% versus price in season-long, but lower playoff comfort","url":"https://irontuna.com/auction-insights-2026-08-27","date":"2026-08-27"},{"id":"auction-insights-2026-08-27-2","format":"auction","title":"Mark Andrews remains touchdown-reliant","play":"Better in TE-premium and TD-heavy formats than standard PPR.","stat":"fair in standard, slightly weak in full PPR","url":"https://irontuna.com/auction-insights-2026-08-27","date":"2026-08-27"},{"id":"auction-insights-2026-08-27-3","format":"auction","title":"Barkley’s target environment can improve post-A.J. Brown","play":"Neutral overall, but less exciting than his name value suggests.","stat":"small reception boost, modest touchdown-rate decline","url":"https://irontuna.com/auction-insights-2026-08-27","date":"2026-08-27"},{"id":"auction-insights-2026-08-27-4","format":"auction","title":"Deebo Samuel in San Francisco is still a scheme-created weekly flex, not a true target king","play":"Better in best ball.","stat":"boom/bust flex rather than dependable WR2","url":"https://irontuna.com/auction-insights-2026-08-27","date":"2026-08-27"},{"id":"auction-insights-2026-08-31-0","format":"auction","title":"The 49ers became more top-heavy at WR","play":"Prefer best-ball over managed redraft for secondary 49ers pass-catchers.","stat":"more efficient passing, less certainty for individual target-share monsters outside maybe Evans in…","url":"https://irontuna.com/auction-insights-2026-08-31","date":"2026-08-31"},{"id":"auction-insights-2026-08-31-1","format":"auction","title":"Jordan Love is quietly viable because the Packers’ late-season conditions favor their offense","play":"Acceptable late-round tournament QB.","stat":"small playoff boost","url":"https://irontuna.com/auction-insights-2026-08-31","date":"2026-08-31"},{"id":"auction-insights-2026-08-31-2","format":"auction","title":"Likely’s outlook is stronger in full PPR than standard because his edge comes from route volume and target design, not guaranteed touchdowns","play":"Bump in full PPR.","stat":"","url":"https://irontuna.com/auction-insights-2026-08-31","date":"2026-08-31"},{"id":"auction-insights-2026-08-31-3","format":"auction","title":"David Montgomery is vulnerable to subtle erosion","play":"Fade slightly unless he falls.","stat":"-4% to -8% versus price if drafters assume unchanged efficiency","url":"https://irontuna.com/auction-insights-2026-08-31","date":"2026-08-31"},{"id":"auction-insights-2026-08-31-4","format":"auction","title":"Buffalo’s WR room is now good enough that Allen stacks should be diversified, not concentrated only on one pass-catcher","play":"Mix DJ Moore and Dalton Kincaid/Dawson Knox around Allen exposures.","stat":"flatter weekly distribution","url":"https://irontuna.com/auction-insights-2026-08-31","date":"2026-08-31"},{"id":"auction-insights-2026-09-03-0","format":"auction","title":"Kansas City is no longer a pure pass funnel","play":"Boost efficiency pieces, slightly lower assumed volume for pass-catchers.","stat":"more QB rushing and more efficient early-down rushing than recent KC teams, with a small cap on raw…","url":"https://irontuna.com/auction-insights-2026-09-03","date":"2026-09-03"},{"id":"auction-insights-2026-09-03-1","format":"auction","title":"Cam Ward is interesting mainly because Brian Daboll should unlock more deep attempts","play":"Superflex stash, not standard redraft starter.","stat":"+8% to +12% versus last year, still volatile","url":"https://irontuna.com/auction-insights-2026-09-03","date":"2026-09-03"},{"id":"auction-insights-2026-09-03-2","format":"auction","title":"T.J. Hockenson remains a risky rebound candidate","play":"Avoid as a primary tight end in shallow leagues.","stat":"below-market confidence until health and role stabilize","url":"https://irontuna.com/auction-insights-2026-09-03","date":"2026-09-03"},{"id":"auction-insights-2026-09-03-3","format":"auction","title":"Offensive-line dispersion matters more this year because so many star skill players changed teams","play":"","stat":"widen YPC/YPA expectations more aggressively than usual by line quality","url":"https://irontuna.com/auction-insights-2026-09-03","date":"2026-09-03"},{"id":"auction-insights-2026-09-03-4","format":"auction","title":"Justin Fields in Kansas City is more interesting for real football than traditional redraft unless he actually starts","play":"Ignore in shallow redraft, monitor in superflex and deep best ball.","stat":"situational rushing splash only, role unspecified","url":"https://irontuna.com/auction-insights-2026-09-03","date":"2026-09-03"},{"id":"snake-insights-2026-07-04-0","format":"snake","title":"Patrick Mahomes is a reputation trap if drafted as a top-tier fantasy QB","play":"Only buy if he falls into the Herbert tier.","stat":"-4% to -7% versus an elite-QB price","url":"https://irontuna.com/snake-insights-2026-07-04","date":"2026-07-04"},{"id":"snake-insights-2026-07-04-1","format":"snake","title":"Miami is the most fragile fantasy ecosystem in football","play":"Treat Miami outside Achane as a mostly avoid situation in redraft.","stat":"-10% to -15% team passing expectation versus league median","url":"https://irontuna.com/snake-insights-2026-07-04","date":"2026-07-04"},{"id":"snake-insights-2026-07-04-2","format":"snake","title":"Bijan Robinson is still a smash talent, but his market no longer leaves room for hidden upside","play":"Excellent pick, not an exploitable inefficiency.","stat":"-1% to +4% versus price","url":"https://irontuna.com/snake-insights-2026-07-04","date":"2026-07-04"},{"id":"snake-insights-2026-07-04-3","format":"snake","title":"Jaylen Waddle is a major fantasy winner from moving to Denver","play":"Strong upside WR2 target.","stat":"+12% to +18% versus price if the market is still anchored to damaged Miami context","url":"https://irontuna.com/snake-insights-2026-07-04","date":"2026-07-04"},{"id":"snake-insights-2026-07-04-4","format":"snake","title":"Trey McBride is one of the few expensive tight ends still likely to return value","play":"Pay up if you want a weekly structural edge.","stat":"+5% to +10% versus price because the role is truly elite","url":"https://irontuna.com/snake-insights-2026-07-04","date":"2026-07-04"},{"id":"snake-insights-2026-07-09-0","format":"snake","title":"Drake Maye is the best elite-QB value","play":"Aggressively target in round structures where he goes after Allen/Lamar/Hurts.","stat":"+6% to +10% versus current price","url":"https://irontuna.com/snake-insights-2026-07-09","date":"2026-07-09"},{"id":"snake-insights-2026-07-09-1","format":"snake","title":"New England became a classic year-three quarterback breakout setup in one offseason","play":"The Patriots are one of the best stackable offenses in fantasy.","stat":"+5% to +8% team-pass expectation relative to market conservatism","url":"https://irontuna.com/snake-insights-2026-07-09","date":"2026-07-09"},{"id":"snake-insights-2026-07-09-2","format":"snake","title":"De’Von Achane is being supported almost entirely by talent rather than environment","play":"Draft for ceiling, but understand the offense can collapse around him.","stat":"-4% to -8% versus if he were in the 2025 Miami environment","url":"https://irontuna.com/snake-insights-2026-07-09","date":"2026-07-09"},{"id":"snake-insights-2026-07-09-3","format":"snake","title":"CeeDee Lamb remains elite but is less likely to monopolize the offense with George Pickens still there","play":"Near market, not a screaming value.","stat":"slightly more efficiency, slightly less pure volume","url":"https://irontuna.com/snake-insights-2026-07-09","date":"2026-07-09"},{"id":"snake-insights-2026-07-09-4","format":"snake","title":"Isaiah Likely is the best late-round TE target","play":"One of the best cheap TE targets in the player pool.","stat":"+12% to +18% versus late-round cost","url":"https://irontuna.com/snake-insights-2026-07-09","date":"2026-07-09"},{"id":"snake-insights-2026-07-16-0","format":"snake","title":"Josh Allen remains the safest overall QB1, but not the best pure value","play":"Draft him if you want floor dominance, not because he is discounted.","stat":"+0% to +4% versus price","url":"https://irontuna.com/snake-insights-2026-07-16","date":"2026-07-16"},{"id":"snake-insights-2026-07-16-1","format":"snake","title":"Arizona is the clearest macro fade because the offense got worse and the schedule got harder","play":"Draft Trey McBride because he can beat team weakness, but haircut the rest.","stat":"-5% to -10% to broad Cardinals scoring environment","url":"https://irontuna.com/snake-insights-2026-07-16","date":"2026-07-16"},{"id":"snake-insights-2026-07-16-2","format":"snake","title":"Jahmyr Gibbs is appropriately expensive","play":"Pay up if you want stability, but do not expect a big discount.","stat":"-1% to +3% versus price","url":"https://irontuna.com/snake-insights-2026-07-16","date":"2026-07-16"},{"id":"snake-insights-2026-07-16-3","format":"snake","title":"Puka Nacua is expensive and still deserves it","play":"No need to galaxy-brain fade.","stat":"0% to +5% versus market","url":"https://irontuna.com/snake-insights-2026-07-16","date":"2026-07-16"},{"id":"snake-insights-2026-07-16-4","format":"snake","title":"Tyler Warren is one of the best breakout TE values","play":"Priority target if you miss McBride/Bowers.","stat":"+10% to +14% versus price","url":"https://irontuna.com/snake-insights-2026-07-16","date":"2026-07-16"},{"id":"snake-insights-2026-07-23-0","format":"snake","title":"Lamar Jackson’s market still prices old rushing certainty, but the current projection is more fragile than Allen/Maye","play":"Draft, but prefer him only if he slips.","stat":"-2% to -5% versus market if drafted as a clear top-two QB","url":"https://irontuna.com/snake-insights-2026-07-23","date":"2026-07-23"},{"id":"snake-insights-2026-07-23-1","format":"snake","title":"James Cook is one of the best prices on the board","play":"Aggressively target in round-two or round-three builds.","stat":"+8% to +12% versus price","url":"https://irontuna.com/snake-insights-2026-07-23","date":"2026-07-23"},{"id":"snake-insights-2026-07-23-2","format":"snake","title":"Ashton Jeanty has one of the widest and most attractive ranges at running back","play":"Clear target, but avoid overleveraging at ceiling price.","stat":"+10% to +18% if he takes more of the Raiders’ high-value touches than projected","url":"https://irontuna.com/snake-insights-2026-07-23","date":"2026-07-23"},{"id":"snake-insights-2026-07-23-3","format":"snake","title":"DJ Moore is a big winner in Buffalo","play":"One of my favorite WR targets outside the top tier.","stat":"+10% to +14% versus price if health holds","url":"https://irontuna.com/snake-insights-2026-07-23","date":"2026-07-23"},{"id":"snake-insights-2026-07-23-4","format":"snake","title":"Jaxon Smith-Njigba is the safest WR in the pool, not necessarily the highest ceiling","play":"Great anchor in full PPR, less urgent in standard.","stat":"fair to slightly positive at price","url":"https://irontuna.com/snake-insights-2026-07-23","date":"2026-07-23"},{"id":"snake-insights-2026-07-30-0","format":"snake","title":"The 2026 PUP return-window change slightly increases stash value","play":"Be more aggressive with shallow-bench IR/PUP specs.","stat":"+5% to +10% roster utility for early-season stashes","url":"https://irontuna.com/snake-insights-2026-07-30","date":"2026-07-30"},{"id":"snake-insights-2026-07-30-1","format":"snake","title":"Detroit’s offense gets the single cleanest schedule signal in the league","play":"Do not fade Gibbs, Amon-Ra, or Jameson on “too expensive” schedule arguments.","stat":"+2% to +4% to Lions pass-catcher and RB expectation versus neutral schedule","url":"https://irontuna.com/snake-insights-2026-07-30","date":"2026-07-30"},{"id":"snake-insights-2026-07-30-2","format":"snake","title":"The Rams’ late-season schedule is a hidden playoff risk","play":"Prefer Puka and Stafford more than ancillary Rams in managed leagues.","stat":"-1.0 to -1.8 fantasy points per game in playoff weeks for volatile Rams pieces","url":"https://irontuna.com/snake-insights-2026-07-30","date":"2026-07-30"},{"id":"snake-insights-2026-07-30-3","format":"snake","title":"Trevor Lawrence is still one of the cleanest bounce-forward bets","play":"Target as a post-elite QB with top-five upside.","stat":"+5% to +9% versus current draft cost if the volume stays high","url":"https://irontuna.com/snake-insights-2026-07-30","date":"2026-07-30"},{"id":"snake-insights-2026-07-30-4","format":"snake","title":"Arizona’s quarterback downgrade actually strengthens McBride’s target-floor case","play":"Best in full PPR.","stat":"catch floor intact, TD ceiling somewhat capped","url":"https://irontuna.com/snake-insights-2026-07-30","date":"2026-07-30"},{"id":"snake-insights-2026-08-06-0","format":"snake","title":"Cleveland’s team environment should improve more than the public thinks","play":"Target Browns as a secondary breakout offense, especially cheaper pieces.","stat":"+6% to +9% offense-level efficiency versus 2025","url":"https://irontuna.com/snake-insights-2026-08-06","date":"2026-08-06"},{"id":"snake-insights-2026-08-06-1","format":"snake","title":"New York Giants volume is likely to shift from three-WR spread to heavier TE/RB personnel","play":"Upweight Isaiah Likely and backs, slightly downweight secondary Giants WRs.","stat":"WR target concentration drops slightly; TE and RB route value rises","url":"https://irontuna.com/snake-insights-2026-08-06","date":"2026-08-06"},{"id":"snake-insights-2026-08-06-2","format":"snake","title":"Allen’s path to another QB1 finish now runs more through efficiency than raw rushing expansion","play":"Rank him first, but do not expect a major rushing spike.","stat":"his median is intact, but ceiling is more +3 passing TDs than +100 rushing yards","url":"https://irontuna.com/snake-insights-2026-08-06","date":"2026-08-06"},{"id":"snake-insights-2026-08-06-3","format":"snake","title":"Tennessee’s offense should throw deeper in 2026","play":"Favor Titans WR spike-week bets over “safe floor” builds.","stat":"+0.8 to +1.5 aDOT-related boom weeks for Titans WRs, with added volatility","url":"https://irontuna.com/snake-insights-2026-08-06","date":"2026-08-06"},{"id":"snake-insights-2026-08-06-4","format":"snake","title":"Klint Kubiak’s arrival is mildly positive for Bowers because the Raiders need easy middle-of-field offense","play":"Slight upgrade versus static-rank assumptions.","stat":"","url":"https://irontuna.com/snake-insights-2026-08-06","date":"2026-08-06"},{"id":"snake-insights-2026-08-10-0","format":"snake","title":"Buffalo combines elite QB play, top-tier line play, and a major WR upgrade","play":"Be willing to stack Bills more aggressively than market norms.","stat":"+4% to +6% passing efficiency spillover across the offense","url":"https://irontuna.com/snake-insights-2026-08-10","date":"2026-08-10"},{"id":"snake-insights-2026-08-10-1","format":"snake","title":"Maye’s 2025 efficiency profile was not fluky","play":"Use him as your preferred premium QB spend after Allen.","stat":"another 300-plus fantasy-point season is the base case","url":"https://irontuna.com/snake-insights-2026-08-10","date":"2026-08-10"},{"id":"snake-insights-2026-08-10-2","format":"snake","title":"Denver has one of the cleanest offensive-line and schedule combinations for fantasy","play":"Lean into Denver receivers and ancillary backs at fair prices.","stat":"+3% to +6% to Bo Nix and Broncos skill-player efficiency","url":"https://irontuna.com/snake-insights-2026-08-10","date":"2026-08-10"},{"id":"snake-insights-2026-08-10-3","format":"snake","title":"Kyren’s hard schedule amplifies the risk of smaller volume","play":"Take Kyren less in managed leagues than in best ball.","stat":"-0.5 FPPG or so from environment","url":"https://irontuna.com/snake-insights-2026-08-10","date":"2026-08-10"},{"id":"snake-insights-2026-08-10-4","format":"snake","title":"Loveland’s biggest hidden drag is schedule irregularity, not target competition","play":"Slightly better in best ball than managed redraft.","stat":"","url":"https://irontuna.com/snake-insights-2026-08-10","date":"2026-08-10"},{"id":"snake-insights-2026-08-13-0","format":"snake","title":"The Jets’ schedule opens softer than the market is pricing","play":"Front-load Jets in best-ball and early-season DFS.","stat":"front-half offensive boost, especially for startable Jets in September","url":"https://irontuna.com/snake-insights-2026-08-13","date":"2026-08-13"},{"id":"snake-insights-2026-08-13-1","format":"snake","title":"The Tunsil protection case for Daniels is on hold","play":"Maintain high upside exposure, especially stacked with Terry or Okonkwo.","stat":"protection upside withdrawn until Tunsil returns; rushing floor unchanged","url":"https://irontuna.com/snake-insights-2026-08-13","date":"2026-08-13"},{"id":"snake-insights-2026-08-13-2","format":"snake","title":"Philadelphia’s passing tree got narrower after the A.J. Brown trade, but the schedule got friendlier","play":"Treat Eagles receivers as role-up bets, not offense-up bets.","stat":"DeVonta Smith and Dallas Goedert gain target share, but overall passing efficiency modestly falls","url":"https://irontuna.com/snake-insights-2026-08-13","date":"2026-08-13"},{"id":"snake-insights-2026-08-13-3","format":"snake","title":"Dallas’ passing efficiency should keep Javonte’s touchdown odds healthy","play":"Neutral to slightly positive at fair mid-round price.","stat":"modest TD expectation upside despite hard schedule","url":"https://irontuna.com/snake-insights-2026-08-13","date":"2026-08-13"},{"id":"snake-insights-2026-08-13-4","format":"snake","title":"Drake London is one of the best WR values on the board","play":"Strong target in round-two builds.","stat":"+8% to +12% versus price","url":"https://irontuna.com/snake-insights-2026-08-13","date":"2026-08-13"},{"id":"snake-insights-2026-08-17-0","format":"snake","title":"Chicago’s 2026 schedule creates unusual weekly-prep volatility","play":"Draft Bears talent, but expect more week-to-week variance than rankings imply.","stat":"small downgrade to fragile rookies and secondary pieces, little effect on stars","url":"https://irontuna.com/snake-insights-2026-08-17","date":"2026-08-17"},{"id":"snake-insights-2026-08-17-1","format":"snake","title":"Hurts’ favorable schedule prevents a stronger fade","play":"Treat Hurts as appropriately priced, not undervalued.","stat":"schedule gives back roughly half the passing downgrade","url":"https://irontuna.com/snake-insights-2026-08-17","date":"2026-08-17"},{"id":"snake-insights-2026-08-17-2","format":"snake","title":"Dallas Goedert is a direct beneficiary of the A.J. Brown trade","play":"Strong mid-round TE target in full PPR.","stat":"+8% to +12% versus prior target baselines","url":"https://irontuna.com/snake-insights-2026-08-17","date":"2026-08-17"},{"id":"snake-insights-2026-08-17-3","format":"snake","title":"Blake Corum is the most important handcuff-plus back in fantasy","play":"Priority target wherever Kyren is expensive.","stat":"+15% to +25% versus late-round price if workload even partially equalizes","url":"https://irontuna.com/snake-insights-2026-08-17","date":"2026-08-17"},{"id":"snake-insights-2026-08-17-4","format":"snake","title":"Rome Odunze is one of the best breakout WR bets in fantasy","play":"Priority target in the WR2/WR3 range.","stat":"+12% to +18% versus price","url":"https://irontuna.com/snake-insights-2026-08-17","date":"2026-08-17"},{"id":"snake-insights-2026-08-20-0","format":"snake","title":"Green Bay’s late-season home weather is a real hidden edge","play":"Bump Lambeau-based Packers in fantasy playoff tiebreakers.","stat":"modest passing downgrade for visiting warm-weather teams and a slight run-game boost for Green Bay","url":"https://irontuna.com/snake-insights-2026-08-20","date":"2026-08-20"},{"id":"snake-insights-2026-08-20-1","format":"snake","title":"Purdy’s weapon room is stronger but target competition is real","play":"Buy Purdy more than individual non-Evans ancillary receivers.","stat":"higher efficiency, slightly lower concentration","url":"https://irontuna.com/snake-insights-2026-08-20","date":"2026-08-20"},{"id":"snake-insights-2026-08-20-2","format":"snake","title":"Harold Fannin Jr. is exactly the sort of second-wave tight end to buy in deeper leagues","play":"Strong upside target.","stat":"+10% to +16% versus cost if Cleveland’s scheme change lands","url":"https://irontuna.com/snake-insights-2026-08-20","date":"2026-08-20"},{"id":"snake-insights-2026-08-20-3","format":"snake","title":"Kenneth Walker is one of the biggest team-change winners in fantasy","play":"Strong target if the market has not fully internalized the landing spot.","stat":"+10% to +15% versus old-team expectation","url":"https://irontuna.com/snake-insights-2026-08-20","date":"2026-08-20"},{"id":"snake-insights-2026-08-20-4","format":"snake","title":"Romeo Doubs’ signing matters because it raises New England’s pass-game floor, not because it crushes A.J. Brown","play":"Stack Maye/Brown freely.","stat":"offense-wide efficiency positive, small target-share negative to secondary Patriots","url":"https://irontuna.com/snake-insights-2026-08-20","date":"2026-08-20"},{"id":"snake-insights-2026-08-24-0","format":"snake","title":"The anytime onside-kick declaration rule marginally helps trailing pass volume","play":"Ignore in projections, but it slightly raises spike-week tail outcomes.","stat":"tiny league-wide effect, biggest for elite QBs in negative script","url":"https://irontuna.com/snake-insights-2026-08-24","date":"2026-08-24"},{"id":"snake-insights-2026-08-24-1","format":"snake","title":"Justin Herbert is the best midrange QB value","play":"Target as the ideal balance of floor and discount.","stat":"+8% to +12% versus market","url":"https://irontuna.com/snake-insights-2026-08-24","date":"2026-08-24"},{"id":"snake-insights-2026-08-24-2","format":"snake","title":"Kraft gets a slight late-season bump from Green Bay weather context","play":"Subtle playoff tiebreaker upgrade.","stat":"more red-zone and short-area emphasis late in the year","url":"https://irontuna.com/snake-insights-2026-08-24","date":"2026-08-24"},{"id":"snake-insights-2026-08-24-3","format":"snake","title":"Baltimore’s loss of Ricard, Likely, and Linderbaum is the first meaningful structural hit to Henry’s fantasy value in a while","play":"Take him, but downgrade slightly against younger elites.","stat":"-2% to -5% rushing efficiency and short-yardage conversion risk","url":"https://irontuna.com/snake-insights-2026-08-24","date":"2026-08-24"},{"id":"snake-insights-2026-08-24-4","format":"snake","title":"Tetairoa McMillan remains a good player in a less obvious team context","play":"Take when he falls; do not force.","stat":"fair price with moderate upside","url":"https://irontuna.com/snake-insights-2026-08-24","date":"2026-08-24"},{"id":"snake-insights-2026-08-27-0","format":"snake","title":"The Ravens lost hidden support structure on offense","play":"Still draft stars, but do not overproject Ravens role players.","stat":"slight efficiency drag on Lamar/Henry/Andrews relative to 2025 peak usage","url":"https://irontuna.com/snake-insights-2026-08-27","date":"2026-08-27"},{"id":"snake-insights-2026-08-27-1","format":"snake","title":"Matthew Stafford is expensive for a non-rushing QB, but the case is real","play":"Fine in best ball, slightly less appealing in managed leagues because of the closing schedule.","stat":"+0% to +4% versus price in season-long, but lower playoff comfort","url":"https://irontuna.com/snake-insights-2026-08-27","date":"2026-08-27"},{"id":"snake-insights-2026-08-27-2","format":"snake","title":"Mark Andrews remains touchdown-reliant","play":"Better in TE-premium and TD-heavy formats than standard PPR.","stat":"fair in standard, slightly weak in full PPR","url":"https://irontuna.com/snake-insights-2026-08-27","date":"2026-08-27"},{"id":"snake-insights-2026-08-27-3","format":"snake","title":"Barkley’s target environment can improve post-A.J. Brown","play":"Neutral overall, but less exciting than his name value suggests.","stat":"small reception boost, modest touchdown-rate decline","url":"https://irontuna.com/snake-insights-2026-08-27","date":"2026-08-27"},{"id":"snake-insights-2026-08-27-4","format":"snake","title":"Deebo Samuel in San Francisco is still a scheme-created weekly flex, not a true target king","play":"Better in best ball.","stat":"boom/bust flex rather than dependable WR2","url":"https://irontuna.com/snake-insights-2026-08-27","date":"2026-08-27"},{"id":"snake-insights-2026-08-31-0","format":"snake","title":"The 49ers became more top-heavy at WR","play":"Prefer best-ball over managed redraft for secondary 49ers pass-catchers.","stat":"more efficient passing, less certainty for individual target-share monsters outside maybe Evans in…","url":"https://irontuna.com/snake-insights-2026-08-31","date":"2026-08-31"},{"id":"snake-insights-2026-08-31-1","format":"snake","title":"Jordan Love is quietly viable because the Packers’ late-season conditions favor their offense","play":"Acceptable late-round tournament QB.","stat":"small playoff boost","url":"https://irontuna.com/snake-insights-2026-08-31","date":"2026-08-31"},{"id":"snake-insights-2026-08-31-2","format":"snake","title":"Likely’s outlook is stronger in full PPR than standard because his edge comes from route volume and target design, not guaranteed touchdowns","play":"Bump in full PPR.","stat":"","url":"https://irontuna.com/snake-insights-2026-08-31","date":"2026-08-31"},{"id":"snake-insights-2026-08-31-3","format":"snake","title":"David Montgomery is vulnerable to subtle erosion","play":"Fade slightly unless he falls.","stat":"-4% to -8% versus price if drafters assume unchanged efficiency","url":"https://irontuna.com/snake-insights-2026-08-31","date":"2026-08-31"},{"id":"snake-insights-2026-08-31-4","format":"snake","title":"Buffalo’s WR room is now good enough that Allen stacks should be diversified, not concentrated only on one pass-catcher","play":"Mix DJ Moore and Dalton Kincaid/Dawson Knox around Allen exposures.","stat":"flatter weekly distribution","url":"https://irontuna.com/snake-insights-2026-08-31","date":"2026-08-31"},{"id":"snake-insights-2026-09-03-0","format":"snake","title":"Kansas City is no longer a pure pass funnel","play":"Boost efficiency pieces, slightly lower assumed volume for pass-catchers.","stat":"more QB rushing and more efficient early-down rushing than recent KC teams, with a small cap on raw…","url":"https://irontuna.com/snake-insights-2026-09-03","date":"2026-09-03"},{"id":"snake-insights-2026-09-03-1","format":"snake","title":"Cam Ward is interesting mainly because Brian Daboll should unlock more deep attempts","play":"Superflex stash, not standard redraft starter.","stat":"+8% to +12% versus last year, still volatile","url":"https://irontuna.com/snake-insights-2026-09-03","date":"2026-09-03"},{"id":"snake-insights-2026-09-03-2","format":"snake","title":"T.J. Hockenson remains a risky rebound candidate","play":"Avoid as a primary tight end in shallow leagues.","stat":"below-market confidence until health and role stabilize","url":"https://irontuna.com/snake-insights-2026-09-03","date":"2026-09-03"},{"id":"snake-insights-2026-09-03-3","format":"snake","title":"Offensive-line dispersion matters more this year because so many star skill players changed teams","play":"","stat":"widen YPC/YPA expectations more aggressively than usual by line quality","url":"https://irontuna.com/snake-insights-2026-09-03","date":"2026-09-03"},{"id":"snake-insights-2026-09-03-4","format":"snake","title":"Justin Fields in Kansas City is more interesting for real football than traditional redraft unless he actually starts","play":"Ignore in shallow redraft, monitor in superflex and deep best ball.","stat":"situational rushing splash only, role unspecified","url":"https://irontuna.com/snake-insights-2026-09-03","date":"2026-09-03"},{"id":"bestball-insights-2026-07-04-0","format":"bestball","title":"Patrick Mahomes is a reputation trap if drafted as a top-tier fantasy QB","play":"Only buy if he falls into the Herbert tier.","stat":"-4% to -7% versus an elite-QB price","url":"https://irontuna.com/bestball-insights-2026-07-04","date":"2026-07-04"},{"id":"bestball-insights-2026-07-04-1","format":"bestball","title":"Miami is the most fragile fantasy ecosystem in football","play":"Treat Miami outside Achane as a mostly avoid situation in redraft.","stat":"-10% to -15% team passing expectation versus league median","url":"https://irontuna.com/bestball-insights-2026-07-04","date":"2026-07-04"},{"id":"bestball-insights-2026-07-04-2","format":"bestball","title":"Bijan Robinson is still a smash talent, but his market no longer leaves room for hidden upside","play":"Excellent pick, not an exploitable inefficiency.","stat":"-1% to +4% versus price","url":"https://irontuna.com/bestball-insights-2026-07-04","date":"2026-07-04"},{"id":"bestball-insights-2026-07-04-3","format":"bestball","title":"Jaylen Waddle is a major fantasy winner from moving to Denver","play":"Strong upside WR2 target.","stat":"+12% to +18% versus price if the market is still anchored to damaged Miami context","url":"https://irontuna.com/bestball-insights-2026-07-04","date":"2026-07-04"},{"id":"bestball-insights-2026-07-04-4","format":"bestball","title":"Trey McBride is one of the few expensive tight ends still likely to return value","play":"Pay up if you want a weekly structural edge.","stat":"+5% to +10% versus price because the role is truly elite","url":"https://irontuna.com/bestball-insights-2026-07-04","date":"2026-07-04"},{"id":"bestball-insights-2026-07-09-0","format":"bestball","title":"Drake Maye is the best elite-QB value","play":"Aggressively target in round structures where he goes after Allen/Lamar/Hurts.","stat":"+6% to +10% versus current price","url":"https://irontuna.com/bestball-insights-2026-07-09","date":"2026-07-09"},{"id":"bestball-insights-2026-07-09-1","format":"bestball","title":"New England became a classic year-three quarterback breakout setup in one offseason","play":"The Patriots are one of the best stackable offenses in fantasy.","stat":"+5% to +8% team-pass expectation relative to market conservatism","url":"https://irontuna.com/bestball-insights-2026-07-09","date":"2026-07-09"},{"id":"bestball-insights-2026-07-09-2","format":"bestball","title":"De’Von Achane is being supported almost entirely by talent rather than environment","play":"Draft for ceiling, but understand the offense can collapse around him.","stat":"-4% to -8% versus if he were in the 2025 Miami environment","url":"https://irontuna.com/bestball-insights-2026-07-09","date":"2026-07-09"},{"id":"bestball-insights-2026-07-09-3","format":"bestball","title":"CeeDee Lamb remains elite but is less likely to monopolize the offense with George Pickens still there","play":"Near market, not a screaming value.","stat":"slightly more efficiency, slightly less pure volume","url":"https://irontuna.com/bestball-insights-2026-07-09","date":"2026-07-09"},{"id":"bestball-insights-2026-07-09-4","format":"bestball","title":"Isaiah Likely is the best late-round TE target","play":"One of the best cheap TE targets in the player pool.","stat":"+12% to +18% versus late-round cost","url":"https://irontuna.com/bestball-insights-2026-07-09","date":"2026-07-09"},{"id":"bestball-insights-2026-07-16-0","format":"bestball","title":"Josh Allen remains the safest overall QB1, but not the best pure value","play":"Draft him if you want floor dominance, not because he is discounted.","stat":"+0% to +4% versus price","url":"https://irontuna.com/bestball-insights-2026-07-16","date":"2026-07-16"},{"id":"bestball-insights-2026-07-16-1","format":"bestball","title":"Arizona is the clearest macro fade because the offense got worse and the schedule got harder","play":"Draft Trey McBride because he can beat team weakness, but haircut the rest.","stat":"-5% to -10% to broad Cardinals scoring environment","url":"https://irontuna.com/bestball-insights-2026-07-16","date":"2026-07-16"},{"id":"bestball-insights-2026-07-16-2","format":"bestball","title":"Jahmyr Gibbs is appropriately expensive","play":"Pay up if you want stability, but do not expect a big discount.","stat":"-1% to +3% versus price","url":"https://irontuna.com/bestball-insights-2026-07-16","date":"2026-07-16"},{"id":"bestball-insights-2026-07-16-3","format":"bestball","title":"Puka Nacua is expensive and still deserves it","play":"No need to galaxy-brain fade.","stat":"0% to +5% versus market","url":"https://irontuna.com/bestball-insights-2026-07-16","date":"2026-07-16"},{"id":"bestball-insights-2026-07-16-4","format":"bestball","title":"Tyler Warren is one of the best breakout TE values","play":"Priority target if you miss McBride/Bowers.","stat":"+10% to +14% versus price","url":"https://irontuna.com/bestball-insights-2026-07-16","date":"2026-07-16"},{"id":"bestball-insights-2026-07-23-0","format":"bestball","title":"Lamar Jackson’s market still prices old rushing certainty, but the current projection is more fragile than Allen/Maye","play":"Draft, but prefer him only if he slips.","stat":"-2% to -5% versus market if drafted as a clear top-two QB","url":"https://irontuna.com/bestball-insights-2026-07-23","date":"2026-07-23"},{"id":"bestball-insights-2026-07-23-1","format":"bestball","title":"James Cook is one of the best prices on the board","play":"Aggressively target in round-two or round-three builds.","stat":"+8% to +12% versus price","url":"https://irontuna.com/bestball-insights-2026-07-23","date":"2026-07-23"},{"id":"bestball-insights-2026-07-23-2","format":"bestball","title":"Ashton Jeanty has one of the widest and most attractive ranges at running back","play":"Clear target, but avoid overleveraging at ceiling price.","stat":"+10% to +18% if he takes more of the Raiders’ high-value touches than projected","url":"https://irontuna.com/bestball-insights-2026-07-23","date":"2026-07-23"},{"id":"bestball-insights-2026-07-23-3","format":"bestball","title":"DJ Moore is a big winner in Buffalo","play":"One of my favorite WR targets outside the top tier.","stat":"+10% to +14% versus price if health holds","url":"https://irontuna.com/bestball-insights-2026-07-23","date":"2026-07-23"},{"id":"bestball-insights-2026-07-23-4","format":"bestball","title":"Jaxon Smith-Njigba is the safest WR in the pool, not necessarily the highest ceiling","play":"Great anchor in full PPR, less urgent in standard.","stat":"fair to slightly positive at price","url":"https://irontuna.com/bestball-insights-2026-07-23","date":"2026-07-23"},{"id":"bestball-insights-2026-07-30-0","format":"bestball","title":"The 2026 PUP return-window change slightly increases stash value","play":"Be more aggressive with shallow-bench IR/PUP specs.","stat":"+5% to +10% roster utility for early-season stashes","url":"https://irontuna.com/bestball-insights-2026-07-30","date":"2026-07-30"},{"id":"bestball-insights-2026-07-30-1","format":"bestball","title":"Detroit’s offense gets the single cleanest schedule signal in the league","play":"Do not fade Gibbs, Amon-Ra, or Jameson on “too expensive” schedule arguments.","stat":"+2% to +4% to Lions pass-catcher and RB expectation versus neutral schedule","url":"https://irontuna.com/bestball-insights-2026-07-30","date":"2026-07-30"},{"id":"bestball-insights-2026-07-30-2","format":"bestball","title":"The Rams’ late-season schedule is a hidden playoff risk","play":"Prefer Puka and Stafford more than ancillary Rams in managed leagues.","stat":"-1.0 to -1.8 fantasy points per game in playoff weeks for volatile Rams pieces","url":"https://irontuna.com/bestball-insights-2026-07-30","date":"2026-07-30"},{"id":"bestball-insights-2026-07-30-3","format":"bestball","title":"Trevor Lawrence is still one of the cleanest bounce-forward bets","play":"Target as a post-elite QB with top-five upside.","stat":"+5% to +9% versus current draft cost if the volume stays high","url":"https://irontuna.com/bestball-insights-2026-07-30","date":"2026-07-30"},{"id":"bestball-insights-2026-07-30-4","format":"bestball","title":"Arizona’s quarterback downgrade actually strengthens McBride’s target-floor case","play":"Best in full PPR.","stat":"catch floor intact, TD ceiling somewhat capped","url":"https://irontuna.com/bestball-insights-2026-07-30","date":"2026-07-30"},{"id":"bestball-insights-2026-08-06-0","format":"bestball","title":"Cleveland’s team environment should improve more than the public thinks","play":"Target Browns as a secondary breakout offense, especially cheaper pieces.","stat":"+6% to +9% offense-level efficiency versus 2025","url":"https://irontuna.com/bestball-insights-2026-08-06","date":"2026-08-06"},{"id":"bestball-insights-2026-08-06-1","format":"bestball","title":"New York Giants volume is likely to shift from three-WR spread to heavier TE/RB personnel","play":"Upweight Isaiah Likely and backs, slightly downweight secondary Giants WRs.","stat":"WR target concentration drops slightly; TE and RB route value rises","url":"https://irontuna.com/bestball-insights-2026-08-06","date":"2026-08-06"},{"id":"bestball-insights-2026-08-06-2","format":"bestball","title":"Allen’s path to another QB1 finish now runs more through efficiency than raw rushing expansion","play":"Rank him first, but do not expect a major rushing spike.","stat":"his median is intact, but ceiling is more +3 passing TDs than +100 rushing yards","url":"https://irontuna.com/bestball-insights-2026-08-06","date":"2026-08-06"},{"id":"bestball-insights-2026-08-06-3","format":"bestball","title":"Tennessee’s offense should throw deeper in 2026","play":"Favor Titans WR spike-week bets over “safe floor” builds.","stat":"+0.8 to +1.5 aDOT-related boom weeks for Titans WRs, with added volatility","url":"https://irontuna.com/bestball-insights-2026-08-06","date":"2026-08-06"},{"id":"bestball-insights-2026-08-06-4","format":"bestball","title":"Klint Kubiak’s arrival is mildly positive for Bowers because the Raiders need easy middle-of-field offense","play":"Slight upgrade versus static-rank assumptions.","stat":"","url":"https://irontuna.com/bestball-insights-2026-08-06","date":"2026-08-06"},{"id":"bestball-insights-2026-08-10-0","format":"bestball","title":"Buffalo combines elite QB play, top-tier line play, and a major WR upgrade","play":"Be willing to stack Bills more aggressively than market norms.","stat":"+4% to +6% passing efficiency spillover across the offense","url":"https://irontuna.com/bestball-insights-2026-08-10","date":"2026-08-10"},{"id":"bestball-insights-2026-08-10-1","format":"bestball","title":"Maye’s 2025 efficiency profile was not fluky","play":"Use him as your preferred premium QB spend after Allen.","stat":"another 300-plus fantasy-point season is the base case","url":"https://irontuna.com/bestball-insights-2026-08-10","date":"2026-08-10"},{"id":"bestball-insights-2026-08-10-2","format":"bestball","title":"Denver has one of the cleanest offensive-line and schedule combinations for fantasy","play":"Lean into Denver receivers and ancillary backs at fair prices.","stat":"+3% to +6% to Bo Nix and Broncos skill-player efficiency","url":"https://irontuna.com/bestball-insights-2026-08-10","date":"2026-08-10"},{"id":"bestball-insights-2026-08-10-3","format":"bestball","title":"Kyren’s hard schedule amplifies the risk of smaller volume","play":"Take Kyren less in managed leagues than in best ball.","stat":"-0.5 FPPG or so from environment","url":"https://irontuna.com/bestball-insights-2026-08-10","date":"2026-08-10"},{"id":"bestball-insights-2026-08-10-4","format":"bestball","title":"Loveland’s biggest hidden drag is schedule irregularity, not target competition","play":"Slightly better in best ball than managed redraft.","stat":"","url":"https://irontuna.com/bestball-insights-2026-08-10","date":"2026-08-10"},{"id":"bestball-insights-2026-08-13-0","format":"bestball","title":"The Jets’ schedule opens softer than the market is pricing","play":"Front-load Jets in best-ball and early-season DFS.","stat":"front-half offensive boost, especially for startable Jets in September","url":"https://irontuna.com/bestball-insights-2026-08-13","date":"2026-08-13"},{"id":"bestball-insights-2026-08-13-1","format":"bestball","title":"The Tunsil protection case for Daniels is on hold","play":"Maintain high upside exposure, especially stacked with Terry or Okonkwo.","stat":"protection upside withdrawn until Tunsil returns; rushing floor unchanged","url":"https://irontuna.com/bestball-insights-2026-08-13","date":"2026-08-13"},{"id":"bestball-insights-2026-08-13-2","format":"bestball","title":"Philadelphia’s passing tree got narrower after the A.J. Brown trade, but the schedule got friendlier","play":"Treat Eagles receivers as role-up bets, not offense-up bets.","stat":"DeVonta Smith and Dallas Goedert gain target share, but overall passing efficiency modestly falls","url":"https://irontuna.com/bestball-insights-2026-08-13","date":"2026-08-13"},{"id":"bestball-insights-2026-08-13-3","format":"bestball","title":"Dallas’ passing efficiency should keep Javonte’s touchdown odds healthy","play":"Neutral to slightly positive at fair mid-round price.","stat":"modest TD expectation upside despite hard schedule","url":"https://irontuna.com/bestball-insights-2026-08-13","date":"2026-08-13"},{"id":"bestball-insights-2026-08-13-4","format":"bestball","title":"Drake London is one of the best WR values on the board","play":"Strong target in round-two builds.","stat":"+8% to +12% versus price","url":"https://irontuna.com/bestball-insights-2026-08-13","date":"2026-08-13"},{"id":"bestball-insights-2026-08-17-0","format":"bestball","title":"Chicago’s 2026 schedule creates unusual weekly-prep volatility","play":"Draft Bears talent, but expect more week-to-week variance than rankings imply.","stat":"small downgrade to fragile rookies and secondary pieces, little effect on stars","url":"https://irontuna.com/bestball-insights-2026-08-17","date":"2026-08-17"},{"id":"bestball-insights-2026-08-17-1","format":"bestball","title":"Hurts’ favorable schedule prevents a stronger fade","play":"Treat Hurts as appropriately priced, not undervalued.","stat":"schedule gives back roughly half the passing downgrade","url":"https://irontuna.com/bestball-insights-2026-08-17","date":"2026-08-17"},{"id":"bestball-insights-2026-08-17-2","format":"bestball","title":"Dallas Goedert is a direct beneficiary of the A.J. Brown trade","play":"Strong mid-round TE target in full PPR.","stat":"+8% to +12% versus prior target baselines","url":"https://irontuna.com/bestball-insights-2026-08-17","date":"2026-08-17"},{"id":"bestball-insights-2026-08-17-3","format":"bestball","title":"Blake Corum is the most important handcuff-plus back in fantasy","play":"Priority target wherever Kyren is expensive.","stat":"+15% to +25% versus late-round price if workload even partially equalizes","url":"https://irontuna.com/bestball-insights-2026-08-17","date":"2026-08-17"},{"id":"bestball-insights-2026-08-17-4","format":"bestball","title":"Rome Odunze is one of the best breakout WR bets in fantasy","play":"Priority target in the WR2/WR3 range.","stat":"+12% to +18% versus price","url":"https://irontuna.com/bestball-insights-2026-08-17","date":"2026-08-17"},{"id":"bestball-insights-2026-08-20-0","format":"bestball","title":"Green Bay’s late-season home weather is a real hidden edge","play":"Bump Lambeau-based Packers in fantasy playoff tiebreakers.","stat":"modest passing downgrade for visiting warm-weather teams and a slight run-game boost for Green Bay","url":"https://irontuna.com/bestball-insights-2026-08-20","date":"2026-08-20"},{"id":"bestball-insights-2026-08-20-1","format":"bestball","title":"Purdy’s weapon room is stronger but target competition is real","play":"Buy Purdy more than individual non-Evans ancillary receivers.","stat":"higher efficiency, slightly lower concentration","url":"https://irontuna.com/bestball-insights-2026-08-20","date":"2026-08-20"},{"id":"bestball-insights-2026-08-20-2","format":"bestball","title":"Harold Fannin Jr. is exactly the sort of second-wave tight end to buy in deeper leagues","play":"Strong upside target.","stat":"+10% to +16% versus cost if Cleveland’s scheme change lands","url":"https://irontuna.com/bestball-insights-2026-08-20","date":"2026-08-20"},{"id":"bestball-insights-2026-08-20-3","format":"bestball","title":"Kenneth Walker is one of the biggest team-change winners in fantasy","play":"Strong target if the market has not fully internalized the landing spot.","stat":"+10% to +15% versus old-team expectation","url":"https://irontuna.com/bestball-insights-2026-08-20","date":"2026-08-20"},{"id":"bestball-insights-2026-08-20-4","format":"bestball","title":"Romeo Doubs’ signing matters because it raises New England’s pass-game floor, not because it crushes A.J. Brown","play":"Stack Maye/Brown freely.","stat":"offense-wide efficiency positive, small target-share negative to secondary Patriots","url":"https://irontuna.com/bestball-insights-2026-08-20","date":"2026-08-20"},{"id":"bestball-insights-2026-08-24-0","format":"bestball","title":"The anytime onside-kick declaration rule marginally helps trailing pass volume","play":"Ignore in projections, but it slightly raises spike-week tail outcomes.","stat":"tiny league-wide effect, biggest for elite QBs in negative script","url":"https://irontuna.com/bestball-insights-2026-08-24","date":"2026-08-24"},{"id":"bestball-insights-2026-08-24-1","format":"bestball","title":"Justin Herbert is the best midrange QB value","play":"Target as the ideal balance of floor and discount.","stat":"+8% to +12% versus market","url":"https://irontuna.com/bestball-insights-2026-08-24","date":"2026-08-24"},{"id":"bestball-insights-2026-08-24-2","format":"bestball","title":"Kraft gets a slight late-season bump from Green Bay weather context","play":"Subtle playoff tiebreaker upgrade.","stat":"more red-zone and short-area emphasis late in the year","url":"https://irontuna.com/bestball-insights-2026-08-24","date":"2026-08-24"},{"id":"bestball-insights-2026-08-24-3","format":"bestball","title":"Baltimore’s loss of Ricard, Likely, and Linderbaum is the first meaningful structural hit to Henry’s fantasy value in a while","play":"Take him, but downgrade slightly against younger elites.","stat":"-2% to -5% rushing efficiency and short-yardage conversion risk","url":"https://irontuna.com/bestball-insights-2026-08-24","date":"2026-08-24"},{"id":"bestball-insights-2026-08-24-4","format":"bestball","title":"Tetairoa McMillan remains a good player in a less obvious team context","play":"Take when he falls; do not force.","stat":"fair price with moderate upside","url":"https://irontuna.com/bestball-insights-2026-08-24","date":"2026-08-24"},{"id":"bestball-insights-2026-08-27-0","format":"bestball","title":"The Ravens lost hidden support structure on offense","play":"Still draft stars, but do not overproject Ravens role players.","stat":"slight efficiency drag on Lamar/Henry/Andrews relative to 2025 peak usage","url":"https://irontuna.com/bestball-insights-2026-08-27","date":"2026-08-27"},{"id":"bestball-insights-2026-08-27-1","format":"bestball","title":"Matthew Stafford is expensive for a non-rushing QB, but the case is real","play":"Fine in best ball, slightly less appealing in managed leagues because of the closing schedule.","stat":"+0% to +4% versus price in season-long, but lower playoff comfort","url":"https://irontuna.com/bestball-insights-2026-08-27","date":"2026-08-27"},{"id":"bestball-insights-2026-08-27-2","format":"bestball","title":"Mark Andrews remains touchdown-reliant","play":"Better in TE-premium and TD-heavy formats than standard PPR.","stat":"fair in standard, slightly weak in full PPR","url":"https://irontuna.com/bestball-insights-2026-08-27","date":"2026-08-27"},{"id":"bestball-insights-2026-08-27-3","format":"bestball","title":"Barkley’s target environment can improve post-A.J. Brown","play":"Neutral overall, but less exciting than his name value suggests.","stat":"small reception boost, modest touchdown-rate decline","url":"https://irontuna.com/bestball-insights-2026-08-27","date":"2026-08-27"},{"id":"bestball-insights-2026-08-27-4","format":"bestball","title":"Deebo Samuel in San Francisco is still a scheme-created weekly flex, not a true target king","play":"Better in best ball.","stat":"boom/bust flex rather than dependable WR2","url":"https://irontuna.com/bestball-insights-2026-08-27","date":"2026-08-27"},{"id":"bestball-insights-2026-08-31-0","format":"bestball","title":"The 49ers became more top-heavy at WR","play":"Prefer best-ball over managed redraft for secondary 49ers pass-catchers.","stat":"more efficient passing, less certainty for individual target-share monsters outside maybe Evans in…","url":"https://irontuna.com/bestball-insights-2026-08-31","date":"2026-08-31"},{"id":"bestball-insights-2026-08-31-1","format":"bestball","title":"Jordan Love is quietly viable because the Packers’ late-season conditions favor their offense","play":"Acceptable late-round tournament QB.","stat":"small playoff boost","url":"https://irontuna.com/bestball-insights-2026-08-31","date":"2026-08-31"},{"id":"bestball-insights-2026-08-31-2","format":"bestball","title":"Likely’s outlook is stronger in full PPR than standard because his edge comes from route volume and target design, not guaranteed touchdowns","play":"Bump in full PPR.","stat":"","url":"https://irontuna.com/bestball-insights-2026-08-31","date":"2026-08-31"},{"id":"bestball-insights-2026-08-31-3","format":"bestball","title":"David Montgomery is vulnerable to subtle erosion","play":"Fade slightly unless he falls.","stat":"-4% to -8% versus price if drafters assume unchanged efficiency","url":"https://irontuna.com/bestball-insights-2026-08-31","date":"2026-08-31"},{"id":"bestball-insights-2026-08-31-4","format":"bestball","title":"Buffalo’s WR room is now good enough that Allen stacks should be diversified, not concentrated only on one pass-catcher","play":"Mix DJ Moore and Dalton Kincaid/Dawson Knox around Allen exposures.","stat":"flatter weekly distribution","url":"https://irontuna.com/bestball-insights-2026-08-31","date":"2026-08-31"},{"id":"bestball-insights-2026-09-03-0","format":"bestball","title":"Kansas City is no longer a pure pass funnel","play":"Boost efficiency pieces, slightly lower assumed volume for pass-catchers.","stat":"more QB rushing and more efficient early-down rushing than recent KC teams, with a small cap on raw…","url":"https://irontuna.com/bestball-insights-2026-09-03","date":"2026-09-03"},{"id":"bestball-insights-2026-09-03-1","format":"bestball","title":"Cam Ward is interesting mainly because Brian Daboll should unlock more deep attempts","play":"Superflex stash, not standard redraft starter.","stat":"+8% to +12% versus last year, still volatile","url":"https://irontuna.com/bestball-insights-2026-09-03","date":"2026-09-03"},{"id":"bestball-insights-2026-09-03-2","format":"bestball","title":"T.J. Hockenson remains a risky rebound candidate","play":"Avoid as a primary tight end in shallow leagues.","stat":"below-market confidence until health and role stabilize","url":"https://irontuna.com/bestball-insights-2026-09-03","date":"2026-09-03"},{"id":"bestball-insights-2026-09-03-3","format":"bestball","title":"Offensive-line dispersion matters more this year because so many star skill players changed teams","play":"","stat":"widen YPC/YPA expectations more aggressively than usual by line quality","url":"https://irontuna.com/bestball-insights-2026-09-03","date":"2026-09-03"},{"id":"bestball-insights-2026-09-03-4","format":"bestball","title":"Justin Fields in Kansas City is more interesting for real football than traditional redraft unless he actually starts","play":"Ignore in shallow redraft, monitor in superflex and deep best ball.","stat":"situational rushing splash only, role unspecified","url":"https://irontuna.com/bestball-insights-2026-09-03","date":"2026-09-03"}];
const INSIGHTS_PREMIUM = [{"code":"Q6","section":"QB","title":"The Patriots\u2019 upgraded schedule context helps Maye\u2019s weekly floor","players":"The Patriots\u2019; Maye; Jets; Browns","view":"Underpriced","core":"Current market writeups note a favorable schedule tailwind, and the Jets, Browns, and other soft-slate teams also cluster favorably in AFC context.","body":"New England's slate sets up gently, and for a young quarterback that's worth more than most rooms will pay. Market writeups already flag a favorable schedule tailwind, and the Jets, Browns, and other soft-slate teams cluster favorably in the AFC context, which means fewer weeks where Maye stares down a defense that can erase a passing game outright.\n\nFloor is what wins managed leagues at quarterback: you're not chasing his best Sunday, you're trimming his worst ones, and an extra 0.3 to 0.6 points per game from reduced extreme-matchup exposure compounds quietly across a season. Confidence sits at medium because preseason schedule strength is an estimate that drifts, so treat this as a strong tiebreaker rather than a thesis.\n\nThe case firms up in superflex and 2QB rooms, and in larger leagues where startable quarterbacks run out fast.","effect":"+0.3 to +0.6 FPPG from reduced extreme-matchup exposure","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"push him up in managed leagues, not just best ball.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"push him up in managed leagues, not just best ball.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"push him up in managed leagues, not just best ball.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q8","section":"QB","title":"Baltimore\u2019s personnel losses create more hidden drag than most drafters realize","players":"Baltimore; Losing Tyler Linderbaum; Patrick Ricard; Isaiah Likely","view":"Overpriced or discount required","core":"Losing Tyler Linderbaum, Patrick Ricard, and Isaiah Likely matters for QB stability and red-zone sequencing.","body":"Center play, fullback blocking, and a second tight end sound like roster minutiae until you trace what they do for a quarterback's box score. Tyler Linderbaum organized the interior protection, Patrick Ricard powered the heavy packages, and Isaiah Likely gave the red zone another live threat; lose all three and Lamar's stability behind the line and near the goal line takes a real, if invisible, hit.\n\nDrafters price the player and ignore the ecosystem, which is how a 0.4-to-0.8 point-per-game drag goes unpriced at the top of the position. In practice, don't pay the full elite-QB sticker: take him only when the room hands you a markdown. Confidence is medium because replacements can surprise, and superflex scarcity may still force your hand in 2QB formats, where paying closer to market remains defensible.","effect":"-0.4 to -0.8 FPPG for Lamar relative to a fully intact ecosystem","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"slight fade at full price.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"slight fade at full price.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"slight fade at full price.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q11","section":"QB","title":"Jalen Hurts is now more volume-sensitive after losing A.J. Brown","players":"Jalen Hurts; A.J. Brown. Philadelphia; Marquise Brown; Elijah Moore; Dontayvion Wicks; Brown","view":"Price-sensitive / near fair value","core":"Philadelphia signed Marquise Brown, Elijah Moore, and traded for Dontayvion Wicks, but that is different from having Brown.","body":"Volume can cover for a lot, but Philadelphia just asked Jalen Hurts to prove it. A.J. Brown turned contested throws into completions; the replacement plan of Marquise Brown, Elijah Moore, and a trade for Dontayvion Wicks is a collection of complementary pieces rather than a target-earning alpha, and the projected 3-to-6 percent passing-efficiency dip versus 2025 measures that gap directly.\n\nWhen efficiency falls, a quarterback needs more dropbacks or more rushing production to hold his scoring line, so Hurts now leans harder on usage staying heavy. That's a pricing problem, not a fade: at full cost you're paying for the intact version of this offense, so hold your number and let someone else stretch.\n\nMedium confidence \u2014 a breakout from the new receivers would soften the concern, and in 2QB formats the discount you demand can be smaller.","effect":"-3% to -6% passing efficiency versus 2025","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"fine at a discount, but not my preferred expensive QB.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fine at a discount, but not my preferred expensive QB.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"fine at a discount, but not my preferred expensive QB.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q13","section":"QB","title":"Joe Burrow is a ceiling bet whose current projection is lower than his reputation","players":"Joe Burrow; Allen; Maye; Lamar; Daniels; Hurts","view":"Price-sensitive / near fair value","core":"Current projections put 310.7 standard points, below Allen, Maye, Lamar, Daniels, and Hurts.","body":"Reputation says top shelf; the math disagrees, at least for now. Projections put Burrow at 310.7 standard points, below Allen, Maye, Lamar, Daniels, and Hurts \u2014 a whole tier the market often prices behind him. The gap is structural: a pocket passer without rushing production needs elite passing efficiency just to keep pace with dual-threat scorers, so his median outcome merely matches his cost.\n\nWhat you're actually buying is the healthy-season ceiling, roughly a 5 percent bump over projection, and ceiling only pays when you acquire it at a markdown. Patience is the whole play here \u2014 a room spooked by his 2025 missed time may set a price below the sheet, and that's your window. Medium confidence cuts both ways: full health validates the reputation, while any recurrence makes even fair value expensive.\n\nSuperflex desperation inflates him fastest.","effect":"+5% upside if fully healthy, but median is only fair at price","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"buy only if the room discounts him because of 2025 missed time.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"buy only if the room discounts him because of 2025 missed time.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"buy only if the room discounts him because of 2025 missed time.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q14","section":"QB","title":"Jaxson Dart is the best combination of cheap ADP, designed-rush equity, and new-scheme upside","players":"Jaxson Dart","view":"Underpriced","core":"He produced 17.6 FPPG in 14 games as a rookie and is projected for 549.4 rushing yards and 6.5 rushing TDs.","body":"Rookie quarterbacks who post 17.6 points per game across 14 outings don't usually stay cheap, yet Dart's ADP hasn't caught up to his production. The engine is the rushing profile \u2014 a projected 549.4 yards and 6.5 touchdowns on the ground \u2014 and designed carries are the most bankable points a quarterback can offer because they arrive whether or not the passing game clicks.\n\nLayer new-scheme upside on top and you get a legitimate 12-to-18 percent return over price if he simply holds the job all year, which is the one real hinge in the thesis. In draft terms, he's the late quarterback you take a round early rather than pray falls.\n\nMedium confidence tracks that job-security question; the case strengthens in superflex and 2QB builds, in full-PPR rooms where his stack partners gain value, and in larger leagues that amplify the payoff.","effect":"+12% to +18% versus price if he keeps the job all year","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"one of the best QB breakout targets.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"one of the best QB breakout targets.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"one of the best QB breakout targets.","auctionTailoring":"Superflex/2QB league type; Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"Q15","section":"QB","title":"Dart\u2019s new coaching staff supports quarterback insulation","players":"Dart; Harbaugh; Nagy; Giants","view":"Format-dependent / monitor price","core":"Harbaugh and Nagy are moving the Giants toward heavier personnel and more protection-friendly structure.","body":"Coaching infrastructure rarely shows up in projections, but it absolutely shows up in variance. With Harbaugh and Nagy steering the Giants toward heavier personnel and a more protection-friendly structure, Dart should absorb fewer free rushers and face fewer obvious passing downs \u2014 the situations that produce sacks, turnovers, and the single-digit weeks that wreck a quarterback's season-long line.\n\nThe projected payoff, lower sack volatility and better red-zone efficiency, doesn't move his median much but tightens the distribution around it, and steadiness is a real tiebreaker among quarterbacks in the same cost range. Don't force the pick, though; this is a lean that should follow the price, not lead it.\n\nMedium confidence reflects that scheme intentions in July don't always survive September, and superflex formats plus deeper leagues reward the firmer weekly floor most.","effect":"lower sack volatility, better red-zone efficiency","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"prioritize him over similarly priced pocket passers.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"prioritize him over similarly priced pocket passers.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"prioritize him over similarly priced pocket passers.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q16","section":"QB","title":"Brock Purdy is the best late-round efficiency bet","players":"Brock Purdy","view":"Underpriced","core":"He profiles as a best late-round QB, and current projections still give him over 4,100 passing yards.","body":"Waiting at quarterback only works when the last tier still contains real volume, and that's the Purdy case in one sentence. Projections still credit him with over 4,100 passing yards \u2014 starter-grade output at a late-round cost, the exact arbitrage a one-QB drafter should hunt.\n\nEfficiency passers get discounted because their scoring leans on yards and touchdowns rather than a rushing floor, but when the price falls far enough the discount overshoots, and the projected 8-to-12 percent return over cost says it has. Build your roster elsewhere for most of the draft, then take him a beat before the sheet says you must, since values this clean rarely survive to your next turn.\n\nMedium confidence: deterioration in his supporting cast would weaken the call, while superflex rooms and bigger leagues, where his floor plays every week, clearly strengthen it.","effect":"+8% to +12% versus price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"ideal one-QB league value if you wait.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"ideal one-QB league value if you wait.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"ideal one-QB league value if you wait.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q19","section":"QB","title":"Dallas\u2019 tough schedule is the main check on Prescott\u2019s ceiling","players":"Dallas\u2019; Prescott; Cowboys","view":"Overpriced or discount required","core":"League schedule analysis put the Cowboys among tougher-slate teams.","body":"Schedule, not talent, is the anchor on this one. League schedule analysis places the Cowboys among the tougher-slate teams, and for a quarterback that means more weeks against defenses that compress passing efficiency and fewer of the shootout scripts that produce spike games.\n\nThe projected cost runs 0.3 to 0.7 points per game versus a neutral slate \u2014 not enough to sink Prescott's season, but enough that paying full market price means paying for a ceiling the calendar keeps taxing. Managed-league drafters eat those bad matchups one week at a time, so demand real savings before clicking his name.\n\nMedium confidence is doing heavy lifting here, because preseason schedule strength is one of the least stable inputs in the toolkit; if Dallas's opponents underperform, the whole penalty evaporates. Superflex need can justify paying closer to sticker.","effect":"-0.3 to -0.7 FPPG versus neutral","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"small downgrade in managed leagues, less so in best ball.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"small downgrade in managed leagues, less so in best ball.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"small downgrade in managed leagues, less so in best ball.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q21","section":"QB","title":"Caleb Williams is correctly expensive, but not obviously cheap","players":"Caleb Williams; TE Colston Loveland; Chicago","view":"Price-sensitive / near fair value","core":"He finished QB5 in 2025 and now gets second-year TE Colston Loveland\u2019s continued growth, yet Chicago\u2019s schedule irregularity adds weekly friction.","body":"A QB5 finish in 2025 earns its price tag, and that's exactly the problem \u2014 the market has already collected the reward. Williams adds the continued growth of second-year tight end Colston Loveland, a genuine plus for a young passer who benefits from a reliable middle-of-the-field outlet, but Chicago's schedule irregularity injects weekly friction that offsets a chunk of the gain.\n\nThe projected band of minus-2 to plus-3 percent versus price tells the whole story: this is a fair bet, not an edge. Take him if he sits at your slot while the quarterback tier thins, and never reach, because you'd be paying retail for outcomes already baked in.\n\nMedium confidence means it could break either way \u2014 Loveland outrunning expectations tilts it positive \u2014 and in superflex or larger leagues, fair value at quarterback is still worth securing on time.","effect":"-2% to +3% versus price","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"near market, not a priority buy.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"near market, not a priority buy.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"near market, not a priority buy.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q22","section":"QB","title":"Williams\u2019 upside depends more on TE and WR after Buffalo took DJ Moore","players":"Williams\u2019; Buffalo; DJ Moore. Chicago; Moore; Rome Odunze; Loveland; Odunze","view":"Underpriced","core":"Chicago lost Moore, which makes Rome Odunze and Loveland more central.","body":"Buffalo taking DJ Moore reshuffles Chicago's passing tree in a way the market hasn't fully processed. With Moore gone, Rome Odunze and Loveland stop being pieces of the offense and become the offense, and concentrated target shares are quietly bullish for a quarterback's fantasy line: fewer mouths means faster chemistry, cleaner progressions, and more production flowing through players whose roles you can actually predict.\n\nThe trade-off is receiver-proofing \u2014 if Odunze or Loveland misses time or stalls, Williams has less insurance beneath them, which caps how hard you should chase. On draft day that makes Williams a nudge up the board rather than a pound-the-table buy, with his two top pass-catchers as the real lever for extracting the value.\n\nMedium confidence rests on the young targets earning it; superflex formats and deeper rooms justify moving the earliest.","effect":"higher concentrated target shares, but slightly less receiver-proofing","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"stack him only with Odunze or Loveland.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"stack him only with Odunze or Loveland.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"stack him only with Odunze or Loveland.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q26","section":"QB","title":"Bo Nix is a sneaky winner from the Jaylen Waddle trade","players":"Bo Nix; Jaylen Waddle; Denver; Waddle","view":"Underpriced","core":"Denver acquired Waddle, has a top-ranked offensive line, and carries a favorable schedule.","body":"Trades like the Waddle deal get scored for the receiver, but the quarterback often collects the quieter windfall. Denver handed Nix a proven separator in Jaylen Waddle, protects him behind a top-ranked offensive line, and sends him into a favorable schedule \u2014 three independent tailwinds pointing the same direction.\n\nBetter protection suppresses the disaster plays, a legitimate target earner lifts completion quality, and a soft slate keeps game scripts manageable, which together support the projected 6-to-10 percent return over current price. That's a quarterback worth taking at the front of his tier instead of hoping he circles back, especially while his cost hasn't absorbed the trade yet.\n\nMedium confidence: the schedule leg is the wobbliest, and a slow Waddle integration tightens the math. Superflex rooms and bigger leagues turn this lean into a clear buy.","effect":"+6% to +10% versus current price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target as a double-stackable value QB.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target as a double-stackable value QB.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target as a double-stackable value QB.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q27","section":"QB","title":"Sam Darnold is a value only if you trust 2025 efficiency to stick","players":"Sam Darnold","view":"Overpriced or discount required","core":"He was just QB13 despite 4,048 passing yards because turnovers and the lack of rushing suppressed fantasy.","body":"Passing yards flattered him; the fantasy column didn't. Darnold piled up 4,048 yards in 2025 and still finished just QB13, because turnovers handed points back and the lack of rushing production left him no second scoring channel. That's the classic efficiency mirage \u2014 raw volume that looks like a starter while fantasy scoring punishes giveaways and rewards legs, and he sits on the wrong side of both ledgers.\n\nThe projected range of minus-3 to plus-7 percent versus market is honest about how wide the outcomes run, and low-to-medium confidence says don't anchor on either end. He's a player you accept at a discount, never one you plan around: if the turnovers regress he beats his price, and if they don't you've bought empty yardage. Formats that start multiple quarterbacks absorb that variance far better than shallow rooms can.","effect":"-3% to +7% versus market, wide range","conf":"Low to Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"better in two-QB and best ball than one-QB home leagues.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"better in two-QB and best ball than one-QB home leagues.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"better in two-QB and best ball than one-QB home leagues.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q32","section":"QB","title":"Geno Smith becomes more fantasy relevant in New York than he was in Las Vegas","players":"Geno Smith; New York; Las Vegas. The Jets; Geno; Breece Hall","view":"Underpriced","core":"The Jets traded for Geno and extended Breece Hall, giving him a stronger run-game infrastructure and a softer early schedule.","body":"The Jets didn't just trade for Geno Smith \u2014 they extended Breece Hall in the same offseason, handing him run-game infrastructure that's a clear step up from his Las Vegas circumstances, plus a softer early slate to ease the transition. A functioning ground game keeps an offense on schedule, out of obvious passing downs, and near the goal line more often, which is how a veteran passer's floor rises without anyone noticing.\n\nKeep expectations calibrated, though: the projected outcome is a modest QB2 improvement, and modest improvements only matter where the price is near zero and every startable arm counts. That makes this a deep-format proposition through and through; shallow one-QB rooms can ignore him without regret. Medium confidence rests on two props \u2014 Hall staying effective and the early schedule playing as soft as it looks.\n\nIf either wobbles, the edge shrinks back to nothing.","effect":"modest QB2 improvement","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"late superflex target only.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"late superflex target only.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"late superflex target only.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q34","section":"QB","title":"Tua Tagovailoa should be treated as a non-factor until his team context improves","players":"Tua Tagovailoa; Miami; Hill; Waddle; Malik Willis","view":"Overpriced or discount required","core":"Miami moved on from Hill and Waddle, signed Malik Willis, and carries one of the worst line outlooks.","body":"Some situations aren't discounts waiting to happen; they're situations to skip. Miami moved on from both Hill and Waddle, signed Malik Willis, and carries one of the worst offensive line outlooks in the league \u2014 stripping Tua of his separators, his clean pockets, and his margin for error all at once.\n\nQuarterbacks built on timing and rhythm are the most infrastructure-dependent players in fantasy, so removing the infrastructure doesn't shave the projection, it collapses it, and the Willis signing reads like the team hedging on its own position. The result is a substantial downgrade to any contingent value you had penciled in, and high confidence means you shouldn't talk yourself into a bounce-back at any normal cost.\n\nOnly real investment in the receiver room or the line reopens the case; even superflex and deep-bench formats usually earn more from another roster spot.","effect":"substantial downgrade to any contingent Tua value","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"do not draft in standard redraft formats.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"do not draft in standard redraft formats.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"do not draft in standard redraft formats.","auctionTailoring":"Superflex/2QB league type; Roster and bench size; League size and auction budget."},{"code":"Q35","section":"QB","title":"Kyler Murray\u2019s release makes Arizona a target-distribution offense rather than a QB-creation offense","players":"Kyler Murray; Arizona; QB-creation; That; Jacoby Brissett; Cardinals; Matchup-based RB; The RB; Jets","view":"Price-sensitive / near fair value","core":"That boosts pass-catching target certainty but lowers total offense expectation under Jacoby Brissett.","body":"Arizona's offense changes species with Kyler Murray gone. A quarterback who created offense by himself gives way to Jacoby Brissett, a distributor, and the fantasy consequences split cleanly in two: pass-catcher target certainty improves because the ball comes out on structure rather than off script, while total offensive expectation falls \u2014 a team-level quarterback drag of roughly 8 percent.\n\nThat's why this reads as a repricing of the whole depth chart rather than a single buy or sell; the position itself got downgraded, and the value migrated outward to whoever banks the targets Brissett distributes. Treat the Cardinals' quarterback slot as dead money on your draft board and spend the attention on those volume earners instead. High confidence, because the mechanism here is the roster itself, not a projection.\n\nEven in superflex and 2QB rooms, desperation shouldn't pull Brissett up your queue.","effect":"QB play drag of roughly -8% team level","conf":"High","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"fade Cardinals quarterback production entirely and focus only on bankable volume earners. Running back insights Matchup-based RB signal The RB matchup chart is based on 2025 RB fantasy points allowed per game, a secondary source used here because the parser could not directly open the historical position-allowed data position-allowed tables. It highlights that the Jets, Bengals, Cardinals, Commanders, Giants, Cowboys, Dolphins, Bills, Panthers, and Eagles were the softest RB matchups last season. That should not be projected naively forward, but it is useful as a tiebreaker for schedule-driven weekly decisions. Running back value board Player Market note My view Action James Cook current best-value RB label Fairly still undervalued despite top-6 2025 finish Target Ashton Jeanty Best-breakout RB label Talent real, role ceiling very high in Vegas Target, but not at any cost Brian Robinson Jr.\u00a0Mid-round value label Good floor if committee stays predictable Target in robust-WR builds Tyjae Spears Late-round RB label Best contingent upside among cheaper backs Target Christian McCaffrey Elite but age/injury priced in only partially Ceiling intact, risk very real Format-dependent target Kyren Williams Productive but role pressure rising Slightly overpriced Fade at market Sources: current market RB projections and value article, 2025 RB stats, Rams backfield reporting.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fade Cardinals quarterback production entirely and focus only on bankable volume earners. Running back insights Matchup-based RB signal The RB matchup chart is based on 2025 RB fantasy points allowed per game, a secondary source used here because the parser could not directly open the historical position-allowed data position-allowed tables. It highlights that the Jets, Bengals, Cardinals, Commanders, Giants, Cowboys, Dolphins, Bills, Panthers, and Eagles were the softest RB matchups last season. That should not be projected naively forward, but it is useful as a tiebreaker for schedule-driven weekly decisions. Running back value board Player Market note My view Action James Cook current best-value RB label Fairly still undervalued despite top-6 2025 finish Target Ashton Jeanty Best-breakout RB label Talent real, role ceiling very high in Vegas Target, but not at any cost Brian Robinson Jr.\u00a0Mid-round value label Good floor if committee stays predictable Target in robust-WR builds Tyjae Spears Late-round RB label Best contingent upside among cheaper backs Target Christian McCaffrey Elite but age/injury priced in only partially Ceiling intact, risk very real Format-dependent target Kyren Williams Productive but role pressure rising Slightly overpriced Fade at market Sources: current market RB projections and value article, 2025 RB stats, Rams backfield reporting.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"fade Cardinals quarterback production entirely and focus only on bankable volume earners. Running back insights Matchup-based RB signal The RB matchup chart is based on 2025 RB fantasy points allowed per game, a secondary source used here because the parser could not directly open the historical position-allowed data position-allowed tables. It highlights that the Jets, Bengals, Cardinals, Commanders, Giants, Cowboys, Dolphins, Bills, Panthers, and Eagles were the softest RB matchups last season. That should not be projected naively forward, but it is useful as a tiebreaker for schedule-driven weekly decisions. Running back value board Player Market note My view Action James Cook current best-value RB label Fairly still undervalued despite top-6 2025 finish Target Ashton Jeanty Best-breakout RB label Talent real, role ceiling very high in Vegas Target, but not at any cost Brian Robinson Jr.\u00a0Mid-round value label Good floor if committee stays predictable Target in robust-WR builds Tyjae Spears Late-round RB label Best contingent upside among cheaper backs Target Christian McCaffrey Elite but age/injury priced in only partially Ceiling intact, risk very real Format-dependent target Kyren Williams Productive but role pressure rising Slightly overpriced Fade at market Sources: current market RB projections and value article, 2025 RB stats, Rams backfield reporting.","auctionTailoring":"Superflex/2QB league type; Roster and bench size; League size and auction budget."},{"code":"R3","section":"RB","title":"Detroit\u2019s easiest projected schedule slightly amplifies Gibbs\u2019 ceiling without needing volume growth","players":"Detroit; Gibbs\u2019","view":"Price-sensitive / near fair value","core":"Detroit\u2019s easiest projected schedule slightly amplifies Gibbs\u2019 ceiling without needing volume growth.","body":"Schedule edges rarely move a floor, but they do stretch the top of a range, and that's what a soft slate does here. When the average opponent is weaker, more of Detroit's drives reach scoring position, game scripts stay friendlier, and the same touch count converts into more points \u2014 which is how Gibbs picks up a projected +2% to +4% over a neutral-slate expectation without any assumed growth in his workload.\n\nPractically, that's a tiebreaker at the very top of the board, not a license to overpay: he's already priced among the elite of the elite, so the slate simply firms up the case for taking him at cost. Confidence sits at medium because schedule projections drift once real defenses show their quality, and the edge shrinks in shallow rooms where top picks separate less.","effect":"+2% to +4% versus neutral-slate expectation","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"he is one of the few top-two overall picks I would not try to get cute fading.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"he is one of the few top-two overall picks I would not try to get cute fading.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"he is one of the few top-two overall picks I would not try to get cute fading.","auctionTailoring":"League size and auction budget."},{"code":"R5","section":"RB","title":"Bijan\u2019s second-half 2025 surge matters","players":"Bijan; From Weeks","view":"Underpriced","core":"From Weeks 8-17 he led RBs in current market custom split with 21.8 FPPG.","body":"Full-season box scores can bury a role change, and that's the trap with Bijan. From Weeks 8-17 of 2025 he led running backs at 21.8 FPPG, which tells you the offense eventually funneled through him in a way the early-season numbers dilute.\n\nWhen a back's late-season usage outstrips his aggregate line, drafters anchored to the yearly totals systematically underprice him \u2014 the market averages two different players, and you get to draft the better one. Treating that late-2025 role as the right baseline means his projection should be built off the surge, not the blend, which is why the fade case built on his full-season touchdown count misses the point.\n\nHigh confidence fits here since the evidence is role-based rather than efficiency luck, and the edge grows with league size, where every early pick has to clear a higher bar.","effect":"late-2025 role is the right baseline","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"do not fade him on total TD count from full-season box score.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"do not fade him on total TD count from full-season box score.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"do not fade him on total TD count from full-season box score.","auctionTailoring":"League size and auction budget."},{"code":"R6","section":"RB","title":"Atlanta\u2019s easy official schedule gives Bijan one of the cleanest high-end paths","players":"Atlanta; Bijan","view":"Price-sensitive / near fair value","core":"Atlanta\u2019s easy official schedule gives Bijan one of the cleanest high-end paths.","body":"A friendly slate won't manufacture a superstar, but for a back already carrying an elite projection it removes friction from the best-case outcome. Atlanta's official schedule grades out easy, and easier opponents mean more sustained drives, more red-zone trips, and fewer weeks where negative script strips away carries \u2014 the mechanism behind the projected +0.4 to +0.8 FPPG bump versus a neutral draw for Bijan.\n\nThat's real but modest, which is why the right use is as a tiebreaker among the top backs rather than a reason to jump him past your board. If you're torn between him and another first-round runner, the schedule breaks the tie in his favor at equal cost.\n\nMedium confidence is appropriate: preseason schedule strength is a noisy forecast, and the whole edge could wash out if a couple of projected soft defenses improve.","effect":"+0.4 to +0.8 FPPG versus neutral","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"if splitting hairs between Bijan and another elite RB, use schedule as a tiebreaker in his favor.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"if splitting hairs between Bijan and another elite RB, use schedule as a tiebreaker in his favor.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"if splitting hairs between Bijan and another elite RB, use schedule as a tiebreaker in his favor.","auctionTailoring":"League size and auction budget."},{"code":"R7","section":"RB","title":"Jonathan Taylor\u2019s workload is still monstrous","players":"Jonathan Taylor","view":"Format-dependent / monitor price","core":"He logged 323 carries and 18 rushing TDs in 2025 and projects for another 327 carries.","body":"Volume is the most durable currency in fantasy, and 323 carries with 18 rushing touchdowns in 2025 \u2014 plus a projection calling for another 327 carries \u2014 is about as much of it as the modern game allows.\n\nA workload that heavy builds a floor almost no other back can match: even in an off week, the sheer number of opportunities keeps the score respectable, and near the goal line the touchdown math stays firmly in his favor. The tradeoff is modest efficiency downside, because carry counts that large invite wear and rarely come with per-touch improvement.\n\nIn draft terms, Taylor is a conviction pick in standard and half-PPR, where his rushing profile isn't discounted, and merely fine in full PPR. High confidence reflects how sticky rushing workloads are; a shift in Indianapolis's offensive identity is the main thing that would soften this.","effect":"elite volume floor with modest efficiency downside","conf":"High","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"draft confidently in standard and half-PPR.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"draft confidently in standard and half-PPR.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"draft confidently in standard and half-PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R9","section":"RB","title":"Tyler Warren\u2019s presence should help Indianapolis stay on schedule, not necessarily hurt Taylor","players":"Tyler Warren; Indianapolis; Taylor. Warren; Taylor","view":"Format-dependent / monitor price","core":"Warren projects as a major TE contributor, which should support red-zone efficiency more than steal rushing volume.","body":"The reflex when a team adds a serious pass-catching tight end is to shave the running back's projection, but that logic runs backward here. Warren projects as a major contributor at the position, and what a reliable tight end mostly does is keep an offense on schedule \u2014 converting the second-and-longs and red-zone snaps that otherwise stall drives.\n\nSustained drives mean more total plays, more scoring trips, and more carries in favorable situations for Taylor, not fewer, because Warren's targets come from the passing game rather than from the rushing budget. The projected effect is a marginal positive at the team level, which won't move Taylor's rank on its own but should kill any discount you're tempted to apply on competition grounds.\n\nMedium confidence is fair for a rookie-dependent inference; if Indianapolis instead leans pass-heavy near the goal line, the benefit thins out.","effect":"marginal positive team effect","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"no Taylor fade on TE competition grounds.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"no Taylor fade on TE competition grounds.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"no Taylor fade on TE competition grounds.","auctionTailoring":"League size and auction budget."},{"code":"R10","section":"RB","title":"Derrick Henry remains one of the safest touchdown bets, but the ecosystem worsened slightly","players":"Derrick Henry","view":"Underpriced","core":"He ran for 1,595 yards and 16 TDs in 2025 and still projects for 13.4 rushing scores.","body":"Nobody stumbles into 1,595 rushing yards and 16 touchdowns, and the 2026 projection of 13.4 rushing scores says the model still believes the core of that profile survives. Touchdowns are where Henry's fantasy value lives: goal-line work is the least replaceable role in football, and a back who owns it converts team success into spike weeks regardless of what happens between the twenties.\n\nThe caveat is a slightly worsened ecosystem, which trims the margin between his projection and his price \u2014 he's still a value, just a thinner one than a year ago. That makes him a player to pursue a bit past sheet value rather than a pound-the-table steal, especially where receptions don't dilute his edge.\n\nHigh confidence fits the track record; heavier TD scoring strengthens the call, while full-PPR settings and any offensive decline around him weaken it.","effect":"still positive versus price, but less room than last year","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target more aggressively in standard and half-PPR than full PPR.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target more aggressively in standard and half-PPR than full PPR.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target more aggressively in standard and half-PPR than full PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); TD scoring weight; League size and auction budget."},{"code":"R11","section":"RB","title":"Henry\u2019s age is real, but the current projection already prices some decline","players":"Henry; Gibbs; Bijan; Taylor; McCaffrey","view":"Underpriced","core":"He projects behind Gibbs, Bijan, Taylor, and McCaffrey.","body":"Everyone in your draft room knows the age argument, and that's precisely why it's losing its bite as an edge. The current projection already slots Henry behind Gibbs, Bijan, Taylor, and McCaffrey, which means the decline case is baked into the price rather than lurking outside it \u2014 you're not paying for a peak season, you're paying for a discounted one.\n\nWhen a market consensus fully absorbs a risk, the asymmetry flips: the downside is priced, but the scenario where health cooperates isn't, and that's where the projected +0% to +6% lives. In practice, treat him as a buy once he settles below the reception-heavy elites, because at that slot the age fade is charging you nothing extra to accept.\n\nMedium confidence is honest here \u2014 age curves do occasionally break suddenly \u2014 and larger leagues, where discounted stars matter more, sharpen the case.","effect":"+0% to +6% if health cooperates","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"not a fade purely on age if he settles below the reception monsters.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"not a fade purely on age if he settles below the reception monsters.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"not a fade purely on age if he settles below the reception monsters.","auctionTailoring":"League size and auction budget."},{"code":"R13","section":"RB","title":"Christian McCaffrey still has the highest full-PPR ceiling among backs","players":"Christian McCaffrey","view":"Underpriced","core":"He led 2025 half-PPR scoring with 311 carries, 102 catches, and 17 total TDs, and 2026 projections still expect 76.6 catches.","body":"Nobody else at running back stacks a full rushing workload on top of a wide receiver's catch total, and that combination is the whole argument. McCaffrey led 2025 half-PPR scoring on 311 carries, 102 catches, and 17 total touchdowns, and 2026 projections still credit him with 76.6 receptions \u2014 dual usage that lets him beat his draft slot through two channels at once, since receptions score even when the ground game stalls.\n\nThat's the engine behind the projected +6% to +12% upside versus his current rank if he stays on the field, and the health caveat is exactly why the confidence stops at medium. For drafters, he's the cleanest bet-on-ceiling play in the first round: pay a touch over sheet value in full PPR, where the catch volume compounds hardest, and dial the aggression back in standard scoring, where half his edge disappears.","effect":"+6% to +12% upside versus current rank if he stays healthy","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"one of the best \u201cbet on ceiling\u201d first-rounders.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"one of the best \u201cbet on ceiling\u201d first-rounders.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"one of the best \u201cbet on ceiling\u201d first-rounders.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R14","section":"RB","title":"McCaffrey\u2019s price is fair in managed leagues but stronger in best ball","players":"McCaffrey","view":"Price-sensitive / near fair value","core":"His weekly spike profile is elite, but age and workload history still create fragility.","body":"Format shapes this call more than talent does. McCaffrey's weekly spike profile remains elite, but the age and workload history underneath it creates fragility the market prefers not to price \u2014 the true range of outcomes is wider than his consensus slot implies.\n\nThat asymmetry cuts differently by format: best ball harvests the monster weeks automatically and absorbs absences without forcing weekly decisions, while a managed league makes you carry the downtime, burn a roster spot, and guess right on his availability.\n\nSo the same player is fairly priced in one setting and genuinely attractive in the other, which is why leaning your exposure toward best ball and toward managed leagues with deep benches is the right portfolio move. Medium confidence reflects the honest uncertainty about the fragile tail; a thin bench turns any missed time from an inconvenience into a real structural problem.","effect":"wider range than the market wants to admit","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"lean toward best ball or leagues with deep benches.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"lean toward best ball or leagues with deep benches.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"lean toward best ball or leagues with deep benches.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"R16","section":"RB","title":"McCaffrey\u2019s floor remains stronger because the 49ers kept Trent Williams and project well on the line","players":"McCaffrey; Trent Williams; San Francisco","view":"Underpriced","core":"San Francisco ranks highly by line outlook.","body":"Trench play is the quiet variable in every running back projection, and San Francisco graded out highly by line outlook after keeping Trent Williams. For an older back, that matters more than it would for a younger one: a strong line delivers clean creases and steady efficiency without demanding heroics on every carry, letting the scheme absorb some of the burst decline that age normally exposes.\n\nThat's the mechanism by which line stability offsets a slice of McCaffrey's age risk \u2014 his floor is protected by the environment even if his ceiling depends on his body. In draft terms, this closes off one of the standard fade arguments; whatever hesitation you have about him should be about durability, not blocking.\n\nMedium confidence is right because line projections are inherently soft, and an injury up front \u2014 Williams included \u2014 would put the concern straight back on the table.","effect":"line stability offsets some age risk","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"no reason to fade based on trench concerns.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"no reason to fade based on trench concerns.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"no reason to fade based on trench concerns.","auctionTailoring":"League size and auction budget."},{"code":"R18","section":"RB","title":"Achane\u2019s receiving role keeps him above ordinary bad-offense backs","players":"Achane","view":"Underpriced","core":"He had 67 catches in 16 games in 2025 and is projected for 70.2 catches.","body":"Catching passes is what separates a back from his offense, and it's the reason Achane doesn't belong in the same bucket as other runners tied to shaky situations. He caught 67 balls in 16 games in 2025 and projects for 70.2 more, and target volume like that is script-proof: when the team trails, the checkdowns keep coming, so his floor holds up in exactly the weeks that bury ordinary bad-offense backs.\n\nThat built-in weekly baseline is what keeps him out of true bust territory even if the rushing environment disappoints. The value case scales directly with reception scoring \u2014 push a little past sheet price in full PPR, stay closer to market in half, and let him go in standard, where the entire mechanism is muted. High confidence fits, since receiving roles are among the stickiest signals a back carries year over year.","effect":"target floor keeps him from true bust territory","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"prefer in PPR, less so in standard.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"prefer in PPR, less so in standard.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"prefer in PPR, less so in standard.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R19","section":"RB","title":"Miami\u2019s brutal schedule meaningfully matters for Achane in playoff planning","players":"Miami; Achane; Buffalo; Denver; Green Bay","view":"Overpriced or discount required","core":"League schedule analysis flagged difficult late trips to Buffalo, Denver, and Green Bay plus a closing stretch against playoff teams.","body":"Winning your league happens in December, and that's where this profile cracks. Schedule analysis flags difficult late trips to Buffalo, Denver, and Green Bay plus a closing stretch loaded with playoff teams \u2014 cold-weather road games against quality opponents are precisely the settings where a speed-and-space back loses his edge, and where trailing scripts and stacked boxes squeeze efficiency.\n\nThe projected -0.5 to -1.0 FPPG in the playoff weeks is small on paper but lands entirely in the games that decide titles, which reframes Achane as a fine season-long accumulator with a weaker championship-run profile. So demand a discount rather than paying full market, and weigh this heavily if your league crowns its winner in Weeks 15-17 \u2014 while noting it barely matters in total-points formats.\n\nMedium confidence reflects that projected December opponents don't always turn out to be the teams we feared in July.","effect":"-0.5 to -1.0 FPPG in playoff weeks","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"fine season-long target, weaker title-run profile.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"fine season-long target, weaker title-run profile.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"fine season-long target, weaker title-run profile.","auctionTailoring":"Playoff-week settings (Weeks 15\u201317); League size and auction budget."},{"code":"R21","section":"RB","title":"Cook\u2019s late-season stretch reinforces that 2025 wasn\u2019t hollow","players":"Cook; From Weeks","view":"Format-dependent / monitor price","core":"From Weeks 8-17 he posted 19.6 FPPG with 1,069 rushing yards.","body":"From Weeks 8-17 of 2025, Cook stacked 19.6 FPPG on 1,069 rushing yards, and closing stretches like that carry more predictive weight than early-season noise. A back finishing that strong is usually playing atop a settled role in an offense that has figured out what it wants to be \u2014 and roles established late in one season tend to carry into the next, since the coaching staff enters camp already sold.\n\nThat's the carryover signal, and it argues his 2025 wasn't a hollow stat line inflated by a soft stretch but the shape of his actual job. Practically, he's a player to feel good about at cost rather than someone demanding a reach, with extra appeal in leagues where late-season form decides titles and you're hunting post-bye surge candidates.\n\nHigh confidence is warranted; a changed backfield pecking order is the main threat to the read.","effect":"strong carryover signal","conf":"High","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"especially attractive in leagues where you want post-bye surge candidates.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"especially attractive in leagues where you want post-bye surge candidates.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"especially attractive in leagues where you want post-bye surge candidates.","auctionTailoring":"Playoff-week settings (Weeks 15\u201317); League size and auction budget."},{"code":"R23","section":"RB","title":"Saquon Barkley now looks like a floor play rather than a ceiling play","players":"Saquon Barkley","view":"Price-sensitive / near fair value","core":"Current projections put him well below the true receiving elites and below players with stronger schedule or line signals.","body":"What the projections now say about Barkley is more deflating than damning: he sits well below the true receiving elites and below backs with stronger schedule or line signals. That placement matters because the paths to smashing a first-round price are exactly those levers \u2014 reception volume that scores independent of game script, or an environment that inflates every touch \u2014 and he currently shows neither.\n\nWhat's left is a talented, high-workload back whose most likely outcome is roughly what you pay for, which is what the projected -2% to +2% versus price describes. Drafting him at market is defensible; reaching for him is paying ceiling prices for floor production. So take him only at a discount, and be quicker to pass in full PPR, where the reception gap to the elites widens.\n\nMedium confidence fits \u2014 a genuine receiving-role bump would rewrite this call overnight.","effect":"-2% to +2% versus price","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"take only at a discount.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"take only at a discount.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"take only at a discount.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R25","section":"RB","title":"Josh Jacobs is quietly vulnerable to touchdown regression","players":"Josh Jacobs; Green Bay; Jordan Love","view":"Price-sensitive / near fair value","core":"He projects for 12 rushing TDs, which is strong, but Green Bay\u2019s environment can become more spread out if weather or Jordan Love efficiency climb.","body":"Twelve projected rushing touchdowns is a gaudy number, and gaudy touchdown numbers are exactly the ones that snap back. Jacobs's rank leans heavily on that scoring load, but Green Bay's environment isn't guaranteed to keep feeding it \u2014 if the passing game spreads the offense out, whether through weather patterns or a climb in Jordan Love's efficiency, more red-zone possessions resolve through the air and the back's share of scores erodes.\n\nTouchdowns are also the least stable component of any projection, so the piece of his value most exposed to change is the piece propping up his price. The practical read: he's a fine pick at his slot, not a player to chase past it, and the risk is a slight underperformance rather than a collapse. Weight this more in heavy-TD scoring formats; a run-committed Packers identity would neutralize the concern. Medium confidence.","effect":"slight underperformance risk at current rank","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"fine pick, not a target.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fine pick, not a target.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"fine pick, not a target.","auctionTailoring":"TD scoring weight; League size and auction budget."},{"code":"R27","section":"RB","title":"Jeanty\u2019s role thesis is strengthened by draft capital and roster context","players":"Jeanty; Las Vegas; Klint Kubiak; Kirk Cousins","view":"Underpriced","core":"Las Vegas hired Klint Kubiak, added Kirk Cousins, and still lacks a true WR1 target hog.","body":"Everything about the Raiders' offseason points toward a backfield-first identity. Klint Kubiak arrives to call plays, Kirk Cousins gives the passing game a competent floor without demanding it become the engine, and the receiver room still lacks a true WR1 who commands targets by force.\n\nThat combination matters for a young back because touch volume is the scarcest commodity in fantasy: an offense with no alpha wideout and a play-caller inclined to lean on the run funnels early-down and short-area work to the runner by default. If the structure holds, Jeanty's weekly floor is built on opportunity rather than efficiency, which is the safer bet at his price.\n\nMedium confidence means you shouldn't overpay wildly, but in bigger leagues where startable backs vanish fast, paying a little over sheet value is easy to justify.","effect":"offense should stay structurally friendly to RB touch volume","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target in every format.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target in every format.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target in every format.","auctionTailoring":"League size and auction budget."},{"code":"R28","section":"RB","title":"The Raiders\u2019 line additions help Jeanty more than rankings are reflecting","players":"The Raiders\u2019; Jeanty; Tyler Linderbaum; Spencer Burford","view":"Underpriced","core":"Tyler Linderbaum and Spencer Burford materially improve the middle.","body":"Interior blocking is where young runners live or die, and adding Tyler Linderbaum and Spencer Burford gives Las Vegas a materially better middle than the group that shaped current rankings. Center and guard play determines whether a back reaches the second level clean or meets a defender in the backfield, so an upgrade there compounds every carry rather than showing up in a single highlight.\n\nThe projected gain of 0.2 to 0.4 yards per carry sounds modest until you spread it across a full workload, where it quietly lifts both yardage totals and the number of drives that end in scoring position. That's why the call skews more bullish in formats that weight rushing yards and touchdowns heavily.\n\nMedium confidence is appropriate: line cohesion takes time, and a slow gel through September would blunt the edge before it shows up in box scores.","effect":"+0.2 to +0.4 YPC","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"slightly more bullish in rushing-yard and touchdown-specific formats.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"slightly more bullish in rushing-yard and touchdown-specific formats.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"slightly more bullish in rushing-yard and touchdown-specific formats.","auctionTailoring":"TD scoring weight; League size and auction budget."},{"code":"R29","section":"RB","title":"Jeanty\u2019s receiving ceiling is what can separate him from the veteran RB2 tier","players":"Jeanty","view":"Format-dependent / monitor price","core":"The 59-catch projection is already strong.","body":"Catches are the swing variable here. A 59-reception projection is already a strong baseline for a back, and in full PPR every one of those catches is a point before yardage even enters the math, which is why receiving work compresses the gap between a good RB2 and a genuine difference-maker.\n\nThe mechanism is simple: targets are steadier week to week than carries near the goal line, so a heavy receiving role raises the floor while the rushing workload supplies the ceiling. If that projection climbs into the mid-60s, the profile crosses into first-round value; if it stalls or the team leans on other outlets, he settles among the veteran RB2s he's trying to escape.\n\nWith medium confidence and everything hinging on scoring format, let the room's price and your league's PPR setting make the decision, not affection.","effect":"if that reaches mid-60s, he becomes a first-round value","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"strong fit in full PPR.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"strong fit in full PPR.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"strong fit in full PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R31","section":"RB","title":"Love\u2019s draft capital almost guarantees meaningful early work","players":"Love; Top-three RB","view":"Underpriced","core":"Top-three RB capital is a massive role signal.","body":"Front offices don't spend top-three running back capital on a timeshare. Draft position of that magnitude is the strongest role signal the position offers, because the people who made the pick are professionally invested in proving it right, and that pressure shows up in touches from the opening week.\n\nThat's why 250-plus touches is very plausible even before anyone argues about efficiency: opportunity at that scale puts a back inside startable range almost regardless of the offense around him. The practical move is to price Love on workload, not offensive quality \u2014 volume is what you're buying, and volume is what draft capital protects. High confidence here reflects how rarely this particular signal misses.\n\nThe edge grows in deeper leagues, where locked-in touches are the whole game; in shallow formats, replacement backs are easier to find and the urgency softens.","effect":"250-plus touches is very plausible","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target for workload, not offensive quality.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target for workload, not offensive quality.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target for workload, not offensive quality.","auctionTailoring":"League size and auction budget."},{"code":"R32","section":"RB","title":"Love\u2019s presence is mildly negative for Trey McBride target ceiling but positive for overall red-zone viability","players":"Love; Trey McBride; McBride","view":"Underpriced","core":"Love\u2019s presence is mildly negative for Trey McBride target ceiling but positive for overall red-zone viability.","body":"Two effects are tangled together in Arizona's revamped backfield. A rookie back who commands touches tends to siphon short-area targets that would otherwise flow to a tight end, which is why the projection docks Trey McBride five to ten targets \u2014 checkdowns and outlet throws are exactly the volume a trusted runner absorbs.\n\nAt the same time, a stronger ground game sustains drives and produces more snaps in close, which is where the six to ten additional team rushing touchdown opportunities come from, and McBride can still claim a share of that healthier red-zone pie. The net effect is smaller than the market's instinct to treat one player's gain as another's loss, so don't separate the two as sharply as consensus does.\n\nLow-to-medium confidence and PPR sensitivity mean this leans caution over conviction \u2014 McBride's target haircut stings most in full PPR.","effect":"-5 to -10 targets for McBride, +6 to +10 team rushing TD opportunities","conf":"Low to Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"separate Love and McBride less than the market may.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"separate Love and McBride less than the market may.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"separate Love and McBride less than the market may.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R33","section":"RB","title":"Chase Brown is still underappreciated after an RB8 2025 PPR finish","players":"Chase Brown","view":"Underpriced","core":"He posted 69 catches and 248.1 PPR points.","body":"Sixty-nine catches and 248.1 PPR points bought Chase Brown an RB8 finish in 2025, yet the market keeps treating him like a rotational piece, and that disconnect is the whole case. Receiving volume of that size isn't a fluky stat line \u2014 it's evidence of a role, and roles built on passing-game trust are stickier than efficiency spikes because they survive bad game scripts.\n\nWhen a team trails, the checkdown back keeps earning points while pure runners disappear, which is why the projection puts him 5 to 10 percent above market if the receiving work holds. In practice, that means buying every time a room prices him as a committee back rather than a proven top-ten producer. Medium confidence tracks the one real risk: the catches thinning out.\n\nFull PPR maximizes the edge; standard scoring narrows it considerably.","effect":"+5% to +10% versus market if the receiving role sticks","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target whenever drafters still think of him as only a committee back.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target whenever drafters still think of him as only a committee back.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target whenever drafters still think of him as only a committee back.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R34","section":"RB","title":"Brown\u2019s value is format-sensitive because Joe Burrow\u2019s health and Bengals pass volume swing the checkdown economy","players":"Brown; Joe Burrow; Bengals","view":"Format-dependent / monitor price","core":"Brown\u2019s value is format-sensitive because Joe Burrow\u2019s health and Bengals pass volume swing the checkdown economy.","body":"Everything downstream of Joe Burrow's health runs through this backfield. When Burrow plays, Cincinnati throws, and a functioning passing offense generates the checkdowns, screens, and hurry-up snaps that pay a receiving back handsomely; when he's out, the whole target economy shrinks and Brown's reception-driven edge shrinks with it.\n\nThat's the mechanism behind the format split: his catches are worth a full point apiece in PPR and nothing extra in standard, so the same season produces meaningfully different finishes depending on your rules. The sensible read is to nudge him up in full-PPR home leagues and hold the line everywhere else, letting draft-day price rather than enthusiasm settle it.\n\nMedium confidence fits an argument built on a quarterback's availability \u2014 a healthy Burrow all summer strengthens the case, and any setback drags Brown's outlook back toward the pack.","effect":"stronger relative play in full PPR than standard","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"bump in full-PPR home leagues.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"bump in full-PPR home leagues.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"bump in full-PPR home leagues.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R35","section":"RB","title":"Kyren Williams is a classic \u201cgood player, thin price\u201d case","players":"Kyren Williams; Blake Corum","view":"Overpriced or discount required","core":"He had another productive season, but Blake Corum emerged and current reporting suggests a more balanced workload.","body":"Production isn't the question with Kyren Williams; price is. He delivered another productive season, but Blake Corum's emergence and reporting that points toward a more balanced workload change the math at the top of his range.\n\nRunning back value is brutally sensitive to touch share: a back priced for a monopoly loses value faster than his talent declines, because every carry that shifts to the other guy comes straight off the top of the projection. If the split drifts toward 55-45, the projected hit is 5 to 9 percent below market \u2014 not a collapse, but enough to make RB1/RB2 pricing a losing proposition.\n\nSo don't pay sticker; demand a real discount or let someone else buy retail. Medium confidence means training-camp reporting can still swing this, and a quiet Corum in August would soften the fade considerably.","effect":"-5% to -9% versus market if the split gets closer to 55-45 than expected","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"slight fade at RB1/RB2 pricing.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"slight fade at RB1/RB2 pricing.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"slight fade at RB1/RB2 pricing.","auctionTailoring":"League size and auction budget."},{"code":"R39","section":"RB","title":"Breece Hall is more stable after the Jets\u2019 extension","players":"Breece Hall; Jets\u2019; Hall","view":"Underpriced","core":"Hall signed a three-year deal after the franchise tag and now has softer early schedule conditions.","body":"Contract clarity is one of the quieter value signals in fantasy, and Breece Hall just got it: a three-year deal signed after the franchise tag, which tells you the Jets see him as the plan rather than a placeholder. That matters because market skepticism about a back's situation gets baked into price, and when the situation resolves favorably the price rarely adjusts fast enough.\n\nAdd softer early schedule conditions and you get a runner positioned to bank points in September, exactly when season-long rosters build their cushion and trade markets overreact to hot starts. The projected 4 to 7 percent edge over the market's doubt makes him a genuinely appealing second-tier buy.\n\nMedium confidence keeps this short of a pound-the-table call \u2014 pay a little above sheet, and do it more freely in deeper leagues where secure workloads are scarce.","effect":"+4% to +7% versus market skepticism","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"one of the better second-tier RB buys.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"one of the better second-tier RB buys.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"one of the better second-tier RB buys.","auctionTailoring":"League size and auction budget."},{"code":"R40","section":"RB","title":"Hall\u2019s weekly ceiling depends heavily on Geno Smith raising the offense","players":"Hall; Geno Smith; Better QB; Jets","view":"Underpriced","core":"Better QB play means more scoring chances.","body":"Running backs don't score in a vacuum; they cash in the chances their offense creates, and that's the whole logic of tying Hall's ceiling to Geno Smith. Better quarterback play sustains drives, flips field position, and \u2014 most importantly for a lead back \u2014 produces more trips into scoring range, where carries turn into touchdowns at the highest rate.\n\nHall's talent has never been the debate; the debate is how often the Jets put him in position to finish. If Smith raises the offense's baseline, the red-zone touch expectation improves modestly, and modest gains in scoring opportunity are worth disproportionate fantasy points because touchdowns dominate weekly outcomes. Treat this as a correlated bet on the whole offense rather than the player alone.\n\nMedium confidence reflects that the quarterback thesis is still projection, not evidence \u2014 preseason offensive competence would firm it up fast.","effect":"red-zone touch expectation improves modestly","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"buy Hall if you buy the Jets.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"buy Hall if you buy the Jets.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"buy Hall if you buy the Jets.","auctionTailoring":"League size and auction budget."},{"code":"R41","section":"RB","title":"Hall\u2019s problem is not talent or contract, but committee unknowns","players":"Hall; Deeper","view":"Format-dependent / monitor price","core":"Deeper summer role specifics are unspecified.","body":"Summer reporting hasn't yet clarified how the Jets intend to divide backfield work, and that silence is the one genuine drag on Hall's profile. Ambiguity itself costs fantasy value: when a role could range from workhorse to lead-of-committee, you have to price the average of those outcomes, which is what the roughly 3 percent uncertainty haircut represents.\n\nIt's a small tax, not an indictment \u2014 talent and contract both argue for a featured role, but featured and monopolized are different things, and paying a price that assumes 2022-style volume leaves no margin if a complement carves out passing downs or short yardage. Treat him as tier-dependent: take him when he's clearly the best back on the board, pass when it requires a reach.\n\nMedium confidence really means the call sharpens the moment camp reports name an actual rotation.","effect":"uncertainty haircut about -3%","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"draft, but do not assume 2022-style monopoly volume.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"draft, but do not assume 2022-style monopoly volume.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"draft, but do not assume 2022-style monopoly volume.","auctionTailoring":"League size and auction budget."},{"code":"R43","section":"RB","title":"Walker\u2019s touchdown equity rises sharply in Kansas City","players":"Walker; Kansas City. Even; Justin Fields; Chiefs","view":"Price-sensitive / near fair value","core":"Even with Justin Fields added, the Chiefs remain a high-efficiency offense.","body":"Landing in Kansas City rewrites the touchdown math. Even with Justin Fields in the mix, the Chiefs remain a high-efficiency operation, and efficient offenses do the one thing a runner can't do for himself: consistently deliver the ball to the fringe of the end zone.\n\nA back's touchdown total is mostly a function of how often his team snaps the ball in close, so moving from a neutral context to this one is worth a projected two to four extra scores \u2014 the difference between a frustrating flex and a weekly starter wherever touchdowns carry the scoring load, which is why the edge concentrates in standard leagues.\n\nThe verdict stays price-sensitive, though: the market partly sees this coming, so pay your sheet number and nothing more. Medium confidence, with Fields' potential goal-line involvement the variable that could siphon off the very equity you're buying.","effect":"+2 to +4 TD expectation versus neutral team context","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"especially valuable in standard leagues.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"especially valuable in standard leagues.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"especially valuable in standard leagues.","auctionTailoring":"TD scoring weight; League size and auction budget."},{"code":"R45","section":"RB","title":"Walker\u2019s old Seattle line was improved, but KC\u2019s scoring environment outweighs that concern","players":"Walker; Seattle","view":"Underpriced","core":"Walker\u2019s old Seattle line was improved, but KC\u2019s scoring environment outweighs that concern.","body":"Leaving an improved Seattle line looks like a cost until you weigh what Walker got in return. Blocking helps a back gain yards, but the scoring environment decides how many of those yards matter, and Kansas City's offense manufactures the sustained drives and short fields that convert workloads into fantasy points.\n\nThat's the trade at the heart of this call: slight run-block uncertainty in the new spot against a wholesale upgrade in team context, and the context wins because touchdowns and drive volume are scarcer, more valuable commodities than a marginal blocking edge. Practically, when Walker sits at the same price as backs tied to middling offenses, he's the pick \u2014 same cost, better environment, better weekly ceiling.\n\nMedium confidence leaves room for the line concern to bite; if the new front struggles early, the gap narrows, though the environment argument rarely flips outright.","effect":"team-context upgrade beats slight run-block uncertainty","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"favor Walker over similarly priced backs on middling offenses.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"favor Walker over similarly priced backs on middling offenses.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"favor Walker over similarly priced backs on middling offenses.","auctionTailoring":"League size and auction budget."},{"code":"R46","section":"RB","title":"J.K. Dobbins\u2019 Denver re-signing matters because it caps cheap-back ceiling on that roster","players":"J.K. Dobbins\u2019 Denver; Denver; Dobbins","view":"Format-dependent / monitor price","core":"Denver brought him back on a meaningful two-year deal.","body":"A meaningful two-year deal is Denver telling you who runs its backfield, and the market for the cheaper Broncos backs hasn't fully absorbed the message. Contract commitment works as role insurance: teams that pay a veteran back generally intend to use him, which is why the projection clips 10 to 20 percent off the ceiling of the ancillary options behind Dobbins.\n\nThe trap is drafting Denver's depth as a lottery ticket at a price that assumes an open competition the front office has already tilted. Until camp reporting says otherwise, Dobbins is the better value than the discount alternatives, because you're paying for a role the team just purchased rather than hoping one materializes.\n\nMedium confidence fits a call resting on intent rather than usage \u2014 an injury or a surprise August rotation would reopen the ceiling this signing closed.","effect":"reduces ancillary Broncos RB ceiling by 10% to 20%","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"Dobbins is the better value than the cheaper Denver depth until roles clarify.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"Dobbins is the better value than the cheaper Denver depth until roles clarify.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"Dobbins is the better value than the cheaper Denver depth until roles clarify.","auctionTailoring":"League size and auction budget."},{"code":"R47","section":"RB","title":"Dobbins benefits from line and schedule","players":"Dobbins; Denver","view":"Underpriced","core":"Denver\u2019s line-ranked No.\u00a01 outlook and favorable schedule are real inputs.","body":"Few backs enter a season with both tailwinds blowing this hard. Denver's line carries a No. 1-ranked outlook and the schedule sets up favorably \u2014 two inputs that compound rather than merely add, since good blocking earns efficient carries and softer opponents let an offense stay on schedule long enough to keep feeding its runner.\n\nEfficiency edges like the projected 4 to 7 percent over neutral are especially valuable at a late-RB2 or flex price, because at that cost you're usually choosing between volume without efficiency or efficiency without volume, and here there's a credible shot at both. The move is straightforward: push him up a bit or pay a few dollars past sheet value while the market stays modest.\n\nMedium confidence acknowledges that line rankings are projections and schedule strength shifts in-season \u2014 but neither input needs to be perfect for the current price to be wrong.","effect":"+4% to +7% efficiency over neutral","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"late RB2 or strong flex target if price stays modest.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"late RB2 or strong flex target if price stays modest.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"late RB2 or strong flex target if price stays modest.","auctionTailoring":"League size and auction budget."},{"code":"R48","section":"RB","title":"Javonte Williams is supported by contract commitment in Dallas, but the schedule is tough","players":"Javonte Williams; Dallas","view":"Format-dependent / monitor price","core":"He re-signed for three years and Dallas faces a difficult slate.","body":"A three-year deal is the kind of commitment that tells you a team plans to feed a back, and Dallas made exactly that bet on Williams. Contract security matters more at running back than anywhere else because volume is the whole game: a back the front office has paid rarely gets benched over a cold quarter, and that stabilizes his weekly floor. The complication is the slate.\n\nA difficult schedule means more games where Dallas could be chasing points, which trims rushing attempts and scoring chances even when the role itself is safe. Net it out and you get a steadier floor inside a slightly worse environment \u2014 useful, not thrilling.\n\nMedium confidence fits that tension: the call firms up if camp confirms the workload, and league size should shape how hard you chase him, since a dependable floor matters most in deeper rooms.","effect":"volume floor up, environment slightly down","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"prioritize in zero-RB builds, less as an upside swing.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"prioritize in zero-RB builds, less as an upside swing.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"prioritize in zero-RB builds, less as an upside swing.","auctionTailoring":"League size and auction budget."},{"code":"R50","section":"RB","title":"Brian Robinson Jr.\u00a0profiles as one of the stronger mid-round floor backs","players":"Brian Robinson Jr","view":"Underpriced","core":"Current market called him a best mid-round RB.","body":"Floor backs in the middle rounds win leagues quietly, and the market has already tipped its hand by calling Robinson one of the best mid-round RBs available. That consensus is telling: when a player's reputation rests on dependable early-down work rather than highlight plays, drafters routinely let him slide, which is precisely how a projected +6% to +9% edge over cost opens up.\n\nThe mechanism is simple \u2014 a stable role means a stable weekly point total, and points you can pencil in are worth more than the sheet says once the volatile picks around him start busting. The catch is baked into the projection: it holds only if Washington stays functional as an offense.\n\nMedium confidence means treat this as a lean rather than a lock, and weigh it more heavily in deeper leagues where reliable mid-round production is scarcer.","effect":"+6% to +9% versus cost if Washington stays functional","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"excellent RB3 target in robust-WR starts.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"excellent RB3 target in robust-WR starts.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"excellent RB3 target in robust-WR starts.","auctionTailoring":"League size and auction budget."},{"code":"R51","section":"RB","title":"Robinson\u2019s biggest threat is the backfield clutter","players":"Robinson; Washington; Jerome Ford; Rachaad White","view":"Format-dependent / monitor price","core":"Washington added Jerome Ford and Rachaad White, making passing-down work less secure.","body":"Washington didn't leave the depth chart alone \u2014 Jerome Ford and Rachaad White both walked in the door, and both profile as pass-catching options. That's the specific problem for Robinson: passing-down work is the portion of a back's job most easily handed to a specialist, and two credible receivers out of the backfield make it likely that third downs and hurry-up snaps drift away from him.\n\nHis early-down role can survive all of that untouched while his reception ceiling still gets modestly capped, which is exactly what the projection says. In practical terms the damage scales with your scoring: negligible in standard, real in full PPR, somewhere in between at half.\n\nMedium confidence makes camp usage the tiebreaker \u2014 if Robinson keeps the two-minute work, the concern fades; if Ford or White owns it, discount him further in reception-heavy formats.","effect":"reception ceiling modestly capped","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"stronger in standard than full PPR.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"stronger in standard than full PPR.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"stronger in standard than full PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R52","section":"RB","title":"Tyjae Spears is one of the best late-round leverage picks","players":"Tyjae Spears; Tennessee","view":"Underpriced","core":"Current market flagged him as a best late-round RB, and Tennessee did not add premium backfield competition.","body":"Late-round leverage means paying almost nothing for a player one event away from mattering, and Spears checks every box. Tennessee stayed out of the backfield market when it could have added real competition, and doing nothing is itself a signal \u2014 teams that trust their depth chart don't spend to change it.\n\nThe market has already flagged him among the best late-round RBs, yet the projected +12% to +20% edge over that trivial cost says drafters still aren't paying full attention. The mechanism is pure opportunity math: at his price you're buying a live path to touches, and any expansion of the role returns multiples of the pick.\n\nThe health caveat in the projection is the entire risk, which is why confidence sits at medium. Bench size dictates aggression here \u2014 the more roster spots you carry, the cheaper it is to park him and wait.","effect":"+12% to +20% against late-round cost if health holds","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"priority bench target.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"priority bench target.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"priority bench target.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"R54","section":"RB","title":"Tony Pollard looks properly or slightly aggressively priced","players":"Tony Pollard; Daboll","view":"Price-sensitive / near fair value","core":"He keeps clearing 1,000 yards, but Daboll history is mixed for lead-back volume.","body":"You can trust Pollard for yardage \u2014 he keeps clearing 1,000 \u2014 but the market knows it too, and that's the rub. His price already bakes in the dependable production, so he only beats cost through something his situation doesn't obviously promise: Daboll's history with lead-back volume is mixed, and a coach who spreads backfield touches puts a soft lid on the workload that drives RB scoring.\n\nWhen the evidence points in both directions like this, the projected -2% to +3% swing versus market is really a statement that there's no edge to harvest either way. Practically, that makes Pollard a player you accept at his slot, never one you move up for. Medium confidence cuts both ways: a clear camp commitment to him as the unquestioned lead nudges this positive, while any rotation talk tips it under water.","effect":"-2% to +3% versus market","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"fine pick, not a target.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fine pick, not a target.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"fine pick, not a target.","auctionTailoring":"League size and auction budget."},{"code":"R55","section":"RB","title":"Pollard\u2019s biggest hidden issue is not talent, but cap on explosive-ceiling outcomes","players":"Pollard","view":"Format-dependent / monitor price","core":"He has been steady rather than dominant for years.","body":"Steady for years, dominant almost never \u2014 that's the Pollard profile, and it carries a specific fantasy cost that season totals hide. Backs who accumulate rather than explode post fewer monster weeks, and the projection makes it concrete: a lower 25-point game frequency than similarly ranked backs. Why care?\n\nBecause in formats decided by weekly spikes, two backs with identical season lines aren't equal \u2014 the one who bunches his points into ceiling games wins more head-to-head matchups and more tournaments. Pollard's consistency is genuinely valuable where you set a lineup every week and want a dependable base, and genuinely less valuable where you need outlier outcomes to advance.\n\nMedium confidence reflects that profiles like this rarely change overnight; the call weakens only if his offense turns him into a scoring-position fixture, and league size should drive how much weight you give it.","effect":"lower 25-point game frequency than similarly ranked backs","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"better in managed leagues than large-field best ball.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"better in managed leagues than large-field best ball.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"better in managed leagues than large-field best ball.","auctionTailoring":"League size and auction budget."},{"code":"R56","section":"RB","title":"Rhamondre Stevenson is more alive than the market thinks","players":"Rhamondre Stevenson; Strong; New England","view":"Underpriced","core":"Strong 2025 bounce-back reporting matters, and New England\u2019s offense improved dramatically.","body":"Depressed sentiment is a price you can exploit, and that's exactly where Stevenson sits. The reporting out of New England describes a strong 2025 bounce-back, and the offense around him improved dramatically \u2014 two forces that compound rather than merely add. A better offense sustains drives, which means more snaps, more carries in scoring range, and fewer abandoned game scripts; a rejuvenated back converts those extra chances instead of wasting them.\n\nThe market, still anchored to the version of Stevenson it soured on, hasn't repriced any of this, which is how a +6% to +10% edge over sentiment opens up. In draft terms he's the unglamorous pick that outruns his cost without needing anything heroic. Medium confidence means the backfield picture still has to cooperate \u2014 clean camp usage would firm the call, while renewed committee noise would erode it.","effect":"+6% to +10% versus depressed sentiment","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"value target when the room overreacts to backfield ambiguity.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"value target when the room overreacts to backfield ambiguity.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"value target when the room overreacts to backfield ambiguity.","auctionTailoring":"League size and auction budget."},{"code":"R57","section":"RB","title":"Stevenson\u2019s path to beating price is touchdown-driven, not necessarily touch-monopoly-driven","players":"Stevenson; Patriots","view":"Format-dependent / monitor price","core":"A better Patriots offense means more goal-line chances.","body":"Don't draft Stevenson expecting a touch monopoly \u2014 draft him for what an improved Patriots offense does to his scoring chances. The logic runs through field position: better offenses reach the red zone more often, and goal-line carries are the highest-leverage touches in fantasy, worth several ordinary carries apiece. A back can lose passing downs, even split early-down work, and still smash his price if he owns the carries that matter most.\n\nThat's why his path is touchdown-driven rather than volume-driven, and why the value tilts by format \u2014 touchdown-dependent production plays up wherever receptions count for less and TD weight runs heavier. The honest caveat, matching the medium confidence, is that touchdowns are the noisiest stat in football; a goal-line role is a probability play, never a guarantee. Watch how New England deploys him near the stripe and adjust for your league's scoring.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"stronger in half-PPR and standard.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"stronger in half-PPR and standard.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"stronger in half-PPR and standard.","auctionTailoring":"Scoring format (full/half/standard PPR); TD scoring weight; League size and auction budget."},{"code":"R59","section":"RB","title":"Josh Jacobs is a volume-and-TD back whose upside is more weather and script dependent than receiving-blueprint dependent","players":"Josh Jacobs","view":"Format-dependent / monitor price","core":"Josh Jacobs is a volume-and-TD back whose upside is more weather and script dependent than receiving-blueprint dependent.","body":"Some backs earn their ceiling through the passing game; Jacobs isn't built that way. His path to big fantasy weeks runs through carries and touchdowns, which makes his output hostage to conditions \u2014 game script that keeps his team running, and weather that pushes offenses toward the ground. When those align he can carry your week; when his team falls behind, there's no receiving blueprint to bail out the stat line.\n\nThat dependence is why the projection calls him positive but less league-winning than his peers in full PPR: reception-heavy scoring rewards exactly the skill set he doesn't lean on. Practically, his price should float with your format, because a back like this is worth meaningfully more where a catch counts for little.\n\nMedium confidence fits a profile argument rather than a role concern; heavier passing-down usage than expected is the thing that would break it.","effect":"positive but less league-winning than peers in full PPR","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"draft more in standard and half-PPR.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"draft more in standard and half-PPR.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"draft more in standard and half-PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R61","section":"RB","title":"D\u2019Andre Swift benefits from Chicago\u2019s vacated WR volume only indirectly","players":"D\u2019Andre Swift; Chicago; More; Bears\u2019","view":"Price-sensitive / near fair value","core":"More dump-offs are possible, but the Bears\u2019 schedule complexity keeps him volatile.","body":"Vacated targets in Chicago sound like a windfall for Swift until you trace how they'd actually reach him. A running back doesn't inherit a wideout's routes \u2014 he inherits dump-offs, the leftovers that arrive only when downfield options are covered, which makes the benefit real but secondhand and unreliable.\n\nLayer on the Bears' schedule complexity and you get a player whose week-to-week output should swing more than his season line suggests: some games funnel him checkdowns, others erase him entirely. The market appears to have priced all of this correctly, which is why the projection lands at mostly fair.\n\nIn draft terms that makes Swift a reasonable roster piece at his slot and a mistake a round early. Medium confidence leaves room for movement \u2014 a defined pass-game role in camp would make him better than fair, while a crowded rotation tips him the other way.","effect":"mostly fair at price","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"okay RB3, not a priority.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"okay RB3, not a priority.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"okay RB3, not a priority.","auctionTailoring":"League size and auction budget."},{"code":"R62","section":"RB","title":"James Conner\u2019s old Arizona departure matters because it creates real rookie workload room for Love","players":"James Conner; Arizona; Love. Arizona; Murray; Conner; Cardinals; Love","view":"Format-dependent / monitor price","core":"Arizona explicitly shifted out of the Murray/Conner era.","body":"Read Arizona's moves as a sentence: Conner is gone, the front office explicitly closed the Murray/Conner era, and the Cardinals spent the 1.03 on Love. Teams don't clear a veteran workload and draft a back that high without intending to use him \u2014 draft capital at that level is the strongest usage signal the offseason offers, because staffs are judged on whether picks like that produce.\n\nConner's departure is the enabling half of the story: rookie backs usually have to wrestle touches from an incumbent, and Love simply won't. A cleaner path means earlier volume, and early volume separates rookie backs who matter in September from ones who matter in November. Medium confidence acknowledges the unknowns every rookie carries \u2014 pass protection, ball security, camp health.\n\nA thin depth chart behind him strengthens the call; a veteran addition would muddy it fast.","effect":"Love\u2019s path becomes cleaner","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"interpret Cardinals drafting Love at 1.03 as an intent signal.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"interpret Cardinals drafting Love at 1.03 as an intent signal.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"interpret Cardinals drafting Love at 1.03 as an intent signal.","auctionTailoring":"League size and auction budget."},{"code":"R63","section":"RB","title":"Rico Dowdle-type hidden volume backs are less attractive this year because so many teams upgraded offenses and committees","players":"Rico Dowdle-type","view":"Underpriced","core":"Rico Dowdle-type hidden volume backs are less attractive this year because so many teams upgraded offenses and committees.","body":"Every year drafters stash the boring back who might stumble into carries, and this year that strategy is quietly worse. When teams across the league upgrade their offenses and formalize committees, the pool of unclaimed volume shrinks \u2014 hidden-workload candidates in the Dowdle mold need a vacuum to fill, and there are fewer vacuums.\n\nThe projection follows directly: replacement-level RBs are weaker bets than first-wave breakout candidates, because the bland-volume back's best case is modest while the contingent-upside back's best case is a league-winner. That asymmetry should reshape your bench. Late picks are lottery tickets, and you want the ones with real jackpots, not the ones that merely refund the entry fee.\n\nMedium confidence reflects a structural read rather than a player-specific one; roster and bench depth sharpen it, since extra spots make speculating on upside nearly free.","effect":"replacement-level RBs are weaker bets than first-wave breakout candidates","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"spend bench spots on contingent upside, not bland volume.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"spend bench spots on contingent upside, not bland volume.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"spend bench spots on contingent upside, not bland volume.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"R64","section":"RB","title":"Jaleel McLaughlin\u2019s value took a hit with Dobbins back and Waddle arriving","players":"Jaleel McLaughlin; Dobbins; Waddle; Denver","view":"Overpriced or discount required","core":"Denver is more pass-efficient and less likely to need gadget RB touches to create offense.","body":"Two doors closed on McLaughlin at once: Dobbins is back, and Waddle's arrival remakes what Denver's offense needs. His appeal rested on being a manufactured-touch outlet \u2014 the gadget back a limited offense leans on to create easy yards. A more pass-efficient Denver doesn't need to scheme up those touches anymore, and Dobbins reclaims the conventional backfield work, leaving McLaughlin squeezed from both directions.\n\nThat's why the projection reads as a meaningful standalone downgrade rather than a mild ding: the very reason he had value has been engineered away. In draft terms his old price is now a trap, because no version of this depth chart, as currently built, pays it back.\n\nMedium confidence leaves one out \u2014 a camp surprise that rebuilds his package of touches \u2014 but absent that, let someone else in your league act on the stale ranking.","effect":"meaningful standalone downgrade","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"avoid unless camp clearly reopens the role.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"avoid unless camp clearly reopens the role.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"avoid unless camp clearly reopens the role.","auctionTailoring":"League size and auction budget."},{"code":"R66","section":"RB","title":"Dameon Pierce\u2019s move to Philadelphia is depth, not draftable role","players":"Dameon Pierce; Philadelphia","view":"Format-dependent / monitor price","core":"He signed a one-year deal and projects as insurance.","body":"One-year deals for veteran backs are the NFL's way of buying insurance, and that's exactly how to read Pierce landing in Philadelphia. He projects as depth, and depth behind a functioning backfield has no standalone value on draft day \u2014 you'd be spending a pick on a player whose usefulness begins only after an injury, and nothing about this signing promises he'd inherit a full role even then.\n\nThe contract term is the tell: teams committing to a back's future give him years or money, and Philadelphia offered neither. Practically, that makes Pierce a name for the watchlist rather than the draft queue in all but the deepest formats. Medium confidence mostly reflects injury randomness \u2014 one preseason hit to the Eagles' backfield rewrites this instantly, and league size determines how quickly you'd need to be the one reacting.","effect":"unspecified standalone fantasy value","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"leave on waivers.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"leave on waivers.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"leave on waivers.","auctionTailoring":"League size and auction budget."},{"code":"R67","section":"RB","title":"The Broncos\u2019 trade for Jaylen Waddle is slightly negative for bronco RB receiving volume","players":"The Broncos\u2019; Jaylen Waddle; More; Broncos RBs","view":"Underpriced","core":"More efficient WR separation can reduce low-aDOT RB target share.","body":"Trades ripple, and the quiet casualty of the Waddle deal is the checkdown. A receiver who separates efficiently gives his quarterback open throws downfield, and every one of those completions is a target that no longer drifts to a back leaking into the flat \u2014 low-aDOT RB targets are largely the byproduct of coverage winning.\n\nSo Denver's backs should lose a slice of receiving work even if not a single carry changes hands. The projection calls it a tiny reception drag, and tiny is the operative word: this shifts a format lean, not a player's core valuation. Reception-light scoring insulates you from the effect almost entirely, while full PPR feels it at the margins.\n\nConfidence sits at low-to-medium because target distribution is genuinely hard to forecast from one move; early-season usage will confirm or bury the theory, so hold it loosely.","effect":"tiny reception drag for Denver backs","conf":"Low to Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"prefer Broncos RBs in standard/half-PPR.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"prefer Broncos RBs in standard/half-PPR.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"prefer Broncos RBs in standard/half-PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R68","section":"RB","title":"The Chiefs\u2019 addition of Justin Fields adds a small hidden drag to Kenneth Walker\u2019s goal-line monopoly","players":"The Chiefs\u2019; Justin Fields; Kenneth Walker; Designed QB; Walker","view":"Overpriced or discount required","core":"Designed QB runs matter near the stripe.","body":"Goal-line carries are the scarcest, most valuable touches in fantasy, and a running quarterback is the one teammate who can poach them without ever appearing on the RB depth chart. That's the quiet cost of Kansas City adding Justin Fields: designed keepers near the stripe come straight out of the short plunges Walker would otherwise own outright.\n\nThe projection here is a loss of one to two rushing touchdowns versus a pure pocket-QB setting \u2014 not a role change, just a tax on his single most profitable play type. Practically, that turns Walker from a pay-anything monopoly into a buy-at-a-discount asset.\n\nMedium confidence fits, because nobody yet knows how often the Chiefs will actually call Fields's number inside the five; if camp reveals heavy QB-run packages, deepen the discount, and in bigger leagues with tighter budgets, hold that line harder.","effect":"-1 to -2 rushing TD expectation versus a pure pocket-QB setting","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"still buy Walker, just not as if he is in 2019 KC.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"still buy Walker, just not as if he is in 2019 KC.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"still buy Walker, just not as if he is in 2019 KC.","auctionTailoring":"League size and auction budget."},{"code":"R69","section":"RB","title":"Cardinals opponents remain rush-friendly enough to create some \u201crun your way into games\u201d scripts","players":"Cardinals; Hard; Brissett; Cardinals RB","view":"Format-dependent / monitor price","core":"Hard schedules can still mean heavy second-half usage if the team hides Brissett.","body":"Bad teams can still feed a running back, especially when opponents invite it. The read on Arizona is that its slate stays rush-friendly enough to produce games where the ground attack becomes the whole plan, and a hard schedule cuts both ways: if the Cardinals are hiding Brissett, second halves can turn into extended handoff sessions rather than pass-happy chases.\n\nThat's the mechanism behind Love's carry floor looking sturdier than raw team quality suggests \u2014 volume driven by game management, not by winning. In practice, the market's blanket fade of Cardinals backfield touches is probably too aggressive, though this is a floor argument, not a ceiling one.\n\nConfidence is only low-to-medium, so let price make the decision: the thesis strengthens if Arizona commits to a run-first identity and weakens the moment the offense starts chasing points early.","effect":"Love\u2019s carry floor may be better than raw team quality implies","conf":"Low to Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"do not fully fade Cardinals RB volume.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"do not fully fade Cardinals RB volume.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"do not fully fade Cardinals RB volume.","auctionTailoring":"League size and auction budget."},{"code":"R70","section":"RB","title":"In general, the best RB bets this year are not simply talented players, but runners attached to stable lines, improving QBs, and favorable schedules","players":"Cook; Walker; Dobbins; Hall; Love; RB-heavy; Player Market; Action Drake London; Still","view":"Price-sensitive / near fair value","core":"Cook, Walker, Dobbins, Hall, and Love fit that form better than many price-adjacent peers.","body":"Talent evaluation is where drafters spend their energy, but running back rewards context more than any other position. The line determines whether carries become yards, the quarterback determines whether boxes stay light and scoring drives keep coming, and the schedule determines how often scripts stay run-friendly.\n\nCook, Walker, Dobbins, Hall, and Love all sit in ecosystems that check those boxes better than similarly priced peers, and the estimate here is that structural edges of this kind are worth roughly five to ten percent over market when raw ability is a coin flip. That's rarely enough to justify jumping a full tier, but it's exactly the margin that should break ties inside one.\n\nMedium confidence is appropriate \u2014 lines and quarterbacks can wobble in-season \u2014 and the edge matters most with bigger benches and deeper leagues, where small percentage gains compound.","effect":"these structural edges are worth roughly 5% to 10% over market when talent is close","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"use ecosystem as the tiebreaker in RB-heavy draft pockets. Wide receiver insights Wide receiver value board Player Market note My view Action Drake London current market best early-round WR value Still underpriced because Atlanta schedule helps Target Rome Odunze current market best breakout WR Excellent concentration bet after DJ Moore trade Target Christian Watson current market best mid-round WR Ceiling real if healthy, variance high Target in best ball Jayden Higgins current market best late-round WR Draftable role-up upside Target Tre\u2019 Harris current market deep sleeper WR Cheap contingent upside Target late Jaxon Smith-Njigba current market safest WR Correctly priced, maybe slightly rich for pure ceiling Neutral Sources: current market WR projections and value article, 2025 WR stats, and team transaction tracker.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"use ecosystem as the tiebreaker in RB-heavy draft pockets. Wide receiver insights Wide receiver value board Player Market note My view Action Drake London current market best early-round WR value Still underpriced because Atlanta schedule helps Target Rome Odunze current market best breakout WR Excellent concentration bet after DJ Moore trade Target Christian Watson current market best mid-round WR Ceiling real if healthy, variance high Target in best ball Jayden Higgins current market best late-round WR Draftable role-up upside Target Tre\u2019 Harris current market deep sleeper WR Cheap contingent upside Target late Jaxon Smith-Njigba current market safest WR Correctly priced, maybe slightly rich for pure ceiling Neutral Sources: current market WR projections and value article, 2025 WR stats, and team transaction tracker.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"use ecosystem as the tiebreaker in RB-heavy draft pockets. Wide receiver insights Wide receiver value board Player Market note My view Action Drake London current market best early-round WR value Still underpriced because Atlanta schedule helps Target Rome Odunze current market best breakout WR Excellent concentration bet after DJ Moore trade Target Christian Watson current market best mid-round WR Ceiling real if healthy, variance high Target in best ball Jayden Higgins current market best late-round WR Draftable role-up upside Target Tre\u2019 Harris current market deep sleeper WR Cheap contingent upside Target late Jaxon Smith-Njigba current market safest WR Correctly priced, maybe slightly rich for pure ceiling Neutral Sources: current market WR projections and value article, 2025 WR stats, and team transaction tracker.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"W3","section":"WR","title":"Davante Adams\u2019 14-touchdown 2025 with the Rams is the main internal ceiling cap on Puka\u2019s red-zone share","players":"Davante Adams\u2019; Rams; Puka","view":"Underpriced","core":"Davante Adams\u2019 14-touchdown 2025 with the Rams is the main internal ceiling cap on Puka\u2019s red-zone share.","body":"Fourteen touchdowns is a lot of red-zone oxygen for one teammate to absorb, and Adams's 2025 haul with the Rams is exactly the internal competition that keeps Puka from projecting as the position's absolute scoring ceiling. The mechanism is simple: target volume between the twenties is Puka's kingdom, but inside the twenty an established finisher commands looks that cap the spike weeks touchdowns create.\n\nSo you're drafting the target king with a slightly muted TD profile \u2014 one still worth more than the market price, just through catches rather than scores. Medium confidence reflects the obvious fragility here: red-zone pecking orders shift quickly with health and usage, and if Adams's role shrinks, Puka's ceiling reopens.\n\nFormat matters too \u2014 full PPR pays his reception floor handsomely, while heavier TD scoring dilutes exactly the part of his game this caps.","effect":"Puka remains target king but may lag the absolute top TD ceiling","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"prefer Puka in full PPR over standard.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"prefer Puka in full PPR over standard.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"prefer Puka in full PPR over standard.","auctionTailoring":"Scoring format (full/half/standard PPR); TD scoring weight; League size and auction budget."},{"code":"W5","section":"WR","title":"JSN\u2019s main risk is that 36% target share is almost impossible to repeat","players":"Not specified beyond the insight text","view":"Underpriced","core":"JSN\u2019s main risk is that 36% target share is almost impossible to repeat.","body":"A 36% target share is the kind of number that almost never happens twice, and that's the honest bear case on JSN \u2014 not talent, arithmetic. Shares that extreme require everything breaking one direction at once: scripts funneling throws to one man, a quarterback locked onto him, nobody else commanding the ball.\n\nGiving back two to five points of target share is baked into this projection even if he remains every bit the player he showed. The practical translation is friendlier than it sounds, though: he can surrender that volume and still be underpriced, which is why the call is to take him \u2014 just build your expectation on an elite-but-normal workload rather than another outlier.\n\nMedium confidence fits; the call weakens if the offense adds serious target competition and strengthens if the depth chart around him stays thin.","effect":"-2% to -5% target-share regression, even if talent remains elite","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"take him, but do not project another volume outlier season.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"take him, but do not project another volume outlier season.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"take him, but do not project another volume outlier season.","auctionTailoring":"League size and auction budget."},{"code":"W6","section":"WR","title":"Seattle\u2019s QB continuity with Sam Darnold is better for JSN floor than many realize","players":"Seattle QB; Sam Darnold; Darnold","view":"Overpriced or discount required","core":"Darnold\u2019s 2025 efficiency metrics were strong.","body":"Continuity at quarterback rarely excites anyone, but it's quietly the most important stabilizer a target hog can have. Darnold returning means JSN keeps the same timing, the same route relationships, and a distributor whose 2025 efficiency numbers were genuinely strong \u2014 so the doomsday scenario where a passing-game reset craters his volume mostly disappears. The right adjustment is no adjustment: don't dock him for quarterback risk beyond ordinary variance.\n\nNotice, though, what this argument protects \u2014 the floor, not the ceiling. Stability is exactly the kind of comfort drafters pay up for eagerly, which is why the stance here is to demand a discount rather than fund a story the whole room can see. Medium confidence is fair: Darnold sustaining that efficiency is the load-bearing assumption, and any wobble at quarterback drags the floor thesis down with it.","effect":"floor remains intact","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"no quarterback downgrade adjustment needed beyond ordinary variance.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"no quarterback downgrade adjustment needed beyond ordinary variance.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"no quarterback downgrade adjustment needed beyond ordinary variance.","auctionTailoring":"League size and auction budget."},{"code":"W7","section":"WR","title":"Ja\u2019Marr Chase is one of the few stars whose market still undersells ceiling slightly","players":"Ja\u2019Marr Chase","view":"Underpriced","core":"He saw 185 targets in 2025 and still projects over 121 catches and 10.6 TDs.","body":"You'd expect a receiver coming off 185 targets to be fully priced, yet the projection of over 121 catches and 10.6 touchdowns still clears what the market is paying. Ceilings like this get undersold through simple anchoring: drafters decide nothing can beat its cost at the very top, so genuine outlier volume gets flattened into a tier with players who don't share it.\n\nChase's edge is that his workload and his scoring are both elite \u2014 you aren't choosing between the reception floor and the touchdown ceiling. A projected three to seven percent over price makes him a defensible top-three overall pick, not merely a safe one.\n\nThe conditional sits right in the number, though: it holds if Burrow is truly healthy, so quarterback availability is the one variable to track, and full PPR rewards the catch volume most.","effect":"+3% to +7% versus current price if Burrow is truly healthy","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"worthy top-three overall selection.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"worthy top-three overall selection.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"worthy top-three overall selection.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W9","section":"WR","title":"Amon-Ra St.\u00a0Brown remains one of the best between-format plays because his role survives almost any game script","players":"Amon-Ra St.\u00a0Brown","view":"Underpriced","core":"He had 172 targets and 117 catches in 2025.","body":"Script-proof roles are the closest thing fantasy has to a savings account. When his team trails, St. Brown gets peppered underneath; when it leads, he moves the chains \u2014 and 172 targets with 117 catches in 2025 is what that looks like over a full season.\n\nBecause his production doesn't depend on game flow breaking a particular way, his weekly floor is unusually high even for a first-round pick, and that reliability earns a modest markup: one to five percent over market in full PPR, closer to fair in formats where catch volume pays less. Practically, he's the pick when you want your first-rounder to never lose you a week.\n\nHigh confidence is warranted; the only real threat to the call is something that redistributes his targets, and even then the reception base is enormous.","effect":"+1% to +5% versus market in full PPR, closer to fair elsewhere","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"elite safe first-rounder.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"elite safe first-rounder.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"elite safe first-rounder.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W10","section":"WR","title":"Jameson Williams\u2019 growth slightly caps Amon-Ra\u2019s late-round ceiling but helps total offense quality","players":"Jameson Williams\u2019; Amon-Ra; Jameson","view":"Underpriced","core":"Jameson Williams\u2019 growth slightly caps Amon-Ra\u2019s late-round ceiling but helps total offense quality.","body":"Every ascending deep threat takes a small bite out of the target hog beside him, and that's the tradeoff Jameson Williams's growth forces on this offense. Amon-Ra's concentrated share softens a touch as Williams commands more looks, but the whole pie improves \u2014 defenses stretched vertically leave cleaner space underneath, drives sustain, and efficiency rises across the board.\n\nFor Amon-Ra that nets out to a slightly trimmed ceiling with the floor intact, which barely dents his case. The sharper move sits on the other side of the equation: you still buy Amon-Ra happily, but Williams is where the value curve bends, because the market hasn't fully repriced an expanding role.\n\nMedium confidence suits a call built on a trend continuing \u2014 if Williams's usage plateaus, the concern evaporates, though so does the relative value argument that comes with it.","effect":"concentrated target share softens a touch, efficiency rises","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"still buy Amon-Ra, but Jameson is the sharper relative value.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"still buy Amon-Ra, but Jameson is the sharper relative value.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"still buy Amon-Ra, but Jameson is the sharper relative value.","auctionTailoring":"League size and auction budget."},{"code":"W12","section":"WR","title":"Atlanta\u2019s easy official schedule boosts London\u2019s case","players":"Atlanta; London","view":"Underpriced","core":"Atlanta\u2019s easy official schedule boosts London\u2019s case.","body":"Schedule edges are usually too small to build a draft around, and that's precisely how to use this one. Atlanta's official slate rates easy, and softer opposition means more scoring drives, more red-zone trips, and fewer weeks where London fights through elite coverage in depressed game environments \u2014 worth roughly 0.4 to 0.8 points per game by this estimate.\n\nThat's not enough to vault him over a tier, but it's exactly the margin that should settle otherwise-even choices, which is why the play is breaking ties toward London against similarly ranked receivers stuck in harsher spots.\n\nMedium confidence is right for any schedule-based call, because preseason strength ratings drift as teams improve or collapse; if Atlanta's opponents prove better than projected, the edge quietly shrinks toward nothing, while attrition around the league could just as easily widen it.","effect":"+0.4 to +0.8 FPPG","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"use him as a tiebreaker over similarly ranked WRs in harder environments.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"use him as a tiebreaker over similarly ranked WRs in harder environments.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"use him as a tiebreaker over similarly ranked WRs in harder environments.","auctionTailoring":"League size and auction budget."},{"code":"W14","section":"WR","title":"Lamb\u2019s tough Dallas schedule trims the floor more than the ceiling","players":"Lamb; Dallas","view":"Price-sensitive / near fair value","core":"Lamb\u2019s tough Dallas schedule trims the floor more than the ceiling.","body":"Volatility, not decline, is the real cost of a punishing slate. When Dallas hits its toughest defensive stretches, Lamb's low-end weeks get lower, but his talent and role keep the blowup games fully available against everyone else \u2014 the schedule squeezes the bottom of his range far more than the top.\n\nThe practical read follows from that shape: he's near fair value in aggregate, so pay the market price and not a dollar more, and recognize the profile suits formats that harvest spike weeks automatically over lineups where an ugly matchup tempts you into benching a star.\n\nMedium confidence is appropriate for schedule-driven reasoning, since projected defensive strength is noisy in July; if a couple of those feared units regress, the volatility argument fades and you simply own a fairly priced elite receiver.","effect":"modest weekly volatility increase","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"better in best ball than in lineups where you dislike matchup swings.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"better in best ball than in lineups where you dislike matchup swings.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"better in best ball than in lineups where you dislike matchup swings.","auctionTailoring":"League size and auction budget."},{"code":"W15","section":"WR","title":"George Pickens in Dallas is still undervalued if drafters think last season was name-brand noise","players":"George Pickens; Dallas","view":"Underpriced","core":"He was WR5 in 2025 PPR output on 1,429 yards and 9 TDs, and projects for 1,201.8 yards in 2026.","body":"Markets hold grudges, and Pickens is paying for a reputation the numbers already refuted. A WR5 finish in 2025 PPR scoring on 1,429 yards and 9 touchdowns is not name-brand noise \u2014 it's a full season of elite production \u2014 and the 2026 projection of 1,201.8 yards builds in regression while still clearing his price.\n\nThe psychology is the whole edge: drafters who decided long ago what Pickens is keep discounting the evidence, and that lingering skepticism creates the projected six-to-ten percent gap versus cost. In draft terms, he's a conviction buy in the WR2/WR3 range, where you're handed borderline-WR1 output at a middle-class price.\n\nMedium confidence acknowledges the honest caveats \u2014 the projection already assumes a step back, and the call strengthens if his Dallas target role looks locked in through camp and weakens if it doesn't.","effect":"+6% to +10% versus price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"strong WR2/WR3 target.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"strong WR2/WR3 target.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"strong WR2/WR3 target.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W17","section":"WR","title":"Rashee Rice is one of the hardest WRs to rank because the top-seven projection has to land in eleven games","players":"Rashee Rice","view":"Price-sensitive / near fair value","core":"His full-season projection of nearly 99 catches and 9.7 TDs is top-seven at the position, but a six-game suspension leaves eleven games for it to happen in.","body":"Nearly 99 catches and 9.7 touchdowns is a top-seven positional projection, and the first thing to do with a number like that is prorate it: the six-game suspension leaves Rice eleven games to get there, not seventeen. What survives the arithmetic is still interesting, because markets hate uncertainty more than they hate mediocrity, and a player with a wide range of outcomes gets priced closer to his floor than his median.\n\nSo the edge isn't on the full season, which the missing games have already taxed; it's on the weeks he actually plays, where a role that size is worth more per game than a discounted draft cost implies. That shapes the play: hold your price, let the suspension do the discounting for you, and expect the roster spot to start earning in Week 7.\n\nMedium confidence matches the bet's structure \u2014 anything that clarifies his role on return converts this from leverage play to plain value, and full-PPR formats are where that catch volume cashes in hardest. Deep benches carry him through the ban far more comfortably than shallow ones.","effect":"+10% to +15% versus price across the eleven games he plays","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"buy the suspension discount, not a top-six WR price; he returns in Week 7.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"buy the suspension discount, not a top-six WR price; he returns in Week 7.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"buy the suspension discount, not a top-six WR price; he returns in Week 7.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W18","section":"WR","title":"The KC additions of Kenneth Walker and Justin Fields do create volume drag risk for Rice","players":"The KC; Kenneth Walker; Justin Fields; Rice","view":"Format-dependent / monitor price","core":"The KC additions of Kenneth Walker and Justin Fields do create volume drag risk for Rice.","body":"New teammates rarely subtract from a star receiver directly; they subtract from the extremes. With Walker and Fields now in Kansas City, more possessions end on the ground, which means fewer of the desperate, throw-everything afternoons that generate a wideout's monster target counts. Rice's outlook shifts accordingly: the ultra-high-volume weeks get rarer, and his ceiling leans more on efficiency than on forced throws.\n\nThat's a genuine drag but not a fade \u2014 it's the difference between buying volume you can bank and buying volume plus a bonus you shouldn't count on. So hold a disciplined price rather than chasing, and let format guide the weighting, since full PPR feels any lost catch volume most acutely.\n\nMedium confidence is honest here: how run-heavy this offense actually becomes is the open question, and early-season play-calling will answer it fast.","effect":"fewer ultra-high-volume pass weeks, more efficiency-based ceiling","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"still buy, but with slightly fewer forced targets than old KC.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"still buy, but with slightly fewer forced targets than old KC.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"still buy, but with slightly fewer forced targets than old KC.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W19","section":"WR","title":"Justin Jefferson is no longer an auto-ceiling pick at full freight","players":"Justin Jefferson; London","view":"Overpriced or discount required","core":"His 2025 line was below the WR1 monsters despite 30.4% target share, and current projections keep him behind several peers.","body":"When a 30.4% target share produces a season below the true WR1 monsters, the problem isn't opportunity \u2014 it's everything surrounding it. That's the uncomfortable math on Jefferson: he commanded the volume, the results lagged, and current projections keep him behind several peers anyway, so paying his name-brand cost means paying for a ceiling the recent evidence stopped guaranteeing.\n\nA projected range of minus two to plus four percent versus price describes a fine pick, not an edge \u2014 draft him and you'll be perfectly content, but you won't beat the market, and options like London offer a better ratio of outcome to cost. Medium confidence leaves room for the rebound case, since volume that heavy usually finds its scoring eventually and any environmental improvement restores the ceiling quickly.\n\nUntil the price reflects the risk, though, the discipline is simple: discount or pass.","effect":"-2% to +4% versus cost","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"fine pick, but London and some cheaper WRs offer better value.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"fine pick, but London and some cheaper WRs offer better value.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"fine pick, but London and some cheaper WRs offer better value.","auctionTailoring":"League size and auction budget."},{"code":"W20","section":"WR","title":"Jefferson\u2019s value improves if you want pure target-floor, not touchdown projection","players":"Jefferson","view":"Underpriced","core":"Jefferson\u2019s value improves if you want pure target-floor, not touchdown projection.","body":"The market keeps scoring Jefferson on how many touchdowns it expects, and that framing hides where his real edge lives: the target column. Volume is the stickiest thing in fantasy \u2014 touchdowns bounce around from year to year, but a receiver who commands looks at Jefferson's level converts them into catches and yards under nearly any game script.\n\nThat's the definition of a floor you can build a roster around, and floors get systematically underpaid in rooms chasing last season's scoring spikes. Practically, that means paying a few dollars past the sheet price rather than losing him to a bidder who blinked, especially in full PPR, where every reception cashes and the effect is strongest.\n\nThe medium confidence reflects format sensitivity: in standard scoring with heavy TD weight, the edge shrinks toward neutral, and league size and budget shape how hard you can press it.","effect":"stronger in full PPR than standard","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"format-adjust upward in PPR.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"format-adjust upward in PPR.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"format-adjust upward in PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); TD scoring weight; League size and auction budget."},{"code":"W22","section":"WR","title":"Brown benefits from Maye more than he lost from leaving Philadelphia","players":"Brown; Maye; Philadelphia. The Patriots\u2019","view":"Format-dependent / monitor price","core":"The Patriots\u2019 ecosystem improved enough that the move is not a fade.","body":"Quarterback play is the variable that most changed for Brown, and the read here is that the Patriots' ecosystem improved enough to erase the cost of leaving Philadelphia. A wideout of Brown's caliber carries his separation and catch-point skills with him; what he can't control is target quality, and if Maye supplies more of it than the old situation did, the downside case most drafters carry into the room is overstated.\n\nThis isn't a pound-the-table buy \u2014 the verdict is explicitly price-dependent \u2014 but it does mean that when he's sitting next to older receivers at the same cost, the tiebreaker should go his way, since younger legs plus an improving offense beats fading veterans at a flat price. Medium confidence means you let the room set the number rather than chase.\n\nEarly functioning from the Patriots' passing game strengthens the call; poor target quality unwinds it quickly.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"be willing to draft him ahead of older similarly priced WRs.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"be willing to draft him ahead of older similarly priced WRs.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"be willing to draft him ahead of older similarly priced WRs.","auctionTailoring":"League size and auction budget."},{"code":"W25","section":"WR","title":"Moore\u2019s move is also a direct downgrade for the Bears\u2019 old target pie","players":"Moore; Bears\u2019; Chicago; Rome Odunze; Bears","view":"Overpriced or discount required","core":"Chicago losing Moore means remaining WR and TE shares consolidate, but total offense may not fully replace his skill set.","body":"There are two trades hiding inside one transaction here. Moore's departure shrinks Chicago's proven receiving talent, and while the leftover targets have to go somewhere \u2014 that's the consolidation case for the remaining Bears pass-catchers \u2014 the offense may not fully replace what his skill set produced.\n\nTargets that migrate to lesser players tend to arrive with worse efficiency attached, so a bigger slice of a shrinking pie can still net out flat. The practical split: Rome Odunze is the one clear beneficiary worth moving up, because he's best positioned to absorb the highest-value routes, while the tertiary Bears options are inheriting volume without a track record of converting it.\n\nDemand a real discount on anything Chicago beyond Odunze, in auctions and snakes alike. Medium confidence \u2014 camp role reporting could firm up the consolidation, and a genuine offensive step forward would soften the fade.","effect":"","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"upgrade Rome Odunze, but be careful with tertiary Bears.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"upgrade Rome Odunze, but be careful with tertiary Bears.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"upgrade Rome Odunze, but be careful with tertiary Bears.","auctionTailoring":"League size and auction budget."},{"code":"W27","section":"WR","title":"Waddle\u2019s main risk is target competition and not efficiency","players":"Waddle","view":"Underpriced","core":"The move increases pass quality but may spread targets more naturally.","body":"Efficiency isn't the worry with Waddle \u2014 what the market should be pricing is how many mouths now share the target pie. The move raises pass quality while spreading the ball more naturally, and that combination has a specific fantasy signature: better yards per target, fewer of the desperation looks that pad reception totals without producing much.\n\nFor a talent like Waddle, the trade usually nets positive, because efficiency gains compound on every target he does earn while the lost targets were the least valuable ones anyway. Draft him a beat ahead of sheet price and let the big weeks come to you \u2014 the profile is tailor-made for best ball, where spike games get harvested automatically, and he remains comfortably playable in managed leagues.\n\nMedium confidence turns on the target distribution actually settling his way; full PPR blunts the edge slightly, since raw catch volume matters more there.","effect":"better yards per target, maybe fewer desperation targets","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"excellent best-ball target; still very good in managed leagues.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"excellent best-ball target; still very good in managed leagues.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"excellent best-ball target; still very good in managed leagues.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W28","section":"WR","title":"Miami\u2019s loss of Waddle and Hill means Dolphins replacement WRs are avoid territory in standard drafts","players":"Miami; Waddle; Hill; Dolphins","view":"Overpriced or discount required","core":"Miami\u2019s loss of Waddle and Hill means Dolphins replacement WRs are avoid territory in standard drafts.","body":"Somebody has to catch passes in Miami, and that logic is exactly the trap. Losing both Waddle and Hill removes the two roles that organized the entire passing offense, and until real usage data reveals who inherits which job, every replacement Dolphins wideout is a guess dressed up as a value.\n\nVacated targets are seductive because the volume looks free, but volume without a defined role rarely survives contact with the regular season \u2014 rotations churn, and the drafter who spent a real pick on the ambiguity eats the loss. The high confidence is earned: this is an information call, not a projection call, and the information doesn't exist yet.\n\nIn standard-depth drafts, stay out entirely; the only defensible exposure is a late dart in deep formats where the bench spot costs nothing. Role data establishing a clear top target is the one thing that changes it.","effect":"no clear stable fantasy WR starter until role data changes","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"stay away outside deep dart throws.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"stay away outside deep dart throws.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"stay away outside deep dart throws.","auctionTailoring":"League size and auction budget."},{"code":"W30","section":"WR","title":"Evans\u2019 touchdown ceiling in San Francisco is still enormous","players":"Evans\u2019; San Francisco; Purdy; TD-heavy","view":"Format-dependent / monitor price","core":"He plays with a projected 4,100-yard Purdy and strong line support.","body":"Pairing Evans with a Purdy projected for 4,100 yards and strong line support is the kind of environment that keeps a touchdown-driven profile viable. Red-zone scoring is the least stable stat in fantasy, but it stabilizes considerably when the offense reliably reaches scoring range \u2014 and San Francisco's projected passing production suggests plenty of trips.\n\nThat's why the format split matters so much here: in standard scoring, where touchdowns carry the day, Evans holds his value comfortably; in full PPR, the thinner reception floor makes the same price harder to justify. Treat him as a scoring-settings question rather than a talent question. Pay market in neutral formats, nudge him up where TD weight runs heavy, and stay disciplined in reception-first leagues.\n\nMedium confidence \u2014 the call weakens if targets concentrate elsewhere in the offense, and strengthens if the projected passing efficiency shows up early in the season.","effect":"better standard-league value than PPR value","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"slightly bump in TD-heavy scoring.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"slightly bump in TD-heavy scoring.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"slightly bump in TD-heavy scoring.","auctionTailoring":"Scoring format (full/half/standard PPR); TD scoring weight; League size and auction budget."},{"code":"W31","section":"WR","title":"Christian Kirk is the more fragile 49ers asset because he needs high route volume to matter","players":"Christian Kirk","view":"Overpriced or discount required","core":"Christian Kirk is the more fragile 49ers asset because he needs high route volume to matter.","body":"The bet on Christian Kirk is really a bet on routes, and that's what makes him the shakier piece of the 49ers' receiving picture.\n\nReceivers who win on accumulation rather than splash have to be on the field constantly to return their draft cost, and any squeeze on snaps \u2014 a crowded rotation, run-leaning scripts, a healthy depth chart \u2014 cuts straight into his output with no big-play profile to cushion the fall.\n\nMarkets price recognizable names off past roles rather than current ones, and that's precisely the trap flagged here: fair to slightly overpriced if drafted on name memory. So make the room prove it. Take him only at a genuine discount and walk away once bidding reaches ordinary market value.\n\nMedium confidence: a locked-in, high-route role would rehabilitate the price, while committee usage confirms the fade, and full PPR raises the stakes since his value lives on catches.","effect":"fair to slightly overpriced if drafted on name memory","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"avoid unless the room discounts him heavily.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"avoid unless the room discounts him heavily.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"avoid unless the room discounts him heavily.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W33","section":"WR","title":"Odunze\u2019s outlook improves further if Colston Loveland draws more underneath/TE coverage attention","players":"Odunze; Colston Loveland; Caleb","view":"Format-dependent / monitor price","core":"Odunze\u2019s outlook improves further if Colston Loveland draws more underneath/TE coverage attention.","body":"Coverage math is the quiet lever in Chicago. If Colston Loveland starts commanding real attention underneath and from the defenders assigned to tight ends, Odunze inherits cleaner releases and softer looks downfield \u2014 exactly the route-win and downfield efficiency boost projected here.\n\nDefenses have finite resources; every defender who cheats toward the middle of the field is one who can't bracket the perimeter, and downfield receivers feel that relief most because their targets carry the biggest yardage payoff per completion. Price-wise this is a monitor, not a mandate: pay market, don't force the pick, and let the lean settle tiebreakers within a tier.\n\nThe one spot to get deliberate is the stack \u2014 pairing Odunze with Caleb in upside builds captures both ends of the efficiency gain at once. Medium confidence, and Loveland's early usage is the tell that either activates or shelves the whole thesis.","effect":"route-win and downfield efficiency boost","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"stack with Caleb in upside builds.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"stack with Caleb in upside builds.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"stack with Caleb in upside builds.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W34","section":"WR","title":"Christian Watson is a better best-ball pick than managed-league pick","players":"Christian Watson","view":"Underpriced","core":"He profiles as the best mid-round WR, which fits his spike profile.","body":"Spike weeks are worth more when you don't have to predict them, and that one fact splits Christian Watson's value cleanly across formats. The profile \u2014 best mid-round WR with a boom-driven scoring pattern \u2014 is agony in managed leagues, where you must guess which weeks to start him and absorb the duds you activate.\n\nBest ball erases the problem entirely: the format auto-selects his big games and discards the rest, which is why the projected edge lands at eight to twelve percent over price there and meaningfully less in weekly-start leagues. Draft accordingly. In best ball, push him up a round or to the front of his tier and spread exposure across builds; in managed leagues, hold closer to sheet price.\n\nMedium confidence \u2014 a steadier target role would raise the weekly-lineup floor, while continued feast-or-famine usage keeps this a format-specific buy rather than a universal one.","effect":"+8% to +12% versus price in best-ball formats, less in weekly-start leagues","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target when format rewards volatility.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target when format rewards volatility.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target when format rewards volatility.","auctionTailoring":"League size and auction budget."},{"code":"W35","section":"WR","title":"Jayden Higgins is exactly the type of late-round WR to buy","players":"Jayden Higgins; Houston","view":"Underpriced","core":"Current market labels him best late-round WR, and Houston\u2019s receiver room still has role uncertainty around him.","body":"Late-round receiver picks should be lottery tickets with a plausible path, and Higgins checks both boxes. The market already calls him the best late-round WR, yet Houston's receiver room still carries genuine role uncertainty around him \u2014 and at this price, that ambiguity works for you rather than against you.\n\nWhen a role is unsettled, the cost reflects the doubt; if the job crystallizes in his direction, you own the outcome for a fraction of what a defined role would have cost. That asymmetry is why the projected edge runs ten to fifteen percent over his late-round price: the downside is a wasted end-of-bench pick, the upside is a weekly contributor.\n\nStash him with intent wherever bench depth allows, and lean harder in larger leagues where replacement receivers get scarce fast. Medium confidence \u2014 reporting that clarifies Houston's pecking order is the swing variable, in either direction.","effect":"+10% to +15% versus late-round price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"strong bench stash.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"strong bench stash.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"strong bench stash.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"W36","section":"WR","title":"Tre\u2019 Harris is the better deep sleeper than generic rookie WR darts","players":"Tre\u2019 Harris","view":"Format-dependent / monitor price","core":"Current market specifically tagged him as a deep sleeper.","body":"Deep sleepers earn the label through a specific, identifiable path rather than mere obscurity, and that's the distinction being drawn with Tre' Harris \u2014 the market has specifically tagged him as a deep sleeper instead of lumping him into the generic rookie dart pile.\n\nThe difference matters at the very end of drafts, where most picks are interchangeable shrugs: a player someone bothered to single out usually has a scenario attached, and scenarios are what turn a final-round flier into a league-winner when the contingency hits. Be honest about what you're buying, though \u2014 the value here is pure contingent upside, worth nothing until circumstances break his way.\n\nThat caps the investment at the last three rounds, full stop, and makes him most sensible in formats with real bench depth where a speculative hold costs nothing. Confidence sits at low to medium; concrete role news would transform the calculus overnight.","effect":"pure contingent upside","conf":"Low to Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"last-three-round pick only.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"last-three-round pick only.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"last-three-round pick only.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"W39","section":"WR","title":"Nico Collins is harder to trust until Houston\u2019s line is cleaner","players":"Nico Collins; Houston","view":"Overpriced or discount required","core":"Houston\u2019s line projects near the bottom.","body":"Protection problems travel down the route tree, and that's the specific concern with Nico Collins. Houston's offensive line projects near the bottom, and receivers whose value flows through deeper-developing routes suffer most when the quarterback can't wait for them \u2014 those patterns need time a leaky line won't grant, so the damage shows up as efficiency erosion even while talent and target share hold steady.\n\nThat's why the prescription is a discount rather than a fade: the player is fine, the environment is the tax. Don't pay full sticker in managed leagues, where you'd be starting him weekly at a strong price and sweating the pass protection game to game; best ball is the friendlier home, since you only bank the weeks when everything holds up.\n\nMedium confidence \u2014 visible line improvement, or a scheme shift toward quicker throws, would loosen the discount requirement considerably.","effect":"efficiency drag on deeper-developing routes","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"more attractive in best ball than as a weekly must-start at strong prices.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"more attractive in best ball than as a weekly must-start at strong prices.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"more attractive in best ball than as a weekly must-start at strong prices.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W40","section":"WR","title":"Chris Olave is safer than market sentiment usually admits","players":"Chris Olave","view":"Underpriced","core":"He was WR6 in 2025 and had 156 targets.","body":"A WR6 finish on 156 targets in 2025 is the kind of r\u00e9sum\u00e9 that should end an argument, yet drafters keep treating Olave like a question mark. That gap between production and perception is where value lives.\n\nHeavy target volume is the most repeatable signal in fantasy \u2014 it reflects a role and a quarterback's trust, both of which persist far more reliably than efficiency streaks or touchdown luck \u2014 so a receiver who just banked it carries an unusually sturdy floor into the next season. When the room stays skeptical of a player the numbers already vouch for, you're being paid to take the boring position.\n\nThe projected edge is modest rather than massive, which fits the play: draft him as a disciplined WR2, pay a touch over sheet price if forced, and don't chase beyond that. Medium confidence, with full-PPR formats rewarding the target base most directly.","effect":"modest positive versus price if the room stays skeptical","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"strong target as a disciplined WR2.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"strong target as a disciplined WR2.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"strong target as a disciplined WR2.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W41","section":"WR","title":"Courtland Sutton\u2019s 2026 efficiency should benefit from Waddle more than suffer from him","players":"Courtland Sutton; Waddle; Better WR; Denver; Sutton","view":"Format-dependent / monitor price","core":"Better WR rooms often lift boundary TD efficiency.","body":"Adding Waddle to Denver's receiver room reads at first like target competition for Sutton, but the opposite mechanism should win out: better receiver rooms tend to lift boundary touchdown efficiency, and Sutton is the boundary. The football logic is simple \u2014 once a defense must honor a second dangerous receiver, it loses the freedom to roll coverage toward the perimeter, and the contested throws that define Sutton's scoring profile get cleaner looks.\n\nThe projected effect is a slight boost, not a breakout, so the play is patience rather than aggression: hold at market price, treat him as tier-dependent in snake drafts, and never force it. Where the thesis really pays is correlation \u2014 Denver stacks should carry some Sutton exposure, because the same passing-game rise that validates the call lifts every leg of the stack together.\n\nMedium confidence, with how defenses actually allocate coverage early serving as the proof point.","effect":"slight boost to Sutton as defenses lose freedom","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"Denver stacks should include some Sutton exposure.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"Denver stacks should include some Sutton exposure.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"Denver stacks should include some Sutton exposure.","auctionTailoring":"League size and auction budget."},{"code":"W42","section":"WR","title":"Michael Wilson is a hidden casualty of Arizona\u2019s backfield shift and quarterback loss","players":"Michael Wilson; Arizona; Love; Brissett; McBride","view":"Overpriced or discount required","core":"He had 126 targets in 2025, but Love plus Brissett suggests lower pass volume and more underneath concentration to McBride.","body":"On paper, 126 targets in 2025 makes Michael Wilson look like a carry-forward lock, and that's exactly the mistake the market is primed to make. Arizona's quarterback situation now runs through Love plus Brissett, which points toward lower pass volume with more of what remains funneled underneath to McBride \u2014 and Wilson sits outside both of those flows.\n\nWhen a passing offense shrinks and simultaneously concentrates toward a tight end, the perimeter receiver absorbs the cut twice: fewer total throws, and a smaller share of them. That's how you arrive at the projected eight-to-twelve percent haircut versus a projection that simply carries last year's usage forward. Take him only at a genuine discount, fade outright wherever breakout hype has inflated the cost, and don't reach in snakes.\n\nMedium confidence; a surprising commitment to passing volume in Arizona is the main thing that would rescue the profile.","effect":"-8% to -12% versus a simple carry-forward projection","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"fade at breakout hype prices.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"fade at breakout hype prices.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"fade at breakout hype prices.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W44","section":"WR","title":"Malik Nabers is a dangerous valuation problem after the ACL and meniscus injury","players":"Malik Nabers; Giants","view":"Format-dependent / monitor price","core":"League injury reporting noted the torn ACL, full meniscus repair, and second cleanup surgery, though the Giants remain hopeful for Week 1.","body":"A torn ACL is one thing; a torn ACL with a full meniscus repair and a second cleanup surgery is a different animal. The Giants say they're hopeful for Week 1, and maybe they are, but repaired meniscus tissue tends to slow a rehab timeline, and a return-trip procedure hints the knee hasn't cooperated the whole way.\n\nEven when elite receivers make it back on schedule, the early weeks often bring capped snaps, a softened route tree, and quarterbacks who look elsewhere until the burst proves itself. So the talent argues ceiling while the medical file argues slow ramp, and your price has to split the difference.\n\nMedium confidence means the range is genuinely wide: a clean camp and full Week 1 workload would flip this bullish quickly, while any setback should drop him a tier. Deeper benches absorb the wait far better than shallow ones.","effect":"talent says upside, health says likely slow ramp","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"do not pay full superstar price in redraft.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"do not pay full superstar price in redraft.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"do not pay full superstar price in redraft.","auctionTailoring":"League size and auction budget."},{"code":"W45","section":"WR","title":"Nabers is better as a late-season bet than an early-season bet","players":"Nabers","view":"Overpriced or discount required","core":"Nabers is better as a late-season bet than an early-season bet.","body":"Knee rehabs rarely end when the player is activated; they end when the explosiveness returns, and that tends to happen deep into a season rather than in September. Build in a first-half usage discount of 10% to 15% against full-strength expectation and the shape of the asset changes: he's a receiver who may cost you early lineup decisions but could be a genuine difference-maker by the fantasy playoffs.\n\nThat profile punishes shallow redraft rosters, where every weekly start matters and replacements sit on the wire, and rewards deeper formats where you can stash him and let the calendar do the work. If your league crowns champions in Weeks 15 through 17, the late-season version is the one you're actually buying. Medium confidence: strong August practice reports would shrink the discount, while limited early snaps would confirm it.","effect":"first-half usage discount of 10% to 15% versus full-strength expectation","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"slight fade in shallow redraft, stronger buy in deeper formats where patience is possible.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"slight fade in shallow redraft, stronger buy in deeper formats where patience is possible.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"slight fade in shallow redraft, stronger buy in deeper formats where patience is possible.","auctionTailoring":"Playoff-week settings (Weeks 15\u201317); League size and auction budget."},{"code":"W46","section":"WR","title":"Isaiah Likely\u2019s arrival is also mildly negative for Giants WR target density","players":"Isaiah Likely; Giants WR; Giants; Nabers","view":"Overpriced or discount required","core":"The new Giants regime is telling you it wants TE involvement.","body":"When a new coaching regime imports a pass-catching tight end, it's telling you where the ball is going, and the Likely acquisition reads like a deliberate statement about the middle of the field. Those seam and crossing routes are exactly the targets that sustain a secondary receiver's fantasy value \u2014 high-percentage, chain-moving looks that stack catches in PPR formats.\n\nIf Likely absorbs them, the Giants' non-Nabers wideouts lose both raw routes and the most valuable slice of their target menu, leaving them dependent on lower-probability perimeter work. Nabers himself is insulated; alpha target shares survive tight end involvement far better than complementary roles do.\n\nIn practice, that means shaving the ancillary Giants receivers down your board and demanding a real discount before rostering any of them, especially in full PPR where lost receptions bite hardest. It's a medium-confidence read \u2014 camp usage will show whether the regime means it.","effect":"secondary WRs lose routes and high-value middle-field targets","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"downgrade non-Nabers receivers.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"downgrade non-Nabers receivers.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"downgrade non-Nabers receivers.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W48","section":"WR","title":"Emeka Egbuka deserves attention because rookie WR competition was softer last year but he still finished strongly enough to matter","players":"Emeka Egbuka","view":"Underpriced","core":"Emeka Egbuka deserves attention because rookie WR competition was softer last year but he still finished strongly enough to matter.","body":"Last year's rookie receiver class gave Egbuka a softer field to stand out against, and skeptics will use that context to wave away his finish. Don't. Producing enough to matter as a rookie is meaningful regardless of who else stumbled, because early production reflects trust \u2014 routes and real targets \u2014 that coaching staffs rarely hand out by accident.\n\nReceivers who earn genuine roles in year one tend to see those roles expand in year two, and role growth is the entire breakout mechanism here: the same player on more opportunity is a leap waiting to happen. The market pricing him as ordinary is your edge, and in draft terms he's the upside bench receiver you take a beat early rather than late.\n\nMedium confidence, so let the depth chart arbitrate \u2014 a crowded target tree caps the case, a clear number-two role confirms it, and bigger benches make the wait painless.","effect":"fair breakout case if role grows again","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"acceptable upside bench WR.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"acceptable upside bench WR.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"acceptable upside bench WR.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"W50","section":"WR","title":"Davante Adams is at significant TD-regression risk after a 14-TD season on only 60 catches","players":"Davante Adams; TD-regression","view":"Overpriced or discount required","core":"Davante Adams is at significant TD-regression risk after a 14-TD season on only 60 catches.","body":"Touchdown rate is the noisiest component of receiver scoring, and a season built on 14 scores against just 60 catches leans on it about as heavily as a season can. When a finish rests on end-zone conversion rather than volume, the following year almost always sags back toward the target and reception numbers underneath \u2014 and 60 catches is a modest foundation.\n\nIn full PPR that leaves little weekly floor once the scoring luck normalizes, which is why the standard-league carve-out matters: his value survives best where receptions count for nothing and touchdowns carry the day. Paying a price that assumes another spike season is paying for the outlier. Medium confidence, because veteran red-zone specialists occasionally do repeat, and a genuinely concentrated goal-line role would soften the regression case.\n\nAbsent a clear volume bump, though, let someone else fund last year's touchdown run.","effect":"likely underperform if drafted on last year\u2019s TD rate","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"standard-league only and at the right price.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"standard-league only and at the right price.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"standard-league only and at the right price.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W51","section":"WR","title":"Jameson Williams is a stronger relative value than his ADP history suggests","players":"Jameson Williams","view":"Underpriced","core":"He finished WR12 in 2025 on only 102 targets because the efficiency and explosive plays were enormous.","body":"Only 102 targets produced a WR12 finish in 2025, and that ratio is the quiet tell in this profile. Per-target production that strong means every incremental route carries outsized fantasy weight \u2014 he doesn't need a target explosion, just a modest bump, to beat where his ADP history has settled.\n\nExplosive-play receivers also get systematically underpriced in redraft rooms because drafters anchor on reception volume, which makes him look thinner than his point totals say he is. The projected gain of 6% to 10% from even a slight route increase is the practical takeaway: you're buying a proven scoring rate with a cheap call option on volume.\n\nHe fits best in half-PPR, standard scoring, and best ball, where spike weeks get captured rather than smoothed out; full PPR discounts him fairly. Medium confidence \u2014 a real route-share climb in camp strengthens this, while flat usage merely keeps him fairly priced.","effect":"+6% to +10% if routes tick up even slightly","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"strong target in non-full-PPR and best ball.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"strong target in non-full-PPR and best ball.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"strong target in non-full-PPR and best ball.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W52","section":"WR","title":"Drake London\u2019s value is helped by the the league\u2019s easiest official schedule","players":"Drake London","view":"Format-dependent / monitor price","core":"This is substantial enough to matter in projection ties.","body":"Schedule is a tiebreaker, not a thesis \u2014 but when the official numbers say nobody has an easier path, it's a tiebreaker worth using. Softer opposing defenses generally mean more scoring chances, friendlier game scripts, and fewer weeks where a top receiver gets erased by an elite corner, all of which lift a target hog's floor and ceiling together.\n\nLondon already profiles as a high-volume centerpiece, so the tailwind compounds a strength rather than propping up a weakness. Practically, when you're torn between him and another receiver in the same tier in rounds two and three, break the tie his way \u2014 the evidence says it's substantial enough to decide projection coin flips.\n\nThe caveat keeping this at medium confidence: preseason schedule strength is a forecast of other teams, and defenses change fast, so treat it as a nudge, not a reason to reach a full round.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"he should be among your starting shortlists in round two and three.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"he should be among your starting shortlists in round two and three.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"he should be among your starting shortlists in round two and three.","auctionTailoring":"League size and auction budget."},{"code":"W53","section":"WR","title":"DeVonta Smith is a direct beneficiary of the A.J. Brown trade","players":"DeVonta Smith; A.J. Brown; Brown","view":"Underpriced","core":"He had 113 targets even with Brown present and now has far more room.","body":"One hundred thirteen targets as the second option \u2014 that's what Smith commanded with A.J. Brown still on the field soaking up coverage and volume alike. Remove Brown and two things happen at once: the vacated targets have to land somewhere, and the most polished route-runner left standing is the natural heir.\n\nEstablished receivers inherit alpha vacancies far more reliably than unproven ones, which is why the projected bump of 10% to 14% over old baselines reads as earned rather than hopeful. The offset is coverage: he moves up the defensive hierarchy too, and bracket attention taxes efficiency even as volume climbs \u2014 that's what keeps this at medium confidence.\n\nDraft him a full round ahead of stale rankings, and lean harder in full PPR, where the added catches compound weekly. A camp target monopoly would strengthen the call; an offense that spreads the vacated work broadly would trim it.","effect":"+10% to +14% versus old projection baselines","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"one of the best target-share increase bets in fantasy.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"one of the best target-share increase bets in fantasy.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"one of the best target-share increase bets in fantasy.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W55","section":"WR","title":"Marquise Brown and Elijah Moore are likely to cannibalize each other more than either truly replaces A.J. Brown","players":"Marquise Brown; Elijah Moore; A.J. Brown","view":"Overpriced or discount required","core":"Marquise Brown and Elijah Moore are likely to cannibalize each other more than either truly replaces A.J. Brown.","body":"Replacing an alpha receiver with two complementary pieces rarely produces one usable fantasy asset; it usually produces two frustrating ones. Marquise Brown and Elijah Moore overlap enough stylistically that neither projects to inherit A.J. Brown's role wholesale \u2014 instead they split routes, alternate hot weeks, and leave you guessing which one shows up.\n\nThat's the cannibalization problem: even if the combined target pool is respectable, fantasy scoring doesn't reward a committee, it rewards concentration, and you can only start one of them at a time. In managed leagues that makes both nearly untouchable at anything resembling a normal price, because the floor is a donut and the ceiling depends on a coin flip.\n\nDeep leagues can justify a very late dart on whichever falls furthest. Medium confidence \u2014 a training camp where one clearly wins the primary role would break the tie and revive that player alone.","effect":"both are hard to trust weekly","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"avoid unless they fall very far.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"avoid unless they fall very far.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"avoid unless they fall very far.","auctionTailoring":"League size and auction budget."},{"code":"W57","section":"WR","title":"Bills weather will matter late, but their indoor-adjusted offensive quality should still carry","players":"Bills","view":"Overpriced or discount required","core":"Bills weather will matter late, but their indoor-adjusted offensive quality should still carry.","body":"Late-season cold and wind in Buffalo is a real thing, and it's also one of the most over-traded narratives in fantasy drafts. The evidence here cuts the other way: adjust the Bills' offensive quality for indoor-equivalent conditions and the unit still grades out strong, meaning the underlying passing efficiency should carry through all but the worst weather weeks.\n\nThe practical effect is a mild late-year passing downgrade, not a collapse \u2014 a haircut, not a fade. Where the market gets it wrong is in the panic pricing, when drafters let December forecasts shove Bills pass-catchers below fair value. Take the modest discount when the room offers it, but don't manufacture one yourself.\n\nConfidence sits at low-to-medium because weather variance is genuinely unpredictable year to year, and a brutal run of playoff-week forecasts is the one scenario that would vindicate the fade.","effect":"only mild late-year passing downgrade","conf":"Low to Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"do not overcorrect on weather narratives.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"do not overcorrect on weather narratives.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"do not overcorrect on weather narratives.","auctionTailoring":"League size and auction budget."},{"code":"W58","section":"WR","title":"Waddle\u2019s departure makes the Broncos\u2019 perimeter room much more bankable and Miami\u2019s virtually unbankable","players":"Waddle; Broncos\u2019; Miami; Denver","view":"Underpriced","core":"Waddle\u2019s departure makes the Broncos\u2019 perimeter room much more bankable and Miami\u2019s virtually unbankable.","body":"Every so often one move rewrites two depth charts, and this is the cleanest example on the board. In Denver, Waddle's arrival gives the perimeter a defined pecking order \u2014 targets consolidate around a proven separator, and consolidation is what makes receivers startable, because you can finally predict where the volume goes.\n\nIn Miami, the same transaction hollows out the room: the remaining pieces are competing for a target tree without an anchor, which spreads opportunity thin and turns every wideout into a weekly guess. The play is symmetrical \u2014 buy Denver pass-catchers at prices still reflecting the old ambiguity, and fade Miami receivers whose cost hasn't fully absorbed the subtraction.\n\nHigh confidence, because target redistribution after a departure is one of the most reliable mechanisms in fantasy. The main thing that would soften it is Miami adding a legitimate replacement before drafts finish.","effect":"one transaction creates opposite fantasy effects for two teams","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"buy the Denver side, sell the Miami side.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"buy the Denver side, sell the Miami side.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"buy the Denver side, sell the Miami side.","auctionTailoring":"League size and auction budget."},{"code":"W59","section":"WR","title":"Some drafters will underrate DJ Moore because his team changed, but team change is the whole point","players":"Some; DJ Moore; Buffalo","view":"Underpriced","core":"Buffalo is a better fantasy offense than his old one.","body":"Drafters punish relocation almost reflexively \u2014 new team, new system, must be risky \u2014 and that reflex is precisely the market error to exploit here. Moore didn't move sideways; he moved into a better fantasy ecosystem, and offensive environment is one of the biggest levers on receiver scoring there is.\n\nBuffalo offers a stronger offense than the situation he left, so even a flat share of a richer pie is a raise. The projected effect is a meaningful positive re-rating, which in draft-room terms means treating his stale price as a discount window that closes as the hype builds through August.\n\nHigh confidence: the environment upgrade is a fact, not a projection. What would trim the call is Buffalo's target tree proving crowded enough to squeeze his share, so camp role reports are the checkpoint. Move early \u2014 this one won't stay mispriced for long.","effect":"meaningful positive re-rating","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target before the room fully catches up.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target before the room fully catches up.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target before the room fully catches up.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W61","section":"WR","title":"The weakest WR archetype this year is attached to downgraded QB situations or more crowded rooms","players":"Arizona; Miami WRs; San Francisco; Giants","view":"Overpriced or discount required","core":"Arizona secondary WRs, Miami WRs, some San Francisco ancillary pieces, and Giants secondary WRs fit that pattern.","body":"Two forces sink secondary receivers faster than anything else: a quarterback downgrade, which shrinks the whole fantasy pie, and a crowded room, which shrinks each slice of it. This year's landmine list clusters where those forces overlap \u2014 Arizona's secondary wideouts, the Miami receivers broadly, some San Francisco ancillary pieces, and the Giants' non-alpha options all fit the pattern.\n\nThe mechanism is unforgiving: complementary receivers live on the margin of an offense's efficiency, so when passing quality dips or targets fragment, they're the first players whose production falls below startable. The alphas in those places can survive on share; the number twos and threes can't. Portfolio-wise, that argues for underweighting the whole archetype rather than litigating each name, and demanding a real discount before any exception.\n\nHigh confidence, since both mechanisms are structural \u2014 though a preseason quarterback upgrade or an injury clearing out a room would rescue individual players.","effect":"","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"underweight these archetypes in your portfolio.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"underweight these archetypes in your portfolio.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"underweight these archetypes in your portfolio.","auctionTailoring":"League size and auction budget."},{"code":"W62","section":"WR","title":"Rookie WR breakouts should be approached more selectively than rookie RB or TE breakouts this year","players":"Rookie WR; McMillan","view":"Underpriced","core":"2025\u2019s rookie WR class mostly lagged, with McMillan the exception.","body":"Recent history is the caution flag: 2025's rookie receiver class mostly lagged, with McMillan the lone real exception, and that argues for more selectivity at wideout than at running back or tight end this year. The lesson isn't to avoid first-year receivers \u2014 it's to be pickier about what you pay for.\n\nReceiver is a hard position to translate because production requires target competition to clear and quarterback trust to develop, and draft capital guarantees neither. So the filter should be concentration and role clarity: a rookie walking into a thin target tree with a defined job beats a higher-drafted name buried in a crowded room.\n\nIn practice, pay up for the few who pass that filter and let the rest of the room chase pedigree alone. Medium confidence \u2014 one loud training camp can rewrite a role, so hold final judgment until depth charts firm up in August.","effect":"","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"chase concentration and role clarity, not draft-slot hype alone.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"chase concentration and role clarity, not draft-slot hype alone.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"chase concentration and role clarity, not draft-slot hype alone.","auctionTailoring":"League size and auction budget."},{"code":"W63","section":"WR","title":"Best-ball drafters should over-index on volatile room-changing receivers","players":"Best-ball; Pickens; Jameson; Watson; Evans; Waddle","view":"Format-dependent / monitor price","core":"Pickens, Jameson, Watson, Evans, and Waddle all gain relative value from format.","body":"Format changes what a receiver is worth, and best ball is where volatility stops being a bug. Pickens, Jameson, Watson, Evans, and Waddle share a profile: new or reshuffled receiver rooms, uncertain week-to-week target distribution, and genuine spike-week ability when their number is called.\n\nIn managed leagues that inconsistency taxes you every Sunday morning; in best ball the scoring simply harvests the good weeks and buries the bad ones, so the same player returns more realized points without you making a single decision. Room changes amplify the effect \u2014 unsettled hierarchies create both the down weeks the format forgives and the blowup weeks it captures.\n\nIn tournament builds especially, leaning harder on this group buys ceiling at prices set by managed-league nervousness. Medium confidence on any individual name; the portfolio logic is sturdier than any single bet, and clarified camp roles would move each price quickly.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"lean harder on them in tournament builds.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"lean harder on them in tournament builds.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"lean harder on them in tournament builds.","auctionTailoring":"League size and auction budget."},{"code":"W64","section":"WR","title":"Managed-league drafters should over-index on concentrated-volume receivers","players":"Managed-league; Amon-Ra; Brown; London; Moore; DeVonta; Chase","view":"Format-dependent / monitor price","core":"Amon-Ra, Brown, London, Moore, DeVonta, Chase, and JSN fit that frame better.","body":"Weekly lineup leagues reward a different receiver profile than best ball does, and the market rarely prices that gap. Receivers who dominate their own team's target funnel \u2014 the Amon-Ra, Brown, London, Moore, DeVonta, Chase, and JSN types \u2014 give you something a projection column hides: you never agonize over starting them.\n\nConcentrated volume compresses week-to-week variance, and in a managed format that stability converts directly into points you actually capture, because you're never benching the wrong guy or chasing a hot hand. So in home leagues, nudge these names up your board relative to thinner-role receivers with similar season-long projections, and let best-ball drafters pay for volatility instead.\n\nThe logic is structural rather than a bet on any single player, which is why confidence runs high; league size and budget are the tailoring levers, since deeper rosters make set-and-forget starters even more valuable.","effect":"","conf":"High","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"shape your WR room intentionally by format.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"shape your WR room intentionally by format.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"shape your WR room intentionally by format.","auctionTailoring":"League size and auction budget."},{"code":"W65","section":"WR","title":"The biggest single WR market inefficiencies are not at WR1 overall, but in the WR10-WR30 band","players":"WR10-WR30; That; Player Market; Action Trey McBride Consensus TE1; Worth; Target Brock Bowers Consensus TE2; Fair; Raiders; WR1 Target Tyler Warren","view":"Price-sensitive / near fair value","core":"That is where team changes and role changes are not fully reflected.","body":"Everyone argues about who the overall WR1 is, but that debate is nearly worthless \u2014 the top of the board is the most heavily scrutinized real estate in fantasy, and prices there are efficient. The genuine mispricing sits in the WR10-WR30 band, where offseason team changes and role changes haven't fully filtered into consensus cost.\n\nMarkets anchor on last season's finish and name recognition, and they update slowly when a receiver's situation shifts underneath the surface; that lag is your edge. Practically, this means allocating draft capital toward that band rather than paying full freight for safety at the very top, and doing the situational homework the room hasn't.\n\nConfidence is high at the band level, though any individual call still needs verification that the role change is real \u2014 camp usage and depth-chart clarity either confirm or kill each bet.","effect":"","conf":"High","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"attack that band aggressively and let others pay top-dollar for name safety. Tight end insights Tight end value board Player Market note My view Action Trey McBride Consensus TE1 / top projection Worth the premium because role is uniquely bankable Target Brock Bowers Consensus TE2 type Fair, with some hidden upside because Raiders still lack a WR1 Target Tyler Warren current market breakout TE label Undervalued second-wave TE buy Target Tucker Kraft current market value TE label Best mid-round TE value Target Isaiah Likely current market late-round TE label Real role-up path under Giants staff Target Travis Kelce Still name-brand expensive Fair only if discounted Neutral to slight fade Sources: current market TE projections and value article, 2025 TE stats, team transactions, and Giants scheme reporting.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"attack that band aggressively and let others pay top-dollar for name safety. Tight end insights Tight end value board Player Market note My view Action Trey McBride Consensus TE1 / top projection Worth the premium because role is uniquely bankable Target Brock Bowers Consensus TE2 type Fair, with some hidden upside because Raiders still lack a WR1 Target Tyler Warren current market breakout TE label Undervalued second-wave TE buy Target Tucker Kraft current market value TE label Best mid-round TE value Target Isaiah Likely current market late-round TE label Real role-up path under Giants staff Target Travis Kelce Still name-brand expensive Fair only if discounted Neutral to slight fade Sources: current market TE projections and value article, 2025 TE stats, team transactions, and Giants scheme reporting.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"attack that band aggressively and let others pay top-dollar for name safety. Tight end insights Tight end value board Player Market note My view Action Trey McBride Consensus TE1 / top projection Worth the premium because role is uniquely bankable Target Brock Bowers Consensus TE2 type Fair, with some hidden upside because Raiders still lack a WR1 Target Tyler Warren current market breakout TE label Undervalued second-wave TE buy Target Tucker Kraft current market value TE label Best mid-round TE value Target Isaiah Likely current market late-round TE label Real role-up path under Giants staff Target Travis Kelce Still name-brand expensive Fair only if discounted Neutral to slight fade Sources: current market TE projections and value article, 2025 TE stats, team transactions, and Giants scheme reporting.","auctionTailoring":"League size and auction budget."},{"code":"T4","section":"TE","title":"Brock Bowers is still a legitimate TE1 challenger","players":"Brock Bowers; McBride; Raiders","view":"Underpriced","core":"Current projections put him just behind McBride, and the Raiders still look thin at alpha-WR volume.","body":"Projections already slot Bowers just behind McBride, yet the market often prices that gap as if it were settled by rounds rather than decimal points. The structural case is target competition, or the lack of it: the Raiders still look thin at alpha-WR volume, and when no wideout commands a dominant share, the passing tree tends to run through the tight end by default.\n\nThat funnel hands Bowers a target floor most of the position can't touch, and it's what drives the projected four-to-eight percent edge over price, conditional on the share holding. In practice, any room that lets him slide well behind McBride is handing you top-tier production at a discount.\n\nThe call weakens if the Raiders add or develop a true target hog, or if the offense tilts hard toward the run; confidence is high otherwise, and TE-premium scoring only widens the payoff.","effect":"+4% to +8% versus price if target share holds","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"buy any time the market discounts him below McBride by multiple rounds.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"buy any time the market discounts him below McBride by multiple rounds.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"buy any time the market discounts him below McBride by multiple rounds.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T6","section":"TE","title":"Ashton Jeanty does not materially hurt Bowers\u2019 fantasy case unless the Raiders\u2019 passing volume collapses","players":"Ashton Jeanty; Bowers\u2019; Raiders\u2019; Bowers","view":"Overpriced or discount required","core":"The roster still lacks a dominant target hog at WR.","body":"A backfield built around one splashy runner tends to spook the market on every other pass catcher in the building, but the fear here is mostly misdirected. Jeanty competes for carries and checkdowns, not for the intermediate and seam targets that drive a tight end's scoring; the real threat to Bowers would be a dominant target hog at wide receiver, and the roster still doesn't have one.\n\nThe only scenario that genuinely dents the case is a collapse in the Raiders' passing volume \u2014 an offense leaning so hard on the ground game that everyone's target totals shrink together. Absent that, Jeanty's expanded role reshapes the backfield, not the target hierarchy. Confidence sits at medium because offensive identity is exactly the kind of thing new personnel can shift, so watch how the play mix skews early.\n\nTE-premium formats raise the stakes on reading this correctly, in Bowers' favor.","effect":"","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"do not downgrade Bowers sharply because of Jeanty's workload.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"do not downgrade Bowers sharply because of Jeanty's workload.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"do not downgrade Bowers sharply because of Jeanty's workload.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T10","section":"TE","title":"Warren should help, not hurt, Jonathan Taylor and quarterback efficiency in Indianapolis","players":"Warren; Jonathan Taylor; Indianapolis","view":"Format-dependent / monitor price","core":"A real tight end can stabilize the offense.","body":"Adding a legitimate tight end tends to raise the tide for an entire offense, and that's the frame to use here. A real seam threat gives the quarterback a high-percentage answer against pressure, keeps drives alive on money downs, and forces defenses to honor the middle of the field \u2014 which lightens boxes for Jonathan Taylor and steadies the passing game's efficiency in the process.\n\nWarren's presence in Indianapolis isn't a zero-sum target grab, then; it's the kind of addition that can lift the whole ecosystem while carving out every-week usage for himself. For your draft, that makes him a genuine path to a weekly positional edge rather than a rotational dart.\n\nConfidence stays medium because ecosystem effects are real but hard to time, so let price guide the entry point; TE-premium scoring makes the every-week upside considerably more valuable if it lands.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"Warren is one of the best bets to hit a real every-week TE advantage.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"Warren is one of the best bets to hit a real every-week TE advantage.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"Warren is one of the best bets to hit a real every-week TE advantage.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T11","section":"TE","title":"Kyle Pitts is finally correctly priced as a boom-bust TE rather than an inevitable star","players":"Kyle Pitts","view":"Price-sensitive / near fair value","core":"He was TE2 in 2025 PPR, but current projections still keep him below the truly stable elite.","body":"For once, the market and the profile agree. Pitts finished as the TE2 in 2025 PPR, yet projections still park him below the truly stable elite, and that's the right read: his production pattern is streaky, and one strong season doesn't retroactively make the weekly output dependable.\n\nBoom-bust tight ends carry real value \u2014 the spike weeks win matchups \u2014 but they shouldn't be priced like players whose floor you can bank, because scoring at the position is thin enough that dead weeks at TE are hard to paper over elsewhere in the lineup. Practically, that makes him a fine roster piece at his going rate and a mistake at anything above it.\n\nMedium confidence fits a call that's about price rather than talent; full PPR and TE-premium scoring nudge the math friendlier, while standard scoring leans harder on the bust weeks.","effect":"mostly fair","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"fine at value, not a must-have.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fine at value, not a must-have.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"fine at value, not a must-have.","auctionTailoring":"TE-premium scoring; Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"T13","section":"TE","title":"Goedert\u2019s one-year contract also suggests real near-term usefulness","players":"Goedert","view":"Format-dependent / monitor price","core":"Teams do not bring back veteran TEs just to make them decorative.","body":"Contract structure is an underrated tell at tight end. A team that brings a veteran back on a one-year deal isn't stashing him for development or paying for locker-room presence \u2014 it's buying immediate, on-field usefulness, and that implies a real role in the current plan.\n\nGoedert's deal fits that pattern, and roles generate tight end fantasy value far more reliably than raw talent does; a TE who runs routes on early downs and draws red-zone looks will out-produce a flashier player buried in a rotation. For your draft, that signal separates him from veterans coasting on name recognition whose actual usage has quietly eroded.\n\nMedium confidence is appropriate, since contract inference is suggestive rather than proof, and training-camp usage reports would firm the call up either way. TE-premium leagues make the cheap-role calculus even more attractive at his likely cost.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"prefer him over older \u201cbrand name only\u201d tight ends if pricing is close.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"prefer him over older \u201cbrand name only\u201d tight ends if pricing is close.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"prefer him over older \u201cbrand name only\u201d tight ends if pricing is close.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T16","section":"TE","title":"Cleveland\u2019s heavier run-action and explosive-pass environment is a TE-friendly setup if pass protection holds","players":"Cleveland; TE-friendly; Fannin","view":"Format-dependent / monitor price","core":"Cleveland\u2019s heavier run-action and explosive-pass environment is a TE-friendly setup if pass protection holds.","body":"Run-action passing games are where tight ends eat. Cleveland's heavier play-action, explosive-pass identity pulls linebackers toward the line of scrimmage and opens the intermediate seams \u2014 exactly the real estate a tight end works \u2014 so the scheme itself can manufacture target quality even for a player without an established reputation. That's why Fannin deserves more attention than the generic rookie discount he's getting; the environment does a lot of the lifting.\n\nThe whole thesis, though, hangs on the stated conditional: if pass protection doesn't hold, longer-developing play-action concepts get shelved for quick game, and the TE-friendly geometry disappears with them. Draft him as a cheap bet on scheme, sized to that risk. Medium confidence reflects the if \u2014 watch offensive line health and protection quality before scaling up, and remember TE-premium scoring fattens the payout when a bet like this hits.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"Fannin is more compelling than his generic rookie label implies.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"Fannin is more compelling than his generic rookie label implies.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"Fannin is more compelling than his generic rookie label implies.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T17","section":"TE","title":"Tucker Kraft is the best mid-round TE value","players":"Tucker Kraft","view":"Underpriced","core":"He profiles as the best-value TE for 2026.","body":"Best-value labels get thrown around loosely, but the mid-rounds are genuinely where tight end edges hide. Drafters tend to split into two camps \u2014 pay up for the elite or punt the position entirely \u2014 and that behavioral split leaves the middle of the board under-bid relative to what it returns.\n\nKraft profiles as the best-value TE for 2026, and the projected eight-to-twelve percent edge versus price is the kind of margin that quietly wins leagues, because you bank starter-level production while spending bench-level capital and free your early picks for running back and receiver depth. Timing is the craft: wait past the expensive names, but not so long that this tier is gone.\n\nMedium confidence means you shouldn't chase him at inflated cost; TE-premium scoring strengthens the case, and larger leagues make hitting on a mid-round starter even more valuable.","effect":"+8% to +12% versus price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"target as the optimal \u201cwait but not too long\u201d option.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"target as the optimal \u201cwait but not too long\u201d option.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"target as the optimal \u201cwait but not too long\u201d option.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T20","section":"TE","title":"Kelce\u2019s three-year re-signing helps real-football certainty but does not guarantee fantasy dominance in a more balanced KC offense","players":"Kelce","view":"Overpriced or discount required","core":"Kelce\u2019s three-year re-signing helps real-football certainty but does not guarantee fantasy dominance in a more balanced KC offense.","body":"Three years of contract security tells you the team believes in the player; it tells you nothing about target volume. That's the trap with Kelce's re-signing \u2014 the market reads roster certainty as fantasy certainty, when a more balanced Kansas City offense is precisely the environment that erodes the target concentration his fantasy dominance was built on.\n\nReal-football value and fantasy value diverge right here: a productive, trusted tight end in a distributed passing game can be great for his team and merely decent for your lineup. Name-brand pricing tends to lag that kind of shift by a season or more, which is why the burden of proof sits on the price, not the player.\n\nMedium confidence is fair, since an offense can always re-concentrate around its most trusted option, but until the cost reflects the balanced-attack risk, patience beats loyalty \u2014 even in TE-premium formats.","effect":"","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"neutral to slight fade.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"neutral to slight fade.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"neutral to slight fade.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T22","section":"TE","title":"George Kittle\u2019s Achilles and added receiving competition make him harder to trust week to week","players":"George Kittle Achilles","view":"Overpriced or discount required","core":"Current projections put him TE12.","body":"Achilles injuries are unforgiving for players whose game is built on burst and the catch-and-run, and that's before you account for the added receiving competition now in the building. Both forces attack the same foundation \u2014 route certainty and target share, the two inputs that make a tight end startable every week \u2014 which is exactly the cap the projection describes.\n\nA TE12 landing spot tells the story: the talent is respected, but the volume can no longer be assumed, and a player you can't trust weekly is worth meaningfully less in lineups you have to set than in formats that harvest spike weeks automatically. The practical read is a real discount requirement, sized to your format, with the managed-league haircut steeper than the best-ball one.\n\nMedium confidence, because recovery progress and camp usage will move this; full PPR softens the downside slightly.","effect":"cap on route certainty and target share","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"less attractive in managed leagues than best ball.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"less attractive in managed leagues than best ball.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"less attractive in managed leagues than best ball.","auctionTailoring":"TE-premium scoring; Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"T23","section":"TE","title":"Dalton Kincaid quietly benefits from Buffalo\u2019s better offense, but target concentration is less favorable after the DJ Moore trade","players":"Dalton Kincaid; Buffalo; DJ Moore","view":"Price-sensitive / near fair value","core":"Dalton Kincaid quietly benefits from Buffalo\u2019s better offense, but target concentration is less favorable after the DJ Moore trade.","body":"Two forces are pulling on Kincaid at once, and they roughly cancel. Buffalo's improved offense should lift everyone's efficiency \u2014 more scoring drives, more red-zone trips, better down-and-distance \u2014 but the DJ Moore trade adds a proven target earner to the tree, and target concentration is the lifeblood of tight end scoring.\n\nMild efficiency gains set against a mild target-share squeeze is the projection, and that's the definition of fair pricing: the situation got better and more crowded at the same time. In draft terms, take him when he's the best player available at cost and pass when he isn't, because there's no edge to chase in either direction.\n\nMedium confidence suits a call built on offsetting effects; a camp report showing the pecking order tilting his way, or Moore's, would break the tie. TE-premium scoring lifts his floor without creating a bargain.","effect":"mild efficiency up, mild target share down","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"fair pick, not a priority.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fair pick, not a priority.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"fair pick, not a priority.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T27","section":"TE","title":"Jake Ferguson is better as a volume-floor TE than as a ceiling TE","players":"Jake Ferguson; TE. He","view":"Price-sensitive / near fair value","core":"He projects 74 catches but only 607 yards.","body":"A projection of 74 catches against only 607 yards is a very specific shape of production, and you should draft the shape, not the name. Ferguson's line describes a short-area, high-volume role \u2014 plenty of receptions, modest air under them \u2014 which means his fantasy output is almost entirely a function of how your league pays for catches.\n\nIn full PPR or TE-premium formats, that reception floor is a legitimate weekly asset that rarely posts a dud; in standard scoring, the same season becomes a yardage-starved grind that needs touchdowns to matter. The mechanism cuts both ways: volume-floor players stabilize lineups but rarely win you a week outright, so he's a piece you build around rather than with.\n\nMedium confidence, since role-based projections are sturdier than talent bets; check your scoring settings before your rankings, because his value swings more on format than on anything he does.","effect":"stronger in tight-end-premium or full PPR than standard","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"format-dependent value only.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"format-dependent value only.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"format-dependent value only.","auctionTailoring":"TE-premium scoring; Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"T29","section":"TE","title":"Brenton Strange and Greg Dulcich are deeper names worth only contingent exposure","players":"Brenton Strange; Greg Dulcich; Both","view":"Format-dependent / monitor price","core":"Both project for meaningful routes but sit in offenses with unresolved volume questions.","body":"Deep-league dart throws should come with conditions attached, and these two are textbook cases. Strange and Dulcich both project for meaningful routes \u2014 the best leading indicator at the position, since routes precede targets and targets precede points \u2014 but each sits in an offense with unresolved volume questions, so the route share may be a slice of a pie that never gets baked.\n\nThat combination merits contingent exposure only: picks that cost nothing and pay off if the situation clarifies favorably. Best ball tolerates the variance because it harvests whatever spike weeks emerge; managed leagues force you to guess right on specific Sundays, which this profile punishes. Low-to-medium confidence is the honest grade here.\n\nCamp signals resolving the volume questions are your trigger to scale up, and deeper benches, bigger leagues, and TE-premium scoring all widen the case for the flier.","effect":"","conf":"Low to Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"best-ball only unless camp gives stronger signals.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"best-ball only unless camp gives stronger signals.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"best-ball only unless camp gives stronger signals.","auctionTailoring":"TE-premium scoring; Scoring format (full/half/standard PPR); Roster and bench size; League size and auction budget."},{"code":"T30","section":"TE","title":"Tight end is deeper now, but true bankable advantage still exists only at the very top or in a few mispriced middle-round bets","players":"McBride; Bowers; Warren; Loveland; Kraft; Likely; Warren-Kraft-Likely","view":"Underpriced","core":"McBride, Bowers, Warren, Loveland, Kraft, and Likely are the clearest positive-EV paths.","body":"Depth at a position and edge at a position are different things, and conflating them is the most common tight end mistake this season. The pool of playable options has grown, sure \u2014 but a rising replacement level just means mid-tier market prices buy you nothing you couldn't find later.\n\nBankable advantage now lives in two places: the very top, where McBride and Bowers offer week-in certainty, and the mispriced middle, where Warren, Loveland, Kraft, and Likely offer real production at a fraction of the cost. Everything between those poles is full price for replacement-level output. The right construction is a barbell \u2014 commit real capital to the top or shop the corridor hard, but don't split the difference.\n\nHigh confidence, because this is structural math more than player prediction, and TE-premium scoring raises the value of top-end certainty most of all; league size sets how deep the corridor runs.","effect":"","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"either pay for true edge or shop aggressively in the Warren-Kraft-Likely corridor.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"either pay for true edge or shop aggressively in the Warren-Kraft-Likely corridor.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"either pay for true edge or shop aggressively in the Warren-Kraft-Likely corridor.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"R71","section":"RB","title":"Rico Dowdle is the value side of the new Pittsburgh backfield","players":"Rico Dowdle; Pittsburgh; Steelers; Mike McCarthy; Jaylen Warren","view":"Underpriced","core":"Dowdle arrives in Pittsburgh with back-to-back 1,000-yard seasons and a reunion with Mike McCarthy, his former head coach in Dallas. His draft cost still sits around RB32, which prices him as a bench piece even though he profiles as the early-down and goal-line half of a two-man committee with Jaylen Warren.","body":"Back-to-back 1,000-yard seasons rarely sit at an RB32 price, and that gap is the whole case. Dowdle lands in Pittsburgh reunited with Mike McCarthy, the coach who ran his backfield in Dallas, and coaching familiarity tends to show up in real usage rather than on paper.\n\nIf he handles the early-down and goal-line half of a split with Jaylen Warren, he owns the touchdown-rich touches while the market still prices him like insurance. Goal-line work is the piece committees can't dilute: scores concentrate near the stripe, and the back who gets those carries beats his sheet value even on modest volume. A six-to-ten-percent edge over cost is meaningful at the position's thin middle.\n\nConfidence is high here; the main variables are your league's size and how quickly camp reporting closes the window.","effect":"+6% to +10% versus current price","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Pay a modest RB3 price before camp buzz raises it.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Pay a modest RB3 price before camp buzz raises it.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Pay a modest RB3 price before camp buzz raises it.","auctionTailoring":"League size and auction budget."},{"code":"R72","section":"RB","title":"Kaleb Johnson is buried on the Pittsburgh depth chart","players":"Kaleb Johnson; Pittsburgh; Steelers; Rico Dowdle; Jaylen Warren","view":"Overpriced or discount required","core":"Pittsburgh signed Rico Dowdle to a two-year, $12.25 million deal, and it lands squarely on Kaleb Johnson. The 2025 third-round pick managed just 28 carries for 69 yards as a rookie and now sits third on the depth chart behind Jaylen Warren and Dowdle; his draft price has already slid more than two rounds.","body":"The math turned against Johnson the moment Pittsburgh guaranteed Rico Dowdle two years and $12.25 million. Teams don't spend that on a veteran to platoon him behind a young back who managed 28 carries for 69 yards as a rookie, and the depth chart now reads Jaylen Warren, Dowdle, then the 2025 third-rounder.\n\nThird options in NFL backfields need two injuries, not one, to matter for fantasy, which is why his cost has already tumbled more than two rounds and can keep sliding. An eight-to-twelve-percent haircut off the pre-signing price is the market catching up, not overreacting.\n\nThis is a high-confidence fade at cost; the only real counterargument would be camp reporting that carves him a path to touches, and until that appears he's a flier priced like a hope. Only larger leagues justify the stash.","effect":"-8% to -12% versus pre-signing price","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Spend nothing real on Johnson until camp reporting gives him a path to touches.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Spend nothing real on Johnson until camp reporting gives him a path to touches.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Spend nothing real on Johnson until camp reporting gives him a path to touches.","auctionTailoring":"League size and auction budget."},{"code":"R73","section":"RB","title":"Zach Charbonnet is a stash, not a plan","players":"Zach Charbonnet; Seattle; Seahawks","view":"Overpriced or discount required","core":"Charbonnet tore his ACL in Seattle's January playoff win and had surgery on February 20. The team says he is progressing well, but the standard nine-to-twelve-month timeline points to a PUP start and a return around December at best.","body":"A February 20 surgery date does the arithmetic for you: the standard nine-to-twelve-month ACL recovery points to a PUP start and a return around December at best, whatever encouraging language Seattle offers about his progress. Teams say a player is progressing well about every rehab; the calendar is the honest source. For drafters, that means Charbonnet can't be part of your weekly plan.\n\nHe's a roster spot spent on the possibility of playoff-week depth, and roster spots carry real cost in-season, when waiver churn wins leagues. Price him ten to fifteen percent below any healthy-season number and you're still only breaking even unless the return comes early. Confidence in the timeline logic is high.\n\nThe call gets friendlier in leagues with deep benches or IR slots that let him sit for free, and harsher in shallow formats where every spot must produce.","effect":"-10% to -15% versus a healthy-season price","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Spend nothing beyond a deep-league stash dollar and treat any midseason return as a bonus.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Spend nothing beyond a deep-league stash dollar and treat any midseason return as a bonus.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Spend nothing beyond a deep-league stash dollar and treat any midseason return as a bonus.","auctionTailoring":"League size and auction budget; Roster and IR spots."},{"code":"R74","section":"RB","title":"Jonathon Brooks is the buy whose window is closing","players":"Jonathon Brooks; Carolina; Panthers; Trevor Etienne; A.J. Dillon","view":"Underpriced","core":"Brooks will be roughly 20 months removed from his second ACL tear when Panthers camp opens, and Carolina let both Chuba Hubbard and Rico Dowdle leave, leaving Trevor Etienne and A.J. Dillon as the main competition. His ADP has already climbed to around the 11th round and keeps rising after strong OTA reports.","body":"Timing is the entire argument with Brooks. By the time Panthers camp opens he'll be roughly twenty months removed from his second ACL tear, deep into the window where burst typically returns, and Carolina cleared the room by letting Chuba Hubbard and Rico Dowdle walk, leaving only Trevor Etienne and A.J. Dillon in his way.\n\nThat's the rare combination of restored health and evaporated competition, and the market has noticed: his ADP has climbed to around the eleventh round and keeps moving on strong OTA reports. Rising prices punish patience, so the eight-to-fourteen-percent edge only exists if you act before camp confirms the story for everyone. Medium confidence is fair, since a second reconstruction carries real re-injury risk and one bad camp report unwinds the case.\n\nDeeper leagues, where contingent backfields matter most, should be most aggressive.","effect":"+8% to +14% versus current price if camp goes clean","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Bid a few real dollars now; a healthy camp pushes his price well past the bargain window.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Bid a few real dollars now; a healthy camp pushes his price well past the bargain window.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Bid a few real dollars now; a healthy camp pushes his price well past the bargain window.","auctionTailoring":"League size and auction budget."},{"code":"R75","section":"RB","title":"James Conner should not cost last year's price","players":"James Conner; Arizona; Cardinals; Jeremiyah Love; Tyler Allgeier","view":"Overpriced or discount required","core":"Conner's auction value has fallen hard after Arizona spent the No. 3 pick on Jeremiyah Love and added Tyler Allgeier. He is now stuck in a crowded committee backfield in his age-31 season.","body":"Age-31 running backs in crowded committees are how fantasy seasons quietly sink. Arizona told you its plan when it spent the No. 3 pick on Jeremiyah Love and then added Tyler Allgeier anyway; that isn't depth behind Conner, it's succession around him. High draft capital gets fed, which means Conner's path to his old workload runs through an organization actively building away from it.\n\nVolume is the entire fantasy asset for a veteran grinder, and once the touches split three ways, the floor drops along with the ceiling. A six-to-ten-percent discount off last year's price isn't pessimism, it's the new baseline, and name recognition means someone in your room will pay retail anyway. The fade earns its high confidence.\n\nLeague size is the main lever: skip him easily in shallow formats, insist on the markdown in deeper ones.","effect":"-6% to -10% versus last year's price","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Let another manager overbid on the name.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Let another manager overbid on the name.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Let another manager overbid on the name.","auctionTailoring":"League size and auction budget."},{"code":"R76","section":"RB","title":"Jeremiyah Love is a defined-workload rookie, not a wait-and-see dart","players":"Jeremiyah Love; Arizona; Cardinals","view":"Price-sensitive / near fair value","core":"Arizona made Love the No. 3 overall pick and plans to feed him immediately. A first-round rookie back with a defined workload is a target, not a dart, even inside a weakened Cardinals offense.","body":"No. 3 overall picks at running back come with a promise attached: Arizona plans to feed Love immediately, and draft capital that high functions as a workload guarantee in a way no camp battle can. That certainty is the asset.\n\nMost rookie backs ask you to project a role; Love asks you only to project efficiency, and even a weakened Cardinals offense can't take away carries the front office spent that pick to justify. The catch is that the market already knows all of this, so the edge is modest, roughly fair value with a small bonus if you pay sheet price instead of chasing.\n\nPractically, that means drafting him as an every-week starter you buy at cost, not a lottery ticket you hope falls. Medium confidence reflects rookie variance and the surrounding offense; league size shapes how patient you can afford to be.","effect":"0% to +5% versus price at a fair cost","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"Pay for the projected touches and treat him as a likely RB1 rather than waiting on a fall.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"Pay for the projected touches and treat him as a likely RB1 rather than waiting on a fall.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"Pay for the projected touches and treat him as a likely RB1 rather than waiting on a fall.","auctionTailoring":"League size and auction budget."},{"code":"R77","section":"RB","title":"Bucky Irving anchors Tampa's backfield but the committee caps the ceiling","players":"Bucky Irving; Tampa Bay; Buccaneers; Kenneth Gainwell; Sean Tucker","view":"Price-sensitive / near fair value","core":"The Buccaneers kept a three-man committee by signing Kenneth Gainwell and bringing back Sean Tucker alongside Irving. Irving remains the clear anchor and the only Tampa back worth real money, but the depth behind him caps his touch ceiling.","body":"Tampa Bay revealed the shape of this backfield by signing Kenneth Gainwell and bringing back Sean Tucker: three backs, one anchor. Irving is the only one worth real money, and anchor status still delivers a stable weekly floor, since he gets the trust downs, the best game scripts, and first call near the goal line. What he doesn't get is the overflow.\n\nWhen a team deliberately maintains two backups, the bell-cow ceiling that separates league-winners from solid starters is structurally unavailable, because the extra touches that create spike seasons are already assigned elsewhere. So pay for what exists, dependable RB2 volume, and refuse any bid that prices in a monopoly. The projected range straddles fair value, which is why discipline matters more than conviction here.\n\nMedium confidence; bigger leagues make his floor slightly more valuable, but the ceiling logic holds everywhere.","effect":"-2% to +3% versus an RB2 price","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"Pay for his volume as a solid RB2 and stop short of a true bell-cow bid.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"Pay for his volume as a solid RB2 and stop short of a true bell-cow bid.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"Pay for his volume as a solid RB2 and stop short of a true bell-cow bid.","auctionTailoring":"League size and auction budget."},{"code":"R78","section":"RB","title":"Rachaad White's Washington role is a scoring-format call","players":"Rachaad White; Washington; Commanders; Jayden Daniels; Jacory Croskey-Merritt","view":"Underpriced","core":"White signed a one-year, two million dollar deal with the Commanders and reunites with Jayden Daniels, his college teammate at Arizona State. Washington rebuilt its backfield with Jacory Croskey-Merritt positioned for early-down work, leaving White the receiving role, and familiarity with a young quarterback tends to mean check-down volume.","body":"Familiarity is a real signal at quarterback-adjacent positions, and White brings the rare kind: he and Jayden Daniels were college teammates at Arizona State, and young quarterbacks under pressure throw to the back they trust. Washington's rebuilt backfield tells you the split, with Jacory Croskey-Merritt positioned for early downs and White left the receiving role, while a one-year, two-million-dollar deal says the team priced him as a specialist rather than a starter.\n\nFantasy markets consistently underpay specialists whose entire value is receptions, which is exactly the profile that outperforms in full PPR. The projected four-to-eight-percent edge lives almost entirely in that format; standard scoring guts the case, and half PPR sits in between. Medium confidence, because check-down volume depends on game script. He's a cheap floor piece whose value scales directly with how your league scores catches.","effect":"+4% to +8% versus price in full PPR","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Pay a few PPR dollars for the receptions; do not bid him up as a weekly starter.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Pay a few PPR dollars for the receptions; do not bid him up as a weekly starter.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Pay a few PPR dollars for the receptions; do not bid him up as a weekly starter.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R79","section":"RB","title":"Bhayshul Tuten leads Jacksonville, but respect the rotation","players":"Bhayshul Tuten; Jacksonville; Jaguars; Liam Coen; Chris Rodriguez Jr.","view":"Price-sensitive / near fair value","core":"Travis Etienne's exit lifted second-year back Tuten to the top of the depth chart, but head coach Liam Coen favors a rotation and Chris Rodriguez Jr. is expected to take touches.","body":"Depth charts and workloads are different things, and Tuten's situation is the textbook case. Travis Etienne's exit made the second-year back the nominal starter in Jacksonville, but Liam Coen's preference for a rotation, with Chris Rodriguez Jr. expected to take touches, means the title comes without a monopoly.\n\nLead-rotation backs are tricky assets: the talent case supports genuine upside, yet every Rodriguez carry subtracts straight from Tuten's weekly ceiling, and committees suppress touchdown equity most of all. That's why the projected effect brackets zero; this bet resolves on the split, not the depth chart. The right posture is wanting him at his market slot while refusing to pay as if the rotation talk is coach-speak.\n\nMedium confidence cuts both ways here. Larger leagues make the floor more useful, and smaller ones make the ambiguity easier to skip entirely.","effect":"-3% to +4% versus price depending on the split","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"Target Tuten for his upside but do not pay a clear bell-cow price.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"Target Tuten for his upside but do not pay a clear bell-cow price.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"Target Tuten for his upside but do not pay a clear bell-cow price.","auctionTailoring":"League size and auction budget."},{"code":"R80","section":"RB","title":"Chase Brown is a pay-up lead back in Cincinnati","players":"Chase Brown; Cincinnati; Bengals; Samaje Perine; Joe Burrow","view":"Underpriced","core":"Brown enters his third season as Cincinnati's clear lead back, with Samaje Perine settling in as the backup. He finished as the RB7 in points per game from Week 7 on once Joe Burrow returned, and he is going near an RB2 price with RB1 upside.","body":"Once Joe Burrow returned, Brown played like a top-tier fantasy back, finishing RB7 in points per game from Week 7 on, and nothing about Cincinnati's offseason disturbed that setup. Samaje Perine settling in as the backup is a complement, not a threat, which leaves Brown a genuine lead back in an offense that scores enough to make his volume valuable.\n\nThe market is still charging an RB2 price for that profile, and paying RB2 cost for demonstrated RB1 production with the same quarterback and the same role is the cleanest kind of edge: you're buying continuity, not projecting a change. The five-to-nine-percent gap won't survive many more draft rooms once consensus rankings catch up. Confidence is high because role and evidence already align.\n\nThe main tailoring is budget; in auctions, decide beforehand how far past sheet value you'll go.","effect":"+5% to +9% versus current price","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Pay up for the volume.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Pay up for the volume.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Pay up for the volume.","auctionTailoring":"League size and auction budget."},{"code":"R81","section":"RB","title":"Travis Etienne should not command workhorse money in New Orleans","players":"Travis Etienne; New Orleans; Saints; Alvin Kamara; Kellen Moore","view":"Overpriced or discount required","core":"New Orleans handed Etienne a lucrative four-year deal in free agency, and drafters are paying a top-15 running back price. But Alvin Kamara remains on the roster, and head coach Kellen Moore says he can envision ways to use both backs.","body":"New Orleans paid Etienne like a workhorse; the roster says otherwise. Drafters have followed the lucrative four-year contract to a top-15 running back price, but Alvin Kamara is still in the building, and Kellen Moore has said openly that he can envision ways to use both backs.\n\nWhen a head coach volunteers a two-back vision in the offseason, believe him, because passing-down and red-zone touches are exactly what an established veteran like Kamara siphons first, and those are the touches that justify top-15 costs. Etienne's floor as the better-paid, presumptive lead option is solid; the bell-cow scenario the market is charging for requires Kamara to fade, which is a projection rather than a fact.\n\nThe five-to-nine-percent discount is worth insisting on. Medium confidence here, and the case for patience tightens in smaller leagues where a strong RB2 is replaceable.","effect":"-5% to -9% versus a bell-cow price","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Bid Etienne as a strong RB2 and let someone else pay the full three-down price.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Bid Etienne as a strong RB2 and let someone else pay the full three-down price.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Bid Etienne as a strong RB2 and let someone else pay the full three-down price.","auctionTailoring":"League size and auction budget."},{"code":"R82","section":"RB","title":"Omarion Hampton is the Chargers' clear lead back","players":"Omarion Hampton; Los Angeles; Chargers; Mike McDaniel; Kimani Vidal","view":"Underpriced","core":"Los Angeles did not draft a running back and brought in Mike McDaniel as offensive coordinator, leaving Hampton the clear lead back entering his second season. Behind an improved offensive line and a healthier body he has obvious RB1 upside, though committee snaps for Kimani Vidal can cap the weekly ceiling on lighter game scripts.","body":"Everything Los Angeles didn't do this offseason is the argument. The Chargers passed on drafting a running back, installed Mike McDaniel as offensive coordinator, and handed Hampton the job for his second season, a quiet vote of confidence that markets underweight because it produces no headline.\n\nBehind an improved offensive line and a healthier body, the ingredients for an RB1 leap are all present: secure role, scheme investment, better blocking, a normal development curve. The honest caveat is Kimani Vidal, whose committee snaps can trim the weekly ceiling when game scripts go light, which is why the projection is a solid four-to-eight-percent edge rather than a screaming one.\n\nIn practice that means taking Hampton confidently at today's cost instead of waiting for a discount that likely never comes. Medium confidence; deeper leagues should be the most willing to lean in.","effect":"+4% to +8% versus current price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Buy him at his cost.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Buy him at his cost.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Buy him at his cost.","auctionTailoring":"League size and auction budget."},{"code":"R83","section":"RB","title":"Alvin Kamara is a wait-and-take discount, not an early bid","players":"Alvin Kamara; New Orleans; Saints; Travis Etienne","view":"Underpriced","core":"New Orleans is still working out how Kamara fits alongside Travis Etienne, and his ADP has kept dipping as the uncertainty drags on. The endgame value case remains, especially with a defined receiving role.","body":"Uncertainty is doing your negotiating for you. Every week New Orleans goes without defining how Kamara fits alongside Travis Etienne, his ADP drifts lower, and drafters' aversion to murky backfields compounds the slide past what the underlying case justifies. That case is simple: a veteran with a defined receiving role produces steady, repeatable catch-driven points regardless of who wins the early downs, and endgame prices don't require him to win anything.\n\nThe five-to-ten-percent edge only materializes if you exploit the drift rather than fight it; bid early and you're paying the uncertainty tax yourself, while waiting turns the discount into the asset. Medium confidence, since the Saints could still define the split against him. Full-PPR leagues should be the most patient and the most interested, standard formats can pass entirely, and league size sets how late is late enough.","effect":"+5% to +10% versus price when taken late","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Let the room forget about him, then take him at a clear discount as a late PPR piece.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Let the room forget about him, then take him at a clear discount as a late PPR piece.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Let the room forget about him, then take him at a clear discount as a late PPR piece.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W66","section":"WR","title":"Tank Dell is a spike-week flier, not a starter bid","players":"Tank Dell; Houston; Texans","view":"Format-dependent / monitor price","core":"Dell says he is ready for Texans training camp after the 2024 knee dislocation and multi-ligament reconstruction that cost him all of 2025. Houston is deliberately not rushing him, and he was limited during spring work; the talent is worth a flier, but the workload is unproven.","body":"Multi-ligament knee reconstructions are the injuries that end route-runners, which is why Dell's own optimism about being ready for Texans camp needs the context Houston keeps supplying: the team is deliberately not rushing him, and he was limited through spring work. When a player says ready and the organization behaves cautiously, trust the organization, because managed snap counts and route participation produce inconsistent fantasy weeks even from talented players.\n\nThat's the profile of a pure volatility asset. The 2024 dislocation cost him all of 2025, the talent predates the injury, and the price has fallen far enough that the downside is a wasted end-of-bench pick while the upside is a startable receiver. Low-to-medium confidence is the honest label. Best ball, which harvests spike weeks automatically, is where the flier fits best; elsewhere, deep rosters make holding him painless.","effect":"High variance around a minimal price","conf":"Low to Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"Treat Dell as a final-dollar upside stash at the end of your draft, not a starter bid.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"Treat Dell as a final-dollar upside stash at the end of your draft, not a starter bid.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"Treat Dell as a final-dollar upside stash at the end of your draft, not a starter bid.","auctionTailoring":"League size and auction budget; Best ball roster size."},{"code":"W67","section":"WR","title":"A healthy Garrett Wilson still carries last year's injury discount","players":"Garrett Wilson; New York Jets","view":"Underpriced","core":"Wilson has been a full participant in the Jets' offseason program after the knee injuries that disrupted his 2025 season, and he is on track for Week 1. Target share has never been his problem; availability was.","body":"Markets are slow to forgive injuries, and that lag is the opportunity. Wilson has been a full participant in the Jets' offseason program after the knee problems that wrecked his 2025, he's tracking toward Week 1, and yet his price still carries last season's discount. The distinction that matters: 2025 was an availability failure, not a role failure.\n\nTarget share was never his question, and target share is the most stable, most predictive input in receiver scoring, so a healthy Wilson simply resumes being the player his pre-injury cost reflected. That's why the five-to-nine-percent edge earns high confidence; you're betting on health reports already in hand, not on a breakout. The window is short, though, because one clean week of camp coverage erases the markdown.\n\nLeague size barely changes the call. He's a buy anywhere the price hasn't corrected yet.","effect":"+5% to +9% versus his discounted price","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Pay up now, because camp reports of a healthy Wilson will erase the discount fast.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Pay up now, because camp reports of a healthy Wilson will erase the discount fast.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Pay up now, because camp reports of a healthy Wilson will erase the discount fast.","auctionTailoring":"League size and auction budget."},{"code":"W68","section":"WR","title":"Luther Burden is the most logical heir to Chicago's vacated targets","players":"Luther Burden III; Chicago; Bears; DJ Moore; Olamide Zaccheaus; Ben Johnson","view":"Underpriced","core":"DJ Moore and Olamide Zaccheaus are both gone from Chicago, and the pair combined for 166 targets while playing ahead of Burden for most of 2025. Burden posted elite rookie efficiency, ranking top five among wide receivers in catch rate (77 percent), yards per target (10.8), and yards per route run (2.9), making him the most logical player to absorb the vacated work in Ben Johnson's offense.","body":"Chicago just watched 166 targets walk out the door with DJ Moore and Olamide Zaccheaus, and the rookie who spent most of 2025 buried behind them quietly posted top-five marks among wide receivers in catch rate (77 percent), yards per target (10.8), and yards per route run (2.9).\n\nThat combination \u2014 elite per-route production with the depth chart suddenly cleared \u2014 is how second-year target spikes actually happen, because coaches funnel volume toward whoever converts it, and Ben Johnson has no incumbent left to protect. A six-to-twelve percent bump over a mid-tier WR price says the market is treating him like a lottery ticket when the role math looks closer to inheritance.\n\nConfidence sits at medium for a reason: a run-first attack invites boom-bust weeks, and in smaller leagues steadier mid-tier options abound, so the case strengthens as league size grows.","effect":"+6% to +12% versus a mid-tier WR price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Buy at a mid-tier WR price, but budget for boom-bust weeks in a run-first attack.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Buy at a mid-tier WR price, but budget for boom-bust weeks in a run-first attack.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Buy at a mid-tier WR price, but budget for boom-bust weeks in a run-first attack.","auctionTailoring":"League size and auction budget."},{"code":"W69","section":"WR","title":"Emeka Egbuka steps into the Tampa Bay WR1 role","players":"Emeka Egbuka; Tampa Bay; Buccaneers; Mike Evans; Baker Mayfield; Chris Godwin","view":"Underpriced","core":"Mike Evans left Tampa Bay for the 49ers on a three-year deal, and Egbuka steps into the top spot in the passing game. He caught 63 passes for 938 yards as a rookie and is now Baker Mayfield's clear first read, with Chris Godwin carrying age and injury questions behind him.","body":"Mike Evans signing a three-year deal with the 49ers ends an era in Tampa Bay and leaves Baker Mayfield needing a first read. Egbuka already showed he can handle real work, catching 63 passes for 938 yards as a rookie while Evans was still commanding coverage, and the only other credible claimant to the top job is Chris Godwin, who carries both age and injury questions.\n\nWhen a functioning passing game loses its lead option, the targets don't evaporate \u2014 they consolidate, and they consolidate toward the most trusted remaining receiver. A six-to-ten percent edge over current cost means you're buying a likely target leader at a price that still reflects last year's pecking order. High confidence is earned here: the vacancy is unambiguous and the succession is clean, though a Godwin renaissance would trim the ceiling somewhat.","effect":"+6% to +10% versus current price","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Bid Egbuka up to a solid WR2 price with room for more.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Bid Egbuka up to a solid WR2 price with room for more.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Bid Egbuka up to a solid WR2 price with room for more.","auctionTailoring":"League size and auction budget."},{"code":"W70","section":"WR","title":"Josh Downs is a cheap volume rebound in Indianapolis","players":"Josh Downs; Indianapolis; Colts; Michael Pittman Jr.","view":"Underpriced","core":"The Colts traded Michael Pittman Jr. to the Steelers in March, finally moving Downs up the depth chart. He hit career lows in 2025 with 88 targets, 58 catches, and 566 yards, but he averaged 70 catches and 787 yards across his first two seasons, and Indianapolis has said his role will grow.","body":"Everything that dragged Josh Downs to career lows in 2025 \u2014 88 targets, 58 catches, 566 yards \u2014 traced back to a crowded pecking order, and the Colts removed the biggest obstacle by trading Michael Pittman Jr. to the Steelers in March.\n\nBefore the squeeze, Downs averaged 70 catches and 787 yards across his first two seasons, so you're not projecting a leap, just a return to an established baseline plus whatever Indianapolis means when it says his role will grow. Reception volume is the cheapest, most repeatable currency in fantasy scoring, and it's exactly what a WR4 price fails to account for here, which makes the seven-to-twelve percent edge plausible without heroic assumptions.\n\nThe case is strongest in full PPR, where catch totals do the heavy lifting, and fades toward standard scoring; medium confidence reflects that the promised usage still has to show up on Sundays.","effect":"+7% to +12% versus a WR4 price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Target him late as a cheap volume rebound with WR2 upside.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Target him late as a cheap volume rebound with WR2 upside.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Target him late as a cheap volume rebound with WR2 upside.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W71","section":"WR","title":"DeVonta Smith finally gets the Philadelphia alpha role","players":"DeVonta Smith; Philadelphia; Eagles; Jalen Hurts; A.J. Brown","view":"Underpriced","core":"With A.J. Brown gone, Smith is the clear top target for Jalen Hurts for the first time since his rookie season, and his ADP has settled around WR14 in the third round. That vacated volume lands on a receiver who has already produced as a secondary option.","body":"For the first time since his rookie season, there's no A.J. Brown standing between DeVonta Smith and the top of Jalen Hurts' progression, yet his ADP has settled around WR14 in the third round \u2014 a price that still treats him like a co-star.\n\nTarget vacancies of this size don't get split evenly; they flow to the receiver the quarterback already trusts, and Smith has spent years producing as a secondary option, which is the harder version of the job. The five-to-nine percent edge won't win your league by itself, but it does mean the front of his tier is the right place to take him rather than hoping he slides.\n\nHigh confidence fits a situation this clean; the main thing that would soften the call is Philadelphia spreading the vacated work across the rest of the depth chart instead.","effect":"+5% to +9% versus current cost","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Pay up a tier; the role points to fringe WR1 output and his cost still lags the projection.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Pay up a tier; the role points to fringe WR1 output and his cost still lags the projection.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Pay up a tier; the role points to fringe WR1 output and his cost still lags the projection.","auctionTailoring":"League size and auction budget."},{"code":"W72","section":"WR","title":"Rashee Rice's six-game suspension is real lost volume","players":"Rashee Rice; Kansas City; Chiefs","view":"Overpriced or discount required","core":"Rice will miss the first six games under an NFL suspension and is in line to return in Week 7. That is a meaningful share of the fantasy season gone before he takes a snap.","body":"Week 7 feels a long way off when a roster spot is producing zeros until then, and that's exactly what buying Rice at full freight signs you up for. The NFL has taken the first six games off his ledger \u2014 a meaningful share of the fantasy season gone before he plays a snap \u2014 and no amount of return-date optimism refunds those weeks.\n\nEvery game a lineup slot contributes nothing, you're effectively playing shorthanded against opponents fielding full rosters, and the early weeks shape playoff races as much as the late ones do. So the eight-to-twelve percent trim from a full-price WR2 isn't pessimism about the talent; it's arithmetic. High confidence follows from the fixed length of the ban.\n\nWhether the stash works comes down to structure: deep benches absorb a dead spot comfortably, while shallow rosters pay a real cost to carry him.","effect":"-8% to -12% versus a full-price WR2","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Discount him to a boom-or-bust stash and pair him with a steadier starter.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Discount him to a boom-or-bust stash and pair him with a steadier starter.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Discount him to a boom-or-bust stash and pair him with a steadier starter.","auctionTailoring":"League size and auction budget; Roster and bench size."},{"code":"W73","section":"WR","title":"Alec Pierce carries injury and target-competition risk","players":"Alec Pierce; Indianapolis; Colts; Tyler Warren; Josh Downs","view":"Overpriced or discount required","core":"Pierce had ankle surgery in March and could be held out into the preseason, sliding his ADP. Even as the Colts' top wideout after the Michael Pittman Jr. trade, he faces target competition from Tyler Warren and Josh Downs.","body":"March ankle surgery that could stretch into the preseason is already dragging Pierce's ADP downward, and the market is right to be nervous. Even in the best case \u2014 healthy, installed as the Colts' top wideout after the Michael Pittman Jr. trade \u2014 he isn't inheriting a monopoly, because Tyler Warren and Josh Downs are both positioned to claim meaningful target share.\n\nInjury risk stacked on target competition is a multiplicative problem: each one alone trims a projection, but together they push the range of outcomes toward the ugly end. A four-to-eight percent markdown from a top-wideout price tells you to let someone else pay for the depth-chart title.\n\nMedium confidence leaves room for the sunny version, where he's full-go by opening day and the target tree tilts his way, but don't pay for that scenario in advance \u2014 especially in shallower leagues where replacements are everywhere.","effect":"-4% to -8% versus a top-wideout price","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Discount him and do not pay up.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Discount him and do not pay up.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Discount him and do not pay up.","auctionTailoring":"League size and auction budget."},{"code":"W74","section":"WR","title":"DK Metcalf's ceiling is capped in a crowded Pittsburgh offense","players":"DK Metcalf; Pittsburgh; Steelers; Michael Pittman Jr.; Aaron Rodgers","view":"Overpriced or discount required","core":"Pittsburgh traded for Michael Pittman Jr. and added Aaron Rodgers at quarterback, while Metcalf was only the WR26 in PPR points per game last year. With more mouths to feed, the path back to his name-brand price is hard to see.","body":"Pittsburgh spent the offseason adding mouths, not clearing them: Michael Pittman Jr. arrived in a trade and Aaron Rodgers took over at quarterback, and that reshuffling lands on a receiver who finished just WR26 in PPR points per game a year ago.\n\nWhen recent production already trails reputation, adding a legitimate target competitor rarely fixes anything \u2014 it usually formalizes the decline, because the offense no longer needs to force-feed one receiver to function. The five-to-nine percent markdown from his name-brand price is a warning about paying for the memory of a player rather than the current version.\n\nHigh confidence follows because both the depressed baseline and the new competition are already facts on the ground. Your scoring format sets the exact size of the fade, and only a genuine discount from the room makes him interesting again.","effect":"-5% to -9% versus his name-brand price","conf":"High","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Fade at full price as he trends toward WR3 territory.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Fade at full price as he trends toward WR3 territory.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Fade at full price as he trends toward WR3 territory.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W75","section":"WR","title":"George Pickens is off holdout watch and back to a clean projection","players":"George Pickens; Dallas; Cowboys","view":"Underpriced","core":"Dallas placed the franchise tag on Pickens, and he confirmed he will not hold out, reporting to the team facility and minicamp. The availability cloud that scared off some managers is gone.","body":"The franchise tag could have turned into a standoff, but Pickens confirmed he won't hold out, showed up at the team facility, and attended minicamp \u2014 which removes the one variable that was suppressing his price.\n\nAvailability risk is a silent tax on draft cost: when managers can't be sure a player will be in uniform, they shave value off him almost reflexively, and that discount lingers even after the underlying concern dies. That's the whole trade here. The four-to-seven percent edge over his clouded price isn't a bet on a new role or a scheme change; it's simply buying back value the market hasn't finished restoring.\n\nMedium confidence is fair because tag situations can stay tense in quieter ways, and camp is long. In deeper leagues, where reliable starters get scarce quickly, move faster \u2014 the correction won't wait for your draft date.","effect":"+4% to +7% versus his clouded price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Bid with confidence as a WR2 with WR1 upside in a pass-heavy Cowboys attack.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Bid with confidence as a WR2 with WR1 upside in a pass-heavy Cowboys attack.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Bid with confidence as a WR2 with WR1 upside in a pass-heavy Cowboys attack.","auctionTailoring":"League size and auction budget."},{"code":"W76","section":"WR","title":"Matthew Golden is the textbook year-two breakout in Green Bay","players":"Matthew Golden; Green Bay; Packers; Romeo Doubs","view":"Underpriced","core":"Romeo Doubs left Green Bay for New England, and the Packers expect second-year wideout Golden to absorb that vacated volume; Doubs led the team in targets last season.","body":"Green Bay's leading target earner from last season, Romeo Doubs, is now in New England, and the Packers have made it plain they expect Golden to absorb that work in year two.\n\nVacated team-leading target share landing on an ascending sophomore is the classic breakout recipe, because young receivers rarely stall for lack of talent \u2014 they stall for lack of opportunity, and this opportunity materialized without Golden having to beat anyone out.\n\nThe six-to-eleven percent gap between his price and projected value exists because ADP moves slower than depth charts; the market prices what a player did, not what he's about to be handed. Medium confidence is fair, though, since offseason intentions don't guarantee in-season usage and other Packers will claim their share of the vacated looks. Deeper leagues should move earliest \u2014 comparable upside disappears fast once the obvious names are gone.","effect":"+6% to +11% versus current price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Buy the ascending receiver before his price catches up to the opportunity.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Buy the ascending receiver before his price catches up to the opportunity.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Buy the ascending receiver before his price catches up to the opportunity.","auctionTailoring":"League size and auction budget."},{"code":"W77","section":"WR","title":"Malik Nabers cannot be paid full price until the knee news clears","players":"Malik Nabers; New York Giants","view":"Overpriced or discount required","core":"Nabers underwent a second procedure on his surgically repaired right knee to remove scar tissue, and league reporting puts his Week 1 availability in real doubt even as Giants management stays publicly optimistic. The talent is not the question; the timeline is.","body":"A second procedure on a surgically repaired knee \u2014 this time to clear out scar tissue \u2014 is the kind of detail that should override front-office optimism, and league reporting already puts Nabers' Week 1 availability in genuine doubt.\n\nElite talent doesn't lower the risk; it raises the stakes, because you'd be paying a top-shelf price for a player whose season might start late and whose early explosiveness is an open question after repeat work on the same joint. The six-to-twelve percent haircut from a healthy WR1 price is really a bidding boundary: below it he's a calculated gamble, at full price he's pure hope.\n\nMedium confidence reflects how fluid injury timelines are in both directions \u2014 a clean camp would erase most of this. Roster construction matters too: an IR slot or a deep bench makes the gamble far more survivable than a tight roster does.","effect":"-6% to -12% versus a healthy WR1 price","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Bid only if the room lets him fall a full tier below his usual cost.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Bid only if the room lets him fall a full tier below his usual cost.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Bid only if the room lets him fall a full tier below his usual cost.","auctionTailoring":"League size and auction budget; Roster and IR spots."},{"code":"W78","section":"WR","title":"A.J. Brown's team change is priced too pessimistically","players":"A.J. Brown; New England; Patriots; Drake Maye","view":"Price-sensitive / near fair value","core":"The Patriots traded for Brown, pairing him with Drake Maye, who led the NFL in completion rate and yards per attempt last season. The team change has spooked some drafters, but the quarterback upgrade and a clear alpha role keep Brown in the low-end WR1 mix at 29.","body":"Drake Maye led the NFL in completion rate and yards per attempt last season, which makes the hand-wringing over Brown's trade to New England look backwards \u2014 receivers usually get hurt by team changes when the quarterback situation degrades, and this one arguably improved. Add a clear alpha role waiting for him, and the ingredients that made Brown a low-end WR1 travel with him at 29.\n\nHe's not a growth stock anymore, but the flat-to-plus-five percent projection against a dipping price describes a specific opportunity: you don't need to reach, you just need to refuse to join the fade. If spooked drafters keep sliding him, he crosses from fairly priced into genuine value, and that's the moment to strike.\n\nMedium confidence covers the honest unknowns of a new offense \u2014 chemistry takes reps \u2014 and bigger leagues, where proven alpha receivers thin out fast, reward holding firm.","effect":"0% to +5% versus a dipping price","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"Do not fade him on the move; his price may dip enough to make him a value.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"Do not fade him on the move; his price may dip enough to make him a value.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"Do not fade him on the move; his price may dip enough to make him a value.","auctionTailoring":"League size and auction budget."},{"code":"Q36","section":"QB","title":"Aaron Rodgers' return carries a hype tax in single-QB leagues","players":"Aaron Rodgers; Pittsburgh; Steelers","view":"Overpriced or discount required","core":"Rodgers returned to the Steelers and his ADP has jumped roughly 2.5 rounds on the news. At his age the ceiling is capped, and single-quarterback formats leave plenty of comparable production on the board later.","body":"Roughly two and a half rounds of ADP inflation on a return announcement is the market paying for a story, not a projection. Nothing about Rodgers' age-related ceiling changed with the news \u2014 what changed is recency and headline volume, and those are exactly the forces that create hype taxes at quarterback, where single-QB formats already leave comparable production sitting on the board later.\n\nPaying the post-news price means surrendering the position's structural advantage, which is replaceability. The four-to-eight percent markdown you should demand is really just the pre-news price wearing a different label. Medium confidence acknowledges that veteran quarterbacks in stable situations can outrun their age curve for a season, but the bet is asymmetric against you at this cost.\n\nEverything shifts in superflex, where scarcity changes the calculus; in standard 1-QB leagues, patience at the position remains the percentage play.","effect":"-4% to -8% versus his post-news price","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Let someone else pay the hype tax and wait on the position in 1-QB formats.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Let someone else pay the hype tax and wait on the position in 1-QB formats.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Let someone else pay the hype tax and wait on the position in 1-QB formats.","auctionTailoring":"1-QB versus superflex; League size and auction budget."},{"code":"T31","section":"TE","title":"Oronde Gadsden's breakout price ignores the Njoku signing","players":"Oronde Gadsden; Los Angeles; Chargers; David Njoku","view":"Overpriced or discount required","core":"Gadsden broke out as a top-20 tight end last season, but the Chargers signed David Njoku in May and Gadsden's ADP has slid about two rounds. The target split is real.","body":"Los Angeles adding David Njoku in May changed the arithmetic on Gadsden, and his ADP has already slid about two rounds in response \u2014 the question is whether the slide has gone far enough.\n\nA top-20 tight end season is a real accomplishment, but tight end production is unusually sensitive to target share, and splitting routes and red-zone looks with a veteran of Njoku's standing turns a breakout trajectory into a timeshare projection. That's the mechanism behind the five-to-nine percent markdown from last year's breakout price: the same player, minus a meaningful slice of opportunity, is simply worth less.\n\nMedium confidence leaves open the possibility that the Chargers feed both heavily or that Gadsden outplays the split outright. The fade sharpens in TE-premium leagues, where every lost catch costs more, so demand a deeper discount there before buying in.","effect":"-5% to -9% versus last year's breakout price","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"Discount him and do not pay the breakout price.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"Discount him and do not pay the breakout price.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"Discount him and do not pay the breakout price.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T32","section":"TE","title":"Greg Dulcich is the cheap tight end swing in Miami","players":"Greg Dulcich; Miami; Dolphins; Darren Waller","view":"Underpriced","core":"With Darren Waller no longer in the Miami mix, Dulcich has a path to real volume after posting elite efficiency metrics in limited 2025 action. Health is the whole question.","body":"Darren Waller's exit from the Miami mix opens a lane that Dulcich's limited 2025 tape suggests he can fill \u2014 his efficiency metrics in that small sample were elite, and vacated tight end work has to land somewhere. The bet is pure asymmetry: at a late-round price you're risking almost nothing for a shot at eight to fifteen percent above cost if the body cooperates, and health is, frankly, the whole question.\n\nCheap swings like this win drafts not because they usually hit but because they cost nothing when they miss \u2014 the roster spot is the only stake. Low-to-medium confidence is honest labeling for a small-sample efficiency case, so size the bet accordingly rather than talking yourself into certainty. TE-premium scoring fattens the payout meaningfully, and deeper leagues, where streaming replacements get scarce, make the lottery ticket worth more.","effect":"+8% to +15% versus a late-round price if healthy","conf":"Low to Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Add him as a cheap upside swing at the position.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Add him as a cheap upside swing at the position.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Add him as a cheap upside swing at the position.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T33","section":"TE","title":"Tucker Kraft is a breakout at a slight discount, with a catch","players":"Tucker Kraft; Green Bay; Packers","view":"Underpriced","core":"Kraft expects to open training camp on the PUP list but says he should be ready for Week 1 with no restrictions. He was the TE4 before his injury, and the PUP tag is holding a small discount on a proven breakout.","body":"A PUP designation to open camp sounds scarier than what Kraft is actually saying, which is that he expects to be ready for Week 1 with no restrictions. Before the injury he was producing as the TE4, so this isn't a projection bet \u2014 the breakout already happened, and the designation is quietly holding a small discount on proven positional scoring.\n\nTight end is where established weekly producers are scarcest, which is why even a four-to-eight percent edge is worth chasing; you're buying certainty of role at a slight markdown. Medium confidence exists because recovery timelines are self-reported until they aren't, and a setback in camp would flip this call quickly.\n\nProtect yourself structurally: a cheap second tight end covers the downside, TE-premium formats amplify the reward, and thin benches should weigh that insurance cost before committing.","effect":"+4% to +8% versus his discounted price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"Take the discount but budget a cheap backup TE in case the timeline slips.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Take the discount but budget a cheap backup TE in case the timeline slips.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"Take the discount but budget a cheap backup TE in case the timeline slips.","auctionTailoring":"TE-premium scoring; Roster and bench size."}];
const INSIGHTS_VAULT = [{"code":"Q3","section":"QB","title":"DJ Moore’s arrival materially improves Allen’s receiver room","players":"DJ Moore; Allen; Buffalo; Moore","view":"Underpriced","core":"Buffalo traded for Moore and still projects with a top-tier line.","body":"Buffalo went out and traded for DJ Moore, and the market hasn't fully caught up. Pairing a proven separator with a line that still projects top-tier changes the texture of Allen's passing game: quicker wins off the snap create cleaner throw windows, and better YAC talent converts the same completions into longer gains without asking Allen to do more.\n\nThat's how a quarterback adds points without adding attempts, and the projected bump of half a point to eight-tenths per game is enough to move him within a tightly bunched elite tier. In practice, that's a tiebreaker: when Allen's price sits flat against his peers, he's the pick. Medium confidence keeps this from being a pound-the-table call.\n\nThe case strengthens in superflex and 2QB formats, where quarterback scarcity magnifies small edges, and weakens if Moore's camp usage looks peripheral.","effect":"+0.5 to +0.8 FPPG for Allen from improved YAC and separator talent","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"pay $2-3 over sheet to break the tie with the other bunched elite QBs; the Moore trade is the tiebreaker the room is not pricing.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"when the elite QBs sit in one tier at your pick, take Allen first; the receiver upgrade is the free half-point that settles it.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"lean Allen in QB-anchored builds and pair him with Moore; the same catalyst powers both halves of the stack.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q9","section":"QB","title":"Jayden Daniels is the most difficult elite-QB valuation because the 2025 sample is broken by injury","players":"Jayden Daniels","view":"Format-dependent / monitor price","core":"He logged only seven games and 16.7 FPPG, but still projects near the top thanks to 685.9 rushing yards.","body":"Seven games is a brutal sample to price an elite quarterback on. Daniels averaged 16.7 FPPG in that broken 2025 season, which reads as ordinary, yet 685.9 rushing yards in limited action is why models still park him near the top of the position.\n\nRushing production is the most stable path to a fantasy ceiling, since those yards score whether the passing game clicks or not, but an injury-shortened year leaves you guessing about durability and where his passing efficiency truly sits. That's how you get a legitimate range from QB2 to QB9: the same profile supports both outcomes.\n\nPaying for the median is uncomfortable; paying for the upside is fine in formats that harvest spike weeks. Medium confidence here is really a statement about variance. A clean camp and superflex scarcity strengthen the buy, while a rising price in managed leagues erodes it.","effect":"true outcome range is wide, from QB2 to QB9","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"hold sheet value in managed leagues; in superflex a dollar or two of ceiling premium is defensible.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"in managed one-QB leagues let him come to you; never burn an early pick pricing a seven-game sample as a full season.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"his best format by far; 685 rushing yards of spike-week equity gets harvested automatically, so drafting him a round early is fine here.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q18","section":"QB","title":"Dak Prescott is a good but not great value because his ecosystem is already fully priced in","players":"Dak Prescott; CeeDee Lamb; George Pickens","view":"Underpriced","core":"He finished QB6 in 2025 at 19.0 FPPG and still plays with CeeDee Lamb and George Pickens.","body":"There's nothing hidden here, and that's the point. Prescott just finished QB6 at 19.0 FPPG, he keeps CeeDee Lamb and George Pickens, and the drafting public knows all of it. When an ecosystem is this visible, the good news gets priced in, which compresses the profit margin: the projection says somewhere between nothing and five percent above cost, real but thin. Edges that thin aren't worth chasing; they're worth accepting.\n\nThe mechanism is stability rather than growth, because two quality separators keep his target quality high, so the floor holds even if nothing improves. In draft terms, that makes Prescott the guy you're happy to catch on a slide rather than a name you circle.\n\nMedium confidence fits a profile with little unknown upside, and superflex formats, where steady QB1 production is scarcer, are where accepting the modest edge makes the most sense.","effect":"+0% to +5% versus price","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"a $1-2 bump only when QB bidding is soft; the profit is thin by design, so never chase.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"the ideal falls-to-you QB1; if he slides a round past ADP, take the free floor and move on.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"a stabilizer to pair with a volatile rushing QB, not a ceiling play; do not double up on low-variance passers.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q24","section":"QB","title":"Herbert’s 2025 rushing rebound matters more than people remember","players":"Herbert; Allen-level","view":"Format-dependent / monitor price","core":"He added 498 rushing yards, enough to keep elite-week outcomes available even without Allen-level rushing.","body":"Fantasy memories are short, and Herbert's ground game has already slipped out of the collective one. He put up 498 rushing yards in 2025, not Allen territory, but enough to change the math on his bad passing weeks, because rushing yardage arrives independent of protection, script, and drops. That's what a floor actually is: production that shows up when the primary plan doesn't.\n\nIt also keeps his elite-week outcomes live, since a rushing score stacked on a good passing day is how quarterbacks win you a week outright. The projected effect concentrates in four-point passing-TD leagues, where rushing production carries the most relative worth, so check your scoring settings before you move him.\n\nMedium confidence means treat this as a tier argument, not a reach mandate. If his legs stay involved in camp reports, the case firms up; if the rushing was a blip, it dissolves.","effect":"weekly floor rises materially in four-point passing-TD leagues","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"in 4-point passing-TD leagues add a couple dollars for the rushing floor; in 6-point leagues stay at sheet.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"move him to the front of his QB tier in 4-point passing-TD scoring; leave him in place in 6-point formats.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"rushing floor plus deep-ball spikes plays well; a slight reach is justified in 4-point passing-TD tournaments.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"Q30","section":"QB","title":"Bryce Young is more streamer than breakout","players":"Bryce Young; Carolina","view":"Overpriced or discount required","core":"He finished just QB19 in 2025 and Carolina did not make a dramatic offensive-spending leap.","body":"Skepticism is warranted when a breakout narrative outruns the evidence. Young finished QB19 in 2025, and Carolina didn't make the kind of dramatic offensive investment that usually precedes a leap. Quarterback breakouts almost always trace to something structural, like a new weapon, a rebuilt line, or a scheme change, and without one you're betting purely on internal development, the least reliable driver there is.\n\nThe projection lands him around QB18 to QB22, which is streamer territory: startable in good matchups, droppable otherwise. Practically, that means he should never be your plan at the position in one-QB leagues, and even as a backup he needs to come at a clear discount to the sticker.\n\nMedium confidence leaves room for surprise, since young quarterbacks sometimes jump without obvious help, but even in superflex, where every starter carries value, the price still has to fall to you.","effect":"roughly in line with QB18-Q22 outcomes","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"$1-2 as a backup at most; never roster him as your starter in one-QB leagues.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"let someone else draft the breakout narrative; he is a late-round backup only, and only if he slides.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"cheap QB3 completing a Carolina stack at a clear ADP discount, nothing more.","auctionTailoring":"Superflex/2QB league type; League size and auction budget."},{"code":"R2","section":"RB","title":"Gibbs’ receiving profile keeps him insulated from schedule swings","players":"Gibbs’","view":"Format-dependent / monitor price","core":"Current projections still give him about 71 catches and 580 receiving yards.","body":"Schedule-proof backs are rare, and the passing game is what makes them. Projections still credit Gibbs with about 71 catches and 580 receiving yards, and that kind of workload doesn't evaporate when the run blocking meets a stacked box or the team falls behind. Targets follow talent regardless of game script, which is why receiving backs hold their weekly output through stretches that crater pure runners.\n\nIn PPR the math is explicit: the insulation is worth roughly a full point per game of floor, which compounds across a season into a meaningful edge over volume-dependent peers at the same cost. For your draft, that's license to treat him as a foundation piece rather than a bet, and the high confidence reflects how sticky receiving roles tend to be year over year.\n\nThe call is strongest in full PPR and softens toward standard scoring, where catches carry less freight.","effect":"pass-game insulation adds roughly 1.0 FPPG floor in PPR formats","conf":"High","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"pay up in full PPR; the 71-catch floor justifies going a few dollars past sheet in reception-heavy scoring.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"a top-3 anchor in full PPR; the receiving workload makes him the safest early pick in his tier.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"an every-build anchor; catch-driven floor plus touchdown ceiling is exactly what tournament rosters are built on.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R8","section":"RB","title":"Taylor’s pass-game role caps his true PPR edge","players":"Taylor","view":"Overpriced or discount required","core":"He caught just 46 balls in 2025, and current projections still lag the receiving-heavy elite backs.","body":"Format matters more with Taylor than with almost any back at his price. He caught just 46 passes in 2025, and projections still slot him behind the receiving-heavy elites, which means part of his sticker price pays for reception volume he doesn't actually generate.\n\nCatches are the most reliable weekly scoring in PPR, arriving in blowouts, comebacks, and everything between, so a back who lives on carries needs efficiency and touchdowns to keep pace, and those are the noisiest stats in football. The projected drag is about three percent in full PPR against similarly priced dual-threat options: small enough that he's no fade, large enough to break ties against him.\n\nDraft him where the scoring flatters his profile, in half-PPR and standard, and demand a modest discount in full PPR. Medium confidence, because a genuine expansion of his passing-down role would erase this entirely.","effect":"-3% in full PPR versus similarly priced dual-threat backs","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"in full PPR demand roughly a $3 discount from sheet; in half-PPR and standard pay market freely.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"in full PPR let him fall to the back of his tier; in standard scoring take him at ADP with confidence.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"underweight in full-PPR tournaments; his quiet weeks are catchless, and best ball cannot hide them.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R15","section":"RB","title":"San Francisco’s upgraded receiver room cuts into target monopolization","players":"San Francisco; Mike Evans; Christian Kirk; McCaffrey","view":"Overpriced or discount required","core":"Mike Evans and Christian Kirk lower the chance McCaffrey repeats triple-digit catches.","body":"Adding Mike Evans and Christian Kirk makes San Francisco's offense better and McCaffrey's fantasy profile subtly worse, and both things can be true at once. Real receiving talent on the perimeter pulls targets that previously funneled to the backfield by default, which lowers the odds McCaffrey repeats a triple-digit catch season.\n\nThat reception volume is exactly what PPR scoring pays for, so the version of him you're buying leans harder on touchdowns, even as the same upgrades that cost him targets should improve red-zone efficiency and scoring chances. Trading steady catches for volatile scores is a worse deal in full PPR and closer to a wash where touchdown weight is heavy. He's still an elite pick; the argument is against paying peak-season price.\n\nMedium confidence, and camp target distribution is the tell. If the new receivers integrate slowly, the old workload could simply persist.","effect":"receiving share slight downgrade, red-zone efficiency slight upgrade","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"still elite, but bid to this year's case, not 2025's peak price; stop a few dollars short of his best-season cost.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"still a first-rounder; just take the reception-secure backs first when they sit at the same cost.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"his touchdown-driven spike weeks play up here; more tolerable at full price in best ball than in managed PPR.","auctionTailoring":"Scoring format (full/half/standard PPR); TD scoring weight; League size and auction budget."},{"code":"R22","section":"RB","title":"Buffalo’s line and DJ Moore trade help Cook’s box-light environment","players":"Buffalo; DJ Moore; Cook","view":"Underpriced","core":"Buffalo’s line and DJ Moore trade help Cook’s box-light environment.","body":"Running backs don't create their environments; they inherit them, and Cook just inherited a better one. Buffalo's line plus the trade for DJ Moore forces defenses to respect the pass, and defenses that respect the pass keep safeties deep and boxes light. Light boxes are the cheapest efficiency upgrade in football: the same runner, the same calls, and suddenly there's a gap where a defender used to be.\n\nThe projection puts it at two- to five-tenths of a yard per carry along with more red-zone trips, which is how an offense quietly manufactures extra touchdown chances without changing anyone's touch count. Same volume, better yield is the classic profile of a back who beats his draft cost without a headline.\n\nMedium confidence because the edge is environmental rather than role-based; a line injury or a quiet Moore debut would sand it down, but nothing here requires a leap of faith.","effect":"+0.2 to +0.5 YPC and more red-zone trips","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"the classic $2-over play; boring wins, so pay it before the room figures that out.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"bump him to the front of his RB tier; light boxes are a free half-yard per carry the ranking does not show.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"raise exposure; more red-zone trips means more spike weeks at a non-spike price.","auctionTailoring":"League size and auction budget."},{"code":"R30","section":"RB","title":"Jeremiyah Love is exciting, but the market may underrate Arizona’s offensive fragility","players":"Jeremiyah Love; Arizona; Kyler Murray; Jeanty","view":"Format-dependent / monitor price","core":"Arizona took him No. 3 overall, but the team released Kyler Murray and now plays the hardest schedule.","body":"Draft capital this rich usually settles the fantasy argument by itself, and that's exactly the trap. Arizona spent the third overall pick on Love, but the team also released Kyler Murray and now faces the hardest schedule, which means he walks into an unsettled quarterback situation and a weekly grind of tough opponents.\n\nTalent gives him roughly ten percent of intrinsic upside over the field, but environment converts talent into points: scoring chances, light boxes, and positive scripts all flow from offensive quality he can't control. The market tends to price the highlight reel and discount the context, so his cost may reflect the player more than the situation.\n\nTake him anyway, since rookie backs with this pedigree earn volume regardless, but at similar prices Jeanty's cleaner setup wins the tiebreak. Medium confidence, and any stabilizing move at quarterback would meaningfully strengthen the buy case.","effect":"talent adds +10% intrinsic upside, environment subtracts much of it","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"buy the talent but cap your bid below Jeanty's price; the Arizona context is the discount.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"if Love and Jeanty are both on the board, Jeanty goes first; take Love only at his own cost, never on pedigree alone.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"rookie volatility plays better here, so ADP is fine; any stabilizing QB move makes him a priority.","auctionTailoring":"League size and auction budget."},{"code":"R38","section":"RB","title":"Corum’s value comes from both contingency and live standalone usage","players":"Corum; That","view":"Format-dependent / monitor price","core":"That is rarer than the market is pricing.","body":"Most handcuffs are lottery tickets, worthless unless disaster strikes ahead of them. Corum belongs to the rarer breed that pays rent while you wait, because his path includes genuine standalone work alongside the contingency upside every backup carries. That dual profile is what the market chronically misprices: drafters bucket backs as either starters or insurance, and a player straddling the line falls through the crack.\n\nIf the split drifts toward even, he produces usable flex weeks on his own, and the injury scenario still sits behind that as a free call option on a lead role. The practical move is to see his cost as buying two outcomes for the price of one. This is most compelling in deeper leagues with bigger benches, where holding a developing role costs you nothing.\n\nMedium confidence, since the thesis rests on a workload split that camp could still tilt either way.","effect":"usable flex weeks even without injury if he reaches a near-50/50 split","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"$2-4 in deeper leagues buys two outcomes at once: usable flex weeks now, a lead role if disaster hits ahead of him.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"draft him a round before the other handcuffs; he is the rare one paying rent while you wait.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"strong in 18-round builds; standalone weeks plus contingency ceiling is exactly what the late rounds are for.","auctionTailoring":"Roster and bench size; League size and auction budget."},{"code":"R44","section":"RB","title":"Walker’s receiving role is the key uncertainty","players":"Walker; Public","view":"Price-sensitive / near fair value","core":"Public contract and transaction reporting do not specify touch-share language.","body":"Nothing in the public contract or transaction reporting spells out how Walker's touches will divide, and that silence is the entire fantasy question. Receiving work is the hinge: a back who stays on the field for passing downs banks targets that survive bad game script, while an early-down specialist needs everything else to go right.\n\nThe same player can therefore be two different assets, and the projection reflects it. Capture a three-down role and he beats his price comfortably; settle into a rotation and he's roughly fair. When outcomes fork that cleanly, the discipline is to pay for the pessimistic branch and let the optimistic one become your profit.\n\nUntil camp clarifies the target picture, he fits best in half-PPR and standard, where missing receptions cost less. Medium confidence is honest here, because one solid August report about passing-down usage would move this call decisively in either direction.","effect":"if he captures a three-down role, he materially beats price; if not, he is closer to fair","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"price the pessimistic branch: sheet value or less, with more appetite in half-PPR and standard rooms.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"take him at ADP in standard scoring; in full PPR let him slide until the discount shows up.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"market-weight exposure until camp clarifies passing downs; revisit the moment August reports talk targets.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R53","section":"RB","title":"Spears’ value rises because Daboll may increase overall offensive quality even if Pollard remains the nominal lead","players":"Spears’; Daboll; Pollard","view":"Format-dependent / monitor price","core":"Spears’ value rises because Daboll may increase overall offensive quality even if Pollard remains the nominal lead.","body":"A coaching change can lift a backup without changing his depth-chart line, and that's the Spears thesis. Daboll's arrival is less about handing Spears the job, since Pollard may well stay the nominal lead, and more about raising the quality of every snap the offense runs. Better offenses generate more plays, more scoring position, and more passing-down work, so the number-two back's touches get richer even when they don't get more numerous.\n\nSame role, higher-leverage usage: that's the mechanism. For a player priced as a pure backup, more valuable touches per game is exactly the quiet upgrade the market misses, because rankings key on projected volume rather than touch quality. His passing-game fit makes this most attractive in full PPR, where each incremental target compounds. Medium confidence cuts both ways; if Daboll's offense underwhelms or Pollard hoards passing downs, the edge shrinks toward nothing.","effect":"more valuable touches per game","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"a $1-3 flier in full PPR; touch quality is the upgrade the sheet cannot see.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"worth a round of aggression in PPR formats; number-two backs on better offenses out-earn their ADP.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"sneaky tournament piece; a Daboll efficiency bump plus contingency upside at a backup price.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"R58","section":"RB","title":"TreVeyon Henderson is the real threat to Stevenson’s full breakout","players":"TreVeyon Henderson; Stevenson; Specific; New England","view":"Underpriced","core":"Specific public summer role split is unspecified, but New England’s depth is no longer empty.","body":"New England's backfield used to be a one-man conversation, and it isn't anymore. Nothing public has pinned down the summer role split, but Henderson's presence alone changes the calculus, because depth behind a presumed lead back is what separates a true workhorse breakout from a committee.\n\nCeilings at running back are built on monopoly, meaning goal-line work, passing downs, and closing drives, and every touch Henderson claims comes straight out of Stevenson's best-case season. That's why the projection caps Stevenson's upside unless camp shows him clearly holding lead usage. The exploitable part sits on Henderson's side of the ledger, where uncertainty suppresses the price more than the underlying opportunity justifies.\n\nRather than solving the split before the coaches do, spread your bets and own pieces of both across leagues, profiting whichever way the snaps break. Medium confidence until August practice reports start talking.","effect":"Stevenson ceiling capped unless camp shows more lead usage","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"put your dollars on Henderson's suppressed price rather than Stevenson's capped ceiling; a few bucks buys the upside half of the split.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"Henderson is the value side of this backfield; across multiple leagues, own both directions of the split.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"draft both in the same build where possible; you cash whichever way the snaps break.","auctionTailoring":"League size and auction budget."},{"code":"R65","section":"RB","title":"AJ Dillon is not a meaningful standalone threat to Carolina’s backs","players":"AJ Dillon; Carolina","view":"Format-dependent / monitor price","core":"His 2025 output was minimal, and he signed on as Carolina depth behind Jonathon Brooks and Trevor Etienne.","body":"File this one under noise control. Dillon's 2025 output was minimal, and depth signings of that profile rarely reroute a backfield's touches; teams add veteran size for insurance, situational snaps, and camp competition, not to displace established roles.\n\nThe fantasy market sometimes flinches anyway, because any new name on a depth chart reads as a threat if you squint, and that flinch is where value leaks, with drafters shading down incumbents over a player who projects to touch the ball rarely. The projection is blunt: negligible effect on the top Carolina backfield options, Jonathon Brooks and Trevor Etienne included.\n\nSo price the established backs exactly as you did before Dillon signed, and leave him undrafted in standard redraft entirely. Medium confidence mostly hedges against the unknowable, an injury cascade or a shocking camp, either of which would rewrite this; absent that, don't let a roster transaction masquerade as a role change.","effect":"negligible effect on top Carolina backfield projections","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"change nothing; keep pricing the Carolina starters exactly as if Dillon never signed.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"do not shade the incumbents down a single pick; leave Dillon undrafted at standard league sizes.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"zero exposure needed outside the very deepest builds.","auctionTailoring":"League size and auction budget."},{"code":"W2","section":"WR","title":"The only real concern on Puka is playoff schedule, not role","players":"Puka; The Rams’","view":"Format-dependent / monitor price","core":"The Rams’ closing slate is very hard.","body":"Role security isn't the question here. The target dominance is as safe as it gets at the position. What actually changes the calculus is the calendar: the Rams close the season against a very hard slate, exactly when managed-league teams need their WR1 most. That's a scheduling penalty, not a talent one, and it lands differently by format.\n\nIn best ball you never have to make a start-sit call in a brutal late-season matchup, so the slate barely dents his value there; in weekly-start leagues, the projected effect is a slight late-year penalty that could cost you in the fantasy playoffs. Practically, that means paying full elite price only when the room forces it.\n\nWith medium confidence behind the call, watch for two things: if the Rams' offense proves matchup-proof early, the concern evaporates; if defenses do slow the passing game, the discount was earned.","effect":"slight managed-league penalty late in the year","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"pay elite money if the room forces it, but he is a better buy where the playoff slate matters least.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"still a top-5 pick; just break ties toward equal talents with a softer Weeks 15-17 schedule.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"the schedule concern nearly vanishes here; draft him at full elite conviction.","auctionTailoring":"League size and auction budget."},{"code":"W8","section":"WR","title":"Chase’s downside is almost entirely quarterback health and not teammate competition","players":"Chase; Tee Higgins","view":"Underpriced","core":"Tee Higgins helps the offense more than he hurts Chase.","body":"Strip away the noise and there's really one risk factor on Chase's ledger: his quarterback's health. That's a meaningfully different risk profile than target competition, because injury risk is priced into everyone while teammate anxiety gets overweighted by drafters.\n\nTee Higgins staying in the fold reads as a negative to the market, but the evidence points the other way: he helps the offense function more than he siphons from Chase, keeping the target share stable enough to support an elite projection. Better offenses create more scoring drives, and scoring drives feed the alpha receiver first.\n\nSo the market's hesitation is your entry point: treat him as a locked-in first-tier pick rather than a debate. Confidence here is high, and the call only breaks if the quarterback misses extended time, the one variable no draft process controls. League size shifts how aggressive to be, not whether the call is right.","effect":"target share stable enough","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"pay top-tier money without flinching; any Higgins-driven discount is a gift, not a warning.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"take him as high as your slot allows; teammate anxiety is the market's mistake, not yours.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"max-conviction elite; stack him with his QB and let the offense's scoring drives feed the alpha first.","auctionTailoring":"League size and auction budget."},{"code":"W16","section":"WR","title":"Pickens is more appealing in best ball because his deep role and tough schedule create spike-week asymmetry","players":"Pickens","view":"Format-dependent / monitor price","core":"Pickens is more appealing in best ball because his deep role and tough schedule create spike-week asymmetry.","body":"Deep threats live and die by variance, and variance is precisely what best ball pays for. His role is built on downfield work, which means quiet weeks and eruption weeks arrive in bunches rather than a steady drip, and a tough schedule amplifies the pattern: hard matchups suppress the floor while barely touching the ceiling games, since one busted coverage still produces a spike.\n\nBest ball formats harvest those spikes automatically; managed leagues force you to guess which weeks they land, and guessing wrong on a boom-bust receiver is how benches score points. The practical read is a format split: same player, different value depending on whether a computer or a human picks your lineup.\n\nMedium confidence fits a profile-based call like this: a shift toward steadier intermediate usage would erode the thesis, while continued deep deployment would cement it. In tournaments, the asymmetry is the whole appeal.","effect":"","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"in managed leagues hold sheet price; his big weeks are unguessable and your lineup has to guess.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"managed leagues can pass at cost; if he slides a round, the spike weeks get cheap enough to buy.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"his true home; the boom weeks harvest themselves, so run him above market in tournaments.","auctionTailoring":"League size and auction budget."},{"code":"W21","section":"WR","title":"A.J. Brown is one of the most interesting team-change bets in fantasy","players":"A.J. Brown; New England","view":"Underpriced","core":"New England traded for him, and current projections still put him near 1,234 yards and 7.6 TDs.","body":"Team-change bets usually ask you to accept a projection haircut in exchange for uncertainty; this one doesn't. New England traded for him, and the projections barely blinked: still near 1,234 yards and 7.6 touchdowns, which is to say the models believe the role travels intact.\n\nTarget earners of his caliber tend to import their share wherever they land, and an offense that just paid a trade price for a receiver is an offense planning to feature him. The upside case is the quarterback: if Maye's leap continues, the projected edge is 5 to 10 percent over market, which in draft terms turns a high-end WR2 cost into a WR1-overall lottery ticket with a sturdy floor.\n\nHigh confidence supports leaning in. The main thing that weakens the call is Maye stalling; the thing that strengthens it is any early sign the passing volume is real.","effect":"+5% to +10% versus market if the Maye leap continues","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"pay high-end WR2 money happily; a continued Maye leap turns it into a WR1 return.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"front of the WR2 tier; the trade price New England paid tells you the target share travels.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"raise exposure and stack him with Maye; the upside case is correlated by construction.","auctionTailoring":"League size and auction budget."},{"code":"W29","section":"WR","title":"Mike Evans to San Francisco creates weekly ceiling but lowers certainty","players":"Mike Evans; San Francisco; Evans; Christian Kirk","view":"Format-dependent / monitor price","core":"The 49ers signed Evans and Christian Kirk, making the offense richer but less concentrated.","body":"San Francisco's decision to sign both Evans and Christian Kirk tells you exactly what kind of asset Evans becomes: a ceiling play with a blurrier floor. A richer offense raises the scoring environment (more points, more red-zone trips, more chances for a proven touchdown scorer to cash them), but a less concentrated one spreads the weekly outcomes across more mouths, so you can no longer predict which weeks are his.\n\nThat combination is nearly the textbook definition of a best-ball asset and a managed-league headache: the evidence says he beats his price more often when a format harvests his spike weeks automatically than when you have to start him blind. Draft accordingly, and pay for him where variance is a feature.\n\nMedium confidence means the target distribution is the tell: early concentration toward Evans would rehabilitate his weekly-league case, while a true committee confirms the split.","effect":"Evans beats price more often in best ball than managed weekly-start formats","conf":"Medium","auctionPositioning":"Keep the bid disciplined and let price decide","auctionAction":"in weekly-start leagues demand a discount; the ceiling is real but you cannot schedule it.","snakePositioning":"Treat as tier-dependent and avoid forcing the pick","snakeAction":"let managed-league rivals pay for the name; take him only if he slips a round.","bestballPositioning":"Mix in selectively and prioritize only when the build benefits from the volatility","bestballAction":"target him here; spread offenses with proven red-zone finishers are what this format pays for.","auctionTailoring":"League size and auction budget."},{"code":"W38","section":"WR","title":"McMillan’s rookie-year success is more meaningful because rookie WR production broadly lagged in 2025","players":"McMillan","view":"Underpriced","core":"He was one of the few rookies to top 1,000 yards.","body":"Context is what separates a good rookie season from a meaningful one. Rookie receivers broadly lagged in 2025, which makes McMillan clearing 1,000 yards not just a nice line but a genuine outlier: he produced in an environment where his peers couldn't, and that's the kind of talent signal that tends to precede bigger roles.\n\nWhen a player earns production as a rookie against the class-wide grain, the simplest explanation is that he's better than the cohort, and better players tend to get fed more, not less, in year two. For drafters, that reads as a real edge in dynasty and keeper formats, where the signal compounds over years, and a milder bump in redraft, where one season's sample still carries risk.\n\nMedium confidence is honest here: a strong camp and early target share would firm it up, while a crowded depth chart would soften it.","effect":"positive talent signal","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"a couple dollars of conviction in redraft; real aggression belongs in keeper and dynasty pricing.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"bump him a full round in dynasty and keeper startups; a modest bump is right in redraft.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"increase exposure; outlier rookie production against a weak class is the profile that repeats.","auctionTailoring":"League size and auction budget."},{"code":"W43","section":"WR","title":"Wan’Dale Robinson’s 140-target 2025 season is unlikely to repeat under the Giants’ heavier personnel","players":"Wan’Dale Robinson; Giants’","view":"Overpriced or discount required","core":"Wan’Dale Robinson’s 140-target 2025 season is unlikely to repeat under the Giants’ heavier personnel.","body":"A 140-target season is the kind of number that anchors a draft price, and anchors are exactly what you should distrust. The Giants are shifting toward heavier personnel, and target volume for a slot-profile receiver is downstream of formation choices: fewer three-receiver sets means fewer routes, and fewer routes means the raw catch totals that inflated last year's fantasy line have no structural path to repeat.\n\nThat's the mechanism behind the regression risk: nothing about the player has to change for the volume to vanish. In full PPR especially, where his value was built almost entirely on reception count, paying last year's price is paying for a role that may no longer exist, so demand a discount and size it by scoring format.\n\nMedium confidence: early-season snap and route usage would settle this fast in either direction, and lighter-than-expected personnel would rescue the profile.","effect":"meaningful volume regression risk","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"in full PPR require several dollars off any price anchored to 140 targets; that volume has no structural path back.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"fade at last year's ADP in PPR; get interested again only two-plus rounds later.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"underweight; a low-depth slot profile without volume offers neither floor nor spike appeal.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W49","section":"WR","title":"Zay Flowers remains efficient but structurally capped on a Ravens team that still leans run-heavy and lost support personnel","players":"Zay Flowers; Ravens","view":"Overpriced or discount required","core":"Zay Flowers remains efficient but structurally capped on a Ravens team that still leans run-heavy and lost support personnel.","body":"Efficiency without volume is a compliment, not a fantasy case. The Ravens still lean run-heavy, and they lost support personnel rather than adding it, which cuts both ways for Flowers: he should keep commanding a healthy share of whatever passing exists, but the total pie stays structurally small. That's the trap with efficient receivers on run-first teams: the per-target production tempts you toward a ceiling projection the offense simply won't fund.\n\nIf the market prices him aggressively, the modest downside on ceiling is real, and the draft-day answer is patience rather than avoidance: he's a fine pick at a discount, better in PPR where his catch volume does more of the scoring work than in standard. Medium confidence reflects the dependency: a genuine shift toward more passing would break the cap and flip the call, while another run-heavy season locks it in.","effect":"modest under on ceiling if priced aggressively","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"buy only at a discount, and prefer PPR rooms; the offense will not fund a ceiling bid.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"do not reach; take the slide in PPR and pass entirely in standard scoring.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"modest exposure only; efficient-but-capped profiles rarely win tournaments.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W54","section":"WR","title":"Dallas Goedert is also an indirect beneficiary of the Brown trade","players":"Dallas Goedert; Brown; The Eagles","view":"Underpriced","core":"The Eagles kept him on a one-year deal and should need him more.","body":"One-year deals talk. The Eagles keeping Goedert on one while Brown departs says they expect to need him, and the math backs the instinct: when a high-volume receiver leaves, those targets don't evaporate, they redistribute, and the incumbent tight end with an established rapport is usually first in line.\n\nThe projected boost is 8 to 12 percent on targets, which at his price is the difference between a matchup-dependent streamer and a weekly starter you got a round late. Tight end value is almost entirely a volume story, so even a modest share increase moves his floor meaningfully, particularly in PPR, where the extra catches score directly, and the market doesn't seem to be pricing that in.\n\nMedium confidence, so watch how Philadelphia actually redistributes the vacated targets; if they funnel toward a receiver instead, the case thins quickly.","effect":"+8% to +12% target boost potential","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"add a dollar or two in PPR before the room prices in the vacated targets.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"take him a round earlier than consensus TE ranks; the target math justifies it.","bestballPositioning":"Increase exposure and use the player as a ceiling or portfolio leverage piece","bestballAction":"a strong mid-build TE; vacated-target upside at a price that still lets you double-tap the position.","auctionTailoring":"Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"W60","section":"WR","title":"The strongest WR archetype this year is attached to either elite QB improvement or clear target consolidation","players":"Brown; Moore; Waddle; Odunze; Smith; London","view":"Underpriced","core":"Brown, Moore, Waddle, Odunze, Smith, and London fit that pattern.","body":"Two forces reliably create fantasy value at receiver: a quarterback getting better, and targets consolidating into fewer hands. Everything else is mostly noise. Brown, Moore, Waddle, Odunze, Smith, and London all sit on top of at least one of those forces this year, which is why they belong in a different mental bucket than veterans returning to the same team and the same role.\n\nThe mechanism is straightforward (a rising quarterback lifts every route his receiver runs, and consolidation converts the same offense into more volume per player), and both effects tend to be underpriced because drafters anchor to last season's finish rather than this season's conditions. When you're choosing between one of these names and a stagnant-situation veteran at the same cost, take the situation change.\n\nHigh confidence overall, though league size matters: in shallower rooms, reserve the bump for the clearest cases.","effect":"","conf":"High","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"budget your WR dollars toward these six profiles over same-team, same-role veterans at equal cost.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"when two receivers are tied at your pick, take the situation change over the stagnant veteran, every time.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"tilt the whole WR portfolio toward QB-improvement and target-consolidation profiles.","auctionTailoring":"League size and auction budget."},{"code":"T3","section":"TE","title":"Love’s arrival is only a small threat to McBride because the offense still lacks WR certainty","players":"Love; McBride","view":"Underpriced","core":"Love’s arrival is only a small threat to McBride because the offense still lacks WR certainty.","body":"Arizona adding Love changes less than the transaction headline suggests, because the receiver room around McBride still hasn't produced a proven target earner to genuinely threaten him. Target share flows toward trust, and quarterbacks under pressure throw to the guy who's earned it. McBride has, and nobody else there fully has.\n\nSo the realistic outcome is a slight dip from what was frankly an absurd TE1 share, not a change in his standing; he stays in the position's top tier because the fallback volume is still enormous by tight end standards. For drafters, that means the correct response to any Love-driven discount is to take it gladly rather than fade the player.\n\nThe call carries medium confidence (a wideout seizing a true alpha role in camp would make the dip bigger), and in TE-premium formats the case for holding him at the top only strengthens.","effect":"slight target-share dip from TE1 absurdity, but not enough to move him off the top tier","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"keep him priced as the TE1; any Love-driven discount is free money.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"still the first tight end off your board; do not let a transaction headline scare you down a round.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"hold top exposure; a slight dip from an absurd share is still a monster share.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T7","section":"TE","title":"Colston Loveland is already being projected as a difference-maker, and that projection is not crazy","players":"Colston Loveland","view":"Underpriced","core":"Current projections give him 77.3 catches, 907 yards, and 6.7 TDs, third among TEs.","body":"The projection systems have already made up their mind here: 77.3 catches, 907 yards, and 6.7 touchdowns, third among tight ends, for a player whose price doesn't yet reflect a top-three outcome.\n\nWhat makes the number believable rather than rookie-hype inflation is the target math in Chicago: the offense has vacated targets to distribute, and if that tree consolidates heavily toward him, the projected upside runs 8 to 15 percent past his cost. Tight ends who catch passes at that volume become weekly lineup locks, and landing one in the middle rounds is how you win the position without paying the early-round tax.\n\nMedium confidence is the right calibration for a young player, since consolidation is the swing variable: a spread-it-around offense caps him near fair value. TE-premium and full PPR formats both amplify the payoff if the catches land.","effect":"+8% to +15% versus price if Chicago’s vacated target tree consolidates heavily","conf":"Medium","auctionPositioning":"Bid a few dollars above baseline value where needed; do not let the room win this at a flat sheet price","auctionAction":"nominate him mid-draft and push a few dollars past sheet; a top-3 TE outcome is not in his price yet.","snakePositioning":"Move the player or group up roughly one round, or to the front of the current tier","snakeAction":"take him a round ahead of ADP in TE-premium and full PPR; the middle rounds rarely offer this ceiling.","bestballPositioning":"Increase exposure, especially in correlated builds, stacks, and spike-week roster constructions","bestballAction":"core exposure; a 77-catch tight end at a mid-round cost is how you win the position without the early tax.","auctionTailoring":"TE-premium scoring; Scoring format (full/half/standard PPR); League size and auction budget."},{"code":"T14","section":"TE","title":"Sam LaPorta is somewhat trapped between Gibbs, Amon-Ra, and Jameson","players":"Sam LaPorta; Gibbs; Amon-Ra; Jameson. He","view":"Overpriced or discount required","core":"He projects as TE7, which feels right.","body":"There's a version of the Lions offense where LaPorta feasts, but he has to wait behind Gibbs, Amon-Ra, and Jameson to see it. That's the structural problem: three established mouths ahead of him in the pecking order cap the target upside no matter how good the player is, and tight ends without a path to more volume are priced on hope.\n\nThe TE7 projection feels right precisely because it's neither a fade nor a bet: the projected range against market runs from slightly negative to modestly positive, which is another way of saying the price is about correct. In draft terms, that profile rewards opportunism: take him when he slips past his line, never at his ceiling cost.\n\nMedium confidence; something removing one of those mouths from the target queue is the main development that would genuinely reopen the upside, TE-premium scoring or not.","effect":"-2% to +4% versus market","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"opportunism only; bid when the room lets him slip below sheet, never at his ceiling price.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"if he is still there a round past ADP, take him; never spend the early pick his name suggests.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"market weight at best; three mouths ahead of him cap the spike weeks you would be paying for.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T19","section":"TE","title":"Travis Kelce’s line is now narrower because Bowers, McBride, Loveland, Warren, and others have dragged the replacement level upward","players":"Travis Kelce; Bowers; McBride; Loveland; Warren","view":"Overpriced or discount required","core":"He projects TE10 and is no longer clearly tiered above the middle.","body":"Reputation is the most expensive thing you can draft. The tight end position quietly restocked (Bowers, McBride, Loveland, Warren, and others have pulled replacement level upward), and that changes Kelce's math even if his own play holds steady, because fantasy value is always relative to what's freely available at the position.\n\nA TE10 projection means he's no longer clearly tiered above the middle, so the old logic of paying up for positional advantage doesn't apply; you'd be paying an advantage price for a commodity outcome.\n\nDrafters who remember the dominant years are the risk here, not the player. If a room bids up the name, let them have it, and engage only at a genuine discount, since the projected downside if drafted on reputation runs 4 to 8 percent. Medium confidence, and in TE-premium leagues the crowded top of the position makes chasing him even less necessary.","effect":"-4% to -8% if drafted on old reputation","conf":"Medium","auctionPositioning":"Require a discount; stop bidding once the player or group reaches normal market value","auctionAction":"let the nostalgia bid win; engage only 15-20% below what the name usually commands.","snakePositioning":"Do not reach; consider only if the player or group falls at least a round below market cost","snakeAction":"never before the TE6-8 range; the position's restocked middle gives you his projection cheaper.","bestballPositioning":"Underweight; use only as low-exposure value if the price falls or the player completes a strong correlation","bestballAction":"low exposure; a narrowed range with no spike profile is the opposite of a tournament tight end.","auctionTailoring":"TE-premium scoring; League size and auction budget."},{"code":"T26","section":"TE","title":"Hunter Henry’s target share will be pressured by A.J. Brown","players":"Hunter Henry; A.J. Brown; Doubs; Patriots","view":"Price-sensitive / near fair value","core":"And Doubs, but the Patriots offense is good enough to keep him viable.","body":"New England's pass-catching hierarchy just got crowded, with A.J. Brown and Doubs squeezing the target math, yet the situation isn't the death sentence it might appear: the Patriots offense is good enough to keep Henry viable even on a reduced slice.\n\nRising offensive tides matter for tight ends: more drives and more scoring opportunities can offset a thinner target share, which is why the net read is roughly fair value with a lower ceiling than his projection rank implies. Practically, that makes him a backend TE1 you accept at market price, not a player you climb for; the paths to a genuinely bigger role mostly require things you shouldn't draft around.\n\nMedium confidence fits a call this balanced: watch the early target distribution, and note that TE-premium scoring lifts his floor enough to justify slightly more interest in those leagues.","effect":"mostly fair, lower ceiling than his projection rank might imply","conf":"Medium","auctionPositioning":"Hold your price; buy only at or below your sheet value","auctionAction":"market price only, plus a dollar in TE-premium; never bid like he is an upside play.","snakePositioning":"Draft at market slot only; do not move up unless the tier is about to dry up","snakeAction":"fine at ADP as a backend TE1; do not climb for him with Brown and Doubs squeezing the target math.","bestballPositioning":"Use at market exposure; let roster construction, stacking, and positional scarcity decide","bestballAction":"an acceptable second TE in TE-premium builds; do not build around his ceiling.","auctionTailoring":"TE-premium scoring; League size and auction budget."}];

const PROJECTIONS = [

  // ── QB (CBS/SportsLine 2026, adjusted) ──
  { name: "Josh Allen", position: "QB", team: "BUF", projectedStats: { passYd: 3946, passTD: 26.3, passInt: 11.6, rushYd: 580, rushTD: 12.5, fumLost: 4.2 }},
  { name: "Lamar Jackson", position: "QB", team: "BAL", projectedStats: { passYd: 3887, passTD: 26, passInt: 9.7, rushYd: 671, rushTD: 3.7, fumLost: 4.3 }},
  { name: "Drake Maye", position: "QB", team: "NE", projectedStats: { passYd: 4096, passTD: 27, passInt: 11.2, rushYd: 532, rushTD: 4.1, fumLost: 5.1 }},
  { name: "Jayden Daniels", position: "QB", team: "WAS", projectedStats: { passYd: 3851, passTD: 22.4, passInt: 9.9, rushYd: 670, rushTD: 5.1, fumLost: 3.7 }},
  { name: "Dak Prescott", position: "QB", team: "DAL", projectedStats: { passYd: 4112, passTD: 29.8, passInt: 11.9, rushYd: 186, rushTD: 2.1, fumLost: 3.6 }},
  { name: "Joe Burrow", position: "QB", team: "CIN", projectedStats: { passYd: 4132, passTD: 33, passInt: 10.9, rushYd: 189, rushTD: 2.1, fumLost: 2.9 }},
  { name: "Jalen Hurts", position: "QB", team: "PHI", projectedStats: { passYd: 3779, passTD: 23.5, passInt: 9.2, rushYd: 438, rushTD: 9.1, fumLost: 4.1 }},
  { name: "Trevor Lawrence", position: "QB", team: "JAX", projectedStats: { passYd: 3932, passTD: 24.9, passInt: 13, rushYd: 335, rushTD: 4.8, fumLost: 3.8 }},
  { name: "Jaxson Dart", position: "QB", team: "NYG", projectedStats: { passYd: 3685, passTD: 20.8, passInt: 10.1, rushYd: 552, rushTD: 6.5, fumLost: 3.7 }},
  { name: "Brock Purdy", position: "QB", team: "SF", projectedStats: { passYd: 4181, passTD: 27.1, passInt: 13.9, rushYd: 277, rushTD: 3.5, fumLost: 3.7 }},
  { name: "Patrick Mahomes", position: "QB", team: "KC", projectedStats: { passYd: 4001, passTD: 26.4, passInt: 11.7, rushYd: 327, rushTD: 3.3, fumLost: 3 }},
  { name: "Matthew Stafford", position: "QB", team: "LAR", projectedStats: { passYd: 4282, passTD: 34.9, passInt: 9.7, rushYd: 39, fumLost: 3.5 }},
  { name: "Daniel Jones", position: "QB", team: "IND", projectedStats: { passYd: 3750, passTD: 19.6, passInt: 11.1, rushYd: 307, rushTD: 5.9, fumLost: 4.5 }},
  { name: "Justin Herbert", position: "QB", team: "LAC", projectedStats: { passYd: 3850, passTD: 25.6, passInt: 11, rushYd: 406, rushTD: 2.4, fumLost: 3.6 }},
  { name: "Jared Goff", position: "QB", team: "DET", projectedStats: { passYd: 4216, passTD: 29, passInt: 10, rushYd: 49, fumLost: 3.4 }},
  { name: "Caleb Williams", position: "QB", team: "CHI", projectedStats: { passYd: 3821, passTD: 25.3, passInt: 9.9, rushYd: 382, rushTD: 2.3, fumLost: 4 }},
  { name: "Baker Mayfield", position: "QB", team: "TB", projectedStats: { passYd: 3823, passTD: 24.6, passInt: 11.6, rushYd: 323, rushTD: 1.4, fumLost: 4.4 }},
  { name: "Malik Willis", position: "QB", team: "MIA", projectedStats: { passYd: 3560, passTD: 13.2, passInt: 10.4, rushYd: 546, rushTD: 3.4, fumLost: 6.2 }},
  { name: "Sam Darnold", position: "QB", team: "SEA", projectedStats: { passYd: 4013, passTD: 24, passInt: 12.4, rushYd: 126, fumLost: 4.6 }},
  { name: "Bo Nix", position: "QB", team: "DEN", projectedStats: { passYd: 3877, passTD: 26.5, passInt: 11.1, rushYd: 356, rushTD: 4, fumLost: 3.1 }},
  { name: "C.J. Stroud", position: "QB", team: "HOU", projectedStats: { passYd: 3950, passTD: 21.5, passInt: 12, rushYd: 249, rushTD: 1.1, fumLost: 3.9 }},
  { name: "Tyler Shough", position: "QB", team: "NO", projectedStats: { passYd: 3886, passTD: 20.5, passInt: 11.1, rushYd: 286, rushTD: 4.3, fumLost: 3.2 }},
  { name: "Kyler Murray", position: "QB", team: "MIN", projectedStats: { passYd: 3347, passTD: 19.5, passInt: 10, rushYd: 444, rushTD: 3.1, fumLost: 3.5 }},
  { name: "Jordan Love", position: "QB", team: "GB", projectedStats: { passYd: 3991, passTD: 25, passInt: 10.7, rushYd: 213, fumLost: 4 }},
  { name: "Jacoby Brissett", position: "QB", team: "ARI", projectedStats: { passYd: 3354, passTD: 14.9, passInt: 9.2, rushYd: 210, rushTD: 1.3, fumLost: 3.7 }},
  { name: "Tua Tagovailoa", position: "QB", team: "ATL", projectedStats: { passYd: 2171, passTD: 10.4, passInt: 7.9, rushYd: 44, fumLost: 2.5 }},
  { name: "Bryce Young", position: "QB", team: "CAR", projectedStats: { passYd: 3640, passTD: 20.3, passInt: 12.1, rushYd: 272, rushTD: 2.1, fumLost: 4 }},
  { name: "Aaron Rodgers", position: "QB", team: "PIT", projectedStats: { passYd: 3772, passTD: 20.2, passInt: 11.1, rushYd: 100, rushTD: 0.9, fumLost: 3.5 }},
  { name: "Cam Ward", position: "QB", team: "TEN", projectedStats: { passYd: 3760, passTD: 16.6, passInt: 10.2, rushYd: 201, rushTD: 2, fumLost: 4.7 }},
  { name: "Geno Smith", position: "QB", team: "NYJ", projectedStats: { passYd: 3815, passTD: 20.4, passInt: 14.4, rushYd: 220, rushTD: 1, fumLost: 3.4 }},
  { name: "Fernando Mendoza", position: "QB", team: "LV", projectedStats: { passYd: 3059, passTD: 14.2, passInt: 10.5, rushYd: 226, rushTD: 1.9, fumLost: 3.4 }},
  { name: "Deshaun Watson", position: "QB", team: "CLE", projectedStats: { passYd: 1284, passTD: 5.4, passInt: 4.4, rushYd: 130, rushTD: 0.6, fumLost: 1.7 }},
  { name: "Shedeur Sanders", position: "QB", team: "CLE", projectedStats: { passYd: 2437, passTD: 10.3, passInt: 8.5, rushYd: 182, rushTD: 0.9, fumLost: 2.1 }},
  { name: "Ty Simpson", position: "QB", team: "LAR", projectedStats: { passYd: 146, passTD: 1.2, passInt: 0.6, rushYd: 5 }},
  { name: "Michael Penix Jr.", position: "QB", team: "ATL", projectedStats: { passYd: 1884, passTD: 9.5, passInt: 5.1, rushYd: 77 }},
  { name: "Kirk Cousins", position: "QB", team: "LV", projectedStats: { passYd: 832, passTD: 4.1, passInt: 2.7, rushYd: 11, fumLost: 0.9 }},
  { name: "Marcus Mariota", position: "QB", team: "WAS", projectedStats: { passYd: 166, passTD: 1, passInt: 0.7, rushYd: 10 }},
  { name: "Quinn Ewers", position: "QB", team: "MIA", projectedStats: { passYd: 153, passTD: 0.6, passInt: 0.6, rushYd: 4, rec: 0, recYd: 0, recTD: 0 }},
  { name: "Desmond Ridder", position: "QB", team: "GB", projectedStats: { passYd: 154, passTD: 0, passInt: 0, rushYd: 22 }},
  { name: "Joe Milton III", position: "QB", team: "DAL", projectedStats: { passYd: 175, passTD: 0, passInt: 0, rushYd: 17 }},
  { name: "Tyler Huntley", position: "QB", team: "BAL", projectedStats: { passYd: 129, passTD: 0.9, passInt: 0.5, rushYd: 9 }},
  { name: "Davis Mills", position: "QB", team: "HOU", projectedStats: { passYd: 147, passTD: 0.8, passInt: 0.6, rushYd: 4 }},
  { name: "Shane Buechele", position: "QB", team: "BUF", projectedStats: { passYd: 146, passTD: 0, passInt: 0, rushYd: 20 }},
  { name: "Mason Rudolph", position: "QB", team: "PIT", projectedStats: { passYd: 132, passTD: 1, passInt: 0, rushYd: 15 }},
  { name: "Jarrett Stidham", position: "QB", team: "DEN", projectedStats: { passYd: 162, passTD: 1.1, passInt: 0.6, rushYd: 7 }},
  { name: "Will Levis", position: "QB", team: "TEN", projectedStats: { passYd: 128, passTD: 1, passInt: 0, rushYd: 17 }},
  { name: "Gardner Minshew", position: "QB", team: "ARI", projectedStats: { passYd: 142, passTD: 0.6, passInt: 0.6, rushYd: 3 }},
  { name: "Garrett Nussmeier", position: "QB", team: "KC", projectedStats: { passYd: 113, passTD: 2, passInt: 0, rushYd: 2 }},
  { name: "Behren Morton", position: "QB", team: "NE", projectedStats: { passYd: 120, passTD: 0, passInt: 0, rushYd: 10 }},
  { name: "Seth Henigan", position: "QB", team: "IND", projectedStats: { passYd: 127, passTD: 1, passInt: 0, rushYd: 5 }},
  { name: "Joshua Dobbs", position: "QB", team: "NE", projectedStats: { passYd: 133, passTD: 0.9, passInt: 0.6, rushYd: 7 }},
  { name: "Tanner McKee", position: "QB", team: "PHI", projectedStats: { passYd: 153, passTD: 1, passInt: 0.5, rushYd: 4 }},
  { name: "Teddy Bridgewater", position: "QB", team: "DET", projectedStats: { passYd: 164, passTD: 2, passInt: 0, rushYd: 13 }},
  { name: "Cade Klubnik", position: "QB", team: "NYJ", projectedStats: { passYd: 143, passTD: 0.8, passInt: 0.8, rushYd: 7 }},
  { name: "Tyson Bagent", position: "QB", team: "CHI", projectedStats: { passYd: 156, passTD: 1, passInt: 0.5, rushYd: 6 }},
  { name: "Mitch Trubisky", position: "QB", team: "TEN", projectedStats: { passYd: 111, passTD: 2, passInt: 0, rushYd: 3 }},
  { name: "Cole Payton", position: "QB", team: "PHI", projectedStats: { passYd: 105, passTD: 1, passInt: 0, rushYd: 4 }},
  { name: "Adrian Martinez", position: "QB", team: "SF", projectedStats: { passYd: 117, passTD: 2, passInt: 0, rushYd: 7 }},
  { name: "Carson Beck", position: "QB", team: "ARI", projectedStats: { passYd: 451, passTD: 2.6, passInt: 1.5, rushYd: 29 }},
  { name: "Kyle Allen", position: "QB", team: "BUF", projectedStats: { passYd: 138, passTD: 0.9, passInt: 0.7, rushYd: 3 }},
  { name: "Will Howard", position: "QB", team: "PIT", projectedStats: { passYd: 105, passTD: 2, passInt: 0, rushYd: 3 }},
  { name: "Nick Mullens", position: "QB", team: "JAX", projectedStats: { passYd: 179, passTD: 1.1, passInt: 0.8, rushYd: 3 }},
  { name: "Jalen Milroe", position: "QB", team: "SEA", projectedStats: { passYd: 93, passTD: 0, passInt: 0, rushYd: 19 }},
  { name: "Drew Allar", position: "QB", team: "PIT", projectedStats: { passYd: 160, passTD: 0.9, passInt: 0.5, rushYd: 6 }},
  // ── RB (CBS/SportsLine 2026, adjusted) ──
  { name: "Bijan Robinson", position: "RB", team: "ATL", projectedStats: { rushYd: 1372, rushTD: 8.4, rec: 76, recYd: 708, recTD: 3.4, fumLost: 1.6 }},
  { name: "Jahmyr Gibbs", position: "RB", team: "DET", projectedStats: { rushYd: 1373, rushTD: 14.5, rec: 68, recYd: 546, recTD: 3.4, fumLost: 1.3 }},
  { name: "Jonathan Taylor", position: "RB", team: "IND", projectedStats: { rushYd: 1500, rushTD: 11.6, rec: 51, recYd: 390, recTD: 1.5, fumLost: 1.5 }},
  { name: "Derrick Henry", position: "RB", team: "BAL", projectedStats: { rushYd: 1484, rushTD: 13.1, rec: 21, recYd: 210, recTD: 1.2, fumLost: 1.5 }},
  { name: "De'Von Achane", position: "RB", team: "MIA", projectedStats: { rushYd: 1308, rushTD: 5, rec: 65, recYd: 511, recTD: 3, fumLost: 1 }},
  { name: "Christian McCaffrey", position: "RB", team: "SF", projectedStats: { rushYd: 1131, rushTD: 9.2, rec: 79, recYd: 682, recTD: 4.7, fumLost: 1.2 }},
  { name: "Chase Brown", position: "RB", team: "CIN", projectedStats: { rushYd: 1038, rushTD: 7.4, rec: 64, recYd: 435, recTD: 2.9, fumLost: 1.2 }},
  { name: "Ashton Jeanty", position: "RB", team: "LV", projectedStats: { rushYd: 1128, rushTD: 7.1, rec: 65, recYd: 496, recTD: 2, fumLost: 1.2 }},
  { name: "James Cook", position: "RB", team: "BUF", projectedStats: { rushYd: 1401, rushTD: 11, rec: 36, recYd: 302, recTD: 1.6, fumLost: 1.8 }},
  { name: "Saquon Barkley", position: "RB", team: "PHI", projectedStats: { rushYd: 1285, rushTD: 8.7, rec: 43, recYd: 371, recTD: 2.3, fumLost: 1 }},
  { name: "Josh Jacobs", position: "RB", team: "GB", projectedStats: { rushYd: 740, rushTD: 7.9, rec: 23.3, recYd: 181, recTD: 1, fumLost: 1 }},
  { name: "Cam Skattebo", position: "RB", team: "NYG", projectedStats: { rushYd: 1007, rushTD: 6.8, rec: 45, recYd: 332, recTD: 1.5, fumLost: 1.1 }},
  { name: "Kyren Williams", position: "RB", team: "LAR", projectedStats: { rushYd: 1071, rushTD: 10.2, rec: 33, recYd: 224, recTD: 1.6, fumLost: 1.1 }},
  { name: "Breece Hall", position: "RB", team: "NYJ", projectedStats: { rushYd: 1164, rushTD: 7.6, rec: 52, recYd: 439, recTD: 2.7, fumLost: 1.4 }},
  { name: "Omarion Hampton", position: "RB", team: "LAC", projectedStats: { rushYd: 1084, rushTD: 9.4, rec: 52, recYd: 363, recTD: 1.8, fumLost: 1.1 }},
  { name: "Bucky Irving", position: "RB", team: "TB", projectedStats: { rushYd: 991, rushTD: 5.3, rec: 37, recYd: 294, recTD: 1.7, fumLost: 1 }},
  { name: "Travis Etienne", position: "RB", team: "NO", projectedStats: { rushYd: 1142, rushTD: 6.2, rec: 45, recYd: 385, recTD: 2.1, fumLost: 1 }},
  { name: "D'Andre Swift", position: "RB", team: "CHI", projectedStats: { rushYd: 994, rushTD: 8.1, rec: 30, recYd: 269, recTD: 1.1, fumLost: 1 }},
  { name: "Jeremiyah Love", position: "RB", team: "ARI", projectedStats: { rushYd: 1128, rushTD: 6.6, rec: 65, recYd: 488, recTD: 2.2, fumLost: 1.3 }},
  { name: "Javonte Williams", position: "RB", team: "DAL", projectedStats: { rushYd: 1266, rushTD: 11.1, rec: 37, recYd: 218, recTD: 1.5, fumLost: 1.2 }},
  { name: "Kenneth Walker III", position: "RB", team: "KC", projectedStats: { rushYd: 1239, rushTD: 9.1, rec: 48, recYd: 377, recTD: 1.7, fumLost: 0.9 }},
  { name: "Rico Dowdle", position: "RB", team: "PIT", projectedStats: { rushYd: 975, rushTD: 5.5, rec: 29, recYd: 211, recTD: 1.1, fumLost: 0.9 }},
  { name: "Bhayshul Tuten", position: "RB", team: "JAX", projectedStats: { rushYd: 994, rushTD: 6.7, rec: 34, recYd: 250, recTD: 1.4, fumLost: 1.4 }},
  { name: "TreVeyon Henderson", position: "RB", team: "NE", projectedStats: { rushYd: 837, rushTD: 6.7, rec: 39, recYd: 269, recTD: 1.4, fumLost: 0.7 }},
  { name: "Quinshon Judkins", position: "RB", team: "CLE", projectedStats: { rushYd: 1249, rushTD: 7.4, rec: 32, recYd: 223, recTD: 0.7, fumLost: 0.7 }},
  { name: "RJ Harvey", position: "RB", team: "DEN", projectedStats: { rushYd: 316, rushTD: 2.9, rec: 49, recYd: 367, recTD: 2.6, fumLost: 0.4 }},
  { name: "Jaylen Warren", position: "RB", team: "PIT", projectedStats: { rushYd: 791, rushTD: 4.5, rec: 46, recYd: 320, recTD: 1.5, fumLost: 0.9 }},
  { name: "Jadarian Price", position: "RB", team: "SEA", projectedStats: { rushYd: 922, rushTD: 7.9, rec: 27, recYd: 212, recTD: 1.3, fumLost: 1 }},
  { name: "David Montgomery", position: "RB", team: "HOU", projectedStats: { rushYd: 932, rushTD: 7, rec: 31, recYd: 229, recTD: 0.6, fumLost: 1 }},
  { name: "Rhamondre Stevenson", position: "RB", team: "NE", projectedStats: { rushYd: 740, rushTD: 6.8, rec: 42, recYd: 350, recTD: 2.1, fumLost: 1.2 }},
  { name: "Tony Pollard", position: "RB", team: "TEN", projectedStats: { rushYd: 1044, rushTD: 5.4, rec: 30, recYd: 183, recTD: 0.5, fumLost: 1.2 }},
  { name: "Chuba Hubbard", position: "RB", team: "CAR", projectedStats: { rushYd: 709, rushTD: 3.8, rec: 41, recYd: 300, recTD: 1.4, fumLost: 0.8 }},
  { name: "J.K. Dobbins", position: "RB", team: "DEN", projectedStats: { rushYd: 958, rushTD: 6.6, rec: 21, recYd: 132, recTD: 0.8, fumLost: 0.5 }},
  { name: "Kenneth Gainwell", position: "RB", team: "TB", projectedStats: { rushYd: 537, rushTD: 3, rec: 59, recYd: 433, recTD: 3, fumLost: 1 }},
  { name: "Jordan Mason", position: "RB", team: "MIN", projectedStats: { rushYd: 899, rushTD: 6.4, rec: 13, recYd: 83, recTD: 0.3, fumLost: 1.2 }},
  { name: "Jacory Croskey-Merritt", position: "RB", team: "WAS", projectedStats: { rushYd: 848, rushTD: 7.4, rec: 16, recYd: 119, recTD: 0.7, fumLost: 1.5 }},
  { name: "Aaron Jones", position: "RB", team: "MIN", projectedStats: { rushYd: 652, rushTD: 3.2, rec: 47, recYd: 344, recTD: 2.1, fumLost: 1 }},
  { name: "Kyle Monangai", position: "RB", team: "CHI", projectedStats: { rushYd: 825, rushTD: 6.5, rec: 26, recYd: 215, recTD: 1.3, fumLost: 0.4 }},
  { name: "Rachaad White", position: "RB", team: "WAS", projectedStats: { rushYd: 568, rushTD: 5.1, rec: 40, recYd: 267, recTD: 1.8, fumLost: 0.6 }},
  { name: "Tyrone Tracy Jr.", position: "RB", team: "NYG", projectedStats: { rushYd: 151, rushTD: 0.5, rec: 12, recYd: 87, recTD: 0.4, fumLost: 0.2 }},
  { name: "Blake Corum", position: "RB", team: "LAR", projectedStats: { rushYd: 837, rushTD: 7.3, rec: 17, recYd: 117, recTD: 0.6, fumLost: 0.4 }},
  { name: "Woody Marks", position: "RB", team: "HOU", projectedStats: { rushYd: 581, rushTD: 3, rec: 24, recYd: 200, recTD: 1.3, fumLost: 0.7 }},
  { name: "Chris Rodriguez Jr.", position: "RB", team: "JAC", projectedStats: { rushYd: 432, rushTD: 3.4, rec: 4, recYd: 29, recTD: 0.2, fumLost: 0.3 }},
  { name: "Zach Charbonnet", position: "RB", team: "SEA", projectedStats: { rushYd: 424, rushTD: 5.3, rec: 15.3, recYd: 111, recTD: 0.3, fumLost: 0.2 }},
  { name: "Tyjae Spears", position: "RB", team: "TEN", projectedStats: { rushYd: 447, rushTD: 3, rec: 50, recYd: 336, recTD: 1.6, fumLost: 0.4 }},
  { name: "Isiah Pacheco", position: "RB", team: "DET", projectedStats: { rushYd: 489, rushTD: 3.4, rec: 13, recYd: 87, recTD: 0.6, fumLost: 0.4 }},
  { name: "Jonathon Brooks", position: "RB", team: "CAR", projectedStats: { rushYd: 810, rushTD: 4.3, rec: 33, recYd: 247, recTD: 1.2, fumLost: 0.9 }},
  { name: "Kaelon Black", position: "RB", team: "SF", projectedStats: { rushYd: 311, rushTD: 2.2, rec: 8, recYd: 63, recTD: 0.4, fumLost: 0.3 }},
  { name: "Jordan James", position: "RB", team: "SF", projectedStats: { rushYd: 151, rushTD: 1, rec: 4, recYd: 31, recTD: 0.2, fumLost: 0.2 }},
  { name: "James Conner", position: "RB", team: "ARI", projectedStats: { rushYd: 239, rushTD: 2.3, rec: 26.8, recYd: 201, recTD: 1.5 }},
  { name: "Justice Hill", position: "RB", team: "BAL", projectedStats: { rushYd: 223, rushTD: 1.4, rec: 39, recYd: 349, recTD: 1.7, fumLost: 0.4 }},
  { name: "Dylan Sampson", position: "RB", team: "CLE", projectedStats: { rushYd: 237, rushTD: 1.1, rec: 30, recYd: 208, recTD: 1.2, fumLost: 0.4 }},
  { name: "Adam Randall", position: "RB", team: "BAL", projectedStats: { rushYd: 93, rushTD: 0.7, rec: 3.1, recYd: 22, recTD: 0.2, fumLost: 0.1 }},
  { name: "Brian Robinson Jr.", position: "RB", team: "ATL", projectedStats: { rushYd: 560, rushTD: 3.7, rec: 9, recYd: 59, recTD: 0.3, fumLost: 0.5 }},
  { name: "Malik Davis", position: "RB", team: "DAL", projectedStats: { rushYd: 136, rushTD: 1, rec: 4, recYd: 30, recTD: 0.2 }},
  { name: "Tyler Allgeier", position: "RB", team: "ARI", projectedStats: { rushYd: 385, rushTD: 3.3, rec: 18, recYd: 126, recTD: 0.4, fumLost: 0.2 }},
  { name: "Emari Demercado", position: "RB", team: "KC", projectedStats: { rushYd: 256, rushTD: 1.4, rec: 16, recYd: 109, recTD: 0.6, fumLost: 0.3 }},
  { name: "Ty Johnson", position: "RB", team: "BUF", projectedStats: { rushYd: 219, rushTD: 2.1, rec: 22, recYd: 208, recTD: 1.3 }},
  { name: "Braelon Allen", position: "RB", team: "NYJ", projectedStats: { rushYd: 348, rushTD: 2.9, rec: 13, recYd: 90, recTD: 0.4, fumLost: 0.4 }},
  { name: "Emanuel Wilson", position: "RB", team: "SEA", projectedStats: { rushYd: 48, rushTD: 0.4, rec: 1, recYd: 10, recTD: 0.1, fumLost: 0 }},
  { name: "Christopher Brooks", position: "RB", team: "GB", projectedStats: { rushYd: 548, rushTD: 3, rec: 13, recYd: 108, recTD: 1, fumLost: 1 }},
  { name: "AJ Dillon", position: "RB", team: "CAR", projectedStats: { rushYd: 497, rushTD: 4, rec: 15, recYd: 130, recTD: 2, fumLost: 5 }},
  { name: "Jawhar Jordan", position: "RB", team: "HOU", projectedStats: { rushYd: 54, rushTD: 0.3, rec: 0, recYd: 0, recTD: 0, fumLost: 0 }},
  { name: "Samaje Perine", position: "RB", team: "CIN", projectedStats: { rushYd: 441, rushTD: 3.3, rec: 19, recYd: 139, recTD: 0.7, fumLost: 0.8 }},
  { name: "Mike Washington Jr.", position: "RB", team: "LV", projectedStats: { rushYd: 362, rushTD: 2.2, rec: 8, recYd: 60, recTD: 0.3, fumLost: 0.4 }},
  { name: "Keaton Mitchell", position: "RB", team: "LAC", projectedStats: { rushYd: 393, rushTD: 2.4, rec: 20, recYd: 157, recTD: 0.8, fumLost: 0.5 }},
  { name: "Kimani Vidal", position: "RB", team: "LAC", projectedStats: { rushYd: 136, rushTD: 1.1, rec: 8, recYd: 63, recTD: 0.4 }},
  { name: "Kendre Miller", position: "RB", team: "NO", projectedStats: { rushYd: 100, rushTD: 0.5, rec: 2, recYd: 11, recTD: 0 }},
  { name: "Tank Bigsby", position: "RB", team: "PHI", projectedStats: { rushYd: 373, rushTD: 3.4, rec: 4, recYd: 29, recTD: 0.1 }},
  { name: "Kyle Juszczyk", position: "RB", team: "SF", projectedStats: { rushYd: 19, rec: 20, recYd: 162, recTD: 0.9 }},
  { name: "Jaylen Wright", position: "RB", team: "MIA", projectedStats: { rushYd: 234, rushTD: 1.1, rec: 7, recYd: 56, recTD: 0.2, fumLost: 0.5 }},
  { name: "Brashard Smith", position: "RB", team: "KC", projectedStats: { rushYd: 182, rushTD: 0, rec: 22, recYd: 144, recTD: 0 }},
  { name: "Devin Neal", position: "RB", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 0, recYd: 0, recTD: 0 }},
  { name: "Frank Gore Jr.", position: "RB", team: "BUF", projectedStats: { rushYd: 178, rushTD: 1, rec: 2, recYd: 29, recTD: 0 }},
  { name: "Roschon Johnson", position: "RB", team: "CHI", projectedStats: { rushYd: 120, rushTD: 2, rec: 5, recYd: 13, recTD: 0 }},
  { name: "Jerome Ford", position: "RB", team: "WAS", projectedStats: { rushYd: 194, rushTD: 2, rec: 7, recYd: 47, recTD: 1 }},
  { name: "Isaiah Davis", position: "RB", team: "NYJ", projectedStats: { rushYd: 178, rushTD: 1.3, rec: 13, recYd: 96, recTD: 0.4 }},
  { name: "Phil Mafah", position: "RB", team: "DAL", projectedStats: { rushYd: 142, rushTD: 2, rec: 2, recYd: 40, recTD: 0 }},
  { name: "Ty Chandler", position: "RB", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 0, recYd: 0, recTD: 0 }},
  { name: "Seth McGowan", position: "RB", team: "IND", projectedStats: { rushYd: 52, rushTD: 0.4, rec: 4, recYd: 30, recTD: 0.2 }},
  { name: "Sean Tucker", position: "RB", team: "TB", projectedStats: { rushYd: 182, rushTD: 2.4, rec: 2, recYd: 14, recTD: 0.1 }},
  { name: "Kaytron Allen", position: "RB", team: "WAS", projectedStats: { rushYd: 51, rushTD: 0.4, rec: 4, recYd: 29, recTD: 0.2 }},
  { name: "Austin Ekeler", position: "RB", team: "WAS", projectedStats: { rushYd: 151, rushTD: 1, rec: 5, recYd: 63, recTD: 0 }},
  { name: "Michael Burton", position: "RB", team: "CLE", projectedStats: { rushYd: 18, rushTD: 0.1, rec: 4, recYd: 27, recTD: 0.1 }},
  { name: "Andrew Beck", position: "RB", team: "NYJ", projectedStats: { rushYd: 0, rec: 4, recYd: 28, recTD: 0.2 }},
  { name: "Jeremy McNichols", position: "RB", team: "WAS", projectedStats: { rushYd: 67, rushTD: 0, rec: 4.6, recYd: 41, recTD: 0.8 }},
  { name: "Isaac Guerendo", position: "RB", team: "SF", projectedStats: { rushYd: 122, rushTD: 1.5, rec: 2.3, recYd: 26, recTD: 0.8 }},
  { name: "Ameer Abdullah", position: "RB", team: "JAX", projectedStats: { rushYd: 74, rushTD: 1, rec: 6, recYd: 54, recTD: 0 }},
  { name: "Jam Miller", position: "RB", team: "NE", projectedStats: { rushYd: 153, rushTD: 0, rec: 4, recYd: 21, recTD: 1 }},
  { name: "Dare Ogunbowale", position: "RB", team: "HOU", projectedStats: { rushYd: 69, rushTD: 2, rec: 5, recYd: 64, recTD: 0 }},
  { name: "Elijah Mitchell", position: "RB", team: "PHI", projectedStats: { rushYd: 160, rushTD: 2, rec: 4, recYd: 19, recTD: 1 }},
  { name: "Zavier Scott", position: "RB", team: "MIN", projectedStats: { rushYd: 104, rec: 7, recYd: 46, recTD: 2 }},
  // ── WR (CBS/SportsLine 2026, adjusted) ──
  { name: "Jaxon Smith-Njigba", position: "WR", team: "SEA", projectedStats: { rushYd: 25, rushTD: 0.2, rec: 117, recYd: 1569, recTD: 8.5, fumLost: 1.2 }},
  { name: "Puka Nacua", position: "WR", team: "LAR", projectedStats: { rushYd: 106, rushTD: 1.2, rec: 123, recYd: 1590, recTD: 9.7, fumLost: 1 }},
  { name: "Ja'Marr Chase", position: "WR", team: "CIN", projectedStats: { rushYd: 21, rushTD: 0.1, rec: 120, recYd: 1509, recTD: 10.8, fumLost: 0.9 }},
  { name: "Drake London", position: "WR", team: "ATL", projectedStats: { rushYd: 0, rushTD: 0, rec: 102, recYd: 1250, recTD: 7.3, fumLost: 0.9 }},
  { name: "Amon-Ra St. Brown", position: "WR", team: "DET", projectedStats: { rushYd: 13, rushTD: 0.1, rec: 118, recYd: 1426, recTD: 10.4, fumLost: 0.8 }},
  { name: "Rashee Rice", position: "WR", team: "KC", projectedStats: { rushYd: 43, rushTD: 0.6, rec: 93, recYd: 1085, recTD: 8.8, fumLost: 1.1 }},
  { name: "George Pickens", position: "WR", team: "DAL", projectedStats: { rushYd: 0, rushTD: 0, rec: 80, recYd: 1112, recTD: 8.2, fumLost: 0.9 }},
  { name: "Chris Olave", position: "WR", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 91, recYd: 1197, recTD: 6.7, fumLost: 0.6 }},
  { name: "A.J. Brown", position: "WR", team: "NE", projectedStats: { rushYd: 0, rushTD: 0, rec: 86, recYd: 1216, recTD: 7, fumLost: 0.6 }},
  { name: "CeeDee Lamb", position: "WR", team: "DAL", projectedStats: { rushYd: 13, rushTD: 0.1, rec: 103, recYd: 1376, recTD: 8.6, fumLost: 0.7 }},
  { name: "Nico Collins", position: "WR", team: "HOU", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 87, recYd: 1203, recTD: 6.7, fumLost: 0.7 }},
  { name: "Zay Flowers", position: "WR", team: "BAL", projectedStats: { rushYd: 57, rushTD: 0.4, rec: 82, recYd: 1171, recTD: 5.5, fumLost: 1 }},
  { name: "Justin Jefferson", position: "WR", team: "MIN", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 111, recYd: 1376, recTD: 7.4, fumLost: 0.7 }},
  { name: "Tee Higgins", position: "WR", team: "CIN", projectedStats: { rushYd: 0, rushTD: 0, rec: 73, recYd: 956, recTD: 8.4, fumLost: 0.4 }},
  { name: "DeVonta Smith", position: "WR", team: "PHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 91, recYd: 1130, recTD: 6, fumLost: 0.6 }},
  { name: "Malik Nabers", position: "WR", team: "NYG", projectedStats: { rushYd: 23, rushTD: 0.1, rec: 86, recYd: 1135, recTD: 7.3, fumLost: 0.8 }},
  { name: "Garrett Wilson", position: "WR", team: "NYJ", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 100, recYd: 1172, recTD: 5.2, fumLost: 1.1 }},
  { name: "Emeka Egbuka", position: "WR", team: "TB", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 70, recYd: 1127, recTD: 7.5, fumLost: 0.6 }},
  { name: "Terry McLaurin", position: "WR", team: "WAS", projectedStats: { rushYd: 0, rushTD: 0, rec: 77, recYd: 1053, recTD: 6.1, fumLost: 0.6 }},
  { name: "Alec Pierce", position: "WR", team: "IND", projectedStats: { rushYd: 0, rushTD: 0, rec: 61, recYd: 948, recTD: 5.3, fumLost: 0.5 }},
  { name: "Courtland Sutton", position: "WR", team: "DEN", projectedStats: { rushYd: 0, rushTD: 0, rec: 69, recYd: 895, recTD: 7.6, fumLost: 0.5 }},
  { name: "Jameson Williams", position: "WR", team: "DET", projectedStats: { rushYd: 45, rushTD: 0.6, rec: 64, recYd: 1026, recTD: 5.7, fumLost: 0.4 }},
  { name: "Tetairoa McMillan", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rushTD: 0, rec: 84, recYd: 1185, recTD: 5.9, fumLost: 0.8 }},
  { name: "Rome Odunze", position: "WR", team: "CHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 59, recYd: 1029, recTD: 8.4, fumLost: 0.6 }},
  { name: "Davante Adams", position: "WR", team: "LAR", projectedStats: { rushYd: 0, rushTD: 0, rec: 68, recYd: 1016, recTD: 10.6, fumLost: 0.4 }},
  { name: "Ladd McConkey", position: "WR", team: "LAC", projectedStats: { rushYd: 0, rushTD: 0, rec: 80, recYd: 1039, recTD: 6.3, fumLost: 0.6 }},
  { name: "Luther Burden III", position: "WR", team: "CHI", projectedStats: { rushYd: 50, rushTD: 0.4, rec: 75, recYd: 937, recTD: 5.1, fumLost: 0.7 }},
  { name: "Jaylen Waddle", position: "WR", team: "DEN", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 77, recYd: 994, recTD: 6, fumLost: 0.7 }},
  { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", projectedStats: { rushYd: 0, rushTD: 0, rec: 69, recYd: 954, recTD: 5, fumLost: 0.6 }},
  { name: "DJ Moore", position: "WR", team: "BUF", projectedStats: { rushYd: 36, rushTD: 0.4, rec: 67, recYd: 945, recTD: 7, fumLost: 0.6 }},
  { name: "Mike Evans", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 57, recYd: 894, recTD: 5.8, fumLost: 0.4 }},
  { name: "Jakobi Meyers", position: "WR", team: "JAX", projectedStats: { rushYd: 32, rushTD: 0.3, rec: 70, recYd: 767, recTD: 5.2, fumLost: 0.6 }},
  { name: "Wan'Dale Robinson", position: "WR", team: "TEN", projectedStats: { rushYd: 22, rushTD: 0.1, rec: 79, recYd: 824, recTD: 1.9, fumLost: 0.6 }},
  { name: "DK Metcalf", position: "WR", team: "PIT", projectedStats: { rushYd: 0, rushTD: 0, rec: 65, recYd: 944, recTD: 6.2, fumLost: 0.5 }},
  { name: "Parker Washington", position: "WR", team: "JAX", projectedStats: { rushYd: 39, rushTD: 0.3, rec: 64, recYd: 851, recTD: 5.2, fumLost: 0.8 }},
  { name: "Chris Godwin", position: "WR", team: "TB", projectedStats: { rushYd: 0, rushTD: 0, rec: 60, recYd: 701, recTD: 4.5, fumLost: 0.6 }},
  { name: "Quentin Johnston", position: "WR", team: "LAC", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 53, recYd: 778, recTD: 5.6, fumLost: 0.4 }},
  { name: "Josh Downs", position: "WR", team: "IND", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 70, recYd: 697, recTD: 2.7, fumLost: 0.6 }},
  { name: "Christian Watson", position: "WR", team: "GB", projectedStats: { rushYd: 13, rushTD: 0.1, rec: 55, recYd: 866, recTD: 7, fumLost: 0.5 }},
  { name: "Michael Pittman", position: "WR", team: "PIT", projectedStats: { rushYd: 0, rushTD: 0, rec: 88, recYd: 863, recTD: 3.9, fumLost: 0.6 }},
  { name: "Michael Wilson", position: "WR", team: "ARI", projectedStats: { rushYd: 0, rushTD: 0, rec: 71, recYd: 860, recTD: 3.4, fumLost: 0.4 }},
  { name: "Brian Thomas Jr.", position: "WR", team: "JAX", projectedStats: { rushYd: 23, rushTD: 0.2, rec: 57, recYd: 861, recTD: 5.1, fumLost: 0.3 }},
  { name: "Khalil Shakir", position: "WR", team: "BUF", projectedStats: { rushYd: 13, rushTD: 0.1, rec: 70, recYd: 765, recTD: 3.7, fumLost: 0.6 }},
  { name: "Tank Dell", position: "WR", team: "HOU", projectedStats: { rushYd: 34, rushTD: 0.2, rec: 26, recYd: 317, recTD: 1.8, fumLost: 0.3 }},
  { name: "Jordan Addison", position: "WR", team: "MIN", projectedStats: { rushYd: 14, rushTD: 0.1, rec: 60, recYd: 770, recTD: 5.2, fumLost: 0.4 }},
  { name: "Jordyn Tyson", position: "WR", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 19.1, recYd: 256, recTD: 1.4, fumLost: 0.2 }},
  { name: "Jayden Reed", position: "WR", team: "GB", projectedStats: { rushYd: 65, rushTD: 0.4, rec: 63, recYd: 727, recTD: 4.4, fumLost: 0.8 }},
  { name: "Romeo Doubs", position: "WR", team: "NE", projectedStats: { rushYd: 0, rushTD: 0, rec: 52, recYd: 667, recTD: 5.3, fumLost: 0.5 }},
  { name: "John Metchie III", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rec: 66, recYd: 596, recTD: 4 }},
  { name: "Jauan Jennings", position: "WR", team: "MIN", projectedStats: { rushYd: 0, rushTD: 0, rec: 46, recYd: 486, recTD: 3.3, fumLost: 0.5 }},
  { name: "Xavier Worthy", position: "WR", team: "KC", projectedStats: { rushYd: 76, rushTD: 0.6, rec: 56, recYd: 791, recTD: 4.7, fumLost: 0.3 }},
  { name: "Makai Lemon", position: "WR", team: "PHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 52, recYd: 741, recTD: 4.7, fumLost: 0.5 }},
  { name: "Cooper Kupp", position: "WR", team: "SEA", projectedStats: { rushYd: 0, rushTD: 0, rec: 38, recYd: 472, recTD: 2.8, fumLost: 0.3 }},
  { name: "Troy Franklin", position: "WR", team: "DEN", projectedStats: { rushYd: 11, rec: 17, recYd: 216, recTD: 1.8, fumLost: 0.2 }},
  { name: "Jalen Coker", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rushTD: 0, rec: 61, recYd: 689, recTD: 3, fumLost: 0.6 }},
  { name: "Calvin Ridley", position: "WR", team: "TEN", projectedStats: { rushYd: 32, rushTD: 0.2, rec: 43, recYd: 678, recTD: 3.4, fumLost: 0.4 }},
  { name: "Carnell Tate", position: "WR", team: "TEN", projectedStats: { rushYd: 0, rushTD: 0, rec: 75, recYd: 1024, recTD: 4.5, fumLost: 0.8 }},
  { name: "Theo Wease Jr.", position: "WR", team: "MIA", projectedStats: { rushYd: 7, rec: 46, recYd: 682, recTD: 6, fumLost: 1 }},
  { name: "Jerry Jeudy", position: "WR", team: "CLE", projectedStats: { rushYd: 0, rushTD: 0, rec: 52, recYd: 722, recTD: 2.7, fumLost: 0.5 }},
  { name: "Travis Hunter", position: "WR", team: "JAX", projectedStats: { rushYd: 11, rec: 42, recYd: 497, recTD: 3.3, fumLost: 0.4 }},
  { name: "Keon Coleman", position: "WR", team: "BUF", projectedStats: { rushYd: 0, rushTD: 0, rec: 24, recYd: 338, recTD: 2.8, fumLost: 0.2 }},
  { name: "Deebo Samuel", position: "WR", team: "SF", projectedStats: { rushYd: 109, rushTD: 1.1, rec: 48, recYd: 625, recTD: 3.7, fumLost: 0.7 }},
  { name: "Marvin Mims Jr.", position: "WR", team: "DEN", projectedStats: { rushYd: 45, rushTD: 0.3, rec: 24, recYd: 273, recTD: 1.6, fumLost: 0.3 }},
  { name: "Rashod Bateman", position: "WR", team: "BAL", projectedStats: { rushYd: 0, rushTD: 0, rec: 38, recYd: 614, recTD: 4, fumLost: 0.3 }},
  { name: "Tre Tucker", position: "WR", team: "LV", projectedStats: { rushYd: 57, rushTD: 0.3, rec: 48, recYd: 658, recTD: 2.5, fumLost: 0.3 }},
  { name: "Rashid Shaheed", position: "WR", team: "SEA", projectedStats: { rushYd: 87, rushTD: 0.5, rec: 43, recYd: 647, recTD: 3.5, fumLost: 0.6 }},
  { name: "Christian Kirk", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 7.6, recYd: 99, recTD: 0.6, fumLost: 0.1 }},
  { name: "Jalen Nailor", position: "WR", team: "LV", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 44, recYd: 607, recTD: 3, fumLost: 0.4 }},
  { name: "Jayden Higgins", position: "WR", team: "HOU", projectedStats: { rushYd: 0, rushTD: 0, rec: 0, recYd: 0, recTD: 0, fumLost: 0 }},
  { name: "Omar Cooper Jr.", position: "WR", team: "NYJ", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 33, recYd: 395, recTD: 2.2, fumLost: 0.4 }},
  { name: "Antonio Williams", position: "WR", team: "WAS", projectedStats: { rushYd: 22, rushTD: 0.2, rec: 26, recYd: 344, recTD: 2.3, fumLost: 0.3 }},
  { name: "Kayshon Boutte", position: "WR", team: "NE", projectedStats: { rec: 41, recYd: 528, recTD: 2.8 }},
  { name: "Jalen McMillan", position: "WR", team: "TB", projectedStats: { rushYd: 25, rushTD: 0.2, rec: 47, recYd: 589, recTD: 3.9, fumLost: 0.4 }},
  { name: "Marquise Brown", position: "WR", team: "PHI", projectedStats: { rec: 42, recYd: 547, recTD: 4 }},
  { name: "Devaughn Vele", position: "WR", team: "NO", projectedStats: { rec: 50, recYd: 544, recTD: 3.4 }},
  { name: "Matthew Golden", position: "WR", team: "GB", projectedStats: { rushYd: 25, rushTD: 0.2, rec: 67, recYd: 870, recTD: 4.7, fumLost: 0.7 }},
  { name: "Elic Ayomanor", position: "WR", team: "TEN", projectedStats: { rec: 9, recYd: 116, recTD: 0.6 }},
  { name: "KC Concepcion", position: "WR", team: "CLE", projectedStats: { rushYd: 35, rushTD: 0.2, rec: 59, recYd: 739, recTD: 3.1, fumLost: 0.7 }},
  { name: "Tory Horton", position: "WR", team: "SEA", projectedStats: { rushYd: 0, rec: 22, recYd: 299, recTD: 2.3, fumLost: 0.2 }},
  { name: "Darnell Mooney", position: "WR", team: "NYG", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 24, recYd: 349, recTD: 1.9, fumLost: 0.2 }},
  { name: "Chimere Dike", position: "WR", team: "TEN", projectedStats: { rushYd: 50, rec: 11, recYd: 112, recTD: 0.8, fumLost: 0.2 }},
  { name: "De'Zhaun Stribling", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 49, recYd: 746, recTD: 4.5, fumLost: 0.5 }},
  { name: "Denzel Boston", position: "WR", team: "CLE", projectedStats: { rushYd: 0, rushTD: 0, rec: 55, recYd: 694, recTD: 3, fumLost: 0.6 }},
  { name: "Darius Slayton", position: "WR", team: "NYG", projectedStats: { rushYd: 12, rec: 31, recYd: 439, recTD: 2, fumLost: 0.4 }},
  { name: "Ja'Kobi Lane", position: "WR", team: "BAL", projectedStats: { rushYd: 0, rec: 32, recYd: 485, recTD: 3.5, fumLost: 0.3 }},
  { name: "Germie Bernard", position: "WR", team: "PIT", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 40, recYd: 504, recTD: 2.8, fumLost: 0.4 }},
  { name: "Tyquan Thornton", position: "WR", team: "KC", projectedStats: { rec: 24, recYd: 360, recTD: 3 }},
  { name: "Bub Means", position: "WR", team: "NO", projectedStats: { rushYd: 11, rec: 36, recYd: 520, recTD: 2, fumLost: 1 }},
  { name: "Malik Washington", position: "WR", team: "MIA", projectedStats: { rushYd: 78, rushTD: 0.4, rec: 45, recYd: 475, recTD: 1.7, fumLost: 0.6 }},
  { name: "Olamide Zaccheaus", position: "WR", team: "ATL", projectedStats: { rushYd: 0, rec: 14, recYd: 142, recTD: 0.6 }},
  { name: "Jahdae Walker", position: "WR", team: "CHI", projectedStats: { rushYd: 0, rec: 3, recYd: 36, recTD: 0.3 }},
  { name: "Calvin Austin III", position: "WR", team: "NYG", projectedStats: { rec: 0, recYd: 0, recTD: 0 }},
  { name: "Andrei Iosivas", position: "WR", team: "CIN", projectedStats: { rushYd: 11, rec: 21, recYd: 235, recTD: 2.1 }},
  { name: "Cedric Tillman", position: "WR", team: "CLE", projectedStats: { rushYd: 0, rec: 32, recYd: 413, recTD: 5 }},
  { name: "Ted Hurst", position: "WR", team: "TB", projectedStats: { rushYd: 0, rec: 23, recYd: 295, recTD: 2.1, fumLost: 0.2 }},
  { name: "Isaac TeSlaa", position: "WR", team: "DET", projectedStats: { rushYd: 0, rushTD: 0, rec: 24, recYd: 301, recTD: 3.2, fumLost: 0.2 }},
  { name: "Ashton Dulin", position: "WR", team: "IND", projectedStats: { rushYd: 26, rec: 10, recYd: 126, recTD: 0.6 }},
  { name: "Dontayvion Wicks", position: "WR", team: "PHI", projectedStats: { rushYd: 0, rec: 40, recYd: 518, recTD: 2.9 }},
  { name: "Demarcus Robinson", position: "WR", team: "SF", projectedStats: { rushYd: 0, rec: 3, recYd: 44, recTD: 0.3 }},
  { name: "Xavier Hutchinson", position: "WR", team: "HOU", projectedStats: { rushYd: 12, rec: 19, recYd: 230, recTD: 1.1 }},
  { name: "Caleb Douglas", position: "WR", team: "MIA", projectedStats: { rushYd: 0, rushTD: 0, rec: 44, recYd: 585, recTD: 2.1, fumLost: 0.4 }},
  { name: "Josh Palmer", position: "WR", team: "BUF", projectedStats: { rec: 36, recYd: 464, recTD: 1 }},
  { name: "Zavion Thomas", position: "WR", team: "CHI", projectedStats: { rushYd: 0, rec: 12, recYd: 154, recTD: 1.2, fumLost: 0.1 }},
  { name: "Zachariah Branch", position: "WR", team: "ATL", projectedStats: { rushYd: 0, rec: 31, recYd: 382, recTD: 1.9, fumLost: 0.3 }},
  { name: "Luke McCaffrey", position: "WR", team: "WAS", projectedStats: { rec: 7, recYd: 80, recTD: 0.5 }},
  { name: "Kevin Austin Jr.", position: "WR", team: "NO", projectedStats: { rushYd: 6, rec: 35, recYd: 391, recTD: 1 }},
  { name: "Kendrick Bourne", position: "WR", team: "ARI", projectedStats: { rushYd: 0, rec: 23, recYd: 239, recTD: 0.7 }},
  { name: "Jalen Tolbert", position: "WR", team: "MIA", projectedStats: { rushYd: 0, rushTD: 0, rec: 33, recYd: 411, recTD: 1.7, fumLost: 0.3 }},
  { name: "Tez Johnson", position: "WR", team: "TB", projectedStats: { rushYd: 23, rec: 7, recYd: 78, recTD: 0.6 }},
  { name: "Ben Skowronek", position: "WR", team: "PIT", projectedStats: { rec: 22, recYd: 374, recTD: 2 }},
  { name: "Ryan Flournoy", position: "WR", team: "DAL", projectedStats: { rushYd: 12, rushTD: 0.1, rec: 34, recYd: 383, recTD: 2.7, fumLost: 0.4 }},
  { name: "Roman Wilson", position: "WR", team: "PIT", projectedStats: { rushYd: 0, rec: 12, recYd: 135, recTD: 0.6, fumLost: 0.1 }},
  { name: "Mack Hollins", position: "WR", team: "NE", projectedStats: { rushYd: 0, rec: 21, recYd: 258, recTD: 1.6 }},
  { name: "Adonai Mitchell", position: "WR", team: "NYJ", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 42, recYd: 621, recTD: 3.6, fumLost: 0.5 }},
  { name: "Devontez Walker", position: "WR", team: "BAL", projectedStats: { rushYd: 0, rec: 14, recYd: 209, recTD: 1.5 }},
  // ── TE (CBS/SportsLine 2026, adjusted) ──
  { name: "Trey McBride", position: "TE", team: "ARI", projectedStats: { rushYd: 0, rushTD: 0, rec: 108, recYd: 1023, recTD: 5.3, fumLost: 0.5 }},
  { name: "Brock Bowers", position: "TE", team: "LV", projectedStats: { rushYd: 15, rushTD: 0.2, rec: 99, recYd: 999, recTD: 6.6, fumLost: 0.4 }},
  { name: "Colston Loveland", position: "TE", team: "CHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 80, recYd: 897, recTD: 6, fumLost: 0.4 }},
  { name: "Tyler Warren", position: "TE", team: "IND", projectedStats: { rushYd: 14, rushTD: 0.4, rec: 85, recYd: 894, recTD: 5.5, fumLost: 0.6 }},
  { name: "Kyle Pitts", position: "TE", team: "ATL", projectedStats: { rushYd: 0, rushTD: 0, rec: 80, recYd: 858, recTD: 3.2, fumLost: 0.3 }},
  { name: "Dallas Goedert", position: "TE", team: "PHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 71, recYd: 726, recTD: 5.7, fumLost: 0.4 }},
  { name: "Harold Fannin Jr.", position: "TE", team: "CLE", projectedStats: { rushYd: 21, rushTD: 0.3, rec: 84, recYd: 826, recTD: 3.2, fumLost: 0.6 }},
  { name: "Sam LaPorta", position: "TE", team: "DET", projectedStats: { rushYd: 0, rushTD: 0, rec: 78, recYd: 787, recTD: 5.4, fumLost: 0.4 }},
  { name: "George Kittle", position: "TE", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 74, recYd: 810, recTD: 5.6, fumLost: 0.4 }},
  { name: "Isaiah Likely", position: "TE", team: "NYG", projectedStats: { rushYd: 0, rushTD: 0, rec: 63, recYd: 683, recTD: 4.1, fumLost: 0.5 }},
  { name: "Tucker Kraft", position: "TE", team: "GB", projectedStats: { rushYd: 8, rushTD: 0.1, rec: 71, recYd: 818, recTD: 4.4, fumLost: 0.4 }},
  { name: "Travis Kelce", position: "TE", team: "KC", projectedStats: { rushYd: 0, rushTD: 0, rec: 74, recYd: 773, recTD: 4.5, fumLost: 0.5 }},
  { name: "Brenton Strange", position: "TE", team: "JAX", projectedStats: { rushYd: 0, rushTD: 0, rec: 59, recYd: 599, recTD: 4, fumLost: 0.4 }},
  { name: "Jake Ferguson", position: "TE", team: "DAL", projectedStats: { rushYd: 0, rushTD: 0, rec: 73, recYd: 598, recTD: 5.9, fumLost: 0.8 }},
  { name: "Dalton Kincaid", position: "TE", team: "BUF", projectedStats: { rushYd: 0, rushTD: 0, rec: 59, recYd: 697, recTD: 4.4, fumLost: 0.5 }},
  { name: "Juwan Johnson", position: "TE", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 63, recYd: 645, recTD: 2.8, fumLost: 0.6 }},
  { name: "Mark Andrews", position: "TE", team: "BAL", projectedStats: { rushYd: 35, rushTD: 0.7, rec: 58, recYd: 618, recTD: 7.1, fumLost: 0.5 }},
  { name: "Hunter Henry", position: "TE", team: "NE", projectedStats: { rushYd: 0, rushTD: 0, rec: 56, recYd: 629, recTD: 5.3, fumLost: 0.2 }},
  { name: "Dalton Schultz", position: "TE", team: "HOU", projectedStats: { rushYd: 0, rushTD: 0, rec: 60, recYd: 552, recTD: 3.1, fumLost: 0.4 }},
  { name: "Cade Otton", position: "TE", team: "TB", projectedStats: { rec: 45, recYd: 440, recTD: 2.3 }},
  { name: "Greg Dulcich", position: "TE", team: "MIA", projectedStats: { rushYd: 0, rec: 52, recYd: 580, recTD: 1.7, fumLost: 0.4 }},
  { name: "AJ Barner", position: "TE", team: "SEA", projectedStats: { rushYd: 18, rushTD: 0.5, rec: 45, recYd: 433, recTD: 3.6 }},
  { name: "Kenyon Sadiq", position: "TE", team: "NYJ", projectedStats: { rushYd: 0, rushTD: 0, rec: 61, recYd: 630, recTD: 4, fumLost: 0.4 }},
  { name: "Oronde Gadsden II", position: "TE", team: "LAC", projectedStats: { rushYd: 0, rushTD: 0, rec: 30, recYd: 322, recTD: 2.5, fumLost: 0.2 }},
  { name: "T.J. Hockenson", position: "TE", team: "MIN", projectedStats: { rushYd: 0, rushTD: 0, rec: 78, recYd: 639, recTD: 2.8, fumLost: 0.3 }},
  { name: "Pat Freiermuth", position: "TE", team: "PIT", projectedStats: { rushYd: 0, rushTD: 0, rec: 60, recYd: 603, recTD: 2.8, fumLost: 0.5 }},
  { name: "Chigoziem Okonkwo", position: "TE", team: "WAS", projectedStats: { rushYd: 0, rushTD: 0, rec: 56, recYd: 552, recTD: 2, fumLost: 0 }},
  { name: "Colby Parkinson", position: "TE", team: "LAR", projectedStats: { rec: 28, recYd: 292, recTD: 3.1, fumLost: 0.3 }},
  { name: "Mason Taylor", position: "TE", team: "NYJ", projectedStats: { rec: 32, recYd: 276, recTD: 1.4 }},
  { name: "Mike Gesicki", position: "TE", team: "CIN", projectedStats: { rec: 32, recYd: 313, recTD: 3.7 }},
  { name: "Evan Engram", position: "TE", team: "DEN", projectedStats: { rushYd: 0, rec: 47, recYd: 465, recTD: 2.2 }},
  { name: "David Njoku", position: "TE", team: "LAC", projectedStats: { rec: 40, recYd: 417, recTD: 3.9 }},
  { name: "Tyler Higbee", position: "TE", team: "LAR", projectedStats: { rec: 15, recYd: 154, recTD: 1.2 }},
  { name: "Theo Johnson", position: "TE", team: "NYG", projectedStats: { rec: 25, recYd: 269, recTD: 1.6 }},
  { name: "Terrance Ferguson", position: "TE", team: "LAR", projectedStats: { rushYd: 0, rushTD: 0, rec: 46, recYd: 580, recTD: 5.4, fumLost: 0.3 }},
  { name: "Gunnar Helm", position: "TE", team: "TEN", projectedStats: { rushYd: 0, rushTD: 0, rec: 58, recYd: 499, recTD: 3.3, fumLost: 0.4 }},
  { name: "Dawson Knox", position: "TE", team: "BUF", projectedStats: { rec: 25, recYd: 265, recTD: 2.8 }},
  { name: "Noah Fant", position: "TE", team: "NO", projectedStats: { rec: 17, recYd: 145, recTD: 0.8, fumLost: 0.1 }},
  { name: "Michael Mayer", position: "TE", team: "LV", projectedStats: { rec: 37, recYd: 364, recTD: 1.3 }},
  { name: "Will Kacmarek", position: "TE", team: "MIA", projectedStats: { rec: 18, recYd: 174, recTD: 0.8, fumLost: 0.1 }},
  { name: "Darnell Washington", position: "TE", team: "PIT", projectedStats: { rec: 31, recYd: 305, recTD: 1.9, fumLost: 0.3 }},
  { name: "Brock Wright", position: "TE", team: "DET", projectedStats: { rec: 8, recYd: 72, recTD: 0.6 }},
  { name: "Charlie Kolar", position: "TE", team: "LAC", projectedStats: { rushYd: 0, rec: 15, recYd: 149, recTD: 1.1 }},
  { name: "Marlin Klein", position: "TE", team: "HOU", projectedStats: { rec: 4, recYd: 36, recTD: 0.2, fumLost: 0 }},
  { name: "Erick All", position: "TE", team: "CIN", projectedStats: { rec: 26, recYd: 235, recTD: 1.9 }},
  { name: "Daniel Bellinger", position: "TE", team: "TEN", projectedStats: { rec: 13, recYd: 113, recTD: 0.5 }},
  { name: "Ben Sims", position: "TE", team: "MIA", projectedStats: { rec: 5.4, recYd: 50, recTD: 0.2 }},
  { name: "Eli Stowers", position: "TE", team: "PHI", projectedStats: { rec: 11, recYd: 107, recTD: 0.8, fumLost: 0.1 }},
  { name: "Josh Oliver", position: "TE", team: "MIN", projectedStats: { rec: 17, recYd: 151, recTD: 1.1 }},
  { name: "Davis Allen", position: "TE", team: "LAR", projectedStats: { rec: 8, recYd: 74, recTD: 0.7 }},
  { name: "Tommy Tremble", position: "TE", team: "CAR", projectedStats: { rec: 18, recYd: 177, recTD: 1.3 }},
  { name: "Adam Trautman", position: "TE", team: "DEN", projectedStats: { rec: 12, recYd: 113, recTD: 1 }},
  { name: "Ja'Tavion Sanders", position: "TE", team: "CAR", projectedStats: { rec: 20, recYd: 164, recTD: 1.1 }},
  { name: "Luke Musgrave", position: "TE", team: "GB", projectedStats: { rec: 18.4, recYd: 197, recTD: 0.8 }},
  { name: "Austin Hooper", position: "TE", team: "ATL", projectedStats: { rec: 21, recYd: 181, recTD: 0.8 }},
  { name: "Jeremy Ruckert", position: "TE", team: "NYJ", projectedStats: { rec: 12, recYd: 96, recTD: 0.5 }},
  { name: "Grant Calcaterra", position: "TE", team: "PHI", projectedStats: { rec: 16.1, recYd: 171, recTD: 0.8 }},
  { name: "Cole Kmet", position: "TE", team: "CHI", projectedStats: { rushYd: 0, rec: 22, recYd: 219, recTD: 1.7 }},
  { name: "Eli Raridon", position: "TE", team: "NE", projectedStats: { rec: 16, recYd: 151, recTD: 1.1, fumLost: 0.1 }},
  { name: "Nate Boerkircher", position: "TE", team: "JAX", projectedStats: { rec: 8, recYd: 74, recTD: 0.6, fumLost: 0.1 }},
  { name: "John Bates", position: "TE", team: "WAS", projectedStats: { rec: 14, recYd: 136, recTD: 1.2, fumLost: 0.1 }},
  { name: "Matthew Hibner", position: "TE", team: "BAL", projectedStats: { rec: 3, recYd: 36, recTD: 0.3 }},
  { name: "Elijah Higgins", position: "TE", team: "ARI", projectedStats: { rec: 21, recYd: 182, recTD: 0.7, fumLost: 0.2 }},
  { name: "Nate Adkins", position: "TE", team: "DEN", projectedStats: { rec: 8, recYd: 69, recTD: 0.7 }},
  // ── K (2026 game lines as of 2026-09-02, tools/rebaseline-k-def.mjs) ──
  { name: "Ka'imi Fairbairn", position: "K", team: "HOU", projectedStats: { fgMade: 31.4, fgMissed: 4.8, xpMade: 34.9, xpMissed: 1.5 }},
  { name: "Wil Lutz", position: "K", team: "DEN", projectedStats: { fgMade: 29.2, fgMissed: 5.4, xpMade: 37.6, xpMissed: 1.6 }},
  { name: "Jason Myers", position: "K", team: "SEA", projectedStats: { fgMade: 30.8, fgMissed: 5.2, xpMade: 41.8, xpMissed: 1.8 }},
  { name: "Harrison Mevis", position: "K", team: "LAR", projectedStats: { fgMade: 30.2, fgMissed: 4.9, xpMade: 48.5, xpMissed: 2.1 }},
  { name: "Will Reichard", position: "K", team: "MIN", projectedStats: { fgMade: 29.7, fgMissed: 4.7, xpMade: 36.4, xpMissed: 1.6 }},
  { name: "Jake Elliott", position: "K", team: "PHI", projectedStats: { fgMade: 28.2, fgMissed: 5.8, xpMade: 39.9, xpMissed: 1.7 }},
  { name: "Jake Bates", position: "K", team: "DET", projectedStats: { fgMade: 29.4, fgMissed: 4.8, xpMade: 46.3, xpMissed: 2 }},
  { name: "Chris Boswell", position: "K", team: "PIT", projectedStats: { fgMade: 29.4, fgMissed: 4.7, xpMade: 33.3, xpMissed: 1.5 }},
  { name: "Cameron Dicker", position: "K", team: "LAC", projectedStats: { fgMade: 31, fgMissed: 4.8, xpMade: 39.7, xpMissed: 1.7 }},
  { name: "Tyler Bass", position: "K", team: "BUF", projectedStats: { fgMade: 28.7, fgMissed: 5.2, xpMade: 45.3, xpMissed: 2 }},
  { name: "Tyler Loop", position: "K", team: "BAL", projectedStats: { fgMade: 29.7, fgMissed: 5.2, xpMade: 44.3, xpMissed: 1.9 }},
  { name: "Cairo Santos", position: "K", team: "CHI", projectedStats: { fgMade: 29.8, fgMissed: 4.8, xpMade: 41.6, xpMissed: 1.8 }},
  { name: "Nick Folk", position: "K", team: "ATL", projectedStats: { fgMade: 30.8, fgMissed: 4.4, xpMade: 37.2, xpMissed: 1.6 }},
  { name: "Andy Borregales", position: "K", team: "NE", projectedStats: { fgMade: 28.6, fgMissed: 5.1, xpMade: 41, xpMissed: 1.8 }},
  { name: "Spencer Shrader", position: "K", team: "IND", projectedStats: { fgMade: 30.9, fgMissed: 5.1, xpMade: 41.4, xpMissed: 1.8 }},
  { name: "Daniel Carlson", position: "K", team: "NO", projectedStats: { fgMade: 29.2, fgMissed: 5.4, xpMade: 35.4, xpMissed: 1.6 }},
  { name: "Trey Smack", position: "K", team: "GB", projectedStats: { fgMade: 29, fgMissed: 5.5, xpMade: 40.4, xpMissed: 1.8 }},
  { name: "Harrison Butker", position: "K", team: "KC", projectedStats: { fgMade: 30.1, fgMissed: 5.1, xpMade: 40.9, xpMissed: 1.8 }},
  { name: "Cam Little", position: "K", team: "JAX", projectedStats: { fgMade: 29.5, fgMissed: 4.7, xpMade: 39, xpMissed: 1.7 }},
  { name: "Andre Szmyt", position: "K", team: "CLE", projectedStats: { fgMade: 28.4, fgMissed: 5, xpMade: 27.9, xpMissed: 1.2 }},
  { name: "Evan McPherson", position: "K", team: "CIN", projectedStats: { fgMade: 30, fgMissed: 4.8, xpMade: 45.3, xpMissed: 2 }},
  { name: "Riley Patterson", position: "K", team: "MIA", projectedStats: { fgMade: 27.5, fgMissed: 4.6, xpMade: 30.6, xpMissed: 1.3 }},
  { name: "Matt Gay", position: "K", team: "LV", projectedStats: { fgMade: 26.1, fgMissed: 5.7, xpMade: 29.7, xpMissed: 1.3 }},
  { name: "Chase McLaughlin", position: "K", team: "TB", projectedStats: { fgMade: 29.9, fgMissed: 4.4, xpMade: 37.9, xpMissed: 1.7 }},
  { name: "Drew Stevens", position: "K", team: "WAS", projectedStats: { fgMade: 28.8, fgMissed: 5.4, xpMade: 39.4, xpMissed: 1.7 }},
  { name: "Dominic Zvada", position: "K", team: "NYG", projectedStats: { fgMade: 29.1, fgMissed: 5.1, xpMade: 35.8, xpMissed: 1.6 }},
  { name: "Ryan Fitzgerald", position: "K", team: "CAR", projectedStats: { fgMade: 26.2, fgMissed: 5.1, xpMade: 32.1, xpMissed: 1.4 }},
  { name: "Joey Slye", position: "K", team: "TEN", projectedStats: { fgMade: 28.2, fgMissed: 5, xpMade: 32.1, xpMissed: 1.4 }},
  { name: "Eddy Pineiro", position: "K", team: "SF", projectedStats: { fgMade: 30.6, fgMissed: 4.8, xpMade: 43, xpMissed: 1.9 }},
  { name: "Brandon Aubrey", position: "K", team: "DAL", projectedStats: { fgMade: 31.7, fgMissed: 5.2, xpMade: 44.4, xpMissed: 1.9 }},
  { name: "Chad Ryland", position: "K", team: "ARI", projectedStats: { fgMade: 27.1, fgMissed: 5.6, xpMade: 29.9, xpMissed: 1.3 }},
  { name: "Blake Grupe", position: "K", team: "NYJ", projectedStats: { fgMade: 28.2, fgMissed: 4.9, xpMade: 29.6, xpMissed: 1.3 }},
  // ── DEF (2026 game lines as of 2026-09-02, tools/rebaseline-k-def.mjs) ──
  { name: "Houston Texans", position: "DEF", team: "HOU", projectedStats: { sacks: 39.9, ints: 12, fumRec: 8.5, defTD: 1.5, safety: 0, ptsAllowed: 350 }},
  { name: "Denver Broncos", position: "DEF", team: "DEN", projectedStats: { sacks: 40.9, ints: 13, fumRec: 7.1, defTD: 1.5, safety: 0, ptsAllowed: 351 }},
  { name: "Seattle Seahawks", position: "DEF", team: "SEA", projectedStats: { sacks: 39.9, ints: 13, fumRec: 7.1, defTD: 1.5, safety: 0, ptsAllowed: 352 }},
  { name: "Los Angeles Rams", position: "DEF", team: "LAR", projectedStats: { sacks: 40.6, ints: 12, fumRec: 7.5, defTD: 1.5, safety: 0, ptsAllowed: 363 }},
  { name: "Minnesota Vikings", position: "DEF", team: "MIN", projectedStats: { sacks: 38.5, ints: 11, fumRec: 7.8, defTD: 1.4, safety: 0, ptsAllowed: 383 }},
  { name: "Philadelphia Eagles", position: "DEF", team: "PHI", projectedStats: { sacks: 38.8, ints: 12, fumRec: 7.1, defTD: 1.4, safety: 0, ptsAllowed: 356 }},
  { name: "Detroit Lions", position: "DEF", team: "DET", projectedStats: { sacks: 38.8, ints: 13, fumRec: 7.8, defTD: 1.6, safety: 0, ptsAllowed: 383 }},
  { name: "Pittsburgh Steelers", position: "DEF", team: "PIT", projectedStats: { sacks: 40.6, ints: 12, fumRec: 8.2, defTD: 1.5, safety: 0, ptsAllowed: 364 }},
  { name: "Los Angeles Chargers", position: "DEF", team: "LAC", projectedStats: { sacks: 39.2, ints: 13, fumRec: 7.5, defTD: 1.5, safety: 0, ptsAllowed: 372 }},
  { name: "Buffalo Bills", position: "DEF", team: "BUF", projectedStats: { sacks: 41.3, ints: 16, fumRec: 8.5, defTD: 1.8, safety: 0, ptsAllowed: 386 }},
  { name: "Baltimore Ravens", position: "DEF", team: "BAL", projectedStats: { sacks: 40.6, ints: 12, fumRec: 7.5, defTD: 1.5, safety: 0, ptsAllowed: 364 }},
  { name: "Chicago Bears", position: "DEF", team: "CHI", projectedStats: { sacks: 40.6, ints: 16, fumRec: 9.2, defTD: 1.8, safety: 0, ptsAllowed: 395 }},
  { name: "Atlanta Falcons", position: "DEF", team: "ATL", projectedStats: { sacks: 48.3, ints: 15, fumRec: 8.2, defTD: 1.7, safety: 0, ptsAllowed: 415 }},
  { name: "New England Patriots", position: "DEF", team: "NE", projectedStats: { sacks: 39.5, ints: 13, fumRec: 6.8, defTD: 1.5, safety: 0, ptsAllowed: 364 }},
  { name: "Indianapolis Colts", position: "DEF", team: "IND", projectedStats: { sacks: 39.2, ints: 13, fumRec: 8.5, defTD: 1.6, safety: 0, ptsAllowed: 415 }},
  { name: "New Orleans Saints", position: "DEF", team: "NO", projectedStats: { sacks: 44.1, ints: 14, fumRec: 8.9, defTD: 1.7, safety: 0, ptsAllowed: 404 }},
  { name: "Green Bay Packers", position: "DEF", team: "GB", projectedStats: { sacks: 39.5, ints: 12, fumRec: 7.1, defTD: 1.4, safety: 0, ptsAllowed: 381 }},
  { name: "Kansas City Chiefs", position: "DEF", team: "KC", projectedStats: { sacks: 39.5, ints: 12, fumRec: 7.1, defTD: 1.4, safety: 0, ptsAllowed: 362 }},
  { name: "Jacksonville Jaguars", position: "DEF", team: "JAX", projectedStats: { sacks: 39.5, ints: 13, fumRec: 7.1, defTD: 1.5, safety: 0, ptsAllowed: 384 }},
  { name: "Cleveland Browns", position: "DEF", team: "CLE", projectedStats: { sacks: 39.5, ints: 11, fumRec: 7.1, defTD: 1.4, safety: 0, ptsAllowed: 384 }},
  { name: "Cincinnati Bengals", position: "DEF", team: "CIN", projectedStats: { sacks: 41.6, ints: 13, fumRec: 9.2, defTD: 1.6, safety: 0, ptsAllowed: 402 }},
  { name: "Miami Dolphins", position: "DEF", team: "MIA", projectedStats: { sacks: 43.4, ints: 10, fumRec: 9.2, defTD: 1.5, safety: 0, ptsAllowed: 445 }},
  { name: "Las Vegas Raiders", position: "DEF", team: "LV", projectedStats: { sacks: 41.3, ints: 11, fumRec: 9.2, defTD: 1.5, safety: 0, ptsAllowed: 412 }},
  { name: "Tampa Bay Buccaneers", position: "DEF", team: "TB", projectedStats: { sacks: 39.9, ints: 12, fumRec: 6.4, defTD: 1.4, safety: 0, ptsAllowed: 397 }},
  { name: "Washington Commanders", position: "DEF", team: "WAS", projectedStats: { sacks: 42, ints: 11, fumRec: 7.8, defTD: 1.4, safety: 0, ptsAllowed: 428 }},
  { name: "New York Giants", position: "DEF", team: "NYG", projectedStats: { sacks: 39.2, ints: 11, fumRec: 8.5, defTD: 1.5, safety: 0, ptsAllowed: 419 }},
  { name: "Carolina Panthers", position: "DEF", team: "CAR", projectedStats: { sacks: 40.2, ints: 13, fumRec: 7.8, defTD: 1.6, safety: 0, ptsAllowed: 401 }},
  { name: "Tennessee Titans", position: "DEF", team: "TEN", projectedStats: { sacks: 43.7, ints: 10, fumRec: 8.9, defTD: 1.4, safety: 0, ptsAllowed: 426 }},
  { name: "San Francisco 49ers", position: "DEF", team: "SF", projectedStats: { sacks: 36.7, ints: 11, fumRec: 8.9, defTD: 1.5, safety: 0, ptsAllowed: 387 }},
  { name: "Dallas Cowboys", position: "DEF", team: "DAL", projectedStats: { sacks: 40.6, ints: 9, fumRec: 8.5, defTD: 1.4, safety: 0, ptsAllowed: 432 }},
  { name: "Arizona Cardinals", position: "DEF", team: "ARI", projectedStats: { sacks: 37.4, ints: 12, fumRec: 8.9, defTD: 1.6, safety: 0, ptsAllowed: 467 }},
  { name: "New York Jets", position: "DEF", team: "NYJ", projectedStats: { sacks: 37.4, ints: 12, fumRec: 7.5, defTD: 1.5, safety: 0, ptsAllowed: 410 }},

  { name: "Alvin Kamara", position: "RB", team: "NO", projectedStats: { rushYd: 451, rushTD: 2.1, rec: 33, recYd: 222, recTD: 0.9, fumLost: 0.6 }},
  { name: "Chris Bell", position: "WR", team: "MIA", projectedStats: { rushYd: 0, rushTD: 0, rec: 27, recYd: 357, recTD: 1.3, fumLost: 0.3 }},
  { name: "Stefon Diggs", position: "WR", team: "WAS", projectedStats: { rushYd: 0, rushTD: 0, rec: 71, recYd: 726, recTD: 3.4, fumLost: 0.5 }},
  { name: "Jack Bech", position: "WR", team: "LV", projectedStats: { rushYd: 0, rushTD: 0, rec: 28, recYd: 315, recTD: 1.2, fumLost: 0.3 }},
  { name: "Brandon Aiyuk", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 1, recYd: 3, recTD: 0, fumLost: 0 }},
  { name: "Tre' Harris", position: "WR", team: "LAC", projectedStats: { rushYd: 0, rushTD: 0, rec: 35, recYd: 411, recTD: 2.5, fumLost: 0.4 }},
  { name: "Tyreek Hill", position: "WR", team: "FA", projectedStats: { rushYd: 0, rushTD: 0, rec: 0, recYd: 0, recTD: 0, fumLost: 0 }},
  { name: "Savion Williams", position: "WR", team: "GB", projectedStats: { rushYd: 36, rushTD: 0.2, rec: 15.3, recYd: 177, recTD: 1.3, fumLost: 0.2 }},
  { name: "Chris Brazzell II", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rushTD: 0, rec: 21, recYd: 289, recTD: 3, fumLost: 0 }},
  { name: "Xavier Legette", position: "WR", team: "CAR", projectedStats: { rushYd: 11, rushTD: 0.1, rec: 36, recYd: 418, recTD: 2.6, fumLost: 0.4 }},
];

// ── X (Twitter) auto-post: Mon/Wed/Fri, one auction + one snake insight, cycling through
//    INSIGHTS_X_POOL. Requires X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
//    (OAuth 1.0a user-context tokens for @irontunafantasy with read+write access). See HANDOFF.md §10. ──
const X_TAGLINE = "The full breakdown is free, and Iron Tuna turns takes like this into live draft-day values for YOUR league's exact scoring.";
const X_HASHTAGS = { auction: '#FantasyFootball #AuctionDraft #FFDraft', snake: '#FantasyFootball #SnakeDraft #FFDraft', bestball: '#FantasyFootball #BestBall #FFDraft' };
const X_MAX_LEN = 280;

// ── Wednesday-only third post: money-allocation strategy and Value Coach promo content,
//    alternating. Hand-authored (not extracted from insight pages) and grounded in the copy on
//    /auction-budget-allocation, /auction-nomination-strategy, and /dollar-endgame-handcuffs. ──
const X_WED_TAGLINE = 'Iron Tuna prices every player for YOUR league and re-prices the whole board live while you draft. Free to start.';
const X_WED_HASHTAGS = '#FantasyFootball #AuctionDraft #DraftStrategy';
const X_STRATEGY_POSTS = [
  { id: 'strategy-0', type: 'strategy', text: "Our 2026 model: only 88 players project above replacement in a 12-team league, and RB+WR hold 86% of that value.\n\n💰 That's the math behind the winning $200 split: 38-42% RB, 28-32% WR, 10-14% QB, 8-10% TE. Decide your shape before the bidding decides it for you.", cta: 'Iron Tuna builds the split for YOUR league size and scoring, then re-prices every player live as the room spends. Free to start:', url: 'https://irontuna.com/auction-budget-allocation' },
  { id: 'strategy-1', type: 'strategy', text: "Stars-and-scrubs vs balanced is not a preference. It's a read.\n\n📊 The top 24 players hold 60% of all value over replacement in our model. If the room sells them at or under sheet price, concentrate your spend. The second they go over, the profit moves to the middle. Follow it.", cta: 'Iron Tuna shows you live, player by player, whether your room is overpaying or underpaying. That read is your whole strategy:', url: 'https://irontuna.com/auction-budget-allocation' },
  { id: 'strategy-2', type: 'strategy', text: "Jacksonville's backfield is still a three-man mix, and HC Liam Coen likes a rotation. Ambiguity like that is exactly why you never spend to $0 early.\n\n🎯 Our model has 11 RBs outside the top 30 projected for 150+ PPR points. The manager holding $15-20 late owns them.", cta: "Iron Tuna tracks what you should bid and every rival's remaining money all draft, so you know the moment the endgame values arrive:", url: 'https://irontuna.com/auction-budget-allocation' },
  { id: 'strategy-3', type: 'strategy', text: "Jayden Daniels rushed for 685.9 yards in just SEVEN games last season. Rushing floors have flattened the QB tier: our model puts 0.7 PPG between QB5 and QB12.\n\n🐟 Set at QB? Nominate the big names early. Rivals pay tier-1 money for tier-3 separation.", cta: 'Iron Tuna tells you who to nominate and when, based on what the room has left to spend. The full playbook is free:', url: 'https://irontuna.com/auction-nomination-strategy' },
  { id: 'strategy-4', type: 'strategy', text: "Mahomes says his repaired knee feels great and he is targeting Week 1, but KC's Walker and Fields additions cap the pass volume. Our research: -4% to -7% vs an elite tag.\n\n💵 Reputation names are your best early nominations: someone ALWAYS pays for the name. Make it a rival.", cta: 'Iron Tuna prices every player for your exact league, so you can tell sticker from tax in real time. Free to start:', url: 'https://irontuna.com/auction-nomination-strategy' },
  { id: 'strategy-5', type: 'strategy', text: "Garrett Wilson is a full participant after the knee injuries that wrecked his 2025. If his price still carries an injury discount, it dies the day camp reports go public.\n\n⏱️ Auctions reward timing over ranking. Nominate your discounted targets before the room reads the news.", cta: 'Iron Tuna re-prices the whole board live, so you see the discount window open before the rest of the room does:', url: 'https://irontuna.com/auction-nomination-strategy' },
  { id: 'strategy-6', type: 'strategy', text: "12 teams x 16 spots = 192 players drafted. Our model says only 88 of them project above replacement.\n\n🚫 The most you can REALLY bid is your budget minus $1 per open slot, because the endgame is a scrap over the other 104. Lose count mid-bidding-war and you're the one holding zombies.", cta: 'Iron Tuna does this math after every single bid, for you AND every rival. Nobody at the table knows the room better:', url: 'https://irontuna.com/dollar-endgame-handcuffs' },
  { id: 'strategy-7', type: 'strategy', text: "Nothing public has settled New England's Stevenson vs TreVeyon Henderson split, and that ambiguity suppresses both prices.\n\n🎰 That's the backfield you buy BOTH sides of for $1-2 each late. You're not predicting the winner. You're guaranteeing you roster him.", cta: 'The $1 endgame is where auctions are actually won. The full handcuff-pairs guide is a free read:', url: 'https://irontuna.com/dollar-endgame-handcuffs' },
];
const X_COACH_POSTS = [
  { id: 'coach-0', type: 'coach', text: "The 49ers signed Mike Evans AND Christian Kirk. One move: Purdy up 8-12% in our research, McCaffrey more TD-dependent, every SF pass-catcher re-priced.\n\n🤖 A chatbot doesn't track that, your budget, or your board. Iron Tuna's Value Coach carries all of it into your draft, live.", cta: 'Meet the Value Coach: an AI that answers about YOUR draft, not fantasy football in general. Try it free:', url: 'https://irontuna.com/' },
  { id: 'coach-1', type: 'coach', text: "Detroit hired Drew Petzing, whose Arizona scheme fed RBs through the air, traded David Montgomery, and Dan Campbell called Gibbs his bellcow. Our model: 71 catches.\n\n⚡ The Value Coach knows the WHY under every number, and re-prices all 408 players as your draft moves.", cta: "It's live in Iron Tuna right now, loaded with your league's scoring and budget the moment you set up your sheet:", url: 'https://irontuna.com/' },
  { id: 'coach-2', type: 'coach', text: 'Generic AI: "Bijan Robinson is a strong pick in most formats."\n\nIron Tuna\'s Value Coach: "You have $63 left, elite RB dries up in 6 players, and he\'s worth $58 to YOUR roster. Cap your bid at $61."\n\n🧠 One of these wins your league.', cta: 'Specific beats generic in every draft ever run. Ask the Value Coach something about your league:', url: 'https://irontuna.com/' },
  { id: 'coach-3', type: 'coach', text: "A.J. Brown to New England re-priced Maye, Henry, Doubs, and Stevenson in a single afternoon. Your draft moves values even faster than the news does.\n\n📈 Every sale shifts the fair price of the 400+ players left. The Value Coach re-prices the full pool after every single pick.", cta: 'Live values, live advice, zero tab-switching. See what a draft board with a brain feels like:', url: 'https://irontuna.com/' },
  { id: 'coach-4', type: 'coach', text: "Anyone can look smart at pick 5.\n\n🎓 Our model says just 88 players project above replacement in a 12-team league, so by pick 87 the sheet is stale, the tiers are gone, and the room is guessing. That's when an AI that re-priced the board 86 straight times earns its keep.", cta: "The Value Coach is sharpest exactly when you're most tired. That's the trade you want on draft night:", url: 'https://irontuna.com/' },
  { id: 'coach-5', type: 'coach', text: 'Stop alt-tabbing to a chatbot between picks.\n\n💬 Iron Tuna\'s Value Coach lives ON your board with your scoring, your budget, your roster, and the room\'s spending loaded. A generic chatbot knows none of those four numbers, and in an auction those four numbers ARE the draft.', cta: 'One screen, every answer, all draft long. Free to start:', url: 'https://irontuna.com/' },
  { id: 'coach-6', type: 'coach', url: 'https://irontuna.com/', customTweets: [
    'Mike Tyson: "Everyone has a plan until they get punched in the face."\n\n🥊 Auction drafts are the same. Build the plan that maximizes points per dollar, then adapt the second your guy goes $12 over budget. The plan is not the edge. The adjustment is.',
    "Iron Tuna re-values every player live, based on who's left and what you still need, the moment your plan takes a punch.\n\nhttps://irontuna.com/\n\n#FantasyFootball #AuctionDraft #DraftStrategy",
  ] },
];
// Comparison posts: price + feature contrasts vs. the default league-host draft kits (ESPN/Yahoo,
// free but static) and paid subscription rankers (e.g. FantasyPros MVP, $5.99+/mo billed on
// through every season) — angled at Iron Tuna's one-time $9.99, live re-pricing, and Value Coach.
const X_COMPARISON_AUCTION_POSTS = [
  { id: 'compare-auction-0', type: 'compare', image: '/social/compare-auction.png', text: "This week alone: Jayden Higgins tore his ACL and is out for the year, and Alvin Kamara's MCL sprain costs him at least a month.\n\n💵 ESPN and Yahoo's sheet still shows ONE frozen value per player. Iron Tuna re-prices 408 players live. $9.99 once.", cta: 'Live values vs. a frozen sheet is the biggest edge left in auction drafts. See yours free:', url: 'https://irontuna.com/' },
  { id: 'compare-auction-1', type: 'compare', image: '/social/compare-auction.png', text: "The going rate for 'premium' fantasy advice: $5.99 a month, billed all year, for rankings that update exactly 0 times during your draft.\n\n🤖 A 12-team auction re-prices itself roughly 192 times, once per sale. Iron Tuna keeps up with every one of them. $9.99, once.", cta: 'One draft-day mistake costs more than the tool that prevents it. $9.99, one time, all season:', url: 'https://irontuna.com/' },
  { id: 'compare-auction-2', type: 'compare', image: '/social/compare-auction.png', text: "Subscription math: $5.99 a month is $72 a year if you forget to cancel, billed whether you draft or not.\n\n💰 Iron Tuna made the opposite bet: $9.99 one time, and you own your custom values and the Value Coach all season. If we don't help you win, that's all we ever get.", cta: 'Custom league values, live re-pricing, and an AI coach for less than two months of the other guys:', url: 'https://irontuna.com/' },
  { id: 'compare-auction-3', type: 'compare', image: '/social/compare-auction.png', text: "A pre-draft cheat sheet is a guess about a room it has never met.\n\n📊 It doesn't know your scoring, your budget, or that a WR just went $14 over value, which shifts the fair price of every receiver left. Iron Tuna recalculates all 408 values live, around YOUR league.", cta: 'Set your scoring once and every number on the sheet becomes yours, not a national average:', url: 'https://irontuna.com/' },
];
// Mock Auction promos: mock snake drafts are everywhere, a real practice auction room is
// genuinely rare — that's the differentiation angle. Feature claims below are grounded in the
// MockAuction component in index.html: N-1 CPU managers (11 in the default 12-team room) drawn
// from distinct strategy archetypes (Hero RB, Zero RB, Hero WR, Robust RB, Elite TE),
// auto-nomination of the top remaining player, second-price winning (you pay $1 over the
// second-highest max), the user's own league budget/roster config, and final standings by
// projected starting-lineup points once your roster fills. Free behind an email gate.
const X_MOCK_AUCTION_POSTS = [
  { id: 'mock-0', type: 'mock', text: "Most managers' first live auction bid of 2026 will be in their REAL draft, with real money and no do-overs.\n\n🏋️ Iron Tuna's free Mock Auction fixes that: 11 CPU managers, live bidding, your league's exact budget and roster. Rehearse draft night before it counts.", cta: 'Your first bidding war of the year should cost you nothing. Run a free mock now:', url: 'https://irontuna.com/auctiondraft' },
  { id: 'mock-1', type: 'mock', text: "Practice against a room that fights back. Iron Tuna's Mock Auction fields 11 CPU managers running distinct builds: Hero RB, Zero RB, Hero WR, Robust RB, Elite TE.\n\n🤼 Learn how each archetype bids against you BEFORE somebody runs it at you for real money.", cta: 'Every archetype you\'ll face on draft night, ready to spar. Free to run:', url: 'https://irontuna.com/auctiondraft' },
  { id: 'mock-2', type: 'mock', text: "Auction 101 nobody practices: you don't pay your top bid, you pay $1 more than the second-highest. Iron Tuna's Mock Auction prices every win exactly that way.\n\n💵 Practice finding the line between 'stole him' and 'blew the plan'. Free, in your browser, on your league's settings.", cta: 'Bid discipline is a muscle. The Mock Auction is the gym:', url: 'https://irontuna.com/auctiondraft' },
  { id: 'mock-3', type: 'mock', text: "A mock without a scoreboard is just clicking. Iron Tuna's Mock Auction finishes the room when your roster fills, then shows final standings by projected starting-lineup points.\n\n📊 You don't just get reps. You find out whether your plan would have WON the room.", cta: 'Practice with a scoreboard. See where you would have placed:', url: 'https://irontuna.com/auctiondraft' },
  { id: 'mock-4', type: 'mock', text: "Free mock SNAKE drafts are everywhere. A real mock AUCTION room is almost impossible to find.\n\n🐟 Iron Tuna built one: auto-nominations, 11 CPU bidders with different strategies, your exact budget and roster, and final standings when it ends. Free with an email.", cta: 'The rarest practice room in fantasy football, free with an email:', url: 'https://irontuna.com/auctiondraft' },
];
// Interleaved so consecutive Wednesdays cycle topics: strategy, coach, compare, mock, strategy, …
const X_WEDNESDAY_POOL = [];
for (let i = 0; i < Math.max(X_STRATEGY_POSTS.length, X_COACH_POSTS.length, X_COMPARISON_AUCTION_POSTS.length, X_MOCK_AUCTION_POSTS.length); i++) {
  if (X_STRATEGY_POSTS[i]) X_WEDNESDAY_POOL.push(X_STRATEGY_POSTS[i]);
  if (X_COACH_POSTS[i]) X_WEDNESDAY_POOL.push(X_COACH_POSTS[i]);
  if (X_COMPARISON_AUCTION_POSTS[i]) X_WEDNESDAY_POOL.push(X_COMPARISON_AUCTION_POSTS[i]);
  if (X_MOCK_AUCTION_POSTS[i]) X_WEDNESDAY_POOL.push(X_MOCK_AUCTION_POSTS[i]);
}

// ── Tuesday/Thursday third post: snake-draft "survival odds" feature promo — knowing who'll
//    still be on the board several rounds out is worth more than a static ranking, and the AI
//    navigator recalculates that live off actual draft progress (ADP, position runs, picks-to-go).
const X_SNAKE_HASHTAGS = '#FantasyFootball #SnakeDraft #DraftStrategy';
const X_SNAKE_FEATURE_POSTS = [
  { id: 'snake-feature-0', type: 'snake-feature', text: "Round 2 picks itself. Your league gets won in rounds 4-6, on one question: does he make it back to me?\n\n🔮 Our survival model: a player with ADP 45 lasts 12 more picks just 17% of the time. ADP 58? 74%. Iron Tuna computes this live for every player, after every pick.", cta: 'Stop guessing who makes it back. Know it, pick by pick, free to start:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-1', type: 'snake-feature', text: "Since June: Dan Campbell named Gibbs his bellcow, David Montgomery got traded, A.J. Brown became a Patriot, Arizona released Kyler Murray.\n\n📡 A printed sheet is stale before pick 1 and dead by pick 8. Iron Tuna re-forecasts who survives to your next turn after every selection.", cta: 'A live board that updates with your real draft beats a printout every single time:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-2', type: 'snake-feature', text: "Two ways to butcher a snake draft:\n\n1. Reach for a player who'd have come back.\n2. Wait a round on one who never did.\n\n🎯 Both are the same mistake: guessing survival odds. Our model gives ADP 40 a 3% shot at lasting 12 picks. ADP 58, 74%. Iron Tuna shows which is which, live.", cta: "Every 'can I wait on him?' has an actual number. Here it is, free:", url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-3', type: 'snake-feature', text: "Position runs don't announce themselves. Three RBs go in five picks and suddenly you're on the wrong side of a cliff: our model has 3.3 PPG between RB18 and RB30.\n\n🌊 Iron Tuna watches what every roster ahead of you needs and flags the run BEFORE it wipes the tier.", cta: "See the run coming while there's still time to do something about it:", url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-4', type: 'snake-feature', text: "Jaxon Smith-Njigba: 35.7% target share on 162 targets in 2025, and Seattle added zero competition for it. Volume that safe does not survive the turn.\n\n♟️ Iron Tuna models what every roster ahead of you needs and the odds each player makes it back to your pick. Stop hoping. Know.", cta: "Snake drafts are chess. Iron Tuna counts the other side's pieces for you:", url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-5', type: 'snake-feature', text: "Static rankings answer the wrong question. 'Who's good?' was settled in July.\n\n🧮 The draft asks: who's still here in 22 picks? Iron Tuna runs a live simulation of YOUR draft, re-run after every one of the ~190 real picks, so the answer is never a day stale.", cta: 'A mock draft that never stops running, inside your real one. Free to start:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-6', type: 'snake-feature', text: "'Best player available' is a trap.\n\n⚖️ Our 2026 model: RB12 to RB24 falls 3.1 PPG, WR12 to WR24 just 1.9. The RB tier won't wait for you. The WR tier will. Iron Tuna computes exactly that gap, live, and tells you which pick can't come back to you.", cta: "Value isn't who's best. It's who won't wait. Let the math break the tie:", url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-feature-7', type: 'snake-feature', text: 'Type any player and a round number. Get the real odds he\'s still there when you pick: ADP 33 with your pick 8 away is a 6% survival, not a "probably".\n\n🔢 Built from live ADP, the picks already made in YOUR draft, and position-run detection. No more guessing.', cta: 'The Will-He-Be-Available tool is free to try right now:', url: 'https://irontuna.com/snakedraft' },
];
const X_COMPARISON_SNAKE_POSTS = [
  { id: 'compare-snake-0', type: 'compare', image: '/social/compare-snake.png', text: "Sleeper and ESPN give you a great free draft room and a ranking list that's stale by round 2.\n\n🔮 Neither shows the number that actually decides picks: survival odds. Iron Tuna computes them for all 408 players in our pool, updated after every selection. Free to start.", cta: 'Keep your draft room. Add the one number it never shows you:', url: 'https://irontuna.com/snakedraft' },
  { id: 'compare-snake-1', type: 'compare', image: '/social/compare-snake.png', text: "A chatbot doesn't know pick 34 just happened. A $6/month ranking site updates exactly 0 times during your draft.\n\n🤖 Iron Tuna's Value Coach watches your actual board and answers about YOUR next pick. Free to start, $9.99 once for full custom scoring.", cta: 'Draft advice is only worth something if it knows your draft:', url: 'https://irontuna.com/snakedraft' },
  { id: 'compare-snake-2', type: 'compare', image: '/social/compare-snake.png', text: "Premium fantasy rankings run $30-70 a year. Every year. Forever.\n\n💰 Iron Tuna's full custom board (your league's exact scoring, live survival odds, and the Value Coach) is $9.99 once. Spread over a 17-week season, that's 59 cents a week for your edge.", cta: "Pay once, draft sharper in every league you're in:", url: 'https://irontuna.com/snakedraft' },
  { id: 'compare-snake-3', type: 'compare', image: '/social/compare-snake.png', text: "Most 'custom rankings' tools make you pay before you see a single number.\n\n🆓 Iron Tuna's cheat sheet is free: all 408 players, priced for a standard league, no signup, no email, no card. Pay $9.99 once only if you want it tuned to YOUR league and live on draft day.", cta: 'The free sheet is one click away. See it before you spend a dollar:', url: 'https://irontuna.com/snakedraft' },
];
// ── 'Later-round discounts' series: draft the early rounds differently when you know what
// will be discounted in the later rounds. Every post leads with player-specific calls; every
// number is a full-PPR season projection (or build-path sum of them) from the live PROJECTIONS
// data, printed by tools/compute-tweet-stats.mjs ("Later-round discounts, player-specific"
// section). ADPs quoted are the model's own VOR board ranks (the site's provisional-ADP
// ordering), and build sums add the displayed rounded values so tweet arithmetic checks out.
// Football facts quoted from this repo's Auction Watch pages (Kraft: 2026-06-19,
// Tuten: 2026-07-11), never from memory. Runs as a consecutive 6-part series once the
// interleaved feature/compare rotation completes (appended after the interleave below, which
// also keeps existing rotation indices stable).
const X_SNAKE_DISCOUNT_POSTS = [
  { id: 'snake-discount-0', type: 'snake-discount', text: "The 1.01 is not Gibbs vs Ja'Marr Chase. It's two builds.\n\n🧮 Our model: Chase (337 pts) + Kenneth Walker III (274) + Chase Brown (259) at the turn = 870. Gibbs (373) beats that only if a WR like Garrett Wilson (263) survives 23 picks. The first pick depends on the late board.", cta: "Iron Tuna's live prediction engine re-prices both builds in real time, reading who's off the board and what every opponent still needs. See your draft's future first:", url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-discount-1', type: 'snake-discount', text: "Planning your 1.01 around round 2-3 discounts? Get the odds first.\n\n🔮 Our survival model: Chase Brown (259 pts, ADP 25) reaches the 1.01 turn 60% of the time. Kenneth Walker III (274, ADP 17)? About 1%. Same plan, wildly different odds. Both numbers move with every pick made.", cta: 'The live engine re-forecasts every survival number after each pick, from who is gone and what the rosters ahead of you still need. Visibility into the future, free to start:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-discount-2', type: 'snake-discount', text: "Don't draft Jayden Daniels in the early rounds. Specifics:\n\n📉 Our model: Daniels 309 pts, Trevor Lawrence 297, rounds cheaper. Lawrence + Kenneth Walker III (274) = 571. Daniels + Bhayshul Tuten (208, the RB left where Lawrence goes) = 517. Same two spots, 54 points apart.", cta: 'The QB discount funds a whole extra starter. Iron Tuna\'s engine tracks which QBs and RBs survive, updating in real time as opponents fill roster slots:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-discount-3', type: 'snake-discount', text: "Skip mid-round tight ends. Our model: Sam LaPorta 197 pts, Tucker Kraft 176. That gap: 1.2 PPG.\n\n💸 Kraft was the TE4 before his injury and expects to be ready Week 1 after opening camp on PUP. Pay up for Trey McBride (247) or take Kraft near TE12 prices. The middle is dead.", cta: 'Tier math exposes the fake discounts too. The live engine reads which opponents still need a TE and tells you if Kraft makes it back to your pick:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-discount-4', type: 'snake-discount', text: "Committee fear is a coupon. Jaguars HC Liam Coen praises Bhayshul Tuten (208 pts in our model), but three-back talk keeps him at RB24 prices.\n\n📊 Deeper: Aaron Jones 190, Jaylen Warren 187, Rico Dowdle 185, all RB31 or later. The RB bin restocks late. Spend rounds 1-3 on WRs.", cta: '11 RBs outside the top 30 project 150+ points. Iron Tuna\'s engine updates their availability in real time as backfields come off the board:', url: 'https://irontuna.com/snakedraft' },
  { id: 'snake-discount-5', type: 'snake-discount', text: "Draft the early rounds backwards. Price discounts first:\n\n📈 Trevor Lawrence (297 pts) makes early QBs a luxury. Tucker Kraft (176) kills the mid-round TE. Aaron Jones (190) waits in double-digit rounds. Each discount you trust frees an early pick for Chase, Gibbs, or Puka (351).", cta: 'Know the late board, then draft the early one. The live prediction engine rebuilds the future after every pick: who is gone, who each opponent still needs, who reaches you:', url: 'https://irontuna.com/snakedraft' },
];
// Interleaved so Tue/Thu cycle topics: feature, compare, feature, compare, … then the
// discount series runs back-to-back as a themed 6-parter at the end of the cycle.
const X_SNAKE_BONUS_POOL = [];
for (let i = 0; i < Math.max(X_SNAKE_FEATURE_POSTS.length, X_COMPARISON_SNAKE_POSTS.length); i++) {
  if (X_SNAKE_FEATURE_POSTS[i]) X_SNAKE_BONUS_POOL.push(X_SNAKE_FEATURE_POSTS[i]);
  if (X_COMPARISON_SNAKE_POSTS[i]) X_SNAKE_BONUS_POOL.push(X_COMPARISON_SNAKE_POSTS[i]);
}
for (const p of X_SNAKE_DISCOUNT_POSTS) X_SNAKE_BONUS_POOL.push(p);

// ── Friday-only bonus post: best ball is a genuinely separate, less common format, so this
//    fires far less often than the others (1x/week vs. daily auction/snake and 2-3x/week Wed
//    /Tue/Thu bonus) — a handful of feature posts sprinkled among the extracted best-ball
//    insights, grounded in the real ceiling/stack/championship-week copy on /bestball and
//    /best-ball-stacking-guide. ──
const X_BESTBALL_FEATURE_POSTS = [
  { id: 'bestball-feature-0', type: 'bestball-feature', text: "George Pickens lives on deep targets and draws a tough schedule: quiet weeks and eruption weeks in bunches. Managed leagues must guess which is coming. Best ball harvests the spikes automatically.\n\n🎯 That's why Iron Tuna ranks by TRUE CEILING, not season average. Free to start.", cta: "Ceiling-first best ball values, built for the format you're actually playing. Free to start:", url: 'https://irontuna.com/bestball' },
  { id: 'bestball-feature-1', type: 'bestball-feature', text: "In our 2026 projections, a QB's top two pass-catchers account for 53% of his passing yards. That's why stacks win tournaments: one throw, two scores on your roster.\n\n📈 Iron Tuna lights up correlated stack partners live on your board the instant your QB lands.", cta: "Stacks flag themselves the moment they're available. Watch it happen on your own board:", url: 'https://irontuna.com/bestball' },
  { id: 'bestball-feature-2', type: 'bestball-feature', text: "Schedule analysis flags potential SNOW at Lambeau when Buffalo, Miami, and Houston visit late in the year. Snow compresses passing and feeds the run game, landing right on championship week.\n\n🏆 Weeks 15-17 decide the money. Iron Tuna weights every player's schedule toward them.", cta: 'Draft for the weeks that pay. The championship-week weighting is built in:', url: 'https://irontuna.com/bestball' },
  { id: 'bestball-feature-3', type: 'bestball-feature', text: "The Rams close on a very hard slate. In weekly-start leagues that's a playoff problem. In best ball it barely dents Puka: his down weeks bench themselves.\n\n🏈 Same player, two different values. Relabeled redraft rankings can't see that. Iron Tuna re-weights 408 players for it.", cta: 'Built for best ball from the ground up, not reskinned. See the difference:', url: 'https://irontuna.com/bestball' },
];

// ── Monday-only bonus post: a poll. Polls get outsized engagement relative to broadcast posts
//    and early engagement is what earns algorithmic distribution, so the week opens with one.
//    Every fact below is sourced from this repo's own post copy / drop pages (same sourcing rule
//    as the other hand-authored pools, HANDOFF §10) and every option is ≤25 chars (X's limit).
//    X-only: the Threads API has no poll support, so the Threads mirror skips this slot. ──
const X_POLL_POSTS = [
  { id: 'poll-0', type: 'poll', text: "Rushing floors have flattened the QB tier: our 2026 model puts 0.7 PPG between QB5 and QB12.\n\n🗳️ What's your QB plan in a 12-team draft this year?", options: ['Pay up for elite', 'Wait for the mid tier', 'Last-dollar QB', 'Two cheap QBs'], cta: "There's no wrong answer, only wrong prices. Iron Tuna prices every QB for your league's exact scoring, live during your draft." },
  { id: 'poll-1', type: 'poll', text: "Our model: RB12 to RB24 falls 3.1 PPG. WR12 to WR24 falls just 1.9.\n\n🗳️ Which position do you lock up first on draft day?", options: ['RB, beat the cliff', 'WR, safer floors', 'Best value up top', 'Elite TE first'], cta: 'The tier math changes with your scoring. Iron Tuna computes the real gaps for YOUR league and flags which tier won\'t wait for you.' },
  { id: 'poll-2', type: 'poll', text: "Nothing public has settled New England's backfield, and that ambiguity suppresses both prices.\n\n🗳️ Who finishes 2026 as the Patriots RB to own?", options: ['Stevenson', 'TreVeyon Henderson', 'True committee', 'Neither, fade both'], cta: 'Ambiguous backfields are where late-draft profit lives. Iron Tuna prices both sides of every committee, live on your board.' },
  { id: 'poll-3', type: 'poll', text: "Patrick Mahomes is on track for Week 1 after knee surgery, and our model still prices him -4% to -7% versus an elite-QB tag.\n\n🗳️ What do you do when he's nominated?", options: ['Pay the name', 'Only at a discount', 'Hard pass', 'Depends on the room'], cta: 'Reputation names are where auction money goes to die. Iron Tuna tells you sticker from tax in real time.' },
  { id: 'poll-4', type: 'poll', text: "Jaxon Smith-Njigba: 35.7% target share on 162 targets in 2025, and Seattle added zero competition for it.\n\n🗳️ Where does he go in your PPR snake draft?", options: ['Top 5 pick', 'Back half of Rd 1', 'Round 2', 'Regression incoming'], cta: 'Volume is the argument. The turn is the risk. Iron Tuna gives you his survival odds at your exact pick, live.' },
  { id: 'poll-5', type: 'poll', text: "The top 24 players hold 60% of all value over replacement in our 2026 model.\n\n🗳️ How do you spend your $200 auction budget?", options: ['Stars and scrubs', 'Balanced build', 'Read the room', 'Punt the studs'], cta: "It's a read, not a preference. Iron Tuna shows you live whether your room is overpaying the top or the middle." },
];
// Poll hook is a {text, poll} object (postTweet turns t.poll into the v2 API's poll body);
// the cta rides as a plain-text reply. No URL and no hashtags anywhere, so nothing to strip.
function composePollThread(post) {
  return [{ text: post.text, poll: { options: post.options, duration_minutes: 1440 } }, post.cta];
}

// Each post carries its own `cta` reply line (falling back to the shared tagline) — this keeps
// the reply copy tailored to the hook AND makes every reply's text unique, which matters because
// X permanently rejects exact-duplicate tweets. Neither the URL nor the hashtag line ever
// reaches X (toXCopy() removes both in postAndLog, per the Aug 2026 no-links/no-hashtags-on-X
// decision), so the per-post cta text is the only thing keeping X replies distinct across
// posts; Threads still receives the full reply.
function composeBonusThread(post, hashtags) {
  if (post.customTweets) return post.customTweets;
  const reply = `${post.cta || X_WED_TAGLINE}\n\n${post.url}\n\n${hashtags || X_WED_HASHTAGS}`;
  return [post.text, reply];
}
function composeWednesdayThread(post) { return composeBonusThread(post, X_WED_HASHTAGS); }
function composeSnakeFeatureThread(post) { return composeBonusThread(post, X_SNAKE_HASHTAGS); }
// Extracted insights (from INSIGHTS_X_POOL) carry a 'play' key even when empty; hand-authored
// feature posts never do — that's the dispatch signal between the two composers.
function composeBestballThread(item) {
  return ('play' in item) ? composeThread(item) : composeBonusThread(item, X_HASHTAGS.bestball);
}

// Maps UTC day-of-week (matches the cron's day field) to that day's bonus third post.
// `dynamicPool()` (Friday) is resolved fresh per run, same as poolFor() elsewhere, so newly
// unlocked best-ball drop pages become eligible immediately rather than at deploy time.
const X_BONUS_DAY_POOLS = {
  1: { pool: X_POLL_POSTS, compose: composePollThread, format: 'poll' }, // Mon
  2: { pool: X_SNAKE_BONUS_POOL, compose: composeSnakeFeatureThread, format: 'snakefeature' }, // Tue
  3: { pool: X_WEDNESDAY_POOL, compose: composeWednesdayThread, format: 'wednesday' }, // Wed
  4: { pool: X_SNAKE_BONUS_POOL, compose: composeSnakeFeatureThread, format: 'snakefeature' }, // Thu
  5: { // Fri
    dynamicPool: () => {
      const insights = poolFor('bestball');
      const merged = [];
      for (let i = 0; i < Math.max(insights.length, X_BESTBALL_FEATURE_POSTS.length); i++) {
        if (insights[i]) merged.push(insights[i]);
        if (X_BESTBALL_FEATURE_POSTS[i]) merged.push(X_BESTBALL_FEATURE_POSTS[i]);
      }
      return merged;
    },
    compose: composeBestballThread,
    format: 'bestball',
  },
};

function truncate(str, budget) {
  if (str.length <= budget) return str;
  return str.slice(0, Math.max(0, budget - 1)).replace(/\s+\S*$/, '') + '…';
}

// "2026-07-16" → "Jul 16, 2026" for the reply tweet's "Insight N of 5 in the … drop" line.
const DROP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dropLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  return m ? `${DROP_MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : 'latest';
}

// Two-tweet thread instead of one: tweet 1 is the hook + the insight's actual takeaway (not
// just the headline), tweet 2 (a reply) carries the tagline/link/hashtags. A single tweet can't
// fit both the headline and the substance of "deep insight" content within 280 chars.
function composeThread(insight) {
  const hashtags = X_HASHTAGS[insight.format] || '#FantasyFootball';
  // Hook = title + 📊 projected-effect stat + 💡 play verdict. The stat (extracted from the drop
  // page's "Projected effect:" statline) is the hard number that makes the tweet data-first; it's
  // included whenever the full trio fits in 280 and dropped (never truncated mid-number) when it
  // doesn't — a chopped stat is worse than no stat. The play verdict outranks the stat.
  const playPart = insight.play ? insight.play.length + 5 : 0; // "\n\n💡 "
  const statPart = insight.stat ? insight.stat.length + 5 + 18 : 0; // "\n\n📊 " + "Projected effect: "
  const titleBudget = Math.max(90, X_MAX_LEN - 3 - playPart);  // "🏈 " prefix
  const title = truncate(insight.title, titleBudget);
  let hook = `🏈 ${title}`;
  if (insight.stat && hook.length + statPart + playPart <= X_MAX_LEN) {
    hook += `\n\n📊 Projected effect: ${insight.stat}`;
  }
  if (insight.play) {
    const playBudget = X_MAX_LEN - hook.length - 5; // "\n\n💡 "
    if (playBudget > 15) hook += `\n\n💡 ${truncate(insight.play, playBudget)}`;
  }
  // "Insight N of 5 in the <date> <format> drop" both sells the click (four more takes in the
  // drop) and keeps every reply's X text unique per insight — X permanently 403s exact-duplicate
  // tweets, and since the URL and hashtag lines are both stripped before posting to X (see
  // toXCopy in postAndLog), index + drop date + format word must carry uniqueness on their own.
  // The format word matters: auction and snake drops share dates, so without it two same-index
  // insights on one date would collide. The year is included so future seasons can't collide.
  const idx = String(insight.id || '').match(/-(\d+)$/);
  const formatWord = insight.format === 'bestball' ? 'best ball' : insight.format;
  const lead = idx
    ? `Insight ${Number(idx[1]) + 1} of 5 in the ${dropLabel(insight.date)} ${formatWord} drop. ${X_TAGLINE}`
    : X_TAGLINE;
  const reply = `${lead}\n\n${insight.url}\n\n${hashtags}`;
  return [hook, reply];
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function oauth1Signature(method, url, params, consumerSecret, tokenSecret) {
  const base = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(
    Object.keys(params).sort().map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&')
  )}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function xApiCall(env, method, url, extraParams) {
  const oauthParams = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
    ...(extraParams || {}), // only for query-string params (GET/DELETE); JSON POST bodies are never part of the OAuth1.0a signature base
  };
  const signature = await oauth1Signature(method, url, oauthParams, env.X_API_SECRET, env.X_ACCESS_TOKEN_SECRET);
  const signed = { ...oauthParams, oauth_signature: signature };
  const authHeader = 'OAuth ' + Object.keys(signed).sort().map(k => `${percentEncode(k)}="${percentEncode(signed[k])}"`).join(', ');
  return authHeader;
}

async function postTweet(env, tweet, replyToId, mediaId) {
  const url = 'https://api.twitter.com/2/tweets';
  const authHeader = await xApiCall(env, 'POST', url);
  const t = typeof tweet === 'string' ? { text: tweet } : tweet;
  const body = { text: t.text };
  if (t.poll) body.poll = t.poll;
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  if (mediaId) body.media = { media_ids: [mediaId] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {}; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

// Comparison-card graphics live as static site assets (/social/compare-*.png) so the Worker can
// read the bytes straight from its own ASSETS binding instead of an external fetch.
async function fetchAssetBytes(env, path) {
  if (!env.ASSETS) return null;
  try {
    const res = await env.ASSETS.fetch(new Request('https://irontuna.com' + path));
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) { return null; }
}

// X media upload is v1.1-only. Sent as multipart/form-data (not x-www-form-urlencoded), so per
// OAuth1.0a spec the body is NOT part of the signature base — same signer as the v2 JSON calls.
async function uploadMedia(env, bytes, mimeType) {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const authHeader = await xApiCall(env, 'POST', url);
  const form = new FormData();
  form.append('media', new Blob([bytes], { type: mimeType }), 'card.png');
  const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader }, body: form });
  let data = {}; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

async function postThread(env, tweets, mediaId) {
  const posted = [];
  let replyToId = undefined;
  for (let i = 0; i < tweets.length; i++) {
    const res = await postTweet(env, tweets[i], replyToId, i === 0 ? mediaId : undefined);
    posted.push(res);
    if (!res.ok) break; // don't post the reply if the hook tweet failed
    replyToId = res.data && res.data.data && res.data.data.id;
  }
  return posted;
}

async function deleteTweet(env, id) {
  const url = `https://api.twitter.com/2/tweets/${id}`;
  const authHeader = await xApiCall(env, 'DELETE', url);
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: authHeader } });
  let data = {}; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

async function postedCount(env, format) {
  if (!env.LEADS_DB) return 0;
  // Only successful posts advance the rotation — a transient failure logs an ok=0 row,
  // and counting it would permanently skip that insight until the pool wraps.
  try { const row = await env.LEADS_DB.prepare('SELECT COUNT(*) AS n FROM x_posts WHERE format=? AND ok=1').bind(format).first(); return (row && row.n) || 0; } catch (e) { return 0; }
}

function poolFor(format) {
  // Match the drop pages' 13:00 UTC unlock (see the 302 gate in fetch()), not just the
  // calendar date — a manual x-post-now before 13:00 UTC on a drop date must not tweet
  // a URL that still redirects to the format index.
  return INSIGHTS_X_POOL.filter(p => {
    if (p.format !== format) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date || '');
    if (!m) return false;
    return Date.now() >= Date.UTC(+m[1], +m[2] - 1, +m[3], 13, 0, 0);
  });
}

async function textHash(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// X rejects exact-duplicate tweet text account-wide, forever — not just within one run, and not
// scoped to a format (two public drop pages sometimes share the exact same headline+takeaway).
// Walk the pool forward from the rotation index until the composed hook tweet doesn't collide
// with anything already posted successfully.
async function pickNonDuplicate(env, pool, startIdx, composeFn) {
  if (!pool.length) return null;
  let idx = startIdx % pool.length;
  for (let attempts = 0; attempts < pool.length; attempts++) {
    const item = pool[idx];
    const tweets = composeFn(item);
    const hash = await textHash(tweetText(tweets[0]));
    let dup = false;
    if (env.LEADS_DB) {
      try { dup = !!(await env.LEADS_DB.prepare('SELECT 1 FROM x_posts WHERE text_hash=? AND ok=1').bind(hash).first()); } catch (e) {}
    }
    if (!dup) return { item, tweets, hash };
    idx = (idx + 1) % pool.length;
  }
  // Every item in the currently-eligible pool has already been tweeted verbatim — this happens
  // when a format's dated content is identical to another format's (early drop pages reuse the
  // same title+takeaway across auction/snake) and the small early pool gets fully cycled before
  // the next drop date unlocks. X would reject a repost with a 403 anyway, so skip the slot for
  // today rather than burning an API call on a guaranteed failure; it resolves itself once more
  // dates unlock.
  return null;
}

// X's pay-per-use pricing (as of July 2026): $0.015 for a plain post, $0.20 for a post
// containing a link — a post is only billed if it's actually created, so a rejected duplicate
// (never created) costs nothing. This is an estimate for budget tracking, not an authoritative
// billing figure — check the X developer console's Credits page for the real balance.
function tweetCost(text) {
  return /https?:\/\//.test(text) ? 0.20 : 0.015;
}

// ── Threads auto-post: mirrors whatever content X posted (same picks, same run), so both
//    platforms carry the same message the same day rather than running a second independent
//    rotation. Requires THREADS_ACCESS_TOKEN (initial long-lived token) + THREADS_USER_ID.
//    Free API (no per-post charge, unlike X), 500-char limit (well above anything we compose),
//    and images post via a plain URL (env.ASSETS + irontuna.com serving them publicly) instead
//    of X's separate multipart upload step. See HANDOFF.md §11. ──
const THREADS_API = 'https://graph.threads.net/v1.0';

async function getThreadsAccessToken(env) {
  if (env.LEADS_DB) {
    try {
      const row = await env.LEADS_DB.prepare('SELECT access_token FROM threads_token ORDER BY id DESC LIMIT 1').first();
      if (row && row.access_token) return row.access_token;
    } catch (e) {}
  }
  return env.THREADS_ACCESS_TOKEN;
}

// Long-lived Threads tokens expire in 60 days and cannot be refreshed after expiry, and a Worker
// can't rewrite its own secret at runtime — so the live token lives in D1 (seeded from the
// THREADS_ACCESS_TOKEN secret on first use) and gets refreshed there well before expiry.
async function maybeRefreshThreadsToken(env) {
  if (!env.LEADS_DB) return;
  let row = null;
  try { row = await env.LEADS_DB.prepare('SELECT access_token, expires_at FROM threads_token ORDER BY id DESC LIMIT 1').first(); } catch (e) {}
  const token = (row && row.access_token) || env.THREADS_ACCESS_TOKEN;
  if (!token) return;
  const expiresAt = row && row.expires_at;
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  if (expiresAt && expiresAt - Date.now() > tenDaysMs) return; // not due yet
  try {
    const url = `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && data.access_token) {
      const newExpiresAt = Date.now() + (data.expires_in || 5184000) * 1000; // default 60d
      await env.LEADS_DB.prepare('INSERT INTO threads_token (access_token, expires_at, updated_at) VALUES (?, ?, ?)')
        .bind(data.access_token, newExpiresAt, Date.now()).run();
    }
  } catch (e) {}
}

async function createThreadsContainer(env, text, opts) {
  const token = await getThreadsAccessToken(env);
  const params = new URLSearchParams({ text, access_token: token });
  params.set('media_type', (opts && opts.imageUrl) ? 'IMAGE' : 'TEXT');
  if (opts && opts.imageUrl) params.set('image_url', opts.imageUrl);
  if (opts && opts.replyToId) params.set('reply_to_id', opts.replyToId);
  const res = await fetch(`${THREADS_API}/${env.THREADS_USER_ID}/threads?${params.toString()}`, { method: 'POST' });
  let data = {}; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok && !!data.id, status: res.status, data };
}

async function publishThreadsContainer(env, creationId) {
  const token = await getThreadsAccessToken(env);
  const params = new URLSearchParams({ creation_id: creationId, access_token: token });
  const res = await fetch(`${THREADS_API}/${env.THREADS_USER_ID}/threads_publish?${params.toString()}`, { method: 'POST' });
  let data = {}; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok && !!data.id, status: res.status, data };
}

// Image containers aren't publishable until Meta has fetched the image_url — publishing
// immediately fails with "media not ready". Poll the container status until FINISHED
// (text-only containers are ready at once, so this is skipped for them).
async function waitForThreadsContainer(env, creationId) {
  const token = await getThreadsAccessToken(env);
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await fetch(`${THREADS_API}/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (data.status === 'FINISHED') return { ok: true };
      if (data.status === 'ERROR' || data.status === 'EXPIRED') return { ok: false, data };
    } catch (e) {}
  }
  return { ok: true }; // status never resolved — attempt the publish anyway (best effort)
}

async function postThreadsPost(env, text, replyToId, imageUrl) {
  const created = await createThreadsContainer(env, text, { replyToId, imageUrl });
  if (!created.ok) return { ok: false, status: created.status, data: created.data };
  if (imageUrl) {
    const ready = await waitForThreadsContainer(env, created.data.id);
    if (!ready.ok) return { ok: false, status: 400, data: ready.data };
  }
  const published = await publishThreadsContainer(env, created.data.id);
  return published;
}

async function postThreadsThread(env, texts, imageUrl) {
  const posted = [];
  let replyToId;
  for (let i = 0; i < texts.length; i++) {
    const res = await postThreadsPost(env, texts[i], replyToId, i === 0 ? imageUrl : undefined);
    posted.push(res);
    if (!res.ok) break;
    replyToId = res.data && res.data.id;
  }
  return posted;
}

async function postAndLogThreads(env, format, id, tweets, imagePath) {
  if (!env.THREADS_USER_ID || !(await getThreadsAccessToken(env))) return { ok: false, error: 'missing_threads_credentials' };
  await maybeRefreshThreadsToken(env);
  const imageUrl = imagePath ? `https://irontuna.com${imagePath}` : undefined;
  const posted = await postThreadsThread(env, tweets, imageUrl);
  const ok = posted.length > 0 && posted.every(p => p.ok);
  const postIds = posted.map(p => (p.data && p.data.id) || '').filter(Boolean).join(',');
  if (env.LEADS_DB) {
    try {
      await env.LEADS_DB.prepare('INSERT INTO threads_posts (insight_id, format, post_id, ok, posted_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, format, postIds, ok ? 1 : 0, Date.now()).run();
    } catch (e) {}
  }
  return { ok, postIds: postIds.split(',').filter(Boolean), errors: posted.filter(p => !p.ok).map(p => ({ status: p.status, data: p.data })) };
}

// X copy carries neither the irontuna.com link (removed Aug 2026; also the difference between
// X's $0.20 link-post and $0.015 plain-post rates) nor the trailing hashtag line (hashtags read
// as automated filler on current X and add nothing to distribution there). The compose functions
// still emit both on their own lines so the Threads mirror keeps them (free API, no per-link
// charge, and hashtags still work as topic tags on Threads) — this strips those lines from what
// goes to X only. No hand-authored copy line starts with '#', so line-leading '#' is a safe
// hashtag-line signal.
function toXCopy(text) {
  return text
    .split('\n')
    .filter(line => !/https?:\/\/(www\.)?irontuna\.com/i.test(line) && !/^\s*#/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A thread entry is either a plain string or {text, poll} (Monday poll posts). Everything that
// hashes, measures, or prices a tweet goes through tweetText() so both shapes work.
function tweetText(t) { return typeof t === 'string' ? t : t.text; }

async function postAndLog(env, format, id, tweets, hash, imagePath) {
  let mediaId;
  if (imagePath) {
    const bytes = await fetchAssetBytes(env, imagePath);
    if (bytes) {
      const uploaded = await uploadMedia(env, bytes, 'image/png');
      if (uploaded.ok) mediaId = uploaded.data && uploaded.data.media_id_string;
    }
  }
  const xTweets = tweets.map(t => typeof t === 'string' ? toXCopy(t) : { ...t, text: toXCopy(t.text) });
  const posted = await postThread(env, xTweets, mediaId);
  const ok = posted.every(p => p.ok);
  const tweetIds = posted.map(p => (p.data && p.data.data && p.data.data.id) || '').filter(Boolean).join(',');
  const cost = posted.reduce((sum, p, i) => sum + (p.ok ? tweetCost(tweetText(xTweets[i])) : 0), 0);
  if (env.LEADS_DB) {
    try {
      await env.LEADS_DB.prepare('INSERT INTO x_posts (insight_id, format, tweet_id, ok, posted_at, text_hash, est_cost) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, format, tweetIds, ok ? 1 : 0, Date.now(), hash, cost).run();
    } catch (e) {}
  }
  return { ok, tweets: xTweets, tweetIds: tweetIds.split(',').filter(Boolean), errors: posted.filter(p => !p.ok).map(p => ({ status: p.status, data: p.data })), cost };
}

// Auto-generated stat-card image for an extracted insight (see tools/build-insight-cards.mjs).
// Existence-checked before use so a pool entry whose card hasn't been generated yet (new drop
// page, generator not re-run) degrades to a text-only post instead of failing the Threads
// container step on a 404 image URL.
async function insightCardPath(env, item) {
  const path = `/social/cards/${item.id}.png`;
  return (await fetchAssetBytes(env, path)) ? path : undefined;
}

async function runXAutoPost(env, opts) {
  const hasX = env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET;
  if (!hasX) return { ok: false, error: 'missing_x_credentials' };
  // Each cron tick posts one slot ('auction' / 'snake' / 'bonus') so the day's 2-3 threads land
  // hours apart instead of in the same minute — see the three triggers in wrangler.jsonc. The
  // manual x-post-now trigger passes no slots and runs all three at once, as before.
  const slots = (opts && opts.slots) || ['auction', 'snake', 'bonus'];
  const results = [];
  for (const format of ['auction', 'snake']) {
    if (!slots.includes(format)) continue;
    const pool = poolFor(format);
    const startIdx = await postedCount(env, format);
    const pick = await pickNonDuplicate(env, pool, startIdx, composeThread);
    if (!pick) { results.push({ format, ok: false, error: 'no_insight_available' }); continue; }
    const image = await insightCardPath(env, pick.item);
    // A network-layer throw (fetch rejecting, not an HTTP error) in one slot must not
    // abort the other format's post, the Threads mirror, or the bonus post below.
    try {
      const { ok, tweets, tweetIds, errors, cost } = await postAndLog(env, format, pick.item.id, pick.tweets, pick.hash, image);
      results.push({ platform: 'x', format, ok, insightId: pick.item.id, tweets, tweetIds, errors, cost });
    } catch (e) {
      results.push({ platform: 'x', format, ok: false, insightId: pick.item.id, error: 'network: ' + (e && e.message) });
    }
    // Threads mirrors whatever X just posted (same content, same day) rather than running a
    // second independent rotation; it posts even if the X side failed/was skipped for this slot.
    try {
      const threadsResult = await postAndLogThreads(env, format, pick.item.id, pick.tweets, image);
      if (threadsResult.error !== 'missing_threads_credentials') results.push({ platform: 'threads', format, ...threadsResult });
    } catch (e) {
      results.push({ platform: 'threads', format, ok: false, error: 'network: ' + (e && e.message) });
    }
  }
  const dow = (opts && opts.forceDay != null) ? opts.forceDay : ((opts && opts.forceWednesday) ? 3 : new Date().getUTCDay());
  const bonus = slots.includes('bonus') ? X_BONUS_DAY_POOLS[dow] : null;
  const bonusPool = bonus ? (bonus.dynamicPool ? bonus.dynamicPool() : bonus.pool) : null;
  if (bonus && bonusPool && bonusPool.length) {
    const startIdx = await postedCount(env, bonus.format);
    const pick = await pickNonDuplicate(env, bonusPool, startIdx, bonus.compose);
    if (pick) {
      // Hand-authored compare posts carry their own image; Friday's extracted best-ball
      // insights (detected by their 'play' key, same dispatch as composeBestballThread)
      // get their generated stat card like the daily insight slots do.
      const image = pick.item.image || (('play' in pick.item) ? await insightCardPath(env, pick.item) : undefined);
      try {
        const { ok, tweets, tweetIds, errors, cost } = await postAndLog(env, bonus.format, pick.item.id, pick.tweets, pick.hash, image);
        results.push({ platform: 'x', format: bonus.format, type: pick.item.type, ok, insightId: pick.item.id, tweets, tweetIds, errors, cost });
      } catch (e) {
        results.push({ platform: 'x', format: bonus.format, type: pick.item.type, ok: false, insightId: pick.item.id, error: 'network: ' + (e && e.message) });
      }
      // Threads has no poll support, so poll threads (any non-string entry) are X-only.
      if (pick.tweets.every(t => typeof t === 'string')) {
        try {
          const threadsResult = await postAndLogThreads(env, bonus.format, pick.item.id, pick.tweets, image);
          if (threadsResult.error !== 'missing_threads_credentials') results.push({ platform: 'threads', format: bonus.format, type: pick.item.type, ...threadsResult });
        } catch (e) {
          results.push({ platform: 'threads', format: bonus.format, type: pick.item.type, ok: false, error: 'network: ' + (e && e.message) });
        }
      }
    }
  }
  return { ok: results.filter(r => r.platform === 'x').every(r => r.ok), results };
}

async function saveContact(env, rec) {
  if (!env || !env.LEADS_DB) return;
  try {
    await env.LEADS_DB.prepare('INSERT INTO contacts (email, phone, source, type, ref, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(rec.email || '', rec.phone || '', rec.source || '', rec.type || '', rec.ref || '', rec.path || '', Date.now()).run();
  } catch (e) {}
}
// ── opt-in marketing email (nurture). Dormant by default: sends only via the admin-gated
//    /api/campaign-send, and only when RESEND_API_KEY + MAIL_ADDRESS (CAN-SPAM physical
//    address) are set. Every send includes an unsubscribe link + List-Unsubscribe header. ──
async function unsubToken(env, email) { return env.AUTH_SECRET ? await hmacSign(env.AUTH_SECRET, 'unsub:' + email) : ''; }
async function isUnsubscribed(env, email) {
  if (!env.LEADS_DB) return false;
  try { return !!(await env.LEADS_DB.prepare('SELECT 1 FROM unsubscribes WHERE email=?').bind(email).first()); } catch (e) { return false; }
}
async function sendCampaignOne(env, origin, email, subject, inner) {
  if (!env.RESEND_API_KEY || !env.MAIL_ADDRESS) return { skipped: 'not_configured' };
  if (await isUnsubscribed(env, email)) return { skipped: 'unsubscribed' };
  const token = await unsubToken(env, email);
  const unsub = origin + '/api/unsubscribe?e=' + encodeURIComponent(email) + '&t=' + encodeURIComponent(token);
  const html = inner + '<hr style="border:none;border-top:1px solid #d4dde3;margin:24px 0 12px"/>'
    + '<p style="font-size:12px;color:#8595a1;line-height:1.5;font-family:system-ui,Arial">You received this because you built a free cheat sheet at irontuna.com. '
    + '<a href="' + unsub + '" style="color:#8595a1">Unsubscribe</a>.<br/>' + env.MAIL_ADDRESS + '</p>';
  const from = env.EMAIL_FROM_MARKETING || 'Iron Tuna <hello@irontuna.com>';
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: email, subject, html, headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: String(e).slice(0, 80) }; }
}
const CAMPAIGN_NURTURE = {
  subject: 'Your fantasy draft is coming — here’s your edge',
  inner: '<div style="font-family:system-ui,Arial;max-width:520px;color:#1a2129">'
    + '<h2 style="color:#0b1117">Your cheat sheet is ready. Draft day is the hard part.</h2>'
    + '<p>You already have your free custom values. The managers who win drafts have one more thing: live help <em>on the clock</em>.</p>'
    + '<p><b>Draft Day Mode</b> ($9.99 once, no subscription) unlocks your league’s own scoring, a board you can reorder, and an AI Value Coach that tells you exactly who to draft and how much to pay — recalculated live as your draft unfolds.</p>'
    + '<p style="margin:22px 0"><a href="https://irontuna.com/" style="background:#f5b800;color:#1a1205;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Unlock Draft Day Mode — $9.99</a></p>'
    + '<p style="color:#667">Draft season fills up fast — lock it in before your draft so it’s ready when you’re on the clock.</p>'
    + '</div>'
};

// ════════════════════════════════════════════════════════════════════════════
// Vegas-weighted projections
// ════════════════════════════════════════════════════════════════════════════
// A daily cron pulls season-long player props, converts them to expected stat
// totals, and blends them over PROJECTIONS at VEGAS_WEIGHT:1. The blend is
// cached in D1 and served by /api/projections.
//
// The math mirrors tools/vegas-to-projections.mjs exactly — there is no build
// step here, so the two implementations are kept in sync by hand and
// cross-checked by tools/test-vegas.mjs. Change one, change both.
//
// FAIL-SAFE BY CONSTRUCTION. Every step is allowed to fail and the endpoint
// falls back to the committed PROJECTIONS: a provider error, an unparseable
// response, too few matched players, or a value outside the sanity bands all
// mean "no overlay is written", never "bad numbers are served". Nothing about
// the request path depends on the provider being up — requests read a cached
// D1 row, never the sportsbook.

const VEGAS_WEIGHT = 3;               // vegas : each projection feed
const ODDS_MIN_MATCHED = 25;          // below this the pull is treated as broken
const ODDS_MAX_AGE_MS = 14 * 86400000; // overlay older than this is ignored
const ODDS_CV = {
  passYd: 0.20, passTD: 0.28, passInt: 0.35,
  rushYd: 0.30, rushTD: 0.40,
  recYd: 0.30, recTD: 0.40, rec: 0.28,
  scrimmageTD: 0.40
};
// Expected touchdowns are expectations, not counts: 3.4 is a more honest
// projection than 3, and tools/merge-projections.mjs already keeps a decimal
// for exactly these stats. Forcing them to integers here would both contradict
// the offline pipeline and silently erase small adjustments (a 1.18 factor on a
// 1-TD player rounds straight back to 1). One decimal everywhere.
const _oddsRound = v => Math.round(v * 10) / 10;
// Loose plausibility bands for a full-season total. A pull that lands outside
// these is a parsing bug (per-game numbers mistaken for season totals, cents
// read as a line, etc.), not a bold projection.
const ODDS_BANDS = {
  passYd: [1200, 6500], passTD: [4, 60], passInt: [0, 30],
  rushYd: [150, 2600], rushTD: [0, 30],
  recYd: [150, 2300], recTD: [0, 30], rec: [10, 160],
  scrimmageTD: [0, 40],
  // Kicker and defence lines come from the team-environment provider, never
  // from a book feed, and deliberately have NO entry in ODDS_CV above:
  // buildVegasOverlay gates on that table, so a props response claiming to
  // price "ptsAllowed" is rejected while buildTeamEnvOverlay can still emit it.
  // Widest real seasons since 2024: 18-48 field goals, 18-64 extra points,
  // 280-534 points allowed.
  fgMade: [8, 50], fgMissed: [0, 20], xpMade: [5, 80], xpMissed: [0, 15],
  ptsAllowed: [180, 650]
};

const _oddsNorm = s => String(s || '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
  .replace(/[^a-z]/g, '');

// ── availability (generated by tools/apply-availability.mjs from tools/availability.json) ──
// Players the board still prices but who cannot play a full season as of the file's
// asOf date: injured reserve, PUP, suspension, the commissioner's exempt list. Their
// committed PROJECTIONS rows are already pro-rated to the games they can play. This
// table lets the request path scale the odds overlay by the same factor (the cached
// overlay may predate the news, and the team-environment provider cannot see one
// player's knee) and tells the client why the number is low. Keyed like the overlay:
// _oddsNorm(name) + '|' + position. Edit tools/availability.json, not this block.
const AVAILABILITY_GAMES = 17;
const AVAILABILITY = {
  "jaydenhiggins|WR": {"status":"IR","gamesOut":17,"note":"Torn ACL in the Aug. 18 joint practice against the Raiders; out for the 2026 season.","asOf":"2026-09-02"},
  "devinneal|RB": {"status":"IR","gamesOut":17,"note":"Hamstring; placed on injured reserve without a return designation, out for the season.","asOf":"2026-09-02"},
  "tychandler|RB": {"status":"IR","gamesOut":17,"note":"Season-ending knee injury in the Aug. 22 preseason game against the Rams.","asOf":"2026-09-02"},
  "calvinaustin|WR": {"status":"IR","gamesOut":17,"note":"Torn ACL at the Aug. 25 practice; out for the 2026 season.","asOf":"2026-09-02"},
  "joshjacobs|RB": {"status":"Exempt","gamesOut":6,"note":"Commissioner's exempt list since Aug. 30 after misdemeanor charges from a May arrest. No timeline: he stays off until the commissioner removes him, and the first court date is Nov. 17. Six games is a working estimate, revisit weekly.","asOf":"2026-09-02"},
  "jordyntyson|WR": {"status":"IR","gamesOut":8,"note":"Recurring right hamstring; IR with a return designation, roughly two months out, Week 9 return most likely.","asOf":"2026-09-02"},
  "jamesconner|RB": {"status":"IR","gamesOut":4,"note":"Foot complications from the 2025 injury; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"},
  "adamrandall|RB": {"status":"IR","gamesOut":4,"note":"IR with a return designation at cutdown; first eligible Week 5.","asOf":"2026-09-02"},
  "isiahpacheco|RB": {"status":"IR","gamesOut":4,"note":"Back injury after an MCL sprain in camp; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"},
  "savionwilliams|WR": {"status":"IR","gamesOut":4,"note":"Ankle; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"},
  "lukemusgrave|TE": {"status":"PUP","gamesOut":4,"note":"Neck; reserve/PUP, misses at least the first four games and is no lock to return when eligible.","asOf":"2026-09-02"},
  "tankdell|WR": {"status":"IR","gamesOut":4,"note":"Knee (ACL and MCL) recovery; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"},
  "bensims|TE": {"status":"IR","gamesOut":4,"note":"Waived/injured and reverted to IR; misses at least four games.","asOf":"2026-09-02"},
  "grantcalcaterra|TE": {"status":"IR","gamesOut":4,"note":"Back; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"},
  "christiankirk|WR": {"status":"IR","gamesOut":4,"note":"Calf injury from July 26; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"},
  "isaacguerendo|RB": {"status":"PUP","gamesOut":4,"note":"Pectoral; reserve/PUP, misses at least the first four games.","asOf":"2026-09-02"},
  "zachcharbonnet|RB": {"status":"PUP","gamesOut":4,"note":"January ACL tear; reserve/PUP, misses at least the first four games and is described as still far from returning.","asOf":"2026-09-02"},
  "jeremymcnichols|RB": {"status":"IR","gamesOut":4,"note":"Quadriceps; IR with a return designation, first eligible Week 5.","asOf":"2026-09-02"}
};
// ── live availability (ESPN's public injury report, pulled by the 11:00Z cron) ──
// The committed block above is only as current as the last hand edit, and the
// whole of HANDOFF §48 was that nothing on a schedule could change one player's
// line. So the cron pulls ESPN's injury report, keeps the board players it has on
// a reserve list (IR, reserve/PUP, reserve/NFI, suspension, the exempt list) as
// row 3 of odds_overlay in D1, and the request path serves the UNION of the
// committed block and that row:
//   - a player in both: the live entry wins (status, note, source), except that
//     games missed never drop below the committed number. Fewer games out is a
//     reinstatement, and reinstatement stays a hand edit to tools/availability.json
//     (the feed's return dates are placeholders — Jacobs' exempt-list entry says
//     Week 3 while the file's considered number is six).
//   - a player only in the committed block: kept as is. The feed dropping him is
//     not evidence he plays; ESPN clears reserve designations in bulk.
//   - a player only in the live row: a placement the file has not caught up
//     with. His committed PROJECTIONS row is still the full-season line, so it is
//     pro-rated on the way out (_withAvailability) and the odds overlay by the
//     same factor (applyAvailability). Each side carries the factor exactly once:
//     the committed rows already carry the committed factor, so only the
//     difference between the live and committed numbers is applied to a row.
// FAIL-SAFE like the odds pull (§9b): a provider error, unparseable JSON, a feed
// missing most of the league, or fewer than AVAIL_MIN_MATCHED board players on
// reserve lists never writes a row; a row older than AVAIL_MAX_AGE_MS or not in
// the shape written here is ignored on read. Either way the previous good row,
// or the committed block alone, stays in force.
const AVAIL_FEED_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
const AVAIL_MIN_MATCHED = 5;            // fewer board players on reserve lists than this = broken pull
const AVAIL_MIN_TEAMS = 28;             // a feed carrying fewer teams is truncated, not quiet
const AVAIL_MAX_AGE_MS = 14 * 86400000; // a live row older than this is ignored, like the overlay
const AVAIL_MEMO_MS = 900000;           // per-isolate memo of the merged table (one D1 read behind it)
const AVAIL_MIN_GAMES = 2;              // a one-game absence is not a season line change (§48)
const AVAIL_RESERVE_MIN = 4;            // IR / reserve-PUP / reserve-NFI: at least four games by rule
const AVAIL_SEASON_ENDING = /season-ending|out for the (rest of the )?(season|year)|(rest|remainder) of the (\d{4} )?season|(entire|whole) (\d{4} )?season/i;

const _availF = g => Math.max(0, Math.min(1, 1 - (Number(g) || 0) / AVAILABILITY_GAMES));
// Feed status -> the vocabulary tools/availability.json uses. ESPN's top-level
// `status` is coarse ("Out" covers reserve/PUP, reserve/NFI and the exempt list
// alike), so the fantasyStatus under `details` says which list and is read
// first. Week-to-week entries (Questionable, Doubtful, Probable, Day-To-Day,
// Active, active/PUP) are not season line changes and map to nothing, exactly
// as §48 left them alone by hand.
function _availStatusOf(entry) {
  const fsx = ((entry && entry.details) || {}).fantasyStatus || {};
  const fs = String(fsx.abbreviation || fsx.description || '').toUpperCase();
  const st = String((entry && entry.status) || '');
  if (/^IR(-R)?$/.test(fs) || /Injured Reserve/i.test(st)) return { status: 'IR', min: AVAIL_RESERVE_MIN, reserve: true };
  if (fs === 'PUP-R' || /Physically Unable/i.test(st)) return { status: 'PUP', min: AVAIL_RESERVE_MIN, reserve: true };
  if (fs === 'NFI-R' || /Non-Football/i.test(st)) return { status: 'NFI', min: AVAIL_RESERVE_MIN, reserve: true };
  if (fs === 'RESERVE-CEL' || /Exempt/i.test(st)) return { status: 'Exempt', min: AVAIL_MIN_GAMES, reserve: false };
  if (fs === 'RESERVE-SUS' || /Suspen/i.test(st)) return { status: 'Suspended', min: AVAIL_MIN_GAMES, reserve: false };
  if (/^Out$/i.test(st) && fs !== 'PUP-P') return { status: 'Out', min: AVAIL_MIN_GAMES, reserve: false, needsDate: true };
  return null;
}
// Week 1 kicks off on the Thursday after Labor Day (the first Monday of September).
function _availKickoff(year) {
  const first = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  return Date.UTC(year, 8, 1 + ((8 - first) % 7) + 3);
}
// Games missed: whole weeks between kickoff and ESPN's return date, never below
// the list's own minimum, 17 when the return date is past the season or the
// comment says season-ending. Bye weeks are ignored on purpose — the file's
// own convention is "first eligible Week 5" = 4. Returns 0 to say "not a
// season line change" (a return inside AVAIL_MIN_GAMES, or a plain "Out" with
// no date to go on).
function _availGamesOut(entry, kickoff, m) {
  const text = String((entry && entry.shortComment) || '') + ' ' + String((entry && entry.longComment) || '');
  if (AVAIL_SEASON_ENDING.test(text)) return AVAILABILITY_GAMES;
  const ret = Date.parse(String(((entry && entry.details) || {}).returnDate || ''));
  const weeks = Number.isFinite(ret) ? Math.floor((ret - kickoff) / (7 * 86400000)) : null;
  if (weeks === null) return m.needsDate ? 0 : m.min;
  if (weeks >= AVAILABILITY_GAMES) return AVAILABILITY_GAMES;
  if (m.reserve) return Math.max(m.min, weeks);
  return weeks >= m.min ? weeks : 0;
}
// name + position, the way tools/availability.json and the block above are
// keyed. A name at two positions is dropped rather than guessed, as the odds
// matcher does.
function _availBoardIndex() {
  const idx = new Map();
  for (const p of PROJECTIONS) {
    const k = _oddsNorm(p.name) + '|' + p.position;
    idx.set(k, idx.has(k) ? null : { name: p.name, position: p.position, team: p.team });
  }
  return idx;
}
// The feed, reduced to board players on a reserve list. Same shape per entry as
// a tools/availability.json row, keyed like AVAILABILITY.
function buildAvailabilityOverlay(feed) {
  const teams = feed && Array.isArray(feed.injuries) ? feed.injuries : [];
  const stamp = Date.parse(String((feed && feed.timestamp) || ''));
  const asOf = new Date(Number.isFinite(stamp) ? stamp : Date.now()).toISOString();
  const year = Number(feed && feed.season && feed.season.year) || Number(asOf.slice(0, 4));
  const kickoff = _availKickoff(year);
  const board = _availBoardIndex();
  const players = {};
  const skipped = { unlisted: 0, weekToWeek: 0, short: 0 };
  let entries = 0;
  for (const t of teams) for (const e of (t && Array.isArray(t.injuries)) ? t.injuries : []) {
    entries++;
    const a = (e && e.athlete) || {};
    const pos = String((a.position || {}).abbreviation || '').toUpperCase().replace(/^PK$/, 'K');
    const key = _oddsNorm(a.displayName) + '|' + pos;
    const p = board.get(key);
    if (!p) { skipped.unlisted++; continue; }
    const m = _availStatusOf(e);
    if (!m) { skipped.weekToWeek++; continue; }
    const gamesOut = _availGamesOut(e, kickoff, m);
    if (!gamesOut) { skipped.short++; continue; }
    if (players[key] && players[key].gamesOut >= gamesOut) continue;   // two entries for one man: the longer absence
    const type = String((e.details || {}).type || '').trim();
    const note = ((type && !/^(Undisclosed|Suspension|Personal)$/i.test(type) ? type + ': ' : '') + String(e.shortComment || '').trim()).slice(0, 160);
    players[key] = { name: p.name, position: p.position, team: p.team, status: m.status, gamesOut, note,
                     source: 'ESPN injury feed ' + asOf.slice(0, 10), asOf: asOf.slice(0, 10) };
  }
  return { players, matched: Object.keys(players).length, teams: teams.length, entries, skipped, asOf };
}
// committed ∪ live, live winning per player except downward on gamesOut (see the
// note at the top of this block). Every entry records the committed number so
// the row factor can be the DIFFERENCE, not the whole factor twice.
function availabilityMerge(committed, live) {
  const out = {};
  for (const [k, c] of Object.entries(committed || {})) out[k] = { ...c, committedGamesOut: Number(c.gamesOut) || 0 };
  for (const [k, l] of Object.entries(live || {})) {
    const cg = out[k] ? out[k].committedGamesOut : 0;
    out[k] = { status: l.status, gamesOut: Math.max(Number(l.gamesOut) || 0, cg), note: l.note || '',
               asOf: l.asOf || '', source: l.source || '', live: true, committedGamesOut: cg };
  }
  return out;
}
let _AVAIL_TABLE = availabilityMerge(AVAILABILITY, null);   // what every sync reader below sees
let _AVAIL_AT = 0;        // when the memo was last loaded from D1 (0 = never)
let _AVAIL_LIVE_AT = 0;   // updated_at of the live row behind it (0 = committed block only)
let _AVAIL_KICK_AT = 0;
function _availTable() { return _AVAIL_TABLE; }
// The merged table, loaded once per isolate-quarter-hour. oddsCacheRead calls
// this first, so every path that reads the overlay has the live list in place
// before blendProjections / applyAvailability run.
async function availabilityTable(env) {
  if (_AVAIL_AT && Date.now() - _AVAIL_AT < AVAIL_MEMO_MS) return _AVAIL_TABLE;
  const live = await availabilityCacheRead(env);
  _AVAIL_TABLE = availabilityMerge(AVAILABILITY, live && live.players);
  _AVAIL_LIVE_AT = live ? live.updatedAt : 0;
  _AVAIL_AT = Date.now();
  return _AVAIL_TABLE;
}
// The factor a market (full-season) line takes for this player.
function _availFactor(key) {
  const a = _availTable()[key];
  return a ? _availF(a.gamesOut) : 1;
}
// The factor his COMMITTED row still needs: the row already carries the
// committed pro-rating, so only what the live list adds on top is applied.
function _availRowFactor(key) {
  const a = _availTable()[key];
  if (!a) return 1;
  const fc = _availF('committedGamesOut' in a ? a.committedGamesOut : a.gamesOut);
  const f = _availF(a.gamesOut);
  return fc > 0 ? Math.min(1, f / fc) : 1;
}
// Scale an overlay's market-implied totals for the players on the availability
// list. A season-long total for a player who will not play the season is not a
// market view of him, it is a stale row; scaling it here keeps every reader of
// the overlay (the blend, the column, the board) on the same footing as PROJECTIONS.
function applyAvailability(overlay) {
  if (!overlay || typeof overlay !== 'object') return overlay;
  let out = overlay;
  for (const key of Object.keys(_availTable())) {
    const v = overlay[key];
    if (!v) continue;
    const f = _availFactor(key);
    if (f >= 1) continue;
    if (out === overlay) out = { ...overlay };
    const scaled = {};
    for (const [k, val] of Object.entries(v)) {
      const n = Number(val);
      scaled[k] = Number.isFinite(n) ? _oddsRound(n * f) : val;
    }
    out[key] = scaled;
  }
  return out;
}

function _oddsImpliedProb(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
function _oddsDevigOver(overOdds, underOdds) {
  const po = _oddsImpliedProb(overOdds), pu = _oddsImpliedProb(underOdds);
  if (po == null || pu == null) return null;
  const sum = po + pu;
  return sum > 0 ? po / sum : null;
}
// Acklam's inverse normal CDF.
function _oddsProbit(p) {
  if (!(p > 0 && p < 1)) return null;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// Posted line + de-vigged P(over) -> expected season total. See the tool's
// header for why this is line + sigma*z rather than just the line.
function _oddsExpectedTotal(line, pOver, market) {
  const L = Number(line);
  if (!Number.isFinite(L) || L < 0) return null;
  if (pOver == null) return L;
  const z = _oddsProbit(Math.min(0.995, Math.max(0.005, pOver)));
  if (z == null) return L;
  return Math.max(0, L + (ODDS_CV[market] ?? 0.30) * L * z);
}

// ── providers ──────────────────────────────────────────────────────────────
// Each returns a flat array of
//   { player, position, team, market, line, overOdds, underOdds }
// or throws. Add a provider by writing one of these and listing it below.

// The Odds API — documented, stable schema. Used whenever ODDS_API_KEY is set.
// The Odds API v4. WRITTEN TO THE PUBLISHED v4 DOCUMENTATION AND NOT YET RUN
// AGAINST THE LIVE SERVICE: no key is configured, and the host is unreachable
// from the sandbox this repo is developed in. Two things about v4 shape this:
//   1. Player props are served PER EVENT (/events/{id}/odds), never from the
//      bulk /odds endpoint, which only knows h2h, spreads and totals.
//   2. Every player market is a GAME line, not a season line. They feed the
//      weekly Vegas projection and the snapshot store; buildVegasOverlay is
//      the season path and must never see them, which `scope: 'game'` is for.
// The market list is overridable with ODDS_API_MARKETS (comma-separated) so a
// renamed key on their side is a config change here, not a deploy.
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl';
const ODDS_API_MARKET_MAP = {
  player_pass_yds: 'passYd', player_pass_tds: 'passTD', player_pass_interceptions: 'passInt',
  player_rush_yds: 'rushYd', player_rush_attempts: 'rushAtt', player_rush_tds: 'rushTD',
  player_reception_yds: 'recYd', player_receptions: 'rec', player_reception_tds: 'recTD',
  player_anytime_td: 'anytimeTD'
};
const ODDS_API_MAX_EVENTS = 20;           // a week is 13-16 games; never more than that
function _oddsApiMarkets(env) {
  const raw = String((env && env.ODDS_API_MARKETS) || '').trim();
  const list = raw ? raw.split(',').map(x => x.trim()).filter(x => ODDS_API_MARKET_MAP[x]) : Object.keys(ODDS_API_MARKET_MAP);
  return list.length ? list : Object.keys(ODDS_API_MARKET_MAP);
}
// One event's markets into rows. Pure, so a fixture can drive it in tests
// without the network. Outcomes arrive as Over/Under pairs (or Yes/No for an
// anytime-TD) keyed by `description`, which is the player.
function parseOddsApiEvent(ev) {
  const rows = [];
  const ts = Date.now();
  for (const bk of (ev && ev.bookmakers) || []) {
    for (const mk of bk.markets || []) {
      const stat = ODDS_API_MARKET_MAP[mk.key];
      if (!stat) continue;
      const byPlayer = new Map();
      for (const oc of mk.outcomes || []) {
        const who = oc.description || oc.participant;
        if (!who) continue;
        if (!byPlayer.has(who)) byPlayer.set(who, {});
        const side = String(oc.name || '').toLowerCase();
        if (side === 'over' || side === 'yes') byPlayer.get(who).over = oc;
        else if (side === 'under' || side === 'no') byPlayer.get(who).under = oc;
      }
      for (const [who, pair] of byPlayer) {
        const line = pair.over && pair.over.point != null ? pair.over.point
                   : pair.under && pair.under.point != null ? pair.under.point : null;
        // An anytime-TD has no line; every other market must have one.
        if (line == null && stat !== 'anytimeTD') continue;
        if (!pair.over && !pair.under) continue;
        rows.push({
          player: who, position: null, team: null, market: stat,
          line: stat === 'anytimeTD' ? 1 : line,
          overOdds: pair.over ? pair.over.price : null, underOdds: pair.under ? pair.under.price : null,
          book: bk.key || bk.title || 'unknown',
          gameId: ev.id || null, commence: ev.commence_time || null,
          home: teamKey(ev.home_team), away: teamKey(ev.away_team),
          scope: 'game', ts
        });
      }
    }
  }
  return rows;
}
async function fetchOddsTheOddsApi(env) {
  const key = env && env.ODDS_API_KEY;
  if (!key) throw new Error('no ODDS_API_KEY');
  const q = new URLSearchParams({ apiKey: key });
  const er = await fetch(ODDS_API_BASE + '/events?' + q.toString(), { cf: { cacheTtl: 0 } });
  if (!er.ok) throw new Error('odds-api events ' + er.status);
  const events = await er.json();
  const list = (Array.isArray(events) ? events : []).slice(0, ODDS_API_MAX_EVENTS);
  const markets = _oddsApiMarkets(env).join(',');
  const rows = [];
  for (const ev of list) {
    if (!ev || !ev.id) continue;
    const p = new URLSearchParams({ apiKey: key, regions: 'us', oddsFormat: 'american', markets });
    const r = await fetch(ODDS_API_BASE + '/events/' + encodeURIComponent(ev.id) + '/odds?' + p.toString(), { cf: { cacheTtl: 0 } });
    if (!r.ok) continue;                      // one event failing must not lose the slate
    const data = await r.json();
    for (const row of parseOddsApiEvent(data)) rows.push(row);
  }
  return rows;
}

const NFLVERSE_GAMES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const TEAM_ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const teamKey = t => { const u = String(t || '').toUpperCase(); return TEAM_ALIAS[u] || u; };
// Yardage tracks scoring environment far less tightly than touchdowns do, so a
// team's factor is damped before it touches yards. Judgement call, not a fit.
const TEAMENV_YARD_EXP = 0.5;
const TEAMENV_CLAMP = [0.85, 1.18];   // a data glitch must not rewrite a roster
const TEAMENV_MIN_GAMES = 3;          // too few SCHEDULED games -> leave the club alone
const TEAMENV_TD_STATS = ['passTD', 'rushTD', 'recTD'];
const TEAMENV_YARD_STATS = ['passYd', 'rushYd', 'recYd'];

// Minimal quote-aware CSV line splitter. games.csv carries free-text columns
// (stadium, referee) that can contain commas, so a plain split would misalign
// every field after them.
function _csvSplit(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ── team market ratings ────────────────────────────────────────────────────
// HAND-SYNCED with tools/team-market.mjs, which runs the same fit offline to
// rebaseline the committed K and DEF rows. There is no build step in this repo.
// Change one, change both; tools/test-team-market.mjs runs the two against one
// fixture and fails if they disagree.
//
// Books post lines a few weeks out, so in September only the front of the season
// is priced. Averaging those games and multiplying by 17 judges a club on
// whoever it happened to draw in September, which is exactly the schedule bias a
// points-allowed projection must not inherit. Fitting
//
//     points(offence i vs defence j, at home h) = mu + off_i + def_j + hfa*h
//
// separates "this offence is good" from "those first six defences were bad", and
// the ratings then project across the WHOLE schedule, which games.csv carries in
// full whether or not a line has been posted for a fixture yet.
//
// A small ridge keeps the fit stable while a club has only a handful of priced
// games. mu and hfa are never penalised: shrinking the intercept would drag the
// league's entire scoring level down with it.
const MARKET_RIDGE = 0.25;
const MARKET_MIN_PRICED = 48;         // priced SIDES, so 24 games: fewer is not a season

// Dense Gaussian elimination with partial pivoting. The system is 2n+2 wide —
// an offence and a defence rating per club, plus mu and hfa, so 66 today.
function _mktSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => Array.from(row).concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-12)) throw new Error('team market: singular system');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map(r => r[n]);
}

// Fixtures (priced or not) -> { TEAM: { pf, pa, games } } over the full schedule.
// The fit alone, so the weekly boards can project any single fixture from the
// same ratings marketSeasonTotals sums over a season. Output of the latter is
// byte-identical to before the split; tools/test-team-market.mjs holds it to
// the tool's copy.
function _mktFit(games, ridge = MARKET_RIDGE) {
  const teams = [...new Set(games.flatMap(g => [g.home, g.away]))].sort();
  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const obs = [];
  for (const g of games) {
    if (!g.priced) continue;
    // spread_line is the HOME margin, so the pair splits the total into the two
    // sides' implied points.
    obs.push({ off: idx[g.home], def: idx[g.away], home: 1, y: g.total / 2 + g.spread / 2 });
    obs.push({ off: idx[g.away], def: idx[g.home], home: -1, y: g.total / 2 - g.spread / 2 });
  }
  if (obs.length < MARKET_MIN_PRICED) throw new Error('team market: only ' + (obs.length / 2) + ' priced games');
  const P = 2 * n + 2;
  const A = Array.from({ length: P }, () => new Float64Array(P));
  const b = new Float64Array(P);
  for (const o of obs) {
    const at = [o.off, n + o.def, 2 * n, 2 * n + 1];
    const val = [1, 1, o.home, 1];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[at[i]][at[j]] += val[i] * val[j];
      b[at[i]] += val[i] * o.y;
    }
  }
  for (let i = 0; i < 2 * n; i++) A[i][i] += ridge;
  const x = _mktSolve(A, b);
  const off = {}, def = {};
  teams.forEach((t, i) => { off[t] = x[i]; def[t] = x[n + i]; });
  const hfa = x[2 * n], mu = x[2 * n + 1];
  return { teams, off, def, hfa, mu };
}
function marketSeasonTotals(games, ridge = MARKET_RIDGE) {
  const { teams, off, def, hfa, mu } = _mktFit(games, ridge);
  const out = {};
  for (const t of teams) out[t] = { pf: 0, pa: 0, games: 0 };
  for (const g of games) {
    const hp = mu + off[g.home] + def[g.away] + hfa;
    const ap = mu + off[g.away] + def[g.home] - hfa;
    out[g.home].pf += hp; out[g.home].pa += ap; out[g.home].games++;
    out[g.away].pf += ap; out[g.away].pa += hp; out[g.away].games++;
  }
  return out;
}

// Returns { TEAM: { pf, pa, games } }, a schedule-complete season of implied
// points for and against, for the newest season in the file that carries lines.
async function fetchTeamEnvNflverse(env) {
  const r = await fetch(NFLVERSE_GAMES_URL, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error('nflverse ' + r.status);
  const text = await r.text();
  const lines = text.split('\n');
  if (lines.length < 2) throw new Error('nflverse: empty');
  const head = _csvSplit(lines[0]);
  const col = {};
  ['season', 'game_type', 'home_team', 'away_team', 'spread_line', 'total_line'].forEach(k => { col[k] = head.indexOf(k); });
  for (const k of Object.keys(col)) if (col[k] < 0) throw new Error('nflverse: missing column ' + k);

  // game_id is the first field and starts with the season, so the newest season
  // can be found (and every other row skipped) without parsing 2MB of CSV.
  let season = 0;
  for (let i = 1; i < lines.length; i++) {
    const u = lines[i].indexOf('_');
    if (u > 0) { const y = +lines[i].slice(0, u); if (y > season && y < 3000) season = y; }
  }
  if (!season) throw new Error('nflverse: no season found');
  const prefix = season + '_';

  // Unpriced fixtures are KEPT: the schedule is what makes a full-season
  // projection possible once the ratings are fitted on the games that do carry
  // a line. A junk line is worse than a missing one, so it loses its price and
  // keeps its fixture.
  const games = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    const f = _csvSplit(lines[i]);
    if (f[col.game_type] !== 'REG') continue;
    const spread = parseFloat(f[col.spread_line]);
    const total = parseFloat(f[col.total_line]);
    const priced = Number.isFinite(spread) && Number.isFinite(total)
      && total >= 20 && total <= 80 && Math.abs(spread) <= 30;
    games.push({ home: teamKey(f[col.home_team]), away: teamKey(f[col.away_team]), spread, total, priced });
  }
  const totals = marketSeasonTotals(games);
  const full = Object.fromEntries(Object.entries(totals).filter(([, v]) => v.games >= TEAMENV_MIN_GAMES));
  if (Object.keys(full).length < 16) throw new Error('nflverse: only ' + Object.keys(full).length + ' teams priced');
  return full;
}

// ── kickers and defences ───────────────────────────────────────────────────
// HAND-SYNCED with tools/k-def-model.mjs, which carries the same constants and
// the measurements behind them. Change one, change both.
//
// No book posts a season-long PLAYER market for either position, which is why
// neither used to move at all here. But neither position is really a player
// market: a kicker's volume and a defence's points allowed are made almost
// entirely of team scoring environment, and the game lines price that directly.
// So the same file that moves a running back's touchdowns moves these too.
//
// Fitted over the 64 real team-seasons in nflverse stats_team_reg_2024/2025,
// against each club's actual points scored:
//
//   pat_made = -17.0 + 0.1396 * points     r = 0.96
//   fg_made  =  24.3 + 0.0126 * points     r = 0.15
//
// Extra points are very nearly a restatement of the team total. FIELD GOALS ARE
// NOT: a kicker on a bad offence trades touchdowns for field goals, so the two
// effects cancel. Year-over-year club correlation, 2024 -> 2025, sets how much
// of a committed line survives: points allowed 0.45, sacks 0.33, fg_made 0.33,
// interceptions 0.13, fumble recoveries 0.01. A projection is an EXPECTATION,
// so its spread has to be narrower than the spread of outcomes by roughly that
// factor.
const KDEF_LEAGUE = { points: 391, fgMade: 29.5, fgPct: 0.85, xpPct: 0.958,
                      sacks: 40.4, fumRec: 8.0, defTD: 1.5, takeaways: 20.0 };
const K_MODEL = { xpA: -17.0, xpB: 0.1396, fgA: 24.3, fgB: 0.0126,
                  xpOwnView: 0.25, fgOwnView: 0.35,
                  pctOwnView: 0.35, pctMin: 0.82, pctMax: 0.90 };
const D_MODEL = { paOwnView: 0.15, sackKeep: 0.35, fumRecKeep: 0.35,
                  tdTilt: 0.8, tdMin: 1.0, tdMax: 2.2 };
const _kdClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function marketKicker(impliedPoints) {
  return { fgMade: Math.max(0, K_MODEL.fgA + K_MODEL.fgB * impliedPoints),
           xpMade: Math.max(0, K_MODEL.xpA + K_MODEL.xpB * impliedPoints) };
}
function blendKicker(committed, impliedPoints) {
  const m = marketKicker(impliedPoints);
  const c = committed || null;
  const cAtt = c ? (c.fgMade || 0) + (c.fgMissed || 0) : 0;
  const cPct = cAtt > 0 ? c.fgMade / cAtt : KDEF_LEAGUE.fgPct;
  const xpMade = c ? m.xpMade + K_MODEL.xpOwnView * ((c.xpMade || 0) - m.xpMade) : m.xpMade;
  // Field goals shrink toward the LEAGUE mean, not the market's own curve,
  // because that curve is nearly flat anyway.
  const fgMade = c ? m.fgMade + K_MODEL.fgOwnView * ((c.fgMade || 0) - KDEF_LEAGUE.fgMade) : m.fgMade;
  // A projected make rate is an expectation, and no starting kicker's
  // expectation is a 74% season.
  const pct = _kdClamp(KDEF_LEAGUE.fgPct + K_MODEL.pctOwnView * (cPct - KDEF_LEAGUE.fgPct),
                       K_MODEL.pctMin, K_MODEL.pctMax);
  return { fgMade: _oddsRound(fgMade), fgMissed: _oddsRound(Math.max(0, fgMade / pct - fgMade)),
           xpMade: _oddsRound(xpMade), xpMissed: _oddsRound(Math.max(0, xpMade / KDEF_LEAGUE.xpPct - xpMade)) };
}
// Points allowed is the one defensive stat the market prices directly and the
// one that dominates the fantasy line, so it is the only one this overlay emits.
// Sacks, interceptions and fumble recoveries are nobody's market; the committed
// rows already carry them shrunk by their own measured stickiness, and inventing
// a market opinion about them here would be worse than saying nothing.
function blendDefense(committed, impliedAgainst) {
  const c = committed || {};
  const pa = impliedAgainst + D_MODEL.paOwnView * ((c.ptsAllowed ?? impliedAgainst) - impliedAgainst);
  return { ptsAllowed: Math.round(pa) };
}

// Turn Vegas implied team scoring into per-player stat adjustments.
//
// TWO PATHS OUT OF ONE INPUT. Skill players are adjusted by a RATIO, because the
// committed projections already have an opinion about which offences are good.
// Kickers and defences are not: their line is team environment and nothing else,
// so the market's implied points go in as the estimate itself (see blendKicker
// and blendDefense above).
//
// The trap on the skill path is DOUBLE COUNTING: the committed projections already have an
// opinion about which offenses are good, so scaling by raw Vegas points would
// apply that opinion twice. Instead both sides are reduced to a league-relative
// index and the adjustment is the RATIO of the two — if Vegas and the
// projections already agree on a team's standing the factor is 1.0 and nothing
// moves. Only genuine disagreement changes a number.
//
// Both sides must be in the SAME UNIT, and that unit is points. Comparing a
// touchdown index against Vegas points systematically over-corrects, because
// weak offenses take a larger share of their points from field goals: on the
// real 2026 lines that mismatch stretched the factor range to 0.57 and pushed
// Miami to 1.33, versus 0.40 and 1.15 once both sides are points.
//
// Team offensive points = (passTD + rushTD) * 6 + xpMade + fgMade * 3.
// recTD is deliberately excluded — a receiving touchdown IS the quarterback's
// passing touchdown, so counting both would double every passing score. Teams
// with no kicker in the pool borrow the league-average kicking contribution
// rather than being scored as if they never kick.
function buildTeamEnvOverlay(marketTotals) {
  const EMPTY = { overlay: {}, matched: 0, teams: 0, factors: {} };
  const teams = Object.keys(marketTotals || {});
  if (teams.length < 16) return EMPTY;
  const pointsFor = t => (marketTotals[t] || {}).pf;
  const pointsAgainst = t => (marketTotals[t] || {}).pa;

  const td = {}, kick = {};
  for (const p of PROJECTIONS) {
    const t = teamKey(p.team);
    if (!t || t === 'FA') continue;
    const st = p.projectedStats || {};
    td[t] = (td[t] || 0) + (st.passTD || 0) + (st.rushTD || 0);
    kick[t] = (kick[t] || 0) + (st.xpMade || 0) + (st.fgMade || 0) * 3;
  }
  const common = teams.filter(t => td[t] > 0 && Number.isFinite(pointsFor(t)));
  if (common.length < 16) return EMPTY;

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const kicked = common.filter(t => kick[t] > 0).map(t => kick[t]);
  const kMean = kicked.length ? mean(kicked) : 0;
  const projPoints = {};
  for (const t of common) projPoints[t] = td[t] * 6 + (kick[t] > 0 ? kick[t] : kMean);

  const vMean = mean(common.map(t => pointsFor(t)));
  const pMean = mean(common.map(t => projPoints[t]));
  if (!(vMean > 0) || !(pMean > 0)) return EMPTY;

  const factors = {};
  for (const t of common) {
    const f = (pointsFor(t) / vMean) / (projPoints[t] / pMean);
    if (!Number.isFinite(f) || f <= 0) continue;
    factors[t] = Math.min(TEAMENV_CLAMP[1], Math.max(TEAMENV_CLAMP[0], f));
  }

  const overlay = {};
  for (const p of PROJECTIONS) {
    const t = teamKey(p.team);
    const st = p.projectedStats || {};
    const out = {};
    const put = (k, v) => {
      if (!Number.isFinite(v) || v < 0) return;
      const band = ODDS_BANDS[k];
      if (band && (v < band[0] || v > band[1])) return;   // never emit an implausible total
      out[k] = _oddsRound(v);
    };
    // A committed row on the availability list is already pro-rated (§48). Every
    // market view stored here is a FULL-SEASON line, so the row is un-rated
    // before it is read and applyAvailability puts the factor back exactly once
    // on the way out — otherwise the same factor would land twice on every
    // listed player. A zeroed row (out for the year) has no season line left to
    // recover and is skipped; there is nothing for the market to say about him.
    const listed = AVAILABILITY[_oddsNorm(p.name) + '|' + p.position];
    const af = listed ? _availF(listed.gamesOut) : 1;
    if (af <= 0) continue;
    const full = af < 1
      ? Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Number.isFinite(v) ? v / af : v]))
      : st;
    // Kickers and defences are not scaled by the offensive factor: their whole
    // line is team environment, so the market's implied points ARE the estimate
    // and go in directly, exactly as a player prop would. When the committed row
    // was built from the same lines the two agree and the blend is a no-op; when
    // the lines have moved since, this is what moves them.
    if (p.position === 'K' && Number.isFinite(pointsFor(t))) {
      for (const [k, v] of Object.entries(blendKicker(full, pointsFor(t)))) if (k in st) put(k, v);
    } else if (p.position === 'DEF' && Number.isFinite(pointsAgainst(t))) {
      for (const [k, v] of Object.entries(blendDefense(full, pointsAgainst(t)))) if (k in st) put(k, v);
    } else {
      const f = factors[t];
      if (!f) continue;
      for (const k of TEAMENV_TD_STATS) if (full[k] > 0) put(k, full[k] * f);
      for (const k of TEAMENV_YARD_STATS) if (full[k] > 0) put(k, full[k] * Math.pow(f, TEAMENV_YARD_EXP));
    }
    if (Object.keys(out).length) overlay[_oddsNorm(p.name) + '|' + p.position] = out;
  }
  return { overlay, matched: Object.keys(overlay).length, teams: common.length, factors };
}

// Providers run in priority order and their overlays are MERGED, earlier wins
// per player+stat. Player props (when a key is configured) are strictly better
// than a team-wide inference, so they go first and the free team-environment
// provider fills in every stat and player the props did not cover.
const ODDS_PROVIDERS = [
  { name: 'the-odds-api', kind: 'props',   fn: fetchOddsTheOddsApi,   needs: env => !!env.ODDS_API_KEY },
  { name: 'nflverse',     kind: 'teamenv', fn: fetchTeamEnvNflverse }
];

// ── overlay build ──────────────────────────────────────────────────────────
// Position comes from PROJECTIONS, not the book: books label markets, not
// fantasy positions, and the site's roster is the authority on who is a TE.
function _oddsProjectionIndex() {
  const idx = new Map();
  for (const p of PROJECTIONS) {
    const k = _oddsNorm(p.name);
    // Ambiguous names (same normalized name at two positions) are dropped
    // rather than guessed — a misassigned line is worse than a missing one.
    if (idx.has(k)) idx.set(k, null);
    else idx.set(k, p);
  }
  return idx;
}

function buildVegasOverlay(rows) {
  const idx = _oddsProjectionIndex();
  const per = new Map();
  const skipped = { unmatched: 0, unknownMarket: 0, outOfBand: 0, unusable: 0 };
  for (const row of rows || []) {
    // A game line is not a season line. The weekly projection and the snapshot
    // store read those; this builds the SEASON overlay and must not.
    if (row && row.scope === 'game') { skipped.gameScoped = (skipped.gameScoped || 0) + 1; continue; }
    const stat = row.market;
    if (!ODDS_CV[stat]) { skipped.unknownMarket++; continue; }
    const target = idx.get(_oddsNorm(row.player));
    if (!target) { skipped.unmatched++; continue; }
    const band = ODDS_BANDS[stat];
    const raw = Number(row.line);
    if (!Number.isFinite(raw) || raw < band[0] || raw > band[1]) { skipped.outOfBand++; continue; }
    const exp = _oddsExpectedTotal(raw, _oddsDevigOver(row.overOdds, row.underOdds), stat);
    if (exp == null) { skipped.unusable++; continue; }
    const key = _oddsNorm(target.name) + '|' + target.position;
    if (!per.has(key)) per.set(key, { name: target.name, position: target.position, samples: {} });
    (per.get(key).samples[stat] = per.get(key).samples[stat] || []).push(exp);
  }

  const overlay = {};
  for (const [key, rec] of per) {
    const stats = {};
    for (const [k, arr] of Object.entries(rec.samples)) {
      stats[k] = arr.reduce((a, c) => a + c, 0) / arr.length;   // consensus across books
    }
    if (stats.scrimmageTD != null) {
      const cur = PROJECTIONS.find(p => _oddsNorm(p.name) + '|' + p.position === key);
      const cr = cur?.projectedStats?.rushTD, cc = cur?.projectedStats?.recTD;
      const share = (cr != null && cc != null && (cr + cc) > 0) ? cr / (cr + cc)
        : rec.position === 'RB' ? 0.8 : rec.position === 'QB' ? 1 : 0.05;
      if (stats.rushTD == null) stats.rushTD = stats.scrimmageTD * share;
      if (stats.recTD == null) stats.recTD = stats.scrimmageTD * (1 - share);
      delete stats.scrimmageTD;
    }
    for (const k of Object.keys(stats)) {
      stats[k] = _oddsRound(stats[k]);
    }
    overlay[key] = stats;
  }
  return { overlay, matched: Object.keys(overlay).length, skipped };
}

// Weighted blend over the committed pool. Only stats the market actually
// prices move; everything else is passed through untouched, so a player can
// carry Vegas yardage next to committed TDs. That is intentional.
function blendProjections(overlay) {
  if (!overlay) return _availPool(PROJECTIONS);
  return PROJECTIONS.map(p0 => {
    // Availability first, blend second: the row is brought to the games he can
    // play, the overlay was already scaled the same way in applyAvailability,
    // and the blend of two pro-rated lines is pro-rated once.
    const p = _withAvailability(p0);
    const v = overlay[_oddsNorm(p.name) + '|' + p.position];
    if (!v) return p;
    const stats = { ...p.projectedStats };
    // vegas[k] = [committed, marketImplied, blended] — shipped to the client so the
    // cheat sheet can flag players whose ranking the odds moved and show the numbers.
    const vg = {};
    let touched = false;
    for (const [k, val] of Object.entries(v)) {
      if (!(k in stats)) continue;                 // only stats the site models
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) continue;
      const before = stats[k];
      stats[k] = _oddsRound((stats[k] + VEGAS_WEIGHT * n) / (1 + VEGAS_WEIGHT));
      vg[k] = [before, _oddsRound(n), stats[k]];
      touched = true;
    }
    return touched ? { ...p, projectedStats: stats, vegas: vg } : p;
  });
}
// The client shows `status` in its injury column (and counts it in the player's
// risk score) until /api/live answers with something fresher. A player the live
// list knows more about than the committed row does is pro-rated here by the
// difference (_availRowFactor); a row that already carries its factor is
// passed through by reference.
function _withAvailability(p) {
  const key = _oddsNorm(p.name) + '|' + p.position;
  const a = _availTable()[key];
  if (!a) return p;
  const rf = _availRowFactor(key);
  let stats = p.projectedStats;
  if (rf < 1) {
    stats = {};
    for (const [k, v] of Object.entries(p.projectedStats || {})) {
      const n = Number(v);
      stats[k] = Number.isFinite(n) ? _oddsRound(n * rf) : v;
    }
  }
  return { ...p, projectedStats: stats, status: a.status, gamesOut: a.gamesOut, note: a.note };
}
// The committed pool with statuses attached, or the pool itself when no row in
// it is listed (so callers that compare by reference still see PROJECTIONS).
function _availPool(pool) {
  const t = _availTable();
  return pool.some(p => t[_oddsNorm(p.name) + '|' + p.position]) ? pool.map(_withAvailability) : pool;
}

// ── §9c. "Vegas vs. Rankings & ADP" column ─────────────────────────────────
// The editorial thesis: a sportsbook has money at risk on every number it
// prints, so its lines are priced off repeatable trends and statistical
// modelling and corrected the moment they are wrong. A ranking costs its author
// nothing. Where the two disagree, the column shows the disagreement and lets
// the reader decide — it never asserts the book is right.
//
// Everything below is COMPUTED from the same cached overlay the projections
// blend uses. Nothing here is hand-written copy, so the column cannot go stale
// while the odds move, and it cannot claim a disagreement that isn't in the data.
//
// HAND-SYNCED with index.html: COLUMN_SCORING mirrors DEFAULT_LEAGUE_CONFIG.
// scoring, COLUMN_CURVE mirrors LEAGUE_MARKET_CURVE, and _colScore mirrors
// scoreSkillPlayer/yardageScore/countScore. There is no build step. If you
// change scoring or the curve on the client, change it here too —
// tools/test-worker-column.mjs asserts the two stay in agreement.
// ── the scoring engine ─────────────────────────────────────────────────────
// ONE implementation of "what is this stat line worth", used by the Vegas
// column, the in-season rankings, the market engine and anything else that
// turns stats into points. It is deliberately a SUPERSET of the three copies
// this repo already carries -- scoreSkillPlayer in index.html, score() in
// it-league.js, and the _colScore this replaces -- rather than a fourth
// variant: same order of operations, same yardage thresholds, same bonus
// arrays, same position-specific reception rule. tools/test-scoring.mjs runs
// this against the it-league.js copy on randomised stat lines and fails if the
// two ever disagree, which is the drift §9c already learned to test for.
//
// Everything is optional and defaulted. A league that does not score two-point
// conversions simply has 0 in those fields; nothing here needs a caller to know
// which fields their league uses.
const SCORING_BASE = {
  passingYardsPerPoint: 25, passingYardsThreshold: 125, passingYardBonuses: [],
  passingTD: 4, passingInt: -2, passing2pt: 2,
  rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingYardBonuses: [],
  rushingTD: 6, rushing2pt: 2,
  receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingYardBonuses: [],
  receivingTD: 6, receiving2pt: 2,
  receptionPoints: 1, receptionBonuses: [],
  rbReceptionPoints: 1, rbReceptionBonuses: [],
  fumbleLost: -2, fumble2pt: 2,
  individualFumbleRecoveryTD: 6, individualKickReturnTD: 6, individualPuntReturnTD: 6
};
// The three presets the rankings page offers, plus the reader's own. Only the
// reception fields differ -- that IS what standard/half/full PPR means, and a
// preset that quietly changed passing touchdowns as well would be lying about
// which knob the reader turned.
const SCORING_PRESETS = {
  standard: { receptionPoints: 0, rbReceptionPoints: 0 },
  half: { receptionPoints: 0.5, rbReceptionPoints: 0.5 },
  ppr: { receptionPoints: 1, rbReceptionPoints: 1 }
};
const SCORING_PRESET_LABEL = { standard: 'Standard', half: 'Half PPR', ppr: 'PPR', custom: 'My League' };

// A caller's rules, made safe. A blanked input in the app saves NaN
// (parseFloat('')), and a NaN divisor would poison every number downstream, so
// every field falls back to the base rather than propagating.
function scoringRules(preset, custom) {
  const out = { ...SCORING_BASE, ...(SCORING_PRESETS[preset] || {}) };
  if (custom && typeof custom === 'object') {
    for (const k of Object.keys(SCORING_BASE)) {
      const v = custom[k];
      if (Array.isArray(SCORING_BASE[k])) {
        if (Array.isArray(v)) {
          out[k] = v.filter(b => b && Number.isFinite(Number(b.at)) && Number.isFinite(Number(b.points)))
                    .map(b => ({ at: Number(b.at), points: Number(b.points) }));
        }
      } else if (Number.isFinite(Number(v))) {
        out[k] = Number(v);
      }
    }
  }
  return out;
}
function _scYards(yards, perPoint, threshold, bonuses) {
  if (yards < threshold) return 0;
  let pts = perPoint > 0 ? yards / perPoint : 0;
  for (const b of bonuses || []) if (yards >= b.at) pts += b.points;
  return pts;
}
function _scCount(count, perEvent, bonuses) {
  if (!count) return 0;
  let pts = count * perEvent;
  for (const b of bonuses || []) if (count >= b.at) pts += b.points;
  return pts;
}
// Stat keys are Iron Tuna's internal names throughout: passYd passTD passInt
// pass2pt rushYd rushTD rush2pt recYd recTD rec2pt rec fumLost fum2pt fumRecTD
// krTD prTD. Every provider adapter normalises INTO these, so nothing
// downstream ever sees a vendor's field names.
function scoreStats(stats, position, rules) {
  const s = rules || SCORING_BASE;
  const st = stats || {};
  let pts = 0;
  pts += _scYards(st.passYd || 0, s.passingYardsPerPoint, s.passingYardsThreshold, s.passingYardBonuses);
  pts += (st.passTD || 0) * s.passingTD;
  pts += (st.passInt || 0) * s.passingInt;
  pts += (st.pass2pt || 0) * s.passing2pt;
  pts += _scYards(st.rushYd || 0, s.rushingYardsPerPoint, s.rushingYardsThreshold, s.rushingYardBonuses);
  pts += (st.rushTD || 0) * s.rushingTD;
  pts += (st.rush2pt || 0) * s.rushing2pt;
  pts += _scYards(st.recYd || 0, s.receivingYardsPerPoint, s.receivingYardsThreshold, s.receivingYardBonuses);
  pts += (st.recTD || 0) * s.receivingTD;
  pts += (st.rec2pt || 0) * s.receiving2pt;
  // Position-specific reception scoring, exactly as the app already supports
  // it: a league can price a back's catch differently from a receiver's.
  if (position === 'RB') pts += _scCount(st.rec || 0, s.rbReceptionPoints, s.rbReceptionBonuses);
  else pts += _scCount(st.rec || 0, s.receptionPoints, s.receptionBonuses);
  pts += (st.fumLost || 0) * s.fumbleLost;
  pts += (st.fum2pt || 0) * s.fumble2pt;
  pts += (st.fumRecTD || 0) * s.individualFumbleRecoveryTD;
  pts += (st.krTD || 0) * s.individualKickReturnTD;
  pts += (st.prTD || 0) * s.individualPuntReturnTD;
  return pts;
}
// What one touchdown is worth to this league, which is what turns an anytime-TD
// probability into fantasy points (§ the Vegas projection below). A receiving
// touchdown for a back and a rushing one are usually both 6, but a league is
// free to price them apart, so the position decides which is quoted.
function tdPointsFor(position, rules) {
  const s = rules || SCORING_BASE;
  return position === 'QB' ? s.rushingTD : (position === 'RB' ? s.rushingTD : s.receivingTD);
}

const COLUMN_SCORING = {
  passingYardsPerPoint: 25, passingYardsThreshold: 125, passingTD: 4, passingInt: -2,
  rushingYardsPerPoint: 10, rushingYardsThreshold: 0, rushingTD: 6,
  receivingYardsPerPoint: 10, receivingYardsThreshold: 0, receivingTD: 6,
  receptionPoints: 1, rbReceptionPoints: 1, fumbleLost: -2
};
const COLUMN_CURVE = {
  QB: [28, 22, 19, 16, 12, 11, 8, 6, 5, 4, 3, 3, 2, 2, 1, 1],
  RB: [48, 45, 43, 37, 34, 31, 28, 26, 25, 22, 21, 20, 17, 13, 12, 10, 9, 9, 8, 7, 7, 7, 6, 5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  WR: [47, 45, 40, 39, 35, 31, 27, 27, 19, 18, 17, 16, 14, 13, 11, 10, 10, 10, 8, 7, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  TE: [36, 31, 22, 16, 12, 10, 8, 7, 6, 6, 3, 2, 2, 2, 1, 1]
};
// The curve's own scale, as on the client. The curve above must ADD UP to it over
// a full 12-team board — see the note on LEAGUE_CURVE_BUDGET in index.html, and
// tools/test-curve-budget.mjs, which pins the total across all three copies.
const COLUMN_CURVE_BUDGET = 1440;
const COLUMN_LEAGUE_BUDGET = 12 * 200; // the site's default league: 12 teams, $200
const COLUMN_MIN_BID = 1;
const COLUMN_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const COLUMN_MIN_RANK_GAP = 2;        // below this the "disagreement" is noise
const COLUMN_MIN_PRICE_GAP = 2;       // ...or a dollar of rounding
const COLUMN_MIN_TD_GAP = 0.5;        // half a season touchdown: below that the TD case is rounding too
// Bump on ANY change to the item shape the front page reads. The response is
// cached publicly for 15 minutes, so without a version in the request URL a
// renamed field means new HTML meets an old cached payload and the page prints
// "undefined" at readers for a quarter of an hour. The client asks for ?v=N and
// only renders items whose shape it recognises; the two together make a
// contract change safe to deploy.
const COLUMN_CONTRACT = 5;   // 5: the digest names the biggest touchdown move, and every mover's market rank
                             // 4: the response carries the day's digest alongside the cases
                             // 3: items carry their stat lines so a reader's own scoring can re-score them
// The player card's own contract, versioned separately from the column's: the
// two endpoints ship different shapes, are cached separately, and one can grow
// a field without invalidating a quarter of an hour of the other's cache.
const PODDS_CONTRACT = 1;
const COLUMN_MAX_ITEMS = 12;          // three days of six-hour slots
const COLUMN_MAX_AGREE = 3;           // agreement cases are filler, never the point
const COLUMN_AGREE_MAX_RANK = 24;     // and only worth printing near the top of a board

// Faithful port of the client's skill-player scoring. Only the stats the site
// actually projects are read, and only skill positions are scored — K and DEF
// carry no market lines, so they are never column material.
// The column's own scoring is the site's default league, run through the one
// engine above rather than through a fourth private copy of the arithmetic.
// COLUMN_SCORING carries no bonus arrays and no two-point fields, so the extra
// terms are all multiplied by an absent stat and contribute nothing -- the
// numbers this returns are identical to the hand-rolled version it replaces,
// which tools/test-worker-column.mjs pins to the digit.
const _COL_RULES = scoringRules(null, COLUMN_SCORING);
function _colScore(stats, position) {
  return scoreStats(stats, position, _COL_RULES);
}

// ── season normalisation, mirrored from the client ─────────────────────────
// The app re-levels each position's projected points to LAST SEASON's actual
// top-K mean before anything is ranked or printed (normalizeToLastYear in
// index.html), so the points on a reader's sheet are NOT the raw scores of the
// stat lines. /api/board — the payload that claims to BE the site's sheet —
// used to ship raw scores (Puka Nacua 356.0 against 330.0 on the sheet), so
// any copy quoting its season totals disagreed with the board it was quoting.
// The factor is flat per position, so ranks and prices never move; only the
// printed points do. The vegas column's pts fields deliberately stay raw:
// contract 3 promises they re-score from the shipped stat lines to the digit,
// and a pool-level factor cannot ride a stat line.
//
// HAND-SYNCED with index.html, same as COLUMN_SCORING above: `mean` is the
// top-K mean of the client's LAST_YEAR_*_STATS scored at the default league's
// scoring, and `k` is normalizeToLastYear's startK at 12 teams (round(12*1.1)
// for QB/TE, round(12*2.6) for RB/WR). tools/test-worker-column.mjs recomputes
// both from index.html and fails when they drift.
const COLUMN_NORM = {
  QB: { mean: 306.8246, k: 13 },
  RB: { mean: 236.5774, k: 31 },
  WR: { mean: 227.4839, k: 31 },
  TE: { mean: 192.9, k: 13 }
};
// One factor per position for a given pool of scored points — the client's
// rule exactly: top-K projected mean against last year's, skipped inside the
// 2% dead zone, and only ever applied to positive scores (the client's filter
// keeps zero- and negative-point players out of both the mean and the scale).
function _colNormFactors(ptsByPos) {
  const out = {};
  for (const pos of Object.keys(COLUMN_NORM)) {
    out[pos] = 1;
    const arr = (ptsByPos[pos] || []).filter(v => v > 0).sort((a, b) => b - a);
    if (arr.length < 3) continue;
    const K = Math.max(3, Math.min(COLUMN_NORM[pos].k, arr.length));
    const projMean = arr.slice(0, K).reduce((a, b) => a + b, 0) / K;
    if (!(projMean > 0)) continue;
    const f = COLUMN_NORM[pos].mean / projMean;
    if (f >= 0.98 && f <= 1.02) continue;
    out[pos] = f;
  }
  return out;
}
function _colNormApply(pts, factor) {
  return pts > 0 ? pts * factor : pts;
}

// The stat line a card is built from, trimmed to the stats the site actually
// models and rounded once. The front page ships this to the reader's browser so
// a league with half-PPR or six-point passing TDs can re-score the card in its
// OWN scoring instead of reading the site default's points back at itself.
// Points are a pure function of a stat line, so shipping the line is the whole
// of what a client needs — and it stays a public, cacheable payload, because
// nothing in it is specific to any reader.
const COLUMN_STAT_KEYS = ['passYd', 'passTD', 'passInt', 'rushYd', 'rushTD',
                          'recYd', 'recTD', 'rec', 'fumLost'];
function _colStatLine(stats) {
  const out = {};
  for (const k of COLUMN_STAT_KEYS) {
    const n = Number((stats || {})[k]);
    if (Number.isFinite(n)) out[k] = _oddsRound(n);
  }
  return out;
}

// Curve slot -> dollars in the site's default league.
function _colPrice(position, rankIndex) {
  const curve = COLUMN_CURVE[position] || [];
  const scale = COLUMN_LEAGUE_BUDGET / COLUMN_CURVE_BUDGET;
  // Only curve prices scale with the budget; past the curve the room pays the
  // min bid, full stop (mirrors calculateMarketValues in index.html).
  if (rankIndex >= curve.length) return COLUMN_MIN_BID;
  return Math.max(COLUMN_MIN_BID, Math.round(curve[rankIndex] * scale));
}

// ── §9d. the site's own board, served ──────────────────────────────────────
// The board /it-league.js quotes to a reader with no league of their own used
// to be a STATIC block generated from the committed PROJECTIONS. The app is
// served `blendProjections(overlay)` — the same projections re-blended with
// TODAY's odds — so the two were different boards, and the gap was the whole
// of a bug: a story quoted "$47 on the consensus sheet" for a back whose row
// on the reader's screen said $25, because the library's copy had not seen the
// odds that moved him.
//
// A static board cannot track a feed that refreshes daily. So the board is
// computed HERE, off the same pool the app gets, and served. One board, one
// answer, and no regeneration step anybody can forget to run.
//
// Prices only, no stat lines. The reader's own board already carries their
// scoring; this exists so the SITE side of a comparison is the site's real
// sheet, and shipping stat lines would invite a second valuation to grow here.
const BOARD_CONTRACT = 1;
let _BOARD_CACHE = null, _BOARD_AT = 0;
async function boardPayload(env) {
  const now = Date.now();
  if (_BOARD_CACHE && now - _BOARD_AT < 900000) return _BOARD_CACHE;
  let pool = null, asOf = 0;
  try {
    const cached = await oddsCacheRead(env);
    if (cached && cached.overlay) { pool = blendProjections(cached.overlay); asOf = cached.updatedAt || 0; }
  } catch (e) { /* the committed pool is a worse board, not a broken one */ }
  if (!pool) pool = blendProjections(null);    // committed rows, availability still applied
  const byPos = {};
  for (const p of pool) {
    if (COLUMN_POSITIONS.indexOf(p.position) < 0) continue;
    (byPos[p.position] = byPos[p.position] || []).push({
      n: p.name, pos: p.position, pts: _colScore(p.projectedStats || {}, p.position)
    });
  }
  // Points on the client's scale, not the raw stat-line scale — see COLUMN_NORM.
  // Flat per position, so the ranking below is untouched.
  const normF = _colNormFactors(Object.fromEntries(
    Object.entries(byPos).map(([pos, list]) => [pos, list.map(p => p.pts)])));
  for (const pos of Object.keys(byPos)) {
    for (const p of byPos[pos]) p.pts = _oddsRound(_colNormApply(p.pts, normF[pos]));
  }
  const players = [];
  for (const pos of COLUMN_POSITIONS) {
    const list = (byPos[pos] || []).sort((a, b) => b.pts - a.pts);
    // Rank within position IS the curve slot, exactly as calculateMarketValues
    // does it on the client. `v` is Market Price, the column a story means.
    list.forEach((p, i) => players.push({ n: p.n, pos: p.pos, v: _colPrice(pos, i), pts: p.pts }));
  }
  _BOARD_CACHE = { ok: players.length > 0, contract: BOARD_CONTRACT, asOf,
                   teams: 12, budget: 200, players };
  _BOARD_AT = now;
  return _BOARD_CACHE;
}

// Where the RANKINGS put each team's offence, on the same points model
// buildTeamEnvOverlay uses for the Vegas side. Without this a card can only say
// "Vegas has San Francisco 4th in implied points", which reads as a promotion
// even when the odds are a downgrade — the team-environment factor is a RATIO,
// so what matters is Vegas's rank against the ranking's rank, not either alone.
// HAND-SYNCED with buildTeamEnvOverlay's points model; change both together.
function _colTeamProjRank() {
  const td = {}, kick = {};
  for (const p of PROJECTIONS) {
    const t = teamKey(p.team);
    if (!t || t === 'FA') continue;
    const st = p.projectedStats || {};
    td[t] = (td[t] || 0) + (st.passTD || 0) + (st.rushTD || 0);
    kick[t] = (kick[t] || 0) + (st.xpMade || 0) + (st.fgMade || 0) * 3;
  }
  const teams = Object.keys(td).filter(t => td[t] > 0);
  const kicked = teams.filter(t => kick[t] > 0).map(t => kick[t]);
  const kMean = kicked.length ? kicked.reduce((a, b) => a + b, 0) / kicked.length : 0;
  const pts = {};
  for (const t of teams) pts[t] = td[t] * 6 + (kick[t] > 0 ? kick[t] : kMean);
  const rank = {};
  Object.entries(pts).sort((a, b) => b[1] - a[1]).forEach(([t], i) => { rank[t] = i + 1; });
  return rank;
}

// What THIS site actually ships for a player: the committed projection with the
// odds blended in at VEGAS_WEIGHT. Mirrors blendProjections — the column must
// quote the number a reader will find on their own cheat sheet, not a private one.
function _colBlendStats(committed, market) {
  const out = { ...committed };
  for (const [k, v] of Object.entries(market)) {
    if (!(k in out)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    out[k] = _oddsRound((out[k] + VEGAS_WEIGHT * n) / (1 + VEGAS_WEIGHT));
  }
  return out;
}

// The market's view of a player at FULL strength — not the 3:1 blend the sheet
// serves. The column is about what the odds say on their own, so it must not be
// diluted by the projections it is being compared against.
function _colVegasStats(p, overlay) {
  const v = overlay[_oddsNorm(p.name) + '|' + p.position];
  if (!v) return null;
  const stats = { ...p.projectedStats };
  const moved = [];
  for (const [k, val] of Object.entries(v)) {
    if (!(k in stats)) continue;                 // only stats the site models
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) continue;
    if (stats[k] === n) continue;
    moved.push({ stat: k, consensus: stats[k], market: n });
    stats[k] = n;
  }
  return moved.length ? { stats, moved } : null;
}

// Rank every skill player twice — once off the committed projections (the
// "rankings" board) and once off the market's numbers (the "odds" board) — and
// hand back a row for EVERY one of them.
//
// Three surfaces read this one computation, and that is the point: the front
// page's column is a filter over these rows, a player card is a lookup into
// them, and the daily digest is a count of them. Computing the board once means
// the card and the column can never tell a reader two different stories about
// the same player.
//
// Players the market does not price still get a row, and still occupy slots on
// both boards: when the odds push someone up, somebody else is pushed down. For
// the column, hiding that would overstate the gap for the player who moved. For
// a card it is the answer itself — "no book touched his numbers, but the backs
// around him went up, so he slides two slots" is a true and useful thing to say
// about a man nobody priced.
function buildVegasBoard(overlay, ctx) {
  if (!overlay || typeof overlay !== 'object') return { ok: false, error: 'no_overlay', rows: [] };
  const projTeamRank = _colTeamProjRank();
  const byPos = {};
  // The consensus side is the pool the app ships (availability applied), so a
  // man the live list just put on IR reads as an injury, not as a market fade.
  for (const p of _availPool(PROJECTIONS)) {
    if (!COLUMN_POSITIONS.includes(p.position)) continue;
    const st = p.projectedStats || {};
    const veg = _colVegasStats(p, overlay);
    (byPos[p.position] = byPos[p.position] || []).push({
      name: p.name, team: teamKey(p.team), position: p.position,
      // Three boards, and the distinction is the whole column:
      //   consensus — the committed analyst projections, odds-blind. This is
      //               what a normal ranking or ADP list is built on.
      //   ironTuna  — what THIS site ships: the same projections with the odds
      //               blended in at VEGAS_WEIGHT. The reader can go look it up.
      //   market    — the odds alone, undiluted, quoted as the underlying signal.
      ptsConsensus: _colScore(st, p.position),
      ptsIronTuna: _colScore(veg ? _colBlendStats(st, veg.stats) : st, p.position),
      ptsMarket: _colScore(veg ? veg.stats : st, p.position),
      statsConsensus: st,
      statsIronTuna: veg ? _colBlendStats(st, veg.stats) : st,
      statsMarket: veg ? veg.stats : st,
      moved: veg ? veg.moved : null,
      // Games he can actually play, from the availability list: the digest's
      // per-game touchdown chance divides a season line by THIS, not by 17.
      gamesOut: Number(p.gamesOut) || 0
    });
  }

  const rows = [];
  for (const pos of COLUMN_POSITIONS) {
    const list = byPos[pos] || [];
    if (list.length < 2) continue;
    // Keyed by list index, never by name: two players sharing a name at one
    // position would otherwise overwrite each other's rank and mis-price both.
    const rankOf = key => {
      const order = list.map((r, i) => i).sort((a, b) => list[b][key] - list[a][key]);
      const m = new Map();
      order.forEach((srcIdx, rank) => m.set(srcIdx, rank));
      return m;
    };
    const rCon = rankOf('ptsConsensus'), rIT = rankOf('ptsIronTuna'), rMkt = rankOf('ptsMarket');
    const curveLen = (COLUMN_CURVE[pos] || []).length;
    for (let li = 0; li < list.length; li++) {
      const r = list[li];
      const iC = rCon.get(li), iI = rIT.get(li), iM = rMkt.get(li);
      const priceConsensus = _colPrice(pos, iC), priceIronTuna = _colPrice(pos, iI);
      const rankDelta = iC - iI;                       // + => Iron Tuna rates them higher
      const priceDelta = priceIronTuna - priceConsensus;
      rows.push({
        name: r.name, team: r.team, position: pos,
        rankConsensus: iC + 1, rankIronTuna: iI + 1, rankMarket: iM + 1, rankDelta,
        // Raw stat-line scores, DELIBERATELY un-normalised: contract 3 promises
        // that re-scoring the shipped stat line reproduces these to the digit
        // (test-it-league §9), so they can never carry the pool-level season
        // normalisation. front.html calibrates them onto the reader's board
        // per player (myCase's `k`); the SHEET-scale boards are /api/board and
        // it-league's baked block, which do carry it — see COLUMN_NORM.
        ptsConsensus: Math.round(r.ptsConsensus * 10) / 10,
        ptsIronTuna: Math.round(r.ptsIronTuna * 10) / 10,
        ptsMarket: Math.round(r.ptsMarket * 10) / 10,
        ptsDelta: Math.round((r.ptsIronTuna - r.ptsConsensus) * 10) / 10,
        // The three boards' stat lines, for a reader whose league does not score
        // the way this page's defaults do. Same three boards as the points above.
        statsConsensus: _colStatLine(r.statsConsensus),
        statsIronTuna: _colStatLine(r.statsIronTuna),
        statsMarket: _colStatLine(r.statsMarket),
        priceConsensus, priceIronTuna, priceDelta,
        side: rankDelta > 0 ? 'under' : rankDelta < 0 ? 'over' : 'flat',
        moved: r.moved ? r.moved.map(m => ({ stat: m.stat, consensus: _oddsRound(m.consensus), market: _oddsRound(m.market) })) : [],
        // `priced` is whether a book moved THIS man's own numbers; `draftable`
        // is whether either board still has him inside the curve. The column
        // needs both to be true, a card needs neither.
        priced: !!r.moved,
        draftable: iC < curveLen || iI < curveLen,
        gamesOut: r.gamesOut,
        teamImplied: ctx && ctx.ppg && ctx.ppg[r.team] != null ? Math.round(ctx.ppg[r.team] * 10) / 10 : null,
        teamRank: ctx && ctx.rank && ctx.rank[r.team] != null ? ctx.rank[r.team] : null,
        teamRankConsensus: projTeamRank[r.team] != null ? projTeamRank[r.team] : null
      });
    }
  }
  return { ok: true, rows, scanned: PROJECTIONS.length };
}

// Is the gap between the two boards big enough to be worth a reader's time, or
// is it a rounding artefact? One definition, used by the column, the digest and
// every card, so the three can never disagree about what counts as a move.
function _colMeaningful(r) {
  return Math.abs(r.rankDelta) >= COLUMN_MIN_RANK_GAP || Math.abs(r.priceDelta) >= COLUMN_MIN_PRICE_GAP;
}

// What the board looks like TODAY, in numbers rather than in one player's case.
// This is the front page's dateline: it turns over with every daily odds pull,
// it is counted rather than written, and it says how wide the disagreement is
// before the reader has clicked through a single case.
function buildVegasDigest(board) {
  const rows = (board && board.rows) || [];
  const draftable = rows.filter(r => r.draftable);
  const priced = rows.filter(r => r.priced).length;
  const moved = draftable.filter(_colMeaningful);
  const up = moved.filter(r => r.rankDelta > 0).length;
  const down = moved.filter(r => r.rankDelta < 0).length;
  const dollars = moved.reduce((a, r) => a + Math.abs(r.priceDelta), 0);
  const byPos = {};
  for (const pos of COLUMN_POSITIONS) {
    const at = moved.filter(r => r.position === pos);
    byPos[pos] = { moved: at.length, up: at.filter(r => r.rankDelta > 0).length,
                   down: at.filter(r => r.rankDelta < 0).length,
                   dollars: at.reduce((a, r) => a + Math.abs(r.priceDelta), 0) };
  }
  const brief = r => r ? {
    name: r.name, team: r.team, position: r.position,
    // All three boards, because the front page prints all three side by side:
    // where the consensus has him, where the odds alone put him, and where the
    // site's blend lands. Two of the three would leave the reader inferring the
    // third, and inferring it wrong.
    rankConsensus: r.rankConsensus, rankMarket: r.rankMarket, rankIronTuna: r.rankIronTuna,
    rankDelta: r.rankDelta,
    priceConsensus: r.priceConsensus, priceIronTuna: r.priceIronTuna, priceDelta: r.priceDelta
  } : null;
  const rises = moved.filter(r => r.priceDelta > 0).sort(_colByRise);
  const fades = moved.filter(r => r.priceDelta < 0).sort(_colByFade);
  // The club the two boards disagree about most, in both directions. One row
  // per team: every skill player on a roster carries the same pair of ranks, so
  // counting them player-by-player would just be counting roster sizes.
  const teams = new Map();
  for (const r of rows) {
    if (!r.team || r.teamRank == null || r.teamRankConsensus == null) continue;
    if (!teams.has(r.team)) teams.set(r.team, {
      team: r.team, implied: r.teamImplied,
      rankMarket: r.teamRank, rankConsensus: r.teamRankConsensus,
      gap: r.teamRankConsensus - r.teamRank       // + => the market likes them more
    });
  }
  const clubs = [...teams.values()];
  const teamUp = clubs.filter(t => t.gap > 0).sort((a, b) => b.gap - a.gap)[0] || null;
  const teamDown = clubs.filter(t => t.gap < 0).sort((a, b) => a.gap - b.gap)[0] || null;
  // The touchdown case. No free feed carries an anytime-TD price, so this is
  // NOT a quoted prop: it is the biggest gap between what the consensus
  // projects for a skill player's touchdowns and what the game lines imply,
  // with a per-game chance derived from the blended season line. Poisson on
  // (season TDs / games he can play) is the standard way to turn a season total
  // into "scores at least once this week"; it is labelled as derived so a
  // reader never mistakes it for a book's number. Quarterbacks are excluded
  // because their touchdowns are mostly thrown, and a thrown touchdown is not
  // an anytime-TD.
  const tdOf = st => (Number((st || {}).rushTD) || 0) + (Number((st || {}).recTD) || 0);
  const tdCases = draftable
    .filter(r => r.priced && r.position !== 'QB')
    .map(r => ({ r, c: tdOf(r.statsConsensus), m: tdOf(r.statsMarket), i: tdOf(r.statsIronTuna) }))
    .filter(x => x.m - x.c >= COLUMN_MIN_TD_GAP)
    .sort((a, b) => (b.m - b.c) - (a.m - a.c) || b.r.priceDelta - a.r.priceDelta || (a.r.name < b.r.name ? -1 : 1));
  let topTd = null;
  if (tdCases.length) {
    const t = tdCases[0];
    const games = Math.max(1, AVAILABILITY_GAMES - (Number(t.r.gamesOut) || 0));
    topTd = { ...brief(t.r),
      tdConsensus: _oddsRound(t.c), tdMarket: _oddsRound(t.m), tdIronTuna: _oddsRound(t.i),
      games,
      anytimeTd: Math.round((1 - Math.exp(-t.i / games)) * 100),
      anytimeTdBasis: 'derived' };
  }
  return {
    scanned: board.scanned || 0, priced, draftable: draftable.length,
    moved: moved.length, up, down, dollars,
    byPos, topUp: brief(rises[0]), topDown: brief(fades[0]), topTd, teamUp, teamDown
  };
}
// Dollars first, then points, then name — the third key only so a tie cannot
// reorder the digest between two calls that read the same overlay. A dateline
// that reshuffles itself on a page reload reads as noise, not as news.
function _colByRise(a, b) {
  return b.priceDelta - a.priceDelta || b.ptsDelta - a.ptsDelta || (a.name < b.name ? -1 : 1);
}
function _colByFade(a, b) {
  return a.priceDelta - b.priceDelta || a.ptsDelta - b.ptsDelta || (a.name < b.name ? -1 : 1);
}

// The front page's cases: the players the two boards disagree about most.
function buildVegasColumn(overlay, ctx) {
  const board = buildVegasBoard(overlay, ctx);
  if (!board.ok) return { ok: false, error: board.error, items: [] };

  const conflicts = [], agreements = [];
  for (const r of board.rows) {
    if (!r.priced) continue;                           // the market never priced them
    if (!r.draftable) continue;                        // undraftable on either board
    const item = { ...r };
    delete item.priced; delete item.draftable;
    if (_colMeaningful(r)) {
      conflicts.push({ ...item, kind: 'conflict' });
    } else if (r.rankConsensus === r.rankIronTuna && r.rankConsensus - 1 < COLUMN_AGREE_MAX_RANK) {
      // Confirmation, not conflict: the market priced this player and landed
      // on the same slot the consensus did. Only worth printing near the top
      // of the board — "the odds agree the WR61 is the WR61" says nothing.
      agreements.push({ ...item, kind: 'agree' });
    }
  }

  // Dollars first: an auction reader feels a $9 gap far more than three rank slots.
  conflicts.sort((a, b) => Math.abs(b.priceDelta) - Math.abs(a.priceDelta)
    || Math.abs(b.ptsDelta) - Math.abs(a.ptsDelta));
  // Agreements are a FALLBACK, never competition for a real disagreement: they
  // only fill slots the conflicts left empty, and never more than a few. The
  // expensive end first — a confirmed $50 price is worth reading, a confirmed $2
  // one is not.
  agreements.sort((a, b) => b.priceConsensus - a.priceConsensus);
  const room = Math.max(0, COLUMN_MAX_ITEMS - conflicts.length);
  const filler = agreements.slice(0, Math.min(room, COLUMN_MAX_AGREE));
  const items = conflicts.slice(0, COLUMN_MAX_ITEMS).concat(filler);
  return { ok: true, items, conflicts: Math.min(conflicts.length, COLUMN_MAX_ITEMS),
           agreements: filler.length, scanned: PROJECTIONS.length,
           // The dateline. Twelve cases is three days of six-hour slots, so the
           // rotation alone cannot tell a reader what changed TODAY; the digest
           // is counted fresh off every daily pull and does.
           digest: buildVegasDigest(board) };
}

// One player's standing on the same board, for his card. Everything the column
// says about its twelve is said here about all four hundred — a card that only
// answered for the players who happened to make the front page would leave the
// rest of the board looking like the odds had no opinion about them at all.
//
// `rank` is his place in the day's queue of risers or faders, which is the
// honest way to size a gap: "+$4" means nothing until you know whether that is
// the biggest raise on the board or the fortieth.
function buildPlayerOdds(overlay, ctx, name, position) {
  const board = buildVegasBoard(overlay, ctx);
  if (!board.ok) return { ok: false, error: board.error, player: null };
  return playerOddsFrom(board, buildVegasDigest(board), name, position);
}
// The lookup, split out from the build so a warm isolate answers four hundred
// cards off one board instead of re-ranking the league for every one of them.
function playerOddsFrom(board, digest, name, position) {
  if (!board || !board.ok) return { ok: false, error: (board && board.error) || 'no_overlay', player: null };
  const pos = String(position || '').toUpperCase();
  const want = _oddsNorm(name);
  if (!want) return { ok: true, player: null, reason: 'no_player', digest };
  if (!COLUMN_POSITIONS.includes(pos)) {
    // Kickers and defences are on the board and in the lookup. Their
    // PROJECTIONS do move with the odds — buildTeamEnvOverlay prices both off
    // the clubs' implied points — but this column ranks a player against an
    // auction price, and COLUMN_CURVE covers the four skill positions. The card
    // says so; hiding the section reads as a bug.
    return { ok: true, player: null, reason: 'unpriced_position', digest };
  }
  const hit = board.rows.filter(r => r.position === pos && _oddsNorm(r.name) === want);
  // Two men, one normalised name, one position: there is no way to tell which
  // card is being looked at, and guessing would put another player's price on
  // this page. Say nothing instead.
  if (hit.length !== 1) return { ok: true, player: null, reason: hit.length ? 'ambiguous' : 'off_board', digest };
  const r = hit[0];
  const moved = board.rows.filter(x => x.draftable && _colMeaningful(x));
  const queue = r.priceDelta > 0 ? moved.filter(x => x.priceDelta > 0).sort(_colByRise)
              : r.priceDelta < 0 ? moved.filter(x => x.priceDelta < 0).sort(_colByFade)
              : [];
  const at = queue.findIndex(x => x === r);
  const player = { ...r,
    meaningful: _colMeaningful(r),
    // His place in today's queue, and how long the queue is. Both, or the
    // number is unreadable: 4th of 6 and 4th of 90 are not the same sentence.
    queueRank: at >= 0 ? at + 1 : null,
    queueOf: queue.length || null };
  return { ok: true, player, digest };
}

// ── D1 cache ───────────────────────────────────────────────────────────────
async function oddsCacheInit(env) {
  await env.LEADS_DB.prepare(
    'CREATE TABLE IF NOT EXISTS odds_overlay (id INTEGER PRIMARY KEY, payload TEXT, provider TEXT, matched INTEGER, updated_at INTEGER)'
  ).run();
}
async function oddsCacheRead(env) {
  if (!env || !env.LEADS_DB) return null;
  // The live availability list has to be in place before the overlay is scaled
  // by it (and before blendProjections reads it); a failure here means the
  // committed block alone, never a missing overlay.
  try { await availabilityTable(env); } catch (e) {}
  try {
    const row = await env.LEADS_DB.prepare('SELECT payload, provider, matched, updated_at FROM odds_overlay WHERE id=1').first();
    if (!row || !row.payload) return null;
    if (!row.updated_at || Date.now() - row.updated_at > ODDS_MAX_AGE_MS) return null;
    return { overlay: applyAvailability(JSON.parse(row.payload)), provider: row.provider, matched: row.matched, updatedAt: row.updated_at };
  } catch (e) { return null; }
}
// The column's money-line evidence: implied points per game per team, and the
// league rank that goes with it. Stored as row 2 of the same table so it shares
// the overlay's lifecycle and needs no migration — a reader that only wants the
// overlay never sees it.
async function oddsCtxWrite(env, ppg) {
  if (!ppg || !Object.keys(ppg).length) return;
  await oddsCacheInit(env);
  const rank = {};
  Object.entries(ppg).sort((a, b) => b[1] - a[1]).forEach(([t], i) => { rank[t] = i + 1; });
  await env.LEADS_DB.prepare(
    'INSERT OR REPLACE INTO odds_overlay (id, payload, provider, matched, updated_at) VALUES (2, ?, ?, ?, ?)'
  ).bind(JSON.stringify({ ppg, rank }), 'teamctx', Object.keys(ppg).length, Date.now()).run();
}
async function oddsCtxRead(env) {
  if (!env || !env.LEADS_DB) return null;
  try {
    const row = await env.LEADS_DB.prepare('SELECT payload, updated_at FROM odds_overlay WHERE id=2').first();
    if (!row || !row.payload) return null;
    if (!row.updated_at || Date.now() - row.updated_at > ODDS_MAX_AGE_MS) return null;
    return JSON.parse(row.payload);
  } catch (e) { return null; }
}
async function oddsCacheWrite(env, overlay, provider, matched) {
  await oddsCacheInit(env);
  await env.LEADS_DB.prepare(
    'INSERT OR REPLACE INTO odds_overlay (id, payload, provider, matched, updated_at) VALUES (1, ?, ?, ?, ?)'
  ).bind(JSON.stringify(overlay), provider, matched, Date.now()).run();
}
// The live availability list: row 3 of the same table, same lifecycle, no
// migration. payload = { asOf, players: { "<norm>|<POS>": { name, position,
// team, status, gamesOut, note, source, asOf } } }, provider 'espn-injuries',
// matched = the number of board players listed, updated_at = when it was pulled.
async function availabilityCacheWrite(env, built) {
  await oddsCacheInit(env);
  await env.LEADS_DB.prepare(
    'INSERT OR REPLACE INTO odds_overlay (id, payload, provider, matched, updated_at) VALUES (3, ?, ?, ?, ?)'
  ).bind(JSON.stringify({ asOf: built.asOf, players: built.players }), 'espn-injuries', built.matched, Date.now()).run();
}
// Strict on the way back: a row that is not exactly the shape written above is
// not used at all, rather than half-used.
function _availValidPlayers(players) {
  if (!players || typeof players !== 'object' || Array.isArray(players)) return null;
  const out = {};
  for (const [k, v] of Object.entries(players)) {
    if (!/^[a-z]*\|[A-Z]{1,4}$/.test(k) || !v || typeof v !== 'object') return null;
    const g = Number(v.gamesOut);
    if (typeof v.status !== 'string' || !v.status || !Number.isFinite(g) || g < 1 || g > AVAILABILITY_GAMES) return null;
    out[k] = { ...v, gamesOut: g };
  }
  return out;
}
async function availabilityCacheRead(env) {
  if (!env || !env.LEADS_DB) return null;
  try {
    const row = await env.LEADS_DB.prepare('SELECT payload, provider, matched, updated_at FROM odds_overlay WHERE id=3').first();
    if (!row || !row.payload) return null;
    if (!row.updated_at || Date.now() - row.updated_at > AVAIL_MAX_AGE_MS) return null;
    const j = JSON.parse(row.payload);
    const players = _availValidPlayers(j && j.players);
    if (!players) return null;
    return { players, asOf: String(j.asOf || ''), provider: row.provider, matched: row.matched, updatedAt: row.updated_at };
  } catch (e) { return null; }
}

// ── orchestration ──────────────────────────────────────────────────────────
async function runOddsRefresh(env) {
  if (!env || !env.LEADS_DB) return { ok: false, error: 'no_db' };
  const tried = [];
  const merged = {};
  const used = [];
  for (const p of ODDS_PROVIDERS) {
    if (p.needs && !p.needs(env)) { tried.push({ provider: p.name, skipped: 'not configured' }); continue; }
    let overlay = null, info = {};
    try {
      const raw = await p.fn(env);
      if (p.kind === 'teamenv') {
        const r = buildTeamEnvOverlay(raw);
        overlay = r.overlay;
        info = { teams: r.teams, matched: r.matched };
        // Keep the implied team points behind the overlay: the Vegas column
        // quotes them as the money-line evidence for a call. The provider works
        // in season totals now; the column has always printed a per-game number,
        // so it is divided here rather than changing what a reader sees. Best
        // effort — the overlay itself must never fail to write because this did.
        try {
          const ppg = {};
          for (const [t, v] of Object.entries(raw || {})) {
            if (v && v.games > 0 && Number.isFinite(v.pf)) ppg[t] = v.pf / v.games;
          }
          await oddsCtxWrite(env, ppg);
        } catch (e) { console.error('odds ctx write failed:', e && e.message); }
      } else {
        const r = buildVegasOverlay(raw);
        overlay = r.overlay;
        info = { rows: (raw || []).length, matched: r.matched, skipped: r.skipped };
      }
    } catch (e) {
      tried.push({ provider: p.name, kind: p.kind, error: (e && e.message) || 'failed' });
      continue;
    }
    // Earlier providers win per player+stat, so a real player prop is never
    // overwritten by the coarser team-wide inference behind it.
    let added = 0;
    for (const [k, stats] of Object.entries(overlay || {})) {
      const dst = merged[k] || (merged[k] = {});
      for (const [stat, v] of Object.entries(stats)) if (!(stat in dst)) { dst[stat] = v; added++; }
    }
    tried.push({ provider: p.name, kind: p.kind, ...info, contributed: added });
    if (added) used.push(p.name);
  }
  const matched = Object.keys(merged).length;
  // A thin merge is treated as broken and the previous good overlay is kept.
  if (matched < ODDS_MIN_MATCHED) return { ok: false, error: 'insufficient_coverage', matched, tried };
  await oddsCacheWrite(env, merged, used.join('+') || 'none', matched);
  _PROJ_ENC = null;                            // force re-encode with the new blend
  // Everything downstream of the overlay is now describing yesterday's lines.
  // The caches would age out on their own inside the quarter hour, but the pull
  // is a DAILY event and the whole promise of these two surfaces is that they
  // are current — so they are dropped the moment the numbers behind them move.
  _COLUMN_CACHE = null; _COLUMN_AT = 0;
  _PODDS_BOARD = null; _PODDS_BOARD_AT = 0;
  return { ok: true, provider: used.join('+'), matched, tried };
}

// ESPN's public injury report. Keyless; the same feed tools/apply-availability.mjs
// --fetch reads. ESPN's edge refuses browser-looking user agents from
// non-browsers, and accepts a plain product token, so the token is fixed here.
async function fetchInjuriesEspn() {
  const r = await fetch(AVAIL_FEED_URL, { headers: { 'user-agent': 'iron-tuna-availability/1.0', 'accept': 'application/json' } });
  if (!r.ok) throw new Error('espn injuries http ' + r.status);
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('espn injuries: unparseable response'); }
  if (!j || !Array.isArray(j.injuries)) throw new Error('espn injuries: unexpected shape');
  return j;
}
// The availability counterpart of runOddsRefresh: pull, reduce to board players
// on reserve lists, refuse anything thin, write row 3. Nothing here ever edits
// the committed block; the request path unions the two (availabilityMerge).
async function runAvailabilityRefresh(env) {
  if (!env || !env.LEADS_DB) return { ok: false, error: 'no_db' };
  let feed;
  try { feed = await fetchInjuriesEspn(); }
  catch (e) { return { ok: false, error: (e && e.message) || 'failed' }; }
  let built;
  try { built = buildAvailabilityOverlay(feed); }
  catch (e) { return { ok: false, error: 'build failed: ' + ((e && e.message) || 'failed') }; }
  const info = { teams: built.teams, entries: built.entries, matched: built.matched, skipped: built.skipped, asOf: built.asOf };
  if (built.teams < AVAIL_MIN_TEAMS) return { ok: false, error: 'thin_feed', ...info };
  if (built.matched < AVAIL_MIN_MATCHED) return { ok: false, error: 'insufficient_coverage', ...info };
  await availabilityCacheWrite(env, built);
  // The merged table, the encoded pool and everything ranked off it are now
  // describing yesterday's list; drop them the way runOddsRefresh does.
  _AVAIL_AT = 0;
  _PROJ_ENC = null; _PROJ_BLEND_AT = 0;
  _COLUMN_CACHE = null; _COLUMN_AT = 0;
  _PODDS_BOARD = null; _PODDS_BOARD_AT = 0;
  _BOARD_CACHE = null; _BOARD_AT = 0;
  return { ok: true, provider: 'espn-injuries', ...info,
           added: Object.keys(built.players).filter(k => !AVAILABILITY[k]),
           notInFeed: Object.keys(AVAILABILITY).filter(k => !built.players[k]) };
}
// What /api/admin/odds-status?availability=1 prints: the live row's age and
// size, and every player the merged list touches, with the number each side
// contributed and the factor his served row carries.
async function availabilityReport(env) {
  const table = await availabilityTable(env);
  const live = await availabilityCacheRead(env);
  const byKey = _availBoardIndex();
  const affected = Object.entries(table).map(([key, a]) => {
    const p = byKey.get(key) || {};
    return { key, name: p.name || key.split('|')[0], position: p.position || key.split('|')[1], team: p.team || '',
             status: a.status, gamesOut: a.gamesOut, committedGamesOut: a.committedGamesOut,
             from: a.live ? 'live' : 'committed', asOf: a.asOf || '',
             factor: +_availF(a.gamesOut).toFixed(3), rowFactor: +_availRowFactor(key).toFixed(3), note: a.note || '' };
  }).sort((x, y) => x.position.localeCompare(y.position) || x.name.localeCompare(y.name));
  return {
    feed: AVAIL_FEED_URL,
    live: live ? { asOf: live.asOf, matched: live.matched, updatedAt: live.updatedAt, ageHours: +((Date.now() - live.updatedAt) / 3600000).toFixed(1) } : null,
    serving: live ? 'committed block + live row (union, live wins, never fewer games out)' : 'committed block only (no usable live row)',
    committed: Object.keys(AVAILABILITY).length,
    merged: affected.length,
    addedByLive: affected.filter(a => a.from === 'live' && !a.committedGamesOut).map(a => a.name),
    affected
  };
}

// ── the NFL season and week ────────────────────────────────────────────────
// WHY THIS EXISTS. Every in-season surface has to answer one question before it
// can say anything at all: what week is it. Taking that from the calendar --
// "Tuesday starts a new week" -- is wrong in exactly the places readers use
// most. Thursday night openers, the 9:30am ET international kickoffs, the
// Saturday doubleheaders in Weeks 16 and 18, a flexed Sunday night game, a
// Monday doubleheader, Christmas and Thanksgiving fixtures, and every postseason
// round, which is a WEEK with three days of games in it and no fixed weekday at
// all. A weekday rule is also wrong for a whole day every single week: it either
// turns a week over while Monday Night Football is still being played, or leaves
// last week up until an arbitrary hour on Tuesday.
//
// So the week comes from the schedule itself. THE RULE: a week is current until
// its own last game has finished. Nothing else decides it.
//
// TWO SOURCES, on the same provider pattern the odds refresh already uses.
//   nflverse games.csv  The spine. Every regular-season and playoff fixture,
//                       months ahead, with the betting lines already on it --
//                       the same file the odds overlay reads (HANDOFF §9b). It
//                       carries NO preseason games at all, which is the whole
//                       reason there is a second source.
//   ESPN scoreboard     The live layer: the preseason fixtures nflverse omits,
//                       per-game status and score, and playoff fixtures as the
//                       bracket is set rather than when the CSV is republished.
//
// NEITHER IS FETCHED ON A REQUEST. The cron writes one D1 row; a request reads
// that row and computes the clock against `now`. Kickoff times are fixed, so the
// week and the upcoming / in-progress / completed split are right to the minute
// even when the row is a day old -- only SCORES go stale between refreshes, and
// every game says whether its status came from the feed or from the clock.
const SEASON_CONTRACT = 1;
const SEASON_ROW = 4;                       // odds_overlay row 4, same table, same lifecycle
const SEASON_MAX_AGE_MS = 14 * 86400000;    // a schedule row older than this is not served
const SEASON_MEMO_MS = 300000;              // per-isolate memo; one D1 read behind it
// How long a game blocks its week when no feed has said the game is over. A
// three-hour NFL broadcast plus overtime and the long reviews; deliberately
// generous, because turning the week over while the last game is still on is the
// failure this file exists to prevent, and being 40 minutes late is not.
const SEASON_GAME_MS = 3.75 * 3600000;
const SEASON_MIN_REG = 200;                 // a REG spine thinner than this is a truncated pull
const SEASON_LEADIN_MS = 14 * 86400000;     // more than a fortnight before anything kicks off is the offseason
const SEASON_ORDER = { PRE: 0, REG: 1, WC: 2, DIV: 3, CON: 4, SB: 5 };
const SEASON_PHASE = { PRE: 'preseason', REG: 'regular', WC: 'postseason', DIV: 'postseason', CON: 'postseason', SB: 'postseason' };
const SEASON_PHASE_LABEL = { offseason: 'Offseason', preseason: 'Preseason', regular: 'Regular season', postseason: 'Playoffs' };
const SEASON_ROUND_LABEL = { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference Championships', SB: 'Super Bowl' };
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const ESPN_SEASONTYPE = { 1: 'PRE', 2: 'REG', 3: 'POST' };
// ESPN's own status vocabulary. Anything not listed is treated as unknown and
// the clock decides, which is the safe direction: a status this map has not seen
// must never be able to declare a game final.
const ESPN_STATUS = {
  STATUS_SCHEDULED: 'scheduled', STATUS_IN_PROGRESS: 'in_progress',
  STATUS_HALFTIME: 'in_progress', STATUS_END_PERIOD: 'in_progress',
  STATUS_DELAYED: 'in_progress', STATUS_FINAL: 'final',
  STATUS_FINAL_OVERTIME: 'final', STATUS_POSTPONED: 'postponed',
  STATUS_CANCELED: 'canceled', STATUS_SUSPENDED: 'in_progress'
};

// games.csv writes a fixture as an Eastern date and an Eastern wall clock, in
// two columns, with no offset on either. Converting with a fixed -5 puts every
// September and October kickoff an hour late. etOffsetHours() already knows the
// US rule, so the conversion is: read the time as if ET were -5, ask that
// instant which offset actually applies, and correct by the difference. No NFL
// game has ever kicked off inside a DST transition hour, so one pass is exact.
function _seasonEtToUtc(day, clock) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return NaN;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(clock || ''));
  const hh = t ? +t[1] : 13, mi = t ? +t[2] : 0;   // an undated column defaults to the 1pm ET window
  if (!(hh >= 0 && hh <= 23 && mi >= 0 && mi <= 59)) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], hh + 5, mi);
  return guess - (etOffsetHours(guess) + 5) * 3600000;
}

// ── providers ──────────────────────────────────────────────────────────────
async function fetchScheduleNflverse() {
  const r = await fetch(NFLVERSE_GAMES_URL, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error('nflverse ' + r.status);
  const lines = (await r.text()).split('\n');
  if (lines.length < 2) throw new Error('nflverse: empty');
  const head = _csvSplit(lines[0]);
  const col = {};
  ['game_id', 'game_type', 'week', 'gameday', 'gametime', 'away_team', 'home_team',
   'away_score', 'home_score', 'spread_line', 'total_line'].forEach(k => { col[k] = head.indexOf(k); });
  for (const k of Object.keys(col)) if (col[k] < 0) throw new Error('nflverse: missing column ' + k);
  // game_id opens with the season, so the newest one is found without parsing
  // 2MB of CSV -- the same trick the odds provider uses on this same file.
  let season = 0;
  for (let i = 1; i < lines.length; i++) {
    const u = lines[i].indexOf('_');
    if (u > 0) { const y = +lines[i].slice(0, u); if (y > season && y < 3000) season = y; }
  }
  if (!season) throw new Error('nflverse: no season found');
  const prefix = season + '_';
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const games = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    const f = _csvSplit(lines[i]);
    const type = String(f[col.game_type] || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(SEASON_ORDER, type)) continue;
    const kickoff = _seasonEtToUtc(f[col.gameday], f[col.gametime]);
    if (!Number.isFinite(kickoff)) continue;
    games.push({
      id: f[col.game_id], type, week: parseInt(f[col.week], 10) || 0, kickoff,
      home: teamKey(f[col.home_team]), away: teamKey(f[col.away_team]),
      homeScore: num(f[col.home_score]), awayScore: num(f[col.away_score]),
      spread: num(f[col.spread_line]), total: num(f[col.total_line]),
      status: null, src: 'nflverse'
    });
  }
  const reg = games.filter(g => g.type === 'REG').length;
  if (reg < SEASON_MIN_REG) throw new Error('nflverse: only ' + reg + ' regular-season games');
  return { season, games };
}

async function _espnEvents(qs) {
  const r = await fetch(ESPN_SCOREBOARD + (qs ? '?' + qs : ''), { cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error('espn ' + r.status);
  const j = await r.json();
  return Array.isArray(j && j.events) ? j.events : [];
}
function _espnGame(ev) {
  const comp = (ev && ev.competitions || [])[0] || {};
  const cs = comp.competitors || [];
  const home = cs.find(c => c && c.homeAway === 'home');
  const away = cs.find(c => c && c.homeAway === 'away');
  if (!home || !away) return null;
  const kickoff = Date.parse(ev.date);
  if (!Number.isFinite(kickoff)) return null;
  const h = teamKey(home.team && home.team.abbreviation);
  const a = teamKey(away.team && away.team.abbreviation);
  if (!h || !a) return null;
  const st = (((ev.status || comp.status || {}).type) || {}).name || '';
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  return {
    id: 'espn-' + ev.id, type: ESPN_SEASONTYPE[(ev.season || {}).type] || '',
    week: ((ev.week || {}).number) || 0, kickoff, home: h, away: a,
    homeScore: num(home.score), awayScore: num(away.score),
    spread: null, total: null, status: ESPN_STATUS[st] || null, src: 'espn'
  };
}
// The preseason, which the spine does not carry at all, plus whatever the
// scoreboard is currently showing (status and score for the games being played).
// Each call is independent: one failing week must not cost the others.
async function fetchScheduleEspn(season) {
  const out = [];
  const add = evs => { for (const ev of evs) { const g = _espnGame(ev); if (g) out.push(g); } };
  // ESPN numbers preseason weeks 1-4, week 1 being the Hall of Fame game.
  for (let w = 1; w <= 4; w++) {
    try { add(await _espnEvents('dates=' + season + '&seasontype=1&week=' + w)); } catch (e) {}
  }
  try { add(await _espnEvents('')); } catch (e) {}
  return out;
}

// ── merge ──────────────────────────────────────────────────────────────────
// The spine owns the fixture list and the lines; ESPN owns status, score and the
// exact kickoff instant. Matched on the two clubs within a two-day window rather
// than on week number, because ESPN and nflverse number the postseason rounds
// differently and a round mismatch would put a live score on the wrong game.
function mergeSchedule(spine, live) {
  const games = (spine || []).map(g => ({ ...g }));
  const byPair = new Map();
  games.forEach((g, i) => {
    const k = g.away + '@' + g.home;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(i);
  });
  const WINDOW = 2 * 86400000;
  let updated = 0, added = 0;
  for (const g of live || []) {
    const cands = byPair.get(g.away + '@' + g.home) || [];
    let best = -1, bestGap = WINDOW;
    for (const i of cands) {
      const gap = Math.abs(games[i].kickoff - g.kickoff);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best >= 0) {
      const t = games[best];
      t.kickoff = g.kickoff;                       // the feed's instant is exact; ours is converted
      if (g.status) t.status = g.status;
      if (g.homeScore != null) t.homeScore = g.homeScore;
      if (g.awayScore != null) t.awayScore = g.awayScore;
      t.src = t.src + '+espn';
      updated++;
    } else if (g.type && Object.prototype.hasOwnProperty.call(SEASON_ORDER, g.type === 'POST' ? 'WC' : g.type)) {
      // Only fixtures the spine genuinely cannot have: the preseason. A POST
      // game with no match is left out rather than guessed into a round, since
      // the spine gains the bracket within a day of it being set.
      if (g.type !== 'PRE') continue;
      games.push({ ...g });
      added++;
    }
  }
  games.sort((a, b) => a.kickoff - b.kickoff || (a.id < b.id ? -1 : 1));
  return { games, updated, added };
}

// ── the clock ──────────────────────────────────────────────────────────────
// Everything below is pure: schedule in, state out, no env, no fetch, no Date.now
// unless it is handed one. That is what makes the week rule testable against a
// fixture season instead of only against today.
function _seasonBuckets(games) {
  const by = new Map();
  for (const g of games) {
    const key = g.type + ':' + (g.week || 0);
    let b = by.get(key);
    if (!b) by.set(key, (b = { key, type: g.type, week: g.week || 0, games: [], first: Infinity, last: -Infinity }));
    b.games.push(g);
    if (g.kickoff < b.first) b.first = g.kickoff;
    if (g.kickoff > b.last) b.last = g.kickoff;
  }
  const out = [...by.values()];
  for (const b of out) {
    b.games.sort((x, y) => x.kickoff - y.kickoff || (String(x.id) < String(y.id) ? -1 : 1));
    b.endsAt = b.last + SEASON_GAME_MS;
    b.label = b.type === 'REG' ? 'Week ' + b.week
            : b.type === 'PRE' ? 'Preseason Week ' + b.week
            : SEASON_ROUND_LABEL[b.type] || b.type;
  }
  // Calendar order first. The round tiebreak only ever matters for two buckets
  // that open on the same instant, which no real schedule does, but a stable
  // order is what stops the week index reshuffling between two reads.
  out.sort((a, b) => a.first - b.first || SEASON_ORDER[a.type] - SEASON_ORDER[b.type] || a.week - b.week);
  return out;
}
// A game's state, and where that state came from. The feed is believed when it
// says a game is under way or over; "scheduled" is NOT believed, because a row
// written before kickoff still says scheduled hours after the game ended.
function seasonGameStatus(g, now) {
  if (g.status === 'postponed' || g.status === 'canceled') return { status: g.status, source: 'feed' };
  if (g.status === 'final') return { status: 'completed', source: 'feed' };
  if (g.status === 'in_progress') return { status: 'in_progress', source: 'feed' };
  if (now < g.kickoff) return { status: 'upcoming', source: 'clock' };
  if (now < g.kickoff + SEASON_GAME_MS) return { status: 'in_progress', source: 'clock' };
  return { status: 'completed', source: 'clock' };
}
// A postponed game still occupies its week -- it is rescheduled, not deleted --
// but it must not hold the week open forever, so it is excluded from the "has
// this week finished" test while staying in the week's game list.
function _seasonBucketEnd(b) {
  const live = b.games.filter(g => g.status !== 'postponed' && g.status !== 'canceled');
  if (!live.length) return b.endsAt;
  return Math.max(...live.map(g => g.kickoff)) + SEASON_GAME_MS;
}
// One game, with its state and its implied points. The implied totals live
// HERE, on the payload, so no page has to know which way a feed signs its
// spread: nflverse writes spread_line as the home margin, and that convention
// stops at this function.
function _seasonDecorate(g, at) {
  const s = seasonGameStatus(g, at);
  const imp = (g.total != null && g.spread != null)
    ? { home: _oddsRound(g.total / 2 + g.spread / 2), away: _oddsRound(g.total / 2 - g.spread / 2) }
    : { home: null, away: null };
  return {
    id: g.id, type: g.type, week: g.week, kickoff: g.kickoff,
    home: g.home, away: g.away, homeScore: g.homeScore, awayScore: g.awayScore,
    spread: g.spread == null ? null : g.spread, total: g.total == null ? null : g.total,
    impliedHome: imp.home, impliedAway: imp.away,
    status: s.status, statusSource: s.source
  };
}
// A week's games, counts and byes. Shared by the current-week and the
// named-week paths so the two cannot drift apart.
function _seasonWeekView(all, bucket, at) {
  const games = bucket.games.map(g => _seasonDecorate(g, at));
  const counts = { upcoming: 0, inProgress: 0, completed: 0, other: 0 };
  for (const g of games) {
    if (g.status === 'upcoming') counts.upcoming++;
    else if (g.status === 'in_progress') counts.inProgress++;
    else if (g.status === 'completed') counts.completed++;
    else counts.other++;
  }
  // Byes are a property of the regular season only: every club plays in the
  // preseason and only the survivors play in January, so "who is off" is a
  // question that means nothing outside REG.
  const league = new Set();
  for (const g of all) if (g.type === 'REG') { league.add(g.home); league.add(g.away); }
  let byes = [];
  if (bucket.type === 'REG' && league.size >= 30) {
    const playing = new Set();
    for (const g of bucket.games) { playing.add(g.home); playing.add(g.away); }
    byes = [...league].filter(t => !playing.has(t)).sort();
  }
  return { games, counts, byes };
}
function nflSeasonState(cache, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const all = ((cache && cache.games) || []).filter(g => g && Number.isFinite(g.kickoff));
  if (!all.length) return { ok: false, error: 'no_schedule', contract: SEASON_CONTRACT };
  const buckets = _seasonBuckets(all);
  for (const b of buckets) b.endsAt = _seasonBucketEnd(b);

  // THE WEEK RULE, and the only place it is written: the current week is the
  // first one whose own last game has not finished. Every property below reads
  // off that, so nothing on the site can disagree about what week it is.
  let idx = buckets.findIndex(b => b.endsAt > at);
  const seasonComplete = idx < 0;
  if (seasonComplete) idx = buckets.length - 1;
  const cur = buckets[idx];

  const started = at >= buckets[0].first;
  const phase = seasonComplete ? 'offseason'
    : (!started && at < buckets[0].first - SEASON_LEADIN_MS) ? 'offseason'
    : SEASON_PHASE[cur.type] || 'regular';
  const weekStatus = at < cur.first ? 'upcoming' : at < cur.endsAt ? 'active' : 'complete';

  const decorate = g => _seasonDecorate(g, at);
  const { games, counts, byes } = _seasonWeekView(all, cur, at);

  const upcomingAll = all.filter(g => seasonGameStatus(g, at).status === 'upcoming')
    .sort((a, b) => a.kickoff - b.kickoff);
  const doneAll = all.filter(g => seasonGameStatus(g, at).status === 'completed')
    .sort((a, b) => b.kickoff - a.kickoff);

  return {
    ok: true,
    contract: SEASON_CONTRACT,
    now: at,
    season: (cache && cache.season) || 0,
    phase,
    phaseLabel: SEASON_PHASE_LABEL[phase] || phase,
    seasonComplete,
    week: {
      type: cur.type, number: cur.week, label: cur.label, status: weekStatus,
      index: idx, of: buckets.length,
      firstKickoff: cur.first, lastKickoff: cur.last, endsAt: cur.endsAt,
      games: games.length, byes
    },
    counts,
    games,
    nextGame: upcomingAll.length ? decorate(upcomingAll[0]) : null,
    lastCompleted: doneAll.length ? decorate(doneAll[0]) : null,
    // The whole season's index, so a page can offer a week picker without a
    // second call. Games are deliberately left off: 23 rows, not 300.
    weeks: buckets.map((b, i) => ({
      index: i, type: b.type, number: b.week, label: b.label,
      firstKickoff: b.first, lastKickoff: b.last, endsAt: b.endsAt, games: b.games.length,
      status: at < b.first ? 'upcoming' : at < b.endsAt ? 'active' : 'complete',
      current: i === idx
    })),
    updatedAt: (cache && cache.updatedAt) || 0,
    provider: (cache && cache.provider) || '',
    stale: !!(cache && cache.updatedAt && Date.now() - cache.updatedAt > SEASON_MAX_AGE_MS)
  };
}
// The same state, for a week the caller names rather than the current one. The
// clock is untouched -- `week` still reports which week it really is -- only the
// game list and the counts move, so a reader browsing Week 4 in Week 9 is never
// shown Week 4 as though it were live.
function nflSeasonWeek(cache, now, type, number) {
  const state = nflSeasonState(cache, now);
  if (!state.ok) return state;
  const want = String(type || 'REG').toUpperCase();
  const n = parseInt(number, 10);
  const at = state.now;
  const all = ((cache && cache.games) || []).filter(g => g && Number.isFinite(g.kickoff));
  const buckets = _seasonBuckets(all);
  for (const b of buckets) b.endsAt = _seasonBucketEnd(b);
  const hit = buckets.find(b => b.type === want && (!Number.isFinite(n) || b.week === n));
  if (!hit) return { ...state, requested: { type: want, number: Number.isFinite(n) ? n : null, found: false } };
  const { games, counts, byes } = _seasonWeekView(all, hit, at);
  return {
    ...state,
    requested: {
      type: hit.type, number: hit.week, label: hit.label, found: true,
      status: at < hit.first ? 'upcoming' : at < hit.endsAt ? 'active' : 'complete',
      firstKickoff: hit.first, lastKickoff: hit.last, endsAt: hit.endsAt, byes
    },
    counts, games
  };
}

// ── D1 cache and orchestration ─────────────────────────────────────────────
async function scheduleCacheWrite(env, season, games, provider) {
  await oddsCacheInit(env);
  await env.LEADS_DB.prepare(
    'INSERT OR REPLACE INTO odds_overlay (id, payload, provider, matched, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(SEASON_ROW, JSON.stringify({ season, games }), provider, games.length, Date.now()).run();
}
let _SEASON_CACHE = null, _SEASON_AT = 0;
async function scheduleCacheRead(env) {
  if (_SEASON_CACHE && Date.now() - _SEASON_AT < SEASON_MEMO_MS) return _SEASON_CACHE;
  if (!env || !env.LEADS_DB) return null;
  try {
    const row = await env.LEADS_DB.prepare('SELECT payload, provider, matched, updated_at FROM odds_overlay WHERE id=?')
      .bind(SEASON_ROW).first();
    if (!row || !row.payload) return null;
    if (!row.updated_at || Date.now() - row.updated_at > SEASON_MAX_AGE_MS) return null;
    const j = JSON.parse(row.payload);
    if (!j || !Array.isArray(j.games) || !j.games.length) return null;
    _SEASON_CACHE = { season: j.season || 0, games: j.games, provider: row.provider, updatedAt: row.updated_at };
    _SEASON_AT = Date.now();
    return _SEASON_CACHE;
  } catch (e) { return null; }
}
// Fail-safe by construction, the same shape as the odds refresh: the spine is
// required, the live layer is not, and a run that cannot build a spine writes
// nothing at all rather than replacing a good schedule with a thin one.
async function runScheduleRefresh(env) {
  if (!env || !env.LEADS_DB) return { ok: false, error: 'no_db' };
  let spine;
  try { spine = await fetchScheduleNflverse(); }
  catch (e) { return { ok: false, error: 'spine: ' + ((e && e.message) || 'failed') }; }
  let live = [], liveError = null;
  try { live = await fetchScheduleEspn(spine.season); }
  catch (e) { liveError = (e && e.message) || 'failed'; }
  const merged = mergeSchedule(spine.games, live);
  const provider = 'nflverse' + (live.length ? '+espn' : '');
  await scheduleCacheWrite(env, spine.season, merged.games, provider);
  _SEASON_CACHE = null; _SEASON_AT = 0;
  return {
    ok: true, season: spine.season, provider,
    spine: spine.games.length, live: live.length,
    statusUpdated: merged.updated, preseasonAdded: merged.added,
    games: merged.games.length, liveError
  };
}
async function seasonPayload(env, opts) {
  const cache = await scheduleCacheRead(env);
  if (!cache) return { ok: false, error: 'no_schedule', contract: SEASON_CONTRACT };
  const o = opts || {};
  return o.type || o.week != null
    ? nflSeasonWeek(cache, Date.now(), o.type, o.week)
    : nflSeasonState(cache, Date.now());
}

// ── the provider layer ─────────────────────────────────────────────────────
// NOTHING ABOVE THIS LINE KNOWS A VENDOR'S NAME. Application code asks for a
// KIND of data; the registry decides who answers and in what order, and every
// adapter normalises its vendor's output into Iron Tuna's own schema before it
// is returned. Swapping The Odds API for another book feed, or adding a paid
// projection feed, is a new entry in this table and nothing else.
//
// CREDENTIALS LIVE IN THE ENVIRONMENT AND NOWHERE ELSE. Every adapter that
// needs a key reads it off `env` and declares `needs(env)`; a provider whose
// key is unset is skipped and reported as "not configured" rather than failing
// the run. No key is ever written to the repo, to a log line, or into a cached
// payload -- `providerReport` below deliberately reports only WHETHER a key is
// present. The free providers are the default path, so the site works with no
// keys at all, which is what it does in production today.
//
// EVERY SOURCE HERE IS A PUBLISHED DATA FEED OR A DOCUMENTED API. Nothing
// scrapes a website. Where the only route to a field would be scraping (routes
// run, route participation, DFS salaries), the field is reported as
// unavailable instead -- see PROVIDER_UNAVAILABLE at the bottom of this block.
//
// THE SEVEN KINDS, and the internal record each normalises to:
//
//   schedule    { id, type, week, kickoff, home, away, homeScore, awayScore,
//                 spread, total, status }
//   odds        { book, subjectType, subject, market, line, overOdds,
//                 underOdds, gameId, ts }
//   projection  { name, position, team, stats }          stats in IT stat keys
//   consensus   { name, position, team, rank, points, source }
//   stats       { name, position, team, season, week, stats, usage }
//   injury      { name, position, team, status, gamesOut, note, asOf }
//   dfs         { name, position, team, site, slate, salary, gameId }
//
// Stat keys are Iron Tuna's throughout (passYd, rushTD, rec, ...). A vendor's
// column names stop at the adapter.
const PROVIDER_KINDS = ['schedule', 'odds', 'projection', 'consensus', 'stats', 'injury', 'dfs'];

const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const NFLVERSE_WEEKLY_STATS = s => `${NFLVERSE_BASE}/stats_player/stats_player_week_${s}.csv`;
const NFLVERSE_SNAPS = s => `${NFLVERSE_BASE}/snap_counts/snap_counts_${s}.csv`;
const PROVIDER_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// A header-indexed CSV reader. Returns a row accessor rather than objects,
// because these files run to five figures of rows and building an object per
// row for columns nobody reads is the difference between comfortable and
// tight inside a Worker's memory.
function _provCsv(text, wanted) {
  const lines = text.split('\n');
  if (lines.length < 2) return { rows: [], col: {} };
  const head = _csvSplit(lines[0]);
  const col = {};
  for (const w of wanted) col[w] = head.indexOf(w);
  return { lines, col, head };
}
const _provNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// ── schedule ───────────────────────────────────────────────────────────────
// Both adapters already exist and are used by the season service; they are
// registered here so the schedule is reachable through the same door as
// everything else rather than only by direct call.
const PROVIDER_SCHEDULE = [
  { name: 'nflverse-schedule', free: true,
    fetch: async () => (await fetchScheduleNflverse()).games },
  { name: 'espn-scoreboard', free: true,
    fetch: async (env, ctx) => await fetchScheduleEspn((ctx && ctx.season) || new Date().getUTCFullYear()) }
];

// ── odds ───────────────────────────────────────────────────────────────────
// The Odds API is the only per-player book feed, and it is the one paid
// upgrade. Without it the game-line provider still prices every club's scoring
// environment, which is what the site runs on today.
const PROVIDER_ODDS = [
  { name: 'the-odds-api', free: false, needs: env => !!(env && env.ODDS_API_KEY),
    subjectType: 'player',
    fetch: async (env) => (await fetchOddsTheOddsApi(env)).map(r => ({
      book: r.book || 'unknown', subjectType: 'player', subject: r.player,
      market: r.market, line: r.line, overOdds: r.overOdds, underOdds: r.underOdds,
      gameId: r.gameId || null, ts: Date.now()
    })) },
  { name: 'nflverse-gamelines', free: true, subjectType: 'game',
    fetch: async (env) => {
      // The schedule refresh already pulled this file minutes ago; read the
      // row it wrote rather than downloading 2MB again. Falls back to the
      // fetch only when there is no row to read.
      const cached = await scheduleCacheRead(env);
      const games = cached ? cached.games : (await fetchScheduleNflverse()).games;
      const out = [];
      for (const g of games) {
        if (g.spread != null) out.push({ book: 'consensus', subjectType: 'game', subject: g.id,
          market: 'spread', line: g.spread, overOdds: null, underOdds: null, gameId: g.id, ts: Date.now() });
        if (g.total != null) out.push({ book: 'consensus', subjectType: 'game', subject: g.id,
          market: 'total', line: g.total, overOdds: null, underOdds: null, gameId: g.id, ts: Date.now() });
      }
      return out;
    } }
];

// ── projection ─────────────────────────────────────────────────────────────
// The committed board is a provider like any other. Saying so is what lets the
// market engine treat "what the analysts think" and "what the book thinks" as
// two inputs to compare rather than one baseline and one adjustment.
const PROVIDER_PROJECTION = [
  { name: 'iron-tuna-committed', free: true,
    fetch: async () => _availPool(PROJECTIONS).map(p => ({
      name: p.name, position: p.position, team: teamKey(p.team),
      stats: { ...(p.projectedStats || {}) }
    })) }
];

// ── consensus ranking ──────────────────────────────────────────────────────
// The odds-BLIND board: the committed projections scored and ranked, which is
// what a normal ranking or ADP list is built on. Kept separate from the
// projection provider because a rank and a stat line are different questions
// and the Vegas Edge product is exactly the gap between the two boards.
const PROVIDER_CONSENSUS = [
  { name: 'iron-tuna-consensus', free: true,
    fetch: async (env, ctx) => {
      const rules = (ctx && ctx.rules) || _COL_RULES;
      const byPos = {};
      for (const p of _availPool(PROJECTIONS)) {
        if (!PROVIDER_POSITIONS.has(p.position)) continue;
        (byPos[p.position] = byPos[p.position] || []).push({
          name: p.name, position: p.position, team: teamKey(p.team),
          points: _oddsRound(scoreStats(p.projectedStats, p.position, rules))
        });
      }
      const out = [];
      for (const pos of Object.keys(byPos)) {
        byPos[pos].sort((a, b) => b.points - a.points || (a.name < b.name ? -1 : 1));
        byPos[pos].forEach((r, i) => out.push({ ...r, rank: i + 1, source: 'iron-tuna-consensus' }));
      }
      return out;
    } }
];

// ── weekly stats and usage ─────────────────────────────────────────────────
// nflverse publishes a weekly player file the day after games are played. It
// carries the usage columns that are genuinely public -- targets, target share,
// air yards and air-yards share, carries, receptions, attempts -- and a second
// file carries offensive snaps and snap share. Routes run and route
// participation are NOT in either; they are charting products, and this returns
// null for them rather than a derived stand-in dressed up as a measurement.
async function fetchStatsNflverseWeekly(season) {
  const r = await fetch(NFLVERSE_WEEKLY_STATS(season), { cf: { cacheTtl: 3600 } });
  if (r.status === 404) return [];          // no games played yet this season
  if (!r.ok) throw new Error('nflverse weekly ' + r.status);
  const WANT = ['player_display_name', 'player_name', 'position', 'season', 'week', 'season_type',
    'team', 'opponent_team', 'attempts', 'completions', 'passing_yards', 'passing_tds',
    'passing_interceptions', 'passing_2pt_conversions', 'carries', 'rushing_yards', 'rushing_tds',
    'rushing_2pt_conversions', 'rushing_fumbles_lost', 'sack_fumbles_lost', 'receiving_fumbles_lost',
    'receptions', 'targets', 'receiving_yards', 'receiving_tds', 'receiving_2pt_conversions',
    'receiving_air_yards', 'target_share', 'air_yards_share', 'special_teams_tds'];
  const { lines, col } = _provCsv(await r.text(), WANT);
  if (col.player_display_name < 0 || col.week < 0) throw new Error('nflverse weekly: unexpected columns');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = _csvSplit(lines[i]);
    const pos = String(f[col.position] || '').toUpperCase();
    if (!PROVIDER_POSITIONS.has(pos)) continue;
    const n = k => _provNum(f[col[k]]);
    const fum = (n('rushing_fumbles_lost') || 0) + (n('sack_fumbles_lost') || 0) + (n('receiving_fumbles_lost') || 0);
    out.push({
      name: f[col.player_display_name] || f[col.player_name],
      position: pos, team: teamKey(f[col.team]),
      season: n('season'), week: n('week'), seasonType: f[col.season_type] || 'REG',
      opponent: teamKey(f[col.opponent_team]),
      stats: {
        passYd: n('passing_yards') || 0, passTD: n('passing_tds') || 0,
        passInt: n('passing_interceptions') || 0, pass2pt: n('passing_2pt_conversions') || 0,
        rushYd: n('rushing_yards') || 0, rushTD: n('rushing_tds') || 0,
        rush2pt: n('rushing_2pt_conversions') || 0,
        recYd: n('receiving_yards') || 0, recTD: n('receiving_tds') || 0,
        rec: n('receptions') || 0, rec2pt: n('receiving_2pt_conversions') || 0,
        fumLost: fum
      },
      usage: {
        passAttempts: n('attempts'), completions: n('completions'),
        carries: n('carries'), targets: n('targets'), receptions: n('receptions'),
        targetShare: n('target_share'), airYards: n('receiving_air_yards'),
        airYardsShare: n('air_yards_share')
      }
    });
  }
  return out;
}
async function fetchSnapsNflverse(season) {
  const r = await fetch(NFLVERSE_SNAPS(season), { cf: { cacheTtl: 3600 } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('nflverse snaps ' + r.status);
  const WANT = ['season', 'week', 'game_type', 'player', 'position', 'team', 'offense_snaps', 'offense_pct'];
  const { lines, col } = _provCsv(await r.text(), WANT);
  if (col.player < 0 || col.offense_snaps < 0) throw new Error('nflverse snaps: unexpected columns');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = _csvSplit(lines[i]);
    const pos = String(f[col.position] || '').toUpperCase();
    if (!PROVIDER_POSITIONS.has(pos)) continue;
    out.push({
      name: f[col.player], position: pos, team: teamKey(f[col.team]),
      season: _provNum(f[col.season]), week: _provNum(f[col.week]),
      seasonType: f[col.game_type] || 'REG',
      snaps: _provNum(f[col.offense_snaps]), snapPct: _provNum(f[col.offense_pct])
    });
  }
  return out;
}
const PROVIDER_STATS = [
  { name: 'nflverse-weekly', free: true,
    fetch: async (env, ctx) => await fetchStatsNflverseWeekly((ctx && ctx.season) || new Date().getUTCFullYear()) }
];
const PROVIDER_SNAPS = [
  { name: 'nflverse-snaps', free: true,
    fetch: async (env, ctx) => await fetchSnapsNflverse((ctx && ctx.season) || new Date().getUTCFullYear()) }
];

// ── injuries ───────────────────────────────────────────────────────────────
// The existing ESPN pull, normalised. buildAvailabilityOverlay already turns
// the feed into the site's own availability shape; this exposes it through the
// registry so the market engine reads injuries the same way it reads odds.
const PROVIDER_INJURY = [
  { name: 'espn-injuries', free: true,
    fetch: async () => {
      const built = buildAvailabilityOverlay(await fetchInjuriesEspn());
      return Object.entries(built.players || {}).map(([key, v]) => ({
        key, name: v.name, position: v.position, team: teamKey(v.team),
        status: v.status, gamesOut: v.gamesOut, note: v.note || '', asOf: v.asOf || built.asOf
      }));
    } }
];

// ── DFS salaries ───────────────────────────────────────────────────────────
// DECLARED, NOT IMPLEMENTED, ON PURPOSE. Neither DraftKings nor FanDuel
// publishes a documented public salary API, and the routes that exist are
// undocumented endpoints behind a contest page -- taking them would be
// scraping, which this repo does not do. The interface is here so a licensed
// feed is a config change rather than a refactor: set DFS_SALARY_API and
// DFS_SALARY_API_KEY and the adapter below carries the response into the same
// normalised record every other provider returns. Until then the kind reports
// "not configured" and /dfs shows the scoring environment it can actually
// source, with no salary column invented to fill the gap.
const PROVIDER_DFS = [
  { name: 'licensed-salary-feed', free: false,
    needs: env => !!(env && env.DFS_SALARY_API && env.DFS_SALARY_API_KEY),
    fetch: async (env, ctx) => {
      const u = new URL(env.DFS_SALARY_API);
      if (ctx && ctx.season) u.searchParams.set('season', String(ctx.season));
      if (ctx && ctx.week) u.searchParams.set('week', String(ctx.week));
      const r = await fetch(u.toString(), { headers: { authorization: 'Bearer ' + env.DFS_SALARY_API_KEY } });
      if (!r.ok) throw new Error('dfs ' + r.status);
      const j = await r.json();
      const rows = Array.isArray(j) ? j : (j && j.salaries) || [];
      return rows.map(x => ({
        name: x.name || x.player || '', position: String(x.position || '').toUpperCase(),
        team: teamKey(x.team), site: x.site || 'unknown', slate: x.slate || null,
        salary: _provNum(x.salary), gameId: x.gameId || null
      })).filter(x => x.name && x.salary != null);
    } }
];

const PROVIDERS = {
  schedule: PROVIDER_SCHEDULE, odds: PROVIDER_ODDS, projection: PROVIDER_PROJECTION,
  consensus: PROVIDER_CONSENSUS, stats: PROVIDER_STATS, snaps: PROVIDER_SNAPS,
  injury: PROVIDER_INJURY, dfs: PROVIDER_DFS
};

// Fields no source in this registry can supply. Named here rather than left as
// silent nulls, so a surface can SAY a number is unavailable instead of
// printing a blank a reader will read as zero, and so adding a feed that does
// carry them is a visible change to one list.
const PROVIDER_UNAVAILABLE = {
  routes: 'charting product; no free feed publishes routes run',
  routeParticipation: 'derived from routes run, which is unavailable',
  redZoneTouches: 'play-by-play only; the file is ~100MB and cannot be pulled per refresh',
  redZoneTargets: 'play-by-play only, as above',
  goalLineCarries: 'play-by-play only, as above',
  pace: 'play-by-play only, as above',
  passRate: 'play-by-play only, as above',
  dfsSalary: 'no documented public salary API; needs a licensed feed (DFS_SALARY_API)'
};

// Run every configured provider of a kind, in registry order, and hand back
// what each returned plus a report. Callers merge; this does not, because what
// "earlier wins" means is different for a stat line and a game row.
async function providerRun(env, kind, ctx) {
  const list = PROVIDERS[kind];
  if (!list) return { ok: false, error: 'unknown_kind', kind, results: [] };
  const results = [];
  for (const p of list) {
    if (p.needs && !p.needs(env)) { results.push({ provider: p.name, skipped: 'not configured', rows: [] }); continue; }
    try {
      const rows = await p.fetch(env, ctx || {});
      results.push({ provider: p.name, rows: Array.isArray(rows) ? rows : [], count: Array.isArray(rows) ? rows.length : 0 });
    } catch (e) {
      results.push({ provider: p.name, error: (e && e.message) || 'failed', rows: [] });
    }
  }
  return { ok: results.some(r => r.count > 0), kind, results };
}
// What is wired up, and whether each key is present. Never the key itself.
function providerReport(env) {
  const out = {};
  for (const kind of Object.keys(PROVIDERS)) {
    out[kind] = PROVIDERS[kind].map(p => ({
      name: p.name, free: !!p.free, configured: !p.needs || p.needs(env)
    }));
  }
  return { providers: out, unavailable: PROVIDER_UNAVAILABLE };
}

// -- historical betting markets --------------------------------------------
// A LINE IS NEVER OVERWRITTEN. The overlay in row 1 answers "what does the
// market say now"; this table answers "what did it say, and when", which is a
// different product. Opening 59.5 and current 67.5 is a fact about eight yards
// of money moving toward a receiver, and it is invisible to anything that
// keeps only the latest value.
//
// Append-only, with ONE exception that is not an exception: a refresh that
// finds a book's line unchanged writes nothing. Four pulls a day against ~30
// books and thousands of markets would otherwise add six figures of identical
// rows a week, and "the line did not move" is already recorded by the absence
// of a new row between two timestamps. Every row that IS written is a change.
const SNAP_DDL = [
  'CREATE TABLE IF NOT EXISTS odds_snapshots (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, season INTEGER, week INTEGER, ' +
    'book TEXT NOT NULL, subject_type TEXT NOT NULL, subject TEXT NOT NULL, market TEXT NOT NULL, ' +
    'line REAL, over_odds INTEGER, under_odds INTEGER, game_id TEXT, raw_subject TEXT)',
  'CREATE INDEX IF NOT EXISTS ix_snap_subject ON odds_snapshots (subject, market, ts)',
  'CREATE INDEX IF NOT EXISTS ix_snap_latest ON odds_snapshots (subject, market, book, ts)',
  'CREATE INDEX IF NOT EXISTS ix_snap_week ON odds_snapshots (season, week, ts)'
];
// Additive migrations for a table that may already exist. Each is a no-op
// once applied and is allowed to fail (D1 raises on a duplicate column).
const SNAP_MIGRATIONS = ['ALTER TABLE odds_snapshots ADD COLUMN raw_subject TEXT'];
let _SNAP_READY = false;
async function snapshotReady(env) {
  if (_SNAP_READY) return true;
  if (!env || !env.LEADS_DB) return false;
  try { await env.LEADS_DB.batch(SNAP_DDL.map(q => env.LEADS_DB.prepare(q))); }
  catch (e) { try { for (const q of SNAP_DDL) await env.LEADS_DB.prepare(q).run(); } catch (e2) { return false; } }
  for (const q of SNAP_MIGRATIONS) { try { await env.LEADS_DB.prepare(q).run(); } catch (e) {} }
  _SNAP_READY = true;
  return true;
}
// THE JOIN KEY. A book writes "Ja'Marr Chase"; the board writes what it
// writes; the store keys on neither spelling but on the site's own normalised
// name, the same key the season overlay joins on. The book's spelling is kept
// beside it for audit, never for lookup. A game subject is its game id.
function snapshotSubject(r) {
  if (r.subjectType === 'game') return String(r.subject || '');
  return _oddsNorm(r.subject);
}
const SNAP_KEEP_DAYS = 200;                 // a season plus the playoffs, then it goes
const _snapKey = r => r.book + ' ' + r.subjectType + ' ' + snapshotSubject(r) + ' ' + r.market;
// Two lines are "the same" when the number AND both prices match. A line that
// holds at 67.5 while the juice moves from -110 to -135 has moved in the only
// sense that matters to a projection, because the de-vigged probability moved.
function _snapSame(a, b) {
  if (!a || !b) return false;
  const n = v => (v == null ? null : Number(v));
  return n(a.line) === n(b.line) && n(a.over_odds) === n(b.overOdds) && n(a.under_odds) === n(b.underOdds);
}
async function snapshotWrite(env, rows, ctx) {
  if (!(await snapshotReady(env))) return { ok: false, error: 'no_db' };
  const list = (rows || []).filter(r => r && r.book && r.subject && r.market && Number.isFinite(Number(r.line)) && snapshotSubject(r));
  if (!list.length) return { ok: true, seen: 0, written: 0, unchanged: 0 };
  // The latest row per (book, subject, market) already held, so an unchanged
  // line is recognised without a query per row.
  const latest = new Map();
  try {
    const q = await env.LEADS_DB.prepare(
      'SELECT book, subject_type, subject, market, line, over_odds, under_odds, MAX(ts) AS ts ' +
      'FROM odds_snapshots GROUP BY book, subject_type, subject, market').all();
    for (const r of (q.results || [])) {
      latest.set(r.book + ' ' + r.subject_type + ' ' + r.subject + ' ' + r.market, r);
    }
  } catch (e) {}
  const season = (ctx && ctx.season) || null, week = (ctx && ctx.week) || null;
  const ts = (ctx && ctx.ts) || Date.now();
  const fresh = [];
  const seenNow = new Set();
  for (const r of list) {
    const k = _snapKey(r);
    if (seenNow.has(k)) continue;            // one row per market per pull
    seenNow.add(k);
    if (_snapSame(latest.get(k), r)) continue;
    fresh.push(r);
  }
  let written = 0;
  const stmt = env.LEADS_DB.prepare(
    'INSERT INTO odds_snapshots (ts, season, week, book, subject_type, subject, market, line, over_odds, under_odds, game_id, raw_subject) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < fresh.length; i += 50) {
    const chunk = fresh.slice(i, i + 50).map(r => stmt.bind(
      ts, season, week, String(r.book), String(r.subjectType || 'player'), snapshotSubject(r),
      String(r.market), Number(r.line),
      r.overOdds == null ? null : Math.round(Number(r.overOdds)),
      r.underOdds == null ? null : Math.round(Number(r.underOdds)),
      r.gameId == null ? null : String(r.gameId),
      String(r.subject).slice(0, 80)));
    try { await env.LEADS_DB.batch(chunk); written += chunk.length; }
    catch (e) { for (const st of chunk) { try { await st.run(); written++; } catch (e2) {} } }
  }
  return { ok: true, seen: list.length, written, unchanged: list.length - fresh.length };
}
async function snapshotPrune(env, keepDays) {
  if (!(await snapshotReady(env))) return { ok: false };
  const cutoff = Date.now() - (keepDays || SNAP_KEEP_DAYS) * 86400000;
  try {
    const r = await env.LEADS_DB.prepare('DELETE FROM odds_snapshots WHERE ts < ?').bind(cutoff).run();
    return { ok: true, deleted: (r.meta && r.meta.changes) || 0 };
  } catch (e) { return { ok: false, error: (e && e.message) || 'failed' }; }
}

const _median = arr => {
  const a = (arr || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
// How far apart the books are, as a number between 0 and 1: the share of books
// whose current line sits within a tolerance of the median -- 5% of the line,
// floored at half a point so a half-reception spread is not counted as
// disagreement. One book is not agreement with anybody, so it reports null
// rather than a confident 1.
const MARKET_AGREE_TOL_PCT = 0.05;
const MARKET_AGREE_TOL_MIN = 0.5;
function marketAgreement(lines) {
  const a = (lines || []).filter(Number.isFinite);
  if (a.length < 2) return null;
  const med = _median(a);
  if (med == null) return null;
  const tol = Math.max(MARKET_AGREE_TOL_MIN, Math.abs(med) * MARKET_AGREE_TOL_PCT);
  return a.filter(x => Math.abs(x - med) <= tol).length / a.length;
}
// One market's history: where it opened, where it is, how far it moved, how
// many books moved it, and how much they agree now. "Open" is each book's OWN
// first recorded line, then the median across books -- taking the earliest row
// in the table instead would make the opener whichever book happened to post
// first, which is a fact about that book and not about the market.
function marketHistoryFrom(rows) {
  const list = (rows || []).filter(r => Number.isFinite(Number(r.line)))
    .map(r => ({ ...r, ts: Number(r.ts), line: Number(r.line) }))
    .sort((a, b) => a.ts - b.ts);
  if (!list.length) return null;
  const byBook = new Map();
  for (const r of list) {
    if (!byBook.has(r.book)) byBook.set(r.book, { open: r, current: r });
    else byBook.get(r.book).current = r;
  }
  const books = [...byBook.entries()].map(([book, v]) => ({
    book, open: v.open.line, current: v.current.line,
    movement: _oddsRound(v.current.line - v.open.line),
    overOdds: v.current.over_odds == null ? null : Number(v.current.over_odds),
    underOdds: v.current.under_odds == null ? null : Number(v.current.under_odds),
    openedAt: v.open.ts, updatedAt: v.current.ts
  }));
  // THE OPENING LINE IS THE OPENING CONSENSUS, not the median of whatever each
  // book happened to post first. Books enter a market at different times: one
  // that starts quoting on Friday has an "open" that is really a mid-week
  // number, and folding it in drags the opener toward the current line and
  // understates the move. So the opener is the median of the books that were
  // quoting at this market's FIRST recorded pull -- a late arrival counts
  // toward `current` and toward the book count, and cannot rewrite history.
  const firstTs = list[0].ts;
  const openSlate = list.filter(r => r.ts === firstTs).map(r => r.line);
  const open = openSlate.length ? _median(openSlate) : _median(books.map(b => b.open));
  const current = _median(books.map(b => b.current));
  // An anytime-TD market carries no line worth tracking (it is stored as 1);
  // its movement is in the PRICE. Both ends are reported as a de-vigged
  // probability and as American odds, off each book's own first and latest
  // row, so "+210 to +165" is a sentence the store can actually say.
  let tdOpen = null, tdCurrent = null;
  if (list[0].market === 'anytimeTD') {
    const prob = r => {
      // Number(null) is 0 and 0 is finite, so a missing "No" side has to be
      // tested for BEFORE it is coerced, or every one-sided price de-vigs
      // against a phantom zero and vanishes.
      const y = r.over_odds == null ? NaN : Number(r.over_odds);
      const n = r.under_odds == null ? NaN : Number(r.under_odds);
      if (!Number.isFinite(y)) return null;
      return Number.isFinite(n) ? _oddsDevigOver(y, n) : _oddsImpliedProb(y);
    };
    const firstRows = [], lastRows = [];
    for (const [, v] of byBook) { firstRows.push(prob(v.open)); lastRows.push(prob(v.current)); }
    tdOpen = _median(firstRows.filter(x => x != null));
    tdCurrent = _median(lastRows.filter(x => x != null));
  }
  const movement = (open == null || current == null) ? null : _oddsRound(current - open);
  return {
    market: list[0].market, subject: list[0].subject,
    subjectType: list[0].subject_type || list[0].subjectType || 'player',
    open, current, movement,
    percentChange: (open && movement != null) ? Math.round((movement / Math.abs(open)) * 1000) / 10 : null,
    books: books.length,
    booksAtOpen: openSlate.length,
    booksMoved: books.filter(b => b.movement !== 0).length,
    booksUp: books.filter(b => b.movement > 0).length,
    booksDown: books.filter(b => b.movement < 0).length,
    agreement: marketAgreement(books.map(b => b.current)),
    median: current,
    tdOpenProbability: tdOpen == null ? null : Math.round(tdOpen * 1000) / 10,
    tdCurrentProbability: tdCurrent == null ? null : Math.round(tdCurrent * 1000) / 10,
    firstSeen: list[0].ts, lastSeen: list[list.length - 1].ts,
    perBook: books
  };
}
// A caller may hand in the board's spelling, the book's spelling, or the key;
// all three resolve to the key. A game id is left alone.
const _snapLookup = subject => /^\d{4}_\d{2}_[A-Z]+_[A-Z]+$/.test(String(subject || '')) ? String(subject) : _oddsNorm(subject);
async function marketHistory(env, subject, market) {
  if (!(await snapshotReady(env))) return null;
  try {
    const q = await env.LEADS_DB.prepare(
      'SELECT ts, book, subject, subject_type, market, line, over_odds, under_odds ' +
      'FROM odds_snapshots WHERE subject = ? AND market = ? ORDER BY ts ASC LIMIT 2000')
      .bind(_snapLookup(subject), String(market)).all();
    return marketHistoryFrom(q.results || []);
  } catch (e) { return null; }
}
// Every market a subject has, in one query -- what a player card or a market
// record needs, rather than one round trip per stat.
async function marketHistoryAll(env, subject) {
  if (!(await snapshotReady(env))) return {};
  try {
    const q = await env.LEADS_DB.prepare(
      'SELECT ts, book, subject, subject_type, market, line, over_odds, under_odds ' +
      'FROM odds_snapshots WHERE subject = ? ORDER BY ts ASC LIMIT 6000').bind(_snapLookup(subject)).all();
    const byMarket = {};
    for (const r of (q.results || [])) (byMarket[r.market] = byMarket[r.market] || []).push(r);
    const out = {};
    for (const [m, rows] of Object.entries(byMarket)) out[m] = marketHistoryFrom(rows);
    return out;
  } catch (e) { return {}; }
}
// Every subject's history for one week, in ONE query. The market engine builds
// sixty-odd records at a time and a per-player round trip would be sixty D1
// reads on a request path -- which is not a slow version of this, it is a
// different order of cost. Bounded hard: a week of four pulls a day across
// every book is comfortably inside the limit, and a run that hit it would be
// truncating the OLDEST rows, so the cap is applied to the newest instead.
const MARKET_WEEK_ROW_CAP = 40000;
async function marketHistoryWeek(env, season, week) {
  if (!(await snapshotReady(env))) return {};
  try {
    const q = await env.LEADS_DB.prepare(
      'SELECT ts, book, subject, subject_type, market, line, over_odds, under_odds ' +
      'FROM odds_snapshots WHERE season IS ? AND week IS ? ORDER BY ts ASC LIMIT ?')
      .bind(season == null ? null : Number(season), week == null ? null : Number(week), MARKET_WEEK_ROW_CAP).all();
    const bySubject = {};
    for (const r of (q.results || [])) {
      const b = bySubject[r.subject] || (bySubject[r.subject] = {});
      (b[r.market] = b[r.market] || []).push(r);
    }
    const out = {};
    for (const [subject, markets] of Object.entries(bySubject)) {
      out[subject] = {};
      for (const [m, rows] of Object.entries(markets)) out[subject][m] = marketHistoryFrom(rows);
    }
    return out;
  } catch (e) { return {}; }
}
// One player's markets, shaped for vegasProjection, out of a history object
// that is already in memory. Pure: no DB, so the engine can build every record
// off a single read.
function marketPropsFrom(hist) {
  const props = {}, movement = {};
  let asOf = 0;
  for (const [m, h] of Object.entries(hist || {})) {
    if (!h) continue;
    props[m] = (h.perBook || []).map(b => ({ book: b.book, line: b.current,
      overOdds: b.overOdds, underOdds: b.underOdds }));
    movement[m] = { open: h.open, current: h.current, movement: h.movement,
      percentChange: h.percentChange, books: h.books, booksAtOpen: h.booksAtOpen,
      booksMoved: h.booksMoved, booksUp: h.booksUp, booksDown: h.booksDown,
      agreement: h.agreement, median: h.median, lastSeen: h.lastSeen,
      tdOpenProbability: h.tdOpenProbability, tdCurrentProbability: h.tdCurrentProbability };
    if (h.lastSeen > asOf) asOf = h.lastSeen;
  }
  return { props, movement, asOf: asOf || null };
}
// Game lines for a set of games, whatever week they were first written in: a
// Week 3 line is posted during Week 1 and its OPEN is in a row tagged week 1,
// so the game id, not the week column, is the key here.
async function marketHistoryGames(env, gameIds) {
  const ids = (gameIds || []).map(String).filter(Boolean).slice(0, 40);
  if (!ids.length || !(await snapshotReady(env))) return {};
  try {
    const q = await env.LEADS_DB.prepare(
      'SELECT ts, book, subject, subject_type, market, line, over_odds, under_odds FROM odds_snapshots ' +
      'WHERE subject_type = ? AND subject IN (' + ids.map(() => '?').join(',') + ') ORDER BY ts ASC LIMIT 20000')
      .bind('game', ...ids).all();
    const by = {};
    for (const r of (q.results || [])) ((by[r.subject] = by[r.subject] || {})[r.market] = by[r.subject][r.market] || []).push(r);
    const out = {};
    for (const [g, mk] of Object.entries(by)) { out[g] = {}; for (const [m, rows] of Object.entries(mk)) out[g][m] = marketHistoryFrom(rows); }
    return out;
  } catch (e) { return {}; }
}
async function snapshotStatus(env) {
  if (!(await snapshotReady(env))) return { ok: false, error: 'no_db' };
  try {
    const tot = await env.LEADS_DB.prepare(
      'SELECT COUNT(*) AS rows, COUNT(DISTINCT subject) AS subjects, COUNT(DISTINCT book) AS books, ' +
      'COUNT(DISTINCT market) AS markets, MIN(ts) AS first, MAX(ts) AS last FROM odds_snapshots').first();
    return { ok: true, ...tot, keepDays: SNAP_KEEP_DAYS };
  } catch (e) { return { ok: false, error: (e && e.message) || 'failed' }; }
}

// -- sportsbook markets into fantasy projections ----------------------------
// The season-long path (buildVegasOverlay) averages every book into one number
// and blends it into the committed projection. This is the WEEKLY path, and it
// answers a different question: what would this player score if the only thing
// you knew were the prices? It quotes no projection feed at all.
//
// THREE RULES IT WILL NOT BREAK.
//   1. Vig comes out before anything is believed. Both sides of a total carry
//      juice, so the raw implied probabilities sum to more than one; each pair
//      is normalised to sum to one, which is the market's honest P(over).
//   2. The MEDIAN across books, not the mean. One book hanging a stale line is
//      an outlier, and a mean lets it drag the consensus; a median does not.
//   3. A market nobody priced is NOT invented. Missing yardage is reported
//      missing and the projection says PARTIAL or UNAVAILABLE. There is no
//      fallback to a projection feed hidden inside a number labelled Vegas.
//
// What each position is expected to have priced. `core` are the markets
// without which a Vegas projection is not a projection; `extra` improve it.
const VEGAS_MARKETS = {
  QB: { core: ['passYd', 'passTD'], extra: ['passInt', 'rushYd', 'anytimeTD', 'rushTD'] },
  RB: { core: ['rushYd', 'anytimeTD'], extra: ['rushAtt', 'rec', 'recYd', 'rushTD', 'recTD'] },
  WR: { core: ['recYd', 'rec'], extra: ['anytimeTD', 'recTD', 'rushYd'] },
  TE: { core: ['recYd', 'rec'], extra: ['anytimeTD', 'recTD', 'rushYd'] }
};
// A yardage/count market is turned into an expected value; an anytimeTD market
// is a probability and is handled on its own path below.
const VEGAS_COUNT_MARKETS = ['passYd', 'passTD', 'passInt', 'rushYd', 'rushTD', 'rushAtt',
                            'recYd', 'recTD', 'rec'];
// Weekly coefficients of variation. A single game is far noisier than a season,
// so these sit well above the season-long ODDS_CV; they only bite when a book
// prices one side hard, because at a balanced price the mean IS the line.
const VEGAS_WEEK_CV = {
  passYd: 0.32, passTD: 0.60, passInt: 0.85, rushYd: 0.55, rushTD: 0.90, rushAtt: 0.35,
  recYd: 0.60, recTD: 0.90, rec: 0.40
};
// Plausible weekly bands. A line outside these is a feed error, not a market
// view, and is dropped rather than projected from.
const VEGAS_WEEK_BANDS = {
  passYd: [50, 500], passTD: [0.5, 6], passInt: [0.5, 3], rushYd: [1, 250], rushTD: [0.5, 4],
  rushAtt: [1, 40], recYd: [1, 220], recTD: [0.5, 4], rec: [0.5, 16]
};

// American odds to a probability, then a pair de-vigged. Both already exist for
// the season path and are reused rather than rewritten -- the arithmetic must
// not fork.
function _vegasDevig(over, under) { return _oddsDevigOver(over, under); }
// A single-sided price (anytime TD is usually posted as one side, sometimes
// with a 'No' beside it). With both sides the pair is de-vigged properly. With
// only one, the raw implied probability is returned AND the caller is told it
// carries vig, which costs a confidence grade rather than being silently used
// as though it were clean.
function vegasTdProbability(rows) {
  const per = [];
  for (const r of rows || []) {
    const yes = r.overOdds == null ? NaN : Number(r.overOdds);
    if (!Number.isFinite(yes)) continue;
    const no = r.underOdds == null ? NaN : Number(r.underOdds);   // null is not 0: see marketHistoryFrom
    if (Number.isFinite(no)) {
      const p = _oddsDevigOver(yes, no);
      if (p != null && p > 0 && p < 1) per.push({ p, devigged: true, book: r.book });
    } else {
      const p = _oddsImpliedProb(yes);
      if (p != null && p > 0 && p < 1) per.push({ p, devigged: false, book: r.book });
    }
  }
  if (!per.length) return null;
  return {
    probability: _median(per.map(x => x.p)),
    books: new Set(per.map(x => x.book)).size,
    devigged: per.every(x => x.devigged),
    agreement: marketAgreement(per.map(x => x.p * 100))
  };
}
// One count market across every book that priced it: de-vig each, convert each
// to a mean, then take the median of the means.
function vegasCountMarket(market, rows) {
  const band = VEGAS_WEEK_BANDS[market];
  const cv = VEGAS_WEEK_CV[market];
  if (!band || !cv) return null;
  const per = [];
  for (const r of rows || []) {
    const line = Number(r.line);
    if (!Number.isFinite(line) || line < band[0] || line > band[1]) continue;
    const p = _vegasDevig(r.overOdds, r.underOdds);
    // No prices at all means the line is taken at face value, which is exactly
    // right: with no juice to read, the market's median IS its best estimate.
    const pOver = p == null ? 0.5 : p;
    const mean = line + cv * line * _oddsProbit(pOver);
    if (!Number.isFinite(mean) || mean < 0) continue;
    per.push({ book: r.book, line, mean });
  }
  if (!per.length) return null;
  return {
    market,
    line: _median(per.map(x => x.line)),
    expected: _oddsRound(_median(per.map(x => x.mean))),
    books: new Set(per.map(x => x.book)).size,
    agreement: marketAgreement(per.map(x => x.line))
  };
}

// Confidence. Five inputs, and it is a DEMOTION model rather than a sum,
// because a sum lets a projection stay HIGH while carrying a serious defect
// that the other four inputs outvote -- which is exactly backwards. One
// serious problem means it is not HIGH. Two mean it is LOW. A player the
// injury feed has ruled out is LOW on his own, however well priced he is,
// because the market has not caught up with a decision already made.
const VEGAS_CONF_FRESH_HOURS = 12;
const VEGAS_CONF_STALE_HOURS = 36;
const VEGAS_CONF_MIN_BOOKS = 2;
const VEGAS_CONF_MIN_AGREE = 0.6;
const VEGAS_OUT_RE = /\b(out|ir|doubtful|susp|suspended|exempt|pup|nfi|dnr)\b/i;
function vegasConfidence(f) {
  const reasons = [];
  const demote = (why) => { reasons.push(why); };

  if (f.coreMissing > 0) {
    demote(f.coreMissing === 1 ? 'a core market is unpriced' : f.coreMissing + ' core markets are unpriced');
  }
  if (!(f.books >= VEGAS_CONF_MIN_BOOKS)) {
    demote(f.books === 1 ? 'only one book priced him' : 'no book priced him');
  } else if (f.agreement == null) {
    demote('agreement cannot be measured');
  } else if (f.agreement < VEGAS_CONF_MIN_AGREE) {
    demote('the books disagree with each other');
  }
  if (f.ageHours == null) demote('the pull has no timestamp');
  else if (f.ageHours > VEGAS_CONF_STALE_HOURS) demote('the lines are more than a day and a half old');

  // Not a demotion, but worth saying: fresh-ish rather than fresh.
  const soft = [];
  if (f.ageHours != null && f.ageHours > VEGAS_CONF_FRESH_HOURS && f.ageHours <= VEGAS_CONF_STALE_HOURS) {
    soft.push('the lines are over half a day old');
  }
  if (f.marketCount < 3) soft.push('only ' + f.marketCount + ' market' + (f.marketCount === 1 ? '' : 's') + ' priced');

  // The injury clause. A questionable tag is a caution; a ruled-out tag is not
  // a caution, it is the answer.
  let ruledOut = false;
  if (f.injuryStatus) {
    if (VEGAS_OUT_RE.test(String(f.injuryStatus))) { ruledOut = true; reasons.push('he is listed ' + f.injuryStatus); }
    else soft.push('he is listed ' + f.injuryStatus);
  }

  const level = ruledOut ? 'LOW'
    : reasons.length === 0 ? 'HIGH'
    : reasons.length === 1 ? 'MEDIUM'
    : 'LOW';
  return { level, demotions: reasons.length, ruledOut, reasons: reasons.concat(soft) };
}
// The projection itself. `markets` is { market: [ {book, line, overOdds,
// underOdds}, ... ] } -- whatever the odds provider actually returned for this
// player this week, already keyed to Iron Tuna's stat names by the adapter.
function vegasProjection(markets, position, rules, ctx) {
  const pos = String(position || '').toUpperCase();
  const spec = VEGAS_MARKETS[pos];
  const c = ctx || {};
  if (!spec) return { ok: false, status: 'unavailable', reason: 'unpriced_position', position: pos };
  const priced = {};
  const books = new Set();
  const agrees = [];
  for (const m of VEGAS_COUNT_MARKETS) {
    const got = vegasCountMarket(m, (markets || {})[m]);
    if (!got) continue;
    priced[m] = got;
    for (const r of markets[m]) if (r && r.book) books.add(r.book);
    if (got.agreement != null) agrees.push(got.agreement);
  }
  const td = vegasTdProbability((markets || {}).anytimeTD);
  if (td) { for (const r of markets.anytimeTD) if (r && r.book) books.add(r.book); if (td.agreement != null) agrees.push(td.agreement); }

  const have = new Set(Object.keys(priced));
  if (td) have.add('anytimeTD');
  const coreMissing = spec.core.filter(m => !have.has(m));
  // Nothing at all, or no core market priced: say so. A projection assembled
  // from one extra market and silence is not a partial projection, it is a
  // guess with a Vegas label on it.
  if (!have.size || coreMissing.length === spec.core.length) {
    return { ok: false, status: 'unavailable', position: pos,
             label: 'Vegas projection unavailable',
             reason: !have.size ? 'no_markets' : 'no_core_market',
             missing: spec.core.filter(m => !have.has(m)), priced: [...have] };
  }

  // Stats, in Iron Tuna's own keys, from priced markets ONLY.
  const stats = {};
  const src = {};
  for (const [m, v] of Object.entries(priced)) {
    if (m === 'rushAtt') continue;              // usage, not a scoring stat
    stats[m] = v.expected;
    src[m] = { line: v.line, books: v.books, agreement: v.agreement };
  }
  // The touchdown. A book's anytime-TD price is a PROBABILITY of at least one,
  // not an expected count, so it is worth p x (points per TD) and is added as
  // fantasy points rather than smuggled in as a fractional touchdown -- the two
  // differ whenever a player can score twice, and calling them the same thing
  // is the error this comment exists to prevent.
  const r = rules || SCORING_BASE;
  let tdPoints = 0, tdBlock = null;
  if (td && td.probability != null) {
    const perTd = tdPointsFor(pos, r);
    tdPoints = td.probability * perTd;
    tdBlock = { probability: Math.round(td.probability * 1000) / 10, pointsPerTd: perTd,
                expectedPoints: _oddsRound(tdPoints), books: td.books, devigged: td.devigged,
                source: 'anytime-td-market' };
  }
  // A priced rushTD/recTD market is an expected COUNT and scores normally; if
  // an anytime-TD price is also present the count markets win, because a count
  // carries multi-score games that a binary cannot.
  const hasCountTd = stats.rushTD != null || stats.recTD != null;
  const base = scoreStats(stats, pos, r);
  const points = _oddsRound(base + (hasCountTd ? 0 : tdPoints));

  const agreement = agrees.length ? agrees.reduce((a, b) => a + b, 0) / agrees.length : null;
  const ageHours = c.asOf ? Math.max(0, (Date.now() - c.asOf) / 3600000) : null;
  const confidence = vegasConfidence({
    coreMissing: coreMissing.length, marketCount: have.size, books: books.size,
    agreement, ageHours, injuryStatus: c.injuryStatus || null
  });
  const partial = coreMissing.length > 0;
  return {
    ok: true,
    status: partial ? 'partial' : 'full',
    label: partial ? 'Partial Vegas projection' : 'Vegas projection',
    position: pos, stats, points,
    td: tdBlock,
    tdCountedFromMarket: hasCountTd,
    markets: src,
    priced: [...have].sort(),
    missing: coreMissing.concat(spec.extra.filter(m => !have.has(m))),
    missingCore: coreMissing,
    books: books.size,
    agreement: agreement == null ? null : Math.round(agreement * 100) / 100,
    asOf: c.asOf || null,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    confidence: confidence.level,
    confidenceDemotions: confidence.demotions,
    confidenceReasons: confidence.reasons
  };
}

// -- the Iron Tuna Market Engine -------------------------------------------
// ONE record per player per week, assembled from every provider kind, in one
// shape. Everything in the in-season section reads this rather than each
// surface joining odds to projections to injuries its own way -- which is how
// two pages end up disagreeing about the same player on the same afternoon.
//
// The record has four blocks and they are kept apart on purpose:
//   fantasy  what the projections say, scored at the caller's rules
//   vegas    what the money says: game line, team totals, player props, the
//            props-only projection, and how the market has MOVED
//   usage    what actually happened on the field, where a feed publishes it
//   context  injury, opponent, game state -- the things that decide whether
//            the other three blocks are worth reading at all
//
// A FIELD WITH NO SOURCE IS null AND IS NAMED IN `unavailable`. It is never a
// zero and never an estimate. Reading a null as "he had no targets" is the
// mistake this costs one list to prevent.
const MARKET_CONTRACT = 1;
let _MARKET_MEMO = { key: '', at: 0, out: null };
let _EDGE_MEMO = { key: '', at: 0, out: null };
const MARKET_ROW = 5;                       // odds_overlay row 5: the usage overlay
const MARKET_MAX_AGE_MS = 14 * 86400000;
const MARKET_MEMO_MS = 300000;

// Implied points for both sides of a game, from the spread and the total. The
// favourite gets half the total plus half the margin. nflverse writes
// spread_line as the HOME margin, so a positive number is the home side.
function marketImplied(game) {
  if (!game) return { home: null, away: null };
  if (game.impliedHome != null || game.impliedAway != null) return { home: game.impliedHome, away: game.impliedAway };
  return _seasonDecorate(game, Date.now()).impliedHome == null ? { home: null, away: null }
       : { home: _seasonDecorate(game, Date.now()).impliedHome, away: _seasonDecorate(game, Date.now()).impliedAway };
}

// The usage overlay: one D1 row holding the latest weekly line for every
// player the stats feed carries. Built by the cron, because the weekly file is
// ~9MB and the snaps file ~2.5MB and neither belongs on a request path.
async function usageCacheWrite(env, payload) {
  await oddsCacheInit(env);
  await env.LEADS_DB.prepare(
    'INSERT OR REPLACE INTO odds_overlay (id, payload, provider, matched, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(MARKET_ROW, JSON.stringify(payload), 'nflverse-usage',
         Object.keys(payload.players || {}).length, Date.now()).run();
}
let _USAGE_CACHE = null, _USAGE_AT = 0;
async function usageCacheRead(env) {
  if (_USAGE_CACHE && Date.now() - _USAGE_AT < MARKET_MEMO_MS) return _USAGE_CACHE;
  if (!env || !env.LEADS_DB) return null;
  try {
    const row = await env.LEADS_DB.prepare('SELECT payload, updated_at FROM odds_overlay WHERE id=?')
      .bind(MARKET_ROW).first();
    if (!row || !row.payload) return null;
    if (!row.updated_at || Date.now() - row.updated_at > MARKET_MAX_AGE_MS) return null;
    const j = JSON.parse(row.payload);
    if (!j || !j.players) return null;
    _USAGE_CACHE = { ...j, updatedAt: row.updated_at };
    _USAGE_AT = Date.now();
    return _USAGE_CACHE;
  } catch (e) { return null; }
}
// Pull the weekly stats and the snap counts, keep the LATEST week each player
// appears in, and index by the site's own player key. Season-to-date totals
// ride along so a surface can say "he has averaged 6 targets" without a second
// pass over 9MB of CSV.
async function runUsageRefresh(env, season) {
  if (!env || !env.LEADS_DB) return { ok: false, error: 'no_db' };
  const yr = season || (await scheduleCacheRead(env) || {}).season || new Date().getUTCFullYear();
  let weekly = [], snaps = [], err = null;
  try { weekly = await fetchStatsNflverseWeekly(yr); }
  catch (e) { err = 'weekly: ' + ((e && e.message) || 'failed'); }
  try { snaps = await fetchSnapsNflverse(yr); } catch (e) { err = (err ? err + '; ' : '') + 'snaps: ' + ((e && e.message) || 'failed'); }
  // No games played yet is not a failure. It is September.
  if (!weekly.length && !snaps.length) {
    return { ok: true, season: yr, players: 0, weeks: 0, note: 'no weekly stats published yet', error: err };
  }
  const players = {};
  const key = (n, p) => _oddsNorm(n) + '|' + p;
  let maxWeek = 0;
  for (const r of weekly) {
    if (r.seasonType !== 'REG' || !r.week) continue;
    if (r.week > maxWeek) maxWeek = r.week;
    const k = key(r.name, r.position);
    const rec = players[k] || (players[k] = { name: r.name, position: r.position, team: r.team,
      latest: null, season: { games: 0, targets: 0, carries: 0, receptions: 0, airYards: 0, tds: 0, points: 0 } });
    rec.team = r.team;
    rec.season.games++;
    rec.season.targets += r.usage.targets || 0;
    rec.season.carries += r.usage.carries || 0;
    rec.season.receptions += r.usage.receptions || 0;
    rec.season.airYards += r.usage.airYards || 0;
    rec.season.tds += (r.stats.rushTD || 0) + (r.stats.recTD || 0);
    if (!rec.latest || r.week > rec.latest.week) {
      rec.latest = { week: r.week, opponent: r.opponent, stats: r.stats, usage: r.usage };
    }
  }
  for (const s of snaps) {
    if (s.seasonType !== 'REG' || !s.week) continue;
    const k = key(s.name, s.position);
    const rec = players[k];
    if (!rec || !rec.latest || rec.latest.week !== s.week) continue;
    rec.latest.usage = { ...rec.latest.usage, snaps: s.snaps, snapPct: s.snapPct };
  }
  const payload = { season: yr, throughWeek: maxWeek, players, builtAt: Date.now() };
  await usageCacheWrite(env, payload);
  _USAGE_CACHE = null; _USAGE_AT = 0;
  return { ok: true, season: yr, players: Object.keys(players).length, throughWeek: maxWeek,
           weekly: weekly.length, snaps: snaps.length, error: err };
}

// Player props, grouped per player per market, straight out of the snapshot
// store so the engine reads ONE source for both the current line and its
// history. Falls back to nothing rather than to the season overlay: a season
// prop is not a week's prop, and pretending otherwise is the single most
// tempting mistake available here.
async function marketPropsFor(env, subject) {
  return marketPropsFrom(await marketHistoryAll(env, subject));
}

// Build the records. `opts`: { week, position, limit, preset, custom }.
async function buildMarketRecords(env, opts) {
  const o = opts || {};
  const rules = scoringRules(o.preset, o.custom);
  const sched = await scheduleCacheRead(env);
  if (!sched) return { ok: false, error: 'no_schedule', contract: MARKET_CONTRACT };
  const state = nflSeasonState(sched, Date.now());
  const week = Number.isFinite(o.week) ? o.week : (state.ok ? state.week.number : null);
  const type = o.type || (state.ok ? state.week.type : 'REG');
  const wk = nflSeasonWeek(sched, Date.now(), type, week);
  const games = (wk.ok && wk.games) || [];
  // Which club plays whom, and where each game stands.
  const byTeam = new Map();
  for (const g of games) {
    const imp = marketImplied(g);
    byTeam.set(g.home, { game: g, opponent: g.away, home: true, implied: imp.home, opponentImplied: imp.away });
    byTeam.set(g.away, { game: g, opponent: g.home, home: false, implied: imp.away, opponentImplied: imp.home });
  }
  const usage = await usageCacheRead(env);
  const avail = await availabilityTable(env);
  const overlay = await oddsCacheRead(env);
  const pool = _availPool(PROJECTIONS);
  // ONE read for the whole week's markets. Sixty records used to mean sixty D1
  // queries; this is one, grouped in memory.
  const weekMarkets = await marketHistoryWeek(env, sched.season, wk.ok && wk.requested ? wk.requested.number : week);
  const nameIndex = _oddsProjectionIndex();
  const wantPos = o.position ? String(o.position).toUpperCase() : null;

  // The consensus rank per position, at the caller's scoring, so the record's
  // rank means what the caller's league means by it.
  const scored = [];
  for (const p of pool) {
    if (!PROVIDER_POSITIONS.has(p.position)) continue;
    scored.push({ p, points: scoreStats(p.projectedStats, p.position, rules) });
  }
  const rankBy = {};
  for (const pos of PROVIDER_POSITIONS) {
    const at = scored.filter(x => x.p.position === pos).sort((a, b) => b.points - a.points || (a.p.name < b.p.name ? -1 : 1));
    at.forEach((x, i) => { rankBy[_oddsNorm(x.p.name) + '|' + pos] = i + 1; });
  }

  const out = [];
  const limit = Math.min(Math.max(1, Number(o.limit) || 60), 400);
  const ordered = scored.filter(x => !wantPos || x.p.position === wantPos)
    .sort((a, b) => b.points - a.points).slice(0, limit);
  for (const { p, points } of ordered) {
    const k = _oddsNorm(p.name) + '|' + p.position;
    const team = teamKey(p.team);
    const slot = byTeam.get(team) || null;
    const a = avail[k] || null;
    const u = usage && usage.players ? usage.players[k] : null;
    // Joined on the normalised name, the same rule the season overlay uses,
    // and an AMBIGUOUS name (two board players, one key) gets no props at all:
    // a prop on the wrong man is worse than no prop.
    const nk = _oddsNorm(p.name);
    const mk = nameIndex.get(nk) === null ? { props: {}, movement: {}, asOf: null, ambiguous: true }
             : marketPropsFrom(weekMarkets[nk]);
    const vp = vegasProjection(mk.props, p.position, rules,
      { asOf: mk.asOf, injuryStatus: a ? a.status : null });
    // Season-long odds view of this player, which the site already computes.
    // Kept beside the weekly one and clearly labelled: they answer different
    // questions and a reader must never see one under the other's heading.
    const seasonOdds = overlay && overlay.overlay ? overlay.overlay[k] || null : null;
    out.push({
      player: { name: p.name, position: p.position, team, key: k },
      season: sched.season, week: wk.ok && wk.requested ? wk.requested.number : week,
      weekType: type,
      fantasy: {
        projection: { stats: { ...(p.projectedStats || {}) }, points: _oddsRound(points), basis: 'season-long' },
        consensusRank: rankBy[k] || null,
        scoring: { preset: o.preset || (o.custom ? 'custom' : 'ppr'), rules: undefined }
      },
      vegas: {
        game: slot ? { id: slot.game.id, spread: slot.game.spread, total: slot.game.total,
                       kickoff: slot.game.kickoff, status: slot.game.status } : null,
        teamImplied: slot ? slot.implied : null,
        opponentImplied: slot ? slot.opponentImplied : null,
        props: mk.props,
        movement: mk.movement,
        projection: vp,
        confidence: vp.ok ? vp.confidence : 'LOW',
        seasonOverlay: seasonOdds
      },
      usage: u ? {
        throughWeek: usage.throughWeek, latestWeek: u.latest ? u.latest.week : null,
        snaps: u.latest && u.latest.usage.snaps != null ? u.latest.usage.snaps : null,
        snapPct: u.latest && u.latest.usage.snapPct != null ? u.latest.usage.snapPct : null,
        targets: u.latest ? u.latest.usage.targets : null,
        targetShare: u.latest ? u.latest.usage.targetShare : null,
        airYards: u.latest ? u.latest.usage.airYards : null,
        airYardsShare: u.latest ? u.latest.usage.airYardsShare : null,
        carries: u.latest ? u.latest.usage.carries : null,
        receptions: u.latest ? u.latest.usage.receptions : null,
        passAttempts: u.latest ? u.latest.usage.passAttempts : null,
        seasonTotals: u.season,
        // Named, not silently absent. See PROVIDER_UNAVAILABLE.
        unavailable: ['routes', 'routeParticipation', 'redZoneTouches', 'redZoneTargets',
                      'goalLineCarries', 'pace', 'passRate']
      } : { unavailable: ['snaps', 'snapPct', 'targets', 'targetShare', 'airYards', 'airYardsShare',
                          'carries', 'receptions', 'passAttempts', 'routes', 'routeParticipation',
                          'redZoneTouches', 'redZoneTargets', 'goalLineCarries', 'pace', 'passRate'],
            note: 'no weekly usage published for this player yet' },
      context: {
        opponent: slot ? slot.opponent : null,
        home: slot ? slot.home : null,
        gameStatus: slot ? slot.game.status : null,
        kickoff: slot ? slot.game.kickoff : null,
        onBye: !slot && type === 'REG',
        injuryStatus: a ? a.status : null,
        gamesOut: a ? a.gamesOut : null,
        injuryNote: a ? (a.note || '') : '',
        depthChart: null,
        lineupChange: null,
        unavailable: ['depthChart', 'lineupChange']
      }
    });
  }
  return {
    ok: true, contract: MARKET_CONTRACT,
    season: sched.season, week: wk.ok && wk.requested ? wk.requested.number : week, weekType: type,
    scoring: { preset: o.preset || (o.custom ? 'custom' : 'ppr'),
               label: SCORING_PRESET_LABEL[o.preset || (o.custom ? 'custom' : 'ppr')] || 'PPR' },
    sources: { schedule: sched.provider, odds: overlay ? overlay.provider : null,
               usage: usage ? 'nflverse-usage' : null,
               usageThroughWeek: usage ? usage.throughWeek : null },
    records: out
  };
}

// -- the rankings payload ---------------------------------------------------
// Ships STAT LINES, not points. The rankings page has four scoring buttons and
// the reader expects the board to re-order the instant one is pressed, so the
// scoring has to happen in the browser -- a round trip per button press is a
// worse product and a pointless load. it-league.js already carries the same
// engine as scoreStats above (tools/test-scoring.mjs pins the two together),
// so the client can score these lines at Standard, Half PPR, PPR or the
// reader's own saved rules and get exactly what the server would have said.
//
// Three lines per player, because the whole point of the product is the gap:
// what the projections say, what the odds alone say, and what the site ships.
const RANKINGS_CONTRACT = 1;
let _RANK_CACHE = null, _RANK_AT = 0;
async function rankingsPayload(env) {
  if (_RANK_CACHE && Date.now() - _RANK_AT < 900000) return _RANK_CACHE;
  const sched = await scheduleCacheRead(env);
  const state = sched ? nflSeasonState(sched, Date.now()) : { ok: false };
  const cached = await oddsCacheRead(env);
  const tctx = cached ? await oddsCtxRead(env) : null;
  const board = cached && cached.overlay ? buildVegasBoard(cached.overlay, tctx) : { ok: false, rows: [] };
  const avail = await availabilityTable(env);
  // Who plays whom this week, so a ranking can say the opponent and the bye
  // without a second call.
  const byTeam = new Map();
  if (state.ok) {
    for (const g of state.games || []) {
      const imp = marketImplied(g);
      byTeam.set(g.home, { opponent: g.away, home: true, implied: imp.home, against: imp.away, status: g.status, kickoff: g.kickoff });
      byTeam.set(g.away, { opponent: g.home, home: false, implied: imp.away, against: imp.home, status: g.status, kickoff: g.kickoff });
    }
  }
  const rowByKey = new Map();
  for (const r of (board.rows || [])) rowByKey.set(_oddsNorm(r.name) + '|' + r.position, r);
  const players = [];
  for (const p of _availPool(PROJECTIONS)) {
    if (!PROVIDER_POSITIONS.has(p.position)) continue;
    const k = _oddsNorm(p.name) + '|' + p.position;
    const r = rowByKey.get(k);
    const team = teamKey(p.team);
    const slot = byTeam.get(team) || null;
    const a = avail[k] || null;
    players.push({
      name: p.name, position: p.position, team,
      statsConsensus: r ? r.statsConsensus : _colStatLine(p.projectedStats),
      statsMarket: r ? r.statsMarket : null,
      statsIronTuna: r ? r.statsIronTuna : _colStatLine(p.projectedStats),
      priced: r ? !!r.priced : false,
      opponent: slot ? slot.opponent : null,
      home: slot ? slot.home : null,
      teamImplied: slot ? slot.implied : null,
      opponentImplied: slot ? slot.against : null,
      gameStatus: slot ? slot.status : null,
      onBye: !slot && state.ok && state.week.type === 'REG',
      injuryStatus: a ? a.status : null,
      gamesOut: a ? a.gamesOut : null
    });
  }
  const out = {
    ok: players.length > 0, contract: RANKINGS_CONTRACT,
    season: sched ? sched.season : null,
    week: state.ok ? { label: state.week.label, number: state.week.number, type: state.week.type,
                       status: state.week.status, byes: state.week.byes } : null,
    phase: state.ok ? state.phase : null,
    presets: Object.keys(SCORING_PRESET_LABEL).map(k => ({ key: k, label: SCORING_PRESET_LABEL[k] })),
    defaults: SCORING_BASE,
    oddsAsOf: cached ? cached.updatedAt : null,
    oddsProvider: cached ? cached.provider : null,
    marketBoard: !!(board && board.ok),
    players
  };
  _RANK_CACHE = out; _RANK_AT = Date.now();
  return out;
}

// The odds pull, snapshotted. Runs the odds providers through the registry and
// appends every changed line to the history table. Separate from
// runOddsRefresh, which builds the season overlay: that one wants a consensus,
// this one wants every book's own number, and merging them would lose exactly
// the per-book detail line movement is made of.
async function runMarketSnapshot(env) {
  if (!env || !env.LEADS_DB) return { ok: false, error: 'no_db' };
  const sched = await scheduleCacheRead(env);
  const state = sched ? nflSeasonState(sched, Date.now()) : null;
  const ctx = { season: sched ? sched.season : null,
                week: state && state.ok ? state.week.number : null, ts: Date.now() };
  const run = await providerRun(env, 'odds', ctx);
  const rows = [];
  for (const r of run.results) for (const x of r.rows || []) rows.push(x);
  const wrote = await snapshotWrite(env, rows, ctx);
  return { ok: !!wrote.ok, ...ctx, providers: run.results.map(r => ({
    provider: r.provider, rows: r.count || 0, skipped: r.skipped || null, error: r.error || null })),
    ...wrote };
}

// -- kickers and defences, scored -------------------------------------------
// Mirrors scoreKicker / scoreDefense in index.html at the app's default tiers,
// so the K and DST views rank on the same arithmetic the cheat sheet uses. The
// make- and miss-distance mixes are the app's own (see its comment on why the
// misses pile up on the long attempts). tools/test-scoring.mjs holds this to
// index.html's copy.
const SCORING_KDEF = {
  fieldGoalTiers: [{ min: 0, max: 24, points: 1, missPoints: -4 }, { min: 25, max: 34, points: 2, missPoints: -3 },
                   { min: 35, max: 44, points: 3, missPoints: -2 }, { min: 45, max: 49, points: 4, missPoints: -1 },
                   { min: 50, max: 999, points: 4, missPoints: 0 }],
  extraPoint: 1, missedExtraPoint: -1,
  defensiveFumbleRecovery: 2, defensiveTD: 4, interception: 2, sackPoints: 1,
  sackBonuses: [{ at: 5, points: 1 }, { at: 10, points: 1 }], safety: 4,
  specialTeamsTD: 6, specialTeams2pt: 2, specialTeamsSafety1pt: 1,
  pointsAllowed: [{ min: 0, max: 0, points: 10 }, { min: 1, max: 3, points: 8 }, { min: 4, max: 6, points: 7 },
                  { min: 7, max: 9, points: 6 }, { min: 10, max: 13, points: 5 }, { min: 14, max: 17, points: 4 },
                  { min: 18, max: 21, points: 3 }, { min: 22, max: 27, points: 2 }, { min: 28, max: 34, points: 1 },
                  { min: 35, max: 999, points: 0 }]
};
const _K_MAKE = [0.18, 0.28, 0.32, 0.17, 0.05];
const _K_MISS = [0.02, 0.06, 0.17, 0.25, 0.50];
function _tierPoints(value, tiers) { for (const t of tiers || []) if (value >= t.min && value <= t.max) return t.points; return 0; }
function scoreKickerStats(stats, rules) {
  const s = { ...SCORING_KDEF, ...(rules || {}) };
  const st = stats || {};
  const tiers = Array.isArray(s.fieldGoalTiers) && s.fieldGoalTiers.length === 5 ? s.fieldGoalTiers : SCORING_KDEF.fieldGoalTiers;
  let pts = 0;
  const made = st.fgMade || 0, missed = st.fgMissed || 0;
  for (let i = 0; i < 5; i++) {
    pts += made * _K_MAKE[i] * (tiers[i].points || 0);
    pts += missed * _K_MISS[i] * (tiers[i].missPoints || 0);
  }
  pts += (st.xpMade || 0) * (Number.isFinite(s.extraPoint) ? s.extraPoint : 1);
  pts += (st.xpMissed || 0) * (Number.isFinite(s.missedExtraPoint) ? s.missedExtraPoint : -1);
  return pts;
}
function scoreDefenseStats(stats, rules, games) {
  const s = { ...SCORING_KDEF, ...(rules || {}) };
  const st = stats || {};
  const g = games > 0 ? games : 17;
  let pts = 0;
  pts += _scCount(st.sacks || 0, s.sackPoints, s.sackBonuses);
  pts += (st.ints || 0) * s.interception;
  pts += (st.fumRec || 0) * s.defensiveFumbleRecovery;
  pts += (st.defTD || 0) * s.defensiveTD;
  pts += (st.stTD || 0) * s.specialTeamsTD;
  pts += (st.safety || 0) * s.safety;
  pts += (st.st2pt || 0) * s.specialTeams2pt;
  pts += (st.stSafety1pt || 0) * s.specialTeamsSafety1pt;
  if (st.ptsAllowed !== undefined) {
    const ppg = Math.floor(st.ptsAllowed / g);
    pts += _tierPoints(ppg, s.pointsAllowed) * g;
  }
  return pts;
}
// Any position. `games` is how many games the stat line spans, which the
// points-allowed tiers need because they are per game.
function scoreAny(stats, position, rules, games) {
  if (position === 'K') return scoreKickerStats(stats, rules);
  if (position === 'DEF' || position === 'DST') return scoreDefenseStats(stats, rules, games);
  return scoreStats(stats, position, rules);
}

// -- the three boards --------------------------------------------------------
// Every player, three numbers, four horizons. CONSENSUS is the conventional
// expectation: the committed projection spread over the games he can play,
// odds-blind. VEGAS is what the money says, in strictly descending order of
// evidence: a priced player prop for the week where one exists; the posted
// game line's implied scoring environment where one exists; the fitted team
// ratings (marketSeasonTotals) for a fixture no book has posted yet, which is
// still market-derived but is a projection OF the market, and is graded LOW
// for exactly that reason. IRON TUNA is the blend, weighted by how much the
// Vegas side actually knows.
//
// NOTHING HERE PRETENDS A PROP EXISTS. A week with no priced prop says so in
// `basis`, its Vegas number is the environment-scaled consensus line, and its
// confidence is capped. Three weeks out, no book has a prop up, and the board
// says LOW rather than HIGH with a straight face.
const BOARDS_CONTRACT = 1;
const ROS_LAST_WEEK_DEFAULT = 17;          // Week 18 is out unless the league says otherwise
const PLAYOFF_WEEKS = [15, 16, 17];
const HORIZONS = {
  week: { key: 'week', label: 'This Week' },
  next3: { key: 'next3', label: 'Next 3 Weeks', span: 3 },
  ros: { key: 'ros', label: 'Rest of Season' },
  playoffs: { key: 'playoffs', label: 'Fantasy Playoffs: Weeks 15-17', weeks: PLAYOFF_WEEKS }
};
// How far a single week's scoring environment may move a line. Wider than the
// season clamp because a week is one game, not seventeen averaged.
const WEEK_ENV_CLAMP = [0.72, 1.32];
const WEEK_ENV_YARD_EXP = 0.5;             // the season path's damping, kept
// The blend weight on the Vegas side, by what it is built from.
const IT_BLEND = { HIGH: 0.75, MEDIUM: 0.6, LOW: 0.45 };
// A role factor from live usage, applied only once there is enough of it to
// mean anything, and never allowed to move a line by more than a tenth: it is
// a nudge toward expected future usage, not a re-projection.
const ROLE_MIN_GAMES = 3;
const ROLE_CLAMP = [0.9, 1.1];
const ROLE_GAIN = 0.5;

// The market's own view of every fixture: fitted ratings from the games that
// carry a line, projected onto the ones that do not. One fit per isolate per
// schedule row.
let _RATINGS_CACHE = null, _RATINGS_KEY = '';
function teamRatingsFrom(sched) {
  const key = sched ? String(sched.updatedAt) + ':' + sched.games.length : '';
  if (_RATINGS_CACHE && _RATINGS_KEY === key) return _RATINGS_CACHE;
  const reg = (sched && sched.games || []).filter(g => g.type === 'REG').map(g => ({
    ...g, priced: Number.isFinite(g.spread) && Number.isFinite(g.total) && g.total >= 20 && g.total <= 80 && Math.abs(g.spread) <= 30
  }));
  let fit = null;
  try { fit = _mktFit(reg, MARKET_RIDGE); } catch (e) { fit = null; }
  const fixtures = {};       // team -> week -> fixture
  const seasonExp = {};      // team -> mean expected points across the schedule
  const seasonAllowed = {};  // team -> mean expected points ALLOWED
  for (const g of reg) {
    let hp = null, ap = null;
    if (fit) { hp = fit.mu + fit.off[g.home] + fit.def[g.away] + fit.hfa; ap = fit.mu + fit.off[g.away] + fit.def[g.home] - fit.hfa; }
    const ih = g.priced ? g.total / 2 + g.spread / 2 : null;
    const ia = g.priced ? g.total / 2 - g.spread / 2 : null;
    const put = (t, opp, home, exp, imp, allowedExp, allowedImp) => {
      (fixtures[t] = fixtures[t] || {})[g.week] = { week: g.week, opponent: opp, home, gameId: g.id, kickoff: g.kickoff,
        expected: exp == null ? null : _oddsRound(exp), implied: imp == null ? null : _oddsRound(imp),
        allowedExpected: allowedExp == null ? null : _oddsRound(allowedExp), allowedImplied: allowedImp == null ? null : _oddsRound(allowedImp),
        posted: g.priced, spread: g.spread, total: g.total, status: g.status || null };
      const use = imp != null ? imp : exp;
      const useA = allowedImp != null ? allowedImp : allowedExp;
      if (use != null) (seasonExp[t] = seasonExp[t] || []).push(use);
      if (useA != null) (seasonAllowed[t] = seasonAllowed[t] || []).push(useA);
    };
    put(g.home, g.away, true, hp, ih, ap, ia);
    put(g.away, g.home, false, ap, ia, hp, ih);
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const avg = {}, avgAllowed = {};
  for (const t of Object.keys(fixtures)) { avg[t] = mean(seasonExp[t] || []); avgAllowed[t] = mean(seasonAllowed[t] || []); }
  // Defensive strength rank: 1 = allows the fewest expected points.
  const defRank = {};
  Object.entries(avgAllowed).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]).forEach(([t], i) => { defRank[t] = i + 1; });
  _RATINGS_CACHE = { ok: !!fit, fixtures, avg, avgAllowed, defRank, teams: Object.keys(fixtures).length };
  _RATINGS_KEY = key;
  return _RATINGS_CACHE;
}
// One club's environment for one week. `factor` is what scales a player's
// per-game line; `basis` says what it came from.
function weekEnvironment(ratings, team, week) {
  const fx = ratings && ratings.fixtures[team] && ratings.fixtures[team][week];
  if (!fx) return { bye: true, factor: 0, basis: 'bye', opponent: null, home: null, implied: null, expected: null, posted: false };
  const base = ratings.avg[team];
  const use = fx.implied != null ? fx.implied : fx.expected;
  let factor = (base > 0 && use != null) ? use / base : 1;
  factor = Math.min(WEEK_ENV_CLAMP[1], Math.max(WEEK_ENV_CLAMP[0], factor));
  // The same for the DEFENCE's week: points it is expected to allow, against
  // its own season mean. Below 1 is a good week for a DST.
  const baseA = ratings.avgAllowed[team];
  const useA = fx.allowedImplied != null ? fx.allowedImplied : fx.allowedExpected;
  let allowedFactor = (baseA > 0 && useA != null) ? useA / baseA : 1;
  allowedFactor = Math.min(WEEK_ENV_CLAMP[1], Math.max(WEEK_ENV_CLAMP[0], allowedFactor));
  return { bye: false, factor: _oddsRound(factor * 100) / 100, allowedFactor: _oddsRound(allowedFactor * 100) / 100,
           basis: fx.posted ? 'gamelines' : (ratings.ok ? 'ratings' : 'none'),
           opponent: fx.opponent, home: fx.home, implied: fx.implied, expected: fx.expected,
           impliedDelta: (fx.implied != null && base != null) ? _oddsRound(fx.implied - base) : null,
           posted: fx.posted, kickoff: fx.kickoff, gameId: fx.gameId, status: fx.status,
           opponentDefRank: ratings.defRank[fx.opponent] || null };
}
// A season line, made per game and scaled to a week's environment. Touchdowns
// follow the environment fully, yards at the square root, exactly as the
// season overlay does; kickers follow it fully (their whole line is team
// scoring); defences follow the points-ALLOWED factor, inverted.
const _ENV_TD = new Set(['passTD', 'rushTD', 'recTD']);
const _ENV_YD = new Set(['passYd', 'rushYd', 'recYd', 'rec']);
function weeklyStats(seasonStats, position, gamesPlayable, env) {
  const g = gamesPlayable > 0 ? gamesPlayable : AVAILABILITY_GAMES;
  const out = {};
  const f = env && Number.isFinite(env.factor) ? env.factor : 1;
  const fa = env && Number.isFinite(env.allowedFactor) ? env.allowedFactor : 1;
  for (const [k, v] of Object.entries(seasonStats || {})) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const per = n / g;
    let scale = 1;
    if (position === 'K') scale = f;
    else if (position === 'DEF') scale = k === 'ptsAllowed' ? fa : (2 - fa);   // fewer points allowed, more sacks and takeaways
    else if (_ENV_TD.has(k)) scale = f;
    else if (_ENV_YD.has(k)) scale = Math.pow(f, WEEK_ENV_YARD_EXP);
    out[k] = per * scale;
  }
  return out;
}
const _addStats = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; return a; };
const _roundStats = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, _oddsRound(v)]));
const _confScore = { HIGH: 2, MEDIUM: 1, LOW: 0 };
const _confFrom = n => n >= 1.5 ? 'HIGH' : n >= 0.75 ? 'MEDIUM' : 'LOW';

// Which weeks a horizon covers, from the clock. Never Week 18 for ROS unless
// asked, never anything but 15-17 for the playoffs, and never a week that has
// already finished.
function horizonWeeks(horizon, state, through) {
  const cur = state && state.ok && state.week.type === 'REG' ? state.week.number : null;
  const last = Math.max(1, Math.min(18, Number(through) || ROS_LAST_WEEK_DEFAULT));
  if (horizon === 'playoffs') return PLAYOFF_WEEKS.slice();
  if (cur == null) return [];
  // A week that is active still counts: its games have not all been played.
  if (horizon === 'week') return [cur];
  if (horizon === 'next3') { const o = []; for (let w = cur; w <= 18 && o.length < 3; w++) o.push(w); return o; }
  const o = []; for (let w = cur; w <= last; w++) o.push(w); return o;
}

// Market Delta. THE PRIMARY VERSION IS POINTS: Vegas projected fantasy points
// minus consensus projected fantasy points. The rank delta is beside it because
// it is what a reader recognises (WR21 to WR11), and the classification reads
// both, whichever is louder. Every threshold is here and nowhere else.
const MARKET_DELTA = {
  // rank slots, positive = Vegas higher
  strongRank: 8, leanRank: 3,
  // points over the horizon, as a share of the consensus line, so a $2 gap on
  // a kicker and a 20-point gap on a quarterback are judged on the same scale
  strongPct: 0.15, leanPct: 0.05,
  // and an absolute floor under the percentage, so rounding on a small line
  // cannot read as a strong signal
  minPointsStrong: 2.0, minPointsLean: 0.6,
  classes: ['STRONG VEGAS BUY', 'VEGAS LEANS HIGHER', 'MARKET AGREES', 'VEGAS LEANS LOWER', 'STRONG VEGAS FADE']
};
function marketDelta(consensusPts, consensusRank, vegasPts, vegasRank) {
  const pts = (Number.isFinite(vegasPts) && Number.isFinite(consensusPts)) ? _oddsRound(vegasPts - consensusPts) : null;
  const rank = (Number.isFinite(vegasRank) && Number.isFinite(consensusRank)) ? consensusRank - vegasRank : null;
  const pct = (pts != null && consensusPts > 0) ? pts / consensusPts : null;
  const D = MARKET_DELTA;
  let cls = 'MARKET AGREES';
  const strongUp = (rank != null && rank >= D.strongRank) || (pct != null && pct >= D.strongPct && pts >= D.minPointsStrong);
  const strongDn = (rank != null && rank <= -D.strongRank) || (pct != null && pct <= -D.strongPct && pts <= -D.minPointsStrong);
  const leanUp = (rank != null && rank >= D.leanRank) || (pct != null && pct >= D.leanPct && pts >= D.minPointsLean);
  const leanDn = (rank != null && rank <= -D.leanRank) || (pct != null && pct <= -D.leanPct && pts <= -D.minPointsLean);
  if (strongUp && !strongDn) cls = D.classes[0];
  else if (strongDn && !strongUp) cls = D.classes[4];
  else if (leanUp && !leanDn) cls = D.classes[1];
  else if (leanDn && !leanUp) cls = D.classes[3];
  return { points: pts, rank, pct: pct == null ? null : Math.round(pct * 1000) / 10, classification: cls,
           significant: cls !== D.classes[2] };
}

// WHY. Structured drivers first -- every one a number the reader can check --
// then a sentence assembled from which drivers are present and which is
// largest. Nothing is asserted that a driver does not show: no injury
// narrative, no coaching story, no 'the market knows something'. The data
// speaks and the sentence only points at it.
const WHY_MARKET_LABEL = { passYd: 'Passing yards', passTD: 'Passing TDs', passInt: 'Interceptions',
  rushYd: 'Rushing yards', rushTD: 'Rushing TDs', rushAtt: 'Carries', recYd: 'Receiving yards',
  rec: 'Receptions', recTD: 'Receiving TDs', anytimeTD: 'Anytime TD' };
const WHY_VOLUME = new Set(['rec', 'rushAtt', 'recYd', 'rushYd', 'passYd']);
const WHY_TD = new Set(['anytimeTD', 'rushTD', 'recTD', 'passTD']);
const _americanFromProb = p => (!(p > 0 && p < 1)) ? null : (p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p));
function explainDelta(row, movement, env, delta) {
  const drivers = [];
  for (const [m, h] of Object.entries(movement || {})) {
    if (!h || h.open == null || h.current == null) continue;
    if (m === 'anytimeTD') {
      // Stored as a line of 1 with the price carrying the probability; the
      // reader sees American odds, open to current, off the median book.
      continue;
    }
    if (h.movement === 0) continue;
    drivers.push({ kind: WHY_TD.has(m) ? 'td' : WHY_VOLUME.has(m) ? 'volume' : 'other', market: m,
      label: WHY_MARKET_LABEL[m] || m, from: h.open, to: h.current, delta: h.movement,
      pct: h.percentChange, books: h.books, booksMoved: h.booksMoved });
  }
  const tdm = movement && movement.anytimeTD;
  if (tdm && tdm.tdOpenProbability != null && tdm.tdCurrentProbability != null && tdm.tdOpenProbability !== tdm.tdCurrentProbability) {
    drivers.push({ kind: 'td', market: 'anytimeTD', label: 'Anytime TD',
      from: _americanFromProb(tdm.tdOpenProbability / 100), to: _americanFromProb(tdm.tdCurrentProbability / 100),
      delta: _oddsRound(tdm.tdCurrentProbability - tdm.tdOpenProbability), pct: tdm.tdOpenProbability ? Math.round((tdm.tdCurrentProbability - tdm.tdOpenProbability) / tdm.tdOpenProbability * 1000) / 10 : null,
      unit: 'probability points', books: tdm.books });
  }
  if (env && env.impliedDelta != null && Math.abs(env.impliedDelta) >= 0.5) {
    drivers.push({ kind: 'environment', market: 'teamImplied', label: 'Team implied total',
      from: null, to: env.implied, delta: env.impliedDelta, unit: 'points vs season average' });
  }
  const up = drivers.filter(d => d.delta > 0), down = drivers.filter(d => d.delta < 0);
  const dir = delta && delta.points != null ? (delta.points > 0 ? 'up' : delta.points < 0 ? 'down' : 'flat') : 'flat';
  const side = dir === 'up' ? up : dir === 'down' ? down : [];
  const kinds = new Set(side.map(d => d.kind));
  const byMag = side.slice().sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));
  let summary = '';
  if (!drivers.length) {
    summary = delta && delta.significant
      ? 'No individual market has moved for him. The gap is the scoring environment the game lines price for his club, not a player-specific signal.'
      : 'The market and the consensus agree on him this week.';
  } else if (dir === 'flat') {
    summary = 'Markets have moved in both directions and the net effect on his projection is small.';
  } else if (side.length && side.every(d => d.kind === 'environment')) {
    // Nothing player-specific moved. Say so, then say what did.
    summary = 'No player market has moved for him. The gap is the game environment: the club\'s implied total is '
      + (dir === 'up' ? 'up' : 'down') + ' ' + Math.abs(side[0].delta) + ' points on its season average.';
  } else {
    const n = side.filter(d => d.kind !== 'environment').length;
    const opener = n >= 2 ? n + ' independent markets have moved ' + (dir === 'up' ? 'upward' : 'downward') + '.'
                          : 'One market has moved ' + (dir === 'up' ? 'upward' : 'downward') + '.';
    let strongest = '';
    if (kinds.has('volume') && kinds.has('td')) {
      const v = byMag.find(d => d.kind === 'volume'), t = byMag.find(d => d.kind === 'td');
      const vFirst = byMag.indexOf(v) < byMag.indexOf(t);
      strongest = vFirst
        ? ' The strongest signal is expected ' + (dir === 'up' ? 'increased' : 'reduced') + ' volume (' + v.label.toLowerCase() + ') rather than touchdown probability alone.'
        : ' The strongest signal is touchdown probability (' + t.label.toLowerCase() + ') rather than volume.';
    } else if (kinds.has('volume')) {
      strongest = ' The signal is volume: ' + byMag.filter(d => d.kind === 'volume').map(d => d.label.toLowerCase()).join(', ') + '.';
    } else if (kinds.has('td')) {
      strongest = ' The signal is touchdown probability, not volume.';
    } else if (kinds.has('environment')) {
      strongest = ' The move is the game environment: the club\'s implied total is ' + (dir === 'up' ? 'up' : 'down') + ' ' + Math.abs(side[0].delta) + ' points on its season average.';
    }
    const contra = (dir === 'up' ? down : up);
    const caveat = contra.length ? ' ' + contra.length + ' market' + (contra.length === 1 ? ' has' : 's have') + ' moved the other way (' + contra.map(d => d.label.toLowerCase()).join(', ') + ').' : '';
    summary = opener + strongest + caveat;
  }
  return { direction: dir, drivers, summary };
}

// Live usage into a role trend: the latest week's touches against the
// season-to-date average, expressed as a factor. Reported always; applied to
// the line only once ROLE_MIN_GAMES have been played.
function roleTrendFrom(u) {
  if (!u || !u.latest || !u.season || !(u.season.games > 0)) return { label: 'no data', pct: null, factor: 1, games: 0, applied: false };
  const g = u.season.games;
  const touches = (u.latest.usage.targets || 0) + (u.latest.usage.carries || 0) + (u.latest.usage.passAttempts || 0);
  const avg = ((u.season.targets || 0) + (u.season.carries || 0)) / g;
  if (!(avg > 0) || !(touches >= 0)) return { label: 'no data', pct: null, factor: 1, games: g, applied: false };
  const pct = (touches - avg) / avg;
  const applied = g >= ROLE_MIN_GAMES;
  const factor = applied ? Math.min(ROLE_CLAMP[1], Math.max(ROLE_CLAMP[0], 1 + ROLE_GAIN * pct)) : 1;
  return { label: pct > 0.15 ? 'up' : pct < -0.15 ? 'down' : 'flat', pct: Math.round(pct * 100), factor: _oddsRound(factor * 100) / 100,
           games: g, latestTouches: touches, avgTouches: _oddsRound(avg), applied };
}

// THE BOARD. `ctx` is everything read once for the request; `opts` is what
// the caller asked for. Returns stat lines AND points at the caller's rules,
// so the page can re-score at another setting without a round trip.
function buildBoards(ctx, opts) {
  const o = opts || {};
  const horizon = HORIZONS[o.horizon] ? o.horizon : 'week';
  const rules = ctx.rules || SCORING_BASE;
  const state = ctx.state;
  const weeks = horizonWeeks(horizon, state, o.through);
  const ratings = ctx.ratings;
  const curWeek = state && state.ok && state.week.type === 'REG' ? state.week.number : null;
  const wantPos = o.position ? String(o.position).toUpperCase() : null;
  const posMatch = p => !wantPos || wantPos === 'ALL' || p === wantPos ||
    (wantPos === 'FLEX' && (p === 'RB' || p === 'WR' || p === 'TE')) || (wantPos === 'DST' && p === 'DEF');
  const rows = [];
  for (const p of ctx.pool) {
    if (!posMatch(p.position)) continue;
    const team = teamKey(p.team);
    const k = _oddsNorm(p.name) + '|' + p.position;
    const a = ctx.avail[k] || null;
    const gamesOut = a ? Number(a.gamesOut) || 0 : 0;
    // Games he can play across the season: the availability list, or the
    // whole schedule. His per-game line is the season line over THIS.
    const playable = Math.max(1, AVAILABILITY_GAMES - gamesOut);
    // The FULL season line: the committed row is pro-rated for a listed
    // player (§48), so it is un-rated here and divided by the games he plays.
    const af = a ? _availF(gamesOut) : 1;
    const full = af > 0 && af < 1 ? Object.fromEntries(Object.entries(p.projectedStats || {}).map(([kk, v]) => [kk, Number.isFinite(v) ? v / af : v])) : (p.projectedStats || {});
    if (af <= 0) continue;                         // out for the year: nothing to rank
    const u = ctx.usage && ctx.usage.players ? ctx.usage.players[k] : null;
    const role = roleTrendFrom(u);
    // The weeks he is unavailable: the first `gamesOut` weeks WITH A GAME from
    // the current week onward, across the whole schedule. Anchored to now, not
    // to the horizon: a four-game absence that starts in Week 2 is over long
    // before the fantasy playoffs, and a playoffs board that zeroed him would
    // be answering the wrong question.
    const outWeeks = new Set();
    if (a && curWeek != null && gamesOut > 0) {
      for (let w = curWeek, left = gamesOut; w <= 18 && left > 0; w++) {
        const fx = ratings && ratings.fixtures[team] && ratings.fixtures[team][w];
        if (!fx) continue;                         // a bye does not burn a game of absence
        outWeeks.add(w); left--;
      }
    }
    const cStats = {}, vStats = {}, iStats = {};
    const weekRows = [];
    let games = 0; const byes = []; let confSum = 0, confN = 0; let propsWeeks = 0, postedWeeks = 0, fittedWeeks = 0;
    let oppAllowedSum = 0, oppN = 0;
    const seasonVegas = ctx.overlay && ctx.overlay[k] ? ctx.overlay[k] : null;   // the season blend, for the ROS line
    for (const w of weeks) {
      const env = weekEnvironment(ratings, team, w);
      if (env.bye) { byes.push(w); weekRows.push({ week: w, bye: true }); continue; }
      if (outWeeks.has(w)) { weekRows.push({ week: w, out: true, opponent: env.opponent, home: env.home }); continue; }
      games++;
      if (env.opponentDefRank) { oppAllowedSum += env.opponentDefRank; oppN++; }
      // CONSENSUS: flat per-game share of the season line. No market in it.
      const c = weeklyStats(full, p.position, playable, { factor: 1, allowedFactor: 1 });
      // VEGAS: a prop for this week if there is one, else the environment.
      let v = null, basis = env.basis, conf = 'LOW';
      const props = (w === curWeek && ctx.weekMarkets) ? ctx.weekMarkets[_oddsNorm(p.name)] : null;
      let vp = null;
      if (props && ctx.nameIndex.get(_oddsNorm(p.name)) !== null) {
        const mk = marketPropsFrom(props);
        vp = vegasProjection(mk.props, p.position, rules, { asOf: mk.asOf, injuryStatus: a ? a.status : null });
        if (vp.ok) {
          v = { ...weeklyStats(full, p.position, playable, env), ...vp.stats };   // priced stats replace the environment's
          basis = vp.status === 'full' ? 'props' : 'props-partial';
          conf = vp.confidence; propsWeeks++;
        }
      }
      if (!v) {
        v = weeklyStats(full, p.position, playable, env);
        if (basis === 'gamelines') { conf = 'MEDIUM'; postedWeeks++; }
        else if (basis === 'ratings') { conf = 'LOW'; fittedWeeks++; }
        else { conf = 'LOW'; }
        if (a && a.status && VEGAS_OUT_RE.test(String(a.status))) conf = 'LOW';
      }
      // IRON TUNA: the blend, plus the role nudge where usage has earned it.
      const wgt = IT_BLEND[conf] != null ? IT_BLEND[conf] : IT_BLEND.LOW;
      const i = {};
      for (const kk of new Set([...Object.keys(c), ...Object.keys(v)])) {
        const cv = c[kk] || 0, vv = v[kk] != null ? v[kk] : cv;
        i[kk] = (cv + wgt * (vv - cv)) * (role.applied && p.position !== 'K' && p.position !== 'DEF' ? role.factor : 1);
      }
      _addStats(cStats, c); _addStats(vStats, v); _addStats(iStats, i);
      confSum += _confScore[conf]; confN++;
      weekRows.push({ week: w, opponent: env.opponent, home: env.home, env: { factor: env.factor, implied: env.implied,
        expected: env.expected, posted: env.posted, impliedDelta: env.impliedDelta, opponentDefRank: env.opponentDefRank },
        basis, confidence: conf, kickoff: env.kickoff, status: env.status,
        consensusPts: _oddsRound(scoreAny(c, p.position, rules, 1)), vegasPts: _oddsRound(scoreAny(v, p.position, rules, 1)),
        ironTunaPts: _oddsRound(scoreAny(i, p.position, rules, 1)),
        vegasProjection: vp && vp.ok ? { status: vp.status, label: vp.label, confidence: vp.confidence, td: vp.td, priced: vp.priced, missing: vp.missingCore, books: vp.books, ageHours: vp.ageHours, reasons: vp.confidenceReasons } : (vp ? { status: vp.status, label: vp.label } : null) });
    }
    const vegasConf = confN ? _confFrom(confSum / confN) : 'LOW';
    // Iron Tuna's own confidence: the Vegas grade lifted one step when a
    // consensus line exists to blend against (it always does here), and never
    // above what the market side can support.
    const itConf = games === 0 ? 'LOW' : vegasConf === 'LOW' && (postedWeeks + propsWeeks) > 0 ? 'MEDIUM' : vegasConf;
    const cp = _oddsRound(scoreAny(cStats, p.position, rules, games));
    const vpz = _oddsRound(scoreAny(vStats, p.position, rules, games));
    const ip = _oddsRound(scoreAny(iStats, p.position, rules, games));
    rows.push({
      name: p.name, position: p.position === 'DEF' ? 'DST' : p.position, pos: p.position, team, key: k,
      games, byes, weeks: weekRows,
      injury: a ? { status: a.status, gamesOut, note: a.note || '' } : null,
      roleTrend: role,
      scheduleDifficulty: oppN ? { avgOpponentDefRank: _oddsRound(oppAllowedSum / oppN),
        label: (oppAllowedSum / oppN) <= 11 ? 'Hard' : (oppAllowedSum / oppN) >= 22 ? 'Easy' : 'Average' } : null,
      consensus: { stats: _roundStats(cStats), points: cp },
      vegas: { stats: _roundStats(vStats), points: vpz, confidence: vegasConf,
               basis: propsWeeks ? (propsWeeks === games ? 'props' : 'props+gamelines') : postedWeeks ? (fittedWeeks ? 'gamelines+ratings' : 'gamelines') : fittedWeeks ? 'ratings' : 'none',
               propsWeeks, postedWeeks, fittedWeeks,
               td: weekRows.find(x => x.vegasProjection && x.vegasProjection.td) ? weekRows.find(x => x.vegasProjection && x.vegasProjection.td).vegasProjection.td : null },
      ironTuna: { stats: _roundStats(iStats), points: ip, confidence: itConf },
      seasonOverlay: seasonVegas ? true : false
    });
  }
  // Ranks within position on each board, FLEX pooled across RB/WR/TE.
  const rankIn = (list, field) => {
    const sorted = list.slice().sort((x, y) => y[field].points - x[field].points || (x.name < y.name ? -1 : 1));
    sorted.forEach((r, i) => { r[field].rank = i + 1; });
  };
  const groups = {};
  for (const r of rows) (groups[r.position] = groups[r.position] || []).push(r);
  for (const g of Object.values(groups)) { rankIn(g, 'consensus'); rankIn(g, 'vegas'); rankIn(g, 'ironTuna'); }
  const flex = rows.filter(r => r.position === 'RB' || r.position === 'WR' || r.position === 'TE');
  for (const field of ['consensus', 'vegas', 'ironTuna']) {
    flex.slice().sort((x, y) => y[field].points - x[field].points || (x.name < y.name ? -1 : 1)).forEach((r, i) => { r[field].flexRank = i + 1; });
  }
  for (const r of rows) {
    r.marketDelta = marketDelta(r.consensus.points, r.consensus.rank, r.vegas.points, r.vegas.rank);
    // The why, for the current week only: it is built from THIS week's line
    // movement and THIS week's environment, and a three-week sum has no
    // single opening line to have moved from.
    if (horizon === 'week' && curWeek != null) {
      const props = ctx.weekMarkets ? ctx.weekMarkets[_oddsNorm(r.name)] : null;
      const mv = props ? marketPropsFrom(props).movement : {};
      const wk = r.weeks.find(x => x.env);
      r.why = explainDelta(r, mv, wk ? wk.env : null, r.marketDelta);
    }
  }
  return {
    ok: rows.length > 0, contract: BOARDS_CONTRACT,
    horizon: { ...HORIZONS[horizon], weeks, through: horizon === 'ros' ? (Number(o.through) || ROS_LAST_WEEK_DEFAULT) : null },
    season: ctx.sched ? ctx.sched.season : null,
    currentWeek: curWeek, phase: state && state.ok ? state.phase : null,
    scoring: { preset: o.preset || 'ppr', label: SCORING_PRESET_LABEL[o.preset || 'ppr'] || 'PPR' },
    delta: MARKET_DELTA, blend: IT_BLEND,
    sources: { schedule: ctx.sched ? ctx.sched.provider : null, ratings: ratings && ratings.ok ? 'fitted' : 'none',
               props: ctx.weekMarkets ? Object.keys(ctx.weekMarkets).length : 0, usage: ctx.usage ? ctx.usage.throughWeek : null },
    players: rows
  };
}
// Everything a board needs, read once.
async function boardsContext(env, opts) {
  const o = opts || {};
  const sched = await scheduleCacheRead(env);
  if (!sched) return null;
  const state = nflSeasonState(sched, Date.now());
  const curWeek = state.ok && state.week.type === 'REG' ? state.week.number : null;
  const [avail, usage, overlay, weekMarkets] = await Promise.all([
    availabilityTable(env), usageCacheRead(env), oddsCacheRead(env),
    curWeek != null ? marketHistoryWeek(env, sched.season, curWeek) : {}
  ]);
  return { sched, state, ratings: teamRatingsFrom(sched), avail, usage,
           overlay: overlay ? overlay.overlay : null, weekMarkets, nameIndex: _oddsProjectionIndex(),
           pool: _availPool(PROJECTIONS), rules: scoringRules(o.preset, o.custom) };
}
let _BOARDS_MEMO = new Map();
async function boardsPayload(env, opts) {
  const o = opts || {};
  const key = [o.horizon, o.position, o.preset, o.through].join('|');
  const hit = _BOARDS_MEMO.get(key);
  if (hit && Date.now() - hit.at < 300000) return hit.out;
  const ctx = await boardsContext(env, o);
  const out = ctx ? buildBoards(ctx, o) : { ok: false, error: 'no_schedule', contract: BOARDS_CONTRACT };
  if (_BOARDS_MEMO.size > 40) _BOARDS_MEMO = new Map();
  _BOARDS_MEMO.set(key, { at: Date.now(), out });
  return out;
}

// -- the insight detection engine ------------------------------------------
// DETERMINISTIC RULES FIRST. Every insight here is found by arithmetic over
// the boards, the line history and the usage overlay, carries the numbers it
// was found from, and is stamped with when. An explainer (a template below,
// or a model later) may put words to an insight that exists; nothing may
// conjure one. A rule whose data no source can supply (goal-line role) is
// listed and returns nothing, with the reason, rather than being quietly
// absent -- so the list of rules is the list of rules.
const INSIGHT_RULES = {
  vegas_above_consensus: { label: 'Vegas above consensus', needs: 'boards' },
  vegas_below_consensus: { label: 'Vegas below consensus', needs: 'boards' },
  line_movement: { label: 'Meaningful line movement', needs: 'snapshots' },
  production_below_opportunity: { label: 'Production below opportunity', needs: 'usage' },
  production_above_opportunity: { label: 'Production above opportunity', needs: 'usage' },
  role_increase: { label: 'Role increase', needs: 'usage' },
  role_decrease: { label: 'Role decrease', needs: 'usage' },
  target_consolidation: { label: 'Target consolidation', needs: 'usage' },
  backfield_consolidation: { label: 'Backfield consolidation', needs: 'usage' },
  goal_line_role_change: { label: 'Goal-line role change', needs: 'play-by-play', unavailable: PROVIDER_UNAVAILABLE.goalLineCarries },
  td_regression: { label: 'Touchdown regression', needs: 'usage' },
  game_script_change: { label: 'Game-script change', needs: 'snapshots' }
};
// Thresholds, all in one place.
const INSIGHT_T = {
  lineMovePct: 8, lineMoveBooks: 1,          // a prop that moved >= 8% at >= 1 book
  tdMovePoints: 4,                            // anytime-TD probability moved >= 4 points
  spreadMove: 2.5, totalMove: 2.5,            // a game line that moved >= 2.5 points
  roleMinGames: ROLE_MIN_GAMES, rolePct: 25,  // touches vs season average
  oppRatio: 0.7, oppRatioHigh: 1.4,           // points vs opportunity-implied points
  shareLead: 0.32, shareRise: 0.08,           // a team's leading share, and how much it rose
  tdRegressionRatio: 1.6, tdRegressionLow: 0.5, tdMinGames: 4
};
const _insight = (type, subject, data, magnitude, confidence, ts) =>
  ({ id: type + ':' + (subject.key || subject.team || subject.name), type, label: INSIGHT_RULES[type].label,
     subject, data, magnitude: _oddsRound(magnitude), confidence, ts: ts || Date.now() });

function detectInsights(input) {
  const { week, usage, weekMarkets, gameMarkets, state, rules } = input;
  const ts = Date.now();
  const out = [];
  const unavailable = [];
  for (const [k, r] of Object.entries(INSIGHT_RULES)) if (r.unavailable) unavailable.push({ rule: k, reason: r.unavailable });
  const subj = p => ({ key: p.key, name: p.name, position: p.position, team: p.team });

  // 1. Vegas vs consensus, off the week board's Market Delta.
  for (const p of (week && week.players) || []) {
    const d = p.marketDelta;
    if (!d || !d.significant) continue;
    const type = d.points > 0 ? 'vegas_above_consensus' : 'vegas_below_consensus';
    out.push(_insight(type, subj(p), {
      consensusPoints: p.consensus.points, vegasPoints: p.vegas.points, ironTunaPoints: p.ironTuna.points,
      consensusRank: p.consensus.rank, vegasRank: p.vegas.rank, ironTunaRank: p.ironTuna.rank,
      pointsDelta: d.points, rankDelta: d.rank, classification: d.classification,
      basis: p.vegas.basis, drivers: p.why ? p.why.drivers : [], summary: p.why ? p.why.summary : ''
    }, Math.abs(d.rank != null ? d.rank : (d.pct || 0)), p.vegas.confidence, ts));
  }

  // 2. Line movement, per player market, off the snapshot store.
  const byKey = new Map(((week && week.players) || []).map(p => [_oddsNorm(p.name), p]));
  for (const [nk, hist] of Object.entries(weekMarkets || {})) {
    const p = byKey.get(nk);
    if (!p) continue;
    for (const [m, h] of Object.entries(hist || {})) {
      if (!h) continue;
      if (m === 'anytimeTD') {
        if (h.tdOpenProbability == null || h.tdCurrentProbability == null) continue;
        const mv = h.tdCurrentProbability - h.tdOpenProbability;
        if (Math.abs(mv) < INSIGHT_T.tdMovePoints) continue;
        out.push(_insight('line_movement', subj(p), { market: m, label: 'Anytime TD',
          openProbability: h.tdOpenProbability, currentProbability: h.tdCurrentProbability,
          openOdds: _americanFromProb(h.tdOpenProbability / 100), currentOdds: _americanFromProb(h.tdCurrentProbability / 100),
          books: h.books, booksMoved: h.booksMoved, direction: mv > 0 ? 'up' : 'down' }, Math.abs(mv), h.books >= 3 ? 'HIGH' : h.books === 2 ? 'MEDIUM' : 'LOW', h.lastSeen || ts));
        continue;
      }
      if (h.percentChange == null || Math.abs(h.percentChange) < INSIGHT_T.lineMovePct || h.booksMoved < INSIGHT_T.lineMoveBooks) continue;
      out.push(_insight('line_movement', subj(p), { market: m, label: WHY_MARKET_LABEL[m] || m,
        open: h.open, current: h.current, movement: h.movement, percentChange: h.percentChange,
        books: h.books, booksMoved: h.booksMoved, agreement: h.agreement, direction: h.movement > 0 ? 'up' : 'down' },
        Math.abs(h.percentChange), h.books >= 3 && h.agreement >= 0.75 ? 'HIGH' : h.books >= 2 ? 'MEDIUM' : 'LOW', h.lastSeen || ts));
    }
  }

  // 3. Usage rules. All of these need games to have been played; before Week 1
  // the overlay is empty and every rule here returns nothing, correctly.
  const U = usage && usage.players ? usage.players : null;
  if (U) {
    const r = rules || SCORING_BASE;
    // Points per touch across the league, so 'opportunity' has a price.
    let touchSum = 0, ptsSum = 0;
    for (const u of Object.values(U)) {
      if (!u.latest || u.position === 'QB') continue;
      const t = (u.latest.usage.targets || 0) + (u.latest.usage.carries || 0);
      touchSum += t; ptsSum += scoreStats(u.latest.stats, u.position, r);
    }
    const perTouch = touchSum > 0 ? ptsSum / touchSum : null;
    // Team shares in the latest week, for consolidation.
    const teamWeek = {};
    for (const [k, u] of Object.entries(U)) {
      if (!u.latest) continue;
      const t = teamWeek[u.team] || (teamWeek[u.team] = { week: 0, targets: 0, carries: 0, players: [] });
      if (u.latest.week > t.week) { t.week = u.latest.week; t.targets = 0; t.carries = 0; t.players = []; }
      if (u.latest.week !== t.week) continue;
      t.targets += u.latest.usage.targets || 0; t.carries += u.latest.usage.carries || 0;
      t.players.push({ key: k, u });
    }
    for (const [k, u] of Object.entries(U)) {
      if (!u.latest || !u.season) continue;
      const p = byKey.get(k.split('|')[0]);
      const s = p ? subj(p) : { key: k, name: u.name, position: u.position, team: u.team };
      const role = roleTrendFrom(u);
      // Role
      if (role.games >= INSIGHT_T.roleMinGames && role.pct != null && Math.abs(role.pct) >= INSIGHT_T.rolePct) {
        out.push(_insight(role.pct > 0 ? 'role_increase' : 'role_decrease', s,
          { latestWeek: u.latest.week, latestTouches: role.latestTouches, seasonAvgTouches: role.avgTouches, pct: role.pct, games: role.games,
            targets: u.latest.usage.targets, carries: u.latest.usage.carries, snapPct: u.latest.usage.snapPct },
          Math.abs(role.pct), role.games >= 6 ? 'HIGH' : 'MEDIUM', ts));
      }
      // Production against opportunity, latest week
      if (perTouch && u.position !== 'QB') {
        const touches = (u.latest.usage.targets || 0) + (u.latest.usage.carries || 0);
        if (touches >= 8) {
          const expected = touches * perTouch;
          const actual = scoreStats(u.latest.stats, u.position, r);
          const ratio = expected > 0 ? actual / expected : null;
          if (ratio != null && ratio <= INSIGHT_T.oppRatio) {
            out.push(_insight('production_below_opportunity', s, { week: u.latest.week, touches, expectedPoints: _oddsRound(expected), actualPoints: _oddsRound(actual), ratio: _oddsRound(ratio * 100) / 100, leaguePointsPerTouch: _oddsRound(perTouch * 100) / 100 }, (1 - ratio) * 100, 'MEDIUM', ts));
          } else if (ratio != null && ratio >= INSIGHT_T.oppRatioHigh) {
            out.push(_insight('production_above_opportunity', s, { week: u.latest.week, touches, expectedPoints: _oddsRound(expected), actualPoints: _oddsRound(actual), ratio: _oddsRound(ratio * 100) / 100, leaguePointsPerTouch: _oddsRound(perTouch * 100) / 100 }, (ratio - 1) * 100, 'MEDIUM', ts));
          }
        }
      }
      // Touchdown regression: season TDs per game against the projection's rate
      if (p && u.season.games >= INSIGHT_T.tdMinGames && p.pos !== 'QB') {
        const projPerGame = ((p.consensus.stats.rushTD || 0) + (p.consensus.stats.recTD || 0)) / Math.max(1, p.games);
        const actualTds = (u.season.tds != null) ? u.season.tds : null;
        if (actualTds != null && projPerGame > 0) {
          const actualPerGame = actualTds / u.season.games;
          const ratio = actualPerGame / projPerGame;
          if (ratio >= INSIGHT_T.tdRegressionRatio || ratio <= INSIGHT_T.tdRegressionLow) {
            out.push(_insight('td_regression', s, { games: u.season.games, actualTdsPerGame: _oddsRound(actualPerGame * 100) / 100, projectedTdsPerGame: _oddsRound(projPerGame * 100) / 100, ratio: _oddsRound(ratio * 100) / 100, direction: ratio > 1 ? 'negative' : 'positive' }, Math.abs(ratio - 1) * 100, u.season.games >= 8 ? 'HIGH' : 'MEDIUM', ts));
          }
        }
      }
    }
    // Consolidation: a club's leading share, and whether it rose.
    for (const [team, t] of Object.entries(teamWeek)) {
      for (const [kind, total, field] of [['target_consolidation', t.targets, 'targets'], ['backfield_consolidation', t.carries, 'carries']]) {
        if (!(total > 0)) continue;
        const lead = t.players.map(({ key, u }) => ({ key, u, share: (u.latest.usage[field] || 0) / total,
          seasonShare: u.season.games > 0 && (field === 'targets' ? u.season.targets : u.season.carries) > 0
            ? ((field === 'targets' ? u.season.targets : u.season.carries) / u.season.games) / (total) : null }))
          .filter(x => kind === 'target_consolidation' ? x.u.position !== 'QB' : x.u.position === 'RB')
          .sort((a, b) => b.share - a.share)[0];
        if (!lead || lead.share < INSIGHT_T.shareLead || lead.seasonShare == null || lead.share - lead.seasonShare < INSIGHT_T.shareRise) continue;
        const p = byKey.get(lead.key.split('|')[0]);
        out.push(_insight(kind, p ? subj(p) : { key: lead.key, name: lead.u.name, position: lead.u.position, team },
          { week: t.week, team, share: _oddsRound(lead.share * 100), seasonShare: _oddsRound(lead.seasonShare * 100), teamTotal: total, latest: lead.u.latest.usage[field] },
          (lead.share - lead.seasonShare) * 100, lead.u.season.games >= 4 ? 'MEDIUM' : 'LOW', ts));
      }
    }
  }

  // 4. Game-script change, off the GAME lines in the snapshot store: a spread
  // that moved toward the favourite by INSIGHT_T.spreadMove or a total that
  // moved, with any player prop on the same game that agrees.
  const games = (state && state.ok && state.games) || [];
  for (const g of games) {
    const gm = gameMarkets && gameMarkets[g.id];
    if (!gm) continue;
    const sp = gm.spread, tot = gm.total;
    const spMove = sp && sp.open != null && sp.current != null ? sp.current - sp.open : 0;
    const totMove = tot && tot.open != null && tot.current != null ? tot.current - tot.open : 0;
    if (Math.abs(spMove) < INSIGHT_T.spreadMove && Math.abs(totMove) < INSIGHT_T.totalMove) continue;
    // spread is the HOME margin: rising means the home side is more favoured.
    const favouredMore = spMove > 0 ? g.home : spMove < 0 ? g.away : null;
    const corroborating = [];
    for (const p of (week && week.players) || []) {
      if (p.team !== g.home && p.team !== g.away) continue;
      const h = weekMarkets && weekMarkets[_oddsNorm(p.name)];
      if (!h) continue;
      for (const m of ['rushYd', 'rushAtt', 'passYd', 'rec']) {
        const x = h[m]; if (!x || x.movement == null || x.movement === 0) continue;
        corroborating.push({ name: p.name, position: p.position, team: p.team, market: m, movement: x.movement, percentChange: x.percentChange });
      }
    }
    const runLean = favouredMore && corroborating.some(c => c.team === favouredMore && (c.market === 'rushYd' || c.market === 'rushAtt') && c.movement > 0);
    const passDrop = favouredMore && corroborating.some(c => c.team === favouredMore && c.market === 'passYd' && c.movement < 0);
    const story = favouredMore && (runLean || passDrop)
      ? 'The betting market is increasingly pricing a run-favourable game script for ' + favouredMore + '.'
      : totMove >= INSIGHT_T.totalMove ? 'The market expects more scoring in this game than it did when the line opened.'
      : totMove <= -INSIGHT_T.totalMove ? 'The market expects less scoring in this game than it did when the line opened.'
      : 'The spread has moved without a matching move in the player markets.';
    out.push(_insight('game_script_change', { key: g.id, team: favouredMore || g.home, game: g.away + ' at ' + g.home, home: g.home, away: g.away },
      { spreadOpen: sp ? sp.open : null, spreadCurrent: sp ? sp.current : null, spreadMove: _oddsRound(spMove),
        totalOpen: tot ? tot.open : null, totalCurrent: tot ? tot.current : null, totalMove: _oddsRound(totMove),
        favouredMore, corroborating, interpretation: story },
      Math.max(Math.abs(spMove), Math.abs(totMove)), corroborating.length >= 2 ? 'HIGH' : corroborating.length ? 'MEDIUM' : 'LOW', ts));
  }

  out.sort((a, b) => (_confScore[b.confidence] - _confScore[a.confidence]) || b.magnitude - a.magnitude);
  return { ok: true, count: out.length, insights: out, rules: Object.keys(INSIGHT_RULES), unavailable, thresholds: INSIGHT_T, ts };
}

// -- Vegas Edge ---------------------------------------------------------------
// The primary product: what the money says this week, in six boards, each one
// a plain sort over data the engine already holds. `basis` on every board says
// whether a number is a quoted market or derived from the game lines, because
// on a week with no player props (today) every player board is the latter.
const EDGE_CONTRACT = 1;
function buildVegasEdge(week, weekMarkets, gameMarkets, state, insights) {
  const players = (week && week.players) || [];
  const hasProps = players.some(p => /^props/.test(p.vegas.basis));
  // Skill positions only. A defence's rank swings twenty slots on a game total
  // because its whole line IS the environment; that is not a disagreement
  // about a player, and it would crowd every real one off the board.
  const sig = players.filter(p => p.marketDelta && p.marketDelta.significant && p.pos !== 'K' && p.pos !== 'DEF');
  const brief = p => ({ name: p.name, position: p.position, team: p.team, key: p.key,
    consensusRank: p.consensus.rank, vegasRank: p.vegas.rank, ironTunaRank: p.ironTuna.rank,
    consensusPoints: p.consensus.points, vegasPoints: p.vegas.points, ironTunaPoints: p.ironTuna.points,
    delta: p.marketDelta, confidence: p.vegas.confidence, basis: p.vegas.basis, why: p.why ? p.why.summary : '' });
  const vsExperts = {
    buys: sig.filter(p => p.marketDelta.points > 0).sort((a, b) => (b.marketDelta.rank || 0) - (a.marketDelta.rank || 0) || b.marketDelta.points - a.marketDelta.points).slice(0, 12).map(brief),
    fades: sig.filter(p => p.marketDelta.points < 0).sort((a, b) => (a.marketDelta.rank || 0) - (b.marketDelta.rank || 0) || a.marketDelta.points - b.marketDelta.points).slice(0, 12).map(brief)
  };
  // Movers: every player market with a real move, biggest first.
  const movers = [];
  const byKey = new Map(players.map(p => [_oddsNorm(p.name), p]));
  for (const [nk, hist] of Object.entries(weekMarkets || {})) {
    const p = byKey.get(nk); if (!p) continue;
    for (const [m, h] of Object.entries(hist || {})) {
      if (!h) continue;
      if (m === 'anytimeTD') {
        if (h.tdOpenProbability == null || h.tdCurrentProbability == null || h.tdOpenProbability === h.tdCurrentProbability) continue;
        movers.push({ name: p.name, position: p.position, team: p.team, market: m, label: 'Anytime TD', openOdds: _americanFromProb(h.tdOpenProbability / 100), currentOdds: _americanFromProb(h.tdCurrentProbability / 100),
          openProbability: h.tdOpenProbability, currentProbability: h.tdCurrentProbability, movement: _oddsRound(h.tdCurrentProbability - h.tdOpenProbability), percentChange: h.tdOpenProbability ? Math.round((h.tdCurrentProbability - h.tdOpenProbability) / h.tdOpenProbability * 1000) / 10 : null, books: h.books, booksMoved: h.booksMoved });
        continue;
      }
      if (!h.movement) continue;
      movers.push({ name: p.name, position: p.position, team: p.team, market: m, label: WHY_MARKET_LABEL[m] || m, open: h.open, current: h.current, movement: h.movement, percentChange: h.percentChange, books: h.books, booksMoved: h.booksMoved, agreement: h.agreement });
    }
  }
  movers.sort((a, b) => Math.abs(b.percentChange || 0) - Math.abs(a.percentChange || 0));
  // TD board: a quoted anytime-TD probability where a book posted one, else
  // derived from the blended weekly TD line (Poisson), and labelled.
  const tdBoard = players.filter(p => p.pos !== 'K' && p.pos !== 'DEF' && p.games > 0).map(p => {
    const q = p.vegas.td;
    const lam = (p.ironTuna.stats.rushTD || 0) + (p.ironTuna.stats.recTD || 0) + (p.pos === 'QB' ? 0 : 0);
    const derived = Math.round((1 - Math.exp(-lam)) * 1000) / 10;
    return { name: p.name, position: p.position, team: p.team, probability: q ? q.probability : derived, basis: q ? 'anytime-td-market' : 'derived',
             books: q ? q.books : null, expectedTds: _oddsRound(lam * 100) / 100, opponent: p.weeks[0] && p.weeks[0].opponent };
  }).sort((a, b) => b.probability - a.probability).slice(0, 40);
  // Volume board: market-implied touches. Props where present, else the
  // environment-scaled line, labelled.
  const volumeBoard = players.filter(p => p.pos !== 'K' && p.pos !== 'DEF' && p.pos !== 'QB' && p.games > 0).map(p => {
    const s = p.vegas.stats;
    const touches = (s.rec || 0) + (s.rushAtt != null ? s.rushAtt : (s.rushYd || 0) / 4.3);
    return { name: p.name, position: p.position, team: p.team, receptions: _oddsRound(s.rec || 0), rushAttempts: s.rushAtt != null ? _oddsRound(s.rushAtt) : null,
             rushYards: _oddsRound(s.rushYd || 0), recYards: _oddsRound(s.recYd || 0), impliedTouches: _oddsRound(touches), basis: /^props/.test(p.vegas.basis) ? 'props' : 'derived from game lines' };
  }).sort((a, b) => b.impliedTouches - a.impliedTouches).slice(0, 40);
  // Game environments, with movement off the game snapshots.
  const gameEnvironments = ((state && state.ok && state.games) || []).map(g => {
    const gm = gameMarkets && gameMarkets[g.id];
    const mv = gm ? { spread: gm.spread ? _oddsRound((gm.spread.current || 0) - (gm.spread.open || 0)) : null, total: gm.total ? _oddsRound((gm.total.current || 0) - (gm.total.open || 0)) : null } : null;
    return { id: g.id, game: g.away + ' at ' + g.home, home: g.home, away: g.away, kickoff: g.kickoff, status: g.status,
             total: g.total, spread: g.spread, impliedHome: g.impliedHome, impliedAway: g.impliedAway,
             favourite: g.spread > 0 ? g.home : g.spread < 0 ? g.away : null, movement: mv };
  }).filter(g => g.total != null).sort((a, b) => b.total - a.total);
  const hidden = (insights && insights.insights || []).filter(i => i.type === 'game_script_change');
  return { ok: true, contract: EDGE_CONTRACT, week: state && state.ok ? state.week.label : null, hasProps,
           note: hasProps ? null : 'No sportsbook has a player prop on this board yet. Every player number here is derived from the posted game lines; the game board is quoted.',
           vsExperts, movers: movers.slice(0, 40), tdBoard, volumeBoard, gameEnvironments, hiddenSignals: hidden };
}

// -- the Wednesday rest-of-season update ---------------------------------------
// Once a week the ROS board is frozen into its own table so next week's can be
// compared to it: that is where risers and fallers come from, and it is the
// only way 'previous ROS rank' can be a fact rather than a memory. Runs inside
// the daily 11:00Z job when it is Wednesday in New York (7am EDT, 6am EST), and
// on demand from /api/admin/market-status?ros=1.
const ROS_DDL = 'CREATE TABLE IF NOT EXISTS ros_rankings (id INTEGER PRIMARY KEY AUTOINCREMENT, season INTEGER, week INTEGER, built_at INTEGER NOT NULL, horizon TEXT NOT NULL, payload TEXT NOT NULL)';
const ROS_TOP_PER_POS = 80;
let _ROS_READY = false;
async function rosReady(env) {
  if (_ROS_READY) return true;
  if (!env || !env.LEADS_DB) return false;
  try { await env.LEADS_DB.prepare(ROS_DDL).run(); _ROS_READY = true; return true; } catch (e) { return false; }
}
function _rosSlim(board) {
  const byPos = {};
  for (const p of board.players) (byPos[p.position] = byPos[p.position] || []).push(p);
  const rows = [];
  for (const list of Object.values(byPos)) {
    list.sort((a, b) => a.ironTuna.rank - b.ironTuna.rank).slice(0, ROS_TOP_PER_POS).forEach(p => rows.push({
      key: p.key, name: p.name, position: p.position, team: p.team,
      rank: p.ironTuna.rank, points: p.ironTuna.points, ppg: p.games ? _oddsRound(p.ironTuna.points / p.games) : null,
      consensusRank: p.consensus.rank, vegasRank: p.vegas.rank, confidence: p.ironTuna.confidence, vegasBasis: p.vegas.basis,
      games: p.games, byes: p.byes, injury: p.injury, roleTrend: p.roleTrend ? { label: p.roleTrend.label, pct: p.roleTrend.pct } : null,
      scheduleDifficulty: p.scheduleDifficulty, delta: p.marketDelta ? { points: p.marketDelta.points, rank: p.marketDelta.rank, classification: p.marketDelta.classification } : null
    }));
  }
  return rows;
}
async function runRosSnapshot(env, opts) {
  if (!(await rosReady(env))) return { ok: false, error: 'no_db' };
  const o = opts || {};
  const sched = await scheduleCacheRead(env);
  if (!sched) return { ok: false, error: 'no_schedule' };
  const state = nflSeasonState(sched, Date.now());
  const week = state.ok && state.week.type === 'REG' ? state.week.number : null;
  if (week == null) return { ok: false, error: 'not_regular_season' };
  const out = {};
  for (const hz of ['ros', 'next3', 'playoffs']) {
    const board = await boardsPayload(env, { horizon: hz, position: 'ALL', preset: 'ppr', through: o.through || null });
    if (!board.ok) continue;
    const rows = _rosSlim(board);
    await env.LEADS_DB.prepare('INSERT INTO ros_rankings (season, week, built_at, horizon, payload) VALUES (?, ?, ?, ?, ?)')
      .bind(sched.season, week, Date.now(), hz, JSON.stringify({ weeks: board.horizon.weeks, rows })).run();
    out[hz] = rows.length;
  }
  return { ok: true, season: sched.season, week, stored: out };
}
async function rosSnapshots(env, horizon, limit) {
  if (!(await rosReady(env))) return [];
  try {
    const q = await env.LEADS_DB.prepare('SELECT season, week, built_at, payload FROM ros_rankings WHERE horizon = ? ORDER BY built_at DESC LIMIT ?')
      .bind(horizon, limit || 2).all();
    return (q.results || []).map(r => ({ season: r.season, week: r.week, builtAt: r.built_at, ...JSON.parse(r.payload) }));
  } catch (e) { return []; }
}
// Why a rank moved, from the two rows themselves. Every reason is a field
// that differs between then and now; nothing else is a reason.
function rosMoveReasons(prev, cur) {
  const r = [];
  if ((prev.injury && prev.injury.status) !== (cur.injury && cur.injury.status)) {
    r.push(cur.injury ? 'now listed ' + cur.injury.status + (cur.injury.gamesOut ? ' (' + cur.injury.gamesOut + ' games)' : '') : 'off the injury list');
  } else if (prev.injury && cur.injury && prev.injury.gamesOut !== cur.injury.gamesOut) {
    r.push('expected absence ' + prev.injury.gamesOut + ' to ' + cur.injury.gamesOut + ' games');
  }
  if (prev.roleTrend && cur.roleTrend && prev.roleTrend.label !== cur.roleTrend.label && cur.roleTrend.label !== 'no data') r.push('role trend ' + cur.roleTrend.label + (cur.roleTrend.pct != null ? ' (' + (cur.roleTrend.pct > 0 ? '+' : '') + cur.roleTrend.pct + '% touches)' : ''));
  if (prev.games !== cur.games) r.push('games remaining ' + prev.games + ' to ' + cur.games);
  if (prev.delta && cur.delta && prev.delta.classification !== cur.delta.classification) r.push('market delta now ' + cur.delta.classification.toLowerCase());
  if (prev.scheduleDifficulty && cur.scheduleDifficulty && prev.scheduleDifficulty.label !== cur.scheduleDifficulty.label) r.push('schedule now ' + cur.scheduleDifficulty.label.toLowerCase());
  if (prev.ppg != null && cur.ppg != null && Math.abs(cur.ppg - prev.ppg) >= 0.5) r.push('projected ' + (cur.ppg > prev.ppg ? '+' : '') + _oddsRound(cur.ppg - prev.ppg) + ' points per game');
  if (!r.length) r.push('other players moved around him');
  return r;
}
async function rosUpdatePayload(env, opts) {
  const o = opts || {};
  const snaps = await rosSnapshots(env, 'ros', 2);
  const cur = snaps[0] || null, prev = snaps[1] || null;
  const live = await boardsPayload(env, { horizon: 'ros', position: 'ALL', preset: o.preset || 'ppr', through: o.through || null });
  const movers = { risers: [], fallers: [] };
  if (cur && prev) {
    const pm = new Map(prev.rows.map(r => [r.key, r]));
    for (const c of cur.rows) {
      const p = pm.get(c.key); if (!p || p.rank === c.rank) continue;
      const row = { name: c.name, position: c.position, team: c.team, previousRank: p.rank, currentRank: c.rank, move: p.rank - c.rank, reasons: rosMoveReasons(p, c) };
      (c.rank < p.rank ? movers.risers : movers.fallers).push(row);
    }
    movers.risers.sort((a, b) => b.move - a.move); movers.fallers.sort((a, b) => a.move - b.move);
    movers.risers = movers.risers.slice(0, 15); movers.fallers = movers.fallers.slice(0, 15);
  }
  // Market vs ROS: only where a market genuinely exists for the week -- a
  // priced prop or a posted line -- does the week's Market Delta get to say
  // whether it supports the longer-term rank. Fitted weeks are not a market.
  const week = await boardsPayload(env, { horizon: 'week', position: 'ALL', preset: o.preset || 'ppr' });
  const marketVsRos = [];
  if (live.ok && week.ok) {
    const wk = new Map(week.players.map(p => [p.key, p]));
    for (const p of live.players) {
      const w = wk.get(p.key); if (!w || !w.marketDelta || !w.marketDelta.significant) continue;
      if (!(/^props/.test(w.vegas.basis) || w.vegas.basis === 'gamelines')) continue;
      const supports = (w.marketDelta.points > 0 && p.ironTuna.rank <= p.consensus.rank) || (w.marketDelta.points < 0 && p.ironTuna.rank >= p.consensus.rank);
      marketVsRos.push({ name: p.name, position: p.position, team: p.team, rosRank: p.ironTuna.rank, rosConsensusRank: p.consensus.rank,
        weekDelta: w.marketDelta, weekBasis: w.vegas.basis, weekConfidence: w.vegas.confidence, verdict: supports ? 'supports' : 'contradicts' });
    }
    marketVsRos.sort((a, b) => Math.abs(b.weekDelta.rank || 0) - Math.abs(a.weekDelta.rank || 0));
  }
  return { ok: live.ok, contract: 1, season: live.season, currentWeek: live.currentWeek,
           featured: { builtAt: cur ? cur.builtAt : null, week: cur ? cur.week : null, previousWeek: prev ? prev.week : null },
           choices: [
             { horizon: 'next3', title: 'Next 3 Weeks', blurb: 'For managers making immediate lineup, trade and roster decisions.' },
             { horizon: 'ros', title: 'Rest of Season', blurb: 'Overall player value for the remainder of the fantasy season.' },
             { horizon: 'playoffs', title: 'Fantasy Playoffs: Weeks 15-17', blurb: 'Players ranked specifically for the fantasy playoffs.' } ],
           risers: movers.risers, fallers: movers.fallers, marketVsRos: marketVsRos.slice(0, 20),
           snapshotNote: cur && prev ? null : cur ? 'One weekly snapshot exists; risers and fallers appear once a second Wednesday has run.' : 'No Wednesday snapshot has run yet.' };
}

// -- the player intel payload --------------------------------------------------
// One player, every horizon, the props behind him, and a take assembled only
// from fields that exist. The take is a template, not a model: it can point at
// numbers, it cannot invent a reason.
function buildTake(rows, props, usage) {
  const s = [];
  const w = rows.week, r = rows.ros, pf = rows.playoffs;
  const pos = (w || r || pf || {}).position || '';
  if (w) {
    s.push(`This week Iron Tuna has him ${pos}${w.ironTuna.rank}; the consensus says ${pos}${w.consensus.rank} and the market ${pos}${w.vegas.rank} (${w.vegas.basis}, ${w.vegas.confidence.toLowerCase()} confidence).`);
    if (w.marketDelta && w.marketDelta.significant) {
      s.push(`Market Delta ${w.marketDelta.points > 0 ? '+' : ''}${w.marketDelta.points} points, ${w.marketDelta.rank > 0 ? '+' : ''}${w.marketDelta.rank} slots: ${w.marketDelta.classification.toLowerCase()}.`);
      if (w.why && w.why.summary) s.push(w.why.summary);
    } else {
      s.push('The market and the consensus agree on him this week.');
    }
    if (w.injury && w.injury.status) s.push(`He is listed ${w.injury.status}${w.injury.gamesOut ? ', expected to miss ' + w.injury.gamesOut + ' game' + (w.injury.gamesOut === 1 ? '' : 's') : ''}.`);
  }
  if (usage && usage.latest && usage.season && usage.season.games >= 1) {
    const u = usage.latest.usage;
    const bits = [];
    if (u.targets != null) bits.push(`${u.targets} targets`);
    if (u.carries) bits.push(`${u.carries} carries`);
    if (u.snapPct != null) bits.push(`${Math.round(u.snapPct * 100)}% of snaps`);
    if (bits.length) s.push(`Week ${usage.latest.week} usage: ${bits.join(', ')}` + (rows.week && rows.week.roleTrend && rows.week.roleTrend.label !== 'no data' && rows.week.roleTrend.label !== 'flat' ? `, a role trending ${rows.week.roleTrend.label} (${rows.week.roleTrend.pct > 0 ? '+' : ''}${rows.week.roleTrend.pct}% on his season average).` : '.'));
  }
  if (r) {
    s.push(`Rest of season: ${pos}${r.ironTuna.rank} against a consensus ${pos}${r.consensus.rank}, ${r.games} games left${r.byes.length ? ', bye week ' + r.byes.join(' and ') : ''}, ${r.ironTuna.confidence.toLowerCase()} confidence` + (r.scheduleDifficulty ? `, ${r.scheduleDifficulty.label.toLowerCase()} schedule.` : '.'));
  }
  if (pf) {
    s.push(`Fantasy playoffs (Weeks 15-17): ${pos}${pf.ironTuna.rank}, ${pf.games} games` + (pf.scheduleDifficulty ? `, ${pf.scheduleDifficulty.label.toLowerCase()} schedule` : '') + `, ${pf.vegas.basis === 'ratings' ? 'no book has posted those games yet' : pf.vegas.basis}.`);
  }
  const propsN = Object.keys(props || {}).length;
  if (!propsN && w) s.push('No sportsbook has a prop on him this week; his Vegas number is the game line\'s scoring environment applied to his line.');
  return s.join(' ');
}
async function playerIntelPayload(env, name, position, opts) {
  const o = opts || {};
  const pos = String(position || '').toUpperCase().replace('DST', 'DEF');
  const key = _oddsNorm(name) + '|' + pos;
  const rows = {};
  for (const hz of Object.keys(HORIZONS)) {
    const b = await boardsPayload(env, { horizon: hz, position: 'ALL', preset: o.preset || 'ppr', through: o.through || null });
    if (!b.ok) continue;
    const row = b.players.find(p => p.key === key);
    if (row) rows[hz] = row;
  }
  if (!Object.keys(rows).length) return { ok: false, error: 'off_board', name, position: pos };
  const hist = await marketHistoryAll(env, name);
  const mk = marketPropsFrom(hist);
  const usage = await usageCacheRead(env);
  const u = usage && usage.players ? usage.players[key] : null;
  const w = rows.week || null;
  return {
    ok: true, contract: 1,
    player: { name: (w || rows.ros || rows.playoffs || rows.next3).name, position: pos === 'DEF' ? 'DST' : pos, team: (w || rows.ros || rows.playoffs || rows.next3).team, key },
    horizons: rows,
    thisWeek: w ? {
      ironTuna: w.ironTuna, consensus: w.consensus, vegas: w.vegas, marketDelta: w.marketDelta, why: w.why,
      opponent: w.weeks[0] ? w.weeks[0].opponent : null, home: w.weeks[0] ? w.weeks[0].home : null,
      environment: w.weeks[0] ? w.weeks[0].env : null, kickoff: w.weeks[0] ? w.weeks[0].kickoff : null, gameStatus: w.weeks[0] ? w.weeks[0].status : null,
      vegasProjection: w.weeks[0] ? w.weeks[0].vegasProjection : null, injury: w.injury, roleTrend: w.roleTrend
    } : null,
    props: mk.props, movement: mk.movement, propsAsOf: mk.asOf,
    tdProbability: w && w.vegas.td ? { probability: w.vegas.td.probability, basis: 'anytime-td-market', books: w.vegas.td.books }
      : w ? { probability: Math.round((1 - Math.exp(-((w.ironTuna.stats.rushTD || 0) + (w.ironTuna.stats.recTD || 0)))) * 1000) / 10, basis: 'derived' } : null,
    usage: u ? { latest: u.latest, season: u.season, throughWeek: usage.throughWeek } : null,
    take: buildTake(rows, mk.props, u)
  };
}

// Memoized per isolate alongside _PROJ_ENC so the hot path stays a single D1
// read at most once per isolate, and zero reads once warm.
let _PROJ_BLEND_AT = 0;
let _ODDS_KICK_AT = 0;
let _COLUMN_CACHE = null;
let _COLUMN_AT = 0;
let _COLUMN_KEY = '';
// The player card asks about ONE man, so its cache is a map keyed by the man —
// but the board behind every answer is built once per isolate and shared, which
// is what keeps four hundred distinct URLs down to a single D1 read.
let _PODDS_BOARD = null;
let _PODDS_BOARD_AT = 0;
let _LEAD_CACHE = null;
let _LEAD_AT = 0;

// ── the generated lead story ──────────────────────────────────────────────
// A scheduled Claude Routine writes one fresh, data-driven insight into the D1
// `lead_story` table every three hours and it becomes the front page's lead.
// Two flags gate it, and they mean different things:
//   verified = 1  the run could trace every number in the body to something it
//                 pulled that run. A row that fails this never reaches a reader.
//   published = 1 this is the CURRENT lead. The run sets it on its own row and
//                 clears it on every other, so exactly one row is ever live.
// Older verified rows keep verified = 1 with published = 0, which is what makes
// the "Recent insights" list: vetted, no longer the lead. Unpublishing a bad row
// therefore pulls it off the lead without also pulling the whole archive.
//
// The categories the Routine rotates through. The site names them here rather
// than trusting whatever string the run stored, so a typo in a generated row
// cannot invent a new desk on the front page.
const LEAD_CATEGORIES = {
  player:     'Player Insight',
  playcaller: 'Play-Caller Premium',
  vegas:      'Vegas vs. Consensus',
  preseason:  'Preseason',
  injury:     'Injury Report',
  market:     'Market & Roster Build'
};
const LEAD_RECENT = 5;

// The desk's three-hour slot, derived from a timestamp the same way the run
// derives its own: floor(epoch_seconds / 10800). One slot should hold exactly
// one story. On 2026-08-21 slot 165494 held four, twenty minutes apart, because
// the Routine was fired by hand several times while another desk was being
// tested. Nothing broke — each new row retires the last, so the site was never
// wrong — but three finished stories were published and buried within minutes,
// and a reader watching the front page saw the lead change four times in the
// space of one slot. Surfacing the slot is what makes that visible at all.
const LEAD_SLOT_MS = 10800000;
const leadSlot = ms => Math.floor((+ms || 0) / LEAD_SLOT_MS);

// Headshots for the players a GENERATED lead story names, keyed by the same
// slug tools/build-front.mjs uses. Rebuilt by tools/build-worker-faces.mjs from
// tools/nfl-headshots.json, scoped to the PROJECTIONS pool.
//
// It lives here rather than in front.html on purpose. front.html's own PLAYERS
// cast covers the players the AUTHORED drop pages name, which is the wrong set
// for a run that can name anybody on the board — it named Justin Jefferson and
// the page had no photo of him. Widening that cast would have put ~39 KB on a
// 150 KB page for every visitor; this file is never downloaded by a browser, so
// the map costs a reader nothing and only the few URLs a story needs travel.
const LEAD_FACES = {"josh-allen":{"n":"Josh Allen","t":"BUF","p":"QB","e":"3918298","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mjwbioajzldkq1vzoz2d"},"lamar-jackson":{"n":"Lamar Jackson","t":"BAL","p":"QB","e":"3916387","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/eno6s5qzl9grbfbfwhoa"},"drake-maye":{"n":"Drake Maye","t":"NE","p":"QB","e":"4431452","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/s1nmoon2xnrc3bnyulv4"},"jayden-daniels":{"n":"Jayden Daniels","t":"WAS","p":"QB","e":"4426348","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gfz8k5onuqjrche9ogqc"},"dak-prescott":{"n":"Dak Prescott","t":"DAL","p":"QB","e":"2577417","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yvscmqq1qki8zfsemmcd"},"joe-burrow":{"n":"Joe Burrow","t":"CIN","p":"QB","e":"3915511","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gnnvcgui1cijybukk2w7"},"jalen-hurts":{"n":"Jalen Hurts","t":"PHI","p":"QB","e":"4040715","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xow5yvxjeqa6witmofmp"},"trevor-lawrence":{"n":"Trevor Lawrence","t":"JAX","p":"QB","e":"4360310","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/k9uzdernqkx7oquy7dkg"},"jaxson-dart":{"n":"Jaxson Dart","t":"NYG","p":"QB","e":"4689114","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/n6uymxssgiicjmxkzxoc"},"brock-purdy":{"n":"Brock Purdy","t":"SF","p":"QB","e":"4361741","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xs2fyj1sqdgwvt9ihbri"},"patrick-mahomes":{"n":"Patrick Mahomes","t":"KC","p":"QB","e":"3139477","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wdckwtob1lybvkmxnf7p"},"matthew-stafford":{"n":"Matthew Stafford","t":"LAR","p":"QB","e":"12483","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/jwpkjfrkzufdyh8u1mg7"},"daniel-jones":{"n":"Daniel Jones","t":"IND","p":"QB","e":"3917792","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ohvvctuykzwrpqer7xgl"},"justin-herbert":{"n":"Justin Herbert","t":"LAC","p":"QB","e":"4038941","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/jnkspnntgebegzp4ghve"},"jared-goff":{"n":"Jared Goff","t":"DET","p":"QB","e":"3046779","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kaicbot8qhzrvddilbtp"},"caleb-williams":{"n":"Caleb Williams","t":"CHI","p":"QB","e":"4431611","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/h4qs11kutwiw7whekmyt"},"baker-mayfield":{"n":"Baker Mayfield","t":"TB","p":"QB","e":"3052587","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gjb8e69jtt1ffqf1afue"},"malik-willis":{"n":"Malik Willis","t":"MIA","p":"QB","e":"4242512","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/txvgdbwbryzyyqq6gfet"},"sam-darnold":{"n":"Sam Darnold","t":"SEA","p":"QB","e":"3912547","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fyay8vruj0cqmhopufzk"},"bo-nix":{"n":"Bo Nix","t":"DEN","p":"QB","e":"4426338","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zvo9xatffmqn9lnukpgk"},"c-j-stroud":{"n":"C.J. Stroud","t":"HOU","p":"QB","e":"4432577","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tt4zrtxlhifaljhj0rn7"},"tyler-shough":{"n":"Tyler Shough","t":"NO","p":"QB","e":"4360689","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/toiafc7qighw86geo7jf"},"kyler-murray":{"n":"Kyler Murray","t":"MIN","p":"QB","e":"3917315","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/btfruyf33adgnjzpcuen"},"jordan-love":{"n":"Jordan Love","t":"GB","p":"QB","e":"4036378","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/thz8stjkbjwddxqnozi5"},"jacoby-brissett":{"n":"Jacoby Brissett","t":"ARI","p":"QB","e":"2578570","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qjswiunczrn5xmdiqhlz"},"tua-tagovailoa":{"n":"Tua Tagovailoa","t":"ATL","p":"QB","e":"4241479","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tmm4ohds7qci0vqoobhm"},"bryce-young":{"n":"Bryce Young","t":"CAR","p":"QB","e":"4685720","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vcvhmxvxw2a3armle0af"},"aaron-rodgers":{"n":"Aaron Rodgers","t":"PIT","p":"QB","e":"8439","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dypvakakxhccxs67tb0y"},"cam-ward":{"n":"Cam Ward","t":"TEN","p":"QB","e":"4688380","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/l7switu6stlwd2irm8yo"},"geno-smith":{"n":"Geno Smith","t":"NYJ","p":"QB","e":"15864","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zppfqqcyjfma14jjif3a"},"fernando-mendoza":{"n":"Fernando Mendoza","t":"LV","p":"QB","e":"4837248","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/umygvel2pumkyvxt3jm9"},"deshaun-watson":{"n":"Deshaun Watson","t":"CLE","p":"QB","e":"3122840","h":"https://static.www.nfl.com/image/private/f_auto,q_auto/league/otfs2docj6eahaebo5xn"},"shedeur-sanders":{"n":"Shedeur Sanders","t":"CLE","p":"QB","e":"4432762","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/joe08hz6to2madpko8zl"},"michael-penix-jr":{"n":"Michael Penix Jr.","t":"ATL","p":"QB","e":"4360423","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mip4kogkqxwkkya6mvmh"},"kirk-cousins":{"n":"Kirk Cousins","t":"LV","p":"QB","e":"14880","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/za7cynvpwlsro1tsaijk"},"marcus-mariota":{"n":"Marcus Mariota","t":"WAS","p":"QB","e":"2576980","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/grx6m1fmu1odltjo3y31"},"quinn-ewers":{"n":"Quinn Ewers","t":"MIA","p":"QB","e":"4889929","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bbcwyjuhyijtqe7jo274"},"desmond-ridder":{"n":"Desmond Ridder","t":"GB","p":"QB","e":"4239086","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/rhpusa7pfgd82d9ui6y7"},"joe-milton-iii":{"n":"Joe Milton III","t":"DAL","p":"QB","e":"4360698","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tsj9lobse1gxzanf39dt"},"tyler-huntley":{"n":"Tyler Huntley","t":"BAL","p":"QB","e":"4035671","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fxyjf9d5qkwqjdd8ypvv"},"davis-mills":{"n":"Davis Mills","t":"HOU","p":"QB","e":"4242546","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/jh9e97vjzmeafx8jz0sn"},"shane-buechele":{"n":"Shane Buechele","t":"BUF","p":"QB","e":"4039034","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kmbuzxucmmytpuoy8yfc"},"mason-rudolph":{"n":"Mason Rudolph","t":"PIT","p":"QB","e":"3116407","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/oadtxde6hxz1jgrs618o"},"jarrett-stidham":{"n":"Jarrett Stidham","t":"DEN","p":"QB","e":"3892775","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/uzdn86skeienyyqxyiuw"},"will-levis":{"n":"Will Levis","t":"TEN","p":"QB","e":"4361418","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/npovrxpll0gqlkptsn6r"},"gardner-minshew":{"n":"Gardner Minshew","t":"ARI","p":"QB","e":"4038524","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/knlacyr7rqfkcxiriudj"},"garrett-nussmeier":{"n":"Garrett Nussmeier","t":"KC","p":"QB","e":"4567747","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/uyidfkzfhuqaks3pmdeo"},"behren-morton":{"n":"Behren Morton","t":"NE","p":"QB","e":"4431465","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/st5s1urflg14hwvx8uzl"},"seth-henigan":{"n":"Seth Henigan","t":"IND","p":"QB","e":"4606194","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wiwxejmni2scokth3eto"},"joshua-dobbs":{"n":"Joshua Dobbs","t":"NE","p":"QB","e":"3044720","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/twaqqjexyi0vgyfbvzis"},"tanner-mckee":{"n":"Tanner McKee","t":"PHI","p":"QB","e":"4685201","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/oveivzhzv13jrfvkp8zg"},"teddy-bridgewater":{"n":"Teddy Bridgewater","t":"DET","p":"QB","e":"16728","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wggyfg1dgyiwcgxafoen"},"cade-klubnik":{"n":"Cade Klubnik","t":"NYJ","p":"QB","e":"4685413","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/sqsxavkryojbysy4kq85"},"tyson-bagent":{"n":"Tyson Bagent","t":"CHI","p":"QB","e":"4434153","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ymimvligfyrucu0v3p6a"},"cole-payton":{"n":"Cole Payton","t":"PHI","p":"QB","e":"4879250","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qt8hajjwkvpynr8nwepz"},"adrian-martinez":{"n":"Adrian Martinez","t":"SF","p":"QB","e":"4361182","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/w0ehlpfwk70tqpswllwv"},"carson-beck":{"n":"Carson Beck","t":"ARI","p":"QB","e":"4430841","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yvybqpgnezk75h9rpobv"},"kyle-allen":{"n":"Kyle Allen","t":"BUF","p":"QB","e":"3115293","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/s3vbqdcoc6oc6yh460v9"},"will-howard":{"n":"Will Howard","t":"PIT","p":"QB","e":"4429955","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wzt7xj9ownxfit5igpcd"},"nick-mullens":{"n":"Nick Mullens","t":"JAX","p":"QB","e":"3059989","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/haxwyajgngz6quuyqg19"},"jalen-milroe":{"n":"Jalen Milroe","t":"SEA","p":"QB","e":"4432734","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hohqoqpdyquxn1sr1fm2"},"drew-allar":{"n":"Drew Allar","t":"PIT","p":"QB","e":"4714771","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/sphuqnfrtzwsgeugeycz"},"bijan-robinson":{"n":"Bijan Robinson","t":"ATL","p":"RB","e":"4430807","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/esii5yb8yn9edboi4mlq"},"jahmyr-gibbs":{"n":"Jahmyr Gibbs","t":"DET","p":"RB","e":"4429795","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cursejnmmp1i9hnxihkj"},"jonathan-taylor":{"n":"Jonathan Taylor","t":"IND","p":"RB","e":"4242335","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yw46ky6akdm7h7siofu8"},"derrick-henry":{"n":"Derrick Henry","t":"BAL","p":"RB","e":"3043078","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tm79x0iknqg6hms3ypyt"},"de-von-achane":{"n":"De'Von Achane","t":"MIA","p":"RB","e":"4429160","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xk1xwio0bryfxo1ylweu"},"christian-mccaffrey":{"n":"Christian McCaffrey","t":"SF","p":"RB","e":"3117251","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/st82s2ytyzanatcmkqck"},"chase-brown":{"n":"Chase Brown","t":"CIN","p":"RB","e":"4362238","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tch3y6jlj7khvyi9jg0c"},"ashton-jeanty":{"n":"Ashton Jeanty","t":"LV","p":"RB","e":"4890973","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/syspis1mntov9kgspb7r"},"james-cook":{"n":"James Cook","t":"BUF","p":"RB","e":"4379399","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/anjbznqb9i21wzcgrtbs"},"saquon-barkley":{"n":"Saquon Barkley","t":"PHI","p":"RB","e":"3929630","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qcayrzjpura2zydszonh"},"josh-jacobs":{"n":"Josh Jacobs","t":"GB","p":"RB","e":"4047365","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/uceokxeo0uqrqms3e3vl"},"cam-skattebo":{"n":"Cam Skattebo","t":"NYG","p":"RB","e":"4696981","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hlggiqdfvj1f4kntkafr"},"kyren-williams":{"n":"Kyren Williams","t":"LAR","p":"RB","e":"4430737","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xti3pek6rmojqchakxpy"},"breece-hall":{"n":"Breece Hall","t":"NYJ","p":"RB","e":"4427366","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/i01xtqbfajfq68lb6orh"},"omarion-hampton":{"n":"Omarion Hampton","t":"LAC","p":"RB","e":"4685382","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lf2jxvxnbexlinoydbej"},"bucky-irving":{"n":"Bucky Irving","t":"TB","p":"RB","e":"4596448","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vkc00rvnix3f2b96vkwo"},"travis-etienne":{"n":"Travis Etienne","t":"NO","p":"RB","e":"4239996","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/pwko5dybmjie8qqo4qz2"},"d-andre-swift":{"n":"D'Andre Swift","t":"CHI","p":"RB","e":"4259545","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/owpmwzoilitcodc6cmxo"},"jeremiyah-love":{"n":"Jeremiyah Love","t":"ARI","p":"RB","e":"4870808","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/b12gtjsylmql5v7iyyla"},"javonte-williams":{"n":"Javonte Williams","t":"DAL","p":"RB","e":"4361579","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xvwroirev2kie6oiphtz"},"kenneth-walker-iii":{"n":"Kenneth Walker III","t":"KC","p":"RB","e":"4567048","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vk6nruaqdewdglofcwwg"},"rico-dowdle":{"n":"Rico Dowdle","t":"PIT","p":"RB","e":"4038815","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mx2bxccuzmdvzbksypws"},"bhayshul-tuten":{"n":"Bhayshul Tuten","t":"JAX","p":"RB","e":"4882093","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ryjnphuyjbedmgpx5qqj"},"treveyon-henderson":{"n":"TreVeyon Henderson","t":"NE","p":"RB","e":"4432710","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ebcjvwytgu2y4kqm8ihv"},"quinshon-judkins":{"n":"Quinshon Judkins","t":"CLE","p":"RB","e":"4685702","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ojtce2im0wp2ltyel0vc"},"rj-harvey":{"n":"RJ Harvey","t":"DEN","p":"RB","e":"4568490","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/szxmro5enrxlscvv67xg"},"jaylen-warren":{"n":"Jaylen Warren","t":"PIT","p":"RB","e":"4569987","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dkiteytgnxar1mpaxcxv"},"jadarian-price":{"n":"Jadarian Price","t":"SEA","p":"RB","e":"4685512","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/toy90i08oumgbdlvctja"},"david-montgomery":{"n":"David Montgomery","t":"HOU","p":"RB","e":"4035538","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/csz0c9roa4pqsccothxg"},"rhamondre-stevenson":{"n":"Rhamondre Stevenson","t":"NE","p":"RB","e":"4569173","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zmpuirvuw4r04inxth5i"},"tony-pollard":{"n":"Tony Pollard","t":"TEN","p":"RB","e":"3916148","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mb2xdrqiys6ktlcuah2n"},"chuba-hubbard":{"n":"Chuba Hubbard","t":"CAR","p":"RB","e":"4241416","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/rzsvnt0pxsaize2ndhxm"},"j-k-dobbins":{"n":"J.K. Dobbins","t":"DEN","p":"RB","e":"4241985","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cevotvl3ho5h1mioruyg"},"jordan-mason":{"n":"Jordan Mason","t":"MIN","p":"RB","e":"4360569","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qeeucinnxl8mpzaw23hc"},"jacory-croskey-merritt":{"n":"Jacory Croskey-Merritt","t":"WAS","p":"RB","e":"4575131","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qew4qhlj4yuf50voko61"},"aaron-jones":{"n":"Aaron Jones","t":"MIN","p":"RB","e":"3042519","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bktkfvgfwujkdbzkcfim"},"kyle-monangai":{"n":"Kyle Monangai","t":"CHI","p":"RB","e":"4608686","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bkkk3uuouhcobydqawro"},"rachaad-white":{"n":"Rachaad White","t":"WAS","p":"RB","e":"4697815","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wtdhs50gcl2p6vngsnre"},"tyrone-tracy-jr":{"n":"Tyrone Tracy Jr.","t":"NYG","p":"RB","e":"4360516","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/b9nje50lohbprf06xoom"},"blake-corum":{"n":"Blake Corum","t":"LAR","p":"RB","e":"4429096","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/axzqbqjkrbwfzodwwakq"},"woody-marks":{"n":"Woody Marks","t":"HOU","p":"RB","e":"4429059","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/y5ntpcenhhhv98uz2fys"},"chris-rodriguez-jr":{"n":"Chris Rodriguez Jr.","t":"JAC","p":"RB","e":"4362619","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/pknd5uajvpvfd8c744im"},"zach-charbonnet":{"n":"Zach Charbonnet","t":"SEA","p":"RB","e":"4426385","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cuuyog0lpxfaj0y0huvp"},"tyjae-spears":{"n":"Tyjae Spears","t":"TEN","p":"RB","e":"4428557","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/pkly3nkohty1tuijtwty"},"isiah-pacheco":{"n":"Isiah Pacheco","t":"DET","p":"RB","e":"4361529","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hkqb4imkum3vxxkwuetl"},"jonathon-brooks":{"n":"Jonathon Brooks","t":"CAR","p":"RB","e":"4678008","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/txl39rwjrs2fkm1shtxh"},"kaelon-black":{"n":"Kaelon Black","t":"SF","p":"RB","e":"4696044","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/nwgkzr1ysr32jc79zfnt"},"jordan-james":{"n":"Jordan James","t":"SF","p":"RB","e":"4685397","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/un9cfqnwdzugrcy8caoh"},"james-conner":{"n":"James Conner","t":"ARI","p":"RB","e":"3045147","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ka8wlhtteg8hsowsdofk"},"justice-hill":{"n":"Justice Hill","t":"BAL","p":"RB","e":"4038441","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fuodbrwvianete2gy5ag"},"dylan-sampson":{"n":"Dylan Sampson","t":"CLE","p":"RB","e":"5081397","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/den1hzzomdxfcsgk88o5"},"adam-randall":{"n":"Adam Randall","t":"BAL","p":"RB","e":"4685526","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cdr4vibcb4jxp8nswxl9"},"malik-davis":{"n":"Malik Davis","t":"DAL","p":"RB","e":"4240603","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zvranxxyt8qeihn8c2q9"},"tyler-allgeier":{"n":"Tyler Allgeier","t":"ARI","p":"RB","e":"4373626","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/sp9lhhmpv4qy3xy2msxd"},"emari-demercado":{"n":"Emari Demercado","t":"KC","p":"RB","e":"4362478","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wu0sm9ttr4aiugi9fquf"},"ty-johnson":{"n":"Ty Johnson","t":"BUF","p":"RB","e":"3915411","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zruhihypizhtgpvsaj3c"},"braelon-allen":{"n":"Braelon Allen","t":"NYJ","p":"RB","e":"4685247","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fmpzgmfjmcbrv1gmqbdn"},"emanuel-wilson":{"n":"Emanuel Wilson","t":"SEA","p":"RB","e":"4887558","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/uorruvczsxzvffpbxu8z"},"aj-dillon":{"n":"AJ Dillon","t":"CAR","p":"RB","e":"4239934","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/imxxt8yrbrxptoxr1hw5"},"jawhar-jordan":{"n":"Jawhar Jordan","t":"HOU","p":"RB","e":"4429939","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mdov6nge0ui6pc3kx0l2"},"samaje-perine":{"n":"Samaje Perine","t":"CIN","p":"RB","e":"3116389","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fllwhcdovol5i7xxahf6"},"mike-washington-jr":{"n":"Mike Washington Jr.","t":"LV","p":"RB","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ocdjq5ohmtgdghqdh5m4"},"keaton-mitchell":{"n":"Keaton Mitchell","t":"LAC","p":"RB","e":"4596334","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ztciwwpbyaffmckwrzdk"},"kimani-vidal":{"n":"Kimani Vidal","t":"LAC","p":"RB","e":"4430968","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tqdctdun0bv60d5ziwtl"},"kendre-miller":{"n":"Kendre Miller","t":"NO","p":"RB","e":"4599739","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vclaomtslw55smksopku"},"tank-bigsby":{"n":"Tank Bigsby","t":"PHI","p":"RB","e":"4429013","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vfkdjfpiyrcuzahrmfvn"},"kyle-juszczyk":{"n":"Kyle Juszczyk","t":"SF","p":"RB","e":"16002","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tsejiiddtouukwyyqr9q"},"jaylen-wright":{"n":"Jaylen Wright","t":"MIA","p":"RB","e":"4682745","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/feeuommtlmpvuxvtb1zt"},"brashard-smith":{"n":"Brashard Smith","t":"KC","p":"RB","e":"4596602","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xnf4x6b9a2yunsc0gaej"},"devin-neal":{"n":"Devin Neal","t":"NO","p":"RB","e":"4682652","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yqv7u0yb5toyhx1pnvku"},"frank-gore-jr":{"n":"Frank Gore Jr.","t":"BUF","p":"RB","e":"4429805","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qzf7faowlqoh5nengpq5"},"roschon-johnson":{"n":"Roschon Johnson","t":"CHI","p":"RB","e":"4426386","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xbham6uvckkshpntb8oj"},"jerome-ford":{"n":"Jerome Ford","t":"WAS","p":"RB","e":"4372019","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/rntmoum7ncnyo5j2bdei"},"isaiah-davis":{"n":"Isaiah Davis","t":"NYJ","p":"RB","e":"4695404","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/x6r9a5xhtaklbvnqmtw7"},"phil-mafah":{"n":"Phil Mafah","t":"DAL","p":"RB","e":"4431562","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/r91conel40ilon72blzb"},"ty-chandler":{"n":"Ty Chandler","t":"NO","p":"RB","e":"4242431","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dmprsfd75phecgmbkf4l"},"seth-mcgowan":{"n":"Seth McGowan","t":"IND","p":"RB","e":"4686468","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qkwvvygwu9pan88sivzb"},"sean-tucker":{"n":"Sean Tucker","t":"TB","p":"RB","e":"4430871","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wiarwjvy8p6bojlratp4"},"kaytron-allen":{"n":"Kaytron Allen","t":"WAS","p":"RB","e":"4685246","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vbhwkqty94alwjyz8cin"},"austin-ekeler":{"n":"Austin Ekeler","t":"WAS","p":"RB","e":"3068267","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/sldndpn2zwt4uhkj2zks"},"michael-burton":{"n":"Michael Burton","t":"CLE","p":"RB","e":"2515270","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ibyeabk3yu68mgipxklr"},"andrew-beck":{"n":"Andrew Beck","t":"NYJ","p":"RB","e":"3125107","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zv8xb3nfxamq7sqa1xqt"},"jeremy-mcnichols":{"n":"Jeremy McNichols","t":"WAS","p":"RB","e":"3127586","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xcrgrtlk6ukrshtlnr5e"},"isaac-guerendo":{"n":"Isaac Guerendo","t":"SF","p":"RB","e":"4372561","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/uy1bdu0dokosyzl4ohmi"},"ameer-abdullah":{"n":"Ameer Abdullah","t":"JAX","p":"RB","e":"2576336","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/k8teyeiqchljlm0h5te4"},"jam-miller":{"n":"Jam Miller","t":"NE","p":"RB","e":"4685477","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zfxfycwnsyjtoj1n8j5e"},"dare-ogunbowale":{"n":"Dare Ogunbowale","t":"HOU","p":"RB","e":"2983509","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bsm0k0jkytuiej2riudv"},"elijah-mitchell":{"n":"Elijah Mitchell","t":"PHI","p":"RB","e":"4241555","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xf383ph8bz6dpp0u9lcd"},"zavier-scott":{"n":"Zavier Scott","t":"MIN","p":"RB","e":"4257364","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/z8sqpgdoyuv5rask15vn"},"jaxon-smith-njigba":{"n":"Jaxon Smith-Njigba","t":"SEA","p":"WR","e":"4430878","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yx1xjrupbqdknnjaq4a6"},"puka-nacua":{"n":"Puka Nacua","t":"LAR","p":"WR","e":"4426515","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ipy6qw7hdygdfc8k86ba"},"ja-marr-chase":{"n":"Ja'Marr Chase","t":"CIN","p":"WR","e":"4362628","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qya3dtjb5kgofcuj2tuw"},"drake-london":{"n":"Drake London","t":"ATL","p":"WR","e":"4426502","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mcllowcfrmmdeo4zy3g1"},"amon-ra-st-brown":{"n":"Amon-Ra St. Brown","t":"DET","p":"WR","e":"4374302","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fd8nwhm6pvxfyzphzl6i"},"rashee-rice":{"n":"Rashee Rice","t":"KC","p":"WR","e":"4428331","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qhkbqrydjeur8zvrrmfl"},"george-pickens":{"n":"George Pickens","t":"DAL","p":"WR","e":"4426354","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cbpyykoguf7rsxezqzvk"},"chris-olave":{"n":"Chris Olave","t":"NO","p":"WR","e":"4361370","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/onmxufsprtvglhejg94o"},"a-j-brown":{"n":"A.J. Brown","t":"NE","p":"WR","e":"4047646","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qfhvjyssf0lwsh0kienp"},"ceedee-lamb":{"n":"CeeDee Lamb","t":"DAL","p":"WR","e":"4241389","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mbblzwtynxr15ovzkevi"},"nico-collins":{"n":"Nico Collins","t":"HOU","p":"WR","e":"4258173","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fguybjrn1kwflxm5szwq"},"zay-flowers":{"n":"Zay Flowers","t":"BAL","p":"WR","e":"4429615","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xzhto2dejy2pflkfx40c"},"justin-jefferson":{"n":"Justin Jefferson","t":"MIN","p":"WR","e":"4262921","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/htjevkugzk6ietrjysny"},"tee-higgins":{"n":"Tee Higgins","t":"CIN","p":"WR","e":"4239993","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gpwtyv3viwy9q4ewderl"},"devonta-smith":{"n":"DeVonta Smith","t":"PHI","p":"WR","e":"4241478","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/k724kq3hyv7jc0y9s03x"},"malik-nabers":{"n":"Malik Nabers","t":"NYG","p":"WR","e":"4595348","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/w3edoyyuomqlovvp9ixc"},"garrett-wilson":{"n":"Garrett Wilson","t":"NYJ","p":"WR","e":"4569618","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/upxwxmhdd8xluztgqwhe"},"emeka-egbuka":{"n":"Emeka Egbuka","t":"TB","p":"WR","e":"4567750","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/z224kbzs62rjuykc0vha"},"terry-mclaurin":{"n":"Terry McLaurin","t":"WAS","p":"WR","e":"3121422","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tmfl2zruajmkrtcg4zxp"},"alec-pierce":{"n":"Alec Pierce","t":"IND","p":"WR","e":"4360078","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qcg9t51wgp3hicavmkmy"},"courtland-sutton":{"n":"Courtland Sutton","t":"DEN","p":"WR","e":"3128429","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kqwmqcrlrwmqcvfuguhs"},"jameson-williams":{"n":"Jameson Williams","t":"DET","p":"WR","e":"4426388","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/byiptqggtglvy5qrw5wp"},"tetairoa-mcmillan":{"n":"Tetairoa McMillan","t":"CAR","p":"WR","e":"4685472","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gilgvjemumd6kpc9eiku"},"rome-odunze":{"n":"Rome Odunze","t":"CHI","p":"WR","e":"4431299","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/niewdl2p2325kpohbw9v"},"davante-adams":{"n":"Davante Adams","t":"LAR","p":"WR","e":"16800","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tdzluk4xau3arxqk9zsl"},"ladd-mcconkey":{"n":"Ladd McConkey","t":"LAC","p":"WR","e":"4612826","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/q2sk7yforrkiusvruo1o"},"luther-burden-iii":{"n":"Luther Burden III","t":"CHI","p":"WR","e":"4685278","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/iyuwdz7pbowdkwzq2tg5"},"jaylen-waddle":{"n":"Jaylen Waddle","t":"DEN","p":"WR","e":"4372016","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gkh7m1jedon9mwn5jlf1"},"marvin-harrison-jr":{"n":"Marvin Harrison Jr.","t":"ARI","p":"WR","e":"4432708","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hwpoo1icpnh8emjvqaii"},"dj-moore":{"n":"DJ Moore","t":"BUF","p":"WR","e":"3915416","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lsavpxtqoqu25emwcnvy"},"mike-evans":{"n":"Mike Evans","t":"SF","p":"WR","e":"16737","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zc4ujpmndyxrbiyyjomz"},"jakobi-meyers":{"n":"Jakobi Meyers","t":"JAX","p":"WR","e":"3916433","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zrs4ij8mvw7wr1uujwew"},"wan-dale-robinson":{"n":"Wan'Dale Robinson","t":"TEN","p":"WR","e":"4569587","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yzcvyhmilvxedfjfjglc"},"dk-metcalf":{"n":"DK Metcalf","t":"PIT","p":"WR","e":"4047650","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kxql4sjfelubhxawu2zh"},"parker-washington":{"n":"Parker Washington","t":"JAX","p":"WR","e":"4432620","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yn0hc5xrz5nqeccg8two"},"quentin-johnston":{"n":"Quentin Johnston","t":"LAC","p":"WR","e":"4429025","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lyvsrjh4mjb4dqwp6shm"},"josh-downs":{"n":"Josh Downs","t":"IND","p":"WR","e":"4688813","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/z3wahaxpmc6d5lcxgh60"},"christian-watson":{"n":"Christian Watson","t":"GB","p":"WR","e":"4248528","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tumeg4d32sirkab2xzu5"},"michael-pittman":{"n":"Michael Pittman","t":"PIT","p":"WR","e":"4035687","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/q1ythn05kwcmdr4mwzll"},"michael-wilson":{"n":"Michael Wilson","t":"ARI","p":"WR","e":"4360761","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hm2b9z4zujjmbiyldh8n"},"brian-thomas-jr":{"n":"Brian Thomas Jr.","t":"JAX","p":"WR","e":"4432773","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/plnekkriys4cm11rnxwl"},"khalil-shakir":{"n":"Khalil Shakir","t":"BUF","p":"WR","e":"4373678","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/syvp3hficobwcsim3i9v"},"tank-dell":{"n":"Tank Dell","t":"HOU","p":"WR","e":"4366031","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dzjep37g7fqdweqtncso"},"jordan-addison":{"n":"Jordan Addison","t":"MIN","p":"WR","e":"4429205","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mi4lzk9gvjrvo6rwdf1e"},"jordyn-tyson":{"n":"Jordyn Tyson","t":"NO","p":"WR","e":"4880281","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/al6fifxstyc6omsenzhd"},"jayden-reed":{"n":"Jayden Reed","t":"GB","p":"WR","e":"4362249","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/uhb95fij1uo92ymqxpmg"},"romeo-doubs":{"n":"Romeo Doubs","t":"NE","p":"WR","e":"4361432","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yxvzijmgwyyigljxfmyb"},"john-metchie-iii":{"n":"John Metchie III","t":"CAR","p":"WR","e":"4567096","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/nsjpnskeldxzbzckpfgg"},"jauan-jennings":{"n":"Jauan Jennings","t":"MIN","p":"WR","e":"3886598","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ben8kbygzzlid6ltmdum"},"xavier-worthy":{"n":"Xavier Worthy","t":"KC","p":"WR","e":"4683062","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/u6fmnffwteccoxn3uguq"},"makai-lemon":{"n":"Makai Lemon","t":"PHI","p":"WR","e":"4870795","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ys2i2o7c0bl36xvlrojz"},"cooper-kupp":{"n":"Cooper Kupp","t":"SEA","p":"WR","e":"2977187","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kjixprihktsfog6wx9sq"},"troy-franklin":{"n":"Troy Franklin","t":"DEN","p":"WR","e":"4431280","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wgfbgxjntyqzojpizgaj"},"jalen-coker":{"n":"Jalen Coker","t":"CAR","p":"WR","e":"4695883","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yynz8rxen6tsvhojggiv"},"calvin-ridley":{"n":"Calvin Ridley","t":"TEN","p":"WR","e":"3925357","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zrv8bjm7zdtboyka2jvr"},"carnell-tate":{"n":"Carnell Tate","t":"TEN","p":"WR","e":"4871023","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ghpmpzcnigxrdbyvcxke"},"theo-wease-jr":{"n":"Theo Wease Jr.","t":"MIA","p":"WR","e":"4426535","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/iykujtgwn2x1ymy7jdxw"},"jerry-jeudy":{"n":"Jerry Jeudy","t":"CLE","p":"WR","e":"4241463","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/szca1v9butuqkjs7ekpm"},"keon-coleman":{"n":"Keon Coleman","t":"BUF","p":"WR","e":"4635008","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cm7g87waetksjouyjgvg"},"marvin-mims-jr":{"n":"Marvin Mims Jr.","t":"DEN","p":"WR","e":"4686472","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zbdjtph5xplbf4yocz0l"},"rashod-bateman":{"n":"Rashod Bateman","t":"BAL","p":"WR","e":"4360939","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gtktmsfcxc1eijwpwzyq"},"tre-tucker":{"n":"Tre Tucker","t":"LV","p":"WR","e":"4428718","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hazzk3hrcequzosdgzgv"},"rashid-shaheed":{"n":"Rashid Shaheed","t":"SEA","p":"WR","e":"4032473","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ku2naisfbxmzgagxojnm"},"christian-kirk":{"n":"Christian Kirk","t":"SF","p":"WR","e":"3895856","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ffp75mtwnqgrv0qz0txz"},"jalen-nailor":{"n":"Jalen Nailor","t":"LV","p":"WR","e":"4382466","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/nojopyt8hxuwycxyaokb"},"jayden-higgins":{"n":"Jayden Higgins","t":"HOU","p":"WR","e":"4877706","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/s3zuo0ysm9ncxr9o4420"},"omar-cooper-jr":{"n":"Omar Cooper Jr.","t":"NYJ","p":"WR","e":"4723820","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lmua2lbg0m77ibvydvaq"},"antonio-williams":{"n":"Antonio Williams","t":"WAS","p":"WR","e":"5081432","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/noywrsgaqoqlv64c12yw"},"kayshon-boutte":{"n":"Kayshon Boutte","t":"NE","p":"WR","e":"4429022","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mg4icjqhwhnc5uobmau5"},"jalen-mcmillan":{"n":"Jalen McMillan","t":"TB","p":"WR","e":"4430834","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/s8tlj5wsi6cq8kjhp06v"},"marquise-brown":{"n":"Marquise Brown","t":"PHI","p":"WR","e":"4241372","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/shkjxggufymydgp6wk3p"},"devaughn-vele":{"n":"Devaughn Vele","t":"NO","p":"WR","e":"4569559","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fa3dwsu8nxzkbf2knczm"},"matthew-golden":{"n":"Matthew Golden","t":"GB","p":"WR","e":"4701936","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dbjki6b0swksr7mk17wk"},"elic-ayomanor":{"n":"Elic Ayomanor","t":"TEN","p":"WR","e":"4883647","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/jjmscqt6v4ecasveugoh"},"kc-concepcion":{"n":"KC Concepcion","t":"CLE","p":"WR","e":"4870653","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ztdyzyngqr1pexyghlt3"},"tory-horton":{"n":"Tory Horton","t":"SEA","p":"WR","e":"4597703","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lmsun4qzmk1rkgt4kw76"},"darnell-mooney":{"n":"Darnell Mooney","t":"NYG","p":"WR","e":"4040655","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/eaejonwaflt9drrs9ika"},"chimere-dike":{"n":"Chimere Dike","t":"TEN","p":"WR","e":"4431268","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cbcpv4931dqmgsu3anvo"},"de-zhaun-stribling":{"n":"De'Zhaun Stribling","t":"SF","p":"WR","e":"4710714","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/eu1nxtlztiwr5ko48iwz"},"denzel-boston":{"n":"Denzel Boston","t":"CLE","p":"WR","e":"4832800","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ybkny6eh5eegq3bqmony"},"darius-slayton":{"n":"Darius Slayton","t":"NYG","p":"WR","e":"3916945","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/otksyfjll5waf0vsczeu"},"ja-kobi-lane":{"n":"Ja'Kobi Lane","t":"BAL","p":"WR","e":"4870847","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gjezd2a8imfrxyv16wuj"},"germie-bernard":{"n":"Germie Bernard","t":"PIT","p":"WR","e":"4685261","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/rsbtypbsvxux94vokb5q"},"tyquan-thornton":{"n":"Tyquan Thornton","t":"KC","p":"WR","e":"4362921","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bjqzuempyiwxe0hl7e5a"},"bub-means":{"n":"Bub Means","t":"NO","p":"WR","e":"4427985","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/nnqvulr4up0nwhmipksq"},"malik-washington":{"n":"Malik Washington","t":"MIA","p":"WR","e":"4569603","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dmaiwnmaal9nrwfskl28"},"olamide-zaccheaus":{"n":"Olamide Zaccheaus","t":"ATL","p":"WR","e":"3917914","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zsnzd30ysrewgufbv06y"},"jahdae-walker":{"n":"Jahdae Walker","t":"CHI","p":"WR","e":"5160110","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cr13mo2xrpdkksy8fveq"},"calvin-austin-iii":{"n":"Calvin Austin III","t":"NYG","p":"WR","e":"4243389","h":"https://static.www.nfl.com/image/private/f_auto,q_auto/league/qlt6ztqcbu0uzad6aavt"},"andrei-iosivas":{"n":"Andrei Iosivas","t":"CIN","p":"WR","e":"4368003","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xhrvbt81iohroyftuyj2"},"cedric-tillman":{"n":"Cedric Tillman","t":"CLE","p":"WR","e":"4369863","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xust9v3gob1qqwhziugh"},"isaac-teslaa":{"n":"Isaac TeSlaa","t":"DET","p":"WR","e":"5123663","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ducfhbiy2a8loytcjymn"},"ashton-dulin":{"n":"Ashton Dulin","t":"IND","p":"WR","e":"4061956","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ux55cx0r9iwqwmfmaip6"},"dontayvion-wicks":{"n":"Dontayvion Wicks","t":"PHI","p":"WR","e":"4428850","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/v1lt8kpvkn0qw5elyaoz"},"demarcus-robinson":{"n":"Demarcus Robinson","t":"SF","p":"WR","e":"3043116","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cokassoz2z7hb4wk2krh"},"xavier-hutchinson":{"n":"Xavier Hutchinson","t":"HOU","p":"WR","e":"4686422","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/n5baiu6sg9wh3xhhewkd"},"caleb-douglas":{"n":"Caleb Douglas","t":"MIA","p":"WR","e":"4869645","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/stwypvmutplwvi1zzbmu"},"josh-palmer":{"n":"Josh Palmer","t":"BUF","p":"WR","e":"4242433","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/woswdfrtxnsfgzsjvsxx"},"zavion-thomas":{"n":"Zavion Thomas","t":"CHI","p":"WR","e":"4869748","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lhodk54zsmznu4yxjoux"},"zachariah-branch":{"n":"Zachariah Branch","t":"ATL","p":"WR","e":"4870612","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qwbo8lgyd85dlwnbznsc"},"luke-mccaffrey":{"n":"Luke McCaffrey","t":"WAS","p":"WR","e":"4426948","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xtxiwlkniuldrqg65n3q"},"kevin-austin-jr":{"n":"Kevin Austin Jr.","t":"NO","p":"WR","e":"4372758","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fh2yaqaxkornxeb7d9ie"},"kendrick-bourne":{"n":"Kendrick Bourne","t":"ARI","p":"WR","e":"3045523","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yzfa94cmhpcqamrwzdzk"},"jalen-tolbert":{"n":"Jalen Tolbert","t":"MIA","p":"WR","e":"4249417","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dthrzudnyh1mcrh1det2"},"tez-johnson":{"n":"Tez Johnson","t":"TB","p":"WR","e":"4608810","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ajbnpagviw0glrhf5a2e"},"ben-skowronek":{"n":"Ben Skowronek","t":"PIT","p":"WR","e":"4035656","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/etozk8ja4u8lpjcvvo6l"},"ryan-flournoy":{"n":"Ryan Flournoy","t":"DAL","p":"WR","e":"5083754","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tqwq3cgpqu7j9hzoyicx"},"roman-wilson":{"n":"Roman Wilson","t":"PIT","p":"WR","e":"4431492","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xuhjoscmhmmsutbvfmrs"},"mack-hollins":{"n":"Mack Hollins","t":"NE","p":"WR","e":"2991662","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qbz7whjzsittudcecezw"},"adonai-mitchell":{"n":"Adonai Mitchell","t":"NYJ","p":"WR","e":"4597500","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hwwacoa3pqapd7pgahfx"},"devontez-walker":{"n":"Devontez Walker","t":"BAL","p":"WR","e":"4696882","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/x3x3k5ispk44ms0f7vrv"},"trey-mcbride":{"n":"Trey McBride","t":"ARI","p":"TE","e":"4361307","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/psasp10nn5pcvkli9kil"},"brock-bowers":{"n":"Brock Bowers","t":"LV","p":"TE","e":"4432665","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/waorceny0ggpaeckaol8"},"colston-loveland":{"n":"Colston Loveland","t":"CHI","p":"TE","e":"4723086","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cnxiyi76jeahgx94nh6d"},"tyler-warren":{"n":"Tyler Warren","t":"IND","p":"TE","e":"4431459","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/f1mfwwrr3qvnxuiackgq"},"kyle-pitts":{"n":"Kyle Pitts","t":"ATL","p":"TE","e":"4360248","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xczipzxvytnmvgznhhb4"},"dallas-goedert":{"n":"Dallas Goedert","t":"PHI","p":"TE","e":"3121023","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bafepstxu7vvxb9v5vua"},"harold-fannin-jr":{"n":"Harold Fannin Jr.","t":"CLE","p":"TE","e":"5083076","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fxublmpnxx9uggsddwik"},"sam-laporta":{"n":"Sam LaPorta","t":"DET","p":"TE","e":"4430027","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/wxlk7ysg2nfq6h6ntdcu"},"george-kittle":{"n":"George Kittle","t":"SF","p":"TE","e":"3040151","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/vkicdglglkyukgyxtmpx"},"isaiah-likely":{"n":"Isaiah Likely","t":"NYG","p":"TE","e":"4361050","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/b1pahldt9ixp9lssxi2d"},"tucker-kraft":{"n":"Tucker Kraft","t":"GB","p":"TE","e":"4572680","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/n6vu44jbq31rydoaadaq"},"travis-kelce":{"n":"Travis Kelce","t":"KC","p":"TE","e":"15847","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dpxovcfku6ud2aohgf6a"},"brenton-strange":{"n":"Brenton Strange","t":"JAX","p":"TE","e":"4430539","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/devxzxwf1sfficgncggm"},"jake-ferguson":{"n":"Jake Ferguson","t":"DAL","p":"TE","e":"4242355","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xpykb0tbosfwsn6dqstb"},"dalton-kincaid":{"n":"Dalton Kincaid","t":"BUF","p":"TE","e":"4385690","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/z7k857flehljboaixj8m"},"juwan-johnson":{"n":"Juwan Johnson","t":"NO","p":"TE","e":"3929645","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ahzqkvhjot6lygwr4ccb"},"mark-andrews":{"n":"Mark Andrews","t":"BAL","p":"TE","e":"3116365","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/u4xzz7tclch0tpzm9hhz"},"hunter-henry":{"n":"Hunter Henry","t":"NE","p":"TE","e":"3046439","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cvlunbqgztudbhjrug7l"},"dalton-schultz":{"n":"Dalton Schultz","t":"HOU","p":"TE","e":"3117256","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ym8sbkev8l4scnrc0vd8"},"cade-otton":{"n":"Cade Otton","t":"TB","p":"TE","e":"4243331","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yanr6h9aplae3jyzimf7"},"greg-dulcich":{"n":"Greg Dulcich","t":"MIA","p":"TE","e":"4367209","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kw4cwgjl4kywh6le4sfh"},"aj-barner":{"n":"AJ Barner","t":"SEA","p":"TE","e":"4576297","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/i0esiguve9if4ts5mm1q"},"kenyon-sadiq":{"n":"Kenyon Sadiq","t":"NYJ","p":"TE","e":"5083315","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/mnswulwto4yqkgmugoiq"},"oronde-gadsden-ii":{"n":"Oronde Gadsden II","t":"LAC","p":"TE","e":"4595342","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/r8b4oghjwhw8x9nv1wbs"},"t-j-hockenson":{"n":"T.J. Hockenson","t":"MIN","p":"TE","e":"4036133","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/rs8o65x0u0n9xzde0fd6"},"pat-freiermuth":{"n":"Pat Freiermuth","t":"PIT","p":"TE","e":"4361411","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/pyrdsypgggjshiaygkr7"},"colby-parkinson":{"n":"Colby Parkinson","t":"LAR","p":"TE","e":"4242557","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qsyrgtfjj06wryahnxc9"},"mason-taylor":{"n":"Mason Taylor","t":"NYJ","p":"TE","e":"4808766","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xittx9gih104lw1atfiv"},"mike-gesicki":{"n":"Mike Gesicki","t":"CIN","p":"TE","e":"3116164","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dykckg6we3cnw9yhpggi"},"evan-engram":{"n":"Evan Engram","t":"DEN","p":"TE","e":"3051876","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/nucl2dxmpvhlywhyro8o"},"david-njoku":{"n":"David Njoku","t":"LAC","p":"TE","e":"3123076","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/y4g1iayqrbrhdvkqywpx"},"tyler-higbee":{"n":"Tyler Higbee","t":"LAR","p":"TE","e":"2573401","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/x1d4osiefibd04df6gow"},"theo-johnson":{"n":"Theo Johnson","t":"NYG","p":"TE","e":"4429148","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/fv2jbzlocr1o3ahkru43"},"terrance-ferguson":{"n":"Terrance Ferguson","t":"LAR","p":"TE","e":"4570037","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/w5o0s5yf6j5dsmiwdtfg"},"gunnar-helm":{"n":"Gunnar Helm","t":"TEN","p":"TE","e":"4686728","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hewm6ztgka7xkbl6ybvb"},"dawson-knox":{"n":"Dawson Knox","t":"BUF","p":"TE","e":"3930086","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/k8bi9ppahwfmoxs8ij4w"},"noah-fant":{"n":"Noah Fant","t":"NO","p":"TE","e":"4036131","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/lijnonbrcmplvkcb5kqv"},"michael-mayer":{"n":"Michael Mayer","t":"LV","p":"TE","e":"4429086","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/twnkr9uq1phvukxb5jmh"},"will-kacmarek":{"n":"Will Kacmarek","t":"MIA","p":"TE","e":"4880236","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/erqascuieblamkhf2vbs"},"darnell-washington":{"n":"Darnell Washington","t":"PIT","p":"TE","e":"4430802","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/inwx7uipfktapaump5pj"},"brock-wright":{"n":"Brock Wright","t":"DET","p":"TE","e":"4242392","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ghmaeofuj87fm97yhvcp"},"charlie-kolar":{"n":"Charlie Kolar","t":"LAC","p":"TE","e":"4241263","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/g75ws8vkqz9cqwifhcy7"},"marlin-klein":{"n":"Marlin Klein","t":"HOU","p":"TE","e":"4695705","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ek2nzhrwqxl6psbm2iic"},"erick-all":{"n":"Erick All","t":"CIN","p":"TE","e":"4427834","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ifkhcxze7lnxkpzjvsmk"},"daniel-bellinger":{"n":"Daniel Bellinger","t":"TEN","p":"TE","e":"4361516","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/nvabdu88h2cvroeygabo"},"ben-sims":{"n":"Ben Sims","t":"MIA","p":"TE","e":"4373030","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/rigksrncrdjmbhvfuclp"},"eli-stowers":{"n":"Eli Stowers","t":"PHI","p":"TE","e":"4431574","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/c9rjqit3q5tm9hzkm5ay"},"josh-oliver":{"n":"Josh Oliver","t":"MIN","p":"TE","e":"3921690","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/awdb5xedlbq0ebpptgzb"},"davis-allen":{"n":"Davis Allen","t":"LAR","p":"TE","e":"4426553","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/iweydtcrfchsl3mt6jtd"},"tommy-tremble":{"n":"Tommy Tremble","t":"CAR","p":"TE","e":"4372780","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/t7wjikfv09d3o1q7wjdx"},"adam-trautman":{"n":"Adam Trautman","t":"DEN","p":"TE","e":"3911853","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bqsgkwkfolczyrxmdp1j"},"ja-tavion-sanders":{"n":"Ja'Tavion Sanders","t":"CAR","p":"TE","e":"4431588","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/le2akm1cbou170ioctxl"},"luke-musgrave":{"n":"Luke Musgrave","t":"GB","p":"TE","e":"4428085","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/jchchyfhiycpvm5zzn2y"},"austin-hooper":{"n":"Austin Hooper","t":"ATL","p":"TE","e":"3043275","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/dd0j9ccd8fxokl48alzg"},"jeremy-ruckert":{"n":"Jeremy Ruckert","t":"NYJ","p":"TE","e":"4361372","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bcqcta7r1uee3rqhejdh"},"grant-calcaterra":{"n":"Grant Calcaterra","t":"PHI","p":"TE","e":"4241374","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/inpyxw55sxo96shrt4si"},"cole-kmet":{"n":"Cole Kmet","t":"CHI","p":"TE","e":"4258595","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/ysnui8mzlu2fo70ub0yt"},"eli-raridon":{"n":"Eli Raridon","t":"NE","p":"TE","e":"4831959","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/tglrg0yek3kwrt8rqz5t"},"nate-boerkircher":{"n":"Nate Boerkircher","t":"JAX","p":"TE","e":"4686248","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/bxglkvzpx2y40u25xaso"},"john-bates":{"n":"John Bates","t":"WAS","p":"TE","e":"4048228","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/sqaiwpind6kk4ns4acql"},"matthew-hibner":{"n":"Matthew Hibner","t":"BAL","p":"TE","e":"4432260","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/kkkia0wl2sqsjiwecde0"},"elijah-higgins":{"n":"Elijah Higgins","t":"ARI","p":"TE","e":"4426844","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/qgvtaa0gekopg4ad6vqe"},"nate-adkins":{"n":"Nate Adkins","t":"DEN","p":"TE","e":"4383440","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/hedaw0ksq5qdzp9uhe3w"},"alvin-kamara":{"n":"Alvin Kamara","t":"NO","p":"RB","e":"3054850","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yxebpuskandivlh2iil4"},"chris-bell":{"n":"Chris Bell","t":"MIA","p":"WR","e":"4869961","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/zgbku18zemqyryvyahd4"},"stefon-diggs":{"n":"Stefon Diggs","t":"WAS","p":"WR","e":"2976212","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/cemcexmscsarpvwhafln"},"jack-bech":{"n":"Jack Bech","t":"LV","p":"WR","e":"4603186","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/feplgtl0x1svqen9szwv"},"brandon-aiyuk":{"n":"Brandon Aiyuk","t":"SF","p":"WR","e":"4360438","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/avzzxycxyculxxqce5k7"},"tre-harris":{"n":"Tre Harris","t":"LAC","p":"WR","e":"4686612","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/v5ofh8jggzo8rygtpwl7"},"tyreek-hill":{"n":"Tyreek Hill","t":"FA","p":"WR","e":"3116406","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/gg73gnfivrn80oyqwazl"},"savion-williams":{"n":"Savion Williams","t":"GB","p":"WR","e":"4431487","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/snmedlu4ra62snufe1qg"},"chris-brazzell-ii":{"n":"Chris Brazzell II","t":"CAR","p":"WR","e":"5091739","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/jdmycletwhknhs9oth1f"},"xavier-legette":{"n":"Xavier Legette","t":"CAR","p":"WR","e":"4430034","h":"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/yoyxkitrdqbkhyqncy5p"}};


async function leadStoryPayload(env) {
  const now = Date.now();
  if (_LEAD_CACHE && now - _LEAD_AT < 120000) return _LEAD_CACHE;
  let out = { ok: false, story: null, recent: [] };
  try {
    if (env.LEADS_DB) {
      const cur = await env.LEADS_DB.prepare(
        'SELECT slug, title, dek, category, players, created_at FROM lead_story'
        + ' WHERE verified = 1 AND published = 1 ORDER BY created_at DESC LIMIT 1').first();
      if (cur) {
        // A slug the run never set would produce /lead/null, so a row without one
        // is treated as no lead at all and the page keeps its own rotation.
        if (cur.slug) {
          const recent = await env.LEADS_DB.prepare(
            'SELECT slug, title, category, players, created_at FROM lead_story'
            + ' WHERE verified = 1 AND slug IS NOT NULL AND slug <> ?'
            + ' ORDER BY created_at DESC LIMIT ?').bind(cur.slug, LEAD_RECENT).all();
          out = {
            ok: true,
            story: leadRow(cur),
            recent: ((recent && recent.results) || []).map(leadRow)
          };
        }
      }
    }
  } catch (e) { out = { ok: false, story: null, recent: [], error: 'unavailable' }; }
  _LEAD_CACHE = out; _LEAD_AT = now;
  return out;
}

// ── the insights the desk has actually posted ──────────────────────────────
// runXAutoPost (§10 of HANDOFF.md) logs every successful X post to the D1
// `x_posts` table. This joins that log back against INSIGHTS_X_POOL so the
// site can carry the same rotation: every insight that goes out on X shows up
// on the site as a freshly posted story, three per weekday, without waiting
// for a drop date — and without inventing anything, since the pool rows ARE
// the drop pages' own calls. Only the three insight formats appear; the
// hand-authored bonus posts (polls, feature promos) are marketing copy, not
// site stories, and stay off.
let _WIRE_CACHE = null;
let _WIRE_AT = 0;
let _WIRE_BY_ID = null;
function wireEntry(id) {
  if (!_WIRE_BY_ID) {
    _WIRE_BY_ID = new Map();
    for (const it of INSIGHTS_X_POOL) _WIRE_BY_ID.set(it.id, it);
  }
  return _WIRE_BY_ID.get(id) || null;
}
// A pool id ends in the insight's 0-based index on its drop page
// ("auction-insights-2026-07-04-3"), and the pages anchor their calls as
// #call-1..#call-5, so the link can land on the insight itself rather than
// the top of the page. The stored url is absolute; the site links relative.
function wireHref(it) {
  let path = it.url || '';
  try { path = new URL(it.url).pathname; } catch (e) {}
  const m = /-(\d+)$/.exec(it.id || '');
  return m ? path + '#call-' + (Number(m[1]) + 1) : path;
}
async function postedInsightsPayload(env) {
  const now = Date.now();
  if (_WIRE_CACHE && now - _WIRE_AT < 300000) return _WIRE_CACHE;
  let out = { ok: false, items: [] };
  try {
    if (env.LEADS_DB) {
      const rows = await env.LEADS_DB.prepare(
        'SELECT insight_id, format, posted_at FROM x_posts'
        + " WHERE ok = 1 AND format IN ('auction','snake','bestball')"
        + ' ORDER BY posted_at DESC LIMIT 24').all();
      const items = [];
      for (const r of ((rows && rows.results) || [])) {
        const it = wireEntry(r.insight_id);
        if (!it) continue;   // a logged id the current pool no longer carries
        items.push({
          id: it.id, format: it.format, title: it.title, play: it.play || '',
          stat: it.stat || '', href: wireHref(it), date: it.date,
          postedAt: Number(r.posted_at) || 0
        });
      }
      out = { ok: true, items };
    }
  } catch (e) { out = { ok: false, items: [], error: 'unavailable' }; }
  _WIRE_CACHE = out; _WIRE_AT = now;
  return out;
}
// ── the desk's clock, in a clock a reader keeps ────────────────────────────
// The runs are scheduled in UTC and they write in UTC, so stories say things
// like "today's 11:00 UTC odds refresh". Nobody drafting reads a UTC clock.
// This site's readers are American fantasy managers whose kickoffs, waivers and
// league deadlines are all quoted in Eastern, so every clock time in a story is
// converted on the way out — once, here, so the front page, /lead and the admin
// desk cannot disagree about what time something happened.
//
// It is a filter over stored copy, not a substitute for writing it correctly:
// the Routine's prompt now tells the desk to write ET in the first place (see
// tools/lead-story-routine-prompt.md). This is what fixes the rows already in
// the table, and the safety net if a run reverts to habit.
//
// The reader's OWN zone is what the timestamp under the headline uses
// (front.html's leadStamp), and this deliberately does not: the payload is
// memoised for two minutes and served to everybody, so it gets one zone, and ET
// is the one the sport itself runs on.
const LEAD_TZ = 'America/New_York';
// Second Sunday in March to the first Sunday in November, the US rule since
// 2007. Only used if Intl has no time-zone data, which Workers does have; a
// wrong hour here would be worse than the UTC it replaced, so both paths are
// exercised by tools/test-lead-story.mjs.
function etOffsetHours(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const nth = (month, dow, n) => {
    const first = new Date(Date.UTC(y, month, 1));
    const shift = (dow - first.getUTCDay() + 7) % 7;
    return Date.UTC(y, month, 1 + shift + (n - 1) * 7, 7);   // 2am ET = 07:00 UTC
  };
  const start = nth(2, 0, 2), end = nth(10, 0, 1);
  return ms >= start && ms < end ? -4 : -5;
}
function etClock(ms) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: LEAD_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
      year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(new Date(ms));
    const get = t => (f.find(p => p.type === t) || {}).value || '';
    const h = parseInt(get('hour'), 10), min = parseInt(get('minute'), 10);
    if (!isFinite(h) || !isFinite(min)) throw new Error('no parts');
    return { h, min, ampm: (get('dayPeriod') || 'AM').toUpperCase(),
             day: `${get('year')}-${get('month')}-${get('day')}` };
  } catch (e) {
    const d = new Date(ms + etOffsetHours(ms) * 3600000);
    const h24 = d.getUTCHours();
    return { h: (h24 % 12) || 12, min: d.getUTCMinutes(), ampm: h24 < 12 ? 'AM' : 'PM',
             day: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` };
  }
}
// "11:00 UTC" -> "7:00 AM ET". The date the story was written anchors the
// conversion, because the offset is -4 or -5 depending on the season and there
// is nothing else in the sentence to date it by.
//
// An overnight time can land on the previous Eastern day (01:00 UTC is 9:00 PM
// the evening before), and prose around it — "today's 01:00 run" — would then
// read a day wrong. Those say so rather than quietly shifting.
const LEAD_UTC_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(?:(a\.?m\.?|p\.?m\.?)\s*)?(?:UTC|GMT)\b/gi;
function leadClock(text, whenMs) {
  const src = String(text == null ? '' : text);
  if (!src || !/\b(?:UTC|GMT)\b/i.test(src)) return src;
  const base = new Date(+whenMs || Date.now());
  const y = base.getUTCFullYear(), mo = base.getUTCMonth(), da = base.getUTCDate();
  return src.replace(LEAD_UTC_RE, (whole, hh, mm, ap) => {
    let h = parseInt(hh, 10);
    if (!isFinite(h) || h > 24) return whole;
    const half = String(ap || '').toLowerCase().replace(/\./g, '');
    if (half === 'pm' && h < 12) h += 12;
    if (half === 'am' && h === 12) h = 0;
    if (h > 23) return whole;
    const min = mm == null ? 0 : parseInt(mm, 10);
    if (!isFinite(min) || min > 59) return whole;
    const at = Date.UTC(y, mo, da, h, min);
    const et = etClock(at);
    // A time written without minutes keeps its shape: "11 UTC" reads "7 AM ET",
    // not "7:00 AM ET".
    const clock = (mm == null && et.min === 0) ? `${et.h}` : `${et.h}:${String(et.min).padStart(2, '0')}`;
    const shifted = et.day !== `${y}-${mo + 1}-${da}`;
    return `${clock} ${et.ampm} ET${shifted ? ' (the previous day)' : ''}`;
  });
}
// One row, trimmed to what a card needs. `body_html` is deliberately absent:
// the front page never renders it, and shipping ~30 KB of article to every
// visitor to show a headline is the kind of thing nobody notices until it is
// on the critical path of the whole site.
function leadRow(r) {
  const key = String(r.category || '').toLowerCase();
  // The run names the players its story commits to, so the front page can put
  // their faces on the lead the same way an authored story does. Slugged here
  // with the same rule tools/build-front.mjs uses, so "Kenneth Walker III" and
  // "kenneth-walker-iii" both land on the same photo.
  let ppl = [], names = [];
  try {
    const raw = JSON.parse(r.players || '[]');
    if (Array.isArray(raw)) {
      ppl = raw.map(leadSlug).filter(Boolean).slice(0, 4);
      // The names travel unslugged as well as slugged. The slugs are for
      // photographs; these are for pricing — it-league.js re-anchors every
      // dollar in the copy on the named player's price on the READER's board,
      // and it needs the name the way the story wrote it to find him. A photo
      // is not required for that, so this is not the `cast` list.
      names = raw.map(n => (typeof n === 'string' ? n.trim() : '')).filter(Boolean).slice(0, 4);
    }
  } catch (e) { ppl = []; names = []; }
  // The faces themselves ride along, because front.html's own cast only covers
  // the players the authored drop pages name and a run can name anybody on the
  // board. The page prefers its own entry when it has one and falls back to
  // these, so a story is never left with a partial row of photos.
  const cast = ppl.map(k => {
    const f = LEAD_FACES[k];
    return f ? { k, n: f.n, t: f.t, p: f.p, e: f.e, h: f.h } : null;
  }).filter(Boolean);
  return {
    slug: r.slug,
    // Clock times come out in Eastern, whatever the run wrote them in.
    title: leadClock(r.title, r.created_at),
    dek: leadClock(r.dek || '', r.created_at),
    category: LEAD_CATEGORIES[key] ? key : null,
    label: LEAD_CATEGORIES[key] || 'Insight',
    ppl,
    names,
    cast,
    createdAt: r.created_at,
    url: '/lead/' + r.slug
  };
}
function leadSlug(n) {
  return String(n || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
async function projectionsPayload(env, ctx) {
  const fresh = Date.now() - _PROJ_BLEND_AT < 300000;
  if (_PROJ_ENC && fresh) return _PROJ_ENC;
  let pool = null;
  let overlayAt = 0;
  try {
    const cached = await oddsCacheRead(env);
    if (cached && cached.overlay) { pool = blendProjections(cached.overlay); overlayAt = cached.updatedAt || 0; }
  } catch (e) { /* fall back to the committed pool */ }
  if (!pool) pool = blendProjections(null);    // committed rows, availability still applied
  // Self-healing: a missing or day-stale overlay means the 11:00 UTC cron failed or never
  // ran. Kick at most one background refresh per isolate-hour off this request; the
  // response itself never waits on the sportsbook and still serves whatever it has.
  if (ctx && Date.now() - overlayAt > 26 * 3600000 && Date.now() - _ODDS_KICK_AT > 3600000) {
    _ODDS_KICK_AT = Date.now();
    try {
      ctx.waitUntil(runOddsRefresh(env).then(r => {
        console.log('odds self-heal:', JSON.stringify(r && { ok: r.ok, matched: r.matched, error: r.error }));
        if (r && r.ok) { _PROJ_ENC = null; _PROJ_BLEND_AT = 0; }
      }).catch(e => console.error('odds self-heal failed:', e && e.message)));
    } catch (e) {}
  }
  // Same self-healing for the injury list: no live row, or one the cron has not
  // replaced in a day, means the pull failed or never ran.
  if (ctx && Date.now() - _AVAIL_LIVE_AT > 26 * 3600000 && Date.now() - _AVAIL_KICK_AT > 3600000) {
    _AVAIL_KICK_AT = Date.now();
    try {
      ctx.waitUntil(runAvailabilityRefresh(env).then(r => {
        console.log('availability self-heal:', JSON.stringify(r && { ok: r.ok, matched: r.matched, error: r.error }));
      }).catch(e => console.error('availability self-heal failed:', e && e.message)));
    } catch (e) {}
  }
  _PROJ_ENC = _xb64encode(JSON.stringify(pool), PROJ_KEY);
  _PROJ_BLEND_AT = Date.now();
  return _PROJ_ENC;
}

// ── traffic analytics ────────────────────────────────────────────────────────
// Pageviews are counted here in the worker rather than by a script tag, because
// every request already passes through it (run_worker_first) — that covers all
// ~100 static pages at once and keeps counting when a visitor blocks scripts.
// A "visitor" is a salted hash of IP + user-agent that rotates daily: no cookie,
// nothing that outlives the day, and nothing that can be walked back to a person.
// So the honest unit here is the UNIQUE DAILY USER: distinct visitors within one
// UTC day. Summed over a window that is user-days, not people, and the admin page
// says so rather than pretending otherwise.
//
// Rows carry an `internal` flag for the operator's own browsing, which would
// otherwise dominate a small site's numbers. They are recorded, not dropped, so
// the exclusion is reversible and its size is visible on /admin.
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|quora|pinterest|whatsapp|telegram|discord|slack|preview|monitor|uptime|curl|wget|python-requests|headless|lighthouse|pagespeed|gtmetrix|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baidu|applebot|gptbot|claudebot|ccbot|perplexity|bytespider|scrapy|okhttp|axios|node-fetch/i;
const ANALYTICS_DDL = [
  'CREATE TABLE IF NOT EXISTS page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL, source TEXT, country TEXT, internal INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS idx_pv_ts ON page_views(ts)',
  'CREATE INDEX IF NOT EXISTS idx_pv_day ON page_views(day)',
  'CREATE TABLE IF NOT EXISTS site_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, event TEXT NOT NULL, uid TEXT, path TEXT, props TEXT, internal INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS idx_ev_ts ON site_events(ts)',
  'CREATE INDEX IF NOT EXISTS idx_ev_name ON site_events(event, ts)',
];
// Columns added after the tables were first deployed. ADD COLUMN is the only
// migration shape this repo uses (see x_posts.est_cost): each runs on its own and
// throws a harmless "duplicate column" once it has already been applied, so the
// live tables catch up without a step anyone has to remember to run.
const ANALYTICS_MIGRATIONS = [
  'ALTER TABLE page_views ADD COLUMN internal INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE site_events ADD COLUMN internal INTEGER NOT NULL DEFAULT 0',
];
// Cached per isolate, so the DDL costs one batch on cold start and nothing after.
let __analyticsReady = false;
async function analyticsReady(env) {
  if (__analyticsReady) return true;
  if (!env.LEADS_DB) return false;
  try {
    await env.LEADS_DB.batch(ANALYTICS_DDL.map(s => env.LEADS_DB.prepare(s)));
  } catch (e) {
    // Some D1 versions refuse DDL inside a batch's transaction; one at a time
    // still gets there, and a hard failure just means no analytics this request.
    try { for (const s of ANALYTICS_DDL) await env.LEADS_DB.prepare(s).run(); } catch (e2) { return false; }
  }
  // Never batched: a migration that has already been applied throws, and one
  // throw inside a batch would take the others down with it.
  for (const s of ANALYTICS_MIGRATIONS) { try { await env.LEADS_DB.prepare(s).run(); } catch (e) {} }
  __analyticsReady = true;
  return true;
}
// The operator reading their own dashboard is not an audience. There is no stable
// id to keep a list of — a visitor hash is minted fresh every UTC day — so the
// browser carries the mark instead: unlocking /admin sets it_owner=1, and the
// "count my visits" toggle there sets it_owner=0, which is remembered so opening
// the dashboard again does not silently re-flag the browser.
const OWNER_COOKIE = 'it_owner';
function ownerFlag(request) { try { return parseCookie(request.headers.get('cookie') || '')[OWNER_COOKIE] || ''; } catch (e) { return ''; } }
const isOwnerVisit = request => ownerFlag(request) === '1';
const ownerCookie = on => OWNER_COOKIE + '=' + (on ? '1' : '0') + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (2 * 365 * 24 * 3600);
const utcDay = ts => new Date(ts).toISOString().slice(0, 10);
async function visitorHash(env, request, day) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';
  const salt = env.LEADS_EXPORT_KEY || 'iron-tuna';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(day + '|' + salt + '|' + ip + '|' + ua));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Where the visit came from: an explicit utm_source wins, then the referring
// host, then "" which the admin page reads as direct. Self-referrals (clicking
// between our own pages) are dropped so the list is arrivals, not internal hops.
function trafficSource(request, url) {
  try {
    const utm = (url.searchParams.get('utm_source') || '').trim();
    if (utm) return utm.toLowerCase().slice(0, 60);
    const r = request.headers.get('referer') || '';
    if (!r) return '';
    const h = new URL(r).hostname.replace(/^www\./, '');
    return h === url.hostname.replace(/^www\./, '') ? '' : h.slice(0, 80);
  } catch (e) { return ''; }
}
async function logPageView(env, request, url) {
  try {
    const ua = request.headers.get('user-agent') || '';
    if (!ua || BOT_RE.test(ua)) return;
    // Prefetch/prerender and framed loads aren't someone looking at the page.
    const purpose = request.headers.get('sec-purpose') || request.headers.get('purpose') || '';
    if (/prefetch|prerender/i.test(purpose)) return;
    if ((request.headers.get('sec-fetch-dest') || '') === 'iframe') return;
    const path = (url.pathname.replace(/\/+$/, '') || '/').slice(0, 160);
    if (path.startsWith('/admin')) return; // don't count yourself checking the numbers
    if (!(await analyticsReady(env))) return;
    const ts = Date.now(), day = utcDay(ts);
    await env.LEADS_DB.prepare('INSERT INTO page_views (ts, day, path, visitor, source, country, internal) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ts, day, path, await visitorHash(env, request, day), trafficSource(request, url), (request.cf && request.cf.country) || '', isOwnerVisit(request) ? 1 : 0).run();
  } catch (e) {}
}
async function logSiteEvent(env, request, raw) {
  try {
    const ua = request.headers.get('user-agent') || '';
    if (!ua || BOT_RE.test(ua)) return;
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { return; }
    const name = String(b.event || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60);
    if (!name) return;
    if (!(await analyticsReady(env))) return;
    const props = b.props && typeof b.props === 'object' ? b.props : {};
    const ts = Date.now();
    await env.LEADS_DB.prepare('INSERT INTO site_events (ts, day, event, uid, path, props, internal) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ts, utcDay(ts), name, String(b.uid || '').slice(0, 48), String(props.path || props.page || '').slice(0, 160), JSON.stringify(props).slice(0, 600), isOwnerVisit(request) ? 1 : 0).run();
  } catch (e) {}
}
// Keep the tables from growing forever; called from the daily cron.
async function pruneAnalytics(env, keepDays) {
  if (!(await analyticsReady(env))) return { pruned: false };
  const cutoff = Date.now() - keepDays * 86400000;
  const a = await env.LEADS_DB.prepare('DELETE FROM page_views WHERE ts < ?').bind(cutoff).run();
  const b = await env.LEADS_DB.prepare('DELETE FROM site_events WHERE ts < ?').bind(cutoff).run();
  return { pruned: true, keepDays, pageViews: (a.meta && a.meta.changes) || 0, events: (b.meta && b.meta.changes) || 0 };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // ?preview=<LEADS_EXPORT_KEY> on a closed in-season route: park the key in a
    // cookie and bounce to the clean URL, so the owner can walk the section
    // without re-appending the secret and without it ending up in a shared link
    // or a Referer header on the very next click.
    if (url.searchParams.has('preview') && adminOk(env, url.searchParams.get('preview'))) {
      const dest = new URL(url.toString());
      dest.searchParams.delete('preview');
      return new Response(null, { status: 302, headers: {
        'Location': dest.pathname + (dest.search || ''),
        'Set-Cookie': 'it_pd_preview=' + encodeURIComponent(env.LEADS_EXPORT_KEY) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (12 * 3600)
      } });
    }
    if (url.pathname === '/api/projections') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      if (request.headers.get('x-it-key') !== IT_KEY) return new Response('forbidden', { status: 403 });
      const ref = request.headers.get('Referer') || '';
      if (ref && !/^https?:\/\/(www\.)?irontuna\.com(\/|$)|^https?:\/\/localhost(:\d+)?(\/|$)|^https:\/\/[^/]+\.pages\.dev(\/|$)/.test(ref)) return new Response('forbidden', { status: 403 });
      const payload = await projectionsPayload(env, ctx);
      return secure(new Response(payload, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, max-age=300' } }));
    }
    // Public, read-only: the front page is a static asset and cannot hold the
    // projections key, and there is nothing paid here — this is the free column,
    // and it ships numbers the site already publishes on the cheat sheet.
    if (url.pathname === '/api/vegas-column') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      const c = corsHeaders(request.headers.get('Origin'));
      const now = Date.now();
      // Vary the cached copy by the contract the caller asked for, so an old
      // page and a new one can never be handed each other's payload.
      const want = url.searchParams.get('v') || '';
      const ck = 'v' + want;
      if (_COLUMN_CACHE && _COLUMN_KEY === ck && now - _COLUMN_AT < 900000) {
        return json(_COLUMN_CACHE, 200, { ...c, 'cache-control': 'public, max-age=900' });
      }
      let out = { ok: false, error: 'no_overlay', items: [] };
      try {
        const cached = await oddsCacheRead(env);
        if (cached && cached.overlay) {
          const tctx = await oddsCtxRead(env);
          const built = buildVegasColumn(cached.overlay, tctx);
          out = { ...built, contract: COLUMN_CONTRACT, provider: cached.provider, asOf: cached.updatedAt,
                  // The free provider prices GAMES, not players. Saying otherwise
                  // would sell a team-wide inference as a player prop, which is
                  // exactly the sloppiness this column exists to call out.
                  basis: /the-odds-api/.test(cached.provider || '') ? 'props' : 'gamelines' };
        }
      } catch (e) { out = { ok: false, error: 'unavailable', items: [] }; }
      if (out.contract == null) out.contract = COLUMN_CONTRACT;
      _COLUMN_CACHE = out; _COLUMN_AT = now; _COLUMN_KEY = ck;
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=900' });
    }
    // The site's own board, at the site's default league. /it-league.js reads
    // this so the SITE side of every price comparison is the sheet the app
    // actually shows, odds and all, rather than a static copy that stopped
    // tracking the feed. Public and cacheable: it is the same board for every
    // reader, and the numbers are already published on the cheat sheet.
    // -- the in-season data routes -----------------------------------------
    // The three boards for a horizon. Stat lines AND points at the preset, so
    // the page can re-score at another setting with no round trip and an API
    // consumer gets a finished board.
    if (url.pathname === '/api/boards') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const preset = String(url.searchParams.get('scoring') || '').toLowerCase();
      const thr = url.searchParams.get('through');
      const out = await boardsPayload(env, {
        horizon: String(url.searchParams.get('horizon') || 'week').toLowerCase(),
        position: url.searchParams.get('pos') || 'ALL',
        preset: SCORING_PRESETS[preset] ? preset : 'ppr',
        through: thr && /^1[0-8]$/.test(thr) ? parseInt(thr, 10) : null
      });
      return json(out, out.ok ? 200 : 503, { ...c, 'cache-control': 'public, max-age=300' });
    }
    // Stat lines for the rankings page, which scores them in the browser so a
    // scoring button re-orders the board with no round trip. See
    // rankingsPayload for why points are not shipped.
    if (url.pathname === '/api/rankings') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const out = await rankingsPayload(env);
      return json(out, out.ok ? 200 : 503, { ...c, 'cache-control': 'public, max-age=900' });
    }
    // One record per player per week: projections, the money, usage and
    // context in one shape. Every in-season surface reads this rather than
    // joining the four itself.
    if (url.pathname === '/api/market') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const w = url.searchParams.get('week');
      const preset = String(url.searchParams.get('scoring') || '').toLowerCase();
      // Memoised per isolate on the exact query, for as long as the edge cache
      // header below: a Sunday afternoon must not rebuild sixty records per hit.
      const mkey = [w, url.searchParams.get('type'), url.searchParams.get('pos'), url.searchParams.get('limit'), preset].join('|');
      if (_MARKET_MEMO.key === mkey && Date.now() - _MARKET_MEMO.at < 300000) {
        return json(_MARKET_MEMO.out, _MARKET_MEMO.out.ok ? 200 : 503, { ...c, 'cache-control': 'public, max-age=300' });
      }
      const out = await buildMarketRecords(env, {
        week: w && /^\d{1,2}$/.test(w) ? parseInt(w, 10) : null,
        type: (url.searchParams.get('type') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || null,
        position: url.searchParams.get('pos'),
        limit: url.searchParams.get('limit'),
        preset: SCORING_PRESETS[preset] ? preset : null
      });
      _MARKET_MEMO = { key: mkey, at: Date.now(), out };
      return json(out, out.ok ? 200 : 503, { ...c, 'cache-control': 'public, max-age=300' });
    }
    // Vegas Edge, the signals behind it, the Wednesday update, and one player.
    if (url.pathname === '/api/vegas-edge' || url.pathname === '/api/signals' || url.pathname === '/api/ros-update' || url.pathname === '/api/intel/player') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const preset = String(url.searchParams.get('scoring') || '').toLowerCase();
      const o = { preset: SCORING_PRESETS[preset] ? preset : 'ppr',
                  through: /^1[0-8]$/.test(url.searchParams.get('through') || '') ? parseInt(url.searchParams.get('through'), 10) : null };
      if (url.pathname === '/api/intel/player') {
        const name = String(url.searchParams.get('name') || '').slice(0, 80);
        const pos = String(url.searchParams.get('pos') || '').slice(0, 4);
        if (!name || !pos) return json({ ok: false, error: 'name_and_pos' }, 400, c);
        const out = await playerIntelPayload(env, name, pos, o);
        return json(out, out.ok ? 200 : 404, { ...c, 'cache-control': 'public, max-age=300' });
      }
      if (url.pathname === '/api/ros-update') {
        const out = await rosUpdatePayload(env, o);
        return json(out, out.ok ? 200 : 503, { ...c, 'cache-control': 'public, max-age=600' });
      }
      const ek = url.pathname + '|' + o.preset;
      if (_EDGE_MEMO.key === ek && Date.now() - _EDGE_MEMO.at < 300000) return json(_EDGE_MEMO.out, 200, { ...c, 'cache-control': 'public, max-age=300' });
      const week = await boardsPayload(env, { horizon: 'week', position: 'ALL', preset: o.preset });
      const sched = await scheduleCacheRead(env);
      const state = sched ? nflSeasonState(sched, Date.now()) : { ok: false };
      const curWeek = state.ok && state.week.type === 'REG' ? state.week.number : null;
      const [weekMarkets, gameMarkets, usage] = await Promise.all([
        curWeek != null && sched ? marketHistoryWeek(env, sched.season, curWeek) : {},
        marketHistoryGames(env, (state.ok ? state.games : []).map(g => g.id)),
        usageCacheRead(env)
      ]);
      const signals = detectInsights({ week: week.ok ? week : null, usage, weekMarkets, gameMarkets, state, rules: scoringRules(o.preset) });
      const out = url.pathname === '/api/signals' ? signals : buildVegasEdge(week.ok ? week : null, weekMarkets, gameMarkets, state, signals);
      _EDGE_MEMO = { key: ek, at: Date.now(), out };
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=300' });
    }
    // Line movement for one market. `subject` is the player's name as the book
    // published it, or a game id; `market` is an Iron Tuna stat key.
    if (url.pathname === '/api/market/movement') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const subject = String(url.searchParams.get('subject') || '').slice(0, 80);
      const market = String(url.searchParams.get('market') || '').slice(0, 24);
      if (!subject) return json({ ok: false, error: 'no_subject' }, 400, c);
      const out = market ? { ok: true, history: await marketHistory(env, subject, market) }
                         : { ok: true, markets: await marketHistoryAll(env, subject) };
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=300' });
    }
    // ── the NFL clock ─────────────────────────────────────────────────────────
    // What week is it, and where does every game in it stand. Every in-season
    // surface reads this ONE answer instead of deriving its own from the
    // calendar; the season block above says why a weekday rule is wrong.
    //
    //   /api/season            the current week
    //   /api/season?week=4     regular-season week 4
    //   /api/season?type=WC    a round: PRE | REG | WC | DIV | CON | SB
    //
    // A response for a week the caller named still carries the REAL current week
    // in `week`, so a page browsing Week 4 in Week 9 cannot render it as live.
    // No provider is touched here: the cron writes the schedule, this reads it
    // and runs the clock against it, which is why the upcoming / in-progress /
    // completed split stays right to the minute on a day-old row.
    if (url.pathname === '/api/season') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const rawWeek = url.searchParams.get('week');
      const rawType = url.searchParams.get('type');
      const week = rawWeek != null && /^\d{1,2}$/.test(rawWeek) ? parseInt(rawWeek, 10) : null;
      const type = rawType ? String(rawType).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
                 : (week != null ? 'REG' : '');
      const payload = await seasonPayload(env, { week, type });
      // A minute of edge cache: long enough that a Sunday afternoon does not
      // become a D1 read per visitor, short enough that a game going final is
      // visible before anyone reloads twice.
      return json(payload, payload.ok ? 200 : 503, { ...c, 'cache-control': 'public, max-age=60' });
    }
    if (url.pathname === '/api/board') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      const c = corsHeaders(request.headers.get('Origin'));
      let out;
      try { out = await boardPayload(env); }
      catch (e) { out = { ok: false, error: 'unavailable', contract: BOARD_CONTRACT, players: [] }; }
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=900' });
    }
    // The same board, asked about one player, for his card at /player/<slug>.
    // Public and read-only for the same reasons the column is: it ships numbers
    // the cheat sheet already publishes, and the card is a static asset that
    // cannot hold the projections key.
    //
    // Why a per-player query rather than one payload of the whole board: the
    // full index is ~400 rows of stat lines, and a card needs one of them. The
    // board is built once per isolate and every card slices it, so the cost of
    // the extra URLs is a map lookup, not a rebuild and not a D1 read.
    if (url.pathname === '/api/player-odds') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      const c = corsHeaders(request.headers.get('Origin'));
      const now = Date.now();
      const name = (url.searchParams.get('name') || '').slice(0, 80);
      const pos = (url.searchParams.get('pos') || '').slice(0, 4).toUpperCase();
      let out = { ok: false, error: 'no_overlay', player: null };
      try {
        // One board per isolate for a quarter of an hour, exactly like the
        // column's payload — the odds themselves only move once a day.
        if (!_PODDS_BOARD || now - _PODDS_BOARD_AT >= 900000) {
          const cached = await oddsCacheRead(env);
          if (cached && cached.overlay) {
            const board = buildVegasBoard(cached.overlay, await oddsCtxRead(env));
            _PODDS_BOARD = { board, digest: board.ok ? buildVegasDigest(board) : null,
                             provider: cached.provider, asOf: cached.updatedAt };
          } else {
            _PODDS_BOARD = { board: null };
          }
          _PODDS_BOARD_AT = now;
        }
        if (_PODDS_BOARD.board && _PODDS_BOARD.board.ok) {
          const built = playerOddsFrom(_PODDS_BOARD.board, _PODDS_BOARD.digest, name, pos);
          out = { ...built, contract: PODDS_CONTRACT, provider: _PODDS_BOARD.provider,
                  asOf: _PODDS_BOARD.asOf,
                  // Same honesty constraint as the column: the free provider
                  // prices GAMES, and a card must not sell that as a prop.
                  basis: /the-odds-api/.test(_PODDS_BOARD.provider || '') ? 'props' : 'gamelines' };
        }
      } catch (e) { out = { ok: false, error: 'unavailable', player: null }; }
      if (out.contract == null) out.contract = PODDS_CONTRACT;
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=900' });
    }
    // The front page's lead, and the archive behind it. Two minutes of cache:
    // the story only turns over every three hours, but a stale lead for two
    // minutes after a run publishes is the whole cost of not hitting D1 on
    // every page view.
    if (url.pathname === '/api/lead-story') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      const c = corsHeaders(request.headers.get('Origin'));
      const out = await leadStoryPayload(env);
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=120' });
    }
    // The insights the desk has posted to X, newest first, joined back to
    // their drop pages. Five minutes of cache: at most three land per weekday
    // (13:00 / 16:00 / 19:00 UTC), so this turns over slowly.
    if (url.pathname === '/api/posted-insights') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      const c = corsHeaders(request.headers.get('Origin'));
      const out = await postedInsightsPayload(env);
      return json(out, 200, { ...c, 'cache-control': 'public, max-age=300' });
    }
    // The full article, by slug. Kept separate from /api/lead-story so the front
    // page never pays for a body it does not show.
    if (url.pathname === '/api/lead-story/body') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      const c = corsHeaders(request.headers.get('Origin'));
      const want = (url.searchParams.get('slug') || '').trim();
      try {
        if (!env.LEADS_DB) return json({ ok: false, error: 'unavailable' }, 200, c);
        // No slug means "whatever is the lead right now", which is what /lead
        // without a slug asks for.
        const row = want
          ? await env.LEADS_DB.prepare(
              'SELECT slug, title, dek, category, players, body_html, method, sources, created_at'
              + ' FROM lead_story WHERE slug = ? AND verified = 1').bind(want).first()
          : await env.LEADS_DB.prepare(
              'SELECT slug, title, dek, category, players, body_html, method, sources, created_at'
              + ' FROM lead_story WHERE verified = 1 AND published = 1'
              + ' ORDER BY created_at DESC LIMIT 1').first();
        if (!row) return json({ ok: false, error: 'not_found' }, 404, c);
        let sources = [];
        try { sources = JSON.parse(row.sources || '[]'); } catch (e) { sources = []; }
        return json({
          ok: true,
          story: { ...leadRow(row), body: leadClock(row.body_html || '', row.created_at),
                   method: leadClock(row.method || '', row.created_at),
                   sources: (Array.isArray(sources) ? sources : []).map(x => (x && typeof x === 'object'
                     ? { ...x, detail: leadClock(x.detail || '', row.created_at) } : x)) }
        }, 200, { ...c, 'cache-control': 'public, max-age=120' });
      } catch (e) { return json({ ok: false, error: 'unavailable' }, 200, c); }
    }
    if (url.pathname === '/api/insights') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      if (request.headers.get('x-it-key') !== IT_KEY) return new Response('forbidden', { status: 403 });
      const ref = request.headers.get('Referer') || '';
      if (ref && !/^https?:\/\/(www\.)?irontuna\.com(\/|$)|^https?:\/\/localhost(:\d+)?(\/|$)|^https:\/\/[^/]+\.pages\.dev(\/|$)/.test(ref)) return new Response('forbidden', { status: 403 });
      // Paid content: the page key and referer are both public (shipped in the HTML), so
      // entitlement must be enforced here — require a verified-paid session, same as /api/auth/me.
      const so = env.AUTH_SECRET ? await readToken(env.AUTH_SECRET, parseCookie(request.headers.get('Cookie'))['it_sess']) : null;
      if (!so || so.t !== 'sess' || !(await isEntitled(env, so.e))) return new Response('unauthorized', { status: 401 });
      if (env.LEADS_DB && so.sid) { try { if (!(await env.LEADS_DB.prepare('SELECT 1 FROM sessions WHERE id=?').bind(so.sid).first())) return new Response('unauthorized', { status: 401 }); } catch (e) {} }
      if (!_INS_ENC) _INS_ENC = _xb64encode(JSON.stringify(INSIGHTS_PREMIUM), PROJ_KEY);
      return secure(new Response(_INS_ENC, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, max-age=300' } }));
    }
    if (url.pathname === '/api/insights-vault') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ ok: false }, 405, c);
      if (await rl(env, request, 'vault', 30, 600)) return json({ ok: false, error: 'rate' }, 429, c);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const email = (body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid' }, 400, c);
      if (env.LEAD_WEBHOOK) {
        try { await fetch(env.LEAD_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, source: 'insights-vault', type: 'lead', ts: Date.now() }) }); } catch (e) {}
      }
      await saveContact(env, { email: email, phone: '', source: 'insights-vault', type: 'lead', ref: '', path: '/insights-vault' });
      return json({ ok: true, insights: INSIGHTS_VAULT }, 200, c);
    }
    // ── the post-draft waiting list ────────────────────────────────────────────
    // Everything under /post-draft is built but not open (POST_DRAFT_OPEN below).
    // The gate trades an email for notice-plus-free-access when it does open,
    // which is the same bargain /insights-vault strikes and reuses its plumbing:
    // one contacts row, the optional lead webhook, and the existing unsubscribe
    // path. Nothing here grants access — there is nothing to grant yet — so it
    // deliberately does NOT set an entitlement or a cookie.
    if (url.pathname === '/api/post-draft-notify') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ ok: false }, 405, c);
      if (await rl(env, request, 'postdraft', 30, 600)) return json({ ok: false, error: 'rate' }, 429, c);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const email = (body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid' }, 400, c);
      // `tool` records WHICH locked page they came from, so the launch email can
      // lead with the thing they actually wanted rather than a generic list.
      const tool = String(body.tool || 'post-draft').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'post-draft';
      if (env.LEAD_WEBHOOK) {
        try { await fetch(env.LEAD_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, source: 'post-draft:' + tool, type: 'lead', ts: Date.now() }) }); } catch (e) {}
      }
      await saveContact(env, { email: email, phone: '', source: 'post-draft:' + tool, type: 'lead', ref: '', path: '/' + tool });
      return json({ ok: true, open: POST_DRAFT_OPEN(env) }, 200, c);
    }
    // ── the FAAB advisor's player index ───────────────────────────────────────
    // Sleeper's rosters and transactions reference player_id, so the advisor has
    // to resolve ids to names before it can price anything. The only file that
    // maps them is /v1/players/nfl, which is ~5MB — far too much to hand a phone
    // on a Tuesday morning. The worker takes that hit once every six hours at the
    // edge and ships a trimmed index instead: fantasy position, on a roster,
    // active, four fields each.
    //
    // Note this is keyed by ID where /api/live is keyed by NAME. They answer
    // different questions (who is this id / is this named player hurt) and the
    // callers are unrelated, so they are two caches rather than one union.
    if (url.pathname === '/api/faab/players') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      try {
        const cache = caches.default;
        const key = new Request(url.origin + '/api/faab/players?v=1');
        const hit = await cache.match(key);
        if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(c)) r.headers.set(k, v); return r; }
        const up = await fetch('https://api.sleeper.app/v1/players/nfl', { cf: { cacheTtl: 21600, cacheEverything: true } });
        if (!up.ok) return json({ updated: Date.now(), players: {} }, 200, c);
        const all = await up.json();
        const FANT = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
        const out = {};
        for (const id in all) {
          const p = all[id];
          if (!p || !FANT.has(p.position)) continue;
          // A team defence has no name fields; its id IS the team abbreviation.
          const name = p.position === 'DEF'
            ? ((p.team || id) + ' DEF')
            : (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
          if (!name || !p.team) continue;
          out[id] = [name, p.position, p.team, p.injury_status || ''];
        }
        const body = JSON.stringify({ updated: Date.now(), players: out });
        const store = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } });
        await cache.put(key, store.clone());
        const r = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } });
        for (const [k, v] of Object.entries(c)) r.headers.set(k, v);
        return r;
      } catch (e) { return json({ updated: Date.now(), players: {}, error: String(e).slice(0, 80) }, 200, c); }
    }
    if (url.pathname === '/api/live') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      try {
        const cache = caches.default;
        const key = new Request(url.origin + '/api/live?v=2');
        const hit = await cache.match(key);
        if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(c)) r.headers.set(k, v); return r; }
        const up = await fetch('https://api.sleeper.app/v1/players/nfl', { cf: { cacheTtl: 21600, cacheEverything: true } });
        if (!up.ok) return json({ updated: Date.now(), players: {} }, 200, c);
        const all = await up.json();
        const FANT = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
        const out = {};
        for (const id in all) {
          const p = all[id];
          if (!p || !FANT.has(p.position)) continue;
          const name = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
          if (!name) continue;
          const REAL = new Set(['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus', 'Suspended', 'COV', 'NFI', 'DNR']);
          const injRaw = p.injury_status || null;
          const inj = (injRaw && REAL.has(injRaw)) ? injRaw : null;
          const team = p.team || null;
          if (!inj && !team) continue;
          out[name] = { t: team, i: inj, s: p.status || null };
        }
        const body = JSON.stringify({ updated: Date.now(), players: out });
        const store = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } });
        await cache.put(key, store.clone());
        const r = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } });
        for (const [k, v] of Object.entries(c)) r.headers.set(k, v);
        return r;
      } catch (e) { return json({ updated: Date.now(), players: {}, error: String(e) }, 200, c); }
    }
    if (url.pathname === '/api/lead') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ ok: false }, 405, c);
      if (await rl(env, request, 'lead', 40, 600)) return json({ ok: false, error: 'rate' }, 429, c);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const email = (body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid' }, 400, c);
      if (env.LEAD_WEBHOOK) {
        try { await fetch(env.LEAD_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, source: body.source || 'cheatsheet', type: body.type || 'lead', code: body.code || null, scoring: body.scoring || null, ts: Date.now() }) }); } catch (e) {}
      }
      await saveContact(env, { email: email, phone: String(body.phone || '').slice(0, 40), source: body.source || 'cheatsheet', type: body.type || 'lead', ref: body.code || '', path: '' });
      return json({ ok: true, stored: !!env.LEAD_WEBHOOK || !!env.LEADS_DB }, 200, c);
    }
    if (url.pathname === '/api/contact') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ ok: false }, 405, c);
      if (await rl(env, request, 'contact', 12, 600)) return json({ ok: false, error: 'rate' }, 429, c);
      let b = {}; try { b = await request.json(); } catch (e) {}
      if (b.company) return json({ ok: true }, 200, c); // honeypot: bots fill this hidden field; pretend success
      const email = (b.email || '').trim().toLowerCase();
      const name = String(b.name || '').trim().slice(0, 120);
      const message = String(b.message || '').trim().slice(0, 4000);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400, c);
      if (message.length < 5) return json({ ok: false, error: 'empty' }, 400, c);
      if (!env.RESEND_API_KEY) return json({ ok: false, error: 'unconfigured' }, 503, c);
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const to = env.SUPPORT_TO || 'ken@irontuna.com';
      const from = env.CONTACT_FROM || env.EMAIL_FROM || 'Iron Tuna <login@irontuna.com>';
      const html = '<div style="font-family:system-ui,Arial;max-width:560px"><h2 style="color:#0b1117;margin:0 0 12px">New Iron Tuna support message</h2>'
        + '<p style="margin:0 0 4px"><b>From:</b> ' + esc(name || '(no name)') + ' &lt;' + esc(email) + '&gt;</p>'
        + '<hr style="border:none;border-top:1px solid #ddd;margin:14px 0"/>'
        + '<div style="white-space:pre-wrap;color:#1a1a1a;font-size:15px;line-height:1.55">' + esc(message) + '</div></div>';
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ from: from, to: to, reply_to: email, subject: 'Iron Tuna support — ' + (name || email), html: html })
        });
        if (!r.ok) return json({ ok: false, error: 'send' }, 502, c);
      } catch (e) { return json({ ok: false, error: 'send' }, 502, c); }
      return json({ ok: true }, 200, c);
    }
    if (url.pathname === '/api/claim-code') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ ok: false }, 405, c);
      if (await rl(env, request, 'claim', 20, 600)) return json({ ok: false, error: 'rate' }, 429, c);
      let b = {}; try { b = await request.json(); } catch (e) {}
      const email = (b.email || '').trim().toLowerCase();
      const phone = String(b.phone || '').slice(0, 40);
      const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
      const password = String(b.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400, c);
      if (code.length < 4) return json({ ok: false, error: 'invalid_code' }, 400, c);
      if (!env.LEADS_DB) return json({ ok: true, code: code }, 200, c);
      try {
        await env.LEADS_DB.prepare('INSERT OR IGNORE INTO codes (code, email, phone, created_at) VALUES (?, ?, ?, ?)').bind(code, email, phone, Date.now()).run();
        const row = await env.LEADS_DB.prepare('SELECT email FROM codes WHERE code = ?').bind(code).first();
        if (!row || (row.email || '').toLowerCase() !== email) return json({ ok: false, taken: true }, 200, c);
        await env.LEADS_DB.prepare('UPDATE codes SET phone = ? WHERE code = ?').bind(phone, code).run();
        if (password && password.length >= 4 && env.AUTH_SECRET) { const ph = await hmacSign(env.AUTH_SECRET, code + ':' + password); await env.LEADS_DB.prepare('UPDATE codes SET pass_hash = ? WHERE code = ?').bind(ph, code).run(); }
        return json({ ok: true, code: code }, 200, c);
      } catch (e) { return json({ ok: true, code: code }, 200, c); }
    }
    if (url.pathname === '/api/affiliate-stats' && request.method === 'POST') {
      const c = corsHeaders(request.headers.get('Origin'));
      let b = {}; try { b = await request.json(); } catch (e) {}
      const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
      const password = String(b.password || '');
      if (!code || !password || !env.LEADS_DB || !env.AUTH_SECRET) return json({ ok: false, error: 'bad_login' }, 401, c);
      try {
        const row = await env.LEADS_DB.prepare('SELECT email, phone, pass_hash, created_at FROM codes WHERE code = ?').bind(code).first();
        if (!row || !row.pass_hash) return json({ ok: false, error: 'bad_login' }, 401, c);
        const ph = await hmacSign(env.AUTH_SECRET, code + ':' + password);
        if (!timingSafeEq(ph, row.pass_hash)) return json({ ok: false, error: 'bad_login' }, 401, c);
        // 'purchase' contacts are written at checkout START (before payment) — only count
        // ones that actually paid, i.e. have an entitlements row, or abandoned checkouts
        // inflate the affiliate's owed total and leak non-buyer emails.
        const purchases = ((await env.LEADS_DB.prepare("SELECT c.email AS email, MIN(c.created_at) AS created_at FROM contacts c JOIN entitlements e ON e.email = lower(c.email) WHERE c.ref = ? AND c.type = 'purchase' GROUP BY lower(c.email) ORDER BY created_at DESC").bind(code).all()).results) || [];
        const lc = await env.LEADS_DB.prepare("SELECT count(*) AS n FROM contacts WHERE ref = ? AND type != 'purchase' AND type != 'referrer'").bind(code).first();
        const mask = e => { const s = String(e || ''); const at = s.indexOf('@'); return at < 1 ? s : s[0] + '***' + s.slice(at); };
        return json({ ok: true, code: code, email: row.email, phone: row.phone, since: row.created_at, purchases: purchases.map(p => ({ email: mask(p.email), date: new Date(p.created_at || 0).toISOString().slice(0, 10) })), purchaseCount: purchases.length, owed: purchases.length * 3, clicks: (lc && lc.n) || 0 }, 200, c);
      } catch (e) { return json({ ok: false, error: 'server' }, 500, c); }
    }
    if (url.pathname === '/api/auth/request' && request.method === 'POST') {
      const c = corsHeaders(request.headers.get('Origin'));
      let b = {}; try { b = await request.json(); } catch (e) {}
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: true }, 200, c);
      if (env.RATE_KV) { const k = 'mlreq:' + email; const n = parseInt(await env.RATE_KV.get(k) || '0', 10); if (n >= 5) return json({ ok: true }, 200, c); await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 86400 }); }
      if (env.AUTH_SECRET && await isEntitled(env, email)) {
        const nonce = crypto.randomUUID();
        if (env.RATE_KV) await env.RATE_KV.put('mln:' + nonce, '1', { expirationTtl: 900 });
        const token = await makeToken(env.AUTH_SECRET, { e: email, n: nonce, t: 'magic', exp: Date.now() + 15 * 60 * 1000 });
        await sendLoginEmail(env, email, url.origin + '/api/auth/verify?token=' + encodeURIComponent(token));
      }
      return json({ ok: true }, 200, c);
    }
    if (url.pathname === '/api/auth/verify') {
      const o = env.AUTH_SECRET ? await readToken(env.AUTH_SECRET, url.searchParams.get('token') || '') : null;
      if (!o || o.t !== 'magic') return Response.redirect(url.origin + '/?login=invalid', 302);
      if (env.RATE_KV) { if (!(await env.RATE_KV.get('mln:' + o.n))) return Response.redirect(url.origin + '/?login=used', 302); await env.RATE_KV.delete('mln:' + o.n); }
      const email = o.e, now = Date.now(), sid = crypto.randomUUID(), cap = parseInt(env.MAX_DEVICES || '3', 10);
      if (env.LEADS_DB) {
        try {
          const rows = ((await env.LEADS_DB.prepare('SELECT id FROM sessions WHERE email=? ORDER BY last_seen ASC').bind(email).all()).results) || [];
          for (let i = 0; i < rows.length - (cap - 1); i++) await env.LEADS_DB.prepare('DELETE FROM sessions WHERE id=?').bind(rows[i].id).run();
          await env.LEADS_DB.prepare('INSERT INTO sessions (id,email,created_at,last_seen,ua) VALUES (?,?,?,?,?)').bind(sid, email, now, now, (request.headers.get('user-agent') || '').slice(0, 200)).run();
        } catch (e) {}
      }
      const sess = await makeToken(env.AUTH_SECRET, { sid: sid, e: email, t: 'sess', exp: now + 90 * 24 * 3600 * 1000 });
      return new Response(null, { status: 302, headers: { 'Location': url.origin + '/?restored=1', 'Set-Cookie': 'it_sess=' + sess + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (90 * 24 * 3600) } });
    }
    if (url.pathname === '/api/auth/me') {
      const c = corsHeaders(request.headers.get('Origin'));
      const o = env.AUTH_SECRET ? await readToken(env.AUTH_SECRET, parseCookie(request.headers.get('Cookie'))['it_sess']) : null;
      if (!o || o.t !== 'sess') return json({ entitled: false }, 200, c);
      if (env.LEADS_DB) { try { const row = await env.LEADS_DB.prepare('SELECT id FROM sessions WHERE id=?').bind(o.sid).first(); if (!row) return json({ entitled: false }, 200, c); await env.LEADS_DB.prepare('UPDATE sessions SET last_seen=? WHERE id=?').bind(Date.now(), o.sid).run(); } catch (e) {} }
      return json({ entitled: await isEntitled(env, o.e), email: o.e, product: 'bundle' }, 200, c);
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const c = corsHeaders(request.headers.get('Origin'));
      const o = env.AUTH_SECRET ? await readToken(env.AUTH_SECRET, parseCookie(request.headers.get('Cookie'))['it_sess']) : null;
      if (o && o.sid && env.LEADS_DB) { try { await env.LEADS_DB.prepare('DELETE FROM sessions WHERE id=?').bind(o.sid).run(); } catch (e) {} }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...c, 'content-type': 'application/json', 'Set-Cookie': 'it_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
    }
    if (url.pathname === '/api/leads/export') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const key = url.searchParams.get('key') || '';
      if (!adminOk(env, key)) return new Response('Forbidden', { status: 403 });
      if (!env.LEADS_DB) return new Response('No database bound (LEADS_DB)', { status: 500 });
      try {
        const q = await env.LEADS_DB.prepare('SELECT email, phone, source, type, ref, created_at FROM contacts ORDER BY created_at DESC').all();
        const rows = (q && q.results) || [];
        const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const out = [['email', 'phone', 'source', 'type', 'ref', 'date'].map(esc).join(',')];
        rows.forEach(r => { const dt = new Date(r.created_at || 0).toISOString(); out.push([r.email, r.phone, r.source, r.type, r.ref, dt].map(esc).join(',')); });
        return new Response(out.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="iron-tuna-leads.csv"' } });
      } catch (e) { return new Response('Error: ' + String(e), { status: 500 }); }
    }
    if (url.pathname === '/api/affiliate-reconcile') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const key = url.searchParams.get('key') || '';
      if (!adminOk(env, key)) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'no_stripe_key' }, 500, c);
      const auth = { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY };
      try {
        // Source of truth = Stripe (the actual money). Page through paid checkout sessions
        // that carry a referral code (metadata.ref or client_reference_id), then reconcile vs D1.
        const byCode = {}; let starting = '', pages = 0, capped = false, totalPaid = 0;
        while (true) {
          if (pages >= 25) { capped = true; break; }
          pages++;
          const u = 'https://api.stripe.com/v1/checkout/sessions?limit=100' + (starting ? '&starting_after=' + encodeURIComponent(starting) : '');
          const r = await fetch(u, { headers: auth });
          const j = await r.json().catch(() => ({}));
          if (j && j.error) return json({ ok: false, error: 'stripe', detail: (j.error.message || '').slice(0, 200) }, 502, c);
          const data = (j && j.data) || [];
          for (const s of data) {
            if (s.payment_status !== 'paid') continue;
            const ref = String((s.metadata && s.metadata.ref) || s.client_reference_id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!ref) continue;
            totalPaid++;
            const email = (s.customer_details && s.customer_details.email) || s.customer_email || '';
            const rec = byCode[ref] || (byCode[ref] = { code: ref, stripeCount: 0, revenueCents: 0, sales: [] });
            rec.stripeCount++; rec.revenueCents += (s.amount_total || 0);
            rec.sales.push({ email: email, date: new Date((s.created || 0) * 1000).toISOString().slice(0, 10), amount: (s.amount_total || 0) / 100, session: s.id });
          }
          if (j && j.has_more && data.length) starting = data[data.length - 1].id; else break;
        }
        const codes = Object.keys(byCode);
        if (env.LEADS_DB) {
          let omap = {};
          try { const owners = ((await env.LEADS_DB.prepare('SELECT code, email FROM codes').all()).results) || []; owners.forEach(o => { omap[String(o.code || '').toUpperCase()] = o.email; }); } catch (e) {}
          for (const code of codes) {
            byCode[code].ownerEmail = omap[code] || null;
            try { const d = await env.LEADS_DB.prepare("SELECT count(*) AS n FROM contacts WHERE ref=? AND type='purchase'").bind(code).first(); byCode[code].d1Count = (d && d.n) || 0; } catch (e) { byCode[code].d1Count = null; }
          }
        }
        const list = codes.map(k => { const r = byCode[k]; return { code: r.code, ownerEmail: r.ownerEmail || null, stripeCount: r.stripeCount, d1Count: (r.d1Count == null ? null : r.d1Count), mismatch: (r.d1Count != null && r.d1Count !== r.stripeCount), revenue: r.revenueCents / 100, owed: r.stripeCount * 3, sales: r.sales.sort((a, b) => a.date < b.date ? 1 : -1) }; }).sort((a, b) => b.owed - a.owed);
        const totalOwed = list.reduce((s, r) => s + r.owed, 0);
        return json({ ok: true, source: 'stripe', generatedAt: Date.now(), pagesScanned: pages, capped: capped, totalPaidReferredSales: totalPaid, totalOwed: totalOwed, affiliates: list }, 200, c);
      } catch (e) { return json({ ok: false, error: 'server', detail: String(e).slice(0, 200) }, 500, c); }
    }
    if (url.pathname === '/api/indexnow-submit') {
      // Admin-gated IndexNow ping: notifies Bing/Yandex of every URL in the sitemap so
      // updates (e.g. daily auction-watch posts) get crawled within minutes. Key file is
      // served at /<key>.txt. Re-run after a content deploy by visiting this URL with ?key=.
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      const key = url.searchParams.get('key') || '';
      if (!adminOk(env, key)) return json({ ok: false, error: 'forbidden' }, 403, c);
      const INKEY = 'cfa001a08a37e330879014846e73cbbd';
      try {
        const sm = await env.ASSETS.fetch(new Request(new URL('/sitemap.xml', url).toString()));
        const xml = await sm.text();
        const urls = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map(m => m.replace(/<\/?loc>/g, '').trim()).filter(Boolean);
        if (!urls.length) return json({ ok: false, error: 'no_urls' }, 500, c);
        const r = await fetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host: 'irontuna.com', key: INKEY, keyLocation: 'https://irontuna.com/' + INKEY + '.txt', urlList: urls })
        });
        return json({ ok: r.ok, status: r.status, submitted: urls.length, urls: urls }, 200, c);
      } catch (e) { return json({ ok: false, error: 'server', detail: String(e).slice(0, 200) }, 500, c); }
    }
    if (url.pathname === '/api/unsubscribe') {
      const email = (url.searchParams.get('e') || '').trim().toLowerCase();
      const t = url.searchParams.get('t') || '';
      const ok = !!email && !!env.AUTH_SECRET && timingSafeEq(t, await hmacSign(env.AUTH_SECRET, 'unsub:' + email));
      if (ok && env.LEADS_DB) { try { await env.LEADS_DB.prepare('INSERT OR IGNORE INTO unsubscribes (email, created_at) VALUES (?, ?)').bind(email, Date.now()).run(); } catch (e) {} }
      const msg = ok ? 'You’re unsubscribed. You won’t receive marketing emails from Iron Tuna.' : 'This unsubscribe link is invalid or expired.';
      return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe — Iron Tuna</title><div style="font-family:system-ui,Arial;max-width:480px;margin:64px auto;padding:0 22px;text-align:center;color:#1a2129"><h2>' + (ok ? 'Done' : 'Hmm') + '</h2><p style="color:#566">' + msg + '</p><p><a href="https://irontuna.com/" style="color:#0b9">Back to Iron Tuna</a></p></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/api/campaign-send' && request.method === 'POST') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.RESEND_API_KEY || !env.MAIL_ADDRESS) return json({ ok: false, error: 'not_configured', need: 'Set RESEND_API_KEY + MAIL_ADDRESS (a real physical postal address, required by CAN-SPAM) before sending.' }, 400, c);
      let b = {}; try { b = await request.json(); } catch (e) {}
      const camp = CAMPAIGN_NURTURE;
      if (b.mode === 'test') {
        const to = String(b.test || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: false, error: 'bad_test_email' }, 400, c);
        const r = await sendCampaignOne(env, url.origin, to, camp.subject, camp.inner);
        return json({ ok: !!r.ok, result: r }, 200, c);
      }
      if (b.mode === 'all') {
        if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
        const offset = Math.max(0, parseInt(b.offset || '0', 10) || 0);
        const LIMIT = 40; // stay under the Workers subrequest cap; paginate via nextOffset
        const rows = ((await env.LEADS_DB.prepare("SELECT DISTINCT email FROM contacts WHERE type='lead' AND email != '' ORDER BY email LIMIT ? OFFSET ?").bind(LIMIT, offset).all()).results) || [];
        let sent = 0, skipped = 0;
        for (const row of rows) { const r = await sendCampaignOne(env, url.origin, row.email, camp.subject, camp.inner); if (r && r.ok) sent++; else skipped++; }
        return json({ ok: true, batch: rows.length, sent, skipped, nextOffset: rows.length === LIMIT ? offset + LIMIT : null }, 200, c);
      }
      return json({ ok: false, error: 'specify mode:"test" (with test:email) or mode:"all" (with optional offset)' }, 400, c);
    }
    // Comp or pull paid access for one address, from a URL — the alternative is a
    // wrangler d1 command, which cannot be run from a phone and is the wrong shape
    // for something done repeatedly. Same LEADS_EXPORT_KEY gate as every other
    // admin route.
    //
    // GET, matching /api/admin/x-post-now and /api/admin/x-delete, so it works
    // from a browser address bar. Both directions are reversible: grant is undone
    // by revoke, and revoke by grant (the person signs in again), so neither
    // warrants a confirmation step that would defeat the point.
    if (url.pathname === '/api/admin/grant' || url.pathname === '/api/admin/revoke') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
      const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400, c);
      const revoking = url.pathname.endsWith('revoke');
      const comped = COMPED_EMAILS.includes(email);
      let hadRow = false;
      try { hadRow = !!(await env.LEADS_DB.prepare('SELECT 1 FROM entitlements WHERE email=?').bind(email).first()); } catch (e) {}
      let sessionsCleared = 0;
      try {
        if (revoking) {
          // Counted first, then delegated: revokeEntitlement is the one definition
          // of what revoking means (entitlement + every session, so no live cookie
          // survives on a device). Re-implementing those deletes here would drift
          // the moment a third cleanup step is added there.
          const n = await env.LEADS_DB.prepare('SELECT COUNT(*) AS c FROM sessions WHERE email=?').bind(email).first();
          sessionsCleared = (n && n.c) || 0;
          await revokeEntitlement(env, email);
        } else {
          await grantEntitlement(env, email);
        }
      } catch (e) {
        return json({ ok: false, error: 'db_failed', detail: (e && e.message) || 'failed' }, 500, c);
      }
      const entitled = await isEntitled(env, email);
      return json({
        ok: true,
        action: revoking ? 'revoke' : 'grant',
        email,
        entitled,
        changed: revoking ? hadRow : !hadRow,
        // Say plainly when the request did not do what it looks like it did.
        note: comped
          ? (revoking
              ? 'STILL HAS ACCESS: this address is in COMPED_EMAILS in _worker.js. Remove it there and redeploy to fully revoke.'
              : 'Already comped in code (COMPED_EMAILS); the database row is redundant but harmless.')
          : revoking
            ? (hadRow ? 'Access removed and signed out everywhere.' : 'No entitlement row existed; nothing to remove.')
            : (hadRow ? 'Already had access; row refreshed.' : 'Access granted.'),
        sessionsCleared,
        signIn: revoking ? undefined : 'https://irontuna.com/auctiondraft?signin=1'
      }, 200, c);
    }
    // Comp an address AND send it the link that turns access on, in one request.
    // /api/admin/grant leaves a second step to a human — tell the person to go to
    // /auctiondraft?signin=1 and ask for a link — and that step is exactly where
    // the flow breaks: /api/auth/request answers ok:true whether or not it sent
    // anything, so a typo'd address, an unentitled one and a working one all look
    // identical from the outside. Here the grant lands first, then this route
    // mints the magic link itself and says plainly whether the send succeeded.
    //
    // The link is returned either way, so it can be pasted into a DM when email
    // is not the channel (send=0) or when Resend refuses. Same LEADS_EXPORT_KEY
    // gate and same GET shape as every other admin route, so it still works from
    // a phone's address bar; /admin drives it from a form.
    if (url.pathname === '/api/admin/comp') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400, c);
      // Without AUTH_SECRET there is no signed link to send, and granting alone
      // would report success for a request that cannot do what it says.
      if (!env.AUTH_SECRET) return json({ ok: false, error: 'no_auth_secret', note: 'AUTH_SECRET is not set, so no sign-in link can be signed. Set it, or use /api/admin/grant and have them sign in themselves.' }, 500, c);
      const rawDays = url.searchParams.get('days');
      const days = (rawDays === null || rawDays === '') ? 14 : Number(rawDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) return json({ ok: false, error: 'bad_days', note: 'days must be a whole number from 1 to 90.' }, 400, c);
      const comped = COMPED_EMAILS.includes(email);
      if (!env.LEADS_DB && !comped) return json({ ok: false, error: 'no_db' }, 500, c);

      let hadRow = false;
      if (env.LEADS_DB) { try { hadRow = !!(await env.LEADS_DB.prepare('SELECT 1 FROM entitlements WHERE email=?').bind(email).first()); } catch (e) {} }
      await grantEntitlement(env, email);
      // grantEntitlement swallows its own errors, so the write is confirmed by
      // reading access back rather than by assuming it took. Sending a link to
      // an address that is not entitled would sign them in to the free site.
      if (!(await isEntitled(env, email))) return json({ ok: false, error: 'grant_failed', note: 'The entitlement did not stick, so no link was sent.' }, 500, c);

      const nonce = crypto.randomUUID();
      const ttlSec = days * 86400;
      // /api/auth/verify only enforces single use when RATE_KV is bound, and it
      // is the same env — so when it IS bound this put has to succeed, or the
      // link is dead on arrival ("already used") instead of merely unguarded.
      if (env.RATE_KV) {
        try { await env.RATE_KV.put('mln:' + nonce, '1', { expirationTtl: ttlSec }); }
        catch (e) { return json({ ok: false, error: 'link_store_failed', note: 'Access was granted, but the one-time link could not be registered, so nothing was sent. Retry, or send them to /auctiondraft?signin=1.' }, 500, c); }
      }
      const expires = Date.now() + ttlSec * 1000;
      const token = await makeToken(env.AUTH_SECRET, { e: email, n: nonce, t: 'magic', exp: expires });
      const link = url.origin + '/api/auth/verify?token=' + encodeURIComponent(token);

      const send = url.searchParams.get('send') !== '0';
      let sent = false, emailError = null;
      if (send) { const r = await sendCompEmail(env, email, link, days); sent = r.sent; emailError = r.error; }

      return json({
        ok: true,
        email,
        entitled: true,
        changed: !hadRow,
        sent,
        emailError,
        link,
        expiresAt: new Date(expires).toISOString(),
        days,
        // Say what actually happened, including the two cases that read as
        // success and are not: nothing was sent, or the send was refused.
        note: (comped ? 'This address is comped in code (COMPED_EMAILS), so it already had access. ' : hadRow ? 'This address already had access; the row was refreshed. ' : 'Access granted. ') +
          (!send
            ? 'Nothing was emailed — copy the link and send it yourself.'
            : sent
              ? 'The link is on its way to ' + email + '.'
              : 'The email did NOT send (' + (emailError || 'unknown error') + ') — copy the link and send it yourself.'),
        signIn: 'https://irontuna.com/auctiondraft?signin=1'
      }, 200, c);
    }
    // ── the lead desk, from a URL ───────────────────────────────────────────
    // Promoting or pulling a generated lead story used to mean two SQL
    // statements in the Cloudflare console, and the second one was easy to
    // forget: unpublishing the lead does NOT promote the previous story, so
    // running only `SET published=0` silently drops the front page back to the
    // dated deep-dive rotation. That is the exact staleness the generated lead
    // replaced, reintroduced by a half-finished edit. So both operations are
    // one D1 batch here, and neither can leave the site with nothing published
    // unless there is genuinely nothing left to publish.
    if (url.pathname === '/api/admin/lead') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
      const idOf = (p) => { const v = url.searchParams.get(p); return v && /^\d+$/.test(v) ? +v : null; };
      const promote = idOf('promote'), pull = idOf('pull');
      if (url.searchParams.get('promote') && promote === null) return json({ ok: false, error: 'bad_id' }, 400, c);
      if (url.searchParams.get('pull') && pull === null) return json({ ok: false, error: 'bad_id' }, 400, c);
      if (promote !== null && pull !== null) return json({ ok: false, error: 'pick_one' }, 400, c);
      let did = null;
      try {
        if (promote !== null) {
          const row = await env.LEADS_DB.prepare('SELECT id, slug, verified FROM lead_story WHERE id = ?').bind(promote).first();
          if (!row) return json({ ok: false, error: 'not_found' }, 404, c);
          // A story with no slug has no URL, so the site treats it as no lead at
          // all. Promoting one would look like it worked and change nothing.
          if (!row.slug) return json({ ok: false, error: 'no_slug' }, 409, c);
          // Promoting a held row is an override of the run's own verification
          // gate, so it is stated in the response rather than done silently.
          await env.LEADS_DB.batch([
            env.LEADS_DB.prepare('UPDATE lead_story SET verified = 1, published = 1 WHERE id = ?').bind(promote),
            env.LEADS_DB.prepare('UPDATE lead_story SET published = 0 WHERE id <> ?').bind(promote)
          ]);
          did = { action: 'promote', id: promote, overrodeGate: !row.verified };
        } else if (pull !== null) {
          // Find the replacement BEFORE unpublishing, and do both in one batch,
          // so there is no window where the front page has no lead.
          const next = await env.LEADS_DB.prepare(
            'SELECT id FROM lead_story WHERE verified = 1 AND slug IS NOT NULL AND id <> ?'
            + ' ORDER BY created_at DESC LIMIT 1').bind(pull).first();
          const stmts = [env.LEADS_DB.prepare('UPDATE lead_story SET published = 0 WHERE id = ?').bind(pull)];
          if (next) stmts.push(env.LEADS_DB.prepare('UPDATE lead_story SET published = 1 WHERE id = ?').bind(next.id));
          await env.LEADS_DB.batch(stmts);
          did = { action: 'pull', id: pull, promoted: next ? next.id : null,
                  note: next ? null : 'nothing left to publish: the front page is on its dated deep-dive fallback' };
        }
      } catch (e) { return json({ ok: false, error: 'write_failed', detail: String(e && e.message || e) }, 500, c); }
      // Any write invalidates the two-minute memo, or the response below would
      // report the state we just left.
      if (did) { _LEAD_CACHE = null; _LEAD_AT = 0; }
      const rows = await env.LEADS_DB.prepare(
        'SELECT id, slug, title, category, players, verified, published, created_at'
        + ' FROM lead_story ORDER BY created_at DESC LIMIT 15').all();
      const list = ((rows && rows.results) || []).map(r => ({
        id: r.id, slug: r.slug, title: r.title,
        category: r.category || null,
        label: LEAD_CATEGORIES[String(r.category || '').toLowerCase()] || 'Insight',
        faces: (() => { try { const p = JSON.parse(r.players || '[]'); return Array.isArray(p) ? p.length : 0; } catch (e) { return 0; } })(),
        verified: !!r.verified, published: !!r.published,
        slot: leadSlot(r.created_at),
        createdAt: r.created_at,
        url: r.slug ? '/lead/' + r.slug : null,
        // Why this row is or is not on the site, so the answer does not have to
        // be reconstructed from the flags every time.
        state: !r.verified ? 'held (failed its own gate)'
             : !r.slug ? 'unusable (no slug)'
             : r.published ? 'LIVE' : 'archive'
      }));
      // Read back through the same function the site uses, so this reports what
      // a reader would actually get rather than what the flags imply.
      const live = await leadStoryPayload(env);
      // Slots holding more than one story. A run fired by hand lands in the same
      // slot as the scheduled one and buries it; this is how you see that it
      // happened rather than inferring it from timestamps.
      const bySlot = {};
      list.forEach(r => { (bySlot[r.slot] = bySlot[r.slot] || []).push(r.id); });
      const doubled = Object.entries(bySlot).filter(([, ids]) => ids.length > 1)
        .map(([slot, ids]) => ({ slot: +slot, ids, count: ids.length }));
      return json({ ok: true, did,
                    live: live.story ? { slug: live.story.slug, label: live.story.label, url: live.story.url } : null,
                    onSite: live.ok,
                    currentSlot: leadSlot(Date.now()),
                    doubledSlots: doubled,
                    stories: list }, 200, c);
    }
    if (url.pathname === '/api/admin/odds-status') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      // ?refresh=1 runs the pull now instead of waiting for the cron.
      let ran = null;
      if (url.searchParams.get('refresh') === '1') {
        try { ran = await runOddsRefresh(env); } catch (e) { ran = { ok: false, error: (e && e.message) || 'failed' }; }
      }
      // ?availability=1 reports the live injury list (age, size, the players it
      // touches); ?availability=refresh pulls ESPN now, then reports.
      const availParam = url.searchParams.get('availability') || '';
      let availability = null;
      if (availParam) {
        let availRan = null;
        if (availParam === 'refresh') {
          try { availRan = await runAvailabilityRefresh(env); } catch (e) { availRan = { ok: false, error: (e && e.message) || 'failed' }; }
        }
        try { availability = { ...(await availabilityReport(env)), ran: availRan }; }
        catch (e) { availability = { ok: false, error: (e && e.message) || 'failed', ran: availRan }; }
      }
      const cached = await oddsCacheRead(env);
      // ?sample=1 shows what the blend actually did to a few players, so a bad
      // pull is visible without decoding /api/projections by hand.
      let sample = null;
      if (url.searchParams.get('sample') === '1' && cached && cached.overlay) {
        const blended = blendProjections(cached.overlay);
        sample = [];
        for (let i = 0; i < blended.length && sample.length < 12; i++) {
          if (blended[i].projectedStats === PROJECTIONS[i].projectedStats) continue;
          sample.push({ name: blended[i].name, position: blended[i].position, before: PROJECTIONS[i].projectedStats, after: blended[i].projectedStats });
        }
      }
      return json({
        ok: true,
        providers: ODDS_PROVIDERS.map(p => ({ name: p.name, configured: !p.needs || p.needs(env) })),
        vegasWeight: VEGAS_WEIGHT,
        cached: cached ? { provider: cached.provider, matched: cached.matched, updatedAt: cached.updatedAt, ageHours: +((Date.now() - cached.updatedAt) / 3600000).toFixed(1) } : null,
        serving: cached ? 'vegas-blended' : 'committed projections (no usable overlay)',
        ran, sample, availability
      }, 200, c);
    }
    // The schedule behind /api/season: how old it is, what it holds, and what the
    // clock makes of it right now. ?refresh=1 runs the pull instead of waiting
    // for the cron, the same affordance /api/admin/odds-status has.
    if (url.pathname === '/api/admin/season-status') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      let ran = null;
      if (url.searchParams.get('refresh') === '1') {
        try { ran = await runScheduleRefresh(env); } catch (e) { ran = { ok: false, error: (e && e.message) || 'failed' }; }
      }
      const cache = await scheduleCacheRead(env);
      const byType = {};
      if (cache) for (const g of cache.games) byType[g.type] = (byType[g.type] || 0) + 1;
      return json({
        ok: true,
        sources: { spine: NFLVERSE_GAMES_URL, live: ESPN_SCOREBOARD },
        cached: cache ? {
          season: cache.season, games: cache.games.length, provider: cache.provider,
          updatedAt: cache.updatedAt, ageHours: +((Date.now() - cache.updatedAt) / 3600000).toFixed(1),
          byType, statusFromFeed: cache.games.filter(g => !!g.status).length
        } : null,
        serving: cache ? 'cached schedule + live clock' : 'nothing (no usable schedule row)',
        state: cache ? nflSeasonState(cache, Date.now()) : { ok: false, error: 'no_schedule' },
        ran
      }, 200, c);
    }
    // Which providers are wired up, and whether each one's key is present.
    // NEVER the key itself -- providerReport reports presence only.
    if (url.pathname === '/api/admin/providers') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      const kind = url.searchParams.get('run');
      let ran = null;
      if (kind && PROVIDERS[kind]) {
        const sched = await scheduleCacheRead(env);
        const r = await providerRun(env, kind, { season: sched ? sched.season : null });
        ran = { kind, results: r.results.map(x => ({ provider: x.provider, count: x.count || 0,
          skipped: x.skipped || null, error: x.error || null, sample: (x.rows || [])[0] || null })) };
      }
      return json({ ok: true, ...providerReport(env), kinds: Object.keys(PROVIDERS), ran }, 200, c);
    }
    // The market engine's own plumbing: the snapshot store, the usage overlay,
    // and a sample record. ?snapshot=1 pulls the books now; ?usage=1 rebuilds
    // the usage overlay now.
    if (url.pathname === '/api/admin/market-status') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      let snapRan = null, usageRan = null;
      if (url.searchParams.get('snapshot') === '1') {
        try { snapRan = await runMarketSnapshot(env); } catch (e) { snapRan = { ok: false, error: (e && e.message) || 'failed' }; }
      }
      if (url.searchParams.get('usage') === '1') {
        try { usageRan = await runUsageRefresh(env); } catch (e) { usageRan = { ok: false, error: (e && e.message) || 'failed' }; }
      }
      let rosRan = null;
      if (url.searchParams.get('ros') === '1') {
        try { rosRan = await runRosSnapshot(env); } catch (e) { rosRan = { ok: false, error: (e && e.message) || 'failed' }; }
      }
      const usage = await usageCacheRead(env);
      let sample = null;
      if (url.searchParams.get('sample') === '1') {
        try { const m = await buildMarketRecords(env, { limit: 1 }); sample = (m.records || [])[0] || null; }
        catch (e) { sample = { error: (e && e.message) || 'failed' }; }
      }
      return json({ ok: true,
        snapshots: await snapshotStatus(env),
        usage: usage ? { season: usage.season, throughWeek: usage.throughWeek,
                         players: Object.keys(usage.players || {}).length, updatedAt: usage.updatedAt } : null,
        scoring: { presets: Object.keys(SCORING_PRESETS), base: SCORING_BASE },
        unavailable: PROVIDER_UNAVAILABLE,
        ros: { snapshots: (await rosSnapshots(env, 'ros', 3)).map(x => ({ season: x.season, week: x.week, builtAt: x.builtAt, rows: x.rows.length })) },
        snapRan, usageRan, rosRan, sample }, 200, c);
    }
    if (url.pathname === '/api/admin/x-post-now') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      const forceWednesday = url.searchParams.get('wednesday') === '1';
      const dayParam = url.searchParams.get('day');
      const forceDay = dayParam !== null ? parseInt(dayParam, 10) : null; // 0=Sun..6=Sat, matches cron day-of-week
      try {
        const result = await runXAutoPost(env, { forceWednesday, forceDay });
        return json(result, result.ok ? 200 : 500, c);
      } catch (e) {
        return json({ ok: false, error: 'run_failed: ' + (e && e.message) }, 500, c);
      }
    }
    if (url.pathname === '/api/admin/x-delete') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      const id = url.searchParams.get('id') || '';
      if (!/^\d+$/.test(id)) return json({ ok: false, error: 'bad_id' }, 400, c);
      const result = await deleteTweet(env, id);
      return json(result, result.ok ? 200 : 500, c);
    }
    if (url.pathname === '/api/admin/x-spend') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
      const startingBalance = parseFloat(url.searchParams.get('balance') || '') || null;
      let byFormat = [], total = { spent: 0, posts: 0, threads: 0, failed: 0 };
      try {
        byFormat = ((await env.LEADS_DB.prepare(
          "SELECT format, SUM(CASE WHEN ok=1 THEN est_cost ELSE 0 END) AS spent, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS threads, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS failed FROM x_posts GROUP BY format"
        ).all()).results) || [];
        const totals = await env.LEADS_DB.prepare(
          "SELECT SUM(CASE WHEN ok=1 THEN est_cost ELSE 0 END) AS spent, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS threads, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS failed FROM x_posts"
        ).first();
        total = { spent: (totals && totals.spent) || 0, threads: (totals && totals.threads) || 0, failed: (totals && totals.failed) || 0 };
      } catch (e) {}
      const result = { ok: true, total, byFormat, note: 'Estimated from X\'s published pay-per-use pricing ($0.015/plain post, $0.20/post with a link); not an authoritative billing figure — check the X developer console Credits page for the real balance.' };
      if (startingBalance != null) result.estimatedRemaining = Math.max(0, startingBalance - total.spent);
      return json(result, 200, c);
    }
    if (url.pathname === '/api/admin/threads-status') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
      let row = null;
      try { row = await env.LEADS_DB.prepare('SELECT expires_at, updated_at FROM threads_token ORDER BY id DESC LIMIT 1').first(); } catch (e) {}
      const usingSecretFallback = !row;
      const daysUntilExpiry = row ? Math.round((row.expires_at - Date.now()) / 86400000) : null;
      return json({ ok: true, hasStoredToken: !!row, usingSecretFallback, daysUntilExpiry, lastRefreshed: row ? new Date(row.updated_at).toISOString() : null }, 200, c);
    }
    if (url.pathname === '/api/admin/dashboard') {
      // Admin overview powering /admin: purchases (Stripe = the actual money),
      // purchasers (entitlements = authoritative paid access), referrals (codes +
      // per-code performance), lead capture, and a 30-day daily series. Same
      // LEADS_EXPORT_KEY gate as the other admin routes.
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
      const db = env.LEADS_DB;
      const day = ts => new Date(ts || 0).toISOString().slice(0, 10);
      try {
        const out = { ok: true, generatedAt: Date.now() };
        const ents = ((await db.prepare('SELECT email, product, paid_at FROM entitlements ORDER BY paid_at DESC').all()).results) || [];
        const buyStarts = ((await db.prepare("SELECT email, ref, created_at FROM contacts WHERE type='purchase' ORDER BY created_at DESC").all()).results) || [];
        const refByEmail = {};
        for (let i = buyStarts.length - 1; i >= 0; i--) { const r = buyStarts[i]; if (r.ref) refByEmail[String(r.email || '').toLowerCase()] = r.ref; }
        const entSet = new Set(ents.map(e => String(e.email || '').toLowerCase()));
        out.purchasers = ents.map(e => ({ email: e.email, product: e.product, date: day(e.paid_at), ref: refByEmail[String(e.email || '').toLowerCase()] || '' }));
        const startEmails = new Set(buyStarts.map(r => String(r.email || '').toLowerCase()));
        const byType = ((await db.prepare('SELECT type, count(*) AS n FROM contacts GROUP BY type ORDER BY n DESC').all()).results) || [];
        const bySource = ((await db.prepare('SELECT source, count(*) AS n FROM contacts GROUP BY source ORDER BY n DESC').all()).results) || [];
        const recent = ((await db.prepare('SELECT email, source, type, ref, created_at FROM contacts ORDER BY created_at DESC LIMIT 30').all()).results) || [];
        out.leads = { byType, bySource, recent: recent.map(r => ({ email: r.email, source: r.source, type: r.type, ref: r.ref, date: day(r.created_at) })) };
        // referral codes + D1-side funnel (clicks / checkout starts); Stripe fills in paid sales below
        const codes = ((await db.prepare('SELECT code, email, created_at FROM codes ORDER BY created_at DESC').all()).results) || [];
        const perf = ((await db.prepare("SELECT ref, SUM(CASE WHEN type='purchase' THEN 1 ELSE 0 END) AS starts, SUM(CASE WHEN type NOT IN ('purchase','referrer') THEN 1 ELSE 0 END) AS clicks FROM contacts WHERE ref != '' GROUP BY ref").all()).results) || [];
        const pmap = {}; perf.forEach(p => { pmap[String(p.ref || '').toUpperCase()] = p; });
        const refs = {};
        const blankRef = k => ({ code: k, ownerEmail: null, since: null, clicks: 0, checkoutStarts: 0, paidSales: 0, revenue: 0, owed: 0 });
        codes.forEach(r => { const k = String(r.code || '').toUpperCase(); refs[k] = { ...blankRef(k), ownerEmail: r.email || null, since: day(r.created_at), clicks: (pmap[k] && pmap[k].clicks) || 0, checkoutStarts: (pmap[k] && pmap[k].starts) || 0 }; });
        Object.keys(pmap).forEach(k => { if (!refs[k]) refs[k] = { ...blankRef(k), clicks: pmap[k].clicks || 0, checkoutStarts: pmap[k].starts || 0 }; });
        // 30-day daily grid (UTC days, same convention as the rest of the admin JSON)
        const daily = {};
        for (let i = 29; i >= 0; i--) { const d = day(Date.now() - i * 86400000); daily[d] = { date: d, sales: 0, revenue: 0, leads: 0 }; }
        const leadRows = ((await db.prepare("SELECT created_at FROM contacts WHERE type='lead' AND created_at >= ?").bind(Date.now() - 30 * 86400000).all()).results) || [];
        leadRows.forEach(r => { const d = day(r.created_at); if (daily[d]) daily[d].leads++; });
        // Stripe: page through paid checkout sessions (source of truth for money)
        let sales = [], revenueCents = 0, stripeMeta = null;
        if (env.STRIPE_SECRET_KEY) {
          const auth = { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY };
          let starting = '', pages = 0, capped = false;
          while (true) {
            if (pages >= 25) { capped = true; break; }
            pages++;
            const u = 'https://api.stripe.com/v1/checkout/sessions?limit=100' + (starting ? '&starting_after=' + encodeURIComponent(starting) : '');
            const r = await fetch(u, { headers: auth });
            const j = await r.json().catch(() => ({}));
            if (j && j.error) { stripeMeta = { error: (j.error.message || '').slice(0, 200) }; break; }
            const data = (j && j.data) || [];
            for (const s of data) {
              if (s.payment_status !== 'paid') continue;
              const email = (s.customer_details && s.customer_details.email) || s.customer_email || '';
              const ref = String((s.metadata && s.metadata.ref) || s.client_reference_id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
              const cents = s.amount_total || 0, ts = (s.created || 0) * 1000;
              revenueCents += cents;
              sales.push({ email, ts, date: day(ts), amount: cents / 100, ref, session: s.id, entitled: entSet.has(String(email).toLowerCase()) });
              if (ref) { const rr = refs[ref] || (refs[ref] = blankRef(ref)); rr.paidSales++; rr.revenue += cents / 100; rr.owed = rr.paidSales * 3; }
              if (daily[day(ts)]) { daily[day(ts)].sales++; daily[day(ts)].revenue += cents / 100; }
            }
            if (j && j.has_more && data.length) starting = data[data.length - 1].id; else break;
          }
          sales.sort((a, b) => b.ts - a.ts);
          if (!stripeMeta) stripeMeta = { pagesScanned: pages, capped };
        }
        out.sales = sales.map(s => ({ email: s.email, date: s.date, amount: s.amount, ref: s.ref, session: s.session, entitled: s.entitled }));
        out.stripe = stripeMeta;
        out.referrals = Object.keys(refs).map(k => refs[k]).sort((a, b) => (b.revenue - a.revenue) || (b.clicks - a.clicks));
        out.daily = Object.keys(daily).sort().map(k => daily[k]);
        const referred = out.referrals.reduce((s, r) => s + r.paidSales, 0);
        let abandoned = 0; startEmails.forEach(e => { if (!entSet.has(e)) abandoned++; });
        out.totals = {
          revenue: revenueCents / 100,
          paidSales: sales.length,
          purchasers: ents.length,
          leads: byType.filter(t => t.type === 'lead').reduce((s, t) => s + (t.n || 0), 0),
          contacts: byType.reduce((s, t) => s + (t.n || 0), 0),
          checkoutStarts: startEmails.size,
          abandonedCheckouts: abandoned,
          referralCodes: codes.length,
          referredSales: referred,
          referralOwed: referred * 3
        };
        return json(out, 200, c);
      } catch (e) { return json({ ok: false, error: 'server', detail: String(e).slice(0, 200) }, 500, c); }
    }
    if (url.pathname === '/api/admin/exclude-me') {
      // Flag this browser as the operator's, or hand it back to the numbers.
      // GET so it works from an address bar, matching the other admin routes.
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      const on = url.searchParams.get('on') !== '0';
      return json({ ok: true, excluded: on }, 200, { ...c, 'Set-Cookie': ownerCookie(on) });
    }
    if (url.pathname === '/api/admin/traffic') {
      // Traffic overview powering the Traffic section of /admin: unique daily
      // users, pageviews, top pages, where arrivals came from, and the named
      // click events the site fires. Separate from /api/admin/dashboard so it
      // still loads when the Stripe pull there is slow or misconfigured.
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!adminOk(env, url.searchParams.get('key') || '')) return json({ ok: false, error: 'forbidden' }, 403, c);
      if (!env.LEADS_DB) return json({ ok: false, error: 'no_db' }, 500, c);
      if (!(await analyticsReady(env))) return json({ ok: false, error: 'no_tables' }, 500, c);
      const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
      // Reaching this route at all means someone holding the admin key is
      // browsing, so flag their browser unless they have already said otherwise.
      // &includeMe=1 shows the unfiltered numbers without changing the flag.
      const flag = ownerFlag(request);
      const includeMe = url.searchParams.get('includeMe') === '1';
      const head = flag ? c : { ...c, 'Set-Cookie': ownerCookie(true) };
      const db = env.LEADS_DB;
      try {
        const now = Date.now();
        const since = now - days * 86400000;
        const rows = async (sql, ...bind) => { try { return ((await db.prepare(sql).bind(...bind).all()).results) || []; } catch (e) { return []; } };
        const one = async (sql, ...bind) => { try { return (await db.prepare(sql).bind(...bind).first()) || {}; } catch (e) { return {}; } };
        // Every read below is filtered the same way, so no table on the page can
        // disagree with another about who counts.
        const mine = includeMe ? '' : ' AND internal = 0';
        const win = () => 'SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS userDays FROM page_views WHERE ts >= ?' + mine;

        const out = { ok: true, generatedAt: now, days, includeMe };
        out.totals = {
          window: await one(win(), since),
          activeNow: ((await one('SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE ts >= ?' + mine, now - 1800000)).n) || 0,
        };
        // Daily grid, zero-filled so the chart has a point for every day even
        // before there is traffic on it.
        const daily = {};
        for (let i = days - 1; i >= 0; i--) { const d = utcDay(now - i * 86400000); daily[d] = { date: d, views: 0, users: 0 }; }
        (await rows('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS users FROM page_views WHERE ts >= ?' + mine + ' GROUP BY day', since))
          .forEach(r => { if (daily[r.day]) daily[r.day] = { date: r.day, views: r.views || 0, users: r.users || 0 }; });
        out.daily = Object.keys(daily).sort().map(k => daily[k]);

        // The headline numbers, read off the daily grid rather than re-queried,
        // so the tiles and the chart can never tell different stories.
        //
        // A visitor id embeds the UTC day it was minted, so DISTINCT over a
        // multi-day window is exactly the sum of each day's uniques: user-days,
        // not unique people. Only the per-day figure is a true unique-user count,
        // which is why it leads and the window total is named for what it is.
        const series = out.daily;
        const userDays = series.reduce((s, r) => s + r.users, 0);
        let best = { date: null, users: 0 };
        series.forEach(r => { if (r.users > best.users) best = { date: r.date, users: r.users }; });
        out.uniqueUsers = {
          today: (series[series.length - 1] || {}).users || 0,
          yesterday: series.length > 1 ? (series[series.length - 2].users || 0) : null,
          avgPerDay: series.length ? userDays / series.length : 0,
          best: best,
          userDays: userDays,
        };

        // ── time spent on site ──
        // Sessionised from the pageview log itself, because there is no beacon to
        // ask: consecutive views by the same visitor more than SESSION_GAP_MS apart
        // are separate visits, and a visit lasts from its first view to its last.
        //
        // That measure has one honest limitation and the page states it rather than
        // burying it: the last page of a visit has no following view to measure
        // against, so a ONE-PAGE VISIT READS AS ZERO. Averaged over everything it
        // therefore understates — so `avgSec` (every visit, zeroes included) ships
        // next to `avgEngagedSec` (visits that turned at least one page, where the
        // number is actually measured) and the count of each, and the admin page
        // shows both. Inventing a dwell time for the final page would make the
        // average look better and mean less.
        //
        // A visitor id is minted fresh at UTC midnight, so a session can never span
        // two days — the gap rule is doing the work inside a day, not across them.
        const SESSION_GAP_MS = 1800000;   // 30 minutes, the same idle window as activeNow
        const visits = await rows(
          'WITH v AS (SELECT visitor, ts, ts - LAG(ts) OVER (PARTITION BY visitor ORDER BY ts) AS gap FROM page_views WHERE ts >= ?' + mine + '), ' +
          'b AS (SELECT visitor, ts, CASE WHEN gap IS NULL OR gap > ? THEN 1 ELSE 0 END AS started FROM v), ' +
          's AS (SELECT visitor, ts, SUM(started) OVER (PARTITION BY visitor ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS visit FROM b) ' +
          'SELECT COUNT(*) AS views, MAX(ts) - MIN(ts) AS ms FROM s GROUP BY visitor, visit',
          since, SESSION_GAP_MS);
        const secs = visits.map(r => Math.max(0, Number(r.ms) || 0) / 1000);
        const engaged = visits.filter(r => (Number(r.views) || 0) > 1).map(r => Math.max(0, Number(r.ms) || 0) / 1000);
        const sum = a => a.reduce((s, n) => s + n, 0);
        const sorted = secs.slice().sort((a, b) => a - b);
        const median = !sorted.length ? 0
          : sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        out.timeOnSite = {
          visits: secs.length,
          avgSec: secs.length ? sum(secs) / secs.length : 0,
          medianSec: median,
          engagedVisits: engaged.length,
          avgEngagedSec: engaged.length ? sum(engaged) / engaged.length : 0,
          singlePageVisits: secs.length - engaged.length,
          totalSec: sum(secs),
          gapMinutes: SESSION_GAP_MS / 60000,
        };

        out.topPages = (await rows('SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor) AS users FROM page_views WHERE ts >= ?' + mine + ' GROUP BY path ORDER BY views DESC LIMIT 25', since))
          .map(r => ({ path: r.path, views: r.views || 0, users: r.users || 0 }));
        out.sources = (await rows('SELECT source, COUNT(*) AS views, COUNT(DISTINCT visitor) AS users FROM page_views WHERE ts >= ?' + mine + ' GROUP BY source ORDER BY views DESC LIMIT 20', since))
          .map(r => ({ source: r.source || '', views: r.views || 0, users: r.users || 0 }));
        out.countries = (await rows("SELECT country, COUNT(*) AS views FROM page_views WHERE ts >= ? AND country != ''" + mine + ' GROUP BY country ORDER BY views DESC LIMIT 12', since))
          .map(r => ({ country: r.country, views: r.views || 0 }));
        out.events = (await rows('SELECT event, COUNT(*) AS n, COUNT(DISTINCT uid) AS people FROM site_events WHERE ts >= ?' + mine + ' GROUP BY event ORDER BY n DESC LIMIT 40', since))
          .map(r => ({ event: r.event, count: r.n || 0, people: r.people || 0 }));

        // What the filter is holding back, so "my visits are excluded" is a number
        // on the page and not something the operator has to take on trust.
        const mineOnly = await one('SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS userDays FROM page_views WHERE ts >= ? AND internal = 1', since);
        out.excluded = { views: mineOnly.views || 0, userDays: mineOnly.userDays || 0 };
        out.you = { excluded: flag !== '0' };

        const first = await one('SELECT MIN(ts) AS t FROM page_views');
        out.collectingSince = first.t || null;
        return json(out, 200, head);
      } catch (e) { return json({ ok: false, error: 'server', detail: String(e).slice(0, 200) }, 500, head); }
    }
    if (url.pathname === '/api/track') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return new Response(null, { status: 204, headers: c });
      if (await rl(env, request, 'track', 400, 600)) return new Response(null, { status: 204, headers: c });
      let __evt = ''; try { __evt = (await request.text()).slice(0, 4000); } catch (e) {}
      if (env.ANALYTICS_WEBHOOK) { try { await fetch(env.ANALYTICS_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: __evt }); } catch (e) {} }
      ctx.waitUntil(logSiteEvent(env, request, __evt));
      return new Response(null, { status: 204, headers: c });
    }
    if (url.pathname === '/api/checkout') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, c);
      if (await rl(env, request, 'checkout', 40, 600)) return json({ error: 'Too many attempts — wait a moment and try again.' }, 429, c);
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'Server missing STRIPE_SECRET_KEY' }, 500, c);
      let b = {}; try { b = await request.json(); } catch (e) {}
      const ref = String(b.ref || '').slice(0, 40);
      const email = String(b.email || '').slice(0, 120);
      const phone = String(b.phone || '').slice(0, 40);
      if (env.LEAD_WEBHOOK && email) {
        try { await fetch(env.LEAD_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.toLowerCase(), phone: phone, source: 'checkout', type: 'purchase', code: ref || null, ts: Date.now() }) }); } catch (e) {}
      }
      if (email) { await saveContact(env, { email: email.toLowerCase(), phone: phone, source: 'checkout', type: 'purchase', ref: ref, path: String(b.path || '') }); }
      const auth = { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY };
      const productId = env.STRIPE_PRODUCT_ID || 'prod_UjzvYZjhOXVnDT';
      let priceId = env.STRIPE_PRICE_ID || '';
      try {
        if (!priceId) {
          const pr = await fetch('https://api.stripe.com/v1/products/' + productId, { headers: auth });
          const pj = await pr.json().catch(() => ({}));
          if (pj && pj.default_price) priceId = typeof pj.default_price === 'string' ? pj.default_price : pj.default_price.id;
          if (!priceId) { const lr = await fetch('https://api.stripe.com/v1/prices?active=true&limit=1&product=' + productId, { headers: auth }); const lj = await lr.json().catch(() => ({})); priceId = lj.data && lj.data[0] && lj.data[0].id; }
        }
        if (!priceId) return json({ error: 'No active price on product. Add a one-off price in Stripe.' }, 500, c);
        let __rp = '/'; try { __rp = String(b.path || '/'); } catch (e) {} if (!/^\/(auctiondraft|snakedraft)$/.test(__rp)) __rp = '/'; const __base = url.origin + __rp;
        const form = new URLSearchParams();
        form.set('mode', 'payment');
        form.set('line_items[0][price]', priceId);
        form.set('line_items[0][quantity]', '1');
        form.set('success_url', __base + '?paid=1&cs={CHECKOUT_SESSION_ID}');
        form.set('cancel_url', __base + '?canceled=1');
        if (email) form.set('customer_email', email);
        if (ref) {
          form.set('client_reference_id', ref);
          form.set('metadata[ref]', ref);
          const couponId = env.STRIPE_REFERRAL_COUPON || 'irontuna_ref_1off';
          try {
            const cg = await fetch('https://api.stripe.com/v1/coupons/' + couponId, { headers: auth });
            if (!cg.ok) {
              const cf = new URLSearchParams(); cf.set('id', couponId); cf.set('amount_off', '100'); cf.set('currency', 'usd'); cf.set('duration', 'once'); cf.set('name', 'Referral $1 off');
              await fetch('https://api.stripe.com/v1/coupons', { method: 'POST', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, body: cf.toString() });
            }
            form.set('discounts[0][coupon]', couponId);
          } catch (e) { form.set('allow_promotion_codes', 'true'); }
        } else {
          form.set('allow_promotion_codes', 'true');
        }
        const sr = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        const sj = await sr.json().catch(() => ({}));
        if (!sr.ok || !sj.url) return json({ error: (sj.error && sj.error.message) || ('Stripe ' + sr.status) }, 502, c);
        return json({ url: sj.url }, 200, c);
      } catch (e) { return json({ error: String(e) }, 500, c); }
    }
    if (url.pathname === '/api/checkout/verify') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (!env.STRIPE_SECRET_KEY) return json({ paid: false }, 200, c);
      const cs = url.searchParams.get('cs');
      if (!cs) return json({ paid: false }, 200, c);
      try {
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(cs), { headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } });
        const j = await r.json().catch(() => ({}));
        const paid = !!(j && (j.payment_status === 'paid' || j.payment_status === 'no_payment_required'));
        const buyer = (j.customer_details && j.customer_details.email) || null;
        if (paid && buyer) {
          await grantEntitlement(env, buyer);
          // Also start a signed session for this browser so server-gated paid routes
          // (/api/insights) work right after purchase without a magic-link round trip.
          if (env.AUTH_SECRET) {
            const email = buyer.toLowerCase(), now = Date.now(), sid = crypto.randomUUID(), cap = parseInt(env.MAX_DEVICES || '3', 10);
            if (env.LEADS_DB) {
              try {
                const rows = ((await env.LEADS_DB.prepare('SELECT id FROM sessions WHERE email=? ORDER BY last_seen ASC').bind(email).all()).results) || [];
                for (let i = 0; i < rows.length - (cap - 1); i++) await env.LEADS_DB.prepare('DELETE FROM sessions WHERE id=?').bind(rows[i].id).run();
                await env.LEADS_DB.prepare('INSERT INTO sessions (id,email,created_at,last_seen,ua) VALUES (?,?,?,?,?)').bind(sid, email, now, now, (request.headers.get('user-agent') || '').slice(0, 200)).run();
              } catch (e) {}
            }
            const sess = await makeToken(env.AUTH_SECRET, { sid: sid, e: email, t: 'sess', exp: now + 90 * 24 * 3600 * 1000 });
            return json({ paid: paid, email: buyer, ref: (j.metadata && j.metadata.ref) || null }, 200, { ...c, 'Set-Cookie': 'it_sess=' + sess + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (90 * 24 * 3600) });
          }
        }
        return json({ paid: paid, email: buyer, ref: (j.metadata && j.metadata.ref) || null }, 200, c);
      } catch (e) { return json({ paid: false }, 200, c); }
    }
    if (url.pathname === '/api/stripe-webhook') {
      if (request.method !== 'POST') return new Response('method', { status: 405 });
      const sig = request.headers.get('stripe-signature') || '';
      const raw = await request.text();
      if (!(await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET))) return new Response('bad signature', { status: 400 });
      let evt = {}; try { evt = JSON.parse(raw); } catch (e) {}
      if (evt && evt.type === 'checkout.session.completed') {
        const s = (evt.data && evt.data.object) || {};
        const rec = { event: 'referral_sale', ref: (s.metadata && s.metadata.ref) || s.client_reference_id || null, buyer_email: (s.customer_details && s.customer_details.email) || s.customer_email || null, amount_total: s.amount_total, currency: s.currency, session: s.id, ts: Date.now() };
        if (rec.buyer_email) await grantEntitlement(env, rec.buyer_email);
        if (rec.ref && env.REFERRAL_WEBHOOK) { try { await fetch(env.REFERRAL_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }); } catch (e) {} }
        if (env.ANALYTICS_WEBHOOK) { try { await fetch(env.ANALYTICS_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }); } catch (e) {} }
      } else if (evt && (evt.type === 'charge.refunded' || evt.type === 'refund.created')) {
        const ch = (evt.data && evt.data.object) || {};
        const email = await chargeEmail(env, ch.object === 'refund' ? { id: ch.charge } : ch);
        if (email) await revokeEntitlement(env, email);
      } else if (evt && evt.type === 'charge.dispute.created') {
        const dp = (evt.data && evt.data.object) || {};
        let email = (dp.evidence && dp.evidence.customer_email_address) || null;
        if (!email) email = await chargeEmail(env, { id: dp.charge });
        if (email) await revokeEntitlement(env, email);
      }
      return new Response('ok', { status: 200 });
    }
    if (url.pathname === '/api/coach') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, c);
      return handleCoach(request, env, c);
    }
    // Serve static assets, but tell browsers to revalidate HTML every load so
    // updates show up without a hard refresh (the app is a single index.html).
    // ── scheduled insight drops (per-format pages): 302 to the format index until 9am ET (13:00 UTC) on their date ──
    const __insLegacy = url.pathname.match(/^\/insights-(\d{4}-\d{2}-\d{2})(?:\.html)?$/);
    if (__insLegacy) return Response.redirect(url.origin + '/auction-insights-' + __insLegacy[1], 301);
    const __insDrop = url.pathname.match(/^\/(auction|snake|bestball)-insights-(\d{4})-(\d{2})-(\d{2})(?:\.html)?$/);
    if (__insDrop) {
      const __ds = __insDrop[2] + '-' + __insDrop[3] + '-' + __insDrop[4];
      const __rel = Date.UTC(+__insDrop[2], +__insDrop[3] - 1, +__insDrop[4], 13, 0, 0);
      if (__ds !== '2026-07-04' && Date.now() < __rel) return Response.redirect(url.origin + '/' + __insDrop[1] + '-insights', 302); // 2026-07-04 = launch drop, live immediately
    }
    if (url.pathname === '/sitemap.xml') {
      const __sm = await env.ASSETS.fetch(request);
      let __xml = await __sm.text();
      __xml = __xml.replace(/<url><loc>https:\/\/irontuna\.com\/(?:auction|snake|bestball)-insights-(\d{4})-(\d{2})-(\d{2})<\/loc>[\s\S]*?<\/url>\s*/g,
        (blk, y, mo, dd) => ((y + '-' + mo + '-' + dd) !== '2026-07-04' && Date.now() < Date.UTC(+y, +mo - 1, +dd, 13, 0, 0) ? '' : blk));
      return new Response(__xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
    }
    let __assetReq = request;
    // "/" serves the news-style front page (front.html); the classic SPA hub moved to /hub.
    // The SPA format routes (and /hub) all rewrite to "/" so the asset layer serves index.html.
    //
    // Rewrite to the EXTENSIONLESS path, never to "<name>.html". The assets layer runs
    // Cloudflare's default html_handling ("auto-trailing-slash"), which answers /front.html
    // with a 307 to /front and /lead.html with a 307 to /lead — so rewriting to a .html path
    // hands the browser a redirect instead of the page. On "/" that cost a wasted hop and
    // moved the reader off the canonical URL; on /lead it was an infinite loop, because the
    // redirect target is the very path this rewrite fires on (ERR_TOO_MANY_REDIRECTS).
    // The extensionless form is what the assets layer serves 200 from, so it never bounces.
    try {
      if (url.pathname === '/') __assetReq = new Request(new URL('/front', url).toString(), request);
      // /lead and /lead/<slug> both serve the one article shell; it reads the
      // slug back off the path and fetches its own body. The stories turn over
      // every three hours, so they are rendered rather than built as pages.
      else if (/^\/lead(\/[A-Za-z0-9._-]*)?\/?$/.test(url.pathname)) __assetReq = new Request(new URL('/lead', url).toString(), request);
      // /player and /player/<slug> both serve the one player-card shell, which
      // reads the slug back off the path and assembles the card in the browser
      // from /player-search.js and /it-league.js. Same shape as /lead above and
      // for the same reason: ~400 players is not ~400 files. Extensionless
      // target, or the assets layer answers with a 307 back to this same path.
      else if (/^\/player(\/[A-Za-z0-9._-]*)?\/?$/.test(url.pathname)) __assetReq = new Request(new URL('/player', url).toString(), request);
      else if (/^\/(auctiondraft|snakedraft|bestball|hub)(\/|$)/.test(url.pathname)) __assetReq = new Request(new URL('/', url).toString(), request);
      // /in-season/<page> is the section's canonical URL; the pages live at the
      // root because the chrome and SEO generators walk the root. Extensionless
      // target, as above. The gate below sees the SAME name, so a section page
      // cannot be reached ungated by adding the prefix.
      else if (/^\/in-season\/(weekly-intel|rankings|vegas-edge|what-they-arent-telling-you|game-intel|waivers|dfs|my-league)\/?$/.test(url.pathname)
               && !(POST_DRAFT_PAGES.has(url.pathname.replace(/^\/in-season/, '').replace(/\/+$/, '')) && !POST_DRAFT_OPEN(env) && !postDraftPreview(env, url, request))) {
        __assetReq = new Request(new URL(url.pathname.replace(/^\/in-season/, '').replace(/\/+$/, ''), url).toString(), request);
      }
      else if (/^\/in-season\/(weekly-intel|rankings|vegas-edge|what-they-arent-telling-you|game-intel|waivers|dfs|my-league)\/?$/.test(url.pathname)) {
        __assetReq = new Request(new URL('/post-draft', url).toString(), request);
      }
      else if (/^\/in-season\/?$/.test(url.pathname)) __assetReq = new Request(new URL('/post-draft', url).toString(), request);
      // /in-season/player/<slug>: one shell for every player, like /player/<slug>,
      // gated with the rest of the section.
      else if (/^\/in-season\/player(\/[A-Za-z0-9._-]*)?\/?$/.test(url.pathname)) {
        const open = POST_DRAFT_OPEN(env) || postDraftPreview(env, url, request);
        __assetReq = new Request(new URL(open ? '/player-intel' : '/post-draft', url).toString(), request);
      }
      // The in-season tools are deployed but closed (see POST_DRAFT_PAGES above).
      // A closed route serves the waiting-list gate rather than redirecting to it,
      // so the reader keeps the URL they clicked and the page they were promised
      // is the one that opens there later.
      else if (POST_DRAFT_PAGES.has(url.pathname.replace(/\/+$/, '')) && !POST_DRAFT_OPEN(env) && !postDraftPreview(env, url, request)) {
        __assetReq = new Request(new URL('/post-draft', url).toString(), request);
      }
    } catch (e) {}
    const resp = await env.ASSETS.fetch(__assetReq);
    const ct = resp.headers.get('content-type') || '';
    // Count the view off the response path — a slow or failed D1 write must never
    // hold up the page. Only real, successful HTML loads count.
    if (resp.ok && ct.includes('text/html') && request.method === 'GET') ctx.waitUntil(logPageView(env, request, url));
    if (ct.includes('text/html')) {
      // Per-route SEO/AEO meta for the SPA format routes (they're all served from the
      // single index.html, which carries auction-focused meta). /auctiondraft + / keep
      // that auction meta as-is; /snakedraft + /bestball get their own title, description,
      // canonical, and OG/Twitter so they can rank for snake / best-ball queries.
      const __seoKey = (url.pathname.replace(/\/+$/, '') || '/');
      const __SPA_SEO = {
        '/snakedraft': {
          title: 'Iron Tuna: AI Snake Draft Assistant & Custom Fantasy Rankings',
          desc: "Iron Tuna's snake draft tool builds custom rankings for your exact league scoring, shows live ADP and survival odds (the chance each player lasts to your next pick), flags tier cliffs, and runs an AI Value Coach that tells you who to draft on the clock. Free to start.",
          url: 'https://irontuna.com/snakedraft',
          ogt: 'Iron Tuna: know who your leaguemates will pick before they do.',
          ogd: 'Custom snake-draft rankings for your exact scoring, live survival odds at your next pick, tier-cliff alerts, and an AI Value Coach on the clock. Free to try.'
        },
        '/bestball': {
          title: 'Iron Tuna: AI Best Ball Draft Tool — Ceiling, Stacks & Playoff Edges',
          desc: "Iron Tuna's best ball tool ranks by true ceiling, fires live stack alerts the moment a teammate is drafted, surfaces championship-week (Weeks 15-17) edges, and tunes an AI coach to your exact roster. Built for Underdog-style best ball. Free to start.",
          url: 'https://irontuna.com/bestball',
          ogt: 'Iron Tuna: your stacks light up the moment they go live.',
          ogd: 'Ceiling-weighted best ball values, live stack detection, and championship-week edges tuned to your exact roster as you draft. Free to try.'
        }
      };
      const __m = __SPA_SEO[__seoKey];
      if (__m) {
        let __html = await resp.text();
        const __ix = __html.indexOf('</head>');
        if (__ix > 0) {
          const __esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
          const __h = __html.slice(0, __ix)
            .replace(/<title>[\s\S]*?<\/title>/, '<title>' + __esc(__m.title) + '</title>')
            .replace(/(<meta name="description" content=")[^"]*(")/, '$1' + __esc(__m.desc) + '$2')
            .replace(/(<link rel="canonical" href=")[^"]*(")/, '$1' + __m.url + '$2')
            .replace(/(<meta property="og:url" content=")[^"]*(")/, '$1' + __m.url + '$2')
            .replace(/(<meta property="og:title" content=")[^"]*(")/, '$1' + __esc(__m.ogt) + '$2')
            .replace(/(<meta property="og:description" content=")[^"]*(")/, '$1' + __esc(__m.ogd) + '$2')
            .replace(/(<meta name="twitter:title" content=")[^"]*(")/, '$1' + __esc(__m.ogt) + '$2')
            .replace(/(<meta name="twitter:description" content=")[^"]*(")/, '$1' + __esc(__m.ogd) + '$2');
          __html = __h + __html.slice(__ix);
        }
        const __r = new Response(__html, resp);
        __r.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        __r.headers.delete('content-length');
        return secure(__r);
      }
      const r = new Response(resp.body, resp);
      r.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return secure(r);
    }
    return secure(new Response(resp.body, resp));
  },
  async scheduled(event, env, ctx) {
    // Three staggered triggers (wrangler.jsonc), one slot each, so the day's posts land hours
    // apart instead of in a single botlike burst. Keys must match the cron strings verbatim;
    // an unrecognized cron falls back to a full run so a config drift never silently posts nothing.
    const slotsByCron = {
      '0 13 * * 1-5': ['auction'],
      '0 16 * * 1-5': ['snake'],
      '0 19 * * 1-5': ['bonus'],
    };
    // Daily odds refresh runs on its own trigger and posts nothing.
    if (event.cron === '0 11 * * *') {
      ctx.waitUntil(runOddsRefresh(env)
        .then(r => console.log('odds refresh:', JSON.stringify(r)))
        .catch(e => console.error('odds refresh failed:', e && e.message)));
      // The injury list, same daily cadence, same fail-safe (HANDOFF §48).
      ctx.waitUntil(runAvailabilityRefresh(env)
        .then(r => console.log('availability refresh:', JSON.stringify(r)))
        .catch(e => console.error('availability refresh failed:', e && e.message)));
      // The schedule behind /api/season. Cheap (one cached CSV plus five small
      // ESPN calls) and required by every in-season surface, so it runs on the
      // daily slot with the odds AND on the three posting slots below, which is
      // what keeps Sunday scores from sitting a full day stale.
      ctx.waitUntil(runScheduleRefresh(env)
        .then(r => console.log("schedule refresh:", JSON.stringify(r)))
        .catch(e => console.error("schedule refresh failed:", e && e.message)));
      // The market engine's two feeds. The snapshot pull appends every CHANGED
      // book line to the history table (nothing is overwritten); the usage
      // refresh rebuilds the weekly stats/snaps overlay, which is a ~12MB pull
      // and belongs nowhere near a request path. Both fail closed.
      ctx.waitUntil(runMarketSnapshot(env)
        .then(r => console.log('market snapshot:', JSON.stringify(r)))
        .catch(e => console.error('market snapshot failed:', e && e.message)));
      ctx.waitUntil(runUsageRefresh(env)
        .then(r => console.log('usage refresh:', JSON.stringify(r)))
        .catch(e => console.error('usage refresh failed:', e && e.message)));
      // The Wednesday rest-of-season update. 11:00Z is 7am in New York during
      // daylight time and 6am after it ends; either is before anyone is
      // setting a lineup. Runs AFTER the schedule, odds and usage pulls above
      // have had a moment, since it reads all three.
      if (new Intl.DateTimeFormat('en-US', { timeZone: LEAD_TZ, weekday: 'short' }).format(new Date()) === 'Wed') {
        ctx.waitUntil(new Promise(r => setTimeout(r, 20000)).then(() => runRosSnapshot(env))
          .then(r => console.log('ros snapshot:', JSON.stringify(r)))
          .catch(e => console.error('ros snapshot failed:', e && e.message)));
      }
      ctx.waitUntil(snapshotPrune(env, SNAP_KEEP_DAYS)
        .then(r => console.log('snapshot prune:', JSON.stringify(r)))
        .catch(e => console.error('snapshot prune failed:', e && e.message)));
      ctx.waitUntil(pruneAnalytics(env, 180)
        .then(r => console.log('analytics prune:', JSON.stringify(r)))
        .catch(e => console.error('analytics prune failed:', e && e.message)));
      return;
    }
    // Every other trigger also refreshes the schedule before it posts: the
    // posting slots are the only three times a day the worker wakes, so they are
    // where in-week score and status freshness comes from.
    ctx.waitUntil(runScheduleRefresh(env).catch(e => console.error("schedule refresh failed:", e && e.message)));
    // Lines move all week, and a snapshot store that only sampled once a day
    // would record a Sunday morning steam move as a single overnight jump. The
    // three posting slots are the only other times the worker wakes, so they
    // are where in-week line movement comes from.
    ctx.waitUntil(runMarketSnapshot(env).catch(e => console.error('market snapshot failed:', e && e.message)));
    const slots = slotsByCron[event.cron];
    ctx.waitUntil(runXAutoPost(env, slots ? { slots } : undefined).catch(e => console.error('x-auto-post failed:', e && e.message)));
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
  while (messages.length && messages[0].role !== 'user') messages.shift(); // Anthropic rejects a conversation that opens with an assistant turn
  if (!messages.length) return json({ error: 'No user message' }, 400, c);
  const wantStream = !!body.stream;

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile, request.headers.get('cf-connecting-ip'));
    if (!ok) return json({ error: 'Verification failed' }, 403, c);
  }
  if (env.RATE_KV) {
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const k = 'rl:' + ip;
    const n = parseInt((await env.RATE_KV.get(k)) || '0', 10);
    const _rmax = parseInt(env.RATE_MAX || '60', 10);
    if (n >= _rmax) return json({ error: 'Rate limit — give it a moment.' }, 429, c);
    await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 600 });
  }

  const provider = (env.LLM_PROVIDER || 'anthropic').toLowerCase();
  const primary = env.LLM_MODEL || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini');
  const fallbackModel = env.LLM_FALLBACK_MODEL || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini');
  const callModel = (model, stream, signal) => provider === 'anthropic'
    ? fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': env.LLM_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 700, system, messages, stream }) })
    : fetch(env.LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions', { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.LLM_API_KEY }, body: JSON.stringify({ model, temperature: 0.4, max_tokens: 700, messages: [{ role: 'system', content: system }, ...messages], stream }) });
  // Retry transient overloads (429/529) and gateway blips with exponential backoff,
  // plus a per-attempt timeout so a hung upstream never hangs the coach.
  const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 522, 524, 529]);
  const _sleep = ms => new Promise(r => setTimeout(r, ms));
  const callWithRetry = async (model, stream, tries) => {
    let resp = null;
    for (let i = 0; i < tries; i++) {
      let ctrl = null, to = null;
      try {
        ctrl = new AbortController();
        to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 24000);
        resp = await callModel(model, stream, ctrl.signal);
      } catch (e) { resp = null; }
      finally { if (to) clearTimeout(to); }
      if (resp && resp.ok) {
        if (!stream) return { resp };
        // A 200 on a stream is not success yet: the provider can still send an
        // in-stream error event (e.g. overloaded) or close before the first
        // token, which used to be piped through and render as an empty reply.
        // Only commit once the first content token has actually arrived.
        const primed = await primeStream(resp, provider);
        if (primed) return { resp, primed };
        resp = null;
      } else if (resp && !RETRY_STATUS.has(resp.status)) {
        return { resp };
      }
      if (i < tries - 1) await _sleep(500 * Math.pow(2, i) + Math.floor(Math.random() * 250));
    }
    return { resp };
  };
  const readText = j => provider === 'anthropic'
    ? (j.content && j.content[0] && j.content[0].text) || ''
    : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  try {
    // Primary model with backoff retries (rides out transient 429/529 overloads),
    // then the fast fallback model with its own retries, so a busy provider
    // self-heals instead of taking the coach offline mid-draft. Streamed
    // attempts only count as successful once the first token arrives (see
    // callWithRetry/primeStream), and empty non-stream completions fall
    // through to the fallback model the same way.
    const finish = async ({ resp, primed }) => {
      if (wantStream) return streamResponse(resp, provider, c, primed);
      const t = readText(await resp.json().catch(() => ({})));
      return t ? json({ text: t }, 200, c) : null;
    };
    const first = await callWithRetry(primary, wantStream, 3);
    if (first.resp && first.resp.ok && (!wantStream || first.primed)) {
      const out = await finish(first);
      if (out) return out;
    }
    const fb = await callWithRetry(fallbackModel, wantStream, 2);
    if (fb.resp && fb.resp.ok && (!wantStream || fb.primed)) {
      const out = await finish(fb);
      if (out) return out;
    }
    const upstream = first.resp;
    const j = upstream ? await upstream.json().catch(() => ({})) : {};
    const msg = (j.error && j.error.message) || 'Provider unavailable';
    const overloaded = /overload/i.test(msg) || (upstream && (upstream.status === 529 || upstream.status === 429));
    return json({ error: overloaded ? 'The Value Coach is in high demand right now. Wait a few seconds and ask again.' : msg, retryable: !!overloaded }, overloaded ? 503 : 502, c);
  } catch (e) {
    return json({ error: String(e) }, 500, c);
  }
}

// Reads an upstream SSE body until the first content token arrives, returning
// the reader plus the chunks already consumed so streamResponse can replay
// them. Returns null if the stream carries an error event, ends, or stalls
// before any content — the caller treats that as a failed attempt and retries
// instead of forwarding a token-less stream to the browser.
async function primeStream(resp, provider) {
  let reader;
  try { reader = resp.body.getReader(); } catch (e) { return null; }
  const dec = new TextDecoder();
  const chunks = [];
  let seen = '';
  let timer = null;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 15000); });
    while (true) {
      const r = await Promise.race([reader.read(), timeout]);
      if (r.timedOut || r.done) break;
      chunks.push(r.value);
      seen += dec.decode(r.value, { stream: true });
      const hasText = provider === 'anthropic'
        ? seen.indexOf('content_block_delta') >= 0
        : /"delta"\s*:\s*\{[^}]*"content"/.test(seen);
      if (hasText) { clearTimeout(timer); return { reader, chunks }; }
      if (provider === 'anthropic' && /"type"\s*:\s*"error"/.test(seen)) break;
    }
  } catch (e) {}
  if (timer) clearTimeout(timer);
  try { reader.cancel(); } catch (e) {}
  return null;
}

async function verifyStripeSig(payload, header, secret) {
  if (!secret || !header) return false;
  try {
    const parts = {}; header.split(',').forEach(kv => { const i = kv.indexOf('='); if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1); });
    const t = parts.t, v1 = parts.v1;
    if (!t || !v1) return false;
    // Reject stale timestamps so a captured signature can't be replayed indefinitely
    // (Stripe's own SDKs default to a 5-minute tolerance).
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload));
    const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex.length !== v1.length) return false;
    let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch (e) { return false; }
}
async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret); form.append('response', token); if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}

function streamResponse(upstream, provider, c, primed) {
  const reader = (primed && primed.reader) || upstream.body.getReader();
  const pre = primed && primed.chunks ? primed.chunks.slice() : [];
  const dec = new TextDecoder(); const enc = new TextEncoder();
  let buf = '';
  const stream = new ReadableStream({
    // pull must make progress (enqueue or close) before returning: a pull that
    // resolves without enqueueing anything is not reliably re-invoked, so an
    // upstream chunk carrying only non-delta events (message_start, ping, …)
    // would otherwise stall the stream forever. Loop until we have output.
    async pull(controller) {
      while (true) {
        const { done, value } = pre.length ? { done: false, value: pre.shift() } : await reader.read();
        if (done) { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); return; }
        buf += dec.decode(value, { stream: true });
        let idx, wrote = false;
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
            if (delta) { controller.enqueue(enc.encode('data: ' + JSON.stringify(delta) + '\n\n')); wrote = true; }
          } catch (e) {}
        }
        if (wrote) return;
      }
    },
    cancel() { try { reader.cancel(); } catch (e) {} },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...c } });
}
