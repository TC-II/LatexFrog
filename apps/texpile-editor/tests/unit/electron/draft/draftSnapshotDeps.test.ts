// LatexFrog: what a kept Live result depends on, and what a changed one still gives the next pass.
import { it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { primeFromKept, projectFingerprint, saveSnapshot, restoreSnapshot, sourcesInSynctex, startSnapshot } from '../../../../../../electron/src/lv/draftSnapshot';
import { biberInputs } from '../../../../../../electron/src/draft/draftBib';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-draftdeps-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DRV = '.latexfrog/drivers/lv-a-live.tex';

/** a book whose root and first chapter share a file name, as the primary test book's do */
function book(name: string): { root: string; out: string } {
	const root = path.join(tmp, name);
	const w = (rel: string, t: string) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), t);
	};
	w('Libro.tex', 'root\n');
	w('Secciones/Libro.tex', 'chapter one, named as the root\n');
	w('Secciones/Dos.tex', 'chapter two\n');
	w('Secciones/listing.tex', 'read with read, not input\n');
	w('refs.bib', '@book{a}\n');
	w(DRV, 'driver\n');
	fs.mkdirSync(path.join(root, '_draft'), { recursive: true });
	return { root, out: path.join(root, '_draft') };
}

/** the SyncTeX a pass that input these files leaves, named as LuaTeX names them */
function synctex(root: string, out: string, files: string[]) {
	const abs = root.replace(/\\/g, '/');
	// as LuaTeX writes it: the first inputs, the header, and the files read later among the content
	const input = (f: string, i: number) => `Input:${i + 1}:${abs}/./${f}`;
	const lines = ['SyncTeX Version:1', input(files[0], 0), 'Input:90:c:/texlive/texmf-dist/tex/latex/base/book.cls', `Input:91:${abs}/./_draft/draft.aux`, 'Output:pdf', 'Content:', '{1', ...files.slice(1).map((f, i) => input(f, i + 1)), '}1'];
	fs.writeFileSync(path.join(out, 'draft.synctex.gz'), zlib.gzipSync(lines.join('\n')));
}

let clock = Date.now() + 10_000;
function touch(file: string, text: string) {
	fs.writeFileSync(file, text);
	clock += 2000;
	fs.utimesSync(file, new Date(clock), new Date(clock));
}

const chapter = (root: string, name: string) => fs.writeFileSync(path.join(root, DRV), `driver of ${name}\n`);
const kept = (root: string, out: string) => restoreSnapshot<{ pages: string[] }>(root, out, DRV, startSnapshot(root, DRV, 'lualatex'));
function compile(root: string, out: string, files: string[], products: Record<string, string>, result: object) {
	const start = startSnapshot(root, DRV, 'lualatex');
	for (const [rel, text] of Object.entries(products)) {
		fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
		fs.writeFileSync(path.join(out, rel), text);
	}
	synctex(root, out, files);
	saveSnapshot(root, out, DRV, 'lualatex', start, result);
}

it('reads the project sources a pass input from its SyncTeX, by path', () => {
	const { root, out } = book('synctex');
	synctex(root, out, ['.latexfrog/drivers/lv-a-live.tex', 'Libro.tex', 'Secciones/Dos.tex', 'img/plot.pdf', '.latexfrog/piezas/a/Secciones/Libro.tex']);
	// not the driver, the aux, the TeX tree, nor what is not a source; a copy with pieces commented out is its original
	expect([...sourcesInSynctex(root, path.join(out, 'draft.synctex.gz'))!].sort()).toEqual(['libro.tex', 'secciones/dos.tex', 'secciones/libro.tex']);
	expect(sourcesInSynctex(root, path.join(out, 'absent.synctex.gz'))).toBeNull();
});

it('an edit in a chapter named as the root file does not drop the other chapters', () => {
	const { root, out } = book('collision');
	const resDos = { ok: true, pages: ['dos'], inputs: ['libro.tex', 'dos.tex', 'lv-a-live.tex'] };
	chapter(root, 'dos');
	compile(root, out, ['Libro.tex', 'Secciones/Dos.tex'], { 'draft.pdf': 'pdf dos' }, resDos);
	// chapter one changes: by name it is `libro.tex`, which chapter two did read (the root); by path it did not
	touch(path.join(root, 'Secciones/Libro.tex'), 'chapter one, edited\n');
	expect(kept(root, out)).toEqual(resDos);
	// the root itself does drop it
	touch(path.join(root, 'Libro.tex'), 'root, edited\n');
	expect(kept(root, out)).toBeNull();
});

it('a source the pass read without inputting it (no path in SyncTeX) still counts, by name', () => {
	const { root, out } = book('byname');
	const res = { ok: true, pages: ['dos'], inputs: ['libro.tex', 'dos.tex', 'listing.tex'] };
	chapter(root, 'dos');
	compile(root, out, ['Libro.tex', 'Secciones/Dos.tex'], { 'draft.pdf': 'pdf' }, res);
	expect(kept(root, out)).toEqual(res);
	touch(path.join(root, 'Secciones/listing.tex'), 'changed\n');
	expect(kept(root, out)).toBeNull();
});

it('keeps a result when the compile itself wrote a file that is not a source, and not when a source changed', () => {
	const { root, out } = book('logfile');
	const res = { ok: true, pages: ['dos'], inputs: ['libro.tex', 'dos.tex'] };
	chapter(root, 'dos');
	let start = startSnapshot(root, DRV, 'lualatex');
	fs.writeFileSync(path.join(out, 'draft.pdf'), 'pdf');
	synctex(root, out, ['Libro.tex', 'Secciones/Dos.tex']);
	// the project's own latexmkrc logs each run beside the sources
	touch(path.join(root, 'registro-compilacion.txt'), 'run 1\n');
	saveSnapshot(root, out, DRV, 'lualatex', start, res);
	expect(kept(root, out)).toEqual(res);
	// that file is like an image for the fingerprint: changed later, it drops the result
	touch(path.join(root, 'registro-compilacion.txt'), 'run 2\n');
	expect(kept(root, out)).toBeNull();
	// a source typed in while the pass ran: not kept
	start = startSnapshot(root, DRV, 'lualatex');
	touch(path.join(root, 'Secciones/Dos.tex'), 'typed meanwhile\n');
	saveSnapshot(root, out, DRV, 'lualatex', start, res);
	expect(kept(root, out)).toBeNull();
	expect(projectFingerprint(root, 'sources')).not.toBe(projectFingerprint(root, 'all'));
});

it('a changed document starts its compile from its own last aux and bibliography, not the other chapter\'s', () => {
	const { root, out } = book('prime');
	chapter(root, 'uno');
	compile(root, out, ['Libro.tex', 'Secciones/Libro.tex'], { 'draft.pdf': 'pdf uno', 'draft.aux': 'aux uno', 'draft.bbl': 'bbl uno', 'draft.bcfhash': 'h1', 'draft.toc': 'toc uno', 'draft.log': 'log uno', 'Secciones/Libro.aux': 'part uno' }, { ok: true, pages: ['uno'], inputs: ['libro.tex'] });
	chapter(root, 'dos');
	compile(root, out, ['Libro.tex', 'Secciones/Dos.tex'], { 'draft.pdf': 'pdf dos', 'draft.aux': 'aux dos', 'draft.bbl': 'bbl dos', 'draft.bcfhash': 'h2', 'draft.log': 'log dos', 'draft.lof': 'lof dos', 'Secciones/Dos.aux': 'part dos' }, { ok: true, pages: ['dos'], inputs: ['libro.tex', 'dos.tex'] });
	fs.rmSync(path.join(out, 'draft.toc'), { force: true });
	// chapter one is edited and gone back to: no kept result, but its products come back for the pass to read
	touch(path.join(root, 'Secciones/Libro.tex'), 'chapter one, edited\n');
	chapter(root, 'uno');
	const start = startSnapshot(root, DRV, 'lualatex');
	expect(restoreSnapshot(root, out, DRV, start)).toBeNull();
	expect(primeFromKept(out, start)).toBe(true);
	const read = (rel: string) => fs.readFileSync(path.join(out, rel), 'utf8');
	expect([read('draft.aux'), read('draft.bbl'), read('draft.bcfhash'), read('draft.toc'), read('Secciones/Libro.aux')]).toEqual(['aux uno', 'bbl uno', 'h1', 'toc uno', 'part uno']);
	// what chapter two wrote and chapter one never had is gone, except the labels of chapter two
	expect(fs.existsSync(path.join(out, 'draft.lof'))).toBe(false);
	expect(read('Secciones/Dos.aux')).toBe('part dos');
	// the PDF and the log on screen stay until the pass writes its own
	expect([read('draft.pdf'), read('draft.log')]).toEqual(['pdf dos', 'log dos']);
	// a document never kept has nothing to start from
	chapter(root, 'tres');
	expect(primeFromKept(out, startSnapshot(root, DRV, 'lualatex'))).toBe(false);
});

it('biber runs again for other citations or an edited .bib, and not otherwise', () => {
	const { root } = book('biber');
	const bcf = (cites: string) => Buffer.from(`<bcf:controlfile>${cites}<bcf:datasource type="file" datatype="bibtex" glob="false">refs.bib</bcf:datasource><bcf:datasource type="file">other</bcf:datasource></bcf:controlfile>`);
	const a = biberInputs(root, bcf('a'));
	expect(biberInputs(root, bcf('a'))).toBe(a);
	expect(biberInputs(root, bcf('b'))).not.toBe(a);
	touch(path.join(root, 'refs.bib'), '@book{a}\n@book{b}\n');
	const edited = biberInputs(root, bcf('a'));
	expect(edited).not.toBe(a);
	// a source named without its extension
	touch(path.join(root, 'other.bib'), '@book{c}\n');
	expect(biberInputs(root, bcf('a'))).not.toBe(edited);
});
