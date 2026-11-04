<script lang="ts">
	// The project's build profiles, parts and variables, inside the Compile button's menu. Renders nothing outside an engine project.
	import { menuItemClass, separatorClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from '$lib/lv/lvEngine.svelte';

	let busy = $state(false);
	let error = $state('');

	async function apply(fields: object) {
		busy = true;
		error = '';
		try {
			await lvProject.setState(fields);
			await lvProject.noteActiveFile();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		busy = false;
	}

	// the menu mounts this each time it opens, so the file's status is never stale
	$effect(() => {
		void lvProject.noteActiveFile();
	});

	const view = $derived(lvProject.view);
	const locked = $derived(view?.lockedBy != null);
	const profiles = $derived((view?.config?.profiles ?? []).filter((p) => !p.hidden));
	const variables = $derived(view?.config?.variables ?? []);
	const active = $derived(profiles.find((p) => p.id === view?.state.activeProfile) ?? null);
	const short = (name: string) => name.replace(/^.*\//, '');
	const value = (name: string, fallback: string | null) => view?.state.variables[name] ?? fallback ?? '';

	const partsLabel = $derived(active?.parts === 'all' ? m.lv_parts_all() : active?.parts === 'current' ? m.lv_parts_current() : active?.parts === 'one' ? m.lv_parts_one() : '');
	const fileLabel = $derived.by(() => {
		const info = lvProject.fileInfo;
		if (!info) return '';
		if (info.affects === 'yes') return m.lv_file_in_build();
		return info.affects === 'other_part' ? m.lv_file_other_part({ part: short(info.part ?? '') }) : m.lv_file_unrelated();
	});

	// the engine applies the same rule (Session::borrador_para); the box only says so before a build does
	const draftFixed = $derived(active ? active.publica || active.draftImages : false);
	const draftChecked = $derived(active?.publica ? false : active?.draftImages || view?.state.draftImages === true);
	const draftNote = $derived(active?.publica ? m.lv_draft_delivery() : active?.draftImages ? m.lv_draft_always() : '');

	function toggle(name: string) {
		if (!view) return;
		const cur = view.state.selection;
		const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
		if (next.length > 0) void apply({ selection: next }); // an empty selection is not a build
	}

	function setVariable(name: string, val: string) {
		if (view) void apply({ variables: { ...view.state.variables, [name]: val } });
	}
</script>

{#if view && profiles.length > 0}
	<div class="flex flex-col gap-1 px-3 py-2 text-sm" aria-busy={busy}>
		<label class="flex items-center justify-between gap-3">
			<span class="opacity-70">{m.lv_profile()}</span>
			<select
				class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5"
				value={view.state.activeProfile ?? ''}
				disabled={busy || locked}
				onchange={(e) => void apply({ profile: e.currentTarget.value })}
			>
				{#each profiles as p (p.id)}
					<option value={p.id}>{p.label}</option>
				{/each}
			</select>
		</label>
		{#each variables as v (v.name)}
			<label class="flex items-center justify-between gap-3">
				<span class="opacity-70">{v.label}</span>
				{#if v.choices.length > 0}
					<select class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5" value={value(v.name, v.default)} disabled={busy} onchange={(e) => setVariable(v.name, e.currentTarget.value)}>
						{#each v.choices as c (c)}
							<option value={c}>{c}</option>
						{/each}
					</select>
				{:else}
					<input class="w-28 rounded border border-surface-300-700 bg-transparent px-1 py-0.5" value={value(v.name, v.default)} disabled={busy} onchange={(e) => setVariable(v.name, e.currentTarget.value)} />
				{/if}
			</label>
		{/each}
		{#if active?.parts === 'selection'}
			<div class="mt-1 max-h-56 overflow-y-auto">
				{#each view.parts as part (part.name)}
					<label class="{menuItemClass} gap-2 whitespace-nowrap">
						<input type="checkbox" checked={view.state.selection.includes(part.name)} disabled={busy} onchange={() => toggle(part.name)} />
						<span>{short(part.name)}</span>
					</label>
				{/each}
			</div>
		{:else if partsLabel}
			<span class="opacity-60">{partsLabel}</span>
		{/if}
		{#if fileLabel}
			<span class="opacity-60" data-testid="lv-file-status">{fileLabel}</span>
		{/if}
		<label class="flex items-center gap-2" title={draftNote}>
			<input type="checkbox" checked={draftChecked} disabled={busy || draftFixed} onchange={(e) => void apply({ draftImages: e.currentTarget.checked })} />
			<span>{m.lv_draft_images()}</span>
		</label>
		{#if draftNote}
			<span class="opacity-60">{draftNote}</span>
		{/if}
		{#if error}
			<span class="text-error-500">{error}</span>
		{/if}
	</div>
	<div class={separatorClass}></div>
{/if}
