// The one GitHub API call Texpile makes: create a repository to publish a project to. No Electron
// in here, so the tests can hand it a fetch of their own.

export type GithubFailure = 'auth' | 'exists' | 'scope' | 'network' | 'other';

export type GithubRepo = {
	/** owner/name */
	fullName: string;
	/** the repository's page */
	htmlUrl: string;
	/** the https address git pushes to */
	cloneUrl: string;
};

export type GithubCreateResult = { ok: true; repo: GithubRepo } | { ok: false; failure: GithubFailure; error?: string };

type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
	status: number;
	json(): Promise<unknown>;
}>;

/** GitHub keeps letters, digits, '.', '-' and '_' and turns the rest into '-'; doing the same here
 *  means the name shown before publishing is the name the repository gets. */
export function githubRepoName(value: string): string {
	return value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-');
}

type GetLike = (
	url: string,
	init: { method: string; headers: Record<string, string> }
) => Promise<{
	status: number;
	json(): Promise<unknown>;
}>;

/** who a repository can be published as: the signed-in account and the organizations it belongs to */
export type GithubOwners = { login: string; orgs: string[] };

export type GithubOwnersResult = { ok: true; owners: GithubOwners } | { ok: false; failure: GithubFailure; error?: string };

/**
 * The account `token` belongs to and its organizations, for the publish dialog's list. Listing
 * organizations needs the `read:org` (or `user`) scope on a classic token; a token without it
 * answers with an empty list, and the dialog then offers only `org/name` typed by hand.
 */
export async function listGithubOwners(fetchImpl: GetLike, token: string): Promise<GithubOwnersResult> {
	const headers = {
		Accept: 'application/vnd.github+json',
		Authorization: `Bearer ${token}`,
		'User-Agent': 'LatexFrog',
		'X-GitHub-Api-Version': '2022-11-28'
	};
	try {
		const me = await fetchImpl('https://api.github.com/user', { method: 'GET', headers });
		const meBody: unknown = await me.json().catch(() => null);
		if (me.status === 401) return { ok: false, failure: 'auth', error: messageOf(meBody) };
		const login = (meBody as { login?: unknown } | null)?.login;
		if (me.status !== 200 || typeof login !== 'string') return { ok: false, failure: 'other', error: messageOf(meBody) };
		// an answer that is not a list (no scope, a rate limit) is no organizations, not a failure: the
		// author can still publish to their own account
		const res = await fetchImpl('https://api.github.com/user/orgs?per_page=100', { method: 'GET', headers });
		const body: unknown = await res.json().catch(() => null);
		const orgs =
			res.status === 200 && Array.isArray(body)
				? body.map((o) => (o as { login?: unknown } | null)?.login).filter((l): l is string => typeof l === 'string')
				: [];
		return { ok: true, owners: { login, orgs } };
	} catch (e) {
		return { ok: false, failure: 'network', error: e instanceof Error ? e.message : String(e) };
	}
}

/** `org/name` publishes under an organization, a bare `name` under the signed-in account. Only the
 *  first slash splits; the owner is GitHub's login alphabet, anything else is not an owner. */
export function githubTarget(value: string): { owner?: string; name: string } | null {
	const slash = value.indexOf('/');
	if (slash < 0) return { name: githubRepoName(value) };
	const owner = value.slice(0, slash).trim();
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return null;
	return { owner, name: githubRepoName(value.slice(slash + 1)) };
}

/** GitHub's own message, which for a 422 says what was wrong with the name */
function messageOf(body: unknown): string | undefined {
	if (!body || typeof body !== 'object') return undefined;
	const b = body as { message?: unknown; errors?: { message?: unknown }[] };
	const detail = Array.isArray(b.errors) ? b.errors.map((e) => (typeof e?.message === 'string' ? e.message : '')).filter(Boolean) : [];
	const head = typeof b.message === 'string' ? b.message : '';
	return [head, ...detail].filter(Boolean).join(': ') || undefined;
}

/**
 * Create `name` under the account `token` belongs to, or under an organization when it is written
 * `org/name` (the token's user needs to be allowed to create repositories there). The token is the password half of the
 * credential git uses for github.com, so a classic token needs the `repo` scope (or `public_repo`
 * for a public repository) and a fine-grained one the Administration permission.
 */
export async function createGithubRepo(
	fetchImpl: FetchLike,
	token: string,
	opts: { name: string; isPrivate: boolean }
): Promise<GithubCreateResult> {
	const target = githubTarget(opts.name);
	if (!target) return { ok: false, failure: 'other', error: 'The organization name is not valid.' };
	const { owner, name } = target;
	if (!name) return { ok: false, failure: 'other', error: 'The repository needs a name.' };
	let res: Awaited<ReturnType<FetchLike>>;
	try {
		res = await fetchImpl(owner ? `https://api.github.com/orgs/${owner}/repos` : 'https://api.github.com/user/repos', {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'LatexFrog',
				'X-GitHub-Api-Version': '2022-11-28'
			},
			// private unless told otherwise: a missing flag would drop out of the JSON and GitHub's default is public
			body: JSON.stringify({ name, private: opts.isPrivate !== false })
		});
	} catch (e) {
		return { ok: false, failure: 'network', error: e instanceof Error ? e.message : String(e) };
	}
	const body: unknown = await res.json().catch(() => null);
	if (res.status === 201 && body && typeof body === 'object') {
		const b = body as { full_name?: unknown; html_url?: unknown; clone_url?: unknown };
		if (typeof b.full_name === 'string' && typeof b.html_url === 'string' && typeof b.clone_url === 'string')
			return { ok: true, repo: { fullName: b.full_name, htmlUrl: b.html_url, cloneUrl: b.clone_url } };
		return { ok: false, failure: 'other', error: 'GitHub created the repository but did not say where.' };
	}
	const error = messageOf(body);
	// 401 is a token GitHub does not know; 403 and 404 are one it knows that may not create
	// repositories (a rate limit is also a 403, and says so)
	if (res.status === 401) return { ok: false, failure: 'auth', error };
	if ((res.status === 403 && !/rate limit/i.test(error ?? '')) || res.status === 404) return { ok: false, failure: 'scope', error };
	if (res.status === 422 && /already exists/i.test(error ?? '')) return { ok: false, failure: 'exists', error };
	return { ok: false, failure: 'other', error: error ?? `GitHub answered ${res.status}` };
}
