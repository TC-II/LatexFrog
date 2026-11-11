// Runs ONE full engine compile of the user's main file and returns its pages -- nothing
// else. The job string injects the page-extract.lua shipout hook (contained in _draft/,
// source never touched); the result is the engine's manifest + per-page records, with
// image filenames (draftImages) and Type1 font paths (fontT1Map) attached, the
// bibliography cycled between passes (draftBib), and refs exported for the warm daemon
// (draftRefs). Same engine as the user's own compile, so exact by construction.
import { seedDraftFromProfile } from '../lv/draftSeed';
import { primeFromKept, restoreSnapshot, saveSnapshot, startSnapshot } from '../lv/draftSnapshot';
import { repairCutAux } from '../lv/draftAux';
import { liveExecFile as execFile, type LiveProcess } from '../lv/lvLive';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { resolveType1Line } from '../fontT1Map';
import { seedBbl, auxCycle } from './draftBib';
import { exportDaemonRefs } from './draftRefs';
import { readImageUses, attachImageFiles } from './draftImages';
import { jobPrefix, mirrorSourceFolders, writeHooksFile } from './compileJob';
import {
	splitForWarm,
	takeWarmCompiler,
	goWarmCompiler,
	rewarmCompiler,
	aliasSynctex,
	WARM_BODY,
	type ReadBackFiles
} from './draftWarmCompile';
import { shellEnvReady } from '../shell/shellEnv';
import { aliasLiveCopies } from '../lv/lvLiveCopy';
import { findProgram } from '../shell/findProgram';

// ht = the shipout box HEIGHT = distance from box top to the box baseline, which is the
// FOOTER line's baseline -- the renderer uses it to keep bottom-anchored footers out of
// patch shifts (h additionally includes the box depth below that baseline)
// unc = the walker's certification reasons for this page (comma-joined: literal, transform,
// escape, dir), absent when it is fully record-renderable
// gs/gsn/go = the shipped vpack's glue_set/sign/order: gsn 1 means the page was stretched
// to \textheight (flushbottom) and a patch's delta distributes over its vg records
export type DraftPage = {
	n: number;
	w: number;
	h: number;
	ht?: number;
	gs?: number;
	gsn?: number;
	go?: number;
	unc?: string;
	// the walker's own proof for this page: how far its pen finished from the engine's line
	// width on the worst justified line. Measured 0.0000 on every page of every fixture, so a
	// nonzero value is an anomaly worth seeing, not a tolerance to tune.
	dev?: number;
	records: string;
};
export type DraftResult =
	| {
			ok: true;
			ms: number;
			count: number;
			passes: number;
			paperW: number;
			paperH: number;
			colW: number;
			textW: number;
			footSkip: number;
			// engine registers the renderer used to guess: \columnsep, \baselineskip, \parskip
			colSep: number;
			blSkip: number;
			parSkip: number;
			// \topskip: where a column's first baseline lands (chain-planner landing rule)
			topSkip: number;
			// \lineskiplimit: where TeX switches the interline glue from \baselineskip to \lineskip
			lsLimit: number;
			// the files whose paragraphs were stamped, in id order: a line record's "sf" is a
			// 1-based index into this. Line numbers are file-local, so the id is what makes
			// "line 45" mean anything in a multi-file project.
			srcFiles: string[];
			// LatexFrog: every file the pass read a line of (engine basenames, lowercase); absent from an older engine
			inputs?: string[];
			// the line \begin{document} executed at (in the main file), from the hook itself
			bodyLine?: number;
			// per-line counter snapshots (see page-extract.lua): the daemon pins to these
			counters: { l: number; f?: string; s: Record<string, number> }[];
			// per-break pruned runs (see page-extract.lua seam capture): the material TeX
			// discarded at each column/page break, keyed by page + 1-based column index
			seams: { page: number; col: number; fire?: number; pen: number; run: Record<string, number>[] }[];
			// every paragraph's parameters at its line break, by the serial its lines carry (see page-extract.lua)
			paras: Record<string, unknown>[];
			marginX: number;
			marginY: number;
			pages: DraftPage[];
	  }
	/** error 'engine-missing' names the program in `tool` */
	| { ok: false; error: string; ms: number; log?: string; superseded?: true; tool?: string; errors?: number; first?: string };

/** LatexFrog: a log's TeX errors -- how many, and the first one with its input line ("l.363") -- or null when it has none */
export function texErrors(log: string): { count: number; first: string } | null {
	const lines = log.split(/\r?\n/);
	let count = 0;
	let first = '';
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!l.startsWith('! ') || /^!\s+==> Fatal error/.test(l) || /^! Emergency stop/.test(l)) continue;
		count++;
		if (first) continue;
		first = l.slice(2).trim();
		for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
			const at = /^l\.(\d+)/.exec(lines[j]);
			if (at) {
				first += ` (l.${at[1]})`;
				break;
			}
		}
	}
	return count ? { count, first } : null;
}

type DraftBody = { root: string; mainFile: string; engineDir: string; engine?: string; readBack: ReadBackFiles };

const OUT = '_draft';

// Cancel-on-supersede: a newer compileDraft for the SAME root kills that root's in-flight
// lualatex so a hung/slow compile can't hold the 120s pass timeout and stick the preview --
// the editor just fires the fresh compile and the stale one bails. gen is the monotonic run
// id per root; a run is superseded once its root's gen moves past it. Keyed per root so one
// window's compile can never cancel another window's.
// LatexFrog: `doc` is the document (the driver's text) whose products _draft holds and the parked warm engine read at its
// \begin{document}; null while a compile runs or after one that did not finish
type CompileRun = { gen: number; child: LiveProcess | null; doc?: string | null };
const compileRuns = new Map<string, CompileRun>();
function runFor(root: string): CompileRun {
	const key = process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
	let r = compileRuns.get(key);
	if (!r) {
		r = { gen: 0, child: null };
		compileRuns.set(key, r);
	}
	return r;
}

// TeX places the shipped page's reference point 1in (72.27pt) from the paper's top-left
// by default; the extracted box coords are relative to that point.
const ONE_INCH_PT = 72.27;

export async function compileDraft(body: DraftBody): Promise<DraftResult> {
	await shellEnvReady();
	const { root, mainFile } = body;
	const engineDir = body.engineDir.replace(/\\/g, '/');
	const engine = body.engine || 'lualatex';
	// a missing engine says so by name, so the pane can point at the Toolchain folders instead of an empty result
	if (!findProgram(engine)) return { ok: false, error: 'engine-missing', tool: engine, ms: 0 };
	const outAbs = path.join(root, OUT);
	// supersede any in-flight compile of THIS root: kill its lualatex so this fresh run
	// isn't stuck behind it (other roots' compiles are untouched)
	const run = runFor(root);
	const gen = ++run.gen;
	if (run.child) {
		try {
			run.child.kill('SIGKILL');
		} catch {
			/* already gone */
		}
		run.child = null;
	}
	function superseded(): boolean {
		return gen !== run.gen;
	}
	fs.mkdirSync(outAbs, { recursive: true });
	mirrorSourceFolders(root, outAbs);
	// self-ignoring build dir: users' projects are usually git repos, and the preview's
	// artifacts must never end up staged in them
	const gi = path.join(outAbs, '.gitignore');
	if (!fs.existsSync(gi)) {
		try {
			fs.writeFileSync(gi, '*\n');
		} catch {
			/* ignore */
		}
	}
	// clear stale page files so a shorter document doesn't keep orphaned pages
	for (const f of fs.readdirSync(outAbs))
		if (/^page-\d+\.jsonl$/.test(f) || f === 'pages.json' || f === 'counters.jsonl' || f === 'seams.jsonl' || f === 'paras.jsonl') {
			try {
				fs.rmSync(path.join(outAbs, f));
			} catch {
				/* ignore */
			}
		}

	// forward-slash the input path for TeX; keep it relative to the compile cwd (root)
	const mainRel = mainFile.replace(/\\/g, '/');
	writeHooksFile(outAbs);
	const job = `${jobPrefix(engineDir)}\\input{${mainRel}}`;
	// A pre-warmed engine (preamble loaded, parked before the body) takes the FIRST pass;
	// extra passes and every fallback go cold. lualatex only: the warm pool spawns that.
	const split = engine === 'lualatex' ? splitForWarm(root, mainFile) : null;
	let warmLeft = split ? takeWarmCompiler(root, split.preamble) : null;
	// LatexFrog: the document _draft was left in by the last compile that finished
	const lastDoc = run.doc ?? null;
	run.doc = null;
	let usedWarm = false;
	function enginePass(): Promise<void> {
		if (superseded()) return Promise.resolve(); // a newer compile already took over
		if (warmLeft && split) {
			const w = warmLeft;
			warmLeft = null;
			usedWarm = true;
			// adopt: a superseded run's partial products must never be promoted over draft.*
			const g = goWarmCompiler(w, root, fs.readFileSync(path.join(root, split.bodyFile), 'utf8'), split.beginLine, () => !superseded());
			run.child = g.child; // a superseding compile of this root kills this to unblock itself
			return g.done.then(() => {
				if (run.child === g.child) run.child = null;
			});
		}
		return new Promise<void>((resolve) => {
			const child = execFile(
				engine,
				// -synctex=1 so the instant path can map a source line to its page box (draft.synctex.gz)
				['-no-shell-escape', '-interaction=nonstopmode', '-synctex=1', `-output-directory=${OUT}`, '-jobname=draft', job],
				{ cwd: root, timeout: 120000 },
				() => {
					if (run.child === child) run.child = null;
					resolve();
				}
			);
			run.child = child; // a superseding compile of this root kills this to unblock itself
			child.on('error', () => {
				if (run.child === child) run.child = null;
				resolve();
			}); // engine not on PATH etc -> handled by the manifest check below
		});
	}

	// the pass products a rerun would read differently: cross-refs and the contents listings
	// LatexFrog: and the aux of each `\include`d part (its labels and counters are there, not in draft.aux), and the .bbl
	const REF_FILES = [...body.readBack.byTex.map((ext) => `draft.${ext}`), 'draft.bbl'];
	function partAux(rel = ''): string[] {
		const out: string[] = [];
		try {
			for (const e of fs.readdirSync(path.join(outAbs, rel), { withFileTypes: true })) {
				const r = rel ? `${rel}/${e.name}` : e.name;
				// `snap/` holds kept results of other documents, not what the next pass reads
				if (e.isDirectory()) out.push(...(r === 'snap' ? [] : partAux(r)));
				else if (rel && e.name.endsWith('.aux')) out.push(r);
			}
		} catch {
			/* no such folder */
		}
		return out.sort();
	}
	function refState(): string {
		return [...REF_FILES, ...partAux()].map((f) => {
			try {
				return crypto
					.createHash('sha1')
					.update(fs.readFileSync(path.join(outAbs, f)))
					.digest('hex');
			} catch {
				return '';
			}
		}).join(' ');
	}
	const t0 = Date.now();
	// LatexFrog: a first compile starts from the profile's full build (aux, parts' aux, bbl): one pass instead of up to four
	seedDraftFromProfile(root, outAbs, mainFile);
	// LatexFrog: back to a document (a profile, a chapter of it) whose sources did not change since its last good compile:
	// its kept result, no TeX
	const snapshot = startSnapshot(root, mainFile, engine);
	const kept = restoreSnapshot<DraftResult>(root, outAbs, mainFile, snapshot);
	if (kept && kept.ok) {
		run.doc = snapshot.key;
		exportDaemonRefs(outAbs);
		if (engine === 'lualatex') rewarmCompiler(root, mainFile, engineDir, body.readBack);
		return { ...kept, ms: Date.now() - t0 };
	}
	// LatexFrog: another document than the last one (another chapter, another profile), kept before: its own aux, contents
	// and bibliography go back in place of the other document's. The parked warm engine read the other document's at its
	// \begin{document}, so its pass would print this one with those references and ask for another; a cold pass reads the
	// right ones and is the only one needed. Measured on the book, coming back to an edited chapter: 8.5 s (a warm pass,
	// biber and two cold passes) against one cold pass.
	if (snapshot.key !== lastDoc && primeFromKept(outAbs, snapshot) && warmLeft) {
		try {
			warmLeft.child.kill('SIGKILL');
		} catch {
			/* already gone */
		}
		warmLeft = null;
	}
	// LatexFrog: a pass killed by a newer one (a quick switch of chapter) leaves its .aux cut mid-line; TeX stops on that
	repairCutAux(outAbs);
	const auxExisted = fs.existsSync(path.join(outAbs, 'draft.aux'));
	const refsBefore = refState();
	seedBbl(root, outAbs, mainFile);
	await enginePass();
	if (superseded()) return { ok: false, error: 'superseded', ms: Date.now() - t0, superseded: true };
	let passes = 1;
	// aux cycle: bibliography tools + the classic reruns. A changed .bbl needs up to TWO
	// extra passes (classic bibtex chain: bbl read in pass 2 writes \bibcite to the aux,
	// \cite resolves in pass 3); a missing aux (first-ever compile) needs one, so
	// \cite/\ref/\tableofcontents see the freshly written aux/toc. Ordinary text edits
	// keep the .bbl stable (bcf-hash + mtime guards) and stay single-pass.
	const bblChanged = await auxCycle(root, outAbs, mainFile);
	// LatexFrog: with biber the pass after it reads the .bbl and prints the citations at once; only bibtex needs the second
	// one, to carry \bibcite through the aux. If biblatex still wants a pass it says so, and the check below runs it.
	const extra = bblChanged ? (fs.existsSync(path.join(outAbs, 'draft.bcf')) ? 1 : 2) : !auxExisted ? 1 : 0;
	// LatexFrog: what the last pass started from. A rerun reads what that pass wrote; when it wrote what it had read, a rerun
	// prints the same pages, whatever the log asks. Compared with the state before the whole compile instead, a first visit
	// to a chapter (another chapter's aux before it) always looked changed and took a third pass: 3.3 s on the book.
	let refsBeforeLast = refsBefore;
	for (let i = 0; i < extra && !superseded(); i++) {
		refsBeforeLast = refState();
		await enginePass();
		passes++;
	}
	if (superseded()) return { ok: false, error: 'superseded', ms: Date.now() - t0, superseded: true };
	// engine-announced rerun: the last pass complained about products it writes itself (a
	// \tableofcontents with no .toc yet -- a stale aux from an aborted run skips the
	// missing-aux pass above -- moved labels, undefined \ref/\cite) AND those files
	// actually changed. One bounded pass; the changed-guard keeps a genuinely broken
	// \ref from rerunning forever.
	{
		let log = '';
		try {
			log = fs.readFileSync(path.join(outAbs, 'draft.log'), 'utf8');
		} catch {
			// no log, no signal
		}
		const complained = /No file draft\.(toc|lof|lot)\.|Label\(s\) may have changed|There were undefined references|Please rerun LaTeX/.test(log);
		if (complained && refState() !== refsBeforeLast) {
			await enginePass();
			passes++;
		}
	}
	if (superseded()) return { ok: false, error: 'superseded', ms: Date.now() - t0, superseded: true };
	exportDaemonRefs(outAbs);
	const ms = Date.now() - t0;
	// Warm the NEXT pass now: every product this compile reads has been read (aux cycle,
	// refs, log checks), and the warm process runs under its own jobname so nothing the app
	// reads after this return is touched. Also on the failure path -- a body typo does not
	// invalidate the preamble, and the next attempt deserves the same head start.
	const rewarm = () => {
		if (engine === 'lualatex') rewarmCompiler(root, mainFile, engineDir, body.readBack);
	};

	const manifestPath = path.join(outAbs, 'pages.json');
	if (!fs.existsSync(manifestPath)) {
		let full = '';
		try {
			full = fs.readFileSync(path.join(outAbs, 'draft.log'), 'utf8');
		} catch {
			/* no log */
		}
		const log = full
			.split('\n')
			.filter((l) => /^!|error/i.test(l))
			.slice(-12)
			.join('\n');
		rewarm();
		// LatexFrog: the engine ran and the document stopped it (TeX gives up at 100 errors): say that, with the
		// first error, instead of suggesting lualatex is missing. The Problems panel lists them all from the log.
		const tex = texErrors(full);
		if (tex) return { ok: false, error: 'tex-errors', errors: tex.count, first: tex.first, ms, log };
		return { ok: false, error: 'Draft compile produced no pages (is lualatex on PATH? see _draft/draft.log)', ms, log };
	}

	let manifest: {
		count: number;
		paperW?: number;
		paperH?: number;
		colW?: number;
		bodyLine?: number;
		pages: { n: number; w: number; h: number; ht?: number; gs?: number; gsn?: number; go?: number; unc?: string; dev?: number }[];
	};
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	} catch (e) {
		return { ok: false, error: 'Draft manifest unreadable: ' + (e instanceof Error ? e.message : String(e)), ms };
	}

	// counter-truth sidecar: per-line snapshots the renderer pins daemon typesets to
	let counters: { l: number; f?: string; s: Record<string, number> }[] = [];
	try {
		counters = fs
			.readFileSync(path.join(outAbs, 'counters.jsonl'), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((ln) => JSON.parse(ln));
	} catch {
		/* older engine bridge or an empty log: pins fall back to fixed values */
	}

	// A warm first pass read the body from the padded _draft file, so single-pass products
	// name it where a cold pass names the main file (line numbers already agree -- that is
	// what the padding buys). Put the main file's name back so nothing downstream can tell
	// which kind of pass ran. Multi-pass compiles end on a cold pass and alias nothing.
	if (usedWarm && split && passes === 1) {
		// the body's own file: the main file, or the one it \input's that holds \begin{document}
		const mainBase = path.basename(split.bodyFile);
		// the padded body reads as texd-body.tex, and anything read via \jobname (the seeded
		// bbl, an .ind) as texd_warm.*; a cold pass names main.tex and draft.* there
		const alias = (f: string): string => {
			const lower = f.toLowerCase();
			if (lower === WARM_BODY.toLowerCase()) return mainBase.toLowerCase();
			if (lower.startsWith('texd_warm.')) return 'draft.' + f.slice('texd_warm.'.length);
			return f;
		};
		const sf = (manifest as { srcFiles?: string[] }).srcFiles;
		if (sf) for (let i = 0; i < sf.length; i++) sf[i] = alias(sf[i]);
		// LatexFrog: the warm engine read the main file's preamble as its own wrapper's text, not from the file
		const inputs = (manifest as { inputs?: string[] }).inputs;
		if (inputs) {
			for (let i = 0; i < inputs.length; i++) inputs[i] = alias(inputs[i]);
			inputs.push(path.basename(mainRel).toLowerCase());
		}
		for (const c of counters) if (c.f) c.f = alias(c.f);
		// begindoc fired inside the warm wrapper, so its line number names the wrong file
		manifest.bodyLine = split.beginLine;
		aliasSynctex(outAbs, split.bodyFile);
	}
	// LatexFrog: a profile's Live driver reads the opening file's body from a copy; name the original
	aliasLiveCopies(root, outAbs, (manifest as { srcFiles?: string[] }).srcFiles, counters, (manifest as { inputs?: string[] }).inputs);

	// seam sidecar: per-break pruned runs; absent (older engine, luatexbase missing) means
	// the chain planner falls back to its guessed junction gap and stays provisional
	let seams: { page: number; col: number; fire?: number; pen: number; run: Record<string, number>[] }[] = [];
	try {
		seams = fs
			.readFileSync(path.join(outAbs, 'seams.jsonl'), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((ln) => JSON.parse(ln));
	} catch {
		/* no seams: junction gaps stay guessed */
	}

	let paras: Record<string, unknown>[] = [];
	try {
		paras = fs
			.readFileSync(path.join(outAbs, 'paras.jsonl'), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((ln) => JSON.parse(ln));
	} catch {
		/* none recorded: edits typeset in the document's own defaults and the band proof decides */
	}

	const imageUses = readImageUses(outAbs);
	const pages: DraftPage[] = [];
	for (let n = 1; n <= manifest.count; n++) {
		const p = path.join(outAbs, `page-${String(n).padStart(3, '0')}.jsonl`);
		const meta = manifest.pages[n - 1] || { n, w: 0, h: 0 };
		let records = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
		if ((imageUses.length && records.includes('"t":"image"')) || records.includes('"t":"font"')) {
			const lines = records.split('\n');
			attachImageFiles(lines, imageUses, root);
			// font resolution spawns kpsewhich (async; a sync spawn here froze the app's UI)
			await Promise.all(
				lines.map(async (ln, i) => {
					if (ln.startsWith('{"t":"font"')) lines[i] = await resolveType1Line(ln);
				})
			);
			records = lines.join('\n');
		}
		pages.push({ n, w: meta.w, h: meta.h, ht: meta.ht, gs: meta.gs, gsn: meta.gsn, go: meta.go, unc: meta.unc, dev: meta.dev, records });
	}

	// some classes never set the engine's page-dimension registers, leaving paperW/H = 0 in the
	// manifest (the preview would render zero-sized pages): fall back to the shipped page BOX
	// dims (always known at shipout) plus the 1in reference margins
	const maxPageW = manifest.pages.length ? Math.max(...manifest.pages.map((p) => p.w || 0)) : 0;
	const maxPageH = manifest.pages.length ? Math.max(...manifest.pages.map((p) => p.h || 0)) : 0;
	rewarm();
	const result: DraftResult = {
		ok: true,
		ms,
		passes,
		count: manifest.count,
		paperW: manifest.paperW || (maxPageW ? maxPageW + 2 * ONE_INCH_PT : 0),
		paperH: manifest.paperH || (maxPageH ? maxPageH + 2 * ONE_INCH_PT : 0),
		colW: manifest.colW || 0,
		textW: (manifest as { textW?: number }).textW || 0,
		footSkip: (manifest as { footSkip?: number }).footSkip || 0,
		colSep: (manifest as { colSep?: number }).colSep || 0,
		blSkip: (manifest as { blSkip?: number }).blSkip || 0,
		parSkip: (manifest as { parSkip?: number }).parSkip || 0,
		topSkip: (manifest as { topSkip?: number }).topSkip || 0,
		lsLimit: (manifest as { lsLimit?: number }).lsLimit || 0,
		srcFiles: (manifest as { srcFiles?: string[] }).srcFiles || [],
		inputs: (manifest as { inputs?: string[] }).inputs,
		bodyLine: manifest.bodyLine,
		counters,
		seams,
		paras,
		// the page's reference point: TeX's 1in default MOVED by the document's own
		// \hoffset/\voffset, instead of assuming every document leaves them at zero
		marginX: ONE_INCH_PT + ((manifest as { hOffset?: number }).hOffset || 0),
		marginY: ONE_INCH_PT + ((manifest as { vOffset?: number }).vOffset || 0),
		pages
	};
	// a compile a newer one superseded while its pages were read is not the state of the sources
	if (!superseded()) {
		run.doc = snapshot.key;
		saveSnapshot(root, outAbs, mainFile, engine, snapshot, result);
	}
	return result;
}
