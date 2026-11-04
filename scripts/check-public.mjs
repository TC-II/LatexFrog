// Refuses a push that adds personal material. Looks only at what this repository adds on top of upstream, since Texpile's own
// history is already public. Run by .githooks/pre-push; `node scripts/check-public.mjs` checks by hand.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

const base = git('merge-base', 'HEAD', 'upstream/master');
const files = git('-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD').split('\n').filter(Boolean);

const badPath = [/\.pdf$/i, /\.synctex/i, /(^|\/)(inspo|01-Overleaf)(\/|$)/i, /^fixtures\/libro-tc/, /\.env(\.|$)/];
// `dev` and `x` are the neutral user names of the fixture logs and the engine's unit tests
const badText = [/C:[\\/]Users[\\/](?!(dev|x)\b)/i,/01-Overleaf(?!\\Funciones|\\Introducci|\\`|`)/, /[\w.]+@gmail\.com/i];
// these two document the rule itself
const skipText = new Set(['CLAUDE.md', 'scripts/check-public.mjs']);

const problems = [];
for (const f of files) {
	if (badPath.some((r) => r.test(f))) problems.push(`${f}: file type or location not allowed`);
	if (skipText.has(f) || !fs.existsSync(f)) continue;
	const b = fs.readFileSync(f);
	if (b.includes(0)) continue;
	const text = b.toString('utf8');
	for (const r of badText) if (r.test(text)) problems.push(`${f}: matches ${r}`);
}
for (const c of git('log', '--format=%h %ae', `${base}..HEAD`).split('\n').filter(Boolean)) if (/@gmail\.com$/i.test(c)) problems.push(`commit ${c}: personal email`);

if (problems.length) {
	console.error(`check-public: ${problems.length} problem(s), push refused\n` + problems.join('\n'));
	process.exit(1);
}
console.log(`check-public: ${files.length} added or changed files are clean`);
