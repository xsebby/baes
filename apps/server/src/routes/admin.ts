import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { invites, libraryRoots, users } from '@baes/db';
import { generateInviteToken } from '../auth/tokens.js';
import type { LibraryScanner } from '../library/scanner.js';
import { validateRootPath } from '../library/scanner.js';
import type { Database } from '../db.js';
import type { Config } from '../config.js';

const createInviteSchema = z.object({
  role: z.enum(['owner', 'listener']).default('listener'),
});

const createRootSchema = z.object({
  path: z.string().min(1),
});

interface RouteOpts {
  db: Database;
  config: Config;
  scanner: LibraryScanner;
}

export const adminRoutes: FastifyPluginAsync<RouteOpts> = async (app, { db, config, scanner }) => {
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

  app.get('/api/admin/roots', { preHandler: app.requireOwner }, async () => {
    const roots = await db.select().from(libraryRoots);
    return { roots };
  });

  app.post('/api/admin/roots', { preHandler: app.requireOwner }, async (req, reply) => {
    const body = createRootSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    }
    const problem = await validateRootPath(body.data.path);
    if (problem) {
      return reply.code(400).send({ error: 'invalid_path', message: problem });
    }
    const [root] = await db
      .insert(libraryRoots)
      .values({ path: body.data.path })
      .onConflictDoNothing()
      .returning();
    if (!root) {
      return reply.code(409).send({ error: 'duplicate', message: 'Root already exists' });
    }
    return reply.code(201).send({ root });
  });

  app.delete('/api/admin/roots/:id', { preHandler: app.requireOwner }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(libraryRoots).set({ enabled: false }).where(eq(libraryRoots.id, id));
    return reply.code(204).send();
  });

  app.post('/api/admin/scan', { preHandler: app.requireOwner }, async (req, reply) => {
    const force = Boolean((req.body as { force?: boolean } | null)?.force);
    const started = scanner.start(force);
    return reply.code(started ? 202 : 409).send(scanner.getStatus());
  });

  app.get('/api/admin/scan/status', { preHandler: app.requireOwner }, async () =>
    scanner.getStatus(),
  );

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
