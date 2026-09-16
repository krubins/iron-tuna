// Generates og.png, the 1200x630 preview every page names in og:image / twitter:image
// (tools/build-seo.mjs falls back to it; tools/build-ranks.mjs writes it directly).
//
// The mark is the header word mark (tools/wordmark.mjs, outlined paths, so it is the
// same mark at any size with no font on the machine) beside the tuna mark the landing
// page uses (tuna-mark.png). The old og.png set the name as tall condensed type in
// flat white, which read as a different, stretched brand from the header's staggered
// metal letters; that is the drift this file exists to prevent. The tagline is the
// landing page's, in Bebas Neue from tools/fonts (embedded, so no network at build).
//
// Needs playwright-core on the resolution path (`npm i --no-save playwright-core`,
// nothing is committed) and a Chromium binary: /opt/pw-browsers/chromium in Claude
// Code remote sessions, else set CHROMIUM_PATH. Run `node tools/build-og.mjs` and
// commit the PNG. Copy lives in TAGLINE / SUBLINE below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { wordmarkSvg } from './wordmark.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const fish = 'data:image/png;base64,' + readFileSync(ROOT + 'tuna-mark.png').toString('base64');
const bebas = 'data:font/ttf;base64,' + readFileSync(ROOT + 'tools/fonts/BebasNeue-Regular.ttf').toString('base64');

const TAGLINE = 'RULE THE DRAFT. OWN THE LEAGUE.';
const SUBLINE = 'The most comprehensive tool for fantasy football auction drafts';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'Bebas Neue';src:url(${bebas}) format('truetype')}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;color:#e8eef2;
    font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
    background:#0b1117 radial-gradient(760px 480px at 27% 36%, rgba(45,212,163,.22), rgba(16,56,71,.35) 38%, transparent 70%);
    display:flex;flex-direction:column;align-items:center;justify-content:center}
  .lockup{display:flex;align-items:center;gap:44px;margin-top:-26px}
  .lockup img{width:400px;height:auto;display:block;
    filter:drop-shadow(0 0 28px rgba(45,212,163,.18)) drop-shadow(0 6px 18px rgba(0,0,0,.6))}
  .lockup svg{filter:drop-shadow(0 4px 14px rgba(0,0,0,.55))}
  .tag{margin-top:78px;font-family:'Bebas Neue','Impact',sans-serif;font-size:46px;line-height:1;
    letter-spacing:.22em;color:#9fe1cb;text-indent:.22em}
  .sub{margin-top:26px;font-size:27px;color:#aebcc6;letter-spacing:.005em}
</style></head><body>
  <div class="lockup"><img src="${fish}" alt=""><div>${wordmarkSvg({ height: 108 })}</div></div>
  <div class="tag">${TAGLINE}</div>
  <div class="sub">${SUBLINE}</div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
writeFileSync(ROOT + 'og.png', await page.screenshot({ type: 'png' }));
await browser.close();
console.log('Wrote og.png (1200x630) — commit it.');
