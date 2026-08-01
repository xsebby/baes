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

/**
 * Albums whose titles differ only by a trailing bracketed suffix are treated as
 * versions of one release — the naming convention unreleased collections
 * already use ("Whole Lotta Red [V1]", "... [V2]").
 */
function splitAlbumVersion(title: string): { base: string; label: string | null } {
  const m = /^(.+?)\s*[[(]([^\])]{1,24})[\])]\s*$/.exec(title);
  if (m?.[1] && m[2]) return { base: m[1].trim(), label: m[2].trim() };
  return { base: title.trim(), label: null };
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
    // NOTE: counts use join+groupBy, not correlated subqueries — drizzle renders
    // sql-template column refs unqualified, which silently mis-resolves inside
    // a subquery ("id" binds to the inner table).
    const rows = await db
      .select({
        id: albums.id,
        title: albums.title,
        year: albums.year,
        artistId: albums.artistId,
        artistName: artists.name,
        hasArt: sql<boolean>`${albums.artPath} is not null`,
        trackCount: sql<number>`count(${tracks.id})::int`,
      })
      .from(albums)
      .leftJoin(artists, eq(albums.artistId, artists.id))
      .leftJoin(tracks, and(eq(tracks.albumId, albums.id), isNull(tracks.deletedAt)))
      .where(isNull(albums.deletedAt))
      .groupBy(albums.id, albums.title, albums.year, albums.artistId, albums.artPath, artists.name)
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
    // Sibling versions: same artist, same base title.
    const { base } = splitAlbumVersion(album.title);
    const siblings = await db
      .select({
        id: albums.id,
        title: albums.title,
        hasArt: sql<boolean>`${albums.artPath} is not null`,
        trackCount: sql<number>`count(${tracks.id})::int`,
      })
      .from(albums)
      .leftJoin(tracks, and(eq(tracks.albumId, albums.id), isNull(tracks.deletedAt)))
      .where(
        and(
          isNull(albums.deletedAt),
          album.artistId ? eq(albums.artistId, album.artistId) : isNull(albums.artistId),
        ),
      )
      .groupBy(albums.id, albums.title, albums.artPath);

    const versions = siblings
      .map((s) => ({ ...s, split: splitAlbumVersion(s.title) }))
      .filter((s) => s.split.base.toLowerCase() === base.toLowerCase() && s.trackCount > 0)
      .map((s) => ({
        id: s.id,
        label: s.split.label ?? 'Original',
        trackCount: s.trackCount,
        artUrl: s.hasArt
          ? mediaPath('art', s.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS).url
          : null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

    return {
      ...album,
      baseTitle: base,
      versionLabel: splitAlbumVersion(album.title).label,
      versions: versions.length > 1 ? versions : [],
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
        trackCount: sql<number>`count(${tracks.id})::int`,
      })
      .from(artists)
      .leftJoin(tracks, and(eq(tracks.artistId, artists.id), isNull(tracks.deletedAt)))
      .where(isNull(artists.deletedAt))
      .groupBy(artists.id, artists.name, artists.sortName)
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
