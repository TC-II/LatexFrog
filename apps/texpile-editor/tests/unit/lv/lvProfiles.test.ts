import { describe, expect, it } from 'vitest';
import { compileTarget, defaultProfiles, emptyProfile, outputName, parseConfig, profileId, relativeFolder, removeProfile, rows, selectionOf, setProfile, toParts, watermarkDefaults, watermarkPreviewText, type ConfigJson } from '$lib/lv/lvProfiles';

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
