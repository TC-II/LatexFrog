// Minimal JSON-lines client for lv-sidecar.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export function startSidecar(exe, env = {}) {
	const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
	const rl = readline.createInterface({ input: p.stdout });
	const pending = new Map();
	const events = [];
	const waiters = [];
	let nextId = 1;
	rl.on('line', (line) => {
		let m;
		try {
			m = JSON.parse(line);
		} catch {
			return;
		}
		if (m.type === 'response') {
			const w = pending.get(m.id);
			if (w) {
				pending.delete(m.id);
				w(m);
			}
		} else if (m.type === 'event') {
			events.push(m.event);
			for (const w of [...waiters]) w(m.event);
		}
	});
	const req = (cmd, fields = {}, timeoutMs = 120000) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			const t = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`timeout ${cmd}`));
			}, timeoutMs);
			pending.set(id, (m) => {
				clearTimeout(t);
				resolve(m);
			});
			p.stdin.write(JSON.stringify({ id, cmd, ...fields }) + '\n');
		});
	const waitEvent = (pred, timeoutMs) =>
		new Promise((resolve, reject) => {
			const hit = events.find(pred);
			if (hit) return resolve(hit);
			const t = setTimeout(() => {
				waiters.splice(waiters.indexOf(w), 1);
				reject(new Error('timeout waiting event'));
			}, timeoutMs);
			const w = (e) => {
				if (pred(e)) {
					clearTimeout(t);
					waiters.splice(waiters.indexOf(w), 1);
					resolve(e);
				}
			};
			waiters.push(w);
		});
	const close = () => {
		try {
			p.stdin.end();
		} catch {}
	};
	return { req, events, waitEvent, close, proc: p };
}
