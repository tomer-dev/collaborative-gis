import type { Area, AreaCreate, AreaList, AreaUpdate } from '@cgis/shared';
import { hc, type InferRequestType, type InferResponseType } from 'hono/client';
import type { JSONValue } from 'hono/utils/types';
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

  // `apiError` types each response with its code's one status, so a status narrows the body.
  it('types the success responses with their status alone', () => {
    expectTypeOf<InferResponseType<Areas['$post'], 201>>().toEqualTypeOf<Area>();
    expectTypeOf<InferResponseType<Areas['$get'], 200>>().toEqualTypeOf<AreaList>();
    expectTypeOf<InferResponseType<One['$put'], 200>>().toEqualTypeOf<Area>();
  });

  // ApiError as JSON: Hono types `details: unknown` as any JSON value.
  type ErrorBody = { code: string; message: string; details?: JSONValue };

  it('types the error responses as ApiError bodies under their own status', () => {
    expectTypeOf<InferResponseType<Areas['$post'], 422>>().toEqualTypeOf<ErrorBody>();
    expectTypeOf<InferResponseType<One['$put'], 404>>().toEqualTypeOf<ErrorBody>();
    expectTypeOf<InferResponseType<One['$put'], 409>>().toEqualTypeOf<ErrorBody>();
  });
});
