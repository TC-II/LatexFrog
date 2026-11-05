<script lang="ts">
	// The project's figure cache, in the sidebar's Project outline: each figure by file, what failed and why. Nothing is deleted without the preview:
	// Clean asks the engine what it would remove, shows it, and only the second button removes it.
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';
	import { cleanBlock, groupFigures, megabytes, type FigureState, type FiguresStatus } from './lvFigures';

	type Cleanup = { archivos: string[]; bytes: number; figuras: number };
	type BakeEvent = { type: string; done?: number; total?: number; error?: string; cooked?: number; failed?: number };

	const ICON: Record<FigureState, string> = { aldia: '●', pendiente: '○', falta: '○', fallo: '✘' };
	const BUTTON = 'hover:preset-tonal rounded border border-surface-300-700 px-2 py-0.5 disabled:opacity-50';

	let status = $state<FiguresStatus | null>(null);
	let cleanup = $state<Cleanup | null>(null);
	let baking = $state<string | null>(null);
	let notice = $state('');
	let error = $state('');
	let cancelling = $state(false);

	const groups = $derived(groupFigures(status?.figuras ?? []));
	const block = $derived(cleanBlock(status?.figlist ?? null));
	const blockText = $derived.by(() => {
		if (block === 'partial') return m.lv_figures_block_partial();
		if (block === 'stamp') return m.lv_figures_block_stamp();
		if (block === 'other-root') return m.lv_figures_block_root();
		return block === 'no-list' ? m.lv_figures_block_list() : '';
	});

	async function attempt(action: () => Promise<unknown>) {
		error = '';
		notice = '';
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const load = async () => {
		status = await lvProject.request<FiguresStatus>('figures-status');
	};

	$effect(() => {
		void attempt(load);
	});

	const bake = () =>
		attempt(async () => {
			cleanup = null;
			baking = m.lv_figures_listing();
			await lvProject.request('figures-bake');
		}).then(() => {
			if (error) baking = null;
		});

	const cancel = () =>
		attempt(async () => {
			cancelling = true;
			await lvProject.cancel();
		});

	const previewClean = () =>
		attempt(async () => {
			cleanup = await lvProject.request<Cleanup>('figures-clean-preview');
		});

	const confirmClean = () =>
		attempt(async () => {
			const done = await lvProject.request<Cleanup>('figures-clean');
			cleanup = null;
			await load();
			notice = m.lv_figures_cleaned({ count: done.figuras, mb: megabytes(done.bytes) });
		});

	const unsubscribe = lvProject.subscribe((event) => {
		const ev = event as BakeEvent;
		if (ev.type === 'bake-started') baking = m.lv_figures_progress({ done: 0, total: ev.total ?? 0 });
		else if (ev.type === 'bake-progress') baking = m.lv_figures_progress({ done: ev.done ?? 0, total: ev.total ?? 0 });
		else if (ev.type === 'bake-finished') {
			baking = null;
			cancelling = false;
			// after the reload: `attempt` clears the notice when it starts
			void attempt(load).then(() => (notice = ev.error ?? m.lv_figures_baked({ cooked: ev.cooked ?? 0, failed: ev.failed ?? 0 })));
		}
	});
	onDestroy(unsubscribe);
</script>

<div class="h-full overflow-y-auto p-2 text-sm" data-testid="lv-figures">
	{#if status === null}
		{#if error}<p class="text-error-500">{error}</p>{:else}<p class="opacity-60">{m.lv_figures_reading()}</p>{/if}
	{:else if status.modo === 'off'}
		<p class="opacity-70" data-testid="lv-figures-off">{m.lv_figures_off()}</p>
	{:else}
		<div class="mb-2 flex flex-wrap items-center gap-2">
			<button class={BUTTON} disabled={baking !== null} data-testid="lv-figures-bake" onclick={bake}>{m.lv_figures_bake()}</button>
			{#if baking !== null}<button class={BUTTON} disabled={cancelling} onclick={cancel}>{m.lv_cancel()}</button>{/if}
			<button class={BUTTON} disabled={baking !== null || block !== null} title={blockText} data-testid="lv-figures-clean" onclick={previewClean}>{m.lv_figures_clean()}</button>
			{#if baking !== null}<span data-testid="lv-figures-progress">{baking}</span>{/if}
		</div>

		<p data-testid="lv-figures-status">
			{m.lv_figures_status({ current: status.actuales, old: status.viejas, mb: megabytes(status.bytes) })}
			{#if status.pendientes}{m.lv_figures_pending({ count: status.pendientes })}{/if}
			{#if status.fallidas}{m.lv_figures_failed({ count: status.fallidas })}{/if}
			{#if status.necesitaCocer}<span class="text-warning-500">{m.lv_figures_needs_bake()}</span>{/if}
		</p>
		<p class="text-xs opacity-60">
			{m.lv_figures_where({ dir: status.dir, stamp: status.sello ?? '?' })}
			{#if status.viejas}{m.lv_figures_old_size({ mb: megabytes(status.bytesViejos) })}{/if}
			{#if blockText}{blockText}{/if}
		</p>
		{#if notice}<p class="mt-1" data-testid="lv-figures-notice">{notice}</p>{/if}
		{#if error}<p class="text-error-500 mt-1">{error}</p>{/if}

		{#if cleanup}
			<div class="mt-2 flex flex-col gap-1 rounded border border-surface-300-700 p-2" data-testid="lv-clean-preview">
				{#if cleanup.archivos.length === 0}
					<p>{m.lv_figures_clean_nothing()}</p>
				{:else}
					<p>{m.lv_figures_clean_preview({ count: cleanup.figuras, files: cleanup.archivos.length, mb: megabytes(cleanup.bytes) })}</p>
					<ul class="max-h-32 overflow-y-auto font-mono text-xs">
						{#each cleanup.archivos as f (f)}<li>{f}</li>{/each}
					</ul>
					<div><button class={BUTTON} onclick={confirmClean}>{m.lv_figures_clean_confirm()}</button></div>
				{/if}
			</div>
		{/if}

		{#each status.errores as e (e.nombre)}
			<div class="mt-1 flex items-center gap-2 text-xs" data-testid="lv-figure-error">
				<span class="text-error-500 min-w-0 flex-1 truncate" title={e.mensaje}>{e.mensaje}</span>
				{#if e.file && e.line !== null}
					<button class="hover:preset-tonal rounded px-1" title={m.lv_figures_go_source()} onclick={() => lvProject.onOpenAt?.(e.file as string, e.line as number)}>{e.file.split('/').pop()}:{e.line}</button>
				{/if}
				<button class="hover:preset-tonal rounded px-1" title={m.lv_figures_open_log()} onclick={() => lvProject.onOpenAt?.(e.log, 1)}>log</button>
			</div>
		{/each}

		<div class="mt-2 flex flex-col gap-1">
			{#each groups as group (group.file ?? '')}
				<details data-testid="lv-figure-group">
					<summary class="flex cursor-pointer items-center gap-2">
						<span class="min-w-0 flex-1 truncate" title={group.file ?? m.lv_figures_no_file()}>{group.file ?? m.lv_figures_no_file()}</span>
						<span class="text-xs opacity-70">{group.done}/{group.figures.length}</span>
						{#if group.failed}<span class="text-error-500 text-xs">{group.failed} ✘</span>{/if}
						{#if group.file}
							<button
								type="button"
								class="hover:preset-tonal rounded px-1 text-xs"
								onclick={(e) => {
									e.preventDefault();
									lvProject.onOpenAt?.(group.file as string, 1);
								}}>{m.lv_figures_open_file()}</button
							>
						{/if}
					</summary>
					<div class="pl-3">
						{#each group.figures as f (f.nombre)}
							<div class="flex items-center gap-2 text-xs" title="{f.nombre} · {(f.bytes / 1024).toFixed(0)} KB" data-testid="lv-figure-row">
								<span class={f.estado === 'fallo' ? 'text-error-500' : f.estado === 'aldia' ? 'text-success-500' : 'opacity-60'}>{ICON[f.estado]}</span>
								<span class="truncate">{f.nombre.split('/').pop()}</span>
							</div>
						{/each}
					</div>
				</details>
			{/each}
		</div>
	{/if}
</div>
