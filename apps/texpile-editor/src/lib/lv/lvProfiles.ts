// Editing latexfrog.json's profiles: pure functions over the JSON object, no Svelte and no engine. A profile is a list of the
// document's pieces (cover, contents, the chapter being worked on, fixed chapters, bibliography...) plus how it compiles and where
// the PDF goes. Every function returns a new object and keeps what it does not touch, including keys the app does not know.

export type ProfileOutput = { dir: string; pattern: string; perPart?: boolean };

export type ProfileJson = {
	label?: string;
	partial?: boolean;
	externalize?: boolean;
	cacheOnly?: boolean;
	parts?: 'selection' | 'all' | 'one' | 'current' | 'list';
	cleanBefore?: boolean;
	autoCompile?: boolean;
	hidden?: boolean;
	draftImages?: boolean;
	/** the fixed parts: all of them with `list`, the ones added to the current one with `current` */
	partList?: string[];
	/** pieces the profile leaves out (`toc`, `bibliography`, `index`, `pdf:<file>`) */
	omit?: string[];
	color?: string;
	watermark?: WatermarkJson;
	output?: ProfileOutput;
	compileOn?: 'save' | 'idle';
	[key: string]: unknown;
};

export type WatermarkPosition = 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * A profile's watermark (`config::WatermarkCfg`): plain text with the fields `{date}`, `{page}` and `{profile}`, drawn under the page's
 * content in a tint of its color. Off keeps the settings without stamping them.
 */
export type WatermarkJson = {
	on?: boolean;
	text: string;
	position?: WatermarkPosition;
	color?: string;
	opacity?: number;
	size?: number;
	angle?: number;
	bold?: boolean;
};

export const WATERMARK_POSITIONS: WatermarkPosition[] = ['center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** the engine's defaults, so the screen shows what will be drawn */
export function watermarkDefaults(w: WatermarkJson): Required<WatermarkJson> {
	const position = w.position ?? 'center';
	const center = position === 'center';
	return {
		on: w.on ?? true,
		text: w.text,
		position,
		color: w.color ?? '#808080',
		opacity: w.opacity ?? 30,
		size: w.size ?? (center ? 60 : 9),
		angle: w.angle ?? (center ? 45 : 0),
		bold: w.bold ?? false
	};
}

/** the watermark's text with its fields filled for a preview */
export const watermarkPreviewText = (text: string, profile: string, date: string) =>
	text.replaceAll('{date}', date).replaceAll('{page}', '1').replaceAll('{profile}', profile);

export type ConfigJson = {
	root?: string;
	engine?: string;
	profiles?: Record<string, ProfileJson>;
	[key: string]: unknown;
};

export type Piece = { clave: string; nombre: string; lugar?: string };

export type FlagUse = 'partial' | 'externalize' | 'figureList' | 'ninguno';
export type FiguresEdit = { mode: 'project' | 'app' | 'off'; dir: string; stampFiles: string[] };
export type OutputsEdit = { publish: string; exportDir: string; pattern: string };
/** what "use detected" copies back, one part of the screen at a time */
export type ConfigSection = 'root' | 'parts' | 'flags' | 'figures' | 'outputs';

export const PROFILE_COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#D4537E', '#BA7517'];
export const DEFAULT_OUTPUT: ProfileOutput = { dir: 'PDF', pattern: '{profile}.pdf' };
/** one PDF per part: its number and its name */
export const PER_PART_PATTERN = '{num:02} - {name}.pdf';

const PROFILE_ID = /^[A-Za-z0-9_-]+$/;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const shortName = (name: string) => name.split('/').pop() ?? name;

export function parseConfig(text: string): ConfigJson | null {
	try {
		const value = JSON.parse(text) as unknown;
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
		// project variables that profiles overrode are gone (a document compiles as written): the next save leaves them out
		const config = value as ConfigJson;
		delete config.variables;
		for (const p of Object.values(config.profiles ?? {})) delete p.vars;
		return config;
	} catch {
		return null;
	}
}

export const configText = (config: ConfigJson) => `${JSON.stringify(config, null, 2)}\n`;

/** a free id from a name: ASCII, no spaces */
export function profileId(name: string, used: string[]): string {
	const base =
		name
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^\w-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.toLowerCase() || 'profile';
	let id = base;
	for (let i = 2; used.includes(id); i++) id = `${base}-${i}`;
	return PROFILE_ID.test(id) ? id : `profile-${used.length + 1}`;
}

export function setProfile(config: ConfigJson, id: string, change: ProfileJson): ConfigJson {
	const out = clone(config);
	const next: ProfileJson = { ...(out.profiles?.[id] ?? {}), ...change };
	// what equals the default is not written, as the engine does on saving
	for (const k of ['partial', 'externalize', 'cacheOnly', 'cleanBefore', 'hidden', 'draftImages'] as const) if (next[k] === false) delete next[k];
	if (next.parts === 'all') delete next.parts;
	for (const k of ['partList', 'omit'] as const) if (next[k]?.length === 0) delete next[k];
	if (!next.color) delete next.color;
	if (!next.output) delete next.output;
	// when a profile compiles by itself is now the project's choice, beside Compile: the old keys go as the profile is edited
	delete next.compileOn;
	delete next.autoCompile;
	delete next.vars;
	if (!next.watermark) delete next.watermark;
	out.profiles = { ...(out.profiles ?? {}), [id]: next };
	return out;
}

export function removeProfile(config: ConfigJson, id: string): ConfigJson {
	const out = clone(config);
	if (out.profiles) delete out.profiles[id];
	return out;
}

/** a new profile starts empty: no piece and no chapter ticked; figures from the cache, which is the fast way */
export function emptyProfile(pieces: Piece[], number: number, label: string): ProfileJson {
	return {
		label,
		color: PROFILE_COLORS[(number - 1) % PROFILE_COLORS.length],
		parts: 'list',
		partList: [],
		omit: pieces.map((p) => p.clave),
		externalize: true
	};
}

const usesFigureCache = (config: ConfigJson) => !!config.figureCache || ((config.flags as { externalize?: string[] } | undefined)?.externalize?.length ?? 0) > 0;

/**
 * A new project's profiles: Default builds the whole document, Current the part of the open file without the pieces around it
 * (cover, contents, bibliography...), the quick way to see the chapter being written. A document without parts gets Default only.
 */
export function defaultProfiles(config: ConfigJson, pieces: Piece[], hasParts: boolean, labels: { full: string; current: string }): ConfigJson {
	const cache = usesFigureCache(config);
	let out = setProfile(config, 'default', { label: labels.full, color: PROFILE_COLORS[0], externalize: cache });
	if (!hasParts) return out;
	out = setProfile(out, 'current', { label: labels.current, color: PROFILE_COLORS[1], parts: 'current', omit: pieces.map((p) => p.clave), externalize: cache });
	return out;
}

/** one row of the pieces list, in the book's order */
export type Row = { kind: 'piece'; key: string; name: string } | { kind: 'current' } | { kind: 'all' } | { kind: 'chapter'; part: string };

/** what goes before the chapters, the chapters, and what goes after. A piece with no place (no chapters) goes before. */
export function rows(pieces: Piece[], parts: string[]): Row[] {
	const piece = (p: Piece): Row => ({ kind: 'piece', key: p.clave, name: p.nombre });
	const before = pieces.filter((p) => p.lugar !== 'despues').map(piece);
	const after = pieces.filter((p) => p.lugar === 'despues').map(piece);
	const chapters: Row[] = parts.length ? [{ kind: 'current' }, { kind: 'all' }, ...parts.map((part): Row => ({ kind: 'chapter', part }))] : [];
	return [...before, ...chapters, ...after];
}

export type Selection = { all: boolean; current: boolean; list: string[] };

export function selectionOf(p: ProfileJson): Selection {
	const mode = p.parts ?? 'all';
	return { all: mode === 'all', current: mode === 'current', list: p.partList ?? [] };
}

/** back to `parts` and `partList`: all wins; otherwise the current one with the fixed ones, or only the fixed ones */
export function toParts(s: Selection): Pick<ProfileJson, 'parts' | 'partList'> {
	if (s.all) return { parts: 'all', partList: s.list };
	return { parts: s.current ? 'current' : 'list', partList: s.list };
}

/** an absolute folder (the dialog's) relative to the project root, with `/`, and `../` when it leaves it. null on another drive */
export function relativeFolder(root: string, folder: string): string | null {
	const split = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
	const a = split(root);
	const b = split(folder);
	if (a[0].toLowerCase() !== b[0].toLowerCase()) return null;
	let i = 0;
	while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
	return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}

/** what the Compile button will build, in a few words */
export function compileTarget(parts: string | undefined, currentPart: string | null, count: number): { kind: 'all' | 'current' | 'none' | 'count'; part?: string; count?: number } {
	if (parts === 'current') return currentPart ? { kind: 'current', part: shortName(currentPart) } : { kind: 'none' };
	if (parts === 'list' || parts === 'selection' || parts === 'one') return { kind: 'count', count };
	return { kind: 'all' };
}

const DEFAULT_PATTERN = '{num:02} - {name}.pdf';
const FLAG_USES = ['partial', 'externalize', 'figureList'] as const;
type Flags = Record<(typeof FLAG_USES)[number], string[]>;

export const partCommands = (config: ConfigJson): string[] => (config.parts as { commands?: string[] } | undefined)?.commands ?? ['include'];

export function setPartCommands(config: ConfigJson, list: string[]): ConfigJson {
	const clean = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
	return { ...clone(config), parts: { ...clone((config.parts as object) ?? {}), commands: clean.length ? clean : ['include'] } };
}

export function flagUse(config: ConfigJson, name: string): FlagUse {
	const flags = config.flags as Partial<Flags> | undefined;
	return FLAG_USES.find((use) => flags?.[use]?.includes(name)) ?? 'ninguno';
}

/** a macro has one use: it goes into that list and leaves the others */
export function setFlag(config: ConfigJson, name: string, use: FlagUse): ConfigJson {
	const flags: Flags = { partial: [], externalize: [], figureList: [], ...clone((config.flags as Partial<Flags>) ?? {}) };
	for (const k of FLAG_USES) flags[k] = flags[k].filter((x) => x !== name);
	if (use !== 'ninguno') flags[use].push(name);
	return { ...clone(config), flags };
}

export function figuresOf(config: ConfigJson): FiguresEdit {
	const f = config.figureCache as Record<string, unknown> | undefined;
	if (!f) return { mode: 'off', dir: 'figuras-cache', stampFiles: [] };
	return {
		mode: f.mode === 'app' || f.mode === 'off' ? f.mode : 'project',
		dir: typeof f.dir === 'string' ? f.dir : 'figuras-cache',
		stampFiles: Array.isArray(f.stampFiles) ? (f.stampFiles as string[]) : []
	};
}

/** off removes the section; the other modes keep what the screen does not show (`onlyInFigureEnv`, `parallelJobs`, unknown keys) */
export function setFigures(config: ConfigJson, f: FiguresEdit): ConfigJson {
	const out = clone(config);
	if (f.mode === 'off') {
		delete out.figureCache;
		return out;
	}
	const before = (out.figureCache as Record<string, unknown>) ?? { onlyInFigureEnv: true, parallelJobs: 'auto' };
	const next: Record<string, unknown> = { ...before, mode: f.mode, dir: f.dir.trim() || 'figuras-cache' };
	const stamps = f.stampFiles.map((x) => x.trim()).filter(Boolean);
	if (stamps.length) next.stampFiles = stamps;
	else delete next.stampFiles;
	out.figureCache = next;
	return out;
}

export function outputsOf(config: ConfigJson): OutputsEdit {
	const publish = config.publish as { dir?: string } | undefined;
	const exported = config.export as { dir?: string; pattern?: string } | undefined;
	return { publish: publish?.dir ?? '', exportDir: exported?.dir ?? '', pattern: exported?.pattern ?? DEFAULT_PATTERN };
}

/** an empty folder removes the section; the per-profile names of `publish` stay */
export function setOutputs(config: ConfigJson, o: OutputsEdit): ConfigJson {
	const out = clone(config);
	if (o.publish.trim()) out.publish = { ...((out.publish as object) ?? {}), dir: o.publish.trim() };
	else delete out.publish;
	if (o.exportDir.trim() || o.pattern.trim() !== DEFAULT_PATTERN) out.export = { ...((out.export as object) ?? {}), dir: o.exportDir.trim() || 'export', pattern: o.pattern.trim() || DEFAULT_PATTERN };
	else delete out.export;
	return out;
}

export const MACRO_NAME = /^[A-Za-z@]+$/;

export function useDetected(config: ConfigJson, detected: ConfigJson, section: ConfigSection): ConfigJson {
	const out = clone(config);
	const copy = (key: string) => {
		if (detected[key] === undefined) delete out[key];
		else out[key] = clone(detected[key]);
	};
	const keys: Record<ConfigSection, string[]> = { root: ['root'], parts: ['parts'], flags: ['flags'], figures: ['figureCache'], outputs: ['publish', 'export'] };
	keys[section].forEach(copy);
	return out;
}

/**
 * The file name a profile saves, the same sum the engine does (`config::nombre_de_salida`): `{n}` counts the files, `{num}` (or
 * `{cap}`) is the printed chapter number, `{name}` (or `{nombre}`) the part's name and `{profile}` (or `{perfil}`) the profile's;
 * `:02` pads a number with zeros. Characters Windows refuses become `-`, and the name always ends in `.pdf`.
 */
export function outputName(pattern: string, fields: { n: string; num: string; name: string; profile: string }): string {
	const clean = (t: string) => [...t].map((c) => ('<>:"/\\|?*'.includes(c) || c.charCodeAt(0) < 32 ? '-' : c)).join('').trim().replace(/\.+$/, '');
	const value: Record<string, string> = { n: fields.n, num: fields.num, cap: fields.num, name: fields.name, nombre: fields.name, profile: fields.profile, perfil: fields.profile };
	const out = pattern
		.replace(/\{(\w+)(?::0(\d+))?\}/g, (whole, key: string, width?: string) => {
			if (!(key in value)) return whole;
			const v = clean(value[key]);
			return width && /^\d+$/.test(v) ? v.padStart(Number(width), '0') : v;
		})
		.trim();
	return out.toLowerCase().endsWith('.pdf') ? out : `${out}.pdf`;
}

/** the name of an exported part: the same sum the engine does */
export function exportName(pattern: string, num: string, name: string): string {
	return outputName(pattern, { n: num, num, name, profile: '' });
}
