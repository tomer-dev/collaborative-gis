import { ERROR_CODES, ERROR_MESSAGES, QUERY } from '@cgis/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-client';
import { createQueryClient } from './query';

const notify = vi.hoisted(() => vi.fn());
vi.mock('./auth-client', () => ({ authClient: { $store: { notify } } }));

afterEach(() => {
  vi.resetAllMocks();
});

const unauthorized = () =>
  new ApiRequestError(401, {
    code: ERROR_CODES.UNAUTHORIZED,
    message: ERROR_MESSAGES.UNAUTHORIZED,
  });
const internal = () =>
  new ApiRequestError(500, { code: ERROR_CODES.INTERNAL, message: ERROR_MESSAGES.INTERNAL });

it('a 401 from a query asks Better Auth to check the session again, without a retry', async () => {
  const client = createQueryClient();
  const queryFn = vi.fn(() => Promise.reject(unauthorized()));
  await expect(client.fetchQuery({ queryKey: ['t'], queryFn })).rejects.toThrow();
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith('$sessionSignal');
});

it('a 401 from a mutation does the same', async () => {
  const client = createQueryClient();
  const mutation = client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(unauthorized()) });
  await expect(mutation.execute(undefined)).rejects.toThrow();
  expect(notify).toHaveBeenCalledWith('$sessionSignal');
});

it('other failures keep the default retries and leave the session alone', async () => {
  const client = createQueryClient();
  const retry = client.getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') throw new Error('retry is not a function');
  expect(retry(0, unauthorized())).toBe(false);
  expect(retry(0, internal())).toBe(true);
  expect(retry(QUERY.RETRY_LIMIT, internal())).toBe(false);

  const queryFn = vi.fn(() => Promise.reject(internal()));
  await expect(client.fetchQuery({ queryKey: ['t'], queryFn, retry: false })).rejects.toThrow();
  expect(notify).not.toHaveBeenCalled();
});
