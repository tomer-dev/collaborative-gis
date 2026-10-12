import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` only: it diffs the schema against drizzle/meta and needs no database.
// Migrations are applied by src/db/migrate.ts (`pnpm db:migrate`), never by drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/schema.ts', './src/db/auth-schema.ts'],
  out: './drizzle',
});
