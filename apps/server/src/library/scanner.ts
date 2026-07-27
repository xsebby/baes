import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { albums, artists, libraryRoots, tracks } from '@baes/db';
import type { Database } from '../db.js';

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

export interface ScanStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  /** New files skipped because identical bytes already exist in the library. */
  duplicates: number;
  errors: { file: string; message: string }[];
}

const bumpSeq = sql`nextval('change_seq')`;

/**
 * Scans library roots into the DB. One scan at a time; progress is exposed
 * for the admin UI. Files are matched by (rootId, relPath); unchanged files
 * (same size+mtime → same contentHash shortcut) are skipped cheaply.
 */
export class LibraryScanner {
  private status: ScanStatus = {
    running: false,
    startedAt: null,
    finishedAt: null,
    scanned: 0,
    added: 0,
    updated: 0,
    removed: 0,
    duplicates: 0,
    errors: [],
  };

  constructor(
    private readonly db: Database,
    private readonly artDir: string,
  ) {}

  getStatus(): ScanStatus {
    return { ...this.status, errors: this.status.errors.slice(-20) };
  }

  /** Fire-and-forget; returns immediately if a scan is already running. */
  start(): boolean {
    if (this.status.running) return false;
    this.status = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      scanned: 0,
      added: 0,
      updated: 0,
      removed: 0,
      duplicates: 0,
      errors: [],
    };
    void this.run()
      .catch((err) => {
        this.status.errors.push({ file: '(scan)', message: String(err?.message ?? err) });
      })
      .finally(() => {
        this.status.running = false;
        this.status.finishedAt = new Date().toISOString();
      });
    return true;
  }

  private async run(): Promise<void> {
    const roots = await this.db.select().from(libraryRoots).where(eq(libraryRoots.enabled, true));

    for (const root of roots) {
      const seen = new Set<string>();
      await this.walkRoot(root.id, root.path, root.path, seen);
      await this.tombstoneMissing(root.id, seen);
      await this.db
        .update(libraryRoots)
        .set({ lastScanAt: new Date() })
        .where(eq(libraryRoots.id, root.id));
    }
  }

  private async walkRoot(
    rootId: string,
    rootPath: string,
    dir: string,
    seen: Set<string>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      this.status.errors.push({ file: dir, message: String(err) });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkRoot(rootId, rootPath, full, seen);
      } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const relPath = path.relative(rootPath, full);
        seen.add(relPath);
        try {
          await this.processFile(rootId, rootPath, relPath);
        } catch (err) {
          this.status.errors.push({
            file: relPath,
            message: String(err instanceof Error ? err.message : err),
          });
        }
        this.status.scanned++;
      }
    }
  }

  private async processFile(rootId: string, rootPath: string, relPath: string): Promise<void> {
    const fullPath = path.join(rootPath, relPath);
    const contentHash = await sha256File(fullPath);

    const [existing] = await this.db
      .select({ id: tracks.id, contentHash: tracks.contentHash, deletedAt: tracks.deletedAt })
      .from(tracks)
      .where(and(eq(tracks.rootId, rootId), eq(tracks.relPath, relPath)))
      .limit(1);

    if (existing && existing.contentHash === contentHash && !existing.deletedAt) {
      return; // unchanged
    }

    // Brand-new file whose exact bytes already live elsewhere in the library
    // (e.g. an accidental re-upload) — skip it instead of creating a duplicate.
    if (!existing) {
      const [dupe] = await this.db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.contentHash, contentHash), isNull(tracks.deletedAt)))
        .limit(1);
      if (dupe) {
        this.status.duplicates++;
        return;
      }
    }

    let meta: IAudioMetadata | null = null;
    try {
      meta = await parseFile(fullPath, { duration: true });
    } catch {
      // Unparseable tags — fall back to filename heuristics below.
    }

    const inferred = inferFromFilename(relPath);
    const common = meta?.common;
    const format = meta?.format;

    const title = common?.title?.trim() || inferred.title;
    const artistName = common?.artist?.trim() || inferred.artist;
    const albumTitle = common?.album?.trim() || null;
    const needsReview = !common?.title || !common?.artist;

    const artistId = artistName ? await this.getOrCreateArtist(artistName) : null;
    const albumId = albumTitle ? await this.getOrCreateAlbum(albumTitle, artistId) : null;

    if (albumId && meta?.common.picture?.[0]) {
      await this.saveAlbumArt(albumId, meta.common.picture[0].data);
    }

    const values = {
      rootId,
      relPath,
      contentHash,
      title,
      artistId,
      albumId,
      trackNo: common?.track?.no ?? null,
      discNo: common?.disk?.no ?? null,
      durationMs: Math.round((format?.duration ?? 0) * 1000),
      codec: format?.codec ?? path.extname(relPath).slice(1).toLowerCase(),
      bitrate: format?.bitrate ? Math.round(format.bitrate) : null,
      sampleRate: format?.sampleRate ? Math.round(format.sampleRate) : null,
      channels: format?.numberOfChannels ?? null,
      isrc: firstIsrc(common?.isrc),
      needsReview,
      deletedAt: null,
    };

    if (existing) {
      await this.db
        .update(tracks)
        .set({ ...values, updatedSeq: bumpSeq })
        .where(eq(tracks.id, existing.id));
      this.status.updated++;
    } else {
      await this.db.insert(tracks).values(values);
      this.status.added++;
    }
  }

  private async tombstoneMissing(rootId: string, seen: Set<string>): Promise<void> {
    const live = await this.db
      .select({ id: tracks.id, relPath: tracks.relPath })
      .from(tracks)
      .where(and(eq(tracks.rootId, rootId), isNull(tracks.deletedAt)));
    for (const row of live) {
      if (!seen.has(row.relPath)) {
        await this.db
          .update(tracks)
          .set({ deletedAt: new Date(), updatedSeq: bumpSeq })
          .where(eq(tracks.id, row.id));
        this.status.removed++;
      }
    }
  }

  private artistCache = new Map<string, string>();

  private async getOrCreateArtist(name: string): Promise<string> {
    const key = name.toLowerCase();
    const cached = this.artistCache.get(key);
    if (cached) return cached;
    const [existing] = await this.db
      .select({ id: artists.id })
      .from(artists)
      .where(sql`lower(${artists.name}) = ${key}`)
      .limit(1);
    if (existing) {
      this.artistCache.set(key, existing.id);
      return existing.id;
    }
    const [created] = await this.db
      .insert(artists)
      .values({ name, sortName: sortName(name) })
      .returning({ id: artists.id });
    this.artistCache.set(key, created!.id);
    return created!.id;
  }

  private albumCache = new Map<string, string>();

  private async getOrCreateAlbum(title: string, artistId: string | null): Promise<string> {
    const key = `${title.toLowerCase()}|${artistId ?? ''}`;
    const cached = this.albumCache.get(key);
    if (cached) return cached;
    const conditions = [sql`lower(${albums.title}) = ${title.toLowerCase()}`];
    conditions.push(artistId ? eq(albums.artistId, artistId) : isNull(albums.artistId));
    const [existing] = await this.db
      .select({ id: albums.id })
      .from(albums)
      .where(and(...conditions))
      .limit(1);
    if (existing) {
      this.albumCache.set(key, existing.id);
      return existing.id;
    }
    const [created] = await this.db
      .insert(albums)
      .values({ title, artistId })
      .returning({ id: albums.id });
    this.albumCache.set(key, created!.id);
    return created!.id;
  }

  private async saveAlbumArt(albumId: string, data: Uint8Array): Promise<void> {
    const [album] = await this.db
      .select({ artPath: albums.artPath })
      .from(albums)
      .where(eq(albums.id, albumId))
      .limit(1);
    if (album?.artPath) return; // first embedded image wins
    await mkdir(this.artDir, { recursive: true });
    const file = path.join(this.artDir, `${albumId}.jpg`);
    await writeFile(file, data);
    await this.db
      .update(albums)
      .set({ artPath: file, updatedSeq: bumpSeq })
      .where(eq(albums.id, albumId));
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** `Artist - Title (v2).mp3` → {artist, title}; bare names become the title. */
export function inferFromFilename(relPath: string): { artist: string | null; title: string } {
  const base = path.basename(relPath, path.extname(relPath));
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0]!.trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: null, title: base.trim() };
}

function sortName(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, '').toLowerCase();
}

function firstIsrc(isrc: string[] | string | undefined): string | null {
  if (!isrc) return null;
  return (Array.isArray(isrc) ? isrc[0] : isrc) ?? null;
}

export async function validateRootPath(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    return s.isDirectory() ? null : 'Path is not a directory';
  } catch {
    return 'Path does not exist or is not readable';
  }
}
