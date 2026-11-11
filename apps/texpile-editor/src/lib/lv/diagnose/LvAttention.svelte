<script lang="ts">
	// The top of Problems: what needs the author beyond the log (auto sync stopped), and how the AI is spent.
	// Also where a new compile log is handed to diagnose, which decides whether it is worth one call.
	import { m } from '$lib/paraglide/messages';
	import { TriangleAlert, Sparkles } from '@lucide/svelte';
	import { compileLog } from '$lib/stores/compileLogStore';
	import { autoSync } from '../autosync/autoSync.svelte';
	import { diagnose } from './diagnose.svelte';

	$effect(() => {
		void compileLog.current;
		diagnose.onLog();
	});
</script>

<div class="border-surface-200-800 flex flex-col border-b text-xs" data-testid="lv-attention">
	{#if autoSync.enabled && autoSync.state === 'attention'}
		<div class="flex items-start gap-2 px-2 py-1">
			<TriangleAlert class="text-warning-ink mt-0.5 size-3.5 shrink-0" />
			<span class="min-w-0 flex-1">{m.lv_autosync_failed()} · {autoSync.message}</span>
			<button class="hover:preset-tonal shrink-0 rounded px-1.5" onclick={() => autoSync.syncNow()}>{m.lv_autosync_retry()}</button>
			<button class="hover:preset-tonal shrink-0 rounded px-1.5" onclick={() => void autoSync.byHand()}>{m.lv_autosync_by_hand()}</button>
		</div>
	{/if}
	<div class="text-muted flex h-6 items-center gap-2 px-2">
		<Sparkles class="size-3" />
		<label class="flex cursor-pointer items-center gap-1" title={m.lv_diag_auto_tip()}>
			<input type="checkbox" class="checkbox scale-75" checked={diagnose.auto} onchange={(e) => diagnose.setAuto(e.currentTarget.checked)} />
			{m.lv_diag_auto()}
		</label>
		<span class="ml-auto">{m.lv_diag_ai_left({ count: diagnose.left })}</span>
	</div>
</div>
