import type { FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import fp from 'fastify-plugin';

// Comma-separated list of allowed origins, e.g. "http://localhost:8080,https://tracker.example.com".
const DEFAULT_ORIGINS = 'http://localhost:8080,http://127.0.0.1:8080';

const corsPlugin: FastifyPluginAsync = async (app) => {
  const origins = (process.env.CORS_ORIGINS ?? DEFAULT_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflight: true,
  });
};

export default fp(corsPlugin);
