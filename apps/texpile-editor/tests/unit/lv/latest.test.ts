import { describe, expect, it } from 'vitest';
import { latest } from '$lib/lv/latest';

/** a job whose runs end when the test says so, and that records what the state was when each one started */
function controlled(state: { value: string }) {
	const seen: string[] = [];
	const ends: (() => void)[] = [];
	let active = 0;
	let overlapped = false;
	const job = () => {
		seen.push(state.value);
		if (++active > 1) overlapped = true;
		return new Promise<void>((resolve) =>
			ends.push(() => {
				active--;
				resolve();
			})
		);
	};
	return { job, seen, endNext: () => ends.shift()!(), overlapped: () => overlapped };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('latest', () => {
	it('runs at once when idle', async () => {
		const state = { value: 'a' };
		const c = controlled(state);
		const run = latest(c.job);
		const p = run();
		expect(c.seen).toEqual(['a']);
		c.endNext();
		await p;
		// idle again: the next call is a run of its own
		state.value = 'b';
		const q = run();
		expect(c.seen).toEqual(['a', 'b']);
		c.endNext();
		await q;
	});

	it('collapses the calls made during a run into one more, which sees the newest state', async () => {
		const state = { value: 'a' };
		const c = controlled(state);
		const run = latest(c.job);
		const first = run();
		state.value = 'b';
		const second = run();
		state.value = 'c';
		const third = run();
		expect(third).toBe(second);
		expect(c.seen).toEqual(['a']);
		c.endNext();
		await first;
		await settle();
		// b was replaced before anything ran for it
		expect(c.seen).toEqual(['a', 'c']);
		let done = false;
		void third.then(() => (done = true));
		await settle();
		expect(done).toBe(false);
		c.endNext();
		await third;
		expect(c.overlapped()).toBe(false);
	});

	it('a call during the follow-up run asks for another', async () => {
		const state = { value: 'a' };
		const c = controlled(state);
		const run = latest(c.job);
		void run();
		state.value = 'b';
		void run();
		c.endNext();
		await settle();
		state.value = 'c';
		const last = run();
		c.endNext();
		await settle();
		expect(c.seen).toEqual(['a', 'b', 'c']);
		c.endNext();
		await last;
		expect(c.overlapped()).toBe(false);
	});

	it('a failed run does not stop the one waiting behind it', async () => {
		let n = 0;
		const run = latest(async () => {
			await settle();
			if (++n === 1) throw new Error('first fails');
		});
		const first = run();
		const second = run();
		await expect(first).rejects.toThrow('first fails');
		await expect(second).resolves.toBeUndefined();
		expect(n).toBe(2);
	});
});
