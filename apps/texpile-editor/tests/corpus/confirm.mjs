// Re-run, alone and one at a time, the profiles that failed in the (parallel) sweep. node confirm.mjs <work dir> <battery json> <out json>
import fs from 'node:fs';
import path from 'node:path';
import { startSidecar } from './sc.mjs';
const [dirArg, batJson, outFile] = process.argv.slice(2);
const root = path.resolve(dirArg).replace(/\\/g, '/');
const bat = JSON.parse(fs.readFileSync(batJson, 'utf8'));
const failed = Object.keys(bat.steps).filter((k) => k.startsWith('compile:') && !k.endsWith('_ms') && bat.steps[k] && bat.steps[k].ok === false).map((k) => k.slice(8));
const out = { id: path.basename(root), reran: {} };
if (failed.length) {
	const s = startSidecar(process.env.LV_SIDECAR);
	try {
		const o = await s.req('open', { root });
		// restore the original (non-engine-switched) config
		for (const pid of failed) {
			const mark = s.events.length;
			const ack = await s.req('compile', { profile: pid });
			if (!ack.ok) { out.reran[pid] = { error: ack.error }; continue; }
			let fin;
			try { fin = await s.waitEvent((e) => e.type === 'finished' && e.profile === pid && s.events.indexOf(e) >= mark, 240000); } catch { out.reran[pid] = { timeout: true }; await s.req('cancel'); continue; }
			const log = s.events.slice(mark).filter((e) => e.type === 'log').map((e) => e.text).join('');
			const rec = { ok: fin.ok, code: fin.code, passes: fin.passes, errors: fin.errors, ms: fin.ms, wasFirst: bat.steps['compile:' + pid].firstError ?? null };
			if (!fin.ok) {
				const pr = await s.req('problems', { profile: pid });
				rec.problems = (pr.data ?? []).filter((p) => /tex|error|fatal/i.test(p.kind) || p.severity === 'error').slice(0, 3).map((p) => `${p.kind}:${p.file ?? ''}:${p.line ?? ''} ${String(p.message).slice(0, 110)}`);
				rec.latexmkTail = log.split('\n').filter((l) => /return code|Fatal|Emergency|! |Error/.test(l)).slice(0, 5);
			}
			out.reran[pid] = rec;
		}
	} catch (e) { out.error = String(e).slice(0, 200); }
	try { s.close(); } catch {}
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(out.id, failed.length, Object.entries(out.reran).map(([k, v]) => `${k}:${v.ok}`).join(' '));
process.exit(0);
