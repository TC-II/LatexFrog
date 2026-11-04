<script lang="ts">
	// History of the job queue, the doctor's report and the TeX processes an earlier run left in this project.
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';
	import type { DiagnosticsTab } from './lvPanels';

	type Entry = { inicioMs: number; tipo: string; perfil?: string | null; motivo: string; ms: number; ok: boolean; cancelado?: boolean };
	type Finding = { id: string; nivel: 'ok' | 'info' | 'aviso' | 'error'; titulo: string; detalle: string; arreglo: string | null; archivo: string | null; linea: number | null };
	type Report = { hallazgos: Finding[]; ms: number; distribucion: string | null };
	type TexProcess = { pid: number; nombre: string; cwd: string; linea: string };

	let { tab: initial, onClose }: { tab: DiagnosticsTab; onClose: () => void } = $props();

	let tab = $state<DiagnosticsTab>(initial);
	let history = $state<Entry[] | null>(null);
	let report = $state<Report | null>(null);
	let orphans = $state<TexProcess[] | null>(null);
	let busy = $state(false);
	let error = $state('');

	async function load(what: DiagnosticsTab) {
		busy = true;
		error = '';
		try {
			if (what === 'history') history = await lvProject.request<Entry[]>('history', { limit: 100 });
			else if (what === 'doctor') report = await lvProject.request<Report>('doctor');
			else orphans = await lvProject.request<TexProcess[]>('orphans');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		busy = false;
	}

	async function killOrphans() {
		if (!orphans) return;
		busy = true;
		try {
			await lvProject.request('kill-orphans', { pids: orphans.map((p) => p.pid) });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		busy = false;
		await load('orphans');
	}

	$effect(() => {
		void load(tab);
	});

	const TABS: [DiagnosticsTab, () => string][] = [
		['history', m.lv_diag_history],
		['doctor', m.lv_diag_doctor],
		['orphans', m.lv_diag_orphans]
	];
	const LEVEL = { ok: 'text-success-500', info: 'opacity-70', aviso: 'text-warning-500', error: 'text-error-500' };
</script>

<div class="fixed inset-0 z-1400 flex items-center justify-center bg-black/40 p-4" role="presentation">
	<div class="flex max-h-[80vh] w-full max-w-3xl flex-col gap-3 rounded-lg bg-surface-50-950 p-4 text-sm shadow-xl" role="dialog" aria-modal="true" aria-label={m.lv_diag_title()} data-testid="lv-diagnostics">
		<div class="flex items-center gap-2">
			<h2 class="mr-auto text-base font-semibold">{m.lv_diag_title()}</h2>
			<button class="rounded px-2 py-1 hover:bg-surface-200-800" onclick={onClose}>{m.lv_close()}</button>
		</div>
		<div class="flex gap-1" role="tablist">
			{#each TABS as [id, label] (id)}
				<button role="tab" aria-selected={tab === id} class="rounded px-2 py-1 {tab === id ? 'bg-surface-200-800' : 'opacity-70'}" onclick={() => (tab = id)}>{label()}</button>
			{/each}
		</div>
		{#if error}
			<p class="text-error-500">{error}</p>
		{/if}
		<div class="min-h-40 overflow-y-auto" aria-busy={busy}>
			{#if tab === 'history'}
				{#if history?.length === 0}
					<p class="opacity-60">{m.lv_diag_no_history()}</p>
				{/if}
				{#each history ?? [] as e (e.inicioMs + e.tipo)}
					<div class="flex gap-3 py-0.5" data-testid="lv-history-row">
						<span class="w-40 shrink-0 opacity-60">{new Date(e.inicioMs).toLocaleString()}</span>
						<span class="w-32 shrink-0">{e.tipo}{e.perfil ? ` (${e.perfil})` : ''}</span>
						<span class="w-16 shrink-0 text-right">{(e.ms / 1000).toFixed(1)} s</span>
						<span class={e.ok ? 'opacity-70' : 'text-error-500'}>{e.cancelado ? m.lv_diag_cancelled() : e.ok ? e.motivo : m.lv_diag_failed()}</span>
					</div>
				{/each}
			{:else if tab === 'doctor'}
				{#if report}
					{#if report.distribucion}
						<p class="mb-2 opacity-70">{report.distribucion}</p>
					{/if}
					{#each report.hallazgos as f (f.id)}
						<div class="py-1" data-testid="lv-doctor-row">
							<div class={LEVEL[f.nivel]}>{f.titulo}{f.archivo ? ` (${f.archivo}${f.linea ? `:${f.linea}` : ''})` : ''}</div>
							<div class="opacity-70">{f.detalle}</div>
							{#if f.arreglo}
								<div class="opacity-70">{f.arreglo}</div>
							{/if}
						</div>
					{/each}
				{:else}
					<p class="opacity-60">{m.lv_loading()}</p>
				{/if}
				<button class="mt-2 rounded px-2 py-1 hover:bg-surface-200-800" disabled={busy} onclick={() => load('doctor')}>{m.lv_diag_run_doctor()}</button>
			{:else}
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
					<button class="mt-2 rounded bg-error-500 px-2 py-1 text-white" disabled={busy} onclick={killOrphans}>{m.lv_diag_kill()}</button>
				{/if}
			{/if}
		</div>
	</div>
</div>
