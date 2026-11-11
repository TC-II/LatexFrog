// On Windows a program inherits PATH from whoever started it, usually Explorer. Explorer reads PATH once,
// when the session starts: a TeX installed afterwards is on the PATH saved in the registry but not on the
// one Explorer hands out, so a double-clicked app (or .bat) does not find lualatex until the user signs out.
// The saved PATH is read here and every folder missing from ours is added at the end, before anything is spawned,
// and then TeX Live's standard folders (see texLiveDirs).
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const KEYS = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'];

/** the Path value in `reg query` output, %VARS% expanded; null when the key has none */
export function pathFromRegQuery(out: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out);
	if (!m) return null;
	return m[1].trim().replace(/%([^%;]+)%/g, (all, name: string) => {
		const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
		return key ? env[key]! : all;
	});
}

/** `current` with the folders of `saved` it lacks added at the end, in order and once each */
export function mergePath(current: string, saved: string[]): string {
	const norm = (p: string) => path.win32.normalize(p).replace(/\\+$/, '').toLowerCase();
	const parts = current.split(';').filter(Boolean);
	const seen = new Set(parts.map(norm));
	for (const list of saved) {
		for (const dir of list.split(';').map((d) => d.trim())) {
			if (!dir || seen.has(norm(dir))) continue;
			seen.add(norm(dir));
			parts.push(dir);
		}
	}
	return parts.join(';');
}

/** call once at startup, before any child process: a few ms of `reg query` */
export function addSavedWindowsPath(): void {
	if (process.platform !== 'win32') return;
	const saved: string[] = [];
	for (const key of KEYS) {
		try {
			const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
			const p = pathFromRegQuery(out);
			if (p) saved.push(p);
		} catch {
			// no such value, or reg could not run: keep what we inherited
		}
	}
	saved.push(...texLiveDirs());
	// where Claude Code's own installer puts claude.exe; it does not always add the folder to PATH
	if (process.env.USERPROFILE) saved.push(path.win32.join(process.env.USERPROFILE, '.local', 'bin'));
	if (!saved.length) return;
	const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path';
	process.env[key] = mergePath(process.env[key] ?? '', saved);
}

/**
 * TeX Live's own install folders (C:\texlive\<year>\bin\windows), newest first, last on PATH so the user's
 * choice wins. A TeX Live installed from inside a packaged app (MSIX) into AppData lands in that app's private
 * copy of AppData, which no other program sees: its PATH entry is there and its files are not.
 */
export function texLiveDirs(root = 'C:\\texlive'): string[] {
	try {
		return fs
			.readdirSync(root)
			.filter((y) => /^\d{4}$/.test(y))
			.sort()
			.reverse()
			.map((y) => path.win32.join(root, y, 'bin', 'windows'))
			.filter((d) => fs.existsSync(path.win32.join(d, 'tex.exe')) || fs.existsSync(path.win32.join(d, 'lualatex.exe')));
	} catch {
		return [];
	}
}
