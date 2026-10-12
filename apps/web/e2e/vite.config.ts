// Vite for the e2e run: the app's own config, with its /api and /ws proxy aimed at this run's
// Worker (apiOrigin(): DEV.API_ORIGIN unless E2E_API_PORT moves it).
import { ROUTES } from '@cgis/shared/constants';
import { mergeConfig } from 'vite';
import appConfig from '../vite.config.ts';
import { apiOrigin } from './stack.ts';

const api = apiOrigin();

export default mergeConfig(appConfig, {
  server: {
    proxy: {
      [ROUTES.API_PREFIX]: api,
      [ROUTES.WS]: { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
});
