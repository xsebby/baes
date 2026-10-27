import { chmod, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { writeFixtureLibrary } from './fixtures.js';

// A stand-in for baes-fingerprint's `fp`: `index` appends file names to the
// "index" (a text file), `query` answers from a script keyed by file name.
// Song A and Song B are the same recording; the demo resembles A, weakly.
const FAKE_FP = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const [cmd, db, ...rest] = process.argv.slice(2);
if (cmd === 'index') {
  fs.appendFileSync(db, rest.map((f) => f + '\\n').join(''));
  fs.appendFileSync(db + '.calls', 'index ' + rest.length + '\\n');
  process.exit(0);
}
const file = rest[0];
const indexed = fs.readFileSync(db, 'utf8').split('\\n').filter(Boolean);
const byBase = (b) => indexed.find((f) => path.basename(f) === b);
const script = {
  'Artist One - Song A.wav': [['Artist One - Song A.wav', 900], ['Artist One - Song B.wav', 240], ['untitled_demo_v2.wav', 11]],
  'Artist One - Song B.wav': [['Artist One - Song B.wav', 880], ['Artist One - Song A.wav', 251]],
  'untitled_demo_v2.wav': [['untitled_demo_v2.wav', 700]],
};
const matches = (script[path.basename(file)] || [])
  .map(([b, votes]) => ({ name: byBase(b), votes, offset_s: 0 }))
  .filter((m) => m.name && m.votes >= 60);
process.stdout.write(JSON.stringify({ match: matches[0] ? matches[0].name : null, matches }) + '\\n');
process.exit(matches.length ? 0 : 1);
`;

let app: FastifyInstance;
let musicDir: string;
let dataDir: string;
let token: string;
const auth = () => ({ authorization: `Bearer ${token}` });

async function scanAndWait() {
  await app.inject({ method: 'POST', url: '/api/admin/scan', headers: auth() });
  for (let i = 0; i < 200; i++) {
    const scan = (
      await app.inject({ method: 'GET', url: '/api/admin/scan/status', headers: auth() })
    ).json();
    const dup = (
      await app.inject({ method: 'GET', url: '/api/admin/duplicates', headers: auth() })
    ).json();
    if (!scan.running && scan.finishedAt && !dup.status.running && dup.status.lastRunAt) return dup;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('scan + duplicate detection did not finish');
}

beforeAll(async () => {
  musicDir = await mkdtemp(path.join(tmpdir(), 'baes-dup-music-'));
  dataDir = await mkdtemp(path.join(tmpdir(), 'baes-dup-data-'));
  await writeFixtureLibrary(musicDir);
  const fp = path.join(dataDir, 'fake-fp');
  await writeFile(fp, FAKE_FP);
  await chmod(fp, 0o755);

  app = await buildApp(
    loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite:memory',
      DATA_DIR: dataDir,
      FP_BIN: fp,
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
});

afterAll(async () => {
  await app.close();
  await rm(musicDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

describe('duplicate recordings', () => {
  it('groups tracks the fingerprinter matches strongly, ignoring weak matches', async () => {
    const dup = await scanAndWait();
    expect(dup.status.enabled).toBe(true);
    expect(dup.status.fingerprinted).toBe(3);
    expect(dup.groups).toHaveLength(1);
    const names = dup.groups[0].tracks.map((t: any) => t.fileName).sort();
    expect(names).toEqual(['Artist One - Song A.wav', 'Artist One - Song B.wav']);
    expect(dup.groups[0].strongest).toBe(251);
    expect(dup.groups[0].tracks[0].streamUrl).toContain('/api/stream/');
  });

  it('a rescan with nothing new does not re-fingerprint', async () => {
    await scanAndWait();
    const calls = await import('node:fs').then((fs) =>
      fs.readFileSync(path.join(dataDir, 'fingerprints.fpdb.calls'), 'utf8').trim().split('\n'),
    );
    expect(calls).toEqual(['index 3']);
  });

  it('dismissing a group keeps it hidden across rescans', async () => {
    const before = (
      await app.inject({ method: 'GET', url: '/api/admin/duplicates', headers: auth() })
    ).json();
    const ids = before.groups[0].tracks.map((t: any) => t.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/duplicates/dismiss',
      headers: auth(),
      payload: { trackIds: ids },
    });
    expect(res.statusCode).toBe(204);
    const after = await scanAndWait();
    expect(after.groups).toHaveLength(0);
  });

  it('deleting a fingerprinted file rebuilds the index', async () => {
    await unlink(path.join(musicDir, 'album1', 'Artist One - Song B.wav'));
    const dup = await scanAndWait();
    expect(dup.status.fingerprinted).toBe(2);
    const fs = await import('node:fs');
    const indexed = fs.readFileSync(path.join(dataDir, 'fingerprints.fpdb'), 'utf8');
    expect(indexed).not.toContain('Song B');
    expect(dup.groups).toHaveLength(0);
  });

  it('is owner-only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/duplicates' });
    expect(res.statusCode).toBe(401);
  });
});
