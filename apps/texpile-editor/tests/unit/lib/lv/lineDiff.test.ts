import { describe, expect, it } from 'vitest';
import { compactDiff, lineDiff } from '../../../../src/lib/lv/lineDiff';

describe('lineDiff', () => {
	it('adds every line of a new file', () => {
		expect(lineDiff(null, 'a\nb\n')).toEqual([
			{ kind: 'add', text: 'a' },
			{ kind: 'add', text: 'b' }
		]);
	});
	it('ignores the EOL style and puts removals first', () => {
		expect(lineDiff('a\r\nb\r\n', 'a\nc\n')).toEqual([
			{ kind: 'same', text: 'a' },
			{ kind: 'remove', text: 'b' },
			{ kind: 'add', text: 'c' }
		]);
	});
	it('collapses what did not change', () => {
		const before = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n');
		const rows = compactDiff(lineDiff(before, before.replace('l6', 'x')), 1);
		expect(rows[0]).toEqual({ kind: 'skip', count: 5 });
		expect(rows.at(-1)).toEqual({ kind: 'skip', count: 4 });
	});
});
