import { env } from 'cloudflare:workers';
import pg from 'pg';
import type { Env } from '../../src/app';

declare global {
  interface ImportMeta {
    // Vite's glob import; vitest inlines the files before workerd runs the test (no vite/client types here).
    glob<T>(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, T>;
  }
}

/** Every migration in apps/api/drizzle, keyed by path; NNNN_ names sort in journal order. */
const MIGRATIONS = Object.entries(
  import.meta.glob<string>('../../drizzle/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).sort(([a], [b]) => a.localeCompare(b));

/**
 * The test env with `HYPERDRIVE` pointed at the lane database `name` (created and migrated on
 * first use). Pass it to `createApp().request(path, init, laneEnv)` and to `getSessionUser`.
 *
 * Does in workerd what `scripts/db-lane.sh` + `db:migrate` do in Node, since a workerd test can
 * neither run bash nor read SQL files from disk: creates `name` on the server behind
 * `env.HYPERDRIVE` (the compose PostGIS, or CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE)
 * and applies every `drizzle/*.sql` file in order. The database is rebuilt only when the
 * migrations change (their hash is kept as the database comment), so test files sharing a lane
 * database never reset it under each other.
 */
export async function laneEnv(name: string): Promise<Env> {
  const url = databaseUrl(name);
  await withPg(env.HYPERDRIVE.connectionString, (admin) => createDatabase(admin, name));
  await withPg(url, (client) => migrate(client, name));
  return { ...env, HYPERDRIVE: { connectionString: url } as Hyperdrive };
}

function databaseUrl(name: string): string {
  const url = new URL(env.HYPERDRIVE.connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createDatabase(admin: pg.Client, name: string): Promise<void> {
  const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
  if (exists.rowCount) return;
  // A concurrent test file may win the race; the database existing afterwards is what counts. The
  // loser gets 42P04 (duplicate_database), or 23505 (unique_violation on pg_database's name index)
  // when both inserts are in flight at once, as on a fresh server.
  await admin.query(`create database "${name}"`).catch((err: { code?: string }) => {
    if (err.code !== '42P04' && err.code !== '23505') throw err;
  });
}

async function migrate(client: pg.Client, name: string): Promise<void> {
  const hash = await sha256(MIGRATIONS.map(([path, sql]) => `${path}\n${sql}`).join('\n'));
  // Serialises concurrent test files: the first rebuilds, the others then see the same hash.
  await client.query('select pg_advisory_lock(hashtext($1))', [name]);
  try {
    const { rows } = await client.query<{ hash: string | null }>(
      "select shobj_description(oid, 'pg_database') as hash from pg_database where datname = $1",
      [name],
    );
    if (rows[0]?.hash === hash) return;
    await client.query('begin');
    await client.query('drop schema if exists drizzle cascade');
    await client.query('drop schema public cascade');
    await client.query('create schema public');
    // A drizzle file is plain SQL: its `--> statement-breakpoint` markers are comments.
    for (const [, sql] of MIGRATIONS) await client.query(sql);
    await client.query(`comment on database "${name}" is '${hash}'`);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
  }
}

async function withPg<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  // workerd reports the socket closing after end() as an error event; nothing to act on here.
  client.on('error', () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
