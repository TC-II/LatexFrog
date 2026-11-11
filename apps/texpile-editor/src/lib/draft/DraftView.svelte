<script lang="ts">
	// Shows the engine's output on screen and splices instant patches into it.
	// Everything painted came from the real engine (page records, the exact PDF at rest,
	// daemon typesets while typing); a patch applies ONLY where the C1/C2/C3 predicates
	// prove a real recompile would produce the same page, else nothing is painted and the
	// full pass runs.
	// The locate ladder, overflow planning, and patch verification live in ./locate and
	// ./patch; the caches, painting, patch lifecycle, and compile lifecycle live in the
	// session pieces (draftSession and what it composes). This file is the view shell.
	import { tip } from '$lib/components/tooltip.svelte';
	import { untrack, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { ZoomIn, ZoomOut, MoveHorizontal, ChevronUp, ChevronDown, Crosshair, Download, PictureInPicture2 } from '@lucide/svelte';
	import PreviewToolbar, { type PreviewToolbarPlace } from '$lib/preview/PreviewToolbar.svelte';
	import PageField from '$lib/preview/zoom/PageField.svelte';
	import ColorVisionMenu from '$lib/preview/colorVision/ColorVisionMenu.svelte';
	import ColorVisionFilter from '$lib/preview/colorVision/ColorVisionFilter.svelte';
	import InvertColorsItem from '$lib/preview/invertColors/InvertColorsItem.svelte';
	import { pagesInverted } from '$lib/preview/invertColors/pagesInverted';
	import { wheelZoomFactor } from '$lib/preview/zoom/wheelZoom';
	import ProgressLine from '$lib/components/progress/ProgressLine.svelte';
	import { DraftSession } from './draftSession.svelte';
	import type { PatchReq } from './patch/patch.types';
	import { openToolchainPrefs } from '$lib/stores/dialogStore';
	import { askForProgram } from '$lib/modals/window/missingProgram/missingProgram.svelte';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from '$lib/lv/lvEngine.svelte';
	import type { LiveWordSync } from '$lib/lv/liveWords';

	type Props = {
		root: string;
		mainFile: string;
		/** bump to trigger a recompile (e.g. on save / compile press). */
		trigger: number;
		/** bump for a QUIET recompile: the page holds, no "Compiling…" announcement -- for
		 * boundary-line edits (comments, labels) whose render is expected unchanged. */
		quietTrigger?: number;
		/** SyncTeX inverse: a double-click on a page resolved to a source location. */
		onInverseSync?: (file: string, line: number, selectText?: string) => void;
		/** a compile landed: the editor re-evaluates any edits typed while it ran. */
		onSettled?: () => void;
		/** a compile landed: its log is at this path, for the Problems panel to parse. */
		onDiagnostics?: (logPath: string) => void;
		/** Save PDF: the buffer on disk and no debounced pass pending, before its own full pass. */
		settleEdits?: () => Promise<void>;
		/** the preview is paused and its engine stopped; a pass it still runs stops the engine again */
		paused?: boolean;
		/** docked in the pane, where this row stands in for a tab strip; false in the popped-out window */
		asTabStrip?: boolean;
		/** move the preview into its own window; null in the popped-out body, which needs no button */
		onPopout?: (() => void) | null;
		/** the project's controls, at the start of the bar as on the PDF's; the status then gives way first */
		controls?: Snippet;
	};
	let {
		root,
		mainFile,
		trigger,
		quietTrigger = 0,
		onInverseSync,
		onSettled,
		onDiagnostics,
		settleEdits,
		paused = false,
		asTabStrip = true,
		onPopout = null,
		controls
	}: Props = $props();

	const ctrl = new DraftSession({
		root: () => root,
		mainFile: () => mainFile,
		onInverseSync: () => onInverseSync,
		onSettled: () => onSettled,
		onDiagnostics: () => onDiagnostics,
		settleEdits: () => settleEdits,
		paused: () => paused
	});
	const vp = ctrl.vp;
	const compiler = ctrl.compiler;
	// LatexFrog: another document (a Live profile switch, or another chapter of a `current` profile) keeps the old pages until its
	// first pass settles; hide them meanwhile
	const loadingOther = $derived(!!mainFile && !!compiler.landedFor && compiler.landedFor !== root + '|' + mainFile + '|' + lvProject.liveDocument);

	/** Instant path: re-typeset one edited paragraph on the warm daemon and splice it into its
	 * page -- only when provably identical to a full recompile. Called on every edit burst. */
	export async function instantPatch(req: PatchReq) {
		await ctrl.instantPatch(req);
	}
	/** register a structurally-edited paragraph to jump to after the recompile lands. */
	export function focusAfterCompile(req: { file: string; line: number; endLine: number; text: string; listItem?: boolean }) {
		ctrl.patcher.setFocus(req);
	}
	/** forward sync: scroll + flash the box synctex reported for a source line. */
	export function syncTo(pageNo: number, hBp: number, vBp: number, wBp: number, hgtBp: number, word?: LiveWordSync) {
		ctrl.syncTo(pageNo, hBp, vBp, wBp, hgtBp, word);
	}

	// recompile whenever `trigger` changes (and once on mount). untrack the compile call:
	// compile() reads and writes $state, so without untrack this effect would take those as
	// dependencies and re-run itself into an infinite loop.
	$effect(() => {
		const t = trigger;
		untrack(() => void compiler.compile('trigger:' + t));
	});
	// quiet passes (boundary-line edits): same compile, no announcement. 0 = never bumped,
	// so this never duplicates the mount compile above.
	$effect(() => {
		const t = quietTrigger;
		if (t > 0) untrack(() => void compiler.compile('quiet:' + t));
	});
	// react to zoom changes (from buttons, wheel, or a fit-to-width): instant CSS resize +
	// debounced crisp re-render
	$effect(() => {
		void vp.zoom;
		if (!ctrl.pages.length) return;
		untrack(() => vp.onZoomChanged());
	});
	// re-fit when the pane resizes, until the user takes manual control
	$effect(() => {
		void vp.containerW;
		if (vp.fitMode) untrack(() => vp.fitToWidth());
	});
	// ctrl/cmd + wheel zooms; a plain wheel scrolls. The listener must be non-passive for
	// preventDefault to take, so attach it by hand once the scroller is bound.
	$effect(() => {
		const el = vp.scroller;
		if (!el) return;
		function onWheel(e: WheelEvent) {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			untrack(() => vp.zoomAt(vp.zoom * wheelZoomFactor(e), e.clientX, e.clientY));
		}
		el.addEventListener('wheel', onWheel, { passive: false });
		// LatexFrog: the user moving the PDF (wheel, scrollbar, keys) keeps Follow from pulling it back while the caret rests
		const held = (e: Event) => {
			lvProject.notePdfScrolled();
			// a single click lets go of a double-clicked word; the double-click's own first click comes before it is selected
			if (e.type === 'pointerdown' && (e as PointerEvent).detail < 2) ctrl.dropSelection();
		};
		for (const ev of ['wheel', 'pointerdown', 'keydown'] as const) el.addEventListener(ev, held, { passive: true });
		return () => {
			el.removeEventListener('wheel', onWheel);
			for (const ev of ['wheel', 'pointerdown', 'keydown'] as const) el.removeEventListener(ev, held);
		};
	});
	// the losing side of a takeover pauses immediately rather than on the next keystroke
	$effect(() => compiler.attachPreempt());
</script>

<div class="flex h-full w-full flex-col bg-(--pdf-page-area-bg)">
	<!-- in the "..." it would be a line of text among actions: it gives way instead, unless it is a problem -->
	{#snippet status(place: PreviewToolbarPlace = 'bar')}
		{#if place === 'bar'}
			{#if compiler.error}
				<span class="text-error-ink shrink-0 text-sm">{m.draft_preview_error_label()}</span>
			{:else}
				<span class="truncate text-sm">{compiler.status}</span>
			{/if}
		{/if}
	{/snippet}
	{#snippet pages()}
		<PageField page={vp.curPage} total={ctrl.pages.length} label={m.draft_toolbar_page_aria()} ongo={(n) => vp.goToPage(n)} />
		<button
			onclick={() => vp.goToPage(vp.curPage - 1)}
			disabled={vp.curPage <= 1}
			use:tip={m.draft_toolbar_prev_page()}
			aria-label={m.draft_toolbar_prev_page()}
		>
			<ChevronUp size={16} />
		</button>
		<button
			onclick={() => vp.goToPage(vp.curPage + 1)}
			disabled={vp.curPage >= ctrl.pages.length}
			use:tip={m.draft_toolbar_next_page()}
			aria-label={m.draft_toolbar_next_page()}
		>
			<ChevronDown size={16} />
		</button>
	{/snippet}
	{#snippet zoom()}
		<button
			onclick={() => vp.zoomOut()}
			disabled={!ctrl.pages.length}
			use:tip={m.draft_toolbar_zoom_out()}
			aria-label={m.draft_toolbar_zoom_out()}
		>
			<ZoomOut size={16} />
		</button>
		<button class="wide" onclick={() => vp.actualSize()} disabled={!ctrl.pages.length} use:tip={m.draft_toolbar_actual_size()}>
			{Math.round(vp.zoom * 100)}%
		</button>
		<button
			onclick={() => vp.zoomIn()}
			disabled={!ctrl.pages.length}
			use:tip={m.draft_toolbar_zoom_in()}
			aria-label={m.draft_toolbar_zoom_in()}
		>
			<ZoomIn size={16} />
		</button>
		<button
			aria-pressed={vp.fitMode}
			onclick={() => vp.fitWidthBtn()}
			disabled={!ctrl.pages.length}
			use:tip={m.draft_toolbar_fit_width()}
			aria-label={m.draft_toolbar_fit_width()}
		>
			<MoveHorizontal size={16} />
		</button>
	{/snippet}
	{#snippet follow()}
		<button
			aria-pressed={vp.followEdits}
			onclick={() => (vp.followEdits = !vp.followEdits)}
			disabled={!ctrl.pages.length}
			use:tip={vp.followEdits ? m.draft_toolbar_follow_edits_on() : m.draft_toolbar_follow_edits_off()}
			aria-label={m.draft_toolbar_follow_edits_aria()}
		>
			<Crosshair size={16} />
		</button>
	{/snippet}
	{#snippet save(place: PreviewToolbarPlace)}
		<button
			class:menu-item={place === 'menu'}
			onclick={() => ctrl.savePdf()}
			disabled={!ctrl.pages.length || ctrl.savingPdf}
			use:tip={m.draft_toolbar_save_pdf()}
			aria-label={m.draft_toolbar_save_pdf()}
		>
			<Download size={16} />
			{#if place === 'menu'}{m.draft_toolbar_save_pdf()}{/if}
		</button>
	{/snippet}
	{#snippet invert(place: PreviewToolbarPlace)}
		<InvertColorsItem {place} />
	{/snippet}
	{#snippet vision(place: PreviewToolbarPlace)}
		<ColorVisionMenu {place} />
	{/snippet}
	{#snippet popout()}
		<button onclick={() => onPopout?.()} use:tip={m.wsview_popout_preview()} aria-label={m.wsview_popout_preview()}>
			<PictureInPicture2 size={16} />
		</button>
	{/snippet}
	<!-- the same row as the PDF viewer's, with the engine status where the file name would be -->
	<PreviewToolbar
		leading={controls ?? status}
		leadIsControls={!!controls}
		trailing={onPopout ? popout : undefined}
		{asTabStrip}
		groups={[
			...(controls ? [{ id: 'status', pinned: !!compiler.error, foldsFirst: true, render: status }] : []),
			...(ctrl.pages.length ? [{ id: 'pages', render: pages }] : []),
			{ id: 'zoom', render: zoom },
			{ id: 'follow', render: follow },
			{ id: 'invert', inMenu: true, render: invert },
			{ id: 'vision', inMenu: true, render: vision },
			{ id: 'save', inMenu: true, render: save }
		]}
	/>
	<ProgressLine
		active={(ctrl.savingPdf && compiler.compiling) || loadingOther}
		label={loadingOther ? m.draft_loading_other() : m.draft_status_compiling_export()}
	/>
	{#if compiler.busyElsewhere}
		<div
			class="border-surface-300-700 bg-surface-50-950 rounded-container m-3 flex shrink-0 items-center justify-between gap-3 border p-3 text-sm"
		>
			<span class="text-muted">{m.draft_busy_other_window()}</span>
			<button class="btn btn-xs preset-filled-primary-500 shrink-0" onclick={() => compiler.takeoverEngine()}
				>{m.draft_busy_takeover()}</button
			>
		</div>
	{/if}
	{#if compiler.missingTool}
		<div class="text-error-ink bg-surface-50-950 rounded-container m-3 flex shrink-0 items-center gap-3 p-3 text-xs">
			<span class="min-w-0 flex-1">{compiler.error}</span>
			<button
				class="btn btn-sm preset-tonal shrink-0"
				onclick={() => compiler.missingTool && !askForProgram(compiler.missingTool) && openToolchainPrefs()}
				>{m.compile_tool_missing_action()}</button
			>
		</div>
	{:else if compiler.error}
		<!-- Now a single line in the normal case (the log tail moved to Problems), but the cap stays
		     as a backstop: `error` can also be a thrown exception's message, and overflow-auto cannot
		     scroll a box that is free to grow. Without a height constraint this took its full content
		     height and the flex-1 scroller below it got whatever was left. -->
		<pre
			class="text-error-ink bg-surface-50-950 rounded-container m-3 max-h-40 shrink-0 [scrollbar-gutter:stable] overflow-auto p-3 text-xs whitespace-pre-wrap">{compiler.error}</pre>
	{/if}
	<ColorVisionFilter class="relative flex min-h-0 flex-1 flex-col">
		{#if loadingOther}
			<div class="text-muted absolute inset-0 z-10 flex items-center justify-center text-sm" role="status">{m.draft_loading_other()}</div>
		{/if}
		<div
			bind:this={vp.scroller}
			bind:clientWidth={vp.containerW}
			onscroll={() => vp.onScroll()}
			class:invisible={loadingOther}
			class="flex flex-1 [scrollbar-gutter:stable] flex-col items-center-safe gap-4 overflow-auto p-5"
		>
			{#each ctrl.pages as p (p.n)}
				<div class="relative rounded-[2px] shadow-(--page-shadow)">
					<canvas
						bind:this={ctrl.canvasEls[p.n - 1]}
						class="cursor-text"
						class:invert-94={pagesInverted()}
						class:hue-rotate-180={pagesInverted()}
						ondblclick={(e) => ctrl.onCanvasDblClick(p.n, e)}
					></canvas>
					{#if vp.editBand && vp.editBand.page === p.n}
						<!-- the located band of the paragraph being edited; fades shortly after typing stops -->
						<div
							class="rounded-base bg-draft-band/30 pointer-events-none absolute"
							transition:fade={{ duration: 300 }}
							style="left:{(ctrl.paper.mx + vp.editBand.colL) * vp.dispScale}px; top:{(ctrl.paper.my + vp.editBand.top - 2) *
								vp.dispScale}px; width:{(vp.editBand.colR - vp.editBand.colL) * vp.dispScale}px; height:{(vp.editBand.bottom -
								vp.editBand.top +
								4) *
								vp.dispScale}px"
						></div>
					{/if}
					{#if ctrl.wordMarks}
						<!-- LatexFrog: SyncTeX's word, drawn as on a profile's PDF: Follow's mark stays, a jump's flash fades -->
						{#each ctrl.wordMarks.rects.filter((r) => r.page === p.n) as r, i (ctrl.wordMarks.id + ':' + i)}
							<div
								class="pointer-events-none absolute z-[6] lv-word-{ctrl.wordMarks.kind}"
								data-testid="lv-word-{ctrl.wordMarks.kind}"
								style="left:{(ctrl.paper.mx + r.x) * vp.dispScale}px; top:{(ctrl.paper.my + r.y) * vp.dispScale}px; width:{Math.max(3, r.w * vp.dispScale)}px; height:{r.h * vp.dispScale}px"
							></div>
						{/each}
					{/if}
					{#if vp.clickMark && vp.clickMark.page === p.n}
						<!-- where the sync double-click landed -->
						<div
							class="pointer-events-none absolute"
							transition:fade={{ duration: 200 }}
							style="left:{vp.clickMark.x * vp.dispScale}px; top:{vp.clickMark.y * vp.dispScale}px"
						>
							<span class="border-primary-500 absolute size-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2"></span>
							<span class="bg-primary-500 absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"></span>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</ColorVisionFilter>
</div>

<style>
	/* LatexFrog: the PDF viewer's SyncTeX marks (PDFPageView mark and highlight) */
	.lv-word-follow {
		background: rgba(55, 138, 221, 0.25);
		border-bottom: 2px solid rgba(55, 138, 221, 0.9);
	}
	/* a double-clicked word, in the selection's color */
	.lv-word-select {
		background: Highlight;
		mix-blend-mode: multiply;
		opacity: 0.55;
	}
	.lv-word-flash {
		min-width: 8px;
		background: rgba(255, 196, 0, 0.45);
		outline: 1px solid rgba(220, 150, 0, 0.7);
		border-radius: 2px;
		animation: lv-word-fade 1.8s ease forwards;
	}
	@keyframes lv-word-fade {
		0%,
		55% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
