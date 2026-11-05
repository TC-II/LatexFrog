<script lang="ts">
	// The sidebar's Project outline: everything about the whole project rather than the open file, in one place. Contents lists the
	// chapters and sections, Parts what a profile compiles, Figures the figure cache. One sidebar entry for all three keeps
	// Texpile's sidebar change down to a single view.
	import { m } from '$lib/paraglide/messages';
	import { lvProject, type OutlineTab } from './lvEngine.svelte';
	import LvFiguresPanel from './LvFiguresPanel.svelte';
	import LvFrog from './LvFrog.svelte';
	import LvOutline from './LvOutline.svelte';
	import LvPartsPanel from './LvPartsPanel.svelte';

	let { onOpenFileAt }: { onOpenFileAt: (file: string, line: number) => void } = $props();

	const TABS: [OutlineTab, () => string][] = [
		['contents', () => m.lv_outline_contents()],
		['parts', () => m.lv_parts_title()],
		['figures', () => m.lv_figures_tab()]
	];
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="lv-project-outline">
	<div class="flex items-center gap-0.5 border-b border-surface-200-800 px-1.5 py-1 text-xs" role="tablist" aria-label={m.lv_outline_title()}>
		<LvFrog />
		{#each TABS as [id, label] (id)}
			<button
				type="button"
				role="tab"
				aria-selected={lvProject.outlineTab === id}
				class="rounded px-2 py-0.5 {lvProject.outlineTab === id ? 'preset-tonal-primary' : 'hover:preset-tonal opacity-70'}"
				data-testid="lv-outline-tab-{id}"
				onclick={() => (lvProject.outlineTab = id)}>{label()}</button
			>
		{/each}
	</div>
	{#if lvProject.outlineTab === 'parts'}
		<LvPartsPanel onOpenFile={onOpenFileAt} />
	{:else if lvProject.outlineTab === 'figures'}
		<div class="min-h-0 flex-1"><LvFiguresPanel /></div>
	{:else}
		<LvOutline {onOpenFileAt} />
	{/if}
</div>
