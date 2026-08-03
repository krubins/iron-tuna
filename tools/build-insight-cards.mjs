// Generates the per-insight stat-card PNGs at social/cards/<id>.png that the X/Threads
// auto-poster attaches to insight threads (posts with media reliably out-distribute plain
// text). Re-run this AFTER tools/extract-insight-pool.mjs whenever new drop pages are added,
// then commit the new PNGs — the Worker existence-checks each card and silently posts
// text-only if one is missing, so forgetting this step degrades gracefully but loses the
// image boost for the new insights.
//
// Needs playwright-core on the resolution path (`npm i --no-save playwright-core` in tools/
// or any parent dir — nothing is committed) and a Chromium binary. In Claude Code remote
// sessions one is preinstalled at /opt/pw-browsers/chromium; elsewhere set CHROMIUM_PATH.
//
// Cards are 1200x675 (X's standard 16:9 timeline crop), styled on the site's own design
// tokens (the :root palette shared by the guide pages). Deliberately no irontuna.com text
// on the card: X posts carry no site reference by decision (see HANDOFF §10), branding is
// the wordmark + tuna mark only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_DIR = ROOT + 'social/cards/';
const pool = JSON.parse(readFileSync(ROOT + 'tools/x-posts/insights_pool.json', 'utf8'));
const logoData = 'data:image/png;base64,' + readFileSync(ROOT + 'tuna.png').toString('base64');
const force = process.argv.includes('--force');

const FORMAT_LABEL = { auction: 'AUCTION INSIGHT', snake: 'SNAKE INSIGHT', bestball: 'BEST BALL INSIGHT' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function dateLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
}
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cardHtml(ins) {
  const statRow = ins.stat
    ? `<div class="row stat"><span class="ico">📊</span><div><span class="lbl">Projected effect</span>${esc(ins.stat)}</div></div>`
    : '';
  const playRow = ins.play
    ? `<div class="row play"><span class="ico">💡</span><div><span class="lbl">The play</span>${esc(ins.play)}</div></div>`
    : '';
  const titleSize = ins.title.length > 80 ? 46 : 54;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--bg:#0b1117;--panel:#121b24;--line:#22303b;--text:#e8eef2;--sec:#b6c2cc;--muted:#8595a1;--teal:#2dd4a3;--gold:#f5b800}
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:675px;background:var(--bg);color:var(--text);
      font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
      display:flex;flex-direction:column;padding:52px 60px 0;
      background-image:radial-gradient(1000px 500px at 85% -10%, rgba(45,212,163,.08), transparent 60%)}
    .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px}
    .brand{display:flex;align-items:center;gap:16px}
    .brand img{width:58px;height:58px;border-radius:12px}
    .brand b{font-size:27px;letter-spacing:3.5px}
    .badge{font-size:20px;font-weight:700;letter-spacing:2px;color:var(--teal);
      border:1.5px solid var(--line);background:var(--panel);border-radius:999px;padding:12px 24px}
    .badge span{color:var(--muted);font-weight:600}
    h1{font-size:${titleSize}px;line-height:1.16;font-weight:800;margin-bottom:38px;
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .row{display:flex;gap:18px;align-items:flex-start;font-size:31px;line-height:1.3;
      background:var(--panel);border:1.5px solid var(--line);border-radius:16px;
      padding:22px 26px;margin-bottom:20px}
    .row .ico{font-size:34px;line-height:1.2}
    .lbl{display:block;font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;
      color:var(--muted);margin-bottom:6px}
    .stat div{color:var(--gold);font-weight:700}
    .play div{color:var(--sec)}
    .bar{margin-top:auto;height:10px;margin-left:-60px;margin-right:-60px;
      background:linear-gradient(90deg,var(--teal),var(--gold))}
  </style></head><body>
    <div class="top">
      <div class="brand"><img src="${logoData}"><b>IRON TUNA</b></div>
      <div class="badge">${FORMAT_LABEL[ins.format] || 'INSIGHT'} <span>· ${dateLabel(ins.date)}</span></div>
    </div>
    <h1>${esc(ins.title)}</h1>
    ${statRow}${playRow}
    <div class="bar"></div>
  </body></html>`;
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
let built = 0, skipped = 0;
for (const ins of pool) {
  const out = OUT_DIR + ins.id + '.png';
  if (!force && existsSync(out)) { skipped++; continue; }
  await page.setContent(cardHtml(ins), { waitUntil: 'load' });
  writeFileSync(out, await page.screenshot({ type: 'png' }));
  built++;
}
await browser.close();
console.log(`Built ${built} cards (${skipped} already existed) in social/cards/ — commit the PNGs.`);
