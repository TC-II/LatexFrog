<script lang="ts">
	// Under an error in Problems: the local fix when a rule knows one, the AI's explanation when there is one,
	// and Explain when there is not. Nothing is sent unless asked, except what diagnose.onLog decides.
	import { m } from '$lib/paraglide/messages';
	import { LoaderCircle, Sparkles, PackagePlus, Wrench } from '@lucide/svelte';
	import type { LogEntry } from '$lib/compileLog/types';
	import { diagnose } from './diagnose.svelte';
	import { openAiKeys } from '../autosync/openAiKeys';

	let { entry }: { entry: LogEntry } = $props();

	const d = $derived(diagnose.of(entry));
	let note = $state('');

	async function addPkg(pkg: string) {
		note = (await diagnose.addPackage(pkg)) ? m.lv_diag_pkg_added({ pkg }) : m.lv_diag_pkg_not_added({ pkg });
	}
	async function apply() {
		note = (await diagnose.applyFix(entry)) ? m.lv_diag_fix_applied() : m.lv_diag_fix_stale();
	}
</script>

<div class="flex flex-col gap-1 pr-2 pb-1.5 pl-7 text-xs" data-testid="lv-explain">
	<div class="flex flex-wrap items-center gap-2">
		{#if entry.suggestedPackage}
			<button class="hover:preset-tonal flex items-center gap-1 rounded px-1.5 py-0.5" data-testid="lv-explain-pkg" onclick={() => addPkg(entry.suggestedPackage!)}>
				<PackagePlus size={12} />{m.lv_diag_add_pkg({ pkg: entry.suggestedPackage })}
			</button>
		{/if}
		{#if !d || d.state === 'failed'}
			<button class="hover:preset-tonal flex items-center gap-1 rounded px-1.5 py-0.5" data-testid="lv-explain-ask" disabled={diagnose.left === 0} title={m.lv_diag_ai_left({ count: diagnose.left })} onclick={() => diagnose.explain(entry)}>
				<Sparkles size={12} />{m.lv_diag_explain()}
			</button>
		{/if}
		{#if d?.state === 'failed'}
			<span class="text-warning-ink">{d.message}</span>
			{#if d.noKeys}<button class="underline" onclick={openAiKeys}>{m.lv_autosync_open_keys()}</button>{/if}
		{/if}
		{#if d?.state === 'loading'}
			<span class="text-muted flex items-center gap-1"><LoaderCircle size={12} class="animate-spin" />{m.lv_diag_asking()}</span>
		{/if}
		{#if note}<span class="text-muted">{note}</span>{/if}
	</div>
	{#if d?.state === 'done'}
		<div class="rounded bg-surface-100-900 p-1.5" data-testid="lv-explain-answer">
			<p class="whitespace-pre-wrap"><Sparkles size={11} class="mr-1 inline opacity-60" />{d.explanation}</p>
			{#if d.fix}
				<pre class="mt-1 overflow-x-auto font-mono text-[11px] leading-4"><span class="text-error-ink">{d.fix.before.split('\n').map((l, i) => `-${d.fix!.from + i}| ${l}`).join('\n')}</span>
<span class="text-success-ink">{d.fix.text.split('\n').map((l) => `+  | ${l}`).join('\n')}</span></pre>
				<button class="hover:preset-tonal mt-1 flex items-center gap-1 rounded px-1.5 py-0.5" data-testid="lv-explain-apply" onclick={apply}><Wrench size={12} />{m.lv_diag_apply()}</button>
			{/if}
			<p class="text-muted mt-0.5 text-[10px]">{d.by}</p>
		</div>
	{/if}
</div>
