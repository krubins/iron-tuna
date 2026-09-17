// Regenerates tools/wordmark-paths.json: the IRON TUNA word mark as outlined paths.
//
// The site's word mark is eight letters in Bebas Neue at staggered sizes, filled with
// the metal gradient. It used to be <text> in the web font, on the page header and in
// every banner, and that depended on the font being loaded: a raster generator or a
// static SVG never has it, and a page only has it once Google Fonts answers, so the
// fallback (Impact, or the system sans) drew a taller, stretched "IRON TUNA" on the
// banners and, for any reader whose font never arrived, on the page. This script
// traces the eight letters out of the font into plain <path> data, so the header on
// every page (tools/wordmark.mjs putWordmark, index.html's LogoMark) and every banner
// draw the mark identically with no font anywhere.
//
// Geometry is the original header SVG's (viewBox 0 0 296.6 56, each letter
// text-anchor=middle at its x, dominant-baseline=central at y=27.5). Chromium's
// "central" is the midpoint of the ascender/descender box, which is what is computed
// here; an overlay of the two renders showed no offset.
//
// Needs opentype.js on the resolution path (`npm i --no-save opentype.js`, nothing is
// committed). The font is tools/fonts/BebasNeue-Regular.ttf (SIL OFL, licence beside it).
// Only run this if the letters, sizes or positions change; the JSON is committed. After a
// rerun, `node tools/put-wordmark.mjs` will not touch pages that already carry paths:
// swap the old path group out by hand (or from git) and paste the new paths into
// index.html's WORDMARK_PATHS as well.
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';

const ROOT = new URL('..', import.meta.url).pathname;
const buf = readFileSync(ROOT + 'tools/fonts/BebasNeue-Regular.ttf');
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// [letter, x (text-anchor middle), font-size] — the header SVG, letter for letter.
const LETTERS = [
  ['I', 10.40, 65], ['R', 40.86, 58], ['O', 76.92, 50], ['N', 109.14, 46],
  ['T', 155.08, 46], ['U', 187.30, 50], ['N', 222.40, 55], ['A', 262.30, 65],
];
const CY = 27.5;
const os2 = font.tables.os2, hhea = font.tables.hhea;
const useTypo = (os2.fsSelection & (1 << 7)) !== 0;
const asc = useTypo ? os2.sTypoAscender : hhea.ascender;
const desc = useTypo ? os2.sTypoDescender : hhea.descender;

const paths = LETTERS.map(([ch, x, fs]) => {
  const glyph = font.charToGlyph(ch);
  const scale = fs / font.unitsPerEm;
  const baseline = CY + ((asc + desc) / 2) * scale;
  return glyph.getPath(x - (glyph.advanceWidth * scale) / 2, baseline, fs).toPathData(2);
});

writeFileSync(ROOT + 'tools/wordmark-paths.json', JSON.stringify({ viewBox: '0 0 296.6 56.0', width: 296.6, height: 56, paths }, null, 1) + '\n');
console.log(`Wrote ${paths.length} letter paths to tools/wordmark-paths.json`);
