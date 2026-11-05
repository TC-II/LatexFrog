<script lang="ts">
	// The project's figures under the document's headings, the way Contents shows them; figures above every heading and compiled figures
	// the code no longer has come last. A color says whether a figure's PDF is its code's only after a check of the code as it is now:
	// Check figures compares without compiling, Compile changed compiles what changed. Nothing is deleted without the preview: Clean asks
	// the engine what it would remove, shows it, and only the second button removes it.
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';
	import { cleanBlock, figureTree, megabytes, needsCompile, type Figure, type FigureNode, type FiguresStatus, type Heading } from './lvFigures';

	type Cleanup = { archivos: string[]; bytes: number; figuras: number };
	type BakeEvent = { type: string; done?: number; total?: number; error?: string; cooked?: number; failed?: number; remaining?: number };
	type Shown = 'ok' | 'changed' | 'failed' | 'unknown';

	const ICON: Record<Shown, string> = { ok: '●', changed: '●', failed: '✘', unknown: '◌' };
	const COLOR: Record<Shown, string> = { ok: 'text-success-500', changed: 'text-warning-500', failed: 'text-error-500', unknown: 'opacity-50' };
	const BUTTON = 'hover:preset-tonal rounded border border-surface-300-700 px-2 py-0.5 disabled:opacity-50';

	let status = $state<FiguresStatus | null>(null);
	let headings = $state<Heading[]>([]);
	let cleanup = $state<Cleanup | null>(null);
	let baking = $state<string | null>(null);
	let checking = $state(false);
	let notice = $state('');
	let error = $state('');
	let cancelling = $state(false);

	const tree = $derived(figureTree(headings, status?.figuras ?? []));
	const checked = $derived(status?.revisado ?? false);
	const toCompile = $derived((status?.figuras ?? []).filter(needsCompile).length);
	const block = $derived(cleanBlock(status?.figlist ?? null));
	const blockText = $derived.by(() => {
		if (block === 'partial') return m.lv_figures_block_partial();
		if (block === 'stamp') return m.lv_figures_block_stamp();
		if (block === 'other-root') return m.lv_figures_block_root();
		return block === 'no-list' ? m.lv_figures_block_list() : '';
	});

	/** before a check of today's code only the facts show: a failed figure; whether a PDF is its code's is not known */
	function shown(f: Figure): Shown {
		if (f.estado === 'fallo') return 'failed';
		if (f.estado === 'falta') return 'changed';
		if (!checked || f.estado === 'sinrevisar') return 'unknown';
		return f.estado === 'pendiente' ? 'changed' : 'ok';
	}

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
		const [st, sym] = await Promise.all([lvProject.request<FiguresStatus>('figures-status'), lvProject.symbols().catch(() => null)]);
		status = st;
		if (sym) headings = sym.sections;
	};

	// again after each build and bake: a build's background listing is what finds an edited figure
	$effect(() => {
		void lvProject.revision;
		void lvProject.figureRevision;
		void attempt(load);
	});

	const start = (cmd: 'figures-check' | 'figures-bake') =>
		attempt(async () => {
			cleanup = null;
			checking = cmd === 'figures-check';
			baking = checking ? m.lv_figures_checking() : m.lv_figures_listing();
			await lvProject.request(cmd);
		}).then(() => {
			if (error) {
				baking = null;
				checking = false;
			}
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

	const openCode = (f: Figure) => {
		if (f.codigo) (lvProject.onShowSource ?? lvProject.onOpenAt)?.(f.codigo, f.linea ?? 1);
	};

	const unsubscribe = lvProject.subscribe((event) => {
		const ev = event as BakeEvent;
		if (ev.type === 'bake-started' && !checking) baking = m.lv_figures_progress({ done: 0, total: ev.total ?? 0 });
		else if (ev.type === 'bake-progress' && !checking) baking = m.lv_figures_progress({ done: ev.done ?? 0, total: ev.total ?? 0 });
		else if (ev.type === 'bake-finished') {
			const wasCheck = checking;
			baking = null;
			checking = false;
			cancelling = false;
			const text = ev.error ?? (wasCheck ? (ev.remaining ? m.lv_figures_check_found({ count: ev.remaining }) : m.lv_figures_check_none()) : m.lv_figures_baked({ cooked: ev.cooked ?? 0, failed: ev.failed ?? 0 }));
			// after the reload: `attempt` clears the notice when it starts
			void attempt(load).then(() => (notice = text));
		}
	});
	onDestroy(unsubscribe);
</script>

{#snippet row(f: Figure)}
	{@const state = shown(f)}
	<button
		type="button"
		class="hover:preset-tonal flex w-full items-center gap-1.5 rounded px-1 text-left text-xs disabled:cursor-default"
		title="{f.nombre.split('/').pop()}{f.codigo ? ` · ${f.codigo}:${f.linea}` : ''}"
		disabled={!f.codigo}
		data-testid="lv-figure-row"
		data-state={state}
		onclick={() => openCode(f)}
	>
		<span class="shrink-0 {COLOR[state]}">{ICON[state]}</span>
		<span class="truncate">{f.caption || f.nombre.split('/').pop()}</span>
	</button>
{/snippet}

{#snippet counts(total: number, changed: number, failed: number)}
	<span class="shrink-0 text-xs opacity-70">{total}</span>
	{#if checked && changed}<span class="text-warning-500 shrink-0 text-xs">{changed} ●</span>{/if}
	{#if failed}<span class="text-error-500 shrink-0 text-xs">{failed} ✘</span>{/if}
{/snippet}

{#snippet node(n: FigureNode, depth: number)}
	<details class="group" open={depth > 0} data-testid="lv-figure-group">
		<summary class="flex cursor-pointer items-center gap-1.5 rounded py-0.5 pr-1 {n.heading.level <= 1 ? 'font-semibold' : ''}" title="{n.heading.file}:{n.heading.line}">
			<span class="shrink-0 text-xs opacity-60 transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
			<span class="min-w-0 flex-1 truncate">{n.heading.title}</span>
			{@render counts(n.total, n.changed, n.failed)}
		</summary>
		<div class="pl-3">
			{#each n.figures as f (f.nombre)}{@render row(f)}{/each}
			{#each n.children as c (c.key)}{@render node(c, depth + 1)}{/each}
		</div>
	</details>
{/snippet}

<div class="h-full overflow-y-auto p-2 text-sm" data-testid="lv-figures">
	{#if status === null}
		{#if error}<p class="text-error-500">{error}</p>{:else}<p class="opacity-60">{m.lv_figures_reading()}</p>{/if}
	{:else if status.modo === 'off'}
		<p class="opacity-70" data-testid="lv-figures-off">{m.lv_figures_off()}</p>
	{:else}
		<div class="mb-2 flex flex-wrap items-center gap-2">
			<button class={BUTTON} disabled={baking !== null} title={m.lv_figures_check_title()} data-testid="lv-figures-check" onclick={() => start('figures-check')}>{m.lv_figures_check()}</button>
			<button class={BUTTON} disabled={baking !== null} title={m.lv_figures_bake_title()} data-testid="lv-figures-bake" onclick={() => start('figures-bake')}
				>{m.lv_figures_bake()}{#if checked && toCompile}{' '}({toCompile}){/if}</button
			>
			{#if baking !== null}<button class={BUTTON} disabled={cancelling} onclick={cancel}>{m.lv_cancel()}</button>{/if}
			<button class={BUTTON} disabled={baking !== null || block !== null} title={blockText || m.lv_figures_clean_title()} data-testid="lv-figures-clean" onclick={previewClean}>{m.lv_figures_clean()}</button>
			{#if baking !== null}<span data-testid="lv-figures-progress">{baking}</span>{/if}
		</div>

		{#if !checked && baking === null}
			<p class="text-warning-500 mb-1 text-xs" data-testid="lv-figures-unchecked">{m.lv_figures_unchecked()}</p>
		{/if}
		{#if notice}<p class="mb-1" data-testid="lv-figures-notice">{notice}</p>{/if}
		{#if error}<p class="text-error-500 mb-1">{error}</p>{/if}

		<p class="flex flex-wrap gap-x-3 text-xs opacity-80" data-testid="lv-figures-legend">
			<span><span class={COLOR.ok}>{ICON.ok}</span> {m.lv_figures_legend_ok()}</span>
			<span><span class={COLOR.changed}>{ICON.changed}</span> {m.lv_figures_legend_changed()}</span>
			<span><span class={COLOR.failed}>{ICON.failed}</span> {m.lv_figures_legend_failed()}</span>
			<span><span class={COLOR.unknown}>{ICON.unknown}</span> {m.lv_figures_legend_unknown()}</span>
		</p>
		<p class="mt-1 text-xs opacity-60" data-testid="lv-figures-status">
			{m.lv_figures_status({ current: status.actuales, old: status.viejas, mb: megabytes(status.bytes) })}
			{m.lv_figures_where({ dir: status.dir, stamp: status.sello ?? '?' })}
			{#if status.viejas}{m.lv_figures_old_size({ mb: megabytes(status.bytesViejos) })}{/if}
			{#if blockText}{blockText}{/if}
		</p>

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

		<div class="mt-2 flex flex-col gap-0.5" data-testid="lv-figure-tree">
			{#if tree.beforeHeadings.length}
				<details class="group" open data-testid="lv-figure-group">
					<summary class="flex cursor-pointer items-center gap-1.5 py-0.5 pr-1 italic">
						<span class="shrink-0 text-xs opacity-60 transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
						<span class="min-w-0 flex-1 truncate">{m.lv_figures_before_headings()}</span>
						{@render counts(tree.beforeHeadings.length, tree.beforeHeadings.filter((f) => shown(f) === 'changed').length, tree.beforeHeadings.filter((f) => f.estado === 'fallo').length)}
					</summary>
					<div class="pl-3">{#each tree.beforeHeadings as f (f.nombre)}{@render row(f)}{/each}</div>
				</details>
			{/if}
			{#each tree.nodes as n (n.key)}{@render node(n, 0)}{/each}
			{#if tree.notInCode.length}
				<details class="group" data-testid="lv-figure-group">
					<summary class="flex cursor-pointer items-center gap-1.5 py-0.5 pr-1 italic" title={m.lv_figures_not_in_code_title()}>
						<span class="shrink-0 text-xs opacity-60 transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
						<span class="min-w-0 flex-1 truncate">{m.lv_figures_not_in_code()}</span>
						<span class="shrink-0 text-xs opacity-70">{tree.notInCode.length}</span>
					</summary>
					<div class="pl-3">{#each tree.notInCode as f (f.nombre)}{@render row(f)}{/each}</div>
				</details>
			{/if}
		</div>
	{/if}
</div>
