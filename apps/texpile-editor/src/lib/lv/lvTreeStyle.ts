// How a row of the document's tree looks at each depth, the same in Contents and in Figures: the top one largest, the text and
// the dot shrinking as the tree nests.

const TEXT = ['text-[0.95rem] font-semibold', 'text-sm font-semibold', 'text-sm', 'text-[0.8rem]', 'text-xs'];
const DOT = ['size-2', 'size-1.5', 'size-1.5', 'size-1', 'size-1'];
const at = (list: string[], depth: number) => list[Math.min(Math.max(depth, 0), list.length - 1)];

/** the text's size and weight at this depth */
export const treeText = (depth: number) => at(TEXT, depth);

/** the dot at this depth: solid in the two top levels, hollow below; a piece that is not a heading (a cover) has a square */
export const treeMarker = (depth: number, square = false) =>
	`${at(DOT, depth)} ${square ? 'rounded-[1px]' : 'rounded-full'} ${depth <= 1 && !square ? 'bg-current' : 'border border-current'}`;
