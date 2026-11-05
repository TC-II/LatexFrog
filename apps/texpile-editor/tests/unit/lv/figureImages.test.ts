import { describe, expect, it } from 'vitest';
import { assign, type FigureImage } from '$lib/lv/lvFigureImages';

const fig = (nombre: string, snippet: string): FigureImage => ({ nombre, snippet, pdf: `${nombre}.pdf`, archivo: 'c.tex', linea: 1 });

describe('assign', () => {
	it('gives each raw block its own figures, in order, even with the same text', () => {
		const tikz = '\\begin{tikzpicture}\\end{tikzpicture}';
		const blocks = [`\\begin{figure}${tikz}\\end{figure}`, 'other', `\\begin{figure}${tikz}${tikz}\\end{figure}`];
		const got = assign(blocks, [fig('a', tikz), fig('b', tikz), fig('c', tikz)]).map((b) => b.map((f) => f.nombre));
		expect(got).toEqual([['a'], [], ['b', 'c']]);
	});

	it('skips a figure no raw block holds instead of leaving every later figure as code', () => {
		// the book's `\input{fig_x}` outside any figure environment: the visual editor does not draw it as a raw block
		const blocks = ['\\begin{figure}\\begin{tikzpicture}A\\end{tikzpicture}\\end{figure}', '\\begin{figure}\\begin{tikzpicture}B\\end{tikzpicture}\\end{figure}'];
		const figures = [fig('a', '\\begin{tikzpicture}A\\end{tikzpicture}'), fig('x', '\\input{Secciones/fig_x}'), fig('b', '\\begin{tikzpicture}B\\end{tikzpicture}')];
		expect(assign(blocks, figures).map((b) => b.map((f) => f.nombre))).toEqual([['a'], ['b']]);
	});
});
