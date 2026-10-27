import { describe, expect, it } from 'vitest';
import { DEFAULT_TAG_LABELS, splitTag } from '../src/library/tags.js';

// Spelled with escapes: the variation selector (U+FE0F) is invisible, and
// whether it's present is exactly what some of these tests are about.
const STAR = '⭐';
const STAR_VS = '⭐️';
const TROPHY = '\u{1F3C6}';
const SPARKLES = '✨';
const SCISSORS = '✂';
const SCISSORS_VS = '✂️';
const BIN_VS = '\u{1F5D1}️';

describe('splitTag', () => {
  it('moves a leading marker emoji into the tag', () => {
    expect(splitTag(`${STAR} Song Name`)).toEqual({ title: 'Song Name', tag: STAR });
    expect(splitTag(`${TROPHY} Grail Song (prod. X)`)).toEqual({
      title: 'Grail Song (prod. X)',
      tag: TROPHY,
    });
    expect(splitTag(`${SPARKLES}Special`)).toEqual({ title: 'Special', tag: SPARKLES });
  });

  it('spells each tag one way, with or without the variation selector', () => {
    // The star is emoji-style by default: stored without a selector.
    expect(splitTag(`${STAR_VS} Song`).tag).toBe(STAR);
    expect(splitTag(`${STAR} Song`).tag).toBe(STAR);
    // Scissors and wastebasket default to text style: stored with one.
    expect(splitTag(`${SCISSORS} Snippet`).tag).toBe(SCISSORS_VS);
    expect(splitTag(`${SCISSORS_VS} Snippet`).tag).toBe(SCISSORS_VS);
    expect(splitTag(`${BIN_VS} Bad Song`).tag).toBe(BIN_VS);
  });

  it('has default labels for the normalized spellings', () => {
    for (const tag of [STAR, TROPHY, SPARKLES, SCISSORS_VS, BIN_VS]) {
      expect(DEFAULT_TAG_LABELS[tag]).toBeTruthy();
    }
  });

  it('keeps multi-code-point emoji together', () => {
    expect(splitTag('\u{1F44D}\u{1F3FD} Song')).toEqual({
      title: 'Song',
      tag: '\u{1F44D}\u{1F3FD}',
    });
    expect(splitTag('\u{1F9D1}‍\u{1F4BB} Song')).toEqual({
      title: 'Song',
      tag: '\u{1F9D1}‍\u{1F4BB}',
    });
  });

  it('leaves titles alone when there is no leading emoji', () => {
    expect(splitTag(`Song ${STAR} Name`)).toEqual({ title: `Song ${STAR} Name`, tag: null });
    expect(splitTag('??? Unknown')).toEqual({ title: '??? Unknown', tag: null });
    expect(splitTag('*Song')).toEqual({ title: '*Song', tag: null });
    expect(splitTag('Plain')).toEqual({ title: 'Plain', tag: null });
  });

  it('keeps an emoji-only title as the title', () => {
    expect(splitTag(STAR)).toEqual({ title: STAR, tag: null });
  });

  it('does not treat digits or # as emoji', () => {
    // \p{Extended_Pictographic} excludes keycap bases, unlike \p{Emoji}.
    expect(splitTag('1 Song')).toEqual({ title: '1 Song', tag: null });
    expect(splitTag('#1 Song')).toEqual({ title: '#1 Song', tag: null });
  });
});

// ---- Through the API: scan, list, filter, rename, backfill ----

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { libraryRoots, tracks } from '@baes/db';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { backfillTags } from '../src/library/tags.js';
import { makeWav } from './fixtures.js';

describe('tags API', () => {
  let app: FastifyInstance;
  let musicDir: string;
  let dataDir: string;
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    musicDir = await mkdtemp(path.join(tmpdir(), 'baes-tags-music-'));
    dataDir = await mkdtemp(path.join(tmpdir(), 'baes-tags-data-'));
    await writeFile(path.join(musicDir, `Artist One - ${STAR_VS} Song C.wav`), makeWav(0.5, 300));
    await writeFile(path.join(musicDir, `Artist One - ${STAR} Song D.wav`), makeWav(0.5, 500));
    await writeFile(path.join(musicDir, `Artist One - ${TROPHY} Song E.wav`), makeWav(0.5, 700));
    await writeFile(path.join(musicDir, 'Artist One - Plain Song.wav'), makeWav(0.5, 900));
    app = await buildApp(
      loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: 'pglite:memory',
        DATA_DIR: dataDir,
      }),
    );
    token = (
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
  });

  afterAll(async () => {
    await app.close();
    await rm(musicDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('scanned titles come out clean, with the emoji as a tag', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/tracks', headers: auth() })).json();
    const byTitle = Object.fromEntries(list.tracks.map((t: any) => [t.title, t.tag]));
    expect(byTitle).toEqual({
      'Song C': STAR,
      'Song D': STAR,
      'Song E': TROPHY,
      'Plain Song': null,
    });
  });

  it('lists tags with counts and default labels', async () => {
    const res = (await app.inject({ method: 'GET', url: '/api/tags', headers: auth() })).json();
    expect(res.tags).toEqual([
      { tag: STAR, count: 2, label: 'Best of' },
      { tag: TROPHY, count: 1, label: 'Grail' },
    ]);
  });

  it('filters tracks by tag, in either spelling', async () => {
    for (const spelling of [STAR, STAR_VS]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/tracks?tag=${encodeURIComponent(spelling)}`,
        headers: auth(),
      });
      expect(
        res
          .json()
          .tracks.map((t: any) => t.title)
          .sort(),
      ).toEqual(['Song C', 'Song D']);
    }
  });

  it('lets the owner rename a tag', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/tags/${encodeURIComponent(TROPHY)}`,
      headers: auth(),
      payload: { label: 'Holy grail' },
    });
    expect(put.statusCode).toBe(204);
    const res = (await app.inject({ method: 'GET', url: '/api/tags', headers: auth() })).json();
    expect(res.tags.find((t: any) => t.tag === TROPHY).label).toBe('Holy grail');
  });

  it('backfills titles stored before tags existed', async () => {
    // Simulate an old row: emoji still in the title, no tag.
    const { db: conn, close } = await createDb('pglite:memory');
    try {
      const [root] = await conn.insert(libraryRoots).values({ path: '/tmp/x' }).returning();
      const [row] = await conn
        .insert(tracks)
        .values({
          rootId: root!.id,
          relPath: 'old.mp3',
          contentHash: 'h',
          title: `${SPARKLES} Old Song`,
          durationMs: 1000,
          codec: 'mp3',
        })
        .returning();
      expect(await backfillTags(conn)).toBe(1);
      const [after] = await conn.select().from(tracks).where(eq(tracks.id, row!.id));
      expect(after).toMatchObject({
        title: 'Old Song',
        tag: SPARKLES,
        rawTitle: `${SPARKLES} Old Song`,
      });
      expect(await backfillTags(conn)).toBe(0); // idempotent
    } finally {
      await close();
    }
  });
});
