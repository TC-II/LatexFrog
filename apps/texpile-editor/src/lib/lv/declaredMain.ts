// The main file a project names on disk, read before anything asks the user which file it is.
//
// The renderer's saved choice lives in localStorage, which is per origin: the installed app
// (app://bundle) and a dev run (http://127.0.0.1) never see each other's, and a fresh install
// sees none. A project that already says which file is its root - .texpile/config.json's
// `main`, or the engine's .latexfrog/latexfrog.json `root` - must not be asked again just
// because that storage is empty. Reading the file here, before the first-compile question is
// decided, also closes the race with projectConfig.adopt(), which lands on its own schedule.
import { fileService } from '$lib/files/service/fileService';
import { readProjectConfig } from '$lib/workspace/projectConfig';
import { isSafeRel } from '$lib/collab/protocol';
import { joinPath, samePath, type TexFile } from '$lib/workspace/fileSystem';

/** where the engine's config may sit, newest first (lvEngine looks in the same places) */
const ENGINE_CONFIGS = ['.latexfrog/latexfrog.json', 'latexfrog.json', 'latexviewer.json'];

async function engineRoot(root: string): Promise<string | null> {
	for (const rel of ENGINE_CONFIGS) {
		try {
			const parsed: unknown = JSON.parse(await fileService.readText(joinPath(root, rel)));
			const r = (parsed as { root?: unknown } | null)?.root;
			return typeof r === 'string' && isSafeRel(r) ? r : null;
		} catch {
			/* absent or unreadable: try the next place */
		}
	}
	return null;
}

/**
 * The scanned file the project declares as its main, or null. An explicit `"main": ""` in
 * .texpile/config.json is a cleared choice and stays cleared: the engine's root does not
 * override it.
 */
export async function declaredMainFile(root: string, files: readonly TexFile[]): Promise<string | null> {
	const cfg = await readProjectConfig(root).catch(() => null);
	if (cfg?.main === '') return null;
	for (const rel of [cfg?.main, await engineRoot(root)]) {
		if (!rel) continue;
		const abs = joinPath(root, rel);
		const hit = files.find((f) => samePath(f.path, abs));
		if (hit) return hit.path;
	}
	return null;
}
