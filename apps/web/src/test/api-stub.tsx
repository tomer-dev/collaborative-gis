// Test helpers for the areas data layer: a fetch stand-in (the hc client calls the global
// `fetch`), area fixtures, a QueryClient wrapper and jsdom's missing modal-dialog API.
import type { Area, AreaVersion } from '@cgis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

export type StubRequest = { method: string; path: string; query: URLSearchParams; body: unknown };
export type StubHandler = (request: StubRequest) => Response | Promise<Response>;

/** Replaces the global `fetch` with `handler`; returns the list of requests it has received. */
export function stubApi(handler: StubHandler): StubRequest[] {
  const requests: StubRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const request = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        body,
      };
      requests.push(request);
      return handler(request);
    }),
  );
  return requests;
}

export const jsonResponse = (status: number, body: unknown) => Response.json(body, { status });
export const emptyResponse = (status: number) => new Response(null, { status });

/** A promise with its resolver, to hold a response until the test has looked at the pending state. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** 0.1° box at 32°N, about 104.9 km² (the T11 acceptance square), as a closed GeoJSON ring. */
export const SQUARE: Area['geometry']['coordinates'][0] = [
  [34.9, 32],
  [35, 32],
  [35, 32.1],
  [34.9, 32.1],
  [34.9, 32],
];

export function makeArea(id: string, overrides: Partial<Area> = {}): Area {
  return {
    id,
    name: 'Orchard',
    geometry: { type: 'Polygon', coordinates: [SQUARE] },
    areaKm2: 104.97,
    version: 1,
    createdBy: 'user_1',
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}

/** One saved version of `areaId`, as `GET /api/areas/:id/versions` lists it. */
export function makeVersion(
  areaId: string,
  version: number,
  overrides: Partial<AreaVersion> = {},
): AreaVersion {
  return {
    areaId,
    version,
    name: `Orchard v${version}`,
    geometry: { type: 'Polygon', coordinates: [SQUARE] },
    areaKm2: 104.97,
    changedBy: 'user_1abcdefghijkl',
    changedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}

export const AREA_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_ID = '00000000-0000-4000-8000-000000000002';

/** A QueryClient without retries (a failed call fails at once) and the provider wrapper for it. */
export function queryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** jsdom has HTMLDialogElement but no modal API; this stand-in covers what ui/Dialog calls. */
export function stubDialogModal() {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
