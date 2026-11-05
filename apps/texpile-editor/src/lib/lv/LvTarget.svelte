<script lang="ts">
	// Beside Compile: the active profile and what it is about to build. This is the only place that picks what compiles; everything
	// else about a build belongs to the profile and changes in Project Configuration. The Compile menu used to repeat those options
	// and they contradicted the profile: a footer choice there was saved and ignored.
	import { m } from '$lib/paraglide/messages';
	import { activeFilePath } from '$lib/workspace/workspaceStore';
	import { lvProject } from './lvEngine.svelte';
	import { compileTarget } from './lvProfiles';

	const view = $derived(lvProject.view);
	const profiles = $derived((view?.config?.profiles ?? []).filter((p) => !p.hidden));
	const active = $derived(profiles.find((p) => p.id === view?.state.activeProfile) ?? null);
	const locked = $derived(view?.lockedBy != null);

	$effect(() => {
		void activeFilePath.current;
		void lvProject.noteActiveFile();
	});

	const target = $derived.by(() => {
		if (!active || !view) return '';
		const count = active.parts === 'list' ? active.partList.length : view.state.selection.length;
		const t = compileTarget(active.parts, lvProject.fileInfo?.part ?? view.state.currentPart ?? null, count);
		if (t.kind === 'current') return t.part ?? '';
		if (t.kind === 'count') return m.lv_target_parts({ count: t.count ?? 0 });
		return t.kind === 'none' ? m.lv_target_none() : m.lv_target_all();
	});
	const why = $derived(active?.parts === 'current' ? m.lv_target_current_title() : '');
	/** a long chapter name would push the bar around: 8 characters and an ellipsis, the whole name on hover */
	const short = $derived(target.length > 9 ? `${target.slice(0, 8).trimEnd()}…` : target);
</script>

{#if view && active}
	<div class="flex min-w-0 items-center gap-1.5 text-xs @max-[20rem]:hidden" data-testid="lv-target">
		<span class="size-2 shrink-0 rounded-full" style="background: {active.color ?? 'var(--color-surface-500)'}"></span>
		<select
			class="max-w-28 rounded border border-surface-300-700 bg-transparent px-1 py-0.5"
			aria-label={m.lv_profile()}
			value={active.id}
			disabled={locked}
			onchange={(e) => void lvProject.setState({ profile: e.currentTarget.value }).then(() => lvProject.noteActiveFile())}
		>
			{#each profiles as p (p.id)}
				<option value={p.id}>{p.label}</option>
			{/each}
		</select>
		<span class="inline-block w-[9ch] shrink-0 truncate opacity-70 @max-[38rem]:hidden" title={why ? `${target} · ${why}` : target} data-testid="lv-target-parts">{short}</span>
	</div>
{/if}
