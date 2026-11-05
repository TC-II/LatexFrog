<script lang="ts">
	// The project's parts. Ticked ones are what a "chosen parts" profile compiles; 1 leaves only that one; ▶ compiles one part now.
	// ▶ and Ctrl+Alt+C are the accepted exceptions to compiling only through a profile.
	import { Play } from '@lucide/svelte';
	import { joinPath } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';
	import { shortName } from './lvProfiles';

	let { onOpenFile }: { onOpenFile: (file: string, line: number) => void } = $props();

	const view = $derived(lvProject.view);
	const parts = $derived(view?.parts ?? []);
	const selection = $derived(view?.state.selection ?? []);
	const active = $derived(view?.config?.profiles.find((p) => p.id === view?.state.activeProfile) ?? null);
	const choosing = $derived(active?.parts === 'selection');
	const current = $derived(lvProject.fileInfo?.part ?? null);

	const select = (next: string[]) => void lvProject.setState({ selection: next });
	const toggle = (name: string) => select(selection.includes(name) ? selection.filter((n) => n !== name) : [...selection, name]);
</script>

<div class="scroll-inset-r flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5 text-sm" data-testid="lv-parts">
	{#if parts.length === 0}
		<p class="p-2 opacity-60">{m.lv_parts_none()}</p>
	{:else}
		{#if !choosing}
			<p class="px-1 text-xs opacity-60">{m.lv_parts_note({ profile: active?.label ?? '' })}</p>
		{/if}
		<div class="flex items-center gap-1 px-1 text-xs">
			<button class="hover:preset-tonal rounded px-1.5 py-0.5" disabled={!choosing} onclick={() => select(parts.map((p) => p.name))}>{m.lv_parts_select_all()}</button>
			<button class="hover:preset-tonal rounded px-1.5 py-0.5" disabled={!current} title={m.lv_parts_this_title()} onclick={() => void lvProject.compilePart(current)}>{m.lv_parts_this()}</button>
		</div>
		{#each parts as p (p.name)}
			{@const ticked = selection.includes(p.name)}
			<div class="group flex items-center gap-1 rounded px-1 {p.name === current ? 'preset-tonal' : ''}" data-testid="lv-part-row">
				<input type="checkbox" checked={ticked} disabled={!choosing || (ticked && selection.length === 1)} onchange={() => toggle(p.name)} />
				<button type="button" class="min-w-0 flex-1 truncate text-left {choosing && !ticked ? 'opacity-50' : ''}" title={p.file ?? p.name} ondblclick={() => p.file && onOpenFile(joinPath(view?.root ?? '', p.file), 1)}>{shortName(p.name)}</button>
				<button type="button" class="hover:preset-tonal rounded px-1 text-xs" disabled={!choosing} title={m.lv_parts_only_title()} onclick={() => select([p.name])}>1</button>
				<button type="button" class="hover:preset-tonal rounded p-0.5" title={m.lv_parts_compile_title()} aria-label={m.lv_parts_compile_title()} data-testid="lv-part-compile" onclick={() => void lvProject.compilePart(p.name)}><Play class="size-3" /></button>
			</div>
		{/each}
	{/if}
</div>
