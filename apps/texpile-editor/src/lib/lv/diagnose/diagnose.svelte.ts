// AI explanations for compile errors, spent with care. An error is explained at most once: its fingerprint
// keys a cache kept across sessions. Without being asked, only the first error of a failed compile that no
// local rule recognises is sent, and every call counts against an hourly budget. The rest wait for Explain.
import { compileLog, resolveLogPath } from '$lib/stores/compileLogStore';
import { workspaceRoot, mainFile } from '$lib/workspace/workspaceStore';
import type { LogEntry } from '$lib/compileLog/types';
import { m } from '$lib/paraglide/messages';
import { lvAi, type LineFix } from '../autosync/lvAi';
import { autoSync } from '../autosync/autoSync.svelte';
import { addPackage, applyLineFix, autoCandidate, budget, fingerprint, sourceWindow } from './diagnoseCore';

export type Diagnosis =
	| { state: 'loading' }
	| { state: 'done'; explanation: string; fix: (LineFix & { file: string; before: string }) | null; by: string; at: number }
	| { state: 'failed'; message: string; noKeys: boolean };

const CACHE_KEY = 'lv.diagnose.cache';
const CALLS_KEY = 'lv.diagnose.calls';
const AUTO_KEY = 'lv.diagnose.auto';
const CACHE_MAX = 300;

function read<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(key);
		return v === null ? fallback : (JSON.parse(v) as T);
	} catch {
		return fallback;
	}
}
function write(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* storage blocked: the cache lasts this session */
	}
}

class Diagnose {
	/** by fingerprint: what is known about each error */
	byPrint = $state<Record<string, Diagnosis>>(read(CACHE_KEY, {}));
	calls = $state<number[]>(read(CALLS_KEY, []));
	/** explain the unknown error of a failed compile without being asked */
	auto = $state<boolean>(read(AUTO_KEY, true));
	#lastAutoLog = 0;

	get left(): number {
		return budget(this.calls).left;
	}

	of(e: LogEntry): Diagnosis | undefined {
		return this.byPrint[fingerprint(e)];
	}

	setAuto(on: boolean): void {
		this.auto = on;
		write(AUTO_KEY, on);
	}

	/** a new log arrived: maybe one automatic call, never twice for the same log or the same error */
	onLog(): void {
		const log = compileLog.current;
		if (!log || !this.auto || log.updatedAt === this.#lastAutoLog) return;
		this.#lastAutoLog = log.updatedAt;
		const e = autoCandidate(log);
		if (e && !this.of(e)) void this.explain(e, false);
	}

	/** `asked`: the author pressed Explain; a failed earlier try is tried again */
	async explain(e: LogEntry, asked = true): Promise<void> {
		const print = fingerprint(e);
		const known = this.byPrint[print];
		if (known?.state === 'loading' || known?.state === 'done' || (known?.state === 'failed' && !asked)) return;
		const ai = lvAi();
		if (!ai?.explain) return this.#set(print, { state: 'failed', message: m.lv_diag_ai_no_app(), noKeys: true });
		const b = budget(this.calls);
		if (!b.allowed) return this.#set(print, { state: 'failed', message: m.lv_diag_ai_budget(), noKeys: false });

		this.#set(print, { state: 'loading' });
		const root = workspaceRoot.current ?? '';
		const file = resolveLogPath(root, e.file);
		const text = file ? await autoSync.host?.readText(file) : null;
		const lines = text && e.line ? sourceWindow(text, e.line) : [];
		this.calls = [...b.recent, Date.now()];
		write(CALLS_KEY, this.calls);
		const answer = await ai.explain({
			message: e.message,
			context: (e.context ?? e.raw ?? '').slice(0, 2000),
			file: e.file ?? '',
			lines,
			line: e.line ?? null
		});
		if (!answer.ok) {
			const noKeys = answer.why !== 'bad-answer';
			return this.#set(print, { state: 'failed', message: noKeys ? m.lv_autosync_why_keys_failed() : m.lv_autosync_why_bad(), noKeys });
		}
		const fix =
			answer.fix && file
				? {
						...answer.fix,
						file,
						before: lines
							.filter((l) => l.n >= answer.fix!.from && l.n <= answer.fix!.to)
							.map((l) => l.text)
							.join('\n')
					}
				: null;
		this.#set(print, { state: 'done', explanation: answer.explanation, fix, by: answer.by, at: Date.now() });
	}

	/** write the AI's lines into the file, if the lines it saw are still there */
	async applyFix(e: LogEntry): Promise<boolean> {
		const d = this.of(e);
		const host = autoSync.host;
		if (d?.state !== 'done' || !d.fix || !host) return false;
		if (host.hasPendingSave()) await host.flushPendingSave();
		const text = await host.readText(d.fix.file);
		const next = text === null ? null : applyLineFix(text, d.fix, d.fix.before);
		if (next === null) return false;
		await host.writeText(d.fix.file, next);
		await this.#reloadIfOpen(d.fix.file);
		// applied: the cached fix would no longer match, the explanation stays
		this.#set(fingerprint(e), { ...d, fix: null });
		return true;
	}

	/** the local fix for a missing package: no AI involved */
	async addPackage(pkg: string): Promise<boolean> {
		const host = autoSync.host;
		const main = mainFile.current;
		if (!host || !main) return false;
		if (host.hasPendingSave()) await host.flushPendingSave();
		const text = await host.readText(main);
		const next = text === null ? null : addPackage(text, pkg);
		if (next === null) return false;
		await host.writeText(main, next);
		await this.#reloadIfOpen(main);
		return true;
	}

	async #reloadIfOpen(path: string): Promise<void> {
		const host = autoSync.host;
		const open = host?.getLoadedPath();
		if (host && open && open.replace(/\\/g, '/').toLowerCase() === path.replace(/\\/g, '/').toLowerCase()) await host.loadFile(open);
	}

	#set(print: string, d: Diagnosis): void {
		this.byPrint = { ...this.byPrint, [print]: d };
		// only answers are kept; a failure or a call under way is this session's
		const done = Object.entries(this.byPrint).filter(([, v]) => v.state === 'done');
		write(CACHE_KEY, Object.fromEntries(done.slice(-CACHE_MAX)));
	}
}

export const diagnose = new Diagnose();
