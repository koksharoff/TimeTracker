import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';

// A single gap between two events never counts for more than this. Protects
// the totals from sleep/suspend gaps and from events recorded by older
// extension versions that kept sending heartbeats while idle.
const MAX_EVENT_GAP_MS = 5 * 60 * 1000;
const MAX_CHART_DAYS = 90;
const DEFAULT_CHART_DAYS = 30;
const TOP_N = 8;

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const toNumber = (value: bigint | number | null | undefined) => Number(value ?? 0);

const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { days?: number; user?: string; tz?: string };
  }>('/summary',
  {
    schema: {
      description:
        'Aggregated dashboard data: per-developer summary, totals, languages, projects, daily activity and recent commits. ' +
        '`days=0` means all time; `tz` is an IANA time zone used for day boundaries.',
      tags: ['stats'],
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 0, maximum: 3650, default: 7 },
          user: { type: 'string' },
          tz: { type: 'string', default: 'UTC' },
        },
      },
    },
  },
  async (request, reply) => {
    const days = request.query.days ?? 7;
    const user = request.query.user?.trim() || null;
    const tz = request.query.tz ?? 'UTC';

    if (!isValidTimeZone(tz)) {
      reply.status(400);
      return { error: `Unknown time zone: ${tz}` };
    }

    const chartDays = days === 0 ? DEFAULT_CHART_DAYS : Math.min(days, MAX_CHART_DAYS);

    // Start of the local day `n - 1` days ago, converted back to UTC (events are stored in UTC).
    const startOfRange = async (n: number) => {
      const [row] = await app.prisma.$queryRaw<{ since: Date }[]>`
        SELECT ((date_trunc('day', now() AT TIME ZONE ${tz}) - make_interval(days => ${n - 1}::int))
                AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS since`;
      return row!.since;
    };

    const since = days === 0 ? new Date(0) : await startOfRange(days);
    const chartSince = await startOfRange(chartDays);

    const userFilter = user ? Prisma.sql`AND lower(session_user_name) = lower(${user})` : Prisma.empty;
    const eventRange = Prisma.sql`event_timestamp >= ${since} ${userFilter}`;
    const commitRange = Prisma.sql`authored_at >= ${since} ${userFilter}`;
    const activeMs = Prisma.sql`SUM(LEAST(elapsed_ms, ${MAX_EVENT_GAP_MS}))`;
    const localDay = (column: Prisma.Sql) =>
      Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;

    const [chartDates, users, userLanguages, userCommits, languages, projects, dailyTime, dailyCommits, recentCommits] =
      await Promise.all([
        app.prisma.$queryRaw<{ date: string }[]>`
          SELECT to_char(day, 'YYYY-MM-DD') AS "date"
          FROM generate_series(
            date_trunc('day', now() AT TIME ZONE ${tz}) - make_interval(days => ${chartDays - 1}::int),
            date_trunc('day', now() AT TIME ZONE ${tz}),
            interval '1 day'
          ) AS day
          ORDER BY day`,
        app.prisma.$queryRaw<
          {
            user: string;
            activeMs: bigint;
            events: bigint;
            lastSeen: Date;
            githubLogin: string | null;
            displayName: string | null;
            hostname: string;
          }[]
        >`
          SELECT session_user_name AS "user",
                 ${activeMs} AS "activeMs",
                 COUNT(*) AS "events",
                 MAX(event_timestamp) AS "lastSeen",
                 (array_agg(github_login ORDER BY event_timestamp DESC) FILTER (WHERE github_login IS NOT NULL))[1] AS "githubLogin",
                 (array_agg(display_name ORDER BY event_timestamp DESC) FILTER (WHERE display_name IS NOT NULL))[1] AS "displayName",
                 (array_agg(session_hostname ORDER BY event_timestamp DESC))[1] AS "hostname"
          FROM "Event"
          WHERE ${eventRange}
          GROUP BY session_user_name
          ORDER BY "activeMs" DESC NULLS LAST`,
        app.prisma.$queryRaw<{ user: string; language: string; activeMs: bigint }[]>`
          SELECT session_user_name AS "user", file_language AS "language", ${activeMs} AS "activeMs"
          FROM "Event"
          WHERE ${eventRange} AND file_language IS NOT NULL
          GROUP BY session_user_name, file_language`,
        app.prisma.$queryRaw<{ user: string; commits: bigint }[]>`
          SELECT session_user_name AS "user", COUNT(*) AS "commits"
          FROM "Commit"
          WHERE ${commitRange}
          GROUP BY session_user_name`,
        app.prisma.$queryRaw<{ name: string; activeMs: bigint }[]>`
          SELECT file_language AS "name", ${activeMs} AS "activeMs"
          FROM "Event"
          WHERE ${eventRange} AND file_language IS NOT NULL
          GROUP BY file_language
          ORDER BY "activeMs" DESC NULLS LAST
          LIMIT ${TOP_N}`,
        app.prisma.$queryRaw<{ name: string; activeMs: bigint }[]>`
          SELECT workspace_folder AS "name", ${activeMs} AS "activeMs"
          FROM "Event"
          WHERE ${eventRange} AND workspace_folder IS NOT NULL
          GROUP BY workspace_folder
          ORDER BY "activeMs" DESC NULLS LAST
          LIMIT ${TOP_N}`,
        app.prisma.$queryRaw<{ date: string; activeMs: bigint }[]>`
          SELECT ${localDay(Prisma.sql`event_timestamp`)} AS "date", ${activeMs} AS "activeMs"
          FROM "Event"
          WHERE event_timestamp >= ${chartSince} ${userFilter}
          GROUP BY 1`,
        app.prisma.$queryRaw<{ date: string; commits: bigint }[]>`
          SELECT ${localDay(Prisma.sql`authored_at`)} AS "date", COUNT(*) AS "commits"
          FROM "Commit"
          WHERE authored_at >= ${chartSince} ${userFilter}
          GROUP BY 1`,
        app.prisma.commit.findMany({
          where: {
            authoredAt: { gte: since },
            ...(user ? { sessionUserName: { equals: user, mode: 'insensitive' as const } } : {}),
          },
          orderBy: { authoredAt: 'desc' },
          take: 10,
        }),
      ]);

    const topLanguage = new Map<string, { language: string; activeMs: number }>();
    for (const row of userLanguages) {
      const current = topLanguage.get(row.user);
      if (!current || toNumber(row.activeMs) > current.activeMs) {
        topLanguage.set(row.user, { language: row.language, activeMs: toNumber(row.activeMs) });
      }
    }
    const commitsByUser = new Map(userCommits.map((row) => [row.user, toNumber(row.commits)]));

    // Fill every day of the chart window, including days without activity.
    const timeByDay = new Map(dailyTime.map((row) => [row.date, toNumber(row.activeMs)]));
    const commitsByDay = new Map(dailyCommits.map((row) => [row.date, toNumber(row.commits)]));
    const daily = chartDates.map(({ date }) => ({
      date,
      activeMs: timeByDay.get(date) ?? 0,
      commits: commitsByDay.get(date) ?? 0,
    }));

    const developers = users.map((row) => ({
      user: row.user,
      displayName: row.displayName,
      githubLogin: row.githubLogin,
      hostname: row.hostname,
      activeMs: toNumber(row.activeMs),
      events: toNumber(row.events),
      commits: commitsByUser.get(row.user) ?? 0,
      topLanguage: topLanguage.get(row.user)?.language ?? null,
      lastSeen: row.lastSeen.toISOString(),
    }));

    return {
      range: { days, since: since.toISOString(), timeZone: tz },
      totals: {
        activeMs: developers.reduce((sum, d) => sum + d.activeMs, 0),
        events: developers.reduce((sum, d) => sum + d.events, 0),
        commits: userCommits.reduce((sum, row) => sum + toNumber(row.commits), 0),
        developers: developers.length,
      },
      developers,
      languages: languages.map((row) => ({ name: row.name, activeMs: toNumber(row.activeMs) })),
      projects: projects.map((row) => ({ name: row.name, activeMs: toNumber(row.activeMs) })),
      daily,
      recentCommits: recentCommits.map((commit) => ({
        hash: commit.hash,
        repository: commit.repository,
        branch: commit.branch,
        message: commit.message,
        authoredAt: commit.authoredAt.toISOString(),
        user: commit.sessionUserName,
        githubLogin: commit.githubLogin,
      })),
    };
  });
};

export default statsRoutes;
