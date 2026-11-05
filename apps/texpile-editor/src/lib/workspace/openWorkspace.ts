// the one folder-open sequence: launch bootstrap, main's later pushes, and the start screen
import { fileService } from '$lib/files/service/fileService';
import { mark } from '$lib/debug/startupDoctor';
import { fileMode } from './fileMode.svelte';
import { navigate } from '$lib/router.svelte';
import { claimWorkspace, dirname, joinPath, nativeBridge, readTextFile, releaseWorkspace, samePath } from './fileSystem';
import { latexParserWorker } from './latexParserWorker';
import { landingFile } from './landingFile';
import { openFile, activeCompare, addRecentFolder, savedLastFile, savedLastCompare, texFiles, workspaceRoot } from './workspaceStore';
import type { CompareRef } from './tabs.svelte';

export type BootOpen = { kind: 'file' | 'folder'; path: string };

/** 'elsewhere': another window already owns the folder and main focused it, so this one stays put. */
export type OpenOutcome = 'opened' | 'elsewhere' | 'missing';

/** what the main process handed this window at creation, or null for a plain start screen. */
export function bootOpen(): BootOpen | null {
	return nativeBridge()?.bootstrap?.open ?? null;
}

/** the main file the configuration names, relative to the folder; null when it is not an engine project. The configuration lives in
 * .latexfrog/latexfrog.json; one at the top is from before it moved there. */
async function engineRoot(root: string): Promise<string | null> {
	for (const file of [joinPath(root, '.latexfrog/latexfrog.json'), joinPath(root, 'latexfrog.json')]) {
		try {
			const config = JSON.parse((await readTextFile(file)).replace(/^\uFEFF/, '')) as { root?: unknown };
			if (typeof config.root === 'string') return config.root;
		} catch {
			// not there, or not a configuration: the next place
		}
	}
	return null;
}

/**
 * A project is the folder its main file is in: the engine compiles from the open folder and resolves each \input against it, so
 * a main file in a subfolder gave an empty outline and failed on its first \input. The subfolder's own project opens instead.
 */
export async function projectFolder(root: string): Promise<string> {
	const main = await engineRoot(root);
	if (main) {
		if (!/[\\/]/.test(main)) return root;
		// a configuration saved beside a subfolder's main file (as setup once did) still means the subfolder
		return (await fileService.exists(joinPath(root, main))) ? joinPath(root, dirname(main)) : root;
	}
	if (await fileService.exists(joinPath(root, 'latexviewer.json'))) return root;
	return (await documentFolder(root)) ?? root;
}

/** a line that starts a document, outside a comment */
const DOCUMENTCLASS = /^[^%\n]*\\documentclass\b/m;
/** how deep below the opened folder a main file is looked for, and how many files are read at most */
const DOCUMENT_DEPTH = 3;
const DOCUMENT_READS = 300;

/**
 * LatexFrog: the folder of a repository whose LaTeX lives in a subfolder (`repo/Proyecto/book.tex`). Null when a document starts at
 * the top or the documents sit in more than one folder: the opened folder stays.
 */
async function documentFolder(root: string): Promise<string | null> {
	const files = (await fileService.scanTexFiles(root).catch(() => [])).filter((f) => /\.tex$/i.test(f.path));
	const depth = (f: { relPath: string }) => f.relPath.split(/[\\/]/).length;
	const near = files.filter((f) => depth(f) <= DOCUMENT_DEPTH).sort((a, b) => depth(a) - depth(b)).slice(0, DOCUMENT_READS);
	const roots = (
		await Promise.all(near.map(async (f) => ((await readTextFile(f.path).catch(() => '')).match(DOCUMENTCLASS) ? f : null)))
	).filter((f) => f !== null);
	if (roots.length === 0 || roots.some((f) => depth(f) === 1)) return null;
	const shallowest = depth(roots[0]);
	const folders = new Set(roots.filter((f) => depth(f) === shallowest).map((f) => dirname(f.path)));
	// the opened folder's separators: paths are matched as strings (the PDF on screen, the tree)
	const sep = root.includes('\\') ? '\\' : '/';
	return folders.size === 1 ? [...folders][0].replace(/[\\/]/g, sep) : null;
}

function show(root: string): void {
	workspaceRoot.current = root;
	texFiles.current = [];
	openFile(null);
	if (!fileMode.current) addRecentFolder(root);
	navigate('/workspace');
}

// together, not serially: which file to reopen comes from storage, so only its stat has to wait.
// `compare` is the version that file was left compared against, when reopening a folder as it was
async function fill(root: string, want: string | null, compare: CompareRef | null = null): Promise<void> {
	const [files, wantExists] = await Promise.all([fileService.scanTexFiles(root), want ? fileService.exists(want) : Promise.resolve(false)]);
	if (workspaceRoot.current !== root) return; // moved on while we scanned
	// the scan's casing wins where it has the file: the tree matches paths as strings
	const landing = want && wantExists ? (files.find((f) => samePath(f.path, want))?.path ?? want) : null;
	texFiles.current = files;
	if (landing) {
		openFile(landing);
		if (compare) activeCompare.current = compare;
		return;
	}
	// a project says what its main file is: the scan's first .tex only happened to come first, and the configuration loads after this
	const main = await engineRoot(root);
	const configured = main ? files.find((f) => samePath(f.path, joinPath(root, main)))?.path : undefined;
	const detected = configured ?? (await landingFile(root, files));
	if (workspaceRoot.current !== root) return;
	openFile(detected);
}

/** the launch path: main created this window for this folder, so it is shown without asking */
export function adoptBootOpen(boot: BootOpen): void {
	const root = boot.kind === 'file' ? dirname(boot.path) : boot.path;
	fileMode.current = boot.kind === 'file';
	// a lone file claims itself, so main routes nothing else into this window and does not remember the folder
	if (boot.kind === 'file') void claimWorkspace(boot.path, 'file');
	mark('folder-open');
	// a document is certain here, so warm the parser alongside the editor chunk
	latexParserWorker();
	show(root);
	const restoring = boot.kind === 'folder';
	void fill(root, restoring ? savedLastFile(root) : boot.path, restoring ? savedLastCompare(root) : null).catch(() => {});
	// the folder is on screen before this answers, as at any launch: a folder asked on the command line whose project is a
	// subfolder would otherwise stay open with an empty outline. A lone file never moves.
	if (restoring) {
		void projectFolder(root)
			.then((folder) => (folder === root ? undefined : open(folder, savedLastFile(folder), savedLastCompare(folder))))
			.catch(() => {});
	}
}

// Resolves once the workspace is on screen; the scan lands after it, as at launch. Waiting for the
// scan first put three round trips between the click and anything happening.
// `lone`: a single file, which claims itself rather than the folder
async function open(
	asked: string,
	want: string | null,
	compare: CompareRef | null = null,
	lone: string | null = null
): Promise<OpenOutcome> {
	mark('folder-open');
	const root = lone ? asked : await projectFolder(asked);
	// together, and both before navigating: claiming does not check the folder is still there, so a
	// recent-folders entry for a deleted one has to fail here rather than in an empty workspace
	const [claim, found] = await Promise.all([lone ? claimWorkspace(lone, 'file') : claimWorkspace(root), fileService.stat(root)]);
	if (!claim.ok) return 'elsewhere';
	if (!found.exists) {
		// the claim registered the dead path as this window's folder: hand it back
		if (workspaceRoot.current) void claimWorkspace(workspaceRoot.current);
		else releaseWorkspace();
		return 'missing';
	}
	latexParserWorker();
	show(root);
	void fill(root, want, compare).catch(() => {});
	return 'opened';
}

/** a folder picked on the start screen, or pushed at a window that is already running. `want` is
 *  the file to land on; omit it for whichever tab was focused there last. */
export async function openFolderInWindow(root: string, want?: string | null): Promise<OpenOutcome> {
	if (switchFolder) {
		// a folder switched to from an open workspace lands on its project folder too, as a first open does
		await switchFolder(await projectFolder(root), want ?? undefined);
		return 'opened';
	}
	fileMode.current = false;
	return want === undefined ? open(root, savedLastFile(root), savedLastCompare(root)) : open(root, want);
}

const ROOT_SEARCH_DEPTH = 5;

/** nearest ancestor with a marker, else the file's own folder. Nearest wins, .texpile first. */
export async function projectRootFor(filePath: string): Promise<string> {
	const first = dirname(filePath);
	let dir = first;
	for (let level = 0; level < ROOT_SEARCH_DEPTH; level++) {
		for (const marker of ['.texpile', '.git']) {
			if (await fileService.exists(joinPath(dir, marker))) return dir;
		}
		const up = dirname(dir);
		if (!up || up === dir) break;
		dir = up;
	}
	return first;
}

/** the open workspace's own folder switch, which claims the folder and sets its project up, as a lone file's window
 *  never did; the returned function lets go */
let switchFolder: ((root: string, want?: string) => Promise<void>) | null = null;
export function provideFolderSwitch(fn: (root: string, want?: string) => Promise<void>): () => void {
	switchFolder = fn;
	return () => {
		if (switchFolder === fn) switchFolder = null;
	};
}

/** re-root on the file's project, then show the chrome */
export async function openWorkspaceForFile(filePath: string): Promise<OpenOutcome> {
	const root = await projectRootFor(filePath);
	if (!switchFolder) return openFolderInWindow(root, filePath);
	await switchFolder(root, filePath);
	return 'opened';
}

/** OS "Open With": the file on its own, claimed by its path so its folder is not taken for a project */
export function openFileInWindow(filePath: string): Promise<OpenOutcome> {
	fileMode.current = true;
	return open(dirname(filePath), filePath, null, filePath);
}
