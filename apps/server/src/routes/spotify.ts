import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { externalAccounts } from '@baes/db';
import type { Database } from '../db.js';
import type { Config } from '../config.js';
import { encryptSecret } from '../spotify/crypto.js';
import type { SpotifySync } from '../spotify/sync.js';

const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative';

interface RouteOpts {
  db: Database;
  config: Config;
  sync: SpotifySync;
}

interface PendingAuth {
  verifier: string;
  userId: string;
  expiresAt: number;
}

export const spotifyRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config, sync }) => {
  const pending = new Map<string, PendingAuth>();

  function redirectUri(): string {
    return `${config.PUBLIC_URL ?? ''}/spotify/callback`;
  }

  app.get('/api/spotify/status', { preHandler: app.requireAuth }, async (req) => {
    const configured = Boolean(config.SPOTIFY_CLIENT_ID && config.PUBLIC_URL);
    const [account] = await db
      .select({ lastSyncAt: externalAccounts.lastSyncAt })
      .from(externalAccounts)
      .where(
        and(
          eq(externalAccounts.userId, req.authUser!.id),
          eq(externalAccounts.provider, 'spotify'),
        ),
      )
      .limit(1);
    return {
      configured,
      connected: Boolean(account),
      lastSyncAt: account?.lastSyncAt?.toISOString() ?? null,
      sync: sync.getStatus(),
    };
  });

  // Begin PKCE flow: returns the authorize URL the client should open.
  app.post('/api/spotify/auth-start', { preHandler: app.requireAuth }, async (req, reply) => {
    if (!config.SPOTIFY_CLIENT_ID || !config.PUBLIC_URL) {
      return reply.code(503).send({
        error: 'not_configured',
        message: 'Set SPOTIFY_CLIENT_ID and PUBLIC_URL on the server first',
      });
    }
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    pending.set(state, {
      verifier,
      userId: req.authUser!.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    for (const [k, v] of pending) if (v.expiresAt < Date.now()) pending.delete(k);

    const url = new URL('https://accounts.spotify.com/authorize');
    url.searchParams.set('client_id', config.SPOTIFY_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('state', state);
    return { url: url.toString() };
  });

  // Spotify redirects here; the state token carries the user identity.
  app.get('/spotify/callback', async (req, reply) => {
    const { code, state, error } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    const entry = state ? pending.get(state) : undefined;
    if (state) pending.delete(state);
    if (error || !code || !entry || entry.expiresAt < Date.now()) {
      return reply.redirect('/?spotify=error');
    }

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: config.SPOTIFY_CLIENT_ID!,
        code_verifier: entry.verifier,
      }),
    });
    if (!res.ok) {
      req.log.error({ status: res.status }, 'spotify token exchange failed');
      return reply.redirect('/?spotify=error');
    }
    const body = (await res.json()) as { refresh_token: string; scope: string };

    const enc = encryptSecret(config.SERVER_SECRET, body.refresh_token);
    const [existing] = await db
      .select({ id: externalAccounts.id })
      .from(externalAccounts)
      .where(
        and(eq(externalAccounts.userId, entry.userId), eq(externalAccounts.provider, 'spotify')),
      )
      .limit(1);
    if (existing) {
      await db
        .update(externalAccounts)
        .set({ refreshTokenEnc: enc, scopes: body.scope })
        .where(eq(externalAccounts.id, existing.id));
    } else {
      await db.insert(externalAccounts).values({
        userId: entry.userId,
        provider: 'spotify',
        refreshTokenEnc: enc,
        scopes: body.scope,
      });
    }

    sync.start(entry.userId);
    return reply.redirect('/?spotify=connected');
  });

  app.post('/api/spotify/sync', { preHandler: app.requireAuth }, async (req, reply) => {
    const started = sync.start(req.authUser!.id);
    return reply.code(started ? 202 : 409).send(sync.getStatus());
  });

  app.delete('/api/spotify/link', { preHandler: app.requireAuth }, async (req, reply) => {
    await db
      .delete(externalAccounts)
      .where(
        and(
          eq(externalAccounts.userId, req.authUser!.id),
          eq(externalAccounts.provider, 'spotify'),
        ),
      );
    return reply.code(204).send();
  });
};
