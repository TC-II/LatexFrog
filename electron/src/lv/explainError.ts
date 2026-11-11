// Asking an AI what a LaTeX compile error means and, when it is a small slip (a missing brace, a typo in a
// command), for the lines that fix it. The window sends only the error, its log slice and a few numbered
// source lines; the answer is plain text with tags, never JSON, so backslashes arrive untouched. Pure.

export type ExplainRequest = {
	message: string;
	/** the log lines after the error: TeX's help text and the l.NN context */
	context: string;
	file: string;
	/** source lines around the error, numbered as in the file */
	lines: { n: number; text: string }[];
	/** the line the log names, if any */
	line: number | null;
};

export type Explanation = {
	explanation: string;
	/** lines `from`..`to` (inclusive, numbered as in the file) replaced by `text` */
	fix: { from: number; to: number; text: string } | null;
};

export const EXPLAIN_SYSTEM = [
	'You help an author fix a LaTeX compile error. Be brief and concrete.',
	'Write the explanation in the same language as the document text you are shown (Spanish text: answer in Spanish).',
	'Say in at most three sentences what went wrong and how to fix it, naming the line.',
	'If, and only if, the fix is a small certain edit inside the lines shown (a missing or extra brace, a misspelled command, an unclosed environment, a missing $), give the corrected lines.',
	'Never rewrite prose, never change lines that are fine, never guess when the cause lies outside the lines shown.',
	'Answer in exactly this form:',
	'EXPLANATION: the explanation',
	'FIX: none',
	'or, with a fix:',
	'EXPLANATION: the explanation',
	'FIX: <first line number>-<last line number>',
	'<<<LINES',
	'the corrected lines, raw LaTeX, replacing exactly that range',
	'LINES>>>'
].join('\n');

export function explainPrompt(r: ExplainRequest): string {
	const width = String(r.lines.at(-1)?.n ?? 0).length;
	return [
		`Error: ${r.message}`,
		'--- log ---',
		r.context.trim(),
		`--- ${r.file}${r.line ? `, error at line ${r.line}` : ''} ---`,
		...r.lines.map((l) => `${String(l.n).padStart(width)}| ${l.text}`)
	].join('\n');
}

/** most lines a fix may add over the range it replaces: a slip, not a rewrite */
const MAX_GROWTH = 3;

export function parseExplanation(text: string, r: ExplainRequest): Explanation | null {
	const ex = /EXPLANATION:\s*([\s\S]*?)(?:\n\s*FIX:|$)/i.exec(text);
	if (!ex || !ex[1].trim()) return null;
	const explanation = ex[1].trim();
	const range = /FIX:\s*(\d+)\s*-\s*(\d+)/i.exec(text);
	const body = /<<<LINES[ \t]*\r?\n([\s\S]*?)\r?\n?LINES>>>/.exec(text);
	if (!range || !body) return { explanation, fix: null };
	const from = Number(range[1]);
	const to = Number(range[2]);
	const shown = new Set(r.lines.map((l) => l.n));
	const replacing = to - from + 1;
	const lines = body[1].split(/\r?\n/);
	// only inside what was shown, and only a small edit; otherwise the explanation alone
	if (from > to || !shown.has(from) || !shown.has(to) || lines.length > replacing + MAX_GROWTH) return { explanation, fix: null };
	const before = r.lines.filter((l) => l.n >= from && l.n <= to).map((l) => l.text).join('\n');
	if (before === body[1]) return { explanation, fix: null };
	return { explanation, fix: { from, to, text: body[1] } };
}
