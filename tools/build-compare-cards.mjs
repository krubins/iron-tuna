// Generates social/compare-auction.png and social/compare-snake.png, the comparison-table
// cards the X auto-poster attaches to the eight `compare-*` posts (see the COMPARE pools
// in _worker.js; HANDOFF §10). 1200x675 at 2x, on the site's own palette.
//
// The generator used to live in a session scratchpad and only the PNGs were committed;
// it is in the repo now so the cards can be rebuilt. The brand row is the header word
// mark (tools/wordmark.mjs) rather than "IRON TUNA" set as type, which is what put a
// second version of the name on these cards.
//
// Needs playwright-core on the resolution path (`npm i --no-save playwright-core`,
// nothing is committed) and a Chromium binary: /opt/pw-browsers/chromium in Claude
// Code remote sessions, else set CHROMIUM_PATH. Edit CARDS, run
// `node tools/build-compare-cards.mjs`, commit the PNGs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { wordmarkSvg } from './wordmark.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const fish = 'data:image/png;base64,' + readFileSync(ROOT + 'tuna-mark.png').toString('base64');

const CARDS = [
  {
    file: 'compare-auction.png',
    badge: 'AUCTION',
    title: 'Auction Draft Tools, Compared',
    sub: 'Who actually helps you spend your $200 the right way — not just rank players?',
    columns: ['IRON TUNA', 'ESPN / YAHOO', 'SUBSCRIPTION RANKERS'],
    rows: [
      ['Price', ['$9.99 one-time', 'Free', '$5.99+/mo']],
      ['Live re-pricing as bids happen', ['✓', '—', '—']],
      ['AI Value Coach on the clock', ['✓', '—', 'Limited']],
      ['Personal max bid, budget-aware', ['✓', '—', '—']],
    ],
    pill: '$9.99 one-time',
    footer: 'Iron Tuna · Auction Draft Assistant',
  },
  {
    file: 'compare-snake.png',
    badge: 'SNAKE DRAFT',
    title: 'Snake Draft Tools, Compared',
    sub: 'Who tells you the real odds your guy survives to your next pick?',
    columns: ['IRON TUNA', 'SLEEPER / ESPN', 'SUBSCRIPTION RANKERS'],
    rows: [
      ['Price', ['Free, $9.99 full unlock', 'Free', '$30–70+/yr']],
      ['Live survival odds to your next pick', ['✓', '—', '—']],
      ['AI Value Coach in your draft', ['✓', '—', 'Limited']],
      ['Custom scoring, live re-ranking', ['✓', '—', 'Limited']],
    ],
    pill: 'Free to start',
    footer: 'Iron Tuna · Snake Draft Assistant',
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (v, i) => {
  const cls = v === '✓' ? 'yes' : v === '—' ? 'no' : i === 0 ? 'strong' : '';
  return `<td class="${cls}">${esc(v)}</td>`;
};

function cardHtml(c) {
  const head = c.columns.map((h, i) => `<th class="${i === 0 ? 'us' : ''}">${esc(h)}</th>`).join('');
  const rows = c.rows.map(([label, vals]) =>
    `<tr><th scope="row">${esc(label)}</th>${vals.map((v, i) => cell(v, i)).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--bg:#0b1117;--panel:#121b24;--line:#22303b;--text:#e8eef2;--sec:#b6c2cc;--muted:#8595a1;--teal:#2dd4a3;--gold:#f5b800}
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:675px;background:var(--bg);color:var(--text);
      font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
      padding:44px 52px 0;display:flex;flex-direction:column;
      background-image:radial-gradient(900px 420px at 12% -10%, rgba(45,212,163,.10), transparent 60%)}
    .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
    .brand{display:flex;align-items:center;gap:14px}
    .brand img{height:38px;width:auto;display:block}
    .badge{font-family:ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace;font-size:15px;letter-spacing:3px;
      color:var(--teal);border:1.5px solid rgba(45,212,163,.55);border-radius:999px;padding:9px 16px}
    h1{font-size:42px;line-height:1.1;font-weight:800;letter-spacing:-.01em}
    .sub{font-size:19px;color:var(--sec);margin:8px 0 26px}
    table{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel);
      border:1px solid var(--line);border-radius:14px;overflow:hidden;table-layout:fixed}
    col.label{width:34%} col.us{width:22%} col.other{width:22%}
    thead th{font-size:13px;font-weight:800;letter-spacing:1.6px;white-space:nowrap;text-transform:uppercase;color:var(--muted);
      padding:0 12px;height:44px;text-align:center;border-bottom:1px solid var(--line)}
    thead th.us{color:var(--teal);background:rgba(45,212,163,.08)}
    tbody th{text-align:left;font-size:19px;font-weight:700;color:var(--sec);padding:0 18px}
    tbody td{text-align:center;font-size:19px;color:var(--text)}
    tbody tr>*{height:88px;border-bottom:1px solid var(--line)}
    tbody tr:last-child>*{border-bottom:0}
    tbody td:first-of-type{background:rgba(45,212,163,.06)}
    td.strong{font-weight:800;font-size:22px}
    td.yes{font-size:24px}
    td.no{color:var(--muted)}
    .foot{display:flex;align-items:center;gap:16px;margin-top:auto;padding-bottom:36px}
    .pill{background:var(--gold);color:#1a1205;font-weight:800;font-size:19px;border-radius:999px;padding:13px 20px}
    .url{color:var(--teal);font-weight:800;font-size:19px}
    .who{margin-left:auto;color:var(--muted);font-size:17px}
  </style></head><body>
    <div class="top">
      <div class="brand"><img src="${fish}" alt="">${wordmarkSvg({ height: 34 })}</div>
      <div class="badge">${esc(c.badge)}</div>
    </div>
    <h1>${esc(c.title)}</h1>
    <div class="sub">${esc(c.sub)}</div>
    <table><colgroup><col class="label"><col class="us"><col class="other"><col class="other"></colgroup>
      <thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>
    <div class="foot"><span class="pill">${esc(c.pill)}</span><span class="url">irontuna.com</span><span class="who">${esc(c.footer)}</span></div>
  </body></html>`;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
for (const c of CARDS) {
  await page.setContent(cardHtml(c), { waitUntil: 'load' });
  writeFileSync(ROOT + 'social/' + c.file, await page.screenshot({ type: 'png' }));
  console.log('Wrote social/' + c.file);
}
await browser.close();
