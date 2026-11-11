// Creating the GitHub repository a project is published to. What matters is telling apart the
// answers GitHub gives, because each wants something different done: a token it does not know is
// forgotten and asked for again, one without permission is explained, a taken name is a new name.
// The bodies are GitHub's own.
import { describe, it, expect } from 'vitest';
import { createGithubRepo, githubRepoName, githubTarget, listGithubOwners } from '../../../../../../../electron/src/git/remote/github';

type Init = { method: string; headers: Record<string, string>; body: string };

function answering(status: number, body: unknown) {
	const calls: { url: string; init: Init }[] = [];
	async function fetchImpl(url: string, init: Init) {
		calls.push({ url, init });
		return { status, json: async () => body };
	}
	return { calls, fetchImpl };
}

describe('creating a repository on GitHub', () => {
	it('names it the way GitHub would, before asking', () => {
		expect(githubRepoName('  My Thesis (final) ')).toBe('My-Thesis-final-');
		expect(githubRepoName('paper_v2.1')).toBe('paper_v2.1');
	});

	it("asks for the name and visibility with the author's token, and returns where it went", async () => {
		const { calls, fetchImpl } = answering(201, {
			full_name: 'ada/thesis',
			html_url: 'https://github.com/ada/thesis',
			clone_url: 'https://github.com/ada/thesis.git'
		});
		const res = await createGithubRepo(fetchImpl, 'tok', { name: 'thesis', isPrivate: true });
		expect(res).toEqual({
			ok: true,
			repo: { fullName: 'ada/thesis', htmlUrl: 'https://github.com/ada/thesis', cloneUrl: 'https://github.com/ada/thesis.git' }
		});
		expect(calls[0].url).toBe('https://api.github.com/user/repos');
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
		expect(JSON.parse(calls[0].init.body)).toEqual({ name: 'thesis', private: true });
	});

	it('`org/name` is created under the organization, not the account', async () => {
		const { calls, fetchImpl } = answering(201, {
			full_name: 'TC-II/Guias-E3',
			html_url: 'https://github.com/TC-II/Guias-E3',
			clone_url: 'https://github.com/TC-II/Guias-E3.git'
		});
		const res = await createGithubRepo(fetchImpl, 'tok', { name: 'TC-II/Guias E3', isPrivate: true });
		expect(res).toMatchObject({ ok: true, repo: { fullName: 'TC-II/Guias-E3' } });
		expect(calls[0].url).toBe('https://api.github.com/orgs/TC-II/repos');
		expect(JSON.parse(calls[0].init.body)).toEqual({ name: 'Guias-E3', private: true });
	});

	it('an organization that is not a GitHub login is refused before asking', async () => {
		const { calls, fetchImpl } = answering(201, {});
		expect(githubTarget('../x/y')).toBeNull();
		expect(githubTarget('-bad/y')).toBeNull();
		expect(githubTarget('ok/y')).toEqual({ owner: 'ok', name: 'y' });
		expect(await createGithubRepo(fetchImpl, 't', { name: 'a b/c', isPrivate: true })).toMatchObject({ ok: false });
		expect(calls).toHaveLength(0);
	});

	it('lists the account and its organizations for the dialog', async () => {
		const urls: string[] = [];
		async function fetchImpl(url: string) {
			urls.push(url);
			return url.endsWith('/user')
				? { status: 200, json: async () => ({ login: 'ada' }) }
				: { status: 200, json: async () => [{ login: 'TC-II' }, { login: 'ASSD-ITBA' }, {}] };
		}
		expect(await listGithubOwners(fetchImpl, 'tok')).toEqual({ ok: true, owners: { login: 'ada', orgs: ['TC-II', 'ASSD-ITBA'] } });
		expect(urls[0]).toBe('https://api.github.com/user');
	});

	it('a token that cannot list organizations still gives the account', async () => {
		async function fetchImpl(url: string) {
			return url.endsWith('/user')
				? { status: 200, json: async () => ({ login: 'ada' }) }
				: { status: 403, json: async () => ({ message: 'Resource not accessible' }) };
		}
		expect(await listGithubOwners(fetchImpl, 'tok')).toEqual({ ok: true, owners: { login: 'ada', orgs: [] } });
	});

	it('listing owners with a token GitHub does not know is an authentication failure', async () => {
		async function fetchImpl() {
			return { status: 401, json: async () => ({ message: 'Bad credentials' }) };
		}
		expect(await listGithubOwners(fetchImpl, 'old')).toMatchObject({ ok: false, failure: 'auth' });
	});

	it('a token GitHub does not know is an authentication failure', async () => {
		const { fetchImpl } = answering(401, { message: 'Bad credentials' });
		expect(await createGithubRepo(fetchImpl, 'old', { name: 'x', isPrivate: true })).toMatchObject({ ok: false, failure: 'auth' });
	});

	it('a token that may not create repositories is a permission failure, not a bad password', async () => {
		const { fetchImpl } = answering(403, { message: 'Resource not accessible by personal access token' });
		expect(await createGithubRepo(fetchImpl, 't', { name: 'x', isPrivate: false })).toMatchObject({ ok: false, failure: 'scope' });
	});

	it('a rate limit is not mistaken for a missing permission', async () => {
		const { fetchImpl } = answering(403, { message: 'API rate limit exceeded for user ID 1.' });
		expect(await createGithubRepo(fetchImpl, 't', { name: 'x', isPrivate: false })).toMatchObject({ ok: false, failure: 'other' });
	});

	it('says when the name is taken', async () => {
		const { fetchImpl } = answering(422, {
			message: 'Repository creation failed.',
			errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }]
		});
		const res = await createGithubRepo(fetchImpl, 't', { name: 'thesis', isPrivate: true });
		expect(res).toMatchObject({ ok: false, failure: 'exists' });
		expect(!res.ok && res.error).toContain('name already exists');
	});

	it('an unreachable GitHub is a network failure', async () => {
		async function fetchImpl(): Promise<never> {
			throw new Error('net::ERR_INTERNET_DISCONNECTED');
		}
		expect(await createGithubRepo(fetchImpl, 't', { name: 'x', isPrivate: true })).toMatchObject({ ok: false, failure: 'network' });
	});

	it('will not ask for a repository with no name', async () => {
		const { calls, fetchImpl } = answering(201, {});
		expect(await createGithubRepo(fetchImpl, 't', { name: '   ', isPrivate: true })).toMatchObject({ ok: false });
		expect(calls).toHaveLength(0);
	});
});
