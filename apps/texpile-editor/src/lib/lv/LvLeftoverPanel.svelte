<script lang="ts">
	// The TeX processes an earlier run left working in this project, in the bottom dock.
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';

	type TexProcess = { pid: number; nombre: string; cwd: string; linea: string };

	let orphans = $state<TexProcess[] | null>(null);
	let busy = $state(false);
	let error = $state('');

	async function load() {
		busy = true;
		error = '';
		try {
			orphans = await lvProject.request<TexProcess[]>('orphans');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		busy = false;
	}

	async function kill() {
		if (!orphans) return;
		busy = true;
		try {
			await lvProject.request('kill-orphans', { pids: orphans.map((p) => p.pid) });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		await load();
	}

	$effect(() => {
		void load();
	});
</script>

<div class="h-full overflow-y-auto p-2 text-sm" data-testid="lv-leftover" aria-busy={busy}>
	<button class="hover:preset-tonal mb-1 rounded px-2 py-0.5" disabled={busy} onclick={load}>{m.lv_diag_check_again()}</button>
	{#if error}
		<p class="text-error-500">{error}</p>
	{/if}
	{#if orphans?.length === 0}
		<p class="opacity-60" data-testid="lv-no-orphans">{m.lv_diag_no_orphans()}</p>
	{/if}
	{#each orphans ?? [] as p (p.pid)}
		<div class="py-0.5" data-testid="lv-orphan-row">
			<div>{p.nombre} (PID {p.pid})</div>
			<div class="truncate opacity-60">{p.linea}</div>
		</div>
	{/each}
	{#if orphans?.length}
		<button class="mt-2 rounded bg-error-500 px-2 py-1 text-white" disabled={busy} onclick={kill}>{m.lv_diag_kill()}</button>
	{/if}
</div>
