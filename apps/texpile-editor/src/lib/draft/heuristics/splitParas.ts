// Splitting a .tex buffer into prose paragraphs, and re-wrapping one paragraph as the exact
// TeX the daemon typesets. The dispatcher diffs in units of these.
import type { Tree } from '@lezer/common';
import { counterBefore, counterBeforeStep, isFloatEnv, lexCats } from '../engineTruth';
import { latexTreeOf } from '$lib/languages/latex/syntax/latexTrees';
import { commonEnvFacts } from '$lib/languages/latex/knowledge/environments/envFacts';
import { commandsWith } from '$lib/languages/latex/knowledge/commands/commandFacts';
import { maskVerbatim } from './verbatim';
import { lineOpenings } from './structure/lineOpenings';
import { lineStartsOf } from './structure/sourceLines';

// open: an environment block with no \end
// wrapArgs: the list's optional argument as written on its \begin line (enumitem's label=, leftmargin=...)
export type Para = { text: string; startLine: number; wrap?: string; wrapArgs?: string; idx?: number; env?: string; head?: string; open?: boolean };

/** the bracketed optional argument right after `\begin{name}` on a line, braces balanced, or '' */
export function listArgs(line: string, name: string): string {
	const at = line.indexOf(`\\begin{${name}}`);
	if (at < 0) return '';
	let i = at + name.length + 8;
	while (line[i] === ' ' || line[i] === '\t') i++;
	if (line[i] !== '[') return '';
	let depth = 0;
	for (let j = i + 1; j < line.length; j++) {
		const c = line[j];
		if (c === '\\') j++;
		else if (c === '{') depth++;
		else if (c === '}') depth--;
		else if (c === ']' && depth === 0) return line.slice(i, j + 1);
		else if (c === '%') return '';
	}
	return '';
}

// Split a .tex buffer into prose paragraphs (line-numbered), treating blank lines and
// block-level command lines (\begin, \item, \chapter, ...) as boundaries -- so the header
// line above a body paragraph isn't glued onto it.
const BLOCK_COMMANDS = new Set([
	...commandsWith('section'),
	...'begin end item maketitle caption label title author date bibliography printbibliography tableofcontents input include'.split(' ')
]);
// lists wrapItem can re-open bare; `list` and thebibliography take arguments
const DRAFT_LISTS = ['itemize', 'enumerate', 'description'];
const ITEM_COMMANDS = new Set(DRAFT_LISTS.flatMap((n) => commonEnvFacts(n).item ?? []));
// environments captured WHOLE (\begin..\end as one block): the daemon can typeset a complete
// env (display math, tabular, quote), never a bare body. Lists keep per-item capture;
// document would swallow everything.
// frame: beamer slide CONTENT is ordinary prose/lists on the slide's page -- capturing the
// whole frame would make every slide edit a full pass, and the daemon can't typeset a frame
// anyway (it builds a whole page). Non-beamer `frame` envs degrade safely: the locate
// ladder's content verification refuses wrong splices.
const NON_BLOCK_ENVS = new Set(['document', 'frame', ...DRAFT_LISTS]);

/** an environment whose content is ordinary prose or per-item lists, so it is no env block */
export function isProseEnv(name: string): boolean {
	return NON_BLOCK_ENVS.has(name);
}

// environments that set their content in boxes or columns of their own, or hold drawing code: never split inside
const BOXING_ENVS = new Set(['minipage', 'multicols', 'multicols*', 'tikzpicture', 'pgfpicture', 'circuitikz', 'axis', 'forest', 'tabbing']);

function mayContainProse(name: string): boolean {
	if (NON_BLOCK_ENVS.has(name) || BOXING_ENVS.has(name) || isFloatEnv(name)) return false;
	const f = commonEnvFacts(name);
	return !f.body && !f.cells && !f.rows && !f.item && !f.in;
}

/** A plain environment holding several paragraphs -- a frame or margin wrapper around a whole exercise or the whole
 *  document (mdframed, adjustwidth). Captured whole it could never patch: it spans pages, and every edit in it took a
 *  full pass. Its paragraphs split like the top level's, and the locate ladder's checks hold as anywhere else. A
 *  single-paragraph environment (abstract, a centred line) stays one block: the daemon reproduces it whole. */
export function isProseContainer(name: string, block: string): boolean {
	return mayContainProse(name) && /\n[ \t]*\r?\n/.test(block.replace(/\s+$/, ''));
}
// sectioning lines are captured as their own single-line blocks so a title edit rides the
// instant path. \chapter (page-clearing) stays a boundary -> the debounced recompile
// handles it. \paragraph/\subparagraph are RUN-IN: TeX merges the heading into the
// following prose's first line, so the heading line and the prose after it are captured
// as ONE block -- split, neither half could ever match the page band.
// the kernel headings the instant path takes, in level order: the data has no counter names yet, and a class
// heading's counter is not the command's
const PINNED_HEADS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const RUN_IN_FROM = 3;
const HEADINGS = new Set(PINNED_HEADS.slice(0, RUN_IN_FROM));
const RUN_INS = new Set(PINNED_HEADS.slice(RUN_IN_FROM));
const HEADING_ARGUMENT = /^\*?\s*[[{]/;

export function splitParas(src: string): Para[] {
	return splitParaLines(src, src.split('\n'));
}

// same splitter over a pre-split line array: decideEdit shares ONE split of each buffer
// between here, the cut comparison and buildPatch instead of five full-doc re-splits
export function splitParaLines(src: string, lines: string[], tree: Tree = latexTreeOf(src)): Para[] {
	const out: Para[] = [];
	let cur: string[] = [];
	let start = 0;
	let wrap = '';
	let wrapArgs = '';
	let idx = 0;
	let curHead = '';
	const listStack: { env: string; n: number; args: string }[] = [];
	const starts = lineStartsOf(lines);
	// the environments split inside: the prose ones, and those of the rest that may be prose containers
	const proseEnvs = new Set(NON_BLOCK_ENVS);
	for (const m of src.matchAll(/\\begin\s*\{([^{}\s]+)\}/g)) if (mayContainProse(m[1])) proseEnvs.add(m[1]);
	const openings = lineOpenings(src, tree, starts, proseEnvs);
	function flush() {
		if (cur.length) out.push({ text: cur.join('\n'), startLine: start + 1, wrap: wrap || undefined, ...(wrap && wrapArgs ? { wrapArgs } : {}), idx, head: curHead || undefined });
		cur = [];
		curHead = '';
	}
	for (let i = 0; i < lines.length; i++) {
		const ln = lines[i];
		const opening = openings[i];
		const command = opening?.kind === 'command' ? opening : null;
		if (opening?.kind === 'begin' && !NON_BLOCK_ENVS.has(opening.name) && !listStack.length) {
			flush();
			// its \begin line is a boundary, like \begin{document}'s
			if (!opening.open && isProseContainer(opening.name, lines.slice(i, opening.lastLine + 1).join('\n'))) continue;
			out.push({
				text: lines.slice(i, opening.lastLine + 1).join('\n'),
				startLine: i + 1,
				env: opening.name,
				...(opening.open ? { open: true } : {})
			});
			i = opening.lastLine;
			continue;
		}
		// a float in a list is no paragraph of it, so an edit inside takes the full pass
		if (opening?.kind === 'begin' && isFloatEnv(opening.name)) {
			flush();
			i = opening.lastLine;
			continue;
		}
		if (opening?.kind === 'begin' && DRAFT_LISTS.includes(opening.name)) {
			flush();
			listStack.push({ env: opening.name, n: 0, args: listArgs(ln, opening.name) });
			continue;
		}
		if (opening?.kind === 'end' && DRAFT_LISTS.includes(opening.name)) {
			flush();
			listStack.pop();
			continue;
		}
		if (command && ITEM_COMMANDS.has(command.name)) {
			flush();
			const top = listStack[listStack.length - 1];
			if (top) top.n++;
			// an \item with no text YET still opens a paragraph. It used to open none, which
			// made a freshly typed bullet invisible to the dispatcher: both sides split to the
			// same paragraphs, so the edit read as a bare buffer difference and took the
			// debounced full pass -- the pause a writer feels on pressing Enter in a list. It
			// also lost the list wrap for `\item` written with its text on the NEXT line.
			start = i;
			cur = [ln.slice(command.end - starts[i]).replace(/^[ \t]*/, '')];
			wrap = top ? top.env : '';
			wrapArgs = top ? top.args : '';
			idx = top ? top.n : 0;
			continue;
		}
		const heading = command && !listStack.length && HEADING_ARGUMENT.test(ln.slice(command.end - starts[i])) ? command.name : '';
		if (HEADINGS.has(heading)) {
			flush();
			out.push({ text: ln.trim(), startLine: i + 1, head: heading });
			continue;
		}
		if (RUN_INS.has(heading)) {
			flush();
			start = i;
			wrap = '';
			idx = 0;
			curHead = heading;
			cur = [ln];
			continue;
		}
		// a comment-only line does NOT end a TeX paragraph: writers comment out sentences mid-paragraph
		if (opening?.kind === 'comment') {
			if (cur.length) cur.push(ln);
			continue;
		}
		const blank = ln.trim() === '';
		if (blank || opening?.kind === 'begin' || opening?.kind === 'end' || (command && BLOCK_COMMANDS.has(command.name))) {
			// a blank line between a run-in head and its prose does not detach them: TeX
			// holds \paragraph's box until the next paragraph starts, so keep accumulating
			// (the blank rides along for line-span accounting; wrapHead strips it)
			if (blank && curHead && cur.every((l, k) => k === 0 || l.trim() === '')) {
				cur.push(ln);
				continue;
			}
			flush();
			continue;
		}
		if (!cur.length) {
			start = i;
			wrap = '';
			idx = 0;
		}
		cur.push(ln);
	}
	flush();
	return out;
}

// wrap a captured \item body back in its list env for the daemon (correct width + label).
// The counter is pinned so repeated typesets are deterministic -- the engine's own counter
// would accumulate across requests. The pin is the TRUE value from the last compile's
// counter log when it is known (the patch can then certify exact); without it the 0 pin's
// wrong digit fails exact verification and takes the full pass, which
// paints the real number. (A JS re-count of \item lines used to guess the value: deleted --
// reconstructing TeX counter state in JS is exactly the approximation we don't do.)
// args: the list's own optional argument (its labels and margins), so the item is set as the page set it
export function wrapItem(t: string, w?: string, line?: number, file?: string, args = '') {
	if (!w) return t;
	const pin = w === 'enumerate' && line !== undefined ? counterBeforeStep('enumi', line, file) : null;
	const setc = w === 'enumerate' ? `\\setcounter{enumi}{${pin ?? 0}}` : '';
	// \par: the daemon opens a paragraph before the text, and beamer's itemize writes a color change into it,
	// which TeX then sets as an empty line the page never had.
	// An item whose last line is a comment (a commented-out \item after it) would comment out the \end: it goes on a line of its own
	const last = t.slice(t.lastIndexOf('\n') + 1);
	const sep = stripTexComments(last) === last ? '' : '\n';
	return `${itemHead(w, args, setc)}${t}${sep}\\end{${w}}`;
}

function itemHead(w: string, args: string, setc: string): string {
	return `\\par\\begin{${w}}${args}${setc}\\item `;
}

/** where the item's own text starts in a wrapItem block (after its list's \begin, options, counter pin and \item),
 *  or 0 for any other block. Settings for the item's paragraph go there: in front of the wrapper, the \par that opens
 *  it ends the daemon's empty paragraph first, and a hook armed for the paragraph's end fires on that one instead. */
export function itemTextStart(text: string): number {
	const m = /^\\par\\begin\{([^{}]+)\}/.exec(text);
	if (!m) return 0;
	const args = listArgs(text, m[1]);
	const rest = text.slice(m[0].length + args.length);
	const pin = /^\\setcounter\{enumi\}\{-?\d+\}/.exec(rest)?.[0] ?? '';
	return rest.startsWith(pin + '\\item ') ? m[0].length + args.length + pin.length + 6 : 0;
}
// comment stripping is ONLY for JS-side lexing guards (brace balance); dispatched text
// ships verbatim -- the engine's own catcodes decide what a % means. Comment chars come
// from the engine's catcode table, verbatim bodies are masked first (\url{a%b} comments
// nothing), and escape parity is tracked so "\\% comment" strips where "\%" does not.
export function stripTexComments(s: string) {
	const cats = lexCats();
	const t = maskVerbatim(s);
	let out = '';
	for (let i = 0; i < t.length; i++) {
		const c = t.charCodeAt(i);
		if (cats.escape.has(c)) {
			out += t[i];
			if (i + 1 < t.length) out += t[++i];
		} else if (cats.comment.has(c)) {
			while (i < t.length && t[i] !== '\n') i++;
			if (i < t.length) out += '\n';
		} else out += t[i];
	}
	return out;
}
// Heading dispatch prefix: the daemon's section counters accumulate across requests
// (\section{hi} renders "1 hi", then "2 hi", ...) and \@startsection's beforeskip
// depends on the leftover @nobreak state -- both nondeterministic. Pin the counters and
// force @nobreak so every typeset of the same heading is identical. Pins are the TRUE
// values from the last compile's counter log when known -- the heading then reproduces
// the page exactly and the patch certifies; the fixed fallbacks render a wrong number
// that fails verification and takes the full pass.
// run-in levels print no number at default secnumdepth; pinned anyway for docs that raise it
const HEAD_CHAIN: Record<string, string[]> = Object.fromEntries(PINNED_HEADS.map((head, k) => [head, PINNED_HEADS.slice(0, k + 1)]));
function headPins(head: string, line?: number, file?: string): string {
	const chain = HEAD_CHAIN[head];
	if (!chain) return '';
	// the head's own counter pins to the value BEFORE its step (the \section steps it);
	// parents pin to their standing value
	return chain
		.map((c, k) => {
			const trueV = line !== undefined ? counterBefore(c, line, file) : null;
			return `\\setcounter{${c}}{${trueV ?? (k === chain.length - 1 ? 0 : 1)}}`;
		})
		.join('');
}
// blank lines inside a head para (run-in head, blank, prose) are stripped for the daemon:
// TeX attaches the head across them, and a shipped \par would detach it
export function wrapHead(t: string, head?: string, line?: number, file?: string) {
	return head
		? `\\makeatletter\\@nobreaktrue\\makeatother${headPins(head, line, file)}${t
				.split('\n')
				.filter((l) => l.trim() !== '')
				.join('\n')}`
		: t;
}
// a Para as the daemon should typeset it (list items re-wrapped, headings pinned)
export function paraTex(p: Para, file?: string) {
	return wrapHead(wrapItem(p.text, p.wrap, p.startLine, file, p.wrapArgs), p.head, p.startLine, file);
}

// While typing you pass through unbalanced states (\textbf{ before the }, $ before its
// close). An unclosed brace group has no paragraph terminator, so the daemon's typeset
// never finishes -- it blocks the full 6s timeout, then SIGKILLs and cold-respawns the
// engine. So only fire the instant patch once groups and inline math are balanced.
// (Lexes over comment-stripped text; braces inside comments aren't grouping.)
