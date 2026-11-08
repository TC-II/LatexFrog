// How deep each row of the project's tree sits, for Contents and Figures alike, from the engine's composition. No Svelte, so it can
// be tested.
//
// - A guide (a part with an entry of its own and no part around it) is at the top.
// - A heading is at its level's rank among the levels the document uses, one step in when it belongs to a guide.
// - A part loaded inside a guide (an exercise, a worked example) is one step under the guide's heading it falls under (`\part*{Ejercicios}`),
//   whether it is titled by its call line (`\exercise{slug}` makes "Ejercicio 4.8") or only by its name (`\workedexample{slug}`):
//   the two kinds of thing a list loads are siblings. The headings written inside it go under it.
// - A piece (a cover) is one step under its part.

export type OutlineItem =
	| { kind: 'section'; index: number; part: string | null; opens?: string }
	| { kind: 'part'; name: string }
	| { kind: 'piece'; part?: string | null };

export function outlineDepths(items: OutlineItem[], levels: number[], groups: Record<string, string> = {}): number[] {
	const ranks = [...new Set(levels)].sort((a, b) => a - b);
	const rank = (index: number) => Math.max(0, ranks.indexOf(levels[index]));
	const entries = new Set(items.flatMap((x) => (x.kind === 'part' ? [x.name] : [])));
	/** the depth each part is drawn at: its entry, or the heading its call line makes */
	const partDepth = new Map<string, number>();
	/** the shallowest rank of the headings written inside each nested part, so the first of them goes right under it */
	const inner = new Map<string, number>();
	items.forEach((it) => {
		if (it.kind === 'section' && it.part && groups[it.part] !== undefined && !it.opens) inner.set(it.part, Math.min(inner.get(it.part) ?? Infinity, rank(it.index)));
	});
	/** the depth of the guide's own heading last seen, per guide: a part loaded after `\part*{Ejercicios}` goes under it */
	const lastInGroup = new Map<string, number>();
	const anchor = (part: string): number | undefined => {
		const group = groups[part];
		const above = lastInGroup.get(group);
		if (above !== undefined) return above + 1;
		const g = partDepth.get(group);
		return g !== undefined ? g + 1 : undefined;
	};
	return items.map((it) => {
		if (it.kind === 'part') {
			const d = groups[it.name] !== undefined ? (anchor(it.name) ?? 0) : 0;
			partDepth.set(it.name, d);
			return d;
		}
		if (it.kind === 'piece') {
			const p = it.part ? partDepth.get(it.part) : undefined;
			return p !== undefined ? p + 1 : 0;
		}
		const part = it.part;
		const nested = part !== null && groups[part] !== undefined;
		if (nested && it.opens) {
			const d = anchor(part) ?? rank(it.index);
			partDepth.set(part, d);
			return d;
		}
		if (nested && partDepth.has(part)) return (partDepth.get(part) as number) + 1 + rank(it.index) - (inner.get(part) ?? rank(it.index));
		const d = rank(it.index) + (part !== null && entries.has(part) ? 1 : 0);
		if (part !== null && entries.has(part)) lastInGroup.set(part, d);
		return d;
	});
}
