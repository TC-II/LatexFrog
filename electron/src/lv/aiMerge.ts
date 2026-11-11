// The window asks this process to settle a file's conflicting blocks: keys stay here, the window gets the
// merged text or the reason a person has to look. Every block must merge and pass mergeCheck, or none is used.
import { ipcMain } from 'electron';
import { forgetHealth, healthOf, completeWithRotation, testKey, type Attempt } from './aiProviders';
import { keysFromFile, keysWithSecrets, listKeys, saveKeys, type AiKeyEdit } from './aiKeys';
import { EXPLAIN_SYSTEM, explainPrompt, parseExplanation, type ExplainRequest, type Explanation } from './explainError';
import { MERGE_SYSTEM, checkMerge, fitBlock, mergePrompt, parseAnswer, type Hunk } from './mergeCheck';

export type MergeRequest = { file: string; eol: string; hunks: Hunk[] };

export type MergeAnswer =
	| { ok: true; blocks: string[]; by: string[]; notes: string[] }
	| {
			ok: false;
			/** 'no-keys': nothing to call. 'keys-failed': every key failed. 'unsure': the model said it could not
			 *  keep both meanings. 'check': its answer lost or invented something */
			why: 'no-keys' | 'keys-failed' | 'unsure' | 'check' | 'bad-answer';
			detail: string;
			block: number;
			attempts: Attempt[];
	  };

function keys() {
	return process.env.LV_AI_KEYS_FILE ? keysFromFile(process.env.LV_AI_KEYS_FILE) : keysWithSecrets();
}

export async function mergeFile(req: MergeRequest): Promise<MergeAnswer> {
	const blocks: string[] = [];
	const by: string[] = [];
	const notes: string[] = [];
	for (let i = 0; i < req.hunks.length; i++) {
		const h = req.hunks[i];
		const res = await completeWithRotation(keys(), MERGE_SYSTEM, mergePrompt(req.file, h));
		if (!res.ok) return { ok: false, why: res.noKeys ? 'no-keys' : 'keys-failed', detail: res.attempts.map((a) => `${a.label}: ${a.message}`).join('\n'), block: i, attempts: res.attempts };
		const answer = parseAnswer(res.text);
		if (!answer) return { ok: false, why: 'bad-answer', detail: res.text.slice(0, 300), block: i, attempts: res.attempts };
		if (!answer.confident) return { ok: false, why: 'unsure', detail: answer.note, block: i, attempts: res.attempts };
		const check = checkMerge(h, answer.merged);
		if (!check.ok) return { ok: false, why: 'check', detail: check.reason, block: i, attempts: res.attempts };
		blocks.push(fitBlock(answer.merged, h, req.eol === '\r\n' ? '\r\n' : '\n'));
		by.push(res.by);
		notes.push(answer.note);
	}
	return { ok: true, blocks, by, notes };
}

export type ExplainAnswer = ({ ok: true; by: string } & Explanation) | { ok: false; why: 'no-keys' | 'keys-failed' | 'bad-answer'; detail: string };

export async function explain(req: ExplainRequest): Promise<ExplainAnswer> {
	const res = await completeWithRotation(keys(), EXPLAIN_SYSTEM, explainPrompt(req));
	if (!res.ok) return { ok: false, why: res.noKeys ? 'no-keys' : 'keys-failed', detail: res.attempts.map((a) => `${a.label}: ${a.message}`).join('\n') };
	const parsed = parseExplanation(res.text, req);
	return parsed ? { ok: true, by: res.by, ...parsed } : { ok: false, why: 'bad-answer', detail: res.text.slice(0, 300) };
}

function withHealth() {
	return listKeys().map((r) => ({ ...r, health: healthOf(r.id) }));
}

export function registerAiMergeIpc(): void {
	ipcMain.handle('lv:aiKeys:list', () => withHealth());
	ipcMain.handle('lv:aiKeys:save', (_e, edits: AiKeyEdit[]) => {
		if (!Array.isArray(edits)) return withHealth();
		for (const e of edits) if (e.id && e.key !== undefined) forgetHealth(e.id);
		saveKeys(edits);
		return withHealth();
	});
	ipcMain.handle('lv:aiKeys:test', async (_e, id: string) => {
		const k = keys().find((r) => r.id === id);
		if (!k) return null;
		return testKey(k);
	});
	ipcMain.handle('lv:aiExplain', (_e, req: ExplainRequest) => {
		if (!req || typeof req.message !== 'string' || !Array.isArray(req.lines)) return { ok: false, why: 'bad-answer', detail: 'bad request' };
		return explain(req);
	});
	ipcMain.handle('lv:aiMerge', (_e, req: MergeRequest) => {
		if (!req || typeof req.file !== 'string' || !Array.isArray(req.hunks)) return { ok: false, why: 'bad-answer', detail: 'bad request', block: 0, attempts: [] };
		return mergeFile(req);
	});
}
