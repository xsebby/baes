import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albumTracklistItems, albumTracklists, albums, tracks } from '@baes/db';
import type { Database } from '../db.js';

interface RouteOpts {
  db: Database;
}

const bumpSeq = sql`nextval('change_seq')`;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  trackIds: z.array(z.string().uuid()).max(500).default([]),
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  trackIds: z.array(z.string().uuid()).max(500).optional(),
});

const fromTextSchema = z.object({
  name: z.string().min(1).max(120),
  text: z.string().min(1).max(20000),
});

/** Loose comparison key: drop punctuation, feat clauses and bracketed suffixes. */
function matchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(feat[^)]*\)|\[feat[^\]]*\]|feat\.? .+$/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** "12. Song Name (prod. X)" -> "Song Name" */
function stripLeadingIndex(line: string): string {
  return line
    .replace(/^\s*\d+\s*[.)\-:]?\s*/, '')
    .replace(/^\s*[-*\u2022]\s*/, '')
    .trim();
}

/** Zero-padded so lexicographic ordering matches insertion order. */
function sortKeyAt(index: number): string {
  return String(index + 1).padStart(6, '0');
}

export const tracklistRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db }) => {
  async function replaceItems(tracklistId: string, trackIds: string[]): Promise<void> {
    await db.delete(albumTracklistItems).where(eq(albumTracklistItems.tracklistId, tracklistId));
    if (trackIds.length === 0) return;
    await db.insert(albumTracklistItems).values(
      trackIds.map((trackId, i) => ({
        tracklistId,
        trackId,
        sortKey: sortKeyAt(i),
      })),
    );
  }

  app.post('/api/albums/:id/tracklists', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const [album] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(and(eq(albums.id, id), isNull(albums.deletedAt)))
      .limit(1);
    if (!album) {
      return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
    }
    const [created] = await db
      .insert(albumTracklists)
      .values({ albumId: id, name: body.data.name, createdBy: req.authUser!.id })
      .returning();
    await replaceItems(created!.id, body.data.trackIds);
    return reply
      .code(201)
      .send({ tracklist: { id: created!.id, name: created!.name, trackIds: body.data.trackIds } });
  });

  /** Build a tracklist by pasting a numbered listing; matches lines by title. */
  app.post(
    '/api/albums/:id/tracklists/from-text',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = fromTextSchema.safeParse(req.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
      }
      const albumTracks = await db
        .select({ id: tracks.id, title: tracks.title })
        .from(tracks)
        .where(and(eq(tracks.albumId, id), isNull(tracks.deletedAt)));
      if (albumTracks.length === 0) {
        return reply.code(404).send({ error: 'not_found', message: 'Album has no tracks' });
      }

      const byKey = new Map<string, string>();
      for (const t of albumTracks) {
        const k = matchKey(t.title);
        if (k && !byKey.has(k)) byKey.set(k, t.id);
      }

      const trackIds: string[] = [];
      const unmatched: string[] = [];
      const seen = new Set<string>();
      for (const raw of body.data.text.split(/\r?\n/)) {
        const line = stripLeadingIndex(raw);
        if (!line) continue;
        const key = matchKey(line);
        if (!key) continue;
        let hit = byKey.get(key);
        if (!hit) {
          // containment fallback for lines carrying extra notes
          for (const [k, v] of byKey) {
            if (k.includes(key) || key.includes(k)) {
              hit = v;
              break;
            }
          }
        }
        if (hit && !seen.has(hit)) {
          seen.add(hit);
          trackIds.push(hit);
        } else if (!hit) {
          unmatched.push(line);
        }
      }

      const [created] = await db
        .insert(albumTracklists)
        .values({ albumId: id, name: body.data.name, createdBy: req.authUser!.id })
        .returning();
      await replaceItems(created!.id, trackIds);

      return reply.code(201).send({
        tracklist: { id: created!.id, name: created!.name, trackIds },
        matched: trackIds.length,
        unmatched,
      });
    },
  );

  app.patch('/api/tracklists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = patchSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const [existing] = await db
      .select({ id: albumTracklists.id })
      .from(albumTracklists)
      .where(and(eq(albumTracklists.id, id), isNull(albumTracklists.deletedAt)))
      .limit(1);
    if (!existing) {
      return reply.code(404).send({ error: 'not_found', message: 'Tracklist not found' });
    }
    if (body.data.name !== undefined) {
      await db
        .update(albumTracklists)
        .set({ name: body.data.name, updatedSeq: bumpSeq })
        .where(eq(albumTracklists.id, id));
    }
    if (body.data.trackIds !== undefined) {
      await replaceItems(id, body.data.trackIds);
      await db
        .update(albumTracklists)
        .set({ updatedSeq: bumpSeq })
        .where(eq(albumTracklists.id, id));
    }
    return reply.code(204).send();
  });

  app.delete('/api/tracklists/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(albumTracklists)
      .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
      .where(eq(albumTracklists.id, id));
    return reply.code(204).send();
  });
};
