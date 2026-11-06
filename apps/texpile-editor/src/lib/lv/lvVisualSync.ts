// SyncTeX to the word from the visual editor, both ways. The visual editor shows a ProseMirror document; its source map turns a
// position there into an offset of the file's text and back, which is all the source editor's word matching needs.
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { SourceMap } from '$lib/editor/visual/sourceSpans';
import { offsetAtPm, pmAtOffset } from '$lib/editor/visual/sourceMap';
import { flashNodeAt } from '$lib/editor/visual/extensions/flash-plugin';
import type { CaretSpot } from '$lib/workspace/syncTexNav';
import { lvProject } from './lvEngine.svelte';

/** the line of `source` holding `offset`: its number from 1, where it starts and its text without the line break */
function lineAt(source: string, offset: number) {
	const start = source.lastIndexOf('\n', offset - 1) + 1;
	let end = source.indexOf('\n', offset);
	if (end < 0) end = source.length;
	let number = 1;
	for (let i = source.indexOf('\n'); i >= 0 && i < start; i = source.indexOf('\n', i + 1)) number++;
	return { number, start, text: source.slice(start, end).replace(/\r$/, '') };
}

/** the visual caret, or the first line of its selection, as columns of a line of the file */
export function visualCaret(v: EditorView | null, source: string, map: SourceMap): CaretSpot | null {
	if (!v) return null;
	const { from, to, empty } = v.state.selection;
	const a = offsetAtPm(map, from, 1);
	if (a == null) return null;
	const b = empty ? a : (offsetAtPm(map, to, -1) ?? a);
	const line = lineAt(source, a);
	const col = Math.min(a - line.start, line.text.length);
	return { line: line.number, text: line.text, from: col, to: Math.max(col, Math.min(b - line.start, line.text.length)) };
}

/** the nearest scrolling ancestor of the editor */
function scroller(el: HTMLElement): HTMLElement | null {
	for (let e: HTMLElement | null = el; e; e = e.parentElement) {
		const style = getComputedStyle(e);
		if (/(auto|scroll)/.test(style.overflowY) && e.scrollHeight > e.clientHeight) return e;
	}
	return null;
}

/** scrolls so that a document position sits near the middle of the editor; the start and the end of the document stay in reach.
 * A large document's off-screen blocks are 60 px stand-ins until drawn (content-visibility), so one measure misses by the
 * difference of every block the scroll draws: it measures again after each scroll, for a few frames, until the spot holds */
export function centerVisual(v: EditorView, pos: number, tries = 8) {
	const box = scroller(v.dom);
	if (!box) return;
	let coords: { top: number; bottom: number };
	try {
		coords = v.coordsAtPos(pos);
	} catch {
		return;
	}
	const frame = box.getBoundingClientRect();
	const middle = frame.top + frame.height / 2;
	const before = box.scrollTop;
	box.scrollTop += (coords.top + coords.bottom) / 2 - middle;
	if (Math.abs(box.scrollTop - before) > 4 && tries > 1) requestAnimationFrame(() => centerVisual(v, pos, tries - 1));
}

/** PDF to visual editor: selects the clicked word (row from 0, columns of that row) and centres it. False when it cannot be placed */
export function selectInVisual(v: EditorView, source: string, map: SourceMap, row: number, from: number, to: number): boolean {
	let offset = 0;
	for (let r = 0; r < row; r++) {
		const next = source.indexOf('\n', offset);
		if (next < 0) return false;
		offset = next + 1;
	}
	const a = pmAtOffset(map, offset + from, 1);
	const b = pmAtOffset(map, offset + Math.max(from, to), -1);
	if (a == null) return false;
	const size = v.state.doc.content.size;
	const start = Math.min(a, size);
	const end = Math.min(Math.max(start, b ?? start), size);
	let selection: TextSelection;
	try {
		selection = TextSelection.create(v.state.doc, start, end);
	} catch {
		return false;
	}
	// a position inside an embedded node (a formula) holds no text selection: the caller falls back to the caret
	if (!selection.$from.parent.inlineContent) return false;
	v.dispatch(v.state.tr.setSelection(selection).setMeta('addToHistory', false));
	v.focus();
	requestAnimationFrame(() => centerVisual(v, start));
	const $start = v.state.doc.resolve(start);
	if ($start.depth > 0) flashNodeAt(v, $start.before(1));
	return true;
}

/** the visual caret moved: Follow catches up as it does for the source editor's. ProseMirror sets the page's selection as it goes */
export function watchVisualCaret(view: () => EditorView | null): () => void {
	const onChange = () => {
		const v = view();
		if (v?.hasFocus()) lvProject.caretMoved();
	};
	document.addEventListener('selectionchange', onChange);
	return () => document.removeEventListener('selectionchange', onChange);
}
