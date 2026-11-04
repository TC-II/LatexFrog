// Line diff of latexfrog.json before it is written. LCS by dynamic programming: plenty for a file of a hundred lines.
export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string };
export type DiffRow = DiffLine | { kind: 'skip'; count: number };

const toLines = (t: string): string[] => {
	const l = t.replace(/\r\n/g, '\n').split('\n');
	if (l.at(-1) === '') l.pop();
	return l;
};

/** `before` is null when the file does not exist: every line is added */
export function lineDiff(before: string | null, after: string): DiffLine[] {
	const a = before === null ? [] : toLines(before);
	const b = toLines(after);
	const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			out.push({ kind: 'same', text: a[i] });
			i++;
			j++;
		} else if (i < a.length && (j === b.length || t[i + 1][j] >= t[i][j + 1])) {
			// on a tie, what leaves goes before what enters, as in a unified diff
			out.push({ kind: 'remove', text: a[i++] });
		} else {
			out.push({ kind: 'add', text: b[j++] });
		}
	}
	return out;
}

/** only the changed lines with `context` same lines around them; the rest collapses into skip rows */
export function compactDiff(d: DiffLine[], context = 2): DiffRow[] {
	const show = new Array<boolean>(d.length).fill(false);
	d.forEach((x, i) => {
		if (x.kind === 'same') return;
		for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) show[k] = true;
	});
	const out: DiffRow[] = [];
	let skipped = 0;
	const flush = () => {
		if (skipped > 0) out.push({ kind: 'skip', count: skipped });
		skipped = 0;
	};
	d.forEach((x, i) => {
		if (show[i]) {
			flush();
			out.push(x);
		} else skipped++;
	});
	flush();
	return out;
}
