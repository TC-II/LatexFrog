import { describe, expect, it } from 'vitest';
import { itemTextStart, listArgs, splitParas, wrapItem } from '$lib/draft/heuristics/splitParas';
import { itemClub } from '$lib/draft/column/paraPrefix';

describe('list options', () => {
	const doc = String.raw`\begin{enumerate}[label=\alph*., leftmargin=1.5cm, itemsep=0.4em]
    \item Calcule la tension.
    \item Otro.
\end{enumerate}`;

	it('carries the list optional argument to its items', () => {
		const p = splitParas(doc);
		expect(p[0].wrapArgs).toBe(String.raw`[label=\alph*., leftmargin=1.5cm, itemsep=0.4em]`);
		expect(wrapItem(p[0].text, p[0].wrap, undefined, undefined, p[0].wrapArgs)).toBe(
			String.raw`\par\begin{enumerate}[label=\alph*., leftmargin=1.5cm, itemsep=0.4em]\setcounter{enumi}{0}\item Calcule la tension.\end{enumerate}`
		);
	});

	it('reads brackets inside braces and stops at a comment', () => {
		expect(listArgs(String.raw`\begin{itemize} [label={[\arabic*]}] x`, 'itemize')).toBe(String.raw`[label={[\arabic*]}]`);
		expect(listArgs(String.raw`\begin{itemize}[label=% cut`, 'itemize')).toBe('');
		expect(listArgs(String.raw`\begin{itemize}`, 'itemize')).toBe('');
	});

	it('pins an item club penalty just before its item, nowhere else', () => {
		const t = String.raw`\par\begin{itemize}[nosep]\item Body.\end{itemize}`;
		expect(t.slice(itemTextStart(t))).toBe(String.raw`Body.\end{itemize}`);
		const p = { pen: [10000, 150, 0, 100, 50] } as never;
		expect(itemClub(p, t)).toBe(
			String.raw`\par\begin{itemize}[nosep]\ifcsname @clubpenalty\endcsname\csname @clubpenalty\endcsname=10000\relax\fi\item Body.\end{itemize}`
		);
		expect(itemClub(p, 'Plain.')).toBe('Plain.');
		expect(itemClub(null, t)).toBe(t);
		const n = String.raw`\par\begin{enumerate}\setcounter{enumi}{2}\item Third.\end{enumerate}`;
		expect(n.slice(itemTextStart(n))).toBe(String.raw`Third.\end{enumerate}`);
	});
});

describe('wrapItem', () => {
	it('puts the list end on its own line after an item ending in a comment', () => {
		const p = splitParas('\\begin{enumerate}\n\\item First.\n\\item Second.\n%\\item Third, commented out\n\\end{enumerate}');
		const second = p.find((x) => x.text.startsWith('Second'))!;
		expect(second.text.endsWith('%\\item Third, commented out')).toBe(true);
		expect(wrapItem(second.text, second.wrap)).toMatch(/commented out\n\\end\{enumerate\}$/);
	});

	it('keeps the end on the same line otherwise, an escaped percent included', () => {
		expect(wrapItem('Ten \\% off.', 'itemize')).toBe('\\par\\begin{itemize}\\item Ten \\% off.\\end{itemize}');
	});
});

describe('splitParas boundaries', () => {
	it('a part line and a class heading end the paragraph above them', () => {
		const paras = splitParas('text a\n\\part{P}\ntext b\n\\specialsection{S}\ntext c');
		expect(paras.map((p) => p.text)).toEqual(['text a', 'text b', 'text c']);
	});
});

describe('a float in a list', () => {
	it('gives its body no paragraph', () => {
		const paras = splitParas(
			'\\begin{itemize}\n\\item Words.\n\\begin{figure}\n\\centering\n\\includegraphics{a}\n\\caption{Cap}\n\\end{figure}\n\\item More.\n\\end{itemize}'
		);
		expect(paras.map((p) => p.text)).toEqual(['Words.', 'More.']);
	});
});

describe('splitParas reads the syntax tree', () => {
	it('a commented \\end does not close the block', () => {
		const paras = splitParas('\\begin{quote}\nwords\n% \\end{quote}\nmore\n\\end{quote}\n\nAfter.');
		expect(paras[0]).toMatchObject({ env: 'quote', text: '\\begin{quote}\nwords\n% \\end{quote}\nmore\n\\end{quote}' });
		expect(paras[1].text).toBe('After.');
	});

	it('reads no heading inside \\iffalse or a macro body', () => {
		const paras = splitParas('\\iffalse\n\\section{Old}\n\\fi\n\n\\newcommand{\\x}{\n\\section{New}\n}\n\nText.');
		expect(paras.some((p) => p.head)).toBe(false);
	});

	it('marks a block the tree leaves unclosed', () => {
		const paras = splitParas('\\begin{document}\n\\begin{equation}\nx\n\nTail.\n\\end{document}');
		expect(paras[0]).toMatchObject({ env: 'equation', open: true, text: '\\begin{equation}\nx\n\nTail.' });
	});

	it('ends a block at its own \\end when a brace left open swallows it', () => {
		const paras = splitParas('\\begin{abstract}\nWe { study.\n\\end{abstract}\n\nTail.');
		expect(paras[0]).toMatchObject({ env: 'abstract', text: '\\begin{abstract}\nWe { study.\n\\end{abstract}' });
		expect(paras[0].open).toBeUndefined();
		expect(paras[1].text).toBe('Tail.');
	});

	it('splits the items of a list inside a brace group', () => {
		const paras = splitParas('Alpha.\n\n{\\small\n\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}}\n\nBeta.');
		expect(paras.filter((p) => p.wrap === 'itemize').map((p) => p.text)).toEqual(['one', 'two']);
	});

	it('keeps a list inside a command argument in its paragraph', () => {
		const paras = splitParas('\\footnote{\n\\begin{itemize}\n\\item one\n\\end{itemize}}');
		expect(paras.some((p) => p.wrap)).toBe(false);
	});
});

describe('prose containers', () => {
	const doc = String.raw`\begin{document}
\begin{ejresuelto}[frametitle={A}]
First paragraph of the frame.

Second paragraph, $x$ inline.
\begin{equation*}
a = b
\end{equation*}
\end{ejresuelto}
\begin{center}
One centred line.
\end{center}
\end{document}`;

	it('splits a multi-paragraph environment like the top level, its displays still whole', () => {
		const p = splitParas(doc);
		expect(p.map((x) => [x.startLine, x.env ?? ''])).toEqual([
			[3, ''],
			[5, ''],
			[6, 'equation*'],
			[10, 'center']
		]);
	});

	it('keeps a box environment whole even with several paragraphs', () => {
		const box = String.raw`\begin{minipage}{3cm}
One.

Two.
\end{minipage}`;
		expect(splitParas(box)).toEqual([expect.objectContaining({ env: 'minipage', startLine: 1 })]);
	});
});
