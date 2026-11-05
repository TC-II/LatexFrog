/** a duration for the status line: seconds under a minute, else minutes and seconds */
export function formatSeconds(ms: number): string {
	const total = Math.round(ms / 1000);
	if (total < 60) return `${total} s`;
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** the reasons stay in Spanish in `.latexfrog/history.jsonl`, whose older lines the engine still reads; this is what a person sees */
export function jobReason(reason: string): string {
	const after = (prefix: string) => (reason.startsWith(prefix) ? reason.slice(prefix.length) : null);
	const saved = after('guardado: ');
	if (saved !== null) return `saved ${saved}`;
	const outside = after('afuera: ');
	if (outside !== null) return `changed outside: ${outside}`;
	const before = after('antes del build de ');
	if (before !== null) return `before building ${before}`;
	return reason === 'el resto' ? 'remaining figures' : reason;
}
