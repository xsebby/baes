import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.json().running && res.json().startedAt) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('scan did not finish');
}

async function runScan(): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/scan',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(202);
  await waitForScan();
}

beforeAll(async () => {
  musicDir = await mkdtemp(path.join(tmpdir(), 'baes-music-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'baes-data-'));
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

  const addRoot = await app.inject({
    method: 'POST',
    url: '/api/admin/roots',
    headers: { authorization: `Bearer ${token}` },
    payload: { path: musicDir },
  });
  expect(addRoot.statusCode).toBe(201);
});

afterAll(async () => {
  await app.close();
  await rm(musicDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

describe('library scan', () => {
  it('rejects invalid root paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/roots',
      headers: { authorization: `Bearer ${token}` },
      payload: { path: '/definitely/not/a/real/dir' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('scans fixtures into tracks with filename-inferred metadata', async () => {
    await runScan();

    const res = await app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const { tracks } = res.json();
    expect(tracks).toHaveLength(3);

    const songA = tracks.find((t: any) => t.title === 'Song A');
    expect(songA).toBeTruthy();
    expect(songA.artistName).toBe('Artist One');
    expect(songA.durationMs).toBeGreaterThan(900);
    expect(songA.streamUrl).toContain('/api/stream/');
    expect(songA.streamUrl).toContain('sig=');

    // WAVs carry no tags → everything is flagged for review
    expect(tracks.every((t: any) => t.needsReview)).toBe(true);

    const untagged = tracks.find((t: any) => t.title === 'untitled_demo_v2');
    expect(untagged).toBeTruthy();
    expect(untagged.artistName).toBeNull();
  });

  it('is idempotent — rescanning changes nothing', async () => {
    await runScan();
    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/scan/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.json().added).toBe(0);
    expect(status.json().updated).toBe(0);
    expect(status.json().removed).toBe(0);
  });

  it('tombstones deleted files on rescan', async () => {
    await unlink(path.join(musicDir, 'untitled_demo_v2.wav'));
    await runScan();
    const res = await app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().tracks).toHaveLength(2);
  });

  it('search filters by title and artist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tracks?q=song%20a',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().tracks).toHaveLength(1);
    expect(res.json().tracks[0].title).toBe('Song A');
  });

  it('requires auth for library endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tracks' });
    expect(res.statusCode).toBe(401);
  });

  it('groups albums that differ only by a bracketed version suffix', async () => {
    // Two albums, same artist, titles differing only by [V1] / [V2]
    const mk = async (albumTitle: string, songs: string[]) => {
      const dir = path.join(musicDir, albumTitle.replace(/[^a-z0-9]/gi, '_'));
      await mkdir(dir, { recursive: true });
      for (const s of songs) {
        await writeFile(
          path.join(dir, `Version Artist - ${s}.wav`),
          makeWav(0.2 + Math.random() * 0.1),
        );
      }
    };
    await mk('Vault [V1]', ['One A', 'One B']);
    await mk('Vault [V2]', ['Two A']);
    await runScan();

    // tag them into albums (scanner infers no album tag from WAV filenames)
    const list = await app.inject({ method: 'GET', url: '/api/tracks', headers: auth() });
    const all = list.json().tracks;
    for (const [title, album] of [
      ['One A', 'Vault [V1]'],
      ['One B', 'Vault [V1]'],
      ['Two A', 'Vault [V2]'],
    ] as const) {
      const tr = all.find((x: any) => x.title === title);
      await app.inject({
        method: 'PATCH',
        url: `/api/tracks/${tr.id}`,
        headers: auth(),
        payload: { artistName: 'Version Artist', albumTitle: album },
      });
    }

    const albumsRes = await app.inject({ method: 'GET', url: '/api/albums', headers: auth() });
    const v1 = albumsRes.json().albums.find((a: any) => a.title === 'Vault [V1]');
    expect(v1).toBeTruthy();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/albums/${v1.id}`,
      headers: auth(),
    });
    const body = detail.json();
    expect(body.baseTitle).toBe('Vault');
    expect(body.versionLabel).toBe('V1');
    expect(body.versions.map((v: any) => v.label).sort()).toEqual(['V1', 'V2']);
    expect(body.versions.find((v: any) => v.label === 'V2').trackCount).toBe(1);
  });

  it('carves an album into named tracklists', async () => {
    const albumsRes = await app.inject({ method: 'GET', url: '/api/albums', headers: auth() });
    const v1 = albumsRes.json().albums.find((a: any) => a.title === 'Vault [V1]');
    const detail0 = await app.inject({
      method: 'GET',
      url: `/api/albums/${v1.id}`,
      headers: auth(),
    });
    const trackIds = detail0.json().tracks.map((x: any) => x.id);
    expect(trackIds.length).toBeGreaterThanOrEqual(2);

    // create a curated listen using the second track first
    const created = await app.inject({
      method: 'POST',
      url: `/api/albums/${v1.id}/tracklists`,
      headers: auth(),
      payload: { name: 'Official', trackIds: [trackIds[1], trackIds[0]] },
    });
    expect(created.statusCode).toBe(201);
    const tlId = created.json().tracklist.id;

    const withList = await app.inject({
      method: 'GET',
      url: `/api/albums/${v1.id}`,
      headers: auth(),
    });
    const lists = withList.json().tracklists;
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe('Official');
    // order is preserved exactly as submitted
    expect(lists[0].trackIds).toEqual([trackIds[1], trackIds[0]]);

    // rename + replace contents
    await app.inject({
      method: 'PATCH',
      url: `/api/tracklists/${tlId}`,
      headers: auth(),
      payload: { name: 'Fanmade v2', trackIds: [trackIds[0]] },
    });
    const after = await app.inject({
      method: 'GET',
      url: `/api/albums/${v1.id}`,
      headers: auth(),
    });
    expect(after.json().tracklists[0].name).toBe('Fanmade v2');
    expect(after.json().tracklists[0].trackIds).toEqual([trackIds[0]]);

    await app.inject({ method: 'DELETE', url: `/api/tracklists/${tlId}`, headers: auth() });
    const gone = await app.inject({
      method: 'GET',
      url: `/api/albums/${v1.id}`,
      headers: auth(),
    });
    expect(gone.json().tracklists).toHaveLength(0);
  });

  it('builds a tracklist from pasted numbered text', async () => {
    const albumsRes = await app.inject({ method: 'GET', url: '/api/albums', headers: auth() });
    const v1 = albumsRes.json().albums.find((a: any) => a.title === 'Vault [V1]');
    const detail = await app.inject({
      method: 'GET',
      url: `/api/albums/${v1.id}`,
      headers: auth(),
    });
    const titles = detail.json().tracks.map((t: any) => t.title);

    const pasted = [
      `1. ${titles[1]}`,
      `2. ${titles[0]} (prod. someone)`,
      '3. A Song That Does Not Exist',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: `/api/albums/${v1.id}/tracklists/from-text`,
      headers: auth(),
      payload: { name: 'Pasted', text: pasted },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // numbering stripped, order preserved, extra notes tolerated
    expect(body.matched).toBe(2);
    expect(body.tracklist.trackIds).toEqual([
      detail.json().tracks[1].id,
      detail.json().tracks[0].id,
    ]);
    expect(body.unmatched).toEqual(['A Song That Does Not Exist']);

    await app.inject({
      method: 'DELETE',
      url: `/api/tracklists/${body.tracklist.id}`,
      headers: auth(),
    });
  });

  it('returns artist detail with their tracks', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/artists',
      headers: { authorization: `Bearer ${token}` },
    });
    const artist = list.json().artists.find((a: any) => a.name === 'Artist One');
    expect(artist).toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: `/api/artists/${artist.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Artist One');
    expect(res.json().tracks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('streaming', () => {
  async function getStreamUrl(): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json().tracks[0].streamUrl;
  }

  it('serves full file with 200 and correct type', async () => {
    const url = await getStreamUrl();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/wav');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('serves partial content for range requests', async () => {
    const url = await getStreamUrl();
    const res = await app.inject({ method: 'GET', url, headers: { range: 'bytes=0-99' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect(res.headers['content-length']).toBe('100');
    expect(res.rawPayload.length).toBe(100);
    // RIFF magic at the start of the file
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('RIFF');
  });

  it('serves suffix ranges', async () => {
    const url = await getStreamUrl();
    const res = await app.inject({ method: 'GET', url, headers: { range: 'bytes=-50' } });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(50);
  });

  it('rejects unsatisfiable ranges', async () => {
    const url = await getStreamUrl();
    const res = await app.inject({
      method: 'GET',
      url,
      headers: { range: 'bytes=99999999-' },
    });
    expect(res.statusCode).toBe(416);
  });

  it('rejects tampered signatures', async () => {
    const url = await getStreamUrl();
    const tampered = url.replace(/sig=./, 'sig=X');
    const res = await app.inject({ method: 'GET', url: tampered });
    expect(res.statusCode).toBe(403);
  });

  it('rejects expired URLs', async () => {
    const url = await getStreamUrl();
    const expired = url.replace(/exp=\d+/, 'exp=1000000000');
    const res = await app.inject({ method: 'GET', url: expired });
    expect(res.statusCode).toBe(403);
  });

  it('refreshes a stream URL via the authed endpoint', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    const id = list.json().tracks[0].id;
    const res = await app.inject({
      method: 'GET',
      url: `/api/tracks/${id}/stream-url`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain(`/api/stream/${id}`);
  });
});
