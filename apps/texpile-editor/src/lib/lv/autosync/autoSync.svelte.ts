// Auto sync: while a project tracks a remote, every minute or so the work is saved as a version, the
// remote's versions are taken in and this one's sent. When both sides changed the same lines, the AI keys
// listed by the user settle each block; the result is used only when every block merged and passed the
// checks in electron/src/lv/mergeCheck.ts. Otherwise the merge is undone and the author is asked, with the
// app's own Combine flow ready. The AI is only called when there is a conflict.
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { basename, samePath } from '$lib/workspace/fileSystem';
import {
	gitChanges,
	gitHead,
	gitOperation,
	gitRunning,
	gitTracking,
	isConflicted,
	isGitRepo,
	refreshGitHistory,
	refreshGitStatus
} from '$lib/workspace/scm/gitStore';
import { gitCommit, gitPush, gitStage, gitSync, gitUnstage, type GitSyncResult } from '$lib/workspace/scm/git';
import { gitCancelCombine, gitCombine, gitFinishCombine } from '$lib/workspace/scm/branches/gitCombine';
import { scmDraftFor } from '$lib/workspace/scm/actions/scmDraft.svelte';
import type { ScmActions } from '$lib/workspace/scm/actions/scmActions.svelte';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import { lvAi, type MergeAnswer } from './lvAi';
import { hunksOf, replaceSpans } from './hunks';

export type AutoSyncDeps = {
	scm: ScmActions;
	getLoadedPath(): string | null;
	hasPendingSave(): boolean;
	flushPendingSave(): Promise<void>;
	refreshTree(): Promise<void> | void;
	loadFile(path: string): Promise<unknown> | void;
	readText(path: string): Promise<string | null>;
	writeText(path: string, content: string): Promise<unknown>;
	openKeys(): void;
};

export type AutoSyncState = 'off' | 'waiting' | 'idle' | 'saving' | 'syncing' | 'merging' | 'attention';

/** a conflict the AI settled: kept for the author to look over */
export type AiMergeRecord = { at: number; files: string[]; by: string[]; notes: string[] };

export const INTERVALS = [30, 60, 120, 300];

function storage<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(key);
		return v === null ? fallback : (JSON.parse(v) as T);
	} catch {
		return fallback;
	}
}
function store(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* private window: the choice lasts this session */
	}
}

function why(a: Extract<MergeAnswer, { ok: false }>): string {
	switch (a.why) {
		case 'no-keys':
			return m.lv_autosync_why_no_keys();
		case 'keys-failed':
			return m.lv_autosync_why_keys_failed();
		case 'unsure':
			return m.lv_autosync_why_unsure({ note: a.detail });
		case 'check':
			return m.lv_autosync_why_check({ reason: a.detail });
		default:
			return m.lv_autosync_why_bad();
	}
}

class AutoSync {
	state = $state<AutoSyncState>('off');
	/** what the last round did or why it stopped, in the author's words */
	message = $state('');
	lastSync = $state(0);
	enabled = $state(false);
	interval = $state(storage('lv.autosync.interval', 60));
	merges = $state<AiMergeRecord[]>([]);
	/** stopped on a conflict the AI could not settle: rounds wait until HEAD moves or the author resumes */
	#heldAt: string | null = null;
	#deps: AutoSyncDeps | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#root: string | null = null;
	#running = false;

	/** the editor and file access this window gave auto sync; the diagnostics borrow it */
	get host(): AutoSyncDeps | null {
		return this.#deps;
	}

	attach(deps: AutoSyncDeps): () => void {
		this.#deps = deps;
		return () => {
			this.#deps = null;
			clearTimeout(this.#timer);
		};
	}

	/** a folder opened in this window: its own on/off */
	open(root: string | null): void {
		this.#root = root;
		this.#heldAt = null;
		this.enabled = root ? storage(`lv.autosync.on:${root}`, false) : false;
		this.state = this.enabled ? 'waiting' : 'off';
		this.message = '';
		this.#schedule(5_000);
	}

	setEnabled(on: boolean): void {
		this.enabled = on;
		if (this.#root) store(`lv.autosync.on:${this.#root}`, on);
		this.#heldAt = null;
		this.state = on ? 'waiting' : 'off';
		this.message = '';
		if (on) this.#schedule(0);
		else clearTimeout(this.#timer);
	}

	setInterval(seconds: number): void {
		this.interval = seconds;
		store('lv.autosync.interval', seconds);
		this.#schedule(seconds * 1000);
	}

	/** now, from the panel's button; also lifts a hold */
	syncNow(): void {
		this.#heldAt = null;
		this.#schedule(0);
	}

	#schedule(ms: number): void {
		clearTimeout(this.#timer);
		if (!this.enabled) return;
		this.#timer = setTimeout(() => void this.#round(), ms);
	}

	async #round(): Promise<void> {
		const d = this.#deps;
		const root = workspaceRoot.current;
		try {
			if (!d || !root || !this.enabled || this.#running) return;
			if (!isGitRepo.current || !gitTracking.current) {
				this.state = 'waiting';
				this.message = m.lv_autosync_no_remote();
				return;
			}
			// a merge under way is the author's; a hold waits for them
			if (gitOperation.current || d.scm.busy || gitRunning.current) return;
			if (this.#heldAt !== null && this.#heldAt === gitHead.current) return;
			this.#heldAt = null;
			this.#running = true;
			await this.#sync(d, root);
		} catch (e) {
			this.state = 'attention';
			this.message = e instanceof Error ? e.message : String(e);
		} finally {
			this.#running = false;
			this.#schedule(this.interval * 1000);
		}
	}

	async #sync(d: AutoSyncDeps, root: string): Promise<void> {
		const scm = d.scm;
		if (!(await scm.ensureIdentity(root))) return;
		scm.busy = true;
		gitRunning.current = 'sync';
		let res: GitSyncResult;
		try {
			// 1. the work as a version: the files the panel has ticked, never one with conflict markers
			this.state = 'saving';
			if (d.hasPendingSave()) await d.flushPendingSave();
			await refreshGitStatus(root, true);
			const draft = scmDraftFor(root);
			const take = gitChanges.current.filter((c) => !isConflicted(c.x, c.y) && draft.ticked(c));
			if (take.length) {
				const paths = [...take.map((c) => c.path), ...take.flatMap((c) => (c.from ? [c.from] : []))];
				const cleared = await gitUnstage(root, []);
				const staged = cleared.ok ? await gitStage(root, paths) : cleared;
				const committed = staged.ok ? await gitCommit(root, m.lv_autosync_commit({ time: new Date().toLocaleString() })) : staged;
				if (!committed.ok) {
					this.state = 'attention';
					this.message = committed.error ?? '';
					return;
				}
			}
			// 2. take in and send
			this.state = 'syncing';
			res = await gitSync(root);
		} finally {
			scm.busy = false;
			gitRunning.current = null;
		}
		if (!samePath(workspaceRoot.current ?? '', root)) return;

		if (res.ok) {
			if (res.pulled) await this.#reload(d, root);
			else await refreshGitStatus(root);
			if (res.pulled || res.pushed) await refreshGitHistory(root);
			this.lastSync = Date.now();
			this.state = 'idle';
			this.message = m.lv_autosync_synced({ pulled: res.pulled ?? 0, pushed: res.pushed ?? 0 });
			return;
		}
		if (res.failure === 'conflict') return this.#resolve(d, root, res);
		await refreshGitStatus(root);
		// 'dirty': typed between the version and the merge; the next round saves it
		if (res.failure === 'dirty') return;
		this.state = 'attention';
		this.message = res.failure === 'auth' || res.failure === 'cancelled' ? m.lv_autosync_auth() : (res.error ?? res.failure ?? '');
		this.#heldAt = gitHead.current;
		toaster.warning({ title: m.lv_autosync_failed(), description: this.message, duration: 15000 });
	}

	/** both sides changed the same lines: merge, let the AI settle every block, or undo and ask */
	async #resolve(d: AutoSyncDeps, root: string, sync: GitSyncResult): Promise<void> {
		const scm = d.scm;
		const ai = lvAi();
		this.state = 'merging';
		scm.busy = true;
		gitRunning.current = 'sync';
		let failure = '';
		let noKeys = false;
		const settled: AiMergeRecord = { at: Date.now(), files: [], by: [], notes: [] };
		try {
			const combined = await gitCombine(root);
			if (!combined.ok) {
				failure = combined.error ?? combined.failure ?? '';
			} else if (!ai) {
				failure = m.lv_autosync_why_no_keys();
				noKeys = true;
			} else {
				const writes: [string, string][] = [];
				for (const file of combined.conflicts ?? []) {
					const text = await d.readText(file);
					const { hunks, spans } = text === null ? { hunks: [], spans: [] } : hunksOf(text);
					// a figure, a deleted file, or a file whose places the parser cannot read: a person chooses
					if (text === null || !hunks.length) {
						failure = m.lv_autosync_why_whole({ file: basename(file) });
						break;
					}
					const eol = text.includes('\r\n') ? '\r\n' : '\n';
					const answer = await ai.merge({ file: basename(file), eol, hunks });
					if (!answer.ok) {
						failure = `${basename(file)}: ${why(answer)}`;
						noKeys = answer.why === 'no-keys' || answer.why === 'keys-failed';
						break;
					}
					writes.push([file, replaceSpans(text, spans, answer.blocks)]);
					settled.files.push(file);
					settled.by.push(...answer.by);
					settled.notes.push(...answer.notes.filter(Boolean));
				}
				if (!failure) {
					for (const [file, content] of writes) await d.writeText(file, content);
					const fin = await gitFinishCombine(root);
					if (!fin.ok) failure = fin.error ?? fin.failure ?? '';
					else {
						const push = await gitPush(root);
						if (!push.ok) failure = push.error ?? push.failure ?? '';
					}
				}
			}
			// the project goes back exactly as it was before the merge: nothing half-combined is left behind
			if (failure) await gitCancelCombine(root);
		} finally {
			scm.busy = false;
			gitRunning.current = null;
		}
		await this.#reload(d, root);
		await refreshGitHistory(root);

		if (!failure) {
			this.merges = [settled, ...this.merges].slice(0, 20);
			this.lastSync = Date.now();
			this.state = 'idle';
			this.message = m.lv_autosync_ai_merged({ count: settled.files.length, by: [...new Set(settled.by)].join(', ') });
			toaster.success({ title: m.lv_autosync_ai_merged_title(), description: this.message, duration: 10000 });
			return;
		}
		this.state = 'attention';
		this.message = failure;
		this.#heldAt = gitHead.current;
		toaster.warning({
			title: m.lv_autosync_conflict_title(),
			description: failure,
			duration: 30000,
			action: noKeys
				? { label: m.lv_autosync_open_keys(), onClick: () => d.openKeys() }
				: { label: m.lv_autosync_by_hand(), onClick: () => void this.byHand(sync) }
		});
	}

	/** the app's own Combine flow, for the conflict the AI left */
	async byHand(sync?: GitSyncResult): Promise<void> {
		const d = this.#deps;
		const root = workspaceRoot.current;
		if (!d || !root) return;
		d.scm.busy = true;
		try {
			await d.scm.combine.offer(root, sync ?? { ok: false, failure: 'conflict', files: [] });
		} finally {
			d.scm.busy = false;
		}
	}

	async #reload(d: AutoSyncDeps, root: string): Promise<void> {
		const loaded = d.getLoadedPath();
		await d.refreshTree();
		if (d.hasPendingSave()) await d.flushPendingSave();
		if (loaded && !d.hasPendingSave()) await d.loadFile(loaded);
		await refreshGitStatus(root);
	}
}

export const autoSync = new AutoSync();
