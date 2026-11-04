<script lang="ts">
	// The Compile menu's way into the project dialogs. A plain folder gets the one row that turns it into an engine project.
	import { Activity, FolderCog } from '@lucide/svelte';
	import { menuItemClass, separatorClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import { lvProject } from './lvEngine.svelte';
	import { openConfigPanel, openDiagnostics } from './lvPanels';

	let { onPick }: { onPick: () => void } = $props();

	const ROW = `${menuItemClass} whitespace-nowrap`;
	const available = $derived(!!window.lvEngine && !!workspaceRoot.current);
	const lockedBy = $derived(lvProject.view?.lockedBy ?? null);

	function pick(action: () => void) {
		onPick();
		action();
	}
</script>

{#if available}
	{#if lockedBy !== null}
		<span class="px-3 py-1 text-sm text-warning-500">{m.lv_locked({ pid: lockedBy })}</span>
	{/if}
	<button class={ROW} data-testid="lv-config-row" onclick={() => pick(openConfigPanel)}>
		<FolderCog class="size-4 shrink-0" />
		<span class="cap-center">{lvProject.active ? m.lv_config_row() : m.lv_setup_row()}</span>
	</button>
	{#if lvProject.active}
		<button class={ROW} data-testid="lv-diagnostics-row" onclick={() => pick(() => openDiagnostics())}>
			<Activity class="size-4 shrink-0" />
			<span class="cap-center">{m.lv_diagnostics_row()}</span>
		</button>
	{/if}
	<div class={separatorClass}></div>
{/if}
