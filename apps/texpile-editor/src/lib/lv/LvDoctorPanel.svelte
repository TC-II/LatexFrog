<script lang="ts">
	// The doctor's report in the bottom dock. The engine project keeps it: the tab shows its warnings before this opens.
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';

	const report = $derived(lvProject.doctor);
	const LEVEL = { ok: 'text-success-500', info: 'opacity-70', aviso: 'text-warning-500', error: 'text-error-500' };
	let busy = $state(false);
	let error = $state('');

	async function run() {
		busy = true;
		error = '';
		try {
			await lvProject.runDoctor();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		busy = false;
	}

	$effect(() => {
		if (!lvProject.doctor) void run();
	});
</script>

<div class="h-full overflow-y-auto p-2 text-sm" data-testid="lv-doctor" aria-busy={busy}>
	<div class="mb-1 flex items-center gap-2">
		<button class="hover:preset-tonal rounded px-2 py-0.5" disabled={busy} onclick={run}>{m.lv_diag_run_doctor()}</button>
		{#if report?.distribucion}
			<span class="opacity-70">{report.distribucion}</span>
		{/if}
	</div>
	{#if error}
		<p class="text-error-500">{error}</p>
	{/if}
	{#if report}
		{#each report.hallazgos as f (f.id)}
			<div class="py-1" data-testid="lv-doctor-row">
				<div class={LEVEL[f.nivel]}>{f.titulo}{f.archivo ? ` (${f.archivo}${f.linea ? `:${f.linea}` : ''})` : ''}</div>
				<div class="opacity-70">{f.detalle}</div>
				{#if f.arreglo}
					<div class="opacity-70">{f.arreglo}</div>
				{/if}
			</div>
		{/each}
	{:else if !error}
		<p class="opacity-60">{m.lv_loading()}</p>
	{/if}
</div>
