// The compile engine as a long-lived process: one lv-sidecar per window, JSON lines both ways (docs/protocol.md). Requests
// are matched to their answers by id; events go to the window that owns the process. Closing stdin makes the sidecar cancel
// and exit, so a closed window leaves nothing compiling.
import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

type Answer = { ok: boolean; data?: unknown; error?: string };
type Sidecar = { proc: ChildProcessWithoutNullStreams; pending: Map<number, (a: Answer) => void> };

const EXE = process.platform === 'win32' ? 'lv-sidecar.exe' : 'lv-sidecar';
const sidecars = new Map<number, Sidecar>();
let nextId = 1;

/** LV_SIDECAR, then the copy the installer ships, then the repository's release build, then the PATH */
function executable(): string {
	if (process.env.LV_SIDECAR) return process.env.LV_SIDECAR;
	const candidates = [join(process.resourcesPath, EXE), join(app.getAppPath(), 'target', 'release', EXE)];
	return candidates.find((p) => existsSync(p)) ?? 'lv-sidecar';
}

function sidecarFor(owner: WebContents): Sidecar {
	const running = sidecars.get(owner.id);
	if (running) return running;
	const proc = spawn(executable(), [], { windowsHide: true });
	const sidecar: Sidecar = { proc, pending: new Map() };
	sidecars.set(owner.id, sidecar);
	createInterface({ input: proc.stdout }).on('line', (line) => {
		let msg: { type?: string; id?: number; event?: unknown } & Answer;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.type === 'response' && typeof msg.id === 'number') {
			sidecar.pending.get(msg.id)?.({ ok: msg.ok, data: msg.data, error: msg.error });
			sidecar.pending.delete(msg.id);
		} else if (msg.type === 'event' && !owner.isDestroyed()) {
			owner.send('lv:event', msg.event);
		}
	});
	const gone = (error: string) => {
		if (sidecars.get(owner.id) === sidecar) sidecars.delete(owner.id);
		for (const done of sidecar.pending.values()) done({ ok: false, error });
		sidecar.pending.clear();
	};
	proc.on('error', (e) => gone(e.message));
	proc.on('close', () => gone('lv-sidecar exited'));
	proc.stderr.resume();
	owner.once('destroyed', () => proc.stdin.end());
	return sidecar;
}

export function registerLvSidecarIpc(): void {
	ipcMain.handle('lv:request', (e, request: unknown) => {
		if (typeof request !== 'object' || request === null) return { ok: false, error: 'bad request' };
		return new Promise<Answer>((resolve) => {
			const id = nextId++;
			try {
				const sidecar = sidecarFor(e.sender);
				sidecar.pending.set(id, resolve);
				sidecar.proc.stdin.write(JSON.stringify({ ...request, id }) + '\n');
			} catch (err) {
				resolve({ ok: false, error: String(err) });
			}
		});
	});
}
