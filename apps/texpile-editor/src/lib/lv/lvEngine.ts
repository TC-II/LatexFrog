// The window's end of the lv-sidecar: when a build finishes with a fresh PDF, the viewer loads it straight from the
// profile's output, with no copy and no polling. Importing this module is what subscribes.
import { pdfStore } from '$lib/stores/pdfStore';
import { fileUrl, joinPath } from '$lib/workspace/fileSystem';

type Finished = { kind?: string; tipo?: string; pdf?: string | null; ok?: boolean; updated?: boolean };

let root: string | null = null;

export async function openProject(path: string) {
	root = path;
	return window.texpileLv?.pedir({ pedido: 'abrir', raiz: path });
}

window.texpileLv?.onEvento((event) => {
	const ev = event as Finished;
	if (!root || !ev.pdf || !ev.updated) return;
	pdfStore.current = fileUrl(joinPath(root, ev.pdf)) + '&t=' + Date.now();
});
