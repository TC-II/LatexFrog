<script lang="ts">
	// Edits a copy of latexfrog.json: everything comes from the engine (detect, validate, probe) and only Save writes.
	// In a plain folder this is how it becomes an engine project; giving up leaves it a terminal project.
	import { onMount, type Snippet } from 'svelte';
	import { X } from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';
	import { compactDiff, lineDiff } from './lineDiff';
	import LvFrog from './LvFrog.svelte';
	import LvProfileEditor from './LvProfileEditor.svelte';
	import {
		configText,
		emptyProfile,
		exportName,
		figuresOf,
		flagUse,
		MACRO_NAME,
		outputsOf,
		parseConfig,
		partCommands,
		profileId,
		removeVariable,
		setFigures,
		setFlag,
		setOutputs,
		setPartCommands,
		setProfile,
		setVariable,
		shortName,
		useDetected,
		type ConfigJson,
		type ConfigSection,
		type FlagUse,
		type Piece
	} from './lvProfiles';

	type Candidate = { archivo: string; rol: 'principal' | 'auxiliar' | 'otra'; recomendada: boolean; motivo: string };
	type DetectedFlag = { nombre: string; uso: FlagUse; frase: string };
	type DetectedVariable = { nombre: string; label: string; choices: string[]; default: string; defSinGuardia: unknown[]; frase: string };
	type Proposal = {
		raiz: string;
		candidatas: Candidate[];
		avisos: string[];
		texto: string;
		piezas: Piece[];
		partes: string[];
		partsCommands: string[];
		flags: DetectedFlag[];
		figuras: { motivo: string; avisos: string[] };
		salidas: { ejemploNombre: string | null };
		variables: DetectedVariable[];
	};
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
		const config = JSON.parse(proposed) as ConfigJson;
		if (Object.keys(config.profiles ?? {}).length > 0) return proposed;
		return configText(setProfile(config, 'full', { label: m.lv_config_default_profile() }));
	}

	// the form and the JSON are one text: what the form changes the JSON shows, and a JSON that does not parse leaves the form closed
	const config = $derived(parseConfig(text));
	const pieces = $derived(proposal?.piezas ?? lvProject.view?.piezas ?? []);
	const parts = $derived(proposal?.partes ?? lvProject.view?.parts.map((p) => p.name) ?? []);
	const change = (next: ConfigJson) => edit(configText(next));
	const list = (value: string) => value.split(',').map((x) => x.trim()).filter(Boolean);
	const detected = $derived(proposal ? parseConfig(proposal.texto) : null);
	const figures = $derived(config ? figuresOf(config) : null);
	const outputs = $derived(config ? outputsOf(config) : null);
	const usedFlags = $derived((proposal?.flags ?? []).filter((f) => f.uso !== 'ninguno'));
	const otherFlags = $derived((proposal?.flags ?? []).filter((f) => f.uso === 'ninguno'));
	const USES = $derived<[FlagUse, string][]>([
		['partial', m.lv_config_use_partial()],
		['externalize', m.lv_config_use_externalize()],
		['figureList', m.lv_config_use_figure_list()],
		['ninguno', m.lv_config_use_none()]
	]);
	const ROLES = $derived<Record<Candidate['rol'], string>>({ principal: m.lv_config_role_main(), auxiliar: m.lv_config_role_aux(), otra: m.lv_config_role_included() });
	const example = $derived(outputs && proposal?.partes[0] ? exportName(outputs.pattern, '1', shortName(proposal.partes[0])) : '');
	let otherFlagsOpen = $state(false);
	let newVariable = $state('');

	const INPUT = 'min-w-0 flex-1 rounded border border-surface-300-700 bg-transparent px-1 py-0.5';
	const LABEL = 'w-40 shrink-0 opacity-70';

	const update = (f: (c: ConfigJson) => ConfigJson) => {
		if (config) change(f(config));
	};
	const restore = (section: ConfigSection) => {
		if (detected) update((c) => useDetected(c, detected, section));
	};

	// with no file on disk everything comes from the detection and follows the root; with one, only the root changes
	const chooseRoot = (root: string) =>
		guarded(async () => {
			proposal = await lvProject.request<Proposal>('detect', { root });
			if (onDisk === null) edit(withDefaultProfile(proposal.texto));
			else update((c) => ({ ...c, root }));
		});

	function addVariable() {
		const name = newVariable;
		update((c) => setVariable(c, name, { label: name, choices: [] }));
		newVariable = '';
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

	// a project with no profile opens with an empty one to fill, not with a notice
	$effect(() => {
		if (!config || !proposal || Object.keys(config.profiles ?? {}).length > 0) return;
		const label = m.lv_profiles_new({ number: 1 });
		change(setProfile(config, profileId(label, []), emptyProfile(config, pieces, 1, label)));
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
	<div class="flex max-h-[85vh] w-full max-w-5xl flex-col gap-3 overflow-y-auto rounded-lg bg-surface-50-950 p-4 text-sm shadow-xl" role="dialog" aria-modal="true" aria-label={m.lv_config_title()} data-testid="lv-config" aria-busy={busy}>
		<h2 class="flex items-center gap-2 text-base font-semibold"><LvFrog size={14} />{m.lv_config_title()}</h2>
		{#if config}
			<LvProfileEditor {config} {pieces} {parts} root={lvProject.view?.root ?? lvProject.folderRoot ?? ''} onChange={change} />
		{/if}
		{#snippet section(title: string, help: string, key: ConfigSection | null, body: Snippet)}
			<section class="flex flex-col gap-1 rounded border border-surface-300-700 p-2" data-testid="lv-config-section">
				<header class="flex items-center gap-2">
					<h3 class="font-medium">{title}</h3>
					{#if key}<button class="hover:preset-tonal ml-auto rounded px-1.5 py-0.5 text-xs" title={m.lv_config_use_detected_hint()} data-testid="lv-config-detected" onclick={() => restore(key)}>{m.lv_config_use_detected()}</button>{/if}
				</header>
				{#if help}<p class="text-xs opacity-70">{help}</p>{/if}
				{@render body()}
			</section>
		{/snippet}
		{#if proposal}
			<details open={onDisk === null} data-testid="lv-config-technical">
				<summary class="cursor-pointer opacity-70">{m.lv_config_technical()}</summary>
				<div class="mt-2 flex flex-col gap-2">
					<div class="flex justify-end"><button class="hover:preset-tonal rounded px-2 py-1" title={m.lv_config_detect_hint()} disabled={busy} onclick={() => detect()}>{m.lv_config_detect()}</button></div>
					{#each proposal.avisos as warning (warning)}
						<p class="text-warning-500">{warning}</p>
					{/each}
					{#if config && figures && outputs}
						{#snippet rootBody()}
							<div role="radiogroup" aria-label={m.lv_config_root()}>
								{#each proposal?.candidatas ?? [] as c (c.archivo)}
									<label class="flex items-start gap-2 py-0.5">
										<input type="radio" name="lv-root" class="mt-1" checked={(config?.root ?? proposal?.raiz) === c.archivo} disabled={busy} onchange={() => chooseRoot(c.archivo)} />
										<span class="min-w-0">
											<span class="font-medium">{c.archivo}</span>
											<span class="ml-1 text-xs opacity-70">{ROLES[c.rol]}</span>
											{#if c.recomendada}<span class="text-success-500 ml-1 text-xs">{m.lv_config_recommended()}</span>{/if}
											<span class="block text-xs opacity-70" data-testid="lv-config-reason">{c.motivo}</span>
										</span>
									</label>
								{/each}
								{#if !proposal?.candidatas.length}<p class="text-error-500">{m.lv_config_no_root()}</p>{/if}
							</div>
						{/snippet}
						{@render section(m.lv_config_root(), m.lv_config_root_help(), 'root', rootBody)}

						{#snippet partsBody()}
							<p>{proposal?.partes.length ? m.lv_config_parts_found({ count: proposal.partes.length, names: proposal.partes.slice(0, 6).map(shortName).join(', ') }) : m.lv_config_parts_none()}</p>
							<label class="flex items-center gap-2"><span class={LABEL}>{m.lv_config_parts_commands()}</span><input class={INPUT} value={config ? partCommands(config).join(', ') : ''} onchange={(e) => update((c) => setPartCommands(c, list(e.currentTarget.value)))} /></label>
							{#if (proposal?.partsCommands.length ?? 0) > 1}<p class="text-xs opacity-70">{m.lv_config_parts_wrapper({ commands: proposal?.partsCommands.slice(1).map((c) => '\\' + c).join(', ') ?? '' })}</p>{/if}
						{/snippet}
						{@render section(m.lv_config_parts_title(), m.lv_config_parts_help(), 'parts', partsBody)}

						{#snippet flagRow(f: DetectedFlag)}
							<div class="flex flex-col gap-0.5" data-testid="lv-config-flag">
								<div class="flex items-center gap-2">
									<code>\{f.nombre}</code>
									<select class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5" aria-label={f.nombre} value={config ? flagUse(config, f.nombre) : 'ninguno'} onchange={(e) => update((c) => setFlag(c, f.nombre, e.currentTarget.value as FlagUse))}>
										{#each USES as [use, label] (use)}
											<option value={use}>{label}{use === f.uso && use !== 'ninguno' ? ` ${m.lv_config_detected_mark()}` : ''}</option>
										{/each}
									</select>
								</div>
								<p class="text-xs opacity-70">{f.frase}</p>
							</div>
						{/snippet}
						{#snippet flagsBody()}
							{#if usedFlags.length === 0}<p>{m.lv_config_flags_none()}</p>{/if}
							{#each usedFlags as f (f.nombre)}{@render flagRow(f)}{/each}
							{#if otherFlags.length}
								<div><button class="hover:preset-tonal rounded px-1.5 py-0.5 text-xs" onclick={() => (otherFlagsOpen = !otherFlagsOpen)}>{otherFlagsOpen ? m.lv_config_flags_hide({ count: otherFlags.length }) : m.lv_config_flags_show({ count: otherFlags.length })}</button></div>
								{#if otherFlagsOpen}{#each otherFlags as f (f.nombre)}{@render flagRow(f)}{/each}{/if}
							{/if}
						{/snippet}
						{@render section(m.lv_config_flags_title(), m.lv_config_flags_help(), 'flags', flagsBody)}

						{#snippet figuresBody()}
							{#each proposal?.figuras.avisos ?? [] as warning (warning)}<p class="text-warning-500 text-xs">{warning}</p>{/each}
							<label class="flex items-center gap-2">
								<span class={LABEL}>{m.lv_config_figures_mode()}</span>
								<select class={INPUT} value={figures?.mode} onchange={(e) => figures && update((c) => setFigures(c, { ...figures, mode: e.currentTarget.value as 'project' | 'app' | 'off' }))}>
									<option value="project">{m.lv_config_figures_project()}</option>
									<option value="app">{m.lv_config_figures_app()}</option>
									<option value="off">{m.lv_config_figures_off()}</option>
								</select>
							</label>
							{#if figures?.mode !== 'off'}
								<label class="flex items-center gap-2"><span class={LABEL}>{m.lv_config_figure_dir()}</span><input class={INPUT} value={figures?.dir} onchange={(e) => figures && update((c) => setFigures(c, { ...figures, dir: e.currentTarget.value }))} /></label>
								<label class="flex items-center gap-2" title={m.lv_config_stamp_hint()}><span class={LABEL}>{m.lv_config_stamp()}</span><input class={INPUT} value={figures?.stampFiles.join(', ')} onchange={(e) => figures && update((c) => setFigures(c, { ...figures, stampFiles: list(e.currentTarget.value) }))} /></label>
							{/if}
						{/snippet}
						{@render section(m.lv_config_figures_title(), proposal.figuras.motivo, 'figures', figuresBody)}

						{#snippet outputsBody()}
							<label class="flex items-center gap-2"><span class={LABEL}>{m.lv_config_publish_dir()}</span><input class={INPUT} value={outputs?.publish} placeholder={m.lv_config_publish_none()} onchange={(e) => outputs && update((c) => setOutputs(c, { ...outputs, publish: e.currentTarget.value }))} /></label>
							<label class="flex items-center gap-2"><span class={LABEL}>{m.lv_config_export_dir()}</span><input class={INPUT} value={outputs?.exportDir} placeholder="export" onchange={(e) => outputs && update((c) => setOutputs(c, { ...outputs, exportDir: e.currentTarget.value }))} /></label>
							<label class="flex items-center gap-2" title={m.lv_config_export_hint()}><span class={LABEL}>{m.lv_config_export_pattern()}</span><input class={INPUT} value={outputs?.pattern} onchange={(e) => outputs && update((c) => setOutputs(c, { ...outputs, pattern: e.currentTarget.value }))} /></label>
							{#if example}<p class="text-xs opacity-70">{m.lv_config_export_example({ name: example })}</p>{/if}
						{/snippet}
						{@render section(m.lv_config_outputs_title(), m.lv_config_outputs_help(), 'outputs', outputsBody)}

						{#snippet variablesBody()}
							{#each Object.entries(config?.variables ?? {}) as [name, v] (name)}
								<div class="flex items-center gap-1" data-testid="lv-config-variable">
									<code class="w-28 shrink-0 truncate">\{name}</code>
									<input class={INPUT} value={v.label ?? ''} placeholder={m.lv_config_variable_label()} aria-label={m.lv_config_variable_label()} onchange={(e) => update((c) => setVariable(c, name, { ...v, label: e.currentTarget.value }))} />
									<input class={INPUT} value={(v.choices ?? []).join(', ')} placeholder={m.lv_config_variable_choices()} aria-label={m.lv_config_variable_choices()} data-testid="lv-config-variable-choices" onchange={(e) => update((c) => setVariable(c, name, { ...v, choices: list(e.currentTarget.value) }))} />
									<select class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5" value={v.default ?? ''} aria-label={m.lv_config_variable_default()} onchange={(e) => update((c) => setVariable(c, name, { ...v, default: e.currentTarget.value || undefined }))}>
										<option value="">{m.lv_config_variable_no_value()}</option>
										{#each v.choices ?? [] as choice (choice)}<option value={choice}>{choice}</option>{/each}
									</select>
									<button class="hover:preset-tonal rounded p-0.5" title={m.lv_config_variable_remove()} aria-label={m.lv_config_variable_remove()} onclick={() => update((c) => removeVariable(c, name))}><X class="size-3.5" /></button>
								</div>
							{/each}
							{#each (proposal?.variables ?? []).filter((v) => !(v.nombre in (config?.variables ?? {}))) as v (v.nombre)}
								<div class="flex items-center gap-2">
									<p class="min-w-0 flex-1 text-xs opacity-70">{v.frase}</p>
									<button class="hover:preset-tonal shrink-0 rounded px-1.5 py-0.5 text-xs" onclick={() => update((c) => setVariable(c, v.nombre, { label: v.label, choices: v.choices, default: v.default }))}>{m.lv_config_variable_add_detected({ name: v.nombre })}</button>
								</div>
							{/each}
							{#each (proposal?.variables ?? []).filter((v) => v.nombre in (config?.variables ?? {}) && v.defSinGuardia.length > 0) as v (v.nombre)}
								<p class="text-warning-500 text-xs" data-testid="lv-config-variable-warning">{v.frase}</p>
							{/each}
							<div class="flex items-center gap-2">
								<input class={INPUT} bind:value={newVariable} placeholder={m.lv_config_variable_new()} aria-label={m.lv_config_variable_new()} data-testid="lv-config-variable-new" />
								<button class="hover:preset-tonal shrink-0 rounded px-1.5 py-0.5 text-xs" data-testid="lv-config-variable-add" disabled={!MACRO_NAME.test(newVariable) || newVariable in (config?.variables ?? {})} onclick={addVariable}>{m.lv_config_variable_add()}</button>
							</div>
						{/snippet}
						{@render section(m.lv_config_variables_title(), m.lv_config_variables_help(), 'variables', variablesBody)}
					{/if}
				</div>
			</details>
		{/if}
		<details open={!config}>
			<summary class="cursor-pointer opacity-70">{m.lv_config_advanced()}</summary>
			<label class="mt-1 flex flex-col gap-1">
				<span class="opacity-70">{m.lv_config_json()}</span>
				<textarea class="h-56 resize-y rounded border border-surface-300-700 bg-transparent p-2 font-mono text-xs" spellcheck="false" data-testid="lv-config-text" value={text} oninput={(e) => edit(e.currentTarget.value)}></textarea>
			</label>
		</details>
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
