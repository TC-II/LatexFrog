// SyncTeX navigation: source line <-> place in the PDF, in both directions, for host and guest.
// A guest has no .synctex data of its own (the host holds it), so both directions round-trip
// through the session and only the resulting scroll happens locally.
//
// SyncTeX needs the document compiled with -synctex=1; the default compile command does it.
import { synctexForward, synctexInverse } from '$lib/workspace/synctex';
import { collabGuest } from '$lib/collab/guestStore.svelte';
import type { ControlPayload } from '$lib/collab/protocol';
import { workspaceRoot, activeFilePath, activeFigure } from '$lib/workspace/workspaceStore';
import { samePath, relativeTo, joinPath, readTextFile } from '$lib/workspace/fileSystem';
import { compileConfig } from './projectConfigSync.svelte';
import { sourceCmView } from '$lib/stores/editorStore';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import { lvProject, type Rect } from '$lib/lv/lvEngine.svelte';
import { clickedViewer, refineClick, refineNextJump, refineRange, refineWord, type SourceSpot, type WordSource } from '$lib/lv/lvSync';
import { programNotFound } from './toolMissing';
import { askForProgram } from '$lib/modals/window/missingProgram/missingProgram.svelte';

/** a selection reaches this many source lines: a paragraph of the book is one line, so this is already ten paragraphs */
const MAX_SELECTED_LINES = 10;

/** where the caret is in the file's text, as columns of one line: the source editor's, or the visual editor's through its map */
export type CaretSpot = { line: number; text: string; from: number; to: number; fromSource?: boolean };

/** the source editor's caret, when it is the one on screen; a selection is cut at the end of its first line */
export function sourceCaret(): CaretSpot | null {
	const cm = sourceCmView.current;
	if (!cm?.dom.isConnected) return null;
	const { from, to, empty, head } = cm.state.selection.main;
	const at = cm.state.doc.lineAt(empty ? head : from);
	const start = (empty ? head : from) - at.from;
	return { line: at.number, text: at.text, from: start, to: empty ? start : Math.min(to, at.to) - at.from, fromSource: true };
}

/** the word under the cursor, or each selected line with its stretch; a line the cursor is not on keeps its boxes */
async function refineAtCursor(viewer: WordSource, boxes: Rect[], line: number, path: string, caret: CaretSpot | null): Promise<Rect[]> {
	if (!caret || caret.line !== line) return boxes;
	const cm = caret.fromSource ? sourceCmView.current : null;
	const sel = cm?.state.selection.main;
	if (!cm || !sel || sel.empty) {
		if (caret.from === caret.to) return refineWord(viewer, boxes, caret.text, caret.from);
		return refineRange(viewer, boxes, caret.text, caret.from, caret.to);
	}
	// a selection in the source editor can span lines: each one is refined on its own
	const { from, to } = sel;
	const doc = cm.state.doc;
	const rects: Rect[] = [];
	const last = Math.min(doc.lineAt(to).number, line + MAX_SELECTED_LINES - 1);
	for (let n = line; n <= last; n++) {
		const l = doc.line(n);
		const start = Math.max(from, l.from) - l.from;
		const end = Math.min(to, l.to) - l.from;
		if (end <= start && n !== line) continue;
		// following: a line that lands in another PDF has nothing to show on this one
		const own = n === line ? boxes : ((await lvProject.syncForward(path, n, true).catch(() => null))?.rects ?? null);
		if (own) rects.push(...(await refineRange(viewer, own, l.text, start, Math.max(end, start + 1))));
	}
	return rects.length ? rects : boxes;
}

/** the buffer when the file is the one open, so a word typed since the last save is still there (in either editor) */
async function sourceOf(file: string, loaded: string | null, buffer: string | null): Promise<string | null> {
	if (loaded && samePath(file, loaded) && buffer !== null) return buffer;
	const cm = sourceCmView.current;
	if (cm?.dom.isConnected && loaded && samePath(file, loaded)) return cm.state.doc.toString();
	return readTextFile(file).catch(() => null);
}

export type SyncTexDeps = {
	isGuest(): boolean;
	getLoadedPath(): string | null;
	/** only .tex files carry SyncTeX positions */
	isTex(): boolean;
	/** root of the draft-mode preview, whose reconcile PDF has the layout the canvases show */
	getDraftRoot(): string;
	expectedPdfPath(): string | null;
	setPdfPaneOpen(open: boolean): void;
	/** scroll the mounted PDF pane, retrying while it is still mounting */
	scrollPdfTo(page: number, x: number, y: number, w: number, h: number): void;
	/** draft mode highlights inside DraftView instead of the standalone pane */
	syncDraftTo(page: number, x: number, y: number, w: number, h: number): void;
	openFileAtLine(file: string, line: number, selectText?: string, column?: number, columnEnd?: number): void;
	/** LatexFrog: the caret in whichever editor is on screen, for SyncTeX to the word */
	caret?(): CaretSpot | null;
	/** LatexFrog: the open file's text as edited, unsaved changes included */
	buffer?(): string | null;
};

/** normalize a path out of synctex to the workspace separator so it matches the open file */
export function normSyncPath(p: string): string {
	const root = workspaceRoot.current ?? '';
	const sep = root.includes('\\') ? '\\' : '/';
	return p.replace(/[\\/]+/g, sep);
}

export class SyncTexNav {
	constructor(private deps: SyncTexDeps) {}

	/** forward: a source line -> the matching place in the PDF (scroll + flash a highlight) */
	async forwardToLine(line: number, follow = false): Promise<void> {
		const d = this.deps;
		if (d.isGuest()) {
			const path = d.getLoadedPath();
			if (!path) return;
			const res = await collabGuest.syncForward(path, line);
			if (!res) return;
			d.setPdfPaneOpen(true);
			d.scrollPdfTo(res.page, res.x, res.y, res.w ?? 0, res.h ?? 0);
			return;
		}
		if (lvProject.active) {
			const path = d.getLoadedPath();
			if (!path || !d.isTex()) return;
			try {
				const res = await lvProject.syncForward(path, line, follow);
				if (!res) {
					if (!follow) toaster.error({ title: 'SyncTeX', description: m.wsview_toast_synctex_no_match() });
					return;
				}
				if (!follow) d.setPdfPaneOpen(true);
				const caret = d.caret ? d.caret() : sourceCaret();
				refineNextJump({ rects: (viewer) => refineAtCursor(viewer, res.rects, line, path, caret), mark: follow, scroll: true });
				d.scrollPdfTo(res.page, res.h, res.v, res.width, res.height);
			} catch (e) {
				if (!follow) toaster.error({ title: 'SyncTeX', description: e instanceof Error ? e.message : String(e) });
			}
			return;
		}
		const live = compileConfig.current.latex.liveMode;
		const pdf = live ? d.getDraftRoot() + '/_draft/draft.pdf' : d.expectedPdfPath();
		const path = d.getLoadedPath();
		if (!path || !d.isTex() || !pdf) return;
		const res = await synctexForward(pdf, path, line);
		console.debug('[synctex] forward', { tex: path, line, pdf, res });
		if (!res.ok) {
			// LatexFrog: Follow asks on its own (a folder just opened, before any compile); only a jump someone asked for reports
			if (follow) return;
			const missing = programNotFound(res.error);
			if (missing && askForProgram(missing)) return;
			toaster.error({ title: 'SyncTeX', description: res.error ?? m.wsview_toast_synctex_no_match() });
			return;
		}
		d.setPdfPaneOpen(true);
		// highlight the enclosing box: origin (h, v) = line-start + baseline, size (W, H). NOT (x, y),
		// the matched node's point: pairing that with W/H drew the box shifted and ~a line too low.
		if (live) d.syncDraftTo(res.page, res.h, res.v, res.width, res.height);
		else d.scrollPdfTo(res.page, res.h, res.v, res.width, res.height);
	}

	/** forward from the current cursor (the header "Sync to PDF" button) */
	async forwardFromCursor(follow = false): Promise<void> {
		const caret = this.deps.caret ? this.deps.caret() : sourceCaret();
		if (caret) await this.forwardToLine(caret.line, follow);
	}

	/** inverse: a double-click in the PDF opens the source at the matching line. selectText lets
	 * the editor snap to the real text even if the line drifted since the compile. */
	async inverseFromClick(page: number, x: number, y: number, selectText?: string): Promise<void> {
		const d = this.deps;
		if (d.isGuest()) {
			const res = await collabGuest.syncInverse(page, x, y);
			if (res && res.line >= 1) d.openFileAtLine(res.file, res.line, res.selectText ?? selectText);
			return;
		}
		if (lvProject.active) {
			const res = await lvProject.syncInverse(page, x, y).catch(() => null);
			if (!res) return;
			const file = normSyncPath(res.file);
			const viewer = clickedViewer();
			const source = viewer ? await sourceOf(file, d.getLoadedPath(), d.buffer?.() ?? null) : null;
			const spot: SourceSpot = viewer && source !== null ? await refineClick(viewer, { page, x, y }, res.line, source).catch(() => ({ line: res.line })) : { line: res.line };
			if (spot.from !== undefined) d.openFileAtLine(file, spot.line, undefined, spot.from, spot.to);
			else d.openFileAtLine(file, spot.line, selectText);
			return;
		}
		const pdf = d.expectedPdfPath();
		if (!pdf) return;
		const res = await synctexInverse(pdf, page, x, y);
		console.debug('[synctex] inverse', { pdf, page, x, y, res, selectText });
		if (res.ok && res.input && res.line >= 1) d.openFileAtLine(normSyncPath(res.input), res.line, selectText);
	}
}

/** host side of a guest's SyncTeX request: only the host has the .synctex data, so it resolves
 * against its own PDF and replies with a workspace-relative file (guests key on relative paths). */
export async function resolveGuestSyncRequest(payload: ControlPayload, root: string, pdf: string): Promise<ControlPayload | null> {
	if (payload.kind === 'synctex-inverse') {
		const res = await synctexInverse(pdf, payload.page, payload.x, payload.y);
		if (!res.ok || !res.input || res.line < 1) return null;
		return {
			kind: 'synctex-inverse-result',
			reqId: payload.reqId,
			file: relativeTo(root, normSyncPath(res.input)).replace(/\\/g, '/'),
			line: res.line
		};
	}
	if (payload.kind !== 'synctex-forward') return null; // not a sync request; nothing to reply
	const res = await synctexForward(pdf, joinPath(root, payload.file), payload.line);
	if (!res.ok) return null;
	return { kind: 'synctex-forward-result', reqId: payload.reqId, page: res.page, x: res.h, y: res.v, w: res.width, h: res.height };
}

/** a guest's file keys are manifest-relative, but resolved jump targets (the Problems panel
 * root-joins via resolveLogPath) arrive prefixed with the synthetic 'session' root. Strip it back
 * off, else activeFilePath -> the Y.Text binding keys on 'session/foo.tex' and opens an empty
 * buffer instead of the real shared file. No-op for host absolute paths. */
export function sessionRelativeTarget(file: string, isGuest: boolean): string {
	const root = workspaceRoot.current;
	return isGuest && root && file.startsWith(root + '/') ? file.slice(root.length + 1) : file;
}

export function needsActivate(target: string): boolean {
	return !samePath(activeFilePath.current ?? '', target) || activeFigure.current !== null;
}
