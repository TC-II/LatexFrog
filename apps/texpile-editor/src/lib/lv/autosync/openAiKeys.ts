// The keys dialog mounts on the body, like the project dialogs (lvPanels.ts)
import { mount, unmount } from 'svelte';
import LvAiKeysPanel from './LvAiKeysPanel.svelte';

let open: (() => void) | null = null;

export function openAiKeys(): void {
	open?.();
	const instance = mount(LvAiKeysPanel, { target: document.body, props: { onClose: () => close() } });
	const close = () => {
		open = null;
		void unmount(instance);
	};
	open = close;
}
