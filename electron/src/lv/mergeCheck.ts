// Whether a merged block can be trusted without a person looking at it. A merge that reads well but
// drops a paragraph or a \label is worse than a conflict, so the AI's answer is accepted only when
// nothing either side wrote went missing and nothing new was invented. Pure; tested under Node.

export type Hunk = {
	/** a few lines before and after the block, for the model's eyes only */
	before: string;
	after: string;
	mine: string;
	theirs: string;
	/** what both sides started from, when git wrote it (diff3); null otherwise */
	base: string | null;
};

export type CheckResult = { ok: true } | { ok: false; reason: string };

const MARKER = /^(<{7}|>{7}|={7}|\|{7})(\s|$)/m;

// \label{x}, \ref{x}, \eqref{x}, \cite{a,b}, \includegraphics[..]{x}, \input{x}: each key on its own
const KEYED = /\\(label|ref|eqref|pageref|autoref|cref|Cref|cite[a-zA-Z]*|includegraphics|input|include|subfile)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
const ENV = /\\(begin|end)\{([^}]*)\}/g;

/** every keyed command as "cmd:key", one per key */
export function latexKeys(text: string): Set<string> {
	const out = new Set<string>();
	for (const m of text.matchAll(KEYED)) {
		const cmd = m[1].startsWith('cite') ? 'cite' : m[1];
		for (const k of m[2].split(',')) if (k.trim()) out.add(`${cmd}:${k.trim()}`);
	}
	return out;
}

/** \begin minus \end, per environment */
export function envBalance(text: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const m of text.matchAll(ENV)) out.set(m[2], (out.get(m[2]) ?? 0) + (m[1] === 'begin' ? 1 : -1));
	return out;
}

function words(text: string): string[] {
	return text
		.replace(/%.*$/gm, ' ')
		.toLowerCase()
		.split(/[^\p{L}\p{N}\\]+/u)
		.filter((w) => w.length > 1);
}

function bag(ws: string[]): Map<string, number> {
	const b = new Map<string, number>();
	for (const w of ws) b.set(w, (b.get(w) ?? 0) + 1);
	return b;
}

/** the words `side` added over `base`, as a multiset */
function added(side: string, base: string | null): string[] {
	if (base === null) return words(side);
	const left = bag(words(base));
	const out: string[] = [];
	for (const w of words(side)) {
		const n = left.get(w) ?? 0;
		if (n > 0) left.set(w, n - 1);
		else out.push(w);
	}
	return out;
}

/** how many of `want` are missing from `have`, counting repeats */
function missing(want: string[], have: Map<string, number>): number {
	const left = new Map(have);
	let lost = 0;
	for (const w of want) {
		const n = left.get(w) ?? 0;
		if (n > 0) left.set(w, n - 1);
		else lost++;
	}
	return lost;
}

/** each side's own additions must survive almost whole: this share, or a few words in a short block, may be
 *  reworded (a typo one side fixed reads as a word the other side lost) */
export const MAX_LOST = 0.1;
/** the result may not bring in more than this share (or a few words) neither side had */
export const MAX_INVENTED = 0.05;
const SLACK_WORDS = 3;

function tooMany(count: number, of: number, share: number): boolean {
	return count > Math.max(SLACK_WORDS, Math.floor(of * share));
}

export function checkMerge(h: Hunk, result: string): CheckResult {
	if (MARKER.test(result)) return { ok: false, reason: 'conflict markers left in the result' };

	// keyed commands: each one present on either side stays, unless a side deliberately removed it from the base
	const mine = latexKeys(h.mine);
	const theirs = latexKeys(h.theirs);
	const base = h.base === null ? new Set<string>() : latexKeys(h.base);
	const got = latexKeys(result);
	for (const k of new Set([...mine, ...theirs])) {
		const removed = base.has(k) && (!mine.has(k) || !theirs.has(k));
		if (!removed && !got.has(k)) return { ok: false, reason: `lost ${k.replace(':', ' ')}` };
	}
	for (const k of got) if (!mine.has(k) && !theirs.has(k)) return { ok: false, reason: `invented ${k.replace(':', ' ')}` };

	// environments: when both sides agree on how many they open, the result must too
	const bm = envBalance(h.mine);
	const bt = envBalance(h.theirs);
	const br = envBalance(result);
	for (const env of new Set([...bm.keys(), ...bt.keys(), ...br.keys()])) {
		const a = bm.get(env) ?? 0;
		if (a === (bt.get(env) ?? 0) && a !== (br.get(env) ?? 0)) return { ok: false, reason: `unbalanced ${env} environment` };
	}

	// text: what each side added must be there, and little may come from nowhere
	const have = bag(words(result));
	for (const [side, text] of [
		["this side's", h.mine],
		["the other side's", h.theirs]
	] as const) {
		const want = added(text, h.base);
		const lost = missing(want, have);
		if (tooMany(lost, want.length, MAX_LOST)) return { ok: false, reason: `${lost} words of ${side} new text lost` };
	}
	const known = bag([...words(h.mine), ...words(h.theirs), ...words(h.base ?? '')]);
	const resultWords = words(result);
	const invented = missing(resultWords, known);
	if (tooMany(invented, resultWords.length, MAX_INVENTED)) return { ok: false, reason: `${invented} words neither side wrote` };
	return { ok: true };
}

export const MERGE_SYSTEM = [
	'You merge one conflicting block of a LaTeX document. Two authors edited the same lines.',
	'Produce the block as it should read with BOTH authors\' intentions kept: every sentence, label, reference, citation and environment either side added stays.',
	'Never summarize, shorten, translate or rephrase beyond what joining the two needs. Keep the original line breaks style.',
	'If one side only fixed a typo or reworded text the other side moved, apply the fix to the moved text.',
	'If the two edits contradict each other and you cannot keep both meanings, do not guess: answer CONFIDENT: no.',
	'Answer in exactly this form, with the block as raw LaTeX (no escaping, no code fence):',
	'<<<MERGED',
	'the merged block, exactly as it should be in the file',
	'MERGED>>>',
	'CONFIDENT: yes or no',
	'NOTE: one short sentence'
].join('\n');

export function mergePrompt(file: string, h: Hunk): string {
	return [
		`File: ${file}`,
		'--- context before (do not repeat) ---',
		h.before,
		'--- MINE (this computer) ---',
		h.mine,
		...(h.base !== null ? ['--- BASE (what both started from) ---', h.base] : []),
		'--- THEIRS (the remote) ---',
		h.theirs,
		'--- context after (do not repeat) ---',
		h.after
	].join('\n');
}

export type ModelAnswer = { merged: string; confident: boolean; note: string };

/** The model's answer: the raw block between <<<MERGED and MERGED>>>, so backslashes arrive untouched. A JSON
 *  answer is still read, for a model that ignores the form, but only when it parses. */
export function parseAnswer(text: string): ModelAnswer | null {
	const tagged = /<<<MERGED[ \t]*\r?\n([\s\S]*?)\r?\n?MERGED>>>/.exec(text);
	if (tagged) {
		const confident = !/CONFIDENT:\s*no\b/i.test(text);
		const note = /NOTE:\s*(.*)/i.exec(text.slice(tagged.index + tagged[0].length))?.[1]?.trim() ?? '';
		return { merged: tagged[1], confident, note };
	}
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const o = JSON.parse(text.slice(start, end + 1));
		if (typeof o.merged !== 'string') return null;
		return { merged: o.merged, confident: o.confident !== false, note: typeof o.note === 'string' ? o.note : '' };
	} catch {
		return null;
	}
}

/** the merged block with the line ending the file uses, and a final line break when the sides had one */
export function fitBlock(merged: string, h: Hunk, eol: string): string {
	let out = merged.replace(/\r\n|\r|\n/g, eol);
	const endsWithBreak = /\r?\n$/.test(h.mine) || /\r?\n$/.test(h.theirs);
	if (endsWithBreak && !out.endsWith(eol)) out += eol;
	return out;
}
