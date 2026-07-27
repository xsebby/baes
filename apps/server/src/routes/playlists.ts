import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albums, artists, externalTracks, likes, playlistItems, playlists, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { mediaPath } from '../library/signing.js';

interface RouteOpts {
  db: Database;
  config: Config;
}

const createPlaylistSchema = z.object({ title: z.string().min(1).max(120) });
const addItemSchema = z.object({ trackId: z.string().uuid() });

const bumpSeq = sql`nextval('change_seq')`;

/** Append-only sort keys: zero-padded so lexicographic == numeric order. */
function nextSortKey(last: string | null): string {
  const n = last ? parseInt(last, 10) + 1 : 1;
  return String(n).padStart(10, '0');
}

export const playlistRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
  const trackSelection = {
    id: tracks.id,
    title: tracks.title,
    durationMs: tracks.durationMs,
    trackNo: tracks.trackNo,
    codec: tracks.codec,
    needsReview: tracks.needsReview,
    artistId: tracks.artistId,
    artistName: artists.name,
    albumId: tracks.albumId,
    albumTitle: albums.title,
    albumHasArt: sql<boolean>`${albums.artPath} is not null`,
  };

  function withMediaUrls<T extends { id: string; albumId: string | null; albumHasArt: boolean }>(
    row: T,
  ) {
    return {
      ...row,
      streamUrl: mediaPath('stream', row.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS)
        .url,
      artUrl:
        row.albumId && row.albumHasArt
          ? mediaPath('art', row.albumId, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS).url
          : null,
    };
  }

  // ---- Playlists ----

  app.get('/api/playlists', { preHandler: app.requireAuth }, async (req) => {
    const rows = await db
      .select({
        id: playlists.id,
        title: playlists.title,
        source: playlists.source,
        createdAt: playlists.createdAt,
        hasArt: sql<boolean>`${playlists.artPath} is not null`,
        trackCount: sql<number>`count(${playlistItems.id})::int`,
      })
      .from(playlists)
      .leftJoin(
        playlistItems,
        and(eq(playlistItems.playlistId, playlists.id), isNull(playlistItems.deletedAt)),
      )
      .where(and(eq(playlists.ownerId, req.authUser!.id), isNull(playlists.deletedAt)))
      .groupBy(
        playlists.id,
        playlists.title,
        playlists.source,
        playlists.createdAt,
        playlists.artPath,
      )
      .orderBy(asc(playlists.createdAt));
    return {
      playlists: rows.map(({ hasArt, ...r }) => ({
        ...r,
        artUrl: hasArt
          ? mediaPath('art', r.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS).url
          : null,
      })),
    };
  });

  app.post('/api/playlists', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = createPlaylistSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const [playlist] = await db
      .insert(playlists)
      .values({ ownerId: req.authUser!.id, title: body.data.title })
      .returning();
    return reply.code(201).send({ playlist });
  });

  app.get('/api/playlists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [playlist] = await db
      .select()
      .from(playlists)
      .where(
        and(
          eq(playlists.id, id),
          eq(playlists.ownerId, req.authUser!.id),
          isNull(playlists.deletedAt),
        ),
      )
      .limit(1);
    if (!playlist) {
      return reply.code(404).send({ error: 'not_found', message: 'Playlist not found' });
    }
    const rawItems = await db
      .select({
        itemId: playlistItems.id,
        sortKey: playlistItems.sortKey,
        trackId: playlistItems.trackId,
        externalTrackId: playlistItems.externalTrackId,
      })
      .from(playlistItems)
      .where(and(eq(playlistItems.playlistId, id), isNull(playlistItems.deletedAt)))
      .orderBy(asc(playlistItems.sortKey));

    // Resolve local tracks (direct items + matched externals) and external metadata.
    const externalIds = rawItems.map((i) => i.externalTrackId).filter((v): v is string => !!v);
    const externals = externalIds.length
      ? await db.select().from(externalTracks).where(inArray(externalTracks.id, externalIds))
      : [];
    const externalById = new Map(externals.map((e) => [e.id, e]));

    const localIds = new Set<string>();
    for (const i of rawItems) if (i.trackId) localIds.add(i.trackId);
    for (const e of externals) {
      if (e.matchedTrackId && e.matchStatus !== 'rejected') localIds.add(e.matchedTrackId);
    }
    const locals = localIds.size
      ? await db
          .select(trackSelection)
          .from(tracks)
          .leftJoin(artists, eq(tracks.artistId, artists.id))
          .leftJoin(albums, eq(tracks.albumId, albums.id))
          .where(and(inArray(tracks.id, [...localIds]), isNull(tracks.deletedAt)))
      : [];
    const localById = new Map(locals.map((t) => [t.id, t]));

    interface ItemOut {
      itemId: string;
      track: ReturnType<typeof withMediaUrls> | null;
      external: {
        spotifyId: string;
        title: string;
        artist: string;
        album: string | null;
        durationMs: number | null;
        artUrl: string | null;
        matched: boolean;
      } | null;
    }
    const items = rawItems.flatMap((i): ItemOut[] => {
      if (i.trackId) {
        const t = localById.get(i.trackId);
        return t ? [{ itemId: i.itemId, track: withMediaUrls(t), external: null }] : [];
      }
      const e = i.externalTrackId ? externalById.get(i.externalTrackId) : undefined;
      if (!e) return [];
      const matched =
        e.matchedTrackId && e.matchStatus !== 'rejected' ? localById.get(e.matchedTrackId) : null;
      return [
        {
          itemId: i.itemId,
          track: matched ? withMediaUrls(matched) : null,
          external: {
            spotifyId: e.providerId,
            title: e.title,
            artist: e.artist,
            album: e.album,
            durationMs: e.durationMs,
            artUrl: e.artUrl,
            matched: Boolean(matched),
          },
        },
      ];
    });

    return {
      id: playlist.id,
      title: playlist.title,
      source: playlist.source,
      artUrl: playlist.artPath
        ? mediaPath('art', playlist.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS).url
        : null,
      items,
    };
  });

  app.delete('/api/playlists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(playlists)
      .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
      .where(and(eq(playlists.id, id), eq(playlists.ownerId, req.authUser!.id)));
    return reply.code(204).send();
  });

  app.post('/api/playlists/:id/items', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = addItemSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const [playlist] = await db
      .select({ id: playlists.id })
      .from(playlists)
      .where(
        and(
          eq(playlists.id, id),
          eq(playlists.ownerId, req.authUser!.id),
          isNull(playlists.deletedAt),
        ),
      )
      .limit(1);
    if (!playlist) {
      return reply.code(404).send({ error: 'not_found', message: 'Playlist not found' });
    }
    const [last] = await db
      .select({ sortKey: playlistItems.sortKey })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, id))
      .orderBy(sql`${playlistItems.sortKey} desc`)
      .limit(1);
    const [item] = await db
      .insert(playlistItems)
      .values({
        playlistId: id,
        trackId: body.data.trackId,
        sortKey: nextSortKey(last?.sortKey ?? null),
        addedBy: req.authUser!.id,
      })
      .returning();
    return reply.code(201).send({ item });
  });

  app.delete(
    '/api/playlists/:id/items/:itemId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const [playlist] = await db
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.id, id), eq(playlists.ownerId, req.authUser!.id)))
        .limit(1);
      if (!playlist) {
        return reply.code(404).send({ error: 'not_found', message: 'Playlist not found' });
      }
      await db
        .update(playlistItems)
        .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
        .where(and(eq(playlistItems.id, itemId), eq(playlistItems.playlistId, id)));
      return reply.code(204).send();
    },
  );

  // ---- Likes ----

  app.get('/api/likes', { preHandler: app.requireAuth }, async (req) => {
    const rows = await db
      .select({ track: trackSelection, likedAt: likes.createdAt })
      .from(likes)
      .innerJoin(tracks, eq(likes.trackId, tracks.id))
      .leftJoin(artists, eq(tracks.artistId, artists.id))
      .leftJoin(albums, eq(tracks.albumId, albums.id))
      .where(
        and(eq(likes.userId, req.authUser!.id), isNull(likes.deletedAt), isNull(tracks.deletedAt)),
      )
      .orderBy(sql`${likes.createdAt} desc`);
    return { tracks: rows.map((r) => withMediaUrls(r.track)) };
  });

  app.get('/api/likes/ids', { preHandler: app.requireAuth }, async (req) => {
    const rows = await db
      .select({ trackId: likes.trackId })
      .from(likes)
      .where(and(eq(likes.userId, req.authUser!.id), isNull(likes.deletedAt)));
    return { trackIds: rows.map((r) => r.trackId).filter(Boolean) };
  });

  app.put('/api/tracks/:id/like', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select({ id: likes.id, deletedAt: likes.deletedAt })
      .from(likes)
      .where(and(eq(likes.userId, req.authUser!.id), eq(likes.trackId, id)))
      .limit(1);
    if (existing) {
      await db
        .update(likes)
        .set({ deletedAt: null, updatedSeq: bumpSeq })
        .where(eq(likes.id, existing.id));
    } else {
      await db.insert(likes).values({ userId: req.authUser!.id, trackId: id });
    }
    return reply.code(204).send();
  });

  app.delete('/api/tracks/:id/like', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(likes)
      .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
      .where(and(eq(likes.userId, req.authUser!.id), eq(likes.trackId, id)));
    return reply.code(204).send();
  });
};
