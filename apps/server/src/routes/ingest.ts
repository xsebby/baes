import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albums, artists, libraryRoots, playlistItems, playlists, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import type { LibraryScanner } from '../library/scanner.js';
import { downloadPillowcaseFile, pillowcaseFileId } from '../ingest/pillowcase.js';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.aiff',
  '.aif',
]);

interface RouteOpts {
  db: Database;
  config: Config;
  scanner: LibraryScanner;
}

export interface ImportJob {
  id: string;
  url: string;
  status: 'running' | 'done' | 'error';
  error: string | null;
  startedAt: string;
}

const bumpSeq = sql`nextval('change_seq')`;

function safeName(name: string): string {
  return path
    .basename(name)
    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
    .slice(0, 200);
}

export const ingestRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config, scanner }) => {
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024, files: 50 },
  });

  const uploadsDir = path.resolve(config.DATA_DIR, 'uploads');

  /** Uploads live in a server-managed library root under DATA_DIR. */
  async function ensureUploadsRoot(): Promise<void> {
    await mkdir(uploadsDir, { recursive: true });
    await db.insert(libraryRoots).values({ path: uploadsDir }).onConflictDoNothing();
  }

  app.post('/api/upload', { preHandler: app.requireOwner }, async (req, reply) => {
    await ensureUploadsRoot();
    const saved: string[] = [];
    const rejected: string[] = [];

    for await (const part of req.files()) {
      const name = safeName(part.filename ?? 'upload');
      if (!AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase())) {
        rejected.push(name);
        part.file.resume(); // drain
        continue;
      }
      let target = path.join(uploadsDir, name);
      try {
        await stat(target);
        // exists — avoid clobbering a different file with the same name
        const ext = path.extname(name);
        target = path.join(uploadsDir, `${path.basename(name, ext)}-${Date.now()}${ext}`);
      } catch {
        // does not exist — fine
      }
      await pipeline(part.file, createWriteStream(target));
      saved.push(path.basename(target));
    }

    if (saved.length > 0) scanner.start();
    return reply.code(201).send({ saved, rejected, scanning: saved.length > 0 });
  });

  // ---- Playlist cover upload ----

  app.post('/api/playlists/:id/cover', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [pl] = await db
      .select({ id: playlists.id })
      .from(playlists)
      .where(eq(playlists.id, id))
      .limit(1);
    if (!pl) {
      return reply.code(404).send({ error: 'not_found', message: 'Playlist not found' });
    }
    const part = await req.file();
    if (!part || !/^image\/(jpeg|png|webp)$/.test(part.mimetype)) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Send a JPEG, PNG, or WebP image' });
    }
    const artDir = path.resolve(config.DATA_DIR, 'art');
    await mkdir(artDir, { recursive: true });
    const target = path.join(artDir, `playlist-${id}.jpg`);
    await pipeline(part.file, createWriteStream(target));
    await db
      .update(playlists)
      .set({ artPath: target, updatedSeq: bumpSeq })
      .where(eq(playlists.id, id));
    return reply.code(204).send();
  });

  // ---- Track metadata editing ----

  const patchTrackSchema = z.object({
    title: z.string().min(1).max(300).optional(),
    artistName: z.string().max(300).nullable().optional(),
    albumTitle: z.string().max(300).nullable().optional(),
  });

  app.patch('/api/tracks/:id', { preHandler: app.requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = patchTrackSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const [track] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!track) {
      return reply.code(404).send({ error: 'not_found', message: 'Track not found' });
    }

    const updates: Record<string, unknown> = { needsReview: false, updatedSeq: bumpSeq };
    if (body.data.title !== undefined) updates.title = body.data.title;

    if (body.data.artistName !== undefined) {
      if (body.data.artistName === null || body.data.artistName.trim() === '') {
        updates.artistId = null;
      } else {
        const name = body.data.artistName.trim();
        const [existing] = await db
          .select({ id: artists.id })
          .from(artists)
          .where(sql`lower(${artists.name}) = ${name.toLowerCase()}`)
          .limit(1);
        updates.artistId =
          existing?.id ??
          (
            await db
              .insert(artists)
              .values({ name, sortName: name.replace(/^(the|a|an)\s+/i, '').toLowerCase() })
              .returning({ id: artists.id })
          )[0]!.id;
      }
    }

    if (body.data.albumTitle !== undefined) {
      if (body.data.albumTitle === null || body.data.albumTitle.trim() === '') {
        updates.albumId = null;
      } else {
        const title = body.data.albumTitle.trim();
        const artistId = (updates.artistId as string | null | undefined) ?? track.artistId;
        const [existing] = await db
          .select({ id: albums.id })
          .from(albums)
          .where(sql`lower(${albums.title}) = ${title.toLowerCase()}`)
          .limit(1);
        updates.albumId =
          existing?.id ??
          (await db.insert(albums).values({ title, artistId }).returning({ id: albums.id }))[0]!.id;
      }
    }

    await db.update(tracks).set(updates).where(eq(tracks.id, id));
    return reply.code(204).send();
  });

  app.delete('/api/tracks/:id', { preHandler: app.requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select({ id: tracks.id, relPath: tracks.relPath, rootPath: libraryRoots.path })
      .from(tracks)
      .innerJoin(libraryRoots, eq(tracks.rootId, libraryRoots.id))
      .where(eq(tracks.id, id))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: 'Track not found' });
    }

    // Only delete bytes we manage (the uploads root). For files in the user's
    // own music folders, removing the row would just get re-scanned back in —
    // and silently deleting their source files is not our call to make.
    const managed = path.resolve(row.rootPath) === uploadsDir;
    if (managed) {
      await unlink(path.join(row.rootPath, row.relPath)).catch(() => {});
    }
    await db
      .update(playlistItems)
      .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
      .where(eq(playlistItems.trackId, id));
    await db
      .update(tracks)
      .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
      .where(eq(tracks.id, id));
    return reply.send({
      deletedFile: managed,
      note: managed
        ? null
        : 'Removed from the library; the file itself lives in your music folder, so a future rescan will re-add it unless you delete the file there.',
    });
  });

  // ---- URL import via yt-dlp ----

  const jobs: ImportJob[] = [];

  const importSchema = z.object({ url: z.string().url() });

  app.post('/api/import-url', { preHandler: app.requireOwner }, async (req, reply) => {
    const body = importSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    await ensureUploadsRoot();

    const job: ImportJob = {
      id: randomUUID(),
      url: body.data.url,
      status: 'running',
      error: null,
      startedAt: new Date().toISOString(),
    };
    jobs.unshift(job);
    if (jobs.length > 50) jobs.pop();

    const pillowcaseId = pillowcaseFileId(body.data.url);
    if (pillowcaseId) {
      void downloadPillowcaseFile(pillowcaseId, uploadsDir)
        .then(() => {
          job.status = 'done';
          scanner.start();
        })
        .catch((err: unknown) => {
          job.status = 'error';
          job.error = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
        });
      return reply.code(202).send({ job });
    }

    const proc = spawn(
      'yt-dlp',
      [
        '--no-playlist',
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '--embed-metadata',
        '--embed-thumbnail',
        '-o',
        path.join(uploadsDir, '%(title)s.%(ext)s'),
        body.data.url,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += String(d);
    });
    proc.on('error', (err) => {
      job.status = 'error';
      job.error =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'yt-dlp is not installed on the server'
          : String(err.message);
    });
    proc.on('exit', (code) => {
      if (job.status === 'error') return;
      if (code === 0) {
        job.status = 'done';
        scanner.start();
      } else {
        job.status = 'error';
        job.error = stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
      }
    });

    return reply.code(202).send({ job });
  });

  app.get('/api/import-jobs', { preHandler: app.requireOwner }, async () => ({
    jobs: jobs.slice(0, 20),
  }));
};
