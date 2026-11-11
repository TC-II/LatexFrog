// Keeps the draft compile's BIBLIOGRAPHY fresh between passes -- nothing else.
// Seeds a shipped .bbl under the draft jobname, reruns biber/bibtex only when their
// inputs actually changed, and reports whether the .bbl moved (= the pass is stale).
import { liveExecFile as execFile } from '../lv/lvLive';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { shellEnvReady } from '../shell/shellEnv';

const OUT = '_draft';

// biber is slow (~1-3s), so rerun it only when what it reads changed (the citation set, a .bib),
// not on every keystroke's recompile.
// LatexFrog: what the .bbl in _draft was made from is written beside it (`draft.bcfhash`), not remembered once per root.
// Live goes back and forth between documents (chapters, profiles), each with its own citations: one remembered hash
// was always the other chapter's, so biber ran again on every switch (1.1 s on the book), also when a kept result's
// .bbl had just been put back. The file travels with the .bbl it describes. It also covers the .bib files the .bcf
// names: an edited .bib used to reach Live only when the citations changed too.
const BCF_MEMO = 'draft.bcfhash';

/** what biber would read: the control file and the size and mtime of each data source it names */
export function biberInputs(root: string, bcf: Buffer): string {
	const h = crypto.createHash('sha1').update(bcf);
	for (const m of bcf.toString('utf8').matchAll(/<bcf:datasource[^>]*>([^<]+)<\/bcf:datasource>/g)) {
		const name = m[1].trim();
		let stat = 'absent';
		for (const candidate of [name, name + '.bib']) {
			try {
				const st = fs.statSync(path.resolve(root, candidate));
				stat = `${st.size} ${st.mtimeMs}`;
				break;
			} catch {
				/* not under this name */
			}
		}
		h.update(`\0${name}\0${stat}`);
	}
	return h.digest('hex');
}

function sha1(buf: Buffer | string): string {
	return crypto.createHash('sha1').update(buf).digest('hex');
}
function mtimeOf(p: string): number {
	try {
		return fs.statSync(p).mtimeMs;
	} catch {
		return 0;
	}
}
function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
	return new Promise((resolve) => {
		const child = execFile(cmd, args, { ...opts, timeout: 90000 }, () => resolve());
		child.on('error', () => resolve()); // tool missing -> citations just stay unresolved
	});
}

// arXiv-style papers ship <main>.bbl with no .bib; seed it under our jobname so the
// FIRST pass already processes the bibliography (else cites need a third pass)
export function seedBbl(root: string, outAbs: string, mainFile: string): void {
	const bbl = path.join(outAbs, 'draft.bbl');
	// seed candidates: <main>.bbl (arXiv convention), the \bibliography{NAME} arg's NAME.bbl,
	// or a lone .bbl in the root -- shipped bibliographies don't always follow the jobname
	const cands: string[] = [path.join(root, path.basename(mainFile, '.tex') + '.bbl')];
	try {
		const src = fs.readFileSync(path.join(root, mainFile), 'utf8');
		const m = src.match(/\\bibliography\{([^}]+)\}/);
		if (m) for (const b of m[1].split(',')) cands.push(path.join(root, b.trim() + '.bbl'));
	} catch {
		/* main unreadable -> the compile will fail its own way */
	}
	try {
		const all = fs.readdirSync(root).filter((f) => f.endsWith('.bbl'));
		if (all.length === 1) cands.push(path.join(root, all[0]));
	} catch {
		/* ignore */
	}
	const seed = cands.find((c) => {
		try {
			return fs.statSync(c).size > 0;
		} catch {
			return false;
		}
	});
	if (!seed) return;
	// (re)seed when the draft bbl is absent, empty, gutted (no entries -- e.g. clobbered by a
	// failed bibtex), or older than a regenerated seed
	try {
		const cur = fs.existsSync(bbl) ? fs.statSync(bbl) : null;
		const curOk = !!cur && cur.size > 0 && /\\bibitem|\\entry/.test(fs.readFileSync(bbl, 'utf8'));
		if (curOk && cur!.mtimeMs >= fs.statSync(seed).mtimeMs) return;
		fs.copyFileSync(seed, bbl);
	} catch {
		/* ignore */
	}
}

// The aux cycle (latexmk-lite): run biber (biblatex) when the .bcf changed, or bibtex
// (\bibdata in the aux) when the .bbl is missing/stale. Returns whether the .bbl changed.
export async function auxCycle(root: string, outAbs: string, mainFile: string): Promise<boolean> {
	await shellEnvReady();
	const bbl = path.join(outAbs, 'draft.bbl');
	// LatexFrog: by content only -- biber rewriting the same .bbl (a fresh _draft, a seeded one) is no reason for two more passes
	const bblBefore = fs.existsSync(bbl) ? sha1(fs.readFileSync(bbl)) : '';
	seedBbl(root, outAbs, mainFile);
	const bcf = path.join(outAbs, 'draft.bcf');
	const aux = path.join(outAbs, 'draft.aux');
	const auxText = fs.existsSync(aux) ? fs.readFileSync(aux, 'utf8') : '';
	if (fs.existsSync(bcf)) {
		const h = biberInputs(root, fs.readFileSync(bcf));
		const memo = path.join(outAbs, BCF_MEMO);
		let made = '';
		try {
			made = fs.readFileSync(memo, 'utf8');
		} catch {
			/* biber has not run for this _draft */
		}
		if (made !== h || !fs.existsSync(bbl)) {
			// biblatex: biber reads _draft/draft.bcf; datasource paths in the .bcf are as
			// written in \addbibresource (root-relative), so run from root
			await run('biber', ['--input-directory', OUT, '--output-directory', OUT, 'draft'], { cwd: root });
			try {
				fs.writeFileSync(memo, h);
			} catch {
				/* biber runs again next time */
			}
		}
	} else if (/\\bibdata\{/.test(auxText)) {
		// classic bibtex: runs inside the output dir (reads draft.aux there); .bib/.bst
		// live in the project root, reachable via BIBINPUTS/BSTINPUTS (trailing separator
		// keeps the default search paths)
		const bibs = fs
			.readdirSync(root)
			.filter((f) => f.endsWith('.bib'))
			.map((f) => mtimeOf(path.join(root, f)));
		const stale = !fs.existsSync(bbl) || (bibs.length > 0 && Math.max(...bibs) > mtimeOf(bbl));
		if (stale && bibs.length > 0) {
			const prev = fs.existsSync(bbl) ? fs.readFileSync(bbl) : null;
			await run('bibtex', ['draft'], {
				cwd: outAbs,
				env: { ...process.env, BIBINPUTS: root + path.delimiter, BSTINPUTS: root + path.delimiter }
			});
			// a failed bibtex (missing .bst, broken .bib) can leave an empty/gutted bbl and the
			// mtime guards would then keep it forever: never let it clobber a working one
			const ok = fs.existsSync(bbl) && /\\bibitem/.test(fs.readFileSync(bbl, 'utf8'));
			if (!ok && prev && /\\bibitem/.test(prev.toString())) {
				try {
					fs.writeFileSync(bbl, prev);
				} catch {
					/* ignore */
				}
			}
		}
	}
	const bblAfter = fs.existsSync(bbl) ? sha1(fs.readFileSync(bbl)) : '';
	return bblAfter !== bblBefore;
}
