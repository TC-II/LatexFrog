// The blocks git marked in a file, cut out for the resolver, and put back once merged. Pure, for the tests.
import { findConflicts } from '$lib/workspace/scm/conflictMarkers';
import type { Hunk } from './lvAi';

const CONTEXT_LINES = 6;

function lastLines(text: string, n: number): string {
	return text.split(/\r?\n/).slice(-n - 1).join('\n');
}
function firstLines(text: string, n: number): string {
	return text.split(/\r?\n/).slice(0, n).join('\n');
}

/** the blocks git marked in `text`, as the resolver reads them */
export function hunksOf(text: string): { hunks: Hunk[]; spans: { from: number; to: number }[] } {
	const blocks = findConflicts(text);
	return {
		spans: blocks.map((b) => ({ from: b.from, to: b.to })),
		hunks: blocks.map((b) => ({
			before: lastLines(text.slice(0, b.from), CONTEXT_LINES),
			after: firstLines(text.slice(b.to), CONTEXT_LINES),
			mine: text.slice(b.mine.from, b.mine.to),
			theirs: text.slice(b.theirs.from, b.theirs.to),
			base: b.base ? text.slice(b.base.from, b.base.to) : null
		}))
	};
}

/** `text` with each span replaced, from the last so earlier offsets stay right */
export function replaceSpans(text: string, spans: { from: number; to: number }[], blocks: string[]): string {
	let out = text;
	for (let i = spans.length - 1; i >= 0; i--) out = out.slice(0, spans[i].from) + blocks[i] + out.slice(spans[i].to);
	return out;
}
