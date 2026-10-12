// Node-only (reads apps/api/drizzle from disk); the Worker never imports this file.
// CLI: `DATABASE_URL=<direct URL> pnpm --filter @cgis/api db:migrate`. Never a Hyperdrive URL:
// Hyperdrive is the Worker's runtime path only; migrations go to the database directly.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies the migrations in apps/api/drizzle that `url` has not seen yet, in one transaction.
 * Already-applied migrations (recorded in drizzle.__drizzle_migrations) are skipped, so a rerun is a no-op.
 */
export async function migrate(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await applyMigrations(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (use the direct database URL, not Hyperdrive)');
    process.exit(1);
  }
  await migrate(url);
  console.log('migrations applied');
}
