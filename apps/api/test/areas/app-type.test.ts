import type { Area, AreaCreate, AreaList, AreaUpdate } from '@cgis/shared';
import { hc, type InferRequestType, type InferResponseType } from 'hono/client';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AppType } from '../../src/app';

// D19: the SPA's `hc` client is typed from AppType. The expectTypeOf checks are compile-time
// (pnpm typecheck); at run time only the URL test does anything.
type Client = ReturnType<typeof hc<AppType>>;
type Areas = Client['api']['areas'];
type One = Areas[':id'];

describe('AppType (D19)', () => {
  it('builds the area URLs', () => {
    const client = hc<AppType>('http://localhost');
    expect(client.api.areas.$url().pathname).toBe('/api/areas');
    expect(client.api.areas[':id'].$url({ param: { id: 'abc' } }).pathname).toBe('/api/areas/abc');
  });

  it('types the request bodies, query and params of the area routes', () => {
    expectTypeOf<InferRequestType<Areas['$post']>['json']>().toEqualTypeOf<AreaCreate>();
    // Hono types every query value as `string | string[]`; the server parses `bbox` with Zod.
    expectTypeOf<string>().toMatchTypeOf<InferRequestType<Areas['$get']>['query']['bbox']>();
    expectTypeOf<InferRequestType<One['$put']>['json']>().toEqualTypeOf<AreaUpdate>();
    expectTypeOf<InferRequestType<One['$delete']>['param']>().toEqualTypeOf<{ id: string }>();
  });

  // `apiError` types its status as any ContentfulStatusCode, so each status also admits ApiError;
  // the success body is the member that is not an ApiError.
  type Success<T> = Exclude<T, { code: string }>;

  it('types the success responses', () => {
    expectTypeOf<Success<InferResponseType<Areas['$post'], 201>>>().toEqualTypeOf<Area>();
    expectTypeOf<Success<InferResponseType<Areas['$get'], 200>>>().toEqualTypeOf<AreaList>();
    expectTypeOf<Success<InferResponseType<One['$put'], 200>>>().toEqualTypeOf<Area>();
  });
});
