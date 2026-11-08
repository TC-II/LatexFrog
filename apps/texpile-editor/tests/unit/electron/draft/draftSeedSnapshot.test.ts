// LatexFrog: Live's first compile starts from the profile's build, and a profile Live comes back to unchanged costs no TeX.
import { it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { seedDraftFromProfile, profileOfLiveDriver } from '../../../../../../electron/src/lv/draftSeed';
import { projectFingerprint, saveSnapshot, restoreSnapshot } from '../../../../../../electron/src/lv/draftSnapshot';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lv-draftseed-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(name: string): { root: string; out: string } {
	const root = path.join(tmp, name);
	const w = (rel: string, t: string) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), t);
	};
	w('main.tex', 'body\n');
	w('Secciones/uno.tex', 'one\n');
	w('.latexfrog/drivers/lv-a-live.tex', 'driver a\n');
	w('.latexfrog/drivers/lv-b-live.tex', 'driver b\n');
	w('.latexfrog/build/a/lv-a.aux', 'aux of a');
	w('.latexfrog/build/a/lv-a.bbl', 'bbl of a');
	w('.latexfrog/build/a/Secciones/uno.aux', 'part aux of a');
	w('.latexfrog/build/b/lv-b.aux', 'aux of b');
	return { root, out: path.join(root, '_draft') };
}

it('names the profile of a Live driver and nothing else', () => {
	expect(profileOfLiveDriver('.latexfrog/drivers/lv-perfil-1-live.tex')).toBe('perfil-1');
	expect(profileOfLiveDriver('.latexfrog\\drivers\\lv-x-live.tex')).toBe('x');
	expect(profileOfLiveDriver('main.tex')).toBeNull();
});

it('seeds aux, parts aux and bbl from the profile build, and swaps them when Live changes profile', () => {
	const { root, out } = project('seed');
	expect(seedDraftFromProfile(root, out, '.latexfrog/drivers/lv-a-live.tex')).toBe(true);
	expect(fs.readFileSync(path.join(out, 'draft.aux'), 'utf8')).toBe('aux of a');
	expect(fs.readFileSync(path.join(out, 'draft.bbl'), 'utf8')).toBe('bbl of a');
	expect(fs.readFileSync(path.join(out, 'Secciones/uno.aux'), 'utf8')).toBe('part aux of a');
	// Live's own products win while the profile stays
	fs.writeFileSync(path.join(out, 'draft.aux'), 'live wrote this');
	expect(seedDraftFromProfile(root, out, '.latexfrog/drivers/lv-a-live.tex')).toBe(false);
	expect(fs.readFileSync(path.join(out, 'draft.aux'), 'utf8')).toBe('live wrote this');
	// another profile: a's products go, b's come
	expect(seedDraftFromProfile(root, out, '.latexfrog/drivers/lv-b-live.tex')).toBe(true);
	expect(fs.readFileSync(path.join(out, 'draft.aux'), 'utf8')).toBe('aux of b');
	expect(fs.existsSync(path.join(out, 'draft.bbl'))).toBe(false);
	expect(fs.existsSync(path.join(out, 'Secciones/uno.aux'))).toBe(false);
	// not a Live driver: nothing
	expect(seedDraftFromProfile(root, out, 'main.tex')).toBe(false);
});

it('restores a profile kept result while nothing changed, and not after an edit', () => {
	const { root, out } = project('snap');
	const drvA = '.latexfrog/drivers/lv-a-live.tex';
	const drvB = '.latexfrog/drivers/lv-b-live.tex';
	fs.mkdirSync(path.join(out, 'Secciones'), { recursive: true });
	fs.writeFileSync(path.join(out, 'draft.aux'), 'A');
	fs.writeFileSync(path.join(out, 'Secciones/uno.aux'), 'A1');
	const fpA = projectFingerprint(root, drvA, 'lualatex');
	saveSnapshot(out, drvA, fpA, { ok: true, count: 3 });
	// Live goes to b, which writes its own products
	fs.writeFileSync(path.join(out, 'draft.aux'), 'B');
	fs.rmSync(path.join(out, 'Secciones/uno.aux'));
	expect(restoreSnapshot(out, drvB, projectFingerprint(root, drvB, 'lualatex'))).toBeNull();
	// back to a: same fingerprint, its result and products come back
	expect(projectFingerprint(root, drvA, 'lualatex')).toBe(fpA);
	expect(restoreSnapshot(out, drvA, projectFingerprint(root, drvA, 'lualatex'))).toEqual({ ok: true, count: 3 });
	expect(fs.readFileSync(path.join(out, 'draft.aux'), 'utf8')).toBe('A');
	expect(fs.readFileSync(path.join(out, 'Secciones/uno.aux'), 'utf8')).toBe('A1');
	// another engine is another result
	expect(projectFingerprint(root, drvA, 'xelatex')).not.toBe(fpA);
	// an edited source is a compile
	fs.writeFileSync(path.join(root, 'Secciones/uno.tex'), 'one, edited\n');
	expect(restoreSnapshot(out, drvA, projectFingerprint(root, drvA, 'lualatex'))).toBeNull();
});
