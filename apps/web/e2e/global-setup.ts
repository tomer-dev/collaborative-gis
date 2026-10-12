import { execFileSync } from 'node:child_process';
import { laneDatabaseUrl, REPO_ROOT } from './stack';

// Dropping `public` also drops PostGIS; 0000_postgis.sql reinstalls it.
const RESET_SQL =
  'drop schema if exists drizzle cascade; drop schema public cascade; create schema public';

/**
 * Empties the e2e lane database and migrates it from scratch, so each run starts without users or
 * areas (as apps/api/test/db/global-setup.ts does for cgis_db). Playwright runs this after it has
 * started the servers; the Worker opens database connections per request, so none are open yet.
 */
export default function globalSetup(): void {
  const url = laneDatabaseUrl();
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-c', RESET_SQL], {
    env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['--filter', '@cgis/api', 'db:migrate'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
