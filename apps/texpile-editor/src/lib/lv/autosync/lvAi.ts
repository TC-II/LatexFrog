// The window's side of electron/src/lv/aiMerge.ts. Keys are written here and never read back: rows carry only a tail.

export type AiProvider = 'gemini' | 'xai' | 'openai';
export type KeyState = 'ok' | 'quota' | 'invalid' | 'error' | 'untested';
export type KeyHealth = { state: KeyState; until: number; message: string; at: number };

export type AiKeyRow = {
	id: string;
	provider: AiProvider;
	label: string;
	model: string;
	baseUrl: string;
	enabled: boolean;
	tail: string;
	health: KeyHealth;
};

export type AiKeyEdit = Omit<AiKeyRow, 'tail' | 'id' | 'health'> & { id?: string; key?: string };

export type Hunk = { before: string; after: string; mine: string; theirs: string; base: string | null };

export type MergeAnswer =
	| { ok: true; blocks: string[]; by: string[]; notes: string[] }
	| { ok: false; why: 'no-keys' | 'keys-failed' | 'unsure' | 'check' | 'bad-answer'; detail: string; block: number };

export type ExplainRequest = { message: string; context: string; file: string; lines: { n: number; text: string }[]; line: number | null };
export type LineFix = { from: number; to: number; text: string };
export type ExplainAnswer =
	| { ok: true; by: string; explanation: string; fix: LineFix | null }
	| { ok: false; why: 'no-keys' | 'keys-failed' | 'bad-answer'; detail: string };

type Bridge = {
	listKeys(): Promise<AiKeyRow[]>;
	saveKeys(edits: AiKeyEdit[]): Promise<AiKeyRow[]>;
	testKey(id: string): Promise<KeyHealth | null>;
	merge(request: { file: string; eol: string; hunks: Hunk[] }): Promise<MergeAnswer>;
	explain?(request: ExplainRequest): Promise<ExplainAnswer>;
};

export function lvAi(): Bridge | null {
	return (window as unknown as { lvAi?: Bridge }).lvAi ?? null;
}

export const DEFAULT_MODEL: Record<AiProvider, string> = { gemini: 'gemini-flash-latest', xai: 'grok-3-mini', openai: 'gpt-4o-mini' };
