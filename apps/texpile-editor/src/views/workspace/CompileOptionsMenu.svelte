<script lang="ts">
	// the Compile button's chevron menu: actions on the compile's output, then the command itself
	import { BrushCleaning, ChevronRight, FileDown, FileText, FolderOpen, FolderOutput, RotateCcw, Settings2 } from '@lucide/svelte';
	import { menuItemClass, menuPanelClass, separatorClass } from '$lib/menus/menuStyles';
	import { m } from '$lib/paraglide/messages';
	import type { AnchoredMenu } from '$lib/pdf-view/anchoredMenu.svelte';
	import { lvProject } from '$lib/lv/lvEngine.svelte';
	import LvProjectRows from '$lib/lv/LvProjectRows.svelte';

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
		/** LatexFrog: the PDF on show, copied into the project's PDF folder */
		onExportCurrent?: () => void;
		/** LatexFrog: the project's PDF folder, where exports go */
		onShowExports?: () => void;
	};
	let { menu, onConfigure, onFromScratch, onCleanAux, latexmkActions, onShowOutput, outputAvailable, onExportCurrent, onShowExports }: Props = $props();

	let outputsOpen = $state(false);
	$effect(() => {
		if (!menu.open) outputsOpen = false;
	});

	const ROW = `${menuItemClass} whitespace-nowrap`;
	function pick(action: () => void) {
		menu.close();
		action();
	}
</script>

{#if menu.open}
	<div bind:this={menu.el} class="{menuPanelClass} fixed z-1300 flex min-w-48 flex-col" style={menu.style} role="menu">
		<LvProjectRows onPick={() => menu.close()} />
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
		{#if lvProject.active && onShowExports}
			<!-- LatexFrog: two folders, opened to the side: the PDF on show and the exports -->
			<div class="relative" role="none" onmouseenter={() => (outputsOpen = true)} onmouseleave={() => (outputsOpen = false)}>
				<button class="{ROW} w-full" aria-haspopup="menu" aria-expanded={outputsOpen} data-testid="lv-output-folder" onclick={() => (outputsOpen = !outputsOpen)}>
					<FolderOpen class="size-4 shrink-0" />
					<span class="cap-center">{m.wsview_show_output_in_folder()}</span>
					<ChevronRight class="ml-auto size-4 shrink-0 opacity-60" />
				</button>
				{#if outputsOpen}
					<div class="{menuPanelClass} absolute top-0 left-full z-10 flex min-w-40 flex-col" role="menu">
						<button class={ROW} onclick={() => pick(onShowOutput)} disabled={!outputAvailable} data-testid="lv-output-current">
							<FileText class="size-4 shrink-0" />
							<span class="cap-center">{m.lv_output_current_view()}</span>
						</button>
						<button class={ROW} onclick={() => pick(onShowExports)} data-testid="lv-output-exports">
							<FolderOutput class="size-4 shrink-0" />
							<span class="cap-center">{m.lv_output_exports()}</span>
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<button class={ROW} onclick={() => pick(onShowOutput)} disabled={!outputAvailable}>
				<FolderOpen class="size-4 shrink-0" />
				<span class="cap-center">{m.wsview_show_output_in_folder()}</span>
			</button>
		{/if}
		{#if lvProject.active && onExportCurrent}
			<button class={ROW} onclick={() => pick(onExportCurrent)} disabled={!outputAvailable} data-testid="lv-export-current">
				<FileDown class="size-4 shrink-0" />
				<span class="cap-center">{m.lv_export_current()}</span>
			</button>
		{/if}
		<!-- a lone row over a divider reads as a menu missing half; the divider needs a group above it -->
		<!-- LatexFrog: an engine project compiles by its profiles, so the shell command has nothing to say there -->
		{#if !lvProject.active}
			{#if latexmkActions}
				<div class={separatorClass}></div>
			{/if}
			<button class={ROW} onclick={() => pick(onConfigure)}>
				<Settings2 class="size-4 shrink-0" />
				<span class="cap-center">{m.wsview_configure_compile_command()}</span>
			</button>
		{/if}
	</div>
{/if}
