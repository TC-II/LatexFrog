import fs from 'node:fs';
import path from 'node:path';
import { startSidecar } from './sc.mjs';
const [root, file] = process.argv.slice(2);
const s = startSidecar(process.env.LV_SIDECAR);
await s.req('open', { root });
const secs = (await s.req('symbols')).data.sections.filter((x) => x.file === file);
const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
const re = /\\(?:sub)*(?:section|chapter|paragraph)\*?\s*[\[{]/;
let prev = 'start';
const out = [];
for (const sec of secs) {
	const t = sec.title.replace(/\s+/g, ' ').slice(0, 12);
	let best = null;
	for (let d = 0; d < 60 && best === null; d++) {
		for (const i of [sec.line - 1 + d, sec.line - 1 - d]) {
			if (best === null && lines[i] && re.test(lines[i]) && lines[i].replace(/\s+/g, ' ').includes(t)) best = i + 1;
		}
	}
	const off = best === null ? 'none' : best - sec.line;
	if (off !== prev) { out.push(`reported line ${sec.line} "${sec.title.slice(0, 30)}" -> offset ${off}`); prev = off; }
}
console.log(`${secs.length} sections in ${file}; where the offset changes:`);
console.log(out.slice(0, 16).join('\n'));
s.close();
process.exit(0);
