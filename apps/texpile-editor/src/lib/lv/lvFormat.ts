/** a duration for the status line: seconds under a minute, else minutes and seconds */
export function formatSeconds(ms: number): string {
	const total = Math.round(ms / 1000);
	if (total < 60) return `${total} s`;
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
