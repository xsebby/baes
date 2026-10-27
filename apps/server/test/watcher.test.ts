import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryWatcher } from '../src/library/watcher.js';
import type { Database } from '../src/db.js';
import type { LibraryScanner } from '../src/library/scanner.js';

const QUIET_MS = 150;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = { info() {}, warn() {} };

/** Just enough of drizzle's select chain for LibraryWatcher.syncRoots. */
function fakeDb(roots: string[]): Database {
  const chain = { from: () => chain, where: async () => roots.map((p) => ({ path: p })) };
  return { select: () => chain } as unknown as Database;
}

function fakeScanner(busyFor = 0) {
  let busy = busyFor;
  const scanner = {
    starts: 0,
    attempts: 0,
    start() {
      scanner.attempts++;
      if (busy > 0) {
        busy--;
        return false;
      }
      scanner.starts++;
      return true;
    },
  };
  return scanner;
}

let dir: string;
let watcher: LibraryWatcher | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'baes-watch-'));
});

afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('LibraryWatcher', () => {
  it('starts one scan after a burst of changes settles', async () => {
    const scanner = fakeScanner();
    watcher = new LibraryWatcher(
      fakeDb([dir]),
      scanner as unknown as LibraryScanner,
      log,
      QUIET_MS,
    );
    await watcher.start();

    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(dir, `song-${i}.mp3`), 'x');
      await wait(20);
    }
    expect(scanner.starts).toBe(0);
    await wait(QUIET_MS * 3);
    expect(scanner.starts).toBe(1);
  });

  it('ignores dotfiles such as in-progress sync temp files', async () => {
    const scanner = fakeScanner();
    watcher = new LibraryWatcher(
      fakeDb([dir]),
      scanner as unknown as LibraryScanner,
      log,
      QUIET_MS,
    );
    await watcher.start();
    // macOS FSEvents can deliver a late event for the temp dir's own
    // creation; let it settle so only the dotfile write is measured.
    await wait(QUIET_MS * 3);
    scanner.attempts = 0;

    await writeFile(path.join(dir, '.syncthing.song.mp3.tmp'), 'x');
    await wait(QUIET_MS * 3);
    expect(scanner.attempts).toBe(0);
  });

  it('retries when a scan is already running', async () => {
    const scanner = fakeScanner(2);
    watcher = new LibraryWatcher(
      fakeDb([dir]),
      scanner as unknown as LibraryScanner,
      log,
      QUIET_MS,
    );
    await watcher.start();

    await writeFile(path.join(dir, 'song.flac'), 'x');
    await wait(QUIET_MS * 5);
    expect(scanner.attempts).toBe(3);
    expect(scanner.starts).toBe(1);
  });
});
