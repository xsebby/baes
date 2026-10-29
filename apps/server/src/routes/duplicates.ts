import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albums, artists, duplicatePairs, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import type { DuplicateFinder } from '../library/duplicates.js';
import { artPath, mediaPath } from '../library/signing.js';

interface RouteOpts {
  db: Database;
  config: Config;
  duplicates: DuplicateFinder;
}

const dismissSchema = z.object({ trackIds: z.array(z.string().uuid()).min(2).max(100) });

/** Owner review of tracks the fingerprinter thinks are the same recording. */
export const duplicateRoutes: FastifyPluginAsync<RouteOpts> = async (
  app,
  { db, config, duplicates },
) => {
  app.get('/api/admin/duplicates', { preHandler: app.requireOwner }, async () => {
    const pairs = await db
      .select({ a: duplicatePairs.trackA, b: duplicatePairs.trackB, votes: duplicatePairs.votes })
      .from(duplicatePairs)
      .where(isNull(duplicatePairs.dismissedAt));

    // Union-find over pairs: A≈B and B≈C is one group of three.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    for (const { a, b } of pairs) {
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      parent.set(find(a), find(b));
    }
    const ids = [...parent.keys()];
    const rows = ids.length
      ? await db
          .select({
            id: tracks.id,
            title: tracks.title,
            tag: tracks.tag,
            durationMs: tracks.durationMs,
            trackNo: tracks.trackNo,
            codec: tracks.codec,
            bitrate: tracks.bitrate,
            relPath: tracks.relPath,
            needsReview: tracks.needsReview,
            artistId: tracks.artistId,
            artistName: artists.name,
            albumId: tracks.albumId,
            albumTitle: albums.title,
            albumHasArt: sql<boolean>`${albums.artPath} is not null`,
          })
          .from(tracks)
          .leftJoin(artists, eq(tracks.artistId, artists.id))
          .leftJoin(albums, eq(tracks.albumId, albums.id))
          .where(and(inArray(tracks.id, ids), isNull(tracks.deletedAt)))
      : [];

    const groups = new Map<string, { strongest: number; tracks: unknown[] }>();
    for (const { a, votes } of pairs) {
      const g = groups.get(find(a)) ?? { strongest: 0, tracks: [] };
      g.strongest = Math.max(g.strongest, votes);
      groups.set(find(a), g);
    }
    for (const r of rows) {
      const { albumHasArt, relPath, ...track } = r;
      groups.get(find(r.id))?.tracks.push({
        ...track,
        fileName: relPath.split('/').pop() ?? relPath,
        streamUrl: mediaPath('stream', r.id, config.SERVER_SECRET, config.MEDIA_URL_TTL_SECONDS)
          .url,
        artUrl: r.albumId && albumHasArt ? artPath(r.albumId, config.SERVER_SECRET).url : null,
      });
    }
    return {
      status: await duplicates.getStatus(),
      // A group whose other copies were deleted is down to one track: drop it.
      groups: [...groups.values()]
        .filter((g) => g.tracks.length > 1)
        .sort((x, y) => y.strongest - x.strongest),
    };
  });

  /** "These aren't duplicates": hides every pair among the given tracks. */
  app.post(
    '/api/admin/duplicates/dismiss',
    { preHandler: app.requireOwner },
    async (req, reply) => {
      const body = dismissSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
      }
      await db
        .update(duplicatePairs)
        .set({ dismissedAt: new Date() })
        .where(
          and(
            inArray(duplicatePairs.trackA, body.data.trackIds),
            inArray(duplicatePairs.trackB, body.data.trackIds),
          ),
        );
      return reply.code(204).send();
    },
  );

  app.post('/api/admin/duplicates/scan', { preHandler: app.requireOwner }, async (_req, reply) => {
    if (!duplicates.start()) {
      return reply
        .code(409)
        .send({ error: 'disabled', message: 'Duplicate detection is off (set FP_BIN)' });
    }
    return reply.code(202).send(await duplicates.getStatus());
  });
};
