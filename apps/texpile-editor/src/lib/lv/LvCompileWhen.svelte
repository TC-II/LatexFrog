<script lang="ts">
	// In the Compile menu, under Project Configuration: when this project compiles by itself, with whichever profile is chosen. It is
	// the project's choice, not a profile's: as you type (Live), on saving, once typing stops, or only with the Compile button. Kept in
	// the project's state on this machine.
	import { Hand, Radio, Save, Timer } from '@lucide/svelte';
	import { latexLiveMode, projectConfigSync } from '$lib/workspace/projectConfigSync.svelte';
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import { menuItemClass, separatorClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import { lvProject } from './lvEngine.svelte';

	let { onPick }: { onPick: () => void } = $props();

	const OPTIONS = [
		{ when: 'live', icon: Radio, label: () => m.lv_when_live(), hint: () => m.lv_when_live_hint() },
		{ when: 'save', icon: Save, label: () => m.lv_when_save(), hint: () => m.lv_when_save_hint() },
		{ when: 'idle', icon: Timer, label: () => m.lv_when_idle(), hint: () => m.lv_when_idle_hint() },
		{ when: 'manual', icon: Hand, label: () => m.lv_when_manual(), hint: () => m.lv_when_manual_hint() }
	] as const;
	type When = (typeof OPTIONS)[number]['when'];
	// Live is Texpile's incremental lualatex preview: it owns the PDF pane, so it replaces the automatic builds
	const whenNow = $derived<When>(latexLiveMode() ? 'live' : lvProject.compileWhen);

	function pick(when: When) {
		onPick();
		const root = workspaceRoot.current;
		if (when === 'live') {
			projectConfigSync.setLiveMode(root, true);
			void lvProject.prepareLive();
			void lvProject.setCompileWhen('manual');
			return;
		}
		if (latexLiveMode()) projectConfigSync.setLiveMode(root, false);
		void lvProject.setCompileWhen(when);
	}
</script>

{#if lvProject.active}
	<div class="px-3 pt-1 pb-0.5 text-xs opacity-70" role="presentation">{m.lv_when_heading()}</div>
	{#each OPTIONS as o (o.when)}
		<button
			class="{menuItemClass} whitespace-nowrap {o.when === whenNow ? 'preset-tonal-primary' : ''}"
			role="menuitemradio"
			aria-checked={o.when === whenNow}
			title={o.hint()}
			data-testid="lv-when-{o.when}"
			onclick={() => pick(o.when)}
		>
			<o.icon class="size-4 shrink-0" />
			<span class="cap-center">{o.label()}</span>
		</button>
	{/each}
	<div class={separatorClass}></div>
{/if}
