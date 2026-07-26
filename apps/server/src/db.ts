import { createRequire } from 'node:module';
import path from 'node:path';
import * as schema from '@baes/db';

export type Database = ReturnType<
  typeof import('drizzle-orm/node-postgres').drizzle<typeof schema>
>;

const require = createRequire(import.meta.url);

function migrationsFolder(): string {
  return path.join(path.dirname(require.resolve('@baes/db/package.json')), 'drizzle');
}

/**
 * Connects to the configured database and runs pending migrations.
 * `pglite:<dir>` / `pglite:memory` use embedded Postgres (local dev + tests);
 * anything else is treated as a normal postgres:// URL.
 */
export async function createDb(databaseUrl: string): Promise<{
  db: Database;
  close: () => Promise<void>;
}> {
  if (databaseUrl.startsWith('pglite:')) {
    const target = databaseUrl.slice('pglite:'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = target === 'memory' ? new PGlite() : new PGlite(target);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return {
      db: db as unknown as Database,
      close: () => client.close(),
    };
  }

  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return {
    db,
    close: () => pool.end(),
  };
}
