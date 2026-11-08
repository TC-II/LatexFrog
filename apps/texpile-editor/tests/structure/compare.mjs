// Structure sense check, step 2: does what LatexFrog thinks match what the PDFs show? Deterministic, no AI.
//
// node compare.mjs <out dir>          (the folder structure.mjs filled)
//
// For each project:
//   tree vs full PDF   every heading of the Contents tree (part, chapter, section) is found in the full PDF, with its number;
//                      every bookmark of the PDF is a heading the tree knows (else the app misses a way the document heads)
//   profile vs full    for one part alone, two parts apart, and the Export of one part: each heading of the chosen parts is
//                      there with the SAME number as in the full document; no heading of a part left out is there; what the
//                      frame adds (front and back matter outside every part) is listed; pages beyond what the chosen parts
//                      take in the full PDF are counted
// Writes <out>/compare.json (everything) and <out>/digest.md (only what is off, a few lines per project: that is what an
// agent reads).
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const norm = (s) =>
	s
		.normalize('NFKD')
		.replace(/\\[a-zA-Z@]+\*?/g, ' ')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.toLowerCase();
const NUM = /^((?:\d+|[A-Z])(?:\.\d+)*|[IVXLC]+)\.?$/;
const CHAP = /^(chapter|cap[ií]tulo|kapitel|part|parte|teil|appendix|ap[eé]ndice|anhang|chapitre)\s+(\S+)$/i;

/** pages that read as a table of contents (many lines ending in a page number) are not where a heading is */
function tocPages(sk) {
	return new Set(
		sk.text.map((lines, i) => [i, lines.filter((l) => /\s\d{1,4}$/.test(l) || /^\d{1,4}$/.test(l)).length / Math.max(1, lines.length)]).filter(([, r]) => r > 0.45).map(([i]) => i)
	);
}

/** where a heading is in a PDF: its page (1-based) and the number printed with it, or null */
function locate(title, sk, skip, from = { page: 0, line: -1 }) {
	const t = norm(title);
	if (!t || t.length < 3) return null;
	for (let p = from.page; p < sk.text.length; p++) {
		if (skip.has(p)) continue;
		const lines = sk.text[p];
		for (let i = p === from.page ? from.line + 1 : 0; i < lines.length; i++) {
			const raw = lines[i];
			const n = norm(raw);
			if (n !== t && !(n.endsWith(' ' + t) && n.length - t.length <= 12)) continue;
			// the number: before the title on the line, or the line above ("Chapter 3", "3")
			let num = null;
			const head = raw.slice(0, Math.max(0, raw.length - title.length)).trim().split(/\s+/).pop() ?? '';
			if (NUM.test(head)) num = head.replace(/\.$/, '');
			if (!num && i > 0) {
				const up = lines[i - 1].trim();
				const c = CHAP.exec(up);
				if (c) num = c[2];
				else if (NUM.test(up) && up.length <= 6) num = up.replace(/\.$/, '');
			}
			return { page: p + 1, num, at: { page: p, line: i } };
		}
	}
	return null;
}

function partOf(file, parts) {
	const p = parts.find((x) => x.file && (x.file === file || x.file.replace(/\.tex$/, '') === file.replace(/\.tex$/, '')));
	return p ? (p.group ?? p.name) : null;
}

function load(dir, f) {
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
	} catch {
		return null;
	}
}

const all = [];
const digest = ['# Structure sense check', '', 'Only what is off. `num` is the number printed with a heading; `full` is the full document.', ''];
for (const name of fs.readdirSync(out).sort()) {
	const dir = path.join(out, name);
	if (name === 'work' || !fs.statSync(dir).isDirectory()) continue;
	const run = load(dir, 'run.json');
	const tree = load(dir, 'trees.json');
	const full = load(dir, 't-full.json');
	const r = { project: name, parts: tree?.parts?.filter((p) => !p.group).length ?? 0, issues: [] };
	all.push(r);
	const say = (kind, text) => r.issues.push({ kind, text });
	if (!tree || !full) {
		say('no-data', run?.error ?? run?.cases?.['t-full']?.error ?? 'the full document did not build');
	} else {
		const parts = tree.parts ?? [];
		const minLevel = Math.min(...tree.sections.map((s) => s.level), 9);
		// the headings the Contents tree shows at its top two levels
		const GENERATED = ['contents', 'table of contents', 'list of figures', 'list of tables', 'bibliography', 'references', 'index'].map(norm);
		const owner = (f) => {
			const p = tree.fileParts?.[f] ?? partOf(f, parts);
			return p ? (parts.find((x) => x.name === p)?.group ?? p) : null;
		};
		// a heading behind a switch that is off (cond) is not in the PDF by design
		const heads = tree.sections.filter((s) => !s.cond && s.level <= Math.max(minLevel + 1, 1)).map((s) => ({ ...s, part: owner(s.file) }));
		const skipFull = tocPages(full);
		const where = new Map();
		const missing = [];
		// in document order, each search after the last heading found: titles repeat across chapters ("Motivation")
		let cur = { page: 0, line: -1 };
		for (const h of heads) {
			const w = locate(h.title, full, skipFull, cur);
			if (w) {
				where.set(h, w);
				cur = w.at;
			} else missing.push(h);
		}
		const count = new Map();
		for (const h of tree.sections) count.set(norm(h.title), (count.get(norm(h.title)) ?? 0) + 1);
		const unique = (h) => count.get(norm(h.title)) === 1;
		r.headings = heads.length;
		r.found = where.size;
		if (missing.length) say('tree-not-in-pdf', `${missing.length}/${heads.length} headings of the tree not found in the full PDF: ${missing.slice(0, 6).map((h) => JSON.stringify(h.title.slice(0, 40))).join(', ')}`);
		// bookmarks the tree does not know
		// plus what LaTeX itself titles: the lists, the bibliography, the index (the tree shows them as pieces)
		const known = new Set([...tree.sections.map((s) => norm(s.title)), ...(tree.pieces ?? []).map((p) => norm(p.title ?? p.name ?? '')), ...GENERATED]);
		const strange = full.toc.filter(([lvl, t]) => lvl <= 2 && norm(t).length > 2 && ![...known].some((k) => k === norm(t) || norm(t).endsWith(' ' + k)));
		if (strange.length) say('pdf-not-in-tree', `${strange.length} bookmarks the tree does not have: ${strange.slice(0, 6).map(([, t]) => JSON.stringify(t.slice(0, 40))).join(', ')}`);
		// pages each part takes in the full PDF: from its first heading to the next part's
		const firstPage = new Map();
		for (const [h, w] of where) if (h.part && (!firstPage.has(h.part) || w.page < firstPage.get(h.part))) firstPage.set(h.part, w.page);
		const order = [...firstPage.entries()].sort((a, b) => a[1] - b[1]);
		const span = new Map(order.map(([p, pg], i) => [p, (order[i + 1]?.[1] ?? full.pages + 1) - pg]));
		r.cases = {};
		for (const id of ['t-one', 't-two', 't-export']) {
			const c = run?.cases?.[id];
			if (!c) continue;
			const sk = load(dir, `${id}.json`);
			if (!sk) {
				if (c.parts) say(id, `did not build: ${c.error ?? 'failed'}`);
				continue;
			}
			const chosen = new Set(c.parts ?? []);
			const skip = tocPages(sk);
			const cr = { pages: sk.pages, renumbered: [], lost: [], foreign: [], frame: [] };
			// the chosen parts' headings, in order with a cursor; the others only by titles that appear once in the document
			let c2 = { page: 0, line: -1 };
			for (const h of heads) {
				const f = where.get(h);
				if (h.part && chosen.has(h.part)) {
					const w = locate(h.title, sk, skip, c2);
					if (!w) cr.lost.push(h.title);
					else {
						c2 = w.at;
						if (f?.num && w.num !== f.num) cr.renumbered.push(`${JSON.stringify(h.title.slice(0, 30))} ${f.num}->${w.num ?? 'none'}`);
					}
				} else if (unique(h) && locate(h.title, sk, skip)) (h.part ? cr.foreign : cr.frame).push(h.part ? `${h.title.slice(0, 30)} (${h.part})` : h.title.slice(0, 30));
			}
			const expected = [...chosen].reduce((a, p) => a + (span.get(p) ?? 0), 0);
			cr.expectedPages = expected;
			r.cases[id] = cr;
			const parts = [...chosen].join(' + ');
			if (cr.lost.length) say(id, `${parts}: ${cr.lost.length} of its headings missing: ${cr.lost.slice(0, 4).map((t) => JSON.stringify(t.slice(0, 30))).join(', ')}`);
			if (cr.renumbered.length) say(id, `${parts}: numbered unlike the full document: ${cr.renumbered.slice(0, 4).join('; ')}`);
			if (cr.foreign.length) say(id, `${parts}: headings of parts not chosen: ${cr.foreign.slice(0, 4).join('; ')}`);
			if (cr.frame.length) say(id + ':info', `${parts}: frame headings kept: ${cr.frame.slice(0, 5).join('; ')}`);
			if (expected && sk.pages > expected + Math.max(4, expected * 0.5))
				say(id, `${parts}: ${sk.pages} pages where the parts take ${expected} in the full PDF (+${sk.pages - expected})`);
		}
	}
	const off = r.issues.filter((i) => !i.kind.endsWith(':info'));
	if (r.issues.length) {
		digest.push(`## ${name} (${r.parts} parts${r.headings ? `, ${r.found}/${r.headings} headings found` : ''})`);
		for (const i of r.issues) digest.push(`- ${i.kind}: ${i.text}`);
		digest.push('');
	}
	r.ok = off.length === 0;
}
fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify(all, null, 1));
digest.splice(3, 0, `${all.length} projects, ${all.filter((r) => r.ok).length} with nothing off.`, '');
fs.writeFileSync(path.join(out, 'digest.md'), digest.join('\n') + '\n');
console.log(`${all.length} projects; ${all.filter((r) => r.ok).length} clean; digest: ${path.join(out, 'digest.md')}`);
