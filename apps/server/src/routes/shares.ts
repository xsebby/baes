import { randomBytes } from 'node:crypto';
import path from 'node:path';
import archiver from 'archiver';
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albums, artists, libraryRoots, playlistItems, playlists, shares, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { mediaPath } from '../library/signing.js';

interface RouteOpts {
  db: Database;
  config: Config;
}

const createSchema = z.object({
  kind: z.enum(['playlist', 'track']),
  targetId: z.string().uuid(),
  allowDownload: z.boolean().default(true),
  /** null = never expires */
  expiresInDays: z.number().int().min(1).max(365).nullable().default(7),
});

const NOT_FOUND = { error: 'not_found', message: 'This link is invalid or has expired' };

/**
 * Unlisted share links. The owner creates a link for a playlist or a track;
 * anyone with the link can stream it (and download it, if allowed) with no
 * account, until it expires or is revoked.
 */
export const shareRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
  const shareUrl = (token: string) => `${config.PUBLIC_URL ?? ''}/s/${token}`;

  async function targetTitle(kind: 'playlist' | 'track', id: string, userId: string) {
    if (kind === 'playlist') {
      const [p] = await db
        .select({ title: playlists.title })
        .from(playlists)
        .where(
          and(eq(playlists.id, id), eq(playlists.ownerId, userId), isNull(playlists.deletedAt)),
        )
        .limit(1);
      return p?.title ?? null;
    }
    const [t] = await db
      .select({ title: tracks.title })
      .from(tracks)
      .where(and(eq(tracks.id, id), isNull(tracks.deletedAt)))
      .limit(1);
    return t?.title ?? null;
  }

  // ---- owner ----

  app.post('/api/shares', { preHandler: app.requireOwner }, async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const { kind, targetId, allowDownload, expiresInDays } = body.data;
    const title = await targetTitle(kind, targetId, req.authUser!.id);
    if (title === null) {
      return reply.code(404).send({ error: 'not_found', message: `No such ${kind}` });
    }
    const token = randomBytes(16).toString('base64url'); // 128 bits: unguessable
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const [share] = await db
      .insert(shares)
      .values({ token, kind, targetId, createdBy: req.authUser!.id, allowDownload, expiresAt })
      .returning();
    return reply.code(201).send({ ...share, title, url: shareUrl(token) });
  });

  app.get('/api/shares', { preHandler: app.requireOwner }, async (req) => {
    const rows = await db
      .select()
      .from(shares)
      .where(and(eq(shares.createdBy, req.authUser!.id), isNull(shares.revokedAt)))
      .orderBy(desc(shares.createdAt));
    const out = [];
    for (const s of rows) {
      out.push({
        ...s,
        title: (await targetTitle(s.kind, s.targetId, req.authUser!.id)) ?? '(deleted)',
        url: shareUrl(s.token),
        expired: s.expiresAt !== null && s.expiresAt < new Date(),
      });
    }
    return { shares: out };
  });

  app.delete('/api/shares/:id', { preHandler: app.requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(shares)
      .set({ revokedAt: new Date() })
      .where(and(eq(shares.id, id), eq(shares.createdBy, req.authUser!.id)));
    return reply.code(204).send();
  });

  // ---- public ----

  /** A live share (not revoked, not expired), or null. */
  async function liveShare(token: string) {
    const [share] = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
    if (!share || share.revokedAt || (share.expiresAt && share.expiresAt < new Date())) return null;
    return share;
  }

  /** Track ids a share covers, in playlist order. */
  async function sharedTrackIds(share: typeof shares.$inferSelect): Promise<string[]> {
    if (share.kind === 'track') return [share.targetId];
    const items = await db
      .select({ trackId: playlistItems.trackId })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
      .where(
        and(
          eq(playlistItems.playlistId, share.targetId),
          isNull(playlistItems.deletedAt),
          isNull(playlists.deletedAt),
        ),
      )
      .orderBy(asc(playlistItems.sortKey));
    return items.flatMap((i) => (i.trackId ? [i.trackId] : []));
  }

  /** Every shared file in one zip. Stored, not compressed: audio is already compressed. */
  app.get(
    '/api/s/:token/download',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const share = await liveShare(token);
      if (!share || !share.allowDownload) return reply.code(404).send(NOT_FOUND);
      const ids = await sharedTrackIds(share);
      const files = ids.length
        ? await db
            .select({ id: tracks.id, relPath: tracks.relPath, rootPath: libraryRoots.path })
            .from(tracks)
            .innerJoin(libraryRoots, eq(tracks.rootId, libraryRoots.id))
            .where(and(inArray(tracks.id, ids), isNull(tracks.deletedAt)))
        : [];
      if (files.length === 0) return reply.code(404).send(NOT_FOUND);
      const byId = new Map(files.map((f) => [f.id, f]));
      const title =
        share.kind === 'playlist'
          ? ((await targetTitle('playlist', share.targetId, share.createdBy)) ?? 'playlist')
          : 'song';

      const zip = archiver('zip', { store: true });
      zip.on('warning', (err) => req.log.warn({ err }, 'share zip warning'));
      zip.on('error', (err) => req.log.error({ err }, 'share zip failed'));
      const width = String(ids.length).length;
      ids.forEach((id, i) => {
        const f = byId.get(id);
        if (!f) return;
        // Numbered so the zip keeps the playlist's order.
        const name = `${String(i + 1).padStart(width, '0')} ${path.basename(f.relPath)}`;
        zip.file(path.join(f.rootPath, f.relPath), { name });
      });
      void zip.finalize();
      const safe = title.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'bæs';
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(safe)}.zip`,
        )
        .send(zip);
    },
  );

  app.get(
    '/api/s/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      // Expired, revoked and never-existed links all look the same.
      const share = await liveShare(token);
      if (!share) return reply.code(404).send(NOT_FOUND);

      // Media URLs never outlive the share itself.
      const ttl = Math.max(
        60,
        Math.min(
          config.MEDIA_URL_TTL_SECONDS,
          share.expiresAt
            ? Math.floor((share.expiresAt.getTime() - Date.now()) / 1000)
            : Number.POSITIVE_INFINITY,
        ),
      );
      function signed(kind: 'stream' | 'art', id: string) {
        return mediaPath(kind, id, config.SERVER_SECRET, ttl).url;
      }

      let title: string | null;
      let artUrl: string | null = null;
      if (share.kind === 'playlist') {
        const [p] = await db
          .select({ title: playlists.title, artPath: playlists.artPath })
          .from(playlists)
          .where(and(eq(playlists.id, share.targetId), isNull(playlists.deletedAt)))
          .limit(1);
        if (!p) return reply.code(404).send(NOT_FOUND);
        title = p.title;
        if (p.artPath) artUrl = signed('art', share.targetId);
      } else {
        title = null;
      }
      // Only local tracks: Spotify-only playlist entries have nothing to stream.
      const trackIds = await sharedTrackIds(share);

      const rows = trackIds.length
        ? await db
            .select({
              id: tracks.id,
              title: tracks.title,
              tag: tracks.tag,
              durationMs: tracks.durationMs,
              artistName: artists.name,
              albumId: tracks.albumId,
              albumTitle: albums.title,
              albumHasArt: sql<boolean>`${albums.artPath} is not null`,
            })
            .from(tracks)
            .leftJoin(artists, eq(tracks.artistId, artists.id))
            .leftJoin(albums, eq(tracks.albumId, albums.id))
            .where(and(inArray(tracks.id, trackIds), isNull(tracks.deletedAt)))
        : [];
      if (share.kind === 'track' && rows.length === 0) return reply.code(404).send(NOT_FOUND);
      const byId = new Map(rows.map((r) => [r.id, r]));

      const items = trackIds.flatMap((id) => {
        const r = byId.get(id);
        if (!r) return [];
        const streamUrl = signed('stream', r.id);
        return [
          {
            id: r.id,
            title: r.title,
            tag: r.tag,
            durationMs: r.durationMs,
            artistName: r.artistName,
            albumTitle: r.albumTitle,
            streamUrl,
            artUrl: r.albumId && r.albumHasArt ? signed('art', r.albumId) : null,
            downloadUrl: share.allowDownload ? `${streamUrl}&download=1` : null,
          },
        ];
      });

      await db
        .update(shares)
        .set({ views: sql`${shares.views} + 1` })
        .where(eq(shares.id, share.id));

      return {
        kind: share.kind,
        title: title ?? items[0]?.title ?? '',
        artUrl: artUrl ?? items[0]?.artUrl ?? null,
        allowDownload: share.allowDownload,
        downloadAllUrl: share.allowDownload ? `/api/s/${share.token}/download` : null,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        items,
      };
    },
  );
};
