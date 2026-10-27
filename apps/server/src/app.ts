import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { createDb } from './db.js';
import { LibraryScanner } from './library/scanner.js';
import { LibraryWatcher } from './library/watcher.js';
import { DuplicateFinder } from './library/duplicates.js';
import { backfillTags } from './library/tags.js';
import { duplicateRoutes } from './routes/duplicates.js';
import authPlugin from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { ingestRoutes } from './routes/ingest.js';
import { adminRoutes } from './routes/admin.js';
import { libraryRoutes } from './routes/library.js';
import { playlistRoutes } from './routes/playlists.js';
import { spotifyRoutes } from './routes/spotify.js';
import { streamRoutes } from './routes/stream.js';
import { tracklistRoutes } from './routes/tracklists.js';
import { SpotifySync } from './spotify/sync.js';
import { users } from '@baes/db';

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

  const scanner = new LibraryScanner(db, path.join(config.DATA_DIR, 'art'));

  const duplicates = new DuplicateFinder(
    db,
    // A configured path that doesn't exist (e.g. an image built without fp)
    // disables detection instead of failing every scan.
    config.FP_BIN && existsSync(config.FP_BIN) ? config.FP_BIN : '',
    path.join(config.DATA_DIR, 'fingerprints.fpdb'),
    app.log,
    config.FP_JOBS,
  );
  if (config.FP_BIN && !duplicates.enabled) {
    app.log.warn({ fpBin: config.FP_BIN }, 'FP_BIN not found; duplicate detection is off');
  }
  scanner.onFinished = () => duplicates.start();

  // Titles imported before tags existed still lead with their emoji.
  app.addHook('onReady', async () => {
    const n = await backfillTags(db);
    if (n > 0) app.log.info({ tracks: n }, 'moved title emoji into tags');
  });

  // Rescan automatically when files land in a library root.
  if (config.WATCH_LIBRARY && config.NODE_ENV !== 'test') {
    const watcher = new LibraryWatcher(db, scanner, app.log);
    app.addHook('onReady', async () => {
      await watcher.start();
    });
    app.addHook('onClose', async () => {
      watcher.close();
    });
  }

  app.get('/api/health', async () => ({
    status: 'ok' as const,
    version: APP_VERSION,
    // Stamped into the image by CI so the deploy job can verify what is live.
    commit: process.env.APP_COMMIT ?? 'dev',
  }));

  await app.register(authRoutes, { db, config });
  await app.register(adminRoutes, { db, config, scanner });
  await app.register(duplicateRoutes, { db, config, duplicates });
  await app.register(ingestRoutes, { db, config, scanner });
  await app.register(libraryRoutes, { db, config });
  await app.register(playlistRoutes, { db, config });
  await app.register(tracklistRoutes, { db });
  await app.register(streamRoutes, { db, config });

  const spotifySync = new SpotifySync(db, config, path.join(config.DATA_DIR, 'art'));
  await app.register(spotifyRoutes, { db, config, sync: spotifySync });

  // Mirror refresh for the owner account (single-user server): shortly after
  // boot — so freshly deployed sync fixes take effect without manual action —
  // then hourly.
  if (config.SPOTIFY_CLIENT_ID && config.NODE_ENV !== 'test') {
    const kick = async () => {
      const [owner] = await db.select({ id: users.id }).from(users).limit(1);
      if (owner) spotifySync.start(owner.id);
    };
    const bootSync = setTimeout(() => void kick(), 45 * 1000);
    bootSync.unref();
    const interval = setInterval(kick, config.SPOTIFY_SYNC_INTERVAL_MINUTES * 60 * 1000);
    interval.unref();
    app.addHook('onClose', async () => {
      clearTimeout(bootSync);
      clearInterval(interval);
    });
  }

  // Serve the built web client (SPA) when present; API keeps /api/*.
  const webDist = path.resolve(config.WEB_DIST);
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'Route not found' });
    });
  }

  app.addHook('onClose', async () => {
    await close();
  });

  return app;
}
