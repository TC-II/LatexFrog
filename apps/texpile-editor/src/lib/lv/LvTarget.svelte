<script lang="ts">
	// Beside Compile: the active profile and what it is about to build. This is the only place that picks what compiles; everything
	// else about a build belongs to the profile and changes in Project Configuration. The Compile menu used to repeat those options
	// and they contradicted the profile: a footer choice there was saved and ignored.
	import { ChevronDown } from '@lucide/svelte';
	import { menuItemClass, menuPanelClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import { AnchoredMenu } from '$lib/pdf-view/anchoredMenu.svelte';
	import { activeFilePath } from '$lib/workspace/workspaceStore';
	import { lvProject } from './lvEngine.svelte';
	import { compileTarget } from './lvProfiles';

	const view = $derived(lvProject.view);
	const profiles = $derived((view?.config?.profiles ?? []).filter((p) => !p.hidden));
	const active = $derived(profiles.find((p) => p.id === view?.state.activeProfile) ?? null);
	const locked = $derived(view?.lockedBy != null);
	// a menu, not a <select>: each profile shows its color, a rounded square left of its name
	const menu = new AnchoredMenu('start');
	const swatch = (color: string | null | undefined) => `background: ${color ?? 'var(--color-surface-500)'}`;

	function choose(id: string) {
		menu.close();
		if (id !== active?.id) void lvProject.setState({ profile: id }).then(() => lvProject.noteActiveFile());
	}

	$effect(() => {
		void activeFilePath.current;
		lvProject.activeFileChanged();
	});

	const target = $derived.by(() => {
		if (!active || !view) return '';
		const count = active.parts === 'list' ? active.partList.length : view.state.selection.length;
		const t = compileTarget(active.parts, lvProject.fileInfo?.part ?? view.state.currentPart ?? null, count, lvProject.partLabels);
		if (t.kind === 'current') return t.part ?? '';
		if (t.kind === 'count') return m.lv_target_parts({ count: t.count ?? 0 });
		return t.kind === 'none' ? m.lv_target_none() : m.lv_target_all();
	});
	const why = $derived(active?.parts === 'current' ? m.lv_target_current_title() : '');
	/** a long chapter name would push the bar around: 8 characters and an ellipsis, the whole name on hover */
	const short = $derived(target.length > 9 ? `${target.slice(0, 8).trimEnd()}…` : target);
</script>

{#if view && active}
	<div class="flex min-w-0 items-center gap-1.5 text-xs @max-[20rem]:hidden" data-testid="lv-target">
		<button
			class="flex h-6 max-w-32 min-w-0 items-center gap-1.5 rounded border border-surface-300-700 bg-transparent px-1.5 whitespace-nowrap disabled:opacity-50"
			bind:this={menu.button}
			onclick={menu.toggle}
			title={active.label}
			aria-label={m.lv_profile()}
			aria-haspopup="menu"
			aria-expanded={menu.open}
			disabled={locked}
			data-testid="lv-profile-button"
		>
			<span class="size-2.5 shrink-0 rounded-[3px]" style={swatch(active.color)}></span>
			<span class="min-w-0 truncate">{active.label}</span>
			<ChevronDown class="size-3 shrink-0 opacity-60" />
		</button>
		{#if menu.open}
			<div bind:this={menu.el} class="{menuPanelClass} fixed z-1300 flex min-w-40 flex-col" style={menu.style} role="menu">
				{#each profiles as p (p.id)}
					<button
						class="{menuItemClass} whitespace-nowrap {p.id === active.id ? 'preset-tonal-primary' : ''}"
						role="menuitemradio"
						aria-checked={p.id === active.id}
						data-testid="lv-profile-{p.id}"
						onclick={() => choose(p.id)}
					>
						<span class="size-3 shrink-0 rounded-[3px]" style={swatch(p.color)}></span>
						<span class="cap-center">{p.label}</span>
					</button>
				{/each}
			</div>
		{/if}
		<span class="inline-block w-[9ch] shrink-0 truncate opacity-70 @max-[38rem]:hidden" title={why ? `${target} · ${why}` : target} data-testid="lv-target-parts">{short}</span>
	</div>
{/if}
