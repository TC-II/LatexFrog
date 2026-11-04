// Every app icon from branding/Logo-icon.svg, and the two wordmarks. `node scripts/make-icons.mjs` needs
// @resvg/resvg-js, not a project dependency: install it anywhere and point RESVG at that folder;
// afterwards scripts/make-icns.py turns electron/icon.png into electron/icon.icns.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { Resvg } = createRequire(path.join(process.env.RESVG ?? process.cwd(), 'x.js'))('@resvg/resvg-js');
const svg = fs.readFileSync('branding/Logo-icon.svg', 'utf8');
const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

fs.writeFileSync('electron/icon.png', png(1024));
for (const s of [16, 32, 48, 64, 128, 256, 512]) fs.writeFileSync(`build/icons/${s}x${s}.png`, png(s));
fs.copyFileSync('branding/Logo-icon.svg', 'apps/texpile-editor/public/favicon.svg');

// the wordmark keeps the icon's shapes inline; the name is live text, so it needs no font file
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const wordmark = (ink) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 512" role="img" aria-label="LatexFrog">
<g>${inner}</g>
<text x="560" y="350" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="230" font-weight="600" fill="${ink}">LatexFrog</text>
</svg>
`;
fs.writeFileSync('branding/Logo-dark.svg', wordmark('#10301f')); // dark ink, for light backgrounds
fs.writeFileSync('branding/Logo-light.svg', wordmark('#f2f7ef'));
