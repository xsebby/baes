import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { albums, artists, libraryRoots, playEvents, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { mediaPath } from '../library/signing.js';
import { z } from 'zod';

interface RouteOpts {
  db: Database;
  config: Config;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(500).default(200),
  offset: z.coerce.number().min(0).default(0),
  q: z.string().optional(),
});

export const libraryRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
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

  app.get('/api/tracks', { preHandler: app.requireAuth }, async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_request', message: query.error.message });
    }
    const { limit, offset, q } = query.data;
    const filters = [isNull(tracks.deletedAt)];
    if (q) {
      filters.push(
        or(
          ilike(tracks.title, `%${q}%`),
          ilike(artists.name, `%${q}%`),
          ilike(albums.title, `%${q}%`),
        )!,
      );
    }
    const rows = await db
      .select(trackSelection)
      .from(tracks)
      .leftJoin(artists, eq(tracks.artistId, artists.id))
      .leftJoin(albums, eq(tracks.albumId, albums.id))
      .where(and(...filters))
      .orderBy(asc(artists.name), asc(albums.title), asc(tracks.trackNo), asc(tracks.title))
      .limit(limit)
      .offset(offset);
    return { tracks: rows.map(withMediaUrls), limit, offset };
  });

  app.get('/api/albums', { preHandler: app.requireAuth }, async () => {
    const rows = await db
      .select({
        id: albums.id,
        title: albums.title,
        year: albums.year,
        artistId: albums.artistId,
        artistName: artists.name,
        hasArt: sql<boolean>`${albums.artPath} is not null`,
        trackCount: sql<number>`(select count(*)::int from ${tracks} where ${tracks.albumId} = ${albums.id} and ${tracks.deletedAt} is null)`,
      })
      .from(albums)
      .leftJoin(artists, eq(albums.artistId, artists.id))
      .where(isNull(albums.deletedAt))
      .orderBy(asc(artists.name), asc(albums.title));
    return {
      albums: rows
        .filter((r) => r.trackCount > 0)
        .map((r) => ({
          ...r,
          artUrl: r.hasArt
            ? mediaPath('art', r.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS).url
            : null,
        })),
    };
  });

  app.get('/api/albums/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [album] = await db
      .select({
        id: albums.id,
        title: albums.title,
        year: albums.year,
        artistId: albums.artistId,
        artistName: artists.name,
        hasArt: sql<boolean>`${albums.artPath} is not null`,
      })
      .from(albums)
      .leftJoin(artists, eq(albums.artistId, artists.id))
      .where(eq(albums.id, id))
      .limit(1);
    if (!album) {
      return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
    }
    const albumTracks = await db
      .select(trackSelection)
      .from(tracks)
      .leftJoin(artists, eq(tracks.artistId, artists.id))
      .leftJoin(albums, eq(tracks.albumId, albums.id))
      .where(and(eq(tracks.albumId, id), isNull(tracks.deletedAt)))
      .orderBy(asc(tracks.discNo), asc(tracks.trackNo), asc(tracks.title));
    return {
      ...album,
      artUrl: album.hasArt
        ? mediaPath('art', album.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS).url
        : null,
      tracks: albumTracks.map(withMediaUrls),
    };
  });

  app.get('/api/artists', { preHandler: app.requireAuth }, async () => {
    const rows = await db
      .select({
        id: artists.id,
        name: artists.name,
        trackCount: sql<number>`(select count(*)::int from ${tracks} where ${tracks.artistId} = ${artists.id} and ${tracks.deletedAt} is null)`,
      })
      .from(artists)
      .where(isNull(artists.deletedAt))
      .orderBy(asc(artists.sortName));
    return { artists: rows.filter((r) => r.trackCount > 0) };
  });

  app.get('/api/artists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [artist] = await db
      .select({ id: artists.id, name: artists.name })
      .from(artists)
      .where(eq(artists.id, id))
      .limit(1);
    if (!artist) {
      return reply.code(404).send({ error: 'not_found', message: 'Artist not found' });
    }
    const artistTracks = await db
      .select(trackSelection)
      .from(tracks)
      .leftJoin(artists, eq(tracks.artistId, artists.id))
      .leftJoin(albums, eq(tracks.albumId, albums.id))
      .where(and(eq(tracks.artistId, id), isNull(tracks.deletedAt)))
      .orderBy(asc(albums.title), asc(tracks.discNo), asc(tracks.trackNo), asc(tracks.title));
    return { ...artist, tracks: artistTracks.map(withMediaUrls) };
  });

  const playEventSchema = z.object({
    events: z
      .array(
        z.object({
          trackId: z.string().uuid(),
          playedMs: z.number().min(0),
          startedAt: z.string().datetime(),
          deviceId: z.string().max(64).default('unknown'),
        }),
      )
      .min(1)
      .max(500),
  });

  app.post('/api/plays', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = playEventSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    await db.insert(playEvents).values(
      body.data.events.map((e) => ({
        userId: req.authUser!.id,
        trackId: e.trackId,
        playedMs: Math.round(e.playedMs),
        startedAt: new Date(e.startedAt),
        deviceId: e.deviceId,
      })),
    );
    return reply.code(204).send();
  });

  // Fresh signed URL for a single track — used when a cached one expires mid-session.
  app.get('/api/tracks/:id/stream-url', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [track] = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, id), isNull(tracks.deletedAt)))
      .limit(1);
    if (!track) {
      return reply.code(404).send({ error: 'not_found', message: 'Track not found' });
    }
    return mediaPath('stream', id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS);
  });
};
