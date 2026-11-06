// Find in a PDF view with the focus means the PDF, not the editor beside it
import { pdfFindToggle } from '$lib/stores/editorStore';

const finds = new WeakMap<Element, () => void>();

/** `{@attach}` on a view's pages; a view that goes away takes its find bar with it, so the split does not reopen on one */
export function pdfViewFind(toggle: () => void, close: () => void) {
	return (view: HTMLElement) => {
		finds.set(view, toggle);
		return () => {
			finds.delete(view);
			close();
		};
	};
}

// a popped-out preview is another window, whose elements are not this window's Element
export function elementOf(at: EventTarget | null): Element | null {
	return at && (at as Node).nodeType === Node.ELEMENT_NODE ? (at as Element) : null;
}

/** Page Up, Page Down, Home and End on a PDF view: the focus sits on the view, but its pages scroll inside the renderer's shadow root */
export function pdfViewKeys(event: KeyboardEvent): void {
	if (event.altKey || event.ctrlKey || event.metaKey) return;
	const target = elementOf(event.target);
	if (target?.closest('input, textarea, [contenteditable="true"]')) return;
	const view = elementOf(event.currentTarget);
	let scroller: HTMLElement | null = null;
	for (const el of view?.querySelectorAll('*') ?? []) {
		scroller = el.shadowRoot?.querySelector<HTMLElement>('.pdf-scroll-container') ?? null;
		if (scroller) break;
	}
	if (!scroller) return;
	const page = scroller.clientHeight * 0.9;
	const by: Record<string, number> = { PageDown: page, PageUp: -page, ' ': event.shiftKey ? -page : page };
	if (event.key === 'Home') scroller.scrollTo({ top: 0 });
	else if (event.key === 'End') scroller.scrollTo({ top: scroller.scrollHeight });
	else if (event.key in by) scroller.scrollBy({ top: by[event.key] });
	else return;
	event.preventDefault();
}

/** the find bar of the PDF view holding `at`, else a .pdf tab's */
export function pdfFindFor(at: EventTarget | null): (() => void) | null {
	const view = elementOf(at)?.closest('[data-pdf-view]');
	return (view && finds.get(view)) ?? pdfFindToggle.current;
}
