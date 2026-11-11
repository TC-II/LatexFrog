// LatexFrog: Live never waits for a pass a newer one replaced; it kills it (a quick switch of chapter or profile, an edit
// during a long pass). TeX writes `draft.aux` and the parts' `.aux` as it goes, so a killed pass leaves them cut wherever its
// last buffer ended, usually in the middle of a line. The next pass reads that half line at `\begin{document}` and stops with
// "File ended while scanning use of \@newl@bel": the preview fails although the sources are fine. TeX ends every line it
// writes, so a file that does not end in a newline was cut: its last, partial line is dropped before the next pass reads it.
// What that line held (a label, a contents entry) is written again by the pass itself.
import * as fs from 'node:fs';
import * as path from 'node:path';

const NEWLINE = 0x0a;

/** Drops the partial last line of `file` when it was cut. Returns whether it changed the file. */
export function dropCutLine(file: string): boolean {
	let fd: number;
	try {
		fd = fs.openSync(file, 'r+');
	} catch {
		return false; // absent, or held by a process that is still dying: that pass's products are not promoted anyway
	}
	try {
		const size = fs.fstatSync(fd).size;
		if (size === 0) return false;
		const last = Buffer.alloc(1);
		fs.readSync(fd, last, 0, 1, size - 1);
		if (last[0] === NEWLINE) return false;
		// back from the end, a block at a time, to the last newline
		const block = Buffer.alloc(4096);
		let end = size;
		let keep = 0;
		while (end > 0 && keep === 0) {
			const from = Math.max(0, end - block.length);
			const n = fs.readSync(fd, block, 0, end - from, from);
			const i = block.subarray(0, n).lastIndexOf(NEWLINE);
			if (i >= 0) keep = from + i + 1;
			end = from;
		}
		fs.ftruncateSync(fd, keep);
		return true;
	} catch {
		return false;
	} finally {
		fs.closeSync(fd);
	}
}

/** `_draft/draft.aux` and the parts' `.aux` in its folders, with their cut lines dropped. Not the kept results, and not the
 *  warm engine's own aux beside `draft.aux`: a parked engine holds that one open. Returns how many it repaired. */
export function repairCutAux(outAbs: string): number {
	let repaired = 0;
	const walk = (dir: string, depth: number) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (!(depth === 0 && e.name === 'snap') && depth < 8) walk(p, depth + 1);
			} else if (e.isFile() && (depth === 0 ? e.name === 'draft.aux' : e.name.endsWith('.aux')) && dropCutLine(p)) repaired++;
		}
	};
	walk(outAbs, 0);
	return repaired;
}
