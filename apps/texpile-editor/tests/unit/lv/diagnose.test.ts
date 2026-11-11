import { describe, it, expect } from 'vitest';
import type { LogEntry } from '$lib/compileLog/types';
import { addPackage, applyLineFix, autoCandidate, budget, fingerprint, sourceWindow, HOURLY_BUDGET } from '$lib/lv/diagnose/diagnoseCore';
import { explainPrompt, parseExplanation, type ExplainRequest } from '../../../../../electron/src/lv/explainError';

const err = (over: Partial<LogEntry>): LogEntry => ({ level: 'error', message: 'Missing } inserted.', raw: '', ...over });

describe('fingerprint', () => {
	it('is the same error wherever it happens', () => {
		const a = err({ message: 'Undefined control sequence.', command: '\\alpah', context: 'l.42 $\\alpah$ with ./cap1.tex' });
		const b = err({ message: 'Undefined control sequence.', command: '\\alpah', context: 'l.910 $\\alpah$ with ./cap7.tex' });
		expect(fingerprint(a)).toBe(fingerprint(b));
	});
	it('tells different commands apart', () => {
		const a = err({ message: 'Undefined control sequence.', command: '\\alpah' });
		const b = err({ message: 'Undefined control sequence.', command: '\\betta' });
		expect(fingerprint(a)).not.toBe(fingerprint(b));
	});
});

describe('budget', () => {
	it('allows calls up to the hourly budget, then frees them as the hour slides', () => {
		const now = 10_000_000;
		const full = Array.from({ length: HOURLY_BUDGET }, (_, i) => now - i * 1000);
		expect(budget(full, now).allowed).toBe(false);
		expect(budget(full, now + 3_600_000).allowed).toBe(true);
		expect(budget([], now).left).toBe(HOURLY_BUDGET);
	});
});

describe('autoCandidate', () => {
	const failed = { fatal: true };
	it('picks the first error of a failed compile only when no rule knows it', () => {
		expect(autoCandidate({ errors: [err({ message: 'weird' })], status: failed })?.message).toBe('weird');
		expect(autoCandidate({ errors: [err({ ruleId: 'undefined-control-sequence' }), err({ message: 'x' })], status: failed })).toBeNull();
	});
	it('never fires when the compile produced a PDF', () => {
		expect(autoCandidate({ errors: [err({})], status: { fatal: false, pages: 3 } })).toBeNull();
	});
});

describe('applyLineFix', () => {
	const text = 'a\r\n\\textbf{b\r\nc\r\n';
	it('replaces the lines in the file line ending', () => {
		expect(applyLineFix(text, { from: 2, to: 2, text: '\\textbf{b}' }, '\\textbf{b')).toBe('a\r\n\\textbf{b}\r\nc\r\n');
	});
	it('refuses when the lines changed since', () => {
		expect(applyLineFix(text, { from: 2, to: 2, text: 'x' }, 'something else')).toBeNull();
	});
	it('numbers the window as the file does', () => {
		expect(sourceWindow('1\n2\n3\n4\n5', 3, 1)).toEqual([
			{ n: 2, text: '2' },
			{ n: 3, text: '3' },
			{ n: 4, text: '4' }
		]);
	});
});

describe('addPackage', () => {
	const main = '\\documentclass{book}\n\\usepackage{graphicx}\n\\begin{document}\nHi\n\\end{document}\n';
	it('adds the package before \\begin{document}', () => {
		expect(addPackage(main, 'amsmath')).toBe('\\documentclass{book}\n\\usepackage{graphicx}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n');
	});
	it('does nothing when it is already loaded, also in a list', () => {
		expect(addPackage(main, 'graphicx')).toBeNull();
		expect(addPackage('\\usepackage[x]{amssymb,amsmath}\n\\begin{document}\n', 'amsmath')).toBeNull();
	});
	it('does nothing in a file without a preamble', () => {
		expect(addPackage('Just a chapter.\n', 'amsmath')).toBeNull();
	});
});

describe('parseExplanation', () => {
	const req: ExplainRequest = {
		message: 'Missing } inserted.',
		context: 'l.12 \\textbf{Hola',
		file: 'cap1.tex',
		line: 12,
		lines: [
			{ n: 11, text: 'Texto.' },
			{ n: 12, text: '\\textbf{Hola' },
			{ n: 13, text: 'Fin.' }
		]
	};
	it('numbers the source lines in the prompt', () => {
		expect(explainPrompt(req)).toContain('12| \\textbf{Hola');
	});
	it('reads an explanation with a fix inside the lines shown', () => {
		const text = 'EXPLANATION: Falta cerrar la llave de \\textbf en la línea 12.\nFIX: 12-12\n<<<LINES\n\\textbf{Hola}\nLINES>>>';
		expect(parseExplanation(text, req)).toEqual({ explanation: 'Falta cerrar la llave de \\textbf en la línea 12.', fix: { from: 12, to: 12, text: '\\textbf{Hola}' } });
	});
	it('drops a fix outside the lines shown, a rewrite, or no change', () => {
		const outside = 'EXPLANATION: x\nFIX: 40-41\n<<<LINES\na\nLINES>>>';
		expect(parseExplanation(outside, req)?.fix).toBeNull();
		const rewrite = 'EXPLANATION: x\nFIX: 12-12\n<<<LINES\n1\n2\n3\n4\n5\nLINES>>>';
		expect(parseExplanation(rewrite, req)?.fix).toBeNull();
		const same = 'EXPLANATION: x\nFIX: 12-12\n<<<LINES\n\\textbf{Hola\nLINES>>>';
		expect(parseExplanation(same, req)?.fix).toBeNull();
	});
	it('reads an explanation without a fix, and nothing without an explanation', () => {
		expect(parseExplanation('EXPLANATION: Falta un paquete.\nFIX: none', req)).toEqual({ explanation: 'Falta un paquete.', fix: null });
		expect(parseExplanation('no idea', req)).toBeNull();
	});
});
