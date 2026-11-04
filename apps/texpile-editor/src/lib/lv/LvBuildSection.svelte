<script lang="ts">
	// The project's build profiles and parts, inside the Compile button's menu. Renders nothing outside an engine project.
	import { menuItemClass, separatorClass } from '$lib/menus/menuStyles';
	import { lvProject } from '$lib/lv/lvEngine.svelte';

	let busy = $state(false);
	let error = $state('');

	async function apply(fields: object) {
		busy = true;
		error = '';
		try {
			await lvProject.setState(fields);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		busy = false;
	}

	const view = $derived(lvProject.view);
	const profiles = $derived((view?.config?.profiles ?? []).filter((p) => !p.hidden));
	const active = $derived(profiles.find((p) => p.id === view?.state.activeProfile) ?? null);
	const bySelection = $derived(active?.parts === 'selection');
	const short = (name: string) => name.replace(/^.*\//, '');

	function toggle(name: string) {
		if (!view) return;
		const cur = view.state.selection;
		const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
		if (next.length > 0) void apply({ selection: next }); // an empty selection is not a build
	}
</script>

{#if view && profiles.length > 0}
	<div class="flex flex-col gap-1 px-3 py-2 text-sm" aria-busy={busy}>
		<label class="flex items-center justify-between gap-3">
			<span class="opacity-70">Profile</span>
			<select
				class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5"
				value={view.state.activeProfile ?? ''}
				disabled={busy || view.lockedBy !== null}
				onchange={(e) => void apply({ profile: e.currentTarget.value })}
			>
				{#each profiles as p (p.id)}
					<option value={p.id}>{p.label}</option>
				{/each}
			</select>
		</label>
		{#if bySelection}
			<div class="mt-1 max-h-56 overflow-y-auto">
				{#each view.parts as part (part.name)}
					<label class="{menuItemClass} gap-2 whitespace-nowrap">
						<input type="checkbox" checked={view.state.selection.includes(part.name)} disabled={busy} onchange={() => toggle(part.name)} />
						<span>{short(part.name)}</span>
					</label>
				{/each}
			</div>
		{:else if active}
			<span class="opacity-60">Parts: {active.parts === 'all' ? 'all' : active.parts === 'current' ? 'current file' : active.parts}</span>
		{/if}
		{#if error}
			<span class="text-error-500">{error}</span>
		{/if}
	</div>
	<div class={separatorClass}></div>
{/if}
