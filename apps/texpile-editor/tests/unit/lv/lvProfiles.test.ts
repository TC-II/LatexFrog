import { describe, expect, it } from 'vitest';
import { compileTarget, compileWhen, compileWhenChange, emptyProfile, profileId, relativeFolder, removeProfile, rows, selectionOf, setProfile, toParts, type ConfigJson } from '$lib/lv/lvProfiles';

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

	it('starts a new profile empty, without footer where the project can say so', () => {
		const p = emptyProfile({ variables: { Pie: { choices: ['completo', 'ninguno'] } } }, [{ clave: 'toc', nombre: 'Contents' }], 1, 'One');
		expect(p).toMatchObject({ parts: 'list', partList: [], omit: ['toc'], externalize: true, vars: { Pie: 'ninguno' } });
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
	it('reads and writes when it compiles', () => {
		expect(compileWhen({})).toBe('save');
		expect(compileWhen({ compileOn: 'idle' })).toBe('idle');
		expect(compileWhen({ autoCompile: false })).toBe('manual');
		expect(compileWhen(setProfile({}, 'a', compileWhenChange('manual')).profiles?.a ?? {})).toBe('manual');
		expect(compileWhen(setProfile({}, 'a', compileWhenChange('idle')).profiles?.a ?? {})).toBe('idle');
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
