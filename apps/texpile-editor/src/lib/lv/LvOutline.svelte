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

	$effect(() => {
		void lvProject.revision;
		const root = lvProject.view?.root;
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
		<p class="p-2 opacity-60">{m.lv_outline_empty()}</p>
	{:else}
		{#each symbols.sections as s, i (`${s.file}:${s.line}:${i}`)}
			<button
				type="button"
				class="hover:preset-tonal block w-full truncate rounded py-0.5 pr-1 text-left {s.level <= 1 ? 'font-semibold' : ''} {isActive(s.file) ? 'text-primary-ink' : ''}"
				style="padding-left: {4 + Math.max(0, s.level - 1) * 14}px"
				title="{s.file}:{s.line}"
				onclick={() => onOpenFileAt(joinPath(root, s.file), s.line)}
			>
				{s.title || m.lv_outline_untitled()}
			</button>
		{/each}
	{/if}
</div>
