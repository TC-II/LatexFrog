// SyncTeX to the exact word. The engine answers with the boxes of a line; the word is then found inside them on the PDF's text layer.
// Only the page's boxes come from SyncTeX: without this the jump lit a whole line, which on a paragraph written as one line is a page.
import { buscarForward, buscarInverse, buscarRango, palabraEnPunto, type LineaFuente, type PalabraPdf, type Rect } from './sync/buscar';
import { palabraEn, palabrasDeLinea } from './sync/texto';

/** a viewer that can list a page's words */
export type WordSource = { pageWords(page: number): Promise<PalabraPdf[]> };
/** `mark` stays on as the Follow marker; otherwise the rectangles flash */
export type SyncRefine = { rects(viewer: WordSource): Promise<Rect[]>; mark: boolean; scroll: boolean };

let pending: SyncRefine | null = null;
let clearMark: (() => void) | null = null;
let clicked: WordSource | null = null;

/** the viewer that took the double click: with split views it is the one holding that page's words */
export function ownClick(viewer: WordSource) {
	clicked = viewer;
}

export const clickedViewer = () => clicked;

/** the viewer holding the Follow marker says how to take it off */
export function ownFollowMark(clear: () => void) {
	clearMark = clear;
}

export function clearFollowMark() {
	clearMark?.();
	clearMark = null;
}

/** the next jump the viewer takes refines itself this way */
export function refineNextJump(refine: SyncRefine) {
	pending = refine;
}

export function takeRefine(): SyncRefine | null {
	const refine = pending;
	pending = null;
	return refine;
}

async function wordsOf(viewer: WordSource, boxes: Rect[]): Promise<PalabraPdf[]> {
	const pages = [...new Set(boxes.map((r) => r.page))];
	return (await Promise.all(pages.map((p) => viewer.pageWords(p)))).flat();
}

/** the word at a column of a source line, inside the line's boxes; the boxes when it is not found */
export async function refineWord(viewer: WordSource, boxes: Rect[], text: string, column: number): Promise<Rect[]> {
	const source = palabrasDeLinea(text);
	const index = palabraEn(source, column);
	if (index < 0) return boxes;
	return buscarForward(source, index, await wordsOf(viewer, boxes), boxes)?.rects ?? boxes;
}

/** a selected stretch of one source line: one rectangle per line of the PDF */
export async function refineRange(viewer: WordSource, boxes: Rect[], text: string, from: number, to: number): Promise<Rect[]> {
	const source = palabrasDeLinea(text);
	const first = palabraEn(source, from);
	if (first < 0) return boxes;
	let last = first;
	source.forEach((p, k) => {
		if (k > first && p.inicio < to) last = k;
	});
	return buscarRango(source, first, last, await wordsOf(viewer, boxes), boxes)?.rects ?? boxes;
}

/** a place in the source: the line alone when the word was not found there */
export type SourceSpot = { line: number; from?: number; to?: number };

/**
 * PDF to source: SyncTeX names a line, often the wrong one at a paragraph's start or inside a macro. The clicked word and its neighbours
 * are searched in that line and the two around it; with no match the line stays.
 */
export async function refineClick(viewer: WordSource, point: { page: number; x: number; y: number }, line: number, source: string): Promise<SourceSpot> {
	const text = source.split(/\r?\n/);
	const target = Math.min(Math.max(1, line), text.length);
	const lines: LineaFuente[] = [];
	for (let n = Math.max(1, target - 2); n <= Math.min(text.length, target + 2); n++) lines.push({ n, texto: text[n - 1] });
	const words = await viewer.pageWords(point.page);
	const word = palabraEnPunto(words, point.page, point.x, point.y);
	const found = word >= 0 ? buscarInverse(lines, target, words, word) : null;
	return found ? { line: found.line, from: found.inicio, to: found.fin } : { line: target };
}
