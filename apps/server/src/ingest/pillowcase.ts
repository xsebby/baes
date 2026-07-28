import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PILLOWCASE_HOSTS = new Set([
  'pillowcase.su',
  'www.pillowcase.su',
  'pillows.su',
  'www.pillows.su',
]);

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

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/wave': '.wav',
  'audio/x-aiff': '.aiff',
  'audio/x-wav': '.wav',
};

function safeName(name: string): string {
  return path
    .basename(name)
    .replace(/[/\\<>:"|?*\u0000-\u001f]/g, '_')
    .slice(0, 200);
}

function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain filename parameter.
    }
  }

  return /filename="?([^";]+)"?/i.exec(value)?.[1] ?? null;
}

async function filenameFromPillowcasePage(fileId: string, pageUrl: string): Promise<string | null> {
  try {
    const page = await fetch(pageUrl, {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(30 * 1000),
    });
    if (!page.ok) return null;
    // Pillowcase exposes the original filename in the sharing page's data.
    return /filename\s*:\s*["']([^"']+)["']/i.exec(await page.text())?.[1] ?? null;
  } catch {
    // The download response's headers are sufficient on newer deployments.
    return null;
  }
}

function pillowcaseLink(input: string): { fileId: string; pageUrl: string } | null {
  try {
    const url = new URL(input);
    if (!PILLOWCASE_HOSTS.has(url.hostname.toLowerCase())) return null;

    const match = /^\/f\/([^/]+)\/?$/.exec(url.pathname);
    const fileId = match?.[1];
    // File IDs are opaque, but accepting only a single URL-safe path component
    // prevents it from changing the direct-download URL below.
    if (!fileId || !/^[A-Za-z0-9_-]{6,128}$/.test(fileId)) return null;

    return { fileId, pageUrl: `${url.origin}/f/${encodeURIComponent(fileId)}` };
  } catch {
    return null;
  }
}

/** Returns the file ID for a supported Pillowcase sharing URL. */
export function pillowcaseFileId(input: string): string | null {
  return pillowcaseLink(input)?.fileId ?? null;
}

/** Preserves the sharing host so its filename metadata can be fetched correctly. */
export function pillowcasePageUrl(input: string): string | null {
  return pillowcaseLink(input)?.pageUrl ?? null;
}

async function availableTarget(directory: string, name: string): Promise<string> {
  let target = path.join(directory, name);
  try {
    await stat(target);
    const ext = path.extname(name);
    target = path.join(directory, `${path.basename(name, ext)}-${Date.now()}${ext}`);
  } catch {
    // The name is available.
  }
  return target;
}

/**
 * Downloads a Pillowcase file directly. The host's regular sharing URLs are
 * landing pages, while its download API returns the actual file bytes.
 */
export async function downloadPillowcaseFile(
  fileId: string,
  uploadsDir: string,
  pageUrl = `https://pillows.su/f/${encodeURIComponent(fileId)}`,
): Promise<string> {
  const res = await fetch(`https://api.pillows.su/api/download/${encodeURIComponent(fileId)}`, {
    headers: { accept: 'audio/*, application/octet-stream' },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Pillowcase download failed (${res.status})`);
  }

  const fromHeader = filenameFromDisposition(res.headers.get('content-disposition'));
  const mimeType = res.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (mimeType && !mimeType.startsWith('audio/') && mimeType !== 'application/octet-stream') {
    throw new Error(`Pillowcase returned ${mimeType} instead of audio data`);
  }
  const fromPage = fromHeader ? null : await filenameFromPillowcasePage(fileId, pageUrl);
  const sourceName = fromHeader ?? fromPage;
  const extension = sourceName
    ? path.extname(sourceName).toLowerCase()
    : MIME_EXTENSIONS[mimeType ?? ''];
  if (!extension || !AUDIO_EXTENSIONS.has(extension)) {
    throw new Error('The Pillowcase file is not a supported audio format');
  }

  const filename = safeName(sourceName || `pillowcase-${fileId}${extension}`);
  const target = await availableTarget(uploadsDir, filename);
  await mkdir(uploadsDir, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  return path.basename(target);
}
