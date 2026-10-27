import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { duplicatePairs, libraryRoots, trackFingerprints, tracks } from '@baes/db';
import type { Database } from '../db.js';

const run = promisify(execFile);

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface DuplicateStatus {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  fingerprinted: number;
}

/**
 * Votes a different track must get for a 20 s clip to count as the same
 * recording. On the real library, copies of one recording scored in the
 * hundreds and unrelated tracks under 15 (baes-fingerprint README → Results).
 */
export const DUPLICATE_MIN_VOTES = 60;
const PROBE_SECONDS = 20;
/**
 * Where clips are taken, as fractions of the track. One probe from the middle
 * misses alternate versions (a different mix, an added verse) that share most
 * of their audio but differ there, so check three spots and keep the best.
 */
const PROBE_AT = [0.25, 0.5, 0.75];
const INDEX_BATCH = 200; // files per `fp index` call, well under ARG_MAX

interface FpMatch {
  name: string;
  votes: number;
}

/**
 * Finds tracks that are the same recording, using the `fp` CLI from
 * baes-fingerprint: every live track is indexed, then clips from three points
 * in each newly indexed track are queried against the index. Another track
 * that matches any clip strongly is recorded as a duplicate pair for the owner
 * to review; nothing is deleted or merged automatically.
 *
 * Runs in the background after each library scan. A run that's requested
 * while one is in progress happens once more afterwards instead of in
 * parallel.
 */
export class DuplicateFinder {
  private running = false;
  private rerun = false;
  private lastRunAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly fpBin: string,
    private readonly indexPath: string,
    private readonly log: Logger,
  ) {}

  get enabled(): boolean {
    return this.fpBin !== '';
  }

  async getStatus(): Promise<DuplicateStatus> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(trackFingerprints);
    return {
      enabled: this.enabled,
      running: this.running,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastError: this.lastError,
      fingerprinted: row?.n ?? 0,
    };
  }

  /** Fire-and-forget. Returns false when disabled. */
  start(): boolean {
    if (!this.enabled) return false;
    if (this.running) {
      this.rerun = true;
      return true;
    }
    this.running = true;
    void (async () => {
      do {
        this.rerun = false;
        try {
          await this.runOnce();
          this.lastError = null;
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.log.warn({ err }, 'duplicate detection failed');
        }
        this.lastRunAt = new Date();
      } while (this.rerun);
      this.running = false;
    })();
    return true;
  }

  /** Exposed for tests; normal callers use start(). */
  async runOnce(): Promise<void> {
    const live = await this.db
      .select({
        id: tracks.id,
        contentHash: tracks.contentHash,
        durationMs: tracks.durationMs,
        rootPath: libraryRoots.path,
        relPath: tracks.relPath,
      })
      .from(tracks)
      .innerJoin(libraryRoots, eq(tracks.rootId, libraryRoots.id))
      .where(and(isNull(tracks.deletedAt), eq(libraryRoots.enabled, true)));
    const byId = new Map(live.map((t) => [t.id, t]));
    const idByPath = new Map(live.map((t) => [path.join(t.rootPath, t.relPath), t.id]));

    const done = await this.db.select().from(trackFingerprints);
    // `fp index` only appends, so a file that changed or disappeared since it
    // was fingerprinted would leave a stale entry. Start over in that case;
    // it's a background job and only takes minutes.
    const stale = done.some((d) => byId.get(d.trackId)?.contentHash !== d.contentHash);
    if (stale || (done.length > 0 && !existsSync(this.indexPath))) {
      this.log.info({ stale }, 'rebuilding fingerprint index');
      await rm(this.indexPath, { force: true });
      await this.db.delete(trackFingerprints);
      done.length = 0;
    }
    const doneIds = new Set(done.map((d) => d.trackId));
    const pending = live.filter((t) => !doneIds.has(t.id));
    if (pending.length === 0) return;

    for (let i = 0; i < pending.length; i += INDEX_BATCH) {
      const files = pending.slice(i, i + INDEX_BATCH).map((t) => path.join(t.rootPath, t.relPath));
      await run(this.fpBin, ['index', this.indexPath, ...files], { maxBuffer: 16 << 20 });
    }

    let pairs = 0;
    for (const t of pending) {
      const file = path.join(t.rootPath, t.relPath);
      const seconds = t.durationMs / 1000;
      // Best votes per other track across all probes.
      const best = new Map<string, number>();
      let failed = false;
      for (const at of PROBE_AT) {
        const start = Math.max(
          0,
          Math.min(seconds * at - PROBE_SECONDS / 2, seconds - PROBE_SECONDS),
        );
        try {
          for (const m of await this.query(file, start)) {
            const other = idByPath.get(m.name);
            if (!other || other === t.id) continue;
            best.set(other, Math.max(best.get(other) ?? 0, m.votes));
          }
        } catch (err) {
          // One undecodable file shouldn't stop the rest.
          this.log.warn({ err, file }, 'fingerprint query failed');
          failed = true;
          break;
        }
      }
      if (failed) continue;
      for (const [other, votes] of best) {
        if (votes < DUPLICATE_MIN_VOTES) continue;
        const [a, b] = t.id < other ? [t.id, other] : [other, t.id];
        await this.db
          .insert(duplicatePairs)
          .values({ trackA: a, trackB: b, votes })
          .onConflictDoUpdate({
            target: [duplicatePairs.trackA, duplicatePairs.trackB],
            set: { votes: sql`greatest(${duplicatePairs.votes}, excluded.votes)` },
          });
        pairs++;
      }
      await this.db
        .insert(trackFingerprints)
        .values({ trackId: t.id, contentHash: t.contentHash })
        .onConflictDoUpdate({
          target: trackFingerprints.trackId,
          set: { contentHash: t.contentHash, checkedAt: new Date() },
        });
    }
    this.log.info({ fingerprinted: pending.length, pairs }, 'duplicate detection finished');
  }

  private async query(file: string, startSeconds: number): Promise<FpMatch[]> {
    // `fp query` exits 1 for "no match"; that's an answer, not a failure.
    const args = [
      'query',
      this.indexPath,
      file,
      '--start',
      startSeconds.toFixed(2),
      '--duration',
      String(PROBE_SECONDS),
      '--min-votes',
      String(DUPLICATE_MIN_VOTES),
      '--top',
      '10',
      '--json',
    ];
    let stdout: string;
    try {
      ({ stdout } = await run(this.fpBin, args, { maxBuffer: 1 << 20 }));
    } catch (err) {
      const e = err as { code?: number; stdout?: string };
      if (e.code !== 1 || !e.stdout) throw err;
      stdout = e.stdout;
    }
    return (JSON.parse(stdout) as { matches: FpMatch[] }).matches;
  }
}
