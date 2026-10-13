import { ROUTES } from '@cgis/shared';
import { compileErrors, validate } from '@readme/openapi-parser';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app';

/** What `validate` accepts: any object; the validator itself is the check. */
const ApiDocumentSchema = z.custom<Exclude<Parameters<typeof validate>[0], string>>(
  (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
);

/** The part of an OpenAPI 3.1 document these assertions read. */
const DocumentSchema = z.object({
  openapi: z.string(),
  paths: z.record(
    z.string(),
    z.record(z.string(), z.object({ responses: z.record(z.string(), z.unknown()) })),
  ),
});

/** Every operation the app serves under `ROUTES.AREAS`, from Hono's own route table. */
function mountedAreaRoutes() {
  const methods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
  const routes = new Map<string, { method: string; path: string }>();
  for (const { method, path } of createApp().routes) {
    if (methods.has(method) && path.startsWith(ROUTES.AREAS)) {
      routes.set(`${method} ${path}`, { method, path });
    }
  }
  return routes;
}

/** `/api/areas/:id` → `/api/areas/{id}`, the OpenAPI path template. */
const openApiPath = (honoPath: string) => honoPath.replace(/:(\w+)/g, '{$1}');

async function fetchDocument() {
  const res = await SELF.fetch(`http://x${ROUTES.OPENAPI}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe(`GET ${ROUTES.OPENAPI}`, () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const raw = await fetchDocument();
    const doc = DocumentSchema.parse(raw);
    expect(doc.openapi).toMatch(/^3\.1\./);
    const result = await validate(ApiDocumentSchema.parse(raw));
    expect(result.valid, compileErrors(result)).toBe(true);
    expect(result.specification).toBe('OpenAPI');
    expect(result.warnings).toEqual([]);
  });

  it('documents the health probes: /healthz 200, /readyz 200 and 503', async () => {
    const doc = DocumentSchema.parse(await fetchDocument());
    expect(Object.keys(doc.paths[ROUTES.HEALTHZ]?.get?.responses ?? {})).toEqual(['200']);
    expect(Object.keys(doc.paths[ROUTES.READYZ]?.get?.responses ?? {})).toEqual(['200', '503']);
  });

  it('documents every mounted area route with 401 and 422, and 429 on the rate-limited mutations', async () => {
    const doc = DocumentSchema.parse(await fetchDocument());
    const routes = mountedAreaRoutes();
    // The four M1 operations at least; versions/revert join this list when they are mounted.
    expect([...routes.keys()]).toEqual(
      expect.arrayContaining([
        `GET ${ROUTES.AREAS}`,
        `POST ${ROUTES.AREAS}`,
        `PUT ${ROUTES.AREAS}${ROUTES.AREA_BY_ID}`,
        `DELETE ${ROUTES.AREAS}${ROUTES.AREA_BY_ID}`,
      ]),
    );
    for (const [route, { method, path }] of routes) {
      const operation = doc.paths[openApiPath(path)]?.[method.toLowerCase()];
      expect(operation, `${route} is not in the document`).toBeDefined();
      const statuses = Object.keys(operation?.responses ?? {});
      // Reads are not rate limited (D5 budget is spent by mutations only).
      const required = method === 'GET' ? ['401', '422'] : ['401', '422', '429'];
      expect(statuses, route).toEqual(expect.arrayContaining(required));
    }
  });
});
