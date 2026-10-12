import { DEV, ROUTES } from '@cgis/shared/constants';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  // The router plugin must run before react() so it can split route files.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    // Same-origin in dev: the SPA calls /api and /ws, Vite forwards them to `wrangler dev`.
    proxy: {
      [ROUTES.API_PREFIX]: DEV.API_ORIGIN,
      [ROUTES.WS]: { target: DEV.API_ORIGIN.replace(/^http/, 'ws'), ws: true },
    },
  },
});
