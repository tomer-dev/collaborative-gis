# ADR-0002: Hono instead of Fastify

Date: 2026-10-12 · Status: accepted

## Context
Workers execute fetch handlers on workerd; Fastify needs a Node HTTP server. Hono is web-standard, runs on Workers and Node, ships an official agent skill and a CLI that tests the app in-process with local bindings.

## Decision
Build the API with Hono, validate with Zod via `hono-openapi`, document with OpenAPI 3.1, test with `hono batch` and `@cloudflare/vitest-plugin`.

## Consequences
No controllers; routes grouped with `app.route`; shared types through the `hc` client. WebSocket upgrades are forwarded to the Durable Object rather than handled by Hono's helper.
