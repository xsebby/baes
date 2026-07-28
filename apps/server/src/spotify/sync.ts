import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  artists,
  externalAccounts,
  externalTracks,
  playlistItems,
  playlists,
  tracks,
} from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { matchTrack, type LocalCandidate } from './matcher.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

export interface SpotifySyncStatus {
  running: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  playlists: number;
  tracks: number;
  matched: number;
  /** Playlists Spotify refused to serve (their editorial/algorithmic lists 403 for dev apps). */
  skipped: string[];
}

interface SpotifyTrackObj {
  id: string;
  name: string;
  duration_ms: number;
  external_ids?: { isrc?: string };
  artists: { name: string }[];
  album?: { name?: string; images?: { url: string }[] };
}

const bumpSeq = sql`nextval('change_seq')`;

export class SpotifySync {
  private status: SpotifySyncStatus = {
    running: false,
    lastSyncAt: null,
    lastError: null,
    playlists: 0,
    tracks: 0,
    matched: 0,
    skipped: [],
  };

  constructor(
    private readonly db: Database,
    private readonly config: Config,
    private readonly artDir: string,
  ) {}

  getStatus(): SpotifySyncStatus {
    return { ...this.status };
  }

  start(userId: string): boolean {
    if (this.status.running) return false;
    this.status = { ...this.status, running: true, lastError: null, skipped: [] };
    void this.run(userId)
      .then(() => {
        this.status.lastSyncAt = new Date().toISOString();
      })
      .catch((err) => {
        this.status.lastError = String(err instanceof Error ? err.message : err);
      })
      .finally(() => {
        this.status.running = false;
      });
    return true;
  }

  private async accessToken(userId: string): Promise<{ token: string; accountId: string }> {
    const [account] = await this.db
      .select()
      .from(externalAccounts)
      .where(and(eq(externalAccounts.userId, userId), eq(externalAccounts.provider, 'spotify')))
      .limit(1);
    if (!account) throw new Error('Spotify account not linked');
    const refreshToken = decryptSecret(this.config.SERVER_SECRET, account.refreshTokenEnc);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.SPOTIFY_CLIENT_ID!,
      }),
    });
    if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; refresh_token?: string };
    if (body.refresh_token) {
      await this.db
        .update(externalAccounts)
        .set({ refreshTokenEnc: encryptSecret(this.config.SERVER_SECRET, body.refresh_token) })
        .where(eq(externalAccounts.id, account.id));
    }
    return { token: body.access_token, accountId: account.id };
  }

  private async api<T>(token: string, path: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${API}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') ?? '2') * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Spotify API ${path}: ${res.status} ${body}`);
      }
      return (await res.json()) as T;
    }
    throw new Error(`Spotify API ${path}: rate limited`);
  }

  private async run(userId: string): Promise<void> {
    const { token, accountId } = await this.accessToken(userId);
    const candidates = await this.loadCandidates();

    // Liked songs → a mirrored "Spotify Liked Songs" playlist.
    const liked = await this.fetchAll<{ track: SpotifyTrackObj }>(token, '/me/tracks?limit=50');
    await this.mirrorPlaylist(userId, {
      providerId: '__liked__',
      title: 'Spotify Liked Songs',
      snapshotId: null,
      tracks: liked.map((i) => i.track).filter(Boolean),
      candidates,
    });

    // All playlists.
    const lists = await this.fetchAll<{
      id: string;
      name: string;
      snapshot_id: string;
      images?: { url: string }[] | null;
      tracks: { total: number };
    }>(token, '/me/playlists?limit=50');
    this.status.playlists = lists.length + 1;

    for (const pl of lists) {
      const [existing] = await this.db
        .select({
          id: playlists.id,
          snap: playlists.providerSnapshotId,
          artPath: playlists.artPath,
        })
        .from(playlists)
        .where(and(eq(playlists.providerId, pl.id), eq(playlists.ownerId, userId)))
        .limit(1);
      if (existing && existing.snap === pl.snapshot_id) {
        // Unchanged content — but still backfill a missing cover.
        if (!existing.artPath && pl.images?.[0]?.url) {
          await this.savePlaylistArt(existing.id, pl.images[0].url).catch(() => {});
        }
        continue;
      }

      // Feb 2026 API migration: playlist contents live at /items (the old
      // /tracks endpoint 403s). Spotify-owned editorial playlists still 403
      // outright for dev-mode apps — skip those rather than aborting.
      try {
        const items = await this.fetchAll<{ item: SpotifyTrackObj | null }>(
          token,
          `/playlists/${pl.id}/items?limit=100`,
        );
        await this.mirrorPlaylist(userId, {
          providerId: pl.id,
          title: pl.name,
          snapshotId: pl.snapshot_id,
          tracks: items.map((i) => i.item).filter((t): t is SpotifyTrackObj => !!t?.id),
          candidates,
          imageUrl: pl.images?.[0]?.url ?? null,
        });
      } catch (err) {
        this.status.skipped.push(pl.name || pl.id);
        // Surface the first failure's detail so the admin UI shows the real cause.
        if (!this.status.lastError) {
          this.status.lastError = String(err instanceof Error ? err.message : err);
        }
        console.error('[spotify] playlist sync failed:', pl.name, err);
      }
    }

    await this.db
      .update(externalAccounts)
      .set({ lastSyncAt: new Date() })
      .where(eq(externalAccounts.id, accountId));
  }

  private async fetchAll<T>(token: string, firstPath: string): Promise<T[]> {
    const out: T[] = [];
    let path: string | null = firstPath;
    while (path) {
      const page: { items: T[]; next: string | null } = await this.api(token, path);
      out.push(...page.items);
      path = page.next ? page.next.replace(API, '') : null;
      if (out.length > 10000) break; // sanity cap
    }
    return out;
  }

  private async loadCandidates(): Promise<LocalCandidate[]> {
    return this.db
      .select({
        id: tracks.id,
        title: tracks.title,
        artistName: artists.name,
        durationMs: tracks.durationMs,
        isrc: tracks.isrc,
      })
      .from(tracks)
      .leftJoin(artists, eq(tracks.artistId, artists.id))
      .where(isNull(tracks.deletedAt));
  }

  private async upsertExternalTrack(
    t: SpotifyTrackObj,
    candidates: LocalCandidate[],
  ): Promise<string> {
    const artistName = t.artists.map((a) => a.name).join(', ');
    const [existing] = await this.db
      .select({ id: externalTracks.id, matchStatus: externalTracks.matchStatus })
      .from(externalTracks)
      .where(and(eq(externalTracks.provider, 'spotify'), eq(externalTracks.providerId, t.id)))
      .limit(1);

    const match = matchTrack(
      {
        title: t.name,
        artist: artistName,
        durationMs: t.duration_ms,
        isrc: t.external_ids?.isrc ?? null,
      },
      candidates,
    );

    if (existing) {
      // Re-run matching only while unmatched; never clobber confirmations.
      if (existing.matchStatus === 'unmatched' && match) {
        await this.db
          .update(externalTracks)
          .set({
            matchedTrackId: match.trackId,
            matchConfidence: match.confidence,
            matchStatus: 'auto',
            updatedSeq: bumpSeq,
          })
          .where(eq(externalTracks.id, existing.id));
        this.status.matched++;
      }
      return existing.id;
    }

    const [created] = await this.db
      .insert(externalTracks)
      .values({
        provider: 'spotify',
        providerId: t.id,
        isrc: t.external_ids?.isrc ?? null,
        title: t.name,
        artist: artistName,
        album: t.album?.name ?? null,
        durationMs: t.duration_ms,
        artUrl: t.album?.images?.[0]?.url ?? null,
        matchedTrackId: match?.trackId ?? null,
        matchConfidence: match?.confidence ?? null,
        matchStatus: match ? 'auto' : 'unmatched',
      })
      .returning({ id: externalTracks.id });
    this.status.tracks++;
    if (match) this.status.matched++;
    return created!.id;
  }

  private async savePlaylistArt(playlistId: string, url: string): Promise<void> {
    // Never clobber an existing cover — it may be user-uploaded.
    const [row] = await this.db
      .select({ artPath: playlists.artPath })
      .from(playlists)
      .where(eq(playlists.id, playlistId))
      .limit(1);
    if (row?.artPath) return;
    const res = await fetch(url);
    if (!res.ok) return;
    await mkdir(this.artDir, { recursive: true });
    const file = path.join(this.artDir, `playlist-${playlistId}.jpg`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    await this.db
      .update(playlists)
      .set({ artPath: file, updatedSeq: bumpSeq })
      .where(eq(playlists.id, playlistId));
  }

  private async mirrorPlaylist(
    userId: string,
    opts: {
      providerId: string;
      title: string;
      snapshotId: string | null;
      tracks: SpotifyTrackObj[];
      candidates: LocalCandidate[];
      imageUrl?: string | null;
    },
  ): Promise<void> {
    let [playlist] = await this.db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.providerId, opts.providerId), eq(playlists.ownerId, userId)))
      .limit(1);

    if (!playlist) {
      [playlist] = await this.db
        .insert(playlists)
        .values({
          ownerId: userId,
          title: opts.title,
          source: 'spotify',
          providerId: opts.providerId,
          providerSnapshotId: opts.snapshotId,
        })
        .returning({ id: playlists.id });
    } else {
      await this.db
        .update(playlists)
        .set({
          title: opts.title,
          providerSnapshotId: opts.snapshotId,
          deletedAt: null,
          updatedSeq: bumpSeq,
        })
        .where(eq(playlists.id, playlist.id));
      // Mirror is authoritative: rebuild items from the source list.
      await this.db.delete(playlistItems).where(eq(playlistItems.playlistId, playlist.id));
    }

    if (opts.imageUrl) {
      await this.savePlaylistArt(playlist!.id, opts.imageUrl).catch(() => {});
    }

    let position = 1;
    for (const t of opts.tracks) {
      if (!t?.id) continue;
      const externalTrackId = await this.upsertExternalTrack(t, opts.candidates);
      await this.db.insert(playlistItems).values({
        playlistId: playlist!.id,
        externalTrackId,
        sortKey: String(position++).padStart(10, '0'),
        addedBy: userId,
      });
    }
  }
}
