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

export class LvBakedFigureView implements NodeView {
	dom: HTMLElement;
	private raw: RawLatexView;
	private strip: HTMLElement;
	private showing: FigureImage[] = [];
	private destroyed = false;

	constructor(
		private node: Node,
		private view: PMView,
		private getPos: () => number,
		private filePath: () => string | null
	) {
		this.raw = new RawLatexView(node, view, getPos);
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
		// code kept open because the cursor was in it becomes the picture again once the cursor leaves
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
		// the code view keeps the focus while someone is typing in it
		if (this.raw.dom.contains(document.activeElement)) return;
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
		if (!this.baked) this.raw.setSelection(anchor, head);
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
