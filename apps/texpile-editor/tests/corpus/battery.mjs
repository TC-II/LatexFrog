// Exhaustive per-project battery through lv-sidecar. Never throws: every step is guarded and recorded.
// node battery.mjs <work dir> <out json> [rootFile] [--skip-compile] [--timeout=ms]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startSidecar } from './sc.mjs';

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]));
const [dirArg, outFile, rootArg] = argv.filter((a) => !a.startsWith('--'));
const root = path.resolve(dirArg).replace(/\\/g, '/');
const id = path.basename(root);
const CT = Number(flags.timeout || 240000);
const R = { id, rootArg: rootArg ?? null, steps: {}, findings: [] };
// severity: BUG = the app misbehaves; ENV = missing package/font/tool on this machine; PROJECT = the document itself; INFO
const find = (sev, area, msg, extra) => R.findings.push({ sev, area, msg: String(msg).slice(0, 400), ...(extra ? { extra } : {}) });
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));
const t0 = Date.now();

const s = startSidecar(process.env.LV_SIDECAR);
const guard = async (name, fn) => {
	const t = Date.now();
	try { R.steps[name] = (await fn()) ?? true; }
	catch (e) { R.steps[name] = { error: String(e).slice(0, 300) }; find('BUG', name, `step threw: ${String(e).slice(0, 200)}`); }
	R.steps[name + '_ms'] = Date.now() - t;
};
const waitFinished = async (mark, profile, ms = CT) => s.waitEvent((e) => e.type === 'finished' && (!profile || e.profile === profile) && s.events.indexOf(e) >= mark, ms);
const logSince = (mark) => s.events.slice(mark).filter((e) => e.type === 'log').map((e) => e.text).join('');
const ENV_PAT = /File [`']([^'`]+\.(sty|cls|def|cfg|clo|bst|tfm|fd))' not found|font "([^"]+)" cannot be found|requires either XeTeX or LuaTeX|Package '[^']+' incompatible|hevea|I can't find file|Missing \\begin\{document\}/;
const classify = (log) => {
	const errs = [...log.matchAll(/^(?:[^\n]*?:\d+: )?! (.*)$/gm)].map((m) => m[1]);
	const first = errs[0] ?? '';
	const env = errs.find((e) => /not found|cannot be found|requires either|incompatible|I can't find file|Undefined control sequence/.test(e));
	return { first, errs: errs.slice(0, 4), looksEnv: !!(env || ENV_PAT.test(log)) };
};
const baseline = (engine, mainFile) => {
	const base = path.join(path.dirname(root), '_base-' + id);
	fs.rmSync(base, { recursive: true, force: true });
	fs.cpSync(root, base, { recursive: true, filter: (p) => !/[\\/]\.latexfrog([\\/]|$)/.test(p) && !/[\\/]_draft([\\/]|$)/.test(p) });
	const exe = engine === 'xelatex' ? 'xelatex' : engine === 'lualatex' ? 'lualatex' : 'pdflatex';
	const dir = path.join(base, path.dirname(mainFile));
	const r = spawnSync(exe, ['--disable-installer', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', path.basename(mainFile)], { cwd: dir, timeout: 150000, encoding: 'utf8', env: process.env });
	const out = (r.stdout ?? '') + (r.stderr ?? '');
	const ok = r.status === 0;
	const firstErr = out.match(/^! .*$/m)?.[0] ?? (r.error ? String(r.error) : '');
	fs.rmSync(base, { recursive: true, force: true });
	return { ok, status: r.status, firstErr };
};

let view = null;
let profileIds = [];
try {
	await guard('open', async () => {
		const o = await s.req('open', { root });
		if (!o.ok) { find('BUG', 'open', o.error); throw new Error('open failed: ' + o.error); }
		view = o.data.project;
		let chosen = view.rootFile;
		if (rootArg && view.rootFile && view.rootFile !== rootArg) find('INFO', 'root-detection', `app chose ${view.rootFile}; the largest document is ${rootArg}`);
		if (rootArg && !view.rootFile) {
			const r = await s.req('set-root', { file: rootArg });
			if (!r.ok) find('BUG', 'set-root', r.error); else view = r.data;
			chosen = view.rootFile;
		}
		if (!chosen) find('INFO', 'root-detection', `no root chosen automatically; candidates: ${(view.candidates ?? []).slice(0, 6).join(', ')}`);
		const cp = view.config?.profiles ?? {};
		profileIds = Array.isArray(cp) ? cp.map((p) => p[0] ?? p.id) : Object.keys(cp);
		return { rootFile: view.rootFile, candidates: (view.candidates ?? []).length, candidatesSample: (view.candidates ?? []).slice(0, 5), engine: view.config?.engine, profiles: profileIds, parts: view.parts?.length ?? 0, indexMs: view.indexMs, configError: view.configError ?? null, migration: o.data.migration };
	});
	if (!view?.rootFile) { R.steps.abort = 'no root'; throw new Error('abort'); }
	const rootFile = view.rootFile;

	await guard('detect', async () => {
		const d = await s.req('detect', { root: undefined }, 60000);
		if (!d.ok) { find('BUG', 'detect', d.error); return { error: d.error }; }
		const p = d.data ?? {};
		const proposedRoot = p.rootFile ?? p.root ?? p.root_file;
		if (proposedRoot && proposedRoot !== rootFile) find('INFO', 'detect', `detect proposes ${proposedRoot}, view chose ${rootFile}`);
		return { keys: Object.keys(p), proposedRoot, parts: (p.parts ?? []).length };
	});

	await guard('config-roundtrip', async () => {
		const cfg0 = { root: view.rootFile, ...view.config };
		if (Array.isArray(cfg0.profiles)) cfg0.profiles = Object.fromEntries(cfg0.profiles.map(({ id: pid, publica, ...rest }) => [pid, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null))]));
		const txt = JSON.stringify(cfg0, null, 2);
		const v = await s.req('config-validate', { text: txt });
		if (!v.ok) { find('BUG', 'config-validate', `inferred config does not validate: ${v.error}`); return { error: v.error }; }
		if (v.data && v.data.ok === false) find('BUG', 'config-validate', `the inferred config (view -> file) is rejected: ${(v.data.errores ?? []).join('; ')}`);
		if (v.data && (v.data.errors?.length || v.data.error)) find('BUG', 'config-validate', 'validate reports problems for the inferred config: ' + JSON.stringify(v.data).slice(0, 200));
		return { valid: true, data: JSON.stringify(v.data).slice(0, 200) };
	});

	// ---- content consistency ----
	let symbols = null;
	await guard('content', async () => {
		const sy = await s.req('symbols');
		if (!sy.ok) { find('BUG', 'symbols', sy.error); return { error: sy.error }; }
		const d = (symbols = sy.data);
		const secs = d.sections ?? [];
		let badFile = 0, badLine = 0, badTitle = 0;
		const bad = [];
		for (const sec of secs) {
			if (!exists(sec.file)) { badFile++; bad.push(`${sec.file} missing`); continue; }
			const lines = rd(sec.file).split(/\r?\n/);
			if (sec.line < 1 || sec.line > lines.length) { badLine++; bad.push(`${sec.file}:${sec.line} out of range`); continue; }
			const around = lines.slice(Math.max(0, sec.line - 1), sec.line + 3).join(' ').replace(/\s+/g, ' ');
			const key = (sec.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 8);
			if (key && !around.includes(key) && !/\\(?:chapter|section|subsection|subsubsection|paragraph|subparagraph|part|Chapter|Section)\b|\\[A-Za-z]*(?:chapter|section)/i.test(around)) { badTitle++; if (bad.length < 4) bad.push(`${sec.file}:${sec.line} "${sec.title}" not at line`); }
		}
		if (badFile || badLine || badTitle) find('BUG', 'outline', `outline: ${badFile} missing files, ${badLine} lines out of range, ${badTitle} titles not at their line`, bad.slice(0, 4));
		const files = d.files ?? [];
		const missing = files.filter((f) => typeof f === 'string' && !exists(f) && !exists(f + '.tex') && !exists(f + '.sty') && !exists(f + '.cls'));
		const labels = d.labels ?? [];
		const names = labels.map((l) => l.name ?? l.label ?? l);
		const dup = names.filter((n, i) => names.indexOf(n) !== i);
		const set = new Set(names);
		const undef = (d.refs ?? []).filter((r) => !set.has(r.name ?? r.label ?? r));
		// every \input/\include/\subfile in the files the app knows must resolve (checked from the raw text)
		const unresolved = [];
		for (const f of files.slice(0, 400)) {
			if (typeof f !== 'string' || !f.endsWith('.tex') || !exists(f)) continue;
			const txt = rd(f).replace(/%.*$/gm, '');
			for (const m of txt.matchAll(/\\(input|include|subfile|subfileinclude)\s*\{([^}#\\]+)\}/g)) {
				const t = m[2].trim();
				const cands = [t, t + '.tex', path.posix.join(path.posix.dirname(f), t), path.posix.join(path.posix.dirname(f), t + '.tex')];
				if (!cands.some(exists)) unresolved.push(`${f}: ${m[1]}{${t}}`);
			}
		}
		if (unresolved.length) find('INFO', 'content', `${unresolved.length} \\input/\\include targets do not exist on disk`, unresolved.slice(0, 4));
		// cites vs bib
		const bibKeys = new Set(Array.isArray(d.bib) ? d.bib.map((b) => b.key ?? b.name ?? b) : Object.keys(d.bib ?? {}));
		const undefCites = bibKeys.size ? (d.cites ?? []).map((c) => c.key ?? c.name ?? c).filter((k) => !bibKeys.has(k)) : [];
		// file-info on a sample
		const infos = [];
		for (const f of files.filter((x) => typeof x === 'string' && x.endsWith('.tex') && exists(x)).slice(0, 6)) {
			const fi = await s.req('file-info', { file: f });
			if (!fi.ok) find('BUG', 'file-info', `${f}: ${fi.error}`); else infos.push({ f, part: fi.data?.part ?? null });
		}
		// the outline per file: levels monotonic by 1 inside a file? (info only)
		return { sections: secs.length, files: files.length, labels: names.length, dupLabels: dup.length, refs: (d.refs ?? []).length, undefinedRefs: undef.length, undefSample: undef.slice(0, 3), bib: bibKeys.size, cites: (d.cites ?? []).length, undefCites: undefCites.length, lint: (d.lint ?? []).length, missingFiles: missing.length, unresolved: unresolved.length, scanMs: d.scan_ms, outlineBad: { badFile, badLine, badTitle }, infos: infos.length };
	});

	await guard('images', async () => {
		const fg = await s.req('figures-status');
		if (!fg.ok) { find('BUG', 'figures-status', fg.error); return { error: fg.error }; }
		const imgs = fg.data.imagenes ?? [];
		const exts = ['', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.PNG', '.JPG'];
		const miss = [];
		// \graphicspath dirs read from the sources
		const gp = new Set(['']);
		for (const f of (symbols?.files ?? []).filter((x) => typeof x === 'string' && x.endsWith('.tex') && exists(x)).slice(0, 200)) {
			for (const m of rd(f).matchAll(/\\graphicspath\s*\{((?:\s*\{[^}]*\}\s*)+)\}/g)) for (const d of m[1].matchAll(/\{([^}]*)\}/g)) gp.add(d[1].replace(/^\.\//, ''));
		}
		for (const im of imgs) {
			const dirs = [...gp, path.posix.dirname(im.codigo ?? '.') + '/'];
			if (!dirs.some((d) => exts.some((e) => exists(path.posix.normalize(d + im.imagen + e))))) miss.push(im.imagen);
		}
		if (miss.length) find('INFO', 'images', `${miss.length}/${imgs.length} \\includegraphics not found on disk (graphicspath considered): ${miss.slice(0, 3).join(', ')}`);
		return { includegraphics: imgs.length, tikz: (fg.data.figuras ?? []).length, notFound: miss.length, missSample: miss.slice(0, 4), errors: (fg.data.errores ?? []).length };
	});

	if (flags['skip-compile']) throw new Error('skip-compile');

	// ---- synthesize extra profiles ----
	const base = JSON.parse(JSON.stringify({ root: rootFile, ...view.config }));
	const addP = {};
	const text = (symbols?.files ?? []).filter((x) => typeof x === 'string' && x.endsWith('.tex') && exists(x)).map(rd).join('\n') + rd(rootFile);
	addP['x-draft'] = { label: 'draft images', draftImages: true, autoCompile: false };
	addP['x-clean'] = { label: 'clean', cleanBefore: true, autoCompile: false };
	addP['x-wm'] = { label: 'wm', autoCompile: false, watermark: { on: true, text: '{profile} {date} p{page}', position: 'center', color: '#ff0000', opacity: 20 } };
	const omit = [];
	if (/\\tableofcontents/.test(text)) omit.push('toc');
	if (/\\bibliography\{|\\printbibliography/.test(text)) omit.push('bibliography');
	if (/\\printindex/.test(text)) omit.push('index');
	if (omit.length) addP['x-omit'] = { label: 'omit', autoCompile: false, omit };
	addP['x-out'] = { label: 'out', autoCompile: false, output: { dir: 'out-x', pattern: '{perfil}-{n:02}' } };
	const hasParts = (view.parts?.length ?? 0) >= 2;
	if (hasParts) {
		addP['x-list'] = { label: 'list', autoCompile: false, partial: true, parts: 'list', partList: view.parts.slice(0, 2).map((p) => p.name ?? p.file) };
		addP['x-per'] = { label: 'perpart', autoCompile: false, output: { dir: 'out-pp', pattern: '{n:02}-{nombre}', perPart: true }, partial: true, parts: 'all' };
	}
	// the view lists profiles as [{id, ...}] for the UI; the file wants a map id -> profile
	const toMap = (arr) => Object.fromEntries(arr.map(({ id: pid, publica, ...rest }) => [pid, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null))]));
	const profs = Array.isArray(base.profiles) ? toMap(base.profiles) : base.profiles;
	base.profiles = { ...profs, ...addP };
	base.publish = { dir: 'pub-x', names: { completo: '{profile}.pdf' } };
	await guard('config-extend', async () => {
		const v = await s.req('config-validate', { text: JSON.stringify(base, null, 2) });
		const bad = v.ok ? (v.data?.errors ?? v.data?.problems ?? []) : [v.error];
		if (!v.ok || v.data?.ok === false) { find('BUG', 'config-validate', `synthesized config rejected: ${v.error ?? (v.data?.errores ?? []).join('; ')}`); delete base.publish; }
		const w = await s.req('config-write', { text: JSON.stringify(base, null, 2) });
		if (!w.ok) { find('BUG', 'config-write', w.error); return { error: w.error }; }
		view = w.data;
		const cp = view.config?.profiles ?? {};
		profileIds = Array.isArray(cp) ? cp.map((p) => p[0] ?? p.id) : Object.keys(cp);
		return { profiles: profileIds, bad };
	});

	// ---- compile each profile ----
	const firstOkPdf = {};
	const engine = view.config?.engine ?? 'pdflatex';
	let baselineDone = null;
	for (const pid of profileIds) {
		await guard('compile:' + pid, async () => {
			const mark = s.events.length;
			const ack = await s.req('compile', { profile: pid });
			if (!ack.ok) { find('BUG', 'compile', `${pid}: ${ack.error}`); return { error: ack.error }; }
			let fin;
			try { fin = await waitFinished(mark, pid); } catch { find('BUG', 'compile-timeout', `${pid} did not finish in ${CT / 1000}s`); await s.req('cancel'); return { timeout: true }; }
			const log = logSince(mark);
			const rec = { ok: fin.ok, code: fin.code, ms: fin.ms, passes: fin.passes, errors: fin.errors, warnings: fin.warnings, badboxes: fin.badboxes, repaired: fin.repaired, pdf: fin.pdf, updated: fin.updated };
			rec.pages = Number((log.match(/\((\d+) pages?/g) ?? []).pop()?.match(/\d+/)?.[0]) || null;
			rec.pdfExists = fin.pdf ? exists(fin.pdf) : false;
			rec.imageErrors = [...new Set([...log.matchAll(/File [`']([^'`]+\.(?:png|jpe?g|pdf|eps|svg|gif))' not found|Unable to load picture or PDF file '?([^'\n]+)/gi)].map((m) => m[1] ?? m[2]))].slice(0, 5);
			rec.crashCode = [...log.matchAll(/gave return code (-?\d+)/g)].map((m) => Number(m[1])).filter((c) => c !== 0 && c !== 1);
			if (rec.crashCode.length) find('BUG', 'engine-crash', `${pid}: TeX exited with ${rec.crashCode.join(',')}`);
			if (fin.ok && !rec.pdfExists) find('BUG', 'compile', `${pid}: ok but the PDF ${fin.pdf} does not exist`);
			if (fin.ok && rec.imageErrors.length) find('PROJECT', 'images', `${pid}: images the log could not load: ${rec.imageErrors.join(', ')}`);
			if (fin.ok) firstOkPdf[pid] = fin;
			if (!fin.ok) {
				const pr = await s.req('problems', { profile: pid });
				rec.problems = (pr.data ?? []).slice(0, 3).map((p) => `${p.kind}:${p.file ?? ''}:${p.line ?? ''} ${String(p.message).slice(0, 100)}`);
				const cl = classify(log);
				rec.firstError = cl.first;
				if (!baselineDone && !rec.crashCode.length) baselineDone = baseline(engine, rootFile);
				rec.baselinePdflatex = baselineDone;
				if (baselineDone?.ok) find('BUG', 'compile-vs-baseline', `${pid}: the app fails ("${cl.first || rec.problems?.[0]}") but plain ${engine} succeeds`);
				else find(cl.looksEnv ? 'ENV' : 'PROJECT', 'compile', `${pid}: ${cl.first || rec.problems?.[0] || 'failed'} (baseline ${baselineDone ? (baselineDone.ok ? 'ok' : 'also fails: ' + baselineDone.firstErr) : 'n/a'})`);
			}
			if (fin.ok && pid.startsWith('x-out') && !exists('out-x')) find('BUG', 'output', `${pid}: profile output dir "out-x" was not created`);
			return rec;
		});
	}
	const okProfiles = Object.keys(firstOkPdf);

	// ---- SyncTeX on the first two successful profiles ----
	for (const pid of okProfiles.slice(0, 2)) {
		await guard('synctex:' + pid, async () => {
			const sf = await s.req('synctex-files', { profile: pid });
			const files = Array.isArray(sf.data) ? sf.data : [];
			if (!Array.isArray(sf.data)) find('BUG', 'synctex-files', `${pid}: null after a successful build`);
			// prose lines of those files
			const pool = [];
			for (const f of files.filter((x) => x.endsWith('.tex') && exists(x))) {
				const lines = rd(f).split(/\r?\n/);
				lines.forEach((l, i) => { if (/^[A-Za-z][^\\%$&{}]{50,}$/.test(l.trim()) && !/\\/.test(l.slice(0, 3))) pool.push([f, i + 1]); });
			}
			const step = Math.max(1, Math.floor(pool.length / 25));
			const sample = pool.filter((_, i) => i % step === 0).slice(0, 25);
			let fwdNull = 0, geomBad = 0, invOk = 0, invOff = 0, invNull = 0; const bad = [];
			for (const [file, line] of sample) {
				const f = await s.req('synctex-forward', { file, line, profile: pid });
				if (!f.ok || !f.data) { fwdNull++; continue; }
				const r = f.data.rects?.[0];
				if (!r) { invNull++; continue; }
				const x = r.x ?? r.h, y = r.y ?? r.v;
				if (!(x >= -5 && x < 2000 && y >= -5 && y < 2000) || !(f.data.page >= 1)) geomBad++;
				const inv = await s.req('synctex-inverse', { profile: pid, page: f.data.page, x: x + 1, y: y - 1 });
				if (!inv.ok || !inv.data) { invNull++; continue; }
				if (inv.data.file === file && Math.abs(inv.data.line - line) <= 10) invOk++;
				else { invOff++; if (bad.length < 3) bad.push(`${file}:${line} -> ${inv.data.file}:${inv.data.line}`); }
			}
			const pf = await s.req('pdf-for', { file: rootFile });
			if (sample.length >= 5 && fwdNull > sample.length / 2) find('BUG', 'synctex-forward', `${pid}: ${fwdNull}/${sample.length} prose lines have no forward result`);
			if (sample.length >= 5 && invOff > sample.length / 3) find('BUG', 'synctex-inverse', `${pid}: ${invOff}/${sample.length} round trips land elsewhere`, bad);
			if (geomBad) find('BUG', 'synctex-geometry', `${pid}: ${geomBad} forward rects out of page range`);
			return { files: files.length, pool: pool.length, sampled: sample.length, fwdNull, geomBad, invOk, invOff, invNull, bad, pdfFor: pf.data ?? null };
		});
	}

	// ---- rebuild behaviour on the first successful profile ----
	const p1 = okProfiles[0];
	if (p1) {
		await guard('noop-rebuild', async () => {
			const mark = s.events.length;
			await s.req('compile', { profile: p1 });
			const fin = await waitFinished(mark, p1);
			if (fin.ok && fin.updated) find('BUG', 'noop-rebuild', `${p1}: nothing changed but the PDF was rewritten (updated=true, ${fin.ms} ms, ${fin.passes} passes)`);
			return { ok: fin.ok, updated: fin.updated, ms: fin.ms, passes: fin.passes, firstMs: firstOkPdf[p1].ms };
		});
		await guard('edit-rebuild', async () => {
			const orig = fs.readFileSync(path.join(root, rootFile));
			const txt = orig.toString('utf8');
			const edited = txt.replace(/(\\begin\{document\}[^\n]*\n)/, '$1% touched by the battery\n');
			if (edited === txt) return { skipped: 'no \\begin{document} line in root' };
			fs.writeFileSync(path.join(root, rootFile), edited);
			await s.req('refresh');
			const mark = s.events.length;
			await s.req('compile', { profile: p1 });
			const fin = await waitFinished(mark, p1);
			fs.writeFileSync(path.join(root, rootFile), orig);
			await s.req('refresh');
			if (!fin.ok) find('BUG', 'edit-rebuild', `${p1}: a comment line made the build fail`);
			if (fin.ok && fin.ms > 2 * firstOkPdf[p1].ms + 3000) find('INFO', 'edit-rebuild', `${p1}: rebuild after a comment took ${fin.ms} ms vs ${firstOkPdf[p1].ms} ms first`);
			return { ok: fin.ok, ms: fin.ms, passes: fin.passes, updated: fin.updated };
		});
		await guard('cancel', async () => {
			// force a fresh long-ish build, cancel after 700 ms
			const mark = s.events.length;
			const pid = profileIds.includes('x-clean') ? 'x-clean' : p1;
			await s.req('compile', { profile: pid });
			await new Promise((r) => setTimeout(r, 700));
			const c = await s.req('cancel');
			let fin = null;
			try { fin = await waitFinished(mark, pid, 60000); } catch { find('BUG', 'cancel', 'no finished event within 60 s after cancel'); }
			const st = await s.req('status');
			if (st.data?.building) find('BUG', 'cancel', 'still building after cancel');
			await new Promise((r) => setTimeout(r, 800));
			const orph = await s.req('orphans');
			const mine = (orph.data ?? []).filter((o) => String(o.cmdline ?? o.cmd ?? '').includes(root.split('/').pop()));
			if (mine.length) find('BUG', 'cancel', `${mine.length} TeX processes of this project survive a cancel`, mine.slice(0, 2));
			return { cancelled: c.data?.cancelled ?? null, finishedCancelled: fin?.cancelled ?? null, ok: fin?.ok ?? null, orphans: mine.length };
		});
		await guard('fragment', async () => {
			const mark = s.events.length;
			const a = await s.req('fragment', { text: 'A paragraph with \\emph{emphasis} and math $x^2+y^2=z^2$.' });
			if (!a.ok) { find('INFO', 'fragment', a.error); return { error: a.error }; }
			let fin;
			try { fin = await waitFinished(mark, null, 120000); } catch { find('BUG', 'fragment', 'no finished event'); return { timeout: true }; }
			return { ok: fin.ok, ms: fin.ms, pdf: fin.pdf };
		});
		await guard('publish', async () => {
			if (!base.publish) return { skipped: true };
			const p = await s.req('publish', { profile: 'completo' in (base.profiles ?? {}) ? 'completo' : p1 });
			if (!p.ok) { find('INFO', 'publish', p.error); return { error: p.error }; }
			const out = (p.data?.path ?? p.data?.pdf ?? JSON.stringify(p.data)).toString();
			return { out: out.slice(0, 160) };
		});
	}
	if (hasParts && okProfiles.length) {
		await guard('export', async () => {
			const mark = s.events.length;
			const a = await s.req('export', {});
			if (!a.ok) { find('INFO', 'export', a.error); return { error: a.error }; }
			let fin;
			try { fin = await s.waitEvent((e) => e.type === 'export-finished' && s.events.indexOf(e) >= mark, CT); } catch { find('BUG', 'export-timeout', 'export did not finish'); return { timeout: true }; }
			if (fin.failed) find('BUG', 'export', `${fin.failed} of ${fin.exported + fin.failed} parts failed to export (${fin.error ?? ''})`);
			return { exported: fin.exported, failed: fin.failed, ms: fin.ms };
		});
	}
	await guard('misc', async () => {
		const h = await s.req('history', { limit: 50 });
		const tt = await s.req('typical-times');
		const dr = await s.req('doctor', {}, 120000);
		const errs = (dr.data?.items ?? dr.data?.problems ?? dr.data?.errors ?? []);
		return { history: (h.data ?? []).length, typical: Object.keys(tt.data ?? {}).length, doctorOk: dr.ok, doctorKeys: dr.ok ? Object.keys(dr.data ?? {}) : dr.error };
	});

	// ---- engine switch: unicode projects, and every engine on the first ok profile ----
	if (okProfiles.length || /needs-unicode/.test(JSON.stringify(R))) {
		for (const eng of ['xelatex', 'lualatex']) {
			await guard('engine:' + eng, async () => {
				const cfg = JSON.parse(JSON.stringify(base)); cfg.engine = eng;
				const w = await s.req('config-write', { text: JSON.stringify(cfg, null, 2) });
				if (!w.ok) { find('BUG', 'engine-switch', `${eng}: ${w.error}`); return { error: w.error }; }
				const pid = okProfiles.includes('completo') ? 'completo' : (okProfiles[0] ?? profileIds[0]);
				const mark = s.events.length;
				await s.req('compile', { profile: pid });
				let fin;
				try { fin = await waitFinished(mark, pid); } catch { find('BUG', 'engine-timeout', `${eng}`); return { timeout: true }; }
				const log = logSince(mark);
				const rec = { ok: fin.ok, ms: fin.ms, passes: fin.passes, pages: Number((log.match(/\((\d+) pages?/g) ?? []).pop()?.match(/\d+/)?.[0]) || null };
				if (!fin.ok) {
					const cl = classify(log);
					rec.firstError = cl.first;
					rec.baseline = baseline(eng, rootFile);
					if (rec.baseline.ok) find('BUG', 'engine-switch', `${eng}: app fails ("${cl.first}") but plain ${eng} succeeds`);
					else if (!cl.looksEnv && !rec.baseline.ok) find('INFO', 'engine-switch', `${eng} fails for the document too: ${cl.first}`);
				} else if (!okProfiles.length || !firstOkPdf[pid]) find('INFO', 'engine-switch', `${eng} compiles a document that ${engine} could not`);
				return rec;
			});
		}
		const w = await s.req('config-write', { text: JSON.stringify(base, null, 2) });
	}
} catch (e) {
	if (!/abort|skip-compile/.test(String(e))) { R.fatal = String(e).slice(0, 300); find('BUG', 'fatal', R.fatal); }
} finally {
	try { s.close(); } catch {}
}
R.totalMs = Date.now() - t0;
fs.writeFileSync(outFile, JSON.stringify(R, null, 1));
console.log(`${id}: ${R.findings.filter((f) => f.sev === 'BUG').length} BUG, ${R.findings.filter((f) => f.sev === 'ENV').length} ENV, ${R.findings.filter((f) => f.sev === 'PROJECT').length} PROJECT, ${R.findings.filter((f) => f.sev === 'INFO').length} INFO in ${Math.round(R.totalMs / 1000)}s`);
process.exit(0);
