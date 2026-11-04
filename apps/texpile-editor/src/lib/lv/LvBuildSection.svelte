<script lang="ts">
	// Latex Frog's build profiles and parts, inside the Compile button's menu. The list comes from the
	// lv-core sidecar (`lv-build . --info`), and a choice writes the project's `.lv/state.json` through
	// the same sidecar; the Compile button itself still runs the project's command (`lv-build .`), which
	// builds the active profile. Renders nothing when the folder is not a Latex Frog project.
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import { menuItemClass, separatorClass } from '$lib/menus/menuStyles';

	type Profile = { id: string; label: string; parts: string; hidden: boolean; color: string | null };
	type Part = { name: string };
	type View = {
		config: { profiles: Profile[] } | null;
		state: { activeProfile: string | null; selection: string[] };
		parts: Part[];
		lockedBy: number | null;
	};

	let view = $state<View | null>(null);
	let busy = $state(false);
	let error = $state('');

	async function run(args: string[]) {
		const root = workspaceRoot.current;
		const lv = window.texpileLv;
		if (!root || !lv) return;
		busy = true;
		error = '';
		const r = await lv.run(root, [...args, '--info']);
		busy = false;
		if (r.ok && r.stdout) {
			try {
				view = JSON.parse(r.stdout) as View;
			} catch {
				error = 'La respuesta de lv-build no es JSON';
			}
		} else if (!view) {
			view = null; // not a Latex Frog project (or no lv-build on the PATH): stay out of the way
		} else {
			error = r.stderr || r.error || 'lv-build falló';
		}
	}

	// the menu mounts this each time it opens, so the list is never stale
	$effect(() => {
		if (workspaceRoot.current) void run([]);
	});

	const profiles = $derived((view?.config?.profiles ?? []).filter((p) => !p.hidden));
	const active = $derived(profiles.find((p) => p.id === view?.state.activeProfile) ?? null);
	const bySelection = $derived(active?.parts === 'selection');
	const short = (name: string) => name.replace(/^.*\//, '');

	function toggle(name: string) {
		if (!view) return;
		const cur = view.state.selection;
		const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
		if (next.length === 0) return; // an empty selection is not a build
		void run(['--parts', next.join(',')]);
	}
</script>

{#if view && profiles.length > 0}
	<div class="flex flex-col gap-1 px-3 py-2 text-sm" aria-busy={busy}>
		<label class="flex items-center justify-between gap-3">
			<span class="opacity-70">Perfil</span>
			<select
				class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5"
				value={view.state.activeProfile ?? ''}
				disabled={busy || view.lockedBy !== null}
				onchange={(e) => void run(['--activar', e.currentTarget.value])}
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
			<span class="opacity-60">Partes: {active.parts === 'all' ? 'todas' : active.parts === 'current' ? 'la del archivo actual' : active.parts}</span>
		{/if}
		{#if view.lockedBy !== null}
			<span class="text-warning-500">Abierto en otra instancia (PID {view.lockedBy})</span>
		{/if}
		{#if error}
			<span class="text-error-500">{error}</span>
		{/if}
	</div>
	<div class={separatorClass}></div>
{/if}
