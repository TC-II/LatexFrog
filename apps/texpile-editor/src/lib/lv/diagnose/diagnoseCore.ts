// The pure parts of AI diagnostics: which error is "the same" as one already explained, how many calls the
// hour still allows, and the edits a fix makes. Tested in tests/unit/lv/diagnose.test.ts.
import type { LogEntry } from '$lib/compileLog/types';
import type { LineFix } from '../autosync/lvAi';

/**
 * The same mistake gives the same fingerprint wherever it is: line numbers, paths and digits are dropped,
 * the message and the offending text kept. A cached explanation is reused instead of paying for a new one.
 */
export function fingerprint(e: Pick<LogEntry, 'message' | 'command' | 'context'>): string {
	const firstContext = (e.context ?? '')
		.split('\n')
		.find((l) => /^l\.\d+/.test(l.trim()))
		?.replace(/^\s*l\.\d+\s*/, '');
	const norm = (s: string) =>
		s
			.replace(/[A-Za-z]:[\\/][^\s'`]*|\.{0,2}\/[^\s'`]+/g, '<path>')
			.replace(/\d+/g, '#')
			.replace(/\s+/g, ' ')
			.trim();
	return [norm(e.message), e.command ?? '', norm(firstContext ?? '')].join(' | ');
}

/** calls allowed in any sliding hour, and the window */
export const HOURLY_BUDGET = 10;
const HOUR = 3_600_000;

/** the call times still inside the hour, and whether one more is allowed */
export function budget(calls: number[], now = Date.now()): { recent: number[]; allowed: boolean; left: number } {
	const recent = calls.filter((t) => now - t < HOUR);
	return { recent, allowed: recent.length < HOURLY_BUDGET, left: Math.max(0, HOURLY_BUDGET - recent.length) };
}

/** a failed compile, as the Problems header reads it: no PDF, or errors and no pages */
export function compileFailed(log: { errors: unknown[]; status: { fatal: boolean; pages?: number } }): boolean {
	return log.status.fatal || (log.errors.length > 0 && log.status.pages === undefined);
}

/**
 * The error worth paying an AI for without being asked: the first error of a failed compile that no local
 * rule recognises. A known error already has a hint, and later errors are mostly its cascade.
 */
export function autoCandidate<E extends LogEntry>(log: { errors: E[]; status: { fatal: boolean; pages?: number } }): E | null {
	if (!compileFailed(log)) return null;
	const first = log.errors.find((e) => !e.source);
	return first && !first.ruleId ? first : null;
}

/** the numbered lines around `line`, as the prompt shows them */
export function sourceWindow(text: string, line: number, radius = 10): { n: number; text: string }[] {
	const lines = text.split(/\r\n|\r|\n/);
	const from = Math.max(1, line - radius);
	const to = Math.min(lines.length, line + radius);
	const out: { n: number; text: string }[] = [];
	for (let n = from; n <= to; n++) out.push({ n, text: lines[n - 1] });
	return out;
}

/** `text` with lines fix.from..fix.to replaced, in the file's own line ending; null if the lines moved since */
export function applyLineFix(text: string, fix: LineFix, expected: string): string | null {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r\n|\r|\n/);
	if (fix.to > lines.length) return null;
	// the file was edited since the AI saw it: the fix may no longer fit
	if (lines.slice(fix.from - 1, fix.to).join('\n') !== expected) return null;
	lines.splice(fix.from - 1, fix.to - fix.from + 1, ...fix.text.split(/\r\n|\r|\n/));
	return lines.join(eol);
}

/** the main file with \usepackage{pkg} added before \begin{document}; null when it is already there or there is no preamble */
export function addPackage(text: string, pkg: string): string | null {
	if (new RegExp(`\\\\usepackage(\\[[^\\]]*\\])?\\{[^}]*\\b${pkg.replace(/[-]/g, '\\-')}\\b[^}]*\\}`).test(text)) return null;
	const at = text.search(/^[ \t]*\\begin\{document\}/m);
	if (at < 0) return null;
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	return `${text.slice(0, at)}\\usepackage{${pkg}}${eol}${text.slice(at)}`;
}
