// Calling the listed AI providers in order, with rotation: a key out of quota rests until it resets, a
// rejected key rests until it is edited, and the next one in the list takes the request. No Electron
// imports, so the tests run it under plain Node.

export type Provider = 'gemini' | 'xai' | 'openai';

export type ProviderKey = {
	id: string;
	provider: Provider;
	label: string;
	model: string;
	baseUrl: string;
	enabled: boolean;
	key: string;
};

export type KeyState = 'ok' | 'quota' | 'invalid' | 'error' | 'untested';

export type KeyHealth = { state: KeyState; until: number; message: string; at: number };

export const DEFAULT_MODEL: Record<Provider, string> = {
	gemini: 'gemini-flash-latest',
	xai: 'grok-3-mini',
	openai: 'gpt-4o-mini'
};

const XAI_BASE = 'https://api.x.ai/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** how long a key rests after each kind of failure, unless the provider says when to come back */
const REST_MS = { quota: 60_000, dailyQuota: 3_600_000, invalid: 24 * 3_600_000, error: 30_000 };
const TIMEOUT_MS = 30_000;

const health = new Map<string, KeyHealth>();

/** a key's state as the last call left it; a resting key whose time is up reads as untested again */
export function healthOf(id: string): KeyHealth {
	const h = health.get(id);
	if (!h) return { state: 'untested', until: 0, message: '', at: 0 };
	if (h.until && h.until <= Date.now() && h.state !== 'ok') return { ...h, state: 'untested', until: 0 };
	return h;
}

/** an edited key gets a fresh start */
export function forgetHealth(id: string): void {
	health.delete(id);
}

export class ProviderError extends Error {
	constructor(
		public kind: 'quota' | 'invalid' | 'error',
		message: string,
		public retryAfterMs = 0
	) {
		super(message);
	}
}

function classify(status: number, body: string, retryAfter: string | null): ProviderError {
	const text = body.slice(0, 400);
	const after = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
	if (status === 429 || /quota|rate.?limit|resource.?exhausted|credits/i.test(text)) {
		const daily = /per.?day|daily|PerDay|exceeded your current quota|credits/i.test(text);
		return new ProviderError('quota', `${status}: ${text}`, after || (daily ? REST_MS.dailyQuota : REST_MS.quota));
	}
	if (status === 401 || status === 403 || /api.?key.*(invalid|not valid)|(incorrect|invalid) api key|unauthori[sz]ed|permission/i.test(text)) {
		return new ProviderError('invalid', `${status}: ${text}`);
	}
	return new ProviderError('error', `${status}: ${text}`);
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
	} catch (e) {
		throw new ProviderError('error', e instanceof Error ? e.message : String(e));
	} finally {
		clearTimeout(timer);
	}
	const text = await res.text();
	if (!res.ok) throw classify(res.status, text, res.headers.get('retry-after'));
	try {
		return JSON.parse(text);
	} catch {
		throw new ProviderError('error', `not JSON: ${text.slice(0, 200)}`);
	}
}

/** one completion from one key: the model's text */
export async function complete(k: ProviderKey, system: string, user: string): Promise<string> {
	const model = k.model || DEFAULT_MODEL[k.provider];
	if (k.provider === 'gemini') {
		const data = (await post(
			`${(k.baseUrl || GEMINI_BASE).replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`,
			{ 'x-goog-api-key': k.key },
			{
				systemInstruction: { parts: [{ text: system }] },
				contents: [{ role: 'user', parts: [{ text: user }] }],
				generationConfig: { temperature: 0 } // plain text: LaTeX backslashes break a model's JSON escaping
			}
		)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
		const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
		if (!text) throw new ProviderError('error', 'empty answer');
		return text;
	}
	const base = (k.baseUrl || (k.provider === 'xai' ? XAI_BASE : OPENAI_BASE)).replace(/\/$/, '');
	const data = (await post(
		`${base}/chat/completions`,
		k.key ? { authorization: `Bearer ${k.key}` } : {},
		{
			model,
			temperature: 0,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			]
		}
	)) as { choices?: { message?: { content?: string } }[] };
	const text = data.choices?.[0]?.message?.content ?? '';
	if (!text) throw new ProviderError('error', 'empty answer');
	return text;
}

export type Attempt = { id: string; label: string; ok: boolean; message: string };
export type RotateResult = { ok: true; text: string; by: string; attempts: Attempt[] } | { ok: false; attempts: Attempt[]; noKeys: boolean };

/** The first key in the list that answers. Resting keys are skipped; a failure rests the key and moves on */
export async function completeWithRotation(keys: ProviderKey[], system: string, user: string): Promise<RotateResult> {
	const attempts: Attempt[] = [];
	const usable = keys.filter((k) => k.enabled && (k.key || k.provider === 'openai'));
	for (const k of usable) {
		const h = healthOf(k.id);
		if (h.until > Date.now()) continue;
		try {
			const text = await complete(k, system, user);
			health.set(k.id, { state: 'ok', until: 0, message: '', at: Date.now() });
			attempts.push({ id: k.id, label: k.label, ok: true, message: '' });
			return { ok: true, text, by: k.label || k.provider, attempts };
		} catch (e) {
			const err = e instanceof ProviderError ? e : new ProviderError('error', String(e));
			const rest = err.kind === 'quota' ? err.retryAfterMs || REST_MS.quota : err.kind === 'invalid' ? REST_MS.invalid : REST_MS.error;
			health.set(k.id, { state: err.kind, until: Date.now() + rest, message: err.message, at: Date.now() });
			attempts.push({ id: k.id, label: k.label, ok: false, message: err.message });
		}
	}
	return { ok: false, attempts, noKeys: usable.length === 0 };
}

/** a one-word check of a single key, for the Test button: it updates the key's health like a real call */
export async function testKey(k: ProviderKey): Promise<KeyHealth> {
	try {
		await complete(k, 'Answer with the JSON {"ok": true} and nothing else.', 'ping');
		health.set(k.id, { state: 'ok', until: 0, message: '', at: Date.now() });
	} catch (e) {
		const err = e instanceof ProviderError ? e : new ProviderError('error', String(e));
		const rest = err.kind === 'quota' ? err.retryAfterMs || REST_MS.quota : err.kind === 'invalid' ? REST_MS.invalid : REST_MS.error;
		health.set(k.id, { state: err.kind, until: Date.now() + rest, message: err.message, at: Date.now() });
	}
	return healthOf(k.id);
}
