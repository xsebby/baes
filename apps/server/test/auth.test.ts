import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

const OWNER = { username: 'xsebby', password: 'super-secret-pass-1' };

beforeAll(async () => {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite:memory',
  });
  app = await buildApp(config);
});

afterAll(async () => {
  await app.close();
});

describe('auth flow', () => {
  let ownerToken: string;

  it('health endpoint responds without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('rejects protected routes without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('bootstraps the owner account via setup', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: OWNER });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.role).toBe('owner');
    expect(body.token).toBeTruthy();
    ownerToken = body.token;
  });

  it('refuses a second setup once an owner exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'intruder', password: 'whatever-password-1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects wrong passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: OWNER.username, password: 'wrong-password-123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logs in with correct credentials', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: OWNER });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('returns the current user for a valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(OWNER.username);
  });

  it('rejects short passwords on setup/login validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: OWNER.username, password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('invites', () => {
    let inviteToken: string;
    let listenerToken: string;

    it('owner can create an invite', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/invites',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { role: 'listener' },
      });
      expect(res.statusCode).toBe(201);
      inviteToken = res.json().token;
      expect(inviteToken).toBeTruthy();
    });

    it('invite can be redeemed exactly once', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/invite/redeem',
        payload: { token: inviteToken, username: 'friend', password: 'friend-password-1' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().user.role).toBe('listener');
      listenerToken = res.json().token;

      const again = await app.inject({
        method: 'POST',
        url: '/api/auth/invite/redeem',
        payload: { token: inviteToken, username: 'friend2', password: 'friend-password-2' },
      });
      expect(again.statusCode).toBe(400);
    });

    it('listener cannot create invites', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/invites',
        headers: { authorization: `Bearer ${listenerToken}` },
        payload: { role: 'listener' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('sessions', () => {
    it('logout revokes the session token', async () => {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: OWNER });
      const token = login.json().token;

      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(logout.statusCode).toBe(204);

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(401);
    });

    it('rejects garbage tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
