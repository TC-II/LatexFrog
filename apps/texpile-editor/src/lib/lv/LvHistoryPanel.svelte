<script lang="ts">
	// One line per job of the engine's queue, in the bottom dock. Reloads when a build ends.
	import { m } from '$lib/paraglide/messages';
	import { jobReason } from './lvFormat';
	import { lvProject } from './lvEngine.svelte';

	type Entry = { inicioMs: number; tipo: string; perfil?: string | null; motivo: string; ms: number; ok: boolean; cancelado?: boolean; pistas?: string[] };

	let history = $state<Entry[] | null>(null);
	let error = $state('');

	$effect(() => {
		void lvProject.revision;
		let stale = false;
		lvProject
			.request<Entry[]>('history', { limit: 100 })
			.then((rows) => {
				if (stale) return;
				history = rows;
				error = '';
			})
			.catch((e) => {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			});
		return () => {
			stale = true;
		};
	});
</script>

<div class="h-full overflow-y-auto p-2 text-sm" data-testid="lv-history">
	{#if error}
		<p class="text-error-500">{error}</p>
	{:else if history?.length === 0}
		<p class="opacity-60">{m.lv_diag_no_history()}</p>
	{/if}
	{#each history ?? [] as e (e.inicioMs + e.tipo)}
		<div class="flex gap-3 py-0.5" data-testid="lv-history-row">
			<span class="w-40 shrink-0 opacity-60">{new Date(e.inicioMs).toLocaleString()}</span>
			<span class="w-40 shrink-0 truncate">{e.tipo}{e.perfil ? ` (${e.perfil})` : ''}</span>
			<span class="w-16 shrink-0 text-right">{(e.ms / 1000).toFixed(1)} s</span>
			<span class="min-w-0 {e.ok ? 'opacity-70' : 'text-error-500'}">{e.cancelado ? m.lv_diag_cancelled() : e.ok ? jobReason(e.motivo) : m.lv_diag_failed()}{e.pistas?.length ? ` · ${e.pistas.join(' · ')}` : ''}</span>
		</div>
	{/each}
</div>
