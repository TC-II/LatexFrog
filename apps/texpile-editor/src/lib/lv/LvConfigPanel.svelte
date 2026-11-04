<script lang="ts">
	// Edits a copy of latexfrog.json: everything comes from the engine (detect, validate, probe) and only Save writes.
	// In a plain folder this is how it becomes an engine project; giving up leaves it a terminal project.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';
	import { compactDiff, lineDiff } from './lineDiff';

	type Candidate = { archivo: string; recomendada: boolean; motivo: string };
	type Proposal = { raiz: string; candidatas: Candidate[]; avisos: string[]; texto: string };
	type Validation = { ok: boolean; errores: string[]; normalizado: string | null; ejemploNombre: string | null };
	type Probe = { doctor: { hallazgos: { id: string; nivel: string; titulo: string }[] }; listado: { figuras: number; ms: number; omitido: string | null } };

	let { onClose }: { onClose: () => void } = $props();

	let proposal = $state<Proposal | null>(null);
	let onDisk = $state<string | null>(null);
	let text = $state('');
	let validation = $state<Validation | null>(null);
	let probe = $state<Probe | null>(null);
	let busy = $state(true);
	let error = $state('');
	let validateRun = 0;
	let saved = false;

	// detection leaves profiles to the user but saving needs one: a plain folder must work with one click
	function withDefaultProfile(proposed: string): string {
		const config = JSON.parse(proposed);
		if (Object.keys(config.profiles ?? {}).length > 0) return proposed;
		return JSON.stringify({ ...config, profiles: { full: { label: m.lv_config_default_profile() } } }, null, 2) + '\n';
	}

	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

	async function guarded(work: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await work();
		} catch (e) {
			error = message(e);
		}
		busy = false;
	}

	async function validate() {
		const run = ++validateRun;
		const v = await lvProject.request<Validation>('config-validate', { text });
		if (run === validateRun) validation = v;
	}

	function edit(next: string) {
		text = next;
		probe = null;
		void validate().catch((e) => (error = message(e)));
	}

	const detect = (root?: string) =>
		guarded(async () => {
			proposal = await lvProject.request<Proposal>('detect', root ? { root } : {});
			edit(withDefaultProfile(proposal.texto));
		});

	const tryIt = () =>
		guarded(async () => {
			probe = await lvProject.request<Probe>('config-probe', { text });
		});

	const save = () =>
		guarded(async () => {
			if (!validation?.normalizado) return;
			await lvProject.request('config-write', { text: validation.normalizado });
			saved = true;
			await lvProject.resync();
			onClose();
		});

	async function close() {
		// a plain folder held open only for this dialog goes back to the terminal path
		if (!saved && !lvProject.active) await lvProject.resync();
		onClose();
	}

	onMount(() => {
		void guarded(async () => {
			await lvProject.openForSetup();
			onDisk = await lvProject.request<string | null>('config-read');
			proposal = await lvProject.request<Proposal>('detect');
			edit(onDisk ?? withDefaultProfile(proposal.texto));
		});
	});

	const rows = $derived(validation?.normalizado ? compactDiff(lineDiff(onDisk, validation.normalizado)) : []);
	const changed = $derived(rows.some((r) => r.kind === 'add' || r.kind === 'remove'));
</script>

<div class="fixed inset-0 z-1400 flex items-center justify-center bg-black/40 p-4" role="presentation">
	<div class="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-lg bg-surface-50-950 p-4 text-sm shadow-xl" role="dialog" aria-modal="true" aria-label={m.lv_config_title()} data-testid="lv-config" aria-busy={busy}>
		<h2 class="text-base font-semibold">{m.lv_config_title()}</h2>
		{#if proposal}
			<label class="flex items-center gap-2">
				<span class="opacity-70">{m.lv_config_root()}</span>
				<select class="min-w-0 flex-1 rounded border border-surface-300-700 bg-transparent px-1 py-0.5" value={proposal.raiz} disabled={busy} onchange={(e) => void detect(e.currentTarget.value)}>
					{#each proposal.candidatas as c (c.archivo)}
						<option value={c.archivo} title={c.motivo}>{c.archivo}</option>
					{/each}
				</select>
				<button class="rounded px-2 py-1 hover:bg-surface-200-800" title={m.lv_config_detect_hint()} disabled={busy} onclick={() => detect()}>{m.lv_config_detect()}</button>
			</label>
			{#each proposal.avisos as warning (warning)}
				<p class="text-warning-500">{warning}</p>
			{/each}
		{/if}
		<label class="flex flex-col gap-1">
			<span class="opacity-70">{m.lv_config_json()}</span>
			<textarea class="h-56 resize-y rounded border border-surface-300-700 bg-transparent p-2 font-mono text-xs" spellcheck="false" data-testid="lv-config-text" value={text} oninput={(e) => edit(e.currentTarget.value)}></textarea>
		</label>
		{#if validation?.ok}
			<p class="text-success-500" data-testid="lv-config-valid">{m.lv_config_valid()}{validation.ejemploNombre ? `. ${m.lv_config_example({ name: validation.ejemploNombre })}` : ''}</p>
		{/if}
		{#each validation?.errores ?? [] as problem (problem)}
			<p class="text-error-500" data-testid="lv-config-error">{problem}</p>
		{/each}
		{#if validation?.ok}
			<div>
				<p class="opacity-70">{onDisk === null ? m.lv_config_new_file() : changed ? m.lv_config_diff() : m.lv_config_no_changes()}</p>
				{#if onDisk !== null && changed}
					<pre class="mt-1 max-h-40 overflow-auto rounded border border-surface-300-700 p-2 text-xs" data-testid="lv-config-diff">{#each rows as r}{#if r.kind === 'skip'}<div class="opacity-50">{m.lv_config_skipped_lines({ count: r.count })}</div>{:else}<div class={r.kind === 'add' ? 'text-success-500' : r.kind === 'remove' ? 'text-error-500' : 'opacity-70'}>{r.kind === 'add' ? '+ ' : r.kind === 'remove' ? '- ' : '  '}{r.text}</div>{/if}{/each}</pre>
				{/if}
			</div>
		{/if}
		{#if probe}
			<div data-testid="lv-config-probe">
				<p class="opacity-70">{probe.listado.omitido ?? m.lv_config_probe_result({ figures: probe.listado.figuras, ms: probe.listado.ms })}</p>
				{#each probe.doctor.hallazgos.filter((f) => f.nivel === 'error' || f.nivel === 'aviso') as f (f.id)}
					<p class={f.nivel === 'error' ? 'text-error-500' : 'text-warning-500'}>{f.titulo}</p>
				{/each}
			</div>
		{/if}
		{#if error}
			<p class="text-error-500" data-testid="lv-config-failure">{error}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<button class="rounded px-2 py-1 hover:bg-surface-200-800" disabled={busy || !validation?.ok} onclick={tryIt}>{m.lv_config_probe()}</button>
			<button class="rounded px-2 py-1 hover:bg-surface-200-800" onclick={close}>{m.lv_close()}</button>
			<button class="rounded bg-primary-500 px-3 py-1 text-white" data-testid="lv-config-save" disabled={busy || !validation?.ok} onclick={save}>{m.lv_config_save()}</button>
		</div>
	</div>
</div>
