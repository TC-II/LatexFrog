// The Figures panel's logic: grouping the figures by file and telling why Clean is off. No Svelte and no engine, so it can be tested.

export type FigureState = 'aldia' | 'pendiente' | 'falta' | 'fallo';
export type Figure = { nombre: string; slug: string | null; archivo: string | null; estado: FigureState; bytes: number };
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
};

export type FigureGroup = { file: string | null; figures: Figure[]; done: number; pending: number; failed: number };

/** by file in alphabetical order, the ones with no file last; inside a group, in list order */
export function groupFigures(figures: Figure[]): FigureGroup[] {
	const byFile = new Map<string | null, Figure[]>();
	for (const f of figures) byFile.set(f.archivo, [...(byFile.get(f.archivo) ?? []), f]);
	return [...byFile.entries()]
		.sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
		.map(([file, list]) => ({
			file,
			figures: list,
			done: list.filter((f) => f.estado === 'aldia').length,
			pending: list.filter((f) => f.estado === 'pendiente' || f.estado === 'falta').length,
			failed: list.filter((f) => f.estado === 'fallo').length
		}));
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
