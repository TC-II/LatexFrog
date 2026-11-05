// The baked figures of a file, for the visual editor: the engine names each externalized picture in order and says which PDF in the
// figure cache holds it (`figure-images`). Here they are matched to the editor's raw blocks by their text and drawn once with pdf.js.
import { fileUrl, joinPath, relativeTo } from '$lib/workspace/fileSystem';
import { getPdfDocument } from '$lib/pdf-view/pdf-viewer/pdfjs-singleton';
import { lvProject } from './lvEngine.svelte';

/** one externalized picture: the text that brings it (its tikzpicture, or the `\input` of the file holding it) and where its code is */
export type FigureImage = { snippet: string; nombre: string; pdf: string | null; archivo: string; linea: number };

const lists = new Map<string, Promise<FigureImage[]>>();
const pictures = new Map<string, Promise<{ url: string; width: number } | null>>();

const key = (file: string) => `${lvProject.revision}:${lvProject.figureRevision}:${file}`;

/** the figures of a project file (absolute path), from the engine; empty outside an engine project or on any failure */
export function figuresOf(path: string | null): Promise<FigureImage[]> {
	const root = lvProject.view?.root;
	if (!path || !root || !lvProject.active) return Promise.resolve([]);
	const rel = relativeTo(root, path).replace(/\\/g, '/');
	if (rel.startsWith('..')) return Promise.resolve([]);
	const k = key(rel);
	let list = lists.get(k);
	if (!list) {
		list = lvProject.request<FigureImage[]>('figure-images', { file: rel }).catch(() => []);
		lists.set(k, list);
	}
	return list;
}

const plain = (t: string) => t.replace(/\r\n?/g, '\n');

/**
 * Which figures fall in each of the document's raw blocks, given in order: each figure is looked for after the previous one, so two
 * blocks with the same text still get their own picture.
 */
export function assign(blocks: string[], figures: FigureImage[]): FigureImage[][] {
	const out: FigureImage[][] = blocks.map(() => []);
	let k = 0;
	for (let b = 0; b < blocks.length && k < figures.length; b++) {
		const text = plain(blocks[b]);
		let from = 0;
		while (k < figures.length) {
			const at = text.indexOf(plain(figures[k].snippet).trim(), from);
			if (at < 0) break;
			out[b].push(figures[k]);
			from = at + 1;
			k++;
		}
	}
	return out;
}

/** a cached figure's first page as an image, at its printed size; null when it cannot be read */
export function pictureOf(pdf: string): Promise<{ url: string; width: number } | null> {
	const root = lvProject.view?.root;
	if (!root) return Promise.resolve(null);
	const k = key(pdf);
	let p = pictures.get(k);
	if (!p) {
		p = draw(joinPath(root, pdf)).catch(() => null);
		pictures.set(k, p);
	}
	return p;
}

async function draw(path: string): Promise<{ url: string; width: number } | null> {
	const task = await getPdfDocument(`${fileUrl(path)}&t=${Date.now()}`);
	if (!task) return null;
	try {
		const doc = await task.promise;
		const page = await doc.getPage(1);
		// a point is 4/3 of a CSS pixel; drawn at twice that for a sharp picture on a high-density screen
		const natural = page.getViewport({ scale: 4 / 3 });
		const viewport = page.getViewport({ scale: (4 / 3) * Math.max(2, window.devicePixelRatio || 1) });
		const canvas = document.createElement('canvas');
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
		return { url: canvas.toDataURL('image/png'), width: natural.width };
	} finally {
		void task.destroy();
	}
}

/** a block the visual editor may show as its baked picture: a figure environment that draws with TikZ or loads a file */
export function mayHoldBakedFigure(text: string): boolean {
	return lvProject.active && /\\begin\s*\{figure\*?\}/.test(text) && /\\begin\s*\{tikzpicture\}|\\input\s*\{/.test(text);
}
