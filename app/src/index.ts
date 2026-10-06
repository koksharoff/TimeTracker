import fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import usersRoutes from './routers/users.js';
import timeRoutes from './routers/time.js';
import smileRoutes from './routers/smile.js';
import eventRoutes from './routers/events.js';
import statsRoutes from './routers/stats.js';
import githubRoutes from './routers/github.js';
import healthPlugin from './plugins/health.js';
import prismaPlugin from './plugins/prisma.js';
import corsPlugin from './plugins/cors.js';
import swaggerPlugin from './plugins/swagger.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({ logger: true });

  await app.register(prismaPlugin);
  await app.register(corsPlugin);
  await app.register(swaggerPlugin);
  await app.register(healthPlugin);
  await app.register(eventRoutes, { prefix: '/events' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(githubRoutes, { prefix: '/github' });
  await app.register(timeRoutes, { prefix: '/time' });
  await app.register(smileRoutes, { prefix: '/smile' });
  await app.register(usersRoutes, { prefix: '/users' });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: 'Route not found' });
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as any).statusCode === 'number'
        ? (error as any).statusCode
        : 500;

    const message =
      typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string'
        ? (error as any).message
        : 'Internal Server Error';

    reply.status(statusCode).send({ error: message });
  });

  return app;
}
