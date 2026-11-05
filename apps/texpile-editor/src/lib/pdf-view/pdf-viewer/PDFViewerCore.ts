/* eslint-disable @typescript-eslint/naming-convention -- keeps pdf.js's upstream class names */
/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** main viewer managing all pages in a scroll container; derivative work based on PDF.js pdf_viewer.js. */
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus } from './EventBus';
import { PDFPageView, RenderingStates } from './PDFPageView';
import { SimpleLinkService } from './SimpleLinkService';
import { wheelZoomFactor } from '$lib/preview/zoom/wheelZoom';
import { keepPointUnder } from '$lib/preview/zoom/zoomAnchor';
import { ownClick, ownFollowMark, takeRefine, type SyncRefine } from '$lib/lv/lvSync';
import { clave } from '$lib/lv/sync/texto';
import { palabrasDelTramo } from '$lib/lv/sync/metricas';
import type { PalabraPdf, Rect } from '$lib/lv/sync/buscar';

export type PDFViewerOptions = {
	container: HTMLElement;
	eventBus?: EventBus;
	initialScale?: number;
	initialRotation?: number;
	topInset?: number;
	/** SyncTeX inverse search: fired on double-click with the page + position in PDF points (top-left
	 *  origin), plus the double-clicked word so the editor can anchor the jump on the actual text. */
	onPageClick?: (page: number, x: number, y: number, selectText?: string) => void;
};

const DEFAULT_SCALE = 1.0;
const MIN_SCALE = 0.1;
const MAX_SCALE = 10.0;
const DEFAULT_SCALE_DELTA = 0.1;

// pages to render around the visible ones
const PAGES_TO_PRERENDER = 2;

// rendered pages kept alive outside the visible window (nearest-first), mirroring the
// page buffer pdf.js's own viewer uses; anything past this is torn down and re-renders
// lazily on scroll, so long sessions on big PDFs don't accumulate canvases forever
const RENDERED_PAGES_TO_KEEP = 15;

// page layout, mirroring renderer-styles.ts (.pdf-renderer-container padding + flex gap). The scroll
// model below reconstructs page offsets arithmetically (no per-page DOM reads on scroll), so these
// must track that CSS: the first page starts firstPageTop from the top, pages are PAGE_GAP apart,
// and each rendered height is floored (PDFPageView sets style.height = Math.floor(height)).
const CONTAINER_PAD = 20;
const PAGE_GAP = 16;

export class PDFViewerCore {
	readonly container: HTMLElement;
	readonly viewer: HTMLDivElement;
	readonly eventBus: EventBus;

	private pdfDocument: PDFDocumentProxy | null = null;
	private wordsByDocument = new WeakMap<PDFDocumentProxy, Map<number, PalabraPdf[]>>();
	private measureContext: CanvasRenderingContext2D | null = null;
	private followMarks: HTMLElement[] = [];
	private pages: PDFPageView[] = [];
	private currentScale: number;
	private currentRotation: number;
	/** 0-based page last reported as current; a page still fully on screen keeps that title */
	private reportedPage = 0;
	private scrollAbortController: AbortController | null = null;
	private renderingQueue: Set<number> = new Set();
	private isRendering = false;
	private lastScrollTop = 0;
	private scrollingDown = true;
	private pinchTimer: ReturnType<typeof setTimeout> | null = null;
	private onPageClick?: (page: number, x: number, y: number, selectText?: string) => void;
	private readonly topInset: number;
	/** LatexFrog: the pages fill the pane's width, also as it is resized, until a zoom by hand picks a scale of its own */
	keepFitWidth = true;
	private resizeObserver: ResizeObserver | null = null;

	private linkService: SimpleLinkService;

	private get firstPageTop(): number {
		return this.topInset || CONTAINER_PAD;
	}

	constructor(options: PDFViewerOptions) {
		this.container = options.container;
		this.eventBus = options.eventBus ?? new EventBus();
		this.currentScale = options.initialScale ?? DEFAULT_SCALE;
		this.currentRotation = options.initialRotation ?? 0;
		this.onPageClick = options.onPageClick;
		this.topInset = options.topInset ?? 0;

		this.viewer = document.createElement('div');
		this.viewer.className = 'pdfViewer';
		this.container.appendChild(this.viewer);

		this.linkService = new SimpleLinkService({
			eventBus: this.eventBus
		});

		this.setupScrollListener();
		this.setupInverseClick();
		this.setupPinchZoom();
		this.setupFitOnResize();
	}

	private setupFitOnResize(): void {
		if (typeof ResizeObserver === 'undefined') return;
		let frame = 0;
		let lastWidth = this.container.clientWidth;
		this.resizeObserver = new ResizeObserver(() => {
			const width = this.container.clientWidth;
			if (width === lastWidth || frame) return;
			lastWidth = width;
			frame = requestAnimationFrame(() => {
				frame = 0;
				if (!this.keepFitWidth || !this.pages.length) return;
				const anchor = this.getScrollAnchor();
				this.applyFitWidth();
				if (anchor) this.restoreScrollAnchor(anchor);
			});
		});
		this.resizeObserver.observe(this.container);
	}

	// a trackpad pinch arrives as ctrl+wheel
	private setupPinchZoom(): void {
		this.container.addEventListener(
			'wheel',
			(e) => {
				if (!(e.ctrlKey || e.metaKey) || !this.pages.length) return;
				e.preventDefault();
				this.zoomAt(this.currentScale * wheelZoomFactor(e), e.clientX, e.clientY);
			},
			{ passive: false, signal: this.scrollAbortController!.signal }
		);
	}

	// SyncTeX inverse search: a double-click on a page reports its position in PDF points
	private setupInverseClick(): void {
		this.viewer.addEventListener(
			'dblclick',
			(e) => {
				if (!this.onPageClick) return;
				const pageDiv = (e.target as HTMLElement)?.closest?.('.page') as HTMLElement | null;
				if (!pageDiv) return;
				const pageNumber = Number(pageDiv.getAttribute('data-page-number'));
				const pageView = this.pages[pageNumber - 1];
				if (!pageView) return;
				const rect = pageDiv.getBoundingClientRect();
				const { x, y } = pageView.pixelToPdf(e.clientX - rect.left, e.clientY - rect.top);
				// grab the word the double-click selected so the editor can snap to that exact text.
				// The pages live in a shadow root, so read the selection from there (ShadowRoot.getSelection
				// is non-standard but present in Chromium/Electron); fall back to the window selection.
				const root = pageDiv.getRootNode() as { getSelection?: () => Selection | null };
				const sel = root.getSelection?.() ?? window.getSelection?.();
				// a double-click selects one word; anything long or multi-line is a misbehaving or drag
				// selection, so send nothing rather than a garbage anchor
				let selectText: string | undefined = sel?.toString().trim() || undefined;
				if (selectText && (selectText.length > 80 || /\n/.test(selectText))) selectText = undefined;
				ownClick(this);
				this.onPageClick(pageNumber, x, y, selectText);
			},
			{ signal: this.scrollAbortController!.signal }
		);
	}

	// SyncTeX forward search: scroll a box into view and flash a highlight over it.
	// (x, y) is the SyncTeX box origin: x = line start, y = baseline (not the top). Convert both
	// corners through the page transform (a size can't go through a rotating point transform) and
	// take their axis-aligned bounding rect, which stays correct on rotated pages.
	scrollToPosition(pageNumber: number, x: number, y: number, width = 0, height = 0): void {
		const refine = takeRefine();
		if (refine) {
			void refine.rects(this).then(
				(rects) => this.showRects(rects, refine),
				() => this.jumpToBox(pageNumber, x, y, width, height)
			);
			return;
		}
		this.jumpToBox(pageNumber, x, y, width, height);
	}

	/**
	 * The words of a page's text layer with their rectangles, in points from the top left: SyncTeX's space. pdf.js gives one string
	 * per run of text; the words inside come from measuring with the run's font, as its text layer does.
	 */
	async pageWords(page: number): Promise<PalabraPdf[]> {
		const pdf = this.pdfDocument;
		if (!pdf || page < 1 || page > pdf.numPages) return [];
		let cache = this.wordsByDocument.get(pdf);
		if (!cache) this.wordsByDocument.set(pdf, (cache = new Map()));
		const known = cache.get(page);
		if (known) return known;
		const pdfPage = await pdf.getPage(page);
		const [x0, y0, , y1] = pdfPage.view;
		const height = y1 - y0;
		const content = await pdfPage.getTextContent();
		// the page's fonts load with its operator list, as when drawing it; without them the canvas measures with some other font
		await pdfPage.getOperatorList().catch(() => {});
		const ctx = (this.measureContext ??= document.createElement('canvas').getContext('2d'));
		const out: PalabraPdf[] = [];
		for (const item of content.items) {
			if (!('str' in item) || !item.str.trim() || !item.transform) continue;
			const [, , c, d, e, f] = item.transform as number[];
			const size = Math.hypot(c, d) || item.height || 10;
			const width = item.width || size * 0.5 * item.str.length;
			const family = content.styles?.[item.fontName]?.fontFamily;
			let measure: ((text: string) => number) | null = null;
			if (ctx && family) {
				ctx.font = `${size}px ${family}`;
				measure = (text) => ctx.measureText(text).width;
			}
			for (const word of palabrasDelTramo(item.str, width, measure)) {
				const key = clave(word.texto);
				if (key) out.push({ texto: word.texto, clave: key, page, x: e - x0 + word.x, y: height - (f - y0) - size * 0.78, w: word.w, h: size });
			}
		}
		cache.set(page, out);
		return out;
	}

	/** the refined rectangles of a jump, in points from the top left */
	private showRects(rects: Rect[], refine: SyncRefine): void {
		if (rects.length === 0) return;
		const first = rects.reduce((a, b) => (b.page < a.page || (b.page === a.page && b.y < a.y) ? b : a), rects[0]);
		const pageView = this.pages[first.page - 1];
		if (!pageView) return;
		const boxes = rects
			.filter((r) => r.page === first.page)
			.map((r) => {
				const a = pageView.pdfToPixel(r.x, r.y);
				const b = pageView.pdfToPixel(r.x + r.w, r.y + r.h);
				return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
			});
		const pageRect = pageView.div.getBoundingClientRect();
		const contRect = this.container.getBoundingClientRect();
		const y = pageRect.top - contRect.top + boxes[0].top;
		// following keeps the page still while the word is on screen
		if (refine.scroll && (!refine.mark || y < 0 || y > contRect.height - 20)) {
			this.container.scrollTo({ top: Math.max(0, this.container.scrollTop + y - this.container.clientHeight / 3), behavior: refine.mark ? 'auto' : 'smooth' });
		}
		if (refine.mark) {
			this.clearFollowMarks();
			this.followMarks = boxes.map((b) => pageView.mark(b.left, b.top, b.width, b.height));
			ownFollowMark(() => this.clearFollowMarks());
		} else for (const b of boxes) pageView.highlight(b.left, b.top, b.width, b.height);
	}

	private clearFollowMarks(): void {
		for (const el of this.followMarks) el.remove();
		this.followMarks = [];
	}

	private jumpToBox(pageNumber: number, x: number, y: number, width: number, height: number): void {
		const pageView = this.pages[pageNumber - 1];
		if (!pageView) return;
		const a = pageView.pdfToPixel(x, y - height);
		const b = pageView.pdfToPixel(x + width, y);
		const left = Math.min(a.x, b.x);
		const topPx = Math.min(a.y, b.y);
		const boxW = Math.abs(b.x - a.x);
		const boxH = Math.abs(b.y - a.y);
		const pageRect = pageView.div.getBoundingClientRect();
		const contRect = this.container.getBoundingClientRect();
		const top = this.container.scrollTop + (pageRect.top - contRect.top) + topPx - this.container.clientHeight / 3;
		this.container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
		pageView.highlight(left, topPx, boxW, boxH);
	}

	private setupScrollListener(): void {
		this.scrollAbortController?.abort();
		this.scrollAbortController = new AbortController();

		// once a frame while the view moves, as pdf.js's own viewer does. Waiting for the scroll to rest drew
		// nothing through a fast scroll, and the pages came only after it stopped
		let frame = 0;
		const { signal } = this.scrollAbortController;
		this.container.addEventListener(
			'scroll',
			() => {
				if (frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					this.updateVisiblePages();
				});
			},
			{ signal }
		);
		signal.addEventListener('abort', () => cancelAnimationFrame(frame));
	}

	// callable repeatedly on the same instance: replaces the current document in place, so on a
	// recompile the old pages stay on screen through all the async work and the DOM swap below is
	// a single synchronous pass (no half-built frames, no loading state)
	async setDocument(pdfDocument: PDFDocumentProxy): Promise<void> {
		const numPages = pdfDocument.numPages;
		const pdfPages = await Promise.all(Array.from({ length: numPages }, (_, i) => pdfDocument.getPage(i + 1)));

		this.cleanup();

		this.pdfDocument = pdfDocument;

		this.linkService.setDocument(pdfDocument);
		this.linkService.setViewer(this);

		for (const page of pdfPages) {
			const viewport = page.getViewport({
				scale: this.currentScale,
				rotation: this.currentRotation
			});

			const pageView = new PDFPageView({
				container: this.viewer,
				id: page.pageNumber,
				defaultViewport: viewport,
				eventBus: this.eventBus,
				scale: this.currentScale,
				rotation: this.currentRotation,
				linkService: this.linkService
			});

			pageView.setPdfPage(page);
			this.pages.push(pageView);
		}

		this.eventBus.dispatch('pagesloaded', { pagesCount: numPages });

		if (this.keepFitWidth) this.applyFitWidth();
		this.updateVisiblePages();
	}

	private getVisiblePages(): { first: number; last: number; ids: Set<number> } {
		const containerRect = this.container.getBoundingClientRect();
		const containerTop = this.container.scrollTop;
		const containerBottom = containerTop + containerRect.height;

		let firstVisible = -1;
		let lastVisible = -1;
		const visibleIds = new Set<number>();

		let top = this.firstPageTop;
		for (let i = 0; i < this.pages.length; i++) {
			const bottom = top + Math.floor(this.pages[i].height);

			if (bottom >= containerTop && top <= containerBottom) {
				if (firstVisible === -1) {
					firstVisible = i;
				}
				lastVisible = i;
				visibleIds.add(i + 1); // Page numbers are 1-indexed
			}

			top = bottom + PAGE_GAP;
		}

		return {
			first: firstVisible === -1 ? 0 : firstVisible,
			last: lastVisible === -1 ? 0 : lastVisible,
			ids: visibleIds
		};
	}

	// The page to call "current": the one with the largest share of itself on screen, as pdf.js
	// does. The top-most visible page was the old answer, and a short document's last page can
	// never be that: with nothing below it to scroll it up to the top, the counter stopped one
	// short. A page still fully on screen stays current, so a zoomed-out view showing several
	// whole pages does not flip between them on every scroll tick.
	private mostVisiblePage(): number {
		const viewTop = this.container.scrollTop;
		const viewBottom = viewTop + this.container.clientHeight;
		let best = 0;
		let bestShare = -1;
		let top = this.firstPageTop;
		for (let i = 0; i < this.pages.length; i++) {
			const h = Math.floor(this.pages[i].height);
			const bottom = top + h;
			const shown = Math.min(bottom, viewBottom) - Math.max(top, viewTop);
			if (shown > 0 && h > 0) {
				if (i === this.reportedPage && shown >= h) return i;
				const share = shown / h;
				if (share > bestShare) {
					best = i;
					bestShare = share;
				}
			}
			top = bottom + PAGE_GAP;
		}
		return best;
	}

	private updateVisiblePages(): void {
		if (!this.pdfDocument || this.pages.length === 0) return;

		const visible = this.getVisiblePages();
		this.reportedPage = this.mostVisiblePage();

		const startPage = Math.max(0, visible.first - PAGES_TO_PRERENDER);
		const endPage = Math.min(this.pages.length - 1, visible.last + PAGES_TO_PRERENDER);
		const top = this.container.scrollTop;
		if (top !== this.lastScrollTop) this.scrollingDown = top > this.lastScrollTop;
		this.lastScrollTop = top;

		// what is on screen first, then the pages ahead in the direction of the scroll, then those behind. Made
		// anew each time: a page scrolled past before its turn came is dropped, not drawn ahead of these
		const ahead: number[] = [];
		const behind: number[] = [];
		for (let k = 1; k <= PAGES_TO_PRERENDER; k++) {
			(this.scrollingDown ? ahead : behind).push(visible.last + k);
			(this.scrollingDown ? behind : ahead).push(visible.first - k);
		}
		const onScreen = Array.from({ length: visible.last - visible.first + 1 }, (_, k) => visible.first + k);
		this.renderingQueue = new Set(
			[...onScreen, ...ahead, ...behind].filter(
				(i) => i >= 0 && i < this.pages.length && this.pages[i].renderingState === RenderingStates.INITIAL
			)
		);

		this.evictHiddenPages(startPage, endPage);
		this.processRenderingQueue();

		this.eventBus.dispatch('updateviewarea', {
			location: {
				pageNumber: this.reportedPage + 1,
				scale: this.currentScale,
				rotation: this.currentRotation
			}
		});
	}

	// cap memory: rendered pages far from the visible window get torn down (canvas + text +
	// annotation layers) beyond a nearest-first keep buffer. The placeholder div keeps its size,
	// so layout and scroll position don't move, and evicted pages re-render like any INITIAL
	// page on scroll. Only FINISHED pages are touched, so an in-flight draw is never yanked.
	private evictHiddenPages(startPage: number, endPage: number): void {
		const outside: { index: number; distance: number }[] = [];
		for (let i = 0; i < this.pages.length; i++) {
			if (i >= startPage && i <= endPage) continue;
			if (this.pages[i].renderingState !== RenderingStates.FINISHED) continue;
			outside.push({ index: i, distance: i < startPage ? startPage - i : i - endPage });
		}
		if (outside.length <= RENDERED_PAGES_TO_KEEP) return;

		outside.sort((a, b) => a.distance - b.distance);
		for (const { index } of outside.slice(RENDERED_PAGES_TO_KEEP)) {
			this.renderingQueue.delete(index);
			this.pages[index].reset();
		}
	}

	private async processRenderingQueue(): Promise<void> {
		if (this.isRendering || this.renderingQueue.size === 0) return;

		this.isRendering = true;

		while (this.renderingQueue.size > 0) {
			const pageIndex = this.renderingQueue.values().next().value as number;
			this.renderingQueue.delete(pageIndex);

			const page = this.pages[pageIndex];
			if (page && page.renderingState === RenderingStates.INITIAL) {
				await page.draw();
			}
		}

		this.isRendering = false;
	}

	get scale(): number {
		return this.currentScale;
	}

	set scale(value: number) {
		const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
		if (newScale === this.currentScale) return;

		this.currentScale = newScale;
		this.updatePages({ scale: newScale });

		this.eventBus.dispatch('scalechanged', { scale: newScale });
		this.updateVisiblePages();
	}

	get rotation(): number {
		return this.currentRotation;
	}

	set rotation(value: number) {
		const newRotation = ((value % 360) + 360) % 360;
		if (newRotation === this.currentRotation) return;

		this.currentRotation = newRotation;
		this.updatePages({ rotation: newRotation });

		this.eventBus.dispatch('rotationchanged', { rotation: newRotation });
		this.updateVisiblePages();
	}

	// re-render only what's on screen; every other page just gets its box resized and drops any
	// stale raster (lazy), so one zoom doesn't re-rasterize the whole document at once
	private updatePages(props: { scale?: number; rotation?: number }): void {
		const visible = this.getVisiblePages();
		const start = Math.max(0, visible.first - PAGES_TO_PRERENDER);
		const end = Math.min(this.pages.length - 1, visible.last + PAGES_TO_PRERENDER);

		for (let i = 0; i < this.pages.length; i++) {
			this.pages[i].update({ ...props, lazy: i < start || i > end });
		}
	}

	/** a pinch: the pages resize around the point at once, and are drawn sharp once it pauses */
	zoomAt(value: number, x: number, y: number): void {
		this.keepFitWidth = false;
		const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
		if (newScale === this.currentScale) return;
		keepPointUnder(
			this.container,
			this.pages.map((p) => p.div),
			x,
			y,
			() => {
				this.currentScale = newScale;
				for (const page of this.pages) page.stretch(newScale);
			}
		);
		this.eventBus.dispatch('scalechanged', { scale: newScale });
		if (this.pinchTimer) clearTimeout(this.pinchTimer);
		this.pinchTimer = setTimeout(() => this.settlePinch(), 150);
	}

	private settlePinch(): void {
		this.pinchTimer = null;
		const visible = this.getVisiblePages();
		const start = Math.max(0, visible.first - PAGES_TO_PRERENDER);
		const end = Math.min(this.pages.length - 1, visible.last + PAGES_TO_PRERENDER);
		this.pages.forEach((page, i) => page.settle(i < start || i > end));
		this.updateVisiblePages();
	}

	zoomIn(): void {
		this.keepFitWidth = false;
		this.scale = this.currentScale + DEFAULT_SCALE_DELTA;
	}

	zoomOut(): void {
		this.keepFitWidth = false;
		this.scale = this.currentScale - DEFAULT_SCALE_DELTA;
	}

	/** scale so the top-visible page fills the container width (minus the page padding). */
	fitWidth(): void {
		this.keepFitWidth = true;
		this.applyFitWidth();
	}

	private applyFitWidth(): void {
		if (!this.pages.length) return;
		const anchor = this.getScrollAnchor();
		const page = this.pages[(anchor ? anchor.page : 1) - 1] ?? this.pages[0];
		const avail = this.container.clientWidth - 2 * CONTAINER_PAD;
		if (!page.width || avail <= 0) return;
		this.scale = this.currentScale * (avail / page.width);
	}

	/** scale so the top-visible page fits both ways, and land on its top: fit page means see it whole */
	fitPage(): void {
		this.keepFitWidth = false;
		if (!this.pages.length) return;
		const anchor = this.getScrollAnchor();
		const pageNo = anchor ? anchor.page : 1;
		const page = this.pages[pageNo - 1] ?? this.pages[0];
		const availW = this.container.clientWidth - 2 * CONTAINER_PAD;
		const availH = this.container.clientHeight - this.firstPageTop - CONTAINER_PAD;
		if (!page.width || !page.height || availW <= 0 || availH <= 0) return;
		this.scale = this.currentScale * Math.min(availW / page.width, availH / page.height);
		this.restoreScrollAnchor({ page: pageNo, fraction: 0 });
	}

	rotateClockwise(): void {
		this.rotation = this.currentRotation + 90;
	}

	rotateCounterClockwise(): void {
		this.rotation = this.currentRotation - 90;
	}

	scrollToPage(pageNumber: number): void {
		if (pageNumber < 1 || pageNumber > this.pages.length) return;

		const pageView = this.pages[pageNumber - 1];
		// asked for by name, so it is current from here even if a neighbour shows more of itself
		this.reportedPage = pageNumber - 1;
		pageView.div.scrollIntoView({ behavior: 'smooth', block: 'start' });

		this.eventBus.dispatch('pagechanged', { pageNumber });
	}

	// layout-independent scroll position: the top-visible page + how far into it (fraction of the
	// page's height) the top of the view sits, below any floating bar. Survives a reload where the
	// page count / heights shift.
	getScrollAnchor(): { page: number; fraction: number } | null {
		if (!this.pages.length) return null;
		const scrollTop = this.container.scrollTop + this.topInset;
		let top = this.firstPageTop;
		for (let i = 0; i < this.pages.length; i++) {
			const h = Math.floor(this.pages[i].height);
			if (scrollTop < top + h + PAGE_GAP || i === this.pages.length - 1) {
				return { page: i + 1, fraction: (scrollTop - top) / Math.max(1, h) };
			}
			top += h + PAGE_GAP; // inter-page gap, matching getVisiblePages
		}
		return null;
	}

	restoreScrollAnchor(anchor: { page: number; fraction: number }): void {
		if (!this.pages.length) return;
		const idx = Math.min(Math.max(0, anchor.page - 1), this.pages.length - 1);
		let top = this.firstPageTop;
		for (let i = 0; i < idx; i++) top += Math.floor(this.pages[i].height) + PAGE_GAP;
		this.container.scrollTop = Math.max(0, top + anchor.fraction * Math.floor(this.pages[idx].height) - this.topInset);
		this.updateVisiblePages();
	}

	// resolves once every currently-visible page has rasterized (ceiling so a slow render can't
	// stall the caller): lets a view transition hold the old pixels until the new ones exist,
	// so a cross-fade reveals content instead of blank page boxes
	waitForVisiblePages(ceilingMs = 500): Promise<void> {
		const pending = () => {
			const { ids } = this.getVisiblePages();
			return [...ids].some((id) => this.pages[id - 1]?.renderingState !== RenderingStates.FINISHED);
		};
		if (!this.pages.length || !pending()) return Promise.resolve();
		return new Promise((resolve) => {
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				this.eventBus.off('pagerendered', check);
				resolve();
			};
			function check() {
				if (!pending()) finish();
			}
			this.eventBus.on('pagerendered', check);
			setTimeout(finish, ceilingMs);
		});
	}

	get pagesCount(): number {
		return this.pages.length;
	}

	get currentPageNumber(): number {
		return this.mostVisiblePage() + 1;
	}

	getPageView(pageIndex: number): PDFPageView | undefined {
		return this.pages[pageIndex];
	}

	cleanup(): void {
		for (const page of this.pages) {
			page.destroy();
		}
		this.pages = [];
		this.renderingQueue.clear();

		this.viewer.innerHTML = '';

		// free the worker-side resources of the outgoing document; the viewer instance now
		// outlives many documents (one per recompile), so skipping this would leak per compile
		void this.pdfDocument?.loadingTask.destroy().catch(() => {});
		this.pdfDocument = null;
	}

	destroy(): void {
		if (this.pinchTimer) clearTimeout(this.pinchTimer);
		this.resizeObserver?.disconnect();
		this.scrollAbortController?.abort();
		this.cleanup();
		this.eventBus.destroy();
		this.viewer.remove();
	}
}
