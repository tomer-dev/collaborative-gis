import { createApp, type Env } from './app';

export { Room } from './do/room';
export { RateLimiter } from './do/rate-limiter';

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
