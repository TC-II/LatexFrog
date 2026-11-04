// Latex Frog's build engine (lv-core) as a sidecar: the panel asks it for the project's profiles and parts
// (`--info`) and changes the active profile or the ticked parts. Compiling itself still goes through the
// project's compile command in the terminal, so this never builds anything.
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';

const TIMEOUT_MS = 60_000;

/** the only shapes the panel may send: a flag, or a flag with one value. No shell is involved (argv array) */
function checkArgs(args: unknown): string[] | null {
	if (!Array.isArray(args) || args.length > 8) return null;
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (typeof a !== 'string') return null;
		if (a === '--info') out.push(a);
		else if (a === '--activar' || a === '--parts') {
			const v = args[++i];
			if (typeof v !== 'string' || v.includes('\0') || v.startsWith('-')) return null;
			out.push(a, v);
		} else return null;
	}
	return out;
}

export function registerLvIpc(): void {
	ipcMain.handle('lv:run', (_e, root: unknown, args: unknown) => {
		const argv = checkArgs(args);
		if (typeof root !== 'string' || !root || !argv) return { ok: false, error: 'bad arguments' };
		return new Promise((resolve) => {
			const exe = process.env.LV_BUILD || 'lv-build';
			const child = spawn(exe, ['.', ...argv], { cwd: root, windowsHide: true });
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
			child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
			const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
			child.on('error', (err) => {
				clearTimeout(timer);
				resolve({ ok: false, error: err.message });
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				resolve({ ok: code === 0, code, stdout, stderr: stderr.slice(-2000) });
			});
		});
	});
}
