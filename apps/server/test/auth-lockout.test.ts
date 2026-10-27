import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

// Its own app so failed logins here can't affect other auth tests. Stays under
// the per-IP rate limit (10/min) so it's the lockout being tested.
let app: FastifyInstance;
const OWNER = { username: 'owner', password: 'correct-horse-battery' };

const login = (username: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

beforeAll(async () => {
  app = await buildApp(
    loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: 'pglite:memory' }),
  );
  await app.inject({ method: 'POST', url: '/api/auth/setup', payload: OWNER });
});

afterAll(async () => {
  await app.close();
});

describe('login lockout', () => {
  it('locks an account after 5 failures, even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('owner', 'wrong-password-' + i)).statusCode).toBe(401);
    }
    const res = await login('owner', OWNER.password);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('locked');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(800);
  });

  it('is per account and case-insensitive', async () => {
    expect((await login('OWNER', OWNER.password)).statusCode).toBe(429);
    // A different (unknown) account isn't affected by owner's lockout.
    expect((await login('someone', 'whatever-password')).statusCode).toBe(401);
  });
});
