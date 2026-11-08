// Find self-contained LaTeX projects (a folder with a \documentclass file) in cloned repos, tag them, pick a diverse set,
// and copy them to work2/<id> with no .git and no latexmkrc (the app reads the project's latexmkrc: it is Perl).
import fs from 'node:fs';
import path from 'node:path';

const S = process.argv[2];
const SRC = path.join(S, 'corpus2'), SRC1 = path.join(S, 'corpus'), OUT = path.join(S, 'work2');
const MAXPER = { default: 3, 'tectonic': 8, 'LaTeX-Workshop': 8, 'vimtex': 6, 'latexindent.pl': 5, 'pgfplots': 4, 'tikzplotlib': 3, 'biblatex': 3, 'latex3': 3, 'openintro-statistics': 2, 'OpenLogic': 1 };
const skipDir = new Set(['.git', 'node_modules', '_draft', '.latexfrog']);
const walk = (d, f, depth = 0) => {
	let es = [];
	try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
	for (const e of es) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) { if (!skipDir.has(e.name) && depth < 7) walk(p, f, depth + 1); } else f(p, d);
	}
};
const read = (p) => { try { return fs.readFileSync(p, 'latin1'); } catch { return ''; } };
const tag = (txt, dirFiles) => {
	const t = new Set();
	const pk = [...txt.matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
	const cls = txt.match(/\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/)?.[1] ?? '?';
	t.add('class:' + cls);
	for (const p of pk) if (/^(tikz|pgfplots|biblatex|natbib|glossaries|makeidx|imakeidx|subfiles|standalone|fontspec|xeCJK|ctex|polyglossia|babel|minted|pythontex|listings|beamer|algorithm2e|algorithmicx|siunitx|hyperref|graphicx|pstricks|asymptote|svg|import|bibunits|chapterbib|multibib|epstopdf|bibtex|appendix|todonotes|tcolorbox|mdframed|framed)$/.test(p)) t.add('pkg:' + p);
	if (/\\input\{|\\include\{/.test(txt)) t.add('multi');
	if (/\\addbibresource|\\bibliography\{/.test(txt)) t.add('bib');
	if (/\\printindex|\\makeindex/.test(txt)) t.add('index');
	if (/\\printglossar|\\makeglossaries/.test(txt)) t.add('glossary');
	if (/\\documentclass[^{]*\{beamer\}/.test(txt)) t.add('beamer');
	if (/% *!TEX +(program|TS-program) *= *(\w+)/i.test(txt)) t.add('magic:' + txt.match(/% *!TEX +(?:program|TS-program) *= *(\w+)/i)[1].toLowerCase());
	if (/fontspec|xeCJK|ctex|polyglossia|\\setmainfont/.test(txt)) t.add('needs-unicode-engine');
	return { tags: [...t], cls };
};
const found = [];
for (const base of [SRC, SRC1]) {
	for (const repo of fs.readdirSync(base)) {
		const rp = path.join(base, repo);
		if (!fs.statSync(rp).isDirectory()) continue;
		const byDir = new Map();
		walk(rp, (p, d) => {
			if (!p.endsWith('.tex')) return;
			const txt = read(p);
			if (!/\\documentclass/.test(txt) || !/\\begin\{document\}/.test(txt)) return;
			if (!byDir.has(d)) byDir.set(d, []);
			byDir.get(d).push(p);
		});
		for (const [d, files] of byDir) {
			// project dir: if the dir is a sub-folder of a project (chapters/), the document's own dir is fine too
			const rootFile = files.sort((a, b) => read(b).length - read(a).length)[0];
			const txt = read(rootFile);
			// all files of the folder tree for tagging (first-level inputs are cheap to approximate)
			let all = txt;
			let n = 0;
			walk(d, (p) => { if (p.endsWith('.tex') && n++ < 200) all += '\n' + read(p); });
			let imgs = 0, texc = 0, size = 0;
			walk(d, (p) => { const e = path.extname(p).toLowerCase(); if (['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'].includes(e)) imgs++; if (e === '.tex') texc++; try { size += fs.statSync(p).size; } catch {} });
			const { tags, cls } = tag(all);
			const unsafe = /\\write18|\\ShellEscape|pythontex|\\usepackage(\[[^\]]*\])?\{minted\}|\\usepackage(\[[^\]]*\])?\{gnuplottex\}|\\usepackage(\[[^\]]*\])?\{asymptote\}|\\input\{\|/.test(all);
			found.push({ repo, dir: d, rel: path.relative(rp, d).replace(/\\/g, '/') || '.', root: path.basename(rootFile), roots: files.map((f) => path.basename(f)), tags, cls, imgs, texc, sizeMB: +(size / 1e6).toFixed(1), unsafe });
		}
	}
}
// pick diverse: per repo, rank by new tag coverage
const chosen = [];
const seenSig = new Set();
for (const repo of [...new Set(found.map((f) => f.repo))]) {
	const cap = MAXPER[repo] ?? MAXPER.default;
	const cands = found.filter((f) => f.repo === repo && f.sizeMB < 80 && f.texc < 600).sort((a, b) => b.tags.length + Math.min(b.imgs, 5) - (a.tags.length + Math.min(a.imgs, 5)));
	let k = 0;
	for (const c of cands) {
		const sig = c.tags.filter((t) => t.startsWith('pkg:') || t === 'beamer' || t.startsWith('class:')).sort().join('|');
		if (k >= cap) break;
		if (seenSig.has(repo + sig)) continue;
		seenSig.add(repo + sig);
		chosen.push(c); k++;
	}
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
const copyDir = (src, dst) => {
	fs.mkdirSync(dst, { recursive: true });
	for (const e of fs.readdirSync(src, { withFileTypes: true })) {
		if (skipDir.has(e.name)) continue;
		if (/^\.?latexmkrc$/i.test(e.name)) continue;
		const s = path.join(src, e.name), d = path.join(dst, e.name);
		if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
	}
};
let i = 0;
for (const c of chosen) {
	const id = `${String(++i).padStart(2, '0')}-${c.repo}${c.rel === '.' ? '' : '-' + c.rel.replace(/[^\w]+/g, '_').slice(-30)}`.replace(/[^\w.-]/g, '_');
	copyDir(c.dir, path.join(OUT, id));
	manifest.push({ id, repo: c.repo, rel: c.rel, root: c.root, roots: c.roots, tags: c.tags, imgs: c.imgs, texc: c.texc, sizeMB: c.sizeMB, unsafe: c.unsafe });
}
fs.writeFileSync(path.join(S, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`found ${found.length} candidate dirs, chose ${manifest.length}`);
const tc = {};
for (const m of manifest) for (const t of m.tags) tc[t] = (tc[t] ?? 0) + 1;
console.log(JSON.stringify(Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 40)));
console.log('unsafe (shell-escape-ish):', manifest.filter((m) => m.unsafe).map((m) => m.id).join(', '));
