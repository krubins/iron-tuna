// The IRON TUNA word mark for anything that is not a page: og.png, the social cards,
// the static OG SVGs. Same letters, same stagger, same seven metal stops as the header
// <svg class="brand-logo"> on every page, but drawn as outlined paths (see
// tools/build-wordmark.mjs) so it renders identically with no font installed. Use this
// rather than setting "IRON TUNA" as type: type in a generator falls back to whatever
// font the machine has, and that is how the banners drifted from the header.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('./wordmark-paths.json', import.meta.url), 'utf8'));

export const WORDMARK_VIEWBOX = data.viewBox;
export const WORDMARK_WIDTH = data.width;   // viewBox units
export const WORDMARK_HEIGHT = data.height; // viewBox units
export const WORDMARK_ASPECT = data.width / data.height;
export const WORDMARK_PATHS = data.paths;

// The header's gradient, stop for stop (site.css: "the same seven stops, one mark").
export const WORDMARK_STOPS = [
  ['0%', '#ffffff'], ['20%', '#dde8ee'], ['44%', '#a4bbc2'], ['50%', '#7d99a0'],
  ['55%', '#6f928b'], ['74%', '#b0c2c8'], ['100%', '#46555e'],
];

export function wordmarkGradient(id = 'wordMetal') {
  const stops = WORDMARK_STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
}

// A standalone <svg> sized by height (width follows the viewBox). Drop it into HTML.
export function wordmarkSvg({ height = 30, id = 'wordMetal', attrs = '' } = {}) {
  const paths = WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join('');
  return `<svg viewBox="${WORDMARK_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Iron Tuna" ` +
    `style="height:${height}px;width:auto;display:block" ${attrs}><defs>${wordmarkGradient(id)}</defs>` +
    `<g fill="url(#${id})">${paths}</g></svg>`;
}

// A <g> to place inside another SVG: the mark's top-left lands at (x, y) at the given
// height in that SVG's user units. Add wordmarkGradient(id) to the host's <defs>.
export function wordmarkGroup({ x = 0, y = 0, height = WORDMARK_HEIGHT, id = 'wordMetal' } = {}) {
  const s = height / WORDMARK_HEIGHT;
  const paths = WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${+s.toFixed(5)})" fill="url(#${id})">${paths}</g>`;
}

// Width in host units of a mark drawn at `height`.
export function wordmarkWidth(height) { return height * WORDMARK_ASPECT; }

// ── the mark on a PAGE ───────────────────────────────────────────────────────
// The header <svg class="brand-logo"> (and front.html's .mast-logo) used to draw the
// same eight letters as <text> in Bebas Neue. That is the one place the web font
// could still fail the mark: until Google Fonts answers, or when it never does, the
// browser sets the name in Impact or the system sans, and the reader sees a wider
// or taller "IRON TUNA" than every banner carries. So the page header draws the
// outlined paths too. Each page keeps its own <defs> (lead.html inverts the stops
// for a white page); only the letter group is swapped.
export const WORDMARK_LETTERS = `<g fill="url(#wordMetal)">${WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`;

// The eight <text> letters exactly as every page carried them, at any font-size
// rounding (57.99999999999999 and 58 both appear). Anchored on the first letter's x
// so nothing else set in Bebas on a page is touched.
const TEXT_LETTERS = /<g>(?:<text x="[\d.]+" y="27\.5\d*" font-family="'Bebas Neue','Impact',sans-serif" font-size="[\d.]+" text-anchor="middle" dominant-baseline="central" fill="url\(#wordMetal\)">[IRONTUA]<\/text>){8}<\/g>/g;

// Rewrites a page's header word mark from type to the outlined paths. Idempotent:
// a page already carrying the paths comes back unchanged.
export function putWordmark(html) {
  return html.replace(TEXT_LETTERS, WORDMARK_LETTERS);
}
