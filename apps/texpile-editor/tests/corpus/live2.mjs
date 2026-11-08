// Live (draft engine) battery for one project that the full build compiled: node live2.mjs <work dir> <battery json> <out json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startSidecar } from './sc.mjs';

const REPO = process.env.LV_REPO;
const { loadEngine } = await import(pathToFileURL(`${REPO}/apps/texpile-editor/tests/live/engineBridge.mjs`).href);
const [dirArg, batJson, outFile] = process.argv.slice(2);
const root = path.resolve(dirArg).replace(/\\/g, '/');
const id = path.basename(root);
const bat = JSON.parse(fs.readFileSync(batJson, 'utf8'));
const R = { id, findings: [], steps: {} };
const find = (sev, area, msg, extra) => R.findings.push({ sev, area, msg: String(msg).slice(0, 400), ...(extra ? { extra } : {}) });
const engineDir = `${REPO}/electron/lua`;
const { draftService, draftDaemon } = loadEngine();
const exists = (f) => fs.existsSync(path.join(root, f));
const s = startSidecar(process.env.LV_SIDECAR);
try {
	const o = await s.req('open', { root });
	if (!o.ok) throw new Error(o.error);
	// the profile the full build compiled first
	const prof = Object.keys(bat.steps).filter((k) => k.startsWith('compile:') && bat.steps[k]?.ok).map((k) => k.slice(8));
	const pid = prof.includes('completo') ? 'completo' : prof.find((p) => !p.startsWith('x-')) ?? prof[0];
	if (!pid) { R.skipped = 'no profile compiled in the full build'; throw new Error('skip'); }
	R.profile = pid;
	const fullPages = bat.steps['compile:' + pid].pages;
	const d = await s.req('driver-for-live', { profile: pid });
	if (!d.ok) { find('BUG', 'driver-for-live', d.error); throw new Error('driver'); }
	R.driver = d.data.path;
	// cold draft compile, twice (the second is warm)
	for (const pass of ['cold', 'warm']) {
		const t = performance.now();
		let r;
		try { r = await draftService.compileDraft({ root, mainFile: d.data.path, engineDir, readBack: { byTex: ['aux', 'toc'], byTools: [] } }); }
		catch (e) { find('BUG', 'live-compile', `${pass}: threw ${String(e).slice(0, 200)}`); break; }
		const ms = Math.round(performance.now() - t);
		const logf = path.join(root, '_draft/draft.log');
		const log = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8') : '';
		const rec = { ms, ok: r.ok, pages: r.pages?.length ?? 0, error: r.error ?? null };
		rec.texErrors = [...log.matchAll(/^! .*$/gm)].map((m) => m[0]).slice(0, 4);
		rec.missing = [...new Set([...log.matchAll(/File [`']([^'`]+)' not found|Unable to load picture or PDF file '?([^'\n]+)/g)].map((m) => m[1] ?? m[2]))].slice(0, 5);
		R.steps['draft-' + pass] = rec;
		if (pass === 'cold') {
			if (!r.ok) {
				find('BUG', 'live-compile', `Live cannot compile what the full build ${pid} compiled: ${r.error} ${rec.texErrors[0] ?? ''}`);
			} else {
				if (fullPages && Math.abs(rec.pages - fullPages) > Math.max(1, Math.round(fullPages * 0.03))) find('INFO', 'live-pages', `Live has ${rec.pages} pages, the full build ${fullPages}`);
				if (rec.texErrors.length) find('INFO', 'live-errors', `Live log has TeX errors that the build does not stop on: ${rec.texErrors[0]}`);
				if (rec.missing.length) find('PROJECT', 'live-images', `missing in Live: ${rec.missing.join(', ')}`);
			}
		}
		if (pass === 'warm' && R.steps['draft-cold']?.ok && rec.ms > R.steps['draft-cold'].ms * 1.5 + 2000) find('INFO', 'live-warm', `warm compile (${rec.ms} ms) slower than cold (${R.steps['draft-cold'].ms} ms)`);
	}
	// synctex on the draft pdf: grid over pages
	const dc = R.steps['draft-cold'];
	if (dc?.ok && exists('_draft/draft.pdf')) {
		let hit = 0, tried = 0, wrongFile = 0;
		const n = dc.pages;
		const pages = [...new Set([1, 2, Math.ceil(n / 3), Math.ceil(n / 2), Math.ceil((2 * n) / 3), n].filter((p) => p >= 1 && p <= n))];
		for (const pg of pages) for (const [x, y] of [[200, 250], [300, 400], [300, 600]]) {
			tried++;
			const inv = await s.req('synctex-inverse-pdf', { pdf: '_draft/draft.pdf', page: pg, x, y });
			if (inv.ok && inv.data?.file) { hit++; if (!exists(inv.data.file)) wrongFile++; }
		}
		R.steps.synctexDraft = { tried, hit, wrongFile };
		if (hit === 0) find('BUG', 'live-synctex', 'synctex-inverse-pdf on the draft PDF never returns a source line');
		if (wrongFile) find('BUG', 'live-synctex', `${wrongFile} inverse results name a file that does not exist`);
	}
	// the files worth editing: most prose lines among those the profile's PDF read
	const sf = await s.req('synctex-files', { profile: pid });
	const files = (Array.isArray(sf.data) ? sf.data : []).filter((f) => f.endsWith('.tex') && exists(f) && !f.startsWith('.latexfrog'));
	const score = files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z][^\\%$&{}]{40,}$/.test(l.trim())).length]).sort((a, b) => b[1] - a[1]);
	R.editFiles = score.filter((x) => x[1] >= 3).slice(0, 2).map((x) => x[0]);
} catch (e) {
	if (!/skip|driver/.test(String(e))) { find('BUG', 'live-fatal', String(e).slice(0, 300)); }
} finally {
	try { s.close(); } catch {}
	try { draftDaemon.stopDaemon(); } catch {}
}
fs.writeFileSync(outFile, JSON.stringify(R, null, 1));
console.log(`${id}: live ${R.findings.filter((f) => f.sev === 'BUG').length} BUG ${R.findings.length} total; edit files: ${(R.editFiles ?? []).join(',')}`);
process.exit(0);
