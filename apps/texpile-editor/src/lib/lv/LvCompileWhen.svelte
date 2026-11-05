<script lang="ts">
	// Beside Compile: when this project compiles by itself, with whichever profile is chosen. It is the project's choice, not a
	// profile's: on saving, once typing stops, or only with the Compile button. Kept in the project's state on this machine.
	import { Hand, Save, Timer } from '@lucide/svelte';
	import { menuItemClass, menuPanelClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import { AnchoredMenu } from '$lib/pdf-view/anchoredMenu.svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import { lvProject } from './lvEngine.svelte';
	import LvFrog from './LvFrog.svelte';

	let { compact = false }: { compact?: boolean } = $props();

	const menu = new AnchoredMenu('end');
	const OPTIONS = [
		{ when: 'save', icon: Save, label: () => m.lv_when_save(), hint: () => m.lv_when_save_hint() },
		{ when: 'idle', icon: Timer, label: () => m.lv_when_idle(), hint: () => m.lv_when_idle_hint() },
		{ when: 'manual', icon: Hand, label: () => m.lv_when_manual(), hint: () => m.lv_when_manual_hint() }
	] as const;
	const current = $derived(OPTIONS.find((o) => o.when === lvProject.compileWhen) ?? OPTIONS[0]);

	function pick(when: (typeof OPTIONS)[number]['when']) {
		menu.close();
		void lvProject.setCompileWhen(when);
	}
</script>

{#if lvProject.active}
	<button
		class="btn btn-xs preset-outlined-surface-200-800 gap-1 {compact ? 'px-1' : 'px-1.5'}"
		bind:this={menu.button}
		onclick={menu.toggle}
		use:tip={m.lv_when_title({ when: current.label() })}
		aria-label={m.lv_when_title({ when: current.label() })}
		aria-haspopup="menu"
		aria-expanded={menu.open}
		data-testid="lv-compile-when"
	>
		<current.icon class="size-3.5" />
		{#if !compact}<span class="cap-center @max-[44rem]:hidden">{current.label()}</span>{/if}
	</button>
	{#if menu.open}
		<div bind:this={menu.el} class="{menuPanelClass} fixed z-1300 flex min-w-56 flex-col" style={menu.style} role="menu">
			<div class="flex items-center gap-1.5 px-3 py-1 text-xs opacity-70"><LvFrog />{m.lv_when_heading()}</div>
			{#each OPTIONS as o (o.when)}
				<button class="{menuItemClass} whitespace-nowrap {o.when === current.when ? 'preset-tonal-primary' : ''}" role="menuitemradio" aria-checked={o.when === current.when} data-testid="lv-when-{o.when}" onclick={() => pick(o.when)}>
					<o.icon class="size-4 shrink-0" />
					<span class="flex flex-col items-start">
						<span>{o.label()}</span>
						<span class="text-xs opacity-60">{o.hint()}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
{/if}
