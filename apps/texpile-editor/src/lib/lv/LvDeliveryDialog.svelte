<script lang="ts">
	// Delivery of an engine project: exporting parts and publishing. The figure cache lives in the Figures tab of the bottom dock.
	import { onDestroy } from 'svelte';
	import { lvProject } from '$lib/lv/lvEngine.svelte';
	import { revealItem } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	type EngineEvent = { type: string; done?: number; total?: number; name?: string; part?: string; num?: string | number | null; file?: string; ok?: boolean; cooked?: number; failed?: number; exported?: number; error?: string | null };

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let exporting = $state<string | null>(null);
	let exported = $state<{ num: string; file: string; ok: boolean }[]>([]);
	let notice = $state('');
	let error = $state('');
	let unticked = $state<string[]>([]);

	const parts = $derived(lvProject.view?.parts ?? []);
	const chosen = $derived(parts.map((p) => p.name).filter((n) => !unticked.includes(n)));
	const profile = $derived(lvProject.view?.state.activeProfile ?? null);
	const running = $derived(exporting !== null);
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
		if (ev.type === 'export-progress') {
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
