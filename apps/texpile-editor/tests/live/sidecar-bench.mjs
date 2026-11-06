// The live engine through lv-sidecar on a fixture copy: draft compile, then paragraph typesets, timed.
// node tests/live/sidecar-bench.mjs <project folder> [main.tex]   (LV_SIDECAR names the sidecar binary)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './engineBridge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, '../../../../electron/lua').replace(/\\/g, '/');
const root = path.resolve(process.argv[2]);
const mainFile = process.argv[3] || 'main.tex';
const { draftService, draftDaemon } = loadEngine();
const readBack = { byTex: ['aux', 'toc'], byTools: [] };

const ms = (t) => +(performance.now() - t).toFixed(1);
for (const pass of ['cold', 'warm']) {
	const t = performance.now();
	const r = await draftService.compileDraft({ root, mainFile, engineDir, readBack });
	console.log(`compile ${pass}: ${ms(t)} ms, ok=${r.ok}, pages=${r.pages?.length ?? 0}${r.error ? ', ' + r.error : ''}`);
}
const para = 'Un párrafo de prueba con $\\int_0^1 x^2\\,dx$ y texto que corta en varios renglones. '.repeat(4);
let t = performance.now();
let r = await draftDaemon.typesetParagraph({ root, mainFile, engineDir, text: para });
console.log(`daemon warm-up + first paragraph: ${ms(t)} ms, ok=${r.ok}`);
const times = [];
for (let i = 0; i < 30; i++) {
	t = performance.now();
	r = await draftDaemon.typesetParagraph({ root, mainFile, engineDir, text: para + i });
	times.push(ms(t));
}
times.sort((a, b) => a - b);
console.log(`paragraph: median ${times[15]} ms, max ${times[29]} ms, ok=${r.ok}, lines=${r.lines?.length ?? r.lines}`);
draftDaemon.stopDaemon();
process.exit(0);
