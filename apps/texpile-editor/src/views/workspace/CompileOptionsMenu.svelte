<script lang="ts">
	// the Compile button's chevron menu: actions on the compile's output, then the command itself
	import { BrushCleaning, FolderOpen, PackageCheck, RotateCcw, Settings2 } from '@lucide/svelte';
	import { menuItemClass, menuPanelClass, separatorClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import type { AnchoredMenu } from '$lib/pdf-view/anchoredMenu.svelte';
	import LvBuildSection from '$lib/lv/LvBuildSection.svelte';
	import LvDeliveryDialog from '$lib/lv/LvDeliveryDialog.svelte';
	import { lvProject } from '$lib/lv/lvEngine.svelte';

	type Props = {
		menu: AnchoredMenu;
		onConfigure: () => void;
		/** latexmk -gg and -c (compileResolve); both rows show only when those apply */
		onFromScratch: () => void;
		onCleanAux: () => void;
		latexmkActions: boolean;
		onShowOutput: () => void;
		/** a compiled PDF exists to reveal; the row stays, greyed, so it is discoverable */
		outputAvailable: boolean;
	};
	let { menu, onConfigure, onFromScratch, onCleanAux, latexmkActions, onShowOutput, outputAvailable }: Props = $props();

	const ROW = `${menuItemClass} whitespace-nowrap`;
	let deliveryOpen = $state(false);
	function pick(action: () => void) {
		menu.close();
		action();
	}
</script>

{#if menu.open}
	<div bind:this={menu.el} class="{menuPanelClass} fixed z-1300 flex min-w-48 flex-col" style={menu.style} role="menu">
		<LvBuildSection />
		{#if lvProject.active}
			<button class={ROW} onclick={() => pick(() => (deliveryOpen = true))}>
				<PackageCheck class="size-4 shrink-0" />
				<span class="cap-center">{m.lv_delivery_menu()}</span>
			</button>
		{/if}
		{#if latexmkActions}
			<button class={ROW} onclick={() => pick(onFromScratch)}>
				<RotateCcw class="size-4 shrink-0" />
				<span class="cap-center">{m.wsview_recompile_from_scratch()}</span>
			</button>
			<button class={ROW} onclick={() => pick(onCleanAux)}>
				<BrushCleaning class="size-4 shrink-0" />
				<span class="cap-center">{m.wsview_clean_aux_files()}</span>
			</button>
		{/if}
		<button class={ROW} onclick={() => pick(onShowOutput)} disabled={!outputAvailable}>
			<FolderOpen class="size-4 shrink-0" />
			<span class="cap-center">{m.wsview_show_output_in_folder()}</span>
		</button>
		<!-- a lone row over a divider reads as a menu missing half; the divider needs a group above it -->
		{#if latexmkActions}
			<div class={separatorClass}></div>
		{/if}
		<button class={ROW} onclick={() => pick(onConfigure)}>
			<Settings2 class="size-4 shrink-0" />
			<span class="cap-center">{m.wsview_configure_compile_command()}</span>
		</button>
	</div>
{/if}
<LvDeliveryDialog bind:open={deliveryOpen} />
