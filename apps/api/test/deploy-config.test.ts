import { describe, expectTypeOf, it } from 'vitest';

// Bindings, vars and secrets are not inherited by a wrangler environment, so `env.production` in
// wrangler.jsonc repeats them. `wrangler types` (run by `pnpm typecheck`) generates
// `CloudflareBindings` from the top level and `Cloudflare.ProductionEnv` from env.production; this
// assertion fails the typecheck when one of them gains a binding the other lacks.
describe('wrangler env.production', () => {
  it('declares the same bindings, vars and secrets as the top level', () => {
    expectTypeOf<keyof Cloudflare.ProductionEnv>().toEqualTypeOf<keyof CloudflareBindings>();
  });
});
