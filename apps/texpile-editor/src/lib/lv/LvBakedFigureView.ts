// A figure block of the visual editor shown as its baked picture. The figure cache already holds every TikZ figure as a PDF, so
// there is no reason to show its code: the picture is drawn in its place, with a small </> button that switches to the source
// editor at the figure's code (or opens the file it is loaded from). Nothing is edited here: the code is edited in the normal editor.
//
// Until the engine answers, and for a figure not baked yet, the block stays Texpile's raw code view, which this view wraps.
import type { Node } from 'prosemirror-model';
import type { EditorView as PMView, NodeView } from 'prosemirror-view';
import { RawLatexView } from '$lib/editor/visual/extensions/raw-latex/rawLatexView';
import { m } from '$lib/paraglide/messages';
import { lvProject } from './lvEngine.svelte';
import { assign, figuresOf, mayHoldBakedFigure, pictureOf, type FigureImage } from './lvFigureImages';

/**
 * ProseMirror hands a block to the view already at its place when that view accepts it, and Texpile's raw views accept any raw
 * block. A figure arriving where another block was would keep that view, so a view made for something else turns figures down:
 * the editor then asks the node view factory again, which gives this view.
 */
export function leaveFiguresToBaked(nv: NodeView, node: Node): NodeView {
	if (nv instanceof LvBakedFigureView || !nv.update) return nv;
	let was = mayHoldBakedFigure(node.textContent);
	const update = nv.update.bind(nv);
	nv.update = (next, ...rest) => {
		const now = mayHoldBakedFigure(next.textContent);
		if (now && !was) return false;
		const ok = update(next, ...rest);
		if (ok) was = now;
		return ok;
	};
	return nv;
}

/** how recently a key in a figure's code view counts as typing in it */
const TYPING_MS = 5000;

/** how long after a jump the visual editor keeps its caret in sight while figures turn into pictures */
const LANDING_MS = 6000;
let landingAt = 0;

/** a jump is landing in the visual editor (maybe in a file still opening): see keepLandingInSight. Scrolling or typing ends it. */
export function markLanding() {
	landingAt = Date.now();
}

const endLanding = () => (landingAt = 0);

/**
 * A figure drawn as its picture changes the height of the page. Right after a jump (the Figures panel, SyncTeX, a file just opened)
 * the figures above the target are still tall code views and turn into short pictures one by one, carrying the target out of sight:
 * each one drawn brings the block that holds the caret back to the middle.
 */
function keepLandingInSight(view: PMView) {
	if (Date.now() - landingAt > LANDING_MS) return;
	const $head = view.state.selection.$head;
	if ($head.depth === 0) return;
	const dom = view.nodeDOM($head.before(1));
	if (dom instanceof HTMLElement && dom.isConnected) dom.scrollIntoView({ block: 'center' });
}

export class LvBakedFigureView implements NodeView {
	dom: HTMLElement;
	private raw: RawLatexView;
	private strip: HTMLElement;
	private showing: FigureImage[] = [];
	private destroyed = false;
	/** when a key was last pressed in the code view */
	private typedAt = 0;

	constructor(
		private node: Node,
		private view: PMView,
		private getPos: () => number,
		private filePath: () => string | null
	) {
		this.raw = new RawLatexView(node, view, getPos);
		// the reader taking over ends the landing: the view no longer moves on its own
		for (const type of ['wheel', 'keydown', 'mousedown'] as const) view.dom.addEventListener(type, endLanding, { passive: true });
		this.dom = document.createElement('div');
		this.dom.className = 'lv-baked-figure';
		this.strip = document.createElement('div');
		this.strip.contentEditable = 'false';
		this.strip.className = 'group relative my-2 flex flex-col items-center gap-2 rounded-base border border-transparent p-2';
		this.strip.addEventListener('dblclick', (e) => {
			e.preventDefault();
			this.showSource(this.showing[0]);
		});
		this.dom.appendChild(this.raw.dom);
		this.raw.dom.addEventListener('keydown', () => (this.typedAt = Date.now()));
		// code kept open because someone was typing in it becomes the picture again once the cursor leaves
		this.raw.dom.addEventListener('focusout', () => setTimeout(() => !this.baked && !this.raw.dom.contains(document.activeElement) && void this.look(), 0));
		void this.look();
	}

	private get baked(): boolean {
		return this.showing.length > 0;
	}

	/** the figures of this block, from the engine's list of the file matched against every raw block of the document */
	private async look() {
		const figures = await figuresOf(this.filePath());
		if (this.destroyed || figures.length === 0) return;
		const blocks: string[] = [];
		let own = -1;
		const pos = this.getPos();
		this.view.state.doc.descendants((n, at) => {
			if (n.type.name !== 'raw_latex') return true;
			if (at === pos) own = blocks.length;
			blocks.push(n.textContent);
			return false;
		});
		const mine = own >= 0 ? assign(blocks, figures)[own] : [];
		// a block whose figures are not all baked keeps its code: half a figure as a picture would hide the rest
		if (mine.length === 0 || mine.some((f) => !f.pdf)) return this.toCode();
		// the code view stays while someone is typing in it. A caret that only landed there (switching from the source editor, a
		// jump from the Figures panel or SyncTeX) is no reason to hide the picture: the visual editor always shows figures as pictures.
		if (this.raw.dom.contains(document.activeElement) && Date.now() - this.typedAt < TYPING_MS) return;
		this.showing = mine;
		await this.drawStrip();
	}

	private async drawStrip() {
		const items = await Promise.all(this.showing.map(async (f) => ({ f, picture: f.pdf ? await pictureOf(f.pdf) : null })));
		if (this.destroyed || items.some((i) => !i.picture)) return this.toCode();
		this.strip.replaceChildren();
		for (const { f, picture } of items) {
			const img = document.createElement('img');
			img.src = picture!.url;
			img.alt = f.nombre;
			img.draggable = false;
			img.style.width = `${picture!.width}px`;
			img.className = 'max-w-full bg-white';
			this.strip.appendChild(img);
		}
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = '</>';
		button.title = m.lv_figure_code_title();
		button.setAttribute('aria-label', m.lv_figure_code_title());
		button.dataset.testid = 'lv-figure-code';
		button.className = 'btn btn-xs preset-tonal absolute top-1 right-1 font-mono opacity-60 group-hover:opacity-100';
		button.addEventListener('click', (e) => {
			e.preventDefault();
			this.showSource(this.showing[0]);
		});
		this.strip.appendChild(button);
		this.dom.replaceChildren(this.strip);
		const view = this.view;
		requestAnimationFrame(() => keepLandingInSight(view));
	}

	private toCode() {
		this.showing = [];
		if (this.dom.firstChild !== this.raw.dom) this.dom.replaceChildren(this.raw.dom);
	}

	/** the source editor at the figure's code: this file at its line, or the file it is loaded from */
	private showSource(f: FigureImage | undefined) {
		if (f) lvProject.onShowSource?.(f.archivo, f.linea);
	}

	update(node: Node): boolean {
		if (node.type !== this.node.type || !mayHoldBakedFigure(node.textContent)) return false;
		const changed = node.textContent !== this.node.textContent;
		this.node = node;
		if (!this.raw.update(node)) return false;
		if (changed) {
			this.toCode();
			void this.look();
		}
		return true;
	}

	setSelection(anchor: number, head: number) {
		markLanding();
		if (!this.baked) return this.raw.setSelection(anchor, head);
		// a caret placed in a figure shown as its picture (a jump from the Figures panel, SyncTeX, a mode switch) has no DOM to sit
		// in, and ProseMirror scrolls only to a DOM selection of its own: the picture brings itself into view instead
		requestAnimationFrame(() => keepLandingInSight(this.view));
	}

	selectNode() {
		if (this.baked) this.strip.classList.add('border-primary-500');
		else this.raw.selectNode();
	}

	deselectNode() {
		this.strip.classList.remove('border-primary-500');
		if (!this.baked) this.raw.deselectNode();
	}

	stopEvent(event: Event): boolean {
		if (this.baked) return event.target instanceof Element && !!event.target.closest('button');
		return this.raw.stopEvent();
	}

	ignoreMutation(): boolean {
		return true;
	}

	destroy() {
		this.destroyed = true;
		this.raw.destroy();
	}
}
