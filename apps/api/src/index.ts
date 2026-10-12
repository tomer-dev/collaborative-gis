import { createApp, type Env } from './app';

export { Room } from './do/room';

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
