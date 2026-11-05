import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { resolveGotoTarget } from '$lib/editor/source/sourceGotoTarget';
import { refineClick } from '$lib/lv/lvSync';
import { fileTier, fuzzyScore } from '$lib/palette/paletteFilter';
import { jobReason } from '$lib/lv/lvFormat';
import { cleanBlock, groupFigures, type Figure } from '$lib/lv/lvFigures';
import { exportName, figuresOf, flagUse, outputsOf, partCommands, removeVariable, setFigures, setFlag, setOutputs, setPartCommands, setVariable, useDetected, type ConfigJson } from '$lib/lv/lvProfiles';

const figure = (nombre: string, archivo: string | null, estado: Figure['estado']): Figure => ({ nombre, slug: null, archivo, estado, bytes: 1 });

describe('figures', () => {
	it('groups by file, alphabetically, with the ones without a file last', () => {
		const groups = groupFigures([figure('a', 'z.tex', 'aldia'), figure('b', null, 'fallo'), figure('c', 'a.tex', 'falta'), figure('d', 'a.tex', 'fallo')]);
		expect(groups.map((g) => g.file)).toEqual(['a.tex', 'z.tex', null]);
		expect(groups[0]).toMatchObject({ done: 0, pending: 1, failed: 1 });
	});

	it('only a complete list of today and of this root allows cleaning', () => {
		const list = { fechaMs: 0, total: 1, completa: true, delSelloDeHoy: true, vale: true };
		expect(cleanBlock(list)).toBeNull();
		expect(cleanBlock(null)).toBe('no-list');
		expect(cleanBlock({ ...list, completa: false })).toBe('partial');
		expect(cleanBlock({ ...list, delSelloDeHoy: false })).toBe('stamp');
		expect(cleanBlock({ ...list, vale: false })).toBe('other-root');
	});
});

describe('project edits', () => {
	it('a part command list never goes empty', () => {
		expect(partCommands({})).toEqual(['include']);
		expect(partCommands(setPartCommands({}, [' ', '']))).toEqual(['include']);
		expect(partCommands(setPartCommands({}, ['include', 'Capitulo', 'include']))).toEqual(['include', 'Capitulo']);
	});

	it('a macro has one use', () => {
		let c: ConfigJson = setFlag({}, 'Rapido', 'partial');
		expect(flagUse(c, 'Rapido')).toBe('partial');
		c = setFlag(c, 'Rapido', 'externalize');
		expect(flagUse(c, 'Rapido')).toBe('externalize');
		expect((c.flags as { partial: string[] }).partial).toEqual([]);
		expect(flagUse(setFlag(c, 'Rapido', 'ninguno'), 'Rapido')).toBe('ninguno');
	});

	it('figures keep what the screen does not show', () => {
		const c: ConfigJson = { figureCache: { mode: 'project', dir: 'x', parallelJobs: 3, unknown: true } };
		const next = setFigures(c, { ...figuresOf(c), dir: 'y', stampFiles: ['a.tex', ' '] });
		expect(next.figureCache).toEqual({ mode: 'project', dir: 'y', parallelJobs: 3, unknown: true, stampFiles: ['a.tex'] });
		expect(setFigures(c, { ...figuresOf(c), mode: 'off' }).figureCache).toBeUndefined();
	});

	it('outputs keep the per-profile names and an empty folder removes the section', () => {
		const c: ConfigJson = { publish: { dir: 'a', names: { p: 'x.pdf' } } };
		expect(setOutputs(c, { ...outputsOf(c), publish: 'b' }).publish).toEqual({ dir: 'b', names: { p: 'x.pdf' } });
		const empty = setOutputs(c, { ...outputsOf(c), publish: '' });
		expect(empty.publish).toBeUndefined();
		expect(empty.export).toBeUndefined();
	});

	it('removing the last variable removes the section', () => {
		const c = setVariable({}, 'Pie', { label: 'Pie', choices: ['a'] });
		expect(c.variables?.Pie.choices).toEqual(['a']);
		expect(removeVariable(c, 'Pie').variables).toBeUndefined();
	});

	it('use detected copies one section and removes it when nothing was detected', () => {
		const c: ConfigJson = { root: 'a.tex', publish: { dir: 'x' }, export: { dir: 'y' }, flags: { partial: ['A'] } };
		const detected: ConfigJson = { root: 'b.tex', flags: { partial: ['B'] } };
		const next = useDetected(c, detected, 'outputs');
		expect(next).toEqual({ root: 'a.tex', flags: { partial: ['A'] } });
		expect(useDetected(c, detected, 'root').root).toBe('b.tex');
	});

	it('names an exported part like the engine', () => {
		expect(exportName('{num:02} - {name}.pdf', '8', 'Cauer')).toBe('08 - Cauer.pdf');
		expect(exportName('{num}.pdf', '12', 'x')).toBe('12.pdf');
	});
});

describe('finding a clicked word and a file', () => {
	const word = (texto: string, x: number) => ({ texto, clave: texto.toLowerCase(), page: 1, x, y: 10, w: 20, h: 10 });

	it('finds the clicked word in a line next to the one SyncTeX named', async () => {
		const words = ['los', 'filtros', 'pasivos'].map((t, i) => word(t, i * 30));
		const viewer = { pageWords: async () => words };
		const spot = await refineClick(viewer, { page: 1, x: 35, y: 12 }, 1, 'nada que ver\nacá hay los filtros pasivos\n');
		expect(spot).toEqual({ line: 2, from: 12, to: 19 });
	});

	it('stays on the line when the word is not there', async () => {
		const viewer = { pageWords: async () => [word('otra', 0)] };
		expect(await refineClick(viewer, { page: 1, x: 5, y: 12 }, 2, 'a\nb\n')).toEqual({ line: 2 });
	});

	it('the palette matches a name typed without its accent, on the original string', () => {
		const hit = fuzzyScore('Secciones/Desnormalización.tex', 'desnormalizacion');
		expect(hit).not.toBeNull();
		expect(hit?.hits.at(-1)).toBe('Secciones/Desnormalización'.length - 1);
	});

	it('a jump with both columns selects the word', () => {
		const doc = Text.of(['abc def']);
		expect(resolveGotoTarget(doc, { line: 1, column: 4, columnEnd: 7 })).toEqual({ from: 4, to: 7 });
		expect(resolveGotoTarget(doc, { line: 1, column: 4 })).toEqual({ from: 4, to: 4 });
	});
});

describe('the order of files in the finder', () => {
	it('puts .tex first and what the compile generates last', () => {
		const names = ['Desnormalización.aux', 'notas.md', 'Desnormalización.tex', 'x.log', 'refs.bib'];
		expect([...names].sort((a, b) => fileTier(a) - fileTier(b))).toEqual(['Desnormalización.tex', 'notas.md', 'refs.bib', 'Desnormalización.aux', 'x.log']);
	});

	it('names a job reason in words', () => {
		expect(jobReason('guardado: cap.tex')).toBe('saved cap.tex');
		expect(jobReason('el resto')).toBe('remaining figures');
		expect(jobReason('manual')).toBe('manual');
	});
});
