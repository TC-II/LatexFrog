import { describe, expect, it } from 'vitest';
import { outlineDepths, outlineParents, outlineVisible, type OutlineItem } from '$lib/lv/lvOutlineTree';

describe('the depth of each row of the project tree', () => {
	// a guide whose list has `\part*{Ejercicios}`, two exercises (titled by `\exercise`, a level 2 heading at the call line), a worked
	// example between them (no heading of its own, one `\subsection*{Resolución}` inside) and another guide after it
	const levels = [0, 2, 3, 2];
	const groups = { vco: 'G4/main', diode: 'G4/main', clamper: 'G4/main' };
	const items: OutlineItem[] = [
		{ kind: 'part', name: 'G4/main' },
		{ kind: 'piece', part: 'G4/main' },
		{ kind: 'section', index: 0, part: 'G4/main' },
		{ kind: 'section', index: 1, part: 'vco', opens: 'G4/exercises/vco.tex' },
		{ kind: 'part', name: 'diode' },
		{ kind: 'section', index: 2, part: 'diode' },
		{ kind: 'section', index: 3, part: 'clamper', opens: 'G4/exercises/clamper.tex' },
		{ kind: 'part', name: 'G5/main' }
	];

	it('puts a worked example beside the exercises of its list, not at the top with the guides', () => {
		const d = outlineDepths(items, levels, groups);
		expect(d).toEqual([0, 1, 1, 2, 2, 3, 2, 0]);
	});

	it('without `\\part*` in the list, the exercises and the example go right under the guide', () => {
		const flat = items.filter((it) => !(it.kind === 'section' && it.index === 0));
		expect(outlineDepths(flat, levels, groups)).toEqual([0, 1, 1, 1, 2, 1, 0]);
	});

	it('a project without guides keeps the rank of its headings', () => {
		expect(outlineDepths([0, 1, 2].map((index) => ({ kind: 'section', index, part: null })), [0, 2, 1])).toEqual([0, 2, 1]);
	});
});

describe('folding', () => {
	const depths = [0, 1, 2, 1, 0, 1];
	it('a row with deeper rows after it is a parent', () => {
		expect(outlineParents(depths)).toEqual([true, true, false, false, true, false]);
	});
	it('a folded row hides its block and nothing after it', () => {
		expect(outlineVisible(depths, [false, true, false, false, false, false])).toEqual([true, true, false, true, true, true]);
		expect(outlineVisible(depths, [true, true, false, false, false, false])).toEqual([true, false, false, false, true, true]);
	});
});
