// @vitest-environment jsdom
// A project that names its main file on disk is not asked again.
//
// The bug: the saved choice lives in localStorage, per origin, so the installed app (and any fresh
// install) had none. initProject recorded "not confirmed" before projectConfig.adopt() had read
// .texpile/config.json, live mode opened the picker, and it preselected a GUESS - on a project
// whose config.json and latexfrog.json both named the right file.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const disk = new Map<string, string>();
vi.mock('$lib/files/service/fileService', () => ({
	fileService: {
		onDidUseProvider: () => () => {},
		readText: async (p: string) => {
			const text = disk.get(p.replace(/\\/g, '/'));
			if (text === undefined) throw new Error('ENOENT');
			return text;
		}
	}
}));

import { declaredMainFile } from '$lib/lv/declaredMain';
import { FolderLifecycle, type FolderLifecycleDeps } from '$lib/workspace/folderLifecycle';
import { workspaceRoot, mainFile } from '$lib/workspace/workspaceStore';
import type { TexFile } from '$lib/workspace/fileSystem';

const ROOT = 'C:/proj';
const file = (rel: string): TexFile => ({ path: `${ROOT}/${rel}`, name: rel.split('/').pop()!, relPath: rel });
const FILES = [file('Libro.tex'), file('libro_cuerpo.tex'), file('cap_actual.tex')];
const put = (rel: string, json: object) => disk.set(`${ROOT}/${rel}`, JSON.stringify(json));

beforeEach(() => {
	disk.clear();
	localStorage.clear();
	workspaceRoot.current = ROOT;
	mainFile.current = null;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('declaredMainFile', () => {
	it('reads .texpile/config.json first', async () => {
		put('.texpile/config.json', { v: 1, main: 'Libro.tex' });
		put('.latexfrog/latexfrog.json', { root: 'cap_actual.tex' });
		expect(await declaredMainFile(ROOT, FILES)).toBe(`${ROOT}/Libro.tex`);
	});

	it("falls back to the engine's root", async () => {
		put('.latexfrog/latexfrog.json', { root: 'Libro.tex' });
		expect(await declaredMainFile(ROOT, FILES)).toBe(`${ROOT}/Libro.tex`);
	});

	it('keeps an explicitly cleared main cleared', async () => {
		put('.texpile/config.json', { v: 1, main: '' });
		put('.latexfrog/latexfrog.json', { root: 'Libro.tex' });
		expect(await declaredMainFile(ROOT, FILES)).toBeNull();
	});

	it('ignores a named file that is not in the folder', async () => {
		put('.texpile/config.json', { v: 1, main: 'gone.tex' });
		expect(await declaredMainFile(ROOT, FILES)).toBeNull();
	});
});

describe('initProject with empty storage', () => {
	it("settles on the config's main instead of leaving the question open", async () => {
		put('.texpile/config.json', { v: 1, main: 'Libro.tex' });
		let confirmed: boolean | null = null;
		const deps: Partial<FolderLifecycleDeps> = {
			scanTexFiles: async () => ({ files: FILES }),
			setMainConfirmed: (v: boolean) => (confirmed = v),
			loadExistingPdf: () => {},
			setProjectMacros: () => {}
		};
		await new FolderLifecycle(deps as FolderLifecycleDeps).initProject(ROOT);
		expect(mainFile.current).toBe(`${ROOT}/Libro.tex`);
		expect(confirmed).toBe(true);
	});
});
