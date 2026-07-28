import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TrackerImportMetadata } from './trackerhub.js';

const MAX_COVER_BYTES = 20 * 1024 * 1024;
const coverPromises = new Map<string, Promise<string | null>>();

function coverExtension(contentType: string | null): string {
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  return '.jpg';
}

async function downloadCover(url: string, cacheDir: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { accept: 'image/*' },
    signal: AbortSignal.timeout(30 * 1000),
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? null;
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (
    !response.ok ||
    !contentType?.startsWith('image/') ||
    (contentLength > 0 && contentLength > MAX_COVER_BYTES)
  ) {
    return null;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_COVER_BYTES) return null;

  await mkdir(cacheDir, { recursive: true });
  const key = createHash('sha256').update(url).digest('hex');
  const target = path.join(cacheDir, `${key}${coverExtension(contentType)}`);
  try {
    await stat(target);
  } catch {
    await writeFile(target, bytes);
  }
  return target;
}

function cachedCover(url: string, cacheDir: string): Promise<string | null> {
  const key = `${cacheDir}\n${url}`;
  const existing = coverPromises.get(key);
  if (existing) return existing;
  const pending = downloadCover(url, cacheDir).catch(() => null);
  coverPromises.set(key, pending);
  return pending;
}

function metadataArgs(metadata: TrackerImportMetadata): string[] {
  const args = ['-metadata', `title=${metadata.title}`];
  if (metadata.artist) {
    args.push('-metadata', `artist=${metadata.artist}`);
    args.push('-metadata', `album_artist=${metadata.artist}`);
  }
  if (metadata.album) args.push('-metadata', `album=${metadata.album}`);
  if (metadata.year) args.push('-metadata', `date=${metadata.year}`);
  return args;
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok, stderr });
    };
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error);
      finish(false);
    });
    proc.on('exit', (code) => finish(code === 0));
  });
}

async function writeTags(
  source: string,
  target: string,
  metadata: TrackerImportMetadata,
  coverPath: string | null,
): Promise<{ ok: boolean; stderr: string }> {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', source];
  if (coverPath) {
    args.push(
      '-i',
      coverPath,
      '-map',
      '0:a:0',
      '-map',
      '1:v:0',
      '-c:a',
      'copy',
      '-c:v',
      'copy',
      '-disposition:v:0',
      'attached_pic',
      '-metadata:s:v',
      'title=Album cover',
    );
  } else {
    args.push('-map', '0', '-c', 'copy');
  }
  args.push(...metadataArgs(metadata));
  if (path.extname(source).toLowerCase() === '.mp3') {
    args.push('-id3v2_version', '3');
  }
  args.push(target);
  return runFfmpeg(args);
}

/**
 * Rewrites container tags without transcoding the audio stream. If a format
 * cannot carry the supplied artwork, tags are retried without cover art.
 */
export async function embedAudioMetadata(
  filePath: string,
  metadata: TrackerImportMetadata,
  coverCacheDir: string,
): Promise<void> {
  const extension = path.extname(filePath);
  const target = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath, extension)}-metadata-${randomUUID()}${extension}`,
  );
  const coverPath = metadata.coverUrl ? await cachedCover(metadata.coverUrl, coverCacheDir) : null;

  let result = await writeTags(filePath, target, metadata, coverPath);
  if (!result.ok && coverPath) {
    await unlink(target).catch(() => {});
    result = await writeTags(filePath, target, metadata, null);
  }
  if (!result.ok) {
    await unlink(target).catch(() => {});
    const detail = result.stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
    throw new Error(`Could not embed ArtistGrid metadata${detail ? `: ${detail}` : ''}`);
  }
  await rename(target, filePath);
}
