/* eslint-disable @typescript-eslint/no-explicit-any -- page records are the engine's untyped JSON, as in draftWordAt */
// SyncTeX to the word in Live, as on a profile's PDF. Live has no text layer: its pages are glyph records, so the words come from those,
// in the records' space (points, from the paper's margin corner). SyncTeX's boxes are moved into the same space, and the word is then
// found as lvSync finds it on a PDF.
import type { PalabraPdf, Rect } from './sync/buscar';
import { clave } from './sync/texto';
import type { WordSource } from './lvSync';

const BP2PT = 72.27 / 72;

/** what Live needs to mark the word under the cursor: SyncTeX's boxes for the line, how to narrow them to the word, and whether it is Follow */
export type LiveWordSync = {
	boxes: { page: number; x: number; y: number; W: number; H: number; bl?: number }[];
	refine: (viewer: WordSource, rects: Rect[]) => Promise<Rect[]>;
	follow: boolean;
};

/** a page's words from its glyph records: glyphs on one baseline, split where the gap is wider than a letter's spacing */
export function wordsFromRecords(records: any[], textMapOf: (r: any) => number[] | undefined, page: number): PalabraPdf[] {
	const fonts: Record<number, { uni?: number[]; size: number }> = {};
	for (const r of records) if (r.t === 'font') fonts[r.id] = { uni: textMapOf(r), size: r.size || 10 };
	const glyphs = records.filter((r) => r.t === 'g').sort((a, b) => a.y - b.y || a.x - b.x);
	const rows: any[][] = [];
	for (const g of glyphs) {
		const row = rows[rows.length - 1];
		if (row && Math.abs(row[0].y - g.y) < 2) row.push(g);
		else rows.push([g]);
	}
	const out: PalabraPdf[] = [];
	for (const row of rows) {
		row.sort((a, b) => a.x - b.x);
		let word: any[] = [];
		const flush = () => {
			if (!word.length) return;
			let text = '';
			for (const g of word) {
				const u = fonts[g.f]?.uni;
				const cp = u ? u[g.c] || 0 : g.c;
				if (cp >= 32 && cp <= 0x10ffff) text += String.fromCodePoint(cp);
			}
			const key = clave(text);
			if (key) {
				const size = Math.max(...word.map((g) => fonts[g.f]?.size || 10));
				const first = word[0];
				const last = word[word.length - 1];
				out.push({ texto: text, clave: key, page, x: first.x, y: first.y - size * 0.78, w: last.x + (last.w || 0) - first.x, h: size });
			}
			word = [];
		};
		for (let k = 0; k < row.length; k++) {
			if (k > 0) {
				const prev = row[k - 1];
				const gap = row[k].x - (prev.x + (prev.w || 0));
				if (gap > Math.max(0.9, 0.13 * (fonts[prev.f]?.size || 10))) flush();
			}
			word.push(row[k]);
		}
		flush();
	}
	return out;
}

/** SyncTeX's line boxes (bp, from the page's top left; y is the baseline) in the records' space */
export function boxesToRecords(boxes: LiveWordSync['boxes'], paper: { mx: number; my: number }): Rect[] {
	return boxes
		.filter((b) => b.page && (b.H || 0) < 30)
		.map((b) => {
			const h = Math.max(6, b.H * BP2PT);
			return { page: b.page, x: (b.bl ?? b.x) * BP2PT - paper.mx, y: b.y * BP2PT - paper.my - h, w: b.W * BP2PT, h: h + 3 };
		});
}
