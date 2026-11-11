// The window tells the engine what it is looking at (the open file, the active profile) and asks it for Live's driver. Those
// are several requests each, and they were started from wherever something changed, without waiting for one another: two tab
// switches in a row ran interleaved, and each one that got through asked Live for a compile that killed the one before.
// `latest` runs one job at a time and, however many times it is asked for while it runs, once more after: the last run always
// starts after the last request, so it sees the newest state, and nothing runs for a state already replaced.

/**
 * Wraps `job` so its runs never overlap. A call while it runs asks for one more run after it; several such calls share that
 * run. Each call's promise settles when a run that started after the call has ended, with that run's outcome.
 */
export function latest(job: () => Promise<void>): () => Promise<void> {
	let running: Promise<void> | null = null;
	let next: Promise<void> | null = null;
	const start = (): Promise<void> => {
		const run = job().finally(() => {
			if (running === run) running = null;
		});
		running = run;
		return run;
	};
	return () => {
		if (!running) return start();
		// the run in flight may have read the state before this call: one more after it, shared by everyone waiting
		next ??= running
			.catch(() => {})
			.then(() => {
				next = null;
				return start();
			});
		return next;
	};
}
