import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albums, artists, playlistItems, playlists, shares, tracks } from '@baes/db';
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

  app.get(
    '/api/s/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const [share] = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
      // Expired, revoked and never-existed links all look the same.
      if (!share || share.revokedAt || (share.expiresAt && share.expiresAt < new Date())) {
        return reply.code(404).send(NOT_FOUND);
      }

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
      let trackIds: string[];
      if (share.kind === 'playlist') {
        const [p] = await db
          .select({ title: playlists.title, artPath: playlists.artPath })
          .from(playlists)
          .where(and(eq(playlists.id, share.targetId), isNull(playlists.deletedAt)))
          .limit(1);
        if (!p) return reply.code(404).send(NOT_FOUND);
        title = p.title;
        if (p.artPath) artUrl = signed('art', share.targetId);
        // Only local tracks: Spotify-only entries have nothing to stream.
        const items = await db
          .select({ trackId: playlistItems.trackId })
          .from(playlistItems)
          .where(and(eq(playlistItems.playlistId, share.targetId), isNull(playlistItems.deletedAt)))
          .orderBy(asc(playlistItems.sortKey));
        trackIds = items.flatMap((i) => (i.trackId ? [i.trackId] : []));
      } else {
        title = null;
        trackIds = [share.targetId];
      }

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
        expiresAt: share.expiresAt?.toISOString() ?? null,
        items,
      };
    },
  );
};
