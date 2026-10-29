import { spawn } from 'node:child_process';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Smaller copies of covers for lists and grids. Embedded art can be several
 * MB, which is a lot for a 40px thumbnail. Made with ffmpeg on first request
 * and cached in DATA_DIR/art-cache, next to DATA_DIR/art (rebuilt when the
 * cover changes; left out of backups since it can be remade).
 */
export const ART_WIDTHS = [160, 640] as const;
export type ArtWidth = (typeof ART_WIDTHS)[number];

const MAX_JOBS = 2; // the VPS has one core
const inFlight = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let running = 0;

export function parseArtWidth(w: unknown): ArtWidth | null {
  const n = Number(w);
  return (ART_WIDTHS as readonly number[]).includes(n) ? (n as ArtWidth) : null;
}

/** Path to a copy of `artPath` at most `width` px wide, or the original if that fails. */
export async function sizedArt(artPath: string, width: ArtWidth): Promise<string> {
  const out = path.join(
    path.dirname(path.dirname(path.resolve(artPath))),
    'art-cache',
    `${path.basename(artPath, path.extname(artPath))}-${width}.jpg`,
  );
  try {
    const [src, dst] = await Promise.all([stat(artPath), stat(out)]);
    if (dst.mtimeMs >= src.mtimeMs) return out;
  } catch {
    // not made yet (or the source is gone, which the caller will hit anyway)
  }
  let job = inFlight.get(out);
  if (!job) {
    job = resize(artPath, out, width)
      .then(() => out)
      .catch(() => artPath)
      .finally(() => inFlight.delete(out));
    inFlight.set(out, job);
  }
  return job;
}

async function resize(src: string, out: string, width: number) {
  if (running >= MAX_JOBS) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    await mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.tmp.jpg`;
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'ffmpeg',
        // Never upscale; -q:v 3 is high quality JPEG.
        [
          '-y',
          '-v',
          'error',
          '-i',
          src,
          '-vf',
          `scale='min(${width},iw)':-1`,
          '-frames:v',
          '1',
          '-q:v',
          '3',
          tmp,
        ],
        { stdio: 'ignore' },
      );
      proc.on('error', reject);
      proc.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
      );
    });
    await rename(tmp, out);
  } finally {
    running--;
    waiting.shift()?.();
  }
}
