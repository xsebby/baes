import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { albums, libraryRoots, playlists, tracks } from '@baes/db';
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
const TRANSCODE_DIR = 'transcode-cache';
const inFlight = new Map<string, Promise<void>>();

/**
 * iOS compatibility: AVPlayer refuses OGG/Opus entirely, and chokes on m4a
 * files whose cover art is muxed as a PNG/MJPEG *video stream*. `compat`
 * remuxes m4a losslessly (strip video, copy audio) and transcodes OGG-family
 * sources to AAC. Results are cached on disk.
 */
async function ensureCompatFile(
  src: string,
  codec: string,
  trackId: string,
): Promise<string | null> {
  const lower = codec.toLowerCase();
  const needsEncode = /ogg|opus|vorbis/.test(lower);
  const needsRemux = /aac|mp4|alac|m4a/.test(lower);
  if (!needsEncode && !needsRemux) return null; // passthrough

  await mkdir(TRANSCODE_DIR, { recursive: true });
  const out = path.join(TRANSCODE_DIR, `${trackId}.m4a`);
  try {
    await stat(out);
    return out;
  } catch {
    // not cached yet
  }
  const existing = inFlight.get(trackId);
  if (existing) {
    await existing;
    return out;
  }
  const job = new Promise<void>((resolve, reject) => {
    const args = needsEncode
      ? ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]
      : ['-y', '-i', src, '-vn', '-c:a', 'copy', '-movflags', '+faststart', out];
    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  }).finally(() => inFlight.delete(trackId));
  inFlight.set(trackId, job);
  await job;
  return out;
}

export const streamRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
  app.get('/api/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { exp, sig, profile } = req.query as { exp?: string; sig?: string; profile?: string };
    if (!exp || !sig || !verifyMedia(config.SERVER_SECRET, 'stream', id, Number(exp), sig)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Invalid or expired URL' });
    }

    const [row] = await db
      .select({
        relPath: tracks.relPath,
        rootPath: libraryRoots.path,
        contentHash: tracks.contentHash,
        codec: tracks.codec,
      })
      .from(tracks)
      .innerJoin(libraryRoots, eq(tracks.rootId, libraryRoots.id))
      .where(and(eq(tracks.id, id), isNull(tracks.deletedAt)))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: 'Track not found' });
    }

    let filePath = path.join(row.rootPath, row.relPath);
    let mime = MIME_BY_EXT[path.extname(row.relPath).toLowerCase()] ?? 'application/octet-stream';

    if (profile === 'compat') {
      try {
        const compat = await ensureCompatFile(filePath, row.codec, id);
        if (compat) {
          filePath = compat;
          mime = 'audio/mp4';
        }
      } catch (err) {
        req.log.warn({ err }, 'compat transcode failed; serving original');
      }
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return reply.code(404).send({ error: 'not_found', message: 'File missing on disk' });
    }

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

  // Serves album covers and playlist covers by row id.
  app.get('/api/art/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    if (!exp || !sig || !verifyMedia(config.SERVER_SECRET, 'art', id, Number(exp), sig)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Invalid or expired URL' });
    }
    const [album] = await db
      .select({ artPath: albums.artPath })
      .from(albums)
      .where(eq(albums.id, id))
      .limit(1);
    let artPath = album?.artPath ?? null;
    if (!artPath) {
      const [pl] = await db
        .select({ artPath: playlists.artPath })
        .from(playlists)
        .where(eq(playlists.id, id))
        .limit(1);
      artPath = pl?.artPath ?? null;
    }
    if (!artPath) {
      return reply.code(404).send({ error: 'not_found', message: 'No art' });
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(createReadStream(artPath));
  });
};
