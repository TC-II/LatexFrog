// LatexFrog: a document Live comes back to unchanged (a profile, a chapter of a profile that follows the open file) costs no
// TeX, and a pass killed by a newer one does not break the next.
import { it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { documentKey, saveSnapshot, restoreSnapshot, startSnapshot } from '../../../../../../electron/src/lv/draftSnapshot';
import { dropCutLine, repairCutAux } from '../../../../../../electron/src/lv/draftAux';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-draftsnap-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(name: string): { root: string; out: string } {
	const root = path.join(tmp, name);
	const w = (rel: string, t: string) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), t);
	};
	w('main.tex', 'body\n');
	w('Secciones/uno.tex', 'one\n');
	w('Secciones/dos.tex', 'two\n');
	w('refs.bib', '@book{a}\n');
	w('.latexfrog/drivers/lv-a-live.tex', 'driver a\n');
	w('.latexfrog/drivers/lv-b-live.tex', 'driver b\n');
	return { root, out: path.join(root, '_draft') };
}

/** one Live compile of `driver` as the service runs it: restore, or "compile" (write the products) and keep */
function pass(root: string, out: string, driver: string, products: Record<string, string>, result: object, engine = 'lualatex') {
	const start = startSnapshot(root, driver, engine);
	const kept = restoreSnapshot<object>(root, out, driver, start);
	if (kept) return { restored: true, result: kept };
	for (const [rel, text] of Object.entries(products)) {
		fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
		fs.writeFileSync(path.join(out, rel), text);
	}
	saveSnapshot(root, out, driver, engine, start, result);
	return { restored: false, result };
}

let clock = Date.now() + 10_000;
/** writes with an mtime no earlier write had, even on a coarse clock */
function touch(file: string, text: string) {
	fs.writeFileSync(file, text);
	clock += 2000;
	fs.utimesSync(file, new Date(clock), new Date(clock));
}

it('restores a profile kept result while nothing changed, and not after an edit', () => {
	const { root, out } = project('snap');
	const drvA = '.latexfrog/drivers/lv-a-live.tex';
	const drvB = '.latexfrog/drivers/lv-b-live.tex';
	const resA = { ok: true, count: 3, inputs: ['main.tex', 'uno.tex'] };
	expect(pass(root, out, drvA, { 'draft.pdf': 'pdf A', 'draft.aux': 'A', 'Secciones/uno.aux': 'A1' }, resA).restored).toBe(false);
	// Live goes to b, which writes its own products
	fs.rmSync(path.join(out, 'Secciones/uno.aux'));
	expect(pass(root, out, drvB, { 'draft.pdf': 'pdf B', 'draft.aux': 'B' }, { ok: true, count: 1, inputs: ['main.tex'] }).restored).toBe(false);
	// back to a: its result and products come back
	expect(pass(root, out, drvA, {}, {})).toEqual({ restored: true, result: resA });
	expect(fs.readFileSync(path.join(out, 'draft.aux'), 'utf8')).toBe('A');
	expect(fs.readFileSync(path.join(out, 'draft.pdf'), 'utf8')).toBe('pdf A');
	expect(fs.readFileSync(path.join(out, 'Secciones/uno.aux'), 'utf8')).toBe('A1');
	// another engine is another document
	expect(documentKey(root, drvA, 'xelatex')).not.toBe(documentKey(root, drvA, 'lualatex'));
	expect(pass(root, out, drvA, { 'draft.pdf': 'pdf A xe' }, { ok: true }, 'xelatex').restored).toBe(false);
	// an edited source of a is a compile
	touch(path.join(root, 'Secciones/uno.tex'), 'one, edited\n');
	expect(pass(root, out, drvA, { 'draft.pdf': 'pdf A2' }, resA).restored).toBe(false);
});

it('one profile that follows the open chapter keeps a result per chapter, and an edit in one leaves the other good', () => {
	const { root, out } = project('current');
	const drv = '.latexfrog/drivers/lv-a-live.tex';
	const chapter = (name: string) => fs.writeFileSync(path.join(root, drv), `preamble\nbegin document\ninclude only Secciones/${name}\n`);
	const resUno = { ok: true, pages: 'uno', inputs: ['main.tex', 'uno.tex'] };
	const resDos = { ok: true, pages: 'dos', inputs: ['main.tex', 'dos.tex'] };
	chapter('uno');
	expect(pass(root, out, drv, { 'draft.pdf': 'pdf uno', 'Secciones/uno.aux': 'u' }, resUno).restored).toBe(false);
	// the same driver file, rewritten for another chapter: another document, compiled
	chapter('dos');
	expect(pass(root, out, drv, { 'draft.pdf': 'pdf dos', 'Secciones/dos.aux': 'd' }, resDos).restored).toBe(false);
	// back and forth costs nothing
	chapter('uno');
	expect(pass(root, out, drv, {}, {})).toEqual({ restored: true, result: resUno });
	expect(fs.readFileSync(path.join(out, 'draft.pdf'), 'utf8')).toBe('pdf uno');
	// the labels of the chapter just left stay, for the references to it: uno's kept result never had them
	expect(fs.readFileSync(path.join(out, 'Secciones/dos.aux'), 'utf8')).toBe('d');
	expect(fs.readFileSync(path.join(out, 'Secciones/uno.aux'), 'utf8')).toBe('u');
	chapter('dos');
	expect(pass(root, out, drv, {}, {})).toEqual({ restored: true, result: resDos });
	expect(fs.readFileSync(path.join(out, 'draft.pdf'), 'utf8')).toBe('pdf dos');
	// an edit in dos: uno, which never read dos.tex, is still good; dos compiles
	touch(path.join(root, 'Secciones/dos.tex'), 'two, edited\n');
	chapter('uno');
	expect(pass(root, out, drv, {}, {}).restored).toBe(true);
	chapter('dos');
	expect(pass(root, out, drv, { 'draft.pdf': 'pdf dos 2' }, resDos).restored).toBe(false);
	// a file no pass lists (an image, a .bib) counts for every chapter
	touch(path.join(root, 'refs.bib'), '@book{x}\n');
	chapter('uno');
	expect(pass(root, out, drv, { 'draft.pdf': 'pdf uno 2' }, resUno).restored).toBe(false);
	// a file both read (the one that opens the document) drops both
	touch(path.join(root, 'main.tex'), 'body, edited\n');
	expect(pass(root, out, drv, { 'draft.pdf': 'pdf uno 3' }, resUno).restored).toBe(false);
	chapter('dos');
	expect(pass(root, out, drv, { 'draft.pdf': 'pdf dos 3' }, resDos).restored).toBe(false);
});

it('does not keep a result whose sources or driver changed while it compiled, nor one without its PDF', () => {
	const { root, out } = project('raced');
	const drv = '.latexfrog/drivers/lv-a-live.tex';
	const res = { ok: true, inputs: ['main.tex', 'uno.tex'] };
	const again = () => restoreSnapshot(root, out, drv, startSnapshot(root, drv, 'lualatex'));
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'draft.pdf'), 'pdf');
	// a save lands during the pass: the result may be of either text
	let start = startSnapshot(root, drv, 'lualatex');
	touch(path.join(root, 'Secciones/uno.tex'), 'typed meanwhile\n');
	saveSnapshot(root, out, drv, 'lualatex', start, res);
	expect(again()).toBeNull();
	// the driver is rewritten during the pass (another chapter): the result is not kept as either document's
	start = startSnapshot(root, drv, 'lualatex');
	fs.writeFileSync(path.join(root, drv), 'driver a, other parts\n');
	saveSnapshot(root, out, drv, 'lualatex', start, res);
	expect(again()).toBeNull();
	fs.writeFileSync(path.join(root, drv), 'driver a\n');
	expect(again()).toBeNull();
	// no PDF, nothing kept
	fs.rmSync(path.join(out, 'draft.pdf'));
	start = startSnapshot(root, drv, 'lualatex');
	saveSnapshot(root, out, drv, 'lualatex', start, res);
	expect(again()).toBeNull();
	// a pass that landed no pages is not a result worth coming back to
	fs.writeFileSync(path.join(out, 'draft.pdf'), 'pdf');
	start = startSnapshot(root, drv, 'lualatex');
	saveSnapshot(root, out, drv, 'lualatex', start, { ok: true, pages: [], inputs: ['main.tex'] });
	expect(again()).toBeNull();
	// a result that does not say what it read depends on every file
	fs.writeFileSync(path.join(out, 'draft.pdf'), 'pdf');
	start = startSnapshot(root, drv, 'lualatex');
	saveSnapshot(root, out, drv, 'lualatex', start, { ok: true });
	expect(again()).toEqual({ ok: true });
	touch(path.join(root, 'Secciones/dos.tex'), 'any file\n');
	expect(again()).toBeNull();
});

it('drops the line a killed pass left cut in an aux, and nothing else', () => {
	const dir = path.join(tmp, 'aux', '_draft');
	fs.mkdirSync(path.join(dir, 'Secciones'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'snap', 'k', 'files'), { recursive: true });
	const whole = 'relax\nnewlabel{a}{{1}{2}}\n';
	const cut = whole + 'newlabel{b}{{3}{';
	fs.writeFileSync(path.join(dir, 'draft.aux'), cut);
	fs.writeFileSync(path.join(dir, 'Secciones/uno.aux'), whole);
	fs.writeFileSync(path.join(dir, 'Secciones/dos.aux'), 'newlabel{c}{{1');
	// the warm engine's own aux and a kept result are not to be touched
	fs.writeFileSync(path.join(dir, 'texd_warm.aux'), cut);
	fs.writeFileSync(path.join(dir, 'snap/k/files/draft.aux'), cut);
	expect(repairCutAux(dir)).toBe(2);
	expect(fs.readFileSync(path.join(dir, 'draft.aux'), 'utf8')).toBe(whole);
	expect(fs.readFileSync(path.join(dir, 'Secciones/uno.aux'), 'utf8')).toBe(whole);
	expect(fs.readFileSync(path.join(dir, 'Secciones/dos.aux'), 'utf8')).toBe('');
	expect(fs.readFileSync(path.join(dir, 'texd_warm.aux'), 'utf8')).toBe(cut);
	expect(fs.readFileSync(path.join(dir, 'snap/k/files/draft.aux'), 'utf8')).toBe(cut);
	// nothing left to repair, and a missing file is not an error
	expect(repairCutAux(dir)).toBe(0);
	expect(dropCutLine(path.join(dir, 'absent.aux'))).toBe(false);
	// a cut far from the last newline: more than one block back
	fs.writeFileSync(path.join(dir, 'draft.aux'), whole + 'x'.repeat(10000));
	expect(dropCutLine(path.join(dir, 'draft.aux'))).toBe(true);
	expect(fs.readFileSync(path.join(dir, 'draft.aux'), 'utf8')).toBe(whole);
});
