import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { writeFixtureLibrary } from './fixtures.js';

let app: FastifyInstance;
let musicDir: string;
let dataDir: string;
let token: string;
let trackIds: string[] = [];

const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  musicDir = await mkdtemp(path.join(tmpdir(), 'baes-pl-music-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'baes-pl-data-'));
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
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/scan/status',
      headers: auth(),
    });
    if (!res.json().running && res.json().startedAt) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const tracks = await app.inject({ method: 'GET', url: '/api/tracks', headers: auth() });
  trackIds = tracks.json().tracks.map((t: any) => t.id);
});

afterAll(async () => {
  await app.close();
  await rm(musicDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

describe('playlists', () => {
  let playlistId: string;
  let itemId: string;

  it('creates a playlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      headers: auth(),
      payload: { title: 'unreleased heat' },
    });
    expect(res.statusCode).toBe(201);
    playlistId = res.json().playlist.id;
  });

  it('adds tracks in order', async () => {
    for (const trackId of trackIds.slice(0, 3)) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/playlists/${playlistId}/items`,
        headers: auth(),
        payload: { trackId },
      });
      expect(res.statusCode).toBe(201);
    }
    const detail = await app.inject({
      method: 'GET',
      url: `/api/playlists/${playlistId}`,
      headers: auth(),
    });
    const items = detail.json().items;
    expect(items).toHaveLength(3);
    expect(items.map((i: any) => i.track.id)).toEqual(trackIds.slice(0, 3));
    itemId = items[1].itemId;
  });

  it('lists playlists with track counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/playlists', headers: auth() });
    const pl = res.json().playlists.find((p: any) => p.id === playlistId);
    expect(pl.trackCount).toBe(3);
  });

  it('removes an item', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/playlists/${playlistId}/items/${itemId}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/playlists/${playlistId}`,
      headers: auth(),
    });
    expect(detail.json().items).toHaveLength(2);
  });

  it('soft-deletes the playlist', async () => {
    await app.inject({ method: 'DELETE', url: `/api/playlists/${playlistId}`, headers: auth() });
    const res = await app.inject({ method: 'GET', url: '/api/playlists', headers: auth() });
    expect(res.json().playlists.find((p: any) => p.id === playlistId)).toBeUndefined();
  });
});

describe('likes', () => {
  it('like → appears in liked list and ids', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/tracks/${trackIds[0]}/like`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);

    const liked = await app.inject({ method: 'GET', url: '/api/likes', headers: auth() });
    expect(liked.json().tracks.map((t: any) => t.id)).toContain(trackIds[0]);

    const ids = await app.inject({ method: 'GET', url: '/api/likes/ids', headers: auth() });
    expect(ids.json().trackIds).toContain(trackIds[0]);
  });

  it('like is idempotent', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/tracks/${trackIds[0]}/like`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    const liked = await app.inject({ method: 'GET', url: '/api/likes', headers: auth() });
    expect(liked.json().tracks).toHaveLength(1);
  });

  it('unlike removes it', async () => {
    await app.inject({
      method: 'DELETE',
      url: `/api/tracks/${trackIds[0]}/like`,
      headers: auth(),
    });
    const liked = await app.inject({ method: 'GET', url: '/api/likes', headers: auth() });
    expect(liked.json().tracks).toHaveLength(0);
  });

  it('re-like after unlike works (tombstone revival)', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/tracks/${trackIds[0]}/like`,
      headers: auth(),
    });
    const liked = await app.inject({ method: 'GET', url: '/api/likes', headers: auth() });
    expect(liked.json().tracks).toHaveLength(1);
  });
});
