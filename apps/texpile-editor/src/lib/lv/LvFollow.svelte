<script lang="ts">
	// Follow, beside the active profile: only the crosshair, filled while it is on. A click switches it. Hovering shows, without taking room in
	// the bar, what the two states are and which one is on, with the frog that marks LatexFrog's own controls.
	import { LocateFixed } from '@lucide/svelte';
	import { menuItemClass, menuPanelClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import { AnchoredMenu } from '$lib/pdf-view/anchoredMenu.svelte';
	import { lvProject } from './lvEngine.svelte';
	import LvFrog from './LvFrog.svelte';

	const menu = new AnchoredMenu('end');
	const OPTIONS = [
		{ on: true, label: () => m.lv_follow_on(), hint: () => m.lv_follow_on_hint() },
		{ on: false, label: () => m.lv_follow_off(), hint: () => m.lv_follow_off_hint() }
	] as const;
	let leaving: ReturnType<typeof setTimeout> | undefined;

	const show = () => {
		clearTimeout(leaving);
		if (!menu.open) menu.toggle();
	};
	// a moment to move from the button into the panel
	const hide = () => {
		clearTimeout(leaving);
		leaving = setTimeout(menu.close, 250);
	};
	const set = (on: boolean) => void lvProject.setFollow(on);
</script>

{#if lvProject.active}
	<button
		class="btn btn-xs {lvProject.follow ? 'preset-filled-primary-500' : 'opacity-60'}"
		style="width: auto; padding-inline: 0.375rem"
		bind:this={menu.button}
		aria-pressed={lvProject.follow}
		aria-label={m.lv_follow()}
		data-testid="lv-follow"
		onmouseenter={show}
		onmouseleave={hide}
		onclick={() => set(!lvProject.follow)}
	>
		<LocateFixed size={14} />
	</button>
	{#if menu.open}
		<div bind:this={menu.el} class="{menuPanelClass} fixed z-1300 flex min-w-64 flex-col" style={menu.style} role="menu" tabindex="-1" onmouseenter={show} onmouseleave={hide} data-testid="lv-follow-menu">
			<div class="flex items-center gap-1.5 px-3 py-1 text-xs opacity-70"><LvFrog />{m.lv_follow_title()}</div>
			{#each OPTIONS as o (o.on)}
				<button class="{menuItemClass} whitespace-nowrap {o.on === lvProject.follow ? 'preset-tonal-primary' : ''}" role="menuitemradio" aria-checked={o.on === lvProject.follow} onclick={() => set(o.on)}>
					<LocateFixed class="size-4 shrink-0 {o.on ? '' : 'opacity-40'}" />
					<span class="flex flex-col items-start">
						<span>{o.label()}</span>
						<span class="text-xs opacity-60">{o.hint()}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
{/if}
