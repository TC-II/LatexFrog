// The window's end of the compile engine. A folder with a latexfrog.json (or a latexviewer.json still to migrate) is an
// engine project: Compile, Stop and the Problems panel go through the sidecar, and the terminal path stays for other folders.
import type { LogEntry } from '$lib/compileLog/compileLog';
import type { CompileLogState } from '$lib/stores/compileLogStore';
import { joinPath } from '$lib/workspace/fileSystem';

export type Profile = { id: string; label: string; parts: string; hidden: boolean; color: string | null };
export type ProjectView = {
	root: string;
	rootFile: string | null;
	config: { profiles: Profile[] } | null;
	state: { activeProfile: string | null; selection: string[] };
	parts: { name: string }[];
	lockedBy: number | null;
};
export type Problem = {
	severity: 'error' | 'warning' | 'badbox';
	kind: string;
	message: string;
	file: string | null;
	line: number | null;
	line_end: number | null;
	context: string;
};
export type Finished = { type: 'finished'; profile: string; ok: boolean; cancelled: boolean; pdf: string | null; updated: boolean };
type EngineEvent = Finished | { type: 'pass'; n: number; tool: string } | { type: 'started'; profile: string } | { type: 'error'; message: string };

/** builds the engine runs for other jobs: their results never replace the document's PDF or problems */
const SERVICE_PROFILES = new Set(['export', 'fragmento', 'cocina']);

export function toLogState(problems: Problem[], profile: string): CompileLogState {
	const entries: LogEntry[] = problems.map((p) => ({
		level: p.severity,
		message: p.message,
		file: p.file ?? undefined,
		line: p.line ?? undefined,
		lineEnd: p.line_end ?? undefined,
		context: p.context || undefined,
		raw: p.message,
		source: p.kind === 'biber' ? 'bib' : undefined
	}));
	const of = (level: LogEntry['level']) => entries.filter((e) => e.level === level);
	return {
		entries,
		errors: of('error'),
		warnings: of('warning'),
		badboxes: of('badbox'),
		files: [],
		status: { fatal: false, emergencyStop: false, noPages: false },
		logPath: `.latexfrog/build/${profile}`,
		updatedAt: Date.now()
	};
}

class LvProject {
	view = $state<ProjectView | null>(null);
	/** what the running build is doing, for the status line */
	progress = $state('');
	/** settles once the current folder is known to be an engine project or not; Compile waits for it */
	ready: Promise<void> = Promise.resolve();
	onFinished: ((ev: Finished) => void) | null = null;
	onError: ((message: string) => void) | null = null;
	private listeners = new Set<(event: unknown) => void>();

	/** every engine event, for panels; returns the unsubscribe */
	subscribe(listener: (event: unknown) => void) {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	}

	get active(): boolean {
		return this.view !== null;
	}

	async request<T>(cmd: string, fields: object = {}): Promise<T> {
		const engine = window.lvEngine;
		if (!engine) throw new Error('The compile engine is not available');
		const r = await engine.request({ cmd, ...fields });
		if (!r.ok) throw new Error(r.error ?? `${cmd} failed`);
		return r.data as T;
	}

	/** a folder was opened (or closed): open it in the engine if it is an engine project */
	sync(root: string | null, exists: (path: string) => Promise<boolean>) {
		this.ready = this.open(root, exists).catch((e) => {
			this.view = null;
			this.onError?.(e instanceof Error ? e.message : String(e));
		});
		return this.ready;
	}

	private async open(root: string | null, exists: (path: string) => Promise<boolean>) {
		const wasActive = this.active;
		this.view = null;
		this.progress = '';
		if (wasActive) await this.request('close');
		if (!root) return;
		const known = (await exists(joinPath(root, 'latexfrog.json'))) || (await exists(joinPath(root, 'latexviewer.json')));
		if (!known) return;
		this.view = (await this.request<{ project: ProjectView }>('open', { root })).project;
	}

	async refresh() {
		this.view = await this.request<ProjectView>('view');
	}

	async setState(fields: object) {
		await this.request('set-state', fields);
		await this.refresh();
	}

	compile = () => this.request('compile');

	async cancel(): Promise<boolean> {
		return (await this.request<{ cancelled: boolean }>('cancel')).cancelled;
	}

	problems = (profile: string) => this.request<Problem[]>('problems', { profile });

	/** the newest PDF on disk that holds the document, absolute */
	async existingPdf(): Promise<string | null> {
		const v = this.view;
		if (!v?.rootFile) return null;
		const pdf = await this.request<string | null>('pdf-for', { file: v.rootFile });
		return pdf ? joinPath(v.root, pdf) : null;
	}

	handle(ev: EngineEvent) {
		for (const listener of this.listeners) listener(ev);
		if (ev.type === 'started') this.progress = `Compiling (${ev.profile})`;
		else if (ev.type === 'pass') this.progress = `${ev.tool}, pass ${ev.n}`;
		else if (ev.type === 'error') this.onError?.(ev.message);
		else if (ev.type === 'finished' && !SERVICE_PROFILES.has(ev.profile)) {
			this.progress = '';
			this.onFinished?.(ev);
		}
	}
}

export const lvProject = new LvProject();

window.lvEngine?.onEvent((event) => lvProject.handle(event as EngineEvent));
