// The project dialogs. They mount on the body because the Compile menu that opens them unmounts as it closes.
import { mount, unmount, type Component } from 'svelte';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import { lvProject } from './lvEngine.svelte';
import LvConfigPanel from './LvConfigPanel.svelte';

type Close = { onClose: () => void };

let closeOpen: (() => void) | null = null;

function show<P extends Close>(panel: Component<P>, props: Omit<P, 'onClose'>) {
	closeOpen?.();
	const instance = mount(panel, { target: document.body, props: { ...props, onClose: () => close() } as unknown as P });
	const close = () => {
		closeOpen = null;
		void unmount(instance);
	};
	closeOpen = close;
}

export const openConfigPanel = () => show(LvConfigPanel, {});

/** a project just opened: say so if an earlier run left TeX working in it. Nothing is killed without the user choosing to */
export async function offerOrphans() {
	const orphans = await lvProject.request<unknown[]>('orphans').catch(() => []);
	if (orphans.length === 0) return;
	toaster.warning({
		title: m.lv_orphans_toast({ count: orphans.length }),
		duration: 15000,
		action: { label: m.lv_orphans_action(), onClick: () => lvProject.onShowDock?.('leftover') }
	});
}
