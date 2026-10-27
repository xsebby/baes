import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { writeFixtureLibrary } from './fixtures.js';

let app: FastifyInstance;
let musicDir: string;
let dataDir: string;
let owner = '';
let trackIds: string[] = [];
const auth = (t = owner) => ({ authorization: `Bearer ${t}` });

async function share(payload: object) {
  return app.inject({ method: 'POST', url: '/api/shares', headers: auth(), payload });
}
const open = (token: string) => app.inject({ method: 'GET', url: `/api/s/${token}` });

beforeAll(async () => {
  musicDir = await mkdtemp(path.join(tmpdir(), 'baes-share-music-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'baes-share-data-'));
  await writeFixtureLibrary(musicDir);
  app = await buildApp(
    loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite:memory',
      DATA_DIR: dataDir,
      PUBLIC_URL: 'https://music.example',
    }),
  );
  expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json()).toEqual({
    needsSetup: true,
  });
  owner = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'owner', password: 'owner-password-1' },
    })
  ).json().token;
  await app.inject({
    method: 'POST',
    url: '/api/admin/roots',
    headers: auth(),
    payload: { path: musicDir },
  });
  await app.inject({ method: 'POST', url: '/api/admin/scan', headers: auth() });
  for (let i = 0; i < 100; i++) {
    const s = (
      await app.inject({ method: 'GET', url: '/api/admin/scan/status', headers: auth() })
    ).json();
    if (!s.running && s.finishedAt) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  trackIds = (await app.inject({ method: 'GET', url: '/api/tracks', headers: auth() }))
    .json()
    .tracks.map((t: any) => t.id);
});

afterAll(async () => {
  await app.close();
  await rm(musicDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

describe('share links', () => {
  it('auth status no longer offers setup once an owner exists', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json()).toEqual({
      needsSetup: false,
    });
  });

  it('shares a track: anyone with the link can stream and download it', async () => {
    const created = await share({ kind: 'track', targetId: trackIds[0] });
    expect(created.statusCode).toBe(201);
    const { token, url, expiresAt } = created.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(url).toBe(`https://music.example/s/${token}`);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000); // default 7 days

    const res = await open(token); // no auth header
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('track');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].downloadUrl).toContain('download=1');

    const stream = await app.inject({ method: 'GET', url: body.items[0].streamUrl });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-disposition']).toBeUndefined();
    const dl = await app.inject({ method: 'GET', url: body.items[0].downloadUrl });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''.+\.wav$/);
  });

  it('hides the download link when downloads are off', async () => {
    const { token } = (
      await share({ kind: 'track', targetId: trackIds[1], allowDownload: false })
    ).json();
    const body = (await open(token)).json();
    expect(body.allowDownload).toBe(false);
    expect(body.items[0].downloadUrl).toBeNull();
    expect(body.items[0].streamUrl).toContain('/api/stream/');
  });

  it('shares a playlist with its tracks in order', async () => {
    const pl = (
      await app.inject({
        method: 'POST',
        url: '/api/playlists',
        headers: auth(),
        payload: { title: 'for friends' },
      })
    ).json().playlist;
    for (const id of [trackIds[2], trackIds[0]]) {
      await app.inject({
        method: 'POST',
        url: `/api/playlists/${pl.id}/items`,
        headers: auth(),
        payload: { trackId: id },
      });
    }
    const { token } = (
      await share({ kind: 'playlist', targetId: pl.id, expiresInDays: null })
    ).json();
    const body = (await open(token)).json();
    expect(body.title).toBe('for friends');
    expect(body.expiresAt).toBeNull();
    expect(body.items.map((i: any) => i.id)).toEqual([trackIds[2], trackIds[0]]);
  });

  it('expired links stop working', async () => {
    const { token } = (
      await share({ kind: 'track', targetId: trackIds[0], expiresInDays: 7 })
    ).json();
    expect((await open(token)).statusCode).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 8 * 86_400_000);
      expect((await open(token)).statusCode).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it('revoked links stop working and look like any bad link', async () => {
    const created = (await share({ kind: 'track', targetId: trackIds[0] })).json();
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/shares/${created.id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(204);
    const revoked = await open(created.token);
    const bogus = await open('AAAAAAAAAAAAAAAAAAAAAA');
    expect(revoked.statusCode).toBe(404);
    expect(revoked.json()).toEqual(bogus.json());
  });

  it('lists the owner’s active links with titles and view counts', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/shares', headers: auth() })).json();
    expect(list.shares.length).toBe(4); // the revoked one is gone
    expect(list.shares.every((s: any) => s.url.startsWith('https://music.example/s/'))).toBe(true);
    expect(list.shares.find((s: any) => s.kind === 'playlist').title).toBe('for friends');
    expect(list.shares.some((s: any) => s.views >= 1)).toBe(true);
  });

  it('only the owner can create links, and only for things that exist', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/shares', payload: {} })).statusCode).toBe(
      401,
    );
    const missing = await share({
      kind: 'track',
      targetId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);
  });
});
