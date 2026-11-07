import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitThroughInputs, preambleThroughInputs } from '../../../../../electron/src/lv/preambleInputs';
import { splitForWarm } from '../../../../../electron/src/draft/draftWarmCompile';

function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'lv-pre-'));
	for (const [n, s] of Object.entries(files)) {
		const p = join(root, n);
		mkdirSync(join(p, '..'), { recursive: true });
		writeFileSync(p, s);
	}
	return root;
}

it('splits a main file at its own begin document', () => {
	const src = String.raw`\documentclass{article}
\usepackage{x}
\begin{document}
Hi
\end{document}
`;
	const s = splitThroughInputs('.', src)!;
	expect(s.file).toBeNull();
	expect(s.beginLine).toBe(3);
	expect(s.preamble.endsWith(String.raw`\begin{document}`)).toBe(true);
});

it('follows a top-level input to the file holding begin document (a book chapter file)', () => {
	const root = project({
		'structure.tex': String.raw`\usepackage{x}` + '\n',
		'body.tex': String.raw`\begin{document}
\include{ch1}
\end{document}
`
	});
	try {
		const main = String.raw`\documentclass{book}
\input{structure}
% \input{body-old}
\input{body} % the body
`;
		const s = splitThroughInputs(root, main)!;
		expect(s.file).toBe('body.tex');
		expect(s.beginLine).toBe(1);
		expect(s.bodyIsRest).toBe(true);
		expect(s.preamble).toBe(String.raw`\documentclass{book}
\input{structure}
% \input{body-old}
\begin{document}`);
		// the warm compiler's split names the body file
		writeFileSync(join(root, 'cap.tex'), main);
		expect(splitForWarm(root, 'cap.tex')).toEqual({ preamble: s.preamble, beginLine: 1, bodyFile: 'body.tex' });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it('gives no warm split when text follows the input line, but still a daemon preamble', () => {
	const root = project({ 'body.tex': String.raw`\begin{document}` + '\nA\n' });
	try {
		const main = String.raw`\documentclass{book}
\input{body}
More text
\end{document}
`;
		expect(splitThroughInputs(root, main)!.bodyIsRest).toBe(false);
		expect(preambleThroughInputs(root, main)).toBe(String.raw`\documentclass{book}
\begin{document}`);
		writeFileSync(join(root, 'cap.tex'), main);
		expect(splitForWarm(root, 'cap.tex')).toBeNull();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it('returns null when no file reaches begin document', () => {
	const root = project({ 'structure.tex': 'x\n' });
	try {
		expect(splitThroughInputs(root, String.raw`\documentclass{book}` + '\n' + String.raw`\input{structure}` + '\n')).toBeNull();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
