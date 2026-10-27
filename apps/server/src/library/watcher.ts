import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { libraryRoots } from '@baes/db';
import type { Database } from '../db.js';
import type { LibraryScanner } from './scanner.js';

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Starts a library scan when files under an enabled root change, so music
 * synced onto the box (Syncthing, scp) shows up without a manual rescan.
 *
 * Changes are debounced: the scan starts once the tree has been quiet for
 * `quietMs`, so a large copy triggers one scan rather than hundreds. Dotfiles
 * are ignored — that's where Syncthing and rsync stage partial transfers. The
 * scanner already skips unchanged files cheaply, so over-triggering is safe.
 */
export class LibraryWatcher {
  private watchers = new Map<string, FSWatcher>();
  private debounce: NodeJS.Timeout | null = null;
  private refresh: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly scanner: LibraryScanner,
    private readonly log: Logger,
    private readonly quietMs = 30_000,
    private readonly refreshMs = 5 * 60_000,
  ) {}

  async start(): Promise<void> {
    await this.syncRoots();
    // Roots can be added or disabled at runtime; pick that up periodically.
    this.refresh = setInterval(() => void this.syncRoots(), this.refreshMs);
    this.refresh.unref();
  }

  close(): void {
    if (this.refresh) clearInterval(this.refresh);
    if (this.debounce) clearTimeout(this.debounce);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /** Watch exactly the enabled roots. */
  async syncRoots(): Promise<void> {
    const roots = await this.db
      .select({ path: libraryRoots.path })
      .from(libraryRoots)
      .where(eq(libraryRoots.enabled, true));
    const wanted = new Set(roots.map((r) => r.path));

    for (const [p, w] of this.watchers) {
      if (!wanted.has(p)) {
        w.close();
        this.watchers.delete(p);
      }
    }
    for (const p of wanted) {
      if (this.watchers.has(p)) continue;
      try {
        const w = watch(p, { recursive: true, persistent: false }, (_event, file) =>
          this.onChange(file),
        );
        w.on('error', (err) => {
          this.log.warn({ err, root: p }, 'library watcher failed; will retry');
          w.close();
          this.watchers.delete(p);
        });
        this.watchers.set(p, w);
        this.log.info({ root: p }, 'watching library root');
      } catch (err) {
        this.log.warn({ err, root: p }, 'cannot watch library root');
      }
    }
  }

  private onChange(file: string | Buffer | null): void {
    const rel = file?.toString() ?? '';
    if (rel.split(path.sep).some((part) => part.startsWith('.'))) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      // A scan already in flight may have missed these changes; try again
      // once it's done rather than dropping them.
      if (!this.scanner.start()) {
        this.schedule();
        return;
      }
      this.log.info({}, 'library changed; scan started');
    }, this.quietMs);
    this.debounce.unref();
  }
}
