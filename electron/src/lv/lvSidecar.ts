// Latex Frog's engine as a long-lived process: one lv-sidecar per app, JSON lines both ways. Requests are matched to
// their answers by id; build events are forwarded to the window that last asked. LV_SIDECAR names the executable,
// else lv-sidecar on the PATH. With neither, every request answers ok: false and the panel stays out of the way.
import { ipcMain, type WebContents } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

type Answer = { ok: boolean; datos?: unknown; error?: string };

let child: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
let listener: WebContents | null = null;
const pending = new Map<number, (a: Answer) => void>();

function settleAll(error: string) {
	for (const done of pending.values()) done({ ok: false, error });
	pending.clear();
}

function ensureChild(): ChildProcessWithoutNullStreams {
	if (child) return child;
	const proc = spawn(process.env.LV_SIDECAR || 'lv-sidecar', [], { windowsHide: true });
	child = proc;
	createInterface({ input: proc.stdout }).on('line', (line) => {
		let msg: { tipo?: string; id?: number; evento?: unknown } & Answer;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.tipo === 'respuesta' && typeof msg.id === 'number') {
			pending.get(msg.id)?.({ ok: msg.ok, datos: msg.datos, error: msg.error });
			pending.delete(msg.id);
		} else if (msg.tipo === 'evento' && listener && !listener.isDestroyed()) {
			listener.send('lv:evento', msg.evento);
		}
	});
	const gone = (error: string) => {
		if (child === proc) child = null;
		settleAll(error);
	};
	proc.on('error', (e) => gone(e.message));
	proc.on('close', () => gone('lv-sidecar exited'));
	proc.stderr.resume();
	return proc;
}

export function registerLvSidecarIpc(): void {
	ipcMain.handle('lv:pedir', (e, request: unknown) => {
		if (typeof request !== 'object' || request === null) return { ok: false, error: 'bad request' };
		listener = e.sender;
		return new Promise<Answer>((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			try {
				ensureChild().stdin.write(JSON.stringify({ ...request, id }) + '\n');
			} catch (err) {
				pending.delete(id);
				resolve({ ok: false, error: String(err) });
			}
		});
	});
}
