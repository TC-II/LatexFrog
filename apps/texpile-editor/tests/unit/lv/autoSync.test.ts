import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hunksOf, replaceSpans } from '$lib/lv/autosync/hunks';
import { checkMerge, parseAnswer, fitBlock, latexKeys, type Hunk } from '../../../../../electron/src/lv/mergeCheck';
import { completeWithRotation, healthOf, forgetHealth, type ProviderKey } from '../../../../../electron/src/lv/aiProviders';

const FILE = [
	'\\section{Intro}',
	'Some text.',
	'<<<<<<< HEAD',
	'The filter has a cutoff of 1 kHz \\cite{smith}.',
	'=======',
	'The filter has a cut-off of 1 kHz.',
	'See Fig.~\\ref{fig:bode}.',
	'>>>>>>> origin/main',
	'End.',
	''
].join('\n');

describe('hunksOf and replaceSpans', () => {
	it('cuts each marked block out and puts the merge back in its place', () => {
		const { hunks, spans } = hunksOf(FILE);
		expect(hunks).toHaveLength(1);
		expect(hunks[0].mine).toBe('The filter has a cutoff of 1 kHz \\cite{smith}.\n');
		expect(hunks[0].theirs).toBe('The filter has a cut-off of 1 kHz.\nSee Fig.~\\ref{fig:bode}.\n');
		expect(hunks[0].before).toContain('Some text.');
		expect(hunks[0].after).toContain('End.');
		const out = replaceSpans(FILE, spans, ['MERGED\n']);
		expect(out).toBe('\\section{Intro}\nSome text.\nMERGED\nEnd.\n');
	});

	it('keeps CRLF files CRLF', () => {
		const crlf = FILE.replace(/\n/g, '\r\n');
		const { hunks, spans } = hunksOf(crlf);
		const block = fitBlock('A line.\nB line.', hunks[0], '\r\n');
		expect(block).toBe('A line.\r\nB line.\r\n');
		expect(replaceSpans(crlf, spans, [block])).not.toMatch(/[^\r]\n/);
	});
});

describe('checkMerge', () => {
	const h: Hunk = hunksOf(FILE).hunks[0];

	it('accepts a merge that keeps both sides', () => {
		expect(checkMerge(h, 'The filter has a cut-off of 1 kHz \\cite{smith}.\nSee Fig.~\\ref{fig:bode}.\n')).toEqual({ ok: true });
	});
	it('refuses a merge that drops a citation', () => {
		const r = checkMerge(h, 'The filter has a cut-off of 1 kHz.\nSee Fig.~\\ref{fig:bode}.\n');
		expect(r.ok).toBe(false);
		expect(!r.ok && r.reason).toContain('cite smith');
	});
	it('refuses a merge that drops a sentence', () => {
		expect(checkMerge(h, 'The filter has a cut-off of 1 kHz \\cite{smith} \\ref{fig:bode}.\n').ok).toBe(true);
		expect(checkMerge(h, 'Filter \\cite{smith}.\n\\ref{fig:bode}\n').ok).toBe(false);
	});
	it('refuses markers, invented labels and invented text', () => {
		expect(checkMerge(h, '<<<<<<< HEAD\nx\n').ok).toBe(false);
		expect(checkMerge(h, 'The filter has a cut-off of 1 kHz \\cite{smith}.\nSee Fig.~\\ref{fig:bode}.\\label{new}\n').ok).toBe(false);
		const padded = 'The filter has a cut-off of 1 kHz \\cite{smith}.\nSee Fig.~\\ref{fig:bode}.\nAnd also a whole new paragraph nobody wrote about something else entirely.\n';
		expect(checkMerge(h, padded).ok).toBe(false);
	});
	it('refuses an environment left open', () => {
		const env: Hunk = { before: '', after: '', base: null, mine: '\\begin{equation}\na=b\n\\end{equation}\n', theirs: '\\begin{equation}\na=c\n\\end{equation}\n' };
		expect(checkMerge(env, '\\begin{equation}\na=b=c\n\\end{equation}\n').ok).toBe(true);
		expect(checkMerge(env, '\\begin{equation}\na=b=c\n').ok).toBe(false);
	});
	it('lets a side remove what it removed from the base', () => {
		const del: Hunk = { before: '', after: '', base: 'Text \\label{old}.\n', mine: 'Text.\n', theirs: 'Text \\label{old} more.\n' };
		expect(checkMerge(del, 'Text more.\n').ok).toBe(true);
	});
	it('splits keys in a citation list', () => {
		expect([...latexKeys('\\cite[p.~3]{a, b}')]).toEqual(['cite:a', 'cite:b']);
	});
});

describe('parseAnswer', () => {
	it('reads JSON inside a code fence', () => {
		expect(parseAnswer('```json\n{"merged": "x\\n", "confident": true, "note": "n"}\n```')).toEqual({ merged: 'x\n', confident: true, note: 'n' });
	});
	it('reads the tagged form with LaTeX backslashes untouched', () => {
		const text = 'Sure.\n<<<MERGED\nCut-off 1\\,kHz \\cite{smith}.\nSee \\ref{fig:bode}.\nMERGED>>>\nCONFIDENT: yes\nNOTE: joined both.';
		expect(parseAnswer(text)).toEqual({ merged: 'Cut-off 1\\,kHz \\cite{smith}.\nSee \\ref{fig:bode}.', confident: true, note: 'joined both.' });
		expect(parseAnswer(text.replace('CONFIDENT: yes', 'CONFIDENT: no'))?.confident).toBe(false);
	});
	it('says null for an answer without the field', () => {
		expect(parseAnswer('I merged it.')).toBeNull();
	});
});

describe('completeWithRotation', () => {
	const keys: ProviderKey[] = [
		{ id: 'a', provider: 'openai', label: 'A', model: 'm', baseUrl: 'http://a', enabled: true, key: 'ka' },
		{ id: 'b', provider: 'openai', label: 'B', model: 'm', baseUrl: 'http://b', enabled: true, key: 'kb' },
		{ id: 'c', provider: 'openai', label: 'C', model: 'm', baseUrl: 'http://c', enabled: false, key: 'kc' }
	];
	const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
	beforeEach(() => keys.forEach((k) => forgetHealth(k.id)));
	afterEach(() => vi.unstubAllGlobals());

	it('moves past a key out of quota and rests it', async () => {
		const fetch = vi.fn(async (url: string) =>
			url.startsWith('http://a') ? answer(429, { error: 'quota exceeded' }) : answer(200, { choices: [{ message: { content: 'hi' } }] })
		);
		vi.stubGlobal('fetch', fetch);
		const r = await completeWithRotation(keys, 's', 'u');
		expect(r.ok && r.by).toBe('B');
		expect(healthOf('a').state).toBe('quota');
		expect(healthOf('b').state).toBe('ok');
		// a second call skips the resting key altogether
		await completeWithRotation(keys, 's', 'u');
		expect(fetch.mock.calls.filter(([u]) => String(u).startsWith('http://a'))).toHaveLength(1);
	});

	it('marks a rejected key invalid and reports when none works; never calls a disabled one', async () => {
		const fetch = vi.fn(async () => answer(401, { error: 'invalid api key' }));
		vi.stubGlobal('fetch', fetch);
		const r = await completeWithRotation(keys, 's', 'u');
		expect(r.ok).toBe(false);
		expect(healthOf('a').state).toBe('invalid');
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
