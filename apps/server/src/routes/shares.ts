import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { albums, artists, libraryRoots, playlistItems, playlists, shares, tracks } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { coverColor } from '../library/art-colors.js';
import { serveArt, serveTrack } from './stream.js';

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

/** Used when the web build isn't there (tests, API-only deploys). */
const BARE_HTML =
  '<!doctype html><html><head><!-- meta --><title>bæs</title><!-- /meta --></head><body></body></html>';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function minutes(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
}

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

  /**
   * Media for a share goes through the share itself, not a signed URL: every
   * request re-checks that the share is live, so revoking or expiring it ends
   * playback at once, and the URLs never go stale while it is live.
   */
  app.get('/api/s/:token/stream/:trackId', async (req, reply) => {
    const { token, trackId } = req.params as { token: string; trackId: string };
    const { download } = req.query as { download?: string };
    const share = await liveShare(token);
    if (!share || (download === '1' && !share.allowDownload)) {
      return reply.code(404).send(NOT_FOUND);
    }
    if (!(await sharedTrackIds(share)).includes(trackId)) return reply.code(404).send(NOT_FOUND);
    return serveTrack(db, req, reply, trackId, { download: download === '1' });
  });

  /** The playlist's cover, or the album cover of a shared track. */
  app.get('/api/s/:token/art/:id', async (req, reply) => {
    const { token, id } = req.params as { token: string; id: string };
    const share = await liveShare(token);
    if (!share) return reply.code(404).send(NOT_FOUND);
    let allowed = share.kind === 'playlist' && share.targetId === id;
    if (!allowed) {
      const ids = await sharedTrackIds(share);
      if (ids.length) {
        const [hit] = await db
          .select({ id: tracks.id })
          .from(tracks)
          .where(and(inArray(tracks.id, ids), eq(tracks.albumId, id), isNull(tracks.deletedAt)))
          .limit(1);
        allowed = !!hit;
      }
    }
    if (!allowed) return reply.code(404).send(NOT_FOUND);
    return serveArt(db, reply, id);
  });

  // ---- link previews (Discord, iMessage, Slack…) ----

  let indexHtml: string | null = null;
  const colorByArt = new Map<string, string | null>();

  async function artColor(artId: string) {
    if (colorByArt.has(artId)) return colorByArt.get(artId)!;
    const [a] = await db
      .select({ artPath: albums.artPath })
      .from(albums)
      .where(eq(albums.id, artId))
      .limit(1);
    const [p] = a?.artPath
      ? []
      : await db
          .select({ artPath: playlists.artPath })
          .from(playlists)
          .where(eq(playlists.id, artId))
          .limit(1);
    const artPath = a?.artPath ?? p?.artPath;
    const color = artPath ? await coverColor(artPath).catch(() => null) : null;
    if (colorByArt.size > 500) colorByArt.delete(colorByArt.keys().next().value!);
    colorByArt.set(artId, color);
    return color;
  }

  /**
   * The web app's index.html with Open Graph tags for the shared song or
   * playlist, so pasted links unfurl like Spotify's: title, "Song · Artist",
   * cover thumbnail, and an embed color taken from the cover. Crawlers don't
   * run JS, so this has to happen on the server. Doesn't count as a view.
   */
  app.get(
    '/s/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      if (indexHtml === null) {
        indexHtml = await readFile(
          path.join(path.resolve(config.WEB_DIST), 'index.html'),
          'utf8',
        ).catch(() => BARE_HTML);
      }
      const origin = config.PUBLIC_URL ?? `${req.protocol}://${req.host}`;
      const meta: Record<string, string> = {
        'og:site_name': 'bæs',
        'og:url': `${origin}/s/${token}`,
      };
      let title = 'bæs';
      let artId: string | null = null;

      const share = await liveShare(token);
      const ids = share ? await sharedTrackIds(share) : [];
      const rows = ids.length
        ? await db
            .select({
              id: tracks.id,
              title: tracks.title,
              durationMs: tracks.durationMs,
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
      const byId = new Map(rows.map((r) => [r.id, r]));
      const items = ids.flatMap((id) => byId.get(id) ?? []);
      const firstArt = items.find((i) => i.albumHasArt && i.albumId)?.albumId ?? null;

      if (share?.kind === 'track' && items[0]) {
        const t = items[0];
        title = t.title;
        meta['og:type'] = 'music.song';
        meta['og:description'] = ['Song', t.artistName ?? 'Unknown artist', t.albumTitle]
          .filter(Boolean)
          .join(' · ');
        meta['music:duration'] = String(Math.round(t.durationMs / 1000));
        artId = firstArt;
      } else if (share?.kind === 'playlist') {
        const [p] = await db
          .select({ title: playlists.title, artPath: playlists.artPath })
          .from(playlists)
          .where(and(eq(playlists.id, share.targetId), isNull(playlists.deletedAt)))
          .limit(1);
        if (p) {
          title = p.title;
          const artistNames = [...new Set(items.map((i) => i.artistName).filter(Boolean))];
          const total = items.reduce((sum, i) => sum + i.durationMs, 0);
          meta['og:type'] = 'music.playlist';
          meta['og:description'] = [
            'Playlist',
            `${items.length} ${items.length === 1 ? 'song' : 'songs'}`,
            total > 0 ? minutes(total) : null,
            artistNames.length
              ? artistNames.slice(0, 3).join(', ') + (artistNames.length > 3 ? ' and more' : '')
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          artId = p.artPath ? share.targetId : firstArt;
        }
      }
      if (!meta['og:description']) meta['og:description'] = 'This link is invalid or has expired.';
      meta['og:title'] = title;
      if (share && artId) {
        meta['og:image'] = `${origin}/api/s/${token}/art/${artId}`;
        const color = await artColor(artId);
        if (color) meta['theme-color'] = color;
      }
      meta['theme-color'] ??= '#0b0b0f';
      // Thumbnail beside the text, like Spotify's links.
      meta['twitter:card'] = 'summary';

      const tags = Object.entries(meta)
        .map(([k, v]) =>
          k.startsWith('og:') || k.startsWith('music:')
            ? `<meta property="${k}" content="${escapeHtml(v)}" />`
            : `<meta name="${k}" content="${escapeHtml(v)}" />`,
        )
        .join('\n    ');
      const head = `<title>${escapeHtml(title === 'bæs' ? title : `${title} · bæs`)}</title>
    <meta name="description" content="${escapeHtml(meta['og:description'])}" />
    ${tags}`;
      const marker = /<!-- meta[\s\S]*?<!-- \/meta -->/;
      // An index.html without the marker (older build) still gets the tags.
      const html = marker.test(indexHtml)
        ? indexHtml.replace(marker, head)
        : indexHtml
            .replace(/<title>[\s\S]*?<\/title>/, '')
            .replace('</head>', `${head}\n  </head>`);
      return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html);
    },
  );

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

      const base = `/api/s/${share.token}`;

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
        if (p.artPath) artUrl = `${base}/art/${share.targetId}`;
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
        const streamUrl = `${base}/stream/${r.id}`;
        return [
          {
            id: r.id,
            title: r.title,
            tag: r.tag,
            durationMs: r.durationMs,
            artistName: r.artistName,
            albumTitle: r.albumTitle,
            streamUrl,
            artUrl: r.albumId && r.albumHasArt ? `${base}/art/${r.albumId}` : null,
            downloadUrl: share.allowDownload ? `${streamUrl}?download=1` : null,
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
        downloadAllUrl: share.allowDownload ? `${base}/download` : null,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        items,
      };
    },
  );
};
