import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadPillowcaseFile,
  pillowcaseFileId,
  pillowcasePageUrl,
} from '../src/ingest/pillowcase.js';

describe('Pillowcase import', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['https://pillowcase.su/f/abc123def456', 'abc123def456'],
    ['https://www.pillowcase.su/f/abc123def456', 'abc123def456'],
    ['https://pillows.su/f/abc123def456', 'abc123def456'],
    ['https://example.com/f/abc123def456', null],
    ['https://pillowcase.su/f/../../etc/passwd', null],
  ])('recognizes sharing links safely', (url, expected) => {
    expect(pillowcaseFileId(url)).toBe(expected);
  });

  it('preserves the sharing host for fallback metadata', () => {
    expect(pillowcasePageUrl('https://pillows.su/f/119e64302e629ee25ebf035b7664b516')).toBe(
      'https://pillows.su/f/119e64302e629ee25ebf035b7664b516',
    );
  });

  it('downloads the audio bytes from Pillowcase’s download endpoint', async () => {
    const uploadsDir = await mkdtemp(path.join(tmpdir(), 'baes-pillowcase-'));
    const contents = Buffer.from('audio-bytes');
    const mockedFetch = vi.fn(
      async () =>
        new Response(contents, {
          headers: {
            'content-disposition': 'attachment; filename="Artist - Song.mp3"',
            'content-type': 'audio/mpeg',
          },
        }),
    );
    vi.stubGlobal('fetch', mockedFetch);

    try {
      const saved = await downloadPillowcaseFile('abc123def456', uploadsDir);
      expect(saved).toBe('Artist - Song.mp3');
      expect(await readFile(path.join(uploadsDir, saved))).toEqual(contents);
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://api.pillows.su/api/download/abc123def456',
        expect.objectContaining({ headers: { accept: 'audio/*, application/octet-stream' } }),
      );
    } finally {
      await rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it('uses the sharing page filename when the download response is generic', async () => {
    const uploadsDir = await mkdtemp(path.join(tmpdir(), 'baes-pillowcase-'));
    const contents = Buffer.from('audio-bytes');
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(contents, { headers: { 'content-type': 'application/octet-stream' } }),
      )
      .mockResolvedValueOnce(
        new Response('<script>filename:"Fallback Song.flac",cover:null</script>'),
      );
    vi.stubGlobal('fetch', mockedFetch);

    try {
      const saved = await downloadPillowcaseFile(
        'abc123def456',
        uploadsDir,
        'https://pillows.su/f/abc123def456',
      );
      expect(saved).toBe('Fallback Song.flac');
      expect(await readFile(path.join(uploadsDir, saved))).toEqual(contents);
      expect(mockedFetch).toHaveBeenNthCalledWith(
        2,
        'https://pillows.su/f/abc123def456',
        expect.objectContaining({ headers: { accept: 'text/html' } }),
      );
    } finally {
      await rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it('rejects an HTML response instead of saving it with an audio extension', async () => {
    const uploadsDir = await mkdtemp(path.join(tmpdir(), 'baes-pillowcase-'));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Not an audio file</html>', {
            headers: {
              'content-disposition': 'attachment; filename="Broken Song.mp3"',
              'content-type': 'text/html; charset=utf-8',
            },
          }),
      ),
    );

    try {
      await expect(downloadPillowcaseFile('abc123def456', uploadsDir)).rejects.toThrow(
        'Pillowcase returned text/html instead of audio data',
      );
    } finally {
      await rm(uploadsDir, { recursive: true, force: true });
    }
  });
});
