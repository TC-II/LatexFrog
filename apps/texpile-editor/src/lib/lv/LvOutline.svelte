<script lang="ts">
	// The whole project's chapters and sections in document order, from the engine's index. Contents, under the file tree,
	// stays on the open file: this is what it cannot show. Read from disk, so it refreshes on opening and after each build.
	import { joinPath } from '$lib/workspace/fileSystem';
	import { activeFilePath } from '$lib/workspace/workspaceStore';
	import { m } from '$lib/paraglide/messages';
	import { lvProject, type Symbols } from '$lib/lv/lvEngine.svelte';

	let { onOpenFileAt }: { onOpenFileAt: (file: string, line: number) => void } = $props();

	let symbols = $state<Symbols | null>(null);
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

	const root = $derived(lvProject.view?.root ?? '');
	const isActive = (file: string) => {
		const active = activeFilePath.current?.replace(/\\/g, '/').toLowerCase();
		return active === joinPath(root, file).replace(/\\/g, '/').toLowerCase();
	};
</script>

<div class="scroll-inset-r min-h-0 flex-1 overflow-y-auto p-1.5 text-sm" data-testid="lv-outline">
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
				class="hover:preset-tonal flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left font-semibold {isActive(main) ? 'text-primary-ink' : ''}"
				style="padding-left: 4px"
				title={main}
				data-testid="lv-outline-body"
				onclick={() => onOpenFileAt(joinPath(root, main), 1)}
			>
				<span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
				<span class="truncate">{m.lv_outline_body({ file: main.split('/').pop() ?? main })}</span>
			</button>
			<p class="p-2 text-xs opacity-60">{m.lv_outline_empty()}</p>
		{:else}
			<p class="p-2 opacity-60">{m.lv_outline_empty()}</p>
		{/if}
	{:else}
		{@const top = Math.min(...symbols.sections.map((x) => x.level))}
		{#each symbols.sections as s, i (`${s.file}:${s.line}:${i}`)}
			{@const parent = (symbols.sections[i + 1]?.level ?? -1) > s.level}
			<button
				type="button"
				class="hover:preset-tonal flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left {s.level <= 1 ? 'font-semibold' : ''} {parent ? 'text-[0.95rem]' : ''} {isActive(s.file) ? 'text-primary-ink' : ''}"
				style="padding-left: {4 + Math.max(0, s.level - 1) * 14}px"
				title="{s.file}:{s.line}"
				data-parent={parent || undefined}
				onclick={() => onOpenFileAt(joinPath(root, s.file), s.line)}
			>
				<!-- a heading with headings under it: a dot, so the tree reads at a glance; solid at the top level, hollow below it -->
				<span class="size-1.5 shrink-0 rounded-full {parent ? (s.level === top ? 'bg-current' : 'border border-current') : 'bg-transparent'}" aria-hidden="true"></span>
				<span class="truncate">{s.title || m.lv_outline_untitled()}</span>
			</button>
		{/each}
	{/if}
</div>
