// Strict baseline for the projects whose plain-TeX run made a PDF: exit status and error count of the last pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const S = process.argv[2];
const b2 = JSON.parse(fs.readFileSync(path.join(S, 'baseline2.json'), 'utf8'));
const out = {};
for (const [id, v] of Object.entries(b2)) {
	const hit = Object.entries(v.baseline).find(([, r]) => r.pdf);
	if (!hit) continue;
	const eng = hit[0];
	const bat = JSON.parse(fs.readFileSync(path.join(S, 'res2', id + '.json'), 'utf8'));
	const rootFile = bat.steps.open.rootFile;
	const base = path.join(S, 'work2', '_b3-' + id);
	try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch {}
	fs.cpSync(path.join(S, 'work2', id), base, { recursive: true, filter: (p) => !/[\\/]\.latexfrog([\\/]|$)/.test(p) && !/[\\/]_draft([\\/]|$)/.test(p) });
	let status = null, errs = 0, firstErr = '', pages = null;
	for (let i = 0; i < 2; i++) {
		const r = spawnSync(eng, ['--disable-installer', '-no-shell-escape', '-interaction=nonstopmode', path.basename(rootFile)], { cwd: path.join(base, path.dirname(rootFile)), timeout: 200000, encoding: 'utf8' });
		const t = (r.stdout ?? '') + (r.stderr ?? '');
		status = r.status; errs = (t.match(/^! /gm) ?? []).length; firstErr = (t.match(/^! .*$/m) ?? [''])[0].slice(0, 100);
		pages = Number(t.match(/\((\d+) pages?/)?.[1]) || null;
	}
	try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch {}
	out[id] = { engine: eng, status, errs, firstErr, pages };
	console.log(id.padEnd(52), eng, 'status', status, 'errs', errs, 'pages', pages, firstErr);
}
fs.writeFileSync(path.join(S, 'baseline3.json'), JSON.stringify(out, null, 1));
