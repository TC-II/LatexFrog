// The window's end of the compile engine. A folder with a latexfrog.json (or a latexviewer.json still to migrate) is an
// engine project: Compile, Stop and the Problems panel go through the sidecar, and the terminal path stays for other folders.
import { m } from '$lib/paraglide/messages';
import type { LogEntry } from '$lib/compileLog/compileLog';
import type { CompileLogState } from '$lib/stores/compileLogStore';
import { pdfStore } from '$lib/stores/pdfStore';
import { fileUrl, joinPath, relativeTo, revealItem } from '$lib/workspace/fileSystem';
import { activeFilePath, mainFile, setMainFile } from '$lib/workspace/workspaceStore';
import { clearFollowMark } from './lvSync';
import { toaster } from '$lib/modals/toaster-svelte';

export type Profile = { id: string; label: string; parts: string; hidden: boolean; color: string | null; draftImages: boolean; publica: boolean; partList: string[]; compileOn: string | null; output?: { dir: string; pattern: string; perPart?: boolean } | null };
export type Variable = { name: string; label: string; choices: string[]; default: string | null };
export type FileInfo = { part: string | null; affects: 'yes' | 'other_part' | 'unrelated'; profileAuto: boolean; partsChanged: boolean };
export type OutlineTab = 'contents' | 'parts' | 'figures';
export type Typical = { ms: number; pasadas: number; n: number };
export type Progress = { profile: string; startedAt: number; tool: string | null; pass: number; parts?: { done: number; total: number } };
export type ProjectView = {
	root: string;
	rootFile: string | null;
	config: { profiles: Profile[]; variables: Variable[] } | null;
	state: { activeProfile: string | null; selection: string[]; variables: Record<string, string>; draftImages: boolean; currentPart?: string | null; idleMs: number; autoCompile: string };
	parts: { name: string; file?: string | null }[];
	lockedBy: number | null;
	piezas: { clave: string; nombre: string; lugar?: string }[];
};
export type Finding = { id: string; nivel: 'ok' | 'info' | 'aviso' | 'error'; titulo: string; detalle: string; arreglo: string | null; archivo: string | null; linea: number | null };
export type DoctorReport = { hallazgos: Finding[]; ms: number; distribucion: string | null };
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
export type Rect = { page: number; x: number; y: number; w: number; h: number };
type SyncForward = { perfil: string; pdf: string; page: number; rects: Rect[]; line_used: number };
type SyncInverse = { file: string | null; line: number; inside: boolean };
export type Finished = { type: 'finished'; profile: string; ok: boolean; cancelled: boolean; pdf: string | null; updated: boolean };
type ExportEvent =
	| { type: 'export-started'; total: number }
	| { type: 'export-progress'; done: number; total: number }
	| { type: 'export-finished'; ok: boolean; cancelled: boolean; exported: number; failed: number; dir: string; error: string | null };
type EngineEvent =
	| Finished
	| ExportEvent
	| { type: 'pass'; n: number; tool: string }
	| { type: 'started'; profile: string }
	| { type: 'saved'; profile: string; file: string }
	| { type: 'bake-finished' }
	| { type: 'error'; message: string };

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
	/** the doctor's last report: its tab counts the warnings before anyone opens it */
	doctor = $state<DoctorReport | null>(null);
	doctorWarnings = $derived((this.doctor?.hallazgos ?? []).filter((f) => f.nivel === 'aviso' || f.nivel === 'error').length);
	/** the PDF follows the editor's cursor */
	follow = $state(true);
	/** settles once the current folder is known to be an engine project or not; Compile waits for it */
	ready: Promise<void> = Promise.resolve();
	onFinished: ((ev: Finished) => void) | null = null;
	onError: ((message: string) => void) | null = null;
	onCompile: (() => void) | null = null;
	onShowDock: ((view: 'leftover') => void) | null = null;
	/** which list the sidebar's Project outline shows */
	outlineTab = $state<OutlineTab>('contents');
	/** opens a project-relative file at a line */
	onOpenAt: ((file: string, line: number) => void) | null = null;
	/** the source editor at a project-relative file and line, whatever view is showing */
	onShowSource: ((file: string, line: number) => void) | null = null;
	/** bumped when the figure cache may have changed */
	figureRevision = $state(0);
	onFollow: (() => void) | null = null;
	isBusy: () => boolean = () => false;
	private pinnedPart = false;
	/** the profile saving one PDF per part, while it runs: its parts' builds report as one run */
	private exportingProfile: string | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private followTimer: ReturnType<typeof setTimeout> | null = null;
	private listeners = new Set<(event: unknown) => void>();

	/** every engine event, for panels; returns the unsubscribe */
	subscribe(listener: (event: unknown) => void) {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	}

	/** the engine holds this folder; true also while setting up a plain folder, when `view` is still null */
	private sessionOpen = false;
	private folder: { root: string | null; exists: (path: string) => Promise<boolean> } = { root: null, exists: async () => false };

	get folderRoot(): string | null {
		return this.folder.root;
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
		this.folder = { root, exists };
		this.ready = this.open(root, exists).catch((e) => {
			this.view = null;
			this.onError?.(e instanceof Error ? e.message : String(e));
		});
		return this.ready;
	}

	private async open(root: string | null, exists: (path: string) => Promise<boolean>) {
		const wasOpen = this.sessionOpen;
		this.view = null;
		this.progress = null;
		this.fileInfo = null;
		this.typical = {};
		this.doctor = null;
		this.sessionOpen = false;
		if (wasOpen) await this.request('close');
		if (!root) return;
		const known = (await exists(joinPath(root, 'latexfrog.json'))) || (await exists(joinPath(root, 'latexviewer.json')));
		if (!known) return;
		this.view = (await this.request<{ project: ProjectView }>('open', { root })).project;
		// The engine's root is the project's main file: without this the preview stays on "No main file" after a good build.
		if (this.view.rootFile && !mainFile.current?.endsWith(this.view.rootFile)) setMainFile(root, joinPath(root, this.view.rootFile));
		const profile = this.view.state.activeProfile;
		const lastPdf = profile && joinPath(root, `.latexfrog/build/${profile}/lv-${profile}.pdf`);
		if (lastPdf && !pdfStore.current && (await exists(lastPdf))) pdfStore.current = fileUrl(lastPdf) + '&t=' + Date.now();
		await this.loadTypical();
		this.sessionOpen = true;
		void import('./lvPanels').then((p) => p.offerOrphans());
		void this.runDoctor().catch(() => {});
	}

	async runDoctor() {
		this.doctor = await this.request<DoctorReport>('doctor');
	}

	/**
	 * A plain folder has to be open in the engine to detect and validate, but it stays a terminal project until a
	 * configuration is saved: `view` stays null, so Compile does not change under the user while they decide.
	 */
	async openForSetup() {
		const root = this.folder.root;
		if (!root || this.sessionOpen) return;
		await this.request('open', { root });
		this.sessionOpen = true;
	}

	/** after saving, or giving up on, a configuration: the folder is whatever its files now say */
	resync() {
		return this.sync(this.folder.root, this.folder.exists);
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
		// a part compiled by name stays that part; otherwise the open file says which one
		if (this.pinnedPart) this.pinnedPart = false;
		else await this.noteActiveFile();
		return this.request('compile');
	}

	private get activeProfile() {
		return this.view?.config?.profiles.find((p) => p.id === this.view?.state.activeProfile) ?? null;
	}

	/**
	 * One part, now: an accepted exception to compiling only through a profile. A profile of the current part builds it directly;
	 * otherwise it takes a profile of chosen parts, as in the Tauri app.
	 */
	async compilePart(name: string | null) {
		if (!name) return;
		const active = this.activeProfile;
		if (active?.parts === 'current') {
			await this.setState({ currentPart: name });
		} else {
			const chosen = active?.parts === 'selection' ? active : this.view?.config?.profiles.find((p) => p.parts === 'selection' && !p.hidden);
			if (!chosen) {
				this.onError?.('No profile compiles chosen parts: add one in Project Configuration');
				return;
			}
			await this.setState({ selection: [name], profile: chosen.id });
		}
		this.pinnedPart = true;
		this.onCompile?.();
	}

	/** Ctrl+Alt+C */
	async compileActivePart() {
		await this.noteActiveFile();
		if (!this.fileInfo?.part) {
			this.onError?.(m.lv_part_none());
			return;
		}
		await this.compilePart(this.fileInfo.part);
	}

	/** how this project compiles by itself, chosen beside Compile: on saving, once typing stops, or only by hand */
	get compileWhen(): 'save' | 'idle' | 'manual' {
		const when = this.view?.state.autoCompile;
		return when === 'idle' || when === 'manual' ? when : 'save';
	}

	setCompileWhen(when: 'save' | 'idle' | 'manual') {
		return this.setState({ autoCompile: when });
	}

	/** a build the project asks for by itself, with the chosen profile: never over a running one */
	private async autoBuild() {
		if (!this.view || this.compileWhen === 'manual' || this.isBusy()) return;
		// one PDF per part compiles every part: too much to run on each save
		if (this.activeProfile?.output?.perPart) return;
		await this.noteActiveFile();
		// a file the profile does not build would compile the same PDF again
		if (this.fileInfo?.affects !== 'unrelated' && !this.isBusy()) this.onCompile?.();
	}

	/** Ctrl+S compiles when the project compiles on saving */
	noteSaved() {
		if (this.view && this.compileWhen === 'save') void this.autoBuild();
	}

	/** a file reached the disk: autosave runs while typing, so only compiling on idle cares, once typing has stopped */
	noteWritten() {
		if (this.compileWhen !== 'idle') return;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			void this.autoBuild();
		}, this.view?.state.idleMs ?? 1500);
	}

	/** the cursor moved; 200 ms after it rests, the PDF catches up */
	caretMoved() {
		if (!this.follow) return;
		if (this.followTimer) clearTimeout(this.followTimer);
		this.followTimer = setTimeout(() => {
			this.followTimer = null;
			if (this.follow) this.onFollow?.();
		}, 200);
	}

	setFollow(on: boolean) {
		this.follow = on;
		if (on) this.onFollow?.();
		else clearFollowMark();
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
	async syncForward(path: string, line: number, follow = false) {
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
		if (typeof shown !== 'string' || !shown.startsWith(target)) {
			// following never changes the PDF on its own: only a jump someone asked for does
			if (follow) return null;
			pdfStore.current = target + '&t=' + Date.now();
		}
		return { page: res.page, h: box.x, v: box.y + box.h, width: box.w, height: box.h, rects: res.rects };
	}

	/** a place in the shown PDF to its source line; null when it comes from outside the project */
	async syncInverse(page: number, x: number, y: number) {
		const v = this.view;
		const profile = this.shownProfile();
		if (!v || !profile) return null;
		const res = await this.request<SyncInverse | null>('synctex-inverse', { profile, page, x, y });
		return res?.file && res.line >= 1 ? { file: joinPath(v.root, res.file), line: res.line } : null;
	}

	/** a saved file, relative to the root (it may leave it), with a button that shows it in its folder */
	private announceSaved(title: string, file: string) {
		const root = this.view?.root;
		const path = root ? joinPath(root, file) : file;
		toaster.success({ title, description: file, action: { label: m.lv_saved_reveal(), onClick: () => void revealItem(path) } });
	}

	handle(ev: EngineEvent) {
		for (const listener of this.listeners) listener(ev);
		if (ev.type === 'started') {
			if (this.exportingProfile) {
				if (this.progress) this.progress = { ...this.progress, tool: null, pass: 0 };
			} else if (!SERVICE_PROFILES.has(ev.profile)) this.progress = { profile: ev.profile, startedAt: Date.now(), tool: null, pass: 0 };
		} else if (ev.type === 'pass') {
			if (this.progress) this.progress = { ...this.progress, tool: ev.tool, pass: ev.n };
		} else if (ev.type === 'export-started') {
			const profile = this.view?.state.activeProfile ?? 'export';
			this.exportingProfile = profile;
			this.progress = { profile, startedAt: Date.now(), tool: null, pass: 0, parts: { done: 0, total: ev.total } };
		} else if (ev.type === 'export-progress') {
			if (this.progress) this.progress = { ...this.progress, parts: { done: ev.done, total: ev.total } };
		} else if (ev.type === 'export-finished') {
			const profile = this.exportingProfile ?? 'export';
			this.exportingProfile = null;
			this.progress = null;
			this.revision++;
			if (ev.error) this.onError?.(ev.error);
			else if (ev.exported > 0) this.announceSaved(m.lv_saved_parts({ count: ev.exported, failed: ev.failed }), ev.dir);
			this.onFinished?.({ type: 'finished', profile, ok: ev.ok, cancelled: ev.cancelled, pdf: null, updated: false });
		} else if (ev.type === 'bake-finished') {
			this.figureRevision++;
		} else if (ev.type === 'saved') {
			this.announceSaved(m.lv_saved_one(), ev.file);
		} else if (ev.type === 'error') this.onError?.(ev.message);
		else if (ev.type === 'finished' && !SERVICE_PROFILES.has(ev.profile)) {
			this.progress = null;
			void this.loadTypical().catch(() => {});
			this.revision++;
			this.onFinished?.(ev);
		}
	}
}

export const lvProject = new LvProject();

if (typeof window !== 'undefined') window.lvEngine?.onEvent((event) => lvProject.handle(event as EngineEvent));
