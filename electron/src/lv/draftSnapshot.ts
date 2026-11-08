// LatexFrog: Live keeps the last result of each profile, so going back to a profile whose sources did not change costs no TeX.
// Each profile's Live driver is its own main file; switching profiles used to throw away the previous one's pages, aux and
// bibliography, and coming back paid the whole cold compile again (~25 s a pass on the book). After a good compile its result
// and its `draft.*` products are kept under `_draft/snap/<driver hash>/` with a fingerprint of the project: the driver's text,
// the engine, and the size and mtime of every project file (a stat walk, a few ms). A compile whose fingerprint matches restores
// them instead of running TeX.
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

const SNAP = 'snap';
const KEEP = 6;
const MAX_FILES = 40000;

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

/** what a compile of `mainFile` with `engine` depends on, as far as a stat can tell; null when it cannot be computed */
export function projectFingerprint(root: string, mainFile: string, engine: string): string | null {
	const h = crypto.createHash('sha1');
	try {
		h.update(engine + '\0' + mainFile + '\0' + fs.readFileSync(path.join(root, mainFile), 'utf8'));
	} catch {
		return null;
	}
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

const snapDir = (outAbs: string, mainFile: string) => path.join(outAbs, SNAP, sha1(mainFile.replace(/\\/g, '/')).slice(0, 16));

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

/** Keeps a good compile's result and products for `mainFile` under that fingerprint. Never fails the compile. */
export function saveSnapshot(outAbs: string, mainFile: string, fp: string | null, result: unknown): void {
	if (!fp) return;
	const dir = snapDir(outAbs, mainFile);
	try {
		fs.rmSync(dir, { recursive: true, force: true });
		const files = path.join(dir, 'files');
		for (const r of products(outAbs)) {
			const to = path.join(files, r);
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.copyFileSync(path.join(outAbs, r), to);
		}
		fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
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

/** The kept result of `mainFile` when its fingerprint is still `fp`, with its products put back in `_draft`; else null. */
export function restoreSnapshot<T>(outAbs: string, mainFile: string, fp: string | null): T | null {
	if (!fp) return null;
	const dir = snapDir(outAbs, mainFile);
	try {
		if (fs.readFileSync(path.join(dir, 'fingerprint'), 'utf8') !== fp) return null;
		const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) as T;
		// the other profile's products go first, so nothing of it is read as this one's
		for (const r of products(outAbs)) fs.rmSync(path.join(outAbs, r), { force: true });
		const files = path.join(dir, 'files');
		const walk = (rel: string) => {
			for (const e of fs.readdirSync(path.join(files, rel), { withFileTypes: true })) {
				const r = rel ? `${rel}/${e.name}` : e.name;
				if (e.isDirectory()) walk(r);
				else {
					fs.mkdirSync(path.dirname(path.join(outAbs, r)), { recursive: true });
					fs.copyFileSync(path.join(files, r), path.join(outAbs, r));
				}
			}
		};
		if (fs.existsSync(files)) walk('');
		const now = new Date();
		fs.utimesSync(dir, now, now);
		return result;
	} catch {
		return null;
	}
}
