<script lang="ts">
	// What the engine's running build is doing, beside the Compile button. The clock counts here, not in the store, so an
	// idle window does no work.
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from '$lib/lv/lvEngine.svelte';
	import { formatSeconds } from '$lib/lv/lvFormat';

	let now = $state(Date.now());
	const progress = $derived(lvProject.progress);
	const label = $derived.by(() => {
		if (!progress) return '';
		const id = progress.profile;
		const name = lvProject.view?.config?.profiles.find((p) => p.id === id)?.label ?? id;
		const pass = progress.tool ? m.lv_progress_pass({ tool: progress.tool, pass: progress.pass }) : m.lv_progress_compiling({ profile: name });
		// a profile saving one PDF per part: which part it is on
		const step = progress.parts ? `${m.lv_progress_parts({ done: Math.min(progress.parts.done + 1, progress.parts.total), total: progress.parts.total })} · ${pass}` : pass;
		const elapsed = formatSeconds(Math.max(0, now - progress.startedAt));
		const typical = lvProject.typical[progress.profile];
		return `${step} · ${typical ? m.lv_progress_typical({ elapsed, typical: formatSeconds(typical.ms) }) : elapsed}`;
	});

	$effect(() => {
		if (!progress) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});
</script>

{#if progress}
	<span class="cap-center text-xs whitespace-nowrap opacity-70 @max-[32rem]:hidden" role="status" data-testid="lv-progress">{label}</span>
{/if}
