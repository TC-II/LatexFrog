import { describe, expect, it } from 'vitest';
import { allState, compiledParts, partState, pieceIn, toggleAll, togglePart, togglePiece, type Choice, type Tree } from '$lib/lv/lvSelectionTree';
import type { Piece } from '$lib/lv/lvProfiles';

// two guides, each with a cover the driver can leave out; the first with two exercises, the second with one
const cover1: Piece = { clave: 'block:makecover@g1', nombre: 'makecover', lugar: 'dentro', parte: 'g1', firma: '' };
const cover2: Piece = { clave: 'block:makecover@g2', nombre: 'makecover', lugar: 'dentro', parte: 'g2', firma: '' };
const credits: Piece = { clave: 'block:titlepage@g1', nombre: 'titlepage', lugar: 'dentro', parte: 'g1' };
const tree: Tree = { parts: ['g1', 'a', 'b', 'g2', 'c'], groups: { a: 'g1', b: 'g1', c: 'g2' }, pieces: [cover1, credits, cover2] };
const all: Choice = { all: true, current: false, list: [], omit: [] };
const none: Choice = { all: false, current: false, list: [], omit: [] };

describe('the profile as one tree of boxes', () => {
	it('leaving a cover out of all chapters makes its guide and All half ticked', () => {
		const c = togglePiece(all, tree, cover1);
		expect(pieceIn(c, tree, cover1)).toBe(false);
		expect(partState(c, tree, 'g1')).toBe('mixed');
		expect(partState(c, tree, 'g2')).toBe('on');
		expect(allState(c, tree)).toBe('mixed');
	});

	it('unticking All leaves nothing ticked, not the chapters it had before', () => {
		const c = toggleAll({ ...all, list: ['g1'] }, tree);
		expect(compiledParts(c, tree)).toEqual([]);
		expect(allState(c, tree)).toBe('off');
		expect(partState(c, tree, 'g1')).toBe('off');
		// a half ticked All turns all on, as any half ticked box does
		expect(allState(toggleAll({ ...all, omit: ['part:a'] }, tree), tree)).toBe('on');
	});

	it('a chapter left out shows its pieces unticked, not ticked and grey', () => {
		const c = togglePart(all, tree, 'g1');
		expect(partState(c, tree, 'g1')).toBe('off');
		expect(pieceIn(c, tree, cover1)).toBe(false);
		expect(pieceIn(c, tree, credits)).toBe(false);
		expect(compiledParts(c, tree)).toEqual(['g2', 'c']);
	});

	it('ticking only a cover compiles its guide with that cover and nothing else', () => {
		const c = togglePiece(none, tree, cover1);
		expect(compiledParts(c, tree)).toEqual(['g1']);
		expect(pieceIn(c, tree, cover1)).toBe(true);
		expect(partState(c, tree, 'g1')).toBe('mixed');
	});

	it('one exercise brings its guide half ticked, without its cover; ticking the guide brings all of it back', () => {
		let c = togglePart(none, tree, 'b');
		expect(compiledParts(c, tree)).toEqual(['g1', 'b']);
		expect(partState(c, tree, 'g1')).toBe('mixed');
		// the exercise alone: the guide's frame comes for its setup, its cover does not
		expect(pieceIn(c, tree, cover1)).toBe(false);
		c = togglePiece(c, tree, cover1);
		expect(pieceIn(c, tree, cover1)).toBe(true);
		c = togglePiece(c, tree, cover1);
		expect(pieceIn(c, tree, cover1)).toBe(false);
		c = togglePart(c, tree, 'g1');
		expect(partState(c, tree, 'g1')).toBe('on');
		expect(compiledParts(c, tree)).toEqual(['g1', 'a', 'b']);
	});

	it('a key without a guide leaves that piece out of every guide, and ticking one brings back only that one', () => {
		let c: Choice = { ...all, omit: ['block:makecover'] };
		expect(pieceIn(c, tree, cover1)).toBe(false);
		expect(pieceIn(c, tree, cover2)).toBe(false);
		c = togglePiece(c, tree, cover1);
		expect(pieceIn(c, tree, cover1)).toBe(true);
		expect(pieceIn(c, tree, cover2)).toBe(false);
		expect(c.omit).toEqual(['block:makecover@g2']);
	});

	it('a solutions book that loads its guide list brings the same exercises', () => {
		const t: Tree = { ...tree, parts: [...tree.parts, 's1'], also: { a: ['s1'], b: ['s1'] } };
		const c = togglePart(none, t, 's1');
		expect(compiledParts(c, t)).toEqual(['a', 'b', 's1']);
	});

	it('an exercise left out of a whole guide stays out by name, and comes back', () => {
		let c = togglePart(all, tree, 'a');
		expect(c.omit).toContain('part:a');
		expect(compiledParts(c, tree)).toEqual(['g1', 'b', 'g2', 'c']);
		c = togglePart(c, tree, 'a');
		expect(compiledParts(c, tree)).toEqual(tree.parts);
		expect(allState(c, tree)).toBe('on');
	});
});
