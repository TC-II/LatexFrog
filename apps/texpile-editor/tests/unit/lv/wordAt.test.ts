import { describe, expect, it } from 'vitest';
import { wordAt } from '$lib/draft/draftWordAt';

/** one row of glyphs on baseline 100, 5 pt each, a 4 pt space between words; codes are the text's code points */
function row(text: string) {
	const records: object[] = [{ t: 'font', id: 1, size: 10 }];
	let x = 0;
	for (const ch of text) {
		if (ch === ' ') x += 4;
		else {
			records.push({ t: 'g', f: 1, c: ch.codePointAt(0), x, y: 100, w: 5 });
			x += 5;
		}
	}
	return records;
}

describe('wordAt in Live', () => {
	it('gives a word with a ligature glyph as the source spells it', () => {
		// "veriﬁcación": the PDF has one glyph for "fi", which maps to U+FB01
		const records = row('Como veriﬁcación de');
		expect(wordAt(records, () => undefined, 5 * 4 + 4 + 2, 98)).toBe('verificación');
	});

	it('keeps a word without ligatures as it is', () => {
		const records = row('un múltiplo impar');
		expect(wordAt(records, () => undefined, 2 * 5 + 4 + 2, 98)).toBe('múltiplo');
	});
});
