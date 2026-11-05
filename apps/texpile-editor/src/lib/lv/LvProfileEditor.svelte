<script lang="ts">
	// The profiles: chips on top, then name, color and the document's pieces in book order, how it compiles, its watermark and where the PDF
	// goes.
	// Edits the copy of latexfrog.json that Project Configuration holds; only its Save writes.
	import { Plus, X } from '@lucide/svelte';
	import { pickFolder } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';
	import LvFrog from './LvFrog.svelte';
	import LvWatermark from './LvWatermark.svelte';
	import {
		DEFAULT_OUTPUT,
		emptyProfile,
		outputName,
		PER_PART_PATTERN,
		PROFILE_COLORS,
		profileId,
		relativeFolder,
		removeProfile,
		rows,
		selectionOf,
		setProfile,
		shortName,
		toParts,
		type ConfigJson,
		type Piece,
		type ProfileJson,
		type ProfileOutput
	} from './lvProfiles';

	let {
		config,
		pieces,
		parts,
		root,
		onChange,
		selected = $bindable('')
	}: { config: ConfigJson; pieces: Piece[]; parts: string[]; root: string; onChange: (next: ConfigJson) => void; selected?: string } = $props();

	const ids = $derived(Object.keys(config.profiles ?? {}));
	let chosen = $state('');
	let folderError = $state(false);
	// the last output of each profile, so unticking and ticking the copy gives it back
	const outputs: Record<string, ProfileOutput> = {};

	const id = $derived(ids.includes(chosen) ? chosen : (ids[0] ?? ''));
	$effect(() => {
		selected = id;
	});
	const profile = $derived<ProfileJson>(config.profiles?.[id] ?? {});
	const selection = $derived(selectionOf(profile));
	const omit = $derived(profile.omit ?? []);
	const output = $derived(profile.output ?? outputs[id] ?? DEFAULT_OUTPUT);
	const INPUT = 'rounded border border-surface-300-700 bg-transparent px-1 py-0.5';
	const CARD = 'flex flex-col gap-1 rounded border border-surface-300-700 p-2';

	const change = (patch: ProfileJson) => onChange(setProfile(config, id, patch));

	function add() {
		const number = ids.length + 1;
		const label = m.lv_profiles_new({ number });
		const next = profileId(label, ids);
		onChange(setProfile(config, next, emptyProfile(pieces, number, label)));
		chosen = next;
	}

	function setOutput(next: ProfileOutput) {
		outputs[id] = next;
		change({ output: next });
	}

	// a part's number or name means nothing for one file, and the profile's name alone would give every part the same file
	const PART_FIELD = /\{(n|num|cap|name|nombre)(:0\d+)?\}/;
	function perPart(on: boolean) {
		let pattern = output.pattern;
		if (on && !PART_FIELD.test(pattern)) pattern = PER_PART_PATTERN;
		if (!on && PART_FIELD.test(pattern)) pattern = DEFAULT_OUTPUT.pattern;
		const next: ProfileOutput = { ...output, pattern };
		if (on) next.perPart = true;
		else delete next.perPart;
		outputs[id] = next;
		change({ output: next });
	}

	const firstPart = $derived(shortName(parts.find((p) => selection.all || selection.list.includes(p)) ?? parts[0] ?? 'Chapter'));
	const example = $derived(
		output.perPart
			? outputName(output.pattern, { n: '1', num: '1', name: firstPart, profile: profile.label ?? id })
			: outputName(output.pattern, { n: '1', num: '', name: profile.label ?? id, profile: profile.label ?? id })
	);

	function setCopy(on: boolean) {
		if (!on && profile.output) outputs[id] = profile.output;
		change({ output: on ? output : undefined });
	}

	async function chooseFolder() {
		const picked = await pickFolder();
		if (!picked) return;
		const rel = relativeFolder(root, picked);
		folderError = rel === null;
		if (rel !== null) setOutput({ ...output, dir: rel });
	}
</script>

<div class="flex flex-col gap-2" data-testid="lv-profiles">
	<div class="flex items-center gap-2">
		<LvFrog />
		<span class="font-semibold">{m.lv_profiles_title()}</span>
		<label class="ml-auto flex items-center gap-2" title={m.lv_profiles_engine_hint()}>
			<span class="opacity-70">{m.lv_profiles_engine()}</span>
			<select class={INPUT} value={config.engine ?? 'pdflatex'} onchange={(e) => onChange({ ...config, engine: e.currentTarget.value })}>
				<option value="pdflatex">pdflatex</option>
				<option value="xelatex">xelatex</option>
				<option value="lualatex">lualatex</option>
			</select>
		</label>
	</div>

	<div class="flex flex-wrap items-center gap-1">
		{#each ids as key (key)}
			{@const p = config.profiles?.[key] ?? {}}
			<button type="button" class="flex items-center gap-1.5 rounded border px-2 py-0.5 {key === id ? '' : 'border-surface-300-700'}" style={key === id ? `border-color: ${p.color ?? 'var(--color-primary-500)'}` : ''} data-testid="lv-profile-chip" onclick={() => (chosen = key)}>
				<span class="size-2 rounded-full" style="background: {p.color ?? 'var(--color-surface-500)'}"></span>
				{p.label ?? key}
			</button>
		{/each}
		<button type="button" class="flex items-center gap-1 rounded border border-surface-300-700 px-2 py-0.5" data-testid="lv-profile-add" onclick={add}><Plus class="size-3" />{m.lv_profiles_add()}</button>
	</div>

	{#if id}
		<div class="grid gap-2 md:grid-cols-2">
			<div class={CARD}>
				<div class="flex items-center gap-1">
					<input class="{INPUT} min-w-0 flex-1" value={profile.label ?? id} aria-label={m.lv_profiles_name()} data-testid="lv-profile-name" oninput={(e) => change({ label: e.currentTarget.value })} />
					{#each PROFILE_COLORS as c (c)}
						<button type="button" class="size-4 rounded-full {profile.color === c ? 'ring-2 ring-offset-1' : ''}" style="background: {c}" aria-label={c} onclick={() => change({ color: c })}></button>
					{/each}
					<button type="button" class="hover:preset-tonal rounded p-0.5" disabled={ids.length <= 1} title={m.lv_profiles_remove()} aria-label={m.lv_profiles_remove()} onclick={() => onChange(removeProfile(config, id))}><X class="size-3.5" /></button>
				</div>
				<div class="text-xs opacity-70">{m.lv_profiles_pieces()}</div>
				<div class="max-h-72 overflow-y-auto">
					{#each rows(pieces, parts) as row (row.kind === 'piece' ? row.key : row.kind === 'chapter' ? row.part : row.kind)}
						<label class="flex items-center gap-2 py-0.5 {row.kind === 'chapter' ? 'pl-4' : ''} {row.kind === 'chapter' && selection.all ? 'opacity-50' : ''}">
							{#if row.kind === 'piece'}
								<input type="checkbox" checked={!omit.includes(row.key)} onchange={(e) => change({ omit: e.currentTarget.checked ? omit.filter((x) => x !== row.key) : [...omit, row.key] })} />
								{row.name}
							{:else if row.kind === 'current'}
								<input type="checkbox" checked={selection.current && !selection.all} disabled={selection.all} onchange={(e) => change(toParts({ ...selection, current: e.currentTarget.checked }))} />
								<strong>{m.lv_profiles_current()}</strong>
							{:else if row.kind === 'all'}
								<input type="checkbox" data-testid="lv-profile-all" checked={selection.all} onchange={(e) => change(toParts({ ...selection, all: e.currentTarget.checked }))} />
								<strong>{m.lv_profiles_all()}</strong>
							{:else}
								<input
									type="checkbox"
									checked={selection.all || selection.list.includes(row.part)}
									disabled={selection.all}
									onchange={(e) => change(toParts({ ...selection, list: e.currentTarget.checked ? [...selection.list, row.part] : selection.list.filter((x) => x !== row.part) }))}
								/>
								{shortName(row.part)}
							{/if}
						</label>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<div class={CARD}>
					<div class="text-xs opacity-70">{m.lv_profiles_how()}</div>
					<label class="flex items-center justify-between gap-2">
						{m.lv_profiles_figures()}
						<select class={INPUT} value={profile.externalize ? 'cache' : 'scratch'} onchange={(e) => change(e.currentTarget.value === 'cache' ? { externalize: true, cleanBefore: false } : { externalize: false, cacheOnly: false, cleanBefore: true })}>
							<option value="cache">{m.lv_profiles_figures_cache()}</option>
							<option value="scratch">{m.lv_profiles_figures_scratch()}</option>
						</select>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" checked={profile.draftImages === true} onchange={(e) => change({ draftImages: e.currentTarget.checked })} />
						{m.lv_draft_images()}
					</label>
				</div>

				<LvWatermark value={profile.watermark} profile={profile.label ?? id} onChange={(watermark) => change({ watermark })} />

				<div class={CARD}>
					<div class="text-xs opacity-70">{m.lv_profiles_output()}</div>
					<label class="flex items-center gap-2">
						<input type="checkbox" checked={!!profile.output} onchange={(e) => setCopy(e.currentTarget.checked)} />
						{m.lv_profiles_copy()}
					</label>
					<div class="flex flex-col gap-1 {profile.output ? '' : 'pointer-events-none opacity-50'}">
						<label class="flex items-center justify-between gap-2">
							{m.lv_profiles_files()}
							<select class={INPUT} value={output.perPart ? 'part' : 'one'} onchange={(e) => perPart(e.currentTarget.value === 'part')}>
								<option value="one">{m.lv_profiles_files_one()}</option>
								<option value="part">{m.lv_profiles_files_part()}</option>
							</select>
						</label>
						<label class="flex items-center gap-2">
							{m.lv_profiles_folder()}
							<input class="{INPUT} min-w-0 flex-1" value={output.dir} oninput={(e) => setOutput({ ...output, dir: e.currentTarget.value })} />
							<button type="button" class="hover:preset-tonal rounded px-1.5 py-0.5" onclick={chooseFolder}>{m.lv_profiles_choose()}</button>
						</label>
						{#if folderError}
							<p class="text-error-500">{m.lv_profiles_other_drive()}</p>
						{/if}
						<label class="flex items-center gap-2">
							{m.lv_profiles_name_pattern()}
							<input class="{INPUT} min-w-0 flex-1" value={output.pattern} oninput={(e) => setOutput({ ...output, pattern: e.currentTarget.value })} />
						</label>
						<p class="text-xs opacity-60">{'{profile}'} {m.lv_profiles_help_profile()}, {'{n}'} {m.lv_profiles_help_n()}, {'{num}'} {m.lv_profiles_help_cap()}, {'{name}'} {m.lv_profiles_help_name()}. {m.lv_profiles_help_zeros()}</p>
						<p class="text-xs opacity-80" data-testid="lv-profile-example">{m.lv_profiles_example({ name: example })}</p>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
