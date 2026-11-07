// Live on a real multi-file project: type one letter into each prose line of the given files and grade what the
// preview did (EXACT = instant patch, RECOMPILE = full pass). Works on the copy it is given; restores each file after.
// node tests/live/project-matrix.mjs <project copy> <main file, e.g. the Live driver> <file> [file...]
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { classify, collectUntilQuiet } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../..');
const BRIDGE = 8099;
const VITE = 5177;
const [rootArg, mainFile, ...files] = process.argv.slice(2);
const root = path.resolve(rootArg).replace(/\\/g, '/');

const waitHttp = async (url) => {
	for (let i = 0; i < 120; i++) {
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

const bridge = spawn(process.execPath, [path.join(here, 'server.mjs')], { stdio: 'inherit' });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--port', String(VITE), '--strictPort'], { cwd: appRoot, stdio: 'ignore' });
const rows = [];
try {
	await waitHttp(`http://localhost:${BRIDGE}/ping`);
	await waitHttp(`http://localhost:${VITE}/tests/live/live.html`);
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
	page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
	await page.goto(`http://localhost:${VITE}/tests/live/live.html`, { timeout: 60000 });
	await page.waitForFunction(() => !!window.__live, undefined, { timeout: 60000 });
	await page.evaluate(([r, m]) => window.__live.open(r, m), [root, mainFile]);
	const ev0 = await collectUntilQuiet(page, { quietMs: 2000, maxMs: 90000 });
	console.log('warm-up:', ev0.some((e) => e.kind === 'compiled') ? 'compiled' : ev0.map((e) => e.kind).join(' '));

	for (const file of files) {
		const abs = path.join(root, file);
		const base = fs.readFileSync(abs, 'utf8');
		const lines = base.split('\n');
		// prose lines, at most PM_MAX of them per file (default 20), spread over the file
		const prose = [];
		for (let i = 0; i < lines.length; i++) {
			const ln = lines[i];
			if (!/^\s*(\\item\s+)?[\p{L}¿(]/u.test(ln)) continue;
			if (ln.trimEnd().lastIndexOf(' ') <= ln.search(/\S/) + 6) continue;
			prose.push(i);
		}
		const max = Number(process.env.PM_MAX || 20);
		const picked = prose.length <= max ? prose : Array.from({ length: max }, (_, k) => prose[Math.floor((k * prose.length) / max)]);
		for (const i of picked) {
			const ln = lines[i];
			const at = ln.trimEnd().lastIndexOf(' ');
			const edited = [...lines];
			edited[i] = ln.slice(0, at) + 'x' + ln.slice(at);
			const buf = edited.join('\n');
			const d = await page.evaluate(([a, b, f]) => window.__live.decide(a, b, f), [base, buf, file]);
			let res;
			const t0 = Date.now();
			if (d.kind === 'noop') {
				res = { outcome: 'NOOP', latencyMs: 0, reasons: [] };
			} else if (d.kind !== 'patch') {
				res = { outcome: 'RECOMPILE', latencyMs: null, reasons: [d.kind + (d.reason ? ':' + d.reason : d.env ? ':' + d.env : '')] };
			} else {
				await page.evaluate(([req, r, b, f]) => window.__live.patch(req, r, b, f), [d, root, buf, file]);
				const ev = await collectUntilQuiet(page, { maxMs: 20000 });
				res = classify(ev);
				const t1 = ev[0]?.t ?? 0;
				res.events = ev.map((e) => `${Math.round(e.t - t1)} ${e.kind} ${JSON.stringify(e.detail ?? '').slice(0, 160)}`);
			}
			const wall = Date.now() - t0;
			console.log(`${file}:${i + 1} ${res.outcome} ${res.latencyMs ?? '-'}ms (wall ${wall}) ${res.reasons.join(',')}`);
			rows.push({ file, line: i + 1, ...res, wall });
			// back to the baseline: the file as it was, compiled
			await post('/write', { root, file, content: base });
			await page.evaluate(() => window.__live.recompile());
			await collectUntilQuiet(page, { quietMs: 1200, maxMs: 30000 });
		}
	}
	await browser.close();
} finally {
	bridge.kill();
	vite.kill();
}
const by = {};
for (const r of rows) by[r.outcome] = (by[r.outcome] ?? 0) + 1;
const reasons = {};
for (const r of rows) if (r.outcome !== 'EXACT') for (const x of r.reasons) reasons[x] = (reasons[x] ?? 0) + 1;
console.log('\nOUTCOMES', JSON.stringify(by));
console.log('NON-EXACT REASONS', JSON.stringify(reasons, null, 1));
const out = path.join(root, '..', `project-matrix-${Date.now()}.json`);
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
console.log('written', out);
void execSync;
