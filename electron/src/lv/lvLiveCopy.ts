// Live on a LatexFrog profile reads the body of the file that opens the document from a copy the sidecar writes
// (`.latexfrog/build/<profile>/lv-<profile>-live-resto.tex`, `driver-for-live` in docs/protocol.md), with the original's line
// numbers; its `.origen` names the original. A pass's products name the copy, so the preview could not find an edited
// paragraph of that file by its line, nor SyncTeX its place. This puts the original's name back, as Texpile does for its own
// warm body.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

type Copy = { copy: string; original: string };

/** the live copies under `root`, relative to it with forward slashes */
function liveCopies(root: string): Copy[] {
	const build = path.join(root, '.latexfrog', 'build');
	let profiles: string[];
	try {
		profiles = fs.readdirSync(build);
	} catch {
		return [];
	}
	const out: Copy[] = [];
	for (const p of profiles) {
		const base = `lv-${p}-live-resto`;
		try {
			const original = fs.readFileSync(path.join(build, p, `${base}.origen`), 'utf8').trim().replace(/\\/g, '/');
			if (original) out.push({ copy: `.latexfrog/build/${p}/${base}.tex`, original });
		} catch {
			/* not a Live profile */
		}
	}
	return out;
}

/** renames the copy in the pass's source files and files read (engine basenames, lowercase), its counters and its
 *  SyncTeX */
export function aliasLiveCopies(
	root: string,
	outAbs: string,
	srcFiles: string[] | undefined,
	counters: { f?: string }[],
	inputs?: string[]
): void {
	const copies = liveCopies(root);
	if (!copies.length) return;
	const byBase = new Map(copies.map((c) => [path.posix.basename(c.copy).toLowerCase(), path.posix.basename(c.original).toLowerCase()]));
	const alias = (f: string) => byBase.get(f.toLowerCase()) ?? f;
	for (const names of [srcFiles, inputs]) if (names) for (let i = 0; i < names.length; i++) names[i] = alias(names[i]);
	for (const c of counters) if (c.f) c.f = alias(c.f);
	const p = path.join(outAbs, 'draft.synctex.gz');
	try {
		let txt = zlib.gunzipSync(fs.readFileSync(p)).toString('latin1');
		let changed = false;
		for (const c of copies) {
			// SyncTeX writes the root, then ./ and the path as TeX opened it; on Windows the root ends in a backslash
			for (const sep of ['/', '\\']) {
				const named = `${sep}./${c.copy}`;
				if (!txt.includes(named)) continue;
				txt = txt.split(named).join(`${sep}${c.original}`);
				changed = true;
			}
		}
		if (changed) fs.writeFileSync(p, zlib.gzipSync(Buffer.from(txt, 'latin1')));
	} catch {
		/* no SyncTeX: forward sync degrades, records are already renamed */
	}
}
