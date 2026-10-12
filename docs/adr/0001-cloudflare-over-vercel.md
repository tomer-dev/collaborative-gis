# ADR-0001: Cloudflare Workers + Durable Objects instead of Vercel

Date: 2026-10-12 · Status: accepted

## Context
The brief requires a WebSocket server with presence and graceful degradation. Vercel serves WebSockets natively only in public beta (June 2026), pins a connection to one instance, and caps every connection at the function max duration (300 s Hobby, 800 s Pro), so clients must reconnect constantly and fan-out needs Redis (research notes, "Cloudflare" and "Vercel"). The decision was taken because Vercel's WebSocket duration cap conflicts with long-lived collaborative sessions.

## Decision
Deploy a single Cloudflare Worker with one `Room` Durable Object per map using the WebSocket Hibernation API, a `RateLimiter` Durable Object per user, Hyperdrive to Neon PostGIS, and the Vite SPA as static assets.

## Consequences
No external broker; the room object is the coordinator (≈1,000 req/s soft limit; shard by tile if needed). The backend must be a fetch-runtime app (ADR-0002). Local parity is `wrangler dev` (workerd), not Node (decision D9).
