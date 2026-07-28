import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { makeWav, writeFixtureLibrary } from './fixtures.js';

let app: FastifyInstance;
let musicDir: string;
let dataDir: string;
let token: string;

const auth = () => ({ authorization: `Bearer ${token}` });

async function waitForScan(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/scan/status',
      headers: auth(),
    });
    if (!res.json().running && res.json().startedAt) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  musicDir = await mkdtemp(path.join(tmpdir(), 'baes-ing-music-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'baes-ing-data-'));
  await writeFixtureLibrary(musicDir);

  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite:memory',
    DATA_DIR: dataDir,
  });
  app = await buildApp(config);
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'owner', password: 'owner-password-1' },
  });
  token = setup.json().token;
  await app.inject({
    method: 'POST',
    url: '/api/admin/roots',
    headers: auth(),
    payload: { path: musicDir },
  });
  await app.inject({ method: 'POST', url: '/api/admin/scan', headers: auth() });
  await waitForScan();
});

afterAll(async () => {
  await app.close();
  await rm(musicDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upload', () => {
  it('accepts audio files and rejects others', async () => {
    const boundary = '----baesboundary';
    const wav = makeWav(0.2);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Uploaded - Fresh Cut.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      wav,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello`,
      ),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().saved).toHaveLength(1);
    expect(res.json().rejected).toContain('notes.txt');

    await waitForScan();
    const list = await app.inject({
      method: 'GET',
      url: '/api/tracks?q=fresh%20cut',
      headers: auth(),
    });
    expect(list.json().tracks).toHaveLength(1);
    expect(list.json().tracks[0].artistName).toBe('Uploaded');
  });
});

describe('track editing', () => {
  it('updates title/artist/album and clears needsReview', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/tracks', headers: auth() });
    const track = list.json().tracks.find((t: any) => t.title === 'untitled_demo_v2');
    expect(track).toBeTruthy();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tracks/${track.id}`,
      headers: auth(),
      payload: { title: 'Actual Song Name', artistName: 'Sebby', albumTitle: 'Vault Vol. 1' },
    });
    expect(res.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/tracks?q=actual%20song',
      headers: auth(),
    });
    const updated = after.json().tracks[0];
    expect(updated.title).toBe('Actual Song Name');
    expect(updated.artistName).toBe('Sebby');
    expect(updated.albumTitle).toBe('Vault Vol. 1');
    expect(updated.needsReview).toBe(false);
  });
});

describe('duplicates & delete', () => {
  it('skips re-uploads of identical bytes and deletes managed uploads', async () => {
    const boundary = '----baesdupe';
    const wav = makeWav(0.2); // identical bytes to the earlier upload
    const part = (name: string) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: audio/wav\r\n\r\n`,
        ),
        wav,
        Buffer.from('\r\n'),
      ]);
    const body = Buffer.concat([part('Dupe - Copy.wav'), Buffer.from(`--${boundary}--\r\n`)]);
    await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    await waitForScan();
    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/scan/status',
      headers: auth(),
    });
    expect(status.json().duplicates).toBe(1);

    // The original uploaded track can be deleted (managed root → file removed)
    const list = await app.inject({
      method: 'GET',
      url: '/api/tracks?q=fresh%20cut',
      headers: auth(),
    });
    const id = list.json().tracks[0].id;
    const del = await app.inject({ method: 'DELETE', url: `/api/tracks/${id}`, headers: auth() });
    expect(del.statusCode).toBe(200);
    expect(del.json().deletedFile).toBe(true);
    const after = await app.inject({
      method: 'GET',
      url: '/api/tracks?q=fresh%20cut',
      headers: auth(),
    });
    expect(after.json().tracks).toHaveLength(0);
  });
});

describe('url import', () => {
  it('previews ArtistGrid eras before tracks when the URL has no era selector', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          eras: [
            {
              name: 'was',
              tracks: [
                {
                  era: 'BABY BOI',
                  quality: 'CD Quality',
                  links: [{ url: 'https://pillows.su/f/33333333333333333333333333333333' }],
                },
              ],
            },
          ],
        }),
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/import-url/preview',
      headers: auth(),
      payload: {
        url: 'https://artistgrid.cx/sh/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/main?artist=Playboi%20Carti',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      kind: 'eras',
      eras: [
        expect.objectContaining({
          name: 'BABY BOI',
          totalTracks: 1,
          playableTracks: 1,
        }),
      ],
    });
    expect(JSON.stringify(res.json())).not.toContain('pillows.su');
  });

  it('previews selectable ArtistGrid tracks without exposing their download URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          name: 'Playboi Carti Tracker [MAIN]',
          eras: [
            {
              name: 'Whole Lotta Red [V1]',
              tracks: [
                {
                  name: { title: 'Buffie The Body [V1]' },
                  quality: 'High Quality',
                  links: [{ url: 'https://pillows.su/f/11111111111111111111111111111111' }],
                },
                {
                  name: { title: 'Back Up [V1]' },
                  quality: 'CD Quality',
                  links: [{ url: 'https://pillows.su/f/22222222222222222222222222222222' }],
                },
              ],
            },
          ],
        }),
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/import-url/preview',
      headers: auth(),
      payload: {
        url:
          'https://artistgrid.cx/sh/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/main' +
          '?artist=Playboi%20Carti&era=Whole%20Lotta%20Red%20%5BV1%5D' +
          '&quality=CD%20Quality&quality=High%20Quality',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe('tracks');
    expect(res.json().items).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        title: 'Buffie The Body [V1]',
        artist: 'Playboi Carti',
        album: 'Whole Lotta Red [V1]',
        quality: 'High Quality',
        sourceHost: 'pillows.su',
      }),
      expect.objectContaining({
        title: 'Back Up [V1]',
        quality: 'CD Quality',
      }),
    ]);
    expect(JSON.stringify(res.json())).not.toContain('https://pillows.su');
  });

  it('records a job (errors gracefully without yt-dlp or network)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import-url',
      headers: auth(),
      payload: { url: 'https://example.com/not-real' },
    });
    expect(res.statusCode).toBe(202);
    const jobs = await app.inject({ method: 'GET', url: '/api/import-jobs', headers: auth() });
    expect(jobs.json().jobs.length).toBeGreaterThan(0);
  });
});
