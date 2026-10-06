import type { FastifyPluginAsync } from 'fastify';

// GitHub's unauthenticated limits are 60 req/h (REST) and 10 req/min (search),
// so results are cached in memory. Set GITHUB_TOKEN to raise the limits.
const CACHE_TTL_MS = 15 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  publicRepos: number | null;
  followers: number | null;
  totalCommits: number | null;
  source: 'github' | 'fallback';
}

const cache = new Map<string, { expiresAt: number; profile: GithubProfile }>();

const githubFetch = async (path: string) => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'time-tracker-coding',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`GitHub ${path} responded with ${response.status}`);
  }
  return response.json() as Promise<Record<string, any>>;
};

const fallbackProfile = (login: string): GithubProfile => ({
  login,
  name: null,
  avatarUrl: `https://github.com/${login}.png?size=96`,
  htmlUrl: `https://github.com/${login}`,
  publicRepos: null,
  followers: null,
  totalCommits: null,
  source: 'fallback',
});

const githubRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { login: string };
  }>('/:login',
  {
    schema: {
      description:
        'Public GitHub profile (name, avatar) and the number of commits authored by the user in public, non-fork repositories. ' +
        'Cached for 15 minutes; falls back to the avatar URL only when GitHub is unreachable or rate-limited.',
      tags: ['github'],
      params: {
        type: 'object',
        required: ['login'],
        properties: { login: { type: 'string' } },
      },
    },
  },
  async (request, reply) => {
    const login = request.params.login.trim();
    if (!LOGIN_PATTERN.test(login)) {
      reply.status(400);
      return { error: 'Invalid GitHub login' };
    }

    const key = login.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.profile;
    }

    let profile: GithubProfile;
    try {
      const user = await githubFetch(`/users/${encodeURIComponent(login)}`);
      const commits = await githubFetch(
        `/search/commits?q=${encodeURIComponent(`author:${login} fork:false`)}&per_page=1`,
      ).catch((err: Error) => {
        app.log.warn(err.message);
        return null;
      });

      profile = {
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatar_url,
        htmlUrl: user.html_url,
        publicRepos: user.public_repos ?? null,
        followers: user.followers ?? null,
        totalCommits: typeof commits?.total_count === 'number' ? commits.total_count : null,
        source: 'github',
      };
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, profile });
    } catch (err) {
      app.log.warn((err as Error).message);
      profile = fallbackProfile(login);
      cache.set(key, { expiresAt: Date.now() + ERROR_TTL_MS, profile });
    }

    return profile;
  });
};

export default githubRoutes;
