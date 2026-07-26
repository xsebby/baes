import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { albums, libraryRoots, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { verifyMedia } from '../library/signing.js';

interface RouteOpts {
  db: Database;
  config: Config;
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
};

/**
 * Media byte-serving. Auth is the signed URL itself (exp+sig query params) —
 * no session header, so native audio players can fetch directly.
 * Supports single-range requests for instant seek (PRD §5.2).
 */
export const streamRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
  app.get('/api/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    if (!exp || !sig || !verifyMedia(config.SERVER_SECRET, 'stream', id, Number(exp), sig)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Invalid or expired URL' });
    }

    const [row] = await db
      .select({
        relPath: tracks.relPath,
        rootPath: libraryRoots.path,
        contentHash: tracks.contentHash,
      })
      .from(tracks)
      .innerJoin(libraryRoots, eq(tracks.rootId, libraryRoots.id))
      .where(and(eq(tracks.id, id), isNull(tracks.deletedAt)))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: 'Track not found' });
    }

    const filePath = path.join(row.rootPath, row.relPath);
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return reply.code(404).send({ error: 'not_found', message: 'File missing on disk' });
    }

    const mime = MIME_BY_EXT[path.extname(row.relPath).toLowerCase()] ?? 'application/octet-stream';
    reply.header('Accept-Ranges', 'bytes');
    reply.header('ETag', `"${row.contentHash}"`);
    reply.header('Cache-Control', 'private, max-age=0');

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (match[1] === '' && match[2] === '')) {
        return reply.code(416).header('Content-Range', `bytes */${fileStat.size}`).send();
      }
      const start = match[1] === '' ? fileStat.size - Number(match[2]) : Number(match[1]);
      const end =
        match[1] !== '' && match[2] !== ''
          ? Math.min(Number(match[2]), fileStat.size - 1)
          : fileStat.size - 1;
      if (start < 0 || start > end || start >= fileStat.size) {
        return reply.code(416).header('Content-Range', `bytes */${fileStat.size}`).send();
      }
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${fileStat.size}`)
        .header('Content-Length', end - start + 1)
        .type(mime)
        .send(createReadStream(filePath, { start, end }));
    }

    return reply
      .code(200)
      .header('Content-Length', fileStat.size)
      .type(mime)
      .send(createReadStream(filePath));
  });

  app.get('/api/art/:albumId', async (req, reply) => {
    const { albumId } = req.params as { albumId: string };
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    if (!exp || !sig || !verifyMedia(config.SERVER_SECRET, 'art', albumId, Number(exp), sig)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Invalid or expired URL' });
    }
    const [album] = await db
      .select({ artPath: albums.artPath })
      .from(albums)
      .where(eq(albums.id, albumId))
      .limit(1);
    if (!album?.artPath) {
      return reply.code(404).send({ error: 'not_found', message: 'No art for album' });
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(createReadStream(album.artPath));
  });
};
