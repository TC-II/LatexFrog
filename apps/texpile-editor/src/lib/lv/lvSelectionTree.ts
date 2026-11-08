// What a profile compiles, as one tree of checkboxes: the chapters (a guide, and its exercises under it) and the pieces each
// one prints (a guide's cover). A box is ticked when what it stands for is compiled, half ticked when only some of it is, and
// clicking it turns all of it on or off. The engine reads the same choice the same way (`includeonly_de`, `copias_en_partes`).
//
// The choice is kept as the profile already keeps it: `parts` (all, a list, the chapter I am in) with `partList`, and `omit`
// for what is left out of what that brings in: a piece (`block:...`) or a part inside a chosen group (`part:<name>`).

import { omitted, withGroups, type Piece, type Selection } from './lvProfiles';

export type Tree = {
	/** every part, in document order */
	parts: string[];
	/** the part that holds each part that nests (an exercise's guide) */
	groups: Record<string, string>;
	/** the other parts that hold it (a solutions book that loads its guide's exercise list) */
	also?: Record<string, string[]>;
	pieces: Piece[];
};

export type Choice = Selection & { omit: string[] };
export type BoxState = 'on' | 'mixed' | 'off';

const partKey = (name: string) => `part:${name}`;

/** the parts inside `part` (a guide's exercises) */
const children = (t: Tree, part: string) => t.parts.filter((p) => t.groups[p] === part);

/** the pieces a part prints that the driver can leave out (a cover); the others go with their part */
const ownPieces = (t: Tree, part: string) => t.pieces.filter((p) => p.parte === part && p.firma !== undefined);

/** the chapters at the top of the tree: parts no other part holds */
export const topParts = (t: Tree) => t.parts.filter((p) => t.groups[p] === undefined);

/** the parts the choice compiles, without the chapter I am in (that one is known only while editing) */
export function compiledParts(c: Choice, t: Tree): string[] {
	const base = c.all ? t.parts : withGroups(c.list, t.groups, t.parts, t.also);
	return base.filter((p) => !c.omit.includes(partKey(p)));
}

export function partIn(c: Choice, t: Tree, part: string): boolean {
	return compiledParts(c, t).includes(part);
}

export function pieceIn(c: Choice, t: Tree, piece: Piece): boolean {
	if (piece.parte !== undefined && !partIn(c, t, piece.parte)) return false;
	return piece.firma === undefined && piece.parte !== undefined ? true : !omitted(piece.clave, c.omit);
}

/** a chapter: on when it and all it holds are compiled, mixed when it is but something inside is not, off when it is not */
export function partState(c: Choice, t: Tree, part: string): BoxState {
	if (!partIn(c, t, part)) return 'off';
	const inside = [...children(t, part).map((p) => partIn(c, t, p)), ...ownPieces(t, part).map((p) => pieceIn(c, t, p))];
	return inside.every(Boolean) ? 'on' : 'mixed';
}

/** All chapters: on when every chapter is fully on, off when none is compiled */
export function allState(c: Choice, t: Tree): BoxState {
	const states = topParts(t).map((p) => partState(c, t, p));
	if (states.length === 0) return c.all ? 'on' : 'off';
	if (states.every((s) => s === 'on')) return 'on';
	return states.every((s) => s === 'off') ? 'off' : 'mixed';
}

/** what is under a part, itself included: its own name, its exercises' names, and the keys of the pieces of all of them */
function subtree(t: Tree, part: string) {
	const names = [part, ...children(t, part)];
	return { names, keys: [...names.map(partKey), ...t.pieces.filter((p) => p.parte !== undefined && names.includes(p.parte)).map((p) => p.clave)] };
}

/** All chapters: on brings every chapter whole; off leaves none (the chapter I am in stays as it is) */
export function toggleAll(c: Choice, t: Tree): Choice {
	const inParts = new Set(t.parts.flatMap((p) => subtree(t, p).keys));
	const omit = c.omit.filter((k) => !inParts.has(k));
	return allState(c, t) === 'on' ? { ...c, all: false, list: [], omit } : { ...c, all: true, list: [], omit };
}

/** a chapter or an exercise: whole on when it is not, off when it is */
export function togglePart(c: Choice, t: Tree, part: string): Choice {
	const { names, keys } = subtree(t, part);
	const group = t.groups[part];
	if (partState(c, t, part) === 'on') {
		// off. Inside a chosen guide, or with all chapters, an exercise is left out by name; anything else just leaves the list.
		const list = (c.all ? topParts(t).filter((p) => partIn(c, t, p)) : c.list).filter((p) => !names.includes(p));
		const omit = c.omit.filter((k) => !keys.includes(k));
		const viaGroup = group !== undefined && (c.all || c.list.includes(group));
		if (viaGroup) return { ...c, omit: [...omit, partKey(part)] };
		return { ...c, all: false, list, omit };
	}
	// on, whole: nothing of it left out, and named in the list unless all chapters or its guide already bring it. An exercise whose
	// guide is out brings the guide's frame without the guide's own pieces (its cover): the exercise alone
	const frame = group !== undefined && !partIn(c, t, group) ? ownPieces(t, group).map((p) => p.clave) : [];
	const omit = [...c.omit.filter((k) => !keys.includes(k) && !frame.includes(k)), ...frame];
	const next = { ...c, omit };
	return partIn(next, t, part) && (c.all || c.list.includes(part) || (group !== undefined && c.list.includes(group)))
		? next
		: { ...next, list: [...c.list.filter((p) => !names.includes(p)), part] };
}

/** `omit` without what leaves `piece` out. A key for every guide (`block:makecover`) gives way to the keys of the other guides'
 *  pieces it covered, so only this one comes back */
function bringBack(omit: string[], t: Tree, piece: Piece): string[] {
	const general = omit.filter((o) => o !== piece.clave && omitted(piece.clave, [o]));
	const rest = omit.filter((o) => o !== piece.clave && !general.includes(o));
	const still = t.pieces.filter((p) => p.clave !== piece.clave && general.some((g) => omitted(p.clave, [g])) && !rest.includes(p.clave));
	return [...rest, ...still.map((p) => p.clave)];
}

/** a piece: off when it is compiled; on when it is not, and when its chapter is out, that chapter comes in with only this piece */
export function togglePiece(c: Choice, t: Tree, piece: Piece): Choice {
	if (pieceIn(c, t, piece)) return { ...c, omit: [...c.omit, piece.clave] };
	const part = piece.parte;
	if (part === undefined || partIn(c, t, part)) return { ...c, omit: bringBack(c.omit, t, piece) };
	// its chapter alone: its frame and this piece, none of its exercises or other pieces
	const others = [...children(t, part).map(partKey), ...ownPieces(t, part).filter((p) => p.clave !== piece.clave).map((p) => p.clave)];
	const omit = [...bringBack(c.omit, t, piece).filter((k) => k !== partKey(part) && !others.includes(k)), ...others];
	const list = c.all ? c.list : [...c.list, part];
	return { ...c, list, omit };
}
