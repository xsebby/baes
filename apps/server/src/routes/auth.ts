import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { invites, sessions, users } from '@baes/db';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { generateToken } from '../auth/tokens.js';
import type { Database } from '../db.js';
import type { Config } from '../config.js';

const credentialsSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'letters, numbers, _ . - only'),
  password: z.string().min(10).max(256),
  deviceName: z.string().max(64).optional(),
});

const redeemSchema = credentialsSchema.extend({ token: z.string().min(1) });

/**
 * Per-account lockout on top of the per-IP rate limit: an attacker rotating
 * IPs still gets only LOCKOUT_FAILURES guesses per account per window. In
 * memory (one server process); a restart clears it, which is fine.
 */
const LOCKOUT_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

class LoginLockout {
  private failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

  /** Milliseconds until `username` may try again, or 0. */
  lockedFor(username: string, now = Date.now()): number {
    const f = this.failures.get(username.toLowerCase());
    return f && f.lockedUntil > now ? f.lockedUntil - now : 0;
  }

  fail(username: string, now = Date.now()): void {
    const key = username.toLowerCase();
    const f = this.failures.get(key);
    if (!f || now - f.firstAt > LOCKOUT_WINDOW_MS) {
      this.failures.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    } else if (++f.count >= LOCKOUT_FAILURES) {
      f.lockedUntil = now + LOCKOUT_WINDOW_MS;
    }
    if (this.failures.size > 10_000) this.prune(now);
  }

  succeed(username: string): void {
    this.failures.delete(username.toLowerCase());
  }

  private prune(now: number): void {
    for (const [k, f] of this.failures) {
      if (f.lockedUntil < now && now - f.firstAt > LOCKOUT_WINDOW_MS) this.failures.delete(k);
    }
  }
}

interface RouteOpts {
  db: Database;
  config: Config;
}

export const authRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
  const sessionTtlMs = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const lockout = new LoginLockout();

  async function createSession(userId: string, deviceName: string | undefined) {
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await db.insert(sessions).values({
      userId,
      tokenHash,
      deviceName: deviceName ?? 'unknown',
      expiresAt,
    });
    return { token, expiresAt };
  }

  function userDto(u: typeof users.$inferSelect) {
    return { id: u.id, username: u.username, role: u.role, canDownload: u.canDownload };
  }

  /** Public: lets the sign-in page offer owner setup only on a brand-new server. */
  app.get('/api/auth/status', async () => {
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return { needsSetup: (countRow?.count ?? 0) === 0 };
  });

  // First-run bootstrap: creates the owner account. Only works while zero users exist.
  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = credentialsSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
      }
      const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
      if ((countRow?.count ?? 0) > 0) {
        return reply
          .code(403)
          .send({ error: 'already_setup', message: 'Server already has an owner account' });
      }
      const pwHash = await hashPassword(body.data.password);
      const [user] = await db
        .insert(users)
        .values({ username: body.data.username, pwHash, role: 'owner' })
        .returning();
      const { token, expiresAt } = await createSession(user!.id, body.data.deviceName);
      return reply
        .code(201)
        .send({ token, user: userDto(user!), expiresAt: expiresAt.toISOString() });
    },
  );

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = credentialsSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
      }
      const wait = lockout.lockedFor(body.data.username);
      if (wait > 0) {
        return reply
          .code(429)
          .header('retry-after', String(Math.ceil(wait / 1000)))
          .send({
            error: 'locked',
            message: `Too many failed logins; try again in ${Math.ceil(wait / 60000)} min`,
          });
      }
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, body.data.username))
        .limit(1);
      // Verify against a dummy hash when the user is unknown so response timing
      // doesn't reveal which usernames exist.
      const ok = user
        ? await verifyPassword(user.pwHash, body.data.password)
        : (await hashPassword('timing-equalizer'), false);
      if (!user || !ok) {
        // Unknown usernames count too, so lockout doesn't reveal which exist.
        lockout.fail(body.data.username);
        return reply
          .code(401)
          .send({ error: 'invalid_credentials', message: 'Wrong username or password' });
      }
      lockout.succeed(body.data.username);
      const { token, expiresAt } = await createSession(user.id, body.data.deviceName);
      return { token, user: userDto(user), expiresAt: expiresAt.toISOString() };
    },
  );

  app.post('/api/auth/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, req.authUser!.sessionId));
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (req) => {
    const u = req.authUser!;
    return { id: u.id, username: u.username, role: u.role, canDownload: u.canDownload };
  });

  app.post(
    '/api/auth/invite/redeem',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = redeemSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
      }
      const [invite] = await db
        .select()
        .from(invites)
        .where(and(eq(invites.token, body.data.token), isNull(invites.usedBy)))
        .limit(1);
      if (!invite || invite.expiresAt < new Date()) {
        return reply
          .code(400)
          .send({ error: 'invalid_invite', message: 'Invite is invalid, used, or expired' });
      }
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, body.data.username))
        .limit(1);
      if (existing) {
        return reply
          .code(409)
          .send({ error: 'username_taken', message: 'Username is already taken' });
      }
      const pwHash = await hashPassword(body.data.password);
      const [user] = await db
        .insert(users)
        .values({ username: body.data.username, pwHash, role: invite.role })
        .returning();
      await db.update(invites).set({ usedBy: user!.id }).where(eq(invites.token, invite.token));
      const { token, expiresAt } = await createSession(user!.id, body.data.deviceName);
      return reply
        .code(201)
        .send({ token, user: userDto(user!), expiresAt: expiresAt.toISOString() });
    },
  );
};
