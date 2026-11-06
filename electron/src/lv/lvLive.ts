// The live preview's TeX processes, started by lv-sidecar (`live-*` in docs/protocol.md) so every TeX run goes through
// the engine. One sidecar for the main process, apart from the windows' build sidecars: the draft code runs here and
// serves whichever window owns the preview. `liveSpawn` and `liveExecFile` stand in for node's spawn and execFile with
// the part of ChildProcess the draft code uses: stdout/stderr streams, stdin.write, kill, and exit/close/error.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

type Answer = { ok: boolean; data?: unknown; error?: string };
type LiveEvent = { kind: 'out'; proc: number; stream: 'out' | 'err'; data: string } | { kind: 'exit'; proc: number; code: number | null };

/** set by main to the window sidecars' lookup; the test harness, without electron, names the binary in LV_SIDECAR */
let executable = (): string => process.env.LV_SIDECAR ?? 'lv-sidecar';
export function useSidecarExecutable(find: () => string): void {
	executable = find;
}

let sidecar: { proc: ChildProcessWithoutNullStreams; pending: Map<number, (a: Answer) => void> } | null = null;
const procs = new Map<number, LiveProcess>();
let nextId = 1;

function connect(): NonNullable<typeof sidecar> {
	if (sidecar) return sidecar;
	const proc = spawn(executable(), [], { windowsHide: true });
	const s = { proc, pending: new Map<number, (a: Answer) => void>() };
	sidecar = s;
	createInterface({ input: proc.stdout }).on('line', (line) => {
		let msg: { type?: string; id?: number; event?: LiveEvent } & Answer;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.type === 'response' && typeof msg.id === 'number') {
			s.pending.get(msg.id)?.(msg);
			s.pending.delete(msg.id);
		} else if (msg.type === 'live' && msg.event) {
			procs.get(msg.event.proc)?.deliver(msg.event);
		}
	});
	const gone = (error: string) => {
		if (sidecar === s) sidecar = null;
		for (const done of s.pending.values()) done({ ok: false, error });
		s.pending.clear();
		for (const p of procs.values()) p.deliver({ kind: 'exit', proc: p.proc, code: null });
	};
	proc.on('error', (e) => gone(e.message));
	proc.on('close', () => gone('lv-sidecar exited'));
	proc.stderr.resume();
	return s;
}

function request(body: Record<string, unknown>, answer = true): Promise<Answer> {
	const s = connect();
	const id = nextId++;
	return new Promise((resolve) => {
		if (answer) s.pending.set(id, resolve);
		else resolve({ ok: true });
		s.proc.stdin.write(JSON.stringify({ ...body, id }) + '\n');
	});
}

/** LV_LIVE_TRACE=<file>: one line per start, write, first output after a write and exit, with ms since the first event */
const TRACE = process.env.LV_LIVE_TRACE;
const t0 = Date.now();
function trace(proc: number, what: string): void {
	if (TRACE) appendFileSync(TRACE, `${Date.now() - t0}\t${proc}\t${what}\n`);
}

type SpawnOpts = { cwd: string; env?: NodeJS.ProcessEnv; stdin?: boolean };

/** what the sidecar lets a live request set; everything else comes from the sidecar's own environment */
function envOf(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
	const src = env ?? process.env;
	const out: Record<string, string> = {};
	for (const k of ['PATH', 'BIBINPUTS', 'BSTINPUTS', 'TEXINPUTS']) if (src[k] !== undefined) out[k] = src[k]!;
	return out;
}

export class LiveProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	proc = 0;
	exitCode: number | null = null;
	killed = false;
	private ended = false;
	private queued: string[] = [];
	stdin = { write: (data: string) => this.write(data) };

	constructor(tool: string, args: string[], opts: SpawnOpts) {
		super();
		request({ cmd: 'live-start', tool, args, cwd: opts.cwd, env: envOf(opts.env), stdin: !!opts.stdin }).then((a) => {
			if (!a.ok) return this.fail(new Error(a.error ?? 'live-start failed'));
			this.proc = (a.data as { proc: number }).proc;
			trace(this.proc, `start ${tool} ${args.join(' ').slice(-60)}`);
			procs.set(this.proc, this);
			if (this.killed) return void request({ cmd: 'live-kill', proc: this.proc });
			for (const d of this.queued) void request({ cmd: 'live-write', proc: this.proc, data: d, quiet: true }, false);
			this.queued = [];
		});
	}

	private waiting = false;

	private write(data: string): boolean {
		if (this.ended) return false;
		trace(this.proc, `write ${JSON.stringify(data.slice(0, 50))}`);
		this.waiting = true;
		if (!this.proc) this.queued.push(data);
		else void request({ cmd: 'live-write', proc: this.proc, data, quiet: true }, false);
		return true;
	}

	kill(_signal?: string): boolean {
		if (this.ended) return false;
		this.killed = true;
		if (this.proc) void request({ cmd: 'live-kill', proc: this.proc });
		return true;
	}

	deliver(ev: LiveEvent): void {
		if (ev.kind === 'out') {
			if (this.waiting && TRACE) trace(this.proc, `out ${ev.data.length} bytes`);
			if (ev.data.includes('@@R ')) this.waiting = false;
			(ev.stream === 'out' ? this.stdout : this.stderr).write(ev.data);
		} else {
			trace(this.proc, `exit ${ev.code}`);
			this.finish(ev.code);
		}
	}

	private fail(err: Error): void {
		if (this.ended) return;
		this.ended = true;
		this.stdout.end();
		this.stderr.end();
		this.emit('error', Object.assign(err, { code: /not found|No such file/i.test(err.message) ? 'ENOENT' : undefined }));
	}

	private finish(code: number | null): void {
		if (this.ended) return;
		this.ended = true;
		this.exitCode = code;
		procs.delete(this.proc);
		this.stdout.end();
		this.stderr.end();
		const signal = code === null ? 'SIGKILL' : null;
		this.emit('exit', code, signal);
		this.emit('close', code, signal);
	}
}

/** spawn() through the sidecar; lualatex, biber and bibtex only */
export function liveSpawn(tool: string, args: string[], opts: SpawnOpts): LiveProcess {
	return new LiveProcess(tool, args, { stdin: true, ...opts });
}

/** execFile() through the sidecar: collects the output and calls back once, with an error on a failed or timed-out run */
export function liveExecFile(
	tool: string,
	args: string[],
	opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
	done: (err: Error | null, stdout: string, stderr: string) => void
): LiveProcess {
	const child = new LiveProcess(tool, args, { cwd: opts.cwd, env: opts.env, stdin: false });
	let out = '';
	let err = '';
	child.stdout.on('data', (d) => (out += d));
	child.stderr.on('data', (d) => (err += d));
	const timer = opts.timeout ? setTimeout(() => child.kill(), opts.timeout) : null;
	let called = false;
	const once = (e: Error | null) => {
		if (called) return;
		called = true;
		if (timer) clearTimeout(timer);
		done(e, out, err);
	};
	child.on('close', (code: number | null) => once(code === 0 ? null : new Error(`${tool} exited with ${code}`)));
	child.on('error', (e: Error) => once(e));
	return child;
}

/** the app is quitting: the sidecar kills what it runs when its stdin closes */
export function stopLive(): void {
	sidecar?.proc.stdin.end();
}
