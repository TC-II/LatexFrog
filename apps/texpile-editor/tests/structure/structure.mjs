// Structure sense check, step 1: what LatexFrog thinks each project is, and the PDFs it builds from that.
//
// node structure.mjs <out dir> <project dir>[=root.tex] ...      (LV_SIDECAR = path to lv-sidecar)
//
// Every project is copied to <out>/work/<name> (never touched in place). Per project it writes <out>/<name>/:
//   trees.json  the Contents tree (parts, sections, pieces), the figures and the configuration as the app shows them
//   <case>.pdf  the full document, one part alone, two parts that are not neighbours (chosen as the Contents menu
//               chooses them: the selection), and the Export of one part
//   <case>.json the PDF's skeleton (skel.py)
//   run.json    which cases built and how
// A project's own configuration is kept (it is the user's); a project without one gets the configuration the app infers.
// compare.mjs reads all of it; nothing here judges.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSidecar } from '../corpus/sc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, ...specs] = process.argv.slice(2);
const CT = 30 * 60 * 1000;
const exe = process.env.LV_SIDECAR;
if (!exe || !outDir || !specs.length) {
	console.error('usage: LV_SIDECAR=... node structure.mjs <out dir> <project>[=root.tex] ...');
	process.exit(2);
}

const skel = (pdf, json) => execFileSync('python', [path.join(here, 'skel.py'), pdf, json], { stdio: 'ignore' });
const copy = (from, to) => {
	fs.rmSync(to, { recursive: true, force: true });
	fs.cpSync(from, to, {
		recursive: true,
		// never another instance's lock, Live's folder, the builds, nor a latexmkrc (it is Perl and runs)
		// FRESH=1: without the project's .latexfrog either, so the app meets it as a new project
		filter: (p) =>
			!/[\\/](\.git|_draft|node_modules)$|[\\/]\.latexfrog[\\/](lock|build|drivers|piezas)$|latexmkrc$/i.test(p) &&
			!(process.env.FRESH === '1' && /[\\/]\.latexfrog$/.test(p))
	});
};
const NEEDS_UNICODE = /\\usepackage(\[[^\]]*\])?\{(fontspec|xeCJK|ctex|polyglossia|unicode-math)\}|\\documentclass(\[[^\]]*\])?\{ctex/;

async function project(spec) {
	const [src, hint] = spec.split('=');
	const name = path.basename(src).replace(/[^\w.-]+/g, '_').slice(0, 60);
	const root = path.join(outDir, 'work', name);
	const res = path.join(outDir, name);
	fs.mkdirSync(res, { recursive: true });
	copy(src, root);
	const run = { project: name, cases: {} };
	const s = startSidecar(exe);
	try {
		let o = await s.req('open', { root });
		if (!o.ok) throw new Error(o.error);
		let view = (await s.req('view')).data;
		if (hint || !view.rootFile) {
			const f = hint || view.candidates?.[0];
			if (!f) throw new Error('no root');
			view = (await s.req('set-root', { file: f })).data;
		}
		let sym = (await s.req('symbols')).data;
		const configSaved = view.configSaved;
		// the cases: the configuration as it is plus three profiles of ours
		// the file's own shape (`view.config` is the UI's: profiles as a list, and not every field)
		// a project without one gets what the configuration screen proposes (detect), as a user who saves it would
		const disk = await s.req('config-read');
		let cfgText = disk.ok && typeof disk.data === 'string' ? disk.data : null;
		if (!cfgText) {
			const d = await s.req('detect', {});
			cfgText = d.ok ? d.data?.texto : null;
		}
		const cfg = cfgText ? JSON.parse(cfgText) : {};
		const profiles = Array.isArray(cfg.profiles)
			? Object.fromEntries(cfg.profiles.map(({ id, publica, ...r }) => [id, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null))]))
			: (cfg.profiles ?? {});
		profiles['t-full'] = { label: 'full', autoCompile: false };
		profiles['t-one'] = { label: 'one', autoCompile: false, parts: 'selection' };
		profiles['t-two'] = { label: 'two', autoCompile: false, parts: 'selection' };
		const file = { ...cfg, root: cfg.root ?? view.rootFile, profiles };
		const text = [view.rootFile, ...(sym?.files ?? [])]
			.filter((f) => typeof f === 'string' && f.endsWith('.tex'))
			.map((f) => {
				try {
					return fs.readFileSync(path.join(root, f), 'utf8');
				} catch {
					return '';
				}
			})
			.join('\n');
		if ((file.engine ?? 'pdflatex') === 'pdflatex' && NEEDS_UNICODE.test(text)) file.engine = 'xelatex';
		delete file.publish;
		const w = await s.req('config-write', { text: JSON.stringify(file, null, 2) });
		if (!w.ok) throw new Error('config-write: ' + w.error);
		view = w.data ?? view;
		// the parts as the saved configuration finds them
		const top = view.parts.filter((p) => !p.group);
		const one = top[Math.floor(top.length / 2)];
		const two = top.length >= 3 ? [top[0], top[2]] : null;
		run.parts = top.length;
		sym = (await s.req('symbols')).data;
		const figs = await s.req('figures-status');
		// the part each file belongs to, as the app says (a file a chapter \inputs is that chapter's)
		const fileParts = {};
		for (const f of new Set((sym?.sections ?? []).map((x) => x.file))) {
			const i = await s.req('file-info', { file: f });
			fileParts[f] = i.ok ? (i.data?.part ?? null) : null;
		}
		fs.writeFileSync(
			path.join(res, 'trees.json'),
			JSON.stringify(
				{
					root: view.rootFile,
					configSaved,
					config: file,
					parts: view.parts,
					fileParts,
					pieces: (view.piezas ?? []).map((p) => ({ key: p.clave, name: p.nombre, file: p.archivo, line: p.linea, where: p.lugar, part: p.parte })),
					sections: (sym?.sections ?? []).map((x) => ({ level: x.level, title: x.title, file: x.file, line: x.line, label: x.label, ...(x.cond ? { cond: x.cond } : {}) })),
					figures: figs.ok ? (figs.data?.figuras ?? []).map((f) => ({ file: f.archivo, line: f.linea, state: f.estado })) : { error: figs.error }
				},
				null,
				1
			)
		);
		const build = async (id, selection) => {
			if (selection) await s.req('set-state', { selection: selection.map((p) => p.name) });
			const mark = s.events.length;
			const a = await s.req('compile', { profile: id });
			if (!a.ok) return { ok: false, error: a.error };
			const fin = await s.waitEvent((e) => e.type === 'finished' && e.profile === id && s.events.indexOf(e) >= mark, CT);
			const pdf = fin.pdf ? path.join(root, fin.pdf) : null;
			const r = { ok: fin.ok, ms: fin.ms, errors: fin.errors, parts: selection?.map((p) => p.name) };
			if (pdf && fs.existsSync(pdf)) {
				fs.copyFileSync(pdf, path.join(res, `${id}.pdf`));
				skel(pdf, path.join(res, `${id}.json`));
				r.pdf = `${id}.pdf`;
			}
			return r;
		};
		run.cases['t-full'] = await build('t-full');
		if (one) run.cases['t-one'] = await build('t-one', [one]);
		if (two) run.cases['t-two'] = await build('t-two', two);
		if (one) {
			const mark = s.events.length;
			const a = await s.req('export', { parts: [one.name] });
			if (a.ok) {
				const fin = await s.waitEvent((e) => e.type === 'export-finished' && s.events.indexOf(e) >= mark, CT);
				const prog = s.events.slice(mark).filter((e) => e.type === 'export-progress' && e.ok && e.file);
				const r = { ok: fin.ok, ms: fin.ms, parts: [one.name] };
				const f = prog[0]?.file;
				const dirAbs = fin.dir ? path.resolve(root, fin.dir) : root;
				const pdf = f ? (path.isAbsolute(f) ? f : [path.resolve(root, f), path.join(dirAbs, path.basename(f))].find((x) => fs.existsSync(x))) : null;
				if (pdf && fs.existsSync(pdf)) {
					fs.copyFileSync(pdf, path.join(res, 't-export.pdf'));
					skel(pdf, path.join(res, 't-export.json'));
					r.pdf = 't-export.pdf';
				} else r.error = `no PDF (${f ?? 'no file'}; dir ${fin.dir})`;
				run.cases['t-export'] = r;
			} else run.cases['t-export'] = { ok: false, error: a.error };
		}
	} catch (e) {
		run.error = e instanceof Error ? e.message : String(e);
	} finally {
		s.close();
	}
	fs.writeFileSync(path.join(res, 'run.json'), JSON.stringify(run, null, 1));
	console.log(name, run.error ?? Object.entries(run.cases).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'}`).join(' '));
}

for (const spec of specs) await project(spec);
process.exit(0);
