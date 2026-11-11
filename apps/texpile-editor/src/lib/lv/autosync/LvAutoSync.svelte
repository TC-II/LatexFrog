<script lang="ts">
	// Auto sync's line in the Source Control panel: on/off, how often, what the last round did, and the keys.
	import { m } from '$lib/paraglide/messages';
	import { tip } from '$lib/components/tooltip.svelte';
	import { KeyRound, RefreshCw, LoaderCircle, TriangleAlert, Sparkles } from '@lucide/svelte';
	import { autoSync, INTERVALS } from './autoSync.svelte';
	import { openAiKeys } from './openAiKeys';

	const working = $derived(autoSync.state === 'saving' || autoSync.state === 'syncing' || autoSync.state === 'merging');
	const label = $derived.by(() => {
		switch (autoSync.state) {
			case 'saving':
				return m.lv_autosync_state_saving();
			case 'syncing':
				return m.lv_autosync_state_syncing();
			case 'merging':
				return m.lv_autosync_state_merging();
			case 'attention':
				return m.lv_autosync_state_attention();
			case 'idle':
				return m.lv_autosync_state_idle({ time: new Date(autoSync.lastSync).toLocaleTimeString() });
			case 'waiting':
				return m.lv_autosync_state_waiting();
			default:
				return '';
		}
	});
	let showMerges = $state(false);
</script>

<div class="flex flex-col gap-1 border-b border-surface-200-800 px-2 py-1 text-xs" data-testid="lv-autosync">
	<div class="flex items-center gap-2">
		<label class="flex items-center gap-1" use:tip={m.lv_autosync_tip()}>
			<input type="checkbox" checked={autoSync.enabled} data-testid="lv-autosync-toggle" onchange={(e) => autoSync.setEnabled(e.currentTarget.checked)} />
			<span class="font-medium">{m.lv_autosync_title()}</span>
		</label>
		{#if autoSync.enabled}
			<select class="rounded border border-surface-300-700 bg-transparent px-0.5" aria-label={m.lv_autosync_every()} value={autoSync.interval} onchange={(e) => autoSync.setInterval(Number(e.currentTarget.value))}>
				{#each INTERVALS as s (s)}<option value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>{/each}
			</select>
		{/if}
		<div class="ml-auto flex items-center gap-1">
			{#if autoSync.merges.length}
				<button class="btn-icon btn-icon-xs hover:preset-tonal" use:tip={m.lv_autosync_review()} aria-label={m.lv_autosync_review()} onclick={() => (showMerges = !showMerges)}><Sparkles size={13} /></button>
			{/if}
			{#if autoSync.enabled}
				<button class="btn-icon btn-icon-xs hover:preset-tonal" use:tip={m.lv_autosync_now()} aria-label={m.lv_autosync_now()} disabled={working} onclick={() => autoSync.syncNow()}><RefreshCw size={13} /></button>
			{/if}
			<button class="btn-icon btn-icon-xs hover:preset-tonal" use:tip={m.lv_aikeys_title()} aria-label={m.lv_aikeys_title()} data-testid="lv-autosync-keys" onclick={openAiKeys}><KeyRound size={13} /></button>
		</div>
	</div>
	{#if autoSync.enabled && label}
		<div class="flex items-start gap-1 opacity-80" data-testid="lv-autosync-state">
			{#if working}<LoaderCircle size={12} class="mt-0.5 shrink-0 animate-spin" />{:else if autoSync.state === 'attention'}<TriangleAlert size={12} class="mt-0.5 shrink-0 text-warning-500" />{/if}
			<span class="min-w-0 break-words">{label}{autoSync.message ? ` · ${autoSync.message}` : ''}</span>
		</div>
		{#if autoSync.state === 'attention'}
			<div class="flex gap-2">
				<button class="hover:preset-tonal rounded px-1.5 py-0.5" onclick={() => autoSync.syncNow()}>{m.lv_autosync_retry()}</button>
				<button class="hover:preset-tonal rounded px-1.5 py-0.5" onclick={() => void autoSync.byHand()}>{m.lv_autosync_by_hand()}</button>
			</div>
		{/if}
	{/if}
	{#if showMerges}
		<ul class="flex flex-col gap-1 rounded bg-surface-100-900 p-1" data-testid="lv-autosync-merges">
			{#each autoSync.merges as rec (rec.at)}
				<li>
					<span class="opacity-70">{new Date(rec.at).toLocaleString()}</span> · {rec.files.map((f) => f.split(/[\\/]/).pop()).join(', ')} · {[...new Set(rec.by)].join(', ')}
					{#each rec.notes as note, i (i)}<div class="pl-2 opacity-70">{note}</div>{/each}
				</li>
			{/each}
		</ul>
	{/if}
</div>
