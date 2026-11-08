import { describe, expect, it } from 'vitest';
import { compileTarget, defaultProfiles, emptyProfile, outputName, parseConfig, partLabel, profileId, relativeFolder, removeProfile, rows, selectionOf, setProfile, toParts, watermarkDefaults, withGroups, watermarkPreviewText, type ConfigJson } from '$lib/lv/lvProfiles';

describe('profile config', () => {
	it('keeps what it does not know and does not write defaults', () => {
		const config: ConfigJson = { future: 1, profiles: { a: { label: 'A', other: 2, externalize: true } } };
		const out = setProfile(config, 'a', { externalize: false, parts: 'all', omit: [] });
		expect(out.future).toBe(1);
		expect(out.profiles?.a).toEqual({ label: 'A', other: 2 });
		expect(config.profiles?.a.externalize).toBe(true);
	});

	it('removes a profile without touching the others', () => {
		expect(Object.keys(removeProfile({ profiles: { a: {}, b: {} } }, 'a').profiles ?? {})).toEqual(['b']);
	});

	it('makes free ASCII ids', () => {
		expect(profileId('Capítulo actual', [])).toBe('capitulo-actual');
		expect(profileId('A', ['a'])).toBe('a-2');
	});

	it('starts a new profile empty', () => {
		const p = emptyProfile([{ clave: 'toc', nombre: 'Contents' }], 1, 'One');
		expect(p).toEqual({ label: 'One', color: '#378ADD', parts: 'list', partList: [], omit: ['toc'], externalize: true });
	});

	it('drops the old project variables on reading, so the next save leaves them out', () => {
		const c = parseConfig('{ "root": "a.tex", "variables": { "OpcionPie": {} }, "profiles": { "p": { "vars": { "OpcionPie": "autor" }, "label": "P" } } }');
		expect(c).toEqual({ root: 'a.tex', profiles: { p: { label: 'P' } } });
	});
});

describe('chapters of a profile', () => {
	it('goes both ways', () => {
		for (const parts of ['all', 'current', 'list'] as const) expect(toParts(selectionOf({ parts, partList: ['x'] }))).toEqual({ parts, partList: ['x'] });
		expect(selectionOf({})).toEqual({ all: true, current: false, list: [] });
	});

	it('orders the rows like the book', () => {
		const pieces = [
			{ clave: 'toc', nombre: 'Contents' },
			{ clave: 'index', nombre: 'Index', lugar: 'despues' }
		];
		expect(rows(pieces, ['A']).map((r) => r.kind)).toEqual(['piece', 'current', 'all', 'chapter', 'piece']);
		expect(rows(pieces, []).map((r) => r.kind)).toEqual(['piece', 'piece']);
	});

	it('puts the pieces a chapter prints under that chapter, as Contents does', () => {
		const pieces = [
			{ clave: 'block:makecover', nombre: 'makecover', lugar: 'dentro', parte: 'g/G1/main' },
			{ clave: 'block:makecover#2', nombre: 'makecover', lugar: 'dentro', parte: 'g/G2/main' },
			{ clave: 'block:makesolutions', nombre: 'makesolutions', lugar: 'dentro', parte: 'g/G1/main' }
		];
		const r = rows(pieces, ['g/G1/main', 'g/G2/main']).map((x) => (x.kind === 'piece' ? `${x.key}@${x.part}` : x.kind === 'chapter' ? x.part : x.kind));
		expect(r).toEqual(['current', 'all', 'g/G1/main', 'block:makecover@g/G1/main', 'block:makesolutions@g/G1/main', 'g/G2/main', 'block:makecover#2@g/G2/main']);
	});

	it('names a part by its title, or by its path when it has none', () => {
		expect(partLabel('contents/G1/main', { 'contents/G1/main': 'Análisis de parámetros' })).toBe('Análisis de parámetros');
		expect(partLabel('contents/G1/main')).toBe('G1');
		expect(partLabel('Secciones/Desnormalización')).toBe('Desnormalización');
		expect(compileTarget('current', 'contents/G2/main', 0, { 'contents/G2/main': 'Reguladores' })).toEqual({ kind: 'current', part: 'Reguladores' });
	});
});

describe('when and where', () => {
	it('names saved files from the pattern', () => {
		const f = { n: '3', num: '7', name: 'Filters: Butterworth', profile: 'Current' };
		expect(outputName('{profile}.pdf', f)).toBe('Current.pdf');
		expect(outputName('Cap {num:02} {name}', f)).toBe('Cap 07 Filters- Butterworth.pdf');
		expect(outputName('{n}-{unknown}', f)).toBe('3-{unknown}.pdf');
	});

	it('shows a watermark with the engine defaults and its fields filled', () => {
		expect(watermarkDefaults({ text: 'x' })).toEqual({ on: true, text: 'x', position: 'center', color: '#808080', opacity: 30, size: 60, angle: 45, bold: false });
		expect(watermarkDefaults({ text: 'x', position: 'bottom-right', on: false })).toMatchObject({ on: false, size: 9, angle: 0 });
		expect(watermarkPreviewText('{profile} - {date} - p. {page} {x}', 'Draft', '5 Nov')).toBe('Draft - 5 Nov - p. 1 {x}');
	});

	it('keeps a watermark in the profile and drops an empty one', () => {
		const withMark = setProfile({ profiles: { a: {} } }, 'a', { watermark: { text: 'DRAFT', on: false } });
		expect(withMark.profiles?.a).toEqual({ watermark: { text: 'DRAFT', on: false } });
		expect(setProfile(withMark, 'a', { watermark: undefined }).profiles?.a).toEqual({});
	});

	it('gives a new project Default, and Current when it has parts', () => {
		const labels = { full: 'Default', current: 'Current' };
		expect(Object.keys(defaultProfiles({}, [], false, labels).profiles ?? {})).toEqual(['default']);
		const both = defaultProfiles({}, [{ clave: 'front' } as never], true, labels).profiles ?? {};
		expect(Object.keys(both)).toEqual(['default', 'current']);
		expect(both.current).toMatchObject({ label: 'Current', parts: 'current', omit: ['front'] });
	});

	it('makes folders relative to the project', () => {
		expect(relativeFolder('C:\\a\\b', 'C:\\a\\PDF')).toBe('../PDF');
		expect(relativeFolder('C:/a', 'c:/a')).toBe('.');
		expect(relativeFolder('C:/a', 'D:/a')).toBeNull();
	});

	it('says what Compile will build', () => {
		expect(compileTarget('current', 'Secciones/Butter', 0)).toEqual({ kind: 'current', part: 'Butter' });
		expect(compileTarget('current', null, 0)).toEqual({ kind: 'none' });
		expect(compileTarget('list', null, 2)).toEqual({ kind: 'count', count: 2 });
		expect(compileTarget(undefined, null, 0)).toEqual({ kind: 'all' });
	});
});

describe('nested parts', () => {
	const groups = { e1: 'g1', e2: 'g1', e3: 'g2' };
	const names = ['g1', 'e1', 'e2', 'g2', 'e3'];

	it('an exercise brings its guide, and a guide brings its exercises', () => {
		expect(withGroups(['e2'], groups, names)).toEqual(['g1', 'e2']);
		expect(withGroups(['g2'], groups, names)).toEqual(['g2', 'e3']);
		expect(withGroups([], groups, names)).toEqual([]);
	});

	it('rows put an exercise under its guide, and its pieces deeper', () => {
		const pieces = [{ clave: 'block:makecover#1', nombre: 'makecover', lugar: 'dentro', parte: 'e1' }] as never[];
		const r = rows(pieces, names, groups);
		expect(r.find((x) => x.kind === 'chapter' && x.part === 'e1')).toEqual({ kind: 'chapter', part: 'e1', group: 'g1' });
		expect(r.find((x) => x.kind === 'chapter' && x.part === 'g1')).toEqual({ kind: 'chapter', part: 'g1' });
		expect(r.find((x) => x.kind === 'piece')).toMatchObject({ part: 'e1', nested: true });
	});
});
