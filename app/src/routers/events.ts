import type { FastifyPluginAsync } from 'fastify';
import type { TrackingEvent } from '../types.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const fileSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: {
        path: { type: 'string' },
        language: { type: 'string' },
        fileName: { type: 'string' },
        workspaceFolder: { type: ['string', 'null'] },
      },
    },
  ],
};

const sessionSchema = {
  type: 'object',
  required: ['hostname', 'user', 'startedAt'],
  properties: {
    hostname: { type: 'string' },
    user: { type: 'string' },
    startedAt: { type: 'string' },
    githubLogin: { type: ['string', 'null'] },
    displayName: { type: ['string', 'null'] },
  },
};

const commitSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      required: ['hash', 'repository', 'message', 'authoredAt'],
      properties: {
        hash: { type: 'string' },
        repository: { type: 'string' },
        branch: { type: ['string', 'null'] },
        message: { type: 'string' },
        authoredAt: { type: 'string' },
      },
    },
  ],
};

const eventSchema = {
  type: 'object',
  properties: {
    event: { type: 'string' },
    timestamp: { type: 'string' },
    elapsedMs: { type: 'number' },
    activeTimeMs: { type: 'number' },
    file: fileSchema,
    session: sessionSchema,
  },
};

const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { user?: string; limit?: number };
  }>('/',
  {
    schema: {
      description: 'List the most recent stored events',
      tags: ['events'],
      querystring: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            events: { type: 'array', items: eventSchema },
          },
        },
      },
    },
  },
  async (request) => {
    const userName = request.query.user?.trim();
    const events = await app.prisma.event.findMany({
      ...(userName ? { where: { sessionUserName: { equals: userName, mode: 'insensitive' as const } } } : {}),
      orderBy: { id: 'desc' },
      take: request.query.limit ?? DEFAULT_LIMIT,
    });

    return {
      count: events.length,
      events: events.map((row) => ({
        event: row.event,
        timestamp: row.eventTimestamp.toISOString(),
        elapsedMs: row.elapsedMs,
        activeTimeMs: row.activeTimeMs,
        file:
          row.filePath === null &&
          row.fileLanguage === null &&
          row.fileName === null &&
          row.workspaceFolder === null
            ? null
            : {
                path: row.filePath,
                language: row.fileLanguage,
                fileName: row.fileName,
                workspaceFolder: row.workspaceFolder,
              },
        session: {
          hostname: row.sessionHostname,
          user: row.sessionUserName,
          startedAt: row.sessionStartedAt.toISOString(),
          githubLogin: row.githubLogin,
          displayName: row.displayName,
        },
      })),
    };
  });

  app.post<{
    Body: TrackingEvent;
  }>('/',
  {
    schema: {
      description: 'Store an event sent by the VS Code extension. Events of type "commit" also record the commit (deduplicated by hash).',
      tags: ['events'],
      body: {
        type: 'object',
        required: ['event', 'timestamp', 'elapsedMs', 'activeTimeMs', 'file', 'session'],
        properties: {
          ...eventSchema.properties,
          commit: commitSchema,
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
      },
    },
  },
  async (request, reply) => {
    const payload = request.body;
    const githubLogin = payload.session.githubLogin?.trim() || null;

    await app.prisma.event.create({
      data: {
        event: payload.event,
        eventTimestamp: new Date(payload.timestamp),
        elapsedMs: Math.round(payload.elapsedMs),
        activeTimeMs: Math.round(payload.activeTimeMs),
        filePath: payload.file?.path ?? null,
        fileLanguage: payload.file?.language ?? null,
        fileName: payload.file?.fileName ?? null,
        workspaceFolder: payload.file?.workspaceFolder ?? null,
        sessionHostname: payload.session.hostname,
        sessionUserName: payload.session.user,
        sessionStartedAt: new Date(payload.session.startedAt),
        githubLogin,
        displayName: payload.session.displayName?.trim() || null,
      },
    });

    if (payload.commit) {
      const commit = payload.commit;
      await app.prisma.commit.upsert({
        where: { hash: commit.hash },
        update: {},
        create: {
          hash: commit.hash,
          repository: commit.repository,
          branch: commit.branch ?? null,
          message: commit.message,
          authoredAt: new Date(commit.authoredAt),
          sessionUserName: payload.session.user,
          githubLogin,
        },
      });
    }

    reply.status(201);
    return { success: true };
  });
};

export default eventRoutes;
