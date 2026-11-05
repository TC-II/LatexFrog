// The Figures panel's logic: placing the figures in the document's headings and telling why Clean is off. No Svelte and no engine,
// so it can be tested.

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
};
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
};

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

/**
 * The figures under the headings of Contents. A figure goes under the heading above its code; when the file with its code has no
 * heading above it (a figure file that a chapter inputs), under the heading above the line that brings it in. Headings with no
 * figure inside are left out; figures above every heading and compiled figures the code no longer has go in groups of their own.
 */
export function figureTree(headings: Heading[], figures: Figure[]): FigureTree {
	const under = new Map<number, Figure[]>();
	const beforeHeadings: Figure[] = [];
	const notInCode: Figure[] = [];
	for (const f of figures) {
		if (!f.codigo) {
			notInCode.push(f);
			continue;
		}
		let at = headingAbove(headings, f.codigo, f.linea);
		if (at < 0) at = headingAbove(headings, f.archivo, f.dondeLinea);
		if (at < 0) beforeHeadings.push(f);
		else under.set(at, [...(under.get(at) ?? []), f]);
	}
	const root: FigureNode[] = [];
	const stack: FigureNode[] = [];
	headings.forEach((heading, i) => {
		const node: FigureNode = { key: `${heading.file}:${heading.line}:${i}`, heading, figures: under.get(i) ?? [], children: [], total: 0, changed: 0, failed: 0 };
		while (stack.length && stack[stack.length - 1].heading.level >= heading.level) stack.pop();
		(stack.length ? stack[stack.length - 1].children : root).push(node);
		stack.push(node);
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
