// The Figures panel's logic: placing the figures in the document's headings and telling why Clean is off. No Svelte and no engine,
// so it can be tested.

import { outlineDepths } from './lvOutlineTree';

/** `aldia` its PDF is the code's, `pendiente` the code changed, `falta` never compiled, `fallo` failed, `sinrevisar` new since the last check */
export type FigureState = 'aldia' | 'pendiente' | 'falta' | 'fallo' | 'sinrevisar';
export type Figure = {
	nombre: string;
	slug: string | null;
	archivo: string | null;
	estado: FigureState;
	bytes: number;
	/** where its code is (file and line of its `tikzpicture`); absent for a compiled figure the code no longer has */
	codigo?: string | null;
	linea?: number | null;
	/** the line of `archivo` that brings it: the `tikzpicture` itself or the `\input` of the file that has it */
	dondeLinea?: number | null;
	caption?: string | null;
	/** set for an image the code inserts (`\includegraphics`), not a TikZ figure: the image file */
	imagen?: string | null;
};
export type ImageRef = { imagen: string; codigo: string; linea: number; archivo: string; dondeLinea: number; caption: string | null };
export type FigureError = { nombre: string; mensaje: string; file: string | null; line: number | null; log: string };
export type FigureList = { fechaMs: number; total: number; completa: boolean; delSelloDeHoy: boolean; vale: boolean };
export type FiguresStatus = {
	modo: 'off' | 'project' | 'app';
	dir: string;
	sello: string | null;
	actuales: number;
	viejas: number;
	bytes: number;
	bytesViejos: number;
	figlist: FigureList | null;
	figuras: Figure[];
	pendientes: number;
	fallidas: number;
	necesitaCocer: boolean;
	errores: FigureError[];
	/** the last check is of the code as it is now: only then do the states say whether each PDF is the code's */
	revisado?: boolean;
	sinRevisar?: number;
	imagenes?: ImageRef[];
};

/** the images as rows of the tree, beside the TikZ figures */
export const imageRows = (images: ImageRef[]): Figure[] =>
	images.map((i) => ({ nombre: `${i.imagen}@${i.codigo}:${i.linea}`, slug: null, archivo: i.archivo, estado: 'aldia', bytes: 0, codigo: i.codigo, linea: i.linea, dondeLinea: i.dondeLinea, caption: i.caption, imagen: i.imagen }));

export type Heading = { level: number; title: string; file: string; line: number };

/** a heading with the figures right under it and the headings inside it that have figures */
export type FigureNode = { key: string; heading: Heading; figures: Figure[]; children: FigureNode[]; total: number; changed: number; failed: number };
export type FigureTree = { nodes: FigureNode[]; beforeHeadings: Figure[]; notInCode: Figure[] };

/** a figure that needs compiling: changed, never compiled or failed */
export const needsCompile = (f: Figure) => f.estado === 'pendiente' || f.estado === 'falta' || f.estado === 'fallo';

/** the last heading, in document order, of `file` at or above `line` */
function headingAbove(headings: Heading[], file: string | null | undefined, line: number | null | undefined): number {
	if (!file || line == null) return -1;
	let found = -1;
	headings.forEach((h, i) => {
		if (h.file === file && h.line <= line) found = i;
	});
	return found;
}

/** Contents' list (the engine's composition), as far as the tree needs it: a part with an entry of its own (a guide, named by its
 * title) and the headings, each with the part it is in. Pieces have no figures of their own and are not needed. */
export type TreeItem = { kind: 'section'; index: number; part: string | null; opens?: string } |{ kind: 'part'; name: string; label: string; file: string; line: number } | { kind: 'piece' };

/**
 * The figures in the same tree Contents shows. A part with an entry of its own (a guide: no heading heads it) is a group at the top,
 * and its headings nest inside it and nowhere else: a guide that has only exercises does not end up under the previous guide's last
 * `\part`. A figure goes under the heading above its code (a part's entry counts as a heading at the top of its file); when the file
 * with its code has none (a figure file a chapter inputs), under the heading above the line that brings it in. Groups with no figure
 * inside are left out; figures above every heading and compiled figures the code no longer has go in groups of their own. Without
 * `items` the headings alone make the tree.
 */
export function figureTree(sections: Heading[], figures: Figure[], items?: TreeItem[], groups: Record<string, string> = {}): FigureTree {
	// the tree's rows in document order: a part entry is a heading above every level, at line 0 of its own file
	// a heading that a part's call line makes (`\exercise{slug}` titles the exercise) also heads the file that line opens, as Contents
	// opens it on a click: the exercise's figures go under it, not above every heading
	type Row = { heading: Heading; key: string; part: string | null; entry: boolean; opens?: string; depth: number };
	const list = items ?? sections.map((_, index): TreeItem => ({ kind: 'section', index, part: null }));
	// the same depths Contents draws: an exercise and a worked example a guide loads are siblings under it
	const depths = outlineDepths(list, sections.map((s) => s.level), groups);
	const rows = list.flatMap((it, n): Row[] => {
		if (it.kind === 'part') return [{ heading: { level: -1, title: it.label, file: it.file, line: 0 }, key: `part:${it.name}`, part: it.name, entry: true, depth: depths[n] }];
		if (it.kind !== 'section' || !sections[it.index]) return [];
		const h = sections[it.index];
		return [{ heading: h, key: `${h.file}:${h.line}:${it.index}`, part: it.part, entry: false, opens: it.opens, depth: depths[n] }];
	});
	const opened = (file: string | null | undefined) => (file ? rows.findIndex((r) => r.opens === file) : -1);
	const entries = new Set(rows.filter((r) => r.entry).map((r) => r.part));
	const headings = rows.map((r) => r.heading);
	const under = new Map<number, Figure[]>();
	const beforeHeadings: Figure[] = [];
	const notInCode: Figure[] = [];
	for (const f of figures) {
		if (!f.codigo) {
			notInCode.push(f);
			continue;
		}
		let at = headingAbove(headings, f.codigo, f.linea);
		if (at < 0) at = opened(f.codigo);
		if (at < 0) at = headingAbove(headings, f.archivo, f.dondeLinea);
		if (at < 0) beforeHeadings.push(f);
		else under.set(at, [...(under.get(at) ?? []), f]);
	}
	// in document order inside a heading: by line in the heading's file, or by the line that brings in the file that has them
	for (const [i, list] of under) {
		const file = headings[i].file;
		const at = (f: Figure) => (f.codigo === file ? (f.linea ?? 0) : (f.dondeLinea ?? 0));
		list.sort((a, b) => at(a) - at(b));
	}
	const root: FigureNode[] = [];
	const stack: { node: FigureNode; depth: number; entry: boolean }[] = [];
	rows.forEach(({ heading, key, part, entry, depth }, i) => {
		const node: FigureNode = { key, heading, figures: under.get(i) ?? [], children: [], total: 0, changed: 0, failed: 0 };
		// a heading outside every part entry (the bibliography's, after the last guide) is not inside the last guide; an exercise's is
		// inside its guide's
		const inEntry = part !== null && (entries.has(part) || entries.has(groups[part]));
		if (!entry && !inEntry && stack[0]?.entry) stack.length = 0;
		while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
		(stack.length ? stack[stack.length - 1].node.children : root).push(node);
		stack.push({ node, depth, entry });
	});
	const count = (n: FigureNode): boolean => {
		n.children = n.children.filter(count);
		n.total = n.figures.length + n.children.reduce((a, c) => a + c.total, 0);
		n.changed = n.figures.filter((f) => f.estado === 'pendiente' || f.estado === 'falta').length + n.children.reduce((a, c) => a + c.changed, 0);
		n.failed = n.figures.filter((f) => f.estado === 'fallo').length + n.children.reduce((a, c) => a + c.failed, 0);
		return n.total > 0;
	};
	return { nodes: root.filter(count), beforeHeadings, notInCode };
}

export const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1);

/** the engine only cleans against a complete list of today's stamp and of this root: anything less would call live figures dead */
export type CleanBlock = 'no-list' | 'partial' | 'stamp' | 'other-root' | null;

export function cleanBlock(list: FigureList | null): CleanBlock {
	if (!list) return 'no-list';
	if (!list.completa) return 'partial';
	if (!list.delSelloDeHoy) return 'stamp';
	return list.vale ? null : 'other-root';
}
