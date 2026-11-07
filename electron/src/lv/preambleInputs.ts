// The preamble of a main file whose \begin{document} lives in a file it \input's -- a book's
// partial-compile file (`\documentclass ... \input{structure} \input{body}` where body.tex opens
// with \begin{document}). The warm daemon and the warm compiler need the text up to
// \begin{document}; without this they had none: no paragraph of such a document could patch,
// and every full pass loaded the preamble cold.
import fs from 'node:fs';
import path from 'node:path';

const BEGIN = /^.*\\begin\{document\}.*$/m;
// a top-level \input on its own line, not commented out
const INPUT = /^[ \t]*\\input[ \t]*\{([^{}]+)\}[ \t]*(?:%.*)?\r?$/;
const BLANK_OR_COMMENT = /^[ \t]*(?:%.*)?\r?$/;

export type BeginSplit = {
	/** the text up to and including the \begin{document} line, \input's spliced in */
	preamble: string;
	/** root-relative path of the file holding \begin{document}; null when it is the main file itself */
	file: string | null;
	/** that line, 1-based, in that file */
	beginLine: number;
	/** nothing but blank and comment lines follows the \input line in every file that led there:
	 *  the document body is exactly that file's rest */
	bodyIsRest: boolean;
};

function readTex(root: string, name: string): { rel: string; src: string } | null {
	for (const n of [name, name + '.tex']) {
		try {
			const p = path.resolve(root, n);
			if (fs.statSync(p).isFile()) return { rel: n.replace(/\\/g, '/'), src: fs.readFileSync(p, 'utf8') };
		} catch {
			/* next candidate */
		}
	}
	return null;
}

/** Split at \begin{document}, following top-level \input lines (relative to the project root, as
 *  TeX resolves them) when the text itself has none. */
export function splitThroughInputs(root: string, src: string, depth = 0): BeginSplit | null {
	const m = src.match(BEGIN);
	if (m && m.index !== undefined) {
		const preamble = src.slice(0, m.index + m[0].length);
		return { preamble, file: null, beginLine: preamble.split('\n').length, bodyIsRest: true };
	}
	if (depth >= 3) return null;
	const lines = src.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const inp = INPUT.exec(lines[i]);
		if (!inp) continue;
		const child = readTex(root, inp[1].trim());
		if (child === null || !/\\begin\{document\}/.test(child.src)) continue;
		const inner = splitThroughInputs(root, child.src, depth + 1);
		if (inner === null) return null;
		const before = lines.slice(0, i).join('\n');
		return {
			preamble: (before ? before + '\n' : '') + inner.preamble,
			file: inner.file ?? child.rel,
			beginLine: inner.beginLine,
			bodyIsRest: inner.bodyIsRest && lines.slice(i + 1).every((l) => BLANK_OR_COMMENT.test(l))
		};
	}
	return null;
}

export function preambleThroughInputs(root: string, src: string): string | null {
	return splitThroughInputs(root, src)?.preamble ?? null;
}
