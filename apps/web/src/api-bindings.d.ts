/**
 * `lib/api-client.ts` types the Hono client from the api's `AppType`, so this program also
 * type-checks the api's route modules. They name `CloudflareBindings`, a global that
 * `wrangler types` generates into apps/api/worker-configuration.d.ts next to the Workers runtime
 * types, which clash with the DOM lib and stay out of the SPA. Here the bindings are opaque: the
 * client reads only the route schema, and the bindings never reach the browser.
 */
interface CloudflareBindings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- server-only values the SPA never reads
  readonly [binding: string]: any;
}
