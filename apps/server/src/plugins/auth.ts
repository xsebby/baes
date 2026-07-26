import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { sessions, users } from '@baes/db';
import { hashToken } from '../auth/tokens.js';
import type { Database } from '../db.js';

export interface AuthUser {
  id: string;
  username: string;
  role: 'owner' | 'listener';
  canDownload: boolean;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOwner: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.decorateRequest('authUser', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const tokenHash = hashToken(header.slice('Bearer '.length));

    const rows = await db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        username: users.username,
        role: users.role,
        canDownload: users.canDownload,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return;
    req.authUser = {
      id: row.userId,
      username: row.username,
      role: row.role,
      canDownload: row.canDownload,
      sessionId: row.sessionId,
    };
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
    }
  });

  app.decorate('requireOwner', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
      return;
    }
    if (req.authUser.role !== 'owner') {
      await reply.code(403).send({ error: 'forbidden', message: 'Owner role required' });
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
