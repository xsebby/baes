import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
import {
  downloadPillowcaseFile,
  pillowcaseFileId,
  pillowcasePageUrl,
} from '../ingest/pillowcase.js';
import { embedAudioMetadata } from '../ingest/audio-metadata.js';
import {
  artistGridEraOptions,
  trackerhubCsvUrl,
  trackerhubImportItems,
  type TrackerImportItem,
  type TrackerImportMetadata,
} from '../ingest/trackerhub.js';

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
  const metadataCoverCacheDir = path.resolve(config.DATA_DIR, 'metadata-covers');

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

  // ---- Cover color extraction (quadrant averages, cached) ----

  const colorCache = new Map<string, string[]>();

  app.get('/api/art-colors/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cached = colorCache.get(id);
    if (cached) return { colors: cached };

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
    try {
      const { default: jpeg } = await import('jpeg-js');
      const img = jpeg.decode(await readFile(artPath), { maxMemoryUsageInMB: 64 });
      const { width, height, data } = img;
      const quad = (x0: number, y0: number) => {
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let y = y0; y < y0 + height / 2; y += 8) {
          for (let x = x0; x < x0 + width / 2; x += 8) {
            const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
            r += data[idx]!;
            g += data[idx + 1]!;
            b += data[idx + 2]!;
            n++;
          }
        }
        const boost = (v: number) => Math.min(255, Math.round((v / n) * 1.25));
        return `rgb(${boost(r)}, ${boost(g)}, ${boost(b)})`;
      };
      const colors = [
        quad(0, 0),
        quad(width / 2, 0),
        quad(0, height / 2),
        quad(width / 2, height / 2),
      ];
      colorCache.set(id, colors);
      if (colorCache.size > 500) colorCache.delete(colorCache.keys().next().value!);
      return { colors };
    } catch {
      return reply.code(422).send({ error: 'decode_failed', message: 'Could not decode art' });
    }
  });

  // ---- Album cover upload/replace ----

  app.post('/api/albums/:id/cover', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [album] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(eq(albums.id, id))
      .limit(1);
    if (!album) {
      return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
    }
    const part = await req.file();
    if (!part || !/^image\/(jpeg|png|webp)$/.test(part.mimetype)) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Send a JPEG, PNG, or WebP image' });
    }
    const artDir = path.resolve(config.DATA_DIR, 'art');
    await mkdir(artDir, { recursive: true });
    const target = path.join(artDir, `album-${id}.jpg`);
    await pipeline(part.file, createWriteStream(target));
    await db.update(albums).set({ artPath: target, updatedSeq: bumpSeq }).where(eq(albums.id, id));
    colorCache.delete(id);
    return reply.code(204).send();
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

  const previewImportSchema = z.object({ url: z.string().url() });
  const importSchema = previewImportSchema.extend({
    selectedIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{32,64}$/))
      .min(1)
      .max(250)
      .optional(),
  });

  function selectionId(item: TrackerImportItem): string {
    return createHash('sha256').update(item.url).digest('base64url');
  }

  function previewTitle(item: TrackerImportItem): string {
    if (item.metadata?.title) return item.metadata.title;
    try {
      const filename = path.basename(new URL(item.url).pathname);
      return filename ? decodeURIComponent(filename) : 'Untitled track';
    } catch {
      return 'Untitled track';
    }
  }

  function addJob(url: string): ImportJob {
    const job: ImportJob = {
      id: randomUUID(),
      url,
      status: 'running',
      error: null,
      startedAt: new Date().toISOString(),
    };
    jobs.unshift(job);
    if (jobs.length > 50) jobs.pop();
    return job;
  }

  function startImport(
    job: ImportJob,
    scanOnDone = true,
    metadata?: TrackerImportMetadata,
  ): Promise<boolean> {
    const pillowcaseId = pillowcaseFileId(job.url);
    if (pillowcaseId) {
      return downloadPillowcaseFile(pillowcaseId, uploadsDir, pillowcasePageUrl(job.url)!)
        .then(async (filename) => {
          if (metadata) {
            const filePath = path.join(uploadsDir, filename);
            try {
              await embedAudioMetadata(filePath, metadata, metadataCoverCacheDir);
            } catch (error) {
              await unlink(filePath).catch(() => {});
              throw error;
            }
          }
          job.status = 'done';
          if (scanOnDone) scanner.start();
          return true;
        })
        .catch((err: unknown) => {
          job.status = 'error';
          job.error = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
          return false;
        });
    }

    return new Promise<boolean>((resolve) => {
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
          job.url,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let stderr = '';
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        resolve(success);
      };
      proc.stderr.on('data', (d) => {
        stderr += String(d);
      });
      proc.on('error', (err) => {
        job.status = 'error';
        job.error =
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'yt-dlp is not installed on the server'
            : String(err.message);
        finish(false);
      });
      proc.on('exit', (code) => {
        if (settled) return;
        if (code === 0) {
          job.status = 'done';
          if (scanOnDone) scanner.start();
          finish(true);
        } else {
          job.status = 'error';
          job.error = stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
          finish(false);
        }
      });
    });
  }

  async function startImportBatch(
    items: TrackerImportItem[],
  ): Promise<{ succeeded: number; failed: number }> {
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (!item) return;
        if (await startImport(addJob(item.url), false, item.metadata)) succeeded++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
    if (succeeded > 0) scanner.start();
    return { succeeded, failed };
  }

  app.post('/api/import-url/preview', { preHandler: app.requireOwner }, async (req, reply) => {
    const body = previewImportSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    if (!trackerhubCsvUrl(body.data.url)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Song selection is available for ArtistGrid and TrackerHub links',
      });
    }

    try {
      const eras = await artistGridEraOptions(body.data.url);
      if (eras) return { kind: 'eras', eras };

      const items = await trackerhubImportItems(body.data.url);
      return {
        kind: 'tracks',
        items: items.map((item) => ({
          id: selectionId(item),
          title: previewTitle(item),
          artist: item.metadata?.artist ?? null,
          album: item.metadata?.album ?? null,
          year: item.metadata?.year ?? null,
          quality: item.metadata?.quality ?? null,
          sourceHost: new URL(item.url).hostname,
        })),
      };
    } catch (err) {
      return reply.code(422).send({
        error: 'preview_failed',
        message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      });
    }
  });

  app.post('/api/import-url', { preHandler: app.requireOwner }, async (req, reply) => {
    const body = importSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    await ensureUploadsRoot();

    const trackerImport = Boolean(trackerhubCsvUrl(body.data.url));
    if (body.data.selectedIds && !trackerImport) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Song selection is only available for ArtistGrid and TrackerHub links',
      });
    }

    const job = addJob(body.data.url);
    if (trackerImport) {
      void trackerhubImportItems(body.data.url)
        .then(async (items) => {
          let selectedItems = items;
          if (body.data.selectedIds) {
            const wanted = new Set(body.data.selectedIds);
            selectedItems = items.filter((item) => wanted.has(selectionId(item)));
            const matched = new Set(selectedItems.map(selectionId));
            const missing = [...wanted].filter((id) => !matched.has(id));
            if (missing.length > 0) {
              throw new Error(
                'The ArtistGrid list changed after the preview. Reopen the song picker and try again.',
              );
            }
          }
          const result = await startImportBatch(selectedItems);
          if (result.failed > 0) {
            job.status = 'error';
            job.error = `${result.failed} of ${selectedItems.length} tracks failed to import; ${result.succeeded} succeeded`;
          } else {
            job.status = 'done';
          }
        })
        .catch((err: unknown) => {
          job.status = 'error';
          job.error = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
        });
      return reply.code(202).send({ job });
    }

    void startImport(job);

    return reply.code(202).send({ job });
  });

  app.get('/api/import-jobs', { preHandler: app.requireOwner }, async () => ({
    jobs: jobs.slice(0, 20),
  }));
};
