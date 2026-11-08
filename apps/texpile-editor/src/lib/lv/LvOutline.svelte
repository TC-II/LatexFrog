<script lang="ts">
	// The whole project's chapters and sections in document order, from the engine's index. Contents, under the file tree,
	// stays on the open file: this is what it cannot show. Read from disk, so it refreshes on opening and after each build.
	import { joinPath } from '$lib/workspace/fileSystem';
	import { activeFilePath } from '$lib/workspace/workspaceStore';
	import { m } from '$lib/paraglide/messages';
	import { lvProject, type Symbols } from '$lib/lv/lvEngine.svelte';
	import { partLabel } from '$lib/lv/lvProfiles';
	import { outlineDepths, outlineParents, outlineVisible } from '$lib/lv/lvOutlineTree';
	import { treeMarker, treeText } from '$lib/lv/lvTreeStyle';
	import { pdfStore } from '$lib/stores/pdfStore';

	let { onOpenFileAt }: { onOpenFileAt: (file: string, line: number) => void } = $props();

	let symbols = $state<Symbols | null>(null);
	/** the files in the PDF on show; a heading of a file a TeX switch leaves out (`\ocultarSolucionestrue`) is not in it */
	let inPdf = $state<Set<string> | null>(null);

	$effect(() => {
		void lvProject.revision;
		void pdfStore.current;
		if (!lvProject.view?.root) return;
		let stale = false;
		void lvProject.pdfFiles().then((f) => {
			if (!stale) inPdf = f;
		});
		return () => {
			stale = true;
		};
	});
	const missing = (file: string) => inPdf !== null && !inPdf.has(file.toLowerCase());
	let error = $state('');
	let shownRoot: string | undefined;

	$effect(() => {
		void lvProject.revision;
		const root = lvProject.view?.root;
		// another folder (or one that is not a project yet): nothing of the previous project's outline stays
		if (root !== shownRoot) {
			shownRoot = root;
			symbols = null;
			folded = new Set();
		}
		if (!root) return;
		let stale = false;
		lvProject
			.symbols()
			.then((s) => {
				if (stale) return;
				symbols = s;
				error = '';
			})
			.catch((e) => {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});

	/** the rows whose block is folded, by key; kept while the project stays open */
	let folded = $state<Set<string>>(new Set());
	const toggle = (key: string) => {
		const next = new Set(folded);
		if (!next.delete(key)) next.add(key);
		folded = next;
	};

	/** the heading last opened: the arrow keys move from it */
	let selected = $state<string | null>(null);

	/** a heading in the view that is showing (the visual editor stays visual); the row keeps the focus for the arrow keys */
	function go(file: string, line: number, key: string, row: HTMLElement) {
		selected = key;
		if (lvProject.onOpenAt) lvProject.onOpenAt(file, line);
		else onOpenFileAt(joinPath(root, file), line);
		for (const ms of [0, 150, 400]) setTimeout(() => selected === key && row.isConnected && row.focus({ preventScroll: true }), ms);
	}

	/** Up and Down move through the rows on show, Home and End to the ends; Right unfolds a row or steps into it, Left folds it
	 *  or steps out to the row that holds it */
	function onKey(e: KeyboardEvent) {
		const here = (e.target as HTMLElement).closest<HTMLElement>('[data-outline-row]');
		if (!here) return;
		const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-outline-row]')];
		const at = rows.indexOf(here);
		const depth = Number(here.dataset.depth ?? 0);
		const expanded = here.getAttribute('aria-expanded');
		let next: HTMLElement | undefined;
		if (e.key === 'ArrowDown') next = rows[at + 1];
		else if (e.key === 'ArrowUp') next = rows[at - 1];
		else if (e.key === 'Home') next = rows[0];
		else if (e.key === 'End') next = rows[rows.length - 1];
		else if (e.key === 'ArrowRight') {
			if (expanded === 'false') {
				e.preventDefault();
				toggle(here.dataset.key as string);
				return;
			}
			if (expanded === 'true') next = rows[at + 1];
		} else if (e.key === 'ArrowLeft') {
			if (expanded === 'true') {
				e.preventDefault();
				toggle(here.dataset.key as string);
				return;
			}
			next = rows.slice(0, at).findLast((r) => Number(r.dataset.depth ?? 0) < depth);
		} else return;
		e.preventDefault();
		if (!next || next === here) return;
		next.scrollIntoView({ block: 'nearest' });
		next.click();
	}

	const root = $derived(lvProject.view?.root ?? '');
	const isActive = (file: string) => {
		const active = activeFilePath.current?.replace(/\\/g, '/').toLowerCase();
		return active === joinPath(root, file).replace(/\\/g, '/').toLowerCase();
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scroll-inset-r min-h-0 flex-1 overflow-y-auto p-1.5 text-sm" data-testid="lv-outline" onkeydown={onKey}>
	{#if error}
		<p class="text-error-500 p-2">{error}</p>
	{:else if !symbols}
		<p class="p-2 opacity-60">{m.lv_outline_loading()}</p>
	{:else if symbols.sections.length === 0}
		<!-- a document with no headings still has a body: one entry for it, as if it were one chapter -->
		{#if lvProject.view?.rootFile}
			{@const main = lvProject.view.rootFile}
			<button
				type="button"
				class="hover:preset-tonal flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left {treeText(0)} {isActive(main) ? 'text-primary-ink' : ''}"
				style="padding-left: 4px"
				title={main}
				data-testid="lv-outline-body"
				data-outline-row
				onclick={(e) => go(main, 1, 'body', e.currentTarget)}
			>
				<span class="shrink-0 {treeMarker(0)}" aria-hidden="true"></span>
				<span class="truncate">{m.lv_outline_body({ file: main.split('/').pop() ?? main })}</span>
			</button>
			<p class="p-2 text-xs opacity-60">{m.lv_outline_empty()}</p>
		{:else}
			<p class="p-2 opacity-60">{m.lv_outline_empty()}</p>
		{/if}
	{:else}
		{@const items = symbols.composition ?? symbols.sections.map((_, index) => ({ kind: 'section' as const, index, part: null }))}
		<!-- each row's depth: a guide at the top, an exercise and a worked example it loads side by side under it (lvOutlineTree) -->
		{@const depths = outlineDepths(items, symbols.sections.map((x) => x.level), lvProject.partGroups)}
		{@const syms = symbols}
		{@const keys = items.map((it) => (it.kind === 'section' ? `${syms.sections[it.index].file}:${syms.sections[it.index].line}:${it.index}` : `${it.kind}:${it.file}:${it.line}`))}
		{@const parents = outlineParents(depths)}
		{@const visible = outlineVisible(depths, keys.map((k, n) => parents[n] && folded.has(k)))}
		{#if parents.some(Boolean)}
			<div class="bg-surface-50-950 sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 flex justify-end gap-0.5 px-1.5 py-1 text-xs">
				<button type="button" class="hover:preset-tonal rounded px-1.5 py-0.5 opacity-70" data-testid="lv-outline-collapse-all" onclick={() => (folded = new Set(keys.filter((_, n) => parents[n])))}>{m.lv_outline_collapse_all()}</button>
				<button type="button" class="hover:preset-tonal rounded px-1.5 py-0.5 opacity-70" data-testid="lv-outline-expand-all" onclick={() => (folded = new Set())}>{m.lv_outline_expand_all()}</button>
			</div>
		{/if}
		{#each items as it, n (n)}
			{#if !visible[n]}
				<!-- inside a folded block -->
			{:else if it.kind !== 'section'}
				{@const out = lvProject.leftOut(it)}
				{@const key = `${it.kind}:${it.file}:${it.line}`}
				{@const depth = depths[n]}
				{@const name = it.kind === 'part' ? partLabel(it.name, it.label ? { [it.name]: it.label } : undefined) : it.name}
				<!-- a part with no heading (a guide, named by its title) heads its block; a piece that is not a heading (the title page,
				     the table of contents, a guide's cover) is in italics, with a square -->
				<button
					type="button"
					class="hover:preset-tonal flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left {it.kind === 'piece' ? `italic ${treeText(Math.max(depth, 2))}` : treeText(depth)} {isActive(it.file) && it.kind === 'part' ? 'text-primary-ink' : ''} {selected === key ? 'preset-tonal' : ''} {out ? 'opacity-45' : ''}"
					style="padding-left: {4 + depth * 14}px"
					title={`${it.kind === 'part' ? `${name}\n` : ''}${it.file}:${it.line}${out ? ` — ${m.lv_outline_left_out({ profile: lvProject.shownProfileLabel })}` : ''}`}
					data-left-out={out || undefined}
					data-depth={depth}
					data-outline-row
					data-key={keys[n]}
					aria-expanded={parents[n] ? !folded.has(keys[n]) : undefined}
					data-testid={it.kind === 'part' ? 'lv-outline-part' : 'lv-outline-piece'}
					onclick={(e) => go(it.file, it.line, key, e.currentTarget)}
				>
					{#if parents[n]}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<span class="-ml-0.5 flex size-3.5 shrink-0 items-center justify-center opacity-60 hover:opacity-100" title={m.lv_outline_toggle()} data-testid="lv-outline-toggle" role="presentation" onclick={(e) => { e.stopPropagation(); toggle(keys[n]); }}>
							<svg viewBox="0 0 10 10" class="size-2.5 transition-transform {folded.has(keys[n]) ? '' : 'rotate-90'}" aria-hidden="true"><path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
						</span>
					{:else}
						<span class="-ml-0.5 size-3.5 shrink-0" aria-hidden="true"></span>
					{/if}
					<span class="shrink-0 {treeMarker(depth, it.kind === 'piece')}" aria-hidden="true"></span>
					<span class="truncate">{name}</span>
				</button>
			{:else}
			{@const i = it.index}
			{@const s = symbols.sections[i]}
			{@const out = lvProject.leftOut(it)}
			{@const parent = (symbols.sections[i + 1]?.level ?? -1) > s.level}
			{@const depth = depths[n]}
			<!-- a heading set where a part is called (`\exercise{slug}`) opens the part's file, where the exercise is written -->
			{@const opens = 'opens' in it ? it.opens : undefined}
			{@const target = opens ?? s.file}
			<button
				type="button"
				class="hover:preset-tonal flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left {treeText(depth)} {isActive(target) ? 'text-primary-ink' : ''} {selected === `${s.file}:${s.line}:${i}` ? 'preset-tonal' : ''} {missing(s.file) || out ? 'opacity-45' : ''}"
				style="padding-left: {4 + depth * 14}px"
				data-depth={depth}
				title={missing(s.file) ? `${s.file}:${s.line} — ${m.lv_outline_not_in_pdf()}` : out ? `${s.file}:${s.line} — ${m.lv_outline_left_out({ profile: lvProject.shownProfileLabel })}` : `${s.file}:${s.line}`}
				data-left-out={out || undefined}
				data-not-in-pdf={missing(s.file) || undefined}
				data-parent={parent || undefined}
				data-outline-row
				data-key={keys[n]}
				aria-expanded={parents[n] ? !folded.has(keys[n]) : undefined}
				aria-current={selected === `${s.file}:${s.line}:${i}` || undefined}
				onclick={(e) => go(target, opens ? 1 : s.line, `${s.file}:${s.line}:${i}`, e.currentTarget)}
			>
				{#if parents[n]}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span class="-ml-0.5 flex size-3.5 shrink-0 items-center justify-center opacity-60 hover:opacity-100" title={m.lv_outline_toggle()} data-testid="lv-outline-toggle" role="presentation" onclick={(e) => { e.stopPropagation(); toggle(keys[n]); }}>
						<svg viewBox="0 0 10 10" class="size-2.5 transition-transform {folded.has(keys[n]) ? '' : 'rotate-90'}" aria-hidden="true"><path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
					</span>
				{:else}
					<span class="-ml-0.5 size-3.5 shrink-0" aria-hidden="true"></span>
				{/if}
				<!-- every heading has its depth's dot, so siblings look alike whether or not they have headings under them -->
				<span class="shrink-0 {treeMarker(depth)}" aria-hidden="true"></span>
				<span class="truncate">{s.title || m.lv_outline_untitled()}</span>
			</button>
			{/if}
		{/each}
	{/if}
</div>
