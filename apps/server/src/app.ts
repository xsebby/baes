import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { createDb } from './db.js';
import authPlugin from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';

export const APP_VERSION = '0.1.0';

export async function buildApp(config: Config) {
  const { db, close } = await createDb(config.DATABASE_URL);

  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    trustProxy: true, // behind Caddy in prod
  });

  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(authPlugin, { db });

  app.get('/api/health', async () => ({ status: 'ok' as const, version: APP_VERSION }));

  await app.register(authRoutes, { db, config });
  await app.register(adminRoutes, { db, config });

  app.addHook('onClose', async () => {
    await close();
  });

  return app;
}
