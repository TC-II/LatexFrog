// The AI keys that settle merge conflicts, in the order the user listed them. Keys are encrypted with the
// operating system's keychain (safeStorage) and never leave this process: the window sees only a masked tail.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type AiProvider = 'gemini' | 'xai' | 'openai';

/** what the window may see and edit */
export type AiKeyRow = {
	id: string;
	provider: AiProvider;
	label: string;
	/** empty for the provider's default */
	model: string;
	/** OpenAI-compatible only: https://api.groq.com/openai/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 */
	baseUrl: string;
	enabled: boolean;
	/** the key's last four characters, or '' when there is none */
	tail: string;
};

/** an edit from the window: `key` set replaces the stored key, absent keeps it */
export type AiKeyEdit = Omit<AiKeyRow, 'tail' | 'id'> & { id?: string; key?: string };

type Stored = Omit<AiKeyRow, 'tail'> & { secret: string; plain?: boolean };

const FILE = () => join(app.getPath('userData'), 'latexfrog', 'ai-keys.json');

function encrypt(key: string): { secret: string; plain?: boolean } {
	if (safeStorage.isEncryptionAvailable()) return { secret: safeStorage.encryptString(key).toString('base64') };
	// no keychain (some Linux sessions): kept, but marked so the UI can say it is not encrypted
	return { secret: Buffer.from(key, 'utf8').toString('base64'), plain: true };
}

function decrypt(s: Stored): string {
	if (!s.secret) return '';
	const buf = Buffer.from(s.secret, 'base64');
	try {
		return s.plain ? buf.toString('utf8') : safeStorage.decryptString(buf);
	} catch {
		return '';
	}
}

function load(): Stored[] {
	try {
		if (!existsSync(FILE())) return [];
		const data = JSON.parse(readFileSync(FILE(), 'utf8'));
		return Array.isArray(data) ? data : [];
	} catch {
		return [];
	}
}

function save(rows: Stored[]): void {
	mkdirSync(dirname(FILE()), { recursive: true });
	writeFileSync(FILE(), JSON.stringify(rows, null, 2));
}

function row(s: Stored): AiKeyRow {
	const key = decrypt(s);
	return { id: s.id, provider: s.provider, label: s.label, model: s.model, baseUrl: s.baseUrl, enabled: s.enabled, tail: key ? key.slice(-4) : '' };
}

export function listKeys(): AiKeyRow[] {
	return load().map(row);
}

/** the whole list, in its new order. A row without `key` keeps the key it had */
export function saveKeys(edits: AiKeyEdit[]): AiKeyRow[] {
	const before = new Map(load().map((s) => [s.id, s]));
	const next: Stored[] = edits.map((e) => {
		const old = e.id ? before.get(e.id) : undefined;
		const secret = e.key !== undefined ? (e.key.trim() ? encrypt(e.key.trim()) : { secret: '' }) : old ? { secret: old.secret, plain: old.plain } : { secret: '' };
		return {
			id: old?.id ?? randomUUID(),
			provider: e.provider,
			label: String(e.label ?? '').slice(0, 80),
			model: String(e.model ?? '').trim(),
			baseUrl: String(e.baseUrl ?? '').trim(),
			enabled: e.enabled !== false,
			...secret
		};
	});
	save(next);
	return next.map(row);
}

/** for the resolver only: rows with their keys, in order */
export function keysWithSecrets(): (AiKeyRow & { key: string })[] {
	return load().map((s) => ({ ...row(s), key: decrypt(s) }));
}

/** LV_AI_KEYS_FILE: a JSON list for tests run outside the app, never written by it */
export function keysFromFile(path: string): (AiKeyRow & { key: string })[] {
	const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<AiKeyRow & { key: string }>[];
	return data.map((d, i) => ({
		id: d.id ?? String(i),
		provider: d.provider ?? 'openai',
		label: d.label ?? d.provider ?? '',
		model: d.model ?? '',
		baseUrl: d.baseUrl ?? '',
		enabled: d.enabled !== false,
		tail: (d.key ?? '').slice(-4),
		key: d.key ?? ''
	}));
}
