// Live on a real multi-file project: type one letter into prose lines of the given files and grade what the preview
// did (EXACT = instant patch, RECOMPILE = full pass, NOOP = nothing needed). Works on the copy it is given.
//
// The letters accumulate, as when someone writes: the baseline the next edit is decided against moves the way the
// app's dispatcher moves it -- to the edited text when a patch is adopted, or when a compile covered it -- so a
// full pass runs only when an edit itself needed one.
//
// node tests/live/project-matrix.mjs <project copy> <main file, e.g. a profile's Live driver> <file> [file...]
// PM_MAX: prose lines per file (default 20, spread over the file). PM_BRIDGE / PM_VITE: ports, to run several at once.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { classify, collectUntilQuiet } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../..');
const BRIDGE = Number(process.env.PM_BRIDGE || 8099);
const VITE = Number(process.env.PM_VITE || 5177);
const [rootArg, mainFile, ...files] = process.argv.slice(2);
const root = path.resolve(rootArg).replace(/\\/g, '/');

const waitHttp = async (url) => {
	for (let i = 0; i < 240; i++) {
		try {
			if ((await fetch(url)).status < 500) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error('not up: ' + url);
};
const post = async (p, body) => (await fetch(`http://localhost:${BRIDGE}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();

const bridge = spawn(process.execPath, [path.join(here, 'server.mjs')], { stdio: 'inherit', env: { ...process.env, LIVE_BRIDGE_PORT: String(BRIDGE) } });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--port', String(VITE), '--strictPort'], { cwd: appRoot, stdio: 'ignore' });
const rows = [];
let warmMs = null;
// the files as they were, put back at the end so the next run starts from the same project
const originals = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f))]));
try {
	await waitHttp(`http://localhost:${BRIDGE}/ping`);
	await waitHttp(`http://localhost:${VITE}/tests/live/live.html`);
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
	page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
	await page.goto(`http://localhost:${VITE}/tests/live/live.html?bridge=${BRIDGE}`, { timeout: 120000 });
	await page.waitForFunction(() => !!window.__live, undefined, { timeout: 120000 });
	await page.evaluate(([r, m]) => window.__live.open(r, m), [root, mainFile]);
	const ev0 = await collectUntilQuiet(page, { quietMs: 2000, maxMs: 180000 });
	const c0 = ev0.filter((e) => e.kind === 'compiled').pop();
	warmMs = c0?.detail?.ms ?? null;
	console.log('warm-up:', c0 ? `compiled ${c0.detail?.pages} pages` : ev0.map((e) => e.kind).join(' '));

	for (const file of files) {
		const abs = path.join(root, file);
		let cur = fs.readFileSync(abs, 'utf8');
		let baseline = cur;
		const lines0 = cur.split('\n');
		// prose lines, at most PM_MAX of them per file, spread over the file
		const prose = [];
		for (let i = 0; i < lines0.length; i++) {
			const ln = lines0[i];
			if (!/^\s*(\\item\s+)?[\p{L}¿(]/u.test(ln)) continue;
			if (ln.trimEnd().lastIndexOf(' ') <= ln.search(/\S/) + 6) continue;
			prose.push(i);
		}
		const max = Number(process.env.PM_MAX || 20);
		const picked = prose.length <= max ? prose : Array.from({ length: max }, (_, k) => prose[Math.floor((k * prose.length) / max)]);
		for (const i of picked) {
			// one letter per line keeps every line where it was
			const lines = cur.split('\n');
			const ln = lines[i];
			const at = ln.trimEnd().lastIndexOf(' ');
			lines[i] = ln.slice(0, at) + 'x' + ln.slice(at);
			const edited = lines.join('\n');
			const d = await page.evaluate(([a, b, f]) => window.__live.decide(a, b, f), [baseline, edited, file]);
			let res;
			const t0 = Date.now();
			if (d.kind === 'noop') {
				res = { outcome: 'NOOP', latencyMs: 0, reasons: [] };
				baseline = edited;
			} else if (d.kind !== 'patch') {
				// the app debounces, saves and runs the full pass
				await post('/write', { root, file, content: edited });
				await page.evaluate(() => window.__live.recompile());
				const ev = await collectUntilQuiet(page, { quietMs: 1200, maxMs: 120000 });
				res = classify(ev);
				res.outcome = 'RECOMPILE';
				res.reasons = [d.kind + (d.reason ? ':' + d.reason : d.env ? ':' + d.env : ''), ...res.reasons];
				baseline = edited;
			} else {
				await page.evaluate(([req, r, b, f]) => window.__live.patch(req, r, b, f), [d, root, edited, file]);
				const ev = await collectUntilQuiet(page, { maxMs: 120000 });
				res = classify(ev);
				const t1 = ev[0]?.t ?? 0;
				res.events = ev.map((e) => `${Math.round(e.t - t1)} ${e.kind} ${JSON.stringify(e.detail ?? '').slice(0, 160)}`);
				const adopted = await page.evaluate(() => window.__adopted === true);
				if (adopted || ev.some((e) => e.kind === 'compiled')) baseline = edited;
				res.adopted = adopted;
			}
			cur = edited;
			// the editor saves: the file on disk is the buffer, whatever the preview did
			await post('/write', { root, file, content: cur });
			const wall = Date.now() - t0;
			console.log(`${file}:${i + 1} ${res.outcome} ${res.latencyMs ?? '-'}ms (wall ${wall}) ${res.reasons.join(',')}`);
			rows.push({ file, line: i + 1, text: ln.trim().slice(0, 100), ...res, wall });
		}
	}
	await browser.close();
} finally {
	for (const [f, bytes] of originals) fs.writeFileSync(path.join(root, f), bytes);
	bridge.kill();
	vite.kill();
}
const by = {};
for (const r of rows) by[r.outcome] = (by[r.outcome] ?? 0) + 1;
const slow = rows.filter((r) => r.outcome === 'EXACT' && r.latencyMs > 200).length;
console.log('\nOUTCOMES', JSON.stringify(by), `slow-exact(>200ms) ${slow}`, `pass ${warmMs} ms`);
const out = process.env.PM_OUT || path.join(root, '..', `project-matrix-${path.basename(root)}-${Date.now()}.json`);
fs.writeFileSync(out, JSON.stringify({ root, mainFile, passMs: warmMs, rows }, null, 1));
console.log('written', out);
