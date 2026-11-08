// LatexFrog: Live's first compile starts from what the profile's full build already wrote.
// A fresh _draft/ has no .aux and no .bbl, so the first Live compile pays one extra pass for the
// missing aux and up to two more for the bibliography (measured on the book: ~25 s each). The
// sidecar's build of the same profile left `.latexfrog/build/<profile>/lv-<profile>.aux`, the
// parts' `.aux` beside it and the `.bbl`: copied under Live's jobname, the first compile is one pass.
import * as path from 'node:path';
import * as fs from 'node:fs';

const LIVE_DRIVER = /^\.latexfrog\/drivers\/lv-(.+)-live\.tex$/;

/** the profile whose Live driver this is (`.latexfrog/drivers/lv-<profile>-live.tex`), else null */
export function profileOfLiveDriver(mainFile: string): string | null {
	return LIVE_DRIVER.exec(mainFile.replace(/\\/g, '/'))?.[1] ?? null;
}

/** the build folder to seed from: the profile's own, else the newest full build of another profile */
function seedDir(root: string, profile: string): string | null {
	const builds = path.join(root, '.latexfrog', 'build');
	const has = (p: string) => fs.existsSync(path.join(builds, p, `lv-${p}.aux`));
	if (has(profile)) return profile;
	let best: { p: string; t: number } | null = null;
	let names: string[] = [];
	try {
		names = fs.readdirSync(builds);
	} catch {
		return null;
	}
	for (const p of names) {
		// the bake compiles every part with figure-list flags, `live` is Live's own preamble copies
		if (p === 'cocina' || p === 'live' || !has(p)) continue;
		const t = fs.statSync(path.join(builds, p, `lv-${p}.aux`)).mtimeMs;
		if (!best || t > best.t) best = { p, t };
	}
	return best?.p ?? null;
}

function copyTree(from: string, to: string, ext: string, depth = 0): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(from, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const src = path.join(from, e.name);
		const dst = path.join(to, e.name);
		if (e.isDirectory() && depth < 8) copyTree(src, dst, ext, depth + 1);
		else if (e.isFile() && e.name.endsWith(ext) && !fs.existsSync(dst)) {
			fs.mkdirSync(to, { recursive: true });
			fs.copyFileSync(src, dst);
		}
	}
}

/** another profile's aux, parts' aux and bbl, so the seed puts this profile's in their place */
function dropAux(outAbs: string, rel = '', depth = 0): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(path.join(outAbs, rel), { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const r = path.join(rel, e.name);
		if (e.isDirectory()) {
			if (!(depth === 0 && e.name === 'snap') && depth < 8) dropAux(outAbs, r, depth + 1);
		} else if (e.name.endsWith('.aux') || (depth === 0 && e.name === 'draft.bbl')) fs.rmSync(path.join(outAbs, r), { force: true });
	}
}

/** Seeds `_draft/draft.aux`, the parts' `.aux` and `draft.bbl` from the profile's build when Live has none yet, or has another
 *  profile's (Live switched profiles). Returns whether the main aux was seeded. Never overwrites what Live already wrote. */
export function seedDraftFromProfile(root: string, outAbs: string, mainFile: string): boolean {
	const profile = profileOfLiveDriver(mainFile);
	if (!profile) return false;
	// the products in _draft are of the profile Live compiled last: another profile's aux would cost a rerun for its labels
	const marker = path.join(outAbs, '.lv-profile');
	let last: string | null = null;
	try {
		last = fs.readFileSync(marker, 'utf8');
	} catch {
		/* none yet */
	}
	const switched = last !== null && last !== profile;
	try {
		fs.mkdirSync(outAbs, { recursive: true });
		fs.writeFileSync(marker, profile);
	} catch {
		/* the seed still works without it */
	}
	if (!switched && fs.existsSync(path.join(outAbs, 'draft.aux'))) return false;
	try {
		const dir = seedDir(root, profile);
		if (!dir) return false;
		const from = path.join(root, '.latexfrog', 'build', dir);
		if (switched) dropAux(outAbs);
		// the parts first: the main aux `\@input`s them
		for (const e of fs.readdirSync(from, { withFileTypes: true }))
			if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(outAbs, e.name), '.aux');
		const bbl = path.join(from, `lv-${dir}.bbl`);
		if (fs.existsSync(bbl) && !fs.existsSync(path.join(outAbs, 'draft.bbl'))) fs.copyFileSync(bbl, path.join(outAbs, 'draft.bbl'));
		fs.copyFileSync(path.join(from, `lv-${dir}.aux`), path.join(outAbs, 'draft.aux'));
		return true;
	} catch {
		return false;
	}
}
