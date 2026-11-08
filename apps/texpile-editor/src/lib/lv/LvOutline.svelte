<script lang="ts">
	// The whole project's chapters and sections in document order, from the engine's index. Contents, under the file tree,
	// stays on the open file: this is what it cannot show. Read from disk, so it refreshes on opening and after each build.
	import { joinPath } from '$lib/workspace/fileSystem';
	import { activeFilePath } from '$lib/workspace/workspaceStore';
	import { m } from '$lib/paraglide/messages';
	import { lvProject, type Symbols } from '$lib/lv/lvEngine.svelte';
	import { partLabel } from '$lib/lv/lvProfiles';
	import { outlineDepths } from '$lib/lv/lvOutlineTree';
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

	/** the heading last opened: the arrow keys move from it */
	let selected = $state<string | null>(null);

	/** a heading in the view that is showing (the visual editor stays visual); the row keeps the focus for the arrow keys */
	function go(file: string, line: number, key: string, row: HTMLElement) {
		selected = key;
		if (lvProject.onOpenAt) lvProject.onOpenAt(file, line);
		else onOpenFileAt(joinPath(root, file), line);
		for (const ms of [0, 150, 400]) setTimeout(() => selected === key && row.isConnected && row.focus({ preventScroll: true }), ms);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const here = (e.target as HTMLElement).closest<HTMLElement>('[data-outline-row]');
		if (!here) return;
		const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-outline-row]')];
		const next = rows[rows.indexOf(here) + (e.key === 'ArrowDown' ? 1 : -1)];
		if (!next) return;
		e.preventDefault();
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
		{#each items as it, n (n)}
			{#if it.kind !== 'section'}
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
					data-testid={it.kind === 'part' ? 'lv-outline-part' : 'lv-outline-piece'}
					onclick={(e) => go(it.file, it.line, key, e.currentTarget)}
				>
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
				aria-current={selected === `${s.file}:${s.line}:${i}` || undefined}
				onclick={(e) => go(target, opens ? 1 : s.line, `${s.file}:${s.line}:${i}`, e.currentTarget)}
			>
				<!-- every heading has its depth's dot, so siblings look alike whether or not they have headings under them -->
				<span class="shrink-0 {treeMarker(depth)}" aria-hidden="true"></span>
				<span class="truncate">{s.title || m.lv_outline_untitled()}</span>
			</button>
			{/if}
		{/each}
	{/if}
</div>
