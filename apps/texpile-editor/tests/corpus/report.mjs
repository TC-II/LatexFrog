// Aggregate res2/*.json (+ live-*.json, pm logs) into a markdown report body.
import fs from 'node:fs';
import path from 'node:path';
const S = process.argv[2];
const man = JSON.parse(fs.readFileSync(path.join(S, 'manifest.json'), 'utf8'));
const res = path.join(S, 'res2');
const get = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const rows = [], bugs = new Map();
const sevOrder = { BUG: 0, ENV: 1, PROJECT: 2, INFO: 3 };
const byArea = {};
for (const m of man) {
	const b = get(path.join(res, m.id + '.json'));
	const l = get(path.join(res, 'live-' + m.id + '.json'));
	let pm = '';
	try { pm = fs.readFileSync(path.join(S, 'logs2', `pm-${m.id}.out`), 'utf8'); } catch {}
	const outc = pm.match(/OUTCOMES (\{[^}]*\})/)?.[1] ?? '';
	const compiled = b?.steps ? Object.keys(b.steps).filter((k) => k.startsWith('compile:') && !k.endsWith('_ms')).map((k) => [k.slice(8), b.steps[k]]) : [];
	const okc = compiled.filter(([, v]) => v?.ok).length;
	const fnd = [...(b?.findings ?? []), ...(l?.findings ?? [])];
	for (const f of fnd) {
		const key = `${f.sev}|${f.area}`;
		(byArea[key] ??= []).push({ id: m.id, ...f });
	}
	rows.push({ id: m.id, repo: m.repo, tags: m.tags.filter((t) => /^(class|pkg:(tikz|pgfplots|biblatex|natbib|glossaries|fontspec|polyglossia|xeCJK|ctex|makeidx|subfiles|standalone))/.test(t) || ['beamer', 'multi', 'bib', 'index'].includes(t)).slice(0, 6).join(' '), skipped: b?.skipped ?? (b ? '' : 'not run'), root: b?.steps?.open?.rootFile ?? '-', parts: b?.steps?.open?.parts ?? '-', profiles: compiled.length, okc, bug: fnd.filter((f) => f.sev === 'BUG').length, env: fnd.filter((f) => f.sev === 'ENV').length, proj: fnd.filter((f) => f.sev === 'PROJECT').length, live: l?.steps?.['draft-cold'] ? (l.steps['draft-cold'].ok ? `ok ${l.steps['draft-cold'].pages}p` : 'FAIL') : '-', matrix: outc, pages: compiled.find(([, v]) => v?.ok)?.[1]?.pages ?? '' });
}
let out = '';
out += '| id | tags | root | parts | profiles ok/total | pages | Live cold | Live edits | BUG | ENV | PROJECT |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of rows) out += `| ${r.id} | ${r.tags} | ${r.skipped ? '_' + r.skipped + '_' : r.root} | ${r.parts} | ${r.okc}/${r.profiles} | ${r.pages} | ${r.live} | ${r.matrix} | ${r.bug} | ${r.env} | ${r.proj} |\n`;
out += '\n';
const keys = Object.keys(byArea).sort((a, b) => sevOrder[a.split('|')[0]] - sevOrder[b.split('|')[0]] || byArea[b].length - byArea[a].length);
for (const k of keys) {
	const [sev, area] = k.split('|');
	const list = byArea[k];
	out += `### ${sev} / ${area} (${list.length})\n`;
	for (const f of list.slice(0, 12)) out += `- \`${f.id}\`: ${f.msg}${f.extra ? ' — ' + JSON.stringify(f.extra).slice(0, 200) : ''}\n`;
	if (list.length > 12) out += `- … and ${list.length - 12} more\n`;
	out += '\n';
}
fs.writeFileSync(path.join(S, 'report-body.md'), out);
console.log(out.slice(0, 3000));
