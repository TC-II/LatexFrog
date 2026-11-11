<script lang="ts">
	// The AI keys auto sync uses to settle conflicts, one under the other, tried in this order. A key is
	// typed once and never shown again: only its last four characters come back from the main process.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { ArrowUp, ArrowDown, Trash2, Plus } from '@lucide/svelte';
	import { DEFAULT_MODEL, lvAi, type AiKeyEdit, type AiKeyRow, type AiProvider, type KeyHealth } from './lvAi';

	let { onClose }: { onClose: () => void } = $props();

	type Draft = AiKeyEdit & { tail: string; health?: KeyHealth; testing?: boolean };

	let rows = $state<Draft[]>([]);
	let busy = $state(true);
	let dirty = $state(false);
	const bridge = lvAi();

	const PROVIDERS: { id: AiProvider; label: string }[] = [
		{ id: 'gemini', label: 'Google Gemini' },
		{ id: 'xai', label: 'xAI Grok' },
		{ id: 'openai', label: m.lv_aikeys_openai() }
	];

	function fromRow(r: AiKeyRow): Draft {
		return { id: r.id, provider: r.provider, label: r.label, model: r.model, baseUrl: r.baseUrl, enabled: r.enabled, tail: r.tail, health: r.health };
	}

	onMount(async () => {
		rows = bridge ? (await bridge.listKeys()).map(fromRow) : [];
		busy = false;
	});

	function add() {
		rows.push({ provider: 'gemini', label: '', model: '', baseUrl: '', enabled: true, tail: '', key: '' });
		dirty = true;
	}
	function move(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= rows.length) return;
		[rows[i], rows[j]] = [rows[j], rows[i]];
		dirty = true;
	}
	function remove(i: number) {
		rows.splice(i, 1);
		dirty = true;
	}

	async function save(): Promise<void> {
		if (!bridge) return;
		busy = true;
		const edits: AiKeyEdit[] = rows.map((r) => ({
			id: r.id,
			provider: r.provider,
			label: r.label || PROVIDERS.find((p) => p.id === r.provider)!.label,
			model: r.model,
			baseUrl: r.baseUrl,
			enabled: r.enabled,
			...(r.key ? { key: r.key } : {})
		}));
		rows = (await bridge.saveKeys($state.snapshot(edits) as AiKeyEdit[])).map(fromRow);
		dirty = false;
		busy = false;
	}

	async function test(i: number): Promise<void> {
		if (!bridge) return;
		if (dirty) await save();
		const r = rows[i];
		if (!r?.id) return;
		r.testing = true;
		r.health = (await bridge.testKey(r.id)) ?? undefined;
		r.testing = false;
	}

	function stateText(h?: KeyHealth): string {
		switch (h?.state) {
			case 'ok':
				return m.lv_aikeys_state_ok();
			case 'quota':
				return m.lv_aikeys_state_quota({ time: new Date(h.until).toLocaleTimeString() });
			case 'invalid':
				return m.lv_aikeys_state_invalid();
			case 'error':
				return m.lv_aikeys_state_error();
			default:
				return m.lv_aikeys_state_untested();
		}
	}
	const tone: Record<string, string> = { ok: 'text-success-600-400', quota: 'text-warning-600-400', invalid: 'text-error-600-400', error: 'text-error-600-400' };
</script>

<div class="fixed inset-0 z-1400 flex items-center justify-center bg-black/40 p-4" role="presentation">
	<div class="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-lg bg-surface-50-950 p-4 text-sm shadow-xl" role="dialog" aria-modal="true" aria-label={m.lv_aikeys_title()} data-testid="lv-aikeys" aria-busy={busy}>
		<div class="flex items-center gap-2">
			<h2 class="text-base font-semibold">{m.lv_aikeys_title()}</h2>
			<div class="ml-auto flex items-center gap-2">
				<button class="rounded px-2 py-1 hover:bg-surface-200-800" onclick={onClose}>{m.lv_close()}</button>
				<button class="rounded bg-primary-500 px-3 py-1 text-white" data-testid="lv-aikeys-save" disabled={busy || !dirty} onclick={save}>{m.lv_config_save()}</button>
			</div>
		</div>
		<p class="text-xs opacity-70">{m.lv_aikeys_help()}</p>
		{#if !bridge}<p class="text-warning-500">{m.lv_aikeys_no_app()}</p>{/if}

		{#each rows as r, i (r.id ?? `new-${i}`)}
			<section class="flex flex-col gap-2 rounded border border-surface-300-700 p-2" data-testid="lv-aikeys-row">
				<div class="flex flex-wrap items-center gap-2">
					<span class="w-5 text-right opacity-60">{i + 1}.</span>
					<input type="checkbox" checked={r.enabled} title={m.lv_aikeys_enabled()} onchange={(e) => ((r.enabled = e.currentTarget.checked), (dirty = true))} />
					<select class="rounded border border-surface-300-700 bg-transparent px-1 py-0.5" value={r.provider} onchange={(e) => ((r.provider = e.currentTarget.value as AiProvider), (dirty = true))}>
						{#each PROVIDERS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
					</select>
					<input class="min-w-0 flex-1 rounded border border-surface-300-700 bg-transparent px-1 py-0.5" placeholder={m.lv_aikeys_label()} value={r.label} oninput={(e) => ((r.label = e.currentTarget.value), (dirty = true))} />
					<span class="text-xs {tone[r.health?.state ?? ''] ?? 'opacity-60'}" title={r.health?.message ?? ''}>{r.testing ? m.lv_aikeys_testing() : stateText(r.health)}</span>
					<button class="rounded px-2 py-0.5 hover:bg-surface-200-800" disabled={busy || r.testing || (!r.tail && !r.key && r.provider !== 'openai')} onclick={() => test(i)}>{m.lv_aikeys_test()}</button>
					<button class="btn-icon btn-icon-xs hover:preset-tonal" aria-label={m.lv_aikeys_up()} disabled={i === 0} onclick={() => move(i, -1)}><ArrowUp size={14} /></button>
					<button class="btn-icon btn-icon-xs hover:preset-tonal" aria-label={m.lv_aikeys_down()} disabled={i === rows.length - 1} onclick={() => move(i, 1)}><ArrowDown size={14} /></button>
					<button class="btn-icon btn-icon-xs hover:preset-tonal" aria-label={m.lv_aikeys_remove()} onclick={() => remove(i)}><Trash2 size={14} /></button>
				</div>
				<div class="flex flex-wrap items-center gap-2 pl-7">
					<input
						type="password"
						autocomplete="off"
						class="min-w-0 flex-[2] rounded border border-surface-300-700 bg-transparent px-1 py-0.5 font-mono"
						placeholder={r.tail ? m.lv_aikeys_key_kept({ tail: r.tail }) : m.lv_aikeys_key()}
						value={r.key ?? ''}
						oninput={(e) => ((r.key = e.currentTarget.value), (dirty = true))}
					/>
					<input class="min-w-0 flex-1 rounded border border-surface-300-700 bg-transparent px-1 py-0.5" placeholder={DEFAULT_MODEL[r.provider]} title={m.lv_aikeys_model()} value={r.model} oninput={(e) => ((r.model = e.currentTarget.value), (dirty = true))} />
					{#if r.provider === 'openai'}
						<input class="min-w-0 flex-[2] rounded border border-surface-300-700 bg-transparent px-1 py-0.5" placeholder="https://api.groq.com/openai/v1" title={m.lv_aikeys_base()} value={r.baseUrl} oninput={(e) => ((r.baseUrl = e.currentTarget.value), (dirty = true))} />
					{/if}
				</div>
				{#if r.health?.message && r.health.state !== 'ok'}<p class="pl-7 text-xs break-all opacity-60">{r.health.message}</p>{/if}
			</section>
		{/each}
		<div><button class="hover:preset-tonal flex items-center gap-1 rounded px-2 py-1" data-testid="lv-aikeys-add" onclick={add}><Plus size={14} />{m.lv_aikeys_add()}</button></div>
	</div>
</div>
