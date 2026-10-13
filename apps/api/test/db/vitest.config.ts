import { defineProject } from 'vitest/config';

// Schema and migration tests run in Node, not workerd: migrate() reads apps/api/drizzle from disk.
// They use the db lane's own database (cgis_db_<lane>), created, reset and migrated by
// global-setup.ts.
export default defineProject({
  test: {
    name: 'db',
    include: ['**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./global-setup.ts'],
  },
});
