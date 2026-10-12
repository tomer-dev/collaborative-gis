import { GetSessionResponseSchema } from '@cgis/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { apiGet, ApiRequestError } from './api';

function stubFetch(response: () => Promise<Response>) {
  const fetchMock = vi.fn(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('GETs a same-origin JSON path and returns the schema-parsed body', async () => {
  const fetchMock = stubFetch(async () =>
    Response.json({ user: { id: 'user_1', name: 'Ada', email: 'ada@example.com' } }),
  );

  await expect(apiGet('/api/auth/get-session', GetSessionResponseSchema)).resolves.toEqual({
    user: { id: 'user_1', name: 'Ada' },
  });
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/get-session', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
});

it('rejects a 2xx body that does not match the schema', async () => {
  stubFetch(async () => Response.json({ user: { id: 42 } }));

  await expect(apiGet('/api/auth/get-session', GetSessionResponseSchema)).rejects.toThrow();
});

it('rejects a 2xx body that is not JSON', async () => {
  stubFetch(async () => new Response('<!doctype html>', { status: 200 }));

  await expect(apiGet('/api/auth/get-session', GetSessionResponseSchema)).rejects.toThrow();
});

it('maps a non-2xx ApiError body onto ApiRequestError', async () => {
  stubFetch(async () =>
    Response.json({ code: 'NOT_IMPLEMENTED', message: 'not implemented' }, { status: 501 }),
  );

  const error = await apiGet('/api/auth/get-session', GetSessionResponseSchema).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({
    status: 501,
    body: { code: 'NOT_IMPLEMENTED', message: 'not implemented' },
    message: 'not implemented',
  });
});

it('keeps the status when a non-2xx body is not an ApiError', async () => {
  stubFetch(async () => new Response('Bad Gateway', { status: 502 }));

  const error = await apiGet('/api/auth/get-session', GetSessionResponseSchema).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({ status: 502, body: null });
});
