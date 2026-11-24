import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { jobPrefix, writeHooksFile, OUT } from '../../../../../../electron/src/draft/compileJob';
import { hasLualatex } from '../../lib/draw/engines/lualatexEngine';

// A page the shipout hooks draw on (eso-pic's frame, a title page's band) has that material only in the PDF: the
// records are taken in shipout/before, ahead of it. The manifest marks such a page "lay", so a patch on it keeps the
// pass that brings the PDF raster back; without the mark an exact patch left the page without its frame for good.
const engineDir = path.resolve(__dirname, '../../../../../../electron/lua').replace(/\\/g, '/');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-shipout-layers-')));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function layOf(name: string, preamble: string, body: string): (number | undefined)[] {
	const dir = path.join(root, name);
	fs.mkdirSync(path.join(dir, OUT), { recursive: true });
	writeHooksFile(path.join(dir, OUT));
	const doc = [jobPrefix(engineDir), '\\documentclass{article}', preamble, '\\begin{document}', body, '\\end{document}', ''].join('\n');
	fs.writeFileSync(path.join(dir, 'main.tex'), doc);
	const r = spawnSync('lualatex', ['-interaction=nonstopmode', '-halt-on-error', 'main.tex'], { cwd: dir, encoding: 'utf8' });
	expect(r.status, r.stdout.slice(-2000)).toBe(0);
	const m = JSON.parse(fs.readFileSync(path.join(dir, OUT, 'pages.json'), 'utf8')) as { pages: { lay?: number }[] };
	return m.pages.map((p) => p.lay);
}

const filler = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of filler text.\\par`).join('\n');

describe.skipIf(!hasLualatex)('pages the shipout hooks draw on', () => {
	it('marks every page under a frame and only the first under a cover', () => {
		const pre = '\\usepackage{eso-pic}\n\\usepackage{tikz}\n\\AddToShipoutPictureBG{\\AtPageLowerLeft{\\rule{1cm}{\\paperheight}}}';
		const cover =
			'\\AddToShipoutPictureFG*{\\AtPageUpperLeft{\\begin{tikzpicture}[overlay]\\fill (0,0) rectangle (\\paperwidth,-5cm);\\end{tikzpicture}}}';
		expect(layOf('framed', pre, filler)).toEqual([1, 1, 1]);
		expect(layOf('cover', '\\usepackage{eso-pic}\n\\usepackage{tikz}', cover + filler)).toEqual([1, undefined, undefined]);
	}, 120000);

	it('marks nothing when the hooks draw nothing', () => {
		const pre = '\\usepackage{eso-pic}\n\\usepackage{xcolor}\n\\usepackage{hyperref}';
		expect(layOf('plain', pre, '\\section{One}\\label{a} See \\ref{a}. {\\color{red} red}\n' + filler)).toEqual([
			undefined,
			undefined,
			undefined
		]);
	}, 120000);
});
