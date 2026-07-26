import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { invites, users } from '@baes/db';
import { generateInviteToken } from '../auth/tokens.js';
import type { Database } from '../db.js';
import type { Config } from '../config.js';

const createInviteSchema = z.object({
  role: z.enum(['owner', 'listener']).default('listener'),
});

interface RouteOpts {
  db: Database;
  config: Config;
}

export const adminRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config }) => {
  app.post('/api/admin/invites', { preHandler: app.requireOwner }, async (req, reply) => {
    const body = createInviteSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + config.INVITE_TTL_HOURS * 60 * 60 * 1000);
    await db.insert(invites).values({
      token,
      createdBy: req.authUser!.id,
      role: body.data.role,
      expiresAt,
    });
    return reply
      .code(201)
      .send({ token, role: body.data.role, expiresAt: expiresAt.toISOString() });
  });

  app.get('/api/admin/users', { preHandler: app.requireOwner }, async () => {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        canDownload: users.canDownload,
        createdAt: users.createdAt,
      })
      .from(users);
    return { users: rows };
  });
};
