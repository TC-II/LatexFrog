// The window's end of the compile engine. A folder with a latexfrog.json (or a latexviewer.json still to migrate) is an
// engine project: Compile, Stop and the Problems panel go through the sidecar, and the terminal path stays for other folders.
import type { LogEntry } from '$lib/compileLog/compileLog';
import type { CompileLogState } from '$lib/stores/compileLogStore';
import { pdfStore } from '$lib/stores/pdfStore';
import { fileUrl, joinPath, relativeTo } from '$lib/workspace/fileSystem';
import { activeFilePath } from '$lib/workspace/workspaceStore';

export type Profile = { id: string; label: string; parts: string; hidden: boolean; color: string | null; draftImages: boolean; publica: boolean };
export type Variable = { name: string; label: string; choices: string[]; default: string | null };
export type FileInfo = { part: string | null; affects: 'yes' | 'other_part' | 'unrelated'; profileAuto: boolean; partsChanged: boolean };
export type Typical = { ms: number; pasadas: number; n: number };
export type Progress = { profile: string; startedAt: number; tool: string | null; pass: number };
export type ProjectView = {
	root: string;
	rootFile: string | null;
	config: { profiles: Profile[]; variables: Variable[] } | null;
	state: { activeProfile: string | null; selection: string[]; variables: Record<string, string>; draftImages: boolean };
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
export type Section = { level: number; title: string; file: string; line: number; label: string | null };
export type Symbols = { sections: Section[] };
type Rect = { page: number; x: number; y: number; w: number; h: number };
type SyncForward = { perfil: string; pdf: string; page: number; rects: Rect[]; line_used: number };
type SyncInverse = { file: string | null; line: number; inside: boolean };
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
	progress = $state<Progress | null>(null);
	/** the part of the active file, and whether the active profile builds it */
	fileInfo = $state<FileInfo | null>(null);
	/** profile id to its usual duration, from the project's history */
	typical = $state<Record<string, Typical>>({});
	/** bumped when a build ends: the project index may have moved */
	revision = $state(0);
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
		this.progress = null;
		this.fileInfo = null;
		this.typical = {};
		if (wasActive) await this.request('close');
		if (!root) return;
		const known = (await exists(joinPath(root, 'latexfrog.json'))) || (await exists(joinPath(root, 'latexviewer.json')));
		if (!known) return;
		this.view = (await this.request<{ project: ProjectView }>('open', { root })).project;
		await this.loadTypical();
	}

	async refresh() {
		this.view = await this.request<ProjectView>('view');
	}

	async setState(fields: object) {
		await this.request('set-state', fields);
		await this.refresh();
	}

	async loadTypical() {
		this.typical = await this.request<Record<string, Typical>>('typical-times');
	}

	/** tells the engine which file is being worked on: a `current` profile builds that file's part */
	async noteActiveFile() {
		const root = this.view?.root.replace(/\\/g, '/');
		const path = activeFilePath.current?.replace(/\\/g, '/');
		if (!root || !path?.toLowerCase().startsWith(root.toLowerCase() + '/')) {
			this.fileInfo = null;
			return;
		}
		const info = await this.request<FileInfo>('file-info', { file: path.slice(root.length + 1) }).catch(() => null);
		this.fileInfo = info;
		if (info?.partsChanged) await this.refresh();
	}

	async compile() {
		await this.noteActiveFile();
		return this.request('compile');
	}

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

	symbols = () => this.request<Symbols>('symbols');

	/** the profile whose PDF the viewer shows: a click there must resolve against that build, not the active profile's */
	private shownProfile(): string | null {
		const url = pdfStore.current;
		const shown = typeof url === 'string' ? decodeURIComponent(url).match(/[\\/]build[\\/]([^\\/]+)[\\/]/)?.[1] : undefined;
		return shown ?? this.view?.state.activeProfile ?? null;
	}

	/** a source line to its place in the PDF, in the shape the viewer takes: h and v are the box's left and baseline */
	async syncForward(path: string, line: number) {
		const v = this.view;
		if (!v) return null;
		const file = relativeTo(v.root, path).replace(/\\/g, '/');
		const res = await this.request<SyncForward | null>('synctex-forward', { file, line });
		const box = res?.rects[0];
		if (!res || !box) return null;
		// the newest PDF holding this file may not be the one on screen
		const pdf = joinPath(v.root, res.pdf);
		const shown = pdfStore.current;
		const target = fileUrl(pdf);
		if (typeof shown !== 'string' || !shown.startsWith(target)) pdfStore.current = target + '&t=' + Date.now();
		return { page: res.page, h: box.x, v: box.y + box.h, width: box.w, height: box.h };
	}

	/** a place in the shown PDF to its source line; null when it comes from outside the project */
	async syncInverse(page: number, x: number, y: number) {
		const v = this.view;
		const profile = this.shownProfile();
		if (!v || !profile) return null;
		const res = await this.request<SyncInverse | null>('synctex-inverse', { profile, page, x, y });
		return res?.file && res.line >= 1 ? { file: joinPath(v.root, res.file), line: res.line } : null;
	}

	handle(ev: EngineEvent) {
		for (const listener of this.listeners) listener(ev);
		if (ev.type === 'started') {
			if (!SERVICE_PROFILES.has(ev.profile)) this.progress = { profile: ev.profile, startedAt: Date.now(), tool: null, pass: 0 };
		} else if (ev.type === 'pass') {
			if (this.progress) this.progress = { ...this.progress, tool: ev.tool, pass: ev.n };
		}
		else if (ev.type === 'error') this.onError?.(ev.message);
		else if (ev.type === 'finished' && !SERVICE_PROFILES.has(ev.profile)) {
			this.progress = null;
			void this.loadTypical().catch(() => {});
			this.revision++;
			this.onFinished?.(ev);
		}
	}
}

export const lvProject = new LvProject();

window.lvEngine?.onEvent((event) => lvProject.handle(event as EngineEvent));
