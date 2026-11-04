<script lang="ts">
	// Figures and delivery of an engine project. Nothing is deleted without the preview: Clean asks the engine what it would
	// remove, shows it, and only the second button removes it.
	import { onDestroy } from 'svelte';
	import { lvProject } from '$lib/lv/lvEngine.svelte';
	import { revealItem } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	type Status = { dir: string; actuales: number; viejas: number; bytes: number; pendientes: number; fallidas: number; necesitaCocer: boolean; errores: { nombre?: string }[] };
	type Cleanup = { archivos: string[]; bytes: number; figuras: number };
	type EngineEvent = { type: string; done?: number; total?: number; name?: string; part?: string; num?: string | number | null; file?: string; ok?: boolean; cooked?: number; failed?: number; exported?: number; error?: string | null };

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let status = $state<Status | null>(null);
	let cleanup = $state<Cleanup | null>(null);
	let baking = $state<string | null>(null);
	let exporting = $state<string | null>(null);
	let exported = $state<{ num: string; file: string; ok: boolean }[]>([]);
	let notice = $state('');
	let error = $state('');
	let unticked = $state<string[]>([]);

	const parts = $derived(lvProject.view?.parts ?? []);
	const chosen = $derived(parts.map((p) => p.name).filter((n) => !unticked.includes(n)));
	const profile = $derived(lvProject.view?.state.activeProfile ?? null);
	const running = $derived(baking !== null || exporting !== null);
	const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
	const short = (name: string) => name.replace(/^.*\//, '');

	async function attempt(action: () => Promise<unknown>) {
		error = '';
		notice = '';
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const loadStatus = async () => {
		status = await lvProject.request<Status>('figures-status');
	};

	$effect(() => {
		if (open) void attempt(loadStatus);
	});

	const bake = () =>
		attempt(async () => {
			cleanup = null;
			baking = m.lv_figures_listing();
			await lvProject.request('figures-bake');
		}).then(() => {
			if (error) baking = null;
		});

	const previewClean = () =>
		attempt(async () => {
			cleanup = await lvProject.request<Cleanup>('figures-clean-preview');
		});

	const confirmClean = () =>
		attempt(async () => {
			const done = await lvProject.request<Cleanup>('figures-clean');
			cleanup = null;
			await loadStatus();
			notice = m.lv_figures_cleaned({ count: done.figuras, mb: mb(done.bytes) });
		});

	const runExport = () =>
		attempt(async () => {
			exported = [];
			exporting = m.lv_export_running();
			// `parts` absent means all of them, which also covers parts added after this dialog opened
			await lvProject.request('export', unticked.length ? { parts: chosen } : {});
		}).then(() => {
			if (error) exporting = null;
		});

	const publish = () =>
		attempt(async () => {
			if (!profile) return;
			const r = await lvProject.request<{ pdf: string }>('publish', { profile });
			notice = m.lv_published({ file: r.pdf });
		});

	const reveal = (which: 'publish' | 'export') =>
		attempt(async () => revealItem(await lvProject.request<string>('output-dir', { which })));

	const unsubscribe = lvProject.subscribe((event) => {
		const ev = event as EngineEvent;
		if (ev.type === 'bake-started') baking = m.lv_figures_progress({ done: 0, total: ev.total ?? 0 });
		else if (ev.type === 'bake-progress') baking = m.lv_figures_progress({ done: ev.done ?? 0, total: ev.total ?? 0 });
		else if (ev.type === 'bake-finished') {
			baking = null;
			// after the reload: `attempt` clears the notice when it starts
			void attempt(loadStatus).then(() => (notice = ev.error ?? m.lv_figures_baked({ cooked: ev.cooked ?? 0, failed: ev.failed ?? 0 })));
		} else if (ev.type === 'export-progress') {
			exporting = m.lv_figures_progress({ done: ev.done ?? 0, total: ev.total ?? 0 });
			exported.push({ num: String(ev.num ?? ''), file: ev.file ?? ev.part ?? '', ok: ev.ok !== false });
		} else if (ev.type === 'export-finished') {
			exporting = null;
			notice = ev.error ?? m.lv_export_done({ exported: ev.exported ?? 0, failed: ev.failed ?? 0 });
		}
	});
	onDestroy(unsubscribe);

	const BUTTON = 'rounded border border-surface-300-700 px-2 py-1 text-sm disabled:opacity-50';
</script>

{#if open}
	<div class="fixed inset-0 z-1400 flex items-center justify-center bg-black/40" role="presentation">
		<div class="flex max-h-[80vh] w-120 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-lg bg-surface-50-950 p-4 text-sm shadow-xl" role="dialog" aria-modal="true" aria-label={m.lv_delivery_title()}>
			<header class="flex items-center justify-between">
				<h2 class="text-base font-semibold">{m.lv_delivery_title()}</h2>
				<button class={BUTTON} onclick={() => (open = false)}>{m.lv_close()}</button>
			</header>

			<section class="flex flex-col gap-2" aria-label={m.lv_figures_title()}>
				<h3 class="font-medium">{m.lv_figures_title()}</h3>
				{#if status}
					<p data-testid="lv-figures-status">
						{m.lv_figures_status({ current: status.actuales, old: status.viejas, mb: mb(status.bytes) })}
						{#if status.pendientes}{m.lv_figures_pending({ count: status.pendientes })}{/if}
						{#if status.fallidas}{m.lv_figures_failed({ count: status.fallidas })}{/if}
					</p>
				{/if}
				{#if baking}<p data-testid="lv-figures-progress">{baking}</p>{/if}
				<div class="flex gap-2">
					<button class={BUTTON} disabled={running} onclick={bake}>{m.lv_figures_bake()}</button>
					<button class={BUTTON} disabled={running} onclick={previewClean}>{m.lv_figures_clean()}</button>
					{#if running}<button class={BUTTON} onclick={() => attempt(() => lvProject.cancel())}>{m.lv_cancel()}</button>{/if}
				</div>
				{#if cleanup}
					<div class="flex flex-col gap-1 rounded border border-surface-300-700 p-2" data-testid="lv-clean-preview">
						{#if cleanup.archivos.length === 0}
							<p>{m.lv_figures_clean_nothing()}</p>
						{:else}
							<p>{m.lv_figures_clean_preview({ count: cleanup.figuras, files: cleanup.archivos.length, mb: mb(cleanup.bytes) })}</p>
							<ul class="max-h-32 overflow-y-auto font-mono text-xs">
								{#each cleanup.archivos as f (f)}<li>{f}</li>{/each}
							</ul>
							<button class={BUTTON} onclick={confirmClean}>{m.lv_figures_clean_confirm()}</button>
						{/if}
					</div>
				{/if}
			</section>

			<section class="flex flex-col gap-2" aria-label={m.lv_export_title()}>
				<h3 class="font-medium">{m.lv_export_title()}</h3>
				<div class="max-h-40 overflow-y-auto">
					{#each parts as part (part.name)}
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								checked={!unticked.includes(part.name)}
								onchange={(e) => (unticked = e.currentTarget.checked ? unticked.filter((n) => n !== part.name) : [...unticked, part.name])}
							/>
							<span>{short(part.name)}</span>
						</label>
					{/each}
				</div>
				{#if exporting}<p>{exporting}</p>{/if}
				{#if exported.length}
					<ul class="text-xs" data-testid="lv-export-results">
						{#each exported as r, i (i)}<li class={r.ok ? '' : 'text-error-500'}>{r.num} {r.file}</li>{/each}
					</ul>
				{/if}
				<div class="flex flex-wrap gap-2">
					<button class={BUTTON} disabled={running || chosen.length === 0} onclick={runExport}>{m.lv_export_run()}</button>
					<button class={BUTTON} onclick={() => reveal('export')}>{m.lv_open_folder()}</button>
				</div>
			</section>

			<section class="flex flex-col gap-2" aria-label={m.lv_publish_title()}>
				<h3 class="font-medium">{m.lv_publish_title()}</h3>
				<div class="flex flex-wrap gap-2">
					<button class={BUTTON} disabled={running || !profile} onclick={publish}>{m.lv_publish_run({ profile: profile ?? '' })}</button>
					<button class={BUTTON} onclick={() => reveal('publish')}>{m.lv_open_folder()}</button>
				</div>
			</section>

			{#if notice}<p data-testid="lv-notice">{notice}</p>{/if}
			{#if error}<p class="text-error-500" data-testid="lv-error">{error}</p>{/if}
		</div>
	</div>
{/if}
