import { createApp, type Env } from './app';
import { scheduled } from './scheduled';

export { Room } from './do/room';
export { RateLimiter } from './do/rate-limiter';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
