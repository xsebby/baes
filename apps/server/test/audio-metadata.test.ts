import { EventEmitter } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { embedAudioMetadata } from '../src/ingest/audio-metadata.js';

describe('ArtistGrid audio metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    spawnMock.mockReset();
  });

  it('copies audio while writing title, artist, album, year, and cover art', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'baes-metadata-'));
    const source = path.join(directory, 'source.mp3');
    await writeFile(source, 'original-audio');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(Buffer.from('jpeg-cover'), {
            headers: { 'content-type': 'image/jpeg' },
          }),
      ),
    );
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      proc.stderr = new EventEmitter();
      const input = args[args.indexOf('-i') + 1]!;
      const output = args.at(-1)!;
      void copyFile(input, output).then(() => proc.emit('exit', 0));
      return proc;
    });

    try {
      await embedAudioMetadata(
        source,
        {
          title: 'Back Up [V1]',
          artist: 'Playboi Carti',
          album: 'Whole Lotta Red [V1]',
          year: 2018,
          coverUrl: 'https://example.com/wlr-v1.jpg',
        },
        path.join(directory, 'covers'),
      );

      expect(await readFile(source, 'utf8')).toBe('original-audio');
      expect(spawnMock).toHaveBeenCalledOnce();
      const args = spawnMock.mock.calls[0]![1] as string[];
      expect(args).toContain('title=Back Up [V1]');
      expect(args).toContain('artist=Playboi Carti');
      expect(args).toContain('album=Whole Lotta Red [V1]');
      expect(args).toContain('date=2018');
      expect(args).toContain('attached_pic');
      expect(args).toContain('3');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
