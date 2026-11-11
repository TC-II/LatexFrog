// LatexFrog: Live keeps the last result of each document it compiled, so going back to one whose sources did not change costs
// no TeX. A document is what a Live driver says at one moment: its text (the profile's flags, the pieces left out, the parts
// it includes) and the engine. A profile that follows the open file (`parts: "current"`) rewrites one driver file with another
// chapter each time, so the driver's path does not name a document; its text does. Chapter A, then B, then A again is three
// documents under two keys, and the third costs nothing.
//
// A kept result is still good while the files that document read are as they were. Which `.tex` files a pass read is in its
// SyncTeX (every file TeX input, by path) and in the pass's own list (`inputs`: every file it read a line of, by name only);
// every other kind of file (images, `.bib`, classes, data) counts for every document, since nothing lists them. So an edit in
// chapter B leaves chapter A's result good, and a replaced image drops all. Each one is kept under `_draft/snap/<key>/` with
// that fingerprint: a stat walk, a few ms.
//
// A kept result whose sources did change is still worth something: its aux, contents and bibliography are that document's
// own, far closer to what the next pass will write than the products of the chapter just left (`primeFromKept`).
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';

const SNAP = 'snap';
/** results kept: a book's chapters visited in one sitting */
const KEEP = 12;
const MAX_FILES = 40000;

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

/** the document a compile of `mainFile` with `engine` makes, by the driver's text; null when the driver cannot be read */
export function documentKey(root: string, mainFile: string, engine: string): string | null {
	try {
		return sha1(engine + '\0' + fs.readFileSync(path.join(root, mainFile), 'utf8')).slice(0, 16);
	} catch {
		return null;
	}
}

/** a source someone types, and that a pass therefore lists when it reads it */
const isSource = (name: string) => name.toLowerCase().endsWith('.tex');

/** The `.tex` files a pass read: by path relative to the project (lowercase, `/`) where SyncTeX says, and by name. */
export type Deps = { paths: ReadonlySet<string> | null; names: ReadonlySet<string> | null };

/** whether the source `rel` (lowercase, `/`) is one of the files the pass read */
function readByPass(rel: string, deps: Deps, pathNames: ReadonlySet<string> | null): boolean {
	if (!deps.paths && !deps.names) return true; // the pass did not say: every source counts
	if (deps.paths?.has(rel)) return true;
	const name = rel.slice(rel.lastIndexOf('/') + 1);
	// by name only when no path explains the name: the book's root and its first chapter are both
	// `Funciones de Aproximación.tex`, and by name an edit in that chapter dropped every chapter's result. A name SyncTeX
	// does not know (a file read with \read, not input) still counts wherever it is.
	return !!deps.names?.has(name) && !pathNames?.has(name);
}

/**
 * What a kept result depends on, as far as a stat can tell: the configuration, and the size and mtime of the project's files.
 * `which`: `all` files, only the `sources` (what changes while someone types), or all but the sources a pass did not read.
 * Null when it cannot be computed (too many files).
 */
export function projectFingerprint(root: string, which: 'all' | 'sources' | Deps = 'all'): string | null {
	const h = crypto.createHash('sha1');
	const deps = typeof which === 'object' ? which : null;
	const pathNames = deps?.paths ? new Set([...deps.paths].map((p) => p.slice(p.lastIndexOf('/') + 1))) : null;
	if (which !== 'sources')
		for (const extra of ['.latexfrog/latexfrog.json']) {
			try {
				const st = fs.statSync(path.join(root, extra));
				h.update(`${extra}\0${st.size}\0${st.mtimeMs}\n`);
			} catch {
				/* absent */
			}
		}
	let left = MAX_FILES;
	const walk = (rel: string, depth: number): boolean => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
		} catch {
			return true;
		}
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const e of entries) {
			// dot folders (.git, .latexfrog: generated from the sources and the config) and Live's own output
			if (e.name.startsWith('.') || e.name === '_draft' || e.name === 'node_modules') continue;
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (depth > 12 || !walk(r, depth + 1)) return false;
			} else if (e.isFile()) {
				if (--left < 0) return false;
				if (isSource(e.name) ? deps && !readByPass(r.toLowerCase(), deps, pathNames) : which === 'sources') continue;
				try {
					const st = fs.statSync(path.join(root, r));
					h.update(`${r}\0${st.size}\0${st.mtimeMs}\n`);
				} catch {
					/* vanished: the next compile sees it */
				}
			}
		}
		return true;
	};
	return walk('', 0) ? h.digest('hex') : null;
}

/** The project's `.tex` files a pass input, from its SyncTeX (`Input:<tag>:<root>/./<path>`): relative, lowercase, `/`. */
export function sourcesInSynctex(root: string, synctexGz: string): Set<string> | null {
	let text: string;
	try {
		text = zlib.gunzipSync(fs.readFileSync(synctexGz)).toString('utf8');
	} catch {
		return null;
	}
	const base = path.resolve(root).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() + '/';
	const out = new Set<string>();
	// an `Input:` line is written when its file is first read: they run through the whole file, not only its head
	for (const m of text.matchAll(/^Input:\d+:(.*)$/gm)) {
		const named = m[1].trim().replace(/\\/g, '/').toLowerCase();
		const rel = (named.startsWith(base) ? named.slice(base.length) : named)
			.replace(/^(\.\/)+/, '')
			// a file read from the copy with a profile's pieces commented out is that file
			.replace(/^\.latexfrog\/piezas\/[^/]+\//, '');
		// outside the project (the TeX tree), or Live's and the app's own files
		if (/^([a-z]:|\/)/.test(rel) || rel.startsWith('_draft/') || rel.startsWith('.')) continue;
		if (isSource(rel)) out.add(rel);
	}
	return out.size ? out : null;
}

const snapDir = (outAbs: string, key: string) => path.join(outAbs, SNAP, key);

/** the `draft.*` products and the parts' `.aux` (relative to `_draft`) */
function products(outAbs: string): string[] {
	const out: string[] = [];
	const walk = (rel: string, depth: number) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(path.join(outAbs, rel), { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (!rel && e.name === SNAP) continue;
				if (depth < 8) walk(r, depth + 1);
			} else if (e.isFile() && (rel ? e.name.endsWith('.aux') : e.name.startsWith('draft.'))) out.push(r);
		}
	};
	walk('', 0);
	return out;
}

/** the names of the files a result says its pass read; null when it does not say */
function namesOf(result: unknown): Set<string> | null {
	const list = (result as { inputs?: unknown } | null)?.inputs;
	if (!Array.isArray(list) || !list.length) return null;
	return new Set(list.filter((f): f is string => typeof f === 'string').map((f) => f.toLowerCase()));
}

/** what the kept result in `dir` read */
function keptDeps(dir: string, result: unknown): Deps {
	let paths: Set<string> | null = null;
	try {
		const list = JSON.parse(fs.readFileSync(path.join(dir, 'deps.json'), 'utf8')) as { paths?: unknown };
		if (Array.isArray(list.paths) && list.paths.length) paths = new Set(list.paths.filter((p): p is string => typeof p === 'string'));
	} catch {
		/* kept without SyncTeX: by name */
	}
	return { paths, names: namesOf(result) };
}

export type SnapshotStart = {
	/** the document, null when the driver cannot be read: nothing is kept or restored */
	key: string | null;
	/** the project's sources as they were when the compile started: what the result is a result of */
	before: string | null;
};

/** Taken before a compile runs: the document it compiles and the state of the sources it starts from. */
export function startSnapshot(root: string, mainFile: string, engine: string): SnapshotStart {
	const key = documentKey(root, mainFile, engine);
	return { key, before: key ? projectFingerprint(root, 'sources') : null };
}

/**
 * Keeps a good compile's result and products for the document it started as. Not kept when a source changed while it ran
 * (the result may be of either state) or when the driver was rewritten meanwhile (the result is of another document). A file
 * that is not a source and changed meanwhile is taken as written by the compile itself (the book's latexmkrc logs each run
 * in the project's folder). Never fails the compile.
 */
export function saveSnapshot(root: string, outAbs: string, mainFile: string, engine: string, start: SnapshotStart, result: unknown): void {
	if (!start.key || !start.before) return;
	if (documentKey(root, mainFile, engine) !== start.key || projectFingerprint(root, 'sources') !== start.before) return;
	const dir = snapDir(outAbs, start.key);
	// without its PDF a result restores as pages with empty figures: not worth keeping
	if (!fs.existsSync(path.join(outAbs, 'draft.pdf'))) {
		console.warn('[live snapshot] not saved: _draft/draft.pdf is missing', mainFile);
		fs.rmSync(dir, { recursive: true, force: true });
		return;
	}
	// a pass TeX gave up on (a corrupt aux, a hundred errors) lands with no pages: kept, it came back every time the
	// document was returned to, until a source changed
	const pages = (result as { pages?: unknown } | null)?.pages;
	if (Array.isArray(pages) && pages.length === 0) {
		fs.rmSync(dir, { recursive: true, force: true });
		return;
	}
	const paths = sourcesInSynctex(root, path.join(outAbs, 'draft.synctex.gz'));
	const fp = projectFingerprint(root, { paths, names: namesOf(result) });
	if (!fp) return;
	try {
		fs.rmSync(dir, { recursive: true, force: true });
		const files = path.join(dir, 'files');
		for (const r of products(outAbs)) {
			const to = path.join(files, r);
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.copyFileSync(path.join(outAbs, r), to);
		}
		fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
		if (paths) fs.writeFileSync(path.join(dir, 'deps.json'), JSON.stringify({ paths: [...paths] }));
		// written last: a snapshot without it is incomplete and never restored
		fs.writeFileSync(path.join(dir, 'fingerprint'), fp);
		prune(outAbs);
	} catch {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

function prune(outAbs: string): void {
	const base = path.join(outAbs, SNAP);
	let dirs: { d: string; t: number }[] = [];
	try {
		dirs = fs.readdirSync(base).map((d) => ({ d, t: fs.statSync(path.join(base, d)).mtimeMs }));
	} catch {
		return;
	}
	dirs.sort((a, b) => b.t - a.t);
	for (const { d } of dirs.slice(KEEP)) fs.rmSync(path.join(base, d), { recursive: true, force: true });
}

/**
 * Copies the kept files of `dir` over `_draft`. A part's `.aux` written after the result was kept stays: TeX rewrites only
 * the parts it includes, so that one is of a part this document leaves out, compiled since by another (the chapter just
 * left). Its labels are newer than the kept ones, and dropping it would turn every reference to that chapter into `??`.
 */
function putBack(dir: string, outAbs: string, wanted: (rel: string) => boolean): void {
	const files = path.join(dir, 'files');
	const newer = (from: string, to: string) => {
		try {
			return fs.statSync(to).mtimeMs > fs.statSync(from).mtimeMs;
		} catch {
			return false;
		}
	};
	const walk = (rel: string) => {
		for (const e of fs.readdirSync(path.join(files, rel), { withFileTypes: true })) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) walk(r);
			else if (wanted(r) && !(rel && newer(path.join(files, r), path.join(outAbs, r)))) {
				fs.mkdirSync(path.dirname(path.join(outAbs, r)), { recursive: true });
				fs.copyFileSync(path.join(files, r), path.join(outAbs, r));
			}
		}
	};
	walk('');
}

/** The kept result of the document when the files it read are as they were, with its products put back in `_draft`; else null. */
export function restoreSnapshot<T>(root: string, outAbs: string, mainFile: string, start: SnapshotStart): T | null {
	if (!start.key) return null;
	const dir = snapDir(outAbs, start.key);
	let kept: string;
	let result: T;
	try {
		kept = fs.readFileSync(path.join(dir, 'fingerprint'), 'utf8');
		result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) as T;
	} catch {
		return null; // never kept, or kept by halves
	}
	if (kept !== projectFingerprint(root, keptDeps(dir, result))) {
		console.info('[live snapshot] sources changed since it was kept, compiling', mainFile);
		return null;
	}
	const files = path.join(dir, 'files');
	if (!fs.existsSync(path.join(files, 'draft.pdf'))) {
		console.warn('[live snapshot] kept without draft.pdf, compiling', mainFile);
		return null;
	}
	try {
		// the other document's `draft.*` this one lacks go, so nothing of it is read as this one's; the rest are copied
		// over, never deleted first, so a failed copy leaves a PDF in place
		for (const r of products(outAbs)) if (!r.includes('/') && !fs.existsSync(path.join(files, r))) fs.rmSync(path.join(outAbs, r), { force: true });
		putBack(dir, outAbs, () => true);
		const now = new Date();
		fs.utimesSync(dir, now, now);
		return result;
	} catch (e) {
		// a file the viewer or a TeX process holds open on Windows lands here
		console.warn('[live snapshot] restore failed, compiling', mainFile, (e as Error).message);
		return null;
	}
}

/** what a pass writes for the eye or for navigation, not for the next pass to read */
const NOT_READ_BACK = /\.(pdf|log|synctex\.gz|synctex\(busy\))$/i;

/**
 * For a compile that has to run: when the document was kept before (its sources changed since), puts back what its last
 * pass left for the next one to read, the aux, the contents and the bibliography, in place of the products of whatever
 * document Live compiled last. Coming back to an edited chapter then starts from that chapter's own references and
 * bibliography, and one pass is enough where the other chapter's cost three. Returns whether it did.
 */
export function primeFromKept(outAbs: string, start: SnapshotStart): boolean {
	if (!start.key) return false;
	const dir = snapDir(outAbs, start.key);
	if (!fs.existsSync(path.join(dir, 'fingerprint'))) return false;
	try {
		const files = path.join(dir, 'files');
		for (const r of products(outAbs))
			if (!r.includes('/') && !NOT_READ_BACK.test(r) && !fs.existsSync(path.join(files, r))) fs.rmSync(path.join(outAbs, r), { force: true });
		putBack(dir, outAbs, (r) => !NOT_READ_BACK.test(r));
		return true;
	} catch {
		return false;
	}
}
